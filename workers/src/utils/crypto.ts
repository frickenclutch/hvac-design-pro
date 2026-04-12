/**
 * Password hashing utilities using PBKDF2 (Web Crypto API)
 *
 * Replaces the previous unsalted SHA-256 approach with:
 * - 16-byte random salt per password
 * - 100,000 iterations PBKDF2-HMAC-SHA256
 * - Stored as "salt:hash" in the password_hash column
 */

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

const PBKDF2_ITERATIONS = 100_000;

/**
 * Hash a password with PBKDF2. Returns "salt:hash" string.
 * On registration, omit salt to generate a new one.
 * On login, pass the stored salt to recompute.
 */
export async function hashPassword(password: string, existingSalt?: string): Promise<string> {
  const encoder = new TextEncoder();

  const saltBytes = existingSalt
    ? hexToBytes(existingSalt)
    : crypto.getRandomValues(new Uint8Array(16));
  const saltHex = existingSalt || bytesToHex(saltBytes);

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: saltBytes,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    256
  );

  const hashHex = bytesToHex(new Uint8Array(derivedBits));
  return `${saltHex}:${hashHex}`;
}

/**
 * Verify a password against a stored "salt:hash" string.
 * Also supports legacy unsalted SHA-256 hashes (64-char hex with no colon)
 * for backward compatibility during migration.
 */
export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  if (storedHash.includes(':')) {
    // PBKDF2 format: "salt:hash"
    const [salt] = storedHash.split(':');
    const computed = await hashPassword(password, salt);
    return timingSafeEqual(computed, storedHash);
  }

  // Legacy: unsalted SHA-256 (64-char hex)
  const encoder = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(password));
  const legacyHash = bytesToHex(new Uint8Array(hashBuffer));
  return timingSafeEqual(legacyHash, storedHash);
}

/**
 * Constant-time string comparison to prevent timing attacks.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

/**
 * Check if a stored hash is using the legacy SHA-256 format.
 * Used to trigger re-hashing on successful login.
 */
export function isLegacyHash(storedHash: string): boolean {
  return !storedHash.includes(':');
}

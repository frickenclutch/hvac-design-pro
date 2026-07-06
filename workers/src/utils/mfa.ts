/**
 * Multi-Factor Authentication crypto — TOTP (RFC 6238), AES-256-GCM secret
 * encryption, base32 codec, and one-time backup codes. WebCrypto only, ZERO
 * new runtime dependencies.
 *
 * WHY THESE PRIMITIVES
 *  - TOTP secrets are base32 (what authenticator apps expect in the otpauth://
 *    URI and for manual entry).
 *  - TOTP codes are HOTP over a time-derived counter (RFC 6238): HMAC-SHA1,
 *    30-second step, 6 digits, +/-1 step skew for clock drift.
 *  - The shared secret CANNOT be hashed — verifying the rolling code requires
 *    recomputing HOTP from the secret — so it is ENCRYPTED at rest with
 *    AES-256-GCM under a Worker env key (MFA_ENC_KEY). GCM's auth tag gives
 *    free tamper detection. If the key is unset, the caller must REFUSE
 *    enrollment rather than store plaintext.
 *  - Backup codes are HASHED (PBKDF2 via crypto.ts hashPassword) and one-time.
 */

import { timingSafeEqual } from './crypto';
import { generateId } from './id';

// ── base32 (RFC 4648, no padding) ────────────────────────────────────────────

const B32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buf: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (let i = 0; i < buf.length; i++) {
    value = (value << 8) | buf[i];
    bits += 8;
    while (bits >= 5) {
      out += B32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    out += B32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return out;
}

function base32Decode(s: string): Uint8Array {
  const clean = s.replace(/[\s=]/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (let i = 0; i < clean.length; i++) {
    const idx = B32_ALPHABET.indexOf(clean[i]);
    if (idx === -1) continue; // skip any stray non-alphabet char
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

/**
 * Generate a random base32 TOTP secret. 20 bytes = 160-bit, the RFC 4226
 * recommended length for HMAC-SHA1.
 */
export function randomBase32Secret(bytes = 20): string {
  const buf = crypto.getRandomValues(new Uint8Array(bytes));
  return base32Encode(buf);
}

// ── TOTP (RFC 6238) via WebCrypto HMAC-SHA1 ──────────────────────────────────

async function hotp(secret: Uint8Array, counter: number): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    secret as unknown as ArrayBuffer,
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  );
  // 8-byte big-endian counter.
  const msg = new Uint8Array(8);
  let c = counter;
  for (let i = 7; i >= 0; i--) {
    msg[i] = c & 0xff;
    c = Math.floor(c / 256);
  }
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, msg));
  // Dynamic truncation (RFC 4226 §5.3).
  const offset = sig[19] & 0x0f;
  const bin =
    ((sig[offset] & 0x7f) << 24) |
    ((sig[offset + 1] & 0xff) << 16) |
    ((sig[offset + 2] & 0xff) << 8) |
    (sig[offset + 3] & 0xff);
  return String(bin % 1_000_000).padStart(6, '0');
}

/**
 * Verify a 6-digit TOTP code against a base32 secret, allowing +/-1 step of
 * clock skew (30s step → tolerates ~90s of drift). Constant-time comparison.
 */
export async function verifyTotp(
  base32Secret: string,
  code: string,
  atMs: number = Date.now(),
): Promise<boolean> {
  if (!/^\d{6}$/.test(code)) return false;
  const secret = base32Decode(base32Secret);
  if (secret.length === 0) return false;
  const step = Math.floor(atMs / 1000 / 30);
  for (const candidate of [step - 1, step, step + 1]) {
    if (candidate < 0) continue;
    const expected = await hotp(secret, candidate);
    if (timingSafeEqual(expected, code)) return true;
  }
  return false;
}

/**
 * Build the otpauth:// URI an authenticator app scans (or the user types the
 * secret into manually). digits=6, period=30, algorithm=SHA1 must match the
 * verifier above.
 */
export function buildOtpauthUri(
  base32Secret: string,
  email: string,
  issuer = 'HVAC Design Pro',
): string {
  const label = encodeURIComponent(`${issuer}:${email}`);
  const params = new URLSearchParams({
    secret: base32Secret,
    issuer,
    algorithm: 'SHA1',
    digits: '6',
    period: '30',
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

// ── AES-256-GCM secret encryption ────────────────────────────────────────────

function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error('MFA_ENC_KEY must be valid hex');
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    const byte = parseInt(hex.slice(i, i + 2), 16);
    if (Number.isNaN(byte)) throw new Error('MFA_ENC_KEY must be valid hex');
    bytes[i / 2] = byte;
  }
  return bytes;
}

async function importEncKey(hexKey: string): Promise<CryptoKey> {
  const raw = hexToBytes(hexKey);
  if (raw.length !== 32) {
    throw new Error('MFA_ENC_KEY must be 32 bytes (64 hex chars)');
  }
  return crypto.subtle.importKey(
    'raw',
    raw as unknown as ArrayBuffer,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt'],
  );
}

/**
 * Encrypt the base32 TOTP secret with AES-256-GCM under MFA_ENC_KEY.
 * Returns base64(iv || ciphertext+tag) — the value stored in
 * mfa_credentials.secret_encrypted. Throws if the key is missing/invalid; the
 * caller MUST treat that as "MFA not configured" and refuse enrollment.
 */
export async function encryptSecret(plaintextBase32: string, hexKey: string): Promise<string> {
  const key = await importEncKey(hexKey);
  const iv = crypto.getRandomValues(new Uint8Array(12)); // 96-bit GCM nonce
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      new TextEncoder().encode(plaintextBase32),
    ),
  );
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv, 0);
  out.set(ct, iv.length);
  let bin = '';
  for (let i = 0; i < out.length; i++) bin += String.fromCharCode(out[i]);
  return btoa(bin);
}

/**
 * Decrypt a stored secret (base64(iv||ciphertext+tag)) back to the base32
 * plaintext. Throws on a bad key, tampered ciphertext, or malformed input.
 */
export async function decryptSecret(stored: string, hexKey: string): Promise<string> {
  const key = await importEncKey(hexKey);
  const bytes = Uint8Array.from(atob(stored), (ch) => ch.charCodeAt(0));
  const iv = bytes.slice(0, 12);
  const ct = bytes.slice(12);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return new TextDecoder().decode(pt);
}

/**
 * Validate MFA_ENC_KEY shape WITHOUT throwing. Used by the enroll endpoints to
 * decide whether to refuse with a clear error. A key is usable iff it is a
 * 64-hex-char (32-byte) string.
 */
export function isMfaKeyConfigured(hexKey: string | undefined): hexKey is string {
  return typeof hexKey === 'string' && /^[0-9a-fA-F]{64}$/.test(hexKey);
}

// ── Backup codes ─────────────────────────────────────────────────────────────

/**
 * Generate N human-friendly one-time backup codes, e.g. "ABCDE-FGHIJ". Each is
 * 10 base32 chars (~50 bits). The PLAINTEXT codes are returned to the user
 * exactly once (at confirm time); the server stores only their PBKDF2 hashes.
 */
export function generateBackupCodes(n = 10): string[] {
  return Array.from({ length: n }, () => {
    const c = randomBase32Secret(7).slice(0, 10);
    return `${c.slice(0, 5)}-${c.slice(5, 10)}`;
  });
}

// ── Challenge token ──────────────────────────────────────────────────────────

/**
 * A fresh opaque login-challenge token. Same high-entropy shape as the session
 * tokens (two concatenated UUIDs). Stored HASHED via hashToken; the raw value
 * is handed to the client and presented once to complete the second factor.
 */
export function newChallengeToken(): string {
  return `${generateId()}-${generateId()}`;
}

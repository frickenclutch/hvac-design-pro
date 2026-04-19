/**
 * Verification code generation and validation for email verification
 * and password reset flows. Codes are 6-digit numeric strings stored
 * in D1 with expiry and attempt limits.
 */

import { generateId } from './id';

type CodePurpose = 'email_verification' | 'password_reset';

const DEFAULT_EXPIRY: Record<CodePurpose, number> = {
  email_verification: 10, // minutes
  password_reset: 15,
};

const MAX_ATTEMPTS = 5;

/**
 * Generate a cryptographically random 6-digit numeric code.
 */
export function generateCode(): string {
  const arr = new Uint32Array(1);
  crypto.getRandomValues(arr);
  return String(arr[0] % 1000000).padStart(6, '0');
}

/**
 * Create a new verification code, invalidating any existing unused codes
 * for the same user + purpose.
 *
 * Returns the plaintext 6-digit code for embedding in an email.
 */
export async function createVerificationCode(
  db: D1Database,
  userId: string,
  email: string,
  purpose: CodePurpose,
  expiryMinutes?: number,
): Promise<string> {
  const code = generateCode();
  const expiry = expiryMinutes ?? DEFAULT_EXPIRY[purpose];
  const expiresAt = new Date(Date.now() + expiry * 60 * 1000).toISOString();
  const id = generateId();

  // Invalidate any existing unused codes for this user + purpose
  await db
    .prepare(
      `UPDATE verification_codes SET used_at = datetime('now')
       WHERE user_id = ? AND purpose = ? AND used_at IS NULL`,
    )
    .bind(userId, purpose)
    .run();

  // Insert the new code
  await db
    .prepare(
      `INSERT INTO verification_codes (id, user_id, email, code, purpose, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, userId, email.toLowerCase().trim(), code, purpose, expiresAt)
    .run();

  return code;
}

/**
 * Validate a verification code. On success, marks it as used.
 * Returns the associated userId on success.
 */
export async function validateVerificationCode(
  db: D1Database,
  email: string,
  code: string,
  purpose: CodePurpose,
): Promise<{ valid: boolean; userId?: string; error?: string }> {
  const normalizedEmail = email.toLowerCase().trim();

  // Fetch the most recent unused, unexpired code for this email + purpose
  const row = await db
    .prepare(
      `SELECT id, user_id, code, attempts
       FROM verification_codes
       WHERE email = ? AND purpose = ? AND used_at IS NULL AND expires_at > datetime('now')
       ORDER BY created_at DESC
       LIMIT 1`,
    )
    .bind(normalizedEmail, purpose)
    .first<{ id: string; user_id: string; code: string; attempts: number }>();

  if (!row) {
    return { valid: false, error: 'No pending code. Please request a new one.' };
  }

  if (row.attempts >= MAX_ATTEMPTS) {
    return { valid: false, error: 'Too many attempts. Please request a new code.' };
  }

  if (row.code !== code) {
    // Increment attempt counter
    await db
      .prepare('UPDATE verification_codes SET attempts = attempts + 1 WHERE id = ?')
      .bind(row.id)
      .run();
    return { valid: false, error: 'Invalid code. Please try again.' };
  }

  // Mark as used
  await db
    .prepare(`UPDATE verification_codes SET used_at = datetime('now') WHERE id = ?`)
    .bind(row.id)
    .run();

  return { valid: true, userId: row.user_id };
}

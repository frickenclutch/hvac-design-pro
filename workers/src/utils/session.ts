/**
 * Session minting — the split access + refresh token model.
 *
 * Both tokens are opaque high-entropy random strings (two concatenated IDs)
 * and are stored HASHED (SHA-256) at rest, never raw — see utils/crypto.ts
 * `hashToken`. The client holds the raw tokens:
 *   • access token  → sent as the Bearer on every request (sessions table)
 *   • refresh token → sent ONLY to POST /api/auth/refresh (refresh_tokens)
 *
 * `mintTokenPair` is the single source of truth for issuing a session — used
 * by every login path (password, email-verify, both SSO callbacks, invite
 * redeem) and by the refresh-rotation endpoint.
 */
import { generateId } from './id';
import { hashToken } from './crypto';

/**
 * Access-token lifetime — 30 minutes. Short by design: a leaked access token
 * is useless within the half-hour. The frontend refreshes silently on a 401
 * (lib/api.ts `refreshSession`), so the short TTL is invisible mid-session —
 * an expired access token triggers a transparent rotation + retry.
 */
export const ACCESS_TTL_MS = 30 * 60 * 1000;

/** Refresh-token lifetime — 14 days, rotating on every use. */
export const REFRESH_TTL_MS = 14 * 24 * 60 * 60 * 1000;

export interface TokenPair {
  /** Raw access token — the request Bearer. */
  accessToken: string;
  /** Raw refresh token — presented only to /api/auth/refresh. */
  refreshToken: string;
}

const newToken = () => `${generateId()}-${generateId()}`;

/**
 * Issue a fresh access + refresh token pair for a user, both stored hashed.
 * The two inserts run as one atomic batch. Returns the RAW tokens for the
 * client; only their SHA-256 hashes ever touch the database.
 */
export async function mintTokenPair(
  db: D1Database,
  userId: string,
  orgId: string,
): Promise<TokenPair> {
  const accessToken = newToken();
  const refreshToken = newToken();
  const now = Date.now();
  const accessExpiresAt = new Date(now + ACCESS_TTL_MS).toISOString();
  const refreshExpiresAt = new Date(now + REFRESH_TTL_MS).toISOString();

  await db.batch([
    db
      .prepare('INSERT INTO sessions (id, user_id, org_id, token, expires_at) VALUES (?, ?, ?, ?, ?)')
      .bind(generateId(), userId, orgId, await hashToken(accessToken), accessExpiresAt),
    db
      .prepare('INSERT INTO refresh_tokens (id, user_id, org_id, token_hash, expires_at) VALUES (?, ?, ?, ?, ?)')
      .bind(generateId(), userId, orgId, await hashToken(refreshToken), refreshExpiresAt),
  ]);

  return { accessToken, refreshToken };
}

/**
 * Issue an IMPERSONATION session — L0 platform admin viewing a tenant as
 * its admin. Deliberately different from mintTokenPair:
 *   • ACCESS-ONLY — no refresh token row, so the session cannot be renewed;
 *     it hard-dies at the 30-minute TTL and the client falls back to the
 *     admin's stashed real session.
 *   • is_impersonation = 1 rides the session row so authMiddleware flags
 *     every request and the index.ts mutation guard enforces read-only.
 * The org_id is the TARGET tenant while user_id stays the L0 admin — the
 * same session-carries-org-context seam every login path already uses.
 */
export async function mintImpersonationSession(
  db: D1Database,
  userId: string,
  targetOrgId: string,
): Promise<{ accessToken: string; expiresAt: string }> {
  const accessToken = newToken();
  const expiresAt = new Date(Date.now() + ACCESS_TTL_MS).toISOString();

  await db
    .prepare('INSERT INTO sessions (id, user_id, org_id, token, expires_at, is_impersonation) VALUES (?, ?, ?, ?, ?, 1)')
    .bind(generateId(), userId, targetOrgId, await hashToken(accessToken), expiresAt)
    .run();

  return { accessToken, expiresAt };
}

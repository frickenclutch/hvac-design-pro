-- 0014_mfa.sql — Multi-Factor Authentication (TOTP + email-OTP fallback)
-- =====================================================================
-- ISOLATION: every table here is USER-OWNED, NOT org-owned. Each row is a
-- single user's own second-factor credential, keyed by user_id and ALWAYS
-- read/written `WHERE user_id = ?` bound to the SESSION user (c.get('user').id)
-- -- never a client-supplied id. This is the SAME ownership model as
-- `sessions` and `refresh_tokens`: the tenant (org_id) is derived from the
-- user's org membership, not carried on these rows. These tables are
-- DELIBERATELY NOT added to check-tenant-scoping.mjs STRICT_TABLES (see the
-- MFA comment block in that script).
--
-- SAFETY: purely additive (CREATE ... IF NOT EXISTS). No existing row or
-- query changes. A user with NO row here behaves EXACTLY as today -- login is
-- completely unaffected. The worker code that reads these deploys AFTER the
-- migration is applied (strict ordering).
--
-- SECRETS: mfa_credentials.secret_encrypted holds the TOTP shared secret
-- AES-256-GCM encrypted with the Worker env key MFA_ENC_KEY (stored as
-- base64 of iv||ciphertext||tag). A TOTP secret CANNOT be hashed -- it must
-- be recoverable to recompute the rolling code -- so it is ENCRYPTED, not
-- hashed. If MFA_ENC_KEY is unset, enrollment REFUSES (never stores
-- plaintext). Backup codes ARE hashed (PBKDF2 salt:hash, one-way, one-time).
-- =====================================================================

-- One confirmed (or pending) credential per user per type. v1 uses type='totp'.
-- A row with confirmed_at IS NULL is an in-progress enrollment (secret stored
-- encrypted, but NOT yet active -- login enforcement ignores unconfirmed rows).
-- A row with confirmed_at IS NOT NULL means MFA is ENABLED for this user.
CREATE TABLE IF NOT EXISTS mfa_credentials (
    id               TEXT PRIMARY KEY,
    user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type             TEXT NOT NULL DEFAULT 'totp' CHECK (type IN ('totp')),
    secret_encrypted TEXT NOT NULL,
    confirmed_at     TEXT,
    last_used_at     TEXT,
    created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

-- A user has at most one credential per type. The enroll endpoint REPLACEs an
-- existing unconfirmed row for the same (user_id, type); a confirmed row blocks
-- re-enroll until disabled. Unique index enforces the one-per-type invariant.
CREATE UNIQUE INDEX IF NOT EXISTS idx_mfa_credentials_user_type
    ON mfa_credentials (user_id, type);

-- One-time backup codes, stored HASHED (PBKDF2 salt:hash, same util as
-- passwords). used_at marks consumption. Disabling MFA deletes the user's set.
CREATE TABLE IF NOT EXISTS mfa_backup_codes (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code_hash  TEXT NOT NULL,
    used_at    TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_mfa_backup_codes_user ON mfa_backup_codes (user_id);

-- Short-lived login challenge. After a password (or SSO) success for an
-- MFA-ENABLED user, instead of minting a session we issue an opaque challenge
-- token (HASHED at rest, same posture as sessions/refresh) bound to the user.
-- It is consumed at /api/auth/mfa/challenge and is the ONLY thing that lets the
-- second-factor step mint a real session -- a client cannot skip it.
-- purpose distinguishes a normal second-factor challenge ('login') from a
-- forced-enrollment grace handoff ('enroll') so the wrong token can't cross over.
CREATE TABLE IF NOT EXISTS mfa_challenges (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    org_id      TEXT NOT NULL REFERENCES organisations(id),
    token_hash  TEXT UNIQUE NOT NULL,
    purpose     TEXT NOT NULL DEFAULT 'login' CHECK (purpose IN ('login','enroll')),
    expires_at  TEXT NOT NULL,
    consumed_at TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_mfa_challenges_hash ON mfa_challenges (token_hash);
CREATE INDEX IF NOT EXISTS idx_mfa_challenges_user ON mfa_challenges (user_id);

-- Informational only: when this user first had MFA enforced for their role.
-- Enforcement is COMPUTED from role at login (admin / is_platform_admin), not
-- read from this column -- so a future role change is honored without a backfill.
-- NOTE: D1 ALTER TABLE ADD COLUMN is NOT idempotent (no IF NOT EXISTS). Kept
-- last so the additive CREATE TABLEs still apply if the column already exists
-- on a re-run. The test harness applies each statement in its own try/catch,
-- so a duplicate-column re-run is swallowed there.
ALTER TABLE users ADD COLUMN mfa_enforced_at TEXT;

-- 0016_verification_codes_mfa_purpose.sql — widen the verification_codes
-- purpose CHECK to allow MFA email-OTP codes.
--
-- BUG (caught in prod 2026-07-06 via worker log tail during MFA testing):
-- POST /api/auth/mfa/email-code inserts a code with purpose='mfa_verification'
-- (utils/verificationCodes.ts, the email second-factor fallback), but the
-- original CHECK (migration 0003) only allowed ('email_verification',
-- 'password_reset'). D1 enforces CHECK constraints, so the INSERT threw
-- SQLITE_CONSTRAINT_CHECK — a 500 on the email-code fallback. TOTP was
-- unaffected; only the "email me a code instead" path on the MFA challenge
-- screen was broken. The MFA train (0014) added the feature but never
-- widened this constraint.
--
-- SQLite cannot alter a CHECK in place — full table rebuild (same pattern
-- as 0015): create with the widened CHECK, copy, drop, rename, re-index.
-- verification_codes holds only short-lived, single-use codes, so copying
-- is cheap and losing an in-flight code (none expected mid-migration) would
-- at worst make a user request a fresh one.

CREATE TABLE verification_codes_new (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    code TEXT NOT NULL,
    purpose TEXT NOT NULL CHECK (purpose IN ('email_verification', 'password_reset', 'mfa_verification')),
    attempts INTEGER NOT NULL DEFAULT 0,
    expires_at TEXT NOT NULL,
    used_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO verification_codes_new
    (id, user_id, email, code, purpose, attempts, expires_at, used_at, created_at)
SELECT
    id, user_id, email, code, purpose, attempts, expires_at, used_at, created_at
FROM verification_codes;

DROP TABLE verification_codes;

ALTER TABLE verification_codes_new RENAME TO verification_codes;

CREATE INDEX IF NOT EXISTS idx_vc_email_purpose ON verification_codes(email, purpose);

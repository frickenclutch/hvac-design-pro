-- 0024_sso_subject.sql — bind SSO accounts to the identity provider's subject.
--
-- WHY
-- The Microsoft SSO callback matched accounts on email alone. The app
-- registration accepts any Microsoft tenant, and a tenant admin can set the
-- Graph `mail` attribute on their own directory user to any address — so
-- anyone with a free tenant could sign in as an existing user whose email
-- they knew (security audit 2026-11-18, A-1).
--
-- WHAT
-- `sso_provider` + `sso_subject` record WHICH external identity an account is
-- bound to. For Microsoft the subject is `<tenant id>:<object id>` from the
-- id_token — immutable and unique per directory user. Returning SSO users are
-- matched on the subject; the email is only consulted on the very first SSO
-- sign-in, and only when the directory vouches for it (see
-- utils/oauth.ts resolveMicrosoftIdentity).
--
-- Both columns are NULL for password-only accounts and for SSO accounts
-- created before this migration; those bind on their next Microsoft sign-in.
-- The unique index makes one external identity map to at most one account.
--
-- APPLY BEFORE DEPLOYING THE WORKER: the callback SELECTs these columns.
-- Numbered 0024 because 0022/0023 are taken by PR #42 (scan captures,
-- pricing ingest).

ALTER TABLE users ADD COLUMN sso_provider TEXT;
ALTER TABLE users ADD COLUMN sso_subject TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_sso_subject
  ON users (sso_provider, sso_subject)
  WHERE sso_subject IS NOT NULL;

-- Pending "prove you own this mailbox" challenges for a first SSO sign-in
-- whose email the directory does not vouch for. The callback emails a 6-digit
-- code to the address and returns an opaque link token. POST
-- /api/auth/sso/microsoft/link presents both to bind the subject.
--
-- Pre-identity, like verification_codes and mfa_challenges, so there is no
-- org_id. Nothing here is a usable credential at rest. token_hash is
-- SHA-256(link token). code_hash is SHA-256(link token + ':' + code), so the
-- six digits cannot be recovered or brute-forced from a database read
-- without the raw token, which is never stored. expires_at and consumed_at
-- are JS ISO strings (compare against a bound ISO now, never datetime('now')).
CREATE TABLE IF NOT EXISTS sso_link_challenges (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    subject TEXT NOT NULL,
    email TEXT NOT NULL,
    first_name TEXT NOT NULL DEFAULT '',
    last_name TEXT NOT NULL DEFAULT '',
    code_hash TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    expires_at TEXT NOT NULL,
    consumed_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sso_link_challenges_expiry
  ON sso_link_challenges (expires_at);

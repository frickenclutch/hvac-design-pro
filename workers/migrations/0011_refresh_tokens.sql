-- 0011_refresh_tokens.sql — rotating refresh-token store for the auth
-- hardening rollout (split access + refresh token model).
--
-- WHY
-- Until now a single 30-day bearer (the `sessions` row) was BOTH the
-- credential sent on every request AND the long-lived session — a stolen
-- copy was valid for up to 30 days against the entire API. The hardened
-- model splits the two:
--   • access token  (sessions)     — short-lived, sent on every request
--   • refresh token (this table)   — long-lived, sent ONLY to
--                                    /api/auth/refresh, single-use / rotating
-- Each refresh exchanges (rotates) the presented token for a fresh pair and
-- consumes the old one (`revoked_at`). Replaying a consumed token is theft
-- evidence → the endpoint revokes the user's whole set and forces re-login.
--
-- Stored HASHED (token_hash = SHA-256), never raw — same at-rest posture as
-- `sessions.token` (2026-06-02). A DB read/dump/SQLi yields no usable tokens.
--
-- `org_id` travels with the token so the rotation endpoint can mint the new
-- access session without re-deriving it. `rotated_to` is reserved for
-- forensic chain-tracing (which token succeeded which) and is not yet
-- populated.
--
-- SAFETY: purely additive new table (CREATE TABLE IF NOT EXISTS). No existing
-- row or query changes. The worker code that writes/reads it deploys AFTER
-- this migration is applied (strict ordering — the table must exist before
-- any mint/refresh path runs, or those requests 500).

CREATE TABLE IF NOT EXISTS refresh_tokens (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    org_id TEXT NOT NULL REFERENCES organisations(id),
    token_hash TEXT UNIQUE NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    rotated_to TEXT,
    revoked_at TEXT
);

-- Hot path: lookup by token_hash on every refresh.
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_hash ON refresh_tokens(token_hash);
-- Bulk revocation by user (logout, password reset, theft response).
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id);

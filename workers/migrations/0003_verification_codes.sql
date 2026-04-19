-- Verification codes for email verification and password reset flows
CREATE TABLE IF NOT EXISTS verification_codes (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    code TEXT NOT NULL,
    purpose TEXT NOT NULL CHECK (purpose IN ('email_verification', 'password_reset')),
    attempts INTEGER NOT NULL DEFAULT 0,
    expires_at TEXT NOT NULL,
    used_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_vc_email_purpose ON verification_codes(email, purpose);

-- Rate limit events for auth endpoint protection
CREATE TABLE IF NOT EXISTS rate_limit_events (
    id TEXT PRIMARY KEY,
    identifier TEXT NOT NULL,
    action TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_rle_lookup ON rate_limit_events(identifier, action, created_at);

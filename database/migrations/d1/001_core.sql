-- ============================================================
-- HVAC Design Pro — D1 (SQLite) Schema
-- Migration 001: Core tenancy, auth, projects
-- ============================================================
-- D1 constraints:
--   - No UUID type (use TEXT with app-generated UUIDs)
--   - No TIMESTAMPTZ (use TEXT ISO 8601)
--   - No JSONB (use TEXT, parse in app)
--   - No GENERATED columns (compute in app)
--   - No RLS (enforce org_id in every query)
--   - No gen_random_uuid() (generate in Workers via crypto.randomUUID())
-- ============================================================

-- ORGANISATIONS (tenants)
CREATE TABLE IF NOT EXISTS organisations (
    id            TEXT PRIMARY KEY,                -- crypto.randomUUID()
    slug          TEXT UNIQUE NOT NULL,            -- subdomain: acme.hvacpro.app
    name          TEXT NOT NULL,
    org_type      TEXT NOT NULL DEFAULT 'company'  -- company | municipality | individual
                  CHECK (org_type IN ('company', 'municipality', 'individual')),
    plan          TEXT NOT NULL DEFAULT 'starter'  -- starter | professional | enterprise
                  CHECK (plan IN ('starter', 'professional', 'enterprise')),
    seats_limit   INTEGER NOT NULL DEFAULT 5,
    acca_cert_num TEXT,                            -- populated once ACCA approves
    logo_url      TEXT,                            -- R2 key or external URL
    region_code   TEXT NOT NULL DEFAULT 'NA_ASHRAE'
                  CHECK (region_code IN ('NA_ASHRAE', 'EU_EN', 'UK_CIBSE')),
    settings      TEXT NOT NULL DEFAULT '{}',      -- JSON: timezone, units, report template
    address_line1 TEXT,
    address_line2 TEXT,
    city          TEXT,
    state         TEXT,
    zip           TEXT,
    country       TEXT DEFAULT 'US',
    phone         TEXT,
    stripe_cust_id TEXT,                           -- billing integration
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_organisations_type ON organisations(org_type);
CREATE INDEX idx_organisations_slug ON organisations(slug);

-- USERS
CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,                -- crypto.randomUUID()
    org_id        TEXT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    email         TEXT UNIQUE NOT NULL,
    password_hash TEXT,                            -- argon2/scrypt hash (nullable for passkey-only users)
    passkey_cred  TEXT,                            -- WebAuthn credential JSON (nullable for password users)
    cognito_sub   TEXT UNIQUE,                     -- AWS Cognito link (nullable, legacy/migration)
    role          TEXT NOT NULL DEFAULT 'tech'
                  CHECK (role IN ('admin', 'engineer', 'tech', 'viewer')),
    first_name    TEXT,
    last_name     TEXT,
    phone         TEXT,
    pe_license    TEXT,                            -- PE licence number (optional)
    is_verified   INTEGER NOT NULL DEFAULT 0,      -- SQLite boolean: 0=false, 1=true
    address_line1 TEXT,
    address_line2 TEXT,
    city          TEXT,
    state         TEXT,
    zip           TEXT,
    country       TEXT DEFAULT 'US',
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    last_seen_at  TEXT
);

CREATE INDEX idx_users_org ON users(org_id);
CREATE INDEX idx_users_email ON users(email);

-- SESSIONS (token-based auth)
CREATE TABLE IF NOT EXISTS sessions (
    id            TEXT PRIMARY KEY,
    user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    org_id        TEXT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    token         TEXT UNIQUE NOT NULL,
    user_agent    TEXT,                            -- device tracking
    ip_address    TEXT,                            -- audit trail
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at    TEXT NOT NULL                    -- ISO 8601 datetime
);

CREATE INDEX idx_sessions_token ON sessions(token);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

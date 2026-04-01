-- ORGANISATIONS (tenants)
CREATE TABLE organisations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug TEXT UNIQUE NOT NULL, -- used in subdomain: acme.hvacpro.app
    name TEXT NOT NULL,
    plan TEXT NOT NULL DEFAULT 'starter', -- starter | professional | enterprise
    seats_limit INT NOT NULL DEFAULT 5,
    acca_cert_num TEXT, -- populated once ACCA approves
    logo_url TEXT,
    settings JSONB NOT NULL DEFAULT '{}', -- timezone, units, report template
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    stripe_cust_id TEXT -- billing
);

-- USERS
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    email TEXT UNIQUE NOT NULL,
    cognito_sub TEXT UNIQUE NOT NULL, -- links to AWS Cognito pool
    role TEXT NOT NULL DEFAULT 'tech', -- admin | engineer | tech | viewer
    first_name TEXT,
    last_name TEXT,
    pe_license TEXT, -- PE licence number (optional)
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ
);

-- ROW-LEVEL SECURITY on USERS
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

CREATE POLICY users_org_isolation ON users 
USING (org_id = current_setting('app.current_org_id')::UUID);

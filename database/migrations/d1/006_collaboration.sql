-- ============================================================
-- HVAC Design Pro — D1 (SQLite) Schema
-- Migration 006: Collaboration, comments, sharing, invites
-- ============================================================

-- INVITATIONS (org member invites)
CREATE TABLE IF NOT EXISTS invitations (
    id              TEXT PRIMARY KEY,
    org_id          TEXT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    email           TEXT NOT NULL,
    role            TEXT NOT NULL DEFAULT 'tech'
                    CHECK (role IN ('admin', 'engineer', 'tech', 'viewer')),
    invited_by      TEXT NOT NULL REFERENCES users(id),
    token           TEXT UNIQUE NOT NULL,           -- one-time invite token
    status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'accepted', 'expired', 'revoked')),
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at      TEXT NOT NULL                   -- 7-day default
);

CREATE INDEX idx_invites_org ON invitations(org_id);
CREATE INDEX idx_invites_token ON invitations(token);
CREATE INDEX idx_invites_email ON invitations(email);

-- PROJECT COMMENTS (red-line markup, general notes)
CREATE TABLE IF NOT EXISTS comments (
    id              TEXT PRIMARY KEY,
    project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    org_id          TEXT NOT NULL REFERENCES organisations(id),
    drawing_id      TEXT REFERENCES cad_drawings(id) ON DELETE SET NULL,  -- optional: pin to a drawing
    parent_id       TEXT REFERENCES comments(id) ON DELETE CASCADE,       -- threaded replies
    author_id       TEXT NOT NULL REFERENCES users(id),
    body            TEXT NOT NULL,
    -- Canvas coordinates for red-line markup (nullable for general comments)
    pin_x           REAL,                          -- canvas X coordinate
    pin_y           REAL,                          -- canvas Y coordinate
    pin_floor       INTEGER,                       -- floor index
    status          TEXT NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open', 'resolved', 'wont_fix')),
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_comments_project ON comments(project_id);
CREATE INDEX idx_comments_drawing ON comments(drawing_id);
CREATE INDEX idx_comments_author ON comments(author_id);
CREATE INDEX idx_comments_parent ON comments(parent_id);

-- PROJECT SHARING (cross-org project access)
CREATE TABLE IF NOT EXISTS project_shares (
    id              TEXT PRIMARY KEY,
    project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    org_id          TEXT NOT NULL REFERENCES organisations(id),       -- owning org
    shared_with_org TEXT REFERENCES organisations(id),                -- target org (null = public link)
    shared_with_user TEXT REFERENCES users(id),                      -- or specific user
    permission      TEXT NOT NULL DEFAULT 'view'
                    CHECK (permission IN ('view', 'comment', 'edit')),
    share_token     TEXT UNIQUE,                   -- for public link sharing
    created_by      TEXT NOT NULL REFERENCES users(id),
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at      TEXT                           -- optional expiration
);

CREATE INDEX idx_shares_project ON project_shares(project_id);
CREATE INDEX idx_shares_org ON project_shares(shared_with_org);
CREATE INDEX idx_shares_token ON project_shares(share_token);

-- REAL-TIME PRESENCE (ephemeral — cleaned up periodically)
CREATE TABLE IF NOT EXISTS presence (
    user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    cursor_x        REAL,
    cursor_y        REAL,
    floor_index     INTEGER,
    active_tool     TEXT,
    last_heartbeat  TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, project_id)
);

CREATE INDEX idx_presence_project ON presence(project_id);
CREATE INDEX idx_presence_heartbeat ON presence(last_heartbeat);

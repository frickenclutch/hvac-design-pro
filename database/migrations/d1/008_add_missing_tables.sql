-- ============================================================
-- HVAC Design Pro — D1 (SQLite) Schema
-- Migration 008: Add roadmap tables missing from initial deploy
-- Core 12 tables already exist; this adds the remaining 14
-- ============================================================

-- WALLS (envelope segments linked to rooms)
CREATE TABLE IF NOT EXISTS walls (
    id              TEXT PRIMARY KEY,
    room_id         TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    org_id          TEXT NOT NULL REFERENCES organisations(id),
    orientation     INTEGER NOT NULL,
    length_ft       REAL NOT NULL,
    height_ft       REAL,
    construction    TEXT NOT NULL DEFAULT 'wood_frame'
                    CHECK (construction IN ('wood_frame', 'metal_stud', 'concrete', 'sip', 'icf', 'masonry')),
    r_value         REAL NOT NULL,
    is_exterior     INTEGER NOT NULL DEFAULT 1,
    adjacent_room_id TEXT REFERENCES rooms(id),
    meta            TEXT DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_walls_room ON walls(room_id);

-- DUCT FITTINGS LIBRARY (reference data)
CREATE TABLE IF NOT EXISTS duct_fittings_library (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    category        TEXT NOT NULL,
    equiv_length_ft REAL NOT NULL,
    applicable_shapes TEXT DEFAULT 'round,rectangular',
    notes           TEXT
);

-- FILE UPLOAD INDEXES (may already exist partially)
CREATE INDEX IF NOT EXISTS idx_uploads_r2key ON file_uploads(r2_key);

-- AUDIT LOG
CREATE TABLE IF NOT EXISTS audit_log (
    id              TEXT PRIMARY KEY,
    org_id          TEXT NOT NULL REFERENCES organisations(id),
    user_id         TEXT REFERENCES users(id),
    project_id      TEXT REFERENCES projects(id),
    action          TEXT NOT NULL,
    entity_type     TEXT,
    entity_id       TEXT,
    detail          TEXT,
    ip_address      TEXT,
    user_agent      TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_org ON audit_log(org_id);
CREATE INDEX IF NOT EXISTS idx_audit_project ON audit_log(project_id);
CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_log(created_at DESC);

-- DRAWING REVISIONS
CREATE TABLE IF NOT EXISTS drawing_revisions (
    id              TEXT PRIMARY KEY,
    drawing_id      TEXT NOT NULL REFERENCES cad_drawings(id) ON DELETE CASCADE,
    org_id          TEXT NOT NULL REFERENCES organisations(id),
    version         INTEGER NOT NULL,
    canvas_json     TEXT,
    r2_snapshot_key TEXT,
    change_summary  TEXT,
    created_by      TEXT REFERENCES users(id),
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_revisions_version ON drawing_revisions(drawing_id, version);

-- CALCULATION AUDIT SNAPSHOTS (PE stamp support)
CREATE TABLE IF NOT EXISTS calc_snapshots (
    id              TEXT PRIMARY KEY,
    calculation_id  TEXT NOT NULL REFERENCES calculations(id) ON DELETE CASCADE,
    org_id          TEXT NOT NULL REFERENCES organisations(id),
    inputs_hash     TEXT NOT NULL,
    outputs_hash    TEXT NOT NULL,
    snapshot_json   TEXT,
    signed_by       TEXT REFERENCES users(id),
    signed_at       TEXT,
    pe_license      TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_snapshots_calc ON calc_snapshots(calculation_id);

-- INVITATIONS
CREATE TABLE IF NOT EXISTS invitations (
    id              TEXT PRIMARY KEY,
    org_id          TEXT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    email           TEXT NOT NULL,
    role            TEXT NOT NULL DEFAULT 'tech'
                    CHECK (role IN ('admin', 'engineer', 'tech', 'viewer')),
    invited_by      TEXT NOT NULL REFERENCES users(id),
    token           TEXT UNIQUE NOT NULL,
    status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'accepted', 'expired', 'revoked')),
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_invites_token ON invitations(token);

-- PROJECT COMMENTS (red-line markup)
CREATE TABLE IF NOT EXISTS comments (
    id              TEXT PRIMARY KEY,
    project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    org_id          TEXT NOT NULL REFERENCES organisations(id),
    drawing_id      TEXT REFERENCES cad_drawings(id) ON DELETE SET NULL,
    parent_id       TEXT REFERENCES comments(id) ON DELETE CASCADE,
    author_id       TEXT NOT NULL REFERENCES users(id),
    body            TEXT NOT NULL,
    pin_x           REAL,
    pin_y           REAL,
    pin_floor       INTEGER,
    status          TEXT NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open', 'resolved', 'wont_fix')),
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_comments_project ON comments(project_id);
CREATE INDEX IF NOT EXISTS idx_comments_drawing ON comments(drawing_id);

-- PROJECT SHARING
CREATE TABLE IF NOT EXISTS project_shares (
    id               TEXT PRIMARY KEY,
    project_id       TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    org_id           TEXT NOT NULL REFERENCES organisations(id),
    shared_with_org  TEXT REFERENCES organisations(id),
    shared_with_user TEXT REFERENCES users(id),
    permission       TEXT NOT NULL DEFAULT 'view'
                     CHECK (permission IN ('view', 'comment', 'edit')),
    share_token      TEXT UNIQUE,
    created_by       TEXT NOT NULL REFERENCES users(id),
    created_at       TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at       TEXT
);
CREATE INDEX IF NOT EXISTS idx_shares_project ON project_shares(project_id);

-- REAL-TIME PRESENCE
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

-- AHRI EQUIPMENT DIRECTORY
CREATE TABLE IF NOT EXISTS ahri_directory (
    id              TEXT PRIMARY KEY,
    ahri_ref_num    TEXT UNIQUE NOT NULL,
    manufacturer    TEXT NOT NULL,
    brand           TEXT,
    model_outdoor   TEXT NOT NULL,
    model_indoor    TEXT,
    model_coil      TEXT,
    system_type     TEXT NOT NULL,
    nominal_tons    REAL,
    cooling_95_btuh INTEGER,
    sensible_95_btuh INTEGER,
    heating_47_btuh INTEGER,
    heating_17_btuh INTEGER,
    seer2           REAL,
    eer_95          REAL,
    hspf2           REAL,
    refrigerant     TEXT,
    cfm_rated       INTEGER,
    energy_star     INTEGER DEFAULT 0,
    raw_data        TEXT,
    imported_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ahri_manufacturer ON ahri_directory(manufacturer);
CREATE INDEX IF NOT EXISTS idx_ahri_tonnage ON ahri_directory(nominal_tons);

-- WEATHER STATIONS
CREATE TABLE IF NOT EXISTS weather_stations (
    id              TEXT PRIMARY KEY,
    station_id      TEXT UNIQUE NOT NULL,
    name            TEXT NOT NULL,
    state           TEXT,
    country         TEXT NOT NULL DEFAULT 'US',
    latitude        REAL NOT NULL,
    longitude       REAL NOT NULL,
    elevation_ft    REAL,
    climate_zone    TEXT,
    cooling_db_1    REAL,
    cooling_wb_1    REAL,
    heating_db_994  REAL,
    heating_db_99   REAL,
    daily_range     TEXT,
    hdd_65          INTEGER,
    cdd_50          INTEGER,
    raw_data        TEXT,
    imported_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_weather_state ON weather_stations(state);
CREATE INDEX IF NOT EXISTS idx_weather_zone ON weather_stations(climate_zone);

-- COMPLIANCE CHECKS
CREATE TABLE IF NOT EXISTS compliance_checks (
    id              TEXT PRIMARY KEY,
    project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    org_id          TEXT NOT NULL REFERENCES organisations(id),
    code_standard   TEXT NOT NULL
                    CHECK (code_standard IN ('IRC_2021', 'IECC_2021', 'ASHRAE_90_1', 'Title24', 'NECB', 'EN_15603')),
    check_type      TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'pass', 'fail', 'warning', 'not_applicable')),
    details         TEXT,
    calculation_id  TEXT REFERENCES calculations(id),
    checked_by      TEXT REFERENCES users(id),
    checked_at      TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_compliance_project ON compliance_checks(project_id);

-- ZONES (multi-zone HVAC systems)
CREATE TABLE IF NOT EXISTS zones (
    id              TEXT PRIMARY KEY,
    project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    org_id          TEXT NOT NULL REFERENCES organisations(id),
    duct_system_id  TEXT REFERENCES duct_systems(id),
    name            TEXT NOT NULL,
    thermostat_id   TEXT,
    design_cooling_cfm REAL,
    design_heating_cfm REAL,
    damper_type     TEXT DEFAULT 'manual'
                    CHECK (damper_type IN ('manual', 'motorized', 'none')),
    sort_order      INTEGER DEFAULT 0,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_zones_project ON zones(project_id);

-- ROOM-ZONE LINK (many-to-many)
CREATE TABLE IF NOT EXISTS room_zones (
    room_id         TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    zone_id         TEXT NOT NULL REFERENCES zones(id) ON DELETE CASCADE,
    PRIMARY KEY (room_id, zone_id)
);

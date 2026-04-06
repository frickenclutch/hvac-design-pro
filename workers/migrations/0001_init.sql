-- D1 Schema for HVAC Design Pro
-- Converted from PostgreSQL migrations 001-006

-- ORGANISATIONS (tenants)
CREATE TABLE IF NOT EXISTS organisations (
    id TEXT PRIMARY KEY,
    slug TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    org_type TEXT NOT NULL DEFAULT 'company' CHECK (org_type IN ('company', 'municipality', 'individual')),
    plan TEXT NOT NULL DEFAULT 'starter',
    seats_limit INTEGER NOT NULL DEFAULT 5,
    acca_cert_num TEXT,
    logo_url TEXT,
    settings TEXT NOT NULL DEFAULT '{}',
    region_code TEXT NOT NULL DEFAULT 'NA_ASHRAE' CHECK (region_code IN ('NA_ASHRAE', 'EU_EN', 'UK_CIBSE')),
    address_line1 TEXT,
    address_line2 TEXT,
    city TEXT,
    state TEXT,
    zip TEXT,
    country TEXT DEFAULT 'US',
    phone TEXT,
    stripe_cust_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- USERS
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT,
    role TEXT NOT NULL DEFAULT 'tech' CHECK (role IN ('admin', 'engineer', 'tech', 'viewer')),
    first_name TEXT,
    last_name TEXT,
    pe_license TEXT,
    phone TEXT,
    address_line1 TEXT,
    address_line2 TEXT,
    city TEXT,
    state TEXT,
    zip TEXT,
    country TEXT DEFAULT 'US',
    is_verified INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_seen_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_users_org ON users(org_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- PROJECTS
CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    address TEXT,
    city TEXT,
    state TEXT,
    zip TEXT,
    country TEXT NOT NULL DEFAULT 'US',
    climate_zone TEXT,
    standard TEXT NOT NULL DEFAULT 'ACCA' CHECK (standard IN ('ACCA', 'ASHRAE', 'EN12831', 'CSA_F280')),
    status TEXT NOT NULL DEFAULT 'active',
    created_by TEXT NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_projects_org ON projects(org_id);

-- CALCULATIONS (immutable audit log)
CREATE TABLE IF NOT EXISTS calculations (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    org_id TEXT NOT NULL REFERENCES organisations(id),
    calc_type TEXT NOT NULL CHECK (calc_type IN ('MANUAL_J', 'MANUAL_D', 'MANUAL_S', 'AED')),
    version INTEGER NOT NULL DEFAULT 1,
    inputs TEXT NOT NULL,
    outputs TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    engine_version TEXT NOT NULL,
    computed_by TEXT REFERENCES users(id),
    computed_at TEXT,
    duration_ms INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_calc_project ON calculations(project_id, calc_type, version);

-- ROOMS (Manual J room-by-room)
CREATE TABLE IF NOT EXISTS rooms (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    org_id TEXT NOT NULL REFERENCES organisations(id),
    name TEXT NOT NULL,
    floor_area_sqft REAL,
    ceiling_height REAL,
    above_grade INTEGER DEFAULT 1,
    conditioned INTEGER DEFAULT 1,
    sort_order INTEGER DEFAULT 0,
    meta TEXT DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_rooms_project ON rooms(project_id);

-- FENESTRATION (windows, doors, skylights per room)
CREATE TABLE IF NOT EXISTS fenestration (
    id TEXT PRIMARY KEY,
    room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    org_id TEXT NOT NULL REFERENCES organisations(id),
    label TEXT,
    orientation INTEGER NOT NULL,
    area_sqft REAL NOT NULL,
    u_factor REAL NOT NULL,
    shgc REAL NOT NULL,
    has_interior_shade INTEGER DEFAULT 0,
    frame_type TEXT DEFAULT 'aluminum_thermal_break'
);

CREATE INDEX IF NOT EXISTS idx_fene_room ON fenestration(room_id);

-- EQUIPMENT SELECTIONS
CREATE TABLE IF NOT EXISTS equipment_selections (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    org_id TEXT NOT NULL REFERENCES organisations(id),
    ahri_ref_num TEXT,
    manufacturer TEXT NOT NULL,
    model_outdoor TEXT NOT NULL,
    model_indoor TEXT,
    nominal_tons REAL,
    cooling_btuh INTEGER,
    sensible_btuh INTEGER,
    heating_btuh INTEGER,
    seer2 REAL,
    hspf2 REAL,
    eer REAL,
    is_selected INTEGER DEFAULT 0,
    raw_ahri_data TEXT
);

CREATE INDEX IF NOT EXISTS idx_equip_project ON equipment_selections(project_id);

-- DUCT SYSTEMS
CREATE TABLE IF NOT EXISTS duct_systems (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    org_id TEXT NOT NULL REFERENCES organisations(id),
    air_handler_model TEXT,
    blower_esp_inwg REAL,
    filter_drop_inwg REAL,
    coil_drop_inwg REAL,
    duct_material TEXT DEFAULT 'flex_r8',
    supply_tel_ft REAL,
    return_tel_ft REAL
);

-- DUCT RUNS
CREATE TABLE IF NOT EXISTS duct_runs (
    id TEXT PRIMARY KEY,
    duct_system_id TEXT NOT NULL REFERENCES duct_systems(id) ON DELETE CASCADE,
    org_id TEXT NOT NULL REFERENCES organisations(id),
    room_id TEXT REFERENCES rooms(id),
    label TEXT NOT NULL,
    required_cfm REAL,
    duct_diameter_in REAL,
    velocity_fpm REAL,
    is_critical_path INTEGER DEFAULT 0,
    fittings TEXT DEFAULT '[]'
);

-- CAD DRAWINGS (project floor plans saved from canvas)
CREATE TABLE IF NOT EXISTS cad_drawings (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    org_id TEXT NOT NULL REFERENCES organisations(id),
    name TEXT NOT NULL DEFAULT 'Floor Plan',
    floor_index INTEGER NOT NULL DEFAULT 0,
    canvas_json TEXT NOT NULL,
    thumbnail_key TEXT,
    created_by TEXT NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_cad_project ON cad_drawings(project_id);

-- FILE UPLOADS (R2 references)
CREATE TABLE IF NOT EXISTS file_uploads (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL REFERENCES organisations(id),
    project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
    r2_key TEXT NOT NULL,
    filename TEXT NOT NULL,
    content_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    purpose TEXT NOT NULL DEFAULT 'attachment' CHECK (purpose IN ('attachment', 'underlay', 'export', 'logo', 'avatar')),
    uploaded_by TEXT NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_files_org ON file_uploads(org_id);
CREATE INDEX IF NOT EXISTS idx_files_project ON file_uploads(project_id);

-- SESSIONS (simple token-based auth for D1)
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    org_id TEXT NOT NULL REFERENCES organisations(id),
    token TEXT UNIQUE NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);

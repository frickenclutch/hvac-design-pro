-- ============================================================
-- HVAC Design Pro — D1 (SQLite) Schema
-- Migration 003: Building envelope, rooms, fenestration, equipment
-- ============================================================

-- ROOMS
CREATE TABLE IF NOT EXISTS rooms (
    id              TEXT PRIMARY KEY,
    project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    org_id          TEXT NOT NULL REFERENCES organisations(id),
    drawing_id      TEXT REFERENCES cad_drawings(id) ON DELETE SET NULL,  -- link to CAD floor
    name            TEXT NOT NULL,
    floor_area_sqft REAL,
    ceiling_height  REAL,                          -- feet (IP) or meters (SI)
    volume_cuft     REAL,                          -- computed in app: area * height
    above_grade     INTEGER DEFAULT 1,             -- 1=above, 0=below
    conditioned     INTEGER DEFAULT 1,             -- 1=yes, 0=no
    zone_id         TEXT,                          -- for multi-zone systems
    sort_order      INTEGER DEFAULT 0,
    meta            TEXT DEFAULT '{}',             -- JSON: custom fields
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_rooms_project ON rooms(project_id);
CREATE INDEX idx_rooms_org ON rooms(org_id);
CREATE INDEX idx_rooms_drawing ON rooms(drawing_id);

-- WALLS (envelope segments linked to rooms)
CREATE TABLE IF NOT EXISTS walls (
    id              TEXT PRIMARY KEY,
    room_id         TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    org_id          TEXT NOT NULL REFERENCES organisations(id),
    orientation     INTEGER NOT NULL,              -- degrees 0-359 (N=0, E=90, S=180, W=270)
    length_ft       REAL NOT NULL,
    height_ft       REAL,                          -- defaults to room ceiling_height
    construction    TEXT NOT NULL DEFAULT 'wood_frame'
                    CHECK (construction IN ('wood_frame', 'metal_stud', 'concrete', 'sip', 'icf', 'masonry')),
    r_value         REAL NOT NULL,                 -- composite R-value
    is_exterior     INTEGER NOT NULL DEFAULT 1,    -- 1=exterior, 0=interior/party
    adjacent_room_id TEXT REFERENCES rooms(id),    -- for interior walls
    meta            TEXT DEFAULT '{}'
);

CREATE INDEX idx_walls_room ON walls(room_id);

-- FENESTRATION (windows, doors, skylights linked to walls)
CREATE TABLE IF NOT EXISTS fenestration (
    id                  TEXT PRIMARY KEY,
    room_id             TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    wall_id             TEXT REFERENCES walls(id) ON DELETE SET NULL,
    org_id              TEXT NOT NULL REFERENCES organisations(id),
    type                TEXT NOT NULL DEFAULT 'window'
                        CHECK (type IN ('window', 'door', 'skylight', 'glass_door')),
    label               TEXT,
    orientation         INTEGER NOT NULL,          -- degrees 0-359
    area_sqft           REAL NOT NULL,
    u_factor            REAL NOT NULL,
    shgc                REAL NOT NULL,
    has_interior_shade  INTEGER DEFAULT 0,
    frame_type          TEXT DEFAULT 'aluminum_thermal_break'
                        CHECK (frame_type IN ('aluminum', 'aluminum_thermal_break', 'vinyl', 'wood', 'fiberglass', 'composite')),
    glass_type          TEXT DEFAULT 'double_low_e'
                        CHECK (glass_type IN ('single', 'double', 'double_low_e', 'triple', 'triple_low_e')),
    manufacturer        TEXT,                      -- Andersen, Marvin, Pella, etc.
    model               TEXT,
    meta                TEXT DEFAULT '{}'
);

CREATE INDEX idx_fene_room ON fenestration(room_id);
CREATE INDEX idx_fene_wall ON fenestration(wall_id);

-- EQUIPMENT SELECTIONS (AHRI-linked or manual entry)
CREATE TABLE IF NOT EXISTS equipment_selections (
    id              TEXT PRIMARY KEY,
    project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    org_id          TEXT NOT NULL REFERENCES organisations(id),
    system_type     TEXT NOT NULL DEFAULT 'split_ac'
                    CHECK (system_type IN ('split_ac', 'heat_pump', 'mini_split', 'packaged', 'furnace', 'boiler', 'geothermal', 'ptac')),
    ahri_ref_num    TEXT,                          -- AHRI certificate reference number
    manufacturer    TEXT NOT NULL,
    model_outdoor   TEXT NOT NULL,
    model_indoor    TEXT,
    model_coil      TEXT,                          -- indoor coil model (if separate)
    nominal_tons    REAL,
    cooling_btuh    INTEGER,
    sensible_btuh   INTEGER,
    heating_btuh    INTEGER,
    seer2           REAL,
    hspf2           REAL,
    eer             REAL,
    afue            REAL,                          -- for furnaces/boilers
    cfm_per_ton     REAL DEFAULT 400,
    refrigerant     TEXT DEFAULT 'R-410A',
    is_selected     INTEGER DEFAULT 0,             -- 1=chosen for this project
    raw_ahri_data   TEXT,                          -- JSON: full AHRI certificate data
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_equip_project ON equipment_selections(project_id);
CREATE INDEX idx_equip_ahri ON equipment_selections(ahri_ref_num);
CREATE INDEX idx_equip_org ON equipment_selections(org_id);

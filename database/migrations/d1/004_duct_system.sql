-- ============================================================
-- HVAC Design Pro — D1 (SQLite) Schema
-- Migration 004: Duct systems, runs, fittings (Manual D)
-- ============================================================

-- DUCT SYSTEMS (one per air handler per project)
CREATE TABLE IF NOT EXISTS duct_systems (
    id                TEXT PRIMARY KEY,
    project_id        TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    org_id            TEXT NOT NULL REFERENCES organisations(id),
    equipment_id      TEXT REFERENCES equipment_selections(id),  -- links to air handler
    name              TEXT NOT NULL DEFAULT 'Primary',
    air_handler_model TEXT,
    blower_esp_inwg   REAL,                        -- external static pressure
    filter_drop_inwg  REAL,
    coil_drop_inwg    REAL,
    -- available_sp computed in app: blower_esp - filter_drop - coil_drop
    duct_material     TEXT DEFAULT 'flex_r8'
                      CHECK (duct_material IN ('flex_r4', 'flex_r6', 'flex_r8', 'sheet_metal', 'fiberboard', 'duct_board')),
    supply_tel_ft     REAL,                        -- total effective length, supply side
    return_tel_ft     REAL,                        -- total effective length, return side
    -- friction_rate computed in app: available_sp / ((supply_tel + return_tel) / 100)
    design_cfm        REAL,                        -- total system CFM
    created_at        TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_duct_project ON duct_systems(project_id);
CREATE INDEX idx_duct_org ON duct_systems(org_id);

-- DUCT RUNS (one per supply/return register, links to room)
CREATE TABLE IF NOT EXISTS duct_runs (
    id              TEXT PRIMARY KEY,
    duct_system_id  TEXT NOT NULL REFERENCES duct_systems(id) ON DELETE CASCADE,
    room_id         TEXT REFERENCES rooms(id),
    org_id          TEXT NOT NULL REFERENCES organisations(id),
    label           TEXT NOT NULL,
    run_type        TEXT NOT NULL DEFAULT 'supply'
                    CHECK (run_type IN ('supply', 'return', 'trunk', 'branch', 'plenum')),
    required_cfm    REAL,
    duct_shape      TEXT DEFAULT 'round'
                    CHECK (duct_shape IN ('round', 'rectangular', 'oval')),
    duct_diameter_in REAL,                         -- for round ducts
    duct_width_in   REAL,                          -- for rectangular ducts
    duct_height_in  REAL,                          -- for rectangular ducts
    actual_length_ft REAL,                         -- physical duct run length
    equiv_length_ft REAL,                          -- total with fittings
    velocity_fpm    REAL,
    pressure_drop   REAL,                          -- inches w.g.
    is_critical_path INTEGER DEFAULT 0,
    fittings        TEXT DEFAULT '[]',             -- JSON: [{type, qty, eq_ft_each}]
    sort_order      INTEGER DEFAULT 0,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_runs_system ON duct_runs(duct_system_id);
CREATE INDEX idx_runs_room ON duct_runs(room_id);
CREATE INDEX idx_runs_org ON duct_runs(org_id);

-- DUCT FITTINGS LIBRARY (reference data — standard equivalent lengths)
CREATE TABLE IF NOT EXISTS duct_fittings_library (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,                  -- e.g., '90-degree elbow', 'Tee branch'
    category        TEXT NOT NULL,                  -- elbow | tee | transition | takeoff | damper
    equiv_length_ft REAL NOT NULL,                  -- ACCA Table 7 value
    applicable_shapes TEXT DEFAULT 'round,rectangular', -- comma-separated
    notes           TEXT
);

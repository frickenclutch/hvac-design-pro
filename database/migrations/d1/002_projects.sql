-- ============================================================
-- HVAC Design Pro — D1 (SQLite) Schema
-- Migration 002: Projects, calculations, CAD drawings
-- ============================================================

-- PROJECTS
CREATE TABLE IF NOT EXISTS projects (
    id            TEXT PRIMARY KEY,
    org_id        TEXT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    name          TEXT NOT NULL,
    address       TEXT,
    city          TEXT,
    state         TEXT,
    zip           TEXT,
    country       TEXT NOT NULL DEFAULT 'US',
    climate_zone  TEXT,                            -- ASHRAE climate zone (e.g., '5A')
    standard      TEXT NOT NULL DEFAULT 'ACCA'     -- ACCA | ASHRAE | EN | CSA
                  CHECK (standard IN ('ACCA', 'ASHRAE', 'EN', 'CSA')),
    status        TEXT NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active', 'archived', 'template')),
    created_by    TEXT NOT NULL REFERENCES users(id),
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_projects_org ON projects(org_id);
CREATE INDEX idx_projects_status ON projects(org_id, status);
CREATE INDEX idx_projects_updated ON projects(org_id, updated_at DESC);

-- CALCULATIONS (versioned Manual J / D / S results)
CREATE TABLE IF NOT EXISTS calculations (
    id             TEXT PRIMARY KEY,
    project_id     TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    org_id         TEXT NOT NULL REFERENCES organisations(id),
    calc_type      TEXT NOT NULL                   -- manual_j | manual_d | manual_s | cost_estimate
                   CHECK (calc_type IN ('manual_j', 'manual_d', 'manual_s', 'cost_estimate', 'energy_model')),
    version        INTEGER NOT NULL DEFAULT 1,
    inputs         TEXT NOT NULL,                  -- JSON: room definitions, weather, envelope
    outputs        TEXT,                           -- JSON: loads, equipment sizing, duct sizing
    status         TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'running', 'complete', 'failed')),
    engine_version TEXT NOT NULL,                  -- e.g., 'manualJ-ts-1.0' or 'manual_d-py-1.0'
    computed_by    TEXT REFERENCES users(id),
    computed_at    TEXT,
    duration_ms    INTEGER,
    created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_calc_project ON calculations(project_id, calc_type, version DESC);
CREATE INDEX idx_calc_org ON calculations(org_id);

-- CAD DRAWINGS (canvas state per floor per project)
CREATE TABLE IF NOT EXISTS cad_drawings (
    id             TEXT PRIMARY KEY,
    project_id     TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    org_id         TEXT NOT NULL REFERENCES organisations(id),
    name           TEXT NOT NULL DEFAULT 'Untitled',
    floor_index    INTEGER NOT NULL DEFAULT 0,
    canvas_json    TEXT,                           -- Fabric.js serialized canvas (can be large)
    thumbnail_key  TEXT,                           -- R2 key for preview image
    version        INTEGER NOT NULL DEFAULT 1,     -- optimistic concurrency control
    created_by     TEXT REFERENCES users(id),
    created_at     TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_drawings_project ON cad_drawings(project_id);
CREATE INDEX idx_drawings_org ON cad_drawings(org_id);
CREATE UNIQUE INDEX idx_drawings_floor ON cad_drawings(project_id, floor_index);

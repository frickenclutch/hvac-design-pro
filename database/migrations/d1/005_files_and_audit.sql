-- ============================================================
-- HVAC Design Pro — D1 (SQLite) Schema
-- Migration 005: File uploads (R2 metadata), audit log, revision history
-- ============================================================

-- FILE UPLOADS (R2 metadata tracker)
CREATE TABLE IF NOT EXISTS file_uploads (
    id              TEXT PRIMARY KEY,
    org_id          TEXT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    project_id      TEXT REFERENCES projects(id) ON DELETE SET NULL,  -- null = org-level asset
    r2_key          TEXT NOT NULL UNIQUE,           -- R2 object key: {orgId}/{projectId}/{id}.{ext}
    filename        TEXT NOT NULL,                  -- original filename
    content_type    TEXT NOT NULL,                  -- MIME type
    size_bytes      INTEGER NOT NULL,
    purpose         TEXT NOT NULL DEFAULT 'attachment'
                    CHECK (purpose IN ('floor_plan', 'underlay', '3d_model', 'photo', 'document', 'thumbnail', 'pdf_export', 'attachment')),
    uploaded_by     TEXT REFERENCES users(id),
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_uploads_org ON file_uploads(org_id);
CREATE INDEX idx_uploads_project ON file_uploads(project_id);
CREATE INDEX idx_uploads_r2key ON file_uploads(r2_key);

-- AUDIT LOG (immutable append-only trail for compliance / PE stamp)
CREATE TABLE IF NOT EXISTS audit_log (
    id              TEXT PRIMARY KEY,
    org_id          TEXT NOT NULL REFERENCES organisations(id),
    user_id         TEXT REFERENCES users(id),
    project_id      TEXT REFERENCES projects(id),
    action          TEXT NOT NULL,                  -- e.g., 'calc.manual_j.run', 'drawing.save', 'project.create'
    entity_type     TEXT,                           -- 'project', 'calculation', 'drawing', 'equipment', etc.
    entity_id       TEXT,                           -- ID of affected entity
    detail          TEXT,                           -- JSON: action-specific data (inputs hash, diff summary)
    ip_address      TEXT,
    user_agent      TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_audit_org ON audit_log(org_id);
CREATE INDEX idx_audit_project ON audit_log(project_id);
CREATE INDEX idx_audit_user ON audit_log(user_id);
CREATE INDEX idx_audit_time ON audit_log(created_at DESC);
CREATE INDEX idx_audit_action ON audit_log(action);

-- DRAWING REVISIONS (version history for CAD snapshots)
CREATE TABLE IF NOT EXISTS drawing_revisions (
    id              TEXT PRIMARY KEY,
    drawing_id      TEXT NOT NULL REFERENCES cad_drawings(id) ON DELETE CASCADE,
    org_id          TEXT NOT NULL REFERENCES organisations(id),
    version         INTEGER NOT NULL,
    canvas_json     TEXT,                           -- full Fabric.js snapshot (or R2 key for large drawings)
    r2_snapshot_key TEXT,                           -- if canvas_json exceeds D1 row limit (~1MB), store in R2
    change_summary  TEXT,                           -- auto-generated or user-provided
    created_by      TEXT REFERENCES users(id),
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX idx_revisions_version ON drawing_revisions(drawing_id, version);
CREATE INDEX idx_revisions_org ON drawing_revisions(org_id);

-- CALCULATION AUDIT SNAPSHOTS (inputs/outputs hash chain for PE stamp)
CREATE TABLE IF NOT EXISTS calc_snapshots (
    id              TEXT PRIMARY KEY,
    calculation_id  TEXT NOT NULL REFERENCES calculations(id) ON DELETE CASCADE,
    org_id          TEXT NOT NULL REFERENCES organisations(id),
    inputs_hash     TEXT NOT NULL,                  -- SHA-256 of inputs JSON (tamper detection)
    outputs_hash    TEXT NOT NULL,                  -- SHA-256 of outputs JSON
    snapshot_json   TEXT,                           -- frozen copy of inputs + outputs at sign-off
    signed_by       TEXT REFERENCES users(id),      -- PE who approved
    signed_at       TEXT,
    pe_license      TEXT,                           -- PE license number at time of signature
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_snapshots_calc ON calc_snapshots(calculation_id);
CREATE INDEX idx_snapshots_org ON calc_snapshots(org_id);

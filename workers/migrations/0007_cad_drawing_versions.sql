-- 0007_cad_drawing_versions.sql — append-only version snapshots for CAD drawings.
--
-- WHY (the architectural decision, not just the schema):
--   The audit_log is the right place to answer "who did what when" for
--   metadata-shaped questions. For CAD, the interesting forensic question
--   is "what did the duct layout actually look like at 2:47 PM?" — and
--   only the canvas state can answer that.
--
--   Throttling CAD events in audit_log to 1 row per drawing per 60s keeps
--   the operator feed clean (see cad.ts PUT handler). The full forensic
--   trail lives here. Every save snapshots the canvas state with author +
--   timestamp + version number, so any prior moment can be loaded back
--   into the canvas, diffed, or used to regenerate a Manual D PDF at a
--   specific historical state — exactly the capability permit-grade
--   engineering work needs when a future dispute requires reconstructing
--   "what the drawing said the day the permit was filed."
--
-- DESIGN NOTES:
--   - APPEND-ONLY. No UPDATE, no DELETE handlers. Retention is enforced
--     at the tenant level (future Phase 3 — e.g., keep forever for
--     permit-submitted projects, prune drafts after 90d).
--   - org_id is denormalized so retention pruning and access-control
--     queries don't always need a join through cad_drawings.
--   - version_number monotonically increases per (drawing_id). v1 is the
--     initial POST snapshot; every PUT after appends v2, v3...
--   - size_bytes captured at write time so the version list UI can show
--     payload size without parsing the JSON.
--   - thumbnail_key is the R2 key for an optional PNG thumbnail of that
--     version's state. NULL until the future thumbnail-generation worker
--     ships; preserves the column shape now so the table doesn't need
--     migrating again.

CREATE TABLE IF NOT EXISTS cad_drawing_versions (
    id              TEXT PRIMARY KEY,
    drawing_id      TEXT NOT NULL REFERENCES cad_drawings(id) ON DELETE CASCADE,
    project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    org_id          TEXT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    version_number  INTEGER NOT NULL,
    canvas_json     TEXT NOT NULL,
    size_bytes      INTEGER NOT NULL,
    thumbnail_key   TEXT,
    author_user_id  TEXT REFERENCES users(id),
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Listing versions for a drawing — newest first. Composite index keeps
-- the cursor scan cheap as a single drawing accumulates many versions.
CREATE INDEX IF NOT EXISTS idx_cad_versions_drawing_time
  ON cad_drawing_versions(drawing_id, created_at DESC);

-- Cross-tenant scan for retention / cost reporting at the platform level.
CREATE INDEX IF NOT EXISTS idx_cad_versions_org_time
  ON cad_drawing_versions(org_id, created_at DESC);

-- (drawing_id, version_number) is a natural unique key — protects against
-- accidental double-inserts when the worker retries on transient errors.
CREATE UNIQUE INDEX IF NOT EXISTS idx_cad_versions_drawing_num
  ON cad_drawing_versions(drawing_id, version_number);

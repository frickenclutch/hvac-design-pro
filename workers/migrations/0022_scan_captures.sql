-- 0022_scan_captures.sql — LiDAR / field-capture scan records (Phase 1 of the
-- scan-to-permit path, docs/LIDAR_FIELD_CAPTURE_SPEC_2026-08-05.md).
--
-- WHY
-- A RoomPlan capture is the first intake that MEASURES the building instead of
-- ingesting a drawing of it. The geometry itself lives in the CAD drawing
-- (stamped provenance:'scan' + captureId per entity); this table is the
-- capture's server-side record — who scanned what project with which payload,
-- what the parser saw, and whether an engineer confirmed it into the drawing.
-- It is the anchor of the measurement audit chain: permit report → calculation
-- snapshot → CAD entities → scan_captures row → R2 payload.
--
-- WHAT
-- scan_captures — one row per uploaded capture.
--   source   roomplan_json | usdz | app_bundle | e57 | ply  (only roomplan_json
--            is parsed today; the rest are accepted-and-stored tiers per the
--            spec — no auto-vectorization promise)
--   status   uploaded  = payload in R2, not parsed client-side
--            parsed    = client parser produced a summary (stored here)
--            confirmed = an engineer reviewed the ghost and applied geometry
--            discarded = reviewer rejected it
--            Rows only ever advance status; payload, summary, and provenance
--            fields are never rewritten (append-only in spirit, like
--            calculations).
--   heading_deg  compass heading at capture (Phase-2 capture app); NULL for
--            file imports, where north alignment happened in review.
--   device_id    capture_devices.id once the Phase-3 registry lands; NULL for
--            file imports. TEXT column now so Phase 3 is additive.
--   r2_key   single payload object per capture (bundles that carry multiple
--            files are a Phase-3 concern; adding a second column then is
--            additive, a JSON list today is speculative).
--
-- NO foreign key clauses — deliberate. D1 doesn't enforce FKs on insert but
-- DOES honor ON DELETE CASCADE during table rebuilds (the 0018 trap), and 0015
-- already dropped FKs from audit_log for the same reason. Integrity is
-- app-layer: routes/scans.ts verifies the project belongs to the session org
-- before insert, and every query is org-scoped (STRICT_TABLES-enforced).
--
-- Org-owned (org_id NOT NULL) and registered in the tenant-scoping guard's
-- STRICT_TABLES in this same commit — every query carries `AND org_id = ?`
-- bound to the session org.
--
-- WHY CREATE-only here: genuinely new, forward-authored table (same class as
-- 0009/0019/0020). CREATE TABLE IF NOT EXISTS is a no-op on re-apply.

CREATE TABLE IF NOT EXISTS scan_captures (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    device_id TEXT,
    source TEXT NOT NULL CHECK (source IN ('roomplan_json', 'usdz', 'app_bundle', 'e57', 'ply')),
    r2_key TEXT NOT NULL,
    filename TEXT,
    size_bytes INTEGER NOT NULL DEFAULT 0,
    parsed_summary TEXT,
    engine_version TEXT,
    status TEXT NOT NULL DEFAULT 'uploaded' CHECK (status IN ('uploaded', 'parsed', 'confirmed', 'discarded')),
    heading_deg REAL,
    captured_at TEXT,
    created_by TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_scan_captures_org ON scan_captures(org_id);
CREATE INDEX IF NOT EXISTS idx_scan_captures_project ON scan_captures(org_id, project_id);

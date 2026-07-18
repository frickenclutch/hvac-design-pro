-- 0018_manual_n_calc_type.sql — widen the calculations calc_type CHECK to
-- allow ACCA Manual N (commercial load calculation) records.
--
-- Unit N0 of the Manual N onboarding program (docs/MANUAL_N_ONBOARDING_PLAN_
-- 2026-07-17.md §3, §9). Without this, the first `POST /api/calculations`
-- carrying calcType='MANUAL_N' throws SQLITE_CONSTRAINT_CHECK — D1 enforces
-- CHECK constraints (proven in prod by the 0016 verification_codes incident).
--
-- SQLite cannot alter a CHECK in place — full table rebuild (same
-- create-copy-drop-rename pattern as 0015/0016). UNLIKE those two,
-- `calculations` is the HOT APPEND-ONLY AUDIT TABLE: every Manual J/D/S/AED
-- run in production history lives here, rows are never rewritten, and losing
-- them is unrecoverable by design. The deploy runbook is therefore mandatory:
--
--   1. REHEARSE first: apply to a local D1 copy (`wrangler d1 execute
--      hvac-design-pro --local --file=./migrations/0018_manual_n_calc_type.sql`)
--      and against the vitest-pool-workers/Miniflare harness if configured.
--   2. BACKUP before prod: `wrangler d1 export hvac-design-pro
--      --output=backup_pre_0018.sql` — a mid-copy failure without this
--      export is unrecoverable.
--   3. Apply in an off-hours window (manual-deploy cadence).
--   4. VERIFY after: `SELECT COUNT(*) FROM calculations;` matches the
--      pre-migration count, and `PRAGMA index_list('calculations');` shows
--      idx_calc_project.
--
-- Column set, FKs, and defaults are copied verbatim from 0001_init.sql:99-113.
-- idx_calc_project (0001:115) is the table's only index; recreated below.
-- Deliberately NO other schema change rides along (one concern per rebuild).

CREATE TABLE calculations_new (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    org_id TEXT NOT NULL REFERENCES organisations(id),
    calc_type TEXT NOT NULL CHECK (calc_type IN ('MANUAL_J', 'MANUAL_D', 'MANUAL_S', 'AED', 'MANUAL_N')),
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

INSERT INTO calculations_new
    (id, project_id, org_id, calc_type, version, inputs, outputs, status,
     engine_version, computed_by, computed_at, duration_ms, created_at)
SELECT
    id, project_id, org_id, calc_type, version, inputs, outputs, status,
    engine_version, computed_by, computed_at, duration_ms, created_at
FROM calculations;

DROP TABLE calculations;

ALTER TABLE calculations_new RENAME TO calculations;

CREATE INDEX IF NOT EXISTS idx_calc_project ON calculations(project_id, calc_type, version);

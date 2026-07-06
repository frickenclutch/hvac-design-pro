-- 0015_audit_log_drop_fks.sql — remove ALL foreign keys from audit_log.
--
-- WHY (root cause of the "projects won't delete" bug, found 2026-07-02):
-- D1 ENFORCES foreign keys. audit_log.project_id carried
-- `REFERENCES projects(id)` with NO ON DELETE action (0006/0008), so any
-- project with at least one audit row — i.e. every project created since
-- the audit middleware shipped (project.create writes a row) — made
-- `DELETE FROM projects` throw SQLITE_CONSTRAINT_FOREIGNKEY. The worker
-- had no error handler, so the browser saw a CORS-less 500 and surfaced
-- it as "Unable to reach the server", while the frontend's local cache
-- purge made the project "resurrect" on the next load.
--
-- The FKs were wrong in principle, not just in effect: audit_log is
-- APPEND-ONLY and its rows are deliberately denormalized (entity_label,
-- before/after snapshots) precisely so they stay meaningful AFTER the
-- entity they describe is deleted (see 0006 header). A referential
-- constraint tying a forensic record to the continued existence of its
-- subject inverts that design. The same applies to org_id/user_id:
-- ON DELETE SET NULL would destroy forensic attribution; NO ACTION blocks
-- legitimate deletes. An audit table references the PAST — no FKs.
--
-- Also fixed here: org_id becomes NULLABLE. writeAuthAudit() logs
-- pre-identity events (failed logins, unknown-email password resets) with
-- orgId=null; the NOT NULL constraint made those INSERTs fail silently
-- (swallowed by design), leaving SOC 2-relevant gaps in the auth trail.
--
-- SQLite cannot drop constraints in place — full table rebuild:
-- new table (no REFERENCES) -> copy -> drop -> rename -> re-index.
-- Explicit column lists on both sides make the copy independent of the
-- physical column order (production's order differs from 0008's because
-- its columns arrived via ALTER TABLE ADD COLUMN).

CREATE TABLE audit_log_new (
    id                  TEXT PRIMARY KEY,
    org_id              TEXT,
    user_id             TEXT,
    project_id          TEXT,
    action              TEXT NOT NULL,
    entity_type         TEXT,
    entity_id           TEXT,
    detail              TEXT,
    ip_address          TEXT,
    user_agent          TEXT,
    target_org_id       TEXT,
    entity_label        TEXT,
    method              TEXT,
    path                TEXT,
    status_code         INTEGER,
    duration_ms         INTEGER,
    before_value        TEXT,
    after_value         TEXT,
    actor_role          TEXT,
    is_platform_action  INTEGER NOT NULL DEFAULT 0,
    request_id          TEXT,
    created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO audit_log_new
    (id, org_id, user_id, project_id, action, entity_type, entity_id,
     detail, ip_address, user_agent, target_org_id, entity_label, method,
     path, status_code, duration_ms, before_value, after_value, actor_role,
     is_platform_action, request_id, created_at)
SELECT
     id, org_id, user_id, project_id, action, entity_type, entity_id,
     detail, ip_address, user_agent, target_org_id, entity_label, method,
     path, status_code, duration_ms, before_value, after_value, actor_role,
     is_platform_action, request_id, created_at
FROM audit_log;

DROP TABLE audit_log;

ALTER TABLE audit_log_new RENAME TO audit_log;

-- Re-create the access-pattern indexes (dropped with the old table).
CREATE INDEX IF NOT EXISTS idx_audit_org_time        ON audit_log(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_target_org_time ON audit_log(target_org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_user_time       ON audit_log(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_entity          ON audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_action_time     ON audit_log(action, created_at DESC);

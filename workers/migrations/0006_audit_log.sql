-- 0006_audit_log.sql — extend audit_log into the platform-wide accountability spine.
--
-- SCHEMA-RECONCILIATION NOTE (2026-05-15): the original header claimed the
-- bare audit_log table "existed from migration 0001". It did NOT — it was
-- never in any migration; production got it via an out-of-band CREATE. On
-- a fresh rebuild the ALTER TABLE statements below would fail (no table to
-- alter). Fixed by self-creating the base table here, idempotently, before
-- the ALTERs. On production the table already exists so CREATE TABLE IF
-- NOT EXISTS no-ops and the ALTERs were already applied — zero change.
--
-- This migration:
--   0. Self-creates the base audit_log table if absent (reconciliation).
--   1. Adds columns we need to capture WHO did WHAT to WHICH entity, including
--      cross-tenant context (target_org_id) for L0 admin and Permit Authority
--      actions, before/after diffs for edits, and the HTTP-level metadata
--      every action carries.
--   2. Adds composite indexes for the access patterns we know we'll hit:
--        - tenant audit feed (org_id ordered by time)
--        - cross-tenant audit feed when caller is the target (target_org_id)
--        - per-user history (user_id)
--        - drill-through to a specific entity (entity_type, entity_id)
--        - filtering by semantic action ("project.create", "user.role_changed")
--
-- New columns are nullable / default-zero so the base INSERT shape stays valid.
--
-- The audit_log is APPEND-ONLY. There are no UPDATE / DELETE handlers that
-- touch it — the integrity of the log depends on this. If a future feature
-- ever needs to "redact" a row (e.g. GDPR right-to-erasure), do it by adding
-- a `redacted_at` column rather than DELETE.

-- Base table — the 11-column shape the ALTERs below extend. Matches the
-- schema production was manually given out-of-band. Idempotent: no-op when
-- the table already exists (production), creates it on a fresh rebuild so
-- the subsequent ALTERs succeed.
CREATE TABLE IF NOT EXISTS audit_log (
    id          TEXT PRIMARY KEY,
    org_id      TEXT NOT NULL REFERENCES organisations(id),
    user_id     TEXT REFERENCES users(id),
    project_id  TEXT REFERENCES projects(id),
    action      TEXT NOT NULL,
    entity_type TEXT,
    entity_id   TEXT,
    detail      TEXT,
    ip_address  TEXT,
    user_agent  TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

ALTER TABLE audit_log ADD COLUMN target_org_id TEXT;
ALTER TABLE audit_log ADD COLUMN entity_label TEXT;
ALTER TABLE audit_log ADD COLUMN method TEXT;
ALTER TABLE audit_log ADD COLUMN path TEXT;
ALTER TABLE audit_log ADD COLUMN status_code INTEGER;
ALTER TABLE audit_log ADD COLUMN duration_ms INTEGER;
ALTER TABLE audit_log ADD COLUMN before_value TEXT;
ALTER TABLE audit_log ADD COLUMN after_value TEXT;
ALTER TABLE audit_log ADD COLUMN actor_role TEXT;
ALTER TABLE audit_log ADD COLUMN is_platform_action INTEGER NOT NULL DEFAULT 0;
ALTER TABLE audit_log ADD COLUMN request_id TEXT;

-- Tenant audit feed — ordered scan by org and time.
CREATE INDEX IF NOT EXISTS idx_audit_org_time ON audit_log(org_id, created_at DESC);

-- Cross-tenant audit feed — for actions performed AGAINST a tenant by a
-- different actor (L0 admin, permit authority deciding on a submission).
CREATE INDEX IF NOT EXISTS idx_audit_target_org_time ON audit_log(target_org_id, created_at DESC);

-- Per-user activity history.
CREATE INDEX IF NOT EXISTS idx_audit_user_time ON audit_log(user_id, created_at DESC);

-- Drill-through from "what happened to this project / user / calc".
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity_type, entity_id);

-- Filtering by action verb for the audit log UI dropdown.
CREATE INDEX IF NOT EXISTS idx_audit_action_time ON audit_log(action, created_at DESC);

-- 0008_schema_reconciliation.sql — codify out-of-band schema drift.
--
-- WHY THIS EXISTS
-- A May-2026 full-codebase audit found two objects that exist in the
-- production D1 but were in NO migration file — they had been applied
-- out-of-band (manual `wrangler d1 execute`):
--
--   1. users.is_platform_admin   — read by authMiddleware on EVERY authed
--                                   request. A fresh rebuild from the
--                                   migrations would 500 on first login.
--   2. audit_log (base table)    — 0006 ALTERs it; on a fresh rebuild
--                                   0006 would fail (nothing to alter).
--
-- Production was unaffected (both objects present), but the platform was
-- NOT reproducible: a new environment / disaster-recovery rebuild from
-- migrations alone was broken. SOC 2 CC7.1/CC7.2 and basic DR hygiene
-- require the migrations to be the single source of truth for schema.
--
-- THE FIX (three coordinated, production-safe edits):
--   * 0001_init.sql  — added `is_platform_admin INTEGER NOT NULL DEFAULT 0`
--                       to the users CREATE TABLE. 0001 is entirely
--                       `CREATE TABLE IF NOT EXISTS`, so re-applying it to
--                       production is a verified no-op (the existing table
--                       is left untouched; production already has the
--                       column from the out-of-band ALTER). A fresh
--                       rebuild now gets the column from 0001.
--   * 0006_audit_log.sql — now self-creates the base audit_log table
--                       (CREATE TABLE IF NOT EXISTS) before its ALTERs, so
--                       a fresh rebuild succeeds; no-op on production.
--   * 0008 (this file) — the explicit reconciliation record + an
--                       idempotent final safety net asserting the FULL
--                       current audit_log shape. Safe to run anywhere,
--                       any number of times.
--
-- IDEMPOTENCY: every statement here is CREATE ... IF NOT EXISTS. Running
-- this file against production (where everything already exists) changes
-- nothing. Running it against a fresh DB after 0001-0007 is also a no-op
-- because those migrations now create everything correctly — this file is
-- the belt-and-suspenders, not the primary fix.
--
-- NOTE on is_platform_admin: SQLite has no `ADD COLUMN IF NOT EXISTS`, so
-- this file cannot defensively re-add that column without erroring where
-- it already exists. Its reproducibility fix lives entirely in the 0001
-- edit. This file documents the gap and guarantees audit_log parity.

-- Full current audit_log shape (base 0001-era columns + every 0006 column).
-- If a future migration drifts the table, re-running this asserts the
-- canonical shape on any environment that somehow lacks the table.
CREATE TABLE IF NOT EXISTS audit_log (
    id                  TEXT PRIMARY KEY,
    org_id              TEXT NOT NULL REFERENCES organisations(id),
    user_id             TEXT REFERENCES users(id),
    project_id          TEXT REFERENCES projects(id),
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

-- Re-assert the audit_log access-pattern indexes (idempotent). These also
-- exist from 0006 on production; harmless to re-run, and guarantees a
-- bare-table rebuild path still gets them.
CREATE INDEX IF NOT EXISTS idx_audit_org_time        ON audit_log(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_target_org_time ON audit_log(target_org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_user_time       ON audit_log(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_entity          ON audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_action_time     ON audit_log(action, created_at DESC);

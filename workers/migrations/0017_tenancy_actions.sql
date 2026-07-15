-- 0017_tenancy_actions.sql
-- ============================================================================
-- Three adjacent tenancy features sharing one migration (the last three
-- Action-lab units: Subdivision tree, Reparent user, Impersonate org):
--
--  A) Subdivision tree — organisations.parent_org_id
--     A tenant admin can declare child orgs (DBAs, subsidiaries) under their
--     tenant. Single-level only: an org with a parent cannot itself become a
--     parent (enforced in routes/org.ts, not in schema — SQLite ALTER can't
--     add a table CHECK). Children are full organisations rows, so every
--     existing org_id-scoped query works against them unchanged.
--
--  B) Reparent user — org_invites.kind
--     A consent-based pull of a "fragmented" user (someone who registered
--     into their own solo org) into an inviting tenant. Rides the existing
--     org_invites machinery; kind='reparent' rows are surfaced to the
--     TARGET user in-app (GET /api/auth/transfers) and consumed by the
--     authenticated accept endpoint — never by the new-user redeem path,
--     which filters kind='new_user'.
--
--  C) Impersonate org — sessions.is_impersonation
--     L0 platform admin mints a short-lived, access-only (no refresh token),
--     READ-ONLY session whose org_id is the target tenant. The flag rides
--     the session row so authMiddleware can surface it on every request and
--     the mutation guard in index.ts can enforce read-only.
-- ============================================================================

-- ── A) Subdivision tree ─────────────────────────────────────────────────────

ALTER TABLE organisations ADD COLUMN parent_org_id TEXT REFERENCES organisations(id);

CREATE INDEX IF NOT EXISTS idx_orgs_parent
  ON organisations(parent_org_id)
  WHERE parent_org_id IS NOT NULL;

-- ── B) Reparent user ────────────────────────────────────────────────────────

ALTER TABLE org_invites ADD COLUMN kind TEXT NOT NULL DEFAULT 'new_user'
  CHECK (kind IN ('new_user', 'reparent'));

-- ── C) Impersonate org ──────────────────────────────────────────────────────

ALTER TABLE sessions ADD COLUMN is_impersonation INTEGER NOT NULL DEFAULT 0;

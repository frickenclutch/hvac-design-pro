-- 0009_user_status.sql — soft-deactivation lifecycle for users.
--
-- WHY
-- DELETE /api/org/users/:id (and the L0 equivalent) HARD-deleted the
-- users row. D1 does not enforce foreign keys unless explicitly enabled,
-- so projects.created_by / cad_drawings.created_by / calculations
-- .computed_by were SILENTLY orphaned — dangling pointers, no error, the
-- project list just rendered a null creator. For a platform courting
-- institutions that produce permit-binding documents, "we removed an
-- engineer and lost the provenance of 40 projects" is a trust-ending
-- event. Removal must be non-destructive: the row stays, attribution is
-- preserved, the person simply loses access.
--
-- `status` drives the auth gate: a deactivated user is rejected at every
-- session-mint and token-validation point, and their existing sessions
-- are purged on deactivation so a live 30-day token can't outlive the
-- access change (the JML "logged-in user keeps access until expiry"
-- gotcha).
--
-- WHY ALTER-ONLY (not also edited into 0001 like the 0006/0008 work):
-- the is_platform_admin / audit_log edits to 0001 were REMEDIATION for
-- schema that existed in production via out-of-band CREATE with NO
-- migration anywhere — 0001 (CREATE TABLE IF NOT EXISTS) was the only
-- production-safe home. `status` is the opposite case: a genuinely new
-- column, authored as a proper forward migration. Adding it to 0001 too
-- would break a fresh rebuild — 0001 would create the column, then this
-- ALTER would fail "duplicate column". Owning it solely here is the
-- textbook-correct, conflict-free path: fresh rebuild runs 0001 (no
-- status) → 0009 ALTER adds it; production runs 0009 ALTER adds it.
-- Both paths identical, no ordering hazard.
--
-- SAFETY: additive, NOT NULL DEFAULT 'active' → every existing user row
-- becomes 'active' atomically. No existing behavior changes until the
-- worker code that reads `status` is deployed (which happens AFTER this
-- migration is applied to production — strict ordering, this column
-- must exist before any query references it or every auth request 500s).

ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active';

-- Partial-ish filter index: the hot auth path filters users to
-- status='active' on every request. The composite keeps the
-- email+status and id+status lookups index-covered.
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);
CREATE INDEX IF NOT EXISTS idx_users_email_status ON users(email, status);

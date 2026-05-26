-- 0010_permit_lifecycle.sql
-- ============================================================================
-- Permit Authority rail — Slice B: full lifecycle state machine.
--
-- 0005 shipped the forward-only state machine:
--    submitted → under_review → (approved | denied | changes_requested | withdrawn)
--
-- Real AHJs need more: a permit can be SUSPENDED pending re-inspection,
-- REVOKED for code violations or fraud, or EXPIRE if work doesn't start
-- within the validity window. None of those terminal-after-approved states
-- existed; once 'approved' the row was frozen and there was no path to
-- represent the permit going stale or being pulled.
--
-- This migration adds:
--   1. Three new statuses: 'revoked', 'suspended', 'expired'. Suspended is
--      re-enterable (suspended → approved via 'reinstate'); revoked and
--      expired are terminal.
--   2. Lifecycle timestamps: expires_at, suspended_at, revoked_at.
--   3. Resubmission chain: parent_submission_id self-FK so a fresh
--      submission after denial / changes_requested links back to its
--      predecessor for thread-of-history rendering.
--   4. A dedicated permit_status_transitions table — append-only forensic
--      record of every status change with actor + reason. audit_log
--      already captures these via setAudit(), but a normalised dedicated
--      table makes the timeline query a single indexed read instead of a
--      JSON scan of audit_log.detail.
--
-- ----------------------------------------------------------------------------
-- WHY THE TABLE-REBUILD
-- ----------------------------------------------------------------------------
-- SQLite (and therefore D1) cannot ALTER a CHECK constraint in place. The
-- only correct path is the 12-step procedure documented at
-- https://www.sqlite.org/lang_altertable.html#otheralter — recreate the
-- table with the widened CHECK, copy rows, drop old, rename new, recreate
-- indexes. We're doing exactly that.
--
-- Foreign keys: the permit_submission_comments table has an ON DELETE
-- CASCADE pointing at permit_submissions(id). SQLite preserves data
-- (comments are by submission_id which we preserve verbatim), but the
-- foreign key relation reattaches after RENAME because SQLite tracks FK
-- targets by name, not by rowid.
-- ============================================================================

-- ── A) Rebuild permit_submissions with widened status + new columns ───────

CREATE TABLE permit_submissions_new (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

    submitter_org_id TEXT NOT NULL REFERENCES organisations(id),
    submitter_user_id TEXT NOT NULL REFERENCES users(id),
    authority_org_id TEXT NOT NULL REFERENCES organisations(id),

    -- Widened state machine. The new terminal/lifecycle states only apply
    -- AFTER an approval — 'revoked' and 'suspended' can only be reached
    -- from 'approved' (revoked also reachable from 'suspended'); 'expired'
    -- is reached automatically from either 'approved' or 'suspended' when
    -- expires_at passes. Transitions are enforced in the route handler;
    -- this CHECK only validates the value is a known status.
    status TEXT NOT NULL DEFAULT 'submitted'
      CHECK (status IN (
        'submitted',           -- in queue, no authority user has claimed it
        'under_review',        -- a reviewer has acknowledged + started reviewing
        'approved',            -- decision: pass
        'denied',              -- decision: fail (terminal)
        'changes_requested',   -- decision: rework needed before re-review
        'withdrawn',           -- submitter cancelled (terminal)
        'suspended',           -- post-approval halt; reinstatable
        'revoked',             -- post-approval cancellation (terminal)
        'expired'              -- past expires_at (terminal; auto from cron)
      )),

    submission_type TEXT,
    cover_letter TEXT,
    submitted_at TEXT NOT NULL DEFAULT (datetime('now')),

    reviewer_user_id TEXT REFERENCES users(id),
    claimed_at TEXT,
    reviewed_at TEXT,

    decision_notes TEXT,
    permit_number TEXT,

    -- ── New lifecycle columns ─────────────────────────────────────────
    expires_at TEXT,
      -- When non-null AND status IN ('approved','suspended'), the
      -- scheduled() handler in workers/src/index.ts transitions the row
      -- to 'expired' once datetime('now') > expires_at. Settable at
      -- approval time or via action='set_expiration'.

    suspended_at TEXT,
      -- Set on suspend; cleared on reinstate. Lets the UI render a
      -- "Suspended for N days" chip without scanning the transition log.

    revoked_at TEXT,
      -- Set on revoke. Terminal — never cleared.

    parent_submission_id TEXT REFERENCES permit_submissions(id),
      -- Links a resubmission to its predecessor. NULL for fresh
      -- submissions. The detail UI walks this chain backwards to render
      -- thread-of-history so the reviewer never loses context across
      -- a denial → resubmit → approval arc.

    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Copy existing rows. New columns default to NULL which is the correct
-- value for every pre-Slice-B submission (no expiration set, never
-- suspended, never revoked, no parent).
INSERT INTO permit_submissions_new
  (id, project_id, submitter_org_id, submitter_user_id, authority_org_id,
   status, submission_type, cover_letter, submitted_at, reviewer_user_id,
   claimed_at, reviewed_at, decision_notes, permit_number,
   updated_at, created_at)
SELECT id, project_id, submitter_org_id, submitter_user_id, authority_org_id,
       status, submission_type, cover_letter, submitted_at, reviewer_user_id,
       claimed_at, reviewed_at, decision_notes, permit_number,
       updated_at, created_at
  FROM permit_submissions;

DROP TABLE permit_submissions;
ALTER TABLE permit_submissions_new RENAME TO permit_submissions;

-- Recreate the existing indexes (the rebuild dropped them with the table).
CREATE INDEX IF NOT EXISTS idx_permit_submissions_project
  ON permit_submissions(project_id);
CREATE INDEX IF NOT EXISTS idx_permit_submissions_authority
  ON permit_submissions(authority_org_id, status);
CREATE INDEX IF NOT EXISTS idx_permit_submissions_submitter
  ON permit_submissions(submitter_org_id);

-- New indexes for Slice B query patterns.
--
-- The cron sweep runs every 5 minutes and needs to be cheap. Partial
-- index on (expires_at, status) where the conditions for auto-expire
-- could apply — rows without an expiration, or already in a terminal
-- non-expirable state, are excluded from the index entirely.
CREATE INDEX IF NOT EXISTS idx_permit_submissions_expiring
  ON permit_submissions(expires_at)
  WHERE expires_at IS NOT NULL
    AND status IN ('approved', 'suspended');

-- Parent chain walks (resubmission breadcrumb). Partial — most rows
-- have no parent, so excluding them keeps the index lean.
CREATE INDEX IF NOT EXISTS idx_permit_submissions_parent
  ON permit_submissions(parent_submission_id)
  WHERE parent_submission_id IS NOT NULL;

-- ── B) Status transition timeline ─────────────────────────────────────────
-- One row per status change. Append-only; never updated. The (id, action,
-- actor, reason, timestamp) tuple is also recorded in audit_log via
-- setAudit() for the operator audit feed, but this normalised table is
-- what powers the per-submission "Lifecycle" timeline render — the audit
-- log's polymorphic detail JSON would force a JSON-extract on every read.

CREATE TABLE IF NOT EXISTS permit_status_transitions (
    id TEXT PRIMARY KEY,
    submission_id TEXT NOT NULL REFERENCES permit_submissions(id) ON DELETE CASCADE,

    -- from_status is NULL for the implicit 'create' transition (insert of
    -- a new submission row) so the timeline shows the full arc starting
    -- at submission rather than a dangling first-claim event.
    from_status TEXT,
    to_status TEXT NOT NULL,

    actor_user_id TEXT REFERENCES users(id),
    actor_org_id TEXT REFERENCES organisations(id),
      -- NULL for automated=1 transitions (the cron has no user identity).

    reason TEXT,
      -- The decision_notes / suspension reason / etc. captured at the
      -- moment of the transition. Frozen here even if the submission's
      -- decision_notes is later overwritten by a subsequent decision.

    automated INTEGER NOT NULL DEFAULT 0,
      -- 1 = driven by scheduled() cron (auto-expire); 0 = human action.

    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_permit_transitions_submission
  ON permit_status_transitions(submission_id, created_at);

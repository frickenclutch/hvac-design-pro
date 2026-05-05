-- 0005_permit_authority.sql
-- ============================================================================
-- Permit Authority rail — V1
--
-- Adds the data model for a third actor on the platform: code enforcement /
-- AHJ / permit grantor / building department / fire marshal / zoning, etc.
-- (terminology varies by jurisdiction — `authority_title` lets each AHJ name
-- themselves as their constituents expect).
--
-- Design notes:
--  - Authority status is a FLAG on users (`is_permit_authority`), orthogonal
--    to `role`, mirroring the `is_platform_admin` pattern. Any user can be
--    promoted to authority status without disturbing the existing role enum.
--  - Authority profile fields (jurisdiction, intake notes) live on the
--    organisations table — authorities are typically `org_type='municipality'`
--    but the schema doesn't force it; a `company` tenant could declare a
--    private inspection arm if the business model ever calls for it.
--  - Cross-tenant project visibility is a deliberate exception to the
--    per-tenant org_id isolation rule. The exception is explicit and gated:
--    only parties to a `permit_submissions` row see the underlying project.
--    Community forum is the only other deliberate cross-tenant surface.
--  - Status state machine on permit_submissions:
--        submitted → under_review → (approved | denied | changes_requested)
--        any state → withdrawn (submitter cancels)
--    The CHECK constraint enforces valid values; transitions are app-level.
-- ============================================================================

-- ── A) Authority flag + profile ───────────────────────────────────────────

ALTER TABLE users ADD COLUMN is_permit_authority INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_users_authority
  ON users(is_permit_authority)
  WHERE is_permit_authority = 1;

ALTER TABLE organisations ADD COLUMN authority_type TEXT;
  -- 'building_dept' | 'fire_marshal' | 'zoning' | 'mechanical' | 'plumbing'
  -- | 'electrical' | 'environmental' | 'general' — the kind of approvals
  -- this AHJ issues. NULL means the org is not configured as an authority.

ALTER TABLE organisations ADD COLUMN authority_title TEXT;
  -- Display title shown next to the authority badge — e.g. "Building
  -- Inspector", "Code Enforcement Officer", "Plan Reviewer", "Permit
  -- Specialist". Free text; the AHJ self-describes.

ALTER TABLE organisations ADD COLUMN jurisdiction_states TEXT;
  -- JSON array of two-letter US state codes the authority serves.
  -- e.g. '["NY","NJ","CT"]'

ALTER TABLE organisations ADD COLUMN jurisdiction_counties TEXT;
  -- JSON array of "County, ST" strings. e.g. '["Onondaga, NY","Oswego, NY"]'

ALTER TABLE organisations ADD COLUMN jurisdiction_zips TEXT;
  -- JSON array of US ZIP-5 strings. Most-specific search target — when a
  -- submitter searches by their project's ZIP, ZIP-level matches rank first.

ALTER TABLE organisations ADD COLUMN authority_intake_notes TEXT;
  -- Free-text the authority writes describing additional steps required
  -- beyond the digital submission — e.g. "Site visit required for any
  -- mechanical permit over 15 tons. Schedule via 315-555-0100."

ALTER TABLE organisations ADD COLUMN authority_intake_email TEXT;
  -- Optional notification email — copies of new submissions land here.
  -- Email delivery is Phase 2; column is in place so the delivery flow
  -- doesn't require another migration.

CREATE INDEX IF NOT EXISTS idx_orgs_authority_type
  ON organisations(authority_type)
  WHERE authority_type IS NOT NULL;

-- ── B) Permit submissions ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS permit_submissions (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

    -- Submitter side: the org+user that initiated the submission. Captured
    -- for audit trail; the project's current org_id is what controls write
    -- access to the project itself.
    submitter_org_id TEXT NOT NULL REFERENCES organisations(id),
    submitter_user_id TEXT NOT NULL REFERENCES users(id),

    -- Authority side: the org that received the submission and whose users
    -- (with is_permit_authority=1) can act on it.
    authority_org_id TEXT NOT NULL REFERENCES organisations(id),

    -- State machine
    status TEXT NOT NULL DEFAULT 'submitted'
      CHECK (status IN (
        'submitted',           -- in queue, no authority user has claimed it
        'under_review',        -- a reviewer has acknowledged + started reviewing
        'approved',            -- decision: pass
        'denied',              -- decision: fail (with notes)
        'changes_requested',   -- decision: rework needed before re-review
        'withdrawn'            -- submitter cancelled before decision
      )),

    -- What kind of approval is being sought — narrative, not enum-constrained
    -- because municipalities use wildly different terms.
    submission_type TEXT,
      -- e.g. 'mechanical_permit' | 'plan_review' | 'inspection_request'
      --      'energy_compliance_review' | 'permit_amendment'

    -- Submitter's free-text cover letter — what they want approved + why
    cover_letter TEXT,

    submitted_at TEXT NOT NULL DEFAULT (datetime('now')),

    -- Set when an authority user moves status from 'submitted' to
    -- 'under_review' or makes a decision. claimed_at = first action.
    reviewer_user_id TEXT REFERENCES users(id),
    claimed_at TEXT,
    reviewed_at TEXT,

    -- Authority's response to a decision (denial reason, change request,
    -- approval conditions). Free text.
    decision_notes TEXT,

    -- Optional permit number issued on approval — AHJ-assigned, free text.
    permit_number TEXT,

    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_permit_submissions_project
  ON permit_submissions(project_id);
CREATE INDEX IF NOT EXISTS idx_permit_submissions_authority
  ON permit_submissions(authority_org_id, status);
CREATE INDEX IF NOT EXISTS idx_permit_submissions_submitter
  ON permit_submissions(submitter_org_id);

-- ── C) Comments / messages on a submission ───────────────────────────────
-- The shared review thread: submitter + authority + (eventually) inspectors
-- all post here. `is_internal=1` marks a comment visible only to the
-- authority side (their internal notes), separate from the public thread.

CREATE TABLE IF NOT EXISTS permit_submission_comments (
    id TEXT PRIMARY KEY,
    submission_id TEXT NOT NULL REFERENCES permit_submissions(id) ON DELETE CASCADE,
    author_org_id TEXT NOT NULL REFERENCES organisations(id),
    author_user_id TEXT NOT NULL REFERENCES users(id),
    body TEXT NOT NULL,
    is_internal INTEGER NOT NULL DEFAULT 0,
    -- when 1: only visible to users at authority_org_id with
    --         is_permit_authority=1. submitter never sees these.
    deleted_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_permit_subm_comments
  ON permit_submission_comments(submission_id, created_at);

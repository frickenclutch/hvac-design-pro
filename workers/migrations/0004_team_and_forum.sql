-- 0004_team_and_forum.sql
-- ============================================================================
-- Two adjacent feature additions sharing one migration:
--
--  A) Team management — domain claim + invites
--     • organisations.claimed_domain  : the @domain.com that auto-associates
--                                        new users to this tenant
--     • organisations.domain_verified_at : timestamp set by the future TXT-
--                                        record verification flow (Phase 2);
--                                        present-but-null means "claimed but
--                                        not yet proven"
--     • org_invites table             : pending invites by email; an L1
--                                        admin can create them, the invited
--                                        party redeems via signup. Email
--                                        delivery is Phase 2 — for now the
--                                        admin can copy the redemption link.
--
--  B) Community forum — opt-in cross-tenant project sharing
--     • projects.is_public            : explicit boolean; default 0. Tenants
--                                        keep strict isolation unless the
--                                        owner flips this on.
--     • projects.shared_at            : when sharing was enabled
--     • projects.share_summary        : public blurb the owner writes when
--                                        sharing — the public listing shows
--                                        this instead of raw client/address
--                                        data, so the owner controls what
--                                        leaks
--     • project_comments table        : flat comment thread per shared
--                                        project. Anyone authenticated can
--                                        post; only the comment author can
--                                        delete their own. Threaded replies
--                                        deferred to Phase 2.
--
-- All new tables include org_id where applicable so the L0 admin can audit
-- cross-tenant activity in the existing platform-admin tooling.
-- ============================================================================

-- ── A) Team management ─────────────────────────────────────────────────────

ALTER TABLE organisations ADD COLUMN claimed_domain TEXT;
ALTER TABLE organisations ADD COLUMN domain_verified_at TEXT;

CREATE INDEX IF NOT EXISTS idx_orgs_claimed_domain
  ON organisations(claimed_domain)
  WHERE claimed_domain IS NOT NULL;

CREATE TABLE IF NOT EXISTS org_invites (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    invited_email TEXT NOT NULL,
    invited_role TEXT NOT NULL DEFAULT 'tech'
      CHECK (invited_role IN ('admin', 'engineer', 'tech', 'viewer')),
    invited_by TEXT NOT NULL REFERENCES users(id),
    token TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'pending'
      CHECK (status IN ('pending', 'accepted', 'revoked', 'expired')),
    accepted_by TEXT REFERENCES users(id),
    accepted_at TEXT,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_org_invites_org ON org_invites(org_id);
CREATE INDEX IF NOT EXISTS idx_org_invites_email ON org_invites(invited_email);
CREATE INDEX IF NOT EXISTS idx_org_invites_status ON org_invites(status);

-- ── B) Community forum ─────────────────────────────────────────────────────

ALTER TABLE projects ADD COLUMN is_public INTEGER NOT NULL DEFAULT 0;
ALTER TABLE projects ADD COLUMN shared_at TEXT;
ALTER TABLE projects ADD COLUMN share_summary TEXT;

CREATE INDEX IF NOT EXISTS idx_projects_public
  ON projects(is_public, shared_at)
  WHERE is_public = 1;

CREATE TABLE IF NOT EXISTS project_comments (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    -- author org_id is captured for L0 audit visibility, even though
    -- comments are NOT scoped by org (any authenticated user can post on
    -- any public project)
    author_org_id TEXT NOT NULL REFERENCES organisations(id),
    author_user_id TEXT NOT NULL REFERENCES users(id),
    body TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT,
    -- soft-delete via flag so audit history stays intact
    deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_project_comments_project
  ON project_comments(project_id, created_at);
CREATE INDEX IF NOT EXISTS idx_project_comments_author
  ON project_comments(author_user_id);

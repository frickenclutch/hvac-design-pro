/**
 * Pre-flight consequence engine for user rank changes.
 *
 * The "fill the gap before proceeding" core. Before a role change /
 * deactivation commits, we compute its blast radius so the actor can
 * resolve disconnects FIRST (GitHub "add an owner before you can leave"
 * generalized). Severity:
 *   - 'block': the commit endpoint 409s until resolved. Server is the
 *              source of truth; the preflight endpoint is advisory UX,
 *              but the commit guard calls this same function so a
 *              hand-rolled API request can't bypass it.
 *   - 'warn' : surfaced for acknowledgement; non-fatal. With soft-
 *              deactivate, attribution + data are preserved, so things
 *              like "owns 12 projects" are heads-ups, not hard stops.
 *
 * `proposedRole === null` means deactivation/removal. A role change that
 * keeps the user active does NOT touch the orthogonal is_permit_authority
 * flag, so the sole-authority blocker only fires on deactivation.
 */

export type BlockerSeverity = 'block' | 'warn';

export interface RoleChangeBlocker {
  code: 'sole_admin' | 'sole_permit_authority' | 'owned_projects' | 'open_permit_submissions';
  severity: BlockerSeverity;
  message: string;
  count?: number;
}

export interface RoleChangePlan {
  targetUserId: string;
  targetEmail: string | null;
  currentRole: string | null;
  currentStatus: string | null;
  proposedRole: string | null; // null = deactivate/remove
  blockers: RoleChangeBlocker[];
  /** true when no 'block'-severity blockers remain — the commit may proceed. */
  clear: boolean;
}

export async function computeRoleChangePlan(
  db: D1Database,
  args: { orgId: string; targetUserId: string; proposedRole: string | null },
): Promise<RoleChangePlan | null> {
  const { orgId, targetUserId, proposedRole } = args;

  const target = await db.prepare(
    `SELECT id, email, role, status, is_permit_authority
     FROM users WHERE id = ? AND org_id = ?`
  ).bind(targetUserId, orgId).first();
  if (!target) return null;

  const blockers: RoleChangeBlocker[] = [];
  const isRemoval = proposedRole === null;
  const losesAdmin =
    target.role === 'admin' && (isRemoval || proposedRole !== 'admin');

  // ── sole_admin (block) ────────────────────────────────────────────────
  // Every tenant must retain at least one ACTIVE admin or the manage-team
  // door closes. Generalized to the target regardless of self/other —
  // the old guard only covered self-demote.
  if (losesAdmin) {
    const row = await db.prepare(
      `SELECT COUNT(*) AS n FROM users
       WHERE org_id = ? AND role = 'admin' AND status = 'active'`
    ).bind(orgId).first();
    if (Number(row?.n ?? 0) <= 1) {
      blockers.push({
        code: 'sole_admin',
        severity: 'block',
        message:
          'This is the organisation’s only active admin. Promote another member to admin before demoting or deactivating this one.',
      });
    }
  }

  // ── sole_permit_authority (block, removal only) ───────────────────────
  // If the org is configured as a permit authority and this is its only
  // active authority user, deactivating them strands every incoming
  // submission with no one able to act. Role demotion doesn't touch the
  // orthogonal is_permit_authority flag, so this is removal-only.
  if (isRemoval && Number(target.is_permit_authority ?? 0) === 1) {
    const org = await db.prepare(
      `SELECT authority_type FROM organisations WHERE id = ?`
    ).bind(orgId).first();
    if (org?.authority_type) {
      const row = await db.prepare(
        `SELECT COUNT(*) AS n FROM users
         WHERE org_id = ? AND is_permit_authority = 1 AND status = 'active'`
      ).bind(orgId).first();
      if (Number(row?.n ?? 0) <= 1) {
        blockers.push({
          code: 'sole_permit_authority',
          severity: 'block',
          message:
            'This org is a configured permit authority and this is its only active authority member. Grant authority to another member before deactivating this one.',
        });
      }
    }
  }

  // ── owned_projects (warn) ─────────────────────────────────────────────
  // Attribution survives soft-deactivate, so this is a heads-up, not a
  // stop. Surfaced so the actor knows what this person owns.
  {
    const row = await db.prepare(
      `SELECT COUNT(*) AS n FROM projects WHERE created_by = ? AND org_id = ?`
    ).bind(targetUserId, orgId).first();
    const n = Number(row?.n ?? 0);
    if (n > 0 && (isRemoval || losesAdmin)) {
      blockers.push({
        code: 'owned_projects',
        severity: 'warn',
        message: `Creator of record on ${n} project${n === 1 ? '' : 's'}. Attribution is preserved, but consider whether work needs handoff.`,
        count: n,
      });
    }
  }

  // ── open_permit_submissions (warn) ────────────────────────────────────
  // "Open" = the submission can still receive action from either party.
  // Pre-decision states are obviously open. 'approved' and 'suspended'
  // are open too (slice B added post-decision lifecycle actions:
  // suspend / revoke / reinstate / set_expiration). Truly closed states
  // are denied / withdrawn / revoked / expired — no further mutations.
  {
    const row = await db.prepare(
      `SELECT COUNT(*) AS n FROM permit_submissions
       WHERE (submitter_user_id = ? OR reviewer_user_id = ?)
         AND status IN ('submitted','under_review','changes_requested','approved','suspended')`
    ).bind(targetUserId, targetUserId).first();
    const n = Number(row?.n ?? 0);
    if (n > 0 && (isRemoval || losesAdmin)) {
      blockers.push({
        code: 'open_permit_submissions',
        severity: 'warn',
        message: `Party to ${n} open permit submission${n === 1 ? '' : 's'} (submitter or reviewer). These stay live but this person can no longer act on them.`,
        count: n,
      });
    }
  }

  const clear = !blockers.some((b) => b.severity === 'block');
  return {
    targetUserId,
    targetEmail: (target.email as string) ?? null,
    currentRole: (target.role as string) ?? null,
    currentStatus: (target.status as string) ?? null,
    proposedRole,
    blockers,
    clear,
  };
}

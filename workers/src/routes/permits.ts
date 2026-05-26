/**
 * /api/permits/* — Permit Authority rail
 *
 * Three actors interact through this namespace:
 *  - SUBMITTER: the engineer/contractor who owns the project. Can create
 *    submissions, post comments, withdraw their own submissions.
 *  - AUTHORITY: a user with `is_permit_authority=1` at an authority org.
 *    Can claim incoming submissions, post comments, make decisions.
 *  - L0 PLATFORM ADMIN: not directly involved here, but can audit via
 *    /api/platform/* (Phase 2).
 *
 * Cross-tenant exception: this is the SECOND deliberate exception to the
 * per-tenant org_id isolation rule (Community forum is the first). When a
 * user submits a project to an authority, both parties get scoped read
 * access to the underlying project + drawings + calcs. Every read here
 * checks party membership before yielding data.
 */

import { Hono } from 'hono';
import type { AuthUser } from '../middleware/auth';
import { setAudit } from '../middleware/audit';

interface Env { DB: D1Database; }

export const permitRoutes = new Hono<{ Bindings: Env }>();

// ── Helpers ─────────────────────────────────────────────────────────────────

/** True when the caller is a party to this submission (submitter or authority).
 *  Both reads + write privileges branch off this, so it's the single source. */
async function isParty(
  db: D1Database, submissionId: string, user: AuthUser,
): Promise<{ party: 'submitter' | 'authority' | null; row: Record<string, unknown> | null }> {
  const row = await db.prepare(
    `SELECT id, submitter_org_id, authority_org_id, project_id, status
     FROM permit_submissions WHERE id = ?`,
  ).bind(submissionId).first();
  if (!row) return { party: null, row: null };
  if (row.submitter_org_id === user.orgId) return { party: 'submitter', row };
  if (row.authority_org_id === user.orgId && user.isPermitAuthority) {
    return { party: 'authority', row };
  }
  return { party: null, row };
}

function uuid(): string { return crypto.randomUUID(); }

/** Append a row to permit_status_transitions. The migration introduces this
 *  table as a normalised forensic timeline — every status change writes
 *  here in addition to the existing setAudit() call so per-submission
 *  timeline queries don't have to JSON-scan audit_log.detail. */
async function recordTransition(
  db: D1Database,
  args: {
    submissionId: string;
    fromStatus: string | null;
    toStatus: string;
    actorUserId: string | null;
    actorOrgId: string | null;
    reason?: string | null;
    automated?: boolean;
  },
): Promise<void> {
  await db.prepare(
    `INSERT INTO permit_status_transitions
       (id, submission_id, from_status, to_status,
        actor_user_id, actor_org_id, reason, automated)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    uuid(), args.submissionId, args.fromStatus, args.toStatus,
    args.actorUserId, args.actorOrgId,
    args.reason ?? null,
    args.automated ? 1 : 0,
  ).run();
}

/** Status sets used by lifecycle gates. `active` = the permit is currently
 *  in force (approved/suspended). `terminal` = no further transitions
 *  possible by either party. `resubmittable` = a submitter can chain a new
 *  submission off a row in one of these states via parent_submission_id. */
const ACTIVE_POST_DECISION = new Set(['approved', 'suspended']);
const TERMINAL_STATUSES = new Set(['denied', 'withdrawn', 'revoked', 'expired']);
const RESUBMITTABLE_PARENT = new Set([
  'denied', 'changes_requested', 'withdrawn', 'expired', 'revoked',
]);

// ── POST /api/permits/submit ───────────────────────────────────────────────
// Submitter creates a new submission against an authority org. Optionally
// links to a `parentSubmissionId` — the previous submission this one
// supersedes. The chain is rendered in the detail UI so the reviewer has
// thread-of-history across denial → resubmit → approval arcs.
permitRoutes.post('/submit', async (c) => {
  const user = c.get('user') as AuthUser;
  const body = await c.req.json();
  const projectId = (body.projectId ?? '').toString();
  const authorityOrgId = (body.authorityOrgId ?? '').toString();
  const submissionType = (body.submissionType ?? '').toString().slice(0, 80);
  const coverLetter = (body.coverLetter ?? '').toString().slice(0, 5000);
  const parentSubmissionId = body.parentSubmissionId
    ? body.parentSubmissionId.toString()
    : null;

  if (!projectId || !authorityOrgId) {
    return c.json({ error: 'projectId and authorityOrgId are required' }, 400);
  }

  // Verify the project belongs to the submitter's org.
  const project = await c.env.DB.prepare(
    `SELECT id, name FROM projects WHERE id = ? AND org_id = ?`,
  ).bind(projectId, user.orgId).first();
  if (!project) return c.json({ error: 'Project not found in your org' }, 404);

  // Verify the receiving org is configured as an authority (has authority_type).
  const authority = await c.env.DB.prepare(
    `SELECT id, name, authority_type FROM organisations
     WHERE id = ? AND authority_type IS NOT NULL`,
  ).bind(authorityOrgId).first();
  if (!authority) {
    return c.json({ error: 'Recipient is not configured as a permit authority' }, 400);
  }

  // Resubmission validation — when parentSubmissionId is provided, verify
  // the caller owns the parent, the parent points at the same project,
  // and the parent's status allows resubmission (RESUBMITTABLE_PARENT).
  if (parentSubmissionId) {
    const parent = await c.env.DB.prepare(
      `SELECT id, project_id, submitter_org_id, status
       FROM permit_submissions WHERE id = ?`,
    ).bind(parentSubmissionId).first();
    if (!parent) {
      return c.json({ error: 'parentSubmissionId not found' }, 404);
    }
    if (parent.submitter_org_id !== user.orgId) {
      return c.json({ error: 'You can only resubmit your own prior submissions' }, 403);
    }
    if (parent.project_id !== projectId) {
      return c.json({ error: 'Resubmission must target the same project as the parent' }, 400);
    }
    if (!RESUBMITTABLE_PARENT.has(parent.status as string)) {
      return c.json({
        error: `Parent submission is currently '${parent.status}' — withdraw or wait for a decision before resubmitting.`,
      }, 409);
    }
  }

  // Reject if there's already an open submission for this project to this
  // authority — submitter can withdraw the old one first if they need to
  // resubmit. NOTE: 'approved' and 'suspended' are deliberately NOT in
  // this set; a single project may legitimately need multiple sequential
  // permits (e.g., mechanical + plumbing) from the same authority.
  const dup = await c.env.DB.prepare(
    `SELECT id FROM permit_submissions
     WHERE project_id = ? AND authority_org_id = ?
       AND status IN ('submitted','under_review','changes_requested')`,
  ).bind(projectId, authorityOrgId).first();
  if (dup) {
    return c.json({
      error: 'An open submission for this project to this authority already exists.',
      existingId: dup.id,
    }, 409);
  }

  const id = uuid();
  await c.env.DB.prepare(
    `INSERT INTO permit_submissions
       (id, project_id, submitter_org_id, submitter_user_id,
        authority_org_id, submission_type, cover_letter,
        parent_submission_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(id, projectId, user.orgId, user.id, authorityOrgId,
         submissionType || null, coverLetter || null,
         parentSubmissionId).run();

  // First entry in the transition timeline — null → 'submitted'.
  await recordTransition(c.env.DB, {
    submissionId: id,
    fromStatus: null,
    toStatus: 'submitted',
    actorUserId: user.id,
    actorOrgId: user.orgId,
    reason: parentSubmissionId ? `Resubmission of ${parentSubmissionId}` : null,
  });

  // Cross-tenant action — surfaces in BOTH the submitter's audit feed AND
  // the authority org's feed via target_org_id.
  setAudit(c, {
    action: 'permit.submit',
    entityType: 'permit_submission',
    entityId: id,
    entityLabel: `${authority.name} — ${project.name}`,
    projectId,
    targetOrgId: authorityOrgId,
    detail: {
      submissionType: submissionType || null,
      authorityName: authority.name,
      projectName: project.name,
      parentSubmissionId,
    },
  });

  return c.json({ id, status: 'submitted' }, 201);
});

// ── GET /api/permits/submissions ───────────────────────────────────────────
// Auto-scoped: submitter sees rows where submitter_org_id = their org;
// authority user sees rows where authority_org_id = their org. Status filter
// optional via ?status=submitted|under_review|approved|denied|...
permitRoutes.get('/submissions', async (c) => {
  const user = c.get('user') as AuthUser;
  const filter = c.req.query('status');
  const where: string[] = [];
  const params: unknown[] = [];

  // Visibility: submitter org OR (authority org AND user has authority flag).
  if (user.isPermitAuthority) {
    where.push(`(submitter_org_id = ? OR authority_org_id = ?)`);
    params.push(user.orgId, user.orgId);
  } else {
    where.push(`submitter_org_id = ?`);
    params.push(user.orgId);
  }

  if (filter) {
    where.push(`status = ?`);
    params.push(filter);
  }

  const sql = `
    SELECT s.id, s.project_id, s.status, s.submission_type, s.submitted_at,
           s.reviewed_at, s.permit_number, s.decision_notes,
           s.submitter_org_id, s.authority_org_id,
           s.expires_at, s.suspended_at, s.revoked_at, s.parent_submission_id,
           p.name AS project_name, p.address AS project_address,
           p.city AS project_city, p.state AS project_state, p.zip AS project_zip,
           sub_org.name AS submitter_org_name,
           auth_org.name AS authority_org_name,
           auth_org.authority_title AS authority_title
    FROM permit_submissions s
    LEFT JOIN projects p ON p.id = s.project_id
    LEFT JOIN organisations sub_org  ON sub_org.id  = s.submitter_org_id
    LEFT JOIN organisations auth_org ON auth_org.id = s.authority_org_id
    WHERE ${where.join(' AND ')}
    ORDER BY s.submitted_at DESC
    LIMIT 200
  `;
  const { results } = await c.env.DB.prepare(sql).bind(...params).all();
  return c.json({ submissions: results });
});

// ── GET /api/permits/submissions/:id ───────────────────────────────────────
// Full detail — project payload + comments. Both parties get full project
// visibility (deliberate cross-tenant exception, gated by isParty()).
permitRoutes.get('/submissions/:id', async (c) => {
  const user = c.get('user') as AuthUser;
  const id = c.req.param('id');
  const { party, row } = await isParty(c.env.DB, id, user);
  if (!party || !row) return c.json({ error: 'Submission not found' }, 404);

  // Pull the full project (cross-tenant when party='authority')
  const project = await c.env.DB.prepare(
    `SELECT * FROM projects WHERE id = ?`,
  ).bind(row.project_id).first();

  // Latest Manual J + D + AED calc for the project, by calc_type
  const { results: calcs } = await c.env.DB.prepare(
    `SELECT id, calc_type, version, status, engine_version, computed_at,
            duration_ms, outputs
     FROM calculations
     WHERE project_id = ?
     ORDER BY calc_type, version DESC`,
  ).bind(row.project_id).all();

  const submission = await c.env.DB.prepare(
    `SELECT s.*,
            sub_org.name AS submitter_org_name,
            auth_org.name AS authority_org_name,
            auth_org.authority_title AS authority_title,
            auth_org.authority_intake_notes AS authority_intake_notes,
            reviewer.first_name AS reviewer_first_name,
            reviewer.last_name AS reviewer_last_name
     FROM permit_submissions s
     LEFT JOIN organisations sub_org  ON sub_org.id  = s.submitter_org_id
     LEFT JOIN organisations auth_org ON auth_org.id = s.authority_org_id
     LEFT JOIN users reviewer ON reviewer.id = s.reviewer_user_id
     WHERE s.id = ?`,
  ).bind(id).first();

  // Parent submission basics (for resubmission breadcrumb). NULL when this
  // is a fresh submission. Pulled inline so the UI doesn't need a second
  // round-trip just to render "Resubmission of [parent status, date]".
  const parentId = (submission as Record<string, unknown> | null)?.parent_submission_id as string | null | undefined;
  let parentSubmission: Record<string, unknown> | null = null;
  if (parentId) {
    parentSubmission = (await c.env.DB.prepare(
      `SELECT id, status, submission_type, submitted_at, reviewed_at,
              decision_notes, permit_number
       FROM permit_submissions WHERE id = ?`,
    ).bind(parentId).first()) as Record<string, unknown> | null;
  }

  // Comments — exclude internal-only comments unless caller is authority side.
  const showInternal = party === 'authority' ? 1 : 0;
  const { results: comments } = await c.env.DB.prepare(
    `SELECT c.id, c.body, c.is_internal, c.deleted_at, c.created_at,
            c.author_user_id, c.author_org_id,
            u.first_name AS author_first_name, u.last_name AS author_last_name,
            o.name AS author_org_name,
            u.is_permit_authority AS author_is_authority
     FROM permit_submission_comments c
     LEFT JOIN users u         ON u.id = c.author_user_id
     LEFT JOIN organisations o ON o.id = c.author_org_id
     WHERE c.submission_id = ?
       AND (c.is_internal = 0 OR ? = 1)
     ORDER BY c.created_at ASC`,
  ).bind(id, showInternal).all();

  return c.json({
    submission, project, calculations: calcs, comments, party,
    parentSubmission,
  });
});

// ── PATCH /api/permits/submissions/:id ─────────────────────────────────────
// State-machine actions. Submitter can withdraw. Authority can:
//   - claim / approve / deny / request_changes  (pre-decision)
//   - suspend / revoke / reinstate              (post-decision lifecycle)
//   - set_expiration                            (no status change)
//
// Lifecycle transition rules (authority side):
//   approved   → suspended  via 'suspend'         (reason required)
//   approved   → revoked    via 'revoke'          (reason required)
//   suspended  → approved   via 'reinstate'       (reason required)
//   suspended  → revoked    via 'revoke'          (reason required)
//
// 'expired' is reached only via the scheduled() cron sweep — there's no
// manual expire action. If an authority wants to force-expire, they revoke
// with a reason naming the expiration.
permitRoutes.patch('/submissions/:id', async (c) => {
  const user = c.get('user') as AuthUser;
  const id = c.req.param('id');
  const body = await c.req.json();
  const action = (body.action ?? '').toString();
  const decisionNotes = (body.decisionNotes ?? '').toString().slice(0, 5000);
  const permitNumber = (body.permitNumber ?? '').toString().slice(0, 80);
  const expiresAtRaw = body.expiresAt ? body.expiresAt.toString().slice(0, 32) : null;

  // Validate expiresAt — accept ISO-8601 / SQLite datetime strings. Empty
  // string clears the field; non-parseable strings are rejected.
  let expiresAtNormalized: string | null | undefined = undefined;
  if (body.expiresAt !== undefined) {
    if (expiresAtRaw === null || expiresAtRaw === '') {
      expiresAtNormalized = null;
    } else {
      const t = Date.parse(expiresAtRaw);
      if (Number.isNaN(t)) {
        return c.json({ error: 'expiresAt must be an ISO datetime or empty to clear' }, 400);
      }
      expiresAtNormalized = new Date(t).toISOString();
    }
  }

  const { party, row } = await isParty(c.env.DB, id, user);
  if (!party || !row) return c.json({ error: 'Submission not found' }, 404);
  const currentStatus = row.status as string;

  // ── Submitter actions ────────────────────────────────────────────────
  if (party === 'submitter') {
    if (action !== 'withdraw') {
      return c.json({ error: 'Submitters can only withdraw their submission' }, 403);
    }
    if (TERMINAL_STATUSES.has(currentStatus) || ACTIVE_POST_DECISION.has(currentStatus)) {
      return c.json({
        error: `Cannot withdraw a submission in '${currentStatus}' state.`,
      }, 409);
    }
    await c.env.DB.prepare(
      `UPDATE permit_submissions
         SET status = 'withdrawn', updated_at = datetime('now')
       WHERE id = ?`,
    ).bind(id).run();

    await recordTransition(c.env.DB, {
      submissionId: id,
      fromStatus: currentStatus,
      toStatus: 'withdrawn',
      actorUserId: user.id,
      actorOrgId: user.orgId,
      reason: decisionNotes.trim() || null,
    });

    setAudit(c, {
      action: 'permit.withdraw',
      entityType: 'permit_submission',
      entityId: id,
      projectId: row.project_id as string,
      targetOrgId: row.authority_org_id as string,
      beforeValue: { status: currentStatus },
      afterValue: { status: 'withdrawn' },
    });

    return c.json({ ok: true, status: 'withdrawn' });
  }

  // ── Authority actions ─────────────────────────────────────────────────
  if (party !== 'authority') {
    return c.json({ error: 'Forbidden' }, 403);
  }

  const validActions = [
    'claim', 'approve', 'deny', 'request_changes',
    'suspend', 'revoke', 'reinstate', 'set_expiration',
  ];
  if (!validActions.includes(action)) {
    return c.json({ error: `Action must be one of: ${validActions.join(', ')}` }, 400);
  }

  // set_expiration is a no-status-change action — handle separately.
  if (action === 'set_expiration') {
    if (!ACTIVE_POST_DECISION.has(currentStatus)) {
      return c.json({
        error: `Can only set expiration on approved or suspended permits (current: ${currentStatus}).`,
      }, 409);
    }
    if (expiresAtNormalized === undefined) {
      return c.json({ error: 'expiresAt is required (ISO datetime or empty to clear)' }, 400);
    }
    await c.env.DB.prepare(
      `UPDATE permit_submissions
         SET expires_at = ?, updated_at = datetime('now')
       WHERE id = ?`,
    ).bind(expiresAtNormalized, id).run();

    setAudit(c, {
      action: 'permit.set_expiration',
      entityType: 'permit_submission',
      entityId: id,
      projectId: row.project_id as string,
      targetOrgId: row.submitter_org_id as string,
      beforeValue: { expires_at: row.expires_at ?? null },
      afterValue: { expires_at: expiresAtNormalized },
    });

    return c.json({ ok: true, status: currentStatus, expiresAt: expiresAtNormalized });
  }

  // Pre-decision actions (claim / approve / deny / request_changes) — only
  // valid from pre-decision statuses.
  const preDecisionActions = ['claim', 'approve', 'deny', 'request_changes'];
  if (preDecisionActions.includes(action)) {
    const validFrom = new Set(['submitted', 'under_review', 'changes_requested']);
    if (!validFrom.has(currentStatus)) {
      return c.json({
        error: `Cannot '${action}' a submission already in '${currentStatus}' state.`,
      }, 409);
    }

    let newStatus: string;
    let setDecisionFields = false;
    if (action === 'claim')                  newStatus = 'under_review';
    else if (action === 'approve')          { newStatus = 'approved';          setDecisionFields = true; }
    else if (action === 'deny')             { newStatus = 'denied';            setDecisionFields = true; }
    else                                     { newStatus = 'changes_requested'; setDecisionFields = true; }

    if (setDecisionFields && action !== 'approve' && !decisionNotes.trim()) {
      return c.json({ error: 'Denial / changes-requested decisions require notes' }, 400);
    }

    if (setDecisionFields) {
      // Approve may also accept an optional expiresAt at decision time.
      await c.env.DB.prepare(
        `UPDATE permit_submissions
           SET status = ?,
               reviewer_user_id = ?,
               claimed_at = COALESCE(claimed_at, datetime('now')),
               reviewed_at = datetime('now'),
               decision_notes = ?,
               permit_number = ?,
               expires_at = COALESCE(?, expires_at),
               updated_at = datetime('now')
         WHERE id = ?`,
      ).bind(
        newStatus, user.id, decisionNotes || null,
        action === 'approve' ? (permitNumber || null) : null,
        action === 'approve' ? expiresAtNormalized ?? null : null,
        id,
      ).run();
    } else {
      // claim — no decision yet
      await c.env.DB.prepare(
        `UPDATE permit_submissions
           SET status = ?,
               reviewer_user_id = ?,
               claimed_at = datetime('now'),
               updated_at = datetime('now')
         WHERE id = ?`,
      ).bind(newStatus, user.id, id).run();
    }

    await recordTransition(c.env.DB, {
      submissionId: id,
      fromStatus: currentStatus,
      toStatus: newStatus,
      actorUserId: user.id,
      actorOrgId: user.orgId,
      reason: decisionNotes.trim() || null,
    });

    setAudit(c, {
      action: `permit.${action}`,
      entityType: 'permit_submission',
      entityId: id,
      projectId: row.project_id as string,
      targetOrgId: row.submitter_org_id as string,
      beforeValue: { status: currentStatus },
      afterValue: {
        status: newStatus,
        decisionNotes: decisionNotes || null,
        permitNumber: action === 'approve' ? (permitNumber || null) : null,
        expiresAt: action === 'approve' ? expiresAtNormalized ?? null : undefined,
      },
    });

    return c.json({ ok: true, status: newStatus });
  }

  // Post-decision lifecycle actions: suspend / revoke / reinstate.
  // Reason (decisionNotes) is required for all three — these are
  // consequential state changes affecting an active permit.
  if (!decisionNotes.trim()) {
    return c.json({
      error: `'${action}' requires a reason in decisionNotes`,
    }, 400);
  }

  let newStatus: string;
  if (action === 'suspend') {
    if (currentStatus !== 'approved') {
      return c.json({
        error: `Can only suspend an approved permit (current: ${currentStatus}).`,
      }, 409);
    }
    newStatus = 'suspended';
    await c.env.DB.prepare(
      `UPDATE permit_submissions
         SET status = 'suspended',
             suspended_at = datetime('now'),
             decision_notes = ?,
             updated_at = datetime('now')
       WHERE id = ?`,
    ).bind(decisionNotes, id).run();
  } else if (action === 'revoke') {
    if (!ACTIVE_POST_DECISION.has(currentStatus)) {
      return c.json({
        error: `Can only revoke an approved or suspended permit (current: ${currentStatus}).`,
      }, 409);
    }
    newStatus = 'revoked';
    await c.env.DB.prepare(
      `UPDATE permit_submissions
         SET status = 'revoked',
             revoked_at = datetime('now'),
             decision_notes = ?,
             updated_at = datetime('now')
       WHERE id = ?`,
    ).bind(decisionNotes, id).run();
  } else {
    // reinstate
    if (currentStatus !== 'suspended') {
      return c.json({
        error: `Can only reinstate a suspended permit (current: ${currentStatus}).`,
      }, 409);
    }
    newStatus = 'approved';
    await c.env.DB.prepare(
      `UPDATE permit_submissions
         SET status = 'approved',
             suspended_at = NULL,
             decision_notes = ?,
             updated_at = datetime('now')
       WHERE id = ?`,
    ).bind(decisionNotes, id).run();
  }

  await recordTransition(c.env.DB, {
    submissionId: id,
    fromStatus: currentStatus,
    toStatus: newStatus,
    actorUserId: user.id,
    actorOrgId: user.orgId,
    reason: decisionNotes,
  });

  setAudit(c, {
    action: `permit.${action}`,
    entityType: 'permit_submission',
    entityId: id,
    projectId: row.project_id as string,
    targetOrgId: row.submitter_org_id as string,
    beforeValue: { status: currentStatus },
    afterValue: { status: newStatus, reason: decisionNotes },
  });

  return c.json({ ok: true, status: newStatus });
});

// ── POST /api/permits/submissions/:id/comments ─────────────────────────────
// Either party can post; authority can flag a comment internal-only.
permitRoutes.post('/submissions/:id/comments', async (c) => {
  const user = c.get('user') as AuthUser;
  const id = c.req.param('id');
  const body = await c.req.json();
  const text = (body.body ?? '').toString().trim();
  const isInternal = !!body.isInternal;

  if (!text) return c.json({ error: 'Comment body required' }, 400);
  if (text.length > 5000) return c.json({ error: 'Comment too long (5000 max)' }, 400);

  const { party } = await isParty(c.env.DB, id, user);
  if (!party) return c.json({ error: 'Submission not found' }, 404);

  // Only authority can post internal comments.
  if (isInternal && party !== 'authority') {
    return c.json({ error: 'Only authority members can post internal comments' }, 403);
  }

  const cid = uuid();
  await c.env.DB.prepare(
    `INSERT INTO permit_submission_comments
       (id, submission_id, author_user_id, author_org_id, body, is_internal)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).bind(cid, id, user.id, user.orgId, text, isInternal ? 1 : 0).run();

  // Public comments cross to the other party's audit feed; internal ones
  // stay within the authority org. Look up the other party for the
  // target_org_id so the cross-tenant feed lights up correctly.
  const sub = await c.env.DB.prepare(
    `SELECT submitter_org_id, authority_org_id, project_id
     FROM permit_submissions WHERE id = ?`
  ).bind(id).first();
  const otherOrgId = !isInternal && sub
    ? (party === 'submitter' ? sub.authority_org_id : sub.submitter_org_id)
    : null;

  setAudit(c, {
    action: isInternal ? 'permit.comment.internal' : 'permit.comment',
    entityType: 'permit_submission',
    entityId: id,
    projectId: sub?.project_id as string,
    targetOrgId: otherOrgId as string ?? undefined,
    detail: { commentId: cid, length: text.length, party },
  });

  return c.json({ id: cid, isInternal, created_at: new Date().toISOString() }, 201);
});

// ── GET /api/permits/submissions/:id/timeline ──────────────────────────────
// Append-only forensic timeline of every status transition on this
// submission. Includes automated transitions (cron expiration) — those
// rows have actor_user_id NULL and automated=1.
permitRoutes.get('/submissions/:id/timeline', async (c) => {
  const user = c.get('user') as AuthUser;
  const id = c.req.param('id');
  const { party } = await isParty(c.env.DB, id, user);
  if (!party) return c.json({ error: 'Submission not found' }, 404);

  const { results } = await c.env.DB.prepare(
    `SELECT t.id, t.from_status, t.to_status, t.reason, t.automated,
            t.created_at, t.actor_user_id, t.actor_org_id,
            u.first_name AS actor_first_name,
            u.last_name  AS actor_last_name,
            o.name       AS actor_org_name
     FROM permit_status_transitions t
     LEFT JOIN users u         ON u.id = t.actor_user_id
     LEFT JOIN organisations o ON o.id = t.actor_org_id
     WHERE t.submission_id = ?
     ORDER BY t.created_at ASC, t.id ASC`,
  ).bind(id).all();

  return c.json({ transitions: results });
});

// ── GET /api/permits/authorities ───────────────────────────────────────────
// Search for permit authorities by jurisdiction. Submitters call this from
// the SubmitForReviewModal. Query params:
//   zip=12345          (most specific — ranked first)
//   state=NY
//   county=Onondaga, NY
//   type=building_dept
permitRoutes.get('/authorities', async (c) => {
  const db = c.env.DB;
  const zip = c.req.query('zip');
  const state = c.req.query('state');
  const county = c.req.query('county');
  const type = c.req.query('type');

  // Pull all authorities first (small set for now), then filter+rank in JS.
  // SQLite full-text on JSON arrays is awkward; this scales to hundreds
  // of AHJs without trouble. Move to indexed jurisdiction tables when
  // the AHJ count crosses 1000.
  const where: string[] = [`o.authority_type IS NOT NULL`];
  const params: unknown[] = [];
  if (type) { where.push(`o.authority_type = ?`); params.push(type); }

  const { results } = await db.prepare(
    `SELECT o.id, o.name, o.slug, o.authority_type, o.authority_title,
            o.jurisdiction_states, o.jurisdiction_counties, o.jurisdiction_zips,
            o.authority_intake_notes, o.city, o.state, o.zip, o.phone
     FROM organisations o
     WHERE ${where.join(' AND ')}
     ORDER BY o.name ASC`,
  ).bind(...params).all();

  // Rank: zip match > county match > state match > base
  const ranked = (results as Array<Record<string, unknown>>).map((r) => {
    let score = 0;
    let matched: string[] = [];
    const parseList = (s: unknown): string[] => {
      if (typeof s !== 'string' || !s) return [];
      try { const a = JSON.parse(s); return Array.isArray(a) ? a.map(String) : []; }
      catch { return []; }
    };
    const zips = parseList(r.jurisdiction_zips);
    const counties = parseList(r.jurisdiction_counties);
    const states = parseList(r.jurisdiction_states);
    if (zip && zips.includes(zip)) { score += 100; matched.push(`ZIP ${zip}`); }
    if (county && counties.includes(county)) { score += 60; matched.push(county); }
    if (state && states.includes(state)) { score += 30; matched.push(state); }
    return { ...r, _score: score, _matched: matched };
  });

  // If a search criterion was given, only return matches; otherwise return all.
  const filtered = (zip || county || state)
    ? ranked.filter((r) => (r._score as number) > 0)
    : ranked;

  filtered.sort((a, b) => (b._score as number) - (a._score as number));
  return c.json({ authorities: filtered, criteria: { zip, state, county, type } });
});

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

// ── POST /api/permits/submit ───────────────────────────────────────────────
// Submitter creates a new submission against an authority org.
permitRoutes.post('/submit', async (c) => {
  const user = c.get('user') as AuthUser;
  const body = await c.req.json();
  const projectId = (body.projectId ?? '').toString();
  const authorityOrgId = (body.authorityOrgId ?? '').toString();
  const submissionType = (body.submissionType ?? '').toString().slice(0, 80);
  const coverLetter = (body.coverLetter ?? '').toString().slice(0, 5000);

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

  // Reject if there's already an open submission for this project to this
  // authority — submitter can withdraw the old one first if they need to
  // resubmit.
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
        authority_org_id, submission_type, cover_letter)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).bind(id, projectId, user.orgId, user.id, authorityOrgId,
         submissionType || null, coverLetter || null).run();

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

  return c.json({ submission, project, calculations: calcs, comments, party });
});

// ── PATCH /api/permits/submissions/:id ─────────────────────────────────────
// Authority decision: claim / approve / deny / request changes. Submitter
// can also PATCH to withdraw their own submission.
permitRoutes.patch('/submissions/:id', async (c) => {
  const user = c.get('user') as AuthUser;
  const id = c.req.param('id');
  const body = await c.req.json();
  const action = (body.action ?? '').toString();
  const decisionNotes = (body.decisionNotes ?? '').toString().slice(0, 5000);
  const permitNumber = (body.permitNumber ?? '').toString().slice(0, 80);

  const { party, row } = await isParty(c.env.DB, id, user);
  if (!party || !row) return c.json({ error: 'Submission not found' }, 404);

  // Submitter actions
  if (party === 'submitter') {
    if (action !== 'withdraw') {
      return c.json({ error: 'Submitters can only withdraw their submission' }, 403);
    }
    if (['approved', 'denied', 'withdrawn'].includes(row.status as string)) {
      return c.json({ error: 'Submission already in a terminal state' }, 409);
    }
    await c.env.DB.prepare(
      `UPDATE permit_submissions
         SET status = 'withdrawn', updated_at = datetime('now')
       WHERE id = ?`,
    ).bind(id).run();
    return c.json({ ok: true, status: 'withdrawn' });
  }

  // Authority actions
  if (party === 'authority') {
    const validActions = ['claim', 'approve', 'deny', 'request_changes'];
    if (!validActions.includes(action)) {
      return c.json({ error: `Action must be one of: ${validActions.join(', ')}` }, 400);
    }

    let newStatus: string;
    let setDecisionFields = false;
    if (action === 'claim') newStatus = 'under_review';
    else if (action === 'approve') { newStatus = 'approved'; setDecisionFields = true; }
    else if (action === 'deny')    { newStatus = 'denied';   setDecisionFields = true; }
    else                            { newStatus = 'changes_requested'; setDecisionFields = true; }

    // Decision actions require notes (prevents silent denial)
    if (setDecisionFields && action !== 'approve' && !decisionNotes.trim()) {
      return c.json({ error: 'Denial / changes-requested decisions require notes' }, 400);
    }

    if (setDecisionFields) {
      await c.env.DB.prepare(
        `UPDATE permit_submissions
           SET status = ?,
               reviewer_user_id = ?,
               claimed_at = COALESCE(claimed_at, datetime('now')),
               reviewed_at = datetime('now'),
               decision_notes = ?,
               permit_number = ?,
               updated_at = datetime('now')
         WHERE id = ?`,
      ).bind(newStatus, user.id, decisionNotes || null,
             action === 'approve' ? (permitNumber || null) : null, id).run();
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

    return c.json({ ok: true, status: newStatus });
  }

  return c.json({ error: 'Forbidden' }, 403);
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

  return c.json({ id: cid, isInternal, created_at: new Date().toISOString() }, 201);
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

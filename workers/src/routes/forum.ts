/**
 * /api/forum/* — Cross-tenant project sharing & comments
 *
 * The forum is the ONE place where the strict per-tenant org_id isolation
 * is intentionally relaxed: projects whose owner has flipped `is_public = 1`
 * become visible to any authenticated user on the platform. The owner's
 * `share_summary` is shown instead of raw client/address fields, so the
 * owner controls exactly what leaks beyond their tenant.
 *
 * Mutations:
 *  - Toggling share status — only the project's tenant admin/engineer can
 *  - Posting comments — any authenticated user
 *  - Deleting comments — only the comment's author (or platform admin via
 *    a separate Phase-2 path)
 *  - Editing projects via this namespace — never; projects route handles
 *    that and stays org-scoped
 */

import { Hono } from 'hono';
import type { AuthUser } from '../middleware/auth';
import { setAudit } from '../middleware/audit';

interface Env {
  DB: D1Database;
}

export const forumRoutes = new Hono<{ Bindings: Env }>();

// ── POST /api/forum/projects/:id/share — toggle public sharing ──────────────
// Body: { isPublic: boolean, summary?: string }
// Only the owning tenant's admin or engineer can flip this. Setting
// is_public=true REQUIRES a non-empty summary so that the public listing
// always has owner-curated text instead of leaking the raw project name.
forumRoutes.post('/projects/:id/share', async (c) => {
  const user = c.get('user') as AuthUser;
  if (user.role !== 'admin' && user.role !== 'engineer') {
    return c.json({ error: 'Only admins or engineers can share projects' }, 403);
  }

  const id = c.req.param('id');
  const body = await c.req.json();
  const isPublic = !!body.isPublic;
  const summary = (body.summary ?? '').toString().trim();

  // Project must belong to caller's org.
  const project = await c.env.DB.prepare(
    `SELECT id, org_id, name FROM projects WHERE id = ? AND org_id = ?`
  ).bind(id, user.orgId).first();
  if (!project) return c.json({ error: 'Project not found' }, 404);

  if (isPublic) {
    if (!summary || summary.length < 20) {
      return c.json({
        error: 'Provide a summary (≥ 20 chars) describing what you need help with.',
      }, 400);
    }
    if (summary.length > 2000) {
      return c.json({ error: 'Summary must be under 2000 characters.' }, 400);
    }
    await c.env.DB.prepare(
      `UPDATE projects
         SET is_public = 1,
             share_summary = ?,
             shared_at = COALESCE(shared_at, datetime('now'))
       WHERE id = ?`
    ).bind(summary, id).run();
  } else {
    await c.env.DB.prepare(
      `UPDATE projects
         SET is_public = 0,
             share_summary = NULL
       WHERE id = ?`
    ).bind(id).run();
  }

  setAudit(c, {
    action: isPublic ? 'project.share.public' : 'project.share.private',
    entityType: 'project',
    entityId: id,
    entityLabel: project.name as string,
    projectId: id,
    afterValue: { isPublic, summaryLength: isPublic ? summary.length : 0 },
  });

  return c.json({ id, isPublic, summary: isPublic ? summary : null });
});

// ── GET /api/forum/projects — list public projects across all tenants ───────
// Query params:
//   sort=recent|oldest|comments  (default: recent)
//   limit=N (default 50, max 200)
//   q=text                      (filter by name, summary, region, standard)
// Sanitization: we expose owner-controlled fields (name, summary, climate,
// standard, share counts) but never the address or client name.
forumRoutes.get('/projects', async (c) => {
  const db = c.env.DB;
  const sort = c.req.query('sort') ?? 'recent';
  const limit = Math.min(parseInt(c.req.query('limit') || '50', 10) || 50, 200);
  const q = (c.req.query('q') ?? '').toString().trim();

  const orderBy =
    sort === 'oldest'   ? 'p.shared_at ASC' :
    sort === 'comments' ? 'comment_count DESC, p.shared_at DESC' :
                          'p.shared_at DESC';

  const params: unknown[] = [];
  let where = `p.is_public = 1`;
  if (q) {
    where += ` AND (LOWER(p.name) LIKE ? OR LOWER(p.share_summary) LIKE ? OR LOWER(p.climate_zone) LIKE ? OR LOWER(p.standard) LIKE ?)`;
    const like = `%${q.toLowerCase()}%`;
    params.push(like, like, like, like);
  }
  params.push(limit);

  const { results } = await db.prepare(
    `SELECT
       p.id, p.name, p.share_summary, p.climate_zone, p.standard,
       p.shared_at, p.org_id,
       o.name AS org_name, o.org_type AS org_type,
       (SELECT COUNT(*) FROM project_comments pc
          WHERE pc.project_id = p.id AND pc.deleted_at IS NULL) AS comment_count
     FROM projects p
     LEFT JOIN organisations o ON o.id = p.org_id
     WHERE ${where}
     ORDER BY ${orderBy}
     LIMIT ?`
  ).bind(...params).all();

  return c.json({ projects: results, sort, limit, q });
});

// ── GET /api/forum/projects/:id — public project detail + comment thread ────
forumRoutes.get('/projects/:id', async (c) => {
  const id = c.req.param('id');
  const db = c.env.DB;

  const project = await db.prepare(
    `SELECT p.id, p.name, p.share_summary, p.climate_zone, p.standard,
            p.shared_at, p.org_id,
            o.name AS org_name, o.org_type AS org_type
     FROM projects p
     LEFT JOIN organisations o ON o.id = p.org_id
     WHERE p.id = ? AND p.is_public = 1`
  ).bind(id).first();

  if (!project) return c.json({ error: 'Public project not found' }, 404);

  const { results: comments } = await db.prepare(
    `SELECT pc.id, pc.body, pc.created_at, pc.updated_at, pc.deleted_at,
            pc.author_user_id, pc.author_org_id,
            u.first_name AS author_first_name,
            u.last_name AS author_last_name,
            u.avatar_key AS author_avatar_key,
            o.name AS author_org_name
     FROM project_comments pc
     LEFT JOIN users u         ON u.id = pc.author_user_id
     LEFT JOIN organisations o ON o.id = pc.author_org_id
     WHERE pc.project_id = ?
     ORDER BY pc.created_at ASC`
  ).bind(id).all();

  return c.json({ project, comments });
});

// ── POST /api/forum/projects/:id/comments — add a comment ───────────────────
forumRoutes.post('/projects/:id/comments', async (c) => {
  const user = c.get('user') as AuthUser;
  const id = c.req.param('id');
  const body = await c.req.json();
  const text = (body.body ?? '').toString().trim();

  if (!text) return c.json({ error: 'Comment body is required' }, 400);
  if (text.length > 5000) {
    return c.json({ error: 'Comment must be under 5000 characters' }, 400);
  }

  // Confirm the project is actually public — don't let a leaked id let
  // anyone post on a private project.
  const project = await c.env.DB.prepare(
    `SELECT id FROM projects WHERE id = ? AND is_public = 1`
  ).bind(id).first();
  if (!project) return c.json({ error: 'Public project not found' }, 404);

  const commentId = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO project_comments
       (id, project_id, author_user_id, author_org_id, body)
     VALUES (?, ?, ?, ?, ?)`
  ).bind(commentId, id, user.id, user.orgId, text).run();

  // Cross-tenant action — comments on someone else's public project show
  // up in the project owner's audit feed via target_org_id. Same-tenant
  // comments are still logged but target_org_id stays null.
  const owner = await c.env.DB.prepare(
    `SELECT org_id FROM projects WHERE id = ?`
  ).bind(id).first();
  const targetOrgId =
    owner && owner.org_id !== user.orgId ? (owner.org_id as string) : undefined;

  setAudit(c, {
    action: 'project.comment',
    entityType: 'project_comment',
    entityId: commentId,
    projectId: id,
    targetOrgId,
    detail: { length: text.length },
  });

  return c.json({
    id: commentId,
    body: text,
    created_at: new Date().toISOString(),
    author_user_id: user.id,
    author_org_id: user.orgId,
  }, 201);
});

// ── DELETE /api/forum/comments/:id — soft-delete the caller's own comment ──
forumRoutes.delete('/comments/:id', async (c) => {
  const user = c.get('user') as AuthUser;
  const id = c.req.param('id');

  const before = await c.env.DB.prepare(
    `SELECT project_id FROM project_comments WHERE id = ? AND author_user_id = ?`
  ).bind(id, user.id).first();

  const r = await c.env.DB.prepare(
    `UPDATE project_comments
       SET deleted_at = datetime('now'),
           body = '[deleted]'
     WHERE id = ? AND author_user_id = ? AND deleted_at IS NULL`
  ).bind(id, user.id).run();

  if (!r.meta.changes) {
    return c.json({ error: 'Comment not found or not yours' }, 404);
  }

  setAudit(c, {
    action: 'project.comment.delete',
    entityType: 'project_comment',
    entityId: id,
    projectId: before?.project_id as string,
  });

  return c.json({ ok: true });
});

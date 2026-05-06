import { Hono } from 'hono';
import { generateId } from '../utils/id';
import { setAudit } from '../middleware/audit';

interface Env {
  DB: D1Database;
}

export const cadRoutes = new Hono<{ Bindings: Env }>();

// List CAD drawings for a project
cadRoutes.get('/project/:projectId', async (c) => {
  const user = c.get('user');
  const projectId = c.req.param('projectId');

  const { results } = await c.env.DB.prepare(
    `SELECT id, name, floor_index, thumbnail_key, created_at, updated_at
     FROM cad_drawings WHERE project_id = ? AND org_id = ? ORDER BY floor_index`
  ).bind(projectId, user.orgId).all();

  return c.json({ drawings: results });
});

// Get single drawing (with full canvas JSON)
cadRoutes.get('/:id', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');

  const drawing = await c.env.DB.prepare(
    'SELECT * FROM cad_drawings WHERE id = ? AND org_id = ?'
  ).bind(id, user.orgId).first();

  if (!drawing) return c.json({ error: 'Not found' }, 404);

  return c.json({
    ...drawing,
    canvasJson: JSON.parse(drawing.canvas_json as string),
  });
});

// Save/create a CAD drawing
cadRoutes.post('/', async (c) => {
  const user = c.get('user');
  const body = await c.req.json();
  const id = generateId();

  await c.env.DB.prepare(
    `INSERT INTO cad_drawings (id, project_id, org_id, name, floor_index, canvas_json, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, body.projectId, user.orgId, body.name || 'Floor Plan',
         body.floorIndex || 0, JSON.stringify(body.canvasJson), user.id).run();

  setAudit(c, {
    action: 'cad_drawing.create',
    entityType: 'cad_drawing',
    entityId: id,
    entityLabel: body.name || 'Floor Plan',
    projectId: body.projectId,
    detail: { floorIndex: body.floorIndex || 0 },
  });

  return c.json({ id }, 201);
});

// Update a CAD drawing (auto-save)
cadRoutes.put('/:id', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const body = await c.req.json();

  await c.env.DB.prepare(
    `UPDATE cad_drawings SET canvas_json = ?, name = COALESCE(?, name),
     updated_at = datetime('now') WHERE id = ? AND org_id = ?`
  ).bind(JSON.stringify(body.canvasJson), body.name || null, id, user.orgId).run();

  // CAD auto-save fires constantly. We log the action but skip the canvas
  // payload to keep audit storage sane — the drawing itself is the truth.
  const drawing = await c.env.DB.prepare(
    'SELECT name, project_id FROM cad_drawings WHERE id = ? AND org_id = ?'
  ).bind(id, user.orgId).first();

  if (drawing) {
    setAudit(c, {
      action: 'cad_drawing.update',
      entityType: 'cad_drawing',
      entityId: id,
      entityLabel: drawing.name as string,
      projectId: drawing.project_id as string,
    });
  }

  return c.json({ ok: true });
});

// Delete a CAD drawing
cadRoutes.delete('/:id', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');

  const before = await c.env.DB.prepare(
    'SELECT name, project_id, floor_index FROM cad_drawings WHERE id = ? AND org_id = ?'
  ).bind(id, user.orgId).first();

  await c.env.DB.prepare('DELETE FROM cad_drawings WHERE id = ? AND org_id = ?')
    .bind(id, user.orgId).run();

  if (before) {
    setAudit(c, {
      action: 'cad_drawing.delete',
      entityType: 'cad_drawing',
      entityId: id,
      entityLabel: before.name as string,
      projectId: before.project_id as string,
      beforeValue: before as Record<string, unknown>,
    });
  }

  return c.json({ ok: true });
});

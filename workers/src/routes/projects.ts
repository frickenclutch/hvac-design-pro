import { Hono } from 'hono';
import { generateId } from '../utils/id';

interface Env {
  DB: D1Database;
  STORAGE: R2Bucket;
}

export const projectRoutes = new Hono<{ Bindings: Env }>();

// List projects for current org
projectRoutes.get('/', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;

  const { results } = await db.prepare(
    `SELECT p.*, u.first_name || ' ' || u.last_name as creator_name
     FROM projects p
     LEFT JOIN users u ON u.id = p.created_by
     WHERE p.org_id = ?
     ORDER BY p.updated_at DESC`
  ).bind(user.orgId).all();

  return c.json({ projects: results });
});

// Get single project
projectRoutes.get('/:id', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');

  const project = await c.env.DB.prepare(
    'SELECT * FROM projects WHERE id = ? AND org_id = ?'
  ).bind(id, user.orgId).first();

  if (!project) return c.json({ error: 'Not found' }, 404);
  return c.json({ project });
});

// Create project
projectRoutes.post('/', async (c) => {
  const user = c.get('user');
  const body = await c.req.json();
  const id = generateId();

  await c.env.DB.prepare(
    `INSERT INTO projects (id, org_id, name, address, city, state, zip, climate_zone, standard, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, user.orgId, body.name, body.address || null, body.city || null,
         body.state || null, body.zip || null, body.climateZone || null,
         body.standard || 'ACCA', user.id).run();

  const project = await c.env.DB.prepare('SELECT * FROM projects WHERE id = ?').bind(id).first();
  return c.json({ project }, 201);
});

// Update project
projectRoutes.put('/:id', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const body = await c.req.json();

  await c.env.DB.prepare(
    `UPDATE projects SET name = ?, address = ?, city = ?, state = ?, zip = ?,
     climate_zone = ?, standard = ?, status = ?, updated_at = datetime('now')
     WHERE id = ? AND org_id = ?`
  ).bind(body.name, body.address, body.city, body.state, body.zip,
         body.climateZone, body.standard, body.status || 'active', id, user.orgId).run();

  const project = await c.env.DB.prepare('SELECT * FROM projects WHERE id = ?').bind(id).first();
  return c.json({ project });
});

// Delete project
projectRoutes.delete('/:id', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');

  await c.env.DB.prepare('DELETE FROM projects WHERE id = ? AND org_id = ?')
    .bind(id, user.orgId).run();

  return c.json({ ok: true });
});

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

  if (!body.name || typeof body.name !== 'string' || !body.name.trim()) {
    return c.json({ error: 'Project name is required' }, 400);
  }

  await c.env.DB.prepare(
    `INSERT INTO projects (id, org_id, name, address, city, state, zip, country, climate_zone, standard, project_type, status, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, user.orgId, body.name.trim(), body.address || null, body.city || null,
         body.state || null, body.zip || null, body.country || 'US', body.climateZone || null,
         body.standard || 'ACCA', body.projectType || 'Residential',
         body.status || 'active', user.id).run();

  const project = await c.env.DB.prepare('SELECT * FROM projects WHERE id = ?').bind(id).first();
  return c.json({ project }, 201);
});

// Update project
projectRoutes.put('/:id', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const body = await c.req.json();

  // Build dynamic SET so partial updates don't null out other fields
  const updates: string[] = [];
  const values: unknown[] = [];
  if (body.name !== undefined) { updates.push('name = ?'); values.push(body.name); }
  if (body.address !== undefined) { updates.push('address = ?'); values.push(body.address); }
  if (body.city !== undefined) { updates.push('city = ?'); values.push(body.city); }
  if (body.state !== undefined) { updates.push('state = ?'); values.push(body.state); }
  if (body.zip !== undefined) { updates.push('zip = ?'); values.push(body.zip); }
  if (body.climateZone !== undefined) { updates.push('climate_zone = ?'); values.push(body.climateZone); }
  if (body.standard !== undefined) { updates.push('standard = ?'); values.push(body.standard); }
  if (body.projectType !== undefined) { updates.push('project_type = ?'); values.push(body.projectType); }
  if (body.status !== undefined) { updates.push('status = ?'); values.push(body.status); }

  if (updates.length === 0) {
    return c.json({ error: 'No fields to update' }, 400);
  }

  updates.push(`updated_at = datetime('now')`);
  values.push(id, user.orgId);

  await c.env.DB.prepare(
    `UPDATE projects SET ${updates.join(', ')} WHERE id = ? AND org_id = ?`
  ).bind(...values).run();

  const project = await c.env.DB.prepare('SELECT * FROM projects WHERE id = ? AND org_id = ?').bind(id, user.orgId).first();
  if (!project) return c.json({ error: 'Not found' }, 404);
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

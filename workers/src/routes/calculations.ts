import { Hono } from 'hono';
import { generateId } from '../utils/id';
import { setAudit } from '../middleware/audit';

interface Env {
  DB: D1Database;
}

export const calcRoutes = new Hono<{ Bindings: Env }>();

// List calculations for a project
calcRoutes.get('/project/:projectId', async (c) => {
  const user = c.get('user');
  const projectId = c.req.param('projectId');

  const { results } = await c.env.DB.prepare(
    `SELECT * FROM calculations WHERE project_id = ? AND org_id = ? ORDER BY version DESC`
  ).bind(projectId, user.orgId).all();

  return c.json({ calculations: results });
});

// Save a calculation result
calcRoutes.post('/', async (c) => {
  const user = c.get('user');
  const body = await c.req.json();
  const id = generateId();

  // Get next version number
  const latest = await c.env.DB.prepare(
    `SELECT MAX(version) as maxVer FROM calculations WHERE project_id = ? AND calc_type = ?`
  ).bind(body.projectId, body.calcType).first();
  const version = ((latest?.maxVer as number) || 0) + 1;

  await c.env.DB.prepare(
    `INSERT INTO calculations (id, project_id, org_id, calc_type, version, inputs, outputs, status, engine_version, computed_by, computed_at, duration_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'complete', ?, ?, datetime('now'), ?)`
  ).bind(id, body.projectId, user.orgId, body.calcType, version,
         JSON.stringify(body.inputs), JSON.stringify(body.outputs),
         body.engineVersion || '1.0.0', user.id, body.durationMs || 0).run();

  // Calc records are immutable, so audit just notes the run; the calc
  // itself IS the audit record for the inputs/outputs. We capture the
  // identifying metadata here so the audit feed surfaces "Nathan ran a
  // Manual J on Smith Residence" without the reviewer needing to load
  // the calc detail.
  const project = await c.env.DB.prepare(
    'SELECT name FROM projects WHERE id = ? AND org_id = ?'
  ).bind(body.projectId, user.orgId).first();

  setAudit(c, {
    action: `calculation.${String(body.calcType ?? 'unknown').toLowerCase()}.run`,
    entityType: 'calculation',
    entityId: id,
    entityLabel: `${body.calcType} v${version}${project?.name ? ` — ${project.name}` : ''}`,
    projectId: body.projectId,
    detail: {
      calcType: body.calcType,
      version,
      engineVersion: body.engineVersion || '1.0.0',
      durationMs: body.durationMs || 0,
      projectName: project?.name ?? null,
    },
  });

  return c.json({ id, version }, 201);
});

// Get single calculation
calcRoutes.get('/:id', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');

  const calc = await c.env.DB.prepare(
    'SELECT * FROM calculations WHERE id = ? AND org_id = ?'
  ).bind(id, user.orgId).first();

  if (!calc) return c.json({ error: 'Not found' }, 404);

  return c.json({
    ...calc,
    inputs: JSON.parse(calc.inputs as string),
    outputs: calc.outputs ? JSON.parse(calc.outputs as string) : null,
  });
});

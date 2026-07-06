import { Hono } from 'hono';
import { generateId } from '../utils/id';
import { setAudit } from '../middleware/audit';
import { roleSatisfies } from '../utils/accessPolicy';
import { checkEntitlement, recordUsageEvent } from '../billing/usage';

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
  // CLAUDE.md §5 matrix: tech+ may "trigger calcs". Viewers are read-only.
  if (!roleSatisfies(user.role, 'tech', user.isPlatformAdmin)) {
    return c.json({ error: 'Your role cannot save calculations' }, 403);
  }
  const body = await c.req.json();
  const id = generateId();

  // SECURITY (tenant isolation): the project MUST belong to the caller's
  // org before we write anything keyed to it. Without this an authed user
  // in org A could POST { projectId: <org-B-project> } and inject an
  // append-only (unremovable) calc row into another tenant's project.
  // The org_id stamp on the INSERT is not sufficient on its own — a row
  // with org_id=A but project_id=B still surfaces to org B via the
  // permit-detail calc query, which joins by project_id only.
  if (!body.projectId || typeof body.projectId !== 'string') {
    return c.json({ error: 'projectId is required' }, 400);
  }
  const ownProject = await c.env.DB.prepare(
    'SELECT id FROM projects WHERE id = ? AND org_id = ?'
  ).bind(body.projectId, user.orgId).first();
  if (!ownProject) {
    return c.json({ error: 'Project not found in your organisation' }, 404);
  }

  // ── Usage entitlement gate (NON-BREAKING) ──────────────────────────────────
  // Before accepting the calc, check the org's 'calc_run' entitlement. This is
  // DEFAULT-ALLOW: with no plan_entitlements row configured, checkEntitlement
  // returns { allowed:true, gated:false } and we fall straight through — the
  // calc-save path is byte-identical to before for every existing prod org.
  // ONLY when an admin/L0 has configured a row with enforcement='block' + a
  // hard_cap, and the org is over it, does this deny with a 402. The check is
  // org-scoped to the SESSION-derived org (user.orgId), never a client value.
  // Wrapped so a billing-layer fault can NEVER fail an otherwise-valid calc:
  // if checkEntitlement throws, we treat it as allow (fail-open) — metering is
  // not allowed to take down the core calc path.
  try {
    const decision = await checkEntitlement(c.env.DB, user.orgId, 'calc_run');
    if (!decision.allowed) {
      return c.json(
        {
          error:
            'Calculation usage limit reached for your plan. ' +
            'Contact your administrator to raise the limit.',
          code: 'entitlement_exceeded',
          meter: 'calc_run',
          used: decision.used,
          hardCap: decision.hardCap,
          reason: decision.reason,
        },
        402,
      );
    }
  } catch (e) {
    // Fail-OPEN: a gate fault must not block a legitimate calc save.
    console.error('[billing] checkEntitlement failed (allowing calc):', e);
  }

  // NOTE on the version-number "race" flagged in the May-2026 audit:
  // we intentionally do NOT add a UNIQUE(project_id, calc_type, version)
  // constraint here. The Manual J Phase-1 shadow-run writes TWO calc rows
  // per user click — the legacy display engine and the cert-grade engine
  // — which share project_id + calc_type and may share version. A unique
  // constraint would reject the second write and silently kill drift
  // telemetry. calculations is an append-only audit-style table; rows are
  // distinguished by id + engine_version + created_at, so a duplicate
  // version ordinal under concurrency is benign (it's a label, not a key).
  // Get next version number
  const latest = await c.env.DB.prepare(
    `SELECT MAX(version) as maxVer FROM calculations WHERE project_id = ? AND calc_type = ? AND org_id = ?`
  ).bind(body.projectId, body.calcType, user.orgId).first();
  const version = ((latest?.maxVer as number) || 0) + 1;

  await c.env.DB.prepare(
    `INSERT INTO calculations (id, project_id, org_id, calc_type, version, inputs, outputs, status, engine_version, computed_by, computed_at, duration_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'complete', ?, ?, datetime('now'), ?)`
  ).bind(id, body.projectId, user.orgId, body.calcType, version,
         JSON.stringify(body.inputs), JSON.stringify(body.outputs),
         body.engineVersion || '1.0.0', user.id, body.durationMs || 0).run();

  // ── Usage metering (FIRE-AND-FORGET, NON-FATAL) ────────────────────────────
  // Record one 'calc_run' event for the SESSION-derived org. The meter is
  // idempotent on (org_id, meter_key, source_ref) — sourceRef = the calc id,
  // which is freshly generated per request, so each accepted calc counts once
  // and a client retry of the SAME calc id won't double-count. This is wrapped
  // so ANY failure (D1 error, constraint, whatever) is swallowed: a metering
  // failure must NEVER fail the calc save, which has already succeeded above.
  try {
    await recordUsageEvent(c.env.DB, user.orgId, 'calc_run', 1, { sourceRef: id });
  } catch (e) {
    console.error('[billing] recordUsageEvent failed (calc still saved):', e);
  }

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

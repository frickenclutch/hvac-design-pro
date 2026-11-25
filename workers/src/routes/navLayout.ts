import { Hono } from 'hono';
import { setAudit } from '../middleware/audit';
import {
  resolveNavLayout,
  applyNavLayoutPatch,
  mergeNavLayoutIntoSettings,
} from '../utils/navLayout';

interface Env {
  DB: D1Database;
}

// Mounted at /api/org/nav-layout (behind authMiddleware). Presentation only —
// see utils/navLayout.ts: nothing here is an authorization decision.
export const navLayoutRoutes = new Hono<{ Bindings: Env }>();

// Any member reads their org's layout — it is what their shell renders.
navLayoutRoutes.get('/', async (c) => {
  const user = c.get('user');
  const org = await c.env.DB.prepare(
    `SELECT settings FROM organisations WHERE id = ?`
  ).bind(user.orgId).first();
  if (!org) return c.json({ error: 'Organisation not found' }, 404);
  return c.json({
    layout: resolveNavLayout(org.settings),
    canEdit: user.role === 'admin' || !!user.isPlatformAdmin,
  });
});

// Tenant admin (or L0) updates the layout. Parts present in the body replace
// that part; absent parts are untouched.
navLayoutRoutes.put('/', async (c) => {
  const user = c.get('user');
  if (user.role !== 'admin' && !user.isPlatformAdmin) {
    return c.json({ error: 'Only the tenant admin or platform owner can change the navigation layout' }, 403);
  }

  const body = await c.req.json().catch(() => ({}));
  const org = await c.env.DB.prepare(
    `SELECT settings, name FROM organisations WHERE id = ?`
  ).bind(user.orgId).first();
  if (!org) return c.json({ error: 'Organisation not found' }, 404);

  const before = resolveNavLayout(org.settings);
  const { next, changed } = applyNavLayoutPatch(before, body);
  if (changed.length === 0) {
    return c.json({ error: 'No layout fields to update. Expected sidebar, landing, and/or rails.' }, 400);
  }

  await c.env.DB.prepare(
    `UPDATE organisations SET settings = ? WHERE id = ?`
  ).bind(mergeNavLayoutIntoSettings(org.settings, next), user.orgId).run();

  setAudit(c, {
    action: 'org.nav_layout.update',
    entityType: 'organisation',
    entityId: user.orgId,
    entityLabel: String(org.name ?? ''),
    beforeValue: before as unknown as Record<string, unknown>,
    afterValue: next as unknown as Record<string, unknown>,
    detail: { fieldsChanged: changed },
  });

  return c.json({ layout: next, canEdit: true });
});

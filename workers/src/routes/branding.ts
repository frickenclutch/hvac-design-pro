import { Hono } from 'hono';
import { generateId } from '../utils/id';
import { setAudit } from '../middleware/audit';
import { requirePlatformAdmin } from '../middleware/auth';
import {
  resolveBranding,
  sanitizeBrandingPatch,
  mergeBrandingIntoSettings,
  canWhiteLabel,
  logoPrefix,
  type TenantBranding,
} from '../utils/branding';

interface Env {
  DB: D1Database;
  STORAGE: R2Bucket;
}

// Raster only. SVG is deliberately excluded: it is a script-capable document,
// and the logo is served from a public route and rendered in every member's
// session. GIF is excluded too — a logo has no business animating.
const LOGO_TYPES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};
// The client downscales to ≤512px before upload; this is only a backstop.
const MAX_LOGO_BYTES = 1024 * 1024;

type OrgRow = { settings: unknown; plan: unknown; name: unknown } | null;

async function loadOrg(db: D1Database, orgId: string): Promise<OrgRow> {
  return await db.prepare(
    `SELECT settings, plan, name FROM organisations WHERE id = ?`
  ).bind(orgId).first() as OrgRow;
}

async function saveBranding(db: D1Database, orgId: string, settings: unknown, next: TenantBranding) {
  await db.prepare(
    `UPDATE organisations SET settings = ? WHERE id = ?`
  ).bind(mergeBrandingIntoSettings(settings, next), orgId).run();
}

// ── Authed tenant routes (mounted at /api/org/branding) ─────────────────────
export const brandingRoutes = new Hono<{ Bindings: Env }>();

// Any member reads their org's branding — the whole tenant renders inside it.
brandingRoutes.get('/', async (c) => {
  const user = c.get('user');
  const org = await loadOrg(c.env.DB, user.orgId);
  if (!org) return c.json({ error: 'Organisation not found' }, 404);
  return c.json({
    branding: resolveBranding(org.settings, user.orgId),
    canEdit: user.role === 'admin' || !!user.isPlatformAdmin,
    canWhiteLabel: canWhiteLabel(org.plan, !!user.isPlatformAdmin),
  });
});

// Tenant admin (or L0) updates text / colour / white-label. Partial: only the
// fields present change. The logo changes only through the endpoints below.
brandingRoutes.put('/', async (c) => {
  const user = c.get('user');
  if (user.role !== 'admin' && !user.isPlatformAdmin) {
    return c.json({ error: 'Only the tenant admin or platform owner can change branding' }, 403);
  }

  const body = await c.req.json().catch(() => ({}));
  const { patch, invalid } = sanitizeBrandingPatch(body);
  if (invalid.length > 0) {
    return c.json({ error: `Invalid branding field(s): ${invalid.join(', ')}. Colour must be #rrggbb; names are plain text up to 60 characters.` }, 400);
  }
  if (Object.keys(patch).length === 0) {
    return c.json({ error: 'No branding fields to update' }, 400);
  }

  const org = await loadOrg(c.env.DB, user.orgId);
  if (!org) return c.json({ error: 'Organisation not found' }, 404);

  const allowWhiteLabel = canWhiteLabel(org.plan, !!user.isPlatformAdmin);
  if (patch.whiteLabel === true && !allowWhiteLabel) {
    return c.json({ error: 'White-label is available on the Enterprise plan. Contact the platform owner to enable it.' }, 403);
  }

  const before = resolveBranding(org.settings, user.orgId);
  const next: TenantBranding = { ...before, ...patch };
  await saveBranding(c.env.DB, user.orgId, org.settings, next);

  setAudit(c, {
    action: 'org.branding.update',
    entityType: 'organisation',
    entityId: user.orgId,
    entityLabel: String(org.name ?? ''),
    beforeValue: before as unknown as Record<string, unknown>,
    afterValue: next as unknown as Record<string, unknown>,
    detail: { fieldsChanged: Object.keys(patch) },
  });

  return c.json({ branding: next, canEdit: true, canWhiteLabel: allowWhiteLabel });
});

// Upload / replace the tenant logo.
brandingRoutes.post('/logo', async (c) => {
  const user = c.get('user');
  if (user.role !== 'admin' && !user.isPlatformAdmin) {
    return c.json({ error: 'Only the tenant admin or platform owner can change branding' }, 403);
  }

  const formData = await c.req.formData();
  const file = formData.get('file') as unknown as File | null;
  if (!file) return c.json({ error: 'No file provided' }, 400);
  const ext = LOGO_TYPES[file.type];
  if (!ext) return c.json({ error: 'Logo must be a PNG, JPEG, or WebP image' }, 400);
  if (file.size > MAX_LOGO_BYTES) return c.json({ error: 'Logo image is too large (1 MB max)' }, 400);

  const org = await loadOrg(c.env.DB, user.orgId);
  if (!org) return c.json({ error: 'Organisation not found' }, 404);
  const before = resolveBranding(org.settings, user.orgId);

  // Key is built ONLY from the session-derived org id — never client input —
  // and a fresh id per upload makes the ?v= cache-buster change on replace.
  const key = `${logoPrefix(user.orgId)}${generateId()}.${ext}`;
  await c.env.STORAGE.put(key, file.stream(), {
    httpMetadata: { contentType: file.type },
    customMetadata: { uploadedBy: user.id, orgId: user.orgId, purpose: 'logo' },
  });

  const next: TenantBranding = { ...before, logoKey: key };
  try {
    await saveBranding(c.env.DB, user.orgId, org.settings, next);
  } catch (e) {
    // R2 + D1 aren't one transaction — don't leak the blob on a failed swap.
    await c.env.STORAGE.delete(key).catch(() => { /* best-effort cleanup */ });
    throw e;
  }
  if (before.logoKey && before.logoKey !== key) {
    await c.env.STORAGE.delete(before.logoKey).catch(() => { /* best-effort */ });
  }

  setAudit(c, {
    action: 'org.branding.logo.set',
    entityType: 'organisation',
    entityId: user.orgId,
    entityLabel: String(org.name ?? ''),
    detail: { contentType: file.type, sizeBytes: file.size },
  });

  return c.json({ branding: next }, 201);
});

brandingRoutes.delete('/logo', async (c) => {
  const user = c.get('user');
  if (user.role !== 'admin' && !user.isPlatformAdmin) {
    return c.json({ error: 'Only the tenant admin or platform owner can change branding' }, 403);
  }
  const org = await loadOrg(c.env.DB, user.orgId);
  if (!org) return c.json({ error: 'Organisation not found' }, 404);

  const before = resolveBranding(org.settings, user.orgId);
  const next: TenantBranding = { ...before, logoKey: null };
  await saveBranding(c.env.DB, user.orgId, org.settings, next);
  if (before.logoKey) await c.env.STORAGE.delete(before.logoKey).catch(() => { /* best-effort */ });

  setAudit(c, {
    action: 'org.branding.logo.remove',
    entityType: 'organisation',
    entityId: user.orgId,
    entityLabel: String(org.name ?? ''),
  });

  return c.json({ branding: next });
});

// ── L0 cross-tenant routes (mounted at /api/platform/branding) ──────────────
// The platform owner reads / sets any tenant's branding — this is how the
// white-label entitlement is granted to a tenant that is not on the
// enterprise plan. Target org comes from the URL, which is correct here ONLY
// because requirePlatformAdmin gates the whole router.
export const platformBrandingRoutes = new Hono<{ Bindings: Env }>();
platformBrandingRoutes.use('*', requirePlatformAdmin);

platformBrandingRoutes.get('/:orgId', async (c) => {
  const orgId = c.req.param('orgId');
  const org = await loadOrg(c.env.DB, orgId);
  if (!org) return c.json({ error: 'Organisation not found' }, 404);
  return c.json({ branding: resolveBranding(org.settings, orgId), canEdit: true, canWhiteLabel: true });
});

platformBrandingRoutes.put('/:orgId', async (c) => {
  const orgId = c.req.param('orgId');
  const body = await c.req.json().catch(() => ({}));
  const { patch, invalid } = sanitizeBrandingPatch(body);
  if (invalid.length > 0) return c.json({ error: `Invalid branding field(s): ${invalid.join(', ')}` }, 400);
  if (Object.keys(patch).length === 0) return c.json({ error: 'No branding fields to update' }, 400);

  const org = await loadOrg(c.env.DB, orgId);
  if (!org) return c.json({ error: 'Organisation not found' }, 404);

  const before = resolveBranding(org.settings, orgId);
  const next: TenantBranding = { ...before, ...patch };
  await saveBranding(c.env.DB, orgId, org.settings, next);

  setAudit(c, {
    action: 'platform.org.branding.update',
    entityType: 'organisation',
    entityId: orgId,
    entityLabel: String(org.name ?? ''),
    beforeValue: before as unknown as Record<string, unknown>,
    afterValue: next as unknown as Record<string, unknown>,
    detail: { fieldsChanged: Object.keys(patch), targetOrgId: orgId },
  });

  return c.json({ branding: next, canEdit: true, canWhiteLabel: true });
});

// ── Public logo bytes (mounted at /org-logos, OUTSIDE /api/* → no auth) ─────
// Same reasoning as /avatars: an <img src> cannot send a bearer header, and a
// company logo is public identity by nature (it will also front the branded
// sign-in page). The stored key is re-validated by resolveBranding against
// THIS org's own prefix, so this route can only ever serve a logo object —
// never an arbitrary bucket key planted in the settings blob.
export const orgLogoPublicRoutes = new Hono<{ Bindings: Env }>();

orgLogoPublicRoutes.get('/:orgId', async (c) => {
  const orgId = c.req.param('orgId');
  const org = await c.env.DB.prepare(
    `SELECT settings FROM organisations WHERE id = ?`
  ).bind(orgId).first();
  const key = org ? resolveBranding(org.settings, orgId).logoKey : null;
  if (!key) return c.json({ error: 'No logo' }, 404);

  const object = await c.env.STORAGE.get(key);
  if (!object) return c.json({ error: 'Logo not found in storage' }, 404);

  const rawType = String(object.httpMetadata?.contentType || 'application/octet-stream');
  const safeType = rawType in LOGO_TYPES ? rawType : 'application/octet-stream';

  return new Response(object.body, {
    headers: {
      'Content-Type': safeType,
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': 'inline',
      'Cache-Control': 'public, max-age=86400',
      // A public image: report export reads its pixels (canvas) to embed it in
      // a PDF, which needs CORS. No credentials are involved.
      'Access-Control-Allow-Origin': '*',
    },
  });
});

// ── Public sign-in branding (mounted at /api/auth/tenant-branding, no auth) ──
// What a tenant's sign-in page needs BEFORE anyone has logged in: the name,
// tagline, colour and logo pointer the tenant chose to put on its shell. It is
// the same identity already shown on the tenant's invitation emails and served
// by the public logo route — nothing else about the org is exposed.
//
// Enumeration: slugs are guessable, so this answers 200 `{ tenant: null }` for
// an unknown slug AND for a real tenant that has set no branding — the two are
// indistinguishable, and a tenant only becomes discoverable here by choosing
// to brand itself. Deactivated / suspended state, plan, member counts and
// every other settings key stay private.
export const publicBrandingRoutes = new Hono<{ Bindings: Env }>();

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;

publicBrandingRoutes.get('/:slug', async (c) => {
  const slug = c.req.param('slug').toLowerCase();
  const none = () => {
    c.header('Cache-Control', 'public, max-age=300');
    return c.json({ tenant: null });
  };
  if (!SLUG_RE.test(slug)) return none();

  const org = await c.env.DB.prepare(
    `SELECT id, name, settings FROM organisations WHERE slug = ?`
  ).bind(slug).first();
  if (!org) return none();

  const orgId = String(org.id);
  const branding = resolveBranding(org.settings, orgId);
  if (!branding.displayName && !branding.logoKey && !branding.primaryColor) return none();

  c.header('Cache-Control', 'public, max-age=300');
  return c.json({
    tenant: {
      orgId,
      slug,
      name: branding.displayName ?? String(org.name ?? ''),
      branding,
    },
  });
});


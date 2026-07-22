import { Hono } from 'hono';
import { generateId } from '../utils/id';
import { setAudit } from '../middleware/audit';

interface Env {
  DB: D1Database;
  STORAGE: R2Bucket;
}

// Accepted avatar image types → file extension. Kept in lockstep with the
// inline-safe set on the serve path below; anything else is rejected up front.
const AVATAR_TYPES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};
// 2 MB ceiling. The client downscales to a 256px square before upload, so a
// real avatar lands well under this — the limit is just a backstop against a
// raw camera file slipping through.
const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

// ── Authed self-service (mounted at /api/users, behind authMiddleware) ───────
export const userRoutes = new Hono<{ Bindings: Env }>();

// Upload the caller's OWN avatar. Every authenticated user may do this
// regardless of role — this is personal identity, not project data, so it is
// deliberately NOT behind the tech+ gate that /api/uploads uses. Always binds
// c.get('user').id; a client-supplied id can never be targeted.
userRoutes.post('/me/avatar', async (c) => {
  const user = c.get('user');
  const formData = await c.req.formData();
  const file = formData.get('file') as unknown as File | null;
  if (!file) return c.json({ error: 'No file provided' }, 400);

  const ext = AVATAR_TYPES[file.type];
  if (!ext) return c.json({ error: 'Avatar must be a PNG, JPEG, WebP, or GIF image' }, 400);
  if (file.size > MAX_AVATAR_BYTES) return c.json({ error: 'Avatar image is too large (2 MB max)' }, 400);

  // A fresh key each upload → the ?v=<avatar_key> cache-buster changes, so a
  // replaced avatar is never served stale from a browser or CDN cache.
  const key = `avatars/${user.id}/${generateId()}.${ext}`;

  await c.env.STORAGE.put(key, file.stream(), {
    httpMetadata: { contentType: file.type },
    customMetadata: { uploadedBy: user.id, purpose: 'avatar' },
  });

  // Swap the pointer, capturing the previous key so its object can be reaped.
  // R2 + D1 aren't one transaction — if the UPDATE fails, delete the object we
  // just wrote so a failed swap doesn't leak a blob.
  let prevKey: string | null = null;
  try {
    const row = await c.env.DB.prepare('SELECT avatar_key FROM users WHERE id = ?').bind(user.id).first();
    prevKey = (row?.avatar_key as string | null) ?? null;
    await c.env.DB.prepare('UPDATE users SET avatar_key = ? WHERE id = ?').bind(key, user.id).run();
  } catch (e) {
    await c.env.STORAGE.delete(key).catch(() => { /* best-effort cleanup */ });
    throw e;
  }

  // Best-effort delete of the replaced object (never block the response on it).
  if (prevKey && prevKey !== key) {
    await c.env.STORAGE.delete(prevKey).catch(() => { /* best-effort */ });
  }

  setAudit(c, {
    action: 'user.avatar.set',
    entityType: 'user',
    entityId: user.id,
    entityLabel: user.email,
    detail: { contentType: file.type, sizeBytes: file.size },
  });

  return c.json({ avatarKey: key }, 201);
});

// Remove the caller's own avatar.
userRoutes.delete('/me/avatar', async (c) => {
  const user = c.get('user');
  const row = await c.env.DB.prepare('SELECT avatar_key FROM users WHERE id = ?').bind(user.id).first();
  const key = (row?.avatar_key as string | null) ?? null;

  await c.env.DB.prepare('UPDATE users SET avatar_key = NULL WHERE id = ?').bind(user.id).run();
  if (key) await c.env.STORAGE.delete(key).catch(() => { /* best-effort */ });

  setAudit(c, {
    action: 'user.avatar.remove',
    entityType: 'user',
    entityId: user.id,
    entityLabel: user.email,
  });

  return c.json({ ok: true });
});

// ── Public avatar read (mounted at /avatars, OUTSIDE /api/* → no auth) ───────
// Avatars are public identity images, like every avatar system (GitHub,
// Gravatar, Slack). They MUST be served without auth: a plain <img src> — how
// avatars render in the account menu, sidebar, and community thread — cannot
// send the Authorization bearer header, so an authed endpoint would 401 every
// tag. The exposure is negligible: user ids are random, non-enumerable ids and
// the bytes are the same low-sensitivity identity (photo) the community board
// already surfaces cross-tenant. This is inherently cross-tenant by being
// public, which is exactly what the community thread needs.
export const avatarPublicRoutes = new Hono<{ Bindings: Env }>();

avatarPublicRoutes.get('/:id', async (c) => {
  const id = c.req.param('id');
  const row = await c.env.DB.prepare('SELECT avatar_key FROM users WHERE id = ?').bind(id).first();
  const key = (row?.avatar_key as string | null) ?? null;
  if (!key) return c.json({ error: 'No avatar' }, 404);

  const object = await c.env.STORAGE.get(key);
  if (!object) return c.json({ error: 'Avatar not found in storage' }, 404);

  // Only inert image types ever reach R2 here (upload allowlist), but pin the
  // served type to that allowlist anyway + nosniff, mirroring the uploads-serve
  // hardening. ?v=<key> changes the URL on replace, so a day-long immutable
  // cache is safe and keeps the community board fast.
  const rawType = String(object.httpMetadata?.contentType || 'application/octet-stream');
  const INLINE_SAFE = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
  const safeType = INLINE_SAFE.has(rawType) ? rawType : 'application/octet-stream';

  return new Response(object.body, {
    headers: {
      'Content-Type': safeType,
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': 'inline',
      'Cache-Control': 'public, max-age=86400',
    },
  });
});

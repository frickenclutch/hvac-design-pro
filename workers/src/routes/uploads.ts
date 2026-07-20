import { Hono } from 'hono';
import { generateId } from '../utils/id';
import { setAudit } from '../middleware/audit';
import { roleSatisfies } from '../utils/accessPolicy';

interface Env {
  DB: D1Database;
  STORAGE: R2Bucket;
}

export const uploadRoutes = new Hono<{ Bindings: Env }>();

// Upload a file to R2
uploadRoutes.post('/', async (c) => {
  const user = c.get('user');
  // CLAUDE.md §5 matrix: viewers are view-only. Uploading a floor plan or
  // AHRI cert is a create action — tech+ (matches project/calc/cad write).
  // (L0 always passes via roleSatisfies.)
  if (!roleSatisfies(user.role, 'tech', user.isPlatformAdmin)) {
    return c.json({ error: 'Your role cannot upload files' }, 403);
  }
  const formData = await c.req.formData();
  const file = formData.get('file') as unknown as File;
  const purpose = (formData.get('purpose') as string) || 'attachment';
  const projectId = formData.get('projectId') as string | null;

  if (!file) return c.json({ error: 'No file provided' }, 400);

  const id = generateId();
  const ext = file.name.split('.').pop() || 'bin';
  const r2Key = `${user.orgId}/${projectId || 'general'}/${id}.${ext}`;

  // Upload to R2
  await c.env.STORAGE.put(r2Key, file.stream(), {
    httpMetadata: { contentType: file.type },
    customMetadata: { uploadedBy: user.id, originalName: file.name },
  });

  // Record in D1
  await c.env.DB.prepare(
    `INSERT INTO file_uploads (id, org_id, project_id, r2_key, filename, content_type, size_bytes, purpose, uploaded_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, user.orgId, projectId, r2Key, file.name, file.type, file.size, purpose, user.id).run();

  setAudit(c, {
    action: `file.upload.${purpose}`,
    entityType: 'file_upload',
    entityId: id,
    entityLabel: file.name,
    projectId: projectId || undefined,
    detail: { contentType: file.type, sizeBytes: file.size, purpose },
  });

  return c.json({ id, r2Key, filename: file.name, contentType: file.type, sizeBytes: file.size }, 201);
});

// Get file (download from R2)
uploadRoutes.get('/:id', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');

  const record = await c.env.DB.prepare(
    'SELECT * FROM file_uploads WHERE id = ? AND org_id = ?'
  ).bind(id, user.orgId).first();

  if (!record) return c.json({ error: 'Not found' }, 404);

  const object = await c.env.STORAGE.get(record.r2_key as string);
  if (!object) return c.json({ error: 'File not found in storage' }, 404);

  // SECURITY: harden file serving against stored-XSS + header injection.
  //  - Only a small allowlist of inert types is served `inline`; anything
  //    else (esp. text/html, svg, xml) is forced to `attachment` so the
  //    browser downloads instead of rendering it in the Workers origin.
  //  - The filename in Content-Disposition is sanitized (strip quotes,
  //    CR/LF, control chars) AND RFC 5987-encoded so a crafted filename
  //    can't inject extra headers or break out of the quoted string.
  const rawType = String(record.content_type || 'application/octet-stream');
  const INLINE_SAFE = new Set([
    'image/png', 'image/jpeg', 'image/gif', 'image/webp',
    'application/pdf', 'text/plain',
  ]);
  const disposition = INLINE_SAFE.has(rawType) ? 'inline' : 'attachment';
  // Collapse anything non-trivial to octet-stream so an attacker can't
  // get text/html (or image/svg+xml) rendered same-origin.
  const safeType = INLINE_SAFE.has(rawType) ? rawType : 'application/octet-stream';
  const rawName = String(record.filename || 'download');
  // Positive allowlist — keep only safe printable filename chars. This
  // implicitly drops CR/LF, quotes, backslashes, and all control chars
  // (no control-char regex literal needed), neutralizing header injection
  // and quoted-string breakout in the Content-Disposition value.
  const asciiName = rawName
    .replace(/[^A-Za-z0-9._ ()-]/g, "_")   // allowlist; drops CR/LF, quotes, ctrl
    .slice(0, 200) || "download";
  const encodedName = encodeURIComponent(rawName).slice(0, 300);

  return new Response(object.body, {
    headers: {
      'Content-Type': safeType,
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition':
        `${disposition}; filename="${asciiName}"; filename*=UTF-8''${encodedName}`,
    },
  });
});

// List files for a project
uploadRoutes.get('/project/:projectId', async (c) => {
  const user = c.get('user');
  const projectId = c.req.param('projectId');

  const { results } = await c.env.DB.prepare(
    'SELECT id, filename, content_type, size_bytes, purpose, created_at FROM file_uploads WHERE project_id = ? AND org_id = ? ORDER BY created_at DESC'
  ).bind(projectId, user.orgId).all();

  return c.json({ files: results });
});

// Delete a file
uploadRoutes.delete('/:id', async (c) => {
  const user = c.get('user');
  // Destructive: removes the R2 object + D1 row. Mirror project delete —
  // admin only (L0 always passes via roleSatisfies).
  if (!roleSatisfies(user.role, 'admin', user.isPlatformAdmin)) {
    return c.json({ error: 'Only admins can delete files' }, 403);
  }
  const id = c.req.param('id');

  const record = await c.env.DB.prepare(
    'SELECT r2_key, filename, project_id, purpose FROM file_uploads WHERE id = ? AND org_id = ?'
  ).bind(id, user.orgId).first();

  if (!record) return c.json({ error: 'Not found' }, 404);

  // Delete from R2 and D1
  await c.env.STORAGE.delete(record.r2_key as string);
  await c.env.DB.prepare('DELETE FROM file_uploads WHERE id = ? AND org_id = ?').bind(id, user.orgId).run();

  setAudit(c, {
    action: 'file.delete',
    entityType: 'file_upload',
    entityId: id,
    entityLabel: record.filename as string,
    projectId: (record.project_id as string) ?? undefined,
    beforeValue: { filename: record.filename, purpose: record.purpose, r2Key: record.r2_key },
  });

  return c.json({ ok: true });
});

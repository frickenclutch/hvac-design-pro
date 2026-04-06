import { Hono } from 'hono';
import { generateId } from '../utils/id';

interface Env {
  DB: D1Database;
  STORAGE: R2Bucket;
}

export const uploadRoutes = new Hono<{ Bindings: Env }>();

// Upload a file to R2
uploadRoutes.post('/', async (c) => {
  const user = c.get('user');
  const formData = await c.req.formData();
  const file = formData.get('file') as File;
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

  return new Response(object.body, {
    headers: {
      'Content-Type': record.content_type as string,
      'Content-Disposition': `inline; filename="${record.filename}"`,
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
  const id = c.req.param('id');

  const record = await c.env.DB.prepare(
    'SELECT r2_key FROM file_uploads WHERE id = ? AND org_id = ?'
  ).bind(id, user.orgId).first();

  if (!record) return c.json({ error: 'Not found' }, 404);

  // Delete from R2 and D1
  await c.env.STORAGE.delete(record.r2_key as string);
  await c.env.DB.prepare('DELETE FROM file_uploads WHERE id = ?').bind(id).run();

  return c.json({ ok: true });
});

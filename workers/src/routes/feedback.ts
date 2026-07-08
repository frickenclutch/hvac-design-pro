import { Hono } from 'hono';
import { generateId } from '../utils/id';
import { sendEmail, buildFeedbackEmail, parseEmailList } from '../utils/email';
import { setAudit } from '../middleware/audit';

interface Env {
  DB: D1Database;
  STORAGE: R2Bucket;
  RESEND_API_KEY?: string;
  /** Comma-separated list of addresses that receive bug reports (time-critical, redundant delivery) */
  FEEDBACK_BUG_EMAILS?: string;
  /** Single address that receives suggestions and questions */
  FEEDBACK_SUPPORT_EMAIL?: string;
  /** From address for outbound feedback notifications */
  FEEDBACK_FROM_ADDRESS?: string;
}

export const feedbackRoutes = new Hono<{ Bindings: Env }>();

/** Base64-encode an ArrayBuffer for email attachment content. Chunked so a
 *  large buffer doesn't blow the argument limit of String.fromCharCode. */
function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  const CHUNK = 0x8000; // 32KB
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

// Fallback defaults if env vars are missing — matches pre-configuration behavior.
const DEFAULT_BUG_EMAILS = ['ngriffith@c4tech.dev', 'support@c4tech.co'];
const DEFAULT_SUPPORT_EMAIL = 'support@c4tech.co';

/**
 * Resolve the recipient(s) for a given feedback type.
 * Bug → both engineering + support (redundant delivery, time-critical).
 * Suggestion/Question → support only.
 */
function resolveRecipients(type: string, env: Env): string[] {
  if (type === 'bug') {
    return parseEmailList(env.FEEDBACK_BUG_EMAILS, DEFAULT_BUG_EMAILS);
  }
  const supportList = parseEmailList(env.FEEDBACK_SUPPORT_EMAIL, [DEFAULT_SUPPORT_EMAIL]);
  return supportList;
}

// Submit feedback (multipart: text fields + optional file attachments)
feedbackRoutes.post('/', async (c) => {
  const user = c.get('user') as any;
  const formData = await c.req.formData();

  const type = (formData.get('type') as string) || 'bug';
  const text = formData.get('text') as string;
  const context = (formData.get('context') as string) || 'general';
  const userAgent = (formData.get('userAgent') as string) || '';

  if (!text?.trim()) return c.json({ error: 'Feedback text is required' }, 400);

  const feedbackId = generateId();

  // Insert feedback record into D1
  await c.env.DB.prepare(
    `INSERT INTO feedback (id, org_id, user_id, type, text, context, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(feedbackId, user.orgId, user.id, type, text.trim(), context, userAgent).run();

  // Process file attachments (multiple files supported). Each file is read
  // ONCE into memory, then (a) archived to R2 and (b) base64-encoded onto the
  // notification email so the reviewer sees it inline — not just a filename.
  const attachments: {
    filename: string; contentType: string; sizeBytes: number;
    content?: string; contentId?: string;
  }[] = [];
  const fileEntries = formData.getAll('files');

  // Cap what we attach to the email so we stay well under Resend's ~40MB
  // message limit (base64 inflates ~33%). Larger files are archived to R2
  // only and flagged in the email. Screenshots are KBs, so this rarely trips.
  const MAX_EMAIL_ATTACH_BYTES = 8 * 1024 * 1024;   // per file
  const MAX_EMAIL_TOTAL_BYTES = 18 * 1024 * 1024;   // across all files
  let emailBytesUsed = 0;

  for (const raw of fileEntries) {
    // FormData values are string | File — skip strings and cast the rest.
    if (typeof raw === 'string') continue;
    const entry = raw as File;
    if (!entry || entry.size === 0) continue;

    const attachId = generateId();
    const ext = entry.name.split('.').pop() || 'bin';
    const r2Key = `${user.orgId}/feedback/${feedbackId}/${attachId}.${ext}`;

    // Read the bytes once — used for both R2 and the email.
    const buf = await entry.arrayBuffer();

    // Archive to R2 (unchanged behavior — the file is always saved).
    await c.env.STORAGE.put(r2Key, buf, {
      httpMetadata: { contentType: entry.type },
      customMetadata: { uploadedBy: user.id, originalName: entry.name, feedbackId },
    });

    // Record attachment in D1
    await c.env.DB.prepare(
      `INSERT INTO feedback_attachments (id, feedback_id, r2_key, filename, content_type, size_bytes)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(attachId, feedbackId, r2Key, entry.name, entry.type, entry.size).run();

    // Attach to the email if it fits the caps.
    const fits = entry.size <= MAX_EMAIL_ATTACH_BYTES
      && emailBytesUsed + entry.size <= MAX_EMAIL_TOTAL_BYTES;
    const isImage = (entry.type || '').startsWith('image/');
    attachments.push({
      filename: entry.name,
      contentType: entry.type || 'application/octet-stream',
      sizeBytes: entry.size,
      ...(fits ? { content: arrayBufferToBase64(buf) } : {}),
      ...(fits && isImage ? { contentId: `att-${attachId}@hvacdesignpro` } : {}),
    });
    if (fits) emailBytesUsed += entry.size;
  }

  setAudit(c, {
    action: `feedback.${type}.submit`,
    entityType: 'feedback',
    entityId: feedbackId,
    entityLabel: text.trim().slice(0, 80),
    detail: { type, context, attachmentCount: attachments.length },
  });

  // Resolve recipients based on feedback type + env config
  const recipients = resolveRecipients(type, c.env);
  const fromAddress = c.env.FEEDBACK_FROM_ADDRESS;

  // Send email notification (non-blocking)
  c.executionCtx.waitUntil(
    (async () => {
      try {
        // Fetch user + org details for the email
        const userRecord = await c.env.DB.prepare(
          'SELECT first_name, last_name, email, role FROM users WHERE id = ?'
        ).bind(user.id).first() as any;

        const orgRecord = await c.env.DB.prepare(
          'SELECT name FROM organisations WHERE id = ?'
        ).bind(user.orgId).first() as any;

        const typeLabel = type === 'bug' ? 'BUG' : type === 'suggestion' ? 'IDEA' : 'QUESTION';
        const userName = `${userRecord?.first_name || ''} ${userRecord?.last_name || ''}`.trim() || user.email;
        const orgName = orgRecord?.name || 'Unknown Org';

        const email = buildFeedbackEmail({
          type: typeLabel,
          text: text.trim(),
          context,
          userName,
          userEmail: userRecord?.email || user.email,
          userRole: userRecord?.role || 'unknown',
          orgName,
          userAgent,
          attachments,
          feedbackId,
          timestamp: new Date().toISOString(),
        });

        // Route to resolved recipients (array → Resend sends one email with all TOs)
        email.to = recipients;
        if (fromAddress) email.from = fromAddress;

        const result = await sendEmail(c.env.RESEND_API_KEY, email);
        if (!result.ok) {
          console.error(`[feedback] Email delivery failed for ${feedbackId}: ${result.error}`);
        }
      } catch (err) {
        // Non-blocking path — log but don't fail the request
        console.error(`[feedback] Email send errored for ${feedbackId}:`, err);
      }
    })()
  );

  return c.json({
    id: feedbackId,
    status: 'submitted',
    attachmentCount: attachments.length,
    /** Addresses the notification was routed to — surfaced so the UI can display them. */
    routedTo: recipients,
  }, 201);
});

// List feedback for the org (for future admin panel / ticketing integration)
feedbackRoutes.get('/', async (c) => {
  const user = c.get('user') as any;

  const { results } = await c.env.DB.prepare(
    `SELECT f.*, u.first_name, u.last_name, u.email as user_email
     FROM feedback f
     JOIN users u ON f.user_id = u.id
     WHERE f.org_id = ?
     ORDER BY f.created_at DESC
     LIMIT 100`
  ).bind(user.orgId).all();

  return c.json({ feedback: results });
});

// Get single feedback with attachments
feedbackRoutes.get('/:id', async (c) => {
  const user = c.get('user') as any;
  const id = c.req.param('id');

  const feedback = await c.env.DB.prepare(
    'SELECT * FROM feedback WHERE id = ? AND org_id = ?'
  ).bind(id, user.orgId).first();

  if (!feedback) return c.json({ error: 'Not found' }, 404);

  const { results: attachments } = await c.env.DB.prepare(
    'SELECT id, filename, content_type, size_bytes, created_at FROM feedback_attachments WHERE feedback_id = ?'
  ).bind(id).all();

  return c.json({ feedback, attachments });
});

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { authRoutes } from './routes/auth';
import { projectRoutes } from './routes/projects';
import { catalogRoutes } from './routes/catalog';
import { calcRoutes } from './routes/calculations';
import { uploadRoutes } from './routes/uploads';
import { cadRoutes } from './routes/cad';
import { orgRoutes } from './routes/org';
import { feedbackRoutes } from './routes/feedback';
import { platformRoutes } from './routes/platform';
import { forumRoutes } from './routes/forum';
import { permitRoutes } from './routes/permits';
import { auditRoutes } from './routes/audit';
import { billingRoutes } from './routes/billing';
import { webhookRoutes } from './routes/webhooks';
import { authMiddleware } from './middleware/auth';
import { auditMiddleware } from './middleware/audit';

export interface Env {
  DB: D1Database;
  STORAGE: R2Bucket;
  ENVIRONMENT: string;
  RESEND_API_KEY?: string;
  AZURE_CLIENT_ID?: string;
  AZURE_CLIENT_SECRET?: string;
  CF_ACCESS_CLIENT_ID?: string;
  CF_ACCESS_CLIENT_SECRET?: string;
  CF_ACCESS_ISSUER?: string;
  /** AES-256-GCM key (64 hex chars / 32 bytes) for encrypting TOTP secrets at
   *  rest. Set via `wrangler secret put MFA_ENC_KEY`. Unset → MFA enrollment
   *  refuses (never stores a plaintext secret). */
  MFA_ENC_KEY?: string;
}

const app = new Hono<{ Bindings: Env }>();

// CORS for frontend. PATCH must be in allowMethods for the preflight on
// every partial-update endpoint we ship — role change, authority toggle,
// permit decisions, etc. Without it, browsers block the request before
// it reaches the worker and the user sees "Unable to reach the server."
app.use('*', cors({
  origin: ['https://hvac-design-pro.pages.dev', 'http://localhost:5173'],
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}));

// Health check
app.get('/health', (c) => c.json({ status: 'ok', env: c.env.ENVIRONMENT }));

// Public auth routes
app.route('/api/auth', authRoutes);

// Provider webhook ingress — PUBLIC by design. Webhooks are signed by the
// payment provider, not sent by a logged-in user, so they are NOT bearer-authed
// (signature verification lives in each provider's handleWebhook). Mounted here,
// ahead of authMiddleware, so the chain doesn't 401 them.
app.route('/api/webhooks', webhookRoutes);

// Protected routes
app.use('/api/*', authMiddleware);
// Audit middleware runs AFTER auth so user context is on c — every mutation
// gets logged with HTTP envelope; handlers add semantic detail via setAudit.
app.use('/api/*', auditMiddleware());
app.route('/api/org', orgRoutes);
app.route('/api/projects', projectRoutes);
app.route('/api/catalog', catalogRoutes);
app.route('/api/calculations', calcRoutes);
app.route('/api/uploads', uploadRoutes);
app.route('/api/cad', cadRoutes);
app.route('/api/feedback', feedbackRoutes);
app.route('/api/platform', platformRoutes);
app.route('/api/forum', forumRoutes);
app.route('/api/permits', permitRoutes);
app.route('/api/audit-log', auditRoutes);
app.route('/api/billing', billingRoutes);

// ── Scheduled handler (Cloudflare Cron Triggers) ───────────────────────────
// Every cron schedule declared in wrangler.toml's [triggers] block fires
// this function. Today only the permit auto-expire sweep runs here.
//
// The handler must be a SIBLING export from the same module that exports
// `default app` — Cloudflare's runtime wires both. Hono apps don't carry
// scheduled() through automatically.
async function sweepExpiredPermits(env: Env): Promise<{ expired: number }> {
  // Find every approved/suspended permit whose expires_at is in the past.
  // Partial index `idx_permit_submissions_expiring` keeps this query cheap
  // even as the table grows — only rows that can possibly expire are in
  // the index. LIMIT 200 caps work per tick so a backlog from a long
  // downtime doesn't run the cron past its execution budget; the next
  // tick (5 min later) picks up the rest.
  const { results } = await env.DB.prepare(
    `SELECT id, status, project_id, submitter_org_id, authority_org_id
     FROM permit_submissions
     WHERE expires_at IS NOT NULL
       AND expires_at < datetime('now')
       AND status IN ('approved','suspended')
     LIMIT 200`,
  ).all();

  if (!results || results.length === 0) return { expired: 0 };

  let count = 0;
  for (const row of results as Array<Record<string, unknown>>) {
    const id = row.id as string;
    const fromStatus = row.status as string;

    // Flip the row to expired. The CHECK constraint allows it; the column
    // updated_at refreshes so it surfaces in recent-activity feeds.
    await env.DB.prepare(
      `UPDATE permit_submissions
         SET status = 'expired', updated_at = datetime('now')
       WHERE id = ? AND status IN ('approved','suspended')`,
    ).bind(id).run();

    // Append a transition row (automated=1, no actor). No setAudit()
    // because the cron has no Hono context; we write directly to
    // audit_log so the operator feed still surfaces the event.
    const txId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO permit_status_transitions
         (id, submission_id, from_status, to_status,
          actor_user_id, actor_org_id, reason, automated)
       VALUES (?, ?, ?, 'expired', NULL, NULL, ?, 1)`,
    ).bind(txId, id, fromStatus, 'Auto-expired by scheduled sweep').run();

    // Direct audit_log write — mirrors what setAudit() would produce so
    // the existing operator audit UI keeps working.
    try {
      const auditId = crypto.randomUUID();
      await env.DB.prepare(
        `INSERT INTO audit_log
           (id, action, entity_type, entity_id, project_id,
            org_id, target_org_id, before_value, after_value, detail,
            method, path, status_code, duration_ms)
         VALUES (?, 'permit.expired_auto', 'permit_submission', ?, ?,
                 ?, ?, ?, ?, ?,
                 'CRON', '/scheduled/expire-permits', 200, 0)`,
      ).bind(
        auditId, id, row.project_id as string,
        row.authority_org_id as string,
        row.submitter_org_id as string,
        JSON.stringify({ status: fromStatus }),
        JSON.stringify({ status: 'expired' }),
        JSON.stringify({ automated: true, source: 'cron.sweep_expired_permits' }),
      ).run();
    } catch (e) {
      console.error('[cron] audit write failed for expired permit', id, e);
    }

    count++;
  }
  return { expired: count };
}

export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      (async () => {
        try {
          const result = await sweepExpiredPermits(env);
          if (result.expired > 0) {
            console.log(`[cron] expired ${result.expired} permit(s)`);
          }
        } catch (e) {
          console.error('[cron] sweepExpiredPermits failed:', e);
        }
      })(),
    );
  },
};

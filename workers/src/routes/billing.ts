/**
 * /api/billing/* — provider-agnostic billing surface (mounted PROTECTED, after
 * authMiddleware + auditMiddleware).
 *
 * Every read is org-scoped by the SESSION-DERIVED org (c.get('user').orgId) —
 * never a client-supplied org id. Management (subscription create) is
 * admin-gated via roleSatisfies, mirroring projects.ts / org.ts. Provider work
 * goes through the PaymentProvider seam; today every non-manual provider is a
 * NOT_WIRED stub → 501. The local row is written only when the provider returns
 * ok (manual / free_beta does today).
 *
 * Isolation: subscriptions / payment_methods / usage_events / invoices are
 * strict org-owned tables (see scripts/check-tenant-scoping.mjs). Every query
 * below carries `AND org_id = ?` bound to the session org.
 */
import { Hono } from 'hono';
import { generateId } from '../utils/id';
import { setAudit } from '../middleware/audit';
import { roleSatisfies } from '../utils/accessPolicy';
import { getProvider, type ProviderName } from '../billing/provider';
import { aggregateUsage, checkEntitlement } from '../billing/usage';

interface Env {
  DB: D1Database;
  STORAGE: R2Bucket;
}

export const billingRoutes = new Hono<{ Bindings: Env }>();

// GET /api/billing/subscription — current org's active subscription.
billingRoutes.get('/subscription', async (c) => {
  const user = c.get('user');
  const sub = await c.env.DB.prepare(
    `SELECT * FROM subscriptions
     WHERE org_id = ? AND status IN ('trialing','active','past_due','paused','incomplete')
     ORDER BY created_at DESC LIMIT 1`,
  )
    .bind(user.orgId)
    .first();
  return c.json({ subscription: sub ?? null });
});

// GET /api/billing/usage?meter=calc_run[&since=...] — usage summary for the org.
billingRoutes.get('/usage', async (c) => {
  const user = c.get('user');
  const meter = c.req.query('meter');
  if (meter) {
    const total = await aggregateUsage(c.env.DB, user.orgId, meter, {
      since: c.req.query('since'),
    });
    const entitlement = await checkEntitlement(c.env.DB, user.orgId, meter);
    return c.json({ meter, total, entitlement });
  }
  // No meter → per-meter rollup for the org.
  const { results } = await c.env.DB.prepare(
    `SELECT meter_key, SUM(quantity) AS total, MAX(occurred_at) AS last_at
     FROM usage_events WHERE org_id = ? GROUP BY meter_key`,
  )
    .bind(user.orgId)
    .all();
  return c.json({ usage: results });
});

// GET /api/billing/usage/:id — single usage event, org-scoped (isolation target).
billingRoutes.get('/usage/:id', async (c) => {
  const user = c.get('user');
  const ev = await c.env.DB.prepare(
    `SELECT * FROM usage_events WHERE id = ? AND org_id = ?`,
  )
    .bind(c.req.param('id'), user.orgId)
    .first();
  if (!ev) return c.json({ error: 'Not found' }, 404);
  return c.json({ event: ev });
});

// GET /api/billing/payment-methods — org-scoped list.
billingRoutes.get('/payment-methods', async (c) => {
  const user = c.get('user');
  const { results } = await c.env.DB.prepare(
    `SELECT id, provider, method_type, display_label, is_default, status, created_at
     FROM payment_methods WHERE org_id = ? AND status != 'removed'
     ORDER BY is_default DESC, created_at DESC`,
  )
    .bind(user.orgId)
    .all();
  return c.json({ paymentMethods: results });
});

// GET /api/billing/invoices — org-scoped, append-only ledger read.
billingRoutes.get('/invoices', async (c) => {
  const user = c.get('user');
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM invoices WHERE org_id = ? ORDER BY created_at DESC LIMIT 100`,
  )
    .bind(user.orgId)
    .all();
  return c.json({ invoices: results });
});

// POST /api/billing/subscription — admin-gated. Creates/links a subscription
// via the provider seam. Today resolves to a stub → 501 not_wired unless
// provider='manual'. Records the local row when the provider returns ok.
billingRoutes.post('/subscription', async (c) => {
  const user = c.get('user');
  if (!roleSatisfies(user.role, 'admin', user.isPlatformAdmin)) {
    return c.json({ error: 'Only admins can manage billing' }, 403);
  }
  const body = await c.req.json<{ provider?: ProviderName; plan?: string }>();
  const provider = getProvider(body.provider ?? 'manual');
  const plan = body.plan ?? 'free_beta';

  const customer = await provider.createCustomer({ orgId: user.orgId, email: user.email });
  if (!customer.ok) {
    setAudit(c, {
      action: 'billing.subscription.not_wired',
      entityType: 'subscription',
      detail: customer.message,
    });
    return c.json(
      { error: customer.message, code: customer.code, provider: provider.name },
      501,
    );
  }
  const result = await provider.createSubscription({
    orgId: user.orgId,
    customerRef: customer.data.providerCustomerRef,
    plan,
  });
  if (!result.ok) {
    return c.json({ error: result.message, code: result.code, provider: provider.name }, 501);
  }

  const id = generateId();
  await c.env.DB.prepare(
    `INSERT INTO subscriptions
       (id, org_id, provider, provider_customer_ref, provider_subscription_ref, plan, status)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      user.orgId,
      provider.name,
      customer.data.providerCustomerRef,
      result.data.providerSubscriptionRef,
      plan,
      result.data.status,
    )
    .run();

  setAudit(c, {
    action: 'billing.subscription.created',
    entityType: 'subscription',
    entityId: id,
    detail: { provider: provider.name, plan, status: result.data.status },
  });
  return c.json(
    { subscription: { id, plan, provider: provider.name, status: result.data.status } },
    201,
  );
});

/**
 * /api/webhooks/* — provider webhook ingress (mounted PUBLIC, BEFORE
 * authMiddleware).
 *
 * Webhooks come from the payment provider, not a logged-in user, so they are
 * NOT bearer-authed — they are signature-verified instead (the verification
 * lives in each provider's handleWebhook). This route therefore mounts next to
 * /api/auth, ahead of the authMiddleware chain, so it isn't rejected for
 * lacking a session token.
 *
 * Today every provider's handleWebhook is a STUB returning { handled: false };
 * this route responds 202 { received: true, handled: false }. When a provider
 * is wired, handleWebhook returns projections (subscription / invoice) that this
 * route maps into D1 rows idempotently (via the unique provider_*_ref indexes
 * created in migration 0012). No external call or credential exists yet.
 */
import { Hono } from 'hono';
import { getProvider, type ProviderName } from '../billing/provider';

interface Env {
  DB: D1Database;
}

export const webhookRoutes = new Hono<{ Bindings: Env }>();

// POST /api/webhooks/:provider — public, signature-verified (not bearer-auth).
webhookRoutes.post('/:provider', async (c) => {
  const name = c.req.param('provider') as ProviderName;
  const provider = getProvider(name);
  const rawBody = await c.req.text();
  const signature =
    c.req.header('stripe-signature') ?? c.req.header('x-signature') ?? null;

  const outcome = await provider.handleWebhook({ rawBody, signature });

  // Stubs return handled:false → 202 accepted, no-op. When wired, map
  // outcome.subscription / outcome.invoice into D1 rows here (idempotent via
  // the unique provider_*_ref indexes from migration 0012).
  return c.json({ received: true, handled: outcome.handled, note: outcome.note }, 202);
});

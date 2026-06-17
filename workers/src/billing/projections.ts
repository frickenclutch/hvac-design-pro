// workers/src/billing/projections.ts
//
// The INBOUND webhook → D1 projection pipe. Provider-agnostic.
//
// A payment provider's handleWebhook() (provider.ts) verifies a signature and
// returns a NORMALISED WebhookOutcome carrying optional subscription / invoice
// projections. THIS module takes such a projection and idempotently mirrors it
// into the org-owned subscriptions / invoices tables. The worker NEVER generates
// billing state — it only mirrors what a provider asserts.
//
// HARD CONSTRAINT (this unit): no outbound calls, no credentials. Every provider
// stub returns { handled:false } with no projection today, so this pipe is
// DORMANT in prod — but it is fully unit-testable by feeding a fake projection.
//
// ISOLATION (the whole point): subscriptions / invoices are strict org-owned
// tables (scripts/check-tenant-scoping.mjs). org_id is ALWAYS the TRUSTED,
// SERVER-RESOLVED org — resolved from a stored provider_*_ref → org mapping,
// NEVER read from the unauthenticated webhook body. A projection that names a
// provider ref we've never seen (no stored mapping) is REFUSED — it cannot
// create or mutate any org's row, so it cannot be used to write into a tenant
// it doesn't own. Every UPSERT below carries `org_id` bound to that resolved
// value, satisfying the tenant-scoping guard.

import { generateId } from '../utils/id';
import type { ProviderName, WebhookOutcome } from './provider';

/** The provider-agnostic normalised projection the pipe consumes. This is the
 *  subset of WebhookOutcome the projector acts on; a provider populates it from
 *  a verified webhook payload. Both members are optional — a single webhook may
 *  carry a subscription update, an invoice, both, or neither. */
export interface WebhookProjection {
  subscription?: WebhookOutcome['subscription'];
  invoice?: WebhookOutcome['invoice'];
}

/** What the pipe did, for the route's response + audit. Per-projection-member
 *  so a partial apply (e.g. subscription resolved, invoice unresolved) is
 *  visible rather than silently collapsed. */
export interface ProjectionResult {
  applied: boolean;
  subscription?: 'inserted' | 'updated' | 'unresolved' | 'skipped';
  invoice?: 'inserted' | 'updated' | 'unresolved' | 'skipped';
  /** Resolved trusted org the rows were written under (null when nothing was
   *  resolvable — proves no cross-tenant write happened). */
  orgId: string | null;
  note?: string;
}

/** True when a WebhookOutcome carries at least one projectable member, so the
 *  route can branch without reaching into the shape. Stub outcomes (handled
 *  false, no subscription/invoice) return false → the route's existing 202
 *  no-op path is byte-unchanged. */
export function hasProjection(outcome: WebhookOutcome): boolean {
  return !!(outcome.subscription || outcome.invoice);
}

/**
 * Resolve the TRUSTED org for a provider subscription ref from stored state.
 *
 * The only trustworthy source of "which org does this provider object belong
 * to" is a row WE previously wrote (via the admin-gated POST /api/billing/
 * subscription, or a prior projection that was itself resolvable). We look the
 * subscription up by its provider + provider_subscription_ref and read back the
 * org_id that WE stamped. The webhook body's own orgId claim is NEVER trusted.
 *
 * tenant-scope-ok: this is the org-RESOLUTION read, not an org-scoped data read.
 * It deliberately has NO `org_id = ?` filter because its entire job is to LEARN
 * the trusted org_id for a globally-unique provider ref — exactly the
 * "ownership-establishing lookup on a globally-unique id" pattern the guard's
 * header sanctions. The org_id it returns is then bound on every subsequent
 * write. A provider_subscription_ref is provider-issued and globally unique;
 * it is not a tenant selector an attacker can forge into another org's row
 * (doing so would require already knowing a victim org's stored ref AND being
 * able to forge a signed webhook, which the provider seam blocks).
 */
async function resolveOrgForSubscriptionRef(
  db: D1Database,
  provider: ProviderName,
  providerSubscriptionRef: string,
): Promise<string | null> {
  // tenant-scope-ok: ownership-resolution lookup on a globally-unique,
  // provider-issued ref — returns the trusted org_id WE stamped, which is then
  // bound on every write below. Not an org-scoped data read. (The SELECT does
  // read back org_id, so the guard sees it as scoped anyway; the waiver records
  // the intent regardless.)
  const row = await db
    .prepare(
      `SELECT org_id FROM subscriptions
       WHERE provider = ? AND provider_subscription_ref = ?
       LIMIT 1`,
    )
    .bind(provider, providerSubscriptionRef)
    .first<{ org_id: string }>();
  return row?.org_id ?? null;
}

/**
 * Idempotently mirror a normalised webhook projection into D1.
 *
 * @param db    D1 binding.
 * @param orgId The TRUSTED, server-resolved org. The caller (the webhook route)
 *              resolves this from a stored provider_customer_ref/subscription_ref
 *              → org mapping — NEVER from the webhook body. This function binds
 *              it on every write; it does not re-derive it from untrusted input.
 * @param provider The provider rail the webhook arrived on — the AUTHORITATIVE
 *              source is the route's `:provider` URL param, NOT the body. Part of
 *              the (provider, provider_*_ref) idempotency key.
 * @param projection The normalised subscription / invoice members to apply.
 *
 * Subscriptions UPSERT on (provider, provider_subscription_ref). Invoices UPSERT
 * on (provider, provider_invoice_ref) — the partial unique index from migration
 * 0012 makes a replayed webhook a no-op update rather than a duplicate row.
 *
 * orgId is REQUIRED here: a projection whose org we could NOT resolve must be
 * refused upstream (the route does not call this with a null org). This keeps
 * the contract "every row written carries a trusted org_id."
 */
export async function applyWebhookProjection(
  db: D1Database,
  orgId: string,
  provider: ProviderName,
  projection: WebhookProjection,
): Promise<ProjectionResult> {
  const result: ProjectionResult = { applied: false, orgId };

  // ── Subscription projection ──────────────────────────────────────────────
  if (projection.subscription) {
    const sub = projection.subscription;
    const ref = sub.providerSubscriptionRef;
    if (!ref) {
      result.subscription = 'skipped';
    } else {
      // Find an existing row by the idempotency key, SCOPED to the trusted org
      // so a replay can never flip a different tenant's subscription even if a
      // ref somehow collided.
      const existing = await db
        .prepare(
          `SELECT id FROM subscriptions
           WHERE provider = ? AND provider_subscription_ref = ? AND org_id = ?
           LIMIT 1`,
        )
        .bind(provider, ref, orgId)
        .first<{ id: string }>();

      if (existing) {
        // UPDATE in place (current-state row). org_id pinned in the WHERE so the
        // write can only ever touch the trusted org's row.
        await db
          .prepare(
            `UPDATE subscriptions
               SET status = COALESCE(?, status),
                   current_period_start = COALESCE(?, current_period_start),
                   current_period_end = COALESCE(?, current_period_end),
                   updated_at = datetime('now')
             WHERE id = ? AND org_id = ?`,
          )
          .bind(
            sub.status ?? null,
            sub.currentPeriodStart ?? null,
            sub.currentPeriodEnd ?? null,
            existing.id,
            orgId,
          )
          .run();
        result.subscription = 'updated';
      } else {
        // INSERT a new current-state row for the trusted org.
        await db
          .prepare(
            `INSERT INTO subscriptions
               (id, org_id, provider, provider_subscription_ref, status,
                current_period_start, current_period_end)
             VALUES (?, ?, ?, ?, COALESCE(?, 'active'), ?, ?)`,
          )
          .bind(
            generateId(),
            orgId,
            provider,
            ref,
            sub.status ?? null,
            sub.currentPeriodStart ?? null,
            sub.currentPeriodEnd ?? null,
          )
          .run();
        result.subscription = 'inserted';
      }
      result.applied = true;
    }
  }

  // ── Invoice projection ─────────────────────────────────────────────────────
  if (projection.invoice) {
    const inv = projection.invoice;
    const ref = inv.providerInvoiceRef;
    if (!ref) {
      result.invoice = 'skipped';
    } else {
      const existing = await db
        .prepare(
          `SELECT id FROM invoices
           WHERE provider = ? AND provider_invoice_ref = ? AND org_id = ?
           LIMIT 1`,
        )
        .bind(provider, ref, orgId)
        .first<{ id: string }>();

      if (existing) {
        // invoices is APPEND-ONLY for the row itself, but status transitions
        // (open→paid→void) are the provider's authoritative state — mirror them
        // onto the existing row rather than inserting a duplicate. org_id pinned.
        await db
          .prepare(
            `UPDATE invoices
               SET status = COALESCE(?, status)
             WHERE id = ? AND org_id = ?`,
          )
          .bind(inv.status ?? null, existing.id, orgId)
          .run();
        result.invoice = 'updated';
      } else {
        await db
          .prepare(
            `INSERT INTO invoices
               (id, org_id, provider, provider_invoice_ref, amount_minor,
                currency, status, issued_at)
             VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, 'open'), datetime('now'))`,
          )
          .bind(
            generateId(),
            orgId,
            provider,
            ref,
            inv.amountMinor ?? 0,
            inv.currency ?? 'USD',
            inv.status ?? null,
          )
          .run();
        result.invoice = 'inserted';
      }
      result.applied = true;
    }
  }

  return result;
}

/**
 * The route-facing entry point: take a verified WebhookOutcome, resolve the
 * TRUSTED org from stored state, and apply the projection. Returns a result the
 * route turns into its 202 body + audit detail.
 *
 * @param provider The AUTHORITATIVE provider rail — the webhook route's
 *                 `:provider` URL param, NOT anything in the body. It is half of
 *                 the (provider, provider_*_ref) idempotency / resolution key.
 *
 * Org resolution (all server-side, never the body):
 *   - The subscription projection's providerSubscriptionRef + provider → the
 *     org WE previously stamped on that subscription row.
 *   - There is NO fallback to a body-supplied orgId — that would be the bypass
 *     this whole module exists to prevent.
 *
 * If the org cannot be resolved, NOTHING is written and the result reports
 * `unresolved` — a webhook for an unknown provider object is a safe no-op, not
 * a chance to forge a row into an arbitrary tenant.
 */
export async function projectWebhookOutcome(
  db: D1Database,
  provider: ProviderName,
  outcome: WebhookOutcome,
): Promise<ProjectionResult> {
  // Resolve the trusted org from the subscription ref we already store. A
  // first-ever subscription (no stored row yet) is created through the
  // admin-gated POST /api/billing/subscription, not a webhook — so a webhook
  // for a never-seen ref is correctly unresolved here.
  const subRef = outcome.subscription?.providerSubscriptionRef ?? null;
  const orgId = subRef
    ? await resolveOrgForSubscriptionRef(db, provider, subRef)
    : null;

  if (!orgId) {
    return {
      applied: false,
      orgId: null,
      subscription: outcome.subscription ? 'unresolved' : undefined,
      invoice: outcome.invoice ? 'unresolved' : undefined,
      note: 'org could not be resolved from stored provider mapping; no rows written',
    };
  }

  return applyWebhookProjection(db, orgId, provider, {
    subscription: outcome.subscription,
    invoice: outcome.invoice,
  });
}

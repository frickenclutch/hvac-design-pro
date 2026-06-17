/**
 * BILLING ACTIVATION — proves the two dormant-foundation pieces this unit
 * activates are correct AND non-breaking AND tenant-isolated:
 *
 *   (1) USAGE METERING on calc-save. A successful POST /api/calculations records
 *       exactly ONE 'calc_run' usage event for the SESSION-derived org. The
 *       entitlement gate DEFAULT-ALLOWS (no behaviour change) until a blocking
 *       hard-cap is configured, at which point an over-cap calc → 402. Metering
 *       is fire-and-forget — the calc save succeeds regardless.
 *
 *   (2) WEBHOOK → D1 PROJECTION pipe. applyWebhookProjection idempotently UPSERTs
 *       subscriptions / invoices on their provider_*_ref keys, and is ORG-SCOPED:
 *       a projection cannot write into another org's row. projectWebhookOutcome
 *       resolves the org SERVER-SIDE from a stored provider_subscription_ref →
 *       org mapping and REFUSES an unresolvable ref (no forged cross-tenant row).
 *
 * Same harness as the isolation suite: real app, real authMiddleware, real D1,
 * real minted sessions, real migrations. Nothing mocked.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { env } from 'cloudflare:test';
import {
  applyMigrations,
  seedTenant,
  seedPlanEntitlement,
  call,
  callJson,
  type SeededTenant,
} from './helpers/harness';
import { generateId } from '../src/utils/id';
import {
  applyWebhookProjection,
  projectWebhookOutcome,
  hasProjection,
} from '../src/billing/projections';
import type { WebhookOutcome } from '../src/billing/provider';

const db = () => (env as unknown as { DB: D1Database }).DB;

let orgA: SeededTenant; // engineer — can create projects + save calcs
let orgB: SeededTenant; // separate tenant — the cross-tenant adversary
let orgCapped: SeededTenant; // its own org so a hard cap doesn't affect orgA
let projectA: string;
let projectCapped: string;

/** Create a project for an org directly in D1 (bypasses the project-create
 *  route so we control the id). */
async function seedProject(orgId: string, userId: string): Promise<string> {
  const id = generateId();
  await db()
    .prepare(
      `INSERT INTO projects (id, org_id, name, standard, status, created_by)
       VALUES (?, ?, 'Metering Test Project', 'ACCA', 'active', ?)`,
    )
    .bind(id, orgId, userId)
    .run();
  return id;
}

beforeAll(async () => {
  await applyMigrations(db());

  orgA = await seedTenant(db(), {
    slug: 'b-org-a',
    name: 'Billing Org A',
    email: 'eng@b-org-a.test',
    role: 'engineer',
  });
  orgB = await seedTenant(db(), {
    slug: 'b-org-b',
    name: 'Billing Org B',
    email: 'eng@b-org-b.test',
    role: 'engineer',
  });
  orgCapped = await seedTenant(db(), {
    slug: 'b-org-capped',
    name: 'Billing Org Capped',
    email: 'eng@b-org-capped.test',
    role: 'engineer',
  });

  projectA = await seedProject(orgA.orgId, orgA.userId);
  projectCapped = await seedProject(orgCapped.orgId, orgCapped.userId);
});

// ─────────────────────────────────────────────────────────────────────────────
// (1) USAGE METERING on calc-save.
// ─────────────────────────────────────────────────────────────────────────────
describe('(1) calc-save records a calc_run usage event for the right org', () => {
  it('a successful POST /api/calculations records exactly ONE calc_run event, org-scoped', async () => {
    const before = await db()
      .prepare(`SELECT COUNT(*) AS n FROM usage_events WHERE org_id = ? AND meter_key = 'calc_run'`)
      .bind(orgA.orgId)
      .first<{ n: number }>();

    const { status, json } = await callJson('POST', '/api/calculations', {
      token: orgA.token,
      body: {
        projectId: projectA,
        calcType: 'MANUAL_J',
        inputs: { x: 1 },
        outputs: { y: 2 },
        engineVersion: 'manualJ8-ts-1.1.0',
      },
    });
    expect(status).toBe(201);
    expect(json.id).toBeTruthy();

    // Exactly one new calc_run event, owned by org-A, source_ref = the calc id.
    const after = await db()
      .prepare(
        `SELECT id, org_id, source_ref, quantity FROM usage_events
         WHERE org_id = ? AND meter_key = 'calc_run' AND source_ref = ?`,
      )
      .bind(orgA.orgId, json.id)
      .all<{ id: string; org_id: string; source_ref: string; quantity: number }>();
    expect(after.results).toHaveLength(1);
    expect(after.results[0].org_id).toBe(orgA.orgId);
    expect(after.results[0].source_ref).toBe(json.id);
    expect(after.results[0].quantity).toBe(1);

    // And the org-A meter total grew by exactly 1 (no double-count, no leak).
    const total = await db()
      .prepare(`SELECT COUNT(*) AS n FROM usage_events WHERE org_id = ? AND meter_key = 'calc_run'`)
      .bind(orgA.orgId)
      .first<{ n: number }>();
    expect(Number(total?.n)).toBe(Number(before?.n) + 1);
  });

  it('the event landed under org-A ONLY — org-B has no calc_run event for that source', async () => {
    // Pull the most recent org-A calc_run source_ref and confirm org-B owns no
    // row for it. Cross-tenant proof at the metering layer.
    const latest = await db()
      .prepare(
        `SELECT source_ref FROM usage_events
         WHERE org_id = ? AND meter_key = 'calc_run'
         ORDER BY occurred_at DESC LIMIT 1`,
      )
      .bind(orgA.orgId)
      .first<{ source_ref: string }>();
    expect(latest?.source_ref).toBeTruthy();

    const leak = await db()
      .prepare(
        `SELECT COUNT(*) AS n FROM usage_events WHERE org_id = ? AND source_ref = ?`,
      )
      .bind(orgB.orgId, latest!.source_ref)
      .first<{ n: number }>();
    expect(Number(leak?.n)).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (1b) The gate is NON-BREAKING by default, and DENIES only when configured.
// ─────────────────────────────────────────────────────────────────────────────
describe('(1b) entitlement gate: default-allow, then block when a hard cap is exceeded', () => {
  it('default-allow: org-A (no entitlement row) saves a calc → 201, not 402', async () => {
    const { status } = await callJson('POST', '/api/calculations', {
      token: orgA.token,
      body: {
        projectId: projectA,
        calcType: 'MANUAL_D',
        inputs: { a: 1 },
        outputs: { b: 2 },
        engineVersion: 'manualD-1.0',
      },
    });
    expect(status).toBe(201);
  });

  it('block-cap configured + exceeded → calc POST returns 402 with a clear message', async () => {
    // Configure a BLOCKING hard cap of 1 calc_run (lifetime) for orgCapped, then
    // pre-fill usage to the cap so the next calc is over it.
    await seedPlanEntitlement(db(), {
      orgId: orgCapped.orgId,
      meterKey: 'calc_run',
      hardCap: 1,
      enforcement: 'block',
      period: 'lifetime',
    });
    // Seed one usage event so used (1) >= hard_cap (1) → blocked.
    await db()
      .prepare(
        `INSERT INTO usage_events (id, org_id, meter_key, quantity, unit, source_ref)
         VALUES (?, ?, 'calc_run', 1, 'count', ?)`,
      )
      .bind(generateId(), orgCapped.orgId, generateId())
      .run();

    const { status, json } = await callJson('POST', '/api/calculations', {
      token: orgCapped.token,
      body: {
        projectId: projectCapped,
        calcType: 'MANUAL_J',
        inputs: { x: 9 },
        outputs: { y: 9 },
        engineVersion: 'manualJ8-ts-1.1.0',
      },
    });
    expect(status).toBe(402);
    expect(json.code).toBe('entitlement_exceeded');
    expect(json.meter).toBe('calc_run');
    expect(typeof json.error).toBe('string');
    expect(json.error.length).toBeGreaterThan(0);
  });

  it('the 402 did NOT write a calc row OR a usage event for the capped org beyond the cap', async () => {
    // No calc row landed on the capped project (the gate rejected pre-INSERT).
    const calcs = await db()
      .prepare(`SELECT COUNT(*) AS n FROM calculations WHERE project_id = ?`)
      .bind(projectCapped)
      .first<{ n: number }>();
    expect(Number(calcs?.n)).toBe(0);

    // Usage stays at the single pre-seeded event (the blocked calc never metered).
    const usage = await db()
      .prepare(
        `SELECT COUNT(*) AS n FROM usage_events WHERE org_id = ? AND meter_key = 'calc_run'`,
      )
      .bind(orgCapped.orgId)
      .first<{ n: number }>();
    expect(Number(usage?.n)).toBe(1);
  });

  it("the cap is org-scoped: orgA (no cap) still saves calcs while orgCapped is blocked", async () => {
    const { status } = await callJson('POST', '/api/calculations', {
      token: orgA.token,
      body: {
        projectId: projectA,
        calcType: 'MANUAL_J',
        inputs: { x: 2 },
        outputs: { y: 3 },
        engineVersion: 'manualJ8-ts-1.1.0',
      },
    });
    expect(status).toBe(201);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (2) WEBHOOK → D1 PROJECTION pipe — idempotent + org-scoped.
// ─────────────────────────────────────────────────────────────────────────────
describe('(2) applyWebhookProjection is idempotent and org-scoped', () => {
  const SUB_REF = 'stripe:sub_projtest';
  const INV_REF = 'stripe:in_projtest';

  it('first apply INSERTs a subscription + invoice for the trusted org', async () => {
    const r1 = await applyWebhookProjection(db(), orgA.orgId, 'stripe', {
      subscription: {
        providerSubscriptionRef: SUB_REF,
        status: 'active',
        currentPeriodEnd: '2026-12-31',
      },
      invoice: {
        providerInvoiceRef: INV_REF,
        amountMinor: 4900,
        currency: 'USD',
        status: 'open',
      },
    });
    expect(r1.applied).toBe(true);
    expect(r1.subscription).toBe('inserted');
    expect(r1.invoice).toBe('inserted');
    expect(r1.orgId).toBe(orgA.orgId);

    const sub = await db()
      .prepare(`SELECT org_id, status FROM subscriptions WHERE provider_subscription_ref = ?`)
      .bind(SUB_REF)
      .all<{ org_id: string; status: string }>();
    expect(sub.results).toHaveLength(1);
    expect(sub.results[0].org_id).toBe(orgA.orgId);

    const inv = await db()
      .prepare(`SELECT org_id, status FROM invoices WHERE provider_invoice_ref = ?`)
      .bind(INV_REF)
      .all<{ org_id: string; status: string }>();
    expect(inv.results).toHaveLength(1);
    expect(inv.results[0].org_id).toBe(orgA.orgId);
  });

  it('re-apply of the SAME refs is idempotent — UPDATEs in place, no duplicate rows', async () => {
    const r2 = await applyWebhookProjection(db(), orgA.orgId, 'stripe', {
      subscription: { providerSubscriptionRef: SUB_REF, status: 'past_due' },
      invoice: { providerInvoiceRef: INV_REF, status: 'paid' },
    });
    expect(r2.subscription).toBe('updated');
    expect(r2.invoice).toBe('updated');

    const subCount = await db()
      .prepare(`SELECT COUNT(*) AS n FROM subscriptions WHERE provider_subscription_ref = ?`)
      .bind(SUB_REF)
      .first<{ n: number }>();
    expect(Number(subCount?.n)).toBe(1); // still ONE row

    const invCount = await db()
      .prepare(`SELECT COUNT(*) AS n FROM invoices WHERE provider_invoice_ref = ?`)
      .bind(INV_REF)
      .first<{ n: number }>();
    expect(Number(invCount?.n)).toBe(1); // still ONE row

    // Status transitions were mirrored.
    const sub = await db()
      .prepare(`SELECT status FROM subscriptions WHERE provider_subscription_ref = ?`)
      .bind(SUB_REF)
      .first<{ status: string }>();
    expect(sub?.status).toBe('past_due');
    const inv = await db()
      .prepare(`SELECT status FROM invoices WHERE provider_invoice_ref = ?`)
      .bind(INV_REF)
      .first<{ status: string }>();
    expect(inv?.status).toBe('paid');
  });

  it('a projection CANNOT write into another org: org-B applying org-A refs touches org-A rows? NO — it writes its OWN scoped row', async () => {
    // Apply the SAME subscription ref but with orgB as the trusted org. Because
    // the existence check is org-scoped, orgB does NOT see org-A's row and so
    // INSERTs a fresh row under org-B — it CANNOT mutate org-A's subscription.
    const rB = await applyWebhookProjection(db(), orgB.orgId, 'stripe', {
      subscription: { providerSubscriptionRef: SUB_REF, status: 'canceled' },
    });
    expect(rB.subscription).toBe('inserted');
    expect(rB.orgId).toBe(orgB.orgId);

    // Org-A's row is UNTOUCHED — still past_due from the previous test.
    const aRow = await db()
      .prepare(
        `SELECT status FROM subscriptions
         WHERE provider_subscription_ref = ? AND org_id = ?`,
      )
      .bind(SUB_REF, orgA.orgId)
      .first<{ status: string }>();
    expect(aRow?.status).toBe('past_due'); // NOT 'canceled'

    // Org-B's own row is the canceled one.
    const bRow = await db()
      .prepare(
        `SELECT status FROM subscriptions
         WHERE provider_subscription_ref = ? AND org_id = ?`,
      )
      .bind(SUB_REF, orgB.orgId)
      .first<{ status: string }>();
    expect(bRow?.status).toBe('canceled');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (2b) projectWebhookOutcome resolves org SERVER-SIDE and refuses unknown refs.
// ─────────────────────────────────────────────────────────────────────────────
describe('(2b) projectWebhookOutcome trusts only stored mappings, never the body', () => {
  it('an UNKNOWN provider_subscription_ref is unresolved — NOTHING is written', async () => {
    const before = await db()
      .prepare(`SELECT COUNT(*) AS n FROM subscriptions`)
      .first<{ n: number }>();

    // Note: even though the body carries orgId, projectWebhookOutcome ignores it
    // and resolves only from a stored ref → here there is none.
    const outcome: WebhookOutcome = {
      ok: true,
      handled: true,
      subscription: {
        providerSubscriptionRef: 'stripe:sub_NEVER_SEEN',
        status: 'active',
        orgId: orgB.orgId, // body claim — MUST be ignored
      },
    };
    const r = await projectWebhookOutcome(db(), 'stripe', outcome);
    expect(r.applied).toBe(false);
    expect(r.orgId).toBeNull();
    expect(r.subscription).toBe('unresolved');

    const after = await db()
      .prepare(`SELECT COUNT(*) AS n FROM subscriptions`)
      .first<{ n: number }>();
    expect(Number(after?.n)).toBe(Number(before?.n)); // no row created
  });

  it('a KNOWN ref resolves to the org WE stamped, ignoring any body orgId claim', async () => {
    const KNOWN = 'erp:contract_known_resolve';
    // Seed an ERP subscription owned by org-A (the trusted mapping). Uses a
    // DIFFERENT provider than test (2)'s stripe row so the one-active-sub-per-
    // (org,provider) partial unique index isn't tripped — org-A may hold one
    // live subscription per provider rail.
    await db()
      .prepare(
        `INSERT INTO subscriptions (id, org_id, provider, provider_subscription_ref, status)
         VALUES (?, ?, 'erp', ?, 'active')`,
      )
      .bind(generateId(), orgA.orgId, KNOWN)
      .run();

    // A webhook claiming orgB in the body — the resolver must still pick orgA.
    const outcome: WebhookOutcome = {
      ok: true,
      handled: true,
      subscription: {
        providerSubscriptionRef: KNOWN,
        status: 'past_due',
        orgId: orgB.orgId, // forged claim — ignored
      },
    };
    const r = await projectWebhookOutcome(db(), 'erp', outcome);
    expect(r.applied).toBe(true);
    expect(r.orgId).toBe(orgA.orgId); // resolved from stored mapping, NOT body
    expect(r.subscription).toBe('updated');

    // org-B did NOT get a row for that ref.
    const bLeak = await db()
      .prepare(
        `SELECT COUNT(*) AS n FROM subscriptions
         WHERE provider_subscription_ref = ? AND org_id = ?`,
      )
      .bind(KNOWN, orgB.orgId)
      .first<{ n: number }>();
    expect(Number(bLeak?.n)).toBe(0);
  });

  it('hasProjection: a stub outcome (handled:false, no projection) → false → 202 no-op path unchanged', () => {
    const stub: WebhookOutcome = { ok: true, handled: false, note: 'manual webhook received but not wired' };
    expect(hasProjection(stub)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (2c) The PUBLIC webhook route still 202s with the dormant stub (no projection).
// ─────────────────────────────────────────────────────────────────────────────
describe('(2c) POST /api/webhooks/:provider — stub path is byte-unchanged', () => {
  it('the manual stub returns handled:false and NO projection field', async () => {
    const res = await call('POST', '/api/webhooks/manual', {
      body: { anything: true },
    });
    expect(res.status).toBe(202);
    const json = (await res.json()) as { received: boolean; handled: boolean; projection?: unknown };
    expect(json.received).toBe(true);
    expect(json.handled).toBe(false);
    expect(json.projection).toBeUndefined(); // stub → hasProjection false → skipped
  });

  it('the webhook route is PUBLIC (no bearer) — not 401', async () => {
    const res = await call('POST', '/api/webhooks/stripe', { body: {} });
    expect(res.status).toBe(202);
  });
});

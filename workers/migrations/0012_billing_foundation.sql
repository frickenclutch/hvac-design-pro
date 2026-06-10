-- 0012_billing_foundation.sql — provider-agnostic billing / subscription /
-- usage-metering foundation. In-band, primed for real integrations (Stripe,
-- ERP, ILP) without coupling the core to any one provider.
--
-- SCHEMA RECONCILIATION (in-band bug fix):
--   organisations.billing_status was queried by routes/platform.ts but lived
--   in NO migration (prod out-of-band ALTER — same drift class as
--   is_platform_admin / base audit_log table, see 0008). Fixed by adding the
--   column to the 0001 organisations CREATE TABLE (no-op on prod via
--   CREATE TABLE IF NOT EXISTS; a fresh rebuild now gets it). This file does
--   NOT re-ALTER it — SQLite has no ADD COLUMN IF NOT EXISTS, so a defensive
--   re-add would error where the column already exists. The fix lives entirely
--   in the 0001 edit, exactly as 0008 documents for is_platform_admin; this
--   header is the reconciliation record.
--
-- ISOLATION: every table below is ORG-OWNED. org_id NOT NULL + indexed.
-- Every query MUST scope by the SESSION-DERIVED org (see
-- scripts/check-tenant-scoping.mjs — the four real org-owned tables are added
-- to STRICT_TABLES). plan_entitlements carries a sentinel org_id='*' for
-- plan-wide rules and is documented as an explicit carve-out there.
--
-- PROVIDER-AGNOSTIC: `provider` is a free-text discriminator; provider refs
-- live in opaque *_ref columns + a metadata JSON blob. Stripe (cus_/sub_/in_),
-- ERP (external invoice no.), ILP (payment pointer / stream id) all fit with
-- NO schema change. Connecting a real provider later is config + credentials.
--
-- NON-BREAKING GATING: usage metering enforces NOTHING until a
-- plan_entitlements row is explicitly configured (checkEntitlement
-- default-allows on absence). Existing prod flows are completely unaffected.
--
-- LEDGERS: usage_events + invoices are APPEND-ONLY (audit/repro parity with
-- calculations — never UPDATE, only INSERT). subscriptions / payment_methods /
-- plan_entitlements are mutable current-state rows (updated_at).
--
-- SAFETY: purely additive. Every statement is CREATE ... IF NOT EXISTS.

-- ── SUBSCRIPTIONS ───────────────────────────────────────────────────────────
-- Current-state subscription per org (one active row per org in practice; the
-- table allows history rows distinguished by status). provider + provider_*_ref
-- bind to whatever rail owns the sub: Stripe (sub_.../cus_...), ERP (contract
-- no.), ILP (stream/agreement id). `plan` is a free-text plan KEY (NOT an enum)
-- so new markets/plans need no DDL.
CREATE TABLE IF NOT EXISTS subscriptions (
    id                        TEXT PRIMARY KEY,
    org_id                    TEXT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    provider                  TEXT NOT NULL DEFAULT 'manual'
        CHECK (provider IN ('manual','stripe','erp','ilp')),
    provider_customer_ref     TEXT,          -- Stripe cus_... / ERP account / ILP wallet
    provider_subscription_ref TEXT,          -- Stripe sub_... / ERP contract / ILP stream
    plan                      TEXT NOT NULL DEFAULT 'free_beta',  -- free-text plan key
    status                    TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('trialing','active','past_due','canceled','incomplete','paused')),
    current_period_start      TEXT,
    current_period_end        TEXT,
    cancel_at                 TEXT,
    canceled_at               TEXT,
    metadata                  TEXT NOT NULL DEFAULT '{}',  -- provider-specific JSON
    created_at                TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at                TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_subscriptions_org      ON subscriptions(org_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_provider ON subscriptions(provider, provider_subscription_ref);
-- One live subscription per org per provider (history rows are canceled).
CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_org_active
    ON subscriptions(org_id, provider)
    WHERE status IN ('trialing','active','past_due','paused','incomplete');

-- ── PAYMENT METHODS ─────────────────────────────────────────────────────────
-- A payment instrument on file. method_type is OPEN (card/ach/erp_invoice/
-- ilp_pointer/...); provider_ref holds the tokenised handle (Stripe pm_...,
-- ERP payer id, ILP payment pointer `$wallet...`). NEVER store raw PAN / full
-- account numbers — only provider tokens / pointers.
CREATE TABLE IF NOT EXISTS payment_methods (
    id                  TEXT PRIMARY KEY,
    org_id              TEXT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    provider            TEXT NOT NULL DEFAULT 'manual'
        CHECK (provider IN ('manual','stripe','erp','ilp')),
    method_type         TEXT NOT NULL,     -- 'card' | 'ach' | 'erp_invoice' | 'ilp_pointer' | ...
    provider_ref        TEXT,              -- pm_... / payer id / $payment.pointer
    display_label       TEXT,              -- "Visa .4242" / "NET-30 invoice" / pointer host
    is_default          INTEGER NOT NULL DEFAULT 0,
    status              TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active','expired','removed')),
    metadata            TEXT NOT NULL DEFAULT '{}',
    created_at          TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_payment_methods_org ON payment_methods(org_id);
-- At most one default method per org.
CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_methods_org_default
    ON payment_methods(org_id) WHERE is_default = 1;

-- ── USAGE EVENTS (the FLEXIBLE generic meter) ───────────────────────────────
-- APPEND-ONLY. One row per metered occurrence of ANY unit. meter_key is
-- free-text so a new metered unit (permit_packet, calc_run, seat, api_call, ...)
-- needs ZERO DDL. source_ref ties the event back to the entity that caused it
-- (calc id, permit packet id, ...) for audit/repro. quantity is INTEGER-of-unit
-- by convention (1 packet, 1 calc, N api_calls). NEVER UPDATE a row —
-- corrections are new rows (e.g. negative quantity reversal).
CREATE TABLE IF NOT EXISTS usage_events (
    id          TEXT PRIMARY KEY,
    org_id      TEXT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    meter_key   TEXT NOT NULL,             -- 'permit_packet' | 'calc_run' | 'seat' | 'api_call' | ...
    quantity    INTEGER NOT NULL DEFAULT 1,
    unit        TEXT NOT NULL DEFAULT 'count',
    source_ref  TEXT,                       -- id of the calc/packet/etc. that generated this
    occurred_at TEXT NOT NULL DEFAULT (datetime('now')),
    metadata    TEXT NOT NULL DEFAULT '{}',
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
-- Hot path: aggregate a meter for an org over a time window.
CREATE INDEX IF NOT EXISTS idx_usage_events_org_meter_time
    ON usage_events(org_id, meter_key, occurred_at);
-- Idempotent ingestion: a (org, meter, source_ref) is recorded once. Partial
-- so events without a source_ref (ad-hoc counters) aren't forced unique.
CREATE UNIQUE INDEX IF NOT EXISTS idx_usage_events_dedupe
    ON usage_events(org_id, meter_key, source_ref) WHERE source_ref IS NOT NULL;

-- ── PLAN ENTITLEMENTS / LIMITS (basis for NON-BREAKING gating) ──────────────
-- The configured allowance for a (scope, meter_key). scope is EITHER a plan key
-- (applies to every org on that plan) OR a specific org_id override. A row's
-- ABSENCE means "unlimited / ungated" — checkEntitlement default-ALLOWS, so
-- nothing in prod is gated until an admin/L0 writes a row here.
-- org_id is NOT NULL for tenant-scoping uniformity; plan-wide rows use a
-- sentinel org_id = '*' (never a real session-derived org id — those are UUIDs
-- — and the scope_kind discriminator makes the intent explicit).
CREATE TABLE IF NOT EXISTS plan_entitlements (
    id                  TEXT PRIMARY KEY,
    org_id              TEXT NOT NULL,      -- real org id, OR '*' for plan-wide
    scope_kind          TEXT NOT NULL DEFAULT 'org'
        CHECK (scope_kind IN ('org','plan')),
    plan                TEXT,               -- set when scope_kind='plan'
    meter_key           TEXT NOT NULL,
    included_quantity   INTEGER,            -- soft allowance (metered, not blocked)
    hard_cap            INTEGER,            -- block when exceeded; NULL = no hard cap
    period              TEXT NOT NULL DEFAULT 'monthly'
        CHECK (period IN ('monthly','daily','lifetime')),
    enforcement         TEXT NOT NULL DEFAULT 'meter'
        CHECK (enforcement IN ('meter','block')),  -- 'meter'=count only, 'block'=gate
    metadata            TEXT NOT NULL DEFAULT '{}',
    created_at          TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_plan_entitlements_org_meter
    ON plan_entitlements(org_id, meter_key);
CREATE INDEX IF NOT EXISTS idx_plan_entitlements_plan_meter
    ON plan_entitlements(plan, meter_key) WHERE scope_kind = 'plan';

-- ── INVOICES (records seam) ─────────────────────────────────────────────────
-- APPEND-ONLY record of an invoice issued by SOME provider. The worker does NOT
-- generate invoices — it MIRRORS them (created via webhook stub or future
-- sync). provider_invoice_ref binds to Stripe in_..., ERP external invoice no.,
-- ILP settlement receipt. amount is INTEGER MINOR UNITS (cents) to avoid float
-- drift; currency is ISO-4217 for multi-market.
CREATE TABLE IF NOT EXISTS invoices (
    id                   TEXT PRIMARY KEY,
    org_id               TEXT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    subscription_id      TEXT REFERENCES subscriptions(id),
    provider             TEXT NOT NULL DEFAULT 'manual'
        CHECK (provider IN ('manual','stripe','erp','ilp')),
    provider_invoice_ref TEXT,             -- in_... / ERP no. / ILP receipt
    amount_minor         INTEGER NOT NULL DEFAULT 0,   -- cents (minor units)
    currency             TEXT NOT NULL DEFAULT 'USD',  -- ISO-4217
    status               TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft','open','paid','void','uncollectible')),
    period_start         TEXT,
    period_end           TEXT,
    issued_at            TEXT,
    metadata             TEXT NOT NULL DEFAULT '{}',
    created_at           TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_invoices_org_time ON invoices(org_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_provider_ref
    ON invoices(provider, provider_invoice_ref) WHERE provider_invoice_ref IS NOT NULL;

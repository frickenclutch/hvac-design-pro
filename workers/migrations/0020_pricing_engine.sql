-- 0020_pricing_engine.sql — admin-configured, per-org real pricing sources.
--
-- WHY
-- The cost estimate (engines/costEstimator.ts) runs the user's inputs against
-- hardcoded national-average price tables — a disclaimed ballpark, NOT the real
-- price of the specific unit/item, and NOT the chosen retailer's pricing. This
-- gives an org's admins a way to plug REAL pricing into the platform: upload a
-- distributor price-list CSV now (live in this phase), or register a
-- webhook/REST source for live inventory-pricing oracles (execution lands in a
-- later phase). Until a source is active, the ballpark stays as the fallback
-- and users are told to have their retailer configure integrations.
--
-- WHAT
-- pricing_sources — one row per configured integration for an org.
--   kind   csv | webhook | api
--   status active  = feeding real prices into estimates
--          pending = registered but not yet live (webhook/api this phase)
--          disabled= admin turned it off
--   config non-secret JSON only (endpoint URL, csv filename/rowcount). NO
--          secrets stored here — webhook/api credentials + live execution land
--          in the next phase with encrypted-at-rest handling (same AES-GCM as
--          the MFA secrets).
-- pricing_items — normalized price rows the estimator resolves. From CSV now;
--   webhook/api feed the same table later. `match_key` is the lookup the
--   estimator builds per line (e.g. equipment:heat_pump:3.0).
--
-- Both are org-owned (org_id NOT NULL) and registered in the tenant-scoping
-- guard's STRICT_TABLES — every query is scoped by the session org.
--
-- WHY ALTER/CREATE-ONLY here: genuinely new, forward-authored tables (same
-- class as 0009/0019). CREATE TABLE IF NOT EXISTS is a no-op on re-apply.

CREATE TABLE IF NOT EXISTS pricing_sources (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('csv', 'webhook', 'api')),
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('active', 'pending', 'disabled')),
    config TEXT NOT NULL DEFAULT '{}',
    item_count INTEGER NOT NULL DEFAULT 0,
    created_by TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_pricing_sources_org ON pricing_sources(org_id);

CREATE TABLE IF NOT EXISTS pricing_items (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL,
    source_id TEXT NOT NULL,
    category TEXT NOT NULL,
    match_key TEXT,
    model TEXT,
    description TEXT,
    unit TEXT NOT NULL DEFAULT 'each',
    unit_price REAL NOT NULL,
    currency TEXT NOT NULL DEFAULT 'USD',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_pricing_items_org ON pricing_items(org_id);
CREATE INDEX IF NOT EXISTS idx_pricing_items_lookup ON pricing_items(org_id, match_key);

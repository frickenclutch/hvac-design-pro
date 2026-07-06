-- Migration 0013: Org-Owned Product / Inventory Catalog
-- =====================================================================
-- ISOLATION: every table here is ORG-OWNED. org_id is NOT NULL and
-- indexed. Every read/write MUST be scoped by the SESSION-derived org
-- (c.get('user').orgId) — NEVER a client-supplied org_id. These tables
-- are added to workers/scripts/check-tenant-scoping.mjs STRICT_TABLES;
-- an unscoped query is a BUILD FAILURE, not a review miss.
--
-- The catalog is ORG-OWNED by deliberate decision (each org owns its own
-- inventory). A shared cross-tenant reference catalog is an explicit
-- FUTURE decision and is intentionally NOT modeled here.
--
-- Purely additive (CREATE ... IF NOT EXISTS), matching the prior pattern.
-- Single wide table for v1: HVAC-performance columns are NULLABLE and
-- populated only for category='hvac_equipment'; they exist as real
-- columns (not just metadata JSON) because the Manual S engine consumes
-- them with a typed contract. All other category-specific attributes
-- live in metadata JSON.
--
-- D1 reality: no FK constraints (consistent with the rest of the schema —
-- D1 doesn't enforce them). org_id integrity is enforced in the app layer.
-- =====================================================================

CREATE TABLE IF NOT EXISTS catalog_products (
  id              TEXT PRIMARY KEY,
  org_id          TEXT NOT NULL,

  -- Classification. Free-text with a soft CHECK seed list; widen via a
  -- future additive migration. 'other' is the escape hatch for v1.
  category        TEXT NOT NULL DEFAULT 'other'
                    CHECK (category IN ('hvac_equipment','water_heater','pipe_fitting','other')),

  -- Core catalog identity / commerce fields
  sku             TEXT NOT NULL,
  name            TEXT NOT NULL,
  brand           TEXT,
  model           TEXT,
  description     TEXT,

  price_minor     INTEGER NOT NULL DEFAULT 0,   -- minor units (e.g. cents); avoids float money
  currency        TEXT NOT NULL DEFAULT 'USD',  -- ISO-4217
  stock_qty       INTEGER NOT NULL DEFAULT 0,
  unit            TEXT NOT NULL DEFAULT 'each',  -- each | ft | box | pallet ...

  active          INTEGER NOT NULL DEFAULT 1,    -- 0/1 soft-disable; never hard-delete inventory
  metadata        TEXT,                          -- JSON: category-specific extras

  -- ── NULLABLE HVAC-performance columns (category='hvac_equipment') ──
  -- These mirror the Manual S engine input shapes (engines/manualS.ts).
  equipment_type        TEXT,     -- 'ac' | 'heat_pump' | 'furnace_gas' | 'furnace_electric'
  total_cooling_btu     INTEGER,  -- CoolingEquipmentInput.totalCoolingCapacityBtu
  sensible_cooling_btu  INTEGER,  -- CoolingEquipmentInput.sensibleCoolingCapacityBtu
  ahri_ref              TEXT,     -- CoolingEquipmentInput.ahriRefNumber
  heating_btu           INTEGER,  -- HeatingEquipmentInput.heatingCapacityBtu
  heating_cap_47        INTEGER,  -- HeatingEquipmentInput.heatingCapacityAt47Btu (heat pump)
  heating_cap_17        INTEGER,  -- HeatingEquipmentInput.heatingCapacityAt17Btu (heat pump)
  afue                  REAL,     -- HeatingEquipmentInput.afue (furnace efficiency, informational)

  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Idempotent ingestion target: SKU is unique WITHIN an org (never global).
-- The bulk-upsert endpoint conflicts on (org_id, sku) to stay idempotent.
CREATE UNIQUE INDEX IF NOT EXISTS idx_catalog_products_org_sku
  ON catalog_products (org_id, sku);

-- Org-scoped listing.
CREATE INDEX IF NOT EXISTS idx_catalog_products_org
  ON catalog_products (org_id);

-- Org + category filtered listing (the Manual S fetch hits this:
-- org_id = ? AND category = 'hvac_equipment').
CREATE INDEX IF NOT EXISTS idx_catalog_products_org_category
  ON catalog_products (org_id, category);

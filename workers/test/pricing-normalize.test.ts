/**
 * PRICING NORMALIZER — the one validation surface every channel shares.
 *
 * The CSV upload, the public inbound feed (POST /api/pricing/ingest/:id), the
 * admin manual push and any future pull executor all flow through
 * normalizePricingRow(). These tests lock down the JSON side — the DDI Inform
 * feed shape — the way pricing-csv-parse.test.ts locks down the CSV side:
 *
 *   - field ALIASES: a native ERP payload (itemNumber / price / uom /
 *     productGroup …) resolves to our canonical columns without renaming
 *   - the canonical name WINS when a record carries several candidates
 *   - categoryMap buckets supplier product groups into our categories
 *   - the same unit_price hardening as CSV (blank / "$" / 0 / negative /
 *     non-numeric are rejected, never coerced to $0.00), on numbers AND strings
 *   - match_key derivation is byte-identical to what the estimator resolves
 *
 * Pure-function tests: no D1, no harness, so they run on Windows too.
 */
import { describe, it, expect } from 'vitest';
import { normalizePricingItems, normKey, FIELD_ALIASES } from '../src/routes/pricing';

describe('normalizePricingItems — DDI-style payloads (aliases)', () => {
  it('resolves ERP-native property names to canonical fields', () => {
    const { rows, errors } = normalizePricingItems([
      { productGroup: 'equipment', equipmentType: 'heat pump', tons: '3.5', itemNumber: 'DDI-HP42', itemDescription: '3.5-ton HP condenser', uom: 'EA', netPrice: '$5,400.00' },
    ]);
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      category: 'equipment',
      matchKey: 'equipment:heat_pump:3.5',
      model: 'DDI-HP42',
      description: '3.5-ton HP condenser',
      unit: 'EA',
      unitPrice: 5400,
      currency: 'USD',
    });
  });

  it('treats "Unit Price", "unit_price", "UnitPrice" and "unit-price" as the same field', () => {
    for (const key of ['Unit Price', 'unit_price', 'UnitPrice', 'unit-price']) {
      const { rows, errors } = normalizePricingItems([{ category: 'misc', match_key: 'misc:filter', [key]: 65 }]);
      expect(errors, key).toEqual([]);
      expect(rows[0].unitPrice, key).toBe(65);
    }
  });

  it('the canonical field wins when a record carries several candidates', () => {
    // unit_price (canonical) present AND price (alias) present → canonical.
    const { rows } = normalizePricingItems([{ category: 'misc', match_key: 'misc:lineset', unit_price: 185, price: 999 }]);
    expect(rows[0].unitPrice).toBe(185);
  });

  it('accepts numeric JSON values (not just strings) and stringifies them for key derivation', () => {
    const { rows } = normalizePricingItems([{ category: 'equipment', system_type: 'ac_furnace', tonnage: 2.0, unit_price: 3400 }]);
    expect(rows[0].unitPrice).toBe(3400);
    // 2.0 → "2": the estimator's key is `equipment:ac_furnace:2`, never `:2.0`.
    expect(rows[0].matchKey).toBe('equipment:ac_furnace:2');
  });

  it('tolerates "3.5 ton" style tonnage values', () => {
    const { rows } = normalizePricingItems([{ category: 'equipment', system_type: 'heat_pump', tonnage: '3.5 ton', unit_price: 5400 }]);
    expect(rows[0].matchKey).toBe('equipment:heat_pump:3.5');
  });

  it('normalizes "heat pump" / "Mini-Split" system types to the canonical tokens', () => {
    const { rows } = normalizePricingItems([
      { category: 'equipment', system_type: 'Heat Pump', tonnage: 3, unit_price: 4850 },
      { category: 'equipment', system_type: 'Mini-Split', tonnage: 2, unit_price: 3600 },
    ]);
    expect(rows.map((r) => r.matchKey)).toEqual(['equipment:heat_pump:3', 'equipment:mini_split:2']);
  });
});

describe('normalizePricingItems — categoryMap (supplier product groups)', () => {
  it('maps a supplier product group to our category', () => {
    const { rows, errors } = normalizePricingItems(
      [{ productGroup: 'HP-COND', system_type: 'heat_pump', tonnage: 3, unit_price: 4850 }],
      { categoryMap: { 'hp-cond': 'equipment' } },
    );
    expect(errors).toEqual([]);
    expect(rows[0].category).toBe('equipment');
    expect(rows[0].matchKey).toBe('equipment:heat_pump:3');
  });

  it('rejects an unmapped product group with the row-labelled error', () => {
    const { rows, errors } = normalizePricingItems([{ productGroup: 'WIDGETS', unit_price: 10 }], { categoryMap: { 'hp-cond': 'equipment' } });
    expect(rows).toHaveLength(0);
    expect(errors[0]).toBe('Item 1: unknown category "WIDGETS"');
  });

  it('does not let categoryMap override an already-valid category', () => {
    const { rows } = normalizePricingItems([{ category: 'controls', match_key: 'controls:thermostat', unit_price: 245 }], { categoryMap: { controls: 'misc' } });
    expect(rows[0].category).toBe('controls');
  });
});

describe('normalizePricingItems — unit_price hardening (same rules as CSV)', () => {
  const base = { category: 'misc', match_key: 'misc:filter' };

  it('REJECTS a missing / null / blank / "$"-only price instead of coercing to $0.00', () => {
    for (const bad of [undefined, null, '', '   ', '$']) {
      const { rows, errors } = normalizePricingItems([{ ...base, unit_price: bad }]);
      expect(rows, String(bad)).toHaveLength(0);
      expect(errors[0], String(bad)).toBe('Item 1: missing unit_price');
    }
  });

  it('REJECTS a numeric 0 and a "$0.00" string', () => {
    for (const zero of [0, '0', '$0.00']) {
      const { rows, errors } = normalizePricingItems([{ ...base, unit_price: zero }]);
      expect(rows, String(zero)).toHaveLength(0);
      expect(errors[0], String(zero)).toBe('Item 1: unit_price must be greater than 0');
    }
  });

  it('REJECTS negative and non-numeric prices and echoes the original cell', () => {
    expect(normalizePricingItems([{ ...base, unit_price: -50 }]).errors[0]).toContain('invalid unit_price');
    const bad = normalizePricingItems([{ ...base, unit_price: 'CALL' }]);
    expect(bad.errors[0]).toContain('invalid unit_price');
    expect(bad.errors[0]).toContain('CALL');
    // A boolean or nested object is never a price.
    expect(normalizePricingItems([{ ...base, unit_price: true }]).errors[0]).toContain('invalid unit_price');
    expect(normalizePricingItems([{ ...base, unit_price: { amount: 5 } }]).errors[0]).toContain('missing unit_price');
  });

  it('ACCEPTS currency-formatted strings exactly', () => {
    expect(normalizePricingItems([{ ...base, unit_price: '$1,234.50' }]).rows[0].unitPrice).toBe(1234.5);
    expect(normalizePricingItems([{ ...base, unit_price: '0.75' }]).rows[0].unitPrice).toBe(0.75);
  });
});

describe('normalizePricingItems — payload shape', () => {
  it('rejects a non-array', () => {
    expect(normalizePricingItems({ items: [] }).errors).toEqual(['items must be an array']);
    expect(normalizePricingItems('nope').errors).toEqual(['items must be an array']);
  });

  it('skips non-object items with a labelled error and keeps loading the rest', () => {
    const { rows, errors } = normalizePricingItems([
      'junk',
      null,
      [1, 2],
      { category: 'controls', match_key: 'controls:thermostat', unit_price: 245 },
    ]);
    expect(rows).toHaveLength(1);
    expect(errors).toEqual(['Item 1: not an object', 'Item 2: not an object', 'Item 3: not an object']);
  });

  it('bounds free-text fields so an oversized feed cannot bloat pricing_items', () => {
    const { rows } = normalizePricingItems([{ category: 'misc', unit_price: 5, model: 'x'.repeat(500), description: 'y'.repeat(500), unit: 'z'.repeat(50) }]);
    expect(rows[0].model).toHaveLength(120);
    expect(rows[0].description).toHaveLength(240);
    expect(rows[0].unit).toHaveLength(16);
  });

  it('honours an explicit match_key verbatim (lowercased) and derives category:model otherwise', () => {
    const { rows } = normalizePricingItems([
      { category: 'misc', matchKey: 'MISC:LineSet', unit_price: 185 },
      { category: 'controls', model: 'Ecobee', unit_price: 245 },
      { category: 'labor', unit_price: 90 },
    ]);
    expect(rows.map((r) => r.matchKey)).toEqual(['misc:lineset', 'controls:ecobee', 'labor']);
  });
});

describe('normKey / FIELD_ALIASES invariants', () => {
  it('normKey strips everything but [a-z0-9] and lowercases', () => {
    expect(normKey(' Unit_Price ')).toBe('unitprice');
    expect(normKey('Item-No.')).toBe('itemno');
  });

  it('every alias is already in normalized form (otherwise it could never match)', () => {
    for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
      for (const a of aliases) expect(normKey(a), `${field}:${a}`).toBe(a);
    }
  });

  it('no alias is claimed by two canonical fields', () => {
    const seen = new Map<string, string>();
    for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
      for (const a of aliases) {
        expect(seen.has(a), `${a} in both ${seen.get(a)} and ${field}`).toBe(false);
        seen.set(a, field);
      }
    }
  });
});

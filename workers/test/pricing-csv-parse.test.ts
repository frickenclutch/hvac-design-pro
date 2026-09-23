/**
 * PRICING CSV PARSE — guards the unit_price validation boundary.
 *
 * REGRESSION THIS LOCKS DOWN: `Number('') === 0`. The original check was
 *
 *     const raw = cell.replace(/[$,]/g, '');
 *     if (!Number.isFinite(Number(raw)) || Number(raw) < 0) skip;
 *
 * which ACCEPTS a blank cell as a legitimate $0.00. A distributor export with
 * empty price cells therefore loaded those rows into pricing_items at 0, and
 * costEstimator's resolve() treats any finite mapped price as real — setting
 * LineItem.sourced = true and CostEstimate.hasRealPricing = true. Net effect:
 * a $0.00 line rendered with the green "real" badge under "Your pricing"
 * framing on a customer-facing cost estimate. A fabricated number presented as
 * the organisation's actual distributor pricing.
 *
 * The same coercion hole swallows a "$"-only or whitespace-only cell, so the
 * guard has to run on the RAW string before Number() ever sees it.
 *
 * A literal 0 is also rejected: a distributor price book doesn't carry $0 line
 * items, and a 0 badged as real pricing understates the estimate exactly like
 * the blank-cell case. Omitting the row is the honest representation — the
 * estimator then falls back to its industry-average table.
 *
 * Pure-function test: parsePricingCsv does no I/O, so no harness/D1 needed.
 */
import { describe, it, expect } from 'vitest';
import { parsePricingCsv } from '../src/routes/pricing';

const HEADER = 'category,system_type,tonnage,model,description,unit,unit_price,match_key';

/** Build a one-data-row CSV with the given unit_price cell verbatim. */
function csvWithPrice(priceCell: string): string {
  return `${HEADER}\nequipment,heat_pump,3,ACME-36,3-ton heat pump,each,${priceCell},`;
}

describe('parsePricingCsv — unit_price validation', () => {
  it('REJECTS a blank price cell instead of coercing it to $0.00', () => {
    const { rows, errors } = parsePricingCsv(csvWithPrice(''));
    expect(rows).toHaveLength(0);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('missing unit_price');
    expect(errors[0]).toContain('Row 2');
  });

  it('REJECTS a whitespace-only price cell', () => {
    const { rows, errors } = parsePricingCsv(csvWithPrice('   '));
    expect(rows).toHaveLength(0);
    expect(errors[0]).toContain('missing unit_price');
  });

  it('REJECTS a "$"-only cell (strips to empty, would coerce to 0)', () => {
    const { rows, errors } = parsePricingCsv(csvWithPrice('$'));
    expect(rows).toHaveLength(0);
    expect(errors[0]).toContain('missing unit_price');
  });

  it('REJECTS an explicit 0 — a $0 line must not be badged as real pricing', () => {
    const { rows, errors } = parsePricingCsv(csvWithPrice('0'));
    expect(rows).toHaveLength(0);
    expect(errors[0]).toContain('must be greater than 0');
  });

  it('REJECTS "$0.00" for the same reason', () => {
    const { rows, errors } = parsePricingCsv(csvWithPrice('$0.00'));
    expect(rows).toHaveLength(0);
    expect(errors[0]).toContain('must be greater than 0');
  });

  it('REJECTS a negative price', () => {
    const { rows, errors } = parsePricingCsv(csvWithPrice('-50'));
    expect(rows).toHaveLength(0);
    expect(errors[0]).toContain('invalid unit_price');
  });

  it('REJECTS a non-numeric price and echoes the original cell', () => {
    const { rows, errors } = parsePricingCsv(csvWithPrice('FILL_ME'));
    expect(rows).toHaveLength(0);
    expect(errors[0]).toContain('invalid unit_price');
    expect(errors[0]).toContain('FILL_ME');
  });

  it('ACCEPTS a currency-formatted price and parses it exactly', () => {
    const { rows, errors } = parsePricingCsv(csvWithPrice('"$1,234.50"'));
    expect(errors).toHaveLength(0);
    expect(rows).toHaveLength(1);
    expect(rows[0].unitPrice).toBe(1234.5);
  });

  it('ACCEPTS a plain number and a sub-dollar price', () => {
    expect(parsePricingCsv(csvWithPrice('4850')).rows[0].unitPrice).toBe(4850);
    expect(parsePricingCsv(csvWithPrice('0.75')).rows[0].unitPrice).toBe(0.75);
  });

  it('skips only the offending row — valid rows in the same file still load', () => {
    const csv = [
      HEADER,
      'equipment,heat_pump,3,ACME-36,3-ton heat pump,each,4850,',
      'equipment,heat_pump,4,ACME-48,4-ton heat pump,each,,',
      'controls,,,ECO,Thermostat,each,245,controls:thermostat',
    ].join('\n');
    const { rows, errors } = parsePricingCsv(csv);
    expect(rows).toHaveLength(2);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('Row 3');
    expect(rows.map((r) => r.matchKey)).toEqual(['equipment:heat_pump:3', 'controls:thermostat']);
  });
});

describe('parsePricingCsv — real distributor export tolerance', () => {
  // We tell suppliers they can send their NATIVE wide ERP export rather than
  // hand-stripping it to our 8 columns. That only holds if unknown columns are
  // ignored and header order is irrelevant — lock both down.
  it('ignores unknown columns and does not care about column order', () => {
    const csv = [
      'vendor_item_no,uom,price_class,unit_price,effective_date,category,warehouse,match_key,description',
      'ACME-36-HP,EA,CONTRACT-A,"$4,850.00",2026-07-01,equipment,BURLINGTON,equipment:heat_pump:3,3-ton heat pump',
    ].join('\n');
    const { rows, errors } = parsePricingCsv(csv);
    expect(errors).toHaveLength(0);
    expect(rows).toHaveLength(1);
    expect(rows[0].unitPrice).toBe(4850);
    expect(rows[0].matchKey).toBe('equipment:heat_pump:3');
    expect(rows[0].description).toBe('3-ton heat pump');
  });

  it('accepts mixed-case / padded headers', () => {
    const csv = ' Category , Unit_Price , Match_Key \nmisc,65,misc:filter';
    const { rows, errors } = parsePricingCsv(csv);
    expect(errors).toHaveLength(0);
    expect(rows[0].matchKey).toBe('misc:filter');
    expect(rows[0].unitPrice).toBe(65);
  });
});

describe('parsePricingCsv — match_key derivation (regression guard)', () => {
  it('derives equipment keys WITHOUT a trailing .0, matching the estimator', () => {
    // The estimator snaps tonnage via closestTonnage() and interpolates the
    // NUMBER, so its key is `equipment:heat_pump:2` — never `:2.0`. Number()
    // coercion here must produce the same string or every lookup silently misses.
    const csv = `${HEADER}\nequipment,heat_pump,2.0,ACME-24,2-ton,each,4000,`;
    expect(parsePricingCsv(csv).rows[0].matchKey).toBe('equipment:heat_pump:2');
  });

  it('honours an explicit match_key verbatim (lowercased)', () => {
    const csv = `${HEADER}\nmisc,,,LS-3438,Line set,each,185,MISC:LineSet`;
    expect(parsePricingCsv(csv).rows[0].matchKey).toBe('misc:lineset');
  });

  it('falls back to category:model for non-equipment rows without a match_key', () => {
    const csv = `${HEADER}\ncontrols,,,Ecobee,Thermostat,each,245,`;
    expect(parsePricingCsv(csv).rows[0].matchKey).toBe('controls:ecobee');
  });
});

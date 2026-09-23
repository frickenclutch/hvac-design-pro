/**
 * Cost estimator — real-pricing override guard + quote-line fidelity.
 *
 * WHY THIS EXISTS: the estimator resolves each quote line against the org's
 * configured pricing (routes/pricing.ts → pricing_items). Ingest rejects a
 * $0 / negative row, but the engine is the LAST line before a customer-facing
 * estimate — and an inbound API feed, a manual push or a future pull executor
 * are all separate paths into the same table. So the engine itself must never
 * badge a non-positive price as "real", must not let a bad row shadow a valid
 * one, and must carry the supplier's SKU + cents-precise unit price onto the
 * line so a distributor can quote exactly what was estimated.
 */
import { describe, it, expect } from 'vitest';
import { generateCostEstimate, type CostEstimate, type EstimatorPrice } from '../costEstimator';
import type { WholeHouseResult, DesignConditions } from '../manualJ';

const RESULT: WholeHouseResult = {
  rooms: [],
  totalHeatingBtu: 42000,
  totalCoolingSensible: 26000,
  totalCoolingLatent: 6000,
  totalCoolingBtu: 32000,
  ductLossHeating: 0,
  ductLossCooling: 0,
  ventilationCFM: 60,
  ventilationSensible: 0,
  ventilationLatent: 0,
  recommendedTons: 3,
  sensibleHeatRatio: 0.81,
  aed: { peakLoad: 0, averageLoad: 0, ratio: 1, excursion: 0, pass: true, peakHour: 15 },
};

const CONDITIONS: DesignConditions = {
  outdoorHeatingTemp: 5,
  outdoorCoolingTemp: 91,
  indoorHeatingTemp: 70,
  indoorCoolingTemp: 75,
  outdoorGrains: 100,
  indoorGrains: 65,
  latitude: 43,
  elevation: 300,
  coolingDailyRange: 'medium',
  ductLocation: 'attic',
  ductInsulationR: 8,
  ductLeakagePercent: 5,
  ductLengthFt: 80,
  constructionQuality: 'average',
  numBedrooms: 3,
  totalFloorArea: 1800,
};

const HP3 = 'equipment:heat_pump:3';
/** Industry-average table value for a 3.0-ton heat pump (EQUIPMENT_COST). */
const HP3_AVERAGE = 5200;

function line(est: CostEstimate, prefix: string) {
  const li = est.lineItems.find((l) => l.description.startsWith(prefix));
  if (!li) throw new Error(`no line starting with "${prefix}"`);
  return li;
}

function estimate(items?: EstimatorPrice[]) {
  return generateCostEstimate(RESULT, CONDITIONS, 'heat_pump', 'NY', items);
}

describe('generateCostEstimate — real-pricing override', () => {
  it('no pricing items → industry averages, nothing sourced, hasRealPricing false', () => {
    const est = estimate();
    expect(est.hasRealPricing).toBe(false);
    expect(est.lineItems.every((li) => !li.sourced && li.sourcedModel === undefined)).toBe(true);
    expect(line(est, 'Heat Pump System').unitCost).toBe(HP3_AVERAGE);
    expect(est.disclaimer).toContain('industry-average');
  });

  it('a positive real price overrides the average, flags the line and carries the supplier SKU', () => {
    const est = estimate([{ match_key: HP3, unit_price: 4850, model: '  DDI-HP36  ' }]);
    const equip = line(est, 'Heat Pump System');
    expect(equip.unitCost).toBe(4850);
    expect(equip.totalCost).toBe(4850);
    expect(equip.sourced).toBe(true);
    expect(equip.sourcedModel).toBe('DDI-HP36');
    expect(est.hasRealPricing).toBe(true);
    expect(est.disclaimer).toContain('configured pricing');
    // Only the matched line is sourced; the rest stay on the fallback table.
    expect(est.lineItems.filter((li) => li.sourced)).toHaveLength(1);
  });

  it('is backward-compatible: an empty item list yields the same totals as no list', () => {
    const a = estimate();
    const b = estimate([]);
    expect(b.subtotal).toBe(a.subtotal);
    expect(b.total).toBe(a.total);
    expect(b.hasRealPricing).toBe(false);
  });
});

describe('generateCostEstimate — non-positive prices are NOT real pricing', () => {
  it('a $0 row leaves the fallback in place, adds no badge, and hasRealPricing stays false', () => {
    const est = estimate([{ match_key: HP3, unit_price: 0, model: 'BAD-ROW' }]);
    const equip = line(est, 'Heat Pump System');
    expect(equip.unitCost).toBe(HP3_AVERAGE);
    expect(equip.sourced).toBe(false);
    expect(equip.sourcedModel).toBeUndefined();
    expect(est.hasRealPricing).toBe(false);
    expect(est.disclaimer).toContain('industry-average');
  });

  it('negative, NaN, non-finite and null-key rows are ignored the same way', () => {
    const est = estimate([
      { match_key: HP3, unit_price: -1 },
      { match_key: HP3, unit_price: Number.NaN },
      { match_key: HP3, unit_price: Number.POSITIVE_INFINITY },
      { match_key: null, unit_price: 4000 },
    ]);
    expect(line(est, 'Heat Pump System').unitCost).toBe(HP3_AVERAGE);
    expect(est.hasRealPricing).toBe(false);
  });

  it('a bad row does not shadow a later valid row for the same key', () => {
    const est = estimate([
      { match_key: HP3, unit_price: 0 },
      { match_key: HP3, unit_price: 4850, model: 'DDI-HP36' },
    ]);
    const equip = line(est, 'Heat Pump System');
    expect(equip.unitCost).toBe(4850);
    expect(equip.sourced).toBe(true);
    expect(equip.sourcedModel).toBe('DDI-HP36');
  });

  it('the first VALID row wins per key (stable choice when a book carries duplicates)', () => {
    const est = estimate([
      { match_key: HP3, unit_price: 4850 },
      { match_key: HP3, unit_price: 4700 },
    ]);
    expect(line(est, 'Heat Pump System').unitCost).toBe(4850);
  });
});

describe('generateCostEstimate — key alignment + precision on the quote line', () => {
  it('the equipment key snaps to the table tonnage exactly like the fallback lookup (3.2 → 3)', () => {
    const est = generateCostEstimate({ ...RESULT, recommendedTons: 3.2 }, CONDITIONS, 'heat_pump', 'NY', [
      { match_key: HP3, unit_price: 4850 },
    ]);
    const equip = line(est, 'Heat Pump System');
    expect(equip.sourced).toBe(true);
    expect(equip.unitCost).toBe(4850);
    expect(equip.description).toContain('3.2 Ton');
  });

  it('a per-foot price keeps its cents and the line total rounds AFTER multiplying ($3.25 × 80 ft = $260, not $240)', () => {
    const est = estimate([{ match_key: 'ductwork:attic', unit_price: 3.25, model: 'FLEX-R8' }]);
    const duct = line(est, 'Supply & Return Ductwork');
    expect(duct.quantity).toBe(80);
    expect(duct.unitCost).toBe(3.25);
    expect(duct.totalCost).toBe(260);
    expect(duct.sourced).toBe(true);
    expect(duct.sourcedModel).toBe('FLEX-R8');
    // Fittings are 40% of duct material — derived from the precise unit price.
    expect(line(est, 'Fittings, Boots').totalCost).toBe(Math.round(80 * 3.25 * 0.4));
  });

  it('a single-quantity line with cents rounds its total to whole dollars while keeping the unit price', () => {
    const est = estimate([{ match_key: 'controls:thermostat', unit_price: 244.99 }]);
    const stat = line(est, 'Programmable Thermostat');
    expect(stat.unitCost).toBe(244.99);
    expect(stat.totalCost).toBe(245);
  });

  it('subtotal / tax / total stay whole dollars with sourced cents in play', () => {
    const est = estimate([
      { match_key: 'ductwork:attic', unit_price: 3.25 },
      { match_key: 'misc:filter', unit_price: 21.5 },
    ]);
    expect(Number.isInteger(est.subtotal)).toBe(true);
    expect(Number.isInteger(est.tax)).toBe(true);
    expect(Number.isInteger(est.total)).toBe(true);
    expect(est.total).toBe(est.subtotal + est.tax);
    expect(line(est, 'MERV-13 Filter').totalCost).toBe(43); // 2 × 21.5
  });
});

/**
 * Manual S equipment-selection engine tests.
 *
 * Every expected value below is hand-computed from the Manual S sizing rules so
 * these assertions double as the executable specification:
 *  - AC cooling band 90–115%, heat-pump band 90–125% (warn >115%)
 *  - sensible adequacy (sensible capacity ≥ sensible load)
 *  - latent adequacy (total − sensible ≥ latent load)
 *  - furnace band 100–140%
 *  - heat-pump supplemental heat + balance point
 *  - opt-in altitude derate of sensible capacity
 */

import { describe, it, expect } from 'vitest';
import {
  calculateManualS,
  computeBalancePoint,
  MANUAL_S_ENGINE_VERSION,
  type ManualSDesignLoads,
  type CoolingEquipmentInput,
  type HeatingEquipmentInput,
} from '../manualS';
import {
  manualJToManualS,
  suggestCoolingEquipment,
} from '../manualJToManualS';
import type { WholeHouseResult } from '../manualJ';

function makeLoads(over: Partial<ManualSDesignLoads> = {}): ManualSDesignLoads {
  return {
    totalCoolingBtu: 36000,
    sensibleCoolingBtu: 27000,
    latentCoolingBtu: 9000,
    heatingBtu: 45000,
    outdoorCoolingTempF: 95,
    outdoorHeatingTempF: 5,
    indoorCoolingTempF: 75,
    elevationFt: 0,
    ...over,
  };
}

const cool = (over: Partial<CoolingEquipmentInput> = {}): CoolingEquipmentInput => ({
  systemType: 'ac',
  totalCoolingCapacityBtu: 38000,
  sensibleCoolingCapacityBtu: 28000,
  ...over,
});

const heat = (over: Partial<HeatingEquipmentInput> = {}): HeatingEquipmentInput => ({
  heatingType: 'furnace_gas',
  heatingCapacityBtu: 54000,
  ...over,
});

describe('Manual S — cooling sizing', () => {
  it('passes a correctly sized AC (105.6% total, sensible & latent adequate)', () => {
    const r = calculateManualS({ loads: makeLoads(), cooling: cool(), heating: heat() });
    expect(r.cooling.status).toBe('pass');
    expect(r.cooling.pass).toBe(true);
    expect(r.cooling.totalSizingPct).toBe(105.6);
    expect(r.cooling.sensibleSizingPct).toBe(103.7);
    expect(r.cooling.latentCapacityBtu).toBe(10000);
    expect(r.cooling.warnings).toHaveLength(0);
    expect(r.overallPass).toBe(true);
  });

  it('fails an oversized AC (>115% of total load)', () => {
    const r = calculateManualS({
      loads: makeLoads(),
      cooling: cool({ totalCoolingCapacityBtu: 44000, sensibleCoolingCapacityBtu: 30000 }),
      heating: heat(),
    });
    expect(r.cooling.status).toBe('oversized');
    expect(r.cooling.pass).toBe(false);
    expect(r.cooling.totalSizingPct).toBe(122.2);
    expect(r.overallPass).toBe(false);
  });

  it('flags sensible-short equipment (sensible capacity < sensible load)', () => {
    const r = calculateManualS({
      loads: makeLoads({ sensibleCoolingBtu: 30000, latentCoolingBtu: 6000 }),
      cooling: cool({ totalCoolingCapacityBtu: 37000, sensibleCoolingCapacityBtu: 28000 }),
      heating: heat(),
    });
    expect(r.cooling.status).toBe('sensible_short');
    expect(r.cooling.pass).toBe(false);
  });

  it('flags latent-short equipment (latent capacity < latent load)', () => {
    const r = calculateManualS({
      loads: makeLoads({ sensibleCoolingBtu: 25000, latentCoolingBtu: 11000 }),
      cooling: cool({ totalCoolingCapacityBtu: 37000, sensibleCoolingCapacityBtu: 30000 }),
      heating: heat(),
    });
    expect(r.cooling.status).toBe('latent_short');
    expect(r.cooling.latentCapacityBtu).toBe(7000);
    expect(r.cooling.pass).toBe(false);
  });

  it('allows a heat pump up to 125% but notes the >115% choice', () => {
    const r = calculateManualS({
      loads: makeLoads({ totalCoolingBtu: 30000, sensibleCoolingBtu: 22000, latentCoolingBtu: 8000 }),
      cooling: cool({ systemType: 'heat_pump', totalCoolingCapacityBtu: 35000, sensibleCoolingCapacityBtu: 24000 }),
      heating: heat({ heatingType: 'none' }),
    });
    expect(r.cooling.status).toBe('pass');
    expect(r.cooling.pass).toBe(true);
    expect(r.cooling.totalSizingPct).toBe(116.7);
    expect(r.cooling.warnings).toHaveLength(0);
    expect(r.cooling.notes.some((n) => n.includes('Heat-pump cooling capacity'))).toBe(true);
  });
});

describe('Manual S — heating sizing', () => {
  it('passes a furnace at 120% of the heating load', () => {
    const r = calculateManualS({ loads: makeLoads(), cooling: cool(), heating: heat() });
    expect(r.heating.status).toBe('pass');
    expect(r.heating.sizingPct).toBe(120);
    expect(r.heating.pass).toBe(true);
  });

  it('fails an undersized furnace (<100%)', () => {
    const r = calculateManualS({
      loads: makeLoads({ heatingBtu: 60000 }),
      cooling: cool(),
      heating: heat({ heatingCapacityBtu: 50000 }),
    });
    expect(r.heating.status).toBe('undersized');
    expect(r.heating.sizingPct).toBe(83.3);
    expect(r.heating.pass).toBe(false);
    expect(r.overallPass).toBe(false);
  });

  it('quantifies supplemental heat + balance point for a heat pump', () => {
    const r = calculateManualS({
      loads: makeLoads({ heatingBtu: 48000, outdoorHeatingTempF: 5 }),
      cooling: cool(),
      heating: heat({
        heatingType: 'heat_pump',
        heatingCapacityBtu: 30000,
        heatingCapacityAt47Btu: 36000,
        heatingCapacityAt17Btu: 24000,
      }),
    });
    expect(r.heating.status).toBe('aux_required');
    expect(r.heating.pass).toBe(true); // valid once aux heat is specified
    expect(r.heating.supplementalHeatBtu).toBe(18000);
    expect(r.heating.supplementalHeatKw).toBe(5.3);
    expect(r.heating.balancePointF).toBe(29);
  });

  it('computeBalancePoint matches the hand calc (400/800 slopes → 29°F)', () => {
    expect(computeBalancePoint(48000, 5, 36000, 24000)).toBe(29);
  });
});

describe('Manual S — altitude correction (opt-in)', () => {
  it('passes at sea-level inputs but flips to sensible-short with altitude derate', () => {
    const denverLoads = makeLoads({
      totalCoolingBtu: 30000, sensibleCoolingBtu: 24000, latentCoolingBtu: 6000, elevationFt: 5280,
    });
    const equip = cool({ totalCoolingCapacityBtu: 32000, sensibleCoolingCapacityBtu: 25000 });

    // No correction → sensible 25,000 ≥ 24,000 → pass.
    const off = calculateManualS({ loads: denverLoads, cooling: equip, heating: heat({ heatingType: 'none' }) });
    expect(off.cooling.status).toBe('pass');
    expect(off.cooling.altitudeCorrectionApplied).toBe(false);

    // Correction on → sensible derated to ~21,360 < 24,000 → sensible-short.
    const on = calculateManualS({
      loads: denverLoads,
      cooling: cool({ totalCoolingCapacityBtu: 32000, sensibleCoolingCapacityBtu: 25000, applyAltitudeCorrection: true }),
      heating: heat({ heatingType: 'none' }),
    });
    expect(on.cooling.altitudeCorrectionApplied).toBe(true);
    expect(on.cooling.status).toBe('sensible_short');
    expect(on.cooling.sensibleCapacityBtu).toBeGreaterThan(21300);
    expect(on.cooling.sensibleCapacityBtu).toBeLessThan(21420);
    expect(on.cooling.altitudeDeratePct).toBeGreaterThan(14.3);
    expect(on.cooling.altitudeDeratePct).toBeLessThan(14.8);
  });
});

describe('Manual S — overall + metadata', () => {
  it('ignores a missing cooling load (heating-only system still passes)', () => {
    const r = calculateManualS({
      loads: makeLoads({ totalCoolingBtu: 0, sensibleCoolingBtu: 0, latentCoolingBtu: 0 }),
      cooling: cool(),
      heating: heat(),
    });
    expect(r.cooling.status).toBe('no_load');
    expect(r.heating.pass).toBe(true);
    expect(r.overallPass).toBe(true);
  });

  it('stamps the engine version', () => {
    const r = calculateManualS({ loads: makeLoads(), cooling: cool(), heating: heat() });
    expect(r.engineVersion).toBe('manualS-1.0');
    expect(MANUAL_S_ENGINE_VERSION).toBe('manualS-1.0');
  });
});

describe('Manual J → Manual S bridge', () => {
  const mj = {
    totalCoolingBtu: 36000,
    totalCoolingSensible: 27000,
    totalCoolingLatent: 9000,
    totalHeatingBtu: 45000,
    recommendedTons: 3,
  } as unknown as WholeHouseResult;

  it('maps whole-house loads + design conditions into Manual S loads', () => {
    const loads = manualJToManualS(mj, {
      outdoorCoolingTemp: 92, outdoorHeatingTemp: 10, indoorCoolingTemp: 75, elevation: 1000,
    });
    expect(loads.totalCoolingBtu).toBe(36000);
    expect(loads.sensibleCoolingBtu).toBe(27000);
    expect(loads.latentCoolingBtu).toBe(9000);
    expect(loads.heatingBtu).toBe(45000);
    expect(loads.outdoorCoolingTempF).toBe(92);
    expect(loads.outdoorHeatingTempF).toBe(10);
    expect(loads.elevationFt).toBe(1000);
  });

  it('suggests a neutral ~105% starting equipment size', () => {
    const loads = manualJToManualS(mj);
    const sug = suggestCoolingEquipment(loads, 'ac');
    expect(sug.systemType).toBe('ac');
    expect(sug.totalCoolingCapacityBtu).toBe(38000); // 36000×1.05=37800 → round to 500
    expect(sug.sensibleCoolingCapacityBtu).toBe(28500); // 27000×1.05=28350 → round to 500
    expect(sug.applyAltitudeCorrection).toBe(false);
  });
});

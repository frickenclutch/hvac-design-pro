/**
 * Cobb Residence — Cert validation against the typed engine.
 * The AED (Inadequate Exposure Diversity) test case.
 * ACCA reference: Manual J 8th Ed v2.50 §14, pp. 137-141
 */

import { describe, it, expect } from 'vitest';
import {
  buildFormJ1,
  lookupWallCLTD,
  lookupDoorCLTD,
  type FormJ1Input,
  type DesignConditions,
} from '../index';

const conditions: DesignConditions = {
  state: 'Florida',
  city: 'South FL gulf coast town',
  elevation: 15,
  latitude: 26,
  indoorHeatDB: 70,
  indoorCoolDB: 75,
  indoorCoolRH: 50,
  outdoor99DB: 47,
  outdoor1DB: 93,
  coincidentWB: 77,
  deltaGrains: 53,
  dailyRange: 'M',
  HTD: 23,
  CTD: 18,                              // Off a Table 4B bin → tests round-up
  ACF: 1.00,
};

const cobbInput: FormJ1Input = {
  conditions,
  windows: [
    { id: '6a-a', label: '1D Unit A W',  area: 38.25,
      uValue: 0.87, shgc: 0.67, psf: 220, clfAvg: 0.32, isc: 0.815, screenAdjustment: 0.90 },
    { id: '6a-b', label: '1E Unit B W',  area: 10.63,
      uValue: 0.69, shgc: 0.69, psf: 220, clfAvg: 0.32, isc: 0.815, screenAdjustment: 1.00 },
    { id: '6a-c', label: '1D Door C W',  area: 104.00,
      uValue: 0.87, shgc: 0.67, psf: 220, clfAvg: 0.32, isc: 0.815, screenAdjustment: 0.80 },
  ],
  skylights: [],
  doors: [
    { id: '7-a', label: '11N hall door', constructionId: '11N', area: 21 },
  ],
  aboveGradeWalls: [
    { id: '8-a', label: '13Ca-0oc-m wall', constructionId: '13Ca-0oc-m', area: 399.1 },
  ],
  partitionWalls: [
    // Cobb partition: same construction but different temp differential.
    // Manual J Cobb worksheet uses PTDH=23 (= HTD, hall to outdoors) and
    // PTDC=10.9 (no solar). Engine looks up partition CLTD at Group I,
    // CTD=18→20 round up, M = 10.9. Our Table 4B Group I partition cell
    // at 20/M is 10.9 (matches).
    { id: '8-b', label: '13Ca-0oc-m part', constructionId: '13Ca-0oc-m', area: 299.0 },
  ],
  belowGradeWalls: [],
  ceilings: [],
  partitionCeilings: [],
  passiveFloors: [],
  partitionFloors: [],
  radiantFloors: [],
  infiltration: {
    method: 'track_record_ACH',
    floorArea: 1809,
    aboveGradeVolume: 14472,
    achHeating: 0.290,
    achCooling: 0.160,
    cfmImbalance: 0,                    // No mech ventilation, neutral
  },
  internal: {
    occupants: 4,
    scenarioOption: 1,
    scenarioSensible: 2400,
    customAppliances: [
      { name: 'Color TV (×2)', sensible: 683 * 2 },           // 1366
      { name: 'Computer + monitor', sensible: 1536 * 0.35 },  // 538
    ],
  },
  ducts: {
    location: 'closed_ceiling_cavity',
    percentInUnconditioned: 1.00,
    rValue: 4,
    leakage: '0.12/0.24',
    // Cobb Form J1 line 15: heat 0.072 / sens 0.108 / lat 1,189
    // Worksheet G page 141 prints labels swapped vs Form J1 application;
    // these values reproduce Form J1's published Btuh:
    baseHeatLossFactor: 0.060,
    baseSensGainFactor: 0.090,
    baseLatentGain: 1189,
    wifHeatLoss: 1.20,
    wifSensGain: 1.20,
    lcfHeatLoss: 1.00,
    lcfSensGain: 1.00,
    lcfLatentGain: 1.00,
  },
  ventilation: {
    vcfm: 0,                            // Cobb has NO mechanical ventilation
    hasHeatRecovery: false,
  },
  ancillary: {
    blowerWatts: 500,
  },
  aedBlockExcursion: 5516,              // LARGE — 23% of total sens
  latentMoistureMigration: 0,
  adjustments: {
    color: 'medium',
    outdoorDesignDB: 93,
    dailyRange: 'M',
    externallyShaded: false,
  },
};

describe('Cobb Residence (AED test) — Manual J 8th Ed cert validation', () => {
  const result = buildFormJ1(cobbInput);
  const TOL = 0.005;

  it('total heating load matches ACCA reference within 0.5%', () => {
    const drift = Math.abs(result.total.heat - 7428) / 7428;
    expect(drift).toBeLessThan(TOL);
  });

  it('total sensible load matches ACCA reference within 0.5%', () => {
    const drift = Math.abs(result.total.sens - 23960) / 23960;
    expect(drift).toBeLessThan(TOL);
  });

  it('total latent load matches ACCA reference within 0.5%', () => {
    const drift = Math.abs(result.total.latent - 3380) / 3380;
    expect(drift).toBeLessThan(TOL);
  });

  it('CTD round-UP convention: CTD=18, M → uses bin 20/M = 17.0 (Group I)', () => {
    // This is THE convention Cobb's CTD=18 forced explicit. Smith and Walker
    // happened to land exactly on bin 15.
    expect(lookupWallCLTD('I', 18, 'M')).toBe(17.0);
  });

  it('CTD round-UP: door CLTD at CTD=18, M → bin 20/M = 31.0', () => {
    expect(lookupDoorCLTD(18, 'M')).toBe(31.0);
  });

  it('AED excursion contributes ~23% of total sensible cooling', () => {
    const aedFraction = result.aedExcursion / result.total.sens;
    expect(aedFraction).toBeCloseTo(0.230, 2);
  });

  it('partition uses different CLTD than wall for same construction', () => {
    // Cobb's 13Ca-0oc-m wall: CLTD = 17.0, partition: CLTD = 10.9
    const wall = result.lineItems.find((l) => l.id === '8-a');
    const part = result.lineItems.find((l) => l.id === '8-b');
    // U = 0.123, so wall HTM_c = 0.123 × 17 = 2.091
    //                 partition HTM_c = 0.123 × 10.9 = 1.341
    expect(wall?.htmCooling).toBeCloseTo(2.09, 1);
    expect(part?.htmCooling).toBeCloseTo(1.34, 1);
  });

  it('neutral pressure infiltration: NCFM = ICFM precisely', () => {
    // Walker uses "track_record_ACH" too, but with imbalance. Cobb has
    // imbalance=0 → NCFM should equal precise (un-rounded) ICFM.
    const infil = result.lineItems.find((l) => l.id === 'L12');
    // Heat: 1.1 × 1.00 × 69.95 × 23 = 1769.7 ≈ 1770
    expect(infil?.heatLoad).toBeCloseTo(1770, -1);
  });
});

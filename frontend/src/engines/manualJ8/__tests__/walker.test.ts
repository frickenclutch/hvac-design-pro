/**
 * Walker Residence — Cert validation against the typed engine.
 * ACCA reference: Manual J 8th Ed v2.50 §13, pp. 125-134
 */

import { describe, it, expect } from 'vitest';
import {
  buildFormJ1,
  type FormJ1Input,
  type DesignConditions,
} from '../index';

const conditions: DesignConditions = {
  state: 'Florida',
  city: 'Southern Florida town',
  elevation: 7,
  latitude: 25,
  indoorHeatDB: 70,
  indoorCoolDB: 75,
  indoorCoolRH: 55,
  outdoor99DB: 52,
  outdoor1DB: 90,
  coincidentWB: 78,
  deltaGrains: 57,
  dailyRange: 'L',
  HTD: 18,
  CTD: 15,
  ACF: 1.00,
};

const walkerWindows: FormJ1Input['windows'] = [
  { id: '6a-a', label: 'Unit A 1G W',     area: 8.75,   uValue: 0.44, shgc: 0.15, psf: 220, clfAvg: 0.32, isc: 0.83, screenAdjustment: 0.90 },
  { id: '6a-b', label: 'Unit A 1G E',     area: 17.50,  uValue: 0.44, shgc: 0.15, psf: 220, clfAvg: 0.32, isc: 0.83, screenAdjustment: 0.90 },
  { id: '6a-c', label: 'Unit C oh 1G S',  area: 58.00,  uValue: 0.46, shgc: 0.18, psf: 91,  clfAvg: 0.18, isc: 0.89, screenAdjustment: 0.80, overhangFullyShaded: true, psfNorth: 38, clfNorth: 0.29 },
  { id: '6a-d', label: 'Unit B oh 1G S',  area: 28.00,  uValue: 0.42, shgc: 0.14, psf: 91,  clfAvg: 0.18, isc: 0.89, screenAdjustment: 0.90, overhangFullyShaded: true, psfNorth: 38, clfNorth: 0.29 },
  { id: '6a-e', label: 'Unit B 1G N',     area: 14.00,  uValue: 0.42, shgc: 0.14, psf: 38,  clfAvg: 0.29, isc: 0.89, screenAdjustment: 0.90 },
  { id: '6a-f', label: 'Unit A 1G N',     area: 43.75,  uValue: 0.44, shgc: 0.15, psf: 38,  clfAvg: 0.29, isc: 0.83, screenAdjustment: 0.90 },
  { id: '6a-g', label: 'Unit D ss 1G W',  area: 31.50,  uValue: 0.45, shgc: 0.16, psf: 220, clfAvg: 0.32, isc: 0.89, screenAdjustment: 1.00, sunScreen: true, scSS: 0.25, psfNorth: 38, clfNorth: 0.29 },
];

const walkerSkylights: FormJ1Input['skylights'] = [
  { id: '6b-a', label: 'Skylight S1 N',
    flatArea: 8.00, domed: true, uNFRC: 0.49, shgc: 0.29, tilt: 30,
    curbHeightIn: 4, curbLength: 2, curbWidth: 4,
    shaftHeightFt: 5, shaftRValue: 19,
    psfH: 272, clfH: 0.68, psfV: 38, clfV: 0.48, isc: 1.00 },
  { id: '6b-b', label: 'Skylight S2 S',
    flatArea: 32.00, domed: true, uNFRC: 0.49, shgc: 0.29, tilt: 30,
    curbHeightIn: 4, curbLength: 4, curbWidth: 8,
    shaftHeightFt: 5, shaftRValue: 19,
    psfH: 272, clfH: 0.68, psfV: 91, clfV: 0.24, isc: 1.00 },
];

const walkerInput: FormJ1Input = {
  conditions,
  windows: walkerWindows,
  skylights: walkerSkylights,
  doors: [
    { id: '7-a', label: '11N entrance', constructionId: '11N', area: 21 },
    { id: '7-b', label: '11N kitchen',  constructionId: '11N', area: 21 },
  ],
  aboveGradeWalls: [
    { id: '8-a', label: '14C-5 AAC', constructionId: '14C-5', area: 1165 },
  ],
  partitionWalls: [],
  belowGradeWalls: [],
  ceilings: [
    { id: '10-a', label: '16F-38tw white tile', constructionId: '16F-38tw', area: 1752 },
  ],
  partitionCeilings: [],
  passiveFloors: [],
  partitionFloors: [],
  radiantFloors: [
    { id: '11-a', label: '22D-5rl radiant slab',
      constructionId: '22D-5rl', area: 176 /* exposed edge feet */ },
  ],
  infiltration: {
    method: 'track_record_ACH',
    floorArea: 1792,
    aboveGradeVolume: 14336,
    achHeating: 0.25,
    achCooling: 0.15,
    cfmImbalance: -50,             // 50 OA in, 0 exhaust → positive pressure
  },
  internal: {
    occupants: 4,
    scenarioOption: 2,
    scenarioSensible: 3400,
    customAppliances: [
      { name: 'Color TV (1 extra)', sensible: 683 },
      { name: 'Computer + monitor', sensible: 538 },
    ],
  },
  ducts: {
    location: 'vented_attic',
    percentInUnconditioned: 1.00,
    rValue: 8,
    leakage: '0.12/0.24',
    baseHeatLossFactor: 0,         // Radiant heat = no heating ducts
    baseSensGainFactor: 0.080,
    baseLatentGain: 655,
    wifHeatLoss: 1.00,
    wifSensGain: 0.82,
    lcfHeatLoss: 1.00,
    lcfSensGain: 1.00,
    lcfLatentGain: 1.00,
    heatingViaRadiant: true,
  },
  ventilation: {
    vcfm: 50,
    hasHeatRecovery: false,        // VDH dehumidifier — no heat recovery
  },
  ancillary: {
    blowerWatts: 500,
  },
  aedBlockExcursion: 0,            // No AED for Walker
  latentMoistureMigration: 3895,   // Humid Florida
  adjustments: {
    color: 'medium',
    outdoorDesignDB: 90,
    dailyRange: 'L',
    externallyShaded: false,
  },
};

describe('Walker Residence — Manual J 8th Ed cert validation', () => {
  const result = buildFormJ1(walkerInput);
  const TOL = 0.005;

  it('total heating load matches ACCA reference within 0.5%', () => {
    const drift = Math.abs(result.total.heat - 8299) / 8299;
    expect(drift).toBeLessThan(TOL);
  });

  it('total sensible load matches ACCA reference within 0.5%', () => {
    const drift = Math.abs(result.total.sens - 16362) / 16362;
    expect(drift).toBeLessThan(TOL);
  });

  it('total latent load matches ACCA reference within 0.5%', () => {
    const drift = Math.abs(result.total.latent - 7288) / 7288;
    expect(drift).toBeLessThan(TOL);
  });

  it('AAC wall (Group K) lookup at CTD=15/L returns 14.6 CLTD', () => {
    // Walker's 14C-5 wall: HTM_h = 0.069 × 18 = 1.242, HTM_c = 0.069 × 14.6 = 1.0074
    const wall = result.lineItems.find((l) => l.id === '8-a');
    expect(wall?.htmHeating).toBeCloseTo(1.242, 2);
    expect(wall?.htmCooling).toBeCloseTo(1.0074, 2);
  });

  it('radiant slab uses HTM = F × (HTD + 25)', () => {
    // 22D-5rl: F=0.287, HTM = 0.287 × (18+25) = 12.341
    const slab = result.lineItems.find((l) => l.id === '11-a');
    expect(slab?.htmHeating).toBeCloseTo(12.34, 1);
  });

  it('dominating positive pressure → NCFM_cooling = 0', () => {
    // Walker's 50 OA forced in vs 36 cooling ICFM → NCFM = 0
    expect(result.lineItems.find((l) => l.id === 'L12')?.sensLoad).toBe(0);
    expect(result.lineItems.find((l) => l.id === 'L12')?.latentLoad).toBe(0);
  });

  it('no heating ducts (radiant) → EHLF = 0', () => {
    expect(result.ductFactors.EHLF).toBe(0);
    expect(result.ductLoads.heat).toBe(0);
  });

  it('sun screen formula applies to Unit D West', () => {
    // Walker Unit D ss W: HTM_SS = 10.98
    const unitD = result.lineItems.find((l) => l.id === '6a-g');
    expect(unitD?.htmCooling).toBeCloseTo(10.98, 1);
  });

  it('overhang fully shaded → HTM_OH = AHTM_N for South-facing units B + C', () => {
    // Walker Unit C oh: AHTM_N = 7.14, Unit B oh: AHTM_N = 7.09
    const unitC = result.lineItems.find((l) => l.id === '6a-c');
    const unitB = result.lineItems.find((l) => l.id === '6a-d');
    expect(unitC?.htmCooling).toBeCloseTo(7.14, 1);
    expect(unitB?.htmCooling).toBeCloseTo(7.09, 1);
  });
});

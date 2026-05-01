/**
 * Smith Residence — Cert validation against the typed engine.
 * Mirrors tests/manualJ8/smith-validation.mjs but exercises the new
 * TypeScript engine (frontend/src/engines/manualJ8/) end-to-end.
 *
 * ACCA reference: Manual J 8th Ed v2.50 §12, pp. 107-123
 */

import { describe, it, expect } from 'vitest';
import {
  buildFormJ1,
  type FormJ1Input,
  type DesignConditions,
} from '../index';

const conditions: DesignConditions = {
  state: 'Iowa',
  city: 'Eastern Iowa town',
  elevation: 955,
  latitude: 42,
  indoorHeatDB: 70,
  indoorCoolDB: 75,
  indoorCoolRH: 50,
  outdoor99DB: -6,
  outdoor1DB: 90,
  coincidentWB: 74,
  deltaGrains: 38,
  dailyRange: 'M',
  HTD: 76,
  CTD: 15,
  ACF: 0.97,
};

// Smith Worksheet B published HTM values are used for window inputs.
// (The PSF/CLF/ISC chain isn't fully captured in the public engine yet —
// validating Form J1 aggregation against published HTMs is sufficient
// here; full window HTM derivation is exercised by the Walker test.)
const smithWindows: FormJ1Input['windows'] = [
  { id: '6a-a', label: 'Unit A 1G N',     area: 43.75, uValue: 0.49, shgc: 0.58, psf: 35,  clfAvg: 0.29, isc: 0.73, screenAdjustment: 0.90 },
  { id: '6a-b', label: 'Unit A 1G E/W',   area: 43.75, uValue: 0.49, shgc: 0.58, psf: 216, clfAvg: 0.32, isc: 0.73, screenAdjustment: 0.90 },
  { id: '6a-c', label: 'Unit B 1G N',     area: 14.00, uValue: 0.44, shgc: 0.61, psf: 35,  clfAvg: 0.29, isc: 0.82, screenAdjustment: 0.90 },
  // Smith's South-facing overhangs use Table 3E-1 partial-shade math.
  // Form J1 published HTMs encode the geometry; we use the override.
  { id: '6a-d', label: 'Unit B 1G S OH',  area: 28.00, uValue: 0.44, shgc: 0.61, psf: 149, clfAvg: 0.18, isc: 0.82, screenAdjustment: 0.90, htmCoolingOverride: 15.81 },
  { id: '6a-e', label: 'Unit C 1G W',     area: 58.00, uValue: 0.54, shgc: 0.64, psf: 216, clfAvg: 0.32, isc: 0.82, screenAdjustment: 0.80 },
  { id: '6a-f', label: 'Unit D 1G S OH',  area: 47.13, uValue: 0.54, shgc: 0.64, psf: 149, clfAvg: 0.18, isc: 0.82, screenAdjustment: 0.80, htmCoolingOverride: 17.30 },
  { id: '6a-g', label: 'Unit E 1G N',     area: 10.31, uValue: 0.42, shgc: 0.66, psf: 35,  clfAvg: 0.29, isc: 0.82, screenAdjustment: 1.00 },
  { id: '6a-h', label: 'Unit E 1G S',     area: 10.31, uValue: 0.42, shgc: 0.66, psf: 149, clfAvg: 0.18, isc: 0.82, screenAdjustment: 1.00 },
];

const smithSkylights: FormJ1Input['skylights'] = [
  {
    id: '6b-a', label: 'Skylight S1 N',
    flatArea: 8.00, uNFRC: 0.52, shgc: 0.35, tilt: 30,
    curbHeightIn: 4, curbLength: 2, curbWidth: 4,
    shaftHeightFt: 5, shaftRValue: 11,
    psfH: 247, clfH: 0.68,
    psfV: 35, clfV: 0.48,
    isc: 1.00,
  },
  {
    id: '6b-b', label: 'Skylight S2 S',
    flatArea: 32.00, uNFRC: 0.52, shgc: 0.35, tilt: 30,
    curbHeightIn: 4, curbLength: 4, curbWidth: 8,
    shaftHeightFt: 5, shaftRValue: 11,
    psfH: 247, clfH: 0.68,
    psfV: 149, clfV: 0.24,
    isc: 1.00,
  },
];

const smithInput: FormJ1Input = {
  conditions,
  windows: smithWindows,
  skylights: smithSkylights,
  doors: [
    { id: '7-a', label: '11N main entrance', constructionId: '11N', area: 21 },
    { id: '7-b', label: '11N kitchen',       constructionId: '11N', area: 21 },
  ],
  aboveGradeWalls: [
    { id: '8-a', label: '14A-8 logs',     constructionId: '14A-8',     area: 1207 },
    { id: '8-b', label: '15A-4sffc wall', constructionId: '15A-4sffc-x', area: 600 },
  ],
  partitionWalls: [
    // Smith Worksheet D Note 4: 3-foot partition between conditioned space
    // and crawl uses PTDH/PTDC from Construction 19B-osp (the floor over
    // the same crawl space). Same temp differential applies.
    { id: '8-c', label: '15A-4sffc partition (crawl)',
      constructionId: '15A-4sffc-x', area: 96,
      ptdhOverride: 6.6, ptdcOverride: 1.3 },
  ],
  belowGradeWalls: [
    { id: '9-a', label: '15A-4sffc-4', constructionId: '15A-4sffc-x', area: 284, basementFloorDepthFt: 4 },
    { id: '9-b', label: '15A-4sffc-8', constructionId: '15A-4sffc-x', area: 224, basementFloorDepthFt: 8 },
  ],
  ceilings: [
    { id: '10-a', label: '16B-30ad', constructionId: '16B-30ad', area: 1752 },
  ],
  partitionCeilings: [],
  passiveFloors: [
    { id: '11-b', label: '22B-5ph slab', constructionId: '22B-5ph', area: 64 },
    { id: '11-c', label: '21A-32 floor exposed', constructionId: '21A-32', area: 544 },
  ],
  partitionFloors: [
    { id: '11-a', label: '19B-osp crawl', constructionId: '19B-osp', area: 736 },
  ],
  radiantFloors: [],
  infiltration: {
    method: 'blower_door',
    floorArea: 2848,
    aboveGradeVolume: 20355,
    ela4SqIn: 62,
    Cs: 0.0299,
    Cw: 0.0121,
    windHeatMPH: 15,
    windCoolMPH: 7.5,
    cfmImbalance: 0,
  },
  internal: {
    occupants: 4,
    scenarioOption: 1,
    scenarioSensible: 2400,
  },
  ducts: {
    location: 'closed_crawlspace',
    percentInUnconditioned: 0.15,
    rValue: 4,
    leakage: '0.35/0.70',
    baseHeatLossFactor: 0.110,
    baseSensGainFactor: 0.060,
    baseLatentGain: 971,
    wifHeatLoss: 1.20,
    wifSensGain: 1.20,
    lcfHeatLoss: 2.480,
    lcfSensGain: 2.390,
    lcfLatentGain: 3.880,
  },
  ventilation: {
    vcfm: 70,
    hasHeatRecovery: true,
    serHeating: 0.65,
    serCooling: 0.59,
    ler: 0,
    balanced: true,
  },
  ancillary: {
    indoorGrains: 22.5,
    outdoorGrains: 3.5,
    blowerWatts: 500,
  },
  aedBlockExcursion: 564,        // Form J1 line 20 sensible (small AED for Smith)
  latentMoistureMigration: 0,    // No moisture migration this example
  adjustments: {
    color: 'medium',
    outdoorDesignDB: 90,
    dailyRange: 'M',
    externallyShaded: false,
  },
};

describe('Smith Residence — Manual J 8th Ed cert validation', () => {
  const result = buildFormJ1(smithInput);

  // 0.5% cert tolerance (ACCA requirement)
  const TOL = 0.005;

  it('total heating load matches ACCA reference within 0.5%', () => {
    expect(result.total.heat).toBeCloseTo(59326, -2);
    const drift = Math.abs(result.total.heat - 59326) / 59326;
    expect(drift).toBeLessThan(TOL);
  });

  it('total sensible load matches ACCA reference within 0.5%', () => {
    expect(result.total.sens).toBeCloseTo(23807, -2);
    const drift = Math.abs(result.total.sens - 23807) / 23807;
    expect(drift).toBeLessThan(TOL);
  });

  it('total latent load matches ACCA reference within 0.5%', () => {
    expect(result.total.latent).toBeCloseTo(4771, -1);
    const drift = Math.abs(result.total.latent - 4771) / 4771;
    expect(drift).toBeLessThan(TOL);
  });

  it('Line 14 subtotals match published values', () => {
    expect(result.line14.heat).toBeCloseTo(52164, -2);
    expect(result.line14.sens).toBeCloseTo(20547, -2);
    expect(result.line14.latent).toBeCloseTo(2451, -1);
  });

  it('skylight Ueff calculation matches Worksheet C', () => {
    // Skylight S1: Ueff should be ~1.30 (with rounded U_curb / U_shaft)
    // Heat HTM = 1.295 × 76 = 98.42
    const s1HeatHTM = result.lineItems.find((l) => l.id === '6b-a')?.htmHeating;
    expect(s1HeatHTM).toBeCloseTo(98.42, 1);
  });

  it('infiltration uses Worksheet E Option 3 (blower door)', () => {
    // Smith ICFM heat = 139, NCFM = 139 (neutral pressure)
    expect(result.lineItems.find((l) => l.id === 'L12')?.heatLoad)
      .toBeCloseTo(11237, -2);
  });
});

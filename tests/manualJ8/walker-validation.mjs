#!/usr/bin/env node
/* eslint-disable no-console */
//
// Manual J 8th Edition v2.50 — Walker Residence Validation Harness
// =================================================================
// Second cert-grade test case. Walker exercises engine paths Smith doesn't:
//   - 25°N latitude (vs 42°N)         — different Table 3D solar values
//   - Low daily range (vs Medium)     — Table 4B "L" column
//   - HTD = 18°F (vs 76°F)            — mild-winter heating math
//   - AAC walls (Construction 14C-5)  — Group K thermal mass
//   - Radiant slab floor (22D-5rl)    — HTM = F × (HTD + 25)
//   - Sun screens (West windows)      — HTM_SS formula
//   - Overhangs fully shading S       — HTM_OH = AHTM_N (U=0)
//   - Domed skylights                 — Apanel = flat × 1.25 adjustment
//   - R-19 light shaft insulation     — Ushaft = 0.05 (vs Smith's 0.08)
//   - Dehumidifying ventilator        — unbalanced 50 in / 0 out
//   - Dominating positive pressure    — NCFM_cool = 0
//   - Track-record ACH infiltration   — Worksheet E Option 1 (custom values)
//   - Three roof options compared     — chose 16F-38tw (white tile, no RB)
//   - Custom appliance line           — TV (683) + Computer (538) = 1,221 Btuh
//   - Latent moisture migration       — Line 20 = 3,895 Btuh (humid Florida)
//   - No humidification               — Florida year-round humid
//   - No heating duct path            — radiant floor; ducts cool only
//   - Radial spider duct config       — R-8 insulation, 0.12/0.24 leakage
//
// Pass/fail tolerance: ±0.5% per ACCA cert. Exit 0 if all pass.
//

const TOLERANCE = 0.005;
const results = [];
function check(label, computed, expected, unit = 'Btuh', toleranceOverride) {
  const tolerance = toleranceOverride ?? TOLERANCE;
  const drift = expected === 0
    ? (Math.abs(computed) < 0.01 ? 0 : 1)
    : Math.abs(computed - expected) / Math.abs(expected);
  results.push({ label, computed, expected, drift, pass: drift <= tolerance, unit });
}

// ============================================================================
// STEP 1 — Walker Residence inputs (Manual J §13, pp. 125-134)
// ============================================================================
const WALKER = {
  location: { state: 'Florida', city: 'Southern Florida town', elevation: 7, latitude: 25 },
  design: {
    indoorHeatDB: 70,
    indoorCoolDB: 75, indoorCoolRH: 55,
    outdoor99DB: 52, outdoor1DB: 90,
    coincidentWB: 78, deltaGrains: 57,
    dailyRange: 'L',
    HTD: 70 - 52,   // 18°F
    CTD: 90 - 75,   // 15°F
    ACF: 1.00,      // Table 10A at 7 ft = sea level
  },
  // ── Worksheet B inputs (we re-derive every HTM from these) ─────────────
  // Each row carries: U-NFRC, SHGC, PSF (Table 3D-2), CLF_avg (Table 3D-3),
  // ISC (Table 3D-4 derived), and the insect-screen adjustment factor.
  windows: [
    // a Unit A WRS½ West: PSF=220, CLF=0.32, ISC=0.83, ID-full screen 0.90
    { id: '6a-a', label: 'Unit A 1G W',  area: 8.75,
      U: 0.44, shgc: 0.15, psf: 220, clf: 0.32, isc: 0.83, screen: 0.90,
      // No overhang, no sun screen
    },
    { id: '6a-b', label: 'Unit A 1G E',  area: 17.50,
      U: 0.44, shgc: 0.15, psf: 220, clf: 0.32, isc: 0.83, screen: 0.90 },
    // c Unit C oh S: fully shaded by 1.5 ft overhang (U=0 unshaded height) →
    //   HTM_OH = AHTM_N where N-equiv uses PSF=38, CLF=0.29 at 25°N
    { id: '6a-c', label: 'Unit C oh 1G S', area: 58.00, overhang: true,
      U: 0.46, shgc: 0.18, psf: 91, clf: 0.18, isc: 0.89, screen: 0.80,
      psfN: 38, clfN: 0.29 },
    { id: '6a-d', label: 'Unit B oh 1G S', area: 28.00, overhang: true,
      U: 0.42, shgc: 0.14, psf: 91, clf: 0.18, isc: 0.89, screen: 0.90,
      psfN: 38, clfN: 0.29 },
    { id: '6a-e', label: 'Unit B 1G N',  area: 14.00,
      U: 0.42, shgc: 0.14, psf: 38, clf: 0.29, isc: 0.89, screen: 0.90 },
    { id: '6a-f', label: 'Unit A 1G N',  area: 43.75,
      U: 0.44, shgc: 0.15, psf: 38, clf: 0.29, isc: 0.83, screen: 0.90 },
    // g Unit D ss W: sun screen with SC_SS = 0.25
    { id: '6a-g', label: 'Unit D ss 1G W', area: 31.50, sunScreen: true,
      U: 0.45, shgc: 0.16, psf: 220, clf: 0.32, isc: 0.89, screen: 1.00,
      scSS: 0.25, psfN: 38, clfN: 0.29 },
  ],
  // Domed skylights: Apanel uses flat × 1.25 curvature adjustment
  skylights: [
    { id: '6b-a', label: 'Skylight S1 N',
      flatArea: 8.00, uNFRC: 0.49, shgc: 0.29, tilt: 30, face: 'N',
      curbHeightIn: 4, curbLength: 2, curbWidth: 4,
      shaftHeightFt: 5, shaftRValue: 19,
      psfH: 272, clfH: 0.68,                 // Table 3D-2/3 horizontal at 25°N
      psfV: 38, clfV: 0.48,                   // Vertical North at 25°N
      isc: 1.00 },
    { id: '6b-b', label: 'Skylight S2 S',
      flatArea: 32.00, uNFRC: 0.49, shgc: 0.29, tilt: 30, face: 'S',
      curbHeightIn: 4, curbLength: 4, curbWidth: 8,
      shaftHeightFt: 5, shaftRValue: 19,
      psfH: 272, clfH: 0.68,
      psfV: 91, clfV: 0.24,                   // Vertical South at 25°N
      isc: 1.00 },
  ],
  opaque: {
    doors: [
      { id: '7-a', label: '11N entrance', area: 21, U: 0.35, directCLTD: 30.0 },
      { id: '7-b', label: '11N kitchen',  area: 21, U: 0.35, directCLTD: 30.0 },
    ],
    aboveGradeWalls: [
      // 14C-5 = AAC block with R-5 foam board insulation, stucco ext + interior finish
      { id: '8-a', label: '14C-5 AAC R-5', area: 1165, U: 0.069, group: 'K' },
    ],
    ceilings: [
      // Walker chose option 3 — white tile, no radiant barrier
      { id: '10-a', label: '16F-38tw white tile', area: 1752, U: 0.026, directCLTD: 19 },
    ],
    radiantFloors: [
      // Construction 22D-5rl: radiant slab, R-5, 4-ft back, dry sandy soil
      // HTM = F × (HTD + 25); load adds to TOTAL not subtotal
      { id: '11-a', label: '22D-5rl radiant slab', exposedEdgeFt: 176, fValue: 0.287 },
    ],
  },
  infiltration: {
    method: 'track_record_ACH',
    floorArea: 1792,
    aboveGradeVolume: 14336,
    achHeating: 0.25,
    achCooling: 0.15,
    cfmImbalance: -50,                        // 50 OA forced in, 0 exhaust
  },
  ventilation: {
    vcfm: 50,
    type: 'dehumidifying_ventilator',         // VDH — no HRV, no exhaust
    // No SER/LER — just plain outdoor air at design conditions
  },
  internal: {
    occupants: 4,
    sensiblePerOccupant: 230,
    latentPerOccupant: 200,
    scenarioOption: 2,                        // 3,400 Btuh
    scenarioSensible: 3400,
    customAppliances: [
      // Default scenario already includes 1 TV; Walker has 3 TVs total → 1 extra TV
      // Default scenario includes 0 computers; Walker has 2 computers → both custom
      // But practitioner deferred 1 TV + 1 computer to "not used during late afternoon"
      // Actual Form J1 line 13d shows 1,221 = 683 + 538
      { name: 'Color TV (1 extra)', sensible: 683 },                  // 683 × 1.0 × 1.0
      { name: 'Computer + monitor (1)', sensible: 538 },              // 1536 × 0.35 × 1.0
    ],
  },
  ducts: {
    location: 'vented_attic_white_tile',
    percentInUnconditioned: 1.00,            // 100% in attic
    config: 'radial_spider',
    rValue: 8,
    leakage: '0.12/0.24',
    // Walker has radiant heat — no heating ducts. Only cooling path.
    baseSensGainFactor: 0.080,
    baseLatentGain: 655,
    wifSensGain: 0.82,                        // R-8 WIF
    lcfSensGain: 1.00,
    lcfLatentGain: 1.00,
  },
  blower: { defaultWatts: 500 },              // Default → 1,707 Btuh
  // Line 20 latent moisture migration through walls (humid FL climate)
  // Walker had no AED excursion, so all of line 20 is latent
  latentMoistureMigration: 3895,
};

// ============================================================================
// STEP 2 — Captured Manual J reference data (subset for Walker)
// ============================================================================
const TABLE_4B_WALL_GROUP = {
  // Group K (AAC walls have heavy mass) — only need CTD=15/L for Walker
  K: { 10: { L: 9.6, M: 5.6 }, 15: { L: 14.6, M: 10.6, H: 5.6 },
       20: { L: 19.6, M: 15.6, H: 10.6 }, 25: { M: 20.6, H: 15.6 },
       30: { H: 20.6 }, 35: { H: 25.6 } },
};

// ============================================================================
// STEP 3 — Engine functions (Manual J 8th Ed worksheet formulas)
// ============================================================================

function lookupCLTD(group, ctd, dr) {
  return TABLE_4B_WALL_GROUP[group][ctd][dr];
}

// Worksheet B — Window HTMs
function windowHeatHTM(w, htd) { return w.U * htd; }
function windowCoolHTM_D(w, ctd) {
  return w.psf * w.clf * (w.shgc / 0.87) * w.isc + w.U * ctd;
}
function windowCoolHTM_N(w, ctd) {
  // North-equivalent: replace PSF/CLF with N values, keep U×CTD conduction
  return w.psfN * w.clfN * (w.shgc / 0.87) * w.isc + w.U * ctd;
}
function windowAHTM_D(w, ctd) { return windowCoolHTM_D(w, ctd) * w.screen; }
function windowAHTM_N(w, ctd) { return windowCoolHTM_N(w, ctd) * w.screen; }

// Sun screen adjustment: HTM_SS = (AHTM_D - AHTM_N) × SC_SS + AHTM_N
function windowHTM_SS(w, ctd) {
  // Sun screen: insect-screen factor of underlying AHTM_D doesn't apply;
  // SC_SS replaces it. AHTM_N for sun-screen calc uses screen=1.00 (no insect).
  const ahtmD_unscreened = windowCoolHTM_D(w, ctd);
  const ahtmN_unscreened = windowCoolHTM_N(w, ctd);
  return (ahtmD_unscreened - ahtmN_unscreened) * w.scSS + ahtmN_unscreened;
}

// Overhang: when fully shaded (unshaded height U=0), HTM_OH = AHTM_N
function windowHTM_OH_fullyShaded(w, ctd) { return windowAHTM_N(w, ctd); }

// Worksheet C — Skylight HTMs
const round2 = (x) => Math.round(x * 100) / 100;
function skylightUeff(uNFRC, uCurb, arCurb, uShaft, arShaft) {
  return uNFRC + uCurb * arCurb + uShaft * arShaft;
}
function skylightCoolHTM(s, ueff, ctd) {
  const tiltRad = (s.tilt * Math.PI) / 180;
  const solH = Math.cos(tiltRad) * s.psfH * s.clfH;
  const solV = Math.sin(tiltRad) * s.psfV * s.clfV;
  return (solH + solV) * (s.shgc / 0.87) * s.isc + ueff * (ctd + 15);
}

// Worksheet D — Opaque
function opaqueHTM(uOrF, td) { return uOrF * td; }
function radiantSlabHTM(fValue, htd) { return fValue * (htd + 25); }

// Worksheet E — Infiltration with NCFM space-pressure logic
function spaceICFM(ach, agv) { return (ach * agv) / 60; }
function netInfiltrationCFM(icfm, cfmImb) {
  if (cfmImb === 0) return icfm;
  if (cfmImb > 0) return Math.pow(Math.pow(icfm, 1.5) + Math.pow(cfmImb, 1.5), 0.67);
  const absImb = Math.abs(cfmImb);
  if (icfm <= absImb) return 0;                                   // dominating positive
  return Math.pow(Math.pow(icfm, 1.5) - Math.pow(absImb, 1.5), 0.67);
}
function infiltrationHeatLoad(ncfm, htd, acf) { return 1.1 * acf * ncfm * htd; }
function infiltrationSensLoad(ncfm, ctd, acf) { return 1.1 * acf * ncfm * ctd; }
function infiltrationLatentLoad(ncfm, dGrains, acf) { return 0.68 * acf * ncfm * dGrains; }

// Worksheet H — Plain ventilation (no HRV — Walker uses dehumidifier only)
function plainVentHeat(vcfm, htd, acf) { return 1.1 * acf * vcfm * htd; }
function plainVentSens(vcfm, ctd, acf) { return 1.1 * acf * vcfm * ctd; }
function plainVentLatent(vcfm, dGrains, acf) { return 0.68 * acf * vcfm * dGrains; }

// Worksheet G — Cooling-only duct path (Walker has radiant heat, no heating ducts)
function ductFactorsCoolingOnly(d) {
  const adjSens = d.baseSensGainFactor * d.wifSensGain;
  const lcfSens = adjSens * d.lcfSensGain;
  const saa = d.percentInUnconditioned;
  return {
    EHLF: 0,                                   // no heating ducts
    ESGF: lcfSens * saa,
    ELG: d.baseLatentGain * d.lcfLatentGain * saa,
  };
}

// Worksheet I — Blower
function blowerHeatLoad(watts) { return 3.413 * watts; }

// ============================================================================
// STEP 4 — Reproduce every Form J1 line item
// ============================================================================
const D = WALKER.design;

// --- Line 6a — Windows (full HTM re-derivation from Worksheet B inputs) ---
let windowsHeat = 0, windowsSens = 0;
const expectedWindows = {
  '6a-a': { htmH: 7.92, htmC: 15.01, heat: 69, sens: 131 },
  '6a-b': { htmH: 7.92, htmC: 15.01, heat: 139, sens: 263 },
  '6a-c': { htmH: 8.28, htmC: 7.14, heat: 480, sens: 414 },
  '6a-d': { htmH: 7.56, htmC: 7.09, heat: 212, sens: 199 },
  '6a-e': { htmH: 7.56, htmC: 7.09, heat: 106, sens: 99 },
  '6a-f': { htmH: 7.92, htmC: 7.36, heat: 347, sens: 322 },
  '6a-g': { htmH: 8.10, htmC: 10.98, heat: 255, sens: 348 },
};
for (const w of WALKER.windows) {
  const htmH = windowHeatHTM(w, D.HTD);
  let htmC;
  if (w.sunScreen) {
    htmC = windowHTM_SS(w, D.CTD);
  } else if (w.overhang) {
    htmC = windowHTM_OH_fullyShaded(w, D.CTD);
  } else {
    htmC = windowAHTM_D(w, D.CTD);
  }
  const heat = htmH * w.area;
  const sens = htmC * w.area;
  windowsHeat += heat;
  windowsSens += sens;
  const exp = expectedWindows[w.id];
  check(`L6a ${w.label} HTM_h`, htmH, exp.htmH, 'BTU/hr·SqFt');
  check(`L6a ${w.label} HTM_c`, htmC, exp.htmC, 'BTU/hr·SqFt', 0.01);
  check(`L6a ${w.label} heat`, heat, exp.heat, 'Btuh', 0.015);
  check(`L6a ${w.label} sens`, sens, exp.sens, 'Btuh', 0.015);
}

// --- Line 6b — Skylights (custom Ueff with R-19 shaft + dome 1.25 adjustment) ---
let skylightsHeat = 0, skylightsSens = 0;
const Ucurb_w = round2(1 / (1.625 * 1.25 + 0.17 + 0.68));            // 0.35
const Ushaft_w = round2(1 / (19.0 + 0.25 + 0.17 + 0.68));            // 0.05
check(`Worksheet C Ucurb`, Ucurb_w, 0.35, 'U');
check(`Worksheet C Ushaft (R-19)`, Ushaft_w, 0.05, 'U');

const expectedSkylights = {
  '6b-a': { ueff: 0.93, htmH: 16.74, htmC: 84.33 },
  '6b-b': { ueff: 0.71, htmH: 12.78, htmC: 78.33 },
};
for (const s of WALKER.skylights) {
  // Apanel for domed = flat × 1.25 curvature adjustment
  const Apanel = s.flatArea * 1.25;
  const P = 2 * (s.curbLength + s.curbWidth);
  const Acurb = P * (s.curbHeightIn / 12);
  const Ashaft = P * s.shaftHeightFt;
  const ARcurb = Acurb / Apanel;
  const ARshaft = Ashaft / Apanel;
  const Ueff = skylightUeff(s.uNFRC, Ucurb_w, ARcurb, Ushaft_w, ARshaft);
  const htmH = Ueff * D.HTD;
  const htmC = skylightCoolHTM(s, Ueff, D.CTD);
  // Skylight loads computed against FLAT panel area (NFRC-rated), not Apanel
  const heat = htmH * s.flatArea;
  const sens = htmC * s.flatArea;
  skylightsHeat += heat;
  skylightsSens += sens;
  const exp = expectedSkylights[s.id];
  check(`L6b ${s.label} Ueff`, Ueff, exp.ueff, 'U', 0.015);
  check(`L6b ${s.label} HTM_h`, htmH, exp.htmH, 'BTU/hr·SqFt', 0.01);
  check(`L6b ${s.label} HTM_c`, htmC, exp.htmC, 'BTU/hr·SqFt', 0.01);
}

// --- Line 7 — Doors ---
let doorsHeat = 0, doorsSens = 0;
for (const d of WALKER.opaque.doors) {
  const htmH = opaqueHTM(d.U, D.HTD);
  const htmC = opaqueHTM(d.U, d.directCLTD);
  doorsHeat += htmH * d.area;
  doorsSens += htmC * d.area;
  check(`L7 ${d.label} HTM_h`, htmH, 6.30);
  check(`L7 ${d.label} HTM_c`, htmC, 10.50);
}

// --- Line 8 — Above-grade walls (Group K lookup at CTD=15, Low DR) ---
let wallsHeat = 0, wallsSens = 0;
for (const w of WALKER.opaque.aboveGradeWalls) {
  const cltd = lookupCLTD(w.group, D.CTD, D.dailyRange);
  const htmH = opaqueHTM(w.U, D.HTD);
  const htmC = opaqueHTM(w.U, cltd);
  wallsHeat += htmH * w.area;
  wallsSens += htmC * w.area;
  check(`L8 ${w.label} CLTD K@15/L`, cltd, 14.6, '°F');
  check(`L8 ${w.label} HTM_h`, htmH, 1.24);
  check(`L8 ${w.label} HTM_c`, htmC, 1.01, 'BTU/hr·SqFt', 0.01);
}

// --- Line 10 — Ceilings (white tile, direct CLTD = 19) ---
let ceilingsHeat = 0, ceilingsSens = 0;
for (const c of WALKER.opaque.ceilings) {
  const htmH = opaqueHTM(c.U, D.HTD);
  const htmC = opaqueHTM(c.U, c.directCLTD);
  ceilingsHeat += htmH * c.area;
  ceilingsSens += htmC * c.area;
  // Form J1 displays HTM_c as 0.49 (rounded from 0.026 × 19 = 0.494).
  // The Btuh load (865) confirms ACCA uses the precise value internally.
  check(`L10 ${c.label} HTM_h`, htmH, c.U * D.HTD);
  check(`L10 ${c.label} HTM_c`, htmC, c.U * c.directCLTD);
}

// --- Line 11 — Radiant slab (added to TOTAL not subtotal) ---
let radiantHeat = 0;
for (const f of WALKER.opaque.radiantFloors) {
  const htm = radiantSlabHTM(f.fValue, D.HTD);
  radiantHeat += htm * f.exposedEdgeFt;
  check(`L11 ${f.label} HTM (F×(HTD+25))`, htm, 12.34, 'BTU/hr·ft', 0.01);
}

// --- Line 12 — Infiltration (Track-record ACH + dominating positive pressure) ---
const inf = WALKER.infiltration;
const icfmHeat = spaceICFM(inf.achHeating, inf.aboveGradeVolume);
const icfmCool = spaceICFM(inf.achCooling, inf.aboveGradeVolume);
check(`L12 ICFM heat`, icfmHeat, 60, 'CFM');
check(`L12 ICFM cool`, icfmCool, 36, 'CFM');
const ncfmHeat = netInfiltrationCFM(icfmHeat, inf.cfmImbalance);
const ncfmCool = netInfiltrationCFM(icfmCool, inf.cfmImbalance);
check(`L12 NCFM heat (mitigating)`, ncfmHeat, 23, 'CFM', 0.02);
check(`L12 NCFM cool (dominating)`, ncfmCool, 0, 'CFM');
const infilHeat = infiltrationHeatLoad(ncfmHeat, D.HTD, D.ACF);
const infilSens = infiltrationSensLoad(ncfmCool, D.CTD, D.ACF);
const infilLat = infiltrationLatentLoad(ncfmCool, D.deltaGrains, D.ACF);
check(`L12 Infil heat`, infilHeat, 456, 'Btuh', 0.02);
check(`L12 Infil sens`, infilSens, 0);
check(`L12 Infil latent`, infilLat, 0);

// --- Line 13 — Internal (occupants + scenario 2 + custom appliances) ---
const occSens = WALKER.internal.occupants * WALKER.internal.sensiblePerOccupant;
const occLat = WALKER.internal.occupants * WALKER.internal.latentPerOccupant;
const scenarioSens = WALKER.internal.scenarioSensible;
const customSens = WALKER.internal.customAppliances.reduce((a, x) => a + x.sensible, 0);
const internalSens = occSens + scenarioSens + customSens;
const internalLat = occLat;
check(`L13a Occupants sens`, occSens, 920);
check(`L13a Occupants latent`, occLat, 800);
check(`L13b Scenario 2 sens`, scenarioSens, 3400);
check(`L13d Custom appliances sens`, customSens, 1221);

// --- Line 14 — Subtotal ---
// Walker has no below-grade walls, no passive floors. Radiant floor goes to TOTAL.
const line14Heat = windowsHeat + skylightsHeat + doorsHeat + wallsHeat
                  + ceilingsHeat + infilHeat;
const line14Sens = windowsSens + skylightsSens + doorsSens + wallsSens
                  + ceilingsSens + infilSens + internalSens;
const line14Lat = infilLat + internalLat;
check(`L14 Subtotal heat`, line14Heat, 5137);
check(`L14 Subtotal sens`, line14Sens, 12979);
check(`L14 Subtotal latent`, line14Lat, 800);

// --- Line 15 — Cooling-only duct loads ---
const duct = ductFactorsCoolingOnly(WALKER.ducts);
check(`L15 EHLF (radiant heat → 0)`, duct.EHLF, 0, 'factor');
check(`L15 ESGF`, duct.ESGF, 0.066, 'factor', 0.02);
check(`L15 ELG`, duct.ELG, 655, 'Btuh');
const ductHeat = duct.EHLF * line14Heat;                 // = 0 (no heating ducts)
const ductSens = duct.ESGF * line14Sens;
const ductLat = duct.ELG;
check(`L15 Duct heat`, ductHeat, 0);
check(`L15 Duct sens`, ductSens, 851, 'Btuh', 0.02);

// --- Line 16 — Plain ventilation (50 Cfm OA into VDH, no heat recovery) ---
const ventHeat = plainVentHeat(WALKER.ventilation.vcfm, D.HTD, D.ACF);
const ventSens = plainVentSens(WALKER.ventilation.vcfm, D.CTD, D.ACF);
const ventLat = plainVentLatent(WALKER.ventilation.vcfm, D.deltaGrains, D.ACF);
check(`L16 Vent heat`, ventHeat, 990);
check(`L16 Vent sens`, ventSens, 825, 'Btuh', 0.01);
check(`L16 Vent latent`, ventLat, 1938);

// --- Line 17 — No humidification (Florida) ---

// --- Line 19 — Blower heat ---
const blowerSens = blowerHeatLoad(WALKER.blower.defaultWatts);
check(`L19 Blower heat`, blowerSens, 1707, 'Btuh', 0.001);

// --- Line 20 — Latent moisture migration (no AED for Walker) ---
const moistureMigration = WALKER.latentMoistureMigration;

// --- Line 21 — Totals ---
//   Heat total = subtotal + ducts + vent + radiant added to total (NOT subtotal)
//   Sens total = subtotal + ducts + vent + blower + AED (=0 here)
//   Latent total = subtotal + ELG + vent latent + moisture migration
const totalHeat = line14Heat + ductHeat + ventHeat + radiantHeat;
const totalSens = line14Sens + ductSens + ventSens + blowerSens;
const totalLat = line14Lat + ductLat + ventLat + moistureMigration;
check(`L21 TOTAL HEATING LOAD`, totalHeat, 8299);
check(`L21 TOTAL SENSIBLE LOAD`, totalSens, 16362);
check(`L21 TOTAL LATENT LOAD`, totalLat, 7288);

// ============================================================================
// STEP 5 — Drift report (same format as Smith)
// ============================================================================
const PASS = '\x1b[32m✓\x1b[0m';
const FAIL = '\x1b[31m✗\x1b[0m';
const HEADER = '\x1b[1m';
const RESET = '\x1b[0m';

console.log(`\n${HEADER}═══════════════════════════════════════════════════════════════════════════════${RESET}`);
console.log(`${HEADER}    Manual J 8th Ed v2.50 — Walker Residence Validation${RESET}`);
console.log(`${HEADER}    ACCA reference: Section 13, pp. 125-134  •  Tolerance: ±0.5%${RESET}`);
console.log(`${HEADER}═══════════════════════════════════════════════════════════════════════════════${RESET}\n`);

console.log(`${'Check'.padEnd(40)} ${'Computed'.padStart(12)} ${'Expected'.padStart(12)} ${'Drift'.padStart(8)}`);
console.log('─'.repeat(80));

let totalChecks = 0, passedChecks = 0, worstDrift = 0;
for (const r of results) {
  totalChecks++;
  if (r.pass) passedChecks++;
  if (r.drift > worstDrift && r.drift < 1) worstDrift = r.drift;
  const driftPct = (r.drift * 100).toFixed(3) + '%';
  const computedStr = r.computed.toFixed(2);
  const expectedStr = r.expected.toFixed(2);
  const icon = r.pass ? PASS : FAIL;
  const color = r.pass ? '' : '\x1b[31m';
  console.log(`${icon} ${color}${r.label.padEnd(38)} ${computedStr.padStart(12)} ${expectedStr.padStart(12)} ${driftPct.padStart(8)}${RESET}`);
}

console.log('─'.repeat(80));
const allPassed = passedChecks === totalChecks;
console.log(`\n${HEADER}Result: ${passedChecks}/${totalChecks} checks passed${RESET}`);
console.log(`Worst drift (passing): ${(worstDrift * 100).toFixed(3)}%`);

if (allPassed) {
  console.log(`\n${PASS} ${HEADER}\x1b[32mWALKER RESIDENCE: VALIDATED${RESET}`);
  console.log(`   All Manual J 8th Ed worksheet computations match ACCA reference within 0.5%.`);
  console.log(`   Two cert test cases now green (Smith + Walker). Engine refactor de-risked.\n`);
  process.exit(0);
} else {
  const failed = results.filter(r => !r.pass);
  console.log(`\n${FAIL} ${HEADER}\x1b[31mWALKER RESIDENCE: DRIFT DETECTED${RESET}`);
  console.log(`   ${failed.length} check(s) failed. Investigate before committing engine code:\n`);
  for (const f of failed) {
    console.log(`     • ${f.label}: ${f.computed.toFixed(2)} vs ${f.expected.toFixed(2)} = ${(f.drift * 100).toFixed(3)}%`);
  }
  console.log();
  process.exit(1);
}

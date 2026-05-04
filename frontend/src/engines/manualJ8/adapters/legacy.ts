/**
 * Legacy → Manual J 8th Ed adapter (Phase 1: shadow-run).
 *
 * Lossy translation from the per-room `RoomInput` model in
 * `engines/manualJ.ts` to the whole-house `FormJ1Input` consumed by
 * `engines/manualJ8/buildFormJ1`. Used to run the cert-grade engine
 * alongside the legacy engine for drift telemetry — the legacy engine's
 * displayed numbers do not change in Phase 1.
 *
 * Mapping notes:
 *  - Legacy R-values + WallConstructionGroup do not uniquely identify a
 *    Manual J Table 4A construction. We pick the closest registry entry
 *    for each Group / floor type.
 *  - Legacy duct math is a flat multiplier; the new engine uses Table 7
 *    base factors. We pass canonical Smith-equivalent base factors and
 *    set `percentInUnconditioned` based on legacy `ductLocation`.
 *  - Aggregations are best-effort. On unmapped inputs the adapter throws;
 *    callers should wrap in try/catch and log the failure.
 */

import {
  type RoomInput,
  type DesignConditions as LegacyConditions,
  type Exposure,
  type WallConstructionGroup,
  type DailyRange as LegacyDailyRange,
  type DuctLocation as LegacyDuctLocation,
} from '../../manualJ';
import type {
  FormJ1Input,
  DesignConditions as J8Conditions,
  WindowInput,
  OpaqueInput,
  InfiltrationInput,
  InternalLoadsInput,
  DuctInput,
  VentilationInput,
  AncillaryInput,
  AdjustmentContext,
  DailyRange as J8DailyRange,
} from '../types';

// ── Solar / shading defaults ──────────────────────────────────────────
// PSF (Peak Solar Factor, Btu/hr·ft²) by latitude × direction. These
// mirror the legacy SOLAR_IRRADIANCE_BY_LATITUDE table so that windows
// see comparable solar inputs across both engines.
const PSF_BY_LATITUDE: { lat: number; values: Record<Exposure, number> }[] = [
  { lat: 24, values: { N: 44, NE: 160, E: 222, SE: 141, S: 66, SW: 141, W: 222, NW: 160 } },
  { lat: 28, values: { N: 42, NE: 151, E: 220, SE: 155, S: 78, SW: 155, W: 220, NW: 151 } },
  { lat: 32, values: { N: 40, NE: 143, E: 218, SE: 168, S: 91, SW: 168, W: 218, NW: 143 } },
  { lat: 36, values: { N: 39, NE: 138, E: 217, SE: 179, S: 104, SW: 179, W: 217, NW: 138 } },
  { lat: 40, values: { N: 38, NE: 134, E: 216, SE: 190, S: 117, SW: 190, W: 216, NW: 134 } },
  { lat: 44, values: { N: 37, NE: 127, E: 214, SE: 197, S: 131, SW: 197, W: 214, NW: 127 } },
  { lat: 48, values: { N: 36, NE: 120, E: 212, SE: 203, S: 145, SW: 203, W: 212, NW: 120 } },
];

// Cooling Load Factor (CLF_avg) defaults from Manual J Table 3D-3 — the
// fraction of peak solar gain that translates to design hour load. North
// gets the highest CLF (no peak / direct sun); South is lowest (peak at
// noon when solar elevation is high).
const CLF_BY_DIRECTION: Record<Exposure, number> = {
  N: 0.29, NE: 0.32, E: 0.32, SE: 0.27,
  S: 0.18, SW: 0.27, W: 0.32, NW: 0.32,
};

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lookupPSF(latitude: number, exposure: Exposure): number {
  const t = PSF_BY_LATITUDE;
  const lat = Math.max(t[0].lat, Math.min(t[t.length - 1].lat, latitude));
  for (let i = 0; i < t.length - 1; i++) {
    if (lat >= t[i].lat && lat <= t[i + 1].lat) {
      const f = (lat - t[i].lat) / (t[i + 1].lat - t[i].lat);
      return lerp(t[i].values[exposure], t[i + 1].values[exposure], f);
    }
  }
  return t[t.length - 1].values[exposure];
}

// ── Group → Construction ID mapping ───────────────────────────────────
// Selects a representative Manual J Construction registry entry for each
// legacy WallConstructionGroup. Lossy by design — the new engine resolves
// U-value from this ID rather than legacy `wallRValue`, so cooling math
// (CLTD lookup + group letter) will dominate any U-value mismatch.
const WALL_GROUP_TO_CONSTRUCTION: Record<WallConstructionGroup, string> = {
  I: '12C-3s/w',     // R-13 cavity, R-3 board, siding/wood (Group K cooling)
  J: '12E-3s/w',     // R-19 cavity in 2x6, R-3 board, siding/wood (Group K cooling)
  K: '13Ca-0oc-w',   // CMU + R-13 stud cavity, no board, wood, open core (Group I cooling)
  L: '14E-3',        // 8" brick / 140# concrete + R-3 board (Group H cooling)
};

// ── Daily range mapping ───────────────────────────────────────────────
const DR_LEGACY_TO_J8: Record<LegacyDailyRange, J8DailyRange> = {
  low: 'L',
  medium: 'M',
  high: 'H',
};

// ── Duct location mapping ─────────────────────────────────────────────
const DUCT_LOC_LEGACY_TO_J8: Record<LegacyDuctLocation, DuctInput['location']> = {
  conditioned: 'conditioned',
  attic: 'vented_attic',
  crawlspace: 'closed_crawlspace',
  garage: 'other',
  basement_uncond: 'other',
};

// ── ACH defaults by legacy `constructionQuality` (mirrors manualJ.ts) ─
const ACH_BY_QUALITY: Record<'tight' | 'average' | 'leaky', number> = {
  tight: 0.25,
  average: 0.5,
  leaky: 0.75,
};

// ── Activity gains (Manual J Table 6) — sensible only; latent applied
//    via per-occupant defaults inside the engine.
const ACTIVITY_SENSIBLE: Record<string, number> = {
  sleeping: 200,
  seated: 230,
  light_work: 300,
  moderate_exercise: 500,
  heavy_exercise: 700,
};

// ── Lighting heat gain by type (BTU/hr·ft²) ───────────────────────────
const LIGHTING_BTU_PER_SQFT: Record<string, number> = {
  led: 0.5,
  fluorescent: 1.2,
  incandescent: 3.5,
  mixed: 1.8,
};

/** ASHRAE 62.2-2010 mechanical ventilation CFM. Mirrors legacy. */
function ashrae622VentilationCFM(floorArea: number, numBedrooms: number): number {
  return Math.round(0.03 * floorArea + 7.5 * (numBedrooms + 1));
}

/** Altitude correction factor — Manual J Table 10A linear approximation,
 *  clamped to [0.85, 1.0]. */
function altitudeCorrectionFactor(elevationFt: number): number {
  return Math.max(0.85, Math.min(1.0, 1 - 0.000035 * elevationFt));
}

/** Convert legacy DesignConditions to the Manual J 8 DesignConditions. */
function adaptConditions(legacy: LegacyConditions): J8Conditions {
  return {
    state: '',
    city: '',
    elevation: legacy.elevation,
    latitude: legacy.latitude,
    indoorHeatDB: legacy.indoorHeatingTemp,
    indoorCoolDB: legacy.indoorCoolingTemp,
    indoorCoolRH: 50,
    outdoor99DB: legacy.outdoorHeatingTemp,
    outdoor1DB: legacy.outdoorCoolingTemp,
    coincidentWB: legacy.outdoorCoolingTemp - 15, // approximation; not used by engine for non-vent calcs
    deltaGrains: Math.max(0, legacy.outdoorGrains - legacy.indoorGrains),
    dailyRange: DR_LEGACY_TO_J8[legacy.coolingDailyRange],
    HTD: legacy.indoorHeatingTemp - legacy.outdoorHeatingTemp,
    CTD: legacy.outdoorCoolingTemp - legacy.indoorCoolingTemp,
    ACF: altitudeCorrectionFactor(legacy.elevation),
  };
}

/** Estimate the gross exterior wall area for a single legacy room.
 *  Legacy stores `exteriorWalls` as a count (1–4), so we approximate
 *  by taking that fraction of the room's perimeter × ceiling height. */
function roomGrossWallArea(room: RoomInput): number {
  const perimeter = 2 * (room.lengthFt + room.widthFt);
  const fraction = Math.max(0, Math.min(4, room.exteriorWalls)) / 4;
  return perimeter * fraction * room.ceilingHeightFt;
}

function roomFootprint(room: RoomInput): number {
  return room.lengthFt * room.widthFt;
}

function roomVolume(room: RoomInput): number {
  return roomFootprint(room) * room.ceilingHeightFt;
}

/**
 * Convert legacy per-room inputs into a single Form J1 whole-house input.
 *
 * @param rooms — legacy `RoomInput[]` (per-room aggregated)
 * @param legacy — legacy `DesignConditions`
 * @param aedExcursion — optional precomputed AED excursion (Btuh sensible).
 *        The shadow-run flow passes the legacy engine's AED result here so
 *        Form J1 Line 20 lines up.
 */
export function roomInputsToFormJ1Input(
  rooms: RoomInput[],
  legacy: LegacyConditions,
  aedExcursion = 0,
): FormJ1Input {
  if (rooms.length === 0) {
    throw new Error('Cannot adapt: no rooms provided.');
  }

  const conditions = adaptConditions(legacy);

  // ── Windows: aggregate by exposure direction ──────────────────────
  type WindowAgg = {
    area: number; sumUArea: number; sumShgcArea: number;
    sumIscArea: number;
  };
  const windowsByDir = new Map<Exposure, WindowAgg>();
  for (const r of rooms) {
    if (r.windowSqFt <= 0) continue;
    const dir = r.exposureDirection;
    const a = windowsByDir.get(dir) ?? {
      area: 0, sumUArea: 0, sumShgcArea: 0, sumIscArea: 0,
    };
    a.area += r.windowSqFt;
    a.sumUArea += r.windowUValue * r.windowSqFt;
    a.sumShgcArea += r.windowSHGC * r.windowSqFt;
    a.sumIscArea += r.interiorShading * r.windowSqFt;
    windowsByDir.set(dir, a);
  }
  const windows: WindowInput[] = [];
  for (const [dir, a] of windowsByDir) {
    if (a.area === 0) continue;
    windows.push({
      id: `6a-${dir}`,
      label: `Aggregate ${dir} glazing`,
      area: a.area,
      uValue: a.sumUArea / a.area,
      shgc: a.sumShgcArea / a.area,
      psf: lookupPSF(legacy.latitude, dir),
      clfAvg: CLF_BY_DIRECTION[dir],
      isc: a.sumIscArea / a.area,
      screenAdjustment: 1.0,
    });
  }

  // ── Above-grade walls: aggregate by Group ─────────────────────────
  const wallsByGroup = new Map<WallConstructionGroup, number>();
  let belowGradeWallArea = 0;
  for (const r of rooms) {
    const gross = roomGrossWallArea(r);
    if (gross <= 0) continue;
    // Subtract window area from the room's gross to get the net opaque area
    // for the above-grade portion. Below-grade rooms contribute to a
    // separate below-grade aggregate (no window subtraction — by code,
    // basement walls do not host windows in this aggregation).
    const net = Math.max(0, gross - r.windowSqFt);
    if (r.wallGrade === 'above') {
      const g = r.wallGroup ?? 'I';
      wallsByGroup.set(g, (wallsByGroup.get(g) ?? 0) + net);
    } else {
      // below_full / below_partial: send to below-grade bucket
      belowGradeWallArea += gross;
    }
  }
  const aboveGradeWalls: OpaqueInput[] = [];
  for (const [group, area] of wallsByGroup) {
    aboveGradeWalls.push({
      id: `8-${group}`,
      label: `Aggregate Group-${group} walls`,
      constructionId: WALL_GROUP_TO_CONSTRUCTION[group],
      area,
    });
  }

  // ── Below-grade walls (heating only) ──────────────────────────────
  const belowGradeWalls: OpaqueInput[] = [];
  if (belowGradeWallArea > 0) {
    // Average the below-grade depth across rooms reporting one
    const depths = rooms
      .filter((r) => r.wallGrade !== 'above' && r.belowGradeDepthFt > 0)
      .map((r) => r.belowGradeDepthFt);
    const avgDepth = depths.length
      ? depths.reduce((s, d) => s + d, 0) / depths.length
      : 4;
    belowGradeWalls.push({
      id: '9-bg',
      label: 'Aggregate below-grade walls',
      constructionId: '15A-4sffc-x',  // R-4 closed cell sill→floor, open core
      area: belowGradeWallArea,
      basementFloorDepthFt: avgDepth,
    });
  }

  // ── Ceilings: one aggregate entry, sum of footprints ──────────────
  const ceilings: OpaqueInput[] = [];
  const totalCeilingArea = rooms.reduce((s, r) => s + roomFootprint(r), 0);
  if (totalCeilingArea > 0) {
    ceilings.push({
      id: '10-a',
      label: 'Aggregate ceiling under attic',
      constructionId: '16B-30ad',  // R-30, dark shingle, no radiant barrier
      area: totalCeilingArea,
    });
  }

  // ── Floors: bucket by floor type ──────────────────────────────────
  const passiveFloors: OpaqueInput[] = [];
  const partitionFloors: OpaqueInput[] = [];
  let crawlArea = 0;
  let basementArea = 0;
  let slabPerimeter = 0;
  for (const r of rooms) {
    const fp = roomFootprint(r);
    switch (r.floorType) {
      case 'crawlspace':
        crawlArea += fp;
        break;
      case 'basement':
        basementArea += fp;
        break;
      case 'slab':
        slabPerimeter += r.perimeterFt ?? (2 * (r.lengthFt + r.widthFt));
        break;
      case 'over_conditioned':
      default:
        // No envelope load — interior floor between conditioned spaces
        break;
    }
  }
  if (crawlArea > 0) {
    partitionFloors.push({
      id: '11-cs',
      label: 'Floor over crawl',
      constructionId: '19B-osp',
      area: crawlArea,
    });
  }
  if (basementArea > 0) {
    passiveFloors.push({
      id: '11-b',
      label: 'Basement floor',
      constructionId: '21A-32',
      area: basementArea,
    });
  }
  if (slabPerimeter > 0) {
    passiveFloors.push({
      id: '11-s',
      label: 'Slab perimeter',
      constructionId: '22B-5ph',
      area: slabPerimeter,  // slab uses linear feet as area
    });
  }

  // ── Infiltration: whole-house ACH from constructionQuality ────────
  const totalFloorArea = legacy.totalFloorArea > 0
    ? legacy.totalFloorArea
    : rooms.reduce((s, r) => s + roomFootprint(r), 0);
  const totalVolume = rooms.reduce((s, r) => s + roomVolume(r), 0);
  const ach = ACH_BY_QUALITY[legacy.constructionQuality];
  const infiltration: InfiltrationInput = {
    method: 'table_5A_ACH',
    floorArea: totalFloorArea,
    aboveGradeVolume: totalVolume,
    achHeating: ach,
    achCooling: ach * 0.5,    // Manual J: cooling ACH ≈ half heating ACH
    cfmImbalance: 0,
  };

  // ── Internal loads: sum occupants + scenarios + appliances ────────
  const totalOccupants = rooms.reduce((s, r) => s + (r.occupantCount ?? 0), 0);
  let scenarioSensible = 0;
  for (const r of rooms) {
    if (r.occupantActivity && ACTIVITY_SENSIBLE[r.occupantActivity]) {
      scenarioSensible += (r.occupantCount ?? 0)
        * (ACTIVITY_SENSIBLE[r.occupantActivity] - 230); // 230 = baseline already counted by engine
    }
    if (r.lightingType && LIGHTING_BTU_PER_SQFT[r.lightingType]) {
      scenarioSensible += LIGHTING_BTU_PER_SQFT[r.lightingType] * roomFootprint(r);
    }
    if (r.miscSensibleBtu) scenarioSensible += r.miscSensibleBtu;
  }
  const customAppliances = [];
  for (const r of rooms) {
    for (const app of r.appliances ?? []) {
      const total = app.count * app.sensibleBtu;
      const totalLat = app.count * app.latentBtu;
      if (total === 0 && totalLat === 0) continue;
      customAppliances.push({
        name: `${r.name}: ${app.label}`,
        sensible: total,
        latent: totalLat,
      });
    }
  }
  const internal: InternalLoadsInput = {
    occupants: totalOccupants,
    scenarioSensible: Math.max(0, scenarioSensible),
    customAppliances,
  };

  // ── Ducts: canonical Smith-equivalent base factors ────────────────
  // Phase 1 limitation: legacy engine uses a flat multiplier; new engine
  // uses Table 7. We pick representative residential base factors and let
  // `percentInUnconditioned` toggle by ductLocation. Drift in this line
  // is expected and tracked by telemetry.
  const ductLoc = DUCT_LOC_LEGACY_TO_J8[legacy.ductLocation];
  const ducts: DuctInput = {
    location: ductLoc,
    percentInUnconditioned: ductLoc === 'conditioned' ? 0 : 1.0,
    rValue: legacy.ductInsulationR,
    leakage: '0.35/0.70',
    baseHeatLossFactor: 0.110,
    baseSensGainFactor: 0.060,
    baseLatentGain: 971,
    wifHeatLoss: 1.20,
    wifSensGain: 1.20,
    lcfHeatLoss: 2.480,
    lcfSensGain: 2.390,
    lcfLatentGain: 3.880,
  };

  // ── Ventilation: ASHRAE 62.2 default, no HRV ──────────────────────
  const ventilation: VentilationInput = {
    vcfm: ashrae622VentilationCFM(totalFloorArea, legacy.numBedrooms),
    hasHeatRecovery: false,
    serHeating: 0,
    serCooling: 0,
    ler: 0,
    balanced: false,
  };

  // ── Ancillary: blower default 500 W, humidification by grains ─────
  const ancillary: AncillaryInput = {
    indoorGrains: legacy.indoorGrains,
    outdoorGrains: legacy.outdoorGrains,
    blowerWatts: 500,
  };

  const adjustments: AdjustmentContext = {
    color: 'medium',
    outdoorDesignDB: legacy.outdoorCoolingTemp,
    dailyRange: DR_LEGACY_TO_J8[legacy.coolingDailyRange],
    externallyShaded: false,
  };

  return {
    conditions,
    windows,
    skylights: [],
    doors: [],
    aboveGradeWalls,
    partitionWalls: [],
    belowGradeWalls,
    ceilings,
    partitionCeilings: [],
    passiveFloors,
    partitionFloors,
    radiantFloors: [],
    infiltration,
    internal,
    ducts,
    ventilation,
    ancillary,
    aedBlockExcursion: aedExcursion,
    latentMoistureMigration: 0,
    adjustments,
  };
}

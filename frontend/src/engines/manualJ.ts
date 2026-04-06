/**
 * HVAC DesignPro — Manual J Calculation Engine
 * Based on ACCA Manual J 8th Edition methodology
 *
 * This engine implements:
 *  1. Duct loss multipliers (Table 7)
 *  2. Humidity ratio–based latent calculation (grains of moisture)
 *  3. Above-grade / below-grade wall distinctions
 *  4. SHGC-based solar heat gain
 *  5. ASHRAE 62.2 mechanical ventilation load
 *
 * DISCLAIMER: This is a design-aid implementation. Professional engineers
 * must verify all outputs before use in permit applications.
 */

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export type FloorType = 'slab' | 'crawlspace' | 'basement' | 'over_conditioned';
export type Exposure = 'N' | 'S' | 'E' | 'W' | 'NE' | 'NW' | 'SE' | 'SW';
export type GlassType = 'single_clear' | 'double_clear' | 'double_low_e' | 'triple_low_e';
export type DuctLocation = 'conditioned' | 'attic' | 'crawlspace' | 'garage' | 'basement_uncond';
export type WallGradeType = 'above' | 'below_full' | 'below_partial';
export type Construction = 'tight' | 'average' | 'leaky';
export type DailyRange = 'low' | 'medium' | 'high';

export interface RoomInput {
  id: string;
  name: string;
  lengthFt: number;
  widthFt: number;
  ceilingHeightFt: number;

  // Walls
  exteriorWalls: number;
  wallRValue: number;
  wallGrade: WallGradeType;
  belowGradeDepthFt: number;   // depth below grade (for partial/full below-grade)

  // Windows
  windowSqFt: number;
  windowCount: number;
  windowUValue: number;
  windowSHGC: number;          // Solar Heat Gain Coefficient (0.0–1.0)
  glassType: GlassType;
  interiorShading: number;     // Interior shading coefficient (0.0–1.0, 1.0 = no shading)

  // Ceiling & Floor
  ceilingRValue: number;
  floorRValue: number;
  floorType: FloorType;

  // Orientation
  exposureDirection: Exposure;

  // Occupancy
  occupantCount: number;
}

export interface DesignConditions {
  // Temperatures
  outdoorHeatingTemp: number;
  outdoorCoolingTemp: number;
  indoorHeatingTemp: number;
  indoorCoolingTemp: number;

  // Humidity (grains of moisture per pound of dry air)
  outdoorGrains: number;       // Outdoor humidity ratio (gr/lb)
  indoorGrains: number;        // Indoor humidity ratio (gr/lb) — typically 50-55

  // Location
  latitude: number;
  elevation: number;           // ft above sea level (affects air density)
  coolingDailyRange: DailyRange;

  // Duct system
  ductLocation: DuctLocation;
  ductInsulationR: number;     // R-value of duct insulation
  ductLeakagePercent: number;  // % of airflow lost to leakage (tested or estimated)
  ductLengthFt: number;        // total duct run length

  // Building envelope
  constructionQuality: Construction;
  numBedrooms: number;         // for ASHRAE 62.2 ventilation
  totalFloorArea: number;      // whole-building floor area for ventilation calc
}

export interface RoomResult {
  roomId: string;
  roomName: string;
  heatingBtu: number;
  coolingBtuSensible: number;
  coolingBtuLatent: number;
  coolingBtuTotal: number;
  breakdown: {
    wallLoss: number;
    windowLoss: number;
    ceilingLoss: number;
    floorLoss: number;
    infiltrationSensible: number;
    infiltrationLatent: number;
    ventilationSensible: number;
    ventilationLatent: number;
    solarGain: number;
    internalGain: number;
    ductLoss: number;
  };
}

export interface WholeHouseResult {
  rooms: RoomResult[];
  totalHeatingBtu: number;
  totalCoolingSensible: number;
  totalCoolingLatent: number;
  totalCoolingBtu: number;
  ductLossHeating: number;
  ductLossCooling: number;
  ventilationCFM: number;
  ventilationSensible: number;
  ventilationLatent: number;
  recommendedTons: number;
  sensibleHeatRatio: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONSTANTS & LOOKUP TABLES
// ═══════════════════════════════════════════════════════════════════════════════

/** Sensible heat factor: BTU/(hr·CFM·°F) */
const AIR_HEAT_FACTOR = 1.08;

/** Latent heat factor: BTU/(hr·CFM·Δgr) — 0.68 BTU per grain difference */
const AIR_LATENT_FACTOR = 0.68;

/** ACH by construction quality */
const ACH_BY_CONSTRUCTION: Record<Construction, number> = {
  tight: 0.25,
  average: 0.5,
  leaky: 0.75,
};

/**
 * Duct Loss Multipliers (Manual J Table 7 simplified)
 * Applied to total equipment load to account for duct losses.
 * Format: [heating multiplier, cooling multiplier]
 */
const DUCT_LOSS_MULTIPLIERS: Record<DuctLocation, [number, number]> = {
  conditioned:      [1.00, 1.00],  // no loss — ducts inside conditioned space
  attic:            [1.15, 1.15],  // 15% loss for typical attic ducts (R-6)
  crawlspace:       [1.10, 1.10],  // 10% loss
  garage:           [1.12, 1.12],  // 12% loss
  basement_uncond:  [1.08, 1.08],  // 8% loss — semi-conditioned
};

/** Adjusted duct multiplier based on insulation & leakage */
function getDuctMultiplier(
  location: DuctLocation,
  ductR: number,
  leakagePct: number,
  mode: 'heating' | 'cooling'
): number {
  const base = mode === 'heating'
    ? DUCT_LOSS_MULTIPLIERS[location][0]
    : DUCT_LOSS_MULTIPLIERS[location][1];

  if (location === 'conditioned') return 1.0;

  // Adjust for insulation quality: R-8 = baseline; higher R reduces loss
  const insulationFactor = Math.max(0.6, Math.min(1.4, 6 / Math.max(ductR, 1)));

  // Adjust for leakage: 4% = baseline; higher leakage increases loss
  const leakageFactor = Math.max(0.8, Math.min(1.5, leakagePct / 4));

  const loss = (base - 1.0) * insulationFactor * leakageFactor;
  return 1.0 + loss;
}

/**
 * SHGC-based Solar Heat Gain (Manual J Table 3A/3B simplified)
 * Peak solar irradiance by direction in BTU/(hr·ft²) at ~40° latitude
 * These represent clear-sky July 21 peak values.
 */
const SOLAR_IRRADIANCE: Record<Exposure, number> = {
  N:  35,
  NE: 105,
  E:  180,
  SE: 140,
  S:  75,
  SW: 140,
  W:  180,
  NW: 105,
};

/** Daily range correction for CLTD (Cooling Load Temperature Difference) */
const DAILY_RANGE_CORRECTION: Record<DailyRange, number> = {
  low:    0,     // coastal / humid climates (DR < 16°F)
  medium: -3,    // moderate climates (DR 16–25°F)
  high:   -5,    // dry/arid climates (DR > 25°F)
};

/** Internal gains per person — sensible + latent (Manual J Table 6) */
const INTERNAL_GAIN_SENSIBLE_PER_PERSON = 230;  // BTU/hr (seated, light activity)
const INTERNAL_GAIN_LATENT_PER_PERSON = 190;    // BTU/hr

/** Appliance + lighting internal gains */
const APPLIANCE_GAIN_PER_SQFT = 1.0; // BTU/hr per sqft (lights, appliances baseline)

/** Ground temperature approximation for below-grade walls */
function groundTemp(outdoorHeatingTemp: number, outdoorCoolingTemp: number): number {
  // Annual average — simplified; real Manual J uses Table 1
  return (outdoorHeatingTemp + outdoorCoolingTemp) / 2;
}

/**
 * Effective R-value for below-grade walls
 * Soil provides additional thermal resistance — ~1 R per foot of depth
 * Plus concrete wall resistance (~R-1.5 for 8" CMU)
 */
function belowGradeEffectiveR(wallR: number, depthFt: number): number {
  const soilR = depthFt * 1.0;  // ~R-1 per foot of soil
  const concreteR = 1.5;        // 8" CMU baseline
  return wallR + soilR + concreteR;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ASHRAE 62.2 VENTILATION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * ASHRAE 62.2-2022 Minimum Ventilation Rate
 * Qtot = 0.03 × Afloor + 7.5 × (Nbr + 1)
 * where Afloor = conditioned floor area (ft²), Nbr = number of bedrooms
 */
export function ashrae622VentilationCFM(floorArea: number, numBedrooms: number): number {
  return 0.03 * floorArea + 7.5 * (numBedrooms + 1);
}

// ═══════════════════════════════════════════════════════════════════════════════
// ROOM CALCULATION
// ═══════════════════════════════════════════════════════════════════════════════

export function calculateRoom(room: RoomInput, conditions: DesignConditions): RoomResult {
  const floorArea = room.lengthFt * room.widthFt;
  const volume = floorArea * room.ceilingHeightFt;
  const heatingDT = conditions.indoorHeatingTemp - conditions.outdoorHeatingTemp;
  const coolingDT = conditions.outdoorCoolingTemp - conditions.indoorCoolingTemp;
  const deltaGrains = conditions.outdoorGrains - conditions.indoorGrains;

  // Air density correction for elevation
  const densityCorrection = Math.exp(-conditions.elevation / 27000);

  // ── Wall Area ─────────────────────────────────────────────────────────
  const grossWallArea = room.exteriorWalls * room.lengthFt * room.ceilingHeightFt;
  const netWallArea = Math.max(0, grossWallArea - room.windowSqFt);

  // ── ABOVE vs BELOW GRADE WALLS ────────────────────────────────────────
  let wallREffective = room.wallRValue;
  let wallHeatingDT = heatingDT;
  let wallCoolingDT = coolingDT;

  if (room.wallGrade === 'below_full') {
    // Fully below grade — use ground temperature as outdoor reference
    wallREffective = belowGradeEffectiveR(room.wallRValue, room.belowGradeDepthFt);
    const gndTemp = groundTemp(conditions.outdoorHeatingTemp, conditions.outdoorCoolingTemp);
    wallHeatingDT = conditions.indoorHeatingTemp - gndTemp;
    wallCoolingDT = Math.max(0, gndTemp - conditions.indoorCoolingTemp);
  } else if (room.wallGrade === 'below_partial') {
    // Partially below grade — blend above-grade and below-grade
    const aboveFraction = Math.max(0, 1 - (room.belowGradeDepthFt / room.ceilingHeightFt));
    const belowFraction = 1 - aboveFraction;
    const gndTemp = groundTemp(conditions.outdoorHeatingTemp, conditions.outdoorCoolingTemp);

    const aboveR = room.wallRValue;
    const belowR = belowGradeEffectiveR(room.wallRValue, room.belowGradeDepthFt);

    // Weighted effective R and deltaT
    wallREffective = 1 / (aboveFraction / aboveR + belowFraction / belowR);
    wallHeatingDT = aboveFraction * heatingDT + belowFraction * (conditions.indoorHeatingTemp - gndTemp);
    wallCoolingDT = aboveFraction * coolingDT + belowFraction * Math.max(0, gndTemp - conditions.indoorCoolingTemp);
  }

  // ── HEATING LOSSES ────────────────────────────────────────────────────
  const wallLossH = (netWallArea / wallREffective) * wallHeatingDT;
  const windowLossH = (room.windowSqFt * room.windowUValue) * heatingDT;
  const ceilingLossH = (floorArea / room.ceilingRValue) * heatingDT;

  let floorLossH = 0;
  switch (room.floorType) {
    case 'slab':
      // Slab-on-grade: perimeter method — ~0.81 BTU/hr per ft of perimeter per °F (uninsulated)
      // Simplified: use R-value approach with 50% attenuation
      floorLossH = (floorArea / room.floorRValue) * heatingDT * 0.5;
      break;
    case 'crawlspace':
      floorLossH = (floorArea / room.floorRValue) * heatingDT * 0.67;
      break;
    case 'basement':
      floorLossH = (floorArea / room.floorRValue) * heatingDT * 0.35;
      break;
    case 'over_conditioned':
      floorLossH = 0;
      break;
  }

  // Infiltration — sensible
  const ach = ACH_BY_CONSTRUCTION[conditions.constructionQuality];
  const infiltCFM = (volume * ach) / 60 * densityCorrection;
  const infiltSensibleH = AIR_HEAT_FACTOR * infiltCFM * heatingDT;

  // Room heating subtotal (before duct loss)
  const roomHeatingRaw = wallLossH + windowLossH + ceilingLossH + floorLossH + infiltSensibleH;

  // ── COOLING GAINS ─────────────────────────────────────────────────────

  // CLTD correction for daily range
  const cltdCorrection = DAILY_RANGE_CORRECTION[conditions.coolingDailyRange];
  const adjustedCoolingDT = Math.max(0, coolingDT + cltdCorrection);

  const wallGainC = (netWallArea / wallREffective) * wallCoolingDT;
  const windowConductionC = (room.windowSqFt * room.windowUValue) * adjustedCoolingDT;
  const ceilingGainC = (floorArea / room.ceilingRValue) * adjustedCoolingDT;

  let floorGainC = 0;
  if (room.floorType === 'crawlspace') {
    floorGainC = (floorArea / room.floorRValue) * adjustedCoolingDT * 0.3;
  }

  // ── SHGC-BASED SOLAR GAIN ────────────────────────────────────────────
  // Q_solar = A_window × SHGC × I_solar × IAC (interior attenuation coefficient)
  const solarIrradiance = SOLAR_IRRADIANCE[room.exposureDirection] ?? 75;
  const solarGain = room.windowSqFt * room.windowSHGC * solarIrradiance * room.interiorShading;

  // Infiltration — sensible + latent (cooling)
  const infiltSensibleC = AIR_HEAT_FACTOR * infiltCFM * adjustedCoolingDT;
  const infiltLatentC = AIR_LATENT_FACTOR * infiltCFM * Math.max(0, deltaGrains);

  // Internal gains — people
  const peopleSensible = room.occupantCount * INTERNAL_GAIN_SENSIBLE_PER_PERSON;
  const peopleLatent = room.occupantCount * INTERNAL_GAIN_LATENT_PER_PERSON;

  // Internal gains — appliances & lights
  const applianceGain = floorArea * APPLIANCE_GAIN_PER_SQFT;

  // Sensible cooling subtotal
  const roomCoolingSensibleRaw =
    wallGainC + windowConductionC + ceilingGainC + floorGainC +
    solarGain + infiltSensibleC + peopleSensible + applianceGain;

  // Latent cooling subtotal
  const roomCoolingLatentRaw = infiltLatentC + peopleLatent;

  return {
    roomId: room.id,
    roomName: room.name,
    heatingBtu: Math.round(roomHeatingRaw),
    coolingBtuSensible: Math.round(roomCoolingSensibleRaw),
    coolingBtuLatent: Math.round(roomCoolingLatentRaw),
    coolingBtuTotal: Math.round(roomCoolingSensibleRaw + roomCoolingLatentRaw),
    breakdown: {
      wallLoss: Math.round(wallLossH),
      windowLoss: Math.round(windowLossH),
      ceilingLoss: Math.round(ceilingLossH),
      floorLoss: Math.round(floorLossH),
      infiltrationSensible: Math.round(infiltSensibleH),
      infiltrationLatent: Math.round(infiltLatentC),
      ventilationSensible: 0,  // filled in at whole-house level
      ventilationLatent: 0,
      solarGain: Math.round(solarGain),
      internalGain: Math.round(peopleSensible + applianceGain),
      ductLoss: 0,  // filled in at whole-house level
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// WHOLE-HOUSE CALCULATION
// ═══════════════════════════════════════════════════════════════════════════════

export function calculateWholeHouse(
  rooms: RoomInput[],
  conditions: DesignConditions
): WholeHouseResult {
  // 1. Calculate each room
  const roomResults = rooms.map(r => calculateRoom(r, conditions));

  // 2. Sum room loads
  let sumHeating = roomResults.reduce((s, r) => s + r.heatingBtu, 0);
  let sumCoolingSensible = roomResults.reduce((s, r) => s + r.coolingBtuSensible, 0);
  let sumCoolingLatent = roomResults.reduce((s, r) => s + r.coolingBtuLatent, 0);

  // 3. ASHRAE 62.2 Ventilation Load (whole-house)
  const ventCFM = ashrae622VentilationCFM(conditions.totalFloorArea, conditions.numBedrooms);
  const heatingDT = conditions.indoorHeatingTemp - conditions.outdoorHeatingTemp;
  const coolingDT = conditions.outdoorCoolingTemp - conditions.indoorCoolingTemp;
  const deltaGrains = Math.max(0, conditions.outdoorGrains - conditions.indoorGrains);

  const ventSensibleH = AIR_HEAT_FACTOR * ventCFM * heatingDT;
  const ventSensibleC = AIR_HEAT_FACTOR * ventCFM * coolingDT;
  const ventLatentC = AIR_LATENT_FACTOR * ventCFM * deltaGrains;

  sumHeating += ventSensibleH;
  sumCoolingSensible += ventSensibleC;
  sumCoolingLatent += ventLatentC;

  // 4. Duct Loss Multipliers
  const ductMultH = getDuctMultiplier(
    conditions.ductLocation, conditions.ductInsulationR,
    conditions.ductLeakagePercent, 'heating'
  );
  const ductMultC = getDuctMultiplier(
    conditions.ductLocation, conditions.ductInsulationR,
    conditions.ductLeakagePercent, 'cooling'
  );

  const ductLossHeating = Math.round(sumHeating * (ductMultH - 1));
  const ductLossCooling = Math.round((sumCoolingSensible + sumCoolingLatent) * (ductMultC - 1));

  const totalHeating = Math.round(sumHeating * ductMultH);
  const totalCoolingSensible = Math.round(sumCoolingSensible * ductMultC);
  const totalCoolingLatent = Math.round(sumCoolingLatent * ductMultC);
  const totalCooling = totalCoolingSensible + totalCoolingLatent;

  // 5. Equipment sizing
  const recommendedTons = Math.ceil((totalCooling / 12000) * 2) / 2; // round to nearest 0.5 ton

  // 6. Sensible Heat Ratio
  const shr = totalCooling > 0 ? totalCoolingSensible / totalCooling : 1;

  return {
    rooms: roomResults,
    totalHeatingBtu: totalHeating,
    totalCoolingSensible: totalCoolingSensible,
    totalCoolingLatent: totalCoolingLatent,
    totalCoolingBtu: totalCooling,
    ductLossHeating,
    ductLossCooling,
    ventilationCFM: Math.round(ventCFM),
    ventilationSensible: Math.round(ventSensibleH),
    ventilationLatent: Math.round(ventLatentC),
    recommendedTons,
    sensibleHeatRatio: Math.round(shr * 100) / 100,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// UTILITY
// ═══════════════════════════════════════════════════════════════════════════════

export function tonnageFromBtu(btu: number): string {
  return (btu / 12000).toFixed(2);
}

/** Default room with ACCA-grade inputs */
export function createDefaultRoom(index: number): RoomInput {
  return {
    id: `room-${Date.now()}-${index}`,
    name: `Room ${index + 1}`,
    lengthFt: 12,
    widthFt: 10,
    ceilingHeightFt: 9,
    exteriorWalls: 1,
    wallRValue: 13,
    wallGrade: 'above',
    belowGradeDepthFt: 0,
    windowSqFt: 15,
    windowCount: 1,
    windowUValue: 0.30,
    windowSHGC: 0.25,
    glassType: 'double_low_e',
    interiorShading: 0.7,
    ceilingRValue: 38,
    floorRValue: 19,
    floorType: 'crawlspace',
    exposureDirection: 'S',
    occupantCount: 2,
  };
}

/** Default design conditions */
export function createDefaultConditions(): DesignConditions {
  return {
    outdoorHeatingTemp: 5,
    outdoorCoolingTemp: 95,
    indoorHeatingTemp: 70,
    indoorCoolingTemp: 75,
    outdoorGrains: 105,     // ~50% RH at 95°F
    indoorGrains: 55,       // ~50% RH at 75°F
    latitude: 40,
    elevation: 500,
    coolingDailyRange: 'medium',
    ductLocation: 'attic',
    ductInsulationR: 6,
    ductLeakagePercent: 4,
    ductLengthFt: 80,
    constructionQuality: 'average',
    numBedrooms: 3,
    totalFloorArea: 1800,
  };
}

/** Glass type presets: [U-value, SHGC] */
export const GLASS_PRESETS: Record<GlassType, { u: number; shgc: number; label: string }> = {
  single_clear:  { u: 1.04, shgc: 0.86, label: 'Single Clear' },
  double_clear:  { u: 0.49, shgc: 0.56, label: 'Double Clear' },
  double_low_e:  { u: 0.30, shgc: 0.25, label: 'Double Low-E' },
  triple_low_e:  { u: 0.18, shgc: 0.22, label: 'Triple Low-E' },
};

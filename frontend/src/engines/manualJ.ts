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

import { calculateAed, extractGlassGroups } from './aed';

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export type FloorType = 'slab' | 'crawlspace' | 'basement' | 'over_conditioned';
export type SlabInsulation = 'uninsulated' | 'r5_vertical_24' | 'r5_vertical_48' | 'r10_vertical_24' | 'r10_vertical_48' | 'r15_vertical_48' | 'r10_full';
export type SoilCondition = 'heavy_moist' | 'heavy_dry' | 'light_wet' | 'light_dry';
export type Exposure = 'N' | 'S' | 'E' | 'W' | 'NE' | 'NW' | 'SE' | 'SW';
export type GlassType = 'single_clear' | 'double_clear' | 'double_low_e' | 'triple_low_e';
export type DuctLocation = 'conditioned' | 'attic' | 'crawlspace' | 'garage' | 'basement_uncond';
export type WallGradeType = 'above' | 'below_full' | 'below_partial';
export type WallConstructionGroup = 'I' | 'J' | 'K' | 'L';
export type Construction = 'tight' | 'average' | 'leaky';
export type InfiltrationMethod = 'default' | 'blower_door';
export type DailyRange = 'low' | 'medium' | 'high';

export type RoomType =
  | 'bedroom' | 'bathroom' | 'kitchen' | 'living' | 'dining'
  | 'office' | 'laundry' | 'utility' | 'garage' | 'fitness'
  | 'media' | 'library' | 'hallway' | 'custom';

export type OccupantActivity = 'sleeping' | 'seated' | 'light_work' | 'moderate_exercise' | 'heavy_exercise';
export type LightingType = 'led' | 'fluorescent' | 'incandescent' | 'mixed';

export interface ApplianceEntry {
  type: string;
  label: string;
  sensibleBtu: number;
  latentBtu: number;
  count: number;
}

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
  wallGroup?: WallConstructionGroup; // Manual J cooling group (I=2x4 R-13, J=2x6 R-19, K=masonry, L=heavy masonry)
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

  // Slab-on-grade fields (used when floorType = 'slab')
  perimeterFt?: number;           // exposed perimeter in linear feet
  slabInsulation?: SlabInsulation; // edge insulation configuration
  soilCondition?: SoilCondition;   // soil type (affects F-factor)

  // Orientation
  exposureDirection: Exposure;

  // Room classification
  roomType?: RoomType;

  // Occupancy
  occupantCount: number;
  occupantActivity?: OccupantActivity;

  // Appliances (per-room, toggle-based)
  appliances?: ApplianceEntry[];

  // Lighting
  lightingType?: LightingType;

  // Miscellaneous internal loads (the "anything goes" field)
  miscSensibleBtu?: number;
  miscLatentBtu?: number;
  miscDescription?: string;

  // Floor metadata (populated when linked to CAD)
  floorName?: string;
  floorId?: string;
  cadRoomId?: string;
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

  // Infiltration method (default = ACH table, blower_door = LBL method)
  infiltrationMethod?: InfiltrationMethod;
  blowerDoorCFM50?: number;    // measured CFM at 50 Pa (from blower door test)
  stories?: number;            // number of stories (1-3, for LBL N-factor)
  windShielding?: 'exposed' | 'normal' | 'shielded'; // for LBL N-factor
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
    internalGain: number;       // total (people + appliance + lighting + misc)
    peopleGain: number;         // sensible only
    peopleLatent: number;
    applianceGain: number;      // sensible only
    applianceLatent: number;
    lightingGain: number;
    miscGain: number;           // sensible only
    miscLatent: number;
    ductLoss: number;
  };
}

export interface AedSummary {
  peakLoad: number;
  averageLoad: number;
  ratio: number;
  excursion: number;
  pass: boolean;
  peakHour: number;
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
  aed: AedSummary;
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
 * ASHRAE Maximum Solar Heat Gain Factors (SHGF) — Manual J Table 3A/3B
 * Peak solar irradiance by direction in BTU/(hr·ft²), clear-sky July 21.
 * Data sourced from ASHRAE Handbook of Fundamentals; 40°N row confirmed from
 * multiple authoritative references; other rows interpolated from confirmed
 * anchor points at 32°N (ASHRAE data converted from W/m²) and physical
 * solar geometry relationships.
 *
 * These are reference glazing values (single clear, SHGC ≈ 0.87).
 * The engine multiplies by the actual window's SHGC in the formula:
 *   Q_solar = Area × SHGC × SHGF × IAC
 *
 * Cross-check sources:
 *   - Triton College (academics.triton.edu): W=216 at 40N ✓
 *   - RVCC textbook (rvcc.pressbooks.pub): W=216-237 at 40N ✓
 *   - NRC Canada CBD-39 (web.mit.edu): E/W≈255 at 45N ✓
 *   - Askfilo (askfilo.com): 32N data in W/m² converted ✓
 *   - Dartmouth SHGF tables (cushman.host.dartmouth.edu) ✓
 *
 * TODO: Cross-validate against Manual J 8th Ed Table 3A/3B when Dan (Burlington)
 * provides the book. Manual J may apply Cooling Load Factors (CLF) that
 * reduce these peak values for residential time-averaging.
 */
const SOLAR_IRRADIANCE_BY_LATITUDE: { lat: number; values: Record<Exposure, number> }[] = [
  { lat: 24, values: { N: 44, NE: 160, E: 222, SE: 141, S:  66, SW: 141, W: 222, NW: 160 } },
  { lat: 28, values: { N: 42, NE: 151, E: 220, SE: 155, S:  78, SW: 155, W: 220, NW: 151 } },
  { lat: 32, values: { N: 40, NE: 143, E: 218, SE: 168, S:  91, SW: 168, W: 218, NW: 143 } },
  { lat: 36, values: { N: 39, NE: 138, E: 217, SE: 179, S: 104, SW: 179, W: 217, NW: 138 } },
  { lat: 40, values: { N: 38, NE: 134, E: 216, SE: 190, S: 117, SW: 190, W: 216, NW: 134 } },
  { lat: 44, values: { N: 37, NE: 127, E: 214, SE: 197, S: 131, SW: 197, W: 214, NW: 127 } },
  { lat: 48, values: { N: 36, NE: 120, E: 212, SE: 203, S: 145, SW: 203, W: 212, NW: 120 } },
];

/**
 * Look up solar irradiance for a given latitude and exposure direction.
 * Interpolates linearly between the two nearest latitude bands.
 * Clamps to 24°N–48°N range (covers continental US + Hawaii to northern border).
 */
function getSolarIrradiance(latitude: number, exposure: Exposure): number {
  const table = SOLAR_IRRADIANCE_BY_LATITUDE;
  const lat = Math.max(table[0].lat, Math.min(table[table.length - 1].lat, latitude));

  // Find bracketing rows
  let lower = table[0];
  let upper = table[table.length - 1];
  for (let i = 0; i < table.length - 1; i++) {
    if (lat >= table[i].lat && lat <= table[i + 1].lat) {
      lower = table[i];
      upper = table[i + 1];
      break;
    }
  }

  if (lower.lat === upper.lat) return lower.values[exposure] ?? 75;

  // Linear interpolation
  const fraction = (lat - lower.lat) / (upper.lat - lower.lat);
  const lowerVal = lower.values[exposure] ?? 75;
  const upperVal = upper.values[exposure] ?? 75;
  return lowerVal + fraction * (upperVal - lowerVal);
}

/** Daily range correction for CLTD (Cooling Load Temperature Difference) */
const DAILY_RANGE_CORRECTION: Record<DailyRange, number> = {
  low:    0,     // coastal / humid climates (DR < 16°F)
  medium: -3,    // moderate climates (DR 16–25°F)
  high:   -5,    // dry/arid climates (DR > 25°F)
};

/**
 * Wall construction group base CLTD values at standard conditions.
 *
 * Manual J 8th Ed assigns construction groups starting from Group I for
 * lightweight residential walls. The CLTD value captures solar absorption,
 * thermal mass, and time-lag effects for opaque surfaces in cooling mode.
 *
 * Base conditions (ASHRAE): indoor=78°F, outdoor mean=85°F, DR=21°F.
 * Manual J adjusts to indoor=75°F (adding 3°F to base CLTD).
 *
 * These base CLTD values are for medium-color exterior, medium daily range.
 * The correction formula adjusts for actual conditions:
 *   CLTD_corrected = CLTD_base + (78 - T_room) + (T_mean_outdoor - 85)
 * where T_mean_outdoor = T_outdoor_design - (daily_range / 2)
 *
 * Group assignments (Manual J Table 4A):
 *   I  = Lightweight frame wall, R-13 cavity (2×4 wood, low thermal mass)
 *   J  = Lightweight frame wall, R-19 cavity (2×6 wood, low thermal mass)
 *   K  = Medium-weight wall (CMU block, moderate thermal mass)
 *   L  = Heavy wall (brick/stone, high thermal mass — most time-lag dampening)
 *
 * Cross-references:
 *   - ASHRAE 1997 Fundamentals Ch.28 CLTD method ✓
 *   - CED Engineering cooling load calculations ✓
 *   - Manual J simplified residential CLTD approach ✓
 *   - Wikipedia CLTD article (background methodology) ✓
 *
 * TODO: Cross-validate against Manual J Table 4B exact values when book available.
 */
const WALL_CLTD_BASE: Record<WallConstructionGroup, number> = {
  I: 22.5,   // Lightweight 2×4 frame — high CLTD (minimal thermal mass, fast response)
  J: 19.0,   // Lightweight 2×6 frame — slightly lower (more insulation dampens peak)
  K: 13.5,   // Medium masonry (8" CMU) — significant thermal mass, moderate time lag
  L: 9.5,    // Heavy masonry (brick/stone) — highest thermal mass, most dampened peak
};

/** Ceiling CLTD base value (residential — attic above, medium color roof) */
const CEILING_CLTD_BASE = 38.0; // Higher than walls due to direct solar exposure on roof

/**
 * Compute corrected CLTD for walls.
 * Applies ASHRAE correction formula adapted for Manual J residential conditions.
 *
 * @param group — wall construction group (I, J, K, L)
 * @param indoorTemp — indoor cooling setpoint (°F)
 * @param outdoorDesignTemp — outdoor cooling design dry-bulb (°F)
 * @param dailyRange — daily temperature range classification
 * @returns corrected CLTD value (°F equivalent)
 */
function getWallCLTD(
  group: WallConstructionGroup,
  indoorTemp: number,
  outdoorDesignTemp: number,
  dailyRange: DailyRange,
): number {
  const baseCLTD = WALL_CLTD_BASE[group] ?? WALL_CLTD_BASE.I;

  // Daily range in °F (estimate from classification for mean outdoor calc)
  const drValues: Record<DailyRange, number> = { low: 12, medium: 20, high: 30 };
  const dr = drValues[dailyRange];

  // Mean outdoor temperature
  const tMeanOutdoor = outdoorDesignTemp - (dr / 2);

  // ASHRAE correction: CLTD_corrected = CLTD_base + (78 - T_room) + (T_mean - 85)
  const corrected = baseCLTD + (78 - indoorTemp) + (tMeanOutdoor - 85);

  return Math.max(0, corrected);
}

/**
 * Compute corrected CLTD for ceilings.
 * Ceilings under attic have higher base CLTD due to direct solar exposure on roof.
 */
function getCeilingCLTD(
  indoorTemp: number,
  outdoorDesignTemp: number,
  dailyRange: DailyRange,
): number {
  const drValues: Record<DailyRange, number> = { low: 12, medium: 20, high: 30 };
  const dr = drValues[dailyRange];
  const tMeanOutdoor = outdoorDesignTemp - (dr / 2);

  const corrected = CEILING_CLTD_BASE + (78 - indoorTemp) + (tMeanOutdoor - 85);
  return Math.max(0, corrected);
}

/**
 * Internal gains per person by activity level (Manual J Table 6 + ASHRAE)
 * Format: [sensible BTU/hr, latent BTU/hr]
 */
const ACTIVITY_GAINS: Record<OccupantActivity, [number, number]> = {
  sleeping:           [200, 150],
  seated:             [230, 190],
  light_work:         [300, 300],
  moderate_exercise:  [500, 500],
  heavy_exercise:     [700, 700],
};

/** Lighting heat gain by type (BTU/hr per sqft) */
const LIGHTING_BTU_PER_SQFT: Record<LightingType, number> = {
  led:           0.5,
  fluorescent:   1.0,
  incandescent:  3.0,
  mixed:         1.5,
};

/**
 * Appliance library — standard residential equipment loads.
 * Values from ACCA Manual J Table 6 and ASHRAE Fundamentals.
 * Format: { label, sensibleBtu, latentBtu }
 */
export const APPLIANCE_LIBRARY: Record<string, { label: string; sensibleBtu: number; latentBtu: number }> = {
  gas_range:         { label: 'Gas Range/Oven',        sensibleBtu: 2200, latentBtu: 1200 },
  electric_range:    { label: 'Electric Range/Oven',   sensibleBtu: 1800, latentBtu: 600 },
  refrigerator:      { label: 'Refrigerator',          sensibleBtu: 400,  latentBtu: 0 },
  dishwasher:        { label: 'Dishwasher',            sensibleBtu: 600,  latentBtu: 400 },
  gas_dryer:         { label: 'Clothes Dryer (Gas)',   sensibleBtu: 3000, latentBtu: 500 },
  electric_dryer:    { label: 'Clothes Dryer (Elec)',  sensibleBtu: 2500, latentBtu: 300 },
  washer:            { label: 'Clothes Washer',        sensibleBtu: 400,  latentBtu: 200 },
  desktop_computer:  { label: 'Desktop Computer',      sensibleBtu: 250,  latentBtu: 0 },
  laptop:            { label: 'Laptop',                sensibleBtu: 100,  latentBtu: 0 },
  large_tv:          { label: 'Large TV/Display',      sensibleBtu: 300,  latentBtu: 0 },
  audio_system:      { label: 'Audio/AV System',       sensibleBtu: 200,  latentBtu: 0 },
  server_rack:       { label: 'Server/Network Rack',   sensibleBtu: 1500, latentBtu: 0 },
  hot_tub:           { label: 'Hot Tub / Spa (Indoor)',sensibleBtu: 2000, latentBtu: 4000 },
  aquarium:          { label: 'Aquarium (Large)',      sensibleBtu: 300,  latentBtu: 200 },
  water_heater_gas:  { label: 'Water Heater (Gas)',    sensibleBtu: 500,  latentBtu: 100 },
  water_heater_elec: { label: 'Water Heater (Elec)',   sensibleBtu: 300,  latentBtu: 0 },
  grow_lights:       { label: 'Grow Lights',           sensibleBtu: 1000, latentBtu: 300 },
  space_heater:      { label: 'Portable Space Heater', sensibleBtu: 3400, latentBtu: 0 },
  dehumidifier:      { label: 'Dehumidifier',          sensibleBtu: 600,  latentBtu: -400 },
};

/**
 * Room type presets — default appliances, occupancy, activity, lighting.
 * Applied when user selects a room type; all values are overridable.
 */
export const ROOM_TYPE_PRESETS: Record<RoomType, {
  occupants: number;
  activity: OccupantActivity;
  appliances: string[];   // keys into APPLIANCE_LIBRARY
  lighting: LightingType;
}> = {
  bedroom:   { occupants: 2, activity: 'sleeping',          appliances: [],                                    lighting: 'led' },
  bathroom:  { occupants: 1, activity: 'seated',            appliances: [],                                    lighting: 'led' },
  kitchen:   { occupants: 2, activity: 'light_work',        appliances: ['gas_range', 'refrigerator', 'dishwasher'], lighting: 'led' },
  living:    { occupants: 3, activity: 'seated',            appliances: ['large_tv'],                          lighting: 'led' },
  dining:    { occupants: 4, activity: 'seated',            appliances: [],                                    lighting: 'led' },
  office:    { occupants: 1, activity: 'seated',            appliances: ['desktop_computer'],                   lighting: 'led' },
  laundry:   { occupants: 1, activity: 'light_work',        appliances: ['washer', 'gas_dryer'],               lighting: 'led' },
  utility:   { occupants: 0, activity: 'seated',            appliances: ['water_heater_gas'],                  lighting: 'fluorescent' },
  garage:    { occupants: 1, activity: 'light_work',        appliances: [],                                    lighting: 'fluorescent' },
  fitness:   { occupants: 2, activity: 'heavy_exercise',    appliances: [],                                    lighting: 'led' },
  media:     { occupants: 4, activity: 'seated',            appliances: ['large_tv', 'audio_system'],          lighting: 'led' },
  library:   { occupants: 2, activity: 'seated',            appliances: ['desktop_computer'],                   lighting: 'led' },
  hallway:   { occupants: 0, activity: 'seated',            appliances: [],                                    lighting: 'led' },
  custom:    { occupants: 2, activity: 'seated',            appliances: [],                                    lighting: 'led' },
};

/**
 * Slab-on-Grade F-Factors — BTU/(hr·ft·°F) per linear foot of exposed perimeter
 * Source: ASHRAE 90.1 Table A6.3.1 (unheated slabs), adopted by IECC.
 * Cross-checked against:
 *   - UpCodes (up.codes/s/f-factors-for-slab-on-grade-floors) ✓
 *   - Energy Code Ace (energycodeace.com/table-4.4.7) ✓
 *   - GreenBuildingAdvisor (Manual J vs ASHRAE discussion) ✓
 *   - EnergyPlus Engineering Reference (F-Factor constructions) ✓
 *
 * Manual J uses soil-adjusted values (heavy_moist=1.358, light_dry=0.989 uninsulated)
 * which are higher than ASHRAE 90.1's generic 0.73. We include both for accuracy.
 *
 * Formula: Q_slab = F × P × ΔT
 *   F = factor from this table
 *   P = exposed perimeter (ft)
 *   ΔT = indoor - outdoor heating design temp
 */
const SLAB_F_FACTORS: Record<SlabInsulation, number> = {
  uninsulated:      0.73,   // ASHRAE 90.1 baseline (no edge insulation)
  r5_vertical_24:   0.58,   // R-5 vertical insulation, 24" depth
  r5_vertical_48:   0.54,   // R-5 vertical, 48" depth
  r10_vertical_24:  0.54,   // R-10 vertical, 24" depth
  r10_vertical_48:  0.48,   // R-10 vertical, 48" depth
  r15_vertical_48:  0.45,   // R-15 vertical, 48" depth
  r10_full:         0.36,   // R-10 fully insulated (under entire slab)
};

/**
 * Soil condition multiplier for slab F-factor (Manual J Table 4A adjustment).
 * Manual J heavy-moist uninsulated = 1.358 vs ASHRAE 0.73, ratio ≈ 1.86.
 * Manual J light-dry uninsulated = 0.989 vs ASHRAE 0.73, ratio ≈ 1.35.
 * These multipliers scale the ASHRAE F-factors to Manual J soil-adjusted values.
 */
const SOIL_CONDITION_MULTIPLIER: Record<SoilCondition, number> = {
  heavy_moist: 1.86,  // 1.358 / 0.73 — saturated clay, high conductivity
  heavy_dry:   1.60,  // interpolated between heavy_moist and light_wet
  light_wet:   1.50,  // interpolated
  light_dry:   1.35,  // 0.989 / 0.73 — sandy, low conductivity
};

/**
 * LBL (Lawrence Berkeley Lab) N-factor for infiltration
 * Used in the blower door method: ACH_natural = ACH50 / N
 * N varies by number of stories and wind shielding class.
 * Source: ASHRAE 136 / Manual J Section 8
 */
const LBL_N_FACTOR: Record<string, Record<number, number>> = {
  exposed:  { 1: 14.5, 2: 16.0, 3: 17.8 },
  normal:   { 1: 17.8, 2: 20.0, 3: 22.2 },
  shielded: { 1: 22.2, 2: 24.5, 3: 27.0 },
};

/**
 * Calculate infiltration CFM using the LBL blower door method.
 * ACH50 = (CFM50 × 60) / volume
 * ACH_natural = ACH50 / N
 * Infiltration CFM = (ACH_natural × volume) / 60
 *
 * Simplified: infiltration CFM = CFM50 / N
 */
function lblInfiltrationCFM(
  cfm50: number,
  stories: number,
  shielding: 'exposed' | 'normal' | 'shielded',
): number {
  const clampedStories = Math.max(1, Math.min(3, Math.round(stories)));
  const n = LBL_N_FACTOR[shielding]?.[clampedStories] ?? 20;
  return cfm50 / n;
}

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
    case 'slab': {
      // Slab-on-grade: Q = F × P × ΔT (ACCA Manual J / ASHRAE perimeter method)
      const insulation = room.slabInsulation ?? 'uninsulated';
      const baseFactor = SLAB_F_FACTORS[insulation] ?? SLAB_F_FACTORS.uninsulated;
      const soilMult = SOIL_CONDITION_MULTIPLIER[room.soilCondition ?? 'heavy_moist'];
      const fFactor = baseFactor * soilMult;

      // Use explicit perimeter if provided; otherwise estimate from room dimensions
      const perimeter = room.perimeterFt ?? (2 * (room.lengthFt + room.widthFt));

      floorLossH = fFactor * perimeter * heatingDT;
      break;
    }
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
  // Supports two methods: default ACH table or LBL blower door (ACCA Manual J Section 8)
  let infiltCFM: number;
  if (conditions.infiltrationMethod === 'blower_door' && conditions.blowerDoorCFM50) {
    // LBL method: CFM_natural = CFM50 / N (adjusted for density)
    infiltCFM = lblInfiltrationCFM(
      conditions.blowerDoorCFM50,
      conditions.stories ?? 1,
      conditions.windShielding ?? 'normal',
    ) * densityCorrection;
  } else {
    // Default table method
    const ach = ACH_BY_CONSTRUCTION[conditions.constructionQuality];
    infiltCFM = (volume * ach) / 60 * densityCorrection;
  }
  const infiltSensibleH = AIR_HEAT_FACTOR * infiltCFM * heatingDT;

  // Room heating subtotal (before duct loss)
  const roomHeatingRaw = wallLossH + windowLossH + ceilingLossH + floorLossH + infiltSensibleH;

  // ── COOLING GAINS ─────────────────────────────────────────────────────

  // CLTD for windows — uses simple daily-range-corrected ΔT (windows have negligible thermal mass)
  const cltdCorrection = DAILY_RANGE_CORRECTION[conditions.coolingDailyRange];
  const windowCoolingDT = Math.max(0, coolingDT + cltdCorrection);

  // CLTD for walls — uses construction-group-specific values accounting for thermal mass & time lag
  const wallGroup = room.wallGroup ?? (room.wallRValue >= 17 ? 'J' : 'I'); // auto-detect: R-19+ = 2x6 (J), else 2x4 (I)
  const wallCLTD = (room.wallGrade === 'above')
    ? getWallCLTD(wallGroup, conditions.indoorCoolingTemp, conditions.outdoorCoolingTemp, conditions.coolingDailyRange)
    : wallCoolingDT; // below-grade walls use ground-temp-based ΔT, not CLTD

  // CLTD for ceilings — highest CLTD due to direct roof solar exposure
  const ceilingCLTD = getCeilingCLTD(conditions.indoorCoolingTemp, conditions.outdoorCoolingTemp, conditions.coolingDailyRange);

  // Wall cooling gain: Q = U × A × CLTD (Manual J HTM method)
  const wallGainC = (netWallArea / wallREffective) * wallCLTD;
  const windowConductionC = (room.windowSqFt * room.windowUValue) * windowCoolingDT;
  const ceilingGainC = (floorArea / room.ceilingRValue) * ceilingCLTD;

  let floorGainC = 0;
  if (room.floorType === 'crawlspace') {
    floorGainC = (floorArea / room.floorRValue) * coolingDT * 0.3;
  }

  // ── SHGC-BASED SOLAR GAIN ────────────────────────────────────────────
  // Q_solar = A_window × SHGC × SHGF(lat, dir) × IAC
  // SHGF is the ASHRAE max solar heat gain factor for reference glazing (SHGC≈0.87).
  // Multiplying by the actual window SHGC effectively converts from reference to real glass.
  const shgf = getSolarIrradiance(conditions.latitude, room.exposureDirection);
  const solarGain = room.windowSqFt * room.windowSHGC * shgf * room.interiorShading;

  // Infiltration — sensible + latent (cooling)
  // Infiltration uses direct air temperature difference (no thermal mass effect)
  const infiltSensibleC = AIR_HEAT_FACTOR * infiltCFM * windowCoolingDT;
  const infiltLatentC = AIR_LATENT_FACTOR * infiltCFM * Math.max(0, deltaGrains);

  // ── INTERNAL GAINS — PEOPLE ────────────────────────────────────────────
  const activity = room.occupantActivity || 'seated';
  const [personSensible, personLatent] = ACTIVITY_GAINS[activity] ?? ACTIVITY_GAINS.seated;
  const peopleSensible = room.occupantCount * personSensible;
  const peopleLatent = room.occupantCount * personLatent;

  // ── INTERNAL GAINS — APPLIANCES ──────────────────────────────────────
  let applianceSensible = 0;
  let applianceLatent = 0;
  if (room.appliances && room.appliances.length > 0) {
    for (const a of room.appliances) {
      applianceSensible += a.sensibleBtu * a.count;
      applianceLatent += a.latentBtu * a.count;
    }
  }

  // ── INTERNAL GAINS — LIGHTING ────────────────────────────────────────
  const lightingType = room.lightingType || 'led';
  const lightingGain = floorArea * (LIGHTING_BTU_PER_SQFT[lightingType] ?? 0.5);

  // ── INTERNAL GAINS — MISCELLANEOUS ───────────────────────────────────
  const miscSensible = room.miscSensibleBtu || 0;
  const miscLatent = room.miscLatentBtu || 0;

  // Total internal gains
  const totalInternalSensible = peopleSensible + applianceSensible + lightingGain + miscSensible;
  const totalInternalLatent = peopleLatent + applianceLatent + miscLatent;

  // Sensible cooling subtotal
  const roomCoolingSensibleRaw =
    wallGainC + windowConductionC + ceilingGainC + floorGainC +
    solarGain + infiltSensibleC + totalInternalSensible;

  // Latent cooling subtotal
  const roomCoolingLatentRaw = infiltLatentC + totalInternalLatent;

  // Preserve full floating-point precision through the pipeline.
  // Rounding is deferred to display/PDF layer only (ACCA validation rule #7).
  return {
    roomId: room.id,
    roomName: room.name,
    heatingBtu: roomHeatingRaw,
    coolingBtuSensible: roomCoolingSensibleRaw,
    coolingBtuLatent: roomCoolingLatentRaw,
    coolingBtuTotal: roomCoolingSensibleRaw + roomCoolingLatentRaw,
    breakdown: {
      wallLoss: wallLossH,
      windowLoss: windowLossH,
      ceilingLoss: ceilingLossH,
      floorLoss: floorLossH,
      infiltrationSensible: infiltSensibleH,
      infiltrationLatent: infiltLatentC,
      ventilationSensible: 0,  // filled in at whole-house level
      ventilationLatent: 0,
      solarGain: solarGain,
      internalGain: totalInternalSensible,
      peopleGain: peopleSensible,
      peopleLatent: peopleLatent,
      applianceGain: applianceSensible,
      applianceLatent: applianceLatent,
      lightingGain: lightingGain,
      miscGain: miscSensible,
      miscLatent: miscLatent,
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

  // 3b. AED check (Manual J Section N) — must run before duct losses
  const glassGroups = extractGlassGroups(rooms);
  const aedResult = calculateAed(glassGroups);

  // If AED fails, add excursion penalty to sensible cooling load
  if (aedResult.excursion > 0) {
    sumCoolingSensible += aedResult.excursion;
  }

  // 4. Duct Loss Multipliers
  const ductMultH = getDuctMultiplier(
    conditions.ductLocation, conditions.ductInsulationR,
    conditions.ductLeakagePercent, 'heating'
  );
  const ductMultC = getDuctMultiplier(
    conditions.ductLocation, conditions.ductInsulationR,
    conditions.ductLeakagePercent, 'cooling'
  );

  // Preserve full precision through duct loss calculations (ACCA rule #7)
  const ductLossHeating = sumHeating * (ductMultH - 1);
  const ductLossCooling = (sumCoolingSensible + sumCoolingLatent) * (ductMultC - 1);

  const totalHeating = sumHeating * ductMultH;
  const totalCoolingSensible = sumCoolingSensible * ductMultC;
  const totalCoolingLatent = sumCoolingLatent * ductMultC;
  const totalCooling = totalCoolingSensible + totalCoolingLatent;

  // 5. Equipment sizing — round to nearest 0.5 ton (display-level rounding, acceptable)
  const recommendedTons = Math.ceil((totalCooling / 12000) * 2) / 2;

  // 6. Sensible Heat Ratio
  const shr = totalCooling > 0 ? totalCoolingSensible / totalCooling : 1;

  return {
    rooms: roomResults,
    totalHeatingBtu: totalHeating,
    totalCoolingSensible,
    totalCoolingLatent,
    totalCoolingBtu: totalCooling,
    ductLossHeating,
    ductLossCooling,
    ventilationCFM: ventCFM,
    ventilationSensible: ventSensibleH,
    ventilationLatent: ventLatentC,
    recommendedTons,
    sensibleHeatRatio: shr,
    aed: {
      peakLoad: aedResult.peakLoad,
      averageLoad: aedResult.averageLoad,
      ratio: aedResult.ratio,
      excursion: aedResult.excursion,
      pass: aedResult.pass,
      peakHour: aedResult.peakHour,
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// UTILITY
// ═══════════════════════════════════════════════════════════════════════════════

export function tonnageFromBtu(btu: number): string {
  return (btu / 12000).toFixed(2);
}

/**
 * Round a value for display purposes only.
 * The engine preserves full floating-point precision (ACCA validation rule #7).
 * Use this in UI components and PDF export — never in the calculation pipeline.
 */
export function roundForDisplay(value: number, decimals: number = 0): number {
  if (decimals === 0) return Math.round(value);
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/** Default room with ACCA-grade inputs */
export function createDefaultRoom(index: number, roomType?: RoomType): RoomInput {
  const preset = ROOM_TYPE_PRESETS[roomType || 'custom'];
  const appliances: ApplianceEntry[] = preset.appliances.map(key => {
    const lib = APPLIANCE_LIBRARY[key];
    return lib
      ? { type: key, label: lib.label, sensibleBtu: lib.sensibleBtu, latentBtu: lib.latentBtu, count: 1 }
      : { type: key, label: key, sensibleBtu: 0, latentBtu: 0, count: 1 };
  });

  return {
    id: `room-${Date.now()}-${index}`,
    name: `Room ${index + 1}`,
    lengthFt: 12,
    widthFt: 10,
    ceilingHeightFt: 9,
    exteriorWalls: 1,
    wallRValue: 13,
    wallGrade: 'above',
    wallGroup: 'I',
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
    roomType: roomType || 'custom',
    occupantCount: preset.occupants,
    occupantActivity: preset.activity,
    appliances,
    lightingType: preset.lighting,
    miscSensibleBtu: 0,
    miscLatentBtu: 0,
    miscDescription: '',
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
    infiltrationMethod: 'default',
    blowerDoorCFM50: undefined,
    stories: 1,
    windShielding: 'normal',
  };
}

/** Glass type presets: [U-value, SHGC] */
export const GLASS_PRESETS: Record<GlassType, { u: number; shgc: number; label: string }> = {
  single_clear:  { u: 1.04, shgc: 0.86, label: 'Single Clear' },
  double_clear:  { u: 0.49, shgc: 0.56, label: 'Double Clear' },
  double_low_e:  { u: 0.30, shgc: 0.25, label: 'Double Low-E' },
  triple_low_e:  { u: 0.18, shgc: 0.22, label: 'Triple Low-E' },
};

/**
 * HVAC DesignPro — Duct Sizing Reference Data & Calculation Module
 *
 * Implements:
 *  1. ASHRAE friction chart data for round ducts
 *  2. Round-to-rectangular equivalent diameter (Huebscher equation)
 *  3. Oval equivalent diameter conversions
 *  4. Max velocity limits by application type
 *  5. Duct roughness factors by material
 *  6. Darcy-Weisbach / Colebrook friction rate calculation
 *  7. Duct sizing functions for round and rectangular ducts
 *
 * DISCLAIMER: This is a design-aid implementation. Professional engineers
 * must verify all outputs before use in permit applications.
 */

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export type DuctShapeType = 'round' | 'rectangular' | 'oval';

export interface DuctDimensions {
  shape: DuctShapeType;
  /** Round duct diameter in inches */
  diameterIn?: number;
  /** Rectangular/oval width in inches */
  widthIn?: number;
  /** Rectangular/oval height in inches */
  heightIn?: number;
}

export interface RectDuctSizeResult {
  widthIn: number;
  heightIn: number;
  equivalentDiameterIn: number;
  aspectRatio: number;
}

export interface FrictionChartEntry {
  cfm: number;
  diameterIn: number;
  velocityFpm: number;
  frictionPer100ft: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════════

/** Standard air density at sea level, 70 degF (lb/ft3) */
const STD_AIR_DENSITY = 0.075;

/** Kinematic viscosity of standard air (ft2/s) */
const STD_KINEMATIC_VISCOSITY = 1.63e-4;

/** Standard duct diameters available (inches) */
export const STANDARD_ROUND_DIAMETERS = [
  4, 5, 6, 7, 8, 9, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32, 34, 36,
] as const;

/** Standard rectangular duct dimensions (inches) — common increments */
export const STANDARD_RECT_DIMENSIONS = [
  4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32, 34, 36, 40, 44, 48,
] as const;

// ═══════════════════════════════════════════════════════════════════════════════
// VELOCITY LIMITS (fpm) BY APPLICATION
// ═══════════════════════════════════════════════════════════════════════════════

export interface VelocityLimits {
  supply: number;
  return: number;
  trunk: number;
  branch: number;
}

export const RESIDENTIAL_VELOCITY_LIMITS: VelocityLimits = {
  supply: 900,
  return: 700,
  trunk: 1100,
  branch: 600,
};

export const COMMERCIAL_VELOCITY_LIMITS: VelocityLimits = {
  supply: 1500,
  return: 1200,
  trunk: 2000,
  branch: 1000,
};

export function getVelocityLimits(
  application: 'residential' | 'commercial'
): VelocityLimits {
  return application === 'residential'
    ? RESIDENTIAL_VELOCITY_LIMITS
    : COMMERCIAL_VELOCITY_LIMITS;
}

// ═══════════════════════════════════════════════════════════════════════════════
// DUCT ROUGHNESS FACTORS (absolute roughness in feet)
// ═══════════════════════════════════════════════════════════════════════════════

export type DuctMaterialType =
  | 'sheet_metal'
  | 'flex_r4'
  | 'flex_r6'
  | 'flex_r8'
  | 'spiral'
  | 'fiberglass_board'
  | 'fabric'
  | 'pvc';

/**
 * Absolute roughness (epsilon) in feet for various duct materials.
 * Sources: ASHRAE Fundamentals, Chapter 21; ACCA Manual D Table 7.
 *
 * Flex duct roughness is approximately 10x that of sheet metal due to
 * corrugated inner liner and compression effects.
 */
export const DUCT_ROUGHNESS: Record<DuctMaterialType, number> = {
  sheet_metal:      0.0003,   // galvanized steel, smooth joints
  flex_r4:          0.003,    // flexible duct R-4.2 (fully extended)
  flex_r6:          0.003,    // flexible duct R-6
  flex_r8:          0.003,    // flexible duct R-8
  spiral:           0.0003,   // spiral galvanized (similar to sheet metal)
  fiberglass_board: 0.003,    // fiberglass duct board (rough interior)
  fabric:           0.01,     // fabric duct (very rough)
  pvc:              0.00003,  // PVC pipe (very smooth)
};

/**
 * Flex duct compression correction factor.
 * Compressed flex duct dramatically increases friction. Per ACCA Manual D,
 * multiply friction rate by this factor based on compression ratio.
 * Fully extended = 1.0, typical install (~4% sag) = 1.45, heavily compressed = 3.0+
 */
export const FLEX_COMPRESSION_FACTORS: Record<string, number> = {
  fully_extended: 1.0,
  slight_sag:    1.22,  // ~2% compression
  typical:       1.45,  // ~4% compression (standard installation)
  moderate:      2.0,   // ~15% compression
  severe:        3.0,   // ~30% compression — unacceptable installation
};

// ═══════════════════════════════════════════════════════════════════════════════
// ASHRAE FRICTION CHART REFERENCE DATA
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Pre-computed friction loss values (inwg per 100 ft) for round galvanized
 * sheet metal ducts at standard air conditions. These serve as lookup/validation
 * data against the Darcy-Weisbach calculation.
 *
 * Source: ASHRAE Fundamentals, Chapter 21, Figure 9 (Friction Chart)
 *
 * Indexed by diameter (inches), then by CFM.
 * Values represent friction loss in inches of water gauge per 100 feet.
 */
export const FRICTION_CHART_DATA: Record<number, { cfm: number; frictionPer100ft: number }[]> = {
  6: [
    { cfm: 30,  frictionPer100ft: 0.015 },
    { cfm: 50,  frictionPer100ft: 0.035 },
    { cfm: 75,  frictionPer100ft: 0.07  },
    { cfm: 100, frictionPer100ft: 0.12  },
    { cfm: 150, frictionPer100ft: 0.24  },
    { cfm: 200, frictionPer100ft: 0.40  },
  ],
  8: [
    { cfm: 50,  frictionPer100ft: 0.008 },
    { cfm: 100, frictionPer100ft: 0.028 },
    { cfm: 150, frictionPer100ft: 0.055 },
    { cfm: 200, frictionPer100ft: 0.09  },
    { cfm: 300, frictionPer100ft: 0.18  },
    { cfm: 400, frictionPer100ft: 0.30  },
  ],
  10: [
    { cfm: 100, frictionPer100ft: 0.010 },
    { cfm: 150, frictionPer100ft: 0.020 },
    { cfm: 200, frictionPer100ft: 0.033 },
    { cfm: 300, frictionPer100ft: 0.065 },
    { cfm: 400, frictionPer100ft: 0.11  },
    { cfm: 500, frictionPer100ft: 0.16  },
    { cfm: 600, frictionPer100ft: 0.22  },
  ],
  12: [
    { cfm: 150, frictionPer100ft: 0.008 },
    { cfm: 200, frictionPer100ft: 0.013 },
    { cfm: 300, frictionPer100ft: 0.025 },
    { cfm: 400, frictionPer100ft: 0.042 },
    { cfm: 500, frictionPer100ft: 0.06  },
    { cfm: 600, frictionPer100ft: 0.08  },
    { cfm: 800, frictionPer100ft: 0.14  },
    { cfm: 1000, frictionPer100ft: 0.20 },
  ],
  14: [
    { cfm: 200, frictionPer100ft: 0.006 },
    { cfm: 300, frictionPer100ft: 0.012 },
    { cfm: 400, frictionPer100ft: 0.019 },
    { cfm: 500, frictionPer100ft: 0.028 },
    { cfm: 600, frictionPer100ft: 0.038 },
    { cfm: 800, frictionPer100ft: 0.063 },
    { cfm: 1000, frictionPer100ft: 0.09 },
    { cfm: 1200, frictionPer100ft: 0.13 },
  ],
  16: [
    { cfm: 300, frictionPer100ft: 0.006 },
    { cfm: 400, frictionPer100ft: 0.010 },
    { cfm: 500, frictionPer100ft: 0.015 },
    { cfm: 600, frictionPer100ft: 0.020 },
    { cfm: 800, frictionPer100ft: 0.033 },
    { cfm: 1000, frictionPer100ft: 0.048 },
    { cfm: 1200, frictionPer100ft: 0.066 },
    { cfm: 1500, frictionPer100ft: 0.10  },
  ],
  18: [
    { cfm: 400, frictionPer100ft: 0.006 },
    { cfm: 500, frictionPer100ft: 0.008 },
    { cfm: 600, frictionPer100ft: 0.011 },
    { cfm: 800, frictionPer100ft: 0.019 },
    { cfm: 1000, frictionPer100ft: 0.028 },
    { cfm: 1200, frictionPer100ft: 0.038 },
    { cfm: 1500, frictionPer100ft: 0.056 },
    { cfm: 2000, frictionPer100ft: 0.095 },
  ],
  20: [
    { cfm: 500,  frictionPer100ft: 0.005 },
    { cfm: 600,  frictionPer100ft: 0.007 },
    { cfm: 800,  frictionPer100ft: 0.012 },
    { cfm: 1000, frictionPer100ft: 0.017 },
    { cfm: 1200, frictionPer100ft: 0.023 },
    { cfm: 1500, frictionPer100ft: 0.034 },
    { cfm: 2000, frictionPer100ft: 0.057 },
    { cfm: 2500, frictionPer100ft: 0.085 },
  ],
  24: [
    { cfm: 800,  frictionPer100ft: 0.005 },
    { cfm: 1000, frictionPer100ft: 0.007 },
    { cfm: 1200, frictionPer100ft: 0.010 },
    { cfm: 1500, frictionPer100ft: 0.015 },
    { cfm: 2000, frictionPer100ft: 0.025 },
    { cfm: 2500, frictionPer100ft: 0.037 },
    { cfm: 3000, frictionPer100ft: 0.050 },
    { cfm: 4000, frictionPer100ft: 0.085 },
  ],
  30: [
    { cfm: 1500, frictionPer100ft: 0.005 },
    { cfm: 2000, frictionPer100ft: 0.008 },
    { cfm: 2500, frictionPer100ft: 0.012 },
    { cfm: 3000, frictionPer100ft: 0.017 },
    { cfm: 4000, frictionPer100ft: 0.028 },
    { cfm: 5000, frictionPer100ft: 0.042 },
    { cfm: 6000, frictionPer100ft: 0.058 },
  ],
  36: [
    { cfm: 2000, frictionPer100ft: 0.003 },
    { cfm: 3000, frictionPer100ft: 0.006 },
    { cfm: 4000, frictionPer100ft: 0.010 },
    { cfm: 5000, frictionPer100ft: 0.015 },
    { cfm: 6000, frictionPer100ft: 0.021 },
    { cfm: 8000, frictionPer100ft: 0.035 },
    { cfm: 10000, frictionPer100ft: 0.052 },
  ],
};

// ═══════════════════════════════════════════════════════════════════════════════
// CORE CALCULATION FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Calculate duct cross-sectional area based on shape and dimensions.
 *
 * @param shape - 'round', 'rectangular', or 'oval'
 * @param dims  - Dimensions object with diameterIn (round) or widthIn/heightIn (rect/oval)
 * @returns Area in square inches
 */
export function ductArea(shape: DuctShapeType, dims: DuctDimensions): number {
  switch (shape) {
    case 'round': {
      const d = dims.diameterIn ?? 0;
      return Math.PI * (d / 2) ** 2;
    }
    case 'rectangular': {
      const w = dims.widthIn ?? 0;
      const h = dims.heightIn ?? 0;
      return w * h;
    }
    case 'oval': {
      // Oval approximation: major axis = width, minor axis = height
      // Area = pi/4 * a * b + (a - b) * b  for flat oval
      // More precisely for flat oval: A = pi * (b/2)^2 + (a - b) * b
      // where a = major axis (width), b = minor axis (height)
      const a = dims.widthIn ?? 0;
      const b = dims.heightIn ?? 0;
      if (a <= b) {
        // If width <= height, it's basically a circle or standard oval
        return (Math.PI / 4) * a * b;
      }
      // Flat oval: two semicircles of diameter b, plus rectangle (a-b) x b
      return Math.PI * (b / 2) ** 2 + (a - b) * b;
    }
    default:
      return 0;
  }
}

/**
 * Calculate air velocity through a duct.
 *
 * @param cfm    - Airflow in cubic feet per minute
 * @param areaIn2 - Duct cross-sectional area in square inches
 * @returns Velocity in feet per minute (fpm)
 */
export function ductVelocity(cfm: number, areaIn2: number): number {
  if (areaIn2 <= 0) return 0;
  const areaFt2 = areaIn2 / 144; // convert in2 to ft2
  return cfm / areaFt2;
}

/**
 * Rectangular-to-round equivalent diameter using the Huebscher equation.
 *
 * De = 1.30 * (a * b)^0.625 / (a + b)^0.25
 *
 * This gives the diameter of a round duct with the same friction and
 * airflow as the rectangular duct.
 *
 * @param widthIn  - Rectangular duct width in inches
 * @param heightIn - Rectangular duct height in inches
 * @returns Equivalent round duct diameter in inches
 */
export function rectEquivalentDiameter(widthIn: number, heightIn: number): number {
  if (widthIn <= 0 || heightIn <= 0) return 0;
  return 1.30 * Math.pow(widthIn * heightIn, 0.625) / Math.pow(widthIn + heightIn, 0.25);
}

/**
 * Oval-to-round equivalent diameter.
 *
 * For flat oval ducts, the equivalent diameter is calculated from the
 * cross-sectional area and perimeter:
 *   De = 1.55 * A^0.625 / P^0.25
 * where A = cross-sectional area, P = perimeter.
 *
 * @param majorIn - Major axis (width) in inches
 * @param minorIn - Minor axis (height) in inches
 * @returns Equivalent round duct diameter in inches
 */
export function ovalEquivalentDiameter(majorIn: number, minorIn: number): number {
  if (majorIn <= 0 || minorIn <= 0) return 0;

  // Flat oval: two semicircles of diameter = minor + rectangle
  let area: number;
  let perimeter: number;

  if (majorIn <= minorIn) {
    // Essentially a circle-ish shape
    area = (Math.PI / 4) * majorIn * minorIn;
    perimeter = Math.PI * (majorIn + minorIn) / 2; // approximation
  } else {
    // Flat oval geometry
    const r = minorIn / 2;
    area = Math.PI * r * r + (majorIn - minorIn) * minorIn;
    perimeter = Math.PI * minorIn + 2 * (majorIn - minorIn);
  }

  // ASHRAE equivalent diameter from area and perimeter
  return 1.55 * Math.pow(area, 0.625) / Math.pow(perimeter, 0.25);
}

/**
 * Calculate friction factor using the Colebrook-White equation (iterative).
 *
 * The Colebrook equation:
 *   1/sqrt(f) = -2 * log10( (epsilon/D)/3.7 + 2.51/(Re*sqrt(f)) )
 *
 * We use the Swamee-Jain approximation for the initial guess, then
 * iterate with the full Colebrook equation for accuracy.
 *
 * @param reynoldsNumber - Reynolds number (dimensionless)
 * @param roughness      - Absolute roughness epsilon (ft)
 * @param diameterFt     - Duct internal diameter (ft)
 * @returns Darcy friction factor (dimensionless)
 */
function colebrookFrictionFactor(
  reynoldsNumber: number,
  roughness: number,
  diameterFt: number
): number {
  if (reynoldsNumber <= 0 || diameterFt <= 0) return 0;

  const relativeRoughness = roughness / diameterFt;

  // For laminar flow (Re < 2300), use Hagen-Poiseuille
  if (reynoldsNumber < 2300) {
    return 64 / reynoldsNumber;
  }

  // Swamee-Jain approximation for initial guess
  const A = relativeRoughness / 3.7;
  const B = 2.51 / reynoldsNumber;
  let f = 0.25 / Math.pow(Math.log10(A + B / Math.sqrt(0.02)), 2);

  // Iterate Colebrook equation (typically converges in 3-5 iterations)
  for (let i = 0; i < 20; i++) {
    const sqrtF = Math.sqrt(f);
    const lhs = 1 / sqrtF;
    const rhs = -2 * Math.log10(A + B / sqrtF);
    const fNew = 1 / (rhs * rhs);

    if (Math.abs(fNew - f) < 1e-8) {
      f = fNew;
      break;
    }
    f = fNew;
  }

  return f;
}

/**
 * Calculate friction rate (pressure loss per 100 ft) for a round duct
 * using the Darcy-Weisbach equation.
 *
 * Darcy-Weisbach:
 *   delta_P = f * (L/D) * (rho * V^2 / 2)
 *
 * Converted to inches of water gauge per 100 ft of duct:
 *   frictionRate = f * (100/D) * (rho * V^2 / 2) * (12 / 5.192)
 *
 * The 5.192 factor converts lbf/ft2 to inches water gauge.
 *
 * @param cfm        - Airflow in cubic feet per minute
 * @param diameterIn - Internal duct diameter in inches
 * @param roughness  - Absolute roughness in feet (default: sheet metal 0.0003)
 * @returns Friction rate in inches of water gauge per 100 feet of duct
 */
export function frictionRate(
  cfm: number,
  diameterIn: number,
  roughness: number = DUCT_ROUGHNESS.sheet_metal
): number {
  if (cfm <= 0 || diameterIn <= 0) return 0;

  const diameterFt = diameterIn / 12;
  const areaFt2 = Math.PI * (diameterFt / 2) ** 2;
  const velocityFps = (cfm / 60) / areaFt2; // ft/s

  // Reynolds number = V * D / nu
  const Re = (velocityFps * diameterFt) / STD_KINEMATIC_VISCOSITY;

  // Darcy friction factor
  const f = colebrookFrictionFactor(Re, roughness, diameterFt);

  // Pressure drop per foot of duct (lbf/ft2)
  // delta_P/L = f/D * rho * V^2 / (2 * g_c)
  // Using consistent units: rho in slugs/ft3 = 0.075/32.174 = 0.002331
  // Or directly: delta_P (lbf/ft2) = f * (1/D) * (rho * V^2 / 2)
  // where rho = 0.075 lbm/ft3, need to divide by g_c = 32.174 lbm*ft/(lbf*s2)
  const densitySlugs = STD_AIR_DENSITY / 32.174;
  const pressureDropPerFt = f * (1 / diameterFt) * densitySlugs * velocityFps ** 2 / 2;

  // Convert lbf/ft2 to inches water gauge: 1 inwg = 5.192 lbf/ft2
  const pressureDropInwgPerFt = pressureDropPerFt / 5.192;

  // Return per 100 feet
  return pressureDropInwgPerFt * 100;
}

/**
 * Size a round duct to meet a maximum friction rate constraint.
 *
 * Iterates through standard round duct diameters to find the smallest
 * diameter that keeps friction at or below the target rate.
 *
 * @param cfm              - Required airflow in CFM
 * @param maxFrictionRate  - Maximum allowable friction rate (inwg/100ft)
 * @param roughness        - Duct material roughness in feet
 * @returns Duct diameter in inches (from standard sizes), or -1 if no standard size works
 */
export function roundDuctDiameter(
  cfm: number,
  maxFrictionRate: number,
  roughness: number = DUCT_ROUGHNESS.sheet_metal
): number {
  if (cfm <= 0 || maxFrictionRate <= 0) return -1;

  for (const d of STANDARD_ROUND_DIAMETERS) {
    const fr = frictionRate(cfm, d, roughness);
    if (fr <= maxFrictionRate) {
      return d;
    }
  }

  // No standard size is large enough
  return -1;
}

/**
 * Size a rectangular duct to meet friction rate and aspect ratio constraints.
 *
 * First determines the required equivalent round diameter, then finds the
 * best rectangular combination (from standard dimensions) that meets the
 * equivalent diameter requirement while respecting the max aspect ratio.
 *
 * @param cfm              - Required airflow in CFM
 * @param maxFrictionRate  - Maximum allowable friction rate (inwg/100ft)
 * @param maxAspectRatio   - Maximum width:height ratio (e.g., 4 for 4:1)
 * @param roughness        - Duct material roughness in feet
 * @returns Best rectangular duct size, or null if no valid size found
 */
export function rectDuctSize(
  cfm: number,
  maxFrictionRate: number,
  maxAspectRatio: number = 4,
  roughness: number = DUCT_ROUGHNESS.sheet_metal
): RectDuctSizeResult | null {
  if (cfm <= 0 || maxFrictionRate <= 0) return null;

  // Find the minimum equivalent round diameter needed
  const targetDiameter = roundDuctDiameter(cfm, maxFrictionRate, roughness);
  if (targetDiameter < 0) return null;

  // Search for the best rectangular combination
  let bestResult: RectDuctSizeResult | null = null;
  let bestArea = Infinity;

  for (const w of STANDARD_RECT_DIMENSIONS) {
    for (const h of STANDARD_RECT_DIMENSIONS) {
      if (h > w) continue; // normalize: width >= height

      // Check aspect ratio
      const aspect = w / h;
      if (aspect > maxAspectRatio) continue;

      // Calculate equivalent diameter
      const De = rectEquivalentDiameter(w, h);

      // Must meet or exceed the target equivalent diameter
      if (De >= targetDiameter) {
        const area = w * h;
        // Prefer the combination with smallest cross-sectional area
        // (closest fit without being oversized)
        if (area < bestArea) {
          bestArea = area;
          bestResult = {
            widthIn: w,
            heightIn: h,
            equivalentDiameterIn: Math.round(De * 100) / 100,
            aspectRatio: Math.round(aspect * 100) / 100,
          };
        }
      }
    }
  }

  return bestResult;
}

// ═══════════════════════════════════════════════════════════════════════════════
// UTILITY FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Get the roughness factor for a given duct material type.
 */
export function getRoughness(material: DuctMaterialType): number {
  return DUCT_ROUGHNESS[material] ?? DUCT_ROUGHNESS.sheet_metal;
}

/**
 * Check if a velocity exceeds the recommended limit for a given application
 * and duct type (supply/return/trunk).
 */
export function isVelocityExceeded(
  velocityFpm: number,
  application: 'residential' | 'commercial',
  ductType: 'supply' | 'return' | 'trunk' | 'branch'
): boolean {
  const limits = getVelocityLimits(application);
  return velocityFpm > limits[ductType];
}

/**
 * Interpolate friction chart data for a given CFM and diameter.
 * Returns the friction rate from the reference chart data.
 * Useful for validating Darcy-Weisbach calculations.
 */
export function interpolateFrictionChart(
  cfm: number,
  diameterIn: number
): number | null {
  const entries = FRICTION_CHART_DATA[diameterIn];
  if (!entries || entries.length === 0) return null;

  // Below lowest CFM
  if (cfm <= entries[0].cfm) {
    return entries[0].frictionPer100ft;
  }

  // Above highest CFM
  if (cfm >= entries[entries.length - 1].cfm) {
    return entries[entries.length - 1].frictionPer100ft;
  }

  // Linear interpolation between two data points
  for (let i = 0; i < entries.length - 1; i++) {
    if (cfm >= entries[i].cfm && cfm <= entries[i + 1].cfm) {
      const t = (cfm - entries[i].cfm) / (entries[i + 1].cfm - entries[i].cfm);
      return entries[i].frictionPer100ft +
        t * (entries[i + 1].frictionPer100ft - entries[i].frictionPer100ft);
    }
  }

  return null;
}

/**
 * Calculate the pressure drop for a given duct run.
 *
 * @param cfm               - Airflow in CFM
 * @param diameterIn        - Duct diameter (or equivalent diameter) in inches
 * @param totalEquivLengthFt - Total equivalent length including fittings
 * @param roughness         - Material roughness in feet
 * @returns Pressure drop in inches of water gauge
 */
export function ductPressureDrop(
  cfm: number,
  diameterIn: number,
  totalEquivLengthFt: number,
  roughness: number = DUCT_ROUGHNESS.sheet_metal
): number {
  const fr = frictionRate(cfm, diameterIn, roughness);
  return (fr * totalEquivLengthFt) / 100;
}

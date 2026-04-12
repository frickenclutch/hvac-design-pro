/**
 * HVAC DesignPro — ACCA Manual D Duct Design Calculation Engine
 *
 * Implements the ACCA Manual D residential and light-commercial duct
 * design methodology:
 *
 *  1. Available static pressure calculation
 *  2. Total equivalent length (TEL) for each duct run
 *  3. Design friction rate based on longest (critical) run
 *  4. Duct sizing at the design friction rate
 *  5. Velocity limit verification
 *  6. System balance analysis and warnings
 *
 * Reference:
 *  - ACCA Manual D, 3rd Edition (2014)
 *  - ASHRAE Fundamentals, Chapter 21
 *  - ACCA Table 7 / ASHRAE Fitting Loss Coefficients
 *
 * DISCLAIMER: This is a design-aid implementation. Professional engineers
 * must verify all outputs before use in permit applications.
 */

import {
  frictionRate,
  roundDuctDiameter,
  rectDuctSize,
  rectEquivalentDiameter,
  ductVelocity,
  ductArea,
  ductPressureDrop,
  getRoughness,
  getVelocityLimits,
  type DuctMaterialType,
  type DuctShapeType,
} from './ductSizing';

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export type DuctShape = 'round' | 'rectangular' | 'oval';

export type DuctMaterial =
  | 'sheet_metal'
  | 'flex_r4'
  | 'flex_r6'
  | 'flex_r8'
  | 'spiral'
  | 'fiberglass_board'
  | 'fabric'
  | 'pvc';

export type FittingType =
  | 'elbow_90'
  | 'elbow_45'
  | 'elbow_radius'
  | 'tee_branch'
  | 'tee_straight'
  | 'wye'
  | 'reducer'
  | 'transition_rect_round'
  | 'end_cap'
  | 'register_boot'
  | 'return_boot'
  | 'takeoff_round'
  | 'takeoff_rect'
  | 'damper_manual'
  | 'damper_motorized'
  | 'splitter'
  | 'turning_vanes';

export interface ManualDSystemInput {
  systemName: string;
  equipmentCfm: number;
  /** External static pressure from equipment specs (inwg) */
  blowerEspInwg: number;
  /** Filter pressure drop — typically 0.1 to 0.2 inwg */
  filterDropInwg: number;
  /** Coil pressure drop — typically 0.15 to 0.25 inwg */
  coilDropInwg: number;
  ductMaterial: DuctMaterial;
  preferredShape: DuctShape;
  /** Maximum width:height ratio — typically 4:1 for residential */
  maxAspectRatio: number;
  application: 'residential' | 'commercial';
  rooms: ManualDRoomInput[];
}

export interface ManualDRoomInput {
  roomId: string;
  roomName: string;
  requiredCfm: number;
  /** Override system default duct material for this run */
  ductMaterial?: DuctMaterial;
  /** Straight duct run length in feet */
  actualLengthFt: number;
  /** Fittings in the duct run */
  fittings: { type: FittingType; qty: number }[];
}

export interface ManualDRunResult {
  roomId: string;
  roomName: string;
  requiredCfm: number;
  ductShape: DuctShape;
  /** Round duct diameter (if round) */
  diameterIn?: number;
  /** Rectangular width (if rectangular) */
  widthIn?: number;
  /** Rectangular height (if rectangular) */
  heightIn?: number;
  /** Equivalent round diameter for friction calculations */
  equivalentDiameterIn: number;
  /** Actual straight-line duct length */
  actualLengthFt: number;
  /** Total equivalent length including fittings */
  totalEquivLengthFt: number;
  /** Air velocity in the duct */
  velocityFpm: number;
  /** Friction rate at design conditions */
  frictionRateInwg100: number;
  /** Total pressure drop for this run */
  pressureDropInwg: number;
  /** Whether this run is the critical (longest) path */
  isCriticalPath: boolean;
  /** Warnings for this run */
  warnings: string[];
}

export interface ManualDResult {
  systemName: string;
  /** Available static pressure for duct design */
  availableSpInwg: number;
  /** Design friction rate (inwg per 100 ft) */
  designFrictionRate: number;
  /** Total system airflow */
  totalSystemCfm: number;
  /** Individual duct run results */
  runs: ManualDRunResult[];
  /** Critical path total equivalent length */
  criticalPathLength: number;
  /** Critical path total pressure drop */
  criticalPathPressureDrop: number;
  /** Balancing notes and recommendations */
  balancingNotes: string[];
  /** Whether the system is reasonably balanced */
  isBalanced: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════════
// FITTING EQUIVALENT LENGTHS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Fitting equivalent lengths in feet of straight duct.
 *
 * These values represent the equivalent length of straight duct that
 * produces the same pressure loss as the fitting. Values are derived
 * from ACCA Manual D Table 7 and ASHRAE fitting loss coefficient data.
 *
 * Equivalent lengths vary by duct diameter. This table provides values
 * for three size ranges (small/medium/large) to cover typical residential
 * and light-commercial applications.
 *
 * Size ranges:
 *   small:  4" - 8"  (branch runs)
 *   medium: 9" - 16" (typical residential)
 *   large:  17" - 36" (trunk lines, commercial)
 */
export interface FittingEquivLengthEntry {
  /** Equivalent length for 4"-8" ducts (ft) */
  small: number;
  /** Equivalent length for 9"-16" ducts (ft) */
  medium: number;
  /** Equivalent length for 17"-36" ducts (ft) */
  large: number;
  /** Description of the fitting */
  description: string;
}

export const FITTING_EQUIV_LENGTHS: Record<FittingType, FittingEquivLengthEntry> = {
  elbow_90: {
    small: 10,
    medium: 15,
    large: 20,
    description: 'Standard 90-degree elbow (no turning vanes)',
  },
  elbow_45: {
    small: 5,
    medium: 8,
    large: 10,
    description: 'Standard 45-degree elbow',
  },
  elbow_radius: {
    small: 5,
    medium: 8,
    large: 10,
    description: '90-degree elbow with radius throat (r/D >= 1.5)',
  },
  tee_branch: {
    small: 25,
    medium: 35,
    large: 50,
    description: 'Tee fitting, branch (turning) flow',
  },
  tee_straight: {
    small: 5,
    medium: 8,
    large: 10,
    description: 'Tee fitting, straight-through flow',
  },
  wye: {
    small: 10,
    medium: 15,
    large: 20,
    description: 'Wye fitting (45-degree branch)',
  },
  reducer: {
    small: 3,
    medium: 5,
    large: 8,
    description: 'Concentric reducer/increaser',
  },
  transition_rect_round: {
    small: 5,
    medium: 8,
    large: 12,
    description: 'Rectangular to round transition',
  },
  end_cap: {
    small: 2,
    medium: 3,
    large: 5,
    description: 'End cap / capped end',
  },
  register_boot: {
    small: 35,
    medium: 45,
    large: 55,
    description: 'Supply register boot (90-degree with damper)',
  },
  return_boot: {
    small: 30,
    medium: 40,
    large: 50,
    description: 'Return air boot / grille connection',
  },
  takeoff_round: {
    small: 10,
    medium: 15,
    large: 20,
    description: 'Round takeoff from trunk (branch tap)',
  },
  takeoff_rect: {
    small: 15,
    medium: 20,
    large: 25,
    description: 'Rectangular takeoff from trunk',
  },
  damper_manual: {
    small: 5,
    medium: 8,
    large: 10,
    description: 'Manual balancing damper (half open)',
  },
  damper_motorized: {
    small: 8,
    medium: 12,
    large: 15,
    description: 'Motorized zone damper (full open)',
  },
  splitter: {
    small: 15,
    medium: 20,
    large: 25,
    description: 'Splitter damper at trunk/branch junction',
  },
  turning_vanes: {
    small: 3,
    medium: 5,
    large: 7,
    description: '90-degree elbow with turning vanes (reduced loss)',
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// FITTING EQUIVALENT LENGTH LOOKUP
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Get the size category for a given duct diameter.
 */
function getSizeCategory(diameterIn: number): 'small' | 'medium' | 'large' {
  if (diameterIn <= 8) return 'small';
  if (diameterIn <= 16) return 'medium';
  return 'large';
}

/**
 * Get the equivalent length for a fitting at a given duct size.
 *
 * Interpolates between size categories for more accurate results
 * at the category boundaries.
 *
 * @param fittingType - Type of fitting
 * @param diameterIn  - Duct equivalent diameter in inches
 * @returns Equivalent length in feet
 */
export function getFittingEquivLength(fittingType: FittingType, diameterIn: number): number {
  const entry = FITTING_EQUIV_LENGTHS[fittingType];
  if (!entry) return 0;

  // Interpolate based on diameter for smoother transitions
  if (diameterIn <= 4) return entry.small;
  if (diameterIn <= 8) {
    // Interpolate between small baseline (4") and small max (8")
    return entry.small;
  }
  if (diameterIn <= 16) {
    // Interpolate small -> medium
    const t = (diameterIn - 8) / (16 - 8);
    return entry.small + t * (entry.medium - entry.small);
  }
  if (diameterIn <= 36) {
    // Interpolate medium -> large
    const t = (diameterIn - 16) / (36 - 16);
    return entry.medium + t * (entry.large - entry.medium);
  }

  return entry.large;
}

/**
 * Calculate the total equivalent length of fittings in a duct run.
 *
 * @param fittings   - Array of fittings with type and quantity
 * @param diameterIn - Duct equivalent diameter in inches
 * @returns Total equivalent length of all fittings in feet
 */
export function totalFittingEquivLength(
  fittings: { type: FittingType; qty: number }[],
  diameterIn: number
): number {
  return fittings.reduce((total, fitting) => {
    const equivLen = getFittingEquivLength(fitting.type, diameterIn);
    return total + equivLen * fitting.qty;
  }, 0);
}

// ═══════════════════════════════════════════════════════════════════════════════
// MANUAL D CALCULATION ENGINE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Calculate the ACCA Manual D duct design for a complete HVAC system.
 *
 * Algorithm overview:
 * 1. Calculate available static pressure: blowerESP - filterDrop - coilDrop
 * 2. Estimate initial duct sizes to determine fitting equivalent lengths
 * 3. Calculate total equivalent length (TEL) for each run
 * 4. Identify the critical path (longest TEL)
 * 5. Set design friction rate = availableSP / (criticalTEL / 100)
 * 6. Re-size all ducts at the design friction rate
 * 7. Check velocity limits and generate warnings
 * 8. Analyze system balance
 *
 * @param input - Complete system input including all room duct runs
 * @returns Full Manual D calculation results
 */
export function calculateManualD(input: ManualDSystemInput): ManualDResult {
  const {
    systemName,
    equipmentCfm,
    blowerEspInwg,
    filterDropInwg,
    coilDropInwg,
    ductMaterial,
    preferredShape,
    maxAspectRatio,
    application,
    rooms,
  } = input;

  const warnings: string[] = [];

  // ── Step 1: Available Static Pressure ──────────────────────────────────
  const availableSpInwg = blowerEspInwg - filterDropInwg - coilDropInwg;

  if (availableSpInwg <= 0) {
    return {
      systemName,
      availableSpInwg,
      designFrictionRate: 0,
      totalSystemCfm: equipmentCfm,
      runs: [],
      criticalPathLength: 0,
      criticalPathPressureDrop: 0,
      balancingNotes: [
        'ERROR: Available static pressure is zero or negative. ' +
        'Filter and coil drops exceed blower ESP. ' +
        'Verify equipment specifications.',
      ],
      isBalanced: false,
    };
  }

  // Check total CFM from rooms vs equipment
  const totalRoomCfm = rooms.reduce((sum, r) => sum + r.requiredCfm, 0);
  if (Math.abs(totalRoomCfm - equipmentCfm) > equipmentCfm * 0.05) {
    warnings.push(
      `Total room CFM (${totalRoomCfm}) differs from equipment CFM (${equipmentCfm}) ` +
      `by more than 5%. Verify room airflow requirements.`
    );
  }

  const velocityLimits = getVelocityLimits(application);

  // ── Step 2: Initial duct sizing estimate (for fitting EL lookup) ───────
  // Use a moderate initial friction rate to get approximate duct sizes
  const initialFrictionRate = 0.08; // inwg/100ft — typical residential starting point
  const defaultRoughness = getRoughness(ductMaterial as DuctMaterialType);

  interface RunIntermediate {
    room: ManualDRoomInput;
    roughness: number;
    initialDiameterIn: number;
    fittingEquivLengthFt: number;
    totalEquivLengthFt: number;
  }

  const intermediateRuns: RunIntermediate[] = rooms.map((room) => {
    const material = (room.ductMaterial ?? ductMaterial) as DuctMaterialType;
    const roughness = getRoughness(material);

    // Initial diameter estimate
    let initialDiameterIn = roundDuctDiameter(room.requiredCfm, initialFrictionRate, roughness);
    if (initialDiameterIn < 0) initialDiameterIn = 6; // minimum fallback

    // Calculate fitting equivalent lengths at this diameter
    const fittingEL = totalFittingEquivLength(room.fittings, initialDiameterIn);

    // Total equivalent length
    const tel = room.actualLengthFt + fittingEL;

    return {
      room,
      roughness,
      initialDiameterIn,
      fittingEquivLengthFt: fittingEL,
      totalEquivLengthFt: tel,
    };
  });

  // ── Step 3: Find critical path (longest TEL) ──────────────────────────
  let criticalPathIndex = 0;
  let criticalPathTEL = 0;

  intermediateRuns.forEach((run, index) => {
    if (run.totalEquivLengthFt > criticalPathTEL) {
      criticalPathTEL = run.totalEquivLengthFt;
      criticalPathIndex = index;
    }
  });

  // ── Step 4: Design friction rate ───────────────────────────────────────
  // FR = availableSP / (criticalPathTEL / 100)
  let designFrictionRate = criticalPathTEL > 0
    ? availableSpInwg / (criticalPathTEL / 100)
    : initialFrictionRate;

  // Clamp to reasonable range
  const MIN_FRICTION_RATE = 0.01;  // inwg/100ft — too low = oversized ducts
  const MAX_FRICTION_RATE = 0.25;  // inwg/100ft — too high = noisy, high velocity

  if (designFrictionRate < MIN_FRICTION_RATE) {
    designFrictionRate = MIN_FRICTION_RATE;
    warnings.push(
      `Design friction rate is very low (${designFrictionRate.toFixed(4)} inwg/100ft). ` +
      `This may result in oversized ducts. Consider reducing available static pressure ` +
      `or increasing duct run lengths.`
    );
  }

  if (designFrictionRate > MAX_FRICTION_RATE) {
    warnings.push(
      `Design friction rate exceeds ${MAX_FRICTION_RATE} inwg/100ft ` +
      `(${designFrictionRate.toFixed(4)}). Ducts may generate excessive noise. ` +
      `Consider increasing blower ESP or reducing duct run lengths.`
    );
    designFrictionRate = MAX_FRICTION_RATE;
  }

  // ── Step 5: Size each duct run at the design friction rate ─────────────
  // Iterate sizing twice: once to get better diameters, then recalculate TEL
  // with accurate fitting ELs at the actual size, then re-derive friction rate.

  const finalRuns: ManualDRunResult[] = intermediateRuns.map((inter, index) => {
    const { room, roughness } = inter;
    const runWarnings: string[] = [];

    // Size the duct
    let diameterIn: number | undefined;
    let widthIn: number | undefined;
    let heightIn: number | undefined;
    let equivalentDiameterIn: number;

    if (preferredShape === 'round') {
      diameterIn = roundDuctDiameter(room.requiredCfm, designFrictionRate, roughness);
      if (diameterIn < 0) {
        diameterIn = 36; // max standard size
        runWarnings.push('Required duct diameter exceeds standard sizes (36"). Consider splitting the run.');
      }
      equivalentDiameterIn = diameterIn;
    } else {
      // Rectangular
      const rectResult = rectDuctSize(room.requiredCfm, designFrictionRate, maxAspectRatio, roughness);
      if (rectResult) {
        widthIn = rectResult.widthIn;
        heightIn = rectResult.heightIn;
        equivalentDiameterIn = rectResult.equivalentDiameterIn;

        if (rectResult.aspectRatio > 3) {
          runWarnings.push(
            `Aspect ratio ${rectResult.aspectRatio}:1 is high. ` +
            `Consider using a wider but shorter duct to reduce noise.`
          );
        }
      } else {
        // Fallback to round
        diameterIn = roundDuctDiameter(room.requiredCfm, designFrictionRate, roughness);
        if (diameterIn < 0) diameterIn = 36;
        equivalentDiameterIn = diameterIn;
        runWarnings.push('Could not find a rectangular size meeting constraints. Sized as round.');
      }
    }

    // Recalculate fitting equivalent lengths at the actual size
    const fittingEL = totalFittingEquivLength(room.fittings, equivalentDiameterIn);
    const totalEquivLengthFt = room.actualLengthFt + fittingEL;

    // Calculate velocity
    let areaIn2: number;
    if (diameterIn !== undefined && widthIn === undefined) {
      areaIn2 = ductArea('round', { shape: 'round', diameterIn });
    } else if (widthIn !== undefined && heightIn !== undefined) {
      areaIn2 = ductArea('rectangular', { shape: 'rectangular', widthIn, heightIn });
    } else {
      areaIn2 = ductArea('round', { shape: 'round', diameterIn: equivalentDiameterIn });
    }
    const velocityFpm = ductVelocity(room.requiredCfm, areaIn2);

    // Check velocity limits
    if (velocityFpm > velocityLimits.supply) {
      runWarnings.push(
        `Velocity ${Math.round(velocityFpm)} fpm exceeds ${application} supply limit ` +
        `of ${velocityLimits.supply} fpm. Increase duct size to reduce noise.`
      );
    }

    // Calculate actual friction rate and pressure drop
    const actualFrictionRate = frictionRate(room.requiredCfm, equivalentDiameterIn, roughness);
    const pressureDropInwg = (actualFrictionRate * totalEquivLengthFt) / 100;

    // Minimum size warnings
    if (equivalentDiameterIn < 5 && room.requiredCfm > 30) {
      runWarnings.push('Duct diameter is very small. Verify CFM requirement and run length.');
    }

    const isCriticalPath = index === criticalPathIndex;

    const result: ManualDRunResult = {
      roomId: room.roomId,
      roomName: room.roomName,
      requiredCfm: room.requiredCfm,
      ductShape: diameterIn !== undefined && widthIn === undefined
        ? 'round'
        : (preferredShape as DuctShape),
      actualLengthFt: room.actualLengthFt,
      totalEquivLengthFt: Math.round(totalEquivLengthFt * 10) / 10,
      equivalentDiameterIn: Math.round(equivalentDiameterIn * 100) / 100,
      velocityFpm: Math.round(velocityFpm),
      frictionRateInwg100: Math.round(actualFrictionRate * 10000) / 10000,
      pressureDropInwg: Math.round(pressureDropInwg * 10000) / 10000,
      isCriticalPath,
      warnings: runWarnings,
    };

    if (diameterIn !== undefined && widthIn === undefined) {
      result.diameterIn = diameterIn;
    }
    if (widthIn !== undefined) {
      result.widthIn = widthIn;
      result.heightIn = heightIn;
    }

    return result;
  });

  // ── Step 6: Recalculate critical path with final sizes ─────────────────
  let finalCriticalIndex = 0;
  let finalCriticalTEL = 0;

  finalRuns.forEach((run, index) => {
    if (run.totalEquivLengthFt > finalCriticalTEL) {
      finalCriticalTEL = run.totalEquivLengthFt;
      finalCriticalIndex = index;
    }
  });

  // Update critical path flags
  finalRuns.forEach((run, index) => {
    (run as ManualDRunResult).isCriticalPath = index === finalCriticalIndex;
  });

  const criticalRun = finalRuns[finalCriticalIndex];
  const criticalPathPressureDrop = criticalRun?.pressureDropInwg ?? 0;

  // ── Step 7: Balancing analysis ─────────────────────────────────────────
  const balancingNotes: string[] = [];

  if (criticalPathPressureDrop > availableSpInwg * 1.1) {
    balancingNotes.push(
      `Critical path pressure drop (${criticalPathPressureDrop.toFixed(3)} inwg) ` +
      `exceeds available static pressure (${availableSpInwg.toFixed(3)} inwg). ` +
      `System may be underperforming. Consider increasing blower ESP or ` +
      `reducing duct run lengths.`
    );
  }

  // Check for runs that are much shorter than the critical path
  // These will get more airflow than designed without balancing dampers
  const criticalTEL = finalCriticalTEL;
  let maxImbalance = 0;

  finalRuns.forEach((run) => {
    if (run.isCriticalPath) return;

    const telRatio = run.totalEquivLengthFt / criticalTEL;
    const imbalance = 1 - telRatio;

    if (imbalance > maxImbalance) {
      maxImbalance = imbalance;
    }

    if (telRatio < 0.4) {
      balancingNotes.push(
        `${run.roomName}: TEL is only ${Math.round(telRatio * 100)}% of critical path. ` +
        `This run will receive significantly more airflow than designed. ` +
        `Install a balancing damper to restrict flow.`
      );
    } else if (telRatio < 0.6) {
      balancingNotes.push(
        `${run.roomName}: TEL is ${Math.round(telRatio * 100)}% of critical path. ` +
        `Consider a balancing damper for this run.`
      );
    }
  });

  // Check for excessive pressure drop on non-critical runs
  finalRuns.forEach((run) => {
    if (run.pressureDropInwg > availableSpInwg) {
      balancingNotes.push(
        `${run.roomName}: Pressure drop (${run.pressureDropInwg.toFixed(3)} inwg) ` +
        `exceeds available SP. This run may be starved for airflow.`
      );
    }
  });

  // Overall balance assessment
  // System is considered balanced if the worst-case TEL ratio is > 0.5
  const isBalanced = maxImbalance < 0.5 &&
    criticalPathPressureDrop <= availableSpInwg * 1.1 &&
    finalRuns.every(run => run.warnings.length === 0 ||
      run.warnings.every(w => !w.includes('exceeds')));

  if (isBalanced) {
    balancingNotes.push('System appears reasonably balanced. Verify with field testing after installation.');
  } else {
    balancingNotes.push(
      'System requires balancing dampers or duct resizing to achieve proper airflow distribution.'
    );
  }

  // Add general warnings
  warnings.forEach(w => balancingNotes.unshift(w));

  return {
    systemName,
    availableSpInwg: Math.round(availableSpInwg * 1000) / 1000,
    designFrictionRate: Math.round(designFrictionRate * 10000) / 10000,
    totalSystemCfm: equipmentCfm,
    runs: finalRuns,
    criticalPathLength: Math.round(finalCriticalTEL * 10) / 10,
    criticalPathPressureDrop: Math.round(criticalPathPressureDrop * 10000) / 10000,
    balancingNotes,
    isBalanced,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// UTILITY FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Calculate total equivalent length for a single duct run.
 * Useful for UI display before running full Manual D calculation.
 */
export function calculateRunTEL(
  actualLengthFt: number,
  fittings: { type: FittingType; qty: number }[],
  estimatedDiameterIn: number = 8
): number {
  const fittingEL = totalFittingEquivLength(fittings, estimatedDiameterIn);
  return actualLengthFt + fittingEL;
}

/**
 * Estimate the design friction rate for a system without running
 * the full calculation. Useful for quick checks.
 */
export function estimateDesignFrictionRate(
  blowerEspInwg: number,
  filterDropInwg: number,
  coilDropInwg: number,
  longestRunTelFt: number
): number {
  const availableSP = blowerEspInwg - filterDropInwg - coilDropInwg;
  if (availableSP <= 0 || longestRunTelFt <= 0) return 0;
  return availableSP / (longestRunTelFt / 100);
}

/**
 * Get a human-readable duct size description.
 */
export function formatDuctSize(run: ManualDRunResult): string {
  if (run.ductShape === 'round' && run.diameterIn !== undefined) {
    return `${run.diameterIn}" round`;
  }
  if (run.widthIn !== undefined && run.heightIn !== undefined) {
    return `${run.widthIn}" x ${run.heightIn}" rect`;
  }
  return `${run.equivalentDiameterIn}" equiv`;
}

/**
 * Default fittings for a typical residential branch run.
 * Useful as a starting template in the UI.
 */
export function defaultBranchFittings(): { type: FittingType; qty: number }[] {
  return [
    { type: 'takeoff_round', qty: 1 },
    { type: 'elbow_90', qty: 1 },
    { type: 'register_boot', qty: 1 },
  ];
}

/**
 * Default fittings for a typical residential trunk run.
 */
export function defaultTrunkFittings(): { type: FittingType; qty: number }[] {
  return [
    { type: 'elbow_90', qty: 2 },
    { type: 'tee_branch', qty: 1 },
    { type: 'reducer', qty: 1 },
  ];
}

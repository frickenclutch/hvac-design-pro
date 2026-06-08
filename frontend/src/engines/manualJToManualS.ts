/**
 * HVAC DesignPro — Manual J to Manual S Bridge
 *
 * Converts Manual J whole-house results into Manual S design loads, and offers
 * neutral starting-point equipment suggestions so the calculator isn't empty on
 * first import. The user then replaces the suggestions with the actual candidate
 * equipment's expanded-performance data.
 *
 * The bridge is a pure function — no side effects, no I/O.
 *
 * DISCLAIMER: Equipment suggestions are starting estimates only (≈ design load,
 * NOT worst-case). Real selections must come from OEM expanded-performance data.
 */

import type { WholeHouseResult, DesignConditions } from './manualJ';
import type {
  ManualSDesignLoads,
  CoolingEquipmentInput,
  CoolingSystemType,
  HeatingEquipmentInput,
  HeatingSystemType,
} from './manualS';

// ── Context defaults (display only — NOT load assumptions) ───────────────────
const DEFAULT_OUTDOOR_COOLING_F = 95;
const DEFAULT_OUTDOOR_HEATING_F = 0;
const DEFAULT_INDOOR_COOLING_F = 75;

/**
 * Map a Manual J whole-house result (plus the design conditions used to produce
 * it) into Manual S design loads. All four loads come straight off
 * `WholeHouseResult`; the temperatures/elevation come from `DesignConditions`.
 *
 * @param mj         - Manual J result from calculateWholeHouse()
 * @param conditions - the design conditions used for that calculation (optional)
 */
export function manualJToManualS(
  mj: WholeHouseResult,
  conditions?: Partial<DesignConditions>,
): ManualSDesignLoads {
  return {
    totalCoolingBtu: mj.totalCoolingBtu,
    sensibleCoolingBtu: mj.totalCoolingSensible,
    latentCoolingBtu: mj.totalCoolingLatent,
    heatingBtu: mj.totalHeatingBtu,
    outdoorCoolingTempF: conditions?.outdoorCoolingTemp ?? DEFAULT_OUTDOOR_COOLING_F,
    outdoorHeatingTempF: conditions?.outdoorHeatingTemp ?? DEFAULT_OUTDOOR_HEATING_F,
    indoorCoolingTempF: conditions?.indoorCoolingTemp ?? DEFAULT_INDOOR_COOLING_F,
    elevationFt: conditions?.elevation ?? 0,
  };
}

/**
 * Neutral starting-point cooling equipment: ≈ 105% of the design loads, rounded
 * to a typical catalog increment. This is a deliberately mild starting size (not
 * worst-case, per ACCA §3 rule 4) that the user overrides with real specs.
 */
export function suggestCoolingEquipment(
  loads: ManualSDesignLoads,
  systemType: CoolingSystemType = 'ac',
): CoolingEquipmentInput {
  const roundTo = (n: number, step: number) => Math.round(n / step) * step;
  return {
    systemType,
    totalCoolingCapacityBtu: roundTo(loads.totalCoolingBtu * 1.05, 500),
    sensibleCoolingCapacityBtu: roundTo(loads.sensibleCoolingBtu * 1.05, 500),
    applyAltitudeCorrection: false,
  };
}

/**
 * Neutral starting-point heating equipment: ≈ 110% of the design heating load,
 * rounded to a typical catalog increment.
 */
export function suggestHeatingEquipment(
  loads: ManualSDesignLoads,
  heatingType: HeatingSystemType = 'furnace_gas',
): HeatingEquipmentInput {
  const cap = Math.round((loads.heatingBtu * 1.1) / 1000) * 1000;
  if (heatingType === 'none') {
    return { heatingType, heatingCapacityBtu: 0 };
  }
  return { heatingType, heatingCapacityBtu: cap };
}

/** Compact summary for the "pulled from Manual J" UI banner. */
export interface ManualSLoadSummary {
  totalCoolingBtu: number;
  sensibleCoolingBtu: number;
  latentCoolingBtu: number;
  heatingBtu: number;
  recommendedTons: number;
  loadShr: number;
}

export function getManualSSummary(mj: WholeHouseResult): ManualSLoadSummary {
  const loadShr = mj.totalCoolingBtu > 0
    ? Math.round((mj.totalCoolingSensible / mj.totalCoolingBtu) * 1000) / 1000
    : 0;
  return {
    totalCoolingBtu: Math.round(mj.totalCoolingBtu),
    sensibleCoolingBtu: Math.round(mj.totalCoolingSensible),
    latentCoolingBtu: Math.round(mj.totalCoolingLatent),
    heatingBtu: Math.round(mj.totalHeatingBtu),
    recommendedTons: mj.recommendedTons,
    loadShr,
  };
}

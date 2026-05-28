/**
 * Manual J 8th Edition — Worksheet H (Ventilation Loads)
 * ========================================================
 * Source: ACCA Manual J 8th Edition v2.50, Worksheet H (page 122, ...)
 *
 * Two ventilation paths:
 *   1) Plain outdoor air (no heat recovery) — straight VCFM × design ΔT
 *   2) HRV/ERV with heat recovery — modified Leaving Air Temp (LAT)
 *
 * HRV math (Worksheet H Note 4):
 *   LAT_loss = winter_T_o + SER_loss × HTD     (HRV pre-warms incoming air)
 *   LAT_gain = summer_T_o − SER_gain × CTD     (HRV pre-cools incoming air)
 *   V-Grains = ΔGrains × (1 − LER)             (LER=0 for sensible-only HRV)
 *
 *   Heat = 1.1 × ACF × VCFM × (T_i − LAT_loss)
 *   Sens = 1.1 × ACF × VCFM × (LAT_gain − T_i)
 *   Lat  = 0.68 × ACF × VCFM × V-Grains
 *
 * Plain ventilation (no HRV):
 *   Heat = 1.1 × ACF × VCFM × HTD
 *   Sens = 1.1 × ACF × VCFM × CTD
 *   Lat  = 0.68 × ACF × VCFM × ΔGrains
 *
 * Validated against Smith (HRV at 0.65/0.59, LATloss=43.4 ✓) and
 * Walker (plain VDH, no recovery).
 */

import type {
  DesignConditions, VentilationInput, VentilationResult,
} from '../types';

/** Compute leaving-air-temperature loss with HRV pre-warming. */
export function hrvLATloss(toWinter: number, serLoss: number, htd: number): number {
  return toWinter + serLoss * htd;
}

/** Compute leaving-air-temperature gain with HRV pre-cooling. */
export function hrvLATgain(toSummer: number, serGain: number, ctd: number): number {
  return toSummer - serGain * ctd;
}

export function calculateVentilation(
  v: VentilationInput,
  c: DesignConditions,
): VentilationResult {
  let latLoss: number, latGain: number, vGrains: number;
  let heat: number, sens: number;

  if (v.hasHeatRecovery) {
    const serH = v.serHeating ?? 0;
    const serC = v.serCooling ?? 0;
    const ler = v.ler ?? 0;
    latLoss = hrvLATloss(c.outdoor99DB, serH, c.HTD);
    latGain = hrvLATgain(c.outdoor1DB, serC, c.CTD);
    vGrains = c.deltaGrains * (1 - ler);
    heat = 1.1 * c.ACF * v.vcfm * (c.indoorHeatDB - latLoss);
    sens = 1.1 * c.ACF * v.vcfm * (latGain - c.indoorCoolDB);
  } else {
    latLoss = c.outdoor99DB;
    latGain = c.outdoor1DB;
    vGrains = c.deltaGrains;
    heat = 1.1 * c.ACF * v.vcfm * c.HTD;
    sens = 1.1 * c.ACF * v.vcfm * c.CTD;
  }

  const lat = 0.68 * c.ACF * v.vcfm * vGrains;

  return {
    latLoss,
    latGain,
    vGrains,
    heatLoad: heat,
    sensLoad: sens,
    latentLoad: lat,
  };
}

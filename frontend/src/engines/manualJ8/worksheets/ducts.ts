/**
 * Manual J 8th Edition — Worksheet G (Duct Runs in Unconditioned Space)
 * =======================================================================
 * Source: ACCA Manual J 8th Edition v2.50, Worksheet G (page 121, 134, 141)
 *
 * Duct loads add to Form J1 Line 15 as effective load factors applied to
 * the Line 14 envelope subtotal. The factor pipeline:
 *
 *   1) Base case factors from Table 7 (selected by duct location, R-value,
 *      and leakage rating; interpolation between bins permitted).
 *   2) R-Value correction (WIF) — multiplier based on duct insulation R.
 *   3) Leakage Rate Correction (LCF) — multiplier per leakage class.
 *   4) Surface Area Adjustment (SAA) — fraction of duct surface area in
 *      unconditioned space (for the Sect 23-18 short-cut, this equals the
 *      "percent in unconditioned" value).
 *
 *   EHLF = base_heat × WIF_heat × LCF_heat × SAA
 *   ESGF = base_sens × WIF_sens × LCF_sens × SAA
 *   ELG  = base_latent × LCF_latent × LGA
 *
 * Special case: radiant heating systems have NO heating ducts, so EHLF = 0
 * regardless of base factor (Walker uses radiant slab). The cooling path
 * (ESGF / ELG) still applies if there's an air handler for sensible cooling.
 *
 * Validated against:
 *   Smith   — closed crawlspace, R-4, 0.35/0.70 leak, 15% SAA → 0.049/0.026
 *   Walker  — vented attic, R-8, 0.12/0.24, 100% SAA, radiant heat → 0/0.066
 *   Cobb    — closed ceiling cavity, R-4, 0.12/0.24, 100% SAA → 0.072/0.108
 */

import type { DuctInput, DuctFactors } from '../types';

export function calculateDuctFactors(d: DuctInput): DuctFactors {
  const adjHeat = d.baseHeatLossFactor * d.wifHeatLoss * d.lcfHeatLoss;
  const adjSens = d.baseSensGainFactor * d.wifSensGain * d.lcfSensGain;
  const adjLat = d.baseLatentGain * d.lcfLatentGain;

  const SAA = d.percentInUnconditioned;
  const LGA = d.percentInUnconditioned;

  return {
    EHLF: d.heatingViaRadiant ? 0 : adjHeat * SAA,
    ESGF: adjSens * SAA,
    ELG: adjLat * LGA,
  };
}

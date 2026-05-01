/**
 * Manual J 8th Edition — Worksheet E (Infiltration Loads)
 * =========================================================
 * Source: ACCA Manual J 8th Edition v2.50, Worksheet E (page 117, 132, 140)
 *
 * Three Step-1 methods for estimating infiltration CFM:
 *   Option 1 — Table 5A ACH (default or track-record values)
 *   Option 2 — Component Leakage Area Method (Table 5C ELA4)
 *   Option 3 — Blower Door Test (measured ELA4)
 *
 * Step 2 — NCFM (Net infiltration CFM) accounting for space pressure:
 *   Neutral pressure  (CFMimb = 0):       NCFM = ICFM
 *   Negative pressure (CFMimb > 0):       NCFM = (ICFM^1.5 + CFMimb^1.5)^0.67
 *   Mitigating positive (imb<0, ICFM > |imb|):
 *                                          NCFM = (ICFM^1.5 − |imb|^1.5)^0.67
 *   Dominating positive (imb<0, ICFM ≤ |imb|):
 *                                          NCFM = 0
 *
 * H&C loads:
 *   Heat   = 1.1 × ACF × NCFM × HTD
 *   Sens   = 1.1 × ACF × NCFM × CTD
 *   Latent = 0.68 × ACF × NCFM × ΔGrains
 *
 * Validated against:
 *   Smith   — blower door, ELA4=62, neutral pressure (NCFM = 139 / 66)
 *   Walker  — track record, dominating positive (NCFM_cool = 0!)
 *   Cobb    — Avg-Tight ACH, neutral (NCFM = 70 / 39 precise)
 */

import type { InfiltrationInput, InfiltrationResult } from '../types';

/** Step 1, Option 1 — ACH-based infiltration CFM. */
export function spaceICFMfromACH(ach: number, agvCuFt: number): number {
  return (ach * agvCuFt) / 60;
}

/** Step 1, Options 2 & 3 — ELA4-based infiltration CFM:
 *  ICFM = ELA4 × (Cs × TD + Cw × V²)^0.5 */
export function spaceICFMfromELA(
  ela4SqIn: number,
  Cs: number,
  td: number,
  Cw: number,
  windMPH: number,
): number {
  return ela4SqIn * Math.sqrt(Cs * Math.abs(td) + Cw * windMPH * windMPH);
}

/** Step 2 — Apply space-pressure correction to get NCFM. */
export function netInfiltrationCFM(icfm: number, cfmImbalance: number): number {
  if (cfmImbalance === 0) return icfm;
  if (cfmImbalance > 0) {
    // Negative pressure (more exhaust than supply) → exfiltration enhances
    return Math.pow(Math.pow(icfm, 1.5) + Math.pow(cfmImbalance, 1.5), 0.67);
  }
  // CFMimb < 0 → positive pressure inside
  const absImb = Math.abs(cfmImbalance);
  if (icfm <= absImb) return 0;                              // Dominating positive
  return Math.pow(Math.pow(icfm, 1.5) - Math.pow(absImb, 1.5), 0.67);
}

export function infiltrationHeatLoad(
  ncfm: number, htd: number, acf: number,
): number {
  return 1.1 * acf * ncfm * htd;
}

export function infiltrationSensLoad(
  ncfm: number, ctd: number, acf: number,
): number {
  return 1.1 * acf * ncfm * ctd;
}

export function infiltrationLatentLoad(
  ncfm: number, deltaGrains: number, acf: number,
): number {
  return 0.68 * acf * ncfm * deltaGrains;
}

/** Compute infiltration loads end-to-end given Worksheet E inputs. */
export function calculateInfiltration(
  input: InfiltrationInput,
  htd: number,
  ctd: number,
  deltaGrains: number,
  acf: number,
): InfiltrationResult {
  let icfmHeating = 0, icfmCooling = 0;

  switch (input.method) {
    case 'table_5A_ACH':
    case 'track_record_ACH': {
      if (input.achHeating === undefined || input.achCooling === undefined) {
        throw new Error('ACH method requires achHeating and achCooling');
      }
      icfmHeating = spaceICFMfromACH(input.achHeating, input.aboveGradeVolume);
      icfmCooling = spaceICFMfromACH(input.achCooling, input.aboveGradeVolume);
      break;
    }
    case 'component_leakage':
    case 'blower_door': {
      if (
        input.ela4SqIn === undefined ||
        input.Cs === undefined ||
        input.Cw === undefined
      ) {
        throw new Error('ELA-based methods require ela4SqIn, Cs, and Cw');
      }
      const wHeat = input.windHeatMPH ?? 15;
      const wCool = input.windCoolMPH ?? 7.5;
      icfmHeating = spaceICFMfromELA(input.ela4SqIn, input.Cs, htd, input.Cw, wHeat);
      icfmCooling = spaceICFMfromELA(input.ela4SqIn, input.Cs, ctd, input.Cw, wCool);
      break;
    }
  }

  // Add fireplace contribution if any
  const fp = input.fireplaceCFM ?? 0;
  icfmHeating += fp;
  icfmCooling += fp;

  const ncfmHeating = netInfiltrationCFM(icfmHeating, input.cfmImbalance);
  const ncfmCooling = netInfiltrationCFM(icfmCooling, input.cfmImbalance);

  return {
    icfmHeating,
    icfmCooling,
    ncfmHeating,
    ncfmCooling,
    heatLoad: infiltrationHeatLoad(ncfmHeating, htd, acf),
    sensLoad: infiltrationSensLoad(ncfmCooling, ctd, acf),
    latentLoad: infiltrationLatentLoad(ncfmCooling, deltaGrains, acf),
  };
}

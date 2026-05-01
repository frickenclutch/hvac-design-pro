/**
 * Manual J 8th Edition — Worksheet C (Skylights)
 * ================================================
 * Source: ACCA Manual J 8th Edition v2.50, Worksheet C (page 114, 130)
 *
 * Skylights are their own calc pipeline. The U_eff combines panel + curb
 * thermal bridge + light shaft loss. The cooling HTM uses both horizontal
 * and vertical solar contributions weighted by the tilt angle.
 *
 * Validated against Smith (Heat HTM 98.42 ✓ / Cool HTM 100.7 ✓) and
 * Walker (Ueff 0.93 / 0.71 ✓ for R-19 shaft skylights).
 *
 * Formulas:
 *   U_curb     = 1 / (1.625 × 1.25 + 0.17 + 0.68)        — wood 2x4 + sheathing + air films
 *   U_shaft    = 1 / (R_shaft + 0.25 + 0.17 + 0.68)
 *                (rounded to 2 decimals per Manual J convention)
 *   A_panel    = flat_area × (domed ? 1.25 : 1.00)        — dome curvature adjustment
 *   A_curb     = perimeter × (curb_height_in / 12)
 *   A_shaft    = perimeter × shaft_height_ft
 *   AR_curb    = A_curb / A_panel
 *   AR_shaft   = A_shaft / A_panel
 *   U_eff      = U_NFRC + U_curb × AR_curb + U_shaft × AR_shaft
 *   Sol_H      = cos(tilt) × PSF_H × CLF_H
 *   Sol_V      = sin(tilt) × PSF_V × CLF_V
 *   Heat HTM   = U_eff × HTD
 *   Cool HTM   = (Sol_H + Sol_V) × (SHGC / 0.87) × ISC + U_eff × (CTD + 15)
 *
 * Important: U_curb and U_shaft are rounded to 2 decimal places BEFORE
 * being plugged into U_eff (Manual J convention; using full precision
 * compounds into ~1.4% drift).
 */

import type { SkylightInput, SkylightResult } from '../types';

const round2 = (x: number): number => Math.round(x * 100) / 100;

/** Standard wood 2x4 curb U-value: 1 / (1.625 × 1.25 + 0.17 + 0.68) = 0.347 → 0.35. */
export function curbUValue(): number {
  return round2(1 / (1.625 * 1.25 + 0.17 + 0.68));
}

/** Light shaft U-value with R-rated wall insulation. */
export function shaftUValue(rValue: number): number {
  return round2(1 / (rValue + 0.25 + 0.17 + 0.68));
}

/** Panel area for the worksheet — flat area for non-domed, flat × 1.25 for
 *  domed skylights (curvature adjustment per Manual J). */
export function panelArea(s: SkylightInput): number {
  return s.flatArea * (s.domed ? 1.25 : 1.00);
}

export function curbArea(s: SkylightInput): number {
  const perimeter = 2 * (s.curbLength + s.curbWidth);
  return perimeter * (s.curbHeightIn / 12);
}

export function shaftArea(s: SkylightInput): number {
  const perimeter = 2 * (s.curbLength + s.curbWidth);
  return perimeter * s.shaftHeightFt;
}

/** Effective U-value combining NFRC panel + curb thermal bridge + shaft loss. */
export function skylightUeff(s: SkylightInput): number {
  const Apanel = panelArea(s);
  const ARcurb = curbArea(s) / Apanel;
  const ARshaft = shaftArea(s) / Apanel;
  return s.uNFRC + curbUValue() * ARcurb + shaftUValue(s.shaftRValue) * ARshaft;
}

/** Cooling HTM with directional solar and the +15°F skylight CTD adder. */
export function skylightCoolHTM(s: SkylightInput, ueff: number, ctd: number): number {
  const tiltRad = (s.tilt * Math.PI) / 180;
  const solH = Math.cos(tiltRad) * s.psfH * s.clfH;
  const solV = Math.sin(tiltRad) * s.psfV * s.clfV;
  return (solH + solV) * (s.shgc / 0.87) * s.isc + ueff * (ctd + 15);
}

/** Compute heating and cooling HTMs + Btuh loads for one skylight assembly.
 *  Loads are calculated against the FLAT panel area (NFRC-rated), not the
 *  curvature-adjusted Apanel. */
export function calculateSkylight(
  s: SkylightInput,
  htd: number,
  ctd: number,
): SkylightResult {
  const ueff = skylightUeff(s);
  const htmHeating = ueff * htd;
  const htmCooling = skylightCoolHTM(s, ueff, ctd);
  return {
    ueff,
    htmHeating,
    htmCooling,
    heatLoad: htmHeating * s.flatArea,
    sensLoad: htmCooling * s.flatArea,
  };
}

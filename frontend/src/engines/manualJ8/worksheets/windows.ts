/**
 * Manual J 8th Edition — Worksheet B (Windows / Glass Doors)
 * ===========================================================
 * Source: ACCA Manual J 8th Edition v2.50, Worksheet B
 *
 * Computes heating and cooling HTM values for vertical fenestration units.
 * Validated against Smith (8 windows), Walker (7 windows incl. sun screens
 * and overhangs), and Cobb (3 generic-glass units).
 *
 * Formulas:
 *   Heat HTM    = U × HTD
 *   Cool HTM_D  = PSF × CLF_avg × (SHGC / 0.87) × ISC + U × CTD
 *   AHTM_D      = Cool HTM_D × screen_adjustment
 *   AHTM_N      = (PSF_N × CLF_N × (SHGC/0.87) × ISC + U × CTD) × screen
 *   HTM_SS      = (Cool HTM_D − HTM_N) × SC_SS + HTM_N    (sun screen)
 *   HTM_OH      = AHTM_N when overhang fully shades the opening (U=0)
 */

import type { WindowInput, WindowResult } from '../types';

export function windowHeatHTM(w: WindowInput, htd: number): number {
  return w.uValue * htd;
}

export function windowCoolHTM_D(w: WindowInput, ctd: number): number {
  return w.psf * w.clfAvg * (w.shgc / 0.87) * w.isc + w.uValue * ctd;
}

/** North-equivalent Cool HTM (no screen factor applied). */
function windowCoolHTM_N_unscreened(w: WindowInput, ctd: number): number {
  if (w.psfNorth === undefined || w.clfNorth === undefined) {
    throw new Error(
      `Window ${w.id} requires psfNorth and clfNorth for sun screen / overhang calc`,
    );
  }
  return w.psfNorth * w.clfNorth * (w.shgc / 0.87) * w.isc + w.uValue * ctd;
}

export function windowAHTM_D(w: WindowInput, ctd: number): number {
  return windowCoolHTM_D(w, ctd) * w.screenAdjustment;
}

export function windowAHTM_N(w: WindowInput, ctd: number): number {
  return windowCoolHTM_N_unscreened(w, ctd) * w.screenAdjustment;
}

/** Sun screen formula: HTM_SS = (Cool HTM_D − HTM_N) × SC_SS + HTM_N.
 *  The sun screen replaces the insect screen factor in this calc. */
export function windowHTM_SS(w: WindowInput, ctd: number): number {
  if (w.scSS === undefined) {
    throw new Error(`Window ${w.id} marked sunScreen=true but missing scSS`);
  }
  const dUnscreened = windowCoolHTM_D(w, ctd);
  const nUnscreened = windowCoolHTM_N_unscreened(w, ctd);
  return (dUnscreened - nUnscreened) * w.scSS + nUnscreened;
}

/** Overhang fully-shaded path: when the overhang's shade line falls below
 *  the bottom of the opening (unshaded glass height = 0), HTM_OH = AHTM_N. */
export function windowHTM_OH(w: WindowInput, ctd: number): number {
  return windowAHTM_N(w, ctd);
}

/** Compute window HTMs and Btuh loads for one fenestration unit. */
export function calculateWindow(
  w: WindowInput,
  htd: number,
  ctd: number,
): WindowResult {
  const htmHeating = windowHeatHTM(w, htd);
  let htmCooling: number;
  if (w.htmCoolingOverride !== undefined) {
    // Caller has computed HTM_c externally (e.g. via Table 3E-1 partial-
    // shade overhang geometry). Use directly.
    htmCooling = w.htmCoolingOverride;
  } else if (w.sunScreen) {
    htmCooling = windowHTM_SS(w, ctd);
  } else if (w.overhangFullyShaded) {
    htmCooling = windowHTM_OH(w, ctd);
  } else {
    htmCooling = windowAHTM_D(w, ctd);
  }
  return {
    htmHeating,
    htmCooling,
    heatLoad: htmHeating * w.area,
    sensLoad: htmCooling * w.area,
  };
}

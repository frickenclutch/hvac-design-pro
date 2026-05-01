/**
 * Manual J 8th Edition — Worksheet I (Ancillary Loads)
 * ======================================================
 * Source: ACCA Manual J 8th Edition v2.50, Worksheet I (page 122)
 *
 * Two contributions:
 *   1) Winter humidification — moisture added to dry winter air to reach
 *      indoor target grains. Drives Form J1 Line 17.
 *      H-Load = 0.68 × ACF × TCFM × (IDGR − ODGR)
 *      Gallons/day = H-Load / 8,395 (latent heat of vaporization conversion)
 *   2) Blower motor heat — sensible load from the air handler blower.
 *      Default 500 W. Drives Form J1 Line 19.
 *      Sensible Load = 3.413 × Watts
 */

import type { AncillaryInput, AncillaryResult } from '../types';

const DEFAULT_BLOWER_WATTS = 500;

export function humidificationLoad(
  tcfm: number, indoorGrains: number, outdoorGrains: number, acf: number,
): number {
  return 0.68 * acf * tcfm * (indoorGrains - outdoorGrains);
}

/** Sensible heat from blower motor: 3.413 × Watts (or 3.413 × kW × 1000,
 *  or 3,600 × HP per Worksheet I). */
export function blowerHeatLoad(watts: number): number {
  return 3.413 * watts;
}

export function calculateAncillary(
  input: AncillaryInput,
  acf: number,
): AncillaryResult {
  const watts = input.blowerWatts ?? DEFAULT_BLOWER_WATTS;
  const blowerSens = blowerHeatLoad(watts);

  let humid = 0;
  if (
    input.totalCFM !== undefined &&
    input.indoorGrains !== undefined &&
    input.outdoorGrains !== undefined
  ) {
    humid = humidificationLoad(
      input.totalCFM,
      input.indoorGrains,
      input.outdoorGrains,
      acf,
    );
  }

  return { humidificationLoad: humid, blowerSens };
}

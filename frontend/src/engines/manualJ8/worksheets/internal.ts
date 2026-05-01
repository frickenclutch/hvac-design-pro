/**
 * Manual J 8th Edition — Worksheet F (Internal Loads)
 * =====================================================
 * Source: ACCA Manual J 8th Edition v2.50, Worksheet F (page 120, 133)
 *
 * Internal loads = occupants + default scenario + custom appliances + plants.
 * Defaults per Manual J: 230 Btuh sensible + 200 Btuh latent per occupant
 * (active light work). Default scenario 1 = refrigerator + range w/ vented
 * hood = 2,400 Btuh sensible. Scenario 2 = 3,400 Btuh.
 */

import type { InternalLoadsInput, InternalLoadsResult } from '../types';

const DEFAULT_OCCUPANT_SENSIBLE = 230;
const DEFAULT_OCCUPANT_LATENT = 200;

export function calculateInternalLoads(
  input: InternalLoadsInput,
): InternalLoadsResult {
  const sensPerOcc = input.sensiblePerOccupant ?? DEFAULT_OCCUPANT_SENSIBLE;
  const latPerOcc = input.latentPerOccupant ?? DEFAULT_OCCUPANT_LATENT;

  const occupantSens = input.occupants * sensPerOcc;
  const occupantLat = input.occupants * latPerOcc;

  const scenarioSens = input.scenarioSensible ?? 0;

  let customSens = 0, customLat = 0;
  for (const a of input.customAppliances ?? []) {
    customSens += a.sensible;
    customLat += a.latent ?? 0;
  }

  return {
    occupantSens,
    occupantLat,
    scenarioSens,
    customSens,
    customLat,
    totalSens: occupantSens + scenarioSens + customSens,
    totalLat: occupantLat + customLat,
  };
}

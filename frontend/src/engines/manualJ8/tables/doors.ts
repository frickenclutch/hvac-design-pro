/**
 * Manual J 8th Edition v2.50 — Construction 11 (Wood and Metal Doors)
 * ====================================================================
 * Source: ACCA Manual J 8th Edition v2.50, page 345
 *
 * Doors are special: they don't get a Group letter and don't use Table 4B.
 * The CLTD is published directly in Table 4A as a 12-cell matrix per door
 * (CTD bin × Daily Range), exactly 0.5°F lower than Group A walls (lightest
 * mass tier — doors have less mass than even the lightest framed wall).
 *
 * 17 sub-types A through Q with U-values from 0.17 (polyurethane core w/ storm)
 * to 0.60 (fiberglass core, no storm).
 */

import type { ConstructionVariant, CLTDCell, CTDBin } from '../types';

/** Door direct CLTD matrix (Construction 11). Same 12 cells as Group A wall
 *  in Table 4B, all values shifted -0.5°F. */
export const DOOR_DIRECT_CLTD: Partial<Record<CTDBin, CLTDCell>> = {
  10: { L: 25.0, M: 21.0 },
  15: { L: 30.0, M: 26.0, H: 21.0 },
  20: { L: 35.0, M: 31.0, H: 26.0 },
  25: { M: 36.0, H: 31.0 },
  30: { H: 36.0 },
  35: { H: 41.0 },
};

/** Construction 11 — Wood and Metal Doors. Reference area = rough opening. */
export const DOORS: ConstructionVariant[] = [
  // Wood doors
  { id: '11A', description: 'Hollow Core', kind: 'door', referenceArea: 'rough_opening', uValue: 0.47, directCLTD: DOOR_DIRECT_CLTD, sourcePage: 345 },
  { id: '11B', description: 'Hollow Core with Wood Storm', kind: 'door', referenceArea: 'rough_opening', uValue: 0.30, directCLTD: DOOR_DIRECT_CLTD, sourcePage: 345 },
  { id: '11C', description: 'Hollow Core with Metal Storm', kind: 'door', referenceArea: 'rough_opening', uValue: 0.32, directCLTD: DOOR_DIRECT_CLTD, sourcePage: 345 },
  { id: '11D', description: 'Solid Core', kind: 'door', referenceArea: 'rough_opening', uValue: 0.39, directCLTD: DOOR_DIRECT_CLTD, sourcePage: 345 },
  { id: '11E', description: 'Solid Core with Wood Storm', kind: 'door', referenceArea: 'rough_opening', uValue: 0.26, directCLTD: DOOR_DIRECT_CLTD, sourcePage: 345 },
  { id: '11F', description: 'Solid Core with Metal Storm', kind: 'door', referenceArea: 'rough_opening', uValue: 0.28, directCLTD: DOOR_DIRECT_CLTD, sourcePage: 345 },
  { id: '11G', description: 'Panel', kind: 'door', referenceArea: 'rough_opening', uValue: 0.54, directCLTD: DOOR_DIRECT_CLTD, sourcePage: 345 },
  { id: '11H', description: 'Panel with Wood Storm', kind: 'door', referenceArea: 'rough_opening', uValue: 0.32, directCLTD: DOOR_DIRECT_CLTD, sourcePage: 345 },
  { id: '11I', description: 'Panel with Metal Storm', kind: 'door', referenceArea: 'rough_opening', uValue: 0.36, directCLTD: DOOR_DIRECT_CLTD, sourcePage: 345 },
  // Metal doors
  { id: '11J', description: 'Fiberglass Core', kind: 'door', referenceArea: 'rough_opening', uValue: 0.60, directCLTD: DOOR_DIRECT_CLTD, sourcePage: 345 },
  { id: '11K', description: 'Fiberglass Core with Storm', kind: 'door', referenceArea: 'rough_opening', uValue: 0.36, directCLTD: DOOR_DIRECT_CLTD, sourcePage: 345 },
  { id: '11L', description: 'Paper Honeycomb Core', kind: 'door', referenceArea: 'rough_opening', uValue: 0.56, directCLTD: DOOR_DIRECT_CLTD, sourcePage: 345 },
  { id: '11M', description: 'Paper Honeycomb Core with Storm', kind: 'door', referenceArea: 'rough_opening', uValue: 0.34, directCLTD: DOOR_DIRECT_CLTD, sourcePage: 345 },
  { id: '11N', description: 'Polystyrene Core', kind: 'door', referenceArea: 'rough_opening', uValue: 0.35, directCLTD: DOOR_DIRECT_CLTD, sourcePage: 345 },
  { id: '11O', description: 'Polystyrene Core with Storm', kind: 'door', referenceArea: 'rough_opening', uValue: 0.21, directCLTD: DOOR_DIRECT_CLTD, sourcePage: 345 },
  { id: '11P', description: 'Polyurethane Core', kind: 'door', referenceArea: 'rough_opening', uValue: 0.29, directCLTD: DOOR_DIRECT_CLTD, sourcePage: 345 },
  { id: '11Q', description: 'Polyurethane Core with Storm', kind: 'door', referenceArea: 'rough_opening', uValue: 0.17, directCLTD: DOOR_DIRECT_CLTD, sourcePage: 345 },
];

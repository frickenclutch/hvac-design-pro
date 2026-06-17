/**
 * Manual J 8th Edition — CLTD Lookup
 * ===================================
 * Source: ACCA Manual J 8th Edition v2.50, page 383 (Table 4B)
 *
 * Round-UP convention (NOT linear interpolation):
 * When the design CTD doesn't match a Table 4B bin (10/15/20/25/30/35),
 * Manual J rounds UP to the next bin per design conservatism. Validated
 * against Cobb Residence (CTD=18 → uses CTD=20 column, not interpolated 17).
 *
 * Sparse cells: Not every (CTD, DR) combination is populated. Climate-
 * realistic gaps exist (CTD=10 with H, CTD=35 with L). When a needed cell
 * is missing, the lookup falls back to the next available bin in the same
 * DR column, then errors if the row is empty for that DR entirely.
 */

import type { CLTDCell, CTDBin, DailyRange, WallGroup } from './types';
import { TABLE_4B } from './tables/table4B';
import { DOOR_DIRECT_CLTD } from './tables/doors';

const CTD_BINS: CTDBin[] = [10, 15, 20, 25, 30, 35];

/** Generic CTD lookup with round-UP convention. Returns CLTD value for the
 *  smallest bin ≥ requested CTD that has a populated DR cell.
 *
 *  `source` names the reference table for the error message so a thrown
 *  data-gap is attributable to the exact table the reviewer must consult
 *  (Table 4B for walls/partitions, Table 4A for doors, Table 4D for
 *  ceilings). We round CTD up to the nearest bin first, so the message
 *  reports the bin that was actually demanded, not the raw CTD. */
function lookupInMatrix(
  matrix: Partial<Record<CTDBin, CLTDCell>>,
  ctd: number,
  dr: DailyRange,
  source = 'Manual J Table 4B',
): number {
  // Exact bin?
  const exactBin = CTD_BINS.find((b) => b === ctd);
  if (exactBin !== undefined) {
    const cell = matrix[exactBin]?.[dr];
    if (cell !== undefined) return cell;
  }

  // Round UP to next bin with a populated DR cell
  for (const bin of CTD_BINS) {
    if (bin >= ctd) {
      const cell = matrix[bin]?.[dr];
      if (cell !== undefined) return cell;
    }
  }

  // No populated cell. Report the rounded-up bin that was demanded so a
  // reviewer can locate the exact missing (bin, DR) cell in the source
  // table. We deliberately THROW rather than substitute an unverified
  // number — a silently-wrong CLTD on a permit-bound calc is worse than a
  // loud, attributable failure (see __tests__/ceilingCltd.test.ts).
  const demandedBin = CTD_BINS.find((b) => b >= ctd) ?? `>${CTD_BINS[CTD_BINS.length - 1]}`;
  throw new Error(
    `${source}: no populated CLTD cell for CTD bin ${demandedBin} ` +
    `(requested CTD=${ctd}), DR=${dr}. The required cell is not yet ` +
    `captured in the registry — climate is outside the encoded design ` +
    `envelope. Do NOT substitute a value; supply the cell from the ` +
    `source table.`,
  );
}

/** Look up a wall CLTD from Table 4B. Used by Construction 12, 13, 14, 15
 *  above-grade wall above-grade portion. */
export function lookupWallCLTD(
  group: WallGroup,
  ctd: number,
  dr: DailyRange,
): number {
  const groupData = TABLE_4B[group];
  if (!groupData) {
    throw new Error(`Manual J Table 4B: unknown wall group "${group}"`);
  }
  return lookupInMatrix(groupData.wall, ctd, dr);
}

/** Look up a partition CLTD from Table 4B. Used when Construction 12-14
 *  is acting as a partition (between conditioned space and a buffer). */
export function lookupPartitionCLTD(
  group: WallGroup,
  ctd: number,
  dr: DailyRange,
): number {
  const groupData = TABLE_4B[group];
  if (!groupData) {
    throw new Error(`Manual J Table 4B: unknown wall group "${group}"`);
  }
  return lookupInMatrix(groupData.partition, ctd, dr);
}

/** Look up a door direct CLTD from Construction 11 (no Group letter). */
export function lookupDoorCLTD(ctd: number, dr: DailyRange): number {
  return lookupInMatrix(DOOR_DIRECT_CLTD, ctd, dr);
}

/** Look up a direct CLTD from a construction-specific matrix (used by
 *  ceilings under attic — Construction 16/17/18, whose CLTDs come from
 *  Manual J Table 4D, not Table 4B).
 *
 *  `source` lets the caller attribute a data-gap throw to the right table
 *  and element (e.g. `Manual J Table 4D (ceiling "16B-30ad")`). The
 *  ceiling registry currently captures only the CTD=15 cells validated by
 *  the Smith/Walker reference cases; other bins THROW attributably until
 *  the full Table 4D matrix is encoded (see tables/constructions.ts
 *  TABLE-4D-GAP notes and __tests__/ceilingCltd.test.ts). */
export function lookupDirectCLTD(
  matrix: Partial<Record<CTDBin, CLTDCell>>,
  ctd: number,
  dr: DailyRange,
  source = 'Manual J Table 4A/4D (direct CLTD)',
): number {
  return lookupInMatrix(matrix, ctd, dr, source);
}

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
 *  smallest bin ≥ requested CTD that has a populated DR cell. */
function lookupInMatrix(
  matrix: Partial<Record<CTDBin, CLTDCell>>,
  ctd: number,
  dr: DailyRange,
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

  throw new Error(
    `Manual J Table 4B: no populated cell for CTD≥${ctd}, DR=${dr}. ` +
    `Climate may be outside the table's design envelope.`,
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
 *  ceilings under attic — Construction 16). */
export function lookupDirectCLTD(
  matrix: Partial<Record<CTDBin, CLTDCell>>,
  ctd: number,
  dr: DailyRange,
): number {
  return lookupInMatrix(matrix, ctd, dr);
}

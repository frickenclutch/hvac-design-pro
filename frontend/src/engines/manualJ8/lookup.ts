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
 *  (Table 4B for walls/partitions; Table 4A for doors AND ceilings — the
 *  ceiling family CLTD rows are printed directly in Table 4A pp. 362-364,
 *  verified against the physical book 2026-07-15). We round CTD up to the
 *  nearest bin first, so the message reports the bin that was actually
 *  demanded, not the raw CTD. */
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

/**
 * Construction 19 floor PTD lookup — printed-column-first, interpolate
 * only when the ACCA 5% rule demands it.
 *
 * Convention, anchored to the book's own worked Smith example: the Smith
 * Form J1 runs at HTD 76 yet uses the PRINTED 75-column value (6.6, not
 * the interpolated 6.7) — permitted because the deviation (~1.5%) is
 * within Manual J's 5% threshold. Rule 1 MANDATES interpolation only when
 * rounding to a printed cell deviates >5% from the fully interpolated
 * value. So:
 *   · exact column hit → the printed value
 *   · between columns  → the NEAREST printed column's value when it
 *     deviates ≤5% from the linear interpolation (the book's own usage);
 *     otherwise the interpolated value (rule-1 mandate — bites at low TD,
 *     e.g. HTD 22 where the 20-column would deviate ~8%)
 *   · below the lowest printed column → CLAMP to that column's value
 *     (conservative: the true linear value would be lower, so clamping
 *     overstates the load rather than fabricating an unprinted cell)
 *   · above the highest printed column → THROW attributably (outside the
 *     book's design envelope; do not extrapolate)
 */
export function lookupFloorPTD(
  table: Partial<Record<number, number>>,
  td: number,
  source: string,
): number {
  if (!Number.isFinite(td)) {
    throw new Error(
      `${source}: design TD is not a finite number (${td}) — upstream ` +
      `design-condition input is missing or invalid.`,
    );
  }
  const cols = Object.keys(table)
    .map(Number)
    .filter((k) => table[k] !== undefined)
    .sort((a, b) => a - b);
  if (cols.length === 0) {
    throw new Error(`${source}: PTD table is empty — registry data error.`);
  }

  const min = cols[0];
  const max = cols[cols.length - 1];
  if (td <= min) return table[min]!;
  if (td > max) {
    throw new Error(
      `${source}: design TD=${td} exceeds the highest printed column ` +
      `(${max}) in the Table 4A floor PTD row. Climate is outside the ` +
      `encoded design envelope. Do NOT extrapolate; consult the source table.`,
    );
  }

  // Exact hit
  if (table[td] !== undefined) return table[td]!;

  // Bracketing columns (cols is sorted ascending; min < td < max here)
  let lower = min;
  for (const col of cols) {
    if (col < td) lower = col;
    else break;
  }
  const upper = cols[cols.indexOf(lower) + 1];
  const lo = table[lower]!;
  const hi = table[upper]!;
  const interp = lo + ((hi - lo) * (td - lower)) / (upper - lower);

  // Printed-column-first (see header): nearest column wins when within the
  // 5% threshold — this reproduces the ACCA worked examples bit-for-bit.
  const nearestVal = td - lower <= upper - td ? lo : hi;
  if (Math.abs(nearestVal - interp) / interp <= 0.05) return nearestVal;
  return interp;
}

/** Look up a door direct CLTD from Construction 11 (no Group letter).
 *  Doors' CLTD matrix is printed directly in Table 4A p. 345 (source-verified
 *  2026-07-15) — attribute any data-gap throw there, not to the 4B default. */
export function lookupDoorCLTD(ctd: number, dr: DailyRange): number {
  return lookupInMatrix(DOOR_DIRECT_CLTD, ctd, dr, 'Manual J Table 4A (door, Construction 11)');
}

/** Look up a direct CLTD from a construction-specific matrix (used by
 *  ceilings under attic — Construction 16 series, whose family CLTD rows
 *  are printed directly in Manual J Table 4A pp. 362-364, keyed by attic
 *  temperature — NOT in "Table 4D", which is sunroom ambient temps; the
 *  old citation here was corrected 2026-07-15 against the physical book).
 *
 *  `source` lets the caller attribute a data-gap throw to the right table
 *  and element (e.g. `Manual J Table 4A (ceiling "16F-38tw")`). The 16B/
 *  16C/16D family rows are fully encoded; 16E/16F await transcription of
 *  p. 364 and THROW attributably beyond their anchor cells (see tables/
 *  constructions.ts provenance block and __tests__/ceilingCltd.test.ts). */
export function lookupDirectCLTD(
  matrix: Partial<Record<CTDBin, CLTDCell>>,
  ctd: number,
  dr: DailyRange,
  source = 'Manual J Table 4A (direct CLTD)',
): number {
  return lookupInMatrix(matrix, ctd, dr, source);
}

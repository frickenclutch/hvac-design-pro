/**
 * Ceiling CLTD (Construction 16 series) — Table 4A family rows + gap guard
 * =========================================================================
 *
 * Background (defect "K2", closed for 16B/16C/16D on 2026-07-15):
 * Ceilings under attic use a *direct* CLTD published in ACCA Manual J 8th Ed
 * v2.50 **Table 4A** (pp. 362-364) as one CLTD-by-(CTD, DR) row per ceiling
 * FAMILY (16A..16F, keyed by attic temperature), shared by every R-value
 * variant in the family. (The old citation of "Table 4D" was wrong — that
 * table is sunroom ambient temperatures; corrected against the physical
 * book.)
 *
 * The 16B / 16C / 16D family rows below were transcribed from photographs of
 * the physical book (pp. 362-363) on 2026-07-15 and triple-verified:
 *   1. every previously-encoded cert anchor matches its family row exactly
 *      (16B 15/M=50 Smith line 10-a; 16C 15/L=44 and 16D 15/L=34 Walker §13);
 *   2. rows carry the book's arithmetic structure (+5 per CTD bin step,
 *      −10 per attic-temperature tier);
 *   3. the sparse (CTD, DR) layout matches Table 4B's exactly.
 *
 * STILL OPEN: the 16E/16F family rows (p. 364) are not yet transcribed.
 * 16F-38tw carries only its Walker anchor cell — every other cell must
 * FAIL LOUD AND ATTRIBUTABLY rather than emit a silently-wrong,
 * permit-bound number. Section (3) locks that contract in.
 */

import { describe, it, expect } from 'vitest';
import {
  getConstruction,
  lookupDirectCLTD,
  calculateOpaque,
  type ConstructionVariant,
  type OpaqueInput,
} from '../index';

function ceiling(id: string): ConstructionVariant {
  const c = getConstruction(id);
  expect(c, `ceiling ${id} must be in the registry`).toBeDefined();
  return c!;
}

// ── (1) Golden cells — every transcribed value, straight from the book ──────
// Layout per family row: 10:{L,M} 15:{L,M,H} 20:{L,M,H} 25:{M,H} 30:{H} 35:{H}
// Flattened as [10/L, 10/M, 15/L, 15/M, 15/H, 20/L, 20/M, 20/H, 25/M, 25/H,
// 30/H, 35/H] to mirror the printed column order for reviewer scanning.
type Cell = { ctd: 10 | 15 | 20 | 25 | 30 | 35; dr: 'L' | 'M' | 'H'; cltd: number };
const CELL_ORDER: Array<[Cell['ctd'], Cell['dr']]> = [
  [10, 'L'], [10, 'M'], [15, 'L'], [15, 'M'], [15, 'H'], [20, 'L'],
  [20, 'M'], [20, 'H'], [25, 'M'], [25, 'H'], [30, 'H'], [35, 'H'],
];
function row(values: number[]): Cell[] {
  expect(values).toHaveLength(CELL_ORDER.length);
  return values.map((cltd, i) => ({ ctd: CELL_ORDER[i][0], dr: CELL_ORDER[i][1], cltd }));
}

const FAMILY_ROWS: { id: string; page: number; cells: Cell[] }[] = [
  // 16B — vented attic, no RB, dark shingles (attic 130°F). Book p. 362.
  { id: '16B-30ad', page: 362, cells: row([49, 45, 54, 50, 45, 59, 55, 50, 60, 55, 60, 65]) },
  // 16C — vented attic, no RB, white/light shingles (attic 120°F). p. 363.
  { id: '16C-38aw', page: 363, cells: row([39, 35, 44, 40, 35, 49, 45, 40, 50, 45, 50, 55]) },
  // 16D family (16DR = vented + radiant barrier, light shingles; 110°F). p. 363.
  { id: '16DR-38aw', page: 363, cells: row([29, 25, 34, 30, 25, 39, 35, 30, 40, 35, 40, 45]) },
];

describe('Ceiling CLTD — transcribed Table 4A family rows (golden, per book page)', () => {
  for (const { id, page, cells } of FAMILY_ROWS) {
    describe(`${id} (Table 4A p.${page})`, () => {
      for (const { ctd, dr, cltd } of cells) {
        it(`CTD=${ctd}/${dr} → CLTD ${cltd}`, () => {
          const c = ceiling(id);
          expect(c.kind).toBe('ceiling');
          expect(c.directCLTD![ctd]![dr]).toBe(cltd);
          expect(lookupDirectCLTD(c.directCLTD!, ctd, dr)).toBe(cltd);
        });
      }
    });
  }

  it('cert anchors are embedded in their family rows unchanged', () => {
    // The three anchors the ACCA reference cases pinned BEFORE the full rows
    // were transcribed. If the book ever disagrees with these, STOP — the
    // cert filing was validated against them.
    expect(ceiling('16B-30ad').directCLTD![15]!.M).toBe(50);  // Smith line 10-a
    expect(ceiling('16C-38aw').directCLTD![15]!.L).toBe(44);  // Walker §13
    expect(ceiling('16DR-38aw').directCLTD![15]!.L).toBe(34); // Walker §13
    expect(ceiling('16F-38tw').directCLTD![15]!.L).toBe(19);  // Walker line 10-a
  });

  it('CTD ≤ 10 resolves to the printed bin-10 cells (1.2.0 output correction)', () => {
    // Under the 1.1.0 single-cell matrices, a CTD ≤ 10 demand fell through
    // the EMPTY bin 10 into the bin-15 anchor (50/44/34 — sparse-matrix
    // fall-through artifacts, 5 too high). With bin 10 populated from the
    // book, these demands land on the printed values. Locks the corrected
    // behavior so it can never silently regress to the artifact.
    expect(lookupDirectCLTD(ceiling('16B-30ad').directCLTD!, 7, 'M')).toBe(45);
    expect(lookupDirectCLTD(ceiling('16B-30ad').directCLTD!, 10, 'M')).toBe(45);
    expect(lookupDirectCLTD(ceiling('16C-38aw').directCLTD!, 9, 'L')).toBe(39);
    expect(lookupDirectCLTD(ceiling('16DR-38aw').directCLTD!, 10, 'L')).toBe(29);
  });

  it('family rows follow the book arithmetic (+5 per bin step within a row)', () => {
    // Structural cross-check of the transcription: within every family row,
    // stepping one CTD bin at constant DR adds exactly 5 (as printed).
    for (const { id } of FAMILY_ROWS) {
      const m = ceiling(id).directCLTD!;
      expect(m[15]!.L! - m[10]!.L!).toBe(5);
      expect(m[20]!.M! - m[15]!.M!).toBe(5);
      expect(m[25]!.H! - m[20]!.H!).toBe(5);
      expect(m[35]!.H! - m[30]!.H!).toBe(5);
    }
  });
});

// ── (2) End-to-end resolution, incl. the production-failure climates ────────
describe('Ceiling CLTD — end-to-end HTM_c (U × CLTD)', () => {
  it('Smith ceiling at CTD=15/M (cert anchor): HTM_c = 1.60', () => {
    const input: OpaqueInput = { id: '10-a', label: '16B-30ad', constructionId: '16B-30ad', area: 1752 };
    const r = calculateOpaque(input, /*ctd*/ 15, /*htd*/ 23, /*dr*/ 'M');
    expect(r.htmCooling).toBeCloseTo(1.6, 3);
  });

  it('Walker ceiling at CTD=15/L (cert anchor): HTM_c = 0.494', () => {
    const input: OpaqueInput = { id: '10-a', label: '16F-38tw', constructionId: '16F-38tw', area: 1752 };
    const r = calculateOpaque(input, /*ctd*/ 15, /*htd*/ 28, /*dr*/ 'L');
    expect(r.htmCooling).toBeCloseTo(0.494, 3);
  });

  it('PROD FAILURE #1 now resolves: 16B-30ad, CTD=11/H (upstate NY) → bin 15/H = 45', () => {
    // This exact (construction, CTD, DR) demand produced 12+ shadow-run
    // failures in production. CTD=11 rounds UP to bin 15 per Manual J.
    const input: OpaqueInput = { id: '10-a', label: '16B-30ad', constructionId: '16B-30ad', area: 1000 };
    const r = calculateOpaque(input, /*ctd*/ 11, /*htd*/ 70, /*dr*/ 'H');
    expect(r.htmCooling).toBeCloseTo(0.032 * 45, 3);
  });

  it('PROD FAILURE #2 now resolves: 16B-30ad, CTD=20/M → 55', () => {
    const input: OpaqueInput = { id: '10-a', label: '16B-30ad', constructionId: '16B-30ad', area: 1000 };
    const r = calculateOpaque(input, /*ctd*/ 20, /*htd*/ 60, /*dr*/ 'M');
    expect(r.htmCooling).toBeCloseTo(0.032 * 55, 3);
  });
});

// ── (3) Remaining-gap guard — 16E/16F await p. 364; no fabricated values ────
describe('Ceiling CLTD — 16F gap guard (p. 364 not yet transcribed)', () => {
  it('off-DR 16F cell (CTD=15/H) THROWS rather than guessing', () => {
    const c = ceiling('16F-38tw');
    expect(() => lookupDirectCLTD(c.directCLTD!, 15, 'H')).toThrow();
  });

  it('off-bin 16F cell (CTD=25/M) THROWS rather than guessing', () => {
    const c = ceiling('16F-38tw');
    expect(() => lookupDirectCLTD(c.directCLTD!, 25, 'M')).toThrow();
  });

  it('the throw is ATTRIBUTABLE — names Table 4A, the element, and the missing cell', () => {
    const input: OpaqueInput = { id: '10-a', label: '16F-38tw', constructionId: '16F-38tw', area: 1752 };
    let msg = '';
    try {
      calculateOpaque(input, /*ctd*/ 20, /*htd*/ 23, /*dr*/ 'M');
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toMatch(/Table 4A/);
    expect(msg).toMatch(/16F-38tw/);
    expect(msg).toMatch(/bin 20/);
    expect(msg).toMatch(/DR=M/);
  });

  it('throwing yields NO number — a silently-wrong CLTD is the prohibited outcome', () => {
    const c = ceiling('16F-38tw');
    let value: number | undefined;
    let threw = false;
    try {
      value = lookupDirectCLTD(c.directCLTD!, 30, 'M');
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
    expect(value).toBeUndefined();
  });
});

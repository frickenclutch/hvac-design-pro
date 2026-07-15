/**
 * Construction 19 floor PTD tables — Table 4A pp. 371-377 (engine 1.3.0)
 * ======================================================================
 *
 * Background: the book publishes floor PTDH as a row per variant over HTD
 * columns 20..95 (5°F steps) and PTDC over CTD 10..35 (CTD only). Until
 * 1.3.0 the engine pinned floors to FIXED reference-point values (19B-osp:
 * ptdh 6.6 / ptdc 1.3 — book-true ONLY at Smith's Des Moines conditions,
 * HTD 75 / CTD 15) applied in every climate. Floors cannot throw, so the
 * error was silent: cold climates understated floor heating loss.
 *
 * The 19B SEALED/PASSIVE block (R-4 exposed walls) was transcribed from a
 * close-up photograph of the physical book on 2026-07-15 and verified:
 *   1. the Smith cert anchor maps exactly (19B-0sp @ 75 → 6.6, @ CTD 15
 *      → 1.3);
 *   2. every row is linear through the origin (PTD = k × TD, same k both
 *      sides) — the book's printed structure;
 *   3. HTM = U × PTD decreases monotonically with floor R-value.
 *
 * Lookup convention: LINEAR INTERPOLATION between columns (ACCA 5% rule —
 * round-up would deviate >5% at low PTD magnitudes), clamp below the
 * lowest printed column (conservative), THROW above the highest.
 */

import { describe, it, expect } from 'vitest';
import {
  getConstruction,
  lookupFloorPTD,
  calculateOpaque,
  type ConstructionVariant,
  type OpaqueInput,
} from '../index';
import { crawlFloorConstruction } from '../adapters/legacy';

const HTD_COLS = [20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95] as const;
const CTD_COLS = [10, 15, 20, 25, 30, 35] as const;

// Every transcribed cell, straight from the 19B(s) page close-up.
const ROWS: {
  id: string; uValue: number; ptdh: number[]; ptdc: number[];
}[] = [
  { id: '19B-osp',  uValue: 0.368, ptdh: [1.8, 2.2, 2.7, 3.1, 3.5, 4.0, 4.4, 4.9, 5.3, 5.8, 6.2, 6.6, 7.1, 7.5, 8.0, 8.4],                         ptdc: [0.9, 1.3, 1.8, 2.2, 2.7, 3.1] },
  { id: '19B-2sp',  uValue: 0.206, ptdh: [3.0, 3.7, 4.4, 5.2, 5.9, 6.6, 7.4, 8.1, 8.9, 9.6, 10.3, 11.1, 11.8, 12.5, 13.3, 14.0],                    ptdc: [1.5, 2.2, 3.0, 3.7, 4.4, 5.2] },
  { id: '19B-5sp',  uValue: 0.125, ptdh: [4.4, 5.6, 6.7, 7.8, 8.9, 10.0, 11.1, 12.2, 13.3, 14.4, 15.6, 16.7, 17.8, 18.9, 20.0, 21.1],               ptdc: [2.2, 3.3, 4.4, 5.6, 6.7, 7.8] },
  { id: '19B-11sp', uValue: 0.073, ptdh: [6.6, 8.2, 9.8, 11.5, 13.1, 14.7, 16.4, 18.0, 19.7, 21.3, 22.9, 24.6, 26.2, 27.8, 29.5, 31.1],             ptdc: [3.3, 4.9, 6.6, 8.2, 9.8, 11.5] },
  { id: '19B-19sp', uValue: 0.049, ptdh: [8.5, 10.6, 12.7, 14.8, 17.0, 19.1, 21.2, 23.3, 25.4, 27.6, 29.7, 31.8, 33.9, 36.0, 38.2, 40.3],           ptdc: [4.2, 6.4, 8.5, 10.6, 12.7, 14.8] },
  { id: '19B-30sp', uValue: 0.034, ptdh: [10.2, 12.7, 15.3, 17.8, 20.4, 22.9, 25.5, 28.0, 30.6, 33.1, 35.7, 38.2, 40.8, 43.3, 45.9, 48.4],          ptdc: [5.1, 7.6, 10.2, 12.7, 15.3, 17.8] },
  { id: '19B-38sp', uValue: 0.029, ptdh: [11.1, 13.8, 16.6, 19.4, 22.1, 24.9, 27.6, 30.4, 33.2, 35.9, 38.7, 41.5, 44.2, 47.0, 49.8, 52.5],          ptdc: [5.5, 8.3, 11.1, 13.8, 16.6, 19.4] },
];

function floor(id: string): ConstructionVariant {
  const c = getConstruction(id);
  expect(c, `floor ${id} must be in the registry`).toBeDefined();
  return c!;
}

describe('Floor PTD — transcribed 19B sealed/passive rows (golden, per book page)', () => {
  for (const row of ROWS) {
    describe(`${row.id} (U ${row.uValue})`, () => {
      it('U-value matches the printed row', () => {
        expect(floor(row.id).uValue).toBe(row.uValue);
      });
      it('every PTDH column matches the printed cell', () => {
        const c = floor(row.id);
        HTD_COLS.forEach((htd, i) => {
          expect(c.ptdhByHtd![htd], `${row.id} PTDH @ HTD ${htd}`).toBe(row.ptdh[i]);
          expect(lookupFloorPTD(c.ptdhByHtd!, htd, 'test')).toBe(row.ptdh[i]);
        });
      });
      it('every PTDC column matches the printed cell', () => {
        const c = floor(row.id);
        CTD_COLS.forEach((ctd, i) => {
          expect(c.ptdcByCtd![ctd], `${row.id} PTDC @ CTD ${ctd}`).toBe(row.ptdc[i]);
          expect(lookupFloorPTD(c.ptdcByCtd!, ctd, 'test')).toBe(row.ptdc[i]);
        });
      });
    });
  }

  it('rows are linear through the origin (book structure; PTD ≈ k × TD both sides)', () => {
    for (const row of ROWS) {
      const k = row.ptdh[row.ptdh.length - 1] / 95;
      HTD_COLS.forEach((htd, i) => {
        expect(Math.abs(row.ptdh[i] - k * htd), `${row.id} PTDH @ ${htd}`).toBeLessThan(0.16);
      });
      CTD_COLS.forEach((ctd, i) => {
        expect(Math.abs(row.ptdc[i] - k * ctd), `${row.id} PTDC @ ${ctd}`).toBeLessThan(0.16);
      });
    }
  });

  it('HTM = U × PTD decreases monotonically with floor R (physical sanity)', () => {
    const at75 = ROWS.map((r) => r.uValue * r.ptdh[HTD_COLS.indexOf(75)]);
    for (let i = 1; i < at75.length; i++) {
      expect(at75[i], `row ${ROWS[i].id} HTM must be < ${ROWS[i - 1].id}`).toBeLessThan(at75[i - 1]);
    }
  });
});

describe('Floor PTD — Smith cert anchor and climate dependence', () => {
  it('printed columns: 19B-osp @ HTD 75 → 6.6 and @ CTD 15 → 1.3 (exact hits)', () => {
    const c = floor('19B-osp');
    expect(lookupFloorPTD(c.ptdhByHtd!, 75, 'test')).toBe(6.6);
    expect(lookupFloorPTD(c.ptdcByCtd!, 15, 'test')).toBe(1.3);
  });

  it('Smith end-to-end BIT-IDENTICAL at the fixture\'s ACTUAL conditions (HTD 76)', () => {
    // Smith runs at HTD 76 (Des Moines: 70 − (−6)), NOT 75 — and the
    // book's own worked Form J1 uses the printed 75-column value (6.6)
    // there, since the deviation from interpolated (6.7) is ~1.5% ≤ 5%.
    // The printed-column-first convention reproduces that exactly, so the
    // cert line item is unchanged from the fixed-6.6 era.
    const input: OpaqueInput = { id: '11-a', label: 'crawl', constructionId: '19B-osp', area: 736, asPartition: true };
    const r = calculateOpaque(input, /*ctd*/ 15, /*htd*/ 76, /*dr*/ 'M');
    expect(r.htmHeating).toBeCloseTo(0.368 * 6.6, 6);
    expect(r.htmCooling).toBeCloseTo(0.368 * 1.3, 6);
  });

  it('1.3.0 OUTPUT CORRECTION: mild climate (HTD 40) now uses 3.5, not the fixed 6.6', () => {
    const input: OpaqueInput = { id: '11-a', label: 'crawl', constructionId: '19B-osp', area: 736, asPartition: true };
    const r = calculateOpaque(input, /*ctd*/ 15, /*htd*/ 40, /*dr*/ 'M');
    expect(r.htmHeating).toBeCloseTo(0.368 * 3.5, 3);
  });

  it('1.3.0 OUTPUT CORRECTION: cold climate (HTD 85, Burlington-class) now uses 7.5', () => {
    const input: OpaqueInput = { id: '11-a', label: 'crawl', constructionId: '19B-osp', area: 736, asPartition: true };
    const r = calculateOpaque(input, /*ctd*/ 15, /*htd*/ 85, /*dr*/ 'M');
    expect(r.htmHeating).toBeCloseTo(0.368 * 7.5, 3);
  });
});

describe('Floor PTD — printed-column-first convention (ACCA 5% rule)', () => {
  const c = () => floor('19B-osp');

  it('nearest printed column wins when within 5% of interpolated (the book\'s usage)', () => {
    // HTD 76 → nearest column 75 (6.6); interpolated 6.7; dev ~1.5% ≤ 5%.
    // This is the exact case ACCA's worked Smith example demonstrates.
    expect(lookupFloorPTD(c().ptdhByHtd!, 76, 'test')).toBe(6.6);
    // HTD 72 → nearest column 70 (6.2); interpolated 6.36; dev ~2.5% ≤ 5%.
    expect(lookupFloorPTD(c().ptdhByHtd!, 72, 'test')).toBe(6.2);
    // HTD 77 → nearest column 75 (6.6); interpolated 6.8; dev ~2.9% ≤ 5%.
    expect(lookupFloorPTD(c().ptdhByHtd!, 77, 'test')).toBe(6.6);
  });

  it('rule-1 mandate: interpolates when the nearest column deviates >5% (low TD)', () => {
    // HTD 22 → nearest column 20 (1.8); interpolated 1.96; dev ~8.2% > 5%
    // → the 5% rule REQUIRES interpolation here.
    expect(lookupFloorPTD(c().ptdhByHtd!, 22, 'test')).toBeCloseTo(1.96, 6);
    // The boundary pair: HTD 21 → nearest 20 (1.8) deviates only ~4.3%
    // from interpolated 1.88 → printed column is licensed.
    expect(lookupFloorPTD(c().ptdhByHtd!, 21, 'test')).toBe(1.8);
  });

  it('below the lowest printed column → clamps (conservative), never fabricates', () => {
    expect(lookupFloorPTD(c().ptdhByHtd!, 15, 'test')).toBe(1.8);   // column 20
    expect(lookupFloorPTD(c().ptdcByCtd!, 8, 'test')).toBe(0.9);    // column 10
  });

  it('above the highest printed column → THROWS attributably', () => {
    expect(() => lookupFloorPTD(c().ptdhByHtd!, 97, 'Manual J Table 4A (floor "19B-osp" PTDH)'))
      .toThrow(/19B-osp.*exceeds the highest printed column/s);
  });

  it('non-finite TD → THROWS attributably (loud-failure convention)', () => {
    expect(() => lookupFloorPTD(c().ptdhByHtd!, Number.NaN, 'Manual J Table 4A (floor "19B-osp" PTDH)'))
      .toThrow(/not a finite number/);
  });
});

describe('Floor PTD — legacy adapter R-value band mapping', () => {
  // The bands mirror the printed rows; R-values inside NO printed band take
  // the next LOWER band (higher HTM — conservative, never understates).
  const CASES: Array<[number, string]> = [
    [0, '19B-osp'], [1.9, '19B-osp'],
    [2, '19B-2sp'], [4.5, '19B-2sp'],
    [5, '19B-5sp'], [10.9, '19B-5sp'],
    [11, '19B-11sp'], [15, '19B-11sp'], [18.9, '19B-11sp'],
    [19, '19B-19sp'], [21, '19B-19sp'], [29, '19B-19sp'],
    [30, '19B-30sp'], [37, '19B-30sp'],
    [38, '19B-38sp'], [49, '19B-38sp'],
  ];
  it('every band boundary maps to the printed row (or next lower — conservative)', () => {
    for (const [r, expected] of CASES) {
      expect(crawlFloorConstruction(r), `floorRValue ${r}`).toBe(expected);
      expect(getConstruction(expected), `${expected} must exist`).toBeDefined();
    }
  });
});

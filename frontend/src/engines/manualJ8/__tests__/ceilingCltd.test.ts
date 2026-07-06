/**
 * Ceiling CLTD (Construction 16/17/18) — Table 4D coverage + data-gap guard
 * =========================================================================
 *
 * Background (defect "K2"):
 * Ceilings under attic use a *direct* CLTD published in ACCA Manual J 8th Ed
 * v2.50 **Table 4D** (NOT Table 4B, which is walls/partitions). The registry
 * in tables/constructions.ts currently captures only the SINGLE Table 4D cell
 * each ceiling needed for the Smith/Walker ACCA reference cases (both land on
 * CTD bin 15). The full Table 4D matrix (by CTD bin 10/15/20/25/30/35 × DR
 * L/M/H) is not present anywhere in the repo, so a ceiling evaluated in any
 * other climate bin throws.
 *
 * Authorized resolution: the correct ACCA Table 4D values are NOT sourceable
 * from the repo, and may not be fabricated (interpolated, extrapolated from
 * the wall Table 4B, or derived from the legacy getCeilingCLTD() formula).
 * Until the book's Table 4D rows are transcribed, the engine must FAIL LOUD
 * AND ATTRIBUTABLY rather than emit a silently-wrong, permit-bound number.
 *
 * This suite pins:
 *   1. Each captured CTD=15 cell to its cited reference source value.
 *   2. That Smith (CTD=15/M) and Walker (CTD=15/L) ceilings still resolve.
 *   3. That an off-bin / off-DR ceiling THROWS — and that the throw is
 *      attributable (names the element, the table, and the missing cell),
 *      and crucially returns NO number.
 *
 * When Table 4D is encoded, extend section (1) with the new cells and relax
 * section (3) to assert the now-covered bins resolve to their cited values.
 */

import { describe, it, expect } from 'vitest';
import {
  getConstruction,
  lookupDirectCLTD,
  calculateOpaque,
  type ConstructionVariant,
  type OpaqueInput,
} from '../index';

// The four ceiling constructions and the single Table 4D cell each captures.
// (CTD bin, DR, CLTD) — every value traceable to docs/acca-validation-report.md
// / the Smith & Walker §12/§13 reference Form J1 pages.
const CAPTURED: { id: string; ctd: 15; dr: 'L' | 'M'; cltd: number; note: string }[] = [
  { id: '16B-30ad', ctd: 15, dr: 'M', cltd: 50, note: 'Smith line 10-a, Iowa, dark shingle R-30' },
  { id: '16F-38tw', ctd: 15, dr: 'L', cltd: 19, note: 'Walker line 10-a, FL, white tile R-38' },
  { id: '16DR-38aw', ctd: 15, dr: 'L', cltd: 34, note: 'Walker §13 option, white shingle R-38 + RB' },
  { id: '16C-38aw', ctd: 15, dr: 'L', cltd: 44, note: 'Walker §13 option, white shingle R-38 no RB' },
];

function ceiling(id: string): ConstructionVariant {
  const c = getConstruction(id);
  expect(c, `ceiling ${id} must be in the registry`).toBeDefined();
  return c!;
}

describe('Ceiling CLTD — captured Table 4D cells (cited)', () => {
  for (const { id, ctd, dr, cltd, note } of CAPTURED) {
    it(`${id}: CTD=${ctd}/${dr} → CLTD ${cltd} (${note})`, () => {
      const c = ceiling(id);
      expect(c.kind).toBe('ceiling');
      expect(c.directCLTD).toBeDefined();
      expect(c.directCLTD![ctd]![dr]).toBe(cltd);
      // Same value via the lookup primitive the worksheet actually calls.
      expect(lookupDirectCLTD(c.directCLTD!, ctd, dr)).toBe(cltd);
    });
  }

  it('Smith ceiling resolves end-to-end at CTD=15/M (HTM_c = U × CLTD)', () => {
    // U 0.032 × CLTD 50 = 1.60 — matches Smith Form J1 line 10-a.
    const input: OpaqueInput = { id: '10-a', label: '16B-30ad', constructionId: '16B-30ad', area: 1752 };
    const r = calculateOpaque(input, /*ctd*/ 15, /*htd*/ 23, /*dr*/ 'M');
    expect(r.htmCooling).toBeCloseTo(1.6, 3);
  });

  it('Walker ceiling resolves end-to-end at CTD=15/L (HTM_c = U × CLTD)', () => {
    // U 0.026 × CLTD 19 = 0.494 — matches Walker Form J1 line 10-a.
    const input: OpaqueInput = { id: '10-a', label: '16F-38tw', constructionId: '16F-38tw', area: 1752 };
    const r = calculateOpaque(input, /*ctd*/ 15, /*htd*/ 28, /*dr*/ 'L');
    expect(r.htmCooling).toBeCloseTo(0.494, 3);
  });
});

describe('Ceiling CLTD — TABLE-4D-GAP guard (no fabricated values)', () => {
  // Phoenix/Dallas-class CTD (cool1 ~107 / indoor 75 → CTD≈20+) and the
  // common Boston/Dallas DR=M case are the climates the shadow-run corpus is
  // biased away from precisely because they throw today. These tests LOCK IN
  // the loud-failure contract until Table 4D is transcribed.

  it('off-bin ceiling (CTD=25/M, no captured cell) THROWS rather than guessing', () => {
    const c = ceiling('16B-30ad');
    // 16B only has CTD=15/M. CTD=25 rounds up to bin 25 (still unpopulated).
    expect(() => lookupDirectCLTD(c.directCLTD!, 25, 'M')).toThrow();
  });

  it('off-DR ceiling (CTD=15/H, no captured cell) THROWS rather than guessing', () => {
    const c = ceiling('16F-38tw');
    // 16F only has CTD=15/L. High daily range at the same bin is unpopulated.
    expect(() => lookupDirectCLTD(c.directCLTD!, 15, 'H')).toThrow();
  });

  it('the throw is ATTRIBUTABLE — names Table 4D, the element, and the missing cell', () => {
    const input: OpaqueInput = { id: '10-a', label: '16B-30ad', constructionId: '16B-30ad', area: 1752 };
    let msg = '';
    try {
      // Dallas-class climate: CTD=20, DR=M → rounds up to bin 20, unpopulated.
      calculateOpaque(input, /*ctd*/ 20, /*htd*/ 23, /*dr*/ 'M');
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toMatch(/Table 4D/);
    expect(msg).toMatch(/16B-30ad/);
    expect(msg).toMatch(/bin 20/);
    expect(msg).toMatch(/DR=M/);
  });

  it('throwing yields NO number — a silently-wrong CLTD is the prohibited outcome', () => {
    const c = ceiling('16B-30ad');
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

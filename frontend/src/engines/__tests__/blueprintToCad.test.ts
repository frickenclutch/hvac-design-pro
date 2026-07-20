import { describe, it, expect } from 'vitest';
import { buildGeometryTakeoff, sanitizePolygon, impliesRescale } from '../blueprintToCad';
import type { GeometryRoom, UnderlayRect } from '../blueprintToCad';

// A 600×400 px sheet placed at (100, 200), unrotated — the shape an imported
// blueprint lands in before calibration.
const SHEET: UnderlayRect = { id: 'sheet-a', x: 100, y: 200, width: 600, height: 400, rotation: 0 };
const PX_PER_FT = 40;

const rect = (x1: number, y1: number, x2: number, y2: number): Array<{ x: number; y: number }> => [
  { x: x1, y: y1 },
  { x: x2, y: y1 },
  { x: x2, y: y2 },
  { x: x1, y: y2 },
];

const room = (over: Partial<GeometryRoom>): GeometryRoom => ({
  name: 'Room',
  lengthFt: 6,
  widthFt: 5,
  wallRValue: 13,
  confidence: 'high',
  polygon: rect(0.1, 0.25, 0.5, 0.75),
  imageIndex: 0,
  ...over,
});

const span = (w: { x1: number; y1: number; x2: number; y2: number }) =>
  Math.hypot(w.x2 - w.x1, w.y2 - w.y1);

describe('sanitizePolygon', () => {
  it('accepts a valid loop and clamps edge overshoot into [0,1]', () => {
    const out = sanitizePolygon([{ x: -0.02, y: 0 }, { x: 1.03, y: 0 }, { x: 1, y: 1 }]);
    expect(out).not.toBeNull();
    expect(out![0]).toEqual({ x: 0, y: 0 });
    expect(out![1]).toEqual({ x: 1, y: 0 });
  });

  it('rejects fewer than 3 usable points', () => {
    expect(sanitizePolygon(undefined)).toBeNull();
    expect(sanitizePolygon([{ x: 0, y: 0 }, { x: 1, y: 1 }])).toBeNull();
    expect(sanitizePolygon([{ x: 0, y: 0 }, { x: NaN, y: 0.5 }, { x: 1, y: 1 }])).toBeNull();
  });

  it('rejects polygons that left the coordinate system entirely', () => {
    expect(sanitizePolygon([{ x: 0, y: 0 }, { x: 4.2, y: 0 }, { x: 1, y: 1 }])).toBeNull();
  });

  it('drops an explicit closing vertex', () => {
    const out = sanitizePolygon([{ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.1 }, { x: 0.9, y: 0.9 }, { x: 0.1, y: 0.1 }]);
    expect(out).toHaveLength(3);
  });
});

// The predicate the review UI reads to decide whether to promise the user that
// auto-calibrate will do something. It must never report "no-op" for a scale
// the engine would act on — that is what orphans hand-traced walls.
describe('impliesRescale', () => {
  it('reports action for any mismatch the engine acts on, including the old dead band', () => {
    expect(impliesRescale(40.4, 40)).toBe(true);   // 1% — under the old 2% gate
    expect(impliesRescale(39.6, 40)).toBe(true);   // 1% the other way
    expect(impliesRescale(40.001, 40)).toBe(true); // 0.0025%
    expect(impliesRescale(10, 40)).toBe(true);     // uncalibrated sheet
  });

  it('reports no-op only when the sheet is already true', () => {
    expect(impliesRescale(40, 40)).toBe(false);
    expect(impliesRescale(null, 40)).toBe(false);
  });

  it('reports no-op for a scale outside the sanity band, matching the engine', () => {
    // The engine refuses these and leaves the sheet alone, so the label must
    // not promise a resize that will not happen.
    expect(impliesRescale(0.1, 40)).toBe(false);    // factor 400
    expect(impliesRescale(1_000_000, 40)).toBe(false); // factor 4e-5
    expect(impliesRescale(0, 40)).toBe(false);
    expect(impliesRescale(-5, 40)).toBe(false);
    expect(impliesRescale(NaN, 40)).toBe(false);
    expect(impliesRescale(40.4, 0)).toBe(false);
  });
});

describe('buildGeometryTakeoff — mapping', () => {
  it('maps a rectangular room through the sheet rect measurement-for-measurement', () => {
    // 0.1..0.5 × 0.25..0.75 on a 600×400 sheet → 240×200 px → 6×5 ft at 40 px/ft
    const res = buildGeometryTakeoff([room({})], [SHEET], PX_PER_FT, { applyScale: false });

    expect(res.walls).toHaveLength(4);
    expect(res.rooms).toHaveLength(1);
    expect(res.rooms[0].areaSqFt).toBeCloseTo(30, 5);
    expect(res.rooms[0].perimeterFt).toBeCloseTo(22, 5);
    expect(res.warnings).toHaveLength(0);
    expect(res.impliedPxPerFt).toBeCloseTo(40, 5);
    expect(res.underlayPatches).toHaveLength(0);

    const xs = res.walls.flatMap(w => [w.x1, w.x2]);
    const ys = res.walls.flatMap(w => [w.y1, w.y2]);
    expect(Math.min(...xs)).toBeCloseTo(160, 5); // 100 + 0.1×600
    expect(Math.max(...xs)).toBeCloseTo(400, 5); // 100 + 0.5×600
    expect(Math.min(...ys)).toBeCloseTo(300, 5); // 200 + 0.25×400
    expect(Math.max(...ys)).toBeCloseTo(500, 5); // 200 + 0.75×400
  });

  it('maps through a rotated sheet (fabric angle about top-left)', () => {
    const rotated: UnderlayRect = { ...SHEET, rotation: 90 };
    const res = buildGeometryTakeoff([room({})], [rotated], PX_PER_FT, { applyScale: false });
    // rotation 90°: (lx, ly) → (x - ly, y + lx)
    const xs = res.walls.flatMap(w => [w.x1, w.x2]);
    const ys = res.walls.flatMap(w => [w.y1, w.y2]);
    expect(Math.min(...xs)).toBeCloseTo(100 - 300, 5); // x - maxLy
    expect(Math.max(...xs)).toBeCloseTo(100 - 100, 5); // x - minLy
    expect(Math.min(...ys)).toBeCloseTo(200 + 60, 5);  // y + minLx
    expect(Math.max(...ys)).toBeCloseTo(200 + 300, 5); // y + maxLx
    expect(res.walls).toHaveLength(4);
    expect(res.rooms[0].areaSqFt).toBeCloseTo(30, 5);
  });
});

describe('buildGeometryTakeoff — auto-scale', () => {
  it('derives the implied scale from printed dims and rescales the sheet to the project scale', () => {
    // Same 240×200 px footprint but printed dims say 24×20 ft → sheet reads
    // 10 px/ft → factor 4 to reach the 40 px/ft project scale.
    const r = room({ lengthFt: 24, widthFt: 20 });
    const res = buildGeometryTakeoff([r], [SHEET], PX_PER_FT, { applyScale: true });

    expect(res.impliedPxPerFt).toBeCloseTo(10, 5);
    expect(res.underlayPatches).toHaveLength(1);
    expect(res.underlayPatches[0]).toMatchObject({ id: 'sheet-a', x: 100, y: 200 });
    expect(res.underlayPatches[0].width).toBeCloseTo(2400, 5);
    expect(res.underlayPatches[0].height).toBeCloseTo(1600, 5);

    // Walls map through the SCALED rect: 24 ft reads as 960 px.
    const xs = res.walls.flatMap(w => [w.x1, w.x2]);
    expect(Math.min(...xs)).toBeCloseTo(100 + 240, 5);
    expect(Math.max(...xs)).toBeCloseTo(100 + 1200, 5);
    expect(res.rooms[0].areaSqFt).toBeCloseTo(480, 5);
    expect(res.warnings).toHaveLength(0);
  });

  it('reports the implied scale without patching when applyScale is false', () => {
    const r = room({ lengthFt: 24, widthFt: 20 });
    const res = buildGeometryTakeoff([r], [SHEET], PX_PER_FT, { applyScale: false });
    expect(res.impliedPxPerFt).toBeCloseTo(10, 5);
    expect(res.underlayPatches).toHaveLength(0);
    // Measured at the SHEET's own scale (10 px/ft, since nothing was rescaled)
    // the footprint is 24×20 ft — exactly the printed dims. Reading it against
    // the project scale instead would report a bogus 6×5 ft mismatch.
    expect(res.warnings).toHaveLength(0);
    expect(res.rooms[0].areaSqFt).toBeCloseTo(480, 5);
  });

  it('flags a genuine drawn-vs-printed disagreement', () => {
    // Three consistent rooms (120×100px ↔ 12×10 ft) carry the median to
    // 10 px/ft; the fourth is drawn at 60×60px but still claims 12×10 ft, so
    // only it should be flagged. The scale is a median over all rooms, so a
    // lone dissenter cannot be caught by comparing it to a single neighbor.
    const t = (name: string, x1: number) =>
      room({ name, lengthFt: 12, widthFt: 10, polygon: rect(x1, 0.1, x1 + 0.2, 0.35) });
    const liar = room({ name: 'Liar', lengthFt: 12, widthFt: 10, polygon: rect(0.05, 0.5, 0.15, 0.65) });
    const res = buildGeometryTakeoff(
      [t('T1', 0.05), t('T2', 0.3), t('T3', 0.55), liar],
      [SHEET], PX_PER_FT, { applyScale: false },
    );

    expect(res.impliedPxPerFt).toBeCloseTo(10, 5);
    expect(res.warnings.some(w => w.includes('Liar') && w.includes('verify against the plan'))).toBe(true);
    for (const name of ['T1', 'T2', 'T3']) {
      expect(res.warnings.some(w => w.includes(name))).toBe(false);
    }
  });

  it('excludes low-confidence rooms from the scale derivation', () => {
    const good = room({});
    const wild = room({ name: 'Guess', lengthFt: 300, widthFt: 250, confidence: 'low', polygon: rect(0.6, 0.1, 0.9, 0.6) });
    const res = buildGeometryTakeoff([good, wild], [SHEET], PX_PER_FT, { applyScale: false });
    expect(res.impliedPxPerFt).toBeCloseTo(40, 5);
  });

  it('refuses an implausible implied scale and leaves the sheet unscaled', () => {
    // Printed dims 10000× the drawing → factor far outside sanity band.
    const r = room({ lengthFt: 60000, widthFt: 50000 });
    const res = buildGeometryTakeoff([r], [SHEET], PX_PER_FT, { applyScale: true });
    expect(res.underlayPatches).toHaveLength(0);
    expect(res.warnings.some(w => w.includes('implausible scale'))).toBe(true);
  });

  it('acts on a sub-2% mismatch — the band the review UI used to call a no-op', () => {
    // Regression: the checkbox label gated on |implied - pxPerFt|/pxPerFt > 2%
    // while the engine acted on anything past 1e-6. In between, the user was
    // told the action was a no-op and the engine still rescaled AND re-tiled
    // the sheets, discarding a hand-made multi-sheet arrangement.
    const IMPLIED = 40.4; // 1% off the 40 px/ft project scale
    const r = room({ lengthFt: 240 / IMPLIED, widthFt: 200 / IMPLIED });
    const res = buildGeometryTakeoff([r], [SHEET], PX_PER_FT, { applyScale: true });

    expect(res.impliedPxPerFt).toBeCloseTo(IMPLIED, 9);
    // The engine acts...
    expect(res.underlayPatches).toHaveLength(1);
    expect(res.underlayPatches[0].width).toBeCloseTo(600 * (PX_PER_FT / IMPLIED), 9);
    // ...so the shared predicate the UI reads MUST agree that it acts.
    expect(impliesRescale(res.impliedPxPerFt, PX_PER_FT)).toBe(true);
    // The 2% rule that used to guard the label would have said otherwise.
    expect(Math.abs(IMPLIED - PX_PER_FT) / PX_PER_FT).toBeLessThan(0.02);
  });

  it('leaves an already-true sheet untouched, and says so', () => {
    // 240×200 px against 6×5 ft is exactly 40 px/ft — factor 1, no patch.
    const res = buildGeometryTakeoff([room({})], [SHEET], PX_PER_FT, { applyScale: true });
    expect(res.impliedPxPerFt).toBeCloseTo(PX_PER_FT, 9);
    expect(res.underlayPatches).toHaveLength(0);
    expect(impliesRescale(res.impliedPxPerFt, PX_PER_FT)).toBe(false);
  });

  it('re-tiles multiple sheets left-to-right after scaling so they cannot overlap', () => {
    const sheetB: UnderlayRect = { id: 'sheet-b', x: 740, y: 200, width: 600, height: 400, rotation: 0 };
    const roomA = room({ lengthFt: 24, widthFt: 20 });
    const roomB = room({ lengthFt: 24, widthFt: 20, imageIndex: 1 });
    const res = buildGeometryTakeoff([roomA, roomB], [SHEET, sheetB], PX_PER_FT, { applyScale: true });

    expect(res.underlayPatches).toHaveLength(2);
    const a = res.underlayPatches.find(p => p.id === 'sheet-a')!;
    const b = res.underlayPatches.find(p => p.id === 'sheet-b')!;
    expect(a.x).toBeCloseTo(100, 5);
    expect(a.width).toBeCloseTo(2400, 5);
    expect(b.x).toBeCloseTo(a.x + a.width + 40, 5);
  });
});

describe('buildGeometryTakeoff — rectification and wall merging', () => {
  it('squares up jittered near-orthogonal outlines', () => {
    // Slopes of 2-4px across 240px runs — well inside the 10° snap band.
    const jittered: GeometryRoom = room({
      polygon: [
        { x: 0.1, y: 0.25 },
        { x: 0.5, y: 0.258 },
        { x: 0.503, y: 0.75 },
        { x: 0.099, y: 0.745 },
      ],
    });
    const res = buildGeometryTakeoff([jittered], [SHEET], PX_PER_FT, { applyScale: false });
    expect(res.walls).toHaveLength(4);
    for (const w of res.walls) {
      const isH = Math.abs(w.y1 - w.y2) < 1e-6;
      const isV = Math.abs(w.x1 - w.x2) < 1e-6;
      expect(isH || isV).toBe(true);
    }
  });

  it('merges the shared wall of adjacent rooms into one segment and snaps near-miss lines together', () => {
    // Room B's left edge is traced 1.2px off room A's right edge — the
    // cluster pass lands both on one line, and collinear runs merge.
    const roomA = room({ name: 'A', polygon: rect(0.1, 0.25, 0.3, 0.75), lengthFt: 5, widthFt: 3 });
    const roomB = room({ name: 'B', polygon: rect(0.302, 0.25, 0.5, 0.75), lengthFt: 5, widthFt: 3 });
    const res = buildGeometryTakeoff([roomA, roomB], [SHEET], PX_PER_FT, { applyScale: false });

    // top run, bottom run, A-left, shared, B-right — 5 walls, not 8.
    expect(res.walls).toHaveLength(5);
    const shared = res.walls.filter(w =>
      Math.abs(w.x1 - w.x2) < 1e-6 && Math.abs(w.x1 - 280) < PX_PER_FT * 0.5 && Math.abs(span(w) - 200) < 1,
    );
    expect(shared).toHaveLength(1);
    expect(res.rooms[0].wallIds).toContain(shared[0].id);
    expect(res.rooms[1].wallIds).toContain(shared[0].id);
  });

  it('keeps genuinely angled walls diagonal', () => {
    // A 45° cut corner must survive rectification untouched.
    const angled: GeometryRoom = room({
      polygon: [
        { x: 0.1, y: 0.25 },
        { x: 0.5, y: 0.25 },
        { x: 0.5, y: 0.75 },
        { x: 0.2, y: 0.75 },
        { x: 0.1, y: 0.6 },
      ],
      lengthFt: 6,
      widthFt: 5,
    });
    const res = buildGeometryTakeoff([angled], [SHEET], PX_PER_FT, { applyScale: false });
    const diag = res.walls.filter(w => Math.abs(w.x1 - w.x2) > 1e-6 && Math.abs(w.y1 - w.y2) > 1e-6);
    expect(diag).toHaveLength(1);
    expect(res.walls).toHaveLength(5);
  });

  it('drops rooms whose outline collapses and says so', () => {
    // The real room establishes the sheet scale; the speck is degenerate
    // relative to it. (Collapse is scale-relative by design — a lone tiny
    // outline would simply mean the sheet is drawn at a tiny scale.)
    const real = room({ name: 'Real' });
    const tiny = room({ name: 'Dust', polygon: rect(0.5, 0.5, 0.502, 0.503) });
    const res = buildGeometryTakeoff([real, tiny], [SHEET], PX_PER_FT, { applyScale: false });
    expect(res.rooms.map(r => r.name)).toEqual(['Real']);
    expect(res.warnings.some(w => w.includes('Dust') && w.includes('collapsed'))).toBe(true);
  });

  it('drops rooms whose sheet is gone and says so', () => {
    const orphan = room({ name: 'Orphan', imageIndex: 3 });
    const res = buildGeometryTakeoff([orphan], [SHEET], PX_PER_FT, { applyScale: false });
    expect(res.rooms).toHaveLength(0);
    expect(res.warnings.some(w => w.includes('Orphan') && w.includes('no longer'))).toBe(true);
  });

  it('rejects a non-integer sheet index instead of crashing on it', () => {
    // A fractional index passes a bare `>= 0 && < length` range check and then
    // indexes the array as undefined.
    const bad = room({ name: 'Fractional', imageIndex: 0.5 });
    expect(() => buildGeometryTakeoff([bad], [SHEET], PX_PER_FT, { applyScale: false })).not.toThrow();
    const res = buildGeometryTakeoff([bad], [SHEET], PX_PER_FT, { applyScale: false });
    expect(res.rooms).toHaveLength(0);
    expect(res.warnings.some(w => w.includes('Fractional'))).toBe(true);
  });

  it('keeps near-coincident wall lines together across a cluster boundary', () => {
    // A's right edge at x=400, B's left at 419.6, C's left at 420.4 (canvas px).
    // B and C are 0.8px apart and must land on ONE line — anchoring the cluster
    // on its first value would instead merge A with B and strand C.
    const sheet: UnderlayRect = { id: 'wide', x: 0, y: 200, width: 1000, height: 400, rotation: 0 };
    const a = room({ name: 'A', polygon: rect(0.1, 0.25, 0.4, 0.75), lengthFt: 7.5, widthFt: 5 });
    const b = room({ name: 'B', polygon: rect(0.4196, 0.25, 0.6, 0.5), lengthFt: 4.5, widthFt: 2.5 });
    const c = room({ name: 'C', polygon: rect(0.4204, 0.5, 0.6, 0.75), lengthFt: 4.5, widthFt: 2.5 });
    const res = buildGeometryTakeoff([a, b, c], [sheet], PX_PER_FT, { applyScale: false });

    const vLines = [...new Set(res.walls.filter(w => Math.abs(w.x1 - w.x2) < 1e-9).map(w => w.x1))];
    // B-left and C-left must not survive as two distinct lines.
    const nearBoundary = vLines.filter(x => x > 395 && x < 425);
    expect(nearBoundary).toHaveLength(1);
  });

  it('does not let a collapsed outline set the sheet scale', () => {
    // A collinear sliver has a zero-width bbox: it gets dropped in cleanup, so
    // it must not first rescale the sheet every surviving room is placed on.
    const sliver = room({
      name: 'Sliver',
      polygon: [{ x: 0.1, y: 0.1 }, { x: 0.1, y: 0.5 }, { x: 0.1, y: 0.9 }],
      lengthFt: 20,
      widthFt: 5,
    });
    const res = buildGeometryTakeoff([sliver], [SHEET], PX_PER_FT, { applyScale: true });
    expect(res.impliedPxPerFt).toBeNull();
    expect(res.underlayPatches).toHaveLength(0);
    expect(res.rooms).toHaveLength(0);
  });

  it('places a rotated sheet beside its neighbor, not on top of it', () => {
    // Rotation is about the top-left, so a 90° sheet extends LEFT of its
    // anchor — positioning the anchor at the cursor would overlap sheet A.
    const sheetB: UnderlayRect = { id: 'sheet-b', x: 740, y: 200, width: 600, height: 400, rotation: 90 };
    const roomA = room({ name: 'A', lengthFt: 24, widthFt: 20 });
    const roomB = room({ name: 'B', lengthFt: 24, widthFt: 20, imageIndex: 1 });
    const res = buildGeometryTakeoff([roomA, roomB], [SHEET, sheetB], PX_PER_FT, { applyScale: true });

    const a = res.underlayPatches.find(p => p.id === 'sheet-a')!;
    const b = res.underlayPatches.find(p => p.id === 'sheet-b')!;
    // Sheet A (unrotated) spans [a.x, a.x + a.width]; sheet B (90°) spans
    // [b.x - b.height, b.x].
    const aRight = a.x + a.width;
    const bLeft = b.x - b.height;
    expect(bLeft).toBeGreaterThanOrEqual(aRight);

    // ...and room B's geometry must follow its sheet, clear of sheet A.
    const bWalls = res.walls.filter(w => res.rooms[1].wallIds.includes(w.id));
    expect(Math.min(...bWalls.flatMap(w => [w.x1, w.x2]))).toBeGreaterThanOrEqual(aRight);
  });
});

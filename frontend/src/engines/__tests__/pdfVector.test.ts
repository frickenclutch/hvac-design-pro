import { describe, it, expect } from 'vitest';
import {
  extractVectorSegments,
  decodePathData,
  dedupeSegments,
  dedupeSegmentsWithReport,
  MAX_TRACEABLE_SEGMENTS,
  matMul,
  applyMat,
} from '../pdfVector';
import type { OpsCodes, OperatorList, Matrix, VectorSegment } from '../pdfVector';

// Mirrors pdfjs-dist 6.1.200's exported OPS values for the ops we react to.
const OPS: OpsCodes = {
  constructPath: 91,
  transform: 12,
  save: 10,
  restore: 11,
  setLineWidth: 2,
  stroke: 20,
  closeStroke: 21,
  fill: 22,
  eoFill: 23,
  fillStroke: 24,
  eoFillStroke: 25,
  closeFillStroke: 26,
  paintFormXObjectBegin: 74,
  paintFormXObjectEnd: 75,
};

const D = { moveTo: 0, lineTo: 1, curveTo: 2, quadraticCurveTo: 3, closePath: 4 };

// A 612×792pt page (US Letter). pdf.js's scale-1 viewport transform flips y:
// [1, 0, 0, -1, 0, height].
const VIEWPORT = { width: 612, height: 792, transform: [1, 0, 0, -1, 0, 792] };

const path = (paintOp: number, data: number[]): [number, [number[]], null] => [paintOp, [data], null];

function opList(entries: Array<{ fn: number; args: unknown }>): OperatorList {
  return { fnArray: entries.map(e => e.fn), argsArray: entries.map(e => e.args) };
}

describe('matrix helpers', () => {
  it('composes and applies transforms like pdf.js Util.transform', () => {
    const translate: Matrix = [1, 0, 0, 1, 10, 20];
    const scale: Matrix = [2, 0, 0, 2, 0, 0];
    const m = matMul(translate, scale);
    // scale first, then translate
    expect(applyMat(m, 3, 4)).toEqual({ x: 16, y: 28 });
  });
});

describe('decodePathData', () => {
  it('decodes a polyline', () => {
    const out = decodePathData([D.moveTo, 0, 0, D.lineTo, 10, 0, D.lineTo, 10, 10]);
    expect(out).not.toBeNull();
    expect(out!.polylines).toHaveLength(1);
    expect(out!.polylines[0]).toHaveLength(3);
    expect(out!.curves).toBe(0);
  });

  it('starts a new polyline on each moveTo', () => {
    const out = decodePathData([D.moveTo, 0, 0, D.lineTo, 5, 0, D.moveTo, 9, 9, D.lineTo, 9, 20]);
    expect(out!.polylines).toHaveLength(2);
  });

  it('drops a subpath with a single point', () => {
    const out = decodePathData([D.moveTo, 1, 1, D.moveTo, 2, 2, D.lineTo, 3, 3]);
    expect(out!.polylines).toHaveLength(1);
  });

  it('closes a subpath back to its start', () => {
    const out = decodePathData([D.moveTo, 0, 0, D.lineTo, 4, 0, D.lineTo, 4, 4, D.closePath]);
    const line = out!.polylines[0];
    expect(line[line.length - 1]).toEqual({ x: 0, y: 0 });
  });

  it('flattens curves into sampled points and counts them', () => {
    const out = decodePathData([D.moveTo, 0, 0, D.curveTo, 0, 10, 10, 10, 10, 0]);
    expect(out!.curves).toBe(1);
    expect(out!.polylines[0].length).toBeGreaterThan(2);
    const end = out!.polylines[0][out!.polylines[0].length - 1];
    expect(end.x).toBeCloseTo(10, 6);
    expect(end.y).toBeCloseTo(0, 6);
  });

  it('refuses a path with an unrecognized op rather than guessing', () => {
    expect(decodePathData([D.moveTo, 0, 0, 99, 1, 2])).toBeNull();
  });
});

describe('extractVectorSegments', () => {
  it('maps a stroked line into normalized sheet space with y flipped', () => {
    // PDF user space: (0,792) is top-left after the viewport flip.
    const res = extractVectorSegments(
      opList([{ fn: OPS.constructPath, args: path(OPS.stroke, [D.moveTo, 0, 792, D.lineTo, 612, 792]) }]),
      OPS, VIEWPORT,
    );
    expect(res.segments).toHaveLength(1);
    const s = res.segments[0];
    expect(s.x1).toBeCloseTo(0, 6);
    expect(s.y1).toBeCloseTo(0, 6);   // y=792 in PDF space → top of the sheet
    expect(s.x2).toBeCloseTo(1, 6);
    expect(s.y2).toBeCloseTo(0, 6);
    expect(s.kind).toBe('stroke');
  });

  it('honours the CTM set by transform ops', () => {
    // Translate by (306, 396) then draw a unit line.
    const res = extractVectorSegments(
      opList([
        { fn: OPS.transform, args: [1, 0, 0, 1, 306, 396] },
        { fn: OPS.constructPath, args: path(OPS.stroke, [D.moveTo, 0, 0, D.lineTo, 306, 0]) },
      ]),
      OPS, VIEWPORT,
    );
    const s = res.segments[0];
    expect(s.x1).toBeCloseTo(306 / 612, 6);
    expect(s.y1).toBeCloseTo((792 - 396) / 792, 6);
    expect(s.x2).toBeCloseTo(612 / 612, 6);
  });

  it('restores the CTM on save/restore so later paths are unaffected', () => {
    const res = extractVectorSegments(
      opList([
        { fn: OPS.save, args: [] },
        { fn: OPS.transform, args: [1, 0, 0, 1, 300, 0] },
        { fn: OPS.constructPath, args: path(OPS.stroke, [D.moveTo, 0, 792, D.lineTo, 100, 792]) },
        { fn: OPS.restore, args: [] },
        { fn: OPS.constructPath, args: path(OPS.stroke, [D.moveTo, 0, 792, D.lineTo, 100, 792]) },
      ]),
      OPS, VIEWPORT,
    );
    expect(res.segments).toHaveLength(2);
    expect(res.segments[0].x1).toBeCloseTo(300 / 612, 6); // inside the save
    expect(res.segments[1].x1).toBeCloseTo(0, 6);         // after the restore
  });

  it('tags filled paths distinctly from stroked ones', () => {
    const res = extractVectorSegments(
      opList([{ fn: OPS.constructPath, args: path(OPS.fill, [D.moveTo, 0, 792, D.lineTo, 612, 792]) }]),
      OPS, VIEWPORT,
    );
    expect(res.segments[0].kind).toBe('fill');
    expect(res.segments[0].width).toBe(0);
  });

  it('scales stroke width through the CTM', () => {
    const res = extractVectorSegments(
      opList([
        { fn: OPS.setLineWidth, args: [6] },
        { fn: OPS.transform, args: [2, 0, 0, 2, 0, 0] },
        { fn: OPS.constructPath, args: path(OPS.stroke, [D.moveTo, 0, 300, D.lineTo, 200, 300]) },
      ]),
      OPS, VIEWPORT,
    );
    // 6pt at 2× → 12 device px, normalized by page width.
    expect(res.segments[0].width).toBeCloseTo(12 / 612, 6);
  });

  it('ignores paths that are constructed but never painted', () => {
    const CLIP = 29; // OPS.clip — a path used only to bound later drawing
    const res = extractVectorSegments(
      opList([{ fn: OPS.constructPath, args: path(CLIP, [D.moveTo, 0, 0, D.lineTo, 612, 792]) }]),
      OPS, VIEWPORT,
    );
    expect(res.segments).toHaveLength(0);
  });

  it('drops sub-threshold hairlines (glyph strokes, tracing noise)', () => {
    const res = extractVectorSegments(
      opList([{ fn: OPS.constructPath, args: path(OPS.stroke, [D.moveTo, 0, 792, D.lineTo, 0.3, 792]) }]),
      OPS, VIEWPORT,
    );
    expect(res.segments).toHaveLength(0);
  });

  it('emits one segment per polyline leg and counts flattened curves', () => {
    const res = extractVectorSegments(
      opList([{
        fn: OPS.constructPath,
        args: path(OPS.stroke, [D.moveTo, 0, 792, D.lineTo, 300, 792, D.lineTo, 300, 500]),
      }]),
      OPS, VIEWPORT,
    );
    expect(res.segments).toHaveLength(2);
    expect(res.curveCount).toBe(0);
  });

  it('survives a malformed path without emitting geometry', () => {
    const res = extractVectorSegments(
      opList([
        { fn: OPS.constructPath, args: path(OPS.stroke, [D.moveTo, 0, 0, 77, 5]) },
        { fn: OPS.constructPath, args: path(OPS.stroke, [D.moveTo, 0, 792, D.lineTo, 612, 792]) },
      ]),
      OPS, VIEWPORT,
    );
    expect(res.segments).toHaveLength(1); // bad path skipped, good one kept
  });

  it('reports the page size in points', () => {
    const res = extractVectorSegments(opList([]), OPS, VIEWPORT);
    expect(res.pageWidthPt).toBe(612);
    expect(res.pageHeightPt).toBe(792);
  });
});

// pdf.js carries a form XObject's /Matrix on paintFormXObjectBegin ONLY — never
// as a separate transform op. Dropping it silently draws the form's contents at
// the wrong scale and offset, which is exactly the "wrong geometry" this module
// promises never to emit.
describe('extractVectorSegments — form XObject matrices', () => {
  // Scale 2× about the origin, then translate to (100, 50) in PDF user space.
  const FORM: number[] = [2, 0, 0, 2, 100, 50];
  // A horizontal run from (0,0) to (50,0) in the FORM's own coordinate space.
  const INNER_PATH = [D.moveTo, 0, 0, D.lineTo, 50, 0];
  // → user space (100,50)→(200,50) → viewport y = 792-50 = 742.
  const EXPECT_X1 = 100 / 612, EXPECT_X2 = 200 / 612, EXPECT_Y = 742 / 792;

  it('composes the form matrix into the CTM', () => {
    const res = extractVectorSegments(
      opList([
        { fn: OPS.paintFormXObjectBegin, args: [FORM, [0, 0, 100, 100]] },
        { fn: OPS.constructPath, args: path(OPS.stroke, INNER_PATH) },
        { fn: OPS.paintFormXObjectEnd, args: [] },
      ]),
      OPS, VIEWPORT,
    );
    expect(res.segments).toHaveLength(1);
    const s = res.segments[0];
    expect(s.x1).toBeCloseTo(EXPECT_X1, 9);
    expect(s.y1).toBeCloseTo(EXPECT_Y, 9);
    expect(s.x2).toBeCloseTo(EXPECT_X2, 9);
    expect(s.y2).toBeCloseTo(EXPECT_Y, 9);
  });

  it('pops the form matrix at End so later geometry is unaffected', () => {
    const res = extractVectorSegments(
      opList([
        { fn: OPS.paintFormXObjectBegin, args: [FORM, [0, 0, 100, 100]] },
        { fn: OPS.constructPath, args: path(OPS.stroke, INNER_PATH) },
        { fn: OPS.paintFormXObjectEnd, args: [] },
        { fn: OPS.constructPath, args: path(OPS.stroke, INNER_PATH) },
      ]),
      OPS, VIEWPORT,
    );
    expect(res.segments).toHaveLength(2);
    expect(res.segments[1].x1).toBeCloseTo(0, 9);
    expect(res.segments[1].x2).toBeCloseTo(50 / 612, 9);
    expect(res.segments[1].y1).toBeCloseTo(792 / 792, 9); // y=0 → bottom of sheet
  });

  it('nests forms, composing outer ∘ inner', () => {
    const INNER_FORM: number[] = [1, 0, 0, 1, 10, 0]; // +10 in the OUTER form's space
    const res = extractVectorSegments(
      opList([
        { fn: OPS.paintFormXObjectBegin, args: [FORM, [0, 0, 100, 100]] },
        { fn: OPS.paintFormXObjectBegin, args: [INNER_FORM, [0, 0, 100, 100]] },
        { fn: OPS.constructPath, args: path(OPS.stroke, INNER_PATH) },
        { fn: OPS.paintFormXObjectEnd, args: [] },
        // Back in the outer form only.
        { fn: OPS.constructPath, args: path(OPS.stroke, INNER_PATH) },
        { fn: OPS.paintFormXObjectEnd, args: [] },
      ]),
      OPS, VIEWPORT,
    );
    expect(res.segments).toHaveLength(2);
    // (0,0) → inner (10,0) → outer (2*10+100, 50) = (120, 50)
    expect(res.segments[0].x1).toBeCloseTo(120 / 612, 9);
    expect(res.segments[0].x2).toBeCloseTo(220 / 612, 9);
    expect(res.segments[0].y1).toBeCloseTo(EXPECT_Y, 9);
    // After the inner End, the outer matrix alone applies again.
    expect(res.segments[1].x1).toBeCloseTo(EXPECT_X1, 9);
  });

  it('interleaves correctly with q/Q and transform', () => {
    const res = extractVectorSegments(
      opList([
        { fn: OPS.save, args: [] },
        { fn: OPS.transform, args: [1, 0, 0, 1, 6, 0] },        // q: +6
        { fn: OPS.paintFormXObjectBegin, args: [FORM, [0, 0, 100, 100]] },
        { fn: OPS.constructPath, args: path(OPS.stroke, INNER_PATH) },
        { fn: OPS.paintFormXObjectEnd, args: [] },
        { fn: OPS.constructPath, args: path(OPS.stroke, INNER_PATH) }, // still +6
        { fn: OPS.restore, args: [] },
        { fn: OPS.constructPath, args: path(OPS.stroke, INNER_PATH) }, // base CTM
      ]),
      OPS, VIEWPORT,
    );
    expect(res.segments).toHaveLength(3);
    expect(res.segments[0].x1).toBeCloseTo((100 + 6) / 612, 9); // form inside q
    expect(res.segments[1].x1).toBeCloseTo(6 / 612, 9);         // form popped, q kept
    expect(res.segments[2].x1).toBeCloseTo(0, 9);               // Q restored
  });

  it('carries the form matrix into stroke width scaling', () => {
    const res = extractVectorSegments(
      opList([
        { fn: OPS.setLineWidth, args: [3] },
        { fn: OPS.paintFormXObjectBegin, args: [FORM, [0, 0, 100, 100]] },
        { fn: OPS.constructPath, args: path(OPS.stroke, INNER_PATH) },
        { fn: OPS.paintFormXObjectEnd, args: [] },
      ]),
      OPS, VIEWPORT,
    );
    expect(res.segments[0].width).toBeCloseTo(6 / 612, 9); // 3pt at the form's 2×
  });

  it('treats a missing or malformed form matrix as identity rather than guessing', () => {
    const res = extractVectorSegments(
      opList([
        { fn: OPS.paintFormXObjectBegin, args: [null, [0, 0, 100, 100]] },
        { fn: OPS.constructPath, args: path(OPS.stroke, INNER_PATH) },
        { fn: OPS.paintFormXObjectEnd, args: [] },
      ]),
      OPS, VIEWPORT,
    );
    expect(res.segments[0].x1).toBeCloseTo(0, 9);
    expect(res.segments[0].x2).toBeCloseTo(50 / 612, 9);
  });
});

const seg = (x1: number, y1: number, x2: number, y2: number): VectorSegment =>
  ({ x1, y1, x2, y2, width: 0.001, kind: 'stroke' as const });

/**
 * The original pairwise scan, verbatim. The spatial-hash implementation must
 * agree with this exactly — it is a performance fix, not a behaviour change.
 */
function dedupeNaive(segments: VectorSegment[], tolerance = 0.0008): VectorSegment[] {
  const out: VectorSegment[] = [];
  const near = (a: number, b: number) => Math.abs(a - b) <= tolerance;
  for (const s of segments) {
    const dup = out.some(o =>
      (near(o.x1, s.x1) && near(o.y1, s.y1) && near(o.x2, s.x2) && near(o.y2, s.y2)) ||
      (near(o.x1, s.x2) && near(o.y1, s.y2) && near(o.x2, s.x1) && near(o.y2, s.y1)),
    );
    if (!dup) out.push(s);
  }
  return out;
}

/** Deterministic LCG — no Math.random in a committed test. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

describe('dedupeSegments', () => {
  it('removes an exact duplicate', () => {
    expect(dedupeSegments([seg(0, 0, 1, 0), seg(0, 0, 1, 0)])).toHaveLength(1);
  });

  it('removes a reversed duplicate', () => {
    expect(dedupeSegments([seg(0, 0, 1, 0), seg(1, 0, 0, 0)])).toHaveLength(1);
  });

  it('keeps genuinely distinct runs', () => {
    expect(dedupeSegments([seg(0, 0, 1, 0), seg(0, 0.5, 1, 0.5)])).toHaveLength(2);
  });

  // The trap the spatial hash must not fall into: these two x1 values are well
  // within tolerance of each other, but they quantize to ADJACENT buckets
  // (floor(0.9999)=0 vs floor(1.0001)=1). Probing only the exact bucket would
  // silently stop deduping them.
  it('dedupes a pair straddling a bucket boundary', () => {
    const t = 0.0008;
    const a = seg(t * 0.9999, 0, 0.5, 0);
    const b = seg(t * 1.0001, 0, 0.5, 0);
    expect(dedupeNaive([a, b], t)).toHaveLength(1); // guard the premise
    expect(dedupeSegments([a, b], t)).toHaveLength(1);
  });

  it('dedupes a boundary-straddling pair on every coordinate, in both orders', () => {
    const t = 0.0008;
    const lo = t * 0.9999, hi = t * 1.0001;
    const cases: Array<[VectorSegment, VectorSegment]> = [
      [seg(lo, 0.4, 0.5, 0.4), seg(hi, 0.4, 0.5, 0.4)],
      [seg(0.4, lo, 0.4, 0.5), seg(0.4, hi, 0.4, 0.5)],
      [seg(0.2, 0.4, lo, 0.4), seg(0.2, 0.4, hi, 0.4)],
      [seg(0.2, 0.4, 0.2, lo), seg(0.2, 0.4, 0.2, hi)],
      // ...and the same, reversed: b traverses the run backwards.
      [seg(lo, 0.4, 0.5, 0.4), seg(0.5, 0.4, hi, 0.4)],
      [seg(0.2, 0.4, 0.2, lo), seg(0.2, hi, 0.2, 0.4)],
    ];
    for (const [a, b] of cases) {
      expect(dedupeNaive([a, b], t)).toHaveLength(1);
      expect(dedupeSegments([a, b], t)).toHaveLength(1);
    }
  });

  it('is identical to the pairwise scan on randomized input', () => {
    const rnd = lcg(20260719);
    const t = 0.0008;
    const input: VectorSegment[] = [];
    for (let i = 0; i < 1200; i++) {
      // Snap most endpoints onto a coarse grid so real duplicates occur, then
      // jitter by roughly ±tolerance so plenty of pairs land near a boundary.
      const snap = (v: number) => Math.round(v * 40) / 40;
      const jitter = () => (rnd() - 0.5) * t * 2.2;
      const x1 = snap(rnd()) + jitter();
      const y1 = snap(rnd()) + jitter();
      const x2 = snap(rnd()) + jitter();
      const y2 = snap(rnd()) + jitter();
      const s = seg(x1, y1, x2, y2);
      input.push(rnd() < 0.35 ? seg(s.x2, s.y2, s.x1, s.y1) : s);
    }
    const expected = dedupeNaive(input, t);
    const actual = dedupeSegments(input, t);
    expect(actual.length).toBe(expected.length);
    expect(actual).toEqual(expected);
    // The fixture must actually exercise deduping, or this proves nothing.
    expect(expected.length).toBeLessThan(input.length);
  });

  it('matches the pairwise scan when every run is distinct', () => {
    const rnd = lcg(7);
    const input: VectorSegment[] = [];
    for (let i = 0; i < 600; i++) input.push(seg(rnd(), rnd(), rnd(), rnd()));
    expect(dedupeSegments(input)).toEqual(dedupeNaive(input));
  });

  it('handles a large sheet well inside an interactive budget', () => {
    const rnd = lcg(99);
    const input: VectorSegment[] = [];
    for (let i = 0; i < 40_000; i++) input.push(seg(rnd(), rnd(), rnd(), rnd()));
    const started = Date.now();
    const out = dedupeSegments(input);
    const elapsed = Date.now() - started;
    expect(out.length).toBeGreaterThan(39_000); // essentially all distinct
    // Measures ~150ms; the pairwise scan this replaced took ~6s on this input.
    // Generous enough for a loaded CI box, tight enough to catch a regression
    // back toward quadratic.
    expect(elapsed).toBeLessThan(1000);
  });
});

describe('dedupeSegmentsWithReport', () => {
  it('reports counts without capping a normal sheet', () => {
    const r = dedupeSegmentsWithReport([seg(0, 0, 1, 0), seg(1, 0, 0, 0), seg(0, 0.5, 1, 0.5)]);
    expect(r.capped).toBe(false);
    expect(r.notice).toBeNull();
    expect(r.inputCount).toBe(3);
    expect(r.keptCount).toBe(2);
    expect(r.segments).toHaveLength(2);
  });

  it('refuses an over-dense sheet outright rather than truncating it', () => {
    const rnd = lcg(3);
    const input: VectorSegment[] = [];
    for (let i = 0; i < 25; i++) input.push(seg(rnd(), rnd(), rnd(), rnd()));
    const r = dedupeSegmentsWithReport(input, { maxSegments: 10 });
    expect(r.capped).toBe(true);
    expect(r.segments).toHaveLength(0); // never a partial trace
    expect(r.keptCount).toBe(0);
    expect(r.inputCount).toBe(25);
    expect(r.notice).toBeTruthy();
    expect(r.notice).toContain('25');
    expect(r.notice).toContain('10');
  });

  it('defaults to the published cap', () => {
    expect(MAX_TRACEABLE_SEGMENTS).toBeGreaterThan(0);
    const r = dedupeSegmentsWithReport([seg(0, 0, 1, 0)]);
    expect(r.capped).toBe(false);
    expect(r.notice).toBeNull();
  });

  it('leaves the legacy dedupeSegments uncapped, so its output is unchanged', () => {
    const rnd = lcg(11);
    const input: VectorSegment[] = [];
    for (let i = 0; i < 25; i++) input.push(seg(rnd(), rnd(), rnd(), rnd()));
    expect(dedupeSegments(input)).toEqual(dedupeNaive(input));
    expect(dedupeSegments(input).length).toBe(25);
  });

  it('groups digits in the notice for readability', () => {
    const r = dedupeSegmentsWithReport([seg(0, 0, 1, 0)], { maxSegments: 0 });
    expect(r.notice).toContain('1 vector runs');
  });
});

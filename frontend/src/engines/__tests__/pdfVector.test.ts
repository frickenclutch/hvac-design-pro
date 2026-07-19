import { describe, it, expect } from 'vitest';
import { extractVectorSegments, decodePathData, dedupeSegments, matMul, applyMat } from '../pdfVector';
import type { OpsCodes, OperatorList, Matrix } from '../pdfVector';

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

describe('dedupeSegments', () => {
  const seg = (x1: number, y1: number, x2: number, y2: number) =>
    ({ x1, y1, x2, y2, width: 0.001, kind: 'stroke' as const });

  it('removes an exact duplicate', () => {
    expect(dedupeSegments([seg(0, 0, 1, 0), seg(0, 0, 1, 0)])).toHaveLength(1);
  });

  it('removes a reversed duplicate', () => {
    expect(dedupeSegments([seg(0, 0, 1, 0), seg(1, 0, 0, 0)])).toHaveLength(1);
  });

  it('keeps genuinely distinct runs', () => {
    expect(dedupeSegments([seg(0, 0, 1, 0), seg(0, 0.5, 1, 0.5)])).toHaveLength(2);
  });
});

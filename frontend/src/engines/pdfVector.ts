// Vector geometry extraction from CAD-plotted PDFs.
//
// A PDF produced by AutoCAD/Revit/ArchiCAD carries the drawing's real line
// geometry as vector paths, not pixels. Reading those paths gives an EXACT
// takeoff — no vision model, no estimation, no scaling error — so a plan set
// can be converted in full and the sheet image discarded afterwards.
//
// Output is in the same normalized [0,1] sheet space Logarithmic Extraction produces,
// so both feed the identical mapper in blueprintToCad.ts. The normalization
// uses the page viewport, which is also what the rasterizer used to build the
// underlay, so extracted geometry lands exactly on the displayed sheet.
//
// This module is pure geometry over an already-fetched operator list; the
// pdf.js loading lives in the caller so this stays testable without a worker.

/** A straight run of the drawing, normalized to the sheet: 0..1, y downward. */
export interface VectorSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Stroke width in normalized sheet-width units (0 for filled paths). */
  width: number;
  /** How the path was painted — walls are typically stroked, poché is filled. */
  kind: 'stroke' | 'fill';
}

export interface VectorSheet {
  segments: VectorSegment[];
  /** Page size in points, for reporting the drawing's true sheet size. */
  pageWidthPt: number;
  pageHeightPt: number;
  /** Paths encountered that were curves, flattened into segments. */
  curveCount: number;
}

// A 2×3 affine in pdf.js order: [a, b, c, d, e, f].
export type Matrix = [number, number, number, number, number, number];

/** pdf.js Util.transform — compose m1 ∘ m2. */
export function matMul(m1: Matrix, m2: Matrix): Matrix {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

export function applyMat(m: Matrix, x: number, y: number): { x: number; y: number } {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}

/** Mean absolute scale factor of a matrix — converts stroke widths to device. */
function matScale(m: Matrix): number {
  return (Math.hypot(m[0], m[1]) + Math.hypot(m[2], m[3])) / 2;
}

// pdf.js encodes a constructed path as a flat number array tagged with these
// internal DrawOPS discriminators. They are NOT exported by pdfjs-dist, so they
// are mirrored here — verified against pdfjs-dist 6.1.200. If a pdf.js upgrade
// changes them, extraction degrades to "no segments found", never to wrong
// geometry, because an unrecognized tag aborts the path.
const DRAW_OP = {
  moveTo: 0,
  lineTo: 1,
  curveTo: 2,
  quadraticCurveTo: 3,
  closePath: 4,
} as const;

/** Points sampled per Bézier — plans use curves for arcs/door swings only. */
const CURVE_STEPS = 8;
/** Segments shorter than this (normalized) are tracing noise or glyph strokes. */
const MIN_SEGMENT_NORM = 0.0015;

// The subset of pdf.js OPS this walker reacts to. Passed in by the caller so
// the module never imports pdfjs (keeps it pure and unit-testable).
export interface OpsCodes {
  constructPath: number;
  transform: number;
  save: number;
  restore: number;
  setLineWidth: number;
  stroke: number;
  closeStroke: number;
  fill: number;
  eoFill: number;
  fillStroke: number;
  eoFillStroke: number;
  closeFillStroke: number;
  /**
   * pdf.js carries a form XObject's `/Matrix` ONLY on this opcode — it is never
   * re-emitted as a separate `transform`. Ignoring it draws every form's
   * contents at the wrong scale and position, so it must be composed into the
   * CTM. pdf.js's own canvas backend does an implicit save here, and the
   * matching End does the restore; this walker mirrors that exactly.
   */
  paintFormXObjectBegin: number;
  paintFormXObjectEnd: number;
}

export interface OperatorList {
  fnArray: number[] | Int32Array;
  argsArray: unknown[];
}

interface Pt { x: number; y: number }

function bezier(p0: Pt, c1: Pt, c2: Pt, p1: Pt, t: number): Pt {
  const u = 1 - t;
  const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
  return {
    x: a * p0.x + b * c1.x + c * c2.x + d * p1.x,
    y: a * p0.y + b * c1.y + c * c2.y + d * p1.y,
  };
}

function quadratic(p0: Pt, c: Pt, p1: Pt, t: number): Pt {
  const u = 1 - t;
  const a = u * u, b = 2 * u * t, d = t * t;
  return { x: a * p0.x + b * c.x + d * p1.x, y: a * p0.y + b * c.y + d * p1.y };
}

/**
 * Decode one pdf.js path payload into polylines in path space.
 * Returns null when the payload contains an unrecognized op — better to skip a
 * path than to emit geometry from a misread encoding.
 */
export function decodePathData(data: ArrayLike<number>): { polylines: Pt[][]; curves: number } | null {
  const polylines: Pt[][] = [];
  let current: Pt[] = [];
  let curves = 0;
  const flush = () => {
    if (current.length >= 2) polylines.push(current);
    current = [];
  };

  for (let i = 0; i < data.length;) {
    const op = data[i++];
    switch (op) {
      case DRAW_OP.moveTo: {
        flush();
        current = [{ x: data[i++], y: data[i++] }];
        break;
      }
      case DRAW_OP.lineTo: {
        current.push({ x: data[i++], y: data[i++] });
        break;
      }
      case DRAW_OP.curveTo: {
        const c1 = { x: data[i++], y: data[i++] };
        const c2 = { x: data[i++], y: data[i++] };
        const p1 = { x: data[i++], y: data[i++] };
        const p0 = current[current.length - 1] ?? p1;
        for (let s = 1; s <= CURVE_STEPS; s++) current.push(bezier(p0, c1, c2, p1, s / CURVE_STEPS));
        curves++;
        break;
      }
      case DRAW_OP.quadraticCurveTo: {
        const c = { x: data[i++], y: data[i++] };
        const p1 = { x: data[i++], y: data[i++] };
        const p0 = current[current.length - 1] ?? p1;
        for (let s = 1; s <= CURVE_STEPS; s++) current.push(quadratic(p0, c, p1, s / CURVE_STEPS));
        curves++;
        break;
      }
      case DRAW_OP.closePath: {
        if (current.length >= 2) current.push({ ...current[0] });
        break;
      }
      default:
        return null; // unknown encoding — refuse rather than guess
    }
  }
  flush();
  return { polylines, curves };
}

const STROKE_OPS = new Set<number>();
const PAINT_OPS = new Set<number>();

/**
 * Walk a page's operator list and return every drawn straight run, normalized
 * to the page viewport.
 *
 * @param opList   from `page.getOperatorList()`
 * @param OPS      pdf.js's exported OPS enum (only the members in OpsCodes)
 * @param viewport `page.getViewport({ scale: 1 })` — its transform maps PDF
 *                 user space to top-left-origin viewport pixels, matching the
 *                 raster the underlay was built from.
 */
export function extractVectorSegments(
  opList: OperatorList,
  OPS: OpsCodes,
  viewport: { width: number; height: number; transform: number[] },
): VectorSheet {
  STROKE_OPS.clear();
  PAINT_OPS.clear();
  for (const o of [OPS.stroke, OPS.closeStroke, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke]) STROKE_OPS.add(o);
  for (const o of [OPS.stroke, OPS.closeStroke, OPS.fill, OPS.eoFill, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke]) PAINT_OPS.add(o);

  const base = viewport.transform as Matrix;
  let ctm: Matrix = [...base] as Matrix;
  const stack: Matrix[] = [];
  let lineWidth = 1;
  const lineWidthStack: number[] = [];

  // Graphics-state push/pop, shared by q/Q and by form XObject begin/end so the
  // two can nest in any combination without diverging.
  const pushState = () => {
    stack.push([...ctm] as Matrix);
    lineWidthStack.push(lineWidth);
  };
  const popState = () => {
    const m = stack.pop();
    if (m) ctm = m;
    const lw = lineWidthStack.pop();
    if (lw !== undefined) lineWidth = lw;
  };

  const segments: VectorSegment[] = [];
  let curveCount = 0;
  const { width: vw, height: vh } = viewport;

  const fns = opList.fnArray;
  for (let i = 0; i < fns.length; i++) {
    const fn = fns[i];
    const args = opList.argsArray[i] as unknown[];

    if (fn === OPS.save) {
      pushState();
    } else if (fn === OPS.restore) {
      popState();
    } else if (fn === OPS.paintFormXObjectBegin) {
      // args = [matrix, bbox]. pdf.js's canvas backend saves the graphics state
      // here and concatenates the form matrix onto the CTM, so the same
      // composition order as OPS.transform applies. Nesting falls out of the
      // shared save/restore stacks.
      pushState();
      const raw = args?.[0];
      // A missing or malformed /Matrix means identity — never a guessed scale.
      if (Array.isArray(raw) && raw.length >= 6) {
        const m = (raw as number[]).slice(0, 6);
        if (m.every(Number.isFinite)) ctm = matMul(ctm, m as Matrix);
      }
    } else if (fn === OPS.paintFormXObjectEnd) {
      popState();
    } else if (fn === OPS.transform) {
      const a = args as unknown as number[];
      if (a && a.length >= 6) ctm = matMul(ctm, a.slice(0, 6) as Matrix);
    } else if (fn === OPS.setLineWidth) {
      const a = args as unknown as number[];
      if (typeof a?.[0] === 'number') lineWidth = a[0];
    } else if (fn === OPS.constructPath) {
      // pdfjs 6: argsArray entry is [paintOp, data, minMax] where data[0] is
      // the flat draw-ops array.
      const paintOp = args?.[0] as number;
      const dataHolder = args?.[1] as ArrayLike<number>[] | undefined;
      const raw = dataHolder?.[0];
      if (!PAINT_OPS.has(paintOp) || !raw || typeof (raw as ArrayLike<number>).length !== 'number') continue;

      const decoded = decodePathData(raw as ArrayLike<number>);
      if (!decoded) continue;
      curveCount += decoded.curves;

      const kind: VectorSegment['kind'] = STROKE_OPS.has(paintOp) ? 'stroke' : 'fill';
      const normWidth = STROKE_OPS.has(paintOp) ? (lineWidth * matScale(ctm)) / vw : 0;

      for (const line of decoded.polylines) {
        for (let k = 0; k + 1 < line.length; k++) {
          const p = applyMat(ctm, line[k].x, line[k].y);
          const q = applyMat(ctm, line[k + 1].x, line[k + 1].y);
          const s: VectorSegment = {
            x1: p.x / vw, y1: p.y / vh,
            x2: q.x / vw, y2: q.y / vh,
            width: normWidth,
            kind,
          };
          if (Math.hypot(s.x2 - s.x1, s.y2 - s.y1) < MIN_SEGMENT_NORM) continue;
          if (![s.x1, s.y1, s.x2, s.y2].every(Number.isFinite)) continue;
          segments.push(s);
        }
      }
    }
  }

  return { segments, pageWidthPt: vw, pageHeightPt: vh, curveCount };
}

/**
 * Map extracted segments onto the placed sheet and convert them to CAD walls.
 * Reuses the underlay rect exactly as blueprintToCad's mapper does, so vector
 * and Logarithmic Extraction lands in the same place.
 *
 * `pxPerFt` is only used to express wall lengths; positions come straight from
 * the sheet, which is what makes this measurement-for-measurement.
 */
export function segmentsToWalls(
  segments: VectorSegment[],
  rect: { x: number; y: number; width: number; height: number; rotation: number },
  opts: { rValue: number; thicknessIn: number },
): Array<{
  id: string;
  x1: number; y1: number; x2: number; y2: number;
  thicknessIn: number; rValue: number; material: 'insulated_stud'; fabricId: string;
}> {
  const th = (rect.rotation * Math.PI) / 180;
  const cos = Math.cos(th);
  const sin = Math.sin(th);
  const place = (nx: number, ny: number) => {
    const lx = nx * rect.width;
    const ly = ny * rect.height;
    return { x: rect.x + lx * cos - ly * sin, y: rect.y + lx * sin + ly * cos };
  };
  return segments.map(s => {
    const a = place(s.x1, s.y1);
    const b = place(s.x2, s.y2);
    return {
      id: crypto.randomUUID(),
      x1: a.x, y1: a.y, x2: b.x, y2: b.y,
      thicknessIn: opts.thicknessIn,
      rValue: opts.rValue,
      material: 'insulated_stud' as const,
      fabricId: '',
    };
  });
}

/**
 * Above this many raw segments the tracer refuses the sheet outright rather
 * than converting part of it. See {@link dedupeSegmentsWithReport}.
 */
export const MAX_TRACEABLE_SEGMENTS = 250_000;

export interface DedupeReport {
  /** Deduped runs — EMPTY when `capped` is true. Never a partial trace. */
  segments: VectorSegment[];
  /** Raw segments handed in, before deduping. */
  inputCount: number;
  /** Runs kept after deduping (0 when capped). */
  keptCount: number;
  /** True when `inputCount` exceeded the cap and nothing was traced. */
  capped: boolean;
  /** User-facing explanation when `capped`, else null. Callers MUST show it. */
  notice: string | null;
}

export interface DedupeOptions {
  /** Endpoint match distance in normalized sheet units. */
  tolerance?: number;
  /** Refuse the sheet above this many raw segments. Infinity disables the cap. */
  maxSegments?: number;
}

const groupDigits = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/**
 * Collapse duplicate and overlapping collinear runs.
 * CAD exports routinely stroke the same line more than once (layer overprint,
 * hatch boundaries), and a wall drawn as a closed rectangle contributes each
 * edge twice. Deduping here keeps the converted drawing from carrying two or
 * three coincident walls everywhere.
 *
 * Implementation note: the pairwise scan this replaces was O(n²) on the main
 * thread and froze the UI for seconds on a dense commercial sheet. Candidates
 * are now bucketed in a spatial hash keyed on BOTH endpoints quantized to
 * `tolerance`, which makes the scan ~O(n).
 *
 * The subtle part: two coordinates a hair either side of a cell boundary (say
 * 0.9999·tolerance and 1.0001·tolerance) are within tolerance of each other but
 * land in ADJACENT buckets. Probing only the exact bucket would silently stop
 * deduping those pairs and change the output, so every probe sweeps the full
 * ±1 neighbourhood in each of the four coordinates. Results are therefore
 * identical to the pairwise scan, including the reversed-endpoint match.
 */
export function dedupeSegments(segments: VectorSegment[], tolerance = 0.0008): VectorSegment[] {
  // The legacy signature never caps — its behaviour is exactly the old scan.
  return dedupeSegmentsWithReport(segments, { tolerance, maxSegments: Infinity }).segments;
}

/**
 * `dedupeSegments` plus an honest account of whether the sheet was traced.
 *
 * A sheet denser than `maxSegments` is REFUSED, not truncated: `segments` comes
 * back empty with `capped: true` and a `notice` to show the user. A partial
 * trace is indistinguishable from a complete one once it is on the canvas, and
 * this platform's output ends up on permit applications — half a floor plan
 * that looks whole is worse than an explicit refusal.
 */
export function dedupeSegmentsWithReport(
  segments: VectorSegment[],
  options: DedupeOptions = {},
): DedupeReport {
  const tolerance = options.tolerance ?? 0.0008;
  const maxSegments = options.maxSegments ?? MAX_TRACEABLE_SEGMENTS;
  const inputCount = segments.length;

  if (inputCount > maxSegments) {
    return {
      segments: [],
      inputCount,
      keptCount: 0,
      capped: true,
      notice:
        `This sheet is too dense to trace: it holds ${groupDigits(inputCount)} vector runs, ` +
        `beyond the ${groupDigits(maxSegments)} this tracer converts. Nothing was traced — ` +
        `no geometry has been dropped or partially converted. Try a single-floor sheet, or a ` +
        `plot with the hatching and detail layers turned off.`,
    };
  }

  const near = (a: number, b: number) => Math.abs(a - b) <= tolerance;
  // Cell width == tolerance, so two segments sharing a cell are within tolerance
  // on all four coordinates and are therefore duplicates: a bucket holds at most
  // one survivor, which is what bounds the per-segment work.
  const cell = tolerance > 0 && Number.isFinite(tolerance) ? tolerance : 0;
  const q = (v: number) => (cell > 0 ? Math.floor(v / cell) : v);
  const OFFSETS = cell > 0 ? [-1, 0, 1] : [0];

  // Two levels: the outer map is keyed by the START endpoint's cell, the inner
  // by the END endpoint's cell. The outer level is where the ±1 sweep usually
  // misses outright, so the inner sweep runs only on the rare cells that hold
  // anything — that is what keeps the constant factor small enough to stay off
  // the UI thread's critical path.
  const index = new Map<string, Map<string, VectorSegment[]>>();
  const out: VectorSegment[] = [];

  // A cell holds at most one survivor (see above), so the inner list is tiny and
  // this stays O(1) per probe even on a degenerate fan of coincident endpoints.
  const collides = (a: number, b: number, c: number, d: number, s: VectorSegment) => {
    for (const da of OFFSETS) {
      for (const db of OFFSETS) {
        const inner = index.get(`${a + da}|${b + db}`);
        if (!inner) continue;
        for (const dc of OFFSETS) {
          for (const dd of OFFSETS) {
            const hits = inner.get(`${c + dc}|${d + dd}`);
            if (!hits) continue;
            for (const o of hits) {
              if (
                (near(o.x1, s.x1) && near(o.y1, s.y1) && near(o.x2, s.x2) && near(o.y2, s.y2)) ||
                (near(o.x1, s.x2) && near(o.y1, s.y2) && near(o.x2, s.x1) && near(o.y2, s.y1))
              ) return true;
            }
          }
        }
      }
    }
    return false;
  };

  for (const s of segments) {
    const kx1 = q(s.x1), ky1 = q(s.y1), kx2 = q(s.x2), ky2 = q(s.y2);
    // Forward: a stored run starting near s's start. Reversed: one starting near
    // s's end. Together these cover both arms of the pairwise predicate.
    if (collides(kx1, ky1, kx2, ky2, s) || collides(kx2, ky2, kx1, ky1, s)) continue;

    out.push(s);
    const outerKey = `${kx1}|${ky1}`;
    let inner = index.get(outerKey);
    if (!inner) { inner = new Map(); index.set(outerKey, inner); }
    const innerKey = `${kx2}|${ky2}`;
    const bucket = inner.get(innerKey);
    if (bucket) bucket.push(s);
    else inner.set(innerKey, [s]);
  }

  return { segments: out, inputCount, keptCount: out.length, capped: false, notice: null };
}

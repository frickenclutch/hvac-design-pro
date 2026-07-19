import type { WallSegment, DetectedRoom } from '../features/cad/store/useCadStore';

// Geometry-true blueprint takeoff. Maps AI-extracted room outlines (normalized
// image coordinates) through the underlay's canvas placement into real CAD
// geometry, so walls land ON the drawing's own lines instead of an invented
// packed layout. Printed dimension strings stay the truth for LOADS (Manual J
// inputs); the polygon is the truth for POSITION. The two meet in the sheet's
// implied scale: median(polygon-size-in-px / printed-size-in-ft) per sheet,
// which lets the takeoff auto-calibrate the underlay so traced geometry reads
// in true feet at the project scale — the same outcome as manual Calibrate
// Scale, derived from the dimension strings the model already reads.
//
// Pure functions only — no store access, no side effects beyond randomUUID
// for entity ids (same precedent as manualJToCad).

export interface NormalizedPoint {
  x: number;
  y: number;
}

// The subset of UnderlayImage the mapper needs. rotation is fabric `angle`
// semantics: degrees clockwise about the rect's top-left corner (x, y).
export interface UnderlayRect {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
}

export interface GeometryRoom {
  name: string;
  /** Printed long dimension in feet — truth for loads, cross-check for geometry. */
  lengthFt: number;
  /** Printed short dimension in feet. */
  widthFt: number;
  wallRValue: number;
  confidence: 'high' | 'medium' | 'low';
  /** Sanitized outline, normalized [0,1] to the source sheet, y down. */
  polygon: NormalizedPoint[];
  /** Index into the underlay rect list this polygon was traced on. */
  imageIndex: number;
}

export interface UnderlayPatch {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RoomPolygon {
  name: string;
  points: Array<{ x: number; y: number }>;
}

export interface GeometryTakeoffResult {
  walls: WallSegment[];
  rooms: DetectedRoom[];
  /** Final rectified outlines in canvas px — drives the ghost preview. */
  roomPolygons: RoomPolygon[];
  /** Auto-scale placement changes for the source sheets (empty when applyScale=false or scale already true). */
  underlayPatches: UnderlayPatch[];
  /** Median px-per-foot the sheets currently imply from printed dims (pre-scaling), null when underivable. */
  impliedPxPerFt: number | null;
  /** Reviewer-facing notes: dimension mismatches, dropped outlines, unscalable sheets. */
  warnings: string[];
}

// Tolerances (feet are converted at the project scale where needed)
const ANGLE_TOL_TAN = Math.tan((10 * Math.PI) / 180); // edges within 10° of an axis snap orthogonal
const SNAP_TOL_FT = 0.5;      // wall lines within 6" cluster onto one line
const MERGE_GAP_FT = 0.25;    // collinear wall runs within 3" merge into one segment
const MIN_EDGE_FT = 0.15;     // shorter edges collapse (tracing noise)
const DIM_MISMATCH_FRAC = 0.15; // drawn-vs-printed disagreement worth flagging
const MAX_POLYGON_POINTS = 32;
const SCALE_FACTOR_MIN = 0.05; // sanity band — an implied scale outside this is a misread, not a calibration
const SCALE_FACTOR_MAX = 100;

/** Clamp/validate a model-proposed outline. Returns null when unusable. */
export function sanitizePolygon(raw: Array<{ x: number; y: number }> | undefined): NormalizedPoint[] | null {
  if (!Array.isArray(raw) || raw.length < 3) return null;
  const pts: NormalizedPoint[] = [];
  for (const p of raw.slice(0, MAX_POLYGON_POINTS)) {
    // A non-finite vertex means the trace is corrupt, not merely noisy —
    // reject the whole outline rather than silently closing the gap into a
    // different shape (same standard as the out-of-frame rule below).
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
    // Slight out-of-frame overshoot is tracing noise at the sheet edge; far
    // out-of-frame means the model lost the coordinate system entirely.
    if (p.x < -0.1 || p.x > 1.1 || p.y < -0.1 || p.y > 1.1) return null;
    const x = Math.min(1, Math.max(0, p.x));
    const y = Math.min(1, Math.max(0, p.y));
    const prev = pts[pts.length - 1];
    if (prev && Math.abs(prev.x - x) < 1e-4 && Math.abs(prev.y - y) < 1e-4) continue;
    pts.push({ x, y });
  }
  // Drop a closing vertex that duplicates the first — edges close implicitly.
  if (pts.length >= 2) {
    const first = pts[0];
    const last = pts[pts.length - 1];
    if (Math.abs(first.x - last.x) < 1e-4 && Math.abs(first.y - last.y) < 1e-4) pts.pop();
  }
  return pts.length >= 3 ? pts : null;
}

interface Pt {
  x: number;
  y: number;
}

/** Rotate-and-place: normalized sheet coords → canvas px through a rect. */
function mapPoint(p: NormalizedPoint, u: UnderlayRect): Pt {
  const lx = p.x * u.width;
  const ly = p.y * u.height;
  const th = (u.rotation * Math.PI) / 180;
  const cos = Math.cos(th);
  const sin = Math.sin(th);
  return { x: u.x + lx * cos - ly * sin, y: u.y + lx * sin + ly * cos };
}

/** Median of a non-empty list. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// Implied px-per-foot samples for one room: polygon bbox measured in the
// sheet's unrotated pixel frame against the printed dims, long-to-long and
// short-to-short. Rotation never changes lengths, so the local frame is exact.
function impliedScaleSamples(room: GeometryRoom, u: UnderlayRect): number[] {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of room.polygon) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  }
  const bw = (maxX - minX) * u.width;
  const bh = (maxY - minY) * u.height;
  const longPx = Math.max(bw, bh);
  const shortPx = Math.min(bw, bh);
  const longFt = Math.max(room.lengthFt, room.widthFt);
  const shortFt = Math.min(room.lengthFt, room.widthFt);
  // A collapsed or collinear outline (zero-width bbox) is about to be dropped
  // in cleanup — it must not first vote on the scale that every surviving room
  // is placed at.
  if (!(shortPx > 0) || !(longPx > 0)) return [];
  const samples: number[] = [];
  // Model-supplied dims are untrusted: a denormal or absurd value would push
  // the ratio to Infinity/0 and poison the median for every other room.
  const ok = (v: number) => Number.isFinite(v) && v > 0;
  if (longFt > 0 && longPx > 0 && ok(longPx / longFt)) samples.push(longPx / longFt);
  if (shortFt > 0 && shortPx > 0 && ok(shortPx / shortFt)) samples.push(shortPx / shortFt);
  return samples;
}

// 1-D clustering by GAP, not by distance from the cluster's first element.
// Anchoring on the start value strands near-identical lines on opposite sides
// of a boundary: with tol=20, the values 400 / 419.6 / 420.4 split as
// {400, 419.6} and {420.4} — so two walls traced 0.8px apart end up on
// different lines while an unrelated wall 19.6px away gets merged in. Cutting
// where consecutive sorted values differ by more than tol keeps
// nearly-coincident lines together, which is the whole point of the pass.
function clusterSnap(entries: Array<{ value: number; assign: (v: number) => void }>, tol: number): void {
  if (entries.length === 0) return;
  const sorted = [...entries].sort((a, b) => a.value - b.value);
  let start = 0;
  const flush = (end: number) => {
    const cluster = sorted.slice(start, end);
    const mean = cluster.reduce((s, e) => s + e.value, 0) / cluster.length;
    cluster.forEach(e => e.assign(mean));
  };
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].value - sorted[i - 1].value > tol) {
      flush(i);
      start = i;
    }
  }
  flush(sorted.length);
}

type EdgeClass = 'h' | 'v' | 'diag';

function classifyEdge(a: Pt, b: Pt): EdgeClass {
  const dx = Math.abs(b.x - a.x);
  const dy = Math.abs(b.y - a.y);
  if (dy <= dx * ANGLE_TOL_TAN) return 'h';
  if (dx <= dy * ANGLE_TOL_TAN) return 'v';
  return 'diag';
}

/** Shoelace area in px² (absolute). */
function polygonArea(pts: Pt[]): number {
  let sum = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

export function buildGeometryTakeoff(
  rooms: GeometryRoom[],
  underlays: UnderlayRect[],
  pxPerFt: number,
  opts: { applyScale: boolean },
): GeometryTakeoffResult {
  const warnings: string[] = [];
  const usable = rooms.filter(r => {
    // Must be a real array index: a fractional value passes a bare range check
    // and then reads `underlays[0.5]` as undefined, crashing the mapper.
    if (Number.isInteger(r.imageIndex) && r.imageIndex >= 0 && r.imageIndex < underlays.length) return true;
    warnings.push(`${r.name}: outline referenced a sheet that is no longer on this floor — added to Manual J only.`);
    return false;
  });

  // ── 1. Implied scale per sheet, from printed dims ─────────────────────────
  const sheetSamples = new Map<number, number[]>();
  const allSamples: number[] = [];
  for (const room of usable) {
    if (room.confidence === 'low') continue; // guessed dims don't get to set the scale
    const samples = impliedScaleSamples(room, underlays[room.imageIndex]);
    if (samples.length === 0) continue;
    const list = sheetSamples.get(room.imageIndex) ?? [];
    list.push(...samples);
    sheetSamples.set(room.imageIndex, list);
    allSamples.push(...samples);
  }
  const globalImpliedRaw = allSamples.length > 0 ? median(allSamples) : null;
  const globalImplied = globalImpliedRaw !== null && Number.isFinite(globalImpliedRaw) && globalImpliedRaw > 0
    ? globalImpliedRaw
    : null;

  // ── 2. Scale factors + re-tiled sheet rects ───────────────────────────────
  const factors = new Map<string, number>();
  for (const [idx, u] of underlays.entries()) {
    let factor = 1;
    if (opts.applyScale) {
      const samples = sheetSamples.get(idx);
      const implied = samples && samples.length > 0 ? median(samples) : globalImplied;
      if (implied !== null && implied > 0) {
        const f = pxPerFt / implied;
        if (f >= SCALE_FACTOR_MIN && f <= SCALE_FACTOR_MAX) {
          factor = f;
        } else {
          warnings.push(`Sheet ${idx + 1} implies an implausible scale (${implied.toFixed(1)} px/ft) — left unscaled; check the printed dimensions.`);
        }
      }
    }
    factors.set(u.id, factor);
  }

  const anyScaled = [...factors.values()].some(f => Math.abs(f - 1) > 1e-6);
  const effectiveRects: UnderlayRect[] = [];
  const underlayPatches: UnderlayPatch[] = [];
  if (anyScaled) {
    // Scale each sheet about its own top-left, then re-run the import tiling
    // (left-to-right in original x order, 40px gaps) so grown sheets never
    // overlap their neighbors. Polygons map through these SAME rects, so walls
    // stay glued to their sheet's drawing wherever it lands.
    const order = [...underlays.keys()].sort((a, b) => underlays[a].x - underlays[b].x);
    const placed = new Map<number, UnderlayRect>();
    let cursorX: number | null = null;
    for (const idx of order) {
      const u = underlays[idx];
      const k = factors.get(u.id) ?? 1;
      const w = u.width * k;
      const h = u.height * k;
      // Rotation is about the rect's TOP-LEFT, so a rotated sheet's visible
      // box is offset from its anchor — at 90° it extends entirely to the
      // LEFT of it. Position by the box, not the anchor: place the box's left
      // edge at the cursor and advance by the box's true width, otherwise a
      // rotated sheet lands back on top of its neighbor.
      const th = (u.rotation * Math.PI) / 180;
      const cos = Math.cos(th);
      const sin = Math.sin(th);
      const cornerDx = [0, w * cos, w * cos - h * sin, -h * sin];
      const minDx = Math.min(...cornerDx);
      const extentX = Math.max(...cornerDx) - minDx;
      const boxLeft: number = cursorX === null ? u.x + minDx : cursorX;
      const rect: UnderlayRect = { id: u.id, x: boxLeft - minDx, y: u.y, width: w, height: h, rotation: u.rotation };
      placed.set(idx, rect);
      cursorX = boxLeft + extentX + 40;
      underlayPatches.push({ id: rect.id, x: rect.x, y: rect.y, width: rect.width, height: rect.height });
    }
    for (const [idx, u] of underlays.entries()) effectiveRects[idx] = placed.get(idx) ?? u;
  } else {
    effectiveRects.push(...underlays);
  }

  // Every foot-denominated tolerance below must be expressed in the pixel
  // scale the MAPPED GEOMETRY actually sits at. With applyScale the sheets are
  // rescaled so that is the project scale; without it the geometry is still at
  // the sheet's implied scale, and using pxPerFt there would inflate every
  // tolerance by the ratio between them (a 4× over-aggressive snap on a sheet
  // reading 10 px/ft against a 40 px/ft project).
  const geometryPxPerFt = anyScaled ? pxPerFt : (globalImplied ?? pxPerFt);

  // ── 3. Map + rectify each polygon ─────────────────────────────────────────
  interface RectifiedRoom {
    room: GeometryRoom;
    pts: Pt[];
  }
  const rectified: RectifiedRoom[] = [];
  for (const room of usable) {
    const rect = effectiveRects[room.imageIndex];
    const pts = room.polygon.map(p => mapPoint(p, rect));

    // Pass a: square-up edges that are within tolerance of an axis. Classify
    // EVERY edge against the original mapped geometry before moving anything —
    // classifying as we mutate would let edge i's correction change how edge
    // i+1 is judged, making the result depend on winding and start vertex.
    // Each edge then owns exactly one coordinate (H→y, V→x), so a corner
    // vertex shared by an H and a V edge is never fought over.
    const n = pts.length;
    const classes: EdgeClass[] = [];
    for (let i = 0; i < n; i++) classes.push(classifyEdge(pts[i], pts[(i + 1) % n]));
    for (let i = 0; i < n; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % n];
      if (classes[i] === 'h') {
        const y = (a.y + b.y) / 2;
        a.y = y; b.y = y;
      } else if (classes[i] === 'v') {
        const x = (a.x + b.x) / 2;
        a.x = x; b.x = x;
      }
    }
    rectified.push({ room, pts });
  }

  // Pass b: cluster wall lines across rooms (per sheet) so shared walls land
  // on ONE line. A coordinate is structural — eligible to snap — only when an
  // incident edge locks it (x on a vertical edge, y on a horizontal edge);
  // positions ALONG a wall never snap sideways.
  const snapTol = SNAP_TOL_FT * geometryPxPerFt;
  const bySheet = new Map<number, RectifiedRoom[]>();
  for (const rr of rectified) {
    const list = bySheet.get(rr.room.imageIndex) ?? [];
    list.push(rr);
    bySheet.set(rr.room.imageIndex, list);
  }
  for (const group of bySheet.values()) {
    const xEntries: Array<{ value: number; assign: (v: number) => void }> = [];
    const yEntries: Array<{ value: number; assign: (v: number) => void }> = [];
    for (const { pts } of group) {
      const n = pts.length;
      for (let i = 0; i < n; i++) {
        const v = pts[i];
        const prev = pts[(i - 1 + n) % n];
        const next = pts[(i + 1) % n];
        const clsIn = classifyEdge(prev, v);
        const clsOut = classifyEdge(v, next);
        if (clsIn === 'v' || clsOut === 'v') xEntries.push({ value: v.x, assign: nv => { v.x = nv; } });
        if (clsIn === 'h' || clsOut === 'h') yEntries.push({ value: v.y, assign: nv => { v.y = nv; } });
      }
    }
    clusterSnap(xEntries, snapTol);
    clusterSnap(yEntries, snapTol);
  }

  // Pass c: collapse edges that shrank below drawable length, then re-check
  // the polygon still encloses something.
  const minEdge = MIN_EDGE_FT * geometryPxPerFt;
  const finalRooms: RectifiedRoom[] = [];
  for (const { room, pts } of rectified) {
    const cleaned: Pt[] = [];
    for (const p of pts) {
      const prev = cleaned[cleaned.length - 1];
      if (prev && Math.hypot(p.x - prev.x, p.y - prev.y) < minEdge) continue;
      cleaned.push(p);
    }
    while (cleaned.length >= 2 && Math.hypot(
      cleaned[0].x - cleaned[cleaned.length - 1].x,
      cleaned[0].y - cleaned[cleaned.length - 1].y,
    ) < minEdge) cleaned.pop();
    if (cleaned.length < 3 || polygonArea(cleaned) < (minEdge * minEdge)) {
      warnings.push(`${room.name}: traced outline collapsed during cleanup — added to Manual J only.`);
      continue;
    }
    finalRooms.push({ room, pts: cleaned });
  }

  // ── 4. Cross-check drawn footprint vs printed dims ────────────────────────
  for (const { room, pts } of finalRooms) {
    const rect = effectiveRects[room.imageIndex];
    // AABB is meaningless on a rotated sheet. Measure the distance to the
    // nearest multiple of 360 so a hair of negative rotation (-0.5° → 359.5)
    // still counts as unrotated instead of silently skipping the check.
    const norm = ((rect.rotation % 360) + 360) % 360;
    if (Math.min(norm, 360 - norm) > 1) continue;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of pts) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
    const drawnLong = Math.max(maxX - minX, maxY - minY) / geometryPxPerFt;
    const drawnShort = Math.min(maxX - minX, maxY - minY) / geometryPxPerFt;
    const statedLong = Math.max(room.lengthFt, room.widthFt);
    const statedShort = Math.min(room.lengthFt, room.widthFt);
    const off = (drawn: number, stated: number) => stated > 0 && Math.abs(drawn - stated) / stated > DIM_MISMATCH_FRAC;
    if (off(drawnLong, statedLong) || off(drawnShort, statedShort)) {
      warnings.push(
        `${room.name}: drawn footprint ≈ ${drawnLong.toFixed(1)} × ${drawnShort.toFixed(1)} ft but printed dimensions say ` +
        `${statedLong.toFixed(1)} × ${statedShort.toFixed(1)} ft — verify against the plan.`,
      );
    }
  }

  // ── 5. Walls: merge collinear runs so shared walls become one segment ─────
  interface EdgeRef {
    roomIdx: number;
    a: Pt;
    b: Pt;
    cls: EdgeClass;
  }
  const edges: EdgeRef[] = [];
  finalRooms.forEach(({ pts }, roomIdx) => {
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % n];
      edges.push({ roomIdx, a, b, cls: classifyEdge(a, b) });
    }
  });

  const mergeGap = MERGE_GAP_FT * geometryPxPerFt;
  const walls: WallSegment[] = [];
  const roomWallIds: Array<Set<string>> = finalRooms.map(() => new Set<string>());
  const wallDefaults = (roomIdx: number) => ({
    thicknessIn: 6,
    rValue: finalRooms[roomIdx].room.wallRValue,
    material: 'insulated_stud' as const,
    fabricId: '',
  });

  // Axis-aligned edges: group by exact line (post-clustering coincident walls
  // share the line coordinate to the pixel), merge overlapping intervals.
  for (const axis of ['h', 'v'] as const) {
    const groups = new Map<string, EdgeRef[]>();
    for (const e of edges) {
      if (e.cls !== axis) continue;
      const line = axis === 'h' ? (e.a.y + e.b.y) / 2 : (e.a.x + e.b.x) / 2;
      // Post-snap coincident lines are exactly equal; quantize at half the
      // merge gap so float dust still lands in one bucket.
      const key = Math.round(line / (mergeGap / 2)).toString();
      const list = groups.get(key) ?? [];
      list.push(e);
      groups.set(key, list);
    }
    for (const group of groups.values()) {
      const line = group.reduce((s, e) => s + (axis === 'h' ? (e.a.y + e.b.y) / 2 : (e.a.x + e.b.x) / 2), 0) / group.length;
      const intervals = group
        .map(e => {
          const s = axis === 'h' ? Math.min(e.a.x, e.b.x) : Math.min(e.a.y, e.b.y);
          const t = axis === 'h' ? Math.max(e.a.x, e.b.x) : Math.max(e.a.y, e.b.y);
          return { s, t, e };
        })
        .sort((p, q) => p.s - q.s);
      let runStart = intervals[0].s;
      let runEnd = intervals[0].t;
      let members = [intervals[0].e];
      const flushRun = () => {
        const w: WallSegment = axis === 'h'
          ? { id: crypto.randomUUID(), x1: runStart, y1: line, x2: runEnd, y2: line, ...wallDefaults(members[0].roomIdx) }
          : { id: crypto.randomUUID(), x1: line, y1: runStart, x2: line, y2: runEnd, ...wallDefaults(members[0].roomIdx) };
        walls.push(w);
        members.forEach(m => roomWallIds[m.roomIdx].add(w.id));
      };
      for (let i = 1; i < intervals.length; i++) {
        const iv = intervals[i];
        if (iv.s <= runEnd + mergeGap) {
          runEnd = Math.max(runEnd, iv.t);
          members.push(iv.e);
        } else {
          flushRun();
          runStart = iv.s;
          runEnd = iv.t;
          members = [iv.e];
        }
      }
      flushRun();
    }
  }

  // Diagonal edges: dedupe exact coincident pairs (a shared angled wall), else
  // each edge is its own wall.
  const diagWalls: Array<{ w: WallSegment; a: Pt; b: Pt }> = [];
  for (const e of edges) {
    if (e.cls !== 'diag') continue;
    const twin = diagWalls.find(d =>
      (Math.hypot(d.a.x - e.a.x, d.a.y - e.a.y) < mergeGap && Math.hypot(d.b.x - e.b.x, d.b.y - e.b.y) < mergeGap) ||
      (Math.hypot(d.a.x - e.b.x, d.a.y - e.b.y) < mergeGap && Math.hypot(d.b.x - e.a.x, d.b.y - e.a.y) < mergeGap),
    );
    if (twin) {
      roomWallIds[e.roomIdx].add(twin.w.id);
      continue;
    }
    const w: WallSegment = { id: crypto.randomUUID(), x1: e.a.x, y1: e.a.y, x2: e.b.x, y2: e.b.y, ...wallDefaults(e.roomIdx) };
    walls.push(w);
    roomWallIds[e.roomIdx].add(w.id);
    diagWalls.push({ w, a: e.a, b: e.b });
  }

  // ── 6. Detected rooms from the final outlines ─────────────────────────────
  const detectedRooms: DetectedRoom[] = finalRooms.map(({ room, pts }, roomIdx) => {
    const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
    const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    let perimeterPx = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      perimeterPx += Math.hypot(b.x - a.x, b.y - a.y);
    }
    return {
      id: crypto.randomUUID(),
      name: room.name,
      wallIds: [...roomWallIds[roomIdx]],
      areaSqFt: polygonArea(pts) / (geometryPxPerFt * geometryPxPerFt),
      perimeterFt: perimeterPx / geometryPxPerFt,
      centroid: { x: cx, y: cy },
      color: '#34d399',
    };
  });

  return {
    walls,
    rooms: detectedRooms,
    roomPolygons: finalRooms.map(({ room, pts }) => ({ name: room.name, points: pts.map(p => ({ x: p.x, y: p.y })) })),
    underlayPatches,
    impliedPxPerFt: globalImplied,
    warnings,
  };
}

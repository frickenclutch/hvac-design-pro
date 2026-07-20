/**
 * HVAC DesignPro — Duct → Room Assignment
 *
 * Decides which detected room each drawn duct segment serves, so that
 * `cadToManualD.measureCadDucts` has something to measure. Without this the
 * `roomId` field on a DuctSegment is never populated and every drawn run is
 * silently discarded as "unassigned", which is what made drawn ducts inert.
 *
 * The governing rule is honesty, not coverage. A run that cannot be placed with
 * confidence is left UNASSIGNED. An unassigned run falls back to Manual D's
 * documented length estimate, which is an acknowledged approximation; a run
 * attributed to the wrong room silently corrupts that room's total effective
 * length and undersizes real duct on a permit document. Guessing is the worse
 * failure, so this module never guesses.
 *
 * Pure module: no store access, no DOM, no I/O. All geometry is in canvas px,
 * the same ruler the rest of the CAD surface uses.
 */

export interface Point2D {
  x: number;
  y: number;
}

/** The duct-segment shape this engine needs. `DuctSegment` satisfies it. */
export interface AssignableSegment {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  roomId?: string;
  /** Set by the properties panel. Auto-assignment must never overwrite it. */
  roomAssignedManually?: boolean;
}

/** The room shape this engine needs. `DetectedRoom` satisfies it. */
export interface AssignableRoom {
  id: string;
  /** Ordered outline in canvas px. Absent on drawings saved before room
   *  detection began persisting it — those rooms use the centroid fallback. */
  polygon?: Point2D[];
  centroid?: Point2D;
  areaSqFt?: number;
}

export interface DuctRoomAssignOptions {
  /**
   * How close two endpoints must be to count as the same joint. Duct chains are
   * drawn on the snap grid so shared endpoints are usually exact; the tolerance
   * absorbs float drift and off-grid clicks.
   */
  joinTolerancePx?: number;
  /**
   * Canvas scale. Used only to size the legacy centroid fallback radius against
   * each room's real area, so the radius scales with the room rather than being
   * a fixed number of pixels that means different things at different scales.
   */
  pxPerFt?: number;
  /** Hard override for the centroid fallback radius, in px. */
  centroidRadiusPx?: number;
}

const DEFAULT_JOIN_TOLERANCE_PX = 2;

/**
 * Fallback radius when the room's area is unknown and no override was given.
 * Deliberately small: an out-of-range duct stays unassigned, which is safe.
 */
const DEFAULT_CENTROID_RADIUS_PX = 120;

/**
 * Fraction of a room's characteristic dimension (√area) within which a duct is
 * accepted as belonging to that room's centroid. Below 1.0 so a duct out in a
 * corridor beyond the room's own footprint is refused rather than absorbed.
 */
const CENTROID_RADIUS_FRACTION = 0.75;

const isFinitePoint = (p: Point2D | undefined | null): p is Point2D =>
  !!p && Number.isFinite(p.x) && Number.isFinite(p.y);

/**
 * Standard even-odd ray casting. Returns false for any polygon that cannot
 * enclose area (fewer than 3 usable vertices) rather than throwing. Works on
 * self-intersecting outlines — even-odd is defined for them, it just treats
 * doubly-wound regions as outside, which is an acceptable, non-throwing answer.
 */
export function pointInPolygon(pt: Point2D, polygon: readonly Point2D[]): boolean {
  if (!isFinitePoint(pt) || !Array.isArray(polygon) || polygon.length < 3) return false;
  const pts = polygon.filter(isFinitePoint);
  if (pts.length < 3) return false;

  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const { x: xi, y: yi } = pts[i];
    const { x: xj, y: yj } = pts[j];
    // The straddle test guarantees yj !== yi, so the division is safe.
    const straddles = yi > pt.y !== yj > pt.y;
    if (straddles && pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** Shoelace area in px². Zero for degenerate outlines. */
function polygonAreaPx(pts: readonly Point2D[]): number {
  if (pts.length < 3) return 0;
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p1 = pts[i];
    const p2 = pts[(i + 1) % pts.length];
    a += p1.x * p2.y - p2.x * p1.y;
  }
  return Math.abs(a) / 2;
}

interface PreparedRoom {
  id: string;
  polygon: Point2D[] | null;
  areaPx: number;
  centroid: Point2D | null;
  centroidRadiusPx: number;
}

function prepareRooms(
  rooms: readonly AssignableRoom[],
  opts: DuctRoomAssignOptions,
): PreparedRoom[] {
  const prepared: PreparedRoom[] = [];
  for (const room of rooms) {
    if (!room || typeof room.id !== 'string' || !room.id) continue;

    const pts = Array.isArray(room.polygon) ? room.polygon.filter(isFinitePoint) : [];
    const polygon = pts.length >= 3 ? pts : null;

    let radius = DEFAULT_CENTROID_RADIUS_PX;
    if (Number.isFinite(opts.centroidRadiusPx) && (opts.centroidRadiusPx as number) > 0) {
      radius = opts.centroidRadiusPx as number;
    } else if (
      Number.isFinite(opts.pxPerFt) && (opts.pxPerFt as number) > 0 &&
      Number.isFinite(room.areaSqFt) && (room.areaSqFt as number) > 0
    ) {
      radius =
        Math.sqrt(room.areaSqFt as number) * (opts.pxPerFt as number) * CENTROID_RADIUS_FRACTION;
    }

    prepared.push({
      id: room.id,
      polygon,
      areaPx: polygon ? polygonAreaPx(polygon) : 0,
      centroid: isFinitePoint(room.centroid) ? room.centroid : null,
      centroidRadiusPx: radius,
    });
  }
  return prepared;
}

/**
 * Smallest room whose outline contains the point, or null. Smallest wins
 * because a containing room nested inside another (a closet within a suite) is
 * the more specific — and therefore more correct — attribution.
 */
function containingRoom(pt: Point2D, rooms: readonly PreparedRoom[]): PreparedRoom | null {
  let best: PreparedRoom | null = null;
  for (const room of rooms) {
    if (!room.polygon) continue;
    if (!pointInPolygon(pt, room.polygon)) continue;
    if (!best || room.areaPx < best.areaPx) best = room;
  }
  return best;
}

/**
 * Nearest polygon-less room whose centroid is within its own radius, or null.
 * Scoped to polygon-less rooms on purpose: a room that HAS an outline already
 * gave a definitive containment answer, and proximity must not be allowed to
 * override that.
 */
function nearestCentroidRoom(pt: Point2D, rooms: readonly PreparedRoom[]): PreparedRoom | null {
  let best: PreparedRoom | null = null;
  let bestDist = Infinity;
  for (const room of rooms) {
    if (room.polygon || !room.centroid) continue;
    const d = Math.hypot(pt.x - room.centroid.x, pt.y - room.centroid.y);
    if (!Number.isFinite(d) || d > room.centroidRadiusPx) continue;
    if (d < bestDist) {
      bestDist = d;
      best = room;
    }
  }
  return best;
}

function resolvePoint(pt: Point2D, rooms: readonly PreparedRoom[]): PreparedRoom | null {
  return containingRoom(pt, rooms) ?? nearestCentroidRoom(pt, rooms);
}

/**
 * Decide which duct endpoints are TERMINAL — not shared with another segment.
 *
 * A supply run's register end is its terminal endpoint: the far end of the
 * branch, sitting in the room it actually serves. The upstream end sits at a
 * trunk joint that is frequently in a hallway or mechanical chase and would
 * attribute the run to the wrong room.
 */
function terminalFlags(
  segments: readonly AssignableSegment[],
  tolerance: number,
): Map<string, [boolean, boolean]> {
  const flags = new Map<string, [boolean, boolean]>();
  const tol2 = tolerance * tolerance;

  const near = (ax: number, ay: number, bx: number, by: number): boolean => {
    const dx = ax - bx;
    const dy = ay - by;
    return dx * dx + dy * dy <= tol2;
  };

  for (const seg of segments) {
    let sharedA = false;
    let sharedB = false;
    for (const other of segments) {
      if (other.id === seg.id) continue;
      if (
        near(seg.x1, seg.y1, other.x1, other.y1) ||
        near(seg.x1, seg.y1, other.x2, other.y2)
      ) sharedA = true;
      if (
        near(seg.x2, seg.y2, other.x1, other.y1) ||
        near(seg.x2, seg.y2, other.x2, other.y2)
      ) sharedB = true;
      if (sharedA && sharedB) break;
    }
    flags.set(seg.id, [!sharedA, !sharedB]);
  }
  return flags;
}

/**
 * Resolve each auto-assignable duct segment to the room it serves.
 *
 * Segments already pinned by hand (`roomAssignedManually`) are excluded — the
 * designer's judgement outranks the geometry heuristic. Segments that resolve
 * to nothing are simply absent from the result.
 *
 * @returns segment id → room id, for resolved segments only
 */
export function assignDuctRooms(
  segments: readonly AssignableSegment[],
  rooms: readonly AssignableRoom[],
  options: DuctRoomAssignOptions = {},
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!Array.isArray(segments) || segments.length === 0) return out;
  if (!Array.isArray(rooms) || rooms.length === 0) return out;

  const prepared = prepareRooms(rooms, options);
  if (prepared.length === 0) return out;

  const tolerance =
    Number.isFinite(options.joinTolerancePx) && (options.joinTolerancePx as number) >= 0
      ? (options.joinTolerancePx as number)
      : DEFAULT_JOIN_TOLERANCE_PX;

  const usable = segments.filter(
    (s) =>
      !!s &&
      typeof s.id === 'string' &&
      Number.isFinite(s.x1) && Number.isFinite(s.y1) &&
      Number.isFinite(s.x2) && Number.isFinite(s.y2),
  );
  const flags = terminalFlags(usable, tolerance);

  for (const seg of usable) {
    if (seg.roomAssignedManually) continue;

    const a: Point2D = { x: seg.x1, y: seg.y1 };
    const b: Point2D = { x: seg.x2, y: seg.y2 };
    const [aTerminal, bTerminal] = flags.get(seg.id) ?? [true, true];

    const roomA = resolvePoint(a, prepared);
    const roomB = resolvePoint(b, prepared);

    let chosen: PreparedRoom | null;
    if (aTerminal !== bTerminal) {
      // Exactly one terminal end — that is the register end. Prefer it, and
      // only fall back to the upstream end when the terminal end is nowhere.
      const terminalRoom = aTerminal ? roomA : roomB;
      const otherRoom = aTerminal ? roomB : roomA;
      chosen = terminalRoom ?? otherRoom;
    } else if (!roomA || !roomB || roomA.id === roomB.id) {
      // No terminal signal, but no conflict either.
      chosen = roomA ?? roomB;
    } else {
      // Both ends land in different rooms with nothing to break the tie:
      // prefer the smaller (more specific) room.
      chosen = roomA.areaPx <= roomB.areaPx ? roomA : roomB;
    }

    if (chosen) out[seg.id] = chosen.id;
  }

  return out;
}

/**
 * Apply `assignDuctRooms` to a segment list.
 *
 * Object identity is preserved for every segment whose assignment did not
 * change, so callers can skip a state write (and the auto-save it triggers)
 * when `changed` is false. Manually pinned segments are returned untouched.
 */
export function applyDuctRoomAssignments<T extends AssignableSegment>(
  segments: readonly T[],
  rooms: readonly AssignableRoom[],
  options: DuctRoomAssignOptions = {},
): { segments: T[]; changed: boolean } {
  if (!Array.isArray(segments) || segments.length === 0) {
    return { segments: [], changed: false };
  }

  const assignments = assignDuctRooms(segments, rooms, options);
  let changed = false;

  const next = segments.map((seg) => {
    if (!seg || seg.roomAssignedManually) return seg;
    const resolved = assignments[seg.id];
    if (resolved === seg.roomId) return seg;
    // A previously auto-assigned room that no longer resolves is CLEARED
    // rather than left stale — the room it named may have been deleted or
    // redrawn, and a stale id would measure a run into a room that is gone.
    changed = true;
    return { ...seg, roomId: resolved } as T;
  });

  return changed ? { segments: next, changed } : { segments: [...segments], changed };
}

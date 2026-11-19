/**
 * Room detection — closed wall loops → room outlines.
 *
 * Pure geometry: takes wall centre-lines in canvas pixels and returns one entry
 * per enclosed region, each carrying the ids of the walls that bound it. Those
 * ids are what let the Manual J bridge find a room's R-values, its windows, and
 * which of its walls face outdoors, so a room without them reaches the load
 * calculation with no envelope at all.
 *
 * Method: wall endpoints that land within `snapPx` of each other are merged
 * into one node (kept at the mean of the real coordinates, never rounded), the
 * walls become edges of a planar graph, and every face of that graph is walked
 * once. Bounded faces are rooms; the unbounded outer face is discarded.
 *
 * Known limit (unchanged from the previous detector): walls are joined at their
 * ENDPOINTS only. A partition that ends on the middle of another wall does not
 * split it, so it dangles and encloses nothing.
 */

export interface RoomDetectWall {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface RoomOutline {
  /** Ids of the walls bounding this room, in walk order, without repeats. */
  wallIds: string[];
  /** Outline vertices in canvas px, at the walls' true (unrounded) corners. */
  polygon: { x: number; y: number }[];
  /** Enclosed area in px². */
  areaPx2: number;
  /** Length of the bounding walls in px. */
  perimeterPx: number;
  /** Area centroid in canvas px (vertex mean for a degenerate outline). */
  centroid: { x: number; y: number };
}

/** Endpoints closer than this are treated as the same corner. */
export const DEFAULT_SNAP_PX = 15;

interface Node {
  /** First endpoint that created the node — membership is measured from here. */
  seedX: number;
  seedY: number;
  sumX: number;
  sumY: number;
  count: number;
}

/**
 * Find every enclosed region formed by `walls`.
 * Rooms are returned top-to-bottom, then left-to-right, so numbering is stable
 * between runs on the same drawing.
 */
export function detectRoomOutlines(
  walls: readonly RoomDetectWall[],
  snapPx: number = DEFAULT_SNAP_PX,
): RoomOutline[] {
  if (walls.length < 3 || !(snapPx > 0)) return [];

  // ── 1. Merge endpoints into nodes (spatial hash, cell = snap distance) ──
  const nodes: Node[] = [];
  const cells = new Map<string, number[]>();
  const cellOf = (v: number) => Math.floor(v / snapPx);

  const nodeFor = (x: number, y: number): number => {
    const cx = cellOf(x);
    const cy = cellOf(y);
    let best = -1;
    let bestDist = snapPx;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const bucket = cells.get(`${cx + dx},${cy + dy}`);
        if (!bucket) continue;
        for (const idx of bucket) {
          const n = nodes[idx];
          const d = Math.hypot(n.seedX - x, n.seedY - y);
          if (d <= bestDist) { bestDist = d; best = idx; }
        }
      }
    }
    if (best >= 0) {
      const n = nodes[best];
      n.sumX += x; n.sumY += y; n.count += 1;
      return best;
    }
    const idx = nodes.length;
    nodes.push({ seedX: x, seedY: y, sumX: x, sumY: y, count: 1 });
    const key = `${cx},${cy}`;
    const bucket = cells.get(key);
    if (bucket) bucket.push(idx); else cells.set(key, [idx]);
    return idx;
  };

  // ── 2. Walls → undirected edges (parallel walls share one edge) ─────────
  const edgeKey = (a: number, b: number) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const edgeWalls = new Map<string, string[]>();
  const neighbours = new Map<number, Set<number>>();
  const link = (a: number, b: number) => {
    let set = neighbours.get(a);
    if (!set) { set = new Set(); neighbours.set(a, set); }
    set.add(b);
  };

  for (const w of walls) {
    if (![w.x1, w.y1, w.x2, w.y2].every(Number.isFinite)) continue;
    const a = nodeFor(w.x1, w.y1);
    const b = nodeFor(w.x2, w.y2);
    if (a === b) continue; // shorter than the snap distance — not a boundary
    const key = edgeKey(a, b);
    const ids = edgeWalls.get(key);
    if (ids) ids.push(w.id); else edgeWalls.set(key, [w.id]);
    link(a, b);
    link(b, a);
  }

  // ── 3. Prune dangling walls — a dead end cannot bound a room ────────────
  const queue: number[] = [];
  for (const [n, set] of neighbours) if (set.size === 1) queue.push(n);
  while (queue.length > 0) {
    const n = queue.pop()!;
    const set = neighbours.get(n);
    if (!set || set.size !== 1) continue;
    const [other] = set;
    neighbours.delete(n);
    const otherSet = neighbours.get(other);
    if (!otherSet) continue;
    otherSet.delete(n);
    if (otherSet.size === 1) queue.push(other);
    else if (otherSet.size === 0) neighbours.delete(other);
  }
  if (neighbours.size < 3) return [];

  const px = (i: number) => nodes[i].sumX / nodes[i].count;
  const py = (i: number) => nodes[i].sumY / nodes[i].count;

  // Neighbours of each node ordered by direction, for the face walk.
  const ordered = new Map<number, number[]>();
  for (const [n, set] of neighbours) {
    const list = [...set].sort((p, q) =>
      Math.atan2(py(p) - py(n), px(p) - px(n)) - Math.atan2(py(q) - py(n), px(q) - px(n)));
    ordered.set(n, list);
  }

  // ── 4. Walk every face exactly once ─────────────────────────────────────
  // Arriving at `v` from `u`, leave by the neighbour that follows `u` in
  // direction order. Each directed edge then belongs to exactly one face;
  // bounded faces come out with negative signed area, the outer face positive.
  const visited = new Set<string>();
  const outlines: RoomOutline[] = [];
  const directedCount = [...ordered.values()].reduce((s, l) => s + l.length, 0);
  const minArea = snapPx * snapPx;

  for (const [start, firstList] of ordered) {
    for (const first of firstList) {
      if (visited.has(`${start}>${first}`)) continue;

      const loop: number[] = [];
      let u = start;
      let v = first;
      let closed = false;
      for (let steps = 0; steps <= directedCount; steps++) {
        visited.add(`${u}>${v}`);
        loop.push(u);
        const list = ordered.get(v);
        if (!list || list.length === 0) break;
        const next = list[(list.indexOf(u) + 1) % list.length];
        u = v;
        v = next;
        if (u === start && v === first) { closed = true; break; }
      }
      if (!closed || loop.length < 3) continue;

      // Signed shoelace area and area centroid.
      let twiceArea = 0;
      let cxAcc = 0;
      let cyAcc = 0;
      for (let i = 0; i < loop.length; i++) {
        const a = loop[i];
        const b = loop[(i + 1) % loop.length];
        const cross = px(a) * py(b) - px(b) * py(a);
        twiceArea += cross;
        cxAcc += (px(a) + px(b)) * cross;
        cyAcc += (py(a) + py(b)) * cross;
      }
      const signedArea = twiceArea / 2;
      if (signedArea > -minArea) continue; // outer face, or a sliver

      // Bounding walls. An edge walked in both directions inside one face is a
      // wall standing INSIDE the room (a bridge), not part of its boundary.
      const timesWalked = new Map<string, number>();
      for (let i = 0; i < loop.length; i++) {
        const key = edgeKey(loop[i], loop[(i + 1) % loop.length]);
        timesWalked.set(key, (timesWalked.get(key) ?? 0) + 1);
      }
      const wallIds: string[] = [];
      const seenWall = new Set<string>();
      let perimeterPx = 0;
      for (let i = 0; i < loop.length; i++) {
        const a = loop[i];
        const b = loop[(i + 1) % loop.length];
        const key = edgeKey(a, b);
        if (timesWalked.get(key) !== 1) continue;
        perimeterPx += Math.hypot(px(b) - px(a), py(b) - py(a));
        for (const id of edgeWalls.get(key) ?? []) {
          if (!seenWall.has(id)) { seenWall.add(id); wallIds.push(id); }
        }
      }

      outlines.push({
        wallIds,
        polygon: loop.map(i => ({ x: px(i), y: py(i) })),
        areaPx2: -signedArea,
        perimeterPx,
        centroid: { x: cxAcc / (3 * twiceArea), y: cyAcc / (3 * twiceArea) },
      });
    }
  }

  // Stable reading order: rows of rooms top-to-bottom, left-to-right within one.
  return outlines.sort((a, b) =>
    Math.abs(a.centroid.y - b.centroid.y) > snapPx
      ? a.centroid.y - b.centroid.y
      : a.centroid.x - b.centroid.x);
}

import type {
  WallSegment,
  Opening,
  DetectedRoom,
  MeasureConfidence,
} from '../features/cad/store/useCadStore';
import type { ScanModel, ScanWall } from './roomScan';

// LiDAR scan → CAD geometry. The counterpart of blueprintToCad for measured
// (not traced) input, and deliberately simpler: RoomPlan hands us clean
// parametric walls in true feet, so there is NO implied-scale inference, no
// polygon rectification, and no dimension cross-check — the dimensions ARE the
// truth this platform is trying to protect. What remains is:
//
//   1. place the scan on the canvas (normalize → reviewer's north rotation →
//      project px scale),
//   2. merge the coincident wall pairs a multi-room capture produces (each
//      CapturedRoom carries its own copy of a shared wall) so partition
//      detection (orientation.ts exteriorWallIds) sees ONE wall claimed by
//      two rooms,
//   3. emit store-ready entities stamped provenance:'scan' so their measured
//      pedigree survives into review, reports, and the audit chain.
//
// Every entity keeps full decimal precision from the scan (CLAUDE.md §3 rule
// 7) — areas and perimeters are computed in FEET before any px conversion.
//
// Pure functions only — no store access, no side effects beyond
// crypto.randomUUID for entity ids (same precedent as blueprintToCad).

export interface ScanPlacement {
  /** Canvas px where the scan's bounding-box top-left lands. */
  originX: number;
  originY: number;
  /** Reviewer's north alignment, degrees clockwise. Canvas-up = North. */
  rotationDeg: number;
}

export interface ScanRoomPolygon {
  name: string;
  points: Array<{ x: number; y: number }>;
}

export interface ScanTakeoffResult {
  walls: WallSegment[];
  openings: Opening[];
  rooms: DetectedRoom[];
  /** Outlines in canvas px — drives the ghost preview. */
  roomPolygons: ScanRoomPolygon[];
  /** Scan-measured ceiling (median wall height). Reviewer chooses to apply. */
  ceilingHeightFt: number | null;
  /** How many coincident wall pairs melded into shared partitions. */
  mergedWallCount: number;
  warnings: string[];
}

// Two rooms' copies of one physical wall sit a wall-thickness apart at most;
// 0.7 ft covers a 2×6 wall plus scan jitter without eating real corridors.
export const SHARED_WALL_TOL_FT = 0.7;
/** Walls the scan measured but that cannot carry an R-value it knows. */
export const SCAN_DEFAULT_WALL_R = 13;
const SCAN_ROOM_COLOR = '#34d399';

interface Pt {
  x: number;
  y: number;
}

/** Shoelace area (absolute) in the units of the points. */
function polygonArea(pts: Pt[]): number {
  let sum = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

function perimeter(pts: Pt[]): number {
  let p = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    p += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return p;
}

/**
 * Convert a RoomPlan capture confidence to the store's field. Identity today,
 * but the seam keeps the store type free to diverge from Apple's enum.
 */
function toMeasureConfidence(c: 'high' | 'medium' | 'low'): MeasureConfidence {
  return c;
}

export function buildScanTakeoff(
  model: ScanModel,
  pxPerFt: number,
  placement: ScanPlacement,
  captureId: string | null,
): ScanTakeoffResult {
  const warnings = [...model.warnings];

  // ── 1. Placement: rotate about the scan's centroid, then normalize the
  // bounding box to (0,0), then scale + translate into canvas px. Rotation
  // first — the bbox of the ROTATED geometry is what should land at origin,
  // or a 90° turn walks the plan off the placement point.
  const th = (placement.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(th);
  const sin = Math.sin(th);

  const allPts: Pt[] = [];
  for (const w of model.walls) {
    allPts.push({ x: w.x1, y: w.y1 }, { x: w.x2, y: w.y2 });
  }
  if (allPts.length === 0) {
    return { walls: [], openings: [], rooms: [], roomPolygons: [], ceilingHeightFt: null, mergedWallCount: 0, warnings: ['Scan contained no usable walls.'] };
  }
  const cx = allPts.reduce((s, p) => s + p.x, 0) / allPts.length;
  const cy = allPts.reduce((s, p) => s + p.y, 0) / allPts.length;
  const rot = (p: Pt): Pt => ({
    x: cx + (p.x - cx) * cos - (p.y - cy) * sin,
    y: cy + (p.x - cx) * sin + (p.y - cy) * cos,
  });

  const rotated = model.walls.map(w => ({
    ...w,
    ...(() => {
      const a = rot({ x: w.x1, y: w.y1 });
      const b = rot({ x: w.x2, y: w.y2 });
      return { x1: a.x, y1: a.y, x2: b.x, y2: b.y };
    })(),
  }));
  const rotatedPolys = model.rooms.map(r => r.polygon?.map(rot) ?? null);

  let minX = Infinity;
  let minY = Infinity;
  for (const w of rotated) {
    minX = Math.min(minX, w.x1, w.x2);
    minY = Math.min(minY, w.y1, w.y2);
  }
  for (const poly of rotatedPolys) {
    for (const p of poly ?? []) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
    }
  }
  const toPx = (p: Pt): Pt => ({
    x: (p.x - minX) * pxPerFt + placement.originX,
    y: (p.y - minY) * pxPerFt + placement.originY,
  });

  // ── 2. Merge coincident walls (feet frame — the tolerance is physical).
  // Greedy first-wins, the blueprintToCad diagonal-twin idiom generalized:
  // later walls whose endpoint pairs both fall within tolerance of a kept
  // wall's (in either orientation) collapse onto it. Openings and rooms
  // remap; an opposite-orientation collapse mirrors positionAlongWall.
  interface KeptWall {
    src: ScanWall & { x1: number; y1: number; x2: number; y2: number };
    confidence: 'high' | 'medium' | 'low';
  }
  const keptWalls: KeptWall[] = [];
  /** scan wall id → { kept index, flipped } */
  const remap = new Map<string, { idx: number; flipped: boolean }>();
  let mergedWallCount = 0;
  const CONF_RANK = { high: 2, medium: 1, low: 0 } as const;

  for (const w of rotated) {
    let matched = false;
    for (const [idx, k] of keptWalls.entries()) {
      const same =
        Math.hypot(k.src.x1 - w.x1, k.src.y1 - w.y1) < SHARED_WALL_TOL_FT &&
        Math.hypot(k.src.x2 - w.x2, k.src.y2 - w.y2) < SHARED_WALL_TOL_FT;
      const flipped =
        !same &&
        Math.hypot(k.src.x1 - w.x2, k.src.y1 - w.y2) < SHARED_WALL_TOL_FT &&
        Math.hypot(k.src.x2 - w.x1, k.src.y2 - w.y1) < SHARED_WALL_TOL_FT;
      if (same || flipped) {
        remap.set(w.id, { idx, flipped });
        // Two independent measurements disagreeing is LESS certain, not more:
        // carry the weaker confidence of the pair.
        if (CONF_RANK[w.confidence] < CONF_RANK[k.confidence]) k.confidence = w.confidence;
        mergedWallCount++;
        matched = true;
        break;
      }
    }
    if (!matched) {
      remap.set(w.id, { idx: keptWalls.length, flipped: false });
      keptWalls.push({ src: w, confidence: w.confidence });
    }
  }
  if (mergedWallCount > 0) {
    warnings.push(`${mergedWallCount} wall${mergedWallCount === 1 ? '' : 's'} shared between rooms merged into partition${mergedWallCount === 1 ? '' : 's'}.`);
  }

  // ── 3. Store-ready walls.
  const walls: WallSegment[] = keptWalls.map(k => {
    const a = toPx({ x: k.src.x1, y: k.src.y1 });
    const b = toPx({ x: k.src.x2, y: k.src.y2 });
    return {
      id: crypto.randomUUID(),
      x1: a.x,
      y1: a.y,
      x2: b.x,
      y2: b.y,
      thicknessIn: k.src.thicknessIn,
      // The scan measured geometry, not assemblies. R-13 is the same default a
      // hand-drawn wall gets; the review dialog says so out loud, and ACCA
      // rule 4 makes assigning the real construction the engineer's explicit
      // step — never this bridge's guess.
      rValue: SCAN_DEFAULT_WALL_R,
      material: 'insulated_stud',
      fabricId: '',
      provenance: 'scan',
      ...(captureId ? { captureId } : {}),
      measureConfidence: toMeasureConfidence(k.confidence),
    };
  });
  const finalWallId = (scanWallId: string): { id: string; flipped: boolean } | null => {
    const m = remap.get(scanWallId);
    return m ? { id: walls[m.idx].id, flipped: m.flipped } : null;
  };

  // ── 4. Openings, remapped through the merge.
  const openings: Opening[] = [];
  let orphaned = 0;
  for (const o of model.openings) {
    const host = finalWallId(o.wallId);
    if (!host) {
      orphaned++;
      continue;
    }
    openings.push({
      id: crypto.randomUUID(),
      type: o.kind,
      wallId: host.id,
      positionAlongWall: host.flipped ? 1 - o.positionAlongWall : o.positionAlongWall,
      widthIn: o.widthIn,
      heightIn: o.heightIn,
      // uFactor / SHGC stay unset: the scan measured the opening's SIZE, not
      // its glazing package. Downstream consumers apply their stated defaults
      // (cadToManualJ: 0.30 / 0.25) until the engineer enters real values.
      fabricId: '',
      provenance: 'scan',
      ...(captureId ? { captureId } : {}),
      measureConfidence: toMeasureConfidence(o.confidence),
    });
  }
  if (orphaned > 0) {
    warnings.push(`${orphaned} opening${orphaned === 1 ? '' : 's'} referenced a wall that did not survive parsing — dropped.`);
  }

  // ── 5. Rooms. Area/perimeter from the FEET-frame polygon (precision rule);
  // canvas px only for display coordinates.
  const rooms: DetectedRoom[] = [];
  const roomPolygons: ScanRoomPolygon[] = [];
  for (const [i, room] of model.rooms.entries()) {
    const polyFt = rotatedPolys[i];
    if (!polyFt) {
      warnings.push(`${room.name}: the scan carried no floor outline — walls imported; run Detect Rooms (or draw the room) to add it to load calcs.`);
      continue;
    }
    const polyPx = polyFt.map(toPx);
    const wallIds = [...new Set(room.wallIds.map(id => finalWallId(id)?.id).filter((id): id is string => !!id))];
    rooms.push({
      id: crypto.randomUUID(),
      name: room.name,
      wallIds,
      areaSqFt: polygonArea(polyFt),
      perimeterFt: perimeter(polyFt),
      centroid: {
        x: polyPx.reduce((s, p) => s + p.x, 0) / polyPx.length,
        y: polyPx.reduce((s, p) => s + p.y, 0) / polyPx.length,
      },
      color: SCAN_ROOM_COLOR,
      polygon: polyPx.map(p => ({ x: p.x, y: p.y })),
      provenance: 'scan',
      ...(captureId ? { captureId } : {}),
    });
    roomPolygons.push({ name: room.name, points: polyPx.map(p => ({ x: p.x, y: p.y })) });
  }

  return {
    walls,
    openings,
    rooms,
    roomPolygons,
    ceilingHeightFt: model.ceilingHeightFt,
    mergedWallCount,
    warnings,
  };
}

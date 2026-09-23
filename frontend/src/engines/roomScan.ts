// LiDAR scan intake — Apple RoomPlan JSON parser.
//
// This is the first intake path that measures the BUILDING, not a drawing of
// it: a RoomPlan capture arrives in meters, ground truth, with no scale to
// infer and no transcription step to trust. The parser's whole job is to get
// that truth across the boundary undamaged — walls with real endpoints and
// heights, windows and doors with real dimensions attached to their wall —
// and to say plainly (via warnings / null) what the scan did NOT establish.
//
// Accepts the JSON Apple's RoomPlan API exports (and that scan apps like
// Polycam / magicplan re-emit): a single CapturedRoom, a CapturedStructure
// (`rooms: [...]`, iOS 17 multi-room merge), or a `{ capturedRoom: {...} }`
// wrapper some apps produce. Every field is read defensively — this file is a
// trust boundary exactly like loadDrawing(): corrupt input degrades to null
// or a warning, never to silently repaired geometry (same standard as
// blueprintToCad's sanitizePolygon).
//
// Coordinates: ARKit is y-UP, meters, right-handed; the floor plan lives in
// the XZ plane. Looking straight down (the plan view), +x runs right and +z
// runs DOWN the screen — so plan.x = world.x and plan.y = world.z lands a
// top-down view with correct chirality on our y-down canvas. True north is
// NOT in the data unless the capture recorded a compass heading; alignment is
// the reviewer's call in scanToCad's placement (canvas-up = North, the same
// convention orientation.ts assumes).
//
// Pure functions only — no store access, no side effects.

export const ROOM_SCAN_ENGINE_VERSION = 'roomScan-ts-0.1.0';

/** Exact: 1 / 0.3048. Meters are the scan's native unit; feet are ours. */
export const METERS_TO_FEET = 3.280839895013123;
export const METERS_TO_INCHES = 39.37007874015748;

/** RoomPlan's own per-entity capture confidence, carried through to review. */
export type ScanConfidence = 'high' | 'medium' | 'low';

export interface ScanPoint {
  x: number;
  y: number;
}

/** A wall in plan feet (y = ARKit z). Endpoints are the wall's centerline. */
export interface ScanWall {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  heightFt: number;
  thicknessIn: number;
  confidence: ScanConfidence;
}

export interface ScanOpening {
  id: string;
  kind: 'window' | 'door';
  /** ScanWall.id this opening sits in. */
  wallId: string;
  /** 0–1 fraction along the wall from (x1,y1) → (x2,y2). */
  positionAlongWall: number;
  widthIn: number;
  heightIn: number;
  confidence: ScanConfidence;
}

export interface ScanRoom {
  id: string;
  name: string;
  wallIds: string[];
  /** Floor outline in plan feet, when the scan carried one. null = walls only. */
  polygon: ScanPoint[] | null;
}

export interface ScanModel {
  source: 'captured_room' | 'captured_structure';
  walls: ScanWall[];
  openings: ScanOpening[];
  rooms: ScanRoom[];
  /** Median wall height — the scan's measured ceiling. null when underivable. */
  ceilingHeightFt: number | null;
  warnings: string[];
}

// Tolerances (feet unless noted)
const MIN_WALL_FT = 0.3;        // shorter "walls" are scan noise (a door jamb edge)
const ATTACH_TOL_FT = 1.5;      // max perpendicular distance opening-center → wall line
const THICKNESS_MIN_M = 0.02;   // below this the scan didn't really measure thickness
const HEIGHT_SPREAD_WARN_FT = 1.5; // wall heights varying more than this ⇒ sloped/split-level note
const DEFAULT_WALL_THICKNESS_IN = 6; // matches the CAD manual-draw default

// ── Defensive readers ───────────────────────────────────────────────────────────

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function rec(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** dimensions: simd_float3 → [x, y, z]. Null unless all three are finite. */
function vec3(v: unknown): [number, number, number] | null {
  if (!Array.isArray(v) || v.length < 3) return null;
  const x = num(v[0]);
  const y = num(v[1]);
  const z = num(v[2]);
  return x !== null && y !== null && z !== null ? [x, y, z] : null;
}

/**
 * simd_float4x4 → 16 numbers, column-major. Swift's JSONEncoder emits either a
 * flat 16-array or four 4-arrays (one per column) depending on the encoder
 * path; both flatten to the same column-major order. Translation is [12..14].
 */
function mat16(v: unknown): number[] | null {
  if (!Array.isArray(v)) return null;
  let flat: unknown[];
  if (v.length === 4 && Array.isArray(v[0])) {
    if (!v.every(col => Array.isArray(col) && col.length === 4)) return null;
    flat = (v as unknown[][]).flat();
  } else {
    flat = v;
  }
  if (flat.length !== 16) return null;
  const out: number[] = [];
  for (const n of flat) {
    const f = num(n);
    if (f === null) return null;
    out.push(f);
  }
  return out;
}

/**
 * Confidence encodes as `"high"` or as a keyed enum `{ "high": {} }` depending
 * on the exporting encoder. Anything unreadable is LOW — a confidence we can't
 * verify must flag for review, not pass as trustworthy.
 */
function parseConfidence(v: unknown): ScanConfidence {
  const s = typeof v === 'string' ? v : null;
  if (s === 'high' || s === 'medium' || s === 'low') return s;
  const r = rec(v);
  if (r) {
    if ('high' in r) return 'high';
    if ('medium' in r) return 'medium';
    if ('low' in r) return 'low';
  }
  return 'low';
}

// ── Surface parsing ─────────────────────────────────────────────────────────────

interface RawSurface {
  id: string;
  /** Plan-frame center in meters: (world x, world z). */
  cx: number;
  cy: number;
  /** Plan-frame unit direction of the surface's local x-axis. */
  ux: number;
  uy: number;
  /** dimensions [x, y, z] in meters. */
  dims: [number, number, number];
  confidence: ScanConfidence;
  story: number | null;
  parentId: string | null;
}

/**
 * One RoomPlan surface (wall / door / window). Null when the entry is corrupt
 * (missing transform, non-finite dims) — the caller warns and moves on.
 * A degenerate plan direction (the local x-axis pointing straight up — no
 * footprint on the floor plane) is also null: it cannot be plan geometry.
 */
function parseSurface(v: unknown, fallbackId: string): RawSurface | null {
  const r = rec(v);
  if (!r) return null;
  const t = mat16(r.transform);
  const dims = vec3(r.dimensions);
  if (!t || !dims) return null;
  const ux0 = t[0];
  const uy0 = t[2]; // world z → plan y
  const mag = Math.hypot(ux0, uy0);
  if (!(mag > 1e-6)) return null;
  return {
    id: str(r.identifier) ?? fallbackId,
    cx: t[12],
    cy: t[14],
    ux: ux0 / mag,
    uy: uy0 / mag,
    dims,
    confidence: parseConfidence(r.confidence),
    story: num(r.story),
    parentId: str(r.parentIdentifier),
  };
}

/** floors[i].polygonCorners: [[x,y,z], ...] world meters → plan feet. */
function parseFloorPolygon(v: unknown): ScanPoint[] | null {
  const r = rec(v);
  if (!r || !Array.isArray(r.polygonCorners)) return null;
  const pts: ScanPoint[] = [];
  for (const c of r.polygonCorners) {
    const p = vec3(c);
    if (!p) return null; // one corrupt corner ⇒ the outline is not trustworthy
    pts.push({ x: p[0] * METERS_TO_FEET, y: p[2] * METERS_TO_FEET });
  }
  return pts.length >= 3 ? pts : null;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function titleCase(s: string): string {
  return s.replace(/\w\S*/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}

// ── One CapturedRoom ────────────────────────────────────────────────────────────

interface ParsedRoom {
  walls: ScanWall[];
  openings: ScanOpening[];
  room: ScanRoom;
  stories: Set<number>;
  passageCount: number;
}

function parseCapturedRoom(r: Record<string, unknown>, index: number, warnings: string[]): ParsedRoom | null {
  if (!Array.isArray(r.walls)) return null;

  const walls: ScanWall[] = [];
  const stories = new Set<number>();
  let dropped = 0;

  for (const [i, entry] of r.walls.entries()) {
    const s = parseSurface(entry, `wall-${index}-${i}`);
    if (!s) {
      dropped++;
      continue;
    }
    const lenFt = s.dims[0] * METERS_TO_FEET;
    const heightFt = s.dims[1] * METERS_TO_FEET;
    if (!(lenFt >= MIN_WALL_FT) || !(heightFt > 0)) {
      dropped++;
      continue;
    }
    if (s.story !== null) stories.add(s.story);
    const halfM = s.dims[0] / 2;
    walls.push({
      id: s.id,
      x1: (s.cx - s.ux * halfM) * METERS_TO_FEET,
      y1: (s.cy - s.uy * halfM) * METERS_TO_FEET,
      x2: (s.cx + s.ux * halfM) * METERS_TO_FEET,
      y2: (s.cy + s.uy * halfM) * METERS_TO_FEET,
      heightFt,
      thicknessIn: s.dims[2] >= THICKNESS_MIN_M ? s.dims[2] * METERS_TO_INCHES : DEFAULT_WALL_THICKNESS_IN,
      confidence: s.confidence,
    });
  }
  if (walls.length === 0) return null;
  if (dropped > 0) {
    warnings.push(`${dropped} wall entr${dropped === 1 ? 'y' : 'ies'} in the scan ${dropped === 1 ? 'was' : 'were'} unreadable or below ${MIN_WALL_FT} ft and ${dropped === 1 ? 'was' : 'were'} skipped.`);
  }

  // Openings: doors and windows are separate arrays in the export; membership
  // IS the type. RoomPlan `openings` (cased passages between rooms) are not
  // envelope penetrations — count them so the reviewer knows they existed.
  const openings: ScanOpening[] = [];
  let unattached = 0;
  const attach = (entry: unknown, kind: 'window' | 'door', fallbackId: string) => {
    const s = parseSurface(entry, fallbackId);
    if (!s) {
      unattached++;
      return;
    }
    const widthIn = s.dims[0] * METERS_TO_INCHES;
    const heightIn = s.dims[1] * METERS_TO_INCHES;
    if (!(widthIn > 0) || !(heightIn > 0)) {
      unattached++;
      return;
    }
    const cxFt = s.cx * METERS_TO_FEET;
    const cyFt = s.cy * METERS_TO_FEET;

    // Prefer the export's own linkage; fall back to the nearest wall line.
    let host: ScanWall | null = (s.parentId && walls.find(w => w.id === s.parentId)) || null;
    let bestT = 0.5;
    if (host) {
      bestT = projectFraction(host, cxFt, cyFt);
    } else {
      let bestDist = ATTACH_TOL_FT;
      for (const w of walls) {
        const t = projectFraction(w, cxFt, cyFt);
        const px = w.x1 + (w.x2 - w.x1) * t;
        const py = w.y1 + (w.y2 - w.y1) * t;
        const d = Math.hypot(cxFt - px, cyFt - py);
        if (d < bestDist) {
          bestDist = d;
          host = w;
          bestT = t;
        }
      }
    }
    if (!host) {
      unattached++;
      return;
    }
    openings.push({
      id: s.id,
      kind,
      wallId: host.id,
      // Keep the opening strictly inside the wall so downstream rendering
      // (positionAlongWall is a 0–1 fraction) never hangs it off an end.
      positionAlongWall: Math.min(0.98, Math.max(0.02, bestT)),
      widthIn,
      heightIn,
      confidence: s.confidence,
    });
  };
  if (Array.isArray(r.windows)) r.windows.forEach((w, i) => attach(w, 'window', `window-${index}-${i}`));
  if (Array.isArray(r.doors)) r.doors.forEach((d, i) => attach(d, 'door', `door-${index}-${i}`));
  if (unattached > 0) {
    warnings.push(`${unattached} opening${unattached === 1 ? '' : 's'} could not be attached to a wall (corrupt entry or > ${ATTACH_TOL_FT} ft from any wall line) and ${unattached === 1 ? 'was' : 'were'} dropped — add ${unattached === 1 ? 'it' : 'them'} manually.`);
  }
  const passageCount = Array.isArray(r.openings) ? r.openings.length : 0;

  // Room identity: a section label when the scan classified the space.
  const sections = Array.isArray(r.sections) ? r.sections : [];
  const label = sections.map(sec => str(rec(sec)?.label)).find(l => l !== null) ?? null;
  const polygon = Array.isArray(r.floors) && r.floors.length > 0 ? parseFloorPolygon(r.floors[0]) : null;

  return {
    walls,
    openings,
    room: {
      id: str(r.identifier) ?? `scan-room-${index}`,
      name: label ? titleCase(label) : `Scanned Room ${index + 1}`,
      wallIds: walls.map(w => w.id),
      polygon,
    },
    stories,
    passageCount,
  };
}

/** Fraction (0–1, clamped) of the projection of point (px,py) onto the wall. */
function projectFraction(w: ScanWall, px: number, py: number): number {
  const dx = w.x2 - w.x1;
  const dy = w.y2 - w.y1;
  const lenSq = dx * dx + dy * dy;
  if (!(lenSq > 0)) return 0.5;
  const t = ((px - w.x1) * dx + (py - w.y1) * dy) / lenSq;
  return Math.min(1, Math.max(0, t));
}

// ── Entry point ─────────────────────────────────────────────────────────────────

/**
 * Parse a RoomPlan JSON export into a ScanModel (plan feet, y = ARKit z).
 * Returns null when the payload does not contain a readable capture at all;
 * partial damage (a corrupt wall, an unattachable window) degrades to
 * warnings instead, so one bad entity never discards a whole house scan.
 */
export function parseRoomPlanJson(raw: unknown): ScanModel | null {
  const root = rec(raw);
  if (!root) return null;

  // Unwrap the shapes we accept, in order of specificity.
  let roomRecords: Record<string, unknown>[];
  let source: ScanModel['source'];
  const wrapped = rec(root.capturedRoom);
  if (Array.isArray(root.rooms) && root.rooms.length > 0) {
    roomRecords = root.rooms.map(rec).filter((r): r is Record<string, unknown> => r !== null);
    source = 'captured_structure';
  } else if (wrapped) {
    roomRecords = [wrapped];
    source = 'captured_room';
  } else if (Array.isArray(root.walls)) {
    roomRecords = [root];
    source = 'captured_room';
  } else {
    return null;
  }

  const warnings: string[] = [];
  const parsed: ParsedRoom[] = [];
  for (const [i, r] of roomRecords.entries()) {
    const p = parseCapturedRoom(r, parsed.length, warnings);
    if (p) parsed.push(p);
    else warnings.push(`Room ${i + 1} in the capture had no readable walls and was skipped.`);
  }
  if (parsed.length === 0) return null;

  // Multi-story captures: geometry from two stories overlaid on one canvas
  // floor would be unusable AND misleading. Keep the story with the most
  // walls; say exactly what was left behind. (Per-story import is the
  // capture app's job — Phase 2.)
  const allStories = new Set<number>();
  parsed.forEach(p => p.stories.forEach(s => allStories.add(s)));
  let kept = parsed;
  if (allStories.size > 1) {
    const wallsPerStory = new Map<number, number>();
    for (const p of parsed) {
      for (const s of p.stories) {
        wallsPerStory.set(s, (wallsPerStory.get(s) ?? 0) + p.walls.length);
      }
    }
    const primary = [...wallsPerStory.entries()].sort((a, b) => b[1] - a[1])[0][0];
    kept = parsed.filter(p => p.stories.size === 0 || p.stories.has(primary));
    const droppedRooms = parsed.length - kept.length;
    warnings.push(`Multi-story capture: kept story ${primary} (most walls); ${droppedRooms} room${droppedRooms === 1 ? '' : 's'} on other stories not imported — import each story onto its own CAD floor.`);
  }

  // Dedupe by identifier: a CapturedStructure can list a shared door in both
  // rooms' arrays under the same id. (Shared WALLS appear as two distinct
  // entities with coincident geometry — that merge is scanToCad's job, where
  // the project scale and tolerance live.)
  const walls: ScanWall[] = [];
  const seenWalls = new Set<string>();
  const openings: ScanOpening[] = [];
  const seenOpenings = new Set<string>();
  const rooms: ScanRoom[] = [];
  let passages = 0;
  for (const p of kept) {
    for (const w of p.walls) {
      if (seenWalls.has(w.id)) continue;
      seenWalls.add(w.id);
      walls.push(w);
    }
    for (const o of p.openings) {
      if (seenOpenings.has(o.id)) continue;
      seenOpenings.add(o.id);
      openings.push(o);
    }
    rooms.push(p.room);
    passages += p.passageCount;
  }
  if (passages > 0) {
    warnings.push(`${passages} open passage${passages === 1 ? '' : 's'} (cased openings between rooms) noted in the scan — not imported; they are not envelope penetrations.`);
  }

  const heights = walls.map(w => w.heightFt);
  const ceilingHeightFt = heights.length > 0 ? median(heights) : null;
  if (heights.length > 0 && Math.max(...heights) - Math.min(...heights) > HEIGHT_SPREAD_WARN_FT) {
    warnings.push(`Wall heights vary from ${Math.min(...heights).toFixed(1)} to ${Math.max(...heights).toFixed(1)} ft — sloped or split-level areas; verify ceiling heights per room before load calc.`);
  }

  return { source, walls, openings, rooms, ceilingHeightFt, warnings };
}

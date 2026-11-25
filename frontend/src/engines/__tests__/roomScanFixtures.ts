// Synthetic RoomPlan JSON builders for the LiDAR intake tests.
//
// Tests think in PLAN FEET (the frame roomScan.ts emits); these builders do
// the one conversion into the meters + column-major-transform encoding Apple's
// JSONEncoder produces for CapturedRoom / CapturedStructure. Keeping the
// conversion here means a test that says "wall from (0,0) to (12,0)" reads as
// exactly that, and the parser is exercised against the real wire format.

export const FT_TO_M = 0.3048;

interface SurfaceOpts {
  id?: string;
  heightFt?: number;
  thicknessM?: number;
  story?: number;
  confidence?: unknown;
  /** Encode the transform as four 4-arrays (the other JSONEncoder shape). */
  nestedTransform?: boolean;
  parentIdentifier?: string;
}

/**
 * Column-major simd_float4x4 for a surface whose local x-axis runs along the
 * plan direction (dx, dy) — plan.y being world.z — centered at plan (cx, cy)
 * feet, elevated to half its height.
 */
function surfaceTransform(
  cxFt: number,
  cyFt: number,
  dx: number,
  dy: number,
  heightM: number,
  nested: boolean | undefined,
): number[] | number[][] {
  const flat = [
    dx, 0, dy, 0,        // col0: local x
    0, 1, 0, 0,          // col1: local y (up)
    -dy, 0, dx, 0,       // col2: local z (x̂ × ŷ)
    cxFt * FT_TO_M, heightM / 2, cyFt * FT_TO_M, 1, // col3: translation
  ];
  if (!nested) return flat;
  return [flat.slice(0, 4), flat.slice(4, 8), flat.slice(8, 12), flat.slice(12, 16)];
}

/** A wall from plan (x1,y1) to (x2,y2) feet. */
export function wallJson(x1: number, y1: number, x2: number, y2: number, opts: SurfaceOpts = {}) {
  const lenFt = Math.hypot(x2 - x1, y2 - y1);
  const dx = (x2 - x1) / lenFt;
  const dy = (y2 - y1) / lenFt;
  const heightFt = opts.heightFt ?? 8;
  const heightM = heightFt * FT_TO_M;
  return {
    identifier: opts.id ?? `wall-${x1}-${y1}-${x2}-${y2}`,
    confidence: opts.confidence !== undefined ? opts.confidence : { high: {} },
    dimensions: [lenFt * FT_TO_M, heightM, opts.thicknessM ?? 0],
    transform: surfaceTransform((x1 + x2) / 2, (y1 + y2) / 2, dx, dy, heightM, opts.nestedTransform),
    category: { wall: {} },
    curve: null,
    completedEdges: [],
    polygonCorners: [],
    story: opts.story ?? 1,
    parentIdentifier: null,
  };
}

/** A window/door centered at plan (x,y) feet, running along (dx,dy). */
export function openingJson(
  x: number,
  y: number,
  dx: number,
  dy: number,
  widthFt: number,
  heightFt: number,
  opts: SurfaceOpts = {},
) {
  const heightM = heightFt * FT_TO_M;
  return {
    identifier: opts.id ?? `opening-${x}-${y}`,
    confidence: opts.confidence !== undefined ? opts.confidence : { high: {} },
    dimensions: [widthFt * FT_TO_M, heightM, 0.05],
    transform: surfaceTransform(x, y, dx, dy, heightM, opts.nestedTransform),
    category: { window: {} },
    curve: null,
    completedEdges: [],
    polygonCorners: [],
    story: opts.story ?? 1,
    parentIdentifier: opts.parentIdentifier ?? null,
  };
}

/** A floor surface whose polygonCorners trace the given plan-feet outline. */
export function floorJson(cornersFt: Array<[number, number]>) {
  return {
    identifier: `floor-${cornersFt.length}`,
    confidence: { high: {} },
    dimensions: [0, 0, 0],
    transform: surfaceTransform(0, 0, 1, 0, 0, false),
    category: { floor: {} },
    polygonCorners: cornersFt.map(([x, y]) => [x * FT_TO_M, 0, y * FT_TO_M]),
    story: 1,
  };
}

interface RoomJsonParts {
  identifier?: string;
  walls?: unknown[];
  doors?: unknown[];
  windows?: unknown[];
  openings?: unknown[];
  floors?: unknown[];
  sections?: unknown[];
}

/** A CapturedRoom record. */
export function roomJson(parts: RoomJsonParts) {
  return {
    version: 2,
    identifier: parts.identifier ?? 'room-1',
    story: 1,
    walls: parts.walls ?? [],
    doors: parts.doors ?? [],
    windows: parts.windows ?? [],
    openings: parts.openings ?? [],
    objects: [],
    floors: parts.floors ?? [],
    sections: parts.sections ?? [],
  };
}

/**
 * The canonical single-room fixture: 12 × 10 ft living room, 8 ft ceilings,
 * a 3 × 4 ft window a quarter of the way along the north wall (linked via
 * parentIdentifier), and a 3 × 6.67 ft door mid-south (no parent — exercises
 * the nearest-wall fallback). Plan frame: y grows "south" (screen-down).
 */
export function rectRoomFixture() {
  const north = wallJson(0, 0, 12, 0, { id: 'w-north' });
  const south = wallJson(0, 10, 12, 10, { id: 'w-south' });
  const west = wallJson(0, 0, 0, 10, { id: 'w-west' });
  const east = wallJson(12, 0, 12, 10, { id: 'w-east' });
  const window = openingJson(3, 0, 1, 0, 3, 4, { id: 'win-1', parentIdentifier: 'w-north' });
  const door = { ...openingJson(6, 10, 1, 0, 3, 6.67, { id: 'door-1' }), category: { door: { isOpen: false } } };
  return roomJson({
    identifier: 'room-rect',
    walls: [north, south, west, east],
    windows: [window],
    doors: [door],
    floors: [floorJson([[0, 0], [12, 0], [12, 10], [0, 10]])],
    sections: [{ label: 'living room', center: [1.8, 0, 1.5], story: 1 }],
  });
}

/**
 * Two rooms sharing the x=12 wall, as a CapturedStructure: room A (0,0)–(12,10)
 * and room B (12,0)–(20,10). B's copy of the shared wall runs the OPPOSITE
 * direction (top-to-bottom vs bottom-to-top), so the geometric merge must take
 * the flipped branch — and B's window at 30% along its copy must land at 70%
 * of the surviving wall.
 */
export function twoRoomStructureFixture() {
  const roomA = roomJson({
    identifier: 'room-a',
    walls: [
      wallJson(0, 0, 12, 0, { id: 'a-north' }),
      wallJson(0, 10, 12, 10, { id: 'a-south' }),
      wallJson(0, 0, 0, 10, { id: 'a-west' }),
      wallJson(12, 0, 12, 10, { id: 'a-east' }),
    ],
    floors: [floorJson([[0, 0], [12, 0], [12, 10], [0, 10]])],
    sections: [{ label: 'kitchen', center: [1, 0, 1], story: 1 }],
  });
  const roomB = roomJson({
    identifier: 'room-b',
    walls: [
      wallJson(12, 0, 20, 0, { id: 'b-north' }),
      wallJson(12, 10, 20, 10, { id: 'b-south' }),
      wallJson(12, 10, 12, 0, { id: 'b-west' }), // reversed copy of a-east
      wallJson(20, 0, 20, 10, { id: 'b-east' }),
    ],
    windows: [openingJson(12, 7, 0, -1, 2, 3, { id: 'b-win', parentIdentifier: 'b-west' })],
    floors: [floorJson([[12, 0], [20, 0], [20, 10], [12, 10]])],
    sections: [{ label: 'dining', center: [16, 0, 5], story: 1 }],
  });
  return { version: 1, identifier: 'structure-1', rooms: [roomA, roomB] };
}

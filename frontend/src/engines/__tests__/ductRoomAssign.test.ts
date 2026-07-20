import { describe, it, expect } from 'vitest';
import {
  assignDuctRooms,
  applyDuctRoomAssignments,
  pointInPolygon,
} from '../ductRoomAssign';
import type { AssignableRoom, AssignableSegment } from '../ductRoomAssign';
import { measureCadDucts } from '../cadToManualD';
import type { Floor, DuctSegment, DetectedRoom } from '../../features/cad/store/useCadStore';

const PX_PER_FT = 40;

/** Axis-aligned box helper — canvas px. */
const box = (x: number, y: number, w: number, h: number) => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
];

const seg = (
  id: string,
  x1: number, y1: number, x2: number, y2: number,
  over: Partial<AssignableSegment> = {},
): AssignableSegment => ({ id, x1, y1, x2, y2, ...over });

describe('pointInPolygon', () => {
  it('contains an interior point and rejects an exterior one', () => {
    const poly = box(0, 0, 100, 100);
    expect(pointInPolygon({ x: 50, y: 50 }, poly)).toBe(true);
    expect(pointInPolygon({ x: 150, y: 50 }, poly)).toBe(false);
  });

  it('never throws on degenerate outlines', () => {
    expect(pointInPolygon({ x: 1, y: 1 }, [])).toBe(false);
    expect(pointInPolygon({ x: 1, y: 1 }, [{ x: 0, y: 0 }, { x: 5, y: 5 }])).toBe(false);
    expect(pointInPolygon({ x: NaN, y: 1 }, box(0, 0, 10, 10))).toBe(false);
  });
});

describe('assignDuctRooms — containment', () => {
  const rooms: AssignableRoom[] = [
    { id: 'r1', polygon: box(0, 0, 200, 200), areaSqFt: 25 },
    { id: 'r2', polygon: box(400, 0, 200, 200), areaSqFt: 25 },
  ];

  it('assigns a segment lying inside a room', () => {
    const out = assignDuctRooms([seg('s1', 40, 40, 160, 40)], rooms);
    expect(out).toEqual({ s1: 'r1' });
  });

  it('leaves a segment outside every room unassigned', () => {
    const out = assignDuctRooms([seg('s1', 250, 300, 350, 300)], rooms);
    expect(out).toEqual({});
  });

  it('prefers the smaller room when outlines nest', () => {
    const nested: AssignableRoom[] = [
      { id: 'suite', polygon: box(0, 0, 400, 400), areaSqFt: 100 },
      { id: 'closet', polygon: box(50, 50, 100, 100), areaSqFt: 6 },
    ];
    const out = assignDuctRooms([seg('s1', 80, 80, 120, 120)], nested);
    expect(out).toEqual({ s1: 'closet' });
  });
});

describe('assignDuctRooms — terminal endpoint rule', () => {
  it('attributes a branch to the room holding its REGISTER end, not the trunk joint', () => {
    // Trunk sits in the hallway; the branch runs from the trunk joint into the
    // bedroom. Both endpoints are in a room, but only the bedroom end is
    // terminal, so the bedroom must win.
    const rooms: AssignableRoom[] = [
      { id: 'hall', polygon: box(0, 0, 200, 400), areaSqFt: 40 },
      { id: 'bedroom', polygon: box(200, 0, 400, 400), areaSqFt: 160 },
    ];
    // Chain-drawn: the branch starts exactly where the trunk ends, which is
    // what makes that endpoint shared and the far end terminal.
    const segments = [
      seg('trunk', 100, 50, 100, 200),   // wholly inside the hall
      seg('branch', 100, 200, 500, 200), // hall joint → bedroom register
    ];
    const out = assignDuctRooms(segments, rooms);
    expect(out.branch).toBe('bedroom');
    expect(out.trunk).toBe('hall');
  });

  it('falls back to the upstream end when the terminal end is in no room', () => {
    const rooms: AssignableRoom[] = [
      { id: 'hall', polygon: box(0, 0, 200, 400), areaSqFt: 40 },
    ];
    const segments = [
      seg('trunk', 100, 50, 100, 200),
      seg('branch', 100, 200, 900, 200), // terminal end is off in open space
    ];
    const out = assignDuctRooms(segments, rooms);
    expect(out.branch).toBe('hall');
  });

  it('with no terminal signal and two different rooms, prefers the smaller', () => {
    // Both ends of `mid` are shared with other segments, so neither endpoint is
    // terminal — the tie breaks on room size.
    const rooms: AssignableRoom[] = [
      { id: 'big', polygon: box(0, 0, 400, 400), areaSqFt: 400 },
      { id: 'small', polygon: box(600, 0, 100, 100), areaSqFt: 25 },
    ];
    const segments = [
      seg('a', 100, 50, 100, 50),
      seg('mid', 100, 50, 650, 50),
      seg('b', 650, 50, 650, 50),
    ];
    const out = assignDuctRooms(segments, rooms);
    expect(out.mid).toBe('small');
  });

  it('an isolated segment (both ends terminal) still resolves by containment', () => {
    const rooms: AssignableRoom[] = [{ id: 'r1', polygon: box(0, 0, 200, 200), areaSqFt: 25 }];
    const out = assignDuctRooms([seg('lone', 40, 40, 160, 160)], rooms);
    expect(out).toEqual({ lone: 'r1' });
  });
});

describe('assignDuctRooms — legacy rooms with no polygon', () => {
  // A drawing saved before DetectedRoom.polygon existed.
  const legacy: AssignableRoom[] = [
    { id: 'r1', centroid: { x: 100, y: 100 }, areaSqFt: 144 }, // √144 * 40 * 0.75 = 360px radius
  ];

  it('assigns a nearby duct by centroid proximity', () => {
    const out = assignDuctRooms([seg('s1', 120, 120, 180, 120)], legacy, { pxPerFt: PX_PER_FT });
    expect(out).toEqual({ s1: 'r1' });
  });

  it('leaves a far-off duct UNASSIGNED rather than attributing it wrongly', () => {
    // ~5,000 px away — a corridor run on the far side of the plan. An unmeasured
    // room falls back to the documented estimate; a wrong room corrupts sizing.
    const out = assignDuctRooms([seg('s1', 5000, 5000, 5100, 5000)], legacy, { pxPerFt: PX_PER_FT });
    expect(out).toEqual({});
  });

  it('does not let proximity override a room that has a real outline', () => {
    const mixed: AssignableRoom[] = [
      { id: 'drawn', polygon: box(0, 0, 200, 200), areaSqFt: 25 },
      { id: 'legacyRoom', centroid: { x: 100, y: 100 }, areaSqFt: 144 },
    ];
    // The point is inside `drawn` and also right on `legacyRoom`'s centroid.
    // Containment is definitive and must win.
    const out = assignDuctRooms([seg('s1', 100, 100, 150, 150)], mixed, { pxPerFt: PX_PER_FT });
    expect(out).toEqual({ s1: 'drawn' });
  });

  it('honours an explicit radius override', () => {
    const out = assignDuctRooms([seg('s1', 100, 300, 100, 320)], legacy, { centroidRadiusPx: 10 });
    expect(out).toEqual({});
  });
});

describe('assignDuctRooms — degenerate input', () => {
  const rooms: AssignableRoom[] = [{ id: 'r1', polygon: box(0, 0, 200, 200), areaSqFt: 25 }];

  it('returns empty for zero rooms and zero segments', () => {
    expect(assignDuctRooms([], rooms)).toEqual({});
    expect(assignDuctRooms([seg('s1', 10, 10, 20, 20)], [])).toEqual({});
    expect(assignDuctRooms([], [])).toEqual({});
  });

  it('ignores segments with non-finite coordinates instead of throwing', () => {
    const out = assignDuctRooms(
      [seg('bad', NaN, 10, 20, 20), seg('good', 10, 10, 20, 20)],
      rooms,
    );
    expect(out).toEqual({ good: 'r1' });
  });

  it('handles duplicate points and zero-length segments', () => {
    const out = assignDuctRooms([seg('dot', 100, 100, 100, 100)], rooms);
    expect(out).toEqual({ dot: 'r1' });
  });

  it('treats a 2-point or empty polygon as having no outline', () => {
    const thin: AssignableRoom[] = [{ id: 'r1', polygon: [{ x: 0, y: 0 }, { x: 100, y: 0 }] }];
    expect(assignDuctRooms([seg('s1', 50, 0, 60, 0)], thin)).toEqual({});
    expect(assignDuctRooms([seg('s1', 50, 0, 60, 0)], [{ id: 'r1', polygon: [] }])).toEqual({});
  });

  it('does not throw on a self-intersecting outline', () => {
    const bowtie: AssignableRoom[] = [{
      id: 'r1',
      polygon: [{ x: 0, y: 0 }, { x: 100, y: 100 }, { x: 100, y: 0 }, { x: 0, y: 100 }],
    }];
    expect(() => assignDuctRooms([seg('s1', 50, 20, 60, 20)], bowtie)).not.toThrow();
  });

  it('skips rooms with a blank id', () => {
    expect(assignDuctRooms([seg('s1', 50, 50, 60, 60)], [{ id: '', polygon: box(0, 0, 200, 200) }]))
      .toEqual({});
  });
});

describe('applyDuctRoomAssignments', () => {
  const rooms: AssignableRoom[] = [
    { id: 'r1', polygon: box(0, 0, 200, 200), areaSqFt: 25 },
    { id: 'r2', polygon: box(400, 0, 200, 200), areaSqFt: 25 },
  ];

  it('writes roomId onto the segments and reports the change', () => {
    const out = applyDuctRoomAssignments([seg('s1', 40, 40, 160, 40)], rooms);
    expect(out.changed).toBe(true);
    expect(out.segments[0].roomId).toBe('r1');
  });

  it('preserves object identity when nothing moved', () => {
    const s = seg('s1', 40, 40, 160, 40, { roomId: 'r1' });
    const out = applyDuctRoomAssignments([s], rooms);
    expect(out.changed).toBe(false);
    expect(out.segments[0]).toBe(s);
  });

  it('never overwrites a hand-picked room', () => {
    // Geometrically this sits in r1, but the designer pinned it to r2.
    const s = seg('s1', 40, 40, 160, 40, { roomId: 'r2', roomAssignedManually: true });
    const out = applyDuctRoomAssignments([s], rooms);
    expect(out.changed).toBe(false);
    expect(out.segments[0].roomId).toBe('r2');
  });

  it('clears a stale auto-assignment when the room no longer contains it', () => {
    const s = seg('s1', 5000, 5000, 5100, 5000, { roomId: 'r1' });
    const out = applyDuctRoomAssignments([s], rooms);
    expect(out.changed).toBe(true);
    expect(out.segments[0].roomId).toBeUndefined();
  });

  it('returns an empty list for empty input', () => {
    expect(applyDuctRoomAssignments([], rooms)).toEqual({ segments: [], changed: false });
  });
});

// ── End-to-end shape: the whole point of the engine ─────────────────────────
describe('assigned segments reach measureCadDucts', () => {
  const detected = (id: string, name: string, poly: { x: number; y: number }[]): DetectedRoom => ({
    id, name, wallIds: [], areaSqFt: 100, perimeterFt: 40,
    centroid: { x: 0, y: 0 }, color: '#34d399', polygon: poly,
  });

  const duct = (id: string, x1: number, y1: number, x2: number, y2: number): DuctSegment => ({
    id, x1, y1, x2, y2,
    shape: 'round', material: 'sheet_metal', side: 'supply', role: 'branch',
    fabricId: '',
  });

  const makeFloor = (segments: DuctSegment[], rooms: DetectedRoom[]): Floor => ({
    id: 'floor-1', name: 'Floor 1', index: 0, heightFt: 9, isVisible: true, isLocked: false,
    walls: [], openings: [], rooms, hvacUnits: [], pipes: [],
    ductSegments: segments, ductFittings: [], ductSystems: [], radiantZones: [],
    annotations: [], underlays: [],
  });

  it('short-circuits before assignment and measures after it', () => {
    const rooms = [detected('r1', 'Bedroom', box(0, 0, 400, 400))];
    // 200px + 200px at 40 px/ft = 10 ft of drawn supply.
    const segments = [duct('s1', 40, 40, 240, 40), duct('s2', 240, 40, 240, 240)];

    // Before: roomId is undefined, exactly the shipped-but-inert state.
    const before = measureCadDucts([makeFloor(segments, rooms)], PX_PER_FT);
    expect(before.measurements).toHaveLength(0);
    expect(before.unassignedSegmentCount).toBe(2);
    expect(before.unmeasuredRoomNames).toEqual(['Bedroom']);

    // After: the engine populates roomId and the takeoff has real numbers.
    const { segments: assigned } = applyDuctRoomAssignments(segments, rooms, { pxPerFt: PX_PER_FT });
    const after = measureCadDucts([makeFloor(assigned, rooms)], PX_PER_FT);
    expect(after.unassignedSegmentCount).toBe(0);
    expect(after.measurements).toHaveLength(1);
    expect(after.measurements[0].roomId).toBe('r1');
    expect(after.measurements[0].measuredLengthFt).toBeCloseTo(10, 5);
    expect(after.overrides['cad-room-r1'].actualLengthFt).toBeCloseTo(10, 5);
  });
});

import { describe, it, expect } from 'vitest';
import { convertCadRoomsToManualJ } from '../cadToManualJ';
import type { Floor, WallSegment, Opening, DetectedRoom } from '../../features/cad/store/useCadStore';

// A two-room plan sharing a middle wall. Screen coords, y DOWN:
//
//   (0,0)      (100,0)     (200,0)
//     +----topA----+----topB----+
//     |            |            |
//   leftA   A   shared   B    rightB
//     |            |            |
//     +---bottomA--+--bottomB---+
//   (0,100)    (100,100)   (200,100)
//
// Room A has its glass on the WEST wall, room B on the EAST wall.
const wall = (id: string, x1: number, y1: number, x2: number, y2: number): WallSegment => ({
  id, x1, y1, x2, y2, thicknessIn: 6, rValue: 13, material: 'insulated_stud', fabricId: '',
});

const window_ = (id: string, wallId: string, widthIn = 48, heightIn = 36): Opening => ({
  id, type: 'window', wallId, positionAlongWall: 0.5, widthIn, heightIn,
  uFactor: 0.3, shgc: 0.25, glassType: 'double_low_e', fabricId: '',
});

const detected = (id: string, name: string, wallIds: string[], cx: number, cy: number): DetectedRoom => ({
  id, name, wallIds, areaSqFt: 100, perimeterFt: 40,
  centroid: { x: cx, y: cy }, color: '#34d399',
});

const baseFloor = (over: Partial<Floor>): Floor => ({
  id: 'floor-1', name: 'Floor 1', index: 0, heightFt: 9, isVisible: true, isLocked: false,
  walls: [], openings: [], rooms: [], hvacUnits: [], pipes: [],
  ductSegments: [], ductFittings: [], ductSystems: [], radiantZones: [],
  annotations: [], underlays: [], ...over,
});

const twoRoomFloor = () => baseFloor({
  walls: [
    wall('topA', 0, 0, 100, 0),
    wall('bottomA', 100, 100, 0, 100),
    wall('leftA', 0, 100, 0, 0),
    wall('shared', 100, 0, 100, 100),
    wall('topB', 100, 0, 200, 0),
    wall('bottomB', 200, 100, 100, 100),
    wall('rightB', 200, 0, 200, 100),
  ],
  openings: [
    window_('wA', 'leftA'),
    window_('wB', 'rightB'),
  ],
  rooms: [
    detected('A', 'Living', ['topA', 'shared', 'bottomA', 'leftA'], 50, 50),
    detected('B', 'Office', ['topB', 'rightB', 'bottomB', 'shared'], 150, 50),
  ],
});

describe('convertCadRoomsToManualJ — solar exposure', () => {
  it('derives each room\'s exposure from the wall its glass sits in', () => {
    const [living, office] = convertCadRoomsToManualJ(twoRoomFloor());
    expect(living.exposureDirection).toBe('W');
    expect(office.exposureDirection).toBe('E');
    expect(living.exposureBasis).toBe('glass');
    expect(office.exposureBasis).toBe('glass');
  });

  it('no longer stamps every room South', () => {
    // The regression this guards: a fixed 'S' scaled the whole solar term for
    // every CAD-imported room regardless of how it was drawn.
    const rooms = convertCadRoomsToManualJ(twoRoomFloor());
    expect(rooms.every(r => r.exposureDirection === 'S')).toBe(false);
  });

  it('is unaffected by the direction the walls happen to be drawn in', () => {
    const floor = twoRoomFloor();
    floor.walls = floor.walls.map(w => ({ ...w, x1: w.x2, y1: w.y2, x2: w.x1, y2: w.y1 }));
    const [living, office] = convertCadRoomsToManualJ(floor);
    expect(living.exposureDirection).toBe('W');
    expect(office.exposureDirection).toBe('E');
  });

  it('excludes the shared wall from the exterior wall count', () => {
    // Previously every wall counted as exterior, inflating envelope load.
    const [living, office] = convertCadRoomsToManualJ(twoRoomFloor());
    expect(living.exteriorWalls).toBe(3);
    expect(office.exteriorWalls).toBe(3);
  });

  it('falls back to the longest exterior wall when a room has no glass', () => {
    const floor = twoRoomFloor();
    floor.openings = [];
    // Make room A wider than it is tall so the north face is the longest.
    floor.walls = floor.walls.map(w =>
      w.id === 'topA' ? { ...w, x2: 400 } : w.id === 'bottomA' ? { ...w, x1: 400 } : w,
    );
    const [living] = convertCadRoomsToManualJ(floor);
    expect(living.exposureBasis).toBe('longest_exterior_wall');
    expect(['N', 'S']).toContain(living.exposureDirection);
  });

  it('weights by glass area when a room has windows on more than one face', () => {
    const floor = twoRoomFloor();
    // Room A: a small west window and a much larger north one.
    floor.openings = [
      window_('wSmall', 'leftA', 24, 24),
      window_('wBig', 'topA', 96, 60),
      window_('wB', 'rightB'),
    ];
    const [living] = convertCadRoomsToManualJ(floor);
    expect(living.exposureDirection).toBe('N');
    expect(living.exposureBasis).toBe('glass');
  });

  it('keeps a lone room\'s walls all exterior', () => {
    const floor = baseFloor({
      walls: [wall('t', 0, 0, 100, 0), wall('r', 100, 0, 100, 100), wall('b', 100, 100, 0, 100), wall('l', 0, 100, 0, 0)],
      openings: [window_('w1', 'b')],
      rooms: [detected('solo', 'Studio', ['t', 'r', 'b', 'l'], 50, 50)],
    });
    const [studio] = convertCadRoomsToManualJ(floor);
    expect(studio.exteriorWalls).toBe(4);
    expect(studio.exposureDirection).toBe('S'); // glass on the bottom wall
    expect(studio.exposureBasis).toBe('glass');
  });

  it('reports the fallback basis for a room with no walls at all', () => {
    const floor = baseFloor({ rooms: [detected('ghost', 'Ghost', [], 0, 0)] });
    const [ghost] = convertCadRoomsToManualJ(floor);
    expect(ghost.exposureBasis).toBe('undeterminable');
    expect(ghost.exteriorWalls).toBe(0);
  });
});

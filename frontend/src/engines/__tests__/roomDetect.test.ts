import { describe, it, expect } from 'vitest';
import { detectRoomOutlines, type RoomDetectWall } from '../roomDetect';

const wall = (id: string, x1: number, y1: number, x2: number, y2: number): RoomDetectWall => ({ id, x1, y1, x2, y2 });

// 13 ft x 11 ft at 40 px/ft, drawn clockwise on screen (y down), corners on the
// 40 px grid but NOT on the 15 px lattice the old detector rounded to.
const rectangle = () => [
  wall('top', 280, 240, 800, 240),
  wall('right', 800, 240, 800, 680),
  wall('bottom', 800, 680, 280, 680),
  wall('left', 280, 680, 280, 240),
];

describe('detectRoomOutlines', () => {
  it('returns ONE room for one closed rectangle (not a clockwise and a counter-clockwise copy)', () => {
    const rooms = detectRoomOutlines(rectangle());
    expect(rooms).toHaveLength(1);
  });

  it('measures area and perimeter from the drawn corners, not a rounding lattice', () => {
    const [room] = detectRoomOutlines(rectangle());
    // 520 px x 440 px = 13 ft x 11 ft = 143 sq ft at 40 px/ft
    expect(room.areaPx2).toBeCloseTo(520 * 440, 6);
    expect(room.areaPx2 / (40 * 40)).toBeCloseTo(143, 6);
    expect(room.perimeterPx).toBeCloseTo(2 * (520 + 440), 6);
    expect(room.centroid.x).toBeCloseTo(540, 6);
    expect(room.centroid.y).toBeCloseTo(460, 6);
  });

  it('records the walls that bound the room', () => {
    const [room] = detectRoomOutlines(rectangle());
    expect([...room.wallIds].sort()).toEqual(['bottom', 'left', 'right', 'top']);
  });

  it('does not depend on the direction each wall was drawn', () => {
    const walls = rectangle();
    // flip two walls end-for-end
    walls[1] = wall('right', 800, 680, 800, 240);
    walls[2] = wall('bottom', 280, 680, 800, 680);
    const rooms = detectRoomOutlines(walls);
    expect(rooms).toHaveLength(1);
    expect(rooms[0].areaPx2).toBeCloseTo(520 * 440, 6);
  });

  it('finds two rooms sharing a wall and does not add the building outline as a third', () => {
    //   +----A----+----B----+
    //   |         |         |
    //   +---------+---------+
    const walls = [
      wall('topA', 0, 0, 480, 0), wall('topB', 480, 0, 960, 0),
      wall('right', 960, 0, 960, 480),
      wall('bottomB', 960, 480, 480, 480), wall('bottomA', 480, 480, 0, 480),
      wall('left', 0, 480, 0, 0),
      wall('shared', 480, 0, 480, 480),
    ];
    const rooms = detectRoomOutlines(walls);
    expect(rooms).toHaveLength(2);
    const total = rooms.reduce((s, r) => s + r.areaPx2, 0);
    expect(total).toBeCloseTo(960 * 480, 6); // true floor area, not doubled
    // left room first (reading order)
    expect([...rooms[0].wallIds].sort()).toEqual(['bottomA', 'left', 'shared', 'topA']);
    expect([...rooms[1].wallIds].sort()).toEqual(['bottomB', 'right', 'shared', 'topB']);
    // the partition is the only wall both rooms claim
    const shared = rooms[0].wallIds.filter(id => rooms[1].wallIds.includes(id));
    expect(shared).toEqual(['shared']);
  });

  it('merges corners that miss each other by a few pixels and keeps their true position', () => {
    const walls = [
      wall('top', 100, 100, 500, 100),
      wall('right', 503, 104, 500, 400),   // start is 5 px off the top wall's end
      wall('bottom', 500, 400, 100, 400),
      wall('left', 100, 400, 100, 100),
    ];
    const rooms = detectRoomOutlines(walls);
    expect(rooms).toHaveLength(1);
    // merged corner sits at the mean of (500,100) and (503,104)
    const corner = rooms[0].polygon.find(p => p.x > 400 && p.y < 200)!;
    expect(corner.x).toBeCloseTo(501.5, 6);
    expect(corner.y).toBeCloseTo(102, 6);
  });

  it('handles a room with more than twenty corners', () => {
    // a 24-sided ring
    const n = 24;
    const pts = Array.from({ length: n }, (_, i) => ({
      x: 1000 + 400 * Math.cos((2 * Math.PI * i) / n),
      y: 1000 + 400 * Math.sin((2 * Math.PI * i) / n),
    }));
    const walls = pts.map((p, i) => wall(`w${i}`, p.x, p.y, pts[(i + 1) % n].x, pts[(i + 1) % n].y));
    const rooms = detectRoomOutlines(walls);
    expect(rooms).toHaveLength(1);
    expect(rooms[0].wallIds).toHaveLength(n);
  });

  it('ignores a dangling wall — it neither forms a room nor joins one', () => {
    const walls = [...rectangle(), wall('stub', 800, 240, 1000, 240), wall('inner-stub', 280, 240, 400, 400)];
    const rooms = detectRoomOutlines(walls);
    expect(rooms).toHaveLength(1);
    expect(rooms[0].wallIds).not.toContain('stub');
    expect(rooms[0].wallIds).not.toContain('inner-stub');
    expect(rooms[0].areaPx2).toBeCloseTo(520 * 440, 6);
  });

  it('returns nothing for an open shape or too few walls', () => {
    expect(detectRoomOutlines(rectangle().slice(0, 3))).toEqual([]);
    expect(detectRoomOutlines([])).toEqual([]);
  });

  it('keeps an L-shaped room as one room with the right area', () => {
    // 10x10 square with a 5x5 bite out of the top-right, in 40 px feet
    const f = 40;
    const pts = [[0, 0], [5, 0], [5, 5], [10, 5], [10, 10], [0, 10]].map(([x, y]) => ({ x: x * f, y: y * f }));
    const walls = pts.map((p, i) => wall(`w${i}`, p.x, p.y, pts[(i + 1) % pts.length].x, pts[(i + 1) % pts.length].y));
    const rooms = detectRoomOutlines(walls);
    expect(rooms).toHaveLength(1);
    expect(rooms[0].areaPx2 / (f * f)).toBeCloseTo(75, 6);
    expect(rooms[0].wallIds).toHaveLength(6);
  });
});

import { describe, it, expect } from 'vitest';
import { angleToExposure, wallExposure, roomExposure, exteriorWallIds, wallLength } from '../orientation';

// Screen coordinates: y increases DOWNWARD. Screen "up" is North.
// A 100x100 room with its top-left at (0,0), so its centre is (50, 50):
//   top    (0,0)   -> (100,0)     faces North
//   right  (100,0) -> (100,100)   faces East
//   bottom (100,100)->(0,100)     faces South
//   left   (0,100) -> (0,0)       faces West
const CENTRE = { x: 50, y: 50 };
const TOP = { id: 'top', x1: 0, y1: 0, x2: 100, y2: 0 };
const RIGHT = { id: 'right', x1: 100, y1: 0, x2: 100, y2: 100 };
const BOTTOM = { id: 'bottom', x1: 100, y1: 100, x2: 0, y2: 100 };
const LEFT = { id: 'left', x1: 0, y1: 100, x2: 0, y2: 0 };

describe('angleToExposure', () => {
  it('maps the cardinal and intercardinal angles', () => {
    expect(angleToExposure(0)).toBe('E');
    expect(angleToExposure(45)).toBe('NE');
    expect(angleToExposure(90)).toBe('N');
    expect(angleToExposure(135)).toBe('NW');
    expect(angleToExposure(180)).toBe('W');
    expect(angleToExposure(225)).toBe('SW');
    expect(angleToExposure(270)).toBe('S');
    expect(angleToExposure(315)).toBe('SE');
  });

  it('normalizes angles outside 0-360, including negatives', () => {
    expect(angleToExposure(-90)).toBe('S');
    expect(angleToExposure(450)).toBe('N');
    expect(angleToExposure(-360)).toBe('E');
  });

  it('places sector boundaries consistently', () => {
    expect(angleToExposure(22.4)).toBe('E');
    expect(angleToExposure(22.5)).toBe('NE');
    expect(angleToExposure(337.4)).toBe('SE');
    expect(angleToExposure(337.5)).toBe('E');
  });
});

describe('wallExposure', () => {
  it('faces each wall of a room outward, using the centroid', () => {
    expect(wallExposure(TOP, CENTRE)).toBe('N');
    expect(wallExposure(RIGHT, CENTRE)).toBe('E');
    expect(wallExposure(BOTTOM, CENTRE)).toBe('S');
    expect(wallExposure(LEFT, CENTRE)).toBe('W');
  });

  it('gives the same answer when the room is wound the other way', () => {
    // Reversing every wall's direction must not flip the building inside out.
    const rev = (w: typeof TOP) => ({ ...w, x1: w.x2, y1: w.y2, x2: w.x1, y2: w.y1 });
    expect(wallExposure(rev(TOP), CENTRE)).toBe('N');
    expect(wallExposure(rev(RIGHT), CENTRE)).toBe('E');
    expect(wallExposure(rev(BOTTOM), CENTRE)).toBe('S');
    expect(wallExposure(rev(LEFT), CENTRE)).toBe('W');
  });

  it('handles a diagonal wall, facing away from whichever side the room is on', () => {
    // Runs bottom-left to top-right — the line x + y = 100. Its two normals
    // point NW and SE, and the interior point decides which one is outward.
    const diag = { id: 'd', x1: 0, y1: 100, x2: 100, y2: 0 };
    expect(wallExposure(diag, { x: 20, y: 20 })).toBe('SE'); // room NW of it
    expect(wallExposure(diag, { x: 80, y: 80 })).toBe('NW'); // room SE of it
  });

  it('falls back to the legacy +90 convention with no interior point', () => {
    // Preserves the behaviour AED relied on before a room context existed.
    expect(wallExposure(TOP)).toBe('N');
    expect(wallExposure({ x1: 0, y1: 0, x2: 0, y2: 100 })).toBe('E');
  });

  it('returns null rather than inventing a direction for a degenerate wall', () => {
    expect(wallExposure({ x1: 5, y1: 5, x2: 5, y2: 5 })).toBeNull();
    expect(wallExposure({ x1: 0, y1: 0, x2: NaN, y2: 0 })).toBeNull();
  });

  it('keeps the default candidate when the centroid lies on the wall line', () => {
    // Collinear centroid cannot disambiguate; must not flip on floating noise.
    expect(wallExposure(TOP, { x: 50, y: 0 })).toBe('N');
  });
});

describe('exteriorWallIds', () => {
  it('treats a wall shared by two rooms as a partition', () => {
    const ids = exteriorWallIds([
      { wallIds: ['a', 'shared'] },
      { wallIds: ['b', 'shared'] },
    ]);
    expect(ids.has('a')).toBe(true);
    expect(ids.has('b')).toBe(true);
    expect(ids.has('shared')).toBe(false);
  });

  it('does not let a room listing the same wall twice make it look shared', () => {
    const ids = exteriorWallIds([{ wallIds: ['a', 'a'] }]);
    expect(ids.has('a')).toBe(true);
  });

  it('treats every wall of a lone room as exterior', () => {
    const ids = exteriorWallIds([{ wallIds: ['a', 'b', 'c', 'd'] }]);
    expect(ids.size).toBe(4);
  });
});

describe('roomExposure', () => {
  const allWalls = [TOP, RIGHT, BOTTOM, LEFT];
  const allExterior = new Set(['top', 'right', 'bottom', 'left']);

  it('follows the glass — the face the windows look out of wins', () => {
    const out = roomExposure({
      walls: allWalls,
      exteriorWallIds: allExterior,
      windowAreaByWallId: new Map([['right', 40], ['top', 12]]),
      interiorPoint: CENTRE,
    });
    expect(out).toEqual({ exposure: 'E', basis: 'glass' });
  });

  it('uses the longest exterior wall when the room has no glass', () => {
    const wide = [
      { id: 'top', x1: 0, y1: 0, x2: 400, y2: 0 },
      { id: 'right', x1: 400, y1: 0, x2: 400, y2: 100 },
    ];
    const out = roomExposure({
      walls: wide,
      exteriorWallIds: new Set(['top', 'right']),
      windowAreaByWallId: new Map(),
      interiorPoint: { x: 200, y: 50 },
    });
    expect(out).toEqual({ exposure: 'N', basis: 'longest_exterior_wall' });
  });

  it('ignores glass on an interior partition', () => {
    // A big interior opening must not decide the room's solar exposure.
    const out = roomExposure({
      walls: allWalls,
      exteriorWallIds: new Set(['top']),
      windowAreaByWallId: new Map([['bottom', 100], ['top', 5]]),
      interiorPoint: CENTRE,
    });
    expect(out).toEqual({ exposure: 'N', basis: 'glass' });
  });

  it('falls back to the longest wall of any kind for a fully interior room', () => {
    const out = roomExposure({
      walls: allWalls,
      exteriorWallIds: new Set(),
      windowAreaByWallId: new Map(),
      interiorPoint: CENTRE,
    });
    expect(out.basis).toBe('longest_wall');
    expect(out.exposure).not.toBeNull();
  });

  it('reports undeterminable rather than guessing when there are no walls', () => {
    const out = roomExposure({
      walls: [],
      exteriorWallIds: new Set(),
      windowAreaByWallId: new Map(),
      interiorPoint: CENTRE,
    });
    expect(out).toEqual({ exposure: null, basis: 'undeterminable' });
  });

  it('breaks a glass-area tie toward the longer wall', () => {
    const walls = [
      { id: 'short', x1: 0, y1: 0, x2: 50, y2: 0 },
      { id: 'long', x1: 200, y1: 0, x2: 200, y2: 300 },
    ];
    const out = roomExposure({
      walls,
      exteriorWallIds: new Set(['short', 'long']),
      windowAreaByWallId: new Map([['short', 20], ['long', 20]]),
      interiorPoint: { x: 100, y: 150 },
    });
    expect(out.exposure).toBe('E');
    expect(out.basis).toBe('glass');
  });
});

describe('wallLength', () => {
  it('measures in the units given', () => {
    expect(wallLength({ x1: 0, y1: 0, x2: 3, y2: 4 })).toBe(5);
  });
});

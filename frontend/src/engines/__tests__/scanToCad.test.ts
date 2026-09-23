import { describe, it, expect } from 'vitest';
import { parseRoomPlanJson } from '../roomScan';
import { buildScanTakeoff, SHARED_WALL_TOL_FT, SCAN_DEFAULT_WALL_R } from '../scanToCad';
import { exteriorWallIds } from '../orientation';
import { rectRoomFixture, twoRoomStructureFixture } from './roomScanFixtures';

// scanToCad protects measured truth on its way onto the canvas: true feet at
// the project scale, shared walls melded so partition detection works, and
// provenance stamped so nothing downstream can mistake a measurement for a
// guess. Areas are asserted to 9 decimals — the scan had the precision, the
// bridge must not spend it.

const PX_PER_FT = 40;
const PLACE = { originX: 100, originY: 100, rotationDeg: 0 };

function rectTakeoff(captureId: string | null = 'cap-1') {
  const model = parseRoomPlanJson(rectRoomFixture())!;
  return buildScanTakeoff(model, PX_PER_FT, PLACE, captureId);
}

describe('buildScanTakeoff — placement and truth', () => {
  it('lands the scan bbox at the placement origin at the project scale', () => {
    const res = rectTakeoff();
    const xs = res.walls.flatMap(w => [w.x1, w.x2]);
    const ys = res.walls.flatMap(w => [w.y1, w.y2]);
    expect(Math.min(...xs)).toBeCloseTo(100, 6);
    expect(Math.min(...ys)).toBeCloseTo(100, 6);
    expect(Math.max(...xs)).toBeCloseTo(100 + 12 * PX_PER_FT, 6);
    expect(Math.max(...ys)).toBeCloseTo(100 + 10 * PX_PER_FT, 6);
  });

  it('keeps full decimal precision in room area and perimeter (feet-frame math)', () => {
    const res = rectTakeoff();
    expect(res.rooms).toHaveLength(1);
    expect(res.rooms[0].areaSqFt).toBeCloseTo(120, 9);
    expect(res.rooms[0].perimeterFt).toBeCloseTo(44, 9);
  });

  it('stamps provenance, capture linkage, confidence, and honest defaults', () => {
    const res = rectTakeoff('cap-42');
    for (const w of res.walls) {
      expect(w.provenance).toBe('scan');
      expect(w.captureId).toBe('cap-42');
      expect(w.measureConfidence).toBe('high');
      expect(w.rValue).toBe(SCAN_DEFAULT_WALL_R); // geometry measured, assembly NOT
      expect(w.material).toBe('insulated_stud');
    }
    for (const o of res.openings) {
      expect(o.provenance).toBe('scan');
      expect(o.uFactor).toBeUndefined(); // the scan measured size, not glazing
      expect(o.shgc).toBeUndefined();
    }
    expect(res.rooms[0].provenance).toBe('scan');
  });

  it('omits captureId entirely when the upload never reached the server', () => {
    const res = rectTakeoff(null);
    expect('captureId' in res.walls[0]).toBe(false);
    expect(res.walls[0].provenance).toBe('scan');
  });

  it('carries the window and door onto kept walls with true dimensions', () => {
    const res = rectTakeoff();
    expect(res.openings).toHaveLength(2);
    const win = res.openings.find(o => o.type === 'window')!;
    expect(win.widthIn).toBeCloseTo(36, 6);
    expect(win.heightIn).toBeCloseTo(48, 6);
    expect(win.positionAlongWall).toBeCloseTo(0.25, 9);
    expect(res.walls.some(w => w.id === win.wallId)).toBe(true);
    const door = res.openings.find(o => o.type === 'door')!;
    expect(door.positionAlongWall).toBeCloseTo(0.5, 9);
  });

  it('passes the measured ceiling through for the reviewer to apply', () => {
    expect(rectTakeoff().ceilingHeightFt).toBeCloseTo(8, 9);
  });
});

describe('buildScanTakeoff — north alignment', () => {
  it('rotating 90° turns horizontal walls vertical without touching area', () => {
    const model = parseRoomPlanJson(rectRoomFixture())!;
    const res = buildScanTakeoff(model, PX_PER_FT, { ...PLACE, rotationDeg: 90 }, null);
    // The 12 ft walls were horizontal; now they must be vertical.
    const long = res.walls.filter(w => Math.hypot(w.x2 - w.x1, w.y2 - w.y1) > 11 * PX_PER_FT);
    expect(long).toHaveLength(2);
    for (const w of long) expect(Math.abs(w.x2 - w.x1)).toBeLessThan(1e-6);
    expect(res.rooms[0].areaSqFt).toBeCloseTo(120, 9);
    // Rotated bbox still lands at the origin.
    const xs = res.walls.flatMap(w => [w.x1, w.x2]);
    expect(Math.min(...xs)).toBeCloseTo(100, 6);
  });
});

describe('buildScanTakeoff — shared-wall merge', () => {
  it('melds the two copies of a shared wall so it reads as a partition', () => {
    const model = parseRoomPlanJson(twoRoomStructureFixture())!;
    expect(model.walls).toHaveLength(8);
    const res = buildScanTakeoff(model, PX_PER_FT, PLACE, 'cap-2');
    expect(res.walls).toHaveLength(7);
    expect(res.mergedWallCount).toBe(1);

    // Both rooms reference the survivor → orientation.ts sees a partition.
    const shared = res.rooms[0].wallIds.filter(id => res.rooms[1].wallIds.includes(id));
    expect(shared).toHaveLength(1);
    const exterior = exteriorWallIds(res.rooms);
    expect(exterior.has(shared[0])).toBe(false);
    expect(exterior.size).toBe(6);
  });

  it('mirrors an opening that rode a reversed copy onto the surviving wall', () => {
    const model = parseRoomPlanJson(twoRoomStructureFixture())!;
    const res = buildScanTakeoff(model, PX_PER_FT, PLACE, null);
    const win = res.openings.find(o => o.type === 'window')!;
    // On room B's copy it sat at 0.3 measured from (12,10); the survivor runs
    // (12,0)→(12,10), so the same physical spot is 0.7.
    expect(win.positionAlongWall).toBeCloseTo(0.7, 9);
    // And it hangs on the shared wall both rooms reference.
    const shared = res.rooms[0].wallIds.filter(id => res.rooms[1].wallIds.includes(id));
    expect(win.wallId).toBe(shared[0]);
  });

  it('never merges walls farther apart than the physical tolerance', () => {
    // Two parallel corridor walls 3 ft apart must stay two walls.
    expect(SHARED_WALL_TOL_FT).toBeLessThan(3);
    const model = parseRoomPlanJson(twoRoomStructureFixture())!;
    const res = buildScanTakeoff(model, PX_PER_FT, PLACE, null);
    // a-north and b-north are collinear but end-to-end (touching at x=12),
    // not coincident — they must NOT merge.
    const horizontalTop = res.walls.filter(w => Math.abs(w.y1 - 100) < 1e-6 && Math.abs(w.y2 - 100) < 1e-6);
    expect(horizontalTop).toHaveLength(2);
  });
});

describe('buildScanTakeoff — honesty on gaps', () => {
  it('imports walls but not the room when the scan has no floor outline', () => {
    const model = parseRoomPlanJson(rectRoomFixture())!;
    const noPoly = { ...model, rooms: model.rooms.map(r => ({ ...r, polygon: null })) };
    const res = buildScanTakeoff(noPoly, PX_PER_FT, PLACE, null);
    expect(res.walls).toHaveLength(4);
    expect(res.rooms).toHaveLength(0);
    expect(res.warnings.some(w => w.includes('no floor outline'))).toBe(true);
  });

  it('computes an L-shaped floor exactly, not from a bounding box', () => {
    const model = parseRoomPlanJson(rectRoomFixture())!;
    const lShape = {
      ...model,
      rooms: [{
        ...model.rooms[0],
        polygon: [
          { x: 0, y: 0 }, { x: 12, y: 0 }, { x: 12, y: 4 },
          { x: 6, y: 4 }, { x: 6, y: 10 }, { x: 0, y: 10 },
        ],
      }],
    };
    const res = buildScanTakeoff(lShape, PX_PER_FT, PLACE, null);
    // 12×10 bbox = 120; the true L is 12·4 + 6·6 = 84.
    expect(res.rooms[0].areaSqFt).toBeCloseTo(84, 9);
  });
});

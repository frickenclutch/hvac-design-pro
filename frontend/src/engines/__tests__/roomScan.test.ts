import { describe, it, expect } from 'vitest';
import { parseRoomPlanJson, METERS_TO_FEET } from '../roomScan';
import { FT_TO_M, rectRoomFixture, twoRoomStructureFixture, wallJson, roomJson, openingJson } from './roomScanFixtures';

// The parser is a trust boundary: real RoomPlan exports (and the app-mangled
// variants of them) on one side, plan-feet ScanModel truth on the other.
// Tolerances here are tight on purpose — meters→feet is exact arithmetic, and
// any slack would hide precision loss the platform's rule 7 forbids.

const CLOSE = 9; // decimal places

describe('parseRoomPlanJson — single CapturedRoom', () => {
  it('parses walls with true lengths, heights, and the measured ceiling', () => {
    const model = parseRoomPlanJson(rectRoomFixture());
    expect(model).not.toBeNull();
    expect(model!.source).toBe('captured_room');
    expect(model!.walls).toHaveLength(4);

    const lengths = model!.walls
      .map(w => Math.hypot(w.x2 - w.x1, w.y2 - w.y1))
      .sort((a, b) => a - b);
    expect(lengths[0]).toBeCloseTo(10, CLOSE);
    expect(lengths[1]).toBeCloseTo(10, CLOSE);
    expect(lengths[2]).toBeCloseTo(12, CLOSE);
    expect(lengths[3]).toBeCloseTo(12, CLOSE);

    for (const w of model!.walls) expect(w.heightFt).toBeCloseTo(8, CLOSE);
    expect(model!.ceilingHeightFt).toBeCloseTo(8, CLOSE);
  });

  it('names the room from its section label, title-cased, with a floor outline', () => {
    const model = parseRoomPlanJson(rectRoomFixture())!;
    expect(model.rooms).toHaveLength(1);
    expect(model.rooms[0].name).toBe('Living Room');
    expect(model.rooms[0].polygon).toHaveLength(4);
    // Polygon corners come back in plan feet.
    const xs = model.rooms[0].polygon!.map(p => p.x);
    expect(Math.max(...xs)).toBeCloseTo(12, CLOSE);
  });

  it('attaches a parent-linked window at the right fraction with true inch dims', () => {
    const model = parseRoomPlanJson(rectRoomFixture())!;
    const win = model.openings.find(o => o.kind === 'window')!;
    expect(win).toBeDefined();
    expect(win.wallId).toBe('w-north');
    // Centered 3 ft along a 12 ft wall.
    expect(win.positionAlongWall).toBeCloseTo(0.25, CLOSE);
    expect(win.widthIn).toBeCloseTo(36, 6);
    expect(win.heightIn).toBeCloseTo(48, 6);
  });

  it('attaches an unlinked door to the nearest wall (fallback path)', () => {
    const model = parseRoomPlanJson(rectRoomFixture())!;
    const door = model.openings.find(o => o.kind === 'door')!;
    expect(door).toBeDefined();
    expect(door.wallId).toBe('w-south');
    expect(door.positionAlongWall).toBeCloseTo(0.5, CLOSE);
  });

  it('defaults wall thickness when the scan measured ~none, passes it through when real', () => {
    const thin = roomJson({ walls: [wallJson(0, 0, 10, 0, { thicknessM: 0.01 })] });
    expect(parseRoomPlanJson(thin)!.walls[0].thicknessIn).toBe(6);

    const real = roomJson({ walls: [wallJson(0, 0, 10, 0, { thicknessM: 0.1524 })] });
    expect(parseRoomPlanJson(real)!.walls[0].thicknessIn).toBeCloseTo(6, 6); // 0.1524 m IS 6 in
  });

  it('reads confidence in both encoder shapes and lowballs the unreadable', () => {
    const m = parseRoomPlanJson(roomJson({
      walls: [
        wallJson(0, 0, 10, 0, { id: 'c-str', confidence: 'medium' }),
        wallJson(0, 2, 10, 2, { id: 'c-key', confidence: { low: {} } }),
        wallJson(0, 4, 10, 4, { id: 'c-missing', confidence: 42 }),
      ],
    }))!;
    const byId = new Map(m.walls.map(w => [w.id, w.confidence]));
    expect(byId.get('c-str')).toBe('medium');
    expect(byId.get('c-key')).toBe('low');
    expect(byId.get('c-missing')).toBe('low');
  });

  it('parses the nested four-column transform encoding identically to flat', () => {
    const flat = parseRoomPlanJson(roomJson({ walls: [wallJson(2, 3, 14, 3)] }))!;
    const nested = parseRoomPlanJson(roomJson({ walls: [wallJson(2, 3, 14, 3, { nestedTransform: true })] }))!;
    expect(nested.walls[0].x1).toBeCloseTo(flat.walls[0].x1, CLOSE);
    expect(nested.walls[0].y1).toBeCloseTo(flat.walls[0].y1, CLOSE);
    expect(nested.walls[0].x2).toBeCloseTo(flat.walls[0].x2, CLOSE);
    expect(nested.walls[0].y2).toBeCloseTo(flat.walls[0].y2, CLOSE);
  });

  it('accepts the { capturedRoom: {...} } wrapper some apps export', () => {
    const model = parseRoomPlanJson({ capturedRoom: rectRoomFixture() });
    expect(model).not.toBeNull();
    expect(model!.walls).toHaveLength(4);
  });
});

describe('parseRoomPlanJson — damage tolerance', () => {
  it('returns null when there is no capture to read', () => {
    expect(parseRoomPlanJson(null)).toBeNull();
    expect(parseRoomPlanJson('a string')).toBeNull();
    expect(parseRoomPlanJson({ notRoomPlan: true })).toBeNull();
    expect(parseRoomPlanJson({ walls: 'corrupt' })).toBeNull();
    expect(parseRoomPlanJson(roomJson({ walls: [] }))).toBeNull();
  });

  it('skips a corrupt wall with a warning instead of discarding the scan', () => {
    const bad = { ...wallJson(0, 0, 10, 0), transform: [1, 2, 3] };
    const model = parseRoomPlanJson(roomJson({ walls: [bad, wallJson(0, 5, 10, 5)] }))!;
    expect(model.walls).toHaveLength(1);
    expect(model.warnings.some(w => w.includes('unreadable'))).toBe(true);
  });

  it('drops sub-noise walls and NaN dimensions the same way', () => {
    const tiny = wallJson(0, 0, 0.2, 0); // below MIN_WALL_FT
    const nan = { ...wallJson(0, 2, 10, 2), dimensions: [Number.NaN, 2.4, 0] };
    const model = parseRoomPlanJson(roomJson({ walls: [tiny, nan, wallJson(0, 4, 10, 4)] }))!;
    expect(model.walls).toHaveLength(1);
  });

  it('drops an opening too far from every wall, with a warning', () => {
    const farWindow = openingJson(6, 5, 1, 0, 3, 4); // 5 ft from the only wall
    const model = parseRoomPlanJson(roomJson({ walls: [wallJson(0, 0, 12, 0)], windows: [farWindow] }))!;
    expect(model.openings).toHaveLength(0);
    expect(model.warnings.some(w => w.includes('could not be attached'))).toBe(true);
  });
});

describe('parseRoomPlanJson — CapturedStructure', () => {
  it('keeps each room and every wall copy (geometric merge is scanToCad, not here)', () => {
    const model = parseRoomPlanJson(twoRoomStructureFixture())!;
    expect(model.source).toBe('captured_structure');
    expect(model.rooms).toHaveLength(2);
    expect(model.walls).toHaveLength(8);
    expect(model.rooms.map(r => r.name).sort()).toEqual(['Dining', 'Kitchen']);
  });

  it('dedupes a shared entity listed under one identifier in both rooms', () => {
    const fixture = twoRoomStructureFixture();
    const sharedDoor = { ...openingJson(12, 5, 0, 1, 3, 6.7, { id: 'shared-door', parentIdentifier: 'a-east' }), category: { door: { isOpen: true } } };
    const sharedDoorB = { ...sharedDoor, parentIdentifier: 'b-west' };
    (fixture.rooms[0] as { doors: unknown[] }).doors = [sharedDoor];
    (fixture.rooms[1] as { doors: unknown[] }).doors = [sharedDoorB];
    const model = parseRoomPlanJson(fixture)!;
    expect(model.openings.filter(o => o.id === 'shared-door')).toHaveLength(1);
  });

  it('keeps the dominant story of a multi-story capture and says what it left', () => {
    const upstairs = roomJson({
      identifier: 'room-up',
      walls: [wallJson(0, 0, 10, 0, { id: 'up-1', story: 2 })],
    });
    const fixture = { version: 1, identifier: 's', rooms: [rectRoomFixture(), upstairs] };
    const model = parseRoomPlanJson(fixture)!;
    expect(model.walls).toHaveLength(4); // story 1 has 4 walls, story 2 has 1
    expect(model.rooms).toHaveLength(1);
    expect(model.warnings.some(w => w.includes('Multi-story'))).toBe(true);
  });
});

describe('unit conversion', () => {
  it('meters→feet is the exact reciprocal of the survey foot', () => {
    expect(1 * FT_TO_M * METERS_TO_FEET).toBeCloseTo(1, 12);
  });

  it('notes passages without importing them', () => {
    const fixture = roomJson({
      walls: [wallJson(0, 0, 12, 0)],
      openings: [openingJson(6, 0, 1, 0, 3, 6.7)],
    });
    const model = parseRoomPlanJson(fixture)!;
    expect(model.openings).toHaveLength(0);
    expect(model.warnings.some(w => w.includes('passage'))).toBe(true);
  });

  it('warns on a height spread that suggests sloped or split-level areas', () => {
    const model = parseRoomPlanJson(roomJson({
      walls: [wallJson(0, 0, 10, 0, { heightFt: 8 }), wallJson(0, 5, 10, 5, { heightFt: 10 })],
    }))!;
    expect(model.warnings.some(w => w.includes('vary'))).toBe(true);
  });
});

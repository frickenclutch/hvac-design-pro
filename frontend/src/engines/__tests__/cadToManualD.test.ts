import { describe, it, expect } from 'vitest';
import { measureCadDucts, manualJRoomId, cadRoomId } from '../cadToManualD';
import type { Floor, DuctSegment, DuctFitting, DetectedRoom } from '../../features/cad/store/useCadStore';

const PX_PER_FT = 40;

const room = (id: string, name: string): DetectedRoom => ({
  id, name, wallIds: [], areaSqFt: 120, perimeterFt: 44,
  centroid: { x: 0, y: 0 }, color: '#34d399',
});

const seg = (over: Partial<DuctSegment> & { id: string }): DuctSegment => ({
  x1: 0, y1: 0, x2: 0, y2: 0,
  shape: 'round', material: 'sheet_metal', side: 'supply', role: 'branch',
  fabricId: '', ...over,
});

const fit = (over: Partial<DuctFitting> & { id: string; type: DuctFitting['type'] }): DuctFitting => ({
  x: 0, y: 0, rotation: 0, shape: 'round', equivLengthFt: 10, fabricId: '', ...over,
});

const floor = (over: Partial<Floor>): Floor => ({
  id: 'floor-1', name: 'Floor 1', index: 0, heightFt: 9, isVisible: true, isLocked: false,
  walls: [], openings: [], rooms: [], hvacUnits: [], pipes: [],
  ductSegments: [], ductFittings: [], ductSystems: [], radiantZones: [],
  annotations: [], underlays: [], ...over,
});

describe('room id translation', () => {
  it('round-trips a CAD room id through the Manual J form', () => {
    expect(manualJRoomId('abc')).toBe('cad-room-abc');
    expect(cadRoomId('cad-room-abc')).toBe('abc');
  });

  it('returns null for a room that did not come from CAD', () => {
    expect(cadRoomId('hand-typed-room-1')).toBeNull();
  });
});

describe('measureCadDucts', () => {
  it('sums a room\'s drawn supply run and converts px to feet', () => {
    // 400px + 200px = 600px at 40 px/ft = 15 ft
    const f = floor({
      rooms: [room('r1', 'Bedroom')],
      ductSegments: [
        seg({ id: 's1', roomId: 'r1', x1: 0, y1: 0, x2: 400, y2: 0 }),
        seg({ id: 's2', roomId: 'r1', x1: 400, y1: 0, x2: 400, y2: 200 }),
      ],
    });
    const out = measureCadDucts([f], PX_PER_FT);

    expect(out.measurements).toHaveLength(1);
    expect(out.measurements[0].measuredLengthFt).toBeCloseTo(15, 5);
    expect(out.measurements[0].segmentCount).toBe(2);
    expect(out.overrides['cad-room-r1'].actualLengthFt).toBeCloseTo(15, 5);
    expect(out.unmeasuredRoomNames).toHaveLength(0);
  });

  it('keys overrides by the Manual J room id, not the CAD id', () => {
    const f = floor({
      rooms: [room('r1', 'Bedroom')],
      ductSegments: [seg({ id: 's1', roomId: 'r1', x1: 0, y1: 0, x2: 400, y2: 0 })],
    });
    const out = measureCadDucts([f], PX_PER_FT);
    expect(Object.keys(out.overrides)).toEqual(['cad-room-r1']);
  });

  it('counts only supply segments — returns are a separate path', () => {
    const f = floor({
      rooms: [room('r1', 'Bedroom')],
      ductSegments: [
        seg({ id: 's1', roomId: 'r1', side: 'supply', x1: 0, y1: 0, x2: 400, y2: 0 }),
        seg({ id: 's2', roomId: 'r1', side: 'return', x1: 0, y1: 0, x2: 800, y2: 0 }),
      ],
    });
    const out = measureCadDucts([f], PX_PER_FT);
    expect(out.measurements[0].measuredLengthFt).toBeCloseTo(10, 5);
    expect(out.measurements[0].segmentCount).toBe(1);
  });

  it('tallies fittings attached to the room\'s segments by inlet or outlet', () => {
    const f = floor({
      rooms: [room('r1', 'Bedroom')],
      ductSegments: [seg({ id: 's1', roomId: 'r1', x1: 0, y1: 0, x2: 400, y2: 0 })],
      ductFittings: [
        fit({ id: 'f1', type: 'elbow_90', inletSegmentId: 's1' }),
        fit({ id: 'f2', type: 'elbow_90', outletSegmentIds: ['s1'] }),
        fit({ id: 'f3', type: 'register_boot', inletSegmentId: 's1' }),
        fit({ id: 'f4', type: 'wye', inletSegmentId: 'other-seg' }), // different run
      ],
    });
    const out = measureCadDucts([f], PX_PER_FT);
    const fittings = out.measurements[0].fittings;
    expect(fittings).toContainEqual({ type: 'elbow_90', qty: 2 });
    expect(fittings).toContainEqual({ type: 'register_boot', qty: 1 });
    expect(fittings.some(x => x.type === 'wye')).toBe(false);
  });

  it('omits fittings from the override when none were drawn, so the bridge supplies its standard set', () => {
    // Emitting `fittings: []` would size the run with zero equivalent length
    // and undersize the duct.
    const f = floor({
      rooms: [room('r1', 'Bedroom')],
      ductSegments: [seg({ id: 's1', roomId: 'r1', x1: 0, y1: 0, x2: 400, y2: 0 })],
    });
    const out = measureCadDucts([f], PX_PER_FT);
    expect(out.overrides['cad-room-r1'].actualLengthFt).toBeCloseTo(10, 5);
    expect(out.overrides['cad-room-r1'].fittings).toBeUndefined();
  });

  it('leaves rooms with no drawn ducts unmeasured rather than claiming zero', () => {
    const f = floor({
      rooms: [room('r1', 'Bedroom'), room('r2', 'Kitchen')],
      ductSegments: [seg({ id: 's1', roomId: 'r1', x1: 0, y1: 0, x2: 400, y2: 0 })],
    });
    const out = measureCadDucts([f], PX_PER_FT);
    expect(out.measurements.map(m => m.roomName)).toEqual(['Bedroom']);
    expect(out.unmeasuredRoomNames).toEqual(['Kitchen']);
    expect(out.overrides['cad-room-r2']).toBeUndefined();
  });

  it('reports segments drawn but never assigned to a room', () => {
    const f = floor({
      rooms: [room('r1', 'Bedroom')],
      ductSegments: [
        seg({ id: 's1', roomId: 'r1', x1: 0, y1: 0, x2: 400, y2: 0 }),
        seg({ id: 's2', x1: 0, y1: 0, x2: 400, y2: 0 }),
        seg({ id: 's3', x1: 0, y1: 0, x2: 400, y2: 0 }),
      ],
    });
    const out = measureCadDucts([f], PX_PER_FT);
    expect(out.unassignedSegmentCount).toBe(2);
    expect(out.totalSegmentCount).toBe(3);
  });

  it('measures across multiple floors', () => {
    const f1 = floor({
      id: 'floor-1', rooms: [room('r1', 'Bedroom')],
      ductSegments: [seg({ id: 's1', roomId: 'r1', x1: 0, y1: 0, x2: 400, y2: 0 })],
    });
    const f2 = floor({
      id: 'floor-2', rooms: [room('r2', 'Loft')],
      ductSegments: [seg({ id: 's2', roomId: 'r2', x1: 0, y1: 0, x2: 800, y2: 0 })],
    });
    const out = measureCadDucts([f1, f2], PX_PER_FT);
    expect(out.measurements).toHaveLength(2);
    expect(out.overrides['cad-room-r1'].actualLengthFt).toBeCloseTo(10, 5);
    expect(out.overrides['cad-room-r2'].actualLengthFt).toBeCloseTo(20, 5);
  });

  it('refuses to measure on an unusable scale instead of emitting Infinity feet', () => {
    const f = floor({
      rooms: [room('r1', 'Bedroom')],
      ductSegments: [seg({ id: 's1', roomId: 'r1', x1: 0, y1: 0, x2: 400, y2: 0 })],
    });
    for (const bad of [0, -40, NaN, Infinity]) {
      const out = measureCadDucts([f], bad);
      expect(out.measurements).toHaveLength(0);
      expect(out.unmeasuredRoomNames).toEqual(['Bedroom']);
      expect(Object.keys(out.overrides)).toHaveLength(0);
    }
  });

  it('ignores a zero-length segment rather than overriding with 0 ft', () => {
    const f = floor({
      rooms: [room('r1', 'Bedroom')],
      ductSegments: [seg({ id: 's1', roomId: 'r1', x1: 100, y1: 100, x2: 100, y2: 100 })],
    });
    const out = measureCadDucts([f], PX_PER_FT);
    expect(out.measurements).toHaveLength(0);
    expect(out.unmeasuredRoomNames).toEqual(['Bedroom']);
  });
});

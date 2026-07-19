/**
 * HVAC DesignPro — CAD to Manual D Bridge
 *
 * Makes drawn duct geometry the measurement of record for duct sizing.
 *
 * Manual D's own bridge (manualJToManualD.ts) estimates each run's length
 * from a CFM bucket and assumes a fixed three-fitting set, and says plainly
 * that "duct run lengths and fittings must be measured/counted from actual
 * floor plans." When the designer HAS drawn the system in CAD, those actual
 * measurements already exist — segment endpoints and typed fittings — and
 * this module hands them to the bridge through its `roomOverrides` seam.
 *
 * The honesty rule throughout: a room only gets an override if something was
 * actually drawn for it. Rooms with no ducts are left alone so the bridge's
 * estimate still applies, and the caller is told exactly which rooms were
 * measured and which were not — an unmeasured room must never masquerade as
 * a measured one on a document that goes out for permit.
 */

import type { Floor } from '../features/cad/store/useCadStore';
import type { ManualDRoomOverride } from './manualJToManualD';
import type { FittingType } from './manualD';

/** Prefix cadToManualJ stamps onto CAD room ids when creating Manual J rooms. */
const MJ_ROOM_PREFIX = 'cad-room-';

/** Manual J room id for a CAD room. Keep in step with cadToManualJ.ts. */
export function manualJRoomId(cadRoomId: string): string {
  return `${MJ_ROOM_PREFIX}${cadRoomId}`;
}

/**
 * CAD room id for a Manual J room id, or null when the room did not come from
 * CAD. Duct segments store the BARE CAD id, so any join between Manual D runs
 * and drawn ducts has to go through this.
 */
export function cadRoomId(manualJRoomId: string): string | null {
  return manualJRoomId.startsWith(MJ_ROOM_PREFIX)
    ? manualJRoomId.slice(MJ_ROOM_PREFIX.length)
    : null;
}

export interface CadDuctMeasurement {
  /** CAD room id. */
  roomId: string;
  roomName: string;
  /** Summed straight-run length of the segments assigned to this room. */
  measuredLengthFt: number;
  segmentCount: number;
  fittings: { type: FittingType; qty: number }[];
}

export interface CadDuctTakeoff {
  /** Keyed by MANUAL J room id, ready to pass as `roomOverrides`. */
  overrides: Record<string, ManualDRoomOverride>;
  measurements: CadDuctMeasurement[];
  /** Rooms that have no drawn ducts — these keep the bridge's estimate. */
  unmeasuredRoomNames: string[];
  /** Segments drawn but not assigned to any room, so not counted anywhere. */
  unassignedSegmentCount: number;
  totalSegmentCount: number;
}

/**
 * Measure the drawn duct system, per room, across every floor.
 *
 * Only SUPPLY segments count toward a run: Manual D sizes the supply path to
 * each register, and returns are a separate path that would double-count the
 * length if mixed in.
 *
 * A fitting belongs to a room's run when the segment it connects to belongs to
 * that room, which is how the CAD model already relates them
 * (inletSegmentId / outletSegmentIds).
 *
 * @param floors   CAD floors to measure
 * @param pxPerFt  canvas scale — the same ruler the rest of the app uses
 */
export function measureCadDucts(floors: Floor[], pxPerFt: number): CadDuctTakeoff {
  const measurements: CadDuctMeasurement[] = [];
  const unmeasuredRoomNames: string[] = [];
  let unassignedSegmentCount = 0;
  let totalSegmentCount = 0;

  // A non-finite or non-positive scale would turn every length into garbage
  // (Infinity/NaN feet). Refuse to measure rather than emit nonsense.
  const scaleUsable = Number.isFinite(pxPerFt) && pxPerFt > 0;

  for (const floor of floors) {
    const segments = floor.ductSegments ?? [];
    const fittings = floor.ductFittings ?? [];
    totalSegmentCount += segments.length;

    const supplyByRoom = new Map<string, typeof segments>();
    for (const seg of segments) {
      if (!seg.roomId) {
        unassignedSegmentCount++;
        continue;
      }
      if (seg.side !== 'supply') continue;
      const list = supplyByRoom.get(seg.roomId) ?? [];
      list.push(seg);
      supplyByRoom.set(seg.roomId, list);
    }

    for (const room of floor.rooms ?? []) {
      const roomSegments = supplyByRoom.get(room.id);
      if (!roomSegments || roomSegments.length === 0 || !scaleUsable) {
        unmeasuredRoomNames.push(room.name);
        continue;
      }

      let lengthPx = 0;
      for (const seg of roomSegments) {
        const d = Math.hypot(seg.x2 - seg.x1, seg.y2 - seg.y1);
        if (Number.isFinite(d)) lengthPx += d;
      }
      const measuredLengthFt = lengthPx / pxPerFt;
      if (!(measuredLengthFt > 0)) {
        unmeasuredRoomNames.push(room.name);
        continue;
      }

      const segmentIds = new Set(roomSegments.map(s => s.id));
      const tally = new Map<FittingType, number>();
      for (const f of fittings) {
        const touchesRoom =
          (f.inletSegmentId && segmentIds.has(f.inletSegmentId)) ||
          (f.outletSegmentIds ?? []).some(id => segmentIds.has(id));
        if (!touchesRoom) continue;
        tally.set(f.type, (tally.get(f.type) ?? 0) + 1);
      }

      measurements.push({
        roomId: room.id,
        roomName: room.name,
        measuredLengthFt: Math.round(measuredLengthFt * 100) / 100,
        segmentCount: roomSegments.length,
        fittings: [...tally.entries()].map(([type, qty]) => ({ type, qty })),
      });
    }
  }

  const overrides: Record<string, ManualDRoomOverride> = {};
  for (const m of measurements) {
    overrides[manualJRoomId(m.roomId)] = {
      actualLengthFt: m.measuredLengthFt,
      // An empty tally means the run genuinely has no drawn fittings. Leave
      // `fittings` undefined so the bridge supplies its standard set rather
      // than sizing the run with zero equivalent length, which would
      // understate total effective length and undersize the duct.
      ...(m.fittings.length > 0 ? { fittings: m.fittings } : {}),
    };
  }

  return {
    overrides,
    measurements,
    unmeasuredRoomNames,
    unassignedSegmentCount,
    totalSegmentCount,
  };
}

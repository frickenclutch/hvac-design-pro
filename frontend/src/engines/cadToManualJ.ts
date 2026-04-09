/**
 * CAD → Manual J Room Conversion
 * Converts detected rooms from the CAD floor plan into Manual J RoomInput entries.
 */

import type { Floor, DetectedRoom, WallSegment, Opening } from '../features/cad/store/useCadStore';
import type { RoomInput } from './manualJ';

interface ConvertedRoom extends RoomInput {
  cadRoomId: string; // back-reference to the CAD detected room
}

/**
 * Convert detected rooms from the active floor into Manual J room inputs.
 * Pulls wall R-values, window counts/areas, and door data from the floor's objects.
 */
export function convertCadRoomsToManualJ(
  floor: Floor,
  pxPerFt: number,
): ConvertedRoom[] {
  return floor.rooms.map((room, idx) => {
    // Gather walls belonging to this room
    const roomWalls = floor.walls.filter(w => room.wallIds.includes(w.id));

    // Compute average R-value from walls
    const avgRValue = roomWalls.length > 0
      ? roomWalls.reduce((sum, w) => sum + w.rValue, 0) / roomWalls.length
      : 13;

    // Gather openings attached to room walls
    const roomOpenings = floor.openings.filter(o =>
      room.wallIds.includes(o.wallId)
    );
    const windows = roomOpenings.filter(o => o.type === 'window');
    const doors = roomOpenings.filter(o => o.type === 'door' || o.type === 'sliding_door');

    // Sum window area
    const totalWindowSqFt = windows.reduce((sum, w) => {
      return sum + (w.widthIn * w.heightIn) / 144; // in² → ft²
    }, 0);

    // Average window U-Factor & SHGC
    const avgWindowU = windows.length > 0
      ? windows.reduce((s, w) => s + (w.uFactor ?? 0.30), 0) / windows.length
      : 0.30;
    const avgWindowSHGC = windows.length > 0
      ? windows.reduce((s, w) => s + (w.shgc ?? 0.25), 0) / windows.length
      : 0.25;

    // Estimate dimensions from area and perimeter
    // area = l * w, perimeter = 2(l + w)
    // Using area and perimeter to solve for l and w:
    const area = room.areaSqFt;
    const perim = room.perimeterFt;
    const halfPerim = perim / 2;
    // l + w = halfPerim, l * w = area
    // quadratic: x² - halfPerim*x + area = 0
    const discriminant = halfPerim * halfPerim - 4 * area;
    let lengthFt: number, widthFt: number;
    if (discriminant >= 0) {
      lengthFt = Math.round((halfPerim + Math.sqrt(discriminant)) / 2 * 10) / 10;
      widthFt = Math.round((halfPerim - Math.sqrt(discriminant)) / 2 * 10) / 10;
    } else {
      // Fallback: assume square
      lengthFt = Math.round(Math.sqrt(area) * 10) / 10;
      widthFt = lengthFt;
    }

    // Count exterior walls (heuristic: all walls in room are exterior by default)
    const exteriorWalls = roomWalls.length;

    return {
      cadRoomId: room.id,
      id: `cad-room-${room.id}`,
      name: room.name || `Room ${idx + 1}`,
      lengthFt: Math.max(lengthFt, 1),
      widthFt: Math.max(widthFt, 1),
      ceilingHeightFt: floor.heightFt ?? 9,
      exteriorWalls: Math.min(exteriorWalls, 4),
      wallRValue: Math.round(avgRValue),
      wallGrade: 'above' as const,
      belowGradeDepthFt: 0,
      windowSqFt: Math.round(totalWindowSqFt * 10) / 10,
      windowCount: windows.length,
      windowUValue: Math.round(avgWindowU * 100) / 100,
      windowSHGC: Math.round(avgWindowSHGC * 100) / 100,
      glassType: 'double_low_e' as const,
      interiorShading: 0.7,
      ceilingRValue: 38,
      floorRValue: 19,
      floorType: 'crawlspace' as const,
      exposureDirection: 'S' as const,
      occupantCount: Math.max(1, Math.round(area / 200)), // ~1 person per 200 sq ft
    };
  });
}

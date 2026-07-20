/**
 * CAD → Manual J Room Conversion
 * Converts detected rooms from the CAD floor plan into Manual J RoomInput entries.
 */

import type { Floor } from '../features/cad/store/useCadStore';
import type { RoomInput } from './manualJ';
import { type RoomType, ROOM_TYPE_PRESETS, APPLIANCE_LIBRARY, type ApplianceEntry } from './manualJ';
import { roomExposure, exteriorWallIds } from './orientation';
import type { RoomExposure } from './orientation';

/**
 * Guess room type from its name for auto-populating internal load presets.
 */
function guessRoomType(name: string): RoomType {
  const n = name.toLowerCase();
  if (/kitchen|cook|pantry/.test(n)) return 'kitchen';
  if (/bed|master|primary\s*bed|sleep|guest\s*suite/.test(n)) return 'bedroom';
  if (/bath|shower|wc|restroom|powder/.test(n)) return 'bathroom';
  if (/living|great\s*room|family|den/.test(n)) return 'living';
  if (/dining|eat/.test(n)) return 'dining';
  if (/office|study|work/.test(n)) return 'office';
  if (/laundry|wash/.test(n)) return 'laundry';
  if (/util|mechanic|furnace|boiler|hvac/.test(n)) return 'utility';
  if (/garage|carport/.test(n)) return 'garage';
  if (/gym|fitness|exercise/.test(n)) return 'fitness';
  if (/media|theater|theatre|cinema/.test(n)) return 'media';
  if (/library|reading|flex/.test(n)) return 'library';
  if (/hall|corridor|foyer|entry|lobby|stair|vestibule/.test(n)) return 'hallway';
  if (/closet|storage|attic/.test(n)) return 'custom';
  if (/studio/.test(n)) return 'media';
  return 'custom';
}

export interface ConvertedRoom extends RoomInput {
  cadRoomId: string; // back-reference to the CAD detected room
  floorId: string;
  floorName: string;
  /** How exposureDirection was arrived at, so the UI can flag weak cases. */
  exposureBasis: RoomExposure['basis'];
}

/** Used only when a room's geometry cannot yield any direction at all. */
const FALLBACK_EXPOSURE = 'S' as const;

/**
 * Convert detected rooms from the active floor into Manual J room inputs.
 * Pulls wall R-values, window counts/areas, and door data from the floor's objects.
 */
export function convertCadRoomsToManualJ(
  floor: Floor,
): ConvertedRoom[] {
  // Which walls face outdoors is a floor-level question — a wall is a partition
  // when two detected rooms both claim it — so resolve it once, not per room.
  const exteriorIds = exteriorWallIds(floor.rooms);

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

    // Only walls not shared with another room face outdoors. Counting every
    // wall as exterior (the previous behaviour) inflated envelope load on any
    // room bounded by partitions.
    const exteriorWalls = roomWalls.filter(w => exteriorIds.has(w.id)).length;

    // Solar exposure from the drawn geometry rather than a fixed constant.
    // Manual J applies the irradiance for this face to the room's entire glass
    // area, so stamping every room 'S' overstated gain on north-facing rooms
    // and understated it on south-facing ones — silently, on a document that
    // goes out for permit.
    const windowAreaByWallId = new Map<string, number>();
    for (const w of windows) {
      const areaFt2 = (w.widthIn * w.heightIn) / 144;
      if (areaFt2 > 0) {
        windowAreaByWallId.set(w.wallId, (windowAreaByWallId.get(w.wallId) ?? 0) + areaFt2);
      }
    }
    const exposure = roomExposure({
      walls: roomWalls,
      exteriorWallIds: exteriorIds,
      windowAreaByWallId,
      interiorPoint: room.centroid,
    });

    return {
      cadRoomId: room.id,
      floorId: floor.id,
      floorName: floor.name,
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
      exposureDirection: exposure.exposure ?? FALLBACK_EXPOSURE,
      exposureBasis: exposure.basis,
      // Internal loads from guessed room type
      roomType: guessRoomType(room.name),
      occupantCount: Math.max(ROOM_TYPE_PRESETS[guessRoomType(room.name)].occupants, Math.round(area / 200)),
      occupantActivity: ROOM_TYPE_PRESETS[guessRoomType(room.name)].activity,
      appliances: ROOM_TYPE_PRESETS[guessRoomType(room.name)].appliances.map(key => {
        const lib = APPLIANCE_LIBRARY[key];
        return lib
          ? { type: key, label: lib.label, sensibleBtu: lib.sensibleBtu, latentBtu: lib.latentBtu, count: 1 }
          : { type: key, label: key, sensibleBtu: 0, latentBtu: 0, count: 1 } as ApplianceEntry;
      }),
      lightingType: ROOM_TYPE_PRESETS[guessRoomType(room.name)].lighting,
      miscSensibleBtu: 0,
      miscLatentBtu: 0,
      miscDescription: '',
    };
  });
}

/**
 * Convert detected rooms from ALL floors into Manual J room inputs.
 * Returns rooms tagged with their source floor for grouping in the UI.
 */
export function convertAllFloorsToManualJ(floors: Floor[]): ConvertedRoom[] {
  return floors.flatMap(floor => convertCadRoomsToManualJ(floor));
}

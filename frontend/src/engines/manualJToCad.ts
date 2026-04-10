import type { RoomInput } from './manualJ';
import type { Floor, WallSegment, Opening, DetectedRoom } from '../features/cad/store/useCadStore';

export type LayoutAlgorithm = 'horizontal_strip' | 'grid' | 'l_shape';

export function generateCadFloorFromManualJ(
  rooms: RoomInput[],
  pxPerFt: number,
  algorithm: LayoutAlgorithm = 'horizontal_strip',
  floorIndex: number = 0,
): Floor {
  const floor: Floor = {
    id: `floor-${crypto.randomUUID()}`,
    name: 'Auto-Generated Floor',
    index: floorIndex,
    heightFt: rooms.length > 0 ? rooms[0].ceilingHeightFt : 9,
    isVisible: true,
    isLocked: false,
    walls: [],
    openings: [],
    rooms: [],
    hvacUnits: [],
    pipes: [],
    annotations: [],
    underlays: [],
  };

  if (rooms.length === 0) return floor;

  let currentX = 0; // In feet
  let currentY = 0; // In feet

  // Simple layout generators
  if (algorithm === 'horizontal_strip') {
    for (const room of rooms) {
      const w = room.widthFt;
      const h = room.lengthFt;

      const pxX = currentX * pxPerFt;
      const pxY = currentY * pxPerFt;
      const pxW = w * pxPerFt;
      const pxH = h * pxPerFt;

      // Create 4 walls
      createRoomWalls(floor, room, pxX, pxY, pxW, pxH, pxPerFt);

      currentX += w; // Move right for the next room
    }
  } else if (algorithm === 'grid') {
    const cols = Math.ceil(Math.sqrt(rooms.length));
    let rowHeight = 0;
    
    rooms.forEach((room, index) => {
      if (index > 0 && index % cols === 0) {
        currentX = 0;
        currentY += rowHeight;
        rowHeight = 0;
      }

      const w = room.widthFt;
      const h = room.lengthFt;
      
      rowHeight = Math.max(rowHeight, h);

      const pxX = currentX * pxPerFt;
      const pxY = currentY * pxPerFt;
      const pxW = w * pxPerFt;
      const pxH = h * pxPerFt;

      createRoomWalls(floor, room, pxX, pxY, pxW, pxH, pxPerFt);
      
      currentX += w;
    });
  } else if (algorithm === 'l_shape') {
    // Basic L-shape: half rooms go right, half go down
    const half = Math.ceil(rooms.length / 2);
    
    rooms.forEach((room, index) => {
      const w = room.widthFt;
      const h = room.lengthFt;
      
      const pxX = currentX * pxPerFt;
      const pxY = currentY * pxPerFt;
      const pxW = w * pxPerFt;
      const pxH = h * pxPerFt;

      createRoomWalls(floor, room, pxX, pxY, pxW, pxH, pxPerFt);
      
      if (index < half - 1) {
        // Move right
        currentX += w;
      } else if (index === half - 1) {
        // Pivot point - keep X, move down
        currentY += h;
      } else {
        // Move down
        currentY += h;
      }
    });
  }

  // Deduplicate walls (basic overlapping check)
  floor.walls = deduplicateWalls(floor.walls);

  return floor;
}

function createRoomWalls(
  floor: Floor, 
  room: RoomInput, 
  pxX: number, 
  pxY: number, 
  pxW: number, 
  pxH: number,
  pxPerFt: number
) {
  const thicknessIn = 6;
  const material = 'insulated_stud';

  const wallIds: string[] = [];

  // Top
  const topWall: WallSegment = {
    id: crypto.randomUUID(),
    x1: pxX, y1: pxY, x2: pxX + pxW, y2: pxY,
    thicknessIn, rValue: room.wallRValue, material, fabricId: ''
  };
  floor.walls.push(topWall);
  wallIds.push(topWall.id);

  // Right
  const rightWall: WallSegment = {
    id: crypto.randomUUID(),
    x1: pxX + pxW, y1: pxY, x2: pxX + pxW, y2: pxY + pxH,
    thicknessIn, rValue: room.wallRValue, material, fabricId: ''
  };
  floor.walls.push(rightWall);
  wallIds.push(rightWall.id);

  // Bottom
  const bottomWall: WallSegment = {
    id: crypto.randomUUID(),
    x1: pxX + pxW, y1: pxY + pxH, x2: pxX, y2: pxY + pxH,
    thicknessIn, rValue: room.wallRValue, material, fabricId: ''
  };
  floor.walls.push(bottomWall);
  wallIds.push(bottomWall.id);

  // Left
  const leftWall: WallSegment = {
    id: crypto.randomUUID(),
    x1: pxX, y1: pxY + pxH, x2: pxX, y2: pxY,
    thicknessIn, rValue: room.wallRValue, material, fabricId: ''
  };
  floor.walls.push(leftWall);
  wallIds.push(leftWall.id);

  // Add windows
  if (room.windowCount > 0) {
    const windowWidthPx = Math.sqrt(room.windowSqFt / room.windowCount) * pxPerFt;
    // Attempt to place window on the "Left" wall (assuming it's an exterior wall in horizontal strip)
    const opening: Opening = {
      id: crypto.randomUUID(),
      type: 'window',
      wallId: leftWall.id,
      positionAlongWall: 0.5,
      widthIn: (windowWidthPx / pxPerFt) * 12, // convert back to inches
      heightIn: 48,
      uFactor: room.windowUValue,
      shgc: room.windowSHGC,
      glassType: room.glassType,
      fabricId: ''
    };
    floor.openings.push(opening);
  }

  const dRoom: DetectedRoom = {
    id: crypto.randomUUID(),
    name: room.name,
    wallIds,
    areaSqFt: room.widthFt * room.lengthFt,
    perimeterFt: 2 * (room.widthFt + room.lengthFt),
    centroid: { x: pxX + pxW / 2, y: pxY + pxH / 2 },
    color: '#34d399'
  };
  floor.rooms.push(dRoom);
}

// Very basic deduplication of strictly identical walls
function deduplicateWalls(walls: WallSegment[]): WallSegment[] {
  const result: WallSegment[] = [];
  const epsilon = 0.1;

  for (const w of walls) {
    const isDup = result.some(r => 
      ((Math.abs(r.x1 - w.x1) < epsilon && Math.abs(r.y1 - w.y1) < epsilon && Math.abs(r.x2 - w.x2) < epsilon && Math.abs(r.y2 - w.y2) < epsilon) ||
       (Math.abs(r.x1 - w.x2) < epsilon && Math.abs(r.y1 - w.y2) < epsilon && Math.abs(r.x2 - w.x1) < epsilon && Math.abs(r.y2 - w.y1) < epsilon))
    );
    if (!isDup) result.push(w);
  }

  return result;
}

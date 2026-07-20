/**
 * Wall orientation — which way a drawn wall faces.
 *
 * Solar gain is driven by `exposureDirection`: Manual J multiplies a room's
 * entire glass area by the irradiance for that compass face, so an orientation
 * that is off by 180 degrees does not shade a result slightly, it scales the
 * room's whole solar term. This is the single place that decision is made.
 *
 * Screen coordinates are y-DOWN; compass reasoning is y-UP. Everything here
 * converts once, at the boundary, and then works in the y-up frame.
 */

import type { Exposure } from './manualJ';

export interface Seg {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface Pt {
  x: number;
  y: number;
}

/**
 * Math-convention angle (degrees, 0 = East / screen-right, counter-clockwise
 * positive) to an 8-point compass face. Screen "up" is treated as North, which
 * is the plan-drawing convention when no north arrow says otherwise.
 */
export function angleToExposure(angleDeg: number): Exposure {
  const a = ((angleDeg % 360) + 360) % 360;
  if (a >= 337.5 || a < 22.5) return 'E';
  if (a < 67.5) return 'NE';
  if (a < 112.5) return 'N';
  if (a < 157.5) return 'NW';
  if (a < 202.5) return 'W';
  if (a < 247.5) return 'SW';
  if (a < 292.5) return 'S';
  return 'SE';
}

/**
 * The compass face a wall presents to the outside.
 *
 * A wall segment has TWO normals and the geometry alone cannot say which one
 * faces out — that depends on which way round the wall happened to be drawn.
 * Passing `interiorPoint` (a point known to be inside the space, e.g. the
 * room's centroid) resolves it exactly: the outward normal is the one pointing
 * away from that point. Without it, this falls back to the legacy assumption
 * that the outward side is 90 degrees counter-clockwise from the direction of
 * travel, which is correct only for consistently-wound rooms.
 *
 * Returns null for a zero-length or non-finite wall rather than inventing a
 * direction — the caller decides what an undeterminable wall means.
 */
export function wallExposure(wall: Seg, interiorPoint?: Pt | null): Exposure | null {
  const dx = wall.x2 - wall.x1;
  const dy = wall.y2 - wall.y1;
  if (![dx, dy].every(Number.isFinite)) return null;
  if (Math.hypot(dx, dy) === 0) return null;

  // Direction of travel in the y-up frame, then rotated 90deg CCW to a normal.
  // (This candidate reproduces the previous +90 convention exactly.)
  let nx = dy;
  let ny = dx;

  if (interiorPoint && Number.isFinite(interiorPoint.x) && Number.isFinite(interiorPoint.y)) {
    // Point the normal away from the interior. Both points are converted into
    // the y-up frame first so the dot product agrees with the normal's frame.
    const midX = (wall.x1 + wall.x2) / 2;
    const midY = -(wall.y1 + wall.y2) / 2;
    const interiorX = interiorPoint.x;
    const interiorY = -interiorPoint.y;
    const dot = nx * (midX - interiorX) + ny * (midY - interiorY);
    // dot === 0 means the centroid sits on the wall's line and cannot
    // disambiguate; keep the default candidate rather than flipping on noise.
    if (dot < 0) {
      nx = -nx;
      ny = -ny;
    }
  }

  return angleToExposure((Math.atan2(ny, nx) * 180) / Math.PI);
}

/** Length of a wall in whatever units its coordinates are in. */
export function wallLength(wall: Seg): number {
  return Math.hypot(wall.x2 - wall.x1, wall.y2 - wall.y1);
}

export interface RoomExposureInput {
  /** Walls belonging to the room. */
  walls: Array<Seg & { id: string }>;
  /** Ids of the room's walls that face outdoors. */
  exteriorWallIds: Set<string>;
  /** Glass area per wall id, in ft². Drives which face is "primary". */
  windowAreaByWallId: Map<string, number>;
  /** A point inside the room — the detected room's centroid. */
  interiorPoint?: Pt | null;
}

export interface RoomExposure {
  exposure: Exposure | null;
  /** How the answer was reached, so callers can explain or flag it. */
  basis: 'glass' | 'longest_exterior_wall' | 'longest_wall' | 'undeterminable';
}

/**
 * A room's primary exterior exposure.
 *
 * Manual J wants the face the room's glass looks out of, because that is what
 * the irradiance is applied to — so glass area wins when there is any. Falling
 * back through the longest exterior wall and then the longest wall of any kind
 * keeps a windowless or fully interior room from being assigned a direction
 * out of thin air; those cases are reported through `basis` instead.
 */
export function roomExposure(input: RoomExposureInput): RoomExposure {
  const { walls, exteriorWallIds, windowAreaByWallId, interiorPoint } = input;
  if (walls.length === 0) return { exposure: null, basis: 'undeterminable' };

  const exterior = walls.filter(w => exteriorWallIds.has(w.id));

  const pick = (
    candidates: Array<Seg & { id: string }>,
    score: (w: Seg & { id: string }) => number,
  ): (Seg & { id: string }) | null => {
    let best: (Seg & { id: string }) | null = null;
    let bestScore = 0;
    for (const w of candidates) {
      const s = score(w);
      // Ties break toward the longer wall, which is the more representative
      // face when two walls carry the same glass.
      if (s > bestScore || (s === bestScore && best && wallLength(w) > wallLength(best))) {
        best = w;
        bestScore = s;
      }
    }
    return bestScore > 0 ? best : null;
  };

  const glassWall = pick(exterior, w => windowAreaByWallId.get(w.id) ?? 0);
  if (glassWall) {
    const e = wallExposure(glassWall, interiorPoint);
    if (e) return { exposure: e, basis: 'glass' };
  }

  const longestExterior = pick(exterior, wallLength);
  if (longestExterior) {
    const e = wallExposure(longestExterior, interiorPoint);
    if (e) return { exposure: e, basis: 'longest_exterior_wall' };
  }

  const longestAny = pick(walls, wallLength);
  if (longestAny) {
    const e = wallExposure(longestAny, interiorPoint);
    if (e) return { exposure: e, basis: 'longest_wall' };
  }

  return { exposure: null, basis: 'undeterminable' };
}

/**
 * Wall ids on a floor that face outdoors.
 *
 * A wall referenced by two or more detected rooms separates them, so it is a
 * partition. Everything else is exterior. This replaces counting every wall in
 * a room as exterior, which inflated envelope load on interior rooms.
 */
export function exteriorWallIds(rooms: Array<{ wallIds: string[] }>): Set<string> {
  const roomsPerWall = new Map<string, number>();
  for (const room of rooms) {
    // A room listing the same wall twice must not make it look shared.
    for (const id of new Set(room.wallIds)) {
      roomsPerWall.set(id, (roomsPerWall.get(id) ?? 0) + 1);
    }
  }
  const exterior = new Set<string>();
  for (const [id, count] of roomsPerWall) {
    if (count < 2) exterior.add(id);
  }
  return exterior;
}

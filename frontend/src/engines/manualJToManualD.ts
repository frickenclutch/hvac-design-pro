/**
 * HVAC DesignPro — Manual J to Manual D Bridge
 *
 * Converts Manual J whole-house calculation results into Manual D
 * duct design inputs. This bridges the load calculation (Manual J)
 * to the duct sizing calculation (Manual D).
 *
 * The bridge:
 *  1. Distributes total system CFM proportionally to each room's
 *     cooling load (sensible + latent)
 *  2. Applies default duct run geometries that can be overridden
 *  3. Maps Manual J room data to Manual D room inputs
 *
 * DISCLAIMER: This is a design-aid implementation. Duct run lengths
 * and fittings must be measured/counted from actual floor plans.
 * The defaults provided here are starting estimates only.
 */

import type { WholeHouseResult, RoomResult } from './manualJ';
import type {
  ManualDSystemInput,
  ManualDRoomInput,
  DuctShape,
  DuctMaterial,
  FittingType,
} from './manualD';

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Configuration for the Manual D system that cannot be derived from
 * Manual J results. These must be provided by the user or equipment specs.
 */
export interface ManualDSystemConfig {
  /** System name / identifier */
  systemName?: string;
  /** Blower external static pressure from equipment specs (inwg) */
  blowerEspInwg: number;
  /** Filter pressure drop (inwg) — default 0.1 for standard 1" filter */
  filterDropInwg?: number;
  /** Coil pressure drop (inwg) — default 0.2 for standard DX coil */
  coilDropInwg?: number;
  /** Duct material for the system */
  ductMaterial?: DuctMaterial;
  /** Preferred duct shape */
  preferredShape?: DuctShape;
  /** Maximum aspect ratio for rectangular ducts */
  maxAspectRatio?: number;
  /** Application type */
  application?: 'residential' | 'commercial';

  /**
   * Per-room duct run overrides. Keyed by room ID from Manual J results.
   * Any room not in this map gets default estimates.
   */
  roomOverrides?: Record<string, ManualDRoomOverride>;
}

/**
 * Optional per-room overrides for duct run geometry.
 * These should come from actual floor plan measurements.
 */
export interface ManualDRoomOverride {
  /** Override duct material for this run */
  ductMaterial?: DuctMaterial;
  /** Actual measured duct run length in feet */
  actualLengthFt?: number;
  /** Actual fittings counted from the floor plan */
  fittings?: { type: FittingType; qty: number }[];
}

// ═══════════════════════════════════════════════════════════════════════════════
// DEFAULT ESTIMATES
// ═══════════════════════════════════════════════════════════════════════════════

/** Default filter pressure drop for standard 1" pleated filter (inwg) */
const DEFAULT_FILTER_DROP = 0.1;

/** Default coil pressure drop for standard DX cooling coil (inwg) */
const DEFAULT_COIL_DROP = 0.2;

/** Default duct material */
const DEFAULT_DUCT_MATERIAL: DuctMaterial = 'sheet_metal';

/** Default preferred shape */
const DEFAULT_SHAPE: DuctShape = 'round';

/** Default max aspect ratio for residential */
const DEFAULT_MAX_ASPECT = 4;

/**
 * Default duct run length estimate based on cooling load.
 *
 * In the absence of actual floor plan measurements, we estimate
 * duct run length heuristically:
 *   - Small rooms (< 100 CFM): 15-20 ft (typically close to plenum)
 *   - Medium rooms (100-200 CFM): 20-35 ft
 *   - Large rooms (> 200 CFM): 25-50 ft
 *
 * These are rough starting points. Actual measurements should always
 * be used when available.
 */
function estimateRunLength(cfm: number): number {
  if (cfm < 50) return 12;
  if (cfm < 100) return 18;
  if (cfm < 150) return 25;
  if (cfm < 200) return 30;
  if (cfm < 300) return 35;
  return 40;
}

/**
 * Default fitting set for a typical residential branch run.
 *
 * Standard assumption: takeoff from trunk, one 90-degree elbow
 * in the run, and a register boot at the outlet.
 */
function defaultFittings(): { type: FittingType; qty: number }[] {
  return [
    { type: 'takeoff_round', qty: 1 },
    { type: 'elbow_90', qty: 1 },
    { type: 'register_boot', qty: 1 },
  ];
}

// ═══════════════════════════════════════════════════════════════════════════════
// CFM DISTRIBUTION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Distribute system CFM to rooms proportionally based on cooling loads.
 *
 * Manual D requires airflow (CFM) per room, which is derived from
 * Manual J cooling loads. The proportional distribution ensures each
 * room gets airflow proportional to its share of the total cooling load.
 *
 * CFM = totalCFM * (roomCoolingBtu / totalCoolingBtu)
 *
 * @param rooms        - Manual J room results
 * @param equipmentCfm - Total system CFM (from equipment selection)
 * @returns Map of roomId to required CFM
 */
function distributeAirflow(
  rooms: RoomResult[],
  equipmentCfm: number
): Map<string, number> {
  const totalCoolingBtu = rooms.reduce((sum, r) => sum + r.coolingBtuTotal, 0);
  const cfmMap = new Map<string, number>();

  if (totalCoolingBtu <= 0) {
    // Edge case: distribute evenly
    const perRoom = equipmentCfm / Math.max(rooms.length, 1);
    rooms.forEach(r => cfmMap.set(r.roomId, Math.round(perRoom)));
    return cfmMap;
  }

  let distributed = 0;
  rooms.forEach((room, index) => {
    if (index === rooms.length - 1) {
      // Last room gets the remainder to avoid rounding errors
      cfmMap.set(room.roomId, equipmentCfm - distributed);
    } else {
      const roomCfm = Math.round(equipmentCfm * (room.coolingBtuTotal / totalCoolingBtu));
      cfmMap.set(room.roomId, roomCfm);
      distributed += roomCfm;
    }
  });

  return cfmMap;
}

/**
 * Calculate equipment CFM from Manual J tonnage.
 *
 * Standard airflow is 400 CFM per ton of cooling. This can range
 * from 350 CFM/ton (dry climates) to 450 CFM/ton (humid climates)
 * but 400 is the industry default.
 *
 * @param tons       - Equipment cooling capacity in tons
 * @param cfmPerTon  - Airflow per ton (default 400)
 * @returns Equipment CFM
 */
export function cfmFromTonnage(tons: number, cfmPerTon: number = 400): number {
  return Math.round(tons * cfmPerTon);
}

// ═══════════════════════════════════════════════════════════════════════════════
// BRIDGE FUNCTION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Convert Manual J results to Manual D inputs.
 *
 * This is the primary bridge function. It takes the whole-house load
 * calculation results from Manual J and a system configuration, then
 * produces the input structure needed for the Manual D duct sizing engine.
 *
 * @param mjResult     - Manual J WholeHouseResult from calculateWholeHouse()
 * @param systemConfig - Equipment and system configuration
 * @returns ManualDSystemInput ready for calculateManualD()
 */
export function manualJToManualD(
  mjResult: WholeHouseResult,
  systemConfig: ManualDSystemConfig
): ManualDSystemInput {
  // Determine equipment CFM from recommended tonnage
  const equipmentCfm = cfmFromTonnage(mjResult.recommendedTons);

  // Distribute CFM to rooms proportionally
  const cfmDistribution = distributeAirflow(mjResult.rooms, equipmentCfm);

  // Build room inputs
  const rooms: ManualDRoomInput[] = mjResult.rooms.map((mjRoom) => {
    const roomCfm = cfmDistribution.get(mjRoom.roomId) ?? 0;
    const override = systemConfig.roomOverrides?.[mjRoom.roomId];

    return {
      roomId: mjRoom.roomId,
      roomName: mjRoom.roomName,
      requiredCfm: roomCfm,
      ductMaterial: override?.ductMaterial,
      actualLengthFt: override?.actualLengthFt ?? estimateRunLength(roomCfm),
      fittings: override?.fittings ?? defaultFittings(),
    };
  });

  return {
    systemName: systemConfig.systemName ?? 'System 1',
    equipmentCfm,
    blowerEspInwg: systemConfig.blowerEspInwg,
    filterDropInwg: systemConfig.filterDropInwg ?? DEFAULT_FILTER_DROP,
    coilDropInwg: systemConfig.coilDropInwg ?? DEFAULT_COIL_DROP,
    ductMaterial: systemConfig.ductMaterial ?? DEFAULT_DUCT_MATERIAL,
    preferredShape: systemConfig.preferredShape ?? DEFAULT_SHAPE,
    maxAspectRatio: systemConfig.maxAspectRatio ?? DEFAULT_MAX_ASPECT,
    application: systemConfig.application ?? 'residential',
    rooms,
  };
}

/**
 * Quick summary of the Manual J to Manual D conversion for UI display.
 * Useful for showing the user what was auto-populated vs what needs
 * manual input.
 */
export interface ConversionSummary {
  equipmentTons: number;
  equipmentCfm: number;
  roomCount: number;
  roomsWithOverrides: number;
  roomsWithDefaults: number;
  totalRoomCfm: number;
  cfmDistribution: { roomId: string; roomName: string; cfm: number; pctOfTotal: number }[];
}

export function getConversionSummary(
  mjResult: WholeHouseResult,
  systemConfig: ManualDSystemConfig
): ConversionSummary {
  const equipmentCfm = cfmFromTonnage(mjResult.recommendedTons);
  const cfmDistribution = distributeAirflow(mjResult.rooms, equipmentCfm);
  const overrideKeys = new Set(Object.keys(systemConfig.roomOverrides ?? {}));

  const distribution = mjResult.rooms.map((room) => {
    const cfm = cfmDistribution.get(room.roomId) ?? 0;
    return {
      roomId: room.roomId,
      roomName: room.roomName,
      cfm,
      pctOfTotal: equipmentCfm > 0 ? Math.round((cfm / equipmentCfm) * 1000) / 10 : 0,
    };
  });

  return {
    equipmentTons: mjResult.recommendedTons,
    equipmentCfm,
    roomCount: mjResult.rooms.length,
    roomsWithOverrides: mjResult.rooms.filter(r => overrideKeys.has(r.roomId)).length,
    roomsWithDefaults: mjResult.rooms.filter(r => !overrideKeys.has(r.roomId)).length,
    totalRoomCfm: distribution.reduce((sum, d) => sum + d.cfm, 0),
    cfmDistribution: distribution,
  };
}

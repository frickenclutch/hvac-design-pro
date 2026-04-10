/**
 * useThermalAnalysis — Live Manual J calculation from CAD floor data.
 * Runs whenever walls, openings, rooms, or design conditions change.
 * Provides per-room and whole-building thermal results for overlays.
 */

import { useMemo } from 'react';
import { useCadStore } from '../store/useCadStore';
import { calculateWholeHouse, createDefaultConditions } from '../../../engines/manualJ';
import type { RoomResult, WholeHouseResult, DesignConditions } from '../../../engines/manualJ';
import { convertCadRoomsToManualJ } from '../../../engines/cadToManualJ';

// ── Wall thermal rating ─────────────────────────────────────────────────────

export type ThermalGrade = 'excellent' | 'good' | 'fair' | 'poor';

export interface WallThermalInfo {
  wallId: string;
  rValue: number;
  uFactor: number;
  grade: ThermalGrade;
  /** Heat loss per linear foot (BTU/hr/ft) at design conditions */
  heatLossPerFt: number;
  lengthFt: number;
  material: string;
}

export interface WindowThermalInfo {
  openingId: string;
  uFactor: number;
  shgc: number;
  areaSqFt: number;
  grade: ThermalGrade;
  /** Annual solar gain potential (BTU/hr at peak) */
  peakSolarGain: number;
  /** Conduction loss at heating design (BTU/hr) */
  heatingLoss: number;
}

export interface RoomThermalSummary {
  cadRoomId: string;
  roomName: string;
  areaSqFt: number;
  result: RoomResult | null;
  /** BTU/hr per sq ft — useful for comparing rooms */
  heatingIntensity: number;
  coolingIntensity: number;
  /** Dominant loss source */
  primaryLossSource: string;
  grade: ThermalGrade;
}

export interface ThermalAnalysis {
  /** Per-wall thermal ratings */
  walls: WallThermalInfo[];
  /** Per-window thermal ratings */
  windows: WindowThermalInfo[];
  /** Per-room Manual J results */
  rooms: RoomThermalSummary[];
  /** Whole-building result (null if no rooms) */
  wholeHouse: WholeHouseResult | null;
  /** Design conditions used */
  conditions: DesignConditions;
  /** Is data available? */
  hasRooms: boolean;
  /** Total building load summary */
  totalHeatingBtu: number;
  totalCoolingBtu: number;
  recommendedTons: number;
}

function gradeR(r: number): ThermalGrade {
  if (r >= 21) return 'excellent';
  if (r >= 13) return 'good';
  if (r >= 7) return 'fair';
  return 'poor';
}

function gradeU(u: number): ThermalGrade {
  if (u <= 0.25) return 'excellent';
  if (u <= 0.35) return 'good';
  if (u <= 0.50) return 'fair';
  return 'poor';
}

function gradeRoom(heatingIntensity: number): ThermalGrade {
  if (heatingIntensity <= 15) return 'excellent';
  if (heatingIntensity <= 25) return 'good';
  if (heatingIntensity <= 40) return 'fair';
  return 'poor';
}

export const GRADE_COLORS: Record<ThermalGrade, string> = {
  excellent: '#22c55e', // emerald-500
  good: '#3b82f6',      // blue-500
  fair: '#f59e0b',      // amber-500
  poor: '#ef4444',       // red-500
};

export const GRADE_LABELS: Record<ThermalGrade, string> = {
  excellent: 'Excellent',
  good: 'Good',
  fair: 'Fair',
  poor: 'Poor',
};

/**
 * Live thermal analysis hook.
 * Accepts optional override conditions (from Manual J calculator state).
 * Falls back to ASHRAE defaults if none provided.
 */
export function useThermalAnalysis(conditionsOverride?: DesignConditions): ThermalAnalysis {
  const floors = useCadStore(s => s.floors);
  const activeFloorId = useCadStore(s => s.activeFloorId);
  const pxPerFt = useCadStore(s => s.projectScale.pxPerFt);

  return useMemo(() => {
    const floor = floors.find(f => f.id === activeFloorId) ?? floors[0];
    if (!floor) {
      return empty();
    }

    const conditions = conditionsOverride ?? createDefaultConditions();

    // ── Wall analysis ────────────────────────────────────────────────────
    const wallInfos: WallThermalInfo[] = floor.walls.map(w => {
      const dx = w.x2 - w.x1;
      const dy = w.y2 - w.y1;
      const lengthFt = Math.sqrt(dx * dx + dy * dy) / pxPerFt;
      const uFactor = 1 / w.rValue;
      const heightFt = floor.heightFt;
      const dt = conditions.indoorHeatingTemp - conditions.outdoorHeatingTemp;
      const heatLossPerFt = (heightFt / w.rValue) * dt;

      return {
        wallId: w.id,
        rValue: w.rValue,
        uFactor: Math.round(uFactor * 1000) / 1000,
        grade: gradeR(w.rValue),
        heatLossPerFt: Math.round(heatLossPerFt),
        lengthFt: Math.round(lengthFt * 10) / 10,
        material: w.material,
      };
    });

    // ── Window analysis ──────────────────────────────────────────────────
    const windowInfos: WindowThermalInfo[] = floor.openings
      .filter(o => o.type === 'window')
      .map(o => {
        const areaSqFt = (o.widthIn * o.heightIn) / 144;
        const u = o.uFactor ?? 0.30;
        const shgc = o.shgc ?? 0.25;
        const dt = conditions.indoorHeatingTemp - conditions.outdoorHeatingTemp;
        const heatingLoss = areaSqFt * u * dt;
        // Peak solar at ~200 BTU/hr/sqft (south-facing summer)
        const peakSolarGain = areaSqFt * shgc * 150;

        return {
          openingId: o.id,
          uFactor: u,
          shgc,
          areaSqFt: Math.round(areaSqFt * 10) / 10,
          grade: gradeU(u),
          peakSolarGain: Math.round(peakSolarGain),
          heatingLoss: Math.round(heatingLoss),
        };
      });

    // ── Room analysis ────────────────────────────────────────────────────
    const hasRooms = floor.rooms.length > 0;
    let roomSummaries: RoomThermalSummary[] = [];
    let wholeHouse: WholeHouseResult | null = null;

    if (hasRooms) {
      const roomInputs = convertCadRoomsToManualJ(floor);
      try {
        wholeHouse = calculateWholeHouse(roomInputs, conditions);

        roomSummaries = floor.rooms.map((room, i) => {
          const result = wholeHouse!.rooms[i] ?? null;
          const heatingIntensity = result ? result.heatingBtu / Math.max(room.areaSqFt, 1) : 0;
          const coolingIntensity = result ? result.coolingBtuTotal / Math.max(room.areaSqFt, 1) : 0;

          // Find dominant loss
          let primaryLossSource = 'walls';
          if (result) {
            const b = result.breakdown;
            const sources = [
              { name: 'walls', val: b.wallLoss },
              { name: 'windows', val: b.windowLoss },
              { name: 'ceiling', val: b.ceilingLoss },
              { name: 'floor', val: b.floorLoss },
              { name: 'infiltration', val: b.infiltrationSensible },
            ];
            sources.sort((a, b) => b.val - a.val);
            primaryLossSource = sources[0].name;
          }

          return {
            cadRoomId: room.id,
            roomName: room.name,
            areaSqFt: room.areaSqFt,
            result,
            heatingIntensity: Math.round(heatingIntensity * 10) / 10,
            coolingIntensity: Math.round(coolingIntensity * 10) / 10,
            primaryLossSource,
            grade: gradeRoom(heatingIntensity),
          };
        });
      } catch {
        // Calculation error — return empty
      }
    }

    return {
      walls: wallInfos,
      windows: windowInfos,
      rooms: roomSummaries,
      wholeHouse,
      conditions,
      hasRooms,
      totalHeatingBtu: wholeHouse?.totalHeatingBtu ?? 0,
      totalCoolingBtu: wholeHouse?.totalCoolingBtu ?? 0,
      recommendedTons: wholeHouse?.recommendedTons ?? 0,
    };
  }, [floors, activeFloorId, pxPerFt, conditionsOverride]);
}

function empty(): ThermalAnalysis {
  return {
    walls: [],
    windows: [],
    rooms: [],
    wholeHouse: null,
    conditions: createDefaultConditions(),
    hasRooms: false,
    totalHeatingBtu: 0,
    totalCoolingBtu: 0,
    recommendedTons: 0,
  };
}

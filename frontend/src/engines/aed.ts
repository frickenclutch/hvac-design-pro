/**
 * HVAC DesignPro — Adequate Exposure Diversity (AED) Engine
 * Per ACCA Manual J 8th Edition, Section N (2016 update)
 *
 * AED evaluates whether a single-zone HVAC system can adequately serve
 * a building whose fenestration creates uneven solar loads throughout the day.
 *
 * Core rule: If the peak hourly glass load exceeds the 12-hour average
 * by more than 30%, the system fails AED and an excursion penalty is applied
 * to the total cooling load.
 */

import type { Exposure } from './manualJ';

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export interface GlassGroup {
  orientation: Exposure;
  areaSqFt: number;
  shgc: number;
  interiorShading: number; // IAC: 0.0–1.0 (1.0 = no shading)
}

export interface AedHourlyResult {
  hour: number;        // 8–19 (8 AM to 7 PM)
  label: string;       // e.g. "8 AM", "12 PM"
  totalGlassLoad: number; // BTU/hr
  byOrientation: Record<Exposure, number>; // BTU/hr per orientation
}

export interface AedResult {
  hourlyLoads: AedHourlyResult[];
  peakLoad: number;       // BTU/hr — max of hourly totals
  peakHour: number;       // hour (8–19) when peak occurs
  averageLoad: number;    // 12-hour average (hours 8–19)
  ratio: number;          // peak / average (1.0 = perfectly even)
  excursion: number;      // BTU/hr penalty: max(0, peak - 1.3 × average)
  pass: boolean;          // true if ratio ≤ 1.30
}

// ═══════════════════════════════════════════════════════════════════════════════
// HOURLY SOLAR IRRADIANCE BY ORIENTATION
// Manual J Table 3A/3B — clear-sky July 21 values at ~40°N latitude
// Units: BTU/(hr·ft²)
// Hours 8–19 (8 AM through 7 PM, solar time)
//
// Note: Peak solar irradiance (used in manualJ.ts solar gain calc) is already
// latitude-interpolated across 7 bands (24°N–48°N). These HOURLY values drive
// the AED diversity check only — latitude-specific hourly tables remain a
// future enhancement for higher-fidelity AED at extreme latitudes.
// ═══════════════════════════════════════════════════════════════════════════════

const HOURLY_IRRADIANCE: Record<Exposure, number[]> = {
  // Index 0 = 8 AM, index 11 = 7 PM (12 hours)
  N:  [20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 15],
  NE: [120, 80, 40, 20, 20, 20, 20, 20, 20, 20, 20, 15],
  E:  [175, 165, 135, 85, 30, 20, 20, 20, 20, 20, 20, 15],
  SE: [120, 140, 145, 130, 95, 50, 20, 20, 20, 20, 20, 15],
  S:  [25, 45, 65, 80, 85, 85, 85, 80, 65, 45, 25, 15],
  SW: [20, 20, 20, 20, 20, 50, 95, 130, 145, 140, 120, 80],
  W:  [20, 20, 20, 20, 20, 20, 30, 85, 135, 165, 175, 120],
  NW: [20, 20, 20, 20, 20, 20, 20, 20, 40, 80, 120, 80],
};

const HOUR_LABELS = [
  '8 AM', '9 AM', '10 AM', '11 AM', '12 PM', '1 PM',
  '2 PM', '3 PM', '4 PM', '5 PM', '6 PM', '7 PM',
];

// ═══════════════════════════════════════════════════════════════════════════════
// AED CALCULATION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Calculate Adequate Exposure Diversity per Manual J Section N.
 *
 * @param glassGroups — all fenestration in the conditioned space, grouped by orientation
 * @returns AedResult with hourly loads, peak, average, ratio, excursion, and pass/fail
 */
export function calculateAed(glassGroups: GlassGroup[]): AedResult {
  // Compute hourly total glass loads across all orientations
  const hourlyLoads: AedHourlyResult[] = [];

  for (let i = 0; i < 12; i++) {
    const byOrientation: Record<string, number> = {};
    let totalGlassLoad = 0;

    for (const group of glassGroups) {
      const irradiance = HOURLY_IRRADIANCE[group.orientation]?.[i] ?? 0;
      // Q_solar = Area × SHGC × I_solar × IAC
      const load = group.areaSqFt * group.shgc * irradiance * group.interiorShading;
      byOrientation[group.orientation] = (byOrientation[group.orientation] ?? 0) + load;
      totalGlassLoad += load;
    }

    hourlyLoads.push({
      hour: 8 + i,
      label: HOUR_LABELS[i],
      totalGlassLoad,
      byOrientation: byOrientation as Record<Exposure, number>,
    });
  }

  // Find peak and compute 12-hour average
  let peakLoad = 0;
  let peakHour = 8;
  let sumLoad = 0;

  for (const h of hourlyLoads) {
    sumLoad += h.totalGlassLoad;
    if (h.totalGlassLoad > peakLoad) {
      peakLoad = h.totalGlassLoad;
      peakHour = h.hour;
    }
  }

  const averageLoad = sumLoad / 12;

  // AED ratio and excursion
  const ratio = averageLoad > 0 ? peakLoad / averageLoad : 1;
  const excursion = Math.max(0, peakLoad - 1.3 * averageLoad);
  const pass = ratio <= 1.30;

  return {
    hourlyLoads,
    peakLoad,
    peakHour,
    averageLoad,
    ratio,
    excursion,
    pass,
  };
}

/**
 * Extract glass groups from Manual J room inputs for AED analysis.
 * Aggregates all window area by orientation across all rooms.
 */
export function extractGlassGroups(rooms: Array<{
  windowSqFt: number;
  windowSHGC: number;
  exposureDirection: Exposure;
  interiorShading: number;
}>): GlassGroup[] {
  // Aggregate by orientation + SHGC + shading combination
  const map = new Map<string, GlassGroup>();

  for (const room of rooms) {
    if (room.windowSqFt <= 0) continue;

    const key = `${room.exposureDirection}_${room.windowSHGC}_${room.interiorShading}`;
    const existing = map.get(key);

    if (existing) {
      existing.areaSqFt += room.windowSqFt;
    } else {
      map.set(key, {
        orientation: room.exposureDirection,
        areaSqFt: room.windowSqFt,
        shgc: room.windowSHGC,
        interiorShading: room.interiorShading,
      });
    }
  }

  return Array.from(map.values());
}

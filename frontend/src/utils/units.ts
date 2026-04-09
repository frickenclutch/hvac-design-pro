import { usePreferencesStore } from '../stores/usePreferencesStore';

export type UnitSystem = 'imperial' | 'metric';

// ── Conversion factors ──────────────────────────────────────────────────────
const FT_TO_M = 0.3048;
const IN_TO_CM = 2.54;
const SQFT_TO_SQM = 0.092903;

// ── Get current unit system ─────────────────────────────────────────────────
export function getUnits(): UnitSystem {
  return usePreferencesStore.getState().units;
}

// ── Length (feet ↔ meters) ──────────────────────────────────────────────────
export function fmtLength(valueFt: number, decimals = 1): string {
  const units = getUnits();
  if (units === 'metric') {
    return `${(valueFt * FT_TO_M).toFixed(decimals)} m`;
  }
  return `${valueFt.toFixed(decimals)} ft`;
}

// ── Small length (inches ↔ cm) ──────────────────────────────────────────────
export function fmtSmallLength(valueIn: number, decimals = 1): string {
  const units = getUnits();
  if (units === 'metric') {
    return `${(valueIn * IN_TO_CM).toFixed(decimals)} cm`;
  }
  return `${valueIn}"`;
}

// ── Area (sq ft ↔ sq m) ─────────────────────────────────────────────────────
export function fmtArea(valueSqFt: number, decimals = 0): string {
  const units = getUnits();
  if (units === 'metric') {
    return `${(valueSqFt * SQFT_TO_SQM).toFixed(decimals)} m²`;
  }
  return `${valueSqFt.toFixed(decimals)} sq ft`;
}

// ── Temperature (°F ↔ °C) ───────────────────────────────────────────────────
export function fmtTemp(valueF: number): string {
  const units = getUnits();
  if (units === 'metric') {
    const c = ((valueF - 32) * 5) / 9;
    return `${c.toFixed(0)} °C`;
  }
  return `${valueF} °F`;
}

// ── Unit labels ─────────────────────────────────────────────────────────────
export function lengthUnit(): string {
  return getUnits() === 'metric' ? 'm' : 'ft';
}

export function smallLengthUnit(): string {
  return getUnits() === 'metric' ? 'cm' : 'in';
}

export function areaUnit(): string {
  return getUnits() === 'metric' ? 'm²' : 'ft²';
}

export function tempUnit(): string {
  return getUnits() === 'metric' ? '°C' : '°F';
}

// ── Elevation ───────────────────────────────────────────────────────────────
export function fmtElevation(valueFt: number): string {
  const units = getUnits();
  if (units === 'metric') {
    return `${(valueFt * FT_TO_M).toFixed(0)} m`;
  }
  return `${valueFt} ft`;
}

/**
 * HVAC DesignPro — ACCA Manual S Equipment Selection Engine
 *
 * Implements the ACCA Manual S residential equipment-selection methodology:
 * given the Manual J design loads, confirm that a chosen piece of equipment is
 * correctly sized.
 *
 *  Cooling (the heart of Manual S):
 *   1. Total capacity vs total load — within the sizing band (AC 90–115%,
 *      heat pump 90–125% with a warning above 115%).
 *   2. Sensible adequacy — the equipment's sensible capacity AT DESIGN
 *      CONDITIONS must meet the design sensible load (or it can't hold temp).
 *   3. Latent adequacy — latent capacity (total − sensible) must meet the
 *      design latent load (or it can't control humidity).
 *   4. Sensible Heat Ratio match — equipment SHR vs load SHR.
 *   5. Optional altitude derate of sensible capacity (air-density correction).
 *
 *  Heating:
 *   - Furnace: output capacity within 100–140% of the design heating load.
 *   - Heat pump: capacity at the design outdoor temperature; quantify the
 *     supplemental (auxiliary) heat required and the balance point.
 *
 * Capacities are entered AT DESIGN CONDITIONS — the numbers an engineer reads
 * from the manufacturer's expanded-performance tables — mirroring how the
 * Manual D engine takes equipment specs (blower ESP, etc.). A future AHRI
 * catalog can populate these inputs without changing the rules.
 *
 * Reference:
 *  - ACCA Manual S, 2nd Edition (Residential Equipment Selection)
 *  - ACCA Manual J, 8th Edition (design loads — the inputs to this engine)
 *
 * DISCLAIMER: This is a design-aid implementation. Professional engineers must
 * verify all outputs against OEM expanded-performance data before specifying
 * equipment or submitting permit applications.
 */

// ═══════════════════════════════════════════════════════════════════════════════
// CONSTANTS — Manual S sizing limits (residential)
// ═══════════════════════════════════════════════════════════════════════════════

export const MANUAL_S_ENGINE_VERSION = 'manualS-1.0';

/** Air conditioner total-cooling sizing band (% of total cooling load). */
const AC_COOLING_MIN_PCT = 90;
const AC_COOLING_MAX_PCT = 115; // CLAUDE.md §3 rule 6 — the hard ACCA cap

/**
 * Heat-pump total-cooling sizing band. Heat pumps may be sized larger than a
 * straight-cool AC to offset the heating load, but anything above 115% is still
 * flagged so the extra size is a deliberate choice, not an accident.
 */
const HP_COOLING_MIN_PCT = 90;
const HP_COOLING_MAX_PCT = 125;
const HP_COOLING_WARN_PCT = 115;

/** Furnace output sizing band (% of design heating load). */
const FURNACE_MIN_PCT = 100;
const FURNACE_MAX_PCT = 140;

/** BTU/h per kW (for expressing supplemental electric heat). */
const BTU_PER_KW = 3412;

/** Base (no-load) temperature for the heating balance-point load line (°F). */
const HEATING_BASE_TEMP_F = 65;

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export type CoolingSystemType = 'ac' | 'heat_pump';
export type HeatingSystemType = 'furnace_gas' | 'furnace_electric' | 'heat_pump' | 'none';

export type CoolingStatus =
  | 'pass'
  | 'oversized'
  | 'undersized'
  | 'sensible_short'
  | 'latent_short'
  | 'no_load';

export type HeatingStatus =
  | 'pass'
  | 'oversized'
  | 'undersized'
  | 'aux_required'
  | 'no_load'
  | 'no_equipment';

/** Design loads from Manual J, plus the design context this engine needs. */
export interface ManualSDesignLoads {
  /** Total cooling load (sensible + latent), BTU/h. */
  totalCoolingBtu: number;
  /** Sensible cooling load, BTU/h. */
  sensibleCoolingBtu: number;
  /** Latent cooling load, BTU/h. */
  latentCoolingBtu: number;
  /** Design heating load, BTU/h. */
  heatingBtu: number;
  /** Outdoor cooling design temperature (°F) — context/display. */
  outdoorCoolingTempF: number;
  /** Outdoor heating design temperature (°F) — heat-pump capacity point. */
  outdoorHeatingTempF: number;
  /** Indoor cooling design temperature (°F) — context/display. */
  indoorCoolingTempF: number;
  /** Site elevation (ft) — drives the optional altitude derate. */
  elevationFt: number;
}

/** Candidate cooling equipment — capacities entered AT DESIGN CONDITIONS. */
export interface CoolingEquipmentInput {
  modelName?: string;
  ahriRefNumber?: string;
  systemType: CoolingSystemType;
  /** Total cooling capacity at design conditions (BTU/h). */
  totalCoolingCapacityBtu: number;
  /** Sensible cooling capacity at design conditions (BTU/h). */
  sensibleCoolingCapacityBtu: number;
  /** AHRI-rated total capacity at 95°F (informational only). */
  ratedTotalCoolingBtu?: number;
  /** Opt-in: derate sensible capacity for site air density. Default off. */
  applyAltitudeCorrection?: boolean;
}

/** Candidate heating equipment. */
export interface HeatingEquipmentInput {
  modelName?: string;
  heatingType: HeatingSystemType;
  /**
   * Furnace: output capacity (input × AFUE), BTU/h.
   * Heat pump: heating capacity at the design outdoor temperature, BTU/h.
   */
  heatingCapacityBtu: number;
  /** Heat pump only: AHRI high-temp (47°F) rating — enables balance point. */
  heatingCapacityAt47Btu?: number;
  /** Heat pump only: AHRI low-temp (17°F) rating — enables balance point. */
  heatingCapacityAt17Btu?: number;
  /** Furnace efficiency (informational). */
  afue?: number;
}

export interface ManualSInput {
  systemName?: string;
  loads: ManualSDesignLoads;
  cooling: CoolingEquipmentInput;
  heating: HeatingEquipmentInput;
}

export interface CoolingResult {
  systemType: CoolingSystemType;
  totalLoadBtu: number;
  sensibleLoadBtu: number;
  latentLoadBtu: number;
  /** Capacities used for the verdict (after altitude correction, if applied). */
  totalCapacityBtu: number;
  sensibleCapacityBtu: number;
  latentCapacityBtu: number;
  altitudeCorrectionApplied: boolean;
  /** Sensible derate applied for altitude (%), 0 when not applied. */
  altitudeDeratePct: number;
  totalSizingPct: number;
  sensibleSizingPct: number;
  latentSizingPct: number;
  equipmentShr: number;
  loadShr: number;
  status: CoolingStatus;
  pass: boolean;
  warnings: string[];
  notes: string[];
}

export interface HeatingResult {
  heatingType: HeatingSystemType;
  loadBtu: number;
  capacityBtu: number;
  sizingPct: number;
  /** Supplemental (aux) heat required for a heat pump at design temp, BTU/h. */
  supplementalHeatBtu: number;
  supplementalHeatKw: number;
  /** Heat-pump balance point (°F), when 47°F/17°F ratings are provided. */
  balancePointF: number | null;
  status: HeatingStatus;
  pass: boolean;
  warnings: string[];
  notes: string[];
}

export interface ManualSResult {
  systemName: string;
  cooling: CoolingResult;
  heating: HeatingResult;
  /** True when every *evaluated* selection is within Manual S limits. */
  overallPass: boolean;
  engineVersion: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

const round1 = (n: number): number => Math.round(n * 10) / 10;
const round3 = (n: number): number => Math.round(n * 1000) / 1000;
const roundInt = (n: number): number => Math.round(n);
const fmtBtu = (n: number): string => Math.round(n).toLocaleString();

/**
 * Standard-atmosphere air-density ratio relative to sea level.
 * σ = (1 − 6.8754e−6 · h)^4.2559  (valid to ~36,000 ft).
 * Sensible cooling capacity scales with air density (the same CFM moves less
 * mass at altitude), so this is the documented opt-in sensible derate factor.
 */
export function airDensityRatio(elevationFt: number): number {
  if (elevationFt <= 0) return 1;
  return Math.pow(1 - 6.8754e-6 * elevationFt, 4.2559);
}

/**
 * Heat-pump balance point: the outdoor temperature at which the heat pump's
 * declining capacity line meets the building's rising load line.
 *
 * Capacity line through (47°F, cap47) and (17°F, cap17).
 * Load line through (65°F, 0) and (designOutdoorTempF, designLoad).
 * Returns null if the geometry is degenerate or the result is non-physical.
 */
export function computeBalancePoint(
  designLoadBtu: number,
  designOutdoorTempF: number,
  cap47Btu: number,
  cap17Btu: number,
): number | null {
  if (designLoadBtu <= 0) return null;
  if (HEATING_BASE_TEMP_F - designOutdoorTempF <= 0) return null;

  const capSlope = (cap47Btu - cap17Btu) / (47 - 17); // BTU/h per °F
  const loadSlope = designLoadBtu / (HEATING_BASE_TEMP_F - designOutdoorTempF); // BTU/h per °F
  const denom = capSlope + loadSlope;
  if (Math.abs(denom) < 1e-9) return null;

  // cap17 + capSlope·(T−17) = loadSlope·(65 − T)  →  solve for T
  const t = (loadSlope * HEATING_BASE_TEMP_F - cap17Btu + capSlope * 17) / denom;
  if (!Number.isFinite(t) || t < -40 || t > HEATING_BASE_TEMP_F) return null;
  return round1(t);
}

// ═══════════════════════════════════════════════════════════════════════════════
// COOLING EVALUATION
// ═══════════════════════════════════════════════════════════════════════════════

function evaluateCooling(loads: ManualSDesignLoads, eq: CoolingEquipmentInput): CoolingResult {
  const warnings: string[] = [];
  const notes: string[] = [];

  const totalLoad = loads.totalCoolingBtu;
  const sensLoad = loads.sensibleCoolingBtu;
  const latLoad = loads.latentCoolingBtu;

  // ── Altitude correction (opt-in; ACCA §3 rule 4 — never default worst-case) ──
  const applyAlt = !!eq.applyAltitudeCorrection && loads.elevationFt > 0;
  const densityRatio = applyAlt ? airDensityRatio(loads.elevationFt) : 1;
  const altitudeDeratePct = applyAlt ? (1 - densityRatio) * 100 : 0;

  // Sensible capacity scales with air density; total stays ~constant (the
  // sensible/latent split shifts toward latent at altitude).
  const totalCapacity = eq.totalCoolingCapacityBtu;
  const sensibleCapacity = eq.sensibleCoolingCapacityBtu * densityRatio;
  const latentCapacity = totalCapacity - sensibleCapacity;

  if (applyAlt) {
    notes.push(
      `Altitude derate applied at ${roundInt(loads.elevationFt).toLocaleString()} ft: ` +
      `sensible capacity ×${round3(densityRatio)} (−${round1(altitudeDeratePct)}%). ` +
      `Verify against OEM expanded-performance data.`,
    );
  } else if (loads.elevationFt >= 2000) {
    notes.push(
      `Project elevation is ${roundInt(loads.elevationFt).toLocaleString()} ft. ` +
      `Sensible capacity drops with air density — enable altitude correction or ` +
      `enter altitude-adjusted capacities from OEM expanded-performance data.`,
    );
  }

  // ── No-load guard ─────────────────────────────────────────────────────────
  if (totalLoad <= 0) {
    return {
      systemType: eq.systemType,
      totalLoadBtu: 0, sensibleLoadBtu: 0, latentLoadBtu: 0,
      totalCapacityBtu: roundInt(totalCapacity),
      sensibleCapacityBtu: roundInt(sensibleCapacity),
      latentCapacityBtu: roundInt(latentCapacity),
      altitudeCorrectionApplied: applyAlt,
      altitudeDeratePct: round1(altitudeDeratePct),
      totalSizingPct: 0, sensibleSizingPct: 0, latentSizingPct: 0,
      equipmentShr: totalCapacity > 0 ? round3(sensibleCapacity / totalCapacity) : 0,
      loadShr: 0,
      status: 'no_load',
      pass: false,
      warnings: ['No cooling load entered. Run Manual J or enter design cooling loads.'],
      notes,
    };
  }

  const totalSizingPct = (totalCapacity / totalLoad) * 100;
  const sensibleSizingPct = sensLoad > 0 ? (sensibleCapacity / sensLoad) * 100 : 100;
  const latentSizingPct = latLoad > 0
    ? (latentCapacity / latLoad) * 100
    : (latentCapacity >= 0 ? 100 : 0);
  const equipmentShr = totalCapacity > 0 ? sensibleCapacity / totalCapacity : 0;
  const loadShr = totalLoad > 0 ? sensLoad / totalLoad : 0;

  const isHP = eq.systemType === 'heat_pump';
  const minPct = isHP ? HP_COOLING_MIN_PCT : AC_COOLING_MIN_PCT;
  const maxPct = isHP ? HP_COOLING_MAX_PCT : AC_COOLING_MAX_PCT;
  const equipLabel = isHP ? 'a heat pump' : 'an air conditioner';

  let status: CoolingStatus = 'pass';

  // ── Total sizing band ─────────────────────────────────────────────────────
  if (totalSizingPct > maxPct) {
    status = 'oversized';
    warnings.push(
      `Total cooling capacity is ${round1(totalSizingPct)}% of the load — exceeds the ` +
      `${maxPct}% Manual S limit for ${equipLabel}. Oversizing causes short cycling and ` +
      `poor humidity control.`,
    );
  } else if (totalSizingPct < minPct) {
    status = 'undersized';
    warnings.push(
      `Total cooling capacity is ${round1(totalSizingPct)}% of the load — below the ` +
      `${minPct}% minimum. The equipment cannot meet the design cooling load.`,
    );
  }

  if (isHP && totalSizingPct > HP_COOLING_WARN_PCT && totalSizingPct <= HP_COOLING_MAX_PCT) {
    notes.push(
      `Heat-pump cooling capacity is ${round1(totalSizingPct)}% of the cooling load — ` +
      `acceptable only if the extra size is needed to offset the heating load; otherwise ` +
      `keep within 115%.`,
    );
  }

  // ── Sensible adequacy (most critical — overrides the band status) ─────────
  if (sensibleCapacity + 1e-6 < sensLoad) {
    status = 'sensible_short';
    warnings.push(
      `Sensible capacity (${fmtBtu(sensibleCapacity)} BTU/h) is below the sensible load ` +
      `(${fmtBtu(sensLoad)} BTU/h). The equipment cannot hold the design temperature.`,
    );
  }

  // ── Latent adequacy ───────────────────────────────────────────────────────
  if (latentCapacity + 1e-6 < latLoad) {
    if (status === 'pass' || status === 'oversized') status = 'latent_short';
    warnings.push(
      `Latent capacity (${fmtBtu(latentCapacity)} BTU/h) is below the latent load ` +
      `(${fmtBtu(latLoad)} BTU/h). The equipment cannot control indoor humidity at ` +
      `design conditions.`,
    );
  }

  // ── SHR match ─────────────────────────────────────────────────────────────
  if (Math.abs(equipmentShr - loadShr) > 0.1) {
    notes.push(
      `Equipment SHR (${round3(equipmentShr)}) differs from the load SHR ` +
      `(${round3(loadShr)}) by more than 0.10 — confirm the sensible/latent split ` +
      `matches the application.`,
    );
  }

  const pass = status === 'pass';
  if (pass) {
    notes.push(
      'Cooling selection within Manual S limits. Verify against OEM expanded-performance ' +
      'data before specifying.',
    );
  }

  return {
    systemType: eq.systemType,
    totalLoadBtu: roundInt(totalLoad),
    sensibleLoadBtu: roundInt(sensLoad),
    latentLoadBtu: roundInt(latLoad),
    totalCapacityBtu: roundInt(totalCapacity),
    sensibleCapacityBtu: roundInt(sensibleCapacity),
    latentCapacityBtu: roundInt(latentCapacity),
    altitudeCorrectionApplied: applyAlt,
    altitudeDeratePct: round1(altitudeDeratePct),
    totalSizingPct: round1(totalSizingPct),
    sensibleSizingPct: round1(sensibleSizingPct),
    latentSizingPct: round1(latentSizingPct),
    equipmentShr: round3(equipmentShr),
    loadShr: round3(loadShr),
    status,
    pass,
    warnings,
    notes,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// HEATING EVALUATION
// ═══════════════════════════════════════════════════════════════════════════════

function evaluateHeating(loads: ManualSDesignLoads, eq: HeatingEquipmentInput): HeatingResult {
  const warnings: string[] = [];
  const notes: string[] = [];
  const load = loads.heatingBtu;
  const capacity = eq.heatingCapacityBtu;

  const base = (status: HeatingStatus, pass: boolean): HeatingResult => ({
    heatingType: eq.heatingType,
    loadBtu: roundInt(Math.max(load, 0)),
    capacityBtu: roundInt(Math.max(capacity, 0)),
    sizingPct: load > 0 ? round1((capacity / load) * 100) : 0,
    supplementalHeatBtu: 0,
    supplementalHeatKw: 0,
    balancePointF: null,
    status,
    pass,
    warnings,
    notes,
  });

  if (eq.heatingType === 'none') {
    notes.push('No heating equipment selected for this system.');
    return base('no_equipment', true);
  }

  if (load <= 0) {
    notes.push('No heating load entered — heating selection not evaluated.');
    return base('no_load', true);
  }

  const sizingPct = (capacity / load) * 100;
  const isHP = eq.heatingType === 'heat_pump';

  if (isHP) {
    let balancePointF: number | null = null;
    if (eq.heatingCapacityAt47Btu != null && eq.heatingCapacityAt17Btu != null) {
      balancePointF = computeBalancePoint(
        load, loads.outdoorHeatingTempF, eq.heatingCapacityAt47Btu, eq.heatingCapacityAt17Btu,
      );
      if (balancePointF != null) {
        notes.push(
          `Estimated balance point ≈ ${balancePointF}°F (below this, supplemental heat ` +
          `carries the shortfall).`,
        );
      }
    }

    if (capacity + 1e-6 < load) {
      const supplementalHeatBtu = load - capacity;
      const supplementalHeatKw = supplementalHeatBtu / BTU_PER_KW;
      warnings.push(
        `Heat pump delivers ${fmtBtu(capacity)} BTU/h at the ${roundInt(loads.outdoorHeatingTempF)}°F ` +
        `design temperature — ${fmtBtu(supplementalHeatBtu)} BTU/h (${round1(supplementalHeatKw)} kW) of ` +
        `supplemental heat is required to meet the ${fmtBtu(load)} BTU/h heating load.`,
      );
      // A heat pump that needs aux is a valid Manual S selection once the aux
      // heat is specified — pass, but clearly flagged.
      return {
        ...base('aux_required', true),
        sizingPct: round1(sizingPct),
        supplementalHeatBtu: roundInt(supplementalHeatBtu),
        supplementalHeatKw: round1(supplementalHeatKw),
        balancePointF,
      };
    }

    notes.push('Heat pump meets the full heating load at the design temperature without supplemental heat.');
    return { ...base('pass', true), sizingPct: round1(sizingPct), balancePointF };
  }

  // ── Furnace (gas or electric) ─────────────────────────────────────────────
  if (sizingPct > FURNACE_MAX_PCT) {
    warnings.push(
      `Furnace output is ${round1(sizingPct)}% of the heating load — exceeds the ` +
      `${FURNACE_MAX_PCT}% Manual S limit. Oversizing wastes capacity and worsens ` +
      `temperature swings.`,
    );
    return { ...base('oversized', false), sizingPct: round1(sizingPct) };
  }
  if (sizingPct < FURNACE_MIN_PCT) {
    warnings.push(
      `Furnace output is ${round1(sizingPct)}% of the heating load — below 100%. The ` +
      `equipment cannot meet the design heating load.`,
    );
    return { ...base('undersized', false), sizingPct: round1(sizingPct) };
  }
  notes.push('Furnace output within Manual S sizing limits (100–140% of the heating load).');
  return { ...base('pass', true), sizingPct: round1(sizingPct) };
}

// ═══════════════════════════════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Run the full ACCA Manual S equipment-selection check.
 *
 * @param input - design loads + candidate cooling/heating equipment
 * @returns cooling + heating verdicts and an overall pass/fail
 */
export function calculateManualS(input: ManualSInput): ManualSResult {
  const cooling = evaluateCooling(input.loads, input.cooling);
  const heating = evaluateHeating(input.loads, input.heating);

  const coolingEvaluated = cooling.status !== 'no_load';
  const heatingEvaluated = heating.status !== 'no_load' && heating.status !== 'no_equipment';

  const overallPass =
    (coolingEvaluated || heatingEvaluated) &&
    (!coolingEvaluated || cooling.pass) &&
    (!heatingEvaluated || heating.pass);

  return {
    systemName: input.systemName ?? 'Manual S Selection',
    cooling,
    heating,
    overallPass,
    engineVersion: MANUAL_S_ENGINE_VERSION,
  };
}

/** Human-readable label for a cooling status (for UI / PDF). */
export function coolingStatusLabel(status: CoolingStatus): string {
  switch (status) {
    case 'pass': return 'Within Manual S limits';
    case 'oversized': return 'Oversized';
    case 'undersized': return 'Undersized';
    case 'sensible_short': return 'Sensible capacity short';
    case 'latent_short': return 'Latent capacity short';
    case 'no_load': return 'No cooling load';
  }
}

/** Human-readable label for a heating status (for UI / PDF). */
export function heatingStatusLabel(status: HeatingStatus): string {
  switch (status) {
    case 'pass': return 'Within Manual S limits';
    case 'oversized': return 'Oversized';
    case 'undersized': return 'Undersized';
    case 'aux_required': return 'Supplemental heat required';
    case 'no_load': return 'No heating load';
    case 'no_equipment': return 'No heating equipment';
  }
}

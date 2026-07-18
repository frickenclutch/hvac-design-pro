/**
 * Calculation grade taxonomy (Unit N0 — ratified as a PERMANENT audit-record
 * format, spec §2 of docs/MANUAL_N_ONBOARDING_PLAN_2026-07-17.md).
 *
 * Every NEW calc record persisted to D1 carries, inside its append-only
 * `outputs` JSON:
 *   __grade        — 'budget-estimate' | 'permit-grade' (DERIVED, never asserted)
 *   __assumptions  — Assumption[] ledger; any 'grade-capping' entry caps the
 *                    grade at budget-estimate
 *   __method       — which math family produced the number, e.g.
 *                    'manualJ-residential', 'manualJ-residential-approximation'
 *                    (commercial through the residential engine), 'manualN'
 * and inside `inputs`: __buildingType when known.
 *
 * Existing records are NEVER retro-mutated (append-only house rule) — legacy
 * rows have their grade inferred at query time from `inputs.buildingType`.
 *
 * Pure module: no I/O, no stores, no DOM. Engines and the calcStorage sync
 * shim both import from here.
 */

export type CalcGrade = 'budget-estimate' | 'permit-grade';

export type BuildingType = 'residential' | 'commercial';

export interface Assumption {
  /** Stable id, e.g. 'method.residential-approximation', 'wb.approximated'. */
  key: string;
  /** Any grade-capping assumption ⇒ the record's grade stays budget-estimate. */
  severity: 'info' | 'grade-capping';
  /** Human-readable; rendered in the assumption-ledger UI. */
  message: string;
  source: 'default' | 'approximation' | 'table-gap' | 'user';
}

/** The stamp merged into a calc record's outputs JSON. */
export interface GradeStamp {
  __grade: CalcGrade;
  __assumptions: Assumption[];
  __method: string;
}

/** The one assumption every commercial record carries until the Manual N
 *  engine replaces the residential approximation (Units N1-N2). Message is
 *  method-agnostic on purpose — it caps commercial Manual J runs AND
 *  downstream tools (e.g. commercial Manual D fed by those loads) alike. */
export const COMMERCIAL_J_APPROXIMATION: Assumption = {
  key: 'method.residential-approximation',
  severity: 'grade-capping',
  message:
    'Commercial project computed with residential-standard (ACCA residential '
    + 'manuals) methodology — budget estimate only, not for permit submission.',
  source: 'approximation',
};

/** Grade is derived, never asserted: permit-grade ⇔ zero grade-capping
 *  assumptions. (The Manual N per-project flip gate, Unit N8, adds its own
 *  structural refusal inside formN — this function stays the single rule.) */
export function deriveGrade(assumptions: Assumption[]): CalcGrade {
  return assumptions.some((a) => a.severity === 'grade-capping')
    ? 'budget-estimate'
    : 'permit-grade';
}

export interface GradeStampContext {
  /** Which math family produced the outputs (see __method above). */
  method: string;
  /** When known. 'commercial' auto-appends COMMERCIAL_J_APPROXIMATION for
   *  every residential-approximation method. */
  buildingType?: BuildingType;
  /** Engine/adapter-supplied ledger entries (Manual N grows this at N2). */
  assumptions?: Assumption[];
}

/** Build the derived stamp for a new calc record. */
export function buildGradeStamp(ctx: GradeStampContext): GradeStamp {
  const assumptions = [...(ctx.assumptions ?? [])];
  if (
    ctx.buildingType === 'commercial'
    && !assumptions.some((a) => a.key === COMMERCIAL_J_APPROXIMATION.key)
    && ctx.method !== 'manualN'
  ) {
    assumptions.push(COMMERCIAL_J_APPROXIMATION);
  }
  return {
    __grade: deriveGrade(assumptions),
    __assumptions: assumptions,
    __method: ctx.method,
  };
}

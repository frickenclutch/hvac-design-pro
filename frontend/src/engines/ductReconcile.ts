/**
 * Duct Assumption Reconciliation (Manual J ⇄ Manual D)
 * =====================================================
 * Manual J's duct inputs are ASSUMPTIONS made before the duct system is
 * designed: the load calculation needs duct location / insulation / leakage
 * (which drive the Table 7 loss multipliers) plus a documented run length.
 * Manual D later produces the as-designed system with real run lengths.
 *
 * This comparator detects when the as-designed total drifts materially from
 * the assumption Manual J documented, so the UI can nudge the user to bring
 * the two back into agreement. Per ACCA principles the reconciliation is
 * NEVER applied automatically — the user confirms it (§3 rule 4: no silent
 * value substitution without user intervention).
 *
 * Note on load impact: in the legacy engine the run length is a documented
 * assumption only (location / R / leakage drive the multiplier), so applying
 * a reconciled length keeps the printed report honest without changing the
 * load numbers. Cert-grade Worksheet G consumes surface-area fractions, so
 * a materially different design still warrants review there.
 */

/** Any duct run with a straight length — satisfied by both Manual D's
 *  persisted inputs (ManualDRoomInput) and its results (ManualDRunResult). */
export interface DuctRunLength {
  actualLengthFt: number;
}

export interface DuctReconcileReport {
  /** Manual J's assumed total duct run length (ft), as entered */
  assumedLengthFt: number;
  /** Sum of straight-run lengths across the Manual D design (ft) */
  designedLengthFt: number;
  /** Number of sized runs contributing to the total */
  runCount: number;
  /** designedLengthFt − assumedLengthFt (ft, signed) */
  deltaFt: number;
  /** |delta| as a percent of the assumption; null when there is no usable
   *  baseline (assumed length missing or non-positive) */
  deltaPercent: number | null;
  /** True when the drift is material and worth surfacing */
  exceedsThreshold: boolean;
  /** Stable identity of this comparison — used to remember a dismissal so
   *  the nudge doesn't nag until either side actually changes again */
  signature: string;
}

/** Drift beyond this percentage of the assumed length is surfaced. */
export const DUCT_DRIFT_THRESHOLD_PERCENT = 15;

/**
 * Compare Manual J's assumed duct run length against a Manual D design.
 * Accepts either Manual D's persisted room inputs or its computed run
 * results — anything carrying actualLengthFt. Returns null when the design
 * has no usable run lengths to compare.
 */
export function reconcileDuctAssumptions(
  assumedLengthFt: number,
  designRuns: readonly DuctRunLength[] | null | undefined
): DuctReconcileReport | null {
  const runs = designRuns ?? [];
  const designedLengthFt = Math.round(
    runs.reduce(
      (sum, r) => sum + (Number.isFinite(r.actualLengthFt) && r.actualLengthFt > 0 ? r.actualLengthFt : 0),
      0
    )
  );
  if (runs.length === 0 || designedLengthFt <= 0) return null;

  const hasBaseline = Number.isFinite(assumedLengthFt) && assumedLengthFt > 0;
  const assumed = hasBaseline ? Math.round(assumedLengthFt) : 0;
  const deltaFt = designedLengthFt - assumed;
  const deltaPercent = hasBaseline
    ? Math.round((Math.abs(deltaFt) / assumed) * 1000) / 10
    : null;

  return {
    assumedLengthFt: assumed,
    designedLengthFt,
    runCount: runs.length,
    deltaFt,
    deltaPercent,
    // No baseline at all is always worth surfacing — the report would
    // otherwise document a length the design contradicts outright.
    exceedsThreshold: deltaPercent === null || deltaPercent > DUCT_DRIFT_THRESHOLD_PERCENT,
    signature: `${assumed}|${designedLengthFt}`,
  };
}

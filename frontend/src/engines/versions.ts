/**
 * Canonical engine-version map (Unit N0).
 *
 * One place for every engine version string that report footers, telemetry
 * prefixes, and D1 `engine_version` stamps use. Before this file, the
 * Manual D / AED versions lived as private literals inside
 * combinedReportGenerator.ts and the calculator pages hardcoded their own
 * copies — a bump had to find every literal by hand.
 *
 * BUNDLE RULE: this module is imported by lazy-loaded calculator pages that
 * do NOT otherwise pull the manualJ8 or manualS engine chunks, so it must
 * stay literal-only — no engine imports here. Single-source-of-truth is
 * instead enforced at CI: `engines/__tests__/versions.test.ts` asserts each
 * literal equals the constant its engine module exports (manualJ8, manualS),
 * so a version bump that touches one side but not the other fails the build.
 */

export const ENGINE_VERSIONS = {
  /** Legacy per-room Manual J engine — production display today. */
  manualJLegacy: 'manualJ-legacy-1.0',
  /** Cert-grade Form J1 engine — shadow-running; must match
   *  MANUAL_J8_ENGINE_VERSION in engines/manualJ8/index.ts. */
  manualJ8: 'manualJ8-ts-1.3.0',
  /** Manual D equal-friction duct sizing. */
  manualD: 'manualD-1.0',
  /** Manual S equipment selection — must match MANUAL_S_ENGINE_VERSION in
   *  engines/manualS.ts. */
  manualS: 'manualS-1.0',
  /** Adequate Exposure Diversity (Manual J Section N). */
  aed: 'aed-1.0',
} as const;

export type EngineKey = keyof typeof ENGINE_VERSIONS;

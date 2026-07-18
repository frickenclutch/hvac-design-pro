/**
 * Calculation persistence — D1 sync shim.
 *
 * Mirrors the contract of `features/projects/projectStorage.ts` but simpler:
 * calculations are append-only / immutable, so there's no merge logic. Each
 * call just fires a `POST /api/calculations` after the localStorage write
 * has already happened in the caller.
 *
 * Why a shim rather than calling `api.saveCalculation` inline?
 *  - Skips automatically when the project is local-only (`proj-*` IDs that
 *    haven't been migrated yet) — the FK on `calculations.project_id`
 *    would 404 anyway, no point making the request.
 *  - Skips for null/empty project IDs (draft mode).
 *  - Swallows failures silently with a console warning — calculation
 *    correctness lives in localStorage; D1 is purely the audit/telemetry
 *    sink today. Toast spam on every offline calc would be noise.
 *
 * Closes Priority 1 from `project_layer_priorities.md`: "Manual J / D / AED
 * result sync (localStorage only today)". Once these calls fire on every
 * calc, the L0 admin Q/A benchmarks panel and the Phase 1 shadow-run drift
 * telemetry both start showing real data instead of zeros.
 */

import { api } from '../../lib/api';
import { buildGradeStamp, type Assumption, type BuildingType } from '../../engines/calcGrade';

export type CalcType = 'MANUAL_J' | 'MANUAL_D' | 'MANUAL_S' | 'AED' | 'MANUAL_N';

export interface CalcSyncInput {
  projectId: string | null | undefined;
  calcType: CalcType;
  inputs: unknown;
  outputs: unknown;
  engineVersion?: string;
  durationMs?: number;
  /** Which math family produced the outputs — REQUIRED so every new record
   *  carries a derived __grade/__assumptions/__method stamp (Unit N0, spec §2).
   *  e.g. 'manualJ-residential', 'manualJ-residential-approximation',
   *  'manualJ8-shadow', 'manualD', 'manualS', 'aed', 'manualN'. */
  method: string;
  /** When known; 'commercial' caps the grade at budget-estimate until real
   *  Manual N math ships (Units N1-N2). */
  buildingType?: BuildingType;
  /** Engine/adapter assumption ledger to merge into the stamp. */
  assumptions?: Assumption[];
}

/** Plain-object guard: stamps only merge into JSON-object payloads. Every
 *  current call site passes objects; anything else passes through unstamped. */
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export interface CalcSyncResult {
  id: string;
  version: number;
}

/** Fire-and-forget POST to `/api/calculations`. Resolves with the new
 *  record's id on success or `null` if persistence was skipped or failed.
 *  Never throws — calculator UIs treat the local result as the source of
 *  truth and only use the D1 record for audit + cross-user telemetry. */
export async function syncCalcToD1(input: CalcSyncInput): Promise<CalcSyncResult | null> {
  // Draft mode — no project to attach to.
  if (!input.projectId) return null;

  // Local-only project (legacy `proj-*` ID that hasn't been promoted to D1).
  // Project sync (Unit 1, 2026-04-24) handles migration on user request via
  // the Cloud chip; until that's clicked, calc rows would orphan-FK.
  if (input.projectId.startsWith('proj-')) return null;

  // ── Grade stamp (Unit N0) ─────────────────────────────────────────────
  // Derived from the method + building type + assumption ledger; merged into
  // the outputs JSON so the append-only D1 record is machine-readably graded.
  // Stamps go LAST in the spread so an engine can never assert its own grade.
  const stamp = buildGradeStamp({
    method: input.method,
    buildingType: input.buildingType,
    assumptions: input.assumptions,
  });
  const outputs = isPlainObject(input.outputs)
    ? { ...input.outputs, ...stamp }
    : input.outputs;
  const inputs = isPlainObject(input.inputs) && input.buildingType
    ? { ...input.inputs, __buildingType: input.buildingType }
    : input.inputs;

  try {
    return await api.saveCalculation({
      projectId: input.projectId,
      calcType: input.calcType,
      inputs,
      outputs,
      engineVersion: input.engineVersion,
      durationMs: input.durationMs,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[calc sync] ${input.calcType} not persisted to D1:`, err);
    return null;
  }
}

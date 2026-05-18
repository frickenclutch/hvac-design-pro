# Option E — UI Migration Plan

**Status:** **Phase 1 SHIPPED 2026-05-04** (commit `8203e3e`). Calculator now shadow-runs the cert-grade engine alongside legacy on every calc; legacy results still display. Drift telemetry logged to console. Phase 2 (display flip) gated on collecting real-user drift data — see "Phase 2 status" below.

**Goal:** Point `ManualJCalculator.tsx` at `engines/manualJ8/` so real users (Dan, Brian, Daniel) run cert-grade math on production projects. **Zero regressions on existing saved projects.**

---

## Phase 1 — what shipped (2026-05-04)

| Component | File | Status |
|---|---|---|
| Adapter shim | `frontend/src/engines/manualJ8/adapters/legacy.ts` | ✅ shipped, ~460 LOC |
| Feature flags | `frontend/src/stores/usePreferencesStore.ts` (`engineVersion`, `shadowRunManualJ8`) | ✅ shipped, defaults `legacy` + `true` |
| Calculator wiring | `frontend/src/pages/ManualJCalculator.tsx` `runCalculation` | ✅ shadow-run + drift log |
| Tests | 43/43 vitest pass (23 cert + 7 registry + 13 infra) | ✅ green |
| Browser-verified | Smith-like climate produces drift telemetry; default conditions throw on sparse Table 4B ceiling cells (caught + logged) | ✅ verified |

**Phase 1 findings (already surfaced):**
1. Ceiling registry only populates CTD=15 directCLTD cells — climates outside that envelope cause the new engine to throw, the calculator catches and logs `[engine drift] manualJ8 shadow-run failed`. Need more ceiling variants in Phase 2.
2. Duct math drift dominates the 3-room toy case (~10–15%). Expected: legacy uses a flat multiplier, Manual J 8 uses Table 7 base × WIF × LCF × SAA. Real-project drift telemetry from Dan/Brian/Daniel will show whether this is acceptable.
3. **Calc results not yet syncing to D1** — drift telemetry is console-only. Q/A benchmarks panel + cross-user aggregation depend on calc persistence (Priority 1 in `project_layer_priorities.md`).

---

## Phase 2 status — gated on telemetry

**Trigger criteria** (decide before flipping `engineVersion` default to `'manualJ8'`):
- Real users (Dan, Brian, Daniel) drive ≥10 production projects through the calculator
- Drift on those projects is captured (requires calc persistence to D1)
- Drift summary ≤ 5% on every total (heat / sens / latent) on at least 80% of projects
- ACCA cert review status: APPROVED (currently awaiting; ~3-4 mo SLA from 2026-05-01 filing)

**Phase 2 work to ship when triggered:**
1. Implement `formJ1ResultToRoomDisplay` (inverse adapter) so per-room cards still display loads from the whole-house engine
2. Flip `engineVersion` default in `usePreferencesStore.defaults`
3. PDF export stamps the engine version in the report header
4. Settings UI exposes the engineVersion toggle (today the prefs exist but no UI)
5. Update `manual-j-methodology.md` to declare cert-grade is production
6. Re-send cert flipbook to Glenn Hourahan reflecting the cutover

---

## Reference: original plan (preserved for Phase 2 implementation)

---

## Files involved

| File | LOC | Role |
|---|---|---|
| `frontend/src/pages/ManualJCalculator.tsx` | ~700+ | Calculator UI page — read FIRST |
| `frontend/src/engines/manualJ.ts` | 960 | Legacy engine, `RoomInput` model, `calculateWholeHouse()` |
| `frontend/src/engines/manualJ8/index.ts` | — | New typed engine, `FormJ1Input` model, `buildFormJ1()` |
| `frontend/src/engines/aed.ts` | — | AED engine (used by both, no migration needed) |
| `frontend/src/stores/usePreferencesStore.ts` | — | Add `engineVersion` flag here |

---

## Recommended approach: shadow-run first, then switch display

**Phase 1 (low-risk, high-info):** When user calculates, run BOTH engines. Display legacy results unchanged. Log new-engine results + drift to console for telemetry. Zero user-facing change. Gives real-project drift data on Howland Pump's actual jobs.

**Phase 2 (after Phase 1 agreement on ≥3 real projects):** Flip the `engineVersion` preference default to `'manualJ8'`. Display new engine results. Legacy stays as fallback.

**Why not switch directly:** legacy engine is per-room aggregated; new engine is Form J1 whole-house. Mental models differ. Shadow-run lets us prove agreement before the user sees any difference.

---

## Adapter shim — required new module

Create `frontend/src/engines/manualJ8/adapters/legacy.ts`:

```typescript
import type { RoomInput, DesignConditions as LegacyConditions } from '../../manualJ';
import type { FormJ1Input, DesignConditions } from '../types';

/** Convert legacy per-room inputs into a Form J1 whole-house input. */
export function roomInputsToFormJ1Input(
  rooms: RoomInput[],
  legacy: LegacyConditions,
): FormJ1Input {
  // Aggregation strategy:
  //  - Sum all room window areas by direction → 6a entries
  //  - Sum exterior wall areas by Group → 8a entries
  //  - Aggregate door count + door type → 7 entries
  //  - Aggregate ceiling areas → 10 entries
  //  - Aggregate floor types → 11 entries
  //  - Whole-house infiltration via aggregate ACH or blower door
  //  - Internal loads = sum of per-room occupants + scenarios
  //  - ...
}

/** Inverse: turn FormJ1Result into per-room display loads for the
 *  existing UI's room-card display. (Phase 2 only.) */
export function formJ1ResultToRoomDisplay(
  result: FormJ1Result,
  rooms: RoomInput[],
): RoomResult[] {
  // Distribute Form J1 totals back to rooms by their share of envelope
  // areas. Used so the existing UI room cards can keep displaying
  // per-room loads even though the math is now whole-house.
}
```

**Key design constraint:** The adapter is one-way for Phase 1 (legacy → new for shadow-run). Phase 2 needs the inverse mapping for the UI. The inverse is a redistribution heuristic, not a precise math operation — that's OK because cert-grade output is the **whole-house total**, not per-room.

---

## Feature flag

Add to `usePreferencesStore`:

```typescript
interface Preferences {
  // ... existing fields
  engineVersion: 'legacy' | 'manualJ8';  // default 'legacy'
  shadowRun: boolean;                     // default true (Phase 1 enabled)
}
```

Surface in `/settings` page as a "Cert-grade engine (beta)" toggle. Don't expose to non-platform-admin users until Phase 2 ships.

---

## Sequencing for the next session

```
1. Read ManualJCalculator.tsx (full file).
2. Read manualJ.ts exports (lines 22-180 for types).
3. Read manualJ8/types.ts FormJ1Input shape (already have in memory).
4. Write adapters/legacy.ts — roomInputsToFormJ1Input only (Phase 1).
   Cover the 80% case first; throw on edge cases for now.
5. Add engineVersion + shadowRun to usePreferencesStore.
6. In ManualJCalculator.tsx onCalculate handler:
   - Always call legacy engine (existing path).
   - If shadowRun=true, ALSO call new engine via adapter.
   - console.log {legacy, manualJ8, drift} for telemetry.
7. Build + run vitest. Verify legacy behavior unchanged.
8. Manual test on Smith-like sample: drift should be < 1%.
9. Commit Phase 1.
10. STOP. Let real users (Dan/Brian/Daniel) drive a few projects.
    Collect drift telemetry from console.
11. NEXT session after Phase 1 lives in production for ~1 week:
    - Implement formJ1ResultToRoomDisplay (inverse adapter)
    - Flip engineVersion display logic
    - Ship Phase 2.
```

---

## Risk areas

| Risk | Mitigation |
|---|---|
| Per-room AED vs block-level AED differ structurally | Keep legacy AED for room-level display; new engine's AED for whole-house Line 20 |
| Legacy `RoomInput` has built-in PSF/CLF tables; new engine requires per-window PSF/CLF/ISC inputs | Adapter maps `exposureDirection` + `latitude` → PSF/CLF lookup; can reuse legacy's lookup for compat |
| Construction code mismatch — legacy uses `WallConstructionGroup: 'I'/'J'/'K'/'L'`; new engine uses Construction registry IDs | Adapter has a small mapping table: legacy group → representative new construction (e.g., `'I'` → `'12C-3s/w'`) |
| Saved projects on legacy schema must keep loading | Default `engineVersion: 'legacy'` ensures zero impact on saved projects |
| Form J1 needs design conditions (HTD, CTD, ACF) that may not be in `LegacyConditions` | Compute on the fly from outdoor temps + elevation in the adapter |
| Whole-house infiltration aggregation is non-trivial when rooms have different exposures | For Phase 1, use whole-house defaults; refine in Phase 2 |

---

## Open questions to resolve up front (next session)

1. **Where does ManualJCalculator get its inputs from?** Local state? `useProjectStore`? Per-room CAD link? Read the file to confirm.
2. **How are projects loaded from D1 — does it round-trip through legacy schema?** Check `projectStorage.ts`.
3. **Does Mason AI (the in-app assistant) call the engine directly?** If yes, Mason needs to be aware of the engineVersion preference too.
4. **Construction code mapping table** — what's the smallest defensible map from legacy `WallConstructionGroup` (I/J/K/L, ASHRAE-style) to new engine Construction IDs? Probably:
   - `'I'` (light frame R-13) → `'12C-3s/w'`
   - `'J'` (frame R-19) → `'12E-3s/w'`
   - `'K'` (masonry) → `'13Ca-0oc-w'`
   - `'L'` (heavy masonry) → `'14E-3'`

---

## Success criteria for Phase 1

- ✅ Existing legacy calculations run unchanged
- ✅ Saved projects load + recalc correctly
- ✅ Console shows `[engine drift] heat: 0.X%, sens: 0.Y%, latent: 0.Z%` after each calc
- ✅ Drift on real projects (Howland Pump's job book) stays under 5% — if larger, that's a finding, not a failure
- ✅ vitest 43/43 still pass
- ✅ Production build clean

## Success criteria for Phase 2

- ✅ User flips toggle in `/settings`
- ✅ Calculator displays new-engine totals
- ✅ PDF export uses new-engine totals
- ✅ Per-room display populated via inverse adapter
- ✅ All Phase 1 telemetry preserved as opt-in
- ✅ Zero saved-project breakage

---

## When this is done

Update `project_acca_certification.md` memory with:
```
- ~~Option E UI migration~~ ✅ DONE — engineVersion preference exposed,
  ManualJCalculator routes to manualJ8 in beta-opt-in mode. Real users
  on cert-grade math.
```

Then unblock further moves: Manual D engine, multi-tenant Unit 3, Mason AI extensions.

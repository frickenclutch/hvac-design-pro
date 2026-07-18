# Manual N Onboarding — Final Spec (Synthesis)

**File:** `docs/MANUAL_N_ONBOARDING_SPEC.md` · **Date:** 2026-07-17 · **Status:** Approved-pending "Decisions for Nathan" (§12)

**Provenance:** Synthesis of three competing designs (cert-discipline-first, pragmatic-evolution [winner], platform-cohesion-first) plus three judge verdicts. Spine is pragmatic-evolution; every fatal flaw named by the judges is explicitly resolved (§11).

**Scope note (Unit-F directive):** This spec delivers the "onboard Manual N in a suffice methodology" clause of Nathan's 2026-07-16 directive ONLY. The trust-architecture clauses (party-approved roles, step-up OTP, C4 root of trust, dual-TOTP absorption) are a separate workstream and are NOT satisfied by this document. The one intersection carried forward: "individuals will be pay gated for enhanced features" makes permit-grade Manual N a candidate entitlement — decision D8.

**Migration-number reconciliation (cross-spec):** This spec and `TRUST_CONSENT_ARCHITECTURE_2026-07-17.md` were synthesized in parallel and both reference migration `0018` as their first slot. Migration numbers are allocated at implementation time in actual ship order — whichever unit lands first takes the next free slot (`0018` as of this writing; the trust spec's Track G already models Manual N's N0 migration landing after the trust migrations, as `0023`). Treat every migration number in both specs as relative ordering, not a reserved slot. N0's migration also consolidates with Track G0 in the trust spec — they are the same unit (calc_type + grade), specified in both documents; implement once.

---

## 0. Thesis

Manual J8 earned credibility by shadow-running a cert-grade engine behind a trusted incumbent. **Manual N has no trusted incumbent to hide behind** — today's commercial path runs *residential* Manual J math on commercial rooms behind a red banner (verified: `manualJ.ts` contains zero `buildingType` branches; `BlueprintDialogs.tsx:344-352`). Shadow-running behind known-wrong math would be theater.

So the J8 playbook inverts:

- **J8 path:** build dark → cert tests → shadow-run → display flip.
- **N path:** ship honesty first (machine-readable grade + un-removable watermark), then ship the Manual N engine *as the estimator* with **graceful degradation** (it computes what its tables cover, ledgers every gap as a visible assumption, and never leaves the user number-less), let real projects drive table transcription via coverage telemetry, and treat the "flip" as a **per-project grade transition** (`budget-estimate` → `permit-grade`), not an engine swap. Cert fixtures and the 0.5% suite arrive when the math has been field-proven — same destination as J8, opposite order of ceremony.

What we keep from J8 discipline from day one, because it is correctness infrastructure, not ceremony: pure functions, typed I/O, self-contained tables with `sourcePage` provenance, centralized round/interp policy, engine_version stamping, append-only calc records, sparse tables that are *known* sparse.

---

## 1. Verified baseline (2026-07-17, in-repo)

| Fact | Evidence |
|---|---|
| Commercial = residential Manual J + warning copy | `manualJ.ts` has no buildingType math; `BlueprintDialogs.tsx:249-259` merges commercial rooms via residential `createDefaultRoom()` presets |
| Only real commercial math in codebase | `manualD.ts` `getVelocityLimits(application)` + large-trunk fitting class |
| Budget-estimate label has no machine-readable backing | Commercial calc records in D1 are indistinguishable from residential permit-grade ones |
| `MANUAL_N` cannot persist | `calculations.calc_type` CHECK `('MANUAL_J','MANUAL_D','MANUAL_S','AED')` — `workers/migrations/0001_init.sql:103`; D1 enforces CHECKs (0016 prod incident); `idx_calc_project` at line 115 |
| `project.standard` is dead code | Persisted, never read |
| Weather is dry-bulb only | `ashraeWeather.ts` 896 stations `{heat99, cool1, lat, elev, dailyRange, grains}`; the J8 legacy adapter fabricates WB as `cool1 − 15` |
| Engine clone template proven | `engines/manualJ8/` at `manualJ8-ts-1.3.0` (`index.ts:192`); vitest auto-discovers any `*.test.ts` under `frontend/src` — zero CI changes needed |
| Table numbers cited from memory go wrong | `docs/table4d-transcription-worksheet.md` SOURCE CORRECTION: "Table 4D" was a months-long misattribution |
| **Bridge tests do not exist** | `frontend/src/engines/__tests__/` has NO tests for `cadToManualJ.ts` or `manualJToManualD.ts` (verified via glob 2026-07-17) — any claim of "covered by existing tests" is false |
| calc-service is not a seam | Python stubs carry DO-NOT-IMPLEMENT banners; the TS engine is the only engine |

---

## 2. Grade taxonomy (permanent audit-record format — ratify in D2 before Unit N0 ships)

One convention, chosen now, because it becomes a permanent format inside append-only records:

```typescript
type CalcGrade = 'budget-estimate' | 'permit-grade';

interface Assumption {
  key: string;                          // stable id, e.g. 'wb.approximated', 'cltd.gap.wallGroupD.NE'
  severity: 'info' | 'grade-capping';   // any grade-capping assumption ⇒ grade stays budget-estimate
  message: string;                      // human-readable, shown in the ledger card
  source: 'default' | 'approximation' | 'table-gap' | 'user';
}
```

- Every new calc record's `outputs` carries `__grade` and `__assumptions: Assumption[]`; `__method` (e.g. `'manualJ-residential-approximation'`, `'manualN'`) records which math produced the number; `inputs` carries `__buildingType` when known.
- **Grade is derived, never asserted:** `permit-grade` ⇔ zero grade-capping assumptions AND the N8 flip gate is ratified. One value drives the D1 record stamp, the UI banner, and the PDF watermark — divergence is structurally impossible (Design 0 graft).
- **No retro-mutation, ever** (append-only house rule): existing records are never touched; qa-benchmarks infers grade for legacy rows from `inputs.buildingType` at query time (Design 2 graft).
- **Two-claim separation on all output documents** (Design 0's labeling ladder): (1) *"calculated per ACCA Manual N (5th Ed) methodology"* — claimable at cert-green; (2) *"ACCA-recognized software"* — claimable only after a confirmed recognition outcome. The grade name is never `'cert'`; self-validation and ACCA recognition are never conflated.

---

## 3. Phased roadmap — ordered clean ship units

Each unit is self-contained, non-breaking, one PR = one deploy. Real users test in parallel.

### Unit N0 — Honest Estimate Stamp + plumbing (ships first, standalone)
- **Migration `0018_manual_n_calc_type.sql`**: widen the `calc_type` CHECK to add `'MANUAL_N'` via full table rebuild (SQLite cannot ALTER a CHECK — 0015/0016 pattern). **Mandatory runbook (strictest combination, all steps):** (a) rehearse in the workers Miniflare/vitest-pool-workers harness AND against a local D1 copy; (b) pre-migration D1 export backup; (c) off-hours window per the manual-deploy cadence; (d) post-copy row-count verification + `idx_calc_project` recreation verified. `calculations` is the hot append-only audit table; a mid-copy failure without the backup is unrecoverable.
- Add `'MANUAL_N'` to the `CalcType` union (`calcStorage.ts:26`) and qa-benchmarks calc-mix expectations.
- **Grade stamping** per §2 on all *new* calc records: residential Manual J stamps `permit-grade`; commercial (`inputs.buildingType==='commercial'`) stamps `budget-estimate` + assumptions.
- **Un-removable watermark**: any `budget-estimate` PDF/report section renders a diagonal "BUDGET ESTIMATE — NOT FOR PERMIT SUBMISSION"; this **overrides the `pdfWatermark` user preference** — the one ratified exception to the personalization philosophy (D3).
- **`engines/versions.ts`** (Design 2 graft): hoist `MANUAL_J8_ENGINE_VERSION`, `MANUAL_S_ENGINE_VERSION`, and the `manualD-1.0`/`aed-1.0` literals pinned inside `combinedReportGenerator.ts:45-46` into one map that report footers, telemetry prefixes, and test pins import.
- **Day-one founder action (D1):** order TWO copies of ACCA Manual N 5th Ed (Nathan = photo source, Dan/Burlington = cross-check + flip-gate engineer). Nothing in N5/N8 moves without the book.
- User-visible value: commercial PDFs stop being visually indistinguishable from permit-grade residential ones; the legal-labeling gap closes before any new math ships.

### Unit N1 — Commercial internal loads (provenance-gated)
- `engines/manualN/tables/occupancy.ts`: occupancy categories (office, retail, restaurant, kitchen, classroom, assembly, warehouse, medical, lodging, gym) with people density, sensible/latent per person by activity, lighting/equipment W/ft², and ventilation rates (cfm/person + cfm/ft²).
- **Pre-book source rule (resolves the judges' N1 flaw):** until the Manual N book is photographed, values may come ONLY from clearly-cited non-ACCA published sources (ASHRAE 62.1 rate tables, ASHRAE Fundamentals people-load tables), each row carrying a `source` citation — same provenance discipline as ACCA transcription, no memory-cited values, no fabrication. On book receipt, reconcile: **the book's printed values win inside the engine's cert path**; divergences documented in the transcription worksheet (posture ratified in D6).
- `classifySpace()` (commercial `guessRoomType` analog) wired into the *existing* commercial estimate path (BlueprintDialogs commercial branch + Manual J commercial toggle) — no parallel UI. Ventilation becomes an explicit line item (1.08×CFM×ΔT sensible; 0.68×CFM×Δgrains latent, WB caveat ledgered).
- User-visible value: a restaurant stops being estimated like a 3-bedroom house, this week; these tables are ~a third of the eventual engine.

### Unit N2 — `manualN-ts-0.1.0` N-lite engine (production estimate compute, with graceful degradation)
- Full `engines/manualN/` module per §4: worksheets (glass, opaque, internal, infiltration, ventilation, ducts), `formN.ts` single-zone block aggregator, `lookup.ts`, seed registry of ~25 common light-commercial constructions.
- **Dual-mode lookup (resolves the unanimous fatal flaw — users must never get NO number):**
  - `mode: 'strict'` — throws attributably naming (table, row, column). Used by tests, the future permit-grade path, and telemetry classification.
  - `mode: 'estimate'` — a missing cell resolves to a documented, source-cited conservative fallback AND appends a `grade-capping` assumption (`source: 'table-gap'`) to the ledger AND emits a `__coverage` gap marker on the calc record. The user always gets a number; the number is honestly capped at estimate grade; the gap still feeds the transcription queue exactly like a throw would.
  - If the *whole run* is unmappable (adapter can't build a `FormNInput` at all), the UI falls back to the labeled J-approximation (today's behavior) and a `-fail` marker record persists — a functional regression is impossible by construction.
  - ACCA rule 4 ("no default worst-case without user intervention") compliance: every fallback is visible in the ledger with a confirm/edit affordance, and permit grade is structurally unreachable while any fallback is active. Silent worst-casing cannot occur.
- Telemetry: `MANUAL_N` records with `__coverage` (table families served vs. gapped), `-fail` markers for hard failures, and `__divergenceVsJapprox` — recorded as **expected divergence / sales evidence, never a gate** (Design 2 graft; there is no legacy comparator for commercial).
- Tests from day one: worksheet unit tests (hand-computed formula checks), structural `registry.test.ts` pinning the version string (bump must touch the test), **plausibility envelopes** (ft²/ton, cfm/ft², W/ft² bands by building type — warn-never-clamp) covering the era before cert fixtures exist. CI auto-discovers; zero config changes.
- User-visible value: commercial numbers come from commercial math; the results panel shows the assumption ledger ("Budget Estimate — 7 assumptions") instead of a mute banner.

### Unit N3 — `/manual-n` page + routing + reports
- Full calculator per the §8 UI plan (template-conformant: gate, context bar, project-scoped keys, auto-save with skip-first-render guard, lazy jsPDF with `unit:'pt'`, print fallback).
- **Routing (D4):** `resolveLoadStandard(project)` reads `project.type` — `'Commercial'` → Manual N. Opening `/calculator` on a commercial project shows an **interstitial with escape hatch** ("continue with Manual J anyway" — output stays budget-estimate-stamped + watermarked); symmetric nudge on `/manual-n` for residential. No hard blocks (mixed-use exists). The Manual J Res/Com toggle is **removed in this same unit** (its function is absorbed). `project.standard` stays dormant until a second region standard exists — routing on the user-visible `type` field, not the dead one.
- Blueprint intake commercial branch routes confirmed spaces into `hvac_manualn_inputs_${projectId||'draft'}` via `adapters/estimate.ts`; the red banner becomes the assumption-ledger card.
- `/reports` combined print-off gains a Manual N section (recompute-from-stored-inputs, engine stamp from `versions.ts`, grade watermark from N0).
- Spotlight entries; Mason FAQ / HelpCenter / UserGuide copy updated (Mason already keys on 'manual n' — the answer flips from "on the roadmap" to "here's how, estimate-grade").

### Unit N4 — Weather deepening (coincident wet-bulb, with escape hatch)
- **User-entered WB is the primary path (Design 0 graft — resolves Design 2's fatal no-escape-hatch flaw):** `CommercialDesignConditions.coincidentWB` is a required field on `/manual-n`, pre-fillable, with `wbProvenance: 'user_entered' | 'station_table' | 'approximated'` recorded in the inputs snapshot. An engineer reads WB off the ASHRAE/book design-conditions table for the site — 30 seconds of their workflow.
- Station enrichment: `ashraeWeather.ts` entry type gains optional `cwb1`; `lookupCommercialDesignConditions(zip)` accessor (Design 2 graft) returns it when present. Populate **demand-first by ZIP prefix** — upstate NY/VT (120-139, 050-059) first, then by telemetry — never all 896 up front.
- Engine behavior: real WB (user or station) → latent/ventilation math uses it, the WB assumption disappears; absent → `cool1 − 15` approximation persists as a **grade-capping** assumption. **`formN.ts` structurally refuses `permit-grade` output on `wbProvenance: 'approximated'`** — fabricated WB cannot reach a permit document by construction, not convention.
- Weather-gap UX rule (generalized to all attributable gaps that reach a user-facing path): graceful degradation with a clear "design conditions incomplete for this ZIP — enter coincident WB" prompt, never a raw failure.

### Unit N5 — Transcription waves (recurring unit; the Table 4D lesson institutionalized)
- **Photos-before-charters, hard gate:** the first deliverable from the physical book is photographs of the ToC + table-of-tables + every table's page header, indexed into `docs/manualN-transcription/inventory.md` BEFORE anything is transcribed or cited. Functional table-family names only until confirmed against print. No engine table file adopts a book table number or as-printed structure before its photos exist (resolves Design 2's skeleton-before-book flaw; the N2 seed registry uses functional names + non-ACCA citations until then).
- Census-first tiering (Design 0 graft): **P0** = cells exercised by the book's worked example(s) — the cert anchors, identified at inventory; **P1** = upstate-NY/VT light-commercial archetypes (office/retail/restaurant/warehouse, ~40-44°N glass rows); **P2** = long tail, ranked by `__coverage` gap telemetry.
- One wave = photo batch → charter worksheet (table4d format: rules block, photo inventory, anchor cells `[value✓]`, transcriber + date) → encoded table family with `sourcePage` → golden tests per row → engine minor version bump. Anchor verification before encoding; illegible cells flagged for Dan's second eyeball, never silently inferred.
- **Peak-window-only CLTD transcription (D5):** 3-5 hour columns around peak (~75% cell reduction); full hourly columns only if N7's time-of-peak telemetry names specific extra hours.
- Burden estimate: ~1,200-2,000 printed values across ~7 families, ~8-12 focused sessions total — but P0 (~2-4 sessions) is all that blocks cert fixtures, and demand pulls the rest.

### Unit N6 — Bridges (clone-don't-extract)
- **No refactor of live production bridges** (resolves the verified-false "covered by existing tests" premise): `cadToManualN.ts` **clones** the occupancy-agnostic geometry math from `cadToManualJ.ts` and swaps the preset layer for `classifySpace()`; `manualNToManualD.ts` **clones** the CFM-proportional distribution from `manualJToManualD.ts` with `application: 'commercial'` (Manual D's commercial velocity limits + large-trunk fitting class already exist). Minor duplication accepted; `cadToManualJ` feeds the live CAD flow and stays untouched.
- Optional later unit (off the Manual N critical path, D9): extract shared `cadGeometry.ts` / `loadsToDucts.ts` — **only after characterization tests are written first** for both existing bridges, as explicit in-unit scope.
- `manualS.ts` guard: refuses commercial inputs with a clear message (its 115% rule is residential) rather than silently mis-sizing. Manual CS/Q remain seams only: `FormNResult`'s clean typed totals ARE the seam; nothing anticipatory built.
- Blueprint commercial path now yields real Manual N inputs end-to-end: CAD → Manual N → Manual D for a commercial job.

### Unit N7 — Zone model + exposure time-of-peak + real CLF
- `FormNInput` grows `zones: ZoneInput[]`; `formN.ts` computes per-zone peaks at per-exposure peak hours plus the building block load, reporting both (zone peaks for airside, block for equipment) — the one genuinely new structural concept vs. J8; the AED 12-hour profile logic is the in-house analog.
- Real CLF-by-schedule replaces the v0.x `CLF=1.0` assumption (which was ledgered as `info` severity from N2 — every simplification has a named follow-up unit, preventing entrenchment).

### Unit N8 — Cert hardening + per-project permit-grade flip
- Cert fixtures: the book's worked example(s) transcribed as `FormNInput` literals with page refs, asserted line-by-line at **0.5%** where the book prints line values; **independent double-computation** (two people hand-work the example, reconcile before encoding — Design 2 graft). Supplement with clearly-tiered ASHRAE secondary anchors if the book's examples are coarse; accept and disclose a smaller cert matrix than J8's 184.
- **`anchorBuilding.test.ts`** (Design 2 graft): our own fully-specified small-office golden with the **>2% cross-version drift fails-build** gate — drift protection independent of the book's line-item granularity.
- Registry pinning frozen; bump to `manualN-ts-1.0.0`.
- **Flip gate (all required, ratified in D7):** (a) cert fixtures green at 0.5%; (b) ≥10 distinct real commercial projects over 30 days with `__coverage` gap/throw rate <2%; (c) real (non-approximated) coincident WB; (d) **human hand-check n≥3** — real commercial projects verified against the book by a team engineer (Dan/Brian — Design 0 graft); (e) one sample packet reviewed by a licensed PE (the existing PE-stamp packet program is the vehicle); (f) legal wording review of the report footer.
- Flip mechanics: **per-project**, derived — `permit-grade` only when that project's ledger has zero grade-capping assumptions AND the gate is ratified. Projects with capping assumptions stay honestly labeled forever. Copy flips everywhere (CLAUDE.md standards table, Mason, Help, Guide).
- ACCA: ask Glenn Hourahan (existing J8 channel) during N1/N5 whether any Manual N software listing/endorsement track exists (also raise transcription/copyright posture); pursue if cheap — **the flip gates on our own validation, not ACCA's timeline**. Labeling ladder (§2) governs claims at every interim state.

### Right-sized vs. gold-plating (the contract)

| Genuinely needed | Gold-plating (deferred/declined) |
|---|---|
| CLTD/CLF-family method (Manual N's own) | ASHRAE RTSM/HBM (Phase 3; different product) |
| Peak-window CLTD columns | Full 24-hour profiles for every table |
| Block + per-zone peaks (N7) | Hourly/8760 simulation, economizer analysis |
| Coincident WB (user-entered + demand-first stations) | All-896-station WB transcription up front |
| ~25→~150 constructions, demand-driven | Speculative full-appendix transcription |
| CLF=1.0 ledgered → real CLF at N7 | — |
| Book worked-example cert fixtures + anchor golden | ACCA filing as a flip prerequisite |
| Typed `FormNResult` seams for CS/Q | Any Manual CS/Q logic now |
| Conditional routing on `project.type` | `get_engine` factory / wiring dormant `standard` |
| TS engine only | Python calc-service revival / WASM |

---

## 4. Engine anatomy — `frontend/src/engines/manualN/`

Mirrors `manualJ8/` conventions with three deliberate deltas: the **assumption ledger** in the result type, a **zone layer** (N7), and an **estimate adapter** with dual-mode lookup instead of a throw-only legacy shim.

```
frontend/src/engines/manualN/
├── index.ts            # Barrel + MANUAL_N_ENGINE_VERSION = 'manualN-ts-0.1.0'
│                       #   (minor = table wave; 1.0.0 reserved for cert-green; changelog-in-
│                       #   comment convention from manualJ8/index.ts)
├── types.ts            # CommercialDesignConditions (coincidentWB + wbProvenance:
│                       #   'user_entered'|'station_table'|'approximated'), OccupancyCategory,
│                       #   SpaceInput, ZoneInput (N7), CommercialConstructionVariant
│                       #   (clone of ConstructionVariant: id, kind, uValue, group, sourcePage),
│                       #   per-worksheet Input/Result pairs, FormNInput, FormNResult
│                       #   (totals, SHR, per-line breakdown, grade: CalcGrade,
│                       #   assumptions: Assumption[]), Assumption, CalcGrade (§2)
├── tables/             # FUNCTIONAL names until book photos confirm numbering (N5 gate)
│   ├── occupancy.ts        # N1: people density, S/L by activity, lighting/equipment W/ft²,
│   │                       #   ventilation rates — every row source-cited (62.1/Fundamentals
│   │                       #   pre-book; book values win on receipt)
│   ├── constructions.ts    # Commercial registry — tuple-expander layout, sourcePage,
│   │                       #   REGISTRY_SIZE export (manualJ8/tables/constructions.ts pattern)
│   ├── wallRoofCLTD.ts     # Sparse peak-window CLTD: wall groups + roof numbers × orient ×
│   │                       #   hour-window; absent = not transcribed, never guessed
│   ├── glassSolar.ts       # Glass solar factors by orientation × latitude band
│   ├── shading.ts          # SC/SHGC, external shading multipliers
│   └── ductFactors.ts      # Commercial duct gain/loss factors
├── lookup.ts           # Centralized per-table round/interp policy (the book's own stated
│                       #   rules, decided per family at transcription, documented in charter).
│                       #   DUAL MODE: 'strict' throws attributably naming (table,row,col);
│                       #   'estimate' returns a documented source-cited conservative fallback
│                       #   + appends a grade-capping 'table-gap' Assumption + coverage marker.
│                       #   The gap/throw text IS the transcription work queue.
├── adjustments.ts      # Color/orientation/latitude corrections (book-cited)
├── worksheets/
│   ├── glass.ts            # Solar + conduction fenestration loads
│   ├── opaque.ts           # Wall/roof/floor/partition dispatch on ConstructionKind
│   ├── internal.ts         # People/lights/equipment; CLF=1.0 in v0.x (ledgered 'info'),
│   │                       #   real CLF-by-schedule at N7
│   ├── infiltration.ts     # Commercial infiltration (pressurization-aware per book)
│   ├── ventilation.ts      # OA loads: 1.08·CFM·ΔT sensible, 0.68·CFM·Δgrains latent;
│   │                       #   grade-capped when wbProvenance==='approximated'
│   └── ducts.ts            # Gain/loss factors at system level
├── formN.ts            # buildFormN(input): block aggregation v0.x; zones + per-exposure
│                       #   time-of-peak at N7. Decimal precision preserved (rule 7).
│                       #   STRUCTURALLY refuses grade='permit-grade' if any grade-capping
│                       #   assumption exists (incl. approximated WB) — grade is derived.
├── adapters/
│   ├── estimate.ts         # classifySpace() + blueprint/legacy commercial inputs → FormNInput;
│   │                       #   estimate mode: every injected default appends to assumptions[]
│   │                       #   (the burn-down ledger); strict mode: throws on unmapped input.
│   │                       #   Total unmappability → labeled J-approximation fallback + '-fail'
│   │                       #   marker record (user never number-less).
│   └── fromCad.ts          # N6 (thin: cloned geometry + classifySpace)
└── __tests__/
    ├── registry.test.ts       # Structural guard + version-string pin (bump must touch test)
    ├── worksheets.test.ts     # Hand-computed formula checks per worksheet (day one)
    ├── plausibility.test.ts   # ft²/ton, cfm/ft², W/ft² envelope bands — warn semantics goldens
    ├── cltdLookup.test.ts     # Golden tests per transcription wave; dual-mode edge cases
    ├── anchorBuilding.test.ts # N8: own small-office golden; >2% drift fails build
    └── cert/                  # N8: book worked-example fixtures at 0.5%
```

Adjacent pure bridges (top-level, matching existing placement): `engines/cadToManualN.ts`, `engines/manualNToManualD.ts` (clones, per N6). Shared seam files: `engines/versions.ts` (N0), `ashraeWeather.ts` optional `cwb1` + `lookupCommercialDesignConditions` (N4).

House rules unchanged: pure functions, no I/O/HTTP/DOM, self-contained tables, typed I/O, portable, no silent worst-case defaults, decimal precision preserved, engine_version on every persisted record, persistence via `calcStorage.syncCalcToD1` through `lib/api.ts`.

---

## 5. Data / table acquisition plan

**Step 1 — Book (immediate, D1):** two copies of ACCA Manual N 5th Ed (~$300-400): Nathan (photo source), Dan/Burlington (verifier + flip-gate engineer). Confirm edition/printing.

**Step 2 — Inventory before anything:** photograph ToC + table-of-tables + page headers; index actual table numbers, page ranges, dimensions, worked-example identity/granularity, and cert-anchor cells into `docs/manualN-transcription/inventory.md`. This is the burden-estimate correction checkpoint and the hard gate on all table naming (the Table 4D lesson).

**Step 3 — Charters + waves** per Unit N5: table4d-format worksheet per family; verbatim rules (values only from the book with page numbers; NO interpolation/extrapolation/derivation for gaps — absent stays absent; exact-as-printed; transcriber + date; anchor cells verified before encoding; illegible cells flagged, never inferred). P0 → P1 → P2 ordering; coverage telemetry ranks P2.

**Functional inventory + planning numbers** (corrected at Step 2): constructions 200-400 variants (seed ~25, grow to ~150 by demand); wall CLTD ~1,300 cells full → ~200-350 peak-window; roof CLTD ~300 → ~65-100; glass solar ~100 for production latitudes; shading ~30; people/lighting/ventilation tables in full (small); CLF deferred to N7; duct factors ~30; worked example(s) in full at N8. Total ~1,200-2,000 values, ~8-12 sessions; only P0 (~2-4 sessions) blocks cert fixtures.

---

## 6. Platform cohesion

| Seam | After Manual N |
|---|---|
| Weather | One station registry serves both; commercial accessor + user-entered WB with provenance; residential path byte-identical; `cool1−15` fabrication legal for residential only |
| Engine versions | `engines/versions.ts` single map; report footers, telemetry prefixes, test pins import it |
| Calc records | `MANUAL_N` first-class; `__grade`/`__assumptions`/`__method`/`__coverage` machine-readable; append-only untouched; legacy grade inferred at query time |
| Engine selection | `project.type==='Commercial'` drives routing via `resolveLoadStandard()`; `standard` stays dormant until a second region standard |
| Blueprint intake | Commercial spaces → `FormNInput` via `adapters/estimate.ts`; banner becomes the ledger card |
| CAD / duct bridges | Cloned thin bridges (N6); extraction refactor only later, characterization-tests-first (D9) |
| Reports | Manual N section + shared grade watermark + versions map; `unit:'pt'` gotcha respected |
| Telemetry | qa-benchmarks engine-prefix parameterized (`manualJ8-ts-%` / `manualN-ts-%`); commercial coverage panel; gap-cause bucketing = P2 transcription queue |
| Entitlements | `POST /api/calculations` already meters `calc_run`; Manual N meters for free. Pay-gating deferred to D8 (requires default-deny capability work — checkEntitlement is default-allow today) |
| Manual S/CS/Q | `FormNResult` clean typed totals = the seam; `manualS` refuses commercial inputs attributably; nothing else built |
| Cost estimator | `costEstimator.ts` fed FormNResult tonnage so commercial estimates keep their $-companion |
| Not a seam | Python calc-service (DO-NOT-IMPLEMENT banners stand) |

---

## 7. Validation strategy

**Estimate era (N1-N7):** worksheet unit tests day one · structural registry pin · golden tests per transcription wave with cert-anchor cross-checks · plausibility envelopes (warn-never-clamp) · coverage telemetry (`__coverage` gaps + `-fail` markers = the readiness signal AND the transcription queue) · cross-version drift on stored representative inputs (>2% unexplained fails build once goldens exist).

**Cert era (N8):** book worked-example fixtures at 0.5% line-item (independent double-computation before encoding; documented per-line tolerance where the book rounds) · `anchorBuilding` golden with the hard >2% drift gate · tiered secondary anchors (ASHRAE, optional informational Right-N cross-run) disclosed as non-ACCA.

**No legacy comparator, reframed:** `__divergenceVsJapprox` is expected divergence — evidence and a sales story ("ventilation loads account for the difference"), displayed as user context, never a pass/fail gate. Coverage substitutes for drift as the readiness signal.

**Legal reality:** commercial mechanical permits (IMC §312 / IECC-C lineage) require loads per an approved method — Manual N qualifies for light commercial; most jurisdictions require a **PE stamp regardless of software**, and no ACCA Manual N software-certification program is known to exist (verify with Hourahan; don't gate on it). Therefore "permit-grade commercial" = faithful Manual N math (N8 fixtures) + a PE-reviewable packet (existing PE-stamp program) + per-project derived grade. Until then, every commercial output carries the un-removable watermark + footer: *"Prepared using ACCA Manual N (5th Ed) methodology — budget estimate; not for permit submission."* The two-claim separation (§2) governs all wording.

---

## 8. UI surface

**`/manual-n` (N3)** — calculator template verbatim: lazy protected route + Suspense; ProjectGateDialog + ProjectContextBar; `hvac_manualn_inputs_${projectId||'draft'}` / `hvac_manualn_results_${...}` with reload on `activeProjectId` change; auto-save with skip-first-render `useRef` guard; pure engine import; Calculate / Reset / Export PDF (lazy jsPDF, `unit:'pt'`, prefs-driven, grade watermark) / print fallback; optional retailer finder; 44px targets, Tailwind-only, dark-first, density-scale.

Layout: left = building + spaces (occupancy picker per space with visible/editable pre-fills — never silent worst-case; envelope picks from the registry; ventilation panel; **required coincident-WB field** with provenance capture); right = results (per-zone + block, SHR, line items) with the **grade badge** and the **assumption ledger card** ("Budget Estimate — 7 assumptions", expandable, each with a confirm-real-value affordance that burns it down). The ledger card is the product embodiment of estimate→engineered as a climbable gradient.

**Routing obviousness:** commercial dashboard tile = "Manual N — Commercial Loads"; interstitial with escape hatch on `/calculator` for commercial projects (symmetric nudge on `/manual-n` for residential); Res/Com toggle removed at N3; COMMERCIAL amber context-bar chip; grade badge everywhere the number appears (results, /reports header, PDF footer, project card): amber "BUDGET ESTIMATE" / emerald "ENGINEERED (Manual N)". Blueprint intake lands commercial users on `/manual-n` with spaces pre-confirmed. Spotlight + Mason + Help + Guide copy in the same unit.

---

## 9. Migrations

- **`0018_manual_n_calc_type.sql`** — the program's ONLY DDL: rebuild `calculations` (0015/0016 create-copy-drop-rename pattern) widening `calc_type` CHECK to `('MANUAL_J','MANUAL_D','MANUAL_S','AED','MANUAL_N')`; recreate `idx_calc_project`. Mandatory runbook per Unit N0: Miniflare-harness + local-D1 rehearsal, pre-migration export backup, off-hours window, post-copy row-count + index verification. Tenant-scoping CI guard unaffected (calculations already strict + scoped).
- **No new tables** — deliberate: grade/assumptions/coverage/zones live in the existing inputs/outputs JSON snapshots (already the audit blob, `json_extract`-queryable, `__shadowRun` precedent); all engine tables are self-contained TS modules; weather WB is code-side. No new tenant-scoping surface. Optional `plan_entitlements` seed rows (data, not DDL) only if D8 ratifies pay-gating at the flip.

---

## 10. Risks

1. **Book acquisition + transcription is the critical path** (proven twice: Table 4D saga, 19B floors) — book ordered day one, two copies; census-first; P0/P1/P2 demand-driven; coverage telemetry finds the long tail. Residual: a PE/jurisdiction demanding full-profile CLTD fidelity forces extra waves.
2. **Table-numbering misattribution** — photos-before-charters hard gate; functional names until print-confirmed.
3. **Migration 0018 rebuilds the hot append-only calculations table** — full runbook mandatory (rehearsal ×2, export, off-hours, verification); mid-copy failure without backup is the residual and is unacceptable.
4. **Estimate-era engine is publicly wrong sometimes** (CLF=1.0, approximated WB, thin registry) — un-removable watermark, ledger, plausibility envelopes, graceful-degradation-with-visible-gaps; a user submitting anyway is defended by the machine-readable stamp on the immutable record.
5. **WB approximation understates latent loads in humid climates** — grade-capping + user-entered escape hatch from N4; residual if the user base expands south faster than habits/station data.
6. **Jurisdictional variance** — per-project grade + PE-packet framing, never a nationwide claim; footer legal review at N8.
7. **Entrenchment of N-lite simplifications** — every simplification is a named ledger assumption with a named follow-up unit (N7); version-pinned registry forces deliberate bumps; N8 gate has ratified criteria, not vibes.
8. **Cert anchor scarcity** — anchorBuilding golden decouples drift protection from book granularity; tiered secondary anchors; disclose a smaller cert matrix honestly.
9. **Bridge cloning duplicates logic** — accepted deliberately over refactoring untested live bridges; D9 extraction path exists with characterization-tests-first.
10. **Scope creep toward RTSM/HBM or CS/Q** — the gold-plating table is the contract; out-of-scope refuses attributably at permit grade, computes-but-watermarks at estimate grade.
11. **Copyright posture on transcribed ACCA tables** — same posture as J8 (sourcePage provenance, values not reproduced outside the engine); raise explicitly in the Hourahan conversation.
12. **Transition confusion (N1-N2)** — N1 upgrades the existing path in place, no parallel UI; N3 removes the toggle the same unit the page ships.

---

## 11. Fatal-flaw resolution ledger (traceability)

| Judge-named flaw | Resolution in this spec |
|---|---|
| Sparse engine as sole compute with hard throws → users get NO number | Dual-mode lookup: estimate-mode fallback + grade-capping assumption + coverage marker; whole-run failure → labeled J-approximation fallback (N2) |
| WB gating with no user escape hatch | Required user-entered WB + `wbProvenance`; `formN` structurally refuses permit-grade on approximated WB (N4) |
| Extraction refactors "covered by existing tests" (verified false) | Clone-don't-extract (N6); extraction only later, characterization-tests-first, off critical path (D9) |
| Adapter "never fabricate" vs. silent-run contradiction | Defaults-with-ledgered-assumptions at estimate grade; hard throws reserved for strict/permit paths |
| 0018 treated as routine | Strictest combined runbook mandated (§9) |
| Grade name 'cert' conflates self-validation with ACCA recognition | Taxonomy is 'budget-estimate'/'permit-grade'; two-claim separation + labeling ladder (§2) |
| All value deferred until after cert (dark period) | N0 honesty layer ships first standalone; N1/N2 improve the live estimate immediately |
| Retro-labeling ambiguity vs. append-only | No retro-mutation; legacy grade inferred at query time (§2) |
| N1 tables shipped from memory pre-book | Provenance gate: non-ACCA cited sources only pre-book; book values win on receipt (N1, D6) |
| Engine skeleton with as-printed structures pre-book | Table naming/structure gated on photos; only types/lookup/worksheet scaffolding + functional names before (N5) |
| Presenting Manual N as the full Unit-F directive | Scope note up top; pay-gating founder signal carried as D8 |
| Grade taxonomy divergence between designs | One convention ratified before N0 (D2) |

---

## 12. Decisions for Nathan

See structured list. Each decision is tagged with the unit it must precede.

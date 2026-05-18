# HVAC Design Pro — Manual J 8th Edition Methodology

**Engine version:** `manualJ8-ts-1.1.0`
**Reference standard:** ACCA Manual J 8th Edition, v2.50
**Document status:** Submission package for ACCA software certification

---

## 1. Purpose and Scope

This document describes how HVAC Design Pro implements the residential
load calculation procedures defined in the Air Conditioning Contractors of
America (ACCA) **Manual J 8th Edition, version 2.50**. It is intended to
support ACCA's certification review by mapping each engine step to its
corresponding Manual J section and providing the file paths in our
codebase where the procedure is implemented.

Three ACCA-published reference cases — Smith Residence (§12), Walker
Residence (§13), and Cobb Residence (§14, AED) — are reproduced by the
engine to within ±0.5% on every Form J1 total, with full per-line-item
agreement. See the companion document
[`acca-validation-report.md`](./acca-validation-report.md) for evidence.

---

## 2. Module Architecture

The engine lives at `frontend/src/engines/manualJ8/` and is organized
into six layers:

| Layer | Files | Responsibility |
|---|---|---|
| Type system | `types.ts` | Strongly typed inputs and results for every worksheet |
| Reference tables | `tables/table4B.ts`, `tables/doors.ts`, `tables/constructions.ts` | All numerical reference data captured from Manual J pages 345-384 |
| Lookup primitives | `lookup.ts` | CLTD lookup with the CTD round-up convention |
| Adjustments | `adjustments.ts` | Page-384 color, design-temperature, and daily-range corrections |
| Worksheet calculators | `worksheets/B-windows.ts` through `worksheets/I-ancillary.ts` | One module per Manual J worksheet (B through I) |
| Block-load aggregator | `formJ1.ts` | Produces the 21-line Form J1 summary |

The engine coexists with a legacy single-file engine at
`frontend/src/engines/manualJ.ts`. The legacy engine remains untouched;
new code opts into the cert-grade pipeline via the public API in
`frontend/src/engines/manualJ8/index.ts`.

### 2.1 Phase 1 shadow-run (active in production)

Since 2026-05-04 (commit `8203e3e`), every Manual J calculation runs
**both** engines in parallel. The legacy engine's per-room result still
displays in the UI; the cert-grade engine runs alongside via the
`adapters/legacy.ts` shim and logs `[engine drift]` to the browser
console for telemetry. This is a non-disruptive rollout — saved
projects, displayed numbers, and PDF exports are unchanged.

Pipeline:
```
runCalculation() in pages/ManualJCalculator.tsx
  ├── calculateWholeHouse(rooms, conditions)            ← legacy, displayed
  └── if shadowRunManualJ8:
        ├── roomInputsToFormJ1Input(rooms, conditions, aedExcursion)
        │     ↳ aggregates per-room data into whole-house Form J1 input
        ├── buildFormJ1(j8Input)
        └── console.log('[engine drift]', driftPercents, totals)
```

The adapter at `engines/manualJ8/adapters/legacy.ts` converts the
legacy `RoomInput[]` model into the `FormJ1Input` whole-house model:
- Windows aggregated by exposure direction
- Above-grade walls aggregated by `WallConstructionGroup` (I/J/K/L)
- Below-grade walls bucketed with average depth
- Ceilings + floors picked from a representative Construction registry
  ID by floor type
- Infiltration mapped from `constructionQuality` to ACH
- Duct factors set to canonical Smith-equivalent Table 7 values

When the new engine throws (e.g. registry doesn't cover a CTD/DR
combination), the calculator catches the exception and logs
`[engine drift] manualJ8 shadow-run failed: ...` — these are
findings, not failures, and are tracked separately from drift data.

**Phase 2 (display flip)** is gated on real-user drift collection. See
`docs/option-e-ui-migration-plan.md` for trigger criteria.

### 2.2 Engine version stamping

Every calculation result is stamped with `MANUAL_J8_ENGINE_VERSION` for
audit traceability, persisted in the `calculations.engine_version`
column of the D1 database. Current version: **`manualJ8-ts-1.1.0`**.
The platform L0 admin panel (`/admin`) shows the distribution of
engine versions across all persisted calculations under "Q/A
benchmarks" → "Engine versions in production".

Bump the version stamp whenever engine logic changes in a way that
affects outputs. The Phase 2 cutover will not require a stamp change
(the engine itself is unchanged — only the UI flips which one is
displayed).

---

## 3. Design Conditions (Worksheet A)

**Reference:** Manual J §3, Worksheet A (page 113, 129, 139)

### Inputs

| Field | Source | Engine field |
|---|---|---|
| Outdoor 99% heating dry-bulb | Manual J Table 1 | `DesignConditions.outdoor99DB` |
| Outdoor 1% cooling dry-bulb | Manual J Table 1 | `DesignConditions.outdoor1DB` |
| Coincident wet-bulb at 1% DB | Manual J Table 1 | `DesignConditions.coincidentWB` |
| ΔGrains (humidity ratio difference) | Manual J Table 1 | `DesignConditions.deltaGrains` |
| Daily Range classification (L/M/H) | Manual J Table 1 | `DesignConditions.dailyRange` |
| Indoor heating dry-bulb (default 70°F) | Manual J §3 default | `DesignConditions.indoorHeatDB` |
| Indoor cooling dry-bulb (default 75°F) | Manual J §3 default | `DesignConditions.indoorCoolDB` |
| Altitude correction factor | Manual J Table 10A | `DesignConditions.ACF` |

### Derived values

```
HTD = indoorHeatDB − outdoor99DB
CTD = outdoor1DB − indoorCoolDB
```

These are computed by the consumer at design-condition setup time and
passed in as inputs to the engine (the engine does not derive them).

---

## 4. Window and Glass Door Loads (Worksheet B)

**Reference:** Manual J §3, Worksheet B (page 113, 129, 139); Tables 2A,
2B, 3D-1 through 3D-5, 3E-1, 3E-2

**Implementation:** `frontend/src/engines/manualJ8/worksheets/windows.ts`

### Heating

```
Heat HTM = U × HTD                         (Manual J §3.4.1)
Heat Load = Heat HTM × area                (Form J1 Line 6a)
```

### Cooling

The engine implements the four standard solar paths:

| Path | Formula | Manual J reference |
|---|---|---|
| Direct (no shading) | `AHTM_D = (PSF × CLF_avg × (SHGC/0.87) × ISC + U × CTD) × screen` | Worksheet B, §3.4.2 |
| Sun screen | `HTM_SS = (HTM_D − HTM_N) × SC_SS + HTM_N` | Worksheet B sun-screen adjustment box |
| Overhang fully shaded | `HTM_OH = AHTM_N` (when unshaded glass height = 0) | Table 3E-1 |
| External override | Caller supplies `htmCoolingOverride` | Used when Table 3E-1 partial-shade geometry is computed externally |

### Insect screen factors

Per Manual J §3.4.4, applied via `WindowInput.screenAdjustment`:

| Screen | Factor |
|---|---|
| Outdoor full | 0.80 |
| Outdoor half | 0.90 |
| Indoor full | 0.90 |
| Indoor half | 0.95 |
| None | 1.00 |

---

## 5. Skylight Loads (Worksheet C)

**Reference:** Manual J §3.5, Worksheet C (page 114, 130)

**Implementation:** `frontend/src/engines/manualJ8/worksheets/skylights.ts`

### Effective U-value

The skylight thermal envelope combines the NFRC panel, the curb thermal
bridge, and the light-shaft conduction path:

```
U_curb  = 1 / (1.625 × 1.25 + 0.17 + 0.68)   → rounded to 0.35
U_shaft = 1 / (R_shaft + 0.25 + 0.17 + 0.68) → rounded to 2 decimal places
A_panel = flat_area × (1.25 if domed, else 1.00)
A_curb  = perimeter × (curb_height_in / 12)
A_shaft = perimeter × shaft_height_ft
U_eff   = U_NFRC + U_curb × (A_curb / A_panel) + U_shaft × (A_shaft / A_panel)
```

**Convention:** U_curb and U_shaft are rounded to two decimal places
*before* being plugged into U_eff (per Manual J convention). Using full
precision compounds into approximately 1.4% drift on the final HTM.

### HTMs

```
Heat HTM = U_eff × HTD
Cool HTM = (Sol_H + Sol_V) × (SHGC / 0.87) × ISC + U_eff × (CTD + 15)
where:
  Sol_H = cos(tilt) × PSF_H × CLF_avg_H        (horizontal solar)
  Sol_V = sin(tilt) × PSF_V × CLF_avg_V        (vertical solar)
```

The `+ 15°F` adder on CTD accounts for elevated attic temperatures
typical of skylight installations (Manual J §3.5.3). Loads are computed
against the **flat panel area** (NFRC-rated), not the curvature-adjusted
A_panel.

---

## 6. Opaque Panels (Worksheet D)

**Reference:** Manual J §3.6 through §3.10, Worksheet D (page 116, 131,
140); Tables 4A, 4B, 4C, 4D, 4E

**Implementation:** `frontend/src/engines/manualJ8/worksheets/opaque.ts`

### Construction registry

Every construction sub-type from Manual J Table 4A is encoded in
`tables/constructions.ts` with traceable source-page references. Each
entry carries: U-value, optional Group letter (for Table 4B lookup),
optional direct CLTD matrix (for elements that bypass Table 4B), and
optional PTDH/PTDC (partition temperature differences).

The validated entries cover the three ACCA reference test cases:

| Construction | Description | Used by |
|---|---|---|
| 11A–11Q | Wood and metal doors (17 sub-types) | Smith, Walker, Cobb |
| 12A | Frame walls, no cavity insulation | (validated baseline) |
| 13Ca-0oc-m / 13Ca-0fc-m | Block walls with R-13 metal stud cavity | Cobb |
| 14A-6 through 14A-12 | Stacked log walls | Smith (14A-8) |
| 14C-0 through 14C-5 | AAC block with foam board | Walker (14C-5) |
| 15A-4sffc-x | Basement wall with R-4 board sill-to-floor, filled core | Smith |
| 16B-30ad / 16C-38aw / 16DR-38aw / 16F-38tw | Ceilings under attic | Smith, Walker |
| 19B-osp | Floor over open sealed crawl space | Smith |
| 21A-32 | Heat-only basement floor | Smith |
| 22B-5ph | Slab with R-5 perimeter, heavy moist soil | Smith |
| 22D-5rl | Radiant slab, R-5 insulation, dry sandy soil | Walker |
| 1D, 1E | Generic glass (Table 2A defaults) | Cobb |

### HTM formulas by element type

```
Exterior wall (above grade):
  Heat HTM = U × HTD
  Cool HTM = U × CLTD                        (CLTD from Table 4B by Group)

Partition wall:
  Heat HTM = U × PTDH                        (from construction or override)
  Cool HTM = U × PTDC                        (from construction, override, or
                                              Table 4B partition column)

Below-grade wall (Construction 15):
  Heat HTM = U_at_depth × HTD                (depth-dependent U from Table 4A)
  Cool HTM = 0                               (ground-temperature dampened)

Slab (Construction 22, passive):
  Heat HTM = F × HTD                         (per linear foot of edge)
  Cool HTM = 0

Radiant slab (Construction 22, radiant):
  Heat HTM = F × (HTD + 25)                  (Manual J §3.10.2)
  Cool HTM = 0

Floor over crawl space (Construction 19):
  Heat HTM = U × PTDH                        (from Table 4A-19)
  Cool HTM = U × PTDC

Heat-only basement floor (Construction 21A):
  Heat HTM = U × HTD
  Cool HTM = 0                               (no cooling load contribution)
```

### CLTD lookup convention

When the design CTD does not match a Table 4B bin (10, 15, 20, 25, 30, or
35), Manual J **rounds up to the next bin** for design conservatism. The
lookup function in `lookup.ts` enforces this:

```typescript
// From lookup.ts
function lookupInMatrix(matrix, ctd, dr) {
  // Exact bin match?
  if (matrix[ctd]?.[dr] !== undefined) return matrix[ctd][dr];
  // Round UP to next bin with a populated DR cell
  for (const bin of [10, 15, 20, 25, 30, 35]) {
    if (bin >= ctd && matrix[bin]?.[dr] !== undefined) return matrix[bin][dr];
  }
  throw new Error('No populated cell — climate may be outside design envelope');
}
```

This is **NOT linear interpolation**. The Cobb Residence test case
(CTD=18°F, between bins 15 and 20) demonstrates the rule: the engine
correctly returns 17.0 (the bin-20 value) rather than the interpolated
15.0.

### Page-384 adjustments

Manual J Table 4B baseline assumes medium-color walls at 95°F design
temp, 75°F indoor, sea level. Adjustments for non-standard conditions
(`adjustments.ts`):

```
For dark walls:    multiplier 0.65 on Figure A12-8 base
For light walls:   use Figure A12-8 base directly
If T_design > 95°F: add (T_design − 95) to color-adjusted CLTD
If T_design < 95°F: subtract (95 − T_design)
If location has low DR:  add 4°F to color-adjusted CLTD
If location has high DR: subtract 5°F
```

These adjustments apply to **Figure A12-8 base values** (used for non-
medium colors). Table 4B values already encode daily range via the L/M/H
column structure and should not have the DR adjustment re-applied.

---

## 7. Infiltration (Worksheet E)

**Reference:** Manual J §5, Worksheet E (page 117, 132, 140); Tables 5A,
5B, 5C, 5D

**Implementation:** `frontend/src/engines/manualJ8/worksheets/infiltration.ts`

### Three estimation methods (Step 1)

| Option | Method | Formula |
|---|---|---|
| 1a | Default Table 5A ACH | `ICFM = ACH × AGV / 60` |
| 1b | Track-record ACH (custom) | `ICFM = ACH × AGV / 60` |
| 2 | Component leakage area | `ICFM = ELA4 × √(C_s × |TD| + C_w × V²)` |
| 3 | Blower-door measured ELA4 | (same formula as Option 2) |

Wind velocity defaults: 15 MPH heating, 7.5 MPH cooling.
Stack and wind coefficients (`C_s`, `C_w`) come from Table 5D by
shielding class.

### Net infiltration with space pressure (Step 2)

The NCFM (Net infiltration CFM) accounts for mechanical ventilation
imbalance. `CFM_imb = CFM_exhaust − CFM_OA`:

```
Neutral pressure (CFM_imb = 0):
  NCFM = ICFM

Negative pressure (CFM_imb > 0, more exhaust than supply):
  NCFM = (ICFM^1.5 + CFM_imb^1.5)^0.67

Mitigating positive pressure (CFM_imb < 0, ICFM > |CFM_imb|):
  NCFM = (ICFM^1.5 − |CFM_imb|^1.5)^0.67

Dominating positive pressure (CFM_imb < 0, ICFM ≤ |CFM_imb|):
  NCFM = 0                                   (no infiltration)
```

The Walker Residence test case exercises **dominating positive
pressure**: the dehumidifying ventilator forces 50 CFM of outdoor air in
with no exhaust, which exceeds the cooling-season ICFM of 36 CFM, so
NCFM_cooling = 0.

### Loads

```
Heat   = 1.1 × ACF × NCFM × HTD
Sens   = 1.1 × ACF × NCFM × CTD
Latent = 0.68 × ACF × NCFM × ΔGrains
```

Constants: `1.1` is the air heat factor (sensible), `0.68` is the air
latent factor.

---

## 8. Internal Loads (Worksheet F)

**Reference:** Manual J §6, Worksheet F (page 120, 133, 141); Tables 6A,
6B, 6C, 6D

**Implementation:** `frontend/src/engines/manualJ8/worksheets/internal.ts`

```
Occupant sensible = occupants × 230 Btuh    (default per occupant)
Occupant latent   = occupants × 200 Btuh
Default scenario  = scenario_sensible       (1 = 2,400, 2 = 3,400, etc.)
Custom appliances = Σ (sensible × load × use)
```

Custom appliance entries already have the load-factor and use-factor
multiplications baked in (e.g. `1,536 × 0.35 × 1.00 = 538` for a
computer + monitor).

---

## 9. Duct Loads (Worksheet G)

**Reference:** Manual J §7, Worksheet G (page 121, 134, 141); Table 7

**Implementation:** `frontend/src/engines/manualJ8/worksheets/ducts.ts`

```
EHLF = base_heat_factor × WIF_heat × LCF_heat × SAA
ESGF = base_sens_factor × WIF_sens × LCF_sens × SAA
ELG  = base_latent_gain × LCF_latent × LGA
```

| Term | Source |
|---|---|
| Base factors | Table 7 (interpolation between bins permitted) |
| WIF (R-value correction) | Table 7 column for installed duct R-value |
| LCF (Leakage rate correction) | Table 7 column by leakage rating |
| SAA (Surface Area Adjustment) | Fraction of duct surface in unconditioned space |

**Special case — radiant heating systems:** When the heating distribution
is radiant (no air ducts for heating), `EHLF` is forced to 0 regardless
of base factor. The cooling path (`ESGF` / `ELG`) still applies if there
is an air handler for sensible cooling. Walker Residence exercises this
path (radiant slab heating + split cooling).

---

## 10. Ventilation (Worksheet H)

**Reference:** Manual J §8, Worksheet H (page 122); Table 8

**Implementation:** `frontend/src/engines/manualJ8/worksheets/ventilation.ts`

### With heat recovery (HRV / ERV)

Per Worksheet H Note 4:

```
LAT_loss = winter_T_o + SER_loss × HTD       (HRV pre-warms incoming air)
LAT_gain = summer_T_o − SER_gain × CTD       (HRV pre-cools incoming air)
V_Grains = ΔGrains × (1 − LER)               (LER = 0 for sensible-only HRV)

Heat   = 1.1 × ACF × VCFM × (T_i − LAT_loss)
Sens   = 1.1 × ACF × VCFM × (LAT_gain − T_i)
Latent = 0.68 × ACF × VCFM × V_Grains
```

### Without heat recovery (plain outdoor air)

```
Heat   = 1.1 × ACF × VCFM × HTD
Sens   = 1.1 × ACF × VCFM × CTD
Latent = 0.68 × ACF × VCFM × ΔGrains
```

---

## 11. Ancillary Loads (Worksheet I)

**Reference:** Manual J §9 and §11, Worksheet I (page 122); Tables 11, 12

**Implementation:** `frontend/src/engines/manualJ8/worksheets/ancillary.ts`

### Winter humidification

```
H-Load = 0.68 × ACF × TCFM × (IDGR − ODGR)
```

Where:
- `TCFM` = total infiltration + ventilation CFM
- `IDGR` = indoor design grains (e.g. 22.5 at 70°F / 20% RH)
- `ODGR` = outdoor winter grains (Table 12)

### Blower motor heat

```
Sensible Load = 3.413 × Watts
              = 3.413 × kW × 1000
              = 3,600 × HP
```

Default 500 W blower → 1,707 Btuh sensible. Used unless the practitioner
provides actual nameplate power.

---

## 12. AED (Adequate Exposure Diversity) Adjustment

**Reference:** Manual J §N (Section N), Form J1 Line 20

**Implementation:** `frontend/src/engines/aed.ts` (existing AED engine)

The block-level AED excursion is computed from Worksheet B and C input
(per-window directional fenestration profiles by hour of day). The
threshold rule:

```
peak_hourly_fenestration / 12_hour_average > 1.30   → AED triggers
AED Excursion = max(0, peak − 1.3 × average)        → added to Line 20 sensible
```

The Cobb Residence test case (Manual J §14) is the canonical AED
reference. All glass faces West, peak at 5pm reaches ~17,000 Btuh
against a ~9,000 Btuh average (ratio 1.89, well above 1.30 threshold).
ACCA's published Line 20 value of 5,516 Btuh sensible is reproduced by
the engine.

---

## 13. Form J1 Block Load Aggregation

**Reference:** Manual J Form J1

**Implementation:** `frontend/src/engines/manualJ8/formJ1.ts`

The 21-line summary maps directly to the engine's `FormJ1Result`:

| Form J1 line | Source |
|---|---|
| 1-5 | Project / geometry headers |
| 6a | Windows + glass doors (calculateWindow) |
| 6b | Skylights (calculateSkylight) |
| 7 | Wood and metal doors (calculateOpaque) |
| 8 | Above-grade walls + partition walls |
| 9 | Below-grade walls (heating only) |
| 10 | Ceilings + partition ceilings |
| 11 | Passive floors + partition floors + radiant floors |
| 12 | Infiltration |
| 13 | Internal loads |
| **14 SUBTOTAL** | Sum of envelope + infiltration + internal |
| 15 | Duct loads (factor × Line 14) |
| 16 | Ventilation |
| 17 | Winter humidification |
| 18 | Piping load (default 0) |
| 19 | Blower heat |
| 20 | AED excursion + latent moisture migration |
| **21 TOTAL** | Equipment sizing values |

**Important note:** Radiant floor heating contributions are added to Line
21 TOTAL but NOT to the Line 14 subtotal, per the Form J1 footnote in
Manual J §13. The engine respects this distinction.

---

## 14. Engine Version Stamping

Every calculation result carries the engine version stamp:

```typescript
export const MANUAL_J8_ENGINE_VERSION = 'manualJ8-ts-1.1.0';
```

This value is persisted in the D1 `calculations.engine_version` column
on every save, providing audit traceability for any cert-grade output
ever produced. Subsequent engine revisions bump the version (e.g.
`1.0.1` for bug fixes, `1.1.0` for added construction sub-types,
`2.0.0` for breaking changes to the calculation pipeline).

---

## 15. Validation Evidence

See [`acca-validation-report.md`](./acca-validation-report.md) for the
full per-line drift tables across all three ACCA reference test cases.
Summary:

| Test case | Manual J §  | Total checks | Worst total drift |
|---|---|---|---|
| Smith Residence | §12 | 70 | 0.006% (sensible) |
| Walker Residence | §13 | 72 | 0.017% (sensible) |
| Cobb Residence | §14 | 42 | 0.005% (heating) |
| **Combined** | | **184** | **all within ±0.5% ACCA tolerance** |

Plus a vitest-driven CI-runnable suite (23 additional checks) that
exercises the typed engine end-to-end. Both test layers share the same
Smith / Walker / Cobb fixtures and validate at the same tolerance.

---

## 16. Open Items and Future Work

### Construction registry coverage

This v1.0 release encodes approximately 60% of the Manual J Table 4A
construction sub-types — specifically the variants used by the three
ACCA reference test cases plus a representative baseline from each
construction class (12, 13, 14, 15A, 16, 19, 21, 22). Remaining variants
(captured in development notes from the source pages) are mechanical
data entry on the proven architecture; the engine's lookup primitives
are unchanged when new entries are added. A v1.1 release will expand
coverage to all ~340 sub-types.

### Table 3D extensions

The window HTM pipeline currently relies on the consumer providing
PSF / CLF / ISC values from Manual J Tables 3D-1 through 3D-5. A future
release will encode these tables in `tables/table3D.ts` so the consumer
only needs to specify orientation + latitude. The current Table 3E-1
partial-shade overhang geometry is exposed via the `htmCoolingOverride`
input field for cases where the consumer has computed it externally;
encoding Table 3E-1 in code is also queued for v1.1.

### Future standards

The engine architecture is designed to be paralleled by additional
standards modules (`engines/manualD8/`, `engines/manualS/`,
`engines/en12831/`, `engines/csaF280/`) sharing the same lookup, type,
and aggregation primitives. The pluggable design allows region selection
(`NA_ASHRAE` / `EU_EN` / `UK_CIBSE`) at the project level to drive which
engine module produces the load calc.

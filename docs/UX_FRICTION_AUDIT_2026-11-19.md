# HVAC Design Pro — Friction & Correctness Audit

**Date:** 2026-11-19 · **Tested:** branch `fix/security-tier0` @ `86ea59d` (= `main` + PR #43); LiDAR/pricing-feed read from `origin/feat/pricing-feed-and-lidar-ingest` · **Status:** report only — nothing was fixed.

This is a test of every workflow against what a working HVAC professional would expect, with the frictions ranked by how many people and how many daily tasks they touch. Anything that produces a wrong engineering number or a misleading document is pulled into its own section first.

## How this was tested, and how far to trust each item

Every finding carries one evidence tag:

| Tag | Meaning |
|---|---|
| **[B]** | Verified in the browser: app driven on the local dev server with the API pointed at a dead port (offline recipe) and a mock session. Never against production. |
| **[P]** | Verified numerically: a temporary vitest probe ran the real engine modules on a 2,400 sq ft two-storey, 12-room house (Burlington VT 05401, Phoenix 85001, Atlanta 30301). Probe deleted afterwards. |
| **[C]** | Read from code by me. |
| **[A]** | Traced from code by one of four read-only sub-audits (auth, collaboration, CAD, calculator pages). I spot-checked the highest-impact claims in each (marked ✓); the rest are unverified by a second pass and should be confirmed when picked up. |

Scenarios used: a contractor taking a 2,400 sq ft two-storey house from a floor plan through Manual J → D → S → `/reports`; an engineer importing a plan-set PDF; a municipal reviewer working a queue; a tech on a tablet with a flaky connection.

**Not exercised live** (need a real API, a file picker, or a download): sign-in/registration/MFA/SSO round-trips, permits, team, community, notifications, audit log, admin, Mason chat and feedback, blueprint/PDF/LiDAR file import, LET, vector trace, the 3D viewer, version history, and the contents of exported PDFs. Those are code-traced only. Screen-reader behaviour was not tested; accessibility figures are DOM measurements.

Severity: **WRONG** (wrong engineering result or misleading document) · **BLOCKS** the task · **SLOWS** it · **COSMETIC**. Fix size: **S** < 1 h · **M** ≈ half a day · **L** multi-day.

Path shorthand: `FE/` = `frontend/src/`, `WK/` = `workers/src/`.

## Baselines

- **Tests:** frontend vitest 352 pass / 13 fail; the 13 are the known local Node 26 `localStorage` failures in `storage.test.ts` and `usePreferencesStore.test.ts`, not regressions. Worker suite not re-run.
- **ACCA reference cases:** Smith / Walker / Cobb pass in `FE/engines/manualJ8/__tests__/`. Those tests exercise `manualJ8`. The numbers users see and print come from the legacy engine `FE/engines/manualJ.ts`, which has no reference-case tests (see E10).
- **Bundle:** 1,063 KB gzip of JS across all chunks against the 660 KB target. First load is about 170 KB gzip (entry 116, CSS 20, Mason 34) plus the route chunk, so the target is met only if it is read as "initial route". Details in section 10.

## The twelve that matter most

1. **CAD → Manual J loses the building envelope.** Hand-drawn rooms arrive with zero exterior walls and zero glass, and every room arrives twice (E1–E3).
2. **The numbers on the report come from the legacy engine, not the cert-grade one**, and differ from it by +13% to +48% on heating for the test house (E10).
3. **ZIP Auto-Fill appears to load 99.6% / 0.4% design temperatures while labelling them 99% / 1%** (E4).
4. **Ventilation, duct location, ceilings, occupants and slab soil are silently defaulted toward the worst case** (E5–E9), against ACCA rule 4 in `CLAUDE.md`.
5. **Manual S reports "Within Manual S Limits" for equipment it invented itself** (E13).
6. **Results and PDFs go stale** when conditions change after Calculate (E11).
7. **Offline or on a weak signal the screen fills with error toasts** — five on every page load, covering half a phone screen (X1).
8. **CAD work can be lost or forked** on a flaky connection, and blueprint sheets overflow local storage silently (P2–P4).
9. **A second device gets none of the calculator data** — the cloud sync is write-only (P5).
10. **Every self-registered user hits a mandatory authenticator wall on their second sign-in**, and never sees their backup codes (A1, A2).
11. **A permit reviewer cannot see the calculations or the drawing**, and "changes requested" has no way back into the queue (R1, R2).
12. **Cmd+K search returns supply houses for almost any query** and Enter opens Google Maps (U1).

---

## 1. Wrong engineering results

These change a load, a duct size, an equipment verdict, or what a printed document claims. All sit on the main path of the product.

### CAD → Manual J

**E1 · Detected rooms carry no walls, so Manual J receives no envelope** — WRONG · M · [B] ✓
Drew a closed 13 × 11 ft room with R-19 walls and a 36 × 48 in window, ran Detect Rooms, then "Import from CAD" in Manual J. The room arrived with 0 exterior walls, 0 sq ft of glass, wall R-13 and exposure "S". A professional expects the drawn walls and windows to arrive. The only warning is a toast saying the room "had no exterior wall to read [orientation] from"; the missing glass and walls are silent. Result: wall and window heating loss and all solar gain are absent, so equipment is under-sized.
Where: `FE/features/cad/components/CadCanvas.tsx:1025` (`wallIds: []`, never filled); consumed at `FE/engines/cadToManualJ.ts:59-70,107,150`.
Fix: record wall ids on the graph edges during detection and emit them per room; make the import refuse or flag any room with no walls.

**E2 · Every detected room is returned twice; the floor area doubles** — WRONG · S · [B] ✓
The same single rectangle produced "Detected Rooms (2) · Total Area 277 sq ft" (true area 143). The face walk finds the room clockwise and counter-clockwise, and the de-duplication compares a path that still contains its repeated start node against one that does not, so it never matches. With several rooms the building outline also survives as an extra room [A]. Both copies import into Manual J.
Where: `CadCanvas.tsx:992-996`.
Fix: drop the outer face (largest area / opposite winding) and compare like with like.

**E3 · Room areas are computed from corners rounded to a 15 px lattice** — WRONG · S · [B]
The 13 × 11 ft room (143 sq ft) was reported as 138.7 sq ft (−3%). At the default 40 px/ft each corner can move ±0.19 ft; a 4 × 4 ft closet loses about 12% [A]. The error grows as px/ft falls.
Where: `CadCanvas.tsx:909-924` (snap), `:1006-1026` (area from snapped nodes).
Fix: keep each node's true coordinate for area, perimeter and polygon; use the lattice only for merging.

**E3a · The bridge reduces measured walls to a count and all glass to one direction** — WRONG · M · [A]
Even once E1 is fixed, `exteriorWalls` is passed as a count capped at 4 and one `exposureDirection` per room; length/width are back-solved from area and perimeter and rounded to 0.1 ft. Doors are ignored entirely; the "sliding patio" preset only changes size, so patio glass cannot be modelled; deleting a wall leaves its windows behind.
Where: `cadToManualJ.ts:70,96-97,137,150`; `FE/features/cad/store/useCadStore.ts:872-878`.
Fix: pass per-wall exterior length and per-orientation glass area; cascade-delete openings; include door area.

**E3b · Every floor gets an attic ceiling and a crawlspace floor; ceiling height is fixed at the floor default** — WRONG · S/M · [A]
`cadToManualJ.ts:136,147-149` stamps `ceilingRValue 38`, `floorType 'crawlspace'` on every room of every storey; `Floor.heightFt` has no editor.
Fix: use floor stacking to set "conditioned above/below"; add a per-floor height input.

### Design conditions

**E4 · ZIP Auto-Fill temperatures look like ASHRAE 99.6% / 0.4%, labelled as 99% / 1%** — WRONG · M · [C], needs book check
The table header says "99% heating / 1% cooling … ASHRAE Fundamentals 2021", the UI says "ASHRAE 99%/1% design temps applied", and the PDF prints "(99% ASHRAE)" / "(1% ASHRAE)". The stored values track the more extreme column: Burlington VT −7 / 88, Seattle 25 / 85, Phoenix 34 / 110, Atlanta 18 / 95, Boston 7 / 91, Chicago −2 / 93, Miami 45 / 92. My recollection of the ASHRAE 2021 station data puts the 99% / 1% values near −3 / 85, 30 / 81, 42 / 108, 26 / 92, 13 / 88, 4 / 89, 52 / 91. I did not have the handbook or Manual J Table 1A open, so treat the comparison as a strong lead, not a ruling. If it holds, every Auto-Filled project is over-sized: Atlanta's heating ΔT is 52 °F instead of about 44 (+19%).
Where: `FE/engines/ashraeWeather.ts:1-66` (and all 894 rows); `FE/pages/ManualJCalculator.tsx:718-719`.
Fix: have someone with the book (Dan) audit 20 stations against Table 1A; re-key from the correct column; add a test pinning a dozen stations.

**E4a · ZIP lookup accepts malformed ZIPs and maps them to the wrong city** — WRONG · S · [P]
Lookup uses the first three digits with no length check: "5401" (a Vermont ZIP with its leading zero dropped) returns Wausau WI; "99999" returns Ketchikan AK. An unknown prefix correctly reports "not found" (via a native `alert()`).
Where: `ashraeWeather.ts:990-997`; `ManualJCalculator.tsx:1036`.
Fix: require five digits; show the matched station and let the user confirm.

**E4b · Location is not saved or printed, and defaults pass as design data** — WRONG · S/M · [B][A]
The ZIP field was empty after a reload and the "Burlington, VT" label was gone. Untouched defaults (5 °F / 95 °F / 40° / 500 ft / 1,800 sq ft) let Calculate run with no location, and the PDF labels whatever is in the fields "(99% ASHRAE)". The project wizard collects street and city but no state or ZIP, so nothing can be pre-filled.
Where: `ManualJCalculator.tsx:106-108,718`; `FE/features/projects/components/NewProjectModal.tsx:85-100`; `FE/engines/manualJ.ts:929-952`.
Fix: collect ZIP at project creation; persist `{zip, station, source}`; block Calculate until conditions are confirmed.

**E4c · Indoor humidity default is about 43% RH, described as 50%** — WRONG · S · [C][A]
`indoorGrains: 55` is commented "~50% RH at 75°F"; 50% RH is about 65 gr/lb. For Burlington the grain difference is 35 instead of 25, so outdoor-air latent load is about 40% high.
Where: `manualJ.ts:935-936`.
Fix: an indoor RH selector (45 / 50 / 55%) converted to grains.

### Silent worst-case defaults (ACCA rule 4)

**E5 · Ventilation load is always added and cannot be turned off** — WRONG · M · [P][B]
The engine adds the full ASHRAE 62.2 airflow as untempered outdoor air on top of infiltration. For the test house: 110 CFM, 9,106 Btu/h of heating — 21% of the total — plus 2,606 Btu/h latent. There is no None / exhaust-only / HRV input. The airflow is sized from a separate "Total Floor Area" field that defaults to 1,800 sq ft and is not tied to the rooms.
Where: `manualJ.ts:796-807,946`.
Fix: ventilation-type selector with recovery effectiveness; derive floor area from the rooms.

**E6 · Duct location defaults to attic (+15% on heating, sensible and latent)** — WRONG · S · [C][A]
A user who never opens Duct System gets a flat 1.15 multiplier. The PDF says "Duct losses per Manual J Table 7"; these are flat multipliers, not Table 7.
Where: `manualJ.ts:219-225,940`; `ManualJCalculator.tsx:928`.
Fix: no default — require a selection; reword the methodology line.

**E7 · Every room gets an attic ceiling, including the first floor of a two-storey house** — WRONG · M · [P][B]
The room form has no "conditioned space above" option (floors have one). Test house: 2,432 Btu/h of phantom first-floor ceiling loss.
Where: `manualJ.ts:626,692`.
Fix: ceiling-type select, defaulted from floor level.

**E8 · Slab floors use worst-case soil, no edge insulation, and each room's full perimeter** — WRONG · M · [P][A]
Choosing "Slab" gives F = 0.73 × 1.86 with no way to change soil, insulation or exposed perimeter; interior room edges are counted as slab edge. Probe: 7,319 Btu/h versus 5,312 with light dry soil for one room. Six 20 × 10 rooms sum to 360 ft of "perimeter" against 140 ft for the real footprint.
Where: `manualJ.ts:632-638`; no slab inputs in `ManualJCalculator.tsx`.
Fix: expose the three inputs when floor type is slab; require exposed perimeter.

**E9 · Occupants are counted per room** — WRONG · M · [A]
Each default room carries two seated people, presets two to four. Twelve default rooms = 24 people ≈ 10,080 Btu/h, against roughly 1,720 for bedrooms + 1.
Where: `manualJ.ts:457-477`; `cadToManualJ.ts:154`.
Fix: one whole-house occupant count, distributed to rooms.

### The engine behind the numbers

**E10 · Displayed, printed and saved loads come from the legacy engine** — WRONG · L · [P][C]
The page header reads "ACCA Manual J 8th Edition". The loads come from `manualJ.ts`, whose own header calls it "a design-aid implementation" and whose solar, CLTD and duct tables carry TODOs to check against the book. `manualJ8` only shadow-runs. On the test house, legacy versus `manualJ8` through the adapter: heating +13.3% (Burlington), −2.5% (Phoenix), +48.2% (Atlanta); cooling +8.7%, +6.7%, +12.9%. The cutover gate is |drift| ≤ 5%. The adapter is itself lossy (it sends every ceiling as R-30 dark shingle regardless of input), so this is indicative, not a certified comparison.
Where: `ManualJCalculator.tsx:348`; `manualJ.ts:1-14,269-272,346`; `FE/engines/manualJ8/adapters/legacy.ts`.
Fix: this is the Phase 2 display flip. It needs the room form to collect what Form J1 needs (per-wall, per-orientation — see E12), not a better adapter.

**E10a · The engine stamp can name the wrong engine, and every legacy record is stored as "permit-grade"** — WRONG · S · [A]
If the L0 "Active Engine" preference is set to `manualJ8`, the PDF footer says `manualJ8-ts-1.3.0 (cert-grade)` while the numbers are still legacy. Records are graded permit-grade with no assumptions ledger despite E5–E9.
Where: `ManualJCalculator.tsx:596-598,376`; `FE/features/reports/combinedReportGenerator.ts:236-238`.
Fix: stamp from the engine that produced the result; cap legacy at budget grade.

**E11 · Results and PDFs go stale when inputs change after Calculate** — WRONG · S · [A]
Room edits clear the results; design-condition, duct-system and Res/Com edits do not. The PDF then prints old loads beside new conditions, and D, S and `/reports` read the stale stored result. Manual D (CFM/ESP setters) and Manual S (a PASS banner survives a capacity edit) have the same defect.
Where: `ManualJCalculator.tsx:1030,1055-1056` versus `:312-315`; `FE/pages/ManualDCalculator.tsx:531-534`; `FE/pages/ManualSCalculator.tsx:592-607,654-655`.
Fix: route every setter through one `invalidate()`; print from a snapshot stored with the result.

**E12 · The room model cannot describe a real room** — WRONG · M–L · [P][B]
Wall area is `exteriorWalls × length × height`, so the width is never used: a 20 × 10 room with one exterior wall on its short side is computed at 160 sq ft (true 80); four walls give 640 (true 480). One exposure applies to all of a room's glass. There are no door or skylight inputs.
Where: `manualJ.ts:594,703`.
Fix: per-wall rows (length, orientation, glass), which is also what `manualJ8` needs.

**E12a · Nothing is validated before it reaches a total** — WRONG · S · [P][B]
R-value 0 gives Infinity; a non-numeric length gives NaN tons; 9,999 sq ft of glass on a 20 × 15 room is accepted. Clearing a numeric field silently becomes 0. After clearing "Outdoor Heating" I could not type −7 — the field showed 0 — so a negative design temperature can only be entered by select-all and overtype.
Where: `ManualJCalculator.tsx:322-339,1405`.
Fix: string-backed numeric input with parse-on-blur and min/max; extend `validateInputs`.

**E12b · The room table does not foot** — WRONG (reviewer-facing) · S · [B]
Room rows summed to 33,685 Btu/h heating; the TOTAL row said 42,793. Ventilation, AED excursion and duct loss are in the total but not shown as rows. The PDF's per-room "Ventil." and "Duct" columns print 0 [A].
Where: `manualJ.ts:763,774`; `ManualJCalculator.tsx:780-784,892-893`.
Fix: add Ventilation / AED / Duct rows above TOTAL.

**E12c · Blower-door infiltration is applied to every room** — WRONG (latent) · S · [P]
With 1,500 CFM50 the engine assigns the whole-house 75 CFM to each of 12 rooms: 889 CFM, heating 103,570 Btu/h instead of about 36,000. No UI exposes the input today, but the PDF methodology text advertises the method.
Where: `manualJ.ts:657-663`; `ManualJCalculator.tsx:728,931`.
Fix: apportion by room volume before anyone wires the input.

### Manual D

**E14 · Ducts are sized on supply-branch length only** — WRONG · M–L · [B][C]
Friction rate = available static ÷ the longest supply branch TEL. There are no return runs, no trunk, and no register, grille or damper losses. The test house came out at 0.2162 in.wg/100 ft (typical design 0.06–0.10): 263 CFM in an 8 in round, 54 CFM in a 4 in. The engine then warns "Duct diameter is very small. Verify CFM requirement", pointing the user at their inputs. The system was reported "Balanced" with branch pressure drops from 0.05 to 0.17 in.wg.
Where: `FE/engines/manualD.ts:384,441,457-466`.
Fix: add return runs and device losses; TEL = longest supply + longest return.

**E14a · No trunk sizing, one run per room** — BLOCKS a buildable design · L · [B]
Output is one branch per room from the equipment. A contractor cannot size a trunk from it, and a 263 CFM kitchen is one outlet.
Where: `manualD.ts:86-96`.

**E14b · Velocity over the limit only warns** — WRONG vs `CLAUDE.md` rule 5 · S · [C]
`manualD.ts:551-556` pushes a warning; nothing upsizes. Branch velocities of 550–780 fpm also pass because the check uses the 900 fpm supply limit, not the 600 fpm branch limit defined in `FE/engines/ductSizing.ts:77-82`.

**E14c · Airflow is cooling-only, from a tonnage that always rounds up** — WRONG · M · [A]
Equipment CFM = `recommendedTons × 400`; rooms are split by cooling total including latent. In a heating-dominated climate a north bedroom can be about a third short of its heating airflow. `Math.ceil` to the next half ton turns 24,100 Btu/h into 2.5 tons (124% of load), above the 115% cap Manual S then applies. Manual S's selected equipment never feeds back.
Where: `FE/engines/manualJToManualD.ts:165,209`; `manualJ.ts:838`.

**E14d · A run with 0 CFM is sized as a 36 in duct; lengths are estimates shown as actual** — WRONG · S/M · [A]
`ductSizing.ts:485` returns −1 for zero flow, treated as "exceeds standard sizes" (`manualD.ts:507-509`). Imported lengths come from a CFM heuristic with no "estimated" flag, and re-import overwrites typed lengths.
Where: `manualJToManualD.ts:224`; `ManualDCalculator.tsx:231`.

### Manual S, AED and the combined report

**E13 · Manual S passes equipment it made up** — WRONG (document) · S · [B] ✓
"Import from Manual J" filled the loads and also filled the equipment capacities with load × 1.05 and heating × 1.10. "Check Equipment Selection" then showed "Within Manual S Limits" with no model and no AHRI reference, and offered Export PDF. Before importing, the page opens with placeholder loads (36,000 / 27,000 / 45,000) and placeholder equipment already filled, which also passes. The PDF heading is always "Design Loads (Manual J)".
Where: `ManualSCalculator.tsx:77-92,295-299,481`; `FE/engines/manualJToManualS.ts:58-84`.
Fix: start capacities empty; require a model or AHRI reference for a pass; print the load source.

**E15 · Two disagreeing AEDs, and the AED page says a penalty was added when it was not** — WRONG · M · [B][A]
Manual J computed AED (ratio 1.18) yet `/reports` listed AED as "Missing". The standalone AED page patches only the `aed` block of the stored result; its toast says the excursion was "added to cooling load". The AED engine uses one hand-rounded hourly table for about 40°N.
Where: `FE/pages/AedAnalysis.tsx:53-61,192`; `FE/engines/aed.ts:56-66`.
Fix: one AED source of truth — read-only from Manual J, or have AED trigger a recompute.

**E16 · Merely opening a calculator saves placeholders that downstream tools treat as real** — WRONG (document) · S · [A]
The mount effect fires auto-save, so `/reports` can list Manual D as "Available · 1 runs" and print the 5 °F / 95 °F defaults as "Design Conditions (ASHRAE — as used in Manual J)".
Where: `ManualJCalculator.tsx:119-133`; `ManualDCalculator.tsx:140`; `FE/pages/CombinedReportPage.tsx:86`.
Fix: save only after a user edit; require a calculated-at marker.

**E17 · The combined report stitches different generations together** — WRONG (document) · M · [A]
Manual J results come from the last Calculate, conditions from live inputs, and S and D are recomputed from inputs that may predate the current J run. No hash or timestamp links them. The PDF omits address, preparer, equipment model and AHRI reference, yet the page calls it "submission-ready".
Where: `CombinedReportPage.tsx:68,80,87,93-95,215`; `combinedReportGenerator.ts:600-606`.

**E18 · Commercial budget stamp follows a page toggle, not the project type** — WRONG (document) · S · [A]
A project created as Commercial opens Manual J as residential, prints no stamp and is stored permit-grade. Manual D's PDF has no stamp at all.
Where: `ManualJCalculator.tsx:99,963`; `ManualDCalculator.tsx:327-453`.

### Units and cross-project mix-ups

**E19 · In metric mode CAD opening fields are labelled cm but stored as inches** — WRONG · S · [A]
A 120 × 150 cm window is stored as 120 × 150 in: 125 sq ft instead of 19.4 (6.45×), and flows into Manual J. Scale calibration takes plain numbers as feet. The calculators ignore the units preference entirely, and the Settings defaults for ceiling height, wall R and window U are never read.
Where: `FE/features/cad/components/PropertyInspector.tsx:333,458-460`; `FE/features/cad/utils/underlayImport.ts:234-236`; `FE/pages/SettingsPage.tsx:282-284`.

**E20 · "Import from CAD" can import another project's rooms** — WRONG · M · [B][A]
The CAD store holds whichever drawing was last in memory and is boot-loaded from one user-wide key. Manual J, Manual D and AED read it without checking the project. See P1 for the browser reproduction of the same key leaking into draft mode.
Where: `ManualJCalculator.tsx:230-238`; `ManualDCalculator.tsx:211,246,457`; `AedAnalysis.tsx:97`; `useCadStore.ts:1379-1416`.

**E21 · The AED page overwrites another project's glass inputs on project switch** — WRONG · S · [A]
The auto-save effect is declared before the reload effect, so the first render with project B's id writes project A's groups under B's key.
Where: `AedAnalysis.tsx:167-181`.
Fix: skip the save when a `loadedForProjectId` ref differs from the active project; apply the same guard to J, D and S.

**E22 · Blueprint tracing: calibrating after tracing leaves the walls at the old scale** — WRONG · M · [A]
Calibration resizes only the sheet. A 40 ft wall traced before calibration can read 4.2 ft. The "ignore runs shorter than 1 ft" filter is applied in uncalibrated units and drops closets and most partitions.
Where: `FE/features/cad/components/BlueprintDialogs.tsx:202-208,314,371-377`.

**E23 · Editing several windows in a row writes the first one's size onto the others** — WRONG · S · [B][A]
Property panels seed local state once and are mounted without a `key`. In the browser, selecting a wall right after the canvas-settings panel showed "9 ft" under "Type" — the previous panel's ceiling-height value carried over.
Where: `PropertyInspector.tsx:207,441-442,574-575,1339`.
Fix: `key={entity.id}`.

**E24 · LET puts all sheets on one floor and classifies straight façades as interior walls; Manual J → CAD → Manual J shrinks glazing** — WRONG · M · [A]
`FE/engines/blueprintToCad.ts:492-498`; `FE/engines/orientation.ts:180-182`; `WK/routes/ai.ts:97`; `FE/engines/manualJToCad.ts:163-172` (60 sq ft across four windows becomes one 15.5 sq ft opening).

---

## 2. Connectivity and session — affects every user on every page

**X1 · Offline or on a weak signal, every failed request raises a toast** — SLOWS (BLOCKS on a phone) · M · [B]
Each page load fired five background requests (`/me`, transfers, access policy, notifications, notification preferences) and stacked five toasts — first "Connection issue, retrying…", then "Unable to reach the server". At 375 px wide the stack covered the top half of the screen for more than seven seconds; on desktop it covered Add Room, Reset, the fourth stat card and the CAD panels. There is no offline banner, no `navigator.onLine` check and no "silent" option for background polls.
Where: `FE/lib/api.ts:493-520`; `FE/App.tsx:146-150`.
Fix: a single persistent "Working offline" chip; background requests fail silently; user-initiated ones toast once.

**X2 · Every action waits about three seconds before falling back offline** — SLOWS · S · [B]
Retries sleep 1 s then 2 s. Creating a project showed "Syncing to cloud…" for several seconds before saving locally. `loadDrawing` also calls the API for local-only `proj-*` ids that can never exist server-side.
Where: `api.ts:257,514-518`; `FE/features/cad/hooks/useAutoSave.ts:118-131`.
Fix: skip retries when `navigator.onLine` is false; skip the API for local-only ids.

**X3 · A single 5xx on the 60-second heartbeat logs the user out** — BLOCKS mid-work · S · [A] ✓
Only the literal string "Unable to reach server" keeps the session; any other error clears it and the refresh token, with no toast.
Where: `FE/features/auth/store/useAuthStore.ts:821-824`.
Fix: clear only on a 401 after a rejected refresh.

**X4 · Deep links and the place you were are never restored after sign-in** — SLOWS · S–M · [A]
Route guards redirect to `/` and every post-auth path goes to `/dashboard`.
Where: `App.tsx:371-397`; `FE/pages/AuthPage.tsx:19-20`.

**X5 · The app is not usable offline beyond pages already visited** — BLOCKS in the field · M · [C]
The service worker is network-first with no precache, so a lazy route chunk never loaded online (say, Manual S) fails offline.
Where: `frontend/public/sw.js:18-48`.
Fix: precache the route chunks at install; cache-first for hashed assets.

**X6 · Signing out on one device ends every device's session** — SLOWS · M · [A]
Logout revokes all of the user's refresh tokens and can log a false token-reuse event.
Where: `WK/routes/auth.ts:1550-1552,1611-1634`.

**X7 · Timestamps display in the wrong timezone on permits, audit and community** — SLOWS, misleading in an audit · S · [A]
D1 `datetime('now')` strings (UTC, no zone) are passed straight to `new Date()`. AdminPage already has the correct helper.
Where: `FE/components/AuditLogView.tsx:426`; `FE/pages/PermitsPage.tsx:1023`; correct pattern at `FE/pages/AdminPage.tsx:1559`.

---

## 3. Project lifecycle and data persistence

**P1 · The CAD drawing is mirrored to one user-wide key, and "draft" resumes from it** — WRONG / data bleed · M · [B] ✓
After drawing in the Henderson project I opened `/cad` with no project. The project's walls and "Detected Rooms (2)" were already painted behind the gate dialog, and "Continue as Draft" asked "Continue your draft? You have an unsaved draft drawing" — offering the project's geometry. I had never drawn a draft. The real draft key (`hvac_cad_draft`) is written and never read.
Where: `useCadStore.ts:1379-1416`; `FE/pages/CadWorkspace.tsx:206-218,282`; `useAutoSave.ts:61,114-137`.
Fix: retire the global key or scope it to draft only; read `hvac_cad_draft`.

**P2 · On load the cloud copy always wins, even over newer local work** — BLOCKS (data loss) · M · [C][A] ✓
`loadDrawing` returns the D1 drawing whenever the API answers, with no timestamp comparison. A failed cloud save is marked saved and never retried, so offline edits are replaced by the older copy at the next online open. An offline load returns `id: null`, so the next save creates a second drawing row; a failed first save stores the fake id `'local'` and every later save 404s until reload.
Where: `useAutoSave.ts:98-107,114-137`; `FE/features/cad/components/TopNavigationBar.tsx:160`.
Fix: dirty-since-sync flag plus `updatedAt`; compare on load; retry on `online`; one drawing per project.

**P3 · Blueprint sheets live inside the drawing JSON, so saving fails silently** — BLOCKS (data loss) · M–L · [A]
Underlays are base64 data URLs up to 2,400 px, written to two localStorage keys with swallowed quota errors and sent whole to D1. A few sheets exceed the ~5 MB quota; the user is then told "Cloud sync failed. Your work is saved locally", which is no longer true.
Where: `useCadStore.ts:215,1413-1414`; `useAutoSave.ts:60-62,104-107`; `underlayImport.ts:29`.
Fix: keep rasters in R2 or IndexedDB and store a key; surface a real error on a failed local write.

**P4 · Two tabs or two users: last write wins silently** — BLOCKS (lower frequency) · M · [A]
`WK/routes/cad.ts:229-232` updates with no version precondition while each client PUTs its whole drawing every 3 s.

**P5 · Calculator cloud sync is write-only** — BLOCKS on a second device · M · [A] ✓
`listCalculations` and `getCalculation` have no callers. On another machine the project and drawing load, but Manual J / D / S / AED open with placeholders and `/reports` says no data. There is no retry for a calc run offline.
Where: `FE/lib/api.ts:618,629`; `FE/features/calculations/calcStorage.ts:13-16,70`.
Fix: on project activation, hydrate from the latest non-shadow row per calc type; add a sync chip.

**P6 · Results disappear on every navigation** — SLOWS · S · [B][A]
Reopening Manual D after a page load showed the duct rows but no results. Results are stored but never read back by the pages, so Export and Print vanish until Calculate is clicked again — and each click appends two D1 rows (legacy + shadow), both metered as calc runs.
Where: `ManualJCalculator.tsx:101,124,360,367,410`; `WK/routes/calculations.ts:115`.
Fix: rehydrate when the stored input hash matches; exclude shadow rows from metering.

**P7 · Manual D and Manual S do not pick up the project's Manual J** — SLOWS · S · [B]
With Manual J calculated, Manual D opened on "Room 1 / 100 CFM" and Manual S on placeholder loads. Both need a small "Import from Manual J" link. Manual J has no "Continue to Manual D" action.
Fix: auto-import on first open when J results exist, with a banner; add next-step buttons.

**P8 · Draft work can never be attached to a project; local-only projects strand calculator data when promoted** — BLOCKS · S–M · [A]
No code copies `*_draft` keys. Cloud migration re-keys only the CAD drawing.
Where: `FE/components/ProjectContextBar.tsx:41-48`; `FE/features/projects/projectStorage.ts:359-365`.

**P9 · Reset and Remove have no confirmation or undo; project delete is a hard cascade** — BLOCKS (data loss) · S / M · [A]
"Reset" sits beside "Calculate Loads" and wipes rooms, inputs and results at once. Project delete issues `DELETE FROM projects`, which by schema cascades to calculations, drawings and permit submissions; the active project is not cleared afterwards.
Where: `ManualJCalculator.tsx:454-461,1276,1518`; `WK/routes/projects.ts:156`.
Fix: confirm plus a 10-second Undo toast; soft-archive projects.

**P10 · New-project wizard: three steps, one of them empty** — SLOWS · S · [B]
Step 3 ("Engineering Scope") only displays text. Enter does not advance. No state or ZIP field. After creation the user lands in CAD, not in a calculator, and project tiles only open CAD. The modal has no `role="dialog"`, focus stays on the trigger, the label is not associated and the close button has no name.
Where: `NewProjectModal.tsx:43-146`; `FE/pages/Dashboard.tsx:617`.

**P11 · "Export to CAD" from Manual J is discarded when a project is active** — BLOCKS (feature) · S · [A]
Floors go into the in-memory store; opening the project's CAD resets geometry and loads the saved drawing.
Where: `ManualJCalculator.tsx:289-303`; `CadWorkspace.tsx:181-188`.

**P12 · Dashboard at 50+ projects** — SLOWS · M · [A]
Manual drag order only, no sort; search covers name, address and city; gate and Switch pickers are unsearched and read only the cached list.

---

## 4. Calculators — day-to-day friction

**C1 · Manual J: Calculate does not scroll to the results** — SLOWS · S · [B]
With 12 rooms the results are several screens below the button and the view stays put.

**C2 · Room cards are about 120 px tall and show only name and dimensions** — SLOWS · S · [B]
Twelve rooms fill four screens. A compact table (area, walls, glass, exposure) with expand-to-edit would fit on one.

**C3 · Enter in the ZIP field does nothing; unknown ZIP uses a native `alert()`** — SLOWS · S · [B]
Where: `ManualJCalculator.tsx:1030-1040`.

**C4 · "Import from CAD" replaces every room without asking** — SLOWS / data loss · M · [B][A]
It replaced my room list in one click. Re-detecting rooms in CAD issues new ids and "Room N" names, so hand-entered names, glazing and R-values are lost on each re-import, and every room is typed "custom".
Where: `ManualJCalculator.tsx:238`; `CadCanvas.tsx:1023-1024`.
Fix: merge on import by geometry match; allow renaming rooms in CAD.

**C5 · Heating is shown in tons; "Recommended 3 Ton" always rounds up** — COSMETIC · S · [B]
"Total Heating 42,793 BTU/hr · 3.57 tons". See E14c for the rounding.

**C6 · Each keystroke re-serialises all rooms and re-renders every card** — SLOWS at 40+ rooms · S · [A]
`ManualJCalculator.tsx:131-137,1254-1262`. Debounce the save and memoise the card. Renaming a room also clears the results.

**C7 · Manual D shows the J-versus-D duct-length reconcile banner immediately after import** — COSMETIC · S · [B]
"248 ft … Manual J documents 80 ft (210% drift)" appears for lengths the app itself just estimated.

**C8 · PDF output is inconsistent across tools** — SLOWS · M · [A], not opened
Only Manual J and the combined report honour page size, orientation, watermark, firm stamp and section toggles. D is fixed letter-landscape, S and AED letter-portrait, with no title block or page numbers; the AED file has no project name. Long room names overlap the next column. `Δ` and `−` are outside the PDF font's character set and may garble their lines (`ManualJCalculator.tsx:929`; `ManualSCalculator.tsx:497`) — confirm on an export.

**C9 · Print fails silently when the popup is blocked; D and S have no print** — SLOWS · S · [A]
`ManualJCalculator.tsx:471-472`.

**C10 · `/reports` works, with gaps** — [B]
The section list correctly showed three of four tools available with one-line summaries. See E15 and E17 for what it gets wrong.

---

## 5. CAD workspace

The basic draw-a-wall flow works and feels good: walls snap, close cleanly and autosave shows "Saved". The problems start at the second step.

**K1 · Selecting a wall shows a generic panel; wall properties cannot be edited** — BLOCKS · S · [B][A] ✓
After clicking a wall the Properties panel read "Object Selected · Type: line". R-value, thickness, length and "Delete Selected" never appear. The cause is a `get walls()` accessor on the store that Zustand flattens to `[]` on the first `set`. Walls can only be deleted with the keyboard.
Where: `useCadStore.ts:850-854` (and `pipes` at `:1033`); `PropertyInspector.tsx:39`; `FE/features/cad/components/WallLengthOverlay.tsx:41`.
Fix: select from `floors` / `activeFloorId`; delete the getters.

**K2 · Walls from tracing, LET and Manual J export have no canvas name: unselectable, undeletable, duplicated on every redraw** — BLOCKS, performance cliff · S–M · [A], consistent with [B]
Those paths set `fabricId: ''`; the canvas sweep skips unnamed objects, so each sync adds another copy. When I added about a hundred such walls through the store to time a large drawing, the tab stopped responding and had to be closed. I could not complete the large-drawing timing as a result.
Where: `FE/engines/pdfVector.ts:327`; `blueprintToCad.ts:458`; `manualJToCad.ts:130`; `CadCanvas.tsx:273,687-688`.
Fix: name objects `wall-${id}` everywhere; sweep by flag, not prefix.

**K3 · Finger touch cannot draw, the Pan tool corrupts the view, no pinch zoom** — BLOCKS on a tablet · M · [A]
The canvas is created without pointer events, every tool branch tests `evt.button === 0` (undefined on a touch event), and pan arithmetic becomes NaN. Not run on a device.
Where: `CadCanvas.tsx:1053-1061,1149,1177,1664`.
Fix: `enablePointerEvents: true`, pointer helpers, two-finger pinch/pan, on-screen Done / Delete / Undo / Fit.

**K4 · Naturally drawn plans do not form rooms** (known gap, root causes) — BLOCKS · M · [A]
The graph uses wall endpoints only, so a partition that tees into the middle of another wall dangles. Rooms with more than 20 corners are dropped. Endpoints 1 px apart across a lattice boundary do not merge. On a traced sheet the title block is the one clean rectangle, which is why it gets detected.
Where: `CadCanvas.tsx:914-916,930-938,956`.
Fix: split walls at intersections before building the graph; cluster by distance.

**K5 · Exact dimensions cannot be entered** — WRONG / SLOWS · M–L · [B][A]
Snap is whole feet only. No length is shown while drawing, there is no typed length, no endpoint or ortho snap, and walls cannot be moved or stretched. A 12′-6″ × 10′-4″ room becomes 12 × 10 (−7%).
Where: `CadCanvas.tsx:205-206,276-277`.

**K6 · Detect Rooms and Add Window need undocumented extra clicks** — SLOWS · S · [B]
Clicking Detect Rooms does nothing until the canvas is clicked; no hint says so. Add Window places one window and reverts to Select, so 25 windows means re-selecting the tool 25 times.
Where: `CadCanvas.tsx:1638-1639`.
Fix: run detection on tool click; keep placement tools armed until Esc.

**K7 · The header overlaps the toolbox** — COSMETIC · S · [B]
At 1024 and 1440 px the project title is clipped ("erson Residence 2400") and the back-to-dashboard link sits under the toolbox.

**K8 · Dragging a window, register, fitting or label snaps back** — SLOWS · S–M · [A]
Only underlays write their position back (`CadCanvas.tsx:1863-1865`).

**K9 · Controls that do nothing** — SLOWS · S each · [A]
Ctrl+S and Ctrl+E look for `aria-label`s that do not exist (`CadCanvas.tsx:1998,2005`). "Auto-Calculate Load" has no handler (`TopNavigationBar.tsx:352`). Asset Library "Place on Canvas" ignores the chosen asset. The HVAC tool only places a supply register. The Dimension line vanishes on the next sync. Floor "Lock" is read nowhere. Placed fittings never reach Manual D.

**K10 · Shortcuts fire inside dropdowns; saved zoom is not restored; no zoom-to-fit** — SLOWS · S · [A]
`CadCanvas.tsx:1891` excludes only inputs and textareas, so typing "r" in a select arms Detect Rooms.

**K11 · Bulk imports erase undo; floor delete is one unconfirmed click** — BLOCKS recovery · M · [A]
`BlueprintDialogs.tsx:362-364,775-777`; `useCadStore.ts:822-836`.

**K12 · Multi-sheet plan sets: trace always uses the last sheet, LET the first six, PDF import is one page per import** — SLOWS / BLOCKS · M · [A]
`FE/features/cad/components/Toolbox.tsx:204,222`; `underlayImport.ts:100-105`.

**K13 · Version history keeps a full snapshot every 3 s and the UI reaches only the last 100** — SLOWS, storage cost · M · [A]
About 5–10 minutes of history is reachable. `WK/routes/cad.ts:241-250`; `api.ts:752`.

**K14 · CAD PDF export drops schedule rows past one page; the plot is a viewport screenshot** — BLOCKS a permit schedule · M · [A]
`FE/features/cad/utils/pdfGenerator.ts:81,121-136,767-772`.

**K15 · Every action rebuilds the whole canvas two or three times** — SLOWS · M · [A]
Each sync removes and recreates every object and re-decodes each underlay image; the dot grid draws up to ~130,000 arcs per frame at minimum zoom; any zoom change triggers a full JSON serialise of the drawing; the vector-trace preview is O(n²) per slider tick.
Where: `CadCanvas.tsx:686-748,1073-1085,2022-2034`; `useCadStore.ts:1407`; `BlueprintDialogs.tsx:331-346`.
Fix: diff by id, sync once per action, cache decoded images, cap grid density.

**K16 · 3D viewer** — SLOWS / COSMETIC · M · [A], not opened
One mesh per wall with an unconditional render loop; walls are not cut for openings; STL export includes the 500 × 500 ground plane. `FE/features/cad/components/Viewer3D.tsx:220-239,694-704,723-728`.

**K17 · LiDAR ingest (PR #42 branch), before it merges** — BLOCKS the field flow · M · [A]
Scan walls inherit K1 and K2. Every import lands at the same origin, so room-by-room captures stack. Multi-storey captures keep one storey. It is, however, the only intake path that feeds Manual J correctly: scan rooms carry real wall ids and typed openings.

### Known gaps, confirmed

| Gap | Status |
|---|---|
| Radiant / PEX tool is dead scaffold | Still true. `addRadiantZone` has no callers; no toolbox entry or renderer. The "Radiant Systems" layer still shows. |
| Traced walls cannot form rooms; Detect Rooms returns the title block | Still true, and it applies to hand-drawn plans too (K4, E2). |
| Tracing and LET create no typed openings | Still true. LET zeroes glazing rather than inventing it, which is the right call but leaves Manual J with no glass. |
| One global underlay scale | Partly stale. Calibration is already per sheet (it resizes that sheet); `pxPerFt` is a constant 40. The real defect is E22. |
| gbXML / HPXML import-export | Not implemented. No file in the repo mentions either. |

---

## 6. Sign-in and onboarding — code-traced, except where marked

**A1 · Every account owner is forced into authenticator setup** — BLOCKS · M · [A] ✓
MFA is required for `role === 'admin'`, and every self-registered or new SSO user is the admin of their own org. Verify-email and invite redemption mint a session without the gate, so the wall first appears on the second sign-in, with no skip and no explanation of what an authenticator app is. `CLAUDE.md` says MFA is optional outside Enterprise.
Where: `WK/routes/auth.ts:62-64,203-204,353-371,897-902`; `FE/pages/MfaEnrollPage.tsx:151`.
Fix: scope to multi-user orgs / Enterprise / L0, or add a grace period with "set up later"; add a short explainer.

**A2 · Forced enrollment never shows the backup codes** — SLOWS (functional bug) · S · [A] ✓ code, reproduced by the sub-audit in a jsdom replica
The store clears the enroll token before the page reaches its backup-codes stage, so the guard navigates away. Ten codes exist that the user never saw.
Where: `MfaEnrollPage.tsx:29-33,61-65`; `useAuthStore.ts:476-491`.

**A3 · Registration dead-ends on a blank organisation name** — BLOCKS · S · [B] ✓
Step 3 let me continue with Organisation Name empty; on step 4 "Create Account" is disabled when it is blank, with no message. The server would have accepted it.
Where: `FE/pages/OnboardingPage.tsx:642,651`; `auth.ts:199`.

**A4 · Leaving the verify-email screen loses the flow; signing back in kills the code already in the inbox** — BLOCKS on mobile · S–M · [A] ✓
`pendingEmail` is memory-only. `FE/pages/VerifyEmailPage.tsx:21-23`; `auth.ts:312-317`; `WK/utils/verificationCodes.ts:49-55`.

**A5 · Login lockout survives a successful password reset** — BLOCKS up to 15 min · S · [A]
`auth.ts:248-253,559-566`.

**A6 · Verification, reset and MFA emails are fire-and-forget** — BLOCKS when it happens · S–M · [A]
The UI says "We sent a code" even if the provider rejected it. `auth.ts:220,317,491,523,2041`.

**A7 · Ordinary input rejected with vague errors** — SLOWS · S · [B][A]
The email field is `type="text"` with no autocomplete (confirmed in the DOM); a trailing space returns "Invalid email format"; a single-word name returns "Missing required fields".
Where: `auth.ts:150-151,168`; `OnboardingPage.tsx:352-353,531-537`.

**A8 · "Email already registered" offers no way forward** — SLOWS · S · [A]
No sign-in or reset link after four wizard steps. `auth.ts:183-185`.

**A9 · An invited person who self-registers strands the invite** — SLOWS / BLOCKS joining · M · [A]
Registration never checks for a pending invite; the admin's 409 does not mention Transfers. `auth.ts:182-186,1200-1204`; `WK/routes/org.ts:608-610`.

**A10 · MFA challenge, enrollment and SSO confirm lose state on reload** — SLOWS · M · [A]
Each enroll visit issues a new secret, leaving dead entries in the authenticator app; the enroll token lasts 10 minutes. `FE/pages/MfaChallengePage.tsx:27-29`; `auth.ts:51,2070-2075`.

**A11 · Forgot-password always says "Code sent"; rate-limit messages omit the wait; verify and reset share one limiter bucket** — SLOWS · S · [A]
`FE/pages/ForgotPasswordPage.tsx:58-63,181-183`; `auth.ts:411,477,544,1956`.

**A12 · No in-app password change** — SLOWS · M · [B][A]
Settings search for "password" returned "No settings match". The only route is sign out → Forgot password, which ends every session.

**A13 · SSO rough edges** — SLOWS / COSMETIC · S–M · [A]
"Enterprise SSO" is shown to every tenant but points at C4's own Cloudflare Access; the Cloudflare path says "Completing Microsoft authentication…"; cancelling shows the raw provider error; a new SSO user gets no choice of org type. `AuthPage.tsx:172-182`; `FE/pages/AuthCallbackPage.tsx:30,171`.

**A14 · Wizard leftovers and jargon** — COSMETIC · S · [B][A]
Headings read "Account Configuration", "Regional Compliance", "Technical Headquarters", with a "Next Component" button. Step 5 can never appear; phone and suite are collected and never sent. The app sidebar renders beside `/onboarding` when a session exists (confirmed). The wizard is not a `<form>`, so Enter does nothing.

**A15 · Backup codes must be typed with the exact hyphen; no resend on the email-code method** — SLOWS (rare) · S · [A]
`MfaChallengePage.tsx:43`; `auth.ts:1742`.

**Doc correction:** password minimum is 8 characters on client, server and in the copy. Only `CLAUDE.md` says 12.

---

## 7. Permits — code-traced

**R1 · A reviewer cannot actually review a submission** — BLOCKS · M / L · [A] ✓
The detail page shows calc type, version, engine version and date. No loads, no room schedule, no drawing, no PDF, and no link to any of them. The server already returns full calc `outputs`; the page discards them. No drawing is fetched.
Where: `PermitsPage.tsx:1466-1468`; `WK/routes/permits.ts:317-321`.
Fix: render a load summary from `outputs` (M); add a party-gated drawing endpoint and reuse the read-only CAD viewer (L); let the submitter attach the report PDF (L).

**R2 · "Changes requested" → resubmit is a dead end** — BLOCKS · M · [A] ✓
The UI offers "Resubmit with changes", but the parent is still open so the duplicate check returns 409; the only submitter action the server accepts is withdraw. The workaround is Withdraw, then Resubmit.
Where: `PermitsPage.tsx:1397`; `permits.ts:204-205,419-420`.
Fix: a submitter `respond` transition (`changes_requested → submitted`).

**R3 · The authority is never told a submission arrived; comments notify no one** — BLOCKS the loop · S · [A]
`/submit` writes the row and an audit entry and emits nothing. `authority_intake_email` is collected and never used. The comment route only audits.
Where: `permits.ts:214-252,739-765`.

**R4 · Decision notifications are anonymous, link to the list, and are in-app only** — SLOWS · S / M · [A]
No project name in the title; `href: '/permits'`; no email on approve, deny, suspend or revoke. `permits.ts:110,602`.

**R5 · Expiration is wrong in three ways and cannot be cleared** — WRONG legal state · S each · [A] ✓ (sweep query)
The `datetime-local` value is parsed as UTC, so 5 PM Eastern reads back as noon. The sweep compares ISO `…T…Z` strings to `datetime('now')`, so a permit does not expire until the next UTC midnight. Neither party is notified. Save is disabled when the field is empty; the help text says to clear it "via API".
Where: `PermitsPage.tsx:839,1370,1377`; `permits.ts:405,409`; `WK/index.ts:159-160`.

**R6 · An authority org with no flagged reviewer is a black hole** — BLOCKS · S · [A]
It appears in search and accepts submissions that nobody can see. The authority toggle bypasses the sole-authority guard. `permits.ts:166-167`; `org.ts:172-174`.

**R7 · The queue truncates at 200, newest first, with no owner or age** — SLOWS at 30, BLOCKS past 200 · M · [A] ✓
`permits.ts:294-295`. A review queue wants oldest first, with "waiting N days" and reviewer name on the card.

**R8 · A submission is a live pointer, not a snapshot** — BLOCKS trust in an approval · M · [A] ✓
No calc ids or versions are pinned; the approved record silently changes when the contractor recalculates. Every open also loads every version of every calc with full outputs.
Where: `permits.ts:216-219,319-321`.

**R9 · Claiming is invisible and one-shot; no "next" in the review loop** — SLOWS, 30× a day · S–M · [A]
`PermitsPage.tsx:1115-1119,1246`.

**R10 · Submit and Share entry points are hidden; no completeness check** — SLOWS · S · [B][A]
The shield and globe on project tiles are 26 × 26 px and invisible until hover (measured). `/permits` has no "New submission" button. A project with zero calcs can be submitted. Authority matching is exact-string.
Where: `Dashboard.tsx:584`; `permits.ts:159-162,838`.

**R11 · Withdraw and Revoke are one click; errors render off-screen; jargon in copy** — COSMETIC → SLOWS · S · [A]
"No calculations have been persisted to D1 yet", "Project payload (full visibility)", "…via API". `PermitsPage.tsx:867-870,1349,1377,1441,1461`.

---

## 8. Team, notifications, audit, community, admin — code-traced

**T1 · Inviting five techs is five slow round-trips with no resend** — SLOWS · S / M · [A]
The email is cleared before the request resolves; no Enter-to-send; no resend; expired invites vanish. `FE/pages/TeamPage.tsx:950-951`; `org.ts:454-455`.

**T2 · "Search team…" does not search people** — SLOWS at 30+ members · S · [A]
It matches category titles only. The members table has no filter, and "Loading…" shows forever if the fetch fails. `TeamPage.tsx:417,1147-1148`.

**T3 · Role-change preflight gaps; "handoff" has no mechanism** — SLOWS · S / M · [A]
Demoting an engineer with open submissions passes silently; nothing can reassign a project; a failed commit's inline error is erased by the refresh that follows. `WK/utils/roleChange.ts:110`; `TeamPage.tsx:131-141`.

**T4 · People affected by team actions are not told** — SLOWS · S / M · [A]
No email on deactivation; the requesting admin hears nothing on transfer accept or decline. `org.ts:1150-1171`; `auth.ts:1514-1515`.

**T5 · Three of six notification kinds never fire** — BLOCKS "answer comments" · S · [A]
Settings advertises Community, Calculations and System notifications; only permit, team and security have emitters. A community sharer never learns anyone commented. `WK/routes/forum.ts:185-207`; `FE/stores/useNotificationStore.ts:83`.

**T6 · Saving the notification policy after a failed load overwrites it with defaults** — data-loss risk · S · [A]
`SettingsPage.tsx:2158-2170`.

**T7 · The audit log cannot answer "who changed this project last Tuesday?"** — SLOWS, BLOCKS at volume · S / M · [A]
No date, member or project filter in the UI though the server supports them; search covers only loaded rows; the per-project modal filters `entity_type='project'` and so misses calc saves, CAD saves and permit actions; "Clear" drops the project scope. Actions render as raw codes (`permit.request_changes`) and every notification click adds a row.
Where: `FE/components/EntityAuditModal.tsx:93`; `AuditLogView.tsx:86-89,168,259`.
Fix: pass `{ projectId }`; add date range and member filters; a default "hide housekeeping" view filter (display only — keep writing the rows).

**T8 · L0 org drawer: authority toggle broken, deactivation looks like nothing happened, blocked role change still a raw 409** — BLOCKS two L0 actions · S / M · [A] ✓
The org-detail query does not select `is_permit_authority` or `status`, so the button always reads Off and every click sends true. The `CLAUDE.md` fast-follow (no checklist UI on the L0 drawer) is still pending.
Where: `WK/routes/platform.ts:76-77`; `AdminPage.tsx:1373,1445`; `api.ts:485`.

**T9 · L0 feedback triage: no paging, no reply, heavy refresh; audit tab loses filters on auto-refresh** — SLOWS · S / M · [A]
`AdminPage.tsx:41,1481,1632-1633`.

**T10 · Community helpers see only a paragraph; notification panel rough edges** — SLOWS / COSMETIC · S–M · [A]
No load numbers on shared projects; "Clear all" deletes the inbox with no confirm; row actions are hover-only. `forum.ts:138-139`; `FE/components/NotificationCenter.tsx:314,353`.

---

## 9. Settings, search, themes, mobile, accessibility

**U1 · Cmd+K returns supply houses for almost any query, and Enter opens Google Maps** — BLOCKS the feature · S · [B] ✓
Typing "hend" (the project is "Henderson Residence 2400") listed supply houses headed by Howland Pump & Supply, with no project in view. Typing "manual s" did the same, and Enter tried to open a Google directions tab instead of Manual S. Retailers are matched by subsequence against a long string that ends in "hvac supply store", preferred retailers are sorted above everything, and the list is capped at 20.
Where: `FE/features/spotlight/SpotlightSearch.tsx:124-135,188-198,368-371,378`.
Fix: substring match for retailers; rank by score first; show retailers only for store-like queries.

**U2 · The Light theme is unusable on the calculators and onboarding** — BLOCKS for light-theme users · M · [B]
On Manual D in Light the page title measured 1.0 : 1 contrast (white on white), form labels 2.1 : 1, the selected "Round" button 1.3 : 1, and the cards stayed dark. On `/onboarding` the heading, card labels and Next button were invisible. Settings itself renders correctly.
Fix: replace hard-coded `text-white` / `bg-slate-9xx` on those pages with theme tokens.

**U3 · Touch targets are mostly under 44 px** — SLOWS on tablet/phone · M · [B]
Measured at 375 px: Dashboard 15 of 23 interactive elements under 44 px (tile actions 24–30 px), Manual J 37 of 65. Desktop examples: "Sync to CAD" 101 × 20, "Import from CAD" 151 × 28, "Switch" 46 × 15, CAD tool buttons 41 × 41. `CLAUDE.md` §4.6 requires 44 × 44 on all of them.

**U4 · Form inputs have no programmatic labels; several buttons have no name** — accessibility · M · [B]
Manual J: 18 of 18 design-condition inputs are not associated with their labels. Dashboard: 7 unnamed buttons. Number fields set no `inputmode`. Modals lack `role="dialog"` and a focus trap.
Where: `FE/features/auth/components/SecurityComponents.tsx:13,25-28`; `ManualJCalculator.tsx:1405`.

**U5 · Phone layout: floating Mason orb and Search button sit over form fields** — SLOWS · S · [B]
At 375 px both float over the right edge of the inputs. No horizontal scrolling at 375 or 768 px, which is good. At 768 px the sidebar takes 224 px and leaves 544 for content.

**U6 · CAD toolbox is icon-only** — SLOWS on touch · S · [B]
Names appear only in hover tooltips.

**U7 · Settings search works; dead settings do not** — [B][A]
Search for "metric" and "theme" jumped to the right category. But Default Ceiling Height / Wall R / Window U are never read, the unit system does not reach the calculators (E19), and Settings claims the engine preference "flips to cert-grade results on the next calc" when it only changes the stamp (E10a).

**Mason** was not exercised (needs the API). Its 34 KB gzip chunk loads on every page — see F2.

---

## 10. Performance

**F1 · Every authenticated API call pays a CORS preflight** — SLOWS everyone · S · [C][B]
The Worker's `cors()` sets no `maxAge`, so browsers cache the preflight for about five seconds. The network log showed an OPTIONS before nearly every request, doubling round-trips.
Where: `WK/index.ts:52-57`.
Fix: `maxAge: 7200`.

**F2 · Bundle** — [B] measured from `npm run build`

| Chunk | gzip |
|---|---|
| All JS chunks | 1,063 KB (target 660) |
| Entry `index` | 116 KB |
| CSS | 20 KB |
| Mason (loaded on every page) | 34 KB |
| Viewer3D (three.js) | 186 KB |
| pdf.js + worker | 122 KB + 363 KB |
| jsPDF / html2canvas | 108 KB / 45 KB |
| Fabric | 89 KB |
| CadWorkspace | 66 KB |
| ManualJCalculator | 30 KB |

First load is healthy. Cheap wins: defer Mason until the orb is opened; compress the PNGs (`icon-512` 336 KB, `cad-portal-blackhole` 137 KB, `new-project-plaque` 132 KB, `hvac-emblem` 113 KB — the emblem is in the sidebar on first paint); decide whether 660 KB means first route or the whole app and write that down.

**F3 · Duplicate and wasted requests on load** — SLOWS · S · [B]
`/api/projects` and `/api/auth/transfers` were each requested twice at load and access-policy several times. Part of that is React StrictMode in dev; verify against a production build before acting.

**F4 · CAD rendering** — see K2 and K15. I could not finish the large-drawing timing because the tab hung (K2).

**F5 · Shadow-run doubles calc writes and the usage meter** — see P6.

---

## 11. Proposed order of work

Ordered by "wrong numbers on a document first, then lost work, then the friction everyone hits daily". Sizes are rough.

**Wave 0 — stop wrong documents (mostly S, about a week)**
E1, E2, E3 (Detect Rooms: wall ids, duplicates, true coordinates) · E13 (Manual S invented equipment) · E11 (stale results) · E12a (numeric input and validation) · E10a (engine stamp, grade) · E16 (placeholders saved on open) · E21 (AED overwrite) · E23 (stale property panel) · E12b (table foots) · E4a (five-digit ZIP) · E6 (no duct default) · E18 (commercial stamp).
In parallel, a non-code task: **E4** — someone with the Manual J book checks 20 stations against Table 1A. If the table is the wrong column, re-keying it is the single largest accuracy change in the product.

**Wave 1 — stop losing work (M each)**
P1 (global CAD key) · P2 (cloud-always-wins, fake drawing id) · P3 (rasters out of the JSON) · X3 (logout on 5xx) · P9 (confirm Reset, archive instead of delete) · P5 (read calcs back from the cloud) · P8 (draft and local-project promotion).

**Wave 2 — daily friction for everyone (S–M)**
X1, X2 (offline chip, silent background failures) · F1 (preflight cache) · U1 (Cmd+K) · P6, P7 (results persist; auto-import J → D → S) · P10, E4b (ZIP at project creation, saved location) · A1, A2, A3, A4 (the four sign-up blockers) · X4 (return to where you were).

**Wave 3 — make the permit loop work (M)**
R1 (reviewer sees loads) · R2 (respond transition) · R3, R4 (notifications and email) · R5 (expiry) · R6, R7, R8.

**Wave 4 — CAD usable for a real plan (M–L)**
K1, K2 (wall panel, object naming) · K4 (T-junctions) · K5 (typed dimensions) · K6 · K3 (touch) · K15 (sync cost) · E22 (calibrate before trace) · E3a, E3b (bridge carries per-wall data).

**Wave 5 — the model changes (L)**
E12 (per-wall room model) → E10 (display flip to `manualJ8`) · E5, E7, E8, E9 (explicit ventilation, ceiling, slab and occupant inputs) · E14, E14a (Manual D return path and trunks) · U2, U3, U4 (light theme, touch targets, labels) · X5 (offline precache).

Decisions needed from you before some of these start:
- **MFA policy (A1):** who must enroll, and is there a grace period?
- **Legacy engine (E10):** keep patching it, or put the effort into the room-model change that lets `manualJ8` take over?
- **Bundle target (F2):** first route or whole app?

---

## Appendix — what works well

- **Project isolation of calculator data.** Every calculator key is `{userId}__hvac_{tool}_{inputs|results}_{projectId|draft}`; the gate dialog and context bar are on all six workspaces. (The CAD mirror key in P1 is the exception.)
- **ZIP miss is explicit** — no silent fallback city.
- **The legacy engine keeps full precision** and rounds only at display; Calculate has a non-finite backstop before persisting.
- **Manual S applies the 115% cap** (125% heat pump with a warning). jsPDF is lazy-loaded.
- **Silent token refresh** is deduplicated, serialised across tabs and keeps the session through transient failures.
- **Invite edge cases** (wrong account, expired, revoked, double-redeem) each have distinct handling; the admin is told whether the email actually sent.
- **Permit state machine** is strict server-side, with reasons required and a readable transition timeline.
- **Role-change preflight** is authoritative on the server and friction-free when clean.
- **LET discipline:** mandatory review, glazing zeroed rather than invented, no auto-retry of expensive calls.
- **CAD undo** is cheap and covers every entity type; the vector extraction engine refuses over-dense sheets rather than tracing half.
- **Settings search and the J-versus-D duct reconcile banner** are the right patterns; several fixes above amount to applying them elsewhere.
- **No horizontal scrolling** at 375 px or 768 px on the pages measured.

Security-relevant observations made during this pass are recorded separately, outside the repository.

# LET Plan-Set Intelligence — Spec

> Status: **proposed** (2026-07-21). Evolves the Logarithmic Extraction Tool
> (LET) from "hand it one floor-plan page and confirm rooms" into "drop the whole
> plan set and let the engine triage, scale, and reconstruct it" — while every
> AI-derived value stays a **sourced, confidence-tagged proposal a human confirms**
> before it becomes calc input. The learning curve drops; the rigor goes *up*,
> because more inputs become read-and-confirmed instead of typed.

---

## 1. Why

Today the workflow makes the *user* curate the input:

- `PdfPagePicker` ([BlueprintDialogs.tsx](../frontend/src/features/cad/components/BlueprintDialogs.tsx)) pauses a multi-page PDF and asks which page to import.
- `POST /api/ai/blueprint-extract` ([ai.ts](../workers/src/routes/ai.ts)) then treats **whatever it's handed as a floor plan** and merges rooms across up to 6 sheets. Feed it an elevation and it will try to read rooms off an elevation.
- Scale is a **manual** step: the model returns a `scaleNote` string, but nothing consumes it — the user calibrates by clicking two points in `CalibrateScale`.
- Glazing is **honest-zeroed**: on confirm, extraction rooms are built with `windowSqFt: 0` (the 2026-07-20 AED-correctness fix) because windows aren't dimensioned/typed from the plan. The engineer re-enters every window by hand.
- Openings are never emitted as objects — the same **typed-openings gap** already logged for both the vision and vector-trace paths.

The reframe: **you dump the entire set, the engine triages it.** Architects already declare everything we need in writing — sheet numbers, sheet titles, scale bars, and window/door schedules. Reading those is what turns LET from a room-outliner into a takeoff engine.

## 2. Goals / Non-goals

**Goals**
- Accept a whole plan set (multi-page PDF or many images); auto-classify each sheet.
- Auto-route floor plans to extraction; auto-find the legend and the schedules.
- Auto-calibrate scale when independent witnesses agree; else ask (never guess).
- Populate glazing and doors from the **window/door schedule** (U-value, SHGC, size, orientation), closing the honest-zero gap.
- Emit **typed opening objects** (windows/doors) hosted on the traced walls → a measurement-true, editable 2D twin with correct orientation.
- Attach **provenance + confidence** to every value; the reviewer's eye lands on the low-confidence, vision-estimated items.

**Non-goals (this effort)**
- A pixel-perfect architectural clone. We reconstruct the **thermal envelope + rooms + openings + orientation** exactly and render fixtures/casework as **annotations, not load-bearing truth**. (Chasing "identical" invites over-trust on a permit document and AI vision will occasionally be wrong.)
- Removing the human. Every stage proposes; a licensed reviewer confirms. Same contract as today's `AiExtract` review, extended earlier and deeper.
- Commercial load calc. Commercial/assembly sets still route to budget-estimate until Manual N.
- Perfect OCR of handwritten markups / angled phone photos — that's the hard tail (see §9).

## 3. Principles (the through-line)

1. **Provenance on every value.** `vector-exact | schedule-declared | vision-estimated | user-entered`, each carrying `high|medium|low` confidence. The extraction schema already carries per-room `confidence` — we generalize it to a `source` + `confidence` pair on rooms *and* openings.
2. **Vector-first, vision-second.** When the PDF page carries real CAD geometry, use `traceUnderlayVectors` ([vectorTrace.ts](../frontend/src/features/cad/utils/vectorTrace.ts)) → exact. Fall back to the vision extractor for scans/photos → approximate + confirm. The classifier reports *which* it's holding (`isVector`).
3. **No silent defaults (ACCA).** Auto-apply only what two independent witnesses agree on; everything else is surfaced for a decision. This is the existing "everything is a PROPOSAL a human confirms" rule from `ai.ts`, made structural.
4. **Server-side AI, pure engines.** All model calls stay in `workers/src/routes/ai.ts`. Geometry/scale/opening math stays in **pure** `engines/*` (mirrors `blueprintToCad.ts`, `pdfVector.ts`) — portable, testable, no I/O.

## 4. The pipeline

```
Ingest whole set (PDF pages / images)
      │
      ▼
[S1] TRIAGE / CLASSIFY  ── low-res vision pass ──▶ per-sheet {sheetType, sheetNumber,
      │                                            sheetTitle, floorLevel, isVector, conf}
      │   route: floor plans → extraction · schedules → parser · legend → symbol map
      ▼
[S2] GEOMETRY  (per floor-plan sheet)
      │   vector page → traceUnderlayVectors (exact)   |   raster → vision polygons
      ▼
[S3] SCALE RECONCILE ── scale-bar ▷ dimension ▷ stated ── agree? auto-calibrate : ask
      ▼
[S4] SCHEDULE PARSE ── window/door schedule table → tagged openings (size, U, SHGC)
      ▼
[S5] OPENING PLACEMENT ── detect door/window symbols + host wall → match tags → typed Openings
      ▼
REVIEW & CONFIRM (ghost-preview on canvas, low-confidence flagged) ─▶ commit to CAD + Manual J
```

Every box is additive to today's flow: S2/review already exist; S1, S3, S4, S5 are the new intelligence, each independently shippable.

## 5. Stage 1 — Sheet triage / classifier

New cheap endpoint `POST /api/ai/plan-triage` (low-res rasters, one vision call for the set). It classifies; it does **not** extract geometry.

```ts
type SheetType =
  | 'floor_plan' | 'foundation_plan' | 'roof_plan' | 'reflected_ceiling'
  | 'elevation' | 'section' | 'site_plan' | 'detail'
  | 'window_door_schedule' | 'legend' | 'title_sheet'
  | 'mep' | 'structural' | 'schedule_other' | 'unknown';

interface SheetClassification {
  imageIndex: number;        // 0-based, matches the extraction endpoint's imageIndex
  sheetType: SheetType;
  sheetNumber?: string;      // "A-101" read from the title block
  sheetTitle?: string;       // "FIRST FLOOR PLAN"
  floorLevel?: string;       // 'basement'|'first'|'second'|... when the title says so
  isVector: boolean;         // page carried extractable PDF vector geometry
  confidence: 'high' | 'medium' | 'low';
}
```

Why this is reliable: sheet numbering is a rigid convention (`A-1xx`=plans, `A-2xx`=elevations, `S/M/E/P`=trades) and titles are printed in the title block. Reading them is squarely in Claude vision's wheelhouse.

**UX:** the picker becomes a **result you confirm**, not a choice you make — *"Found 2 floor plans (A-101 First, A-102 Second) + 1 window schedule + 1 legend; skipped 4 elevations, 1 site."* One-click reassign per sheet. `PdfPagePicker`'s "pick a page" step retires for plan sets (kept only as a manual fallback). Toolbox's `handleAiExtract` stops sending "the first 6 underlays" and instead sends the **classified floor plans**.

**Acceptance:** a mixed set classifies floor plans vs. non-plans ≥90% on the test corpus; misclassifications are one click to fix; nothing is auto-committed.

## 6. Stage 2 — Scale reconciliation

The model reports scale **witnesses**, ranked by trustworthiness:

| Witness | What it is | Why it ranks where it does |
|---|---|---|
| `scale_bar` | the graphic ruler drawn on the sheet, measured in px | **Gold** — scales *with* the drawing even on a reduced/fit-to-page print |
| `dimension` | a printed dim string matched to its geometry span | Strong — reuses the "prefer printed dimensions" rule already in the extractor |
| `stated` | "1/4in = 1ft" title-block note | **Unreliable alone** — a letter-size print of a D-size sheet silently breaks it |

**Rule:** auto-calibrate iff **≥2 witnesses agree within ~2%**. Otherwise present the candidates in `CalibrateScale` and let the reviewer confirm or click two points (today's flow, now pre-seeded). Feeds the existing `impliesRescale` path in [blueprintToCad.ts](../frontend/src/engines/blueprintToCad.ts). This is the concrete fix for the still-open *per-sheet scale* item.

**Acceptance:** on to-scale vector PDFs, auto-calibration lands within 2% of a hand calibration with no user input; on ambiguous/reduced prints it declines and asks rather than guessing.

## 7. Stage 3 — Schedule parsing (the biggest correctness win)

The **window/door schedule** is a table that declares each tagged opening. Parse it into:

```ts
interface ScheduledOpening {
  tag: string;                 // "W1", "D3"
  kind: 'window' | 'door';
  widthFt: number;
  heightFt: number;
  glazing?: { uValue?: number; shgc?: number; operable?: string };  // windows
  material?: string;           // doors: solid/glazed/etc.
  source: 'schedule';
  confidence: 'high' | 'medium' | 'low';
}
```

This is what lets us replace the `windowSqFt: 0` honest-zero (set in `AiExtract`'s confirm handler) with **real per-room glazing** — size, U-value, SHGC, count, orientation. It's the single most tedious Manual J input to hand-enter, and the one that makes **AED / Section N** (glazing diversity) actually meaningful instead of a placeholder profile.

**Acceptance:** a schedule sheet yields tagged openings whose totals match the sheet; values flow to `RoomInput` glazing and the AED profile; anything unmatched stays flagged, never invented.

## 8. Stage 4 — Typed opening placement (the true-2D twin)

On the floor plan, doors and windows are drawn as recognizable symbols (door = leaf + swing arc; window = wall-break + glazing lines). Detect them + their host wall, then match to the schedule tag from §7:

```ts
interface PlacedOpening {
  kind: 'window' | 'door';
  tag?: string;                // matched schedule tag, if any
  hostWallId: string;          // the wall it sits in (from the traced geometry)
  positionAlongWall: number;   // 0..1 along the wall
  widthFt: number;
  orientation?: 'N'|'NE'|'E'|'SE'|'S'|'SW'|'W'|'NW';  // from the plan's north arrow
  source: 'schedule' | 'vision-estimated' | 'user';
  confidence: 'high' | 'medium' | 'low';
}
```

These become real CAD `Opening` objects on the traced walls — the "true to the original" reconstruction Nathan asked for — and, critically, they carry **orientation**, which is what makes the room's solar glazing load correct. Closes the typed-openings gap for both the vision and vector paths.

**Acceptance:** placed openings sit on the correct walls at plausible positions; each window subtracts from its opaque wall area (existing CAD rule); orientation derives from the north arrow when present, else is flagged for the reviewer.

## 9. Stage 5 — Legend + unique objects

- **Symbol legend** → a per-set symbol map (wall types, window/door glyphs, north arrow, section markers) that disambiguates detection in S4/S5.
- **Unique objects** (plumbing fixtures, casework, stairs, equipment) render as **annotations/blocks on a non-thermal layer** — visual fidelity for the twin, explicitly *not* load-bearing inputs. Keeps the drawing recognizable without pretending a detected toilet is an engineering fact.

## 10. Data model — provenance

Generalize the per-room `confidence` already in `EXTRACTION_SCHEMA` to a `{ source, confidence }` pair on rooms **and** openings, threaded through `blueprintToCad` into the CAD objects and `RoomInput`. The review UI (`AiExtract`, panel variant with ghost-preview) sorts / highlights by confidence: `vector-exact` and `schedule-declared` render pre-trusted; `vision-estimated` render amber and land first under the reviewer's eye. This is how a **tech** is productive on day one without lowering the bar for the **PE** who signs.

## 11. Phased plan

Each phase ships independently and removes a manual step *or* adds a sourced input:

| Phase | Delivers | Removes / fixes | Rough size |
|---|---|---|---|
| **1 — Triage** | `plan-triage` endpoint + confirm-and-correct picker; whole-set upload | the manual page pick; wrong-sheet extraction | small–medium |
| **2 — Scale** | scale-bar/dimension/stated witnesses + agreement rule | the manual calibrate step (when confident); per-sheet scale | small |
| **3 — Schedules** | window/door schedule parser → glazing/doors | the `windowSqFt:0` honest-zero; hand glazing entry | medium |
| **4 — Openings** | typed opening detection + placement + orientation | the typed-openings gap; wrong solar loads | medium–large |
| **5 — Legend/objects** | symbol map + annotation objects | low visual fidelity | medium |

Recommended lead: **Phase 1 (the learning-curve win) → Phase 3 (the accuracy win that makes loads real)**. 2 slots in cheaply alongside; 4/5 build on 1–3.

## 12. Honest limits / risks

- **Cost/latency:** triage + extraction is 2 vision calls; low-res triage + batching keeps it modest. `blueprint-extract` already streams with a 64k cap for large sets — the same pattern covers this.
- **Missing witnesses:** not every set has a scale bar or a schedule. The engine must **degrade to "ask the human," never guess** — the whole point of the provenance model.
- **Hard tail:** scans, angled phone photos, and handwritten markups get lower confidence and more review by design; the flag should say so.
- **Legibility ceilings** are the reviewer's call, not the model's — surfaced in `warnings`, as today.

## 13. Open questions (for review)

1. **Triage granularity:** classify per *page* only, or also detect "two floor plans on one sheet" (a real thing on small residential sets)? (Lean: page-level v1; split-sheet in Phase 4.)
2. **Scale agreement threshold:** 2% is proposed. Tighter (1%) is safer but asks more often. What's the right friction floor for the field?
3. **Schedule confidence to auto-apply:** do `high`-confidence schedule values flow straight into `RoomInput` glazing (still reviewable), or always land amber until touched? (Lean: flow in, but visibly sourced.)
4. **Orientation without a north arrow:** infer from context/street/site plan, or always ask? (Lean: ask — guessing orientation corrupts solar loads.)
5. **Where do "unique objects" live** — a dedicated non-thermal CAD layer, or a separate annotation store? (Lean: a layer, so they ride the existing layer manager.)

---

*Reuses, already in place:* the `blueprint-extract` vision endpoint + streaming + review-and-confirm contract (`ai.ts`), the ghost-preview `AiExtract` panel + `CalibrateScale` (`BlueprintDialogs.tsx`), the exact-geometry vector path (`vectorTrace.ts`, `pdfVector.ts`), the geometry mapper + rescale (`blueprintToCad.ts`), per-room `confidence`, and the honest-zero glazing guard this spec is designed to *retire* by giving it real data.

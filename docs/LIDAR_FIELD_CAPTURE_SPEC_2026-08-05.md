# LiDAR & Field-Capture Integration — Scan-to-Permit Path
**Date:** 2026-08-05 · **Status:** Spec awaiting ratification (decisions D-1 – D-10) · **Author:** Claude session w/ Nathan

---

## 0. Thesis

Every intake path we have today ingests a **representation** of the building — a PDF underlay, an
AI-read plan set, a vector trace. Each one needs a scale to be inferred or calibrated, and each one
carries transcription risk. That is exactly the measurement-chain weakness we mapped (global scale
scalar; per-sheet scale still open).

LiDAR is the first intake that measures the **building itself**. A RoomPlan capture arrives in
meters, ground-truth, no scale to infer, no drawing to trust. It inverts the platform's hardest
intake problem: scan-sourced geometry has *no scale problem at all* — the problem becomes protecting
that truth as it flows through CAD into Manual J.

Strategic wedge: Wrightsoft is desktop-bound and has no field capture. The scan apps (Polycam,
magicplan, CubiCasa, Canvas) produce floor plans but stop there — none of them terminates in a
cert-grade ACCA load calc, duct design, and permit-ready report. Nobody closes **scan → Manual J →
Manual D → permit packet** in one platform. We already own every stage after the scan. This spec is
the missing first mile: *a tech walks a house with an iPhone for 15 minutes and the platform hands
an engineer a dimensioned, oriented, typed-opening floor plan ready for loads.*

It also directly serves the specialization ladder: a solo tech with an iPhone, a firm with a Leica
BLK360, and a weatherization crew with a blower door all plug into the same ingest spine — the
platform meets each tier where it is and grades what it can trust from each device.

---

## 1. Device & data landscape (what actually exists)

| Tier | Hardware | Data we receive | Accuracy class | How it reaches us |
|------|----------|-----------------|----------------|-------------------|
| **T1 — Phone LiDAR** | iPhone 12 Pro+ / iPad Pro (LiDAR) via Apple **RoomPlan** | **Parametric**: walls, doors, windows, openings, objects — each with dimensions, 3D transform, per-entity confidence (high/med/low). iOS 17 `StructureBuilder` merges multi-room/multi-floor. Exports JSON + USDZ. | ±1–2 cm typical | Phase 1: file upload. Phase 2: our own capture app |
| **T2 — Scan apps** | Polycam, magicplan, Canvas, Scaniverse, CubiCasa (LiDAR or photogrammetry — the photogrammetry path covers Android users) | RoomPlan-derived JSON/USDZ, floor-plan exports; magicplan & Matterport expose vendor APIs | ±2–5 cm | File upload now; vendor-API seams in the device registry (Phase 3, registered-not-executed) |
| **T3 — Terrestrial scanners** | Leica BLK360, FARO Focus, NavVis | **Point clouds** (E57/PTS/PLY), mm-class | ±2–5 mm | Upload → store + view. **Not** auto-vectorized (see Non-goals) |
| **T4 — HVAC instruments** | Blower doors, digital manometers, flow hoods, thermal cameras, IAQ sensors | Not geometry — **measured calc inputs**: ACH50, static pressures, register CFM, ΔT, imagery | Instrument-grade | Phase 4: readings ingest + vendor seams |

### What RoomPlan gives Manual J, plainly

- **Per-room walls with lengths and heights** → wall areas without measuring tape.
- **Typed windows and doors with dimensions and position on their wall** → this closes a known gap
  outright: today "tracing never makes typed openings so Manual J sees zero glass"
  (project_cad_toolbar_gaps). Scans make typed openings natively. Fenestration auto-subtraction
  (validation rule 9) already exists in CAD and rides for free.
- **Multi-room adjacency** → shared walls. Our `engines/orientation.ts` `exteriorWallIds()` already
  classifies a wall claimed by two rooms as a partition — scan ingest feeds the exact logic
  `cadToManualJ` already consumes.
- **Floor area / perimeter** from the room polygon — same downstream math as detected rooms today.

### What LiDAR can NEVER give us (honesty ledger)

- **Constructions.** No scanner reads R-values, U-factors, SHGC, or assembly types. These are
  assigned by the user (or proposed by LET from the plan set) — and ACCA rule 4 (no silent
  worst-case defaults) makes the review-and-confirm step **mandatory**, not polish.
- **True north, by itself.** RoomPlan geometry is in an arbitrary local frame. Orientation — which
  drives all solar/CLTD math — requires capturing **compass heading** at scan start (ARKit
  gravity-and-heading alignment). Phase 2's own capture app records it natively; Phase 1 file
  imports get a one-gesture "align to north" step in review (rotate the ghost until the front door
  faces the street), feeding the existing `exposureBasis` machinery.
- **Exterior vs. partition for single-room scans.** Adjacency inference needs ≥2 rooms; a lone room
  scan marks all walls "exposure unconfirmed" for the reviewer.
- **Below-grade / buffer-space classification** (basement walls, garage-adjacent, knee walls) —
  reviewer confirms.
- **Sloped/cathedral ceilings** — RoomPlan's weakest geometry; flagged low-confidence, reviewer
  adjusts.

---

## 2. Architecture: one ingest spine

```
   T1 phone scan ──┐
   T2 app export ──┤   POST /api/uploads          scan_captures row      parse (pure TS,     scanToCad bridge        confirm      existing bridges
   T3 point cloud ─┼─► purpose='lidar_scan' ────► org+project scoped ──► client-side) ────► ghost preview ──────► CAD store ──► cadToManualJ →
   (T4 readings ───┘   R2: {org}/{project}/…      status machine         engines/roomScan    review-and-confirm    (provenance)   Manual J / D
    Phase 4, separate table)
```

Principles (all existing law, restated for this surface):

1. **Parsers and bridges are pure TS engines** in `frontend/src/engines/` — fixtures + vitest, no
   I/O, no side effects. Workers treat scan payloads as **opaque blobs** (no server-side 3D
   processing; keeps the Worker light and the attack surface small).
2. **Review-and-confirm, never auto-commit** — the LET idiom verbatim: ghost preview over the
   canvas, warnings surfaced, user confirms before anything enters the CAD store.
3. **Append-only capture records** with `engine_version` stamped — a permit report traces back
   through the calculation snapshot to the physical scan that measured the geometry. That
   provenance chain is a PE-stamp and SOC 2 asset no competitor has.
4. **Tenant scoping day one** — every new table has `org_id`, registered in the CI guard's
   `STRICT_TABLES` in the same commit that creates it.

---

## 3. Phase 0 — Measurement provenance substrate *(prerequisite, small)*

The one piece that must exist before any scan touches CAD, or scan truth degrades to guess-parity
the moment it lands.

**CAD entity provenance.** Optional fields on `WallSegment` / `Opening` (and `DetectedRoom`):

```ts
export type MeasurementProvenance = 'manual' | 'traced' | 'ai' | 'scan';
// on WallSegment / Opening:
provenance?: MeasurementProvenance;   // absent ⇒ 'manual' (back-compat with every stored drawing)
captureId?: string;                   // scan_captures.id when provenance === 'scan'
measureConfidence?: 'high' | 'medium' | 'low';   // RoomPlan per-entity confidence, carried through
```

- Optional-with-default keeps the `SerializedDrawing` round-trip and every existing drawing valid —
  `loadDrawing(data: unknown)` narrows at the trust boundary as it does today.
- Precedent already in-repo: `ConvertedRoom.exposureBasis` ("how exposureDirection was arrived at,
  so the UI can flag weak cases"). This generalizes that idea to the geometry itself.

**Scale-lock rule.** Scan-provenance entities are true-dimension. Calibrate Scale and underlay
auto-calibration MUST NOT rescale them — a rescale attempt over scan entities warns and excludes
them. (Blueprint-traced geometry stays rescalable; that's what calibration is *for*.)

**PropertyInspector** shows a small provenance badge (📐 scanned ±2 cm / ✏️ manual / 🖼 traced) —
the visible spine of the trust story reports will later print.

Gate: frontend tsc + vitest (round-trip serialization test with and without the new fields).

---

## 4. Phase 1 — Web file ingest *(first shippable unit — no app, no App Store, value on day one)*

Anyone with an iPhone Pro can already produce a RoomPlan export today with free/cheap apps
(Polycam, magicplan). We accept the file; nobody waits on our mobile app.

**New engine modules:**
- `engines/roomScan.ts` — parse RoomPlan `CapturedRoom` / `CapturedStructure` JSON → normalized
  `ScanModel` (rooms, walls w/ endpoints+height, openings typed+dimensioned+wall-attached,
  per-entity confidence, units meters → feet via one exported constant; decimal precision preserved
  per validation rule 7). Rejects malformed input the way `sanitizePolygon` does — corrupt ⇒ null,
  never silently repaired.
- `engines/scanToCad.ts` — `ScanModel` → `WallSegment[]` / `Opening[]` / `DetectedRoom[]` at the
  project's pxPerFt, with the `blueprintToCad` idiom copied deliberately: named tolerance
  constants, snap/merge passes, `warnings: string[]`, ghost-preview polygons, exported thresholds
  so the review UI can't describe actions more loosely than the engine applies. **Difference from
  blueprintToCad: no implied-scale inference — dimensions are already true.** Sets
  `provenance: 'scan'`, `captureId`, per-entity confidence.
- North alignment: single rotation applied at confirm time (from review gesture, Phase 1; from
  captured heading, Phase 2) → feeds `roomExposure` exactly as today.

**Fixtures & tests:** synthetic `CapturedRoom` JSON fixtures (single room; L-shaped; two rooms
sharing a wall; a window+door room; a corrupt/truncated file) → vitest golden tests on
`roomScan` + `scanToCad` (areas, wall lengths, opening attachment, partition detection via
`exteriorWallIds`, precision). Then one **real-scan validation**: Nathan or Dan walks a real room
with Polycam/magicplan, exports, imports — the parallel-end-user-testing cadence, applied here.

**Storage & records:**
- `UPLOAD_PURPOSES` += `'lidar_scan'` (uploads route already gives us tech+ POST gate, org-prefixed
  R2 keys, audit rows, admin-only DELETE — F-1 policy applies unchanged).
- USDZ stored as **archival artifact only** — never parsed (Three.js has no robust USDZ importer,
  and we don't need one: we rebuild 3D from our own parametric CAD model, which already renders).
  Bonus: USDZ opens natively in iOS AR Quick Look — a free "walk the model in AR" share link later.
- Migration **0022** `scan_captures` (mirrors the 0020 comment-header style):

```sql
CREATE TABLE IF NOT EXISTS scan_captures (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    device_id TEXT,                          -- capture_devices.id once Phase 3 lands; NULL = file import
    source TEXT NOT NULL CHECK (source IN ('roomplan_json','usdz','app_bundle','e57','ply')),
    r2_keys TEXT NOT NULL DEFAULT '[]',      -- JSON array; payloads live in R2, never in D1
    parsed_summary TEXT,                     -- JSON: room/wall/opening counts, total area, confidence mix
    engine_version TEXT,                     -- roomScan/scanToCad version stamp
    status TEXT NOT NULL DEFAULT 'uploaded' CHECK (status IN ('uploaded','parsed','confirmed','discarded')),
    heading_deg REAL,                        -- compass heading at capture (Phase 2); NULL = review-aligned
    captured_at TEXT,
    created_by TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```
  Append-only in spirit: rows advance `status`, payloads and `parsed_summary` are never mutated
  after parse. `org_id` NOT NULL → `STRICT_TABLES` same commit.
- Routes: fold into uploads for the blob; add thin `/api/scans` list/status endpoints (auth
  middleware, org-scoped, roles per §5 matrix: tech+ create, engineer+ confirm).

**UX:** CAD Workspace gains "Import Scan" beside the blueprint intake; ProjectGateDialog and
ProjectContextBar rules apply unchanged (scan data is project-scoped data, full stop).

Gate: worker tsc + scope-check + frontend tsc + full vitest; offline browser smoke (import fixture
→ ghost → confirm → walls/openings in CAD → `cadToManualJ` produces rooms with glass).

---

## 5. Phase 2 — First-party capture app (the `/mobile` reboot)

**Reality check:** `mobile/` today is stale scaffolding that mis-signals readiness — Expo-router
file names exist but `package.json` is a one-line comment stub; nothing builds. The README's own
preconditions, re-evaluated in 2026-08 terms:

| README precondition (then) | Status now |
|---|---|
| Backend persistence closed | ✅ projects + calcs + CAD sync to D1 |
| Auth hardening | ✅ hashed sessions, 30-min access + refresh rotation w/ reuse-detection — a **mobile-grade** token model, already deployed |
| WebSocket collab contract | ❌ — but **capture is one-way append** (scan → upload → done). No shared-graph sync, no desync risk. The capture app dodges this blocker entirely. |

So the capture app is the first mobile unit that's honestly unblocked — and it gives `/mobile` a
reason to exist that isn't "port the whole platform."

**REVISED 2026-08-05 (Nathan's direction: capture must open *inside Design Pro*).** The hard
constraint that shapes everything: **browsers cannot access LiDAR.** Safari exposes neither ARKit
nor scene depth to web pages — RoomPlan runs only as native code in an installed app. So instead
of a separate companion scanner (the original Expo lean), we put Design Pro itself on the phone:

- **Capacitor native shell around the EXISTING web app.** The current Vite/React frontend — CAD
  workspace, Manual J, everything — ships unchanged inside a WKWebView shell. One codebase, one
  cert surface, zero UI rebuild. The App Store app IS Design Pro.
- **Thin owned Swift RoomPlan plugin (~200 lines).** Presents the guided `RoomCaptureView` sheet
  in-app, multi-room merge via `StructureBuilder`, captures compass heading + coarse location at
  scan start, returns the CapturedStructure JSON to the web layer.
- **The plugin is just another producer of RoomPlan JSON.** Its output feeds the exact Phase-1
  path (`importScanFile` → review dialog → provenance-stamped CAD entities → `/api/scans`
  record). On LiDAR-capable devices (`RoomCaptureSession.isSupported`) the toolbox Radar button
  gains a "Scan this room now" affordance; everywhere else it remains the file picker.
- **Desktop→phone handoff (two-person flow):** the web workspace mints a short-lived, single-use
  **capture token** scoped to "upload one scan to this project" — never a session token, hashed
  at rest — rendered as a QR. Phone opens via universal link straight into capture; upload lands
  on `/api/scans`; the desktop reviewer is reached through the existing notification inbox and
  reviews on the big screen. Requires one small addition: `GET /api/scans/:id/payload`
  (org-scoped, uploads-GET content-type hardening) so a different device can hydrate the review
  dialog from the stored R2 JSON.
- **Offline queue** — field houses have no signal; captures persist locally (native storage) and
  sync when connected. Location auto-resolves design conditions: GPS → ZIP →
  `ashraeWeather.lookupByZip()`.
- Honest boundaries, stated in-product: **Android** has no RoomPlan equivalent — the shell ships
  there for workbench parity, capture stays third-party file import (camera-only photogrammetry
  is research-grade CV, already a §10 non-goal). Non-LiDAR iPhones likewise keep the file path.

**Build practicals (Windows shop):** iOS builds require macOS — use GitHub Actions macOS runners
+ fastlane (signing via repo secrets, TestFlight upload in CI); no Mac purchase. Prerequisite:
Apple Developer Program enrollment for C4. Distribution: TestFlight for the team + early orgs
first (Dan in Burlington is the archetype user); App Store when the flow survives real field use.
Rough shape to first TestFlight: shell scaffold + branding → Swift plugin → capability-gated UI +
capture-token flow + payload endpoint → CI signing (≈4–6 focused sessions).

---

## 6. Phase 3 — Device registry & configuration (the "proper sensors and devices" layer)

Mirror the pricing-oracle pattern **exactly** (0020: registered-not-executed seams, no secrets
until the encrypted-creds phase):

- Migration **0023** `capture_devices`: `org_id`, `kind`
  (`phone_lidar` | `scan_app` | `terrestrial_scanner` | `instrument`), `vendor_model`, `label`,
  `capabilities` (non-secret JSON: formats emitted, accuracy class, api seam), `status`
  (`registered` | `active` | `disabled`), `last_seen_at`. STRICT_TABLES. Vendor-API credentials
  (magicplan, Matterport, MeasureQuick-class) land only with the same AES-GCM encrypted-at-rest
  handling as MFA secrets / pricing Phase 2 — until then the seam is registered, visible, and
  inert, and the UI says so plainly (the pricing-engine honesty pattern).
- **Settings → "Capture Devices"** category in the registry-rail idiom (searchable,
  arrangeable, hideable like everything else). Admin registers devices; the mobile app pairs via a
  short-lived device code (minted server-side, single-use, same discipline as verification codes).
- Every capture stamps `device_id` → `scan_captures.device_id` → accuracy class flows into the
  provenance badge and, later, the report pedigree line.
- **T3 point clouds:** accept E57/PLY uploads (plan-tiered size caps — see §9), store in R2,
  status `uploaded` with an honest "stored, viewable, not auto-vectorized" label. A downsampled
  point-cloud preview in Viewer3D is a nice-to-have behind this phase, not a promise.

---

## 7. Phase 4 — Instruments: measured calc inputs (beyond geometry)

The quiet giant. Geometry is half of Manual J's inputs; the other half — infiltration, static
pressure, airflow — is today hand-entered and worst-case-prone. T4 devices **measure** them:

| Instrument | Reading | Lands in |
|---|---|---|
| Blower door | ACH50 | Infiltration: `ACH_natural = ACH50 / 20` (ASHRAE 136 — already our formula) |
| Digital manometer | ESP, filter/coil drops | Manual D: `ASP = ESP − filter − coil` — measured, not nameplate-guessed |
| Flow hood | Per-register CFM | Commissioning vs. design comparison (as-built honesty layer) |
| Thermal camera | Imagery | Room-attached evidence (insulation anomalies) — attachment only, no CV claims |

- Migration **0024** `instrument_readings`: org+project scoped, `device_id`, `metric`, `value`,
  `unit`, `taken_at`, `created_by` — **append-only** like calculations.
- Readings flow into calc inputs **only through review-and-confirm**, stamped with provenance —
  a measured ACH50 is the strongest possible form of ACCA rule 4's "explicit user intervention,"
  and the input snapshot (already stored as full JSON on every calc) records that the number was
  measured, by what, and when.
- This is where "software dynamism" compounds: the same platform grades up from
  *defaults → user-entered → field-measured* per input, visibly.

---

## 8. Phase 5 — Specialization ladder, telemetry, and the report pedigree

- **Role flow, using gates that already exist:** tech scans and uploads (tech+ upload gate, F-1),
  engineer confirms geometry and assigns constructions (engineer+ project mutation), admin submits
  permits. The scan is the field tech's on-ramp into design work — specialization by doing.
- **Report pedigree line** on Manual J/D PDFs: *"Geometry: field-scanned (iPhone LiDAR, ±2 cm
  class), 2026-08-05; constructions: engineer-assigned; infiltration: blower-door measured."*
  Honest framing rules apply — measurement pedigree is a **trust** claim, never a certification
  claim (the ACCA-registry marketing rule stands).
- **Drift telemetry:** scan-derived vs. manually-drawn dimension deltas surface on the existing L0
  `qa-benchmarks` route — the same shadow-run discipline the J8 engine used, applied to intake.
- **Mason assists** at review time (global orb already everywhere): flags unconfirmed exposures,
  missing ceiling heights, unassigned constructions, low-confidence walls — the tutor that turns a
  tech into a designer one confirmed scan at a time.

---

## 9. Security & privacy audit (pre-answered, §2-Layer-3 discipline)

- **Payloads are opaque to the Worker.** All parsing (JSON, and any future USDZ/point-cloud
  handling) is client-side pure TS. No zip extraction server-side ⇒ no zip-slip surface. Worker
  validates purpose, size, content-type, org/project, and stores.
- **Size caps, plan-tiered:** RoomPlan JSON ~KBs; USDZ ~5–50 MB; E57 can reach GBs — cap by plan
  (starter: JSON+USDZ only; enterprise: point-cloud tiers). Caps enforced in the Worker, not the UI.
- **Location is PII.** These are scans of real customers' homes. Heading stored at full precision
  (orientation is calc-critical); GPS coarsened to ZIP for weather lookup; precise coordinates
  stored only under an org-policy toggle (Option-C default: off). Never in URL params.
- **Scan imagery/USDZ is customer property** — org-prefixed R2 keys (existing idiom), org-scoped
  reads, admin-gated deletes, audit rows on upload/confirm/delete (existing middleware).
- **Device pairing codes:** short-lived, single-use, hashed at rest like everything else we mint.
- **No vendor credentials anywhere** until the encrypted-at-rest phase — registry rows carry
  non-secret config only (0020 precedent, stated in the schema comment).
- **New tables ⇒ `org_id` + STRICT_TABLES in the same commit.** No exceptions, same as ever.

---

## 10. Non-goals (so scope cannot creep silently)

1. **No point-cloud auto-vectorization in the critical path.** Cloud→walls is research-grade CV;
   we ship parametric-first (RoomPlan and vendor APIs emit walls, not points) and store clouds as
   evidence. Revisit only as its own ratified phase.
2. **No server-side 3D processing pipeline.** Engines stay pure client TS; Workers stay thin.
3. **No Android first-party capture in v1.** ARCore depth is a weaker story; Android users are
   covered today via T2 app exports (CubiCasa/magicplan photogrammetry). Revisit on demand signal.
4. **No parallel calc or geometry service.** One engine family, one cert surface — scan ingest is
   bridges into the existing spine, never a second spine.
5. **No accuracy marketing beyond what a device warrants.** ±2 cm is a claim about geometry, never
   about load-calc certification.

---

## 11. Decisions awaiting ratification

| # | Decision | Lean |
|---|----------|------|
| D-1 | Ship order: web file ingest (Phase 1) before first-party app (Phase 2) | **Yes** — value without App Store dependency; real scans validate the parser before we build capture |
| D-2 | Parametric-first policy (RoomPlan/vendor JSON trusted; point clouds stored-not-vectorized) | **Yes** — honesty + scope control |
| D-3 | Provenance fields on CAD entities as specced (§3), with scale-lock rule | **Yes** — retrofit later is forever-lossy; do it before first scan lands |
| D-4 | Phone architecture — **REVISED 2026-08-05** (capture must open inside Design Pro; browsers can't access LiDAR): Capacitor native shell around the existing web app + thin owned Swift RoomPlan plugin (vs. the original separate-Expo-capture-app lean) | **Capacitor shell** — zero UI rebuild, "Scan this room now" lives in the real CAD workspace, one codebase stays the cert surface |
| D-5 | Location policy: heading full-precision; GPS→ZIP for weather; precise coords org-gated off by default | **Yes** — calc needs orientation, not addresses |
| D-6 | Device registry mirrors pricing-oracle registered-not-executed (creds deferred to AES-GCM phase) | **Yes** — proven pattern, honest UI |
| D-7 | Scan payload retention/size: plan-tiered caps (starter JSON+USDZ; enterprise point clouds); retention follows project lifetime | Proposal — needs Nathan's plan-pricing eye |
| D-8 | Single-room scans: all walls "exposure unconfirmed" (reviewer resolves) vs. heuristic guess | **Unconfirmed-explicit** — rule-4 spirit; no silent guessing |
| D-9 | Phase-4 instrument readings write into calc inputs via review-confirm with provenance (vs. advisory-only sidebar) | **Review-confirm into inputs** — measured data deserves first-class status, with the snapshot recording pedigree |
| D-10 | Sloped-ceiling / below-grade handling: flag-and-review v1 (no geometry repair attempts) | **Yes** — honest v1 |
| D-11 | App Clip for QR-invoked instant capture (scan a code, capture with no install) | Phase 2.5 — after the full app ships; a capture-only clip stays small since RoomPlan is a system framework |
| D-12 | iOS build infra from a Windows shop: GitHub Actions macOS runners + fastlane (vs. buying a Mac / third-party build service) | **GH Actions macOS + fastlane** — signing via secrets, TestFlight upload in CI, no new hardware |

---

## 12. Sequencing vs. in-flight work

- Lands **after** the current uncommitted threads (L0 read-only viewer commit + deploy;
  notifications 0021 prod apply; DDI pricing thread) — no interleaving with open diffs.
- Migration numbering here assumes 0021 applied: scans=**0022**, devices=**0023**, readings=**0024**.
- Recommended first unit (one clean session, ship-whole): **Phase 0 + Phase 1** — provenance
  fields, `roomScan` + `scanToCad` engines with fixtures, `lidar_scan` purpose, migration 0022,
  import UX, review-confirm. Frontend-heavy, one small migration, fully offline-smokeable, zero
  risk to live users until they click Import Scan.
- Phase 2 (capture app) is the first unit *after* a real third-party scan file has round-tripped
  through Phase 1 in production hands — the parser earns trust before we build hardware UX on it.

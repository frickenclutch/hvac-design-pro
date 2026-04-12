# HVAC Design Pro — Progress Report & Continuation Strategy
**Date:** April 12, 2026 | **Codebase Snapshot:** commit `3f46029` on `main`

---

## I. Platform Metrics at a Glance

| Metric | Value |
|--------|-------|
| Total commits | 34 |
| Frontend TS/TSX files | 55 |
| Frontend lines of code | 20,853 |
| Calculation engine code | 147 KB (5 JS engines) |
| Backend services | 3 (Cloudflare Workers, Go Gateway, Python FastAPI) |
| Database migrations | 6 SQL schemas |
| Zustand stores | 5 (~400 state properties) |
| Bundle size (gzip) | ~660 KB total (541 KB main chunk) |
| Production dependencies | 11 (zero CVEs) |
| Test coverage | 0% (no test files) |
| Branches | 1 (`main`) |

---

## II. Feature Inventory — Completion Assessment

### A. CAD Workspace — 92% Complete

| Feature | Status | Notes |
|---------|--------|-------|
| 9 drawing tools (Select, Pan, Wall, Window, Door, HVAC, Dimension, Label, Room Detect) | DONE | All tools functional with hotkeys |
| Multi-floor support | DONE | FloorSelector with visibility toggle, reorder, rename |
| 5 layers (Walls, Openings, HVAC, Dimensions, Labels) | DONE | LayerManager with lock/visibility |
| Wall materials (3 types + R-values) | DONE | Wood frame, metal stud, concrete in PropertyInspector |
| Opening specs (U-factor, SHGC, glass types) | DONE | 5 glass presets in PropertyInspector |
| HVAC equipment properties | DONE | BTU, SEER, tonnage, CFM fields |
| Grid snapping | DONE | Configurable snap increment |
| Undo/redo (50-level stack) | DONE | Ctrl+Z / Ctrl+Shift+Z |
| Image underlay import | DONE | Floor plan trace support |
| Haptic feedback | DONE | haptics.ts — snap pulses, placement confirms |
| Keyboard shortcuts (20+) | DONE | Full shortcut table in HelpCenter |
| Room detection polygon validation | PARTIAL | Detection works; polygon validation needs hardening |
| Cross-project data isolation | DONE | Fixed 2026-04-12 (commit `3f46029`) |

### B. 3D Visualization Engine — 90% Complete

| Feature | Status | Notes |
|---------|--------|-------|
| Procedural assets (9 types) | DONE | Door, window, air handler, condenser, thermostat, duct, register, grille, pipe |
| Shadow mapping (PCF, 2048x2048) | DONE | ACES tone mapping, fog |
| STL/OBJ export | DONE | stlExporter.ts (binary STL, ASCII OBJ) |
| STL/OBJ/GLTF/FBX import | DONE | Three.js loaders with auto-scale/center |
| InstancedMesh for repeated assets | NOT DONE | Optimization opportunity from roadmap |
| Texture atlasing | NOT DONE | Optimization opportunity |

### C. Manual J Calculator — 95% Complete

| Feature | Status | Notes |
|---------|--------|-------|
| Room-by-room heating/cooling loads | DONE | 508-line ACCA Manual J 8th Ed engine |
| 6 wall grades + orientation-based SHGC | DONE | |
| Ceiling/floor R-values | DONE | |
| Infiltration (ACH) | DONE | |
| Duct loss per ACCA Table 7 | DONE | |
| Humidity/latent heat | DONE | |
| ASHRAE 62.2 ventilation | DONE | |
| Equipment sizing (BTU/h + tons) | DONE | |
| CAD-to-Manual J bridge | DONE | cadToManualJ.ts (3.9 KB) |
| Manual J-to-CAD thermal viz | DONE | manualJToCad.ts (5.5 KB) |
| Accuracy validation vs. WrightSoft/Elite | NOT DONE | Critical trust signal |

### D. Cost Estimator — 85% Complete

| Feature | Status | Notes |
|---------|--------|-------|
| Cost matrices (1.5-5 ton, 4 system types) | DONE | Heat pump, AC+furnace, mini-split, packaged |
| Ductwork cost by location | DONE | |
| Labor multipliers | DONE | |
| Line-item breakdown with tax | DONE | |
| Low/high range estimates | DONE | |
| Regional labor rate database | NOT DONE | Currently static multipliers |

### E. Asset Library — 90% Complete

| Feature | Status | Notes |
|---------|--------|-------|
| 30 assets across 5 categories | DONE | Doors, Windows, HVAC, Piping/Duct, Fixtures |
| Major manufacturers | DONE | Carrier, Mitsubishi, Andersen, Marvin, Pella, etc. |
| Dockable side panel (320-900px) | DONE | Resizable with search/category filter |
| Virtual scrolling for large lists | NOT DONE | Optimization from roadmap |

### F. Mason AI Assistant — 80% Complete

| Feature | Status | Notes |
|---------|--------|-------|
| Knowledge base (25+ topics) | DONE | Manual J, sizing, ductwork, R-values, SHGC, etc. |
| Context-aware (CAD vs. Manual J) | DONE | MasonContext switching |
| Quick calculators | DONE | Equipment sizing, design conditions |
| LLM integration | NOT DONE | Currently pattern-matched; no live AI model |
| Drawing context awareness | NOT DONE | Cannot analyze active canvas state |

### G. Supporting Features — 85% Complete

| Feature | Status | Notes |
|---------|--------|-------|
| Authentication | PARTIAL | Auth store + backend scaffolded; frontend still mock-able |
| 5-step onboarding | DONE | OnboardingPage.tsx (18 KB) |
| Dashboard with localStorage | DONE | Project tiles, inline editing |
| Settings (theme/density/units) | DONE | IP/SI, 3 regions (ASHRAE/EN/CIBSE) |
| WCAG 2.1 AA accessibility | DONE | A11y component suite |
| Cmd+K spotlight search | DONE | SpotlightSearch.tsx (23 KB) |
| i18next internationalization | DONE | Framework wired; translation files needed |
| PDF generation | DONE | Multi-page reports with schedules |
| PWA / offline | DONE | manifest.json, service worker, standalone mode |
| User guide | DONE | UserGuidePage.tsx (35 KB) |
| Retailer finder (GPS) | DONE | Howland Pump preferred network |

---

## III. Roadmap Phase Assessment

### Phase 1: Foundation Hardening (Weeks 1-4)

| Item | Status | Progress | Blockers / Notes |
|------|--------|----------|------------------|
| Automated tests (unit, component, E2E) | NOT STARTED | 0% | Zero test files exist. No test framework configured (no vitest/jest/playwright in deps). **Highest-risk gap.** |
| Real authentication (Workers + D1 + WebAuthn) | IN PROGRESS | 50% | Backend: Workers auth routes, Go Cognito/JWT/passkey handlers, D1 user schema all exist. Frontend: useAuthStore has full user/org model. Missing: WebAuthn flow end-to-end, email verification, password reset. |
| Code splitting (<300 KB critical path) | NOT STARTED | 0% | Main chunk is 541 KB gzip. No dynamic imports or React.lazy() in route definitions. |
| TypeScript strict mode (zero `any`) | IN PROGRESS | 75% | `strict: true` IS enabled in tsconfig.app.json. Remaining `any` usage: api.ts (16), useCadStore (6), useProjectStore (1), useAuthStore (1) = 24 total. |
| File upload size limits | NOT CONFIRMED | ~30% | Backend upload route exists but size validation not verified. |
| React error boundaries | DONE | 100% | ErrorBoundary wraps CadCanvas and Navigation in CadWorkspace. |

**Phase 1 Overall: ~40% complete**

### Phase 2: Professional-Grade Features (Weeks 5-12)

| Item | Status | Progress | Blockers / Notes |
|------|--------|----------|------------------|
| Manual D duct sizing | SCAFFOLDED | 20% | Python `manual_d.py` engine exists in calc-service. No frontend UI. No integration with CAD auto-routing. |
| Bidirectional CAD-Manual J link | IN PROGRESS | 60% | `cadToManualJ.ts` and `manualJToCad.ts` bridges exist. `useThermalAnalysis` hook runs real-time. Missing: UI to trigger sync, validation of round-trip accuracy. |
| ASHRAE weather database (zip/GPS) | DONE | 95% | `ashraeWeather.ts` at 106 KB with full lookup. Missing: GPS auto-detect (currently manual entry). |
| AHRI equipment database | NOT STARTED | 0% | No AHRI data files or integration. Required for equipment schedules. |
| Architectural scale printing | NOT STARTED | 0% | PDF gen exists but no true-scale (1/4"=1'-0") or title block support. |
| DXF/DWG import | NOT STARTED | 0% | No DXF/DWG parsing library in dependencies. |
| Auto equipment schedules | NOT STARTED | 0% | Depends on AHRI database. |

**Phase 2 Overall: ~25% complete**

### Phase 3: Intelligence Layer (Weeks 13-20)

| Item | Status | Progress | Blockers / Notes |
|------|--------|----------|------------------|
| Load calc anomaly flagging | NOT STARTED | 0% | |
| Equipment recommendation engine | SCAFFOLDED | 15% | Cost estimator has basic sizing; no ML/rule-based recommendation. |
| Code compliance (IRC/IECC/ASHRAE 90.1) | SCAFFOLDED | 15% | Python `acca_compliance.py` exists. Not wired to frontend. |
| Energy cost projection | NOT STARTED | 0% | |
| Mason AI LLM upgrade | NOT STARTED | 0% | Currently pattern-matched knowledge base, no LLM API call. |

**Phase 3 Overall: ~5% complete**

### Phase 4: Collaboration & Enterprise (Weeks 21-30)

| Item | Status | Progress | Blockers / Notes |
|------|--------|----------|------------------|
| CRDT real-time collaboration | SCAFFOLDED | 10% | Go gateway has WebSocket `hub.go` + `client.go`. No CRDT library, no frontend integration. |
| Git-like revision history | NOT STARTED | 0% | |
| Commenting/red-line markup | NOT STARTED | 0% | |
| Org management with roles | IN PROGRESS | 40% | Auth store has 4 roles (admin/engineer/tech/viewer), org model with type/region. Backend D1 schemas for tenancy. Missing: invite flow, permission enforcement. |
| REST + WebSocket API | IN PROGRESS | 35% | Workers REST routes functional. Go WebSocket scaffolded. Missing: webhooks, API documentation, rate limiting enforcement. |

**Phase 4 Overall: ~15% complete**

### Phase 5: Beyond Earth (Weeks 31+)

| Item | Status | Notes |
|------|--------|-------|
| All items | NOT STARTED | Aspirational. Zero implementation. |

**Phase 5 Overall: 0%**

---

## IV. Critical Path Analysis

### Dependency Chain (items that unlock downstream work)

```
Room Detection Validation ──► Manual D Auto-Routing ──► Duct Cost Accuracy
                          └──► CAD-Manual J Link (bidirectional) ──► Code Compliance
                                                                 └──► Anomaly Flagging

AHRI Database ──► Equipment Schedules ──► Equipment Recommendation Engine
              └──► Accurate Cost Estimates

Real Authentication ──► Collaboration ──► Org Management
                   └──► Audit Trail ──► PE Stamp Compatibility

Automated Tests ──► Confidence in ALL of the above
```

### Top 5 Risks

1. **Zero test coverage** — Every shipped feature is unvalidated. Regression risk compounds with each commit. One bad merge could silently break Manual J calculations and nobody would know until a customer reports wrong tonnage.

2. **541 KB main bundle** — All code ships in one chunk. First paint on mobile 3G is ~4-5 seconds. Code splitting is blocked on zero — no React.lazy, no dynamic imports, not even route-level splitting.

3. **Backend not deployed end-to-end** — Three backend services exist (Workers, Go, Python) but the frontend guards all API calls behind `VITE_API_BASE_URL`. Production currently runs as a pure client-side app with localStorage persistence only.

4. **No AHRI/ASHRAE trust signals** — Without equipment database integration and third-party validation, professional HVAC contractors won't trust the calculations enough to sign off on permits.

5. **24 remaining `any` types** — With strict mode enabled, these are deliberate escape hatches. The 16 in `api.ts` propagate untyped data into every consuming component.

---

## V. What's Been Fixed This Session (April 12, 2026)

| Commit | Fix | Impact |
|--------|-----|--------|
| `49dfe8c` | Save-as flow navigation (replaceState → navigate), 15 TS build errors, CadWorkspace routing | Unblocked Cloudflare Pages deployment |
| `82f4da9` | Removed `_redirects` file | Silenced Cloudflare infinite loop warning |
| `f0ad622` | Removed hard `window.location.href = '/login'` on 401 in api.ts | **Fixed production redirect loop that forced rollback to `239b72a`** |
| `3f46029` | Reset CAD store on project entry, guard async load race | **Fixed cross-project data bleed** |

**Production status:** Rolled back to `239b72a`. Commits `49dfe8c` through `3f46029` need deployment.

---

## VI. Ecosystem Context

Features being ported OUT of this project into the broader ecosystem:

| Portable Module | Size | Ecosystem Value |
|----------------|------|-----------------|
| Manual J engine (`manualJ.ts`) | 21 KB | Drop-in ACCA 8th Ed calc for any HVAC app |
| ASHRAE weather DB (`ashraeWeather.ts`) | 106 KB | Self-contained ZIP→design-conditions lookup |
| Cost estimator (`costEstimator.ts`) | 8.5 KB | Equipment sizing + regional cost matrices |
| 3D asset library (`assetModels.ts`) | 40 KB | Procedural Three.js HVAC geometry |
| STL/OBJ exporter (`stlExporter.ts`) | 7 KB | Generic Three.js scene → file export |
| PDF generator (`pdfGenerator.ts`) | 26 KB | jsPDF report templating with canvas capture |
| Haptics system (`haptics.ts`) | 7.3 KB | Canvas interaction feedback patterns |
| Geolocation utils (`geolocation.ts`) | 3.7 KB | Distance calc + GPS retailer lookup |
| Unit conversion (`units.ts`) | 3.3 KB | IP/SI conversion library |

**Multi-standard backend engines** (Python calc-service):
- ACCA Manual J, D, S, AED (US)
- ASHRAE RTSM, HBM (International)
- EN 12831 (EU)
- CSA F280 (Canada)

These are fully self-contained and can serve as shared libraries across the ecosystem without modification.

---

## VII. Continuation Strategy

### Immediate (Next 2 Weeks) — Stabilize & Ship

**Priority: Get `3f46029` into production and prevent future production incidents.**

1. **Deploy `3f46029` to Cloudflare Pages production** — The four bug-fix commits are sitting on `main` while production runs `239b72a`. Push the deploy.

2. **Set `VITE_API_BASE_URL` in Cloudflare Pages env vars** — This gates all backend API calls. Without it, the app runs as pure client-side. With it, D1 persistence activates.

3. **Add Vitest + first test suite** — Install `vitest` + `@testing-library/react`. Write 10-15 tests for `manualJ.ts` against known-good hand calculations. This is the single highest-ROI action — it validates the core IP of the product and establishes a test pattern for the team.

4. **Eliminate `any` from `api.ts`** — Define typed response interfaces for all 15 API methods. This propagates type safety to every consumer. The 16 `any` usages in this one file account for 67% of all remaining type holes.

5. **Route-level code splitting** — Wrap each `<Route>` element with `React.lazy()` + `Suspense`. Target: main chunk under 300 KB. This requires zero architecture changes — just dynamic imports.

### Short-Term (Weeks 3-6) — Professional Trust

6. **AHRI equipment database integration** — Source AHRI certified data (publicly available directory). Build lookup by model number, capacity, SEER/HSPF. This unlocks equipment schedules and recommendation engine.

7. **Bidirectional CAD-Manual J UI** — The bridges exist (`cadToManualJ.ts`, `manualJToCad.ts`). Build the UI: a "Sync to Manual J" button in CAD that populates the calculator, and a "Visualize Results" button in Manual J that paints thermal overlay on the canvas.

8. **True-scale PDF printing** — Add architectural scale options (1/4"=1'-0", 1/8"=1'-0") and title block templates to `pdfGenerator.ts`. HVAC contractors need to print plans at scale for field work.

9. **DXF import (read-only)** — Add `dxf-parser` npm package. Parse DXF into Fabric.js objects (lines → walls, blocks → equipment). This lets contractors import existing AutoCAD floor plans instead of redrawing.

### Medium-Term (Weeks 7-14) — Intelligence & Compliance

10. **Manual D duct sizing frontend** — Connect Python `manual_d.py` to the frontend via Workers proxy. Build duct routing UI on canvas with auto-sizing based on CFM requirements from Manual J.

11. **Code compliance checking** — Wire Python `acca_compliance.py` to validate designs against IRC 2021, IECC 2021, ASHRAE 90.1. Display pass/fail badges on dashboard.

12. **Mason LLM upgrade** — Replace pattern-matching with Anthropic Claude API (or equivalent). Give Mason the active project context (rooms, loads, equipment) so it can answer questions like "Is my system oversized for this house?"

13. **E2E tests with Playwright** — Test critical user flows: create project → draw walls → run Manual J → export PDF. Run in CI on every PR.

### Long-Term (Weeks 15+) — Collaboration & Scale

14. **Real authentication end-to-end** — Connect frontend auth flow to Workers + D1. Add email verification, password reset, WebAuthn passkeys. Gate project persistence behind auth.

15. **CRDT collaboration** — Upgrade Go WebSocket hub to use Yjs or Automerge CRDT. Enable multi-user editing of the same floor plan in real time.

16. **Revision history** — Store drawing snapshots in D1 on each save. Build diff viewer showing what changed between versions.

---

## VIII. Recommended Sprint Structure for Multi-Agent Team

Given the ecosystem context (multiple IDEs, agents, and engineers working in parallel):

### Parallelizable Work Streams

| Stream | Owner Profile | Files/Modules | Dependency |
|--------|--------------|---------------|------------|
| **A: Test Harness** | Any agent/engineer | New: `vitest.config.ts`, `src/**/*.test.ts` | None — fully independent |
| **B: Type Safety** | Any agent/engineer | `api.ts`, store files | None — fully independent |
| **C: Code Splitting** | Frontend engineer | `App.tsx`, route definitions | None — fully independent |
| **D: AHRI Database** | Data engineer | New: `src/engines/ahriDatabase.ts` | None — data sourcing task |
| **E: DXF Parser** | CAD engineer | New: `src/features/cad/utils/dxfImporter.ts` | None — library integration |
| **F: Manual D UI** | Full-stack | Python calc-service + new CAD component | Depends on Workers deploy |
| **G: Auth E2E** | Backend engineer | Workers routes + frontend auth store | Depends on env var config |
| **H: Mason LLM** | AI engineer | `Mason.tsx` + API integration | Depends on API key provisioning |

Streams A through E can run simultaneously with zero merge conflicts. F, G, and H have deployment dependencies but are otherwise independent of each other.

### Commit Conventions for Multi-Agent Repo

Given 34 commits with clean prefixes already established (`feat:`, `fix:`, `ci:`), continue with:
- `feat:` — New capability
- `fix:` — Bug fix
- `test:` — Test additions
- `refactor:` — Code improvement without behavior change
- `chore:` — Build/config changes
- `docs:` — Documentation

Each agent/IDE should work on a feature branch and PR to `main`. The zero-test-coverage risk makes `main` branch protection with required CI checks the #1 infrastructure action.

---

## IX. Weighted Priority Matrix

Scoring: Impact (1-5) x Urgency (1-5) x Effort-Inverse (5=easy, 1=hard)

| Item | Impact | Urgency | Effort-Inv | Score | Rank |
|------|--------|---------|------------|-------|------|
| Deploy `3f46029` to production | 5 | 5 | 5 | 125 | 1 |
| Set `VITE_API_BASE_URL` env var | 4 | 5 | 5 | 100 | 2 |
| Add Vitest + Manual J tests | 5 | 5 | 4 | 100 | 3 |
| Route-level code splitting | 4 | 4 | 4 | 64 | 4 |
| Type `api.ts` responses | 4 | 3 | 4 | 48 | 5 |
| CAD-Manual J sync UI | 5 | 3 | 3 | 45 | 6 |
| DXF import | 4 | 3 | 3 | 36 | 7 |
| AHRI database | 5 | 3 | 2 | 30 | 8 |
| True-scale PDF printing | 4 | 3 | 3 | 36 | 9 |
| Manual D frontend | 5 | 2 | 2 | 20 | 10 |
| Mason LLM upgrade | 3 | 2 | 2 | 12 | 11 |
| E2E Playwright tests | 4 | 2 | 2 | 16 | 12 |
| Real auth end-to-end | 4 | 2 | 1 | 8 | 13 |
| CRDT collaboration | 5 | 1 | 1 | 5 | 14 |

---

## X. Summary

**What exists:** A feature-rich, offline-capable HVAC design platform with 2D CAD, 3D visualization, Manual J calculations, cost estimation, AI assistant, and PWA support — deployed on Cloudflare edge. The core product loop (draw → calculate → estimate → export) works end-to-end in the browser.

**What's missing:** Testing, backend deployment, professional trust signals (AHRI, ACCA validation, DXF interop), and the intelligence/collaboration layers that differentiate a tool from a platform.

**The critical path:** Deploy the bug fixes → add tests → split the bundle → wire AHRI → connect CAD↔Manual J UI → ship compliance checking. Everything else accelerates once these foundations are solid.

**Ecosystem leverage:** Nine self-contained modules (Manual J engine, ASHRAE weather DB, cost estimator, 3D assets, STL/OBJ export, PDF generator, haptics, geolocation, units) are portable into sibling projects today. The Python calc-service supports four international standards and serves as the shared calculation backbone.

The platform has crossed the threshold from prototype to functional product. The next phase is about earning professional trust: validated calculations, industry-standard interop, and the reliability that comes from automated testing. The architecture supports all of it — the work is execution.

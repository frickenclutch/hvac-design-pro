# Session Handoff — P0 Hardening Sprint

**Date:** 2026-06-02
**Repo:** `frickenclutch/hvac-design-pro` (branch `main`)
**Theme:** Closed the three P0 "credibility gaps" a serious buyer probes — tenant isolation, strict TypeScript, and auth — and shipped the auth hardening end-to-end to production.

---

## TL;DR

Audited the platform, then shipped four clean units and **deployed the breaking auth change to prod**:

1. **Tenant-isolation guard** — a CI check that makes org-scoping *provable*, not just disciplined (D1 has no RLS).
2. **Strict-TS burn-down** — `lib/api.ts` + the **entire CAD surface** to `0 any`.
3. **Auth hardening** — session tokens hashed at rest, access/refresh rotation with reuse-detection, 30-min access tokens + frontend silent-refresh. **Now live in production.**
4. Governance docs (CLAUDE.md, memory) kept current throughout.

**Production is fully on the hardened auth model.** One-time forced re-login is in effect (token hashing). Everything is verified except the live login→expiry→refresh happy-path, which needs a **human eyeball** (couldn't drive a real user's credentials).

---

## Production state (live right now)

| Piece | Value |
|---|---|
| Frontend | `hvac-design-pro.pages.dev` — Pages deploy `9b196a15` (merge `3be71a4`), **new code live & content-verified** |
| Worker API | `hvac-api.c4tech.workers.dev` — version **`b50752df`** |
| D1 | `hvac-design-pro` (`9ad753c8-…`), **11 migrations** (0011 `refresh_tokens` applied) |
| CF account | C4 Technologies (`e923bf772f49580f54b7b5dc7910e32f`) |
| Auth model | Hashed tokens · **30-min access** · **14-day rotating refresh** · `/api/auth/refresh` w/ reuse-detection · frontend silent-refresh |
| Cron | `*/5 * * * *` permit auto-expire sweep — preserved across deploy |

**Smoke test (post-deploy):** `/health` → 200 · `POST /api/auth/refresh` → 400 (missing token) / 401 (invalid token). ✅

---

## What shipped, in detail

### 1. Platform audit + smoke test
Ran the CI gate locally (worker tsc, frontend tsc, 43/43 vitest) — all green. Finding: the platform was **more buttoned-up than the docs implied** (real PBKDF2 password hashing, isolation correct, OTP infra already present). The three real P0 gaps were confirmed with evidence: auth mocked-grade, isolation by-discipline-only, strict-TS hotspots in `api.ts` + CAD.

### 2. P0 #2 — Tenant-isolation guard  · commit `88bd53a` `feat(security)`
D1 has **no row-level security**, so org isolation lives entirely in the app layer (CLAUDE.md §2 Layer 3's "RLS on every table" describes the Aurora path, not the live D1 stack).

- **New:** `workers/scripts/check-tenant-scoping.mjs` — zero-dep static guard. Fails the build if any D1 query on a **strict tenant table** (`projects`, `calculations`, `cad_drawings`, `cad_drawing_versions`, `file_uploads`, `feedback`) lacks `org_id` and lacks a documented `// tenant-scope-ok:` waiver.
- Wired as CI job **`tenant-scoping`** + `npm run scope:check`.
- Cross-tenant-by-design routes (`platform`=L0, `forum`=opt-in board, `permits`=party-gated, `audit`=OR-visibility) are the acknowledged exceptions.
- Tightened **5 sibling-gated queries** to self-defend with their own `org_id`.
- Proven: catches a planted violation, waiver suppresses, green on real code (and green in CI).

### 3. P0 #3 — Strict-TS burn-down  · commit `b457e1a` `refactor(types)` (+ `api.ts` in the auth commit)
- **`lib/api.ts`: 17 → 0 `any`** — server-row response types + `unknown` for opaque payloads, **zero consumer cascade** (auth methods were unused; project methods are cast in `projectStorage`).
- **Entire CAD surface: 0 `any`** (`CadCanvas`, `Viewer3D`, `useCadStore`, `useAutoSave`, `AssetSearch`, `BuildingScience`, `CadWorkspace`). Three patterns:
  - global `declare module 'fabric'` augmentation adds the custom `name` prop → kills every `(obj as any).name` cast app-wide;
  - `SerializedDrawing` type for the canvas serialize/load round-trip (`loadDrawing(data: unknown)` narrows once at the trust boundary);
  - `Seg2D` narrows the 3D wall/duct helpers.
- **Browser-verified end-to-end:** drew a wall → auto-persisted → opened the 3D view, zero console errors.
- **Remaining `any` (~14):** scattered across smaller components (Mason, Manual D/J calculators, a few modals) — a lighter follow-up.

### 4. P0 #1 — Auth hardening  · commit `fcf4f69` `feat(auth)` (+ migration 0011)
Three sub-steps, all shipped:

- **Tokens hashed at rest** — `sessions.token` stores `SHA-256(token)` via `hashToken()` (`utils/crypto.ts`), applied at all 5 mint + 3 validate/delete sites. A D1 read/dump/SQLi yields no usable sessions. `org_invites` tokens left plaintext by design (separate single-use mechanism).
- **Access + refresh split** (migration 0011 `refresh_tokens`) — `mintTokenPair()` (`utils/session.ts`) issues a 30-min access token (sessions) + a rotating 14-day refresh token (hashed). New `POST /api/auth/refresh` rotates **single-use with reuse-detection**: replaying a consumed token revokes the user's whole set and audits `auth.refresh_reuse`. Logout + password-reset revoke refresh tokens; deactivation relies on the `/refresh` status gate.
- **30-min flip + frontend silent-refresh** — `ApiClient.refreshSession()` (`lib/api.ts`) swaps the refresh token on any 401, **dedupes concurrent 401s behind one in-flight rotation**, and retries; `restoreSession` refreshes on a `/me` 401; refresh token persists as `hvac_refresh_token`.

---

## How it was verified (and the limits)

There was **no local backend** (no `wrangler dev` + seeded D1), so the auth flows were verified by:

- **Compiler + cert gate:** worker tsc, frontend tsc, 43/43 vitest — all green (locally and in CI).
- **Node logic simulations (11 cases):** backend rotation / reuse / expiry / unknown / status, and frontend refresh / retry / dedup / no-loop. All pass. `hashToken` checked against the NIST SHA-256 `abc` vector.
- **Browser smoke:** CAD draw→persist→3D e2e (zero console errors); clean auth-store boot.
- **Post-deploy:** `/health` 200; `/api/auth/refresh` returns 400/401 correctly (endpoint live + validating); production bundle **content-verified** to contain `hvac_refresh_token` + `refreshSession`.

**Not yet verified (the one open item):** the real-world happy-path — log in → sit ~30 min so the access token expires → confirm the silent refresh is seamless and the user is **not** bounced to login. If anyone gets unexpectedly logged out *after* re-authenticating, that's the symptom to flag.

---

## ⚠️ Open items / next steps (prioritized)

1. **Human eyeball on live auth** *(do first — it's the only unverified path).* Log in to `hvac-design-pro.pages.dev`, use it past the 30-min access window, confirm seamless. Watch for: re-login that doesn't "stick," or a logout loop.
2. **One-time re-login is in effect now** — everyone with an old session gets bounced once. Optional tidy-up: `wrangler d1 execute hvac-design-pro --remote --command "DELETE FROM sessions"` to purge dead plaintext rows.
3. **Finish auth roadmap:** OTP login (reuse the existing `verificationCodes` infra) → optional MFA/TOTP.
4. **Strict-TS tail:** ~14 remaining `any` in Mason / Manual D/J / modals.
5. **Isolation integration tests** — the static guard covers "forgot the clause"; live cross-tenant request tests (org-A-token vs org-B-resource → 404) would cover "clause is there but wrong." Needs a worker test runner (`@cloudflare/vitest-pool-workers`/miniflare).
6. **P1 moat work** (per the roadmap): Manual S (115% rule, completes J→D→S), permit-portal v2 (L0 drawer checklist UX, multi-authority, permit-cert PDF), AI/image floor-plan intake.

---

## 🪤 Gotchas & learnings (read before you deploy)

- **`hvac-design-pro/` IS a git repo** → GitHub `frickenclutch/hvac-design-pro`, branch `main`. (The harness's "is-git" flag points at the **parent** workspace folder `HVAC Design Pro/`, which is *not* the repo — don't be misled by it.)
- **`CLAUDE.md` lives OUTSIDE the repo** (in the parent `HVAC Design Pro/` folder). Edits to it are **local working memory only** — they are *not* committed/pushed. Shippable governance must live in-repo.
- **Verifying a Pages deploy by bundle hash is a trap.** A Pages **production** build bakes in `VITE_API_BASE_URL`, so its asset hash **differs from a PREVIEW build of the same commit**. Don't compare prod-hash vs preview-hash. Instead **content-check a known string** in the served JS (e.g. `Invoke-WebRequest` the `/assets/*.js` and grep for a literal you added). I burned ~20 min on a false "deploy stuck" alarm doing the wrong comparison.
- **Breaking auth deploys must be sequenced:** migration first → **frontend live** → worker last. Deploying the worker (hashing + 30-min access) while the old frontend is live = immediate logout + 30-min logout loop (old frontend can't silent-refresh).
- **`VITE_API_BASE_URL` gotcha persists:** D1 sync requires it baked into the Pages **production** build. Unset → silent `local_only` fallback. (Value: `https://hvac-api.c4tech.workers.dev`.)
- **Multi-account wrangler:** the OAuth login has 4 CF accounts. `wrangler` commands run from `workers/` pick up `account_id` from `wrangler.toml`; **`pages` commands run elsewhere need `CLOUDFLARE_ACCOUNT_ID=e923bf772f49580f54b7b5dc7910e32f`** or they error in non-interactive mode.
- **Satisfying the tenant-scoping guard:** add `AND org_id = ?` bound to `c.get('user').orgId` (never a client-supplied org). If a query is provably safe without it, add `// tenant-scope-ok: <reason>` above the `.prepare()`. New cross-tenant models go in `ALT_MODEL_FILES` in the guard.

---

## Key files (where the new stuff lives)

**New:**
- `workers/migrations/0011_refresh_tokens.sql` — rotating refresh-token store (hashed).
- `workers/src/utils/session.ts` — `mintTokenPair()`, `ACCESS_TTL_MS` (30 min), `REFRESH_TTL_MS` (14 d).
- `workers/scripts/check-tenant-scoping.mjs` — the isolation guard.

**Modified (auth):** `workers/src/utils/crypto.ts` (`hashToken`), `workers/src/routes/auth.ts` (mint sites + `/refresh` + logout/reset revocation), `workers/src/middleware/auth.ts` (hashed lookup), `frontend/src/lib/api.ts` (`refreshSession`, `setTokens`), `frontend/src/features/auth/store/useAuthStore.ts` (refresh-token persistence + `restoreSession` refresh-on-401).

**Modified (isolation):** `workers/src/routes/{projects,calculations,cad}.ts`, `.github/workflows/ci.yml`, `workers/package.json`.

**Modified (strict-TS/CAD):** `frontend/src/features/cad/**`, `frontend/src/pages/CadWorkspace.tsx`, `frontend/src/lib/api.ts`.

---

## Git / deploy record

- **PR #1** — `https://github.com/frickenclutch/hvac-design-pro/pull/1` — merged to `main`.
- Commits: `88bd53a` (security guard) · `b457e1a` (CAD types) · `fcf4f69` (auth) · merge `3be71a4`.
- Deploy sequence executed: migration 0011 → PR merge (frontend via Pages) → `wrangler deploy` worker → smoke test.
- Worker version: `b50752df-1ed2-49ae-a4ad-895719117844`.

---

## Roadmap position

- **P0** (credibility gaps): isolation guard ✅ · strict-TS (api.ts + CAD) ✅ · auth hashing + rotation + 30-min flip ✅ **and deployed**. Remaining P0 polish: OTP/MFA, the ~14 strict-TS tail, isolation integration tests.
- **P1** (moat): Manual S, permit-portal v2, AI plan intake — untouched, next major thrust.
- **ACCA cert:** still filed (2026-05-01), awaiting review; engine `manualJ8-ts-1.1.0` shadow-running, 184/184 + 43/43.

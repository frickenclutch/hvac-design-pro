# Release Runbook — Billing + Catalog + MFA + PE-Stamp Train

**Prepared:** 2026-06-17 (pre-flight verification session)
**Repo:** `frickenclutch/hvac-design-pro`
**Scope:** Ship the stacked release train — PRs #8, #9, #10, #11, #12 — on top of `main`
(which already has #7 billing-foundation / migration 0012 *merged in code*).

> **Who runs what:** Pre-flight (verification, conflict resolution, runbook) is done.
> **You** run the production steps below (PR merges, prod D1 migrations, the secret, `wrangler deploy`).

---

## Pre-flight result (done — all green)

Simulated the full merge train on a throwaway `integration-preflight` branch off `origin/main`
and ran the exact CI gate against the integrated tree:

| Check | Result |
|---|---|
| Merge #8→#9→#10→#11 | **clean** |
| Merge #12 (billing-activation) | **conflicted** in `workers/test/helpers/harness.ts` — **resolved** (additive: kept all three new helpers). See §A. |
| Worker `tsc --noEmit` | ✅ exit 0 |
| Tenant-scoping guard | ✅ 0 violations / 81 statements (new tables `subscriptions`, `payment_methods`, `usage_events`, `invoices`, `catalog_products` now in STRICT_TABLES) |
| Worker integration tests (`vitest`) | ✅ **81/81** |
| Frontend `tsc -b` | ✅ exit 0 |
| Frontend cert vitest | ✅ **67/67** (Smith/Walker/Cobb within 0.5%; +K2 ceiling-CLTD golden tests) |
| Migrations 0012/0013 idempotent | ✅ all `CREATE … IF NOT EXISTS` |
| Migration 0014 idempotent | ⚠️ **except** final `ALTER TABLE users ADD COLUMN mfa_enforced_at` — apply **once** (see §3) |
| New env/secrets required | **only `MFA_ENC_KEY`** (the new routes read just `c.env.DB`) |

The verified, fully-merged tree is at local branch **`integration-preflight`** (`8f62982`).

---

## ⚠️ The two ordering rules that prevent an outage

1. **`MFA_ENC_KEY` must be set as a secret BEFORE the worker deploys.**
   MFA is enforced *by role* (admin + L0). At first login post-deploy, an enforced-but-not-enrolled
   admin gets a **403 grace-enroll** (not a hard fail — good), but completing enrollment **503s if the
   key is unset** → that admin (including **you**, as L0) **cannot get a session**. Set the secret first.

2. **Frontend (with MFA pages) must be live BEFORE the worker enforces MFA.**
   The MFA enroll/challenge UI ships in #9 (`MfaEnrollPage`, `MfaChallengePage`). If the worker starts
   returning `202 mfaRequired` / `403 enrollmentRequired` while the *old* frontend is live, login dead-ends.
   Pages auto-deploys from `main` on merge; the worker deploys manually last — so the natural order works
   **as long as you wait for the Pages build to finish before `wrangler deploy`.** (Same lesson as the
   2026-06-02 auth-hashing deploy.)

**Net deploy order: merge → Pages auto-builds frontend → set `MFA_ENC_KEY` → apply migrations → `wrangler deploy` worker → smoke.**

---

## Step 0 — Establish the current prod baseline (don't skip)

The train was built "deploy-at-end," so prod may still be on the pre-billing worker / migration 0011.
Confirm before changing anything. Run from `workers/`:

```bash
# What migrations does prod D1 actually have? (look for billing/catalog/mfa tables)
wrangler d1 execute hvac-design-pro --remote --command \
  "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('subscriptions','catalog_products','mfa_credentials','plan_entitlements','invoices') ORDER BY name;"

# Is billing_status already on organisations? (it should be — historical out-of-band ALTER)
wrangler d1 execute hvac-design-pro --remote --command "PRAGMA table_info(organisations);"

# Currently deployed worker version
wrangler deployments list
```

- If the billing/catalog/mfa tables are **absent** → expected; you'll create them in §3.
- If **some already exist** (a partial earlier apply) → still fine: 0012/0013 are idempotent; for 0014 see the duplicate-column note.
- If `billing_status` is **missing** from `organisations` → tell me before proceeding (would indicate the out-of-band ALTER never actually landed; `platform.ts` queries it).

---

## Step 1 — Generate and set `MFA_ENC_KEY` (do this FIRST)

32-byte (64-hex-char) AES-256-GCM key, stored as a **Worker secret** (never in `wrangler.toml`).

```bash
# Generate a key (any of these):
#   PowerShell:  -join ((1..32) | % { '{0:x2}' -f (Get-Random -Max 256) })
#   openssl:     openssl rand -hex 32
#   node:        node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

cd workers
wrangler secret put MFA_ENC_KEY     # paste the 64-hex-char value when prompted
```

> Store the key in your password manager. If it's ever lost, **all enrolled TOTP secrets become
> undecryptable** and every MFA user must re-enroll. Do not rotate it casually.

---

## Step 2 — Merge the PRs to `main` (in order)

The stack: #9 is based on #8, #10 on #9; #11 and #12 are based on `main` directly.

**Recommended order:** **#11 → #8 → #9 → #10 → #12.**

```
#11 k2-ceiling-ctd      → base main      → clean
#8  catalog-foundation  → base main      → clean        (migration 0013)
#9  mfa-totp            → base #8→main   → clean         (migration 0014)   ← verify base retargets to main after #8 merges
#10 pe-stamp-packet     → base #9→main   → clean
#12 billing-activation  → base main      → CONFLICT in harness.ts → see §A
```

- After merging #8, GitHub auto-retargets #9's base to `main` (and #10's to `main` after #9). **Confirm each base is `main` before clicking merge.**
- **#12 will show a conflict** once #8/#9 are in `main`. Resolve per §A.

**Alternative (verified) path:** the local `integration-preflight` branch already *is* `main + #8 + #9 + #10 + #11 + #12` with the conflict resolved and the full gate green. If you'd rather skip the GitHub conflict UI, you can fast-forward `main` to it — but that collapses the per-PR merge history. I'd merge the PRs for the review trail and only fall back to this if the UI fights you. (Ask me and I'll push it.)

---

## Step 3 — Apply migrations to prod D1 (in order, after merge)

```bash
cd workers
wrangler d1 execute hvac-design-pro --remote --file=./migrations/0012_billing_foundation.sql
wrangler d1 execute hvac-design-pro --remote --file=./migrations/0013_product_catalog.sql
wrangler d1 execute hvac-design-pro --remote --file=./migrations/0014_mfa.sql
```

- **0012, 0013** — fully idempotent; safe even if a table already exists.
- **0014** — the final line is `ALTER TABLE users ADD COLUMN mfa_enforced_at TEXT`, which is **not**
  re-runnable. On a clean first apply it succeeds. If you ever re-run it and see
  **`duplicate column name: mfa_enforced_at`**, that's expected (already applied) — the `CREATE TABLE`s
  before it no-op'd; safe to ignore.

Verify:
```bash
wrangler d1 execute hvac-design-pro --remote --command \
  "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('subscriptions','payment_methods','usage_events','plan_entitlements','invoices','catalog_products','mfa_credentials','mfa_backup_codes','mfa_challenges') ORDER BY name;"
# expect 9 rows
```

---

## Step 4 — Confirm the frontend is live (Pages auto-deploy)

Pages rebuilds from `main` automatically on merge. Before deploying the worker:

```bash
# Wait for the latest Pages build to finish (Cloudflare dashboard → Pages → hvac-design-pro),
# then content-verify the served bundle actually contains the MFA UI:
curl -s https://hvac-design-pro.pages.dev/ | grep -o '/assets/[^"]*\.js' | head
# fetch one of those asset files and grep for a known MFA string, e.g.:
#   Invoke-WebRequest <asset-url> | Select-String 'mfaEnrollToken'
```

- **Do not** compare prod bundle hash vs a preview-build hash — a Pages *production* build bakes in
  `VITE_API_BASE_URL`, so hashes differ even for the same commit. Content-check a known string instead.
- Confirm `VITE_API_BASE_URL = https://hvac-api.c4tech.workers.dev` is still set in the Pages project
  env (unset → silent `local_only` fallback, D1 sync breaks).

---

## Step 5 — Deploy the worker (LAST, after secret + migrations + frontend)

```bash
cd workers
wrangler deploy
```

Confirms the `*/5 * * * *` permit-expire cron is preserved (it's in `wrangler.toml [triggers]`).

---

## Step 6 — Post-deploy smoke test

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://hvac-api.c4tech.workers.dev/health          # 200
curl -s -X POST https://hvac-api.c4tech.workers.dev/api/auth/refresh                          # 400 (missing token)
```

Then, authenticated as you (L0):
- Log in → expect **403 `enrollmentRequired`** with an `mfaEnrollToken` (MFA now enforced for your role).
- Walk the enroll flow in the UI → the enroll endpoint should **NOT** 503 (proves `MFA_ENC_KEY` is set).
  Scan the QR with an authenticator app, confirm the 6-digit code, **save the backup codes**.
- After enrollment, a fresh login should return **202 `mfaRequired`** → enter TOTP → session minted.
- Hit a catalog read (`GET /api/catalog/products`) and a billing read to confirm 0013/0012 tables resolve.

---

## Step 7 — You (and other admins) must enroll MFA

Every `admin` + L0 user is force-enrolled at next login. Have an authenticator app (Authy / Google
Authenticator / 1Password) ready **before** you start, and brief any other admins (Dan, etc.) that
they'll be prompted once. Non-admin roles are unaffected (optional MFA).

---

## Rollback

- **Worker:** `wrangler rollback` (or `wrangler deploy` a prior version) reverts API behavior instantly,
  including MFA enforcement. The migrations are **additive** — leaving the new tables in place is harmless
  (no existing query depends on them; gating is default-allow, MFA enforcement lives in worker code).
- **Frontend:** redeploy the prior Pages build from the dashboard.
- **MFA lockout safety valve:** if an admin is stuck, clear their enforcement/credential rows directly:
  `DELETE FROM mfa_credentials WHERE user_id = ?;` then they log in unenforced (or fix `MFA_ENC_KEY`).
- Do **not** drop the new tables on rollback unless you're certain — they hold no destructive coupling.

---

## §A — The #12 conflict resolution (reference)

Both the train and #12 appended new helpers to `workers/test/helpers/harness.ts` right after
`seedOrgOwnedRows`. The resolution is purely additive — **keep all three**:
`seedCatalogProducts` + the TOTP helpers (`totpNow`/`wrongTotp`, from the train) **and**
`seedPlanEntitlement` (from #12). The only real edit is the shared closing brace becoming two
(one closing `wrongTotp`, one closing `seedPlanEntitlement`). This is already done and verified on
`integration-preflight`; reproduce it in the GitHub conflict editor by keeping both sides' function
bodies and ensuring each function has its own `}`.

---

## Standing non-code items (not blockers for this deploy)

- **E&O insurance + terms** for the PE stamp before real permit packets go out.
- **AHRI / DSIRE data licensing** before wiring real catalog feeds.
- **Fast-follow `task_b8fc1bcf`:** audit-log the billing webhook projection once a real provider is wired.
- **K2 / Table 4D:** Dan transcribes the ceiling/roof CLTD cells (4 ceilings × CTD bins × daily-range) —
  pure data entry; the round-up lookup is ready. Until then the interim attributable-throw + TABLE-4D-GAP
  provenance ships (no CLTD values changed).

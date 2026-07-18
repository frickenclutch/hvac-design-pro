# Unit F — Consent-Chain Trust Architecture (Final Spec)

**Status:** Final synthesis, ready for ratification · **Date:** 2026-07-17
**Provenance:** Synthesis of three competing designs (security-first / friction-minimal / incremental-shippable). Base = the incremental-shippable design (winner, avg 8.2), with grafts from both runners-up and every judge-named fatal flaw engineered out. Verified against code: migrations top out at **0017** (next free: 0018); `org_invites.kind` CHECK added via ALTER in 0017 (widening requires the 0016-style rebuild); `verification_codes` purpose CHECK currently `('email_verification','password_reset','mfa_verification')`; `mfa_credentials.last_used_at` exists (0014).

**Founder directive (2026-07-16, verbatim):** "On Unit F the roles will be approved by each interested party involved with step up OTP verification for what would be considered higher connectivity. The chains all funnel back to the base user (me / c4 technologies) where we also have a tenant on the platform like a client would. Individuals will be pay gated for enhanced features and greater benefits and the ability to be absorbed by clients if they agree using the proper authentication measures. Dual account TOTP one on each side and then a 3rd neutral platform (me / c4technologies) potentially. Also we need to onboard Manual N in a suffice methodology that brings the platform more together and well rounded."

---

## 0. Design stance

**Interpretation anchors (accepted):** "higher connectivity" = actions that raise privilege or create cross-party linkage. "Chains funnel back to the base user" = L0/C4 is the root of trust and potential neutral third approver; C4 also operates an ordinary tenant. "Absorbed by clients" = the reparent/transfer flow, hardened and productized. "Suffice methodology" = pragmatic, not gold-plated.

**One flagged disagreement with the directive's letter:** strict dual-TOTP on absorption would deadlock the funnel today — TOTP enrollment is organic-only and near-zero outside Nathan (MFA bites only for `role='admin'` at fresh login; `/refresh` chains carry pre-MFA sessions indefinitely). This spec implements **dual step-up** — TOTP preferred, email-OTP fallback via `verification_codes` — with **per-kind policy floors** so any action kind can be tightened to TOTP-only later with zero schema change. L0 countersign is TOTP-only from day one. Decision D1.

**Two architectural commitments (the winner's core, ratified by all three judges):**

1. **Consent chains ride `org_invites` — one carrier, no parallel subsystem.** A chain *is* an invite row (`kind` widened) plus one child table `consent_approvals`. The reparent flow (0017) already proved the shape: admin-initiated row, target discovers it authed, accepts, commit executes. We generalize "accept" to "N required parties each approve." (Rejected: the dual-carrier `trust_proposals` + polymorphic ledger design — two state machines for one abstraction, judged a speculative-abstraction violation.)
2. **Step-up proof is verified inline, per request — no grant token, no ambient elevated state.** The sensitive request body carries `stepUp: { method, code }` and the endpoint verifies it before acting — the exact pattern `POST /api/auth/mfa/disable` already ships. No grant table, no TTL bookkeeping, no session-row stamp (verified fatal: session rows rotate every ≤30 min, so any `sessions.stepped_up_at` window dies mid-batch by construction). If batch ergonomics later demand a freshness window, it ships as a short-lived **grant table**, never a session-row stamp — deferred, not built (Decision D14).

**House rules honored throughout:** append-only `calculations`/`audit_log`; soft-deactivate only; session-derived org scoping (new cross-tenant tables get documented `check-tenant-scoping.mjs` waivers); all HTTP via `lib/api.ts`; Zustand; Tailwind; lazy-loaded routes; pure engines; clean self-contained units deployable mid-testing.

---

## 1. Higher-Connectivity Action Registry

"Higher connectivity" = raises privilege or creates cross-party linkage. Split into **chained** (multi-party consent) and **inline-step-up** (single party). Anything not listed requires no ceremony (login, calcs, project/CAD CRUD, uploads, non-admin invites, forum, feedback).

### 1.1 Chained actions (via `org_invites` + `consent_approvals`)

| # | Action | `kind` | Initiator (step-up) | Target consent (step-up) | L0 countersign | Commit executor |
|---|--------|--------|--------------------|--------------------------|----------------|-----------------|
| 1 | **Admin role grant** (promote member to `admin`) | `role_elevation` | Granting admin ✔ | Promoted user ✔ (accepts the MFA obligation + blast radius) | No | `UPDATE users SET role='admin'`; `computeRoleChangePlan` re-run at commit; **purge target's sessions + refresh tokens** so next login forces MFA enrollment (D10) |
| 2 | **Permit-authority seat** (`users.is_permit_authority=1`) | `authority_seat` | Org admin ✔ | Seated user ✔ | No — but org must already be **vetted** (#3) | `UPDATE users SET is_permit_authority=1`; audit |
| 3 | **Org authority declaration** (`organisations.authority_type`) — **fixes F-6** | `authority_vetting` | Tenant admin ✔ | — | **REQUIRED, TOTP-only** | Writes `authority_type` + `authority_vetted_at/by` (only the chain commit may write these) |
| 4 | **Absorption** (individual-tenant user pulled into client org) — **fixes F-12** | `absorption` | Absorbing org admin ✔ | The individual ✔ + explicit data acknowledgments (§5) | **Auto-required** if the individual's org is a vetted authority or holds any `is_permit_authority` user; otherwise optional/configurable (§4.1) | Reparent move (org_id flip, role set, sessions+refresh purged) + orphan stamps (§5.3) |

Directive compliance note: admin promotion **keeps the target-consent step** (two judges flagged notify-only promotion as a directive violation — "approved by each interested party" is explicit). Routine viewer/tech/engineer shuffles are deliberately NOT chained — multi-party ceremony on daily team management contradicts the platform's zero-friction-when-clean preflight doctrine.

### 1.2 Inline-step-up actions (no chain)

| Action | Actor | Notes |
|--------|-------|-------|
| MFA disable | Self | Already shipped; refactors onto the shared helper (F1) |
| Admin demotion / deactivation commit | Admin | Existing `computeRoleChangePlan` 409 flow unchanged; adds step-up. Reducing privilege never needs the loser's consent (a rogue account must not veto its own removal) |
| Authority-seat removal | Admin | `sole_permit_authority` block unchanged |
| Admin-role invite issuance (incl. subdivision first-admin seating) | Admin | Redemption *is* the target's consent; step-up at `POST /api/org/invites` when `invited_role='admin'` |
| Org `orgType` change | Admin | `orgType` **removed from the tenant-writable `PUT /api/org` whitelist**; a dedicated endpoint requires step-up + audits `org.type_changed`. Closes the pay-gating escape hatch. Inline step-up (not an L0 ceremony) is the shippable version — L0 sees it in audit and can revert (D15) |
| Permit **revoke / suspend** | Authority reviewer | Step-up on destructive post-decision actions. **Approve/deny/reinstate = no step-up by default** (daily reviewer flow); per-authority-org policy floor can opt into step-up-on-all-decisions (D13) |
| L0 plan flip / entitlement grant | L0 | §6.4; TOTP-only |
| L0 authority-vetting revoke | L0 | `authority.vetting_revoked` |
| L0 impersonation start | L0 | Later polish (Unit D); impersonation already read-only |

**Out of the API entirely:** `is_platform_admin` grants stay out-of-band D1-only, now *documented* as deliberate policy (Unit E). A self-service path to L0 is a bigger attack surface than the convenience is worth at one-L0 scale (D12).

---

## 2. Step-Up OTP Primitive

### 2.1 Module: `workers/src/utils/stepUp.ts`

```ts
export type StepUpMethod = 'totp' | 'backup' | 'email';
export interface StepUpProof { method: StepUpMethod; code: string; }

// Extracted from the /mfa/disable verification block (auth.ts ~1632-1658).
// Throws StepUpError → HTTP 403, NEVER 401.
export async function verifyStepUp(
  db: D1Database, env: Env, user: AuthUser, proof: StepUpProof,
  opts?: { totpOnly?: boolean }   // per-kind policy floor; L0 countersign always totpOnly
): Promise<{ method: StepUpMethod }>
```

- `totp`: confirmed `mfa_credentials` row → `decryptSecret` + `verifyTotp` (±1 step). **Replay guard:** the accepted 30s timestep is stored in a new `mfa_credentials.last_used_step INTEGER` column (added in 0018 — a proper column, not a counter stuffed into the `last_used_at` datetime); a code from the same step is rejected. Consequence: one TOTP-gated action per 30s — accepted and documented; backup codes and email codes carry no such cap and are the batch escape hatch (D14).
- `backup`: `consumeBackupCode` (single-use, rows-affected guard) — exists.
- `email`: `validateVerificationCode(db, userId, code, 'step_up')` — identity-anchored, single-use, 5-attempt cap, 5-min TTL. The **distinct purpose** prevents the recon-flagged collision: `createVerificationCode` invalidates prior unused codes per (user, purpose), so a step-up code can never clobber a concurrent login-MFA code.
- Rate limiting: existing `rate_limit_events`, identifier `mfa:<userId>`, `step_up_verify` 5/15 min, record-only-on-failure.
- Fail closed when `MFA_ENC_KEY` unset: `totp` unavailable (503 discipline preserved); `email`/`backup` still work.

### 2.2 Endpoints (authed, in auth routes)

- `POST /api/auth/step-up/email-code` — dispatches a `purpose='step_up'` code to the session user via the existing `createVerificationCode` + Resend + `waitUntil` pipeline. Rate-limited (`step_up_email_send`, 3/10 min). Audit `auth.step_up.email_code_sent`.
- `GET /api/auth/step-up/methods` — `{ methods, enrolled }` derived from `mfa_credentials`; drives the dialog.

### 2.3 Proof semantics (no token, by design)

| Factor | Shape | TTL | Single-use mechanism |
|--------|-------|-----|----------------------|
| TOTP | 6-digit RFC-6238, ±1 step | 30s window | `last_used_step` compare (new) |
| Backup code | `ABCDE-FGHIJ`, PBKDF2-hashed | none | `used_at` + rows-affected guard (exists) |
| Email OTP | 6-digit, `verification_codes` purpose `'step_up'` | 5 min | `used_at` + attempts cap (exists) |

No ambient elevated state to steal or replay; no grant table to purge; each approval in a chain independently re-proves. Impersonation sessions (`is_impersonation=1`) can never satisfy step-up — asserted in `verifyStepUp` and structurally enforced by the existing read-only mutation choke point; F3 adds an explicit regression test.

### 2.4 Graceful non-enrolled path

`email` is always offered unless the action's floor says `totpOnly`. Every successful email-method step-up response carries `{ nudge: 'totp_enroll' }`; the dialog renders "Set up an authenticator for faster approvals" → Settings → MFA. Converts the enrollment gap into an enrollment funnel instead of a wall.

### 2.5 The 401 footgun — fixed in the same unit (load-bearing, all three judges)

`lib/api.ts` gives `/api/auth/mfa/*` silent-refresh semantics: a 401 triggers refresh-and-retry, a second 401 calls `sessionExpired()` → **full logout on a mistyped code**. Unit F1 therefore: (a) all step-up/consent endpoints return **400/403, never 401**, for factor failures; (b) the two existing offenders — `/mfa/confirm` and `/mfa/disable` wrong-code 401s — change to 403 (a standalone bugfix that ships value even if nothing else in Unit F does); (c) a regression test asserts no step-up path returns 401.

### 2.6 Frontend: one dialog, one interceptor (graft from friction-minimal design)

`frontend/src/components/StepUpDialog.tsx` — modeled on SettingsPage `MfaSection` authed code-entry + `MfaChallengePage` 3-method switcher: `actionLabel`, TOTP input (`autoComplete="one-time-code"`), backup-code toggle, "Email me a code" with resend cooldown, inline 403 error handling (no logout), enrollment nudge. Tailwind, 44px targets, lazy-loaded.

`lib/api.ts` gains a **registered 403 `step_up_required` interceptor**: any gated endpoint may respond `403 { code:'step_up_required', methods, totpOnly }` → the dialog opens, collects the proof, and the interceptor **re-sends the original request with the original body plus `stepUp` attached**. Mounted once in `App.tsx` — zero per-surface plumbing. Harness tests cover interceptor stacking with silent-refresh (no retry loops).

### 2.7 Housekeeping

Extend the existing cron `scheduled` handler (currently the permits sweep) to purge expired/used `verification_codes` rows >24h past expiry (graft — the winner omitted housekeeping).

### 2.8 Audit

`auth.step_up.email_code_sent`, `auth.step_up.verified`, `auth.step_up.failed` — detail always includes `{ action, chainId?, method }`.

---

## 3. Consent-Chain Core

### 3.1 Migration 0019 — `org_invites` rebuild + `consent_approvals`

Rebuild `org_invites` (0016 pattern; **copy-over must preserve live pending invite tokens — a test asserts a pre-rebuild pending invite still redeems post-rebuild**):

- `kind` CHECK widened: `('new_user','reparent','role_elevation','authority_seat','authority_vetting','absorption')` — absorption gets its own kind value; overloading `reparent` with derived sub-states was judged a semantic trap.
- `status` CHECK widened: `('pending','accepted','revoked','expired','declined','blocked')`
- New nullable columns: `target_user_id TEXT REFERENCES users(id)` (chains bind existing users by id; email matching stays as the reparent-compatible fallback), `counterparty_org_id TEXT REFERENCES organisations(id)`, `requires_platform INTEGER NOT NULL DEFAULT 0`, `payload TEXT` (immutable JSON: kind-specific parameters, consequence-plan snapshot, acknowledgment strings, blocker list when `blocked`).

```sql
CREATE TABLE IF NOT EXISTS consent_approvals (
  id           TEXT PRIMARY KEY,
  invite_id    TEXT NOT NULL REFERENCES org_invites(id) ON DELETE CASCADE,
  party        TEXT NOT NULL CHECK (party IN ('initiator','target','counterparty_admin','platform')),
  required     INTEGER NOT NULL DEFAULT 1,
  user_id      TEXT REFERENCES users(id),      -- filled on approval
  org_id       TEXT,                            -- approver's org at approval time
  method       TEXT CHECK (method IN ('totp','backup','email')),
  payload_hash TEXT,                            -- SHA-256 of org_invites.payload at approval time
  approved_at  TEXT,
  declined_at  TEXT,
  note         TEXT,                            -- acknowledgments / conflict-of-interest stamp
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (invite_id, party)
);
CREATE INDEX IF NOT EXISTS idx_consent_approvals_invite ON consent_approvals(invite_id);
```

**Payload binding — "what you see is what you sign" (graft, lightweight):** `payload` is frozen at proposal. Each approval stores `payload_hash = SHA-256(payload)` **directly on the approval row** (never by FK into a purgeable table — the FK-into-`mfa_challenges` design was judged fatal: D1 doesn't enforce FKs and the purge cron would silently orphan the provenance trail). At commit, the guard re-hashes `payload` and requires equality with every approval's `payload_hash` — any tamper voids all consents. Proof method + timestamp live on the row itself; the trail survives every purge.

Seeding: proposal creation inserts one row per required party; the initiator's row is satisfied immediately (their step-up rode the create request). Legacy `new_user`/`reparent` rows get no approval rows — untouched. `counterparty_admin` is reserved for future org↔org actions; nothing seeds it in v1.

Tenant scoping: `org_invites`/`consent_approvals` join the acknowledged party-gated cross-tenant exceptions in `check-tenant-scoping.mjs` docs (Unit E); every query binds session-derived `user.id`/`user.email`/`user.orgId` — never client-supplied ids.

### 3.2 State machine

```
            ┌──────────► declined   (any required party declines; terminal)
            │
 pending ───┼──────────► revoked    (initiator-org admin or L0, pre-commit; terminal)
            │
            ├──────────► expired    (TTL 7 days; cron sweep; terminal)
            │
            └─ all required approvals present + payload_hash equality
                       │
                       ▼
              [commit guard: computeRoleChangePlan / computeAbsorptionPlan]
                       │
            ┌── clear ─┴─ blocked ──► status='blocked' (blockers → payload;
            ▼                          approvals PRESERVED; any party may
        accepted                       POST /:id/commit to retry after
        (committed; terminal)          resolving; TTL still applies)
```

- **Commit rides the final approval request** — no separate two-phase call in the happy path. The guard re-runs *at commit time* (state may have changed since proposal) — the `computeRoleChangePlan` discipline: preflight advisory, commit guard authoritative, hand-rolled API calls can't bypass.
- `blocked` preserves collected approvals; retry via `/:id/commit` re-runs the guard without re-collecting consents (TTL bounds staleness).
- Expiry: extend the existing cron with a consent sweep → `expired` + audit `consent.expired`. No new cron.
- Races: status-guarded single-row UPDATEs (`WHERE status='pending'`, rows-affected checks — the `consumeChallenge` discipline).

### 3.3 Endpoints (`workers/src/routes/consents.ts`, mounted `/api/consents` behind auth + audit middleware)

| Endpoint | Who | Behavior |
|----------|-----|----------|
| `POST /api/consents` | Org admin (+ step-up) | `{ kind, targetUserId?/targetEmail?, payload }`. Kind-specific precondition checks (absorption: capability §6 + sole-member individual target org; authority_vetting: not already vetted). Computes consequence preview, freezes `payload`, seeds approvals. Audit `consent.proposed`. |
| `GET /api/consents?box=inbox\|outbox` | Any member | `inbox`: chains where the session user is an unresolved party (platform box for L0). `outbox`: chains initiated by my org (admin-visible). |
| `GET /api/consents/:id` | Party-gated | Approval matrix, consequence preview, blocker list. |
| `POST /api/consents/:id/approve` | The pending party (+ step-up) | `{ stepUp, acknowledgments? }`. Resolves the party row, `verifyStepUp`, records method/user/timestamp/`payload_hash`/acks. Last required approval → commit guard → execute or `blocked`. Audit `consent.approved` (`consent.countersigned` for platform) + `consent.committed`/`consent.blocked`. |
| `POST /api/consents/:id/decline` | Any required party | Terminal; no step-up (declining is privilege-reducing). Audit `consent.declined`. |
| `POST /api/consents/:id/revoke` | Initiator-org admin or L0 | Pre-commit only. Audit `consent.revoked`. |
| `POST /api/consents/:id/commit` | Any party or L0 | Retry from `blocked`; re-runs guard; approvals persist. |
| `GET /api/platform/consents` | L0 | Countersign queue (AdminPage). Same `/approve` endpoint; server enforces `totpOnly` for `party='platform'`. **Reads audited** (Unit B). |

Reparent transition: today's `GET /api/auth/transfers` + accept keeps serving `kind='reparent'` untouched until Unit F4 flips *initiation* to `kind='absorption'`; in-flight reparent rows drain via TTL. No dual-write, no data migration.

---

## 4. Root of Trust — C4 / L0

### 4.1 Where L0 countersign is REQUIRED vs configurable

| Scope | Rule |
|-------|------|
| `authority_vetting` | **Always required, TOTP-only.** This is the F-6 fix: `authority_type` stops being self-declared; a tenant's declaration is a *request* until C4 countersigns. |
| `absorption` | **Auto-required** when the individual's org is a vetted authority or holds any `is_permit_authority` user (permit trust crosses tenant lines). Otherwise **optional**: either org can request platform oversight via org `settings.consentPlatformCountersign: 'never'|'absorption'|'all'` (rides the existing settings JSON — zero migration), and L0 can force `requires_platform=1` on any pending chain. This conditional trigger operationalizes the directive's "potentially" better than a global ON/OFF. |
| `role_elevation`, `authority_seat` | Never (in-tenant; dual consent + continuity engine suffice). |

### 4.2 C4's ordinary tenant vs L0 role — separation invariants

1. **Power rides the user, not the org.** L0 is `users.is_platform_admin`; C4's org row is an ordinary tenant with no special code path. Grep-invariant (Unit E): no code path derives platform privilege from org membership.
2. **No countersigning through impersonation** — structurally enforced (mutations blocked at the `index.ts` choke point) + explicit assertion and test in F3.
3. **Conflict-of-interest stamping:** when a chain's initiator or counterparty org equals the L0 approver's own `org_id`, the platform approval records `note='conflict_of_interest'` and the audit row carries `conflictOfInterest: true`. With a sole L0 we cannot require a second approver; we make the conflict loudly and permanently visible instead (D6).
4. **L0 reads of consent chains are audited** — folded into Unit B so the queue never ships unaudited.
5. **L0 is not exempt from continuity** — commit guards bind L0 exactly as tenant admins (existing doctrine, unchanged). L0 may decline/revoke any chain but never supplies a missing party approval — approvals are conjunctive.

### 4.3 Authority vetting (migration 0020 + Unit F3)

```sql
ALTER TABLE organisations ADD COLUMN authority_requested_at TEXT;
ALTER TABLE organisations ADD COLUMN authority_vetted_at TEXT;
ALTER TABLE organisations ADD COLUMN authority_vetted_by TEXT REFERENCES users(id);
-- Grandfather (D5): keep the live permit rail working mid-testing.
UPDATE organisations SET authority_vetted_at = datetime('now')
 WHERE authority_type IS NOT NULL AND authority_vetted_at IS NULL;
```

- **Grandfather, not pending-backfill** (judge-consensus): backfilling live authority orgs to `pending` with a manual same-day L0 sweep as the only thing keeping permits alive would break production mid-testing if the runbook slips. Grandfathered orgs (believed to be Nathan's test orgs only) are stamped `authority_vetted_by = NULL` + audit note `grandfathered-0020` and are **immediately revocable from AdminPage** post-deploy.
- Enforcement: permit-submission intake and the authority side of `isParty()` require `authority_type IS NOT NULL AND authority_vetted_at IS NOT NULL`. `authority_type` is removed from every tenant-writable whitelist; only the `authority_vetting` chain commit writes it.
- **Material-change re-vet (graft):** changing `authority_type` or jurisdiction from a vetted state clears `authority_vetted_at` and opens a new vetting chain (permit powers pause, surfaced clearly in UI); editing intake notes/contact email does **not** re-vet — friction calibration.
- L0 revoke: `POST /api/platform/orgs/:id/authority/revoke` (TOTP step-up, audit `authority.vetting_revoked`) nulls `authority_vetted_at`, preserving the declaration for history.
- State machine: `none → requested → vetted` | `rejected (→ editable → requested)`; material edit from `vetted` → `requested`.

---

## 5. Absorption Protocol (evolves reparent; fixes F-12)

### 5.1 Flow

1. **Propose** — absorbing admin: `POST /api/consents { kind:'absorption', targetEmail, payload:{ invitedRole } }` + step-up. Preconditions: capability gate (§6), target exists, target's org is a sole-member `individual` org. Server runs `computeAbsorptionPlan` and snapshots it into `payload`.
2. **Individual consents** — sees the chain in the "Transfers & absorption" surface, reviews the consequence preview, ticks **explicit acknowledgments** (recorded on their approval row — the durable "they knew" artifact), steps up (TOTP preferred, email fallback per D1), approves.
3. **Platform countersign** if required (§4.1) — Nathan, AdminPage queue, TOTP-only.
4. **Commit** (rides final approval): guard + payload-hash equality re-run → `org_id` flips, role = `invitedRole`, **sessions + refresh tokens purged** (existing reparent behavior; if `invitedRole='admin'`, next login forces MFA enrollment), orphan org stamped (§5.3), `recordUsageEvent(payerOrg,'absorption',1,{sourceRef: chainId})`, audit `consent.committed` with orphan counts + acknowledgments.

### 5.2 `computeAbsorptionPlan` — extends the continuity engine

New function in `workers/src/utils/roleChange.ts`, reusing the exact `RoleChangeBlocker` vocabulary and advisory-preflight/authoritative-commit-guard discipline:

| Code | Severity | Meaning |
|------|----------|---------|
| `open_permit_submissions` | **block** (upgraded from warn) | Individual's org is submitter on active-state submissions (`submitted`/`under_review`/`suspended`). **The F-12 fix by prevention:** permits can never strand in an orphan org — withdraw, complete, or expire first. Preflight surfaces the cure legibly. |
| `sole_permit_authority` | **block** | Reused as-is: individual org is a vetted authority and this user its only seat. |
| `orphaned_projects` | warn + **required acknowledgment** | N projects, M calc records, K uploads remain (counts shown). |
| `orphaned_org` | warn + **required acknowledgment** | Org becomes a memberless labeled shell; historical permit/audit records remain under it. |

Advisory endpoint `POST /api/org/users/absorption/preflight` mirrors the role-change preflight.

### 5.3 Data policy: v1 = acknowledged orphan; v2 = optional carry (held)

**v1 (ships in F4):** data **stays** in the individual org — but never silently: (a) open permits hard-block; (b) orphaning requires recorded acknowledgment; (c) the shell is machine-labeled (migration 0021):

```sql
ALTER TABLE organisations ADD COLUMN absorbed_into_org_id TEXT REFERENCES organisations(id);
ALTER TABLE organisations ADD COLUMN absorbed_at TEXT;
```

**Why not carry in v1 (judge-consensus fatal in both other designs):** bulk `org_id` UPDATE of `calculations` rows violates the append-only house rule on the happy path and forces tenant-scoping waivers into v1. **v2 "carry projects" (held, not scheduled, D2):** projects/CAD/uploads `org_id`-updated; calculations **re-appended** as new records with `sourceRef` provenance (append-compliant); the move backed by an **`absorption_transfers` manifest** (per-table counts + id lists + hashes, dual-org audit rows — graft from the security-first design, the right audit backbone for any future data move); orphan shell then archival-eligible. Historical `permit_submissions` never move under any policy — `submitter_org_id` is an explicit historical capture, like an invoice.

### 5.4 Payer — default: **individual-pays** (D3)

The directive is explicit: "Individuals will be pay gated for … the ability to be absorbed." The gate checks `checkCapability(individualOrg,'absorption')`. Two designs recommended either-side-pays as revenue-pragmatic; a judge flagged silently inverting the founder's stated monetization as fatal — so **either-side is presented strictly as a flagged alternative** (one-line OR-check change, D3), not adopted by default. Metering records against the paying org.

---

## 6. Pay Gating (entitlements)

### 6.1 `checkCapability` — default-DENY, fail-CLOSED

`checkEntitlement` is default-ALLOW (usage-cap polarity) — wrong for paid capabilities. Add beside it in `workers/src/billing/usage.ts`:

```ts
// Absence of a row = DENY. Org row beats plan row (same resolution query).
// A row allows unless enforcement='block'. FAIL-CLOSED on D1 error —
// deliberate inversion of calc_run's fail-open: denial is retryable UX,
// silent free access is not. Document BOTH polarities at the definition site.
export async function checkCapability(db, orgId, key): Promise<CapabilityDecision>
```

### 6.2 Capability keys (free-text `meter_key` — zero DDL)

| Key | Checked where | Semantics |
|-----|---------------|-----------|
| `absorption` | `POST /api/consents` (kind=absorption) at proposal AND re-checked at commit | Individual-pays default (D3); metered via `usage_events` on commit |
| `ai_blueprint_extract` | `POST /api/ai/blueprint-extract` | Currently live and ungated; capability + per-run metering |
| `manual_n` | Manual N route + `POST /api/calculations` when `calc_type='MANUAL_N'` | Ships with track G — the new standard is itself a pay-gated "enhanced feature" for individuals, serving both directive clauses at once |

### 6.3 Seeds — migration 0022 (data-only)

Plan-wide rows (`org_id='*'`, `scope_kind='plan'`): `professional`/`enterprise` get allow rows (`enforcement='meter'`) for all three keys; `starter` gets **explicit block rows** (`enforcement='block'`, `hard_cap=0`, `period='lifetime'`) — belt-and-suspenders self-documentation of the deny polarity against a future author misreading it. Per-org overrides (a comped individual, a pilot) are one org-scoped row. Individual enhanced tier reuses the `professional` plan string (D4) — a dedicated `individual_pro` tier later is pure seed rows.

### 6.4 Plan operations (closes the out-of-band gaps)

- `POST /api/platform/orgs/:id/plan { plan, billingStatus? }` — L0 + TOTP step-up; writes `organisations.plan` (the field the checks actually read); audit `billing.plan.changed` with before/after. Kills invisible `wrangler d1 execute` plan flips.
- Payment collection stays manual (no live creds — hard constraint). When Stripe wires up, its webhook projection calls the same plan-flip internals.
- Frontend: `/api/auth/me` + `useAuthStore.Organisation` gain `plan`; dedicated upgrade-prompt dialog for 402 `entitlement_exceeded` / 403 `capability_denied` (today: generic toast).
- Pricing-boundary hardening: `orgType` off the tenant whitelist + step-up + audit (§1.2). Seat-count enforcement stays explicitly out of scope.

---

## 7. Unit-F Residuals — ratified defaults

### F-16: Role charter (sets Unit A's thresholds; resolves code-vs-docs in favor of the code)

| Role | Charter | Can | Cannot |
|------|---------|-----|--------|
| `viewer` | External stakeholder (client, GC, inspector guest) | View projects/calcs/reports; download PDFs | Create/update anything; run calcs; upload; any permit action; see roster |
| `tech` | Field operative | + create/update projects & CAD; run calcs; **uploads**; trigger reports | Permit submission; equipment confirmation; team mgmt |
| `engineer` | Design authority | + **permit submission**; equipment confirmation | Delete projects; team/org/billing mgmt |
| `admin` | Org steward | + team mgmt, org settings, billing, destructive ops, chain initiation | — |

**Unit A thresholds derived:** uploads → `tech+`; permit submission → `engineer+` (fixes F-2); permit decisions → `engineer+` with `is_permit_authority` on a **vetted** org; project/CAD create-update stays `tech+` (never take capability away from field users; docs matrix corrected in Unit E).

### F-5: Reviewer visibility — masked during review, named on decision

Submitters see the authority **org** name + a stable anonymized handle ("Reviewer 1") while a submission is in review; on terminal decision events (approve/deny/revoke — the legally weighted artifacts) the reviewer is named permanently. Merges the two runners-up: harassment protection mid-review, accountability where the legal weight lands. **Enforced server-side** (graft): submitter-facing responses never include `reviewer_user_id` — only a computed `reviewerDisplay` string; never ship-and-hide client-side. Full identity always in `audit_log` and to the authority org's own members. Per-authority-org opt-in to always-named via existing settings JSON. Applied in Unit C.

### F-15: Roster visibility — `tech+`

Roster (names, roles, authority badges, emails) visible to `tech` and above; **viewers see no roster** — they are external stakeholders per the charter, and showing a client the firm's staff list is a leak, not a feature. Invite/role controls remain admin. Per-tenant override via the existing access-policy surface.

---

## 8. Step-Up UX per surface

| Surface | Trigger | Flow |
|---------|---------|------|
| TeamPage role dropdown → `admin` | Chain create | Existing preflight checklist → StepUpDialog (via interceptor) → `POST /api/consents` → "Waiting for {name} to accept" chip on the member row |
| TeamPage demote/deactivate | Inline | Existing 409-checklist flow + step-up on commit |
| TeamPage authority-seat toggle | Chain create / inline remove | Disabled with tooltip if org not vetted |
| SettingsPage "Become a permit authority" | Chain create | Declaration wizard → step-up → "Pending C4 verification" badge until countersigned |
| Transfers & absorption inbox (target) | Approve | Consequence preview → required acknowledgment checkboxes → step-up → approve |
| AdminPage (L0) | Countersign queue, plan flip, authority revoke | Queue drawer per chain; dialog forced TOTP-only; conflict-of-interest banner when C4's own tenant is a party |
| Org settings orgType change | Inline | Step-up on save |
| PermitsPage | revoke/suspend | Step-up; approve/deny untouched (D13) |
| Consent visibility | — | Inbox section on TeamPage + dashboard card badge (`GET /api/consents?box=inbox` count) |

---

## 9. Audit event registry

Via existing `setAudit`/`writeAuthAudit` + auto `auditMiddleware`; entityType `org_invite`, entityId = chain id.

- **Consent:** `consent.proposed`, `consent.approved`, `consent.countersigned` (carries `conflictOfInterest` when applicable), `consent.declined`, `consent.revoked`, `consent.expired`, `consent.blocked` (blockers in detail), `consent.committed` (kind-specific detail: role granted / authority set / orphan counts + acknowledgments)
- **Step-up:** `auth.step_up.email_code_sent`, `auth.step_up.verified`, `auth.step_up.failed`
- **Authority:** `authority.vetting_revoked` (grant = `consent.committed` on the vetting chain)
- **Billing:** `billing.plan.changed`, `billing.entitlement.granted`/`.revoked` (when L0 entitlement CRUD ships; until then seeds are migration-borne, hence in-repo)
- **Org:** `org.type_changed`
- Cross-party events (absorption, vetting) write to **both** orgs' audit timelines. Existing continuity audits unchanged; L0 consent-queue reads audited per Unit B.

---

## 10. Manual N onboarding (suffice methodology — parallel track G)

Decoupled from the consent units. "Suffice" = Manual N 5th-ed procedures via the proven manualJ8 playbook — no calc-service revival, no RTSM/HBM, no zone-hourly simulation.

- **G0 — honesty stamp + seam (ships immediately, before any engine):** migration 0023 rebuilds `calculations` widening `calc_type` CHECK to add `'MANUAL_N'` **and** adding **`grade TEXT CHECK (grade IN ('permit','budget'))`** (NULL = permit-grade legacy) in the same rebuild — a real, queryable column (graft; judges rejected the `outputs.__grade` JSON variant as unenforceable). Commercial blueprint-intake calcs are stamped `budget` at persist time; PDF/report footers render the stamp. **Grade interlock (graft):** the engineer+ permit-submission gate (Unit A) refuses attachments whose governing calc is `grade='budget'` — the "commercial = budget estimate" banner becomes machine-enforced, not copy. Closes the legal-exposure gap where a commercial budget estimate is indistinguishable in D1 from a permit-grade record.
- **G1 — engine skeleton:** `frontend/src/engines/manualN/` cloned from manualJ8's anatomy (tables/ tuple-expander registry with `sourcePage` provenance, throw-attributable lookups, worksheets/, single aggregator, `MANUAL_N_ENGINE_VERSION='manualN-ts-0.1.0'`, `__tests__/` auto-discovered by vitest — zero CI changes). Zone model (Manual N is zone-level; nearest analog is the AED 12-hour profile logic), commercial occupancy/internal-load tables (people density, W/ft², ASHRAE 62.1 vent rates), `ashraeWeather.ts` extended in place with real coincident wet-bulb + solar fields (the current `cool1-15` fabrication is disqualifying for ventilation-dominated commercial loads).
- **G2 — intake routing + telemetry:** `buildingType='commercial'` routes confirmed spaces to Manual N intake; reuse the shadow-run failure-cause telemetry pattern (throw-attributable lookups + `-fail` marker records + qa-benchmarks bucketing) to discover which table cells real projects demand *before* transcribing the whole book — the exact mechanism that found the Table 4D gaps.
- **G3 — cert + flip:** Manual N 5th-ed worked-example fixtures in `__tests__/`; display flip gated on fixtures green. **Blocker to start now: source a Manual N 5th-ed book** (Dan holds Manual J only — D11).
- **Pay gate:** `manual_n` capability rides F5. Bridges (`cadToManualN`, `manualNToManualD` — Manual D already accepts `application:'commercial'`) land with G1/G2.

---

## 11. Migrations (D1/SQLite; migration-first deploy order D1 → worker → Pages)

| # | File | Contents |
|---|------|----------|
| 0018 | `0018_step_up.sql` | Rebuild `verification_codes` (0016 pattern) widening purpose CHECK to add `'step_up'`; copy-over preserves in-flight codes. `ALTER TABLE mfa_credentials ADD COLUMN last_used_step INTEGER` (TOTP replay guard). |
| 0019 | `0019_consent_chains.sql` | Rebuild `org_invites`: kind CHECK + (`role_elevation`,`authority_seat`,`authority_vetting`,`absorption`); status CHECK + (`declined`,`blocked`); nullable cols `target_user_id`, `counterparty_org_id`, `requires_platform` (DEFAULT 0), `payload`. New `consent_approvals` (incl. `payload_hash`) + index. **Test: pre-rebuild pending invite still redeems.** |
| 0020 | `0020_authority_vetting.sql` | `ALTER organisations ADD authority_requested_at, authority_vetted_at, authority_vetted_by REFERENCES users(id)`; grandfather UPDATE seeding `vetted_at` for existing `authority_type` orgs (audit note `grandfathered-0020`; immediately revocable). |
| 0021 | `0021_absorption_stamp.sql` | `ALTER organisations ADD absorbed_into_org_id REFERENCES organisations(id), absorbed_at`. |
| 0022 | `0022_entitlement_seeds.sql` | Data-only: plan-wide `plan_entitlements` allow rows (professional/enterprise) + explicit starter block rows for `absorption`, `ai_blueprint_extract`, `manual_n`. |
| 0023 | `0023_manual_n_grade.sql` | Rebuild `calculations`: calc_type CHECK + `'MANUAL_N'` AND new `grade TEXT CHECK ('permit','budget')` NULL in one rebuild. **Largest table — quiet window + row-count verification.** Can ship any time (G0). |

All rebuilds follow the 0016 precedent (D1 enforces CHECKs; the 2026-07-06 prod incident is the cautionary tale) — Miniflare rehearsal against real-shape data before deploy.

---

## 12. Rollout plan — ordered units, sequenced with A–E

Every unit: independently deployable mid-testing, non-breaking for users who don't touch the new surface, tests on existing harnesses (`mfa.test.ts` + `totpNow`, `billing-activation.test.ts` + `seedPlanEntitlement`, consequence-engine tests), worker+frontend `tsc` + vitest + tenant-scoping guard green.

| # | Unit | Contents | Depends on |
|---|------|----------|-----------|
| 1 | **Unit A** (existing) | Role-gate uploads (`tech+`), permit submission (`engineer+`), verify-email — thresholds fixed by the F-16 ratification in this document (no F code needed) | F-16 ratified |
| 2 | **Unit F1 — Step-up primitive** | Migration 0018; `utils/stepUp.ts`; `/step-up/email-code` + `/methods`; StepUpDialog + `lib/api.ts` 403 interceptor with auto-retry; `/mfa/confirm` + `/mfa/disable` 401→403 fix + regression test (standalone bugfix: stops logout-on-typo); TOTP replay guard; cron purge of expired codes | — |
| 3 | **Unit B** (existing) | Audit integrity incl. unaudited L0 reads (also covers the coming consent queue) | — |
| 4 | **Unit F2 — Consent-chain core** | Migration 0019; `/api/consents` routes + state machine + cron expiry; `role_elevation` live (admin grants dual-consented, payload-hash bound); session purge on promotion commit (D10); step-up on admin-invite issuance / subdivision admin seating / demotion + deactivation commits; TeamPage wiring; scoping-guard exception docs | F1 |
| 5 | **Unit F3 — Authority vetting (closes F-6)** | Migration 0020 + grandfather; `authority_vetting` kind with required TOTP-only L0 countersign; material-change re-vet; `authority_type` off tenant whitelists; vetted enforcement in permit intake + `isParty()`; AdminPage queue; L0 revoke endpoint; impersonation-cannot-countersign test | F2 |
| 6 | **Unit C** (existing) + F-5 + permit step-up | Permit lifecycle fixes; server-side reviewer masking (`reviewerDisplay`, named-on-decision); step-up on revoke/suspend | F3 |
| 7 | **Unit F4 — Absorption v2 (fixes F-12)** | `absorption` kind; `computeAbsorptionPlan` (open-permit BLOCK + acknowledgment artifacts); migration 0021 orphan stamps; Transfers & absorption UI; dual step-up + conditional auto/optional platform countersign; retires reparent initiation (accept path drains via TTL) | F2 (F3 for the authority auto-escalation rule) |
| 8 | **Unit F5 — Pay-gating activation** | `checkCapability` (default-deny, fail-closed); migration 0022 seeds; L0 plan endpoint + `billing.plan.changed`; `/me` plan field + upgrade-prompt UX; gates on `absorption` (individual-pays default) + `ai_blueprint_extract`; orgType whitelist removal + step-up | F1 (F4 for the absorption gate to bite) |
| 9 | **Unit D** (existing) | UX alignment + consent inbox polish + dashboard pending-approvals card + L0-drawer checklist fast-follow + L0 impersonation step-up | — |
| 10 | **Unit E** (existing) | Consistency sweep: corrected F-16 matrix docs; tenant-scoping exception docs; `is_platform_admin` out-of-band policy documented; **grep-invariants**: no platform privilege derived from org membership, impersonation excluded from every approval/step-up path, 403-never-401 on factor failures, no commit path trusts chain status over the commit guard | — |
| G | **Track G — Manual N** (parallel) | G0 (migration 0023 + grade stamp + permit-gate budget refusal) **any time, start now**; G1 engine skeleton; G2 intake + telemetry; G3 cert fixtures + flip; `manual_n` gate rides F5 | G0: none |

Sequencing rationale: F1 before F2 (chains need step-up); F3 before C (permit fixes land on vetted authorities); F4 before F5's absorption gate (a gate needs something to gate); A first because it's already scoped and only awaited the F-16 ratification this document provides; G0 immediately because the honesty stamp closes a legal-exposure gap with near-zero code.

---

## 13. Risks

1. **Table-rebuild migrations on live D1** (0018, 0019, 0023): 0016-precedent pattern; 0019 must preserve in-flight invite tokens (pre/post redemption test); 0023 rebuilds the largest table — quiet window + row-count verification. Miniflare rehearsal for all three.
2. **Email-OTP fallback weakens "dual TOTP":** a compromised mailbox satisfies step-up for non-enrolled users. Bounded by 5-min TTL, attempt caps, rate limits, per-kind TOTP floors (L0 always TOTP-only), audit visibility, and the enrollment-nudge funnel. Residual risk accepted explicitly under D1; the individual-pays default (D3) means the paid-absorbability flow can additionally require enrollment later without schema change.
3. **TOTP one-action-per-30s replay cap:** accepted batch friction; backup/email codes are the escape; a short-lived grant-table freshness window is the documented later upgrade (never a session-row stamp — rotation kills those) (D14).
4. **Consent liveness:** unresponsive parties and stale `blocked` chains → 7-day TTL + revoke; approve/revoke races → status-guarded single-row UPDATEs.
5. **Fail-closed `checkCapability`** can deny paying users on transient D1 errors — deliberate inversion of `calc_run`'s fail-open; retryable UX beats silent free access; both polarities documented at the definition site so future gate authors don't copy the wrong template.
6. **Grandfathered authority orgs** ship F-6 with legacy authorities un-vetted at t0 — one-time, audited, immediately revocable from AdminPage; the alternative (pending-backfill + manual sweep) risks breaking the live permit rail mid-testing.
7. **Sole-L0 conflict of interest** on chains touching C4's own tenant: stamped and surfaced, not prevented — structural fix needs a second L0 human, out of scope.
8. **`lib/api.ts` interceptor stacking** (silent-refresh + step-up retry on one request): harness tests required to preclude retry loops; the 400/403-only contract is load-bearing and enforced by regression test + Unit E grep-invariant.
9. **Reparent→absorption transition window:** both kinds briefly coexist on the shared accept path; reparent initiation disabled at F4 deploy; stale rows drain via TTL — no dual-write.
10. **Absorption scope-creep:** pressure to pull "carry" into v1 would blow the unit boundary — held behind D2 with the `absorption_transfers` manifest design already specified for v2.
11. **Manual N schedule risk is transcription + book sourcing, not code** (proven by the Table 4D history); G2's demand-driven telemetry limits transcription scope; sourcing (D11) starts now, independent of all units. The `ashraeWeather` coincident-WB fabrication must be replaced before any commercial display flip.
12. **Open-permit BLOCK on absorption** can frustrate a user mid-review; preflight surfaces the cure (withdraw/complete) legibly or it becomes support load.

---

## 14. Decisions for Nathan

See the ratification list accompanying this spec (D1–D15). Headline items: email-OTP fallback vs literal dual-TOTP (D1); orphan-v1/carry-v2 data policy (D2); individual-pays absorption gate per your directive, either-side as the flagged alternative (D3); grandfathering live authority orgs (D5); F-5/F-15/F-16 defaults (D7–D9); permit approve/deny friction line (D13). Each default ships as written unless you override.

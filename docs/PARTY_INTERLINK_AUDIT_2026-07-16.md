# Party & Rank Interlink Audit — 2026-07-16

Full audit of how every party type on the platform (in-org roles, L0 platform admin, permit
authorities, forum participants, subdivisions/reparented users, impersonation sessions)
interlinks — what each rank can do, where it's enforced, and where the layers disagree.
Produced by four parallel code auditors over `workers/src` + `frontend/src` + migrations.
All file references verified against the working tree as of this date.

---

## 1. The rank model — three orthogonal axes

A user's total standing is the combination of **three independent axes**, all resolved into
the session by `authMiddleware` (`workers/src/middleware/auth.ts:45-66`):

| Axis | Values | Storage | Meaning |
|---|---|---|---|
| **Tenant role** | `viewer(0) < tech(1) < engineer(2) < admin(3)` | `users.role` (CHECK, 0001:51) | Rank inside the org. Rank map + `roleSatisfies()` in `utils/accessPolicy.ts:33-122` |
| **L0 platform admin** | boolean | `users.is_platform_admin` | Creator layer. Passes every `roleSatisfies` threshold; gates `/api/platform/*` via `requirePlatformAdmin` |
| **Permit authority** | boolean | `users.is_permit_authority` | Per-user reviewer flag; only meaningful when the *org* also has `organisations.authority_type` set |

Plus session-level modifiers: `sessions.is_impersonation` (migration 0017) makes the whole
session read-only, and `users.status='active'` gates every auth path except one (see F-8).

**Org-level standing** is a fourth, org-scoped axis: `organisations.authority_type`
(is this org a permit authority), `parent_org_id` (is this org a subdivision), and
`is_public` per project (forum exposure).

### Key invariants (confirmed working)

- **L0 bypasses capability policy but NOT tenant continuity** — both L0 cross-tenant write
  paths re-run `computeRoleChangePlan` and 409 on block-severity (`platform.ts:430-440, 502-510`).
- **Impersonation is genuinely read-only** at a single choke point (`index.ts:98-109`),
  can't chain, gets no refresh token, hard-dies at 30 min.
- **Self-approval of permits is structurally blocked** — `isParty()` (`permits.ts:31-44`)
  tests submitter before authority, so an org can never take authority actions on its own submission.
- **No client-only enforcement anywhere** — every mutation the UI offers is independently
  gated server-side. All frontend/server disagreements are broken-button UX, never privilege escalation.
- **Continuity engine** (`utils/roleChange.ts`): BLOCK = sole admin losing admin; sole
  permit-authority member on removal (removal only — demotion doesn't touch the orthogonal flag).
  WARN = owned projects, open permit submissions. Commit endpoints never trust the UI preflight.
- **Tenant-scoping CI guard** waiver list is current and tight (`platform/forum/permits/audit`
  are the only ALT_MODEL_FILES).

---

## 2. Party interlink map

```
                    ┌───────────────────────────── L0 platform admin ─────────────────────────────┐
                    │  /api/platform/*: org list/dossier/metrics/audit/qa · cross-tenant user      │
                    │  PATCH/DELETE (continuity-checked) · access-policy override ·                │
                    │  read-only impersonation (30-min, no refresh, single choke point)            │
                    └──────────────────────────────────────────────────────────────────────────────┘
                                │ impersonate (read-only)                 │ role/authority/deactivate
                                ▼                                        ▼
┌──────────────── Tenant org A (submitter) ────────────────┐   ┌───────── Tenant org B (authority) ─────────┐
│ admin ── team mgmt, invites, subdivisions, reparent,     │   │ admin sets authority_type (self-declared,  │
│          authority profile, access policy, deletes       │   │ unvetted) + flags members                   │
│ engineer ─ forum share/unshare (+admin)                  │   │ is_permit_authority members: claim/approve/ │
│ tech ──── create/update projects, calcs, CAD, uploads    │   │ deny/request-changes/suspend/revoke/        │
│ viewer ── read …but see F-1/F-2: uploads & permits       │   │ reinstate/set-expiration — binary power,    │
│           currently accept ANY authenticated member      │   │ no claim lock, no seniority tiers           │
└───────────────────────────────────────────────────────────┘   └─────────────────────────────────────────────┘
        │ POST /permits/submit (any role — gap F-2)                       ▲
        ▼                                                                 │
   permit_submissions ── party-gated via isParty(): submitter org ↔ authority org
        │  authority side gets FULL project row + all calc outputs (by design)
        │  submitter side sees reviewer identity + timeline actors (F-5 — decide if intended)
        ▼
   permit_status_transitions (append-only timeline; set_expiration missing — F-10)
   cron */5: auto-expire approved/suspended past expires_at (system actor, audited)

   Forum (cross-tenant, opt-in): admin|engineer shares project (is_public + curated summary);
   any authenticated user comments; author-only delete; NO L0 moderation path yet (F-13).

   Subdivisions (0017): child org = full org row w/ parent_org_id, single-level (code-enforced
   only). NO role inheritance parent→child; parent admin reaches child only via invite.
   Reparent: consent-based pull of a sole-member solo org's user; person moves, data stays
   (orphaned org, F-12); continuity guards block sole-authority leavers but not open-submitters.
```

---

## 3. Endpoint enforcement matrix (condensed)

| Surface | Read | Write | Delete | Notes |
|---|---|---|---|---|
| `/api/projects` | any member | **tech+** (`projects.ts:47,87`) | **admin** (`:145`) | Matrix says engineer for create/update — decide (F-16). No ownership checks; org-scoped only |
| `/api/calculations` | any member | **tech+** (`calculations.ts:29`) | — (append-only) | Verifies project ∈ org |
| `/api/cad` | any member | **tech+** (`cad.ts:154,222`) | **admin** (`:274`) | Versions: `versionView` policy (default viewer); restore: `versionRestore` (default admin) |
| `/api/uploads` | any member | **tech+** (`uploads.ts`) | **admin** (`uploads.ts`) | F-1 ✅ RESOLVED 2026-07-20 — gated via `roleSatisfies`, mirrors projects/cad |
| `/api/feedback` | any member (all org feedback) | any member | — | Uses `as any` on user (type smell) |
| `/api/org` team/authority/policy/domain/invites/subdivisions/reparent/role-change | roster & config readable by **any member** (F-15) | **admin** (raw `role!=='admin'` checks throughout org.ts) | admin | org.ts ignores `isPlatformAdmin` except access-policy PUT (F-22) |
| `/api/permits` | party-gated (`isParty`) | **NO role gate** — any member of party org (F-2) | — | Authority actions require `is_permit_authority`; submitter actions any role |
| `/api/forum` | any authenticated | share: **admin\|engineer**; comment: any | comment: author-only | No L0 moderation (F-13) |
| `/api/audit-log` | `auditView` policy (default admin); non-admin pass-through sees own rows only; OR-visibility (actor org OR target org) | — | — | L0 `?scope=platform` sees all |
| `/api/platform` | **L0** | **L0** (+ continuity checks) | **L0** | L0 reads unaudited (F-3) |

---

## 4. Findings — ranked

Severity: **P0** fix before wider tenant onboarding · **P1** next hardening unit ·
**P2** correctness/UX debt · **D** policy decision needed first.

### Security & audit integrity

- **F-1 (P0) ✅ RESOLVED 2026-07-20.** Uploads had no role gate at all — every `uploads.ts`
  endpoint, including `DELETE /:id` (removes the R2 object + D1 row), required only
  authentication, so a `viewer` could upload and destroy files. Fixed by mirroring
  projects/cad via `roleSatisfies`: `POST /` = **tech+**, `DELETE /:id` = **admin**; reads
  stay open to any org member (org-scoped); L0 always passes. Regression cover:
  `workers/test/uploads-role-gate.test.ts` (viewer 403 on upload+delete, tech upload 201 /
  tech delete 403, admin delete 200, L0-viewer upload 201, reads open). Permit-side (F-2)
  and `verify-email` (F-8) remain open — see Unit A.
- **F-2 (P0) Permit actions have no submitter-side role gate.** `POST /submit`
  (`permits.ts:92`), `withdraw` (`:367`), comments (`:608`) accept any org member incl.
  viewer. Submitting a permit exposes the full project + calc outputs cross-tenant — the
  single most consequential action a low-rank user can take. Recommend: tech+ or engineer+ (decide).
- **F-3 (P0) L0 sensitive reads are entirely unaudited.** `middleware/audit.ts:17-19` and
  `platform.ts:8-9` promise `setAudit` on sensitive reads; **no L0 GET handler calls it**
  (org dossier w/ `stripe_cust_id`, metrics, cross-tenant audit, qa-benchmarks), and all
  reads during impersonation are likewise invisible. An L0 admin can browse any tenant for
  30 min with only the `impersonate` start/exit events recorded.
- **F-4 (P1) Impersonation audit misattribution.** Blocked 403 mutations during
  impersonation write `org_id = target org`, `user_id = L0 admin`, `is_platform_action = 0`
  (`middleware/audit.ts:164`) — the target tenant's own feed shows a non-member actor,
  leaking L0 identity and mislabeling a platform action as same-tenant.
- **F-7 (P1) Stale authority rights.** `isParty()` authority branch (`permits.ts:40`)
  checks the user flag but never re-verifies the org still has `authority_type` set —
  clearing an authority profile leaves flagged users with full decision power over in-flight
  submissions.
- **F-8 (P2, documented residual) `verify-email` is the sole session-mint without a
  `status='active'` gate** (`auth.ts:387-399`, bypasses `buildSessionResponse`). Matches the
  CLAUDE.md deliberate-residual note, but it's the one divergence from the §8 invariant —
  cheap to close.

### Policy decisions needed (D)

- **F-5 (D) Reviewer identity is fully visible to the submitter** — `GET /submissions/:id`
  returns `reviewer_user_id` + name to both parties (`permits.ts:274-286`), and the timeline
  names every authority actor (`:668-677`). Fine for a transparency model; fatal if reviewer
  anonymity is ever required. Decide and document.
- **F-6 (D) Authority self-declaration is unvetted.** Any tenant admin can set
  `authority_type` (`org.ts:83-96`) and appear in the authority directory with an
  `AuthorityBadge`; combined with the authority-side full project read, a hostile org can
  masquerade as a plausible AHJ. Options: L0 approval step on `authority_type`, a
  `verified_at` column behind the badge, or accept as-is while tenants are known parties.
- **F-15 (D) `GET /api/org/team` is open to every member** (roster incl. emails, roles,
  authority flags, pending-invite tokens) while the CLAUDE.md matrix reserves member-listing
  for engineer+. Gate or amend the matrix.
- **F-16 (D) Project/CAD create-update is tech+, matrix says engineer.** Code comment
  ("tech+ may create/update") contradicts §5. Pick one and align matrix + thresholds together
  with F-2's choice — this is really one decision: *what is `tech` for?*

### Lifecycle correctness

- **F-9 (P1) Resubmit-after-changes_requested is dead.** `RESUBMITTABLE_PARENT` includes
  `changes_requested` and the UI offers "Resubmit with changes" (`PermitsPage.tsx:855`,
  modal says "Pick the same authority"), but the open-duplicate guard (`permits.ts:151-161`)
  409s because the parent *is* the open row for that project+authority. Fix: exclude the
  named parent from the duplicate check (and transition it to a superseded/withdrawn state
  on successful resubmission).
- **F-10 (P2) `set_expiration` skips the forensic timeline** — audited via `setAudit` but no
  `recordTransition`, and no reason required, despite it arming/disarming auto-expiry. Add both.
- **F-11 (P2/D) No claim lock.** Any authority member can decide a submission claimed by
  another; `approve`/`deny` silently overwrite `reviewer_user_id` (`permits.ts:473`).
  Decide: soft convention (record the takeover in the timeline) vs hard lock.
- **F-12 (P1) Reparent strands data and permits.** Accept-side moves the person only:
  projects/calcs stay in the now-memberless org (reachable only via unaudited L0
  impersonation — compounds F-3), and open submissions where the leaver's *org* is the
  submitter become actionable by nobody. The continuity guard blocks sole-authority leavers
  (`auth.ts:1187-1194`) but not open-submitters. Minimum: extend the accept-side guard to
  warn/block on open submissions; longer-term, an L0 org-archival/data-reassignment tool.
- **F-14 (P2) Advertised-but-missing L0 powers:** forum moderation ("Phase-2" delete path in
  `forum.ts:12-13` doesn't exist — author-only comment deletion is the only takedown) and
  plan/`billing_status` override (`platform.ts:14` header lists it; no endpoint — and
  impersonation being read-only means L0 literally cannot change a tenant's plan today).

### UX & consistency

- **F-17 (P2) Broken-button UX for low ranks.** Dashboard New/Edit/Delete/Share and CAD
  save/edit/delete render for every role and 403 for viewer (and tech, on delete/share).
  The client already has `user.role` — gate these the way TeamPage/version-restore already do.
- **F-18 (P2, known fast-follow) AdminPage L0 drawer gets raw 409s** — no preflight, no
  resolution checklist (`AdminPage.tsx:736-749, 845-898`), vs TeamPage's polished
  preflight→gate flow. Confirmed still current.
- **F-19 (P2) Impersonation doesn't disable mutation controls** — banner says read-only but
  every button stays clickable and 403s.
- **F-20 (P2) Minor permit UI gaps:** authority quick-count tiles omit
  suspended/revoked/expired (`PermitsPage.tsx:139`); `permit_submission_comments.deleted_at`
  is inert (no route sets it); `teamList()` return type omits `is_permit_authority`
  (TeamPage re-declares it locally).
- **F-22 (P2) Two gating idioms coexist:** projects/calc/cad use `roleSatisfies` (L0-aware);
  all of org.ts uses raw `role !== 'admin'` (L0-blind, except access-policy PUT). Not
  currently exploitable (L0 dogfoods as tenant admin; impersonation is read-only) but
  normalize on `roleSatisfies` before it bites.
- **F-23 (P2) Dead code:** `requirePermitAuthority` middleware
  (`middleware/auth.ts:100-106`) is never mounted — `isParty()` replicates it inline. Delete
  or adopt.
- **F-24 (P2) Subdivision single-level invariant is code-only** (`org.ts:709-714`); schema
  permits arbitrary depth/cycles, and `organisations` isn't in the CI guard's STRICT_TABLES.
  Any future insert path must re-check; consider a trigger or a check in the guard script.

---

## 5. Proposed remediation units (clean, self-contained)

1. **Unit A — Role-gate the ungated (P0):** ~~uploads write/delete thresholds~~ (✅ DONE
   2026-07-20: write = tech+, delete = admin), permit submit/withdraw/comment threshold,
   `verify-email` status gate. The uploads slice shipped on the settled "tech creates, admin
   deletes" reading (matches projects/cad); the permit-side threshold (F-2) still rides the
   F-16/F-15 "what is tech/viewer for" decision.
2. **Unit B — Audit integrity (P0/P1):** `setAudit` on all L0 GETs + a read-audit line for
   impersonated requests; fix impersonation attribution (`is_platform_action`, actor-org
   routing); `recordTransition` + required reason on `set_expiration`.
3. **Unit C — Permit lifecycle correctness (P1):** resubmit-vs-duplicate-guard fix;
   `isParty` re-check of `authority_type`; claim-lock decision + timeline record; reparent
   guard extended to open submissions.
4. **Unit D — UX alignment (P2):** role-gate Dashboard/CAD buttons; AdminPage drawer
   preflight/checklist; disable controls while impersonating; quick-count tiles.
5. **Unit E — Consistency sweep (P2):** normalize org.ts onto `roleSatisfies`; delete
   `requirePermitAuthority` or mount it; teamList type; feedback `as any`.
6. **Unit F — Decisions to make first (D):** reviewer visibility (F-5), authority vetting
   (F-6), roster visibility (F-15), tech-vs-engineer thresholds (F-16), orphaned-org policy
   (F-12 long half), L0 forum moderation + billing override scope (F-14).

# Security Review — Auth / Tenant / D1 (2026-07-21)

> **Authorized** read-only review of HVAC Design Pro's own backend. Static code
> analysis only — no live requests, no attacks. Scope: `workers/src/**`,
> `workers/migrations/**`, `frontend/src/lib/api.ts`. The three headline
> findings (§H-1, §M-3, §M-4-permits) were spot-**verified against the code**;
> the rest carry the confidence level noted per finding.
>
> Active tests (actual spray behavior, runtime rate-limit edge cases) are **not**
> in this pass — run them against a **local/staging** worker, never prod with
> real users. See §"Needs a live test".

---

## Executive summary — fix in this order

1. **H-1 — Password spray is unmitigated.** Login throttle is keyed only on the
   caller-supplied email (5 / 15 min / email). No IP limit, no global ceiling,
   no lockout, no CAPTCHA. One password × thousands of emails trips nothing.
2. **M-1 — MFA "required" ≠ enforced for un-enrolled accounts.** A correct
   password on a not-yet-enrolled account yields a grace-enroll token; the
   holder enrolls *their own* authenticator. Compounds H-1: a sprayed password
   alone takes over any dormant/new admin.
3. **M-2 — L0 cross-tenant reads are unaudited.** Every platform-admin GET (full
   tenant dossier incl. member emails, address, `stripe_cust_id`) writes no
   audit row. Max cross-tenant reach, zero read trail (SOC 2 CC7.2 gap).
4. **M-3 — Invite tokens leak to every member + viewers can act.** `GET
   /api/org/team` returns pending-invite `token`s to any member (viewer
   included) → redeem someone else's invite. Separately, permit
   submit/withdraw/comment have no role gate, so a `viewer` can act.
5. **M-4 — Bearer token in a URL query string.** `getFileUrl()` puts the live
   token in `?token=` → history/logs/Referer leak.

**What's solid (verified):** tenant isolation is genuinely tight — every strict
table binds `org_id` to the *session* org, calc/cad POST re-verify project
ownership, and a CI guard enforces it. Session/refresh/MFA-challenge tokens are
SHA-256 at rest; passwords PBKDF2; TOTP secrets AES-256-GCM; refresh rotation
has reuse-detection. **No SQL injection found** (bound params throughout). No
secrets/PII seeded in migrations. Impersonation is read-only at a single audited
choke point.

---

## High

### H-1 — No IP/global rate limit; login throttle keyed only on email
**`workers/src/utils/rateLimit.ts` · `workers/src/routes/auth.ts:212,229,240` · Confidence: High · Verified ✓**
`checkRateLimit(db, normalizedEmail, 'login', 5, 15)` gives each email its own
5-per-15-min bucket, recorded only on failure. Password spray (one common
password across many accounts) never trips a per-email counter. The IP is
available (`cf-connecting-ip`, read by the audit middleware) but unused for
throttling; there is no global failed-auth ceiling, no lockout, no CAPTCHA.
Single-account online guessing *is* well-mitigated (~480/day/account); the
spray/distributed dimension is not mitigated at all.
**Fix:** add an IP-keyed (and/or IP×email) limiter on login/refresh/verify, a
platform-wide failed-auth ceiling, and a breached-password check on set/reset.

---

## Medium

### M-1 — MFA grace-enrollment lets a password-only attacker self-enroll
**`workers/src/routes/auth.ts:317-335, 1794-1897` · Confidence: High**
An account whose role "requires" MFA but hasn't enrolled gets an
`mfaEnrollToken` on correct password; the holder calls `/mfa/enroll-grace` +
`/mfa/confirm-grace` to bind their own authenticator and get a session. MFA thus
protects only *already-enrolled* accounts — exactly the dormant/new admins most
exposed to H-1. (Enrolled accounts *are* correctly challenged.)
**Fix:** require a second proof (email OTP to the owner) before grace-enroll;
prioritize H-1 as the entry gate.

### M-2 — L0 cross-tenant reads write no audit row
**`workers/src/routes/platform.ts:42,62,99,147,184` · Confidence: High**
`GET /orgs`, `/orgs/:id` (member emails, org address, `stripe_cust_id`, counts),
`/metrics`, `/audit`, `/qa-benchmarks` are GETs (skipped by the audit
middleware) and never `setAudit`. A platform admin browses any tenant's PII with
no trail. L0 *writes* are correctly audited.
**Fix:** `setAudit({action:'platform.org.view', targetOrgId, isPlatformAction:true})`
on the sensitive L0 read handlers.

### M-3 — Invite tokens exposed to every member; viewer→privileged redemption
**`workers/src/routes/org.ts:365-389` · Confidence: High · Verified ✓**
`GET /api/org/team` has no role check ("visible to every member") and returns
pending-invite `token`s. Any member — incl. a `viewer` — can read a bearer token
for an invite addressed to someone else and `POST
/api/auth/invite/:token/redeem` to create that account (email + role fixed to
the invite). A pending `admin` invite ⇒ viewer→admin escalation; any invite ⇒
account-creation-for-an-address-you-don't-own + denial of the real invitee.
**Fix:** gate `GET /team` to admins, or strip `token` for non-admins (return it
only in the `POST /invite` response to the creating admin).

### M-4 — Permit submitter actions are not role-gated
**`workers/src/routes/permits.ts:92 (submit), 367 (withdraw), 608 (comments)` · Confidence: High · Verified ✓**
Permit actions gate on party membership (`isParty`) but never `roleSatisfies`. A
`viewer` (read-only per §5 matrix) can create submissions to authorities,
withdraw them, and comment on the org's behalf. This is the open **F-2** item.
Within-org integrity issue, not a cross-tenant breach.
**Fix:** require `roleSatisfies(user.role,'tech',…)` on submit/withdraw/comment,
or deliberately encode what `viewer`/`tech` may do on the permit rail.

### M-5 — Bearer token written into a URL query string
**`frontend/src/lib/api.ts:609-612` · Confidence: High (exposure) / Medium (exploitability)**
`getFileUrl()` returns `…/api/uploads/${id}?token=${token}`. Used as an
`<img src>`/`<a href>`/`window.open`, that writes the live token into history,
CF access logs, and Referer. `authMiddleware` is header-only, so the query token
doesn't actually authenticate today — but it still lands in logs, and a future
"read `?token=`" change would make it a live, logged credential leak. Also
violates the project's own "no sensitive data in URL params" rule.
**Fix:** fetch with the `Authorization` header into a Blob + `createObjectURL`,
or issue a short-lived signed R2 URL. Never put the session token in a query.

### M-6 — Refresh + access tokens in `localStorage`
**`frontend/src/lib/api.ts:256-271` · Confidence: High**
`hvac_session_token` + the 14-day `hvac_refresh_token` are script-readable; any
single XSS = two weeks of silent re-minting. XSS is otherwise well-defended (no
`dangerouslySetInnerHTML`, DOMPurify, hardened file serving) — the refresh token
is the weakest link if one ever lands.
**Fix:** prefer an httpOnly/Secure/SameSite refresh cookie scoped to
`/api/auth/refresh`; else keep the refresh token in memory only.

### M-7 — No upload size cap
**`workers/src/routes/uploads.ts:20-71` · `workers/src/routes/feedback.ts:85-122` · Confidence: High**
`/api/uploads` streams `file` to R2 with no size limit (any `tech+`); feedback
archives attachments with only an email cap, not a storage cap. Storage/cost
exhaustion.
**Fix:** enforce a per-file + per-request byte cap (via `Content-Length` and/or
a counting stream) before the R2 put.

### M-8 — AI extraction endpoint: no rate limit, no role gate, no meter
**`workers/src/routes/ai.ts:107` · Confidence: High**
`/api/ai/blueprint-extract` is reachable by any authed user (viewer incl.) and
drives `claude-opus-4-8` at `max_tokens: 64000` over up to 6 images, outside the
`calc_run` entitlement meter. Uncapped Anthropic spend = financial DoS. (Input
validation itself is good.)
**Fix:** per-user/per-org rate limit + a `usage_events` meter/entitlement;
consider gating to `tech+`.

---

## Low

- **L-1 — PBKDF2 at 100k iterations** (`utils/crypto.ts:22`). Below OWASP 600k.
  Salting/format/timing-safe compare all correct. → raise to ~600k (re-hash on
  next login, as legacy hashes already do).
- **L-2 — Verification codes stored in plaintext** (`migrations/0003…:6`;
  `utils/verificationCodes.ts:60-64`). A DB dump in-window exposes live codes; a
  `password_reset` code + known email = takeover. Bounded by 5-attempt cap +
  short expiry. → store `hashToken(code)`, compare constant-time.
- **L-3 — `org_invites.token` plaintext at rest** (`migrations/0004…:54`). By
  design; amplified in-app by M-3. Consider hashing like session tokens.
- **L-4 — User enumeration** — register returns `409` (existence oracle); login
  runs PBKDF2 only for known emails (timing oracle). (`auth.ts:156-158, 220-249`).
  → generic register response + dummy-hash on unknown email.
- **L-5 — Weak password policy** — 8-char min, no complexity/breach check
  (`auth.ts:138-140, 498-500, 1008-1010`).
- **L-6 — SSO callbacks don't verify `state`/nonce, no PKCE, id_token
  unverified** (`utils/oauth.ts`, `auth.ts:554-560, 746-753`). Impact limited by
  server-side secret exchange + fixed `redirect_uri`, but login-CSRF /
  code-injection defenses are absent. → persist+require `state`, adopt PKCE,
  validate the id_token.
- **L-7 — Verification-code compare not constant-time** (`verificationCodes.ts:102`).
- **L-8 — No rate limit on forum/permit comments** (`forum.ts:165`,
  `permits.ts:608`). Length-capped but spammable.
- **L-9 — CI tenant-scoping guard checks `org_id` presence, not that it's
  session-derived** (`scripts/check-tenant-scoping.mjs:182-184`). Latent, not
  active — today every query binds `user.orgId`.
- **L-10 — `verify-email` not status-gated** (`auth.ts:366-427`). Confirmed,
  consistent with the documented decision. Low residual.
- **L-11 — Webhook ingress public, signature verify is a stub** (`routes/webhooks.ts`).
  Dormant (every `handleWebhook` returns `handled:false`); `org_id` resolved
  server-side, never from the body. Enforce signatures before wiring a real
  provider.

---

## Needs a live test (not code-verifiable) — the queued follow-up

Run against a **local/staging** worker, **never prod with real users**:

- **Actual spray behavior** — confirm H-1 lets a spray through end-to-end; D1
  window clock edge cases; whether `cleanupRateLimitEvents` (uses an ISO cutoff
  vs. the table's `datetime('now')` format) ever races `checkRateLimit`.
- **Is `getFileUrl`'s `?token=` consumed anywhere** — middleware is header-only
  in code (token inert), but confirm no caller relies on it and downloads work.
- **Real exposure of M-1** — depends on how many current admins have actually
  enrolled MFA (DB state, not code).
- **Secret config in prod** — `MFA_ENC_KEY`, `ANTHROPIC_API_KEY`, OAuth/SSO
  secrets set? Edge CORS actually restricts `credentials:true` to the two
  whitelisted origins?
- **CI guard currently green on `main`** (script read, not executed).

---

## Suggested remediation order

1. **H-1** IP/global rate limiting on auth endpoints (biggest exposure, entry gate).
2. **M-3** strip invite tokens from `GET /team` for non-admins (fast, clear privesc).
3. **M-4** role-gate permit submit/withdraw/comment (closes open F-2).
4. **M-5** stop putting the bearer token in the upload URL.
5. **M-2** audit L0 reads (SOC 2). **M-1** grace-enroll second factor. **M-8** meter AI spend.
6. Low items as hygiene — L-2/L-3 (hash codes/invite tokens), L-1 (PBKDF2 600k), L-6 (SSO state/PKCE).

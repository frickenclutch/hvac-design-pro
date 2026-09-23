# Apple Developer Program — Enrollment Runbook
**Date:** 2026-08-05 · **Why:** LiDAR Phase 2 (Capacitor shell + RoomPlan plugin → TestFlight) requires a paid Apple Developer membership. Sourced from Apple's live enrollment docs (developer.apple.com/programs/enroll + /support/D-U-N-S) on this date.

**Division of labor:** account creation, sign-ins, agreement acceptance, and payment are Nathan's
hands only (policy — Claude never creates accounts, enters credentials, or handles payment).
Claude preps everything, co-pilots in the browser, and does the follow-up configuration that
doesn't touch credentials.

---

## 0. The decision: Organization vs Individual

| | Organization (recommended) | Individual |
|---|---|---|
| App Store seller name | **C4 Technologies** (legal entity name) | "Nathan Griffith" |
| Needs D-U-N-S | Yes (~7 business days if not already assigned) | No |
| Needs org-domain work email + public website on that domain | **Yes — hard requirement** | No |
| Team member seats (App Store Connect roles for Dan etc.) | Yes | Account Holder only-ish (limited) |
| Speed | Days–weeks (D-U-N-S + verification) | Fastest |

**Recommendation: Organization.** A professional B2B product listed under a personal name reads
wrong to municipal/permit-adjacent customers, and converting Individual→Organization later is a
support-ticket process. The D-U-N-S wait is why we're starting now, ahead of the app build.

---

## 1. Pre-checks (Nathan answers; blockers surface here, not mid-enrollment)

1. **Legal entity name, exactly as registered** (state filing: "C4 Technologies LLC"? "Inc"?).
   Apple accepts no DBAs, trade names, or branches — the name must match Dun & Bradstreet's
   record verbatim. Have the business registration document at hand; D&B may ask for it.
2. **Does C4 Technologies have its own domain?** Two hard requirements hang on it:
   - a **work email on that domain** for the Apple Account (gmail is not accepted for org enrollment),
   - a **publicly available website on that domain** (registrar placeholder pages and social
     links are explicitly rejected).
   If no → registering a domain (e.g. c4technologies.com / the planned hvacpro.app) + standing up
   a one-page real site + a mailbox (Cloudflare Email Routing forwards work fine) is a same-day
   fix Claude can build; do it BEFORE the D-U-N-S request so the D&B record and site agree.
3. **D-U-N-S check:** developer.apple.com/support/D-U-N-S/ → lookup tool (requires Apple Account
   sign-in). If C4 is listed → note the number. If not → submit the free request:
   legal entity name, HQ + mailing address, work contact. **Timeline: up to 5 business days at
   D&B + up to 2 more for Apple to sync (~7 total).** If >2 weeks, chase D&B support.
4. **Apple Account:** use (or create) an Apple ID on the work email from #2, with two-factor
   enabled. The Account Holder must have legal binding authority — founder qualifies. Use
   Nathan's real legal name in the name fields (an alias or company name there delays approval).

## 2. Enrollment (Nathan drives; ~15 min once pre-checks clear)

1. developer.apple.com → enroll → **Organization**.
2. Sign in with the work-email Apple ID (2FA on).
3. Enter: legal entity name (exact), D-U-N-S, website URL, work contact, and confirm binding
   authority.
4. Accept the Apple Developer Program License Agreement. Pay **$99 USD/yr**.
5. Expect possible follow-up: Apple sometimes verification-calls the org phone number on file.
   Approval typically lands within a few business days of a clean submission.

## 3. After approval (Claude does the non-credential parts)

- App Store Connect: create the app record; reserve bundle id (proposal: `app.hvacpro.ios` —
  final call at Capacitor scaffold time).
- Invite team roles (Dan as tester; roles per need — least privilege).
- CI signing: fastlane match (or App Store Connect API key) wired into GitHub Actions macOS
  runners — API key generation is a Nathan step (it's a credential); storage goes into GH repo
  secrets, never the repo.
- TestFlight internal group for the team.

## Status log

- 2026-08-05 — Runbook written; awaiting Nathan's pre-check answers (legal entity form, domain
  situation, D-U-N-S existence).

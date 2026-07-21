# Settings Reorganization — Spec

> Status: **proposed** (2026-07-21). Turns the single long-scroll Settings page
> into a searchable, categorized, user-arrangeable **master-detail** surface —
> macOS / Windows / GNOME convention, but leaner and more utilitarian.

---

## 1. Why

Settings has grown to ~15 sections across personal, workspace, output, engine,
and tenant-admin concerns. A single vertical scroll is now the wrong shape:

- No way to find a setting without scrolling and scanning.
- Unrelated concerns (2FA next to PDF options next to Synology backup) sit
  side by side with no grouping.
- Every visit dumps the user at the top of a wall of cards.

The three OSes converge on the same fix: a **left category rail + detail pane**,
a **search box that indexes individual settings**, and a **landing state**. We
add two utilitarian twists no consumer OS ships: **user-arrangeable categories**
(consistent with the CAD toolbox's "arrange mode" and the platform's "my
workbench" philosophy) and a **"non-default only" filter** for support/debug.

## 2. Goals / Non-goals

**Goals**
- Group the existing sections into a small set of categories.
- Master-detail layout; deep-linkable (`/settings/:category`), keyboard-first.
- Live search across every setting's label + keywords; also surface in Cmd+K.
- Reorder + hide categories per user; remember last-open category.
- Zero behavior change to the settings themselves — this is organization only.

**Non-goals (this effort)**
- No change to what any individual setting does or how it persists.
- No new settings.
- No backend changes (all state is client-side preferences, as today).

## 3. Category map

The current sections collapse into **9 categories**. Each category is a pane of
one or more existing section cards (the collapsible cards shipped 2026-07-20).

| Category | Sections it holds (current components) | Gate |
|---|---|---|
| **Account** | User Profile (avatar, name, phone, email) | all |
| **Security** | Two-Factor Authentication (TOTP) · Access Policy | all / admin+L0 |
| **Appearance** | Appearance (theme, density, metal finish, animations, tooltips) | all |
| **Workspace** | Units & Defaults · CAD Workspace (grid, snap, autosave) | all |
| **Accessibility** | Accessibility (motion, contrast, focus, text size, augmented input) | all |
| **Reports & Output** | PDF & Print Settings · Blueprint Stamps · PE Stamp & Attestation | all |
| **Calculation Engine** | Engine version + shadow-run (Beta) | all |
| **Organization** | Organisation Profile · Legacy Archive & Backup (Synology) · Authority Profile | admin |
| **System** | System / About (version, build) | all |

Notes:
- **Security** is the new home for personal 2FA/TOTP; **Access Policy** (who in
  the tenant can reach audit/version surfaces) joins it for admins/L0 — both are
  "who can do what," which reads as Security.
- **Organization** consolidates the three tenant-admin surfaces; the whole
  category is hidden for non-admins (today each section self-gates).
- A category with zero visible sections for the current user is hidden from the
  rail entirely (don't show an empty "Organization" to a tech).

## 4. The registry (single source of truth)

The keystone refactor: sections become **data**, not JSX scattered through one
render. One registry drives the rail, the detail pane, the search index, the
deep-links, and the arrange/hide logic.

```ts
// pages/settings/registry.tsx
export type SettingsCategoryId =
  | 'account' | 'security' | 'appearance' | 'workspace' | 'accessibility'
  | 'reports' | 'engine' | 'organization' | 'system';

export interface SettingsSection {
  id: string;                       // stable slug, e.g. 'two-factor'
  title: string;                    // 'Two-Factor Authentication'
  category: SettingsCategoryId;
  icon: React.ReactNode;
  keywords: string[];               // search terms beyond the title
  /** Visible to the current viewer? Given role + L0 flag. */
  visible?: (ctx: SettingsViewerCtx) => boolean;   // default: always
  render: (ctx: SettingsRenderCtx) => React.ReactNode;  // wraps existing component
}

export interface SettingsCategory {
  id: SettingsCategoryId;
  title: string;
  icon: React.ReactNode;
  /** Hidden if no child section is visible to the viewer. */
}
```

Each existing section component (`<MfaSection/>`, `<SynologyBackupSection/>`, …)
is wrapped by a registry entry — **not rewritten**. `visible` centralizes the
role gates that are currently inline in the page's render.

## 5. Layout & routing

- **Master-detail.** Left: category rail (icons + labels, portal-styled header
  retained as a compact hero). Right: detail pane rendering the selected
  category's visible sections (each still a collapsible card).
- **Routing.** `/settings` redirects to the last-open (or first) category;
  `/settings/:categoryId` selects a category; `#sectionId` scrolls+flashes a
  section. Deep-links make search results and external links land precisely.
- **Responsive.** Desktop: persistent rail. Mobile: rail becomes a top
  category dropdown (or a back-navigable list, iOS-style); detail fills width.
- **Reuse:** the brushed-steel portal hero stays as the rail header; the
  collapsible cards, the metal finish, and density all carry over unchanged.

## 6. Search

- A search field pinned at the top of the rail. Typing filters **live**:
  matching sections surface with their category path; non-matches hide; the
  first hit is focusable/enter-to-jump (GNOME/Windows behavior).
- Index = each section's `title` + `keywords` (+ optionally field labels later).
- Also register settings sections as Cmd+K Spotlight results
  (`features/spotlight`) so they're reachable from anywhere, not just inside
  Settings. One index, two entry points.

## 7. Customizable arrangement (utilitarian layer)

- **Reorder + hide categories** — mirror the CAD toolbox's arrange mode:
  new prefs `settingsNavOrder: string[] | null` and `settingsNavHidden: string[]`
  (exact shape of `toolboxOrder`/`toolboxHidden`). An "arrange" toggle on the
  rail turns categories into draggable rows with a hide affordance; a reset
  returns to default order. Hiding only declutters the rail — search still
  reaches hidden categories.
- **Remember last-open** — `settingsLastCategory: string` so re-entry lands
  where you were.
- **"Non-default only" filter** — a rail toggle that dims/hides every setting
  currently at its default, leaving only what this user has changed. Nothing in
  macOS/Windows/GNOME does this; it's a fast audit for support ("what did they
  change?") and for the user's own review. Cheap: compare live prefs to the
  defaults object we already export.
- Carries over the existing `settingsCollapsed` (per-section collapse).

All persistence stays in `usePreferencesStore` (client-side), consistent with
every other Settings pref today.

## 8. Phased plan

**Phase 1 — Structure (this is where we start).**
- Add the `registry.tsx` (categories + section wrappers, with `visible` gates).
- Refactor `SettingsPage` into master-detail: rail + detail pane driven by the
  registry; deep-link routing; last-open memory.
- Acceptance: every current section appears under the right category, gates
  behave exactly as before, deep-links work, `tsc` + `vitest` green, no visual
  regression inside the cards.

**Phase 2 — Search.**
- Live rail filter over the registry index; Cmd+K Spotlight registration.
- Acceptance: typing "2fa" surfaces Two-Factor under Security and enter jumps to
  it; Cmd+K "metal finish" lands on Appearance.

**Phase 3 — Personalize.**
- Reorder/hide categories (arrange mode), "non-default only" filter.
- Acceptance: arrangement + hidden set persist per user; reset restores defaults;
  hidden categories still reachable via search.

Order rationale: Phase 1 alone delivers ~80% of the "consolidated landing point"
feel; search and personalization stack cleanly on the registry without touching
section internals.

## 9. Open questions (for review)

1. Rail hero: keep the full brushed-steel portal hero, or shrink to a compact
   bar so the rail stays dense? (Lean: compact bar on desktop, full hero on the
   mobile landing.)
2. Should **Access Policy** live under **Security** or stay in **Organization**?
   (Lean: Security — it's an access-control surface; Organization keeps the
   profile/backup/authority tenant-config trio.)
3. Cmd+K integration in Phase 2 vs. Phase 1 — fold in early if the Spotlight
   registration is cheap?
4. Do we want per-**field** search (index individual toggles/inputs) or is
   per-**section** search enough for v1? (Lean: per-section for v1.)

---

*Reuses, already in place:* portal hero + `.portal-plate` (2026-07-20),
collapsible section cards + `settingsCollapsed`, metal-finish theming, the CAD
toolbox arrange-mode pattern (`toolboxOrder`/`toolboxHidden`), `usePreferencesStore`
persistence, and the Cmd+K Spotlight surface.

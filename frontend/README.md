# HVAC Design Pro — Frontend

React 19 + TypeScript 5.9 + Vite 8 + Tailwind 4. Deployed to Cloudflare
Pages at [hvac-design-pro.pages.dev](https://hvac-design-pro.pages.dev).
Auto-deploy on push to `main`.

For project-wide architecture, conventions, and roadmap see
[`../CLAUDE.md`](../CLAUDE.md). This README covers frontend-local
ergonomics only.

## Local development

```bash
npm install
npm run dev          # Vite on :5173, host=true
npm run build        # tsc -b && vite build (target ≤660 KB gzip)
npm run preview      # serve the built bundle
npm run lint         # ESLint flat config
npx vitest run       # cert + unit tests (43/43, ~1.9 s)
```

> **CI gate:** every push + PR to `main` runs `../.github/workflows/ci.yml`
> — worker `tsc`, frontend `tsc -b`, and the vitest cert suite. Red blocks
> the check. Keep all three green before pushing; the gate is the
> automated backstop, not a substitute for running them locally first.

## Where things live

| Concern | Path |
|---|---|
| Page components (lazy-loaded routes) | `src/pages/` |
| Feature modules (auth, cad, projects, retailer, spotlight) | `src/features/` |
| Pure calculation engines | `src/engines/` |
| └ Cert-grade Manual J 8 (shadow-running) | `src/engines/manualJ8/` |
| └ Legacy per-room engine (production display) | `src/engines/manualJ.ts` |
| Zustand stores (auth, project, preferences, toast, retailer) | `src/stores/` and `src/features/*/store/` |
| Shared UI primitives | `src/components/` |
| Typed API client | `src/lib/api.ts` |
| User-scoped localStorage helpers | `src/utils/storage.ts` |

## Conventions worth knowing before editing

- **Project-scoped localStorage keys:** every persisted user-data key
  is `{userId}__{baseKey}` via `scopedKey()`. Never write to a bare
  `hvac_*` key — see `src/utils/storage.ts` for the full convention
  including the orphan-recovery sweep on prefs hydration.
- **Pure engines, no I/O:** anything in `src/engines/` is a pure
  function tree. No HTTP, no DOM, no zustand reads.
- **All API through `lib/api.ts`:** raw `fetch()` is forbidden in
  components — the wrapper handles bearer injection, retry, 401
  redirects, and error normalization.
- **Lazy-load every route:** `App.tsx` uses `React.lazy` for every
  page component. New pages go through the same pattern.
- **Tailwind v4 only:** no inline styles, no CSS modules. Custom
  tokens live in `src/index.css` `@theme` block.

## Testing model

Cert tests (Smith / Walker / Cobb residences) live in
`src/engines/manualJ8/__tests__/` and run on every commit. They
validate against ACCA's published reference values within 0.5%
tolerance. Unit tests for storage, prefs persistence, and the
Liang-Barsky pipe/duct clip live alongside their modules.

vitest configuration is in the project root (`vitest.config.ts`).

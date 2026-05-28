import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      // Phase-1 strict-TypeScript migration is tracked separately (zero-`any`
      // goal; lib/api.ts is the hotspot). Keep `any` visible as a warning so it
      // surfaces the debt without blocking lint while the typed migration is
      // done deliberately rather than churned in mid-session.
      '@typescript-eslint/no-explicit-any': 'warn',
      // React Compiler rule (eslint-plugin-react-hooks v7) — flags several
      // correct "initialize state inside an effect" patterns in auth/team
      // flows. Surface as a warning to address case-by-case, not block.
      'react-hooks/set-state-in-effect': 'warn',
      // HMR-only fast-refresh DX rule; not a correctness concern.
      'react-refresh/only-export-components': 'warn',
    },
  },
])

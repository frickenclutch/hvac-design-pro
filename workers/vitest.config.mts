/**
 * Vitest config for the Worker integration-test harness.
 *
 * Uses @cloudflare/vitest-pool-workers so tests run INSIDE a real workerd
 * runtime with a Miniflare-backed D1 (true SQLite) and R2. This is the only
 * way the harness can exercise the REAL route handlers through the REAL
 * authMiddleware against a REAL database — no DB mock, no auth bypass.
 *
 * NOTE on wiring: the installed @cloudflare/vitest-pool-workers@0.16.x does not
 * publish the `./config` subpath (no `defineWorkersConfig` helper in this
 * build). Vitest 4 reworked the pool API, so the integration is now a Vite
 * plugin (`cloudflareTest`) + a pool runner (`cloudflarePool`), both available
 * from the package's main entry. `defineWorkersConfig` was just sugar over
 * exactly this — we wire it by hand, functionally identical.
 *
 * MIGRATIONS: workerd's node:fs can't reliably read host paths on Windows
 * (URL-encoded `import.meta.url` → `/C:/HVAC%20Design%20Pro/...`). So we read +
 * pre-split the migration SQL HERE, at config-load time on the Node side, and
 * hand the parsed statement arrays to the in-runtime tests via Vitest's
 * `provide`/`inject` channel. The harness then executes them against the real
 * Miniflare D1.
 *
 * Bindings (DB + STORAGE) come from wrangler.toml's [env.test] block so the
 * test Worker sees the binding names the production code expects (`c.env.DB`,
 * `c.env.STORAGE`).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { cloudflarePool, cloudflareTest } from '@cloudflare/vitest-pool-workers';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

/** Strip `--` line comments, then split on `;`. The migrations contain no
 *  triggers (no BEGIN..END) and no semicolons inside string literals — only
 *  inside comments — so this is safe. Verified across all 11 files. */
function splitStatements(sql: string): string[] {
  const noComments = sql
    .split('\n')
    .map((line) => {
      const idx = line.indexOf('--');
      return idx === -1 ? line : line.slice(0, idx);
    })
    .join('\n');
  return noComments
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** [ { file, statements }, ... ] in migration order — provided to the runtime. */
const migrations = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .map((file) => ({
    file,
    statements: splitStatements(readFileSync(join(MIGRATIONS_DIR, file), 'utf8')),
  }));

const workersOptions = {
  isolatedStorage: true,
  singleWorker: true,
  wrangler: {
    configPath: './wrangler.toml',
    environment: 'test',
  },
} as const;

export default defineConfig({
  // The Vite plugin sets up module transforms + the cloudflare:test virtual
  // module so `import { env } from 'cloudflare:test'` resolves.
  plugins: [cloudflareTest(workersOptions as never)],
  test: {
    // Only the harness lives under workers/test — keep it out of src/ so the
    // production tsconfig include ("src/**/*.ts") and the tenant-scoping guard
    // (which walks src/) never see the seed queries.
    include: ['test/**/*.test.ts'],
    pool: cloudflarePool(workersOptions as never) as never,
    // Hand the pre-parsed migrations to the in-runtime harness (workerd can't
    // read the .sql files itself on Windows — see header).
    provide: { migrations },
  },
});

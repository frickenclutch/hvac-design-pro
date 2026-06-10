#!/usr/bin/env node
/**
 * ─────────────────────────────────────────────────────────────────────────────
 * TENANT-SCOPING GUARD  —  the app-layer backstop D1 can't give us
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * WHY THIS EXISTS
 *   D1 (SQLite) has NO row-level security. CLAUDE.md §2 "Layer 3: Database
 *   Isolation" describes Postgres RLS — which is aspirational on D1. On the
 *   Worker, the ONLY thing stopping org A from reading/writing org B's data is
 *   that every handler remembered to write `... AND org_id = ?` bound to the
 *   *session-derived* org. The 2026-06-02 audit found that discipline is
 *   currently 100% correct — but it's correct by hand, with no machine check.
 *   One forgotten clause in a future handler is an immediate cross-tenant
 *   breach with no second line of defense.
 *
 *   This script IS that second line of defense. It statically scans every
 *   D1 `.prepare()` statement under workers/src and fails the build if a
 *   statement touches an org-owned table without scoping by `org_id` — unless
 *   the line is explicitly, visibly waived with a documented reason. "Provable,
 *   not assumed."
 *
 * THE RULE
 *   For every SQL statement that references a STRICT_TABLE:
 *     PASS  if the statement text contains `org_id`, OR
 *     PASS  if it carries an inline `tenant-scope-ok:` waiver (with a reason), OR
 *     SKIP  if it lives in an ALT_MODEL_FILE (a route that uses a different,
 *           separately-audited access model — see the list below), else
 *     FAIL.
 *
 *   New files are enforced BY DEFAULT — the only escape hatches are an inline
 *   waiver (justified at the exact line) or being added, consciously and in
 *   review, to ALT_MODEL_FILES.
 *
 * HOW TO SATISFY IT (for the next engineer who trips it)
 *   1. Best: add `AND org_id = ?` and bind `c.get('user').orgId`. Never bind an
 *      org id taken from the request body / params / query — that's the bypass
 *      this guard exists to stop.
 *   2. If the query is genuinely safe without org_id (e.g. it reads only a
 *      version ordinal AFTER an ownership check on a globally-unique id), add a
 *      waiver comment on the line or the line above:
 *        // tenant-scope-ok: <reason ownership is already established>
 *   3. If you're adding a whole new cross-tenant access model, add the file to
 *      ALT_MODEL_FILES with a one-line justification — and get it reviewed.
 *
 * Runs in CI (.github/workflows/ci.yml, job "tenant-scoping") and locally via
 * `npm run scope:check`. Zero dependencies — plain Node, no install needed.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

/**
 * Org-owned tables. Every row belongs to exactly one tenant via an `org_id`
 * column, and every access MUST be scoped by it. Word-boundary matched, so
 * `project_id` (an FK, not the table) and `feedback_attachments` (its own
 * parent-gated child, see note) do NOT trip these.
 */
const STRICT_TABLES = [
  'projects',
  'calculations',
  'cad_drawings',
  'cad_drawing_versions',
  'file_uploads',
  'feedback',
  // ── Billing foundation (migration 0012) ──────────────────────────────────
  // All four are org-owned (org_id NOT NULL + indexed). Every billing.ts query
  // carries `AND org_id = ?` bound to c.get('user').orgId.
  'subscriptions',
  'payment_methods',
  'usage_events',
  'invoices',
];

/**
 * `feedback_attachments` is intentionally NOT a strict table: it has no
 * `org_id` column. Access is gated through its parent `feedback` row, which
 * IS org-scoped (see feedback.ts GET /:id — the parent is fetched
 * `WHERE id = ? AND org_id = ?` before the attachments are listed). Documented
 * here so its absence is a decision, not an oversight.
 */

/**
 * `plan_entitlements` (migration 0012) is intentionally NOT a strict table.
 * Unlike the four billing tables above, its `org_id` column carries a SENTINEL
 * value `'*'` for plan-wide rules (`scope_kind='plan'`) that apply to every org
 * on a given plan — a blanket `org_id = ?` rule doesn't fit that dual model.
 * Its ONLY reader is `checkEntitlement` in billing/usage.ts, whose query
 * resolves an org override (`e.org_id = ?`, bound to the session org) OR a
 * plan-wide rule joined from the org's own plan — never a client-supplied org
 * filter, and the sentinel `'*'` is never bound from request input (real org
 * ids are UUIDs). That one query carries an inline `tenant-scope-ok:` waiver
 * with this reasoning. Documented here so the absence is a decision, not an
 * oversight.
 */

/**
 * Files whose correctness is NOT "every query has org_id". Each uses a
 * distinct, separately-audited access model. The guard records their
 * strict-table queries as informational but does not fail on them. Keep this
 * list SHORT and justified — it's the only blanket escape hatch.
 */
const ALT_MODEL_FILES = {
  'routes/platform.ts': 'L0 creator layer — entire namespace behind requirePlatformAdmin; cross-tenant by design',
  'routes/forum.ts': 'Opt-in cross-tenant project-sharing board; public reads gated on is_public, not org_id',
  'routes/permits.ts': 'Party-gated model (submitter_org_id / authority_org_id + isParty()), not classic org_id',
  'routes/audit.ts': 'Audit feed — OR-based actor/target visibility + per-row check + L0 scope, not a single org_id clause',
};

const WAIVER_MARKER = 'tenant-scope-ok';

// ── SQL extraction ───────────────────────────────────────────────────────────

/** Collect every `.prepare(<string-literal>)` in a source file, with the SQL
 *  text, the char offset of `.prepare`, and whether a waiver marker sits in the
 *  statement or in the ~200 chars immediately preceding it. */
function extractPreparedStatements(content) {
  const out = [];
  const needle = '.prepare(';
  let i = 0;
  while ((i = content.indexOf(needle, i)) !== -1) {
    let p = i + needle.length;
    // Skip whitespace between '(' and the string literal.
    while (p < content.length && /\s/.test(content[p])) p++;
    const quote = content[p];
    if (quote === '`' || quote === '"' || quote === "'") {
      p++;
      let sql = '';
      while (p < content.length) {
        const ch = content[p];
        if (ch === '\\') { sql += content[p + 1] ?? ''; p += 2; continue; }
        if (ch === quote) break;
        sql += ch;
        p++;
      }
      const preceding = content.slice(Math.max(0, i - 200), i);
      const waived =
        sql.toLowerCase().includes(WAIVER_MARKER) ||
        preceding.toLowerCase().includes(WAIVER_MARKER);
      out.push({ sql, offset: i, waived });
    } else {
      // `.prepare(someVariable)` — not a literal. None exist today; flag if one
      // ever appears so it can't smuggle an unscoped query past the guard.
      out.push({ sql: null, offset: i, waived: false, dynamic: true });
    }
    i = p;
  }
  return out;
}

function lineNumberAt(content, offset) {
  let line = 1;
  for (let k = 0; k < offset && k < content.length; k++) {
    if (content[k] === '\n') line++;
  }
  return line;
}

function referencesStrictTable(sql) {
  const lower = sql.toLowerCase();
  return STRICT_TABLES.filter((t) => new RegExp(`\\b${t}\\b`).test(lower));
}

function isScoped(sql) {
  return sql.toLowerCase().includes('org_id');
}

// ── Walk ─────────────────────────────────────────────────────────────────────

function walk(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) files.push(...walk(full));
    else if (full.endsWith('.ts')) files.push(full);
  }
  return files;
}

// ── Run ──────────────────────────────────────────────────────────────────────

const violations = [];
const waivers = [];
const altModel = [];
const dynamic = [];
let scopedCount = 0;
let scannedStatements = 0;

for (const file of walk(SRC)) {
  const rel = relative(SRC, file).split('\\').join('/');
  const content = readFileSync(file, 'utf8');
  const isAlt = Object.prototype.hasOwnProperty.call(ALT_MODEL_FILES, rel);

  for (const stmt of extractPreparedStatements(content)) {
    const line = lineNumberAt(content, stmt.offset);

    if (stmt.dynamic) {
      // Alt-model files use separately-audited access models; a dynamic query
      // there isn't something this guard can or should adjudicate.
      if (!isAlt) dynamic.push({ rel, line });
      continue;
    }

    const tables = referencesStrictTable(stmt.sql);
    if (tables.length === 0) continue; // doesn't touch org-owned data
    scannedStatements++;

    const snippet = stmt.sql.replace(/\s+/g, ' ').trim().slice(0, 90);

    if (isAlt) {
      altModel.push({ rel, line, tables, snippet });
      continue;
    }
    if (isScoped(stmt.sql)) {
      scopedCount++;
      continue;
    }
    if (stmt.waived) {
      waivers.push({ rel, line, tables, snippet });
      continue;
    }
    violations.push({ rel, line, tables, snippet });
  }
}

// ── Report ───────────────────────────────────────────────────────────────────

const C = process.stdout.isTTY
  ? { red: (s) => `\x1b[31m${s}\x1b[0m`, green: (s) => `\x1b[32m${s}\x1b[0m`,
      yellow: (s) => `\x1b[33m${s}\x1b[0m`, dim: (s) => `\x1b[2m${s}\x1b[0m`,
      bold: (s) => `\x1b[1m${s}\x1b[0m` }
  : { red: (s) => s, green: (s) => s, yellow: (s) => s, dim: (s) => s, bold: (s) => s };

console.log(C.bold('\nTenant-scoping guard — workers/src'));
console.log(C.dim(`Strict tables: ${STRICT_TABLES.join(', ')}`));
console.log(
  `Scanned ${scannedStatements} statement(s) touching org-owned tables: ` +
  `${C.green(`${scopedCount} org-scoped`)}, ` +
  `${C.yellow(`${waivers.length} waived`)}, ` +
  `${C.dim(`${altModel.length} alt-model`)}, ` +
  `${violations.length ? C.red(`${violations.length} VIOLATION(S)`) : C.green('0 violations')}.`,
);

if (waivers.length) {
  console.log(C.yellow('\nWaived (sibling-gated — ownership established before the read):'));
  for (const w of waivers) console.log(`  ${C.dim('~')} ${w.rel}:${w.line}  ${C.dim(w.snippet)}`);
}

if (altModel.length) {
  console.log(C.dim('\nAlt-model files (separately audited, not org_id-enforced):'));
  const seen = new Set();
  for (const a of altModel) {
    if (!seen.has(a.rel)) { seen.add(a.rel); console.log(`  ${C.dim('·')} ${a.rel} — ${ALT_MODEL_FILES[a.rel]}`); }
  }
}

if (dynamic.length) {
  console.log(C.yellow('\nNon-literal .prepare() calls (review by hand — guard can\'t read these):'));
  for (const d of dynamic) console.log(`  ${C.yellow('?')} ${d.rel}:${d.line}`);
}

if (violations.length) {
  console.log(C.red('\n✗ Unscoped org-owned-table access — these can leak across tenants:\n'));
  for (const v of violations) {
    console.log(`  ${C.red('✗')} ${C.bold(`${v.rel}:${v.line}`)}  ${C.dim(`[${v.tables.join(', ')}]`)}`);
    console.log(`     ${v.snippet}`);
  }
  console.log(
    '\n' + C.bold('Fix:') + ' add `AND org_id = ?` bound to c.get(\'user\').orgId, or — if the\n' +
    'query is provably safe without it — add `// ' + WAIVER_MARKER + ': <reason>` on the line\n' +
    'above. See the header of this file for the full contract.\n',
  );
  process.exit(1);
}

console.log(C.green('\n✓ Every org-owned-table query is org-scoped or explicitly waived.\n'));
process.exit(0);

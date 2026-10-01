// src/units/W39/LEDGER.unit.test.ts
//
// W39 — "Safe setup, seed and handoff".
//
// AUTHORITY (docs/remediation/delivery-control/program.json, ticket W39, quoting
// document 35 §5 row W39, line 446): "Quarantine/fix unsafe setup and unscoped seed
// commands; separate demo/customer assets/schema, review published backups, repair
// fresh-clone instructions and index. Test the actual seed order and repeat runs,
// scoped recovery and provenance. Untrack/remove user-owned or historical artifacts
// only under a reviewed authorized cleanup; this reconciliation deletes none."
//
// WITNESSES
//   · document 35 §2 F35 — "Scratch SQLite verification of the published seed order
//     reduced New York crosswalk rows from 14 to 1 and the demo cohort from 640 to 44
//     while replacing census provenance with a proxy … a backup under public is a
//     served artifact … Correct scoped/idempotent seeds, add a fresh-run/re-run
//     regression and reviewed recovery, and separate product/demo migrations";
//     §2 F09 ("repeated seeds"); §3 N27 ("Product/customer provisioning applies demo
//     schema and seeds").
//   · docs/architecture/35-verification-reports/F35.md §1.2 (README.md:267 names a
//     wrangler.toml.example that does not exist), §2.1 (the measured provenance: NY
//     crosswalk 14 ZIPs incl. 11215; metro 35620 = 99,852 / 648,800 / "Census ACS
//     2024 1-yr" / "2024"; 640 distinct Meridian shoppers in CBSA 35620), §4.2 (the
//     served backup public/meridian/_meridian-v1.js.bak; `.npmrc.bak` and the
//     "copy" duplicates in §1.1 item 11).
//   · docs/remediation/design/W39.02/plan.md — the source-stated base counts the
//     retained seeds must land: 71 catalog / 38 metadata / 3,200 profiles / 7,293
//     orders / 8,760 items.
//   · HANDOFF-2026-09-18 §6 W39 row; §7 Customer/demo boundary (decision D1: demo
//     assets stay out of the customer profile inside the existing entry point).
//
// SAFETY OF THIS FILE. Seed scripts run only against a database or a Worker this
// file creates in-process (node:sqlite in memory; a Hono app over synthetic R2
// behind a loopback HTTP server). Every script child runs under a guard that
// refuses — and records — every network request outside that loopback server and
// every write inside the checkout. No wrangler command is run.
//
// RULED READINGS
//   · "Seed commands" are the data seeds: scripts/seed-coach-content.mjs and
//     scripts/import-content.mjs (content into a tenant), scripts/seed-funnel.mjs
//     (the funnel seed emitter), the retained D1 seeds migrations/seed/*.sql, and the
//     retired scripts/seed-d1.mjs (its refusal is proven by scripts/seed-d1.test.mjs).
//     scripts/operator-seed.mjs is NOT one: operator accounts are shared identities
//     (HANDOFF §7, W02 decision), and its exact-target --remote path is the W08 owner
//     bootstrap and last-owner recovery.
//   · The named tenant is the existing `--scope <tenant>`; there is no default.
//   · A target is local when it is a loopback URL (scripts/lib/tool-token.mjs
//     isLoopbackTarget); anything else is remote. H3 as amended (A37, approved
//     2026-09-24): a remote target is allowed only through the W03 scoped tool
//     token — an operator token supplied explicitly (`--token` or OPERATOR_TOKEN),
//     never one minted from local signing material, which the Worker authorizes
//     for the named tenant alone (TENANTS operatorGrants). Without it a remote
//     target is refused before anything is minted or sent.
//   · The required publication headers (kit 02 §4, "Configuration PUT/PATCH,
//     import, pull, rollback and item reset require `If-Match: "N/S/H"` from the
//     actually loaded draft … Also retain `Idempotency-Key: N:UUID`"): every write
//     a seed sends carries both, with the same N.
//   · Idempotent on a repeat run: the second run succeeds and leaves every document
//     the seed publishes for that tenant with exactly the value the first run left.
//   · Scoped recovery is running the same seed again for the same tenant: it
//     completes an interrupted run and touches no other tenant.
//   · A published backup is a tracked file whose name marks it a backup or a copy
//     (`.bak`, `.orig`, `.backup`, `~`, " copy"); the listing is a line in README.md,
//     ONBOARDING.md or docs/deployment/01-deploy.md naming its repository path with
//     one of "kept", "redacted" or "proposed for authorized removal".

import { describe, it, expect, afterAll } from 'vitest';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { parse as parseToml } from 'smol-toml';
import type { Env } from '@/types/env';
import { initializePublicationSet, readPublication } from '@/config/publication';
import { invalidateCache, type DocumentKind } from '@/config/versionedStore';
import { CONTENT_KIND, DEFAULT_LEARN, DEFAULT_SLOTS, EMPTY_CATALOG, LEARN_KIND, SLOTS_KIND } from '@/content/kinds';
import { meridianRoutes } from '@/demos/meridian/routes';
import { EMPTY_PROPOSALS, PROPOSALS_KIND } from '@/learn/cycle';
import { EMPTY_PRIORS, PRIORS_KIND } from '@/learn/priors';
import { REFLEX_KIND, reflexScopeForTenant } from '@/reflex/configStore';
import { DEFAULT_REFLEX_CONFIG } from '@/reflex/core';
import { contentRoutes } from '@/routes/content';
import { tenantMiddleware } from '@/tenancy/middleware';

/** The checkout this file lives in (src/units/W39 → ../../..), never the cwd. */
const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\/$/, '');
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');
const TRACKED = execFileSync('git', ['-C', ROOT, 'ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
const TRACKED_SET = new Set(TRACKED);
const SECRET = 'w39-ledger-synthetic-signing-material';
const encoder = new TextEncoder();

// ===========================================================================
// unit:W39.H1 — every file and command the fresh-clone instructions name exists
// ===========================================================================

describe('unit:W39.H1', () => {
  /** Named by ONBOARDING.md §9 as credentials a clone must never carry, not as files to use. */
  const NEVER_CARRIED = new Set(['llm-models-keys.md', '.dev.vars']);
  /** Tools a fresh clone has without this repository providing them. */
  const SYSTEM_TOOLS = new Set(['git', 'cd', 'curl', 'mkdir', 'export', 'echo', 'cat', 'ls', 'open', 'sqlite3', 'source', 'set']);
  const EXTENSION = /\.(md|ts|tsx|js|mjs|cjs|json|toml|sql|html|sh|txt|css|ya?ml|example|docx|pdf|png|jpg|svg)$/i;

  it('H1: every repository file and every command README.md and ONBOARDING.md tell a fresh clone to use exists in the tracked tree', () => {
    const basenames = new Set(TRACKED.map(file => file.split('/').pop()!));
    const top = new Set(TRACKED.map(file => file.split('/')[0]!));
    const directories = new Set(TRACKED.flatMap(file => file.split('/').slice(0, -1).map((_, i, parts) => parts.slice(0, i + 1).join('/'))));
    const pkg = JSON.parse(read('package.json')) as { scripts?: Record<string, string>; dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    const dependencies = new Set(Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }));
    const binaries: Record<string, string> = { wrangler: 'wrangler', vitest: 'vitest', tsc: 'typescript', eslint: 'eslint', prettier: 'prettier', esbuild: 'esbuild' };
    const wrangler = parseToml(read('wrangler.toml')) as { env?: Record<string, unknown> };
    const envDeclaration = read('src/types/env.ts');
    const missing: string[] = [];
    const path = (where: string, token: string) => {
      let target = token.replace(/^[('"]+|[)'",.;:]+$/g, '').replace(/#.*$/, '').replace(/:\d+(-\d+)?$/, '').replace(/^\.\//, '');
      if (!target || /^[a-z][a-z0-9+.-]*:\/\//i.test(target) || target.startsWith('mailto:') || target.startsWith('/') || target.startsWith('<')
        || target.startsWith('@') || /\s/.test(target) || NEVER_CARRIED.has(target)) return;
      const first = target.split('/')[0]!;
      const repositoryPath = target.includes('/') ? top.has(first) || EXTENSION.test(target) : EXTENSION.test(target);
      if (!repositoryPath) return;
      target = target.replace(/\/$/, '');
      if (target.includes('*')) {
        const pattern = new RegExp('^' + target.split('*').map(part => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*') + '$');
        if (!TRACKED.some(file => pattern.test(file))) missing.push(`${where}: ${token} matches no tracked file`);
        return;
      }
      const exists = target.includes('/') ? TRACKED_SET.has(target) || directories.has(target) : basenames.has(target) || top.has(target);
      if (!exists) missing.push(`${where}: ${token} is not in the tracked tree`);
    };
    const command = (where: string, line: string) => {
      for (const part of line.split(/&&|\|\||;|\|/)) {
        const tokens = part.trim().split(/\s+/).filter(Boolean); if (!tokens.length) continue;
        const [program, ...args] = tokens as [string, ...string[]];
        if (program === 'npm') {
          const script = args[0] === 'run' ? args[1] : ['test', 'start'].includes(args[0] ?? '') ? args[0] : undefined;
          if (script && !pkg.scripts?.[script]) missing.push(`${where}: npm script "${script}" is not in package.json`);
        } else if (program === 'npx') {
          if (!dependencies.has(binaries[args[0] ?? ''] ?? args[0] ?? '')) missing.push(`${where}: npx ${args[0]} is not a dependency of this repository`);
        } else if (['node', 'bash', 'sh'].includes(program)) {
          const file = args.find(arg => !arg.startsWith('-')); if (file) path(where, file);
        } else if (program === 'cp') {
          const source = args.filter(arg => !arg.startsWith('-'))[0];
          if (source && !TRACKED_SET.has(source.replace(/^\.\//, ''))) missing.push(`${where}: cp source ${source} is not in the tracked tree`);
        } else if (program === 'wrangler') {
          if (!dependencies.has('wrangler')) missing.push(`${where}: wrangler is not a dependency of this repository`);
          if (args[0] === 'secret' && args[1] === 'put' && args[2] && !new RegExp(`\\b${args[2]}\\??:`).test(envDeclaration))
            missing.push(`${where}: secret ${args[2]} is not a binding the Worker declares (src/types/env.ts)`);
          const named = args.indexOf('--env');
          if (named >= 0 && args[named + 1] && !/^\w+\|/.test(args[named + 1]!) && !Object.hasOwn(wrangler.env ?? {}, args[named + 1]!))
            missing.push(`${where}: wrangler environment ${args[named + 1]} is not declared in wrangler.toml`);
          for (const arg of args) { const file = /^--file=(.+)$/.exec(arg)?.[1]; if (file) path(where, file); }
          const file = args.indexOf('--file'); if (file >= 0 && args[file + 1]) path(where, args[file + 1]!);
        } else if (program.startsWith('./')) path(where, program);
        else if (!SYSTEM_TOOLS.has(program) && !/^[A-Z_]+=/.test(program)) missing.push(`${where}: ${program} is neither provided by this repository nor a standard tool`);
      }
    };
    for (const doc of ['README.md', 'ONBOARDING.md']) {
      let fence: string | null = null, pending = '', pendingAt = '';
      read(doc).split('\n').forEach((text, index) => {
        const where = `${doc}:${index + 1}`, opening = /^\s*```(\S*)/.exec(text);
        if (opening) { fence = fence === null ? opening[1]!.toLowerCase() : null; pending = ''; return; }
        if (fence !== null) {
          if (!['bash', 'sh', 'shell', 'console'].includes(fence)) return;
          const code = text.replace(/^\s*\$\s+/, '').trim();
          if (!pending && code.startsWith('#')) { for (const token of code.split(/\s+/)) path(where, token); return; }
          // One shell command: backslash continuations and quoted strings spanning lines join it.
          pending = pending ? pending + ' ' + code : code; pendingAt ||= where;
          if (/\\+$/.test(pending)) { pending = pending.replace(/\\+$/, ''); return; }
          if ((pending.match(/'/g) ?? []).length % 2 === 1) return;
          if (pending) command(pendingAt, pending.replace(/'[^']*'/g, "''"));
          pending = ''; pendingAt = '';
          return;
        }
        for (const span of text.matchAll(/`([^`]+)`/g)) {
          if (/^(npm|npx|node|wrangler|bash|sh|cp)\s/.test(span[1]!)) command(where, span[1]!);
          for (const token of span[1]!.split(/\s+/)) path(where, token);
        }
        for (const link of text.matchAll(/\]\(([^)\s]+)\)/g)) path(where, link[1]!);
      });
    }
    expect(missing, 'W39.H1 — README.md and ONBOARDING.md name only files and commands a fresh clone actually has (F35 §1.2: README.md:267 names a wrangler.toml.example that does not exist)').toEqual([]);
  });
});

// ===========================================================================
// unit:W39.H2 — the default local database gets product migrations only
// ===========================================================================

interface SqliteDatabase { exec(sql: string): void; prepare(sql: string): { all(...args: unknown[]): Array<Record<string, unknown>>; get(...args: unknown[]): Record<string, unknown> | undefined; run(...args: unknown[]): unknown } }
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as { DatabaseSync: new (path: string) => SqliteDatabase };
/** A local database this file creates in memory, never a configured one. */
function localDatabase(): SqliteDatabase { const db = new DatabaseSync(':memory:'); db.exec('PRAGMA foreign_keys=ON'); return db; }
const sqlFiles = (directory: string) => TRACKED.filter(file => file.startsWith(directory + '/') && !file.slice(directory.length + 1).includes('/') && file.endsWith('.sql')).sort();
const tables = (db: SqliteDatabase) => db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row => String(row.name));

describe('unit:W39.H2', () => {
  it('H2: the default local database applies product migrations only; the demo chain needs an explicit request', () => {
    const config = parseToml(read('wrangler.toml')) as { d1_databases?: Array<{ binding: string; migrations_dir?: string }> };
    const product = sqlFiles('migrations/product').map(file => file.split('/').pop());
    expect(product.length, 'the product migration set').toBeGreaterThan(0);
    for (const database of config.d1_databases ?? []) {
      const directory = (database.migrations_dir ?? 'migrations').replace(/^\.\//, '').replace(/\/$/, '');
      expect(sqlFiles(directory).map(file => file.split('/').pop()),
        `W39.H2 — the default (top-level) D1 binding ${database.binding} applies the product migrations only, not the mixed demo chain of "${directory}" (wrangler.toml, N27)`).toEqual(product);
      const applied = localDatabase(), demo = localDatabase();
      for (const file of sqlFiles(directory)) applied.exec(read(file));
      for (const file of sqlFiles('migrations').filter(file => !product.includes(file.split('/').pop()))) demo.exec(read(file));
      const leaked = tables(applied).filter(name => tables(demo).includes(name) && !name.startsWith('operator_'));
      expect(leaked, `W39.H2 — a local database migrated from the default ${database.binding} declaration holds no demo table`).toEqual([]);
    }
  });

  it('H2: each migrations/product copy is byte-identical to its top-level duplicate, or the duplicate is no longer maintained', () => {
    const drift = sqlFiles('migrations/product').map(file => file.split('/').pop()!)
      .filter(name => TRACKED_SET.has('migrations/' + name) && read('migrations/' + name) !== read('migrations/product/' + name));
    expect(drift, 'W39.H2 — the duplicated product migrations are identical').toEqual([]);
  });
});

// ===========================================================================
// seed harness: a local in-process Worker, a guard, and the script children
// ===========================================================================

class SeedR2 {
  objects = new Map<string, string>(); etags = new Map<string, string>(); seq = 0;
  /** A pre-write storage outage on the first put matching this predicate. */
  failOnce?: (key: string) => boolean;
  async get(key: string) {
    const raw = this.objects.get(key); if (raw === undefined) return null;
    return { key, etag: this.etags.get(key)!, size: encoder.encode(raw).byteLength, body: new Response(raw).body, text: async () => raw, json: async () => JSON.parse(raw) as unknown };
  }
  async put(key: string, raw: string, options?: R2PutOptions) {
    if (this.failOnce?.(key)) { this.failOnce = undefined; throw new Error('W39 synthetic storage outage'); }
    const condition = options?.onlyIf, exists = this.objects.has(key);
    if (condition instanceof Headers ? condition.get('If-None-Match') === '*' && exists
      : condition && 'etagMatches' in condition && condition.etagMatches !== this.etags.get(key)) return null;
    this.objects.set(key, raw); this.etags.set(key, 'w39-' + (++this.seq));
    return { key, etag: this.etags.get(key)!, size: encoder.encode(raw).byteLength };
  }
  async list(options?: { prefix?: string }) { return { objects: [...this.objects.keys()].filter(key => key.startsWith(options?.prefix ?? '')).sort().map(key => ({ key })), truncated: false, delimitedPrefixes: [] }; }
  /** Every stored object of one tenant, as bytes. */
  of(tenant: string) {
    const owned = [...this.objects].filter(([key]) => [tenant, reflexScopeForTenant(tenant)].includes(key.split('/')[2]!));
    expect(owned.length, `the synthetic storage holds ${tenant}'s publication`).toBeGreaterThan(0);
    return JSON.stringify(owned.sort(([a], [b]) => a.localeCompare(b)));
  }
}
const KINDS = [CONTENT_KIND, SLOTS_KIND, LEARN_KIND, REFLEX_KIND, PRIORS_KIND, PROPOSALS_KIND] as DocumentKind<unknown>[];
const TENANTS = ['coach', 'tapestry', 'atelier'];
/** The environment the local Worker runs under, each tenant initialized by the authorized initializer (kit 02 §4). */
async function seedEnvironment() {
  const storage = new SeedR2();
  const env = { CACHE: { get: async () => null, put: async () => undefined }, STORAGE: storage, JWT_SECRET: SECRET, JWT_ISSUER: 'i', JWT_AUDIENCE: 'a',
    // The W03 scoped tool tokens: one operator per seeded tenant, granted that tenant alone.
    TENANTS: JSON.stringify({ provisioned: TENANTS, operatorGrants: { 'seed-coach-content': TENANTS, 'import-content': TENANTS,
      ...Object.fromEntries(TENANTS.map(tenant => [`w39-scoped-${tenant}`, [tenant]])) } }) } as unknown as Env;
  const values: Record<string, unknown> = { content: EMPTY_CATALOG, slots: DEFAULT_SLOTS, learn: DEFAULT_LEARN, reflex: DEFAULT_REFLEX_CONFIG, prior: EMPTY_PRIORS, proposals: EMPTY_PROPOSALS };
  for (const tenant of TENANTS) await initializePublicationSet(env, KINDS.map(kind => ({ kind, scope: kind.name === 'reflex' ? reflexScopeForTenant(tenant) : tenant,
    revision: { revision: 1, value: values[kind.name], actor: 'w39-initializer', note: '', at: 1 } })), '0:' + crypto.randomUUID());
  invalidateCache();
  return { env, storage };
}
/** The Worker's own content and demo-catalog routes behind a loopback HTTP server. */
async function localWorker(env: Env) {
  const app = new Hono<{ Bindings: Env; Variables: { tenant: string } }>();
  app.use('/content/*', tenantMiddleware()); app.route('/content', contentRoutes); app.route('/meridian/api', meridianRoutes);
  let requests = 0, port = 0; const log: string[] = [];
  /** What each request the Worker answered carried: the tenant selectors, the bearer and the publication headers. */
  const seen: Array<{ method: string; path: string; status: number; scope: string | null; tenant: string | null; authorization: string | null; ifMatch: string | null; idempotencyKey: string | null }> = [];
  const server = createServer((req, res) => {
    requests++; const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => { void (async () => {
      const headers = new Headers();
      for (const [name, value] of Object.entries(req.headers)) if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
      const response = await app.request(`http://127.0.0.1:${port}${req.url}`, { method: req.method, headers,
        body: req.method === 'GET' || req.method === 'HEAD' ? undefined : Buffer.concat(chunks) }, env);
      const body = Buffer.from(await response.arrayBuffer());
      log.push(`${req.method} ${req.url?.split('?')[0]} ${response.status}${response.status >= 400 ? ' ' + body.toString('utf8').slice(0, 120) : ''}`);
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      seen.push({ method: req.method ?? '', path: url.pathname, status: response.status, scope: url.searchParams.get('scope'), tenant: headers.get('x-tenant'),
        authorization: headers.get('authorization'), ifMatch: headers.get('if-match'), idempotencyKey: headers.get('idempotency-key') });
      res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(body);
    })().catch(error => { res.writeHead(500); res.end(String(error)); }); });
  });
  await new Promise<void>(accept => server.listen(0, '127.0.0.1', accept));
  port = (server.address() as AddressInfo).port;
  return { base: `http://127.0.0.1:${port}`, requests: () => requests, log: () => log.join(' | '), seen: () => [...seen], close: () => new Promise<void>(accept => server.close(() => accept())) };
}

const scratch = mkdtempSync(join(tmpdir(), 'w39-ledger-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
/**
 * Preloaded into every script child: records and refuses every network request
 * that is not to the allowed loopback Worker, and every write inside the checkout.
 */
const GUARD = join(scratch, 'guard.mjs');
writeFileSync(GUARD, `import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = process.env.W39_GUARD_ROOT, log = process.env.W39_GUARD_LOG, allow = process.env.W39_GUARD_ALLOW || '\\u0000';
const remote = process.env.W39_GUARD_REMOTE || '\\u0000', forward = process.env.W39_GUARD_FORWARD;
const append = fs.appendFileSync.bind(fs), realFetch = globalThis.fetch;
const record = (kind, target) => append(log, JSON.stringify({ kind, target }) + '\\n');
const pathOf = (p) => { try { return resolve(String(p instanceof URL ? fileURLToPath(p) : p)); } catch { return ''; } };
const inside = (p) => { const abs = pathOf(p); return abs === root || abs.startsWith(root + '/'); };
const refused = () => Object.assign(new Error('W39 guard: write refused'), { code: 'EACCES' });
const targets = (name, args) => ['copyFile', 'copyFileSync', 'rename', 'renameSync', 'cp', 'cpSync', 'symlink', 'symlinkSync', 'link', 'linkSync'].includes(name) ? [args[1]] : [args[0]];
const writing = (name, args) => name !== 'open' && name !== 'openSync' || /[wa+]/.test(String(args[1] ?? 'r'));
const guard = (host, name, style) => { const original = host[name]; if (typeof original !== 'function') return;
  host[name] = function (...args) {
    const hit = writing(name, args) && targets(name, args).find(t => typeof t !== 'number' && inside(t));
    if (!hit) return original.apply(this, args);
    record('write', pathOf(hit));
    if (style === 'callback' && typeof args[args.length - 1] === 'function') { process.nextTick(args[args.length - 1], refused()); return; }
    if (style === 'promise') return Promise.reject(refused());
    throw refused();
  }; };
const names = ['writeFile', 'appendFile', 'copyFile', 'rename', 'rm', 'unlink', 'mkdir', 'truncate', 'open', 'cp', 'symlink', 'link', 'rmdir'];
for (const name of names) { guard(fs, name + 'Sync', 'sync'); guard(fs, name, 'callback'); guard(fs.promises, name, 'promise'); }
guard(fs, 'createWriteStream', 'sync');
syncBuiltinESMExports();
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  record('fetch', url);
  if (url.startsWith(allow)) return realFetch(input, init);
  // A stand-in for a remote Worker: the named remote origin is served by the local one.
  if (forward && url.startsWith(remote + '/')) return realFetch(forward + url.slice(remote.length), init);
  throw new TypeError('W39 guard: network refused');
};
`);
interface Guarded { code: number | null; stdout: string; stderr: string; fetches: string[]; writes: string[] }
let runs = 0;
function runScript(script: string, args: string[], allow?: string, remote?: { origin: string; forward: string }): Promise<Guarded> {
  const log = join(scratch, `guard-${++runs}.ndjson`); writeFileSync(log, '');
  return new Promise(accept => {
    const child = spawn(process.execPath, ['--import', pathToFileURL(GUARD).href, join(ROOT, script), ...args], {
      cwd: ROOT, timeout: 60_000, stdio: ['ignore', 'pipe', 'pipe'],
      env: { PATH: process.env.PATH ?? '', HOME: scratch, W39_GUARD_ROOT: ROOT, W39_GUARD_LOG: log, ...(allow ? { W39_GUARD_ALLOW: allow } : {}),
        ...(remote ? { W39_GUARD_REMOTE: remote.origin, W39_GUARD_FORWARD: remote.forward } : {}),
        DEPLOYMENT_PROFILE: 'demo', JWT_SECRET: SECRET, JWT_ISSUER: 'i', JWT_AUDIENCE: 'a' } });
    let stdout = '', stderr = '';
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk; }); child.stderr.on('data', (chunk: Buffer) => { stderr += chunk; });
    child.on('close', code => {
      const events = readFileSync(log, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line) as { kind: string; target: string });
      accept({ code, stdout, stderr, fetches: events.filter(e => e.kind === 'fetch').map(e => e.target), writes: events.filter(e => e.kind === 'write').map(e => e.target) });
    });
  });
}
const SEEDS: Array<{ script: string; tenant: string; documents: DocumentKind<unknown>[] }> = [
  { script: 'scripts/seed-coach-content.mjs', tenant: 'coach', documents: [CONTENT_KIND, SLOTS_KIND, LEARN_KIND] as DocumentKind<unknown>[] },
  { script: 'scripts/import-content.mjs', tenant: 'tapestry', documents: [CONTENT_KIND, SLOTS_KIND] as DocumentKind<unknown>[] },
];
const documentsOf = async (env: Env, tenant: string, kinds: DocumentKind<unknown>[]) => {
  invalidateCache(); const out: Record<string, unknown> = {};
  for (const kind of kinds) out[kind.name] = (await readPublication(env, kind, tenant)).value;
  return out;
};

// ===========================================================================
// unit:W39.H3 — seeds take a named tenant, repeat idempotently, send the publication
// headers and refuse an unscoped target; a remote target only through the W03 scoped tool token
// ===========================================================================

/** A remote Worker's origin, stood in for by the local one through the guard (never resolved). */
const REMOTE = 'https://edge-platform-production.example.invalid';
/** The W03 scoped tool token for one tenant: an operator token issued outside the tool and granted that tenant alone. */
const scopedToolToken = (tenant: string) => new SignJWT({ type: 'service', roles: ['operator'] }).setProtectedHeader({ alg: 'HS256' })
  .setSubject(`w39-scoped-${tenant}`).setIssuedAt().setIssuer('i').setAudience('a').setExpirationTime('10m').sign(encoder.encode(SECRET));

describe('unit:W39.H3', () => {
  it('H3: each content seed command refuses to run without a named tenant, before any request — against a local Worker and against a remote one with the W03 scoped tool token', async () => {
    const { env } = await seedEnvironment(), worker = await localWorker(env);
    try {
      for (const { script, tenant } of SEEDS) {
        const local = await runScript(script, ['--base', worker.base, '--token', 'w39-synthetic-opaque-token'], worker.base);
        expect({ refused: local.code !== 0, requests: local.fetches }, `W39.H3 — ${script} without --scope refuses and sends nothing: an unscoped seed never picks a default tenant`)
          .toEqual({ refused: true, requests: [] });
        const remote = await runScript(script, ['--base', REMOTE, '--token', await scopedToolToken(tenant)], undefined, { origin: REMOTE, forward: worker.base });
        expect({ refused: remote.code !== 0, requests: remote.fetches }, `W39.H3 — ${script} without --scope refuses a remote target too, holding the scoped tool token, and sends nothing`)
          .toEqual({ refused: true, requests: [] });
      }
      expect(worker.requests(), 'no request reached the Worker').toBe(0);
    } finally { await worker.close(); }
  }, 60_000);

  it('H3: each content seed command refuses a remote target without the W03 scoped tool token — nothing is minted and nothing is sent, although local signing material is present', async () => {
    for (const { script, tenant } of SEEDS) {
      for (const base of [REMOTE, 'http://localhost@remote.example.invalid']) {
        const run = await runScript(script, ['--scope', tenant, '--base', base]);
        expect({ refused: run.code !== 0, requests: run.fetches }, `W39.H3 — ${script} --scope ${tenant} refuses the remote target ${base} without the scoped tool token, and sends nothing`)
          .toEqual({ refused: true, requests: [] });
      }
    }
  }, 60_000);

  it('H3: with the W03 scoped tool token each content seed command seeds its named tenant on a remote target — every request carries that token and that tenant, and every write the required publication headers', async () => {
    const { env, storage } = await seedEnvironment(), worker = await localWorker(env);
    // The Worker's own catalogue pull reaches the same stand-in for the remote Worker.
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      return url.startsWith(REMOTE + '/') ? realFetch(worker.base + url.slice(REMOTE.length), init) : realFetch(input, init);
    }) as typeof fetch;
    try {
      for (const { script, tenant, documents } of SEEDS) {
        const bystander = storage.of('atelier'), token = await scopedToolToken(tenant), from = worker.seen().length;
        const run = await runScript(script, ['--scope', tenant, '--base', REMOTE, '--token', token], undefined, { origin: REMOTE, forward: worker.base });
        const seen = worker.seen().slice(from).filter(request => request.path.startsWith('/content/'));
        // A write is any request with an effect: every method but GET, save a dry-run validation.
        const writes = seen.filter(request => request.method !== 'GET' && !request.path.endsWith('/validate'));
        expect(writes.length, `${script} writes its documents`).toBeGreaterThan(0);
        expect(writes.map(({ method, path, ifMatch, idempotencyKey }) => ({ method, path, ifMatch, idempotencyKey })),
          `W39.H3 — every write ${script} sends carries the required publication headers: If-Match "N/S/H" from the loaded draft and Idempotency-Key "N:UUID" (kit 02 §4); the Worker answered: ${worker.log().slice(-300)}`)
          .toEqual(writes.map(({ method, path }) => ({ method, path, ifMatch: expect.stringMatching(/^"[1-9]\d*\/[1-9]\d*\/[0-9a-f]{64}"$/), idempotencyKey: expect.stringMatching(/^[1-9]\d*:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/) })));
        for (const write of writes) expect(String(write.idempotencyKey).split(':')[0], `${write.method} ${write.path}: the Idempotency-Key names the draft revision the If-Match names`).toBe(String(write.ifMatch).slice(1).split('/')[0]);
        expect(run.code, `W39.H3 — ${script} --scope ${tenant} completes against the remote target with the scoped tool token; the Worker answered: ${worker.log().slice(-300)}`).toBe(0);
        expect(seen.map(({ scope, tenant: selected, authorization }) => ({ scope, tenant: selected, authorization })),
          `W39.H3 — every request ${script} sends names ${tenant} and carries the scoped tool token it was given`)
          .toEqual(seen.map(() => ({ scope: tenant, tenant, authorization: `Bearer ${token}` })));
        expect(run.fetches.every(url => url.startsWith(REMOTE + '/')), 'every request went to the remote target').toBe(true);
        expect(((await documentsOf(env, tenant, documents)).content as { pieces: unknown[] }).pieces.length, `${script} published its catalog for ${tenant}`).toBeGreaterThan(0);
        expect(storage.of('atelier'), `W39.H3 — ${script} for ${tenant} touches no other tenant`).toBe(bystander);
      }
    } finally { globalThis.fetch = realFetch; await worker.close(); }
  }, 120_000);

  /**
   * Idempotent on a repeat run: the second run leaves every document with exactly
   * the content the first run left. The one field a seed cannot hold still is the
   * revision stamp the platform writes into a document's version label on every
   * publication (`+r<revision>`, src/content/kinds.ts:18-21): an importer can only
   * publish through the Worker's pull, which always publishes, so that stamp is set
   * aside and nothing else is.
   */
  const unstamped = (documents: Record<string, unknown>) => Object.fromEntries(Object.entries(documents).map(([kind, value]) => [kind,
    value && typeof value === 'object' && typeof (value as { version?: unknown }).version === 'string'
      ? { ...value, version: (value as { version: string }).version.replace(/\+r\d+$/, '') } : value]));
  it('H3: each content seed command, run twice for its named tenant against a local Worker, succeeds both times and the second run changes no document content', async () => {
    const { env, storage } = await seedEnvironment(), worker = await localWorker(env);
    try {
      for (const { script, tenant, documents } of SEEDS) {
        const bystander = storage.of('atelier');
        const first = await runScript(script, ['--scope', tenant, '--base', worker.base], worker.base);
        expect(first.code, `W39.H3 — ${script} --scope ${tenant} completes against a local Worker; the Worker answered: ${worker.log().slice(-400)}`).toBe(0);
        const once = await documentsOf(env, tenant, documents);
        expect((once.content as { pieces: unknown[] }).pieces.length, `${script} published its catalog for ${tenant}`).toBeGreaterThan(0);
        const second = await runScript(script, ['--scope', tenant, '--base', worker.base], worker.base);
        expect(second.code, `W39.H3 — the repeat run of ${script} succeeds`).toBe(0);
        expect(unstamped(await documentsOf(env, tenant, documents)), `W39.H3 — the repeat run of ${script} leaves every document it seeds for ${tenant} with exactly the content the first run left (the platform's revision stamp aside)`).toEqual(unstamped(once));
        expect(storage.of('atelier'), `W39.H3 — ${script} for ${tenant} touches no other tenant`).toBe(bystander);
        expect([...first.fetches, ...second.fetches].every(url => url.startsWith(worker.base)), 'every request went to the local Worker').toBe(true);
      }
    } finally { await worker.close(); }
  }, 120_000);

  it('H3: scripts/seed-funnel.mjs no longer writes into migrations/', async () => {
    const run = await runScript('scripts/seed-funnel.mjs', []);
    expect(run.writes.filter(target => target.startsWith(join(ROOT, 'migrations') + '/')),
      'W39.H3 — the funnel seed emitter writes nothing into migrations/ (a generator that rewrites a migration is not a seed command)').toEqual([]);
    expect(run.fetches, 'the funnel seed emitter makes no request').toEqual([]);
  }, 60_000);
});

// ===========================================================================
// unit:W39.H4 — the seed order and scoped recovery, run twice against a local database
// ===========================================================================

describe('unit:W39.H4', () => {
  /** The demo chain as an explicit demo request applies it, then the seeds in their order. */
  function migratedDemo() { const db = localDatabase(); for (const file of sqlFiles('migrations')) db.exec(read(file)); return db; }
  const seeds = () => sqlFiles('migrations/seed');
  const runSeeds = (db: SqliteDatabase) => { for (const file of seeds()) db.exec(read(file)); };
  const digest = (db: SqliteDatabase, table: string) => {
    const columns = db.prepare(`PRAGMA table_info("${table}")`).all().map((_, i) => String(i + 1)).join(', ');
    return createHash('sha256').update(JSON.stringify(db.prepare(`SELECT * FROM "${table}" ORDER BY ${columns}`).all())).digest('hex');
  };
  const digests = (db: SqliteDatabase) => Object.fromEntries(tables(db).map(table => [table, digest(db, table)]));
  const one = (db: SqliteDatabase, sql: string) => Number(db.prepare(sql).get()!.n);

  it('H4: the D1 seeds, run twice in order against a local database, land the stated rows and provenance and the second run changes nothing', () => {
    const db = migratedDemo(); runSeeds(db);
    expect({
      catalog: one(db, 'SELECT count(*) n FROM coach_catalog'), metadata: one(db, 'SELECT count(*) n FROM meta_attribute_catalog'),
      profiles: one(db, "SELECT count(*) n FROM coach_odp_profiles WHERE vuid NOT LIKE 'v-nc-%'"),
      orders: one(db, "SELECT count(*) n FROM coach_transactions WHERE order_id NOT LIKE 'ordnc-%'"),
      items: one(db, "SELECT count(*) n FROM coach_purchase_items WHERE vuid NOT LIKE 'v-nc-%'"),
    }, 'W39.H4 — the base seeds land the source-stated rows (W39.02: 71 / 38 / 3,200 / 7,293 / 8,760)').toEqual({ catalog: 71, metadata: 38, profiles: 3200, orders: 7293, items: 8760 });
    const provenance = () => ({
      nyZips: one(db, "SELECT count(*) n FROM geo_xref WHERE region = 'NY'"), parkSlope: one(db, "SELECT count(*) n FROM geo_xref WHERE zip = '11215'"),
      metro: db.prepare("SELECT median_hh_income_usd AS income, median_home_value_usd AS home, source, vintage FROM geo_census WHERE geo_level = 'metro' AND geo_key = '35620'").get(),
      cohort: one(db, "SELECT COUNT(DISTINCT t.vuid) n FROM mrd_transactions t JOIN geo_xref x ON x.zip = t.billing_postal_code WHERE x.metro_cbsa = '35620'"),
    });
    const expected = { nyZips: 14, parkSlope: 1, metro: { income: 99852, home: 648800, source: 'Census ACS 2024 1-yr', vintage: '2024' }, cohort: 640 };
    expect(provenance(), 'W39.H4 — the documented order keeps the real census provenance and the 640-shopper NY metro cohort (F35 §2.1)').toEqual(expected);
    const first = digests(db); runSeeds(db);
    expect(digests(db), 'W39.H4 — the second run of the seeds changes no row of any table').toEqual(first);
    expect(provenance()).toEqual(expected);
  });

  it('H4: running the D1 seeds again is the scoped recovery — lost Coach seed rows come back and no other tenant\'s or shared row changes', () => {
    const db = migratedDemo(); runSeeds(db);
    db.exec("INSERT INTO geo_xref (zip, metro_cbsa, region, country) VALUES ('99999', NULL, 'ZZ', 'US')");
    const meridian = db.prepare('SELECT * FROM mrd_transactions LIMIT 1').get()!;
    db.prepare(`INSERT INTO mrd_transactions (${Object.keys(meridian).join(',')}) VALUES (${Object.keys(meridian).map(() => '?').join(',')})`)
      .run(...Object.values(meridian).map((value, i) => i === 0 ? 'ord-w39-sentinel' : value));
    const before = digests(db);
    db.exec('DELETE FROM coach_purchase_items WHERE item_id IN (SELECT item_id FROM coach_purchase_items ORDER BY item_id LIMIT 25)');
    db.exec('DELETE FROM meta_attribute_catalog WHERE key IN (SELECT key FROM meta_attribute_catalog ORDER BY key LIMIT 2)');
    runSeeds(db);
    expect(digests(db), 'W39.H4 — rerunning the seeds restores exactly the lost Coach rows and leaves every other table, the Meridian sentinel order and the unrelated ZIP as they were').toEqual(before);
  });

  it('H4: an interrupted content seed is recovered by running it again for the same tenant, with the same result as an uninterrupted run and no other tenant touched', async () => {
    const reference = await seedEnvironment(), clean = await localWorker(reference.env);
    let expected: Record<string, unknown>;
    try {
      const run = await runScript('scripts/seed-coach-content.mjs', ['--scope', 'coach', '--base', clean.base], clean.base);
      expect(run.code, `W39.H4 — the uninterrupted Coach seed completes against a local Worker; the Worker answered: ${clean.log().slice(-400)}`).toBe(0);
      expected = await documentsOf(reference.env, 'coach', SEEDS[0]!.documents);
    } finally { await clean.close(); }
    const { env, storage } = await seedEnvironment(), worker = await localWorker(env);
    try {
      const bystander = storage.of('atelier');
      // The storage fails once while the catalog publication is being finalized, leaving it pending.
      storage.failOnce = key => /^config-publication\/v2\/coach\/set\/\d+\.json$/.test(key);
      await runScript('scripts/seed-coach-content.mjs', ['--scope', 'coach', '--base', worker.base], worker.base);
      const recovery = await runScript('scripts/seed-coach-content.mjs', ['--scope', 'coach', '--base', worker.base], worker.base);
      expect(recovery.code, `W39.H4 — running the seed again for the same tenant completes the interrupted run; the Worker answered: ${worker.log().slice(-400)}`).toBe(0);
      expect(await documentsOf(env, 'coach', SEEDS[0]!.documents), 'W39.H4 — after recovery the tenant holds exactly what an uninterrupted seed leaves').toEqual(expected);
      const head = JSON.parse(storage.objects.get('config-publication/v2/coach/head.json')!) as { pending: unknown };
      expect(head.pending, 'W39.H4 — no publication is left pending').toBeNull();
      expect(storage.of('atelier'), 'W39.H4 — recovery touches no other tenant').toBe(bystander);
    } finally { await worker.close(); }
  }, 120_000);
});

// ===========================================================================
// unit:W39.H5 — each published backup is listed with its disposition
// ===========================================================================

describe('unit:W39.H5', () => {
  const BACKUP = /(\.(bak|orig|backup)|~| copy(\.[^/]*)?)$/i;
  it('H5: each published backup is listed as kept, redacted or proposed for authorized removal, and this ticket deletes none', () => {
    const backups = TRACKED.filter(file => BACKUP.test(file));
    expect(backups, 'W39.H5 — the served backup F35 §4.2 names is still tracked: this reconciliation deletes nothing (document 35 §5 row W39, decision D2)').toContain('public/meridian/_meridian-v1.js.bak');
    const lines = ['README.md', 'ONBOARDING.md', 'docs/deployment/01-deploy.md'].flatMap(doc => read(doc).split('\n'));
    const unlisted = backups.filter(file => !lines.some(line => line.includes(file) && /\b(kept|redacted|proposed for authorized removal)\b/i.test(line)));
    expect(unlisted, 'W39.H5 — every published backup is listed with its disposition (kept, redacted or proposed for authorized removal) in README.md, ONBOARDING.md or docs/deployment/01-deploy.md').toEqual([]);
  });
});

#!/usr/bin/env node
/* eslint-env node */
// scripts/init-local.mjs — prepare a fresh clone's LOCAL worker store for one named tenant.
//
//   node scripts/init-local.mjs --scope <tenant> [--demo-data] [--persist-to <dir>]
//
// Run it before `npm run dev` (or with the dev server stopped), then seed content with the same
// tenant. It acts only on the local store `wrangler dev` reads (`.wrangler/state` beside
// wrangler.toml, or the `--persist-to` directory you also give `wrangler dev`), inside a local
// workerd runtime that refuses every network request. There is no --remote and no --env: a
// deployed database or bucket is never touched here.
//
//   1. The local D1 database gets the PRODUCT migrations only (the directory the default
//      [[d1_databases]] declaration names, migrations/product), each once, recorded in the same
//      d1_migrations table `wrangler d1 migrations apply --local` keeps. Each product migration
//      must be byte-identical to its historical duplicate under migrations/, or nothing runs.
//   2. Demo data only when asked for with --demo-data: the demo migration chain migrations/*.sql
//      in order (each once, recorded the same way), then the demo seeds migrations/seed/*.sql in
//      order. The seeds add missing rows and keep existing ones, so running them again changes
//      nothing and restores rows a local database lost.
//   3. The named tenant's configuration publication is initialized from the compiled defaults
//      (catalog, slots, learning, Reflex, priors, proposals) by the library initializer
//      (src/config/publication.ts), the one authorized initializer: no HTTP route initializes a
//      publication, and a content seed has no draft to write over until this has run. An already
//      initialized tenant is left untouched; an initialization a failure interrupted is finished by
//      running the same command again.
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseToml } from 'smol-toml';

const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');
const USAGE = 'usage: node scripts/init-local.mjs --scope <tenant> [--demo-data] [--persist-to <dir>]';
const refuse = (message) => { console.error(`init-local: ${message}\n${USAGE}\nNothing was changed.`); process.exit(2); };

// ── Arguments: a named tenant, the explicit demo request, the local store. Nothing else. ───────
const options = { scope: undefined, demoData: false, persistTo: undefined };
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const name = argv[i];
  if (name === '--demo-data') {
    if (options.demoData) refuse('--demo-data is given twice');
    options.demoData = true;
  } else if (name === '--scope' || name === '--persist-to') {
    const key = name === '--scope' ? 'scope' : 'persistTo', value = argv[++i];
    if (options[key] !== undefined) refuse(`${name} is given twice`);
    if (typeof value !== 'string' || !value || value.startsWith('--')) refuse(`${name} needs a value`);
    options[key] = value;
  } else refuse(`unknown option ${JSON.stringify(name)}: this command acts on the local store only`);
}
if (options.scope === undefined) refuse('name the tenant with --scope <tenant>; an unscoped initialization is refused');
if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(options.scope)) refuse(`${JSON.stringify(options.scope)} is not a tenant id (lowercase letters, digits and dashes, at most 32)`);

// ── The local worker's own declarations (top-level wrangler.toml, what `wrangler dev` runs) ─────
const config = parseToml(readFileSync(join(ROOT, 'wrangler.toml'), 'utf8'));
const database = (config.d1_databases ?? []).find((db) => db?.binding === 'DB');
const bucket = (config.r2_buckets ?? []).find((b) => b?.binding === 'STORAGE');
if (!database || typeof database.database_id !== 'string' || !bucket || typeof bucket.bucket_name !== 'string') {
  refuse('wrangler.toml declares no DB database or STORAGE bucket for the local worker');
}
const productDirectory = String(database.migrations_dir ?? 'migrations').replace(/^\.\//, '').replace(/\/$/, '');
if (productDirectory !== 'migrations/product') {
  refuse(`the default local database must apply the product migrations only (migrations_dir = "migrations/product"), not "${productDirectory}"`);
}
const sqlFiles = (directory) => readdirSync(join(ROOT, directory), { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith('.sql')).map((entry) => entry.name).sort();
const product = sqlFiles('migrations/product'), chain = sqlFiles('migrations'), seeds = sqlFiles('migrations/seed');
for (const name of [...product, ...chain, ...seeds]) if (!/^[\w.-]+\.sql$/.test(name)) refuse(`unexpected migration name ${JSON.stringify(name)}`);
for (const name of product) {
  if (chain.includes(name) && !readFileSync(join(ROOT, 'migrations', name)).equals(readFileSync(join(ROOT, 'migrations/product', name)))) {
    refuse(`migrations/product/${name} differs from its duplicate migrations/${name}; the two copies must stay byte-identical`);
  }
}

// ── SQL files through the local D1 binding ─────────────────────────────────────────────────────
/** Below the statement length the local database accepts (SQLITE_TOOBIG past about 100 kB). */
const STATEMENT_LIMIT = 90 * 1024;
/**
 * The statements of one SQL file: split at `;` outside quoted strings, quoted identifiers and
 * comments. A file holding a trigger (whose body contains `;`) is not split: null.
 */
function statementsOf(sql) {
  const parts = [];
  let start = 0, i = 0, code = '';
  while (i < sql.length) {
    const c = sql[i];
    if (c === "'" || c === '"' || c === '`') {
      i++;
      while (i < sql.length && !(sql[i] === c && sql[i + 1] !== c)) i += sql[i] === c ? 2 : 1;
      i++; code += ' ';
    } else if (c === '-' && sql[i + 1] === '-') {
      while (i < sql.length && sql[i] !== '\n') i++;
    } else if (c === '/' && sql[i + 1] === '*') {
      const end = sql.indexOf('*/', i + 2); i = end < 0 ? sql.length : end + 2;
    } else {
      code += c;
      if (c === ';') { parts.push({ sql: sql.slice(start, i + 1), code }); start = i + 1; code = ''; }
      i++;
    }
  }
  parts.push({ sql: sql.slice(start), code });
  if (parts.some((part) => /\bCREATE\s+(TEMP\s+|TEMPORARY\s+)?TRIGGER\b/i.test(part.code))) return null;
  return parts.filter((part) => part.code.replace(/;/g, '').trim()).map((part) => part.sql);
}

// ── The library initializer, bundled for workerd exactly as the Worker's own modules are ────────
const WRAPPER = `
import { initializePublicationSet } from './src/config/publication';
import { CONTENT_KIND, DEFAULT_LEARN, DEFAULT_SLOTS, EMPTY_CATALOG, LEARN_KIND, SLOTS_KIND } from './src/content/kinds';
import { EMPTY_PROPOSALS, PROPOSALS_KIND } from './src/learn/cycle';
import { EMPTY_PRIORS, PRIORS_KIND } from './src/learn/priors';
import { REFLEX_KIND, reflexScopeForTenant } from './src/reflex/configStore';
import { DEFAULT_REFLEX_CONFIG } from './src/reflex/core';
export default {
  async fetch(request, env) {
    const tenant = new URL(request.url).searchParams.get('scope') ?? '';
    try {
      const found = await env.STORAGE.get('config-publication/v2/' + tenant + '/head.json');
      let operationId = '0:' + crypto.randomUUID(), at = Date.now(), state = 'initialized';
      if (found) {
        const head = await found.json();
        if (head && head.committed) return Response.json({ state: 'already initialized', publication: head.committed.revision });
        const operation = head && head.pending && head.pending.set && head.pending.set.operation;
        if (!operation || operation.initialize !== true) return Response.json({ error: 'the stored publication head is not an initialization this command can finish' }, { status: 409 });
        // An interrupted initialization: the same request again, which the initializer finishes.
        operationId = operation.operationId; at = operation.at; state = 'initialization finished';
      }
      const revision = (value) => ({ revision: 1, value, actor: 'init-local', note: 'local initialization from the compiled defaults (scripts/init-local.mjs)', at });
      const set = await initializePublicationSet(env, [
        { kind: CONTENT_KIND, scope: tenant, revision: revision(EMPTY_CATALOG) },
        { kind: SLOTS_KIND, scope: tenant, revision: revision(DEFAULT_SLOTS) },
        { kind: LEARN_KIND, scope: tenant, revision: revision(DEFAULT_LEARN) },
        { kind: REFLEX_KIND, scope: reflexScopeForTenant(tenant), revision: revision(DEFAULT_REFLEX_CONFIG) },
        { kind: PRIORS_KIND, scope: tenant, revision: revision(EMPTY_PRIORS) },
        { kind: PROPOSALS_KIND, scope: tenant, revision: revision(EMPTY_PROPOSALS) },
      ], operationId);
      return Response.json({ state, publication: set.revision });
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : String(error), code: error && error.code }, { status: 500 });
    }
  },
};`;
const bundled = await build({
  stdin: { contents: WRAPPER, resolveDir: ROOT, sourcefile: 'init-local-worker.ts', loader: 'ts' },
  absWorkingDir: ROOT, bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022',
  conditions: ['workerd', 'worker', 'browser'], external: ['cloudflare:*', 'node:*'],
  alias: { path: 'node:path', 'node:os': 'unenv/node/os' },
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire('/init-local-worker.mjs');" },
  logLevel: 'silent',
});

// ── The local store `wrangler dev` persists to (the same root and binding ids it uses) ──────────
const persist = options.persistTo === undefined ? join(ROOT, '.wrangler/state') : resolve(process.cwd(), options.persistTo);
let outbound = 0;
const mf = new Miniflare({
  name: 'init-local', cf: false,
  modules: [{ type: 'ESModule', path: 'init-local-worker.mjs', contents: bundled.outputFiles[0].text }],
  compatibilityDate: config.compatibility_date, compatibilityFlags: config.compatibility_flags ?? [],
  defaultPersistRoot: join(persist, 'v3'),
  d1Databases: { DB: database.preview_database_id ?? database.database_id },
  r2Buckets: { STORAGE: bucket.bucket_name },
  outboundService: () => { outbound++; throw new Error('init-local makes no network request'); },
});
let failed = false;
try {
  console.log(`init-local: local store ${persist} (tenant ${options.scope}${options.demoData ? ', demo data requested' : ''})`);
  const db = await mf.getD1Database('DB');
  // The migrations table exactly as `wrangler d1 migrations apply` creates it, so both agree on what ran.
  await db.prepare(`CREATE TABLE IF NOT EXISTS d1_migrations(
		id         INTEGER PRIMARY KEY AUTOINCREMENT,
		name       TEXT UNIQUE,
		applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);`).run();
  const applied = new Set((await db.prepare('SELECT name FROM d1_migrations ORDER BY id').all()).results.map((row) => row.name));
  /**
   * One SQL file (and, for a migration, its record) in ONE transaction: its statements, split
   * outside quotes and comments, as one batch. A file holding a trigger runs whole instead.
   */
  const execute = async (file, record) => {
    const sql = readFileSync(join(ROOT, file), 'utf8'), tail = record ? `INSERT INTO d1_migrations (name) VALUES ('${record}');` : '';
    const statements = statementsOf(sql);
    const parts = statements === null ? [`${sql}\n${tail}`] : [...statements, ...(tail ? [tail] : [])];
    const oversized = parts.find((part) => Buffer.byteLength(part) > STATEMENT_LIMIT);
    if (oversized !== undefined) throw new Error(`${file}: ${statements === null ? 'a file holding a trigger' : 'a statement'} is longer than the local database accepts (${Buffer.byteLength(oversized)} bytes)`);
    await db.batch(parts.map((part) => db.prepare(part)));
  };
  /** One migration file and its record, in one transaction; a recorded one is never run again. */
  const migrate = async (directory, name) => {
    if (applied.has(name)) return false;
    await execute(`${directory}/${name}`, name);
    applied.add(name);
    console.log(`  applied ${directory}/${name}`);
    return true;
  };
  let ran = 0;
  if (options.demoData) {
    // The demo chain in order; its product members are the identical product copies.
    for (const name of chain) if (await migrate(product.includes(name) ? 'migrations/product' : 'migrations', name)) ran++;
  }
  for (const name of product) if (await migrate('migrations/product', name)) ran++;
  console.log(`  D1: ${ran} migration(s) applied; ${applied.size} recorded (${options.demoData ? 'product and demo' : 'product only; demo data needs --demo-data'})`);
  if (options.demoData) {
    for (const name of seeds) { await execute(`migrations/seed/${name}`); console.log(`  seeded migrations/seed/${name}`); }
  }
  const response = await mf.dispatchFetch(`http://init-local.invalid/?scope=${encodeURIComponent(options.scope)}`);
  const answer = await response.json();
  if (!response.ok) throw new Error(`publication for ${options.scope}: ${answer.error ?? response.status}${answer.code ? ` (${answer.code})` : ''}`);
  console.log(`  publication for ${options.scope}: ${answer.state} (set revision ${answer.publication})`);
  if (outbound) throw new Error(`${outbound} network request(s) were refused`);
  console.log(`init-local: done. Next: npm run dev, then seed with --scope ${options.scope} (README.md, "Quick Start").`);
} catch (error) {
  failed = true;
  console.error(`init-local: ${error instanceof Error ? error.message : String(error)}`);
} finally {
  await mf.dispose();
}
process.exit(failed ? 1 : 0);

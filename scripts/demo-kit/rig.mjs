#!/usr/bin/env node
// scripts/demo-kit/rig.mjs — a demo's local rig: wrangler dev on its own port and state, its tenant provisioned (lane K4).
//
//   node scripts/demo-kit/rig.mjs --config <slug|file> --port <port> --state .wrangler/state-<name>
//        [--inspector-port <port>] [--prepare] [--dry-run]
//
// Run it from WSL at the repository root (on this machine workerd, and so wrangler dev, runs only there). It starts
// `npx wrangler dev` for the demo's own worker config, and makes two things true for that one process only, never
// writing a file the demo does not own:
//
//   • the routes. When src/index.ts does not mount /<slug>/api yet (the scaffold prints the lines for the lead), the
//     rig runs a copy of it with exactly those lines applied, written to .wrangler/rig-<slug>/index.ts (gitignored);
//     once the lead has applied them, it runs src/index.ts itself.
//   • the tenant. When .dev.vars does not provision the tenant (TENANTS with grants for <slug>-demo, seed-<slug> and
//     seed-<slug>-region, SDK_KEYS naming <tenant>:demo-site, RETENTION with the tenant's policies), the rig passes
//     those three settings as --var for this process only (wrangler gives --var precedence over .dev.vars), with
//     RETENTION's policies copied from the first tenant .dev.vars provisions. They are not secrets, and they are
//     never printed: the command line is shown with their values elided. JWT_SECRET and IDENTITY_SALT stay in
//     .dev.vars, which wrangler reads itself; this script never reads them.
//
// --prepare, once per fresh state: the D1 migrations and the census and crosswalk rows into that state (as
// docs/verizon/RESUME-vantage.md does for Vantage). Then seed it, from another WSL shell:
//   export JWT_SECRET="$(grep '^JWT_SECRET=' .dev.vars | cut -d= -f2- | tr -d "'")" JWT_ISSUER=edge-platform JWT_AUDIENCE=edge-platform-api DEPLOYMENT_PROFILE=demo
//   node scripts/demo-kit/seed.mjs --config <slug> --base http://localhost:<port>   (it rewrites public/<slug>/beats/: snapshot them first)
//   node scripts/demo-kit/region-seed.mjs --config <slug> --base http://localhost:<port>
//   node scripts/demo-kit/check-demo.mjs --config <slug> --base http://localhost:<port>   (from Windows, where Chrome is)
// Stop it with Ctrl-C. It kills nothing of anybody else's.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { isEntry } from './lib/cli.mjs';
import { argOf, configArg, configFileFor, loadValidConfig, REPO_ROOT } from './lib/config.mjs';
import { mountLines, operatorsOf } from './lib/scaffold.mjs';

/** The categories a tenant's RETENTION policies cover (src/retention.ts), so a rig copies a complete set. */
export const RETENTION_CATEGORIES = Object.freeze(['profile', 'identity', 'ledger', 'online', 'hourly', 'recovery', 'quarantine']);

export const USAGE ='usage: node scripts/demo-kit/rig.mjs --config <slug|file> --port <port> --state .wrangler/state-<name> [--inspector-port <port>] [--prepare] [--dry-run]';

/** The values a .dev.vars file holds, by name (quotes around a value removed). */
export function devVars(text) {
  const out = {};
  for (const line of String(text).split(/\r?\n/)) {
    const m = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line.trim());
    if (m) out[m[1]] = /^'.*'$|^".*"$/.test(m[2]) ? m[2].slice(1, -1) : m[2];
  }
  return out;
}

/**
 * Whether .dev.vars already provisions the tenant for the demo's three operators, and if not, the three settings that
 * do, for one process: { provisioned: true } or { provisioned: false, vars: { TENANTS, SDK_KEYS, RETENTION }, why }.
 */
export function rigVars(vars, { tenant, slug }) {
  const ops = Object.values(operatorsOf(slug));
  const parse = (s) => { try { return JSON.parse(s); } catch { return null; } };
  const tenants = parse(vars.TENANTS), retention = parse(vars.RETENTION);
  const keys = String(vars.SDK_KEYS || '').split(',').map((k) => k.trim().split(':')[0]);
  const why = [];
  if (!tenants || !Array.isArray(tenants.provisioned) || !tenants.provisioned.includes(tenant)) why.push(`TENANTS does not provision ${tenant}`);
  else for (const op of ops) if (!((tenants.operatorGrants || {})[op] || []).includes(tenant)) why.push(`TENANTS grants ${op} no ${tenant}`);
  if (!keys.includes(tenant)) why.push(`SDK_KEYS names no site key for ${tenant}`);
  if (!retention || !retention.tenants || !retention.tenants[tenant]) why.push(`RETENTION has no policies for ${tenant}`);
  if (!why.length) return { provisioned: true };
  // The policies of a tenant that covers every category the engine retains (src/retention.ts RETENTION_CATEGORIES).
  const covers = (p) => p && RETENTION_CATEGORIES.every((c) => Object.hasOwn(p, c));
  const names = retention && retention.tenants ? Object.keys(retention.tenants) : [];
  const from = names.find((n) => covers(retention.tenants[n])) ?? names[0] ?? null;
  if (!from) throw new Error('.dev.vars RETENTION provisions no tenant whose policies a rig could copy');
  return {
    provisioned: false, why, copiedFrom: from,
    vars: {
      TENANTS: JSON.stringify({ provisioned: [tenant], operatorGrants: Object.fromEntries(ops.map((op) => [op, [tenant]])) }),
      SDK_KEYS: `${tenant}:demo-site`,
      RETENTION: JSON.stringify({ version: 1, tenants: { [tenant]: retention.tenants[from] } }),
    },
  };
}

/**
 * The entry the rig runs: src/index.ts when it already mounts the demo, else a copy with the scaffold's mount lines
 * applied after Vantage's (the import beside Vantage's imports). Returns { mounted, src? }.
 */
export function rigEntry(indexSrc, demo) {
  const m = mountLines(demo);
  if (indexSrc.includes(`app.route('/${demo.slug}/api',`)) return { mounted: true };
  const importAfter = "import { vantageColdStartRoutes } from '@/routes/vantageColdStart';";
  const mountAfter = "app.route('/vantage/api/coldstart', vantageColdStartRoutes);";
  for (const anchor of [importAfter, mountAfter]) if (indexSrc.split(anchor).length !== 2) throw new Error(`src/index.ts: "${anchor}" is not there exactly once, so the mount lines have no place; apply them by hand`);
  const src = indexSrc.replace(importAfter, (l) => `${l}\n${m.import}`).replace(mountAfter, (l) => `${l}\n${m.mounts.join('\n')}`);
  return { mounted: false, src: `// GENERATED by scripts/demo-kit/rig.mjs for a local rig: src/index.ts with the ${demo.slug} mount lines applied. Not the real entry.\n${src}` };
}

/** The wrangler dev command line, and the same with every --var value elided, for printing. */
export function rigCommand({ entry, config, port, inspector, state, vars }) {
  const base = ['wrangler', 'dev', ...(entry ? [entry] : []), '--config', config, '--port', String(port), '--inspector-port', String(inspector), '--persist-to', state];
  const v = Object.entries(vars || {});
  return { args: [...base, ...v.flatMap(([k, val]) => ['--var', `${k}:${val}`])], shown: [...base, ...v.flatMap(([k]) => ['--var', `${k}:…`])].join(' ') };
}

export async function main(argv = process.argv.slice(2), { root = REPO_ROOT, log = console.log, err = console.error } = {}) {
  const named = configArg(argv, ['--config', '--port', '--state', '--inspector-port']);
  const port = Number(argOf(argv, '--port')), state = argOf(argv, '--state');
  if (!named || !Number.isInteger(port) || !state) { err(USAGE); return 2; }
  if (!/^\.wrangler\/state-[a-z0-9-]+$/.test(state)) { err(`✗ --state ${state}: a state directory of your own, .wrangler/state-<name>`); return 2; }
  const file = configFileFor(named) ?? named;
  let exitCode = null;
  const loaded = loadValidConfig(file, { sections: ['seed'], exit: (c) => { exitCode = c; }, log: err });
  if (exitCode !== null) return exitCode;
  const { config } = loaded;
  const demoFile = resolve(root, config.publicDir, 'demo.config.json');
  const demo = existsSync(demoFile) ? JSON.parse(readFileSync(demoFile, 'utf8')) : { slug: config.slug, name: config.name };
  const inspector = Number(argOf(argv, '--inspector-port', String(port + 150)));
  const workerConfig = config.worker.config || `wrangler.${config.slug}.toml`;
  if (!existsSync(resolve(root, workerConfig))) { err(`✗ ${workerConfig} does not exist: node scripts/build-demo-worker-config.mjs --name ${config.worker.name} --queue ${config.worker.queue} --dev-port ${config.worker.devPort}`); return 2; }
  if (process.platform === 'win32' && !argv.includes('--dry-run')) { err('✗ run the rig from WSL: wrangler dev needs the Linux workerd this checkout carries'); return 2; }

  const entry = rigEntry(readFileSync(resolve(root, 'src', 'index.ts'), 'utf8'), demo);
  let entryPath = null;
  if (!entry.mounted) {
    entryPath = `.wrangler/rig-${config.slug}/index.ts`;
    if (!argv.includes('--dry-run')) { mkdirSync(resolve(root, '.wrangler', `rig-${config.slug}`), { recursive: true }); writeFileSync(resolve(root, entryPath), entry.src); }
    log(`· src/index.ts does not mount /${config.slug}/api yet: the rig runs ${entryPath}, src/index.ts with the printed mount lines applied`);
  } else log(`· src/index.ts mounts /${config.slug}/api: the rig runs it`);
  const devVarsFile = resolve(root, '.dev.vars');
  let prov;
  try { prov = rigVars(existsSync(devVarsFile) ? devVars(readFileSync(devVarsFile, 'utf8')) : {}, { tenant: config.tenant, slug: config.slug }); }
  catch (error) { err(`✗ ${error.message} (.dev.vars ${existsSync(devVarsFile) ? 'is there' : 'does not exist'}; docs/demos/BOOTSTRAP.md §8 names what it carries)`); return 2; }
  if (prov.provisioned) log(`· .dev.vars provisions ${config.tenant}: no override`);
  else log(`· ${prov.why.join('; ')}: TENANTS, SDK_KEYS and RETENTION are passed for this process only (RETENTION's policies copied from ${prov.copiedFrom}), never written`);

  if (argv.includes('--prepare')) {
    const d1 = (more) => ['wrangler', 'd1', ...more, '--local', '--persist-to', state, '--config', workerConfig];
    const census = join(tmpdir(), `geo-census-${config.slug}.sql`);
    writeFileSync(census, readFileSync(resolve(root, 'migrations', 'seed', 'seed_011_geo.sql'), 'utf8').split('\n').slice(31, 172).join('\n'));
    for (const args of [d1(['migrations', 'apply', 'coach-demo-db']), d1(['execute', 'coach-demo-db', '--file', census])]) {
      log(`· npx ${args.join(' ')}`);
      if (argv.includes('--dry-run')) continue;
      const r = spawnSync('npx', args, { cwd: root, stdio: 'inherit', env: { ...process.env, CI: '1' } });
      if (r.status !== 0) { err('✗ preparing the state failed'); return 1; }
    }
  }
  const cmd = rigCommand({ entry: entryPath, config: workerConfig, port, inspector, state, vars: prov.provisioned ? {} : prov.vars });
  log(`· npx ${cmd.shown}`);
  log(`  then: node scripts/demo-kit/seed.mjs --config ${config.slug} --base http://localhost:${port}   (with the local mint; see the header)`);
  if (argv.includes('--dry-run')) return 0;
  const child = spawn('npx', cmd.args, { cwd: root, stdio: 'inherit' });
  return new Promise((done) => child.on('close', (code) => done(code ?? 0)));
}

if (isEntry(import.meta.url)) process.exit(await main());

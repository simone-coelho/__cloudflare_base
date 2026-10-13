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
//     never printed: the command line is shown with their values elided.
//   • the sign-in (a demo whose demo.config.json names sign-in accounts, OH's beat 15). Its route signs with
//     IDENTITY_SECRETS, which under AUTH_MODE=enforced the identity code accepts only when every provisioned tenant
//     has a secret meeting src/identity/material.mjs's safe-material rule. So the rig generates <tenant>:<secret> with
//     crypto, in memory, once per launch, holds it to that rule, and passes it as --var for the one process, never
//     printed and never written. It does this whenever it provisions the tenant itself; when .dev.vars provisions it
//     and its own IDENTITY_SECRETS already pass the check for every tenant there, it overrides nothing, and when they
//     do not, it provisions the tenant alone for the process (an oh-only table beside other tenants would fail it).
//     JWT_SECRET stays in .dev.vars, which wrangler reads itself; IDENTITY_SALT too, read here only to say (by name)
//     whether it meets the same rule, since the route answers 503 until it does.
//
// --prepare, once per fresh state: the D1 migrations and the census and crosswalk rows into that state (as
// docs/verizon/RESUME-vantage.md does for Vantage). Then seed it, from another WSL shell:
//   export JWT_SECRET="$(grep '^JWT_SECRET=' .dev.vars | cut -d= -f2- | tr -d "'")" JWT_ISSUER=edge-platform JWT_AUDIENCE=edge-platform-api DEPLOYMENT_PROFILE=demo
//   node scripts/demo-kit/seed.mjs --config <slug> --base http://localhost:<port>   (it rewrites public/<slug>/beats/: snapshot them first)
//   node scripts/demo-kit/region-seed.mjs --config <slug> --base http://localhost:<port>
//   node scripts/demo-kit/check-demo.mjs --config <slug> --base http://localhost:<port>   (from Windows, where Chrome is)
// Stop it with Ctrl-C. It kills nothing of anybody else's.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { isEntry } from './lib/cli.mjs';
import { argOf, configArg, configFileFor, loadValidConfig, REPO_ROOT } from './lib/config.mjs';
import { mountLines, operatorsOf } from './lib/scaffold.mjs';
import { parseIdentitySecrets, safeIdentitySecret, validateIdentityMaterial } from '../../src/identity/material.mjs';

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
 * A sign-in demo's IDENTITY_SECRETS for one launch: <tenant>:<64 hex>, from crypto, in memory, held to the identity
 * code's rule for enforced mode (safeIdentitySecret, then parseIdentitySecrets in safe mode, which is what secretsFor
 * reads). Never printed or written by anything here.
 */
export function identitySecretsFor(tenant, random = randomBytes) {
  for (let i = 0; i < 8; i += 1) {
    const secret = Buffer.from(random(32)).toString('hex');
    if (!safeIdentitySecret(secret)) continue;
    const value = `${tenant}:${secret}`;
    if (parseIdentitySecrets(value, true).get(tenant)?.[0] === secret) return value;
  }
  throw new Error('could not generate an identity secret the worker accepts under AUTH_MODE=enforced');
}

/** A salt that passes the safe-material rule, so a check of the SECRETS alone is not failed by the salt. Not a secret. */
const NEUTRAL_SALT = 'rig-check-salt-abcdefghijklmnopqrstuvwxyz-0123456789';

/** Whether .dev.vars' own IDENTITY_SECRETS pass the enforced identity check for its provisioned tenants and name this one. */
function devIdentityOk(vars, tenant) {
  try {
    const provisioned = JSON.parse(vars.TENANTS).provisioned;
    return validateIdentityMaterial({ ...vars, IDENTITY_SALT: NEUTRAL_SALT, AUTH_MODE: 'enforced' }, provisioned).has(tenant);
  } catch { return false; }
}

/**
 * Whether .dev.vars already provisions the tenant for the demo's three operators (and, for a sign-in demo, gives it an
 * identity secret the enforced check accepts), and if not, the settings that do, for one process:
 * { provisioned: true } or { provisioned: false, vars: { TENANTS, SDK_KEYS, RETENTION, IDENTITY_SECRETS? }, why }.
 * `identitySalt` says whether .dev.vars' IDENTITY_SALT meets the same rule (a sign-in route answers 503 until it does).
 */
export function rigVars(vars, { tenant, slug, signIn = false, random = randomBytes }) {
  const ops = Object.values(operatorsOf(slug));
  const parse = (s) => { try { return JSON.parse(s); } catch { return null; } };
  const tenants = parse(vars.TENANTS), retention = parse(vars.RETENTION);
  const keys = String(vars.SDK_KEYS || '').split(',').map((k) => k.trim().split(':')[0]);
  const why = [];
  if (!tenants || !Array.isArray(tenants.provisioned) || !tenants.provisioned.includes(tenant)) why.push(`TENANTS does not provision ${tenant}`);
  else for (const op of ops) if (!((tenants.operatorGrants || {})[op] || []).includes(tenant)) why.push(`TENANTS grants ${op} no ${tenant}`);
  if (!keys.includes(tenant)) why.push(`SDK_KEYS names no site key for ${tenant}`);
  if (!retention || !retention.tenants || !retention.tenants[tenant]) why.push(`RETENTION has no policies for ${tenant}`);
  if (signIn && !why.length && !devIdentityOk(vars, tenant)) why.push(`IDENTITY_SECRETS gives ${tenant} no secret the enforced identity check accepts for every tenant .dev.vars provisions`);
  const identitySalt = signIn ? safeIdentitySecret(vars.IDENTITY_SALT) : null;
  if (!why.length) return signIn ? { provisioned: true, identitySalt } : { provisioned: true };
  // The policies of a tenant that covers every category the engine retains (src/retention.ts RETENTION_CATEGORIES).
  const covers = (p) => p && RETENTION_CATEGORIES.every((c) => Object.hasOwn(p, c));
  const names = retention && retention.tenants ? Object.keys(retention.tenants) : [];
  const from = names.find((n) => covers(retention.tenants[n])) ?? names[0] ?? null;
  if (!from) throw new Error('.dev.vars RETENTION provisions no tenant whose policies a rig could copy');
  return {
    provisioned: false, why, copiedFrom: from, ...(signIn ? { identitySalt } : {}),
    vars: {
      TENANTS: JSON.stringify({ provisioned: [tenant], operatorGrants: Object.fromEntries(ops.map((op) => [op, [tenant]])) }),
      SDK_KEYS: `${tenant}:demo-site`,
      RETENTION: JSON.stringify({ version: 1, tenants: { [tenant]: retention.tenants[from] } }),
      // The rig provisions the tenant alone, so a table of its one secret passes the enforced check (validateIdentityMaterial).
      ...(signIn ? { IDENTITY_SECRETS: identitySecretsFor(tenant, random) } : {}),
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

/** The real runner: the command with the terminal attached; resolves with its exit code. A test passes its own. */
export const inheritRunner = ({ cmd, args, cwd, env }) => new Promise((done) => {
  const child = spawn(cmd, args, { cwd, stdio: 'inherit', env: { ...process.env, ...(env || {}) } });
  child.on('error', () => done(127));
  child.on('close', (code) => done(code ?? 0));
});

/** The demo's sign-in accounts, by name, from its demo.config.json (flags.signIn.accounts); empty when it has none. */
export const signInAccounts = (demo) => (Array.isArray(demo?.flags?.signIn?.accounts) ? demo.flags.signIn.accounts.map((a) => a && a.name).filter(Boolean) : []);

export async function main(argv = process.argv.slice(2), { root = REPO_ROOT, log = console.log, err = console.error, runner = inheritRunner,
  platform = process.platform, devVarsText = null, random = randomBytes } = {}) {
  const named = configArg(argv, ['--config', '--port', '--state', '--inspector-port']);
  const port = Number(argOf(argv, '--port')), state = argOf(argv, '--state');
  if (!named || !Number.isInteger(port) || !state) { err(USAGE); return 2; }
  if (!/^\.wrangler\/state-[a-z0-9-]+$/.test(state)) { err(`✗ --state ${state}: a state directory of your own, .wrangler/state-<name>`); return 2; }
  const file = configFileFor(named, { root }) ?? named;
  let exitCode = null;
  const loaded = loadValidConfig(file, { root, sections: ['seed'], exit: (c) => { exitCode = c; }, log: err });
  if (exitCode !== null) return exitCode;
  const { config } = loaded;
  const demoFile = resolve(root, config.publicDir, 'demo.config.json');
  const demo = existsSync(demoFile) ? JSON.parse(readFileSync(demoFile, 'utf8')) : { slug: config.slug, name: config.name };
  const inspector = Number(argOf(argv, '--inspector-port', String(port + 150)));
  const workerConfig = config.worker.config || `wrangler.${config.slug}.toml`;
  if (!existsSync(resolve(root, workerConfig))) { err(`✗ ${workerConfig} does not exist: node scripts/build-demo-worker-config.mjs --name ${config.worker.name} --queue ${config.worker.queue} --dev-port ${config.worker.devPort}`); return 2; }
  if (platform === 'win32' && !argv.includes('--dry-run')) { err('✗ run the rig from WSL: wrangler dev needs the Linux workerd this checkout carries'); return 2; }

  const entry = rigEntry(readFileSync(resolve(root, 'src', 'index.ts'), 'utf8'), demo);
  let entryPath = null;
  if (!entry.mounted) {
    entryPath = `.wrangler/rig-${config.slug}/index.ts`;
    if (!argv.includes('--dry-run')) { mkdirSync(resolve(root, '.wrangler', `rig-${config.slug}`), { recursive: true }); writeFileSync(resolve(root, entryPath), entry.src); }
    log(`· src/index.ts does not mount /${config.slug}/api yet: the rig runs ${entryPath}, src/index.ts with the printed mount lines applied`);
  } else log(`· src/index.ts mounts /${config.slug}/api: the rig runs it`);
  const devVarsFile = resolve(root, '.dev.vars');
  const accounts = signInAccounts(demo);
  const text = devVarsText ?? (existsSync(devVarsFile) ? readFileSync(devVarsFile, 'utf8') : null);
  let prov;
  try { prov = rigVars(text === null ? {} : devVars(text), { tenant: config.tenant, slug: config.slug, signIn: accounts.length > 0, random }); }
  catch (error) { err(`✗ ${error.message} (.dev.vars ${text === null ? 'does not exist' : 'is there'}; docs/demos/BOOTSTRAP.md §8 names what it carries)`); return 2; }
  if (prov.provisioned) log(`· .dev.vars provisions ${config.tenant}${accounts.length ? ', with an identity secret the enforced check accepts' : ''}: no override`);
  else log(`· ${prov.why.join('; ')}: ${Object.keys(prov.vars).join(', ')} are passed for this process only (RETENTION's policies copied from ${prov.copiedFrom}${prov.vars.IDENTITY_SECRETS ? `; IDENTITY_SECRETS generated for this launch as ${config.tenant}:<secret>, for the sign-in of ${accounts.length} demo account${accounts.length === 1 ? '' : 's'}` : ''}), never written`);
  if (accounts.length && prov.identitySalt === false) log(`! .dev.vars' IDENTITY_SALT does not meet the identity code's rule under AUTH_MODE=enforced (src/identity/material.mjs safeIdentitySecret): the sign-in route answers 503 until it does`);

  if (argv.includes('--prepare')) {
    const d1 = (more) => ['wrangler', 'd1', ...more, '--local', '--persist-to', state, '--config', workerConfig];
    const census = join(tmpdir(), `geo-census-${config.slug}.sql`);
    writeFileSync(census, readFileSync(resolve(root, 'migrations', 'seed', 'seed_011_geo.sql'), 'utf8').split('\n').slice(31, 172).join('\n'));
    for (const args of [d1(['migrations', 'apply', 'coach-demo-db']), d1(['execute', 'coach-demo-db', '--file', census])]) {
      log(`· npx ${args.join(' ')}`);
      if (argv.includes('--dry-run')) continue;
      if (await runner({ cmd: 'npx', args, cwd: root, env: { CI: '1' } }) !== 0) { err('✗ preparing the state failed'); return 1; }
    }
  }
  const cmd = rigCommand({ entry: entryPath, config: workerConfig, port, inspector, state, vars: prov.provisioned ? {} : prov.vars });
  log(`· npx ${cmd.shown}`);
  log(`  then: node scripts/demo-kit/seed.mjs --config ${config.slug} --base http://localhost:${port}   (with the local mint; see the header)`);
  if (argv.includes('--dry-run')) return 0;
  return runner({ cmd: 'npx', args: cmd.args, cwd: root });
}

if (isEntry(import.meta.url)) process.exit(await main());

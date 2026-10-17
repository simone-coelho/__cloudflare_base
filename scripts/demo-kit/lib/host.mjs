// scripts/demo-kit/lib/host.mjs — a demo's own worker, hosted as one command with explicit steps (lane H2).
//
// docs/demo-kit/Demo-Kit-Design.md §2.3 and §2.5; the sequence is the one docs/verizon/RESUME-vantage.md records for
// Vantage, made a command. scripts/demo-kit/host.mjs is its command line; every external call (git, npm, npx wrangler,
// node, ln, unlink) goes through an injectable runner, so a test drives the whole sequence without touching the
// network, the cloud or the checkout.
//
//   1 preflight  check-demo --skip suites (npm run check:generated, the app typecheck, the credential grep); the worker
//                config byte-equal to the builder's output; the branch head mounting /<slug>/api; and, before any
//                step runs at all, the refusals: never the shared worker, never a customer stamp
//   2 secrets    TENANTS, SDK_KEYS and RETENTION derived from .dev.vars the way rig.mjs derives them for --var;
//                JWT_SECRET, IDENTITY_SALT and IDENTITY_SECRETS generated with crypto (JWT_SECRET is the owner's
//                <SLUG>_REMOTE_JWT_SECRET instead when one is kept); each piped into `wrangler secret put` through
//                stdin, never an argument, never printed, never written; only names and sha256 prefixes are shown
//   3 database   which committed migrations the shared database has not applied, and whether the worker's two
//                queues exist: read-only; for anything missing it prints the owner's commands and stops
//   4 deploy     a clean WSL worktree of the branch head (node_modules linked, autocrlf input), check:generated
//                there, the builder, wrangler deploy, wrangler triggers deploy, the worktree removed
//   5 seed       a fresh worktree of the head; the seed with an operator token minted here; the tenant's one-time
//                POST /ops/demo-bootstrap/complete (priors and proposals for a set bootstrapped with four members; a
//                tenant that has them answers added: []); the redeploy the seed makes necessary; the region seed; the
//                worktree removed
//   6 verify     check-demo's suites against the hosted worker, and the URL
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmdirSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { parse as parseToml } from 'smol-toml';
import { argOf, configArg, configFileFor, loadValidConfig, REPO_ROOT } from './config.mjs';
import { WORKER_SECRETS, idents, operatorsOf } from './scaffold.mjs';
import { RETENTION_CATEGORIES, devVars } from '../rig.mjs';
import { builderArgs } from '../new-demo.mjs';
import { wslPathOf } from '../check-demo.mjs';
import { safeIdentitySecret } from '../../../src/identity/material.mjs';
import { readSigningConfig } from '../../../src/auth/signingConfig.mjs';
import { resolveToolToken } from '../../lib/tool-token.mjs';

/** The steps, in the order a full run takes them. */
export const STEPS = Object.freeze(['preflight', 'secrets', 'database', 'deploy', 'seed', 'verify']);
const TITLES = Object.freeze({
  preflight: 'the bundles, the app typecheck, the credential grep, the worker config, the branch head',
  secrets: 'the worker\'s secrets, through stdin',
  database: 'the shared database\'s migrations and the worker\'s queues (read-only)',
  deploy: 'the branch head from a clean WSL worktree, then its crons',
  seed: 'the hosted seed, the tenant\'s bootstrap completion, the redeploy it requires, the region seed',
  verify: 'the suites against the hosted worker',
});
/** The secrets a hosted demo worker carries: the scaffold's five, and IDENTITY_SECRETS for a sign-in route. */
export const HOSTED_SECRETS = Object.freeze([...WORKER_SECRETS, 'IDENTITY_SECRETS']);
/**
 * P48: the body of the hosted seed's call to the one-time path, run as `node --input-type=module -e` through the run's
 * runner like every external call. Its arguments are the method, the URL and the tenant; the operator token is read
 * from OPERATOR_TOKEN in the child's environment and is never an argument or a printed line. It prints the status and
 * what was added, and exits 0 only on an answer of ok.
 */
export const BOOTSTRAP_COMPLETE_CALL = "const [method, url, tenant] = process.argv.slice(1); "
  + "const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (process.env.OPERATOR_TOKEN ?? ''), 'X-Tenant': tenant }, body: '{}' }); "
  + "const body = await res.json().catch(() => ({})); "
  + "console.log(method + ' ' + new URL(url).pathname + ': ' + res.status + ' ' + JSON.stringify({ added: body.added, code: body.code, error: body.error, ok: body.ok })); "
  + "process.exit(res.ok && body.ok === true ? 0 : 1);";
/** The account's workers.dev subdomain every demo worker answers on. */
export const WORKERS_DEV = 'expedge.workers.dev';
export const hostedBase = (worker) => `https://${worker}.${WORKERS_DEV}`;
/** A value's sha256, first 8 hex digits: enough to tell two runs apart, nothing a value can be recovered from. */
export const shaPrefix = (value) => createHash('sha256').update(String(value)).digest('hex').slice(0, 8);
/** The name under which the owner keeps a hosted worker's JWT_SECRET (Vantage: VANTAGE_REMOTE_JWT_SECRET, in .dev.vars). */
export const heldSecretName = (slug) => `${idents(slug).constant}_REMOTE_JWT_SECRET`;

export const USAGE = 'usage: node scripts/demo-kit/host.mjs --config <slug|file> [--dry-run] [--step <name> | --from <name>] [--only <SECRET,…>] [--confirm <worker>]\n'
  + `  steps, in order: ${STEPS.join(', ')}; every step but preflight needs --confirm <the demo's worker name> unless --dry-run`;

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const parseJson = (s) => { try { return JSON.parse(s); } catch { return null; } };

// ── The derivations ─────────────────────────────────────────────────────────

/**
 * TENANTS, SDK_KEYS and RETENTION for a demo's hosted worker, from the local .dev.vars (by name; values never
 * printed): the same three settings rig.mjs passes as --var for one wrangler dev process. TENANTS provisions the
 * tenant alone and grants it to the demo's three operators; SDK_KEYS names the site key the pages send; RETENTION
 * holds the tenant's own policies when .dev.vars has a complete set for it, else those of the first tenant whose
 * policies cover all seven retained categories. Unlike the rig, an incomplete set is refused: the worker throws
 * on a category it has no policy for (src/retention.ts).
 */
export function hostedSettings(vars, { tenant, slug }) {
  const retention = parseJson(vars.RETENTION);
  const tenants = isObject(retention) && isObject(retention.tenants) ? retention.tenants : {};
  const covers = (p) => isObject(p) && RETENTION_CATEGORIES.every((c) => Object.hasOwn(p, c));
  const from = covers(tenants[tenant]) ? tenant : Object.keys(tenants).find((n) => covers(tenants[n])) ?? null;
  if (!from) throw new Error(`.dev.vars RETENTION holds no tenant whose policies cover all seven retained categories (${RETENTION_CATEGORIES.join(', ')}); the hosted RETENTION is copied from one`);
  const ops = Object.values(operatorsOf(slug));
  return {
    TENANTS: JSON.stringify({ provisioned: [tenant], operatorGrants: Object.fromEntries(ops.map((op) => [op, [tenant]])) }),
    SDK_KEYS: `${tenant}:demo-site`,
    RETENTION: JSON.stringify({ version: 1, tenants: { [tenant]: tenants[from] } }),
    retentionFrom: from,
  };
}

/** A random secret the worker accepts both as signing material and as identity material: 32 bytes, hex. */
export function generateSecret(random = randomBytes) {
  for (let i = 0; i < 8; i += 1) {
    const value = Buffer.from(random(32)).toString('hex');
    if (safeIdentitySecret(value) && readSigningConfig({ JWT_SECRET: value, JWT_ISSUER: 'i', JWT_AUDIENCE: 'a' })) return value;
  }
  throw new Error('could not generate a secret the worker accepts');
}

/** The owner's kept JWT secret for the demo's hosted worker, from the environment first, then .dev.vars; null when none. */
export function heldSecret({ env = {}, vars = {}, slug }) {
  const name = heldSecretName(slug);
  const where = env[name] !== undefined ? 'the environment' : vars[name] !== undefined ? '.dev.vars' : null;
  if (!where) return null;
  const value = env[name] ?? vars[name];
  if (!readSigningConfig({ JWT_SECRET: value, JWT_ISSUER: 'i', JWT_AUDIENCE: 'a' })) throw new Error(`${name} (${where}) is not signing material the worker accepts: at least 32 bytes, not the published placeholder`);
  return { name, value, where };
}

/**
 * The six secrets, each { name, value, source, held? }, in the order they are put. The values are for the runner's
 * stdin only: a caller prints name, source and shaPrefix(value), never the value.
 */
export function secretValues({ devVarsText = '', env = {}, tenant, slug, random = randomBytes }) {
  const vars = devVars(devVarsText);
  const derived = hostedSettings(vars, { tenant, slug });
  const held = heldSecret({ env, vars, slug });
  return [
    { name: 'TENANTS', value: derived.TENANTS, source: `derived from .dev.vars as rig.mjs derives it: ${tenant} alone, granted to its three operators` },
    { name: 'SDK_KEYS', value: derived.SDK_KEYS, source: 'derived: the public site key the pages send' },
    { name: 'RETENTION', value: derived.RETENTION, source: `derived: the seven categories' policies of ${derived.retentionFrom} in .dev.vars` },
    held
      ? { name: 'JWT_SECRET', value: held.value, source: `the owner's ${held.name}, from ${held.where} (kept, so a later reseed can mint)`, held: true }
      : { name: 'JWT_SECRET', value: generateSecret(random), source: 'generated with crypto, held by this run only', held: false },
    { name: 'IDENTITY_SALT', value: generateSecret(random), source: 'generated with crypto' },
    { name: 'IDENTITY_SECRETS', value: `${tenant}:${generateSecret(random)}`, source: `generated with crypto, as ${tenant}:<secret> (the sign-in route signs with it)` },
  ];
}

/** A 30-minute operator token for one subject, minted in memory the way the Vantage resume's mint() does. */
export async function mintOperatorToken({ secret, issuer, audience, sub, expiresIn = '30m' }) {
  return resolveToolToken({ env: { JWT_SECRET: secret, JWT_ISSUER: issuer, JWT_AUDIENCE: audience, DEPLOYMENT_PROFILE: 'demo' },
    payload: { sub, roles: ['operator'] }, expiresIn, allowMint: true });
}

// ── Redaction ───────────────────────────────────────────────────────────────

/**
 * What the command holds and must never print. hold(label, value) registers a value (and its JSON-escaped form);
 * text(s) replaces every held value in s with ‹label›. Every line the command prints, its own and its children's,
 * goes through text().
 */
export function createRedactor() {
  const held = [];
  return {
    hold(label, value) {
      if (typeof value !== 'string' || value.length < 6) return;
      for (const v of new Set([value, JSON.stringify(value).slice(1, -1)])) if (!held.some((h) => h.value === v)) held.push({ label, value: v });
      held.sort((a, b) => b.value.length - a.value.length);
    },
    text(s) { let out = String(s); for (const h of held) out = out.split(h.value).join(`‹${h.label}›`); return out; },
    get size() { return held.length; },
  };
}

// ── What the remote answers, read ───────────────────────────────────────────

/**
 * The committed migrations `wrangler d1 migrations list --remote` names as not applied, in file order: [] when it
 * says there are none, null when its output is not one this reads (so a changed format stops the step).
 */
export function pendingMigrations(listOutput, committed) {
  const text = String(listOutput);
  const named = new Set([...text.matchAll(/(\d{4}_[A-Za-z0-9_.-]*?\.sql)/g)].map((m) => m[1]));
  if (/no migrations to apply/i.test(text) && !named.size) return [];
  if (!named.size) return null;
  return [...committed].sort().filter((f) => named.has(f));
}

/** The queues `wrangler queues list` does not show, matched as whole names (events-oh is not events-oh-dlq). */
export function missingQueues(listOutput, queues) {
  const text = String(listOutput);
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return queues.filter((q) => !new RegExp(`(^|[^A-Za-z0-9_-])${esc(q)}([^A-Za-z0-9_-]|$)`, 'm').test(text));
}

/** The version id `wrangler deploy` prints ("Current Version ID: …"), or null. */
export const versionOf = (output) => (/Current Version ID:\s*([0-9a-f][0-9a-f-]{7,})/i.exec(String(output)) || [])[1] ?? null;

/** `git status --porcelain` as { code, path } entries. */
export const porcelain = (text) => String(text).split('\n').filter((l) => l.trim()).map((l) => ({ code: l.slice(0, 2), path: l.slice(3).replace(/^"|"$/g, '').split(' -> ').pop() }));

/**
 * The scratch-copy recipe for one committed migration on the remote database (docs/verizon/RESUME-vantage.md,
 * the deploy checklist): D1's remote statement splitter cuts 0012's trigger at its inner CASE … END;, so
 * `migrations apply --remote` fails on it; instead the committed text, with its d1_migrations row appended, is
 * imported whole (all or nothing). Printed for the owner, never run here.
 */
export function migrationRecipe({ database, file, migrationsDir = 'migrations', workerConfig }) {
  const scratch = `/tmp/remote-${file}`;
  return [
    `git show HEAD:${migrationsDir}/${file} > ${scratch}`,
    `printf '\\nINSERT INTO "d1_migrations" (name) VALUES (%s);\\n' "'${file}'" >> ${scratch}`,
    `npx wrangler d1 execute ${database} --remote --file ${scratch} --config ${workerConfig}`,
  ];
}

/** The worktree a deploy or a seed runs in: under /tmp, named for the demo, the step and the moment. */
export const worktreeDir = (slug, label, nowMs) => `/tmp/edge-host-${slug}-${label}-${new Date(nowMs).toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')}`;

/** The steps a command line asks for: all of them, one (--step), or one and those after it (--from). */
export function stepsToRun({ step, from } = {}) {
  if (step && from) throw new Error('--step and --from are each a choice of steps; give one');
  for (const s of [step, from]) if (s && !STEPS.includes(s)) throw new Error(`no step "${s}": the steps are ${STEPS.join(', ')}`);
  if (step) return [step];
  return from ? STEPS.slice(STEPS.indexOf(from)) : [...STEPS];
}

// ── The refusals ────────────────────────────────────────────────────────────

/**
 * Why this command must not host this config at all, as sentences; [] when it may. The workers it never hosts onto
 * are the shared demo worker and the customer stamps, read from wrangler.toml's own name and [env.*] sections as well
 * as named here; the config's worker must be edge-platform-<slug> with its config wrangler.<slug>.toml, and that file
 * must name the same worker, carry no stamp environments, run DEPLOYMENT_PROFILE demo and name only the demo's own
 * queues; the seeds' operators must be the ones the hosted TENANTS grants.
 */
export function refusals({ config, workerConfig, toml, sharedToml = null }) {
  const out = [];
  const slug = config.slug, w = config.worker ?? {};
  const forbidden = new Map([
    ['edge-platform', 'the SHARED demo worker (Coach, Bright Hour, Meridian, the bank demo)'],
    ['edge-platform-staging', 'the customer staging stamp'],
    ['edge-platform-production', 'the customer production stamp'],
  ]);
  if (isObject(sharedToml)) {
    if (typeof sharedToml.name === 'string') forbidden.set(sharedToml.name, forbidden.get(sharedToml.name) ?? 'the shared worker of wrangler.toml');
    for (const [env, e] of Object.entries(isObject(sharedToml.env) ? sharedToml.env : {})) {
      const name = isObject(e) && typeof e.name === 'string' ? e.name : `${sharedToml.name}-${env}`;
      forbidden.set(name, forbidden.get(name) ?? `the customer ${env} stamp of wrangler.toml`);
    }
  }
  for (const name of new Set([w.name, toml?.name].filter(Boolean))) if (forbidden.has(name)) out.push(`${name} is ${forbidden.get(name)}: this command never hosts onto it`);
  if (w.name !== `edge-platform-${slug}`) out.push(`worker.name "${w.name}" is not edge-platform-${slug}, the worker of this demo's own slug`);
  if (String(workerConfig).toLowerCase() === 'wrangler.toml') out.push('the worker config is wrangler.toml, the shared worker\'s, which also deploys the customer stamps');
  else if (workerConfig !== `wrangler.${slug}.toml`) out.push(`the worker config is ${workerConfig}, not wrangler.${slug}.toml`);
  if (!isObject(toml)) { out.push(`${workerConfig} does not exist or does not parse: node ${builderArgs(config).join(' ')}`); return out; }
  if (toml.name !== w.name) out.push(`${workerConfig} names the worker ${toml.name}, not ${w.name}`);
  if (toml.env !== undefined) out.push(`${workerConfig} carries [env.*] sections (${Object.keys(toml.env).join(', ')}): stamp environments never belong in a demo worker's config`);
  if (toml.vars?.DEPLOYMENT_PROFILE !== 'demo') out.push(`${workerConfig} sets DEPLOYMENT_PROFILE ${JSON.stringify(toml.vars?.DEPLOYMENT_PROFILE ?? null)}, not "demo": the demo routes mount only on a demo worker, and a customer profile is never a demo target`);
  const own = new Set([w.queue, `${w.queue}-dlq`]);
  const named = [...(toml.queues?.producers ?? []).map((p) => p.queue), ...(toml.queues?.consumers ?? []).flatMap((c) => [c.queue, c.dead_letter_queue])].filter(Boolean);
  for (const q of new Set(named)) if (!own.has(q)) out.push(`${workerConfig} names the queue ${q}, not one of this demo's own (${[...own].join(', ')})`);
  if (!named.includes(w.queue)) out.push(`${workerConfig} does not name the queue ${w.queue}`);
  const ops = Object.values(operatorsOf(slug));
  for (const [where, op] of [['seed.operator', config.seed?.operator], ['region.operator', config.region?.operator]]) {
    if (!ops.includes(op)) out.push(`${where} "${op}" is not one of the operators the hosted TENANTS grants (${ops.join(', ')}), so its token would be refused`);
  }
  return out;
}

// ── The command ─────────────────────────────────────────────────────────────

/** The real file reads; a test replaces any of them. */
export const defaultIo = (root) => ({
  exists: (p) => existsSync(p),
  readText: (p) => readFileSync(p, 'utf8'),
  readBytes: (p) => readFileSync(p),
  unlink: (p) => { try { unlinkSync(p); } catch { /* a scratch file already gone */ } },
  tmpdir: () => tmpdir(),
  mkdtemp: (prefix) => mkdtempSync(join(tmpdir(), prefix)),
  rmdir: (p) => { try { rmdirSync(p); } catch { /* not empty, or already gone: left as it is */ } },
  devVars: () => { const f = resolve(root, '.dev.vars'); return existsSync(f) ? readFileSync(f, 'utf8') : ''; },
});

const REDEPLOY_RULE = (slug, dir) => [
  `  · A reseed is always followed by a deploy. The seed re-anchored every window to now and rewrote ${dir}/ in this worktree;`,
  `    the worker applies a beat from its own ASSETS copy of those documents, so until the redeploy it would apply a beat other`,
  `    than the one just seeded, and the demo would misbehave in a way that looks like an engine fault. So: seed, then deploy, now,`,
  `    then the region seed, which writes no file under public/${slug} and so needs no deploy after it.`,
];

/**
 * The hosting sequence. Returns the exit code: 0 every chosen step passed (or, with --dry-run, was printed), 1 a step
 * failed (named), 2 a usage, config or refusal error. `runner({ cmd, args, cwd, env, input, onLine })` resolves to
 * { code, stdout, stderr }; it is the only way anything outside this process is reached.
 */
export async function runHost(argv, deps = {}) {
  const {
    root = REPO_ROOT, runner = null, log = console.log, err = console.error, env = process.env,
    platform = process.platform, now = () => Date.now(), random = randomBytes,
  } = deps;
  const io = { ...defaultIo(root), ...(deps.io ?? {}) };
  const red = createRedactor();
  const say = (line = '') => log(red.text(line));
  const shout = (line) => err(red.text(line));
  if (argv.includes('--help') || argv.includes('-h')) { log(USAGE); return 0; }

  const named = configArg(argv, ['--config', '--step', '--from', '--confirm', '--only']);
  if (!named) { err(USAGE); return 2; }
  const dry = argv.includes('--dry-run');
  let steps;
  try { steps = stepsToRun({ step: argOf(argv, '--step'), from: argOf(argv, '--from') }); } catch (error) { err(`✗ ${error.message}`); return 2; }
  const only = argOf(argv, '--only') ? argOf(argv, '--only').split(',').map((s) => s.trim()).filter(Boolean) : null;
  if (only) {
    const unknown = only.filter((n) => !HOSTED_SECRETS.includes(n));
    if (unknown.length || !only.length) { err(`✗ --only ${only.join(',')}: the secrets are ${HOSTED_SECRETS.join(', ')}`); return 2; }
    if (!steps.includes('secrets')) { err('✗ --only chooses among the secrets, so the run must include the secrets step'); return 2; }
  }

  let exitCode = null;
  const loaded = loadValidConfig(configFileFor(named, { root }) ?? named, { root, sections: ['seed', 'region', 'check'], exit: (c) => { exitCode = c; }, log: err });
  if (exitCode !== null) return exitCode;
  const { config } = loaded;
  const slug = config.slug, tenant = config.tenant, worker = config.worker.name, queue = config.worker.queue;
  const workerConfig = config.worker.config ?? `wrangler.${slug}.toml`;
  const tomlAt = (rel) => { const abs = resolve(root, rel); if (!io.exists(abs)) return null; try { return parseToml(io.readText(abs)); } catch { return null; } };
  const toml = tomlAt(workerConfig);
  const refused = refusals({ config, workerConfig, toml, sharedToml: tomlAt('wrangler.toml') });
  if (refused.length) { err(`✗ host ${slug}: refused, nothing run:\n  - ${refused.join('\n  - ')}`); return 2; }
  if (!dry && platform === 'win32') { err('✗ run it from WSL, at the repository root: the deploy worktree must be made by WSL git (Windows git checks it out with CRLF and check:generated fails on that alone), and wrangler runs there'); return 2; }
  if (!dry && steps.some((s) => s !== 'preflight') && argOf(argv, '--confirm') !== worker) {
    err(`✗ --confirm ${worker} is required: every step after preflight reads or changes ${worker} in the cloud, on the owner's go; naming the worker confirms it is this one`);
    return 2;
  }
  if (!dry && typeof runner !== 'function') { err('✗ no runner'); return 2; }

  const base = hostedBase(worker);
  const rootShown = /^[A-Za-z]:/.test(root) ? wslPathOf(root) : root;
  const wsl = dry ? platform === 'win32' || Boolean(env.WSL_DISTRO_NAME || env.WSL_INTEROP) : platform === 'linux' && Boolean(env.WSL_DISTRO_NAME || env.WSL_INTEROP);
  const state = { sha: null, jwt: null, versions: [] };

  /** One external call: printed (redacted), then run, unless this is a dry run. */
  const exec = async (cmd, args, { cwd = root, env: extra = {}, labels = {}, input, inputLabel, stream = false, quiet = false, note } = {}) => {
    const envShown = Object.keys(extra).map((k) => `${k}=‹${labels[k] ?? k}›`).join(' ');
    const where = cwd !== root ? `(in ${cwd}) ` : '';
    say(`  $ ${where}${envShown ? `${envShown} ` : ''}${[cmd, ...args].join(' ')}${input !== undefined ? `  < stdin: ${inputLabel ?? 'redacted'}` : ''}${note ? `   # ${note}` : ''}`);
    if (dry) return { code: 0, stdout: '', stderr: '', dry: true };
    const r = await runner({ cmd, args, cwd, env: extra, input, onLine: stream ? (line) => say(`    ${line}`) : null });
    if (r.code !== 0 && !stream && !quiet) for (const line of `${r.stdout ?? ''}\n${r.stderr ?? ''}`.trim().split('\n').slice(-20)) say(`    ${line}`);
    return r;
  };
  const fail = (why) => ({ ok: false, why });
  const OK = { ok: true };
  const git = (args, opts) => exec('git', ['-c', 'core.autocrlf=input', ...args], opts);
  const headSha = async () => {
    if (state.sha) return state.sha;
    const r = await git(['rev-parse', 'HEAD'], { quiet: true });
    if (r.code !== 0) return null;
    state.sha = dry ? 'HEAD' : String(r.stdout).trim();
    if (!dry) say(`  · the branch head is ${state.sha}`);
    return state.sha;
  };

  /** A clean worktree of the head, made by WSL git, ready to deploy: { wt, sha, linked, why? }. */
  const openWorktree = async (label) => {
    const sha = await headSha();
    if (!sha) return { why: 'git rev-parse HEAD failed' };
    const wt = worktreeDir(slug, label, now());
    let r = await git(['worktree', 'add', '--detach', wt, sha], { note: 'LF endings; never a Windows-made worktree' });
    if (r.code !== 0) return { why: `git worktree add ${wt} failed` };
    const opened = { wt, sha, linked: false };
    r = await exec('ln', ['-s', `${rootShown}/node_modules`, `${wt}/node_modules`], { note: 'the checkout\'s Linux install, linked; unlinked before the worktree is removed' });
    if (r.code !== 0) return { ...opened, why: 'linking node_modules into the worktree failed' };
    opened.linked = true;
    r = await exec('npm', ['run', 'check:generated'], { cwd: wt, stream: true, note: 'a deploy does not rebuild the SDK and Meridian bundles' });
    if (r.code !== 0) return { ...opened, why: `npm run check:generated failed in the clean worktree of ${sha} (above)` };
    r = await exec('node', builderArgs(config), { cwd: wt });
    if (r.code !== 0) return { ...opened, why: 'the worker config builder failed in the worktree (above)' };
    r = await git(['status', '--porcelain', '--untracked-files=all'], { cwd: wt, quiet: true, note: `clean but for the node_modules link: HEAD's ${workerConfig} is the builder's output` });
    const dirty = dry ? [] : porcelain(r.stdout).filter((e) => e.path !== 'node_modules');
    if (r.code !== 0 || dirty.length) return { ...opened, why: `the worktree of ${sha} is not clean after the bundles' check and the builder (${dirty.map((e) => `${e.code.trim()} ${e.path}`).join(', ') || 'git status failed'}): HEAD must carry ${workerConfig} as the builder writes it` };
    return opened;
  };
  /** Unlink node_modules, then remove the worktree; --force only when every change is one the step expects. */
  const closeWorktree = async (opened, { expected = null } = {}) => {
    if (!opened?.wt) return;
    const { wt } = opened;
    if (opened.linked) {
      const r = await exec('unlink', [`${wt}/node_modules`], { quiet: true, note: 'the link itself, never what it points at' });
      if (r.code !== 0) { say(`  ! the node_modules link in ${wt} was not removed, so the worktree is left: unlink ${wt}/node_modules, then git worktree remove ${wt}`); return; }
    }
    const r = await git(['status', '--porcelain', '--untracked-files=all'], { cwd: wt, quiet: true });
    const changed = dry ? [] : porcelain(r.stdout);
    const unexpected = changed.filter((e) => !(expected && expected(e)));
    if (r.code !== 0 || unexpected.length) { say(`  ! ${wt} holds changes no step made (${unexpected.map((e) => `${e.code.trim()} ${e.path}`).join(', ') || 'git status failed'}): left for you to inspect`); return; }
    const force = dry ? Boolean(expected) : changed.length > 0;
    const rm = await git(['worktree', 'remove', ...(force ? ['--force'] : []), wt], { quiet: true, note: force ? `only the re-anchored documents under ${config.seed.beats.dir}/ differ` : null });
    if (rm.code !== 0) say(`  ! git worktree remove ${wt} failed: it is left`);
  };
  const deployFrom = async (wt, why) => {
    const r = await exec('npx', ['wrangler', 'deploy', '--config', workerConfig], { cwd: wt, stream: true, note: why });
    if (r.code !== 0) return null;
    const version = dry ? '<version>' : versionOf(`${r.stdout}\n${r.stderr}`);
    state.versions.push(version);
    if (!dry) say(version ? `  ✓ ${worker} version ${version}, from ${state.sha}: record it in docs/${slug}/RESUME-${slug}.md` : '  ! wrangler printed no version id; read it from the output above');
    return version ?? '';
  };
  const jwtFor = () => {
    if (state.jwt) return { value: state.jwt, from: 'the secrets step of this run' };
    const held = heldSecret({ env, vars: devVars(io.devVars()), slug });
    return held ? { value: held.value, from: `the owner's ${held.name} (${held.where})` } : null;
  };

  const STEP = {
    async preflight() {
      say(`  ✓ ${worker} is this demo's own worker: not the shared worker, not a customer stamp; ${workerConfig} names it, runs DEPLOYMENT_PROFILE demo and only the queues ${queue} and ${queue}-dlq`);
      let r = await exec('node', ['scripts/demo-kit/check-demo.mjs', '--config', slug, '--skip', 'suites'], { stream: true, note: 'npm run check:generated, the app typecheck, the credential grep' });
      if (r.code !== 0) return fail('check-demo --skip suites failed: the bundles, the app typecheck or the credential grep (above)');
      // The builder's header names the file it writes, so the comparison copy keeps the real name, in a scratch directory.
      const dir = (dry ? `${io.tmpdir()}/host-${slug}-XXXXXX` : io.mkdtemp(`host-${slug}-`)).split('\\').join('/');
      const scratch = `${dir}/${basename(workerConfig)}`;
      r = await exec('node', [...builderArgs(config), '--out', scratch], { note: `compared byte for byte with ${workerConfig}` });
      if (r.code !== 0) { if (!dry) { io.unlink(scratch); io.rmdir(dir); } return fail('the worker config builder failed (above)'); }
      if (!dry) {
        let same = false;
        try { same = Buffer.compare(io.readBytes(scratch), io.readBytes(resolve(root, workerConfig))) === 0; } finally { io.unlink(scratch); io.rmdir(dir); }
        if (!same) return fail(`${workerConfig} is not byte-equal to the builder's output: regenerate it (node ${builderArgs(config).join(' ')}) and commit it`);
        say(`  ✓ ${workerConfig} is byte-equal to the builder's output`);
      }
      if (!(await headSha())) return fail('git rev-parse HEAD failed');
      r = await git(['show', 'HEAD:src/index.ts'], { quiet: true, note: `the deploy ships the head, so the head must mount /${slug}/api` });
      if (r.code !== 0) return fail('git show HEAD:src/index.ts failed');
      if (!dry && !String(r.stdout).includes(`app.route('/${slug}/api',`)) return fail(`the branch head ${state.sha} does not mount /${slug}/api in src/index.ts, so the hosted worker would answer 404 for the demo's API while its pages answer 200: commit the mount lines first`);
      if (!dry) say(`  ✓ the branch head mounts /${slug}/api`);
      return OK;
    },

    async secrets() {
      let values;
      try { values = secretValues({ devVarsText: io.devVars(), env, tenant, slug, random }); } catch (error) { return fail(error.message); }
      if (only) values = values.filter((v) => only.includes(v.name));
      for (const v of values) red.hold(v.name, v.value);
      say(`  · ${values.length} secret(s) for ${worker}, each piped into wrangler through stdin: never an argument, never printed, never written to disk. Names and sha256 prefixes only:`);
      for (const v of values) say(`      ${v.name.padEnd(17)} sha256 ${shaPrefix(v.value)}…  ${v.source}`);
      if (dry) say('      (a dry run: these values are derived and generated to show the plan; none is sent or kept)');
      say(`  · Before the first deploy on purpose: the first secret creates ${worker} as an empty draft (it answers 404 until the deploy), so its first real version boots with TENANTS set. On a worker that has them already, each is replaced: a new IDENTITY_SALT re-keys every visitor id and receipt audit reference made before it, so for a hosted worker choose with --only.`);
      for (const v of values) {
        const r = await exec('npx', ['wrangler', 'secret', 'put', v.name, '--config', workerConfig], { input: v.value, inputLabel: `${v.name} (sha256 ${shaPrefix(v.value)}…)` });
        if (r.code !== 0) return fail(`wrangler secret put ${v.name} failed (above); the secrets before it are set`);
      }
      const jwt = values.find((v) => v.name === 'JWT_SECRET');
      if (jwt) {
        state.jwt = jwt.value;
        if (!jwt.held) say(`  ! JWT_SECRET was generated by this run and is held only in its memory: this run's seed step mints with it, and once the run ends nothing can mint for ${worker} until JWT_SECRET is put again. To keep it for the morning reseed, the owner puts a value of their own in .dev.vars as ${heldSecretName(slug)} before the run (for example: echo "${heldSecretName(slug)}=$(openssl rand -hex 32)" >> .dev.vars), and this step then puts that one instead of generating`);
      }
      return OK;
    },

    async database() {
      const d1 = (toml.d1_databases ?? []).find((d) => d.binding === 'DB') ?? (toml.d1_databases ?? [])[0];
      if (!d1?.database_name) return fail(`${workerConfig} binds no D1 database`);
      const dir = d1.migrations_dir ?? 'migrations';
      let r = await git(['ls-tree', '--name-only', 'HEAD', `${dir}/`], { quiet: true, note: 'the committed migrations' });
      if (r.code !== 0) return fail(`git ls-tree HEAD ${dir}/ failed`);
      const committed = dry ? [] : String(r.stdout).split('\n').map((l) => l.trim().split('/').pop()).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort();
      r = await exec('npx', ['wrangler', 'd1', 'migrations', 'list', d1.database_name, '--remote', '--config', workerConfig], { quiet: true, note: 'read-only: the migrations not yet applied' });
      if (r.code !== 0) return fail(`wrangler d1 migrations list ${d1.database_name} --remote failed (above)`);
      const pending = dry ? [] : pendingMigrations(`${r.stdout}\n${r.stderr}`, committed);
      if (pending === null) return fail(`wrangler d1 migrations list printed nothing this command reads as a list; read it above and check by hand`);
      r = await exec('npx', ['wrangler', 'queues', 'list'], { quiet: true, note: 'read-only: the worker needs its own pair' });
      if (r.code !== 0) return fail('wrangler queues list failed (above)');
      const missing = dry ? [] : missingQueues(`${r.stdout}\n${r.stderr}`, [queue, `${queue}-dlq`]);
      if (dry) {
        say(`  · For each committed migration the list names as not applied, it prints (never runs) the scratch-copy recipe, in order; for <file>:`);
        for (const line of migrationRecipe({ database: d1.database_name, file: '<file>.sql', migrationsDir: dir, workerConfig })) say(`      ${line}`);
        say('    and for a queue that does not exist: npx wrangler queues create <queue>. Either stops the run here.');
        return OK;
      }
      if (!pending.length) say(`  ✓ ${d1.database_name} has applied every one of the ${committed.length} committed migrations`);
      else {
        say(`  ✗ ${d1.database_name} has not applied ${pending.join(', ')}. The owner's commands, in order (each imports the committed text whole with its d1_migrations row appended, because D1's remote splitter cuts 0012's trigger at its inner CASE … END;):`);
        for (const file of pending) for (const line of migrationRecipe({ database: d1.database_name, file, migrationsDir: dir, workerConfig })) say(`      ${line}`);
      }
      if (!missing.length) say(`  ✓ the queues ${queue} and ${queue}-dlq exist`);
      else { say(`  ✗ no queue ${missing.join(' or ')}. The owner's commands:`); for (const q of missing) say(`      npx wrangler queues create ${q}`); }
      if (pending.length || missing.length) return fail(`the remote is missing what the worker needs; the commands above are the owner's (each is a cloud change this command never makes); then go on with --from database`);
      return OK;
    },

    async deploy() {
      const opened = await openWorktree('deploy');
      try {
        if (opened.why) return fail(opened.why);
        if ((await deployFrom(opened.wt)) === null) return fail('wrangler deploy failed (above)');
        const r = await exec('npx', ['wrangler', 'triggers', 'deploy', '--config', workerConfig], { cwd: opened.wt, stream: true, note: 'a worker begun as a draft by secret put does not get its crons from a code deploy (Vantage, 2026-10-01)' });
        if (r.code !== 0) return fail('wrangler triggers deploy failed (above): the worker is deployed without its crons');
        return OK;
      } finally { await closeWorktree(opened); }
    },

    async seed() {
      let jwt;
      try { jwt = jwtFor(); } catch (error) { return fail(error.message); }
      if (!jwt) return fail(`no JWT secret for ${worker} in this process: it is the one the secrets step of the same run puts, or the owner's ${heldSecretName(slug)} (environment or .dev.vars); without it no operator token can be minted for the hosted seed`);
      red.hold('JWT_SECRET', jwt.value);
      const issuer = toml.vars?.JWT_ISSUER, audience = toml.vars?.JWT_AUDIENCE;
      if (!issuer || !audience) return fail(`${workerConfig} sets no JWT_ISSUER or JWT_AUDIENCE, so a minted token would not verify`);
      say(`  · operator tokens minted here, for 30 minutes each, from ${jwt.from}; passed to each seed as OPERATOR_TOKEN in its environment, never as an argument`);
      const mint = async (sub) => {
        if (dry) return null;
        const token = await mintOperatorToken({ secret: jwt.value, issuer, audience, sub });
        red.hold(`operator token for ${sub}`, token);
        return token;
      };
      const opened = await openWorktree('seed');
      try {
        if (opened.why) return fail(opened.why);
        const seedOp = config.seed.operator, regionOp = config.region.operator;
        let token = await mint(seedOp);
        let r = await exec('node', ['scripts/demo-kit/seed.mjs', '--config', slug, '--base', base], { cwd: opened.wt, env: { OPERATOR_TOKEN: token ?? '' }, labels: { OPERATOR_TOKEN: `a 30-minute operator token for ${seedOp}` }, stream: true });
        if (r.code !== 0) return fail('the hosted seed failed (above); nothing was redeployed');
        // P48: the tenant's one-time path, with the seed's token: a set the demo door created with four members gets
        // priors and proposals (the compiled empties); a set that has them answers added: [] and the run goes on.
        r = await exec('node', ['--input-type=module', '-e', BOOTSTRAP_COMPLETE_CALL, 'POST', `${base}/ops/demo-bootstrap/complete?scope=${encodeURIComponent(tenant)}`, tenant], { cwd: opened.wt, env: { OPERATOR_TOKEN: token ?? '' }, labels: { OPERATOR_TOKEN: `a 30-minute operator token for ${seedOp}` }, stream: true, note: `POST /ops/demo-bootstrap/complete for ${tenant}: priors and proposals in its publication set, once` });
        if (r.code !== 0) return fail(`POST /ops/demo-bootstrap/complete for ${tenant} failed (above): its priors and proposals reads stay refused until it is taken, and the seed has re-anchored ${config.seed.beats.dir}/ without the redeploy; run the seed step again before anyone presents`);
        for (const line of REDEPLOY_RULE(slug, config.seed.beats.dir)) say(line);
        if ((await deployFrom(opened.wt, `ships the re-anchored ${config.seed.beats.dir}/`)) === null) return fail(`the redeploy after the seed failed (above): ${worker} serves beat documents older than the ones just published; redeploy before anyone presents`);
        token = await mint(regionOp);
        r = await exec('node', ['scripts/demo-kit/region-seed.mjs', '--config', slug, '--base', base], { cwd: opened.wt, env: { OPERATOR_TOKEN: token ?? '' }, labels: { OPERATOR_TOKEN: `a 30-minute operator token for ${regionOp}` }, stream: true, note: 'every state and DC; about 11 minutes hosted' });
        if (r.code !== 0) return fail('the region seed failed (above)');
        return OK;
      } finally {
        const dir = `${config.seed.beats.dir.replace(/\/+$/, '')}/`;
        await closeWorktree(opened, { expected: (e) => e.code.trim() === 'M' && e.path.startsWith(dir) });
      }
    },

    async verify() {
      const args = ['scripts/demo-kit/check-demo.mjs', '--config', slug, '--base', base, '--skip', 'generated,typecheck,credentials'];
      const r = await exec(wsl ? 'node.exe' : 'node', args, { stream: true, note: `${wsl ? 'Windows node through WSL interop, since the DOM suite needs Chrome; ' : ''}the bundles, typecheck and grep ran in preflight` });
      if (r.code === 127) return fail(`node.exe did not start from WSL; run it from Windows: node ${args.join(' ')}`);
      if (r.code !== 0) return fail(`check-demo against ${base} failed (above)`);
      return OK;
    },
  };

  say(`host ${slug}: ${worker}, ${base}${dry ? ' · DRY RUN: nothing is run, nothing is sent, every value redacted' : ''}`);
  say(`  from ${rootShown} · steps: ${steps.join(', ')}${only ? ` · secrets: ${only.join(', ')}` : ''}`);
  for (const name of steps) {
    const n = STEPS.indexOf(name) + 1;
    say(`\n━━ ${n}/${STEPS.length} ${name}: ${TITLES[name]}`);
    let result;
    try { result = await STEP[name](); } catch (error) { result = fail(error?.message ?? String(error)); }
    if (!result.ok) { shout(`\n✗ stopped at step ${n}/${STEPS.length}, ${name}: ${result.why}`); return 1; }
  }
  const versions = state.versions.filter(Boolean);
  say(`\n${dry ? '· dry run: ' : '✓ '}${steps.join(', ')}${dry ? ' printed; nothing was run' : ' passed'}${versions.length && !dry ? ` · versions ${versions.join(', ')}` : ''}`);
  say(`  ${base}/${slug}/`);
  return 0;
}

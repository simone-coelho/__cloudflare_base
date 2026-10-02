#!/usr/bin/env node
// scripts/demo-kit/new-demo.mjs — a new demo, scaffolded from its demo.config.json (docs/demo-kit/Demo-Kit-Design.md §2.3–§2.5).
//
//   node scripts/demo-kit/new-demo.mjs --config public/<slug>/demo.config.json [--dry-run] [--leave <path>[,<path>…]] [--rebuild-beats] [--root <dir>]
//
// It validates the config (lib/config.mjs validateDemoConfig), refuses a slug whose worker, queue, tenant or dev port
// another demo in the repository already holds, and writes, from the templates under scripts/demo-kit/templates/:
//
//   wrangler.<slug>.toml                         through scripts/build-demo-worker-config.mjs --name edge-platform-<slug>
//                                                --queue events-<slug> --dev-port <port> (generated; rewritten each run)
//   src/demos/<slug>.config.ts, src/routes/<slug>.ts    the constants and the kit's factories; the mount lines for
//                                                src/index.ts are PRINTED for the lead, never applied
//   public/<slug>/                               index.html, product.html, m.html, <slug>.css, <slug>.js, beats.json,
//                                                beats/ (the anchor file, the opening documents, one per beat),
//                                                catalog.json and the products file when absent, img/MANIFEST.json
//   scripts/demo-kit/configs/<slug>.json         the kit config (+ <slug>/reflex.json, learn.json) and two suites,
//   scripts/rehearse-<slug>-page.mjs, -dom.mjs   with the arrival checks written
//   docs/<slug>/                                 the design pointer, the presenter script, the resume
//
// It NEVER overwrites a file that exists: it skips it with a note (the scaffold is a first cut; after it the files are
// their lanes'). --leave names paths under public/<slug> another lane writes, which it leaves alone even when absent
// (for OH: img/MANIFEST.json, the imagery lane's). --rebuild-beats is the one exception, and only when asked: it
// rewrites the beat documents and the kit config from the catalog as it stands (after the demo's own catalog replaces
// a starter one), before anyone has edited them by hand. --dry-run writes nothing and prints the plan.
//
// --root <dir> scaffolds into another tree (a scratch copy of the repository, for a proof): the config is read from
// <dir>/public/<slug>/demo.config.json, collisions are checked against <dir>'s own worker configs and kit configs, and
// EVERY write lands under <dir>, the worker config included (this repository's builder, with --out into <dir>). The
// templates are read from <dir> when it carries them, else from this repository.
//
// It creates no cloud resource of any kind: the worker, its queues, its tenant and its secrets are printed, by name,
// for the owner's one-time approval, with the deploy command.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { isEntry } from './lib/cli.mjs';
import { argOf, REPO_ROOT, validateDemoConfig } from './lib/config.mjs';
import { TEMPLATES, WORKER_SECRETS, collisions, exists, mountLines, operatorsOf, planScaffold } from './lib/scaffold.mjs';

export const USAGE = 'usage: node scripts/demo-kit/new-demo.mjs --config public/<slug>/demo.config.json [--dry-run] [--leave <path>[,<path>…]] [--rebuild-beats] [--root <dir>]';

/**
 * The files --rebuild-beats may rewrite: the beat documents, and the kit config with its reflex and learn documents,
 * derived with them. Never the server's constants (src/demos/<slug>.config.ts): a lane adds to that file (OH's
 * sign-in accounts), so when what the config derives differs from it, the run says what changed instead.
 */
export const rebuildable = (slug, path) => path.startsWith(`public/${slug}/beats/`) || path === `scripts/demo-kit/configs/${slug}.json`
  || path === `scripts/demo-kit/configs/${slug}/reflex.json` || path === `scripts/demo-kit/configs/${slug}/learn.json`;

/** The closed lists a server config holds, as the scaffold writes them: each `  'name': 'kind',` line and each vocabulary line. */
const derivedLines = (text) => String(text).split('\n').filter((l) => /^ {2}'[^']+': '(catalog|slots)',$/.test(l) || /^ {2}[A-Za-z]+: \[.*\],$/.test(l));

/** The worker builder's command line for a demo. */
export const builderArgs = (demo) => ['scripts/build-demo-worker-config.mjs', '--name', demo.worker.name, '--queue', demo.worker.queue, '--dev-port', String(demo.worker.devPort)];
/**
 * The same, for a scaffold into another root: this repository's builder (it reads this repository's wrangler.toml)
 * with --out naming the file inside that root, so the worker config is written there and nowhere else.
 */
export function builderArgsFor(demo, root) {
  if (resolve(root) === resolve(REPO_ROOT)) return builderArgs(demo);
  const [script, ...rest] = builderArgs(demo);
  return [resolve(REPO_ROOT, script), ...rest, '--out', resolve(root, `wrangler.${demo.slug}.toml`)];
}

/**
 * What a run does with each planned file: write it, leave it (it exists), rebuild it (--rebuild-beats), or leave it
 * to another lane (--leave). Pure, so a test can read the decisions without writing anything.
 */
export function decide(plan, { root = REPO_ROOT, slug, leave = [], rebuild = false }) {
  const left = leave.map((p) => (p.startsWith('public/') ? p : `public/${slug}/${p.replace(/^\/+/, '')}`));
  return plan.files.map((f) => {
    if (left.some((p) => f.path === p || (p.endsWith('/') && f.path.startsWith(p)))) return { ...f, action: 'leave', why: 'left to another lane (--leave)' };
    if (exists(root, f.path)) return rebuild && rebuildable(slug, f.path) ? { ...f, action: 'rebuild', why: 'rewritten (--rebuild-beats)' } : { ...f, action: 'skip', why: 'exists, left as it is' };
    return { ...f, action: 'write' };
  });
}

/** The scaffold, from a command line. Returns the exit code: 0 done, 1 a step failed, 2 a usage, config or collision error. */
export async function main(argv = process.argv.slice(2), { root: given = REPO_ROOT, log = console.log, err = console.error, nowMs = Date.now(), runBuilder = true } = {}) {
  const file = argOf(argv, '--config');
  if (!file) { err(USAGE); return 2; }
  const rootArg = argOf(argv, '--root');
  if (argv.includes('--root') && !rootArg) { err(USAGE); return 2; }
  const root = rootArg ? resolve(process.cwd(), rootArg) : given;
  if (rootArg && !existsSync(root)) { err(`✗ --root ${rootArg}: no such directory`); return 2; }
  const abs = resolve(process.cwd(), file);
  let demo;
  try { demo = JSON.parse(readFileSync(abs, 'utf8')); } catch (error) { err(`✗ ${file}: ${error.message}`); return 2; }
  const { ok, errors } = validateDemoConfig(demo, { root });
  if (!ok) { err(`✗ ${file}: ${errors.length} problem(s)\n  - ${errors.join('\n  - ')}`); return 2; }
  const where = relative(root, abs).split('\\').join('/');
  if (where !== `public/${demo.slug}/demo.config.json`) { err(`✗ ${file}: a demo's config lives at public/${demo.slug}/demo.config.json (the page and its suites read it there)`); return 2; }
  const taken = collisions(demo, { root });
  if (taken.length) { err(`✗ the slug "${demo.slug}" collides with a demo the repository already holds; nothing written:\n  - ${taken.join('\n  - ')}`); return 2; }

  const dry = argv.includes('--dry-run');
  const leave = (argOf(argv, '--leave', '') || '').split(',').map((s) => s.trim()).filter(Boolean);
  let plan;
  // A scratch root without the kit's templates uses this repository's: the scaffold is the same, only its writes move.
  const templates = existsSync(resolve(root, 'scripts', 'demo-kit', 'templates')) ? resolve(root, 'scripts', 'demo-kit', 'templates') : TEMPLATES;
  try { plan = planScaffold({ demo, root, nowMs, templates }); } catch (error) { err(`✗ ${error.message}`); return 2; }
  const decided = decide(plan, { root, slug: demo.slug, leave, rebuild: argv.includes('--rebuild-beats') });

  log(`\n${demo.name}: the scaffold from ${where}${dry ? ' (dry run: nothing written)' : ''}${resolve(root) !== resolve(REPO_ROOT) ? ` into ${root} (--root: every write lands there)` : ''}`);
  for (const n of plan.notes) log(`  · ${n}`);
  const mark = { write: '+', rebuild: '~', skip: '=', leave: '-' };
  for (const group of ['server', 'page', 'beats', 'data', 'kit', 'suites', 'docs']) {
    const files = decided.filter((f) => f.group === group);
    if (!files.length) continue;
    log(`\n  ${group}`);
    for (const f of files) log(`   ${mark[f.action]} ${f.path}${f.why ? `  (${f.why})` : ''}`);
  }
  if (!dry) for (const f of decided) if (f.action === 'write' || f.action === 'rebuild') {
    const target = resolve(root, f.path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, f.content);
  }

  log('\n  worker');
  if (dry || !runBuilder) log(`   · node ${builderArgsFor(demo, root).join(' ')}${dry ? '  (not run: dry run)' : '  (not run)'}`);
  else {
    const r = spawnSync(process.execPath, builderArgsFor(demo, root), { cwd: root, encoding: 'utf8' });
    log(`   ${r.status === 0 ? '+' : '✗'} ${(r.stdout || r.stderr || '').trim()}`);
    if (r.status !== 0) { err('✗ the worker builder failed; the rest of the scaffold is written'); return 1; }
  }

  // The server's constants are a lane's once written: when the closed beat list or the seed door's vocabulary the
  // config derives differs from the file, say so, and leave the file to its owner.
  const server = decided.find((f) => f.path === `src/demos/${demo.slug}.config.ts`);
  if (server && server.action === 'skip') {
    const now = derivedLines(readFileSync(resolve(root, server.path), 'utf8')).join('\n'), want = derivedLines(server.content).join('\n');
    if (now !== want) plan.warnings.push(`${server.path} differs from what demo.config.json derives (the closed beat list or the seed door's vocabulary); its owner updates it by hand:\n${want.split('\n').map((l) => `      ${l}`).join('\n')}`);
  }
  for (const w of plan.warnings) log(`\n  ! ${w}`);
  const m = mountLines(demo);
  const ops = operatorsOf(demo.slug);
  log(`\n── For the lead: the lines for src/index.ts (not applied)
  with the other route imports:
    ${m.import}
  after the Vantage mounts:
    ${m.mounts[0]}
    ${m.mounts[1]}

── For the owner: the cloud resources the worker needs (nothing created here)
  queues   ${demo.worker.queue}, ${demo.worker.queue}-dlq
  secrets  ${WORKER_SECRETS.join(', ')} (by name only; TENANTS provisions "${demo.tenant}" with operator grants for ${Object.values(ops).join(', ')})
  deploy   npm run check:generated && node ${builderArgs(demo).join(' ')} && npx wrangler deploy --config wrangler.${demo.slug}.toml   (from a clean WSL worktree, on the owner's go)

── Next, locally: docs/${demo.slug}/RESUME-${demo.slug}.md ("Bring it back up locally"), then
  node scripts/demo-kit/check-demo.mjs --config ${demo.slug} --base http://localhost:${demo.worker.devPort}`);
  const counts = Object.fromEntries(['write', 'rebuild', 'skip', 'leave'].map((a) => [a, decided.filter((f) => f.action === a).length]));
  log(`\n${dry ? '· would write' : '✓ wrote'} ${counts.write} file(s)${counts.rebuild ? `, rebuilt ${counts.rebuild}` : ''}; left ${counts.skip} that exist${counts.leave ? ` and ${counts.leave} for another lane` : ''}${plan.warnings.length ? `; ${plan.warnings.length} warning(s) above` : ''}`);
  return 0;
}

if (isEntry(import.meta.url)) process.exit(await main());

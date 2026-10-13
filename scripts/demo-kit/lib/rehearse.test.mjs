// node --test scripts/demo-kit/lib/rehearse.test.mjs
// The rehearsal harness (lane K3, part c): the checks' vocabulary both suites print in, the exit code a "!"
// line leaves (0, and 1 under --strict), the request client's wire, and the config-driven suite selection of
// scripts/demo-kit/rehearse.mjs, in process on the Vantage config and end to end on a scratch tree. No worker,
// no network beyond a local stub server, no credential.
import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, REPO_ROOT, validateConfig } from './config.mjs';
import { codeOnly, createChecks, createClient, flagReader, ids, suiteSummary } from './rehearse.mjs';
import { configFileFor, main, selectSuite, splitArgs, suiteCommand } from '../rehearse.mjs';

const capture = (opts = {}) => { const lines = []; return { lines, checks: createChecks({ ...opts, out: (l) => lines.push(l) }) }; };

// ── The checks' vocabulary ────────────────────────────────────────────────────

test('ok prints ✓ with its detail in brackets and ✗ with its detail after a dash, and returns the verdict', () => {
  const { lines, checks } = capture();
  assert.equal(checks.ok('the hero answers the ad', true, 'hero-launch'), true);
  assert.equal(checks.ok('the four are on screen', true), true);
  assert.equal(checks.ok('the pin holds container one', 0, 'no pin'), false);
  assert.equal(checks.ok('no detail on a failure', null), false);
  assert.deepEqual(lines, [
    '   ✓ the hero answers the ad  (hero-launch)',
    '   ✓ the four are on screen',
    '   ✗ the pin holds container one — no pin',
    '   ✗ no detail on a failure',
  ]);
  assert.equal(checks.passes, 2);
  assert.equal(checks.failures, 2);
  assert.equal(checks.exitCode(), 1);
});

test('info is indented as each suite indents it: six spaces at request level, eight in the DOM suite', () => {
  const page = capture({ infoIndent: 6 }), dom = capture({ infoIndent: 8 });
  page.checks.info('hero launch 0.260');
  dom.checks.info('1.8 s (the press 0.3 s)');
  assert.deepEqual(page.lines, ['      hero launch 0.260']);
  assert.deepEqual(dom.lines, ['        1.8 s (the press 0.3 s)']);
  assert.equal(createChecks().exitCode(), 0, 'no check, no failure');
});

test('the last line, in each suite\'s own words, and suiteSummary reads it back', () => {
  const pass = capture();
  pass.checks.ok('one', true); pass.checks.ok('two', true);
  const line = pass.checks.summary({ failed: 'the page is not ready to hand over', passed: 'the page works through its own path, with no manual step' });
  assert.equal(line, '✓ 2 checks: the page works through its own path, with no manual step');
  assert.deepEqual(pass.lines.slice(-1), [`\n${line}`], 'printed after a blank line');
  assert.deepEqual(suiteSummary(pass.lines.join('\n')), { ok: true, passed: 2, total: 2, line });

  const fail = capture();
  fail.checks.ok('one', true); fail.checks.ok('two', false); fail.checks.fail('the walk threw at press 3: boom');
  const failed = fail.checks.summary({ failed: 'do not hand this over', passed: 'never printed' });
  assert.equal(failed, '✗ 2 of 3 check(s) failed: do not hand this over');
  assert.ok(fail.lines.includes('   ✗ the walk threw at press 3: boom'), 'fail() prints as a failed check and counts');
  assert.deepEqual(suiteSummary(fail.lines.join('\n')), { ok: false, passed: 1, total: 3, line: failed });
  assert.equal(fail.checks.exitCode(), 1);
});

test('a "!" line: a known defect prints, is named on the last line, and leaves the exit code at 0; --strict fails it', () => {
  const lax = capture({ infoIndent: 8, defectsDoc: 'docs/verizon/lanes/L5.md' });
  lax.checks.ok('the press landed', true);
  assert.equal(lax.checks.known('↳ 9a’s before row is her own beat-8 page', false, 'before A · hers B', 'lane L2 (vantage.js streamingShopper)'), false);
  assert.equal(lax.checks.known('a defect that is fixed passes', true, 'fixed', 'lane L2'), true);
  assert.deepEqual(lax.lines.slice(1, 3), [
    '   ! ↳ 9a’s before row is her own beat-8 page — before A · hers B\n     known page defect, recorded for lane L2 (vantage.js streamingShopper) in docs/verizon/lanes/L5.md',
    '   ✓ a defect that is fixed passes  (fixed)',
  ]);
  const line = lax.checks.summary({ failed: 'do not hand this over', passed: 'the real page runs every press, and every effect has a visible cause' });
  assert.equal(line, '✓ 2 checks: the real page runs every press, and every effect has a visible cause'
    + ' · 1 known page defect printed above (9a’s before row is her own beat-8 page (lane L2 (vantage.js streamingShopper)))');
  assert.equal(lax.checks.exitCode(), 0, 'a "!" line alone is not a failure');
  assert.equal(suiteSummary(line).ok, true, 'check-demo reads it as a pass');
  assert.deepEqual(lax.checks.defects, ['↳ 9a’s before row is her own beat-8 page (lane L2 (vantage.js streamingShopper))']);

  const strict = capture({ strict: true, defectsDoc: 'docs/verizon/lanes/L5.md' });
  strict.checks.known('↳ 9a’s before row is her own beat-8 page', false, 'before A · hers B', 'lane L2');
  assert.deepEqual(strict.lines, ['   ✗ ↳ 9a’s before row is her own beat-8 page — before A · hers B']);
  assert.equal(strict.checks.exitCode(), 1);
  assert.equal(strict.checks.summary({ failed: 'do not hand this over', passed: 'x' }), '✗ 1 of 1 check(s) failed: do not hand this over');

  const two = capture();
  two.checks.known('a', false, 'x', 'o1'); two.checks.known('b', false, 'y', 'o2');
  assert.match(two.checks.summary({ failed: 'f', passed: 'p' }), / · 2 known page defects printed above \(a \(o1\); b \(o2\)\)$/);
});

test('a suite process exits 0 with a "!" line and 1 with it under --strict, as its last line says', () => {
  const lib = new URL('./rehearse.mjs', import.meta.url).href;
  const suite = `import { createChecks } from ${JSON.stringify(lib)};
const checks = createChecks({ infoIndent: 8, strict: process.argv.includes('--strict'), defectsDoc: 'docs/x.md' });
checks.ok('the press landed', true, 'done');
checks.known('a known defect', false, 'detail', 'lane X');
checks.summary({ failed: 'do not hand this over', passed: 'every effect has a visible cause' });
process.exit(checks.exitCode());`;
  const run = (...args) => spawnSync(process.execPath, ['--input-type=module', '-e', suite, '--', ...args], { encoding: 'utf8' });
  const lax = run();
  assert.equal(lax.status, 0, lax.stderr);
  assert.match(lax.stdout, /^ {3}! a known defect — detail\n {5}known page defect, recorded for lane X in docs\/x\.md$/m);
  assert.deepEqual(suiteSummary(lax.stdout), { ok: true, passed: 1, total: 1, line: '✓ 1 checks: every effect has a visible cause · 1 known page defect printed above (a known defect (lane X))' });
  const strict = run('--strict');
  assert.equal(strict.status, 1);
  assert.match(strict.stdout, /^ {3}✗ a known defect — detail$/m);
  assert.deepEqual(suiteSummary(strict.stdout), { ok: false, passed: 1, total: 2, line: '✗ 1 of 2 check(s) failed: do not hand this over' });
});

test('flagReader reads a flag as the suites always have: the next word, the fallback when absent', () => {
  const arg = flagReader(['node', 'suite.mjs', '--base', 'http://localhost:9115', '--strict', '--wait', '45', '--chrome']);
  assert.equal(arg('--base', 'http://localhost:9110'), 'http://localhost:9115');
  assert.equal(arg('--wait', '45'), '45');
  assert.equal(arg('--size', '1440x900'), '1440x900');
  assert.equal(arg('--chrome'), undefined, 'a trailing flag with no value reads as undefined, as before');
  assert.equal(arg('--strict'), '--wait', 'a boolean flag is read with process.argv.includes, never with arg()');
  assert.deepEqual(ids([{ customerContentId: 'a' }, { customerContentId: 'b' }]), ['a', 'b']);
  assert.deepEqual(ids(null), []);
});

test('codeOnly keeps code, strings, templates and patterns, and blanks comments line for line', () => {
  const src = "const a = 'Vantage'; // Vantage in a comment\n/* carrier\n block */ const re = /vantage\\/api/; const t = `x ${'carrier'} y`;\n";
  const out = codeOnly(src, 'js');
  assert.equal(out.split('\n').length, src.split('\n').length, 'line numbers kept');
  assert.match(out, /const a = 'Vantage';/);
  assert.doesNotMatch(out, /in a comment/);
  assert.doesNotMatch(out.split('\n')[1], /carrier/, 'a block comment blanked');
  assert.match(out, /\/vantage\\\/api\//, 'a regular expression stays');
  assert.match(out, /`x \$\{'carrier'\} y`/, 'a template with its substitution stays');
  assert.equal(codeOnly('a { color: red } /* Vantage */\n.b{}', 'css'), 'a { color: red }              \n.b{}');
});

// ── The request client ────────────────────────────────────────────────────────

test('the client sends what the page sends: X-Tenant and the site key, the demo route by name, the asserted context', async () => {
  const seen = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, headers: req.headers, body: body ? JSON.parse(body) : undefined });
      res.setHeader('content-type', 'application/json');
      if (req.url.startsWith('/v1/demo/decisions/snapshot')) res.end(JSON.stringify({ arm: 'x', decisions: [{ slot: 'deals', order: 1, customerContentId: 'b' }, { slot: 'deals', order: 0, customerContentId: 'a' }, { slot: 'hero', order: 0, customerContentId: 'h' }] }));
      else if (req.url === '/demo/api/beat') res.end(JSON.stringify({ ok: true, kind: 'catalog' }));
      else if (req.url === '/demo/api/receipt') res.end(JSON.stringify({ records: [{ decision_id: 'd1' }] }));
      else { res.statusCode = 404; res.end('{}'); }
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const client = createClient({ base, tenant: 'demo', source: 'demo-site', assets: '/demo/', api: '/demo/api' });
    const v = { label: 'A', session: { subject: 's', sessionId: 'sid', capability: 'cap-not-a-token' }, entry: { utmTerm: 'x' }, intent: 'new' };
    const snap = await client.snapshot(v, 'home', { region: null, intent: 'new' });
    assert.deepEqual(ids(snap.slot('deals')), ['a', 'b'], 'a slot in its order');
    assert.deepEqual(snap.asked, { region: null, intent: 'new' });
    const q = new URL(seen[0].url, base).searchParams;
    assert.equal(q.get('page'), 'home');
    assert.equal(q.get('entry'), JSON.stringify({ utmTerm: 'x' }));
    assert.equal(q.get('ctx.intent'), 'new');
    assert.equal(q.has('ctx.region'), false, 'no region asserted, none sent');
    assert.equal(seen[0].headers['x-tenant'], 'demo');
    assert.equal(seen[0].headers['x-sdk-key'], 'demo-site');
    assert.equal(seen[0].headers['x-shopper-session'], 'cap-not-a-token');
    assert.equal(seen[0].headers.authorization, undefined);
    await client.demoRoute('/demo/api/beat', { kind: 'catalog', name: 'n', note: 'x' });
    assert.deepEqual(seen[1].body, { kind: 'catalog', name: 'n', note: 'x' });
    assert.equal(seen[1].headers['x-tenant'], 'demo');
    const got = await client.receipts(v, [{ decisionId: 'd1' }, { decisionId: 'd1' }], { intent: 'new' });
    assert.deepEqual([...got.keys()], ['d1']);
    assert.deepEqual(seen[2].body, { decisionIds: ['d1'], context: { intent: 'new' } });
    await assert.rejects(client.assetJson('nothing.json'), /\/demo\/nothing\.json answered 404/);
    await assert.rejects(client.demoRoute('/demo/api/reset', {}), /\/demo\/api\/reset \{\} → 404/);
  } finally {
    server.close();
  }
});

// ── The config-driven suite selection ────────────────────────────────────────

const vantageFile = fileURLToPath(new URL('../configs/vantage.json', import.meta.url));
const { config: vantage } = loadConfig(vantageFile);

test('the Vantage config names one suite of each kind, and rehearse.mjs selects them by kind', () => {
  assert.equal(selectSuite(vantage, 'page').script, 'scripts/rehearse-vantage-page.mjs');
  assert.equal(selectSuite(vantage, 'dom').script, 'scripts/rehearse-vantage-dom.mjs');
  assert.throws(() => selectSuite(vantage, 'all'), /--suite must be page or dom, not "all"/);
  assert.throws(() => selectSuite({ slug: 'x', check: { suites: [{ name: 'request level', kind: 'page', script: 's' }] } }, 'dom'),
    /x has no suite of kind "dom" \(check\.suites: page: request level\)/);
  assert.equal(configFileFor('vantage'), vantageFile, 'a slug names scripts/demo-kit/configs/<slug>.json');
  assert.equal(configFileFor('scripts/demo-kit/configs/vantage.json', { cwd: tmpdir() }), vantageFile, 'a path, relative to the repository root');
  assert.equal(configFileFor('no-such-demo'), null);
  assert.equal(configFileFor('../outside'), null);
});

test('the suite\'s command: node, its script, --base, the config\'s args, then the caller\'s flags in order', () => {
  const { own, rest, errors } = splitArgs(['--config', 'vantage', '--wait', '45', '--suite', 'dom', '--strict', '--base', 'http://localhost:9115', '--shots', 'out']);
  assert.deepEqual(errors, []);
  assert.deepEqual(own, { config: 'vantage', suite: 'dom', base: 'http://localhost:9115' });
  assert.deepEqual(rest, ['--wait', '45', '--strict', '--shots', 'out']);
  assert.deepEqual(splitArgs(['--config']).errors, ['--config needs a value']);
  assert.deepEqual(splitArgs(['--suite', 'page', '--suite', 'dom']).errors, ['--suite is given twice']);
  const cmd = suiteCommand({ script: 'scripts/s.mjs', args: ['--exit-wait', '50'] }, { base: 'http://x', rest: ['--strict'], path: (p) => `/repo/${p}`, node: 'node' });
  assert.deepEqual(cmd, ['node', '/repo/scripts/s.mjs', '--base', 'http://x', '--exit-wait', '50', '--strict']);
});

test('main runs the selected suite with the caller\'s flags, and refuses before running anything when a part is missing', async () => {
  const ran = [];
  const run = async (cmd) => { ran.push(cmd); return 7; };
  const log = () => {};
  assert.equal(await main(['--config', 'vantage', '--suite', 'dom', '--base', 'http://localhost:9115/', '--wait', '45', '--strict'], { run, log }), 7, 'the suite\'s exit code');
  assert.deepEqual(ran[0].slice(1), [join(REPO_ROOT, 'scripts', 'rehearse-vantage-dom.mjs'), '--base', 'http://localhost:9115', '--wait', '45', '--strict']);
  assert.equal(await main(['--config', 'vantage', '--suite', 'page', '--base', 'http://localhost:9115'], { run, log }), 7);
  assert.equal(ran[1][1], join(REPO_ROOT, 'scripts', 'rehearse-vantage-page.mjs'));
  const said = [];
  for (const argv of [['--suite', 'page', '--base', 'http://x'], ['--config', 'vantage', '--base', 'http://x'], ['--config', 'vantage', '--suite', 'page'],
    ['--config', 'vantage', '--suite', 'both', '--base', 'http://x'], ['--config', 'nope', '--suite', 'page', '--base', 'http://x'],
    ['--config', 'vantage', '--suite', 'page', '--base', 'localhost:9115']]) {
    assert.equal(await main(argv, { run, log: (m) => said.push(m) }), 2, argv.join(' '));
  }
  assert.equal(ran.length, 2, 'nothing ran on a refusal');
  assert.match(said.join('\n'), /--config required[\s\S]*--suite required[\s\S]*--base required[\s\S]*--suite must be page or dom[\s\S]*no scripts\/demo-kit\/configs\/nope\.json[\s\S]*an http or https URL/);
});

test('the config names each suite\'s kind: page or dom, one of each, and nothing else', () => {
  const errorsOf = (mutate) => { const c = structuredClone(vantage); mutate(c); return validateConfig(c, { sections: ['check'] }).errors.join('\n'); };
  assert.equal(errorsOf(() => {}), '');
  assert.match(errorsOf((c) => { delete c.check.suites[0].kind; }), /^check\.suites\[0\]\.kind: page or dom/m);
  assert.match(errorsOf((c) => { c.check.suites[1].kind = 'browser'; }), /^check\.suites\[1\]\.kind: page or dom/m);
  assert.match(errorsOf((c) => { c.check.suites[1].kind = 'page'; }), /^check\.suites\[1\]\.kind: "page" is listed twice/m);
});

// ── End to end, on a scratch tree: rehearse.mjs and check-demo.mjs ───────────

function scratchKit() {
  const root = mkdtempSync(join(tmpdir(), 'demo-kit-rehearse-'));
  const kitDir = fileURLToPath(new URL('..', import.meta.url));
  for (const rel of ['rehearse.mjs', 'check-demo.mjs', 'lib/cli.mjs', 'lib/config.mjs', 'lib/credentials.mjs', 'lib/rehearse.mjs']) {
    mkdirSync(dirname(join(root, 'scripts', 'demo-kit', rel)), { recursive: true });
    copyFileSync(join(kitDir, rel), join(root, 'scripts', 'demo-kit', rel));
  }
  const files = {
    'public/demo/index.html': '<title>Demo</title>\n',
    // A stand-in for each kind of suite, on the kit's own vocabulary: it prints its arguments, one pass and one "!" line.
    'scripts/suite-page.mjs': "import { createChecks } from './demo-kit/lib/rehearse.mjs';\nconst checks = createChecks({ infoIndent: 6, strict: process.argv.includes('--strict'), defectsDoc: 'docs/x.md' });\n"
      + "checks.info(`args ${JSON.stringify(process.argv.slice(2))}`);\nchecks.ok('the page answers', true);\nchecks.known('a known defect', false, 'detail', 'lane X');\n"
      + "checks.summary({ failed: 'the page is not ready to hand over', passed: 'the page works through its own path, with no manual step' });\nprocess.exit(checks.exitCode());\n",
    'scripts/suite-dom.mjs': "import { createChecks } from './demo-kit/lib/rehearse.mjs';\nconst checks = createChecks({ infoIndent: 8 });\n"
      + "checks.info(`args ${JSON.stringify(process.argv.slice(2))}`);\nchecks.ok('the real page runs', true);\nchecks.ok('every press lands', true);\n"
      + "checks.summary({ failed: 'do not hand this over', passed: 'the real page runs every press, and every effect has a visible cause' });\nprocess.exit(checks.exitCode());\n",
    'scripts/demo-kit/configs/demo.json': JSON.stringify({
      name: 'Demo', slug: 'demo', tenant: 'demo', publicDir: 'public/demo',
      worker: { name: 'edge-platform-demo', queue: 'events-demo', devPort: 9199 },
      check: { suites: [{ name: 'request level', kind: 'page', script: 'scripts/suite-page.mjs', args: ['--exit-wait', '50'] },
        { name: 'DOM', kind: 'dom', script: 'scripts/suite-dom.mjs' }] },
    }),
  };
  for (const [rel, text] of Object.entries(files)) { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), text); }
  return root;
}

test('rehearse.mjs end to end: the config picks the script, the output passes through, the exit code is the suite\'s', () => {
  const root = scratchKit();
  const run = (...args) => spawnSync(process.execPath, [join(root, 'scripts', 'demo-kit', 'rehearse.mjs'), ...args], { cwd: root, encoding: 'utf8' });
  const page = run('--config', 'demo', '--suite', 'page', '--base', 'http://127.0.0.1:9/', '--wait', '45');
  assert.equal(page.status, 0, page.stdout + page.stderr);
  assert.ok(page.stdout.includes(`args ${JSON.stringify(['--base', 'http://127.0.0.1:9', '--exit-wait', '50', '--wait', '45'])}`), page.stdout);
  assert.match(page.stdout, /^ {3}! a known defect — detail$/m);
  assert.equal(suiteSummary(page.stdout).line, '✓ 1 checks: the page works through its own path, with no manual step · 1 known page defect printed above (a known defect (lane X))');
  const strict = run('--config', 'scripts/demo-kit/configs/demo.json', '--suite', 'page', '--base', 'http://127.0.0.1:9', '--strict');
  assert.equal(strict.status, 1, 'a "!" line fails under --strict, and the runner passes that on');
  assert.equal(suiteSummary(strict.stdout).line, '✗ 1 of 2 check(s) failed: the page is not ready to hand over');
  const dom = run('--config', 'demo', '--suite', 'dom', '--base', 'http://127.0.0.1:9');
  assert.equal(dom.status, 0, dom.stdout + dom.stderr);
  assert.ok(dom.stdout.includes(`args ${JSON.stringify(['--base', 'http://127.0.0.1:9'])}`), dom.stdout);
  assert.equal(suiteSummary(dom.stdout).total, 2);
  const none = run('--config', 'demo', '--suite', 'page');
  assert.equal(none.status, 2);
  assert.match(none.stderr, /--base required/);
});

test('check-demo takes a demo\'s slug, runs each of its suites through rehearse.mjs and reads its last line', () => {
  const root = scratchKit();
  const r = spawnSync(process.execPath, [join(root, 'scripts', 'demo-kit', 'check-demo.mjs'), '--config', 'demo',
    '--skip', 'generated,typecheck,credentials', '--base', 'http://127.0.0.1:9'], { cwd: root, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /━━ request level: node scripts\/demo-kit\/rehearse\.mjs --config scripts\/demo-kit\/configs\/demo\.json --suite page --base http:\/\/127\.0\.0\.1:9 \(runs scripts\/suite-page\.mjs --exit-wait 50\)/);
  assert.match(r.stdout, /━━ DOM: node scripts\/demo-kit\/rehearse\.mjs --config scripts\/demo-kit\/configs\/demo\.json --suite dom --base http:\/\/127\.0\.0\.1:9 \(runs scripts\/suite-dom\.mjs\)/);
  assert.match(r.stdout, /✓ request level\s+1 of 1 checks/);
  assert.match(r.stdout, /✓ DOM\s+2 of 2 checks/);
  assert.match(r.stdout, /✓ 2 of 2 step\(s\) passed/);
});

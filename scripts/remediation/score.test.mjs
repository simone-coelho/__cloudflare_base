#!/usr/bin/env node
/* eslint-env node */
/**
 * Proof for batch TOOLS-1: one test per unit, each with its refusal leg.
 *   node --test scripts/remediation/score.test.mjs
 *
 * The score units run the CLI as a child process against synthetic vitest
 * reports in temporary workspaces, so exit codes and messages are proved, not
 * simulated. Temporary workspaces are left in place: this suite never deletes
 * recursively (METHOD section 7 command rules).
 */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { unitStatus } from './score.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const TOOL = join(HERE, 'score.mjs');
const sha256 = value => createHash('sha256').update(value).digest('hex');

function score(args) {
  const result = spawnSync(process.execPath, [TOOL, ...args], { encoding: 'utf8' });
  return { code: result.status, out: result.stdout ?? '', err: result.stderr ?? '' };
}

/** A vitest --reporter=json report whose stored counts are deliberately wrong. */
function report(tests) {
  const files = new Map();
  for (const t of tests) {
    const name = t.file ?? 'src/units/W16/b1.unit.test.ts';
    if (!files.has(name)) files.set(name, []);
    files.get(name).push({
      ancestorTitles: [], fullName: t.name, title: t.name,
      status: t.status ?? 'passed', duration: 1, failureMessages: [],
    });
  }
  return {
    numTotalTests: 999, numPassedTests: 999, numFailedTests: 999,
    success: false, startTime: 0,
    testResults: [...files].map(([name, assertionResults]) => ({
      name, startTime: 0, endTime: 1, message: '',
      status: assertionResults.some(a => a.status === 'failed') ? 'failed' : 'passed',
      assertionResults,
    })),
  };
}

function workspace({ units = [], reviews = {}, baseline = null } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'tools1-score-'));
  mkdirSync(join(dir, 'docs', 'remediation'), { recursive: true });
  writeFileSync(join(dir, 'docs', 'remediation', 'units.json'), `${JSON.stringify(units, null, 2)}\n`);
  if (Object.keys(reviews).length > 0) mkdirSync(join(dir, 'docs', 'remediation', 'reviews'), { recursive: true });
  for (const [w, review] of Object.entries(reviews)) {
    writeFileSync(join(dir, 'docs', 'remediation', 'reviews', `${w}.json`), `${JSON.stringify(review, null, 2)}\n`);
  }
  if (baseline) {
    writeFileSync(join(dir, 'docs', 'remediation', 'baseline-failures.json'), `${JSON.stringify(baseline, null, 2)}\n`);
  }
  return dir;
}

const reportPath = (dir, tests) => {
  const path = join(dir, 'vitest.json');
  writeFileSync(path, JSON.stringify(report(tests)));
  return path;
};
const scorePath = dir => join(dir, 'docs', 'remediation', 'SCORE.md');
const baselinePath = dir => join(dir, 'docs', 'remediation', 'baseline-failures.json');
const readScore = dir => readFileSync(scorePath(dir), 'utf8');

// ---------------------------------------------------------------------------

/** Every include entry is either an exact path or a glob; this is the matcher tsc applies. */
function includeMatches(entry, path) {
  const pattern = entry
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*\//g, '(?:.*/)?')
    .replace(/(?<!\.)\*/g, '[^/]*');
  return new RegExp(`^${pattern}$`).test(path);
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, out);
    else out.push(path);
  }
  return out;
}

/** Every .mjs under src that a src module actually imports, relative to the repository root. */
function importedMjs(tsconfig) {
  const paths = tsconfig.compilerOptions?.paths ?? {};
  const src = join(ROOT, 'src');
  const found = new Set();
  for (const file of walk(src).filter(f => /\.(ts|tsx|mjs)$/.test(f))) {
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(/(?:^|[\n;])\s*(?:import|export)\b[^;]*?from\s*['"]([^'"]+\.mjs)['"]/g)) {
      const specifier = match[1];
      let target = null;
      if (specifier.startsWith('.')) target = resolve(dirname(file), specifier);
      else {
        for (const [alias, targets] of Object.entries(paths)) {
          const prefix = alias.replace(/\*$/, '');
          if (alias.endsWith('*') && specifier.startsWith(prefix)) {
            target = resolve(ROOT, targets[0].replace(/\*$/, '') + specifier.slice(prefix.length));
            break;
          }
        }
      }
      if (target === null) continue;
      const rel = relative(ROOT, target).split('\\').join('/');
      if (rel.startsWith('src/') && readdirSync(dirname(target)).includes(target.split('/').pop())) found.add(rel);
    }
  }
  return [...found].sort();
}

test('unit:TOOLS.01 the tsconfig include lists every .mjs that src imports, so plain tsc emits no TS6307', () => {
  const tsconfig = JSON.parse(readFileSync(join(ROOT, 'tsconfig.json'), 'utf8'));
  const include = tsconfig.include;
  assert.ok(Array.isArray(include) && include.length > 0, 'tsconfig.json must keep an include array');
  assert.equal(tsconfig.compilerOptions.composite, true, 'TOOLS.01 changes no compiler option: composite stays on');
  assert.equal(tsconfig.compilerOptions.noEmit, true, 'TOOLS.01 changes no compiler option: noEmit stays on');

  const imported = importedMjs(tsconfig);
  assert.ok(imported.length >= 2, `the scan must find the .mjs imports it is asserting on, found ${imported.length}`);
  assert.ok(imported.includes('src/identity/material.mjs'), 'src/identity/material.mjs is the file plain tsc refused');
  assert.ok(imported.includes('src/auth/signingConfig.mjs'), 'src/auth/signingConfig.mjs is the precedent the fix follows');

  const uncovered = imported.filter(path => !include.some(entry => includeMatches(entry, path)));
  assert.deepEqual(uncovered, [], `tsconfig include misses imported .mjs files: ${uncovered.join(', ')}`);

  // Refusal leg: the same checker must fail when the entry is absent, and the
  // .ts globs must not silently cover .mjs, or this test could never fail.
  const without = include.filter(entry => entry !== 'src/identity/material.mjs');
  assert.deepEqual(
    imported.filter(path => !without.some(entry => includeMatches(entry, path))),
    ['src/identity/material.mjs'],
    'negative control: dropping the include entry must expose material.mjs again',
  );
  assert.equal(includeMatches('src/**/*.ts', 'src/identity/material.mjs'), false);
});

// ---------------------------------------------------------------------------

const SUITE = [
  { name: 'unit:W16.C2.01 organic search referrer', status: 'passed' },
  { name: 'unit:W16.C2.01 lookalike host', status: 'passed' },
  { name: 'unit:W16.C2.02 paid social wins', status: 'passed' },
  { name: 'unit:W17.C1.01 something else', status: 'passed' },
  { name: 'unit:W18.C1.01 reviewed without a sha', status: 'passed' },
  { name: 'a known unrelated failure', status: 'failed' },
  { name: 'unit:W19.C1.01 red unit', status: 'failed', file: 'src/services/other.test.ts' },
  { name: 'an unrelated pass', status: 'passed', file: 'src/services/other.test.ts' },
];
const SUITE_UNITS = [
  // The counts inside these rows are noise: the tool derives every number.
  { id: 'W16.C2.01', w: 'W16', status: 'declared', green: true, units_green: 99 },
  { id: 'W16.C2.02', w: 'W16', status: 'declared' },
  { id: 'W17.C1.01', w: 'W17', status: 'declared' },
  { id: 'W18.C1.01', w: 'W18', status: 'declared' },
  { id: 'W19.C1.01', w: 'W19', status: 'declared', green: true },
];
const SUITE_REVIEWS = {
  W16: { w: 'W16', verdict: 'PASS', sha: 'abc1234', date: '2026-09-18' },
  W17: { w: 'W17', verdict: 'INCOMPLETE', sha: 'def5678', date: '2026-09-18' },
  W18: { w: 'W18', verdict: 'PASS', sha: '', date: '2026-09-18' },
  W19: { w: 'W19', verdict: 'PASS', sha: 'aaa9999', date: '2026-09-18' },
};
const SUITE_BASELINE = { note: 'fixture', failures: ['a known unrelated failure', 'unit:W19.C1.01 red unit'] };
const SUITE_LINE = 'Units 4/5 · W closed 1/26 (W16–W41) · suite 6/8 · residual 2 in 2 files · typecheck GREEN';

const suiteWorkspace = () => workspace({ units: SUITE_UNITS, reviews: SUITE_REVIEWS, baseline: SUITE_BASELINE });

test('unit:TOOLS.02 score.mjs --write derives SCORE.md from the vitest report and ignores every stored count', () => {
  const dir = suiteWorkspace();
  const from = reportPath(dir, SUITE);
  const written = score(['--from', from, '--root', dir, '--typecheck', 'green', '--write']);
  assert.equal(written.code, 0, written.err);

  const text = readScore(dir);
  const lines = text.split('\n');
  assert.ok(lines.includes(SUITE_LINE), `score line missing; got:\n${lines.slice(0, 10).join('\n')}`);
  assert.ok(written.out.includes(SUITE_LINE), 'the tool prints the line it wrote');

  // Per-W table: closed needs declared units, all green, PASS and a sha.
  assert.ok(text.includes('| W16 | 2 | 2 | yes | PASS | abc1234 |'), 'W16 closes');
  assert.ok(text.includes('| W17 | 1 | 1 | no | INCOMPLETE | def5678 |'), 'an INCOMPLETE review does not close W17');
  assert.ok(text.includes('| W18 | 1 | 1 | no | PASS | — |'), 'a PASS without a sha does not close W18');
  assert.ok(text.includes('| W19 | 1 | 0 | no | PASS | aaa9999 |'), 'a red unit does not close W19');

  // Per-unit table.
  assert.ok(text.includes('| W16.C2.01 | green | 2 |'));
  assert.ok(text.includes('| W19.C1.01 | red | 1 |'));

  // Failures are all in the baseline.
  assert.ok(text.includes('## Failing tests outside the baseline\n\n_None._'), text);

  // Derivation inputs: the two sha256 values and the checkout commit.
  const unitsSha = sha256(readFileSync(join(dir, 'docs', 'remediation', 'units.json')));
  const fromSha = sha256(readFileSync(from));
  assert.ok(text.includes(`| units sha256 | ${unitsSha} |`), 'units.json sha256 is recorded');
  assert.ok(text.includes(`| vitest report sha256 | ${fromSha} |`), 'vitest.json sha256 is recorded');
  assert.match(text, /\| commit \| (?:[0-9a-f]{40}|unknown) \|/, 'the checkout commit is recorded');
  assert.match(text, /\| generated \| \d{4}-\d{2}-\d{2}T[\d:.]+Z \|/);

  // The commit is the checkout HEAD, not a placeholder: derive against this
  // repository while writing only into the temporary workspace.
  const head = execFileSync('git', ['-C', ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const against = join(dir, 'against-root.md');
  const rooted = score(['--from', from, '--root', ROOT, '--units', join(dir, 'docs', 'remediation', 'units.json'),
    '--baseline', baselinePath(dir), '--score', against, '--typecheck', 'red', '--write']);
  assert.equal(rooted.code, 0, rooted.err);
  assert.ok(readFileSync(against, 'utf8').includes(`| commit | ${head} |`), 'the commit is git rev-parse HEAD of the checkout');
  // Refusal leg: counts asserted inside units.json are ignored, not trusted.
  assert.ok(!text.includes('Units 5/5'), 'a row claiming green does not make a red unit green');
  assert.ok(!text.includes('/999'), 'the stored numTotalTests in the report is ignored');

  // Refusal leg (hole 5): a row the tool cannot read is never dropped in silence,
  // which would shrink the denominator; the whole file is refused, by row index.
  const typoed = workspace({ units: [{ id: 'W20.C1.01', w: 'W20' }, { w: 'W20', criterion: 'C1', outcome: 'id key typoed' }] });
  const typo = score(['--from', from, '--root', typoed, '--typecheck', 'green', '--write']);
  assert.equal(typo.code, 1, 'a row with no id must refuse the whole file');
  assert.match(typo.err, /row 1 has no "id"/);
  assert.equal(existsSync(join(typoed, 'docs', 'remediation', 'SCORE.md')), false, 'nothing is written on a refusal');

  const duplicated = workspace({ units: [{ id: 'W20.C1.01', w: 'W20' }, { id: 'W20.C1.01', w: 'W21' }] });
  const duplicate = score(['--from', from, '--root', duplicated, '--typecheck', 'green', '--write']);
  assert.equal(duplicate.code, 1, 'a repeated id would shrink the denominator just as quietly');
  assert.match(duplicate.err, /row 1 repeats id W20\.C1\.01/);

  const notAnObject = workspace({ units: [{ id: 'W20.C1.01', w: 'W20' }, 'W20.C1.02'] });
  const malformed = score(['--from', from, '--root', notAnObject, '--typecheck', 'green', '--write']);
  assert.equal(malformed.code, 1);
  assert.match(malformed.err, /row 1 is not an object/);
});

test('unit:TOOLS.03 score.mjs --check re-derives the score and refuses a hand-edited SCORE.md', () => {
  const dir = suiteWorkspace();
  const from = reportPath(dir, SUITE);
  const args = ['--from', from, '--root', dir, '--typecheck', 'green'];
  assert.equal(score([...args, '--write']).code, 0);

  const clean = score([...args, '--check']);
  assert.equal(clean.code, 0, clean.err);
  assert.ok(clean.out.includes('matches the derived score'));

  // Refusal leg: one edited digit is refused, and the first differing line is named.
  const edited = readScore(dir).replace('Units 4/5', 'Units 5/5');
  writeFileSync(scorePath(dir), edited);
  const hand = score([...args, '--check']);
  assert.equal(hand.code, 1, 'a hand-edited count must be refused');
  assert.match(hand.err, /differs from the derived score at line \d+/);
  assert.ok(hand.err.includes('committed: Units 5/5'), hand.err);
  assert.ok(hand.err.includes(`derived:   ${SUITE_LINE}`), hand.err);

  // A deleted line is refused too.
  writeFileSync(scorePath(dir), edited.split('\n').filter(l => !l.startsWith('| W16 |')).join('\n'));
  assert.equal(score([...args, '--check']).code, 1, 'a deleted table row must be refused');

  // A wrong --typecheck is refused: the state is an input, not a decoration.
  score([...args, '--write']);
  assert.equal(score(['--from', from, '--root', dir, '--typecheck', 'red', '--check']).code, 1);

  // A file this tool did not produce is refused rather than silently accepted.
  writeFileSync(scorePath(dir), 'Units 4/5\n');
  const marker = score([...args, '--check']);
  assert.equal(marker.code, 1);
  assert.match(marker.err, /no provenance marker/);

  // Documented limitation, asserted so it stays visible: the provenance block
  // (commit, generated time, report sha) changes on every run and is not compared.
  score([...args, '--write']);
  writeFileSync(scorePath(dir), readScore(dir).replace(/\| commit \| [0-9a-f]+ \|/, '| commit | 0000000 |'));
  assert.equal(score([...args, '--check']).code, 0, 'provenance is excluded from the comparison by design');
});

test('unit:TOOLS.04 --check-ratchet refuses a failure outside the baseline and --write-baseline refuses to grow it', () => {
  const dir = workspace({ units: [] });
  const noisy = [
    { name: 'b failing', status: 'failed' },
    { name: 'a failing', status: 'failed' },
    { name: 'b failing', status: 'failed', file: 'src/services/other.test.ts' },
    { name: 'passing', status: 'passed' },
  ];
  const from = reportPath(dir, noisy);

  // Fail closed with no baseline at all.
  const none = score(['--from', from, '--root', dir, '--check-ratchet']);
  assert.equal(none.code, 1);
  assert.match(none.err, /No baseline/);

  const written = score(['--from', from, '--root', dir, '--write-baseline', '--note', 'fixture baseline']);
  assert.equal(written.code, 0, written.err);
  const baseline = JSON.parse(readFileSync(baselinePath(dir), 'utf8'));
  assert.deepEqual(baseline.failures, ['a failing', 'b failing'], 'sorted and unique');
  assert.equal(baseline.vitest_sha256, sha256(readFileSync(from)));
  assert.match(baseline.commit, /^[0-9a-f]{40}$|^unknown$/);
  assert.match(baseline.generated, /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/);
  assert.equal(baseline.note, 'fixture baseline');
  assert.equal(baseline.allow_grow_reason, null);
  assert.equal(score(['--from', from, '--root', dir, '--check-ratchet']).code, 0);

  // Refusal leg 1: a failure absent from the baseline stops the gate and is named.
  const regressed = reportPath(workspaceFile(dir, 'regressed'), [...noisy, { name: 'c newly failing', status: 'failed' }]);
  const caught = score(['--from', regressed, '--root', dir, '--check-ratchet']);
  assert.equal(caught.code, 1);
  assert.ok(caught.err.includes('NEW FAILURE outside the baseline: c newly failing'), caught.err);

  // Refusal leg 2: a longer list is refused unless the growth is explained.
  const grow = score(['--from', regressed, '--root', dir, '--write-baseline', '--note', 'fixture baseline']);
  assert.equal(grow.code, 1);
  assert.match(grow.err, /Refusing to add 1 failing test\(s\) to the baseline of 2/);
  assert.deepEqual(JSON.parse(readFileSync(baselinePath(dir), 'utf8')).failures, ['a failing', 'b failing']);

  const allowed = score(['--from', regressed, '--root', dir, '--write-baseline', '--note', 'fixture baseline',
    '--allow-grow', 'owner accepted: new leg lands red pending W20']);
  assert.equal(allowed.code, 0, allowed.err);
  const grown = JSON.parse(readFileSync(baselinePath(dir), 'utf8'));
  assert.deepEqual(grown.failures, ['a failing', 'b failing', 'c newly failing']);
  assert.equal(grown.allow_grow_reason, 'owner accepted: new leg lands red pending W20');

  // Refusal leg 3 (hole 1, laundering): a SAME-LENGTH swap still adds a failure.
  // Growth is judged name by name, so an equal count is no longer a way past it.
  const swapBaseline = { note: 'fixture baseline', failures: ['a failing', 'b failing'] };
  const swapDir = workspace({ units: [], baseline: swapBaseline });
  const swapped = reportPath(swapDir, [
    { name: 'a failing', status: 'failed' },
    { name: 'z newly failing', status: 'failed' },
    { name: 'passing', status: 'passed' },
  ]);
  const swapRatchet = score(['--from', swapped, '--root', swapDir, '--check-ratchet']);
  assert.equal(swapRatchet.code, 1, 'the swapped-in failure is outside the baseline');
  assert.ok(swapRatchet.err.includes('NEW FAILURE outside the baseline: z newly failing'), swapRatchet.err);

  const laundered = score(['--from', swapped, '--root', swapDir, '--write-baseline', '--note', 'fixture baseline']);
  assert.equal(laundered.code, 1, 'a same-length swap must be refused, not written');
  assert.ok(laundered.err.includes('NOT IN THE COMMITTED BASELINE: z newly failing'), laundered.err);
  assert.deepEqual(JSON.parse(readFileSync(baselinePath(swapDir), 'utf8')).failures, swapBaseline.failures,
    'the committed list is untouched by a refused write');

  const swapAllowed = score(['--from', swapped, '--root', swapDir, '--write-baseline', '--note', 'fixture baseline',
    '--allow-grow', 'owner accepted: b fixed, z owed under W21']);
  assert.equal(swapAllowed.code, 0, swapAllowed.err);
  const afterSwap = JSON.parse(readFileSync(baselinePath(swapDir), 'utf8'));
  assert.deepEqual(afterSwap.failures, ['a failing', 'z newly failing']);
  assert.equal(afterSwap.allow_grow_reason, 'owner accepted: b fixed, z owed under W21',
    'the authorisation is recorded in the file it authorised');

  // Shrinking needs no permission, and the tool says the list can shrink.
  const fixed = reportPath(workspaceFile(dir, 'fixed'), [{ name: 'a failing', status: 'failed' }]);
  const shrinkable = score(['--from', fixed, '--root', dir, '--check-ratchet']);
  assert.equal(shrinkable.code, 0, shrinkable.err);
  assert.match(shrinkable.out, /2 baseline entries no longer fail/);
  assert.equal(score(['--from', fixed, '--root', dir, '--write-baseline']).code, 0);
  const shrunk = JSON.parse(readFileSync(baselinePath(dir), 'utf8'));
  assert.deepEqual(shrunk.failures, ['a failing']);
  assert.equal(shrunk.note, 'fixture baseline', 'the note is preserved when it is not restated');
  assert.equal(shrunk.allow_grow_reason, null, 'a shrink clears the growth reason');

  // Refusal leg 4 (hole 4): an unusable report is refused, never scored as zero
  // failing. A crashed suite must not read as a clean one.
  const emptyReport = join(dir, 'empty-report.json');
  writeFileSync(emptyReport, JSON.stringify({ numTotalTests: 0, numFailedTests: 0, success: true, testResults: [] }));
  const empty = score(['--from', emptyReport, '--root', dir, '--check-ratchet']);
  assert.equal(empty.code, 1, 'a report that collected nothing must be refused');
  assert.match(empty.err, /collected no tests/);
  assert.equal(score(['--from', emptyReport, '--root', dir, '--typecheck', 'green', '--write']).code, 1,
    'and it cannot be written into a score either');

  const crashed = join(dir, 'crashed-report.json');
  writeFileSync(crashed, JSON.stringify({ testResults: [
    { name: 'src/units/W16/b1.unit.test.ts', status: 'failed', message: 'Cannot find module ./missing', assertionResults: [] },
    { name: 'src/services/other.test.ts', status: 'passed', message: '',
      assertionResults: [{ fullName: 'a failing', status: 'failed', failureMessages: [] }] },
  ] }));
  const uncollected = score(['--from', crashed, '--root', dir, '--check-ratchet']);
  assert.equal(uncollected.code, 1, 'a file that failed to collect hides its tests from the ratchet');
  assert.ok(uncollected.err.includes('src/units/W16/b1.unit.test.ts'), uncollected.err);
  assert.match(uncollected.err, /failed to collect/);

  assert.equal(score(['--from', join(dir, 'no-such-report.json'), '--root', dir, '--check-ratchet']).code, 1,
    'a missing report is refused, not treated as a clean run');

  // A check that regenerates its own input cannot fail, so the pair is refused.
  assert.equal(score(['--from', fixed, '--root', dir, '--write-baseline', '--check-ratchet']).code, 2);
});

function workspaceFile(dir, name) {
  const child = join(dir, name);
  mkdirSync(child, { recursive: true });
  return child;
}

test('unit:TOOLS.05 a unit with no test is unspecified and a skipped or todo test never counts as green', () => {
  const units = [
    { id: 'W20.C1.01', w: 'W20' },
    { id: 'W20.C1.02', w: 'W20' },
    { id: 'W20.C1.03', w: 'W20' },
    { id: 'W20.C1.04', w: 'W20' },
  ];
  const dir = workspace({ units, baseline: { note: 'fixture', failures: [] } });
  const from = reportPath(dir, [
    { name: 'unit:W20.C1.02 first leg', status: 'passed' },
    { name: 'unit:W20.C1.02 second leg', status: 'pending' },
    { name: 'unit:W20.C1.03 only leg', status: 'todo' },
    { name: 'unit:W20.C1.04 only leg', status: 'passed' },
  ]);
  const written = score(['--from', from, '--root', dir, '--typecheck', 'green', '--write']);
  assert.equal(written.code, 0, written.err);
  const text = readScore(dir);

  assert.ok(text.includes('| W20.C1.01 | unspecified | 0 |'), 'no test at all is unspecified, never green');
  assert.ok(text.includes('| W20.C1.02 | red | 2 |'), 'a skipped leg keeps the unit red');
  assert.ok(text.includes('| W20.C1.03 | red | 1 |'), 'a todo leg keeps the unit red');
  assert.ok(text.includes('| W20.C1.04 | green | 1 |'));
  assert.ok(text.includes('Units 1/4 · W closed 0/26'), text.split('\n').find(l => l.startsWith('Units ')));

  // Refusal leg, directly on the rule: nothing but a matched, wholly passing set is green.
  const tests = [{ fullName: 'unit:X.01 a', status: 'passed' }, { fullName: 'unit:X.01 b', status: 'pending' }];
  assert.deepEqual(unitStatus('X.02', tests), { status: 'unspecified', matched: 0 });
  assert.deepEqual(unitStatus('X.01', tests), { status: 'red', matched: 2 });
  assert.deepEqual(unitStatus('X.01', [tests[0]]), { status: 'green', matched: 1 });

  // Refusal leg (hole 2): the id must end at a boundary, or a shorter id
  // swallows a longer one and another unit's test confers green.
  const ten = [{ fullName: 'unit:W16.C2.10 only leg', status: 'passed' }];
  assert.deepEqual(unitStatus('W16.C2.1', ten), { status: 'unspecified', matched: 0 },
    'unit:W16.C2.1 must not match unit:W16.C2.10');
  assert.deepEqual(unitStatus('W16.C2.10', ten), { status: 'green', matched: 1 });
  assert.deepEqual(unitStatus('W16.C2.01', [{ fullName: 'unit:W16.C2.010 leg', status: 'passed' }]),
    { status: 'unspecified', matched: 0 });
  assert.deepEqual(unitStatus('W16.C2.01', [{ fullName: 'xunit:W16.C2.01 leg', status: 'passed' }]),
    { status: 'unspecified', matched: 0 });
  assert.deepEqual(unitStatus('W16.C2.01', [{ fullName: 'unit:W16.C2.01 leg', status: 'passed' }]),
    { status: 'green', matched: 1 });
  assert.deepEqual(unitStatus('W16.C2.01', [{ fullName: 'describe > unit:W16.C2.01 > it holds', status: 'passed' }]),
    { status: 'green', matched: 1 });

  // The same boundary through the CLI, on the score the lead reads.
  const boundaryDir = workspace({
    units: [{ id: 'W16.C2.1', w: 'W16' }, { id: 'W16.C2.10', w: 'W16' }],
    baseline: { note: 'fixture', failures: [] },
  });
  const boundaryFrom = reportPath(boundaryDir, [{ name: 'unit:W16.C2.10 only leg', status: 'passed' }]);
  const boundary = score(['--from', boundaryFrom, '--root', boundaryDir, '--typecheck', 'green', '--write']);
  assert.equal(boundary.code, 0, boundary.err);
  const boundaryText = readFileSync(join(boundaryDir, 'docs', 'remediation', 'SCORE.md'), 'utf8');
  assert.ok(boundaryText.includes('| W16.C2.1 | unspecified | 0 |'), boundaryText);
  assert.ok(boundaryText.includes('| W16.C2.10 | green | 1 |'), boundaryText);
  assert.ok(boundaryText.includes('Units 1/2 · W closed 0/26'), boundaryText);
});

// ---------------------------------------------------------------------------

/** The ordered commands of one job in the workflow file, read as text. */
function jobSteps(yaml, job) {
  const lines = yaml.split('\n');
  const start = lines.findIndex(line => line === `  ${job}:`);
  assert.notEqual(start, -1, `the workflow must define a ${job} job`);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) if (/^ {2}[A-Za-z][\w-]*:$/.test(lines[i])) { end = i; break; }
  return { lines: lines.slice(start, end), text: lines.slice(start, end).join('\n') };
}

const inOrder = (haystack, needles) => {
  let at = 0;
  for (const needle of needles) {
    const found = haystack.indexOf(needle, at);
    if (found === -1) return needle;
    at = found + needle.length;
  }
  return null;
};

test('unit:TOOLS.06 CI runs the gate commands in order on every push and pull request', () => {
  const yaml = readFileSync(join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
  assert.match(yaml, /^on:\n {2}push:\n {4}branches: \['\*\*'\]\n {2}pull_request:$/m, 'runs on every push and PR');

  const gate = jobSteps(yaml, 'gate');
  const required = [
    'npm ci',
    '--max-old-space-size=4096',
    '--noEmit --incremental false --composite false',
    '-p src/sdk/tsconfig.json --noEmit',
    'node --test scripts/remediation/score.test.mjs',
    'vitest.mjs run src',
    '--maxWorkers=1 --minWorkers=1',
    '--reporter=default --reporter=json',
    'score.mjs --from',
    '--check-ratchet',
    'score.mjs --from',
    '--check',
    'scripts/build-sdk.mjs --check',
    'scripts/build-meridian.mjs --check',
    'npm run lint',
  ];
  assert.equal(inOrder(gate.text, required), null, `gate job is missing or reorders: ${inOrder(gate.text, required)}`);

  // The existing packager stays, as its own job, non-blocking, with its owner named.
  const packaged = jobSteps(yaml, 'verified-package');
  assert.match(packaged.text, /continue-on-error: true/);
  assert.match(packaged.text, /TOOLS/, 'a comment names batch TOOLS as the owner of removing the flag');
  assert.ok(!gate.text.split('\n    steps:')[0].includes('continue-on-error'), 'the gate job itself is blocking');

  // No secrets, deploys or provider calls are introduced by CI.
  for (const forbidden of ['secrets.', 'wrangler deploy', 'scripts/deploy.sh', 'npm run deploy']) {
    assert.ok(!yaml.includes(forbidden), `CI must not reference ${forbidden}`);
  }

  // The same commands are runnable locally.
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts.score, 'node scripts/remediation/score.mjs');
  assert.equal(inOrder(pkg.scripts.gate, required.filter(c => c !== 'npm ci')), null, 'npm run gate runs the same gate');

  // Refusal leg (hole 6): nothing may run the score without first running the
  // score tool's own proof, in CI and locally alike.
  assert.equal(inOrder(gate.text, ['node --test scripts/remediation/score.test.mjs', 'score.mjs --from']), null,
    'CI proves the tool before it trusts the tool');
  assert.equal(inOrder(pkg.scripts.gate, ['node --test scripts/remediation/score.test.mjs', 'score.mjs --from']), null,
    'so does the local gate');

  // Refusal leg (hole 3): the local gate must not read a report from a previous
  // run, and must not discard the suite's exit code.
  assert.ok(pkg.scripts.gate.includes('mktemp'), 'the report goes to a fresh path each run');
  assert.ok(!pkg.scripts.gate.includes('cfbase-gate-vitest.json'), 'no fixed, never-cleared report path');
  assert.ok(!pkg.scripts.gate.includes('|| true'), 'the suite exit is not swallowed');
  assert.ok(pkg.scripts.gate.includes('VITEST_STATUS=$?'), 'the suite exit is captured');
  assert.match(pkg.scripts.gate, /\[ "\$VITEST_STATUS" -le 1 \]/, 'and a crash (any exit above 1) fails the gate');
  assert.match(gate.text, /runner\.temp/, 'CI writes the report to a fresh runner temp path');

  // Negative control: the ordered-subsequence check must be able to fail.
  assert.notEqual(inOrder([...required].reverse().join(' '), required), null);
  assert.notEqual(inOrder(gate.text, [...required, 'a command CI does not run']), null);
});

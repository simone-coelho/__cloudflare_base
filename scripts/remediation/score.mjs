#!/usr/bin/env node
/* eslint-env node */
/**
 * Derived score for the W16-W41 remediation (METHOD.md section 4).
 *
 * Every count in docs/remediation/SCORE.md is computed here from a vitest JSON
 * report (`--reporter=json`). Nothing is typed by hand: `--check` re-derives the
 * file and exits non-zero when the committed copy differs, naming the first
 * differing line. `--check-ratchet` refuses any failing test absent from
 * docs/remediation/baseline-failures.json, and `--write-baseline` refuses to
 * grow that list without a stated reason.
 *
 * Node built-ins only. Read-only unless --write or --write-baseline is given.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SCORE_PATH = 'docs/remediation/SCORE.md';
export const UNITS_PATH = 'docs/remediation/units.json';
export const REVIEWS_PATH = 'docs/remediation/reviews';
export const BASELINE_PATH = 'docs/remediation/baseline-failures.json';
/** The 26 packages the score line counts. */
export const W_RANGE = Array.from({ length: 26 }, (_, i) => `W${16 + i}`);
/** Lines below this marker change on every run and are excluded from --check. */
export const PROVENANCE_MARKER = '<!-- provenance below is derived per run and is NOT compared by --check -->';
export const VERDICTS = ['PASS', 'FAIL', 'INCOMPLETE'];

export const sha256 = value => createHash('sha256').update(value).digest('hex');
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const cell = value => String(value).replace(/\|/g, '\\|');

/** Flattened assertion results plus the counts the score line reports. */
export function readResults(report) {
  const tests = [];
  for (const file of Array.isArray(report?.testResults) ? report.testResults : []) {
    for (const assertion of Array.isArray(file?.assertionResults) ? file.assertionResults : []) {
      tests.push({
        file: String(file?.name ?? ''),
        fullName: String(assertion?.fullName ?? ''),
        status: String(assertion?.status ?? ''),
      });
    }
  }
  const failing = tests.filter(t => t.status === 'failed');
  return {
    tests,
    total: tests.length,
    passed: tests.filter(t => t.status === 'passed').length,
    failed: failing.length,
    failingNames: [...new Set(failing.map(t => t.fullName))].sort(),
    failingFiles: new Set(failing.map(t => t.file)).size,
  };
}

export const matchTests = (id, tests) => tests.filter(t => t.fullName.includes(`unit:${id}`));

/**
 * A unit is green only when at least one test matched and every matched test
 * passed; a skipped ("pending") or todo test therefore never yields green, and
 * a unit with no test at all is `unspecified`, never green.
 */
export function unitStatus(id, tests) {
  const matched = matchTests(id, tests);
  if (matched.length === 0) return { status: 'unspecified', matched: 0 };
  return { status: matched.every(t => t.status === 'passed') ? 'green' : 'red', matched: matched.length };
}

export function readUnits(path) {
  const raw = readFileSync(path, 'utf8');
  const parsed = JSON.parse(raw);
  const rows = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.units) ? parsed.units : null;
  if (!rows) throw new Error(`${path} must be an array of unit rows`);
  const byId = new Map();
  for (const row of rows) {
    if (!nonempty(row?.id) || byId.has(row.id)) continue;
    byId.set(row.id, { id: row.id, w: nonempty(row?.w) ? row.w.trim() : String(row.id).split('.')[0] });
  }
  return { rows: [...byId.values()].sort((a, b) => a.id.localeCompare(b.id)), sha256: sha256(raw) };
}

export function readReview(reviewsDir, w) {
  const file = resolve(reviewsDir, `${w}.json`);
  if (!existsSync(file)) return null;
  let parsed;
  try { parsed = JSON.parse(readFileSync(file, 'utf8')); }
  catch { return { verdict: 'invalid', sha: '' }; }
  const mismatch = nonempty(parsed?.w) && parsed.w.trim() !== w;
  const verdict = VERDICTS.includes(parsed?.verdict) ? parsed.verdict : 'invalid';
  return { verdict: mismatch ? 'invalid' : verdict, sha: nonempty(parsed?.sha) ? parsed.sha.trim() : '' };
}

const wOrder = w => { const m = /^W(\d+)$/.exec(w); return m ? [0, Number(m[1]), ''] : [1, 0, w]; };
const byW = (a, b) => { const x = wOrder(a), y = wOrder(b); return x[0] - y[0] || x[1] - y[1] || x[2].localeCompare(y[2]); };

/** Derives every number the score reports. No stored count is read. */
export function deriveScore({ results, units, reviewsDir, baseline, typecheck }) {
  const unitRows = units.rows.map(row => ({ ...row, ...unitStatus(row.id, results.tests) }));
  const wKeys = new Set(unitRows.map(row => row.w));
  for (const w of W_RANGE) if (existsSync(resolve(reviewsDir, `${w}.json`))) wKeys.add(w);
  const packages = [...wKeys].sort(byW).map(w => {
    const rows = unitRows.filter(row => row.w === w);
    const green = rows.filter(row => row.status === 'green').length;
    const review = readReview(reviewsDir, w);
    return {
      w, declared: rows.length, green, review,
      closed: rows.length > 0 && green === rows.length && review?.verdict === 'PASS' && nonempty(review?.sha),
    };
  });
  const baselineSet = new Set(baseline ? baseline.failures : []);
  return {
    units: unitRows,
    packages,
    green: unitRows.filter(row => row.status === 'green').length,
    declared: unitRows.length,
    closed: packages.filter(p => p.closed && W_RANGE.includes(p.w)).length,
    suite: { passed: results.passed, total: results.total, failed: results.failed, files: results.failingFiles },
    outsideBaseline: baseline ? results.failingNames.filter(name => !baselineSet.has(name)) : null,
    fixedInBaseline: baseline ? baseline.failures.filter(name => !results.failingNames.includes(name)) : [],
    typecheck: typecheck === 'green' ? 'GREEN' : typecheck === 'red' ? 'RED' : 'UNKNOWN',
  };
}

export const scoreLine = model =>
  `Units ${model.green}/${model.declared} · W closed ${model.closed}/26 (W16–W41) · ` +
  `suite ${model.suite.passed}/${model.suite.total} · residual ${model.suite.failed} in ${model.suite.files} files · ` +
  `typecheck ${model.typecheck}`;

export function renderScore(model, inputs, provenance) {
  const lines = [
    '# SCORE — remediation W16–W41',
    '',
    'Derived by `scripts/remediation/score.mjs` from the vitest JSON report. No count in this file is',
    'typed by hand: `--check` re-derives every line above the provenance marker and exits non-zero on',
    'any difference. A W item is closed only when it has declared units, all of them are green, and',
    '`docs/remediation/reviews/<W>.json` records a reviewer PASS at a named commit.',
    '',
    scoreLine(model),
    '',
    '## W items',
    '',
    '| W | Declared | Green | Closed | Review | Review sha |',
    '|---|---|---|---|---|---|',
  ];
  if (model.packages.length === 0) lines.push('| _none declared_ | 0 | 0 | no | — | — |');
  for (const p of model.packages) {
    lines.push(`| ${cell(p.w)} | ${p.declared} | ${p.green} | ${p.closed ? 'yes' : 'no'} | ` +
      `${p.review ? cell(p.review.verdict) : '—'} | ${p.review && p.review.sha ? cell(p.review.sha) : '—'} |`);
  }
  lines.push('', '## Units', '', '| Unit | Status | Tests matched |', '|---|---|---|');
  if (model.units.length === 0) lines.push('| _none declared_ | — | 0 |');
  for (const u of model.units) lines.push(`| ${cell(u.id)} | ${u.status} | ${u.matched} |`);
  lines.push('', '## Failing tests outside the baseline', '');
  if (model.outsideBaseline === null) lines.push(`_No baseline file at ${inputs.baselineLabel}; the ratchet cannot judge._`);
  else if (model.outsideBaseline.length === 0) lines.push('_None._');
  else for (const name of model.outsideBaseline) lines.push(`- ${name}`);
  lines.push(
    '', '## Derivation inputs', '', '| Input | Value |', '|---|---|',
    `| units | ${cell(inputs.unitsLabel)} |`,
    `| units sha256 | ${inputs.unitsSha256} |`,
    `| reviews | ${cell(inputs.reviewsLabel)} |`,
    `| baseline | ${cell(inputs.baselineLabel)} |`,
    `| typecheck | ${model.typecheck} (from --typecheck) |`,
    '', PROVENANCE_MARKER, '', '## Provenance', '', '| Input | Value |', '|---|---|',
    `| vitest report | ${cell(provenance.fromLabel)} |`,
    `| vitest report sha256 | ${provenance.fromSha256} |`,
    `| commit | ${cell(provenance.commit)} |`,
    `| generated | ${cell(provenance.generated)} |`,
    '',
  );
  return `${lines.join('\n')}`;
}

/** Everything above the provenance marker; that region is what --check compares. */
export function comparedRegion(text) {
  const lines = text.split('\n');
  const index = lines.indexOf(PROVENANCE_MARKER);
  return index === -1 ? null : lines.slice(0, index);
}

export function firstDifference(committed, derived) {
  const length = Math.max(committed.length, derived.length);
  for (let i = 0; i < length; i += 1) {
    if (committed[i] !== derived[i]) {
      return { line: i + 1, committed: committed[i] ?? '(end of file)', derived: derived[i] ?? '(end of file)' };
    }
  }
  return null;
}

export function readBaseline(path) {
  if (!existsSync(path)) return null;
  const parsed = JSON.parse(readFileSync(path, 'utf8'));
  const failures = Array.isArray(parsed?.failures) ? parsed.failures.filter(nonempty) : null;
  if (!failures) throw new Error(`${path} must hold a "failures" array`);
  return { ...parsed, failures };
}

export function buildBaseline({ failures, fromSha256, commit, note, allowGrowReason }) {
  return {
    generated: new Date().toISOString(),
    commit,
    vitest_sha256: fromSha256,
    note,
    allow_grow_reason: allowGrowReason ?? null,
    failures: [...new Set(failures)].sort(),
  };
}

function headOf(root) {
  try {
    const head = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return head.trim() || 'unknown';
  }
  catch { return 'unknown'; }
}

function label(root, path) {
  const rel = relative(root, resolve(path));
  return rel && !rel.startsWith('..') && !isAbsolute(rel) ? rel : `${basename(path)} (outside the checkout)`;
}

const USAGE = [
  'Usage: node scripts/remediation/score.mjs --from <vitest.json> <action> [options]',
  '  actions: --write | --check | --check-ratchet | --write-baseline',
  '  options: --units <path> --reviews <dir> --baseline <path> --score <path> --root <dir>',
  '           --typecheck green|red --note "<text>" --allow-grow "<reason>"',
  '  --write and --check are mutually exclusive, as are --write-baseline and --check-ratchet:',
  '  a check that regenerates its own input cannot fail.',
].join('\n');

export function parseArgs(argv) {
  const options = { actions: new Set() };
  const values = {
    '--from': 'from', '--units': 'units', '--reviews': 'reviews', '--baseline': 'baseline',
    '--score': 'score', '--root': 'root', '--typecheck': 'typecheck', '--note': 'note', '--allow-grow': 'allowGrow',
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (['--write', '--check', '--check-ratchet', '--write-baseline'].includes(arg)) { options.actions.add(arg); continue; }
    if (arg in values) {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) return { error: `${arg} needs a value` };
      options[values[arg]] = value; i += 1; continue;
    }
    return { error: `unknown argument ${arg}` };
  }
  if (!options.from) return { error: '--from <vitest.json> is required' };
  if (options.actions.size === 0) return { error: 'one action is required' };
  if (options.actions.has('--write') && options.actions.has('--check')) return { error: '--write and --check are mutually exclusive' };
  if (options.actions.has('--write-baseline') && options.actions.has('--check-ratchet')) {
    return { error: '--write-baseline and --check-ratchet are mutually exclusive' };
  }
  if (options.typecheck !== undefined && !['green', 'red'].includes(options.typecheck)) {
    return { error: '--typecheck must be green or red' };
  }
  if (options.allowGrow !== undefined && !nonempty(options.allowGrow)) return { error: '--allow-grow needs a reason' };
  return options;
}

export function run(argv, out = process.stdout, err = process.stderr) {
  const options = parseArgs(argv);
  if (options.error) { err.write(`${options.error}\n${USAGE}\n`); return 2; }
  const root = resolve(options.root ?? resolve(dirname(fileURLToPath(import.meta.url)), '../..'));
  const fromPath = resolve(options.from);
  const unitsPath = resolve(options.units ? resolve(options.units) : resolve(root, UNITS_PATH));
  const reviewsDir = resolve(options.reviews ? resolve(options.reviews) : resolve(root, REVIEWS_PATH));
  const baselinePath = resolve(options.baseline ? resolve(options.baseline) : resolve(root, BASELINE_PATH));
  const scorePath = resolve(options.score ? resolve(options.score) : resolve(root, SCORE_PATH));

  let raw, results, baseline;
  try {
    raw = readFileSync(fromPath);
    results = readResults(JSON.parse(raw.toString('utf8')));
  } catch (error) { err.write(`Unreadable vitest report ${fromPath}: ${error.message}\n`); return 1; }
  try { baseline = readBaseline(baselinePath); }
  catch (error) { err.write(`Unreadable baseline ${baselinePath}: ${error.message}\n`); return 1; }

  let status = 0;
  const fromSha256 = sha256(raw);

  if (options.actions.has('--write-baseline')) {
    const note = options.note ?? baseline?.note;
    if (!nonempty(note)) { err.write('--note "<text>" is required for a new baseline\n'); return 1; }
    const grown = baseline !== null && results.failingNames.length > baseline.failures.length;
    if (grown && !options.allowGrow) {
      err.write(`Refusing to grow the baseline from ${baseline.failures.length} to ${results.failingNames.length} ` +
        'failures; pass --allow-grow "<reason>" if the growth is owed and explained.\n');
      return 1;
    }
    const next = buildBaseline({
      failures: results.failingNames, fromSha256, commit: headOf(root), note,
      allowGrowReason: grown ? options.allowGrow : null,
    });
    mkdirSync(dirname(baselinePath), { recursive: true });
    writeFileSync(baselinePath, `${JSON.stringify(next, null, 2)}\n`);
    out.write(`Wrote ${label(root, baselinePath)}: ${next.failures.length} failing tests` +
      `${next.allow_grow_reason ? ` (grown: ${next.allow_grow_reason})` : ''}\n`);
    baseline = next;
  }

  if (options.actions.has('--check-ratchet')) {
    if (baseline === null) { err.write(`No baseline at ${baselinePath}; the ratchet cannot judge. Run --write-baseline.\n`); return 1; }
    const known = new Set(baseline.failures);
    const outside = results.failingNames.filter(name => !known.has(name));
    const fixed = baseline.failures.filter(name => !results.failingNames.includes(name));
    for (const name of outside) err.write(`NEW FAILURE outside the baseline: ${name}\n`);
    out.write(`Ratchet: ${results.failed} failing tests, ${outside.length} outside the baseline of ` +
      `${baseline.failures.length}${fixed.length ? `, ${fixed.length} baseline entries no longer fail (regenerate with --write-baseline)` : ''}\n`);
    if (outside.length > 0) status = 1;
  }

  if (options.actions.has('--write') || options.actions.has('--check')) {
    let unitsFile;
    try { unitsFile = readUnits(unitsPath); }
    catch (error) { err.write(`Unreadable units ${unitsPath}: ${error.message}\n`); return 1; }
    const model = deriveScore({ results, units: unitsFile, reviewsDir, baseline, typecheck: options.typecheck });
    const inputs = {
      unitsLabel: label(root, unitsPath),
      unitsSha256: unitsFile.sha256,
      reviewsLabel: `${label(root, reviewsDir)}${existsSync(reviewsDir) ? '' : ' (absent)'}`,
      baselineLabel: label(root, baselinePath),
    };
    const rendered = renderScore(model, inputs, {
      fromLabel: label(root, fromPath), fromSha256, commit: headOf(root), generated: new Date().toISOString(),
    });
    if (options.actions.has('--write')) {
      mkdirSync(dirname(scorePath), { recursive: true });
      writeFileSync(scorePath, rendered);
      out.write(`${scoreLine(model)}\nWrote ${label(root, scorePath)}\n`);
    } else {
      if (!existsSync(scorePath)) { err.write(`No score at ${scorePath}; run --write.\n`); return 1; }
      const committed = comparedRegion(readFileSync(scorePath, 'utf8'));
      if (committed === null) {
        err.write(`${label(root, scorePath)} has no provenance marker; it was not produced by this tool.\n`);
        return 1;
      }
      const difference = firstDifference(committed, comparedRegion(rendered));
      if (difference) {
        err.write(`${label(root, scorePath)} differs from the derived score at line ${difference.line}:\n` +
          `  committed: ${difference.committed}\n  derived:   ${difference.derived}\n` +
          'The score is derived, never edited: rerun with --write.\n');
        status = 1;
      } else out.write(`${scoreLine(model)}\n${label(root, scorePath)} matches the derived score\n`);
    }
  }
  return status;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = run(process.argv.slice(2));
}

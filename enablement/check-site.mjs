#!/usr/bin/env node
// enablement/check-site.mjs
// Preflight for the internal enablement site. Run it before every deploy:
//
//   node enablement/check-site.mjs            check everything
//   node enablement/check-site.mjs --hashes   print the style-src value for enablement/site/_headers
//
// No dependencies, changes nothing, deploys nothing. It proves from the files alone what the site
// promises: the Content Security Policy in site/_headers allows exactly the inline styles the pages
// carry (a stale hash leaves a page unstyled), no page runs anything or loads anything from another
// address, the package name is written in one place, and wrangler.enablement.toml names the gate
// (enablement/worker.mjs) in front of every request, with the ASSETS binding and no variable or
// credential. It also proves the gate holds no secret and runs the gate's unit tests.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const siteDir = join(root, 'enablement', 'site');
const configPath = join(root, 'wrangler.enablement.toml');
const workerPath = join(root, 'enablement', 'worker.mjs');
const workerTestPath = join(root, 'enablement', 'worker.test.mjs');

// The only things wrangler.enablement.toml may say. Widen these on purpose, never by accident.
// main, assets.binding and assets.run_worker_first were added on purpose by lane E2 for the gate.
const TOP_KEYS = new Set(['name', 'main', 'compatibility_date', 'workers_dev', 'preview_urls']);
const TABLES = { assets: new Set(['directory', 'binding', 'run_worker_first', 'not_found_handling']) };
const TEXT = new Set(['.html', '.css', '.js', '.mjs', '.json', '.txt', '.svg', '.xml', '.md', '.webmanifest']);

// A page is hashed the way the HTML parser reads it: line endings normalised to LF.
const read = (p) => readFileSync(p, 'utf8').replace(/\r\n?/g, '\n');
const walk = (d) => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
const rel = (p) => relative(root, p).split(sep).join('/');
const sha = (s) => `'sha256-${createHash('sha256').update(s, 'utf8').digest('base64')}'`;
const noComments = (s) => s.replace(/<!--[\s\S]*?-->/g, '');
const inlineStyles = (html) => [...noComments(html).matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]);

const files = existsSync(siteDir) ? walk(siteDir) : [];
const pages = files.filter((f) => extname(f).toLowerCase() === '.html').map((f) => ({ file: rel(f), html: read(f) }));
const hashesInUse = [...new Set(pages.flatMap((p) => inlineStyles(p.html).map(sha)))];

if (process.argv.includes('--hashes')) {
  console.log(`style-src ${hashesInUse.join(' ')}`);
  process.exit(0);
}

const problems = [];
const check = (cond, what) => { console.log(`${cond ? 'ok   ' : 'FAIL '} ${what}`); if (!cond) problems.push(what); };

// 1. The files that must exist.
for (const f of ['index.html', '404.html', '_headers']) check(existsSync(join(siteDir, f)), `enablement/site/${f} exists`);

// 2. The policy in _headers: strict, and exactly matching the inline styles.
const headersFile = join(siteDir, '_headers');
const headersText = existsSync(headersFile) ? read(headersFile) : '';
const headerValue = (name) => {
  const line = headersText.split('\n').map((l) => l.trim()).find((l) => l.toLowerCase().startsWith(`${name.toLowerCase()}:`));
  return line ? line.slice(name.length + 1).trim() : '';
};
const directives = {};
for (const d of headerValue('Content-Security-Policy').split(';').map((x) => x.trim()).filter(Boolean)) {
  const [k, ...v] = d.split(/\s+/); directives[k.toLowerCase()] = v;
}
const none = (d) => JSON.stringify(directives[d]) === JSON.stringify(["'none'"]);
check(none('default-src'), "CSP: default-src is 'none'");
for (const d of ['base-uri', 'form-action', 'frame-ancestors']) check(none(d), `CSP: ${d} is 'none'`);
check(!Object.values(directives).flat().some((t) => /^('unsafe-inline'|'unsafe-eval'|\*|https?:|ws:|wss:)$/.test(t)), 'CSP: no unsafe-inline, unsafe-eval, wildcard or remote source');
const allowedHashes = (directives['style-src'] || []).filter((t) => t.startsWith("'sha256-"));
for (const p of pages) for (const css of inlineStyles(p.html)) check(allowedHashes.includes(sha(css)), `CSP allows the inline style of ${p.file} (${sha(css)})`);
check(allowedHashes.every((h) => hashesInUse.includes(h)), 'CSP lists no hash that no page uses');
check(/nosniff/i.test(headerValue('X-Content-Type-Options')), 'header: X-Content-Type-Options nosniff');
check(/no-referrer/i.test(headerValue('Referrer-Policy')), 'header: Referrer-Policy no-referrer');
check(/no-store/i.test(headerValue('Cache-Control')) && /private/i.test(headerValue('Cache-Control')), 'header: Cache-Control private, no-store');
check(/max-age=\d{7,}/.test(headerValue('Strict-Transport-Security')), 'header: Strict-Transport-Security with a long max-age');

// 3. The pages run nothing, store nothing and fetch nothing from anywhere else.
const BANNED_TAG = /<(script|form|input|select|textarea|iframe|frame|object|embed|applet|base)\b/i;
const SCHEME = /^\s*([a-z][a-z0-9+.-]*:|\/\/)/i;
for (const p of pages) {
  const html = noComments(p.html);
  check(!BANNED_TAG.test(html), `${p.file}: no script, form, input, iframe, object, embed or base element`);
  check(!/\son[a-z]+\s*=|\sstyle\s*=|javascript:|http-equiv\s*=/i.test(html), `${p.file}: no event handler, style attribute, javascript: URL or http-equiv`);
  const badLinks = [...html.matchAll(/<link\b[^>]*>/gi)].filter((m) => !/\brel\s*=\s*["']?icon\b/i.test(m[0]));
  check(badLinks.length === 0, `${p.file}: the only link element is the inline icon`);
  const external = [];
  for (const m of html.matchAll(/<(\w+)\b([^>]*)>/g)) {
    for (const a of m[2].matchAll(/\b(href|src|action|formaction|poster|srcset|data|cite|background|ping)\s*=\s*("([^"]*)"|'([^']*)')/gi)) {
      const v = a[3] ?? a[4];
      const inlineIcon = m[1].toLowerCase() === 'link' && /^data:image\//i.test(v);
      if (SCHEME.test(v) && !inlineIcon) external.push(v);
    }
  }
  const css = inlineStyles(p.html);
  const cssUrls = css.flatMap((c) => [...c.matchAll(/url\(\s*["']?([^)"']+)/gi)].map((m) => m[1]).filter((u) => !/^(data:|#)/i.test(u)));
  check(external.length === 0 && cssUrls.length === 0 && !css.some((c) => /@import|@font-face/i.test(c)),
    `${p.file}: nothing is loaded from another address${external.length ? ` (found ${external[0]})` : ''}`);
}

// 4. The package name is written once.
const index = pages.find((p) => p.file.endsWith('/index.html'));
const named = index && noComments(index.html).match(/<(\w+)\b[^>]*\bid="package-name"[^>]*>([\s\S]*?)<\/\1>/);
const packageName = named ? named[2].trim() : '';
check(Boolean(packageName) && (noComments(index.html).match(/\bid="package-name"/g) || []).length === 1, 'index.html has exactly one element with id="package-name"');
const occurrences = packageName ? [...pages.map((p) => noComments(p.html)), headersText].reduce((n, t) => n + t.split(packageName).length - 1, 0) : 0;
check(occurrences === 1, `the package name is written in one place only (found ${occurrences})`);

// 5. The worker config: the gate in front of the pages, one binding, no variable or credential.
const configText = existsSync(configPath) ? read(configPath) : '';
check(configText !== '', 'wrangler.enablement.toml exists');
let table = '';
const seen = {};
for (const raw of configText.split('\n')) {
  const line = raw.replace(/^\s*#.*$/, '').replace(/\s+#.*$/, '').trim();
  if (!line) continue;
  const t = line.match(/^\[(\[)?([^\]]+)\]\]?$/);
  if (t) { table = t[2].trim(); check(!t[1] && table in TABLES, `config: table [${table}] is allowed (assets only, no bindings or vars)`); continue; }
  const kv = line.match(/^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/);
  if (!kv) continue;
  const allowed = table ? TABLES[table] : TOP_KEYS;
  check(Boolean(allowed && allowed.has(kv[1])), `config: key ${table ? `${table}.` : ''}${kv[1]} is allowed`);
  seen[`${table ? `${table}.` : ''}${kv[1]}`] = kv[2].replace(/^"|"$/g, '');
}
check(seen.name === 'edge-platform-bti', 'config: name is edge-platform-bti (the old edge-platform-enablement is not deployed to)');
check(seen.main === 'enablement/worker.mjs' && existsSync(workerPath), 'config: main is enablement/worker.mjs, the passphrase gate');
check(seen['assets.directory'] === './enablement/site' && existsSync(siteDir), 'config: assets directory is ./enablement/site');
check(seen['assets.binding'] === 'ASSETS', 'config: the assets binding is ASSETS, through which the gate serves the pages');
check(seen['assets.run_worker_first'] === 'true', 'config: run_worker_first is true (every request reaches the gate before any file is served)');
check(seen['assets.not_found_handling'] === '404-page', 'config: not_found_handling is 404-page');
check(seen.preview_urls === 'false', 'config: preview_urls is false (one address only)');
check(seen.workers_dev === 'true', 'config: workers_dev is true (the address is edge-platform-bti.expedge.workers.dev)');

// 6. No credential anywhere that gets served, or in the config.
const SECRETS = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'a private key'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'an AWS access key id'],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/, 'a JSON web token'],
  [/\b(?:api[_-]?key|secret|token|passw(?:or)?d|authorization|bearer)\b\s*[:=]\s*["']?[A-Za-z0-9_\-./+=]{16,}/i, 'a credential assignment'],
  [/\b[A-Fa-f0-9]{40,}\b/, 'a long hex string'],
];
const served = files.filter((f) => TEXT.has(extname(f).toLowerCase()) || /_(headers|redirects)$/.test(f)).map((f) => ({ file: rel(f), text: read(f) }));
if (configText) served.push({ file: 'wrangler.enablement.toml', text: configText });
const hits = served.flatMap((s) => SECRETS.filter(([re]) => re.test(s.text)).map(([, what]) => `${s.file}: ${what}`));
check(hits.length === 0, `no credential in anything served or in the config${hits.length ? ` (${hits.join('; ')})` : ''}`);

// 7. The gate: no secret in it or its test, both outside the served folder, and its unit tests pass.
const gateFiles = [workerPath, workerTestPath].filter((f) => existsSync(f)).map((f) => ({ file: rel(f), text: read(f) }));
const workerText = gateFiles.find((g) => g.file === rel(workerPath))?.text || '';
check(gateFiles.length === 2, 'enablement/worker.mjs and enablement/worker.test.mjs exist');
check([workerPath, workerTestPath].every((f) => !resolve(f).startsWith(siteDir + sep)), 'the gate and its test sit outside the served folder enablement/site/');
const gateHits = gateFiles.flatMap((g) => SECRETS.filter(([re]) => re.test(g.text)).map(([, what]) => `${g.file}: ${what}`));
check(gateHits.length === 0, `no credential pattern in the gate or its test${gateHits.length ? ` (${gateHits.join('; ')})` : ''}`);
const LITERAL_SECRET = /\b(?:ACCESS_PASSPHRASE|COOKIE_SECRET|ENABLEMENT_PASSPHRASE|ENABLEMENT_COOKIE_SECRET)\b\s*[:=]\s*['"`]/;
const literals = gateFiles.filter((g) => LITERAL_SECRET.test(g.text)).map((g) => g.file);
check(literals.length === 0, `neither file gives ACCESS_PASSPHRASE or COOKIE_SECRET a literal value${literals.length ? ` (found in ${literals.join(', ')})` : ''}`);
check(/\benv\.ACCESS_PASSPHRASE\b/.test(workerText) && /\benv\.COOKIE_SECRET\b/.test(workerText), 'the gate reads both secrets from its environment only');

// The owner's local values, where this machine has them in .dev.vars, must appear nowhere in the gate,
// its test, the config or anything served, and must meet the gate's own minimums. They are compared
// and tried, never printed.
const devVarsPath = join(root, '.dev.vars');
const devVars = existsSync(devVarsPath) ? read(devVarsPath) : '';
const devVar = (name) => {
  const line = devVars.split('\n').find((l) => l.startsWith(`${name}=`));
  return line === undefined ? '' : line.slice(name.length + 1).trim().replace(/^(["'])(.*)\1$/, '$2');
};
const localPassphrase = devVar('ENABLEMENT_PASSPHRASE');
const localKey = devVar('ENABLEMENT_COOKIE_SECRET');
const localValues = [localPassphrase, localKey].filter((v) => v.length >= 8);
if (localValues.length) {
  const leaks = [...gateFiles, ...served].filter((s) => localValues.some((v) => s.text.includes(v))).map((s) => s.file);
  check(leaks.length === 0, `no local ENABLEMENT_ value from .dev.vars appears in the gate, its test, the config or anything served${leaks.length ? ` (found in ${leaks.join(', ')})` : ''}`);
} else {
  console.log('note  no ENABLEMENT_ values in a local .dev.vars to compare; the pattern checks above still apply');
}
if (localPassphrase && localKey && workerText) {
  let status = -1;
  try {
    const { default: gate } = await import(pathToFileURL(workerPath).href);
    const env = { ACCESS_PASSPHRASE: localPassphrase, COOKIE_SECRET: localKey, ASSETS: { fetch: async () => new Response(null, { status: 404 }) } };
    status = (await gate.fetch(new Request('https://edge-platform-bti.expedge.workers.dev/auth'), env)).status;
  } catch {
    status = -1;
  }
  check(status === 200, `the local ENABLEMENT_PASSPHRASE and ENABLEMENT_COOKIE_SECRET meet the gate's minimums, 15 characters and 32 bytes (GET /auth answers ${status}, not 503)`);
}

const tests = spawnSync(process.execPath, ['--test', '--test-reporter=tap', workerTestPath], { cwd: root, encoding: 'utf8', timeout: 120000 });
const tally = (label) => ((tests.stdout || '').match(new RegExp(`^# ${label} (\\d+)$`, 'm')) || [])[1] ?? '?';
check(tests.status === 0, `node --test enablement/worker.test.mjs passes (${tally('pass')} of ${tally('tests')} tests)`);
if (tests.status !== 0) console.log((tests.stdout || '').split('\n').filter((l) => /^not ok|^\s+(error|expected|actual):/.test(l)).slice(0, 24).join('\n') || tests.stderr || String(tests.error));

console.log(problems.length ? `\n${problems.length} problem(s). Do not deploy.` : '\nAll checks passed.');
process.exit(problems.length ? 1 : 0);

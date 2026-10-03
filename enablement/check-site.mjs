#!/usr/bin/env node
// enablement/check-site.mjs
// Preflight for the internal enablement site. Run it before every deploy:
//
//   node enablement/check-site.mjs            check everything
//   node enablement/check-site.mjs --hashes   print the style-src value for enablement/site/_headers
//
// No dependencies, changes nothing, deploys nothing. It proves from the files alone what the site
// promises:
//   - every page and file the site needs is there, no retired page is, and the served folder holds
//     nothing else;
//   - the policy in site/_headers is exactly the page policy: styles and scripts from this site only
//     ('self'), images only as data: URIs, and a hash only for an inline style still in use;
//   - a page loads nothing but /site.css, /site.js and its own stylesheet and script, and links out only
//     to the site itself and the demo workers; no stylesheet or script the site serves loads or stores
//     anything;
//   - the package name is written once on every page, inside its h1, the same string everywhere;
//   - what a reader sees holds no build-state word and no customer or competitor name (LANE-BRIEF-V2);
//   - wrangler.enablement.toml names the gate (enablement/worker.mjs) in front of every request, with
//     the ASSETS binding and no variable or credential, and nothing served or configured holds one;
//   - the gate holds no secret and its unit tests pass;
//   - every page says what its source says (node enablement/render-check.mjs, lane P1's text check).
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const siteDir = join(root, 'enablement', 'site');
const figuresDir = join(siteDir, 'figures');
const sourceFiguresDir = join(root, 'docs', 'enablement', 'figures');
const configPath = join(root, 'wrangler.enablement.toml');
const workerPath = join(root, 'enablement', 'worker.mjs');
const workerTestPath = join(root, 'enablement', 'worker.test.mjs');
const renderCheckPath = join(root, 'enablement', 'render-check.mjs');
const renderPagesPath = join(root, 'enablement', 'render-pages.mjs');

// The pages the site must have, beside E0's 404.html. Each <name>.html is served at /<name> (index at /).
const PAGES = ['index', 'what-it-is', 'selling-it', 'how-it-works', 'credits', 'glossary', 'demos', 'see-it-work', 'how-it-works-interactive'];
// The interactive pages' own stylesheets and scripts (lanes M1 and H1, LANE-BRIEF-V2 §5).
const OWN_FILES = ['see-it-work.css', 'see-it-work.js', 'how-it-works-interactive.css', 'how-it-works-interactive.js'];
// Pages LANE-BRIEF-V2 retired: refused if they are still in the served folder.
const RETIRED = ['status.html'];
// The shared script and stylesheet, written exactly so. A page may also load its own, /<name>.js and
// /<name>.css, in the same form, and nothing else.
const SCRIPT_TAG = '<script src="/site.js" defer></script>';
const STYLESHEET_TAG = '<link rel="stylesheet" href="/site.css">';
const ownScriptTag = (name) => `<script src="/${name}.js" defer></script>`;
const ownStylesheetTag = (name) => `<link rel="stylesheet" href="/${name}.css">`;
// The only addresses an <a href> may name besides the site's own paths: the site and the demo workers.
const LINK_HOSTS = new Set([
  'edge-platform-bti.expedge.workers.dev',
  'edge-platform.expedge.workers.dev',
  'edge-platform-top-offers.expedge.workers.dev',
  'edge-platform-vantage.expedge.workers.dev',
  'edge-platform-oh.expedge.workers.dev',
]);
// The page policy, exactly. Only style-src may add a hash, and only for an inline style still in use.
const POLICY = {
  'default-src': ["'none'"],
  'style-src': ["'self'"],
  'script-src': ["'self'"],
  'img-src': ['data:'],
  'base-uri': ["'none'"],
  'form-action': ["'none'"],
  'frame-ancestors': ["'none'"],
};
const POLICY_TEXT = Object.entries(POLICY).map(([k, v]) => `${k} ${v.join(' ')}`).join('; ');

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
  console.log(`style-src ${["'self'", ...hashesInUse].join(' ')}`);
  process.exit(0);
}

const problems = [];
const check = (cond, what) => { console.log(`${cond ? 'ok   ' : 'FAIL '} ${what}`); if (!cond) problems.push(what); };

// 1. The files that must exist, no retired page, and nothing else in the served folder.
for (const f of [...PAGES.map((p) => `${p}.html`), '404.html', '_headers', 'site.css', 'site.js', ...OWN_FILES]) check(existsSync(join(siteDir, f)), `enablement/site/${f} exists`);
for (const f of RETIRED) check(!existsSync(join(siteDir, f)), `enablement/site/${f} is not served (retired by LANE-BRIEF-V2)`);
const figureFiles = existsSync(figuresDir) ? readdirSync(figuresDir).filter((n) => n.toLowerCase().endsWith('.svg')).sort() : [];
const staleFigures = figureFiles.filter((n) => existsSync(join(sourceFiguresDir, n)) && read(join(sourceFiguresDir, n)) !== read(join(figuresDir, n)));
check(figureFiles.length > 0 && staleFigures.length === 0,
  `enablement/site/figures/ holds the figures, each the same as its source in docs/enablement/figures/ (${figureFiles.join(', ') || 'none'}${staleFigures.length ? `; differs: ${staleFigures.join(', ')}` : ''})`);
for (const f of [renderCheckPath, renderPagesPath]) check(existsSync(f), `${rel(f)} exists`);
const servedNames = files.map((f) => relative(siteDir, f).split(sep).join('/'));
const pageNames = new Set(servedNames.filter((f) => /^[a-z0-9-]+\.html$/.test(f)).map((f) => f.slice(0, -'.html'.length)));
// A stylesheet or script is either the shared one (site) or a page's own (<name>.css, <name>.js beside <name>.html).
const sharedOrOwn = (f) => { const m = /^([a-z0-9-]+)\.(?:css|js)$/.exec(f); return Boolean(m) && (m[1] === 'site' || pageNames.has(m[1])); };
const strays = servedNames.filter((f) => !/^(?:[a-z0-9-]+\.html|_headers|figures\/[a-z0-9-]+\.svg)$/.test(f) && !sharedOrOwn(f));
check(strays.length === 0, `enablement/site/ holds only pages, site.css, site.js, a page's own .css and .js, figures/*.svg and _headers${strays.length ? ` (also: ${strays.join(', ')})` : ''}`);

// 2. The policy in _headers: one rule for every address, and exactly the page policy.
const headersFile = join(siteDir, '_headers');
const headersText = existsSync(headersFile) ? read(headersFile) : '';
const headerValue = (name) => {
  const line = headersText.split('\n').map((l) => l.trim()).find((l) => l.toLowerCase().startsWith(`${name.toLowerCase()}:`));
  return line ? line.slice(name.length + 1).trim() : '';
};
const ruleLines = headersText.split('\n').filter((l) => l.trim() && !l.trim().startsWith('#'));
const rulePaths = ruleLines.filter((l) => !/^\s/.test(l)).map((l) => l.trim());
const headerNames = ruleLines.filter((l) => /^\s/.test(l)).map((l) => l.trim().split(':')[0].trim().toLowerCase());
check(rulePaths.length === 1 && rulePaths[0] === '/*' && !headerNames.some((n) => n.startsWith('!')) && new Set(headerNames).size === headerNames.length,
  '_headers: one rule, /*, for every address, naming each header once and removing none');
const directives = {};
const repeated = [];
for (const d of headerValue('Content-Security-Policy').split(';').map((x) => x.trim()).filter(Boolean)) {
  const [k, ...v] = d.split(/\s+/);
  if (k.toLowerCase() in directives) repeated.push(k);
  directives[k.toLowerCase()] = v;
}
const none = (d) => JSON.stringify(directives[d]) === JSON.stringify(["'none'"]);
check(none('default-src'), "CSP: default-src is 'none'");
for (const d of ['base-uri', 'form-action', 'frame-ancestors']) check(none(d), `CSP: ${d} is 'none'`);
// Every source must be 'self', 'none', data: or a style hash: that refuses unsafe-inline, unsafe-eval,
// wildcards, nonces, blob: and every host or scheme source alike.
const strangeSources = Object.values(directives).flat().filter((t) => !/^('self'|'none'|'sha256-[A-Za-z0-9+/]{43}='|data:)$/.test(t));
check(Object.keys(directives).length > 0 && strangeSources.length === 0,
  `CSP: no unsafe-inline, unsafe-eval, wildcard or remote source${strangeSources.length ? ` (found ${strangeSources[0]})` : ''}`);
const allowedHashes = (directives['style-src'] || []).filter((t) => t.startsWith("'sha256-"));
const withoutHashes = Object.fromEntries(Object.entries(directives).map(([k, v]) => [k, k === 'style-src' ? v.filter((t) => !t.startsWith("'sha256-")) : v]));
const samePolicy = repeated.length === 0 && Object.keys(withoutHashes).length === Object.keys(POLICY).length
  && Object.entries(POLICY).every(([k, v]) => JSON.stringify(withoutHashes[k]) === JSON.stringify(v));
check(samePolicy, `CSP: the policy is ${POLICY_TEXT}, each directive once (a hash may stand beside 'self' in style-src)`);
for (const p of pages) for (const css of inlineStyles(p.html)) check(allowedHashes.includes(sha(css)), `CSP allows the inline style of ${p.file} (${sha(css)})`);
check(allowedHashes.every((h) => hashesInUse.includes(h)), 'CSP lists no hash that no page uses');
check(/nosniff/i.test(headerValue('X-Content-Type-Options')), 'header: X-Content-Type-Options nosniff');
check(/^DENY$/i.test(headerValue('X-Frame-Options')), 'header: X-Frame-Options DENY');
check(/no-referrer/i.test(headerValue('Referrer-Policy')), 'header: Referrer-Policy no-referrer');
check(/no-store/i.test(headerValue('Cache-Control')) && /private/i.test(headerValue('Cache-Control')), 'header: Cache-Control private, no-store');
check(/max-age=\d{7,}/.test(headerValue('Strict-Transport-Security')), 'header: Strict-Transport-Security with a long max-age');
check(/noindex/i.test(headerValue('X-Robots-Tag')), 'header: X-Robots-Tag noindex');

// 3. A page runs no script but /site.js and its own /<name>.js, loads no stylesheet but /site.css and its
//    own /<name>.css, loads nothing from another address, and its links leave only for the site itself and
//    the demo workers. No stylesheet or script the site serves loads or stores anything.
const BANNED_TAG = /<(script|form|input|select|textarea|iframe|frame|object|embed|applet|base)\b/i;
const SCHEME = /^\s*([a-z][a-z0-9+.-]*:|\/\/)/i;
const ICON_TAG = /^<link rel="icon" href="data:image\/[^"]*">$/i;
const ADDRESS_ATTR = /\s(href|xlink:href|src|srcset|action|formaction|poster|data|cite|background|ping)\s*=\s*("([^"]*)"|'([^']*)')/gi;
// An attribute's address as the browser reads it: character references decoded, tabs and newlines dropped.
const asRead = (v) => v
  .replace(/&#x([0-9a-f]+);?/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);?/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&(colon|sol|bsol|tab|newline|period);/gi, (_, n) => ({ colon: ':', sol: '/', bsol: '\\', tab: '\t', newline: '\n', period: '.' })[n.toLowerCase()])
  .replace(/[\t\n\r]/g, '')
  .trim();
// A path on this site or a fragment: no scheme, no "//" host, no backslash (browsers read "/\x" as "//x").
const onSite = (v) => !SCHEME.test(asRead(v)) && !asRead(v).includes('\\');
const toDemoOrSite = (v) => {
  try {
    const u = new URL(asRead(v));
    return u.protocol === 'https:' && LINK_HOSTS.has(u.hostname) && !u.username && !u.password && !u.port;
  } catch {
    return false;
  }
};
const cssLoads = (css) => [...css.matchAll(/url\(\s*["']?([^)"']*)/gi)].map((m) => m[1].trim()).filter((u) => !/^(data:|#)/i.test(u));
const cssLoadsSomething = (css) => cssLoads(css).length > 0 || /@import|@font-face/i.test(css);
for (const p of pages) {
  const html = noComments(p.html);
  const name = p.file.split('/').pop().replace(/\.html$/, '');
  const allowedScripts = [SCRIPT_TAG, ownScriptTag(name)];
  const allowedStylesheets = [STYLESHEET_TAG, ownStylesheetTag(name)];
  const repeatedScript = allowedScripts.some((t) => html.split(t).length - 1 > 1);
  const rest = allowedScripts.reduce((text, t) => text.split(t).join(''), html);
  check(!repeatedScript && !BANNED_TAG.test(rest),
    `${p.file}: no script but /site.js and /${name}.js (each at most once, as <script src="..." defer></script>), and no form, input, iframe, object, embed or base element`);
  check(!/\son[a-z]+\s*=|\sstyle\s*=|javascript:|http-equiv\s*=/i.test(html), `${p.file}: no event handler, style attribute, javascript: URL or http-equiv`);
  const linkTags = [...html.matchAll(/<link\b[^>]*>/gi)].map((m) => m[0]);
  const badLinks = linkTags.filter((t) => !allowedStylesheets.includes(t) && !ICON_TAG.test(t));
  const repeatedStylesheet = allowedStylesheets.some((t) => linkTags.filter((x) => x === t).length > 1);
  check(badLinks.length === 0 && !repeatedStylesheet, `${p.file}: the only link elements are the inline icon, /site.css and /${name}.css (each at most once)`);
  const absent = [...allowedScripts, ...allowedStylesheets].filter((t) => html.includes(t)).map((t) => t.match(/"\/([^"]+)"/)[1]).filter((f) => !existsSync(join(siteDir, f)));
  check(absent.length === 0, `${p.file}: every stylesheet and script it loads is served${absent.length ? ` (missing ${absent.join(', ')})` : ''}`);
  const loadsOut = [];
  const linksOut = [];
  for (const m of html.matchAll(/<([a-zA-Z][\w:-]*)\b([^>]*)>/g)) {
    const tag = m[1].toLowerCase();
    for (const a of m[2].matchAll(ADDRESS_ATTR)) {
      const name = a[1].toLowerCase();
      const v = a[3] ?? a[4];
      if ((tag === 'a' || tag === 'area') && name === 'href') {
        if (!onSite(v) && !toDemoOrSite(v)) linksOut.push(v);
      } else if (!(tag === 'link' && name === 'href' && /^data:image\//i.test(v)) && !onSite(v)) {
        loadsOut.push(v);
      }
    }
    for (const u of cssLoads(asRead(m[2]))) loadsOut.push(`url(${u})`);
  }
  check(loadsOut.length === 0 && !inlineStyles(p.html).some(cssLoadsSomething),
    `${p.file}: nothing is loaded from another address${loadsOut.length ? ` (found ${loadsOut[0]})` : ''}`);
  check(linksOut.length === 0, `${p.file}: links leave only for the site itself and the demo workers (edge-platform, -top-offers, -vantage, -oh)${linksOut.length ? ` (found ${linksOut[0]})` : ''}`);
}
const servedStylesheets = files.filter((f) => extname(f).toLowerCase() === '.css');
const servedScripts = files.filter((f) => extname(f).toLowerCase() === '.js');
for (const f of servedStylesheets) check(!cssLoadsSomething(read(f)), `${rel(f)} loads nothing: no url() but data:, no @import, no @font-face`);
const SCRIPT_API = [
  [/\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon|importScripts|\bimport\s*\(/, 'a network call'],
  [/localStorage|sessionStorage|indexedDB|cookieStore|document\.cookie|\bcaches\./, 'storage'],
  [/\beval\s*\(|\bFunction\s*\(|set(?:Timeout|Interval)\s*\(\s*['"`]/, 'code built from a string'],
  [/innerHTML|outerHTML|insertAdjacentHTML|document\.write/, 'HTML written from a string'],
];
for (const f of servedScripts) {
  const scriptHits = SCRIPT_API.filter(([re]) => re.test(read(f))).map(([, what]) => what);
  check(scriptHits.length === 0, `${rel(f)} makes no network call, uses no storage, builds no code or HTML from a string${scriptHits.length ? ` (found ${scriptHits.join(', ')})` : ''}`);
}

// 4. The package name: once on every page, inside its h1, the same string everywhere, nowhere else.
const NAME_ELEMENT = /<(\w+)\b[^>]*\bid="package-name"[^>]*>([\s\S]*?)<\/\1>/;
const index = pages.find((p) => p.file.endsWith('/index.html'));
const packageName = index ? ((noComments(index.html).match(NAME_ELEMENT) || [])[2] || '').trim() : '';
check(Boolean(packageName), 'index.html names the package in an element with id="package-name"');
const contentPages = pages.filter((p) => !p.file.endsWith('/404.html'));
for (const p of contentPages) {
  const html = noComments(p.html);
  const ids = (html.match(/\bid="package-name"/g) || []).length;
  const h1 = (html.match(/<h1\b[^>]*>[\s\S]*?<\/h1>/i) || [''])[0];
  const inH1 = ((h1.match(NAME_ELEMENT) || [])[2] || '').trim();
  const times = packageName ? html.split(packageName).length - 1 : 0;
  check(ids === 1 && inH1 === packageName && times === 1,
    `${p.file}: the package name once, in the h1's element with id="package-name", the same as index.html's (ids ${ids}, in the h1 ${inH1 === packageName ? 'yes' : 'no'}, written ${times} time${times === 1 ? '' : 's'})`);
}
const otherServed = files.filter((f) => !contentPages.some((p) => p.file === rel(f)) && (TEXT.has(extname(f).toLowerCase()) || f.endsWith('_headers')));
const nameElsewhere = packageName ? otherServed.filter((f) => noComments(read(f)).includes(packageName)).map(rel) : [];
check(nameElsewhere.length === 0, `the package name is in no other served file (404.html, site.css, site.js, the figures, _headers)${nameElsewhere.length ? ` (found in ${nameElsewhere.join(', ')})` : ''}`);

// 4b. What a reader sees (LANE-BRIEF-V2 §1 and §4): no build-state word and no customer or competitor name.
//     Scanned: each served page's visible text (comments, scripts and styles removed; alt, title, aria-label
//     and placeholder text kept), each figure's text, the strings a script can put on a page (comments
//     removed), and CSS content strings. "journey stage" is allowed, and so is a configuration path such as
//     pages.home[0].stage, which is code, not a stage. A script string that is one token with code
//     punctuation (a class name such as sw-stage, a selector, a path, a key) is code and is skipped.
const ENTITY = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = (s) => s.replace(/&(?:#x([0-9a-f]+)|#(\d+)|([a-z]+));/gi, (all, h, d, n) => (h ? String.fromCodePoint(parseInt(h, 16)) : d ? String.fromCodePoint(Number(d)) : ENTITY[n.toLowerCase()] ?? all));
const READER_ATTRS = /\s(?:alt|title|aria-label|aria-description|aria-roledescription|aria-valuetext|placeholder)\s*=\s*("([^"]*)"|'([^']*)')/gi;
const seenText = (markup) => {
  const bare = noComments(markup).replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, ' ');
  const spoken = [...bare.matchAll(READER_ATTRS)].map((m) => m[2] ?? m[3]);
  return decode(`${bare.replace(/<[^>]*>/g, ' ')} ${spoken.join(' ')}`).replace(/\s+/g, ' ');
};
const CODE_TOKEN = /^[\w$]*[-.#[\]/:][\w$.#[\]/:-]*$/;
const scriptStrings = (js) => {
  const code = js.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:\\'"`])\/\/[^\n]*/g, '$1');
  return [...code.matchAll(/'((?:\\.|[^'\\\n])*)'|"((?:\\.|[^"\\\n])*)"|`((?:\\.|[^`\\])*)`/g)]
    .map((m) => m[1] ?? m[2] ?? (m[3] || '').replace(/\$\{[^}]*\}/g, ' '))
    .filter((s) => !CODE_TOKEN.test(s.trim()))
    .join(' \n ');
};
const cssContent = (css) => [...css.replace(/\/\*[\s\S]*?\*\//g, ' ').matchAll(/content\s*:\s*("([^"]*)"|'([^']*)')/gi)].map((m) => m[2] ?? m[3]).join(' ');
const NEVER_SEEN = [
  [/\bdesigned\b/gi, '"designed"'],
  [/\b(?<!journey[\s-])(?<!\.)stages?\b/gi, '"stage"'],
  [/\bgeneration\s+[12]\b/gi, '"Generation 1" or "Generation 2"'],
  [/\bdemo[\s-]+only\b/gi, '"demo only"'],
  [/\btoday\b/gi, '"today"'],
  [/\bnot\s+yet\b/gi, '"not yet"'],
  [/\b(?:tapestry|verizon|coach|qvc|mandeep|dynamic\s+yield)\b/gi, 'a customer or competitor name'],
];
const neverSeen = (text) => NEVER_SEEN.flatMap(([re, what]) => [...text.matchAll(re)].map((m) => `${what} in "${text.slice(Math.max(0, m.index - 30), m.index + m[0].length + 30).trim()}"`));
const SEEN_RULE = 'no "designed", "stage", "Generation 1/2", "demo only", "today", "not yet", customer or competitor name';
for (const p of pages) {
  const hits = neverSeen(seenText(p.html));
  check(hits.length === 0, `${p.file}: what a reader sees has ${SEEN_RULE}${hits.length ? ` (${hits.length} found; first: ${hits.slice(0, 2).join('; ')})` : ''}`);
}
const shownElsewhere = [
  ...files.filter((f) => extname(f).toLowerCase() === '.svg').map((f) => [f, seenText(read(f))]),
  ...servedScripts.map((f) => [f, scriptStrings(read(f))]),
  ...servedStylesheets.map((f) => [f, cssContent(read(f))]),
];
for (const [f, text] of shownElsewhere) {
  const hits = neverSeen(text);
  check(hits.length === 0, `${rel(f)}: what it can show has ${SEEN_RULE}${hits.length ? ` (${hits.length} found; first: ${hits.slice(0, 2).join('; ')})` : ''}`);
}

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

// 8. The text check: every page says what its source says (lane P1's enablement/render-check.mjs).
const textCheck = existsSync(renderCheckPath) ? spawnSync(process.execPath, [renderCheckPath], { cwd: root, encoding: 'utf8', timeout: 120000 }) : null;
const textLines = (textCheck?.stdout || '').split('\n').map((l) => l.trim()).filter(Boolean);
// The verdict is the exit code. The summary line is quoted when it arrived: render-check ends with
// process.exit(), which can cut its output short on a pipe, so its full list is read by running it directly.
const textSummary = textLines.find((l) => /^\d+ problem\(s\)|All checks passed/.test(l))
  || (textCheck ? `exit ${textCheck.status}; its output was cut short, so run node enablement/render-check.mjs for the full list` : 'the file is missing');
check(textCheck?.status === 0, `node enablement/render-check.mjs passes (${textSummary.replace(/:$/, '')})`);
if (textCheck && textCheck.status !== 0) console.log(textLines.filter((l) => l.startsWith('FAIL')).slice(0, 24).map((l) => `      render-check: ${l}`).join('\n') || textCheck.stderr || String(textCheck.error));

console.log(problems.length ? `\n${problems.length} problem(s). Do not deploy.` : '\nAll checks passed.');
process.exit(problems.length ? 1 : 0);

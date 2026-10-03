#!/usr/bin/env node
// enablement/render-check.mjs
// The text check for the enablement site: proves that each page says what its sources say, and nothing else.
//
//   node enablement/render-check.mjs              check every page
//   node enablement/render-check.mjs --verbose    also list every marked addition, element by element
//   node enablement/render-check.mjs --site DIR   check a dry run (render-pages.mjs --out DIR) instead of enablement/site
//
// Each piece page wraps its text in <article data-source="...">, naming one or more sources. For each source the
// check extracts the article's text (tags, scripts, styles and inline SVG removed, entities decoded, quotes
// normalized, whitespace collapsed) and the source's text (markdown syntax, link targets and table pipes removed),
// splits both into sentences, and compares them in both directions:
//   forward  every sentence of the source is on the page, anywhere in its article;
//   reverse  every sentence of the page is in the source, except what the page marks as an addition: an element
//            with data-chrome (the rule's label, a scroll hint, the glossary's letters), data-lead (a
//            lead line above an interactive element) or data-added (an addition a ruling made, with its reason).
// Marked additions are listed, never compared. A source is read by its kind:
//   a markdown file             the whole file
//   an HTML source              its visible text, plus the rows its own script draws, which it holds as JSON in
//                               <script type="application/json" id="tl-data"> (read with JSON.parse, never run)
//   a design document section   (path#anchor) the section's verbatim items must be on the page, and every page
//                               sentence must come from the section, compared without regard to case
//   the landing page            each card's rule must equal its piece's rule, and every element marked
//                               data-quote-of must say only what its named source says
//
// It also checks the chrome (the package name, the stamp, the footer line, the skip link), that no page shows a
// label, a chip or a legend and no inlined figure shows a label (LANE-BRIEF-V2), every inline figure against its
// file and every caption against its figure's title. It scans every page, and the sources lane P1 writes, for
// gendered pronouns, customer names, timing figures beyond V2's one fixed performance sentence, state words (V2 §1:
// no build state, stage, "designed", "not yet", "open" or label) and the abbreviation kept out of visible text.
// It exits non-zero on any failure. No dependencies; it reads files and changes nothing.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// --site DIR checks a dry run of render-pages.mjs (its --out folder) instead of the served folder.
const siteAt = process.argv.indexOf('--site');
const siteDir = siteAt > 0 && process.argv[siteAt + 1] ? resolve(process.argv[siteAt + 1]) : join(root, 'enablement', 'site');
const verbose = process.argv.includes('--verbose');
const read = (p) => readFileSync(p, 'utf8').replace(/\r\n?/g, '\n');
const NAME = 'Behavioral Targeting and Intelligence';
const STAMP = 'Updated October 2, 2026';
const FOOTLINE = 'Internal · Optimizely · do not forward outside Optimizely';
// Pages that are not pieces: their chrome is checked and they are scanned; their text is not compared.
const NOT_PIECES = new Map([['404.html', 'the not-found page']]);
// Words a design section quotes as instructions, not as text for the page.
const SPEC_QUOTES_NOT_TEXT = new Set(['the page rearranges itself', 'Addition, as built']);
// Where a ruling changed a section's words after the section was written: applied to the section before comparing,
// and listed in the notes, so the section and the page stay comparable until the design catches up.
const SPEC_RULED = [
  { from: 'which demo to show, and to whom', to: 'which demo to show to whom', why: "the coordinator's ruling of 2026-10-02 titles the demo map \"Which demo to show to whom\"" },
  // Written as a pattern, so the check itself names no one.
  { from: /ask the demos' owner \([^)]*\)/g, to: 'ask the demo owner', why: "the coordinator's ruling of 2026-10-02: the package names no real person, so the demo owner is named by role only" },
];
// Figures a ruling places on a page beyond what its markdown names; a page without one fails.
const RULED_FIGURES = new Map([
  ['what-it-is.html', ['before-during-after']],
  ['credits.html', ['before-during-after']],
]);
// The two interactive pages, built by other lanes. Until their notes say what this check compares, such a page that
// is present without an <article data-source> fails, naming the lane it waits for.
const PENDING_PAGES = new Map([['see-it-work.html', 'lane M1'], ['how-it-works-interactive.html', 'lane H1']]);
// LANE-BRIEF-V2 §3: the one performance sentence the material may carry; any other timing figure fails the scan.
const FIXED_PERFORMANCE = 'We aim to make each decision within about 200 milliseconds at the edge; on average we see 50 to 250 milliseconds, and tens of milliseconds once the engine has seen the visitor.';
// LANE-BRIEF-V2 §1: no build state, build plan, remediation, stage, rollout order, "designed", "not yet", "today
// versus later" or "open", and no label, anywhere on the site. Phrases, so that ordinary words ("open it from where
// you are", "it opens with the passphrase", "journey stage") pass.
const STATE_WORDS = [
  /\bBuilt\b/, /\b[Dd]esigned\b/, /\bOpen\b(?=[.:])/, /\b(?:is|are|remains?|still|stays?|left) open\b/i, /\bopen (?:decision|item|question|point)s?\b/i,
  /\bnot yet\b/i, /\bdemo only\b/i, /\bnot (?:wired|built|connected)\b/i, /\btoday's engine\b/i, /\bengine today\b/i,
  /\b(?:older|newer) (?:pipeline|build)\b/i, /\bolder demo pipeline\b/i, /\bGeneration [12]\b/i, /\bdemo seams?\b/i,
  /\bbuild items?\b/i, /\broadmap\b/i, /\bremediation\b/i, /\brollout\b/i, /\bstage [1-4]\b/i, /\(stage\b/i, /\bphase [0-9]\b/i,
];
// The sources lane P1 writes, scanned with the pages.
const OWN_SOURCES = ['docs/enablement/content/credits-source.html', 'docs/enablement/content/credits.md', 'docs/enablement/content/demos.md'];

// ---------- HTML: a small tokenizer and tree, enough for these pages ----------
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', middot: '·', mdash: '—', ndash: '–', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', hellip: '…', rarr: '→', larr: '←', uarr: '↑', darr: '↓', times: '×', minus: '−', bull: '•',
  // Greek letters and mathematical signs, for the formulas on the interactive pages; looked up case-sensitively first
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', theta: 'θ', kappa: 'κ', lambda: 'λ', mu: 'μ', pi: 'π', rho: 'ρ', sigma: 'σ', tau: 'τ', phi: 'φ', omega: 'ω',
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Pi: 'Π', Sigma: 'Σ', Phi: 'Φ', Omega: 'Ω',
  le: '≤', ge: '≥', ne: '≠', asymp: '≈', sum: '∑', infin: '∞', sdot: '⋅', plusmn: '±', divide: '÷', deg: '°', prime: '′',
  frac12: '½', frac14: '¼', frac34: '¾', sup2: '²', sup3: '³', atilde: 'ã', harr: '↔', rArr: '⇒', hArr: '⇔',
  laquo: '«', raquo: '»', sect: '§', copy: '©', thinsp: ' ', ensp: ' ', emsp: ' ' };
const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (m, e) => {
  if (e[0] === '#') return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
  return ENT[e] ?? ENT[e.toLowerCase()] ?? m;
});
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
function parseHtml(html) {
  const top = { tag: '#root', attrs: {}, children: [] };
  const stack = [top];
  const re = /<!--[\s\S]*?-->|<![^>]*>|<\/([a-zA-Z][\w:-]*)\s*>|<([a-zA-Z][\w:-]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*(\/?)>|([^<]+)|(<)/g;
  let m;
  while ((m = re.exec(html))) {
    const cur = stack[stack.length - 1];
    if (m[0].startsWith('<!')) { if (m[0].startsWith('<!--')) cur.children.push({ comment: m[0] }); continue; }
    if (m[1]) {
      const tag = m[1].toLowerCase();
      for (let i = stack.length - 1; i > 0; i--) if (stack[i].tag === tag) { stack.length = i; break; }
      continue;
    }
    if (m[2]) {
      const tag = m[2].toLowerCase();
      const attrs = {};
      for (const a of m[3].matchAll(/([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) attrs[a[1].toLowerCase()] = decode(a[2] ?? a[3] ?? a[4] ?? '');
      const el = { tag, attrs, children: [] };
      cur.children.push(el);
      if (VOID.has(tag) || m[4]) continue;
      stack.push(el);
      if (tag === 'script' || tag === 'style') {
        const end = html.toLowerCase().indexOf(`</${tag}`, re.lastIndex);
        el.children.push({ text: html.slice(re.lastIndex, end < 0 ? html.length : end) });
        re.lastIndex = end < 0 ? html.length : end;
      }
      continue;
    }
    cur.children.push({ text: decode(m[5] ?? m[6]) });
  }
  return top;
}
const find = (node, pred, out = []) => { if (node.tag && pred(node)) out.push(node); for (const c of node.children || []) find(c, pred, out); return out; };
const textOf = (node) => (node.text !== undefined ? node.text : node.tag === 'br' ? ' ' : (node.children || []).map(textOf).join(''));

// ---------- text ----------
const norm = (s) => s.normalize('NFC').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
const sentences = (block) => block.split(/(?<=[.!?]['")\]]*)\s+/).map((s) => s.trim()).filter((s) => /[\p{L}\p{N}]/u.test(s));
const BLOCK = new Set(['address', 'article', 'aside', 'blockquote', 'body', 'button', 'caption', 'dd', 'details', 'div', 'dl', 'dt', 'figcaption', 'figure', 'footer', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'li', 'main', 'nav', 'ol', 'p', 'pre', 'section', 'summary', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'ul']);
const SKIP = new Set(['script', 'style', 'svg', 'template', 'head', 'title', 'noscript']);
const ALLOW_ATTRS = ['data-chrome', 'data-lead', 'data-added'];
// Text blocks of a subtree. With onAllowed, elements carrying an addition attribute are handed to it and left out.
function blocksOf(node, onAllowed = null) {
  const out = [];
  let cur = '';
  const flush = () => { const t = norm(cur); if (t) out.push(t); cur = ''; };
  (function walk(n) {
    if (n.comment !== undefined) return;
    if (n.text !== undefined) { cur += n.text; return; }
    if (SKIP.has(n.tag)) return;
    if (n.tag === 'br') { cur += ' '; return; }
    if (onAllowed) {
      const a = ALLOW_ATTRS.find((k) => k in n.attrs);
      if (a) { onAllowed(a, n); if (BLOCK.has(n.tag)) flush(); return; }
    }
    if (n.tag === 'pre') { flush(); for (const line of textOf(n).split('\n')) { cur = line; flush(); } return; }
    const block = BLOCK.has(n.tag);
    if (block) flush();
    n.children.forEach(walk);
    if (block) flush();
  })(node);
  flush();
  return out;
}

// ---------- markdown: this check's own reading of a source ----------
const mdInline = (s) => norm(s
  .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
  .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
  .replace(/`([^`]*)`/g, '$1')
  .replace(/\*\*([^*]+)\*\*/g, '$1')
  .replace(/\*([^*]+)\*/g, '$1')
  .replace(/\\([\\`*_{}[\]()#+\-.!|])/g, '$1'));
const svgTitle = (svg) => norm(decode((/<title\b[^>]*>([\s\S]*?)<\/title>/.exec(svg) || [, ''])[1]));
function mdBlocks(md, notes, label) {
  const out = [];
  let para = [];
  let fence = false;
  const flush = () => { if (para.length) { const t = mdInline(para.join(' ')); if (t) out.push(t); para = []; } };
  for (const line of md.split('\n')) {
    let m;
    if (/^```/.test(line)) { flush(); fence = !fence; continue; }
    if (fence) { const t = norm(line); if (t) out.push(t); continue; }
    if (!line.trim()) { flush(); continue; }
    if ((m = /^#{1,6}\s+(.*)$/.exec(line))) { flush(); out.push(mdInline(m[1])); continue; }
    if (/^-{3,}\s*$/.test(line)) { flush(); continue; }
    if ((m = /^!\[([^\]]*)\]\(([^)]+)\)\s*$/.exec(line))) {
      flush();
      const name = m[2].split('/').pop().replace(/\.(png|svg)$/, '');
      const svg = join(root, 'docs', 'enablement', 'figures', `${name}.svg`);
      const title = existsSync(svg) ? svgTitle(read(svg)) : null;
      if (title && norm(title) !== mdInline(m[1])) notes.push(`${label}: the source's caption "${m[1]}" differs from the figure's title "${title}"; the page shows the title, by the coordinator's ruling`);
      out.push(norm(title || m[1]));
      continue;
    }
    if (/^\|/.test(line)) {
      flush();
      if (/^\|[\s:|-]+\|?\s*$/.test(line)) continue;
      for (const c of line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|')) { const t = mdInline(c); if (t) out.push(t); }
      continue;
    }
    if ((m = /^>\s?(.*)$/.exec(line))) { para.push(m[1]); continue; }
    if ((m = /^\s*(?:[-*]|\d+\.)\s+(.*)$/.exec(line))) { flush(); para.push(m[1]); continue; }
    para.push(line.trim());
  }
  flush();
  return out;
}
// The rule of a markdown piece: its first paragraph or quote that is bold from end to end.
function mdRule(md) {
  for (const line of md.split('\n')) { const m = /^(?:>\s*)?\*\*([^*]+)\*\*\s*$/.exec(line); if (m) return norm(m[1]); }
  return null;
}

// ---------- comparison ----------
// Blocks are joined with spaces, so a sentence a page splits across elements, or a source across table cells, is
// still found when its words come in the same order.
function compare(srcBlocks, pageAll, pageOwn, { loose = false } = {}) {
  const key = (s) => (loose ? s.toLowerCase().replace(/[.;:,]+$/, '') : s);
  const hay = (blocks) => ` ${blocks.map((b) => (loose ? b.toLowerCase() : b)).join(' ')} `;
  const srcHay = hay(srcBlocks);
  const pageHay = hay(pageAll);
  const missing = [];
  const extra = [];
  let srcCount = 0;
  let pageCount = 0;
  for (const b of srcBlocks) for (const s of sentences(b)) { srcCount++; if (!pageHay.includes(key(s))) missing.push(s); }
  for (const b of pageOwn) for (const s of sentences(b)) { pageCount++; if (!srcHay.includes(key(s))) extra.push(s); }
  return { missing, extra, srcCount, pageCount };
}

// ---------- sources of the special kinds ----------
function htmlSource(path) {
  const tree = parseHtml(read(path));
  const body = find(tree, (n) => n.tag === 'body')[0];
  const blocks = blocksOf(body);
  // The rows the source's own script draws, one part at a time: its band (pill and note), each row's name with
  // the exception badge where marked, its description and its verdict, then the takeaway. The rows are data,
  // parsed as JSON; nothing in the source is run.
  const data = find(tree, (n) => n.tag === 'script' && n.attrs.id === 'tl-data')[0];
  if (data) {
    if (data.attrs.type !== 'application/json') throw new Error(`${path}: the rows' script is not application/json`);
    const phases = JSON.parse(textOf(data));
    const htmlText = (s) => blocksOf(parseHtml(String(s))).join(' ');
    for (const key of Object.keys(phases)) {
      const p = phases[key];
      blocks.push(norm(`${htmlText(p.pill)} ${htmlText(p.note)}`));
      for (const r of p.rows) { blocks.push(norm(htmlText(r.n) + (r.warn === true ? ' exception' : ''))); blocks.push(htmlText(r.d)); blocks.push(htmlText(r.v)); }
      blocks.push(htmlText(p.take));
    }
  } else if (find(tree, (n) => n.tag === 'script' && !n.attrs.src).length) {
    throw new Error(`${path}: a script holds text, and the check does not run scripts; give its data as JSON in <script type="application/json" id="tl-data">`);
  }
  return blocks.filter(Boolean);
}
function designSection(path, anchor) {
  const lines = read(path).split('\n');
  const slug = (t) => mdInline(t).toLowerCase().replace(/[^\p{L}\p{N}_\- ]/gu, '').replace(/ /g, '-');
  const start = lines.findIndex((l) => /^#{2,4}\s/.test(l) && slug(l.replace(/^#+\s+/, '')) === anchor);
  if (start < 0) throw new Error(`${path}: no section #${anchor}`);
  const level = /^#+/.exec(lines[start])[0].length;
  let end = lines.findIndex((l, i) => i > start && new RegExp(`^#{1,${level}}\\s`).test(l));
  if (end < 0) end = lines.length;
  return lines.slice(start, end).join('\n');
}
// The items of a design section a page must carry word for word: the title, the rule, every heading in backticks,
// every quoted sentence, every table cell, and each demo's question, room and never-claims text.
function specItems(section, extra) {
  const items = [];
  const title = /\*\*Title:\*\*\s*`#\s+([^`]+)`/.exec(section);
  if (title) items.push(title[1]);
  const rule = /\*\*Rule:\*\*\s*"([^"]+)"/.exec(section);
  if (rule) items.push(rule[1]);
  for (const m of section.matchAll(/`##\s+([^`]+)`/g)) items.push(m[1]);
  for (const m of section.matchAll(/"([^"\n]{12,}?[.?!]?)"/g)) if (!SPEC_QUOTES_NOT_TEXT.has(m[1])) items.push(m[1]);
  for (const line of section.split('\n')) {
    const parts = line.split(/(?:^|\s)(Question|Sees|Never claims)(?: \([^:]*\))?: /);
    for (let i = 1; i < parts.length; i += 2) items.push(parts[i + 1].trim().replace(/^"|"$/g, ''));
    if (/^\|/.test(line) && !/^\|[\s:|-]+\|?\s*$/.test(line) && !/\| Never say \| Say instead \|/.test(line)) for (const c of line.replace(/^\||\|$/g, '').split('|')) if (c.trim()) items.push(c);
  }
  return [...items, ...extra].map(mdInline).filter((s) => /[\p{L}\p{N}]/u.test(s));
}

// ---------- the checks ----------
const problems = [];
const notes = [];
const rows = [];
const allowedLog = [];
const fail = (what) => problems.push(what);
const design = read(join(root, 'docs', 'enablement', 'BTI-Enablement-Design.md'));
const designPara = (id) => { const m = new RegExp(`^\\| ${id} \\| (.+?) \\| `, 'm').exec(design); return m ? norm(mdInline(m[1])) : null; };

const pages = readdirSync(siteDir).filter((f) => f.endsWith('.html')).sort();
const pageText = {};
const heardText = {};
for (const file of pages) {
  const html = read(join(siteDir, file));
  const tree = parseHtml(html);
  const body = find(tree, (n) => n.tag === 'body')[0];

  // The whole page's text, for the scans: what a reader sees, what a screen reader hears (the figures' titles and
  // descriptions, labels), and the comments, which are served too.
  const all = [];
  (function walk(n) {
    if (n.comment !== undefined) { all.push(n.comment); return; }
    if (n.text !== undefined) { all.push(n.text); return; }
    if (n.tag === 'script' || n.tag === 'style') return;
    for (const k of ['aria-label', 'title', 'alt', 'data-label', 'data-added', 'data-lead', 'content']) if (n.attrs[k]) all.push(` ${n.attrs[k]} `);
    (n.children || []).forEach(walk);
  })(tree);
  pageText[file] = norm(all.join(' '));
  const visible = norm(blocksOf(body).join(' '));
  const heard = [visible];
  for (const svg of find(body, (n) => n.tag === 'svg')) heard.push(textOf(svg));
  for (const n of find(body, (x) => x.attrs && (x.attrs['aria-label'] || x.attrs.title || x.attrs.alt))) heard.push(n.attrs['aria-label'] || n.attrs.title || n.attrs.alt);
  heardText[file] = norm(heard.join(' '));

  // the chrome every page carries
  if (!visible.includes('Skip to the page')) fail(`${file}: no skip link`);
  if (!visible.includes(FOOTLINE)) fail(`${file}: no footer line "${FOOTLINE}"`);
  if (NOT_PIECES.has(file)) {
    if (visible.includes(NAME) || find(tree, (n) => n.attrs.id === 'package-name').length) fail(`${file}: names the package, which only the pages do`);
    notes.push(`${file}: ${NOT_PIECES.get(file)}; its chrome checked and its text scanned, not compared`);
    rows.push([file, 'not a piece', '', '-', '-', '-', '-', '-']);
    continue;
  }
  const ids = find(tree, (n) => n.attrs.id === 'package-name');
  if (ids.length !== 1 || norm(textOf(ids[0])) !== NAME || !find(tree, (n) => n.tag === 'h1').some((h) => find(h, (x) => x.attrs.id === 'package-name').length)) fail(`${file}: exactly one #package-name, inside the h1, reading "${NAME}"`);
  if (visible.split(NAME).length - 1 !== 1) fail(`${file}: the package name is written ${visible.split(NAME).length - 1} times in the visible text`);
  const stamps = find(tree, (n) => /\bstamp\b/.test(n.attrs.class || ''));
  if (stamps.length !== 1 || norm(textOf(stamps[0])) !== STAMP) fail(`${file}: the stamp must read "${STAMP}" exactly, once (found ${stamps.map((x) => `"${norm(textOf(x))}"`).join(', ') || 'none'})`);
  // No label, chip or legend anywhere (LANE-BRIEF-V2): none on the page, and none in a figure it inlines.
  const chipped = find(tree, (n) => /\b(?:chip|legend)\b/.test(n.attrs.class || '') && !/\bcr-tl-legend\b/.test(n.attrs.class || '')).length;
  if (chipped) fail(`${file}: shows ${chipped} label chips or legends; LANE-BRIEF-V2 allows none`);
  const figureLabels = find(tree, (n) => n.tag === 'text' && /^(Built|Designed|Open)$/.test(norm(textOf(n))));
  if (figureLabels.length) fail(`${file}: an inlined figure shows ${figureLabels.length} labels (Built, Designed or Open); LANE-BRIEF-V2 allows none, so the figure needs its redraw`);

  // figures
  const onPage = find(tree, (n) => n.tag === 'figure' && n.attrs['data-figure']).map((f) => f.attrs['data-figure']);
  for (const name of RULED_FIGURES.get(file) || []) {
    if (onPage.includes(name)) continue;
    // A ruled figure that still shows a label is left out until it is redrawn (LANE-BRIEF-V2); once it shows none,
    // the page must carry it again.
    const labeled = /<text\b[^>]*>\s*(?:Built|Designed|Open)\s*<\/text>/.test(read(join(root, 'docs', 'enablement', 'figures', `${name}.svg`)));
    if (labeled) notes.push(`${file}: the ${name} figure a ruling places here is left out until it is redrawn without labels`);
    else fail(`${file}: the ${name} figure a ruling places on this page is missing`);
  }
  for (const fig of find(tree, (n) => n.tag === 'figure' && n.attrs['data-figure'])) {
    const name = fig.attrs['data-figure'];
    const want = read(join(root, 'docs', 'enablement', 'figures', `${name}.svg`)).trim();
    const copyPath = join(siteDir, 'figures', `${name}.svg`);
    const copy = existsSync(copyPath) ? read(copyPath).trim() : null;
    const at = html.search(new RegExp(`<figure\\b[^>]*data-figure="${name}"`));
    const inlineSvg = at >= 0 ? (/<svg\b[\s\S]*?<\/svg>/.exec(html.slice(at)) || [''])[0].trim() : '';
    if (inlineSvg !== want) fail(`${file}: the inline ${name}.svg differs from docs/enablement/figures/${name}.svg`);
    if (copy !== want) fail(`enablement/site/figures/${name}.svg differs from docs/enablement/figures/${name}.svg`);
    const cap = find(fig, (n) => n.tag === 'figcaption')[0];
    if (!cap || norm(textOf(cap)) !== svgTitle(want)) fail(`${file}: the ${name} figure's caption is not its title "${svgTitle(want)}"`);
  }

  // the text
  const article = find(tree, (n) => n.tag === 'article' && 'data-source' in n.attrs)[0];
  if (!article) {
    const hero = find(tree, (n) => 'data-landing' in n.attrs)[0];
    if (!hero && PENDING_PAGES.has(file)) { fail(`${file}: not yet compared: waiting for ${PENDING_PAGES.get(file)}'s note on what the page holds`); rows.push([file, 'waiting', PENDING_PAGES.get(file), '-', '-', '-', '-', '-']); continue; }
    if (!hero) { fail(`${file}: no <article data-source> and not the landing page`); continue; }
    let checked = 0;
    for (const el of find(tree, (n) => 'data-rule-of' in n.attrs)) {
      checked++;
      const want = mdRule(read(join(root, el.attrs['data-rule-of'])));
      if (norm(textOf(el)) !== want) fail(`${file}: the card rule for ${el.attrs['data-rule-of']} is not that piece's rule ("${want}")`);
    }
    for (const el of find(tree, (n) => 'data-quote-of' in n.attrs)) {
      const src = el.attrs['data-quote-of'];
      if (!existsSync(join(root, src))) { fail(`${file}: its quoted source ${src} does not exist`); continue; }
      const hay = ` ${norm(mdInline(read(join(root, src))))} `;
      for (const q of sentences(norm(textOf(el)))) { checked++; if (!hay.includes(q.replace(/[.;:,]+$/, ''))) fail(`${file}: "${q}" is not in ${src}`); }
    }
    rows.push([file, 'landing', "V2's lede, the pieces' rules", String(checked), '0', '-', '-', '-']);
    continue;
  }
  const allowed = [];
  const pageOwn = blocksOf(article, (kind, n) => allowed.push({ kind, why: n.attrs[kind] || kind, text: norm(blocksOf(n).join(' ')) }));
  const pageAll = blocksOf(article);
  for (const source of article.attrs['data-source'].split(/\s+/).filter(Boolean)) {
    const [srcPath, anchor] = source.split('#');
    let mode;
    let result;
    if (!existsSync(join(root, srcPath))) { fail(`${file}: its source ${srcPath} does not exist`); continue; }
    try {
    if (anchor) {
      mode = 'spec';
      let section = designSection(join(root, srcPath), anchor);
      for (const r of SPEC_RULED) {
        if (typeof r.from === 'string' && section.includes(r.from)) { section = section.split(r.from).join(r.to); notes.push(`${file}: in ${source}, "${r.from}" is read as "${r.to}": ${r.why}`); }
        // A pattern's match is not printed: it may be the very words the ruling keeps off the pages.
        if (r.from instanceof RegExp && (r.from.lastIndex = 0, r.from.test(section))) { r.from.lastIndex = 0; section = section.replace(r.from, r.to); notes.push(`${file}: in ${source}, a ruled phrase is read as "${r.to}": ${r.why}`); }
      }
      const p10 = designPara('P10');
      const items = specItems(section, p10 ? [p10] : []);
      const pageHay = ` ${pageAll.join(' ').toLowerCase()} `;
      const missing = items.filter((s) => !pageHay.includes(s.toLowerCase().replace(/[.;:,]+$/, '')));
      const back = compare(mdBlocks(section, notes, file).concat(p10 ? [p10] : []), pageAll, pageOwn, { loose: true });
      result = { missing, extra: back.extra, srcCount: items.length, pageCount: back.pageCount };
    } else if (srcPath.endsWith('.html')) {
      mode = 'html';
      result = compare(htmlSource(join(root, srcPath)), pageAll, pageOwn);
    } else {
      mode = 'markdown';
      result = compare(mdBlocks(read(join(root, srcPath)), notes, file), pageAll, pageOwn);
    }
    } catch (e) {
      fail(`${file}: its source ${srcPath} could not be read: ${e.message.replace(`${root}`, '').replace(/^[\\/]/, '')}`);
      rows.push([file, 'unreadable', srcPath.split('/').pop(), '-', '-', '-', '-', String(allowed.length)]);
      continue;
    }
    for (const s of result.missing) fail(`${file}: a sentence of ${srcPath.split('/').pop()} is missing from the page: "${s}"`);
    for (const s of result.extra) fail(`${file}: a page sentence is not in ${srcPath.split('/').pop()} and is not marked as an addition: "${s}"`);
    rows.push([file, mode, srcPath.split('/').pop() + (anchor ? `#${anchor.split('-')[0]}` : ''), String(result.srcCount), String(result.missing.length), String(result.pageCount), String(result.extra.length), String(allowed.length)]);
  }
  const outside = blocksOf(body).length - blocksOf(article).length;
  allowedLog.push(`${file}: ${outside} chrome blocks outside the article; inside it, ${allowed.length} marked additions`);
  for (const a of allowed) allowedLog.push(`    ${a.kind}${a.why && a.why !== a.kind ? ` (${a.why})` : ''}: "${a.text.length > 140 ? `${a.text.slice(0, 137)}...` : a.text}"`);
}

// ---------- the scans ----------
const SCANS = [
  ['gendered pronouns', /\b(she|her|hers|he|him|his)\b/gi],
  ['customer names', /\b(tapestry|verizon|coach|qvc|mandeep)\b/gi],
  ['timing figures beyond the fixed performance sentence', /\b\d[\d,.]*\s*(?:ms|milliseconds?)\b/gi],
];
const scanTexts = { ...pageText };
for (const s of OWN_SOURCES) if (existsSync(join(root, s))) scanTexts[s] = norm(read(join(root, s)).replace(/<style\b[\s\S]*?<\/style>/gi, ' '));
const heardTexts = { ...heardText };
for (const s of OWN_SOURCES) if (existsSync(join(root, s))) { try { heardTexts[s] = norm(s.endsWith('.html') ? htmlSource(join(root, s)).join(' ') : mdBlocks(read(join(root, s)), [], s).join(' ')); } catch (e) { fail(`scan: ${s} could not be read: ${e.message}`); } }
const fixed = norm(FIXED_PERFORMANCE);
const scanRows = [];
for (const [label, re] of SCANS) {
  const hits = [];
  for (const [file, raw] of Object.entries(scanTexts)) {
    const text = label.startsWith('timing') ? raw.split(fixed).join(' ') : raw;
    for (const m of text.matchAll(re)) hits.push(`${file}: "${text.slice(Math.max(0, m.index - 30), m.index + m[0].length + 30)}"`);
  }
  scanRows.push(`${label}: ${hits.length}`);
  for (const h of hits) fail(`scan, ${label}: ${h}`);
}
// State words (LANE-BRIEF-V2 §1), in what a reader sees or hears on each page and in the sources lane P1 writes.
{
  const hits = [];
  for (const [file, text] of Object.entries(heardTexts)) {
    for (const re of STATE_WORDS) {
      const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
      for (const m of text.matchAll(g)) hits.push(`${file}: "${text.slice(Math.max(0, m.index - 30), m.index + m[0].length + 30)}"`);
    }
  }
  for (const src of OWN_SOURCES.filter((x) => x.endsWith('.html'))) {
    if (existsSync(join(root, src)) && /class=["'][^"']*\blbl\b/.test(read(join(root, src)))) hits.push(`${src}: a label element (class "lbl")`);
  }
  scanRows.push(`state words: ${hits.length}`);
  for (const h of hits) fail(`scan, state words: ${h}`);
}
// customer names in anything else that is served (the stylesheet, the script, the figure copies)
const served = readdirSync(siteDir, { recursive: true }).map(String).filter((f) => /\.(css|js|svg)$/.test(f));
for (const f of served) for (const m of read(join(siteDir, f)).matchAll(SCANS[1][1])) fail(`scan, customer names: enablement/site/${f}: "${m[0]}"`);
// The abbreviation the design keeps out of every piece's visible text (section 2); the site's host name carries
// it, so a link shows a page's title and never the address. Case-sensitive, visible text only.
{
  const hits = [];
  for (const file of pages) {
    const body = find(parseHtml(read(join(siteDir, file))), (n) => n.tag === 'body')[0];
    // The glossary's own entry for the deprecated word is the one place that names it, to retire it.
    if (file === 'glossary.html') for (const e of find(body, (n) => n.attrs.id === 'btie')) { e.children = []; notes.push('glossary.html: the entry #btie names the deprecated word, to retire it; left out of the abbreviation scan'); }
    const visibleText = norm(blocksOf(body).join(' '));
    for (const m of visibleText.matchAll(/\bBTIE?\b/g)) hits.push(`${file}: "${visibleText.slice(Math.max(0, m.index - 30), m.index + 34)}"`);
  }
  scanRows.push(`the abbreviation in visible text: ${hits.length}`);
  for (const h of hits) fail(`scan, the abbreviation: ${h}`);
}

// ---------- report ----------
const widths = [18, 12, 34, 9, 8, 9, 12, 9];
const line = (cells) => cells.map((c, i) => String(c).padEnd(widths[i])).join(' ');
console.log(`render-check: ${siteAt > 0 ? siteDir : 'enablement/site'} against its sources\n`);
console.log(line(['page', 'mode', 'source', 'source', 'missing', 'page', 'unexplained', 'marked']));
console.log(line(['', '', '', 'sentences', '', 'sentences', '', 'additions']));
for (const r of rows) console.log(line(r));
console.log(`\nscans of ${Object.keys(scanTexts).length} files (every page, and the sources lane P1 writes): ${scanRows.join('; ')}`);
if (verbose) { console.log('\nmarked additions, never compared:'); for (const l of allowedLog) console.log(`  ${l}`); }
else console.log(`marked additions: ${allowedLog.filter((l) => !l.startsWith('    ')).length} pages carry some (--verbose lists each)`);
if (notes.length) { console.log('\nnotes:'); for (const n of [...new Set(notes)]) console.log(`  ${n}`); }
if (problems.length) { console.log(`\n${problems.length} problem(s):`); for (const p of problems) console.log(`  FAIL ${p}`); }
else console.log('\nEvery page says what its sources say. All checks passed.');
process.exit(problems.length ? 1 : 0);

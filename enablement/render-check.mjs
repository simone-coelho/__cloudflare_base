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
//            with data-chrome (the legend, the rule's label, a scroll hint, the glossary's letters), data-lead (a
//            lead line above an interactive element) or data-added (an addition a ruling made, with its reason).
// Marked additions are listed, never compared. A source is read by its kind:
//   a markdown file             the whole file
//   an HTML source              its visible text, plus the rows its own script draws, which it holds as JSON in
//                               <script type="application/json" id="tl-data"> (read with JSON.parse, never run)
//   a design document section   (path#anchor) the section's verbatim items must be on the page, and every page
//                               sentence must come from the section, compared without regard to case
//   the landing page            each card's rule must equal its piece's rule, and paragraph C the design's
//
// It also checks the chrome (the package name, the stamp, the footer line, the skip link, the legend wherever a
// label is shown), every inline figure against its file and every caption against its figure's title, and scans
// every page, and the sources lane P1 writes, for gendered pronouns, customer names, timing figures and the
// abbreviation the design keeps out of visible text. It exits non-zero on any failure. No dependencies; it reads
// files and changes nothing.
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
const LEGEND = 'Built: in the code and exercised. Designed: in an architecture document, not in the code. Open: no decision yet.';
const STAMP = 'Updated October 2, 2026 · engine facts as of commit 8b4f74c';
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
// The sources lane P1 writes, scanned with the pages.
const OWN_SOURCES = ['docs/enablement/content/credits-source.html', 'docs/enablement/content/credits.md', 'docs/enablement/content/demos.md'];

// ---------- HTML: a small tokenizer and tree, enough for these pages ----------
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', middot: '·', mdash: '—', ndash: '–', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', hellip: '…', rarr: '→', larr: '←', uarr: '↑', darr: '↓', times: '×', minus: '−', bull: '•' };
const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
  if (e[0] === '#') return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
  return ENT[e.toLowerCase()] ?? m;
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
  if (!visible.includes(STAMP)) fail(`${file}: no version stamp "${STAMP}"`);
  // A page that shows a label anywhere, in a chip or in a figure, carries the one legend, once, verbatim.
  const legends = find(tree, (n) => n.tag === 'aside' && /\blegend\b/.test(n.attrs.class || ''));
  const svgLabels = find(tree, (n) => n.tag === 'text' && /^(Built|Designed|Open)$/.test(norm(textOf(n)))).length;
  const chips = svgLabels + find(tree, (n) => /\bchip\b/.test(n.attrs.class || '')).length - legends.reduce((k, l) => k + find(l, (n) => /\bchip\b/.test(n.attrs.class || '')).length, 0);
  if (chips > 0 && (legends.length !== 1 || norm(textOf(legends[0])) !== LEGEND)) fail(`${file}: shows ${chips} labels, so carries the legend once, verbatim (found ${legends.length})`);
  // ... and only such a page: the legend appears only where a label is shown (the coordinator's ruling).
  if (chips === 0 && legends.length) fail(`${file}: carries the legend but shows no label`);

  // figures
  const onPage = find(tree, (n) => n.tag === 'figure' && n.attrs['data-figure']).map((f) => f.attrs['data-figure']);
  for (const name of RULED_FIGURES.get(file) || []) if (!onPage.includes(name)) fail(`${file}: the ${name} figure a ruling places on this page is missing`);
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
    if (!hero) { fail(`${file}: no <article data-source> and not the landing page`); continue; }
    let checked = 0;
    for (const el of find(tree, (n) => 'data-rule-of' in n.attrs)) {
      checked++;
      const want = mdRule(read(join(root, el.attrs['data-rule-of'])));
      if (norm(textOf(el)) !== want) fail(`${file}: the card rule for ${el.attrs['data-rule-of']} is not that piece's rule ("${want}")`);
    }
    for (const el of find(tree, (n) => n.attrs['data-paragraph'] === 'C')) { checked++; if (norm(textOf(el)) !== designPara('C')) fail(`${file}: paragraph C differs from the design's`); }
    const s32 = designSection(join(root, 'docs', 'enablement', 'BTI-Enablement-Design.md'), '32-a-the-landing-page');
    for (const q of [...s32.matchAll(/"([^"\n]+)"/g)].map((m) => norm(m[1]))) { checked++; if (!visible.includes(q)) fail(`${file}: the design's landing text "${q}" is not on the page`); }
    for (const h of [...s32.matchAll(/`##\s+([^`]+)`/g)].map((m) => norm(m[1]))) { checked++; if (!visible.includes(h)) fail(`${file}: the design's landing heading "${h}" is not on the page`); }
    rows.push([file, 'landing', 'section 3.2, the pieces\' rules', String(checked), '0', '-', '-', '-']);
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
  ['timing figures (digits and ms or millisecond)', /\b\d[\d,.]*\s*(?:ms|milliseconds?)\b/gi],
];
const scanTexts = { ...pageText };
for (const s of OWN_SOURCES) if (existsSync(join(root, s))) scanTexts[s] = norm(read(join(root, s)).replace(/<style\b[\s\S]*?<\/style>/gi, ' '));
const scanRows = [];
for (const [label, re] of SCANS) {
  const hits = [];
  for (const [file, text] of Object.entries(scanTexts)) for (const m of text.matchAll(re)) hits.push(`${file}: "${text.slice(Math.max(0, m.index - 30), m.index + m[0].length + 30)}"`);
  scanRows.push(`${label}: ${hits.length}`);
  for (const h of hits) fail(`scan, ${label}: ${h}`);
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

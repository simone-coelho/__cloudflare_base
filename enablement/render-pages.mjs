#!/usr/bin/env node
// enablement/render-pages.mjs
// Renders the builder's pages of the internal enablement site from their sources, and stamps the shared chrome and
// the shared spine into every page. Lane P1, rewritten for LANE-BRIEF-V3 by lane S1. Run it after any source or
// partial changes, then run the text check:
//
//   node enablement/render-pages.mjs              write the builder's pages and the figure copies into enablement/site/,
//                                                then stamp every page there (below)
//   node enablement/render-pages.mjs --stamp      only stamp: fill the marked blocks of every page in enablement/site/
//                                                from enablement/partials/, and bring the figure copies in
//                                                enablement/site/figures/ up to their sources; write nothing else
//   node enablement/render-pages.mjs --out DIR    a dry run: copy the served folder into DIR, write the builder's pages
//                                                there, and stamp DIR; enablement/site/ is not touched
//   node enablement/render-pages.mjs --stamp --out DIR
//                                                copy the served folder into DIR and only stamp DIR
//   ... --out DIR --no-copy                      the same, on DIR as it stands (a scratch mirror), without the copy
//   node enablement/render-check.mjs             prove that each page says what its sources say
//
// No dependencies, nothing evaluated: it reads files, parses markdown, HTML and JSON as text, and writes .html and
// .svg files. What it reads, and what each source becomes:
//   docs/enablement/content/demos.md     the demo map: which demo shows which story
//   docs/enablement/content/credits-source.html
//                                        the credits page: the page leadership saw, corrected; its structure is
//                                        mapped element by element, and its timeline rows are its JSON block
//   docs/enablement/GLOSSARY.md          the glossary
//   docs/enablement/content/spine.md     the landing page's one line on what the engine is (the spine's headline)
//   docs/enablement/figures/*.svg        inlined verbatim, and copied byte for byte to enablement/site/figures/
//   enablement/partials/*.html           the chrome (header.html, footer.html) and the spine (spine.html, and
//                                        spine-compact.html for the battlecard), stamped into every page
// It writes index.html (the landing page), credits.html, glossary.html, demos.html and 404.html. It does not write
// the hand-written pages (LANE-BRIEF-V3 section 5): what-it-is (lane M2), see-it-work (T1), selling-it and battlecard
// (A1) and how-it-works (G1), nor how-it-works-interactive (H1). It only stamps them.
//
// The stamp. A page carries up to three marked blocks, each a pair of comments (the spine pair or the compact pair):
//   <!-- chrome:header:start --> ... <!-- chrome:header:end -->       the skip link, masthead and navigation
//   <!-- spine:start --> ... <!-- spine:end -->                       the spine's four blocks, inside the <article>
//   <!-- spine:compact:start --> ... <!-- spine:compact:end -->       its short form, on the battlecard instead
//   <!-- chrome:footer:start --> ... <!-- chrome:footer:end -->       the footer
// The stamp replaces what is between each pair with its partial, marking the page's own address in the navigation
// and the footer with aria-current="page". It is idempotent, writes a page only when the page changes, keeps the
// page's line endings, skips a page that has no markers and says so, and never writes anything else into a page.
// The stamp alone (--stamp) also brings the figure copies up to their sources, since the page lanes run only it.
// One exception, named here: how-it-works-interactive.html predates the markers, and its chrome is lane S1's to
// re-stamp (LANE-BRIEF-V3 section 4.6). The first stamp wraps its existing header and footer in the markers, and
// every stamp sets its stamp line ("Updated ...") to STAMP; nothing else in it is touched.
// Every page links /site.css, and /site.js where it has something to enhance; no page carries an inline style or
// script, and none shows a label, a chip or a legend. Anything a page adds to its source's text is marked
// (data-chrome, data-lead or data-added, with a reason), so the text check can list it instead of comparing it.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = path.join(ROOT, 'enablement', 'site');
const FIGURES = path.join(ROOT, 'docs', 'enablement', 'figures');
const PARTIALS = path.join(ROOT, 'enablement', 'partials');
const argv = process.argv.slice(2);
const OUT = argv.includes('--out') ? path.resolve(argv[argv.indexOf('--out') + 1]) : SITE;
const STAMP_ONLY = argv.includes('--stamp');
// --no-copy (with --out): stamp or build into DIR as it stands, without first copying the served folder into it.
const NO_COPY = argv.includes('--no-copy');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n?/g, '\n');
const notes = [];

const NAME = 'Behavioral Targeting and Intelligence';
// The stamp names the day the pages last changed (LANE-BRIEF-V3 section 5). The material describes the finished
// product, so it names no code commit.
const STAMP = 'Updated October 3, 2026';
const ICON = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='10' fill='%23ABFF44'/%3E%3Ccircle cx='16' cy='16' r='6' fill='%2308251A'/%3E%3C/svg%3E";
const CREDITS_SRC = 'docs/enablement/content/credits-source.html';
const CREDITS_MD = 'docs/enablement/content/credits.md';
const DEMOS_MD = 'docs/enablement/content/demos.md';
const SPINE_MD = 'docs/enablement/content/spine.md';

// ---------- the partials and the stamp ----------
// The navigation, the footer's list of pieces and the spine live in enablement/partials/, outside the served folder;
// this builder and the stamp read them from there, so every page carries the same chrome.
const partial = (name) => fs.readFileSync(path.join(PARTIALS, name), 'utf8').replace(/\r\n?/g, '\n').trim();
const MARKERS = [
  ['header', 'chrome:header:start', 'chrome:header:end', 'header.html'],
  ['spine', 'spine:start', 'spine:end', 'spine.html'],
  ['compact', 'spine:compact:start', 'spine:compact:end', 'spine-compact.html'],
  ['footer', 'chrome:footer:start', 'chrome:footer:end', 'footer.html'],
];
const markerPair = (a, b) => new RegExp(`<!--\\s*${a}\\s*-->[\\s\\S]*?<!--\\s*${b}\\s*-->`, 'g');
// The address a page is served at: index.html at /, the not-found page at none, <name>.html at /<name>.
const addressOf = (file) => (file === 'index.html' ? '/' : file === '404.html' ? null : `/${file.replace(/\.html$/, '')}`);
// The page's own link, in the navigation and in the footer, carries aria-current="page".
const markCurrent = (html, address) => (address ? html.split(`<a href="${address}">`).join(`<a href="${address}" aria-current="page">`) : html);
function stampBlocks(html, file) {
  const eol = html.includes('\r\n') ? '\r\n' : '\n';
  const address = addressOf(file);
  const filled = [];
  const problems = [];
  let out = html;
  for (const [kind, a, b, source] of MARKERS) {
    const found = out.match(markerPair(a, b)) || [];
    if (!found.length) {
      if (new RegExp(`<!--\\s*(?:${a}|${b})\\s*-->`).test(out)) problems.push(`the ${kind} markers are not a pair`);
      continue;
    }
    if (found.length > 1) { problems.push(`the ${kind} markers appear ${found.length} times`); continue; }
    let content = partial(source);
    if (kind === 'header' || kind === 'footer') content = markCurrent(content, address);
    const block = `<!-- ${a} -->\n${content}\n<!-- ${b} -->`.split('\n').join(eol);
    out = out.replace(markerPair(a, b), () => block);
    filled.push(kind);
  }
  return { html: out, filled, problems };
}
// how-it-works-interactive.html predates the markers; its chrome is S1's (LANE-BRIEF-V3 section 4.6).
const ADOPTED = new Set(['how-it-works-interactive.html']);
function adoptChrome(html) {
  let out = html;
  if (!/<!--\s*chrome:header:start\s*-->/.test(out)) {
    const m = /<a class="skip" href="#main">[\s\S]*?<header class="masthead">[\s\S]*?<\/header>/.exec(out);
    if (m) out = out.slice(0, m.index) + `<!-- chrome:header:start -->\n${m[0]}\n<!-- chrome:header:end -->` + out.slice(m.index + m[0].length);
  }
  if (!/<!--\s*chrome:footer:start\s*-->/.test(out)) {
    const m = /<footer class="foot">[\s\S]*?<\/footer>/.exec(out);
    if (m) out = out.slice(0, m.index) + `<!-- chrome:footer:start -->\n${m[0]}\n<!-- chrome:footer:end -->` + out.slice(m.index + m[0].length);
  }
  return out.replace(/(<p class="stamp">)[^<]*(<\/p>)/, (all, open, close) => `${open}${STAMP}${close}`);
}
// Stamp every page in a folder; report what each got. Returns the report lines.
function stampFolder(dir) {
  const lines = [];
  for (const file of fs.readdirSync(dir).filter((f) => /^[a-z0-9-]+\.html$/.test(f)).sort()) {
    const full = path.join(dir, file);
    const raw = fs.readFileSync(full, 'utf8');
    const start = ADOPTED.has(file) ? adoptChrome(raw.replace(/\r\n/g, '\n')).split('\n').join(raw.includes('\r\n') ? '\r\n' : '\n') : raw;
    const { html, filled, problems } = stampBlocks(start, file);
    if (problems.length) { lines.push(`${file}: not stamped: ${problems.join('; ')}`); continue; }
    if (!filled.length) { lines.push(`${file}: no markers, skipped`); continue; }
    if (html !== raw) fs.writeFileSync(full, html);
    lines.push(`${file}: ${filled.join(', ')} ${html !== raw ? 'stamped' : 'already current'}`);
  }
  return lines;
}

// Italic titles in the sources that name another piece become links to it; their text is unchanged.
const TITLE_LINKS = new Map([
  ['What it is', '/what-it-is'],
  ['See it work', '/see-it-work'],
  ['Selling it', '/selling-it'],
  ['Battlecard', '/battlecard'],
  ['How it works and where it runs', '/how-it-works'],
  ['How it works, interactive', '/how-it-works-interactive'],
  ['Where Opal and AI Credits Fit, and Where They Never Do', '/credits'],
  ['Where Opal and AI credits fit, and where they never do', '/credits'],
  ['The glossary', '/glossary'],
  ['Glossary', '/glossary'],
  ['Which demo shows which story', '/demos'],
  ['Which demo to show to whom', '/demos'],
]);
// ---------- text helpers ----------
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const attr = (s) => esc(s).replace(/"/g, '&quot;');
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', middot: '·', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', rarr: '→', uarr: '↑', minus: '−' };
const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
  if (e[0] === '#') return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
  return ENT[e.toLowerCase()] ?? m;
});
const squash = (s) => s.replace(/\s+/g, ' ').trim();
const plainMd = (s) => s.replace(/`([^`]+)`/g, '$1').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/\*\*/g, '').replace(/\*/g, '');
function slugger() {
  const used = new Set();
  return (text) => {
    const base = plainMd(text).toLowerCase().replace(/[^\p{L}\p{N}_\- ]/gu, '').replace(/ /g, '-');
    let s = base;
    let n = 0;
    while (used.has(s)) s = `${base}-${++n}`;
    used.add(s);
    return s;
  };
}
// LANE-BRIEF-V2: the site shows no label, no chip and no legend. A label word left in a source renders as the words
// it is, and the text check's state-word scan fails the page until the source changes.

// A link to the site itself becomes a path; a link to a demo worker stays whole; anything else stops the build.
function mapHref(u) {
  if (u.startsWith('#')) return u;
  const site = /^https:\/\/edge-platform-(?:bti|enablement)\.expedge\.workers\.dev(\/[^#?]*)?(#.*)?$/.exec(u);
  if (site) return ((site[1] || '/').replace(/\/+$/, '') || '/') + (site[2] || '');
  if (!/^https:\/\/edge-platform(?:-vantage|-top-offers|-oh)?\.expedge\.workers\.dev(\/|$)/.test(u)) throw new Error(`a link outside the allowlist: ${u}`);
  return u;
}
function emph(s) {
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^\w*])\*([^\s*](?:[^*]*?[^\s*])?)\*(?![\w*])/g, '$1<em>$2</em>');
  return s;
}
function titleLinks(html, self) {
  return html.split(/(<a\b[\s\S]*?<\/a>)/).map((seg) => (seg.startsWith('<a') ? seg : seg.replace(/<em>([^<]+)<\/em>/g, (m, t) => {
    const href = TITLE_LINKS.get(decode(t));
    return href && href !== self ? `<a href="${href}">${m}</a>` : m;
  }))).join('');
}
function inline(md, ctx = {}) {
  const codes = [];
  const links = [];
  let s = md.replace(/`([^`]+)`/g, (_, c) => { codes.push(c); return `\u0001${codes.length - 1}\u0001`; });
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, u) => { links.push([t, u]); return `\u0002${links.length - 1}\u0002`; });
  s = emph(esc(s));
  s = s.replace(/\u0002(\d+)\u0002/g, (_, i) => { const [t, u] = links[+i]; return `<a href="${attr(mapHref(u))}">${emph(esc(t))}</a>`; });
  s = s.replace(/\u0001(\d+)\u0001/g, (_, i) => `<code>${esc(codes[+i])}</code>`);
  return titleLinks(s, ctx.self);
}
const addedAttr = (ctx, md) => {
  const why = ctx.added && ctx.added.get(squash(plainMd(md)));
  return why ? ` data-added="${attr(why)}"` : '';
};

// ---------- markdown blocks ----------
function parseTable(rows) {
  const cells = (r) => r.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
  return { head: cells(rows[0]), body: rows.slice(2).map(cells) };
}
function parseBlocks(md) {
  const lines = md.split('\n');
  const blocks = [];
  const special = /^(#{1,3}\s|```|\||>|!\[|---+\s*$|\s*[-*]\s+|\d+\.\s+)/;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    let m;
    if (!line.trim()) { i++; continue; }
    if ((m = /^(#{1,3})\s+(.*)$/.exec(line))) { blocks.push({ type: 'heading', level: m[1].length, text: m[2].trim() }); i++; continue; }
    if (/^```/.test(line)) { const body = []; i++; while (i < lines.length && !/^```/.test(lines[i])) body.push(lines[i++]); i++; blocks.push({ type: 'code', lines: body }); continue; }
    if (/^---+\s*$/.test(line)) { blocks.push({ type: 'hr' }); i++; continue; }
    if ((m = /^!\[([^\]]*)\]\(([^)]+)\)\s*$/.exec(line))) { blocks.push({ type: 'figure', caption: m[1], src: m[2] }); i++; continue; }
    if (/^\|/.test(line)) { const rows = []; while (i < lines.length && /^\|/.test(lines[i])) rows.push(lines[i++]); blocks.push({ type: 'table', ...parseTable(rows) }); continue; }
    if (/^>\s?/.test(line)) { const body = []; while (i < lines.length && /^>\s?/.test(lines[i])) body.push(lines[i++].replace(/^>\s?/, '')); blocks.push({ type: 'quote', text: body.join(' ').trim() }); continue; }
    if ((m = /^\s*([-*]|\d+\.)\s+/.exec(line))) {
      const ordered = /\d/.test(m[1]);
      const start = ordered ? parseInt(m[1], 10) : 1;
      const items = [];
      const marker = ordered ? /^\s*\d+\.\s+/ : /^\s*[-*]\s+/;
      while (i < lines.length && marker.test(lines[i])) {
        let item = lines[i++].replace(marker, '');
        while (i < lines.length && lines[i].trim() && !special.test(lines[i])) item += ` ${lines[i++].trim()}`;
        items.push(item);
      }
      blocks.push({ type: ordered ? 'ol' : 'ul', start, items });
      continue;
    }
    const body = [line.trim()];
    i++;
    while (i < lines.length && lines[i].trim() && !special.test(lines[i])) body.push(lines[i++].trim());
    blocks.push({ type: 'p', text: body.join(' ') });
  }
  return blocks;
}
const ruleOf = (b) => {
  if (!b || (b.type !== 'quote' && b.type !== 'p')) return null;
  const m = /^\*\*([^*]+)\*\*$/.exec(b.text);
  return m ? m[1] : null;
};

// ---------- components ----------
function titleHtml(fullTitle) {
  if (!fullTitle.startsWith(`${NAME}: `)) throw new Error(`a title without the package name: ${fullTitle}`);
  const rest = fullTitle.slice(NAME.length + 2);
  return `<h1 class="title"><span class="kicker"><span id="package-name">${NAME}</span>:</span> <span class="title-main">${esc(rest)}</span></h1>`;
}
function ruleHtml(text, ctx, close) {
  return `<div class="rule${close ? ' rule-close' : ''}"><p class="rule-label" data-chrome="rule label">${close ? 'The one rule, again' : 'The one rule'}</p><p class="rule-text">${inline(`**${text}**`, ctx)}</p></div>`;
}
const svgCache = new Map();
function svgOf(name) {
  if (!/^[a-z0-9-]+$/.test(name)) throw new Error(`a figure name the site does not take: ${name}`);
  if (!svgCache.has(name)) svgCache.set(name, fs.readFileSync(path.join(FIGURES, `${name}.svg`), 'utf8').replace(/\r\n?/g, '\n').trim());
  return svgCache.get(name);
}
const svgTitle = (svg) => decode(/<title\b[^>]*>([^<]*)<\/title>/.exec(svg)[1].trim());
// LANE-BRIEF-V2 allows no label. A figure that still shows one is not added by a ruling until it is redrawn
// without it; a figure a source places stays, and the text check names it.
const figureLabeled = (name) => /<text\b[^>]*>\s*(?:Built|Designed|Open)\s*<\/text>/.test(svgOf(name));
function figureHtml(name, { lead, sw, added } = {}) {
  const svg = svgOf(name);
  const attrs = [`class="figure${sw ? ' figure-switch' : ''}"`, `data-figure="${name}"`];
  if (sw) attrs.push(`data-switch="${sw}"`, 'data-switch-label="Bring one part of the session forward"');
  if (added) attrs.push(`data-added="${attr(added)}"`);
  return [
    `<figure ${attrs.join(' ')}>`,
    lead ? `<p class="figure-lead" data-lead="figure lead">${lead}</p>` : '',
    sw ? '<p class="figure-switch-help" data-lead="switch instructions" hidden>Choose before, during or after to bring that part forward; choose it again to see all three.</p>' : '',
    '<p class="figure-scroll-hint" data-chrome="scroll hint" aria-hidden="true">The figure scrolls sideways.</p>',
    `<div class="figure-frame">${svg}</div>`,
    `<figcaption>${esc(svgTitle(svg))}</figcaption>`,
    '</figure>',
  ].filter(Boolean).join('\n');
}
function tableHtml(t, ctx) {
  const plainHead = t.head.map((h) => plainMd(h));
  const isNever = plainHead.length === 2 && plainHead[0] === 'Never say' && plainHead[1] === 'Say instead';
  const isObjections = plainHead[0] === 'They ask' && plainHead.includes('Never say');
  const isCards = plainHead[0] === 'Demo';
  const kind = isNever ? 'never' : isObjections ? 'objections' : isCards ? 'cards' : 'plain';
  const verdictCols = plainHead.map((h, i) => (/^(Verdict|Label|Status)$/i.test(h) ? i : -1)).filter((i) => i >= 0);
  const whenCol = plainHead.indexOf('When');
  const head = `<thead><tr>${t.head.map((h, i) => `<th scope="col"${verdictCols.includes(i) ? ' class="c-verdict"' : ''}>${inline(h, ctx)}</th>`).join('')}</tr></thead>`;
  const rows = t.body.map((r) => {
    const cells = r.map((c, i) => {
      let html = inline(c, ctx);
      const classes = [];
      if (verdictCols.includes(i)) classes.push('c-verdict');
      if (i === whenCol && /^(Before|During|After)$/.test(c)) html = `<span class="phase">${html}</span>`;
      if (!c) classes.push('c-empty');
      if (isNever) classes.push(i === 0 ? 'c-never' : 'c-say');
      if (isObjections && i > 0) classes.push(plainHead[i] === 'Never say' ? 'c-never' : 'c-say');
      const label = ` data-label="${attr(plainHead[i])}"`;
      const added = addedAttr(ctx, c);
      if (isObjections && i === 0) return `<th scope="row"${label}${added}>${html}</th>`;
      return `<td${classes.length ? ` class="${classes.join(' ')}"` : ''}${label}${added}>${html}</td>`;
    });
    return `<tr>${cells.join('')}</tr>`;
  });
  const FULL = new Set(['Demo', 'Address', 'The question it answers']);
  const cols = isCards ? ` data-cols="${plainHead.filter((h) => !FULL.has(h)).length}"` : '';
  return `<div class="tbl tbl-${kind}"><table class="rt t-${kind}"${cols}>${head}<tbody>${rows.join('')}</tbody></table></div>`;
}
function paraHtml(text, ctx) {
  let m;
  if (/^\*\*[^*]+\*\*$/.test(text)) return `<p class="subhead">${inline(text, ctx)}</p>`;
  if (/^(The one exception\b|The exception, flagged once\b)/.test(text)) return `<div class="exception"><p>${inline(text, ctx)}</p></div>`;
  if (/^The detail: /.test(text)) return `<p class="navlink navlink-detail">${inline(text, ctx)}</p>`;
  if (/^Back to the walk: /.test(text)) return `<p class="navlink navlink-back">${inline(text, ctx)}</p>`;
  if ((m = /^\*\*(\d+)\.\s([^*]+)\*\*\s+([\s\S]+)$/.exec(text))) return `<p class="step"><strong class="step-lead"><span class="step-num">${m[1]}.</span> ${inline(m[2], ctx)}</strong> ${inline(m[3], ctx)}</p>`;
  if ((m = /^\*\*([^*]+\?)\*\*\s+([\s\S]+)$/.exec(text))) return `<p class="qa"><strong class="qa-q">${inline(m[1], ctx)}</strong> ${inline(m[2], ctx)}</p>`;
  if (/^\*\*Say it like this\.\*\*/.test(text)) return `<p class="say-callout">${inline(text, ctx)}</p>`;
  if (/^\*\*[^*]+\*\*\s/.test(text)) return `<p class="lead-in">${inline(text, ctx)}</p>`;
  return `<p${addedAttr(ctx, text)}>${inline(text, ctx)}</p>`;
}

// ---------- a markdown piece ----------
function renderPiece(md, cfg) {
  for (const ins of cfg.insert || []) {
    if (ins.figure && figureLabeled(ins.figure)) { ins.skip = true; notes.push(`${cfg.src}: the ${ins.figure} figure still shows labels, so the ruling's copy is left out until it is redrawn`); }
  }
  const blocks = parseBlocks(md);
  const slug = slugger();
  const ctx = { self: cfg.url, added: cfg.added };
  const out = [];
  const h1 = blocks.shift();
  if (!h1 || h1.type !== 'heading' || h1.level !== 1) throw new Error(`${cfg.src}: no title`);
  out.push(titleHtml(h1.text));
  const reader = blocks.shift();
  if (!reader || reader.type !== 'p') throw new Error(`${cfg.src}: no reader line`);
  out.push(`<p class="reader-line">${inline(reader.text, ctx)}</p>`);
  const rule = ruleOf(blocks.shift());
  if (!rule) throw new Error(`${cfg.src}: the third block is not the rule`);
  out.push(ruleHtml(rule, ctx, false));
  let closeIdx = -1;
  for (let i = blocks.length - 1; i >= 0; i--) if (ruleOf(blocks[i]) === rule) { closeIdx = i; break; }
  if (closeIdx < 0) throw new Error(`${cfg.src}: the rule is not repeated last`);
  if (closeIdx !== blocks.length - 1) notes.push(`${cfg.src}: the closing rule is not the very last block`);

  let open = false;
  let subOpen = false;
  let sayList = false;
  let currentSection = '';
  const closeSub = () => { if (subOpen) { out.push('</div>'); subOpen = false; } };
  const closeSection = () => {
    closeSub();
    if (open) {
      for (const ins of cfg.insert || []) if (!ins.skip && ins.afterSection === currentSection) { out.push(ins.html); ins.used = true; }
      out.push('</section>');
      open = false;
    }
  };
  blocks.forEach((b, i) => {
    if (i === closeIdx) return;
    if (b.type === 'heading') {
      const id = slug(b.text);
      if (b.level === 2) {
        closeSection();
        currentSection = id;
        sayList = /^(Sentences to say|Say these sentences)/.test(b.text);
        const part = /^Part [A-Z]\. /.test(b.text);
        out.push(`<section class="sec${part ? ' sec-part' : ''}" aria-labelledby="${id}">`);
        out.push(`<h2 id="${id}"${part ? ' class="part"' : ''}${addedAttr(ctx, b.text)}>${inline(b.text, ctx)}</h2>`);
        open = true;
      } else {
        closeSub();
        if (/^The one exception/.test(b.text)) { out.push('<div class="exception">'); subOpen = true; }
        out.push(`<h3 id="${id}">${inline(b.text, ctx)}</h3>`);
      }
      return;
    }
    if (b.type === 'p') {
      out.push(paraHtml(b.text, ctx));
      return;
    }
    if (b.type === 'quote') { out.push(`<blockquote><p>${inline(b.text, ctx)}</p></blockquote>`); return; }
    if (b.type === 'ul' || b.type === 'ol') {
      const cls = sayList && b.type === 'ul' ? ' class="say-list"' : '';
      const start = b.type === 'ol' && b.start !== 1 ? ` start="${b.start}"` : '';
      out.push(`<${b.type}${cls}${start}>${b.items.map((it) => `<li>${inline(it, ctx)}</li>`).join('')}</${b.type}>`);
      return;
    }
    if (b.type === 'table') { out.push(tableHtml(b, ctx)); return; }
    if (b.type === 'figure') {
      const name = path.basename(b.src).replace(/\.(png|svg)$/, '');
      const title = svgTitle(svgOf(name));
      if (title !== b.caption) notes.push(`${cfg.src}: the source caption "${b.caption}" differs from the SVG title "${title}"; the page shows the SVG title (the coordinator's ruling)`);
      out.push(figureHtml(name));
      return;
    }
    if (b.type === 'code') { out.push(`<pre><code>${esc(b.lines.join('\n'))}</code></pre>`); return; }
    if (b.type === 'hr') return;
    throw new Error(`${cfg.src}: unknown block ${b.type}`);
  });
  closeSection();
  // An addition whose section has gone stops the build, so a renamed heading can never drop it silently.
  for (const ins of cfg.insert || []) if (!ins.used && !ins.skip) throw new Error(`${cfg.src}: no section #${ins.afterSection} for the marked addition placed after it; update its anchor in render-pages.mjs`);
  out.push(ruleHtml(rule, ctx, true));
  return { html: out.join('\n'), rule };
}

// ---------- the glossary ----------
function renderGlossary(md, cfg) {
  const blocks = parseBlocks(md);
  const slug = slugger();
  const ctx = { self: cfg.url };
  const out = [];
  out.push(titleHtml(blocks.shift().text));
  out.push(`<p class="reader-line">${inline(blocks.shift().text, ctx)}</p>`);
  const rule = ruleOf(blocks.shift());
  if (!rule) throw new Error('glossary: no rule');
  out.push(ruleHtml(rule, ctx, false));
  if (ruleOf(blocks[blocks.length - 1]) !== rule) throw new Error('glossary: the rule is not last');
  blocks.pop();
  const letters = blocks.filter((b) => b.type === 'heading' && /^[A-Z]$/.test(b.text)).map((b) => b.text);
  const az = `<nav class="az" aria-label="Letters" data-chrome="letter index"><ul>${letters.map((l) => `<li><a href="#letter-${l.toLowerCase()}">${l}</a></li>`).join('')}</ul></nav>`;
  const entryIds = new Set();
  let openKind = null; // null | 'plain' | 'letter'
  const close = () => { if (openKind === 'letter') out.push('</dl></section>'); else if (openKind === 'plain') out.push('</section>'); openKind = null; };
  for (const b of blocks) {
    if (b.type === 'heading' && b.level === 2) {
      const isLetter = /^[A-Z]$/.test(b.text);
      if (isLetter && openKind !== 'letter') { close(); out.push(az); }
      close();
      if (isLetter) {
        const id = `letter-${b.text.toLowerCase()}`;
        out.push(`<section class="letter" aria-labelledby="${id}"><h2 class="letter-h" id="${id}">${b.text}</h2><dl class="entries">`);
        openKind = 'letter';
      } else {
        const id = slug(b.text);
        out.push(`<section class="sec" aria-labelledby="${id}"><h2 id="${id}">${inline(b.text, ctx)}</h2>`);
        openKind = 'plain';
      }
      continue;
    }
    if (b.type !== 'p') throw new Error(`glossary: unexpected ${b.type}`);
    if (openKind !== 'letter') { out.push(`<p>${inline(b.text, ctx)}</p>`); continue; }
    const m = /^\*\*(.+?)\*\*\s+([\s\S]+)$/.exec(b.text);
    if (!m) throw new Error(`glossary: not an entry: ${b.text.slice(0, 60)}`);
    const term = m[1];
    const word = term.replace(/\.$/, '');
    // The id by the design's rule (section 3.7): the GitHub anchor of the term, any bracketed symbol dropped.
    const id = word.replace(/\s*\([^)]*\)\s*/g, ' ').trim().toLowerCase().replace(/[^\p{L}\p{N}_\- ]/gu, '').replace(/ /g, '-');
    if (entryIds.has(id) || /^letter-|^how-to-read-it$/.test(id)) throw new Error(`glossary: id clash ${id}`);
    entryIds.add(id);
    const deprecated = /^Deprecated\b/.test(m[2]);
    const dt = esc(term);
    out.push(`<div class="entry${deprecated ? ' deprecated' : ''}" id="${id}"><dt>${dt}</dt><dd>${inline(m[2], ctx)}</dd></div>`);
  }
  close();
  out.push(ruleHtml(rule, ctx, true));
  return { html: out.join('\n'), rule, entries: entryIds.size, letters: letters.length };
}

// ---------- HTML, read as text: a small parser for the credits page's source ----------
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
function parseHtml(html) {
  const top = { tag: '#root', attrs: {}, children: [] };
  const stack = [top];
  const re = /<!--[\s\S]*?-->|<![^>]*>|<\/([a-zA-Z][\w:-]*)\s*>|<([a-zA-Z][\w:-]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*(\/?)>|([^<]+)|(<)/g;
  let m;
  while ((m = re.exec(html))) {
    const cur = stack[stack.length - 1];
    if (m[0].startsWith('<!')) continue;
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
const kidsOf = (n) => (n.children || []).filter((c) => c.tag);
const classesOf = (n) => ((n.attrs && n.attrs.class) || '').split(/\s+/).filter(Boolean);
const has = (n, c) => Boolean(n) && classesOf(n).includes(c);
const textOf = (n) => (n.text !== undefined ? n.text : n.tag === 'br' ? ' ' : (n.children || []).map(textOf).join(''));

// ---------- the credits page, rendered from its corrected source ----------
// The source keeps the original's structure; each element it holds maps to one element of the page, and anything
// it holds that the page does not know stops the build, so a change to the source can never be dropped silently.
// Credit verdicts are bold words, never chips: no fill and no color of their own (design sections 3.6 and 3.9).
const INLINE_CLASS = { key: 'cr-key', op: 'cr-op', en: 'cr-en', int: 'cr-int' };
const INLINE_STRONG = { scales: 'cr-scales' };
const ROW_KINDS = new Set(['credit', 'free', 'warn', 'open', 'off']);
const TAG_KINDS = new Set(['traffic', 'team', 'adopt', 'own']);
const METERS = new Set(['credit', 'free', 'mixed']);
const crFail = (what) => { throw new Error(`${CREDITS_SRC}: ${what}`); };
function inl(node, opts = {}) {
  const br = opts.br ?? ' ';
  let out = '';
  for (const c of node.children || []) {
    if (c.text !== undefined) { out += esc(c.text); continue; }
    if (c.tag === 'br') { out += br; continue; }
    if (['b', 'strong', 'em', 'i'].includes(c.tag)) { out += `<${c.tag}>${inl(c, opts)}</${c.tag}>`; continue; }
    if (c.tag === 'span') {
      const cls = classesOf(c);
      if (cls.includes('lbl')) crFail(`a label, "${squash(textOf(c))}": LANE-BRIEF-V2 allows no label on the site`);
      const k = cls.find((x) => INLINE_CLASS[x]);
      if (k) { out += `<span class="${INLINE_CLASS[k]}">${inl(c, opts)}</span>`; continue; }
      const sk = cls.find((x) => INLINE_STRONG[x]);
      if (sk) { out += `<strong class="${INLINE_STRONG[sk]}">${inl(c, opts)}</strong>`; continue; }
    }
    crFail(`an inline element the page does not know: <${c.tag} class="${classesOf(c).join(' ')}">`);
  }
  return out.replace(/\s+/g, ' ').trim();
}
const frag = (s, opts) => inl(parseHtml(String(s)), opts);
const need = (n, what) => n || crFail(`missing ${what}`);
const child = (n, pred, what) => need(kidsOf(n).find(pred), what);
function crMast(el) {
  const eyebrow = child(el, (x) => has(x, 'eyebrow'), 'the eyebrow');
  const h1 = child(el, (x) => x.tag === 'h1', 'the h1');
  const dek = child(el, (x) => has(x, 'dek'), 'the dek');
  return `<header class="cr-mast">
<p class="cr-eyebrow">${inl(eyebrow)}</p>
<h1 class="title cr-title"><span class="kicker" data-chrome="package name"><span id="package-name">${NAME}</span><span class="visually-hidden">: </span></span> <span class="title-main">${inl(h1)}</span></h1>
<p class="cr-dek">${inl(dek)}</p>
</header>`;
}
function crRule(el) {
  const out = ['<div class="cr-rule">'];
  for (const c of kidsOf(el)) {
    if (has(c, 'rule-head')) out.push(`<p class="cr-rule-head">${inl(c)}</p>`);
    else if (has(c, 'rule-body')) {
      out.push('<div class="cr-rule-body">');
      for (const half of kidsOf(c)) {
        const side = has(half, 'eng') ? 'eng' : has(half, 'opal') ? 'opal' : crFail('a rule half that is neither the engine nor Opal');
        out.push(`<div class="cr-half ${side}">`);
        for (const x of kidsOf(half)) {
          if (has(x, 'rl')) out.push(`<p class="cr-rl">${inl(x)}</p>`);
          else if (has(x, 'big')) out.push(`<p class="cr-big">${inl(x)}</p>`);
          else if (has(x, 'verdict')) out.push(`<p class="cr-verdict"><strong>${inl(x)}</strong></p>`);
          else if (x.tag === 'p' && !classesOf(x).length) out.push(`<p class="cr-hd">${inl(x)}</p>`);
          else crFail(`a rule-half element the page does not know: <${x.tag} class="${classesOf(x).join(' ')}">`);
        }
        out.push('</div>');
      }
      out.push('</div>');
    } else if (has(c, 'rule-note')) out.push(`<p class="cr-rule-note">${inl(c)}</p>`);
    else if (has(c, 'rule-foot')) out.push(`<p class="cr-rule-foot">${inl(c)}</p>`);
    else crFail(`a rule element the page does not know: <${c.tag} class="${classesOf(c).join(' ')}">`);
  }
  out.push('</div>');
  return out.join('\n');
}
function crTimeline(el, phases) {
  // Review round three, R3-13: no legend row, not even as words (LANE-BRIEF-V2 allows no legend on the site).
  if (kidsOf(el).some((x) => has(x, 'tl-legend'))) crFail('a legend row in the timeline: LANE-BRIEF-V2 allows no legend on the site');
  const tabs = child(el, (x) => has(x, 'tl-phases'), 'the timeline tabs');
  const panels = kidsOf(tabs).filter((b) => b.tag === 'button').map((b) => {
    const key = b.attrs['data-ph'];
    const ph = phases[key];
    if (!['before', 'during', 'after'].includes(key) || !ph) crFail(`a part with no rows in the JSON: ${key}`);
    if (ph.band !== key) crFail(`the ${key} part names another band: ${ph.band}`);
    const part = (cls) => child(b, (x) => has(x, cls), `the ${key} tab's ${cls}`);
    const meter = part('ppmeter');
    const meterKind = classesOf(meter).find((x) => x !== 'ppmeter');
    if (!METERS.has(meterKind)) crFail(`a part meter the page does not know: ${meterKind}`);
    return [
      `<section class="cr-tl-panel" id="tl-${key}" data-tab-panel data-tab-class="p-${key}">`,
      `<h3 class="cr-tl-head" data-tab-label><span class="pph">${inl(part('pph'))}</span> <span class="ppt">${inl(part('ppt'))}</span> <strong class="ppmeter">${inl(meter)}</strong></h3>`,
      `<div class="cr-band"><strong class="cr-pill">${frag(ph.pill)}</strong> <span class="cr-bnote">${frag(ph.note)}</span></div>`,
      ...ph.rows.map((r) => {
        if (!ROW_KINDS.has(r.k)) crFail(`a row kind the page does not know: ${r.k}`);
        return `<div class="cr-tp" data-kind="${r.k}"><div><p class="cr-tpn">${frag(r.n)}${r.warn === true ? ' <strong class="cr-warnbadge">exception</strong>' : ''}</p><p class="cr-tpd">${frag(r.d)}</p></div><p class="cr-tpv"><strong>${frag(r.v, { br: '<br>' })}</strong></p></div>`;
      }),
      `<p class="cr-take">${frag(ph.take)}</p>`,
      '</section>',
    ].join('\n');
  });
  if (panels.length !== 3) crFail(`the timeline has ${panels.length} parts, not three`);
  return `<div class="cr-tl" data-tabs data-tabs-label="${attr(tabs.attrs['aria-label'] || 'The three parts of the session')}" data-tabs-class="cr-tl-tabs">
${panels.join('\n')}
</div>`;
}
function crScale(el) {
  const num = (v) => (/^\d+(\.\d+)?$/.test(v || '') ? v : crFail(`a graph coordinate that is not a number: ${v}`));
  return `<div class="cr-scale">\n${kidsOf(el).map((card) => {
    const side = has(card, 'eng') ? 'eng' : has(card, 'opal') ? 'opal' : crFail('a scaling card that is neither the engine nor Opal');
    const svg = need(find(child(card, (x) => has(x, 'graph'), 'a graph'), (x) => x.tag === 'svg')[0], 'a graph svg');
    const line = need(find(svg, (x) => x.tag === 'line')[0], 'a graph line');
    const dot = need(find(svg, (x) => x.tag === 'circle')[0], 'a graph dot');
    return `<div class="cr-scalecard ${side}">
<h3>${inl(child(card, (x) => x.tag === 'h4', 'a card title'))}</h3>
<p class="cr-axis">${inl(child(card, (x) => has(x, 'axis'), 'an axis'))}</p>
<div class="cr-graph"><svg viewBox="0 0 200 120" preserveAspectRatio="none" aria-hidden="true" focusable="false"><line class="cr-g-line" x1="${num(line.attrs.x1)}" y1="${num(line.attrs.y1)}" x2="${num(line.attrs.x2)}" y2="${num(line.attrs.y2)}"/><circle class="cr-g-dot" cx="${num(dot.attrs.cx)}" cy="${num(dot.attrs.cy)}" r="${num(dot.attrs.r)}"/></svg></div>
<p class="cr-sc-verdict"><strong>${inl(child(card, (x) => has(x, 'verdict'), 'a card verdict'))}</strong></p>
<p class="cr-sc-note">${inl(child(card, (x) => has(x, 'sc-note'), 'a card note'))}</p>
</div>`;
  }).join('\n')}\n</div>`;
}
function crMeters(el) {
  return `<div class="cr-meters">\n${kidsOf(el).map((m) => {
    const n = classesOf(m).find((x) => /^m\d$/.test(x)) || crFail('a meter with no number class');
    const body = child(m, (x) => has(x, 'mbody'), 'a meter body');
    return `<div class="cr-meter ${n}">
<p class="cr-mnum" aria-hidden="true">${inl(child(m, (x) => has(x, 'mnum'), 'a meter number'))}</p>
<div class="cr-mbody">
<p class="cr-mname">${inl(child(body, (x) => has(x, 'mname'), 'a meter name'))}</p>
<p class="cr-mdesc">${inl(child(body, (x) => has(x, 'mdesc'), 'a meter description'))}</p>
</div>
</div>`;
  }).join('\n')}\n</div>`;
}
const crWarn = (el) => `<div class="cr-warnrow">\n${kidsOf(el).map((p) => (has(p, 'wt') ? `<p class="cr-wt">${inl(p)}</p>` : `<p>${inl(p)}</p>`)).join('\n')}\n</div>`;
const crScripts = (el) => `<div class="cr-scripts">\n${kidsOf(el).map((s) => `<div class="cr-script">
<p class="cr-slabel">${inl(child(s, (x) => has(x, 'slabel'), 'a sentence label'))}</p>
<p class="cr-line">${inl(child(s, (x) => x.tag === 'p', 'a sentence'))}</p>
</div>`).join('\n')}\n</div>`;
function crFaq(d) {
  const body = child(d, (x) => has(x, 'faq-body'), 'an answer');
  return `<details><summary>${inl(child(d, (x) => x.tag === 'summary', 'a question'))}</summary><div class="cr-faq-body"><p>${inl(child(body, (x) => x.tag === 'p', 'an answer paragraph'))}</p></div></details>`;
}
function crOrder(el) {
  const out = ['<div class="cr-order">'];
  for (const r of kidsOf(el)) {
    if (has(r, 'order-head')) { out.push(`<div class="cr-order-head">${kidsOf(r).map((s) => `<p>${inl(s)}</p>`).join('')}</div>`); continue; }
    if (!has(r, 'order-row')) crFail(`an order-form element the page does not know: <${r.tag} class="${classesOf(r).join(' ')}">`);
    const block = child(r, (x) => x.tag === 'div', 'an order line');
    const tag = child(r, (x) => has(x, 'otag'), 'an order tag');
    const kind = classesOf(tag).find((x) => x !== 'otag');
    if (!TAG_KINDS.has(kind)) crFail(`an order tag the page does not know: ${kind}`);
    out.push(`<div class="cr-order-row"><p class="cr-oname">${inl(child(block, (x) => has(x, 'oname'), 'a line name'))}</p><p class="cr-odesc">${inl(child(block, (x) => has(x, 'odesc'), 'a line description'))}</p><p class="cr-otag" data-kind="${kind}"><strong>${inl(tag)}</strong></p></div>`);
  }
  out.push('</div>');
  return out.join('\n');
}
function crColophon(el) {
  const parts = [[]];
  for (const c of el.children) { if (c.tag === 'br') parts.push([]); else parts[parts.length - 1].push(c); }
  if (parts.length !== 2) crFail('the closing lines are not two lines');
  const line = (nodes) => inl({ children: nodes });
  return `<footer class="cr-colophon">\n<p>${line(parts[0])}<br>\n<span class="cr-colophon-rule">${line(parts[1])}</span></p>\n</footer>`;
}
function renderCredits() {
  const tree = parseHtml(read(CREDITS_SRC));
  const data = need(find(tree, (n) => n.tag === 'script' && n.attrs.id === 'tl-data')[0], 'the timeline rows, <script type="application/json" id="tl-data">');
  if (data.attrs.type !== 'application/json') crFail('the timeline rows are not marked application/json');
  const phases = JSON.parse(textOf(data));
  const wrap = need(find(tree, (n) => n.tag === 'div' && has(n, 'wrap'))[0], 'the page wrapper');
  const out = [];
  let n = 0;
  for (const el of kidsOf(wrap)) {
    if (el.tag === 'header' && has(el, 'mast')) out.push(crMast(el));
    else if (el.tag === 'div' && has(el, 'rule')) out.push(crRule(el));
    else if (el.tag === 'section') {
      n += 1;
      const isFaq = kidsOf(el).some((c) => c.tag === 'details');
      const id = el.attrs.id && /^[a-z-]+$/.test(el.attrs.id) ? ` id="${el.attrs.id}"` : '';
      const sec = [`<section class="cr-section${isFaq ? ' cr-faq' : ''}"${id} aria-labelledby="cr-h-${n}">`];
      for (const c of kidsOf(el)) {
        if (has(c, 'snum')) sec.push(`<p class="cr-snum">${inl(c)}</p>`);
        else if (c.tag === 'h2') {
          sec.push(`<h2 id="cr-h-${n}">${inl(c)}</h2>`);
          if (isFaq) sec.push('<p class="cr-faq-lead" data-lead="disclosures">Each question opens to its answer.</p>');
        } else if (has(c, 'caption')) sec.push(`<p class="cr-caption">${inl(c)}</p>`);
        else if (has(c, 'lead')) sec.push(`<p class="cr-lead">${inl(c)}</p>`);
        else if (c.tag === 'p' && !classesOf(c).length) sec.push(`<p>${inl(c)}</p>`);
        else if (has(c, 'tl')) sec.push(crTimeline(c, phases));
        else if (has(c, 'scale')) sec.push(crScale(c));
        else if (has(c, 'meters')) sec.push(crMeters(c));
        else if (has(c, 'warnrow')) sec.push(crWarn(c));
        else if (has(c, 'scripts')) sec.push(crScripts(c));
        else if (c.tag === 'details') sec.push(crFaq(c));
        else if (has(c, 'order')) sec.push(crOrder(c));
        else crFail(`a section element the page does not know: <${c.tag} class="${classesOf(c).join(' ')}">`);
      }
      if (el.attrs.id === 'timeline') {
        if (figureLabeled('before-during-after')) notes.push(`${CREDITS_SRC}: the before-during-after figure still shows labels, so the ruling's copy is left out until it is redrawn`);
        else sec.push(figureHtml('before-during-after', {
          lead: 'The same session as one figure.',
          added: "the session figure, by the coordinator's ruling of 2026-10-02 (design section 3.6); credits.md carries it for Word",
        }));
      }
      sec.push('</section>');
      out.push(sec.join('\n'));
    } else if (el.tag === 'footer') out.push(crColophon(el));
    else crFail(`a page element the page does not know: <${el.tag} class="${classesOf(el).join(' ')}">`);
  }
  if (n !== 6) crFail(`${n} sections, not six`);
  return `<article class="piece piece-credits" data-source="${CREDITS_SRC} ${CREDITS_MD}">\n${out.join('\n')}\n</article>`;
}

// ---------- page shell ----------
function headHtml(title, js) {
  return `<!DOCTYPE html>
<html lang="en-US">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow, noarchive">
<meta name="theme-color" content="#E4F0DA" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#08251A" media="(prefers-color-scheme: dark)">
<title>${esc(title)}</title>
<!-- Built by enablement/render-pages.mjs from its source. Nothing inline: every style is in /site.css${js ? ' and the behavior in /site.js, which the page does not need in order to read in full' : ''}. -->
<link rel="icon" href="${ICON}">
<link rel="stylesheet" href="/site.css">
${js ? '<script src="/site.js" defer></script>\n' : ''}</head>`;
}
// The chrome comes from the partials, already wrapped in its markers, so a later stamp finds it and keeps it current.
function chromeTop(url) {
  return `<!-- chrome:header:start -->\n${markCurrent(partial('header.html'), url)}\n<!-- chrome:header:end -->`;
}
function chromeFoot(url) {
  return `<!-- chrome:footer:start -->\n${markCurrent(partial('footer.html'), url)}\n<!-- chrome:footer:end -->`;
}
function pageHtml({ url, title, readerTag, readerKey, article, js }) {
  const meta = `<div class="piece-meta">${readerTag ? `<p class="reader-tag" data-reader="${readerKey}">${esc(readerTag)}</p>` : ''}<p class="stamp">${esc(STAMP)}</p></div>`;
  return `${headHtml(url === '/' ? 'Optimizely enablement' : `${title} · Optimizely enablement`, js)}
<body>
${chromeTop(url)}
<main id="main" class="wrap">
${meta}
${article}
</main>
${chromeFoot(url)}
</body>
</html>
`;
}
// The not-found page: the site's chrome without the package name, which the preflight keeps to the pages.
function notFoundHtml() {
  return `${headHtml('Page not found · Optimizely enablement', false)}
<body>
${chromeTop(null)}
<main id="main" class="wrap">
<div class="notfound">
<h1>We couldn’t find that page</h1>
<a class="btn" href="/">Back to enablement</a>
</div>
</main>
${chromeFoot(null)}
</body>
</html>
`;
}

// ---------- the landing page ----------
// LANE-BRIEF-V3 section 4.6 and the lane brief: the reader picks their audience, as before. Under the package name,
// the one line that says what the engine is: the spine's headline, read from spine.md and held to it by the text
// check (data-quote-of). Then each reader's pieces, with a line on what they give, and the glossary for everyone.
// The landing page carries no label, chip or legend; each reader's badge is a small inline icon.
const READER_ICONS = {
  marketing: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
  ae: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M3 13h18"/>',
  se: '<path d="M8 8l-4 4l4 4"/><path d="M16 8l4 4l-4 4"/><path d="M14 4l-4 16"/>',
};
const READERS = [
  { key: 'marketing', reader: 'For marketing',
    gives: 'The story in pictures, the capabilities as pillars, the reasons customers choose it, the words to use and never to use, and a guided tour of one sample store, step by step.',
    links: [['/what-it-is', 'What it is'], ['/see-it-work', 'See it work']] },
  { key: 'ae', reader: 'For account executives',
    gives: 'Seven scenes, the reasons customers choose it, what a customer can measure, the objections, what a customer provides, a battlecard on one sheet, where AI credits apply, and which demo shows which story.',
    links: [['/selling-it', 'Selling it'], ['/battlecard', 'Battlecard'], ['/credits', 'AI credits'], ['/demos', 'Demo map']] },
  { key: 'se', reader: 'For solutions engineers',
    gives: 'One visitor end to end, the arithmetic as worked examples, where it runs on Cloudflare, configuration, integration and privacy, and every constant on a slider.',
    links: [['/how-it-works', 'How it works'], ['/how-it-works-interactive', 'How it works, interactive']] },
];
const SPINE_HEADLINE = "We built an engine that follows each visitor's interest in real time and decides the page at that point in time.";
function renderLanding() {
  if (!read(SPINE_MD).includes(SPINE_HEADLINE)) throw new Error(`${SPINE_MD} no longer holds the headline the landing page quotes; update SPINE_HEADLINE`);
  const icon = (key) => `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${READER_ICONS[key]}</svg>`;
  const card = (r) => `<li class="card">
<span class="num" aria-hidden="true">${icon(r.key)}</span>
<h3>${esc(r.reader)}</h3>
<p class="card-gives">${esc(r.gives)}</p>
<ul class="card-links">${r.links.map(([href, text]) => `<li><a href="${href}">${esc(text)}</a></li>`).join('')}</ul>
</li>`;
  return `<div class="hero" data-landing="LANE-BRIEF-V3: the reader picks their audience">
<h1><span id="package-name">${NAME}</span></h1>
<p class="lede" data-quote-of="${SPINE_MD}">${esc(SPINE_HEADLINE)}</p>
<p class="signin">This site is for Optimizely employees; it opens with the passphrase shared with Optimizely staff.</p>
</div>
<h2 class="landing-h2">Each page is written for one reader</h2>
<ul class="cards">
${READERS.map(card).join('\n')}
</ul>
<h2 class="landing-h2">For everyone</h2>
<ul class="refs">
<li class="ref"><a href="/glossary">Glossary</a><p>One word for each meaning, defined once.</p></li>
</ul>`;
}

// ---------- build ----------

// LANE-BRIEF-V3: what-it-is, selling-it and how-it-works are hand-written pages (lanes M2, A1 and G1), and so are
// see-it-work (T1) and battlecard (A1); this builder writes none of them. It writes the demo map, the glossary, the
// credits page, the landing page and the not-found page, copies the figures, then stamps every page.
const PAGES = [
  { file: 'demos.html', url: '/demos', src: DEMOS_MD, title: 'Which demo shows which story', reader: 'For account executives', readerKey: 'ae' },
];

const where = path.relative(ROOT, OUT) || '.';
// A dry run is a whole site: everything in the served folder comes along first, the hand-written pages and their
// files included, so the stamp and the checks can run on DIR without touching enablement/site/.
if (path.resolve(OUT) !== path.resolve(SITE)) {
  fs.mkdirSync(OUT, { recursive: true });
  if (!NO_COPY) fs.cpSync(SITE, OUT, { recursive: true });
}
if (STAMP_ONLY) {
  // The page lanes run only the stamp, so it also brings the figure copies up to their sources, byte for byte: a
  // page that inlines a figure is checked against both. Only a copy that is missing or differs is written.
  fs.mkdirSync(path.join(OUT, 'figures'), { recursive: true });
  const copied = [];
  for (const f of fs.readdirSync(FIGURES).filter((n) => /^[a-z0-9-]+\.svg$/.test(n)).sort()) {
    const to = path.join(OUT, 'figures', f);
    const src = fs.readFileSync(path.join(FIGURES, f));
    if (!fs.existsSync(to) || !fs.readFileSync(to).equals(src)) { fs.writeFileSync(to, src); copied.push(`figures/${f}`); }
  }
  console.log(`render-pages --stamp: stamped ${where} from enablement/partials/:\n  ${stampFolder(OUT).join('\n  ')}`);
  console.log(`figure copies brought up to docs/enablement/figures/: ${copied.length ? copied.join(', ') : 'none needed'}`);
  console.log('\nNext: node enablement/render-check.mjs');
} else {
  fs.mkdirSync(path.join(OUT, 'figures'), { recursive: true });
  const written = [];
  const write = (rel, content) => { fs.writeFileSync(path.join(OUT, rel), content); written.push(`${rel} (${Buffer.byteLength(content)} bytes)`); };
  for (const f of fs.readdirSync(FIGURES).filter((n) => /^[a-z0-9-]+\.svg$/.test(n)).sort()) {
    fs.copyFileSync(path.join(FIGURES, f), path.join(OUT, 'figures', f));
    written.push(`figures/${f} (copied from docs/enablement/figures/)`);
  }
  for (const p of PAGES) {
    const { html } = renderPiece(read(p.src), p);
    const article = `<article class="piece" data-source="${[p.src, p.also].filter(Boolean).join(' ')}">\n${html}\n</article>`;
    write(p.file, pageHtml({ url: p.url, title: p.title, readerTag: p.reader, readerKey: p.readerKey, article, js: Boolean(p.js) }));
  }
  {
    const g = renderGlossary(read('docs/enablement/GLOSSARY.md'), { url: '/glossary' });
    write('glossary.html', pageHtml({ url: '/glossary', title: 'The glossary', readerTag: 'For everyone', readerKey: 'all', article: `<article class="piece piece-glossary" data-source="docs/enablement/GLOSSARY.md">\n${g.html}\n</article>` }));
    notes.push(`glossary: ${g.entries} entries under ${g.letters} letters`);
  }
  write('credits.html', pageHtml({ url: '/credits', title: 'Where Opal and AI Credits Fit, and Where They Never Do', readerTag: 'For account executives', readerKey: 'ae', article: renderCredits(), js: true }));
  write('index.html', pageHtml({ url: '/', title: 'All pages', article: renderLanding() }));
  write('404.html', notFoundHtml());
  console.log(`render-pages: wrote into ${where}:\n  ${written.join('\n  ')}`);
  if (notes.length) console.log(`notes:\n  ${notes.join('\n  ')}`);
  console.log(`\nthe stamp, from enablement/partials/:\n  ${stampFolder(OUT).join('\n  ')}`);
  console.log('\nNext: node enablement/render-check.mjs');
}

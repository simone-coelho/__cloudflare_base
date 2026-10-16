#!/usr/bin/env node
// enablement/render-check.mjs
// The text check for the enablement site: proves that each page says what its sources say, and nothing else.
// Lane P1, extended for LANE-BRIEF-V3 (sections 5 and 7) by lane S1.
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
//   the spine                   docs/enablement/content/spine.md, named first by what-it-is, the one page that keeps the
//                               full opening (LANE-BRIEF-V3 section 8.1): the page's spine is the block between its
//                               spine markers, which must equal the partial enablement/partials/spine.html; the
//                               partial itself is compared with spine.md in both directions, and the rest of the
//                               article with the page's own markdown
//   the band                    docs/enablement/content/spine-band.md, named first by selling-it and how-it-works
//                               (section 8.1): their band (between the band markers, equal to
//                               enablement/partials/spine-band.html) is compared with it in both directions, and so
//                               is the partial; see-it-work names no spine text and opens on the tour player
//   the short form              docs/enablement/content/spine-compact.md, the compact spine's own text of record,
//                               named first by the battlecard: the page's compact block (between the compact markers,
//                               equal to enablement/partials/spine-compact.html) is compared with it in both
//                               directions; the partial is compared with it in both directions too, and must say
//                               nothing spine.md does not say (reverse)
//   (the title line of spine.md and spine-compact.md names the file only and is not compared)
//   an HTML source              its visible text, plus the rows its own script draws, which it holds as JSON in
//                               <script type="application/json" id="tl-data"> (read with JSON.parse, never run)
//   a design document section   (path#anchor) the section's verbatim items must be on the page, and every page
//                               sentence must come from the section, compared without regard to case
//   the landing page            every element marked data-quote-of must say only what its named source says
//
// It also checks the chrome (the package name, the stamp, the footer line, the skip link), that no page shows a
// label, a chip or a legend and no inlined figure shows a label (LANE-BRIEF-V2), every inline figure against its
// file and every caption against its figure's title. It scans every page, and the sources lanes P1 and S1 write,
// for gendered pronouns, customer names, timing figures beyond V2's one fixed performance sentence, state words
// (V2 section 1: no build state, stage, "designed", "not yet", "open" or label) and the abbreviation kept out of
// visible text.
//
// LANE-BRIEF-V3 adds, each named in the report with the lane whose file it is:
//   - the stamped blocks: every page carries the header and footer markers; story first reads per page (section
//     8.1): what-it-is the full spine, selling-it and how-it-works the band, the battlecard the compact spine, and
//     see-it-work none, its first section after the title and one intro line being the tour player
//     (section.tour-player with data-visual), and from the reader tag to the player nothing but the stamp line, the
//     title and that line: no other element with text, no bare text, link, picture, drawn element, control, heading
//     or empty element (review round five, M5-3); each stamped block equals its partial after whitespace is collapsed,
//     with aria-current="page" on the page's own link and nowhere else; a page with no opening may leave out
//     /spine.css and /spine.js;
//   - the partials: each exists; the header links every page; the footer lists every piece with the title its own
//     source gives it and ends with the footer line; the spine addresses no one: no "you" or "your" outside a
//     quoted interface label (below);
//   - on the five hand-written pages (what-it-is, see-it-work, selling-it, battlecard, how-it-works): the article
//     names its spine's text of record and the page's markdown, in that order (spine.md, or spine-compact.md on the
//     battlecard), and opens with the stamped spine (no section or heading of the page before it); every <section>
//     holds a data-visual element; on the four that are not the engineers' page, every <section> also holds a
//     data-shot element; every ![caption](../figures/shot-<name>.png) line of the page's markdown has an element
//     with data-shot="<name>" on the page whose text contains the caption (a shot PNG not yet captured is listed,
//     never failed: lane W2 captures them); no "you" or "your" outside [data-reader], in the page or in the strings
//     its own script can write; no <p> (or other text block) over 60 words, 120 on how-it-works; no class name with
//     the part chip, label or legend; the page loads /spine.css, and /spine.js where it carries the full spine.
// The one exemption from the reader scan besides [data-reader] (the lead's ruling, 2026-10-03): an element carrying
// data-ui-label holds a quoted interface label addressed to the shopper, not the reader, such as a carousel's own
// title "Recommended for you" in a pictured page. Its text is left out of the reader scan, and only there: it is
// compared with its source like any text, scanned for everything else, and held to six words at most, so the mark
// can carry a label and never a sentence.
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
const STAMP = 'Updated October 3, 2026';
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
// Figures a ruling places on a page beyond what its markdown names; a page without one fails. LANE-BRIEF-V3 section
// 4.1 sets the marketing page's sections, and the session figure is not among them, so only the credits page keeps it.
const RULED_FIGURES = new Map([
  ['credits.html', ['before-during-after']],
]);
// Pages other lanes build, waiting for their notes before this check compares them: none. A page listed here and
// present without an <article data-source> fails, naming the lane it waits for.
const PENDING_PAGES = new Map();
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
  // The preflight's seen-text rules (check-site.mjs, section 4b), word for word, so the two agree on every page.
  /\btoday\b/i, /\b(?<!journey[\s-])(?<!\.)stages?\b/i, /\bdemo[\s-]+only\b/i, /\bgeneration\s+[12]\b/i,
  // Review round four, M4-9, the lead's list: a promise of later, a release word, and the label devices themselves.
  /\bcoming\s+soon\b/i, /\bbeta\b/i, /\bpreview\b/i, /\bpills?\b/i, /\bchips?\b/i,
];
// A whole element that reads only a label word is a label, wherever it sits (M4-9: a pill reading "Open" passed,
// because "Open" counts as a state word only before a full stop or a colon).
const LABEL_WORDS = new Set(['open', 'built', 'designed', 'coming soon', 'beta', 'preview']);
// The timing scan (V2 section 3, widened by M4-9): a figure in milliseconds or seconds, anywhere but the one fixed
// performance sentence; it stops speed claims. Minutes, hours and days are left out by the lead's ruling of
// 2026-10-03: a figure in minutes is an attribution window or a visit gap, never a decision speed. A four-digit
// number before "s" is a decade, not seconds, and is let through.
const TIMING = /\b(\d[\d,.]*)\s*(ms|milliseconds?|s|secs?|seconds?)\b/gi;
const isTiming = (m) => !(m[2].toLowerCase() === 's' && /^\d{4}$/.test(m[1]));
// The customer, prospect, vendor and competitor names, read from enablement/name-patterns.txt (M4-9), so the check
// names no one itself: each line a pattern matched as a whole word in any case, or, after "=", in its own case.
const NAME_FILE = join(root, 'enablement', 'name-patterns.txt');
const NAME_SCANS = (() => {
  if (!existsSync(NAME_FILE)) return null;
  const lines = readFileSync(NAME_FILE, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  const any = lines.filter((l) => !l.startsWith('='));
  const own = lines.filter((l) => l.startsWith('=')).map((l) => l.slice(1));
  return [any.length ? new RegExp(`\\b(?:${any.join('|')})\\b`, 'gi') : null, own.length ? new RegExp(`\\b(?:${own.join('|')})\\b`, 'g') : null].filter(Boolean);
})();
// Entries that name a retired state word to retire it, left out of the state-word scan (the coordinator's ruling of
// 2026-10-02, with the preflight lane): the glossary's own Stage entry.
const STATE_WORD_EXEMPT = new Map([['glossary.html', ['stage']]]);
const SPINE_MD = 'docs/enablement/content/spine.md';
const SPINE_COMPACT_MD = 'docs/enablement/content/spine-compact.md';
// The band, the one-strip opening of selling-it and how-it-works (LANE-BRIEF-V3 section 8.1).
const SPINE_BAND_MD = 'docs/enablement/content/spine-band.md';
// The texts of record of the two stamped spines, and the marker kind each belongs to.
const SPINE_TEXTS = new Map([[SPINE_MD, 'spine'], [SPINE_COMPACT_MD, 'compact'], [SPINE_BAND_MD, 'band']]);
const RECORD_OF_KIND = { spine: SPINE_MD, compact: SPINE_COMPACT_MD, band: SPINE_BAND_MD };
const KIND_NAME = { spine: 'the full spine', compact: 'the compact spine', band: 'the band' };
// Where each opening belongs (LANE-BRIEF-V3 section 8.1), for the failure that finds one elsewhere.
const KIND_HOME = { spine: 'only on what-it-is', compact: 'only on the battlecard', band: 'only on selling-it and how-it-works' };
// The sources lanes P1 and S1 write, scanned with the pages.
const OWN_SOURCES = ['docs/enablement/content/credits-source.html', 'docs/enablement/content/credits.md', 'docs/enablement/content/demos.md', SPINE_MD, SPINE_COMPACT_MD, SPINE_BAND_MD];

// ---------- LANE-BRIEF-V3: the hand-written pages, the partials, the markers ----------
// The five hand-written pages (section 5): the markdown each names after its opening's text of record, the opening it
// carries (section 8.1: the full spine and spine.md on what-it-is; the band and spine-band.md on selling-it and
// how-it-works; the compact spine and spine-compact.md on the battlecard; none on see-it-work, which opens on the tour
// player), its prose budget in words per text block, whether every section needs a shot (section 5, "Pictures for
// Word"), and the lane that writes it.
const HAND_WRITTEN = new Map([
  ['what-it-is.html', { md: 'docs/enablement/content/what-it-is.md', spine: 'spine', budget: 60, shots: true, lane: 'M2' }],
  ['see-it-work.html', { md: 'docs/enablement/content/see-it-work.md', spine: 'none', budget: 60, shots: true, lane: 'T1' }],
  ['selling-it.html', { md: 'docs/enablement/content/selling-it.md', spine: 'band', budget: 60, shots: true, lane: 'A1' }],
  ['battlecard.html', { md: 'docs/enablement/content/battlecard.md', spine: 'compact', budget: 60, shots: true, lane: 'A1' }],
  ['how-it-works.html', { md: 'docs/enablement/content/how-it-works-and-where-it-runs.md', spine: 'band', budget: 120, shots: false, lane: 'G1' }],
]);
// Whose file each finding is: a hand-written page's lane; how-it-works-interactive's page is H1's, its chrome S1's;
// everything else here (the builder's pages, the partials, spine.md, the checks) is S1's.
const laneOfFile = (f) => (HAND_WRITTEN.get(f) || {}).lane || (f === 'how-it-works-interactive.html' ? 'H1' : 'S1');
const PARTIALS_DIR = join(root, 'enablement', 'partials');
const MARKERS = [
  ['header', 'chrome:header:start', 'chrome:header:end', 'header.html'],
  ['spine', 'spine:start', 'spine:end', 'spine.html'],
  ['compact', 'spine:compact:start', 'spine:compact:end', 'spine-compact.html'],
  ['band', 'spine:band:start', 'spine:band:end', 'spine-band.html'],
  ['footer', 'chrome:footer:start', 'chrome:footer:end', 'footer.html'],
];
const markerPair = (a, b) => new RegExp(`<!--\\s*${a}\\s*-->([\\s\\S]*?)<!--\\s*${b}\\s*-->`, 'g');
const addressOf = (file) => (file === 'index.html' ? '/' : file === '404.html' ? null : `/${file.replace(/\.html$/, '')}`);
// A stamped block and its partial are compared with whitespace collapsed (between tags too), and with the page's
// aria-current="page" taken out; where that mark sits is checked on its own.
const collapse = (s) => s.replace(/\s+aria-current="page"/g, '').replace(/\s+/g, ' ').replace(/>\s+</g, '><').trim();
// The pieces the footer lists and the pages the header links, besides the landing page.
const SITE_PIECES = ['what-it-is', 'see-it-work', 'selling-it', 'battlecard', 'how-it-works', 'how-it-works-interactive', 'credits', 'glossary', 'demos'];
// Where each piece's title comes from: its markdown's "# Behavioral Targeting and Intelligence: <title>".
const TITLE_SOURCE = {
  'what-it-is': 'docs/enablement/content/what-it-is.md',
  'see-it-work': 'docs/enablement/content/see-it-work.md',
  'selling-it': 'docs/enablement/content/selling-it.md',
  battlecard: 'docs/enablement/content/battlecard.md',
  'how-it-works': 'docs/enablement/content/how-it-works-and-where-it-runs.md',
  'how-it-works-interactive': 'docs/enablement/content/how-it-works-interactive.md',
  credits: 'docs/enablement/content/credits.md',
  glossary: 'docs/enablement/GLOSSARY.md',
  demos: 'docs/enablement/content/demos.md',
};
// The reader scan (V3 section 5, rule 2 of section 1): "you" and "your" outside [data-reader], and their other forms.
const READER_WORDS = /\b(?:you|your|yours|yourself|yourselves)\b/gi;
// A quoted interface label addressed to the shopper (data-ui-label) is left out of the reader scan; it holds a label,
// at most this many words, never a sentence.
const UI_LABEL_WORDS = 6;
// The prose budget counts the text every block element holds itself, outside any block inside it: paragraphs,
// headings, list items, cells, figures, sections and the rest, so text in a heading or in a span inside a figure is
// counted too (M4-9). Preformatted code is not prose and is left out. Each text element of an inline SVG counts too.
const PROSE_BLOCKS = new Set([...['p', 'li', 'dd', 'dt', 'td', 'th', 'blockquote', 'figcaption', 'summary', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'figure', 'section', 'article', 'aside', 'header', 'footer', 'nav', 'main', 'details', 'caption', 'address', 'button', 'dl', 'ul', 'ol', 'table', 'tbody', 'thead', 'tfoot', 'tr', 'body']]);
// Class names with these parts are refused on the hand-written pages (V3 section 5), plurals included (M4-9);
// chip and legend, singular or plural, everywhere.
const REFUSED_CLASS_PARTS = /(?:^|[-_])(?:chips?|labels?|legends?)(?:$|[-_])/i;
// A data-visual element must draw (M4-9): it is, or holds, an svg, a table, an img or a figure, or holds an element
// with no text of its own that the stylesheet draws (a bar, a box, a dot). A div of text alone is not a visual.
const DRAWN_TAGS = new Set(['svg', 'table', 'img', 'figure']);
const NOT_A_DRAWING = new Set(['br', 'wbr', 'hr', 'script', 'style', 'template', 'meta', 'link', 'source', 'title', 'desc']);
// data-reader (M4-9) sits only on leaf blocks: an element with no block element inside it, never a section, the
// article or any container; and no more than half of a hand-written page's words sit under it.
const READER_SHARE = 0.5;
const SHOT_LINE = /^!\[([^\]]*)\]\(\.\.\/figures\/shot-([a-z0-9-]+)\.png\)\s*$/;

// ---------- HTML: a small tokenizer and tree, enough for these pages ----------
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', middot: '·', mdash: '—', ndash: '–', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', hellip: '…', rarr: '→', larr: '←', uarr: '↑', darr: '↓', times: '×', minus: '−', bull: '•',
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
const norm = (s) => s.normalize('NFC').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
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
// spine.md's title line names the file only (LANE-BRIEF-V3 section 3): pages show their own h1, so it is not compared.
const recordMarkdown = (src) => read(join(root, src)).split('\n').filter((l) => !/^#\s/.test(l)).join('\n');

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

// ---------- V3 helpers ----------
// What a reader sees or hears on a page outside [data-reader]: text (inline SVG included), the accessible names
// and descriptions of elements, and the document title; comments, scripts and styles are not shown. An element
// with data-ui-label (a quoted interface label addressed to the shopper, the lead's ruling of 2026-10-03) is left
// out too, and only here.
const HEARD_ATTRS = ['aria-label', 'aria-description', 'aria-roledescription', 'aria-valuetext', 'title', 'alt', 'placeholder'];
function outsideReader(node) {
  const out = [];
  (function walk(n) {
    if (n.comment !== undefined) return;
    if (n.text !== undefined) { out.push(n.text); return; }
    if (n.tag === 'script' || n.tag === 'style') return;
    if (n.attrs && ('data-reader' in n.attrs || 'data-ui-label' in n.attrs)) return;
    for (const k of HEARD_ATTRS) if (n.attrs && n.attrs[k]) out.push(` ${n.attrs[k]} `);
    (n.children || []).forEach((c) => { if (c.tag && BLOCK.has(c.tag)) out.push(' '); walk(c); if (c.tag && BLOCK.has(c.tag)) out.push(' '); });
  })(node);
  return norm(out.join(''));
}
// The text a block element holds itself, leaving out the block elements inside it and any SVG, script or style.
function ownText(node) {
  let s = '';
  for (const c of node.children || []) {
    if (c.comment !== undefined) continue;
    if (c.text !== undefined) { s += c.text; continue; }
    if (BLOCK.has(c.tag) || c.tag === 'svg' || c.tag === 'script' || c.tag === 'style') { s += ' '; continue; }
    s += c.tag === 'br' ? ' ' : ownText(c);
  }
  return s;
}
const wordCount = (s) => norm(s).split(' ').filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
// Does a data-visual element draw? It is, or holds, an svg, a table, an img or a figure; or it, or an element inside
// it, holds no text at all (a shape the stylesheet draws). Script, style and line breaks are not drawings.
function drawsSomething(node) {
  if (DRAWN_TAGS.has(node.tag) || find(node, (n) => DRAWN_TAGS.has(n.tag)).length) return true;
  return find(node, (n) => !NOT_A_DRAWING.has(n.tag) && !norm(textOf(n))).length > 0;
}
// A leaf block holds no block element inside it.
const isLeafBlock = (node) => !(node.children || []).some((c) => c.tag && (BLOCK.has(c.tag) || find(c, (n) => BLOCK.has(n.tag)).length));
// The prose budget over a subtree: every block element's own text, and every text element of an inline SVG; code in
// <pre> is not prose.
function budgetHits(rootNode, budget) {
  const hits = [];
  (function walk(n) {
    if (!n.tag || n.tag === 'pre' || n.tag === 'script' || n.tag === 'style' || n.tag === 'template') return;
    if (n.tag === 'svg') {
      for (const t of find(n, (x) => x.tag === 'text')) { const w = wordCount(textOf(t)); if (w > budget) hits.push({ tag: 'svg text', cls: '', words: w, text: norm(textOf(t)) }); }
      return;
    }
    if (PROSE_BLOCKS.has(n.tag)) { const w = wordCount(ownText(n)); if (w > budget) hits.push({ tag: n.tag, cls: n.attrs.class || '', words: w, text: norm(ownText(n)) }); }
    (n.children || []).forEach(walk);
  })(rootNode);
  return hits;
}
// Elements that read nothing but a label word, innermost only.
const labelElements = (rootNode) => find(rootNode, (n) => {
  if (n.tag === 'script' || n.tag === 'style' || n.tag === 'svg' || n.tag === 'title') return false;
  const own = norm(blocksOf({ tag: '#root', attrs: {}, children: [n] }).join(' ')).toLowerCase().replace(/[.:]$/, '');
  if (!LABEL_WORDS.has(own)) return false;
  return !(n.children || []).some((c) => c.tag && norm(blocksOf({ tag: '#root', attrs: {}, children: [c] }).join(' ')).toLowerCase().replace(/[.:]$/, '') === own);
});
const hasAttrInside = (node, attr) => (node.attrs && attr in node.attrs) || find(node, (n) => attr in n.attrs).length > 0;
const classTokens = (n) => ((n.attrs && n.attrs.class) || '').split(/\s+/).filter(Boolean);
const where = (text, index, len) => text.slice(Math.max(0, index - 30), index + len + 30);
// The strings a script can put on a page, read the way the preflight reads them (check-site.mjs, section 4b):
// comments removed, and a string that is one token with code punctuation (a class name, a selector, a path, a key)
// skipped as code.
const CODE_TOKEN = /^[\w$]*[-.#[\]/:][\w$.#[\]/:-]*$/;
const scriptStrings = (js) => {
  const code = js.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:\\'"`])\/\/[^\n]*/g, (all, keep) => keep);
  return [...code.matchAll(/'((?:\\.|[^'\\\n])*)'|"((?:\\.|[^"\\\n])*)"|`((?:\\.|[^`\\])*)`/g)]
    .map((m) => m[1] ?? m[2] ?? (m[3] || '').replace(/\$\{[^}]*\}/g, ' '))
    .filter((x) => !CODE_TOKEN.test(x.trim()))
    .join(' \n ');
};

// ---------- the checks ----------
const problems = [];
const notes = [];
const rows = [];
const allowedLog = [];
// Each finding is filed under the lane whose file it is: given, or read from the file name the finding starts with.
const fail = (what, lane) => {
  let l = lane;
  if (!l) {
    const m = /^(?:scan, [^:]+: )?(?:enablement\/site\/)?([a-z0-9-]+\.html)\b/.exec(what);
    l = m ? laneOfFile(m[1]) : 'S1';
  }
  problems.push({ lane: l, what });
};
const design = read(join(root, 'docs', 'enablement', 'BTI-Enablement-Design.md'));
const designPara = (id) => { const m = new RegExp(`^\\| ${id} \\| (.+?) \\| `, 'm').exec(design); return m ? norm(mdInline(m[1])) : null; };

// The partials, checked once; the stamped copies on the pages are then held to them.
const partials = {};
for (const [kind, , , source] of MARKERS) {
  const p = join(PARTIALS_DIR, source);
  if (!existsSync(p)) { fail(`enablement/partials/${source} does not exist`, 'S1'); continue; }
  partials[kind] = read(p).trim();
}
const partialTree = (kind) => parseHtml(partials[kind] || '');
const partialRows = [];
if (partials.header) {
  const hrefs = find(partialTree('header'), (n) => n.tag === 'a' && n.attrs.href !== undefined).map((a) => a.attrs.href);
  for (const want of ['#main', '/', ...SITE_PIECES.map((p) => `/${p}`)]) if (!hrefs.includes(want)) fail(`enablement/partials/header.html: no link to ${want}`, 'S1');
  if (/aria-current/.test(partials.header)) fail('enablement/partials/header.html: carries aria-current itself; the stamp adds it per page', 'S1');
  if (!norm(blocksOf(partialTree('header')).join(' ')).includes('Skip to the page')) fail('enablement/partials/header.html: no skip link "Skip to the page"', 'S1');
}
if (partials.footer) {
  const tree = partialTree('footer');
  const links = find(tree, (n) => n.tag === 'a' && n.attrs.href !== undefined);
  for (const piece of SITE_PIECES) {
    const a = links.find((x) => x.attrs.href === `/${piece}`);
    if (!a) { fail(`enablement/partials/footer.html: no entry for /${piece}`, 'S1'); continue; }
    const shown = norm(textOf(find(a, (n) => /\bpieces-name\b/.test(n.attrs.class || ''))[0] || a));
    const src = join(root, TITLE_SOURCE[piece]);
    if (!existsSync(src)) { notes.push(`footer: /${piece} is listed as "${shown}"; its source ${TITLE_SOURCE[piece]} is not written yet`); continue; }
    const m = new RegExp(`^# ${NAME}: (.+)$`, 'm').exec(read(src));
    const want = m ? mdInline(m[1].charAt(0).toUpperCase() + m[1].slice(1)) : null;
    if (want && want !== shown) fail(`enablement/partials/footer.html: /${piece} is listed as "${shown}", but its source titles it "${want}"`, 'S1');
  }
  if (/aria-current/.test(partials.footer)) fail('enablement/partials/footer.html: carries aria-current itself; the stamp adds it per page', 'S1');
  const words = blocksOf(tree);
  if (words[words.length - 1] !== FOOTLINE) fail(`enablement/partials/footer.html: does not end with "${FOOTLINE}"`, 'S1');
}
// The two spines' texts of record, read once; their title lines name the files only and are not compared.
const recordBlocks = (src) => {
  if (!existsSync(join(root, src))) { fail(`${src} does not exist`, 'S1'); return []; }
  try { return mdBlocks(recordMarkdown(src), notes, src); } catch (e) { fail(`${src} could not be read: ${e.message}`, 'S1'); return []; }
};
const recordOf = new Map([[SPINE_MD, recordBlocks(SPINE_MD)], [SPINE_COMPACT_MD, recordBlocks(SPINE_COMPACT_MD)], [SPINE_BAND_MD, recordBlocks(SPINE_BAND_MD)]]);
// An element marked data-ui-label holds a quoted interface label of a few words, never a sentence.
const checkUiLabels = (tree, label, lane) => {
  for (const n of find(tree, (x) => 'data-ui-label' in x.attrs)) {
    const w = wordCount(textOf(n));
    if (w > UI_LABEL_WORDS) fail(`${label}: an element with data-ui-label holds ${w} words; the mark is for a quoted interface label of at most ${UI_LABEL_WORDS} words, never a sentence`, lane);
  }
};
// The partials against the texts of record: the spine with spine.md in both directions; the short form with
// spine-compact.md in both directions, and with spine.md in reverse (it says nothing the spine does not say); the band
// with spine-band.md in both directions (section 8.1).
for (const [kind, name, record, both] of [['spine', 'spine.html', SPINE_MD, true], ['compact', 'spine-compact.html', SPINE_COMPACT_MD, true], ['compact', 'spine-compact.html', SPINE_MD, false], ['band', 'spine-band.html', SPINE_BAND_MD, true]]) {
  if (!partials[kind]) continue;
  const tree = partialTree(kind);
  const marked = [];
  const own = blocksOf(tree, (k, n) => marked.push({ kind: k, why: n.attrs[k] || k, text: norm(blocksOf(n).join(' ')) }));
  const r = compare(recordOf.get(record), blocksOf(tree), own);
  const short = record.split('/').pop();
  if (both) for (const s of r.missing) fail(`enablement/partials/${name}: a sentence of ${short} is missing from it: "${s}"`, 'S1');
  for (const s of r.extra) fail(`enablement/partials/${name}: a sentence is not in ${short} and is not marked as an addition: "${s}"`, 'S1');
  partialRows.push([`partials/${name}`, both ? short : `${short}, reverse`, both ? String(r.srcCount) : '-', both ? String(r.missing.length) : '-', String(r.pageCount), String(r.extra.length), String(marked.length)]);
  if (both) for (const a of marked) allowedLog.push(`partials/${name}: ${a.kind}${a.why && a.why !== a.kind ? ` (${a.why})` : ''}: "${a.text}"`);
}
// The partials' own rules: a visual in every section; no "you" outside a quoted interface label (the spine addresses
// no one); every data-ui-label short; the prose budget; no refused class part.
for (const [kind, name] of [['spine', 'spine.html'], ['compact', 'spine-compact.html'], ['band', 'spine-band.html']]) {
  if (!partials[kind]) continue;
  const tree = partialTree(kind);
  for (const sec of find(tree, (n) => n.tag === 'section')) if (!hasAttrInside(sec, 'data-visual')) fail(`enablement/partials/${name}: a <section> without a data-visual element`, 'S1');
  for (const v of find(tree, (n) => 'data-visual' in n.attrs)) if (!drawsSomething(v)) fail(`enablement/partials/${name}: the data-visual element "${v.attrs['data-visual'] || v.tag}" holds only text; a visual is, or holds, an svg, a table, an img, a figure or a drawn element`, 'S1');
  const heard = outsideReader({ tag: '#root', attrs: {}, children: tree.children });
  for (const m of heard.matchAll(READER_WORDS)) fail(`enablement/partials/${name}: "${m[0]}" in the spine ("${where(heard, m.index, m[0].length)}"); the spine addresses no one`, 'S1');
  if (find(tree, (n) => 'data-reader' in n.attrs).length) fail(`enablement/partials/${name}: carries data-reader; the spine speaks to no one as reader`, 'S1');
  checkUiLabels(tree, `enablement/partials/${name}`, 'S1');
  for (const h of budgetHits(tree, 60)) fail(`enablement/partials/${name}: a <${h.tag}> of ${h.words} words, over the budget of 60`, 'S1');
  for (const n of find(tree, (x) => classTokens(x).some((c) => REFUSED_CLASS_PARTS.test(c)))) fail(`enablement/partials/${name}: the class "${classTokens(n).join(' ')}" uses a refused part (chip, label or legend)`, 'S1');
  for (const n of labelElements(tree)) fail(`enablement/partials/${name}: an element reads only the label word "${norm(textOf(n))}"`, 'S1');
}
// The spines' own pictures for Word: each needs its data-shot element in its partial, holding its caption.
const shotLines = (md) => md.split('\n').map((l) => SHOT_LINE.exec(l)).filter(Boolean).map((m) => ({ caption: mdInline(m[1]), name: m[2] }));
const missingPngs = new Set();
const checkShots = (lines, tree, label, lane) => {
  for (const s of lines) {
    const els = find(tree, (n) => n.attrs['data-shot'] === s.name);
    if (!els.length) fail(`${label}: the markdown's picture shot-${s.name}.png has no element with data-shot="${s.name}"${find(tree, (n) => n.attrs['data-shot'] === `shot-${s.name}`).length ? ` (the page has data-shot="shot-${s.name}"; LANE-BRIEF-V3 section 5 pairs data-shot="<name>" with shot-<name>.png, so the value drops the shot- prefix)` : ''}`, lane);
    else if (!els.some((e) => norm(textOf(e)).includes(s.caption))) fail(`${label}: the element with data-shot="${s.name}" does not show its caption "${s.caption}"`, lane);
    if (!existsSync(join(root, 'docs', 'enablement', 'figures', `shot-${s.name}.png`))) missingPngs.add(`shot-${s.name}.png`);
  }
};
const spineShots = existsSync(join(root, SPINE_MD)) ? shotLines(read(join(root, SPINE_MD))) : [];
const compactShots = existsSync(join(root, SPINE_COMPACT_MD)) ? shotLines(read(join(root, SPINE_COMPACT_MD))) : [];
if (partials.spine) checkShots(spineShots, partialTree('spine'), 'enablement/partials/spine.html', 'S1');
if (partials.compact) checkShots(compactShots, partialTree('compact'), 'enablement/partials/spine-compact.html', 'S1');
const bandShots = existsSync(join(root, SPINE_BAND_MD)) ? shotLines(read(join(root, SPINE_BAND_MD))) : [];
if (partials.band) checkShots(bandShots, partialTree('band'), 'enablement/partials/spine-band.html', 'S1');
const SHOTS_OF_KIND = { spine: spineShots, compact: compactShots, band: bandShots, none: [] };

// The tour's opening (LANE-BRIEF-V3 sections 8.1 and 8.2 item 1; review round five, M5-3). From the reader tag to the
// player, in document order, the page holds only the stamp line beside the reader tag, the article's title, one intro
// line, and plain wrappers (div, header, hgroup) that hold them. Everything else is reported: an element with text
// (hidden or not, since a script may show it), bare text, a link, a picture, a drawn element, a control, a heading, a
// second line, any other element, and an empty one, which only a stylesheet could draw. Script, style, template,
// link, meta and line breaks render nothing and pass. Inside the title and the intro line only phrasing elements that
// hold text, and line breaks, may appear.
const LINK_TAGS = new Set(['a', 'area']);
const PICTURE_TAGS = new Set(['img', 'svg', 'picture', 'figure', 'canvas', 'video', 'audio', 'iframe', 'object', 'embed', 'math']);
const CONTROL_TAGS = new Set(['button', 'input', 'select', 'textarea', 'output', 'meter', 'progress']);
const INERT_TAGS = new Set(['script', 'style', 'template', 'link', 'meta', 'br', 'wbr']);
const PHRASING_TAGS = new Set(['span', 'b', 'strong', 'i', 'em', 'small', 'abbr', 'cite', 'code', 'kbd', 'mark', 'q', 's', 'samp', 'sub', 'sup', 'time', 'u', 'var', 'dfn', 'bdi', 'bdo', 'data']);
const WRAPPER_TAGS = new Set(['div', 'header', 'hgroup']);
function tourOpening(tree, art, player) {
  const found = [];
  const say = (what) => { if (!found.includes(what)) found.push(what); };
  const tagOf = (n) => `<${n.tag}${n.attrs.class ? ` class="${n.attrs.class}"` : ''}>`;
  const quote = (s) => `"${s.length > 48 ? `${s.slice(0, 48)}...` : s}"`;
  const pictureOf = (n) => PICTURE_TAGS.has(n.tag) || n.attrs.role === 'img';
  const drawn = (n) => ['data-visual', 'data-shot'].find((a) => a in n.attrs);
  const reader = find(tree, (n) => classTokens(n).includes('reader-tag'))[0];
  const meta = reader ? find(tree, (n) => (n.children || []).includes(reader))[0] : null;
  let phase = 'before';
  let title = null;
  let intro = null;
  let stamp = null;
  let lines = 0;
  // inside the title or the intro line
  const phrasing = (n, where) => {
    for (const c of n.children || []) {
      if (!c.tag || INERT_TAGS.has(c.tag)) continue;
      if (LINK_TAGS.has(c.tag)) say(`a link (${tagOf(c)}) in the ${where}`);
      else if (pictureOf(c) || drawn(c)) say(`a picture (${tagOf(c)}) in the ${where}`);
      else if (!PHRASING_TAGS.has(c.tag)) say(`a ${tagOf(c)} in the ${where}`);
      else if (!norm(textOf(c))) say(`an empty ${tagOf(c)} in the ${where}, which only a stylesheet could draw`);
      else phrasing(c, where);
    }
  };
  const walk = (n, inArticle) => {
    if (phase === 'done' || n.comment !== undefined) return;
    if (n === player) { phase = 'done'; return; }
    if (n.text !== undefined) { if (phase === 'in' && norm(n.text)) say(`bare text ${quote(norm(n.text))}`); return; }
    if (n === reader) { phase = 'in'; return; }
    if (phase === 'before' && n !== art) { for (const c of n.children || []) walk(c, false); return; }
    phase = 'in';
    if (n === art) { for (const c of n.children) walk(c, true); return; }
    if (INERT_TAGS.has(n.tag)) return;
    if (LINK_TAGS.has(n.tag)) { say(`a link (${tagOf(n)})`); return; }
    if (pictureOf(n)) { say(`a picture (${tagOf(n)})`); return; }
    if (drawn(n)) { say(`a drawn element (${tagOf(n)} with ${drawn(n)})`); return; }
    if (CONTROL_TAGS.has(n.tag)) { say(`a control (${tagOf(n)})`); return; }
    if (!stamp && meta && meta.children.includes(n) && n.tag === 'p' && classTokens(n).includes('stamp') && /^Updated\b/.test(norm(textOf(n)))) { stamp = n; return; }
    if (inArticle && n.tag === 'h1' && !title && !intro) { title = n; phrasing(n, 'title'); return; }
    if (/^h[1-6]$/.test(n.tag)) { say(`a heading (${tagOf(n)})`); return; }
    if (inArticle && n.tag === 'p' && title && !intro && norm(textOf(n))) { intro = n; lines = 1; phrasing(n, 'intro line'); return; }
    if (n.tag === 'p' && intro) { lines += 1; return; }
    if (!WRAPPER_TAGS.has(n.tag)) { const text = norm(textOf(n)); say(text ? `a ${tagOf(n)} with text ${quote(text)}` : `an empty ${tagOf(n)}, which only a stylesheet could draw`); return; }
    const own = norm((n.children || []).filter((c) => c.text !== undefined).map((c) => c.text).join(' '));
    if (own) { say(`a ${tagOf(n)} with text ${quote(own)}`); return; }
    const was = [title, intro, found.length, lines];
    for (const c of n.children || []) walk(c, inArticle);
    if (phase !== 'done' && title === was[0] && intro === was[1] && found.length === was[2] && lines === was[3]) say(`an empty ${tagOf(n)}, which only a stylesheet could draw`);
  };
  walk(tree, false);
  if (lines > 1) found.unshift(`${lines} paragraphs`);
  return found;
}

// The stamped blocks on one page: present where required, equal to the partial, aria-current on the page's own link.
function checkStamped(file, html) {
  const hw = HAND_WRITTEN.get(file);
  const want = new Set(['header', 'footer']);
  if (hw && hw.spine !== 'none') want.add(hw.spine);
  const address = addressOf(file);
  const lane = hw ? hw.lane : 'S1';
  const found = {};
  for (const [kind, a, b] of MARKERS) {
    const hits = [...html.matchAll(markerPair(a, b))];
    if (hits.length > 1) { fail(`${file}: the ${kind} markers appear ${hits.length} times`, lane); continue; }
    if (!hits.length) {
      if (want.has(kind)) fail(`${file}: no ${kind === 'compact' ? 'spine:compact' : kind === 'band' ? 'spine:band' : kind === 'spine' ? 'spine' : `chrome:${kind}`} markers; run node enablement/render-pages.mjs --stamp after writing them`, lane);
      continue;
    }
    if (!want.has(kind)) fail(`${file}: carries the ${kind} markers, which belong ${KIND_HOME[kind] || 'elsewhere'} (LANE-BRIEF-V3 section 8.1)`, lane);
    const inner = hits[0][1];
    found[kind] = { inner, index: hits[0].index, length: hits[0][0].length };
    if (!partials[kind]) continue;
    if (!inner.trim()) { fail(`${file}: the ${kind} markers are empty; run node enablement/render-pages.mjs --stamp`, lane); continue; }
    if (collapse(inner) !== collapse(partials[kind])) fail(`${file}: the stamped ${kind} block differs from enablement/partials/${MARKERS.find((x) => x[0] === kind)[3]}; run node enablement/render-pages.mjs --stamp`, lane);
    if (kind === 'header' || kind === 'footer') {
      const linked = find(parseHtml(partials[kind]), (n) => n.tag === 'a' && n.attrs.href === address).length > 0;
      const current = [...inner.matchAll(/<a href="([^"]*)" aria-current="page">/g)].map((m) => m[1]);
      const strays = (inner.match(/aria-current=/g) || []).length;
      const ok = linked ? current.length === 1 && current[0] === address && strays === 1 : strays === 0;
      if (!ok) fail(`${file}: in the stamped ${kind}, aria-current="page" must mark ${linked ? `the link to ${address} and nothing else` : 'nothing'} (found ${current.join(', ') || 'none'}${strays !== current.length ? ', and another form' : ''})`, lane);
    }
  }
  return found;
}

const pages = readdirSync(siteDir).filter((f) => f.endsWith('.html')).sort();
for (const [f, hw] of HAND_WRITTEN) if (!pages.includes(f)) fail(`${f}: missing from the served folder (lane ${hw.lane}, LANE-BRIEF-V3 section 4)`, hw.lane);
const pageText = {};
const heardText = {};
const readerHits = [];
for (const file of pages) {
  const html = read(join(siteDir, file));
  const tree = parseHtml(html);
  const body = find(tree, (n) => n.tag === 'body')[0];
  if (!body) { fail(`${file}: no <body>`); continue; }

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
  const heardOf = (b) => {
    const heard = [norm(blocksOf(b).join(' '))];
    for (const svg of find(b, (n) => n.tag === 'svg')) heard.push(textOf(svg));
    for (const n of find(b, (x) => x.attrs && (x.attrs['aria-label'] || x.attrs.title || x.attrs.alt))) heard.push(n.attrs['aria-label'] || n.attrs.title || n.attrs.alt);
    return norm(heard.join(' '));
  };
  heardText[file] = heardOf(body);
  // The glossary's own entry for a retired state word names it, to retire it: that entry alone is left out of the
  // state-word scan, on a separate copy of the page, so every other check still reads it.
  if (STATE_WORD_EXEMPT.has(file)) {
    const copy = find(parseHtml(read(join(siteDir, file))), (n) => n.tag === 'body')[0];
    for (const id of STATE_WORD_EXEMPT.get(file)) {
      const entries = find(copy, (n) => n.attrs.id === id);
      if (!entries.length) fail(`${file}: the entry #${id} that the state-word scan leaves out is missing`);
      for (const e of entries) e.children = [];
      notes.push(`${file}: the entry #${id} names the retired word, to retire it; left out of the state-word scan`);
    }
    heardText[file] = heardOf(copy);
  }

  // the chrome every page carries
  if (!visible.includes('Skip to the page')) fail(`${file}: no skip link`);
  if (!visible.includes(FOOTLINE)) fail(`${file}: no footer line "${FOOTLINE}"`);
  // V3: the stamped header, footer and spine
  const stamped = checkStamped(file, html);
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
  if (stamps.length !== 1 || norm(textOf(stamps[0])) !== STAMP) fail(`${file}: the stamp must read "${STAMP}" exactly, once (found ${stamps.map((x) => `"${norm(textOf(x))}"`).join(', ') || 'none'})`, file === 'how-it-works-interactive.html' ? 'S1' : undefined);
  // No label, chip or legend anywhere (LANE-BRIEF-V2): none on the page, and none in a figure it inlines.
  const chipped = find(tree, (n) => /\b(?:chips?|legends?)\b/.test(n.attrs.class || '')).length;
  if (chipped) fail(`${file}: shows ${chipped} label chips or legends; LANE-BRIEF-V2 allows none`);
  const figureLabels = find(tree, (n) => n.tag === 'text' && /^(Built|Designed|Open)$/.test(norm(textOf(n))));
  if (figureLabels.length) fail(`${file}: an inlined figure shows ${figureLabels.length} labels (Built, Designed or Open); LANE-BRIEF-V2 allows none, so the figure needs its redraw`);
  for (const n of labelElements(body)) fail(`${file}: an element reads only the label word "${norm(textOf(n))}" (a label, a chip or a pill; LANE-BRIEF-V2 allows none)`);

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
    const figPath = join(root, 'docs', 'enablement', 'figures', `${name}.svg`);
    if (!existsSync(figPath)) { fail(`${file}: the figure ${name} has no file docs/enablement/figures/${name}.svg`); continue; }
    const want = read(figPath).trim();
    const copyPath = join(siteDir, 'figures', `${name}.svg`);
    const copy = existsSync(copyPath) ? read(copyPath).trim() : null;
    const at = html.search(new RegExp(`<figure\\b[^>]*data-figure="${name}"`));
    const inlineSvg = at >= 0 ? (/<svg\b[\s\S]*?<\/svg>/.exec(html.slice(at)) || [''])[0].trim() : '';
    if (inlineSvg !== want) fail(`${file}: the inline ${name}.svg differs from docs/enablement/figures/${name}.svg`);
    if (copy !== want) fail(`enablement/site/figures/${name}.svg differs from docs/enablement/figures/${name}.svg`, 'S1');
    const cap = find(fig, (n) => n.tag === 'figcaption')[0];
    if (!cap || norm(textOf(cap)) !== svgTitle(want)) fail(`${file}: the ${name} figure's caption is not its title "${svgTitle(want)}"`);
  }

  // V3: the hand-written pages' own rules
  const hw = HAND_WRITTEN.get(file);
  if (hw) {
    const lane = hw.lane;
    const sections = find(body, (n) => n.tag === 'section');
    for (const sec of sections) {
      const id = sec.attrs.id || sec.attrs['aria-labelledby'] || sec.attrs['aria-label'] || norm(textOf(find(sec, (n) => /^h[1-6]$/.test(n.tag))[0] || { text: '' })).slice(0, 50) || 'unnamed';
      if (!hasAttrInside(sec, 'data-visual')) fail(`${file}: the <section> "${id}" holds no data-visual element (LANE-BRIEF-V3 section 5: every section pairs a visual with short text)`, lane);
      if (hw.shots && !hasAttrInside(sec, 'data-shot')) fail(`${file}: the <section> "${id}" holds no data-shot element (LANE-BRIEF-V3 section 5: every visual section of this page has a shot)`, lane);
    }
    // every data-visual element draws (M4-9)
    for (const v of find(body, (n) => 'data-visual' in n.attrs)) if (!drawsSomething(v)) fail(`${file}: the data-visual element ${v.tag}${v.attrs.class ? `.${v.attrs.class.split(/\s+/).join('.')}` : ''} holds only text; a visual is, or holds, an svg, a table, an img, a figure or a drawn element (review round four, M4-9)`, lane);
    // data-reader only on leaf blocks, and over no more than half the page's words (M4-9)
    for (const r of find(body, (n) => 'data-reader' in n.attrs)) {
      if (['section', 'article', 'main', 'body'].includes(r.tag) || !isLeafBlock(r)) fail(`${file}: data-reader on a <${r.tag}${r.attrs.class ? ` class="${r.attrs.class}"` : ''}> that holds other blocks; only a leaf block (a paragraph, a heading, a list item or cell with no block inside) may carry it (review round four, M4-9)`, lane);
    }
    {
      const article0 = find(tree, (n) => n.tag === 'article' && 'data-source' in n.attrs)[0];
      if (article0) {
        const total = wordCount(blocksOf(article0).join(' '));
        const outermost = find(article0, (n) => 'data-reader' in n.attrs).filter((n, i, all) => !all.some((o) => o !== n && find(o, (x) => x === n).length));
        const under = outermost.reduce((s, n) => s + wordCount(blocksOf(n).join(' ')), 0);
        if (total && under / total > READER_SHARE) fail(`${file}: ${Math.round((100 * under) / total)}% of the article's words sit under data-reader; no more than half may (review round four, M4-9)`, lane);
      }
    }
    // the reader scan, on the page and on the strings its own script can write; a quoted interface label
    // (data-ui-label) is left out, and must stay a label
    const heard = outsideReader(tree);
    for (const m of heard.matchAll(READER_WORDS)) { fail(`${file}: "${m[0]}" outside [data-reader] ("${where(heard, m.index, m[0].length)}")`, lane); readerHits.push(file); }
    checkUiLabels(body, file, lane);
    const ownScript = join(siteDir, file.replace(/\.html$/, '.js'));
    if (existsSync(ownScript) && html.includes(`<script src="/${file.replace(/\.html$/, '.js')}" defer></script>`)) {
      const strings = norm(scriptStrings(read(ownScript)));
      for (const m of strings.matchAll(READER_WORDS)) { fail(`${file}: its script ${file.replace(/\.html$/, '.js')} can write "${m[0]}" ("${where(strings, m.index, m[0].length)}"); the check cannot see where, so a script's strings say neither "you" nor "your"`, lane); readerHits.push(file); }
    }
    // the prose budget: every block's own text, headings, figures and SVG text included (M4-9)
    for (const h of budgetHits(body, hw.budget)) fail(`${file}: a <${h.tag}${h.cls ? ` class="${h.cls}"` : ''}> of ${h.words} words, over the budget of ${hw.budget}: "${h.text.slice(0, 70)}..."`, lane);
    // class names
    for (const n of find(body, (x) => classTokens(x).some((c) => REFUSED_CLASS_PARTS.test(c)))) fail(`${file}: the class "${classTokens(n).join(' ')}" uses a refused part (chip, label or legend; LANE-BRIEF-V3 section 5)`, lane);
    // the spine's own files: a page with an opening loads /spine.css, and the full spine also /spine.js; a page with
    // none (see-it-work, section 8.1) may load them or not
    if (hw.spine !== 'none' && !html.includes('<link rel="stylesheet" href="/spine.css">')) fail(`${file}: does not load /spine.css, which ${KIND_NAME[hw.spine]} needs`, lane);
    if (hw.spine === 'spine' && !html.includes('<script src="/spine.js" defer></script>')) fail(`${file}: does not load /spine.js, which replays the spine's loop (LANE-BRIEF-V3 section 7.5)`, lane);
    // see-it-work opens on the tour (section 8.1 and 8.2): the article's first section is the player,
    // section.tour-player carrying data-visual, and from the reader tag to the player the page holds only the stamp
    // line, the article's title and one intro line (tourOpening; review round five, M5-3)
    if (hw.spine === 'none') {
      const art = find(tree, (n) => n.tag === 'article' && 'data-source' in n.attrs)[0];
      const player = art ? find(art, (n) => n.tag === 'section')[0] : null;
      if (!player || !classTokens(player).includes('tour-player') || !('data-visual' in player.attrs)) fail(`${file}: the article's first section must be the tour player, <section class="tour-player" data-visual> (LANE-BRIEF-V3 section 8.2)${player ? ` (found <section class="${player.attrs.class || ''}">)` : ' (found no section)'}`, lane);
      else {
        const found = tourOpening(tree, art, player);
        if (found.length) fail(`${file}: between the reader tag and the tour player the page holds only the stamp line, the article's title and one intro line, the only text above the player (LANE-BRIEF-V3 sections 8.1 and 8.2; review round five, M5-3); found ${found.join('; ')}`, lane);
      }
    }
    // pictures for Word
    if (existsSync(join(root, hw.md))) checkShots(shotLines(read(join(root, hw.md))), body, file, lane);
    else fail(`${file}: its markdown ${hw.md} does not exist`, lane);
    const shotNames = new Set([...(existsSync(join(root, hw.md)) ? shotLines(read(join(root, hw.md))) : []), ...(SHOTS_OF_KIND[hw.spine] || [])].map((s) => s.name));
    for (const el of find(body, (n) => n.attrs['data-shot'] !== undefined)) if (!shotNames.has(el.attrs['data-shot'])) notes.push(`${file}: data-shot="${el.attrs['data-shot']}" has no picture line in its markdown`);
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
      const md = read(join(root, el.attrs['data-rule-of']));
      let want = null;
      for (const line of md.split('\n')) { const m = /^(?:>\s*)?\*\*([^*]+)\*\*\s*$/.exec(line); if (m) { want = norm(m[1]); break; } }
      if (norm(textOf(el)) !== want) fail(`${file}: the card rule for ${el.attrs['data-rule-of']} is not that piece's rule ("${want}")`);
    }
    for (const el of find(tree, (n) => 'data-quote-of' in n.attrs)) {
      const src = el.attrs['data-quote-of'];
      if (!existsSync(join(root, src))) { fail(`${file}: its quoted source ${src} does not exist`); continue; }
      const hay = ` ${norm(mdInline(read(join(root, src))))} `;
      for (const q of sentences(norm(textOf(el)))) { checked++; if (!hay.includes(q.replace(/[.;:,]+$/, ''))) fail(`${file}: "${q}" is not in ${src}`); }
    }
    rows.push([file, 'landing', 'quotes of spine.md', String(checked), '0', '-', '-', '-']);
    continue;
  }
  const sourcesNamed = article.attrs['data-source'].split(/\s+/).filter(Boolean);
  let compareTree = article;
  const wantRecord = hw ? RECORD_OF_KIND[hw.spine] || null : null;
  const wantSources = hw ? [wantRecord, hw.md].filter(Boolean) : null;
  if (hw && sourcesNamed.join(' ') !== wantSources.join(' ')) fail(`${file}: the article must name data-source="${wantSources.join(' ')}" (LANE-BRIEF-V3 sections 5 and 8.1${hw.spine === 'compact' ? ', and the lead\'s ruling of 2026-10-03 giving the short form its own text of record' : ''}); it names "${sourcesNamed.join(' ')}"`);
  const namedSpine = sourcesNamed.find((s) => SPINE_TEXTS.has(s));
  if (namedSpine) {
    // The opening's block is held to its partial (checkStamped) and the partial to its text of record; when the page
    // names spine-compact.md or spine-band.md, its block is also compared with that text directly. The rest of the
    // article is compared with the page's own sources.
    const wantKind = SPINE_TEXTS.get(namedSpine);
    const kind = stamped[wantKind] ? wantKind : stamped.spine ? 'spine' : stamped.compact ? 'compact' : stamped.band ? 'band' : null;
    const a0 = html.search(/<article\b[^>]*\bdata-source=/);
    const a1 = html.lastIndexOf('</article>');
    if (!kind) fail(`${file}: names ${namedSpine} but carries no stamped opening`);
    else if (kind !== wantKind) fail(`${file}: names ${namedSpine} but carries ${KIND_NAME[kind]}, not ${KIND_NAME[wantKind]}`);
    else if (!(stamped[kind].index > a0 && stamped[kind].index < a1)) fail(`${file}: the spine markers must sit inside the <article>`);
    else {
      // Story first (LANE-BRIEF-V3 section 7.1): the spine opens the piece, so before it the article holds the title
      // and at most a line or two, never a section, a heading or a picture of the page's own (M4-9).
      const before = html.slice(a0, stamped[kind].index).replace(/<!--[\s\S]*?-->/g, '');
      if (/<(?:section|h[2-6]|figure|svg|img|table|picture|canvas|video)\b|\sdata-(?:visual|shot)\b/i.test(before)) fail(`${file}: the spine must open the article (LANE-BRIEF-V3 section 7.1); a section, heading or picture of the page comes before it`);
      const cut = html.slice(a0, stamped[kind].index) + html.slice(stamped[kind].index + stamped[kind].length, a1 + '</article>'.length);
      compareTree = find(parseHtml(cut), (n) => n.tag === 'article')[0] || article;
      const same = partials[kind] && collapse(stamped[kind].inner) === collapse(partials[kind]);
      if (namedSpine === SPINE_COMPACT_MD || namedSpine === SPINE_BAND_MD) {
        const short = namedSpine.split('/').pop();
        const name = kind === 'band' ? 'band' : 'compact block';
        const block = parseHtml(stamped[kind].inner);
        const r = compare(recordOf.get(namedSpine), blocksOf(block), blocksOf(block, () => {}));
        for (const s of r.missing) fail(`${file}: a sentence of ${short} is missing from the ${name}: "${s}"`);
        for (const s of r.extra) fail(`${file}: a sentence of the ${name} is not in ${short}: "${s}"`);
        rows.push([file, 'stamped', short, String(r.srcCount), String(r.missing.length), String(r.pageCount), String(r.extra.length), same ? '0' : 'differs']);
      } else rows.push([file, 'stamped', `spine.md (${kind === 'spine' ? 'full' : 'compact'})`, '-', same ? '0' : 'differs', '-', same ? '0' : 'differs', '-']);
    }
  }
  const allowed = [];
  const pageOwn = blocksOf(compareTree, (kind, n) => allowed.push({ kind, why: n.attrs[kind] || kind, text: norm(blocksOf(n).join(' ')) }));
  const pageAll = blocksOf(compareTree);
  for (const source of sourcesNamed) {
    const [srcPath, anchor] = source.split('#');
    if (SPINE_TEXTS.has(srcPath)) continue;
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
for (const p of missingPngs) notes.push(`${p} is not captured yet (lane W2 captures the shots from the built pages)`);

// ---------- the scans ----------
// The names come from enablement/name-patterns.txt, which the preflight reads too (check-site.mjs, section 4b), so the
// two agree word for word; a missing file fails rather than scanning nothing.
if (!NAME_SCANS || !NAME_SCANS.length) fail(`${NAME_FILE.replace(`${root}`, '').replace(/^[\\/]/, '').split('\\').join('/')} is missing or holds no pattern; the name scan cannot run`, 'S1');
const SCANS = [
  ['gendered pronouns', [/\b(she|her|hers|he|him|his)\b/gi]],
  ['customer, prospect, vendor and competitor names', NAME_SCANS || []],
  ['timing figures beyond the fixed performance sentence', [TIMING]],
];
const scanTexts = { ...pageText };
for (const s of OWN_SOURCES) if (existsSync(join(root, s))) scanTexts[s] = norm(read(join(root, s)).replace(/<style\b[\s\S]*?<\/style>/gi, ' '));
// A partial is scanned as a page is: its text, its comments and the attributes a reader hears, never its markup (an
// SVG path's numbers are not timing figures).
const scanTextOf = (node) => {
  const all = [];
  (function walk(n) {
    if (n.comment !== undefined) { all.push(n.comment); return; }
    if (n.text !== undefined) { all.push(n.text); return; }
    if (n.tag === 'script' || n.tag === 'style') return;
    for (const k of ['aria-label', 'title', 'alt', 'data-label', 'data-added', 'data-lead', 'content']) if (n.attrs && n.attrs[k]) all.push(` ${n.attrs[k]} `);
    (n.children || []).forEach(walk);
  })(node);
  return norm(all.join(' '));
};
for (const [kind, , , source] of MARKERS) if (partials[kind]) scanTexts[`enablement/partials/${source}`] = scanTextOf(partialTree(kind));
const heardTexts = { ...heardText };
for (const s of OWN_SOURCES) if (existsSync(join(root, s))) { try { heardTexts[s] = norm(s.endsWith('.html') ? htmlSource(join(root, s)).join(' ') : mdBlocks(read(join(root, s)), [], s).join(' ')); } catch (e) { fail(`scan: ${s} could not be read: ${e.message}`, 'S1'); } }
for (const [kind, , , source] of MARKERS) if (partials[kind]) { const t = partialTree(kind); heardTexts[`enablement/partials/${source}`] = norm(`${blocksOf(t).join(' ')} ${find(t, (n) => n.tag === 'svg').map(textOf).join(' ')}`); }
// The strings each served script can put on a page: the pronoun and state-word scans read them; customer names are
// scanned in the whole file below.
const scriptTexts = {};
for (const f of readdirSync(siteDir, { recursive: true }).map(String).filter((x) => /\.js$/.test(x)).sort()) scriptTexts[`enablement/site/${f.replace(/\\/g, '/')}`] = norm(scriptStrings(read(join(siteDir, f))));
const laneOfScan = (file) => { const m = /([a-z0-9-]+)\.(?:html|js|css)$/.exec(file); return m && HAND_WRITTEN.has(`${m[1]}.html`) ? HAND_WRITTEN.get(`${m[1]}.html`).lane : file.includes('how-it-works-interactive') ? 'H1' : 'S1'; };
const fixed = norm(FIXED_PERFORMANCE);
const scanRows = [];
for (const [label, patterns] of SCANS) {
  const hits = [];
  const texts = label === 'gendered pronouns' ? { ...scanTexts, ...scriptTexts } : scanTexts;
  for (const [file, raw] of Object.entries(texts)) {
    const text = label.startsWith('timing') ? raw.split(fixed).join(' ') : raw;
    for (const re of patterns) {
      re.lastIndex = 0;
      for (const m of text.matchAll(re)) {
        if (label.startsWith('timing') && !isTiming(m)) continue;
        hits.push([file, `${file}: "${text.slice(Math.max(0, m.index - 30), m.index + m[0].length + 30)}"`]);
      }
    }
  }
  scanRows.push(`${label}: ${hits.length}`);
  for (const [file, h] of hits) fail(`scan, ${label}: ${h}`, laneOfScan(file));
}
// State words (LANE-BRIEF-V2 §1), in what a reader sees or hears on each page and in the sources lanes P1 and S1 write.
{
  const hits = [];
  for (const [file, text] of Object.entries({ ...heardTexts, ...scriptTexts })) {
    for (const re of STATE_WORDS) {
      const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
      for (const m of text.matchAll(g)) hits.push([file, `${file}: "${text.slice(Math.max(0, m.index - 30), m.index + m[0].length + 30)}"`]);
    }
  }
  for (const src of OWN_SOURCES.filter((x) => x.endsWith('.html'))) {
    if (existsSync(join(root, src)) && /class=["'][^"']*\blbl\b/.test(read(join(root, src)))) hits.push([src, `${src}: a label element (class "lbl")`]);
  }
  scanRows.push(`state words: ${hits.length}`);
  for (const [file, h] of hits) fail(`scan, state words: ${h}`, laneOfScan(file));
}
// customer names in anything else that is served (the stylesheets, the scripts, the figure copies)
const served = readdirSync(siteDir, { recursive: true }).map(String).filter((f) => /\.(css|js|svg)$/.test(f));
for (const f of served) for (const re of NAME_SCANS || []) for (const m of read(join(siteDir, f)).matchAll(re)) fail(`scan, customer, prospect, vendor and competitor names: enablement/site/${f}: "${m[0]}"`, laneOfScan(f));
// The abbreviation the design keeps out of every piece's visible text (section 2); the site's host name carries
// it, so a link shows a page's title and never the address. Case-sensitive, visible text only.
{
  const hits = [];
  for (const file of pages) {
    const body = find(parseHtml(read(join(siteDir, file))), (n) => n.tag === 'body')[0];
    if (!body) continue;
    // The glossary's own entry for the deprecated word is the one place that names it, to retire it.
    if (file === 'glossary.html') for (const e of find(body, (n) => n.attrs.id === 'btie')) { e.children = []; notes.push('glossary.html: the entry #btie names the deprecated word, to retire it; left out of the abbreviation scan'); }
    const visibleText = norm(blocksOf(body).join(' '));
    for (const m of visibleText.matchAll(/\bBTIE?\b/g)) hits.push([file, `${file}: "${visibleText.slice(Math.max(0, m.index - 30), m.index + 34)}"`]);
  }
  scanRows.push(`the abbreviation in visible text: ${hits.length}`);
  for (const [file, h] of hits) fail(`scan, the abbreviation: ${h}`, laneOfFile(file));
}
scanRows.push(`"you" and "your" outside [data-reader] on the hand-written pages: ${readerHits.length}`);

// ---------- report ----------
const widths = [18, 12, 34, 9, 8, 9, 12, 9];
const line = (cells) => cells.map((c, i) => String(c).padEnd(widths[i])).join(' ');
console.log(`render-check: ${siteAt > 0 ? siteDir : 'enablement/site'} against its sources\n`);
console.log(line(['partial', '', 'compared with', 'source', 'missing', 'partial', 'unexplained', 'marked']));
console.log(line(['', '', '', 'sentences', '', 'sentences', '', 'additions']));
for (const r of partialRows) console.log(line([r[0], '', ...r.slice(1)]));
console.log('');
console.log(line(['page', 'mode', 'source', 'source', 'missing', 'page', 'unexplained', 'marked']));
console.log(line(['', '', '', 'sentences', '', 'sentences', '', 'additions']));
for (const r of rows) console.log(line(r));
console.log(`\nscans of ${Object.keys(scanTexts).length} files (every page, the sources lanes P1 and S1 write, and the partials), and of ${Object.keys(scriptTexts).length} served scripts' strings for pronouns and state words: ${scanRows.join('; ')}`);
if (verbose) { console.log('\nmarked additions, never compared:'); for (const l of allowedLog) console.log(`  ${l}`); }
else console.log(`marked additions: ${allowedLog.filter((l) => !l.startsWith('    ')).length} pages and partials carry some (--verbose lists each)`);
if (notes.length) { console.log('\nnotes:'); for (const n of [...new Set(notes)]) console.log(`  ${n}`); }
if (problems.length) {
  const byLane = {};
  for (const p of problems) byLane[p.lane] = (byLane[p.lane] || 0) + 1;
  console.log(`\n${problems.length} problem(s), by lane: ${Object.entries(byLane).sort().map(([l, n]) => `${l} ${n}`).join(', ')}`);
  for (const p of problems) console.log(`  FAIL [${p.lane}] ${p.what}`);
} else console.log('\nEvery page says what its sources say. All checks passed.');
// The verdict is the exit code, set without ending the process, so piped output is never cut short.
process.exitCode = problems.length ? 1 : 0;

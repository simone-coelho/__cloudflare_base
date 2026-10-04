#!/usr/bin/env node
// scripts/md2docx.mjs — markdown to a corporate Word document.
//
//   node scripts/md2docx.mjs in.md out.docx "Title" "Subtitle" \
//        "Prepared for" "Version" "Date" "Classification" [landscape]
//
// Pass "landscape" as the ninth argument for a wide matrix. Content width goes
// from 9360 to 12960 twips and every table is measured against the new width.
//
// The `docx` package is NOT a dependency of this repo, deliberately: adding it
// to package.json without regenerating package-lock.json breaks `npm ci`, which
// is what CI runs. Install it once, per machine, outside the repo:
//
//   npm install --prefix ~/.md2docx docx
//
// Resolution order is `docx` (repo or global), then $DOCX_MODULE, then
// ~/.md2docx. If none resolves, the script says exactly that and exits 2.
//
// ── What this produces ───────────────────────────────────────────────────────
// US Letter, 1in margins, Calibri body, a title page, a Word table of contents
// over the # and ## headings (pre-filled, each entry linked to its section,
// page numbers filled in by Word when it opens the file), a running header
// and a page footer.
// Supports: # to ##### headings, paragraphs, - and 1. lists (2-space nesting),
// | tables |, ``` fenced code, > callouts, --- rules, **bold**, *italic*,
// `code`, [text](url), and the two below: [text](#anchor) links within the
// document and ![caption](picture.png) figures.
//
// ── Links within the document ────────────────────────────────────────────────
// [text](#anchor) jumps to a heading at any level, # to #####. The anchor is the
// one GitHub gives that heading, so the same link also works on GitHub and in
// VS Code's preview. To write it: take the heading text as it reads (without
// its **, *, ` or link markup), lower-case it, delete every character that is
// not a letter, digit, underscore, hyphen or space, then make each space a
// hyphen. A repeated heading gets -1, then -2. "## 4. The walk — in brief" is
// #4-the-walk--in-brief: the dash goes and both its spaces stay. A link renders
// like any other, and Ctrl+Click follows it in Word, as in the contents. One to
// an anchor no heading has fails the build (rule 11).
//
// ── Figures ──────────────────────────────────────────────────────────────────
// ![caption](path) on a line of its own is a figure. The path is relative to the
// markdown file (write a space as %20) and the file must be a PNG or a JPEG,
// judged by its bytes, never its name. The picture is centred at the text width,
// 9360 twips (12960 landscape), its aspect ratio kept; one that would then be
// taller than 8in (5.5in landscape) is set that tall instead, so it never runs
// off the page. The caption prints beneath it in 9pt grey and stays on its page.
// A JPEG's EXIF rotation is ignored: save it upright. A missing or unreadable
// file fails the build (rule 11).
//
// ── Rules learned by getting them wrong ──────────────────────────────────────
// 1. NEVER put ASCII-art diagrams in markdown destined for Word. Anything over
//    roughly 90 characters wraps inside the code cell and the "diagram" becomes
//    rubble. Use a table instead. A rejected first draft was exactly this.
// 2. Keep every fenced code line at 76 characters or fewer. At Consolas 8.5pt
//    in a 6.2in column about 90 fit, so 76 leaves margin. Reflow JSON with
//    json.dumps(indent=2) and hand-wrap JavaScript.
// 3. Table columns get a per-column floor sized from the longest unbreakable
//    word, and the rounding drift lands on the WIDEST column. An earlier version
//    dumped drift on the last column and squeezed one to 0.2in.
// 4. Every row must sum to exactly the content width (9360 twips). Verify after
//    building; do not trust it.
// 5. Percentage table widths render wrong in some viewers. Always DXA.
// 6. Word holds an open file's lock: if a build fails with EACCES, the document
//    is open. Write a new version rather than fighting the lock.
// 7. Do not automate Word itself on the owner's machine. New-Object
//    Word.Application attaches to their RUNNING instance and Quit() would close
//    their open documents.
// 8. A bare Word contents FIELD stays empty until fields are updated, so a
//    reader saw no index; plain linked text instead was not a real contents and
//    did not behave like one. The contents is a real TOC field that carries a
//    pre-filled, linked entry per heading (so every viewer shows it), marked
//    dirty with updateFields on, so Word offers to fill in the page numbers
//    when the file opens. In Word, Ctrl+Click follows an entry.
// 9. Every numbered list restarts at 1 (its own numbering instance), and the
//    hanging indent is wide enough for "99." in bold. With one shared instance
//    a later list began at 11; with a 260-twip hang the two-digit number pushed
//    the first line to the next tab stop, so wrapped lines sat left of the text.
// 10. A link names the heading, never its position. The contents links to secN
//     bookmarks, and those renumber whenever a heading is added above, so a link
//     written against secN would land on the wrong section with no error. The
//     author writes the heading's anchor; the build maps it to the bookmark,
//     from one pass over the markdown, so a link may point forward or back.
// 11. A dead link is a failed build, never a document. A link to an anchor no
//     heading has, a figure whose file is missing or is not PNG or JPEG, and a
//     figure inside a line of text are each listed, with their text, and
//     nothing is written.
// 12. Every bookmark and every picture has its own id. docx's Bookmark writes
//     w:id="1" on every bookmark, and docPr id="1" on every picture unless told,
//     though ECMA-376 defines both as unique identifiers; the review of the built
//     documents caught every heading bookmark at w:id="1". The converter numbers
//     each bookmark's start and end pair itself, 1, 2, 3 ... in document order,
//     and gives each figure its own picture id. A heading carries at most one
//     bookmark: a link to a # or ## heading uses its secN, and a deeper heading
//     gets secN_M only when a link names it.
// 13. Two builds of one input differ in word/document.xml: docx names each
//     external link's relationship with a random id. To prove a change leaves a
//     document as it was, preload a seeded Math.random (node --import) for both
//     builds and compare the XML parts; only docProps/core.xml, which carries
//     the build time, still differs.
// 14. A link inside bold, **[text](url)**, is a bold link. The bold was matched
//     first, so its inside printed as literal markdown, address and all, with
//     no link. Now the text around the link stays bold and the link's own run
//     is bold too. And every heading keeps with the next paragraph, so a tall
//     figure can no longer leave its heading alone at the foot of a page.
// 15. A paragraph whose next block is a figure keeps with it, so a heading, its
//     one lead line and the picture travel together; rule 14 alone joined the
//     heading to the lead line, and the picture could still open the next page.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';

function loadDocx() {
  const candidates = [import.meta.url, process.env.DOCX_MODULE, homedir() + '/.md2docx/'].filter(Boolean);
  for (const base of candidates) {
    try { return createRequire(base)(process.env.DOCX_MODULE && base === process.env.DOCX_MODULE ? base : 'docx'); } catch { /* next */ }
  }
  console.error('md2docx: cannot resolve the `docx` package.\n\n  npm install --prefix ~/.md2docx docx\n\nThen re-run. Or set DOCX_MODULE to an installed copy.');
  process.exit(2);
}
const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, BorderStyle,
  Table, TableRow, TableCell, WidthType, ShadingType, PageBreak, BookmarkStart, BookmarkEnd, TableOfContents,
  Header, Footer, PageNumber, ExternalHyperlink, InternalHyperlink, ImageRun, LevelFormat, convertInchesToTwip, TabStopType, PageOrientation } = loadDocx();

const [, , IN, OUT, TITLE = 'Untitled', SUBTITLE = '', FOR = '', VERSION = '', DATED = '', CLASS = 'Confidential', ORIENT = ''] = process.argv;
const LANDSCAPE = /^landscape$/i.test(ORIENT);
if (!IN || !OUT) { console.error('usage: node scripts/md2docx.mjs in.md out.docx "Title" "Subtitle" "For" "Version" "Date" "Class"'); process.exit(2); }
const md = fs.readFileSync(IN, 'utf8');

const NAVY = '11142A', BLUE = '0B5CAD', GREY = '5A6472', RULE = 'C9D1DC';
const HEAD = 'E8EDF4', ZEBRA = 'F6F8FB', CODEBG = 'F3F5F8';
const BODY = 'Calibri', MONO = 'Consolas';
const W = LANDSCAPE ? 12960 : 9360;   // Letter minus 1in margins, in twips; 11in wide when landscape
const FIG_H = (LANDSCAPE ? 9360 : 12960) - 1440;   // tallest figure: the text height less an inch for its caption

const strip = (s) => s.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*]+)\*/g, '$1')
  .replace(/`([^`]+)`/g, '$1').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

// Links within the document: a heading's anchor is the one GitHub gives it (see the header).
const slugOf = (s) => s.trim().toLowerCase().replace(/[^\p{Alphabetic}\p{M}\p{Nd}\p{Pc} -]/gu, '').replace(/ /g, '-');
const anchorOf = (a) => { try { return decodeURIComponent(a); } catch { return a; } };

const lines = md.split('\n'), problems = [];   // rule 11: every broken link and figure, reported together
const problem = (msg, where) => {
  const at = typeof where === 'number' ? where : lines.findIndex((l) => l.includes(where)) + 1;
  problems.push(`${at ? `line ${at}: ` : ''}${msg}`);
  return [];
};

// Rule 10: one pass before any block is built gives every heading its anchor and
// its bookmark, and collects every anchor a link names (rule 12: only a deeper
// heading some link names gets a bookmark). It reads lines as the parser does:
// nothing inside ``` fences, and a heading is #{1,5} and a space.
function outline() {
  const heads = [], named = new Set(), seen = new Map();
  let fence = false, sec = 0, sub = 0;
  for (const l of lines) {
    if (/^```/.test(l)) { fence = !fence; continue; }
    if (fence) continue;
    const m = /^(#{1,5})\s+(.*)$/.exec(l);
    if (!m) { for (const a of l.matchAll(/\]\(#([^)]*)\)/g)) named.add(anchorOf(a[1])); continue; }
    const lvl = m[1].length, text = strip(m[2]), base = slugOf(text);
    let slug = base;
    while (seen.has(slug)) { seen.set(base, seen.get(base) + 1); slug = `${base}-${seen.get(base)}`; }   // GitHub: -1, -2, ...
    seen.set(slug, 0);
    if (lvl <= 2) { sec++; sub = 0; } else sub++;
    heads.push({ lvl, text, slug, mark: lvl <= 2 ? `sec${sec}` : `sec${sec}_${sub}` });
  }
  return { heads, named, bySlug: new Map(heads.map((h) => [h.slug, h])) };
}
const outlined = outline();

const linkRun = (text, extra = {}) => new TextRun({ text, font: BODY, size: 21, color: BLUE, underline: {}, ...extra });

// Rule 11: a link lands on the bookmark of the heading its anchor names, or the build fails.
function jump(text, href, extra) {
  const a = anchorOf(href.slice(1)), h = outlined.bySlug.get(a);
  if (!h) {
    const bare = (s) => s.toLowerCase().replace(/[^\p{Alphabetic}\p{M}\p{Nd}]/gu, '');
    const near = outlined.heads.find((x) => bare(x.slug) === bare(a));
    problem(`link "${text}" points to ${href}, but no heading has that anchor${near ? `; did you mean #${near.slug}?` : ''}`, `](${href})`);
  }
  return new InternalHyperlink({ anchor: h ? h.mark : a, children: [linkRun(text, extra)] });
}

function runs(text, opts = {}) {
  const out = [];
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  let last = 0, m;
  const push = (t, extra = {}) => { if (t) out.push(new TextRun({ text: t, font: BODY, size: 21, color: '1A1A1A', ...opts, ...extra })); };
  while ((m = re.exec(text))) {
    push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith('**')) {
      const inner = tok.slice(2, -2);
      if (/\[[^\]]+\]\([^)]+\)/.test(inner)) out.push(...runs(inner, { ...opts, bold: true }));   // rule 14: a link inside bold
      else push(inner, { bold: true });
    } else if (tok.startsWith('`')) out.push(new TextRun({ text: tok.slice(1, -1), font: MONO, size: 19, color: '0B3D63', ...opts }));
    else if (tok.startsWith('[')) {
      const q = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(tok), b = opts.bold ? { bold: true } : undefined;   // rule 14: bold only inside bold
      if (text[m.index - 1] === '!') problem(`figure "${q[1]}" must stand on a line of its own, outside lists, tables and callouts`, `![${q[1]}](`);
      out.push(q[2].startsWith('#') ? jump(q[1], q[2], b) : new ExternalHyperlink({ link: q[2], children: [linkRun(q[1], b)] }));
    } else push(tok.slice(1, -1), { italics: true });
    last = m.index + tok.length;
  }
  push(text.slice(last));
  return out.length ? out : [new TextRun({ text: '', font: BODY, size: 21 })];
}

const toc = [];   // rule 8: { lvl, text, id } for every # and ## heading, in order
let headAt = 0;   // rule 10: the outline's record of each heading, met in the same order
let marks = 0;    // rule 12: bookmark ids, 1, 2, 3 ... in document order
const heading = (lvl, txt) => {
  const h = outlined.heads[headAt++];
  if (!h || h.lvl !== lvl || h.text !== strip(txt)) throw new Error(`md2docx: the outline and the parser disagree at heading "${strip(txt)}"`);
  const run = new TextRun({ text: strip(txt), font: BODY, size: { 1: 30, 2: 25, 3: 22, 4: 21, 5: 20 }[lvl], bold: true, color: lvl === 2 ? BLUE : NAVY });
  const id = lvl <= 2 || outlined.named.has(h.slug) ? h.mark : null;   // rule 12: at most one bookmark per heading
  const n = id ? ++marks : 0;
  if (lvl <= 2) toc.push({ lvl, text: strip(txt), id });
  return new Paragraph({
    heading: [null, HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4, HeadingLevel.HEADING_5][lvl],
    pageBreakBefore: lvl === 1,
    keepNext: true,   // rule 14: a heading never ends a page apart from what follows it
    spacing: { before: lvl === 1 ? 0 : lvl === 2 ? 320 : 240, after: lvl <= 2 ? 160 : 100 },
    border: lvl === 1 ? { bottom: { style: BorderStyle.SINGLE, size: 12, color: BLUE, space: 6 } } : undefined,
    children: id ? [new BookmarkStart(id, n), run, new BookmarkEnd(n)] : [run],
  });
};

// Rule 8: a real TOC field, pre-filled with one linked entry per # and ## heading.
const contents = () => new TableOfContents('Contents', {
  hyperlink: true, headingStyleRange: '1-2', beginDirty: true,
  cachedEntries: toc.map(({ lvl, text, id }) => ({ title: text, level: lvl, href: id })),
});

const oneCell = (kids, fill, leftBar) => new Table({
  width: { size: W, type: WidthType.DXA }, columnWidths: [W],
  borders: {
    top: { style: BorderStyle.SINGLE, size: 4, color: RULE }, bottom: { style: BorderStyle.SINGLE, size: 4, color: RULE },
    left: { style: BorderStyle.SINGLE, size: leftBar, color: leftBar > 10 ? NAVY : BLUE }, right: { style: BorderStyle.SINGLE, size: 4, color: RULE },
    insideHorizontal: { style: BorderStyle.NONE }, insideVertical: { style: BorderStyle.NONE },
  },
  rows: [new TableRow({ children: [new TableCell({ width: { size: W, type: WidthType.DXA }, shading: { type: ShadingType.CLEAR, fill }, margins: { top: 100, bottom: 100, left: 140, right: 140 }, children: kids })] })],
});

const codeBlock = (ls) => oneCell(ls.map((l, i) => new Paragraph({
  children: [new TextRun({ text: l.replace(/\t/g, '  ') || ' ', font: MONO, size: 17, color: '13293D' })],
  spacing: { before: i ? 0 : 40, after: i === ls.length - 1 ? 40 : 0, line: 240 }, indent: { left: 120 },
})), CODEBG, 12);

const callout = (ls) => oneCell(ls.map((l, i) => new Paragraph({ children: runs(l), spacing: { before: i ? 0 : 40, after: 40, line: 264 } })), 'F7F9FC', 18);

function table(rows) {
  const cells = rows.map((r) => r.replace(/^\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim()));
  const hdr = cells[0], body = cells.slice(2), CH = 105;
  const col = (i) => [hdr[i], ...body.map((r) => strip(r[i] || ''))];
  const longestWord = (i) => Math.max(...col(i).flatMap((c) => c.split(/[\s/]+/).map((w) => w.length)), 2);
  const mass = hdr.map((_, i) => Math.max(6, col(i).reduce((a, c) => a + c.length, 0) / col(i).length));
  let floors = hdr.map((_, i) => Math.min(2600, Math.max(760, longestWord(i) * CH + 260)));   // rule 3
  let floorSum = floors.reduce((a, b) => a + b, 0);
  if (floorSum > W * 0.85) { const k = (W * 0.85) / floorSum; floors = floors.map((f) => Math.round(f * k)); floorSum = floors.reduce((a, b) => a + b, 0); }
  const spare = W - floorSum, massSum = mass.reduce((a, b) => a + b, 0);
  const widths = floors.map((f, i) => f + Math.round((mass[i] / massSum) * spare));
  widths[widths.indexOf(Math.max(...widths))] += W - widths.reduce((a, b) => a + b, 0);         // rule 3, rule 4
  const cell = (t, { head = false, zebra = false, w }) => new TableCell({
    width: { size: w, type: WidthType.DXA },
    shading: { type: ShadingType.CLEAR, fill: head ? HEAD : zebra ? ZEBRA : 'FFFFFF' },
    margins: { top: 70, bottom: 70, left: 110, right: 110 },
    children: t.split('<br>').map((x, i) => new Paragraph({
      spacing: { before: i ? 40 : 0, after: 0, line: 252 },
      children: head ? [new TextRun({ text: strip(x), font: BODY, size: 19, bold: true, color: NAVY })] : runs(x, { size: 19 }),
    })),
  });
  return new Table({
    width: { size: W, type: WidthType.DXA }, columnWidths: widths,
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: RULE }, bottom: { style: BorderStyle.SINGLE, size: 4, color: RULE },
      left: { style: BorderStyle.SINGLE, size: 4, color: RULE }, right: { style: BorderStyle.SINGLE, size: 4, color: RULE },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: RULE }, insideVertical: { style: BorderStyle.SINGLE, size: 2, color: RULE },
    },
    rows: [
      new TableRow({ tableHeader: true, children: hdr.map((h, i) => cell(h, { head: true, w: widths[i] })) }),
      ...body.map((r, ri) => new TableRow({ children: hdr.map((_, i) => cell(r[i] || '', { zebra: ri % 2 === 1, w: widths[i] })) })),
    ],
  });
}

// Figures (see the header): the picture's size in pixels, read from its own header; PNG or JPEG only.
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
function pixels(b) {
  if (b.length >= 24 && b.subarray(0, 8).equals(PNG) && b.toString('latin1', 12, 16) === 'IHDR') return { type: 'png', w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  if (b[0] !== 0xff || b[1] !== 0xd8) return null;
  for (let p = 2; p + 9 <= b.length;) {   // JPEG: walk the segments to the first frame header
    if (b[p] !== 0xff) return null;
    const m = b[p + 1];
    if (m === 0xff) p += 1;                                            // fill byte
    else if (m === 0x01 || (m >= 0xd0 && m <= 0xd8)) p += 2;           // a marker with no length
    else if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return { type: 'jpg', w: b.readUInt16BE(p + 7), h: b.readUInt16BE(p + 5) };
    else p += 2 + b.readUInt16BE(p + 2);
  }
  return null;
}

let figures = 0;   // rule 12: each picture gets its own docPr id
function figure(l, at) {
  const [, alt, src] = /^\s*!\[([^\]]*)\]\(([^)]+)\)\s*$/.exec(l);
  const caption = strip(alt).trim(), rel = anchorOf(src.trim());
  const fail = (msg) => problem(`figure "${caption || rel}": ${msg}`, at);
  if (/^[a-z][a-z0-9+.-]*:/i.test(rel) || path.isAbsolute(rel)) return fail(`${rel} is not a path relative to the markdown file`);
  const file = path.resolve(path.dirname(IN), rel);
  let data;
  try { data = fs.readFileSync(file); } catch (e) { return fail(`cannot read ${rel} (${e.code === 'ENOENT' ? 'no such file' : e.code}: ${file})`); }
  const px = pixels(data);
  if (!px || !px.w || !px.h) return fail(`${rel} is not a PNG or JPEG file`);
  let tw = W, th = (W * px.h) / px.w;                             // twips: the text width, aspect ratio kept,
  if (th > FIG_H) { tw = (FIG_H * px.w) / px.h; th = FIG_H; }     // unless that would run off the page
  if (!caption) console.warn(`md2docx: WARNING figure ${rel} has no alt text, so it has no caption and nothing for a screen reader`);
  const pic = new Paragraph({
    alignment: AlignmentType.CENTER, keepNext: Boolean(caption), spacing: { before: 120, after: caption ? 60 : 160, line: 240 },
    children: [new ImageRun({ type: px.type, data, transformation: { width: tw / 15, height: th / 15 }, altText: { id: ++figures, name: `Figure ${figures}`, description: caption || undefined } })],
  });
  if (!caption) return [pic];
  return [pic, new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 200 }, children: [new TextRun({ text: caption, font: BODY, size: 18, color: GREY })] })];
}

// ── parse ────────────────────────────────────────────────────────────────────
const kids = [];
let i = 0, wide = [], numberedLists = 0;
// Rule 15: is the next block after line `at` (past blank lines, which build nothing) a figure?
const beforeFigure = (at) => { let j = at + 1; while (j < lines.length && !lines[j].trim()) j++; return j < lines.length && /^\s*!\[[^\]]*\]\([^)]+\)\s*$/.test(lines[j]); };
while (i < lines.length) {
  const l = lines[i];
  if (/^```/.test(l)) {
    const buf = []; i++;
    while (i < lines.length && !/^```/.test(lines[i])) { if (lines[i].length > 76) wide.push(i + 1); buf.push(lines[i++]); }
    i++; kids.push(codeBlock(buf), new Paragraph({ text: '', spacing: { after: 120 } })); continue;
  }
  if (/^\|/.test(l)) { const buf = []; while (i < lines.length && /^\|/.test(lines[i])) buf.push(lines[i++]); if (buf.length >= 2) kids.push(table(buf), new Paragraph({ text: '', spacing: { after: 160 } })); continue; }
  if (/^>\s?/.test(l)) { const buf = []; while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, '')); kids.push(callout(buf.filter((x) => x.trim())), new Paragraph({ text: '', spacing: { after: 160 } })); continue; }
  if (/^(#{1,5})\s+/.test(l)) { const m = /^(#{1,5})\s+(.*)$/.exec(l); kids.push(heading(m[1].length, m[2])); i++; continue; }
  if (/^---+\s*$/.test(l)) { kids.push(new Paragraph({ spacing: { before: 80, after: 160 }, border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: RULE, space: 1 } }, children: [new TextRun({ text: '' })] })); i++; continue; }
  if (/^(\s*)([-*])\s+/.test(l)) {
    while (i < lines.length && /^(\s*)([-*])\s+/.test(lines[i])) { const m = /^(\s*)([-*])\s+(.*)$/.exec(lines[i]); kids.push(new Paragraph({ children: runs(m[3]), numbering: { reference: 'bullets', level: Math.min(2, Math.floor(m[1].length / 2)) }, spacing: { after: 60, line: 264 } })); i++; }
    kids.push(new Paragraph({ text: '', spacing: { after: 60 } })); continue;
  }
  if (/^(\s*)\d+\.\s+/.test(l)) {
    const instance = ++numberedLists;   // rule 9: every list restarts at 1
    while (i < lines.length && /^(\s*)\d+\.\s+/.test(lines[i])) { const m = /^(\s*)\d+\.\s+(.*)$/.exec(lines[i]); kids.push(new Paragraph({ children: runs(m[2]), numbering: { reference: 'numbers', level: Math.min(2, Math.floor(m[1].length / 3)), instance }, spacing: { after: 60, line: 264 } })); i++; }
    kids.push(new Paragraph({ text: '', spacing: { after: 60 } })); continue;
  }
  if (/^\s*!\[[^\]]*\]\([^)]+\)\s*$/.test(l)) { kids.push(...figure(l, i + 1)); i++; continue; }
  if (!l.trim()) { i++; continue; }
  kids.push(new Paragraph({ children: runs(l), ...(beforeFigure(i) ? { keepNext: true } : {}), spacing: { after: 120, line: 276 } })); i++;   // rule 15
}
if (wide.length) console.warn(`md2docx: WARNING rule 2 — ${wide.length} code line(s) over 76 chars will wrap: lines ${wide.slice(0, 8).join(', ')}`);
if (problems.length) {   // rule 11: nothing is written while a link or a figure is broken
  const list = [...new Set(problems)];
  console.error(`md2docx: ${OUT} NOT written; ${IN} has ${list.length} problem(s):\n${list.map((p) => `  ${p}`).join('\n')}`);
  process.exit(1);
}

const metaRow = (k, v) => new TableRow({
  children: [[2400, k], [W - 2400, v]].map(([w, t], j) => new TableCell({
    width: { size: w, type: WidthType.DXA },
    borders: { top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE } },
    margins: { top: 60, bottom: 60 },
    children: [new Paragraph({ children: [new TextRun({ text: t, font: BODY, size: 20, bold: j === 0, color: j === 0 ? GREY : '1A1A1A' })] })],
  })),
});

const front = [
  new Paragraph({ spacing: { before: 2600 }, children: [new TextRun({ text: 'OPTIMIZELY', font: BODY, size: 20, bold: true, color: BLUE, characterSpacing: 60 })] }),
  new Paragraph({ spacing: { before: 200, after: 80 }, border: { bottom: { style: BorderStyle.SINGLE, size: 18, color: BLUE, space: 10 } }, children: [new TextRun({ text: TITLE, font: BODY, size: 52, bold: true, color: NAVY })] }),
  new Paragraph({ spacing: { before: 200, after: 700 }, children: [new TextRun({ text: SUBTITLE, font: BODY, size: 26, color: GREY })] }),
  new Table({
    width: { size: W, type: WidthType.DXA }, columnWidths: [2400, W - 2400],
    borders: { top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE }, insideHorizontal: { style: BorderStyle.NONE }, insideVertical: { style: BorderStyle.NONE } },
    rows: [metaRow('Prepared for', FOR), metaRow('Prepared by', 'Optimizely'), metaRow('Version', VERSION), metaRow('Date', DATED), metaRow('Classification', CLASS)],
  }),
  new Paragraph({ children: [new PageBreak()] }),
  new Paragraph({ spacing: { after: 200 }, children: [new TextRun({ text: 'Contents', font: BODY, size: 30, bold: true, color: NAVY })] }),
  contents(),   // rule 8: pre-filled and linked; Word fills in the page numbers
  new Paragraph({ children: [new PageBreak()] }),
];

const doc = new Document({
  creator: 'Optimizely', title: TITLE, description: SUBTITLE,
  features: { updateFields: true },   // rule 8: Word fills in the contents' page numbers on open
  numbering: { config: [
    { reference: 'bullets', levels: [0, 1, 2].map((l) => ({ level: l, format: LevelFormat.BULLET, text: l === 0 ? '▪' : l === 1 ? '–' : '·', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 360 + l * 360, hanging: 240 } }, run: { color: l ? GREY : BLUE } } })) },
    // Rule 9: the number starts where a bullet does (120) and the hang fits "99." in bold.
    { reference: 'numbers', levels: [0, 1, 2].map((l) => ({ level: l, format: l === 1 ? LevelFormat.LOWER_LETTER : LevelFormat.DECIMAL, text: `%${l + 1}.`, alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 520 + l * 360, hanging: 400 } }, run: { bold: l === 0, color: NAVY } } })) },
  ] },
  styles: {
    default: { document: { run: { font: BODY, size: 21, color: '1A1A1A' }, paragraph: { spacing: { line: 276, after: 120 } } } },
    // Rule 8: Word's own contents styles, so the entries look the same before and after Word updates them.
    paragraphStyles: [
      { id: 'TOC1', name: 'toc 1', basedOn: 'Normal', next: 'Normal', run: { font: BODY, size: 22, bold: true, color: NAVY }, paragraph: { spacing: { before: 140, after: 40 } } },
      { id: 'TOC2', name: 'toc 2', basedOn: 'Normal', next: 'Normal', run: { font: BODY, size: 20, color: '1A1A1A' }, paragraph: { indent: { left: 360 }, spacing: { before: 0, after: 30 } } },
    ],
  },
  sections: [{
    properties: { page: { size: { width: 12240, height: 15840, orientation: LANDSCAPE ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT }, margin: { top: convertInchesToTwip(1), bottom: convertInchesToTwip(1), left: convertInchesToTwip(1), right: convertInchesToTwip(1) } }, titlePage: true },
    children: front.concat(kids),
    headers: { default: new Header({ children: [new Paragraph({ tabStops: [{ type: TabStopType.RIGHT, position: W }], border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: RULE, space: 4 } }, children: [new TextRun({ text: TITLE, font: BODY, size: 17, color: GREY }), new TextRun({ text: '\t' + CLASS, font: BODY, size: 17, color: GREY })] })] }), first: new Header({ children: [new Paragraph({ text: '' })] }) },
    footers: { default: new Footer({ children: [new Paragraph({ tabStops: [{ type: TabStopType.RIGHT, position: W }], children: [new TextRun({ text: [FOR, VERSION].filter(Boolean).join('  ·  '), font: BODY, size: 17, color: GREY }), new TextRun({ text: '\t', font: BODY, size: 17 }), new TextRun({ children: ['Page ', PageNumber.CURRENT, ' of ', PageNumber.TOTAL_PAGES], font: BODY, size: 17, color: GREY })] })] }), first: new Footer({ children: [new Paragraph({ text: '' })] }) },
  }],
});

fs.writeFileSync(OUT, await Packer.toBuffer(doc));
console.log(`md2docx: wrote ${OUT}, ${(fs.statSync(OUT).size / 1024).toFixed(0)} KB, ${kids.length} blocks from ${lines.length} markdown lines`);

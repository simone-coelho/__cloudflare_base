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
// US Letter, 1in margins, Calibri body, a title page, a contents field that
// updates itself when Word opens the file, a running header and a page footer.
// Supports: # to ##### headings, paragraphs, - and 1. lists (2-space nesting),
// | tables |, ``` fenced code, > callouts, --- rules, **bold**, *italic*,
// `code`, [text](url).
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
//    their open documents. The contents field self-updates, so there is no need.
import fs from 'node:fs';
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
  Table, TableRow, TableCell, WidthType, ShadingType, PageBreak, TableOfContents,
  Header, Footer, PageNumber, ExternalHyperlink, LevelFormat, convertInchesToTwip, TabStopType, PageOrientation } = loadDocx();

const [, , IN, OUT, TITLE = 'Untitled', SUBTITLE = '', FOR = '', VERSION = '', DATED = '', CLASS = 'Confidential', ORIENT = ''] = process.argv;
const LANDSCAPE = /^landscape$/i.test(ORIENT);
if (!IN || !OUT) { console.error('usage: node scripts/md2docx.mjs in.md out.docx "Title" "Subtitle" "For" "Version" "Date" "Class"'); process.exit(2); }
const md = fs.readFileSync(IN, 'utf8');

const NAVY = '11142A', BLUE = '0B5CAD', GREY = '5A6472', RULE = 'C9D1DC';
const HEAD = 'E8EDF4', ZEBRA = 'F6F8FB', CODEBG = 'F3F5F8';
const BODY = 'Calibri', MONO = 'Consolas';
const W = LANDSCAPE ? 12960 : 9360;   // Letter minus 1in margins, in twips; 11in wide when landscape

const strip = (s) => s.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*]+)\*/g, '$1')
  .replace(/`([^`]+)`/g, '$1').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

function runs(text, opts = {}) {
  const out = [];
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  let last = 0, m;
  const push = (t, extra = {}) => { if (t) out.push(new TextRun({ text: t, font: BODY, size: 21, color: '1A1A1A', ...opts, ...extra })); };
  while ((m = re.exec(text))) {
    push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith('**')) push(tok.slice(2, -2), { bold: true });
    else if (tok.startsWith('`')) out.push(new TextRun({ text: tok.slice(1, -1), font: MONO, size: 19, color: '0B3D63', ...opts }));
    else if (tok.startsWith('[')) {
      const q = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(tok);
      out.push(new ExternalHyperlink({ link: q[2], children: [new TextRun({ text: q[1], font: BODY, size: 21, color: BLUE, underline: {} })] }));
    } else push(tok.slice(1, -1), { italics: true });
    last = m.index + tok.length;
  }
  push(text.slice(last));
  return out.length ? out : [new TextRun({ text: '', font: BODY, size: 21 })];
}

const heading = (lvl, txt) => new Paragraph({
  heading: [null, HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4, HeadingLevel.HEADING_5][lvl],
  pageBreakBefore: lvl === 1,
  spacing: { before: lvl === 1 ? 0 : lvl === 2 ? 320 : 240, after: lvl <= 2 ? 160 : 100 },
  border: lvl === 1 ? { bottom: { style: BorderStyle.SINGLE, size: 12, color: BLUE, space: 6 } } : undefined,
  children: [new TextRun({ text: strip(txt), font: BODY, size: { 1: 30, 2: 25, 3: 22, 4: 21, 5: 20 }[lvl], bold: true, color: lvl === 2 ? BLUE : NAVY })],
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

// ── parse ────────────────────────────────────────────────────────────────────
const lines = md.split('\n'), kids = [];
let i = 0, wide = [];
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
    while (i < lines.length && /^(\s*)\d+\.\s+/.test(lines[i])) { const m = /^(\s*)\d+\.\s+(.*)$/.exec(lines[i]); kids.push(new Paragraph({ children: runs(m[2]), numbering: { reference: 'numbers', level: Math.min(2, Math.floor(m[1].length / 3)) }, spacing: { after: 60, line: 264 } })); i++; }
    kids.push(new Paragraph({ text: '', spacing: { after: 60 } })); continue;
  }
  if (!l.trim()) { i++; continue; }
  kids.push(new Paragraph({ children: runs(l), spacing: { after: 120, line: 276 } })); i++;
}
if (wide.length) console.warn(`md2docx: WARNING rule 2 — ${wide.length} code line(s) over 76 chars will wrap: lines ${wide.slice(0, 8).join(', ')}`);

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
  new TableOfContents('Contents', { hyperlink: true, headingStyleRange: '1-3' }),   // self-updates on open
  new Paragraph({ children: [new PageBreak()] }),
];

const doc = new Document({
  creator: 'Optimizely', title: TITLE, description: SUBTITLE,
  numbering: { config: [
    { reference: 'bullets', levels: [0, 1, 2].map((l) => ({ level: l, format: LevelFormat.BULLET, text: l === 0 ? '▪' : l === 1 ? '–' : '·', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 360 + l * 360, hanging: 240 } }, run: { color: l ? GREY : BLUE } } })) },
    { reference: 'numbers', levels: [0, 1, 2].map((l) => ({ level: l, format: l === 1 ? LevelFormat.LOWER_LETTER : LevelFormat.DECIMAL, text: `%${l + 1}.`, alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 360 + l * 360, hanging: 260 } }, run: { bold: l === 0, color: NAVY } } })) },
  ] },
  styles: { default: { document: { run: { font: BODY, size: 21, color: '1A1A1A' }, paragraph: { spacing: { line: 276, after: 120 } } } } },
  sections: [{
    properties: { page: { size: { width: 12240, height: 15840, orientation: LANDSCAPE ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT }, margin: { top: convertInchesToTwip(1), bottom: convertInchesToTwip(1), left: convertInchesToTwip(1), right: convertInchesToTwip(1) } }, titlePage: true },
    children: front.concat(kids),
    headers: { default: new Header({ children: [new Paragraph({ tabStops: [{ type: TabStopType.RIGHT, position: W }], border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: RULE, space: 4 } }, children: [new TextRun({ text: TITLE, font: BODY, size: 17, color: GREY }), new TextRun({ text: '\t' + CLASS, font: BODY, size: 17, color: GREY })] })] }), first: new Header({ children: [new Paragraph({ text: '' })] }) },
    footers: { default: new Footer({ children: [new Paragraph({ tabStops: [{ type: TabStopType.RIGHT, position: W }], children: [new TextRun({ text: [FOR, VERSION].filter(Boolean).join('  ·  '), font: BODY, size: 17, color: GREY }), new TextRun({ text: '\t', font: BODY, size: 17 }), new TextRun({ children: ['Page ', PageNumber.CURRENT, ' of ', PageNumber.TOTAL_PAGES], font: BODY, size: 17, color: GREY })] })] }), first: new Footer({ children: [new Paragraph({ text: '' })] }) },
  }],
});

fs.writeFileSync(OUT, await Packer.toBuffer(doc));
console.log(`md2docx: wrote ${OUT}, ${(fs.statSync(OUT).size / 1024).toFixed(0)} KB, ${kids.length} blocks from ${lines.length} markdown lines`);

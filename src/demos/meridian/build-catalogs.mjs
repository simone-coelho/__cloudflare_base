// Deterministic catalogue builder. Same input, same bytes, every run.
//
// Clothing and luxury goods — the categories this room actually sells. Every
// item carries a COLOUR IDENTITY, which is not decoration: it is what the eye
// follows when a row re-ranks. Sixteen swatches at two lightness levels,
// assigned round-robin, so a visible row of five almost never collides.
//
//   node src/demos/meridian/build-catalogs.mjs
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const HERE = dirname(fileURLToPath(import.meta.url));

// Sixteen identities: eight hues around the wheel, each at two lightness levels.
// Matched for saturation so none dominates a row.
const SWATCH = [
  // Saturated, not muted. A mid-tone accent on a white ground reads as a smudge
  // at projection distance; the reference demo pins its mark at #EF7A5E and its
  // signal at #D8322E, and these sit at that intensity. 16 identities, each
  // distinguishable from its neighbours in a five-card window.
  ['coral',    '#E8503A'], ['amber',    '#E8A317'], ['olive',    '#7CA82F'], ['teal',     '#12968C'],
  ['indigo',   '#4257C4'], ['plum',     '#9B45A0'], ['rose',     '#DB4079'], ['slate',    '#4E7AA8'],
  ['ember',    '#C8452B'], ['ochre',    '#C08A12'], ['moss',     '#6E9430'], ['pine',     '#12786E'],
  ['navy',     '#2F52A8'], ['mulberry', '#7E3A80'], ['garnet',   '#B8355F'], ['steel',    '#3F6389'],
];

// line | piece | category | material | price | styleWorld | occasions
//
// THE LINE LEADS THE NAME (decision D3, 2026-08-28). A line is a family the way
// Coach's "Tabby" is a family — Drover is heritage outerwear, Linden is
// structured leather bags — and `name` is composed as `${line} ${piece}` so the
// family reads first on every card. The PIECE keeps its type noun (coat, tote,
// loafer): packshots in public/meridian/img are keyed by id and depict the
// type, so a coat must stay a coat. Ten lines over forty pieces, every line
// three or more, so each clears the audience-generation floor. Row ORDER is
// the id, and the swatch is assigned by index — do not reorder rows.
//
// Line is the NARROW dimension. Subcategory is MATERIAL and stays on the record
// for the card's display string ("Outerwear · wool"); it is no longer a
// dimension. (Material was chosen over shape originally because shape gave 26
// values over 38 items and cleared the floor on none — the same floor every
// line is sized to clear.)
const RETAIL = [
  ['Linden',    'Leather Crossbody',  'Bags','leather',248,'heritage',['everyday','work']],
  ['Linden',    'Saddle Bag',         'Bags','leather',195,'heritage',['everyday','gift']],
  ['Linden',    'Structured Tote',    'Bags','leather',320,'modern',['work','everyday']],
  ['Linden',    'Evening Clutch',     'Bags','leather',195,'statement',['evening','gift']],
  ['Holloway',  'Packable Tote',      'Bags','canvas',88,'minimal',['travel','everyday']],
  ['Holloway',  'Weekender',          'Bags','canvas',385,'heritage',['travel']],
  ['Drover',    'Wool Coat',          'Outerwear','wool',420,'heritage',['work','evening']],
  ['Drover',    'Waxed Field Jacket', 'Outerwear','canvas',298,'heritage',['everyday','travel']],
  ['Shorewell', 'Trench',             'Outerwear','technical',545,'modern',['work','evening']],
  ['Shorewell', 'Rain Shell',         'Outerwear','technical',186,'minimal',['travel','everyday']],
  ['Shorewell', 'Liner Vest',         'Outerwear','technical',165,'minimal',['everyday']],
  ['Fenwick',   'Fisherman Sweater',  'Knitwear','wool',165,'heritage',['everyday','gift']],
  ['Fenwick',   'Merino Crew',        'Knitwear','wool',128,'minimal',['everyday','work']],
  ['Fenwick',   'Lambswool Vest',     'Knitwear','wool',95,'minimal',['work']],
  ['Fenwick',   'Turtleneck',         'Knitwear','cashmere',285,'modern',['work','evening']],
  ['Fenwick',   'Wrap Cardigan',      'Knitwear','cashmere',240,'modern',['everyday','gift']],
  ['Ridgeline', 'Chelsea Boot',       'Footwear','leather',320,'heritage',['everyday','work']],
  ['Ridgeline', 'Suede Derby',        'Footwear','leather',240,'heritage',['work']],
  ['Ridgeline', 'Calfskin Loafer',    'Footwear','leather',275,'modern',['work','evening']],
  ['Ridgeline', 'Court Heel',         'Footwear','leather',295,'statement',['evening']],
  ['Holloway',  'Court Sneaker',      'Footwear','canvas',110,'minimal',['everyday','travel']],
  ['Halden',    'Pave Drop Earrings', 'Jewellery','metal',395,'statement',['evening','gift']],
  ['Halden',    'Onyx Cufflinks',     'Jewellery','metal',145,'statement',['gift','evening']],
  ['Halden',    'Fine Curb Chain',    'Jewellery','metal',320,'modern',['everyday','gift']],
  ['Halden',    'Signet Ring',        'Jewellery','metal',210,'heritage',['everyday','gift']],
  ['Halden',    'Slim Bangle',        'Jewellery','metal',165,'minimal',['everyday','gift']],
  ['Solstice',  'Smoked Vetiver',     'Fragrance','glass',175,'statement',['evening','gift']],
  ['Solstice',  'Amber Absolute',     'Fragrance','glass',215,'statement',['evening','gift']],
  ['Solstice',  'Fig & Neroli',       'Fragrance','glass',130,'minimal',['everyday','gift']],
  ['Solstice',  'Bergamot & Cedar',   'Fragrance','glass',145,'modern',['gift','everyday']],
  ['Harlow',    'Acetate Aviator',    'Eyewear','acetate',215,'heritage',['travel','everyday']],
  ['Harlow',    'Oversized Shield',   'Eyewear','acetate',265,'statement',['travel','evening']],
  ['Harlow',    'Tortoise Reader',    'Eyewear','acetate',120,'modern',['work']],
  ['Harlow',    'Round Wire Frame',   'Eyewear','metal',185,'minimal',['everyday']],
  ['Drover',    'Wool Check Muffler', 'Scarves','wool',95,'heritage',['everyday','gift']],
  ['Fenwick',   'Lambswool Scarf',    'Scarves','wool',58,'minimal',['everyday','gift']],
  ['Aster',     'Silk Twill Square',  'Scarves','silk',165,'statement',['evening','gift']],
  ['Aster',     'Silk Twill Oblong',  'Scarves','silk',195,'modern',['evening','gift']],
  ['Aster',     'Silk Bandana',       'Scarves','silk',85,'statement',['everyday','gift']],
  ['Aster',     'Cashmere Wrap',      'Scarves','cashmere',245,'modern',['travel','gift']],
];

/** A card wraps past this; the design sheet was approved at two lines of name. */
const MAX_NAME = 26;
/** The audience-generation floor: a line with fewer pieces can never mint an audience. */
const MIN_PER_LINE = 3;

const FINANCIAL = [
  ['30-Year Fixed Mortgage','Mortgage','fixed',385000,'building',['borrow'],6.24],
  ['15-Year Fixed Mortgage','Mortgage','fixed',310000,'established',['borrow','refinance'],5.61],
  ['7/1 Adjustable Mortgage','Mortgage','variable',420000,'building',['borrow'],5.89],
  ['Home Equity Line','Mortgage','variable',75000,'established',['borrow','refinance'],7.15],
  ['Renovation Loan','Mortgage','variable',65000,'established',['borrow','refinance'],7.02],
  ['New Auto Loan','Auto','fixed',34000,'building',['borrow'],5.44],
  ['Used Auto Loan','Auto','fixed',21000,'starting-out',['borrow'],6.32],
  ['Auto Refinance','Auto','fixed',18500,'building',['refinance','save'],5.19],
  ['Platinum Rewards Card','Card','revolving',12000,'established',['borrow','protect'],null],
  ['Everyday Cashback Card','Card','revolving',6000,'building',['borrow','save'],null],
  ['Secured Starter Card','Card','revolving',1000,'starting-out',['borrow','protect'],null],
  ['Voyager Travel Card','Card','revolving',15000,'established',['borrow'],null],
  ['Personal Line of Credit','Card','variable',20000,'building',['borrow','protect'],9.15],
  ['High-Yield Savings','Savings','deposit',18000,'building',['save'],4.35],
  ['12-Month Certificate','Savings','deposit',25000,'planning',['save','protect'],4.70],
  ['Money Market Account','Savings','deposit',42000,'established',['save','protect'],4.10],
  ['Self-Directed Brokerage','Investing','managed',60000,'established',['invest'],null],
  ['Roth Retirement Account','Investing','managed',48000,'planning',['invest','protect'],null],
  ['Managed Portfolio','Investing','managed',120000,'planning',['invest','protect'],null],
];

const BLOCKS = [
  ['retail','How a Field Jacket Earns Its Wax','Made at Calder','video','Outerwear','heritage',['everyday'],['block_a','block_b']],
  ['retail','Five Ways to Wear One Scarf','The Edit','editorial','Scarves','statement',['gift','evening'],['block_a','block_b']],
  ['retail','Sizing a Signet, Properly','Guide','guide','Jewellery','heritage',['gift'],['block_a','block_b']],
  ['retail','The Weekender, Packed Three Ways','Travel Notes','editorial','Bags','modern',['travel'],['block_a','block_b']],
  ['retail','Cashmere, and How to Keep It','Care','guide','Knitwear','modern',['everyday'],['block_a','block_b']],
  ['retail','This Season in Outerwear','New Arrivals','on-model','Outerwear','modern',['work','evening'],['block_a','block_b','hero']],
  ['financial','What Your Rate Actually Costs','Rate Explainer','explainer','Mortgage','building',['borrow'],['block_a','block_b']],
  ['financial','Refinance Break-Even Calculator','Run the Numbers','calculator','Mortgage','established',['refinance'],['block_a','block_b','hero']],
  ['financial','Today’s Savings Rates','Rates','rate-table','Savings','building',['save'],['block_a','block_b']],
  ['financial','Your First Card, Explained','Getting Started','guide','Card','starting-out',['borrow','protect'],['block_a','block_b']],
  ['financial','Retirement in Four Decisions','Planning','explainer','Investing','planning',['invest'],['block_a','block_b']],
  ['financial','Buying Your First Car','Guide','guide','Auto','starting-out',['borrow'],['block_a','block_b']],
];

const cap = (s) => s[0].toUpperCase() + s.slice(1);

const items = RETAIL.map(([line, piece, category, subcategory, value_usd, world, needs], i) => {
  const id = `MRD-R${String(i + 1).padStart(3, '0')}`;
  const [swatch, hex] = SWATCH[i % SWATCH.length];
  const name = `${line} ${piece}`;
  return {
    id, vertical: 'retail', name, line, category, subcategory, value_usd, world, needs,
    available: true, swatch, hex,
    blurb: `${name} — ${subcategory}, from the ${line} line. ${cap(world)} in spirit.`,
    image: `/meridian/img/${id}.jpg`,
  };
});

// Fail here, not on stage. A line under the floor is an audience that can never
// be minted; a name over the limit is a card that wraps onto a third line.
{
  const perLine = {};
  for (const it of items) (perLine[it.line] ??= []).push(it.name);
  for (const [line, names] of Object.entries(perLine)) {
    if (names.length < MIN_PER_LINE) {
      throw new Error(`line "${line}" has ${names.length} piece(s); a line needs ${MIN_PER_LINE} to clear the audience floor`);
    }
  }
  for (const it of items) {
    if (it.name.length > MAX_NAME) throw new Error(`"${it.name}" is ${it.name.length} chars; the card holds ${MAX_NAME}`);
  }
}

const fin = FINANCIAL.map(([name, category, subcategory, value_usd, world, needs, rate_pct], i) => {
  const id = `MRD-F${String(i + 1).padStart(3, '0')}`;
  const [swatch, hex] = SWATCH[i % SWATCH.length];
  return {
    id, vertical: 'financial', name, category, subcategory, value_usd, world, needs,
    available: true, swatch, hex, ...(rate_pct == null ? {} : { rate_pct }),
    blurb: `${name} — ${subcategory} ${category.toLowerCase()}.`,
    image: `/meridian/img/${id}.jpg`,
  };
});

const blocks = BLOCKS.map(([vertical, title, kicker, contentType, category, world, needs, slots], i) => ({
  id: `MRD-B${String(i + 1).padStart(3, '0')}`, vertical, title, kicker, contentType,
  category, world, needs, slots, body: `${kicker}: ${title}.`,
}));

// Byte-stable on purpose: non-ASCII is \u-escaped and there is no trailing
// newline, which is exactly how the committed files are laid out — so a fresh
// run reproduces them byte for byte, and any diff in a catalogue is a real one.
const escapeNonAscii = (s) => s.replace(/[\u007f-\uffff]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
const write = (f, o) => writeFileSync(join(HERE, f), escapeNonAscii(JSON.stringify(o, null, 2)));
write('catalog.retail.json', items);
write('catalog.financial.json', fin);
write('catalog.blocks.json', blocks);

const report = (label, rows, dims) => {
  console.log(`\n${label}: ${rows.length} items`);
  for (const [dim, get] of dims) {
    const c = {};
    for (const r of rows) for (const v of [].concat(get(r))) c[v] = (c[v] || 0) + 1;
    const ok = Object.entries(c).filter(([, x]) => x >= 3);
    console.log(`  ${dim.padEnd(12)} ${Object.keys(c).length} values, ${ok.length} clear minProducts=3  ${ok.map(([k, x]) => `${k}:${x}`).join(' ')}`);
  }
};
const band = (cuts) => (r) => r.value_usd < cuts[0] ? 'entry' : r.value_usd < cuts[1] ? 'core' : 'premium';
report('RETAIL', items, [['category', r => r.category], ['line', r => r.line], ['subcategory', r => r.subcategory],
  ['world', r => r.world], ['needs', r => r.needs], ['band', band([150, 300])]]);
report('FINANCIAL', fin, [['category', r => r.category], ['subcategory', r => r.subcategory],
  ['world', r => r.world], ['needs', r => r.needs], ['band', band([25000, 250000])]]);

// A visible row is 5 cards. Worst realistic case: the top 5 by any single ordering.
const dupes = [];
for (let i = 0; i + 5 <= items.length; i++) {
  const win = items.slice(i, i + 5).map(x => x.swatch);
  if (new Set(win).size < 5) dupes.push(i);
}
console.log(`\nCOLOUR: ${SWATCH.length} identities over ${items.length} items · colliding 5-windows: ${dupes.length}`);
console.log(`BLOCKS: ${blocks.length} (retail ${blocks.filter(b => b.vertical === 'retail').length}, financial ${blocks.filter(b => b.vertical === 'financial').length})`);

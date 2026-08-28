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
// Matched for saturation so none dominates a row. This is the card's RANK-
// TRACKING identity (the accent the eye follows when the row re-orders), and it
// is deliberately NOT the product's colourway — see `colour` below for that.
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

// FAMILIES × COLOURWAYS (decision D8, 2026-08-28). The old catalogue was forty
// UNIQUE pieces — no two the same thing — so personalization over it read as
// random: liking one field jacket could never surface another. A real luxury
// catalogue repeats itself on purpose: one family, three colourways, so "three
// of the same thing" can happen and COLOUR becomes a dimension of its own.
//
// THE LINE STILL LEADS THE NAME (decision D3). A line is a family the way
// Coach's "Tabby" is a family — Drover is heritage outerwear, Linden is
// structured leather bags. The FAMILY is the line plus its type noun ("Drover
// Field Jacket"), and `name` is `${family} · ${Colour}` so the family reads
// first on every card and the colourway closes it. The type noun is preserved
// from the old catalogue so packshots stay believable — a jacket stays a
// jacket. Twelve families of three, plus the four Solstice fragrances as
// singles, is exactly forty SKUs. Row ORDER is the id, and the swatch is
// assigned by index — do not reorder rows.
//
// `colour` is the hue dimension's retail source — a lowercase colour word,
// repeated ACROSS families on purpose (black occurs in five of them), because
// an affinity for black is only observable when black is a value that recurs.
// Subcategory stays MATERIAL, on the record for the card's display string.
//
// line | family (line + type noun) | category | material | price | styleWorld | occasions | colourways
// Price is per FAMILY: colourways of one thing cost the same.
const FAMILIES = [
  ['Drover',    'Drover Field Jacket',       'Outerwear','canvas',   298,'heritage', ['everyday','travel'], ['olive','navy','tan']],
  ['Shorewell', 'Shorewell Rain Shell',      'Outerwear','technical',186,'minimal',  ['travel','everyday'], ['slate','black','sand']],
  ['Fenwick',   'Fenwick Fisherman Sweater', 'Knitwear', 'wool',     165,'heritage', ['everyday','gift'],   ['cream','charcoal','oatmeal']],
  ['Fenwick',   'Fenwick Merino Crew',       'Knitwear', 'wool',     128,'minimal',  ['everyday','work'],   ['navy','grey','wine']],
  ['Linden',    'Linden Leather Crossbody',  'Bags',     'leather',  248,'heritage', ['everyday','work'],   ['tan','black','oxblood']],
  ['Linden',    'Linden Structured Tote',    'Bags',     'leather',  320,'modern',   ['work','everyday'],   ['tan','black','forest']],
  ['Holloway',  'Holloway Weekender',        'Bags',     'canvas',   385,'heritage', ['travel'],            ['green','navy','tan']],
  ['Ridgeline', 'Ridgeline Chelsea Boot',    'Footwear', 'leather',  320,'heritage', ['everyday','work'],   ['brown','black','tan']],
  ['Ridgeline', 'Ridgeline Court Sneaker',   'Footwear', 'canvas',   110,'minimal',  ['everyday','travel'], ['white','cream','black']],
  ['Halden',    'Halden Signet Ring',        'Jewellery','metal',    210,'heritage', ['everyday','gift'],   ['gold','silver','rose gold']],
  ['Harlow',    'Harlow Aviator',            'Eyewear',  'acetate',  215,'heritage', ['travel','everyday'], ['tortoise','black','gold']],
  ['Aster',     'Aster Silk Square',         'Scarves',  'silk',     165,'statement',['evening','gift'],    ['navy print','rust print','ivory print']],
];

// The fragrances are SINGLES: a scent has no colourway, so it carries no
// `family` (a family of one could never clear the family floor) — but it still
// carries a `colour`, read off the juice in the bottle, because the hue
// dimension covers every retail item. The words reuse the garment vocabulary
// where the bottle honestly allows it, to keep the dimension's value set tight.
const SINGLES = [
  ['Solstice', 'Solstice Smoked Vetiver',   'Fragrance','glass',175,'statement',['evening','gift'],  'charcoal'],
  ['Solstice', 'Solstice Amber Absolute',   'Fragrance','glass',215,'statement',['evening','gift'],  'amber'],
  ['Solstice', 'Solstice Fig & Neroli',     'Fragrance','glass',130,'minimal',  ['everyday','gift'], 'green'],
  ['Solstice', 'Solstice Bergamot & Cedar', 'Fragrance','glass',145,'modern',   ['gift','everyday'], 'gold'],
];

/** The card has no clamp and wraps its name freely; the longest colourway name
    ("Fenwick Fisherman Sweater · Charcoal", 36) sits on two lines at card size.
    The old 26 was the LINE-led cap from the approved design sheet; colourway
    names carry the family AND the colour, so the ceiling is the measured max. */
const MAX_NAME = 36;
/** The audience-generation floor: a line (or family) with fewer pieces can never mint an audience. */
const MIN_PER_LINE = 3;
const MIN_PER_FAMILY = 3;
/** The catalogue is exactly forty SKUs: the packshot set, the design sheet and the row math assume it. */
const CATALOGUE_SIZE = 40;

// name | category | subcategory | value_usd | world | needs | rate_pct | tier
//
// `tier` (D8) is the hue dimension's FINANCIAL source: the colour of the card
// in your wallet, on the five Card products only. The Personal Line of Credit
// deliberately has none — a line of credit is not a piece of plastic — which is
// also the proof the dimension tolerates a sparse source: extractTouches skips
// an absent field, exactly as `line` is absent from every financial record.
const FINANCIAL = [
  ['30-Year Fixed Mortgage','Mortgage','fixed',385000,'building',['borrow'],6.24,null],
  ['15-Year Fixed Mortgage','Mortgage','fixed',310000,'established',['borrow','refinance'],5.61,null],
  ['7/1 Adjustable Mortgage','Mortgage','variable',420000,'building',['borrow'],5.89,null],
  ['Home Equity Line','Mortgage','variable',75000,'established',['borrow','refinance'],7.15,null],
  ['Renovation Loan','Mortgage','variable',65000,'established',['borrow','refinance'],7.02,null],
  ['New Auto Loan','Auto','fixed',34000,'building',['borrow'],5.44,null],
  ['Used Auto Loan','Auto','fixed',21000,'starting-out',['borrow'],6.32,null],
  ['Auto Refinance','Auto','fixed',18500,'building',['refinance','save'],5.19,null],
  ['Platinum Rewards Card','Card','revolving',12000,'established',['borrow','protect'],null,'black'],
  ['Everyday Cashback Card','Card','revolving',6000,'building',['borrow','save'],null,'blue'],
  ['Secured Starter Card','Card','revolving',1000,'starting-out',['borrow','protect'],null,'silver'],
  ['Voyager Travel Card','Card','revolving',15000,'established',['borrow'],null,'gold'],
  ['Personal Line of Credit','Card','variable',20000,'building',['borrow','protect'],9.15,null],
  ['High-Yield Savings','Savings','deposit',18000,'building',['save'],4.35,null],
  ['12-Month Certificate','Savings','deposit',25000,'planning',['save','protect'],4.70,null],
  ['Money Market Account','Savings','deposit',42000,'established',['save','protect'],4.10,null],
  ['Self-Directed Brokerage','Investing','managed',60000,'established',['invest'],null,null],
  ['Roth Retirement Account','Investing','managed',48000,'planning',['invest','protect'],null,null],
  ['Managed Portfolio','Investing','managed',120000,'planning',['invest','protect'],null,null],
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
/** 'rose gold' → 'Rose Gold', for the name only; the `colour` field stays lowercase. */
const titleCase = (s) => s.split(' ').map(cap).join(' ');

// Families expand to one row per colourway, then the singles follow — that IS
// the id order, MRD-R001…R040.
const rows = [
  ...FAMILIES.flatMap(([line, family, category, subcategory, value_usd, world, needs, colours]) =>
    colours.map((colour) => ({ line, family, category, subcategory, value_usd, world, needs, colour }))),
  ...SINGLES.map(([line, name, category, subcategory, value_usd, world, needs, colour]) =>
    ({ line, name, category, subcategory, value_usd, world, needs, colour })),
];

const items = rows.map((row, i) => {
  const id = `MRD-R${String(i + 1).padStart(3, '0')}`;
  const [swatch, hex] = SWATCH[i % SWATCH.length];
  const name = row.name ?? `${row.family} · ${titleCase(row.colour)}`;
  return {
    id, vertical: 'retail', name,
    ...(row.family ? { family: row.family } : {}),
    line: row.line, category: row.category, subcategory: row.subcategory, colour: row.colour,
    value_usd: row.value_usd, world: row.world, needs: row.needs,
    available: true, swatch, hex,
    blurb: row.family
      ? `${row.family} in ${row.colour} — ${row.subcategory}, from the ${row.line} line. ${cap(row.world)} in spirit.`
      : `${name} — ${row.subcategory}, from the ${row.line} line. ${cap(row.world)} in spirit.`,
    image: `/meridian/img/${id}.jpg`,
  };
});

// Fail here, not on stage. A line or family under the floor is an audience that
// can never be minted; a missing colour is a hue dimension that silently skips
// the item; a name over the limit is a card that wraps onto a third line.
{
  if (items.length !== CATALOGUE_SIZE) {
    throw new Error(`retail catalogue is ${items.length} SKUs; the packshot set and the row math assume ${CATALOGUE_SIZE}`);
  }
  const perLine = {};
  for (const it of items) (perLine[it.line] ??= []).push(it.name);
  for (const [line, names] of Object.entries(perLine)) {
    if (names.length < MIN_PER_LINE) {
      throw new Error(`line "${line}" has ${names.length} piece(s); a line needs ${MIN_PER_LINE} to clear the audience floor`);
    }
  }
  const perFamily = {};
  for (const it of items) if (it.family) (perFamily[it.family] ??= []).push(it.id);
  for (const [family, ids] of Object.entries(perFamily)) {
    if (ids.length < MIN_PER_FAMILY) {
      throw new Error(`family "${family}" has ${ids.length} colourway(s); a family needs ${MIN_PER_FAMILY} for "three of the same thing" to happen`);
    }
  }
  for (const it of items) {
    if (typeof it.colour !== 'string' || !it.colour.trim()) {
      throw new Error(`"${it.name}" (${it.id}) has no colour; every retail item carries the hue dimension's source`);
    }
    if (it.name.length > MAX_NAME) throw new Error(`"${it.name}" is ${it.name.length} chars; the card holds ${MAX_NAME}`);
  }
}

const fin = FINANCIAL.map(([name, category, subcategory, value_usd, world, needs, rate_pct, tier], i) => {
  const id = `MRD-F${String(i + 1).padStart(3, '0')}`;
  const [swatch, hex] = SWATCH[i % SWATCH.length];
  return {
    id, vertical: 'financial', name, category, subcategory,
    ...(tier == null ? {} : { tier }),
    value_usd, world, needs,
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
    for (const r of rows) for (const v of [].concat(get(r) ?? [])) c[v] = (c[v] || 0) + 1;
    const ok = Object.entries(c).filter(([, x]) => x >= 3);
    console.log(`  ${dim.padEnd(12)} ${Object.keys(c).length} values, ${ok.length} clear minProducts=3  ${ok.map(([k, x]) => `${k}:${x}`).join(' ')}`);
  }
};
const band = (cuts) => (r) => r.value_usd < cuts[0] ? 'entry' : r.value_usd < cuts[1] ? 'core' : 'premium';
report('RETAIL', items, [['category', r => r.category], ['line', r => r.line], ['family', r => r.family],
  ['colour', r => r.colour], ['subcategory', r => r.subcategory],
  ['world', r => r.world], ['needs', r => r.needs], ['band', band([150, 300])]]);
report('FINANCIAL', fin, [['category', r => r.category], ['subcategory', r => r.subcategory], ['tier', r => r.tier],
  ['world', r => r.world], ['needs', r => r.needs], ['band', band([25000, 250000])]]);

// A visible row is 5 cards. Worst realistic case: the top 5 by any single ordering.
const dupes = [];
for (let i = 0; i + 5 <= items.length; i++) {
  const win = items.slice(i, i + 5).map(x => x.swatch);
  if (new Set(win).size < 5) dupes.push(i);
}
console.log(`\nCOLOUR: ${SWATCH.length} identities over ${items.length} items · colliding 5-windows: ${dupes.length}`);
console.log(`BLOCKS: ${blocks.length} (retail ${blocks.filter(b => b.vertical === 'retail').length}, financial ${blocks.filter(b => b.vertical === 'financial').length})`);

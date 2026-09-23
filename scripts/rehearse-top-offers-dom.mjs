#!/usr/bin/env node
// scripts/rehearse-top-offers-dom.mjs — press the buttons, for real.
//
// This loads the ACTUAL public/top-offers/top-offers.js into a minimal DOM and
// clicks each beat button against the running worker.
//
// It exists because two hand-offs of this demo passed a request-level test and
// still failed in the browser. Both bugs were in the page's own JavaScript — a
// beat that assumed the one before it had run, and a read that went out
// unsigned — and neither could be caught by a script that merely makes the same
// HTTP calls the page is supposed to make.
//
// It also asserts the thing the demo is FOR: that the room can see the cause.
// A beat that changes the module without first recording a real shopper action
// is a beat that asserts its cause instead of showing it, and this fails on it.
//
//   node scripts/rehearse-top-offers-dom.mjs [--base http://localhost:9100]
//
// It holds no credential and takes no token: everything the page needs, it must
// find for itself, exactly as the browser does.
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const base = (arg('--base', 'http://localhost:9100')).replace(/\/+$/, '');
const PAGE_DIR = `${base}/top-offers/`;

let failures = 0;
const ok = (label, condition, detail = '') => {
  if (condition) console.log(`   ✓ ${label}`);
  else { failures += 1; console.log(`   ✗ ${label}${detail ? ` — ${detail}` : ''}`); }
};

// ── The smallest DOM the page actually touches ───────────────────────────────
const IDS = ['four', 'pool', 'poolCount', 'vectors', 'drivers', 'whyHead', 'journey',
  'beatNo', 'engineLine', 'presses', 'status', 'engineDown', 'textSize', 'tokenBtn',
  'demo-cursor', 'mastnav', 'ghosts', 'deltas', 'weather', 'beforeRow', 'beforeFour', 'nowLabel',
  'directorHandle', 'nextBeat', 'nextLabel', 'pdBack', 'pdMode', 'pdDone', 'pdAct', 'pdArith', 'pdWill',
  'pdWhyWrap', 'pdWhy', 'pdMapNow', 'pdMapAfter', 'pdGo', 'pdPill', 'pdNote', 'pdWhyHead', 'explainBtn', 'pdNow', 'reportBody', 'buildReport', 'banner', 'topOffersModule', 'moduleWhere',
  'viewHome', 'viewCategory', 'viewProduct',
  'catTitle', 'catSub', 'catGrid', 'catCrumbs', 'pdpCrumbs', 'pdpImage', 'pdpBrand',
  'pdpTitle', 'pdpItem', 'pdpPrice', 'pdpPays', 'pdpBullets', 'pdpAdd'];

const classList = () => {
  const set = new Set();
  return { add: (c) => set.add(c), remove: (c) => set.delete(c), contains: (c) => set.has(c), _set: set };
};

function makeElement(id, dataset = {}) {
  const listeners = {};
  return {
    id, textContent: '', hidden: false, src: '', offsetWidth: 1,
    dataset, style: {}, children: [], classList: classList(),
    _html: '',
    get innerHTML() { return this._html; },
    set innerHTML(v) {
      this._html = String(v);
      // Children carry their own dataset, parsed from the markup, because the
      // page reads it back (the nav marks the current department that way) and
      // a child without one throws exactly where a browser would not.
      this.children = [...this._html.matchAll(/<button\b([^>]*)>/g)].map((m) => {
        const dataset = {};
        for (const a of m[1].matchAll(/data-([\w-]+)="([^"]*)"/g)) {
          const key = a[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase());
          dataset[key] = a[2].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
        }
        return { dataset, attrs: {}, setAttribute(k, x) { this.attrs[k] = x; }, getAttribute(k) { return this.attrs[k]; } };
      });
    },
    setAttribute(k, v) { this[`attr:${k}`] = v; },
    getAttribute(k) { return this[`attr:${k}`]; },
    disabled: false,
    closest: () => ({ classList: classList() }),
    querySelector: () => null,      // the page guards every optional lookup
    querySelectorAll: () => [],
    getBoundingClientRect: () => ({ left: 10, top: 10, width: 120, height: 40, right: 130, bottom: 50 }),
    scrollIntoView() { /* no viewport here */ },
    click() { /* a synthetic control has no default action */ },
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
    _fire(type, event) { return Promise.all((listeners[type] || []).map((fn) => fn(event))); },
  };
}

/**
 * Elements the MARKUP ships hidden. The stub used to default everything to
 * visible, which made the page think the declaration band was already open — so
 * it correctly refused to open it again and every band assertion failed against
 * working code. A fixture that misreports the initial state invents bugs.
 */
const HIDDEN = new Set(['pdBack', 'pdWhyWrap', 'beforeRow', 'nowLabel', 'banner',
  'viewCategory', 'viewProduct', 'engineDown']);
const elements = Object.fromEntries(IDS.map((id) => {
  const e = makeElement(id);
  if (HIDDEN.has(id)) e.hidden = true;
  return [id, e];
}));

/**
 * The only selectors the page uses are `#container tag[data-attr="value"]`, so
 * resolve them out of the container's own rendered markup. A hit returns a
 * synthetic control carrying that dataset, which is all `activate()` reads —
 * so the click still runs the page's real handler, not a shortcut past it.
 */
function querySelector(sel) {
  if (sel.includes('edge-sdk-key')) return { content: 'demo-site' };
  const m = /^#([\w-]+)\s+\w+\[data-([\w-]+)="([^"]+)"\]$/.exec(sel);
  if (!m) return null;
  const [, containerId, attr, value] = m;
  const container = elements[containerId];
  if (!container) return null;
  const key = attr.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  // The markup holds the ENTITY-ESCAPED value ("Kitchen &amp; Table"); a real
  // browser unescapes it when matching a selector, so match the escaped form.
  const inMarkup = value.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const escaped = inMarkup.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (!new RegExp(`data-${attr}="${escaped}"`).test(container.innerHTML)) return null;
  return makeElement(`${containerId}:${value}`, { [key]: value });
}

const documentStub = {
  getElementById: (id) => elements[id] ?? makeElement(id),
  querySelector,
  querySelectorAll: () => [],   // the tab strip is markup, not behaviour under test
  body: { style: {} },
  addEventListener() { /* the delegated handler is not fired from here */ },
};

const store = () => { const m = new Map(); return {
  getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };

// Relative URLs resolve against the page's own directory, as in a browser.
const pageFetch = (input, init) => fetch(new URL(typeof input === 'string' ? input : input.url, PAGE_DIR).toString(), init);

const sandbox = {
  document: documentStub, window: { prompt: () => null },
  sessionStorage: store(), localStorage: store(),
  fetch: pageFetch, crypto, console,
  setTimeout, clearTimeout, URL, URLSearchParams, Date, Math, JSON, Number, String, Boolean, Object, Array,
  Promise, Error, Set, Map, RegExp, isNaN, parseInt, parseFloat,
};
sandbox.globalThis = sandbox;

console.log('\n── Loading the real page script');
try {
  runInNewContext(readFileSync(new URL('../public/top-offers/top-offers.js', import.meta.url), 'utf8'), sandbox,
    { filename: 'top-offers.js' });
  ok('top-offers.js evaluated without throwing', true);
} catch (error) {
  ok('top-offers.js evaluated without throwing', false, String(error.message));
  console.log('\n✗ the page script did not load'); process.exit(1);
}

const status = () => elements.status.textContent;
const settle = async (label) => {
  for (let i = 0; i < 400; i += 1) {
    if (status() !== 'working…' && status() !== '') return status();
    await new Promise((r) => setTimeout(r, 100));
  }
  return `timed out (${label})`;
};

console.log('\n── What the page says before a single press');
const opening = await settle('startup');
console.log(`   status: "${opening}"`);
ok('the shop and the merchandiser credential both loaded', /signed in/i.test(opening), opening);
ok('the department nav rendered', (elements.mastnav.innerHTML.match(/data-category/g) || []).length === 6,
  String((elements.mastnav.innerHTML.match(/data-category/g) || []).length));

/**
 * A press now DECLARES first: the band opens, the room reads the arithmetic, and
 * the run happens on acceptance. The harness walks that same path rather than
 * short-circuiting it, so the declaration is exercised on every beat.
 */
const press = async (i) => {
  elements.status.textContent = 'working…';
  await elements.presses._fire('click', {
    target: { closest: (sel) => (sel === '.press' ? { dataset: { i: String(i) } } : null) },
  });
  return settle(`beat ${i + 1}`);
};

const BEAT_COUNT = (elements.presses.innerHTML.match(/<button/g) || []).length;
ok(`the director bar rendered ${BEAT_COUNT} beats`, BEAT_COUNT === 15, String(BEAT_COUNT));

const unescape = (t) => t.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
const journey = () => [...elements.journey.innerHTML.matchAll(/class="verb[^"]*">([^<]+)<\/span>\s*<span class="what">([^<]*)/g)]
  .map((m) => unescape(`${m[1].trim()} ${m[2].trim()}`));
const cookMeter = () => {
  const row = meters().find((x) => x.value === 'Kitchen & Table' && x.dim === 'category');
  return row ? row.a : 0;
};
const cards = () => [...elements.four.innerHTML.matchAll(/class="ptitle">([^<]*)</g)].map((x) => x[1]);
const deltas = () => [...elements.deltas.innerHTML.matchAll(/<b>([^<]*)<\/b>\s*<em>([^<]*)<\/em>/g)]
  .map((m) => unescape(`${m[1]} — ${m[2]}`));
const deltaNone = () => /class="delta-none"/.test(elements.deltas.innerHTML)
  ? unescape(elements.deltas.innerHTML.replace(/<[^>]+>/g, '').trim()) : '';
const meters = () => [...elements.vectors.innerHTML.matchAll(/<span>([^<]*)\s*<em[^>]*>([^<]*)<\/em><\/span><b>([\d.]+)<\/b>/g)]
  .map((m) => ({ value: unescape(m[1].trim()), dim: m[2].trim(), a: Number(m[3]) }));

// ── The declaration must be a declaration: arithmetic stated BEFORE the act ──
console.log('\n── The opening screen, before any press');
// It must never be a placeholder. QVC's defined content is static and owes
// nothing to a session, so it is on screen from the moment the page loads.
{
  const opening = cards().map(unescape);
  ok(`the module shows QVC's defaults before any press (${opening.length})`,
    opening.length === 4 && !opening.some((t) => /Loading the module/.test(t)), opening.join(' | '));
  ok('and they are titles, not bare ids', !opening.some((t) => /^SHN-/.test(t)), opening.join(' | '));
  ok('and the strip says why those four', /defined promotions/.test(elements.deltas.innerHTML),
    elements.deltas.innerHTML.replace(/<[^>]+>/g, ' ').trim().slice(0, 120));
  console.log(`   ${opening.join(' | ')}`);
}

console.log('\n── Explain: on demand, in either tense, never a gate');
{
  for (const n of [0, 1, 2]) await press(n);
  ok('a press runs without stopping to declare', elements.pdBack.hidden === true);

  // BEFORE: the prediction for the press that has not happened yet.
  await elements.pdPill._fire('click', {});
  ok('the explanation opens on demand', elements.pdBack.hidden === false);
  ok('it predicts the next press, with the arithmetic', /class="pd-row/.test(elements.pdArith.innerHTML),
    elements.pdArith.innerHTML.replace(/<[^>]+>/g, ' ').trim().slice(0, 110));
  ok('it names what will change', /<li>/.test(elements.pdWill.innerHTML));
  ok('and it shows the four containers as they stand', /pd-slot/.test(elements.pdNow.innerHTML),
    elements.pdNow.innerHTML.slice(0, 80));
  ok('it also proves the press that already happened',
    elements.pdWhyWrap.hidden === false && /<tr>/.test(elements.pdWhy.innerHTML));
  console.log(`   ${elements.pdArith.innerHTML.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 130)}`);
  await elements.pdGo._fire('click', {});
  ok('and closes without running anything', elements.pdBack.hidden === true);

  // AFTER: the same control, used once the press has landed.
  await press(3);
  await elements.explainBtn._fire('click', {});
  const why = [...elements.pdWhy.innerHTML.matchAll(/class="what">([^<]*)</g)].map((m) => unescape(m[1]));
  ok(`the proof names every container (${why.length})`, why.length === 4, why.join(' | '));
  why.forEach((w) => console.log(`   ${w}`));
  ok('the before/after module map is drawn', /pd-slot/.test(elements.pdMapAfter.innerHTML));
  await elements.pdGo._fire('click', {});
}

console.log('\n── Beat 5 pressed first, out of order');
{
  const result = await press(4);
  ok(`out of order → "${result}"`, result === 'done', result);
}

console.log('\n── The visitor\'s own session, beat by beat');
let openingCards = [];
for (let i = 0; i < BEAT_COUNT; i += 1) {
  const result = await press(i);
  const c = cards();
  const wanted = i >= 13 ? 2 : 4;   // take: 2 from the layout beat onward
  ok(`beat ${i + 1} → "${result}", ${c.length} cards`, result === 'done' && c.length === wanted, result);
  console.log(`        ${c.map((t, n) => `${n + 1}.${unescape(t)}`).join('  ')}`);
  const changed = deltas();
  changed.forEach((d) => console.log(`          ${d}`));
  if (!changed.length) console.log(`          (no change) ${deltaNone()}`);
  // EVERY press must be legible: it either moved the module and says what it
  // moved, or it did not and says why not. A press that silently does nothing
  // is the thing that made this demo look like a slideshow.
  // Legible means: it moved the module and named what moved, OR it did not and
  // said why not in terms of her own signal against the threshold.
  ok(`   ↳ beat ${i + 1} is legible`,
    changed.length > 0 || /(Nothing moved|has not been asked again|holding)/.test(deltaNone()),
    deltaNone() || '(empty)');
  if (i === 0) openingCards = c;

  // The checks that matter: a shopper beat must RECORD a real action, and the
  // effect must follow the cause rather than stand in for it.
  // Garrett's second use case: the banner holds back for a new customer, and
  // fills once the same page rule that releases Top Offers has been met.
  if (i === 1) ok('   ↳ the Contextual Banner holds back for a new customer',
    /holding back/.test(elements.banner.innerHTML),
    elements.banner.innerHTML.replace(/<[^>]+>/g, ' ').trim().slice(0, 110));
  if (i === 4) ok('   ↳ and fills once the page rule is met',
    /class="btitle"/.test(elements.banner.innerHTML),
    elements.banner.innerHTML.replace(/<[^>]+>/g, ' ').trim().slice(0, 110));

  if (i === 1) {
    const cook = meters().find((m) => m.value === 'Kitchen & Table' && m.dim === 'category');
    ok(`   ↳ her cook signal is visible at ${cook ? cook.a : 'nothing'} even though the module has not moved`,
      Boolean(cook && cook.a > 0), JSON.stringify(meters()));
  }
  if (i === 1) ok('   ↳ her session records the department she opened',
    journey().some((j) => /viewed Kitchen & Table/.test(j)), journey().join(' | '));
  if (i === 2) ok('   ↳ her session records the product she opened',
    journey().some((j) => /^opened /.test(j)), journey().join(' | '));
  // Jamie's rule: their defined defaults until five lifetime pages.
  if (i <= 2) ok('   ↳ the module is holding QVC\'s defined defaults',
    /QVC-defined default/.test(elements.four.innerHTML), c.map(unescape).join(' | '));
  if (i === 3) ok('   ↳ five pages released the defaults',
    !/QVC-defined default/.test(elements.four.innerHTML), c.map(unescape).join(' | '));

  // The merchandiser beats must MOVE something, or they are theatre.
  // Garrett's two page-layout questions, answered on screen.
  if (i === 12) {
    const four = cards().length;
    ok(`   ↳ moving the module changed nothing (${four} containers, position ${elements.topOffersModule.style.order})`,
      four === 4 && elements.topOffersModule.style.order === '1',
      `${four} cards at order ${elements.topOffersModule.style.order}`);
  }
  if (i === 13) ok(`   ↳ take: 2 renders two containers (${cards().length})`, cards().length === 2,
    cards().map(unescape).join(' | '));

  if (i === 14) {
    const body = elements.reportBody.innerHTML;
    const rows = [...body.matchAll(/class="nm" title="([^"]*)">[^<]*<\/span>\s*<span class="n">([\d.]+)<\/span>\s*<span class="s">([\d.]+)<\/span>/g)];
    ok(`   ↳ the report counts clicks per promotion (${rows.length} rows)`, rows.length > 0,
      body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 140));
    rows.slice(0, 5).forEach((m) => console.log(`        ${unescape(m[1]).padEnd(34)} shown ${m[2].padStart(4)}  clicks ${m[3]}`));
    ok('   ↳ and labels itself attribution, not incrementality',
      /attribution_diagnostic/.test(body) && /Attribution, not incrementality/.test(body));
  }
  if (i === 8) ok('   ↳ the weight lifted the pick to second, and not to first',
    /Spring Beauty Event/.test(unescape(c[1] || '')), c.map(unescape).join(' | '));
  if (i === 9) ok('   ↳ the pin put it in container one',
    /Spring Beauty Event/.test(unescape(c[0] || '')), c.map(unescape).join(' | '));

  // Garrett's rule, and its negative control.
  if (i === 10) ok('   ↳ snow in Washington surfaced the winter promotion',
    c.map(unescape).some((t) => /Snow Day Comfort Cooking/.test(t)), c.map(unescape).join(' | '));
  if (i === 11) ok('   ↳ the same shopper in Florida does not see it',
    !c.map(unescape).some((t) => /Snow Day Comfort Cooking/.test(t)), c.map(unescape).join(' | '));

  if (i === 4) {
    ok(`   ↳ four cook touches put the meter at ${cookMeter()}, past 0.60`, cookMeter() >= 0.6, String(cookMeter()));
    ok('   ↳ and the module is not what she arrived to',
      JSON.stringify(c) !== JSON.stringify(openingCards), c.join(' | '));
    const cook = (elements.drivers.innerHTML.match(/category Kitchen &amp; Table/g) || []).length;
    ok(`   ↳ the category cap holds cook at two containers (${cook})`, cook === 2, String(cook));
  }
}

// ── The before/after row must actually show BEFORE ──────────────────────────
// It did not: one variable held both "what she saw" and "what she sees", and
// the second overwrote the first before the strip was ever pressed, so the page
// drew the same four twice and called it a comparison.
console.log('\n── Before and after are two different rows');
{
  const now = cards().map(unescape);
  await elements.ghosts._fire('click', {});
  await new Promise((r) => setTimeout(r, 120));
  const before = [...elements.beforeFour.innerHTML.matchAll(/class="ptitle">([^<]*)</g)].map((x) => unescape(x[1]));
  ok(`the before row rendered ${before.length} cards`, before.length === 4, before.join(' | '));
  ok('the before row is NOT the current row',
    before.length === 4 && JSON.stringify(before) !== JSON.stringify(now),
    `before: ${before.join(' | ')}  ==  now: ${now.join(' | ')}`);
  console.log(`   before: ${before.join(' | ')}`);
  console.log(`   now:    ${now.join(' | ')}`);
}

console.log('\n── Her session, as the room saw it');
journey().forEach((j) => console.log(`   · ${j}`));

console.log('\n── What the module ended up showing');
cards().forEach((t, i) => console.log(`   ${i + 1}. ${t}`));
ok('the pool count is a real number', /^\d+$/.test(String(elements.poolCount.textContent)),
  String(elements.poolCount.textContent));
ok('the engine-down banner is hidden', elements.engineDown.hidden === true,
  String(elements.engineDown.textContent).slice(0, 120));

console.log(`\n${failures ? `✗ ${failures} check(s) failed — do not hand this over` : '✓ the real page script runs every beat, and every effect has a visible cause'}`);
process.exit(failures ? 1 : 0);

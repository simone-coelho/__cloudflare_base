// public/demo-kit/kit.js: createDemo(config), the demo kit's one entry point.
//
// A demo is a palette, a product feed and a set of beats, never a rebuild. The
// kit is the page chassis every demo shares; the vertical layer (public/<slug>/)
// keeps only its renderers (cards, a buy box, module bodies), the facts its beats
// speak about, the few verbs the kit lacks, its data files and its imagery.
//
//   transport.js   the three doors (api, demoRoute, tryJson), visitors, consent, events, the snapshot, receipts
//   director.js    the beats as data and their runner, the performed presses with the visible cursor, the keyboard,
//                  the query flags (?debug ?wait ?region ?metro ?fixtures ?exit)
//   panels.js      who and context, the meters, the cold start, Why these, the day's report, the roadmap
//   deltas.js      the before/now row and the moved chips, keyed by slot
//   prove.js       predict-then-prove from the published registry (K, θ and the action weights read, never typed)
//   sheets.js      the sheet mechanics, one sheet at a time
//   compare.js     the page-level Compare (Seam, Side by side, What changed); loaded here on first use
//   util.js        the shared helpers
//   tokens.css     the brand tokens, with Vantage's palette as the documented defaults
//   kit.css        the director, the machine panel, the rows, the sheets and the compare chrome, drawn from tokens
//
// THE RULES THE KIT EXISTS TO KEEP (docs/demos/BOOTSTRAP.md section 0): the page never ranks; every beat is a
// decision that came back from the service; nothing changes without a press; no credential in the page.
//
// The markup contract. The page carries, by id: #site (the site, the root Compare captures) and #machine; the
// director bar (#beatNo #engineLine #nextBeat #nextLabel #explainBtn #directorHandle #presses #status
// #assertRegion #assertIntent #compareTools); the machine (#whoChip #armChip #ctxChips #vectors #priorLine
// #coldStart #journey #whyBody #reportBody #buildReport #roadmap #captureBtn #compareBtn #captureNote, and its
// tabs as .mtabs buttons tab-<panel> controlling panel-<panel>); the sheet (#sheetBack #sheetBody #sheetClose);
// predict-then-prove (#pdBack and its parts); the cursor (#demo-cursor). config.ids renames any of them.
//
// createDemo(config) takes the vertical's settings and hooks (each module's header names the ones it reads)
// and returns { state, flags, util, transport, panels, deltas, sheets, prove, director, compare, say, debug }.
// Call it once the page's markup is parsed (a module script is). Nothing here touches the DOM at import time.
import * as util from './util.js';
import { createTransport } from './transport.js';
import { createPanels } from './panels.js';
import { createDeltas } from './deltas.js';
import { createSheets } from './sheets.js';
import { createProve } from './prove.js';
import { createDirector, readFlags, render, value } from './director.js';

export { util, render, value, readFlags };

const DEFAULT_IDS = { cursor: 'demo-cursor' };

export function createDemo(config) {
  const cfg = config || {};
  const flags = readFlags(location.search);
  const state = Object.assign({
    visitors: {}, who: null, ctx: { region: null }, regionSource: 'edge', own: null,
    receipts: new Map(), coldstart: null, lastVector: {}, fresh: new Set(), registry: null, sources: {},
    beat: null, busy: false, lineBeat: null, fixtureStep: null, fixtureDone: new Set(), showBefore: false,
    pdProof: null, sheet: null,
  }, cfg.state || {});
  const ids = { ...DEFAULT_IDS, ...(cfg.ids || {}) };
  const k = {
    config: cfg, flags, state, util,
    els(names) { return Object.fromEntries(names.map((n) => [n, document.getElementById(ids[n] || n)])); },
  };
  k.transport = createTransport(k);
  k.panels = createPanels(k);
  k.deltas = createDeltas(k);
  k.sheets = createSheets(k);
  k.prove = createProve(k);
  k.compare = createCompareGlue(k);
  k.director = createDirector(k);

  // The browser's own Back and Forward restore the page from its address (a beat's own Back restores it itself).
  window.addEventListener('popstate', () => {
    if (state.busy || !k.transport.cur()) return;
    void Promise.resolve(cfg.restore && cfg.restore()).catch((e) => k.director.say(e.message, 'bad'));
  });

  return {
    state, flags, util, transport: k.transport, panels: k.panels, deltas: k.deltas, sheets: k.sheets, prove: k.prove,
    director: k.director, compare: k.compare, say: k.director.say,
    /** Under ?debug, the hook the DOM suite drives: the same go() the director's Next calls. */
    debug(extra = {}) {
      if (!flags.debug) return;
      window[cfg.debugName || '__demo'] = { state, go: k.director.go, beats: k.director.beats, performClick: k.director.performClick,
        compare: () => k.compare.load(), ...extra };
    },
  };
}

// ════════════════════════════════════════════════════════════════════════
// COMPARE: the kit's widget (compare.js), wired so that a Before always exists:
// one after each view's first decided paint for a visitor, in idle time, outside
// a performed beat; one at the start of every performed beat, before it acts;
// and Capture's own, which replaces either. Nothing here ranks, asserts or asks
// the engine anything new: the frames are the page, and What changed is the
// page's own record of the answers it painted.
//
// config.compare: { root (selector, default '#site'), freezeCss, ignore, foot, where(), snapshot() }:
//   where()     where a frame is taken, as its tag and the Compare buttons name it ('homepage')
//   snapshot()  the decided state on screen at the clone: { who, at, where, vector, intent, region, lists }
// ════════════════════════════════════════════════════════════════════════
function createCompareGlue(k) {
  const cfg = k.config, state = k.state;
  const C = cfg.compare || {};
  const { esc, hhmm, clock, sleep, idle } = util;
  const T = () => k.transport, P = () => k.panels;
  const DIM_LABEL = cfg.dimLabels || {};
  const el = k.els(['captureBtn', 'compareBtn', 'captureNote', 'compareTools']);
  const root = () => document.querySelector(C.root || '#site');
  const say = (t, tone) => k.director.say(t, tone);

  let kitMod = null, kitLoad = null;
  /** The compare module, loaded on first use (it touches nothing at import); the page runs without it. */
  function load() {
    if (kitMod) return Promise.resolve(kitMod);
    if (!kitLoad) {
      kitLoad = import('./compare.js').then((m) => {
        m.configure({ freezeCss: C.freezeCss || '', ignore: C.ignore || '' });
        // The press is the capture: the machine's Capture starts its frame in the press itself (the tools row presses it).
        m.armPress(el.captureBtn, { root, label: frameLabel, meta: frameMeta, when: () => !state.busy });
        kitMod = m;
        return m;
      }).catch((error) => { kitLoad = null; throw error; });
    }
    return kitLoad;
  }
  const whoNow = () => (T().cur() ? T().cur().label : 'nobody yet');
  const whereNow = () => (C.where ? C.where() : 'page');
  /** What a frame keeps: where, who, and the decided state on screen at its clone, for What changed. */
  const frameMeta = () => ({ where: whereNow(), who: whoNow(), snap: C.snapshot ? C.snapshot() : null });
  const frameLabel = (m) => `${m.where} · ${m.who}`;
  /** "Before: homepage at 14:02, Shopper A": the title on every Compare button. */
  function title() {
    const b = kitMod && kitMod.baselineInfo();
    return b && b.meta ? `Before: ${b.meta.where} at ${clock(b.at)}, ${b.meta.who}` : 'Before: none yet. Act, then Compare.';
  }
  function syncTitles() {
    const t = title();
    if (el.compareBtn) el.compareBtn.title = t;
    const tool = el.compareTools && el.compareTools.querySelector('[data-tool="compare"]');
    if (tool) tool.title = t;
  }
  /**
   * A Before of the site as it is now: the compare module keeps its pixels and, with them, the decided state on
   * screen. reason: 'manual' (Capture), 'beat', 'first-paint' or 'tool'. Resolves at the clone, when the page may
   * change again, with { cloned, done } (the frame lands once it has rendered, and Compare waits for it), or null
   * when the module could not load.
   */
  async function takeBaseline(reason, renderAfter) {
    let m;
    try { m = await load(); } catch { return null; }
    const done = m.captureBaseline(root(), { label: frameLabel, meta: frameMeta, quiet: reason !== 'manual', fresh: reason !== 'manual', renderAfter });
    void done.then(syncTitles);
    const cloned = await done.cloned;
    return { cloned, done };
  }
  /** Capture: the Before is the page at the press, replacing any automatic one. */
  async function capture() {
    if (state.busy) { el.captureNote.textContent = 'A press is still landing: Capture once it has.'; return; }
    const t = await takeBaseline('manual');
    if (!t) { el.captureNote.textContent = 'Capture could not load the compare kit (public/demo-kit/compare.js).'; return; }
    const c = t.cloned;
    if (c && c.meta) {
      el.captureNote.textContent = c.meta.who === 'nobody yet'
        ? `Captured the ${c.meta.where} before anyone arrived, at ${hhmm(c.at)}. Change something, or bring in another shopper, then Compare.`
        : `Captured ${c.meta.who} on the ${c.meta.where} at ${hhmm(c.at)}. Change something, or bring in another shopper, then Compare.`;
      P().note('captured', `The ${c.meta.where}`, `for Compare · ${hhmm(c.at)}`);
    }
    const r = await t.done;
    if (!r.ok) el.captureNote.textContent = `Capture did not land: ${r.error}.`;
    syncTitles();
  }
  let compareReq = 0;
  /** A tool's comparison takes the screen: a Compare still waiting for a press gives way to it. */
  const supersede = () => { compareReq += 1; };
  /**
   * Compare: the Before against the page now. Never nothing: "no earlier frame" only when no Before is captured AND
   * none is being captured (a Before still rendering is waited for by the module, on screen); a press still landing is
   * waited for, on screen. A comparison a compare tool is taking holds the screen: Compare does not replace it, and
   * says so on it. The sentence under the frames is config.compare.foot ("the same page …") only when both frames are
   * of the same page; across two pages it names both.
   */
  async function compareNow() {
    const my = ++compareReq;
    let m;
    try { m = await load(); } catch (error) { say(`Compare could not load the compare kit: ${String(error.message || error)}`, 'bad'); return; }
    if (my !== compareReq) return;
    const own = 'compare', title = 'Before and now';
    const refused = 'Compare does not replace this comparison: close it, then press Compare.';
    // A press is running and the screen is not Compare's own: a tool is taking its comparison, and it stays.
    if (state.busy && m.isOpen() && !m.isOpen(own)) { m.notice(refused); return; }
    // Nothing captured and nothing being captured: the module says there is no earlier frame, and nothing else.
    if (!state.busy && !m.hasBaseline() && !m.captureInFlight()) { void m.openCompare(root(), { title, owner: own }); return; }
    if (state.busy) {
      m.showWaiting({ title, heading: 'A press is still landing.', text: 'Compare opens when it has.', owner: own });
      while (state.busy) {
        await sleep(150);
        if (my !== compareReq || !m.isOpen()) return;          // closed, or another Compare press took over
        if (!m.isOpen(own)) { m.notice(refused); return; }     // a tool's comparison took the screen: it stays
      }
    }
    const where = (f) => (f && f.meta ? f.meta.where : null);
    await m.openCompare(root(), {
      title, owner: own, nowLabel: frameLabel, nowMeta: frameMeta,
      foot: (b, n) => (where(b) && where(b) === where(n) ? C.foot
        : `Two pages, not one: the Before is the ${where(b) || 'earlier page'}, Now is the ${where(n) || 'page on screen'}, so the frames differ in layout as well as in what each moment knew about the shopper. What changed sets the decisions behind them side by side.`),
      details: (b, n) => columns(b.meta && b.meta.snap, n.meta && n.meta.snap, ['Before', 'Now']),
    });
  }
  /** What changed: the two frames' decided state in two columns. A row in red differs from the other column at the same position. */
  function columns(a, b, keys) {
    if (!a || !b) return '<p class="cmp-cols-sub">The decided state behind one of the two frames was not recorded, so there are no columns to set side by side.</p>';
    const col = (s, other, key) => `<div class="cmp-col"><p class="ck">${esc(key)}</p><h3>${esc(s.who)} · ${esc(s.where)}</h3>
      <p class="cwhen">${esc(hhmm(s.at))}${s.intent ? ` · intent ${esc(s.intent)} (asserted)` : ''}${s.region ? ` · region ${esc(s.region)}` : ''}</p>
      ${s.lists.length ? s.lists.map(([name, rows], li) => {
        const o = (other.lists[li] || [null, []])[1];
        return `<p class="cmp-sec">${esc(name)}</p><ol class="cmp-list">${rows.map((r, i) => `<li class="${o[i] && o[i].id === r.id ? '' : 'diff'}"><span class="cn">${i + 1}</span><span>${esc(r.t)}</span><span class="cs">${r.s == null ? '' : util.fmt3(r.s)}</span></li>`).join('') || '<li><span></span><span>nothing returned</span><span></span></li>'}</ol>`;
      }).join('') : `<p class="cmp-sec">Nothing on the ${esc(s.where)} is decided</p>`}
      <p class="cmp-sec">Strongest signals</p><div class="cmp-sig">${s.vector.map((x) => `<div><span>${esc(x.value)} · ${esc(DIM_LABEL[x.dim] || x.dim)}</span><b>${x.a.toFixed(2)}</b></div>`).join('') || '<div><span>none yet</span><b></b></div>'}</div></div>`;
    return `<p class="cmp-cols-sub">${esc(keys[0])} at ${esc(hhmm(a.at))}, against ${esc(keys[1].replace(/^(Now|The|A)\b/, (w) => w.toLowerCase()))} at ${esc(hhmm(b.at))}. A row in red differs from the other column at the same position.</p>
      <div class="cmp-cols" id="cmpCols">${col(a, b, keys[0])}${col(b, a, keys[1])}</div>`;
  }
  /** A Before always exists: after a view's first decided paint for this visitor, outside a performed beat, in idle time. */
  let idleGen = 0;
  const supersedeIdle = () => { idleGen += 1; };
  function afterDecidedPaint(viewKey) {
    const v = T().cur();
    if (!v || v.fresh) return;
    v.painted = v.painted || new Set();
    if (v.painted.has(viewKey)) return;
    v.painted.add(viewKey);
    if (state.busy) return;                        // a performed beat, or a compare tool, took its own Before
    const my = ++idleGen;
    setTimeout(() => idle(() => {
      if (my !== idleGen || state.busy || T().cur() !== v) return;
      void takeBaseline('first-paint');
    }), 600);
  }
  /** The compare module and html2canvas, fetched in idle time, so the first Before is quick to take. */
  function prefetch() { idle(() => { load().then((m) => m.preload()).catch(() => { /* Compare says so when it is pressed */ }); }); }
  const isOpen = () => Boolean(kitMod && kitMod.isOpen());
  const close = () => { if (kitMod) kitMod.closeCompare(); };

  if (el.captureBtn) el.captureBtn.addEventListener('click', () => { void capture(); });
  if (el.compareBtn) el.compareBtn.addEventListener('click', () => { void compareNow(); });
  return { load, takeBaseline, capture, compareNow, columns, afterDecidedPaint, supersede, supersedeIdle, prefetch, isOpen, close,
    title, syncTitles, frameLabel, frameMeta, whoNow, root };
}

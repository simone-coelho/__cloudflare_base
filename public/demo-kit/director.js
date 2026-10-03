// public/demo-kit/director.js: the director, its hand, and the beats as data.
//
// THE CAUSE IS VISIBLE. A shopper beat moves a cursor to a real control and runs
// that control's own handler (the vertical's one dispatcher, config.control): the
// event goes out because the control ran, and a module changes because the next
// decision answered differently. A human hand on the page runs the same handler.
//
// The beats are data (public/<slug>/beats.json): each { key, no, act, who, label,
// declare[], acts[], will[], line, after?, target?, run[] }. Strings are templates
// over the vertical's facts (config.facts(), read fresh at every step):
//   {{path}}               the value, HTML-escaped where the string is HTML
//   {{{path}}}             the value, raw
//   {{a || b || 'text'}}   the first that is set
//   {{#path}}…{{/path}}    when it is set (a list repeats it, each item joining the context)
//   {{^path}}…{{/path}}    when it is not
// A string that is exactly one {{…}} yields the value itself (a number, a list, an
// object), so an engine action's attributes can come from the facts whole.
// A path must resolve: every name in it exists in the facts (or the step's arguments, or
// the item of an each), every alternative of an || included. A value may be null, which
// reads as not set; a name that is not there is an error, never an empty string. In a
// running beat the beat stops and the status line names the path; outside one (Explain,
// the presses, the sentence after an answer) the status line names it and the text shows
// it. validate() checks every template in the beats file against the facts at the page's
// load, every branch of every section included.
//
// `run` is a list of steps. Each step names one verb:
//   open      a place, through the page's own controls, as a visitor would (the beats file's `places`, with arguments);
//             open: 'back' presses the browser's own Back; with land: true the page opens it directly (an arrival)
//   click     a performed press on a control: a selector, or a data-ctl name `in` a container; if: 'present'
//             presses only when it is on the page; missing: the error when it is not
//   select    a performed press on one option of a selector (a storage step, an answer, a line count)
//   wait      a pause in ms; { seconds, timer } is a visible countdown in a strip (?wait=N shortens it)
//   custom    a custom engine event sent directly ({ custom: 'compare', data }), for a step with no control
//   assert    context asserted on every request, labelled: { region } ('own' is back in the visitor's own region), { intent }
//   focus     a region of the page into view (a selector, or the first present of a list), or { panel } to the front
//   publish   a named beat document applied by the worker ({ publish: 'catalog' | 'slots', name, reason }), or 'reset';
//             fixtureStep: a fixture piece marked with that step joins the pool from this publish on
//   ask       the engine asked again: a page's decisions ('home', 'phone'), or the day's 'report' (build: true)
//   template  the CMS's template for a page: which slot sits where ({ template: 'home', slots, label })
//   call      the one escape hatch, into the vertical's own functions (config.verbs[name])
// and the grammar around them: when / unless (a guard, read once), else (the steps when the guard fails, or a
// press with if: 'present' found nothing), do (a block), each (a loop: each item's fields join the context),
// note: [verb, what, detail] (the session line the verb writes). if: 'present' is about the element alone:
// the selector's own template must still resolve.
//
// Also here: the query flags (?debug ?wait ?region ?metro ?fixtures ?exit ?present), the presses and Next, the
// drawer of all beats, the tools row (assert a region or an answer by hand; Capture, Compare and the vertical's
// compare tools), the status line, and the keyboard (E explains; Escape closes; D docks, with config.dock).
//
// config.dock (optional, per demo; absent, nothing here changes): { collapsed } docks the presenter's tools, the
// machine panel and the director bar, in one column on the right, and lets them collapse to a slim rail so the
// site is the whole page. Collapsed by default when collapsed is true; expanded by the presenter's key (D), by
// ?present=1 (?present=0 collapses), by the rail's own button, and under ?debug (a rehearsal is a presenter's
// session) unless ?present says otherwise; the state is remembered in this tab (sessionStorage). The rail keeps
// Next, so a beat can run with the tools put away. At a phone's width (640 px and under) the collapsed rail is off the
// page too, so a visitor sees the site alone, unless the address says ?present=1 (body.kit-present). { onForget }
// (optional) adds "Forget this browser" beside Hide: the demo forgets the visitor it keeps and reloads to its cold
// open, minting nobody. Its styles are kit.css's dock block.
// No DOM or window access at import time.
import { arr, esc, focusOn, num, sleep } from './util.js';

/** The query flags the director honours. Read once, at the page's load. */
export function readFlags(search) {
  const QS = new URLSearchParams(search);
  // ?region=US-NY is a REHEARSAL OVERRIDE, never the default: suites pass it so their figures stay reproducible,
  // and the panel labels it. Without it the arrival asserts no region and the edge locates the request.
  const regionParam = (s) => { const key = String(s || '').trim().toUpperCase(); return /^[A-Z]{2}(?:-[A-Z0-9]{1,3})?$/.test(key) ? key : null; };
  const region = regionParam(QS.get('region'));
  return {
    qs: QS, debug: QS.has('debug'), fixtures: QS.has('fixtures'), wait: num(QS.get('wait')) || 0,
    region, metro: QS.get('metro'), regionIgnored: QS.has('region') && !region ? String(QS.get('region')).slice(0, 16) : null,
    exit: QS.get('exit'),
    // ?present=1 opens a docked director, ?present=0 collapses it (config.dock only); anything else says nothing.
    present: QS.get('present') === '1' ? true : QS.get('present') === '0' ? false : null,
  };
}

// ── Templates over facts ──────────────────────────────────────────────────
const WHOLE = /^\{\{\s*([^#^/{}][^{}]*?)\s*\}\}$/;
/** A template path that does not resolve: the director says it, never an empty string. */
export class TemplateError extends Error {
  constructor(path) { super(`unresolved template path {{${path}}}`); this.name = 'TemplateError'; this.path = path; }
}
function lookup(ctx, path) {
  if (path === '.') { if (!('.' in ctx)) throw new TemplateError(path); return ctx['.']; }
  let v = ctx;
  for (const part of path.split('.')) {
    if (v == null || !(part in Object(v))) throw new TemplateError(path);
    v = v[part];
  }
  return v;
}
const LITERAL = (p) => /^'.*'$/.test(p) || /^-?\d+(\.\d+)?$/.test(p) || ['true', 'false', 'null'].includes(p);
const literal = (p) => (/^'.*'$/.test(p) ? p.slice(1, -1) : p === 'true' ? true : p === 'false' ? false : p === 'null' ? null : Number(p));
const alternatives = (expr) => expr.split('||').map((s) => s.trim());
function evaluate(expr, ctx) {
  // Every alternative resolves first, so a typo in a fallback is caught whatever the facts say today.
  const vs = alternatives(expr).map((p) => (LITERAL(p) ? literal(p) : lookup(ctx, p)));
  return vs.find(Boolean) || vs[vs.length - 1];
}
function parse(tpl) {
  const root = { children: [] };
  const stack = [root];
  const re = /\{\{\{\s*([^}]+?)\s*\}\}\}|\{\{\s*([#^/]?)\s*([^}]+?)\s*\}\}/g;
  let last = 0, m;
  while ((m = re.exec(tpl))) {
    const top = stack[stack.length - 1];
    if (m.index > last) top.children.push({ t: 'text', v: tpl.slice(last, m.index) });
    last = re.lastIndex;
    if (m[1] !== undefined) { top.children.push({ t: 'raw', v: m[1] }); continue; }
    if (m[2] === '#' || m[2] === '^') { const node = { t: m[2] === '#' ? 'if' : 'not', v: m[3], children: [] }; top.children.push(node); stack.push(node); }
    else if (m[2] === '/') { if (stack.length > 1) stack.pop(); }
    else top.children.push({ t: 'var', v: m[3] });
  }
  if (last < tpl.length) stack[stack.length - 1].children.push({ t: 'text', v: tpl.slice(last) });
  return root.children;
}
const set = (v) => (Array.isArray(v) ? v.length > 0 : Boolean(v));
const itemCtx = (ctx, item) => (item && typeof item === 'object' && !Array.isArray(item) ? { ...ctx, ...item, '.': item } : { ...ctx, '.': item });
function renderNodes(nodes, ctx, html) {
  let out = '';
  for (const n of nodes) {
    if (n.t === 'text') out += n.v;
    else if (n.t === 'raw') { const v = evaluate(n.v, ctx); out += v == null ? '' : String(v); }
    else if (n.t === 'var') { const v = evaluate(n.v, ctx); const s = v == null ? '' : String(v); out += html ? esc(s) : s; }
    else {
      const v = evaluate(n.v, ctx);
      if (n.t === 'not') { if (!set(v)) out += renderNodes(n.children, ctx, html); }
      else if (set(v)) {
        if (Array.isArray(v)) for (const item of v) out += renderNodes(n.children, itemCtx(ctx, item), html);
        else out += renderNodes(n.children, ctx, html);
      }
    }
  }
  return out;
}
const parsed = new Map();
/** A template rendered over a context: as HTML (values escaped) or as text. */
export function render(tpl, ctx, html = true) {
  if (tpl == null) return '';
  const s = String(tpl);
  let nodes = parsed.get(s);
  if (!nodes) { nodes = parse(s); parsed.set(s, nodes); }
  return renderNodes(nodes, ctx || {}, html);
}
/** A value over a context: a string that is exactly one {{…}} yields the value itself; objects and lists member by member. */
export function value(v, ctx) {
  if (typeof v === 'string') { const m = WHOLE.exec(v); return m ? evaluate(m[1], ctx || {}) : render(v, ctx, false); }
  if (Array.isArray(v)) return v.map((x) => value(x, ctx));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([key, x]) => [key, value(x, ctx)]));
  return v;
}
const guard = (step, ctx) => (step.when === undefined || set(value(step.when, ctx))) && (step.unless === undefined || !set(value(step.unless, ctx)));

export function createDirector(k) {
  const cfg = k.config, state = k.state, flags = k.flags;
  const T = () => k.transport, P = () => k.panels;
  const el = k.els(['cursor', 'beatNo', 'engineLine', 'nextBeat', 'nextLabel', 'directorHandle', 'presses', 'status',
    'assertRegion', 'assertIntent', 'compareTools', 'captureBtn']);

  const say = (t, tone) => { el.status.textContent = t; el.status.dataset.tone = tone || ''; };

  // ── The dock (config.dock): the presenter's tools docked right, collapsible to a slim rail ──
  const dock = cfg.dock ? createDock(cfg.dock) : null;
  function createDock(opts) {
    const body = document.body;
    const bar = el.nextBeat.closest('.director');
    const key = `kit-dock:${cfg.tenant || 'demo'}`;
    const read = () => { try { return sessionStorage.getItem(key); } catch { return null; } };
    const write = (v) => { try { sessionStorage.setItem(key, v); } catch { /* storage refused: the state lasts the page */ } };
    body.classList.add('kit-dock');
    body.classList.toggle('kit-present', flags.present === true);   // the presenter's address: the rail stays on a phone's page
    body.insertAdjacentHTML('beforeend', '<div class="dock-rail" id="dockRail" role="group" aria-label="Director, collapsed">'
      + '<button type="button" class="dock-open" id="dockOpen" aria-controls="machine" aria-expanded="false" title="Open the director (D)"><span class="dock-k">Director</span></button>'
      + '<button type="button" class="dock-next" id="dockNext" title="Next beat"><span aria-hidden="true">&rarr;</span><span class="dock-n" id="dockNextNo"></span></button></div>');
    const nav = bar ? bar.querySelector('.beatnav') : null;
    // opts.onForget (optional): "Forget this browser", the presenter's way back to the cold open. The demo forgets the
    // visitor it keeps in this browser and reloads, minting nobody; absent, no control is drawn.
    const forgets = typeof opts.onForget === 'function';
    if (nav && forgets) nav.insertAdjacentHTML('beforeend', '<button type="button" class="director-handle dock-forget" id="dockForget" title="Forget the visitor this browser keeps: the next page is a stranger’s, and nobody exists until the first click">Forget this browser</button>');
    if (nav) nav.insertAdjacentHTML('beforeend', '<button type="button" class="director-handle dock-hide" id="dockHide" aria-controls="machine" aria-expanded="true" title="Collapse to the rail (D)">Hide</button>');
    const openBtn = document.getElementById('dockOpen'), hideBtn = document.getElementById('dockHide'), nextBtn = document.getElementById('dockNext');
    const forgetBtn = forgets ? document.getElementById('dockForget') : null;
    let open = false;
    function apply(to, remember) {
      open = Boolean(to);
      body.classList.toggle('kit-dock--collapsed', !open);
      openBtn.setAttribute('aria-expanded', String(open));
      if (hideBtn) hideBtn.setAttribute('aria-expanded', String(open));
      if (remember) write(open ? 'open' : 'closed');
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(fit); else fit();
    }
    // The machine column leaves room for the bar docked at its foot, whatever the bar's height.
    function fit() { body.style.setProperty('--dock-bar-h', `${bar ? bar.offsetHeight : 0}px`); }
    if (bar && typeof ResizeObserver === 'function') new ResizeObserver(fit).observe(bar);
    fit();
    const stored = read();
    const first = flags.present !== null ? flags.present : stored === 'open' ? true : stored === 'closed' ? false : flags.debug ? true : !opts.collapsed;
    apply(first, flags.present !== null);
    openBtn.addEventListener('click', () => apply(true, true));
    if (hideBtn) hideBtn.addEventListener('click', () => apply(false, true));
    nextBtn.addEventListener('click', () => { if (!state.busy && !el.nextBeat.disabled) el.nextBeat.click(); });
    if (forgetBtn) forgetBtn.addEventListener('click', () => {
      if (state.busy) { say('a beat is running; forget this browser once it lands', 'bad'); return; }
      forgetBtn.disabled = true;
      say('forgetting the visitor this browser keeps…');
      Promise.resolve().then(() => opts.onForget()).catch((error) => { forgetBtn.disabled = false; say(String((error && error.message) || error), 'bad'); });
    });
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'd' && e.key !== 'D') return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target || {};
      if (/input|textarea|select/i.test(t.tagName || '') || t.isContentEditable) return;
      apply(!open, true);
    });
    return {
      isOpen: () => open, set: (to) => apply(to, true),
      next(label, disabled) { const n = document.getElementById('dockNextNo'); if (n) n.textContent = label; nextBtn.disabled = Boolean(disabled); nextBtn.title = disabled ? 'The walkthrough is complete' : `Next: ${label}`; },
    };
  }

  // ── The hand ──────────────────────────────────────────────────────────────
  async function performClick(selector, missing) {
    const target = typeof selector === 'string' ? document.querySelector(selector) : selector;
    if (!target) throw new Error(missing || `nothing on the page matches ${selector}`);
    try { target.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch { /* optional */ }
    await sleep(320);
    const r = target.getBoundingClientRect();
    el.cursor.classList.add('show');
    el.cursor.style.left = `${r.left + r.width / 2}px`;
    el.cursor.style.top = `${r.top + Math.min(r.height / 2, 30)}px`;
    await sleep(680);
    el.cursor.classList.remove('click'); void el.cursor.offsetWidth; el.cursor.classList.add('click');
    target.classList.remove('clicked'); void target.offsetWidth; target.classList.add('clicked');
    await sleep(260);
    await cfg.control(target);
    await sleep(340);
    target.classList.remove('clicked');
  }
  const ctl = (container, name) => `#${container} [data-ctl="${name}"]`;
  async function clickIf(selector) { if (document.querySelector(selector)) { await performClick(selector); return true; } return false; }
  /** The cursor goes to a control without running anything: the browser's own Back is not the page's. */
  async function pointAt(node) {
    const r = node.getBoundingClientRect();
    el.cursor.classList.add('show');
    el.cursor.style.left = `${r.left + r.width / 2}px`;
    el.cursor.style.top = `${r.top + Math.min(r.height / 2, 30)}px`;
    await sleep(680);
    el.cursor.classList.remove('click'); void el.cursor.offsetWidth; el.cursor.classList.add('click');
    await sleep(260);
  }
  /**
   * The browser's Back, as a visitor would press it. The page restores the page they
   * left and asks again; a restore from history is not a new view, so it sends
   * no event (a bfcache restore runs no page script either). The chip at the
   * corner stands for the browser's own button while the hand presses it.
   */
  async function browserBack() {
    let chip = document.getElementById('backChip');
    if (!chip) {
      chip = document.createElement('div');
      chip.id = 'backChip'; chip.className = 'back-chip';
      chip.innerHTML = '<b>&lsaquo; Back</b><em>the browser’s own button</em>';
      document.body.appendChild(chip);
    }
    chip.hidden = false;
    await pointAt(chip);
    await new Promise((resolve) => {
      const done = () => { window.removeEventListener('popstate', done); resolve(); };
      window.addEventListener('popstate', done);
      setTimeout(done, 1500);
      history.back();
    });
    chip.hidden = true;
    await cfg.restore();
  }

  // ── One dispatcher. The cursor and a human hand run the same handler. ─────
  const controls = cfg.controls || {};
  document.addEventListener('click', (e) => {
    const t = e.target && e.target.closest ? e.target.closest(controls.selector || '[data-act],[data-nav],[data-open],[data-quick],[data-jump]') : null;
    if (!t) return;
    if (t.closest('.director') || t.closest('.machine') || t.closest('.pd-back') || t.closest('.cmp-back') || (controls.skip && t.closest(controls.skip))) return;
    e.preventDefault();
    if (state.busy) { say('a beat is running; the page is frozen until it lands', 'bad'); return; }
    void cfg.control(t).catch((error) => say(String(error.message || error), 'bad'));
  });

  // ── The beats, from the vertical's beats file ─────────────────────────────
  let script = { beats: [], places: {}, acts: {} };
  let list = [];
  const facts = () => (cfg.facts ? cfg.facts() : {});
  // ── A path that does not resolve is said ──────────────────────────────────
  let fault = null;                                  // the running beat's first unresolved path: it stops at its next step
  const stoppedBy = (b, error) => (error instanceof TemplateError ? `beat ${b.no} stopped: ${error.message}` : String((error && error.message) || error));
  /** A render outside the beat's own steps (Explain, the presses, the sentence after an answer): said, and shown in the text. */
  const shown = (b, fn, instead) => () => {
    try { return fn(); } catch (error) {
      if (!(error instanceof TemplateError)) throw error;
      const m = `beat ${b.no}: ${error.message}`;
      if (state.busy && state.lineBeat === b && !fault) fault = stoppedBy(b, error);
      say(m, 'bad');
      return instead(`[${m}]`);
    }
  };
  function items(entries, ctx) {
    const out = [];
    for (const it of arr(entries)) {
      if (typeof it === 'string') { out.push(render(it, ctx, true)); continue; }
      if (it.each !== undefined) { for (const x of arr(value(it.each, ctx))) { const c = itemCtx(ctx, x); if (guard(it, c)) out.push(render(it.text, c, true)); } continue; }
      if (guard(it, ctx)) out.push(render(it.text, ctx, true));
    }
    return out;
  }
  /** The engine actions a beat declares, for predict-then-prove: { type, attrs, action? }. */
  function actsOf(entries, ctx) {
    const out = [];
    for (const it of arr(entries)) {
      if (it.each !== undefined) { for (const x of arr(value(it.each, ctx))) out.push(...actsOf(it.acts, itemCtx(ctx, x))); continue; }
      if (!guard(it, ctx)) continue;
      const action = it.action !== undefined ? value(it.action, ctx) : null;
      out.push({ type: value(it.type, ctx), attrs: value(it.attrs || {}, ctx) || {}, ...(action ? { action } : {}) });
    }
    return out;
  }
  function runtime(b) {
    const ctx = () => facts();
    return {
      key: b.key, no: b.no, act: b.act, who: b.who, data: b,
      label: shown(b, () => render(b.label, ctx(), false), (m) => m),
      declare: b.declare ? shown(b, () => items(b.declare, ctx()), (m) => [esc(m)]) : undefined,
      acts: b.acts ? shown(b, () => actsOf(b.acts, ctx()), () => []) : undefined,
      will: b.will ? shown(b, () => items(b.will, ctx()), (m) => [esc(m)]) : undefined,
      line: () => render(b.line, ctx(), true),     // read as the beat starts: a path that does not resolve stops it there
      // Said only once the engine's answer (or its receipts) bears it out: null keeps the line.
      after: b.after ? shown(b, () => { const c = ctx(); return guard(b.after, c) ? render(b.after.line, c, true) : null; }, (m) => esc(m)) : undefined,
      target: b.target ? shown(b, () => value(b.target, ctx()), () => null) : undefined,
      run: () => runSteps(b.run, {}),
    };
  }
  /** The vertical's beats file: { total, acts, places, beats }. */
  function setBeats(doc) {
    script = { beats: [], places: {}, acts: {}, ...(doc || {}) };
    list = arr(script.beats).map(runtime);
  }
  /**
   * Every template in the beats file checked against the facts as they stand, every branch of every section and
   * every alternative of an || included: what does not resolve, by beat and field. A path whose first name is not
   * a fact (a step's argument, an each's item) is known only when its step runs, and is checked there.
   */
  function validate() {
    const f = facts();
    const problems = [];
    const checkExpr = (where, expr) => {
      for (const p of alternatives(expr)) {
        if (LITERAL(p) || p === '.' || !(p.split('.')[0] in f)) continue;
        try { lookup(f, p); } catch (error) { if (error instanceof TemplateError) problems.push(`${where}: {{${p}}}`); else throw error; }
      }
    };
    const checkNodes = (where, nodes) => { for (const n of nodes) { if (n.t !== 'text') checkExpr(where, n.v); if (n.children) checkNodes(where, n.children); } };
    const walk = (where, x) => {
      if (typeof x === 'string') { if (x.includes('{{')) checkNodes(where, parse(x)); return; }
      if (Array.isArray(x)) { x.forEach((y) => walk(where, y)); return; }
      if (x && typeof x === 'object') for (const [key, y] of Object.entries(x)) walk(`${where}.${key}`, y);
    };
    for (const b of arr(script.beats)) walk(`beat ${b.no}`, { ...b, key: undefined, no: undefined });
    for (const [name, steps] of Object.entries(script.places || {})) walk(`place ${name}`, steps);
    return problems;
  }
  const beats = () => list;
  const keys = () => list.map((b) => b.key);
  const labelOf = (b) => (typeof b.label === 'function' ? b.label() : b.label);

  // ── The verbs ─────────────────────────────────────────────────────────────
  const RESERVED = new Set(['when', 'unless', 'else', 'do', 'each', 'note', 'in', 'if', 'missing', 'land', 'args']);
  const argsOf = (step, verb, ctx) => (step.args !== undefined ? value(step.args, ctx)
    : Object.fromEntries(Object.entries(step).filter(([key]) => key !== verb && !RESERVED.has(key)).map(([key, x]) => [key, value(x, ctx)])));
  function noteOf(step, ctx) {
    if (!step.note) return;
    const [verb, what, detail] = value(step.note, ctx);
    P().note(verb, what, detail);
  }
  async function press(step, verb, ctx) {
    const name = value(step[verb], ctx);
    const selector = step.in !== undefined ? ctl(value(step.in, ctx), name) : name;
    if (step.if === 'present' && !document.querySelector(selector)) return false;
    await performClick(selector, step.missing !== undefined ? value(step.missing, ctx) : undefined);
    return true;
  }
  /** A visible minute (or whatever the step says): the page waits, counting down in a strip, then the beat goes on. */
  async function timer(seconds, t, ctx) {
    const into = document.querySelector(t.into);
    const end = Date.now() + seconds * 1000;
    if (t.focus) focusOn(document.querySelector(t.focus));
    while (Date.now() < end) {
      const left = Math.max(0, Math.ceil((end - Date.now()) / 1000));
      const html = `<li class="delta-timer"><span class="hk">${esc(render(t.head, ctx, false))}</span><span><b class="tmr">${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}</b> ${render(t.text, ctx, true)}</span></li>`;
      const node = into && into.querySelector('.delta-timer');
      if (node) node.outerHTML = html; else if (into) into.insertAdjacentHTML('afterbegin', html);
      if (t.status) say(render(t.status, { ...ctx, left }, false));
      await sleep(250);
    }
  }
  const page = (name) => {
    const p = (cfg.pages || {})[name];
    if (!p) throw new Error(`the vertical has no page named "${name}"`);
    return p;
  };
  const VERBS = {
    async open(step, ctx, verb) {
      const name = value(step.open, ctx);
      if (name === 'back') { await browserBack(); return true; }
      const args = argsOf(step, verb, ctx);
      if (step.land) { await page(name).open(args); return true; }
      const steps = (script.places || {})[name];
      if (!steps) throw new Error(`the beats name no place "${name}"`);
      await runSteps(steps, args);
      return true;
    },
    click: (step, ctx, verb) => press(step, verb, ctx),
    select: (step, ctx, verb) => press(step, verb, ctx),
    async wait(step, ctx) {
      const w = step.wait;
      if (w && typeof w === 'object') { await timer(flags.wait || num(value(w.seconds, ctx)) || 60, w.timer || {}, ctx); return true; }
      await sleep(num(value(w, ctx)) || 0);
      return true;
    },
    async custom(step, ctx) {
      await T().sendCustom(value(step.custom, ctx), value(step.data || {}, ctx));
      noteOf(step, ctx);
      return true;
    },
    async assert(step, ctx) {
      const what = step.assert || {};
      if (what.region !== undefined) {
        const to = value(what.region, ctx);
        if (to === 'own') { await P().restoreRegion(); return true; }   // back in the visitor's own region, and said so
        P().setRegion(to, 'asserted');
        noteOf(step, ctx);
        await P().loadColdStart();
        return true;
      }
      if (what.intent !== undefined) {
        const v = T().cur();
        if (!v) return false;
        v.intent = value(what.intent, ctx);
        noteOf(step, ctx);
        P().renderWho();
        return true;
      }
      throw new Error('assert names neither a region nor an intent');
    },
    async focus(step, ctx) {
      const f = step.focus;
      if (f && typeof f === 'object' && !Array.isArray(f)) { P().selectTab(`tab-${value(f.panel, ctx)}`); return true; }
      focusOn(arr(value(f, ctx)).map((s) => document.querySelector(s)).find(Boolean) || null);
      return true;
    },
    async publish(step, ctx) {
      const kind = value(step.publish, ctx);
      if (kind === 'reset') {
        await T().resetTenant();
        if (cfg.published) await cfg.published('reset', null);
        noteOf(step, ctx);
        return true;
      }
      const name = value(step.name, ctx);
      if (step.fixtureStep !== undefined) state.fixtureDone.add(value(step.fixtureStep, ctx));   // before the page reads the catalog
      if (cfg.publishing) await cfg.publishing(kind, name);   // the page reads the document it is about to see in force
      await T().applyBeat(kind, name, value(step.reason, ctx));
      noteOf(step, ctx);
      return true;
    },
    async ask(step, ctx) {
      const what = value(step.ask, ctx);
      if (what === 'report') { await P().loadReport(Boolean(step.build)); return true; }
      await page(what).refresh();
      return true;
    },
    async template(step, ctx) {
      page(value(step.template, ctx)).place(value(step.slots, ctx), value(step.label, ctx));
      noteOf(step, ctx);
      return true;
    },
    async call(step, ctx, verb) {
      const fn = (cfg.verbs || {})[step.call];
      if (typeof fn !== 'function') throw new Error(`the vertical has no verb "${step.call}"`);
      await fn(argsOf(step, verb, ctx), ctx);
      return true;
    },
  };
  const VERB_NAMES = Object.keys(VERBS);
  async function runSteps(steps, locals) { for (const step of arr(steps)) await runStep(step, locals || {}); }
  async function runStep(step, locals) {
    if (fault) throw new Error(fault);
    const ctx = () => ({ ...facts(), ...locals });
    if (step.each !== undefined) {
      for (const item of arr(value(step.each, ctx()))) await runSteps(step.do, { ...locals, ...(item && typeof item === 'object' ? item : { '.': item }) });
      return true;
    }
    if (!guard(step, ctx())) { if (step.else) await runSteps(step.else, locals); return false; }
    if (step.do) { await runSteps(step.do, locals); return true; }
    const verb = VERB_NAMES.find((v) => Object.prototype.hasOwnProperty.call(step, v));
    if (!verb) throw new Error(`a step names no verb: ${JSON.stringify(step).slice(0, 120)}`);
    const done = await VERBS[verb](step, ctx(), verb);
    if (done === false && step.else) await runSteps(step.else, locals);
    return done;
  }

  // ── The presses, Next, the drawer ─────────────────────────────────────────
  function renderPresses() {
    el.presses.innerHTML = beats().map((b, i) => `<button class="press${b.who === 'merch' ? ' press--merch' : b.who === 'engine' ? ' press--engine' : ''}" type="button" aria-pressed="${state.beat === i}" data-i="${i}">`
      + `<span class="n">${esc(b.no)}</span>${esc(labelOf(b))}</button>`).join('');
  }
  function renderNext() {
    const all = beats();
    const next = state.beat === null ? 0 : state.beat + 1;
    if (next >= all.length) { el.nextBeat.disabled = true; el.nextLabel.textContent = 'the walkthrough is complete'; if (dock) dock.next('', true); return; }
    el.nextBeat.disabled = false;
    el.nextLabel.textContent = `${all[next].no} · ${labelOf(all[next])}`;
    if (dock) dock.next(String(all[next].no), false);
  }
  function closeDirector() {
    const bar = el.directorHandle.closest('.director');
    bar.classList.remove('director--open');
    el.directorHandle.setAttribute('aria-expanded', 'false');
    el.directorHandle.textContent = 'All beats';
  }
  function go(i) {
    if (state.busy) return undefined;
    if (k.prove.isOpen()) k.prove.closeExplain();
    if (k.compare.isOpen()) k.compare.close();
    closeDirector();
    return runBeat(i);
  }
  async function runBeat(i) {
    const b = beats()[i];
    if (!b || state.busy) return;
    state.busy = true;
    const before = cfg.proofBefore ? cfg.proofBefore() : null;
    el.presses.querySelectorAll('.press').forEach((node, j) => node.setAttribute('aria-pressed', String(j === i)));
    el.beatNo.innerHTML = `<b class="act">Act ${b.act} &middot; ${esc((script.acts || {})[b.act] || '')}</b><span class="bn">Beat ${esc(b.no)} / ${esc(script.total || beats().length)}</span>`;
    fault = null;
    let line;
    try { line = b.line(); } catch (error) {   // nothing has acted yet: the beat stops here, its path named
      const m = stoppedBy(b, error);
      state.busy = false; renderPresses(); renderNext();
      say(m, 'bad'); if (cfg.beatFailed) cfg.beatFailed(m);
      return;
    }
    el.engineLine.innerHTML = line;
    state.lineBeat = b;
    // Every performed beat starts with a Before: the page as the room saw it when the press landed, cloned
    // before the beat acts. Its render waits until the beat has landed, so the beat's own motion is not held.
    k.compare.supersedeIdle();                     // a first-paint Before still waiting gives way to this one
    let landedNow = () => {};
    const landed = new Promise((r) => { landedNow = r; });
    await k.compare.takeBaseline('beat', () => landed).catch(() => null);
    // Only now the vertical's own preparation (lane C2): its beforeBeat may hide what the room saw (Vantage's hides
    // the rail's moved chips), and the Before above was cloned with it still on screen.
    if (cfg.beforeBeat) cfg.beforeBeat(b);
    state.fixtureStep = b.key;
    if (flags.fixtures) state.fixtureDone.add(b.key);
    say('working…');
    try {
      if (!T().cur() && !b.data.arrives) await T().ensureVisitor();
      await b.run();
      if (fault) throw new Error(fault);           // a sentence said during the beat named a path that does not resolve
      say('done', 'good');
    } catch (error) {
      const m = stoppedBy(b, error);
      say(m, 'bad');
      if (cfg.beatFailed) cfg.beatFailed(m);
    } finally {
      fault = null;
      el.cursor.classList.remove('show');
      state.busy = false;
      state.beat = i;
      renderPresses();
      renderNext();
      k.prove.captureProof(b, before);
      landedNow();                                 // the Before taken as it started may render now
    }
  }
  /** The beat's sentence about this answer, once the answer (or its receipts) bears it out; otherwise the line stays. */
  function sayAfter() { const b = state.lineBeat; const said = b && b.after ? b.after() : null; if (said) el.engineLine.innerHTML = said; }
  el.presses.addEventListener('click', (e) => { const btn = e.target.closest('.press'); if (btn) void go(Number(btn.dataset.i)); });
  el.nextBeat.addEventListener('click', () => { if (!state.busy && !el.nextBeat.disabled) void go(state.beat === null ? 0 : state.beat + 1); });
  el.directorHandle.addEventListener('click', () => {
    const bar = el.directorHandle.closest('.director');
    const open = bar.classList.toggle('director--open');
    el.directorHandle.setAttribute('aria-expanded', String(open));
    el.directorHandle.textContent = open ? 'Hide beats' : 'All beats';
  });

  // ── The tools row: what the presenter may assert by hand, and Compare ────
  function renderAsserts() {
    const regions = cfg.assertRegions ? cfg.assertRegions() : [null];
    el.assertRegion.innerHTML = '<span class="wlabel">region</span>' + regions.map((x) => `<button type="button" data-region="${esc(x || '')}" aria-pressed="${(state.ctx.region || null) === x}"`
      + ` title="${x ? (x === flags.region ? 'The rehearsal override, asserted and labelled' : 'Assert this region on the request, labelled') : 'Assert nothing: the region comes from the request'}">${esc(x || 'from the request')}</button>`).join('');
    const v = T().cur();
    // Always one answer: without the asserted context the gated offers fail closed and a module comes back short.
    el.assertIntent.innerHTML = '<span class="wlabel">intent</span>' + arr(cfg.intents).map(([key, l]) => `<button type="button" data-intent="${key}" aria-pressed="${((v && v.intent) || T().defaultIntent()) === key}">${esc(l)}</button>`).join('');
    // Compare is always enabled, and its title names the Before it will show.
    el.compareTools.innerHTML = '<span class="wlabel">compare</span><button type="button" data-tool="capture">Capture</button>'
      + `<button type="button" data-tool="compare" title="${esc(k.compare.title())}">Compare</button>`
      + arr(cfg.compareTools).map(([tool, label]) => `<button type="button" data-tool="${esc(tool)}">${esc(label)}</button>`).join('');
  }
  /** The page on screen asks again, when it is one of the vertical's pages. */
  async function askHere() { const p = (cfg.pages || {})[cfg.view ? cfg.view() : '']; if (p && p.refresh) await p.refresh(); }
  el.assertRegion.addEventListener('click', async (e) => {
    const btn = e.target.closest('button');
    if (!btn || state.busy) return;
    const to = btn.dataset.region || null;
    P().setRegion(to, to ? (to === flags.region ? 'rehearsal override' : 'asserted') : 'edge');
    await P().loadColdStart();
    await askHere();
  });
  el.assertIntent.addEventListener('click', async (e) => {
    const btn = e.target.closest('button');
    if (!btn || state.busy || !T().cur()) return;
    T().cur().intent = btn.dataset.intent || T().defaultIntent();
    T().cur().intentByHand = true;
    P().renderWho();
    if (cfg.intentAsserted) await cfg.intentAsserted(); else await askHere();
  });
  el.compareTools.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    // The same presses as the machine's own: Capture clicks it, so the compare kit's armed press is the capture.
    if (btn.dataset.tool === 'capture') el.captureBtn.click();
    if (btn.dataset.tool === 'compare') void k.compare.compareNow();
    const tool = arr(cfg.compareTools).find(([name]) => name === btn.dataset.tool);
    if (tool && typeof tool[2] === 'function') void tool[2]();
  });

  // ── The keyboard ──────────────────────────────────────────────────────────
  document.addEventListener('keydown', (e) => {
    // Compare's overlay takes its own keys (Escape closes it) and stops them there.
    if (k.compare.isOpen()) return;
    if (e.key === 'Escape') { if (k.prove.isOpen()) k.prove.closeExplain(); else if (k.sheets.isOpen() && !state.busy) void k.sheets.close(); }
    else if ((e.key === 'e' || e.key === 'E') && !k.prove.isOpen() && !state.busy && !/input|textarea/i.test((e.target && e.target.tagName) || '')) k.prove.openExplain();
  });

  return { say, performClick, ctl, clickIf, pointAt, browserBack, setBeats, validate, beats, keys, labelOf, go, runBeat, sayAfter,
    renderPresses, renderNext, renderAsserts, runSteps, render, value, dock };
}

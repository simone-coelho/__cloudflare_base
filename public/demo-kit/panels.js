// public/demo-kit/panels.js: the machine panel, the engine's side of the screen.
//
//   who and context   the visitor chip, her arm, and the context chips (region, intent, stage), each labelled
//                     with how it is known: from the request, asserted, or a rehearsal override
//   signals           her meters, read from her own profile (GET /realtime/reflex), with the entry threshold
//                     and the region's lean drawn on each track; constants from the published registry
//   arrival           the cold start: region, grain, census (shown, never scored) and the regional lean
//   session           the journey, written down as it happens
//   why these         every decision on screen with its drivers, and the full receipt behind it
//   learned           the day's report, labelled attribution, never a lift number
//   roadmap           what is built and what is designed
//
// createPanels(kit) reads from the kit's config: dimLabels, slots, api.coldstart, api.report, and the hooks
//   currentSet()          the decided set on screen (the arm chip; Why these' receipts)
//   regionalDriver()      the regional driver of the lead slot, for the λ line under the meters
//   memoryDims()          the registry's per-dimension memory, labelled compressed for the room
//   regionName(key)       a region key's name, when the vertical's documents give one
//   coldStartFixture(r)   the labelled fixture for a region, when the cold-start route does not answer
//   coldStart             { seeded: the dimensions the regional seed writes, salesOf: whose regional sales the prior
//                         waits for (default "the brand’s"), fixture: { why, label, tag } }
//   why()                 { set, lead, groups: [[head, decisions]] }: what Why these lists
//   titleOf(d)            a decision's title as the page shows it
//   report                { slots(), labels(), row(slot, id) → { key, title }, attach: { slot, rows }, holdout(), theirs }
//   roadmap               [[built | designed, name, sentence]]
//   signals               optional { byDimension: true }: "What has been signalled" draws one row per dimension, every
//                         one the registry names in its order, each with its leading value and score and the second
//                         when one exists, under a "just now" strip naming what the last event changed (the vector's
//                         diff, and the audiences the action's own answer reports entering or leaving). Without it, the
//                         panel is the top eight values, exactly as before (Vantage).
// renderVectors({ changed, trigger }) takes the action's own answer when the caller has one (affinity.changed, its trigger).
//   With dims (the answer's affinity.dims, the profile read's own shape) it draws at once without a read; with early it
//   reads at once, ahead of the page's own question. Either is an early draw, and the next plain call is the engine's read
//   that confirms it. Without either, a call is the read it always was (Vantage passes neither).
// No DOM or window access at import time.
import { arr, esc, fmt2, fmt3, hhmm, money0, num, sleep } from './util.js';

export function createPanels(k) {
  const cfg = k.config, state = k.state, flags = k.flags;
  const T = () => k.transport;
  const DIM_LABEL = cfg.dimLabels || {};
  const el = k.els(['whoChip', 'armChip', 'ctxChips', 'vectors', 'priorLine', 'coldStart', 'journey', 'whyBody', 'reportBody', 'buildReport', 'roadmap']);

  // ── This session, written down as it happens ─────────────────────────────
  function note(verb, what, detail, v = T().cur()) {
    if (!v) return;
    v.journey.push({ verb, what, detail, at: Date.now() });
    if (v === T().cur()) renderJourney();
  }
  function renderJourney() {
    const v = T().cur();
    if (!v || !v.journey.length) { el.journey.innerHTML = '<li class="journey-empty">Nobody has arrived yet.</li>'; return; }
    const cls = (verb) => (['published', 'tuned', 'asserted'].includes(verb) ? ' verb--merch' : verb === 'engine' ? ' verb--engine' : verb === 'opened' ? ' verb--open' : '');
    el.journey.innerHTML = v.journey.map((j, i) => `<li${i === v.journey.length - 1 ? ' class="fresh"' : ''}>
      <span class="verb${cls(j.verb)}">${esc(j.verb)}</span>
      <span class="what">${esc(j.what)}${j.detail ? `<em>${esc(j.detail)}</em>` : ''}</span></li>`).join('');
    const panels = el.journey.closest('.mpanels');
    if (panels && !el.journey.parentElement.hidden) panels.scrollTop = panels.scrollHeight;
  }

  // ── Who, her arm, and the context the page asserts ───────────────────────
  function renderWho() {
    const v = T().cur();
    el.whoChip.textContent = v ? `${v.label} · anonymous · consent on` : 'No visitor yet';
    el.whoChip.classList.toggle('who--b', Boolean(v && v.key !== 'A'));
    const set = cfg.currentSet ? cfg.currentSet() : null;
    if (set && set.arm) {
      el.armChip.hidden = false;
      el.armChip.textContent = `arm ${set.arm}`;
      el.armChip.classList.toggle('arm--default', set.arm !== 'personalized');
      el.armChip.title = set.arm === 'personalized' ? 'Served decisions.' : 'The holdout: the site default for this shopper.';
    } else el.armChip.hidden = true;
    const own = state.own;
    const chips = [state.ctx.region
      ? `<span title="${state.regionSource === 'rehearsal override' ? 'A rehearsal override (?region=): asserted on the request, labelled' : 'Asserted on the request, labelled: not observed'}">region <b>${esc(state.ctx.region)}</b> · ${esc(state.regionSource)}</span>`
      : own && own.key
        ? `<span title="${T().localRuntime ? 'From the request, as the local runtime fills request.cf' : 'From the request: the edge located the visitor, nothing asserted'}">region <b>${esc(own.key)}</b> · from the request</span>`
        : `<span title="Nothing asserted: the region comes from the request when it carries one">region <b>${own ? 'none on this request' : 'from the request'}</b></span>`];
    if (v && v.intent) chips.push(`<span title="Asserted, as the visitor’s account would; it gates offers and never prices">intent <b>${esc(v.intent)}</b> · asserted</span>`);
    if (v && v.stage) chips.push(`<span title="The journey stage the engine reads from the visitor’s profile">stage <b>${esc(v.stage)}</b></span>`);
    el.ctxChips.innerHTML = chips.join('');
    k.director.renderAsserts();
  }

  // ── The registry the arithmetic reads: published, never typed here ───────
  const reg = () => state.registry || {};
  const thetaIn = () => num(reg().thetaIn != null ? reg().thetaIn : 0.6);
  const thetaOut = () => num(reg().thetaOut != null ? reg().thetaOut : 0.45);
  const K = () => num(reg().K != null ? reg().K : 1.8);
  const leanShare = () => { const l = state.coldstart && state.coldstart.lean; return (l && (l.share || l.shares)) || {}; };

  // ── Her meters ────────────────────────────────────────────────────────────
  // Draws land in the order they start: a read that left before a later draw landed is not drawn over it. An early draw
  // (opts.dims, or opts.early) keeps its baseline, the vector before the event, and what the answer said; the plain read
  // that follows confirms it against the same baseline (the moved rows stay marked, the "just now" strip keeps the event's
  // answer unless the read names its own), so the engine's reading is always the last word on screen.
  let started = 0, landed = 0, early = null;
  /** The per-dimension vector an answer carries ({ category: { washers: 0.64, … }, … }), or null when it is not that shape. */
  function dimsOf(x) {
    if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
    for (const values of Object.values(x)) {
      if (!values || typeof values !== 'object' || Array.isArray(values)) return null;
      if (!Object.values(values).every((a) => typeof a === 'number' && Number.isFinite(a))) return null;
    }
    return x;
  }
  async function renderVectors(opts = {}) {
    const v = T().cur();
    if (!v) { el.vectors.innerHTML = '<p class="m-empty">No dimension has evidence yet.</p>'; if (byDimension()) justNow(null); return; }
    const mine = ++started, given = dimsOf(opts.dims), first = Boolean(given || opts.early);
    const base = v.vector || {};
    let dims = given;
    if (!given) {
      const { body } = await T().api('/realtime/reflex', undefined, { visitor: v });
      if (mine < landed) return;   // a later draw is on screen: this read left before it, and the read after that draw confirms it
      dims = (body && body.affinity && body.affinity.dims) || {};
      if (body && body.journeyStage && body.journeyStage !== v.stage) { v.stage = body.journeyStage; if (v === T().cur()) renderWho(); }
    }
    landed = mine;
    let prev = first ? base : v.vector || {};
    if (first) early = { v, prev, said: { changed: opts.changed, trigger: opts.trigger } };
    else if (early) {
      if (early.v === v) {
        prev = early.prev;
        if (!arr(opts.changed).length && !opts.trigger) opts = { ...opts, ...early.said };
      }
      early = null;
    }
    const rows = [];
    for (const [dim, values] of Object.entries(dims)) for (const [value, a] of Object.entries(values || {})) rows.push({ dim, value, a: num(a) || 0 });
    state.fresh = new Set(rows.filter((r) => Math.abs(r.a - num(((prev[r.dim] || {})[r.value]) || 0)) > 0.004).map((r) => `${r.dim}\u0000${r.value}`));
    v.vector = dims;
    if (v === T().cur()) state.lastVector = dims;
    rows.sort((x, y) => y.a - x.a);
    const lean = leanShare();
    const leanOf = (dim, value) => { const d = lean[dim] || {}; return typeof d[value] === 'number' ? d[value] : null; };
    const th = thetaIn();
    if (byDimension()) { renderDimensions(dims, prev, leanOf, th, opts); renderPrior(); return; }
    el.vectors.innerHTML = rows.length ? rows.slice(0, 8).map((r) => {
      const l = leanOf(r.dim, r.value);
      return `<div class="vecrow${state.fresh.has(`${r.dim}\u0000${r.value}`) ? ' vecrow--fresh' : ''}">
        <div class="vectop"><span>${esc(r.value)}<em>${esc(DIM_LABEL[r.dim] || r.dim)}${roomOf(r.dim) ? ` · ${esc(roomOf(r.dim))} memory` : ''}</em></span><b class="${r.a >= th ? 'over' : ''}">${r.a.toFixed(2)}</b></div>
        <div class="track"><span class="fill${r.a >= th ? ' fill--over' : ''}" style="width:${Math.min(100, r.a * 100)}%"></span>
          <span class="thresh" style="left:${th * 100}%"></span>${l !== null ? `<span class="lean" style="left:${Math.min(100, l * 100)}%" title="the region’s lean: ${Math.round(l * 100)}%"></span>` : ''}</div></div>`;
    }).join('') : '<p class="m-empty">No evidence from the visitor yet. The first paint is the region and the campaign, not the visitor.</p>';
    renderPrior();
  }
  /** The line under the meters: the region's share of the blend, the registry's constants, the memory. */
  function renderPrior() {
    const th = thetaIn();
    const reg0 = cfg.regionalDriver ? cfg.regionalDriver() : null;
    el.priorLine.innerHTML = reg0
      ? `The region (${esc(reg0.value)}) speaks for <b>λ = ${fmt2(reg0.a)}</b> of the blend, λ = K / (K + Σa): it gives way as the visitor’s own evidence grows. Hollow marks: the region’s lean. Green tick: the ${fmt2(th)} entry threshold.`
      : `a = R / (R + K) with K = ${K()}, from the published registry. Green tick: the ${fmt2(th)} entry threshold; hollow marks: the region’s lean.`;
    const mem = memoryLine();
    if (mem) el.priorLine.insertAdjacentHTML('beforeend', `<span class="memline">${mem}</span>`);
  }
  // ── The by-dimension panel (config.signals.byDimension) ───────────────────
  const byDimension = () => Boolean(cfg.signals && cfg.signals.byDimension);
  /** Every dimension the registry names, in its order; one the vector carries that the registry does not list follows. */
  function dimOrder(dims) {
    const order = arr(reg().dimensions).map((d) => d && d.key).filter(Boolean);
    const base = order.length ? order : Object.keys(DIM_LABEL);
    return [...base, ...Object.keys(dims || {}).filter((d) => !base.includes(d))];
  }
  /** A dimension's values with evidence, strongest first: the panel's leading value and its second. */
  const valuesOf = (vals) => Object.entries(vals || {}).map(([value, a]) => ({ value, a: num(a) || 0 })).filter((x) => x.a > 0).sort((x, y) => y.a - x.a);
  function renderDimensions(dims, prev, leanOf, th, opts) {
    const order = dimOrder(dims);
    el.vectors.classList.add('vectors--dims');
    el.vectors.innerHTML = order.map((dim) => {
      const [first, second] = valuesOf(dims[dim]);
      const label = `${esc(DIM_LABEL[dim] || dim)}${roomOf(dim) ? ` · ${esc(roomOf(dim))} memory` : ''}`;
      if (!first) return `<div class="vecrow vecrow--none" data-dim="${esc(dim)}"><div class="vectop"><span>—<em>${label}</em></span><b>0.00</b></div><div class="track"></div></div>`;
      const l = leanOf(dim, first.value);
      const fresh = state.fresh.has(`${dim}\u0000${first.value}`) || (second && state.fresh.has(`${dim}\u0000${second.value}`));
      return `<div class="vecrow${fresh ? ' vecrow--fresh' : ''}" data-dim="${esc(dim)}">
        <div class="vectop"><span>${esc(first.value)}<em>${label}</em>${second ? `<i class="vec2" title="the second value of ${esc(DIM_LABEL[dim] || dim)}">${esc(second.value)} ${second.a.toFixed(2)}</i>` : ''}</span><b class="${first.a >= th ? 'over' : ''}">${first.a.toFixed(2)}</b></div>
        <div class="track"><span class="fill${first.a >= th ? ' fill--over' : ''}" style="width:${Math.min(100, first.a * 100)}%"></span>
          <span class="thresh" style="left:${th * 100}%"></span>${l !== null ? `<span class="lean" style="left:${Math.min(100, l * 100)}%" title="the region’s lean: ${Math.round(l * 100)}%"></span>` : ''}</div></div>`;
    }).join('');
    justNow({ dims, prev, order, opts });
  }
  /**
   * The "just now" strip above the panel: what the last event changed, read off the vector before and after (a value new
   * to her, one that rose or fell, and whether it now leads or comes second in its dimension, "entered the panel"), and
   * the audiences the action's own answer reports entering or leaving, with its trigger. An event that moved nothing says
   * so; a read with no event and no change leaves the strip as it was.
   */
  function justNow(x) {
    let box = document.getElementById('justNow');
    if (!box && el.vectors.parentElement) { el.vectors.insertAdjacentHTML('beforebegin', '<div class="justnow" id="justNow" aria-live="polite"></div>'); box = document.getElementById('justNow'); }
    if (!box) return;
    if (!x) { box.innerHTML = ''; box.hidden = true; return; }
    const { dims, prev, order, opts } = x;
    const shown = (vector, dim) => valuesOf(vector[dim]).slice(0, 2).map((y) => y.value);
    const moved = [];
    for (const dim of order) {
      const now = dims[dim] || {}, was = prev[dim] || {};
      for (const value of new Set([...Object.keys(now), ...Object.keys(was)])) {
        const a = num(now[value]) || 0, b = num(was[value]) || 0;
        if (Math.abs(a - b) <= 0.004) continue;
        const entered = shown(dims, dim).includes(value) && !shown(prev, dim).includes(value);
        moved.push({ dim, value, a, b, d: Math.abs(a - b), entered });
      }
    }
    moved.sort((p, q) => q.d - p.d);
    // A read that follows a navigation or a page's own question with nothing new keeps the strip: it says what the last
    // event did until another event, or another change, replaces it.
    if (!moved.length && !arr(opts && opts.changed).length && !(opts && opts.trigger)) return;
    const lines = moved.slice(0, 6).map((m) => `<li><b>${esc(m.value)}</b> · ${esc(DIM_LABEL[m.dim] || m.dim)} ${m.a.toFixed(2)} <em>${m.a <= 0 ? 'left the profile'
      : m.entered ? 'entered the panel' : m.b <= 0 ? 'new' : `was ${m.b.toFixed(2)}`}</em></li>`);
    if (moved.length > 6) lines.push(`<li class="jn-more">and ${moved.length - 6} more</li>`);
    for (const c of arr(opts && opts.changed)) {
      if (!c || !c.dim) continue;
      lines.push(`<li class="jn-aud"><b>${esc(c.value)}</b> · ${esc(DIM_LABEL[c.dim] || c.dim)} <em>${c.direction === 'exit' ? 'left' : 'entered'} the audience${c.audience ? ` ${esc(c.audience)}` : ''}${c.trigger ? ` on ${esc(c.trigger)}` : ''}</em></li>`);
    }
    const trigger = opts && opts.trigger ? ` · ${esc(opts.trigger)}` : '';
    box.innerHTML = `<p class="jn-k">Just now${trigger}</p>${lines.length ? `<ul>${lines.join('')}</ul>` : '<p class="jn-none">Nothing in the profile moved on this one.</p>'}`;
    box.hidden = false;
  }
  /** The registry's per-dimension memory, as the vertical labels it: compressed for this room, days in production. */
  const memoryDims = () => arr(cfg.memoryDims ? cfg.memoryDims() : []).filter((d) => d.compressed);
  const roomOf = (dim) => { const d = memoryDims().find((x) => x.key === dim); return d ? d.room : null; };
  function memoryLine() {
    const dims = memoryDims();
    if (!dims.length) return '';
    const byRoom = new Map();
    dims.forEach((d) => byRoom.set(d.room, [...(byRoom.get(d.room) || []), DIM_LABEL[d.key] || d.key]));
    const parts = [...byRoom.entries()].map(([room, names]) => `${names.join(', ')} ${room}`);
    return ` Memory is <b>compressed for this room</b> (${esc(parts.join('; '))}); production runs days.`;
  }
  function topSignal() {
    let best = null;
    for (const [dim, values] of Object.entries(state.lastVector || {})) for (const [value, a] of Object.entries(values || {})) {
      if (!best || num(a) > best.a) best = { dim, value, a: num(a) };
    }
    return best;
  }

  // ── The arrival: region, grain, census and the regional lean ────────────
  /** The label the region wears on the page: the census row's own name when the grain is a state. */
  function coldLabel() {
    const c = state.coldstart;
    if (!c) return null;
    const cen = c.census || {};
    if (cen.label && cen.grain !== 'national') return cen.label;
    const r = c.region || {};
    return r.label || r.city || regionName(r.key) || r.key || null;
  }
  /** A region key's name, as the vertical's documents give it, else null. */
  const regionName = (key) => (cfg.regionName ? cfg.regionName(key) : null);
  const fixtureNames = () => ({ why: 'the labelled fixture is shown', label: 'a labelled fixture', tag: 'fixture', ...((cfg.coldStart || {}).fixture || {}) });
  /**
   * The Arrival panel's read. A region goes on the query only when one is asserted (a contrast beat, an
   * availability beat, the hand's assert buttons, or the ?region= rehearsal override); otherwise the route
   * reads the region the edge put on the request, and the page records that as her own.
   */
  async function loadColdStart() {
    const q = new URLSearchParams();
    if (state.ctx.region) q.set('region', state.ctx.region);
    if (flags.metro) q.set('metro', flags.metro);
    let doc = null, why = null;
    if (!flags.fixtures) {
      const r = await T().api(`${cfg.api.coldstart}${q.toString() ? `?${q}` : ''}`, undefined, { visitor: T().cur() });
      doc = r.ok && r.body && r.body.ok !== false ? r.body : null;
      if (!doc) why = `The cold-start read did not answer (${r.status}); ${fixtureNames().why}.`;
    }
    if (!doc) {
      // A fixture never names a place nobody asked for: with nothing asserted it is the no-region fixture.
      const fx = cfg.coldStartFixture ? await cfg.coldStartFixture(state.ctx.region) : null;
      if (fx) doc = { ...fx, fixture: why || fx.fixture || fixtureNames().label };
    }
    state.coldstart = doc;
    const r = (doc && doc.region) || {};
    if (doc && !state.ctx.region) state.own = { key: r.source === 'edge' && r.key ? r.key : null, label: r.source === 'edge' && r.key ? coldLabel() : null, source: r.source === 'edge' && r.key ? 'edge' : 'none' };
    else if (doc && flags.region && state.ctx.region === flags.region) state.own = { key: flags.region, label: coldLabel(), source: 'override' };
    renderColdStart();
    renderWho();
    return doc;
  }
  function renderColdStart() {
    const c = state.coldstart;
    if (!c) { el.coldStart.innerHTML = '<p class="m-empty">The cold-start read did not answer, and nothing is shown in its place.</p>'; return; }
    const LOCAL_RUNTIME = T().localRuntime;
    const r = c.region || {}, cen = c.census || {}, lean = c.lean || {};
    const leanInForce = Boolean(c.lean && Object.keys(c.lean.share || c.lean.shares || {}).length);
    const grain = typeof c.grain === 'string' ? c.grain : (c.grain && (c.grain.label || c.grain.used)) || cen.grain || '—';
    // How the region is known: a rehearsal override, asserted, from the request, or not at all.
    const override = Boolean(flags.region) && state.ctx.region === flags.region;
    const asserted = override || r.source === 'asserted' || Boolean(state.ctx.region);
    const located = !asserted && r.source === 'edge' && Boolean(r.key);
    const src = override ? 'a rehearsal override (?region=), asserted and labelled'
      : asserted ? 'asserted on the request, labelled'
        : located ? (LOCAL_RUNTIME ? 'from the request, as the local runtime fills it' : 'from the request: the edge located the visitor')
          : 'no region on this request';
    // "geo real" only when the edge located her; an asserted region is labelled as asserted, never as real,
    // and under local wrangler dev request.cf is the runtime's stand-in, so it is not called real either.
    const geoTag = asserted ? '<span class="tg tg--rep">region asserted, not observed</span>'
      : located ? (LOCAL_RUNTIME ? '<span class="tg tg--rep">region from the local runtime, not an edge</span>' : '<span class="tg tg--real">geo real</span>')
        : '<span class="tg tg--rep">no region on this request</span>';
    const shares = [];
    for (const [dim, values] of Object.entries(lean.share || lean.shares || {})) for (const [value, s] of Object.entries(values || {})) shares.push({ dim, value, s: num(s) });
    shares.sort((a, b) => b.s - a.s);
    const income = cen.medianHouseholdIncomeUsd != null ? cen.medianHouseholdIncomeUsd : cen.medianHhIncomeUsd;
    const synthetic = /synthetic/i.test(`${lean.dataSource || ''} ${lean.label || ''}`);
    // What the lean counts (seeded sales, plus this worker's own visits from the region) and the grain that
    // answered: the roll-up ladder names its grain.
    const seeded = lean.seeded && Number(lean.seeded.units) > 0 ? Number(lean.seeded.units) : 0;
    const live = Number(lean.liveEvents) || 0;
    const counted = !leanInForce || !lean.events ? '' : seeded
      ? `${seeded.toLocaleString('en-US')} synthetic sales${live ? ` + ${live.toLocaleString('en-US')} live events from the region` : ''}`
      : `${Number(lean.events).toLocaleString('en-US')} events`;
    const answered = lean.level === 'region' ? `answered at ${lean.answered}` : lean.level === 'country' ? `rolled up to ${lean.answered}` : lean.level === 'global' ? 'rolled up to everyone' : '';
    const seededDims = (cfg.coldStart || {}).seeded || 'the seeded dimensions';
    const salesOf = (cfg.coldStart || {}).salesOf || 'the brand’s';   // whose regional sales the prior waits for
    el.coldStart.innerHTML = `<div class="cold">
      <div class="cold-row"><span>Region</span><b>${esc([coldLabel(), r.key].filter(Boolean).filter((x, i, a) => a.indexOf(x) === i).join(' · ') || 'none on this request')}</b></div>
      <div class="cold-row"><span>How it is known</span><b>${esc(src)}</b></div>
      <div class="cold-row"><span>Grain used</span><b>${esc(grain)}${r.metro ? ` · metro ${esc(r.metro)}` : ''}</b></div>
      ${income != null ? `<div class="cold-row"><span>Median household income</span><b>${money0(income)}</b></div>` : ''}
      ${cen.medianHomeValueUsd != null ? `<div class="cold-row"><span>Median home value</span><b>${money0(cen.medianHomeValueUsd)}</b></div>` : ''}
      <div class="cold-row"><span>Census</span><b>${esc([cen.grain === 'national' ? cen.label : null, cen.estimate || cen.source, cen.vintage && `vintage ${cen.vintage}`].filter(Boolean).join(' · ') || '—')}</b></div>
      ${lean.lambdaForStranger != null ? `<div class="cold-row"><span>The prior’s share for a stranger</span><b>λ = ${fmt2(lean.lambdaForStranger)}</b></div>` : ''}
    </div>
    <p class="cold-h">Regional lean${leanInForce ? ` · relative to each leader · ${esc(lean.label || lean.dataSource || 'representative')}${counted ? ` · ${esc(counted)}` : ''}${answered ? ` · ${esc(answered)}` : ''}` : ''}</p>
    <div class="cold-lean" title="Each value relative to its dimension's leader in the region's sales">${shares.slice(0, 6).map((x) => `<div><span>${esc(x.value)} <em>${esc(DIM_LABEL[x.dim] || x.dim)}</em></span><i><s style="width:${Math.round(Math.min(1, x.s) * 100)}%"></s></i><b>${fmt2(x.s)}</b></div>`).join('') || `<p class="m-empty">No regional lean is in force for this region yet: the prior waits for ${esc(salesOf)} regional sales, and the page shows none rather than invent one.</p>`}</div>
    ${leanInForce && lean.seeded && lean.seeded.label ? `<p class="m-note" style="margin-top:8px">${esc(lean.seeded.label)}${lean.swapTo ? ` · swaps to the ${esc(lean.swapTo)}` : ''}</p>` : ''}
    ${live && seeded ? `<p class="m-note">Also counted: this worker’s own visits from the region (${live.toLocaleString('en-US')}), on every dimension; the seed writes only ${esc(seededDims)}.</p>` : ''}
    ${cen.fellBack ? `<p class="m-note" style="margin-top:8px">${esc(cen.fellBack)}</p>` : ''}
    ${located && LOCAL_RUNTIME ? '<p class="m-note">Local wrangler dev: request.cf is the runtime’s stand-in, not an edge’s reading of this request: Miniflare’s cached copy of Cloudflare’s location for this machine, or a fixed Austin, Texas placeholder when it cannot fetch one. Hosted, the edge locates every request.</p>' : ''}
    ${c.scored && c.scored.sentence ? `<p class="m-note">${esc(c.scored.sentence)}</p>` : ''}
    ${arr(r.notes).map((n) => `<p class="m-note">${esc(n)}</p>`).join('')}
    <p class="cold-sentence">${esc((c.sentence || 'aggregate, never the individual; we curate, never price.').replace(/^./, (x) => x.toUpperCase()))}</p>
    <div class="tags">${geoTag}<span class="tg tg--real">census real · shown, never scored</span><span class="tg tg--rep">${!leanInForce ? 'regional sales: none in force yet' : synthetic ? 'regional sales synthetic → warehouse' : 'regional sales: this worker’s own'}</span>${c.fixture ? `<span class="tg tg--fx">${esc(fixtureNames().tag)}</span>` : ''}</div>
    ${c.fixture ? `<p class="m-note" style="margin-top:8px">${esc(typeof c.fixture === 'string' ? c.fixture : fixtureNames().label)}</p>` : ''}`;
  }

  // ── Her own region, and the region the page asserts ──────────────────────
  /** Her own region: the rehearsal override when the address bar carries one, else null (nothing asserted: the request's own). */
  const ownRegion = () => flags.region || null;
  const ownSource = () => (flags.region ? 'rehearsal override' : 'edge');
  const ownName = () => (state.own && (state.own.label || state.own.key)) || (flags.region ? regionName(flags.region) || flags.region : 'the visitor’s own region');
  function setRegion(region, source) { state.ctx.region = region || null; state.regionSource = source || (region ? 'asserted' : 'edge'); renderWho(); }
  /** Back in her own region (from the request, or the rehearsal override), and said so on screen. */
  async function restoreRegion() {
    const own = ownRegion();
    if ((state.ctx.region || null) === own) return;
    setRegion(own, ownSource());
    if (own) note('asserted', `region = ${own}`, 'back in the rehearsal override’s region (?region=), labelled');
    else note('located', `back in ${ownName()}`, 'the visitor’s own region: from the request, nothing asserted');
    await loadColdStart();
  }
  /** The region a frame was decided in, with how it is known, for Compare's columns. */
  const regionShown = () => (state.ctx.region ? `${state.ctx.region} (${state.regionSource === 'rehearsal override' ? 'rehearsal override' : 'asserted'})`
    : state.own && state.own.key ? `${state.own.key} (from the request)` : null);
  /** Where an availability chip says the offer is served: the region's own label, else the asserted key. */
  const regionLabel = () => coldLabel() || state.ctx.region || 'your area';

  // ── The receipt's vocabulary, shared by every card, row and panel ───────
  /**
   * The arrival seeds a receipt records (`explain.contextual`), named for what
   * fired. `applied` is what they moved the score together, measured where it
   * lands. With more than one seed firing (a campaign and a platform seed), a
   * single name carries that total only when that seed alone contributed;
   * otherwise the total is "seeds" and each one is listed.
   */
  const SEED_NAME = { campaign_term: 'campaign', platform: 'platform', entry_channel: 'channel', referrer_network: 'referrer' };
  function seedsFired(c) {
    const by = new Map();
    for (const x of arr(c && c.drivers)) {
      const key = SEED_NAME[x.signal] || String(x.signal || 'seed').replace(/_/g, ' ');
      by.set(key, (by.get(key) || 0) + num(x.contribution));
    }
    return [...by].filter(([, v]) => v > 0);
  }
  /** `campaign +0.066` on a desktop; `seeds +0.231 (campaign · platform)` when both fired. Plain text; `bold` wraps the figure. */
  function seedLabel(c, bold) {
    const fired = seedsFired(c), figure = bold ? `<b>+${fmt3(c.applied)}</b>` : `+${fmt3(c.applied)}`;
    return fired.length === 1 ? `${fired[0][0]} ${figure}` : `seeds ${figure}${fired.length ? ` (${fired.map(([key]) => key).join(' · ')})` : ''}`;
  }
  /** Her own evidence, as opposed to the context around her (region, merchandising, stage, freshness, fatigue). */
  const OWN = (x) => !['regional', 'merchandising', 'stage', 'freshness', 'fatigue', 'external'].includes(x.dim);
  /** An answer she gave with a control (the buy box's toggle) is declared, not observed: the receipt line says so. */
  const declaredMark = (x) => (x && x.dim === 'intent' && T().cur() && T().cur().declared && T().cur().declared.has(x.value) ? ' (declared)' : '');
  function driverSummary(d, n) {
    const drivers = (d.explain && d.explain.drivers) || [];
    const own = drivers.filter(OWN).sort((a, b) => num(b.a) * num(b.weight) - num(a.a) * num(a.weight)).slice(0, n).map((x) => `${esc(DIM_LABEL[x.dim] || x.dim)} ${esc(x.value)}${declaredMark(x)}`);
    const r = drivers.find((x) => x.dim === 'regional');
    const merch = drivers.find((x) => x.dim === 'merchandising');
    return [...own, ...(r ? [`region ${esc(r.value)}`] : []), ...(merch ? ['promotion weight'] : [])].join(' · ');
  }

  // ── Why these: every decision on screen, and the record behind it ────────
  function whyRows(decisions) {
    return decisions.map((d, i) => {
      const title = cfg.titleOf ? cfg.titleOf(d) : d.customerContentId;
      const lines = ((d.explain && d.explain.drivers) || []).map((x) => `<span${x.dim === 'regional' ? ' class="reg"' : ''}>${esc(DIM_LABEL[x.dim] || x.dim)} ${esc(x.value)}${declaredMark(x)} <b>${fmt3(num(x.a) * num(x.weight))}</b></span>`);
      const rec = d.decisionId && state.receipts.get(d.decisionId);
      const ex = (rec && rec.explain) || {};
      if (ex.contextual && num(ex.contextual.applied) > 0) {
        lines.push(`<span class="ctx">${esc(seedLabel(ex.contextual))} applied: ${arr(ex.contextual.drivers).map((x) => `${esc(String(x.signal).replace(/_/g, ' '))} “${esc(x.value)}” → ${esc(x.dimension)} ${esc(x.tag)} +${fmt3(x.contribution)} at entry${arr(x.dampened).length ? ` (dampened ${arr(x.dampened).map((m) => `×${fmt2(m.factor)}: the visitor holds ${esc(m.dimension)} ${esc(m.value)}`).join(', ')})` : ''}`).join('; ')}</span>`);
      }
      if (ex.regional) lines.push(`<span class="reg">regional prior ${esc(ex.regional.region)} (${esc(ex.regional.level)}) λ ${fmt2(ex.regional.lambda)} +${fmt3(ex.regional.contribution)}</span>`);
      for (const key of ['merchandising', 'stage', 'freshness', 'fatigue']) if (ex[key] && ex[key].sentence) lines.push(`<span>${esc(ex[key].sentence)}</span>`);
      const div = (ex.diversity && ex.diversity.sentence) || (d.explain && d.explain.diversity && d.explain.diversity.sentence);
      if (div) lines.push(`<span>${esc(div)}</span>`);
      if (d.explain && d.explain.note) lines.push(`<span>${esc(d.explain.note)}</span>`);
      if (ex.score_base != null) lines.push(`<span>base ${fmt3(ex.score_base)} → final ${fmt3(ex.score_final)}${ex.lift && ex.lift.gamma != null ? ` · γ ${ex.lift.gamma}` : ''}${rec.authority ? ` · authority ${esc(rec.authority)}` : ''}</span>`);
      if (rec && rec.asserted) lines.push(`<span class="asr">asserted, not observed: ${Object.entries(rec.asserted).map(([key, x]) => `${esc(key)} = ${esc(x.value)} (${x.from === 'record' ? 'on the record' : 'as the page asked'})`).join(' · ')}</span>`);
      if (!lines.length) lines.push(d.strategy === 'tenant-pinned' ? 'pinned: ranking never ran for it' : d.strategy === 'site' ? 'the site’s own default: no visitor, no decision' : 'no dimension has evidence yet: the catalog’s order, the same for everyone');
      return `<div class="drv"><div class="drvtop"><span class="pos${d.strategy === 'tenant-pinned' ? ' pos--pin' : ''}">${i + 1}</span><span class="drvname">${esc(title)}</span></div>
        <div class="drvline">${lines.join('<br>')}</div></div>`;
    }).join('');
  }
  function renderWhy() {
    const w = (cfg.why && cfg.why()) || { set: null, groups: [] };
    const parts = [];
    if (w.lead) parts.push(`<div class="hinge">${w.lead.replace(/<\/?li[^>]*>/g, '')}</div>`);
    for (const [head, decisions] of arr(w.groups)) parts.push(`<p class="why-h">${esc(head)}</p>${whyRows(decisions)}`);
    el.whyBody.innerHTML = parts.join('') || '<p class="m-empty">Press a beat to begin.</p>';
    const set = w.set;
    const missing = set ? set.decisions.filter((d) => d.decisionId && !state.receipts.has(d.decisionId)).length : 0;
    if (missing) el.whyBody.insertAdjacentHTML('beforeend', `<p class="m-note" style="margin-top:10px">${missing} full receipt${missing === 1 ? ' is' : 's are'} still being written to the ledger (it records just after the answer). Above is the thin receipt the snapshot itself carries.</p>`);
  }

  // ── What it learned: the day report, labelled what it is ─────────────────
  /**
   * The ledger is partitioned by UTC day, and one whole day is the narrowest
   * window the engine builds a report for (it has no slot or hour filter), so the
   * window is the UTC day of the clicks. The build is asked once, with the first
   * report slot; the other slots are read from the day it built, never rebuilt,
   * and only when that answered. A refusal is shown once, as itself.
   */
  const R = () => cfg.report || {};
  const labelOf = (slot) => ((R().labels ? R().labels() : {})[slot]) || slot;
  async function loadReport(build) {
    const date = new Date().toISOString().slice(0, 10);
    el.reportBody.innerHTML = '<p class="m-empty">Reading the ledger&hellip;</p>';
    const slots = R().slots ? R().slots() : [];
    if (flags.fixtures) { renderReport(slots.map((slot) => ({ slot, error: 'fixture mode: the report is read from a live ledger only' })), date); return; }
    let lead;
    try { lead = await T().demoRoute(cfg.api.report, { date, slot: slots[0], build: Boolean(build) }); }
    catch (error) { renderReportRefused(error, date, slots[0]); return; }
    const reports = [{ slot: slots[0], report: lead.report }];
    for (const slot of slots.slice(1)) {
      try { reports.push({ slot, report: (await T().demoRoute(cfg.api.report, { date, slot })).report }); }
      catch (error) { reports.push({ slot, error: String(error.message || error) }); }
    }
    renderReport(reports, date);
  }
  /** The report's own window, as the report states it: its UTC day, what it was read from, when it was built, what it holds. */
  function reportWindowLine(rep, date) {
    if (!rep) return `<p class="rep-window"><b>Window</b>the UTC day ${esc(date)}</p>`;
    const h = rep.hours || {}, c = rep.counts || {};
    const two = (n) => String(n).padStart(2, '0');
    const built = arr(h.built), missing = arr(h.missing);
    const from = h.source === 'aggregates'
      ? `summed from the folded hours${built.length ? ` ${two(Math.min(...built))}:00–${two(Math.max(...built) + 1)}:00 UTC` : ''}; the hour in progress is not in it until it closes${missing.length ? `, and ${missing.map(two).join(', ')} UTC ${missing.length === 1 ? 'is' : 'are'} not folded yet` : ''}`
      : 'read from the ledger itself: everything recorded until it was built';
    const counts = [c.decisions, c.outcomes, c.visitors].every((n) => typeof n === 'number')
      ? ` · ${c.decisions.toLocaleString('en-US')} decisions, ${c.outcomes.toLocaleString('en-US')} outcomes, ${c.visitors.toLocaleString('en-US')} visitors` : '';
    return `<p class="rep-window"><b>Window</b>the UTC day ${esc(rep.date || date)} · ${from}${rep.builtAt ? ` · built ${esc(hhmm(rep.builtAt))}` : ''}${counts}</p>`;
  }
  /** The build or read was refused: the engine's reason, once, where the report would be. No older count stands in for it. */
  function renderReportRefused(error, date, slot) {
    const b = (error && error.body) || {};
    const head = `<p class="rep-k">${esc(labelOf(slot))} · ${esc(date)}</p>`;
    if (b.code !== 'report_too_large') { el.reportBody.innerHTML = `${head}<p class="m-empty">${esc(String((error && error.message) || error))}</p>`; return; }
    const w = b.window || {};
    const unit = /bytes$/i.test(String(b.budget || '')) ? ' bytes' : '';
    const amount = (n) => (typeof n === 'number' ? `${n.toLocaleString('en-US')}${unit}` : '—');
    el.reportBody.innerHTML = `${reportWindowLine(null, w.date || date)}${head}
      <p class="m-empty rep-refused"><b>Report too large for the window (413).</b> The engine builds a report for one whole ${esc(w.unit || 'UTC day')}, ${esc(w.date || date)}: the narrowest window it accepts. This day’s ledger is past its report budget (${esc(b.budget || 'a budget')}: ${amount(b.observed)} against ${amount(b.limit)}), so it cannot be built on demand, and the page shows no older count in its place.</p>`;
  }
  function reportRows(rep, slot) {
    const grid = (rep && rep.grids && rep.grids[slot] && rep.grids[slot].learning) || null;
    return Object.entries((grid && grid.items) || {}).map(([id, cells]) => {
      const c = cells['*'] || Object.values(cells)[0] || {};
      const named = R().row ? R().row(slot, id) : { key: id, title: id };
      return { key: String(named.key), title: named.title, n: num(c.n) || 0, s: num(c.s) || 0, rate: typeof c.p_hat === 'number' ? c.p_hat : null };
    }).sort((a, b) => b.n - a.n);
  }
  function renderReport(reports, date) {
    let contract = null, measurement = null;
    const attachCfg = R().attach || null;
    const blocks = reports.map(({ slot, report, error }) => {
      if (error) return `<p class="rep-k">${esc(labelOf(slot))}</p><p class="m-empty">${esc(error)}</p>`;
      contract = contract || report.attributionContract || null;
      measurement = measurement || report.measurement || null;
      const rows = reportRows(report, slot);
      const table = rows.length ? `<div class="rep-row rep-head"><span>Item</span><span class="n">shown</span><span class="s">clicks</span><span class="r">est. rate</span></div>`
        + rows.map((r) => `<div class="rep-row"><span class="nm" title="${esc(r.title)}">${esc(r.title)}</span><span class="n">${r.n.toFixed(0)}</span><span class="s">${r.s.toFixed(0)}</span><span class="r">${r.rate === null ? '&mdash;' : `${(r.rate * 100).toFixed(1)}%`}</span></div>`).join('')
        : '<p class="m-empty">Nothing recorded for this slot yet today.</p>';
      let attach = '';
      if (attachCfg && slot === attachCfg.slot && rows.length) {
        const row = (key, name) => { const r = rows.find((x) => x.key.toLowerCase().includes(key)); return r ? `<div class="rep-row"><span class="nm">${esc(name)}</span><span class="n">${r.n.toFixed(0)}</span><span class="s">${r.s.toFixed(0)}</span><span class="r">${r.n ? `${((r.s / r.n) * 100).toFixed(1)}%` : '&mdash;'}</span></div>` : ''; };
        attach = arr(attachCfg.rows).map(([key, name]) => row(key, name)).join('');
        if (attach) attach = `<p class="rep-k">${esc(attachCfg.head || 'Attach and mix · clicks per exposure')}</p>${attach}`;
      }
      return `<p class="rep-k">${esc(labelOf(slot))} · ${esc(report.date || date)}</p>${table}${attach}`;
    }).join('');
    const h = (contract && contract.history) || {};
    const holdout = R().holdout ? R().holdout() : null;
    const first = (reports.find((r) => r.report) || {}).report || null;
    el.reportBody.innerHTML = `${reportWindowLine(first, date)}${blocks}
      <div class="rep-contract">credit <b>${esc(h.credit || 'last')}</b> touch · match <b>${esc(h.match || 'direct')}</b> · scope <b>${esc(h.scope || 'session')}</b>${holdout != null ? ` · holdout on stage <b>${Math.round(num(holdout) * 100)}%</b>, a setting` : ''}</div>
      <div class="rep-flag"><b>Attribution, not incrementality.</b> The engine labels its own report <code>${esc((measurement && measurement.kind) || 'attribution_diagnostic')}</code> with inference <code>${esc((measurement && measurement.inference) || 'unavailable')}</code>: credited clicks per promotion and per module, never a lift number.</div>
      ${R().theirs ? `<p class="rep-theirs">${esc(R().theirs)}</p>` : ''}`;
  }
  function renderRoadmap() {
    const items = arr(cfg.roadmap);
    el.roadmap.innerHTML = items.map(([s, b, t]) => `<li class="${s === 'built' ? 'built' : ''}"><span class="dialflag${s === 'built' ? ' dialflag--built' : ''}">${s}</span><b>${esc(b)}</b><span>${esc(t)}</span></li>`).join('');
  }

  // ── The tabs ──────────────────────────────────────────────────────────────
  const tabs = Array.from(document.querySelectorAll('.mtabs button'));
  function selectTab(id) {
    tabs.forEach((t) => {
      const on = t.id === id;
      t.setAttribute('aria-selected', String(on));
      const panel = document.getElementById(t.getAttribute('aria-controls'));
      if (panel) panel.hidden = !on;
    });
    if (id === 'tab-why') { renderWhy(); const set = cfg.currentSet ? cfg.currentSet() : null; if (set) void T().prefetchReceipts(set.decisions, set.asked).then(renderWhy); }
  }
  tabs.forEach((t) => t.addEventListener('click', () => selectTab(t.id)));
  if (el.buildReport) el.buildReport.addEventListener('click', () => { void loadReport(true); });

  return {
    note, renderJourney, renderWho, thetaIn, thetaOut, K, reg, renderVectors, roomOf, memoryLine, topSignal,
    coldLabel, regionName, loadColdStart, renderColdStart, ownRegion, ownSource, ownName, setRegion, restoreRegion, regionShown, regionLabel,
    SEED_NAME, seedsFired, seedLabel, OWN, declaredMark, driverSummary, whyRows, renderWhy,
    loadReport, renderReport, renderRoadmap, selectTab, sleep,
  };
}

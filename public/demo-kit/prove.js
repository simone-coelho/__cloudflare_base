// public/demo-kit/prove.js: predict, then prove.
//
// The arithmetic is published, so a touch's effect can be stated before it
// happens and checked by hand: a = R / (R + K), each action adding its weight to
// R on every dimension the event's attributes touch. The constants (K, the entry
// and exit thresholds) and the action weights are READ from the published
// registry (state.registry, which the vertical loads), never typed here; each row
// reads its own dimension's K and θin where the registry sets them per dimension,
// as the engine does, and names it beside its threshold.
//
// Explain (the director's button, or E anywhere) opens the panel before the next
// press: what the visitor has done, what we are watching for with its arithmetic
// computed from her real profile, and what will change if she does it. Below it,
// what the engine actually did on the last press, read off its receipts: every
// decision with its drivers, its place against the press before, and who decided
// it (the engine, a rule then the engine, the merchandiser's pin, the catalog's
// order). Nothing runs from this panel.
//
// createProve(kit) reads the beat's own declare / acts / will / target (the director renders them from the
// beats file) and these hooks from the config:
//   proofBefore()     what was on screen as a press started (handed back to proof)
//   proof(before)     { set, decisions, beforeRows, main, context, unitOf(d), titleOf(d), ruleOf(d) }: the last press
//   standing(target)  the line saying where the beat's target stands right now
//   nowMap()          { label, rows } or { label, empty }: what is on screen right now
// No DOM or window access at import time.
import { esc, fmt2, fmt3, num } from './util.js';

export function createProve(k) {
  const cfg = k.config, state = k.state, flags = k.flags;
  const P = () => k.panels;
  const DIM_LABEL = cfg.dimLabels || {};
  const el = k.els(['pdBack', 'pdMode', 'pdDone', 'pdAct', 'pdArith', 'pdArithK', 'pdWill', 'pdNow', 'pdNowK',
    'pdWhyWrap', 'pdWhy', 'pdWhyHead', 'pdMapNow', 'pdMapAfter', 'pdGo', 'pdPill', 'pdNote', 'explainBtn']);
  const K = () => P().K();
  const thetaIn = () => P().thetaIn();
  const kOf = (dim) => P().kOf(dim);             // the dimension's own K, else the registry's (the engine's rule)
  const thetaInOf = (dim) => P().thetaInOf(dim);
  /** With K set per dimension each row names its own beside its threshold ("θ 0.45 · K 3"), and the caption says so in one line. */
  const perDimK = () => Boolean(P().kGroups());
  const kCaption = () => (perDimK() ? 'K per dimension, on each row' : `K = ${K()}`);
  /** A row's K, padded to the widest on the card (mono, non-breaking) so the rows' boxes stay in one column. */
  const kCell = (k, rows) => { const w = Math.max(...rows.map((r) => String(r.K).length)); return `K ${String(k).padEnd(w, ' ')}`; };
  const labelOf = (b) => (typeof b.label === 'function' ? b.label() : b.label);

  const rOf = (a, k) => (a >= 1 ? Infinity : (a * k) / (1 - a));
  const aOf = (r, k) => r / (r + k);
  /** The touches an event's attributes make, dimension by dimension, as the registry reads them. */
  function touchesOf(attrs) {
    const out = [];
    for (const spec of (P().reg().dimensions || [])) {
      const raw = attrs[spec.source];
      if (raw === undefined || raw === null) continue;
      if (spec.derive === 'band') {
        const n = num(raw);
        if (!Number.isFinite(n) || !spec.cuts || !spec.labels) continue;
        let idx = spec.cuts.findIndex((c) => n < c); if (idx === -1) idx = spec.cuts.length;
        if (spec.labels[idx]) out.push({ dim: spec.key, value: spec.labels[idx] });
      } else if (Array.isArray(raw)) raw.forEach((x) => { if (typeof x === 'string' && x) out.push({ dim: spec.key, value: x }); });
      else if (typeof raw === 'string' && raw) out.push({ dim: spec.key, value: raw });
    }
    return out;
  }
  function predictArithmetic(acts) {
    const w = P().reg().weights || {};
    const added = new Map();
    acts.forEach((a) => {
      const weight = num(w[a.action || a.type] != null ? w[a.action || a.type] : 0);
      if (!weight) return;
      touchesOf(a.attrs || {}).forEach((t) => { const key = `${t.dim}\u0000${t.value}`; added.set(key, (added.get(key) || 0) + weight); });
    });
    return [...added.entries()].map(([key, delta]) => {
      const [dim, value] = key.split('\u0000');
      const before = num(((state.lastVector[dim] || {})[value]) || 0);
      const k = kOf(dim), th = thetaInOf(dim);
      const after = aOf(rOf(before, k) + delta, k);
      return { dim, value, before, after, delta, K: k, thetaIn: th, crosses: before < th && after >= th };
    }).sort((x, y) => y.after - x.after);
  }
  /** Each position in the before and after maps wears its own colour, from the token sheet (--pd-slot-1 to -6). */
  const slotColour = (i) => `var(--pd-slot-${(i % 6) + 1})`;
  const mapHtml = (rows) => (rows && rows.length ? rows.map((r, i) => `<div class="pd-slot" style="background:${slotColour(i)}" title="${esc(r)}">${i + 1} · ${esc(r)}</div>`).join('') : '<p class="pd-empty" style="font-size:12.5px">nothing yet</p>');

  function renderPredict(b) {
    if (!b) {
      el.pdMode.textContent = 'the walkthrough is complete';
      el.pdAct.innerHTML = '<li class="pd-empty">No press remains.</li>';
      el.pdArith.innerHTML = '';
      el.pdWill.innerHTML = '<li class="pd-empty">&mdash;</li>';
      renderDone(); return;
    }
    const acts = b.acts ? b.acts() : [];
    el.pdMode.textContent = `before beat ${b.no}: ${labelOf(b)}`;
    renderDone();
    el.pdAct.innerHTML = (b.declare ? b.declare() : [labelOf(b)]).map((l) => `<li>${l}</li>`).join('');
    const rows = predictArithmetic(acts);
    el.pdArithK.textContent = `The arithmetic · score before → after · entry threshold ${fmt2(thetaIn())} · ${kCaption()} · from ${state.sources.registry || 'the shipped constants'}`;
    const kOn = perDimK();
    el.pdArith.innerHTML = rows.length ? rows.map((r) => `<div class="pd-row${r.crosses ? ' crosses' : ''}"><span>${esc(DIM_LABEL[r.dim] || r.dim)} · ${esc(r.value)}</span>
      <span class="from">${r.before.toFixed(3)} + ${r.delta} →</span><span class="to">${r.after.toFixed(3)}</span><span class="th">θ ${fmt2(r.thetaIn)}${kOn ? ` · ${kCell(r.K, rows)}` : ''}</span></div>`).join('')
      : `<p class="pd-empty" style="font-size:12.5px">${b.who === 'merch' ? 'This press is the merchandiser or the request’s context, not the visitor: no meter moves.' : b.who === 'engine' ? 'Nothing is sent. The engine’s own clock does this one.' : 'A page view that carries no attribute, or a reward: no meter moves.'}</p>`;
    const target = b.target && b.target();
    const standing = target && cfg.standing ? cfg.standing(target) : '';
    el.pdWill.innerHTML = standing + (b.will ? b.will() : []).map((w) => `<li>${w}</li>`).join('');
    const now = cfg.nowMap ? cfg.nowMap() : { label: 'On screen right now', empty: '' };
    el.pdNowK.textContent = now.label;
    el.pdNow.innerHTML = now.rows ? mapHtml(now.rows) : now.empty;
  }
  function renderDone() {
    const v = k.transport.cur();
    el.pdDone.innerHTML = v && v.journey.length ? v.journey.map((j) => `<li><b>${esc(j.verb)}</b> ${esc(j.what)}${j.detail ? `<div class="pd-tags">${esc(j.detail)}</div>` : ''}</li>`).join('')
      : '<li class="pd-empty">Nothing yet: the visitor has not arrived.</li>';
  }
  /** Every decision the last press made, with its drivers, its place against the press before, and who decided it. */
  function captureProof(b, before) {
    const p = cfg.proof ? cfg.proof(before) : null;
    if (!p || !p.decisions.length) { state.pdProof = null; return; }
    const beforeIds = p.beforeRows.map((x) => x.id);
    const authority = (d) => (flags.fixtures ? { cls: 'fixture', text: 'fixture' } : d.strategy === 'tenant-pinned' ? { cls: 'pinned', text: 'merchandiser · pinned' }
      : d.strategy === 'default' ? { cls: 'default', text: 'catalog order' }
        : p.ruleOf(d) ? { cls: 'rule', text: 'rule, then engine' } : { cls: 'engine', text: 'engine' });
    const rows = p.decisions.map((d) => {
      const i = k.transport.bySlot(p.set, d.slot).indexOf(d);
      const title = p.titleOf(d);
      const drivers = (d.explain && d.explain.drivers) || [];
      const why = drivers.length ? drivers.map((x) => `${esc(DIM_LABEL[x.dim] || x.dim)}·${esc(x.value)} ${fmt3(x.a)} × ${x.weight}`).join('<br>') + `<br>score ${fmt3(d.score)}`
        : d.strategy === 'tenant-pinned' ? 'ranking never ran for it' : 'no dimension has evidence · the catalog’s order';
      const was = beforeIds.indexOf(d.customerContentId);
      const against = p.context.includes(d.slot) ? `slot ${d.slot}` : was === -1 ? 'entered this press' : was === i ? 'held its place' : was > i ? `up from ${was + 1}` : `down from ${was + 1}`;
      const a = authority(d);
      return `<tr><td class="what">${esc(title)} → ${p.unitOf(d)} ${i + 1}</td><td class="num">${why}</td><td class="against">${esc(against)}</td><td><span class="pd-auth pd-auth--${a.cls}">${esc(a.text)}</span></td></tr>`;
    }).join('');
    state.pdProof = { label: `${b.no} · ${labelOf(b)}`, why: rows, now: mapHtml(p.beforeRows.map((x) => x.title)), after: mapHtml(p.main) };
  }
  function openExplain() {
    const next = state.beat === null ? 0 : state.beat + 1;
    renderPredict(k.director.beats()[next]);
    if (state.pdProof) {
      el.pdWhy.innerHTML = state.pdProof.why;
      el.pdMapNow.innerHTML = state.pdProof.now;
      el.pdMapAfter.innerHTML = state.pdProof.after;
      el.pdWhyHead.textContent = `Why: every decision the last press made (${state.pdProof.label})`;
      el.pdWhyWrap.hidden = false;
    } else el.pdWhyWrap.hidden = true;
    el.pdNote.textContent = `Above: computed from the visitor’s real profile on the published registry: a = R / (R + K), ${perDimK() ? 'K on each row' : `K = ${K()}`}, checkable by hand. Below: what the engine actually did on the last press, read off its receipts. Nothing runs from this panel.`;
    el.pdBack.hidden = false;
  }
  const closeExplain = () => { el.pdBack.hidden = true; };
  const isOpen = () => Boolean(el.pdBack && !el.pdBack.hidden);

  el.pdGo.addEventListener('click', closeExplain);
  el.pdBack.addEventListener('click', (e) => { if (e.target === el.pdBack) closeExplain(); });
  el.pdPill.addEventListener('click', openExplain);
  el.explainBtn.addEventListener('click', openExplain);
  return { openExplain, closeExplain, isOpen, captureProof, renderPredict, predictArithmetic, touchesOf, mapHtml };
}

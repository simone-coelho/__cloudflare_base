// public/demo-kit/deltas.js: the before/now row and the moved chips, keyed by slot.
//
// Every decided module carries a strip: what was on screen before this press
// (thumbnails of the cards, or the old order as a list) and what changed (what
// left and why, what entered, what moved, what changed its creative). Each card
// that moved says so on its own face with a chip. When nothing moved, the strip
// says what the answer did to the scores instead, so a withdrawal that moves
// nothing is still read off the engine; and when nothing moved at all, it says
// her strongest signal and where it stands against the entry threshold.
//
// createDeltas(kit) reads config.rows(), a map keyed by slot name, each row:
//   state()      the object holding { previous, current, prevDecisions, curDecisions } for the slot
//   get()        { before, after, prev, now }: the ordered items ({ id, title, art }) before and now
//   set()        the decided set on screen (for the hinge: its decisions, in order)
//   mode         'ghosts' (thumbnails, as cards have) or 'list' (the old order, as modules have)
//   before, deltas   the two elements of the strip
//   unit         'container' or 'position'
//   pins, swaps  chips and rows for a pinned card and a new creative under the same content id
//   leftFirst    list what left before what entered and moved
//   tight        rows with no white space between the sign and the sentence
//   opening      the row shown when there is no before ({ sign, cls, what, why })
//   first(g)     the sentence shown when there is no before, in place of the rows
//   emptyBefore  what the before half says when she had not seen the module
//   left(b, i)   why an item left
//   extra(g)     further rows (a nested slot's leader)
//   lead()       lines above the rows (the engine's own note)
//   held         { title(d), index(d) }: the scores that moved when the order held
//   nothing      a sentence (HTML) when nothing moved, or { text } to follow with her strongest signal
//   pending      what the strip says off its page ('the homepage has not been asked again yet')
//   beforeRow    { row, label, four, card(d, i) }: the before row at full size, toggled by its thumbnails
//   title(d), titleOfId(id)   titles for the hinge's sentence
// No DOM or window access at import time.
import { arr, esc, fmt2, fmt3, num } from './util.js';

export function createDeltas(k) {
  const cfg = k.config, state = k.state;
  const P = () => k.panels;
  const T = () => k.transport;
  const DIM_LABEL = cfg.dimLabels || {};
  const row = (slot) => ((cfg.rows ? cfg.rows() : {})[slot]) || null;

  /** One press on a slot: what was now becomes before. With decisions, the decided lists rotate too. */
  function rotate(slot, now, decisions) {
    const R = row(slot);
    if (!R) return;
    const S = R.state();
    S.previous = S.current; S.current = now;
    if (decisions !== undefined) { S.prevDecisions = S.curDecisions; S.curDecisions = decisions; }
  }

  /** The chip on each card that moved, by id: new, ↑n, ↓n, and where the row names them, pinned and new creative. */
  function moves(slot, before, after, decisions) {
    const R = row(slot) || {};
    const out = {};
    if (!before) return out;
    const ids = before.map((b) => b.id);
    after.forEach((a, i) => {
      const was = ids.indexOf(a.id);
      if (R.pins && decisions && decisions[i] && decisions[i].strategy === 'tenant-pinned' && was !== i) out[a.id] = { cls: 'pin', text: 'pinned' };
      else if (was === -1) out[a.id] = { cls: 'in', text: 'new' };
      else if (R.swaps && (before[was].title !== a.title || before[was].art !== a.art)) out[a.id] = { cls: 'swap', text: 'new creative' };
      else if (was > i) out[a.id] = { cls: 'up', text: `↑${was - i}` };
      else if (was < i) out[a.id] = { cls: 'down', text: `↓${i - was}` };
    });
    return out;
  }
  const chipHtml = (mv) => (mv ? `<span class="delta-chip delta-chip--${mv.cls}">${esc(mv.text)}</span>` : '');

  /** What changed, row by row: what left (and why), what entered, what changed its creative, what moved. */
  function diffRows(slot, before, after) {
    const R = row(slot) || {}, unit = R.unit || 'position';
    const out = [];
    const beforeIds = before.map((b) => b.id), afterIds = after.map((a) => a.id);
    const left = () => before.forEach((b, i) => { if (!afterIds.includes(b.id)) out.push({ sign: '−', cls: 'out', what: b.title, why: R.left ? R.left(b, i) : `left ${unit} ${i + 1}` }); });
    if (R.leftFirst) left();
    after.forEach((a, i) => {
      const was = beforeIds.indexOf(a.id);
      if (was === -1) { out.push({ sign: '+', cls: 'in', what: a.title, why: `entered at ${unit} ${i + 1}` }); return; }
      if (R.swaps && (before[was].title !== a.title || before[was].art !== a.art)) out.push({ sign: '⟳', cls: 'swap', what: a.title, why: 'same content id, new creative' });
      if (was > i) out.push({ sign: '↑', cls: 'up', what: a.title, why: `${unit} ${was + 1} → ${i + 1}` });
      else if (was < i) out.push({ sign: '↓', cls: 'down', what: a.title, why: `${unit} ${was + 1} → ${i + 1}` });
    });
    if (!R.leftFirst) left();
    return out;
  }
  const rowsHtml = (rows, tight) => rows.map((r) => (tight
    ? `<li><span class="sign sign--${r.cls}">${r.sign}</span><span><b>${esc(r.what)}</b> <em>${esc(r.why)}</em></span></li>`
    : `<li><span class="sign sign--${r.cls}">${r.sign}</span>
      <span><b>${esc(r.what)}</b> <em>${esc(r.why)}</em></span></li>`)).join('');

  /** How one decision's own drivers moved between two answers: the largest fall, and what carries it now. */
  function driverShift(d0, d1) {
    const OWN = P().OWN;
    const key = (x) => `${x.dim}\u0000${x.value}`;
    const m1 = new Map(((d1.explain && d1.explain.drivers) || []).filter(OWN).map((x) => [key(x), x]));
    const drops = ((d0.explain && d0.explain.drivers) || []).filter(OWN)
      .map((x) => ({ x, b: num(x.a), a: m1.has(key(x)) ? num(m1.get(key(x)).a) : 0 }))
      .filter((r) => r.b - r.a > 0.1).sort((p, q) => (q.b - q.a) - (p.b - p.a));
    const carry = [...m1.values()].sort((p, q) => num(q.a) * num(q.weight) - num(p.a) * num(p.weight))[0];
    return [drops[0] && `${DIM_LABEL[drops[0].x.dim] || drops[0].x.dim} ${drops[0].x.value} ${fmt2(drops[0].b)} → ${fmt2(drops[0].a)}`,
      carry && `${DIM_LABEL[carry.dim] || carry.dim} ${carry.value} carries it`].filter(Boolean).map((s) => esc(s)).join(' · ');
  }
  /** The order held: what the answer did to each score that moved by a hundredth or more. */
  function heldRows(slot) {
    const R = row(slot), S = R.state(), unit = R.unit || 'position';
    const was = new Map((S.prevDecisions || []).map((d) => [d.customerContentId, num(d.score)]));
    return (S.curDecisions || []).filter((d) => was.has(d.customerContentId) && Math.abs(num(d.score) - was.get(d.customerContentId)) >= 0.01)
      .map((d) => `<li><span class="sign sign--${num(d.score) < was.get(d.customerContentId) ? 'down' : 'up'}">${num(d.score) < was.get(d.customerContentId) ? '↘' : '↗'}</span>
          <span><b>${esc(R.held.title(d))}</b> <em>held ${unit} ${R.held.index(d) + 1} · score ${fmt3(was.get(d.customerContentId))} → ${fmt3(d.score)}${(() => {
            const d0 = (S.prevDecisions || []).find((x) => x.customerContentId === d.customerContentId);
            const shift = d0 ? driverShift(d0, d) : '';
            return shift ? ` · ${shift}` : '';
          })()}</em></span></li>`);
  }
  /** Nothing moved and no score moved: her strongest signal, and where it stands. */
  function nothingLine(R) {
    if (typeof R.nothing === 'string') return R.nothing;
    const top = P().topSignal(), th = P().thetaIn();
    return `<li class="delta-none">${(R.nothing && R.nothing.text) || 'Nothing moved.'}${top
      ? ` The visitor’s strongest signal is <b>${esc(top.value)}</b> (${esc(DIM_LABEL[top.dim] || top.dim)}) at <b>${fmt2(top.a)}</b>, ${top.a >= th
        ? 'past the entry threshold: what the visitor has earned is already being served.' : `under the ${fmt2(th)} entry threshold.`}`
      : ' The visitor has sent no signal yet.'}</li>`;
  }

  /** The strip for one slot: the before half, then what changed. */
  function render(slot) {
    const R = row(slot);
    if (!R) return;
    const g = R.get();
    const before = g.before, after = g.after || [];
    if (R.mode === 'ghosts') {
      R.before.innerHTML = before && before.length
        ? before.map((b, i) => `<span class="ghost"><span class="gart">${b.art ? `<img src="${esc(b.art)}" alt="" data-ph="">` : ''}</span><span class="gn">${i + 1}</span></span>`).join('')
          + `<span class="ghost-hint">${state.showBefore ? 'Hide the before row' : 'Show it full size, above'}</span>`
        : `<span class="ghost-empty">${R.emptyBefore || 'Nothing was on screen before.'}</span>`;
    } else {
      R.before.innerHTML = before && before.length ? before.map((m) => `<li>${esc(m.title)}</li>`).join('')
        : `<li class="ghost-empty">${R.emptyBefore || 'Nothing was on screen before.'}</li>`;
    }
    if (!before && R.first) { R.deltas.innerHTML = R.first(g); return; }
    const rows = before ? [...diffRows(slot, before, after), ...(R.extra ? R.extra(g) : [])] : (R.opening ? [R.opening] : []);
    const lead = R.lead ? R.lead() : '';
    if (!rows.length) {
      const held = R.held ? heldRows(slot) : [];
      if (held.length) { R.deltas.innerHTML = `${lead}<li class="delta-none">The order held; the scores moved.</li>${held.join('')}`; return; }
      R.deltas.innerHTML = lead + nothingLine(R);
      return;
    }
    R.deltas.innerHTML = lead + rowsHtml(rows, R.tight);
  }
  /** The before row at full size, above the module: on when its thumbnails were pressed and a before exists. */
  function renderBeforeRow(slot) {
    const R = row(slot);
    if (!R || !R.beforeRow) return;
    const S = R.state(), B = R.beforeRow;
    const on = Boolean(state.showBefore && S.prevDecisions && S.prevDecisions.length);
    B.row.hidden = !on;
    B.label.hidden = !on;
    B.four.innerHTML = on ? S.prevDecisions.map((d, i) => B.card(d, i)).join('') : '';
  }
  /** The thumbnails were pressed: the before row shows at full size, or hides again. */
  function toggleBefore(slot) { state.showBefore = !state.showBefore; renderBeforeRow(slot); render(slot); }
  /** Off its page the slot has not been asked again, and the strip says so rather than keep a stale line. */
  function pending(slot, where) {
    const R = row(slot);
    if (!R) return;
    const top = P().topSignal(), th = P().thetaIn();
    R.deltas.innerHTML = `<li class="delta-none">${esc(where)}: ${R.pending || 'the page has not been asked again yet'}.${top
      ? ` The visitor’s strongest signal is <b>${esc(top.value)}</b> (${esc(DIM_LABEL[top.dim] || top.dim)}) at <b>${fmt2(top.a)}</b>, ${top.a >= th
        ? `past the ${fmt2(th)} entry threshold.` : `under the ${fmt2(th)} entry threshold.`}` : ''}</li>`;
  }

  /**
   * The hinge, read off the receipts rather than asserted: a piece the arrival's
   * seeds lifted was overtaken by a piece her own behaviour carries. The words
   * appear only when the receipts say so. Returns the strip's line, or null.
   */
  function superseded(slot) {
    const R = row(slot);
    if (!R) return null;
    const set = R.set ? R.set() : null;
    const S = R.state();
    const before = S.previous, after = S.current;
    if (!set || !before || !after) return null;
    const decisions = T().bySlot(set, slot);
    const seeded = [...(S.prevDecisions || []), ...decisions].find((d) => {
      const rec = d.decisionId && state.receipts.get(d.decisionId);
      return rec && rec.explain && rec.explain.contextual && num(rec.explain.contextual.applied) > 0;
    });
    if (!seeded) return null;
    const was = before.findIndex((b) => b.id === seeded.customerContentId);
    const now = after.findIndex((a) => a.id === seeded.customerContentId);
    if (was === -1 || (now !== -1 && now <= was)) return null;
    const leader = decisions[0];
    if (!leader || leader.customerContentId === seeded.customerContentId) return null;
    const own = ((leader.explain && leader.explain.drivers) || []).filter(P().OWN);
    if (!own.length) return null;
    const c = state.receipts.get(seeded.decisionId).explain.contextual;
    const sig = arr(c.drivers).find((x) => x.signal === 'campaign_term') || arr(c.drivers)[0];
    const dampedDriver = arr(c.drivers).find((x) => x.dampened);
    const damp = dampedDriver ? arr(dampedDriver.dampened)[0] : null;   // the engine lists each applied dampen
    const fired = P().seedsFired(c);
    // "the campaign (+x)" only when the campaign alone contributed; with another seed too, the total is the seeds'.
    const led = fired.length > 1 ? `its arrival seeds (+${fmt3(c.applied)}: ${fired.map(([key, v]) => `${esc(key)} +${fmt3(v)} at entry`).join(', ')}`
      : `the campaign (+${fmt3(c.applied)}${sig ? ` from ${esc(String(sig.signal).replace(/_/g, ' '))} “${esc(sig.value)}”` : ''}`;
    return `<li class="delta-hinge"><span class="hk">Campaign context superseded by observed behaviour</span>
      <b>${esc(R.titleOfId(seeded.customerContentId))}</b> led on ${led}${damp ? `, dampened ×${fmt2(damp.factor)} once the visitor held ${esc(damp.dimension)} ${esc(damp.value)}` : ''}).
      <b>${esc(R.title(leader))}</b> now leads on the visitor’s own browsing: ${own.slice(0, 3).map((x) => `${esc(DIM_LABEL[x.dim] || x.dim)} ${esc(x.value)} ${fmt2(x.a)} × ${x.weight}`).join(', ')}.</li>`;
  }

  return { rotate, moves, chipHtml, diffRows, rowsHtml, driverShift, render, renderBeforeRow, toggleBefore, pending, superseded };
}

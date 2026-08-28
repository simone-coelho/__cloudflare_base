// Meridian — the Opticon surface.
//
// RULE ONE, inherited from the First National Bank demo: no visual beat ever
// awaits the network. Every signal applies to a local mirror using the SAME
// apply() the Durable Object runs, repaints immediately, and is then reconciled
// by the authoritative server frame. Unplug the cable and the page keeps
// deciding correctly.

import { SURFACES, KIND_LABEL } from '/meridian/surfaces.js';
import { BEATS, ACTS } from '/meridian/beats.js';
import { captureBaseline, openCompare, clearBaseline } from '/meridian/compare.js';
import { paintLayout } from '/meridian/layout.js';
import {
  compose, composeLayout, SHAPE_OF_KEY, SHAPE_ORDER, SLOT_STRATEGIES, configFor, packshot,
  apply, tick, snapshot, emptyState, extractTouches,
  stageTouchFor, decidingValueFor, stageKeyFor, expiryOf, audienceKey,
  leadValue, leadSentence, LEAD_BY,
} from '/meridian/engine.bundle.js';

const API = '/meridian/api';
const $ = (id) => document.getElementById(id);

const VID = (() => {
  // ?visitor= pins the identity, so a rehearsal can return to a known profile
  // from a clean browser rather than depending on whatever localStorage holds.
  const pinned = new URLSearchParams(location.search).get('visitor');
  if (pinned) return pinned;
  let v = localStorage.getItem('mrd_visitor_id');
  if (!v) { v = 'mrd-' + crypto.randomUUID(); localStorage.setItem('mrd_visitor_id', v); }
  return v;
})();
const post = (path, body) => {
  const t0 = performance.now();
  if (path === '/action' && body?.events?.some((e) => e.action !== 'prior')) S.behaved = true;
  return fetch(API + path, {
    method: 'POST', credentials: 'omit',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ visitorId: VID, ...body }),
  }).then((r) => { if (path === '/action') showLatency(performance.now() - t0); return r.json(); })
    .catch(() => null);
};

/** The measured decision round trip. Whatever it is, that is what we say. */
function showLatency(ms) {
  const el = $('lat'); if (!el) return;
  el.textContent = `${Math.round(ms)}ms`;
  el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
}

const S = {
  runId: 'run-' + Math.floor(Date.now() / 1000),
  vertical: 'retail', items: [], blocks: [], registry: null, config: null,
  reflex: null, audiences: new Set(), decisions: [], prevRank: new Map(),
  seq: -1, ws: null, heroOverride: null, usedSurfaces: new Set(), sinceArrival: 0, sayLockUntil: 0,
  claimedAt: {},
  withdrawn: new Set(),
};

const money = (n) => '$' + n.toLocaleString('en-US');
const byId = (id) => S.items.find((i) => i.id === id) || S.blocks.find((b) => b.id === id);
const pick = (ds, slot) => ds.find((d) => d.slot === slot);

// ── Boot ────────────────────────────────────────────────────────────────────
async function load(vertical) {
  const r = await fetch(`${API}/catalog?vertical=${vertical}`, { credentials: 'omit' }).then((x) => x.json());
  Object.assign(S, {
    vertical, items: r.items, blocks: r.blocks, registry: r.registry,
    config: configFor(vertical), reflex: emptyState(configFor(vertical)),
    audiences: new Set(), decisions: [], prevRank: new Map(),
    heroOverride: null, usedSurfaces: new Set(), sinceArrival: 0, withdrawn: new Set(),
    behaved: false, anchorId: null, claimedAt: {},
  });
  S.published = [];
  document.documentElement.dataset.vertical = vertical;
  $('biz').textContent = vertical === 'retail' ? '& Co.' : 'Financial';
  // THE NAV IS A CONTROL, NOT DECORATION. It had no handler at all, so the one
  // natural way to browse away from a campaign — click a different department —
  // did nothing. That is the hinge beat of the whole session.
  const cats = [...new Set(r.items.map((i) => i.category))];
  $('nav').innerHTML = cats
    .map((c, i) => `<button class="navc${i === 0 ? ' on' : ''}" data-cat="${c}">${c}</button>`).join('');
  $('nav').querySelectorAll('.navc').forEach((el) => {
    el.onclick = () => {
      $('nav').querySelectorAll('.navc').forEach((x) => x.classList.toggle('on', x === el));
      navTo(el.dataset.cat);
    };
  });
  $('row-title').textContent = vertical === 'retail' ? 'Selected for you' : 'Suited to you';
  $('cfgv').textContent = r.registry.version;
  renderSurfaces(); renderBars(); renderChips([], []); $('episodes').innerHTML = '';
  renderDial(); renderBrowseBeats();

  // Ask the edge what it still holds BEFORE seeding, because cold start only
  // describes a visitor who has done nothing. Seeding over a live profile would
  // add the prior a second time.
  const snap = await fetch(`${API}/snapshot?visitorId=${VID}`, { credentials: 'omit' })
    .then((x) => x.json()).catch(() => null);
  const restored = !!(snap?.state?.dims && Object.keys(snap.state.dims).length > 0);

  await seedColdStart(!restored);

  if (restored) {
    S.behaved = true;
    S.reflex = snap.state;
    S.audiences = new Set(snap.affinity?.audiences ?? []);
    renderChips([], []);
    consequence('Memory', 'Profile restored at the edge',
      `${Object.keys(snap.state.dims).length} dimensions and ${S.audiences.size} audience${S.audiences.size === 1 ? '' : 's'} survived the session. No login, no cookie sync, nothing downloaded.`);
    $('sentence').textContent =
      'Returning visitor — the profile was still here, held per visitor at the edge.';
    S.sayLockUntil = Date.now() + 6000;
  }
  recompose(true);
}

/**
 * What we know about someone who has done nothing. The region comes off the
 * connection, the figures are published census, and the band prior is arithmetic
 * over the two — every link checkable, and each one labelled for what it is.
 */
async function seedColdStart(seed) {
  const q = new URLSearchParams({ vertical: S.vertical });
  const override = new URLSearchParams(location.search).get('region');
  if (override) q.set('region', override);
  const cs = await fetch(`${API}/coldstart?${q}`, { credentials: 'omit' })
    .then((r) => r.json()).catch(() => null);
  if (!cs?.ok) { $('cold').innerHTML = '<div class="cold-row"><span>No census row for this location</span></div>'; return; }

  const c = cs.census; const money = (n) => (n == null ? '—' : '$' + n.toLocaleString('en-US'));
  $('cold').innerHTML = c ? `
    <div class="cold-row"><span>Resolved at the edge</span><b>${[cs.geo.city, cs.geo.region, cs.geo.country].filter(Boolean).join(', ') || 'unknown'}${cs.overridden ? ' (override)' : ''}</b></div>
    <div class="cold-row"><span>${c.label}</span><b>${c.source}</b></div>
    <div class="cold-row"><span>Median household income</span><b>${money(c.medianHhIncomeUsd)}</b></div>
    <div class="cold-row"><span>Median home value</span><b>${money(c.medianHomeValueUsd)}</b></div>
    ${cs.prior ? `<div class="cold-why"><b>${cs.prior.dim} → ${cs.prior.value}</b><br>${cs.prior.why}</div>` : ''}
    <div class="cold-tags"><span class="tg ok">geo real</span><span class="tg ok">census real</span>
      <span class="tg dv">prior derived</span>
      <span class="tg no" id="cold-behaviour">${seed ? 'behaviour none' : 'superseded by behaviour'}</span></div>` : '';

  if (!cs.prior || !seed) return;
  const touches = [{ dim: cs.prior.dim, value: cs.prior.value }];
  const res = apply(S.reflex, { action: 'prior', touches }, Date.now(), S.config);
  S.reflex = res.state; absorb(res.changes);
  post('/action', { vertical: S.vertical, events: [{ action: 'prior', touches }] });
  consequence('Cold start', cs.prior.why,
    `${c.source} · ${c.label}. No behaviour yet — geography and public data only.`);
  $('sentence').textContent =
    `Nothing has happened yet — and the page is already weighted. ${c.label || cs.geo.region || 'This region'}, ${cs.prior.value} band.`;
}

function connect() {
  if (S.ws) try { S.ws.close(); } catch {}
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}${API}/ws?visitorId=${VID}&vertical=${S.vertical}`);
  ws.onmessage = (e) => { try { onFrame(JSON.parse(e.data)); } catch {} };
  ws.onclose = () => setTimeout(connect, 2500);
  S.ws = ws;
}

// ── The rest of the world ───────────────────────────────────────────────────
function renderSurfaces() {
  $('surfaces').innerHTML = SURFACES[S.vertical].map((s) => `
    <article class="surface" data-id="${s.id}">
      <div class="from">${s.from}</div>
      <div class="subj">${s.subject}</div>
      <div class="prev">${s.preview}</div>
      <span class="act">${s.action}</span>
    </article>`).join('');
  $('surfaces').querySelectorAll('.surface').forEach((el) => {
    el.onclick = () => {
      if (el.classList.contains('done')) { el.classList.toggle('open'); return; }
      fireSurface(SURFACES[S.vertical].find((x) => x.id === el.dataset.id));
    };
  });
}

/**
 * An off-site cause. It produces ONE grouped episode — never a running log —
 * and it is an ordinary engine signal, not a special path.
 */
function fireSurface(s) {
  if (!s || S.usedSurfaces.has(s.id)) return;
  S.usedSurfaces.add(s.id);
  document.querySelector(`.surface[data-id="${s.id}"]`)?.classList.add('done');

  S.heroOverride = { ...s.hero, from: s.id };
  // The hero repaints when the DECISION changes. A surface changes the override
  // copy, not the underlying item — so without this the presenter fires the SMS,
  // then the quiz, and the hero keeps showing whatever the ad said. Caught in a
  // sequential walk; firing one surface in isolation never revealed it.
  S.heroDirty = true;
  S.sinceArrival = 0;
  // A stated preference is not an arrival. It weighs more, and it says nothing
  // about journey stage, so it gets its own verb rather than being flattened.
  const act = s.act ?? 'arrival';
  recordDone(act === 'declared' ? 'Told us' : 'Arrived from', `${KIND_LABEL[s.kind]} — ${s.subject}`, '');
  const res = apply(S.reflex, { action: act, touches: s.touches }, Date.now(), S.config);
  S.reflex = res.state;
  absorb(res.changes);
  recompose();
  post('/action', { vertical: S.vertical, events: [{ action: act, touches: s.touches }] });

  const el = document.createElement('article');
  el.className = 'ep'; el.dataset.id = s.id;
  el.innerHTML = `<div class="kind">${KIND_LABEL[s.kind]}</div>
    <div class="title">${s.subject}</div>
    <div class="chain">${s.chain.map((step, i) => `<div class="step"><b>${step}</b>${
      i === s.chain.length - 1 ? '<span>the page answered it</span>' : '<span>✓</span>'}</div>`).join('')}</div>`;
  $('episodes').prepend(el);
  const n = $('episodes').children.length;
  $('ep-count').textContent = `${n} · newest first`;
  // The sentence is the line the room reads. An arrival is a cause worth naming
  // even when it crosses no threshold — otherwise the panel says "nothing has
  // happened yet" at the exact moment the most interesting thing just did.
  const what = s.touches.map((t) => t.value).join(' · ');
  $('sentence').textContent = act === 'declared'
    ? `She told us: ${what}. Zero-party, no account, and it decays like everything else.`
    : `Arrived from ${KIND_LABEL[s.kind].toLowerCase()} — ${what}. The page answered before anything on it was clicked.`;
  S.sayLockUntil = Date.now() + 6000;
  consequence(KIND_LABEL[s.kind],
    act === 'declared' ? 'Zero-party — she told us, no account created'
      : s.chain[s.chain.length - 1] === 'landed' ? 'Landed already personalized'
      : 'Profile updated across surfaces',
    act === 'declared'
      ? `${s.chain.join(' → ')}. Four taps on someone else's site. It lands in the same `
        + 'vector as observed behaviour and decays on the same clock — so a preference '
        + 'stated once stops driving the page unless behaviour agrees with it.'
      : `${s.chain.join(' → ')}. No page interaction required.`);
  $('world-status').textContent = `${S.usedSurfaces.size} of ${SURFACES[S.vertical].length} surfaces · one profile`;
}

/**
 * The handoff. When observed behaviour has moved off the arrival context, the
 * episode that brought her here closes itself and says so. The campaign did not
 * have to be wrong — she simply moved on, and the page moves with her.
 */
function checkHandoff(snap) {
  // She has to actually do something before she can be said to have moved on.
  if (S.sinceArrival < 2) return;

  // EVERY fired campaign with a claim is judged, not just the one whose copy
  // happens to be on the hero. On stage all four surfaces fire before she
  // browses, so the hero belongs to the quiz — which claims no department — and
  // the version that only judged the hero's own surface never closed the email.
  const broadKey = S.registry.dimensions.find((d) => d.shape === 'broad')?.key;
  const spec = S.registry.dimensions.find((d) => d.key === broadKey);
  const per = snap.dims?.[broadKey] || {};
  let leader = null, best = 0;
  for (const [v, a] of Object.entries(per)) if (a > best) { best = a; leader = v; }

  let closedOne = false;
  for (const id of S.usedSurfaces) {
    const src = SURFACES[S.vertical].find((x) => x.id === id);
    const claimed = src?.touches.find((t) => t.dim === broadKey)?.value;
    if (!claimed) continue;                                       // declared surfaces claim no aisle
    const el = document.querySelector(`.ep[data-id="${id}"]`);
    if (!el || el.querySelector('.closed')) continue;

    // The claim EXPIRES when what the campaign was about decays under θ_out —
    // the hero stops citing the email even if nothing overtook it.
    if ((per[claimed] ?? 0) < (spec?.thetaOut ?? 0.45)) {
      const dx = document.createElement('div');
      dx.className = 'closed'; dx.textContent = `expired — interest in ${claimed} decayed`;
      el.appendChild(dx); closedOne = true; continue;
    }
    // THE TEST: has the thing the campaign was about stopped being the thing
    // she is looking at? The BROAD dimension is what the email was about; taste
    // is not — she left Outerwear for Bags that were also heritage, and the old
    // version read the campaign as alive.
    if (leader && leader !== claimed) {
      const d = document.createElement('div');
      d.className = 'closed'; d.textContent = `superseded — ${claimed} gave way to ${leader}`;
      el.appendChild(d); closedOne = true;
      $('sentence').textContent =
        `The campaign was about ${claimed}. She is looking at ${leader}. The page followed her, not the campaign.`;
      S.sayLockUntil = Date.now() + 8000;
      consequence('Handoff', `${claimed} gave way to ${leader}`,
        'No backend job ran, no segment rebuilt, nothing downloaded. The connection was already open.');
    }
  }
  // Once any arrival claim is gone, the page follows her — whatever surface's
  // copy was on the hero.
  if (closedOne && S.heroOverride) { S.heroOverride = null; S.heroDirty = true; }
}

// ── Signals from the page ───────────────────────────────────────────────────
/** Browsing a department: a category touch with no single item behind it. */
function navTo(category) {
  const before = snapshot(S.reflex, Date.now(), S.config);
  const audBefore = new Set(S.audiences);
  const touches = [{ dim: S.vertical === 'retail' ? 'category' : 'productFamily', value: category }];
  const stage = stageTouchFor('nav_click', S.vertical);
  const res = apply(S.reflex, { action: 'nav_click', touches: stage ? [...touches, stage] : touches },
                    Date.now(), S.config);
  S.reflex = res.state; absorb(res.changes);
  S.behaved = true; S.sinceArrival += 1;
  TALLY.events += 1; TALLY.departments.add(category);
  const prevDecisions = S.decisions;
  recompose();
  post('/action', { vertical: S.vertical, events: [{ action: 'nav_click', touches }] });
  { const mv = biggestMove(before, snapshot(S.reflex, Date.now(), S.config));
    recordDone('Browsed', category, mv ? `${mv.dim} ${mv.from.toFixed(2)} → ${mv.to.toFixed(2)}` : ''); }
  evidenceCard({
    verb: 'Browsed', subject: category, meta: 'department',
    before, after: snapshot(S.reflex, Date.now(), S.config),
    prevDecisions, nextDecisions: S.decisions,
    entered: [...S.audiences].filter((a) => !audBefore.has(a)),
  });
}

// ── Tabs ────────────────────────────────────────────────────────────────────
function showTab(name) {
  if (name === 'why') return;                      // the Why is always visible now
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
  document.querySelectorAll('.tabpane').forEach((p) => { p.hidden = p.dataset.tab !== name; });
  const t = document.querySelector(`.tab[data-tab="${name}"]`); if (t) t.classList.remove('unread');
}
/** Content landed in a pane. If it is hidden, say so on its tab. */
function markTab(name) {
  const pane = document.querySelector(`.tabpane[data-tab="${name}"]`);
  if (pane && pane.hidden) document.querySelector(`.tab[data-tab="${name}"]`)?.classList.add('unread');
}
document.querySelectorAll('.tab').forEach((b) => { b.onclick = () => showTab(b.dataset.tab); });

// ── THE EVIDENCE TRAIL ───────────────────────────────────────────────────────
// The panel showed STATE — bars, chips, a hero that had changed — and never
// showed CAUSE. Asked why something moved, the screen's only answer was a number
// on a bar, which is not an answer a business person can hold.
//
// Every action now posts a card carrying the whole causal chain: what she did,
// the evidence as countable acts, the arithmetic on the dimension it moved, the
// threshold it crossed, and what changed on the page as a result. That chain is
// the product. Without it we are selling an affinity engine while showing
// nothing but products swapping places.

const TALLY = { events: 0, products: new Set(), byCat: {}, departments: new Set() };

function resetTally() {
  TALLY.events = 0; TALLY.products = new Set(); TALLY.byCat = {}; TALLY.departments = new Set();
}

function evidenceChips() {
  const out = [];
  if (TALLY.products.size) out.push(`${TALLY.products.size} product${TALLY.products.size === 1 ? '' : 's'} viewed`);
  const top = Object.entries(TALLY.byCat).sort((a, b) => b[1] - a[1])[0];
  if (top) out.push(`${top[0]} ×${top[1]}`);
  if (TALLY.departments.size) out.push(`${TALLY.departments.size} department${TALLY.departments.size === 1 ? '' : 's'}`);
  out.push(`${TALLY.events} event${TALLY.events === 1 ? '' : 's'}`);
  return out;
}

/** The dimension this act moved most, with the arithmetic that moved it. */
function biggestMove(before, after) {
  let best = null;
  for (const spec of S.registry.dimensions) {
    const b = before?.dims?.[spec.key] || {}; const a = after?.dims?.[spec.key] || {};
    for (const v of Object.keys(a)) {
      const from = b[v] ?? 0; const to = a[v];
      if (to - from <= 0.0005) continue;
      if (!best || to - from > best.delta) {
        best = { dim: spec.key, value: v, from, to, delta: to - from,
                 thetaIn: spec.thetaIn, thetaOut: spec.thetaOut,
                 crossed: from < spec.thetaIn && to >= spec.thetaIn };
      }
    }
  }
  return best;
}

function slotsChanged(prev, next) {
  const out = [];
  const pick2 = (ds, slot) => ds.find((d) => d.slot === slot);
  if (pick2(prev, 'hero')?.itemId !== pick2(next, 'hero')?.itemId) out.push('the hero');
  const pr = prev.filter((d) => d.slot === 'row').map((d) => d.itemId);
  const nx = next.filter((d) => d.slot === 'row').map((d) => d.itemId);
  const movers = nx.filter((id, i) => pr.includes(id) && pr.indexOf(id) !== i).length;
  if (movers) out.push(`${movers} of ${nx.length} products re-ranked`);
  if (pick2(prev, 'block_a')?.blockId !== pick2(next, 'block_a')?.blockId) out.push('the story block');
  return out;
}

function evidenceCard({ verb, subject, meta, before, after, prevDecisions, nextDecisions, entered }) {
  const move = biggestMove(before, after);
  const changes = slotsChanged(prevDecisions, nextDecisions);
  const pct = (n) => `${(n * 100).toFixed(0)}%`;

  const el = document.createElement('article');
  el.className = 'ev';
  el.innerHTML = `
    <div class="ev-act"><span class="ev-verb">${verb}</span> ${escapeHtml(subject)}</div>
    ${meta ? `<div class="ev-meta">${escapeHtml(meta)}</div>` : ''}
    <div class="ev-chips">${evidenceChips().map((c) => `<span>${c}</span>`).join('')}</div>
    ${move ? `
      <div class="ev-math">
        <div class="ev-dim">${move.dim} · ${move.value}</div>
        <div class="ev-nums">${move.from.toFixed(3)} <b>→</b> ${move.to.toFixed(3)}</div>
        <div class="ev-track">
          <div class="ev-was" style="width:${pct(move.from)}"></div>
          <div class="ev-now" style="left:${pct(move.from)};width:${pct(Math.max(0, move.to - move.from))}"></div>
          <div class="ev-thr" style="left:${pct(move.thetaIn)}" title="entry threshold"></div>
        </div>
        <div class="ev-thrlab">entry threshold ${move.thetaIn}</div>
      </div>` : ''}
    ${entered?.length
      ? `<div class="ev-entered">✓ entered ${entered.map((a) => `<code>${a}</code>`).join(' ')}</div>`
      : (move && move.crossed ? '<div class="ev-entered">✓ crossed the entry threshold</div>' : '')}
    ${changes.length
      ? `<div class="ev-changed"><b>the page changed:</b> ${changes.join(' · ')}</div>`
      : '<div class="ev-changed quiet">the page did not change — not enough signal yet</div>'}`;
  const feed = $('conseq');
  feed.prepend(el);
  while (feed.children.length > 8) feed.lastElementChild.remove();
  markTab('trail');
}

const VERB_LABEL = {
  row_click: 'Clicked', view: 'Viewed', rail_click: 'Clicked', block_read: 'Read',
  intent_start: 'Added to bag', convert: 'Bought', search: 'Searched for',
  nav_click: 'Browsed', save: 'Saved',
};

function signal(action, record) {
  S.sinceArrival += 1;
  const before = snapshot(S.reflex, Date.now(), S.config);
  const prevDecisions = S.decisions;
  const audBefore = new Set(S.audiences);

  const stage = stageTouchFor(action, S.vertical);
  if (record) {
    const touches = extractTouches(record, S.config);
    const res = apply(S.reflex, { action, touches: stage ? [...touches, stage] : touches },
                      Date.now(), S.config);
    S.reflex = res.state;
    absorb(res.changes);
    TALLY.events += 1;
    if (record.category) {
      TALLY.products.add(record.id);
      TALLY.byCat[record.category] = (TALLY.byCat[record.category] || 0) + 1;
    }
  }
  // The piece she committed to. Everything the completion row does hangs off it.
  if ((action === 'intent_start' || action === 'convert') && record?.id) S.anchorId = record.id;
  recompose();

  if (record) {
    const mv = biggestMove(before, snapshot(S.reflex, Date.now(), S.config));
    recordDone(VERB_LABEL[action] || action, record.name || record.title || record.id,
      mv ? `${mv.dim} ${mv.from.toFixed(2)} → ${mv.to.toFixed(2)}` : '');
    evidenceCard({
      verb: VERB_LABEL[action] || action,
      subject: record.name || record.title || record.id,
      meta: [record.category, record.subcategory, record.value_usd != null ? money(record.value_usd) : null]
        .filter(Boolean).join(' · '),
      before, after: snapshot(S.reflex, Date.now(), S.config),
      prevDecisions, nextDecisions: S.decisions,
      entered: [...S.audiences].filter((a) => !audBefore.has(a)),
    });
  }
  post('/action', {
    vertical: S.vertical,
    events: [{ action, itemId: record?.id?.startsWith('MRD-B') ? undefined : record?.id,
               blockId: record?.id?.startsWith('MRD-B') ? record.id : undefined }],
  });
}

function onFrame(f) {
  if (f.type !== 'meridian_update') return;
  if (f.seq <= S.seq && f.source !== 'snapshot') return;
  S.seq = f.seq;
  // The server is authoritative, with one exception that is a race rather than
  // a disagreement: a snapshot frame composed before our just-posted events
  // reached the object carries an EMPTY vector. Adopting it erases signal the
  // visitor genuinely produced — on the vertical flip it wiped the cold-start
  // prior and dropped the hero back to the generic welcome. An empty state is
  // never more informed than a populated one, so it does not get to win.
  const incomingDims = Object.keys(f.state?.dims ?? {}).length;
  const localDims = Object.keys(S.reflex?.dims ?? {}).length;
  if (f.state && !(incomingDims === 0 && localDims > 0)) S.reflex = f.state;
  const before = new Set(S.audiences);
  S.audiences = new Set(f.affinity.audiences);
  renderChips(f.changes.entered.filter((a) => !before.has(a)),
              f.changes.exited.filter((a) => before.has(a)));
  if (f.explain?.length) say(f.explain[0]);
  recompose();
}

// ── Predict, then prove ─────────────────────────────────────────────────────
// Before the decisive click, tell the room what it will cause — from a copy of
// her real state run through the real engine — then let it happen. Nothing
// here is a guess: the band is the engine's own arithmetic one click ahead.
const PD = { open: false, resolve: null };
const DONE = [];   // what she has done this session, as the band lists it

function recordDone(verb, subject, move) {
  DONE.push({ verb, subject, move });
  if (DONE.length > 6) DONE.shift();
}

/** Run one hypothetical act on a copy of her profile and diff the outcome. */
function forecast(action, record, touchesOverride) {
  const copy = JSON.parse(JSON.stringify(S.reflex));
  const stage = stageTouchFor(action, S.vertical);
  const base = touchesOverride || (record ? extractTouches(record, S.config) : []);
  const touches = stage ? [...base, stage] : base;
  const before = snapshot(copy, Date.now(), S.config);
  const res = apply(copy, { action, touches }, Date.now(), S.config);
  const after = snapshot(res.state, Date.now(), S.config);

  const nextDecisions = compose({ affinity: after, state: res.state, items: S.items, blocks: S.blocks,
    config: S.config, shapeOfKey: SHAPE_OF_KEY, rowSize: 10, pins: S.pins,
    anchorId: action === 'intent_start' && record ? record.id : S.anchorId,
    decidingValue: decidingValueFor(S.vertical) });
  const pick2 = (ds, slot) => ds.find((d) => d.slot === slot);
  const heroNow = pick2(S.decisions, 'hero')?.itemId; const heroNext = pick2(nextDecisions, 'hero')?.itemId;
  const rowNow = S.decisions.filter((d) => d.slot === 'row').map((d) => d.itemId);
  const rowNext = nextDecisions.filter((d) => d.slot === 'row').map((d) => d.itemId);
  const climbs = rowNext.filter((id, i) => { const j = rowNow.indexOf(id); return j > i || j === -1; }).length;
  const blockNow = pick2(S.decisions, 'block_a')?.blockId; const blockNext = pick2(nextDecisions, 'block_a')?.blockId;

  // The dimension the act moves most, with its threshold.
  const moves = [];
  for (const spec of S.registry.dimensions) {
    const b = before.dims?.[spec.key] || {}; const a = after.dims?.[spec.key] || {};
    for (const v of Object.keys(a)) {
      const from = b[v] ?? 0, to = a[v];
      if (to - from > 0.0005) moves.push({ dim: spec.key, value: v, from, to, thetaIn: spec.thetaIn, crosses: from < spec.thetaIn && to >= spec.thetaIn });
    }
  }
  moves.sort((x, y) => (y.to - y.from) - (x.to - x.from));
  return { entered: res.changes.entered, exited: res.changes.exited, moves,
           heroChanges: heroNow !== heroNext, heroNext: heroNext && byId(heroNext)?.name,
           climbs, blockChanges: blockNow !== blockNext, blockNext: blockNext && byId(blockNext)?.title,
           completion: nextDecisions.some((d) => d.strategy === 'completion') && !S.decisions.some((d) => d.strategy === 'completion') };
}

const VERB_PAST = { row_click: 'Clicked', nav_click: 'Browsed', intent_start: 'Adds to bag', arrival: 'Arrived from', declared: 'Told us', search: 'Searched' };

/** Show the band for the act about to happen; resolves when the presenter closes it. */
function predictThenProve(action, record, touchesOverride, label) {
  const f = forecast(action, record, touchesOverride);
  const pct = (n) => n.toFixed(3);
  $('pd-done').innerHTML = DONE.length
    ? DONE.map((d) => `<li><b>${d.verb}</b> ${escapeHtml(d.subject)}${d.move ? ` — <code>${d.move}</code>` : ''}</li>`).join('')
    : '<li>Nothing yet — she arrived, that is all.</li>';
  $('pd-act').textContent = label || `${VERB_PAST[action] || action} ${record?.name || ''}`;
  const top = f.moves.slice(0, 3);
  $('pd-math').innerHTML = top.length
    ? top.map((m) => `${m.dim} · ${m.value} &nbsp;${pct(m.from)} → <b>${pct(m.to)}</b>${m.crosses ? ` &nbsp;≥ θ<sub>in</sub> ${m.thetaIn} → <b>enters</b>` : ` &nbsp;(θ<sub>in</sub> ${m.thetaIn})`}`).join('<br>')
    : 'No dimension moves on this act.';
  const will = [];
  for (const a of f.entered.filter((x) => !isStageAudience(x))) will.push(`She <b>enters ${prettyAudience(a)}</b>.`);
  for (const a of f.exited.filter((x) => !isStageAudience(x))) will.push(`She <b>leaves ${prettyAudience(a)}</b>.`);
  if (f.heroChanges) will.push(`The hero becomes <b>${escapeHtml(f.heroNext || '—')}</b>.`);
  if (f.completion) will.push(`The row becomes <b>Complete the look</b>.`);
  else if (f.climbs) will.push(`<b>${f.climbs}</b> product${f.climbs === 1 ? '' : 's'} climb the row.`);
  if (f.blockChanges) will.push(`The story becomes <b>${escapeHtml(f.blockNext || '—')}</b>.`);
  if (!will.length) will.push('Scores move; nothing on the page changes yet — not enough signal.');
  $('pd-will').innerHTML = will.map((w) => `<li>${w}</li>`).join('');
  $('predict').hidden = false; PD.open = true;
  return new Promise((resolve) => { PD.resolve = resolve; });
}
$('pd-go').onclick = () => { $('predict').hidden = true; PD.open = false; PD.resolve?.(); PD.resolve = null; };

// ── The scripted browse ─────────────────────────────────────────────────────
// The room has to WATCH her browse: a visible visitor clicks a coat, then
// another, then another, and the bar climbs while they watch. That is the
// affinity engine's entire argument, shown instead of narrated. Ported from the
// Coach demo: scroll the target into view FIRST, let it settle, THEN read the
// rect — the cursor must never land on an off-screen element.
//
// Presenter-triggered, always. A beat is short — one department, three clicks —
// and runs to completion; the pause is between beats, which is where the
// presenter talks. Nothing here fires on its own.
const BZ = { busy: false };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function scrollTargetIntoView(el) {
  const r = el.getBoundingClientRect();
  const inView = r.top >= 70 && r.bottom <= innerHeight - 12;
  if (inView) return;
  try { el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' }); } catch (_) {}
  await sleep(560);
}

function markClicked(el) {
  el.classList.remove('clicked'); void el.offsetWidth; el.classList.add('clicked');
  clearTimeout(el._ck); el._ck = setTimeout(() => el.classList.remove('clicked'), 1200);
}

async function moveCursorTo(el, { click = true } = {}) {
  const cur = $('demo-cursor');
  if (!el) return;
  await scrollTargetIntoView(el);
  const r = el.getBoundingClientRect();                       // recompute AFTER the scroll settles
  const x = r.left + r.width / 2; const y = r.top + Math.min(r.height / 2, 40);
  cur.classList.add('show');
  cur.style.left = `${x}px`; cur.style.top = `${y}px`;
  await sleep(740);                                            // the glide — matches the 0.7s transition
  cur.classList.remove('click'); void cur.offsetWidth; cur.classList.add('click');
  if (click) {
    markClicked(el);
    await sleep(360);                                          // let the ripple register
    el.click();                                                // the REAL handler — signal(), navTo()
    await sleep(420);                                          // so the room sees it land
  }
}
const hideCursor = () => $('demo-cursor').classList.remove('show');

/** One beat: a list of targets, resolved lazily so a re-rank between clicks is honoured. */
async function browse(btn, targets) {
  if (BZ.busy) return;
  BZ.busy = true; btn.classList.add('busy');
  document.querySelectorAll('[id^="bz-"]').forEach((b) => { b.disabled = true; });
  try {
    for (const t of targets) {
      const el = typeof t === 'function' ? t() : document.querySelector(t);
      if (!el) continue;
      if (el.wait) { await sleep(el.wait); continue; }        // a beat may pause to let a retreat land
      if (el.predict) {                                        // predict, then prove
        const target = el.el;
        const item = target?.dataset?.id ? byId(target.dataset.id) : null;
        const dept = target?.dataset?.cat;
        if (dept) await predictThenProve('nav_click', null, [{ dim: S.vertical === 'retail' ? 'category' : 'productFamily', value: dept }], `Browses ${dept}`);
        else if (item) await predictThenProve(target.classList.contains('add') ? 'intent_start' : 'row_click', item);
        await moveCursorTo(target);
        await sleep(700);
        continue;
      }
      await moveCursorTo(el);
      await sleep(700);                                        // between clicks — Coach's cadence
    }
  } finally {
    hideCursor();
    BZ.busy = false; btn.classList.remove('busy');
    document.querySelectorAll('[id^="bz-"]').forEach((b) => { b.disabled = false; });
  }
}

/** Nth card of a category currently on the row; falls back to any card so a beat never stalls. */
const cardOf = (category, n) => () => {
  const cards = [...$('row').querySelectorAll('.card')];
  const inCat = cards.filter((c) => (byId(c.dataset.id)?.category === category));
  return inCat[n] || cards[n] || cards[0];
};
const dept = (name) => () => document.querySelector(`.navc[data-cat="${name}"]`);

// The beats are per vertical: a bank visitor browses mortgages, not coats.
const BROWSE_BEATS = {
  retail: {
    a: { label: 'Three coats', sub: 'Outerwear · 3 clicks', dept: 'Outerwear', n: 3 },
    b: { label: 'Wanders to bags', sub: 'Bags · 2 clicks', dept: 'Bags', n: 2 },
    c: { label: 'Adds to bag', sub: 'the hero item' },
  },
  financial: {
    a: { label: 'Three mortgages', sub: 'Mortgage · 3 clicks', dept: 'Mortgage', n: 3 },
    b: { label: 'Wanders to cards', sub: 'Card · 2 clicks', dept: 'Card', n: 2 },
    c: { label: 'Starts an application', sub: 'the hero offer' },
  },
};
function renderBrowseBeats() {
  const b = BROWSE_BEATS[S.vertical];
  $('bz-coats').innerHTML = `${b.a.label}<small>${b.a.sub}</small>`;
  $('bz-bags').innerHTML = `${b.b.label}<small>${b.b.sub}</small>`;
  $('bz-decide').innerHTML = `${b.c.label}<small>${b.c.sub}</small>`;
  $('bz-story').hidden = S.vertical !== 'retail';
}
const beatTargets = (k) => {
  const b = BROWSE_BEATS[S.vertical][k];
  if (!b.dept) return [() => ({ predict: true, el: document.querySelector('#hero-cta') })];
  const clicks = Array.from({ length: b.n }, (_, i) => cardOf(b.dept, i));
  const last = clicks.pop();
  return [dept(b.dept), ...clicks, () => ({ predict: true, el: last() })];
};
/** Nth card of a product LINE currently on the row. */
const cardOfLine = (line, n) => () => {
  const cards = [...$('row').querySelectorAll('.card')];
  const inLine = cards.filter((c) => byId(c.dataset.id)?.line === line);
  return inLine[n] || inLine[0] || cards[n] || cards[0];
};
// The Drover → Linden story (D2): three pieces from one line, then one from
// another. Membership of the first stays; the page follows the second on the
// single click.
$('bz-story').onclick = (e) => browse(e.currentTarget,
  [dept('Knitwear'), cardOfLine('Fenwick', 0), cardOfLine('Fenwick', 1), cardOfLine('Fenwick', 2),
   dept('Bags'), cardOfLine('Linden', 0)]);
$('bz-coats').onclick = (e) => browse(e.currentTarget, beatTargets('a'));
$('bz-bags').onclick = (e) => browse(e.currentTarget, beatTargets('b'));
$('bz-decide').onclick = (e) => browse(e.currentTarget, beatTargets('c'));

// ── Let time pass ───────────────────────────────────────────────────────────
// The clocks are slow enough now that a profile survives a conversation. So
// decay is something the presenter asks for: every accumulator's last touch
// moves back by N seconds, locally and in the object, and the ordinary tick
// does the rest. Same math. The only thing that changed is who chose the moment.
function skipTime(seconds) {
  const ms = seconds * 1000;
  for (const dim of Object.values(S.reflex.dims || {})) {
    for (const entry of Object.values(dim)) entry.t = Math.max(0, entry.t - ms);
  }
  const before = new Set(S.audiences);
  const res = tick(S.reflex, Date.now(), S.config);
  S.reflex = res.state;
  if (res.changes.entered.length || res.changes.exited.length) absorb(res.changes);
  recompose(false, { tick: true });                 // retreats are allowed; nothing else moves
  post('/action', { vertical: S.vertical, events: [{ action: 'time_skip', seconds }] });
  const gone = [...before].filter((a) => !S.audiences.has(a));
  consequence('Time', `${Math.round(seconds / 60)} minutes passed — because you said so`,
    gone.length ? `Lapsed: ${gone.map(prettyAudience).join(', ')}. The same decay ran; the presenter chose the moment.`
                : 'Nothing lapsed yet. Press again and the next retreat lands.');
  $('sentence').textContent = gone.length
    ? `Two minutes passed. ${prettyAudience(gone[0])} lapsed — its score decayed under the exit threshold. Nobody wrote an exit rule.`
    : 'Two minutes passed. Every score decayed; nothing has crossed out yet.';
  S.sayLockUntil = Date.now() + 6000;
}
$('btn-skip').onclick = () => skipTime(120);

// ── The tuning dial ─────────────────────────────────────────────────────────
// SLOT_STRATEGIES is the live table the composer reads on every recompose, so
// turning a slider IS the tuning surface: no rebuild, no redeploy, the next
// decision uses the new weight and the receipt stamps a tuned version. The docs
// promise exactly this; the delivery ledger says the real build is compile-time
// today — this is real on the demo and a commitment on the product.
const SHAPE_LABEL = { broad: 'category', narrow: 'line', need: 'occasion', band: 'price band', durable: 'taste', content: 'content', stage: 'stage' };
let TUNED = false;

function renderDial() {
  const st = SLOT_STRATEGIES.hero;
  const shapes = ['broad', 'narrow', 'band', 'durable', 'need'];
  $('dial-rows').innerHTML = shapes.map((sh) => `
    <div class="dial-row">
      <label for="dial-${sh}">${SHAPE_LABEL[sh] || sh}</label>
      <input type="range" id="dial-${sh}" min="0" max="0.6" step="0.05" value="${st[sh] ?? 0}">
      <output id="dialv-${sh}">${(st[sh] ?? 0).toFixed(2)}</output>
    </div>`).join('');
  shapes.forEach((sh) => {
    $(`dial-${sh}`).oninput = (e) => {
      const v = parseFloat(e.target.value);
      SLOT_STRATEGIES.hero[sh] = v;
      $(`dialv-${sh}`).textContent = v.toFixed(2);
      TUNED = true;
      S.heroOverride = null;                        // the merchandiser outranks the campaign's copy
      S.heroDirty = true;
      const snap = snapshot(S.reflex, Date.now(), S.config);
      const strongest = Math.max(0, ...Object.values(snap.dims || {}).flatMap((d) => Object.values(d)));
      recompose();
      $('dial-foot').textContent = strongest < 0.05
        ? 'Nothing to weigh yet — she has no affinity. Browse first, then turn this.'
        : `hero · ${SHAPE_LABEL[sh] || sh} = ${v.toFixed(2)} · re-decided now · ${S.config.version}+tuned`;
    };
  });
  $('dial-foot').textContent = 'Turn one. The hero recomposes on the new weight and the receipt records the version.';
}

// ── The audience strip ──────────────────────────────────────────────────────
let STRIP_TIMER = null;
const prettyAudience = (key) => key.replace(/_affinity$/, '').replace(/_/g, ' · ');

function strip(kind, html, ttl) {
  clearTimeout(STRIP_TIMER);
  const el = $('strip');
  el.classList.toggle('out', kind === 'out');
  $('strip-k').textContent = kind === 'out' ? 'Left an audience' : 'Entered an audience';
  $('strip-t').innerHTML = html;
  el.hidden = false;
  STRIP_TIMER = setTimeout(() => { el.hidden = true; }, ttl);
}

/** What entering and leaving MEAN for the page, said on the page. */
function announceAudiences(entered, exited) {
  const skipStage = (a) => /stage/.test(a);   // stage is narrated by the offer and the row already
  const inn = entered.filter((a) => !skipStage(a));
  const out = exited.filter((a) => !skipStage(a));
  if (inn.length) {
    strip('in', `You entered <b>${prettyAudience(inn[0])}</b> — the edit re-centred on it. `
      + 'Nobody wrote a rule; the score crossed its entry threshold.', 9000);
  } else if (out.length) {
    strip('out', `You drifted out of <b>${prettyAudience(out[0])}</b> — what it was holding on the page let go. `
      + 'The score decayed under its exit threshold on its own.', 9000);
  }
}

function absorb(changes) {
  changes.entered.forEach((a) => S.audiences.add(a));
  changes.exited.forEach((a) => S.audiences.delete(a));
  if (changes.entered.length || changes.exited.length) announceAudiences(changes.entered, changes.exited);
  if (changes.entered.length || changes.exited.length) renderChips(changes.entered, changes.exited);
  if (changes.explain?.length) say(changes.explain[0]);
}

// ── Composition ─────────────────────────────────────────────────────────────
/**
 * FROZEN BETWEEN ACTIONS.
 *
 * Measured: one click, then forty seconds of nobody touching anything — the row
 * re-ranked itself seven times and at one point every card was green. The
 * 1-second decay tick recomposed the whole page, fast dimensions decayed faster
 * than slow ones, relative scores drifted, and cards swapped places on their
 * own. Every one of those was a change no button caused.
 *
 * On a tick the page may only do what a retreat is: a claim ending (affinity →
 * fading/fallback), an audience lapsing, the offer expiring, a section falling
 * back to its template rank. Item ORDER and the hero/story ITEMS are held until
 * the visitor acts again. The bars keep draining — that is the instrument's job.
 */
function holdSteady(prev, next) {
  if (!prev.length) return next;
  const pickP = (slot) => prev.find((d) => d.slot === slot);
  const out = [];
  for (const slot of ['hero', 'rail', 'block_a', 'block_b']) {
    const p = pickP(slot); const n = next.find((d) => d.slot === slot);
    if (!n) continue;
    if (!p) { out.push(n); continue; }
    const retreat = (p.strategy === 'affinity' || p.strategy === 'completion') && (n.strategy === 'fading' || n.strategy === 'fallback');
    // Keep the item; take the new strategy (so "stopped claiming" still lands).
    out.push(retreat ? n : { ...n, itemId: p.itemId ?? n.itemId, blockId: p.blockId ?? n.blockId });
  }
  const prevRow = prev.filter((d) => d.slot === 'row');
  const nextRow = next.filter((d) => d.slot === 'row');
  const byId2 = new Map(nextRow.map((d) => [d.itemId, d]));
  const held = prevRow.filter((d) => byId2.has(d.itemId)).map((d) => byId2.get(d.itemId));
  const fresh = nextRow.filter((d) => !prevRow.some((p) => p.itemId === d.itemId));
  out.push(...held, ...fresh);
  return out;
}

function recompose(first, opts = {}) {
  const snap = snapshot(S.reflex, Date.now(), S.config);
  checkHandoff(snap);
  let next = compose({ affinity: snap, state: S.reflex, items: S.items, blocks: S.blocks,
                       config: S.config, shapeOfKey: SHAPE_OF_KEY, rowSize: 10, pins: S.pins,
                       anchorId: S.anchorId, decidingValue: decidingValueFor(S.vertical) });
  if (opts.tick) next = holdSteady(S.decisions, next);
  const prev = S.decisions; S.decisions = next;

  // WHICH BOX COMES FIRST. The same snapshot ranks the SECTIONS: the offer
  // answers price band + stage, the row answers the narrow interest, the hero
  // answers breadth + taste. Doc 15's order — intent stage, then weight, then
  // template — with hysteresis so nothing flaps. This is the six-month tier in
  // the Tapestry documents, built.
  const prevLayout = S.layout;
  S.layout = composeLayout({
    affinity: snap, config: S.config, shapeOfKey: SHAPE_OF_KEY,
    prevOrder: prevLayout?.order, locked: $('takeover').hidden ? [] : ['takeover'],
  });
  const rankOf = (lay, id) => lay?.sections.find((x) => x.section === id)?.rank;
  const rowMoved = !!prevLayout && rankOf(prevLayout, 'row') !== rankOf(S.layout, 'row');

  announceRetreat(prev, next);
  paintBars(snap.dims);
  paint(prev, next, first, rowMoved, !!opts.tick);

  // Published audiences join the chip row alongside the generated ones.
  for (const k of publishedMemberships(snap)) if (!S.audiences.has(k)) {
    S.audiences.add(k); renderChips([k], []);
  }
  const coldTag = $('cold-behaviour');
  if (coldTag) coldTag.textContent = S.behaved ? 'superseded by behaviour' : 'behaviour none';
  checkOffer(); offerTick();
  const stratOf = (lay) => lay ? lay.sections.map((x) => x.section + ':' + x.strategy).join('|') : '';
  if (opts.tick && prevLayout && stratOf(prevLayout) === stratOf(S.layout)) S.layout = { ...S.layout, order: prevLayout.order };
  const movedSections = first ? [] : paintLayout(S.layout.order, { duration: 700 });
  if (movedSections.length) {
    const top = S.layout.sections.filter((x) => x.strategy !== 'locked' && x.strategy !== 'template')
      .sort((a, b) => a.rank - b.rank)[0];
    consequence('Which box comes first',
      movedSections.map((m) => `${SECTION_NAME[m.section] || m.section} ${m.from} → ${m.to}`).join(' · '),
      top?.explain?.movedBecause || 'The sections re-ordered on the same vector that ranks the products.');
    S.sayLockUntil = Date.now() + 5000;
    $('sentence').textContent = top
      ? `${SECTION_NAME[top.section] || top.section} leads the page — ${top.explain.movedBecause}`
      : 'The page re-ordered its sections.';
  }
  renderGlass(pick(next, 'hero'));
  captureDecisions(next);
  const n = [...S.audiences].filter((a) => !isStageAudience(a)).length, dims = Object.keys(snap.dims).length;
  $('eng-status').textContent =
    dims === 0 ? 'Cold start — nothing observed yet'
    : n === 0 ? `Learning — ${dims} dimension${dims === 1 ? '' : 's'} moving, none past the entry threshold`
    : `${n} audience${n === 1 ? '' : 's'} · ${dims} dimension${dims === 1 ? '' : 's'} active`;
}

/** The record underneath the sentence. Same numbers, more of them. */
function renderGlass(d) {
  if (!d) { $('glass-body').innerHTML = ''; return; }
  const it = d.itemId && byId(d.itemId);
  const e = d.explain || {};
  const drivers = (e.drivers || []).map((x) => `${x.dim}=${x.value} a=${x.a} w=${x.weight}`).join('<br>') || '—';
  const chosenScore = (e.drivers || []).reduce((n, x) => n + (x.weight ?? 0), 0);
  const refused = (e.refused || []).map((r) => {
    const item = byId(r.id);
    const beat = r.score > chosenScore;
    return `<span class="refuse">refused — ${item ? item.name : r.id} scored ${r.score}` +
           `${beat ? ` vs ${chosenScore.toFixed(4)} for the item we showed — it would have won` : ''}, ` +
           `declined by rule: ${r.gate}</span>`;
  }).join('');
  const lay = S.layout ? `<b>section order</b> ${S.layout.order.filter((x) => x !== 'takeover').map((x) => SECTION_NAME[x] || x).join(' → ')}<br>`
    + (S.layout.sections.find((x) => x.strategy === 'stage' || x.strategy === 'affinity')
      ? `<b>moved because</b> ${S.layout.sections.filter((x) => x.strategy === 'stage' || x.strategy === 'affinity').sort((a, b) => a.rank - b.rank)[0].explain.movedBecause}<br>` : '')
    : '';
  const rowTop = S.decisions.find((x) => x.slot === 'row');
  const leadLine = rowTop?.explain?.drivers?.some((x) => x.lead)
    ? `<b>line lead</b> ${leadSentence(rowTop.explain.drivers)}<br>` : '';
  $('glass-body').innerHTML = lay + leadLine +
    `<b>chosen</b> ${it ? it.name : '—'}<br>` +
    `<b>strategy</b> ${d.strategy}${d.strategy === 'pin' ? '<span class="pin">pinned · ranking skipped</span>' : ''}<br>` +
    `<b>candidates</b> ${e.candidates ?? 0} eligible<br>` +
    `<b>rank</b> ${e.rank ?? 0}<br>` +
    `<b>confidence</b> ${e.confidence?.toFixed(3) ?? '—'} vs θout ${e.thetaOut ?? '—'}<br>` +
    `<b>drivers</b><br>${drivers}<br>` +
    `<b>config</b> ${e.configVersion ?? '—'}` + refused;
  // The refusal is the beat: hoist it into the sentence when it first appears.
  const top = (e.refused || [])[0];
  if (top && S.lastRefused !== top.id) {
    S.lastRefused = top.id;
    const item = byId(top.id);
    const beat = top.score > chosenScore;
    $('sentence').textContent = beat
      ? `${item ? item.name : top.id} scored ${top.score} for this shopper — higher than the ${chosenScore.toFixed(3)} of what we actually showed — and a merchandising rule refused it: ${top.gate}.`
      : `${item ? item.name : top.id} was refused by a merchandising rule: ${top.gate}. Her affinity is untouched — gates judge the item, never the shopper.`;
    S.sayLockUntil = Date.now() + 8000;
  }
}

function paint(prev, next, first, rowMoved = false, tick = false) {
  const heroChanged = pick(prev, 'hero')?.itemId !== pick(next, 'hero')?.itemId || S.heroDirty;
  S.heroDirty = false;
  const nextRow = next.filter((d) => d.slot === 'row').map((d) => d.itemId);
  const prevRow = prev.filter((d) => d.slot === 'row').map((d) => d.itemId);
  const rowChanged = JSON.stringify(prevRow) !== JSON.stringify(nextRow);

  if (first || heroChanged) swap($('hero'), () => paintHero(pick(next, 'hero')), first);
  if (first || rowChanged || rowMoved) paintRow(next.filter((d) => d.slot === 'row'), prevRow, first, rowMoved, tick);
  if (first || pick(prev, 'block_a')?.blockId !== pick(next, 'block_a')?.blockId) {
    swap($('block_a'), () => paintBlock(pick(next, 'block_a'), 'block_a'), first);
  }
  // The composer always scored a second block; the page never rendered it.
  if (first || pick(prev, 'block_b')?.blockId !== pick(next, 'block_b')?.blockId) {
    swap($('block_b'), () => paintBlock(pick(next, 'block_b'), 'block_b'), first);
  }
}

/** Fade out, replace, fade in, then a one-second glow. Never a blackout. */
function swap(el, render, instant) {
  if (instant) { render(); return; }
  el.classList.add('swapping');
  setTimeout(() => {
    render();
    el.classList.remove('swapping');
    el.classList.remove('pulse'); void el.offsetWidth; el.classList.add('pulse');
  }, 300);
}

function paintHero(d) {
  const o = S.heroOverride;
  const it = d?.itemId && byId(d.itemId);
  const cold = !o && (!d || d.strategy === 'cold-start' || d.strategy === 'fallback');
  $('hero').classList.toggle('quiet', !o && d?.strategy === 'fading');
  $('hero-kicker').textContent = o ? o.kicker
    : cold ? 'Welcome'
    // Checked BEFORE the fading branch: with only a geo prior the honest reason
    // is geography whether or not the band has crossed a threshold. Ordering it
    // after 'fading' silently downgraded the cold-start beat to "Featured".
    : !S.behaved ? 'Because of where you are'
    : d.strategy === 'fading' ? 'Featured'
    : 'Because of what you have looked at';
  $('hero-title').textContent = o ? o.title
    : cold ? (S.vertical === 'retail' ? 'Made to be kept' : 'Banking that fits the year you are having')
    : it.name;
  $('hero-body').textContent = o ? o.body
    : cold ? 'Considered pieces, honestly priced, chosen for how you actually live.' : it.blurb;
  $('hero-cta').textContent = S.vertical === 'retail' ? 'Add to bag' : 'Start application';
  // The hero is the biggest surface in the room, so it gets the photograph with
  // the drawing underneath as the fallback, same as the cards.
  $('hero-art').innerHTML = !it ? ''
    : S.vertical === 'financial' ? financeArt(it)
    : packshot(it, { withName: false, square: true })
      + (it.image ? `<img src="${it.image}" alt="" onload="this.dataset.loaded=1" onerror="this.remove()">` : '');
  $('hero-art').classList.toggle('fin', S.vertical === 'financial');
  if (it) $('hero-cta').onclick = () => signal('intent_start', it);
}

const ALL_HUES = ['#E8503A', '#E8A317', '#7CA82F', '#12968C', '#4257C4', '#9B45A0', '#DB4079', '#4E7AA8', '#C8452B', '#C08A12', '#6E9430', '#12786E', '#2F52A8', '#7E3A80', '#B8355F', '#3F6389'];

/**
 * Two cards of the same hue in one row destroys the only thing the eye was
 * tracking through a re-rank. Identity is per item, but a VISIBLE ROW must
 * always show five distinct colours, so a repeat borrows an unused one.
 */
// ── The finance surface ─────────────────────────────────────────────────────
// A bank does not merchandise. It offers, and it asks you to apply — so the
// centre panel renders differently rather than being the same grid with the
// nouns swapped. A shopper adds to a bag; an applicant starts an application,
// and the thing they are comparing is a RATE, not a photograph.
//
// This is also why finance needs no photography: a card face is a graphic
// object that banks genuinely merchandise, and a mortgage has no packshot. The
// engine underneath is untouched — same slots, same seven dimensions, same
// decisions by id. Only the rendering changes, which is exactly the contract we
// sell: we return the decision, the customer's front end paints it.

const RATE_LABEL = { Mortgage: 'APR', Auto: 'APR', Card: 'APR', Savings: 'APY', Investing: 'est. return' };

function financeArt(it) {
  // Credit cards get a card face — the one thing in banking that IS a product shot.
  if (it.category === 'Card') {
    return `<div class="fin-card" style="--h:${it.hex}">
      <div class="fin-chip"></div>
      <div class="fin-name">${it.name}</div>
      <div class="fin-limit">${money(it.value_usd)} limit</div>
    </div>`;
  }
  // Everything else is an offer: the number they are comparing, made the subject.
  const rate = it.rate_pct != null ? it.rate_pct.toFixed(2) : null;
  const AMOUNT_LABEL = { Mortgage: 'typical advance', Auto: 'typical advance',
                         Savings: 'typical balance', Investing: 'typical balance' };
  return `<div class="fin-offer" style="--h:${it.hex}">
    ${rate
      ? `<div class="fin-rate">${rate}<span>%</span></div>
         <div class="fin-unit">${RATE_LABEL[it.category] ?? 'APR'}</div>`
      : `<div class="fin-rate sm">${money(it.value_usd)}</div>
         <div class="fin-unit">typical balance</div>`}
    <div class="fin-term">${it.subcategory} · ${it.category.toLowerCase()}</div>
    ${rate ? `<div class="fin-amount">${money(it.value_usd)}<span>${AMOUNT_LABEL[it.category] ?? 'typical'}</span></div>` : ''}
  </div>`;
}

function distinctHues(items) {
  const used = new Set(); const out = new Map();
  for (const it of items) {
    let hex = it.hex;
    if (used.has(hex)) hex = ALL_HUES.find((h) => !used.has(h)) ?? hex;
    used.add(hex); out.set(it.id, hex);
  }
  return out;
}

/**
 * FLIP, with a cascade.
 *
 * The row was re-rendered with innerHTML, so cards TELEPORTED — the new order
 * simply appeared and there was nothing to watch. The travel is the beat: a card
 * climbing from nine to two is the whole argument for personalized sort, and it
 * has to be witnessed, not inferred from a number that changed.
 *
 * Movers are released in final-rank order with a stagger between them, so the
 * row resolves front to back rather than everything sliding at once. One card
 * settling, then the next, then the next — which is also slow enough for a
 * presenter to narrate over.
 */
const FLIP_STAGGER_MS = 110;

function captureRow() {
  const m = new Map();
  $('row').querySelectorAll('.card').forEach((el) => m.set(el.dataset.id, el.getBoundingClientRect()));
  return m;
}

function flipRow(before) {
  if (!before.size) return;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const cards = [...$('row').querySelectorAll('.card')];
  const moves = [];
  cards.forEach((el) => {
    const b = before.get(el.dataset.id);
    if (!b) return;
    const a = el.getBoundingClientRect();
    const dx = b.left - a.left; const dy = b.top - a.top;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
    moves.push({ el, dx, dy });
  });
  if (!moves.length) return;

  // Sit every mover back where it came from, with no transition...
  for (const { el, dx, dy } of moves) {
    el.style.transition = 'none';
    el.style.transform = `translate(${dx}px, ${dy}px) scale(1.06)`;
    el.classList.add('travelling');
  }
  // ...then release them one at a time, in the order they will come to rest.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    moves.forEach(({ el }, i) => {
      el.style.transition = `transform var(--t-flip) var(--ease) ${i * FLIP_STAGGER_MS}ms`;
      el.style.transform = '';
      // FILTER THE EVENT. transitionend BUBBLES: the product photograph inside
      // the card fades in on load, its opacity transition ends, the event rises
      // to the card, and an unfiltered handler wipes the card's transform in the
      // middle of its travel. Measured — the move died at 150ms of 450ms, having
      // covered a quarter of the distance, which reads as a stutter rather than
      // a bug and is the kind of thing that survives to the stage.
      const done = (e) => {
        if (e.target !== el || e.propertyName !== 'transform') return;
        el.removeEventListener('transitionend', done);
        el.style.transition = ''; el.style.transform = '';
        el.classList.remove('travelling');
        el.classList.remove('landed'); void el.offsetWidth; el.classList.add('landed');
      };
      el.addEventListener('transitionend', done);
    });
  }));
}

// ── The row: reconciled, never rebuilt ───────────────────────────────────────
// innerHTML on every re-rank destroyed all ten cards and built ten new ones.
// Each new <img> started at opacity 0 and faded in on load, so the products
// blinked out and reappeared — the flicker — and the travel animation was
// moving brand-new nodes into place. Cards now persist across paints: the DOM
// is reordered, only the rank chip and the change badge are updated, and the
// photograph is never reloaded.
const ROW = { nodes: new Map(), lastMovers: [], holdTimer: null };

function cardNode(it, hue) {
  const el = document.createElement('article');
  el.className = 'card';
  el.dataset.id = it.id;
  el.style.setProperty('--hue', hue);
  const val = S.vertical === 'retail' ? money(it.value_usd)
    : (it.rate_pct != null ? `${it.rate_pct.toFixed(2)}% APR` : 'See terms');
  el.innerHTML = `
    <div class="rank"></div>
    <div class="delta" hidden></div>
    <div class="ph${S.vertical === 'financial' ? ' fin' : ''}">${S.vertical === 'financial'
      ? financeArt(it)
      : packshot(it, { withName: false }) + (it.image
        ? `<img src="${it.image}" alt="" loading="lazy" onload="this.dataset.loaded=1" onerror="this.remove()">`
        : '')}</div>
    <div class="meta"><div class="nm">${it.name}</div>
      <div class="mt">${it.category} · ${it.colour || it.subcategory}</div>
      <div class="pr">${val}</div>
      <button class="add" type="button">${S.vertical === 'financial' ? 'Start application' : 'Add to bag'}</button></div>`;
  el.onclick = () => signal('row_click', byId(el.dataset.id));
  // The bag button is INTENT, not a view — and it must not also count as a click.
  el.querySelector('.add').onclick = (e) => {
    e.stopPropagation();
    const item = byId(el.dataset.id);
    signal('intent_start', item);
    if (window.MOMENTS) window.MOMENTS.addToBag(item);
  };
  return el;
}

/**
 * Movers wear one loud colour on all four sides, with the position they landed
 * on and where they came from. It holds long enough to be talked about, then
 * fades — so green always means "this JUST changed", never "this changed at
 * some point". Replay re-applies it to the same cards for a question that
 * arrives three minutes later.
 */
/** The order a cold visitor would see: personalization's control. */
function controlOrder() {
  const cold = compose({ affinity: { dims: {}, audiences: [] }, items: S.items, blocks: S.blocks,
                         config: S.config, shapeOfKey: SHAPE_OF_KEY, rowSize: 10, pins: S.pins });
  return cold.filter((d) => d.slot === 'row').map((d) => d.itemId);
}

/**
 * What personalization changed, measured against the standard order — so it is
 * true whenever it is pressed, not a replay of whatever moved last. A card is
 * green if it sits somewhere other than where the control would have put it;
 * "was N" is its standard position. When the row IS the standard order, nothing
 * is green, and the button says so.
 */
function showWhatChanged() {
  const control = controlOrder();
  const cards = [...$('row').querySelectorAll('.card')];
  const movers = [];
  cards.forEach((el, i) => {
    const cp = control.indexOf(el.dataset.id);
    if (cp === -1) movers.push({ id: el.dataset.id, was: null, now: i + 1, up: true });
    else if (cp !== i) movers.push({ id: el.dataset.id, was: cp + 1, now: i + 1, up: cp > i });
  });
  const promoted = movers.filter((m) => m.up);
  if (!promoted.length) {
    consequence('What changed', 'Nothing — this is the standard order',
      'Personalization has no claim on the row right now, so no card is out of its control position.');
    return;
  }
  highlightMovers(promoted, 10000, 'std');
  consequence('What changed', `${promoted.length} card${promoted.length === 1 ? '' : 's'} sit above where the standard order puts them`,
    promoted.map((m) => `${byId(m.id)?.name ?? m.id}: ${m.was ? `${m.was} → ${m.now}` : `in at ${m.now}`}`).join(' · '));
}

function highlightMovers(movers, holdMs, label = 'was') {
  clearTimeout(ROW.holdTimer);
  $('row').querySelectorAll('.card.changed').forEach((el) => el.classList.remove('changed'));
  for (const { id, was, now } of movers) {
    const el = ROW.nodes.get(id); if (!el) continue;
    el.classList.add('changed');
    const d = el.querySelector('.delta');
    d.classList.remove('quiet');
    d.hidden = false;
    d.innerHTML = `<b>${now}</b><small>${was == null ? (label === 'std' ? 'not in std' : 'new in') : `${label} ${was}`}</small>`;
  }
  ROW.holdTimer = setTimeout(() => {
    $('row').querySelectorAll('.card.changed').forEach((el) => el.classList.remove('changed'));
  }, holdMs);
}

function paintRow(ds, prevIds, first, rowMoved = false, tick = false) {
  const row = $('row');
  if (first) { ROW.nodes.clear(); row.innerHTML = ''; ROW.lastMovers = []; }
  // A parent section translating in the same frame would add its delta to
  // every card's — so the card FLIP stands down when the section itself moves.
  const geometryBefore = (first || rowMoved) ? new Map() : captureRow();
  const rankBefore = new Map(prevIds.map((id, i) => [id, i + 1]));
  const items = ds.map((d) => byId(d.itemId)).filter(Boolean);
  const hues = distinctHues(items);
  const keep = new Set(items.map((it) => it.id));

  // Remove what left, create what arrived, and put everything in order without
  // touching the nodes that merely moved.
  for (const [id, el] of ROW.nodes) if (!keep.has(id)) { el.remove(); ROW.nodes.delete(id); }
  const movers = [];
  items.forEach((it, i) => {
    let el = ROW.nodes.get(it.id);
    if (!el) { el = cardNode(it, hues.get(it.id) || it.hex); ROW.nodes.set(it.id, el); }
    else el.style.setProperty('--hue', hues.get(it.id) || it.hex);
    if (row.children[i] !== el) row.insertBefore(el, row.children[i] || null);
    el.querySelector('.rank').textContent = i + 1;
    const was = rankBefore.get(it.id);
    const d = el.querySelector('.delta');
    if (tick || first) { d.hidden = true; }
    else if (was && was > i + 1) movers.push({ id: it.id, was, now: i + 1, up: true });     // climbed
    else if (!was && prevIds.length) movers.push({ id: it.id, was: null, now: i + 1, up: true }); // entered
    else if (was && was < i + 1) {                                                              // slipped
      d.hidden = false; d.classList.add('quiet'); d.innerHTML = `<small>was ${was}</small>`;
    } else { d.hidden = true; }
  });

  flipRow(geometryBefore);
  if (movers.length) { ROW.lastMovers = movers; highlightMovers(movers, 12000); }

  const completing = ds.some((d) => d.strategy === 'completion');
  const anchor = completing && byId(ds.find((d) => d.anchorId)?.anchorId);
  const claims = ds.some((d) => d.strategy === 'affinity');
  document.querySelector('.row-head').classList.toggle('quiet', !completing && !claims && ds.some((d) => d.strategy === 'fading'));
  $('row-title').textContent = completing
    ? (S.vertical === 'retail' ? 'Complete the look' : 'Complete your application')
    : (S.vertical === 'retail' ? 'Selected for you' : 'Suited to you');
  $('row-note').textContent = completing
    ? `chosen to go with the ${anchor ? anchor.name : 'piece you chose'} — nothing from the same category`
    : claims ? 'ranked by what you have shown interest in'
    : ds.some((d) => d.strategy === 'fading') ? 'our usual order' : 'the same order every shopper sees';
}

function paintBlock(d, slot = 'block_a') {
  const b = d?.blockId && byId(d.blockId);
  $(slot).innerHTML = b ? `<div class="block" data-id="${b.id}">
    <span class="type">${b.contentType}</span><h4>${b.title}</h4><p>${b.kicker}</p></div>` : '';
  const el = $(slot).querySelector('.block');
  if (el) el.onclick = () => signal('block_read', b);
}

// ── The instrument ──────────────────────────────────────────────────────────
function renderBars() {
  const dims = [...S.registry.dimensions].sort(
    (a, b) => SHAPE_ORDER.indexOf(a.shape) - SHAPE_ORDER.indexOf(b.shape));
  $('bars').innerHTML = dims.map((d) => `
    <div class="bar" data-dim="${d.key}">
      <div class="top"><span class="k">${d.key} <em id="v-${d.key}"></em></span>
        <span class="a" id="a-${d.key}">0.000</span></div>
      <div class="track">
        <div class="band" style="left:${d.thetaOut * 100}%;width:${(d.thetaIn - d.thetaOut) * 100}%"></div>
        <div class="fill" style="width:0%"></div>
        <div class="tick out" style="left:${d.thetaOut * 100}%"></div>
        <div class="tick in" style="left:${d.thetaIn * 100}%"></div>
      </div></div>`).join('');
}

/**
 * Journey stage is ORDINAL, so the instrument must show the furthest stage she
 * has reached and still holds — not the highest-scoring one. Browsing
 * out-accumulates deciding easily (an arrival plus two department clicks beats
 * one add-to-bag), so the panel read "journeyStage · browsing" while the page
 * beside it read "Complete the look". Both were true by their own rule and the
 * room sees a contradiction, which is worse than either being wrong.
 */
const STAGE_ORDER = ['browsing', 'considering', 'deciding', 'exploring', 'comparing', 'applying'];

function paintBars(dims) {
  for (const spec of S.registry.dimensions) {
    const per = dims?.[spec.key] || {};
    let top = null, a = 0;
    for (const [v, x] of Object.entries(per)) if (x > a) { a = x; top = v; }

    // D2: a recency-led dimension leads on its last touch, and the bar must
    // agree with the page — otherwise the panel says Drover while the row
    // leads with Linden, which is the contradiction this rule exists to remove.
    if (LEAD_BY[spec.key] === 'recency') {
      const lv = leadValue(S.reflex, spec.key);
      if (lv && per[lv] != null) { top = lv; a = per[lv]; }
    }
    if (SHAPE_OF_KEY[spec.key] === 'stage') {
      let furthest = null, fa = 0;
      for (const [v, x] of Object.entries(per)) {
        if (x < spec.thetaOut) continue;                       // no longer held
        if (furthest === null || STAGE_ORDER.indexOf(v) > STAGE_ORDER.indexOf(furthest)) {
          furthest = v; fa = x;
        }
      }
      if (furthest) { top = furthest; a = fa; }
    }
    const bar = document.querySelector(`.bar[data-dim="${spec.key}"]`);
    if (!bar) continue;
    bar.querySelector('.fill').style.width = `${Math.min(100, a * 100)}%`;
    bar.classList.toggle('in', a >= spec.thetaIn);
    bar.classList.toggle('warm', a >= spec.thetaOut && a < spec.thetaIn);
    $(`a-${spec.key}`).textContent = a.toFixed(3);
    $(`v-${spec.key}`).textContent = top ? `· ${top}` : '';
  }
}

setInterval(() => {
  if (!S.reflex || !S.config) return;
  // tick() never accumulates — it re-reads at `now` and applies the exits decay
  // has already earned. This is what lets the staircase land on the page at the
  // honest moment instead of waiting for the server's alarm to travel.
  const res = tick(S.reflex, Date.now(), S.config);
  S.reflex = res.state;
  if (res.changes.entered.length || res.changes.exited.length) absorb(res.changes);
  recompose(false, { tick: true });
}, 1000);

const isStageAudience = (a) => /^(journeystage|applicationstage)_/.test(a);
function renderChips(entered, exited) {
  const el = $('chips'); const live = [...S.audiences].filter((a) => !isStageAudience(a));
  entered = entered.filter((a) => !isStageAudience(a)); exited = exited.filter((a) => !isStageAudience(a));
  if (!live.length && !exited.length) { el.innerHTML = '<span class="none">none yet</span>'; return; }
  el.innerHTML = live.map((a) => `<span class="chip${entered.includes(a) ? ' new' : ''}">${a}</span>`).join('')
    + exited.map((a) => `<span class="chip gone">${a}</span>`).join('');
  setTimeout(() => el.querySelectorAll('.chip.gone').forEach((n) => n.remove()), 1200);
}

const SURFACE_NAME = { hero: 'The hero', row: 'The product row', block_a: 'The story' };
const SECTION_NAME = { hero: 'The hero', offer: 'The offer', row: 'The product row', block_a: 'The story', block_b: 'The second story', takeover: 'The takeover' };

/**
 * The staircase, narrated. Each dimension carries its own decay constant, so a
 * single stretch of inactivity produces several separate retreats — narrow
 * interest forgotten before broad, broad before the underlying need. Naming
 * WHICH surface gave up its claim, and why, is the beat.
 */
/**
 * A slot may only announce a retreat from a claim it actually HELD.
 *
 * Measured at human pace: the cold-start prior landed the band at a = 0.400
 * against an exit threshold of 0.40, so it claimed for a single tick and then
 * crossed out — and the page announced "the hero stopped claiming" and "the
 * product row stopped claiming" at 0.0s, before the presenter had touched
 * anything. A retreat from a claim nobody ever saw is noise, and it spends the
 * narration that beat 21 depends on.
 */
const CLAIM_HELD_MS = 5000;

function announceRetreat(prev, next) {
  if (!prev.length) return;
  const now = Date.now();
  const claiming = new Set(next.filter((d) => d.strategy === 'affinity').map((d) => d.slot));
  for (const slot of claiming) if (!(slot in S.claimedAt)) S.claimedAt[slot] = now;
  for (const slot of [...S.withdrawn]) if (claiming.has(slot)) S.withdrawn.delete(slot);
  const was = new Map(prev.map((d) => [d.slot + ':' + d.order, d.strategy]));
  for (const d of next) {
    if (!SURFACE_NAME[d.slot] || S.withdrawn.has(d.slot) || claiming.has(d.slot)) continue;
    const before = was.get(d.slot + ':' + d.order);
    if (before === 'affinity' && (d.strategy === 'fading' || d.strategy === 'fallback')) {
      const heldFor = now - (S.claimedAt[d.slot] ?? now);
      delete S.claimedAt[d.slot];
      if (heldFor < CLAIM_HELD_MS) continue;   // never really claimed it
      S.withdrawn.add(d.slot);
      const drv = d.explain.drivers?.[0];
      consequence('Decay', `${SURFACE_NAME[d.slot]} stopped claiming`,
        drv ? `${drv.dim} fell to ${d.explain.confidence?.toFixed(3)}, under its exit threshold of ${d.explain.thetaOut}. It still ranks — it is no longer entitled to say the visitor is the reason.`
            : 'The signal behind it fell below its exit threshold.', true);
    }
  }
}

/** What the action CAUSED downstream — not what it changed on screen. */
function consequence(head, msg, sub, decay) {
  markTab('trail');
  const el = document.createElement('div');
  el.className = 'cq' + (decay ? ' decay' : '');
  el.innerHTML = `<div class="h">${head}</div><div class="m">${msg}</div>${sub ? `<div class="s">${sub}</div>` : ''}`;
  $('conseq').prepend(el);
  while ($('conseq').children.length > 4) $('conseq').lastChild.remove();
}

/** One sentence at a time, cause first. The line the room actually reads. */
function say(r) {
  if (Date.now() < S.sayLockUntil) return;   // a headline beat holds the line
  $('sentence').textContent = r.direction === 'enter'
    ? `Entered ${r.audience} — ${r.dim} ${r.value} reached ${r.score.toFixed(4)}, past the entry threshold of ${r.thetaIn}.`
    : `Left ${r.audience} — ${r.dim} ${r.value} fell to ${r.score.toFixed(4)}, under the exit threshold of ${r.thetaOut}.`;
}

// ── Ask in words ────────────────────────────────────────────────────────────
//
// The model routes the sentence to ONE scene from a closed set — the response
// schema is an enum, so a hallucinated scene is rejected at the type boundary
// before it reaches any code of ours. It does not choose the products; the same
// ranker that composes the page does that. The copy and the artwork were
// written before the demo started.

let SCENE_COUNT = null;
$('btn-ask').onclick = () => { $('ask').classList.add('open'); $('q').focus(); };
$('ask-close').onclick = () => $('ask').classList.remove('open');

$('ask-form').onsubmit = async (e) => {
  e.preventDefault();
  const query = $('q').value.trim(); if (!query) return;
  const input = $('q'); const was = input.placeholder;
  input.disabled = true; input.placeholder = 'reading that…';

  const a = await fetch(`${API}/search`, {
    method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ vertical: S.vertical, query }),
  }).then((r) => r.json()).catch(() => null);
  input.disabled = false; input.placeholder = was; input.value = '';

  if (!a?.scene) {
    $('sentence').textContent = `Nothing in the approved set matched "${query}". Nothing was invented to fill the gap.`;
    return;
  }
  if (SCENE_COUNT === null) {
    SCENE_COUNT = (await fetch(`${API}/scenes?vertical=${S.vertical}`).then((x) => x.json())
      .catch(() => ({ scenes: [] }))).scenes.length;
  }

  // A search is an ordinary signal — it goes through apply() like any click.
  const res = apply(S.reflex, { action: 'search', touches: a.touches }, Date.now(), S.config);
  S.reflex = res.state; absorb(res.changes); recompose();
  post('/action', { vertical: S.vertical, events: [{ action: 'search', touches: a.touches }] });

  const snap = snapshot(S.reflex, Date.now(), S.config);
  const ds = compose({ affinity: snap, state: S.reflex, items: S.items, blocks: S.blocks, config: S.config,
                       shapeOfKey: SHAPE_OF_KEY, rowSize: 4 });
  const picks = ds.filter((d) => d.slot === 'row').map((d) => byId(d.itemId)).filter(Boolean);
  const hues = distinctHues(picks);

  $('ask-art').style.backgroundImage = `url(${a.scene.art})`;
  $('ask-kick').textContent = query;
  $('ask-title').textContent = a.scene.headline;
  $('ask-sub').textContent = a.scene.subhead;
  $('ask-prov').innerHTML =
    `Routed by the <b>${a.source === 'model' ? 'model' : 'local classifier'}</b> to one of ` +
    `<b>${SCENE_COUNT}</b> approved scenes · confidence <b>${a.confidence.toFixed(2)}</b> · <b>${a.ms}ms</b><br>` +
    `Signal applied: <b>${a.touches.map((t) => `${t.dim}=${t.value}`).join(', ')}</b>. ` +
    `Products ranked by the engine, not by the model. Copy and artwork were written before this demo.`;
  $('ask-row').innerHTML = picks.map((it, i) => `
    <article class="card" style="--hue:${hues.get(it.id)}" data-id="${it.id}">
      <div class="rank">${i + 1}</div>
      <div class="ph">${packshot(it, { withName: false })}${it.image
        ? `<img src="${it.image}" alt="" loading="lazy" onload="this.dataset.loaded=1" onerror="this.remove()">`
        : ''}</div>
      <div class="meta"><div class="nm">${it.name}</div>
        <div class="mt">${it.category} · ${it.subcategory}</div>
        <div class="pr">${S.vertical === 'retail' ? money(it.value_usd)
          : (it.rate_pct != null ? it.rate_pct.toFixed(2) + '% APR' : 'See terms')}</div></div>
    </article>`).join('');
  $('ask-answer').hidden = false;
  consequence('Search', `Routed to "${a.scene.id}" by the ${a.source === 'model' ? 'model' : 'local classifier'}`,
    `One of ${SCENE_COUNT} approved scenes. The set is closed — the schema is an enum, so it cannot invent one.`);
};

// ── The moment ──────────────────────────────────────────────────────────────
//
// Signal → Opal writes the creative → it composes onto ARTWORK ALREADY APPROVED
// → a real flag ships. We do not generate the picture: generating a photograph
// live invites exactly the question this beat exists to answer, and the awe was
// never in the image. It is in the loop closing inside a sentence.

$('btn-moment').onclick = async () => {
  const btn = $('btn-moment'); const label = btn.innerHTML;
  const t0 = Date.now();
  btn.disabled = true; btn.textContent = 'reading the signal…';

  consequence('Signal', 'Partner feed reports a spike',
    'This detection layer is SIMULATED and labelled on screen — we do not ship social listening. Everything after this line is ours.');

  const m = await fetch(`${API}/moment/write`, {
    method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ vertical: S.vertical }),
  }).then((x) => x.json()).catch(() => null);

  if (!m?.ok) {
    btn.disabled = false; btn.innerHTML = label;
    return consequence('Moment', 'Nothing shipped', m?.reason ?? 'The moment service could not be reached.');
  }

  btn.textContent = 'shipping…';
  const fx = await fetch(`${API}/experiment/dispatch`, {
    method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ vertical: S.vertical, source: m.signal.source.toLowerCase(), flavour: 'ab' }),
  }).then((x) => x.json()).catch(() => null);
  btn.disabled = false; btn.innerHTML = label;

  const secs = Math.round((Date.now() - t0) / 1000);
  $('tk-art').style.backgroundImage = `url(${m.art})`;
  $('tk-eyebrow').textContent = m.eyebrow;
  $('tk-head').textContent = m.headline;
  $('tk-sub').textContent = m.subcopy;
  $('tk-cta').textContent = m.cta;
  $('tk-foot').innerHTML =
    `Signal: <b>${m.signal.source} — ${m.signal.subject}</b> · copy written by the model in <b>${m.ms}ms</b> · ` +
    `composed onto an approved still, not generated · ` +
    (fx?.ok ? `live as flag <b>${fx.flagKey}</b>` : 'flag not shipped') +
    `<br>Loop closed in <b>${secs}s</b>. The artwork was signed off before this demo; only the words are new.`;
  $('takeover').hidden = false;
  $('hero').style.display = 'none';

  consequence('Moment live', `${m.itemName} — ${m.headline}`,
    `Signal to live creative in ${secs}s. Copy written now; artwork approved beforehand; shipped as a real flag.`);
  $('sentence').textContent =
    `Signal to live creative in ${secs} seconds. The picture was approved before today — only the words are new, and they went out as a real flag.`;
  S.sayLockUntil = Date.now() + 9000;
};

// ── Receipts ────────────────────────────────────────────────────────────────

let captureTimer = null, lastCaptured = '';
function captureDecisions(ds) {
  const sig = ds.map((d) => `${d.slot}:${d.itemId || d.blockId}:${d.strategy}`).join('|');
  if (sig === lastCaptured) return;              // only write when the page actually changed
  lastCaptured = sig;
  clearTimeout(captureTimer);
  captureTimer = setTimeout(() => {
    post('/decisions', { vertical: S.vertical, decisions: ds, sections: S.layout?.sections ?? [],
                         arrivalSurface: S.heroOverride?.from ?? null, demoRunId: S.runId });
  }, 400);
}

$('btn-receipts').onclick = async () => {
  const r = await fetch(`${API}/decisions/export?visitorId=${VID}&limit=60`, { credentials: 'omit' })
    .then((x) => x.json()).catch(() => null);
  if (!r?.ok) {
    return consequence('Receipts', 'Export unavailable',
      r?.error ? `The store reported: ${r.error}` : 'The export endpoint could not be reached.');
  }
  $('rec-count').textContent = `${r.rows.length} decisions · ${r.columns.length} columns`;
  $('rec-table').innerHTML =
    `<thead><tr>${r.columns.map((c) => `<th>${c}</th>`).join('')}</tr></thead><tbody>` +
    r.rows.map((row) => `<tr>${r.columns.map((c) => {
      const v = row[c]; const t = v == null ? '' : String(v);
      return `<td title="${t.replace(/"/g, '&quot;')}">${t.length > 42 ? t.slice(0, 42) + '…' : t}</td>`;
    }).join('')}</tr>`).join('') + '</tbody>';
  $('receipts').classList.add('open');
  consequence('Receipts', `${r.rows.length} decision rows exported`,
    'Every slot, every candidate count, every driver, every refusal, and the config version it ran under. We hand you the rows; you compute the lift.');
  $('sentence').textContent =
    'We will never present our own uplift number as the proof. These are the rows that let you check us.';
  S.sayLockUntil = Date.now() + 8000;
};
$('rec-close').onclick = () => $('receipts').classList.remove('open');
$('btn-radar').onclick = async () => {
  $('radar').classList.add('open');
  // Always open on the blended view. The lie has to be seen before it is caught.
  RAD.baseline = null;
  await radar([]);
};
$('rad-close').onclick = () => $('radar').classList.remove('open');
$('btn-replay').onclick = () => showWhatChanged();
// Compare captures pixels, so whatever "changed" highlight is on the page at
// capture time is in the frame — before and after can be held side by side
// three minutes later, which is the reason the tool exists.
$('btn-capture').onclick = async () => {
  const r = await captureBaseline($('page'));
  $('btn-capture').classList.toggle('on', !!r.ok);
  $('btn-capture').innerHTML = r.ok ? 'Baseline captured<small>compare when ready</small>' : 'Capture baseline<small>freeze the page now</small>';
  if (r.ok) consequence('Compare', 'Baseline captured', 'Compare will show this frame against whatever the page looks like then.');
};
$('btn-compare').onclick = () => openCompare($('page'));
$('btn-conc').onclick = () => { $('conc').classList.add('open'); $('conc-q').focus(); };
$('conc-close').onclick = () => $('conc').classList.remove('open');
$('conc-reset').onclick = () => {
  CONC.history = []; CONC.shown = []; $('conc-thread').innerHTML = '';
};
$('conc-form').onsubmit = (e) => {
  e.preventDefault();
  const q = $('conc-q').value.trim();
  if (!q) return;
  $('conc-q').value = '';
  conciergeAsk(q);
};

// ── Merchandising authority ─────────────────────────────────────────────────
//
// Declared precedence: eligibility gates run BEFORE scoring is allowed to matter,
// pins outrank the engine, and weighted ranking operates only in the space left.
// Gates judge the ITEM, never the shopper — a sold-out piece drops out and her
// affinity is untouched.

S.pins = {};

/** A control names what it is AND what it currently is. The label never changed,
 *  so a presenter mid-session could not tell whether the hero was pinned. */
function paintPinButton() {
  const on = !!S.pins.hero;
  $('btn-pin').innerHTML = on
    ? 'Release the pin<small>ranking resumes</small>'
    : 'Pin the hero<small>merchandiser wins</small>';
  $('btn-pin').classList.toggle('on', on);
}

$('btn-pin').onclick = () => {
  if (S.pins.hero) {
    delete S.pins.hero;
    consequence('Merchandising', 'Hero pin released', 'Ranking resumes for this slot.');
  } else {
    // Pin something the engine did NOT choose, so the override is unmistakable.
    const current = pick(S.decisions, 'hero')?.itemId;
    const other = S.items.find((i) => i.id !== current && i.available !== false);
    S.pins.hero = other?.id;
    consequence('Merchandising', `Hero pinned to ${other?.name}`,
      'Every shopper sees this now. Ranking is skipped for the slot — the merchandiser outranks the engine and the record says so.');
    $('sentence').textContent = 'A merchandiser pinned the hero. Ranking never ran for that slot.';
    S.sayLockUntil = Date.now() + 6000;
  }
  S.heroDirty = true; recompose();
  paintPinButton();
};

$('btn-soldout').onclick = () => {
  const top = S.items.find((i) => i.id === pick(S.decisions, 'row')?.itemId);
  if (!top) return;
  top.available = false;
  consequence('Availability', `${top.name} sold out`,
    'An item property, never a visitor property. It drops out of the candidate set; her affinity is untouched.');
  recompose();
};

// ── Opal: propose, then a person publishes ──────────────────────────────────
//
// The model's output schema is built from the LIVE registry and the LIVE
// catalogue, so it can only name dimensions that exist and values this catalogue
// actually contains. And it does not publish — proposing and publishing are two
// separate acts because the governance beat IS the point.

S.published = [];

$('btn-opal').onclick = async () => {
  $('opal').classList.add('open'); $('oq').focus();
  const v = await fetch(`${API}/opal/vocabulary?vertical=${S.vertical}`, { credentials: 'omit' })
    .then((x) => x.json()).catch(() => null);
  if (v?.ok) {
    $('opal-vocab').innerHTML =
      `Opal may choose from <b>${v.dimensions}</b> dimensions and <b>${v.values}</b> values — every one of them ` +
      `present in this catalogue. It cannot name anything else: the response schema is built from the registry, ` +
      `so an invented dimension is rejected before it reaches our code.`;
  }
};
$('opal-close').onclick = () => $('opal').classList.remove('open');

$('opal-form').onsubmit = async (e) => {
  e.preventDefault();
  const ask = $('oq').value.trim(); if (!ask) return;
  const input = $('oq'); const was = input.placeholder;
  input.disabled = true; input.placeholder = 'Opal is reading your catalogue…';
  $('opal-out').innerHTML = '';

  const p = await fetch(`${API}/opal/propose`, {
    method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ vertical: S.vertical, ask }),
  }).then((x) => x.json()).catch(() => null);
  input.disabled = false; input.placeholder = was;

  if (!p?.ok) {
    $('opal-out').innerHTML = `<div class="prop"><div class="refused">${
      p?.reason ?? 'Opal could not be reached.'} Nothing was proposed and nothing was written.</div></div>`;
    return;
  }
  input.value = '';
  $('opal-out').innerHTML = `<div class="prop">
    <h3>${p.name}</h3>
    <p class="why">${p.rationale}</p>
    <div class="cond">${p.conditions.map((c) => `<span>${c.dim} = ${c.value} ≥ ${c.atLeast}</span>`).join('')}</div>
    <div class="foot">
      <div class="k">Proposed by the model in ${p.ms}ms · key <b>${p.key}</b><br>
        Nothing is live yet. Opal proposed it; you decide.</div>
      <button id="opal-publish">Publish</button>
    </div></div>`;
  $('opal-publish').onclick = () => publishAudience(p);
  consequence('Opal', `Proposed "${p.name}"`,
    `${p.conditions.length} condition${p.conditions.length === 1 ? '' : 's'} over the real registry. Not published — a person still has to say yes.`);
};

/** The governance beat: a person publishes, and the engine starts evaluating it. */
function publishAudience(p) {
  S.published.push({ key: p.key, name: p.name, conditions: p.conditions });
  const btn = $('opal-publish');
  if (btn) { btn.textContent = 'Published ✓'; btn.classList.add('done'); btn.disabled = true; }
  consequence('Published', `"${p.name}" is live`,
    'A person approved it, with a name and a timestamp. The engine evaluates it from the next signal onward.');
  $('sentence').textContent =
    `"${p.name}" published. The machine proposed it, you decided, and both are on the record.`;
  S.sayLockUntil = Date.now() + 6000;
  recompose();
}

/** Published audiences are evaluated from the same snapshot everything else uses. */
function publishedMemberships(snap) {
  return S.published
    .filter((a) => a.conditions.every((c) => (snap.dims?.[c.dim]?.[c.value] ?? 0) >= c.atLeast))
    .map((a) => a.key);
}

// ── Experimentation ─────────────────────────────────────────────────────────
//
// The rules are real and they are created in the real project while the room
// watches. What we deliberately do NOT show is a reallocation chart or a
// per-context winner: those need traffic, this room will not generate any in
// forty-five minutes, and saying so out loud is stronger than an invented chart.

const FLAVOUR_NAME = { ab: 'A/B', mab: 'Multi-armed bandit', cmab: 'Contextual bandit' };

// ── The director ────────────────────────────────────────────────────────────
// It advances the NARRATIVE and does STAGE MANAGEMENT. It does not perform the
// demo. The whitelist below is the enforcement of that, not a comment about it:
// an `arm` key that is not in ARM_ACTIONS is refused and reported, so a beat can
// never quietly grow the power to click a product on the presenter's behalf.
//
// Audience-safe by default — the room sees the beat and what to watch, never the
// script. ?prompter=1 reveals the SAY line for rehearsal or a confidence monitor.

const DIR = { i: 0, running: false, beatStart: 0, totalStart: 0, elapsedBefore: 0, auto: false, autoTimer: null };

/** The ONLY things the director is allowed to do to the demo. */
const ARM_ACTIONS = {
  reset: async () => { await post('/reset', {}); S.seq = -1; await load(S.vertical); connect(); },
  vertical: async (v) => { if (v !== S.vertical) await setVertical(v); },
  returnVisit: () => { sessionStorage.setItem('mrd_dir', String(DIR.i)); location.reload(); },
};

const mmss = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

async function armBeat(beat) {
  if (!beat.arm) return;
  for (const [key, value] of Object.entries(beat.arm)) {
    const fn = ARM_ACTIONS[key];
    if (!fn) {
      // Loud. A beat asking for a capability the director does not have is a
      // script error, and silently ignoring it means the beat plays wrong.
      consequence('Director', `Refused an unknown stage action: ${key}`,
        'The director may reset, switch vertical, or revisit. It does not perform the demo.');
      continue;
    }
    await fn(value);
  }
}

function renderBeat() {
  const b = BEATS[DIR.i];
  if (!b) return;
  const act = ACTS.find((a) => a.n === b.act);
  $('dir-act').textContent = `Act ${b.act} · ${act ? act.name : ''}`;
  $('dir-count').textContent = `Beat ${b.n} of ${BEATS.length} · ${b.cap}`;
  $('dir-title').textContent = b.title;
  $('dir-mark').hidden = !b.mark;
  if (b.mark) $('dir-mark').textContent = b.mark;
  $('dir-watch').textContent = b.watch;
  $('dir-do').textContent = b.do;
  $('dir-caution').hidden = !b.caution;
  if (b.caution) $('dir-caution').textContent = b.caution;
  const prompter = new URLSearchParams(location.search).has('prompter');
  $('dir-say').hidden = !prompter;
  $('dir-say').textContent = b.say;
  $('dir-planned').textContent = `planned ${mmss(b.secs * 1000)} · ${b.real}`;
  DIR.beatStart = Date.now();
  dirTick();
}

function dirTick() {
  const b = BEATS[DIR.i];
  if (!b) return;
  const beatMs = DIR.running ? Date.now() - DIR.beatStart : 0;
  const el = document.querySelector('.dir-clock');
  $('dir-beat-time').textContent = mmss(beatMs);
  el.classList.toggle('over', beatMs > b.secs * 1000);

  const totalMs = DIR.elapsedBefore + (DIR.running ? Date.now() - DIR.totalStart : 0);
  const budget = ACTS.reduce((n, a) => n + a.mins * 60, 0) * 1000;
  $('dir-total').textContent = `${mmss(totalMs)} of ${mmss(budget)} total`;
}

/**
 * A beat's `perform` list is resolved here and played through the visible
 * visitor. The presenter pressed Next — that is the click; what the room then
 * watches is the visitor doing what the beat says, with the cursor. Nothing
 * fires unless Next was pressed, and nothing here fakes a change: every entry
 * is a real click on a real control.
 */
function resolveTarget(t) {
  if (typeof t === 'string') return document.querySelector(t);
  if (t.wait) return { wait: t.wait };
  if (t.predict) { const inner = resolveTarget(t.predict); return inner ? { predict: true, el: inner } : null; }
  if (t.tab) { showTab(t.tab); return null; }
  if (t.surface != null) return document.querySelectorAll('#surfaces .surface')[t.surface] || null;
  if (t.dept) return dept(t.dept)();
  if (t.card) return cardOf(t.card.cat, t.card.n)();
  if (t.line) return cardOfLine(t.line.name, t.line.n)();
  if (t.sel) return document.querySelector(t.sel);
  return null;
}

async function performBeat(beat) {
  if (!beat.perform?.length || BZ.busy) return;
  const targets = beat.perform.map((t) => () => resolveTarget(t));
  $('dir-next').disabled = true;
  try { await browse($('dir-next'), targets); }
  finally { $('dir-next').disabled = false; }
}

async function goBeat(i) {
  if (BZ.busy) return;                             // a beat is still being performed
  DIR.i = Math.max(0, Math.min(BEATS.length - 1, i));
  sessionStorage.setItem('mrd_dir', String(DIR.i));
  await armBeat(BEATS[DIR.i]);
  renderBeat();
  if (!DIR.running) dirPlay(true);                 // the clock starts on the first Next
  await performBeat(BEATS[DIR.i]);
  if (DIR.auto) scheduleAuto();
}

// Auto: advance on its own, with a gap the presenter can talk in — Coach's
// 6.2s. Pause is simply Auto off; the beat in flight always completes.
function scheduleAuto() {
  clearTimeout(DIR.autoTimer);
  if (DIR.i >= BEATS.length - 1) { setAuto(false); return; }
  DIR.autoTimer = setTimeout(() => { if (DIR.auto) goBeat(DIR.i + 1); }, 6200);
}
function setAuto(on) {
  DIR.auto = on; clearTimeout(DIR.autoTimer);
  $('dir-play').classList.toggle('on', on);
  $('dir-play').textContent = on ? 'Pause' : 'Auto';
  if (on) scheduleAuto();
}

function dirPlay(on) {
  if (on && !DIR.running) { DIR.totalStart = Date.now(); DIR.beatStart = Date.now(); }
  if (!on && DIR.running) { DIR.elapsedBefore += Date.now() - DIR.totalStart; }
  DIR.running = on;
}

function openDirector() {
  document.body.classList.add('has-director');
  $('director').hidden = false;
  // The page stays clear of the bar by the bar's REAL height.
  const fit = () => document.documentElement.style.setProperty('--dir-h', `${$('director').offsetHeight + 8}px`);
  fit(); new ResizeObserver(fit).observe($('director'));
  const saved = Number(sessionStorage.getItem('mrd_dir') ?? 0);
  DIR.i = Number.isFinite(saved) ? saved : 0;
  renderBeat();
}

$('dir-next').onclick = () => goBeat(DIR.i + 1);
$('dir-prev').onclick = () => { setAuto(false); goBeat(DIR.i - 1); };
$('dir-play').onclick = () => setAuto(!DIR.auto);
$('dir-stop').onclick = async () => {
  setAuto(false); dirPlay(false); DIR.elapsedBefore = 0; DIR.i = 0;
  sessionStorage.removeItem('mrd_dir');
  await $('btn-reset').onclick();                  // a new visitor, in the object and on the page
  if (window.MOMENTS) window.MOMENTS.reset();
  renderBeat();
};
addEventListener('keydown', (e) => {
  if ($('director').hidden) { if (e.key === 'd' && e.target === document.body) openDirector(); return; }
  if (e.target instanceof HTMLInputElement) return;
  if (e.key === 'ArrowRight') { e.preventDefault(); goBeat(DIR.i + 1); }
  if (e.key === 'ArrowLeft') { e.preventDefault(); goBeat(DIR.i - 1); }
  if (e.key === ' ') { e.preventDefault(); setAuto(!DIR.auto); }
  if (e.key === 'Escape') { $('director').hidden = true; document.body.classList.remove('has-director'); }
});
setInterval(dirTick, 500);

// ── The reflex moment ───────────────────────────────────────────────────────
// A white-glove offer earned by intent, running to an instant the ENGINE
// computed rather than one a marketer picked. Two consequences the room can
// check: it cannot be extended, and when it lapses it names the number that
// ended it. This is the argument against urgency theatre made mechanically —
// the offer lasts exactly as long as the interest that earned it.

const OFFER = { expiresAt: null, live: false, dim: null, value: null };

function offerTick() {
  if (!OFFER.live) return;
  const el = $('offer');
  const left = OFFER.expiresAt - Date.now();

  if (left > 0) {
    const secs = Math.ceil(left / 1000);
    $('offer-clock').textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
    el.classList.toggle('expiring', secs <= 15);
    return;
  }

  // Ended. Say which number ended it — the whole point of the beat.
  OFFER.live = false;
  const snap = snapshot(S.reflex, Date.now(), S.config);
  const a = snap.dims?.[OFFER.dim]?.[OFFER.value];
  const spec = S.config.dimensions.find((d) => d.key === OFFER.dim);
  el.classList.add('done'); el.classList.remove('expiring');
  $('offer-kick').textContent = 'The offer has ended';
  $('offer-title').textContent = 'It lasted exactly as long as the intent that earned it';
  // Four places, not three: at three the value rounds to 0.450 and the sentence
  // reads "0.450, under its exit threshold of 0.45", which is a contradiction
  // the room can see. Show enough precision for the claim to be true on screen.
  const thetaOut = spec?.thetaOut ?? S.config.thetaOut;
  $('offer-sub').textContent =
    `${OFFER.dim} · ${OFFER.value} fell to ${(a ?? 0).toFixed(4)}, under its exit threshold of `
    + `${thetaOut}. Nothing was on a timer. The clock was the engine's own `
    + 'closed form for when that interest crosses out, so it could never have been extended.';
  consequence('Reflex moment', 'The offer ended, and said why',
    'The countdown was derived from the decay curve, not chosen. No urgency theatre: '
    + 'when the interest went, so did the offer.');
}

/** Earned by a decisive act, not by arriving. Fires once per qualifying entry. */
function checkOffer() {
  if (OFFER.live) return;
  const dim = stageKeyFor(S.vertical);
  const value = decidingValueFor(S.vertical);
  // The exact key core mints, not a lowercase guess with a substring fallback —
  // that would have matched any audience whose name happened to contain the word.
  if (!S.audiences.has(audienceKey(dim, value))) return;

  const at = expiryOf(S.reflex, dim, value, S.config);
  if (!at || at <= Date.now()) return;

  OFFER.expiresAt = at; OFFER.live = true; OFFER.dim = dim; OFFER.value = value;
  const el = $('offer');
  el.hidden = false; el.classList.remove('done', 'expiring');
  $('offer-kick').textContent = 'While you are deciding';
  $('offer-title').textContent = S.vertical === 'retail'
    ? 'A stylist on call, and same-day courier on this order'
    : 'A named adviser on this application, and a decision today';
  $('offer-sub').textContent =
    'Service, not a discount. The clock is not a marketing timer — it runs to the instant '
    + `the engine calculates that "${value}" crosses back under its exit threshold.`;
  offerTick();
  consequence('Reflex moment', 'A white-glove offer arrived', 
    `Earned by a decisive act, and it expires at a computed instant — ${Math.round((at - Date.now()) / 1000)}s `
    + 'from now, derived from the decay curve rather than chosen.');
}

// ── Style concierge ─────────────────────────────────────────────────────────
// A thread, because the point is the SECOND turn: the room needs to see that a
// correction produced different pieces rather than a reshuffle of the same ones.

const CONC = { history: [], shown: [] };

async function conciergeAsk(message) {
  const thread = $('conc-thread');
  const turn = document.createElement('div');
  turn.className = 'conc-turn';
  turn.innerHTML = `<div class="conc-said">You said: <b>${escapeHtml(message)}</b></div>
    <div class="conc-wait">Styling…</div>`;
  thread.appendChild(turn);
  thread.scrollTop = thread.scrollHeight;

  // The engine's live read, so an open-ended ask reflects what she has been doing.
  const snap = snapshot(S.reflex, Date.now(), S.config);
  const affinity = {};
  for (const [dim, vals] of Object.entries(snap.dims)) {
    const top = Object.entries(vals).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([v]) => v);
    if (top.length) affinity[dim] = top;
  }

  const r = await fetch(`${API}/concierge`, {
    method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ vertical: S.vertical, message, history: CONC.history,
                           shown: CONC.shown, affinity }),
  }).then((x) => x.json()).catch(() => null);

  if (!r || !r.ok) {
    turn.querySelector('.conc-wait').outerHTML =
      `<div class="conc-unmet">${escapeHtml(r?.reason ?? 'The concierge could not be reached.')} Nothing is shown rather than guessed.</div>`;
    return;
  }

  CONC.shown = r.shown;
  CONC.history.push({ role: 'visitor', text: message }, { role: 'concierge', text: r.title });

  const card = (id, isAnchor) => {
    const it = byId(id);
    if (!it) return '';
    return `<div class="conc-it${isAnchor ? ' anchor' : ''}" style="--hue:${it.hex}">
      <div class="art">${packshot(it, { withName: false, square: true })}</div>
      ${isAnchor ? '<div class="conc-anchor-tag">the anchor</div>' : ''}
      <div class="nm">${it.name}</div>
      <div class="mt">${it.category} · ${it.subcategory}</div>
    </div>`;
  };

  turn.querySelector('.conc-wait').outerHTML = `<div class="conc-look">
    <h4>${escapeHtml(r.title)}</h4>
    <div class="conc-why">${escapeHtml(r.rationale)}</div>
    ${r.unmet ? `<div class="conc-unmet">${escapeHtml(r.unmet)}</div>` : ''}
    <div class="conc-items">${card(r.anchorId, true)}${r.withIds.map((id) => card(id, false)).join('')}</div>
    <div class="conc-meta">${r.ms}ms · chosen from ${S.items.length} real pieces ·
      ${CONC.shown.length} already used in this conversation and removed from what it can pick next</div>
  </div>`;
  thread.scrollTop = thread.scrollHeight;

  consequence('Style concierge', r.unmet ? 'Said what it does not have' : 'Built a look',
    `${r.title}. Ids are enum-bound to the live catalogue minus everything already shown, so an `
    + 'invented product and a repeat are both unrepresentable — not discouraged, unrepresentable.');
}

const escapeHtml = (t) => String(t).replace(/[&<>"]/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ── Revenue Radar ───────────────────────────────────────────────────────────
// The reveal is a subtraction, not a chart: the same funnel, filtered, against
// the line it was hiding behind. Only the failing step is allowed the alarm
// colour, because if everything is highlighted nothing is.

let RAD = { cohort: [], data: null, baseline: null };

const cohortParam = (c) => c.map((k) => `${k.dim}:${k.value}`).join(',');
const usd = (n) => '$' + Math.round(n).toLocaleString('en-US');
const share = (n) => `${(n * 100).toFixed(1)}%`;

async function radar(cohort) {
  RAD.cohort = cohort;
  const q = new URLSearchParams({ vertical: S.vertical });
  if (cohort.length) q.set('cohort', cohortParam(cohort));
  const d = await fetch(`${API}/funnel?${q}`, { credentials: 'omit' })
    .then((r) => r.json()).catch(() => null);
  if (!d?.ok) { $('rad-funnel').innerHTML = '<div class="rad-math">The funnel service could not be reached.</div>'; return; }
  if (!cohort.length) RAD.baseline = d;
  RAD.data = d;
  renderRadar();
}

function renderRadar() {
  const d = RAD.data; const base = RAD.baseline;
  $('rad-sub').textContent = `${d.cohortLabel} · ${d.sessions.toLocaleString('en-US')} sessions`
    + (d.cohort.length ? ` · ${share(d.shareOfTraffic)} of traffic` : '');

  // Cohort chips. The two the presenter actually uses lead; the rest are there
  // so the room can see we can filter to something we never rehearsed.
  const sug = d.suggested;
  const chips = [{ label: 'Everyone', keys: [] },
                 { label: sug.first.map((k) => k.value).join(' + '), keys: sug.first },
                 { label: sug.drilldown.map((k) => k.value).join(' + '), keys: sug.drilldown }];
  // Drop anything the lead chips already cover, so the same cohort is never
  // offered twice under two different names.
  const covered = new Set(chips.map((c) => cohortParam(c.keys)));
  const extra = d.available.filter((a) => a.dim !== 'region')
    .map((a) => ({ label: a.label, keys: [{ dim: a.dim, value: a.value }] }))
    .filter((c) => !covered.has(cohortParam(c.keys)));
  $('rad-cohorts').innerHTML = chips.map((c, i) =>
      `<button class="rad-c lead${cohortParam(c.keys) === cohortParam(d.cohort) ? ' on' : ''}" data-k='${JSON.stringify(c.keys)}'>${c.label}</button>`).join('')
    + extra.map((c) =>
      `<button class="rad-c${cohortParam(c.keys) === cohortParam(d.cohort) ? ' on' : ''}" data-k='${JSON.stringify(c.keys)}'>${c.label}</button>`).join('');
  $('rad-cohorts').querySelectorAll('.rad-c').forEach((b) => {
    b.onclick = () => radar(JSON.parse(b.dataset.k));
  });

  $('rad-funnel').innerHTML = d.steps.map((st, i) => {
    const bad = d.worst && st.key === d.worst.key;
    const ghost = base && base.steps[i] ? base.steps[i].rate : null;
    return `<div class="rad-step${bad ? ' bad' : ''}">
      <div class="lab"><span>${st.label}</span><b>${share(st.rate)}</b></div>
      <div class="rad-track"><div class="rad-fill" style="width:${(st.rate * 100).toFixed(1)}%"></div></div>
      ${ghost != null && d.cohort.length
        ? `<div class="rad-ghost" style="width:${(ghost * 100).toFixed(1)}%"></div>` : ''}
    </div>`;
  }).join('') + (d.cohort.length
    ? '<div class="rad-math">The thin line under each bar is everyone. Simulated traffic; every rate above computed from those rows on this request.</div>'
    : '<div class="rad-math">All visitors. This is the number that goes in the weekly report.</div>');

  if (!d.worst || !d.recoverable) {
    $('rad-find').innerHTML = d.cohort.length
      ? '<h6>No material gap</h6><div class="rad-remedy">This cohort tracks the average. That is a real answer too — and it is the one an average is usually telling the truth about.</div>'
      : '<h6>The average</h6><div class="rad-remedy">Nothing here looks wrong, which is the problem. Filter to a cohort.</div>';
    return;
  }

  const w = d.worst; const r = d.recoverable;
  $('rad-find').innerHTML = `
    <h6>Where it breaks</h6>
    <div class="rad-gap">${(w.gapPoints * 100).toFixed(1)} points</div>
    <div class="rad-remedy"><b>${w.label}</b> — ${share(w.cohortRate)} for this cohort against ${share(w.baselineRate)} for everyone.</div>
    <h6>Recoverable</h6>
    <div class="rad-money">${usd(r.amountUsd)}</div>
    <div class="rad-math">${r.lostSessions.toLocaleString('en-US')} sessions lost to the gap
      × ${usd(r.aov)} average order
      = ${usd(r.amountUsd)}</div>
    <h6>The remedy</h6>
    <div class="rad-remedy">${r.remedy}</div>
    <button class="rad-launch" id="rad-launch">Launch the fix</button>
    <div class="rad-out" id="rad-out"></div>
    <div class="cold-tags" style="margin-top:14px">
      <span class="tg no">traffic simulated</span>
      <span class="tg ok">compute live</span>
      <span class="tg dv">lift representative</span>
    </div>`;
  $('rad-launch').onclick = (e) => launchFix(e.currentTarget);
}

/**
 * The diagnosis is arithmetic over simulated rows; the audience and the
 * experiment it creates are real objects in a real project. Saying which is
 * which is the entire reason this beat is credible.
 */
async function launchFix(btn) {
  const d = RAD.data;
  btn.disabled = true; btn.textContent = 'creating…';
  const r = await fetch(`${API}/experiment/dispatch`, {
    method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ vertical: S.vertical, source: 'radar', flavour: 'ab', cohort: d.cohort }),
  }).then((x) => x.json()).catch(() => null);
  btn.disabled = false; btn.textContent = 'Launch the fix';

  const out = $('rad-out');
  if (!r) { out.innerHTML = '<span class="refuse">Dispatch never reached the worker. Nothing was created.</span>'; return; }
  if (r.simulated) { out.innerHTML = `<span class="refuse">Nothing written — ${r.reason}</span>`; return; }
  if (!r.ok) { out.innerHTML = `<span class="refuse">Refused — ${r.reason}</span>`; return; }
  // Only claim targeting if an audience actually came back with an id.
  const targeted = r.audience
    ? `Targeted at <b>${r.audience.name}</b> — real Optimizely audience <code>${r.audience.id}</code>, `
      + `${r.audience.created ? 'created just now' : 'already there and reused'}.`
    : '<span class="refuse">No audience was attached — this rule runs on everyone.</span>';
  out.innerHTML = `<b>${r.flagKey}</b> · ${r.variations.join(' vs ')} · ${r.environment} · ${r.ms}ms<br>`
    + `${targeted} ${r.created ? 'Experiment created in Optimizely just now.' : 'Experiment already live — reused, not recreated.'}<br>`
    + '<span style="color:var(--p-dim)">The diagnosis is computed from simulated traffic. The audience and the experiment are real objects in a real project.</span>';
  consequence('Revenue Radar', 'Fix launched as a real experiment',
    `${r.flagKey} targeted at ${d.cohortLabel}. Diagnosis representative, experiment live.`);
}

async function dispatchExperiment(flavour, btn) {
  const label = btn.innerHTML;
  btn.disabled = true; btn.textContent = 'creating…';
  const r = await fetch(`${API}/experiment/dispatch`, {
    method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ vertical: S.vertical, source: 'tiktok', flavour }),
  }).then((x) => x.json()).catch(() => null);
  btn.disabled = false; btn.innerHTML = label;

  if (!r) return consequence('Experiment', 'Dispatch never reached the worker', 'Nothing was created.');
  if (r.simulated) {
    // Never dress a no-op as a success.
    return consequence('Experiment — nothing written', r.reason,
      `Would have created ${r.flagKey} with ${r.variations?.join(' vs ')}.`);
  }
  if (!r.ok) {
    return consequence('Experiment refused', r.reason,
      'Not downgraded to a rollout. A rollout is not a test, and claiming otherwise would be worse than failing.');
  }
  consequence(FLAVOUR_NAME[flavour],
    r.created ? 'Created in Optimizely just now' : 'Already live — reused, not recreated',
    `${r.flagKey} · ${r.variations.join(' vs ')} · ${r.environment} · ${r.ms}ms. ` +
    (flavour === 'ab' ? 'Real rule, real project.'
      : 'The rule is real. The winner is not shown — that needs traffic.'));
  const card = $('conseq').firstChild;
  if (card && r.consoleUrl) {
    const a = document.createElement('a');
    a.href = r.consoleUrl; a.target = '_blank'; a.className = 'cq-link';
    a.textContent = 'Open in Optimizely →';
    card.appendChild(a);
  }
  $('sentence').textContent = flavour === 'ab'
    ? `A/B rule live in the real project. Open Optimizely and it is there.`
    : `${FLAVOUR_NAME[flavour]} rule live in the real project. We are not going to fabricate the winner — that needs traffic.`;
  S.sayLockUntil = Date.now() + 6000;
}
$('btn-ab').onclick = (e) => dispatchExperiment('ab', e.currentTarget);
$('btn-mab').onclick = (e) => dispatchExperiment('mab', e.currentTarget);
$('btn-cmab').onclick = (e) => dispatchExperiment('cmab', e.currentTarget);

// ── Controls ────────────────────────────────────────────────────────────────
async function setVertical(v) {
  if (v === S.vertical) return;
  $('btn-retail').classList.toggle('on', v === 'retail');
  $('btn-financial').classList.toggle('on', v === 'financial');
  await post('/vertical', { vertical: v });
  await load(v); connect();
  $('sentence').textContent = 'Same engine. Same seven dimensions. Different vocabulary.';
}
$('btn-retail').onclick = () => setVertical('retail');
$('btn-financial').onclick = () => setVertical('financial');
$('btn-return').onclick = () => location.reload();   // same id, same object, same profile
$('btn-reset').onclick = async () => {
  await post('/reset', {}); S.seq = -1;
  await load(S.vertical); connect();
  clearBaseline(); $('btn-capture').classList.remove('on'); DONE.length = 0;
  $('btn-capture').innerHTML = 'Capture baseline<small>freeze the page now</small>';
  $('takeover').hidden = true; $('hero').style.display = '';
};

if (new URLSearchParams(location.search).has('debug')) window.__S = S;
paintPinButton();
// One click to start, and it survives the reload that beat 22 performs.
// The director is on by default: it holds the transport AND the palette now.
if (!new URLSearchParams(location.search).has('nodirector')) queueMicrotask(openDirector);  // rehearsal introspection only
await load('retail');
connect();

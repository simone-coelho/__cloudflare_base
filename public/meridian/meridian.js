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
import { initMoments } from '/meridian/moments.js';
import {
  compose, composeLayout, SHAPE_OF_KEY, SHAPE_ORDER, SLOT_STRATEGIES, configFor, packshot,
  apply, tick, snapshot, emptyState, extractTouches,
  stageTouchFor, decidingValueFor, stageKeyFor, expiryOf, audienceKey,
  leadValue, leadSentence, LEAD_BY,
} from '/meridian/engine.bundle.js';

const API = '/meridian/api';
const $ = (id) => document.getElementById(id);

/**
 * THE STEP COLOUR. Every step that highlights something — the hero changing,
 * cards moving, "show what changed" — advances one colour, so two consecutive
 * changes never wear the same one and the room can see that things moved
 * AGAIN. Four colours, deliberately: enough to differ, few enough to read.
 */
const HL_PALETTE = [
  { name: 'red',    hl: '#D6472F', ink: '#FFFFFF' },
  { name: 'green',  hl: '#14C46A', ink: '#0B2E1B' },
  { name: 'yellow', hl: '#F2C400', ink: '#2A2200' },
  { name: 'blue',   hl: '#1E6FFF', ink: '#FFFFFF' },
];
const HL = { i: -1, cur: HL_PALETTE[1] };
function nextHighlight() {
  HL.i = (HL.i + 1) % HL_PALETTE.length;
  HL.cur = HL_PALETTE[HL.i];
  return HL.cur;
}
function applyHighlight(el, c = HL.cur) {
  el.style.setProperty('--hl', c.hl);
  el.style.setProperty('--hl-ink', c.ink);
  el.dataset.hl = c.name;
}

/** The shelf she is looking at: the department she clicked, or the whole store. */
const rowPool = () => (S.dept ? S.items.filter((i) => i.category === S.dept) : S.items);

/** ONE OVERLAY AT A TIME. Opening any modal closes whatever is open — no stacking, one scrim. */
function openMoment(id) {
  document.querySelectorAll('.moment.open').forEach((m) => { if (m.id !== id) m.classList.remove('open'); });
  $(id).classList.add('open');
}

// ── THE 15 — Coach's RFP checklist, ticked only when the room has seen it ──
const CAPS = [
  ['Customer profile (no sign-in)', 'identity minted at the edge; no login, no cookie wall'],
  ['Cold-start data', 'your receipts + free census open the page before any behaviour'],
  ['Real-time updates', 'the page reacts inside the click, not on the next visit'],
  ['Recommendations', 'her picks, first line — one-to-one, not one-to-many'],
  ['Sort rules (baseline)', 'the standard order every shopper sees — the control'],
  ['Personalized sort', 'the same shelf re-ranks; her favourites rise'],
  ['Personalized page structure', 'sections re-order; Complete the look assembles'],
  ['Personalized page content', 'the same slot, her content — hero and story'],
  ['Journey-stage detection', 'add to bag → deciding; the offer and the hold answer it'],
  ['Opal audience creation', 'an audience proposed from plain English, over the live vocabulary'],
  ['A/B testing', 'a real a/b rule in the real project'],
  ['Multi-armed bandit (MAB)', 'a real multi_armed_bandit rule; allocation representative'],
  ['Contextual bandit (CMAB)', 'a real contextual_multi_armed_bandit rule; a winner per context'],
  ['AI search', 'intent read by the model; real pieces, ranked to her'],
  ['AI chat — Style Concierge', 'a look, with advice; every pick a real SKU'],
];
const CAPS_DONE = new Set();
function renderCaps() {
  const el = $('caps'); if (!el) return;
  el.innerHTML = CAPS.map(([name, sub], i) => `<li class="${CAPS_DONE.has(i + 1) ? 'done' : ''}"><span class="tick">✓</span><span>${i + 1} · ${name}<small>${sub}</small></span></li>`).join('');
  const n = CAPS_DONE.size;
  $('caps-count').textContent = `${n} of 15`;
  const badge = $('caps-n'); badge.textContent = String(n); badge.className = 'tabn' + (n >= 15 ? ' all' : n ? ' some' : '');
}
function capDone(n) {
  if (CAPS_DONE.has(n)) return;
  CAPS_DONE.add(n); renderCaps(); markTab('caps');
  if (CAPS_DONE.size === 15) consequence('The 15', '15 of 15 — all seen in this session', 'Every capability on the checklist has been shown live, in the room, in this session.');
}
function resetCaps() { CAPS_DONE.clear(); renderCaps(); }

/** Engine time. Everything the reflex engine sees goes through this. */
const NOW = () => S.clock;
/** An act happened: carry forward a LITTLE real time (never a conversation). */
function advanceClock() {
  const real = Date.now();
  S.clock += Math.min(Math.max(0, real - S.lastReal), 10_000);
  S.lastReal = real;
}

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
  // THE DEMO CLOCK. Engine time advances ONLY when the presenter acts — each
  // act carries forward at most 10s of real time, and "Let two minutes pass"
  // adds exactly what it says, with a preview and a consent press. Between
  // acts the page is genuinely frozen: no decay, no retreats, no fading
  // greens, no offers retiring mid-sentence. The room can talk for ten
  // minutes and nothing moves uninvited.
  clock: Date.now(), lastReal: Date.now(),
  seq: -1, ws: null, heroOverride: null, usedSurfaces: new Set(), sinceArrival: 0, sayLockUntil: 0, dept: null,
  claimedAt: {},
  withdrawn: new Set(),
};

const money = (n) => (n == null || Number.isNaN(Number(n)) ? '—' : '$' + Number(n).toLocaleString('en-US'));
const byId = (id) => S.items.find((i) => i.id === id) || S.blocks.find((b) => b.id === id);
const pick = (ds, slot) => ds.find((d) => d.slot === slot);

// ── Boot ────────────────────────────────────────────────────────────────────
async function load(vertical) {
  const r = await fetch(`${API}/catalog?vertical=${vertical}`, { credentials: 'omit' }).then((x) => x.json());
  Object.assign(S, {
    vertical, items: r.items, blocks: r.blocks, registry: r.registry,
    config: configFor(vertical), reflex: emptyState(configFor(vertical)),
    audiences: new Set(), decisions: [], prevRank: new Map(),
    heroOverride: null, usedSurfaces: new Set(), sinceArrival: 0, withdrawn: new Set(), dept: null,
    behaved: false, anchorId: null, claimedAt: {}, audiencePriority: [], priorityEngaged: false,
    arrived: false, cohort: null, coldPrior: null, coldPicks: null,
  });
  S.published = [];
  document.documentElement.dataset.vertical = vertical;
  $('biz').textContent = vertical === 'retail' ? '& Co.' : 'Financial';
  // THE NAV IS A CONTROL, NOT DECORATION. It had no handler at all, so the one
  // natural way to browse away from a campaign — click a different department —
  // did nothing. That is the hinge beat of the whole session.
  const cats = [...new Set(r.items.map((i) => i.category))];
  $('nav').innerHTML = cats
    .map((c) => `<button class="navc" data-cat="${c}">${c}</button>`).join('');
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
  capDone(1); capDone(5);

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

  // THE NEIGHBOURHOOD COHORT — what shoppers like her, from here, actually
  // bought (your receipts) enriched with the census. Fetched now, applied when
  // she ARRIVES (a gated act: the band declares it, OK opens the page on it).
  const cq = new URLSearchParams({ vertical: S.vertical });
  for (const k of ['region', 'zip', 'city', 'country']) { const v = new URLSearchParams(location.search).get(k); if (v) cq.set(k, v); }
  S.cohort = await fetch(`${API}/cohort?${cq}`, { credentials: 'omit' }).then((r) => r.json()).catch(() => null);
  if (!S.cohort?.ok) S.cohort = null;
  S.coldPrior = seed && cs.prior ? cs.prior : null;
  renderCohortTab(cs);
}

const BAND_PHRASE = { entry: 'everyday essentials', core: 'signature styles', premium: 'our most considered pieces', elevated: 'our most considered pieces' };
const cohortUsable = (c) => !!(c && c.topLines && c.topLines.length && (c.granularityUsed !== 'national' || c.synthesized));
const narrowKey = () => S.registry.dimensions.find((d) => d.shape === 'narrow')?.key || 'line';
const broadKey = () => S.registry.dimensions.find((d) => d.shape === 'broad')?.key || 'category';

/** The priors an arrival applies: the census band, then the cohort's lead lines and family. */
function coldTouches() {
  const t = [];
  const c = S.cohort;
  // The band: your receipts when they clear the gate (purchase intent), the
  // census-derived band otherwise (affluence, the enrichment). Curation only.
  const bandFromReceipts = cohortUsable(c) && !c.synthesized && c.modalBand;
  if (S.coldPrior) t.push({ dim: S.coldPrior.dim, value: bandFromReceipts || S.coldPrior.value });
  if (cohortUsable(c)) {
    for (const l of c.topLines.slice(0, 2)) t.push({ dim: narrowKey(), value: l.line });
    if (c.topFamilies?.[0]?.category) t.push({ dim: broadKey(), value: c.topFamilies[0].category });
  }
  return t;
}
/** What shoppers near her carry: the lead colourway of each leading line, in cohort order, five at most. */
function coldPicksFor(c) {
  // Two pieces per leading line (distinct families first, then colourways), so
  // the lead line still shows on the shelf after the hero takes its first piece.
  const picks = [];
  for (const l of c.topLines) {
    const inLine = S.items.filter((i) => i.line === l.line);
    const seen = new Set(); const chosen = [];
    for (const it of inLine) { const fam = it.family || it.id; if (!seen.has(fam)) { seen.add(fam); chosen.push(it.id); } if (chosen.length >= 2) break; }
    for (const it of inLine) { if (chosen.length >= 2) break; if (!chosen.includes(it.id)) chosen.push(it.id); }
    picks.push(...chosen);
    if (picks.length >= 6) break;
  }
  return picks.slice(0, 6);
}
function cohortHero(c) {
  const top = c.topLines[0].line, second = c.topLines[1]?.line;
  const lead = S.items.find((i) => i.line === top);
  return {
    from: 'cohort', item: lead?.id,
    kicker: `What shoppers near you reach for · ${c.grainLabel}${c.sampleSize ? ` · N=${c.sampleSize}` : ''}`,
    title: `The ${top} leads near you`,
    body: `No history yet — so we open on what shoppers like her, from here, reach for: the ${top}${second ? ` and the ${second}` : ''}, in ${BAND_PHRASE[c.modalBand] || 'signature styles'}. Aggregate, never the individual — we curate, never price.`,
  };
}
const place = (c) => [c?.geo?.city, c?.geo?.region].filter(Boolean).join(', ') || c?.grainLabel || 'her location';

/**
 * SHE ARRIVES. The first thing the room sees: no profile, no segment, nobody
 * else's data — and the page opens on what shoppers from her neighbourhood
 * actually bought, in your own receipts, enriched with free public census.
 * Gated like every other act: declared first, then done on OK.
 */
function arrive() {
  if (S.arrived) return;
  if (PD.open && !GATE.open) return;
  if (needsGate()) { gateThen([{ kind: 'arrive' }], () => arrive()); return; }
  S.arrived = true; capDone(2);
  advanceClock();
  const touches = coldTouches();
  if (touches.length) {
    const res = apply(S.reflex, { action: 'prior', touches }, NOW(), S.config);
    S.reflex = res.state; absorb(res.changes);
    post('/action', { vertical: S.vertical, events: [{ action: 'prior', touches }] });
  }
  const c = S.cohort;
  if (cohortUsable(c)) {
    S.coldPicks = coldPicksFor(c);
    S.heroOverride = cohortHero(c); S.heroDirty = true;
    const top = c.topLines[0].line;
    strip('cold', `<b>Welcome from ${escapeHtml(c.geo?.city || c.grainLabel)}.</b> Shoppers near you tend to reach for the <b>${escapeHtml(top)}</b> — we've opened on that, from <b>${escapeHtml(c.grainLabel)}</b> first-party data. No account, no cookie needed.`, 30000);
    consequence('Cold start · geo-cohort',
      c.synthesized ? 'Opened on what shoppers near you reach for' : `Opened on what ${c.grainLabel} shoppers buy`,
      `First touch · ${place(c)} (${c.honesty?.geo === 'query-override' ? 'forced location · rehearsal' : 'real edge geo'}) · cohort = ${c.grainLabel} · ${c.synthesized ? 'representative cohort' : `${c.sampleSize} shoppers`} · median HH income ${money(c.census?.medianHhIncome)} (${c.census?.source || 'Census'}). `
      + `No history yet → open on what they buy: ${c.topLines.slice(0, 3).map((l) => `${l.line} ${Math.round(l.share * 100)}%`).join(', ')}. Shoppers like her, from here — aggregate, never the individual. We curate, never price; her first engagement hands off to the live profile.`
      + (c.synthesized ? ` Representative cohort shown for her real location — in production this is your ${c.grainLabel} customers' own purchase history.` : ''));
    $('sentence').textContent = `Nothing has happened yet — and the page opened on what ${c.grainLabel} shoppers actually buy: your receipts, plus public census. Nobody knows her.`;
  } else if (S.coldPrior) {
    consequence('Cold start', S.coldPrior.why, 'No behaviour yet — geography and public data only. No first-party cohort clears the gate for this location.');
    $('sentence').textContent = `Nothing has happened yet — and the page is already weighted. ${S.coldPrior.value} band, from the census.`;
  }
  recordDone('Arrived', `${place(c)} — cold start`, touches.map((t) => `${t.dim}=${t.value}`).join(' · '));
  recompose();
  S.sayLockUntil = Date.now() + 8000;
}

/** Her FIRST engagement hands the page from the cohort to her. The priors stay and decay like everything else. */
function handoffFromCohort() {
  if (S.heroOverride?.from !== 'cohort' && !S.coldPicks) return;
  if (S.heroOverride?.from === 'cohort') { S.heroOverride = null; S.heroDirty = true; }
  S.coldPicks = null;
  consequence('Handoff', 'The cohort gave way to her first act',
    'Shoppers like her opened the page; now she is the evidence. The neighbourhood priors stay in the profile and decay on the same clock as everything else.');
}

/** The cold-start tab: the census, the receipts, the ladder, the honesty. */
function renderCohortTab(cs) {
  const c = S.cohort; const cen = cs?.census;
  const tag = (cls, t) => `<span class="tg ${cls}">${t}</span>`;
  const rows = [];
  rows.push(`<div class="cold-row"><span>Resolved at the edge</span><b>${escapeHtml([cs?.geo?.city, cs?.geo?.region, cs?.geo?.country].filter(Boolean).join(', ') || 'unknown')}${cs?.overridden ? ' (override)' : ''}</b></div>`);
  if (cen) {
    rows.push(`<div class="cold-row"><span>${escapeHtml(cen.label || '')}</span><b>${escapeHtml(cen.source || '')}</b></div>`);
    rows.push(`<div class="cold-row"><span>Median household income</span><b>${money(cen.medianHhIncomeUsd)}</b></div>`);
    rows.push(`<div class="cold-row"><span>Median home value</span><b>${money(cen.medianHomeValueUsd)}</b></div>`);
  }
  if (cs?.prior) rows.push(`<div class="cold-why"><b>${escapeHtml(cs.prior.dim)} → ${escapeHtml(cs.prior.value)}</b><br>${escapeHtml(cs.prior.why)}</div>`);
  if (cohortUsable(c)) {
    rows.push(`<h6 class="cold-h">Your receipts · ${escapeHtml(c.grainLabel)} ${c.synthesized ? '· representative cohort' : `· N=${c.sampleSize} shoppers`}</h6>`);
    for (const l of c.topLines.slice(0, 4)) rows.push(`<div class="cold-row"><span>${escapeHtml(l.line)}</span><b>${Math.round(l.share * 100)}% of shoppers here</b></div>`);
    rows.push(`<div class="cold-row"><span>Modal price band</span><b>${escapeHtml(c.modalBand)} · curation only</b></div>`);
    if (c.attachRate != null) rows.push(`<div class="cold-row"><span>Attach a second piece</span><b>${Math.round(c.attachRate * 100)}% of orders</b></div>`);
    rows.push(`<div class="cold-row"><span>Grain used</span><b>${escapeHtml(c.granularityUsed)} → shown at ${escapeHtml(c.presentLevel || c.granularityUsed)}</b></div>`);
    if (c.synthesized) rows.push(`<div class="cold-why">Representative cohort for her real location — in production this is your ${escapeHtml(c.grainLabel)} customers' own purchase history (source swap: <code>MRD_GEO_COHORT_SOURCE=warehouse</code>).</div>`);
  } else {
    rows.push(`<div class="cold-why">No first-party cohort clears the gate for this location yet — the census band alone opens the page.</div>`);
  }
  rows.push(`<div class="cold-tags">${tag('ok', 'geo real')}${tag('ok', 'census real · public')}${tag('dv', cohortUsable(c) ? (c.dataSource === 'warehouse' ? 'first-party · your warehouse' : 'first-party · representative') : 'prior derived')}<span class="tg no" id="cold-behaviour">behaviour none</span></div>`);
  rows.push(`<button class="cold-btn" id="btn-dyvs-tab">Dynamic Yield vs us — the neighbourhood's wallet vs your receipts</button>`);
  $('cold').innerHTML = rows.join('');
  $('btn-dyvs-tab').onclick = openDy;
}

/** The contrast: DY rents the neighbourhood's AVERAGE wallet; we use your own receipts. */
function openDy() {
  const c = S.cohort; const cen = c?.census;
  document.querySelectorAll('.moment.open').forEach((m) => m.classList.remove('open'));
  $('dy-left').innerHTML = `
    <div class="dy-h">Dynamic Yield<span>third-party proxy · neighbourhood AVERAGE · no purchase intent</span></div>
    <div class="dy-pin">📍 ${escapeHtml(place(c))}${c?.geo?.zip ? ` · ZIP ${escapeHtml(c.geo.zip)}` : ''}</div>
    <div class="dy-quote">"This neighbourhood averages ${money(cen?.medianHhIncome)} household income${cen?.medianHomeValue ? ` · ${money(cen.medianHomeValue)} homes` : ''}."</div>
    <ul><li>Third-party proxy — a postal-code average</li><li>Affluence guess, not purchase intent</li><li>Historical — yesterday's cohort</li><li>No idea what this shopper actually buys</li></ul>
    <div class="dy-foot">Guesses the neighbourhood's wallet · ${escapeHtml(cen?.source || 'Census ACS 2024')}, free &amp; public</div>`;
  const lines = cohortUsable(c) ? c.topLines.slice(0, 3).map((l) => `<li>Carry the ${escapeHtml(l.line)} · ${Math.round(l.share * 100)}% of shoppers here</li>`).join('') : '<li>No cohort clears the gate here yet</li>';
  $('dy-right').innerHTML = `
    <div class="dy-h">Optimizely<span>real intent · your own receipts · ${escapeHtml(c?.grainLabel || '—')}${c?.sampleSize ? ` · N=${c.sampleSize}` : ' · representative'}</span></div>
    <div class="dy-pin">👤 Shoppers like her, from here · first-party</div>
    <ul>${lines}${cohortUsable(c) ? `<li>Modal price band: ${escapeHtml(c.modalBand)} (curation only)</li>` : ''}${c?.attachRate != null ? `<li>Attach a companion ${Math.round(c.attachRate * 100)}% of the time</li>` : ''}</ul>
    <div class="dy-foot">Curates the storefront, never the price — aggregate, never the individual</div>`;
  openMoment('dyvs');
}
$('dyvs-close').onclick = () => $('dyvs').classList.remove('open');
$('btn-dyvs').onclick = openDy;
$('bz-arrive').onclick = (e) => browse(e.currentTarget, [{ arrive: true }]);

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
    <article class="surface" data-id="${s.id}" data-kind="${s.kind}">
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
  if (PD.open && !GATE.open) return;               // a band is open: read it, press OK — nothing sneaks past it
  if (needsGate()) { gateThen([{ kind: 'surface', s }], () => fireSurface(s)); return; }
  handoffFromCohort();
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
  capDone(8);
  recordDone(act === 'declared' ? 'Told us' : 'Arrived from', `${KIND_LABEL[s.kind]} — ${s.subject}`, '');
  advanceClock();
  const res = apply(S.reflex, { action: act, touches: s.touches }, NOW(), S.config);
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
  if (PD.open && !GATE.open) return;
  if (needsGate()) { gateThen([{ kind: 'nav', category }], () => navTo(category)); return; }
  handoffFromCohort();
  advanceClock();
  // A department click SHOWS the department. The shelf becomes that category —
  // her picks first, then its standard order — so "wanders to bags" has bags
  // to wander to. Recording the touch without changing the shelf left the
  // cursor clicking whatever the last campaign had put at slots 1 and 2.
  S.dept = category;
  const before = snapshot(S.reflex, NOW(), S.config);
  const audBefore = new Set(S.audiences);
  const touches = [{ dim: S.vertical === 'retail' ? 'category' : 'productFamily', value: category }];
  const stage = stageTouchFor('nav_click', S.vertical);
  const res = apply(S.reflex, { action: 'nav_click', touches: stage ? [...touches, stage] : touches },
                    NOW(), S.config);
  S.reflex = res.state; absorb(res.changes);
  S.behaved = true; S.sinceArrival += 1;
  TALLY.events += 1; TALLY.departments.add(category);
  const prevDecisions = S.decisions;
  recompose();
  post('/action', { vertical: S.vertical, events: [{ action: 'nav_click', touches }] });
  { const mv = biggestMove(before, snapshot(S.reflex, NOW(), S.config));
    recordDone('Browsed', category, mv ? `${mv.dim} ${mv.from.toFixed(2)} → ${mv.to.toFixed(2)}` : ''); }
  evidenceCard({
    verb: 'Browsed', subject: category, meta: 'department',
    before, after: snapshot(S.reflex, NOW(), S.config),
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
  if ((action === 'row_click' || action === 'intent_start') && record && PD.open && !GATE.open) return;
  if ((action === 'row_click' || action === 'intent_start') && record && needsGate()) {
    gateThen([{ kind: 'item', item: record, action }], () => signal(action, record)); return;
  }
  if (action === 'row_click' || action === 'intent_start') handoffFromCohort();
  advanceClock();
  S.sinceArrival += 1;
  const before = snapshot(S.reflex, NOW(), S.config);
  const prevDecisions = S.decisions;
  const audBefore = new Set(S.audiences);

  const stage = stageTouchFor(action, S.vertical);
  if (record) {
    const touches = extractTouches(record, S.config);
    const res = apply(S.reflex, { action, touches: stage ? [...touches, stage] : touches },
                      NOW(), S.config);
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
  if (action === 'intent_start' && record && window.MOMENTS) window.MOMENTS.addToBag(record);
  if (action === 'intent_start') capDone(9);
  recompose(); capDone(3);

  if (record) {
    const mv = biggestMove(before, snapshot(S.reflex, NOW(), S.config));
    recordDone(VERB_LABEL[action] || action, record.name || record.title || record.id,
      mv ? `${mv.dim} ${mv.from.toFixed(2)} → ${mv.to.toFixed(2)}` : '');
    evidenceCard({
      verb: VERB_LABEL[action] || action,
      subject: record.name || record.title || record.id,
      meta: [record.category, record.subcategory, record.value_usd != null ? money(record.value_usd) : null]
        .filter(Boolean).join(' · '),
      before, after: snapshot(S.reflex, NOW(), S.config),
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
  // CLIENT-AUTHORITATIVE under the demo clock. The object runs on wall time,
  // so its frames carry decay the presenter never consented to — adopting them
  // re-introduced exactly the "changing shit while I talk" this clock removes.
  // The wire stays real (actions, receipts, the returning-visitor snapshot);
  // what the room WATCHES is composed here, on presenter time.
  return;
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

// ── Audience priority — the merchandiser's order ────────────────────────────
// Two audiences match; the one the merchandiser ranks higher wins the hero.
// S.audiencePriority is the ordered list compose() receives; reordering it
// re-decides the slot on the spot, and the hero's receipt says which audience
// won and which it beat. (The composer ignores the option until the promotion
// build lands; the control is wired to the agreed contract.)
function renderPriority() {
  const el = $('prio-list'); if (!el) return;
  const entered = [...S.audiences].filter((a) => !isStageAudience(a));
  // Keep the merchandiser's order; append newly entered audiences at the bottom.
  S.audiencePriority = [...(S.audiencePriority || []).filter((a) => entered.includes(a)),
                        ...entered.filter((a) => !(S.audiencePriority || []).includes(a))];
  if (!S.audiencePriority.length) { el.innerHTML = '<div class="prio-none">No audiences yet — priority applies once she is in two.</div>'; return; }
  const won = S.priorityEngaged ? pick(S.decisions, 'hero')?.explain?.wonBy : null;
  el.innerHTML = S.audiencePriority.map((a, i) => `
    <div class="prio-row${won?.audience === a ? ' winner' : ''}" data-a="${a}">
      <div class="n">${i + 1}</div>
      <div class="a">${prettyAudience(a)}</div>
      ${won ? (won.audience === a ? '<span class="tag">won the hero</span>'
             : (won.over?.includes(a) ? '<span class="tag lost">matched · outranked</span>' : '<span></span>')) : '<span></span>'}
      <span>
        <button data-up="${i}" ${i === 0 ? 'disabled' : ''} title="Raise priority">↑</button>
        <button data-dn="${i}" ${i === S.audiencePriority.length - 1 ? 'disabled' : ''} title="Lower priority">↓</button>
      </span>
    </div>`).join('');
  el.querySelectorAll('button[data-up]').forEach((b) => { b.onclick = () => movePriority(+b.dataset.up, -1); });
  el.querySelectorAll('button[data-dn]').forEach((b) => { b.onclick = () => movePriority(+b.dataset.dn, +1); });
  // Named state, releasable: engaged = the order binds the hero; released = the
  // weights decide again (which is what the tuning dial turns).
  const foot = document.createElement('div');
  foot.className = 'prio-none';
  foot.innerHTML = S.priorityEngaged
    ? 'Priority <b>enforced</b> — the order above decides the hero. <a href="#" id="prio-release">Release</a> to let the weights decide.'
    : 'Not enforced — the weights decide. Reorder with the arrows to enforce this order.';
  el.appendChild(foot);
  const rel = foot.querySelector('#prio-release');
  if (rel) rel.onclick = (e) => {
    e.preventDefault();
    S.priorityEngaged = false; S.heroOverride = null; S.heroDirty = true;
    recompose(); renderPriority();
    consequence('Priority', 'Released', 'The weights decide the hero again — which is what the tuning dial turns.');
  };
}

function movePriority(i, dir) {
  const p = S.audiencePriority; const j = i + dir;
  if (j < 0 || j >= p.length) return;
  [p[i], p[j]] = [p[j], p[i]];
  S.priorityEngaged = true;        // the reorder IS the merchandiser stepping in
  S.heroOverride = null; S.heroDirty = true;      // the merchandiser outranks the campaign copy
  recompose();
  const won = pick(S.decisions, 'hero')?.explain?.wonBy;
  if (won) {
    $('sentence').textContent = `Hero won by #${won.priority} ${prettyAudience(won.audience)}`
      + (won.over?.length ? ` — over ${won.over.map(prettyAudience).join(', ')} (matched, outranked).` : '.');
    S.sayLockUntil = Date.now() + 6000;
    consequence('Priority', `${prettyAudience(won.audience)} now wins the hero`,
      'The merchandiser reordered the audiences; the slot re-decided on the spot. Rules over model, on the record.');
  } else {
    consequence('Priority', 'Order changed', 'The winner will show here once the promotion build lands — the control is wired to the agreed contract.');
  }
  renderPriority();
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
  const before = snapshot(copy, NOW(), S.config);
  const res = apply(copy, { action, touches }, NOW(), S.config);
  const after = snapshot(res.state, NOW(), S.config);

  const nextDecisions = compose({ affinity: after, state: res.state, items: S.items, rowItems: rowPool(), coldPicks: S.coldPicks || undefined, blocks: S.blocks,
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

const VERB_PAST = { row_click: 'Clicked', nav_click: 'Browsed', intent_start: 'Adds to bag', arrival: 'Arrived from', declared: 'Told us', search: 'Searched', prior: 'Prior (geo + census + receipts)' };

/** Show the band for the act about to happen; resolves when the presenter closes it. */
function predictThenProve(action, record, touchesOverride, label) {
  $('pd-mode').textContent = 'watching for her next act';
  $('pd-note').textContent = 'Computed on a copy of her real profile — the same engine, the same numbers. Nothing here is a guess.';
  $('pd-go').textContent = 'Close — let her do it';
  const f = forecast(action, record, touchesOverride);
  const pct = (n) => n.toFixed(3);
  $('pd-done').innerHTML = DONE.length
    ? DONE.map((d) => `<li><b>${d.verb}</b> ${escapeHtml(d.subject)}${d.move ? `<div><span class="pd-v">${escapeHtml(d.move)}</span></div>` : ''}</li>`).join('')
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
  return openBandRaw();
}

// ── THE GATE: NOTHING CHANGES UNTIL IT HAS BEEN DECLARED ─────────────────────
// Every act that would change the page — a surface firing, a department, a
// product click, add-to-bag, time passing — is forecast on a COPY of her
// profile and shown first: what she does, the weights, the scores against
// their thresholds, and what the page will do. OK lets her do it. This is the
// same band that used to guard two or three targets; now it is the rule, for
// scripted sequences and for the presenter's own hand alike.
const GATE = { open: false };
const needsGate = () => !GATE.open;

/** A perform spec → the act it will cause (null for pure UI: tabs, waits, pins). */
function actOf(t) {
  if (!t) return null;
  if (typeof t === 'string') return t === '#hero-cta' ? { kind: 'cta' } : t === '#btn-skip' ? { kind: 'skip' } : null;
  if (typeof t === 'function') return null;
  if (t.predict) return actOf(t.predict);
  if (t.arrive) return { kind: 'arrive' };
  if (t.surface != null) { const sf = SURFACES[S.vertical][t.surface]; return sf ? { kind: 'surface', s: sf } : null; }
  if (t.dept) return { kind: 'nav', category: t.dept };
  if (t.card) return { kind: 'card', cat: t.card.cat, n: t.card.n };
  if (t.line) return { kind: 'card', line: t.line.name, n: t.line.n };
  if (t.sel === '#hero-cta') return { kind: 'cta' };
  if (t.sel === '#btn-skip') return { kind: 'skip' };
  return null;
}

/** Simulate a whole sequence of acts on a copy; return what she does, the weights, the moves, and what the page will do. */
function forecastSequence(acts) {
  const cfg = S.config;
  let reflex = JSON.parse(JSON.stringify(S.reflex));
  let clock = NOW();
  let dept = S.dept, override = S.heroOverride, anchor = S.anchorId;
  const used = new Set(S.usedSurfaces);
  const before = snapshot(reflex, clock, cfg);
  const entered = [], exited = [], did = [], weights = [];
  const poolOf = () => (dept ? S.items.filter((i) => i.category === dept) : S.items);
  const arriving = acts.some((a) => a.kind === 'arrive');
  const handsOff = acts.some((a) => a.kind !== 'arrive' && a.kind !== 'skip');
  const simPicks = handsOff ? undefined : (arriving && cohortUsable(S.cohort) ? coldPicksFor(S.cohort) : (S.coldPicks || undefined));
  if (arriving && cohortUsable(S.cohort)) override = cohortHero(S.cohort);
  else if (handsOff && override?.from === 'cohort') override = null;
  const composeSim = (snap) => compose({ affinity: snap, state: reflex, items: S.items, rowItems: poolOf(), coldPicks: simPicks, blocks: S.blocks,
    config: cfg, shapeOfKey: SHAPE_OF_KEY, rowSize: 10, pins: S.pins,
    audiencePriority: S.priorityEngaged ? S.audiencePriority : undefined,
    anchorId: anchor, decidingValue: decidingValueFor(S.vertical) });
  const step = (action, touches) => {
    const stage = stageTouchFor(action, S.vertical);
    const res = apply(reflex, { action, touches: stage ? [...touches, stage] : touches }, clock, cfg);
    reflex = res.state; entered.push(...res.changes.entered); exited.push(...res.changes.exited);
    weights.push({ action, w: cfg.weights?.[action] ?? 1 });
  };
  for (const a of acts) {
    clock += 2000;
    if (a.kind === 'arrive') {
      const c = S.cohort;
      did.push(`Arrives from ${place(c)} — nothing known but where she is (${c?.honesty?.geo === 'query-override' ? 'forced location' : 'real edge geo'})`);
      if (c?.census) did.push(`${c.census.source || 'Census ACS'}: median household income ${money(c.census.medianHhIncome)}${c.census.medianHomeValue ? ` · median home ${money(c.census.medianHomeValue)}` : ''} (public, free)${cohortUsable(c) && !c.synthesized ? '' : ` → ${S.coldPrior ? `${S.coldPrior.value} band` : 'a price band'}`}`);
      if (cohortUsable(c)) did.push(`Your receipts: ${c.synthesized ? 'a representative cohort at' : `${c.sampleSize} shoppers in`} ${c.grainLabel} — ${c.topLines.slice(0, 3).map((l) => `${l.line} ${Math.round(l.share * 100)}%`).join(', ')}${c.synthesized ? '' : ` · they buy in the ${c.modalBand} band → the page opens there`}`);
      const touches = coldTouches();
      if (touches.length) step('prior', touches);
      continue;
    }
    if (a.kind === 'surface') {
      if (used.has(a.s.id)) continue; used.add(a.s.id);
      override = { ...a.s.hero, from: a.s.id };
      const action = a.s.act ?? 'arrival';
      did.push(`${action === 'declared' ? 'Tells us, on a' : 'Arrives from'} ${KIND_LABEL[a.s.kind].toLowerCase()} — ${a.s.subject}`
        + ` (${a.s.touches.map((t) => `${t.dim}=${t.value}`).join(', ')})`);
      step(action, a.s.touches);
    } else if (a.kind === 'nav') {
      dept = a.category;
      did.push(`Browses the ${a.category} department`);
      step('nav_click', [{ dim: S.vertical === 'retail' ? 'category' : 'productFamily', value: a.category }]);
    } else if (a.kind === 'card' || a.kind === 'item') {
      let item = a.item;
      if (!item) {
        const row = composeSim(snapshot(reflex, clock, cfg)).filter((d) => d.slot === 'row').map((d) => byId(d.itemId)).filter(Boolean);
        const pool = row.filter((i) => (a.cat ? i.category === a.cat : i.line === a.line));
        item = pool[a.n] || pool[0];
      }
      if (!item) continue;
      const action = a.action || 'row_click';
      if (action === 'intent_start') anchor = item.id;
      did.push(`${action === 'intent_start' ? 'Adds to bag' : 'Clicks'} ${item.name}`);
      step(action, extractTouches(item, cfg));
    } else if (a.kind === 'cta') {
      const heroD = composeSim(snapshot(reflex, clock, cfg)).find((d) => d.slot === 'hero');
      const item = (override?.item && byId(override.item)) || (heroD?.itemId && byId(heroD.itemId));
      if (!item) continue;
      anchor = item.id;
      did.push(`Adds to bag ${item.name} — the hero`);
      step('intent_start', extractTouches(item, cfg));
    } else if (a.kind === 'skip') {
      clock += 120_000;
      const res = tick(reflex, clock, cfg);
      reflex = res.state; entered.push(...res.changes.entered); exited.push(...res.changes.exited);
      did.push('Two minutes pass');
    }
  }
  const after = snapshot(reflex, clock, cfg);
  const next = composeSim(after);
  const lay = composeLayout({ affinity: after, config: cfg, shapeOfKey: SHAPE_OF_KEY,
    prevOrder: S.layout?.order, locked: $('takeover').hidden ? [] : ['takeover'] });

  // The handoff rule, applied to the copy: a campaign's claim ends when what it
  // was about stops leading, or decays under its exit threshold.
  if (override && override === S.heroOverride) {
    const src = SURFACES[S.vertical].find((x) => x.id === override.from);
    const broadKey = S.registry.dimensions.find((d) => d.shape === 'broad')?.key;
    const spec = S.registry.dimensions.find((d) => d.key === broadKey);
    const claimed = src?.touches.find((t) => t.dim === broadKey)?.value;
    const per = after.dims?.[broadKey] || {};
    let leader = null, best = 0; for (const [v, x] of Object.entries(per)) if (x > best) { best = x; leader = v; }
    if (claimed && ((per[claimed] ?? 0) < (spec?.thetaOut ?? 0.45) || (leader && leader !== claimed))) override = null;
  }
  const moves = [];
  for (const spec of S.registry.dimensions) {
    const b = before.dims?.[spec.key] || {}; const aa = after.dims?.[spec.key] || {};
    for (const v of new Set([...Object.keys(b), ...Object.keys(aa)])) {
      const from = b[v] ?? 0, to = aa[v] ?? 0;
      if (Math.abs(to - from) > 0.0005) moves.push({ dim: spec.key, value: v, from, to, thetaIn: spec.thetaIn, crosses: from < spec.thetaIn && to >= spec.thetaIn });
    }
  }
  moves.sort((x, y) => Math.abs(y.to - y.from) - Math.abs(x.to - x.from));
  const heroNowTitle = $('hero-title').textContent;
  const heroD = next.find((d) => d.slot === 'hero');
  const heroNextTitle = override ? override.title : ((heroD?.itemId && byId(heroD.itemId)?.name) || heroNowTitle);
  const picksOf = (ds) => ds.filter((d) => d.slot === 'row' && (d.strategy === 'affinity' || d.strategy === 'completion' || d.strategy === 'cohort')).map((d) => byId(d.itemId)?.name).filter(Boolean);
  const picksNow = picksOf(S.decisions), picksNext = picksOf(next);
  const orderNow = (S.layout?.order || []).filter((x) => x !== 'takeover'), orderNext = lay.order.filter((x) => x !== 'takeover');
  const lead = lay.sections.filter((x) => x.strategy !== 'locked' && x.strategy !== 'template').sort((a, b) => a.rank - b.rank)[0];
  return { did, weights, moves, entered: [...new Set(entered)], exited: [...new Set(exited)],
           heroChanges: heroNextTitle !== heroNowTitle, heroNextTitle, picksNow, picksNext,
           rearranged: orderNow.length > 0 && JSON.stringify(orderNow) !== JSON.stringify(orderNext), lead,
           dept, deptChanged: dept !== S.dept,
           completion: next.some((d) => d.strategy === 'completion') && !S.decisions.some((d) => d.strategy === 'completion') };
}

/** Declare a sequence before it happens; resolves when the presenter presses OK. */
/** One score per row: dimension · value | before → after | threshold | result. */
function movesTable(moves, { empty = 'No dimension moves.' } = {}) {
  const pct = (n) => n.toFixed(3);
  if (!moves.length) return `<div>${empty}</div>`;
  return `<table class="pd-t">${moves.map((m) => {
    const res = m.crosses ? '<span class="enters">enters</span>'
      : m.leaves ? '<span class="leaves">leaves</span>'
      : m.to < m.from ? '<span class="decays">decays</span>' : '';
    const th = m.thetaIn != null ? `θ<sub>in</sub> ${m.thetaIn}` : m.thetaOut != null ? `θ<sub>out</sub> ${m.thetaOut}` : '';
    return `<tr><td class="dim">${escapeHtml(m.dim)} · ${escapeHtml(String(m.value))}</td>`
      + `<td class="num">${pct(m.from)} → <span class="to">${pct(m.to)}</span></td>`
      + `<td class="th">${th}</td><td class="res">${res}</td></tr>`;
  }).join('')}</table>`;
}

/** A "what will change" line: a headline, then the reasons as their own bullets. */
const willItem = (head, subs = []) =>
  `${head}${subs.length ? `<ul class="pd-sub">${subs.map((x) => `<li>${x}</li>`).join('')}</ul>` : ''}`;
const pill = (t, cls = '') => `<span class="pd-v${cls ? ` ${cls}` : ''}">${escapeHtml(t)}</span>`;

/** Declare a sequence before it happens; resolves when the presenter presses OK. */
async function sequenceBand(acts) {
  const f = forecastSequence(acts);
  if (!f.did.length) return;
  const count = {}; for (const x of f.weights) count[x.action] = (count[x.action] || 0) + 1;
  const chips = Object.entries(count)
    .map(([a, n]) => `<span>${escapeHtml(VERB_PAST[a] || a)} ×${n} · weight <b>${(S.config.weights?.[a] ?? 1).toFixed(1)}</b></span>`).join('');
  const actHtml = f.did.map((d, i) => `<span class="l">${i + 1}. ${escapeHtml(d)}</span>`).join('')
    + `<div class="pd-w">${chips || '<span>time only</span>'}</div>`;
  // A row must earn its place: a real move (≥ 0.01) or a threshold crossed.
  // Two-thousandths of decay is arithmetic, not information, at a glance.
  const math = movesTable(f.moves.filter((m) => m.crosses || Math.abs(m.to - m.from) >= 0.01).slice(0, 6));
  const will = [];
  for (const a of f.entered.filter((x) => !isStageAudience(x))) will.push(willItem(`She enters ${pill(prettyAudience(a), 'g')}`));
  for (const a of f.exited.filter((x) => !isStageAudience(x))) will.push(willItem(`She leaves ${pill(prettyAudience(a), 'o')}`));
  if (f.deptChanged) will.push(willItem(`The shelf becomes ${pill(f.dept)}`));
  if (f.heroChanges) will.push(willItem(`The hero becomes ${pill(f.heroNextTitle)}`));
  if (f.completion) will.push(willItem('The row becomes <b>Complete the look</b>'));
  else if (f.picksNext.length && JSON.stringify(f.picksNow) !== JSON.stringify(f.picksNext)) {
    will.push(willItem('<b>Picked for her</b>, first line', f.picksNext.slice(0, 5).map(escapeHtml)));
  }
  if (f.rearranged) {
    const why = String(f.lead?.explain?.movedBecause || '');
    const subs = why.split(/;\s*/).flatMap((part) => part.split(/,\s*(?=[a-z])/)).map((x) => x.trim()).filter(Boolean).map(escapeHtml);
    will.push(willItem(`The page <b>rearranges</b> — ${pill(SECTION_NAME[f.lead?.section] || f.lead?.section || 'a different section')} now leads`, subs));
  }
  if (acts.some((a) => a.kind === 'arrive')) will.push(willItem('Nothing about <b>her</b> yet — behaviour none', ['the neighbourhood priors sit in her profile and decay like everything else', 'her first engagement hands the page from the cohort to her']));
  if (!will.length) will.push('Scores move; nothing on the page changes yet — not enough signal.');
  await openPredictBand({
    mode: f.did.length === 1 ? 'before her next act' : `before her next ${f.did.length} acts`,
    act: f.did.join('\n'), actHtml, math, will,
    note: 'Computed on a copy of her real profile — the same engine, the same weights. Nothing has happened yet; press OK and she does it.',
    button: 'OK — let her do it',
  });
}

/** The presenter's own hand: declare, wait for OK, then do it for real. */
async function gateThen(acts, fn) {
  if (PD.open) return;
  await sequenceBand(acts);
  GATE.open = true;
  try { fn(); } finally { GATE.open = false; }
}

/** The shared band plumbing: fill arbitrary columns, await the consent press. */
function openPredictBand({ mode, act, actHtml, math, will, note, button }) {
  $('pd-mode').textContent = mode;
  $('pd-done').innerHTML = DONE.length
    ? DONE.map((d) => `<li><b>${d.verb}</b> ${escapeHtml(d.subject)}${d.move ? `<div><span class="pd-v">${escapeHtml(d.move)}</span></div>` : ''}</li>`).join('')
    : '<li>Nothing yet — she arrived, that is all.</li>';
  if (actHtml) $('pd-act').innerHTML = actHtml; else $('pd-act').textContent = act;
  $('pd-math').innerHTML = math;
  $('pd-will').innerHTML = will.map((w) => `<li>${w}</li>`).join('');
  if (note) $('pd-note').textContent = note;
  $('pd-go').textContent = button || 'Close — let her do it';
  return openBandRaw();
}

function openBandRaw() {
  $('predict').hidden = false; PD.open = true;
  if (window.MOMENTS) window.MOMENTS.pause();
  return new Promise((resolve) => { PD.resolve = resolve; });
}
$('pd-go').onclick = () => { $('predict').hidden = true; PD.open = false; if (window.MOMENTS) window.MOMENTS.resume(); PD.resolve?.(); PD.resolve = null; };

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
const BZ = { busy: false, abort: false };
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
  clearTimeout(el._ck); el._ck = setTimeout(() => el.classList.remove('clicked'), 2000);
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
async function browse(btn, targets) {   // targets are perform SPECS
  if (BZ.busy) return;
  BZ.busy = true; BZ.abort = false; btn.classList.add('running');   // a fresh run never inherits a stale stop
  document.querySelectorAll('[id^="bz-"]').forEach((b) => { b.disabled = true; });
  try {
    // DECLARE FIRST. The whole sequence is forecast on a copy and shown before
    // anything moves; OK lets her do it. Then each act runs for real, ungated.
    const acts = targets.map(actOf).filter(Boolean);
    if (acts.length && !GATE.open) { await sequenceBand(acts); if (BZ.abort) return; }
    GATE.open = true;
    for (const t of targets) {
      if (BZ.abort) break;                                     // the presenter said stop
      const spec = t && t.predict ? t.predict : t;
      const el = typeof spec === 'function' ? spec() : typeof spec === 'string' ? document.querySelector(spec) : resolveTarget(spec);
      if (!el) continue;
      if (el.wait) { await sleep(el.wait); continue; }        // a beat may pause to let a retreat land
      if (el.run) { el.run(); await sleep(1400); continue; }   // an act with no element to click (the arrival)
      await moveCursorTo(el);
      await sleep(700);                                        // between clicks — Coach's cadence
    }
  } finally {
    GATE.open = false;
    hideCursor();
    BZ.busy = false; BZ.abort = false; btn.classList.remove('busy'); btn.classList.remove('running');
    document.querySelectorAll('[id^="bz-"]').forEach((b) => { b.disabled = false; });
  }
}

/** Nth card of a category currently on the row; falls back to any card so a beat never stalls. */
const cardOf = (category, n) => () => {
  const cards = [...$('row').querySelectorAll('.card')];
  const inCat = cards.filter((c) => (byId(c.dataset.id)?.category === category));
  // Never a positional fallback: clicking a jacket when asked for a bag is
  // worse than skipping. The department filter makes the category present.
  return inCat[n] || inCat[0] || null;
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
  if (!b.dept) return [{ sel: '#hero-cta' }];
  return [{ dept: b.dept }, ...Array.from({ length: b.n }, (_, i) => ({ card: { cat: b.dept, n: i } }))];
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
  [{ dept: 'Knitwear' }, { line: { name: 'Fenwick', n: 0 } }, { line: { name: 'Fenwick', n: 1 } }, { line: { name: 'Fenwick', n: 2 } },
   { dept: 'Bags' }, { line: { name: 'Linden', n: 0 } }]);
$('bz-coats').onclick = (e) => browse(e.currentTarget, beatTargets('a'));
$('bz-bags').onclick = (e) => browse(e.currentTarget, beatTargets('b'));
$('bz-decide').onclick = (e) => browse(e.currentTarget, beatTargets('c'));

// ── Let time pass ───────────────────────────────────────────────────────────
// The clocks are slow enough now that a profile survives a conversation. So
// decay is something the presenter asks for: every accumulator's last touch
// moves back by N seconds, locally and in the object, and the ordinary tick
// does the rest. Same math. The only thing that changed is who chose the moment.
async function skipTime(seconds) {
  if (PD.open) return;                             // one thing at a time
  if (BZ.busy && !GATE.open) return;
  advanceClock();
  const ms = seconds * 1000;
  if (!GATE.open) {

  // PREVIEW FIRST. "Let me know that it's about to decay - do you want to
  // proceed?" The band shows what those minutes will take before they pass;
  // closing it is the consent that lets them.
  const copy = JSON.parse(JSON.stringify(S.reflex));
  const res0 = tick(copy, NOW() + ms, S.config);
  const lapses = res0.changes.exited.filter((a) => !isStageAudience(a));
  const drops = [];
  const before0 = snapshot(S.reflex, NOW(), S.config);
  const after0 = snapshot(res0.state, NOW() + ms, S.config);
  for (const spec of S.registry.dimensions) {
    const b = before0.dims?.[spec.key] || {}; const a = after0.dims?.[spec.key] || {};
    for (const v of Object.keys(b)) {
      if ((b[v] ?? 0) - (a[v] ?? 0) > 0.08) drops.push({ dim: spec.key, value: v, from: b[v], to: a[v] ?? 0 });
    }
  }
  drops.sort((x, y) => (y.from - y.to) - (x.from - x.to));
  const will = [];
  for (const a of lapses) will.push(willItem('She leaves ' + pill(prettyAudience(a), 'o')));
  if (OFFER.live && OFFER.expiresAt <= NOW() + ms) will.push(willItem('The <b>offer expires</b>', ['it names the number that ended it']));
  if (!will.length) will.push('Scores drop; nothing crosses out yet.');

  await openPredictBand({
    mode: 'time is about to pass — with your consent',
    act: Math.round(seconds / 60) + ' minutes pass',
    math: movesTable(drops.slice(0, 6).map((d) => ({ ...d, thetaOut: S.registry.dimensions.find((x) => x.key === d.dim)?.thetaOut,
      leaves: lapses.some((a) => a.startsWith((d.dim + '_' + String(d.value)).toLowerCase().replace(/\s+/g, '_'))) })), { empty: 'Nothing measurable decays.' }),
    will,
    note: 'Nothing has happened yet. Close this and the minutes pass - the same decay, at the moment you chose.',
    button: 'Close - let ' + Math.round(seconds / 60) + ' minutes pass',
  });
  }

  S.clock += ms;
  const before = new Set(S.audiences);
  const res = tick(S.reflex, NOW(), S.config);
  S.reflex = res.state;
  if (res.changes.entered.length || res.changes.exited.length) absorb(res.changes);
  recompose(false, { tick: true });
  post('/action', { vertical: S.vertical, events: [{ action: 'time_skip', seconds, at: NOW() }] });
  const gone = [...before].filter((a) => !S.audiences.has(a) && !isStageAudience(a));
  recordDone('Let pass', Math.round(seconds / 60) + ' minutes', gone.length ? gone.length + ' audience(s) lapsed' : 'scores decayed');
  consequence('Time', Math.round(seconds / 60) + ' minutes passed - because you said so',
    gone.length ? 'Lapsed: ' + gone.map(prettyAudience).join(', ') + '. The same decay ran; the presenter chose the moment.'
                : 'Nothing lapsed yet. Press again and the next retreat lands.');
  $('sentence').textContent = gone.length
    ? 'Two minutes passed. ' + prettyAudience(gone[0]) + ' lapsed - its score decayed under the exit threshold. Nobody wrote an exit rule.'
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
const SHAPE_LABEL = { broad: 'category', narrow: 'line', need: 'occasion', band: 'price band', durable: 'taste', hue: 'colour', content: 'content', stage: 'stage' };
let TUNED = false;

function renderDial() {
  const st = SLOT_STRATEGIES.hero;
  const shapes = ['broad', 'narrow', 'band', 'durable', 'need', 'hue'];
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
      const snap = snapshot(S.reflex, NOW(), S.config);
      const strongest = Math.max(0, ...Object.values(snap.dims || {}).flatMap((d) => Object.values(d)));
      recompose();
      $('dial-foot').textContent = S.priorityEngaged
        ? 'Audience priority is ENFORCED, so it outranks these weights for the hero — release it in Live affinity to let the dial decide.'
        : strongest < 0.05
        ? 'Nothing to weigh yet — she has no affinity. Browse first, then turn this.'
        : `hero · ${SHAPE_LABEL[sh] || sh} = ${v.toFixed(2)} · re-decided now · ${S.config.version}+tuned`;
    };
  });
  $('dial-foot').textContent = 'Turn one. The hero recomposes on the new weight and the receipt records the version.';
}

// ── The audience strip ──────────────────────────────────────────────────────
const prettyAudience = (key) => key.replace(/_affinity$/, '').replace(/_/g, ' · ');

let OSTRIP_UNTIL = 0;
/** "We rearranged the page" — a change of ORDER is explained separately from a change of products. */
function orderStrip(html, ttl) {
  const el = $('ostrip');
  applyHighlight(el);
  $('ostrip-t').innerHTML = html;
  el.hidden = false;
  OSTRIP_UNTIL = NOW() + ttl;
}
/** Content that moved out of view is brought into view once the sections have finished moving. */
function revealSection(id, delay = 0) {
  setTimeout(() => {
    const el = document.querySelector(`[data-section="${id}"]`) || document.getElementById(id);
    const page = $('page'); if (!el || !page) return;
    const r = el.getBoundingClientRect(), p = page.getBoundingClientRect();
    if (r.top < p.top || r.bottom > p.bottom) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, delay);
}

let STRIP_UNTIL = 0;
function strip(kind, html, ttl) {
  const el = $('strip');
  el.classList.toggle('out', kind === 'out');
  el.classList.toggle('cold', kind === 'cold');
  $('strip-k').textContent = kind === 'out' ? 'Left an audience' : kind === 'cold' ? 'Welcome' : 'Entered an audience';
  $('strip-t').innerHTML = html;
  el.hidden = false;
  STRIP_UNTIL = NOW() + ttl;      // rides the demo clock — holds while you talk
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
  if ((changes.entered.length || changes.exited.length) && window.MOMENTS) {
    window.MOMENTS.audienceChange({ entered: changes.entered, exited: changes.exited,
      snapshot: snapshot(S.reflex, NOW(), S.config) });
  }
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
  const snap = snapshot(S.reflex, NOW(), S.config);
  checkHandoff(snap);
  let next = compose({ affinity: snap, state: S.reflex, items: S.items, rowItems: rowPool(), coldPicks: S.coldPicks || undefined, blocks: S.blocks,
                       config: S.config, shapeOfKey: SHAPE_OF_KEY, rowSize: 10, pins: S.pins,
                       audiencePriority: S.priorityEngaged ? S.audiencePriority : undefined,
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
  renderPriority();
  const coldTag = $('cold-behaviour');
  if (coldTag) coldTag.textContent = S.behaved ? 'superseded by behaviour' : 'behaviour none';
  checkOffer(); offerTick();
  const stratOf = (lay) => lay ? lay.sections.map((x) => x.section + ':' + x.strategy).join('|') : '';
  if (opts.tick && prevLayout && stratOf(prevLayout) === stratOf(S.layout)) S.layout = { ...S.layout, order: prevLayout.order };
  // A FIRST paint applies the order instantly and says nothing. Skipping it left
  // the previous session's arrangement in the DOM, and the next tick "moved"
  // the sections back — announcing a rearrangement that was only the reset.
  if (first) paintLayout(S.layout.order, { duration: 0 });
  const movedSections = first ? [] : paintLayout(S.layout.order, { duration: 700 });
  if (movedSections.length) {
    capDone(7);
    const top = S.layout.sections.filter((x) => x.strategy !== 'locked' && x.strategy !== 'template')
      .sort((a, b) => a.rank - b.rank)[0];
    consequence('Which box comes first',
      movedSections.map((m) => `${SECTION_NAME[m.section] || m.section} ${m.from} → ${m.to}`).join(' · '),
      top?.explain?.movedBecause || 'The sections re-ordered on the same vector that ranks the products.');
    S.sayLockUntil = Date.now() + 5000;
    $('sentence').textContent = top
      ? `${SECTION_NAME[top.section] || top.section} leads the page — ${top.explain.movedBecause}`
      : 'The page re-ordered its sections.';
    // A rearrangement is a different kind of change from a product changing, and
    // it gets its own explanation on the page — and whatever moved DOWN, out of
    // view, is scrolled into view once the sections have finished moving.
    const down = movedSections.filter((m) => m.to > m.from).sort((a, b) => b.to - a.to)[0];
    // NAME THE LEADER, and say why in its own terms. "A different section" was
    // the fallback when the leader held a template position — it named nothing.
    const first = S.layout.sections.slice().sort((a, b) => a.rank - b.rank).find((x) => x.section !== 'takeover');
    const leadSec = first;                          // whoever is at the top IS the leader — template or not
    const lead = SECTION_NAME[leadSec?.section] || leadSec?.section || 'A different section';
    const why = leadSec?.explain?.movedBecause
      || (leadSec?.strategy === 'locked' ? 'it is pinned by the merchandiser'
        : leadSec?.strategy === 'template' ? 'nothing outranks it, so it holds the template position'
        : 'ranked on the same vector as the products');
    orderStrip(`<b>${lead}</b> now leads the page — ${why}`
      + (down ? `. <b>${SECTION_NAME[down.section] || down.section}</b> moved below it.` : '.'), 14000);
    if (down) revealSection(down.section, 780);
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
  // A step that changes something on the page gets the next colour — once per
  // step, shared by the hero and the row so the whole step reads as one colour.
  if (!first && !tick && (heroChanged || rowChanged || rowMoved)) nextHighlight();

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
  if (instant) { el.classList.remove('landed'); render(); return; }   // a fresh visitor starts without it
  el.classList.add('swapping');
  setTimeout(() => {
    render();
    el.classList.remove('swapping');
    // The hero LANDS (rise, pop, shimmer, red shadow underneath); the blocks
    // get the quieter glow. Both are one-shot, and only a real change gets here.
    // The hero keeps its red drop shadow until it changes again; the blocks
    // get the quieter one-second glow.
    const fx = el.id === 'hero' ? 'landed' : 'pulse';
    applyHighlight(el);
    el.classList.remove(fx); void el.offsetWidth; el.classList.add(fx);
  }, 300);
}

function paintHero(d) {
  const o = S.heroOverride;
  // A campaign override may name the SKU its creative featured; otherwise the
  // engine's pick.
  const it = (o?.item && byId(o.item)) || (d?.itemId && byId(d.itemId));
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
// engine underneath is untouched — same slots, same eight dimensions, same
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
const ROW = { nodes: new Map(), lastMovers: [], holdUntil: 0 };

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
    signal('intent_start', byId(el.dataset.id));
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
  const cold = compose({ affinity: { dims: {}, audiences: [] }, items: S.items, rowItems: rowPool(), blocks: S.blocks,
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
  nextHighlight();
  highlightMovers(promoted, 10000, 'std');
  consequence('What changed', `${promoted.length} card${promoted.length === 1 ? '' : 's'} sit above where the standard order puts them`,
    promoted.map((m) => `${byId(m.id)?.name ?? m.id}: ${m.was ? `${m.was} → ${m.now}` : `in at ${m.now}`}`).join(' · '));
}

function highlightMovers(movers, holdMs, label = 'was') {
  applyHighlight($('row'));
  $('row').querySelectorAll('.card.changed').forEach((el) => el.classList.remove('changed'));
  for (const { id, was, now, std, fresh, near } of movers) {
    const el = ROW.nodes.get(id); if (!el) continue;
    el.classList.add('changed');
    const d = el.querySelector('.delta');
    d.classList.remove('quiet');
    // The badge names where the pick came from; a pick already in place with
    // nothing to say carries the colour alone.
    const tag = label === 'std' ? (was == null ? 'not in std' : `std ${was}`)
      : near ? 'near you'
      : was != null ? `was ${was}`
      : fresh ? 'new in'
      : std != null ? `std ${std}`
      : null;
    d.hidden = !tag;
    if (tag) d.innerHTML = `<b>${now}</b><small>${tag}</small>`;
  }
  // Clock-based, not wall-based: the green holds while the presenter talks and
  // fades only as demo time moves. Stability during a conversation is the rule.
  ROW.holdUntil = NOW() + holdMs;
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
  // WHAT IS HIGHLIGHTED IS WHAT WAS PICKED FOR HER — the promoted block, which
  // the composer puts at the top and nowhere else. It used to be "whatever
  // shifted a slot since the last paint", which lit a jacket at 4 because a bag
  // dropped, and read as nonsense. Now: the block, in the step colour, with a
  // badge saying where each pick came from — its previous slot if it just
  // moved, its standard-order slot otherwise.
  const control = (tick || first) ? [] : controlOrder();
  const movers = [];
  items.forEach((it, i) => {
    let el = ROW.nodes.get(it.id);
    if (!el) { el = cardNode(it, hues.get(it.id) || it.hex); ROW.nodes.set(it.id, el); }
    else el.style.setProperty('--hue', hues.get(it.id) || it.hex);
    if (row.children[i] !== el) row.insertBefore(el, row.children[i] || null);
    el.querySelector('.rank').textContent = i + 1;
    const d = el.querySelector('.delta');
    const picked = ds[i]?.strategy === 'affinity' || ds[i]?.strategy === 'completion' || ds[i]?.strategy === 'cohort';
    if (tick || first) { d.hidden = true; return; }
    if (picked) {
      const was = rankBefore.get(it.id);
      const std = control.indexOf(it.id) + 1;
      movers.push({ id: it.id, now: i + 1, near: ds[i]?.strategy === 'cohort',
                    was: (was && was !== i + 1) ? was : null,
                    std: (!was || was === i + 1) && std && std !== i + 1 ? std : null,
                    fresh: !was && prevIds.length > 0 });
    } else {
      const was = rankBefore.get(it.id);
      if (was && was < i + 1) { d.hidden = false; d.classList.add('quiet'); d.innerHTML = `<small>was ${was}</small>`; }
      else d.hidden = true;
    }
  });

  flipRow(geometryBefore);
  if (movers.length) { ROW.lastMovers = movers; highlightMovers(movers, 12000); }
  else if (!tick && !first) $('row').querySelectorAll('.card.changed').forEach((el) => el.classList.remove('changed'));

  const completing = ds.some((d) => d.strategy === 'completion');
  const anchor = completing && byId(ds.find((d) => d.anchorId)?.anchorId);
  const cohortLeads = ds.some((d) => d.strategy === 'cohort');
  const claims = ds.some((d) => d.strategy === 'affinity') || cohortLeads;
  if (claims || completing) capDone(4);
  if (ds.some((d) => d.strategy === 'affinity')) capDone(6);
  if (completing) capDone(7);
  document.querySelector('.row-head').classList.toggle('quiet', !completing && !claims && ds.some((d) => d.strategy === 'fading'));
  $('row-title').textContent = completing
    ? (S.vertical === 'retail' ? 'Complete the look' : 'Complete your application')
    : cohortLeads ? (S.vertical === 'retail' ? 'What shoppers near you carry' : 'What people near you choose')
    : (S.vertical === 'retail' ? 'Selected for you' : 'Suited to you');
  // The row is a promoted BLOCK over a standard shelf now, and the note says so:
  // membership earns the block, everything below it is what every shopper sees.
  const promoted = ds.filter((d) => d.strategy === 'affinity' || d.strategy === 'completion').length;
  $('row-note').textContent = completing
    ? `chosen to go with the ${anchor ? anchor.name : 'piece you chose'} — nothing from the same category`
    : cohortLeads ? `what shoppers near her carry — ${S.cohort?.grainLabel || 'her area'}${S.cohort?.sampleSize ? ` · N=${S.cohort.sampleSize}` : ' · representative'} · first-party · curated, never priced`
    : claims ? `${S.dept ? `in ${S.dept} — ` : ''}picked for her — ${promoted} promoted, the rest in the standard order`
    : 'the standard order — the same for every shopper';
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
  const res = tick(S.reflex, NOW(), S.config);
  S.reflex = res.state;
  if (res.changes.entered.length || res.changes.exited.length) absorb(res.changes);
  recompose(false, { tick: true });
  if (ROW.holdUntil && NOW() >= ROW.holdUntil) {
    ROW.holdUntil = 0;
    $('row').querySelectorAll('.card.changed').forEach((el) => {
      el.classList.remove('changed');
      const d = el.querySelector('.delta'); if (d) d.hidden = true;
    });
  }
  if (STRIP_UNTIL && NOW() >= STRIP_UNTIL) { STRIP_UNTIL = 0; $('strip').hidden = true; $('ostrip').hidden = true; }
  if (OSTRIP_UNTIL && NOW() >= OSTRIP_UNTIL) { OSTRIP_UNTIL = 0; $('ostrip').hidden = true; }
  renderXp();
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
  const now = NOW();
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
$('btn-ask').onclick = () => { openMoment('ask'); renderAskPre(); $('q').focus(); };
$('ask-close').onclick = () => $('ask').classList.remove('open');

$('ask-form').onsubmit = async (e) => {
  e.preventDefault();
  const query = $('q').value.trim(); if (!query) return;
  const input = $('q'); const was = input.placeholder;
  input.disabled = true; input.placeholder = 'reading that…';

  const a = await fetch(`${API}/search`, {
    method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ vertical: S.vertical, query,
                           affinity: snapshot(S.reflex, NOW(), S.config) }),
  }).then((r) => r.json()).catch(() => null);
  input.disabled = false; input.placeholder = was; input.value = '';

  // ok can be true with scene null — a plain noun matched ("sweaters") and the
  // results show without scene copy. Only a full miss says so and stops.
  if (!a?.ok || (!a.scene && !(a.products || []).length)) {
    $('sentence').textContent = `Nothing in the catalogue matched "${query}". Nothing was invented to fill the gap.`;
    return;
  }
  if (SCENE_COUNT === null) {
    SCENE_COUNT = (await fetch(`${API}/scenes?vertical=${S.vertical}`).then((x) => x.json())
      .catch(() => ({ scenes: [] }))).scenes.length;
  }

  // A search is an ordinary signal — it goes through apply() like any click.
  const res = apply(S.reflex, { action: 'search', touches: a.touches }, NOW(), S.config);
  S.reflex = res.state; absorb(res.changes); recompose();
  post('/action', { vertical: S.vertical, events: [{ action: 'search', touches: a.touches }] });

  // The SERVER ranked the products: hard-filtered to the named category, scored
  // on intent + her affinity. The client paints; it does not re-decide.
  const picks = (a.products || []).map(byId).filter(Boolean).slice(0, 8);
  const hues = distinctHues(picks);

  $('ask-art').style.backgroundImage = `url(${a.hero?.image || a.scene?.art || ''})`;
  $('ask-kick').textContent = query;
  $('ask-title').textContent = a.scene?.headline
    || (a.intent?.categories?.length ? `${a.intent.categories.join(' & ')}, for you` : 'Found for you');
  $('ask-sub').textContent = a.scene?.subhead || 'Ranked over the live catalogue — every result is real and in stock.';
  const intentBits = [
    ...(a.intent?.categories || []).map((x) => `category ${x}`),
    ...(a.intent?.lines || []).map((x) => `line ${x}`),
    ...(a.intent?.colours || []).map((x) => `colour ${x}`),
    ...(a.intent?.occasions || []).map((x) => `occasion ${x}`),
    ...(a.intent?.priceCeilingUsd ? [`under $${a.intent.priceCeilingUsd}`] : []),
  ];
  $('ask-prov').innerHTML =
    `Read by the <b>${a.source === 'model' ? 'model' : 'local classifier'}</b>: ` +
    `<b>${intentBits.join(' · ') || 'no constraints — her affinity decides'}</b> · <b>${a.ms}ms</b><br>` +
    `Signal applied: <b>${a.touches.map((t) => `${t.dim}=${t.value}`).join(', ')}</b>. ` +
    `The model reads the sentence; the engine ranks the products — hard-filtered to what she asked for, ` +
    `ordered by intent and her live affinity. The scene was generated and approved before this demo.`;
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
  $('ask-answer').hidden = false; $('ask-pre').hidden = true; capDone(14);
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
  // The bandit half of the beat: a real multi_armed_bandit rule, the 28:00
  // window on the demo clock, allocation moving one round per two minutes.
  const fx = await dispatchExperiment('mab', null, { source: m.signal.source.toLowerCase(), moment: m, windowMin: 28, title: `the moment — ${m.signal.source}` });
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
  openMoment('receipts');
  consequence('Receipts', `${r.rows.length} decision rows exported`,
    'Every slot, every candidate count, every driver, every refusal, and the config version it ran under. We hand you the rows; you compute the lift.');
  $('sentence').textContent =
    'We will never present our own uplift number as the proof. These are the rows that let you check us.';
  S.sayLockUntil = Date.now() + 8000;
};
$('rec-close').onclick = () => $('receipts').classList.remove('open');
$('btn-radar').onclick = async () => {
  openMoment('radar');
  // Always open on the blended view. The lie has to be seen before it is caught.
  RAD.baseline = null; RAD.recovered = null;
  await radar('all');
};
$('rad-close').onclick = () => $('radar').classList.remove('open');
$('btn-replay').onclick = () => showWhatChanged();
// Compare captures pixels, so whatever "changed" highlight is on the page at
// capture time is in the frame — before and after can be held side by side
// three minutes later, which is the reason the tool exists.
$('btn-capture').onclick = async () => {
  const b = $('btn-capture');
  if (b.classList.contains('busy')) return;        // one capture at a time (compare.js joins a pending one anyway)
  b.classList.add('busy'); b.classList.remove('on');
  b.innerHTML = 'Capture baseline<small>capturing — one moment</small>';
  const r = await captureBaseline($('page'));
  b.classList.remove('busy');
  b.classList.toggle('on', !!r.ok);
  b.innerHTML = r.ok ? 'Baseline captured<small>compare when ready</small>' : 'Capture baseline<small>freeze the page now</small>';
  if (r.ok) consequence('Compare', 'Baseline captured', 'Compare will show this frame against whatever the page looks like then.');
};
$('btn-compare').onclick = () => openCompare($('page'));
$('btn-conc').onclick = () => { openMoment('conc'); $('conc-q').focus(); };
$('conc-close').onclick = () => $('conc').classList.remove('open');
$('conc-reset').onclick = () => {
  CONC.history = []; CONC.shown = []; $('conc-thread').innerHTML = '';
};
// Suggestion chips fill the input and submit — a beat never starts with typing.
document.querySelectorAll('.mo-chips').forEach((box) => {
  const input = $(box.dataset.for);
  const form = input.closest('.moment-box').querySelector('form');
  box.querySelectorAll('button').forEach((b) => {
    b.onclick = () => { input.value = b.textContent; form.dispatchEvent(new Event('submit', { cancelable: true })); };
  });
});

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
  openMoment('opal'); $('oq').focus();
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
  capDone(10);
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
  if (t.arrive) return { run: arrive };
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
  $('dir-next').disabled = true; $('dir-next').classList.add('running');
  try { await browse($('dir-next'), beat.perform); }
  finally { $('dir-next').disabled = false; $('dir-next').classList.remove('running'); }
}

async function goBeat(i) {
  if (BZ.busy || DIR.arming) return;               // a beat is still being armed or performed
  DIR.arming = true;                               // Next pressed during a reset/reload/flip is ignored, not stacked
  // Stage management: a modal left open by the previous beat (Ask, the
  // Concierge, receipts, radar) closes when the next beat starts.
  document.querySelectorAll('.moment.open').forEach((m) => m.classList.remove('open'));
  try {
    DIR.i = Math.max(0, Math.min(BEATS.length - 1, i));
    sessionStorage.setItem('mrd_dir', String(DIR.i));
    await armBeat(BEATS[DIR.i]);
    renderBeat();
  } finally { DIR.arming = false; }
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
$('dir-play').onclick = () => { if (DIR.auto && BZ.busy) BZ.abort = true; setAuto(!DIR.auto); };
$('dir-stop').onclick = async () => {
  if (BZ.busy) BZ.abort = true;    // stop the visitor mid-stride — only if she is mid-stride
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
  if (e.key === 'Escape') { const m = document.querySelector('.moment.open'); if (m) { m.classList.remove('open'); return; } if (BZ.busy) BZ.abort = true; }
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
  const left = OFFER.expiresAt - NOW();

  if (left > 0) {
    const secs = Math.ceil(left / 1000);
    $('offer-clock').textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
    el.classList.toggle('expiring', secs <= 15);
    return;
  }

  // Ended. Say which number ended it — the whole point of the beat.
  OFFER.live = false;
  const snap = snapshot(S.reflex, NOW(), S.config);
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
  if (!at || at <= NOW()) return;

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
    `Earned by a decisive act, and it expires at a computed instant — ${Math.round((at - NOW()) / 1000)}s `
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
  const snap = snapshot(S.reflex, NOW(), S.config);
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

  capDone(15);
  consequence('Style concierge', r.unmet ? 'Said what it does not have' : 'Built a look',
    `${r.title}. Ids are enum-bound to the live catalogue minus everything already shown, so an `
    + 'invented product and a repeat are both unrepresentable — not discouraged, unrepresentable.');
}

/** A compact product tile for the search page (the same shape as a result). */
function tileHtml(it, i) {
  return `<article class="card" data-id="${it.id}" style="--hue:${it.hex || '#999'}">
      <div class="rank">${i + 1}</div>
      <div class="ph">${packshot(it, { withName: false })}${it.image
        ? `<img src="${it.image}" alt="" loading="lazy" onload="this.dataset.loaded=1" onerror="this.remove()">`
        : ''}</div>
      <div class="meta"><div class="nm">${escapeHtml(it.name)}</div>
        <div class="mt">${escapeHtml(it.category)} · ${escapeHtml(it.subcategory || it.colour || '')}</div>
        <div class="pr">${S.vertical === 'retail' ? money(it.value_usd) : (it.rate_pct != null ? it.rate_pct.toFixed(2) + '% APR' : 'See terms')}</div></div>
    </article>`;
}
/**
 * AI SEARCH, before she types: the empty height was a lost opportunity. Two rows —
 * what her own affinity already says, and what shoppers near her bought — so the
 * page reinforces the profile even before a query. Both from data already computed.
 */
function renderAskPre() {
  const pre = $('ask-pre'); if (!pre) return;
  const picked = S.decisions.filter((d) => d.slot === 'row' && (d.strategy === 'affinity' || d.strategy === 'completion')).map((d) => byId(d.itemId)).filter(Boolean).slice(0, 4);
  const snap = snapshot(S.reflex, NOW(), S.config);
  const lead = Object.entries(snap.dims || {}).flatMap(([d, vs]) => Object.entries(vs).map(([v, a]) => ({ d, v, a }))).filter((x) => x.a > 0.1).sort((x, y) => y.a - x.a)[0];
  const near = cohortUsable(S.cohort) ? coldPicksFor(S.cohort).map(byId).filter(Boolean).slice(0, 4) : [];
  const blocks = [];
  if (picked.length) blocks.push(`<h6>Because of what you have looked at${lead ? ` <span>· ${escapeHtml(lead.d)} · ${escapeHtml(lead.v)} ${lead.a.toFixed(2)}</span>` : ''}</h6><div class="row ask-tiles">${picked.map(tileHtml).join('')}</div>`);
  if (near.length) blocks.push(`<h6>Shoppers near you bought <span>· ${escapeHtml(S.cohort.grainLabel)}${S.cohort.sampleSize ? ` · N=${S.cohort.sampleSize}` : ' · representative'} · your receipts + census</span></h6><div class="row ask-tiles">${near.map(tileHtml).join('')}</div>`);
  if (!blocks.length) blocks.push('<h6>Nothing known yet</h6><div class="ask-empty">No behaviour and no cohort for this location — ask, and the answer is still ranked to what she does next.</div>');
  pre.innerHTML = blocks.join('');
  pre.hidden = $('ask-answer') && !$('ask-answer').hidden;
}
const escapeHtml = (t) => String(t).replace(/[&<>"]/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ── Revenue Radar ───────────────────────────────────────────────────────────
// The reveal is a subtraction, not a chart: the same funnel, filtered, against
// the line it was hiding behind. Only the failing step is allowed the alarm
// colour, because if everything is highlighted nothing is.

let RAD = { cohort: 'all', data: null, baseline: null, launched: null, recovered: null };

const cohortParam = (c) => (Array.isArray(c) ? c.map((k) => `${k.dim}:${k.value}`).join(',') : String(c || 'all'));
const usd = (n) => '$' + Math.round(n).toLocaleString('en-US');
const share = (n) => `${(n * 100).toFixed(1)}%`;
const isAll = (c) => !c || c === 'all' || (Array.isArray(c) && c.length === 0);

async function radar(cohort, opts = {}) {
  RAD.cohort = cohort;
  const q = new URLSearchParams({ vertical: S.vertical });
  if (!isAll(cohort)) q.set('cohort', cohortParam(cohort));
  if (opts.remedy) q.set('remedy', '1');
  const d = await fetch(`${API}/funnel?${q}`, { credentials: 'omit' })
    .then((r) => r.json()).catch(() => null);
  if (!d?.ok) { $('rad-funnel').innerHTML = '<div class="rad-math">The funnel service could not be reached.</div>'; return null; }
  if (isAll(cohort) && !opts.remedy) RAD.baseline = d;
  if (!opts.remedy) { RAD.data = d; renderRadar(); }
  return d;
}

function renderRadar() {
  const d = RAD.data; const base = RAD.baseline;
  const cohortKey = cohortParam(d.cohort ?? RAD.cohort);
  $('rad-sub').textContent = `· ${d.cohortLabel} · ${d.sessions.toLocaleString('en-US')} sessions`
    + (!isAll(d.cohort) ? ` · ${share(d.shareOfTraffic)} of traffic` : '');

  // THE PILLS. Generations lead (that is the story: the average hides a cohort);
  // the dimension chips stay so the room can filter to something never rehearsed.
  const gens = (d.cohortOptions || []).map((o) => ({ label: o.label, key: o.key, gen: true }));
  const legacy = [];
  if (!gens.length && d.suggested) {
    legacy.push({ label: 'Everyone', key: [] }, { label: d.suggested.first.map((k) => k.value).join(' + '), key: d.suggested.first },
                { label: d.suggested.drilldown.map((k) => k.value).join(' + '), key: d.suggested.drilldown });
  }
  const covered = new Set([...gens, ...legacy].map((c) => cohortParam(c.key)));
  const extra = (d.available || []).filter((a) => a.dim !== 'region')
    .map((a) => ({ label: a.label, key: [{ dim: a.dim, value: a.value }] }))
    .filter((c) => !covered.has(cohortParam(c.key)));
  const pill = (c) => `<button class="rad-c${c.gen ? ' gen lead' : ''}${cohortParam(c.key) === cohortKey ? ' on' : ''}" id="rad-c-${String(cohortParam(c.key) || 'all').replace(/[^a-z0-9_]/gi, '_')}" data-k='${JSON.stringify(c.key)}'>${escapeHtml(c.label)}</button>`;
  $('rad-cohorts').innerHTML = [...gens, ...legacy, ...extra].map(pill).join('');
  $('rad-cohorts').querySelectorAll('.rad-c').forEach((b) => { b.onclick = () => radar(JSON.parse(b.dataset.k)); });

  const rec = RAD.recovered && cohortParam(RAD.recovered.cohort) === cohortKey ? RAD.recovered : null;
  $('rad-funnel').innerHTML = d.steps.map((st, i) => {
    const bad = d.worst && st.key === d.worst.key && (st.severity ? st.severity === 'high' : true);
    const mid = st.severity === 'mid';
    const ghost = base && base.steps[i] ? base.steps[i].rate : null;
    const rate = rec ? rec.steps[i].rate : st.rate;
    const drop = i === 0 ? null : (rec ? rec.steps[i].dropPct : st.dropPct);
    return `<div class="rad-step${bad && !rec ? ' bad' : ''}${mid ? ' mid' : ''}${rec && bad ? ' rad-recovered' : ''}">
      <div class="lab"><span>${escapeHtml(st.label)}${drop != null ? `<span class="drop">▼ ${Number(drop).toFixed(1)}%</span>` : ''}</span><b>${share(rate)}</b></div>
      <div class="rad-track"><div class="rad-fill" style="width:${(rate * 100).toFixed(1)}%"></div></div>
      ${ghost != null && !isAll(d.cohort) ? `<div class="rad-ghost" style="width:${(ghost * 100).toFixed(1)}%"></div>` : ''}
    </div>`;
  }).join('') + (!isAll(d.cohort)
    ? `<div class="rad-math">The thin line under each bar is everyone. Simulated traffic; every rate above is computed from those rows on this request.${rec ? ' <b>Green: the same rows with the fix applied.</b>' : ''}</div>`
    : '<div class="rad-math">All visitors. This is the number that goes in the weekly report — and it looks like an ordinary week.</div>');

  if (!d.worst || !d.recoverable) {
    $('rad-find').innerHTML = !isAll(d.cohort)
      ? '<h6>No material gap</h6><div class="rad-remedy">This cohort tracks the average. That is a real answer too — and it is the one an average is usually telling the truth about.</div>'
      : '<h6>The average</h6><div class="rad-remedy">Nothing here looks wrong, which is the problem. Filter to a cohort — start with Gen-Z.</div>';
    return;
  }

  const w = d.worst; const r = d.recoverable; const m = r.math;
  $('rad-find').innerHTML = `
    <h6>Where it breaks</h6>
    <div class="rad-gap">${w.dropPct != null ? `${Number(w.dropPct).toFixed(1)}% drop` : `${(w.gapPoints * 100).toFixed(1)} points`}</div>
    <div class="rad-remedy"><b>${escapeHtml(w.label)}</b> — ${share(w.cohortRate)} for this cohort against ${share(w.baselineRate)} for everyone${w.skew ? ` · <b>${escapeHtml(w.skew)}</b>` : ''}.</div>
    <h6>Recoverable</h6>
    <div class="rad-money" id="rad-money">${usd(r.amountUsd)}</div>
    <div class="rad-math">${m
      ? `${Number(m.excessLostSessions).toLocaleString('en-US')} sessions lost beyond the expected drop × ${usd(m.aov)} average order × ${m.fraction} recoverable = <b>${usd(r.amountUsd)}</b>`
      : `${r.lostSessions.toLocaleString('en-US')} sessions lost to the gap × ${usd(r.aov)} average order = ${usd(r.amountUsd)}`}</div>
    <h6>The remedy</h6>
    <div class="rad-remedy">${escapeHtml(r.remedy)}${r.audienceNoun ? ` → <b>${escapeHtml(r.audienceNoun)}</b>` : ''}</div>
    <div id="rad-recover"></div>
    <button class="rad-launch" id="rad-launch">Launch the fix</button>
    <div class="rad-out" id="rad-out"></div>
    <div class="cold-tags" style="margin-top:14px">
      <span class="tg no">traffic simulated</span>
      <span class="tg ok">compute live</span>
      <span class="tg ok">audience + experiment real</span>
      <span class="tg dv">lift representative</span>
    </div>`;
  $('rad-launch').onclick = (e) => launchFix(e.currentTarget);
  if (RAD.launched && cohortParam(RAD.launched.cohort) === cohortKey) paintLaunched(RAD.launched.r);
}

/** PROVE THE FIX: the same rows, the remedy applied to the diagnosed cohort — the funnel recovers on screen. */
async function proveFix() {
  const before = RAD.data; if (!before?.recoverable) return;
  const after = await radar(before.cohort ?? RAD.cohort, { remedy: true });
  if (!after?.ok) return;
  RAD.recovered = { cohort: before.cohort ?? RAD.cohort, steps: after.steps, amountUsd: after.recoverable?.amountUsd ?? 0, recovered: after.recovered };
  renderRadar();
  const b = after.recovered?.before || { dropPct: before.worst?.dropPct, amountUsd: before.recoverable.amountUsd };
  const a = after.recovered?.after || { dropPct: after.worst?.dropPct ?? 0, amountUsd: after.recoverable?.amountUsd ?? 0 };
  $('rad-recover').innerHTML = `<div class="rad-delta"><div>Before<b>${Number(b.dropPct ?? 0).toFixed(1)}% drop · ${usd(b.amountUsd ?? 0)} leaking</b></div><div class="arr">→</div><div>With the fix<b>${Number(a.dropPct ?? 0).toFixed(1)}% drop · ${usd(a.amountUsd ?? 0)} leaking</b></div></div>
    <div class="rad-math">${escapeHtml(after.note || 'The same arithmetic over the same simulated rows, with the remedy applied to the diagnosed cohort.')}</div>
    <button class="rad-prove" id="rad-prove">Prove it in-session → open checkout</button>`;
  $('rad-prove').onclick = () => { $('radar').classList.remove('open'); openCheckout(); };
  consequence('Revenue Radar', 'The funnel recovers with the fix applied',
    `${Number(b.dropPct ?? 0).toFixed(1)}% → ${Number(a.dropPct ?? 0).toFixed(1)}% at ${before.worst.label}; ${usd(b.amountUsd ?? 0)} → ${usd(a.amountUsd ?? 0)}. Same rows, remedy applied — representative recovery, real experiment.`);
}

// ── THE PROOF IN THE ROOM: the checkout sheet ─────────────────────────────
// Before the fix: a card form. After the fix is live for her cohort: the
// remedy at the payment step, in-session — the Coach beat, ported.
function openCheckout() {
  document.querySelectorAll('.moment.open').forEach((m) => m.classList.remove('open'));
  const it = (S.anchorId && byId(S.anchorId)) || (pick(S.decisions, 'hero')?.itemId && byId(pick(S.decisions, 'hero').itemId)) || S.items[0];
  const total = S.vertical === 'retail' ? (it?.value_usd ?? 298) : null;
  const fix = S.fixLive;
  $('co-steps').innerHTML = (S.vertical === 'retail' ? ['Bag', 'Shipping', 'Payment'] : ['Application', 'Details', 'Identity check'])
    .map((n, i) => `<span class="${i === 2 ? 'on' : ''}">${i + 1} · ${n}</span>`).join('');
  $('co-sub').textContent = fix ? `The ${S.vertical === 'retail' ? 'payment' : 'identity'} step for ${fix.audienceNoun || 'the diagnosed cohort'} — the fix is live for her, in-session.` : `The ${S.vertical === 'retail' ? 'payment' : 'identity'} step, as this shopper sees it right now — before any fix.`;
  const lines = S.vertical === 'retail'
    ? `<div class="co-line"><span>${escapeHtml(it?.name || 'Your piece')}</span><b>${money(total)}</b></div><div class="co-line"><span>Shipping</span><b>Free</b></div><div class="co-line"><span>Total</span><b>${money(total)}</b></div>`
    : `<div class="co-line"><span>${escapeHtml(it?.name || 'Your application')}</span><b>in progress</b></div>`;
  const control = S.vertical === 'retail'
    ? `<div class="co-pay"><h4>Payment</h4><div class="co-field">Card number</div><div class="co-fields"><div class="co-field">MM / YY</div><div class="co-field">CVC</div></div><div class="co-field">Name on card</div><a class="co-btn">Pay ${money(total)}</a></div>`
    : `<div class="co-pay"><h4>Identity check</h4><div class="co-field">Upload a photo ID</div><div class="co-field">Take a selfie</div><a class="co-btn">Run the check now</a></div>`;
  const remedy = S.vertical === 'retail'
    ? `<div class="co-bnpl"><span class="chip">New · for you</span><h4>Pay in 4 — interest-free</h4><div class="terms">4 payments of <b>${money(Math.round((total || 0) / 4))}</b> · 0% APR · nothing extra</div><div class="proof">★★★★★ 4,200 Gen-Z shoppers chose installments this month</div><div class="alt">○ Pay ${money(total)} in full</div><a class="co-btn">Pay in 4 — place order</a></div>`
    : `<div class="co-bnpl"><span class="chip">New · for you</span><h4>Save your place — finish by link</h4><div class="terms">We text you a link; the identity check runs when you are ready, on any device.</div><div class="proof">★★★★★ Most applicants finish within the hour</div><a class="co-btn">Send me the link</a></div>`;
  $('co-body').innerHTML = lines + (fix ? remedy : control)
    + `<div class="co-foot">${fix ? `Served by the experiment <b>${escapeHtml(fix.flagKey || '')}</b> to <b>${escapeHtml(fix.audienceNoun || 'the cohort')}</b> — real flag, real audience; this session is in the treatment.` : 'The control. Launch the fix in Revenue Radar, then open this again.'}</div>`;
  openMoment('checkout');
  consequence('Checkout', fix ? 'The fix is live for that shopper, in-session' : 'The control payment step', fix ? `${fix.remedy} — served by ${fix.flagKey}.` : 'A plain card form. Nothing has been fixed yet.');
}
$('co-close').onclick = () => $('checkout').classList.remove('open');
$('btn-checkout').onclick = () => openCheckout();

function paintLaunched(r) {
  const out = $('rad-out'); if (!out || !r) return;
  const targeted = r.audience
    ? `Targeted at <b>${escapeHtml(r.audience.name)}</b> — real Optimizely audience <code>${r.audience.id}</code>, ${r.audience.created ? 'created just now' : 'already there and reused'}.`
    : '<span class="refuse">No audience was attached — this rule runs on everyone.</span>';
  out.innerHTML = `⚡ <b>Experiment live</b> — <b>${escapeHtml(r.flagKey)}</b> · ${r.variations.join(' vs ')} · ${escapeHtml(r.environment)} · ${r.ms}ms<br>${targeted}<br>`
    + `<span style="color:var(--p-dim)">The diagnosis is computed from simulated traffic. The audience and the experiment are real objects in a real project.</span>`;
}

/**
 * The diagnosis is arithmetic over simulated rows; the audience and the
 * experiment it creates are real objects in a real project. Saying which is
 * which is the entire reason this beat is credible.
 */
async function launchFix(btn) {
  const d = RAD.data;
  btn.disabled = true; btn.textContent = 'creating…';
  const cohortKeys = Array.isArray(d.cohort) ? d.cohort : (d.cohortKeys || (isAll(d.cohort) ? [] : [{ dim: 'cohort', value: String(d.cohort) }]));
  const r = await fetch(`${API}/experiment/dispatch`, {
    method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ vertical: S.vertical, source: 'radar', flavour: 'ab', cohort: cohortKeys }),
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
  RAD.launched = { cohort: d.cohort ?? RAD.cohort, r };
  S.fixLive = { flagKey: r.flagKey, remedy: d.recoverable?.remedy, audienceNoun: d.recoverable?.audienceNoun || d.cohortLabel };
  paintLaunched(r);
  consequence('Revenue Radar', 'Fix launched as a real experiment',
    `${r.flagKey} targeted at ${d.cohortLabel}. Diagnosis representative, experiment live.`);
  // PROVE IT: the funnel recovers, then the payment step changes in-session.
  await proveFix();
}

// ── THE EXPERIMENT CARD: Opal doing it, on the page ──────────────────────────
// Steps stream in, the real flag and rule land with their ids, then the readout.
// The rule is REAL (A/B, MAB and CMAB are all validated live on the API). No
// traffic reaches it in a conference room, so the allocation and the winner are
// REPRESENTATIVE, labelled on the card, and they move on the demo clock — "let
// two minutes pass" advances the bandit; nothing moves while the presenter talks.
const XP = { open: false, flavour: null, r: null, startedAt: 0, windowMin: 0, arms: [], moment: null, closedAt: null };
const MAB_ROUNDS_2 = [[50, 50], [40, 60], [27, 73], [20, 80]];
const MAB_ROUNDS_3 = [[33, 34, 33], [22, 54, 24], [15, 65, 20], [11, 73, 16]];
const ROUND_MS = 120_000;                      // one round per "two minutes pass"
const mmss2 = (ms) => { const t = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };

function xpStep(text, state = 'done') {
  const li = document.createElement('li'); li.className = state; li.innerHTML = text; $('xc-steps').appendChild(li);
  return li;
}
function openXpCard(flavour, title) {
  Object.assign(XP, { open: true, flavour, r: null, startedAt: NOW(), windowMin: 0, arms: [], moment: null, closedAt: null });
  $('xc-title').textContent = title;
  $('xc-state').textContent = 'running…'; $('xc-state').hidden = false;
  $('xc-badge').hidden = true; $('xc-clock').hidden = true;
  $('xc-steps').innerHTML = ''; $('xc-rows').hidden = true; $('xc-readout').hidden = true; $('xc-foot').hidden = true;
  applyHighlight($('xcard'));
  $('xcard').hidden = false;
  $('xcard').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
function xpBadge(r) {
  const b = $('xc-badge'); b.hidden = false;
  if (!r) { b.textContent = 'unreachable'; b.className = 'xc-badge sim'; return; }
  if (r.simulated) { b.textContent = 'writes off'; b.className = 'xc-badge off'; return; }
  if (!r.ok) { b.textContent = 'refused'; b.className = 'xc-badge sim'; return; }
  b.textContent = r.created ? 'live · created now' : 'live · reused'; b.className = 'xc-badge';
}
const RULE_TYPE_NAME = { ab: 'a/b', mab: 'multi_armed_bandit', cmab: 'contextual_multi_armed_bandit' };
function xpRows(r, flavour) {
  const rows = [];
  if (r?.flagKey) rows.push(['Flag', r.flagKey]);
  rows.push(['Rule', `${r?.ruleKey ? r.ruleKey + ' · ' : ''}${RULE_TYPE_NAME[flavour]}`]);
  if (r?.variations?.length) rows.push(['Variations', r.variations.join(' · ')]);
  if (r?.environment) rows.push(['Environment', r.environment]);
  if (r?.projectId) rows.push(['Project', r.projectId]);
  if (r?.audience) rows.push(['Audience', `${r.audience.name} · #${r.audience.id}`]);
  if (r?.ms != null) rows.push(['API', `${r.ms}ms`]);
  if (r?.reason) rows.push(['Note', r.reason]);
  $('xc-rows').innerHTML = rows.map(([k, v]) => `<div><span>${k}</span><b>${escapeHtml(String(v))}</b></div>`).join('')
    + (r?.consoleUrl ? `<div><span>Optimizely</span><b><a href="${r.consoleUrl}" target="_blank" rel="noopener">Open it now →</a></b></div>` : '');
  $('xc-rows').hidden = false;
}
const ARM_NAME = {
  affinity_led: 'Affinity leads the hero', campaign_pinned: 'Campaign pins the hero',
  wallet_first: 'Wallet payment first (current)', saved_card_first: 'Saved card first, wallet alternate',
  verify_inline: 'Identity check inline (current)', resume_by_link: 'Resume-by-link before the check',
};
function xpArmNames(r) {
  const names = (r?.variations?.length ? r.variations : ['affinity_led', 'campaign_pinned']).map((k) => ARM_NAME[k] || k);
  if (XP.moment && names.length >= 2) names[1] = `${names[1]} — “${XP.moment.headline}”`;
  return names;
}
/** The readout, re-rendered by the master tick: it moves only as demo time moves. */
function renderXp() {
  if (!XP.open || !XP.arms.length) return;
  const el = $('xc-readout'); el.hidden = false;
  const elapsed = NOW() - XP.startedAt;
  if (XP.flavour === 'ab') {
    const rates = [3.1, 4.6];
    el.innerHTML = `<div class="xc-ro-h">A/B · two arms, fixed split<span>REPRESENTATIVE figures · the rule is real</span></div>`
      + XP.arms.map((n, i) => `<div class="xc-arm ${i === 1 ? 'win' : ''}"><div class="xc-arm-top"><span>${i === 0 ? 'Control' : 'Treatment'} · <b>${escapeHtml(n)}</b>${i === 1 ? '<span class="xc-win">leads</span>' : ''}</span><span class="n">${(rates[i] ?? 3.1).toFixed(1)}%</span></div><div class="xc-track"><i style="width:${(rates[i] ?? 3.1) / 6 * 100}%"></i></div></div>`).join('')
      + `<div class="xc-foot" style="padding:8px 0 0;border:0">+48% for the treatment · 96% confidence — <b>illustrative</b>; the split is 50/50 and real.</div>`;
    return;
  }
  if (XP.flavour === 'mab') {
    const table = XP.arms.length >= 3 ? MAB_ROUNDS_3 : MAB_ROUNDS_2;
    const round = Math.min(table.length - 1, Math.floor(elapsed / ROUND_MS));
    const alloc = table[round]; const winner = alloc.indexOf(Math.max(...alloc));
    const closed = round === table.length - 1;
    if (closed && XP.closedAt == null) XP.closedAt = elapsed;
    const windowMs = XP.windowMin * 60_000;
    if (XP.windowMin) { $('xc-clock').hidden = false; $('xc-clock').textContent = closed ? `closed ${mmss2(XP.closedAt)} of ${mmss2(windowMs)}` : mmss2(Math.max(0, windowMs - elapsed)); }
    el.innerHTML = `<div class="xc-ro-h">Multi-armed bandit · round ${round + 1} of ${table.length}<span>traffic auto-allocating to the winner · REPRESENTATIVE allocation · the rule is real · Optimizely MAB is GA</span></div>`
      + XP.arms.map((n, i) => `<div class="xc-arm ${i === winner && round > 0 ? 'win' : ''}"><div class="xc-arm-top"><span>${i === 0 ? 'Control' : 'Arm ' + (i + 1)} · <b>${escapeHtml(n)}</b>${i === winner && closed ? '<span class="xc-win">winner</span>' : ''}</span><span class="n">${alloc[i]}% of traffic</span></div><div class="xc-track"><i style="width:${alloc[i]}%"></i></div></div>`).join('')
      + (closed
        ? `<div class="xc-close">● Loop closed in ${mmss2(XP.closedAt)}${XP.windowMin ? ` of ${mmss2(windowMs)}` : ''} — <b>${escapeHtml(XP.arms[winner])}</b> promoted to ${alloc[winner]}% of traffic automatically.<small>Today the loop closes with a human Launch click (governance). Autonomy is roadmap. · Representative allocation · Optimizely MAB is GA · the multi_armed_bandit rule is real.</small></div>`
        : `<div class="xc-foot" style="padding:8px 0 0;border:0">Each “Let two minutes pass” is a round. Round ${round + 1} — ${round === 0 ? 'even split, learning' : `traffic shifting to <b>${escapeHtml(XP.arms[winner])}</b>`}.</div>`);
    return;
  }
  if (XP.flavour === 'cmab') {
    const ctx = [
      { c: 'Mobile · first visit', w: 1, lift: '+31%', conf: 93 },
      { c: 'Desktop · returning', w: 0, lift: '+12%', conf: 91 },
      { c: 'Premium band · heritage', w: 0, lift: '+19%', conf: 90 },
      { c: 'Gen-Z · mobile · at payment', w: 1, lift: '+27%', conf: 94 },
    ];
    el.innerHTML = `<div class="xc-ro-h">Contextual bandit · a winner per context<span>REPRESENTATIVE winners · the contextual_multi_armed_bandit rule is real · attributes: device · persona · journey_stage</span></div>`
      + ctx.map((x) => `<div class="xc-ctx"><span class="c">${x.c}</span><span><b>${escapeHtml(XP.arms[Math.min(x.w, XP.arms.length - 1)])}</b><span class="xc-win">winner</span></span><span class="l">${x.lift} · ${x.conf}% conf.</span></div>`).join('')
      + `<div class="xc-foot" style="padding:8px 0 0;border:0">One experiment, many winners — chosen by context in real time. A CMAB rule may land as a draft that needs review; the badge says which.</div>`;
  }
}

/** Create A/B, MAB or CMAB — Opal doing it, visibly, and for real. */
async function dispatchExperiment(flavour, btn, opts = {}) {
  if (XP.open && !$('xc-state').hidden) return;
  const label = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; btn.textContent = 'Opal is creating…'; }
  openXpCard(flavour, `${FLAVOUR_NAME[flavour]} — ${opts.title || (S.vertical === 'retail' ? 'the hero strategy' : 'the offer strategy')}`);
  XP.moment = opts.moment || null; XP.windowMin = opts.windowMin || 0;
  const snap = snapshot(S.reflex, NOW(), S.config);
  const lead = Object.entries(snap.dims || {}).flatMap(([d, vs]) => Object.entries(vs).map(([v, a]) => ({ d, v, a }))).sort((x, y) => y.a - x.a)[0];
  xpStep(`Reading the signal — ${opts.moment ? `<b>${escapeHtml(opts.moment.signal.source)}</b>: ${escapeHtml(opts.moment.signal.subject)} (simulated, labelled)` : lead && lead.a > 0.01 ? `her live affinity leads on <b>${escapeHtml(lead.d)} · ${escapeHtml(lead.v)}</b> at ${lead.a.toFixed(2)}` : 'no behaviour yet — the test starts from the standard order'}`);
  await sleep(650);
  xpStep(`Drafting the variants — <b>control</b> vs the strategy to test${opts.moment ? ` · copy: “${escapeHtml(opts.moment.headline)}”` : ''}`);
  await sleep(650);
  const creating = xpStep(`Creating the flag and the <b>${RULE_TYPE_NAME[flavour]}</b> rule in the real project — API call in flight…`, 'pending');
  const r = await fetch(`${API}/experiment/dispatch`, {
    method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ vertical: S.vertical, source: opts.source || 'tiktok', flavour }),
  }).then((x) => x.json()).catch(() => null);
  if (btn) { btn.disabled = false; btn.innerHTML = label; }
  XP.r = r;
  creating.className = r?.ok && !r.simulated ? 'done' : 'pending';
  creating.innerHTML = !r ? 'The dispatch never reached the worker — nothing was created.'
    : r.simulated ? `Nothing written — <b>${escapeHtml(r.reason || 'writes are off')}</b>. Would have created ${escapeHtml(r.flagKey || 'the flag')}.`
    : !r.ok ? `Refused by the API — <b>${escapeHtml(r.reason || 'see note')}</b>. Not downgraded to a rollout: a rollout is not a test.`
    : `${r.created ? 'Created' : 'Found live and reused'} — flag <b>${escapeHtml(r.flagKey)}</b>, rule <b>${escapeHtml(r.ruleKey || '')}</b> in <b>${escapeHtml(r.environment || '')}</b> · ${r.ms ?? '—'}ms`;
  xpBadge(r); xpRows(r, flavour);
  if (r?.ok && !r.simulated) capDone({ ab: 11, mab: 12, cmab: 13 }[flavour]);
  $('xc-state').hidden = true;
  XP.arms = xpArmNames(r);
  XP.startedAt = NOW();
  renderXp();
  $('xc-foot').hidden = false;
  $('xc-foot').innerHTML = r?.ok && !r.simulated
    ? `<b>Real:</b> the flag, the rule and its type in the Optimizely project — open it now. <b>Representative:</b> the figures on the readout; no traffic reaches this rule in this room.`
    : `<b>Nothing was written.</b> The readout is what the rule would show — representative, and labelled.`;
  consequence(FLAVOUR_NAME[flavour],
    !r ? 'Dispatch never reached the worker' : r.simulated ? `Nothing written — ${r.reason}` : !r.ok ? `Refused — ${r.reason}` : (r.created ? 'Created in Optimizely just now' : 'Already live — reused, not recreated'),
    r?.ok && !r.simulated ? `${r.flagKey} · ${r.variations.join(' vs ')} · ${r.environment} · ${r.ms}ms. Real rule, real project; readout representative.` : (r?.reason || 'Nothing was created.'));
  $('sentence').textContent = r?.ok && !r.simulated
    ? `${FLAVOUR_NAME[flavour]} rule live in the real project — open Optimizely and it is there. The allocation on the card is representative: no traffic reaches it in this room.`
    : `${FLAVOUR_NAME[flavour]}: nothing was written${r?.reason ? ` — ${r.reason}` : ''}.`;
  S.sayLockUntil = Date.now() + 6000;
  return r;
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
  if (window.MOMENTS) window.MOMENTS.setVertical(v);
  $('sentence').textContent = 'Same engine. Same eight dimensions. Different vocabulary.';
}
$('btn-retail').onclick = () => setVertical('retail');
$('btn-financial').onclick = () => setVertical('financial');
$('btn-return').onclick = () => location.reload();   // same id, same object, same profile
/** A new demo starts clean: both strips gone, their clocks zeroed. */
function hideStrips() {
  STRIP_UNTIL = 0; OSTRIP_UNTIL = 0;
  $('strip').hidden = true; $('ostrip').hidden = true;
  XP.open = false; XP.arms = []; $('xcard').hidden = true;
  S.fixLive = null; RAD.launched = null; RAD.recovered = null;
  resetCaps();
}
$('btn-reset').onclick = async () => {
  hideStrips();                                    // the last session's banners are not this session's
  await post('/reset', {}); S.seq = -1;
  await load(S.vertical); connect();
  clearBaseline(); $('btn-capture').classList.remove('on'); DONE.length = 0;
  $('btn-capture').innerHTML = 'Capture baseline<small>freeze the page now</small>';
  $('takeover').hidden = true; $('hero').style.display = '';
};

// Reflex moments: Coach's six stories, the hold, the honest countdowns.
window.MOMENTS = initMoments({
  mount: $('moments'),
  vertical: S.vertical,
  getNow: NOW,                      // the hold's 15:00 freezes while you talk
  prettyAudience,
  onCta: () => { $('page').scrollTo({ top: 0, behavior: 'smooth' }); },
  expiryOf: (key, ctx) => (ctx?.dim && ctx?.value) ? expiryOf(S.reflex, ctx.dim, ctx.value, S.config) : null,
});

renderCaps();
if (new URLSearchParams(location.search).has('debug')) { window.__S = S; window.__goBeat = goBeat; }
paintPinButton();
// One click to start, and it survives the reload that beat 22 performs.
// The director is on by default: it holds the transport AND the palette now.
if (!new URLSearchParams(location.search).has('nodirector')) queueMicrotask(openDirector);  // rehearsal introspection only
await load('retail');
connect();

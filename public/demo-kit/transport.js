// public/demo-kit/transport.js: the demo kit's transport, the page's only way to the engine.
//
// Every request a demo page makes leaves through one of three doors, and only these (the
// request-level suite counts them in the page's source, so no other module may open a fourth):
//   api          the engine's own routes: X-SDK-Key, X-Tenant and, on a shopper call, her capability
//   demoRoute    the demo's named routes (beat, reset, receipt, report): X-Tenant, and no document from the page
//   tryJson      the page's own static documents, by a path the page names
// A merchandiser beat is applied BY NAME by the worker (the demo profile's closed list); the page holds no
// operator credential and sends none.
//
// It also holds the visitors (her session first, then her explicit consent), the events (sent because a
// real control ran), the question (one snapshot per page view, carrying the landing entry and the asserted
// context), the receipts (the full record behind a decision, from the demo's receipt route) and, behind a
// flag, the engine's own push over the socket.
//
// createTransport(kit) reads from the kit's config:
//   tenant              the demo's tenant: X-Tenant on every call, and the path of its own routes
//   api                 { beat, reset, receipt, report, coldstart }: the demo routes, by path
//   pageNames           page key → the engine's page name, for the snapshot
//   source              events.source (configure({ source }) changes it once the vertical's documents say)
//   docBase             the prefix a document's source label drops ('/vantage/' → 'phones.json')
//   defaultIntent()     the answer asserted on every snapshot as ctx.intent when the visitor has given none
//   visitor()           the vertical's own fields on a new visitor (her lines, her cart, ...)
//   beatName(key, kind) the opening documents, for a reset where the reset route is absent
//   fixtures            { api(path, payload, opts), receipts(ids) }: the ?fixtures flag's canned answers
// No DOM or window access at import time.
import { arr, sleep, uid } from './util.js';

export function createTransport(k) {
  const cfg = k.config, state = k.state, flags = k.flags;
  const TENANT = cfg.tenant;
  const API = cfg.api || {};
  let SOURCE = cfg.source || `${TENANT}-demo`;
  let sdkKeyValue = null;
  /** The site key. Not a secret: it names the SITE, the way an SDK key does. */
  const sdkKey = () => sdkKeyValue || (sdkKeyValue = ((document.querySelector('meta[name="edge-sdk-key"]') || {}).content) || 'demo-site');
  /** Under local wrangler dev, request.cf is the runtime's stand-in, not an edge's reading of the request; the panel says so. */
  const localRuntime = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname) || /\.localhost$/.test(location.hostname);

  // ── The three doors ─────────────────────────────────────────────────────
  const cur = () => (state.who ? state.visitors[state.who] : null);
  async function api(path, payload, opts = {}) {
    if (flags.fixtures) return cfg.fixtures.api(path, payload, opts);
    const v = Object.prototype.hasOwnProperty.call(opts, 'visitor') ? opts.visitor : cur();
    const headers = { 'X-SDK-Key': sdkKey(), 'Content-Type': 'application/json', 'X-Tenant': TENANT };
    if (v && v.session) headers['X-Shopper-Session'] = v.session.capability;
    try {
      const res = await fetch(path, { method: payload === undefined ? 'GET' : 'POST', headers,
        ...(payload === undefined ? {} : { body: JSON.stringify(payload) }) });
      return { status: res.status, ok: res.ok, body: await res.json().catch(() => ({})) };
    } catch (error) {
      return { status: 0, ok: false, body: { error: String((error && error.message) || error) } };
    }
  }
  /** The demo route: a named beat, applied by the worker. No document crosses from the page. */
  async function demoRoute(path, body) {
    if (flags.fixtures) { await sleep(120); return { ok: true }; }
    const res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json', 'X-Tenant': TENANT }, body: JSON.stringify(body || {}) })
      .catch((e) => ({ ok: false, status: 0, json: async () => ({ error: e.message }) }));
    const out = await res.json().catch(() => null);
    if (!res.ok || !out || out.ok !== true) {
      // The route's own answer rides on the error, so a named refusal (the report's 413) can be shown as itself.
      const error = new Error((out && out.error) || `${path} failed (${res.status})`);
      error.status = res.status; error.body = out;
      throw error;
    }
    return out;
  }
  /** One of the page's own documents, or null: a static host's HTML fallback is not a document. */
  async function tryJson(url) {
    try {
      const r = await fetch(url, { cache: 'no-store' });
      if (!r.ok) return null;
      const type = r.headers.get('content-type') || '';
      if (type && !/json/.test(type)) return null;
      return await r.json();
    } catch { return null; }
  }
  /** The first of `urls` that answers, recorded under `label` in state.sources (the boot line names what it read). */
  async function firstJson(label, urls) {
    for (const url of urls) {
      const doc = await tryJson(url);
      if (doc) { state.sources[label] = cfg.docBase ? url.replace(cfg.docBase, '') : url; return doc; }
    }
    state.sources[label] = 'missing';
    return null;
  }
  /** A beat file wraps the engine document it publishes: { name, kind: 'publish', publish: { kind, document } }. */
  const unwrap = (doc) => (doc && doc.publish && doc.publish.document ? doc.publish.document : doc);
  const applyBeat = (kind, name, note) => {
    if (!name) throw new Error(`no ${kind} document is named for this beat`);
    return demoRoute(API.beat, { kind, name, note });
  };
  async function resetTenant() {
    try { return await demoRoute(API.reset, {}); } catch (error) {
      if (!/404|Not Found/i.test(String(error.message))) throw error;
      await applyBeat('slots', cfg.beatName('open', 'slots'), 'the opening slots');
      return applyBeat('catalog', cfg.beatName('open', 'catalog'), 'the opening pool');
    }
  }

  // ── Visitors: session first, then her explicit consent ─────────────────
  /** The landing's arrival signals: exactly the fields the engine's entry contract names. */
  function landingEntry(params) {
    const q = params || new URLSearchParams(location.search);
    const entry = {};
    const source = q.get('utm_source'), medium = q.get('utm_medium'), term = q.get('utm_term');
    if (source) entry.utmSource = source.slice(0, 256);
    if (medium) entry.utmMedium = medium.slice(0, 128);
    if (term) entry.utmTerm = term.slice(0, 256);
    const referrer = (params && params.get('referrer')) || document.referrer || '';
    if (referrer) { entry.referrer = referrer; entry.siteHost = location.host; }
    return entry;
  }
  const directEntry = () => ({});
  /** Snapshot URLs carry a host-only referrer, never a path or query (src/services/visit.ts snapshotEntry). */
  function snapshotEntry(entry) {
    if (!entry || !Object.keys(entry).length) return null;
    const out = { ...entry };
    if (out.referrer) { try { out.referrer = new URL(out.referrer).hostname; } catch { out.referrer = ''; } }
    return JSON.stringify(out);
  }
  function describeEntry(entry) {
    if (!entry || (!entry.utmMedium && !entry.utmSource && !entry.utmTerm && !entry.referrer)) return 'arrived direct';
    return [entry.utmMedium, entry.utmSource, entry.utmTerm && `term “${entry.utmTerm}”`].filter(Boolean).join(' · ');
  }
  const defaultIntent = () => (cfg.defaultIntent ? cfg.defaultIntent() : null);

  async function mintVisitor(key, entry, label) {
    const { status, body } = await api(`/v1/${TENANT}/identity/session`, {}, { visitor: null });
    if (!body || !body.session) throw new Error(`the engine did not mint a shopper session (${status}${body && body.error ? `: ${body.error}` : ''})`);
    const s = body.session;
    const v = { key, label: label || `Shopper ${key}`, session: s, entry, journey: [], ...(cfg.visitor ? cfg.visitor() : {}),
      intent: defaultIntent(), vector: {} };
    const { body: pref } = await api('/realtime/session/preferences', {
      userId: s.subject, trackingConsent: true, personalizationEnabled: true,
      choice: { id: uid(), expectedRevision: null, grantId: s.grantId, iat: s.iat, exp: s.exp },
    }, { visitor: v });
    if (!pref || !pref.consent || !pref.consent.personalization) throw new Error('the visitor did not grant consent');
    state.visitors[key] = v;
    return v;
  }
  function useVisitor(key) {
    state.who = key;
    const v = cur();
    state.lastVector = (v && v.vector) || {};
    k.panels.renderWho();
    k.panels.renderJourney();
  }
  /** Any press or any hand on the page mints a visitor if none exists: nothing waits on the first beat. */
  async function ensureVisitor() {
    if (cur()) return cur();
    const v = await mintVisitor('A', landingEntry());
    useVisitor('A');
    k.panels.note('arrived', 'A new visitor', `anonymous · consent granted · ${describeEntry(v.entry)}`);
    return v;
  }

  // ── The events. Sent BECAUSE a real control ran. ─────────────────────────
  function send(type, data, v = cur()) {
    if (!v) return Promise.resolve(null);
    return api('/realtime/action', { userId: v.session.subject, sessionId: v.session.sessionId, source: SOURCE, type, data,
      ...(v.entry && Object.keys(v.entry).length ? { entry: v.entry } : {}) }, { visitor: v });
  }
  /**
   * A selector, a compare, a filter or a start: a custom event, named by its
   * event field (the engine reads it to weigh the touch) with the control that
   * sent it.
   */
  const sendCustom = (event, data, v) => send('custom', { event, ...data }, v);
  /** A click inside a decided container is the reward it is judged on; nested containers credit each level, as nested data-op-content would. */
  async function creditDecided(target) {
    if (!cur() || !target || !target.closest) return 0;
    let node = target.closest('[data-op-content]');
    const sends = [];
    while (node) {
      const decisionId = node.getAttribute('data-op-decision-id');
      if (decisionId) sends.push(send('content_click', { contentId: node.getAttribute('data-op-content'), slot: node.getAttribute('data-op-slot'), decisionId, customerContentId: node.getAttribute('data-cid') }));
      node = node.parentElement ? node.parentElement.closest('[data-op-content]') : null;
    }
    if (sends.length) await Promise.all(sends);
    return sends.length;
  }

  // ── The question. One snapshot per page view; the page renders what it says. ──
  async function ask(pageKey, v = cur()) {
    const q = new URLSearchParams({ page: (cfg.pageNames || {})[pageKey] || pageKey });
    const entry = snapshotEntry(v && v.entry);
    if (entry) q.set('entry', entry);
    if (state.ctx.region) q.set('ctx.region', state.ctx.region);
    const intent = (v && v.intent) || defaultIntent();
    if (intent) q.set('ctx.intent', intent);   // asserted on every snapshot: gated offers fail closed without it
    const r = await api(`/v1/${TENANT}/decisions/snapshot?${q}`, undefined, { visitor: v });
    if (!r.ok || !r.body || !Array.isArray(r.body.decisions)) {
      return { ok: false, status: r.status, error: (r.body && r.body.error) || `the decision service answered ${r.status || 'nothing'}` };
    }
    return { ok: true, set: { ...r.body, asked: { intent: q.get('ctx.intent'), region: q.get('ctx.region') } } };
  }
  const bySlot = (set, slot) => ((set && set.decisions) || []).filter((d) => d.slot === slot).sort((a, b) => a.order - b.order);

  // ── Receipts: the full record behind a decision, from the demo's receipt route ──
  /**
   * The ledger consumer writes a record a few seconds after the answer, so the
   * route answers 202 and pending until then, and the page asks again. It tells
   * the route what it asserted on that snapshot (intent, region), so the record
   * can say which of its inputs were asserted rather than observed.
   */
  async function prefetchReceipts(decisions, asked) {
    const ids = [...new Set(decisions.map((d) => d.decisionId).filter((id) => id && !state.receipts.has(id)))];
    const context = asked && asked.intent ? { intent: asked.intent, ...(asked.region ? { region: asked.region } : {}) } : undefined;
    const owner = cur();          // the receipts are hers: asked with her capability even if the page has moved on to another shopper
    for (let attempt = 0; attempt < 10 && ids.length; attempt += 1) {
      const batch = ids.slice(0, 12);
      const r = flags.fixtures ? cfg.fixtures.receipts(batch) : await api(API.receipt, { decisionIds: batch, ...(context ? { context } : {}) }, { visitor: owner });
      const list = (r.body && (r.body.records || r.body.receipts || (r.body.record ? [r.body.record] : r.body.receipt ? [r.body.receipt] : []))) || [];
      list.forEach((rec) => { if (rec && rec.decision_id) state.receipts.set(rec.decision_id, rec); });
      for (let i = ids.length - 1; i >= 0; i -= 1) if (state.receipts.has(ids[i])) ids.splice(i, 1);
      if (!ids.length) break;
      if (!(r.status === 202 || r.status === 200)) break;       // refused or unprovisioned: ask no more
      await sleep(2000);
    }
  }

  // ── The engine's own push, behind a flag: the alarm over /realtime/ws ────
  /** onExit(exits, v) runs when the engine itself withdraws a claim (an exit frame, or the reflex alarm). */
  function connectSocket(v, onExit) {
    if (flags.fixtures || !v || typeof WebSocket === 'undefined') return;
    try { if (state.socket) state.socket.close(); } catch { /* closing */ }
    const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/realtime/ws?tenant=${TENANT}`;
    const key = btoa(unescape(encodeURIComponent(sdkKey()))).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    let ws;
    try { ws = new WebSocket(url, ['shopper-session-v1', v.session.capability, `sdk-key-v1.${key}`]); } catch { return; }
    state.socket = ws;
    ws.onmessage = (ev) => {
      let msg; try { msg = JSON.parse(ev.data); } catch { return; }
      const data = (msg && msg.data) || {};
      const exits = arr(data.affinity && data.affinity.changed).filter((c) => c && c.direction === 'exit');
      if (msg.type === 'personalization_update' && (data.source === 'reflex_alarm' || exits.length)) void onExit(exits, v);
    };
    ws.onclose = () => { if (state.heartbeat) clearInterval(state.heartbeat); };
    ws.onopen = () => { state.heartbeat = setInterval(() => { try { if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'heartbeat' })); } catch { /* dying */ } }, 25000); };
  }

  /** Later settings, once the vertical's own documents have said them (the events' source). */
  function configure(opts = {}) { if (opts.source) SOURCE = opts.source; }

  return {
    api, demoRoute, tryJson, firstJson, unwrap, applyBeat, resetTenant,
    cur, mintVisitor, useVisitor, ensureVisitor, landingEntry, directEntry, snapshotEntry, describeEntry, defaultIntent,
    send, sendCustom, creditDecided, ask, bySlot, prefetchReceipts, connectSocket, configure,
    sdkKey, localRuntime, TENANT,
  };
}

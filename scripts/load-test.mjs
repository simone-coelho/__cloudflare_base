#!/usr/bin/env node
// scripts/load-test.mjs — shoppers per second against a live stamp, with the numbers a pilot needs.
//
// Each shopper is a new visitor: a decision request for the home page; four in ten then send a product
// view and a click on the hero they were served, the way the SDK does. The script holds the rate for
// the duration, caps what is in flight, and reports latency per request kind (p50, p95, p99, max),
// errors by status, and the rate it actually achieved. Afterwards it waits and reads what the platform
// says happened: the day report's decision count (the ledger's catch-up through the queue) and each
// slot's exposure count (the statistics objects' fan-in), so a number on the page can be compared with
// the number sent.
//
//   node scripts/load-test.mjs --base https://<stamp> --sdk-key <key> [--rps 40] [--seconds 120] [--inflight 200] [--token <operator jwt>]
//
// Without --token the report step is skipped and only the exposures are compared.
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const base = String(arg('--base', 'http://localhost:9100')).replace(/\/+$/, '');
const sdkKey = arg('--sdk-key', 'demo-site');
const scope = arg('--scope', 'coach');
const rps = Number(arg('--rps', 40));
const seconds = Number(arg('--seconds', 120));
const inflightCap = Number(arg('--inflight', 200));
const token = arg('--token', '');
const eventShare = Number(arg('--event-share', 0.4));

const site = { 'Content-Type': 'application/json', 'X-SDK-Key': sdkKey };
const runId = Date.now().toString(36);
const lat = { snapshot: [], product_view: [], content_click: [] };
const errors = {};
let inflight = 0, sent = 0, done = 0, decisionsServed = 0, eventsSent = 0, timeouts = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pct = (arr, p) => { if (!arr.length) return 0; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };

async function timed(kind, fn) {
  const t0 = performance.now();
  try {
    const res = await fn();
    lat[kind].push(performance.now() - t0);
    if (!res.ok) errors[`${kind} ${res.status}`] = (errors[`${kind} ${res.status}`] || 0) + 1;
    return res;
  } catch (e) {
    lat[kind].push(performance.now() - t0);
    const key = `${kind} ${e && e.name === 'TimeoutError' ? 'timeout' : 'network'}`;
    errors[key] = (errors[key] || 0) + 1; if (key.endsWith('timeout')) timeouts++;
    return null;
  }
}
const get = (path) => fetch(`${base}${path}`, { headers: site, signal: AbortSignal.timeout(10_000) });
const post = (path, body) => fetch(`${base}${path}`, { method: 'POST', headers: site, body: JSON.stringify(body), signal: AbortSignal.timeout(10_000) });

async function shopper(i) {
  const visitor = `load-${runId}-${i}`, session = `ls-${runId}-${i}`;
  const snap = await timed('snapshot', () => get(`/v1/${scope}/decisions/snapshot?page=home&visitorId=${visitor}&sessionId=${session}&channel=load`));
  let hero = null;
  if (snap && snap.ok) { try { const d = await snap.json(); decisionsServed += (d.records || []).length; hero = (d.decisions || []).find((x) => x.slot === 'chero') || null; } catch { /* counted as served 0 */ } }
  if (Math.random() < eventShare) {
    const r1 = await timed('product_view', () => post('/realtime/action', { type: 'product_view', userId: visitor, sessionId: session, source: 'load-test', data: { productId: 'COA-CH857', name: 'Tabby Shoulder Bag 26', price: 475 }, timestamp: Date.now() }));
    if (r1 && r1.ok) eventsSent++;
    if (hero) {
      const r2 = await timed('content_click', () => post('/realtime/action', { type: 'content_click', userId: visitor, sessionId: session, source: 'load-test', data: { contentId: hero.contentId, slot: 'chero' }, timestamp: Date.now() }));
      if (r2 && r2.ok) eventsSent++;
    }
  }
}

async function exposures() {
  const out = {};
  for (const slot of ['merch', 'chero', 'story', 'carousel']) {
    try { const d = await (await get(`/v1/${scope}/lift?slot=${slot}`)).json(); out[slot] = d.snapshot ? { events: d.snapshot.events, version: d.snapshot.version } : null; } catch { out[slot] = null; }
  }
  return out;
}
async function reportCount() {
  if (!token) return null;
  try {
    const r = await fetch(`${base}/v1/${scope}/learn/report`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ date: new Date().toISOString().slice(0, 10) }) });
    const d = await r.json(); return d.report ? d.report.counts : null;
  } catch { return null; }
}

console.log(`load test ${runId}: ${rps} shoppers/s for ${seconds}s against ${base} (in flight ≤ ${inflightCap}, ${Math.round(eventShare * 100)}% send events)`);
const before = await exposures();
const reportBefore = await reportCount();
const started = performance.now();
let i = 0;
const tick = 1000 / rps;
let next = started;
while (performance.now() - started < seconds * 1000) {
  const now = performance.now();
  if (now >= next) {
    if (inflight < inflightCap) {
      inflight++; sent++;
      shopper(i++).finally(() => { inflight--; done++; });
    } else { errors['shed (in-flight cap)'] = (errors['shed (in-flight cap)'] || 0) + 1; }
    next += tick;
  } else await sleep(Math.min(5, next - now));
  if (sent % (rps * 10) === 0 && sent) { /* progress every ten seconds of load */ }
}
const loadMs = performance.now() - started;
while (inflight > 0) await sleep(50);
const wallMs = performance.now() - started;

const row = (kind) => { const a = lat[kind]; return `${kind.padEnd(14)} ${String(a.length).padStart(6)}  p50 ${Math.round(pct(a, 0.5)).toString().padStart(5)} ms  p95 ${Math.round(pct(a, 0.95)).toString().padStart(5)} ms  p99 ${Math.round(pct(a, 0.99)).toString().padStart(5)} ms  max ${Math.round(Math.max(0, ...a)).toString().padStart(6)} ms`; };
console.log(`\nsent ${sent} shoppers in ${(loadMs / 1000).toFixed(1)}s (${(sent / (loadMs / 1000)).toFixed(1)}/s achieved); all answered ${(wallMs / 1000).toFixed(1)}s after the start`);
console.log(`decisions served ${decisionsServed}, events accepted ${eventsSent}`);
console.log(row('snapshot')); console.log(row('product_view')); console.log(row('content_click'));
console.log('errors:', Object.keys(errors).length ? errors : 'none');

console.log('\nwaiting 45 s for the queue to drain and the statistics objects to publish');
await sleep(45_000);
const after = await exposures();
for (const slot of Object.keys(after)) {
  const b = before[slot]?.events ?? 0, a = after[slot]?.events ?? 0;
  console.log(`exposures ${slot.padEnd(9)} before ${String(b).padStart(7)}  after ${String(a).padStart(7)}  gained ${String(a - b).padStart(6)}`);
}
if (token) {
  let counts = null;
  for (let t = 0; t < 8; t++) { counts = await reportCount(); if (counts && reportBefore && counts.decisions - reportBefore.decisions >= decisionsServed * 0.98) break; await sleep(15_000); }
  if (counts && reportBefore) console.log(`ledger (day report): decisions ${reportBefore.decisions} → ${counts.decisions} (+${counts.decisions - reportBefore.decisions} of ${decisionsServed} served), outcomes ${reportBefore.outcomes} → ${counts.outcomes} (+${counts.outcomes - reportBefore.outcomes} of ${eventsSent} accepted, of which clicks are outcomes)${counts.truncated ? ' TRUNCATED at the report cap' : ''}`);
  else console.log('ledger: the report could not be read');
}

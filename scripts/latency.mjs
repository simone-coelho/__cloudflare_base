#!/usr/bin/env node
// scripts/latency.mjs
// ---------------------------------------------------------------------------
// CW35 (BTIE D12). P50, P95 and P99 for the three routes a shopper's page waits
// on: the decision snapshot, the event, and the sort. Measured, never estimated
// -- no number from this repo is quoted before it has come out of this script.
//
//   node scripts/latency.mjs <host> [--tenant coach] [--n 60]
//                            [--key <site key>] [--token <operator JWT>]
//
// WHAT IT MEASURES. Wall clock at the caller, which is what a shopper's browser
// actually experiences, and beside it the worker's own Server-Timing, which is
// the part the platform is answerable for. The gap between them is network and
// TLS from wherever this ran, so the report says where it ran from and never
// folds the two together.
//
// TWO POPULATIONS, ALWAYS BOTH. A shopper the platform has never seen pays for
// her session being created (a KV write on the request path, half a second or
// more from a Worker); the same shopper a minute later reads from KV's edge
// cache and pays milliseconds. They differ by more than an order of magnitude,
// so ONE number for "the snapshot" is not an answer -- doc 31's load test read
// 632 ms measuring only new visitors, and the first run of this script read
// 44 ms measuring only a returning one. Both were right. Every route is
// therefore measured twice and both rows are printed.
//
// WHAT IT DOES NOT MEASURE. A cold start. The first calls to each route are
// thrown away (see WARMUP), because the number that matters to a shopper is the
// steady state of a worker under traffic; a cold start is real but it is a
// different number and quoting one as the other would be dishonest.
//
// CREDENTIALS. /realtime/action and /v1/:tenant/* sit behind the site key when
// AUTH_MODE is enforced. An operator token passes the same gate (CW22), so
// either --key or --token works. /sort is not gated and needs neither, so a run
// with no credential still reports one of the three rather than nothing.
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const host = (args[0] || '').replace(/\/+$/, '');
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
if (!host || host.startsWith('--')) {
  console.error('Usage: node scripts/latency.mjs <host> [--tenant coach] [--n 60] [--key <site key>] [--token <jwt>]');
  process.exit(1);
}
const tenant = opt('tenant', 'coach');
const N = Math.max(5, Number(opt('n', 60)) || 60);
const key = opt('key', '');
const token = opt('token', '');
const WARMUP = 5;

const cred = { ...(key ? { 'X-SDK-Key': key } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) };
const returning = `lat-r-${Date.now().toString(36)}`;
let n = 0;
/** A shopper the platform has never seen, once per call. */
const freshVisitor = () => `lat-n-${Date.now().toString(36)}-${n++}`;

/** One request, timed at the caller, with the worker's own timing read back off the header. */
async function once(route, visitor) {
  const started = performance.now();
  let res, body = '';
  try {
    res = await fetch(host + route.path(visitor), {
      method: route.method,
      headers: { 'content-type': 'application/json', ...cred, ...(route.headers || {}) },
      ...(route.body ? { body: JSON.stringify(route.body(visitor)) } : {}),
    });
    body = await res.text();
  } catch (e) {
    return { ok: false, ms: performance.now() - started, status: 0, why: e.message };
  }
  const ms = performance.now() - started;
  // Server-Timing carries NAMED entries: the route's own stages, and a `total`
  // that a middleware adds for the whole request. Summing everything counts the
  // request twice, which is how the first run of this script reported a worker
  // slower than the caller waiting on it -- an impossibility, and exactly the
  // kind of number that must never reach a customer. `total` wins when it is
  // there; the stages are kept separately, because where the time goes inside
  // the engine is the more useful half of the answer.
  const st = res.headers.get('server-timing') || '';
  const entries = {};
  for (const m of st.matchAll(/([A-Za-z_][\w-]*)\s*;\s*dur=([\d.]+)/g)) entries[m[1]] = Number(m[2]);
  const stages = Object.fromEntries(Object.entries(entries).filter(([k]) => k !== 'total'));
  const server = 'total' in entries
    ? entries.total
    : (Object.keys(stages).length ? Object.values(stages).reduce((a, b) => a + b, 0) : null);
  return { ok: res.ok, ms, status: res.status, server, stages, why: res.ok ? '' : body.slice(0, 120) };
}

const pct = (sorted, p) => {
  if (!sorted.length) return null;
  // Nearest-rank on the sorted samples: no interpolation, so every number
  // printed is a request that actually happened.
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))];
};
const r1 = (x) => (x === null || x === undefined ? null : Math.round(x * 10) / 10);

const ROUTES = [
  {
    name: 'snapshot', label: 'GET /v1/:tenant/decisions/snapshot', gated: true,
    method: 'GET', path: (v) => `/v1/${tenant}/decisions/snapshot?page=home&visitorId=${v}`,
  },
  {
    name: 'action', label: 'POST /realtime/action', gated: true,
    method: 'POST', path: () => '/realtime/action',
    body: (v) => ({ userId: v, type: 'product_view', source: 'web', data: { productId: 'SKU-1' } }),
  },
  {
    name: 'sort', label: 'POST /sort', gated: false,
    method: 'POST', path: () => '/sort',
    body: (v) => ({ userId: v, candidates: Array.from({ length: 24 }, (_, i) => ({ id: `SKU-${i + 1}` })) }),
  },
];

console.log(`\nLatency, ${host}`);
console.log(`Brand ${tenant} · ${N} calls per route after ${WARMUP} warm-up calls · measured ${new Date().toISOString()}`);
console.log(`Credential: ${token ? 'operator token' : key ? 'site key' : 'none (only the ungated route can be measured)'}\n`);

const POPULATIONS = [
  { name: 'a shopper it has never seen', id: freshVisitor },
  { name: 'the same shopper, again', id: () => returning },
];

const table = [];
for (const route of ROUTES) {
 for (const pop of POPULATIONS) {
  for (let i = 0; i < WARMUP; i++) await once(route, pop.id());   // cold start, thrown away on purpose
  const runs = [];
  for (let i = 0; i < N; i++) runs.push(await once(route, pop.id()));

  const good = runs.filter((r) => r.ok);
  if (!good.length) {
    const first = runs[0];
    table.push({ route: route.label, pop: pop.name, note: `no measurement: HTTP ${first.status}${first.why ? ` ${first.why}` : ''}` });
    continue;
  }
  const wall = good.map((r) => r.ms).sort((a, b) => a - b);
  const serverSamples = good.map((r) => r.server).filter((x) => x !== null && x !== undefined).sort((a, b) => a - b);
  // The median of each named stage, so the engine's own time is accounted for
  // rather than left as one number nobody can act on.
  const names = [...new Set(good.flatMap((r) => Object.keys(r.stages || {})))];
  const byStage = names.map((name) => {
    const xs = good.map((r) => (r.stages || {})[name]).filter((x) => typeof x === 'number').sort((a, b) => a - b);
    return { name, p50: r1(pct(xs, 50)) };
  }).filter((x) => x.p50 !== null);
  table.push({
    route: route.label,
    pop: pop.name,
    n: good.length,
    failed: runs.length - good.length,
    p50: r1(pct(wall, 50)), p95: r1(pct(wall, 95)), p99: r1(pct(wall, 99)),
    serverP50: r1(pct(serverSamples, 50)), serverP99: r1(pct(serverSamples, 99)),
    byStage,
  });
 }
}

const pad = (s, w) => String(s === null || s === undefined ? '—' : s).padEnd(w);
const padL = (s, w) => String(s === null || s === undefined ? '—' : s).padStart(w);
console.log(`${pad('Route', 38)}${pad('Shopper', 30)}${padL('n', 5)}${padL('P50', 11)}${padL('P95', 11)}${padL('P99', 11)}${padL('worker P50', 12)}${padL('worker P99', 12)}`);
console.log('─'.repeat(130));
let lastRoute = '';
for (const r of table) {
  const shown = r.route === lastRoute ? '' : r.route; lastRoute = r.route;
  if (r.note) { console.log(`${pad(shown, 38)}${pad(r.pop, 30)}  ${r.note}`); continue; }
  console.log(`${pad(shown, 38)}${pad(r.pop, 30)}${padL(r.n, 5)}${padL(`${r.p50} ms`, 11)}${padL(`${r.p95} ms`, 11)}${padL(`${r.p99} ms`, 11)}${padL(r.serverP50 === null ? '—' : `${r.serverP50} ms`, 12)}${padL(r.serverP99 === null ? '—' : `${r.serverP99} ms`, 12)}`);
  if (r.byStage && r.byStage.length > 1) {
    console.log(`${' '.repeat(6)}inside the worker (P50): ${r.byStage.map((s) => `${s.name} ${s.p50} ms`).join(' · ')}`);
  }
}
console.log(`
A shopper it has never seen pays for her session being created; the same shopper again
reads from cache. Quote both rows or neither: one of them alone is not the platform's speed.

P50/P95/P99 are wall clock at the caller: the shopper's whole wait, network included.
"worker" is the route's own Server-Timing, the part inside the platform.
Measured from this machine, so the difference between the two columns is the path
to the edge from here and belongs to no one's engine. Quote the pair, never one alone.
`);

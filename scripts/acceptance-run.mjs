#!/usr/bin/env node
// scripts/acceptance-run.mjs — one shopper through the whole outcome-learning loop, on a live worker.
//
// Seeds an acceptance page on the scope (pieces and slot rules for stage, freshness, fatigue,
// diversity, stock, a revenue objective and a featured product), drives one shopper through the
// SDK's own routes (snapshot, product views, a click, a purchase), then reads back what the engine
// says about it: the receipt's itemised terms, the ring, the published lift with credits weighed by
// value, the day report, an erasure honoured at once, and a shopper who withheld consent. Every
// check asserts an exact value and the run stops on the first failure. The documents it changed
// are rolled forward to what they were. Scripted and repeatable: the transcript is the evidence.
//
//   node scripts/acceptance-run.mjs [--base http://localhost:9100] [--scope coach] [--sdk-key demo-site] [--token <jwt>]
//
// Without --token, against a localhost base, an operator token is minted from wrangler.toml's dev
// JWT settings. Against anything else, pass a token from POST /auth/login.
import { readFileSync } from 'node:fs';
import * as jose from 'jose';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const base = arg('--base', 'http://localhost:9100').replace(/\/+$/, '');
const scope = arg('--scope', 'coach');
const sdkKey = arg('--sdk-key', 'demo-site');
let token = arg('--token', '');
if (!token) {
  if (!/localhost|127\.0\.0\.1/.test(base)) { console.error('pass --token <jwt> for a non-local base'); process.exit(2); }
  const toml = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
  const v = (k) => (toml.match(new RegExp(`^${k} = "([^"]+)"`, 'm')) || [])[1];
  token = await new jose.SignJWT({ sub: 'acceptance-run', roles: ['operator'] })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setIssuer(v('JWT_ISSUER')).setAudience(v('JWT_AUDIENCE')).setExpirationTime('30m')
    .sign(new TextEncoder().encode(v('JWT_SECRET')));
}

// ── the harness ──────────────────────────────────────────────────────────────
const started = Date.now();
let checks = 0;
const log = (s) => console.log(`${String(((Date.now() - started) / 1000).toFixed(1)).padStart(6)}s  ${s}`);
class Fail extends Error {}
const check = (name, ok, detail = '') => { checks++; if (!ok) throw new Fail(`${name}${detail ? `: ${detail}` : ''}`); log(`PASS  ${name}`); };
const eq = (name, got, want) => check(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
const near = (name, got, want, tol) => check(name, typeof got === 'number' && Math.abs(got - want) <= tol, `got ${got}, want ${want} ± ${tol}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const op = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
const site = { 'Content-Type': 'application/json', 'X-SDK-Key': sdkKey };
async function call(method, path, { headers = {}, body, cookie } = {}) {
  const res = await fetch(`${base}${path}`, { method, headers: { ...headers, ...(cookie ? { Cookie: cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, json, text };
}
async function until(name, fn, { tries = 20, everyMs = 1000 } = {}) {
  for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(everyMs); }
  throw new Fail(`${name}: not true after ${tries} tries`);
}
const day = new Date().toISOString().slice(0, 10);
const runId = Date.now().toString(36);
const DAY = 86_400_000;
const iso = (ms) => new Date(ms).toISOString();

// ── the acceptance page: what the pieces and the rules are, and what they must produce ───────────
const PAGE = 'acceptance';
const piece = (id, tags, slot, extra = {}) => ({ id: `acc-${id}`, customerContentId: `ACC-${id}`, type: 'editorial', title: `Acceptance ${id}`, tags, slotTypes: [slot], lifecycle: { status: 'live' }, ...extra });
const now = Date.now();
const pieces = [
  // acc-hero, take 1, cold on affinity: the stage rule decides. exploring first in catalogue order.
  piece('h-explore', { theme: ['discover'] }, 'acc-hero', { journeyStageFit: ['exploring'] }),
  piece('h-consider', { theme: ['compare'] }, 'acc-hero', { journeyStageFit: ['considering'] }),
  // acc-fresh, take 2: freshness orders them; the one out of stock never appears.
  piece('f-new', { theme: ['fresh'] }, 'acc-fresh', { freshnessDate: iso(now - 1 * DAY) }),
  piece('f-old', { theme: ['fresh'] }, 'acc-fresh', { freshnessDate: iso(now - 40 * DAY) }),
  piece('f-undated', { theme: ['fresh'] }, 'acc-fresh'),
  piece('f-oos', { theme: ['fresh'] }, 'acc-fresh', { freshnessDate: iso(now), inStock: false }),
  // acc-rail, take 3, all dated today so each starts at the same freshness bonus: diversity and fatigue show.
  piece('r-d1', { line: ['Drover'] }, 'acc-rail', { freshnessDate: iso(now) }),
  piece('r-d2', { line: ['Drover'] }, 'acc-rail', { freshnessDate: iso(now) }),
  piece('r-t1', { line: ['Tabby'] }, 'acc-rail', { freshnessDate: iso(now) }),
  // acc-story, take 1: features a product; a purchase of that product credits it, weighed by revenue.
  piece('s-featured', { theme: ['story'] }, 'acc-story', { featuredProductIds: ['ACC-P-100'] }),
];
const slots = [
  { slot: 'acc-hero', take: 1, weights: { theme: 0.3 }, stage: { outOfStage: 0.3, inStage: 0.2 } },
  { slot: 'acc-fresh', take: 2, weights: { theme: 0.3 }, freshness: { weight: 0.2, halfLifeDays: 7 } },
  { slot: 'acc-rail', take: 3, weights: { theme: 0.3 }, freshness: { weight: 0.2, halfLifeDays: 7 }, fatigue: { weight: 0.3, windowHours: 24, cap: 3 }, diversity: { dimension: 'line', max: 1 } },
  { slot: 'acc-story', take: 1, weights: { theme: 0.3 } },
];
const learnSlots = { 'acc-hero': { reward: 'click' }, 'acc-story': { reward: 'purchase', objective: 'revenue' } };

// ── setup: the documents, merged into what the scope already has ─────────────────────────────────
const before = {};
async function setup() {
  for (const kind of ['catalog', 'slots', 'learn']) {
    const r = await call('GET', `/content/${kind}?scope=${scope}`, { headers: op });
    check(`read ${kind} document`, r.status === 200 && r.json?.document, `status ${r.status}`);
    before[kind] = { revision: r.json.revision, document: r.json.document };
  }
  const catalog = { ...before.catalog.document, pieces: [...(before.catalog.document.pieces ?? []).filter((p) => !String(p.id).startsWith('acc-')), ...pieces] };
  const slotsDoc = { ...before.slots.document, pages: { ...(before.slots.document.pages ?? {}), [PAGE]: slots } };
  const learn = { ...before.learn.document, slots: { ...(before.learn.document.slots ?? {}), ...learnSlots } };
  for (const [kind, document] of [['catalog', catalog], ['slots', slotsDoc], ['learn', learn]]) {
    const r = await call('PUT', `/content/${kind}?scope=${scope}`, { headers: op, body: { document, note: `acceptance run ${runId}` } });
    check(`write ${kind} document`, r.status === 200 && r.json?.ok, `status ${r.status} ${JSON.stringify(r.json?.errors ?? r.json?.error ?? '')}`);
    log(`      ${kind}: revision ${before[kind].revision} → ${r.json.revision}`);
  }
}
async function teardown() {
  for (const kind of ['catalog', 'slots', 'learn']) {
    const b = before[kind]; if (!b) continue;
    const r = b.revision > 0
      ? await call('POST', `/content/${kind}/rollback/${b.revision}?scope=${scope}`, { headers: op, body: {} })
      : await call('PUT', `/content/${kind}?scope=${scope}`, { headers: op, body: { document: b.document, note: `acceptance run ${runId}: restored` } });
    log(`      ${kind}: rolled forward to revision ${b.revision} as ${r.json?.revision ?? '?'}${r.json?.ok ? '' : ` (${r.status})`}`);
  }
}

// ── the shopper ──────────────────────────────────────────────────────────────────────────────────
const snapshot = (visitor, session, cookie) => call('GET', `/v1/${scope}/decisions/snapshot?page=${PAGE}&visitorId=${visitor}&sessionId=${session}&channel=acceptance`, { headers: site, cookie });
const event = (visitor, session, type, data, cookie) => call('POST', `/realtime/action`, { headers: site, cookie, body: { type, userId: visitor, sessionId: session, source: 'acceptance', data, timestamp: Date.now() } });
const rec = (set, slot, item) => set.records.find((r) => r.slot === slot && (!item || r.item_id === item));
const servedIn = (set, slot) => set.decisions.filter((d) => d.slot === slot).map((d) => d.contentId);

async function run() {
  log(`acceptance run ${runId} against ${base}, scope ${scope}, page ${PAGE}, day ${day}`);
  await setup();

  // A shopper the holdout hash puts in the personalized arm; the documents are not changed for it.
  let V = '', S = `acc-s-${runId}`, first = null;
  for (let i = 0; i < 8 && !first; i++) {
    const v = `acc-v-${runId}-${i}`;
    const r = await snapshot(v, S);
    check('snapshot answers', r.status === 200 && r.json?.ok, `status ${r.status} ${r.text.slice(0, 200)}`);
    if (r.json.arm === 'personalized') { V = v; first = r.json; } else log(`      ${v} is in the ${r.json.arm} arm; trying the next id`);
  }
  check('a personalized shopper', Boolean(first), 'eight ids in a row landed in a holdout arm');
  log(`      shopper ${V}, session ${S}, state ${first.sources.state}`);

  // 1. The first snapshot: no events yet, so the stage is unknown and the stage rule is off.
  eq('first snapshot: written, consenting', [first.write, first.sources.consent.personalized], [true, true]);
  eq('first snapshot: stage unknown before any event', first.cell.stage, 'unknown');
  eq('acc-hero: catalogue order while the stage is unknown', servedIn(first, 'acc-hero'), ['acc-h-explore']);
  check('acc-hero: no stage block while the stage is unknown', rec(first, 'acc-hero').explain.stage === undefined);
  eq('acc-fresh: newest first, the undated one last, the out-of-stock one absent', servedIn(first, 'acc-fresh'), ['acc-f-new', 'acc-f-old']);
  check('acc-fresh: the out-of-stock piece is not even a candidate', !rec(first, 'acc-fresh').candidates.some((c) => c.contentId === 'acc-f-oos'));
  near('acc-fresh: a day-old piece gets 0.2 × 2^(−1/7)', rec(first, 'acc-fresh', 'acc-f-new').explain.freshness?.applied, 0.181, 0.005);
  near('acc-fresh: a 40-day-old piece gets almost nothing', rec(first, 'acc-fresh', 'acc-f-old').explain.freshness?.applied, 0.004, 0.003);
  eq('acc-rail: at most one per line, then relaxed to fill the rail', servedIn(first, 'acc-rail'), ['acc-r-d1', 'acc-r-t1', 'acc-r-d2']);
  eq('acc-rail: the taker names the piece that yielded', rec(first, 'acc-rail', 'acc-r-t1').explain.diversity?.skipped, ['acc-r-d2']);
  eq('acc-rail: the relaxed piece says so', rec(first, 'acc-rail', 'acc-r-d2').explain.diversity?.relaxed, true);
  check('acc-rail: no fatigue on a first visit', rec(first, 'acc-rail', 'acc-r-d1').explain.fatigue === undefined);
  eq('acc-story: the featured product rides the record', rec(first, 'acc-story').featured_product_ids, ['ACC-P-100']);
  eq('seven records, one per position', first.records.length, 7);
  const heroDecisionId = rec(first, 'acc-hero').decision_id;

  // 2. Two product views move the stage to considering. The session host derives it per event.
  for (let i = 0; i < 2; i++) {
    const r = await event(V, S, 'product_view', { productId: 'ACC-P-100', product_id: 'ACC-P-100', name: 'Acceptance bag', price: 250 });
    check(`product view ${i + 1} accepted`, r.status === 200 && r.json?.success !== false, `status ${r.status} ${r.text.slice(0, 160)}`);
  }
  // The stage is derived per event on the session host; the fatigue term needs the ring read inside its
  // 60 ms budget, which a cold object can miss once, so the snapshot is asked again until both are there.
  const second = await until('second snapshot sees the stage and the ring', async () => {
    const r = await snapshot(V, S);
    return r.json?.cell?.stage === 'mid' && rec(r.json, 'acc-rail', 'acc-r-d1')?.explain?.fatigue ? r.json : null;
  }, { tries: 5, everyMs: 800 });
  eq('second snapshot: the stage is considering', second.cell.stage, 'mid');
  eq('acc-hero: the piece made for a considering shopper now wins', servedIn(second, 'acc-hero'), ['acc-h-consider']);
  eq('acc-hero: the receipt itemises the stage rule', [rec(second, 'acc-hero').explain.stage?.visitor, rec(second, 'acc-hero').explain.stage?.applied], ['considering', 0.2]);
  const railSecond = rec(second, 'acc-rail', 'acc-r-d1');
  eq('acc-rail: served once before, inside the window', railSecond.explain.fatigue?.served, 1);
  near('acc-rail: the penalty is 0.3 × 1/3 off a 0.2 base', railSecond.explain.fatigue?.applied, -0.1, 0.001);
  check('acc-rail: the served counts ride the record for the replay', railSecond.inputs?.served?.['acc-rail']?.['acc-r-d1'] === 1);

  // 3. Outcomes: a click on the hero, and a purchase of the featured product with a value and a margin.
  // The slot objects keep evidence across runs, so the credits are read as what this run added.
  // Publish answers with what the object published, ahead of KV's cache, which on the real platform can
  // answer a read with what it held a minute ago. The GET is checked once for shape; the object is the truth.
  let liftChecked = false;
  const lift = async (slot) => {
    const p = await call('POST', `/v1/${scope}/learn/publish`, { headers: op, body: { slot } });
    check(`publish ${slot}`, p.status === 200 && p.json?.ok, `status ${p.status}`);
    if (!liftChecked) {
      const r = await call('GET', `/v1/${scope}/lift?slot=${slot}`, { headers: op });
      check(`read lift ${slot} through the serving path`, r.status === 200 && r.json?.ok !== false, `status ${r.status}`);
      liftChecked = true;
    }
    return p.json.snapshot ?? null;
  };
  const sOf = (snap, item) => snap?.items?.[item]?.['*']?.s ?? 0;
  const heroBefore = sOf(await lift('acc-hero'), 'acc-h-consider'), storyBefore = sOf(await lift('acc-story'), 'acc-s-featured');
  log(`      evidence before this run's outcomes: acc-h-consider ${heroBefore}, acc-s-featured ${storyBefore}`);
  const click = await event(V, S, 'content_click', { contentId: 'acc-h-consider', slot: 'acc-hero' });
  check('content click accepted', click.status === 200, `status ${click.status}`);
  const purchase = await event(V, S, 'purchase', { orderId: `acc-o-${runId}`, value: 250, currency: 'USD', margin: 90, items: [{ id: 'ACC-P-100', name: 'Acceptance bag', price: 250, quantity: 1 }] });
  check('purchase accepted', purchase.status === 200, `status ${purchase.status}`);

  // 4. The ring and the credits. The ring holds the served records; the credits go to each slot's object, published on demand.
  const ring = await until('the ring holds the shopper\'s decisions', async () => { const r = await call('GET', `/v1/${scope}/visitors/${V}/recent`, { headers: op }); return r.json?.ring?.length >= 14 ? r.json : null; });
  check('the ring holds both snapshots', ring.ring.some((e) => e.decision_id === heroDecisionId));
  const hero = await until('hero credit lands', async () => { const s = await lift('acc-hero'); return s && sOf(s, 'acc-h-consider') - heroBefore >= 0.99 ? s : null; }, { tries: 15, everyMs: 1500 });
  eq('acc-hero learns clicks as units', hero.objective, 'unit');
  near('acc-hero: the click is one success on the piece that was clicked', sOf(hero, 'acc-h-consider') - heroBefore, 1, 0.02);
  const story = await until('story credit lands', async () => { const s = await lift('acc-story'); return s && sOf(s, 'acc-s-featured') - storyBefore >= 200 ? s : null; }, { tries: 15, everyMs: 1500 });
  eq('acc-story learns purchases weighed by revenue', story.objective, 'revenue');
  near('acc-story: the purchase of the featured bag credits the story with its value', sOf(story, 'acc-s-featured') - storyBefore, 250, 1);

  // 5. The day report reads the ledger, which the queue drains within seconds.
  const report = await until('the report sees the shopper', async () => {
    const r = await call('POST', `/v1/${scope}/learn/report`, { headers: op, body: { date: day } });
    const rp = r.json?.report; return rp && rp.counts.decisions >= 14 && rp.counts.outcomes >= 2 ? rp : null;
  }, { tries: 20, everyMs: 1500 });
  check('the report counts the decisions and the outcomes', report.counts.decisions >= 14 && report.counts.outcomes >= 2, JSON.stringify(report.counts));
  check('the report names the learning policy', report.policies.some((p) => p.role === 'learning'));
  // The report attributes from the ledger with the same policy: the click credits the hero, the purchase the story.
  const creditedIn = (slot) => (report.holdout?.[slot] ?? []).find((a) => a.arm === 'personalized')?.credited ?? 0;
  check('the report credits the hero for the click', creditedIn('acc-hero') >= 1, JSON.stringify(report.holdout?.['acc-hero']));
  check('the report credits the story for the purchase of the featured bag', creditedIn('acc-story') >= 1, JSON.stringify(report.holdout?.['acc-story']));

  // 6. Erasure: the tombstone hides at once; the rewrite waits for the day to end.
  const erase = await call('POST', `/v1/${scope}/ledger/erasures`, { headers: op, body: { visitorId: V } });
  eq('erasure: tombstone written, ring emptied', [erase.status, erase.json?.ok, erase.json?.ring], [200, true, 'reset']);
  const gone = await call('GET', `/v1/${scope}/ledger/${encodeURIComponent(heroDecisionId)}`, { headers: op });
  eq('erasure: the point lookup answers 410', gone.status, 410);
  const ringAfter = await call('GET', `/v1/${scope}/visitors/${V}/recent`, { headers: op });
  eq('erasure: the ring is empty', ringAfter.json?.ring?.length ?? -1, 0);
  const reportAfter = await call('POST', `/v1/${scope}/learn/report`, { headers: op, body: { date: day } });
  check('erasure: the report drops the shopper\'s rows', (reportAfter.json?.report?.erasures?.rows_hidden ?? 0) >= 16, JSON.stringify(reportAfter.json?.report?.erasures));
  const rewrite = await call('POST', `/v1/${scope}/ledger/erasures/rewrite`, { headers: op, body: {} });
  // Other tombstones may be pending on the scope; theirs sweep. Today is never swept, so this run's stays.
  check('erasure: the rewrite leaves today alone and keeps this run\'s tombstone', rewrite.json?.ok && !rewrite.json.days.includes(day) && rewrite.json.remaining >= 1, JSON.stringify({ ...rewrite.json, days: `${rewrite.json?.days?.length ?? '?'} day(s)` }));

  // 7. A shopper who withheld tracking consent: the defaults, nothing written, no ring.
  const W = `acc-w-${runId}`, cookie = 'opt_tracking_consent=false; opt_personalization_enabled=true';
  const withheld = await snapshot(W, `acc-ws-${runId}`, cookie);
  eq('consent withheld: the default arm and nothing written', [withheld.json?.arm, withheld.json?.write, withheld.json?.sources?.consent?.tracking], ['default', false, false]);
  check('consent withheld: every receipt says why', withheld.json.records.every((r) => String(r.explain.note ?? '').includes('shopper')));
  const wClick = await event(W, `acc-ws-${runId}`, 'content_click', { contentId: 'acc-h-explore', slot: 'acc-hero' }, cookie);
  check('consent withheld: the event is still answered', wClick.status === 200, `status ${wClick.status}`);
  await sleep(1500);
  const wRing = await call('GET', `/v1/${scope}/visitors/${W}/recent`, { headers: op });
  eq('consent withheld: the ring never saw the shopper', wRing.json?.ring?.length ?? -1, 0);
}

let failed = null;
try { await run(); } catch (e) { failed = e; }
try { await teardown(); } catch (e) { log(`teardown failed: ${e.message}`); }
if (failed) { console.log(`\nFAIL  ${failed instanceof Fail ? failed.message : failed.stack ?? failed}`); console.log(`${checks} check(s) passed before the failure.`); process.exit(1); }
console.log(`\nACCEPTANCE PASSED: ${checks} checks in ${((Date.now() - started) / 1000).toFixed(1)}s against ${base}`);

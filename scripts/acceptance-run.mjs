#!/usr/bin/env node
// scripts/acceptance-run.mjs — one shopper through the whole outcome-learning loop, on a live worker.
//
// Seeds an acceptance page on the scope (pieces and slot rules for stage, freshness, fatigue,
// diversity, stock, a revenue objective and a featured product), drives one shopper through the
// SDK's own routes (snapshot, product views, a click, a purchase), then reads back what the engine
// says about it: the receipt's itemised terms, the ring, the published lift with credits weighed by
// value, the day report, an erasure honoured at once, and a shopper who withheld consent. Every
// check asserts an exact value and the run stops on the first failure. The documents it changed
// have only this run's unchanged fixtures removed from the current publication.
// Unresolved cleanup fails the engineering run; unrelated publications survive.
//
//   node scripts/acceptance-run.mjs [--base http://localhost:9100] [--scope coach] [--sdk-key demo-site] [--token <jwt>]
//
// Use --token or OPERATOR_TOKEN. Local minting requires explicit JWT_SECRET,
// JWT_ISSUER and JWT_AUDIENCE; remote targets require an existing operator token.
import { isLoopbackTarget, resolveToolToken, tokenFromArgs } from './lib/tool-token.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const base = arg('--base', 'http://localhost:9100').replace(/\/+$/, '');
const scope = arg('--scope', 'coach');
const sdkKey = arg('--sdk-key', 'demo-site');
const target=new URL(base);
if((target.protocol!=='https:'&&!isLoopbackTarget(base))||!['http:','https:'].includes(target.protocol)
  ||target.username||target.password||target.search||target.hash||target.pathname!=='/'||!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(scope)
  ||typeof sdkKey!=='string'||!sdkKey||sdkKey.trim()!==sdkKey||new TextEncoder().encode(sdkKey).length>512)throw new Error('Invalid engineering target');
const token = await resolveToolToken({ token: tokenFromArgs(process.argv), payload: { sub: 'acceptance-run', roles: ['operator'] },
  expiresIn: '30m', allowMint: isLoopbackTarget(base) });

// ── the harness ──────────────────────────────────────────────────────────────
const started = Date.now();
let checks = 0;
const log = (s) => console.log(`${String(((Date.now() - started) / 1000).toFixed(1)).padStart(6)}s  ${s}`);
class Fail extends Error {}
const check = (name, ok, detail = '') => { checks++; if (!ok) throw new Fail(`${name}${detail ? `: ${detail}` : ''}`); log(`PASS  ${name}`); };
const eq = (name, got, want) => check(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
const near = (name, got, want, tol) => check(name, typeof got === 'number' && Math.abs(got - want) <= tol, `got ${got}, want ${want} ± ${tol}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const op = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'X-Tenant': scope };
const site = { 'Content-Type': 'application/json', 'X-SDK-Key': sdkKey, 'X-Tenant': scope };
const canonical = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
async function call(method, path, { headers = {}, body, cookie } = {}) {
  const payload=body===undefined?undefined:JSON.stringify(body);
  if(payload!==undefined&&new TextEncoder().encode(payload).byteLength>2*1024*1024)throw new Fail('Request size unavailable');
  const res = await fetch(`${base}${path}`, { method, redirect: 'error', signal: AbortSignal.timeout(20000),
    headers: { ...headers, ...(cookie ? { Cookie: cookie } : {}) }, body: payload });
  let text = '', bytes = 0; const reader = res.body?.getReader(), decoder = new TextDecoder('utf-8', {fatal:true});
  if(reader)try{for(;;){const part=await reader.read();if(part.done)break;bytes+=part.value.length;if(bytes>16*1024*1024)throw new Fail('Response size unavailable');text+=decoder.decode(part.value,{stream:true});}text+=decoder.decode();}finally{void reader.cancel().catch(()=>{});}
  let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, json, text };
}
async function until(name, fn, { tries = 20, everyMs = 1000 } = {}) {
  for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(everyMs); }
  throw new Fail(`${name}: not true after ${tries} tries`);
}
const day = new Date().toISOString().slice(0, 10);
const runId = crypto.randomUUID();
const fixtureId = name => `acc-${runId}-${name}`;
const DAY = 86_400_000;
const iso = (ms) => new Date(ms).toISOString();

// ── the acceptance page: what the pieces and the rules are, and what they must produce ───────────
const PAGE = `acceptance-${runId}`;
const piece = (id, tags, slot, extra = {}) => ({ id: fixtureId(id), customerContentId: `ACC-${runId}-${id}`, type: 'editorial', title: `Acceptance ${id}`, tags, slotTypes: [slot], lifecycle: { status: 'live' }, ...extra });
const now = Date.now();
const pieces = [
  // acc-hero, take 1, cold on affinity: the stage rule decides. exploring first in catalogue order.
  piece('h-explore', { theme: ['discover'] }, fixtureId('hero'), { journeyStageFit: ['exploring'] }),
  piece('h-consider', { theme: ['compare'] }, fixtureId('hero'), { journeyStageFit: ['considering'] }),
  // acc-fresh, take 2: freshness orders them; the one out of stock never appears.
  piece('f-new', { theme: ['fresh'] }, fixtureId('fresh'), { freshnessDate: iso(now - 1 * DAY) }),
  piece('f-old', { theme: ['fresh'] }, fixtureId('fresh'), { freshnessDate: iso(now - 40 * DAY) }),
  piece('f-undated', { theme: ['fresh'] }, fixtureId('fresh')),
  piece('f-oos', { theme: ['fresh'] }, fixtureId('fresh'), { freshnessDate: iso(now), inStock: false }),
  // acc-rail, take 3, all dated today so each starts at the same freshness bonus: diversity and fatigue show.
  piece('r-d1', { line: ['Drover'] }, fixtureId('rail'), { freshnessDate: iso(now) }),
  piece('r-d2', { line: ['Drover'] }, fixtureId('rail'), { freshnessDate: iso(now) }),
  piece('r-t1', { line: ['Tabby'] }, fixtureId('rail'), { freshnessDate: iso(now) }),
  // acc-story, take 1: features a product; a purchase of that product credits it, weighed by revenue.
  piece('s-featured', { theme: ['story'] }, fixtureId('story'), { featuredProductIds: [`ACC-P-${runId}`] }),
];
const slots = [
  { slot: fixtureId('hero'), take: 1, weights: { theme: 0.3 }, stage: { outOfStage: 0.3, inStage: 0.2 } },
  { slot: fixtureId('fresh'), take: 2, weights: { theme: 0.3 }, freshness: { weight: 0.2, halfLifeDays: 7 } },
  { slot: fixtureId('rail'), take: 3, weights: { theme: 0.3 }, freshness: { weight: 0.2, halfLifeDays: 7 }, fatigue: { weight: 0.3, windowHours: 24, cap: 3 }, diversity: { dimension: 'line', max: 1 } },
  { slot: fixtureId('story'), take: 1, weights: { theme: 0.3 } },
];
const learnSlots = Object.fromEntries(slots.map(({ slot }) => [slot, { measurementBasis: 'rendered-v1',
  reward: slot === fixtureId('story') ? 'purchase' : 'click', ...(slot === fixtureId('story') ? { objective: 'revenue' } : {}) }]));

// ── setup: the documents, merged into what the scope already has ─────────────────────────────────
const before = {}, publications = [];
async function documents() {
  for (let attempt=0;attempt<3;attempt++) {
    const values={};
    for (const kind of ['catalog','slots','learn']) {
      const r=await call('GET','/content/'+kind+'?scope='+encodeURIComponent(scope),{headers:op});
      check('read initialized '+kind,r.status===200&&r.json?.document&&r.json?.publication&&r.json.revision>0);
      values[kind]=r.json;
    }
    if (['slots','learn'].every(kind=>JSON.stringify(values[kind].publication)===JSON.stringify(values.catalog.publication))) return values;
  }
  throw new Fail('Concurrent publication changed the read basis');
}
async function reconcile(operation) {
  const path='/content/catalog/publication?kind=catalog&scope='+encodeURIComponent(scope);
  const state=await call('GET',path,{headers:operation.headers});
  if(state.status!==200)throw new Fail('Publication reconciliation unavailable: '+operation.id);
  if(state.json?.state==='absent'){operation.absent=true;return false;}
  if(state.json?.operationId!==operation.id)throw new Fail('Publication identity conflict');
  if(state.json.state==='pending'){
    const recovered=await call('POST','/content/catalog/publication/recover?kind=catalog&scope='+encodeURIComponent(scope),{headers:operation.headers,body:{}});
    if(recovered.status!==200||!recovered.json?.ok)throw new Fail('Publication recovery remains pending: '+operation.id);
  }else if(state.json.state!=='committed')throw new Fail('Publication remains unresolved: '+operation.id);
  operation.confirmed=true;return true;
}
async function publishSet(current,catalog,slotsDoc,learn,note) {
  const id=current.catalog.revision+':'+crypto.randomUUID(), pin=current.catalog.publication;
  const headers={...op,'If-Match':'"'+current.catalog.revision+'/'+pin.revision+'/'+pin.digest+'"','Idempotency-Key':id};
  const operation={id,headers,confirmed:false};publications.push(operation);
  let response;
  try{response=await call('PUT','/content/catalog?scope='+encodeURIComponent(scope),{headers,body:{document:catalog,note,
    publicationChanges:[{kind:'slots',document:slotsDoc},{kind:'learn',document:learn}]}});}catch{/* exact readback below */}
  if(response?.status===200&&response.json?.ok)operation.confirmed=true;
  else if(!await reconcile(operation))throw new Fail('Publication was not admitted: '+id);
}
async function setup() {
  const current=await documents();Object.assign(before,current);
  const catalog={...current.catalog.document,pieces:[...(current.catalog.document.pieces??[]),...pieces]};
  const slotsDoc={...current.slots.document,pages:{...(current.slots.document.pages??{}),[PAGE]:slots}};
  const learn={...current.learn.document,slots:{...(current.learn.document.slots??{}),...learnSlots}};
  check('run-owned names are unused',!current.slots.document.pages?.[PAGE]&&pieces.every(p=>!current.catalog.document.pieces?.some(x=>x.id===p.id))
    &&Object.keys(learnSlots).every(key=>!Object.hasOwn(current.learn.document.slots??{},key)));
  await publishSet(current,catalog,slotsDoc,learn,'acceptance run '+runId);
}
async function teardown() {
  for(const operation of publications)if(!operation.confirmed&&!operation.absent)await reconcile(operation);
  if(!before.catalog)return;
  const current=await documents(), owned=new Map(pieces.map(p=>[p.id,p]));
  for(const piece of current.catalog.document.pieces??[])if(owned.has(piece.id)&&canonical(piece)!==canonical(owned.get(piece.id)))
    throw new Fail('Run fixture was concurrently edited; cleanup requires reconciliation');
  if(current.slots.document.pages?.[PAGE]&&canonical(current.slots.document.pages[PAGE])!==canonical(slots))throw new Fail('Run page was concurrently edited');
  for(const [key,value]of Object.entries(learnSlots))if(current.learn.document.slots?.[key]&&canonical(current.learn.document.slots[key])!==canonical(value))throw new Fail('Run learning fixture was concurrently edited');
  const catalog={...current.catalog.document,pieces:(current.catalog.document.pieces??[]).filter(p=>!owned.has(p.id))};
  const slotsDoc=structuredClone(current.slots.document),learn=structuredClone(current.learn.document);
  delete slotsDoc.pages[PAGE];for(const key of Object.keys(learnSlots))delete learn.slots[key];
  await publishSet(current,catalog,slotsDoc,learn,'acceptance run '+runId+': remove only owned fixtures');
}

// ── the shopper ──────────────────────────────────────────────────────────────────────────────────
const sessions = new Map();
async function shopper(visitor,tracking=true) {
  if(sessions.has(visitor))return sessions.get(visitor);
  const response=await call('POST','/v1/'+encodeURIComponent(scope)+'/identity/session',{headers:site,body:{}});
  const session=response.json?.session;
  check('signed shopper bootstrap',response.status===200&&session?.capability&&session.subject&&session.sessionId&&session.grantId);
  const headers={...site,'X-Shopper-Session':session.capability};
  const consent=await call('POST','/realtime/session/preferences',{headers,body:{trackingConsent:tracking,personalizationEnabled:tracking,
    choice:{id:crypto.randomUUID(),expectedRevision:session.consent?.instruction?.revision??null,grantId:session.grantId,iat:session.iat,exp:session.exp}}});
  check('explicit shopper consent',consent.status===200&&consent.json?.consent?.tracking===tracking);
  sessions.set(visitor,{...session,headers});return sessions.get(visitor);
}
const snapshot = async (visitor,_session,cookie) => {
  const s=await shopper(visitor,!cookie);return call('POST','/v1/'+encodeURIComponent(scope)+'/decisions/snapshot',{headers:s.headers,cookie,body:{page:PAGE,channel:'acceptance',pageInstance:crypto.randomUUID()}});
};
const event = async (visitor,_session,type,data,cookie) => {
  const s=await shopper(visitor,!cookie);return call('POST','/realtime/action',{headers:s.headers,cookie,body:{type,userId:s.subject,sessionId:s.sessionId,eventId:crypto.randomUUID(),source:'acceptance',data,timestamp:Date.now()}});
};
const rec = (set, slot, item) => set.records.find((r) => r.slot === slot && (!item || r.item_id === item));
const servedIn = (set, slot) => set.decisions.filter((d) => d.slot === slot).map((d) => d.contentId);

// This CLI reports a synthetic renderer signal, not browser paint or visibility.
// Private receipts are read separately with operator authority, never from a poll.
async function admitRendered(visitor, set) {
  check('snapshot is read-only and has no private receipts', set.write === false && !Object.hasOwn(set, 'records'));
  const s = await shopper(visitor), expected = new Map();
  for (const choice of set.decisions) {
    check('renderable choice has an authenticated original offer', typeof choice.decisionId === 'string' && typeof choice.renderOffer === 'string' && !!set.pageInstance);
    const wire = { type: 'content_impression', userId: s.subject, sessionId: s.sessionId, eventId: crypto.randomUUID(),
      timestamp: Date.now(), source: 'acceptance', data: { page: PAGE, pageInstance: set.pageInstance, position: choice.order,
        contentId: choice.contentId, slot: choice.slot, decisionId: choice.decisionId, renderOffer: choice.renderOffer } };
    let acknowledged = false;
    for (let attempt = 0; attempt < 3 && !acknowledged; attempt++) {
      try {
        const response = await call('POST', '/realtime/action', { headers: s.headers, body: wire }), ack = response.json?.render;
        acknowledged = response.status === 200 && ack?.version === 1 && ack.status === 'durable'
          && ['pending', 'recovered'].includes(ack.source) && ack.eventId === wire.eventId
          && ack.decisionId === choice.decisionId && ack.pageInstance === set.pageInstance;
      } catch { /* ambiguous ACK: retry only the same original envelope */ }
    }
    check('synthetic rendered signal durably acknowledged', acknowledged);
    expected.set(choice.decisionId, { choice, wire });
  }
  const records = await until('original rendered receipts reach the operator ring', async () => {
    const response = await call('GET', `/v1/${encodeURIComponent(scope)}/visitors/${encodeURIComponent(s.subject)}/recent`, { headers: op });
    if (response.status !== 200 || !Array.isArray(response.json?.ring)) return null;
    const rows = response.json.ring.filter(row => expected.has(row.decision_id));
    if (rows.length !== expected.size || new Set(rows.map(row => row.decision_id)).size !== expected.size) return null;
    for (const row of rows) {
      const { choice, wire } = expected.get(row.decision_id);
      check('operator receipt preserves original render identity', row.item_id === choice.contentId && row.slot === choice.slot
        && row.measurementBasis === 'rendered-v1' && row.rendered?.eventId === wire.eventId
        && row.rendered?.at === wire.timestamp && row.rendered?.pageInstance === set.pageInstance);
    }
    return rows;
  });
  return { ...set, records };
}

async function run() {
  log(`acceptance run ${runId} against ${base}, scope ${scope}, page ${PAGE}, day ${day}`);
  await setup();

  // A shopper the holdout hash puts in the personalized arm; the documents are not changed for it.
  let V = '', S = '', first = null;
  for (let i = 0; i < 8 && !first; i++) {
    const v = `acc-v-${runId}-${i}`;
    const r = await snapshot(v, S);
    check('snapshot answers', r.status === 200 && r.json?.ok, `status ${r.status} ${r.text.slice(0, 200)}`);
    if (r.json.arm === 'personalized') { const issued=sessions.get(v);V=issued.subject;S=issued.sessionId;sessions.set(V,issued);first=r.json; } else log(`      ${v} is in the ${r.json.arm} arm; trying the next id`);
  }
  check('a personalized shopper', Boolean(first), 'eight ids in a row landed in a holdout arm');
  log(`      signed shopper selected, state ${first.sources.state}`);

  // 1. The first snapshot: no events yet, so the stage is unknown and the stage rule is off.
  eq('first snapshot: read-only, consenting', [first.write, first.sources.consent.personalized], [false, true]);
  first = await admitRendered(V, first);
  eq('first snapshot: stage unknown before any event', first.cell.stage, 'unknown');
  eq('acc-hero: catalogue order while the stage is unknown', servedIn(first, fixtureId('hero')), [fixtureId('h-explore')]);
  check('acc-hero: no stage block while the stage is unknown', rec(first, fixtureId('hero')).explain.stage === undefined);
  eq('acc-fresh: newest first, the undated one last, the out-of-stock one absent', servedIn(first, fixtureId('fresh')), [fixtureId('f-new'), fixtureId('f-old')]);
  check('acc-fresh: the out-of-stock piece is not even a candidate', !rec(first, fixtureId('fresh')).candidates.some((c) => c.contentId === fixtureId('f-oos')));
  near('acc-fresh: a day-old piece gets 0.2 × 2^(−1/7)', rec(first, fixtureId('fresh'), fixtureId('f-new')).explain.freshness?.applied, 0.181, 0.005);
  near('acc-fresh: a 40-day-old piece gets almost nothing', rec(first, fixtureId('fresh'), fixtureId('f-old')).explain.freshness?.applied, 0.004, 0.003);
  eq('acc-rail: at most one per line, then relaxed to fill the rail', servedIn(first, fixtureId('rail')), [fixtureId('r-d1'), fixtureId('r-t1'), fixtureId('r-d2')]);
  eq('acc-rail: the taker names the piece that yielded', rec(first, fixtureId('rail'), fixtureId('r-t1')).explain.diversity?.skipped, [fixtureId('r-d2')]);
  eq('acc-rail: the relaxed piece says so', rec(first, fixtureId('rail'), fixtureId('r-d2')).explain.diversity?.relaxed, true);
  check('acc-rail: no fatigue on a first visit', rec(first, fixtureId('rail'), fixtureId('r-d1')).explain.fatigue === undefined);
  eq('acc-story: the featured product rides the record', rec(first, fixtureId('story')).featured_product_ids, [`ACC-P-${runId}`]);
  eq('seven records, one per position', first.records.length, 7);
  const heroDecisionId = rec(first, fixtureId('hero')).decision_id;

  // 2. Two product views move the stage to considering. The session host derives it per event.
  for (let i = 0; i < 2; i++) {
    const r = await event(V, S, 'product_view', { productId: `ACC-P-${runId}`, product_id: `ACC-P-${runId}`, name: 'Acceptance bag', price: 250 });
    check(`product view ${i + 1} accepted`, r.status === 200 && r.json?.success !== false, `status ${r.status} ${r.text.slice(0, 160)}`);
  }
  // Polls create no exposures. Only the selected second set is acknowledged.
  let second = await until('second snapshot sees the acknowledged interactions', async () => {
    const r = await snapshot(V, S);
    return r.status === 200 && r.json?.cell?.stage === 'mid' ? r.json : null;
  }, { tries: 5, everyMs: 800 });
  second = await admitRendered(V, second);
  eq('second snapshot: the stage is considering', second.cell.stage, 'mid');
  eq('acc-hero: the piece made for a considering shopper now wins', servedIn(second, fixtureId('hero')), [fixtureId('h-consider')]);
  eq('acc-hero: the receipt itemises the stage rule', [rec(second, fixtureId('hero')).explain.stage?.visitor, rec(second, fixtureId('hero')).explain.stage?.applied], ['considering', 0.2]);
  const railSecond = rec(second, fixtureId('rail'), fixtureId('r-d1'));
  eq('acc-rail: served once before, inside the window', railSecond.explain.fatigue?.served, 1);
  near('acc-rail: the penalty is 0.3 × 1/3 off a 0.2 base', railSecond.explain.fatigue?.applied, -0.1, 0.001);
  check('acc-rail: the served counts ride the record for the replay', railSecond.inputs?.served?.[fixtureId('rail')]?.[fixtureId('r-d1')] === 1);

  // 3. Outcomes: a click on the hero, and a purchase of the featured product with a value and a margin.
  // The slot objects keep evidence across runs, so the credits are read as what this run added.
  // Publish answers with what the object published, ahead of KV's cache, which on the real platform can
  // answer a read with what it held a minute ago. The GET is checked once for shape; the object is the truth.
  let liftChecked = false;
  const lift = async (slot) => {
    const p = await call('POST', `/v1/${encodeURIComponent(scope)}/learn/publish`, { headers: op, body: { slot } });
    check(`publish ${slot}`, p.status === 200 && p.json?.ok, `status ${p.status}`);
    if (!liftChecked) {
      const r = await call('GET', `/v1/${encodeURIComponent(scope)}/lift?slot=${slot}`, { headers: op });
      check(`read lift ${slot} through the serving path`, r.status === 200 && r.json?.ok !== false, `status ${r.status}`);
      liftChecked = true;
    }
    return p.json.snapshot ?? null;
  };
  const sOf = (snap, item) => snap?.items?.[item]?.['*']?.s ?? 0;
  const heroBefore = sOf(await lift(fixtureId('hero')), fixtureId('h-consider')), storyBefore = sOf(await lift(fixtureId('story')), fixtureId('s-featured'));
  log(`      evidence before this run's outcomes: acc-h-consider ${heroBefore}, acc-s-featured ${storyBefore}`);
  const clicked = rec(second, fixtureId('hero'));
  const click = await event(V, S, 'content_click', { contentId: fixtureId('h-consider'), slot: fixtureId('hero'),
    decisionId: clicked.decision_id, page: PAGE, pageInstance: second.pageInstance, position: clicked.position });
  check('content click accepted', click.status === 200, `status ${click.status}`);
  const purchase = await event(V, S, 'purchase', { orderId: `acc-o-${runId}`, value: 250, currency: 'USD', margin: 90, items: [{ id: `ACC-P-${runId}`, name: 'Acceptance bag', price: 250, quantity: 1 }] });
  check('purchase accepted', purchase.status === 200, `status ${purchase.status}`);

  // 4. The ring and the credits. The ring holds the served records; the credits go to each slot's object, published on demand.
  const ring = await until('the ring holds the shopper\'s decisions', async () => { const r = await call('GET', `/v1/${encodeURIComponent(scope)}/visitors/${V}/recent`, { headers: op }); return r.json?.ring?.length >= 14 ? r.json : null; });
  check('the ring holds both snapshots', ring.ring.some((e) => e.decision_id === heroDecisionId));
  const hero = await until('hero credit lands', async () => { const s = await lift(fixtureId('hero')); return s && sOf(s, fixtureId('h-consider')) - heroBefore >= 0.99 ? s : null; }, { tries: 15, everyMs: 1500 });
  eq('acc-hero learns clicks as units', hero.objective, 'unit');
  eq('acc-hero denominator is acknowledged rendering', hero.measurementBasis, 'rendered-v1');
  near('acc-hero: the click is one success on the piece that was clicked', sOf(hero, fixtureId('h-consider')) - heroBefore, 1, 0.02);
  const story = await until('story credit lands', async () => { const s = await lift(fixtureId('story')); return s && sOf(s, fixtureId('s-featured')) - storyBefore >= 200 ? s : null; }, { tries: 15, everyMs: 1500 });
  eq('acc-story learns purchases weighed by revenue', story.objective, 'revenue');
  near('acc-story: the purchase of the featured bag credits the story with its value', sOf(story, fixtureId('s-featured')) - storyBefore, 250, 1);

  // 5. The day report reads the ledger, which the queue drains within seconds.
  const report = await until('the report sees the shopper', async () => {
    const r = await call('POST', `/v1/${encodeURIComponent(scope)}/learn/report`, { headers: op, body: { date: day } });
    const rp = r.json?.report; return rp && rp.counts.decisions >= 14 && rp.counts.outcomes >= 2 ? rp : null;
  }, { tries: 20, everyMs: 1500 });
  check('the report counts the decisions and the outcomes', report.counts.decisions >= 14 && report.counts.outcomes >= 2, JSON.stringify(report.counts));
  check('the report names the learning policy', report.policies.some((p) => p.role === 'learning'));
  // The report attributes from the ledger with the same policy: the click credits the hero, the purchase the story.
  const creditedIn = (slot) => (report.holdout?.[slot] ?? []).find((a) => a.arm === 'personalized')?.credited ?? 0;
  check('the report credits the hero for the click', creditedIn(fixtureId('hero')) >= 1, JSON.stringify(report.holdout?.[fixtureId('hero')]));
  check('the report credits the story for the purchase of the featured bag', creditedIn(fixtureId('story')) >= 1, JSON.stringify(report.holdout?.[fixtureId('story')]));

  // 6. Run-owned erasure only. A tenant-wide physical sweep is not authorized
  // by this engineering probe and remains a separate operational check.
  const erase = await call('POST', `/v1/${encodeURIComponent(scope)}/ledger/erasures`, { headers: op, body: { visitorId: V } });
  eq('erasure: tombstone written, ring emptied', [erase.status, erase.json?.ok, erase.json?.ring], [200, true, 'reset']);
  const gone = await call('GET', `/v1/${encodeURIComponent(scope)}/ledger/${encodeURIComponent(heroDecisionId)}`, { headers: op });
  eq('erasure: the point lookup answers 410', gone.status, 410);
  const ringAfter = await call('GET', `/v1/${encodeURIComponent(scope)}/visitors/${V}/recent`, { headers: op });
  eq('erasure: the ring is empty', ringAfter.json?.ring?.length ?? -1, 0);
  const reportAfter = await call('POST', `/v1/${encodeURIComponent(scope)}/learn/report`, { headers: op, body: { date: day } });
  check('erasure: current report is available',reportAfter.status===200&&!!reportAfter.json?.report);
  for(const slot of slots.map(value=>value.slot)){
    const beforeArm=(report.holdout?.[slot]??[]).find(value=>value.arm==='personalized');
    const afterArm=(reportAfter.json.report.holdout?.[slot]??[]).find(value=>value.arm==='personalized');
    check('erasure: owned slot previously had personalized decisions',beforeArm?.decisions>0);
    eq('erasure: owned slot has no personalized decisions or credit',[afterArm?.decisions??0,afterArm?.credited??0],[0,0]);
  }
  log('OPEN  physical erasure sweep and provider/history deletion are not exercised');

  // 7. A shopper who withheld tracking consent: the defaults, nothing written, no ring.
  const W = `acc-w-${runId}`, cookie = 'opt_tracking_consent=false; opt_personalization_enabled=true';
  const withheld = await snapshot(W, `acc-ws-${runId}`, cookie);
  eq('consent withheld: the default arm and nothing written', [withheld.json?.arm, withheld.json?.write, withheld.json?.sources?.consent?.tracking], ['default', false, false]);
  check('consent withheld: no private receipt or render authority', !Object.hasOwn(withheld.json, 'records')
    && Array.isArray(withheld.json.decisions) && withheld.json.decisions.every(choice => !choice.renderOffer && !choice.decisionId));
  const wClick = await event(W, `acc-ws-${runId}`, 'content_click', { contentId: fixtureId('h-explore'), slot: fixtureId('hero') }, cookie);
  check('consent withheld: the event is still answered', wClick.status === 200, `status ${wClick.status}`);
  await sleep(1500);
  const wRing = await call('GET', `/v1/${encodeURIComponent(scope)}/visitors/${sessions.get(W).subject}/recent`, { headers: op });
  eq('consent withheld: the ring never saw the shopper', wRing.json?.ring?.length ?? -1, 0);
}

let failed = null;
try { await run(); } catch (e) { failed = e; }
try { await teardown(); } catch (e) { failed ??= e; log(`cleanup incomplete: ${e.message}`); }
if (failed) { console.log(`\nFAIL  ${failed instanceof Fail ? failed.message : failed.stack ?? failed}`); console.log(`${checks} check(s) passed before the failure.`); process.exit(1); }
console.log(`\nENGINEERING CHECKS PASSED (not customer, live-provider or business acceptance): ${checks} checks in ${((Date.now() - started) / 1000).toFixed(1)}s against ${base}`);

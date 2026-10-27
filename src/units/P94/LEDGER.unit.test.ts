// src/units/P94/LEDGER.unit.test.ts
// P94 under the Closure Ledger: the tests for the LOCAL criteria AD1-AD4 of the P94 work order (the programme
// tapestry-parity-scale of amendment 12, ticket P94 "Exact `arm_draw` counts", E19; batch S38). LV1 is a deferred live
// row and gets no test.
//
// THE REQUIREMENT, verbatim (docs/parity/authority/amendment-12/BTI-Parity-Amendment-2026-10-26-scale.md, section 2, E19):
//   "**Authority:** lane L19 (R-P485): the counter on the object host loses increments under bursts (a KV read-then-write
//   after the answer, `src/content/holdout.ts:291–298`); P84 and P85's live rows are PENDING on it."
//   "**Done when:** the counter is a durable increment (the learn statistics object or a per-tenant object) so concurrent
//   draws are all counted; the operator's `arm_draw` read is exact; P84 and P85 pass live at the next lane."
// The work order (docs/parity/scale/program.json, P94): AD1 the burst on both hosts counted in full, reason by reason;
// AD2 the count a durable increment held by a Durable Object at a per-tenant name, never a slot's statistics state, its
// shape, its thirty-day window, naming no visitor, session or class, zeros for a tenant with no draw; AD3 after the answer,
// never for a synthetic operation, a counter that cannot be written or read failing and delaying nothing, P84's and P85's
// unit legs unchanged (LOCK); AD4 kit 02 :1531-1533 states the exact count, "read as a floor" gone.
//
// THE DESIGN THE LEAD RULED (S38/SPEC-BRIEF-P94.md, five points; each locked below):
//   1. The object: the count lives in a Durable Object on the existing LEARN_STATS binding at the per-tenant name
//      `arm-draw:v1:<tenant>`, never a slot's name; recordArmDraw/readArmDraw keep their callers and take
//      Pick<Env, 'LEARN_STATS'>; the KV document is neither read nor written (no seed: the count restarts at the release).
//   2. The paths: POST /arm-draw/record { reason, now } and POST /arm-draw/read { now }, answering { capped, ignored,
//      mismatch, republished }; the record an increment under the object's `serialize` on one storage key `armDraw`
//      ({ version: 1, since, capped, ignored, mismatch, republished }); the thirty-day window as today (a read past the
//      horizon answers zeros, a record past it starts a new window at `now`); an unknown reason refused 400, never counted.
//   3. Nothing else: the arm-draw name loads no slot state, publishes nothing, writes no key-value entry, arms no alarm;
//      every slot object's storage and alarm as before (P70's keep-warm is a slot's).
//   4. Off the shopper's time: the record after the answer under waitUntil, never for a synthetic operation (unchanged
//      callers); a missing binding, a rejecting fetch or a fetch not answering within ARM_DRAW_READ_BOUND_MS (2,000 ms, a
//      code constant in holdout.ts) neither fails nor delays a decision, a beacon or the learn queue (200, zeros in the shape).
//      RULED R-P503 (F1, the bounded wait refused): the two records the shopper's owner holds — a request carrying a session
//      (ignored) and the carousel beacon (mismatch) — follow the owner's answer through afterOwnerAnswer
//      (src/identity/sessionAuthority.ts, handing LEARN_STATS beside CACHE and nothing else), so the shopper's answer never
//      waits on the counter; the first-request door's waitUntil stays; the learn queue's own read stays bounded at 2,000 ms.
//   5. The kit: kit 02 states `arm_draw` as an exact count of every reason over thirty days naming no visitor; "read as a
//      floor" leaves that sentence; `enrollment_anchor_unavailable` keeps its own floor sentence.
// NEW EXPORT IMPORTED: ARM_DRAW_READ_BOUND_MS from src/content/holdout.ts (point 4); RED on its absence where named.
//
// READINGS (where the brief is silent; for the lead):
//   R1 The operator cache in AD1 answers as deployed KV answers a reader (KV_READ_CACHE_MS, the platform's 60 s read
//      cache): a key once read is answered again for 60 s whatever is written meanwhile. UnitKV is stronger than the
//      platform (every read sees the last write at once); R-P485 measured the platform's form ("one of two mismatches
//      3 s apart counted"). A count on the object never reads the cache, so this changes nothing for it.
//   R2 "Issued together": every request of the burst is created in one turn and none awaits another. The requests whose
//      reason the republication decides are held at a point of the real path: the republished ones at their forward to
//      the shopper's object (between the mint's holdout read and the decision's pin), the late ones in flight before the
//      worker (so their mint reads the republished holdout). The republication is the operator's own PUT /content/learn.
//   R3 (as ruled, R-P503) "Neither delays": a decision, a request carrying a session and a beacon wait on the counter
//      not at all — each answers in its ordinary time (ANSWER_BOUND_MS absolute, NOISE_MS beside its healthy time) while
//      the counter does not answer, and its record lands after the answer; only the learn queue's read waits, and no
//      longer than ARM_DRAW_READ_BOUND_MS. The shopper's owner drains the work it retains before it answers
//      (src/identity/sessionAuthority.ts runOwnerOperation, retainOwnerWork; every binding call inside the owner is
//      retained, ownerEffect), so a record kept as owner work holds those answers (the wrong fix `retained`). The doubles
//      honour the request's abort signal, as the platform's transport does.
//   R4 A record whose `now` is earlier than the window's `since` (two callers' clocks, a record arriving late) is counted
//      in the window in force, never restarts it: today's `value.since > now` restart (holdout.ts armDrawDocument) would
//      lose increments under exactly the concurrency AD1 names. Only the horizon restarts the window.
//   R5 The record answers the counts after its increment; the read answers exactly the four members.
//   R6 "Never synthetic" is held by the callers, outside the grant (decisions.ts countArmDraw, service.ts
//      admitCarouselExposure); no synthetic operation sends an `arm` member or a carousel beacon (src/ops/synthetic.ts
//      runSynthetic), so no path can make a synthetic draw; AD3's logic leg locks both guards in the callers' source.
//   R7 (closed by R-P503) A read writes nothing to the object's storage: on an object with no draw, and past the horizon.
//
// LOCKS (R10 sweep, measured under the sketch, nothing to re-form): P84 (src/units/P84/LEDGER.unit.test.ts :1096-1162,
// arm_draw read through the queue), P85 (src/units/P85/LEDGER.unit.test.ts :274-288), W21 B2 :766-767 and :1024
// (`enrollment_anchor_unavailable`'s floor sentence, unchanged), P84.CO4 :1230 (/`arm_draw`/ in kit 02, kept); P61.LO3
// (src/units/P61/LEDGER.unit.test.ts :485, the learning-read count's work reaching `['CACHE']` alone) holds only if
// afterOwnerAnswer hands LEARN_STATS to the work that asks for it (the sketch: a second parameter, CACHE alone by default);
// handed to every work it goes RED there (measured, for the lead). P68.KT1 (src/units/P68/LEDGER.unit.test.ts :307-313) holds
// only while no line the kits cite in LearnStats.ts moves (kit 02 :1269 cites :1365-1366 and :1392-1394, kit 03 :1649 cites
// :741; kit 03 is outside the grant): the sketch dispatches the two paths on fetch's own line and places its method before
// `serialize`; a sketch adding lines above :741 turned it RED (measured, for the lead).
// DEFERRED: LV1 (P84's and P85's live rows on the object host at the next lane, L20).
// RESIDUALS: the count restarts at the release (the KV document is not carried, ruled); a bounded read answers zeros
// under failure (the only approximation, ruled); `enrollment_anchor_unavailable` stays a KV floor (not this ticket).
//
// HARNESS: src/units/_parity.ts (the mounted app over the real Durable Object classes, both hosts; asOperator, shopperOn,
// putDocument). Imports from src/units/: ../_parity. Tenant ids only; no network.

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

// ARM_DRAW_READ_BOUND_MS is a NEW export (point 4); the rest are today's.
import { ARM_DRAW_READ_BOUND_MS, armFor, readArmDraw, recordArmDraw } from '@/content/holdout';
import type { HoldoutConfig } from '@/content/types';
import { LearnStats } from '@/durable-objects/LearnStats';
import { SHOPPER_HEADER } from '@/identity/sessionCapability';
import type { Env } from '@/types/env';

import {
  asOperator, BRAND, declaredSlots, expectPublished, HOSTS, layoutSlot, learnDocument, MODULES, mount, pageInstanceOf, putDocument, readTree,
  shopperOn, TENANT, type Mounted, type Registry, type Shopper,
} from '../_parity';

// ---------------------------------------------------------------------------
// The fixture: P84's product page (the declared layout slot and the carousel with its per-context shot orders), the
// images of one product with their shot tags, an untagged image and an unnamed shot, another product's image (a cross
// input, never a candidate); the carousel measured on rendered-v1 (P85); the holdout per world.
// ---------------------------------------------------------------------------

const CAROUSEL = 'pdp-carousel';
const A = 'COA-CH857', B = 'COA-CB925';
const image = (n: number, contentType: string[] | null, product = A) => ({ id: `img-${product.slice(4).toLowerCase()}-${n}`, customerContentId: `TAP-IMG-${product}-${n}`,
  type: 'image', title: `${product} image ${n}`, tags: { category: [product === A ? 'Handbags' : 'Small Leather Goods'], ...(contentType ? { contentType } : {}) },
  slotTypes: product === A ? [CAROUSEL] : ['pdp-wallets'], lifecycle: { status: 'live' }, featuredProductIds: [product] });
const IMAGES = [image(1, ['studio']), image(2, ['flat_lay']), image(3, ['on_model']), image(4, ['detail']), image(5, ['on_model']), image(6, ['studio']),
  image(7, null), image(8, ['video'])];
const WALLET = image(1, ['on_model'], B);
const id = (n: number) => `img-ch857-${n}`;
/** The paint P84's head script makes for paid social on mobile. */
const PAINTED = [id(3), id(5), id(4), id(1), id(6), id(2), id(7), id(8)];
const SHOT_ORDERS = [
  { context: { channel: 'paid_social', visitBuckets: ['1'], device: 'mobile' }, order: ['on_model', 'detail', 'studio', 'flat_lay'] },
  { context: { channel: 'email', visitBuckets: 'any' }, order: ['flat_lay', 'detail', 'studio', 'on_model'] },
];
const SLOTS = { ...declaredSlots([]), pages: { pdp: [layoutSlot(), { slot: CAROUSEL, take: 8, weights: { category: 1 }, shotOrders: SHOT_ORDERS }] } };
const holdoutOf = (share: number): HoldoutConfig => ({ share, salt: 'p94-salt', arms: ['default'] });
const learnOf = (share: number) => learnDocument({ [CAROUSEL]: { measurementBasis: 'rendered-v1', reward: 'click' } }, { holdout: holdoutOf(share) });
const docsAt = (share: number) => ({ pieces: [...MODULES, ...IMAGES, WALLET], slots: SLOTS, learn: learnOf(share) });
/** One in a billion: a page's `default` draw is not met within the cap (capped); a `personalized` draw is met at once. */
const TINY = 1e-9;
const classOf = (arm: string) => arm === 'default' ? 'default' : 'personalized';

const ARM_DRAW_OBJECT = `arm-draw:v1:${TENANT}`;
const REASONS = ['capped', 'ignored', 'mismatch', 'republished'] as const;
type Counts = Record<(typeof REASONS)[number], number>;
const ZERO: Counts = { capped: 0, ignored: 0, mismatch: 0, republished: 0 };
const DAY_MS = 86_400_000;
const HORIZON_MS = 30 * DAY_MS;
/** The bound in force: the ruled constant once exported, 2,000 ms (the ruling) before. */
const BOUND_MS = typeof ARM_DRAW_READ_BOUND_MS === 'number' ? ARM_DRAW_READ_BOUND_MS : 2_000;
/** R3: what an answer may cost beyond its healthy time when it does not wait on the counter (machine noise). */
const NOISE_MS = 1_000;
/** R3 (R-P503): an answer in its ordinary time, well under the bound (the harness answers these in 4-13 ms). */
const ANSWER_BOUND_MS = 500;
/** R1: the read cache of deployed KV (cacheTtl's default, 60 s). */
const KV_READ_CACHE_MS = 60_000;
/** W21 B2's lock (src/units/W21/B2.unit.test.ts :766-767): the enrollment counter's own floor sentence, unchanged. */
const ENROLLMENT_FLOOR = '`enrollment_anchor_unavailable` is a lower bound: concurrent anchor failures can collapse into one increment, so read it as a floor and never as an exact count.';

const ROOT = new URL('../../../', import.meta.url);
const OPERATOR_ORIGIN = 'http://console.test';
const MOBILE = { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1', 'Sec-CH-UA-Mobile': '?1' };
const show = (value: unknown) => JSON.stringify(value)?.slice(0, 400);
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// The requests, as the SDK and the operator send them, each answered without draining the world.
// ---------------------------------------------------------------------------

interface Answered { status: number; body: Record<string, unknown>; ms: number }
const NO_ANSWER = (ms: number): Answered => ({ status: 0, body: { error: `no answer within ${ms} ms` }, ms });
async function send(m: Mounted, request: Request, within = 60_000): Promise<Answered> {
  const sent = performance.now();
  const answered = (async () => {
    const response = await m.fetch(request);
    const body = await response.json().catch(() => ({})) as Record<string, unknown>;
    return { status: response.status, body, ms: performance.now() - sent };
  })();
  return Promise.race([answered, sleep(within).then(() => NO_ANSWER(within))]);
}
const armMember = (cls: string, tableVersion: string) => JSON.stringify({ class: cls, tableVersion });
/** A brand-new browser's first decision request on the direct path (P13, P84): no session, the page's drawn class. */
const firstRequest = (cls: string, version: string, label: string) => new Request(`https://shop.invalid/v1/${TENANT}/decisions/snapshot`, { method: 'POST',
  headers: { 'X-Tenant': TENANT, 'Content-Type': 'application/json', ...MOBILE },
  body: JSON.stringify({ page: 'pdp', brand: BRAND, pageInstance: pageInstanceOf(label), 'ctx.anchor': A, arm: armMember(cls, version) }) });
/** A decision request carrying the shopper's session and naming a class (P84: ignored, the shopper's arm unchanged). */
const askedRequest = (s: Shopper, cls: string, version: string, label: string) => new Request(`https://shop.invalid/v1/${TENANT}/decisions/snapshot`, { method: 'POST',
  headers: { 'X-Tenant': TENANT, [SHOPPER_HEADER]: s.grant.capability, 'Content-Type': 'application/json', ...MOBILE },
  body: JSON.stringify({ page: 'pdp', brand: BRAND, pageInstance: pageInstanceOf(label), 'ctx.anchor': A, arm: armMember(cls, version) }) });
/** P85's carousel beacon through POST /realtime/action: the table version in force, paid social on mobile, the painted images, the page's claim. */
const beaconRequest = (s: Shopper, claim: string, version: string, label: string) => new Request('https://shop.invalid/realtime/action', { method: 'POST',
  headers: { 'X-Tenant': TENANT, [SHOPPER_HEADER]: s.grant.capability, 'Content-Type': 'application/json' },
  body: JSON.stringify({ type: 'carousel_exposure', source: 'sdk', userId: s.subject, sessionId: s.grant.sessionId, timestamp: Date.now(), eventId: crypto.randomUUID(),
    data: { page: 'pdp', slot: CAROUSEL, arm: claim, tableVersion: version, context: 'paid_social|1|mobile', images: PAINTED, pageInstance: pageInstanceOf(label) } }) });
/** The operator's learn queue, GET /v1/{tenant}/learn/queue, timed and not drained. */
const queueRequest = (m: Mounted) => new Request(`${OPERATOR_ORIGIN}/v1/${TENANT}/learn/queue?brand=${BRAND}`,
  { headers: { 'X-Tenant': TENANT, Authorization: `Bearer ${m.operatorToken}` } });
const armDrawOf = async (m: Mounted) => ((await asOperator(m, 'GET', `/v1/${TENANT}/learn/queue?brand=${BRAND}`)).body.arm_draw ?? null) as Counts | null;
async function tableVersion(m: Mounted): Promise<string> {
  const response = await m.fetch(new Request(`https://shop.invalid/v1/${TENANT}/context-table/pdp`, { headers: { 'X-Tenant': TENANT } }));
  const body = await response.json().catch(() => ({})) as { version?: unknown };
  return typeof body.version === 'string' ? body.version : '';
}
const armRequestOf = (a: Answered) => (a.body.armRequest ?? null) as { class?: string; honoured?: boolean; reason?: string } | null;
const beaconOf = (a: Answered) => [a.status, a.body.exposure ?? null, a.body.reason ?? a.body.images ?? null, a.body.armClaimed ?? null];
async function shoppers(m: Mounted, n: number): Promise<Shopper[]> {
  const out: Shopper[] = [];
  for (let k = 0; k < n; k++) out.push(await shopperOn(m));
  return out;
}
async function until(ready: () => boolean, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (!ready() && Date.now() < end) await sleep(10);
  return ready();
}
function gate(): { wait: Promise<void>; open: () => void } {
  let open!: () => void;
  const wait = new Promise<void>(resolve => { open = resolve; });
  return { wait, open };
}

// ---------------------------------------------------------------------------
// The stores as the platform has them, and what the tests read of the objects.
// ---------------------------------------------------------------------------

type KVGet = (key: string, type?: string) => Promise<unknown>;
/** R1: the operator cache answering a reader as deployed KV does (its 60-second read cache). Returns the restore. */
function operatorCacheAsDeployed(m: Mounted): () => void {
  const store = m.cache as unknown as { get: KVGet };
  const get = store.get.bind(store) as KVGet;
  const held = new Map<string, { at: number; value: unknown }>();
  store.get = async (key: string, type?: string) => {
    if (type === 'stream') return get(key, type);
    const slot = `${type ?? 'text'}\u0000${key}`, seen = held.get(slot);
    if (seen && Date.now() - seen.at < KV_READ_CACHE_MS) return structuredClone(seen.value);
    const value = await get(key, type);
    held.set(slot, { at: Date.now(), value: structuredClone(value) });
    return value;
  };
  return () => { store.get = get; };
}
/** Every operator-cache operation made while it is installed, as `<operation> <key>`. Returns the log and the restore. */
function operatorCacheLog(m: Mounted): { log: string[]; stop: () => void } {
  const store = m.cache as unknown as Record<'get' | 'put' | 'delete' | 'list', (...args: unknown[]) => Promise<unknown>>;
  const log: string[] = [], saved = { get: store.get, put: store.put, delete: store.delete, list: store.list };
  for (const op of ['get', 'put', 'delete', 'list'] as const) {
    const real = saved[op]!.bind(store);
    store[op] = async (...args: unknown[]) => {
      log.push(`${op} ${typeof args[0] === 'string' ? args[0] : JSON.stringify(args[0] ?? null)}`);
      return real(...args);
    };
  }
  return { log, stop: () => { Object.assign(store, saved); } };
}
const touchesArmDraw = (log: string[]) => log.filter(entry => entry.includes('arm-draw'));
/** What a LEARN_STATS object holds in storage, by key. */
const storedOf = (registry: Registry | undefined) => registry ? Object.fromEntries([...registry.data].map(([key, value]) => [key, structuredClone(value)])) : null;
const alarmOf = async (registry: Registry | undefined): Promise<number | null | string> =>
  registry ? (registry.object as unknown as { state: DurableObjectState }).state.storage.getAlarm() : 'no object';
/** Every LEARN_STATS object but the tenant's arm-draw object: its storage and its alarm. */
async function slotObjects(m: Mounted): Promise<Record<string, { stored: unknown; alarm: unknown }>> {
  const out: Record<string, { stored: unknown; alarm: unknown }> = {};
  for (const [name, registry] of [...m.stats].sort(([a], [b]) => a.localeCompare(b))) {
    if (name !== ARM_DRAW_OBJECT) out[name] = { stored: storedOf(registry), alarm: await alarmOf(registry) };
  }
  return out;
}
/** A call on the tenant's arm-draw object, as src/index.api-boundary.test.ts reaches an object: ns.get(ns.idFromName(name)).fetch(…). */
async function onObject(m: Mounted, path: string, body: unknown): Promise<{ status: number; body: unknown }> {
  const ns = m.env.LEARN_STATS!;
  const response = await ns.get(ns.idFromName(ARM_DRAW_OBJECT)).fetch(`https://learn${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body) });
  return { status: response.status, body: await response.json().catch(() => null) };
}
/** The arm-draw object starts again over its stored state, as an evicted object wakes (src/units/_parity9.ts restartObject's form). */
function restartArmDrawObject(m: Mounted): boolean {
  const registry = m.stats.get(ARM_DRAW_OBJECT);
  if (!registry) return false;
  const data = registry.data, alarms: number[] = [];
  const storage: Record<string, unknown> = {
    get: async (k: string | string[]) => structuredClone(Array.isArray(k) ? new Map(k.map(v => [v, data.get(v)])) : data.get(k)),
    put: async (k: string | Record<string, unknown>, v?: unknown) => {
      if (typeof k === 'string') data.set(k, structuredClone(v)); else for (const [key, value] of Object.entries(k)) data.set(key, structuredClone(value));
    },
    delete: async (k: string | string[]) => { for (const key of typeof k === 'string' ? [k] : k) data.delete(key); return true; },
    deleteAll: async () => { data.clear(); },
    list: async (o?: { prefix?: string }) => structuredClone(new Map([...data].filter(([key]) => key.startsWith(o?.prefix ?? '')).sort(([a], [b]) => a.localeCompare(b)))),
    getAlarm: async () => alarms.at(-1) ?? null,
    setAlarm: async (at: number) => { alarms.push(at); },
    deleteAlarm: async () => { alarms.length = 0; },
  };
  storage.transaction = async (run: (tx: unknown) => Promise<unknown>) => run(storage);
  const state = { id: ARM_DRAW_OBJECT, storage, getWebSockets: () => [], waitUntil: () => undefined } as unknown as DurableObjectState;
  registry.object = new LearnStats(state, m.env as Env) as unknown as Registry['object'];
  return true;
}

/**
 * AD3: the tenant's arm-draw object made unreachable for the leg — the binding absent (`missing`), or every call on the
 * arm-draw name rejecting (`rejecting`) or never answering until aborted (`hanging`, R3); every other object of the
 * binding as before. `calls` names each call made on the arm-draw name and whether it has settled.
 */
type Fault = 'missing' | 'rejecting' | 'hanging';
function counterFault(m: Mounted, fault: Fault): { calls: Array<{ path: string; settled: boolean }>; restore: () => void } {
  const env = m.env as unknown as Record<string, unknown>, base = m.env.LEARN_STATS!;
  const calls: Array<{ path: string; settled: boolean }> = [], held: Array<() => void> = [];
  const faulty = { fetch: (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = input instanceof Request ? input.url : String(input), signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    const call = { path: new URL(url).pathname, settled: false };
    calls.push(call);
    if (fault === 'rejecting') { call.settled = true; return Promise.reject(new Error('arm-draw object unavailable')); }
    return new Promise<Response>((_, reject) => {
      const fail = () => { if (call.settled) return; call.settled = true; reject(new DOMException('The operation was aborted.', 'AbortError')); };
      held.push(fail);
      signal?.addEventListener('abort', fail, { once: true });
      if (signal?.aborted) fail();
    });
  } };
  if (fault === 'missing') delete env.LEARN_STATS;
  else env.LEARN_STATS = { idFromName: (name: string) => base.idFromName(name), get: (target: DurableObjectId) => String(target) === ARM_DRAW_OBJECT ? faulty : base.get(target) };
  return { calls, restore: () => { for (const fail of held.splice(0)) fail(); env.LEARN_STATS = base; } };
}
/**
 * R-P503: the tenant's arm-draw object answering nothing until `release()`, which hands every call still held to the
 * object as it was made; a call its caller aborts meanwhile fails as the platform's would; every other object as before.
 */
function counterHeld(m: Mounted): { calls: Array<{ path: string; settled: boolean }>; release: () => void } {
  const env = m.env as unknown as Record<string, unknown>, base = m.env.LEARN_STATS!;
  const calls: Array<{ path: string; settled: boolean }> = [], opened = gate();
  const held = { fetch: (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = input instanceof Request ? input.url : String(input), signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    const call = { path: new URL(url).pathname, settled: false };
    calls.push(call);
    return new Promise<Response>((resolve, reject) => {
      signal?.addEventListener('abort', () => { if (!call.settled) { call.settled = true; reject(new DOMException('The operation was aborted.', 'AbortError')); } }, { once: true });
      void opened.wait.then(async () => {
        if (call.settled) return;
        try { const answer = await base.get(base.idFromName(ARM_DRAW_OBJECT)).fetch(input, init); call.settled = true; resolve(answer); }
        catch (error) { call.settled = true; reject(error); }
      });
    });
  } };
  env.LEARN_STATS = { idFromName: (name: string) => base.idFromName(name), get: (target: DurableObjectId) => String(target) === ARM_DRAW_OBJECT ? held : base.get(target) };
  return { calls, release: () => { env.LEARN_STATS = base; opened.open(); } };
}

// ===========================================================================
// unit:P94.AD1 — a burst of every reason, issued together, counted in full on both hosts
// ===========================================================================

describe('unit:P94.AD1', () => {
  for (const host of HOSTS) {
    it(`host (${host}): a burst issued together for one tenant — four first requests drawn default at a one-in-a-billion holdout (capped), four drawn personalized whose decision pins a learn publication made after their mint moved every identifier to default (republished), four drawn personalized reaching the engine after it (mismatch), four requests carrying a session and naming a class (ignored), four P85 carousel beacons claiming default for shoppers the engine personalizes (mismatch) — and the learn queue's arm_draw afterwards equals, reason by reason, what the burst produced (the operator cache read as deployed KV answers it, R1)`, async () => {
      const N = 4, REPUBLISHED = 'p94-republished';
      const m = await mount(host, docsAt(TINY));
      expectPublished(m, 'P94.AD1 — P84\'s product page publishes at a one-in-a-billion holdout');
      const version = await tableVersion(m);
      expect(version, `${host}: PRECONDITION P84 — the context table answers its version`).toMatch(/^[a-f0-9]{64}$/);
      const asking = await shoppers(m, N), beaconing = await shoppers(m, N);
      // R2: the republished requests are held at their forward to the shopper's object, after the mint read the holdout.
      const env = m.env as unknown as Record<string, unknown>, objects = m.env.SHOPPER_REFLEX;
      const forwards = gate(), parked = { n: 0 };
      env.SHOPPER_REFLEX = { idFromName: (name: string) => objects.idFromName(name), get: (target: DurableObjectId) => {
        const stub = objects.get(target);
        return { fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
          const request = new Request(input, init);
          if (request.url.endsWith('/authority/request') && (await request.clone().text()).includes(REPUBLISHED)) { parked.n += 1; await forwards.wait; }
          return stub.fetch(request);
        } };
      } };
      const late = gate();
      const restoreCache = operatorCacheAsDeployed(m);
      let republication = { status: 0, body: {} as Record<string, unknown> };
      let answers: Record<'capped' | 'republished' | 'late' | 'ignored' | 'beacons', Answered[]> | null = null;
      try {
        // The burst: every request created in this one turn, none awaiting another.
        const capped = Array.from({ length: N }, (_, k) => send(m, firstRequest('default', version, `p94-capped-${k}`)));
        const republished = Array.from({ length: N }, (_, k) => send(m, firstRequest('personalized', version, `${REPUBLISHED}-${k}`)));
        const lateOnes = Array.from({ length: N }, (_, k) => late.wait.then(() => send(m, firstRequest('personalized', version, `p94-late-${k}`))));
        const ignored = asking.map((s, k) => send(m, askedRequest(s, 'default', version, `p94-ignored-${k}`)));
        const beacons = beaconing.map((s, k) => send(m, beaconRequest(s, 'default', version, `p94-beacon-${k}`)));
        // As it runs: the first answers in and the republished mints parked, the operator republishes the learn document
        // (a holdout of 1: every identifier default), then the parked forwards and the late requests go on together.
        const early = await Promise.all([Promise.all(capped), Promise.all(ignored), Promise.all(beacons)]);
        await until(() => parked.n >= N, 30_000);
        republication = await putDocument(m, 'learn', learnOf(1), 'p94 republished mid-burst');
        forwards.open(); late.open();
        const [afterRepublished, afterLate] = await Promise.all([Promise.all(republished), Promise.all(lateOnes)]);
        answers = { capped: early[0], republished: afterRepublished, late: afterLate, ignored: early[1], beacons: early[2] };
        await m.drain();
      } finally { env.SHOPPER_REFLEX = objects; forwards.open(); late.open(); }
      const counted = await armDrawOf(m);
      restoreCache();
      expect([republication.status, parked.n], `${host}: PRECONDITION — the learn republication lands while the ${N} republished requests are parked (${show(republication.body)})`).toEqual([200, N]);
      // What the burst produced, from its own answers: each first answer's armRequest reason, each ignored answer, and each
      // beacon whose claimed class differs from the engine's own arm for that shopper (armFor over the shopper's anchor, P85 R-P393).
      const produced: Counts = { ...ZERO };
      for (const a of [...answers!.capped, ...answers!.republished, ...answers!.late, ...answers!.ignored]) {
        const reason = armRequestOf(a)?.reason;
        if (reason && reason in produced) produced[reason as keyof Counts] += 1;
      }
      beaconing.forEach((s, k) => { if (answers!.beacons[k]!.status === 200 && classOf(armFor(s.subject, holdoutOf(TINY))) !== 'default') produced.mismatch += 1; });
      expect.soft({
        capped: answers!.capped.map(a => [a.status, armRequestOf(a)]), republished: answers!.republished.map(a => [a.status, armRequestOf(a)]),
        late: answers!.late.map(a => [a.status, armRequestOf(a)]), ignored: answers!.ignored.map(a => [a.status, armRequestOf(a)?.reason ?? null]),
        beacons: answers!.beacons.map(beaconOf),
      }, `${host}: P94.AD1 — the burst produced what it was built to (P84's and P85's answers)`).toEqual({
        capped: Array(N).fill([200, { class: 'default', honoured: false, reason: 'capped' }]),
        republished: Array(N).fill([200, { class: 'personalized', honoured: false, reason: 'republished' }]),
        late: Array(N).fill([200, { class: 'personalized', honoured: false, reason: 'mismatch' }]),
        ignored: Array(N).fill([200, 'ignored']),
        beacons: Array(N).fill([200, 'admitted', PAINTED.length, 'default']),
      });
      expect.soft(counted, `${host}: P94.AD1 — the learn queue's arm_draw is the burst's count reason by reason (${show(produced)}); today a KV read-then-write on a read-cached document loses the increments`)
        .toEqual(produced);
    }, 180_000);
  }
});

// ===========================================================================
// unit:P94.AD2 — the count a durable increment on the per-tenant object: its name, its key, its shape, its window
// ===========================================================================

describe('unit:P94.AD2', () => {
  for (const host of HOSTS) {
    it(`host (${host}): draws through the real paths (two first requests whose class a holdout of 0 cannot meet, two requests carrying a session and naming a class, a beacon whose claim differs from the engine's arm) are held by the LEARN_STATS object named arm-draw:v1:${TENANT} — one storage key armDraw { version: 1, since, capped, ignored, mismatch, republished }, no alarm — which the queue reads; no slot object holds them and the operator cache is neither read nor written for them; nothing names a visitor, a session or a class; a tenant with no draw reads zeros`, async () => {
      const fresh = await mount(host, docsAt(0));
      expectPublished(fresh, 'P94.AD2 — the documents publish');
      expect.soft(await armDrawOf(fresh), `${host}: P94.AD2 — a tenant with no draw reads zeros in the shape`).toEqual(ZERO);
      const m = await mount(host, docsAt(0));
      expectPublished(m, 'P94.AD2 — the documents publish');
      const version = await tableVersion(m);
      expect(version, `${host}: PRECONDITION P84 — the context table answers its version`).toMatch(/^[a-f0-9]{64}$/);
      const [first, second, third] = await shoppers(m, 3);
      const watched = operatorCacheLog(m);
      const started = Date.now();
      const made: Answered[] = [];
      try {
        for (let k = 0; k < 2; k++) { made.push(await send(m, firstRequest('default', version, `p94-ad2-first-${k}`))); await m.drain(); }
        for (const s of [first!, second!]) { made.push(await send(m, askedRequest(s, 'personalized', version, 'p94-ad2-asked'))); await m.drain(); }
        made.push(await send(m, beaconRequest(third!, 'default', version, 'p94-ad2-beacon'))); await m.drain();
      } finally { watched.stop(); }
      const ended = Date.now();
      const reasons = made.slice(0, 4).map(a => armRequestOf(a)?.reason ?? null);
      expect([...reasons, beaconOf(made[4]!)], `${host}: PRECONDITION P84/P85 — two mismatched first requests, two ignored, one beacon admitted with its claim`)
        .toEqual(['mismatch', 'mismatch', 'ignored', 'ignored', [200, 'admitted', PAINTED.length, 'default']]);
      const reading = operatorCacheLog(m);
      const counted = await armDrawOf(m);
      reading.stop();
      const expected: Counts = { capped: 0, ignored: 2, mismatch: 3, republished: 0 };
      const registry = m.stats.get(ARM_DRAW_OBJECT);
      const stored = storedOf(registry) as { armDraw?: { since?: unknown } } | null;
      const since = stored?.armDraw?.since;
      const within = typeof since === 'number' && since >= started && since <= ended;
      expect.soft({ counted, stored: stored && { ...stored, ...(stored.armDraw ? { armDraw: { ...stored.armDraw, since: within ? 'within the draws' : since } } : {}) }, alarm: await alarmOf(registry) },
        `${host}: P94.AD2 — the queue reads the object's own count, held on its one key with no alarm (today the count is a KV document and no such object exists: ${show([...m.stats.keys()])})`)
        .toEqual({ counted: expected, stored: { armDraw: { version: 1, since: 'within the draws', ...expected } }, alarm: null });
      const others = await slotObjects(m);
      expect.soft({ slotNames: Object.keys(others).filter(name => !name.startsWith(`${TENANT}:${BRAND}:`)), holding: Object.keys(others).filter(name => Object.hasOwn((others[name]!.stored ?? {}) as object, 'armDraw')),
        cache: [...touchesArmDraw(watched.log), ...touchesArmDraw(reading.log)] }, `${host}: P94.AD2 — never a slot's name or state; the KV document neither read nor written (point 1)`)
        .toEqual({ slotNames: [], holding: [], cache: [] });
      const words = JSON.stringify({ stored, counted });
      const named = [first!, second!, third!].flatMap(s => [s.subject, s.grant.sessionId]).filter(value => words.includes(value));
      expect.soft({ named, classes: /default|personalized|ineligible/.test(words) }, `${host}: P94.AD2 — the count names no visitor, session or class`).toEqual({ named: [], classes: false });
    }, 180_000);

    it(`host (${host}): the object's two paths — POST /arm-draw/record { reason, now } answers the counts after its increment and POST /arm-draw/read { now } answers exactly { capped, ignored, mismatch, republished }; an unknown reason is refused 400 and never counted; forty records issued together are all counted (the increment serialized); the count survives the object starting again over its storage (never in memory only); the thirty-day window — counted a day before the horizon, zeros a day past it, a record past it starting a new window at its now, and a record whose now is earlier than the window's since counted in it (R4); one key, no alarm; a read writes nothing to the object's storage, on an object with no draw and past the horizon (R7)`, async () => {
      const m = await mount(host, docsAt(0));
      expectPublished(m, 'P94.AD2 — the documents publish');
      const T = Date.now();
      const record = (reason: unknown, now: number) => onObject(m, '/arm-draw/record', reason === undefined ? { now } : { reason, now });
      const read = (now: number) => onObject(m, '/arm-draw/read', { now });
      const registry = () => m.stats.get(ARM_DRAW_OBJECT);
      const first = await read(T);
      expect.soft({ read: first, stored: storedOf(registry()) ?? {} }, `${host}: P94.AD2 — an object with no draw reads zeros and its read writes nothing (R7)`)
        .toEqual({ read: { status: 200, body: ZERO }, stored: {} });
      const sequential = [await record('capped', T), await record('capped', T + 1_000), await record('ignored', T + DAY_MS)];
      expect.soft(sequential, `${host}: P94.AD2 — each record answers the counts after its increment (today the object has no such path: ${show(sequential[0])})`).toEqual([
        { status: 200, body: { ...ZERO, capped: 1 } }, { status: 200, body: { ...ZERO, capped: 2 } }, { status: 200, body: { ...ZERO, capped: 2, ignored: 1 } }]);
      const refused: Array<[unknown, number]> = [];
      for (const reason of ['holdout', 'Capped', '', '__proto__', 'constructor', 'toString', 'hasOwnProperty', 7, null, undefined]) refused.push([reason ?? String(reason), (await record(reason, T + DAY_MS)).status]);
      expect.soft({ refused, read: await read(T + 29 * DAY_MS) }, `${host}: P94.AD2 — an unknown reason refused 400, nothing counted; the read a day before the horizon answers the window`)
        .toEqual({ refused: refused.map(([reason]) => [reason, 400]), read: { status: 200, body: { ...ZERO, capped: 2, ignored: 1 } } });
      const burst = await Promise.all(REASONS.flatMap(reason => Array.from({ length: 10 }, (_, k) => record(reason, T + 2 * DAY_MS + k))));
      expect.soft({ statuses: [...new Set(burst.map(a => a.status))], read: await read(T + 29 * DAY_MS), stored: storedOf(registry()), alarm: await alarmOf(registry()) },
        `${host}: P94.AD2 — forty records issued together all counted, on the one key armDraw, no alarm armed`).toEqual({ statuses: [200],
        read: { status: 200, body: { capped: 12, ignored: 11, mismatch: 10, republished: 10 } },
        stored: { armDraw: { version: 1, since: T, capped: 12, ignored: 11, mismatch: 10, republished: 10 } }, alarm: null });
      const restarted = restartArmDrawObject(m);
      expect.soft({ restarted, read: await read(T + 29 * DAY_MS) }, `${host}: P94.AD2 — durable: the object started again over its storage answers the same count`)
        .toEqual({ restarted: true, read: { status: 200, body: { capped: 12, ignored: 11, mismatch: 10, republished: 10 } } });
      const past = T + HORIZON_MS + DAY_MS;
      const pastRead = await read(past);
      const afterPastRead = storedOf(registry());
      const renewed = await record('mismatch', past);
      const lateClock = await record('capped', past - 1_000);
      expect.soft({ pastRead, afterPastRead, renewed, lateClock, read: await read(past), stored: storedOf(registry()) },
        `${host}: P94.AD2 — the window: zeros a day past thirty days and that read writes nothing (R7), a record there starts a new window at its now, a record whose now precedes that since counts in it (R4)`)
        .toEqual({ pastRead: { status: 200, body: ZERO }, afterPastRead: { armDraw: { version: 1, since: T, capped: 12, ignored: 11, mismatch: 10, republished: 10 } }, renewed: { status: 200, body: { ...ZERO, mismatch: 1 } }, lateClock: { status: 200, body: { ...ZERO, capped: 1, mismatch: 1 } },
          read: { status: 200, body: { ...ZERO, capped: 1, mismatch: 1 } }, stored: { armDraw: { version: 1, since: past, ...ZERO, capped: 1, mismatch: 1 } } });
    }, 120_000);

    it(`host (${host}): a draw touches no slot object — with the carousel's statistics object holding exposures and its keep-warm alarm (an admitted P85 beacon), twelve draws recorded together through recordArmDraw (the function the request path runs) and a read through readArmDraw leave every slot object's storage and alarm as they were; the arm-draw object holds the twelve on its one key with no alarm; the operator cache untouched`, async () => {
      const m = await mount(host, docsAt(0));
      expectPublished(m, 'P94.AD2 — the documents publish');
      const version = await tableVersion(m);
      const [s] = await shoppers(m, 1);
      const admitted = await send(m, beaconRequest(s!, 'personalized', version, 'p94-ad2-slot'));
      await m.drain();
      const before = await slotObjects(m);
      expect([beaconOf(admitted), Object.keys(before).some(name => name.endsWith(`:${CAROUSEL}`))], `${host}: PRECONDITION P85 — the beacon is admitted and the carousel's statistics object exists`)
        .toEqual([[200, 'admitted', PAINTED.length, 'personalized'], true]);
      const watched = operatorCacheLog(m);
      const now = Date.now();
      await Promise.all(REASONS.flatMap(reason => Array.from({ length: 3 }, () => recordArmDraw(m.env, TENANT, reason, now))));
      const counted = await readArmDraw(m.env, TENANT, now);
      watched.stop();
      await m.drain();
      const registry = m.stats.get(ARM_DRAW_OBJECT);
      expect.soft({ slots: await slotObjects(m), counted, keys: Object.keys(storedOf(registry) ?? {}), alarm: await alarmOf(registry), cache: touchesArmDraw(watched.log) },
        `${host}: P94.AD2 — the slot objects as before, the count on the arm-draw object alone (point 3)`)
        .toEqual({ slots: before, counted: { capped: 3, ignored: 3, mismatch: 3, republished: 3 }, keys: ['armDraw'], alarm: null, cache: [] });
    }, 120_000);
  }
});

// ===========================================================================
// unit:P94.AD3 — off the shopper's time: a counter that cannot be reached fails and delays nothing
// ===========================================================================

describe('unit:P94.AD3', () => {
  for (const host of HOSTS) {
    for (const fault of ['missing', 'rejecting', 'hanging'] as const) {
      const what = fault === 'missing' ? 'the LEARN_STATS binding absent' : fault === 'rejecting' ? 'every call on the arm-draw object rejecting' : 'every call on the arm-draw object never answering';
      it(`host (${host}): ${what} — a first request (mismatch), a request carrying a session and naming a class (ignored) and a P85 beacon (mismatch) answer as they do with the counter healthy, and the learn queue answers 200 with arm_draw zeros in the shape; ${fault === 'hanging' ? `the first request answers while its record is still unanswered (after the answer); the first request, the request carrying a session and the beacon answer no later than with the counter healthy, and only the learn queue's read waits, no longer than ARM_DRAW_READ_BOUND_MS (2,000 ms, R3 as ruled by R-P503)` : 'no answer waits on the counter'}`, async () => {
        const m = await mount(host, docsAt(0));
        expectPublished(m, 'P94.AD3 — the documents publish');
        const version = await tableVersion(m);
        expect(version, `${host}: PRECONDITION P84 — the context table answers its version`).toMatch(/^[a-f0-9]{64}$/);
        if (fault === 'hanging') expect.soft(ARM_DRAW_READ_BOUND_MS, `${host}: P94.AD3 — the bound is a code constant of src/content/holdout.ts, 2,000 ms (point 4)`).toBe(2_000);
        const [asking, beaconing] = await shoppers(m, 2);
        const round = async (label: string, within: number, settledAtDoor: () => boolean = () => false) => {
          const door = await send(m, firstRequest('default', version, `p94-ad3-${label}-door`), within);
          const recordSettledAtDoor = settledAtDoor();
          const asked = await send(m, askedRequest(asking!, 'personalized', version, `p94-ad3-${label}-asked`), within);
          const beacon = await send(m, beaconRequest(beaconing!, 'default', version, `p94-ad3-${label}-beacon`), within);
          const queue = await send(m, queueRequest(m), within);
          return { door, recordSettledAtDoor, asked, beacon, queue };
        };
        const healthy = await round('healthy', 60_000);
        await m.drain();
        const slowest = Math.max(healthy.door.ms, healthy.asked.ms, healthy.beacon.ms, healthy.queue.ms);
        const broken = counterFault(m, fault);
        let faulted: Awaited<ReturnType<typeof round>> | null = null;
        try {
          faulted = await round('faulted', slowest + BOUND_MS + 5_000, () => broken.calls.some(call => call.path === '/arm-draw/record' && call.settled));
        } finally { broken.restore(); }
        // The work handed on after the answers settles once the fault is lifted: a record never rejects (point 4).
        const afterwork = await Promise.race([m.drain().then(() => 'settled', (error: unknown) => `rejected: ${(error as Error).message}`), sleep(10_000).then(() => 'still pending 10 s later')]);
        const members = (r: Awaited<ReturnType<typeof round>>) => ({ door: [r.door.status, armRequestOf(r.door)], asked: [r.asked.status, armRequestOf(r.asked), (r.asked.body.experiment as { arm?: string } | undefined)?.arm ?? null],
          beacon: beaconOf(r.beacon), queue: [r.queue.status, r.queue.body.ok ?? null, Object.keys(r.queue.body).sort()] });
        expect.soft(members(faulted!), `${host}: P94.AD3 — ${what}: every answer as with the counter healthy`).toEqual(members(healthy));
        expect.soft(afterwork, `${host}: P94.AD3 — ${what}: the record handed on after the answer never rejects`).toBe('settled');
        expect.soft(faulted!.queue.body.arm_draw ?? null, `${host}: P94.AD3 — ${what}: the queue answers zeros in the shape (today the count is a KV document the fault does not reach: ${show(faulted!.queue.body.arm_draw)})`).toEqual(ZERO);
        if (fault !== 'missing') {
          expect.soft([...new Set(broken.calls.map(call => call.path))].sort(), `${host}: P94.AD3 — ${what}: the record and the read were asked of the arm-draw object (point 2)`)
            .toEqual(['/arm-draw/read', '/arm-draw/record']);
        }
        const allowed = fault === 'hanging' ? BOUND_MS + NOISE_MS : NOISE_MS;
        const late = (name: 'asked' | 'beacon' | 'queue') => faulted![name].ms - healthy[name].ms;
        expect.soft({ door: faulted!.door.ms - healthy.door.ms <= NOISE_MS, asked: late('asked') <= NOISE_MS, beacon: late('beacon') <= NOISE_MS, queue: late('queue') <= allowed,
          ...(fault === 'hanging' ? { afterTheAnswer: !faulted!.recordSettledAtDoor && broken.calls.some(call => call.path === '/arm-draw/record') } : {}) },
        `${host}: P94.AD3 — ${what}: the first request, the request carrying a session and the beacon within ${NOISE_MS} ms of healthy, the queue within ${allowed} ms (door ${Math.round(healthy.door.ms)} → ${Math.round(faulted!.door.ms)} ms, asked ${Math.round(healthy.asked.ms)} → ${Math.round(faulted!.asked.ms)}, beacon ${Math.round(healthy.beacon.ms)} → ${Math.round(faulted!.beacon.ms)}, queue ${Math.round(healthy.queue.ms)} → ${Math.round(faulted!.queue.ms)} ms)`)
          .toEqual({ door: true, asked: true, beacon: true, queue: true, ...(fault === 'hanging' ? { afterTheAnswer: true } : {}) });
      }, 120_000);
    }

    for (const kind of ['ignored', 'mismatch'] as const) {
      const what = kind === 'ignored' ? 'a decision request carrying the shopper\'s session and naming the other class (ignored)' : 'a P85 carousel beacon whose claimed class differs from the engine\'s arm (mismatch)';
      it(`host (${host}): R-P503 — under a counter that does not answer until released, ${what} is answered in its ordinary time, within ${ANSWER_BOUND_MS} ms, its record not settled when it answers (the shopper's owner never waits on the counter); once the object answers, the learn queue reads the count`, async () => {
        const m = await mount(host, docsAt(0));
        expectPublished(m, 'P94.AD3 — the documents publish');
        const version = await tableVersion(m);
        expect(version, `${host}: PRECONDITION P84 — the context table answers its version`).toMatch(/^[a-f0-9]{64}$/);
        const [s] = await shoppers(m, 1);
        const held = counterHeld(m);
        let answered = NO_ANSWER(0), settledAtAnswer = true;
        try {
          answered = await send(m, kind === 'ignored' ? askedRequest(s!, 'default', version, 'p94-ad3-held-asked') : beaconRequest(s!, 'default', version, 'p94-ad3-held-beacon'), BOUND_MS + 5_000);
          settledAtAnswer = held.calls.some(call => call.path === '/arm-draw/record' && call.settled);
        } finally { held.release(); }
        await Promise.race([m.drain(), sleep(10_000)]);
        const counted = await armDrawOf(m);
        expect.soft({ answer: kind === 'ignored' ? [answered.status, armRequestOf(answered)] : beaconOf(answered), ordinaryTime: answered.ms <= ANSWER_BOUND_MS,
          recordAfterTheAnswer: !settledAtAnswer && held.calls.some(call => call.path === '/arm-draw/record'), counted },
        `${host}: P94.AD3 — R-P503: answered in ${Math.round(answered.ms)} ms while the counter held its record (today the record is a KV write the held object never sees; a record kept as owner work holds the answer until the bound and is lost)`)
          .toEqual({ answer: kind === 'ignored' ? [200, { class: 'default', honoured: false, reason: 'ignored' }] : [200, 'admitted', PAINTED.length, 'default'],
            ordinaryTime: true, recordAfterTheAnswer: true, counted: { ...ZERO, [kind]: 1 } });
      }, 120_000);
    }
  }

  it('logic: LOCK — never for a synthetic operation (R6): every record of a draw in src/routes/decisions.ts and src/content/service.ts is reached only outside one (decisions.ts countArmDraw returns at once for a synthetic operation; the beacon records its mismatch under !syntheticOperation()), and the first-request door and the decision route still count through countArmDraw, which hands the record to the platform\'s waitUntil', () => {
    const decisions = readFileSync(new URL('src/routes/decisions.ts', ROOT), 'utf8'), service = readFileSync(new URL('src/content/service.ts', ROOT), 'utf8');
    /** Each line calling recordArmDraw (imports aside), with the three lines before it. */
    const records = (text: string) => text.split('\n').flatMap((line, i, lines) => line.includes('recordArmDraw(') && !/^\s*import\b/.test(line) ? [lines.slice(Math.max(0, i - 3), i + 1).join('\n')] : []);
    const fromDecisions = records(decisions), fromService = records(service);
    expect({ decisions: fromDecisions.length > 0 && fromDecisions.every(lines => /syntheticOperation\(\)/.test(lines)), service: fromService.length > 0 && fromService.every(lines => /!syntheticOperation\(\)/.test(lines)),
      waitUntil: /function countArmDraw\([\s\S]{0,400}?c\.executionCtx\.waitUntil\(counted\)/.test(decisions), callers: (decisions.match(/countArmDraw\(c, tenant, /g) ?? []).length },
    'P94.AD3 — LOCK: the synthetic guard on every record, the door\'s waitUntil hand-off kept').toEqual({ decisions: true, service: true, waitUntil: true, callers: 2 });
  });
});

// ===========================================================================
// unit:P94.AD4 — the kit states the exact count
// ===========================================================================

describe('unit:P94.AD4', () => {
  it('logic: kit 02\'s learn-queue sentence states arm_draw { capped, ignored, mismatch, republished } as an exact count of every reason over thirty days that names no visitor; "read as a floor" is gone from it and from every sentence naming arm_draw; enrollment_anchor_unavailable keeps its own floor sentence (W21 B2\'s lock)', () => {
    const kit = readTree('docs/kit/02-api-reference.md');
    const sentences = kit.replace(/\s+/g, ' ').split(/(?<=\.)\s+(?=[A-Z`])/);
    const defining = sentences.filter(s => s.includes('`arm_draw`') && s.includes('`{ capped, ignored, mismatch, republished }`'));
    const sentence = defining[0] ?? '';
    expect.soft({ sentences: defining.length, exact: /\bexact count\b/i.test(sentence), everyReason: /\bevery reason\b/i.test(sentence), thirtyDays: /\bthirty days\b/i.test(sentence),
      noVisitor: /\bnames no visitor\b/i.test(sentence), floor: /\bfloor\b/i.test(sentence) }, `P94.AD4 — the sentence: "${sentence}"`)
      .toEqual({ sentences: 1, exact: true, everyReason: true, thirtyDays: true, noVisitor: true, floor: false });
    expect.soft(sentences.filter(s => s.includes('arm_draw') && /\bfloor\b|lower bound/i.test(s)), 'P94.AD4 — no sentence naming arm_draw reads it as a floor').toEqual([]);
    expect.soft(kit.includes(ENROLLMENT_FLOOR), 'P94.AD4 — LOCK: enrollment_anchor_unavailable keeps its own floor sentence, untouched').toBe(true);
  });
});

// src/units/_parity9.ts
// The ninth shared harness of the parity unit files: what the S11 tickets of the
// lift-witness programme (amendment 6), P61 and P62, need beyond
// src/units/_parity.ts, _parity3.ts and _parity6.ts, which are pinned by receipted
// tickets and never edited here.
//
// It holds no expected value of any ticket. Over the environment `mount`
// (src/units/_parity.ts:238-337) builds, it adds:
//   · THE LIFT WORLD: P08's pooled world as P42.PW3 drives it
//     (src/units/P42/LEDGER.unit.test.ts:343-352: two product-page visits and one
//     home-page visit, every placement published through its own door), with a
//     fatigue dial on the product page's slot so that a product-page decision reads
//     the visitor's ring (src/content/service.ts:906-908); the home page carries no
//     fatigue dial, so a home-page decision reads no ring.
//   · LEVERS on the bindings the mounted app holds, each installed after `mount`
//     and undone by its own restore:
//       - a door lever on the statistics or ring objects (`LEARN_STATS`,
//         `DECISION_RING`): the named doors (`/health` and `/witness`, or `/recent`)
//         answered N ms late (an abort from the caller ends the wait, as a real
//         fetch does), or failing with an error, every other door untouched, every
//         call to a named door logged with the object's name;
//       - the copy lever: the key-value store answering one key with given text
//         (an older publication the edge still holds, or a forged one);
//       - a key-value read log;
//       - the clock lever: `Date.now()` moved ahead by N ms for the work it runs
//         (timers stay real);
//       - the object's alarm, fired as the platform fires it; and its PUBLICATION alarm
//         (`firePublicationAlarm`, S18 R10, R-P195): fired at the pending publication's due
//         time, the clock moved there for that run only;
//       - an object restart: a fresh `LearnStats` over the same stored state, as an
//         evicted object starts again, its storage recording every key read and
//         written;
//       - W23 H1.01's damage (src/units/W23/B1.unit.test.ts:1366-1373: every counter
//         of the slot anchored thirty days ahead of the object's clock);
//       - a digest log: the byte length of every SHA-256 the process computes
//         (crypto.subtle.digest, src/ledger/recovery.ts:41-44 `recoveryDigest`).
//   · READERS of the answer's `sources` members, of a decision's stored record, of
//     the monitor's run, and of the named constants of src/learn/fan.ts, read
//     loosely so that a constant a later ticket rules is no type error before it
//     exists (the P56.AA2 idiom, src/units/P56/LEDGER.unit.test.ts:273).
// Documents are read from the tree this file lives in, never the working directory.

import { expect, vi } from 'vitest';

import { invalidateLiftCache } from '@/content/service';
import type { DecisionRecord } from '@/content/types';
import { LearnStats } from '@/durable-objects/LearnStats';
import { liftKey, statsName } from '@/learn/fan';
import type { Env } from '@/types/env';

import {
  asOperator, BRAND, expectPublished, mount, PAID_SOCIAL_ENTRY, pageInstanceOf, shopperOn, storedDecisions, TENANT, VIEW_TABBY_26,
  type Decision, type Host, type Mounted, type Registry, type Shopper, type Snapshot,
} from './_parity';
import { publishStats } from './_parity3';
import { HOME_MODULES, P08_LEARN, P08_PIECES, P08_SLOTS, PDP_MODULES, POOLED, visit } from './_parity6';

export { HOME_MODULES, PDP_MODULES, POOLED };

// ---------------------------------------------------------------------------
// The lift world.
// ---------------------------------------------------------------------------

/** The fatigue dial on the product page's slot (P10's dial, src/units/P10/LEDGER.unit.test.ts:284). */
export const FATIGUE = { weight: 0.5, windowHours: 24, cap: 2 };
/** P08's pages (src/units/_parity6.ts), the product page's slot carrying the fatigue dial. */
export const LIFT_SLOTS = { version: 'parity-s11-slots', governanceVersion: 3, pages: {
  pdp: [{ ...P08_SLOTS.pages.pdp[0]!, fatigue: FATIGUE }], home: [...P08_SLOTS.pages.home] } };
/** P08's learn document: rendered-v1, reward click, γ 1, nMin 2 (src/units/_parity6.ts). */
export const LIFT_LEARN = P08_LEARN;
export const LIFT_PIECES = P08_PIECES;

/** A publication the object made, as the key-value store holds it: its version, its time and its exact text. */
export interface Copy { version: number; publishedAt: number; raw: string }

/** The copy the key-value store holds for a placement now (the object's last publication), or null. */
export function copyOf(m: Mounted, slot: string = PDP_MODULES): Copy | null {
  const raw = m.cache.data.get(liftKey(TENANT, BRAND, slot));
  if (raw === undefined) return null;
  const parsed = JSON.parse(raw) as { version: number; publishedAt: number };
  return { version: parsed.version, publishedAt: parsed.publishedAt, raw };
}

/**
 * The lift world on one host: the documents published, two product-page visits and
 * one home-page visit (each acknowledged in full, the pooled and shared modules
 * clicked: src/units/_parity6.ts `visit`), then, unless `publish` is false, every
 * placement published through its own `/publish` door. The isolate's lift cache is
 * dropped afterwards, as P42.PW3 drops it (src/units/P42/LEDGER.unit.test.ts:362),
 * because the visits' own decisions cached the "no copy" the store held then.
 */
export async function liftWorld(host: Host, opts: { publish?: boolean } = {}): Promise<{ m: Mounted; v1: Copy | null }> {
  const m = await mount(host, { pieces: LIFT_PIECES, slots: LIFT_SLOTS, learn: LIFT_LEARN });
  expectPublished(m, 'S11 — P08\'s catalogue, its pages with the product page\'s fatigue dial and its learn document publish');
  await visit(m, 'pdp'); await visit(m, 'pdp'); await visit(m, 'home');
  if (opts.publish !== false) await publishStats(m);
  invalidateLiftCache();
  const v1 = copyOf(m);
  if (opts.publish !== false) expect(v1?.version, `PRECONDITION (${host}): the product page's placement published a copy`).toBeGreaterThan(0);
  return { m, v1 };
}

/**
 * New evidence on the product page (one more visit, acknowledged and clicked) and then the placement's alarm, which
 * publishes: its publication alarm, fired at the publication's due time (`firePublicationAlarm`; S18 R10, R-P195).
 */
export async function republish(m: Mounted, slot: string = PDP_MODULES): Promise<Copy> {
  const before = copyOf(m, slot);
  await visit(m, slot === HOME_MODULES ? 'home' : 'pdp');
  await firePublicationAlarm(m, slot);
  const after = copyOf(m, slot);
  expect(after && before && after.version !== before.version ? 'republished' : `not republished (${before?.version} → ${after?.version})`,
    `PRECONDITION (${m.host}): new evidence and the placement's alarm publish a new version`).toBe('republished');
  return after!;
}

// ---------------------------------------------------------------------------
// A decision, through the route production serves.
// ---------------------------------------------------------------------------

export interface Decided {
  shopper: Shopper;
  /** The answer of `POST /v1/:tenant/decisions/snapshot`. */
  snapshot: Snapshot;
  /** The pooled module's decision on the answer (the module whose learned lift the world holds), if served. */
  decision: Decision | undefined;
  /** That decision's record, as the real consumer stored it after its render acknowledgement (P42.PW3's path). */
  record: DecisionRecord | undefined;
}

/**
 * One page view through `POST /v1/:tenant/decisions/snapshot` (with a page
 * instance, so the rendered-v1 decisions are offered for acknowledgement), by a
 * new consenting shopper who viewed a Tabby bag first unless `shopper` is given.
 * The pooled module's decision is acknowledged and its stored record read back,
 * unless `ack` is false.
 */
export async function decide(m: Mounted, page: 'pdp' | 'home', opts: { shopper?: Shopper; ack?: boolean } = {}): Promise<Decided> {
  let shopper = opts.shopper;
  if (!shopper) {
    shopper = await shopperOn(m);
    expect((await shopper.action(VIEW_TABBY_26, PAID_SOCIAL_ENTRY)).status, `PRECONDITION (${m.host}): the shopper's view is accepted`).toBe(200);
  }
  const snapshot = await shopper.snapshot(page, { pageInstance: pageInstanceOf(`s11-${page}`) });
  expect(snapshot.status, `PRECONDITION (${m.host}): the ${page} page is answered (${JSON.stringify(snapshot.body).slice(0, 300)})`).toBe(200);
  const decision = snapshot.decisions.find(d => d.contentId === POOLED);
  let record: DecisionRecord | undefined;
  if (opts.ack !== false && decision?.renderOffer) {
    expect((await shopper.ack(snapshot, decision)).status, `PRECONDITION (${m.host}): the pooled module's render is acknowledged`).toBe(200);
    await m.drainLedger();
    record = storedDecisions(m, shopper.subject).find(r => r.decision_id === decision.decisionId);
  }
  return { shopper, snapshot, decision, record };
}

/** What a record says of the learned lift: the snapshot version it decided with and the pooled module's itemised lift. */
export function liftOnRecord(record: DecisionRecord | undefined): { version: number; lift: Record<string, unknown> | null } | string {
  if (!record) return 'no stored record for the pooled module\'s decision';
  return { version: record.versions.lift, lift: (record.explain.lift ?? null) as Record<string, unknown> | null };
}

/** A member of the answer's `sources`, or a sentence naming its absence and the members `sources` has. */
export function sourcesMember(snapshot: Snapshot, member: string): unknown {
  const sources = snapshot.body.sources as Record<string, unknown> | undefined;
  if (!sources || typeof sources !== 'object') return `no sources on the answer (members: ${Object.keys(snapshot.body).join(', ')})`;
  return Object.hasOwn(sources, member) ? sources[member] : `no sources.${member} member (sources members: ${Object.keys(sources).join(', ')})`;
}

/** `sources.lift[slot]`, or a sentence naming what is missing. */
export function liftReadOf(snapshot: Snapshot, slot: string = PDP_MODULES): unknown {
  const lift = sourcesMember(snapshot, 'lift');
  if (typeof lift === 'string' || !lift || typeof lift !== 'object') return lift;
  return Object.hasOwn(lift, slot) ? (lift as Record<string, unknown>)[slot] : `no sources.lift['${slot}'] member (slots named: ${Object.keys(lift).join(', ')})`;
}

/** `sources.ring`, or a sentence naming its absence. */
export const ringReadOf = (snapshot: Snapshot): unknown => sourcesMember(snapshot, 'ring');

/** Whether the answer's decisions carry the fatigue term (a `fatigue` driver: src/content/decide.ts:1413-1414). */
export const fatigued = (snapshot: Snapshot): boolean => snapshot.decisions.some(d => (d.explain?.drivers ?? []).some(driver => driver.dim === 'fatigue'));

// ---------------------------------------------------------------------------
// The named constants of src/learn/fan.ts, read loosely.
// ---------------------------------------------------------------------------

/**
 * Today's literals, the budgets in force until P62 names them: the lift witness's
 * timer (src/learn/fan.ts, `currentLiftWitness`, :43, unchanged since 7b01c143) and
 * the ring read's default (`readRing`, :859, `timeoutMs = 60`).
 */
export const LITERAL_LIFT_BUDGET_MS = 50;
export const LITERAL_RING_BUDGET_MS = 60;

/** The constants src/learn/fan.ts exports, as an untyped record (a missing one reads undefined, never a type error). */
export async function fanExports(): Promise<Record<string, unknown>> {
  return await import('@/learn/fan') as unknown as Record<string, unknown>;
}

export interface InForce {
  /** The lift witness's budget in force: `LIFT_WITNESS_BUDGET_MS` once exported (P62), today's literal before. */
  liftBudget: number;
  /** The ring read's budget in force: `RING_READ_BUDGET_MS` once exported (P62), today's literal before. */
  ringBudget: number;
  /** The recent-publication window: `LIFT_RECENT_WINDOW_MS` once exported (P62), 0 before (only the latest publication is accepted: fan.ts:41). */
  window: number;
}

/** The budgets and the window in force for a deployment that sets no override. */
export async function inForce(): Promise<InForce> {
  const fan = await fanExports();
  const named = (name: string, otherwise: number) => (typeof fan[name] === 'number' ? fan[name] as number : otherwise);
  return { liftBudget: named('LIFT_WITNESS_BUDGET_MS', LITERAL_LIFT_BUDGET_MS), ringBudget: named('RING_READ_BUDGET_MS', LITERAL_RING_BUDGET_MS),
    window: named('LIFT_RECENT_WINDOW_MS', 0) };
}

// ---------------------------------------------------------------------------
// Levers.
// ---------------------------------------------------------------------------

type Stub = { fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> };
type Namespace = { get: (id: unknown) => Stub; idFromName: (name: string) => unknown };

/** A wait of `ms` that an abort of `signal` ends with an AbortError, as a real fetch ends, and that `release` ends early. */
function wait(ms: number, signal: AbortSignal | null | undefined, pending: Set<() => void>): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const aborted = () => reject(new DOMException('The operation was aborted.', 'AbortError'));
    if (signal?.aborted) { aborted(); return; }
    const done = () => { clearTimeout(timer); pending.delete(done); resolve(); };
    const timer = setTimeout(done, ms);
    pending.add(done);
    signal?.addEventListener('abort', () => { clearTimeout(timer); pending.delete(done); aborted(); }, { once: true });
  });
}

export interface DoorCall { name: string; path: string }
export interface DoorLever {
  /** Every call made to a named door since the lever was installed: the object's name and the door. */
  readonly calls: DoorCall[];
  /** The delay every following call to a named door waits before it reaches the object; 0 adds none. */
  delay: (ms: number) => void;
  /** Every following call to a named door fails with an error instead of reaching the object. */
  fail: (on: boolean) => void;
  /** Uninstalls the lever; every call still waiting on its delay goes on to the object at once. */
  restore: () => void;
}

/**
 * A lever on the named doors of the statistics or ring objects: the mounted app's
 * namespace, its `get` wrapped so that a call to one of `paths` is logged and then
 * delayed or failed as set, and is otherwise the object's own answer.
 */
export function doorLever(m: Mounted, binding: 'LEARN_STATS' | 'DECISION_RING', paths: readonly string[]): DoorLever {
  const namespace = m.env[binding] as unknown as Namespace, original = namespace.get;
  const calls: DoorCall[] = [], waiting = new Set<() => void>();
  let delayMs = 0, failing = false;
  namespace.get = (id: unknown) => {
    const stub = original.call(namespace, id);
    return { fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(input instanceof Request ? input.url : String(input)).pathname;
      if (!paths.includes(path)) return stub.fetch(input, init);
      calls.push({ name: String(id), path });
      if (failing) throw new Error(`lever: the ${binding} ${path} call failed`);
      if (delayMs > 0) await wait(delayMs, init?.signal ?? (input instanceof Request ? input.signal : null), waiting);
      return stub.fetch(input, init);
    } };
  };
  return { calls, delay: ms => { delayMs = ms; }, fail: on => { failing = on; },
    restore: () => { namespace.get = original; delayMs = 0; for (const release of [...waiting]) release(); } };
}

/** The statistics objects' witness doors: today's `/health` (src/learn/fan.ts `currentLiftWitness`, :34) and P62's `/witness` (R-P110). */
export const WITNESS_DOORS = ['/health', '/witness'] as const;
export const witnessLever = (m: Mounted) => doorLever(m, 'LEARN_STATS', WITNESS_DOORS);
/** The visitor's ring door the decision path reads (src/learn/fan.ts:864). */
export const ringLever = (m: Mounted) => doorLever(m, 'DECISION_RING', ['/recent']);

/** The key-value store answers `key` with `raw` (an older publication the edge still holds, or a forged one); every other key as before. */
export function copyLever(m: Mounted, raw: string, key: string = liftKey(TENANT, BRAND, PDP_MODULES)): () => void {
  const original = m.cache.get;
  m.cache.get = async (k: string, type?: string) => (k !== key ? original.call(m.cache, k, type)
    : type === 'stream' ? new Response(raw).body : type === 'json' ? JSON.parse(raw) : raw);
  return () => { m.cache.get = original; };
}

/** Every key the mounted app reads from the key-value store while it is installed. */
export function kvReadLog(m: Mounted): { keys: string[]; restore: () => void } {
  const original = m.cache.get, keys: string[] = [];
  m.cache.get = async (k: string, type?: string) => { keys.push(k); return original.call(m.cache, k, type); };
  return { keys, restore: () => { m.cache.get = original; } };
}

/** The copy with its content changed by one counter and its identity kept (version, witness and every member `compatible()` reads): a copy the object never published. */
export function forged(raw: string): string {
  const copy = JSON.parse(raw) as Record<string, unknown>;
  return JSON.stringify({ ...copy, events: Number(copy.events) + 1 });
}

/** Runs `work` with `Date.now()` moved `ms` ahead of the clock (timers, `performance.now()` and `new Date()` stay real). */
export async function later<T>(ms: number, work: () => Promise<T>): Promise<T> {
  const now = Date.now.bind(Date);
  const spy = vi.spyOn(Date, 'now').mockImplementation(() => now() + ms);
  try { return await work(); } finally { spy.mockRestore(); }
}

/** The placement's own object in the harness's registry (one page per slot here unless `page` is given). */
export function placementOf(m: Mounted, slot: string = PDP_MODULES, page?: string): Registry {
  const name = statsName(TENANT, BRAND, slot, page), placement = m.stats.get(name);
  expect(placement, `PRECONDITION (${m.host}): the statistics object ${name} exists`).toBeTruthy();
  return placement!;
}

/** The placement's alarm, fired as the platform fires it (`LearnStats.alarm()`: it publishes), and the pending work drained. */
export async function fireAlarm(m: Mounted, slot: string = PDP_MODULES): Promise<void> {
  await (placementOf(m, slot).object as unknown as { alarm: () => Promise<void> }).alarm();
  await m.drain();
}

/**
 * src/durable-objects/LearnStats.ts `const PUBLISH_DELAY_MS = 30_000` (not exported): a write's publication is due
 * 30 seconds after it, and a failed publication's retry 30 seconds after the failure (W27 R4, kit 02: "Publication failure
 * schedules another attempt in 30 seconds").
 */
const PUBLISH_DELAY_MS = 30_000;
/** Per placement: the moment, on the clock it ran under, the last publication alarm this harness fired for it ended. */
const publicationAlarmEnded = new WeakMap<Registry, number>();

/**
 * The placement's PUBLICATION alarm (S18 R10, the lead's ruling R-P195: the object's single alarm is shared and its
 * handler does everything that is due when it fires; a publication is due PUBLISH_DELAY_MS after the write, or the
 * republication, it publishes, and never earlier). The clock is moved to the pending publication's due time —
 * PUBLISH_DELAY_MS after now (every write and republication a unit makes before calling this is done by now), and never
 * less than PUBLISH_DELAY_MS after the end of the last publication alarm fired here for the placement (the retry of a
 * failed publication is due PUBLISH_DELAY_MS after the failure: the clock accumulates) — and `LearnStats.alarm()` is run
 * there, the pending work drained under the same clock, which is then restored (composing with a clock a unit already
 * moved or holds). An alarm the object holds later than that is not the publication's (a pending publication's alarm is
 * due at most PUBLISH_DELAY_MS after its write or failure; a later one is a marker's expiry) and is not fired here.
 * `fireAlarm` is unchanged: the alarm run now, as armed.
 */
export async function firePublicationAlarm(m: Mounted, slot: string = PDP_MODULES): Promise<void> {
  const placement = placementOf(m, slot), previous = Date.now;
  const at = Math.max(previous(), publicationAlarmEnded.get(placement) ?? Number.NEGATIVE_INFINITY) + PUBLISH_DELAY_MS, offset = at - previous();
  Date.now = () => previous() + offset;
  try {
    await (placement.object as unknown as { alarm: () => Promise<void> }).alarm().finally(() => { publicationAlarmEnded.set(placement, Date.now()); });
    await m.drain();
  } finally { Date.now = previous; }
}

export interface StorageLog {
  /** Every key the object read (`get`, a transaction's `get`; `list:<prefix>` for a listing), in order. */
  reads: string[];
  /** Every key the object wrote (`put`, a transaction's `put`), in order. */
  writes: string[];
}

/**
 * The storage `mount` gives every object (src/units/_parity.ts:262-289), over the
 * placement's own stored entries, logging every key read and written.
 */
function recordingStorage(data: Map<string, unknown>, log: StorageLog): DurableObjectStorage {
  const alarms: number[] = [];
  const readKeys = (k: string | string[]) => { for (const key of Array.isArray(k) ? k : [k]) log.reads.push(key); };
  const writeKeys = (k: string | Record<string, unknown>) => { for (const key of typeof k === 'string' ? [k] : Object.keys(k)) log.writes.push(key); };
  const list = (source: Map<string, unknown>, o?: { prefix?: string; startAfter?: string; limit?: number; reverse?: boolean }) => {
    log.reads.push(`list:${o?.prefix ?? ''}`);
    return structuredClone(new Map([...source].filter(([key]) => key.startsWith(o?.prefix ?? '') && (!o?.startAfter || key > o.startAfter))
      .sort(([a], [b]) => (o?.reverse ? -1 : 1) * a.localeCompare(b)).slice(0, o?.limit)));
  };
  return {
    get: async (k: string | string[]) => { readKeys(k); return structuredClone(Array.isArray(k) ? new Map(k.map(v => [v, data.get(v)])) : data.get(k)); },
    put: async (k: string | Record<string, unknown>, v?: unknown) => {
      writeKeys(k);
      if (typeof k === 'string') data.set(k, structuredClone(v)); else for (const [key, value] of Object.entries(k)) data.set(key, structuredClone(value));
    },
    list: async (o?: { prefix?: string; startAfter?: string; limit?: number; reverse?: boolean }) => list(data, o),
    transaction: async (run: (tx: DurableObjectTransaction) => Promise<unknown>) => {
      const candidate = structuredClone(data);
      const tx = {
        list: async (o?: { prefix?: string }) => list(candidate, o),
        get: async (key: string) => { readKeys(key); return structuredClone(candidate.get(key)); },
        delete: async (keys: string | string[]) => { const many = typeof keys === 'string' ? [keys] : keys; for (const key of many) candidate.delete(key); return many.length; },
        put: async (values: string | Record<string, unknown>, value?: unknown) => {
          writeKeys(values);
          if (typeof values === 'string') candidate.set(values, structuredClone(value));
          else for (const [key, entry] of Object.entries(values)) candidate.set(key, structuredClone(entry));
        },
        deleteAlarm: async () => { alarms.length = 0; }, setAlarm: async (at: number) => { alarms.push(at); },
      } as unknown as DurableObjectTransaction;
      const result = await run(tx);
      data.clear(); for (const [key, value] of candidate) data.set(key, value);
      return result;
    },
    deleteAll: async () => data.clear(), delete: async (k: string) => data.delete(k),
    setAlarm: async (at: number) => { alarms.push(at); }, getAlarm: async () => alarms.at(-1) ?? null,
  } as unknown as DurableObjectStorage;
}

/**
 * The placement's object started again over its stored state, as an evicted
 * Durable Object starts: a fresh `LearnStats` with nothing in memory, whose
 * storage is the same stored entries and logs every key it reads and writes.
 * Returns the log.
 */
export function restartObject(m: Mounted, slot: string = PDP_MODULES): StorageLog {
  const placement = placementOf(m, slot), log: StorageLog = { reads: [], writes: [] };
  const state = { id: statsName(TENANT, BRAND, slot), storage: recordingStorage(placement.data, log), getWebSockets: () => [], waitUntil: () => undefined } as unknown as DurableObjectState;
  placement.object = new LearnStats(state, m.env as Env) as unknown as Registry['object'];
  return log;
}

/**
 * W23 H1.01's damage (src/units/W23/B1.unit.test.ts:1366-1373): every exposure
 * counter of the slot and of its items anchored thirty days ahead of the object's
 * clock, written into the stored state; the object then starts again over it
 * (`restartObject`), so what it holds is what it loads.
 */
export function damageAndRestart(m: Mounted, slot: string = PDP_MODULES): StorageLog {
  const placement = placementOf(m, slot), ahead = Date.now() + 30 * 86_400_000;
  type Counter = { n?: { s: number; t: number } };
  const stored = placement.data.get('learn') as { stats: { items: Record<string, Record<string, Counter>>; slot: Record<string, Counter>; updatedAt?: number } };
  for (const map of [...Object.values(stored.stats.items), stored.stats.slot]) {
    for (const key of Object.keys(map)) map[key]!.n = { s: map[key]!.n?.s ?? 1, t: ahead };
  }
  stored.stats.updatedAt = ahead;
  placement.data.set('learn', stored);
  return restartObject(m, slot);
}

/** The byte length of every SHA-256 input the process digests while it is installed (`crypto.subtle.digest`). */
export function digestLog(): { sizes: number[]; restore: () => void } {
  const subtle = crypto.subtle, digest = subtle.digest.bind(subtle), sizes: number[] = [];
  const spy = vi.spyOn(subtle, 'digest').mockImplementation(async (algorithm, data) => {
    sizes.push((data as ArrayBufferView | ArrayBuffer).byteLength);
    return digest(algorithm, data);
  });
  return { sizes, restore: () => spy.mockRestore() };
}

/** One door of the placement's own object, called as the decision path and the operator routes call it. */
export async function objectDoor(m: Mounted, path: string, body: unknown = { tenant: TENANT, brand: BRAND, slot: PDP_MODULES }, slot: string = PDP_MODULES): Promise<{ status: number; body: Record<string, unknown> }> {
  const namespace = m.env.LEARN_STATS!;
  const response = await namespace.get(namespace.idFromName(statsName(TENANT, BRAND, slot))).fetch(`https://learn${path}`, { method: 'POST', body: JSON.stringify(body) });
  const answer = { status: response.status, body: await response.json().catch(() => ({})) as Record<string, unknown> };
  await m.drain();
  return answer;
}

// ---------------------------------------------------------------------------
// The monitor.
// ---------------------------------------------------------------------------

/** `POST /v1/:tenant/monitor` as the operator (P47's idiom, src/units/P47/LEDGER.unit.test.ts:170-176): the run's result. */
export async function monitorRun(m: Mounted): Promise<Record<string, unknown>> {
  const run = await asOperator(m, 'POST', `/v1/${TENANT}/monitor`);
  expect(run.status, `PRECONDITION (${m.host}): the monitor run answers (${JSON.stringify(run.body).slice(0, 300)})`).toBe(200);
  return (run.body.result ?? {}) as Record<string, unknown>;
}

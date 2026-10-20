// src/units/_parity8.ts
// The eighth shared harness of the parity unit files: what the S9 tickets of the
// acknowledgement programme (amendment 5), P56
// and P57, need beyond src/units/_parity.ts, which is pinned by receipted tickets
// and never edited here.
//
// It holds no expected value of any ticket. It adds four things, all over the
// environment `mount` (src/units/_parity.ts:238-337) already built, so every
// binding, object and document is the one the other parity units use:
//   · THE WORKER'S ERROR PATH. The routes _parity.ts mounts (:301-306), mounted the
//     same way over the same environment, with the one handler src/index.ts:112
//     installs on the worker (`app.onError(errorHandler)`), so a failure that
//     escapes the routes is answered as production answers it
//     (src/middleware/error.ts:30-37: `{ error: 'Internal server error', message }`)
//     and not as the framework's bare text.
//   · THE SHOPPER'S WIRE WITHOUT A DRAIN. The render acknowledgement and the click,
//     each in exactly the body _parity.ts sends (`ack` :477-485, `click` :486-488),
//     started and answered WITHOUT awaiting the platform's pending work (the
//     harness's own `call` drains after every answer, :460), so a unit can read
//     what the shopper is answered while the engine's later work is still held,
//     and bound the wait for that answer instead of hanging.
//   · THREE LEVERS on the bindings the mounted app holds: the event queue held
//     unresolved until released (`holdQueue`); a latency added to every remote
//     binding call — R2, both KV namespaces, the queue, the statistics and ring
//     objects — with a log of the calls (`remoteLatency`); and the shopper object's
//     own storage refusing the transaction of a recovery admission (`refuseAdmission`).
//   · READERS of what the shopper object holds (its recovery operations with their
//     payloads, its alarm) and of the behaviour rows the ledger stored.
// The S10 ticket (P58, amendment 5) adds, beside them: a tracked action on the wire
// without a drain (`actionWire`), a read of the shopper object's storage that fails
// once after an admission (`failReadOnceAfterAdmission`), and a log of the session
// KV namespace's writes (`sessionKvWrites`).
// Documents are read from the tree this file lives in, never the working directory.

import { Hono } from 'hono';
import { expect } from 'vitest';

import type { DecisionRecord } from '@/content/types';
import { SHOPPER_HEADER } from '@/identity/sessionCapability';
import type { OwnerRecovery, RecoveryInput } from '@/ledger/recovery';
import { errorHandler } from '@/middleware/error';
import { configRoutes } from '@/routes/config';
import { contentRoutes } from '@/routes/content';
import { decisionRoutes } from '@/routes/decisions';
import realtimeRoutes from '@/routes/realtime';
import { tenantMiddleware } from '@/tenancy/middleware';
import { shopperObjectName } from '@/tenancy/objects';
import type { TenantId } from '@/tenancy/tenant';
import type { Env } from '@/types/env';

import { slotPositionOf, TENANT, type Decision, type Mounted, type Shopper, type Snapshot } from './_parity';

// ---------------------------------------------------------------------------
// The worker's error path.
// ---------------------------------------------------------------------------

export interface WorkerApp {
  fetch: (request: Request) => Promise<Response>;
  /** The worker-level work its requests registered (`ctx.waitUntil`), awaited until none is left. */
  drain: () => Promise<void>;
}

/** The routes `mount` serves, over its environment, behind the worker's own error handler (src/index.ts:112). */
export function workerApp(m: Mounted): WorkerApp {
  const pending: Promise<unknown>[] = [];
  const app = new Hono<{ Bindings: Env }>();
  app.use('*', tenantMiddleware());
  app.route('/config', configRoutes);
  app.route('/content', contentRoutes);
  app.route('/realtime', realtimeRoutes);
  app.route('/v1', decisionRoutes);
  app.onError(errorHandler);
  const fetch = async (request: Request) => app.fetch(request, m.env,
    { waitUntil: (p: Promise<unknown>) => pending.push(p), passThroughOnException() { /* never */ }, props: {} } as unknown as ExecutionContext);
  const drain = async () => { while (pending.length) await Promise.allSettled(pending.splice(0)); };
  return { fetch, drain };
}

/** Every piece of pending work, the worker's and the objects' (`mount`'s drain covers each object's `state.waitUntil`), until none is left. */
export async function settle(m: Mounted, app: WorkerApp): Promise<void> {
  for (let round = 0; round < 3; round++) { await app.drain(); await m.drain(); }
}

// ---------------------------------------------------------------------------
// The shopper's wire, without a drain.
// ---------------------------------------------------------------------------

/** What the shopper was answered: the status, the body (parsed, or `{ text }` when it is not JSON) and when it arrived. */
export interface Wire { status: number; body: Record<string, unknown>; answeredAt: number; sentAt: number }
export interface Identity { eventId: string; timestamp: number }

async function send(app: WorkerApp, s: Shopper, body: unknown): Promise<Wire> {
  const sentAt = performance.now();
  const response = await app.fetch(new Request('https://shop.invalid/realtime/action', {
    method: 'POST', headers: { 'X-Tenant': TENANT, [SHOPPER_HEADER]: s.grant.capability, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }));
  const answeredAt = performance.now();
  const text = await response.text();
  let parsed: Record<string, unknown>;
  try { parsed = JSON.parse(text) as Record<string, unknown>; } catch { parsed = { text }; }
  return { status: response.status, body: parsed, answeredAt, sentAt };
}

/**
 * The render acknowledgement the SDK sends for a decision it painted, in the body
 * src/units/_parity.ts:480-483 sends, carrying `identity` (a fresh event id and the
 * present time unless given: a retry carries its first wire identity and time,
 * src/routes/realtime.ts:152-153). Started, not drained.
 */
export function ackWire(app: WorkerApp, s: Shopper, snap: Snapshot, d: Decision, identity: Identity = { eventId: crypto.randomUUID(), timestamp: Date.now() }): Promise<Wire & { identity: Identity }> {
  return send(app, s, { type: 'content_impression', source: 'sdk', userId: s.grant.subject, sessionId: s.grant.sessionId, ...identity,
    data: { contentId: d.contentId, decisionId: d.decisionId, renderOffer: d.renderOffer, page: snap.page, pageInstance: snap.pageInstance,
      slot: d.slot, position: d.order, slotPosition: slotPositionOf(snap, d) } }).then(wire => ({ ...wire, identity }));
}

/** A content engagement (click) on a painted decision, in the body src/units/_parity.ts:486-488 sends. Started, not drained. */
export function clickWire(app: WorkerApp, s: Shopper, snap: Snapshot, d: Decision): Promise<Wire> {
  return send(app, s, { type: 'content_click', source: 'sdk', userId: s.grant.subject, sessionId: s.grant.sessionId,
    timestamp: Date.now(), eventId: crypto.randomUUID(),
    data: { contentId: d.contentId, slot: d.slot, decisionId: d.decisionId, page: snap.page, position: d.order, slotPosition: slotPositionOf(snap, d) } });
}

/**
 * A tracked action (any event type) in the body src/units/_parity.ts `action` sends
 * (:468-469: the event, `source: 'sdk'`, the shopper's ids, an event id and time),
 * carrying `identity` (a fresh event id and the present time unless given). Started, not drained.
 */
export function actionWire(app: WorkerApp, s: Shopper, event: { type: string; data: Record<string, unknown> },
  identity: Identity = { eventId: crypto.randomUUID(), timestamp: Date.now() }): Promise<Wire & { identity: Identity }> {
  return send(app, s, { ...event, source: 'sdk', userId: s.grant.subject, sessionId: s.grant.sessionId, ...identity }).then(wire => ({ ...wire, identity }));
}

export const UNANSWERED = 'no answer' as const;
/** The answer, or `UNANSWERED` once `ms` milliseconds have passed without one. The work itself is not cancelled. */
export async function within<T>(work: Promise<T>, ms: number): Promise<T | typeof UNANSWERED> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const bound = new Promise<typeof UNANSWERED>(resolve => { timer = setTimeout(() => resolve(UNANSWERED), ms); });
  try { return await Promise.race([work, bound]); } finally { clearTimeout(timer); }
}

// ---------------------------------------------------------------------------
// Levers.
// ---------------------------------------------------------------------------

interface QueueLike { send: (body: unknown, options?: unknown) => Promise<void>; sendBatch: (messages: Array<{ body: unknown }>, options?: unknown) => Promise<void> }

export interface HeldQueue {
  /** How many `send`/`sendBatch` calls are waiting on (or went through) the hold. */
  readonly sends: number;
  /** Lets every held call through to the queue `mount` built, and restores that queue. */
  release: () => void;
}

/** The stamp's event queue (`EVENT_QUEUE`) answers no `send` or `sendBatch` until `release()`. */
export function holdQueue(m: Mounted): HeldQueue {
  const original = m.env.EVENT_QUEUE as unknown as QueueLike;
  let open!: () => void;
  const gate = new Promise<void>(resolve => { open = resolve; });
  let sends = 0;
  m.env.EVENT_QUEUE = {
    send: async (body: unknown, options?: unknown) => { sends++; await gate; return original.send(body, options); },
    sendBatch: async (messages: Array<{ body: unknown }>, options?: unknown) => { sends++; await gate; return original.sendBatch(messages, options); },
  } as unknown as Env['EVENT_QUEUE'];
  return { get sends() { return sends; }, release: () => { m.env.EVENT_QUEUE = original as unknown as Env['EVENT_QUEUE']; open(); } };
}

export interface HeldDoor {
  /** How many requests to the held door are waiting on (or went through) the hold. */
  readonly requests: number;
  /** Lets every held request through to the object, and stops holding. */
  release: () => void;
}

/**
 * Every request to one door (`path`) of the statistics or ring objects (`LEARN_STATS`,
 * `DECISION_RING`) waits, before it reaches the object, until `release()`; every other
 * door of the same objects answers as before. Install it after `mount` and before any
 * `remoteLatency`.
 */
export function holdObjectDoor(m: Mounted, binding: 'LEARN_STATS' | 'DECISION_RING', path: string): HeldDoor {
  const namespace = m.env[binding] as unknown as { get: (id: unknown) => { fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> } };
  const get = namespace.get.bind(namespace);
  let open!: () => void, holding = true, requests = 0;
  const gate = new Promise<void>(resolve => { open = resolve; });
  namespace.get = (id: unknown) => {
    const stub = get(id);
    return { fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (holding && url.pathname === path) { requests++; await gate; }
      return stub.fetch(input, init);
    } };
  };
  return { get requests() { return requests; }, release: () => { holding = false; open(); } };
}

export interface RemoteCall { binding: string; method: string; at: number }
export interface Latency {
  /** Every remote binding call made since the lever was installed, in the order made, with when it was made (`performance.now()`). */
  calls: RemoteCall[];
  /** The latency every following remote call waits before it is made; 0 adds none (and no timer). */
  set: (ms: number) => void;
}

/**
 * Adds a latency to every remote binding call the mounted app makes: the R2 bucket
 * (`STORAGE`: get, head, put, delete, list), both KV namespaces (`CACHE`,
 * `SESSIONS`: get, put, delete, list), the event queue (send, sendBatch) and every
 * fetch to a statistics or ring object (`LEARN_STATS`, `DECISION_RING`). The
 * shopper's own object is the owner the request is admitted by, not a remote call
 * of its work, and its own storage is local to it; neither is delayed. Install it
 * after `mount` and before any `holdQueue`.
 */
export function remoteLatency(m: Mounted): Latency {
  let latency = 0;
  const calls: RemoteCall[] = [];
  const pause = async (binding: string, method: string) => {
    calls.push({ binding, method, at: performance.now() });
    if (latency > 0) { const wait = latency; await new Promise(resolve => setTimeout(resolve, wait)); }
  };
  const wrap = (binding: string, target: object, methods: string[]) => {
    for (const method of methods) {
      const original = (target as Record<string, (...args: unknown[]) => Promise<unknown>>)[method];
      if (typeof original !== 'function') continue;
      Object.defineProperty(target, method, { configurable: true, writable: true,
        value: async (...args: unknown[]) => { await pause(binding, method); return original.apply(target, args); } });
    }
  };
  wrap('STORAGE', m.storage, ['get', 'head', 'put', 'delete', 'list']);
  wrap('CACHE', m.cache, ['get', 'put', 'delete', 'list']);
  wrap('SESSIONS', m.env.SESSIONS as unknown as object, ['get', 'put', 'delete', 'list']);
  wrap('EVENT_QUEUE', m.env.EVENT_QUEUE as unknown as object, ['send', 'sendBatch']);
  for (const name of ['LEARN_STATS', 'DECISION_RING'] as const) {
    const namespace = m.env[name] as unknown as { get: (id: unknown) => { fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> } };
    const get = namespace.get.bind(namespace);
    namespace.get = (id: unknown) => {
      const stub = get(id);
      return { fetch: async (input: RequestInfo | URL, init?: RequestInit) => { await pause(name, 'fetch'); return stub.fetch(input, init); } };
    };
  }
  return { calls, set: (ms: number) => { latency = ms; } };
}

/**
 * The shopper's own object's storage, as `mount` built it (src/units/_parity.ts:262-289),
 * reached through the object's state (ShopperReflex.ts constructor: `this.state =
 * this.synthetic.state`), whose storage view reads the stub's members at each call
 * (src/ops/synthetic.ts SyntheticObjectBoundary, `wrapStorage`).
 */
export function shopperStorage(m: Mounted, subject: string): DurableObjectStorage {
  const item = m.shoppers.get(shopperObjectName(TENANT as TenantId, subject));
  expect(item ? 'held' : 'absent', `PRECONDITION (${m.host}): the shopper's own object exists`).toBe('held');
  return (item!.object as unknown as { state: DurableObjectState }).state.storage;
}

/**
 * Clears the shopper object's alarm through its own storage, as `mount`'s stub
 * supports it (a transaction's `deleteAlarm`, src/units/_parity.ts:279, :283), so a
 * later read of the alarm names only an alarm armed after this call.
 */
export async function clearShopperAlarm(m: Mounted, subject: string): Promise<void> {
  const storage = shopperStorage(m, subject);
  await storage.transaction(async tx => { await tx.deleteAlarm(); });
  expect(await storage.getAlarm() ?? 'no alarm', `PRECONDITION (${m.host}): the shopper object's alarm is cleared`).toBe('no alarm');
}

type Transaction = (run: (tx: DurableObjectTransaction) => Promise<unknown>) => Promise<unknown>;
/**
 * From now until the returned function is called, the shopper object's storage
 * refuses, with `message`, every transaction that writes the body of a recovery
 * admission (`recoveryBody:` keys: the durable admission's transaction,
 * src/ledger/recovery.ts savePayload, :100-124): the transaction throws before it
 * commits, so nothing of it is written.
 */
export function refuseAdmission(m: Mounted, subject: string, message: string): () => void {
  const storage = shopperStorage(m, subject) as unknown as { transaction: Transaction };
  const original = storage.transaction;
  storage.transaction = run => original(tx => run(new Proxy(tx, { get: (target, property) => {
    const value = Reflect.get(target, property, target) as unknown;
    if (property !== 'put' || typeof value !== 'function') return value;
    return (key: unknown, ...rest: unknown[]) => {
      if (typeof key === 'string' && key.startsWith('recoveryBody:')) throw new Error(message);
      return (value as (...args: unknown[]) => unknown).call(target, key, ...rest);
    };
  } })));
  return () => { storage.transaction = original; };
}

export interface ReadFault {
  /** How many reads the fault has failed (at most one). */
  readonly failed: number;
  /** Stops watching; the storage reads and writes as before. */
  restore: () => void;
}
/**
 * The shopper object's storage fails, once, the first read of `key` made after a
 * transaction that wrote `key` (for a recovery operation's `recoveryOperation:<id>`:
 * the first read after its durable admission, src/ledger/recovery.ts savePayload
 * :100-124), with `message`; every other read and write is as before. The P56
 * delivery review's probe (S9/reviewer-p56/review-stack.test.ts.txt, `throwOnce`)
 * failed the same read to leave an admitted operation's effects pending.
 */
export function failReadOnceAfterAdmission(m: Mounted, subject: string, key: string, message: string): ReadFault {
  const storage = shopperStorage(m, subject) as unknown as { transaction: Transaction; get: (...args: unknown[]) => Promise<unknown> };
  const transaction = storage.transaction, get = storage.get;
  let armed = false, failed = 0;
  storage.transaction = run => transaction(tx => run(new Proxy(tx, { get: (target, property) => {
    const value = Reflect.get(target, property, target) as unknown;
    if (property !== 'put' || typeof value !== 'function') return value;
    return async (written: unknown, ...rest: unknown[]) => {
      const result = await (value as (...args: unknown[]) => unknown).call(target, written, ...rest);
      if (written === key && !failed) armed = true;
      return result;
    };
  } })));
  storage.get = (...args: unknown[]) => {
    if (armed && args[0] === key) { armed = false; failed++; return Promise.reject(new Error(message)); }
    return get(...args);
  };
  return { get failed() { return failed; }, restore: () => { storage.transaction = transaction; storage.get = get; } };
}

export interface KvWrite { key: string; value: string; at: number }
/** Every `put` to the shopper's session KV namespace (`SESSIONS`) from now on, with its value and when it was made (`performance.now()`). */
export function sessionKvWrites(m: Mounted): KvWrite[] {
  const target = m.env.SESSIONS as unknown as { put: (key: string, value: string, ...rest: unknown[]) => Promise<unknown> };
  const put = target.put.bind(target), writes: KvWrite[] = [];
  target.put = (key: string, value: string, ...rest: unknown[]) => { writes.push({ key, value, at: performance.now() }); return put(key, value, ...rest); };
  return writes;
}

// ---------------------------------------------------------------------------
// Readers.
// ---------------------------------------------------------------------------

export interface Admission {
  id: string;
  meta: OwnerRecovery;
  /** The stored payload text, its chunks joined in order (src/ledger/recovery.ts `chunkKey`, :83). */
  text: string;
  payload: { input: RecoveryInput; messages: unknown[]; effects?: unknown; prepared?: boolean; pageScoped?: string[] } | null;
  /** Every key of the shopper object's storage this operation holds. */
  keys: string[];
}

/** The recovery operations the shopper's own object holds (`recoveryOperation:<id>`, its chunks), with their payloads. */
export function admissionsOf(m: Mounted, subject: string): Admission[] {
  const item = m.shoppers.get(shopperObjectName(TENANT as TenantId, subject));
  if (!item) return [];
  const data = item.data;
  return [...data.entries()].filter(([key]) => key.startsWith('recoveryOperation:')).map(([key, value]) => {
    const id = key.slice('recoveryOperation:'.length), meta = value as OwnerRecovery;
    let text = '';
    for (let index = 0; index < (meta.chunks ?? 0); index++) text += String(data.get(`recoveryBody:${id}:${index}`) ?? '');
    return { id, meta, text, payload: text ? JSON.parse(text) as Admission['payload'] : null,
      keys: [...data.keys()].filter(k => k === key || k.startsWith(`recoveryBody:${id}:`)) };
  });
}

/** The admission of one decision's render (kind `decisions`, its one record that decision). */
export function decisionAdmissionOf(m: Mounted, subject: string, decisionId: string): Admission | undefined {
  return admissionsOf(m, subject).find(a => a.payload?.input.kind === 'decisions'
    && (a.payload.input as Extract<RecoveryInput, { kind: 'decisions' }>).records.some(record => record.decision_id === decisionId));
}

/** What the shopper object's storage holds under a key (the `recoveryLogical:` commitments). */
export function shopperHeld(m: Mounted, subject: string, key: string): unknown {
  return m.shoppers.get(shopperObjectName(TENANT as TenantId, subject))?.data.get(key);
}

/** The behaviour records the ledger stored for a visitor (the `behavior` stream in R2), in the shape `storedOutcomes` reads (src/units/_parity.ts:536-540). */
export function storedBehavior(m: Mounted, visitorId: string): Array<Record<string, unknown>> {
  return [...m.storage.objects.entries()].filter(([key]) => key.includes('/behavior/') && key.endsWith('.ndjson'))
    .flatMap(([, raw]) => raw.split('\n').filter(Boolean).map(line => JSON.parse(line) as Record<string, unknown>))
    .filter(record => record.visitor_id === visitorId);
}

/** The decision rows the ledger stored for one decision. */
export const rowsOf = (stored: DecisionRecord[], decisionId: string | undefined): DecisionRecord[] => stored.filter(record => record.decision_id === decisionId);

/**
 * W06's source commitment, as src/ledger/recovery.ts:81-82 (`sourceOf`, not exported)
 * computes it: the operation's kind, tenant, subject and brand, and its rows without
 * their `retention` and `externalRetention` stamps. A lock: a unit compares the
 * stored digest with the engine's own `recoveryDigest` of this value.
 */
export function w06SourceOf(input: RecoveryInput): unknown {
  const rows = input.kind === 'decisions' ? input.records : input.kind === 'outcome' ? [input.outcome] : [input.record];
  return { kind: input.kind, tenant: input.tenant, subject: input.subject, brand: input.brand,
    rows: rows.map(row => Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'retention' && key !== 'externalRetention'))) };
}

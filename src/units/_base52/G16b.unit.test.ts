// src/units/_base52/G16b.unit.test.ts
// Baseline-52 unit G16b (remediation W06.05 under the W09 owner rule): the HOST
// leg of G16, owed by the G16 delivery review (finding 1, "No test locks the
// product's re-entry"; METHOD §3: a host-internal unit never replaces a host leg
// where a public route exists).
//
// G16 lets the decision answer go while the shopper's erasure (tombstone) read is
// still pending, and runs the learning fan-out after that read inside the
// shopper's owner: inline while the answering operation is still active,
// otherwise as a NEW operation of the same owner entered through the shopper
// object's serializer, or not at all. The host-internal unit beside this file
// (G16.unit.test.ts) never runs that re-entry. This file drives the public route,
// `POST /v1/:tenant/decisions/snapshot`, on both shopper hosts and pins it:
//   leg A  the shopper's grant expires between the answer and the release of the
//          held read: no destination is reached, and the loss is reported as the
//          engine's not-attempted learning receipt;
//   leg B  a clean release: both destinations are reached, each while the
//          shopper's owner is held, in an operation that is not the answered one;
//   leg C  durable recovery on: the answer still waits for the durable admission.
// Leg A expires the GRANT (not consent): it pins the re-entered operation's own
// admission of every principal the first operation admitted, against the grant
// authority now (reenterOwner's admit loop, through ShopperReflex.assertOwned and
// assertSessionTarget). A consent withdrawal would pin the consent re-read
// instead, which a re-entry without the re-admission still performs.
//
// WITNESSES (read at 3deaa0ba)
//   · the ruling: _evidence/parity-step3/AMENDMENTS.md:285 ("Baseline-52 G16
//     specified": shape B′, the re-entry through `ShopperReflex.serialize`, the
//     post-answer work kept alive by the platform's waitUntil on both hosts,
//     recovery mode byte for byte); the G16 review's finding 1
//     (_evidence/baseline-52/g16/reviewer/REPORT.md, "Findings").
//   · src/identity/sessionAuthority.ts `continueAfterOwnerRead`, :551-562: refused
//     with no active owner (:553); the owner recheck, then the read (:555); `work`
//     inline and retained while the first operation is active (:557), otherwise
//     `reenterOwner` (:558); the continuation handed to the owner's waitUntil (:560).
//   · sessionAuthority.ts `reenterOwner`, :563-583: every principal of the first
//     operation admitted again by the owner (:565-567); the work must run in a new,
//     active operation of the same owner (:568-569); guards pinned again
//     (:570-572); the consent in force read again (:573-574); recheck (:575);
//     `work` on a fresh owner environment (:576); entered from outside the
//     answered operation, through the owner's serializer (:578-582).
//   · sessionAuthority.ts `ownerHeld`, :258-261 (active and the same owner);
//     `runOwnerOperation`, :497-513 (the answered operation ends, `held.active =
//     false`, :511, before its answer is returned).
//   · src/durable-objects/ShopperReflex.ts `serialize`, :3863-3879, and its
//     continuation hooks, :3870-3872 (`admit` is `assertOwned(principal,
//     undefined, false, false)`, `waitUntil` is the object's `state.waitUntil`);
//     `assertOwned`, :3384-3396 (`assertSessionTarget` :3385, `assertGrant`
//     :3395); src/identity/sessionCapability.ts `assertSessionTarget`, :205-209
//     (an expired grant, :206, is refused).
//   · src/content/service.ts `serveContentDecisions`: `fanOutAfterRead`, :1050
//     (never under durable recovery); the read and the fan-out handed to
//     `continueAfterOwnerRead`, :1055-1056; "A fan-out the owner refused before it
//     started is reported as not attempted (`null`)", :1057-1058; `ownerDrain`,
//     :1111; durable recovery's admission inside `captured`, :1052-1054.
//   · src/routes/decisions.ts, the snapshot handler: `c.executionCtx.waitUntil(out.ownerDrain)`, :1110.
//   · src/learn/fan.ts `fanDecisions`: the erasure read, :1039; "All
//     validation/barrier/config reads precede starting either destination", :1102;
//     the ring's `/append` and each placement's `/exposures`, :1108-1111, named by
//     `ringName` (:90) and `statsName` (:119); `reportLearningIncomplete`,
//     :832-852 (nothing for a complete receipt, :833; `code` 3 and
//     `ringNotAttempted` 1 for a null one, :838 and :841).
//   · src/ledger/erasure.ts `tombstoneKey`, :70, read by `loadTombstone`, :164-170.
//
// FIXTURE. A neutral tenant, one anonymous shopper who chose tracking and
// personalization through the real preferences route, one page with one slot and
// one live piece; the routes mounted as src/index.ts mounts them over the REAL
// ShopperReflex, DecisionRing and LearnStats classes with in-memory storage (the
// idiom of src/units/_parity.ts, not imported: its fixture tenant is a customer
// name). Each destination call records the destination's name and path, whether
// the shopper's owner operation was held at that moment, and whether that
// operation is the one that answered. Both flags are read from the engine's own
// owner store (`invocation.getStore()`, sessionAuthority.ts:44) through a
// test-only observer of `AsyncLocalStorage.prototype.run`; nothing in the product
// changes.

import { AsyncLocalStorage } from 'node:async_hooks';

import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { initializePublicationSet, invalidatePublicationCache, type PublicationBaseline } from '@/config/publication';
import { invalidateCache } from '@/config/versionedStore';
import { CONTENT_KIND, LEARN_KIND, SLOTS_KIND } from '@/content/kinds';
import { invalidateLiftCache } from '@/content/service';
import { DecisionRing } from '@/durable-objects/DecisionRing';
import { LearnStats } from '@/durable-objects/LearnStats';
import { ShopperReflex } from '@/durable-objects/ShopperReflex';
import { ownerHeld } from '@/identity/sessionAuthority';
import { newAnonymousSession, SHOPPER_HEADER } from '@/identity/sessionCapability';
import { tombstoneKey } from '@/ledger/erasure';
import { reportLearningIncomplete, ringName, statsName } from '@/learn/fan';
import { EMPTY_PRIORS, PRIORS_KIND } from '@/learn/priors';
import { REFLEX_KIND, reflexScopeForTenant } from '@/reflex/configStore';
import { DEFAULT_REFLEX_CONFIG } from '@/reflex/core';
import { RETENTION_CATEGORIES, type RetentionCategory, type RetentionPolicy } from '@/retention';
import { decisionRoutes } from '@/routes/decisions';
import realtimeRoutes from '@/routes/realtime';
import { tenantMiddleware } from '@/tenancy/middleware';
import { shopperObjectName } from '@/tenancy/objects';
import type { TenantId } from '@/tenancy/tenant';
import type { Env } from '@/types/env';

const TENANT = 'unit-g16b';
const BRAND = 'unit-g16b';
const PAGE = 'home';
const SLOT = 'hero';
const DAY = 86_400_000;
const HOSTS = ['session', 'do'] as const;
type Host = (typeof HOSTS)[number];
/** How long a leg waits for the decision answer while the erasure read is held: generous, the engine answers in milliseconds. */
const ANSWER_WAIT_MS = 5_000;
/** How long leg C holds the durable admission before it looks for an answer. */
const ADMISSION_HOLD_MS = 300;
const sleep = (ms: number) => new Promise<void>(resolve => { setTimeout(resolve, ms); });

// ---------------------------------------------------------------------------
// The test-only observer of the engine's owner store.
// ---------------------------------------------------------------------------

/** The members of sessionAuthority.ts's `Invocation` (:19-42) this file reads. */
interface OwnerOperation { owner: object; active: boolean }
const isOwnerOperation = (store: unknown): store is OwnerOperation =>
  typeof store === 'object' && store !== null && 'owner' in store && 'active' in store && 'principals' in store && 'pending' in store && 'consentGuards' in store;
type Run = (this: AsyncLocalStorage<unknown>, store: unknown, callback: (...args: unknown[]) => unknown, ...args: unknown[]) => unknown;
const realRun = AsyncLocalStorage.prototype.run as unknown as Run;
const ownerStores = new Set<AsyncLocalStorage<unknown>>();
/** The owner operation in force here, as `invocation.getStore()` returns it (sessionAuthority.ts:44). */
function currentOperation(): OwnerOperation | undefined {
  for (const store of ownerStores) { const held = store.getStore(); if (isOwnerOperation(held)) return held; }
  return undefined;
}
beforeAll(() => {
  // `runOwnerOperation` enters every owner operation with `invocation.run` (sessionAuthority.ts:499).
  const observed: Run = function (store, callback, ...args) {
    if (isOwnerOperation(store)) ownerStores.add(this);
    return realRun.call(this, store, callback, ...args);
  };
  (AsyncLocalStorage.prototype as unknown as { run: Run }).run = observed;
});
afterAll(() => { (AsyncLocalStorage.prototype as unknown as { run: Run }).run = realRun; });

// ---------------------------------------------------------------------------
// The mounted application on one host.
// ---------------------------------------------------------------------------

class UnitKV {
  data = new Map<string, string>();
  async get(key: string, type?: string) {
    const v = this.data.get(key);
    return v === undefined ? null : type === 'stream' ? new Response(v).body : type === 'json' ? JSON.parse(v) as unknown : v;
  }
  async put(key: string, value: string) { this.data.set(key, value); }
  async delete(key: string) { this.data.delete(key); }
  async list(o?: { prefix?: string; limit?: number; cursor?: string }) {
    const keys = [...this.data.keys()].filter(k => k.startsWith(o?.prefix ?? '')).sort();
    const start = Number(o?.cursor ?? 0), end = start + (o?.limit ?? 1000);
    return { keys: keys.slice(start, end).map(name => ({ name })), list_complete: end >= keys.length, ...(end < keys.length ? { cursor: String(end) } : {}) };
  }
}

class UnitR2 {
  objects = new Map<string, string>();
  versions = new Map<string, number>();
  /** While set, a read of this key (the shopper's tombstone, erasure.ts:70) waits on `gate`. */
  heldKey: string | null = null;
  gate: Promise<null> | null = null;
  /** Called at every read of `heldKey`, in the reader's own async context. */
  onHeldRead: (() => void) | null = null;
  async get(key: string) {
    if (this.gate && key === this.heldKey) { this.onHeldRead?.(); return this.gate; }
    const raw = this.objects.get(key); if (raw === undefined) return null;
    return { key, etag: 'v' + this.versions.get(key), size: new TextEncoder().encode(raw).length,
      body: new Response(raw).body, text: async () => raw, json: async () => JSON.parse(raw) as unknown };
  }
  async head(key: string) { return this.objects.has(key) ? { key } : null; }
  async put(key: string, raw: string, options?: R2PutOptions) {
    const old = this.objects.has(key) ? 'v' + this.versions.get(key) : null, condition = options?.onlyIf;
    const absent = condition instanceof Headers ? condition.get('If-None-Match') === '*' : condition?.etagDoesNotMatch === '*';
    const match = condition instanceof Headers ? condition.get('If-Match') : condition?.etagMatches;
    if ((absent && old !== null) || (match != null && match !== old && match !== JSON.stringify(old))) return null;
    this.objects.set(key, raw); this.versions.set(key, (this.versions.get(key) ?? 0) + 1);
    return { key, etag: 'v' + this.versions.get(key), size: new TextEncoder().encode(raw).length };
  }
  async delete(keys: string | string[]) { for (const key of typeof keys === 'string' ? [keys] : keys) this.objects.delete(key); }
  async list(options: { prefix?: string; cursor?: string; limit?: number } = {}) {
    const names = [...this.objects.keys()].filter(k => k.startsWith(options.prefix ?? '')).sort();
    const start = Number(options.cursor ?? 0), end = start + (options.limit ?? 1000);
    return { objects: names.slice(start, end).map(key => ({ key, size: 0, uploaded: new Date(0) })),
      truncated: end < names.length, ...(end < names.length ? { cursor: String(end) } : {}) };
  }
}

interface DestinationCall { name: string; path: string; ownerHeld: boolean; answered: boolean }
interface ObjectEntry { object: { fetch: (request: Request) => Promise<Response> } }

interface Mounted {
  env: Env;
  storage: UnitR2;
  shoppers: Map<string, ObjectEntry>;
  /** Every ring and statistics call, in order. */
  calls: DestinationCall[];
  /** The shopper's object, whose owner the flags are judged against. */
  shopper: () => object | undefined;
  /** The operation that answered the decision (set by the leg). */
  answered: { operation: OwnerOperation | undefined };
  /** When set, the shopper object's durable recovery admission waits on it (the W09.09 idiom, realtime.sdkContract.test.ts `faults.recoveryPut`). */
  admission: { gate: Promise<void> | null; entered: () => void };
  fetch: (request: Request) => Promise<Response>;
  drain: () => Promise<void>;
}

const fixturePolicy: RetentionPolicy = { id: 'g16b-fixture-policy', revision: 1, durationMs: 3650 * DAY, basis: 'admitted', renewal: 'new-record-only' };

async function mount(host: Host, recovery: boolean): Promise<Mounted> {
  invalidateCache(); invalidateLiftCache(); invalidatePublicationCache();
  const pending: Promise<unknown>[] = [], calls: DestinationCall[] = [];
  const storage = new UnitR2(), shoppers = new Map<string, ObjectEntry>();
  const answered: Mounted['answered'] = { operation: undefined };
  const admission: Mounted['admission'] = { gate: null, entered: () => undefined };
  const env = {
    DEPLOYMENT_PROFILE: 'demo', ENVIRONMENT: 'test', CACHE: new UnitKV(), SESSIONS: new UnitKV(), STORAGE: storage,
    CONNECTOR_MODE: 'mock', DECISION_SOURCE: 'mock', REFLEX_HOST: host,
    JWT_SECRET: 'g16b-synthetic-signing-material-only', JWT_ISSUER: 'i', JWT_AUDIENCE: 'a', IDENTITY_SECRETS: `${TENANT}:g16b-identity-material`,
    TENANTS: JSON.stringify({ provisioned: [TENANT] }),
    LEDGER_RECOVERY_ENABLED: recovery ? 'true' : 'false',
    RETENTION: JSON.stringify({ version: 1, tenants: { [TENANT]: Object.fromEntries(RETENTION_CATEGORIES.map(category => [category, fixturePolicy])) as Record<RetentionCategory, RetentionPolicy> } }),
    PERSONALIZATION_WEBSOCKET: { idFromName: (n: string) => n, get: () => ({ fetch: async () => Response.json({ connections: 0 }) }) },
    DB: { prepare: () => ({ bind: () => ({ run: async () => ({ success: true }) }) }) },
    EVENT_QUEUE: { send: async () => undefined, sendBatch: async () => undefined },
  } as unknown as Env;
  const shopper = () => [...shoppers.values()][0]?.object;
  const namespaceFor = (make: (state: DurableObjectState, e: Env) => ObjectEntry['object'], registry: Map<string, ObjectEntry>, destination: boolean) => ({
    idFromName: (n: string) => n,
    get: (name: string) => ({ fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      if (destination) {
        const operation = currentOperation(), owner = shopper();
        calls.push({ name, path: new URL(input instanceof Request ? input.url : String(input)).pathname,
          ownerHeld: !!operation?.active && operation.owner === owner, answered: operation !== undefined && operation === answered.operation });
      }
      let item = registry.get(name);
      if (!item) {
        const data = new Map<string, unknown>(), alarms: number[] = [];
        const storageStub = {
          get: async (k: string | string[]) => structuredClone(Array.isArray(k) ? new Map(k.map(v => [v, data.get(v)])) : data.get(k)),
          put: async (k: string | Record<string, unknown>, v?: unknown) => {
            if (typeof k === 'string') data.set(k, structuredClone(v)); else for (const [key, value] of Object.entries(k)) data.set(key, structuredClone(value));
          },
          list: async (o?: { prefix?: string; startAfter?: string; limit?: number; reverse?: boolean }) =>
            structuredClone(new Map([...data].filter(([key]) => key.startsWith(o?.prefix ?? '') && (!o?.startAfter || key > o.startAfter))
              .sort(([a], [b]) => (o?.reverse ? -1 : 1) * a.localeCompare(b)).slice(0, o?.limit))),
          transaction: async (run: (tx: DurableObjectTransaction) => Promise<unknown>) => {
            const candidate = structuredClone(data);
            let deleteAlarm = false, nextAlarm: number | undefined;
            const tx = { list: async () => structuredClone(candidate), get: async (key: string) => structuredClone(candidate.get(key)),
              delete: async (keys: string | string[]) => { const list = typeof keys === 'string' ? [keys] : keys; for (const key of list) candidate.delete(key); return list.length; },
              put: async (values: string | Record<string, unknown>, value?: unknown) => {
                if (typeof values === 'string') candidate.set(values, structuredClone(value));
                else for (const [key, entry] of Object.entries(values)) candidate.set(key, structuredClone(entry));
                // The durable admission's logical record (savePayload, recovery.ts:119), held as the W09.09 legs hold it.
                if (typeof values === 'string' && values.startsWith('recoveryLogical:') && admission.gate) { admission.entered(); await admission.gate; }
              },
              deleteAlarm: async () => { deleteAlarm = true; }, setAlarm: async (at: number) => { nextAlarm = at; },
            } as unknown as DurableObjectTransaction;
            const result = await run(tx);
            data.clear(); for (const [key, value] of candidate) data.set(key, value);
            if (deleteAlarm) alarms.length = 0;
            if (nextAlarm !== undefined) alarms.push(nextAlarm);
            return result;
          },
          deleteAll: async () => data.clear(), delete: async (k: string) => data.delete(k),
          setAlarm: async (at: number) => { alarms.push(at); }, getAlarm: async () => alarms.at(-1) ?? null,
        };
        const state = { id: name, storage: storageStub, getWebSockets: () => [], waitUntil: (p: Promise<unknown>) => { pending.push(p); } } as unknown as DurableObjectState;
        item = { object: make(state, env) };
        registry.set(name, item);
      }
      return item.object.fetch(new Request(input, init));
    } }),
  });
  env.SHOPPER_REFLEX = namespaceFor((state, e) => new ShopperReflex(state, e), shoppers, false) as unknown as DurableObjectNamespace;
  env.DECISION_RING = namespaceFor((state, e) => new DecisionRing(state, e), new Map(), true) as unknown as DurableObjectNamespace;
  env.LEARN_STATS = namespaceFor((state, e) => new LearnStats(state, e), new Map(), true) as unknown as DurableObjectNamespace;

  const app = new Hono<{ Bindings: Env }>();
  app.use('*', tenantMiddleware());
  app.route('/realtime', realtimeRoutes);
  app.route('/v1', decisionRoutes);
  const fetchOne = (request: Request) => Promise.resolve(app.fetch(request, env,
    { waitUntil: (p: Promise<unknown>) => { pending.push(p); }, passThroughOnException() { /* never */ }, props: {} } as unknown as ExecutionContext));
  const drain = async () => { while (pending.length) await Promise.allSettled(pending.splice(0)); await sleep(5); };

  const baseline = (kind: PublicationBaseline['kind'], value: unknown, scope = TENANT): PublicationBaseline =>
    ({ kind, scope, revision: { revision: 1, at: 1, actor: 'g16b-fixture', note: 'fixture', value } });
  await initializePublicationSet(env, [
    baseline(CONTENT_KIND, { version: 'g16b-catalogue', pieces: [{ id: 'cnt-g16b-piece', customerContentId: 'CMS-G16B-PIECE', type: 'editorial',
      title: 'A neutral piece', tags: {}, slotTypes: [SLOT], lifecycle: { status: 'live' } }] }),
    baseline(SLOTS_KIND, { version: 'g16b-slots', pages: { [PAGE]: [{ slot: SLOT, take: 1, weights: {} }] } }),
    baseline(LEARN_KIND, { version: 'g16b-learn', holdout: { share: 0, salt: 'g16b', arms: ['default'] }, slots: { [SLOT]: { reward: 'click' } } }),
    baseline(PRIORS_KIND, EMPTY_PRIORS),
    baseline(REFLEX_KIND, { ...DEFAULT_REFLEX_CONFIG, version: 'g16b-registry' }, reflexScopeForTenant(TENANT)),
  ], '0:' + crypto.randomUUID());
  invalidatePublicationCache();
  return { env, storage, shoppers, calls, shopper, answered, admission, fetch: fetchOne, drain };
}

/** An anonymous shopper whose explicit choice (tracking and personalization) went through the real route. */
async function shopperOn(m: Mounted) {
  const grant = await newAnonymousSession(m.env, TENANT);
  const chosen = await m.fetch(new Request(`https://shop.invalid/realtime/session/${grant.sessionId}/preferences`, {
    method: 'POST', headers: { 'X-Tenant': TENANT, [SHOPPER_HEADER]: grant.capability, 'Content-Type': 'application/json' },
    body: JSON.stringify({ trackingConsent: true, personalizationEnabled: true,
      choice: { id: crypto.randomUUID(), expectedRevision: null, grantId: grant.grantId, iat: grant.iat, exp: grant.exp } }) }));
  await m.drain();
  expect(chosen.status, 'PRECONDITION: the shopper\'s explicit choice is accepted').toBe(200);
  expect(m.shopper(), 'PRECONDITION: the shopper\'s object answered the choice').toBe(m.shoppers.get(shopperObjectName(TENANT as TenantId, grant.subject))?.object);
  const decide = () => m.fetch(new Request(`https://shop.invalid/v1/${TENANT}/decisions/snapshot`, {
    method: 'POST', headers: { 'X-Tenant': TENANT, [SHOPPER_HEADER]: grant.capability, 'Content-Type': 'application/json' },
    body: JSON.stringify({ page: PAGE, brand: BRAND }) }));
  return { grant, decide };
}

/** The member names of an answer, recursively (arrays by their first element): its shape, not its values. */
function shapeOf(value: unknown): unknown {
  if (Array.isArray(value)) return value.length ? [shapeOf(value[0])] : [];
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, shapeOf((value as Record<string, unknown>)[key])]));
  return typeof value;
}

/** The `learning_incomplete` lines the engine wrote while `run` ran (fan.ts:837). */
async function learningLines(run: () => Promise<void>): Promise<unknown[]> {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  try { await run(); return warn.mock.calls.filter(call => call[0] === 'learning_incomplete').map(call => call[1]); }
  finally { warn.mockRestore(); }
}

/** What the engine reports for a fan-out the owner refused before it started: `reportLearningIncomplete('decisions', null)` (service.ts:1057-1058). */
async function notAttemptedReceipt(): Promise<unknown> {
  const [line] = await learningLines(async () => { reportLearningIncomplete('decisions', null); });
  return line;
}

interface HeldDecision {
  /** The plain answer first: no read held. */
  plain: { status: number; body: unknown; reached: string[] };
  answeredWhileHeld: boolean;
  callsWhileHeld: DestinationCall[];
  status: number | null;
  body: unknown;
  /** The operation that started the held read was the shopper's owner, active, as the engine itself judges it (`ownerHeld`). */
  readUnderOwner: boolean;
  /** That operation had ended (`active` false) when its answer came back. */
  answeredOperationEnded: boolean;
  /** Destination calls after the release. */
  callsAfterRelease: DestinationCall[];
  /** `learning_incomplete` lines from the held request to the end of the drain. */
  learning: unknown[];
}

/**
 * One plain decision, then one whose erasure read is held: wait for the answer
 * while the read is held, run `between` (the leg's change) and release the read,
 * then drain everything the platform keeps alive.
 */
async function heldDecision(m: Mounted, s: Awaited<ReturnType<typeof shopperOn>>, between: () => (() => void) | undefined): Promise<HeldDecision> {
  const plainResponse = await s.decide(); const plainBody = await plainResponse.json() as unknown; await m.drain();
  const plain = { status: plainResponse.status, body: plainBody, reached: m.calls.map(call => call.name).sort() };
  m.calls.length = 0;
  let release!: (value: null) => void;
  m.storage.heldKey = tombstoneKey(TENANT, s.grant.subject);
  m.storage.gate = new Promise<null>(resolve => { release = resolve; });
  let readUnderOwner = false;
  m.storage.onHeldRead = () => {
    if (m.answered.operation) return;
    const operation = currentOperation(), owner = m.shopper();
    m.answered.operation = operation;
    readUnderOwner = !!owner && ownerHeld(owner) && !!operation?.active && operation.owner === owner;
  };
  const got: { response: Response | null } = { response: null };
  let answeredWhileHeld = false, callsWhileHeld: DestinationCall[] = [], answeredOperationEnded = false;
  let callsAfterRelease: DestinationCall[] = [], undo: (() => void) | undefined;
  const learning = await learningLines(async () => {
    const pending = s.decide().then(r => { got.response = r; return r; });
    const deadline = Date.now() + ANSWER_WAIT_MS;
    while (!got.response && Date.now() < deadline) await sleep(10);
    answeredWhileHeld = got.response !== null;
    answeredOperationEnded = m.answered.operation?.active === false;
    callsWhileHeld = [...m.calls];
    try { undo = answeredWhileHeld ? between() : undefined; release(null); await pending; await m.drain(); }
    finally { if (undo) undo(); }
    callsAfterRelease = m.calls.slice(callsWhileHeld.length);
  });
  m.storage.gate = null; m.storage.onHeldRead = null;
  const answer = got.response;
  return { plain, answeredWhileHeld, callsWhileHeld, status: answer?.status ?? null, body: answer ? await answer.json() as unknown : null,
    readUnderOwner, answeredOperationEnded, callsAfterRelease, learning };
}

describe('unit:G16b.W09 the decision answer is not held by the erasure read, and the fan-out after it re-enters the shopper\'s owner as a new operation or reaches no destination, on both hosts', () => {
  for (const host of HOSTS) {
    it(`host (leg A, ${host} host): the grant expires after the answer and before the held erasure read is released, so the re-entered fan-out reaches no destination and is reported as not attempted`, async () => {
      const refused = await notAttemptedReceipt();
      const m = await mount(host, false), s = await shopperOn(m);
      const r = await heldDecision(m, s, () => {
        // The shopper's grant expires now (sessionCapability.ts:206), after the answer, before the release.
        const clock = vi.spyOn(Date, 'now').mockReturnValue((s.grant.exp + 1) * 1000);
        return () => clock.mockRestore();
      });
      expect(r.plain.status, 'PRECONDITION: the plain decision answers').toBe(200);
      expect(r.plain.reached, 'PRECONDITION: the plain decision fans out to the shopper\'s ring and the slot\'s statistics')
        .toEqual([ringName(TENANT, s.grant.subject), statsName(TENANT, BRAND, SLOT)].sort());
      expect(r.readUnderOwner, 'PRECONDITION: the erasure read starts inside the shopper\'s active owner operation (continueAfterOwnerRead, sessionAuthority.ts:552-555)').toBe(true);
      // serveContentDecisions, service.ts:1042-1050 (W06.05): the answer is not held by the erasure read; status and shape are the plain answer's.
      expect(r.answeredWhileHeld, 'the decision answered while its erasure read was held').toBe(true);
      expect(r.status).toBe(r.plain.status);
      expect(shapeOf(r.body)).toEqual(shapeOf(r.plain.body));
      // fanDecisions, fan.ts:1039, :1102: no destination before the erasure read settles.
      expect(r.callsWhileHeld, 'a destination reached while the erasure read was held').toEqual([]);
      // sessionAuthority.ts reenterOwner, :565-567, admits the principal again against the grant authority now (the `admit` hook of
      // ShopperReflex.serialize, :3872 → assertOwned, :3385 → assertSessionTarget, sessionCapability.ts:206): the expired grant is
      // refused before `work` runs, so neither destination is reached.
      expect(r.callsAfterRelease, 'a destination reached after the shopper\'s grant expired').toEqual([]);
      // serveContentDecisions, service.ts:1057-1058 → reportLearningIncomplete, fan.ts:838, :841: the refusal is reported as the
      // engine's not-attempted receipt.
      expect(r.learning, 'the refused fan-out is reported as the engine\'s not-attempted learning receipt').toEqual([refused]);
      expect(r.learning[0]).toMatchObject({ code: 3, ringNotAttempted: 1 });
    }, 60_000);

    it(`host (leg B, ${host} host): released cleanly after the answer, the fan-out reaches both destinations, each while the shopper's owner is held, in an operation that is not the answered one`, async () => {
      const m = await mount(host, false), s = await shopperOn(m);
      const r = await heldDecision(m, s, () => undefined);
      expect(r.plain.status, 'PRECONDITION: the plain decision answers').toBe(200);
      expect(r.plain.reached, 'PRECONDITION: the plain decision fans out to the shopper\'s ring and the slot\'s statistics')
        .toEqual([ringName(TENANT, s.grant.subject), statsName(TENANT, BRAND, SLOT)].sort());
      expect(r.readUnderOwner, 'PRECONDITION: the erasure read starts inside the shopper\'s active owner operation (continueAfterOwnerRead, sessionAuthority.ts:552-555)').toBe(true);
      // serveContentDecisions, service.ts:1042-1050 (W06.05): the answer is not held by the erasure read; status and shape are the plain answer's.
      expect(r.answeredWhileHeld, 'the decision answered while its erasure read was held').toBe(true);
      expect(r.status).toBe(r.plain.status);
      expect(shapeOf(r.body)).toEqual(shapeOf(r.plain.body));
      // sessionAuthority.ts runOwnerOperation, :511: the operation that started the read is the one that answered, and it has ended.
      expect(r.answeredOperationEnded, 'PRECONDITION: the operation that started the erasure read is the one that answered').toBe(true);
      expect(r.callsWhileHeld, 'a destination reached while the erasure read was held').toEqual([]);
      // sessionAuthority.ts reenterOwner, :568-569 and :578-582: after the release the fan-out runs in a NEW, active operation of
      // the same owner, entered through ShopperReflex.serialize (:3863-3879), and reaches the ring's /append and the placement's
      // /exposures (fanDecisions, fan.ts:1108-1111) inside it; never detached from the owner and never under the answered operation.
      const expected = [
        { name: ringName(TENANT, s.grant.subject), path: '/append', ownerHeld: true, answered: false },
        { name: statsName(TENANT, BRAND, SLOT), path: '/exposures', ownerHeld: true, answered: false },
      ].sort((a, b) => a.name.localeCompare(b.name));
      expect([...r.callsAfterRelease].sort((a, b) => a.name.localeCompare(b.name)),
        'both destinations reached after the release, each inside a new operation of the shopper\'s owner').toEqual(expected);
      // reportLearningIncomplete, fan.ts:833: a complete receipt writes no learning_incomplete line.
      expect(r.learning, 'the re-entered fan-out was reported incomplete').toEqual([]);
    }, 60_000);

    it(`host (leg C, ${host} host): with durable recovery on, the decision answer still waits for the durable admission of its records, and the fan-out runs inside the answering operation before it answers`, async () => {
      const m = await mount(host, true), s = await shopperOn(m);
      // Test-only observer: the shopper object's own durable-admission hook (ShopperReflex.admitRecovery, :3889-3893).
      const asked = vi.spyOn(ShopperReflex.prototype as unknown as { admitRecovery: (...args: unknown[]) => Promise<unknown> }, 'admitRecovery');
      let release!: () => void, admissionEntered = false;
      m.admission.gate = new Promise<void>(resolve => { release = resolve; });
      const admissionReached = new Promise<void>(resolve => {
        m.admission.entered = () => { if (!admissionEntered) m.answered.operation = currentOperation(); admissionEntered = true; resolve(); };
      });
      const got: { response: Response | null } = { response: null };
      let waitedForAdmission = false, callsWhileHeld: DestinationCall[] = [], admissionAsked = false, response: Response | null = null;
      try {
        const pending = s.decide().then(r => { got.response = r; return r; });
        await Promise.race([admissionReached, pending, sleep(ANSWER_WAIT_MS)]);
        // Long enough for an answer that does not wait for the admission to come back: the engine answers in milliseconds.
        await sleep(ADMISSION_HOLD_MS);
        waitedForAdmission = admissionEntered && got.response === null; callsWhileHeld = [...m.calls];
        release();
        response = await pending; await m.drain();
        admissionAsked = asked.mock.calls.length > 0;
      } finally { asked.mockRestore(); m.admission.gate = null; }
      expect(admissionAsked, 'PRECONDITION: the decision asked the shopper\'s object for the durable admission of its records (ShopperReflex admitRecovery)').toBe(true);
      // serveContentDecisions, service.ts:1049-1054 and :1111: under durable recovery the admission is inside `captured`, which the
      // owner drains before it answers (`ownerDrain` is `afterResponse`; the snapshot handler, decisions.ts:1110); consent.test.ts
      // W09.09 pins the same inside the owner, this leg through the route.
      expect(waitedForAdmission, 'the decision answered before the durable admission of its records (savePayload, recovery.ts:119) was written').toBe(true);
      expect(callsWhileHeld, 'a destination reached before the durable admission').toEqual([]);
      expect(response?.status).toBe(200);
      // After the admission, both destinations are written inside the answering operation while it is held, so before it
      // answers (sessionAuthority.ts runOwnerOperation, :504-511, drains retained work before `held.active = false`): the ring's
      // `/append` and the placement's `/exposures` (fanDecisions, fan.ts:1109; `deliverStats` posts `'/' + kind`, fan.ts:683).
      const expected = [
        { name: ringName(TENANT, s.grant.subject), path: '/append', ownerHeld: true, answered: true },
        { name: statsName(TENANT, BRAND, SLOT), path: '/exposures', ownerHeld: true, answered: true },
      ].sort((a, b) => a.name.localeCompare(b.name));
      const writes = m.calls.filter(call => call.path === '/append' || call.path === '/exposures').sort((a, b) => a.name.localeCompare(b.name));
      expect(writes, 'both destinations written after the admission, inside the answering operation').toEqual(expected);
      // Every other call the recovered fan-out makes to either destination is inside the answering operation too.
      expect(m.calls.every(call => call.ownerHeld && call.answered), JSON.stringify(m.calls)).toBe(true);
    }, 60_000);
  }
});

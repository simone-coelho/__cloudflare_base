// src/units/_parity10.ts
// The tenth shared harness of the parity unit files: what the S13 tickets of the
// outcome-telling programme (amendment 7), P64 and P65, need beyond the harness files
// pinned by receipted tickets (src/units/_parity.ts, _parity8.ts and the rest), which
// are never edited here.
//
// It holds no expected value of any ticket. It adds, over the environment `mount`
// (src/units/_parity.ts) builds, so every binding, object and document is the one the
// other parity units use:
//   · THE WORLD OUT-K3 REPRODUCED (_evidence/baseline-52/outcome-k3/logs/
//     repro-REPRO.unit.test.ts.txt :16-21, :98-109): P33 K3's catalogue, slots and learn
//     document (src/units/P33/LEDGER.unit.test.ts:71-84: complete-the-look featuring the
//     quilted Tabby, a content slot below the layout, both learning against add_to_bag),
//     one shopper with their explicit choice, a page view, the product page with its page
//     instance, every layout decision acknowledged, the ledger drained and the shopper
//     object's alarm cleared; the worker's error path over it (src/units/_parity8.ts
//     `workerApp`).
//   · A RESET OF THE SHOPPER'S OBJECT (`resettable`), the analyst's lever (repro :29-80)
//     with the moment it fires named by the behaviour capture's durable admission instead
//     of the outcome's: once the storage transaction that writes the behaviour capture's
//     recovery body for one event has committed, and the alarm calls that arm its
//     backstop have been made, the object's first other storage call fails with
//     "Connection closed…", and so does every later one and every remote effect it makes
//     (R2 writes, the event queue, the ring and statistics objects), until `revive()`
//     builds a fresh instance over the same durable storage, as the platform does after a
//     reset.
//   · ONE FAILED READ OF THE LEARN DOCUMENT (`failLearnReadOnce`): the read the outcome's
//     learning preparation makes (src/learn/route.ts `outcomeToLearning`,
//     `readRevision(env, LEARN_KIND, scope)`) refuses once, at the seam
//     src/content/consent.test.ts:1069 injects "a propagated preparation failure" at.
//   · READERS: the tenant's lost-evidence counters, read as the monitor reads them
//     (src/ops/monitor.ts `runMonitor`, `readEvidenceLoss(env, tenant, now)`), and one
//     outcome record read by the operator's ledger route (`GET /v1/:tenant/ledger/:id
//     ?stream=outcome`, the read OUT-K3's walker made).
// Documents are read from the tree this file lives in, never the working directory.

import { expect, vi } from 'vitest';

import * as versionedStore from '@/config/versionedStore';
import { LEARN_KIND } from '@/content/kinds';
import { ShopperReflex } from '@/durable-objects/ShopperReflex';
import { readEvidenceLoss, type EvidenceLoss } from '@/ledger/delivery';
import { shopperObjectName } from '@/tenancy/objects';
import type { TenantId } from '@/tenancy/tenant';

import {
  asOperator, BRAND, declaredSlots, expectPublished, layoutSlot, LAYOUT, learnDocument, M, MODULES, mount, PAGE_VIEW, PAID_SOCIAL_ENTRY,
  pageInstanceOf, recentSlot, shopperOn, TENANT, type Host, type Mounted, type Shopper, type Snapshot,
} from './_parity';
import { clearShopperAlarm, settle, workerApp, type WorkerApp } from './_parity8';

// ---------------------------------------------------------------------------
// The world.
// ---------------------------------------------------------------------------

export const STORY = 'pdp-story';
/** COA-CW620 · Tabby Shoulder Bag 26 With Quilting: featured by complete-the-look (reco.2). */
export const BAG = 'COA-CW620';
export const OUTCOME_PIECES = [
  ...MODULES.map(m => (m.id === M.reco2 ? { ...m, featuredProductIds: [BAG] } : m)),
  { id: 'story.tabby', customerContentId: 'TAP-STORY-TABBY', type: 'editorial', title: 'The Tabby story', tags: { line: ['Tabby'] }, slotTypes: [STORY], lifecycle: { status: 'live' } },
];
export const OUTCOME_SLOTS = declaredSlots([layoutSlot(), recentSlot(), { slot: STORY, take: 1, weights: { line: 1 } }]);
export const OUTCOME_LEARN = learnDocument({
  [LAYOUT]: { measurementBasis: 'rendered-v1', reward: 'add_to_bag', attribution: 'module-tied' },
  [STORY]: { measurementBasis: 'rendered-v1', reward: 'add_to_bag' },
});

/** A buy-box add to bag of the quilted Tabby, in the customer's payload (docs/kit/03-payload-schemas.md; P33's `addToBag`). */
export const BUY_BOX = { type: 'add_to_cart', data: { productId: BAG, price: 575, currency: 'USD', quantity: 1, brand: BRAND } };
/**
 * An add to bag of a product the tenant does not hold, every value one its catalogue refuses
 * (src/units/W35/LEDGER.unit.test.ts:122 `UNKNOWN`): dropped as `unknown_product` on both hosts
 * (ShopperReflex.ts ingest, RealtimeSegmentEngine.ts, the W35 A1 drop), before any counter.
 */
export const UNKNOWN_ADD = { type: 'add_to_cart', data: { productId: 'not-a-held-sku', line: 'Not-A-Line', category: 'Not-A-Category', price: 99, currency: 'USD', quantity: 1, brand: BRAND } };

export interface OutcomeWorld { m: Mounted; app: WorkerApp; s: Shopper; page: Snapshot }

/**
 * The world on one host: published, one shopper with the given consent (tracking and
 * personalization by default), a page view, the product page served with its page instance
 * and, under tracking consent, every layout decision acknowledged; the ledger drained and the
 * shopper object's alarm cleared, so a later read names only what the unit's own event did.
 */
export async function outcomeWorld(host: Host, label: string, consent: { tracking: boolean; personalization: boolean } = { tracking: true, personalization: true }): Promise<OutcomeWorld> {
  const m = await mount(host, { pieces: OUTCOME_PIECES, slots: OUTCOME_SLOTS, learn: OUTCOME_LEARN });
  expectPublished(m, `${label} — P33 K3's catalogue, slots and learn document publish`);
  const s = await shopperOn(m, consent);
  expect((await s.action(PAGE_VIEW, PAID_SOCIAL_ENTRY)).status, `PRECONDITION (${host}): the shopper's page view is accepted`).toBe(200);
  const page = await s.snapshot('pdp', { pageInstance: pageInstanceOf(label) });
  expect(page.status, `PRECONDITION (${host}): the shopper's product page is served (${JSON.stringify(page.body).slice(0, 300)})`).toBe(200);
  if (consent.tracking) {
    for (const d of page.decisions.filter(x => x.slot === LAYOUT)) expect((await s.ack(page, d)).status, `PRECONDITION (${host}): ${d.contentId} is acknowledged`).toBe(200);
  }
  await m.drainLedger();
  if (consent.tracking) await clearShopperAlarm(m, s.subject);
  return { m, app: workerApp(m), s, page };
}

/** Every pending piece of work settled, any task that rejects included (a reset leaves rejected work behind). */
export async function settleAll(m: Mounted, app: WorkerApp): Promise<void> {
  for (let round = 0; round < 6; round++) {
    try { await settle(m, app); } catch { /* a rejected pending task: what it left is read by the unit */ }
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

// ---------------------------------------------------------------------------
// The reset.
// ---------------------------------------------------------------------------

/** The failure every storage call and remote effect of a reset object answers with (the analyst's lever, repro :22). */
export const RESET_MESSAGE = 'Connection closed: this Durable Object instance is no longer active';

type Fn = (...args: unknown[]) => Promise<unknown>;
const STORAGE_METHODS = ['get', 'put', 'list', 'transaction', 'delete', 'deleteAll', 'setAlarm', 'getAlarm', 'deleteAlarm'] as const;

export interface Reset {
  /**
   * `fired`: the behaviour capture's durable admission was seen to commit (kept past `revive`);
   * `committed`: every storage key that admission's transaction wrote (kept past `revive`);
   * `dead` and `killedAt`: whether the object is down, and the call it went down at.
   */
  readonly state: { fired: boolean; committed: string[]; armed: boolean; admitted: boolean; dead: boolean; killedAt: string };
  /** Builds a fresh instance of the shopper's object over the same durable storage, restoring every binding. */
  revive: () => ShopperReflex;
  /** The current instance. */
  object: () => ShopperReflex;
  /** The alarm the durable storage holds, read past the reset. */
  alarmAt: () => Promise<number | null>;
}

/**
 * The shopper's object, resettable at one moment: right after the durable admission of the
 * behaviour capture of the event `eventId`. That admission is W06's
 * (src/ledger/recovery.ts `savePayload`: one storage transaction writing the operation's
 * `recoveryBody:` chunks and its `recoveryOperation:` record, then `armRecovery`); the moment
 * is the end of the first storage transaction that writes a `recoveryBody:` chunk carrying
 * the behaviour capture (`"kind":"behavior"`) of that event, followed by the alarm calls
 * (`getAlarm`, `setAlarm`, `deleteAlarm`) that arm its backstop. From the first other storage
 * call on, every storage call of the object and every remote effect (R2 `put` and `delete`,
 * the event queue, the ring and statistics objects) fails with RESET_MESSAGE, until `revive`.
 * Whatever else the same transaction writes (an outcome admitted with it) is committed with it.
 */
export function resettable(m: Mounted, subject: string, eventId: string): Reset {
  const name = shopperObjectName(TENANT as TenantId, subject);
  const item = m.shoppers.get(name);
  expect(item ? 'held' : 'absent', `PRECONDITION (${m.host}): the shopper's own object exists`).toBe('held');
  const first = item!.object as unknown as { state: DurableObjectState };
  // The object's state as the namespace handed it (its storage view reads the stub's members at
  // each call, src/ops/synthetic.ts `wrapStorage`); a fresh instance is built over the same state.
  const raw = first.state;
  const storage = raw.storage as unknown as Record<string, Fn>;
  const state = { fired: false, committed: [] as string[], armed: true, admitted: false, dead: false, killedAt: '' };
  const originals: Partial<Record<(typeof STORAGE_METHODS)[number], Fn>> = {};
  const die = (at: string) => { if (!state.dead) { state.dead = true; state.killedAt = at; } return Promise.reject(new Error(RESET_MESSAGE)); };
  for (const method of STORAGE_METHODS) {
    const original = storage[method];
    if (typeof original !== 'function') continue;
    originals[method] = original;
    storage[method] = (...args: unknown[]) => {
      if (state.dead) return die(`storage.${method}`);
      if (state.admitted && !['getAlarm', 'setAlarm', 'deleteAlarm'].includes(method)) return die(`storage.${method}`);
      if (method !== 'transaction' || !state.armed) return original(...args);
      // The admission's transaction: committed whole; the reset comes right after it.
      let carries = false;
      const written: string[] = [];
      const run = args[0] as (tx: DurableObjectTransaction) => Promise<unknown>;
      return original((tx: DurableObjectTransaction) => run(new Proxy(tx, { get: (target, property) => {
        const value = Reflect.get(target, property, target) as unknown;
        if (property !== 'put' || typeof value !== 'function') return value;
        return (key: unknown, stored?: unknown, ...rest: unknown[]) => {
          const entries = typeof key === 'string' ? [[key, stored]] : Object.entries((key ?? {}) as Record<string, unknown>);
          for (const [k, v] of entries) {
            if (typeof k === 'string') written.push(k);
            if (typeof k === 'string' && k.startsWith('recoveryBody:') && typeof v === 'string' && v.includes('"kind":"behavior"') && v.includes(eventId)) carries = true;
          }
          return (value as (...a: unknown[]) => unknown).call(target, key, stored, ...rest);
        };
      } }))).then(result => { if (carries) { state.fired = true; state.committed = written; state.armed = false; state.admitted = true; } return result; });
    };
  }
  // The dead instance's remote effects fail too (the analyst's set, repro :57-66).
  const restores: Array<() => void> = [];
  const r2 = m.storage as unknown as Record<string, Fn>;
  for (const method of ['put', 'delete']) {
    const original = r2[method]!;
    r2[method] = (...args: unknown[]) => state.dead ? die(`STORAGE.${method}`) : original.apply(m.storage, args);
    restores.push(() => { r2[method] = original; });
  }
  const queue = m.env.EVENT_QUEUE as unknown as Record<string, Fn>;
  for (const method of ['send', 'sendBatch']) {
    const original = queue[method]!;
    queue[method] = (...args: unknown[]) => state.dead ? die(`EVENT_QUEUE.${method}`) : original.apply(queue, args);
    restores.push(() => { queue[method] = original; });
  }
  for (const binding of ['DECISION_RING', 'LEARN_STATS'] as const) {
    const namespace = m.env[binding] as unknown as { get: (id: unknown) => { fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> } };
    const get = namespace.get;
    namespace.get = (id: unknown) => {
      const stub = get.call(namespace, id);
      return { fetch: (input, init) => state.dead ? die(`${binding}.fetch`) as Promise<Response> : stub.fetch(input, init) };
    };
    restores.push(() => { namespace.get = get; });
  }
  return {
    state,
    revive() {
      state.dead = false; state.admitted = false; state.armed = false;
      for (const [method, original] of Object.entries(originals)) storage[method] = original as Fn;
      for (const restore of restores) restore();
      const fresh = new ShopperReflex(raw, m.env);
      (item as { object: unknown }).object = fresh;
      return fresh;
    },
    object: () => item!.object as unknown as ShopperReflex,
    alarmAt: () => (originals.getAlarm ?? storage.getAlarm!)() as Promise<number | null>,
  };
}

// ---------------------------------------------------------------------------
// One failed read of the learn document.
// ---------------------------------------------------------------------------

export interface LearnReadFault {
  /** How many reads of the learn document were refused (at most one). */
  readonly failed: number;
  /** How many reads of the learn document were made while the fault was installed. */
  readonly reads: number;
  restore: () => void;
}

/**
 * The first read of the tenant's learn document through `readRevision`
 * (src/config/versionedStore.ts) from now on refuses once with `message`; every other read
 * answers as before. On the action path that read is the outcome's learning preparation
 * (src/learn/route.ts `outcomeToLearning`), made before the outcome's durable admission.
 */
export function failLearnReadOnce(message = 'injected: learn document unavailable'): LearnReadFault {
  let failed = 0, reads = 0;
  const original = versionedStore.readRevision;
  const spy = vi.spyOn(versionedStore, 'readRevision').mockImplementation(((env: Parameters<typeof original>[0], kind: Parameters<typeof original>[1], scope: string, now?: number) => {
    if (kind.name === LEARN_KIND.name && scope === TENANT) {
      reads++;
      if (!failed) { failed++; return Promise.reject(new Error(message)); }
    }
    return original(env, kind, scope, now);
  }) as typeof original);
  return { get failed() { return failed; }, get reads() { return reads; }, restore: () => spy.mockRestore() };
}

// ---------------------------------------------------------------------------
// Readers.
// ---------------------------------------------------------------------------

/** The tenant's lost-evidence counters as the monitor reads them (src/ops/monitor.ts `runMonitor`: `readEvidenceLoss(env, tenant, now)`). */
export async function evidenceLoss(m: Mounted): Promise<EvidenceLoss> {
  const loss = await readEvidenceLoss(m.env, TENANT, Date.now());
  expect(loss ? 'read' : 'unreadable', `PRECONDITION (${m.host}): the tenant's lost-evidence counters are readable`).toBe('read');
  return loss!;
}

/** The operator's read of one outcome record by its id (`GET /v1/:tenant/ledger/:id?stream=outcome`): the status it answers. */
export async function outcomeRead(m: Mounted, outcomeId: string): Promise<number> {
  return (await asOperator(m, 'GET', `/v1/${TENANT}/ledger/${encodeURIComponent(outcomeId)}?stream=outcome`)).status;
}

/** The engine time a behaviour record id carries (src/ledger/behavior.ts: `${tenant}:${ts36(time)}:${subject}:behavior:${eventId}`). */
export function timeOfRecordId(recordId: unknown): number | null {
  if (typeof recordId !== 'string') return null;
  const code = recordId.split(':')[1];
  return code && /^[0-9a-z]+$/.test(code) ? parseInt(code, 36) : null;
}

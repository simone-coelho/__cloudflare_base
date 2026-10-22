// src/units/_base52/G16.unit.test.ts
// Baseline-52 product unit G16 (remediation W06.05 under the W09 owner rule).
//
// G16's specification is the existing RED test `src/content/consent.test.ts:1010`
// (W06.05: the erasure check runs in the background without holding the decision
// answer) TOGETHER WITH this file, which pins the second constraint the lead
// ruled for the same fix: no fan-out runs outside an owner operation (W09).
// The consent lane's reviewer measured that an owner check tolerating an owner
// that has already answered (control ctl4a: `if (held?.active)` in
// `pinRetention`, sessionAuthority.ts:329) turns the whole consent file green,
// so :1010 alone would accept a weakened W09 fence. This file is GREEN at
// 3da22a90 and RED under ctl4a; the fix G16 builds must keep it green.
//
// WITNESSES (read at 3da22a90; line numbers re-verified at 3deaa0ba, where G16 is merged)
//   · the lead's ruling, `_evidence/parity-step3/AMENDMENTS.md:273` ("lane
//     consent built"): G16's spec is :1010 "under both constraints at once: the
//     decision answer is not held by the erasure read, and no fan-out runs
//     outside an owner operation (W09)"; :276 ("lane consent merged"): "G16
//     needs its own check that no fan-out runs outside an owner operation".
//   · the owner fence: `recheckOwnerInvocation` refuses an invocation that is no
//     longer active or belongs to another owner (sessionAuthority.ts:319-321);
//     `pinRetention` runs that recheck for any caller inside an owner's async
//     lifetime before it admits a retained stamp (sessionAuthority.ts:327-330).
//   · the fan-out pins every record's online stamp through that fence before
//     either destination starts (`fanDecisions`, fan.ts:1053, then the ring and
//     statistics at fan.ts:1108-1111; "All validation/barrier/config reads precede
//     starting either destination", fan.ts:1102).
//   · the owner serializer: `runOwnerOperation` runs the work, drains every
//     retained task, rechecks, then ends the invocation (`held.active = false`,
//     sessionAuthority.ts:497-513); the shopper's object runs every owned request
//     inside it (`serialize`, ShopperReflex.ts:3863-3867 → the owned dispatch, :520),
//     and the owner's `waitUntil` is `retainOwnerWork` (sessionAuthority.ts:267-272,
//     the owner's execution context at :751).
//
// FIXTURE. A neutral tenant and one anonymous shopper; one personalized decision
// in one slot, so the fan-out has both destinations (the shopper's ring and the
// slot's statistics). The REAL DecisionRing and LearnStats classes answer, over
// in-memory storage (the idiom of src/units/W24/LEDGER.unit.test.ts, which is
// neither imported nor edited). Each destination call records the destination's
// name and whether the owner's operation was held at that moment (`ownerHeld`,
// sessionAuthority.ts:258-261). The decision's erasure (tombstone) read can be
// held open, as consent.test.ts W06.05 holds it.
//
// RESIDUAL (named, not pinned here): the fence judges only work that descends
// from an owner's operation; a fan-out with no owner in its async lifetime at all
// is admitted (`if (held)` in `pinRetention`, sessionAuthority.ts:329; src/units/W24/LEDGER.unit.test.ts:283
// fans out with no owner and is admitted). A fix that detached the serving fan-out from the owner's
// lifetime would therefore pass this file; the build review reads the diff for it.

import { describe, expect, it } from 'vitest';

import { slotLearnConfigOf } from '@/content/service';
import type { DecisionRecord, LearnConfig } from '@/content/types';
import { DecisionRing } from '@/durable-objects/DecisionRing';
import { LearnStats } from '@/durable-objects/LearnStats';
import { ownerHeld, pinRetention, recheckOwnerInvocation, retainOwnerWork, runOwnerOperation } from '@/identity/sessionAuthority';
import { SessionAccessError } from '@/identity/sessionCapability';
import { tombstoneKey } from '@/ledger/erasure';
import { ts36 } from '@/ledger/records';
import { fanDecisions, ringName, statsName, type LearningReceipt } from '@/learn/fan';
import { DEFAULT_STATS } from '@/learn/stats';
import { captureRetention, requireRetention, RETENTION_CATEGORIES, type RetentionCategory, type RetentionPolicy } from '@/retention';
import type { Env } from '@/types/env';

const TENANT = 'unit-g16';
const BRAND = 'unit-g16';
const SHOPPER = 'v-g16-shopper';
const SLOT = 'hero';
const DAY = 86_400_000;
const LEARN = { stats: DEFAULT_STATS, slots: { [SLOT]: { reward: 'click' } } } as unknown as LearnConfig;
/** What the serving path sends as each slot's learning configuration (`slotLearnConfigOf`, service.ts:195-198; `serveContentDecisions`, :1055-1056). */
const SLOT_CONFIG = slotLearnConfigOf(LEARN);
/** The catalogue's page-scoped slot names, as the serving caller already holds them (fan.ts:1003-1008): none here. */
const PAGE_SCOPED: ReadonlySet<string> = new Set();

class UnitKV {
  data = new Map<string, string>();
  async get(key: string, type?: string) { const v = this.data.get(key); return v === undefined ? null : type === 'json' ? JSON.parse(v) as unknown : v; }
  async put(key: string, value: string) { this.data.set(key, value); }
  async delete(key: string) { this.data.delete(key); }
  async list(o?: { prefix?: string }) { return { keys: [...this.data.keys()].filter(k => k.startsWith(o?.prefix ?? '')).sort().map(name => ({ name })), list_complete: true }; }
}
class UnitR2 {
  objects = new Map<string, string>();
  /** When set, the shopper's erasure (tombstone) read waits on it, as consent.test.ts W06.05 holds it. */
  heldTombstone: Promise<null> | null = null;
  async get(key: string) {
    if (this.heldTombstone && key === tombstoneKey(TENANT, SHOPPER)) return this.heldTombstone;
    const raw = this.objects.get(key); if (raw === undefined) return null;
    return { key, etag: 'v1', size: raw.length, body: new Response(raw).body, text: async () => raw, json: async () => JSON.parse(raw) as unknown };
  }
  async head(key: string) { return this.objects.has(key) ? { key } : null; }
  async put(key: string, raw: string) { this.objects.set(key, raw); return { key, etag: 'v1', size: raw.length }; }
  async delete(keys: string | string[]) { for (const key of typeof keys === 'string' ? [keys] : keys) this.objects.delete(key); }
  async list(options: { prefix?: string } = {}) {
    return { objects: [...this.objects.keys()].filter(k => k.startsWith(options.prefix ?? '')).sort().map(key => ({ key, size: 0, uploaded: new Date(0) })), truncated: false };
  }
}

const fixturePolicy: RetentionPolicy = { id: 'g16-fixture-policy', revision: 1, durationMs: 365 * DAY, basis: 'admitted', renewal: 'new-record-only' };

interface DestinationCall { name: string; held: boolean }
interface World { env: Env; owner: object; storage: UnitR2; calls: DestinationCall[] }

function world(): World {
  /** The shopper's owner: ShopperReflex passes itself (`this`) to runOwnerOperation (`serialize`, ShopperReflex.ts:3867). */
  const owner = {};
  const calls: DestinationCall[] = [];
  const storage = new UnitR2();
  const env = {
    DEPLOYMENT_PROFILE: 'demo', ENVIRONMENT: 'test', CACHE: new UnitKV(), SESSIONS: new UnitKV(), STORAGE: storage,
    TENANTS: JSON.stringify({ provisioned: [TENANT] }), LEDGER_RECOVERY_ENABLED: 'false',
    RETENTION: JSON.stringify({ version: 1, tenants: { [TENANT]: Object.fromEntries(RETENTION_CATEGORIES.map(category => [category, fixturePolicy])) as Record<RetentionCategory, RetentionPolicy> } }),
  } as unknown as Env;
  const namespaceFor = (make: (state: DurableObjectState, env: Env) => { fetch: (request: Request) => Promise<Response> }) => {
    const objects = new Map<string, { fetch: (request: Request) => Promise<Response> }>();
    return {
      idFromName: (n: string) => n,
      get: (name: string) => ({ fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
        calls.push({ name, held: ownerHeld(owner) });
        let object = objects.get(name);
        if (!object) {
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
                },
                deleteAlarm: async () => { deleteAlarm = true; }, setAlarm: async (a: number) => { nextAlarm = a; },
              } as unknown as DurableObjectTransaction;
              const result = await run(tx);
              data.clear(); for (const [key, value] of candidate) data.set(key, value);
              if (deleteAlarm) alarms.length = 0;
              if (nextAlarm !== undefined) alarms.push(nextAlarm);
              return result;
            },
            deleteAll: async () => data.clear(), delete: async (k: string) => data.delete(k),
            setAlarm: async (a: number) => { alarms.push(a); }, getAlarm: async () => alarms.at(-1) ?? null,
          };
          const state = { id: name, storage: storageStub, getWebSockets: () => [], waitUntil: () => undefined } as unknown as DurableObjectState;
          object = make(state, env); objects.set(name, object);
        }
        return object.fetch(new Request(input, init));
      } }),
    };
  };
  env.DECISION_RING = namespaceFor((state, e) => new DecisionRing(state, e)) as unknown as DurableObjectNamespace;
  env.LEARN_STATS = namespaceFor((state, e) => new LearnStats(state, e)) as unknown as DurableObjectNamespace;
  return { env, owner, storage, calls };
}

/** One personalized decision for the shopper, stamped by the engine's own capture (retention.ts:154-160). */
function decision(env: Env, ts: number): DecisionRecord {
  return {
    decision_id: `${TENANT}:${ts36(ts)}:${SHOPPER}:home:${SLOT}:0`,
    tenant: TENANT, brand: BRAND, visitor_id: SHOPPER, session_id: `s-${SHOPPER}`, identity_anchor: 'visitor', ts,
    page: 'home', slot: SLOT, position: 0, item_id: 'cnt-g16-piece', customer_item_id: 'CMS-G16-PIECE', candidates: [],
    cell: { channel: 'web', visit_bucket: 'new', stage: 'unknown', region: 'none', affinity: 'none' },
    arm: 'personalized', explored: false, authority: 'engine',
    versions: { config: 1, lift: 0, prior: 0, policy: 1 }, config_label: 'g16',
    explain: { drivers: [], score_base: 0, lift: null, score_final: 0 },
    retention: captureRetention(env as never, TENANT, ts, ts),
  } as unknown as DecisionRecord;
}
const setOf = (record: DecisionRecord) => ({ tenant: TENANT, brand: BRAND, visitor_id: SHOPPER, records: [record] });
/** The destinations one admitted fan-out of this set reaches, named by the engine's own helpers (fan.ts:90, :119, :1108-1111). */
const destinations = () => [ringName(TENANT, SHOPPER), statsName(TENANT, BRAND, SLOT)].sort();
const reached = (calls: DestinationCall[]) => calls.map(call => call.name).sort();

describe('unit:G16.W09 no fan-out runs outside an owner operation: the fan-out is admitted inside the owner\'s operation, including one started as its own operation after the answer, and refused once the owner has answered', () => {
  it('host-internal: a fan-out the owner retains (the owner\'s waitUntil) runs inside the operation and is admitted at the owner fence and at both destinations', async () => {
    const w = world(), record = decision(w.env, Date.now() - 60_000);
    let pinned: unknown, fan!: Promise<LearningReceipt>;
    await runOwnerOperation(w.owner, w.env, async () => {
      // `pinRetention`, sessionAuthority.ts:327-330: inside the active operation the fence admits the record's stamp, the stamp requireRetention reads.
      pinned = pinRetention(w.env, record.retention?.online, TENANT, 'online');
      // decisions.ts:1110 hands the owner's drain to waitUntil; inside the owner that is retainOwnerWork (sessionAuthority.ts:751, :267-272).
      fan = fanDecisions(w.env, setOf(record), SLOT_CONFIG, undefined, PAGE_SCOPED);
      retainOwnerWork(fan);
    });
    expect(pinned).toEqual(requireRetention(w.env, record.retention?.online, TENANT, 'online'));
    const receipt = await fan;
    // fan.ts:812-818: `ok` only when every destination acknowledged.
    expect(receipt.ok, JSON.stringify(receipt)).toBe(true);
    // fan.ts:1108-1111: both destinations reached, each while the owner's operation was held (`ownerHeld`, sessionAuthority.ts:258-261).
    expect(reached(w.calls)).toEqual(destinations());
    expect(w.calls.every(call => call.held), JSON.stringify(w.calls)).toBe(true);
  });

  it('host-internal: a fan-out that outlives the owner\'s answer is refused at the owner fence before either destination', async () => {
    const w = world(), record = decision(w.env, Date.now() - 60_000);
    let release!: (value: null) => void;
    w.storage.heldTombstone = new Promise<null>(resolve => { release = resolve; });
    let fan!: Promise<LearningReceipt>, pinLater!: Promise<unknown>, recheckLater!: Promise<unknown>;
    const gate = w.storage.heldTombstone;
    const answer = await runOwnerOperation(w.owner, w.env, async () => {
      // Started inside the operation and NOT retained: it outlives the answer, awaiting the held erasure read (fan.ts:1039).
      fan = fanDecisions(w.env, setOf(record), SLOT_CONFIG, undefined, PAGE_SCOPED);
      // Two continuations in the same async lifetime, resumed only after the owner has answered.
      pinLater = gate.then(() => pinRetention(w.env, record.retention?.online, TENANT, 'online'));
      recheckLater = gate.then(() => recheckOwnerInvocation(w.owner));
      void fan.catch(() => undefined); void pinLater.catch(() => undefined); void recheckLater.catch(() => undefined);
      return 'answered';
    });
    // Harness precondition: the owner answered while the erasure read was still held.
    expect(answer).toBe('answered');
    release(null);
    const receipt = await fan;
    // W09 (AMENDMENTS.md:273, :276): no fan-out outside an owner operation. fan.ts:1053 → `pinRetention` sessionAuthority.ts:329 →
    // `recheckOwnerInvocation` :321 refuses before either destination starts (fan.ts:1102, :1108-1111), so neither the ring nor the statistics is reached.
    expect(w.calls, 'a destination reached after the owner answered').toEqual([]);
    // fan.ts:812-818: a refused fan-out is not a delivered one.
    expect(receipt.ok, JSON.stringify(receipt)).toBe(false);
    // sessionAuthority.ts:327-330 → :321: the fence itself refuses the finished owner, with the engine's own error.
    await expect(pinLater).rejects.toBeInstanceOf(SessionAccessError);
    await expect(recheckLater).rejects.toBeInstanceOf(SessionAccessError);
  });

  it('host-internal: a fan-out started as its own owner operation after the answer is admitted, its erasure read held and released inside that operation', async () => {
    const w = world(), record = decision(w.env, Date.now() - 60_000);
    // The shopper's request is answered first, with no fan-out retained by it.
    expect(await runOwnerOperation(w.owner, w.env, async () => 'answered')).toBe('answered');
    let release!: (value: null) => void;
    w.storage.heldTombstone = new Promise<null>(resolve => { release = resolve; });
    let settled = false, pinned: unknown;
    // A second operation of the same owner (`serialize`, ShopperReflex.ts:3863, serializes each one), running the erasure check and the fan-out.
    const second = runOwnerOperation(w.owner, w.env, async () => {
      pinned = pinRetention(w.env, record.retention?.online, TENANT, 'online');
      return fanDecisions(w.env, setOf(record), SLOT_CONFIG, undefined, PAGE_SCOPED);
    }).finally(() => { settled = true; });
    await new Promise(resolve => setTimeout(resolve, 0));
    // fan.ts:1039: the fan-out waits on the erasure read before any destination.
    expect(settled).toBe(false); expect(w.calls).toEqual([]);
    release(null);
    const receipt = await second;
    // `pinRetention`, sessionAuthority.ts:327-330: inside the second operation the fence admits the stamp requireRetention reads.
    expect(pinned).toEqual(requireRetention(w.env, record.retention?.online, TENANT, 'online'));
    // fan.ts:812-818 and :1108-1111: delivered to both destinations, each while that operation was held.
    expect(receipt.ok, JSON.stringify(receipt)).toBe(true);
    expect(reached(w.calls)).toEqual(destinations());
    expect(w.calls.every(call => call.held), JSON.stringify(w.calls)).toBe(true);
  });
});

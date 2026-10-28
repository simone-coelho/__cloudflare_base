// src/identity/freshOwner.ts
// ---------------------------------------------------------------------------
// P97 (E22; the design R-P547): the blank copy of a brand-new visitor's record.
//
// A new visitor's first request (the first-request door, src/routes/decisions.ts) mints a visitor id nobody has
// ever used, so that visitor's record is empty by construction. Creating the real record (the visitor's own
// ShopperReflex object) costs the platform's first contact with a brand-new object, which is most of a first
// answer's time live (R-P556), while nothing the first answer is decided from lives in it. So the first answer is
// decided by today's own code, the ShopperReflex class itself, run here over an EMPTY in-memory record: every
// check the object makes runs exactly as on the real record, and nothing is contacted, created or written. The real
// record is created right after the answer by the same activation (or by the visitor's next request, which adopts
// the grant if that creation is lost).
//
// The copy runs on a view of the environment that only reads. Every operation that would leave anything outside
// the copy is refused there and recorded: a key-value write or delete, an R2 write or delete, a queue send, any D1
// statement, any Durable Object call (another object, the visitor's own real object included: the copy is that
// record until the creation), any other binding's call that is not a read, and any part of the object's state or
// storage this copy does not model. The door then falls back to today's path (the real activation and forward
// under the same minted session), so a refusal never changes an answer: at worst the first answer is today's.
// The copy's own record is in memory; what its activation leaves there is exactly what the creation reproduces on
// the real record, and any change the decision itself makes to it (which the creation would not reproduce) is
// treated like a refusal.
// ---------------------------------------------------------------------------

import { ShopperReflex } from '@/durable-objects/ShopperReflex';
import { nameServingStorage } from '@/config/publication';
import { shopperObjectName } from '@/tenancy/objects';
import type { TenantId } from '@/tenancy/tenant';
import type { Env } from '@/types/env';

/** What the copy refused: an effect outside the blank record, or a part of the platform it does not model. */
export class FreshOwnerRefused extends Error {
  constructor(readonly what: string) { super(`The blank record refused ${what}`); this.name = 'FreshOwnerRefused'; }
}

/** The calls the door makes to a shopper's object (the activation and the forward), made to the copy instead. */
export interface OwnerStub { fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> }

export interface FreshOwner {
  /** The copy, called exactly as the visitor's object is called. */
  readonly stub: OwnerStub;
  /** Whether the copy refused anything: the door then takes today's path. */
  refused(): boolean;
  /** The record as the copy's activation left it: what the real record's creation reproduces. */
  activated(): void;
  /**
   * Whether the copy's decision may be the answer: once the work the copy continues past its answer has settled,
   * nothing was refused and the record is as the activation left it.
   */
  decided(): Promise<boolean>;
}

/** Binding methods that only read: a key-value store's and an R2 bucket's. Every other call of a binding is refused. */
const READS = new Set<PropertyKey>(['get', 'getWithMetadata', 'head', 'list']);
/** A Durable Object namespace's local, contact-free calls. */
const IDS = new Set<PropertyKey>(['idFromName', 'idFromString']);

type Refuse = (what: string) => never;
const isObject = (value: unknown): value is object => (typeof value === 'object' || typeof value === 'function') && value !== null;

/** A stub whose every call is refused: the copy reaches no Durable Object. */
function refusedStub(what: string, refuse: Refuse): object {
  return new Proxy({}, { get: (_target, property) => typeof property === 'symbol' || property === 'then' ? undefined : () => refuse(`${what}.${String(property)}`) });
}

/** A binding the copy may only read; a Durable Object namespace whose ids it may compute but whose objects it never calls. */
function readOnly(name: string, binding: object, refuse: Refuse): object {
  const namespace = typeof (binding as { idFromName?: unknown }).idFromName === 'function';
  return new Proxy(binding, { get(target, property) {
    const value = Reflect.get(target, property, target) as unknown;
    if (typeof value !== 'function') return value;
    if (namespace) {
      if (IDS.has(property)) return (value as (...args: unknown[]) => unknown).bind(target);
      if (property === 'get' || property === 'getByName') return () => refusedStub(`${name} object`, refuse);
      return () => refuse(`${name}.${String(property)}`);
    }
    if (READS.has(property)) return (value as (...args: unknown[]) => unknown).bind(target);
    return () => refuse(`${name}.${String(property)}`);
  } });
}

/**
 * The environment the copy runs on: every binding read-only (above), every other value (configuration, secrets) as
 * it is. An empty-target view, so a binding the platform defines as a fixed property is never handed out unguarded.
 */
function readOnlyEnvironment(env: Env, refuse: Refuse): Env {
  const views = new Map<PropertyKey, unknown>();
  const view = (property: PropertyKey): unknown => {
    if (views.has(property)) return views.get(property);
    const value = Reflect.get(env, property) as unknown;
    const guarded = isObject(value) && typeof property === 'string' ? readOnly(property, value, refuse) : value;
    // The publication serving cache keys on the backing bucket: the copy reads what the edge already holds.
    if (property === 'STORAGE' && isObject(guarded) && guarded !== value) nameServingStorage(guarded, value as object);
    views.set(property, guarded);
    return guarded;
  };
  return new Proxy(Object.create(null) as Env, {
    get: (_target, property) => view(property),
    has: (_target, property) => property in env,
    ownKeys: () => Reflect.ownKeys(env),
    getOwnPropertyDescriptor: (_target, property) => property in env ? { configurable: true, enumerable: true, value: view(property) } : undefined,
  });
}

/** Whatever the copy's state or storage does not model is refused, never answered with a guess. */
function modelled<T extends object>(what: string, model: T, refuse: Refuse): T {
  return new Proxy(model, { get: (target, property) => Reflect.has(target, property) || typeof property === 'symbol' || property === 'then'
    ? Reflect.get(target, property, target) : () => refuse(`${what}.${String(property)}`) });
}

const clone = <T>(value: T): T => (value === undefined ? value : structuredClone(value));
const order = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
interface ListOptions { start?: string; startAfter?: string; end?: string; prefix?: string; reverse?: boolean; limit?: number }

/**
 * The blank record in memory: the Durable Object storage operations the object uses, over an empty map. `changed`
 * counts every change to it, so the door can tell a record the decision changed from the one the activation left.
 */
function memoryStorage(refuse: Refuse) {
  const data = new Map<string, unknown>();
  let alarm: number | null = null, changes = 0;
  const operations = {
    async get(key: string | string[]) {
      if (!Array.isArray(key)) return clone(data.get(key));
      return new Map(key.filter(k => data.has(k)).map(k => [k, clone(data.get(k))]));
    },
    async put(key: string | Record<string, unknown>, value?: unknown) {
      const entries = typeof key === 'string' ? [[key, value] as const] : Object.entries(key);
      for (const [k, v] of entries) data.set(k, clone(v));
      changes += 1;
    },
    async delete(key: string | string[]) {
      const keys = Array.isArray(key) ? key : [key];
      let deleted = 0;
      for (const k of keys) if (data.delete(k)) deleted += 1;
      if (deleted) changes += 1;
      return Array.isArray(key) ? deleted : deleted > 0;
    },
    async deleteAll() { if (data.size) changes += 1; data.clear(); },
    async list(options: ListOptions = {}) {
      const keys = [...data.keys()].filter(k => (options.prefix === undefined || k.startsWith(options.prefix))
        && (options.start === undefined || k >= options.start) && (options.startAfter === undefined || k > options.startAfter)
        && (options.end === undefined || k < options.end)).sort(order);
      if (options.reverse) keys.reverse();
      return new Map(keys.slice(0, options.limit ?? keys.length).map(k => [k, clone(data.get(k))]));
    },
    async getAlarm() { return alarm; },
    async setAlarm(at: number | Date) { alarm = typeof at === 'number' ? at : at.getTime(); changes += 1; },
    async deleteAlarm() { if (alarm !== null) changes += 1; alarm = null; },
    /** Nothing to make durable: the record is in memory (the activation's `commit` part is then nothing). */
    async sync() { return undefined; },
  };
  const storage = modelled('storage', {
    ...operations,
    async transaction<T>(run: (tx: object) => Promise<T>): Promise<T> {
      const before = new Map(data), alarmBefore = alarm, changesBefore = changes;
      let rolledBack = false;
      const restore = () => { data.clear(); for (const [k, v] of before) data.set(k, v); alarm = alarmBefore; changes = changesBefore; };
      const tx = modelled('transaction', { ...operations, rollback() { rolledBack = true; } }, refuse);
      try { const result = await run(tx); if (rolledBack) restore(); return result; }
      catch (error) { restore(); throw error; }
    },
  }, refuse);
  return { storage, changed: () => changes };
}

/**
 * The blank copy of the brand-new visitor's record `subject` of `tenant`: a ShopperReflex over the empty in-memory
 * record above, with the id the real record has (so every check that the object is the visitor's own holds as on
 * the real one) and the read-only environment. Null when it cannot be built: the door then takes today's path.
 */
export function freshOwner(env: Env, tenant: string, subject: string): FreshOwner | null {
  const refusals: string[] = [];
  const refuse: Refuse = what => { refusals.push(what); throw new FreshOwnerRefused(what); };
  try {
    const { storage, changed } = memoryStorage(refuse);
    const pending: Promise<unknown>[] = [];
    const state = modelled('state', {
      id: env.SHOPPER_REFLEX.idFromName(shopperObjectName(tenant as TenantId, subject)),
      storage,
      /** The work the copy continues past an answer is kept, and settled before its decision is used. */
      waitUntil(promise: Promise<unknown>) { pending.push(Promise.resolve(promise).then(() => undefined, () => undefined)); },
      getWebSockets: () => [],
      async blockConcurrencyWhile<T>(run: () => Promise<T>) { return run(); },
    }, refuse);
    const object = new ShopperReflex(state as unknown as DurableObjectState, readOnlyEnvironment(env, refuse));
    let activated = 0;
    return {
      stub: { fetch: (input, init) => object.fetch(input instanceof Request && init === undefined ? input : new Request(input, init)) },
      refused: () => refusals.length > 0,
      activated: () => { activated = changed(); },
      async decided() {
        for (let round = 0; pending.length && round < 8; round++) await Promise.allSettled(pending.splice(0));
        return pending.length === 0 && refusals.length === 0 && changed() === activated;
      },
    };
  } catch { return null; }
}

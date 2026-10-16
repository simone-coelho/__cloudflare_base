// src/units/W08/_customer.ts
// The in-process customer stamp of batch W08-C1: the REAL Worker default
// export of `src/index.ts` (its customer boundary `customerRequest`, its tenant
// middleware, every mounted route), on DEPLOYMENT_PROFILE=customer with
// AUTH_MODE=enforced, over the real Durable Object classes (ShopperReflex,
// DecisionRing, LearnStats) with in-memory storage, on either shopper host.
//
// The operator authority is the customer one: human accounts and sessions in
// an AccountStore (`memoryStore`), tenant memberships in an AuthorityStore
// (`memoryAuthority`, src/auth/authority.ts:150 — the synthetic equivalent of
// the D1 store `authorityFor` falls back to, the one src/routes/content.test.ts:127
// and src/units/W23/B1.unit.test.ts:408 use), and stamp ownership from
// STAMP_OWNER_SUBJECTS (`stampOwner`, src/auth/authority.ts:28-35).
//
// It holds no expected value. It mounts, calls and reads back. The test file
// that imports it must register, before anything loads the Worker, the three
// module doubles src/demos/kit/root.worker.test.ts:24-26 registers (the Agents
// router and the browser binding are not on any path these units call).

import { SignJWT } from 'jose';

import { invalidatePublicationCache } from '@/config/publication';
import { invalidateCache } from '@/config/versionedStore';
import { invalidateLiftCache } from '@/content/service';
import { DecisionRing } from '@/durable-objects/DecisionRing';
import { LearnStats } from '@/durable-objects/LearnStats';
import { ShopperReflex } from '@/durable-objects/ShopperReflex';
import { memoryAuthority, type Membership } from '@/auth/authority';
import { memoryStore } from '@/auth/store';
import { RETENTION_CATEGORIES, type RetentionCategory, type RetentionPolicy } from '@/retention';
import type { Env } from '@/types/env';

import { UnitKV, UnitR2 } from '../_parity';

/** Synthetic, customer-neutral names. */
export const TENANT = 'acme';
/** A second provisioned tenant, on which the owner holds no membership. */
export const OTHER_TENANT = 'globex';
/** A tenant the stamp's registry does not name. */
export const UNPROVISIONED = 'initech';
/** The stamp owner's account id (STAMP_OWNER_SUBJECTS names it). */
export const OWNER = 'ops-w08-owner';
/** An operator with a membership on TENANT who is not a stamp owner. */
export const OPERATOR = 'ops-w08-operator';
export const HOSTS = ['session', 'do'] as const;
export type Host = (typeof HOSTS)[number];
export const SDK_KEY = 'w08-c1-synthetic-site-key';

const SECRET = 'w08-c1-synthetic-operator-signing-material-0123456789';
const ISSUER = 'w08-c1', AUDIENCE = 'w08-c1-console';
const DAY_MS = 86_400_000;
const ORIGIN = 'https://stamp.invalid';

/** The R2 double of the boundary suites (src/units/_parity.ts UnitR2), recording every call, with a fault switch. */
export class CountingR2 extends UnitR2 {
  /** Every call, in order: `get:<key>`, `put:<key>`, `delete:<key>`, `list:<prefix>`. */
  calls: string[] = [];
  /** A put whose key this returns true for throws, after recording the call: a storage outage at that write. */
  failPut: ((key: string) => boolean) | null = null;
  override async get(key: string) { this.calls.push(`get:${key}`); return super.get(key); }
  override async put(key: string, raw: string, options?: R2PutOptions) {
    this.calls.push(`put:${key}`);
    if (this.failPut?.(key)) throw new Error('w08 synthetic storage outage');
    return super.put(key, raw, options);
  }
  override async delete(keys: string | string[]) { this.calls.push(`delete:${String(keys)}`); return super.delete(keys); }
  override async list(options: { prefix?: string; cursor?: string; limit?: number } = {}) { this.calls.push(`list:${options.prefix ?? ''}`); return super.list(options); }
  /** The writes among the calls: every put and delete. */
  writes(): string[] { return this.calls.filter(call => call.startsWith('put:') || call.startsWith('delete:')); }
  /** Every stored object, sorted by key: what "byte-identical" is measured against. */
  bytes(): Array<[string, string]> { return [...this.objects.entries()].sort(([a], [b]) => a < b ? -1 : 1); }
}

export interface Answer { status: number; body: Record<string, unknown> }
type Worker = { fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> };

export interface Stamp {
  host: Host;
  env: Env;
  storage: CountingR2;
  accounts: ReturnType<typeof memoryStore>;
  authority: ReturnType<typeof memoryAuthority>;
  /** Human access tokens (type access, a live session) of the owner and of the operator. */
  tokens: { owner: string; operator: string };
  /** One request through the Worker's own `fetch`, its JSON answer. */
  call(method: string, path: string, opts?: { token?: string | null; tenant?: string; body?: unknown; rawBody?: string; headers?: Record<string, string> }): Promise<Answer>;
}

let worker: Promise<Worker> | undefined;
/** The real Worker default export, loaded once per file after the test file's module doubles are registered. */
const loadWorker = (): Promise<Worker> => (worker ??= import('@/index').then(m => m.default as unknown as Worker));

const policy: RetentionPolicy = { id: 'w08-c1-fixture-policy', revision: 1, durationMs: 365 * DAY_MS, basis: 'admitted', renewal: 'new-record-only' };
const categories = (tenants: string[]) => Object.fromEntries(tenants.map(t => [t,
  Object.fromEntries(RETENTION_CATEGORIES.map(c => [c, policy])) as Record<RetentionCategory, RetentionPolicy>]));

const accessToken = (sub: string, sid: string) => new SignJWT({ sub, type: 'access', sid })
  .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setIssuer(ISSUER).setAudience(AUDIENCE).setExpirationTime('2h')
  .sign(new TextEncoder().encode(SECRET));

/** A customer stamp whose two provisioned tenants have NO configuration publication set. */
export async function customerStamp(host: Host): Promise<Stamp> {
  invalidateCache(); invalidateLiftCache(); invalidatePublicationCache();
  const pending: Promise<unknown>[] = [];
  const storage = new CountingR2(), cache = new UnitKV(), sessions = new UnitKV();
  const accounts = memoryStore(), authority = memoryAuthority(accounts), at = Date.now();
  for (const [id, sid] of [[OWNER, 'w08-owner-session'], [OPERATOR, 'w08-operator-session']] as const) {
    await accounts.put({ id, email: `${id}@example.invalid`, name: `Synthetic ${id}`, roles: ['operator'], permissions: ['read'], updatedAt: at });
    await accounts.putSession({ jti: sid, accountId: id, tokenHash: 'w08-synthetic-unused', createdAt: at, expiresAt: at + 3_600_000 });
  }
  // Both hold a membership on TENANT; nobody holds one on OTHER_TENANT.
  for (const accountId of [OWNER, OPERATOR]) {
    const membership: Membership = { tenant: TENANT, accountId, role: 'operator', revision: `w08-${accountId}`, updatedAt: at, disabled: false, removed: false };
    authority.memberships.set(JSON.stringify([accountId, TENANT]), membership);
  }
  const env = {
    DEPLOYMENT_PROFILE: 'customer', AUTH_MODE: 'enforced', ENVIRONMENT: 'w08-c1-synthetic',
    TENANTS: JSON.stringify({ provisioned: [TENANT, OTHER_TENANT] }),
    STAMP_OWNER_SUBJECTS: JSON.stringify([OWNER]),
    JWT_SECRET: SECRET, JWT_ISSUER: ISSUER, JWT_AUDIENCE: AUDIENCE,
    ACCOUNTS: accounts, AUTHORITY: authority,
    SDK_KEYS: `${TENANT}:${SDK_KEY}`,
    IDENTITY_SECRETS: `${TENANT}:w08-c1-identity-proof-material`, IDENTITY_SALT: 'w08-c1-identity-salt-material-long-enough',
    RETENTION: JSON.stringify({ version: 1, tenants: categories([TENANT, OTHER_TENANT]) }),
    CACHE: cache, SESSIONS: sessions, STORAGE: storage, REFLEX_HOST: host,
    CONNECTOR_MODE: 'mock', DECISION_SOURCE: 'mock', LEDGER_RECOVERY_ENABLED: 'false',
    PERSONALIZATION_WEBSOCKET: { idFromName: (n: string) => n, get: () => ({ fetch: async () => Response.json({ connections: 0 }) }) },
    RATE_LIMITER: { idFromName: (n: string) => n, get: () => ({ fetch: async () => Response.json({ allowed: true, remaining: 99 }) }) },
    EVENT_QUEUE: { send: async () => undefined, sendBatch: async () => undefined },
    ANALYTICS: { writeDataPoint: () => undefined },
    DB: { prepare: () => ({ bind: () => ({ run: async () => ({ success: true }), first: async () => null, all: async () => ({ results: [] }) }) }) },
  } as unknown as Env;
  const namespaceFor = (make: (state: DurableObjectState, e: Env) => { fetch(r: Request): Promise<Response> }) => {
    const registry = new Map<string, { fetch(r: Request): Promise<Response> }>();
    return {
      idFromName: (n: string) => n,
      get: (name: string) => ({ fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
        let object = registry.get(name);
        if (!object) {
          const data = new Map<string, unknown>(); const alarms: number[] = [];
          const st = {
            get: async (k: string | string[]) => structuredClone(Array.isArray(k) ? new Map(k.map(v => [v, data.get(v)])) : data.get(k)),
            put: async (k: string | Record<string, unknown>, v?: unknown) => { if (typeof k === 'string') data.set(k, structuredClone(v)); else for (const [key, value] of Object.entries(k)) data.set(key, structuredClone(value)); },
            list: async (o?: { prefix?: string; startAfter?: string; limit?: number; reverse?: boolean }) => structuredClone(new Map([...data]
              .filter(([key]) => key.startsWith(o?.prefix ?? '') && (!o?.startAfter || key > o.startAfter))
              .sort(([a], [b]) => (o?.reverse ? -1 : 1) * a.localeCompare(b)).slice(0, o?.limit))),
            transaction: async (run: (tx: DurableObjectTransaction) => Promise<unknown>) => {
              const candidate = structuredClone(data); let deleteAlarm = false, nextAlarm: number | undefined;
              const tx = { list: async () => structuredClone(candidate), get: async (key: string) => structuredClone(candidate.get(key)),
                delete: async (keys: string | string[]) => { const l = typeof keys === 'string' ? [keys] : keys; for (const key of l) candidate.delete(key); return l.length; },
                put: async (values: string | Record<string, unknown>, value?: unknown) => { if (typeof values === 'string') candidate.set(values, structuredClone(value)); else for (const [key, v2] of Object.entries(values)) candidate.set(key, structuredClone(v2)); },
                deleteAlarm: async () => { deleteAlarm = true; }, setAlarm: async (a: number) => { nextAlarm = a; } } as unknown as DurableObjectTransaction;
              const result = await run(tx);
              data.clear(); for (const [k2, v2] of candidate) data.set(k2, v2);
              if (deleteAlarm) alarms.length = 0; if (nextAlarm !== undefined) alarms.push(nextAlarm);
              return result;
            },
            deleteAll: async () => data.clear(), delete: async (k: string) => data.delete(k),
            setAlarm: async (a: number) => { alarms.push(a); }, getAlarm: async () => alarms.at(-1) ?? null,
          };
          const state = { id: name, storage: st, getWebSockets: () => [], waitUntil: (p: Promise<unknown>) => pending.push(p) } as unknown as DurableObjectState;
          object = make(state, env); registry.set(name, object);
        }
        return object.fetch(new Request(input, init));
      } }),
    } as unknown as DurableObjectNamespace;
  };
  env.SHOPPER_REFLEX = namespaceFor((s, e) => new ShopperReflex(s, e));
  env.DECISION_RING = namespaceFor((s, e) => new DecisionRing(s, e));
  env.LEARN_STATS = namespaceFor((s, e) => new LearnStats(s, e));
  const tokens = { owner: await accessToken(OWNER, 'w08-owner-session'), operator: await accessToken(OPERATOR, 'w08-operator-session') };
  const app = await loadWorker();
  const ctx = { waitUntil: (p: Promise<unknown>) => { pending.push(p); }, passThroughOnException() { /* never */ }, props: {} } as unknown as ExecutionContext;
  const call: Stamp['call'] = async (method, path, opts = {}) => {
    const headers: Record<string, string> = { 'X-Tenant': opts.tenant ?? TENANT, ...(opts.headers ?? {}) };
    const token = opts.token === undefined ? tokens.owner : opts.token;
    if (token) headers.Authorization = `Bearer ${token}`;
    const body = opts.rawBody ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body));
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await app.fetch(new Request(ORIGIN + path, { method, headers, ...(body === undefined ? {} : { body }) }), env, ctx);
    const text = await response.text();
    let parsed: Record<string, unknown> = {};
    try { parsed = text ? JSON.parse(text) as Record<string, unknown> : {}; } catch { parsed = { unparsed: text.slice(0, 200) }; }
    while (pending.length) await Promise.all(pending.splice(0)).catch(() => undefined);
    invalidatePublicationCache();
    return { status: response.status, body: parsed };
  };
  return { host, env, storage, accounts, authority, tokens, call };
}

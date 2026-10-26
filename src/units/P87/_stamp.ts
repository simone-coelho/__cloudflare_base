// src/units/P87/_stamp.ts
// The in-process stamps of the P87 units (amendment 11, E11): the REAL Worker default export of `src/index.ts` (its
// customer boundary, its tenant middleware, every mounted route, the real Durable Object classes) over an in-memory D1
// that is node:sqlite applying the product migrations in their directory's order (`migrations/product/0010…`, and the
// 0014 the ticket writes once it exists), in the shape of src/routes/auth.test.ts:68–90 and
// src/units/W39/LEDGER.unit.test.ts:197–199. No AUTHORITY and no ACCOUNTS binding is given: the human accounts, the
// sessions, the memberships and the service credentials are the D1 rows `storeFor` and `authorityFor` read
// (src/auth/accounts.ts storeFor, src/auth/authority.ts authorityFor).
//
// Every store a request can reach records its calls, in order, on one log (`Stamp.calls`): each D1 statement, each R2,
// KV, Durable Object and queue call. A unit reads what a request did after its credential lookup (the D1 statement
// `SELECT * FROM operator_service_credentials WHERE id=?`, src/auth/authority.ts d1Authority.credential).
//
// It holds no expected value. It mounts, calls and reads back. The test file that imports it registers, before anything
// loads the Worker, the module doubles src/units/P91/LEDGER.unit.test.ts registers (the Agents router and the browser
// binding are on no path these units call). Synthetic, customer-neutral names; `.invalid` hosts only.

import { createRequire } from 'node:module';
import { readdirSync, readFileSync } from 'node:fs';
import { SignJWT } from 'jose';

import { hashPassword } from '@/auth/accounts';
import { initializePublicationSet, invalidatePublicationCache, type PublicationBaseline } from '@/config/publication';
import { invalidateCache, type DocumentKind } from '@/config/versionedStore';
import { CONTENT_KIND, DEFAULT_LEARN, DEFAULT_SLOTS, EMPTY_CATALOG, LEARN_KIND, SLOTS_KIND } from '@/content/kinds';
import { invalidateLiftCache } from '@/content/service';
import { OH_TENANT } from '@/demos/oh.config';
import { VANTAGE_TENANT } from '@/demos/vantage.config';
import { DecisionRing } from '@/durable-objects/DecisionRing';
import { LearnStats } from '@/durable-objects/LearnStats';
import { ShopperReflex } from '@/durable-objects/ShopperReflex';
import { EMPTY_PROPOSALS, PROPOSALS_KIND } from '@/learn/cycle';
import { EMPTY_PRIORS, PRIORS_KIND } from '@/learn/priors';
import { REFLEX_KIND, reflexScopeForTenant } from '@/reflex/configStore';
import { DEFAULT_REFLEX_CONFIG } from '@/reflex/core';
import { RETENTION_CATEGORIES, type RetentionCategory, type RetentionPolicy } from '@/retention';
import type { Env } from '@/types/env';

import { UnitKV, UnitR2 } from '../_parity';

/** The checkout this file lives in (never the working directory). */
export const ROOT = new URL('../../../', import.meta.url);
export const readTree = (relative: string): string => readFileSync(new URL(relative, ROOT), 'utf8');
export const readBytes = (relative: string): Buffer => readFileSync(new URL(relative, ROOT));

// ── node:sqlite, the D1 of these units ──────────────────────────────────────────────────────────────────────────────

export type Row = Record<string, unknown>;
export interface Sqlite {
  exec(sql: string): void; close(): void;
  prepare(sql: string): { run(...args: unknown[]): { changes: number | bigint }; get(...args: unknown[]): Row | undefined; all(...args: unknown[]): Row[] };
}
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as { DatabaseSync: new (path: string) => Sqlite };

/** The product migrations, in their directory's order: 0010–0013 today, and the 0014 this ticket adds once it exists. */
export const productMigrations = (): string[] => readdirSync(new URL('migrations/product/', ROOT)).filter(name => /^\d{4}_.+\.sql$/.test(name)).sort();
/** A database in memory with the named product migrations applied in order, foreign keys on. */
export function database(names: readonly string[] = productMigrations()): Sqlite {
  const db = new DatabaseSync(':memory:'); db.exec('PRAGMA foreign_keys=ON');
  for (const name of names) db.exec(readTree('migrations/product/' + name));
  return db;
}

/** The log every store of a stamp writes to, and the switches its doubles read. */
export interface Recorder { calls: string[]; failSql: ((sql: string) => boolean) | null; failPut: ((key: string) => boolean) | null }
const flat = (sql: string) => sql.replace(/\s+/g, ' ').trim();
/** The D1 statement of a service credential's lookup, as the log names it. */
export const CREDENTIAL_LOOKUP = 'd1 SELECT * FROM operator_service_credentials WHERE id=?';

/** A D1 binding over node:sqlite: prepare/bind/first/all/run, and an atomic batch (BEGIN … COMMIT, ROLLBACK on a throw). */
export function d1(sqlite: Sqlite, rec: Recorder) {
  class Statement {
    constructor(readonly sql: string, readonly args: unknown[] = []) {}
    bind(...args: unknown[]) { return new Statement(this.sql, args); }
    async first<T>(column?: string) {
      rec.calls.push('d1 ' + flat(this.sql));
      const row = sqlite.prepare(this.sql).get(...this.args) ?? null;
      return (column && row ? row[column] : row) as T | null;
    }
    async all<T>() { rec.calls.push('d1 ' + flat(this.sql)); return { success: true, results: sqlite.prepare(this.sql).all(...this.args) as T[], meta: { changes: 0 } }; }
    async run() { rec.calls.push('d1 ' + flat(this.sql)); return this.execute(); }
    execute() {
      if (rec.failSql?.(flat(this.sql))) throw new Error('p87 synthetic D1 failure');
      return { success: true, results: [], meta: { changes: Number(sqlite.prepare(this.sql).run(...this.args).changes) } };
    }
  }
  return {
    prepare: (sql: string) => new Statement(sql),
    async batch(statements: Statement[]) {
      for (const statement of statements) rec.calls.push('d1 ' + flat(statement.sql));
      sqlite.exec('BEGIN');
      try { const results = statements.map(statement => statement.execute()); sqlite.exec('COMMIT'); return results; }
      catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
    async exec(sql: string) { rec.calls.push('d1 exec'); sqlite.exec(sql); return { count: 1, duration: 0 }; },
  };
}

/** The R2 double of the boundary suites (src/units/_parity.ts UnitR2), recording every call, with a fault switch. */
class RecordingR2 extends UnitR2 {
  constructor(private readonly rec: Recorder) { super(); }
  override async get(key: string) { this.rec.calls.push('r2 get ' + key); return super.get(key); }
  override async head(key: string) { this.rec.calls.push('r2 head ' + key); return super.head(key); }
  override async put(key: string, raw: string, options?: R2PutOptions) {
    this.rec.calls.push('r2 put ' + key);
    if (this.rec.failPut?.(key)) throw new Error('p87 synthetic storage outage');
    return super.put(key, raw, options);
  }
  override async delete(keys: string | string[]) { this.rec.calls.push('r2 delete ' + String(keys)); return super.delete(keys); }
  override async list(options: { prefix?: string; cursor?: string; limit?: number } = {}) { this.rec.calls.push('r2 list ' + (options.prefix ?? '')); return super.list(options); }
}
/** The KV double of the boundary suites (src/units/_parity.ts UnitKV), recording every call. */
class RecordingKV extends UnitKV {
  constructor(private readonly rec: Recorder, private readonly name: string) { super(); }
  override async get(key: string, type?: string) { this.rec.calls.push(`kv ${this.name} get ${key}`); return super.get(key, type); }
  override async put(key: string, value: string) { this.rec.calls.push(`kv ${this.name} put ${key}`); return super.put(key, value); }
  override async delete(key: string) { this.rec.calls.push(`kv ${this.name} delete ${key}`); return super.delete(key); }
  override async list(o?: { prefix?: string; limit?: number; cursor?: string }) { this.rec.calls.push(`kv ${this.name} list ${o?.prefix ?? ''}`); return super.list(o); }
}

// ── The stamp ───────────────────────────────────────────────────────────────────────────────────────────────────────

export const HOSTS = ['session', 'do'] as const;
export type Host = (typeof HOSTS)[number];
export type Profile = 'customer' | 'demo';
/** The stamp's tenant, a second provisioned tenant, and (demo profile) the two demo doors' own tenants. */
export const TENANT = 'acme';
export const OTHER_TENANT = 'globex';
export const DEMO_DOOR_TENANTS = [VANTAGE_TENANT, OH_TENANT] as const;
/** The stamp owner (STAMP_OWNER_SUBJECTS) and a human operator who holds a membership and is not an owner. */
export const OWNER = 'p87-owner';
export const MEMBER = 'p87-member';
const PASSWORD = 'p87 synthetic owner pass phrase';
/** The machine subjects: the export job's catalogue credential, an operator one and an admin one. */
export const SUBJECTS = { catalog: 'p87-export-job', operator: 'p87-operator-job', admin: 'p87-admin-job' } as const;
const SECRET = 'p87-synthetic-operator-signing-material-0123456789';
const ISSUER = 'p87-issuer', AUDIENCE = 'p87-console';
const ORIGIN = 'https://stamp.invalid';
const DAY_MS = 86_400_000;

export interface Answer { status: number; body: Record<string, unknown>; calls: string[] }
export interface CallOptions { token?: string | null; tenant?: string; body?: unknown; rawBody?: string; headers?: Record<string, string> }
type Worker = { fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> };

export interface Stamp {
  profile: Profile; authMode: 'enforced' | 'open'; host: Host;
  env: Env; sqlite: Sqlite; storage: UnitR2; rec: Recorder;
  /** Every store call this stamp has seen, in order. */
  calls: string[];
  /** The stamp owner's human access token (customer profile; signed in through POST /auth/login). */
  ownerToken: string;
  /** Null when the tenant's first publication set exists; otherwise what refused it. */
  refused: string | null;
  /** One request through the Worker's own `fetch`: its JSON answer and the store calls it made. */
  call(method: string, path: string, opts?: CallOptions): Promise<Answer>;
}

let worker: Promise<Worker> | undefined;
/** The real Worker default export, loaded once per file after the test file's module doubles are registered. */
const loadWorker = (): Promise<Worker> => (worker ??= import('@/index').then(m => m.default as unknown as Worker));

const policy: RetentionPolicy = { id: 'p87-fixture-policy', revision: 1, durationMs: 365 * DAY_MS, basis: 'admitted', renewal: 'new-record-only' };
const categories = (tenants: readonly string[]) => Object.fromEntries(tenants.map(t => [t,
  Object.fromEntries(RETENTION_CATEGORIES.map(c => [c, policy])) as Record<RetentionCategory, RetentionPolicy>]));

/** A service token minted with the stamp's signing material (the demo profile's tool tokens: no D1 row behind it). */
export const mintService = (subject: string, roles: string[]) => new SignJWT({ sub: subject, type: 'service', roles })
  .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setIssuer(ISSUER).setAudience(AUDIENCE).setExpirationTime('2h')
  .sign(new TextEncoder().encode(SECRET));

/**
 * A stamp on one shopper host. The customer profile (`AUTH_MODE=enforced`): two human accounts in D1 (the stamp owner
 * and a member), both with an operator membership on TENANT; the owner signs in through `POST /auth/login` and creates
 * TENANT's first publication set through `POST /content/publication/initialize`. The demo profile (`AUTH_MODE` as
 * given): `operatorGrants` names the three machine subjects on TENANT and the two demo doors' tenants, whose first
 * publication sets are initialized as `scripts/init-local.mjs` writes them (the compiled defaults).
 */
export async function stamp(host: Host, profile: Profile = 'customer', authMode: 'enforced' | 'open' = 'enforced'): Promise<Stamp> {
  invalidateCache(); invalidateLiftCache(); invalidatePublicationCache();
  const rec: Recorder = { calls: [], failSql: null, failPut: null };
  const pending: Promise<unknown>[] = [];
  const sqlite = database(), storage = new RecordingR2(rec);
  const tenants = profile === 'customer' ? [TENANT, OTHER_TENANT] : [TENANT, ...DEMO_DOOR_TENANTS];
  const grants = Object.fromEntries(Object.values(SUBJECTS).map(subject => [subject, tenants]));
  const namespace = (binding: string, make?: (state: DurableObjectState, e: Env) => { fetch(r: Request): Promise<Response> }) => {
    const registry = new Map<string, { fetch(r: Request): Promise<Response> }>();
    return {
      idFromName: (n: string) => n,
      get: (name: string) => ({ fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init);
        rec.calls.push(`do ${binding} ${name} ${request.method} ${new URL(request.url).pathname}`);
        if (!make) return Response.json({ allowed: true, remaining: 9, resetTime: Math.floor(Date.now() / 60_000) * 60_000 + 60_000 });
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
        return object.fetch(request);
      } }),
    } as unknown as DurableObjectNamespace;
  };
  const env = {
    DEPLOYMENT_PROFILE: profile, AUTH_MODE: authMode, ENVIRONMENT: 'p87-synthetic',
    TENANTS: JSON.stringify(profile === 'customer' ? { provisioned: tenants } : { provisioned: tenants, operatorGrants: grants }),
    STAMP_OWNER_SUBJECTS: JSON.stringify([OWNER]),
    JWT_SECRET: SECRET, JWT_ISSUER: ISSUER, JWT_AUDIENCE: AUDIENCE,
    DB: d1(sqlite, rec),
    SDK_KEYS: tenants.map(t => `${t}:p87-synthetic-site-key-${t}`).join(','),
    IDENTITY_SECRETS: tenants.map(t => `${t}:p87-identity-proof-material-${t}`).join(','), IDENTITY_SALT: 'p87-identity-salt-material-long-enough',
    RETENTION: JSON.stringify({ version: 1, tenants: categories(tenants) }),
    CACHE: new RecordingKV(rec, 'CACHE'), SESSIONS: new RecordingKV(rec, 'SESSIONS'), STORAGE: storage, REFLEX_HOST: host,
    CONNECTOR_MODE: 'mock', DECISION_SOURCE: 'mock', LEDGER_RECOVERY_ENABLED: 'false',
    RATE_LIMITER: namespace('RATE_LIMITER'),
    PERSONALIZATION_WEBSOCKET: { idFromName: (n: string) => n, get: () => ({ fetch: async () => { rec.calls.push('do PERSONALIZATION_WEBSOCKET'); return Response.json({ connections: 0 }); } }) },
    EVENT_QUEUE: { send: async () => { rec.calls.push('queue send'); }, sendBatch: async () => { rec.calls.push('queue sendBatch'); } },
    ANALYTICS: { writeDataPoint: () => undefined },
  } as unknown as Env;
  env.SHOPPER_REFLEX = namespace('SHOPPER_REFLEX', (s, e) => new ShopperReflex(s, e));
  env.DECISION_RING = namespace('DECISION_RING', (s, e) => new DecisionRing(s, e));
  env.LEARN_STATS = namespace('LEARN_STATS', (s, e) => new LearnStats(s, e));

  const app = await loadWorker();
  const ctx = { waitUntil: (p: Promise<unknown>) => { pending.push(p); }, passThroughOnException() { /* never */ }, props: {} } as unknown as ExecutionContext;
  let ownerToken = '';
  const call: Stamp['call'] = async (method, path, opts = {}) => {
    const headers: Record<string, string> = { 'X-Tenant': opts.tenant ?? TENANT, ...(opts.headers ?? {}) };
    const token = opts.token === undefined ? ownerToken : opts.token;
    if (token) headers.Authorization = `Bearer ${token}`;
    const body = opts.rawBody ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body));
    if (body !== undefined && !Object.keys(headers).some(h => h.toLowerCase() === 'content-type')) headers['Content-Type'] = 'application/json';
    const from = rec.calls.length;
    const response = await app.fetch(new Request(ORIGIN + path, { method, headers, ...(body === undefined ? {} : { body }) }), env, ctx);
    const text = await response.text();
    let parsed: Record<string, unknown> = {};
    try { parsed = text ? JSON.parse(text) as Record<string, unknown> : {}; } catch { parsed = { unparsed: text.slice(0, 200) }; }
    while (pending.length) await Promise.all(pending.splice(0)).catch(() => undefined);
    invalidatePublicationCache();
    return { status: response.status, body: parsed, calls: rec.calls.slice(from) };
  };

  let refused: string | null = null;
  if (profile === 'customer') {
    const at = Date.now(), hash = await hashPassword(PASSWORD);
    for (const id of [OWNER, MEMBER]) {
      sqlite.prepare(`INSERT INTO operator_accounts(id,email,name,roles,permissions,password_hash,must_change_password,disabled,created_at,updated_at,auth_mode)
        VALUES (?,?,?,'["operator"]','["read"]',?,0,0,?,?,'password')`).run(id, `${id}@stamp.invalid`, `Synthetic ${id}`, hash, at, at);
      sqlite.prepare('INSERT INTO operator_memberships VALUES (?,?,?,?,?,?,?)').run(id, TENANT, 'operator', 0, 0, `p87-membership-${id}`, at);
    }
    const login = await call('POST', '/auth/login', { token: null, body: { email: `${OWNER}@stamp.invalid`, password: PASSWORD } });
    ownerToken = typeof login.body.accessToken === 'string' ? login.body.accessToken : '';
    if (!ownerToken) refused = `POST /auth/login answered ${login.status} ${JSON.stringify(login.body).slice(0, 200)}`;
    else {
      const initialized = await call('POST', '/content/publication/initialize', { body: {} });
      if (initialized.status !== 200) refused = `POST /content/publication/initialize answered ${initialized.status} ${JSON.stringify(initialized.body).slice(0, 200)}`;
    }
  } else {
    // scripts/init-local.mjs's members and compiled defaults (src/routes/content.ts compiledBaselines), for each tenant.
    for (const tenant of tenants) {
      const revision = (value: unknown) => ({ revision: 1, at: Date.now(), actor: 'p87-fixture', note: 'fixture', value });
      const members: Array<[DocumentKind<unknown>, string, unknown]> = [
        [CONTENT_KIND as DocumentKind<unknown>, tenant, EMPTY_CATALOG], [SLOTS_KIND as DocumentKind<unknown>, tenant, DEFAULT_SLOTS],
        [LEARN_KIND as DocumentKind<unknown>, tenant, DEFAULT_LEARN], [REFLEX_KIND as DocumentKind<unknown>, reflexScopeForTenant(tenant), DEFAULT_REFLEX_CONFIG],
        [PRIORS_KIND as DocumentKind<unknown>, tenant, EMPTY_PRIORS], [PROPOSALS_KIND as DocumentKind<unknown>, tenant, EMPTY_PROPOSALS]];
      try {
        await initializePublicationSet(env, members.map(([kind, scope, value]): PublicationBaseline => ({ kind, scope, revision: revision(value) })), '0:' + crypto.randomUUID());
      } catch (error) { refused = `initializePublicationSet(${tenant}): ${(error as Error).message}`; }
    }
    invalidatePublicationCache();
  }
  return { profile, authMode, host, env, sqlite, storage, rec, calls: rec.calls, get ownerToken() { return ownerToken; }, refused, call };
}

/** The calls a request made after its (last) service-credential lookup; null when it made no lookup. */
export function afterLookup(calls: readonly string[]): string[] | null {
  const at = calls.lastIndexOf(CREDENTIAL_LOOKUP);
  return at < 0 ? null : calls.slice(at + 1);
}

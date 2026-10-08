// src/units/W41/FIX3.unit.test.ts
// W41 fix round 3 — the defect the W41 delivery re-review of 7f5ceb9 found
// (_evidence/W41-delivery/fix2/reviewer/REPORT.md, V1; probe
// scratch/probe/REVIEW.fix2.twodevice.test.ts, logs/probe.log and
// logs/probe-revert-e8a8f4d.log) and the lead ruled
// (_evidence/step3/AMENDMENTS.md, "W41 fix round 3", restating the fix-2
// ruling without changing it):
//
//   "every sign-in arms exactly one restoration attempt, made at the first event
//    under personalization, and this holds for every live sign-in of a person at
//    once, not only the latest. The restoration state is therefore kept per live
//    recognized grant (or an equivalent that distinguishes concurrent sign-ins),
//    never as one latest record. A consent choice never re-arms; the fix-1
//    tracking-only re-arm stands. Kit 02 :521 and :539-545 and kit 03 :749 must
//    be true of the code as written."
//
// THE DEFECT: one person signed in on two browsers at once holds two live
// recognized grants (the identity link mints one per sign-in); with one record
// keyed on the sign-in of the latest attempt, every event that switches browser
// makes another ODP read. Measured by the reviewer on both hosts: reads 1 (A),
// 2 (B), then 3, 4, 5, 6 across four alternating events; 1, 2, 2, 2, 2, 2 with
// the fix-1 odpLoop.ts; one browser stays at 1.
//
// The fixture is FIX2.unit.test.ts's (150c206), copied verbatim from its imports
// through `onBothHosts` because a test file is never edited and never imported.
// Every leg drives the mounted app on BOTH shopper hosts; every ODP call is
// answered by the local recorded-contract fake; nothing reaches a network.
//
// REPRESENTATION: these units count ODP profile reads and read
// `affinity.restoration` only right after the attempt of the capability that
// reads it, or as "the outcome of one of her sign-ins' own attempts". They do not
// choose between the member answering the latest attempt recorded on her
// interests (kit 02 :553-557, kit 03 :745-748) and the member answering the
// reading sign-in's own attempt; the ruling leaves the stored shape open.
//
// UNIT NUMBERING continues criterion V1 across the W41 files: V1.01 (FIX1),
// V1.02 (FIX2), V1.03–V1.08 here. V1.08 (added at the specification review of
// 2723413c) pins kit 02 :543-545, the retry of an attempt that could not read:
// not again within its visit, once in each later visit of the same sign-in
// until it gets an answer, per sign-in when two are live.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import * as jose from 'jose';
import type { Env } from '@/types/env';
import realtimeRoutes from '@/routes/realtime';
import { decisionRoutes } from '@/routes/decisions';
import { identityRoutes } from '@/routes/identity';
import { tenantMiddleware } from '@/tenancy/middleware';
import { ShopperReflex } from '@/durable-objects/ShopperReflex';
import { SHOPPER_HEADER } from '@/identity/sessionCapability';
import { shopperObjectName } from '@/tenancy/objects';
import { DEFAULT_TENANT } from '@/tenancy/tenant';
import { storedConsent } from '@/content/consent';
import { DEFAULT_REFLEX_CONFIG } from '@/reflex/core';
import { REFLEX_KIND, reflexScopeForTenant, invalidateConfigCache } from '@/reflex/configStore';
import { CONTENT_KIND, LEARN_KIND, SLOTS_KIND } from '@/content/kinds';
import { initializePublicationSet, type PublicationBaseline } from '@/config/publication';
import { invalidateCache } from '@/config/versionedStore';
import { invalidateLiftCache } from '@/content/service';
import { configuredDestinations, connectorIdentity } from '@/connectors/config';
import { vuidFor } from '@/services/odpLoop';
import { shopperIdFor } from '@/identity/shopperId';
import { signAssertion } from '@/identity/assertion';
import { memoryStore } from '@/auth/store';
import type { RetentionCategory, RetentionPolicy } from '@/retention';

// ---------------------------------------------------------------------------
// Tenants, clock and the recorded contract.
// ---------------------------------------------------------------------------

const MERIDIAN = 'meridian';
const HARBOR = 'harbor';
/** The default tenant, owner of the legacy stamp-global ODP path (odpLoop.ts:52). */
const COACH = DEFAULT_TENANT;
const HOSTS = ['session', 'do'] as const;
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
/** A second-aligned instant, so an epoch-seconds observation time is exact. */
const T0 = 1_780_700_000_000;
/** The fixture's published memory horizon and saturation (the shipped defaults, published as data). */
const TAU_MS = 14 * DAY_MS;
const K = DEFAULT_REFLEX_CONFIG.K;

const ODP_MERIDIAN = 'https://odp-meridian.invalid';
const ODP_HARBOR = 'https://odp-harbor.invalid';
const ODP_LEGACY = 'https://odp-legacy.invalid';
const KEY_MERIDIAN = 'meridian-odp-private.synthetic';
const KEY_HARBOR = 'harbor-odp-private.synthetic';
const KEY_LEGACY = 'legacy-odp-public.synthetic';

/** Meridian's tenant-scoped mapping: the Wiring Spec §4 attributes, plus one dimension its registry lacks. */
const MERIDIAN_ODP = {
  apiHost: ODP_MERIDIAN, publicKeyRef: 'CONNECTOR_SECRET_ODP_MERIDIAN', identityNamespace: 'meridian-customer',
  actions: { page_view: { type: 'pageview', fields: {} }, product_view: { type: 'product', action: 'detail', fields: { product_id: 'productId', product_line: 'line' } } },
  audiences: { line_tabby_affinity: 'line_tabby_affinity' },
  profile: {
    line_affinity_tabby: { dimension: 'line', value: 'Tabby' },
    silhouette_affinity_tote: { dimension: 'silhouette', value: 'tote' },
    occasion_affinity_evening: { dimension: 'occasion', value: 'evening' },
    colour_affinity_red: { dimension: 'colour', value: 'red' },
    dominant_line: { dimension: 'line' },
    journey_stage: { journey: true },
  },
};
/** Harbor's own mapping: other attribute names, another namespace, another host and key. */
const HARBOR_ODP = {
  apiHost: ODP_HARBOR, publicKeyRef: 'CONNECTOR_SECRET_ODP_HARBOR', identityNamespace: 'harbor-members',
  actions: {}, audiences: {},
  profile: { hb_tabby_score: { dimension: 'line', value: 'Tabby' }, hb_evening_score: { dimension: 'occasion', value: 'evening' } },
};

/** The (dimension, value) pairs a numeric mapped attribute can restore, per tenant. */
const RESTORABLE: Record<string, Array<[string, string]>> = {
  [MERIDIAN]: [['line', 'Tabby'], ['silhouette', 'tote'], ['occasion', 'evening'], ['colour', 'red']],
  [HARBOR]: [['line', 'Tabby'], ['occasion', 'evening']],
  [COACH]: [['line', 'Tabby'], ['silhouette', 'tote'], ['occasion', 'evening']],
};

const seconds = (ms: number) => String(Math.floor(ms / 1000));

/** The Wiring Spec §8 / Reference Part 2 example profile, as ODP returns it: strings. */
const recordedProfile = (observedAt: number, overrides: Partial<Record<string, string | null>> = {}): OdpMode => ({
  kind: 'profile', lastModifiedAt: seconds(observedAt), audiences: ['line_tabby_affinity'],
  attributes: { line_affinity_tabby: '0.82', silhouette_affinity_tote: '0.45', occasion_affinity_evening: '0.67',
    colour_affinity_red: '0.9', dominant_line: 'Tabby', journey_stage: 'ready_to_buy', ...overrides },
});

/** Reading (a): the affinity a recorded at `observedAt`, decayed to `at` by the engine's own law. */
function restoredAffinity(recorded: number, observedAt: number, at: number, tauMs = TAU_MS): number {
  const r = K * recorded / (1 - recorded);
  const effective = r * Math.exp(-(at - observedAt) / tauMs);
  return effective / (effective + K);
}

// ---------------------------------------------------------------------------
// The recorded-contract ODP fake.
// ---------------------------------------------------------------------------

type OdpMode =
  | { kind: 'profile'; attributes: Record<string, string | null>; lastModifiedAt: string | null; audiences?: string[] }
  | { kind: 'missing' } | { kind: 'status'; status: number } | { kind: 'throw' } | { kind: 'hang' } | { kind: 'garbage' };

interface OdpRequest {
  origin: string; path: string; apiKey: string | null;
  kind: 'events' | 'profiles' | 'profile-read' | 'audiences' | 'invalid' | 'other';
  vuid: string | null; fields: string[]; at: number;
}

function balanced(text: string, start: number, open: string, close: string): { text: string; end: number } {
  let depth = 0, inString = false;
  for (let k = start; k < text.length; k++) {
    const ch = text[k];
    if (inString) { if (ch === '\\') k++; else if (ch === '"') inString = false; continue; }
    if (ch === '"') inString = true;
    else if (ch === open) depth++;
    else if (ch === close && --depth === 0) return { text: text.slice(start + 1, k), end: k + 1 };
  }
  return { text: text.slice(start + 1), end: text.length };
}

/** The top-level selection of `customer(vuid: …) { … }`, literal or `$variable` vuid. */
function parseCustomerQuery(query: string, variables: Record<string, unknown>) {
  const at = query.search(/\bcustomer\s*\(/);
  if (at < 0) return null;
  const args = balanced(query, query.indexOf('(', at), '(', ')');
  const literal = /vuid\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(args.text), variable = /vuid\s*:\s*\$(\w+)/.exec(args.text);
  const vuid = literal ? JSON.parse(`"${literal[1]}"`) as string : variable ? String(variables[variable[1]!] ?? '') : null;
  let i = args.end;
  while (i < query.length && /\s/.test(query[i]!)) i++;
  if (query[i] !== '{') return null;
  const selection = balanced(query, i, '{', '}').text;
  const fields: Array<{ name: string; subset: string[] }> = [];
  let j = 0;
  while (j < selection.length) {
    if (/[\s,]/.test(selection[j]!)) { j++; continue; }
    const name = /^[A-Za-z_][A-Za-z0-9_]*/.exec(selection.slice(j))?.[0];
    if (!name) return null;
    j += name.length;
    let argsText = '';
    while (j < selection.length && /\s/.test(selection[j]!)) j++;
    if (selection[j] === '(') { const a = balanced(selection, j, '(', ')'); argsText = a.text; j = a.end; }
    while (j < selection.length && /\s/.test(selection[j]!)) j++;
    if (selection[j] === '{') j = balanced(selection, j, '{', '}').end;
    const subset = [...(/subset\s*:\s*\[([^\]]*)\]/.exec(argsText)?.[1] ?? '').matchAll(/"((?:[^"\\]|\\.)*)"/g)].map(m => m[1]!);
    fields.push({ name, subset });
  }
  return { vuid, fields };
}

/**
 * ODP as the recorded contract describes it, per API host: `/v3/events` and
 * `/v3/profiles` accept (202) and an upsert updates the stored profile and its
 * `last_modified_at`; `/v3/graphql` answers `customer(vuid)` selections from the
 * stored profile with string values, answers only qualifying audiences, and
 * refuses a field the account's schema does not define, or a wrong key. Failure
 * modes apply to the GraphQL read only.
 */
class RecordedOdp {
  private hosts = new Map<string, { key: string; schema: Set<string>; subjects: Map<string, OdpMode> }>();
  requests: OdpRequest[] = [];

  host(origin: string, key: string, attributes: string[]): this {
    this.hosts.set(origin, { key, schema: new Set([...attributes, 'vuid', 'last_modified_at', 'audiences']), subjects: new Map() });
    return this;
  }
  subject(origin: string, vuid: string, mode: OdpMode): this { this.hosts.get(origin)!.subjects.set(vuid, mode); return this; }
  /** What the fake ODP holds for a vuid: the fixture's own view of the provider, never an engine answer. */
  stored(origin: string, vuid: string): OdpMode | undefined { return this.hosts.get(origin)?.subjects.get(vuid); }
  profileReads(origin?: string, vuid?: string): OdpRequest[] {
    return this.requests.filter(r => r.kind === 'profile-read' && (!origin || r.origin === origin) && (!vuid || r.vuid === vuid));
  }

  fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    const text = typeof init?.body === 'string' ? init.body : input instanceof Request ? await input.clone().text() : '';
    const host = this.hosts.get(url.origin);
    const record = (kind: OdpRequest['kind'], vuid: string | null = null, fields: string[] = []) =>
      this.requests.push({ origin: url.origin, path: url.pathname, apiKey: headers.get('x-api-key'), kind, vuid, fields, at: Date.now() });
    if (!host) { record('other'); return new Response(null, { status: 404 }); }
    if (url.pathname === '/v3/events') {
      const body = (() => { try { return JSON.parse(text) as { identifiers?: { vuid?: string } }; } catch { return {}; } })();
      record('events', body.identifiers?.vuid ?? null);
      return Response.json({}, { status: 202 });
    }
    if (url.pathname === '/v3/profiles') {
      const rows = (() => { try { return JSON.parse(text) as Array<{ attributes?: Record<string, unknown> }>; } catch { return []; } })();
      for (const row of rows) {
        const vuid = typeof row.attributes?.vuid === 'string' ? row.attributes.vuid : null;
        record('profiles', vuid, Object.keys(row.attributes ?? {}));
        if (!vuid) continue;
        const before = host.subjects.get(vuid);
        const attributes = before?.kind === 'profile' ? { ...before.attributes } : {} as Record<string, string | null>;
        for (const [name, value] of Object.entries(row.attributes ?? {})) if (name !== 'vuid') attributes[name] = value === null ? null : String(value);
        host.subjects.set(vuid, { kind: 'profile', attributes, lastModifiedAt: seconds(Date.now()),
          audiences: before?.kind === 'profile' ? before.audiences : [] });
      }
      return Response.json({}, { status: 202 });
    }
    if (url.pathname === '/v3/graphql') {
      let parsed: { query?: unknown; variables?: Record<string, unknown> };
      try { parsed = JSON.parse(text); } catch { record('invalid'); return Response.json({ errors: [{ message: 'Invalid JSON body' }] }, { status: 400 }); }
      const query = typeof parsed.query === 'string' ? parseCustomerQuery(parsed.query, parsed.variables ?? {}) : null;
      if (!query) { record('invalid'); return Response.json({ errors: [{ message: 'Unsupported query' }] }); }
      const names = query.fields.map(f => f.name);
      record(names.some(n => n !== 'audiences') ? 'profile-read' : 'audiences', query.vuid, names);
      const unknown = names.find(n => !host.schema.has(n));
      if (unknown) return Response.json({ errors: [{ message: `Validation error of type FieldUndefined: Field '${unknown}' in type 'customer' is undefined` }] });
      if (headers.get('x-api-key') !== host.key) return Response.json({ errors: [{ message: 'Unauthorized' }] }, { status: 401 });
      const mode: OdpMode = host.subjects.get(query.vuid ?? '') ?? { kind: 'missing' };
      if (mode.kind === 'status') return new Response('upstream unavailable', { status: mode.status });
      if (mode.kind === 'throw') throw new TypeError('fetch failed');
      if (mode.kind === 'hang') return new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener('abort',
        () => reject(new DOMException('The operation was aborted.', 'AbortError')), { once: true }));
      if (mode.kind === 'garbage') return new Response('<html>upstream proxy error</html>', { status: 200, headers: { 'Content-Type': 'text/html' } });
      if (mode.kind === 'missing') return Response.json({ data: { customer: null } });
      const customer: Record<string, unknown> = {};
      for (const field of query.fields) {
        if (field.name === 'audiences') customer.audiences = { edges: (mode.audiences ?? []).filter(n => field.subset.includes(n)).map(name => ({ node: { name, state: 'qualified' } })) };
        else if (field.name === 'vuid') customer.vuid = query.vuid;
        else if (field.name === 'last_modified_at') customer.last_modified_at = mode.lastModifiedAt;
        else customer[field.name] = mode.attributes[field.name] ?? null;
      }
      return Response.json({ data: { customer } });
    }
    record('other');
    return new Response(null, { status: 404 });
  };
}

// ---------------------------------------------------------------------------
// Host fixture — the real app, the real SessionManager path and the real
// ShopperReflex class (pattern of src/units/W16/C6.unit.test.ts:320-435).
// ---------------------------------------------------------------------------

const fixtureRetentionPolicy: RetentionPolicy = { id: 'w41-fixture-policy', revision: 1, durationMs: 365 * DAY_MS, basis: 'admitted', renewal: 'new-record-only' };
const fixtureCategories = (tenants: string[]) => Object.fromEntries(tenants.map(tenant => [tenant,
  Object.fromEntries(['profile', 'identity', 'ledger', 'online', 'hourly'].map(category => [category, fixtureRetentionPolicy])) as Record<RetentionCategory, RetentionPolicy>]));

class UnitKV {
  data = new Map<string, string>();
  async get(key: string, type?: string) { const v = this.data.get(key); return v === undefined ? null : type === 'stream' ? new Response(v).body : type === 'json' ? JSON.parse(v) : v; }
  async put(key: string, value: string) { this.data.set(key, value); }
  async delete(key: string) { this.data.delete(key); }
  async list(o?: { prefix?: string; limit?: number; cursor?: string }) {
    const keys = [...this.data.keys()].filter(k => k.startsWith(o?.prefix ?? '')).sort(), start = Number(o?.cursor ?? 0), end = start + (o?.limit ?? 1000);
    return { keys: keys.slice(start, end).map(name => ({ name })), list_complete: end >= keys.length, ...(end < keys.length ? { cursor: String(end) } : {}) };
  }
}

class UnitR2 {
  data = new Map<string, string>();
  versions = new Map<string, number>();
  metadata = new Map<string, Record<string, string>>();
  async get(key: string) {
    const raw = this.data.get(key); if (raw === undefined) return null;
    return { key, etag: 'v' + this.versions.get(key), size: new TextEncoder().encode(raw).length,
      customMetadata: this.metadata.get(key), body: new Response(raw).body, text: async () => raw, json: async () => JSON.parse(raw) as unknown };
  }
  async put(key: string, raw: string, options?: R2PutOptions) {
    const old = this.data.has(key) ? 'v' + this.versions.get(key) : null, condition = options?.onlyIf;
    const absent = condition instanceof Headers ? condition.get('If-None-Match') === '*' : condition?.etagDoesNotMatch === '*';
    const match = condition instanceof Headers ? condition.get('If-Match') : condition?.etagMatches;
    if (absent && old !== null || match != null && match !== old && match !== JSON.stringify(old)) return null;
    this.data.set(key, raw); this.versions.set(key, (this.versions.get(key) ?? 0) + 1); this.metadata.set(key, { ...options?.customMetadata });
    return { key, etag: 'v' + this.versions.get(key), size: new TextEncoder().encode(raw).length };
  }
  async delete(key: string) { this.data.delete(key); }
  async list(options: { prefix?: string; cursor?: string; limit?: number } = {}) {
    const names = [...this.data.keys()].filter(k => k.startsWith(options.prefix ?? '')).sort(), start = Number(options.cursor ?? 0), end = start + (options.limit ?? 1000);
    return { objects: names.slice(start, end).map(key => ({ key })), truncated: end < names.length, ...(end < names.length ? { cursor: String(end) } : {}) };
  }
}

const TENANTS = [COACH, MERIDIAN, HARBOR];
const OPERATOR = 'w41-operator';
const JWT_SECRET = 'w41-synthetic-signing-material-only';

/** Two live editorial pieces on one hero slot, so a decision can always be made. */
const documentChanges = (tenant: string): PublicationBaseline[] => [
  { kind: CONTENT_KIND, scope: tenant, revision: { revision: 1, at: 1, actor: 'w41-fixture', note: '', value: { pieces: [
    { id: 'rogue-editorial', customerContentId: 'cms-rogue', type: 'editorial', title: 'Rogue', tags: { line: ['Rogue'] }, slotTypes: ['hero'], lifecycle: { status: 'live' } },
    { id: 'tabby-editorial', customerContentId: 'cms-tabby', type: 'editorial', title: 'Tabby', tags: { line: ['Tabby'] }, slotTypes: ['hero'], lifecycle: { status: 'live' } },
  ] } } },
  { kind: SLOTS_KIND, scope: tenant, revision: { revision: 1, at: 1, actor: 'w41-fixture', note: '', value: { pages: { home: [{ slot: 'hero', take: 1, weights: { line: 1 } }] } } } },
  { kind: LEARN_KIND, scope: tenant, revision: { revision: 1, at: 1, actor: 'w41-fixture', note: '', value: {
    holdout: { share: 0, salt: 'w41', arms: ['default'] }, regional: { enabled: false, kBlend: 1, minEvents: 30 }, slots: {} } } },
];
const reflexDocument = { ...DEFAULT_REFLEX_CONFIG, version: 'w41-fixture', tauMs: TAU_MS, eventAttributes: 'event-when-unknown' as const };

function boundary(host: 'session' | 'do') {
  const cache = new UnitKV(), sessions = new UnitKV();
  const pending: Promise<unknown>[] = [];
  const objects = new Map<string, { shopper: ShopperReflex; data: Map<string, unknown>; state: DurableObjectState; alarms: number[]; sockets: WebSocket[] }>();
  const env = { DEPLOYMENT_PROFILE: 'demo', CACHE: cache, SESSIONS: sessions, CONNECTOR_MODE: 'mock', DECISION_SOURCE: 'mock', REFLEX_HOST: host,
    STORAGE: new UnitR2(),
    JWT_SECRET, JWT_ISSUER: 'i', JWT_AUDIENCE: 'a',
    IDENTITY_SECRETS: TENANTS.map(t => `${t}:backend-proof`).join(','),
    TENANTS: JSON.stringify({ provisioned: TENANTS, operatorGrants: { [OPERATOR]: TENANTS } }),
    TENANT_CONNECTORS: JSON.stringify({ version: 1, tenants: { [MERIDIAN]: { odp: MERIDIAN_ODP }, [HARBOR]: { odp: HARBOR_ODP } } }),
    CONNECTOR_SECRET_ODP_MERIDIAN: KEY_MERIDIAN, CONNECTOR_SECRET_ODP_HARBOR: KEY_HARBOR,
    // The legacy stamp-global ODP settings the default tenant's demo path reads (odpLoop.ts:65-67).
    ODP_API_HOST: ODP_LEGACY, ODP_PUBLIC_KEY: KEY_LEGACY,
    ACCOUNTS: memoryStore(),
    PERSONALIZATION_WEBSOCKET: { idFromName: (n: string) => n, get: () => ({ fetch: async () => Response.json({ connections: 0 }) }) },
    DB: { prepare: () => ({ bind: () => ({ run: async () => ({ success: true }) }) }) },
  } as unknown as Env;
  let automaticRetention = JSON.stringify({ version: 1, tenants: fixtureCategories(TENANTS) });
  env.RETENTION = automaticRetention;
  const configureRetention = async () => {
    if (env.RETENTION !== automaticRetention) return;
    try {
      const tenants = JSON.parse(env.TENANTS!).provisioned as string[], policies = fixtureCategories(tenants);
      for (const tenant of tenants) for (const destination of await configuredDestinations(env, tenant, () => { /* no destination diagnostics */ })) policies[tenant]![destination.category] = fixtureRetentionPolicy;
      automaticRetention = JSON.stringify({ version: 1, tenants: policies }); env.RETENTION = automaticRetention;
    } catch { /* a malformed registry still reaches the production refusal */ }
  };
  const construct = (name: string) => {
    const data = new Map<string, unknown>();
    const alarms: number[] = [], sockets: WebSocket[] = [];
    const storage = {
      get: async (k: string | string[]) => structuredClone(Array.isArray(k) ? new Map(k.map(v => [v, data.get(v)])) : data.get(k)),
      put: async (k: string | Record<string, unknown>, v?: unknown) => {
        if (typeof k === 'string') data.set(k, structuredClone(v)); else for (const [key, value] of Object.entries(k)) data.set(key, structuredClone(value));
      },
      list: async (options?: { prefix?: string; startAfter?: string; limit?: number; reverse?: boolean }) =>
        structuredClone(new Map([...data].filter(([key]) => key.startsWith(options?.prefix ?? '') && (!options?.startAfter || key > options.startAfter))
          .sort(([a], [b]) => (options?.reverse ? -1 : 1) * a.localeCompare(b)).slice(0, options?.limit))),
      transaction: async (run: (tx: DurableObjectTransaction) => Promise<unknown>) => {
        const candidate = structuredClone(data);
        let deleteAlarm = false, nextAlarm: number | undefined;
        const tx = { list: async () => structuredClone(candidate), get: async (key: string) => structuredClone(candidate.get(key)),
          delete: async (keys: string | string[]) => { const list = typeof keys === 'string' ? [keys] : keys; for (const key of list) candidate.delete(key); return list.length; },
          put: async (values: string | Record<string, unknown>, value?: unknown) => {
            if (typeof values === 'string') candidate.set(values, structuredClone(value));
            else for (const [key, item] of Object.entries(values)) candidate.set(key, structuredClone(item));
          },
          deleteAlarm: async () => { deleteAlarm = true; },
          setAlarm: async (at: number) => { nextAlarm = at; },
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
    const state = { id: name, storage, getWebSockets: () => sockets, waitUntil: (p: Promise<unknown>) => pending.push(p) } as unknown as DurableObjectState;
    return { data, state, alarms, sockets, shopper: new ShopperReflex(state, env) };
  };
  env.SHOPPER_REFLEX = {
    idFromName: (n: string) => n,
    get: (name: string) => ({ fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      let item = objects.get(name);
      if (!item) { item = construct(name); objects.set(name, item); }
      return item.shopper.fetch(new Request(input, init));
    } }),
  } as unknown as DurableObjectNamespace;
  const app = new Hono<{ Bindings: Env }>();
  app.use('*', tenantMiddleware());
  app.route('/realtime', realtimeRoutes); app.route('/v1', decisionRoutes); app.route('/v1', identityRoutes);
  const call = async (path: string, options: { capability?: string; body?: unknown; tenant: string; headers?: Record<string, string> }) => {
    await configureRetention();
    const request = new Request(`https://synthetic.invalid${path}`, {
      method: options.body === undefined ? 'GET' : 'POST',
      headers: { 'X-Tenant': options.tenant, ...(options.capability === undefined ? {} : { [SHOPPER_HEADER]: options.capability }),
        'Content-Type': 'application/json', ...options.headers },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
    return app.request(request, undefined, env, { waitUntil: (p: Promise<unknown>) => pending.push(p), passThroughOnException() { /* never */ }, props: {} });
  };
  const drain = async () => { while (pending.length) await Promise.all(pending.splice(0)); await new Promise(r => setTimeout(r, 10)); };
  return { env, objects, call, drain };
}

const claimsOf = (capability: string) => JSON.parse(
  new TextDecoder().decode(Uint8Array.from(atob(capability.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/')), ch => ch.charCodeAt(0))),
) as { tenant: string; subject: string; sessionId: string; grantId?: string; iat: number; exp: number };

interface Visitor { tenant: string; capability: string }
interface Person extends Visitor { accountId: string; shopperId: string; vuid: string; signedInUnder?: Consent }
type Consent = { tracking: boolean; personalization: boolean };
interface ReflexAnswer {
  status: number; text: string;
  affinity: { dims?: Record<string, Record<string, number>>; restoration?: Record<string, unknown> } | null | undefined;
}

/** The (dimension:value → affinity) entries a tenant's ODP mapping could have restored. */
function restoredInterests(tenant: string, answer: ReflexAnswer): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [dim, value] of RESTORABLE[tenant]!) {
    const a = answer.affinity?.dims?.[dim]?.[value];
    if (typeof a === 'number' && a > 0) out[`${dim}:${value}`] = a;
  }
  return out;
}

async function hostFixture(host: 'session' | 'do', odp: RecordedOdp) {
  invalidateCache(); invalidateLiftCache(); invalidateConfigCache();
  const f = boundary(host);
  for (const tenant of TENANTS) {
    const baseline = (kind: PublicationBaseline['kind'], value: unknown, scope = tenant): PublicationBaseline =>
      ({ kind, scope, revision: { revision: 1, at: 1, actor: 'w41-fixture', note: '', value } });
    const changes = documentChanges(tenant);
    await initializePublicationSet(f.env, [baseline(REFLEX_KIND, reflexDocument, reflexScopeForTenant(tenant)),
      ...[baseline(CONTENT_KIND, { pieces: [] }), baseline(SLOTS_KIND, { pages: {} }),
        baseline(LEARN_KIND, { holdout: { share: 0, salt: 'w41', arms: ['default'] } })]
        .map(base => changes.find(change => change.kind.name === base.kind.name && change.scope === base.scope) ?? base)],
      '0:' + crypto.randomUUID());
  }
  invalidateCache(); invalidateConfigCache();
  const operator = await new jose.SignJWT({ type: 'service', roles: ['admin'] })
    .setProtectedHeader({ alg: 'HS256' }).setSubject(OPERATOR).setIssuedAt().setIssuer('i').setAudience('a')
    .setExpirationTime('30m').sign(new TextEncoder().encode(JWT_SECRET));

  /** The vuid the tenant's own identity mapping gives a person (odpLoop.ts mappedIdentity → connectorIdentity). */
  const vuidOf = async (tenant: string, shopperId: string) => tenant === MERIDIAN ? connectorIdentity(MERIDIAN, MERIDIAN_ODP.identityNamespace, shopperId)
    : tenant === HARBOR ? connectorIdentity(HARBOR, HARBOR_ODP.identityNamespace, shopperId) : vuidFor({ visitorId: shopperId, sessionId: 'unused' });
  /** Who an account will be once it signs in, before it does, so ODP can already hold her. */
  const personFor = async (tenant: string, accountId: string) => {
    const shopperId = await shopperIdFor(f.env, tenant, accountId);
    return { shopperId, vuid: await vuidOf(tenant, shopperId) };
  };

  /** An explicit choice through the real preferences route, with the SDK's current-grant metadata. */
  const choose = async (tenant: string, capability: string, consent: { tracking: boolean; personalization: boolean }) => {
    const claims = claimsOf(capability);
    const current = f.objects.get(shopperObjectName(tenant, claims.subject))?.data.get('consent');
    const chosen = await f.call(`/realtime/session/${claims.sessionId}/preferences`, { tenant, capability, body: {
      trackingConsent: consent.tracking, personalizationEnabled: consent.personalization,
      choice: { id: crypto.randomUUID(), expectedRevision: storedConsent(current).instruction?.revision ?? null, grantId: claims.grantId, iat: claims.iat, exp: claims.exp },
    } });
    expect(chosen.status, `the fixture's own explicit choice: ${await chosen.clone().text()}`).toBe(200);
    await f.drain();
  };

  /** An anonymous visitor: the SDK's bootstrap, then her explicit choice (both switches unless named). */
  const browse = async (tenant: string, consent: Consent = { tracking: true, personalization: true }): Promise<Visitor> => {
    const established = await f.call(`/v1/${tenant}/identity/session`, { tenant, body: {} });
    const bootstrap = await established.clone().json() as { session?: { capability?: string } };
    expect(established.status, `the fixture's own anonymous bootstrap: ${await established.clone().text()}`).toBe(200);
    const anonymous = bootstrap.session!.capability!;
    await choose(tenant, anonymous, consent);
    return { tenant, capability: anonymous };
  };

  /**
   * Her signed link from that anonymous session: a recognized shopper, with the
   * choice the link answered. A later choice, when one is passed, is then made
   * by HER, under her own capability.
   */
  const signIn = async (visitor: Visitor, accountId: string, later?: Consent): Promise<Person> => {
    const { tenant, capability: anonymous } = visitor;
    const claims = claimsOf(anonymous);
    const exp = Math.floor(Date.now() / 1000) + 300;
    const assertion = await signAssertion('backend-proof', tenant, claims.subject, accountId, exp);
    const link = await f.call(`/v1/${tenant}/identity/link`, { tenant, capability: anonymous,
      body: { visitorId: claims.subject, accountId, source: 'login', exp, assertion } });
    const linked = await link.clone().json() as { shopperId?: string; session?: { capability?: string; consent?: Consent } };
    expect(link.status, `the fixture's own sign-in: ${await link.clone().text()}`).toBe(200);
    await f.drain();
    const person = { tenant, accountId, shopperId: linked.shopperId!, capability: linked.session!.capability!, vuid: await vuidOf(tenant, linked.shopperId!),
      signedInUnder: linked.session?.consent };
    if (later) await choose(tenant, person.capability, later);
    return person;
  };

  /** Anonymous bootstrap → explicit choice → signed link, nothing browsed before it (the gated `recognize`). */
  const recognize = async (tenant: string, accountId: string, consent = { tracking: true, personalization: true }): Promise<Person> =>
    signIn(await browse(tenant), accountId, !consent.tracking || !consent.personalization ? consent : undefined);

  /** One `POST /realtime/action` under a capability, anonymous or recognized. */
  const act = async (who: Visitor, event: { type: string; data: Record<string, unknown> }) => {
    const claims = claimsOf(who.capability);
    const response = await f.call('/realtime/action', { tenant: who.tenant, capability: who.capability, body: {
      ...event, source: 'sdk', userId: claims.subject, sessionId: claims.sessionId, timestamp: Date.now(), eventId: crypto.randomUUID(),
    } });
    const text = await response.clone().text();
    await f.drain();
    return { status: response.status, text };
  };

  /** The first event of her recognized session: a page view, as a returning visit starts. */
  const firstEvent = async (person: Person, event: { type: string; data: Record<string, unknown> } = { type: 'page_view', data: { path: '/' } }) =>
    act(person, event);

  /** `GET /realtime/reflex` under a capability, anonymous or recognized. */
  const readAs = async (who: Visitor): Promise<ReflexAnswer> => {
    const response = await f.call('/realtime/reflex', { tenant: who.tenant, capability: who.capability });
    const text = await response.clone().text();
    await f.drain();
    const body = (() => { try { return JSON.parse(text) as { affinity?: ReflexAnswer['affinity'] }; } catch { return {}; } })();
    return { status: response.status, text, affinity: body.affinity };
  };
  const reflex = async (person: Person): Promise<ReflexAnswer> => readAs(person);

  const decide = async (person: Person) => {
    const response = await f.call(`/v1/${person.tenant}/decisions/snapshot?page=home`, { tenant: person.tenant, capability: person.capability });
    const body = await response.clone().json().catch(() => ({})) as { decisions?: unknown[] };
    await f.drain();
    return { status: response.status, decisions: body.decisions?.length ?? 0 };
  };

  const erase = async (tenant: string, shopperId: string) => {
    const response = await f.call(`/v1/${tenant}/identity/erase`, { tenant, body: { shopperId }, headers: { Authorization: `Bearer ${operator}` } });
    const text = await response.clone().text();
    await f.drain();
    return { status: response.status, text };
  };

  return { f, odp, personFor, choose, browse, signIn, recognize, act, firstEvent, readAs, reflex, decide, erase };
}

/** The fixture's own event must be accepted; the answer is quoted when it is not. */
async function accepted(event: Promise<{ status: number; text: string }>, label: string) {
  const answer = await event;
  expect(answer.status, `${label}: the recognized shopper's event is accepted → ${answer.text}`).toBe(200);
}

/** Run one leg on both hosts with the ODP fake installed as the only network. */
async function onBothHosts(leg: (h: Awaited<ReturnType<typeof hostFixture>>, host: 'session' | 'do', clock: { mockReturnValue(at: number): unknown }) => Promise<void>) {
  const clock = vi.spyOn(Date, 'now').mockReturnValue(T0);
  try {
    for (const host of HOSTS) {
      clock.mockReturnValue(T0);
      const odp = new RecordedOdp()
        .host(ODP_MERIDIAN, KEY_MERIDIAN, Object.keys(MERIDIAN_ODP.profile))
        .host(ODP_HARBOR, KEY_HARBOR, Object.keys(HARBOR_ODP.profile))
        .host(ODP_LEGACY, KEY_LEGACY, ['line_affinity_tabby', 'silhouette_affinity_tote', 'occasion_affinity_evening', 'dominant_line', 'journey_stage']);
      vi.stubGlobal('fetch', odp.fetch);
      try { await leg(await hostFixture(host, odp), host, clock); } finally { vi.unstubAllGlobals(); }
    }
  } finally { clock.mockRestore(); }
}


// ---------------------------------------------------------------------------
// Fix round 3.
// ---------------------------------------------------------------------------

type Fixture = Awaited<ReturnType<typeof hostFixture>>;
type Clock = { mockReturnValue(at: number): unknown };
type ShopperEvent = { type: string; data: Record<string, unknown> };

const BOTH: Consent = { tracking: true, personalization: true };
const TRACKING_ONLY: Consent = { tracking: true, personalization: false };
const MINUTE_MS = 60_000;
/** ODP has held her profile (the Wiring Spec §8 values) since a week before her first sign-in. */
const OBS_A = T0 - 7 * DAY_MS;
/** Sign-in A, on her first browser. */
const SIGN_IN_A = T0;
/** Sign-in B, on her second browser an hour later, while A's grant is live (a shopper grant lasts 24 h). */
const SIGN_IN_B = T0 + HOUR_MS;
/** Another writer updates her ODP profile after B's sign-in, then B's first event. */
const OBS_B = SIGN_IN_B + 1 * MINUTE_MS, FIRST_B = SIGN_IN_B + 2 * MINUTE_MS;
/** Sign-in C, on a third browser under tracking only; her later choice, another writer's update, C's first event under personalization. */
const SIGN_IN_C = T0 + 2 * HOUR_MS;
const CHOICE_C = SIGN_IN_C + 4 * MINUTE_MS, OBS_C = SIGN_IN_C + 5 * MINUTE_MS, FIRST_C = SIGN_IN_C + 6 * MINUTE_MS;
/** Kit 03 "Event payloads, by type": a page view, and a product view of an unlisted product of a line ODP does not restore. */
const PAGE_VIEW: ShopperEvent = { type: 'page_view', data: { path: '/' } };
const ROGUE_VIEW: ShopperEvent = { type: 'product_view', data: { productId: 'cms-unlisted-rogue-satchel', line: 'Rogue' } };

/** Her profile reads so far, on her tenant's ODP. */
const readsOf = (h: Fixture, vuid: string) => h.odp.profileReads(ODP_MERIDIAN, vuid).length;

/** The interests the recorded Wiring Spec §8 values restore, observed at `observedAt`, as served at `at` (the gated reading (a)). */
const servedFrom = (observedAt: number, at: number) => ({
  'line:Tabby': expect.closeTo(restoredAffinity(0.82, observedAt, at), 3),
  'occasion:evening': expect.closeTo(restoredAffinity(0.67, observedAt, at), 3),
  'silhouette:tote': expect.closeTo(restoredAffinity(0.45, observedAt, at), 3),
});

/** ODP holds her profile, observed at OBS_A, before she ever signs in. */
async function heldByOdp(h: Fixture, account: string) {
  const her = await h.personFor(MERIDIAN, account);
  h.odp.subject(ODP_MERIDIAN, her.vuid, recordedProfile(OBS_A));
  return her;
}

/**
 * Another writer (the brand's CRM) upserts her mapped attributes — the Wiring
 * Spec §8 values — through the recorded contract (`POST /v3/profiles`), so her
 * profile's `last_modified_at` is `at`.
 */
async function otherWriter(h: Fixture, host: string, clock: Clock, vuid: string, at: number) {
  clock.mockReturnValue(at);
  const upsert = await h.odp.fetch(`${ODP_MERIDIAN}/v3/profiles`, { method: 'POST',
    headers: { 'x-api-key': KEY_MERIDIAN, 'Content-Type': 'application/json' },
    body: JSON.stringify([{ attributes: { vuid, line_affinity_tabby: 0.82, silhouette_affinity_tote: 0.45, occasion_affinity_evening: 0.67,
      dominant_line: 'Tabby', journey_stage: 'ready_to_buy' } }]) });
  expect(upsert.status, `${host}: fixture — the recorded contract accepts the upsert`).toBe(202);
  expect(h.odp.stored(ODP_MERIDIAN, vuid), `${host}: fixture — ODP now holds her profile observed at ${at}`)
    .toMatchObject({ kind: 'profile', lastModifiedAt: seconds(at), attributes: { line_affinity_tabby: '0.82' } });
}

/**
 * One person signed in on two browsers at once (the reviewer's sequence): sign-in
 * A (both switches) and its first event; an hour later, while A's grant is live,
 * sign-in B (both switches) from a second browser; another writer updates her
 * profile; B's first event. Each grant's read is taken right after its own
 * attempt.
 */
async function twoSignIns(h: Fixture, host: string, clock: Clock, account: string) {
  const her = await heldByOdp(h, account);
  clock.mockReturnValue(SIGN_IN_A);
  const a = await h.recognize(MERIDIAN, account);
  expect(a.shopperId, `${host}: fixture — sign-in A resolves her person`).toBe(her.shopperId);
  await accepted(h.firstEvent(a), `${host}, sign-in A`);
  const afterA = readsOf(h, her.vuid);
  const readA = await h.reflex(a);
  expect(readA.status, `${host}: ${readA.text}`).toBe(200);

  clock.mockReturnValue(SIGN_IN_B);
  const b = await h.recognize(MERIDIAN, account);
  expect(b.shopperId, `${host}: fixture — sign-in B resolves the same person`).toBe(her.shopperId);
  await otherWriter(h, host, clock, her.vuid, OBS_B);
  clock.mockReturnValue(FIRST_B);
  await accepted(h.firstEvent(b), `${host}, sign-in B`);
  const afterB = readsOf(h, her.vuid);
  const readB = await h.reflex(b);
  expect(readB.status, `${host}: ${readB.text}`).toBe(200);
  return { her, a, b, afterA, afterB, readA, readB };
}

/**
 * After the two concurrent sign-ins: sign-in C from a third browser under
 * tracking only (A and B stay live); events on C, A and B under tracking only;
 * her choice under C turns personalization on; another writer updates her
 * profile; C's first event under personalization.
 */
async function thirdSignInUnderTrackingOnly(h: Fixture, host: string, clock: Clock, account: string) {
  const two = await twoSignIns(h, host, clock, account);
  const { her, a, b } = two;
  clock.mockReturnValue(SIGN_IN_C);
  const visitor = await h.browse(MERIDIAN, TRACKING_ONLY);
  const c = await h.signIn(visitor, account);
  expect(c.shopperId, `${host}: fixture — sign-in C resolves the same person`).toBe(her.shopperId);
  expect(c.signedInUnder, `${host}: fixture — sign-in C was made under tracking only`).toMatchObject(TRACKING_ONLY);
  for (const [index, who] of [c, a, b].entries()) {
    clock.mockReturnValue(SIGN_IN_C + (index + 1) * MINUTE_MS);
    await accepted(h.act(who, index === 1 ? ROGUE_VIEW : PAGE_VIEW), `${host}, tracking only`);
  }
  const underTracking = readsOf(h, her.vuid);
  clock.mockReturnValue(CHOICE_C);
  await h.choose(MERIDIAN, c.capability, BOTH);
  const afterChoice = readsOf(h, her.vuid);
  await otherWriter(h, host, clock, her.vuid, OBS_C);
  clock.mockReturnValue(FIRST_C);
  await accepted(h.firstEvent(c), `${host}, sign-in C`);
  const afterC = readsOf(h, her.vuid);
  const readC = await h.reflex(c);
  expect(readC.status, `${host}: ${readC.text}`).toBe(200);
  return { ...two, c, underTracking, afterChoice, afterC, readC };
}

describe('unit:W41.V1.03', () => {
  it('host: two concurrent sign-ins — one person signed in on two browsers at once makes exactly one ODP read per sign-in: one at A\'s first event, one at B\'s, and four further events alternating A, B, A, B make no further read, the count staying at exactly 2, on both hosts', async () => {
    await onBothHosts(async (h, host, clock) => {
      const { her, a, b, afterA, afterB } = await twoSignIns(h, host, clock, 'coach-account-two-browsers');
      expect(afterA, `${host}: sign-in A's first event under personalization makes its one read`).toBe(1);
      expect(afterB, `${host}: sign-in B's first event makes its own one read — A's attempt does not answer for B`).toBe(2);

      const reads: number[] = [];
      for (const [index, who] of [a, b, a, b].entries()) {
        clock.mockReturnValue(FIRST_B + (index + 1) * MINUTE_MS);
        await accepted(h.act(who, index % 2 === 0 ? PAGE_VIEW : ROGUE_VIEW), `${host}, alternating`);
        reads.push(readsOf(h, her.vuid));
      }
      expect(reads, `${host}: one attempt per live sign-in — events alternating between her two live sign-ins make no further ODP read`).toEqual([2, 2, 2, 2]);
    });
  }, 180_000);

  it('host: not only the latest — sign-in A is made first but its first event comes after sign-in B\'s: B\'s first event makes its one read, A\'s first event still makes A\'s own one read, and four further events alternating B, A, B, A make no further read, the count staying at exactly 2, on both hosts', async () => {
    await onBothHosts(async (h, host, clock) => {
      const her = await heldByOdp(h, 'coach-account-two-browsers-earlier-first');
      clock.mockReturnValue(SIGN_IN_A);
      const a = await h.recognize(MERIDIAN, 'coach-account-two-browsers-earlier-first');
      clock.mockReturnValue(SIGN_IN_B);
      const b = await h.recognize(MERIDIAN, 'coach-account-two-browsers-earlier-first');
      expect([a.shopperId, b.shopperId], `${host}: fixture — both sign-ins resolve her person`).toEqual([her.shopperId, her.shopperId]);
      expect(readsOf(h, her.vuid), `${host}: neither sign-in reads her profile`).toBe(0);

      await otherWriter(h, host, clock, her.vuid, OBS_B);
      clock.mockReturnValue(FIRST_B);
      await accepted(h.firstEvent(b), `${host}, sign-in B`);
      expect(readsOf(h, her.vuid), `${host}: the later sign-in's first event makes its one read`).toBe(1);
      expect((await h.reflex(b)).affinity?.restoration, `${host}: B's own attempt is restored`).toMatchObject({ source: 'odp', status: 'restored', observedAt: OBS_B });

      const obsA = FIRST_B + 1 * MINUTE_MS, firstA = FIRST_B + 2 * MINUTE_MS;
      await otherWriter(h, host, clock, her.vuid, obsA);
      clock.mockReturnValue(firstA);
      await accepted(h.firstEvent(a), `${host}, sign-in A`);
      expect(readsOf(h, her.vuid), `${host}: the earlier sign-in, still live, gets its own one attempt at its first event under personalization — a later sign-in's attempt does not answer for it`).toBe(2);
      expect((await h.reflex(a)).affinity?.restoration, `${host}: A's own attempt is restored`).toMatchObject({ source: 'odp', status: 'restored', observedAt: obsA });

      const reads: number[] = [];
      for (const [index, who] of [b, a, b, a].entries()) {
        clock.mockReturnValue(firstA + (index + 1) * MINUTE_MS);
        await accepted(h.act(who, index % 2 === 0 ? PAGE_VIEW : ROGUE_VIEW), `${host}, alternating`);
        reads.push(readsOf(h, her.vuid));
      }
      expect(reads, `${host}: one attempt per live sign-in, not only the latest — events alternating between her two live sign-ins make no further ODP read`).toEqual([2, 2, 2, 2]);
    });
  }, 180_000);
});

describe('unit:W41.V1.04', () => {
  it('host: one sign-in, repeated events — a single signed-in browser makes exactly one ODP read across five events, at the first, and its attempt\'s answer stands, on both hosts', async () => {
    await onBothHosts(async (h, host, clock) => {
      const her = await heldByOdp(h, 'coach-account-one-browser');
      clock.mockReturnValue(SIGN_IN_A);
      const a = await h.recognize(MERIDIAN, 'coach-account-one-browser');
      expect(readsOf(h, her.vuid), `${host}: the sign-in does not read her profile`).toBe(0);

      const reads: number[] = [];
      for (const [index, event] of [PAGE_VIEW, ROGUE_VIEW, PAGE_VIEW, ROGUE_VIEW, PAGE_VIEW].entries()) {
        clock.mockReturnValue(SIGN_IN_A + index * MINUTE_MS);
        await accepted(h.act(a, event), `${host}, one browser`);
        reads.push(readsOf(h, her.vuid));
      }
      expect(reads, `${host}: one attempt per sign-in — one read at her first event, none at the four after it`).toEqual([1, 1, 1, 1, 1]);
      expect((await h.reflex(a)).affinity?.restoration, `${host}: the attempt's answer stands`).toMatchObject({ source: 'odp', status: 'restored', observedAt: OBS_A });
    });
  }, 180_000);
});

describe('unit:W41.V1.05', () => {
  it('host: both concurrent sign-ins are restored, each by its own attempt — A\'s answers restored with the observation ODP held at A\'s first event, B\'s with the later observation ODP held at B\'s, her served interests are the stronger, and after further events on both each grant\'s member is still restored and the outcome of one of those two attempts, on both hosts', async () => {
    await onBothHosts(async (h, host, clock) => {
      const { a, b, readA, readB } = await twoSignIns(h, host, clock, 'coach-account-two-browsers-restored');
      expect(readA.affinity?.restoration, `${host}: sign-in A's own attempt is restored, observed at OBS_A`).toMatchObject({ source: 'odp', status: 'restored', observedAt: OBS_A });
      expect(restoredInterests(MERIDIAN, readA), `${host}: A's restored interests are served`).toEqual(servedFrom(OBS_A, SIGN_IN_A));
      expect(readB.affinity?.restoration, `${host}: sign-in B is restored by its own attempt, observed at OBS_B — not answered by A's`).toMatchObject({ source: 'odp', status: 'restored', observedAt: OBS_B });
      expect(restoredInterests(MERIDIAN, readB), `${host}: B's restored interests are served, the stronger (the later observation)`).toEqual(servedFrom(OBS_B, FIRST_B));

      for (const [index, who] of [a, b].entries()) {
        clock.mockReturnValue(FIRST_B + (index + 1) * MINUTE_MS);
        await accepted(h.act(who, index === 0 ? PAGE_VIEW : ROGUE_VIEW), `${host}, further events`);
      }
      const at = FIRST_B + 3 * MINUTE_MS;
      clock.mockReturnValue(at);
      for (const [name, who] of [['A', a], ['B', b]] as const) {
        const read = await h.reflex(who);
        expect(read.affinity?.restoration, `${host}: ${name} is still restored`).toMatchObject({ source: 'odp', status: 'restored' });
        expect([OBS_A, OBS_B], `${host}: ${name}'s member is the outcome of one of her two sign-ins' own attempts — no attempt beyond them`)
          .toContain(read.affinity?.restoration?.observedAt);
        expect(restoredInterests(MERIDIAN, read), `${host}: ${name} — her restored interests stand`).toEqual(servedFrom(OBS_B, at));
      }
    });
  }, 180_000);
});

describe('unit:W41.V1.06', () => {
  it('host: the fix-1 re-arm alongside two live sign-ins — a third sign-in made under tracking only makes no read under tracking only, none at her choice, then exactly one at its first event under personalization, answers restored with the observation ODP held then, and its further events make no further read, on both hosts', async () => {
    await onBothHosts(async (h, host, clock) => {
      const account = 'coach-account-third-browser-tracking-only';
      const { her, c, afterA, afterB, underTracking, afterChoice, afterC, readC } = await thirdSignInUnderTrackingOnly(h, host, clock, account);
      expect([afterA, afterB], `${host}: control — the two concurrent sign-ins made one read each`).toEqual([1, 2]);
      expect(underTracking, `${host}: under tracking only no live sign-in reads her profile`).toBe(2);
      expect(afterChoice, `${host}: her choice reads nothing — a choice is not a sign-in`).toBe(2);
      expect(afterC - afterChoice, `${host}: sign-in C's first event under personalization makes its one read`).toBe(1);
      expect(readC.affinity?.restoration, `${host}: sign-in C is restored by its own attempt, observed at OBS_C`).toMatchObject({ source: 'odp', status: 'restored', observedAt: OBS_C });

      const reads: number[] = [];
      for (const [index, event] of [ROGUE_VIEW, PAGE_VIEW].entries()) {
        clock.mockReturnValue(FIRST_C + (index + 1) * MINUTE_MS);
        await accepted(h.act(c, event), `${host}, sign-in C`);
        reads.push(readsOf(h, her.vuid));
      }
      expect(reads, `${host}: further events of sign-in C make no further read`).toEqual([3, 3]);
    });
  }, 180_000);

  it('host: every live sign-in at once, beside the re-arm — after the third sign-in\'s one read, events alternating among her three live sign-ins, and her withdrawing personalization and granting it again, make no further ODP read, the count staying at exactly 3, and each sign-in\'s member is still restored and the outcome of one of her three sign-ins\' own attempts, on both hosts', async () => {
    await onBothHosts(async (h, host, clock) => {
      const account = 'coach-account-three-browsers';
      const { her, a, b, c, afterC } = await thirdSignInUnderTrackingOnly(h, host, clock, account);
      expect(afterC, `${host}: control — three sign-ins, one read each`).toBe(3);

      const steps: Array<[Person, Consent | null, ShopperEvent]> = [
        [a, null, PAGE_VIEW], [b, null, ROGUE_VIEW], [c, null, PAGE_VIEW], [a, null, ROGUE_VIEW], [b, null, PAGE_VIEW], [c, null, ROGUE_VIEW],
        [c, TRACKING_ONLY, PAGE_VIEW], [c, BOTH, PAGE_VIEW], [a, null, PAGE_VIEW], [b, null, ROGUE_VIEW],
      ];
      const reads: number[] = [];
      for (const [index, [who, choice, event]] of steps.entries()) {
        clock.mockReturnValue(FIRST_C + (index + 1) * MINUTE_MS);
        if (choice) await h.choose(MERIDIAN, who.capability, choice);
        await accepted(h.act(who, event), `${host}, step ${index + 1}`);
        reads.push(readsOf(h, her.vuid));
      }
      expect(reads, `${host}: one attempt per live sign-in for all three at once — no further read, and a choice re-arms none of them`)
        .toEqual([3, 3, 3, 3, 3, 3, 3, 3, 3, 3]);
      for (const [name, who] of [['A', a], ['B', b], ['C', c]] as const) {
        const read = await h.reflex(who);
        expect(read.affinity?.restoration, `${host}: ${name} is still restored`).toMatchObject({ source: 'odp', status: 'restored' });
        expect([OBS_A, OBS_B, OBS_C], `${host}: ${name}'s member is the outcome of one of her three sign-ins' own attempts — no attempt beyond them`)
          .toContain(read.affinity?.restoration?.observedAt);
      }
    });
  }, 180_000);
});

describe('unit:W41.V1.07', () => {
  const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
  /** A kit document with its line wrapping folded, so a sentence reads as one line. */
  const kit = (name: string) => readFileSync(join(ROOT, 'docs', 'kit', name), 'utf8').replace(/\s+/g, ' ');

  it('logic: the kit states one attempt per sign-in — kit 02 "Once per sign-in", "One attempt per sign-in … recorded against that sign-in", every later sign-in its own attempt, a consent choice not a sign-in, an `unavailable` attempt made again once in each later visit of the same sign-in until it gets an answer; kit 03 "Every sign-in makes one attempt" and `unavailable` "retried once in each later visit" — the promise the code is judged against', () => {
    const api = kit('02-api-reference.md'), payloads = kit('03-payload-schemas.md');
    expect(api, 'kit 02 :521').toContain('Once per sign-in, at a signed-in (recognized) shopper\'s first event under personalization after it, her ODP profile is read');
    expect(api, 'kit 02 :539').toContain('One attempt per sign-in, whatever her choice at the moment she signs in');
    expect(api, 'kit 02 :539-540').toContain('it is made at her first event under personalization after the sign-in and recorded against that sign-in');
    expect(api, 'kit 02 :541').toContain('Every later sign-in gets its own attempt, also one made under tracking only');
    expect(api, 'kit 02 :542-543').toContain('a consent choice is not a sign-in, so withdrawing personalization and granting it again within one sign-in makes no second attempt');
    expect(api, 'kit 02 :543-545').toContain('An attempt that could not read (`unavailable`) is made again once in each later visit of the same sign-in until it gets an answer; every other answer stands until her next sign-in');
    expect(payloads, 'kit 03 :749').toContain('Every sign-in makes one attempt, at her first event under personalization after it');
    expect(payloads, 'kit 03 :757').toContain('`unavailable` (a read failed; retried once in each later visit)');
  });
});

// ---------------------------------------------------------------------------
// The retry of an attempt that could not read (kit 02 :543-545; the fix-2
// ruling, AMENDMENTS :167-173: "'unavailable' retried once per later visit").
// ---------------------------------------------------------------------------

/** The idle gap that ends a visit: thirty minutes (the lead's instruction; src/services/visit.ts :24-30, the analytics convention). */
const VISIT_IDLE_MS = 30 * MINUTE_MS;
/** Past the visit gap with room to spare, so the next event begins a later visit. */
const NEXT_VISIT_MS = VISIT_IDLE_MS + 15 * MINUTE_MS;
/** Her tenant's ODP answers her profile read with an error status: the attempt could not read (`unavailable`). */
const UNAVAILABLE: OdpMode = { kind: 'status', status: 503 };
const COULD_NOT_READ = { source: 'odp', status: 'cold', reason: 'unavailable' };

/**
 * One event under `who` at `at` and her profile-read count after it. With
 * `down`, ODP's read outage is re-asserted first: the fake lets an accepted
 * profile upsert (the platform's own write-back) replace a failure mode, and
 * the fixture is an outage of her profile reads that lasts the whole visit.
 */
async function eventAt(h: Fixture, host: string, clock: Clock, vuid: string, who: Person, at: number, event: ShopperEvent, down = true) {
  if (down) h.odp.subject(ODP_MERIDIAN, vuid, UNAVAILABLE);
  clock.mockReturnValue(at);
  await accepted(h.act(who, event), `${host}, ${down ? 'ODP unavailable' : 'ODP answering'} at ${at}`);
  return readsOf(h, vuid);
}

describe('unit:W41.V1.08', () => {
  it('host: (a) an attempt that could not read is not made again within its visit — ODP answers her profile read 503; her first event after the sign-in makes one read and answers `unavailable`, and four further events of that visit make no further read, on both hosts', async () => {
    await onBothHosts(async (h, host, clock) => {
      const account = 'coach-account-odp-down-one-visit';
      const her = await h.personFor(MERIDIAN, account);
      h.odp.subject(ODP_MERIDIAN, her.vuid, UNAVAILABLE);
      clock.mockReturnValue(SIGN_IN_A);
      const a = await h.recognize(MERIDIAN, account);

      const reads: number[] = [];
      for (const [index, event] of [PAGE_VIEW, ROGUE_VIEW, PAGE_VIEW, ROGUE_VIEW, PAGE_VIEW].entries())
        reads.push(await eventAt(h, host, clock, her.vuid, a, SIGN_IN_A + index * MINUTE_MS, event));
      expect(reads, `${host}: within one visit the failed attempt is not made again — one read at her first event, none at the four after it`).toEqual([1, 1, 1, 1, 1]);
      expect((await h.reflex(a)).affinity?.restoration, `${host}: the attempt could not read`).toMatchObject(COULD_NOT_READ);
    });
  }, 180_000);

  it('host: (b) once in each later visit of the same sign-in until it gets an answer — with ODP still unavailable, each later visit makes exactly one more read, at its first event, and none after it in that visit; when ODP answers, that visit\'s one read restores her, and a visit after it makes no read, on both hosts', async () => {
    await onBothHosts(async (h, host, clock) => {
      const account = 'coach-account-odp-down-later-visits';
      const her = await h.personFor(MERIDIAN, account);
      h.odp.subject(ODP_MERIDIAN, her.vuid, UNAVAILABLE);
      clock.mockReturnValue(SIGN_IN_A);
      const a = await h.recognize(MERIDIAN, account);

      const visit = async (start: number, events: ShopperEvent[], down = true) => {
        const reads: number[] = [];
        for (const [index, event] of events.entries()) reads.push(await eventAt(h, host, clock, her.vuid, a, start + index * MINUTE_MS, event, down));
        return reads;
      };
      const v1 = SIGN_IN_A, v2 = v1 + 2 * MINUTE_MS + NEXT_VISIT_MS, v3 = v2 + 2 * MINUTE_MS + NEXT_VISIT_MS;
      expect(await visit(v1, [PAGE_VIEW, ROGUE_VIEW, PAGE_VIEW]), `${host}: visit 1 — her one attempt, unavailable, not made again in it`).toEqual([1, 1, 1]);
      expect(await visit(v2, [PAGE_VIEW, ROGUE_VIEW, PAGE_VIEW]), `${host}: visit 2 of the same sign-in — exactly one more read, at its first event, none after it`).toEqual([2, 2, 2]);
      expect(await visit(v3, [ROGUE_VIEW, PAGE_VIEW, PAGE_VIEW]), `${host}: visit 3 of the same sign-in — exactly one more read, at its first event, none after it`).toEqual([3, 3, 3]);
      expect((await h.reflex(a)).affinity?.restoration, `${host}: still could not read`).toMatchObject(COULD_NOT_READ);

      const v4 = v3 + 2 * MINUTE_MS + NEXT_VISIT_MS, v5 = v4 + 2 * MINUTE_MS + NEXT_VISIT_MS;
      h.odp.subject(ODP_MERIDIAN, her.vuid, recordedProfile(OBS_A));
      expect(await visit(v4, [PAGE_VIEW, ROGUE_VIEW, PAGE_VIEW], false), `${host}: visit 4, ODP answering — exactly one more read, at its first event, none after it`).toEqual([4, 4, 4]);
      expect((await h.reflex(a)).affinity?.restoration, `${host}: that read got an answer and restored her`).toMatchObject({ source: 'odp', status: 'restored', observedAt: OBS_A });
      expect(await visit(v5, [PAGE_VIEW, ROGUE_VIEW], false), `${host}: visit 5 — an answer stands until her next sign-in: no read`).toEqual([4, 4]);
    });
  }, 180_000);

  it('host: (c) two live sign-ins, each retried on its own — with ODP unavailable throughout, each sign-in makes its one attempt in visit 1 and none again there, and in each later visit each sign-in makes exactly one more read at its own first event of that visit and none after it, whichever browser comes first; neither sign-in\'s attempt or retry answers for the other\'s, on both hosts', async () => {
    await onBothHosts(async (h, host, clock) => {
      const account = 'coach-account-odp-down-two-browsers';
      const her = await h.personFor(MERIDIAN, account);
      h.odp.subject(ODP_MERIDIAN, her.vuid, UNAVAILABLE);
      clock.mockReturnValue(SIGN_IN_A);
      const a = await h.recognize(MERIDIAN, account);
      clock.mockReturnValue(SIGN_IN_A + MINUTE_MS);
      const b = await h.recognize(MERIDIAN, account);
      expect([a.shopperId, b.shopperId], `${host}: fixture — both sign-ins resolve her person`).toEqual([her.shopperId, her.shopperId]);
      expect(readsOf(h, her.vuid), `${host}: neither sign-in reads her profile`).toBe(0);

      const visit = async (start: number, steps: Array<[Person, ShopperEvent]>) => {
        const reads: number[] = [];
        for (const [index, [who, event]] of steps.entries()) reads.push(await eventAt(h, host, clock, her.vuid, who, start + index * MINUTE_MS, event));
        return reads;
      };
      const v1 = SIGN_IN_A + 2 * MINUTE_MS, v2 = v1 + 4 * MINUTE_MS + NEXT_VISIT_MS, v3 = v2 + 6 * MINUTE_MS + NEXT_VISIT_MS;
      expect(await visit(v1, [[a, PAGE_VIEW], [b, PAGE_VIEW], [a, ROGUE_VIEW], [b, ROGUE_VIEW]]),
        `${host}: visit 1 — A's one attempt, B's one attempt, both unavailable, neither made again in it`).toEqual([1, 2, 2, 2]);
      expect(await visit(v2, [[a, PAGE_VIEW], [a, ROGUE_VIEW], [b, PAGE_VIEW], [b, ROGUE_VIEW], [a, PAGE_VIEW], [b, PAGE_VIEW]]),
        `${host}: visit 2 — A retried once at its first event, B retried once at its own, none after`).toEqual([3, 3, 4, 4, 4, 4]);
      expect(await visit(v3, [[b, PAGE_VIEW], [b, ROGUE_VIEW], [a, PAGE_VIEW], [a, ROGUE_VIEW], [b, PAGE_VIEW], [a, PAGE_VIEW]]),
        `${host}: visit 3 — B retried once at its first event, A retried once at its own, none after`).toEqual([5, 5, 6, 6, 6, 6]);
      for (const [name, who] of [['A', a], ['B', b]] as const)
        expect((await h.reflex(who)).affinity?.restoration, `${host}: ${name} still could not read`).toMatchObject(COULD_NOT_READ);
    });
  }, 180_000);
});

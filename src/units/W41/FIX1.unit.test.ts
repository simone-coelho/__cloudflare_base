// src/units/W41/FIX1.unit.test.ts
// W41 fix round 1 — the two defects the W41 delivery review of 90e458b found
// (_evidence/W41-delivery/reviewer/REPORT.md) and the lead ruled
// (_evidence/step3/AMENDMENTS.md, the W41 entries of 2026-10-01):
//
//   V3 — "fail closed. After an erasure, nothing ODP may have observed before it
//        is restored. Where the contract cannot prove a value newer than the
//        erasure, restoration is refused with a named reason." The recorded
//        contract carries ONE profile-wide `last_modified_at`
//        (docs/ODP-Recent-Events-Reference.md Part 2, :36-53), which any writer
//        moves with a partial `POST /v3/profiles` upsert; our erasure does not
//        erase ODP (src/identity/erase.ts, the `limits` list: "ODP: the profile
//        under the derived vuid is erased through ODP's own API by the brand's
//        operator"). So a profile timestamp later than her erasure proves nothing
//        about any value it carries.
//   V1 — "a signed-in shopper whose session began with an anonymous
//        interest-building event is never restored ... RULING: a V1 defect,
//        because she is a recognized returning shopper, to be fixed now."
//
// The fixture below is the gated one of src/units/W41/LEDGER.unit.test.ts
// (5e57c08, reviewed PASS), copied because a test file is never edited and a
// test file is never imported; only the anonymous-first helpers (`browse`,
// `act`, `readAs`, `signIn`) are added, and `recognize`, `firstEvent` and
// `reflex` are those helpers composed exactly as before. Every leg drives the
// mounted app on BOTH shopper hosts; every ODP call is answered by the local
// recorded-contract fake; nothing reaches a network.
//
// RULED MEMBERS AND READINGS (reported to the lead):
//   (f) The named reason of an erasure refusal is `erased`: the reason the W41
//       artifact already publishes for it (kit 02 "Interest restoration from
//       ODP" and kit 03 "The interest hydrate's restoration provenance" at
//       90e458b). Its meaning widens from "observed at or before her erasure" to
//       "after her erasure, nothing the profile-wide timestamp can prove newer".
//   (g) Anonymous-first: her ODP interests are present at their restored values
//       (the gated reading (a), decayed from the observation) beside the
//       interests she built before signing in, which keep their value. The
//       fixture keeps the two sets on different (dimension, value) pairs, so no
//       merge rule is implied for a pair both hold.
//   (h) The consent and erasure rules hold on the anonymous-first path as on the
//       plain one: the read is made at her first signed-in event under the choice
//       current then (the gated reading (e)), never because of her sign-in.

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
interface Person extends Visitor { accountId: string; shopperId: string; vuid: string }
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

  /** An anonymous visitor: the SDK's bootstrap, then her explicit choice of both switches. */
  const browse = async (tenant: string): Promise<Visitor> => {
    const established = await f.call(`/v1/${tenant}/identity/session`, { tenant, body: {} });
    const bootstrap = await established.clone().json() as { session?: { capability?: string } };
    expect(established.status, `the fixture's own anonymous bootstrap: ${await established.clone().text()}`).toBe(200);
    const anonymous = bootstrap.session!.capability!;
    await choose(tenant, anonymous, { tracking: true, personalization: true });
    return { tenant, capability: anonymous };
  };

  /**
   * Her signed link from that anonymous session: a recognized shopper. A
   * different current choice is then made by HER, under her own capability.
   */
  const signIn = async (visitor: Visitor, accountId: string, consent = { tracking: true, personalization: true }): Promise<Person> => {
    const { tenant, capability: anonymous } = visitor;
    const claims = claimsOf(anonymous);
    const exp = Math.floor(Date.now() / 1000) + 300;
    const assertion = await signAssertion('backend-proof', tenant, claims.subject, accountId, exp);
    const link = await f.call(`/v1/${tenant}/identity/link`, { tenant, capability: anonymous,
      body: { visitorId: claims.subject, accountId, source: 'login', exp, assertion } });
    const linked = await link.clone().json() as { shopperId?: string; session?: { capability?: string } };
    expect(link.status, `the fixture's own sign-in: ${await link.clone().text()}`).toBe(200);
    await f.drain();
    const person = { tenant, accountId, shopperId: linked.shopperId!, capability: linked.session!.capability!, vuid: await vuidOf(tenant, linked.shopperId!) };
    if (!consent.tracking || !consent.personalization) await choose(tenant, person.capability, consent);
    return person;
  };

  /** Anonymous bootstrap → explicit choice → signed link, nothing browsed before it (the gated `recognize`). */
  const recognize = async (tenant: string, accountId: string, consent = { tracking: true, personalization: true }): Promise<Person> =>
    signIn(await browse(tenant), accountId, consent);

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

  return { f, odp, personFor, browse, signIn, recognize, act, firstEvent, readAs, reflex, decide, erase };
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
// Fix round 1.
// ---------------------------------------------------------------------------

type Fixture = Awaited<ReturnType<typeof hostFixture>>;
type Clock = { mockReturnValue(at: number): unknown };

/**
 * An anonymous interest-building event in the kit's own shape (docs/kit/03-payload-schemas.md
 * "Event payloads, by type": `product_view` carries `productId` plus the registry's attributes):
 * a product the catalogue does not hold, of a line ODP's mapping does not restore.
 */
const ROGUE_VIEW = { type: 'product_view', data: { productId: 'cms-unlisted-rogue-satchel', line: 'Rogue' } };

/** Every (dimension:value → affinity) a read reports. */
function interestsOf(answer: ReflexAnswer): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [dim, values] of Object.entries(answer.affinity?.dims ?? {})) {
    for (const [value, a] of Object.entries(values)) if (typeof a === 'number' && a > 0) out[`${dim}:${value}`] = a;
  }
  return out;
}

/** The value a read reports for one `dimension:value` pair. */
const valueOf = (answer: ReflexAnswer, pair: string) => {
  const [dim, value] = pair.split(':') as [string, string];
  return answer.affinity?.dims?.[dim]?.[value];
};

/**
 * Another writer — the brand's CRM — upserts ONE unrelated attribute onto her
 * profile through the recorded contract (`POST /v3/profiles`, an attributes row
 * keyed by vuid), which moves the profile-wide `last_modified_at`.
 */
async function unrelatedWrite(h: Fixture, vuid: string) {
  const answer = await h.odp.fetch(`${ODP_MERIDIAN}/v3/profiles`, { method: 'POST',
    headers: { 'x-api-key': KEY_MERIDIAN, 'Content-Type': 'application/json' },
    body: JSON.stringify([{ attributes: { vuid, email_opt_in: 'true' } }]) });
  expect(answer.status, 'fixture: the recorded contract accepts the partial upsert').toBe(202);
}

/**
 * The review's sequence up to her erasure: ODP holds her from T0−7d; she is
 * restored at T0−2d (and the platform writes her live affinity back); the
 * operator erases her at T0−1d. Our erasure leaves her ODP profile in place.
 */
async function restoredThenErased(h: Fixture, host: string, clock: Clock, account: string) {
  const her = await h.personFor(MERIDIAN, account);
  h.odp.subject(ODP_MERIDIAN, her.vuid, recordedProfile(T0 - 7 * DAY_MS));

  clock.mockReturnValue(T0 - 2 * DAY_MS);
  const before = await h.recognize(MERIDIAN, account);
  await accepted(h.firstEvent(before), host);
  const restored = await h.reflex(before);
  expect(restored.affinity?.restoration, `${host}: control — before her erasure she is restored`).toMatchObject({ source: 'odp', status: 'restored' });
  expect(Object.keys(restoredInterests(MERIDIAN, restored)).sort(), `${host}: control`).toEqual(['line:Tabby', 'occasion:evening', 'silhouette:tote']);

  clock.mockReturnValue(T0 - 1 * DAY_MS);
  const erased = await h.erase(MERIDIAN, her.shopperId);
  expect([200, 202], `${host}: the operator's erasure → ${erased.status} ${erased.text}`).toContain(erased.status);
  const kept = h.odp.stored(ODP_MERIDIAN, her.vuid);
  expect(kept?.kind === 'profile' && Number(kept.attributes.line_affinity_tabby) > 0,
    `${host}: fixture — her ODP profile still holds the interests written before her erasure → ${JSON.stringify(kept)}`).toBe(true);
  return her;
}

describe('unit:W41.V3.01', () => {
  it('host: never after erasure, fail closed — she was restored, then erased; another writer then upserts one unrelated attribute onto her ODP profile, moving its profile-wide last_modified_at past her erasure; when she signs in again none of the interests ODP held before her erasure comes back and the answer names the refusal `erased`, while a person never erased whose profile took the same write is still read and restored, on both hosts', async () => {
    await onBothHosts(async (h, host, clock) => {
      const her = await restoredThenErased(h, host, clock, 'coach-account-erased-then-touched');
      const other = await h.personFor(MERIDIAN, 'coach-account-touched-never-erased');
      h.odp.subject(ODP_MERIDIAN, other.vuid, recordedProfile(T0 - 7 * DAY_MS));

      clock.mockReturnValue(T0 - 12 * HOUR_MS);
      await unrelatedWrite(h, her.vuid);
      await unrelatedWrite(h, other.vuid);
      expect(h.odp.stored(ODP_MERIDIAN, her.vuid), `${host}: fixture — her pre-erasure values now sit under a profile timestamp later than her erasure`)
        .toMatchObject({ kind: 'profile', lastModifiedAt: seconds(T0 - 12 * HOUR_MS), attributes: { email_opt_in: 'true' } });

      clock.mockReturnValue(T0);
      const again = await h.recognize(MERIDIAN, 'coach-account-erased-then-touched');
      expect(again.shopperId, `${host}: she signs in as the person who was erased`).toBe(her.shopperId);
      await accepted(h.firstEvent(again), host);
      const read = await h.reflex(again);
      expect(read.status, `${host}: ${read.text}`).toBe(200);
      expect(restoredInterests(MERIDIAN, read), `${host}: nothing ODP observed before her erasure comes back, although the profile's last_modified_at is later than the erasure`).toEqual({});
      expect(read.affinity?.restoration, `${host}: the refusal is named`).toMatchObject({ source: 'odp', status: 'cold', reason: 'erased' });

      // Boundary: the refusal is HER erasure's, not the unrelated write's and not the tenant's.
      const control = await h.recognize(MERIDIAN, 'coach-account-touched-never-erased');
      await accepted(h.firstEvent(control), host);
      expect(h.odp.profileReads(ODP_MERIDIAN, other.vuid).length, `${host}: boundary — a person never erased is still read`).toBeGreaterThan(0);
      const controlRead = await h.reflex(control);
      expect(controlRead.affinity?.restoration, `${host}: boundary — the same unrelated write refuses nothing for a person never erased`).toMatchObject({ source: 'odp', status: 'restored' });
      expect(Object.keys(restoredInterests(MERIDIAN, controlRead)).sort(), host).toEqual(['line:Tabby', 'occasion:evening', 'silhouette:tote']);
    });
  }, 180_000);
});

describe('unit:W41.V3.02', () => {
  it('host: never after erasure, no other write — she was restored, then erased, and nothing has written her ODP profile since; when she signs in again nothing of it comes back and the answer names the refusal `erased`, on both hosts', async () => {
    await onBothHosts(async (h, host, clock) => {
      const her = await restoredThenErased(h, host, clock, 'coach-account-erased-untouched');
      const kept = h.odp.stored(ODP_MERIDIAN, her.vuid);
      expect(kept?.kind === 'profile' && Number(kept.lastModifiedAt) * 1000 <= T0 - DAY_MS,
        `${host}: fixture — her profile was last written before her erasure → ${JSON.stringify(kept)}`).toBe(true);

      clock.mockReturnValue(T0);
      const again = await h.recognize(MERIDIAN, 'coach-account-erased-untouched');
      expect(again.shopperId, `${host}: she signs in as the person who was erased`).toBe(her.shopperId);
      await accepted(h.firstEvent(again), host);
      const read = await h.reflex(again);
      expect(read.status, `${host}: ${read.text}`).toBe(200);
      expect(restoredInterests(MERIDIAN, read), `${host}: nothing ODP observed before her erasure comes back`).toEqual({});
      expect(read.affinity?.restoration, `${host}: the refusal is named`).toMatchObject({ source: 'odp', status: 'cold', reason: 'erased' });
    });
  }, 120_000);
});

describe('unit:W41.V3.03', () => {
  it('host: never after erasure on the anonymous-first path — erased, her ODP profile touched by another writer since, she browses anonymously and builds an interest before signing in: none of the pre-erasure interests comes back, the refusal is named `erased`, and the interest she built before signing in keeps its value, on both hosts', async () => {
    await onBothHosts(async (h, host, clock) => {
      const account = 'coach-account-erased-anonymous-first';
      const her = await restoredThenErased(h, host, clock, account);
      clock.mockReturnValue(T0 - 12 * HOUR_MS);
      await unrelatedWrite(h, her.vuid);

      clock.mockReturnValue(T0);
      const visitor = await h.browse(MERIDIAN);
      await accepted(h.act(visitor, ROGUE_VIEW), `${host}, anonymous`);
      const anonymous = await h.readAs(visitor), built = interestsOf(anonymous);
      expect(built['line:Rogue'], `${host}: fixture — her anonymous event built an interest`).toBeGreaterThan(0);
      expect(restoredInterests(MERIDIAN, anonymous), `${host}: fixture — on no pair ODP's mapping restores`).toEqual({});

      const again = await h.signIn(visitor, account);
      expect(again.shopperId, `${host}: she signs in as the person who was erased`).toBe(her.shopperId);
      await accepted(h.firstEvent(again), host);
      const read = await h.reflex(again);
      expect(read.status, `${host}: ${read.text}`).toBe(200);
      expect(restoredInterests(MERIDIAN, read), `${host}: nothing ODP observed before her erasure comes back`).toEqual({});
      expect(read.affinity?.restoration, `${host}: the refusal is named on the anonymous-first path too`).toMatchObject({ source: 'odp', status: 'cold', reason: 'erased' });
      for (const [pair, a] of Object.entries(built)) expect(valueOf(read, pair), `${host}: ${pair}, built before she signed in, is kept`).toBeCloseTo(a, 3);
    });
  }, 180_000);
});

describe('unit:W41.V1.01', () => {
  it('host: a recognized returning shopper whose session began with an anonymous interest-building event — an unlisted product of a line ODP does not restore — has her profile read and her ODP interests restored at her first signed-in event, at their values decayed from the observation, beside the interest she built before signing in, which keeps its value, on both hosts', async () => {
    await onBothHosts(async (h, host) => {
      const observedAt = T0 - 3 * DAY_MS;
      const account = 'coach-account-anonymous-first';
      const her = await h.personFor(MERIDIAN, account);
      h.odp.subject(ODP_MERIDIAN, her.vuid, recordedProfile(observedAt));

      const visitor = await h.browse(MERIDIAN);
      await accepted(h.act(visitor, ROGUE_VIEW), `${host}, anonymous`);
      const anonymous = await h.readAs(visitor), built = interestsOf(anonymous);
      expect(built['line:Rogue'], `${host}: fixture — her anonymous event built an interest`).toBeGreaterThan(0);
      expect(restoredInterests(MERIDIAN, anonymous), `${host}: fixture — on no pair ODP's mapping restores`).toEqual({});

      const person = await h.signIn(visitor, account);
      expect(person.shopperId, `${host}: sign-in resolves the person ODP knows`).toBe(her.shopperId);
      await accepted(h.firstEvent(person), host);

      const reads = h.odp.profileReads(ODP_MERIDIAN, her.vuid);
      expect(reads.length, `${host}: her profile is read from her tenant's ODP at her first signed-in event`).toBeGreaterThan(0);
      expect(reads.map(r => r.apiKey), `${host}: with her tenant's key`).toEqual(reads.map(() => KEY_MERIDIAN));
      const read = await h.reflex(person);
      expect(read.status, `${host}: ${read.text}`).toBe(200);
      expect(read.affinity?.restoration, `${host}: the restored interests name their source and observation time`)
        .toMatchObject({ source: 'odp', status: 'restored', observedAt });
      expect(restoredInterests(MERIDIAN, read), `${host}: every mapped numeric attribute of a configured dimension is restored, decayed from the observation`).toEqual({
        'line:Tabby': expect.closeTo(restoredAffinity(0.82, observedAt, T0), 3),
        'occasion:evening': expect.closeTo(restoredAffinity(0.67, observedAt, T0), 3),
        'silhouette:tote': expect.closeTo(restoredAffinity(0.45, observedAt, T0), 3),
      });
      for (const [pair, a] of Object.entries(built)) expect(valueOf(read, pair), `${host}: ${pair}, built before she signed in, is kept`).toBeCloseTo(a, 3);
    });
  }, 120_000);

  it('host: boundary — on the anonymous-first path the profile is still read only under the choice current at her first signed-in event: she builds an interest, signs in, turns personalization off, and her profile is never read and nothing is restored, on both hosts', async () => {
    await onBothHosts(async (h, host) => {
      const account = 'coach-account-anonymous-first-tracking-only';
      const her = await h.personFor(MERIDIAN, account);
      h.odp.subject(ODP_MERIDIAN, her.vuid, recordedProfile(T0 - 3 * DAY_MS));

      const visitor = await h.browse(MERIDIAN);
      await accepted(h.act(visitor, ROGUE_VIEW), `${host}, anonymous`);
      expect(interestsOf(await h.readAs(visitor))['line:Rogue'], `${host}: fixture — her anonymous event built an interest`).toBeGreaterThan(0);

      const person = await h.signIn(visitor, account, { tracking: true, personalization: false });
      expect(person.shopperId, `${host}: sign-in resolves the person ODP knows`).toBe(her.shopperId);
      await accepted(h.firstEvent(person), host);
      expect(h.odp.requests.filter(r => r.kind === 'events' && r.vuid === her.vuid).length,
        `${host}: control — tracking consent still forwards her events to the tenant's ODP`).toBeGreaterThan(0);
      expect(h.odp.profileReads(undefined, her.vuid), `${host}: without personalization consent at her first signed-in event her profile is never read`).toEqual([]);
      expect(restoredInterests(MERIDIAN, await h.reflex(person)), `${host}: and nothing of it is restored`).toEqual({});
    });
  }, 120_000);
});

// src/units/W41/LEDGER.unit.test.ts
// W41 — ODP interest-vector restoration. One describe per LOCAL criterion of the
// frozen work order (docs/remediation/delivery-control/program.json, ticket W41).
// Every leg drives the mounted app on BOTH shopper hosts (REFLEX_HOST session and
// do), the way src/units/W16/C6.unit.test.ts and src/routes/realtime.sdkContract
// .test.ts do. Every ODP call is answered by the local recorded-contract fake
// below; nothing reaches a network.
//
// WITNESSES:
//   · document 35 §5 row W41 (:448): "Implement scoped, consent/erasure-safe
//     interest-vector restoration with provenance, mapping and decay semantics;
//     prove cold/missing-state and returning recognized flows against the actual
//     ODP contract. Audience-label restore alone is not vector recovery." F13
//     (:119), F31 (:227), N16 (:278).
//   · docs/architecture/35-verification-reports/sweep-customer-facing-promises.md
//     P03 (:178-228): the promise ("If edge state is ever absent, it is re-seeded
//     from ODP on the first event of the session") and what exists (five hard-coded
//     audience NAMES, "Nothing reconstructs ReflexState").
//   · HANDOFF-2026-09-18 §6 W41 row (:337), §7 closing paragraph (:358), §8 D10
//     (:375: the real contract is LIVE2; locally a recorded fixture).
//   · THE RECORDED ODP CONTRACT: docs/ODP-Recent-Events-Reference.md Part 2
//     (:39-58) — attributes are upserted with `POST /v3/profiles` and read back BY
//     VUID with `query { customer(vuid: "<32hex>") { vuid <attributes…>
//     last_modified_at } }`, "returns the values (as strings)"; Part 1 (:14-35) —
//     the `audiences(subset: …)` read answers only qualifying segments; the traps
//     section (:60-66) — `x-api-key`. docs/Coach-ODP-Wiring-Spec.md §4 (:65-69) and
//     §8 (:101-112) — the attribute names and example values (0.82 / 0.45 / 0.67,
//     `dominant_line`, `journey_stage`). The `last_modified_at` format is the ODP
//     customer export's (docs/architecture/coach_synthetic_schema.json:2143-2160:
//     int64 epoch seconds, sampled as strings).
//   · What the platform writes into those attributes: `upsertOdpProfile`
//     (src/services/odpLoop.ts:423-440) sends, per the tenant's `odp.profile`
//     mapping (src/connectors/config.ts:39-44), the SNAPSHOT affinity
//     a = R/(R+K) of each mapped value (src/reflex/core.ts:47-60, :290-298,
//     :665-678). The same mapping is the tenant-scoped mapping read back here.
//   · Decay: R_eff(T) = R·exp(−(T − t)/τ) with t the last touch
//     (src/reflex/core.ts:10-15, :290-294; src/reflex/identityMerge.ts:14-17).
//   · "Recognized": a signed-in shopper — "a recognized shopper is signed in"
//     (src/identity/sessionCapability.ts ContinuityDescriptor.subject), reached
//     through the real `POST /v1/:tenant/identity/link`.
//   · Erasure is a point in time: rows "at or before the erasure" never come back
//     (src/ledger/erasure.ts:6-18).
//
// THE DOCUMENTS DO DEFINE the profile read-back (Part 2 above); they do not define
// how ODP answers for a vuid it has never seen. This fixture answers
// `{"data":{"customer":null}}` for that case (standard GraphQL for an absent
// nullable object); LIVE2 confirms or corrects it.
//
// READINGS AND RULED MEMBERS (reported to the lead):
//   (a) The restored value of a mapped attribute is the affinity the attribute
//       records AT its observation time, so the engine holds R = K·a/(1−a) touched
//       at `last_modified_at` and reports a(T) = R_eff(T)/(R_eff(T)+K). This is the
//       only reading under which what the platform wrote comes back as written.
//   (b) Ruled member: `GET /realtime/reflex` answers, on both hosts,
//       `affinity.restoration` =
//         { source: 'odp', status: 'restored', observedAt: <epoch ms> }   or
//         { source: 'odp', status: 'cold', reason: 'cold' | 'missing' | 'malformed' }
//       (extra members allowed). The three reasons are the criterion's own words.
//   (c) Only numeric `{dimension, value}` attributes are vectors. `{dimension}`
//       (a dominant-value label), `{journey}` and ODP audience names are labels
//       (V6). A mapped dimension the tenant's registry does not define is ignored,
//       as apply() ignores a touch on it (src/reflex/core.ts:589).
//   (d) Restoration is a personalization read (the purpose `fetchOdpAudiences`
//       and `upsertOdpProfile` already require, odpLoop.ts:423, :524); tracking
//       consent alone permits event forwarding, never the profile read.
//   (e) When: "If edge state is ever absent, it is re-seeded from ODP on the first
//       event of the session" (docs/content-personalization-design-tapestry.html
//       :534, quoted by P03). The profile read happens at her first event, under
//       the choice current then — not at sign-in. The V3 consent leg relies on
//       this: she signs in with both switches on and turns personalization off
//       before her first event. (Signing in from a tracking-only anonymous choice
//       answers 401 "Shopper session unavailable" on the first event at 4fbdddc on
//       the session host, so the fixture does not use that arrangement.)

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

interface Person { tenant: string; accountId: string; shopperId: string; capability: string; vuid: string }
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

  /**
   * Anonymous bootstrap → explicit choice → signed link: a recognized shopper.
   * A different current choice is then made by HER, under her own capability.
   */
  const recognize = async (tenant: string, accountId: string, consent = { tracking: true, personalization: true }): Promise<Person> => {
    const established = await f.call(`/v1/${tenant}/identity/session`, { tenant, body: {} });
    const bootstrap = await established.clone().json() as { session?: { capability?: string } };
    expect(established.status, `the fixture's own anonymous bootstrap: ${await established.clone().text()}`).toBe(200);
    const anonymous = bootstrap.session!.capability!;
    const claims = claimsOf(anonymous);
    await choose(tenant, anonymous, { tracking: true, personalization: true });
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

  /** The first event of her recognized session: a page view, as a returning visit starts. */
  const firstEvent = async (person: Person, event: { type: string; data: Record<string, unknown> } = { type: 'page_view', data: { path: '/' } }) => {
    const claims = claimsOf(person.capability);
    const response = await f.call('/realtime/action', { tenant: person.tenant, capability: person.capability, body: {
      ...event, source: 'sdk', userId: claims.subject, sessionId: claims.sessionId, timestamp: Date.now(), eventId: crypto.randomUUID(),
    } });
    const text = await response.clone().text();
    await f.drain();
    return { status: response.status, text };
  };

  const reflex = async (person: Person): Promise<ReflexAnswer> => {
    const response = await f.call('/realtime/reflex', { tenant: person.tenant, capability: person.capability });
    const text = await response.clone().text();
    await f.drain();
    const body = (() => { try { return JSON.parse(text) as { affinity?: ReflexAnswer['affinity'] }; } catch { return {}; } })();
    return { status: response.status, text, affinity: body.affinity };
  };

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

  return { f, odp, personFor, recognize, firstEvent, reflex, decide, erase };
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

describe('unit:W41.V1', () => {
  it('host: a recognized returning shopper with an ODP profile has her interests restored into affinity through the tenant\'s own attribute mapping, with provenance naming ODP and the observation time, on both hosts', async () => {
    await onBothHosts(async (h, host) => {
      const observedAt = T0 - 7 * DAY_MS;
      const her = await h.personFor(MERIDIAN, 'coach-account-returning');
      h.odp.subject(ODP_MERIDIAN, her.vuid, recordedProfile(observedAt));

      const person = await h.recognize(MERIDIAN, 'coach-account-returning');
      expect(person.shopperId, `${host}: sign-in resolves the person ODP knows`).toBe(her.shopperId);
      const first = await h.firstEvent(person);
      expect(first.status, `${host}: ${first.text}`).toBe(200);

      const read = await h.reflex(person);
      expect(read.status, `${host}: ${read.text}`).toBe(200);
      expect(read.affinity?.restoration, `${host}: the restored interests name their source and observation time`)
        .toMatchObject({ source: 'odp', status: 'restored', observedAt });
      const restored = restoredInterests(MERIDIAN, read);
      expect(Object.keys(restored).sort(), `${host}: every mapped numeric attribute of a configured dimension is restored, and only those`)
        .toEqual(['line:Tabby', 'occasion:evening', 'silhouette:tote']);
      expect(restored['line:Tabby'], `${host}: line_affinity_tabby → line/Tabby`).toBeCloseTo(restoredAffinity(0.82, observedAt, T0), 3);
      expect(restored['silhouette:tote'], `${host}: silhouette_affinity_tote → silhouette/tote`).toBeCloseTo(restoredAffinity(0.45, observedAt, T0), 3);
      expect(restored['occasion:evening'], `${host}: occasion_affinity_evening → occasion/evening`).toBeCloseTo(restoredAffinity(0.67, observedAt, T0), 3);

      const reads = h.odp.profileReads(ODP_MERIDIAN);
      expect(reads.length, `${host}: the profile was read back from the tenant's ODP`).toBeGreaterThan(0);
      expect(reads.map(r => ({ vuid: r.vuid, apiKey: r.apiKey })), `${host}: read by the person's tenant-mapped vuid with the tenant's key`)
        .toEqual(reads.map(() => ({ vuid: her.vuid, apiKey: KEY_MERIDIAN })));
    });
  }, 120_000);
});

describe('unit:W41.V2', () => {
  it('host: restored interests decay from the ODP observation time, not the restoration time — two observation ages restored at one instant differ by the engine\'s decay, and a later read keeps decaying from the observation, on both hosts', async () => {
    await onBothHosts(async (h, host, clock) => {
      const recent = T0 - 1 * DAY_MS, old = T0 - 13 * DAY_MS;
      const a = await h.personFor(MERIDIAN, 'coach-account-yesterday');
      const b = await h.personFor(MERIDIAN, 'coach-account-two-weeks');
      h.odp.subject(ODP_MERIDIAN, a.vuid, recordedProfile(recent));
      h.odp.subject(ODP_MERIDIAN, b.vuid, recordedProfile(old));

      const yesterday = await h.recognize(MERIDIAN, 'coach-account-yesterday');
      const twoWeeks = await h.recognize(MERIDIAN, 'coach-account-two-weeks');
      for (const person of [yesterday, twoWeeks]) await accepted(h.firstEvent(person), host);

      const readA = await h.reflex(yesterday), readB = await h.reflex(twoWeeks);
      expect(readA.affinity?.restoration, `${host}: provenance carries the observation time`).toMatchObject({ source: 'odp', status: 'restored', observedAt: recent });
      expect(readB.affinity?.restoration, `${host}: provenance carries the observation time`).toMatchObject({ source: 'odp', status: 'restored', observedAt: old });
      expect(readA.affinity?.dims?.line?.Tabby, `${host}: observed a day ago`).toBeCloseTo(restoredAffinity(0.82, recent, T0), 3);
      expect(readB.affinity?.dims?.line?.Tabby, `${host}: observed thirteen days ago`).toBeCloseTo(restoredAffinity(0.82, old, T0), 3);
      expect(readB.affinity?.dims?.occasion?.evening, `${host}: every restored value decays from its observation`).toBeCloseTo(restoredAffinity(0.67, old, T0), 3);

      clock.mockReturnValue(T0 + 12 * HOUR_MS);
      const later = await h.reflex(yesterday);
      expect(later.status, `${host}: ${later.text}`).toBe(200);
      expect(later.affinity?.dims?.line?.Tabby, `${host}: twelve hours later the value is the observation decayed thirty-six hours`)
        .toBeCloseTo(restoredAffinity(0.82, recent, T0 + 12 * HOUR_MS), 3);
    });
  }, 120_000);
});

describe('unit:W41.V3', () => {
  it('host: restoration runs only under the shopper\'s current personalization consent — tracking alone forwards events but never reads her profile — and a consenting shopper is restored, on both hosts', async () => {
    await onBothHosts(async (h, host) => {
      const observedAt = T0 - 3 * DAY_MS;
      const refused = await h.personFor(MERIDIAN, 'coach-account-tracking-only');
      const consented = await h.personFor(MERIDIAN, 'coach-account-consented');
      h.odp.subject(ODP_MERIDIAN, refused.vuid, recordedProfile(observedAt));
      h.odp.subject(ODP_MERIDIAN, consented.vuid, recordedProfile(observedAt));

      const trackingOnly = await h.recognize(MERIDIAN, 'coach-account-tracking-only', { tracking: true, personalization: false });
      await accepted(h.firstEvent(trackingOnly), host);
      expect(h.odp.requests.filter(r => r.kind === 'events' && r.vuid === refused.vuid).length,
        `${host}: control — tracking consent still forwards her events to the tenant's ODP`).toBeGreaterThan(0);
      expect(h.odp.profileReads(undefined, refused.vuid), `${host}: without personalization consent her profile is never read`).toEqual([]);
      expect(restoredInterests(MERIDIAN, await h.reflex(trackingOnly)), `${host}: and nothing of it is restored`).toEqual({});

      const both = await h.recognize(MERIDIAN, 'coach-account-consented');
      await accepted(h.firstEvent(both), host);
      const read = await h.reflex(both);
      expect(read.affinity?.restoration, `${host}: the consenting shopper is restored`).toMatchObject({ source: 'odp', status: 'restored', observedAt });
      expect(Object.keys(restoredInterests(MERIDIAN, read)).sort(), host).toEqual(['line:Tabby', 'occasion:evening', 'silhouette:tote']);
    });
  }, 120_000);

  it('host: never after erasure — a person restored from ODP, then erased, who signs in again is not restored from the ODP copy that predates her erasure, on both hosts', async () => {
    await onBothHosts(async (h, host, clock) => {
      const observedAt = T0 - 7 * DAY_MS;
      const her = await h.personFor(MERIDIAN, 'coach-account-erased');
      h.odp.subject(ODP_MERIDIAN, her.vuid, recordedProfile(observedAt));

      clock.mockReturnValue(T0 - 2 * DAY_MS);
      const before = await h.recognize(MERIDIAN, 'coach-account-erased');
      await accepted(h.firstEvent(before), host);
      const restored = await h.reflex(before);
      expect(restored.affinity?.restoration, `${host}: control — before her erasure she is restored`).toMatchObject({ source: 'odp', status: 'restored' });
      expect(Object.keys(restoredInterests(MERIDIAN, restored)).sort(), host).toEqual(['line:Tabby', 'occasion:evening', 'silhouette:tote']);

      clock.mockReturnValue(T0 - 1 * DAY_MS);
      const erased = await h.erase(MERIDIAN, her.shopperId);
      expect([200, 202], `${host}: the operator's erasure → ${erased.status} ${erased.text}`).toContain(erased.status);

      clock.mockReturnValue(T0);
      const again = await h.recognize(MERIDIAN, 'coach-account-erased');
      await accepted(h.firstEvent(again), host);
      const read = await h.reflex(again);
      expect(read.status, `${host}: ${read.text}`).toBe(200);
      expect(restoredInterests(MERIDIAN, read), `${host}: nothing observed at or before her erasure comes back`).toEqual({});
    });
  }, 120_000);
});

describe('unit:W41.V4', () => {
  it('host: cold, missing and malformed ODP state leaves the recognized shopper cold with the named reason, on both hosts', async () => {
    await onBothHosts(async (h, host) => {
      const observedAt = T0 - 2 * DAY_MS;
      const cases: Array<[string, (vuid: string) => OdpMode, 'cold' | 'missing' | 'malformed']> = [
        ['a profile with no interest recorded', () => recordedProfile(observedAt, {
          line_affinity_tabby: null, silhouette_affinity_tote: null, occasion_affinity_evening: null, colour_affinity_red: null, dominant_line: null, journey_stage: null }), 'cold'],
        ['no ODP profile for her vuid', () => ({ kind: 'missing' }), 'missing'],
        ['attribute values that are not numbers', () => recordedProfile(observedAt, {
          line_affinity_tabby: 'high', silhouette_affinity_tote: 'NaN', occasion_affinity_evening: '', colour_affinity_red: 'Infinity' }), 'malformed'],
        ['attribute values outside an affinity', () => recordedProfile(observedAt, {
          line_affinity_tabby: '1.7', silhouette_affinity_tote: '-0.2', occasion_affinity_evening: '1', colour_affinity_red: '42' }), 'malformed'],
        ['no usable observation time', () => ({ ...recordedProfile(observedAt), lastModifiedAt: 'yesterday' }), 'malformed'],
      ];
      for (const [index, [what, mode, reason]] of cases.entries()) {
        const account = `coach-account-state-${index}`;
        const who = await h.personFor(MERIDIAN, account);
        h.odp.subject(ODP_MERIDIAN, who.vuid, mode(who.vuid));
        const person = await h.recognize(MERIDIAN, account);
        const first = await h.firstEvent(person);
        expect(first.status, `${host}, ${what}: ${first.text}`).toBe(200);
        const read = await h.reflex(person);
        expect(read.affinity?.restoration, `${host}, ${what}: she stays cold and says why`).toMatchObject({ source: 'odp', status: 'cold', reason });
        expect(restoredInterests(MERIDIAN, read), `${host}, ${what}: nothing is restored`).toEqual({});
      }
    });
  }, 120_000);

  it('host: a failed ODP read — an error status, a network failure, an unparseable answer or no answer at all — never blocks the event or the decision, on both hosts', async () => {
    await onBothHosts(async (h, host) => {
      const failures: Array<[string, OdpMode]> = [
        ['HTTP 503', { kind: 'status', status: 503 }], ['a network failure', { kind: 'throw' }],
        ['an unparseable answer', { kind: 'garbage' }], ['no answer at all', { kind: 'hang' }],
      ];
      /** A harness bound, not a latency claim: the request must complete rather than wait on ODP. */
      const settles = async <T>(work: Promise<T>): Promise<T | 'still waiting on ODP'> =>
        Promise.race([work, new Promise<'still waiting on ODP'>(resolve => setTimeout(() => resolve('still waiting on ODP'), 15_000))]);
      for (const [index, [what, mode]] of failures.entries()) {
        const account = `coach-account-failure-${index}`;
        const who = await h.personFor(MERIDIAN, account);
        h.odp.subject(ODP_MERIDIAN, who.vuid, mode);
        const person = await settles(h.recognize(MERIDIAN, account));
        expect(typeof person === 'object', `${host}, ${what}: sign-in completes`).toBe(true);
        const first = await settles(h.firstEvent(person as Person));
        expect(first, `${host}, ${what}: the event completes`).toMatchObject({ status: 200 });
        const decision = await settles(h.decide(person as Person));
        expect(decision, `${host}, ${what}: the decision is made`).toEqual({ status: 200, decisions: 1 });
        const read = await settles(h.reflex(person as Person));
        expect(typeof read === 'object' ? restoredInterests(MERIDIAN, read) : read, `${host}, ${what}: nothing is restored`).toEqual({});
      }
      // Control: the same fixture restores a readable profile, so the refusals above are ODP's failures.
      const control = await h.personFor(MERIDIAN, 'coach-account-failure-control');
      h.odp.subject(ODP_MERIDIAN, control.vuid, recordedProfile(T0 - DAY_MS));
      const person = await h.recognize(MERIDIAN, 'coach-account-failure-control');
      await accepted(h.firstEvent(person), host);
      expect((await h.reflex(person)).affinity?.restoration, `${host}: control`).toMatchObject({ source: 'odp', status: 'restored' });
    });
  }, 240_000);
});

describe('unit:W41.V5', () => {
  it('host: restoration is tenant-scoped — each tenant reads its own ODP host with its own key, namespace and mapping, and the default tenant\'s legacy stamp-global path is not used for it, on both hosts', async () => {
    await onBothHosts(async (h, host) => {
      const observedAt = T0 - 5 * DAY_MS;
      const account = 'shared-account-7';
      const m = await h.personFor(MERIDIAN, account), hb = await h.personFor(HARBOR, account), c = await h.personFor(COACH, account);
      h.odp.subject(ODP_MERIDIAN, m.vuid, recordedProfile(observedAt));
      h.odp.subject(ODP_HARBOR, hb.vuid, { kind: 'profile', lastModifiedAt: seconds(observedAt), attributes: { hb_tabby_score: '0.3', hb_evening_score: '0.2' } });
      // Traps: the other tenant's vuid on each host, and the legacy derivation on Meridian's.
      h.odp.subject(ODP_HARBOR, m.vuid, { kind: 'profile', lastModifiedAt: seconds(observedAt), attributes: { hb_tabby_score: '0.99', hb_evening_score: '0.99' } });
      h.odp.subject(ODP_MERIDIAN, await vuidFor({ visitorId: m.shopperId, sessionId: 'unused' }), recordedProfile(observedAt, { line_affinity_tabby: '0.95' }));
      // The legacy host holds the default tenant's person under the legacy vuid, in the Coach attribute names.
      h.odp.subject(ODP_LEGACY, c.vuid, { kind: 'profile', lastModifiedAt: seconds(observedAt), attributes: {
        line_affinity_tabby: '0.82', silhouette_affinity_tote: '0.45', occasion_affinity_evening: '0.67', dominant_line: 'Tabby', journey_stage: 'ready_to_buy' } });

      const meridian = await h.recognize(MERIDIAN, account), harbor = await h.recognize(HARBOR, account);
      for (const person of [meridian, harbor]) await accepted(h.firstEvent(person), host);
      const readM = await h.reflex(meridian), readH = await h.reflex(harbor);
      expect(restoredInterests(MERIDIAN, readM)['line:Tabby'], `${host}: Meridian restores Meridian's record`).toBeCloseTo(restoredAffinity(0.82, observedAt, T0), 3);
      expect(restoredInterests(HARBOR, readH), `${host}: Harbor restores Harbor's record through Harbor's mapping`).toEqual({
        'line:Tabby': expect.closeTo(restoredAffinity(0.3, observedAt, T0), 3), 'occasion:evening': expect.closeTo(restoredAffinity(0.2, observedAt, T0), 3) });
      expect(h.odp.profileReads(ODP_MERIDIAN).map(r => [r.vuid, r.apiKey]), `${host}: Meridian's reads carry only Meridian's vuid and key`)
        .toEqual(h.odp.profileReads(ODP_MERIDIAN).map(() => [m.vuid, KEY_MERIDIAN]));
      expect(h.odp.profileReads(ODP_HARBOR).map(r => [r.vuid, r.apiKey]), `${host}: Harbor's reads carry only Harbor's vuid and key`)
        .toEqual(h.odp.profileReads(ODP_HARBOR).map(() => [hb.vuid, KEY_HARBOR]));
      expect(h.odp.profileReads(ODP_MERIDIAN).length + h.odp.profileReads(ODP_HARBOR).length, `${host}: both tenants read their own ODP`).toBeGreaterThanOrEqual(2);

      const coach = await h.recognize(COACH, account);
      await accepted(h.firstEvent(coach), host);
      expect(h.odp.profileReads(ODP_LEGACY), `${host}: the default tenant's legacy ODP settings read no profile`).toEqual([]);
      expect(restoredInterests(COACH, await h.reflex(coach)), `${host}: and restore nothing`).toEqual({});
    });
  }, 180_000);
});

describe('unit:W41.V6', () => {
  it('host: audience labels alone are never restored vectors — a dominant-line label, a journey label and a qualified ODP audience leave her cold, and beside a numeric attribute they add no interest, on both hosts', async () => {
    await onBothHosts(async (h, host) => {
      const observedAt = T0 - 2 * DAY_MS;
      const labels = await h.personFor(MERIDIAN, 'coach-account-labels-only');
      const mixed = await h.personFor(MERIDIAN, 'coach-account-labels-and-tote');
      const unscored = { line_affinity_tabby: null, silhouette_affinity_tote: null, occasion_affinity_evening: null, colour_affinity_red: null };
      h.odp.subject(ODP_MERIDIAN, labels.vuid, recordedProfile(observedAt, unscored));
      h.odp.subject(ODP_MERIDIAN, mixed.vuid, recordedProfile(observedAt, { ...unscored, silhouette_affinity_tote: '0.45' }));

      const onlyLabels = await h.recognize(MERIDIAN, 'coach-account-labels-only');
      await accepted(h.firstEvent(onlyLabels), host);
      const cold = await h.reflex(onlyLabels);
      expect(cold.affinity?.restoration, `${host}: labels alone leave her cold`).toMatchObject({ source: 'odp', status: 'cold', reason: 'cold' });
      expect(restoredInterests(MERIDIAN, cold), `${host}: no label became an interest`).toEqual({});

      const withTote = await h.recognize(MERIDIAN, 'coach-account-labels-and-tote');
      await accepted(h.firstEvent(withTote), host);
      const read = await h.reflex(withTote);
      expect(read.affinity?.restoration, `${host}: the numeric attribute is restored`).toMatchObject({ source: 'odp', status: 'restored', observedAt });
      expect(restoredInterests(MERIDIAN, read), `${host}: only the numeric attribute became an interest; dominant_line, journey_stage and the audience did not`).toEqual({
        'silhouette:tote': expect.closeTo(restoredAffinity(0.45, observedAt, T0), 3) });
      expect(Object.keys(read.affinity?.dims ?? {}).filter(dim => !['silhouette'].includes(dim)), `${host}: no other dimension was created from a label`).toEqual([]);
    });
  }, 120_000);
});

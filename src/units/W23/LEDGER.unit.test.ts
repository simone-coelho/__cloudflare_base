// src/units/W23/LEDGER.unit.test.ts
// W23 under the Closure Ledger (program.json ticket W23, frozen 2026-09-24).
//
// O1, X1, T1 and H1 are proven by the existing `unit:W23.O1.*`, `unit:W23.X1.*`,
// `unit:W23.T1.*` and `unit:W23.H1.*` blocks of `B1.unit.test.ts` in this
// directory (17 tests, green at base 4fbdddc); LG1 is proven by the acceptance
// command's second half (every `W23.` test of `src/learn/learn.test.ts` and
// `src/reflex/regionTrend.test.ts`, 4 tests, green at base). DC1 is decision D1;
// LV1–LV3 are deferred live records. This file specifies the remaining-work
// criteria R1–R3, one `describe('unit:W23.<criterion id>')` each.
//
// WITNESSES
//   · document 35 §5 row W23 (:425), quoted by the work order: "Rebuild or
//     explicitly reset damaged item and slot state under W22/W24/W30. Test
//     chronological/permuted/replayed sequences, rare concentrated cells, zero
//     rates and timestamp abuse. A local merge patch alone cannot repair
//     historical evidence."
//   · docs/architecture/35-verification-reports/F18.md §5.5 ("Fixing `bump` does
//     not repair counters whose `t` is already skewed; those objects must be
//     reset and refolded, or rebuilt from the ledger") and §8 ("Rebuild the
//     persisted counters once. `POST /reset` each `LearnStats` object and
//     refold, or rebuild from the ledger. Without this the skewed `t` values
//     survive the code fix").
//   · LANE-LOG R127(b): "`H1.01` specifies the explicit-RESET branch of the row's
//     'rebuild or explicitly reset' and names the ledger rebuild as owed
//     (W30/W27)"; the W23.H1.01 row: "the ledger-rebuild branch (reading the
//     retained R2 partitions back into the online counters) is named as owed
//     work".
//   · LANE-LOG R209 (the first W23-B1 builder's late report,
//     `_evidence/W23-B1/implementer/REPORT-FIRST-BUILDER.md` residuals 1 and 2):
//     "the ledger-REBUILD branch of H1.01 was not built (only
//     `basis: 'explicit-reset'`; W24-B1's `foldRetainedDay`/`rebuiltFrom` rebuild
//     is the seam — say which covers what at the whole-W23 review); the object's
//     own `/reset` deletes the rebuild marker so a later snapshot names no basis
//     — unruled." The frozen work order now rules it (R2).
//   · LANE-LOG R175 and `_evidence/W23-B1/reviewer-build/REPORT.md` findings 1–2:
//     "`Receipt.lift_terms`, `LiftSnapshot.rebuiltFrom` and
//     `OutcomeReceipt.outsideWindow` appear in no kit or API document … that line
//     still lists the published snapshot as `{ … items, slotRates,
//     attributionContract }` — now incomplete"; "The new `reset` intent on
//     `POST /v1/:tenant/learn/recovery` is likewise absent"; and the residual
//     "`RING_MAX_AGE_MS` (7 d) equals the purchase attribution window, so
//     `outsideWindow` can never be non-zero for a purchase".
//   · The as-built vocabulary these tests reuse by name, never re-specify:
//     `RebuildBasis` (`src/learn/stats.ts`: `basis: 'explicit-reset' |
//     'ledger-rebuild'`, `operationId`, `at`, `generation`, `date?`), the
//     explicit reset (`POST /v1/:tenant/learn/recovery`, `intent: 'reset'`,
//     W23.H1.01) and the ledger rebuild (`POST /v1/:tenant/learn/generation`
//     with `rebuildFrom`, W24.T1.02).
//
// ONE REPRESENTATION, shared with B1 and with W24's B1/B2 so no two tests ask
// for two worlds:
//   · a snapshot names its basis in `rebuiltFrom` when, and only when, the
//     object's counters stand on a repair (W23.H1.01: an object never repaired
//     names none — R2 below only ever reads an object that WAS repaired);
//   · a reset leaves no counters and no denominator behind (W24.T1.02
//     host-internal) — R2 asserts the same containment beside the kept basis;
//   · no read path repairs a damaged anchor (W23.T1.02/H1.01): R1 reads
//     `/health` on the damaged object BEFORE the rebuild and gets
//     `recovery-required`, exactly as H1.01 does.
//
// SEAMS. W24 owns the transition route, the generation and its authorization
// (W24 D2/LIVE3: no production generation is rebuilt locally; who may authorize
// one is the owner's). W30 (unmerged build `rem/w30-b1-build` at 1c4d153) edits
// `docs/kit/02-api-reference.md` and `docs/kit/03-payload-schemas.md` in other
// paragraphs (report coverage and maturity) — a textual merge overlap with R3,
// no shared clause. W23.LV3: no production statistics are touched here.

import { readFileSync } from 'node:fs';

import { afterEach, describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import * as jose from 'jose';
import ts from 'typescript';

import { memoryAuthority } from '@/auth/authority';
import { memoryStore } from '@/auth/store';
import { initializePublicationSet, invalidatePublicationCache, type PublicationBaseline } from '@/config/publication';
import { invalidateCache } from '@/config/versionedStore';
import { CONTENT_KIND, LEARN_KIND, SLOTS_KIND } from '@/content/kinds';
import { invalidateLiftCache } from '@/content/service';
import type { ContentPiece, DecisionRecord, LearnConfig, SlotCatalog } from '@/content/types';
import { DecisionRing } from '@/durable-objects/DecisionRing';
import { LearnStats } from '@/durable-objects/LearnStats';
import { ShopperReflex } from '@/durable-objects/ShopperReflex';
import { consumeLedger } from '@/ledger/consume';
import { enqueueDecisions, enqueueOutcome } from '@/ledger/enqueue';
import { outcomeFromAction, ts36, type OutcomeRecord } from '@/ledger/records';
import { statsName } from '@/learn/fan';
import { EMPTY_PRIORS, PRIORS_KIND } from '@/learn/priors';
import { DEFAULT_STATS, type LiftSnapshot, type RebuildBasis, type StatsState } from '@/learn/stats';
import { REFLEX_KIND, reflexScopeForTenant } from '@/reflex/configStore';
import { DEFAULT_REFLEX_CONFIG } from '@/reflex/core';
import { captureRetention, RETENTION_CATEGORIES, type RetentionCategory, type RetentionPolicy } from '@/retention';
import { decisionRoutes } from '@/routes/decisions';
import realtimeRoutes from '@/routes/realtime';
import { tenantMiddleware } from '@/tenancy/middleware';
import type { Env } from '@/types/env';

// ===========================================================================
// The customer's fixture (docs/architecture/tapestry_requirements.txt A.3.6:
// Coach lines, Coach cells), with the unknown-cell and cross-category rows the
// role requires, the same pieces and cells W24-B1/B2 use.
// ===========================================================================

const TENANT = 'coach';
const BRAND = 'coach';
const OPERATOR_SECRET = 'w23-ledger-synthetic-operator-signing-material';
const OPERATOR_ORIGIN = 'http://console.test';
const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
/** τ_learn, doc 22 §5.1 "default 21 days"; `DEFAULT_STATS.tauLearnMs`. */
const TAU = DEFAULT_STATS.tauLearnMs;

/** The retained day every ledger fixture is written into. */
const DATE = '2026-09-03';
const T12 = Date.UTC(2026, 8, 3, 12, 0, 0);
/**
 * The instant every leg below is pinned to (only `Date` is faked; timers stay
 * real). A snapshot is decayed to `Date.now()` and a rebuild starts its
 * generation at `Date.now()` (`LearnStats.transition`, `at`), so the counts
 * below are exact integers only when both are read at one instant.
 */
const NOW = Date.UTC(2026, 8, 3, 14, 30, 0);

const piece = (id: string, over: Partial<ContentPiece>): ContentPiece => ({
  id, customerContentId: `CMS-${id.replace(/^cnt-/, '').toUpperCase()}`, type: 'editorial',
  title: id, tags: {}, slotTypes: ['hero'], lifecycle: { status: 'live' }, ...over,
});
const PIECES: ContentPiece[] = [
  piece('cnt-tabby-evening', { title: 'Tabby, after six',
    tags: { line: ['Tabby'], occasion: ['evening'], category: ['Handbags'], contentType: ['editorial'] } }),
  piece('cnt-rogue-work', { title: 'The Rogue, at work',
    tags: { line: ['Rogue'], occasion: ['work'], category: ['Handbags'], contentType: ['editorial'] } }),
  // Cross-category: a lookbook across Small Leather Goods and Handbags.
  piece('cnt-charms-slg', { title: 'Charms, across the case', type: 'lookbook',
    tags: { occasion: ['evening'], category: ['Small Leather Goods', 'Handbags'] } }),
];
const SLOTS: SlotCatalog = { version: 'w23-ledger-coach-slots',
  pages: { home: [
    { slot: 'hero', take: 1, weights: { occasion: 0.35, line: 0.25 } },
    { slot: 'story', take: 1, weights: { occasion: 0.35, line: 0.25 } },
  ] } };
/** `hero` learns from purchases (doc 22 §4.1, seven-day window); `story` from clicks. */
const LEARN: LearnConfig = {
  holdout: { share: 0, salt: 'w23-ledger', arms: ['default'] },
  regional: { enabled: false, kBlend: 1, minEvents: 30 },
  slots: { hero: { reward: 'purchase', objective: 'unit' }, story: { reward: 'click', objective: 'unit' } },
} as unknown as LearnConfig;
const HERO = { reward: 'purchase' as const, stats: DEFAULT_STATS, objective: 'unit' as const, measurementBasis: 'served-v1' as const };
const STORY = { reward: 'click' as const, stats: DEFAULT_STATS, objective: 'unit' as const, measurementBasis: 'served-v1' as const };

const COACH_CELL = { channel: 'web', visit_bucket: 'returning', stage: 'consider', region: 'US-NY', affinity: 'evening' };
const UNKNOWN_CELL = { channel: 'web', visit_bucket: 'new', stage: 'unknown', region: 'none', affinity: 'none' };

// ===========================================================================
// The mounted application, in process, with the REAL DecisionRing, LearnStats
// and ShopperReflex classes over storage stubs — the idiom of
// `src/units/W24/B1.unit.test.ts` (ledger, rebuild) and
// `src/units/W23/B1.unit.test.ts` (the audited human-operator recovery route).
// Neither file is imported or edited.
// ===========================================================================

class UnitKV {
  data = new Map<string, string>();
  async get(key: string, type?: string) { const v = this.data.get(key); return v === undefined ? null : type === 'stream' ? new Response(v).body : type === 'json' ? JSON.parse(v) as unknown : v; }
  async put(key: string, value: string) { this.data.set(key, value); }
  async delete(key: string) { this.data.delete(key); }
  async list(o?: { prefix?: string; limit?: number; cursor?: string }) {
    const keys = [...this.data.keys()].filter(k => k.startsWith(o?.prefix ?? '')).sort(), start = Number(o?.cursor ?? 0), end = start + (o?.limit ?? 1000);
    return { keys: keys.slice(start, end).map(name => ({ name })), list_complete: end >= keys.length, ...(end < keys.length ? { cursor: String(end) } : {}) };
  }
}

class UnitR2 {
  objects = new Map<string, string>();
  versions = new Map<string, number>();
  metadata = new Map<string, Record<string, string>>();
  async get(key: string, options?: R2GetOptions) {
    const raw = this.objects.get(key); if (raw === undefined) return null;
    const bytes = new TextEncoder().encode(raw), range = options?.range;
    const selected = range && 'length' in range ? bytes.slice(0, range.length ?? bytes.length) : bytes;
    return { key, etag: 'v' + this.versions.get(key), size: bytes.length, customMetadata: this.metadata.get(key),
      body: new ReadableStream<Uint8Array>({ start(c) { c.enqueue(selected); c.close(); } }),
      text: async () => raw, json: async () => JSON.parse(raw) as unknown };
  }
  async head(key: string) { return this.objects.has(key) ? { key } : null; }
  async put(key: string, raw: string, options?: R2PutOptions) {
    const old = this.objects.has(key) ? 'v' + this.versions.get(key) : null, condition = options?.onlyIf;
    const absent = condition instanceof Headers ? condition.get('If-None-Match') === '*' : condition?.etagDoesNotMatch === '*';
    const match = condition instanceof Headers ? condition.get('If-Match') : condition?.etagMatches;
    if ((absent && old !== null) || (match != null && match !== old && match !== JSON.stringify(old))) return null;
    this.objects.set(key, raw); this.versions.set(key, (this.versions.get(key) ?? 0) + 1); this.metadata.set(key, { ...options?.customMetadata });
    return { key, etag: 'v' + this.versions.get(key), size: new TextEncoder().encode(raw).length };
  }
  async delete(keys: string | string[]) { for (const key of typeof keys === 'string' ? [keys] : keys) this.objects.delete(key); }
  async list(options: { prefix?: string; cursor?: string; limit?: number } = {}) {
    const names = [...this.objects.keys()].filter(k => k.startsWith(options.prefix ?? '')).sort(), start = Number(options.cursor ?? 0), end = start + (options.limit ?? 1000);
    return { objects: names.slice(start, end).map(key => ({ key, size: new TextEncoder().encode(this.objects.get(key) ?? '').length, uploaded: new Date(0) })),
      truncated: end < names.length, ...(end < names.length ? { cursor: String(end) } : {}) };
  }
}

const fixtureRetentionPolicy: RetentionPolicy = { id: 'w23-ledger-fixture-policy', revision: 1, durationMs: 3650 * DAY, basis: 'admitted', renewal: 'new-record-only' };
const fixtureCategories = (tenants: string[]) => Object.fromEntries(tenants.map(tenant => [tenant,
  Object.fromEntries(RETENTION_CATEGORIES.map(category => [category, fixtureRetentionPolicy])) as Record<RetentionCategory, RetentionPolicy>]));

interface DurableRegistry { data: Map<string, unknown>; object: { fetch: (request: Request) => Promise<Response> } }
interface Mounted {
  env: Env;
  storage: UnitR2;
  queued: unknown[];
  stats: Map<string, DurableRegistry>;
  fetch: (input: Request) => Promise<Response>;
  drain: () => Promise<void>;
  serviceToken: string;
  accessToken: string;
}

/**
 * `human: true` mounts the live human operator account, session and tenant-admin
 * membership the audited recovery route requires (`recoveryHuman`), exactly as
 * `src/units/W23/B1.unit.test.ts` mounts it for W23.H1.01.
 */
async function mount(options: { human?: boolean } = {}): Promise<Mounted> {
  invalidateCache(); invalidateLiftCache(); invalidatePublicationCache();
  const pending: Promise<unknown>[] = [];
  const queued: unknown[] = [];
  const storage = new UnitR2();
  const shoppers = new Map<string, DurableRegistry>(), rings = new Map<string, DurableRegistry>(), stats = new Map<string, DurableRegistry>();
  const at = Date.now();
  const accounts = memoryStore(), authority = memoryAuthority(accounts);
  await accounts.put({ id: 'ops', email: 'ops@example.invalid', name: 'Operator', roles: ['operator', 'admin'], permissions: ['*'], updatedAt: at });
  await accounts.putSession({ jti: 'w23-ledger-session', accountId: 'ops', tokenHash: 'synthetic', createdAt: at, expiresAt: at + HOUR });
  authority.memberships.set(JSON.stringify(['ops', TENANT]),
    { tenant: TENANT, accountId: 'ops', role: 'admin' as const, revision: 'r1', updatedAt: at, disabled: false, removed: false });
  const env = {
    DEPLOYMENT_PROFILE: options.human ? 'customer' : 'demo', ENVIRONMENT: 'test',
    ...(options.human ? { AUTH_MODE: 'enforced', ACCOUNTS: accounts, AUTHORITY: authority } : {}),
    CACHE: new UnitKV(), SESSIONS: new UnitKV(), CONNECTOR_MODE: 'mock', DECISION_SOURCE: 'mock', REFLEX_HOST: 'session', STORAGE: storage,
    JWT_SECRET: OPERATOR_SECRET, JWT_ISSUER: 'i', JWT_AUDIENCE: 'a', IDENTITY_SECRETS: `${TENANT}:w23-ledger-identity-material`,
    IDENTITY_SALT: 'w23-ledger-synthetic-identity-salt-material',
    TENANTS: JSON.stringify({ provisioned: [TENANT], operatorGrants: { ops: [TENANT] } }),
    PERSONALIZATION_WEBSOCKET: { idFromName: (n: string) => n, get: () => ({ fetch: async () => Response.json({ connections: 0 }) }) },
    DB: { prepare: () => ({ bind: () => ({ run: async () => ({ success: true }) }) }) },
    // The shipped deployment declares `LEDGER_RECOVERY_ENABLED = "false"` in all
    // three environments (wrangler.toml), so the fixture runs that configuration.
    LEDGER_RECOVERY_ENABLED: 'false',
    EVENT_QUEUE: { send: async (body: unknown) => { queued.push(body); } },
  } as unknown as Env;
  env.RETENTION = JSON.stringify({ version: 1, tenants: fixtureCategories([TENANT]) });

  const namespaceFor = (make: (state: DurableObjectState, env: Env) => { fetch: (request: Request) => Promise<Response> }, registry: Map<string, DurableRegistry>) => ({
    idFromName: (n: string) => n,
    get: (name: string) => ({ fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      let item = registry.get(name);
      if (!item) {
        const data = new Map<string, unknown>();
        const alarms: number[] = [];
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
        const state = { id: name, storage: storageStub, getWebSockets: () => [], waitUntil: (p: Promise<unknown>) => pending.push(p) } as unknown as DurableObjectState;
        item = { data, object: make(state, env) };
        registry.set(name, item);
      }
      return item.object.fetch(new Request(input, init));
    } }),
  });
  env.SHOPPER_REFLEX = namespaceFor((state, e) => new ShopperReflex(state, e), shoppers) as unknown as DurableObjectNamespace;
  env.DECISION_RING = namespaceFor((state, e) => new DecisionRing(state, e), rings) as unknown as DurableObjectNamespace;
  env.LEARN_STATS = namespaceFor((state, e) => new LearnStats(state, e), stats) as unknown as DurableObjectNamespace;

  const app = new Hono<{ Bindings: Env }>();
  app.use('*', tenantMiddleware());
  app.route('/realtime', realtimeRoutes);
  app.route('/v1', decisionRoutes);

  const sign = (claims: Record<string, unknown>) => new jose.SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setIssuer('i').setAudience('a').setExpirationTime('2h')
    .sign(new TextEncoder().encode(OPERATOR_SECRET));
  const serviceToken = await sign({ sub: 'ops', type: 'service', roles: ['operator', 'admin'] });
  const accessToken = await sign({ sub: 'ops', type: 'access', sid: 'w23-ledger-session', roles: ['operator', 'admin'] });

  const baseline = (kind: PublicationBaseline['kind'], value: unknown, scope = TENANT): PublicationBaseline =>
    ({ kind, scope, revision: { revision: 1, at: 1, actor: 'w23-ledger-fixture', note: 'fixture', value } });
  await initializePublicationSet(env, [
    baseline(CONTENT_KIND, { version: 'w23-ledger-coach-catalogue', pieces: PIECES }),
    baseline(SLOTS_KIND, SLOTS),
    baseline(LEARN_KIND, LEARN),
    baseline(PRIORS_KIND, EMPTY_PRIORS),
    baseline(REFLEX_KIND, DEFAULT_REFLEX_CONFIG, reflexScopeForTenant(TENANT)),
  ], '0:' + crypto.randomUUID());
  invalidatePublicationCache();

  const fetchOne = async (request: Request): Promise<Response> => app.fetch(request, env, {
    waitUntil: (p: Promise<unknown>) => pending.push(p), passThroughOnException() { /* never */ }, props: {},
  } as unknown as ExecutionContext);
  const drain = async () => { while (pending.length) await Promise.all(pending.splice(0)); await new Promise(r => setTimeout(r, 5)); };
  return { env, storage, queued, stats, fetch: fetchOne, drain, serviceToken, accessToken };
}

async function operatorGet(m: Mounted, path: string, token = m.serviceToken): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await m.fetch(new Request(OPERATOR_ORIGIN + path, { headers: { Authorization: `Bearer ${token}`, 'X-Tenant': TENANT } }));
  return { status: response.status, body: await response.json().catch(() => ({})) as Record<string, unknown> };
}
async function operatorPost(m: Mounted, path: string, body: unknown, token = m.serviceToken, headers: Record<string, string> = {}): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await m.fetch(new Request(OPERATOR_ORIGIN + path, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'X-Tenant': TENANT, 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
  }));
  return { status: response.status, body: await response.json().catch(() => ({})) as Record<string, unknown> };
}

/** The statistics object's own door, the one `src/learn/fan.ts` drives. */
const statsCall = (m: Mounted, slot: string, path: string, body: unknown) =>
  m.env.LEARN_STATS!.get(m.env.LEARN_STATS!.idFromName(statsName(TENANT, BRAND, slot)))
    .fetch('https://learn' + path, { method: 'POST', body: JSON.stringify(body) });
const storedStats = (m: Mounted, slot: string): StatsState =>
  (m.stats.get(statsName(TENANT, BRAND, slot))!.data.get('learn') as { stats: StatsState }).stats;
async function exposures(m: Mounted, slot: 'hero' | 'story', item: string, count: number, ts: number): Promise<void> {
  const response = await statsCall(m, slot, '/exposures', { tenant: TENANT, brand: BRAND, slot, config: slot === 'hero' ? HERO : STORY,
    exposures: Array.from({ length: count }, () => ({ item, cell: COACH_CELL, ts })) });
  expect(response.status, `the fixture's ${count} ${slot} exposures of ${item} are admitted: ${(await response.clone().text()).slice(0, 160)}`).toBe(200);
}
async function health(m: Mounted, slot: string): Promise<string | undefined> {
  const response = await statsCall(m, slot, '/health', { tenant: TENANT, brand: BRAND, slot });
  return (await response.json() as { state?: string }).state;
}
/** The newest reference time any counter of the object carries, item or slot. */
function newestAnchor(state: StatsState): number {
  let newest = 0;
  const maps = [state.slot, ...Object.values(state.items)];
  for (const map of maps) for (const counter of Object.values(map)) {
    newest = Math.max(newest, counter.n.t, ...Object.values(counter.s).map(entry => entry?.t ?? 0));
  }
  return newest;
}

/**
 * Damage an object the way a crafted future-dated event leaves it (F18 §2 F,
 * §6.3): every item and slot counter anchored thirty days after the present,
 * holding 4 000 exposures. The same damage W23.H1.01 applies.
 */
function damage(m: Mounted, slot: string): void {
  const holder = m.stats.get(statsName(TENANT, BRAND, slot))!;
  const stored = holder.data.get('learn') as { stats: StatsState };
  for (const map of [stored.stats.slot, ...Object.values(stored.stats.items)]) {
    for (const key of Object.keys(map)) map[key]!.n = { s: 4000, t: NOW + 30 * DAY };
  }
  stored.stats.updatedAt = NOW + 30 * DAY;
  holder.data.set('learn', stored);
  (holder.object as unknown as { data: unknown }).data = null;
}

// ── the retained day, minted the way the engine mints it and written by the
//    real producer and consumer ─────────────────────────────────────────────

function decision(env: Env, visitor: string, ts: number, item: string, slot: 'hero' | 'story'): DecisionRecord {
  return {
    decision_id: `${TENANT}:${ts36(ts)}:${visitor}:home:${slot}:0`,
    tenant: TENANT, brand: BRAND, visitor_id: visitor, session_id: `s-${visitor}`, identity_anchor: 'visitor', ts,
    page: 'home', slot, position: 0, item_id: item, customer_item_id: `CMS-${item}`, candidates: [],
    cell: visitor.startsWith('u-') ? UNKNOWN_CELL : COACH_CELL, arm: 'personalized', explored: false, authority: 'engine',
    versions: { config: 1, lift: 0, prior: 0, policy: 1 }, config_label: 'w23-ledger',
    explain: { drivers: [], score_base: 0, lift: null, score_final: 0 },
    retention: captureRetention(env as never, TENANT, ts, ts),
  } as unknown as DecisionRecord;
}
function outcome(env: Env, type: 'purchase' | 'content_click', visitor: string, item: string, slot: string, ts: number, nonce: string): OutcomeRecord {
  const made = outcomeFromAction({ type, userId: visitor, sessionId: `s-${visitor}`, timestamp: ts, eventId: nonce, eventIdSource: 'provided',
    data: { contentId: item, slot, ...(type === 'purchase' ? { value: 795, currency: 'USD' } : {}) } } as never, TENANT, BRAND)!;
  return { ...made, retention: captureRetention(env as never, TENANT, ts, ts) } as OutcomeRecord;
}

/**
 * THE RETAINED DAY and its hand-computed fold for slot `hero` (reward purchase,
 * objective unit), under the platform default attribution policy (doc 22 §4.1,
 * purchase 7 days, click 30 minutes) — the fold `foldRetainedDay` performs
 * (`src/learn/fan.ts`: the slot's personalized decisions are its exposures;
 * every outcome is attributed against its own visitor's ring, filtered to the
 * slot's reward, weighed by its objective):
 *   dA  v-tabby  hero   cnt-tabby-evening  Coach cell      → exposure 1
 *   dB  u-guest  hero   cnt-charms-slg     unknown cell    → exposure 2 (cross-category piece)
 *   dC  v-tabby  story  cnt-rogue-work                     → not a hero exposure; in v-tabby's ring
 *   oA  v-tabby purchase of cnt-tabby-evening in hero, 29 min after dA → credited: hero learns purchases
 *   oB  u-guest click on cnt-charms-slg in hero, 3 min after dB         → not credited: hero does not learn clicks
 *   oC  v-stranger purchase, never served                              → not credited: no ring
 * ⇒ decisions 2, outcomes 1; cnt-tabby-evening n 1, s 1; cnt-charms-slg n 1,
 *   s 0; the slot n 2, s 1. None of it is the damaged `cnt-rogue-work`.
 */
async function retainedDay(m: Mounted): Promise<void> {
  const dA = decision(m.env, 'v-tabby', T12 + 1 * MIN, 'cnt-tabby-evening', 'hero');
  const dB = decision(m.env, 'u-guest', T12 + 2 * MIN, 'cnt-charms-slg', 'hero');
  const dC = decision(m.env, 'v-tabby', T12 + 3 * MIN, 'cnt-rogue-work', 'story');
  const oA = outcome(m.env, 'purchase', 'v-tabby', 'cnt-tabby-evening', 'hero', T12 + 30 * MIN, 'w23-ledger-purchase-a');
  const oB = outcome(m.env, 'content_click', 'u-guest', 'cnt-charms-slg', 'hero', T12 + 5 * MIN, 'w23-ledger-click-b');
  const oC = outcome(m.env, 'purchase', 'v-stranger', 'cnt-tabby-evening', 'hero', T12 + 40 * MIN, 'w23-ledger-purchase-c');
  await enqueueDecisions(m.env, [dA, dB, dC]);
  for (const o of [oA, oB, oC]) await enqueueOutcome(m.env, o);
  const result = await consumeLedger(m.env, m.queued.splice(0), NOW);
  expect(result.ok, `the fixture day is written by the real ledger consumer: ${JSON.stringify(result).slice(0, 200)}`).toBe(true);
}

/** The snapshot the serving path reads for a slot: `liftKey`, through the operator lift read. */
async function served(m: Mounted, slot: string): Promise<LiftSnapshot | null> {
  const read = await operatorGet(m, `/v1/${TENANT}/lift?slot=${slot}&brand=${BRAND}`);
  expect(read.status, `GET /v1/:tenant/lift answers: ${JSON.stringify(read.body).slice(0, 200)}`).toBe(200);
  return (read.body.snapshot as LiftSnapshot | null) ?? null;
}
async function publish(m: Mounted, slot: string, token = m.serviceToken): Promise<LiftSnapshot> {
  const published = await operatorPost(m, `/v1/${TENANT}/learn/publish`, { slot, brand: BRAND }, token);
  expect({ status: published.status, published: published.body.published },
    `POST /v1/:tenant/learn/publish answers: ${JSON.stringify(published.body).slice(0, 200)}`).toEqual({ status: 200, published: true });
  return published.body.snapshot as LiftSnapshot;
}

afterEach(() => { vi.useRealTimers(); });

// ===========================================================================
// unit:W23.R1 — the ledger-rebuild branch of H1.01
// ===========================================================================

describe('unit:W23.R1', () => {
  /**
   * The frozen criterion: "The ledger-rebuild branch of H1.01 is built, or the
   * rebuild through foldRetainedDay and rebuiltFrom is shown to cover it
   * (LANE-LOG R127(b) and R209)."
   *
   * This test is the "shown to cover it" arm, stated as H1.01's own clauses
   * applied to the REBUILD branch of the row ("Rebuild or explicitly reset
   * damaged item and slot state"; F18 §8 "rebuild from the ledger"):
   *   (1) the damaged object is damaged and says so (H1.01's precondition);
   *   (2) an explicit operator act rebuilds it from the RETAINED LEDGER — not a
   *       merge of the damaged counters ("A local merge patch alone cannot
   *       repair historical evidence") — and is acknowledged with what it was
   *       rebuilt from;
   *   (3) the snapshot the serving path reads names the basis it was built on
   *       (`rebuiltFrom.basis: 'ledger-rebuild'`, the operation and the day) and
   *       holds ONLY the retained day's hand-computed fold, never the damaged
   *       counters beside it;
   *   (4) no counter is left anchored after the present, so the object no
   *       longer reports itself damaged;
   *   (5) a slot with no affected history is byte-unchanged and names no basis.
   * The operator credential is the one the transition route carries today
   * (`operatorJwt()`); WHO may authorize a production rebuild is W24 D2/LIVE3
   * and W23 D3/LIVE3, not asserted here.
   */
  it('host: a damaged slot rebuilt from one retained ledger day serves only that day\'s fold, names the ledger-rebuild basis, reports healthy, and leaves an unaffected slot untouched', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: NOW });
    const m = await mount();
    await retainedDay(m);

    // The damaged slot, and an unaffected slot of the same tenant and brand.
    await exposures(m, 'hero', 'cnt-rogue-work', 40, NOW - HOUR);
    damage(m, 'hero');
    await exposures(m, 'story', 'cnt-rogue-work', 7, NOW - HOUR);
    const storyBefore = JSON.stringify(m.stats.get(statsName(TENANT, BRAND, 'story'))!.data.get('learn'));
    expect(await health(m, 'hero'), 'the fixture: a slot anchored thirty days ahead reports itself damaged (W23.H1.01)').toBe('recovery-required');

    const operationId = 'b1c2d3e4f5a60718293a4b5c6d7e8f90';
    const rebuilt = await operatorPost(m, `/v1/${TENANT}/learn/generation`, { slot: 'hero', brand: BRAND, rebuildFrom: DATE },
      m.serviceToken, { 'Idempotency-Key': operationId });
    expect({ status: rebuilt.status, ok: rebuilt.body.ok, operationId: rebuilt.body.operationId, rebuiltFrom: rebuilt.body.rebuiltFrom },
      `W23.R1 — an operator can rebuild damaged statistics from the retained ledger, and the answer says what it was rebuilt from (F18 §8 "rebuild from the ledger"; R209 "W24-B1's foldRetainedDay/rebuiltFrom rebuild is the seam"). It answered: ${JSON.stringify(rebuilt.body).slice(0, 240)}`)
      .toEqual({ status: 200, ok: true, operationId, rebuiltFrom: { date: DATE, decisions: 2, outcomes: 1 } });

    const snapshot = await served(m, 'hero');
    expect(snapshot?.rebuiltFrom,
      'W23.R1 — the snapshot the serving path reads names the basis it was built on — a ledger rebuild, by this operation, from this retained day — so no reader takes one day\'s evidence for the tenant\'s whole history (W23.H1.01\'s `rebuiltFrom`, its second basis)')
      .toEqual(expect.objectContaining({ basis: 'ledger-rebuild', operationId, date: DATE }));
    const cellOf = (item: string) => snapshot?.items[item]?.['*'];
    expect({
      items: Object.keys(snapshot?.items ?? {}).sort(),
      tabby: { n: cellOf('cnt-tabby-evening')?.n, s: cellOf('cnt-tabby-evening')?.s },
      charms: { n: cellOf('cnt-charms-slg')?.n, s: cellOf('cnt-charms-slg')?.s },
      slot: { n: snapshot?.slotRates['*']?.n, s: snapshot?.slotRates['*']?.s },
    }, 'W23.R1 — and it holds exactly the retained day\'s hand-computed fold (two hero exposures, one purchase credited; the click and the never-served purchase refused) and none of the 4 000 damaged `cnt-rogue-work` exposures: a rebuild, never a merge patch over the damage (doc 35 §5 row W23 :425)')
      .toEqual({ items: ['cnt-charms-slg', 'cnt-tabby-evening'], tabby: { n: 1, s: 1 }, charms: { n: 1, s: 0 }, slot: { n: 2, s: 1 } });

    expect({ newestAnchor: newestAnchor(storedStats(m, 'hero')) <= NOW, health: await health(m, 'hero') },
      'W23.R1 — no counter of the rebuilt object is anchored after the present, so it no longer reports itself damaged: the skewed reference times did not survive the repair (F18 §5.5, §8)')
      .toEqual({ newestAnchor: true, health: 'healthy' });

    expect(JSON.stringify(m.stats.get(statsName(TENANT, BRAND, 'story'))!.data.get('learn')),
      'W23.R1 — a slot of the same tenant with no affected history is left exactly as it was: repair is conditional on actual affected history (HANDOFF-2026-09-16 §6 :227)')
      .toBe(storyBefore);
    const story = await publish(m, 'story');
    expect({ basis: Object.hasOwn(story as unknown as object, 'rebuiltFrom'), n: story.slotRates['*']!.n },
      `W23.R1 — and its own snapshot names no rebuild basis and keeps all seven exposures, decayed by their own hour: 7·e^(−1 h/τ) = ${7 * Math.exp(-HOUR / TAU)}`)
      .toEqual({ basis: false, n: 7 * Math.exp(-HOUR / TAU) });
  });
});

// ===========================================================================
// unit:W23.R2 — a reset keeps the basis marker
// ===========================================================================

describe('unit:W23.R2', () => {
  /**
   * The frozen criterion: "A reset of the statistics object keeps the basis
   * marker, so a later snapshot names its basis (LANE-LOG R209)." R209: "the
   * object's own `/reset` deletes the rebuild marker so a later snapshot names no
   * basis — unruled." The reset is the object's own `/reset`
   * (`LearnStats.ts`, which today deletes `learnRebuilt` in its transaction);
   * no operator route reaches it, so the object's own door is the real path for
   * it, and every other step goes through the mounted routes.
   *
   * KEEPS means the marker the object carried before the reset — its `basis`,
   * the audited `operationId` that made it, its `at` and, for a ledger rebuild,
   * its `date` — is the one a later snapshot names. The marker's `generation`
   * is not pinned: the reset advances the object's fence, and the frozen order
   * rules nothing about that number.
   *
   * Consistency, one world: the reset is still containment (W24.T1.02
   * host-internal) — the counters before it are gone and the later snapshot
   * holds only what was admitted after it; an object that was never repaired
   * still names no basis (W23.H1.01), because nothing here writes a marker, a
   * reset only keeps one.
   */
  it('host-internal: after an explicit operator reset, the object\'s own /reset keeps the explicit-reset basis and the next published snapshot names it', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: NOW });
    const m = await mount({ human: true });
    await exposures(m, 'hero', 'cnt-rogue-work', 40, NOW - HOUR);
    const status = await operatorPost(m, `/v1/${TENANT}/learn/recovery`, { operation: 'status', kind: 'stats', brand: BRAND, slot: 'hero' }, m.accessToken);
    expect(status.status, 'the fixture: the audited recovery route answers this human operator').toBe(200);
    const operationId = 'c1d2e3f4a5b60718293a4b5c6d7e8f90';
    const reset = await operatorPost(m, `/v1/${TENANT}/learn/recovery`, { operation: 'repair', kind: 'stats', brand: BRAND, slot: 'hero', intent: 'reset',
      digest: String(status.body.digest), generation: Number(status.body.generation), operationId }, m.accessToken);
    expect(reset.status, `the fixture: the explicit reset is admitted (W23.H1.01): ${JSON.stringify(reset.body).slice(0, 200)}`).toBe(200);
    await exposures(m, 'hero', 'cnt-tabby-evening', 3, NOW);
    const before = (await publish(m, 'hero', m.accessToken)).rebuiltFrom as RebuildBasis;
    expect(before, 'the fixture: the snapshot after the explicit reset names its basis (W23.H1.01)')
      .toEqual(expect.objectContaining({ basis: 'explicit-reset', operationId }));

    const wiped = await statsCall(m, 'hero', '/reset', {});
    expect(wiped.status, `the object's own reset answers: ${(await wiped.clone().text()).slice(0, 160)}`).toBe(200);
    await exposures(m, 'hero', 'cnt-charms-slg', 5, NOW);
    const later = await publish(m, 'hero', m.accessToken);
    expect({ items: Object.keys(later.items).sort(), n: later.slotRates['*']!.n },
      'the reset is still containment: the snapshot after it holds only the five exposures admitted since (W24.T1.02)')
      .toEqual({ items: ['cnt-charms-slg'], n: 5 });
    expect(later.rebuiltFrom,
      'W23.R2 — a reset of the statistics object keeps the basis marker, so the later snapshot still names the basis its object stands on — the explicit reset, by the same audited operation, at the same moment — and never reads as the tenant\'s whole history (LANE-LOG R209)')
      .toEqual(expect.objectContaining({ basis: before.basis, operationId: before.operationId, at: before.at }));
  });

  it('host-internal: after a ledger rebuild, the object\'s own /reset keeps the ledger-rebuild basis and the next published snapshot names it with its day', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: NOW });
    const m = await mount();
    await retainedDay(m);
    const operationId = 'd1e2f3a4b5c60718293a4b5c6d7e8f90';
    const rebuilt = await operatorPost(m, `/v1/${TENANT}/learn/generation`, { slot: 'hero', brand: BRAND, rebuildFrom: DATE },
      m.serviceToken, { 'Idempotency-Key': operationId });
    expect(rebuilt.status, `the fixture: the ledger rebuild is admitted (W24.T1.02): ${JSON.stringify(rebuilt.body).slice(0, 200)}`).toBe(200);
    const before = (await served(m, 'hero'))?.rebuiltFrom as RebuildBasis;
    expect(before, 'the fixture: the rebuilt snapshot names its basis')
      .toEqual(expect.objectContaining({ basis: 'ledger-rebuild', operationId, date: DATE }));

    const wiped = await statsCall(m, 'hero', '/reset', {});
    expect(wiped.status, `the object's own reset answers: ${(await wiped.clone().text()).slice(0, 160)}`).toBe(200);
    await exposures(m, 'hero', 'cnt-charms-slg', 5, NOW);
    const later = await publish(m, 'hero');
    expect({ items: Object.keys(later.items).sort(), n: later.slotRates['*']!.n },
      'the reset is still containment: the snapshot after it holds only the five exposures admitted since (W24.T1.02)')
      .toEqual({ items: ['cnt-charms-slg'], n: 5 });
    expect(later.rebuiltFrom,
      'W23.R2 — a reset of the statistics object keeps the basis marker: the later snapshot still names the ledger rebuild its object stands on, by the same operation, at the same moment, from the same retained day (LANE-LOG R209)')
      .toEqual(expect.objectContaining({ basis: before.basis, operationId: before.operationId, at: before.at, date: before.date }));
  });
});

// ===========================================================================
// unit:W23.R3 — what the kit tells a customer
// ===========================================================================

/** The checkout this test lives in, never the cwd (role lesson 2026-09-20, W29-B1). */
const ROOT = new URL('../../../', import.meta.url);
const read = (relative: string) => readFileSync(new URL(relative, ROOT), 'utf8');
/**
 * A document's reading units: its prose paragraphs, and each table ROW on its
 * own, so two members named in two different rows of one table are never read
 * as one statement.
 */
const units = (text: string): string[] => text.split(/\n\s*\n/)
  .flatMap(block => block.trimStart().startsWith('|') ? block.split('\n') : [block]);

describe('unit:W23.R3', () => {
  /**
   * The frozen criterion: "The kit documents Receipt.lift_terms,
   * LiftSnapshot.rebuiltFrom, OutcomeReceipt.outsideWindow and the reset
   * intent, completes the snapshot line of docs/kit/03-payload-schemas.md
   * (around lines 433 and 437) and states that the purchase window equals the
   * ring reach (LANE-LOG R175)."
   *
   * Each clause asks for the member's NAME and for the few words that make it
   * a statement a customer can act on, never for a wording:
   *   · `lift_terms` (W23.X1.02, `src/learn/receipts.ts` `LiftTerms`): the kit
   *     already names it for its W25 half (observed `n`, prior strength `n0`,
   *     `prior_version`, kit 02 "Receipts carry `lift_terms` …"); the W23 half
   *     — the baseline `p0`, the estimate `p_hat` and the strings the receipt
   *     `shown`s them as — is stated nowhere.
   *   · `rebuiltFrom` on the snapshot's member line (kit 03, the paragraph that
   *     opens with `GET /v1/{tenant}/lift`), and its two bases by name
   *     (`explicit-reset`, `ledger-rebuild`, `RebuildBasis.basis`).
   *   · "completes the snapshot line": that line is the customer's statement of
   *     what `GET /v1/{tenant}/lift` returns, and the route returns the stored
   *     snapshot RAW (`src/routes/decisions.ts`, the lift route: `CACHE.get(
   *     liftKey(…), 'json')` into `snapshot`), so the line is complete when
   *     every member of the served snapshot is on it — never `rebuiltFrom`
   *     alone (spec review 2026-09-24, W23 defect 1: `witness`, `completeness`
   *     and `tauLearnMs` are declared by `LiftSnapshot`, `src/learn/stats.ts`,
   *     and on no kit line). The member set is measured, never listed here:
   *     the logic leg reads every member `LiftSnapshot` DECLARES (so a member
   *     only some snapshots carry — a bounded object's `completeness`, a
   *     repaired one's `rebuiltFrom` — is counted), and the host leg reads
   *     every member the route actually SERVES for a repaired slot (so a member
   *     written at run time and declared nowhere is counted too). A member is
   *     "on the line" when its name stands there as a whole word; how the line
   *     phrases it is the builder's.
   *   · `outsideWindow` and, beside it, the residual R175 names: the purchase
   *     window equals the ring's reach (`RING_MAX_AGE_MS`, seven days), so a
   *     purchase can never be counted there — the W23.T1.01 row and the R169
   *     spec-fix note tie the residual to that member, which is why the clause
   *     asks for it in the same reading unit.
   *   · the `reset` intent on `POST /v1/:tenant/learn/recovery`, and the
   *     recovery paragraph no longer telling a customer that no historical
   *     reset is offered (kit 02: "No raw overwrite, tenant remapping or
   *     historical reset is offered."), which the explicit reset contradicts.
   */
  /** Kit 03's snapshot member line: the reading unit that opens with `GET /v1/{tenant}/lift`. */
  const snapshotLineOf = (schema: string) => units(schema).find(u => u.includes('`GET /v1/{tenant}/lift`')) ?? '';
  /** A member is stated on the line when its name stands there as a whole word. */
  const statedOn = (line: string, member: string) => new RegExp(`\\b${member.replace(/[^\w$]/g, '\\$&')}\\b`).test(line);
  /** member → stated?, so a failure names every member the line leaves out. */
  const lineCoverage = (line: string, members: string[]) => Object.fromEntries(members.map(member => [member, statedOn(line, member)]));
  const everyMember = (members: string[]) => Object.fromEntries(members.map(member => [member, true]));
  /**
   * Every member the `LiftSnapshot` interface declares in `src/learn/stats.ts`
   * (and any interface of that file it extends), read with the TypeScript
   * parser from the checkout this test lives in.
   */
  const declaredSnapshotMembers = (): string[] => {
    const file = 'src/learn/stats.ts';
    const source = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true);
    const members = new Set<string>();
    const visit = (name: string, seen: Set<string>) => {
      if (seen.has(name)) return;
      seen.add(name);
      for (const statement of source.statements) {
        if (!ts.isInterfaceDeclaration(statement) || statement.name.text !== name) continue;
        for (const member of statement.members) {
          if (member.name && (ts.isIdentifier(member.name) || ts.isStringLiteral(member.name))) members.add(member.name.text);
        }
        for (const clause of statement.heritageClauses ?? []) {
          for (const type of clause.types) if (ts.isIdentifier(type.expression)) visit(type.expression.text, seen);
        }
      }
    };
    visit('LiftSnapshot', new Set());
    return [...members];
  };

  it('logic: the kit names lift_terms\' terms, rebuiltFrom on the snapshot line with its bases, every member the snapshot declares on that line, outsideWindow with the purchase-window residual, and the reset intent on learn/recovery', () => {
    const api = read('docs/kit/02-api-reference.md');
    const schema = read('docs/kit/03-payload-schemas.md');
    const kit = [...units(api), ...units(schema)];

    const liftTerms = kit.some(u => u.includes('`lift_terms`') && u.includes('`p0`') && u.includes('`p_hat`') && u.includes('`shown`'));
    const snapshotLine = snapshotLineOf(schema);
    const rebuiltFromOnLine = /\brebuiltFrom\b/.test(snapshotLine);
    const declared = declaredSnapshotMembers();
    expect(declared, 'the fixture: the members of `LiftSnapshot` are read from its declaration in src/learn/stats.ts')
      .toEqual(expect.arrayContaining(['tenant', 'items', 'slotRates', 'rebuiltFrom']));
    const snapshotLineMembers = lineCoverage(snapshotLine, declared);
    const rebuiltFromBases = units(schema).some(u => u.includes('`rebuiltFrom`') && u.includes('explicit-reset') && u.includes('ledger-rebuild'));
    const outsideWindow = kit.some(u => u.includes('`outsideWindow`') && /window/i.test(u) && /purchase/i.test(u) && /\bring\b/i.test(u)
      && /\b(equal|equals|same|coincide|coincides|identical)\b/i.test(u));
    const recovery = kit.filter(u => u.includes('learn/recovery'));
    const resetIntent = recovery.some(u => /intent\s*[:=]?\s*`?['"]?reset\b|`reset`/.test(u));
    const noResetDenied = !/\bNo [^.]*historical reset is offered/.test(api + schema);

    expect({ liftTerms, rebuiltFromOnLine, rebuiltFromBases, snapshotLineMembers, outsideWindow, resetIntent, noResetDenied },
      `W23.R3 — the kit documents what W23 put on the wire (LANE-LOG R175; W23-B1 build review findings 1–2): the terms of \`lift_terms\` (\`p0\`, \`p_hat\` and what the receipt \`shown\`s), \`rebuiltFrom\` on the snapshot's member line and its two bases, a COMPLETE snapshot line — every member \`LiftSnapshot\` declares, since GET /v1/{tenant}/lift returns the snapshot raw — \`outsideWindow\` together with the residual that the purchase window equals the ring's reach, and the \`reset\` intent on learn/recovery without the sentence denying it. The snapshot line reads: ${snapshotLine.slice(0, 260)}`)
      .toEqual({ liftTerms: true, rebuiltFromOnLine: true, rebuiltFromBases: true, snapshotLineMembers: everyMember(declared), outsideWindow: true, resetIntent: true, noResetDenied: true });
  });

  it('host: every member GET /v1/{tenant}/lift serves for a slot rebuilt from the ledger is stated on the kit\'s snapshot line', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: NOW });
    const m = await mount();
    await retainedDay(m);
    const operationId = 'e1f2a3b4c5d60718293a4b5c6d7e8f90';
    const rebuilt = await operatorPost(m, `/v1/${TENANT}/learn/generation`, { slot: 'hero', brand: BRAND, rebuildFrom: DATE },
      m.serviceToken, { 'Idempotency-Key': operationId });
    expect(rebuilt.status, `the fixture: the ledger rebuild is admitted (W24.T1.02): ${JSON.stringify(rebuilt.body).slice(0, 200)}`).toBe(200);

    const snapshot = await served(m, 'hero');
    const members = Object.keys(snapshot ?? {});
    expect(members, 'the fixture: the rebuilt slot is served a snapshot, and it names its basis (W23.R1)')
      .toEqual(expect.arrayContaining(['items', 'slotRates', 'rebuiltFrom']));

    const snapshotLine = snapshotLineOf(read('docs/kit/03-payload-schemas.md'));
    expect(lineCoverage(snapshotLine, members),
      `W23.R3 — the kit's snapshot line is complete: every member GET /v1/{tenant}/lift actually served for this repaired slot is stated on it, because the route returns the stored snapshot raw and a customer reads that line to know what she was given (spec review 2026-09-24, W23 defect 1). The route served: ${members.join(', ')}. The line reads: ${snapshotLine.slice(0, 260)}`)
      .toEqual(everyMember(members));
  });
});

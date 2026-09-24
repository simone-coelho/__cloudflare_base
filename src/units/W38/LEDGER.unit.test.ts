// src/units/W38/LEDGER.unit.test.ts
//
// W38 — "Content and cache bounds with read-path performance".
//
// AUTHORITY (docs/remediation/delivery-control/program.json, ticket W38, quoting
// document 35 §5 row W38, line 445): "Byte/count guards and bounded cache; verify
// old readers before removing duplicated envelope field, retain needed immutable
// revisions and purge by policy. Measure whole read/validate/compose path on
// realistic shapes and concurrency. Use final-score/candidate-preserving
// optimization with full parity; retrieval/sharding only if required by the
// accepted workload."
//
// WITNESSES
//   · document 35 §2 F32 — "Duplicated value/config documents, unbounded isolate
//     cache/revision bodies, whole-catalog parsing/validation and per-slot ranking
//     create size/CPU/memory limits … Verify old deployed readers before removing
//     compatibility fields. Enforce byte/count/cache/retention budgets and measure
//     realistic misses/hits"; §2 F08 (bound total items, keys and serialized
//     bytes); §3 N07; §6 "Catalog/storage fixtures are not interchangeable"
//     ("Payload shape, overlap, adjusted scoring, parse/validation and cache misses
//     change the result"; "Workers' isolate memory bound").
//   · docs/architecture/35-verification-reports/F32.md §1.1 and §6.1: the retired
//     store's reader was `'value' in envelope ? envelope.value : envelope.config`,
//     "so every document already stored keeps working"; §1.5 the 128 MB isolate;
//     §2.6 the shipped Coach catalog (public/data/coach-content.json) is the
//     calibrated realistic piece shape.
//   · The retired writers themselves: src/reflex/configStore.ts before 1877fc6
//     stored `{ revision, config, actor, note, at }`; src/config/versionedStore.ts
//     from 1877fc6 to 7b01c14 stored `{ ...revision, config: value }`.
//   · HANDOFF-2026-09-18 §6 W38 row; §7 Retention (decision D2: "Existing
//     revisions are never deleted automatically").
//
// CRITERIA SPECIFIED HERE: B1, B2 (the consuming routes W38.04 does not cover),
// B3, B4 (its no-policy clause), B5.
// CITED, NOT REWRITTEN:
//   · B2 for the twenty config/content lanes: "W38.04 bounds every consuming route
//     before effects…" (src/routes/content.test.ts:985) and "W38.04 counts
//     streamed local and direct remote bytes…" (src/content/import.test.ts:143).
//   · B6: the W38.05 oracle tests (src/reflex/contentCompose.test.ts:243 and :301,
//     oracle docs/remediation/design/W38.05/baseline.json).
//   · LG1: the second command of the acceptance command.
//
// RULED MEMBERS (the witness names the capability, not the spelling):
//   · `LIFT_CACHE_MAX_BYTES`, exported by src/content/service.ts: the lift cache's
//     total byte cap, beside its 256-entry cap. Its value is not ruled; it admits
//     one snapshot at the read path's own 2 MiB snapshot limit and stays below the
//     128 MB isolate (F32 §1.5), or it bounds nothing.
//   · B2: every enrichment route answers an over-budget body with W38.04's typed
//     refusal — 413 { ok:false, code:'input_budget_exceeded', budget:'bytes',
//     limit, observed } — one representation for every consuming route.
//   · B3: the only product path that reads a revision the retired store wrote is
//     the explicit adoption, `initializePublicationSet` (kit 02 §4). It accepts
//     that revision EXACTLY AS STORED and reads it as the retired reader did:
//     `value` when present, else `config`. The request-body alias of
//     src/routes/config.ts:161 (and :176) is ACCEPTED: document 35 requires old
//     callers to be verified before a compatibility path is removed, and no such
//     verification exists.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import type { Env } from '@/types/env';
import { memoryStore } from '@/auth/store';
import { INPUT_MAX_BYTES } from '@/config/input';
import { initializePublicationSet, readPublication, type PublicationBaseline } from '@/config/publication';
import { invalidateCache, readRevision, type DocumentKind } from '@/config/versionedStore';
import { CONTENT_KIND, DEFAULT_LEARN, DEFAULT_SLOTS, EMPTY_CATALOG, LEARN_KIND, SLOTS_KIND } from '@/content/kinds';
import type { ContentCatalog, LearnConfig, SlotCatalog } from '@/content/types';
import { CONSENT_LIFETIME_MS } from '@/content/consent';
import { invalidateLiftCache, readLift, serveContentDecisions, slotLearnConfigOf } from '@/content/service';
// RULED EXPORT (B1). Absent at the base revision: B1 is RED on it.
import { LIFT_CACHE_MAX_BYTES } from '@/content/service';
import { issueSessionCapability } from '@/identity/sessionCapability';
import { admitOwnerPrincipal, runOwnerOperation } from '@/identity/sessionAuthority';
import { EMPTY_PROPOSALS, PROPOSALS_KIND } from '@/learn/cycle';
import { liftKey } from '@/learn/fan';
import { EMPTY_PRIORS, PRIORS_KIND } from '@/learn/priors';
import { DEFAULT_STATS, type LiftSnapshot } from '@/learn/stats';
import { REFLEX_KIND, reflexScopeForTenant } from '@/reflex/configStore';
import { DEFAULT_REFLEX_CONFIG } from '@/reflex/core';
import { configRoutes } from '@/routes/config';
import { contentRoutes } from '@/routes/content';
import { tenantMiddleware } from '@/tenancy/middleware';
import { shopperObjectName } from '@/tenancy/objects';

/** The checkout this file lives in (src/units/W38 → ../../..), never the cwd. */
const ROOT = new URL('../../../', import.meta.url);
const MiB = 1024 * 1024;
const encoder = new TextEncoder();
const bytesOf = (text: string) => encoder.encode(text).byteLength;
const H = 'https://w38.invalid';
const SECRET = 'w38-ledger-synthetic-signing-material';

// ─── storage: R2 with R2's own conditional semantics ────────────────────────

class LedgerR2 {
  objects = new Map<string, string>(); etags = new Map<string, string>();
  puts: string[] = []; deletes: string[] = []; seq = 0;
  async get(key: string) {
    const raw = this.objects.get(key); if (raw === undefined) return null;
    return { key, etag: this.etags.get(key)!, size: bytesOf(raw), body: new Response(raw).body,
      text: async () => raw, json: async () => JSON.parse(raw) as unknown };
  }
  async head(key: string) { const raw = this.objects.get(key); return raw === undefined ? null : { key, etag: this.etags.get(key)!, size: bytesOf(raw) }; }
  async put(key: string, raw: string, options?: R2PutOptions) {
    this.puts.push(key);
    const condition = options?.onlyIf, exists = this.objects.has(key);
    if (condition instanceof Headers ? condition.get('If-None-Match') === '*' && exists
      : condition && 'etagMatches' in condition && condition.etagMatches !== this.etags.get(key)) return null;
    this.objects.set(key, raw); this.etags.set(key, 'w38-' + (++this.seq));
    return { key, etag: this.etags.get(key)!, size: bytesOf(raw) };
  }
  /** Recorded AND performed, so a deletion is visible both ways. */
  async delete(keys: string | string[]) { for (const key of [keys].flat()) { this.deletes.push(key); this.objects.delete(key); this.etags.delete(key); } }
  async list(options?: { prefix?: string }) {
    return { objects: [...this.objects.keys()].filter(key => key.startsWith(options?.prefix ?? '')).sort().map(key => ({ key })), truncated: false, delimitedPrefixes: [] };
  }
  snapshot(): string { return JSON.stringify([...this.objects].sort(([a], [b]) => a.localeCompare(b))); }
}
class LedgerKV {
  store = new Map<string, string>(); gets: string[] = []; puts: string[] = [];
  async get(key: string, type?: string): Promise<unknown> {
    this.gets.push(key); const raw = this.store.get(key); if (raw === undefined) return null;
    return type === 'stream' ? new Response(raw).body : type === 'json' ? JSON.parse(raw) : raw;
  }
  async put(key: string, value: string): Promise<void> { this.puts.push(key); this.store.set(key, value); }
}

const token = (payload: Record<string, unknown>) => new SignJWT(payload).setProtectedHeader({ alg: 'HS256' }).setIssuedAt()
  .setIssuer('i').setAudience('a').setExpirationTime('10m').sign(encoder.encode(SECRET));

function operatorEnv(tenants: string[], grants: Record<string, string[]>): Env & { STORAGE: R2Bucket } {
  return { CACHE: new LedgerKV(), STORAGE: new LedgerR2(), JWT_SECRET: SECRET, JWT_ISSUER: 'i', JWT_AUDIENCE: 'a',
    TENANTS: JSON.stringify({ provisioned: tenants, operatorGrants: grants }) } as unknown as Env & { STORAGE: R2Bucket };
}
const r2Of = (env: Env) => env.STORAGE as unknown as LedgerR2;
function mounted() {
  const app = new Hono<{ Bindings: Env; Variables: { tenant: string } }>();
  app.use('*', tenantMiddleware()); app.route('/content', contentRoutes); app.route('/config', configRoutes);
  return app;
}
const KINDS: DocumentKind<unknown>[] = [CONTENT_KIND, SLOTS_KIND, LEARN_KIND, REFLEX_KIND, PRIORS_KIND, PROPOSALS_KIND] as DocumentKind<unknown>[];
const scopeFor = (kind: DocumentKind<unknown>, tenant: string) => kind.name === 'reflex' ? reflexScopeForTenant(tenant) : tenant;
/** The six members an authorized initializer supplies together (kit 02 §4). */
async function initialize(env: Env, tenant: string, values: Partial<Record<string, unknown>> = {}) {
  const defaults: Record<string, unknown> = { content: EMPTY_CATALOG, slots: DEFAULT_SLOTS, learn: DEFAULT_LEARN, reflex: DEFAULT_REFLEX_CONFIG, prior: EMPTY_PRIORS, proposals: EMPTY_PROPOSALS };
  return initializePublicationSet(env, KINDS.map(kind => ({ kind, scope: scopeFor(kind, tenant),
    revision: { revision: 1, value: values[kind.name] ?? defaults[kind.name], actor: 'w38-initializer', note: '', at: 1 } })), '0:' + crypto.randomUUID());
}
/** If-Match "N/S/H" and Idempotency-Key from the actually loaded draft (kit 02 §4). */
async function authored(env: Env, kind: DocumentKind<unknown>, tenant: string) {
  const read = await readPublication(env, kind, scopeFor(kind, tenant));
  return { 'If-Match': `"${read.revision}/${read.publication!.revision}/${read.publication!.digest}"`, 'Idempotency-Key': `${read.revision}:${crypto.randomUUID()}` };
}

beforeEach(() => { invalidateCache(); invalidateLiftCache(); });
afterEach(() => { invalidateCache(); invalidateLiftCache(); });

// ===========================================================================
// unit:W38.B1 — the lift cache has a total byte cap as well as its 256 entries
// ===========================================================================

describe('unit:W38.B1', () => {
  const TENANT = 'coach', BRAND = 'coach';
  const config = slotLearnConfigOf({})('any');
  /** A compatible, witnessed snapshot padded with real-shaped item statistics to about `target` bytes. */
  function snapshotFor(slot: string, target: number) {
    const stat = (level: 0 | 1, key: string, i: number) => ({ level, key, n: 40 + i % 7, s: 3 + i % 5, p0: 0.06, p_hat: 0.071, lift: 1.08 });
    const base: LiftSnapshot = { tenant: TENANT, brand: BRAND, slot, reward: 'click', objective: 'unit', measurementBasis: 'served-v1',
      tauLearnMs: DEFAULT_STATS.tauLearnMs, n0: DEFAULT_STATS.n0, nMin: DEFAULT_STATS.nMin, liftMin: DEFAULT_STATS.liftMin, liftMax: DEFAULT_STATS.liftMax,
      version: 3, publishedAt: 1_000, events: 1_000, witness: 'b'.repeat(64), items: {}, slotRates: { '*': { n: 1000, s: 60, rate: 0.06 } } } as LiftSnapshot;
    const one = JSON.stringify({ 'CCH-0000': { '*': stat(0, '*', 0), 'c=direct': stat(1, 'c=direct', 0) } }).length;
    const count = Math.max(1, Math.floor((target - JSON.stringify(base).length) / one));
    for (let i = 0; i < count; i++) {
      base.items[`CCH-${String(i).padStart(4, '0')}`] = { '*': stat(0, '*', i), 'c=direct': stat(1, 'c=direct', i) } as LiftSnapshot['items'][string];
    }
    const raw = JSON.stringify(base);
    return { raw, bytes: bytesOf(raw) };
  }
  /**
   * Residency is what is measured: the cache keeps the raw snapshot whatever
   * one request's verdict is (src/content/service.ts), and an entry it keeps is
   * one the serving read answers without a KV read. The statistics object here
   * is restarting, so no read spends time on a witness digest.
   */
  function environment() {
    const kv = new LedgerKV();
    const LEARN_STATS = { idFromName: (name: string) => name, get: () => ({ fetch: async () => Response.json({ ok: true, state: 'degraded' }) }) };
    return { kv, env: { CACHE: kv, LEARN_STATS } as unknown as Env };
  }

  it('B1: the snapshots the isolate cache serves never total more than LIFT_CACHE_MAX_BYTES, however few entries they are', async () => {
    expect(typeof LIFT_CACHE_MAX_BYTES, 'W38.B1 — src/content/service.ts exports the lift cache\'s total byte cap, LIFT_CACHE_MAX_BYTES, beside its 256-entry cap (F32 §4.4, document 35 §6 "bound … cache")').toBe('number');
    const cap = LIFT_CACHE_MAX_BYTES as unknown as number;
    expect(Number.isSafeInteger(cap) && cap >= 2 * MiB && cap < 128 * MiB,
      `W38.B1 — the cap (${cap}) admits one snapshot at the read path's own 2 MiB limit and stays below the 128 MB isolate (F32 §1.5)`).toBe(true);
    // One-MiB snapshots, enough of them to exceed the cap by more than two while
    // staying far below 256 entries: only the BYTE cap can bound this cache.
    const count = Math.floor(cap / MiB) + 3, sizes = new Map<string, number>();
    const { kv, env } = environment(), slots = Array.from({ length: count }, (_, i) => `slot-${String(i).padStart(3, '0')}`);
    for (const slot of slots) { const made = snapshotFor(slot, MiB); sizes.set(slot, made.bytes); kv.store.set(liftKey(TENANT, BRAND, slot), made.raw); }
    for (const slot of slots) await readLift(env, TENANT, BRAND, slot, 1_000, config);
    expect(kv.gets.length, 'every first serving read goes to KV').toBe(count);
    // Newest first: a bounded cache keeps the most recent entries, so every miss
    // after the first one concerns an entry that was already evicted.
    let cachedBytes = 0; const cached: string[] = [];
    for (const slot of [...slots].reverse()) {
      const reads = kv.gets.length;
      await readLift(env, TENANT, BRAND, slot, 1_001, config);
      if (kv.gets.length === reads) { cached.push(slot); cachedBytes += sizes.get(slot)!; }
    }
    expect(cached[0], 'W38.B1 — the most recent snapshot is still served from the isolate cache: a byte cap bounds the cache, it does not disable it').toBe(slots[count - 1]);
    expect(cachedBytes, `W38.B1 — the snapshots served from the isolate cache total at most LIFT_CACHE_MAX_BYTES (${cap}); ${cached.length} of ${count} one-MiB snapshots were`).toBeLessThanOrEqual(cap);
  }, 60_000);

  it('B1: the 256-entry cap still holds for small snapshots', async () => {
    const { kv, env } = environment();
    const slots = Array.from({ length: 257 }, (_, i) => `small-${String(i).padStart(3, '0')}`);
    for (const slot of slots) kv.store.set(liftKey(TENANT, BRAND, slot), snapshotFor(slot, 1_024).raw);
    for (const slot of slots) await readLift(env, TENANT, BRAND, slot, 1_000, config);
    let hits = 0;
    for (const slot of [...slots].reverse()) { const reads = kv.gets.length; await readLift(env, TENANT, BRAND, slot, 1_001, config); if (kv.gets.length === reads) hits++; }
    expect(hits, 'W38.B1 — at most 256 lift snapshots are served from the isolate cache (src/content/service.ts entry cap)').toBeLessThanOrEqual(256);
    expect(hits, 'W38.B1 — small snapshots are still cached up to the entry cap').toBeGreaterThanOrEqual(1);
  });
});

// ===========================================================================
// unit:W38.B2 — every consuming route refuses over-budget input by name, before effects
// ===========================================================================

describe('unit:W38.B2', () => {
  /**
   * W38.04 (src/routes/content.test.ts:985) proves the twenty config/content lanes
   * and the remote pull. The four enrichment routes under
   * /content/catalog/enrichment/proposals consume a request body too (a sample of
   * up to 500 pieces and 4000 labels) and were left on their own reader by
   * W38.04's plan; they must refuse by the same name.
   */
  it('B2: the four enrichment routes refuse an over-budget body with the typed input_budget_exceeded refusal, before any storage or model effect', async () => {
    const TENANT = 'atelier-a';
    const env = operatorEnv([TENANT], { 'service-a': [TENANT], 'human-a': [TENANT] }), accounts = memoryStore();
    Object.assign(env, { AUTH_MODE: 'enforced', ACCOUNTS: accounts });
    await accounts.put({ id: 'human-a', email: 'human-a@example.invalid', name: 'Synthetic Reviewer', roles: ['operator'], permissions: ['read'], disabled: false, must_change_password: false } as never);
    await accounts.putSession({ jti: 'session-a', accountId: 'human-a', tokenHash: 'synthetic-session-hash', createdAt: Date.now(), expiresAt: Date.now() + 300_000 } as never);
    await initialize(env, TENANT);
    const service = await token({ sub: 'service-a', type: 'service', roles: ['admin'] });
    const human = await token({ sub: 'human-a', type: 'access', sid: 'session-a', roles: ['admin'] });
    const app = mounted(), storage = r2Of(env), kv = env.CACHE as unknown as LedgerKV;
    const before = storage.snapshot(), puts = storage.puts.length;
    const model: string[] = [], realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => { model.push(String(input)); throw new Error('W38.B2 — no model or network call before admission'); }) as typeof fetch;
    try {
      const lanes: Array<[string, string, Record<string, string>]> = [
        ['/content/catalog/enrichment/proposals', service, {}],
        ['/content/catalog/enrichment/proposals/generate', service, {}],
        ['/content/catalog/enrichment/proposals/synthetic-proposal/review', human, {}],
        ['/content/catalog/enrichment/proposals/synthetic-proposal/publish', human, await authored(env, CONTENT_KIND as DocumentKind<unknown>, TENANT)],
      ];
      for (const [path, bearer, extra] of lanes) {
        let pulls = 0, cancelled = false;
        const body = new ReadableStream<Uint8Array>({
          pull(c) { pulls++; c.enqueue(new Uint8Array(pulls === 1 ? INPUT_MAX_BYTES : 1)); },
          cancel() { cancelled = true; },
        }, { highWaterMark: 0 });
        const response = await app.request(new Request(H + path, { method: 'POST', duplex: 'half', body,
          headers: { 'Content-Type': 'application/json', 'Content-Length': '1', 'X-Tenant': TENANT, Authorization: `Bearer ${bearer}`, ...extra } } as RequestInit), undefined, env);
        expect(response.status, `${path} answers 413`).toBe(413);
        expect(response.headers.get('cache-control'), `${path} is no-store`).toBe('no-store');
        expect(await response.json(), `W38.B2 — ${path} refuses the over-budget body BY NAME, with the typed refusal every other consuming route answers (W38.04): { ok:false, code:'input_budget_exceeded', budget:'bytes', limit, observed }`)
          .toMatchObject({ ok: false, code: 'input_budget_exceeded', budget: 'bytes', limit: INPUT_MAX_BYTES, observed: INPUT_MAX_BYTES + 1 });
        expect({ cancelled, readPastBudget: pulls > 2 }, `${path} stops reading at the budget and cancels the stream`).toEqual({ cancelled: true, readPastBudget: false });
      }
      expect({ storage: storage.snapshot() === before, puts: storage.puts.length - puts, kvWrites: kv.puts.length, model: model.length },
        'W38.B2 — no enrichment refusal has any storage, cache or model effect').toEqual({ storage: true, puts: 0, kvWrites: 0, model: 0 });
    } finally { globalThis.fetch = realFetch; }
  });
});

// ===========================================================================
// unit:W38.B3 — old stored revisions still read; the request-body alias is ruled
// ===========================================================================

describe('unit:W38.B3', () => {
  const OLD = 'atelier-a', CURRENT = 'atelier-b';
  const catalog: ContentCatalog = { version: 'catalog-retired', pieces: [
    { id: 'cnt_tabby', customerContentId: 'CCH-001', type: 'campaign', title: 'The Tabby, four new leathers', tags: { line: ['Tabby'], occasion: ['everyday'], contentType: ['campaign'] }, slotTypes: ['chero'], lifecycle: { status: 'live' } },
    { id: 'cnt_willow', customerContentId: 'CCH-002', type: 'editorial', title: 'Willow for evening', tags: { line: ['Willow'], occasion: ['evening'] }, slotTypes: ['story'], lifecycle: { status: 'live' } },
  ] } as ContentCatalog;
  const slots: SlotCatalog = { version: 'slots-retired', pages: { home: [{ slot: 'chero', take: 1, weights: { line: 0.5, occasion: 0.5 } }, { slot: 'story', take: 1, weights: { occasion: 1 } }] } } as SlotCatalog;
  const reflex = { ...DEFAULT_REFLEX_CONFIG, version: 'reflex-retired', K: 7 };
  /** Revision numbers as the retired store left them; not one of them is 1. */
  const revisions: Record<string, [number, unknown]> = { content: [12, catalog], slots: [4, slots], learn: [9, DEFAULT_LEARN], reflex: [7, reflex], prior: [3, EMPTY_PRIORS], proposals: [2, EMPTY_PROPOSALS] };
  const AT = Date.UTC(2026, 7, 30);
  /** The bytes each retired writer stored, parsed back exactly as stored. */
  const stored = (name: string): Record<string, unknown> => {
    const [revision, value] = revisions[name]!;
    const text = name === 'reflex'
      // src/reflex/configStore.ts before 1877fc6: JSON.stringify(revision) with the document under `config`.
      ? JSON.stringify({ revision, config: value, actor: 'ops', note: 'tuned before the generalization', at: AT })
      // src/config/versionedStore.ts 1877fc6 → 7b01c14: JSON.stringify({ ...revision, config: value }).
      : JSON.stringify({ revision, value, actor: 'ops', note: 'written with both field names', at: AT, config: value });
    return JSON.parse(text) as Record<string, unknown>;
  };
  /** The same revision in today's `{ revision, value, actor, note, at }` form. */
  const current = (name: string) => { const [revision, value] = revisions[name]!; return { revision, value, actor: 'ops', note: stored(name).note as string, at: AT }; };
  // The initializing operation is keyed on the first member's own base revision (publicationPreconditions).
  const adopt = (env: Env, tenant: string, form: (name: string) => Record<string, unknown>) => initializePublicationSet(env,
    KINDS.map(kind => ({ kind, scope: scopeFor(kind, tenant), retainedValue: true as const, revision: form(kind.name) as unknown as PublicationBaseline['revision'] })),
    `${revisions.content![0] - 1}:${crypto.randomUUID()}`);

  it('B3: every revision the retired store wrote — `config` only (before 1877fc6) or `value` beside a duplicated `config` (1877fc6 → 7b01c14) — still reads, exactly as the same revision written today', async () => {
    const env = operatorEnv([OLD, CURRENT], { ops: [OLD, CURRENT] }), app = mounted();
    const adopted = await adopt(env, OLD, stored).then(() => 'adopted', (error: Error) => `refused: ${error.message}`);
    expect(adopted, 'W38.B3 — the explicit adoption accepts each revision exactly as the retired store wrote it, reading `value` when present and `config` otherwise (F32 §1.1/§6.1)').toBe('adopted');
    await adopt(env, CURRENT, current);
    const bearer = await token({ sub: 'ops', type: 'service' });
    const get = async (tenant: string, path: string) => {
      const response = await app.request(H + path, { headers: { Authorization: `Bearer ${bearer}`, 'X-Tenant': tenant } }, env);
      const body = await response.json() as Record<string, unknown>;
      const { publication: _p, scope: _s, ...rest } = body; void _p; void _s;
      return { status: response.status, ...rest };
    };
    for (const [route, name] of [['catalog', 'content'], ['slots', 'slots'], ['learn', 'learn'], ['priors', 'prior']] as const) {
      const n = revisions[name]![0], path = `/content/${route}/revisions/${n}`;
      const read = await get(OLD, path);
      expect(read, `W38.B3 — GET ${path} reads the retired ${name} revision ${n} as the same revision written today`).toEqual(await get(CURRENT, path));
      expect(read.status).toBe(200);
    }
    const reflexPath = (tenant: string) => `/config/reflex/revisions/7?scope=${reflexScopeForTenant(tenant)}`;
    const reflexRead = await get(OLD, reflexPath(OLD));
    expect(reflexRead, 'W38.B3 — GET /config/reflex/revisions/7 reads the `config`-only retired revision as the same revision written today').toEqual(await get(CURRENT, reflexPath(CURRENT)));
    expect(reflexRead).toMatchObject({ status: 200, revision: 7, authored: { version: 'reflex-retired', K: 7 } });
    for (const tenant of [OLD, CURRENT]) expect((await readPublication(env, PROPOSALS_KIND, tenant)).value, `the retained proposals document of ${tenant} reads`).toEqual(EMPTY_PROPOSALS);
  });

  it('B3: the config request-body alias (src/routes/config.ts:161, :176) is ACCEPTED — a bare Reflex document validates and publishes exactly as the same document under `config`', async () => {
    const env = operatorEnv([OLD, CURRENT], { ops: [OLD, CURRENT] }), app = mounted();
    await initialize(env, OLD); await initialize(env, CURRENT);
    const bearer = await token({ sub: 'ops', type: 'service' });
    const document = { ...DEFAULT_REFLEX_CONFIG, version: 'alias-probe', K: 5 };
    const call = async (tenant: string, path: string, method: string, body: unknown, extra: Record<string, string> = {}) => {
      const response = await app.request(H + path, { method, body: JSON.stringify(body),
        headers: { Authorization: `Bearer ${bearer}`, 'X-Tenant': tenant, 'Content-Type': 'application/json', ...extra } }, env);
      const answer = await response.json() as Record<string, unknown>;
      const { publication: _p, ...rest } = answer; void _p;
      return { status: response.status, ...rest };
    };
    const bare = await call(OLD, '/config/reflex/validate', 'POST', document);
    const wrapped = await call(OLD, '/config/reflex/validate', 'POST', { config: document });
    expect(bare, 'W38.B3 — POST /config/reflex/validate accepts the bare document exactly as `{ config }`').toEqual(wrapped);
    expect(bare).toMatchObject({ status: 200, valid: true, config: { version: 'alias-probe', K: 5 } });
    const bareWrite = await call(OLD, '/config/reflex', 'PUT', document, await authored(env, REFLEX_KIND as DocumentKind<unknown>, OLD));
    const wrappedWrite = await call(CURRENT, '/config/reflex', 'PUT', { config: document }, await authored(env, REFLEX_KIND as DocumentKind<unknown>, CURRENT));
    expect(bareWrite, 'W38.B3 — PUT /config/reflex publishes the bare document exactly as `{ config }`').toEqual(wrappedWrite);
    expect(bareWrite).toMatchObject({ status: 200, ok: true, revision: 2, authored: { K: 5 } });
  });
});

// ===========================================================================
// unit:W38.B4 — with no purge policy set, nothing is purged
// ===========================================================================

describe('unit:W38.B4', () => {
  /**
   * The clause every policy leaves standing (decision D2, HANDOFF §7 Retention:
   * existing revisions are never deleted automatically). The purge mechanism's
   * other clauses are not specified here: the report names what the witness
   * leaves undetermined.
   */
  it('B4: with no purge policy set, no product path deletes a revision — 55 publications past the 50-row index, a rollback and serving reads leave every revision body readable', async () => {
    const TENANT = 'coach', env = operatorEnv([TENANT], { ops: [TENANT] }), app = mounted();
    await initialize(env, TENANT);
    const bearer = await token({ sub: 'ops', type: 'service' });
    const written = new Map<number, string[]>([[1, []]]);
    for (let n = 2; n <= 56; n++) {
      const ids = [`cnt_${n}_a`, `cnt_${n}_b`];
      const document = { version: `catalog-${n}`, pieces: ids.map((id, i) => ({ id, customerContentId: `CCH-${n}-${i}`, type: 'editorial', title: id,
        tags: { line: [i ? 'Willow' : 'Tabby'], occasion: ['everyday'] }, slotTypes: ['story'], lifecycle: { status: 'live' } })) };
      const response = await app.request(H + '/content/catalog', { method: 'PUT', body: JSON.stringify({ document, note: `publication ${n}` }),
        headers: { Authorization: `Bearer ${bearer}`, 'X-Tenant': TENANT, 'Content-Type': 'application/json', ...await authored(env, CONTENT_KIND as DocumentKind<unknown>, TENANT) } }, env);
      expect(response.status, `publication ${n}`).toBe(200); written.set(n, ids);
      await readRevision(env, CONTENT_KIND, TENANT);
    }
    const rollback = await app.request(H + '/content/catalog/rollback/3', { method: 'POST', body: '{}',
      headers: { Authorization: `Bearer ${bearer}`, 'X-Tenant': TENANT, 'Content-Type': 'application/json', ...await authored(env, CONTENT_KIND as DocumentKind<unknown>, TENANT) } }, env);
    expect(rollback.status, 'rollback to revision 3').toBe(200); written.set(57, written.get(3)!);
    await readRevision(env, CONTENT_KIND, TENANT);
    const unreadable: number[] = [];
    for (const [n, ids] of written) {
      const response = await app.request(H + `/content/catalog/revisions/${n}`, { headers: { Authorization: `Bearer ${bearer}`, 'X-Tenant': TENANT } }, env);
      const body = response.status === 200 ? await response.json() as { value?: ContentCatalog } : null;
      if (JSON.stringify(body?.value?.pieces.map(p => p.id)) !== JSON.stringify(ids)) unreadable.push(n);
    }
    expect({ deleted: r2Of(env).deletes, unreadable }, 'W38.B4 — with no purge policy configured nothing is purged: no stored object is deleted and all 57 catalog revisions still read (decision D2)').toEqual({ deleted: [], unreadable: [] });
  });
});

// ===========================================================================
// unit:W38.B5 — the whole read, validate and compose path, measured
// ===========================================================================

describe('unit:W38.B5', () => {
  /**
   * A measurement, not a race: nothing here compares a duration with a
   * threshold (qualifying the numbers against an accepted workload is LIVE2).
   * What it asserts is that what was timed IS the whole path — the published
   * catalog read from storage, parsed and validated on a cold isolate, then the
   * shopper, trend, lift and compose stages — on realistic shapes, alone and
   * concurrently, and that concurrency changes no decision. The emitted
   * `W38.B5 measurement` lines are the numbers the kit publishes.
   */
  const TENANT = 'coach';
  const shipped = JSON.parse(readFileSync(new URL('public/data/coach-content.json', ROOT), 'utf8')) as ContentCatalog;
  /** The slot document the Coach seed publishes for this catalog (scripts/seed-coach-content.mjs). */
  const merch = shipped.pieces.find(p => p.slotTypes.includes('merch') && p.customerContentId === 'CCH-026')!;
  const coachSlots: SlotCatalog = { version: 'slots-coach', pages: { home: [
    { slot: 'merch', take: 1, weights: {}, pinnedPieceId: merch.id },
    { slot: 'chero', take: 1, weights: { line: 0.35, occasion: 0.25, priceBand: 0.15, contentType: 0.15, category: 0.1 } },
    { slot: 'story', take: 2, weights: { occasion: 0.3, category: 0.25, contentType: 0.25, priceBand: 0.2 } },
    { slot: 'carousel', take: 5, weights: { line: 0.3, occasion: 0.3, category: 0.2, contentType: 0.2 } },
  ] } } as SlotCatalog;
  /**
   * The shipped pieces, repeated under new ids, with the cross-category and the
   * unknown-dimension rows a customer feed carries: every 7th piece merges two
   * shipped pieces' tags, every 11th adds a dimension the registry does not know.
   */
  function corpus(count: number): ContentCatalog {
    const pieces = Array.from({ length: count }, (_, i) => {
      const source = shipped.pieces[i % shipped.pieces.length]!, round = Math.floor(i / shipped.pieces.length);
      if (round === 0) return source;
      const other = shipped.pieces[(i * 5 + 3) % shipped.pieces.length]!;
      const tags: Record<string, string[]> = Object.fromEntries(Object.entries(source.tags).map(([dim, values]) => [dim, [...values]]));
      if (i % 7 === 0) for (const [dim, values] of Object.entries(other.tags)) tags[dim] = [...new Set([...(tags[dim] ?? []), ...values])];
      if (i % 11 === 0) tags.material = ['pebbled leather'];
      return { ...source, id: `${source.id}_r${round}`, customerContentId: `${source.customerContentId}-R${round}`, tags };
    });
    return { version: `coach-content-${count}`, pieces } as ContentCatalog;
  }
  /** The largest realistic catalog one 2 MiB publication member admits (kit 02 §4). */
  const admissible = (() => { let n = 26; while (bytesOf(JSON.stringify(corpus(n + 100))) < 1.9 * MiB) n += 100; return n; })();
  const SHAPES = [shipped.pieces.length, 500, admissible];
  const CONCURRENCY = [1, 8, 32];
  const affinity = { dims: { line: { Tabby: 0.7, Willow: 0.4 }, occasion: { everyday: 0.6, evening: 0.3 }, category: { Handbags: 0.5 }, contentType: { campaign: 0.4, editorial: 0.3 }, priceBand: { premium: 0.5 } }, audiences: [] };

  async function environment(catalog: ContentCatalog) {
    const learn: LearnConfig = { holdout: { share: 0, salt: '', arms: ['default'] } } as LearnConfig;
    /** The shopper's explicit choice, as the owner holds it (src/content/consent.test.ts fixture shape). */
    const now = Date.now(), instruction = (subject: string) => ({ tracking: true, personalization: true, instruction: { version: 1 as const, tenant: TENANT, subject, revision: 'w38-choice',
      tracking: { value: true, chosenAt: now, expiresAt: now + CONSENT_LIFETIME_MS }, personalization: { value: true, chosenAt: now, expiresAt: now + CONSENT_LIFETIME_MS } } });
    const visitorOf = new Map<string, string>();
    const namespace = (reply: (name: string) => unknown) => ({ idFromName: (name: string) => name,
      get: (id: string) => ({ fetch: async () => Response.json(reply(id)) }) });
    const env = { CACHE: new LedgerKV(), STORAGE: new LedgerR2(), REFLEX_HOST: 'do', ENVIRONMENT: 'test',
      JWT_SECRET: SECRET, JWT_ISSUER: 'i', JWT_AUDIENCE: 'a', TENANTS: JSON.stringify({ provisioned: [TENANT] }),
      EVENT_QUEUE: { send: async () => undefined, sendBatch: async () => undefined },
      DECISION_RING: namespace(() => ({ ok: true, ring: [] })), LEARN_STATS: namespace(() => ({ ok: true })),
      // The shopper's own object answers her projection and her explicit choice.
      SHOPPER_REFLEX: namespace(name => ({ ok: true, affinity, journeyStage: 'mid', consent: instruction(visitorOf.get(name) ?? name) })),
      RETENTION: JSON.stringify({ version: 1, tenants: { [TENANT]: Object.fromEntries(['profile', 'identity', 'ledger', 'online', 'hourly', 'recovery'].map(category => [category,
        { id: 'w38-measurement-' + category, revision: 1, durationMs: 365 * 86_400_000, basis: 'admitted', renewal: 'new-record-only' }])) } }),
    } as unknown as Env;
    await initialize(env, TENANT, { content: catalog, slots: coachSlots, learn });
    return { env, instruction: (visitor: string) => { visitorOf.set(shopperObjectName(TENANT, visitor), visitor); return instruction(visitor); } };
  }
  async function serve(env: Env, instruction: (subject: string) => unknown, visitor: string, nowMs: number) {
    const choice = instruction(visitor);
    const principal = await issueSessionCapability(env, { tenant: TENANT, subject: visitor, sessionId: `s-${visitor}`, kind: 'anonymous' });
    const owner = {}; let ms = 0;
    const result = await runOwnerOperation(owner, env, async () => {
      admitOwnerPrincipal(owner, principal);
      const started = performance.now();
      const served = await serveContentDecisions(env, { tenant: TENANT, page: 'home', visitorId: visitor, sessionId: `s-${visitor}`, channel: 'direct',
        cf: null, cookieHeader: null, stateTenant: TENANT, principal, capability: principal.capability, nowMs });
      ms = performance.now() - started;
      void served.afterResponse.catch(() => undefined);
      return served;
    }, undefined, undefined, async () => choice as never);
    return { ms, result };
  }
  const quantile = (values: number[], q: number) => { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!; };
  const STAGES = ['documents', 'shopper', 'trend', 'lift', 'decide'];
  const TAKES = coachSlots.pages.home!.reduce((sum, slot) => sum + slot.take, 0);

  it('B5: the whole read, validate and compose path is measured on the shipped Coach shape and on larger realistic catalogs, alone and concurrently, cold and warm, and concurrency changes no decision', async () => {
    const report: unknown[] = [];
    for (const size of SHAPES) {
      const catalog = corpus(size), { env, instruction } = await environment(catalog), nowMs = Date.now();
      invalidateCache(); invalidateLiftCache();
      const alone = await serve(env, instruction, `vis-${crypto.randomUUID()}`, nowMs);
      const reference = alone.result.decisions.map(d => [d.slot, d.contentId, d.score]);
      expect(reference, `W38.B5 — the ${size}-piece catalog is composed into every slot of the page`).toHaveLength(TAKES);
      for (const concurrency of CONCURRENCY) {
        for (const phase of ['cold', 'warm'] as const) {
          if (phase === 'cold') { invalidateCache(); invalidateLiftCache(); }
          const visitors = Array.from({ length: concurrency }, () => `vis-${crypto.randomUUID()}`);
          const runs = await Promise.all(visitors.map(visitor => serve(env, instruction, visitor, nowMs)));
          for (const { result } of runs) {
            expect(result.sources.catalog.pieces, `W38.B5 — each measured decision read and validated the whole ${size}-piece catalog`).toBe(size);
            expect(STAGES.every(stage => Number.isFinite(result.sources.timings[stage]) && result.sources.timings[stage]! >= 0),
              `W38.B5 — each measured decision times every stage of the path: ${JSON.stringify(result.sources.timings)}`).toBe(true);
            expect(result.decisions.map(d => [d.slot, d.contentId, d.score]), `W38.B5 — ${concurrency} concurrent ${phase} decisions over ${size} pieces serve what one decision alone serves`).toEqual(reference);
          }
          const wall = runs.map(run => run.ms);
          const entry = { pieces: size, catalog_bytes: bytesOf(JSON.stringify(catalog)), concurrency, phase, samples: wall.length,
            wall_ms: { p50: quantile(wall, 0.5), p95: quantile(wall, 0.95), max: Math.max(...wall) },
            stage_ms_p50: Object.fromEntries(STAGES.map(stage => [stage, quantile(runs.map(run => run.result.sources.timings[stage]!), 0.5)])) };
          report.push(entry);
          console.log('W38.B5 measurement', JSON.stringify(entry));
        }
      }
    }
    expect(report, 'W38.B5 — every shape is measured at every concurrency, cold and warm').toHaveLength(SHAPES.length * CONCURRENCY.length * 2);
  }, 120_000);
});

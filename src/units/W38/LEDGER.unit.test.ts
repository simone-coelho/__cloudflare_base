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
//   · Decision D3 (the owner's approval of the step-3 amendments, 2026-09-24, row
//     A35): "Purge by policy is a per-category retention setting for configuration
//     revisions in the existing retention registry, the form of the settled D06-W06
//     retention decision; unset means nothing is purged." The registry is
//     src/retention.ts (`RETENTION`: { version:1, tenants:{ <tenant>:{ <category>:
//     { id, revision, durationMs, basis, renewal } } } }).
//   · The stored replay manifest: the decision record the ledger holds (kit 02
//     §replay; src/learn/replay.ts). It names the configuration revisions a replay
//     reads — `versions.catalog/slots/learn` — and, in its page replay manifest
//     `inputs.replay.slots[]`, the priors revision (`prior`, the `prior` kind's
//     revision a lift snapshot was built with: src/durable-objects/LearnStats.ts:891).
//   · B7 (amendment A36): src/learn/fan.ts `currentLiftWitness` races the health
//     probe against 50 ms, and the probe digests the whole snapshot inside that race
//     (`recoveryDigest(snapshot)`); the statistics object caps a snapshot at 4096
//     counters over 256 items and 2 MiB (LEARN_LIMITS, src/durable-objects/LearnStats.ts:25).
//
// CRITERIA SPECIFIED HERE: B1, B2 (the consuming routes W38.04 does not cover),
// B3, B4 (both clauses), B5, B7.
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
//   · B4 (decision D3): the registry category is `configuration` — one setting
//     for every configuration revision kind of the tenant, an ordinary
//     RetentionPolicy. It is OPTIONAL: a registry without it is valid and purges
//     nothing, so it is accepted by the registry parser without joining
//     RETENTION_CATEGORIES (src/ops/monitor.ts:416 requires every member of that
//     list; monitor.ts is outside W38's allowedPaths).
//     The purge runs inside a configuration publication (after it commits): the
//     publication is the only writer of configuration revisions within W38's
//     allowedPaths (a scheduled sweep would need src/index.ts). The fixture
//     publishes every kind it measures last, so a purge scoped to the published
//     kind and one over the whole scope land in the same state.
//     "Older than it": the fixture is built so that the age of every revision
//     — counted from its publication or from its supersession — falls on the same
//     side of the setting; the test does not rule between the two.
//     "Purged": no stored object holds that revision's document any longer.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import type { Env } from '@/types/env';
import { memoryStore } from '@/auth/store';
import { INPUT_MAX_BYTES } from '@/config/input';
import { carriedSaltVersion, initializePublicationSet, readPublication, type PublicationBaseline } from '@/config/publication';
import { invalidateCache, readRevision, readVersion, type DocumentKind } from '@/config/versionedStore';
import { retentionConfiguration, type RetentionPolicy } from '@/retention';
import { enqueueDecisions } from '@/ledger/enqueue';
import { consumeLedger } from '@/ledger/consume';
import { recoveryDigest } from '@/ledger/recovery';
import { decisionRoutes } from '@/routes/decisions';
import { levelKeys } from '@/learn/stats';
import { CONTENT_KIND, DEFAULT_LEARN, DEFAULT_SLOTS, EMPTY_CATALOG, LEARN_KIND, SLOTS_KIND } from '@/content/kinds';
import type { ContentCatalog, LearnConfig, SlotCatalog } from '@/content/types';
import { CONSENT_LIFETIME_MS } from '@/content/consent';
import { invalidateLiftCache, readLift, serveContentDecisions, slotLearnConfigOf } from '@/content/service';
// RULED EXPORT (B1). Absent at the base revision: B1 is RED on it.
import { LIFT_CACHE_MAX_BYTES } from '@/content/service';
import { issueSessionCapability } from '@/identity/sessionCapability';
import { admitOwnerPrincipal, runOwnerOperation } from '@/identity/sessionAuthority';
import { EMPTY_PROPOSALS, PROPOSALS_KIND } from '@/learn/cycle';
import { liftArchiveKey, liftKey } from '@/learn/fan';
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
      : condition && (('etagMatches' in condition && condition.etagMatches !== this.etags.get(key))
        || ('etagDoesNotMatch' in condition && condition.etagDoesNotMatch === '*' && exists))) return null;
    this.objects.set(key, raw); this.etags.set(key, 'w38-' + (++this.seq));
    return { key, etag: this.etags.get(key)!, size: bytesOf(raw) };
  }
  /** Recorded AND performed, so a deletion is visible both ways. */
  async delete(keys: string | string[]) { for (const key of [keys].flat()) { this.deletes.push(key); this.objects.delete(key); this.etags.delete(key); } }
  /** R2's own listing: prefix, startAfter, delimiter (rolled-up prefixes), limit and an opaque cursor. */
  async list(options?: { prefix?: string; startAfter?: string; delimiter?: string; limit?: number; cursor?: string }) {
    const prefix = options?.prefix ?? '', delimiter = options?.delimiter;
    const keys = [...this.objects.keys()].filter(key => key.startsWith(prefix) && (options?.startAfter === undefined || key > options.startAfter)).sort();
    const entries: Array<{ key: string } | { prefix: string }> = [];
    for (const key of keys) {
      const cut = delimiter ? key.indexOf(delimiter, prefix.length) : -1;
      if (cut < 0) { entries.push({ key }); continue; }
      const rolled = key.slice(0, cut + delimiter!.length);
      if (!entries.some(entry => 'prefix' in entry && entry.prefix === rolled)) entries.push({ prefix: rolled });
    }
    const start = Number(options?.cursor ?? 0), end = start + Math.min(options?.limit ?? 1000, 1000), page = entries.slice(start, end);
    return { objects: page.filter((entry): entry is { key: string } => 'key' in entry).map(({ key }) => ({ key, size: bytesOf(this.objects.get(key)!), etag: this.etags.get(key)!, uploaded: new Date(0) })),
      delimitedPrefixes: page.filter((entry): entry is { prefix: string } => 'prefix' in entry).map(entry => entry.prefix),
      truncated: end < entries.length, ...(end < entries.length ? { cursor: String(end) } : {}) };
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

/** Three shoppers' cells as the decision path writes them (src/learn/stats.ts levelKeys). */
const CELLS = [
  { channel: 'direct', visit_bucket: '1', stage: 'mid', region: 'US-NY', affinity: 'occasion:evening' },
  { channel: 'search', visit_bucket: '2-3', stage: 'early', region: 'US-CA', affinity: 'line:Tabby' },
  { channel: 'email', visit_bucket: '4+', stage: 'late', region: 'GB-LND', affinity: 'category:Small Leather Goods' },
] as const;
/**
 * A published lift snapshot in the shape the statistics object publishes
 * (src/learn/stats.ts buildSnapshot): per item, one estimate per level key of
 * each observed cell, with the prior it was shrunk toward.
 */
function liftSnapshotOf(tenant: string, slot: string, version: number, items: string[], cells: ReadonlyArray<(typeof CELLS)[number]>, priorVersion = 0): LiftSnapshot {
  const snapshot = { tenant, brand: tenant, slot, reward: 'click', objective: 'unit', measurementBasis: 'served-v1',
    tauLearnMs: DEFAULT_STATS.tauLearnMs, n0: DEFAULT_STATS.n0, nMin: DEFAULT_STATS.nMin, liftMin: DEFAULT_STATS.liftMin, liftMax: DEFAULT_STATS.liftMax,
    version, publishedAt: version, events: 40_000, witness: 'c'.repeat(64), priorVersion, items: {} as LiftSnapshot['items'],
    slotRates: { '*': { n: 40_000, s: 2_400, rate: 0.06 } } } as unknown as LiftSnapshot;
  items.forEach((item, i) => {
    const levels: Record<string, unknown> = {};
    for (const cell of cells) levelKeys(cell as never).forEach((key, level) => {
      levels[key] = { level, key, n: 40 + (i + level) % 90, s: 3 + (i * 7 + level) % 11, p0: 0.06, p_hat: 0.06 + ((i + level) % 9) / 300,
        lift: 0.9 + ((i * 3 + level) % 13) / 20, n0: DEFAULT_STATS.n0, prior: { p: 0.058, n: 12 } };
    });
    snapshot.items[item] = levels as LiftSnapshot['items'][string];
  });
  return snapshot;
}

beforeEach(() => { invalidateCache(); invalidateLiftCache(); });
afterEach(() => { vi.useRealTimers(); invalidateCache(); invalidateLiftCache(); });

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
// unit:W38.B4 — needed revisions retained; the rest purged only under the
// configuration-revision retention setting, and nothing purged while it is unset
// ===========================================================================

describe('unit:W38.B4', () => {
  /**
   * The unset clause (decisions D2 and D3, HANDOFF §7 Retention: existing
   * revisions are never deleted automatically; unset means nothing is purged),
   * with no retention registry configured at all.
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

  /**
   * The set clause, and the unset clause with a registry that names every other
   * category. Two tenants share one store and one timeline shape:
   *   · `coach` sets `configuration` to 30 days (every other category 365 days);
   *   · `atelier` sets every other category and not `configuration`.
   * Each serves one page that the ledger stores — the stored replay manifest —
   * and at day 100 publishes each kind it measures once more.
   *
   *   coach   content  1·init  2·d1  3·d2  4·d3  5·d5            6·d100   page at d1 12:00 names content 2,
   *           learn    1·init  2·d1              3·d85  4·d90   5·d100            slots 1, learn 2
   *           prior    1·init  2·d1  3·d2  4·d3  5·d5            6·d100            and (manifest) prior 2
   *   atelier content  1·init  2·d1  3·d2  4·d3                  5·d100   page at d2 12:00 names content 3,
   *           learn    1·init  2·d1                              3·d100            slots 1, learn 2, prior 1
   *
   * Expected for coach at day 100: current and previous of each kind stay
   * (content 6·5, learn 5·4, prior 6·5, slots/reflex/proposals 1); what the
   * stored page names stays (content 2, learn 2, prior 2, slots 1); learn 3 is
   * 15 days old and stays; content 1·3·4, learn 1 and prior 1·3·4 are older than
   * 30 days by publication and by supersession alike, and are purged. atelier's
   * page naming ITS content 3 does not keep coach's content 3. atelier keeps
   * everything.
   */
  it('B4: set, the configuration-revision retention setting purges only revisions older than it that are not the current or the previous published revision of their kind or named by a stored replay manifest; unset, a registry purges nothing', async () => {
    const DAY = 86_400_000, D0 = Date.UTC(2026, 5, 1), at = (day: number, hours = 0) => D0 + day * DAY + hours * 3_600_000;
    const A = 'coach', B = 'atelier';
    const policy = (id: string, days: number): RetentionPolicy => ({ id, revision: 1, durationMs: days * DAY, basis: 'occurred', renewal: 'new-record-only' });
    const CONFIGURATION = policy('w38-b4-configuration-revisions', 30);
    const data = Object.fromEntries(['profile', 'identity', 'ledger', 'online', 'hourly', 'recovery'].map(category => [category, policy('w38-b4-' + category, 365)]));
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(at(0));

    // ── the store, the tenants' registry and the owners the decision path calls ──
    const storage = new LedgerR2(), queued: unknown[] = [], visitorOf = new Map<string, string>();
    const health = new Map<string, { witness: string; version: number; digest: string }>();
    const instruction = (tenant: string, subject: string) => ({ tracking: true, personalization: true, instruction: { version: 1 as const, tenant, subject, revision: 'w38-b4-choice',
      tracking: { value: true, chosenAt: Date.now(), expiresAt: Date.now() + CONSENT_LIFETIME_MS }, personalization: { value: true, chosenAt: Date.now(), expiresAt: Date.now() + CONSENT_LIFETIME_MS } } });
    const env = { CACHE: new LedgerKV(), STORAGE: storage, REFLEX_HOST: 'do', ENVIRONMENT: 'test',
      JWT_SECRET: SECRET, JWT_ISSUER: 'i', JWT_AUDIENCE: 'a', TENANTS: JSON.stringify({ provisioned: [A, B], operatorGrants: { ops: [A, B] } }),
      RETENTION: JSON.stringify({ version: 1, tenants: { [A]: { ...data, configuration: CONFIGURATION }, [B]: data } }),
      EVENT_QUEUE: { send: async (body: unknown) => { queued.push(body); }, sendBatch: async (messages: Array<{ body: unknown }>) => { for (const m of messages) queued.push(m.body); } },
      DECISION_RING: { idFromName: (name: string) => name, get: () => ({ fetch: async () => Response.json({ ok: true, ring: [] }) }) },
      // The statistics owner: its health answer names the snapshot it last published (src/durable-objects/LearnStats.ts:1024).
      LEARN_STATS: { idFromName: (name: string) => name, get: (name: string) => ({ fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init), path = new URL(request.url).pathname;
        if (path !== '/health') return Response.json({ ok: true });
        const body = await request.json() as { tenant: string; brand: string; slot: string }, published = health.get(name);
        return Response.json({ ok: true, tenant: body.tenant, brand: body.brand, slot: body.slot, state: published ? 'healthy' : 'empty', generation: 0,
          digest: 'd'.repeat(64), bytes: 0, publication: published ?? null, witness: published?.witness ?? null });
      } }) },
      SHOPPER_REFLEX: { idFromName: (name: string) => name, get: (name: string) => ({ fetch: async () => {
        const [tenant, subject] = visitorOf.get(name)!.split('\u0000') as [string, string];
        return Response.json({ ok: true, affinity: { dims: { line: { Tabby: 0.8 }, occasion: { evening: 0.7, everyday: 0.2 }, category: { Handbags: 0.5 } }, audiences: [] },
          journeyStage: 'mid', consent: instruction(tenant, subject) });
      } }) },
    } as unknown as Env;
    const app = new Hono<{ Bindings: Env; Variables: { tenant: string } }>();
    app.use('*', tenantMiddleware()); app.route('/content', contentRoutes); app.route('/v1', decisionRoutes);
    const bearer = () => token({ sub: 'ops', type: 'service', roles: ['admin'] });

    // ── the customer's documents: Coach taxonomy, a cross-category piece and an unknown dimension ──
    const catalogOf = (tenant: string, n: number) => ({ version: `catalog-${tenant}-${n}`, pieces: [
      { id: 'cnt_tabby', customerContentId: 'CCH-101', type: 'campaign', title: `The Tabby (${tenant} catalog revision ${n})`,
        tags: { line: ['Tabby'], occasion: [n % 2 ? 'evening' : 'everyday'], category: ['Handbags'], contentType: ['campaign'] }, slotTypes: ['chero', 'story'], lifecycle: { status: 'live' } },
      { id: 'cnt_charms', customerContentId: 'CCH-102', type: 'editorial', title: `Charms for every bag (${tenant} catalog revision ${n})`,
        tags: { occasion: ['evening'], category: ['Small Leather Goods', 'Handbags'], contentType: ['editorial'] }, slotTypes: ['chero', 'story'], lifecycle: { status: 'live' } },
      { id: 'cnt_unknown', customerContentId: 'CCH-103', type: 'editorial', title: `A feed row the registry does not know (${tenant} catalog revision ${n})`,
        tags: { material: ['pebbled leather'], occasion: ['wombat-unrecognized'] }, slotTypes: ['story'], lifecycle: { status: 'live' } },
    ] } as unknown as ContentCatalog);
    const PAGE = { version: 'slots-w38-b4', pages: { home: [{ slot: 'chero', take: 1, weights: { line: 0.5, occasion: 0.5 } }, { slot: 'story', take: 1, weights: { occasion: 0.6, category: 0.4 } }] } } as unknown as SlotCatalog;
    const learnOf = (n: number) => ({ holdout: { share: 0, salt: 'w38-b4', arms: ['default'] }, regional: { enabled: false, kBlend: 1, minEvents: 30 + n }, stats: DEFAULT_STATS,
      slots: { chero: { reward: 'click', objective: 'unit', gamma: 1 }, story: { reward: 'click', objective: 'unit', gamma: 0 } } } as unknown as LearnConfig);

    const publish = async (day: number, tenant: string, route: 'catalog' | 'learn' | 'priors', kind: DocumentKind<unknown>, document: unknown) => {
      vi.setSystemTime(at(day)); invalidateCache();
      const response = await app.request(H + '/content/' + route, { method: 'PUT', body: JSON.stringify({ document, note: `${route} on day ${day}` }),
        headers: { Authorization: `Bearer ${await bearer()}`, 'X-Tenant': tenant, 'Content-Type': 'application/json', ...await authored(env, kind, tenant) } }, env);
      expect(response.status, `${tenant} publishes ${route} on day ${day}: ${await response.clone().text()}`).toBe(200);
    };
    /**
     * One page served by the decision path, enqueued by its producer and written
     * by the ledger consumer inside the shopper's owner invocation — where the
     * consumer's forward to the shopper's object executes it.
     */
    const storePage = async (tenant: string, day: number, hours: number, priorVersion: number) => {
      vi.setSystemTime(at(day, hours)); invalidateCache(); invalidateLiftCache();
      const version = at(day, hours) - 60_000, raw = JSON.stringify(liftSnapshotOf(tenant, 'chero', version, ['cnt_tabby', 'cnt_charms'], CELLS.slice(0, 1), priorVersion));
      (env.CACHE as unknown as LedgerKV).store.set(liftKey(tenant, tenant, 'chero'), raw);
      await storage.put(liftArchiveKey(tenant, tenant, 'chero', version), raw);
      health.set(`${tenant}:${tenant}:chero`, { witness: 'c'.repeat(64), version, digest: await recoveryDigest(JSON.parse(raw)) });
      const visitor = `vis-00000000-0000-4000-8000-${tenant === A ? '00000000000a' : '00000000000b'}`; visitorOf.set(shopperObjectName(tenant, visitor), `${tenant}\u0000${visitor}`);
      const principal = await issueSessionCapability(env, { tenant, subject: visitor, sessionId: `s-${visitor}`, kind: 'anonymous' });
      const owner = {};
      const records = await runOwnerOperation(owner, env, async () => {
        admitOwnerPrincipal(owner, principal);
        const served = await serveContentDecisions(env, { tenant, page: 'home', visitorId: visitor, sessionId: `s-${visitor}`, channel: 'direct',
          cf: null, cookieHeader: null, stateTenant: tenant, principal, capability: principal.capability, nowMs: at(day, hours) });
        await served.afterResponse.catch(() => undefined);
        expect(await enqueueDecisions(env, served.records), `${tenant}'s page is enqueued`).toMatchObject({ code: 'accepted', records: { acknowledged: served.records.length } });
        expect(await consumeLedger(env, queued.splice(0), at(day, hours)), `the ledger consumer stores ${tenant}'s page`).toMatchObject({ ok: true, written: served.records.length });
        return served.records;
      }, undefined, undefined, async () => instruction(tenant, visitor) as never);
      const chero = records.find(record => record.slot === 'chero')!;
      return { id: chero.decision_id, names: { ...chero.versions, manifest: chero.inputs?.replay?.slots }, version };
    };
    const replay = async (tenant: string, id: string) => {
      const response = await app.request(`${H}/v1/${tenant}/replay/${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${await bearer()}`, 'X-Tenant': tenant } }, env);
      const body = await response.json() as { ok?: boolean; equal?: boolean; reason?: string };
      return { status: response.status, ok: body.ok, equal: body.equal, reason: body.reason ?? null };
    };
    /** Every revision of every kind of a tenant: purged (no stored object holds its document), retained (held and read back), or held but unreadable. */
    const ledger = async (tenant: string) => {
      invalidateCache();
      const stored = [...storage.objects.values()].flatMap(raw => { try { return [JSON.parse(raw) as Record<string, unknown>]; } catch { return []; } });
      const out: Record<string, { purged: number[]; retained: number[]; unreadable: number[] }> = {};
      for (const kind of KINDS) {
        const scope = scopeFor(kind, tenant), current = (await readPublication(env, kind, scope)).revision, row = { purged: [] as number[], retained: [] as number[], unreadable: [] as number[] };
        for (let n = 1; n <= current; n++) {
          if (!stored.some(o => o.kind === kind.name && o.scope === scope && o.revision === n && Object.hasOwn(o, 'value'))) { row.purged.push(n); continue; }
          const read = await readVersion(env, kind, scope, n).then(revision => revision?.revision === n, () => false);
          (read ? row.retained : row.unreadable).push(n);
        }
        out[kind.name] = row;
      }
      return out;
    };
    const kept = (...retained: number[]) => ({ purged: [], retained, unreadable: [] });

    // The registry holds the setting — the category D3 adds, beside the six it already has.
    const registered = (() => { try { return (retentionConfiguration(env)[A] as Record<string, unknown> | undefined)?.['configuration'] ?? null; } catch (error) { return `refused: ${(error as Error).message}`; } })();
    expect(registered, 'W38.B4 — the existing retention registry (src/retention.ts) admits the per-category retention setting for configuration revisions, `configuration`, beside the categories it already has (decision D3)').toEqual(CONFIGURATION);

    // ── the timeline ──
    for (const tenant of [A, B]) await initialize(env, tenant, { content: catalogOf(tenant, 1), slots: PAGE, learn: learnOf(1) });
    for (const tenant of [A, B]) {
      await publish(1, tenant, 'catalog', CONTENT_KIND as DocumentKind<unknown>, catalogOf(tenant, 2));
      await publish(1, tenant, 'learn', LEARN_KIND as DocumentKind<unknown>, learnOf(2));
    }
    await publish(1, A, 'priors', PRIORS_KIND as DocumentKind<unknown>, EMPTY_PRIORS);
    const pageA = await storePage(A, 1, 12, 2);
    for (const day of [2, 3]) { await publish(day, A, 'catalog', CONTENT_KIND as DocumentKind<unknown>, catalogOf(A, day + 1)); await publish(day, A, 'priors', PRIORS_KIND as DocumentKind<unknown>, EMPTY_PRIORS); }
    await publish(2, B, 'catalog', CONTENT_KIND as DocumentKind<unknown>, catalogOf(B, 3));
    const pageB = await storePage(B, 2, 12, 1);
    await publish(3, B, 'catalog', CONTENT_KIND as DocumentKind<unknown>, catalogOf(B, 4));
    await publish(5, A, 'catalog', CONTENT_KIND as DocumentKind<unknown>, catalogOf(A, 5)); await publish(5, A, 'priors', PRIORS_KIND as DocumentKind<unknown>, EMPTY_PRIORS);
    await publish(85, A, 'learn', LEARN_KIND as DocumentKind<unknown>, learnOf(3));
    await publish(90, A, 'learn', LEARN_KIND as DocumentKind<unknown>, learnOf(4));

    // The stored pages name what the diagram says, and replay before the last publications.
    expect(pageA.names, 'the page coach stored names content 2, slots 1, learn 2 and, in its page replay manifest, prior 2')
      .toMatchObject({ catalog: 2, slots: 1, learn: 2, prior: 2, lift: pageA.version, manifest: expect.arrayContaining([{ slot: 'chero', lift: pageA.version, prior: 2 }]) });
    expect(pageB.names, 'the page atelier stored names content 3, slots 1, learn 2 and prior 1').toMatchObject({ catalog: 3, slots: 1, learn: 2, prior: 1 });
    vi.setSystemTime(at(99));
    for (const [tenant, page] of [[A, pageA], [B, pageB]] as const) {
      expect(await replay(tenant, page.id), `W38.B4 — ${tenant}'s stored page replays equal on day 99, after the day-85 and day-90 publications and before the day-100 ones`).toEqual({ status: 200, ok: true, equal: true, reason: null });
    }

    // ── day 100: each measured kind is published once more ──
    await publish(100, A, 'catalog', CONTENT_KIND as DocumentKind<unknown>, catalogOf(A, 6));
    await publish(100, A, 'learn', LEARN_KIND as DocumentKind<unknown>, learnOf(5));
    await publish(100, A, 'priors', PRIORS_KIND as DocumentKind<unknown>, EMPTY_PRIORS);
    await publish(100, B, 'catalog', CONTENT_KIND as DocumentKind<unknown>, catalogOf(B, 5));
    await publish(100, B, 'learn', LEARN_KIND as DocumentKind<unknown>, learnOf(3));

    expect(await ledger(A), 'W38.B4 — under coach\'s 30-day configuration setting exactly the revisions older than it that are neither current, previous nor named by a stored replay manifest are purged: content 1·3·4, learn 1, prior 1·3·4 (atelier\'s page naming ITS content 3 keeps none of coach\'s); content 2·5·6, learn 2·3·4·5, prior 2·5·6 and the current slots, reflex and proposals stay readable')
      .toEqual({ content: { purged: [1, 3, 4], retained: [2, 5, 6], unreadable: [] }, slots: kept(1), learn: { purged: [1], retained: [2, 3, 4, 5], unreadable: [] },
        reflex: kept(1), prior: { purged: [1, 3, 4], retained: [2, 5, 6], unreadable: [] }, proposals: kept(1) });
    // W21 E1.07 (R130): a learn revision carries the salt version its publication derived from the learn history
    // (src/config/publication.ts derivedFor → src/content/holdout.ts saltVersionOf). coach's five learn revisions all
    // carry the salt 'w38-b4', a history well inside the 24-revision horizon, so the count is 1 — purging revision 1
    // must not turn it into the unknown a walk that cannot reach revision 1 answers (src/units/W21/B2.unit.test.ts:939-942).
    expect(carriedSaltVersion(await readPublication(env, LEARN_KIND, A)), 'W38.B4 — after the purge removed coach\'s learn revision 1, coach\'s current learn revision still carries its W21 salt version: salt w38-b4, version 1 (the only salt coach ever published)')
      .toEqual({ salt: 'w38-b4', version: 1 });
    expect(await replay(A, pageA.id), 'W38.B4 — coach\'s stored page still replays equal after the purge: every revision its manifest names was retained').toEqual({ status: 200, ok: true, equal: true, reason: null });
    expect(await ledger(B), 'W38.B4 — atelier\'s registry has no configuration setting, so nothing of atelier\'s is purged (decision D3: unset means nothing is purged)')
      .toEqual({ content: kept(1, 2, 3, 4, 5), slots: kept(1), learn: kept(1, 2, 3), reflex: kept(1), prior: kept(1), proposals: kept(1) });
    expect(await replay(B, pageB.id), 'atelier\'s stored page still replays equal').toEqual({ status: 200, ok: true, equal: true, reason: null });
  }, 120_000);
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

// ===========================================================================
// unit:W38.B7 — a large lift snapshot is served: its health witness does not
// re-digest the whole snapshot inside its 50 ms budget
// ===========================================================================

describe('unit:W38.B7', () => {
  /**
   * The serving read (`readLift`, which serveContentDecisions runs for every
   * learning slot) answers a snapshot only when `currentLiftWitness`
   * (src/learn/fan.ts:25) confirms it against the statistics object within
   * 50 ms. That budget is the round trip to the object; the witness also
   * digests the whole snapshot inside it (`recoveryDigest(snapshot)`), so a
   * large snapshot is refused whenever its digest plus the round trip outlasts
   * the budget. Measured idle on this machine the digest of the snapshot below
   * takes 11–21 ms; a production round trip and a contended isolate add the
   * rest. The test makes the outcome independent of CPU speed: the SHA-256 of
   * the whole snapshot (at least 64 KiB of input) is held open while the budget
   * expires, and the statistics object answers at once. A witness that does not
   * digest the snapshot inside its budget serves it; one that does, does not.
   *
   * The snapshot is the one the object publishes at its own caps: 256 items and
   * 4096 counters over three shoppers' cells (LEARN_LIMITS), about 680 KB.
   */
  const TENANT = 'coach', SLOT = 'chero';
  const config = slotLearnConfigOf({})('any');
  const ITEMS = Array.from({ length: 256 }, (_, i) => `CCH-${String(i).padStart(4, '0')}`);
  function serving(raw: string, publication: { witness: string; version: number; digest: string }, delayMs = 0) {
    const kv = new LedgerKV(); kv.store.set(liftKey(TENANT, TENANT, SLOT), raw);
    const LEARN_STATS = { idFromName: (name: string) => name, get: () => ({ fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init), body = await request.json() as { tenant: string; brand: string; slot: string };
      if (delayMs) await new Promise(resolve => setTimeout(resolve, delayMs));
      return Response.json({ ok: true, tenant: body.tenant, brand: body.brand, slot: body.slot, state: 'healthy', generation: 0, digest: 'd'.repeat(64), bytes: 0,
        publication, witness: publication.witness });
    } }) };
    const env = { CACHE: kv, LEARN_STATS } as unknown as Env;
    return (now: number) => readLift(env, TENANT, TENANT, SLOT, now, config);
  }
  const published = async (items: string[], cells: ReadonlyArray<(typeof CELLS)[number]>) => {
    const snapshot = liftSnapshotOf(TENANT, SLOT, 1_000, items, cells), raw = JSON.stringify(snapshot);
    return { raw, bytes: bytesOf(raw), counters: items.length * (cells.length * 5 + 1),
      publication: { witness: snapshot.witness!, version: snapshot.version, digest: await recoveryDigest(JSON.parse(raw)) } };
  };
  /**
   * One serving read during which every SHA-256 over at least 64 KiB — the whole
   * snapshot — stays pending until the 50 ms budget has expired. Timers are the
   * only thing faked; the read, the statistics answer and the digest are real.
   */
  async function readWhileTheWholeSnapshotDigestOutlastsTheBudget(read: (now: number) => Promise<LiftSnapshot | null>, now: number) {
    const subtle = crypto.subtle, digest = subtle.digest.bind(subtle), held: Array<() => void> = [];
    const spy = vi.spyOn(subtle, 'digest').mockImplementation(async (algorithm, data) => {
      if ((data as ArrayBufferView | ArrayBuffer).byteLength >= 64 * 1024) await new Promise<void>(release => held.push(release));
      return digest(algorithm, data);
    });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      let settled = false;
      const reading = read(now).finally(() => { settled = true; });
      for (let i = 0; i < 500 && !held.length && !settled; i++) await new Promise(resolve => setImmediate(resolve));
      const digestWasPending = held.length > 0;
      vi.advanceTimersByTime(60);
      while (held.length) held.shift()!();
      return { served: (await reading)?.version ?? null, digestWasPending };
    } finally { vi.useRealTimers(); spy.mockRestore(); }
  }

  it('B7: a snapshot at the statistics object\'s own caps (256 items, 4096 counters) is served by the serving read, cold and from the isolate cache, even while its whole digest outlasts the 50 ms budget', async () => {
    const large = await published(ITEMS, CELLS);
    expect({ counters: large.counters, underServingLimit: large.bytes < 2 * MiB }, 'the fixture is the largest snapshot the object publishes within its counter cap').toEqual({ counters: 4096, underServingLimit: true });
    const read = serving(large.raw, large.publication);
    const cold = await readWhileTheWholeSnapshotDigestOutlastsTheBudget(read, 1_000);
    const warm = await readWhileTheWholeSnapshotDigestOutlastsTheBudget(read, 1_001);
    expect({ cold: cold.served, warm: warm.served },
      `W38.B7 — the ${large.bytes}-byte snapshot is served on a cold read and on a cached read: the health witness does not re-digest the whole snapshot inside its 50 ms budget (src/learn/fan.ts:25; a whole-snapshot digest was pending when the budget expired: cold ${cold.digestWasPending}, cached ${warm.digestWasPending})`)
      .toEqual({ cold: large.publication.version, warm: large.publication.version });
  }, 60_000);

  it('B7: control — the same health answer serves the same snapshot unhindered, and a small snapshot of the same shape', async () => {
    const large = await published(ITEMS, CELLS), small = await published(ITEMS.slice(0, 4), CELLS.slice(0, 1));
    for (const snapshot of [large, small]) {
      invalidateLiftCache();
      const read = serving(snapshot.raw, snapshot.publication);
      expect({ cold: (await read(1_000))?.version ?? null, warm: (await read(1_001))?.version ?? null }, `the ${snapshot.bytes}-byte snapshot is served cold and cached`).toEqual({ cold: 1_000, warm: 1_000 });
    }
  }, 60_000);

  /**
   * R10 (amendment 6, ticket P62; R-P110 decision 1, which raises the witness budget
   * for the edge): this lock keeps its property with its literal replaced. It read "a
   * health answer 200 ms late serves nothing" against the 50 ms literal of
   * `currentLiftWitness` (src/learn/fan.ts:43): the budget plus a margin of 150 ms.
   * The answer is now the budget in force plus that same margin late: the budget is
   * `LIFT_WITNESS_BUDGET_MS`, which P62 exports from src/learn/fan.ts, and until it is
   * exported the 50 ms literal, so the delay is today's 200 ms. Read loosely, so the
   * constant is no type error before it exists.
   */
  const LATE_MARGIN_MS = 150;
  const witnessBudgetInForce = async (): Promise<number> => {
    const fan = await import('@/learn/fan') as unknown as Record<string, unknown>;
    return typeof fan.LIFT_WITNESS_BUDGET_MS === 'number' ? fan.LIFT_WITNESS_BUDGET_MS : 50;
  };

  it('B7: the witness still verifies — a large snapshot whose digest the statistics object does not recognize is not served, and a health answer later than the budget plus the margin serves nothing', async () => {
    const large = await published(ITEMS, CELLS);
    const forged = serving(large.raw, { ...large.publication, digest: 'f'.repeat(64) });
    expect({ cold: (await forged(1_000))?.version ?? null, warm: (await forged(1_001))?.version ?? null },
      'W38.B7 — the digest comparison is kept: a snapshot the object did not publish is refused, cold and cached').toEqual({ cold: null, warm: null });
    invalidateLiftCache();
    const small = await published(ITEMS.slice(0, 4), CELLS.slice(0, 1));
    const budget = await witnessBudgetInForce();
    const late = serving(small.raw, small.publication, budget + LATE_MARGIN_MS);
    expect((await late(1_000))?.version ?? null, `W38.B7 — the witness budget is kept: a health answer ${budget + LATE_MARGIN_MS} ms late (the ${budget} ms budget plus the ${LATE_MARGIN_MS} ms margin) serves nothing`).toBeNull();
  }, 60_000);
});

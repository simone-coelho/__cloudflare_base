// @vitest-environment node
// src/demos/brighthour/surface.test.ts
// ─────────────────────────────────────────────────────────────────────────────
// The multi-surface isolation contract (PizzaHut build spec §3, QVC brief §3).
//
// One worker, two demos, one shared audience store. What is pinned here:
//   • absence of any signal resolves to 'coach' — never anything else;
//   • the coach path still gets the EXACT objects/keys it got before the split;
//   • the audience-generator ping-pong trap is closed (THE regression test:
//     alternating regeneration passes must not archive each other's audiences);
//   • the DO trust gate accepts a foreign-catalog product id on its own surface
//     and still drops a genuinely unknown one;
//   • a Bright Hour visitor posting WITHOUT the coach session cookie resolves
//     its own session — and posting WITH it does not (why the page must use
//     credentials:'omit').
//
// Tests that need the Bright Hour data/config modules are grouped behind
// BH_READY: those files are authored in parallel, and this suite must be green
// on the coach-only tree too (an absent brighthour build can never be allowed
// to look like a coach regression).
// ─────────────────────────────────────────────────────────────────────────────
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SURFACE,
  audgenMarkerFor,
  audienceKeyPrefixFor,
  catalogProductsFor,
  catalogServiceFor,
  reflexConfigFor,
  resolveSurface,
} from '@/demos/registry';
import { DEFAULT_REFLEX_CONFIG, apply, audienceKey, extractTouches } from '@/reflex/core';
import {
  DEFAULT_GENERATOR_CONFIG,
  generateAffinityAudiences,
  hashDef,
  regenerateCatalogAudiences,
} from '@/reflex/audienceGenerator';
import type { AudienceDef } from '@/connectors/types';
import type { AudienceStore } from '@/connectors/AudienceStore';
import { CatalogService } from '@/services/CatalogService';
import { ensureAudiencesSeeded, RealtimeSegmentEngine } from '@/services/RealtimeSegmentEngine';
import { ShopperReflex } from '@/durable-objects/ShopperReflex';
import type { Env } from '@/types/env';

// The brighthour modules are late-bound by design; probe them the same way.
async function tryImport<T>(load: () => Promise<T>): Promise<T | null> {
  try {
    return await load();
  } catch {
    return null;
  }
}
const bhConfigMod = await tryImport(() => import('./reflexConfig'));
const bhCatalogMod = await tryImport(() => import('./catalog'));
const BH_READY = !!bhConfigMod && !!bhCatalogMod;

const t0 = 1_750_000_000_000;

// ── Fakes (same shapes the existing reflex suites use) ───────────────────────

class FakeKV {
  store = new Map<string, string>();
  async get(key: string, type?: string): Promise<any> {
    const v = this.store.get(key);
    if (v === undefined) return null;
    return type === 'json' ? JSON.parse(v) : v;
  }
  async put(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }
  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }
  async list(opts?: { prefix?: string }): Promise<{ keys: Array<{ name: string }> }> {
    const prefix = opts?.prefix ?? '';
    return { keys: [...this.store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })) };
  }
}

class FakeStorage {
  map = new Map<string, unknown>();
  alarm: number | null = null;
  async get(keys: string | string[]): Promise<any> {
    if (Array.isArray(keys)) {
      const out = new Map<string, unknown>();
      for (const k of keys) if (this.map.has(k)) out.set(k, structuredClone(this.map.get(k)));
      return out;
    }
    return structuredClone(this.map.get(keys));
  }
  async put(a: any, b?: any): Promise<void> {
    if (typeof a === 'string') this.map.set(a, structuredClone(b));
    else for (const [k, v] of Object.entries(a)) this.map.set(k, structuredClone(v));
  }
  async deleteAll(): Promise<void> {
    this.map.clear();
    this.alarm = null;
  }
  async setAlarm(t: number | Date): Promise<void> {
    this.alarm = typeof t === 'number' ? t : t.getTime();
  }
}

function fakeEnv(overrides: Record<string, unknown> = {}): Env {
  return {
    CACHE: new FakeKV(),
    SESSIONS: new FakeKV(),
    ENVIRONMENT: 'test',
    CONNECTOR_MODE: 'mock',
    // broadcastUpdate hops through here; a no-op stub keeps the logs clean.
    PERSONALIZATION_WEBSOCKET: {
      idFromName: (n: string) => n,
      get: () => ({ fetch: async () => new Response('{}') }),
    },
    ...overrides,
  } as unknown as Env;
}

function makeDO(env: Env) {
  const storage = new FakeStorage();
  const state = {
    storage,
    acceptWebSocket: () => {},
    getWebSockets: () => [],
  } as unknown as DurableObjectState;
  return { shopper: new ShopperReflex(state, env), storage };
}

async function ingest(shopper: ShopperReflex, event: unknown): Promise<any> {
  const res = await shopper.fetch(
    new Request('https://do/ingest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
    })
  );
  return res.json();
}

/** Tiny in-memory AudienceStore (mirrors audienceGenerator.test.ts's memStore). */
function memStore(initial: AudienceDef[] = []) {
  const map = new Map<string, AudienceDef>(initial.map((d) => [d.key, d]));
  const store: AudienceStore = {
    async listPublished() {
      return [...map.values()].filter((d) => d.status === 'published');
    },
    async publish(def) {
      map.set(def.key, { ...def, status: 'published' });
    },
    async get(key) {
      return map.get(key) ?? null;
    },
    async seed(defs) {
      for (const d of defs) if (!map.has(d.key)) map.set(d.key, { ...d, status: 'published' });
    },
    async archive(key) {
      const d = map.get(key);
      if (d) map.set(key, { ...d, status: 'archived' });
    },
  };
  return { store, map };
}

const statusOf = (map: Map<string, AudienceDef>, key: string) => map.get(key)?.status;

// ── 1. Surface resolution — absence is always coach ──────────────────────────

describe('resolveSurface — absence resolves to coach, never anything else', () => {
  it('defaults to coach on nothing, empties, and unrecognized signals', () => {
    expect(DEFAULT_SURFACE).toBe('coach');
    expect(resolveSurface()).toBe('coach');
    expect(resolveSurface(null)).toBe('coach');
    expect(resolveSurface({})).toBe('coach');
    expect(resolveSurface({ source: '' })).toBe('coach');
    expect(resolveSurface({ source: 'coach-storefront' })).toBe('coach'); // what the retail page posts
    expect(resolveSurface({ source: 'operator' })).toBe('coach');
    expect(resolveSurface({ source: 'demo' })).toBe('coach');
    expect(resolveSurface({ surface: 'nonsense', source: 'demo' })).toBe('coach');
  });

  it('maps the brighthour sources, and an explicit surface field wins', () => {
    expect(resolveSurface({ source: 'brighthour' })).toBe('brighthour');
    expect(resolveSurface({ source: 'live' })).toBe('brighthour');
    expect(resolveSurface({ source: 'brighthour-storefront' })).toBe('brighthour');
    expect(resolveSurface({ surface: '  BrightHour ' })).toBe('brighthour');
    // Explicit beats source in BOTH directions — the client is authoritative.
    expect(resolveSurface({ surface: 'brighthour', source: 'coach-storefront' })).toBe('brighthour');
    expect(resolveSurface({ surface: 'coach', source: 'brighthour' })).toBe('coach');
  });
});

// ── 2. The coach path is untouched ───────────────────────────────────────────

describe('coach resolution — the same objects and keys as before the split', () => {
  it('returns DEFAULT_REFLEX_CONFIG BY IDENTITY, the existing marker, and no key prefix', async () => {
    expect(await reflexConfigFor('coach')).toBe(DEFAULT_REFLEX_CONFIG); // identity, not equality
    expect(audgenMarkerFor('coach')).toBe('reflex:audgen:v1'); // the PRE-EXISTING KV key
    expect(audienceKeyPrefixFor('coach')).toBe('');
  });

  it('serves the bundled coach catalog, memoized (the O(N²) precompute runs once)', async () => {
    const products = await catalogProductsFor('coach');
    const direct = new CatalogService().getAllProducts();
    expect(products.map((p) => p.id)).toEqual(direct.map((p) => p.id)); // same set, same order
    expect(await catalogServiceFor('coach')).toBe(await catalogServiceFor('coach'));
  });

  it('generates the coach audience set unprefixed and untagged — stored bytes unchanged', async () => {
    const env = fakeEnv();
    const catalog = new CatalogService();
    await ensureAudiencesSeeded(env, catalog); // default surface arg — the pre-split call shape
    const expected = generateAffinityAudiences(
      catalog.getAllProducts() as unknown as Array<Record<string, unknown>>,
      DEFAULT_REFLEX_CONFIG,
      DEFAULT_GENERATOR_CONFIG
    );
    expect(expected.length).toBeGreaterThan(0);
    for (const def of expected) {
      expect(def.key.startsWith('bh_')).toBe(false);
      expect('surface' in def).toBe(false); // untagged ⇒ byte-identical stored JSON
    }
    const marker = await (env.CACHE as unknown as FakeKV).get('reflex:audgen:v1');
    expect(marker).toBe(expected.map((d) => `${d.key}:${d.generatorHash}`).join('|'));
  });
});

// ── 3. Per-surface markers + key namespaces are distinct ─────────────────────

describe('per-surface audgen markers and audience-key namespaces', () => {
  it('are distinct keys, so one surface cannot version-gate the other out', () => {
    expect(audgenMarkerFor('brighthour')).not.toBe(audgenMarkerFor('coach'));
    expect(audienceKeyPrefixFor('brighthour')).toBe('bh_');
    expect(audienceKeyPrefixFor('brighthour')).not.toBe(audienceKeyPrefixFor('coach'));
  });

  it('tags generated defs with their surface and namespaces their keys', () => {
    const items = [
      { id: 'BH-1', category: 'Kitchen', price_usd: 60 },
      { id: 'BH-2', category: 'Kitchen', price_usd: 70 },
      { id: 'BH-3', category: 'Kitchen', price_usd: 80 },
    ];
    const defs = generateAffinityAudiences(items, DEFAULT_REFLEX_CONFIG, {
      ...DEFAULT_GENERATOR_CONFIG,
      surface: 'brighthour',
      keyPrefix: audienceKeyPrefixFor('brighthour'),
    });
    const kitchen = defs.find((d) => d.key === 'bh_category_kitchen_affinity');
    expect(kitchen).toBeDefined();
    expect(kitchen!.surface).toBe('brighthour');
    // The prefix is a namespace, not a rename: ownership hashing is unaffected.
    expect(kitchen!.generatorHash).toBe(hashDef(kitchen!));
    expect(kitchen!.key).toBe('bh_' + audienceKey('category', 'Kitchen'));
  });
});

// ── 4. THE ping-pong regression (the sharpest collision trap) ────────────────

describe('regenerateCatalogAudiences — a surface may only archive its OWN stale audiences', () => {
  const COACH_CATALOG = [
    { id: 'C1', line: 'Tabby', category: 'Handbags', price_usd: 475 },
    { id: 'C2', line: 'Tabby', category: 'Handbags', price_usd: 395 },
    { id: 'C3', line: 'Tabby', category: 'Handbags', price_usd: 425 },
  ];
  const BH_CATALOG = [
    { id: 'B1', category: 'Kitchen', price_usd: 60 },
    { id: 'B2', category: 'Kitchen', price_usd: 70 },
    { id: 'B3', category: 'Kitchen', price_usd: 80 },
  ];

  const coachGenerated = () =>
    generateAffinityAudiences(COACH_CATALOG, DEFAULT_REFLEX_CONFIG, DEFAULT_GENERATOR_CONFIG);
  const bhGenerated = () =>
    generateAffinityAudiences(BH_CATALOG, DEFAULT_REFLEX_CONFIG, {
      ...DEFAULT_GENERATOR_CONFIG,
      surface: 'brighthour',
      keyPrefix: 'bh_',
    });

  /** A catalog audience whose value has since left its catalog (archive bait). */
  function stale(key: string, surface?: string): AudienceDef {
    const def: AudienceDef = {
      key,
      name: 'Stale Affinity',
      description: 'value left the catalog',
      conditions: { attribute: 'x_affinity.y', operator: 'gte', value: 0.6 },
      evaluation: 'realtime',
      source: 'catalog',
      ...(surface ? { surface } : {}),
      createdAt: 0,
      status: 'published',
    };
    def.generatorHash = hashDef(def);
    return def;
  }

  function seeded() {
    const defs = [
      ...coachGenerated(),
      ...bhGenerated(),
      stale('line_retired_affinity'), // coach's own stale (untagged ⇒ coach)
      stale('bh_category_retired_affinity', 'brighthour'), // brighthour's own stale
      { ...stale('line_pinned_affinity'), pinned: true },
    ];
    return memStore(defs);
  }

  it('a coach pass archives only coach stale entries — brighthour audiences survive', async () => {
    const { store, map } = seeded();
    const summary = await regenerateCatalogAudiences(store, coachGenerated(), 'coach');
    expect(summary.archived).toEqual(['line_retired_affinity']);
    expect(statusOf(map, 'bh_category_kitchen_affinity')).toBe('published');
    expect(statusOf(map, 'bh_category_retired_affinity')).toBe('published'); // not ours to retire
    expect(statusOf(map, 'line_pinned_affinity')).toBe('published'); // pinned always survives
  });

  it('a brighthour pass archives only brighthour stale entries — coach audiences survive', async () => {
    const { store, map } = seeded();
    const summary = await regenerateCatalogAudiences(store, bhGenerated(), 'brighthour');
    expect(summary.archived).toEqual(['bh_category_retired_affinity']);
    expect(statusOf(map, 'line_tabby_affinity')).toBe('published');
    expect(statusOf(map, 'line_retired_affinity')).toBe('published');
  });

  it('alternating passes reach a FIXED POINT — nothing flaps dead (the ping-pong)', async () => {
    const { store, map } = seeded();
    await regenerateCatalogAudiences(store, coachGenerated(), 'coach');
    await regenerateCatalogAudiences(store, bhGenerated(), 'brighthour');
    for (let i = 0; i < 3; i++) {
      const c = await regenerateCatalogAudiences(store, coachGenerated(), 'coach');
      const b = await regenerateCatalogAudiences(store, bhGenerated(), 'brighthour');
      expect(c.archived).toEqual([]); // already-archived stale entries are not republished
      expect(b.archived).toEqual([]);
    }
    // Both live sets are still live after six alternating passes.
    expect(statusOf(map, 'line_tabby_affinity')).toBe('published');
    expect(statusOf(map, 'category_handbags_affinity')).toBe('published');
    expect(statusOf(map, 'bh_category_kitchen_affinity')).toBe('published');
  });

  it('WITHOUT the surface argument the two passes DO wipe each other — why the scope exists', async () => {
    const { store, map } = seeded();
    await regenerateCatalogAudiences(store, coachGenerated()); // legacy single-catalog call
    expect(statusOf(map, 'bh_category_kitchen_affinity')).toBe('archived');
    await regenerateCatalogAudiences(store, bhGenerated());
    expect(statusOf(map, 'line_tabby_affinity')).toBe('archived');
  });
});

// ── 5. Identity / session split (server side) ────────────────────────────────

describe('session resolution — a brighthour visitor without the coach cookie is its own session', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(t0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('no cookie ⇒ the userId fallback mints a distinct session per visitor id', async () => {
    const env = fakeEnv();
    const engine = new RealtimeSegmentEngine(env);
    const coach = await engine.processActionEventWithSession(
      { type: 'page_view', userId: 'opt-vis-1', data: {}, source: 'coach-storefront', timestamp: t0 },
      null // credentials:'omit' — no Cookie header reaches the worker
    );
    const bh = await engine.processActionEventWithSession(
      { type: 'page_view', userId: 'bh_vis-1', data: {}, source: 'coach-storefront', timestamp: t0 },
      null
    );
    expect(bh.sessionId).not.toBe(coach.sessionId);
  });

  it('WITH the coach cookie the coach session captures the post — the credentials:\'omit\' rule', async () => {
    const env = fakeEnv();
    const engine = new RealtimeSegmentEngine(env);
    const coach = await engine.processActionEventWithSession(
      { type: 'page_view', userId: 'opt-vis-1', data: {}, source: 'coach-storefront', timestamp: t0 },
      null
    );
    // The session cookie WINS resolution regardless of the posted visitor id: a
    // Bright Hour page that let the browser send opt_session_id would merge its
    // vector into the retail shopper's session. Hence credentials:'omit'.
    const captured = await engine.processActionEventWithSession(
      { type: 'page_view', userId: 'bh_vis-2', data: {}, source: 'coach-storefront', timestamp: t0 },
      `opt_session_id=${coach.sessionId}`
    );
    expect(captured.sessionId).toBe(coach.sessionId);
  });
});

// ── 6. The DO trust gate (P4) ────────────────────────────────────────────────

describe('ShopperReflex trust gate — surface-aware product lookup', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(t0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('drops a genuinely unknown product id on the coach surface', async () => {
    const { shopper } = makeDO(fakeEnv());
    const body = await ingest(shopper, {
      type: 'product_view',
      userId: 'vis-COACH',
      data: { productId: 'NOT-A-REAL-SKU', action: 'product_view' },
      source: 'coach-storefront',
    });
    expect(body.dropped).toBe('unknown_product');
  });

  it('accepts a real coach product id (regression: the retail gate still passes)', async () => {
    const { shopper } = makeDO(fakeEnv());
    const known = new CatalogService().getAllProducts()[0].id;
    const body = await ingest(shopper, {
      type: 'product_view',
      userId: 'vis-COACH-2',
      data: { productId: known, action: 'product_view' },
      source: 'coach-storefront',
    });
    expect(body.dropped).toBeUndefined();
    expect(body.success).toBe(true);
  });
});

// ── 7. Brighthour-specific behavior (needs the parallel-authored modules) ────

describe.skipIf(!BH_READY)('brighthour surface — config, catalog, and the DO gate', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(t0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves BRIGHTHOUR_REFLEX_CONFIG — a different config from coach', async () => {
    const cfg = await reflexConfigFor('brighthour');
    expect(cfg).toBe(bhConfigMod!.BRIGHTHOUR_REFLEX_CONFIG);
    expect(cfg).not.toBe(DEFAULT_REFLEX_CONFIG);
    expect(cfg.version).not.toBe(DEFAULT_REFLEX_CONFIG.version);
    expect(cfg.dimensions.length).toBeGreaterThan(0);
  });

  it('brighthour products score against the brighthour dimensions', async () => {
    const cfg = await reflexConfigFor('brighthour');
    const products = await catalogProductsFor('brighthour', t0);
    expect(products.length).toBeGreaterThan(0);

    // At least one item must produce touches under the brighthour config —
    // otherwise the catalog and the dimension registry have drifted apart.
    const touched = products
      .map((p) => extractTouches(p as unknown as Record<string, unknown>, cfg))
      .filter((t) => t.length > 0);
    expect(touched.length).toBeGreaterThan(0);

    // Drift guard between two independently-authored files: the loader mirrors
    // the flat fields the dimension registry sources. Every catalog-sourced
    // dimension must resolve — only session-DERIVED dims (sessionMission) may
    // legitimately have no product field behind them.
    const covered = new Set<string>();
    for (const p of products) {
      for (const t of extractTouches(p as unknown as Record<string, unknown>, cfg)) covered.add(t.dim);
    }
    expect(covered.size).toBeGreaterThanOrEqual(cfg.dimensions.length - 1);

    // Three brisk views of one item cross θ_in on at least one dimension.
    const product = products.find(
      (p) => extractTouches(p as unknown as Record<string, unknown>, cfg).length > 0
    )!;
    const touches = extractTouches(product as unknown as Record<string, unknown>, cfg);
    let state = undefined as any;
    for (let i = 0; i < 3; i++) {
      state = apply(state, { action: 'product_view', touches }, t0 + i * 5_000, cfg).state;
    }
    expect(state.audiences.length).toBeGreaterThan(0);
    expect(state.configVersion).toBe(cfg.version);
  });

  it('emits BOTH window forms — ms for the engine, ISO for offerLifecycle', async () => {
    const { lifecycleStateAt, DEFAULT_LIFECYCLE_CONFIG } = await import('./offerLifecycle');
    const epoch = bhCatalogMod!.getEpochMs(null, t0);
    const products = bhCatalogMod!.loadBrighthourProducts(epoch) as Array<Record<string, any>>;

    let windowed = 0;
    for (const p of products) {
      const offer = p.offer;
      expect(offer.lifecycleState).toBeNull(); // derived at READ time, never frozen here
      if (offer.windowStart === null) {
        expect(offer.window).toBeNull(); // always-on: gated by availability, not a clock
        continue;
      }
      windowed++;
      // types.ts MaterializedOffer: offsets + ms on `window`, ISO alongside it.
      expect(typeof offer.window.startMs).toBe('number');
      expect(typeof offer.window.endMs).toBe('number');
      expect(typeof offer.window.startOffsetHours).toBe('number');
      expect(typeof offer.window.durationHours).toBe('number');
      expect(Date.parse(offer.windowStart)).toBe(offer.window.startMs);
      expect(Date.parse(offer.windowEnd)).toBe(offer.window.endMs);
      expect(p.offer_window_start_ms).toBe(offer.window.startMs);
      // The lifecycle engine reads the ISO form — every windowed item must land
      // on a real state rather than reading as always-on.
      expect(lifecycleStateAt(offer, offer.window.startMs + 1, DEFAULT_LIFECYCLE_CONFIG)).toBeTruthy();
    }
    expect(windowed).toBeGreaterThan(0);
  });

  it('resolves EVT120 nested reveals off the parent event at load (3h cadence ladder)', () => {
    const epoch = bhCatalogMod!.getEpochMs(null, t0);
    const products = bhCatalogMod!.loadBrighthourProducts(epoch) as Array<Record<string, any>>;
    const events = bhCatalogMod!.loadBrighthourEvents(epoch) as Array<Record<string, any>>;

    const parent = events.find((e) => e.id === 'EVT120_FALL')!;
    expect(parent.revealCadenceMs).toBe(3 * 3_600_000); // revealCadenceHours → ms
    const parentStart = Date.parse(parent.windowStart);

    const reveals = products
      .filter((p) => p.offer?.revealResolved)
      .sort((a, b) => a.offer.revealIndex - b.offer.revealIndex);
    expect(reveals.length).toBe(12); // README: revealIndex 0..11

    for (const item of reveals) {
      const i = item.offer.revealIndex as number;
      expect(item.offer.window.startMs).toBe(parentStart + i * parent.revealCadenceMs);
      expect(item.offer.window.endMs - item.offer.window.startMs).toBe(parent.revealCadenceMs);
      expect(Date.parse(item.offer.windowStart)).toBe(item.offer.window.startMs);
    }

    // FIN finale items hang off the SAME parent but carry their own window —
    // they must never be pulled into the reveal ladder.
    const finale = products.find((p) => p.offer?.code === 'FIN')!;
    expect(finale.offer.parentEvent).toBe('EVT120_FALL');
    expect(finale.offer.revealResolved).toBeUndefined();
    expect(finale.offer.window.startOffsetHours).toBe(108);
  });

  it('materializes signals.lastOnAirDate from the stored offset (never a frozen stamp)', () => {
    const epoch = bhCatalogMod!.getEpochMs(null, t0);
    const products = bhCatalogMod!.loadBrighthourProducts(epoch) as Array<Record<string, any>>;
    const aired = products.filter((p) => typeof p.signals?.lastOnAirOffsetHours === 'number');
    expect(aired.length).toBeGreaterThan(0);
    for (const p of aired) {
      expect(Date.parse(p.signals.lastOnAirDate)).toBe(
        Math.round(epoch + p.signals.lastOnAirOffsetHours * 3_600_000)
      );
      expect(p.last_on_air_ms).toBe(Date.parse(p.signals.lastOnAirDate));
    }
    // Beat 6's "aired within 2 hours" filter is satisfiable on any demo day.
    const shifted = bhCatalogMod!.loadBrighthourProducts(epoch + 86_400_000) as Array<Record<string, any>>;
    const i = products.findIndex((p) => typeof p.signals?.lastOnAirOffsetHours === 'number');
    expect(Date.parse(shifted[i].signals.lastOnAirDate) - Date.parse(products[i].signals.lastOnAirDate)).toBe(
      86_400_000
    );
  });

  it('materializes offer windows against an injected epoch — no ambient clock', () => {
    const epoch = bhCatalogMod!.getEpochMs(null, t0);
    const a = bhCatalogMod!.loadBrighthourProducts(epoch);
    const b = bhCatalogMod!.loadBrighthourProducts(epoch);
    expect(a).toEqual(b); // pure: same epoch ⇒ identical output
    const shifted = bhCatalogMod!.loadBrighthourProducts(epoch + 86_400_000);
    const windowed = a.findIndex((p) => (p as any).offer_window_start_ms !== null);
    if (windowed >= 0) {
      expect((shifted[windowed] as any).offer_window_start_ms).toBe(
        (a[windowed] as any).offer_window_start_ms + 86_400_000
      );
    }
    // A pinned epoch beats the clock entirely (rehearsed runs replay identically).
    expect(bhCatalogMod!.getEpochMs({ BRIGHTHOUR_EPOCH_MS: '123456789' }, t0)).toBe(123456789);
  });

  it('the DO gate accepts a brighthour product id and still drops an unknown one', async () => {
    const products = await catalogProductsFor('brighthour', t0);
    const bhId = products[0].id;

    const accepted = await ingest(makeDO(fakeEnv()).shopper, {
      type: 'product_view',
      userId: 'bh_vis-1',
      data: { productId: bhId, action: 'product_view' },
      source: 'brighthour',
    });
    expect(accepted.dropped).toBeUndefined();
    expect(accepted.success).toBe(true);

    const dropped = await ingest(makeDO(fakeEnv()).shopper, {
      type: 'product_view',
      userId: 'bh_vis-2',
      data: { productId: 'BH-NOT-REAL', action: 'product_view' },
      source: 'brighthour',
    });
    expect(dropped.dropped).toBe('unknown_product');

    // And the surfaces do not lend each other legitimacy: a brighthour id posted
    // on the coach surface is still an unknown product there.
    const crossed = await ingest(makeDO(fakeEnv()).shopper, {
      type: 'product_view',
      userId: 'vis-COACH-3',
      data: { productId: bhId, action: 'product_view' },
      source: 'coach-storefront',
    });
    expect(crossed.dropped).toBe('unknown_product');
  });

  it('REAL two-catalog seeding over ONE store: alternating passes keep both sets alive', async () => {
    const env = fakeEnv();
    const kv = env.CACHE as unknown as FakeKV;
    const coachCatalog = new CatalogService();
    const bhCatalog = await catalogServiceFor('brighthour', t0);

    const liveKeys = async () => {
      const out: string[] = [];
      for (const [k, v] of kv.store) {
        if (!k.startsWith('audience:')) continue;
        const def = JSON.parse(v) as AudienceDef;
        if (def.status === 'published' && def.source === 'catalog') out.push(def.key);
      }
      return out.sort();
    };

    await ensureAudiencesSeeded(env, coachCatalog, 'coach');
    const coachKeys = await liveKeys();
    await ensureAudiencesSeeded(env, bhCatalog, 'brighthour');
    const bothKeys = await liveKeys();
    const bhKeys = bothKeys.filter((k) => !coachKeys.includes(k));
    expect(coachKeys.length).toBeGreaterThan(0);
    expect(bhKeys.length).toBeGreaterThan(0);
    expect(bhKeys.every((k) => k.startsWith('bh_'))).toBe(true);

    // Six alternating passes over the shared store — nothing may flap dead. A
    // fresh engine each round defeats the per-instance seeded cache, so every
    // pass really runs the generator + diff.
    for (let i = 0; i < 3; i++) {
      await ensureAudiencesSeeded(env, coachCatalog, 'coach');
      await ensureAudiencesSeeded(env, bhCatalog, 'brighthour');
      expect(await liveKeys()).toEqual(bothKeys);
    }
    expect(await kv.get(audgenMarkerFor('coach'))).not.toBeNull();
    expect(await kv.get(audgenMarkerFor('brighthour'))).not.toBeNull();
  });

  it('a brighthour event carries its surface onto its session and its audience keys', async () => {
    const env = fakeEnv();
    const engine = new RealtimeSegmentEngine(env);
    const products = await catalogProductsFor('brighthour', t0);
    const cfg = await reflexConfigFor('brighthour');
    const product = products.find(
      (p) => extractTouches(p as unknown as Record<string, unknown>, cfg).length > 0
    )!;

    let update = null;
    for (let i = 0; i < 3; i++) {
      vi.setSystemTime(t0 + i * 5_000);
      const res = await engine.processActionEventWithSession(
        {
          type: 'product_view',
          userId: 'bh_vis-3',
          data: { productId: product.id, action: 'product_view' },
          source: 'brighthour',
          timestamp: t0 + i * 5_000,
        },
        null
      );
      update = res.update ?? update;
    }
    expect(update).not.toBeNull();
    const segments: string[] = update!.data.segments as string[];
    // Every reflex membership is namespaced, so it can never collide with — or be
    // mistaken for — a coach audience key in the shared store.
    const affinityKeys = segments.filter((s) => s.endsWith('_affinity'));
    expect(affinityKeys.length).toBeGreaterThan(0);
    for (const key of affinityKeys) expect(key.startsWith('bh_')).toBe(true);

    // Both surfaces' generation markers coexist; neither has overwritten the other.
    const kv = env.CACHE as unknown as FakeKV;
    expect(await kv.get(audgenMarkerFor('brighthour'))).not.toBeNull();
  });
});

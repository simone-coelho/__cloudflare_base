// src/demos/registry.ts
// ─────────────────────────────────────────────────────────────────────────────
// The demo-surface registry — the ONE shared seam that lets a second demo run on
// this worker without the first one noticing (PizzaHut build spec §2 P2/P3/P5,
// §3 isolation contract; QVC design brief §3 "identical isolation contract").
//
// Everything here is DEFAULT-PRESERVING by construction:
//   • absence of any signal resolves to 'coach' — never anything else;
//   • the coach answers are the EXACT objects/strings the engine used before this
//     module existed (DEFAULT_REFLEX_CONFIG by identity, 'reflex:audgen:v1'
//     verbatim, '' as the audience-key prefix);
//   • the brighthour modules are LATE-BOUND behind dynamic import, so the coach
//     path never evaluates a byte of them — and a half-landed brighthour build
//     can never break the retail demo (a missing module surfaces as a thrown
//     error on the brighthour path only).
//
// The async accessors exist BECAUSE of that late binding: every host call site
// (RealtimeSegmentEngine, ShopperReflex) is already async, so the cost is one
// already-resolved microtask and the isolation is real rather than asserted.
// ─────────────────────────────────────────────────────────────────────────────

import { DEFAULT_REFLEX_CONFIG, type ReflexConfig } from '@/reflex/core';
import { readReflexConfigRevision } from '@/reflex/configStore';
import type { Env } from '@/types/env';
import { CatalogService, type Product } from '@/services/CatalogService';

export type DemoSurface = 'coach' | 'brighthour';

/** The ONLY surface an absent/unrecognized signal may resolve to. */
export const DEFAULT_SURFACE: DemoSurface = 'coach';

export const DEMO_SURFACES: readonly DemoSurface[] = ['coach', 'brighthour'];

/**
 * KV marker keys the audience generator version-gates on. Coach's key is the
 * PRE-EXISTING string — changing it would force a spurious regeneration pass on
 * every deployed worker, so it is pinned verbatim.
 */
const AUDGEN_MARKERS: Record<DemoSurface, string> = {
  coach: 'reflex:audgen:v1',
  brighthour: 'reflex:audgen:brighthour:v1',
};

/**
 * Namespace prefix for generated audience keys. Coach is '' (its keys predate the
 * split and are load-bearing in cookies/decisions); brighthour is 'bh_' so the two
 * catalogs' audiences can never collide in the shared store.
 */
const AUDIENCE_KEY_PREFIXES: Record<DemoSurface, string> = {
  coach: '',
  brighthour: 'bh_',
};

/** Event `source` values that mean brighthour. Coach posts 'coach-storefront'. */
const BRIGHTHOUR_SOURCES: ReadonlySet<string> = new Set(['brighthour', 'live']);

function normalize(v: string | null | undefined): string {
  return typeof v === 'string' ? v.trim().toLowerCase() : '';
}

/**
 * Resolve the demo surface an inbound event belongs to.
 *   1. an explicit `surface` field wins (the client says what it is);
 *   2. otherwise the event's `source` — 'brighthour' or 'live' (and any
 *      'brighthour…' variant a page adopts) map to brighthour;
 *   3. otherwise DEFAULT_SURFACE. Absence is ALWAYS coach.
 */
export function resolveSurface(
  input?: { source?: string | null; surface?: string | null } | null
): DemoSurface {
  const explicit = normalize(input?.surface);
  if (explicit === 'brighthour') return 'brighthour';
  if (explicit === 'coach') return 'coach';

  const source = normalize(input?.source);
  if (BRIGHTHOUR_SOURCES.has(source) || source.startsWith('brighthour')) return 'brighthour';

  return DEFAULT_SURFACE;
}

/** KV version-marker key for this surface's catalog audience generation (P5). */
export function audgenMarkerFor(surface: DemoSurface): string {
  return AUDGEN_MARKERS[surface] ?? AUDGEN_MARKERS[DEFAULT_SURFACE];
}

/** Audience-key namespace for this surface ('' for coach — keys are unchanged). */
export function audienceKeyPrefixFor(surface: DemoSurface): string {
  return AUDIENCE_KEY_PREFIXES[surface] ?? AUDIENCE_KEY_PREFIXES[DEFAULT_SURFACE];
}

// ── Late-bound brighthour modules ────────────────────────────────────────────
// Cached per isolate. The coach branch returns before any import is attempted.

let _bhConfig: ReflexConfig | null = null;
let _bhCatalog: { epochMs: number; products: Product[] } | null = null;
let _coachCatalog: CatalogService | null = null;
/** One live CatalogService per surface; a new epoch REPLACES it (never accretes). */
const _catalogServices = new Map<DemoSurface, { epochMs: number; svc: CatalogService }>();

/** Reflex tuning for a surface. Coach returns DEFAULT_REFLEX_CONFIG BY IDENTITY. */
export async function reflexConfigFor(surface: DemoSurface): Promise<ReflexConfig> {
  if (surface !== 'brighthour') return DEFAULT_REFLEX_CONFIG;
  if (_bhConfig) return _bhConfig;
  const { BRIGHTHOUR_REFLEX_CONFIG } = await import('./brighthour/reflexConfig');
  _bhConfig = BRIGHTHOUR_REFLEX_CONFIG;
  return BRIGHTHOUR_REFLEX_CONFIG;
}

/**
 * The tuning the engine actually scores with (CW0): the stored config for this
 * surface when one has been written and still validates, otherwise the compiled
 * default above.
 *
 * This is the seam that makes scope appendix §1.4 true — "weights, decay
 * horizons and thresholds are versioned configuration, effective immediately
 * with no deployment." reflexConfigFor() is deliberately left alone: it stays
 * the compiled answer, returned BY IDENTITY, because it is this function's
 * fallback and because callers without an Env (pure composition, tests) depend
 * on that identity.
 *
 * The failure posture is the point. A missing key, a KV outage, or a stored
 * config that no longer passes validation all resolve to exactly what
 * reflexConfigFor would have returned, so wiring this into the decision path can
 * cost a read, and can never take a decision down.
 */
export async function resolveReflexConfig(env: Env, surface: DemoSurface): Promise<ReflexConfig> {
  const stored = await readReflexConfigRevision(env, surface);
  return stored ? stored.config : reflexConfigFor(surface);
}

/**
 * Reflex-scorable products for a surface. `nowMs` is only consulted by surfaces
 * whose catalog is time-materialized (brighthour's offer windows); coach ignores it.
 */
export async function catalogProductsFor(surface: DemoSurface, nowMs?: number): Promise<Product[]> {
  if (surface !== 'brighthour') {
    _coachCatalog = _coachCatalog ?? new CatalogService();
    return _coachCatalog.getAllProducts();
  }
  const mod = await import('./brighthour/catalog');
  const epochMs = mod.getEpochMs(null, nowMs);
  const cached = _bhCatalog;
  if (cached && cached.epochMs === epochMs) return cached.products;
  const products = mod.loadBrighthourProducts(epochMs);
  _bhCatalog = { epochMs, products };
  return products;
}

/**
 * The CatalogService a surface's hosts score/recommend against. Memoized per
 * isolate: the constructor runs the O(N²) item-item precompute, which must never
 * run per event. Coach callers that already hold their own instance should keep
 * using it — this exists for the hosts that resolve a catalog per event.
 */
export async function catalogServiceFor(surface: DemoSurface, nowMs?: number): Promise<CatalogService> {
  if (surface !== 'brighthour') {
    _coachCatalog = _coachCatalog ?? new CatalogService();
    return _coachCatalog;
  }
  const products = await catalogProductsFor(surface, nowMs);
  const epochMs = _bhCatalog?.epochMs ?? 0;
  const cached = _catalogServices.get(surface);
  if (cached && cached.epochMs === epochMs) return cached.svc;
  const svc = new CatalogService(products);
  _catalogServices.set(surface, { epochMs, svc });
  return svc;
}

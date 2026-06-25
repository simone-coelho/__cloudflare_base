// src/services/CatalogService.ts
// Coach catalog + cold-start item-item affinity model (docs/architecture/06-cold-start-affinity.md).
//
// "REAL SEAMS, MOCKED CALLS": the catalog is synthetic Coach NA data shaped to ODP's schema,
// bundled at build time (Cloudflare Workers cannot read files at runtime — import only).
//
// SLOW LOOP / FAST LOOP split (doc 06 §0):
//   - SLOW LOOP (here, at construction): compute the top-K item-item affinity graph from catalog
//     attributes via a weighted-sum similarity (line weight dominant). 71 products ⇒ O(N^2) is trivial.
//   - FAST LOOP (per request): getRecommendations / sortForSegments do nothing but cheap array math
//     against that precomputed graph + an in-session affinity score derived from segments/attributes.
//     No AI, no network in the hot path.
//
// Swapping the synthetic precompute for Coach's real ODP-derived data is a config change, not a
// code change: the hot-path methods depend only on the Product shape + the neighbor graph.

import catalogData from '@/data/coach-catalog.json';

/**
 * The Coach catalog product shape (matches src/data/coach-catalog.json exactly).
 * PINNED signature — other agents (DecisionProvider, storefront UI) code against this.
 */
export interface Product {
  id: string;
  name: string;
  line: string; // "Tabby" | "Brooklyn" | "Willow" | "Pillow Tabby" | "Essential" | ...
  category: string; // "Handbags" | "Small Leather Goods" | "Accessories"
  subcategory: string; // "Shoulder Bags" | "Crossbody Bags" | "Wallets" | "Bag Charms" | ...
  price_usd: number;
  colors: string[];
  material: string;
  silhouette: string; // "shoulder" | "crossbody" | "tote" | "hobo" | "bag charm" | ...
  size: string;
  occasion: string[]; // multi-valued: ["work","everyday","evening"]
  image_url: string;
  product_url: string;
}

// ── Affinity model constants (doc 06 §2/§3) ────────────────────────────────────
// Attribute weight vector W: how much each attribute pulls two products together.
// Same-line affinity is deliberately dominant — Coach shoppers are line-loyal.
// Sums to 1.00 by construction.
const ATTR_WEIGHTS = {
  line: 0.3, // strongest: a Tabby click pulls more Tabby first
  category: 0.22,
  silhouette: 0.1,
  occasion: 0.14, // Jaccard over the multi-valued occasion set
  colorFamily: 0.08,
  material: 0.08,
  priceBand: 0.08, // ordinal distance (entry/core/elevated)
} as const;

const K_NEIGHBORS = 12; // top-K most-similar SKUs kept per product
const MIN_EDGE = 0.15; // ignore neighbors below this similarity (doc 06 §4)

// Price bands match the synthetic data's `price_band_viewed` cuts
// (data/synthetic/README.md): entry < 150, core 150–399, elevated >= 400.
type PriceBand = 'entry' | 'core' | 'elevated';
const PRICE_BAND_IDX: Record<PriceBand, number> = { entry: 0, core: 1, elevated: 2 };
const PRICE_BAND_MAX = 2; // (Bmax - 1) for ordinal proximity

export function priceBandOf(priceUsd: number): PriceBand {
  if (priceUsd < 150) return 'entry';
  if (priceUsd < 400) return 'core';
  return 'elevated';
}

// Coarse color-family bucketing of the raw catalog color tokens, so two products
// "feel" similar by palette without needing a perfect color ontology.
function colorFamilyOf(colors: string[]): string {
  const c = (colors[0] ?? '').toLowerCase();
  if (/(black|grey|gray|graphite|distressed black)/.test(c)) return 'neutral_dark';
  if (/(chalk|ivory|cream|white|pearl|natural)/.test(c)) return 'neutral_light';
  if (/(khaki|saddle|walnut|brown|tan|moss|denim|faded blue|bluebell)/.test(c)) return 'earth_cool';
  if (/(red|cherry|berry|pink|electric|apple|1941 red)/.test(c)) return 'warm_bright';
  return 'mixed';
}

interface Neighbor {
  id: string;
  w: number;
}

export class CatalogService {
  private products: Product[];
  private byId: Map<string, Product>;
  /** Precomputed item-item affinity graph: productId -> top-K neighbors (the SLOW LOOP output). */
  private neighbors: Map<string, Neighbor[]>;
  /** Cached color-family per product (derived once). */
  private colorFamily: Map<string, string>;

  constructor(products?: Product[]) {
    // Bundled catalog import has shape { _meta, products }. Allow injection for tests.
    this.products = products ?? ((catalogData as { products: Product[] }).products ?? []);
    this.byId = new Map(this.products.map((p) => [p.id, p]));
    this.colorFamily = new Map(this.products.map((p) => [p.id, colorFamilyOf(p.colors)]));
    this.neighbors = this.buildAffinityGraph();
  }

  // ── PINNED public API ────────────────────────────────────────────────────────

  getAllProducts(): Product[] {
    return this.products;
  }

  getProduct(id: string): Product | undefined {
    return this.byId.get(id);
  }

  /**
   * Recommendations / "you may also like". Seed candidates from the anchor's precomputed
   * affinity neighbors (already the most-similar items), then RE-RANK those candidates by an
   * in-session affinity score derived from segments + attributes so the recs reflect the WHOLE
   * session, not just the anchor (doc 06 §6.4). Falls back to popularity-ish catalog order when
   * the anchor has thin neighbors or none is supplied.
   */
  getRecommendations(
    anchor: { productId?: string; line?: string },
    segments: string[],
    limit = 8
  ): Product[] {
    const anchorProduct = anchor.productId ? this.byId.get(anchor.productId) : undefined;
    const anchorLine = anchorProduct?.line ?? anchor.line;

    // Candidate seed = affinity neighbors of the anchor product.
    let candidateIds: string[] = anchorProduct
      ? (this.neighbors.get(anchorProduct.id) ?? []).map((n) => n.id)
      : [];

    // No product anchor (or thin neighbors): seed from same-line items, then whole catalog.
    if (candidateIds.length === 0 && anchorLine) {
      candidateIds = this.products.filter((p) => p.line === anchorLine).map((p) => p.id);
    }
    if (candidateIds.length === 0) {
      candidateIds = this.products.map((p) => p.id);
    }

    const aff = this.sessionAffinity(segments, undefined);
    const exclude = anchorProduct ? new Set([anchorProduct.id]) : new Set<string>();

    const ranked = candidateIds
      .filter((id) => !exclude.has(id))
      .map((id) => this.byId.get(id))
      .filter((p): p is Product => !!p)
      .map((p) => ({ p, score: this.affinityScore(p, aff, anchorProduct) }))
      .sort((a, b) => b.score - a.score)
      .map((x) => x.p);

    // Backfill from popularity-ish catalog order if we came up short.
    if (ranked.length < limit) {
      const have = new Set(ranked.map((p) => p.id).concat([...exclude]));
      for (const p of this.products) {
        if (ranked.length >= limit) break;
        if (!have.has(p.id)) {
          ranked.push(p);
          have.add(p.id);
        }
      }
    }

    return ranked.slice(0, limit);
  }

  /**
   * Personalized SORT of a product-list page. Scores each item by the in-session affinity
   * (segments + attributes) and returns them in descending order — the list visibly
   * reorganizes around the shopper's taste (doc 06 §6.4). Passing `products: null` sorts the
   * WHOLE catalog (used for the cold-start / first-render storefront grid).
   */
  sortForSegments(
    products: Product[] | null,
    segments: string[],
    attributes?: Record<string, any>
  ): Product[] {
    const list = products ?? this.products;
    const aff = this.sessionAffinity(segments, attributes);
    // Copy before sorting so we never mutate a caller's array (or our own catalog).
    return [...list]
      .map((p) => ({ p, score: this.affinityScore(p, aff, undefined) }))
      .sort((a, b) => b.score - a.score)
      .map((x) => x.p);
  }

  /**
   * "Complete the look": pair an anchor bag line with cross-category Accessories + Small Leather
   * Goods (charms, straps, wallets, card cases). Prefers same-line accessories, then same-line
   * SLG, then on-brand accessories from any line. Returns up to `limit` items (doc 06 §6.4).
   */
  completeTheLook(anchorLine: string, limit = 3): Product[] {
    const isAccessory = (p: Product) =>
      p.category === 'Accessories' || p.category === 'Small Leather Goods';

    const sameLineAccessories = this.products.filter((p) => p.line === anchorLine && isAccessory(p));
    const sameLineAccessoryIds = new Set(sameLineAccessories.map((p) => p.id));

    // Accessories from other lines, ordered to favor pairing-friendly types (charms/straps first).
    const pairRank = (p: Product) => {
      const s = p.subcategory.toLowerCase();
      if (s.includes('charm') || s.includes('strap') || s.includes('keychain')) return 0;
      if (s.includes('card') || s.includes('wristlet')) return 1;
      return 2; // wallets etc.
    };
    const otherAccessories = this.products
      .filter((p) => isAccessory(p) && !sameLineAccessoryIds.has(p.id))
      .sort((a, b) => pairRank(a) - pairRank(b) || a.price_usd - b.price_usd);

    const out: Product[] = [];
    const seen = new Set<string>();
    for (const p of [...sameLineAccessories, ...otherAccessories]) {
      if (out.length >= limit) break;
      if (!seen.has(p.id)) {
        out.push(p);
        seen.add(p.id);
      }
    }
    return out;
  }

  // ── SLOW LOOP: build the affinity graph (doc 06 §3/§4) ─────────────────────────

  private buildAffinityGraph(): Map<string, Neighbor[]> {
    const graph = new Map<string, Neighbor[]>();
    for (const a of this.products) {
      const scored: Neighbor[] = [];
      for (const b of this.products) {
        if (a.id === b.id) continue; // self is never a neighbor
        const s = this.sim(a, b);
        if (s > MIN_EDGE) scored.push({ id: b.id, w: s });
      }
      scored.sort((x, y) => y.w - x.w);
      const top = scored.slice(0, K_NEIGHBORS);
      // Per-anchor normalization so weights are comparable across anchors (max w = 1.0).
      const max = top[0]?.w ?? 1;
      graph.set(
        a.id,
        top.map((n) => ({ id: n.id, w: max > 0 ? n.w / max : n.w }))
      );
    }
    return graph;
  }

  /** Symmetric attribute similarity sim(a,b) ∈ [0,1] — weighted sum of per-attribute kernels. */
  private sim(a: Product, b: Product): number {
    const eq = (x: unknown, y: unknown) => (x === y ? 1 : 0);

    const priceSim =
      1 - Math.abs(PRICE_BAND_IDX[priceBandOf(a.price_usd)] - PRICE_BAND_IDX[priceBandOf(b.price_usd)]) / PRICE_BAND_MAX;

    const setA = new Set(a.occasion);
    const setB = new Set(b.occasion);
    let inter = 0;
    for (const o of setA) if (setB.has(o)) inter++;
    const union = new Set([...a.occasion, ...b.occasion]).size;
    const occSim = union === 0 ? 0 : inter / union;

    return (
      ATTR_WEIGHTS.line * eq(a.line, b.line) +
      ATTR_WEIGHTS.category * eq(a.category, b.category) +
      ATTR_WEIGHTS.silhouette * eq(a.silhouette, b.silhouette) +
      ATTR_WEIGHTS.colorFamily * eq(this.colorFamily.get(a.id), this.colorFamily.get(b.id)) +
      ATTR_WEIGHTS.material * eq(a.material, b.material) +
      ATTR_WEIGHTS.priceBand * priceSim +
      ATTR_WEIGHTS.occasion * occSim
    );
  }

  // ── FAST LOOP: in-session affinity scoring (doc 06 §5/§6) ──────────────────────

  /**
   * Derive a lightweight per-session affinity preference from the qualified segments + live
   * attributes. This stands in for the §5/§6 affinity vector: we read the strongest in-session
   * signals the engine actually computes — `viewed_product_line` and `price_band_viewed` — plus
   * line/price hints encoded in segment keys (e.g. `high_intent_tabby_browser`, `luxe_affinity`,
   * `brooklyn_browser`). Pure, deterministic, allocation-light.
   */
  private sessionAffinity(
    segments: string[],
    attributes?: Record<string, any>
  ): { line?: string; priceBand?: PriceBand; lineWeight: number; bandWeight: number } {
    const segs = segments.map((s) => s.toLowerCase());
    const has = (frag: string) => segs.some((s) => s.includes(frag));

    // Preferred line: explicit attribute wins; otherwise infer from segment keys.
    let line: string | undefined =
      typeof attributes?.viewed_product_line === 'string' ? attributes.viewed_product_line : undefined;
    let lineWeight = line ? 1 : 0;
    if (!line) {
      for (const p of this.products) {
        const token = p.line.toLowerCase().replace(/\s+/g, '_');
        if (token && has(token)) {
          line = p.line;
          lineWeight = 0.7; // weaker than a directly-observed view
          break;
        }
      }
    }

    // Preferred price band: explicit attribute wins; segments give a softer nudge.
    let priceBand: PriceBand | undefined;
    const pbv = attributes?.price_band_viewed;
    if (pbv === 'entry' || pbv === 'core' || pbv === 'elevated') priceBand = pbv;
    let bandWeight = priceBand ? 1 : 0;
    if (!priceBand) {
      if (has('luxe') || has('premium') || has('vip') || has('high_aov')) {
        priceBand = 'elevated';
        bandWeight = 0.6;
      } else if (has('gift')) {
        priceBand = 'entry';
        bandWeight = 0.4;
      }
    }

    return { line, priceBand, lineWeight, bandWeight };
  }

  /**
   * Score a single product against the in-session affinity (+ optional product anchor).
   * Blend (doc 06 §6.3 spirit): affinity to preferred line/band, similarity to the anchor item,
   * and a small popularity prior so cold sessions still get sensible ordering.
   */
  private affinityScore(
    p: Product,
    aff: { line?: string; priceBand?: PriceBand; lineWeight: number; bandWeight: number },
    anchor?: Product
  ): number {
    let score = 0;

    // Line affinity (dominant — Coach shoppers are line-loyal).
    if (aff.line && p.line === aff.line) score += 1.0 * aff.lineWeight;

    // Price-band fit via ordinal proximity to the preferred band.
    if (aff.priceBand) {
      const prox =
        1 - Math.abs(PRICE_BAND_IDX[priceBandOf(p.price_usd)] - PRICE_BAND_IDX[aff.priceBand]) / PRICE_BAND_MAX;
      score += 0.35 * aff.bandWeight * prox;
    }

    // Similarity to the anchor item, if one was clicked (re-rank around the whole session).
    if (anchor) score += 0.5 * this.sim(anchor, p);

    // Small popularity / merchandising prior: stable, deterministic tie-breaker.
    // Earlier catalog position ≈ hero/flagship ordering; keep it tiny so it never dominates.
    const idx = this.products.indexOf(p);
    const popPrior = idx >= 0 ? (this.products.length - idx) / this.products.length : 0;
    score += 0.1 * popPrior;

    return score;
  }
}

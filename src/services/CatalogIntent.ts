/**
 * CatalogIntent — turns a Gemini-parsed search intent into ranked REAL catalog results,
 * and projects the catalog compactly for in-context use (the Style Concierge). Pure +
 * testable. The LLM only ever decides the *intent* / picks ids; ranking + grounding are
 * deterministic here, so results are always real, constrained, and personalizable.
 */
import { z } from 'zod';
import catalog from '@/data/coach-catalog.json';

export interface CatProduct {
  id: string;
  name: string;
  line: string;
  category: string;
  subcategory?: string;
  price_usd: number;
  colors?: string[];
  material?: string;
  silhouette?: string;
  occasion?: string[];
  in_stock?: boolean;
}

const RAW = catalog as unknown;
export const ALL_PRODUCTS: CatProduct[] =
  (Array.isArray(RAW) ? RAW : ((RAW as any)?.products || (RAW as any)?.items || [])) as CatProduct[];
export function getCatalog(): CatProduct[] { return ALL_PRODUCTS; }

export const OCCASIONS = ['work', 'everyday', 'evening', 'date-night', 'special-occasion', 'travel', 'festival', 'winter', 'gift'] as const;
export const CATEGORIES = ['Handbags', 'Small Leather Goods', 'Accessories'] as const;

// .nullable() (not .optional()) — Gemini structured output maps zod → Google responseSchema
// and handles nullable far more reliably than optional.
export const IntentSchema = z.object({
  categories: z.array(z.enum(CATEGORIES)).describe('Product categories implied; empty if unspecified.'),
  lines: z.array(z.string()).describe('Coach line names ONLY if explicitly named (Tabby, Brooklyn, Willow, …); else empty.'),
  occasions: z.array(z.enum(OCCASIONS)).describe('Map free text ONTO these exact tags. A wedding → ["special-occasion","evening"]; a WINTER wedding also adds "winter"; office/commute → "work".'),
  colors: z.array(z.string()).describe('Color words mentioned, lowercase. OMIT any color the shopper says to avoid.'),
  silhouettes: z.array(z.string()).describe('e.g. tote, crossbody, shoulder, hobo, top-handle, wallet, card case.'),
  priceMax: z.number().nullable().describe('Hard max USD if stated ("under $400" → 400), else null.'),
  priceMin: z.number().nullable().describe('Hard min USD if stated, else null.'),
  priceBand: z.enum(['entry', 'core', 'elevated']).nullable().describe('entry(<150) / core(150-399) / elevated(>=400) from cues like "affordable"/"investment"; null if none.'),
  giftMode: z.boolean().describe('True if shopping for someone else / a gift.'),
  summary: z.string().describe('Short restatement of the want, ≤ 8 words, for the results caption.'),
  // Editorial copy for the visual "Edit" hero — authored in the SAME call (no extra latency).
  headline: z.string().describe('Editorial campaign headline for this search, ≤ 5 words, evocative and on-brand for Coach (e.g. "The Winter Wedding Edit", "Built for the Commute"). Title Case. No quotes, no emoji.'),
  subhead: z.string().describe('One supporting line beneath the headline, ≤ 14 words, warm and concrete about the occasion/feeling. No prices.'),
  sceneContext: z.string().describe('A short photographic scene phrase describing WHERE/HOW to stage the hero bag for this search, starting with "on/at/beside…", ≤ 18 words, tasteful real-world props matching the occasion (e.g. "on a candlelit winter-wedding table with white roses and soft snow outside").'),
});
export type SearchIntent = z.infer<typeof IntentSchema>;

export interface Affinity {
  dominantLine?: string | null;
  segments?: string[];
  recommendationIds?: string[];
}

/** Compact projection for in-context use (concierge). ~4.2K tokens for 71 items. */
export function buildCompactCatalog(products: CatProduct[] = ALL_PRODUCTS): string {
  return JSON.stringify(
    products.map((p) => ({
      id: p.id, name: p.name, line: p.line, cat: p.category, sub: p.subcategory,
      price: p.price_usd, color: p.colors, mat: p.material, sil: p.silhouette, occ: p.occasion,
    }))
  );
}

const BAND: Record<string, number> = { entry: 0, core: 1, elevated: 2 };
const bandOf = (price: number): number => (price < 150 ? 0 : price < 400 ? 1 : 2);

/** Hard-filter + soft-score ranking from a parsed intent, blended with live affinity. */
export function rankByIntent(products: CatProduct[], intent: SearchIntent, affinity: Affinity = {}, limit = 9): CatProduct[] {
  const recs = new Set(affinity.recommendationIds || []);
  const occWanted = (intent.occasions || []) as readonly string[];
  const catWanted = (intent.categories || []) as readonly string[];
  const lineWanted = (intent.lines || []).map((l) => l.toLowerCase());
  const silWanted = (intent.silhouettes || []).map((s) => s.toLowerCase());
  const colorWanted = (intent.colors || []).map((c) => c.toLowerCase());

  const passHard = (p: CatProduct, relax: boolean): boolean => {
    if (p.in_stock === false) return false;
    if (catWanted.length && !catWanted.includes(p.category)) return false;
    if (lineWanted.length && !lineWanted.includes((p.line || '').toLowerCase())) return false;
    if (intent.priceMax != null && p.price_usd > intent.priceMax) return false;
    if (!relax && intent.priceMin != null && p.price_usd < intent.priceMin) return false;
    return true;
  };

  const score = (p: CatProduct): number => {
    let s = 0;
    if (occWanted.length) {
      let inter = 0;
      (p.occasion || []).forEach((o) => { if (occWanted.includes(o)) inter++; });
      s += 0.34 * (inter / occWanted.length);
    }
    if (catWanted.length && catWanted.includes(p.category)) s += 0.22;
    if (lineWanted.length && lineWanted.includes((p.line || '').toLowerCase())) s += 0.18;
    if (silWanted.length && silWanted.includes((p.silhouette || '').toLowerCase())) s += 0.12;
    if (colorWanted.length) {
      const pc = (p.colors || []).join(' ').toLowerCase();
      if (colorWanted.some((c) => pc.includes(c))) s += 0.1;
    }
    if (intent.priceBand) s += 0.1 * (1 - Math.abs(BAND[intent.priceBand] - bandOf(p.price_usd)) / 2);
    const hay = `${p.name} ${p.material || ''} ${p.subcategory || ''}`.toLowerCase();
    if (intent.summary && intent.summary.toLowerCase().split(/\s+/).some((t) => t.length > 3 && hay.includes(t))) s += 0.05;
    if (affinity.dominantLine && p.line === affinity.dominantLine) s += 0.16; // personalization
    if (recs.has(p.id)) s += 0.06;
    return s;
  };

  let pool = products.filter((p) => passHard(p, false));
  if (pool.length < 3) pool = products.filter((p) => passHard(p, true)); // relax priceMin so the grid is never empty
  const ranked = pool.map((p) => ({ p, s: score(p) })).sort((a, b) => b.s - a.s);
  const scored = ranked.filter((x) => x.s > 0.05).map((x) => x.p);
  return (scored.length ? scored : pool).slice(0, limit);
}

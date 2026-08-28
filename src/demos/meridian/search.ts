// src/demos/meridian/search.ts
// ─────────────────────────────────────────────────────────────────────────────
// Reading the sentence — and honouring the NOUN in it.
//
// The first cut of this file routed the sentence to one of 8 approved scenes
// and stopped. The scene's touches then chose the products, which is how
// "I am looking for sweaters for winter" produced a rain shell, a jacket and a
// vest: the word "sweaters" never reached the ranker. Decision 6 fixes that.
//
// Two things come out of one read of the sentence now:
//
//   · THE SCENE — unchanged, an enum over the curated set. It still supplies
//     the copy and the hero plate, and a hallucinated scene is still
//     unrepresentable at the schema boundary.
//   · THE INTENT — categories / lines / colours / occasions / price ceiling,
//     every list an enum built from the LIVE catalogue, so the model cannot
//     name a category we do not stock.
//
// The model still decides nothing downstream: intent.categories HARD-FILTERS
// the catalogue, and a deterministic score (fixed weights, affinity as one
// term, catalogue order as the tie-break) ranks what is left. If the model is
// slow or absent, a keyword parser produces the same intent shape from the
// same vocabulary and the shopper cannot tell. Every answer says which path
// answered — never hidden.
// ─────────────────────────────────────────────────────────────────────────────

import { z } from 'zod';
import { generateObject } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { extractTouches, type Touch } from '@/reflex/core';
import type { Env } from '@/types/env';
import type { Vertical, MeridianItem } from './types';
import { itemsFor } from './catalog';
import { configFor } from './reflexConfig';
import type { AffinityView } from './composer';
import { scenesFor, sceneById, classifyLocally, parseCeiling, type Scene } from './scenes';

/** What one read of the sentence yields. Arrays are never absent — empty means "unstated". */
export interface SearchIntent {
  /** Live catalogue categories the shopper named or clearly implied. Hard filter. */
  categories: string[];
  /** Product lines named outright. Hard filter when non-empty. */
  lines: string[];
  /** Colour words. Soft rank signal, never a filter. */
  colours: string[];
  /** Occasions, mapped onto the catalogue's own needs vocabulary. */
  occasions: string[];
  /** Hard max USD. 0 means none was stated. */
  priceCeilingUsd: number;
}

export const EMPTY_INTENT: SearchIntent = Object.freeze({
  categories: [], lines: [], colours: [], occasions: [], priceCeilingUsd: 0,
});

export interface SearchAnswer {
  ok: boolean;
  query: string;
  scene: Scene | null;
  /** Scene touches PLUS one broad-dimension touch per category the intent named. */
  touches: Touch[];
  /** The parsed intent — shown in the provenance box, not just used. */
  intent: SearchIntent;
  /** Ranked catalogue ids, up to 8. Hard-filtered to the intent's categories. */
  products: string[];
  /** The scene's approved plate, with the top-ranked product named for the overlay. */
  hero: { image: string; productId: string | null } | null;
  ceiling: number | null;
  /** Which path answered. Shown on screen — never hidden. */
  source: 'model' | 'local' | 'none';
  confidence: number;
  ms: number;
  /** True when the model was tried and did not answer in time or at all. */
  fellBack: boolean;
}

/**
 * Hard ceiling so a slow model can never hold up a demo beat. Measured routing
 * latency runs ~0.9-1.9s, so 2.2s tripped on the slow tail and dropped answers
 * the model would have got right. 3.5s clears the tail; past that the local
 * classifier is genuinely the better answer because it is instant.
 */
const MODEL_TIMEOUT_MS = 3500;

// ─────────────────────────────────────────────────────────────────────────────
// The live vocabulary — derived from the catalogue at module load, never typed
// out by hand, so a catalogue change (new category, the colour field landing)
// changes the schema and the keyword parser together with no code edit.
// ─────────────────────────────────────────────────────────────────────────────

interface Vocab {
  categories: string[];
  lines: string[];
  colours: string[];
  occasions: string[];
}

/** The colour of an item, wherever the catalogue keeps it today. */
function colourOf(item: MeridianItem): string {
  const it = item as MeridianItem & { colour?: string; swatch?: string };
  return (it.colour ?? it.swatch ?? '').toLowerCase();
}

const distinct = (values: string[]): string[] => [...new Set(values.filter(Boolean))];

const VOCAB = new Map<Vertical, Vocab>();
export function vocabFor(vertical: Vertical): Vocab {
  const hit = VOCAB.get(vertical);
  if (hit) return hit;
  const items = itemsFor(vertical);
  const v: Vocab = {
    categories: distinct(items.map((i) => i.category)),
    lines: distinct(items.map((i) => i.line ?? '')),
    colours: distinct(items.map((i) => colourOf(i))),
    occasions: distinct(items.flatMap((i) => i.needs ?? [])),
  };
  VOCAB.set(vertical, v);
  return v;
}

// ─────────────────────────────────────────────────────────────────────────────
// THE LOCAL INTENT PARSER — the reason "sweaters" works with the network
// unplugged. Keyword match over the live vocabulary plus a small noun table
// ("sweater" is not a string that appears in any category name). An alias is
// honoured only when its category actually exists in this catalogue, so the
// table costs nothing when the vocabulary changes.
// ─────────────────────────────────────────────────────────────────────────────

/** Shopper's noun → catalogue category. Applied only when the category is live. */
const CATEGORY_ALIASES: Readonly<Record<string, string>> = {
  sweater: 'Knitwear', jumper: 'Knitwear', cardigan: 'Knitwear', pullover: 'Knitwear',
  knit: 'Knitwear', turtleneck: 'Knitwear',
  boot: 'Footwear', sneaker: 'Footwear', shoe: 'Footwear', loafer: 'Footwear',
  heel: 'Footwear', trainer: 'Footwear', derby: 'Footwear',
  bag: 'Bags', tote: 'Bags', purse: 'Bags', handbag: 'Bags', clutch: 'Bags',
  weekender: 'Bags', crossbody: 'Bags', satchel: 'Bags',
  coat: 'Outerwear', jacket: 'Outerwear', parka: 'Outerwear', trench: 'Outerwear',
  anorak: 'Outerwear', raincoat: 'Outerwear',
  scarf: 'Scarves', scarves: 'Scarves', muffler: 'Scarves', bandana: 'Scarves',
  ring: 'Jewellery', earring: 'Jewellery', necklace: 'Jewellery', bracelet: 'Jewellery',
  bangle: 'Jewellery', cufflink: 'Jewellery', signet: 'Jewellery',
  jewellery: 'Jewellery', jewelry: 'Jewellery',
  sunglasses: 'Eyewear', glasses: 'Eyewear', shades: 'Eyewear', aviator: 'Eyewear',
  eyeglasses: 'Eyewear',
  perfume: 'Fragrance', cologne: 'Fragrance', fragrance: 'Fragrance', scent: 'Fragrance',
};

/** Words that appear in product names but say nothing about what is wanted. */
const STOP_TOKENS = new Set(['the', 'and', 'for', 'with']);

/**
 * token → category, learned from the live catalogue's own product names, so
 * "fisherman" or "weekender" resolve without anyone maintaining a list. A token
 * that appears under TWO categories ("vest" is outerwear and knitwear here) is
 * ambiguous and votes for nothing — an honest miss beats a confident wrong filter.
 */
const NAME_INDEX = new Map<Vertical, Map<string, string | null>>();
function nameIndexFor(vertical: Vertical): Map<string, string | null> {
  const hit = NAME_INDEX.get(vertical);
  if (hit) return hit;
  const idx = new Map<string, string | null>();
  const claim = (token: string, category: string) => {
    if (token.length < 3 || STOP_TOKENS.has(token)) return;
    const prev = idx.get(token);
    if (prev === undefined) idx.set(token, category);
    else if (prev !== category) idx.set(token, null); // ambiguous — never filters
  };
  for (const item of itemsFor(vertical)) {
    claim(item.category.toLowerCase(), item.category);
    const line = (item.line ?? '').toLowerCase();
    for (const token of item.name.toLowerCase().split(/[^a-z0-9]+/)) {
      if (token && token !== line) claim(token, item.category);
    }
  }
  NAME_INDEX.set(vertical, idx);
  return idx;
}

/** "sweaters" → ["sweaters","sweater"]; "totes" → ["totes","tote"]. Cheap, sufficient. */
function forms(word: string): string[] {
  const out = [word];
  if (word.length > 3 && word.endsWith('es')) out.push(word.slice(0, -2));
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) out.push(word.slice(0, -1));
  return out;
}

/** Deterministic intent from words alone. No network, no key, no model. */
export function parseIntentLocally(vertical: Vertical, query: string): SearchIntent {
  const vocab = vocabFor(vertical);
  const index = nameIndexFor(vertical);
  const live = new Set(vocab.categories);
  const tokens = query.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

  const categories = new Set<string>();
  const lines = new Set<string>();
  const colours = new Set<string>();
  const occasions = new Set<string>();

  const lineByLower = new Map(vocab.lines.map((l) => [l.toLowerCase(), l]));
  const occByLower = new Map(vocab.occasions.map((o) => [o.toLowerCase(), o]));
  const colourSet = new Set(vocab.colours);

  for (const token of tokens) {
    for (const form of forms(token)) {
      const alias = CATEGORY_ALIASES[form];
      if (alias && live.has(alias)) categories.add(alias);
      const learned = index.get(form);
      if (learned) categories.add(learned);
      const line = lineByLower.get(form);
      if (line) lines.add(line);
      if (colourSet.has(form)) colours.add(form);
      const occ = occByLower.get(form);
      if (occ) occasions.add(occ);
    }
  }

  // Multi-word colour values ("dusty rose") cannot arrive as one token.
  const q = ` ${tokens.join(' ')} `;
  for (const c of vocab.colours) {
    if (c.includes(' ') && q.includes(` ${c} `)) colours.add(c);
  }

  return {
    // Vocabulary order, so the same sentence always yields the same array.
    categories: vocab.categories.filter((c) => categories.has(c)),
    lines: vocab.lines.filter((l) => lines.has(l)),
    colours: vocab.colours.filter((c) => colours.has(c)),
    occasions: vocab.occasions.filter((o) => occasions.has(o)),
    priceCeilingUsd: parseCeiling(query) ?? 0,
  };
}

/** Did the sentence actually name anything rankable? */
export function intentHasSignal(intent: SearchIntent): boolean {
  return intent.categories.length > 0 || intent.lines.length > 0
    || intent.colours.length > 0 || intent.occasions.length > 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// THE RANKER — deterministic, fixed weights, and the model is nowhere in it.
//
//   hard filter   category ∈ intent.categories, line ∈ intent.lines
//   score         line +0.3 · colour +0.2 · occasion +0.15 · under ceiling +0.1
//                 + 0.4 × Σ affinity a over the item's own (dim, value) pairs
//   fallback      when the intent named nothing, the scene's touches order the
//                 catalogue instead (+0.15 per matching touch)
//   tie-break     catalogue order, always — same inputs, same row, every time
// ─────────────────────────────────────────────────────────────────────────────

const WEIGHT_LINE = 0.3;
const WEIGHT_COLOUR = 0.2;
const WEIGHT_OCCASION = 0.15;
const WEIGHT_UNDER_CEILING = 0.1;
const WEIGHT_AFFINITY = 0.4;
const WEIGHT_SCENE_TOUCH = 0.15;
const MAX_PRODUCTS = 8;

export function rankByIntent(
  vertical: Vertical,
  items: readonly MeridianItem[],
  intent: SearchIntent,
  opts: {
    touches?: readonly Touch[];
    ceiling?: number | null;
    affinity?: AffinityView | null;
  } = {},
): string[] {
  const config = configFor(vertical);
  const touches = opts.touches ?? [];
  const ceiling = opts.ceiling ?? (intent.priceCeilingUsd > 0 ? intent.priceCeilingUsd : null);
  const affinity = opts.affinity ?? null;
  const hasSignal = intentHasSignal(intent);

  const wantLines = new Set(intent.lines.map((l) => l.toLowerCase()));
  const wantColours = intent.colours.map((c) => c.toLowerCase()).filter(Boolean);
  const wantOccasions = new Set(intent.occasions);

  const sellable = items.filter((i) => i.available !== false && !i.embargoed);

  // Hard filter. The category is the noun the shopper actually typed, so when a
  // category+line combination has no stock the LINE relaxes and the category
  // holds — "Drover sweaters" shows sweaters, and says so, rather than jackets.
  const inCats = (i: MeridianItem) => intent.categories.includes(i.category);
  const inLines = (i: MeridianItem) => wantLines.has((i.line ?? '').toLowerCase());
  let pool: MeridianItem[];
  if (intent.categories.length > 0) {
    pool = wantLines.size > 0 ? sellable.filter((i) => inCats(i) && inLines(i)) : sellable.filter(inCats);
    if (pool.length === 0) pool = sellable.filter(inCats);
  } else if (wantLines.size > 0) {
    pool = sellable.filter(inLines);
    if (pool.length === 0) pool = sellable;
  } else {
    pool = sellable;
  }

  const scoreOf = (item: MeridianItem): number => {
    let s = 0;
    if (wantLines.size > 0 && inLines(item)) s += WEIGHT_LINE;
    if (wantColours.length > 0) {
      const ic = colourOf(item);
      if (ic && wantColours.some((c) => ic === c || ic.includes(c) || c.includes(ic))) s += WEIGHT_COLOUR;
    }
    if (wantOccasions.size > 0 && (item.needs ?? []).some((n) => wantOccasions.has(n))) s += WEIGHT_OCCASION;
    if (ceiling != null && item.value_usd <= ceiling) s += WEIGHT_UNDER_CEILING;

    // The item's own (dim, value) pairs, derived by the SAME extractTouches the
    // engine scores with — bands, multi-valued needs and all — so this term can
    // never disagree with the instrument about what an item is.
    if (affinity || (!hasSignal && touches.length > 0)) {
      const pairs = extractTouches(item as unknown as Record<string, unknown>, config);
      if (affinity) {
        let sum = 0;
        for (const p of pairs) sum += affinity.dims[p.dim]?.[p.value] ?? 0;
        s += WEIGHT_AFFINITY * sum;
      }
      if (!hasSignal && touches.length > 0) {
        for (const t of touches) {
          if (pairs.some((p) => p.dim === t.dim && p.value === t.value)) s += WEIGHT_SCENE_TOUCH;
        }
      }
    }
    return s;
  };

  return pool
    .map((item, order) => ({ id: item.id, s: scoreOf(item), order }))
    .sort((a, b) => b.s - a.s || a.order - b.order) // stable: catalogue order breaks ties
    .slice(0, MAX_PRODUCTS)
    .map((x) => x.id);
}

// ─────────────────────────────────────────────────────────────────────────────
// The model path: one call reads the sentence for BOTH the scene and the
// intent. Every list in the schema is an enum over live values, so the model
// can neither invent a scene nor a category. Thinking OFF — the hard part
// ("is this a real category") is already solved by the enum, and with thinking
// on, turns ran 5s+ and blew the budget (measured on the concierge).
// ─────────────────────────────────────────────────────────────────────────────

interface ModelRead {
  scene: string;
  confidence: number;
  intent: SearchIntent;
}

async function readWithModel(
  env: Env, vertical: Vertical, query: string, budgetMs: number,
): Promise<ModelRead | null> {
  if (!env.GEMINI_API_KEY) return null;
  const scenes = scenesFor(vertical);
  const ids = scenes.map((s) => s.id) as [string, ...string[]];
  const vocab = vocabFor(vertical);

  // NO .max() on arrays and nothing nullable — both have broken generateObject
  // against Gemini in this repo (a cap REJECTS the whole answer; a union-with-
  // null fails schema validation). Empty array / 0 carry "none" instead.
  const enumOr = (values: string[]) =>
    values.length ? z.enum(values as [string, ...string[]]) : z.string();

  const schema = z.object({
    // An enum. There is no room in this type for an invention.
    scene: z.enum(ids).describe('The single closest scene from this fixed list.'),
    confidence: z.number().min(0).max(1).describe('How well the sentence fits that scene.'),
    categories: z.array(enumOr(vocab.categories))
      .describe('Categories the shopper named or clearly implied ("sweaters" implies Knitwear). Empty when no product type was named.'),
    lines: z.array(enumOr(vocab.lines))
      .describe('Product lines ONLY when named outright. Empty otherwise.'),
    colours: z.array(enumOr(vocab.colours))
      .describe('Colours the shopper wants, lowercase. Empty when none. Never include a colour they asked to avoid.'),
    occasions: z.array(enumOr(vocab.occasions))
      .describe('Occasions implied, mapped ONTO these exact values. Empty when none fit.'),
    priceCeilingUsd: z.number()
      .describe('Hard max in USD when stated ("under $300" → 300). 0 when none was stated.'),
  });

  const google = createGoogleGenerativeAI({ apiKey: env.GEMINI_API_KEY });
  const run = generateObject({
    model: google(env.GEMINI_MODEL || 'gemini-2.5-flash'),
    schema,
    prompt:
      `You read ONE shopper sentence. Two jobs, both from fixed lists — you invent nothing.\n` +
      `1) Route it to the single closest scene.\n` +
      `Scenes: ${scenes.map((s) => `${s.id} (${s.headline})`).join('; ')}\n` +
      `If nothing fits well, still pick the closest and report low confidence.\n` +
      `2) Extract shopping intent using ONLY these vocabularies (empty array when unstated):\n` +
      `categories: ${vocab.categories.join(', ') || '(none)'}\n` +
      `lines: ${vocab.lines.join(', ') || '(none)'}\n` +
      `colours: ${vocab.colours.join(', ') || '(free text, lowercase)'}\n` +
      `occasions: ${vocab.occasions.join(', ') || '(none)'}\n` +
      `Sentence: """${query}"""`,
    providerOptions: { google: { thinkingConfig: { thinkingBudget: 0 } } },
  });

  const timeout = new Promise<null>((res) => setTimeout(() => res(null), budgetMs));
  const out = await Promise.race([run.then((r) => r.object).catch(() => null), timeout]);
  if (!out) return null;

  // Belt and braces over the enums: dedupe, keep live values only, clamp the number.
  const onlyLive = (got: string[], live: string[]) =>
    live.length ? live.filter((v) => got.includes(v)) : distinct(got.map((s) => s.trim().toLowerCase()));
  return {
    scene: out.scene,
    confidence: out.confidence,
    intent: {
      categories: onlyLive(out.categories ?? [], vocab.categories),
      lines: onlyLive(out.lines ?? [], vocab.lines),
      colours: onlyLive(out.colours ?? [], vocab.colours),
      occasions: onlyLive(out.occasions ?? [], vocab.occasions),
      priceCeilingUsd: Number.isFinite(out.priceCeilingUsd) && out.priceCeilingUsd > 0
        ? Math.round(out.priceCeilingUsd) : 0,
    },
  };
}

/** Tolerate whatever the wire delivered; keep only well-formed positive affinities. */
function toAffinityView(raw: unknown): AffinityView | null {
  if (!raw || typeof raw !== 'object') return null;
  const dims = (raw as { dims?: unknown }).dims;
  if (!dims || typeof dims !== 'object') return null;
  const out: AffinityView = { dims: {}, audiences: [] };
  const aud = (raw as { audiences?: unknown }).audiences;
  if (Array.isArray(aud)) out.audiences = aud.filter((a): a is string => typeof a === 'string');
  for (const [dim, values] of Object.entries(dims as Record<string, unknown>)) {
    if (!values || typeof values !== 'object') continue;
    const clean: Record<string, number> = {};
    for (const [value, a] of Object.entries(values as Record<string, unknown>)) {
      const n = Number(a);
      if (Number.isFinite(n) && n > 0) clean[value] = Math.min(1, n);
    }
    if (Object.keys(clean).length) out.dims[dim] = clean;
  }
  return Object.keys(out.dims).length ? out : null;
}

/** The broad dimension's key in this vertical's registry — where a named category lands. */
function broadKeyFor(vertical: Vertical): string {
  return configFor(vertical).dimensions.find((d) => d.source === 'category')?.key
    ?? (vertical === 'retail' ? 'category' : 'productFamily');
}

export async function search(
  env: Env, vertical: Vertical, query: string, affinityRaw?: unknown,
): Promise<SearchAnswer> {
  const t0 = Date.now();
  const trimmed = query.trim();

  if (!trimmed) {
    return {
      ok: false, query, scene: null, touches: [], intent: { ...EMPTY_INTENT },
      products: [], hero: null, ceiling: null, source: 'none', confidence: 0, ms: 0, fellBack: false,
    };
  }

  const modelTried = Boolean(env.GEMINI_API_KEY);
  const affinity = toAffinityView(affinityRaw);

  // Run the deterministic paths FIRST — instant, free, and they set the budget.
  const localScene = classifyLocally(vertical, trimmed);
  const localIntent = parseIntentLocally(vertical, trimmed);

  // Adaptive budget. When the words clearly match a scene we already have a good
  // answer in hand, so the model only gets a short window to produce a better
  // one. When nothing matched, waiting is worth it — that is the case the model
  // exists for. 0.6 = a single unambiguous alias hit.
  const budget = localScene && localScene.confidence >= 0.6 ? 1_200 : MODEL_TIMEOUT_MS;

  const viaModel = await readWithModel(env, vertical, trimmed, budget).catch(() => null);

  const scene = viaModel
    ? sceneById(vertical, viaModel.scene) ?? null
    : localScene?.scene ?? null;
  const intent = viaModel ? viaModel.intent : localIntent;

  // A ceiling stated in words is parsed, never inferred — the deterministic
  // parse wins; the model's reading covers phrasings the regex does not.
  const ceiling = parseCeiling(trimmed)
    ?? (intent.priceCeilingUsd > 0 ? intent.priceCeilingUsd : null);

  // Rank only when the sentence gave us something to rank WITH — a scene, or a
  // named facet. Otherwise "nothing matched" stays an honest empty answer
  // instead of eight arbitrary products.
  const products = (scene || intentHasSignal(intent))
    ? rankByIntent(vertical, itemsFor(vertical), intent,
        { touches: scene?.touches ?? [], ceiling, affinity })
    : [];

  // Scene touches plus one broad touch per named category, so "sweaters" moves
  // the category bar through the same apply() every click goes through.
  const broadKey = broadKeyFor(vertical);
  const touches: Touch[] = [...(scene?.touches ?? [])];
  for (const category of intent.categories) {
    if (!touches.some((t) => t.dim === broadKey && t.value === category)) {
      touches.push({ dim: broadKey, value: category });
    }
  }

  const hero = scene
    ? { image: scene.image ?? scene.art, productId: products[0] ?? null }
    : null;

  if (viaModel && scene) {
    return {
      ok: true, query: trimmed, scene, touches, intent, products, hero, ceiling,
      source: 'model', confidence: viaModel.confidence, ms: Date.now() - t0, fellBack: false,
    };
  }

  // Local answer. Confidence mirrors classifyLocally's own scale; an
  // intent-only hit (noun matched, no scene) reports a steady middle value
  // derived from how many facets matched rather than a pretend model score.
  const facetHits = intent.categories.length + intent.lines.length
    + intent.colours.length + intent.occasions.length;
  const intentConfidence = facetHits > 0 ? Math.min(0.9, 0.5 + facetHits * 0.1) : 0;
  const answered = Boolean(scene) || products.length > 0;

  return {
    ok: answered,
    query: trimmed,
    scene,
    touches,
    intent,
    products,
    hero,
    ceiling,
    source: answered ? 'local' : 'none',
    confidence: Math.max(localScene?.confidence ?? 0, intentConfidence),
    ms: Date.now() - t0,
    fellBack: modelTried,
  };
}

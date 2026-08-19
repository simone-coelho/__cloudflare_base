// src/demos/brighthour/offerDesk.ts
// ─────────────────────────────────────────────────────────────────────────────
// The Offer Desk — the OPERATOR half of Beat 2 (recon §C4, brief §3 item 2).
//
// One item's journey, and the three places state lives:
//
//   2a INGEST    a vendor-feed row lands with SPARSE metadata (staging.data.json:
//                item number, title, price, one line of copy, and a category hint
//                that is sometimes absent and sometimes WRONG).      state: staged
//   2b PROPOSE   a real design-time model call proposes the tags the decisioning
//                engine actually needs — category, subcategory, brandPersonality,
//                occasion, priceBand — plus the offer construct itself, each with
//                a confidence and a one-line rationale.            state: proposed
//   2c APPROVE   a human accepts most of them, EDITS one, REJECTS one, and picks
//                the window. Who, when, and exactly which fields they touched are
//                stamped into provenance.                          state: approved
//   2d OPEN      nothing else happens. The approved item joins the composition's
//                candidate set and its WINDOW decides the rest — preview until
//                start, live at start, expired at end, successor takes the slot.
//
// The house discipline this module keeps:
//
//   • PURE CORE, THIN WRAPPER. Every transformation below (mockProposal,
//     normalizeProposal, applyApproval, approvedRawItem) is a pure function of
//     its arguments with `now` passed in. Only the small KV section at the bottom
//     touches the outside, and it touches exactly one prefix: `bh:offerdesk:`.
//   • NOTHING DERIVABLE IS STORED. An approved record stores tags, a window and
//     provenance. It never stores a lifecycle state — that is derived from
//     (window, now, config) by offerLifecycle.lifecycleStateAt(), the same way it
//     is for every catalog item. An approved offer gets no shortcut through the
//     gates; it goes through them.
//   • CLOSED VOCABULARIES. The model may only propose values that already exist
//     in the taxonomy (TAXONOMY / BRAND_PERSONALITIES / OCCASIONS / CONSTRUCTS
//     below, mirroring catalog.data.json exactly). An out-of-vocabulary answer is
//     replaced by the deterministic fallback and marked as such — a merchandiser
//     is never shown an invented shelf.
//   • ONE HONEST PROVENANCE FIELD. `proposedBy` is 'ai' when a real model call
//     produced the tags and 'ai-mock' when the deterministic fallback did (no API
//     key, or the call failed). The UI renders whichever it is; it never pretends.
//   • priceBand is a RULE, not a guess (entry <40 · core 40–120 · elevated
//     120–300 · premium 300+, recon §B3), so it is computed and carries
//     `source: 'rule'` with confidence 1. Showing which tags are arithmetic and
//     which are inference is the point of a confidence column.
// ─────────────────────────────────────────────────────────────────────────────

import stagingData from './staging.data.json';
import { MS_PER_HOUR, toIso } from './demoClock';
import {
  DEFAULT_LIFECYCLE_CONFIG,
  lifecycleStateAt,
  type LifecycleConfig,
  type LifecycleState,
} from './offerLifecycle';
// Their availability vocabulary, from the one place it is declared (§A6) — the
// desk may narrow it, never invent a member.
import type { Ats, UrgencyState } from './types';

// ── Closed vocabularies (mirror catalog.data.json — the desk invents nothing) ─

/** Primary shelf → its subcategories → their merch class codes (§A7). */
export const TAXONOMY: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  'Kitchen & Table': {
    'Cookware & Dutch Ovens': 'K221',
    'Countertop Cooking': 'K232',
    'Coffee & Tea': 'K245',
    'Cutlery & Prep': 'K258',
    'Tabletop & Serveware': 'K266',
    Bakeware: 'K274',
    'Food Storage': 'K281',
  },
  'For the Home': {
    Bedding: 'H402',
    'Bath & Towels': 'H411',
    Lighting: 'H420',
    'Storage & Organization': 'H433',
    'Decor & Accents': 'H444',
    'Rugs & Floor': 'H455',
  },
  'Beauty & Wellness': {
    Skincare: 'B302',
    'Hair Care': 'B311',
    'Bath & Body': 'B320',
    Cosmetics: 'B333',
    'Beauty Tools & Devices': 'B355',
  },
  Fashion: {
    'Tops & Knits': 'F501',
    Outerwear: 'F512',
    Bottoms: 'F523',
    'Shoes & Slippers': 'F534',
    'Handbags & Accessories': 'F545',
  },
  Jewelry: {
    Rings: 'J601',
    'Necklaces & Pendants': 'J612',
    Earrings: 'J623',
    'Bracelets & Anklets': 'J634',
  },
  'Electronics & Tech': {
    'Headphones & Speakers': 'E701',
    'Home Entertainment': 'E712',
    'Smart Home': 'E723',
    'Personal Tech': 'E734',
    'Power & Charging': 'E745',
    'Projection & Streaming': 'E756',
  },
  'Garden & Outdoor': {
    'Planters & Pots': 'G801',
    'Outdoor Decor & Lighting': 'G812',
    'Grills & Fire': 'G823',
    'Lawn & Garden Tools': 'G834',
    'Patio Furniture': 'G845',
  },
  'Food & Wine': {
    'Coffee & Cocoa': 'W901',
    'Bakery & Sweets': 'W912',
    'Pantry & Preserves': 'W923',
    'Meals & Entrees': 'W934',
  },
};

/** Category display name → the id the catalog's `categories[]` carries. */
export const CATEGORY_IDS: Readonly<Record<string, string>> = {
  'Kitchen & Table': 'KIT',
  'For the Home': 'HOM',
  'Beauty & Wellness': 'BEA',
  Fashion: 'FAS',
  Jewelry: 'JEW',
  'Electronics & Tech': 'ELE',
  'Garden & Outdoor': 'GAR',
  'Food & Wine': 'FDW',
};

export const CATEGORIES: readonly string[] = Object.keys(TAXONOMY);

export const BRAND_PERSONALITIES: readonly string[] = [
  'heritage-classic',
  'modern-clean',
  'host-led',
  'value-workhorse',
  'artisan',
  'tech-forward',
];

export const OCCASIONS: readonly string[] = [
  'everyday',
  'entertaining',
  'weeknight',
  'gifting',
  'morning',
  'workday',
  'cozy-nights',
  'self-care',
  'travel',
  'weekend',
  'evening',
  'outdoor-living',
  'celebration',
];

export const PRICE_BANDS: readonly string[] = ['entry', 'core', 'elevated', 'premium'];

/** The offer constructs a merchandiser may put a new item into (§B4). */
export interface ConstructSpec {
  code: string;
  label: string;
  type: string;
  badgeBucket: string;
  /** Only flagged constructs get the presale lead (their tsvpresale pattern, §A5). */
  presaleEligible: boolean;
  /** Typical authored length, offered as the window default. */
  defaultDurationHours: number;
}

export const CONSTRUCTS: Readonly<Record<string, ConstructSpec>> = {
  TBO: {
    code: 'TBO',
    label: "Today's Bright One℠",
    type: 'daily_deal',
    badgeBucket: 'tsv',
    presaleEligible: true,
    defaultDurationHours: 24,
  },
  BH2: {
    code: 'BH2',
    label: 'BH2 Nightly Deal℠',
    type: 'daily_deal',
    badgeBucket: 'tsv',
    presaleEligible: false,
    defaultDurationHours: 12,
  },
  DDP: {
    code: 'DDP',
    label: 'Deal Drop℠',
    type: 'limited_time_event',
    badgeBucket: 'sale',
    presaleEligible: false,
    defaultDurationHours: 6,
  },
  LHS: {
    code: 'LHS',
    label: 'Lunch Hour Steals®',
    type: 'limited_time_event',
    badgeBucket: 'sale',
    presaleEligible: false,
    defaultDurationHours: 2,
  },
  PTS: {
    code: 'PTS',
    label: 'Primetime Steals℠',
    type: 'limited_time_event',
    badgeBucket: 'sale',
    presaleEligible: false,
    defaultDurationHours: 3,
  },
  OTO: {
    code: 'OTO',
    label: 'One Time Only Price',
    type: 'one_time_only',
    badgeBucket: 'sale',
    presaleEligible: false,
    defaultDurationHours: 48,
  },
  WEB: {
    code: 'WEB',
    label: 'Online Special Deal',
    type: 'web_exclusive',
    badgeBucket: 'webonly',
    presaleEligible: false,
    defaultDurationHours: 72,
  },
  EBV: {
    code: 'EBV',
    label: 'Everyday Bright Value',
    type: 'evergreen',
    badgeBucket: 'informational',
    presaleEligible: false,
    defaultDurationHours: 168,
  },
  FIN_S: {
    code: 'FIN_S',
    label: 'Final Sale Price',
    type: 'final_sale',
    badgeBucket: 'sale',
    presaleEligible: false,
    defaultDurationHours: 24,
  },
};

/** offer.type → the shopper-facing urgency posture (mirrors the catalog 1:1). */
const URGENCY_CUE_BY_TYPE: Readonly<Record<string, string>> = {
  daily_deal: 'time_bound',
  limited_time_event: 'time_bound',
  one_time_only: 'until_gone',
  clearance: 'standing',
  evergreen: 'standing',
  web_exclusive: 'standing',
  final_sale: 'standing',
};

/** The six tags the desk proposes, in the order the operator reads them. */
export const TAG_KEYS = [
  'category',
  'subcategory',
  'brandPersonality',
  'occasion',
  'priceBand',
  'offerCode',
] as const;

export type TagKey = (typeof TAG_KEYS)[number];

/**
 * Which tags a merchandiser may REJECT outright. category / subcategory /
 * priceBand / offerCode are load-bearing for the decision — an item cannot be
 * ranked or badged without them — so the desk makes you EDIT those rather than
 * letting you publish a hole. Refusing a bad reject is part of the human loop.
 */
export const REJECTABLE_TAGS: readonly TagKey[] = ['brandPersonality', 'occasion'];

export const TAG_LABELS: Readonly<Record<TagKey, string>> = {
  category: 'Category',
  subcategory: 'Subcategory',
  brandPersonality: 'Brand personality',
  occasion: 'Occasion',
  priceBand: 'Price band',
  offerCode: 'Offer construct',
};

// ── Record shapes ────────────────────────────────────────────────────────────

export type DeskState = 'staged' | 'proposed' | 'approved';

/** A vendor-feed row exactly as staging.data.json carries it (Beat 2a). */
export interface StagedItem {
  itemNumber: string;
  name: string;
  brandName?: string | null;
  price_usd: number;
  shortDescription?: string | null;
  /** Absent on one row, WRONG on another — that is the point of the beat. */
  categoryHint?: string | null;
  source?: string | null;
  receivedOffsetHours?: number | null;
}

export interface ProposedTag {
  key: TagKey;
  label: string;
  value: string;
  /** 0–1. Rule-derived tags carry 1. */
  confidence: number;
  /** One line, shown verbatim in the proposal card. */
  rationale: string;
  /** Where the value came from — 'rule' is arithmetic, 'model' is inference. */
  source: 'model' | 'rule';
  /** False for category/subcategory/priceBand/offerCode (see REJECTABLE_TAGS). */
  rejectable: boolean;
}

export interface Proposal {
  /** 'ai' = a real model call answered. 'ai-mock' = the deterministic fallback. */
  proposedBy: 'ai' | 'ai-mock';
  /** Model id when proposedBy === 'ai', else null. */
  model: string | null;
  proposedAt: string;
  tags: ProposedTag[];
  /** Values the model returned that the vocabulary refused, for the glass box. */
  corrections: Array<{ key: TagKey; rejectedValue: string; usedValue: string }>;
  /** Present when the model contradicted the feed's own category hint. */
  hintConflict: { hint: string; proposed: string } | null;
}

/** The window a HUMAN chose at approval time. Absolute instant + a length. */
export interface DeskWindow {
  /** Real instant the offer opens. Always present on an approved record. */
  startMs: number;
  durationHours: number;
}

export interface Provenance {
  proposedBy: 'ai' | 'ai-mock' | null;
  approvedBy: string | null;
  /** Tags whose value the human changed, e.g. ['brandPersonality']. */
  editedFields: TagKey[];
  /** Tags the human refused, e.g. ['occasion']. */
  rejectedFields: TagKey[];
  timestamps: {
    stagedAt: string;
    proposedAt: string | null;
    approvedAt: string | null;
  };
}

export interface OfferDeskRecord {
  itemNumber: string;
  state: DeskState;
  staged: StagedItem;
  proposal: Proposal | null;
  /** The approved tag values — the human's answer, not the model's. */
  approvedTags: Partial<Record<TagKey, string>> | null;
  window: DeskWindow | null;
  provenance: Provenance;
  updatedAt: string;
}

// ── Small pure helpers ───────────────────────────────────────────────────────

function clamp01(n: unknown): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.min(1, Math.max(0, Math.round(v * 100) / 100));
}

function text(v: unknown, fallback = ''): string {
  return typeof v === 'string' && v.trim() ? v.trim() : fallback;
}

/** entry <40 · core 40–120 · elevated 120–300 · premium 300+ (recon §B3). */
export function priceBandOf(price: number): string {
  const p = Number(price) || 0;
  if (p < 40) return 'entry';
  if (p < 120) return 'core';
  if (p < 300) return 'elevated';
  return 'premium';
}

/** A stable merch class code for a subcategory the taxonomy already knows. */
function classCodeOf(category: string, subcategory: string): string {
  return TAXONOMY[category]?.[subcategory] ?? 'K221';
}

export function slugOf(s: string): string {
  return (s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72);
}

/** The staged rows, straight off the file (Beat 2a's incoming tray). */
export function stagedItems(): StagedItem[] {
  const items = (stagingData as { items?: StagedItem[] }).items ?? [];
  return items.filter((i) => typeof i?.itemNumber === 'string' && i.itemNumber.length > 0);
}

export function newRecord(staged: StagedItem, nowMs: number): OfferDeskRecord {
  const at = toIso(nowMs);
  return {
    itemNumber: staged.itemNumber,
    state: 'staged',
    staged,
    proposal: null,
    approvedTags: null,
    window: null,
    provenance: {
      proposedBy: null,
      approvedBy: null,
      editedFields: [],
      rejectedFields: [],
      timestamps: { stagedAt: at, proposedAt: null, approvedAt: null },
    },
    updatedAt: at,
  };
}

// ── Beat 2b: the deterministic proposal (the labeled fallback) ───────────────

interface KeywordRule {
  words: readonly string[];
  category: string;
  subcategory: string;
  /** Confidence when this rule fires — fixed, so the fallback replays exactly. */
  confidence: number;
}

/**
 * A tiny keyword index over (name + description). Deliberately small and
 * legible: when no API key is configured this is what the merchandiser sees,
 * and it must produce a proposal worth arguing with — including the middling
 * confidences that make the human loop mean something.
 */
const KEYWORD_RULES: readonly KeywordRule[] = [
  { words: ['dutch oven', 'cast iron', 'braiser', 'stockpot', 'saucepan', 'skillet'], category: 'Kitchen & Table', subcategory: 'Cookware & Dutch Ovens', confidence: 0.94 },
  { words: ['air fryer', 'blender', 'toaster', 'pressure cooker', 'griddle'], category: 'Kitchen & Table', subcategory: 'Countertop Cooking', confidence: 0.91 },
  { words: ['espresso', 'coffee maker', 'kettle', 'french press', 'tea'], category: 'Kitchen & Table', subcategory: 'Coffee & Tea', confidence: 0.88 },
  { words: ['knife', 'cutting board', 'shears'], category: 'Kitchen & Table', subcategory: 'Cutlery & Prep', confidence: 0.9 },
  { words: ['platter', 'serving bowl', 'dinnerware', 'flatware'], category: 'Kitchen & Table', subcategory: 'Tabletop & Serveware', confidence: 0.86 },
  { words: ['baking', 'sheet pan', 'loaf pan', 'cake'], category: 'Kitchen & Table', subcategory: 'Bakeware', confidence: 0.85 },
  { words: ['storage set', 'food storage', 'canister'], category: 'Kitchen & Table', subcategory: 'Food Storage', confidence: 0.84 },
  { words: ['lamp', 'sconce', 'chandelier', 'lantern', 'lighting'], category: 'For the Home', subcategory: 'Lighting', confidence: 0.92 },
  { words: ['duvet', 'sheet set', 'comforter', 'pillow', 'quilt'], category: 'For the Home', subcategory: 'Bedding', confidence: 0.9 },
  { words: ['towel', 'bath mat', 'robe'], category: 'For the Home', subcategory: 'Bath & Towels', confidence: 0.87 },
  { words: ['throw', 'vase', 'candle', 'wall art', 'mirror', 'decor'], category: 'For the Home', subcategory: 'Decor & Accents', confidence: 0.83 },
  { words: ['bin', 'basket', 'shelf', 'organizer'], category: 'For the Home', subcategory: 'Storage & Organization', confidence: 0.82 },
  { words: ['rug', 'runner', 'doormat'], category: 'For the Home', subcategory: 'Rugs & Floor', confidence: 0.88 },
  { words: ['serum', 'moisturizer', 'cleanser', 'skincare'], category: 'Beauty & Wellness', subcategory: 'Skincare', confidence: 0.9 },
  { words: ['hair dryer', 'shampoo', 'curling'], category: 'Beauty & Wellness', subcategory: 'Hair Care', confidence: 0.87 },
  { words: ['lotion', 'body wash', 'bath soak'], category: 'Beauty & Wellness', subcategory: 'Bath & Body', confidence: 0.85 },
  { words: ['lipstick', 'mascara', 'foundation'], category: 'Beauty & Wellness', subcategory: 'Cosmetics', confidence: 0.88 },
  { words: ['cardigan', 'sweater', 'tunic', 'knit top', 'blouse'], category: 'Fashion', subcategory: 'Tops & Knits', confidence: 0.89 },
  { words: ['jacket', 'coat', 'parka', 'vest'], category: 'Fashion', subcategory: 'Outerwear', confidence: 0.88 },
  { words: ['pant', 'legging', 'jean', 'skirt'], category: 'Fashion', subcategory: 'Bottoms', confidence: 0.86 },
  { words: ['slipper', 'sneaker', 'boot', 'sandal'], category: 'Fashion', subcategory: 'Shoes & Slippers', confidence: 0.87 },
  { words: ['handbag', 'tote', 'crossbody', 'wallet'], category: 'Fashion', subcategory: 'Handbags & Accessories', confidence: 0.86 },
  { words: ['earring', 'drop earrings', 'stud'], category: 'Jewelry', subcategory: 'Earrings', confidence: 0.93 },
  { words: ['necklace', 'pendant', 'chain'], category: 'Jewelry', subcategory: 'Necklaces & Pendants', confidence: 0.91 },
  { words: ['bracelet', 'anklet', 'bangle'], category: 'Jewelry', subcategory: 'Bracelets & Anklets', confidence: 0.9 },
  { words: ['ring', 'band'], category: 'Jewelry', subcategory: 'Rings', confidence: 0.84 },
  { words: ['headphone', 'earbud', 'speaker', 'soundbar'], category: 'Electronics & Tech', subcategory: 'Headphones & Speakers', confidence: 0.9 },
  { words: ['tv', 'television', 'streaming stick'], category: 'Electronics & Tech', subcategory: 'Home Entertainment', confidence: 0.88 },
  { words: ['smart plug', 'doorbell', 'thermostat', 'smart home'], category: 'Electronics & Tech', subcategory: 'Smart Home', confidence: 0.86 },
  { words: ['tablet', 'laptop', 'smartwatch'], category: 'Electronics & Tech', subcategory: 'Personal Tech', confidence: 0.85 },
  { words: ['charger', 'power bank', 'charging'], category: 'Electronics & Tech', subcategory: 'Power & Charging', confidence: 0.86 },
  { words: ['planter', 'pot set'], category: 'Garden & Outdoor', subcategory: 'Planters & Pots', confidence: 0.88 },
  { words: ['string lights', 'garden stake', 'outdoor lantern'], category: 'Garden & Outdoor', subcategory: 'Outdoor Decor & Lighting', confidence: 0.85 },
  { words: ['grill', 'fire pit', 'smoker'], category: 'Garden & Outdoor', subcategory: 'Grills & Fire', confidence: 0.89 },
  { words: ['pruner', 'hose', 'garden tool'], category: 'Garden & Outdoor', subcategory: 'Lawn & Garden Tools', confidence: 0.85 },
  { words: ['patio', 'adirondack', 'outdoor chair'], category: 'Garden & Outdoor', subcategory: 'Patio Furniture', confidence: 0.86 },
  { words: ['coffee beans', 'cocoa'], category: 'Food & Wine', subcategory: 'Coffee & Cocoa', confidence: 0.87 },
  { words: ['cookie', 'brownie', 'cake tin'], category: 'Food & Wine', subcategory: 'Bakery & Sweets', confidence: 0.85 },
  { words: ['preserve', 'jam', 'olive oil', 'pantry'], category: 'Food & Wine', subcategory: 'Pantry & Preserves', confidence: 0.84 },
  { words: ['entree', 'meal kit', 'lasagna'], category: 'Food & Wine', subcategory: 'Meals & Entrees', confidence: 0.85 },
];

const PERSONALITY_RULES: ReadonlyArray<{ words: readonly string[]; value: string; confidence: number }> = [
  { words: ['brushed brass', 'marble', 'linen', 'matte', 'minimal'], value: 'modern-clean', confidence: 0.71 },
  { words: ['pearl', 'sterling', 'hand-', 'handmade', 'artisan', 'hand loomed'], value: 'artisan', confidence: 0.68 },
  { words: ['heirloom', 'heritage', 'damask', 'hand-thrown', 'classic'], value: 'heritage-classic', confidence: 0.58 },
  // Enamelled cast iron reads as a workhorse to a keyword index — which is
  // exactly the call a merchandiser overturns in Beat 2c, and the reason this
  // rule's confidence sits in the middle of the range rather than the top.
  { words: ['cast iron', 'enamel', 'stainless', 'nonstick', 'workhorse'], value: 'value-workhorse', confidence: 0.52 },
  { words: ['bluetooth', 'smart', 'wireless', 'digital'], value: 'tech-forward', confidence: 0.74 },
];

const OCCASION_RULES: ReadonlyArray<{ words: readonly string[]; value: string; confidence: number }> = [
  { words: ['serve', 'entertain', 'platter', 'table', 'guests'], value: 'entertaining', confidence: 0.38 },
  { words: ['lamp', 'throw', 'candle', 'evening', 'warm'], value: 'cozy-nights', confidence: 0.44 },
  { words: ['pearl', 'earring', 'necklace', 'gift'], value: 'gifting', confidence: 0.57 },
  { words: ['coffee', 'morning', 'breakfast'], value: 'morning', confidence: 0.52 },
];

function haystack(staged: StagedItem): string {
  return `${staged.name} ${staged.shortDescription ?? ''} ${staged.brandName ?? ''}`.toLowerCase();
}

function makeTag(
  key: TagKey,
  value: string,
  confidence: number,
  rationale: string,
  source: 'model' | 'rule' = 'model'
): ProposedTag {
  return {
    key,
    label: TAG_LABELS[key],
    value,
    confidence: clamp01(confidence),
    rationale,
    source,
    rejectable: REJECTABLE_TAGS.includes(key),
  };
}

/** Which construct suits a brand-new item at this price — the desk's default. */
function defaultConstruct(price: number): string {
  if (price >= 60) return 'TBO';
  return 'DDP';
}

/**
 * The deterministic proposal. Same staged row ⇒ byte-identical tags, so a
 * rehearsal and the live run behave the same when no key is configured.
 */
export function mockProposal(staged: StagedItem, nowMs: number): Proposal {
  const hay = haystack(staged);
  const price = Number(staged.price_usd) || 0;

  const rule = KEYWORD_RULES.find((r) => r.words.some((w) => hay.includes(w)));
  const category = rule?.category ?? text(staged.categoryHint, 'For the Home');
  const subcategory = rule?.subcategory ?? Object.keys(TAXONOMY[category] ?? TAXONOMY['For the Home'])[0];
  const catConfidence = rule ? rule.confidence : 0.41;

  const personality = PERSONALITY_RULES.find((r) => r.words.some((w) => hay.includes(w)));
  const occasion = OCCASION_RULES.find((r) => r.words.some((w) => hay.includes(w)));
  const construct = defaultConstruct(price);

  const hint = text(staged.categoryHint);
  const tags: ProposedTag[] = [
    makeTag(
      'category',
      category,
      catConfidence,
      rule
        ? `"${rule.words.find((w) => hay.includes(w))}" in the title puts this on the ${category} shelf.`
        : `No keyword matched; falling back to ${category} — a merchandiser should confirm this one.`
    ),
    makeTag('subcategory', subcategory, Math.max(0.3, catConfidence - 0.06), `Nearest class in the ${category} taxonomy (${classCodeOf(category, subcategory)}).`),
    makeTag(
      'brandPersonality',
      personality?.value ?? 'value-workhorse',
      personality?.confidence ?? 0.52,
      personality
        ? `Materials language ("${personality.words.find((w) => hay.includes(w))}") reads ${personality.value}.`
        : 'No strong style signal in one line of copy; defaulting to value-workhorse.'
    ),
    makeTag(
      'occasion',
      occasion?.value ?? 'everyday',
      occasion?.confidence ?? 0.35,
      occasion
        ? `Copy suggests ${occasion.value}, but one line is thin evidence.`
        : 'Nothing in the feed row indicates an occasion; everyday is the safe floor.'
    ),
    makeTag('priceBand', priceBandOf(price), 1, `$${price.toFixed(2)} falls in ${priceBandOf(price)} on the published band table — arithmetic, not inference.`, 'rule'),
    makeTag(
      'offerCode',
      construct,
      construct === 'TBO' ? 0.66 : 0.61,
      construct === 'TBO'
        ? 'Single hero item at a one-day price — the Today’s Bright One construct fits.'
        : 'Short intraday construct suits an entry-price item; a Deal Drop is the lighter lift.'
    ),
  ];

  return {
    proposedBy: 'ai-mock',
    model: null,
    proposedAt: toIso(nowMs),
    tags,
    corrections: [],
    hintConflict: hint && hint !== category ? { hint, proposed: category } : null,
  };
}

// ── Beat 2b: normalizing a real model answer against the vocabularies ─────────

/** One field as the model returns it. */
export interface RawModelTag {
  value?: unknown;
  confidence?: unknown;
  rationale?: unknown;
}

export type RawModelProposal = Partial<Record<TagKey, RawModelTag>>;

/**
 * Turn a model answer into a proposal, enforcing the closed vocabularies. Any
 * value the taxonomy does not contain is replaced by the deterministic
 * fallback's value and recorded in `corrections` — the merchandiser sees the
 * substitution rather than an invented shelf, and the glass box can show both.
 */
export function normalizeProposal(
  raw: RawModelProposal,
  staged: StagedItem,
  nowMs: number,
  model: string
): Proposal {
  const fallback = mockProposal(staged, nowMs);
  const fallbackTag = (key: TagKey): ProposedTag =>
    fallback.tags.find((t) => t.key === key) ?? makeTag(key, '', 0, 'no fallback');
  const corrections: Proposal['corrections'] = [];

  const pick = (key: TagKey, allowed: readonly string[]): ProposedTag => {
    const fb = fallbackTag(key);
    const proposed = text(raw[key]?.value);
    if (!proposed) return fb;
    const match = allowed.find((a) => a.toLowerCase() === proposed.toLowerCase());
    if (!match) {
      corrections.push({ key, rejectedValue: proposed, usedValue: fb.value });
      return fb;
    }
    return makeTag(
      key,
      match,
      clamp01(raw[key]?.confidence),
      text(raw[key]?.rationale, fb.rationale)
    );
  };

  const category = pick('category', CATEGORIES);
  const subcategory = pick('subcategory', Object.keys(TAXONOMY[category.value] ?? {}));
  const price = Number(staged.price_usd) || 0;

  const tags: ProposedTag[] = [
    category,
    subcategory,
    pick('brandPersonality', BRAND_PERSONALITIES),
    pick('occasion', OCCASIONS),
    // priceBand is arithmetic. The model is never allowed to move it; if it
    // disagreed, that disagreement is logged as a correction and dropped.
    makeTag(
      'priceBand',
      priceBandOf(price),
      1,
      `$${price.toFixed(2)} falls in ${priceBandOf(price)} on the published band table — arithmetic, not inference.`,
      'rule'
    ),
    pick('offerCode', Object.keys(CONSTRUCTS)),
  ];

  const modelBand = text(raw.priceBand?.value);
  if (modelBand && modelBand !== priceBandOf(price)) {
    corrections.push({ key: 'priceBand', rejectedValue: modelBand, usedValue: priceBandOf(price) });
  }

  const hint = text(staged.categoryHint);
  return {
    proposedBy: 'ai',
    model,
    proposedAt: toIso(nowMs),
    tags,
    corrections,
    hintConflict: hint && hint !== category.value ? { hint, proposed: category.value } : null,
  };
}

// ── Beat 2b: the real design-time model call ─────────────────────────────────

export interface OfferDeskEnv {
  CACHE?: KVNamespace;
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
}

function taggingPrompt(staged: StagedItem): string {
  const price = Number(staged.price_usd) || 0;
  const subcats = CATEGORIES.map((c) => `${c}: ${Object.keys(TAXONOMY[c]).join(' | ')}`).join('\n  ');
  const constructs = Object.values(CONSTRUCTS)
    .map((c) => `${c.code} = "${c.label}" (${c.type})`)
    .join(' · ');
  return (
    `You are a merchandising data steward for a live-shopping retailer. A new item just arrived from a ` +
    `vendor feed with almost no metadata. Propose the tags the personalization engine needs.\n\n` +
    `ITEM\n` +
    `  item number: ${staged.itemNumber}\n` +
    `  title: ${staged.name}\n` +
    `  brand: ${text(staged.brandName, 'unknown')}\n` +
    `  price: $${price.toFixed(2)}\n` +
    `  description: ${text(staged.shortDescription, '(none supplied)')}\n` +
    `  category hint from the feed: ${text(staged.categoryHint, '(absent)')}` +
    ` — the hint is frequently absent and sometimes wrong; judge from the title and description, not the hint.\n\n` +
    `CLOSED VOCABULARIES — every value you return MUST be copied EXACTLY from these lists.\n` +
    `  category: ${CATEGORIES.join(' | ')}\n` +
    `  subcategory (must belong to the category you chose):\n  ${subcats}\n` +
    `  brandPersonality: ${BRAND_PERSONALITIES.join(' | ')}\n` +
    `  occasion: ${OCCASIONS.join(' | ')}\n` +
    `  priceBand: entry (<$40) | core ($40-120) | elevated ($120-300) | premium ($300+)\n` +
    `  offerCode: ${constructs}\n\n` +
    `For EVERY field return an object { value, confidence, rationale }.\n` +
    `  confidence: 0-1, your honest calibrated certainty. One line of vendor copy is thin evidence — ` +
    `do not return 0.9 for a style judgement you are guessing at.\n` +
    `  rationale: ONE short sentence a merchandiser will read, citing what in the item told you.\n` +
    `Return JSON only.`
  );
}

/**
 * Propose tags for a staged item.
 *
 * A REAL model call when GEMINI_API_KEY is configured (the repo's existing
 * @ai-sdk/google + generateObject pattern, imported lazily so the pure core and
 * its tests never load the SDK). No key, or any failure at all, falls back to
 * mockProposal — labeled `proposedBy: 'ai-mock'` so the UI can say which it was.
 * Never throws: a demo does not lose the beat because a network hiccuped.
 */
export async function proposeTags(
  env: OfferDeskEnv | null | undefined,
  staged: StagedItem,
  nowMs: number
): Promise<Proposal> {
  const apiKey = env?.GEMINI_API_KEY;
  if (!apiKey) return mockProposal(staged, nowMs);
  const model = env?.GEMINI_MODEL || 'gemini-2.5-flash';
  try {
    const [{ generateObject }, { createGoogleGenerativeAI }, { z }] = await Promise.all([
      import('ai'),
      import('@ai-sdk/google'),
      import('zod'),
    ]);
    const tag = z.object({
      value: z.string(),
      confidence: z.number(),
      rationale: z.string(),
    });
    const schema = z.object({
      category: tag,
      subcategory: tag,
      brandPersonality: tag,
      occasion: tag,
      priceBand: tag,
      offerCode: tag,
    });
    const google = createGoogleGenerativeAI({ apiKey });
    const { object } = await generateObject({
      model: google(model),
      schema,
      prompt: taggingPrompt(staged),
    });
    return normalizeProposal(object as RawModelProposal, staged, nowMs, model);
  } catch (err) {
    console.error('offerDesk proposeTags fell back to the deterministic proposal:', err);
    return mockProposal(staged, nowMs);
  }
}

// ── Beat 2c: approval, with the edits and the rejects on the record ──────────

export interface ApprovalInput {
  approvedBy?: string | null;
  /** Tag values the human changed: { brandPersonality: 'heritage-classic' }. */
  edits?: Partial<Record<TagKey, string>> | null;
  /** Tags the human refused outright: ['occasion']. */
  rejects?: readonly TagKey[] | null;
  /** Window the human chose. Absent ⇒ opens now for the construct's default run. */
  window?: {
    startMs?: number | null;
    startInMinutes?: number | null;
    startOffsetHours?: number | null;
    durationHours?: number | null;
    durationMinutes?: number | null;
  } | null;
  /** Epoch the demo's offsets are measured from — only needed for startOffsetHours. */
  epochMs?: number | null;
}

export class ApprovalError extends Error {}

/** Allowed values for a tag, given the category already chosen. */
export function allowedValuesFor(key: TagKey, category: string): readonly string[] {
  switch (key) {
    case 'category':
      return CATEGORIES;
    case 'subcategory':
      return Object.keys(TAXONOMY[category] ?? {});
    case 'brandPersonality':
      return BRAND_PERSONALITIES;
    case 'occasion':
      return OCCASIONS;
    case 'priceBand':
      return PRICE_BANDS;
    case 'offerCode':
      return Object.keys(CONSTRUCTS);
  }
}

/**
 * Apply a merchandiser's decision to a proposed record. PURE.
 *
 * Three refusals, all deliberate — the human loop is only a loop if the system
 * can push back:
 *   • you cannot approve what was never proposed;
 *   • you cannot REJECT a load-bearing tag (category / subcategory / priceBand /
 *     offerCode) — edit it instead of publishing a hole;
 *   • you cannot edit a tag to a value outside the taxonomy.
 */
export function applyApproval(
  record: OfferDeskRecord,
  input: ApprovalInput,
  nowMs: number
): OfferDeskRecord {
  if (!record.proposal) throw new ApprovalError('nothing proposed yet — run propose first');

  const edits = (input.edits ?? {}) as Partial<Record<TagKey, string>>;
  const rejects = (input.rejects ?? []) as TagKey[];

  for (const key of Object.keys(edits) as TagKey[]) {
    if (!TAG_KEYS.includes(key)) throw new ApprovalError(`unknown tag "${key}"`);
  }
  for (const key of rejects) {
    if (!TAG_KEYS.includes(key)) throw new ApprovalError(`unknown tag "${key}"`);
    if (!REJECTABLE_TAGS.includes(key)) {
      throw new ApprovalError(`${TAG_LABELS[key]} is load-bearing — edit it rather than rejecting it`);
    }
  }

  // Category resolves first: it decides which subcategories are legal.
  const proposedOf = (key: TagKey): string =>
    record.proposal?.tags.find((t) => t.key === key)?.value ?? '';
  const category = text(edits.category, proposedOf('category'));
  if (!CATEGORIES.includes(category)) throw new ApprovalError(`"${category}" is not a category on the shelf map`);

  const approvedTags: Partial<Record<TagKey, string>> = {};
  const editedFields: TagKey[] = [];
  const rejectedFields: TagKey[] = [];

  for (const key of TAG_KEYS) {
    if (rejects.includes(key)) {
      rejectedFields.push(key);
      continue;
    }
    const proposed = proposedOf(key);
    const edited = text(edits[key]);
    const value = edited || proposed;
    if (!value) throw new ApprovalError(`${TAG_LABELS[key]} has no value to approve`);
    const allowed = allowedValuesFor(key, category);
    if (!allowed.includes(value)) {
      throw new ApprovalError(`"${value}" is not an allowed ${TAG_LABELS[key].toLowerCase()}`);
    }
    if (edited && edited !== proposed) editedFields.push(key);
    approvedTags[key] = value;
  }

  return {
    ...record,
    state: 'approved',
    approvedTags,
    window: resolveWindow(input, approvedTags.offerCode ?? 'TBO', nowMs),
    provenance: {
      ...record.provenance,
      proposedBy: record.proposal.proposedBy,
      approvedBy: text(input.approvedBy, 'merchandiser'),
      editedFields,
      rejectedFields,
      timestamps: {
        ...record.provenance.timestamps,
        proposedAt: record.proposal.proposedAt,
        approvedAt: toIso(nowMs),
      },
    },
    updatedAt: toIso(nowMs),
  };
}

/**
 * The window the human chose, normalized to an absolute instant + a length.
 * Absolute because an approval happens at a real moment: "opens at 9:42pm" is a
 * fact, and the offsets convention exists for the committed catalog file, not
 * for something a person just scheduled on stage.
 */
export function resolveWindow(input: ApprovalInput, offerCode: string, nowMs: number): DeskWindow {
  const w = input.window ?? {};
  const spec = CONSTRUCTS[offerCode];

  let startMs = nowMs;
  if (Number.isFinite(w.startMs as number)) startMs = Number(w.startMs);
  else if (Number.isFinite(w.startInMinutes as number)) startMs = nowMs + Number(w.startInMinutes) * 60_000;
  else if (Number.isFinite(w.startOffsetHours as number) && Number.isFinite(input.epochMs as number)) {
    startMs = Number(input.epochMs) + Number(w.startOffsetHours) * MS_PER_HOUR;
  }

  let durationHours = spec?.defaultDurationHours ?? 24;
  if (Number.isFinite(w.durationHours as number) && Number(w.durationHours) > 0) {
    durationHours = Number(w.durationHours);
  } else if (Number.isFinite(w.durationMinutes as number) && Number(w.durationMinutes) > 0) {
    durationHours = Number(w.durationMinutes) / 60;
  }

  return { startMs: Math.round(startMs), durationHours };
}

// ── Beat 2d: the approved record as a catalog-shaped item ────────────────────

/**
 * An approved desk record, rendered into exactly the shape catalog.data.json
 * carries — so catalog.ts's own loader materializes it, the flat dimension
 * mirrors land where the reflex core reads them, and the composer cannot tell
 * (or need to know) that this item arrived an hour ago rather than in the
 * committed file. The window is converted back to epoch offsets here because
 * that is the loader's contract; the instants come out identical either way.
 */
export function approvedRawItem(
  record: OfferDeskRecord,
  epochMs: number
): Record<string, unknown> | null {
  if (record.state !== 'approved' || !record.approvedTags || !record.window) return null;
  const t = record.approvedTags;
  const staged = record.staged;
  const price = Math.round((Number(staged.price_usd) || 0) * 100) / 100;
  const category = t.category ?? 'For the Home';
  const subcategory = t.subcategory ?? Object.keys(TAXONOMY[category] ?? {})[0] ?? '';
  const construct = CONSTRUCTS[t.offerCode ?? 'TBO'] ?? CONSTRUCTS.TBO;
  const itemNumber = record.itemNumber;
  const shard = itemNumber.replace(/\D/g, '').slice(0, 2) || '00';
  const stem = `${itemNumber.toLowerCase()}.001`;
  const occasion = t.occasion ? [t.occasion] : [];

  // Their pricing grammar (§A4): comparable retail above our price, our price
  // above the current selling price. Derived from the one number the feed gave
  // us, and rounded to their .98/.99 convention.
  const comparableRetail = Math.round(price * 1.65 * 100) / 100;
  const ourPrice = Math.round(price * 1.25 * 100) / 100;
  const installments = 4;

  return {
    id: itemNumber,
    itemNumber,
    name: staged.name,
    shortDescription: text(staged.shortDescription, staged.name),
    shortDubner: staged.name.slice(0, 40),
    longDescription: text(staged.shortDescription, staged.name),
    bulletedDescription: [],

    brandName: text(staged.brandName, 'The Bright Hour'),
    brand: text(staged.brandName, 'The Bright Hour'),
    brandPersonality: t.brandPersonality ?? null,
    primaryClassCode: classCodeOf(category, subcategory),
    categories: [
      { id: CATEGORY_IDS[category] ?? 'HOM', name: category, primary: true },
      { id: 'NEW', name: 'New Arrivals', primary: false },
      { id: 'DLS', name: 'Deals', primary: false },
    ],

    pricing: {
      comparableRetail,
      ourPrice,
      currentSellingPrice: price,
      priceBand: t.priceBand ?? priceBandOf(price),
      brightPay: {
        code: `C${installments}`,
        installments,
        amount: Math.round((price / installments) * 100) / 100,
        phrasing: `${installments} Bright Pays of $${(Math.round((price / installments) * 100) / 100).toFixed(2)}`,
      },
      cardGatedPay: null,
      specialFinancing: null,
    },

    offer: {
      code: construct.code,
      label: construct.label,
      badgeBucket: construct.badgeBucket,
      type: construct.type,
      window: {
        startOffsetHours: (record.window.startMs - epochMs) / MS_PER_HOUR,
        durationHours: record.window.durationHours,
      },
      lifecycleState: null,
      presaleEligible: construct.presaleEligible,
      parentEvent: null,
      revealIndex: null,
      pinned: false,
    },

    availability: { ats: 'Y', unitsRemaining: 500, maxOrderableQuantity: 5, lowStockThreshold: 50 },
    urgencyState: 'in_stock',
    signals: {
      lastOnAirDate: null,
      lastOnAirOffsetHours: null,
      soldLast30Days: 0,
      bestSeller: false,
      presentedBy: null,
    },
    media: { onAirClip: null },
    merch: {
      season: 'Fall',
      collection: null,
      occasion,
      adaptive: false,
      discoveryTag: 'new-to-you',
      moreInfoTabs: [],
    },
    // A Final Sale construct really is non-returnable — which is exactly what
    // makes it fail the VIP exclusion gate. The desk does not get to opt out of
    // the consequence of the construct the merchandiser chose.
    returnPolicy: construct.type === 'final_sale' ? 'final_sale' : 'standard',
    shippingHandling: 5.5,
    reviews: { count: 0, averageRating: 0 },
    assets: { base: `/img/b/${shard}/`, primary: stem },

    // Flat mirrors — the reflex dimension sources (README "Field mirroring").
    category,
    subcategory,
    price_usd: price,
    currentSellingPrice: price,
    offerType: construct.type,
    urgencyCue: URGENCY_CUE_BY_TYPE[construct.type] ?? 'standing',
    presentedBy: null,
    mediaFormat: 'still',

    occasion,
    colors: [],
    material: '',
    silhouette: '',
    size: '',
    image_url: `/img/b/${shard}/${stem}.jpg`,
    product_url: `/live/${slugOf(staged.name)}.product.${itemNumber}.html`,
    categoryIds: [CATEGORY_IDS[category] ?? 'HOM', 'NEW', 'DLS'],
    categoryNames: [category, 'New Arrivals', 'Deals'],

    // Provenance rides ON the item: the glass box can say who approved this and
    // which fields a human changed, without a second lookup.
    desk: {
      approvedBy: record.provenance.approvedBy,
      proposedBy: record.provenance.proposedBy,
      approvedAt: record.provenance.timestamps.approvedAt,
      editedFields: record.provenance.editedFields,
      rejectedFields: record.provenance.rejectedFields,
    },
  };
}

// ── The operator's timeline chips (staged → proposed → approved → live …) ────

export type DeskChip = DeskState | 'queued' | 'live' | 'expired';

export interface DeskStatus {
  itemNumber: string;
  state: DeskState;
  /** The furthest chip reached — what the UI highlights. */
  chip: DeskChip;
  /** Derived, never stored (see file header). Null before approval. */
  lifecycleState: LifecycleState | null;
  windowStart: string | null;
  windowEnd: string | null;
  /** True while the item is an eligible occupant right now. */
  openNow: boolean;
}

/**
 * The record's status at `now`. Everything after `approved` is DERIVED from the
 * window — the desk writes no further state, which is the whole claim of Beat 2d
 * ("no campaign created, no page rebuilt").
 */
export function statusOf(
  record: OfferDeskRecord,
  nowMs: number,
  cfg: LifecycleConfig = DEFAULT_LIFECYCLE_CONFIG
): DeskStatus {
  if (record.state !== 'approved' || !record.window) {
    return {
      itemNumber: record.itemNumber,
      state: record.state,
      chip: record.state,
      lifecycleState: null,
      windowStart: null,
      windowEnd: null,
      openNow: false,
    };
  }
  const startMs = record.window.startMs;
  const endMs = startMs + record.window.durationHours * MS_PER_HOUR;
  const windowStart = toIso(startMs);
  const windowEnd = toIso(endMs);
  const lifecycleState = lifecycleStateAt({ windowStart, windowEnd }, nowMs, cfg);
  const openNow = lifecycleState === 'live' || lifecycleState === 'ending_today';
  const chip: DeskChip =
    lifecycleState === 'expired' || lifecycleState === 'postsale'
      ? 'expired'
      : openNow
        ? 'live'
        : 'queued';
  return {
    itemNumber: record.itemNumber,
    state: 'approved',
    chip,
    lifecycleState,
    windowStart,
    windowEnd,
    openNow,
  };
}

// ── Beat 8's trigger: an availability override the desk owns ────────────────

/**
 * A merchandiser (or a presenter mid-beat) marking an item sold through, or
 * putting it back. This is the ONLY thing the desk may say about a catalog item
 * it did not create, and it says exactly one thing: its availability.
 *
 * It is an OVERRIDE, not an edit: the committed catalog file is never written,
 * and clearing it restores whatever the file says. Everything downstream — the
 * availability gate, the waitlist retention, the successor taking the slot — is
 * the composer's existing machinery reacting to the changed fact.
 */
export interface AvailabilityOverride {
  itemNumber: string;
  /** Their machine model (§A6). 'N' = sold through, 'W' = waitlist, 'Y' = sellable. */
  ats: Ats;
  /** Their exact shopper-facing string for that state. */
  urgencyState: UrgencyState;
  setBy: string | null;
  setAt: string;
}

/** ats → the state string that goes with it. One mapping, no free text. */
const STATE_FOR_ATS: Readonly<Record<Ats, UrgencyState>> = {
  Y: 'in_stock',
  N: 'sold_out',
  W: 'waitlist',
};

export function newOverride(
  itemNumber: string,
  ats: Ats,
  setBy: string | null,
  nowMs: number
): AvailabilityOverride {
  return {
    itemNumber,
    ats,
    urgencyState: STATE_FOR_ATS[ats],
    setBy: text(setBy, 'merchandiser'),
    setAt: toIso(nowMs),
  };
}

/**
 * Apply the overrides to a materialized item list. PURE.
 *
 * Both forms are written because both are read: the gates and the projection
 * take `availability.ats` (nested), while the loader's flattened mirror
 * `availability_ats` is what the reflex core and anything reading flat keys
 * see. Writing one and not the other is how an item ends up sold out in the
 * explain record and in stock on the page.
 *
 * Items with no override are passed through BY REFERENCE — an empty override
 * map is exactly the array that went in.
 */
export function applyAvailabilityOverrides<T extends Record<string, unknown>>(
  items: readonly T[],
  overrides: ReadonlyMap<string, AvailabilityOverride>
): T[] {
  if (overrides.size === 0) return items as T[];
  return items.map((item) => {
    const key = String(item.itemNumber ?? item.id ?? '');
    const override = overrides.get(key);
    if (!override) return item;
    const availability = (item.availability ?? {}) as Record<string, unknown>;
    return {
      ...item,
      availability: { ...availability, ats: override.ats },
      availability_ats: override.ats,
      urgencyState: override.urgencyState,
      urgency_state: override.urgencyState,
      /** Provenance, so the glass box can say a human did this and when. */
      availabilityOverride: { ats: override.ats, setBy: override.setBy, setAt: override.setAt },
    } as T;
  });
}

// ── The thin KV wrapper (the only part that touches the outside) ─────────────

/** Every key this module may write. Nothing else in KV is the desk's business. */
export const DESK_PREFIX = 'bh:offerdesk:';

/**
 * Overrides live under their own sub-prefix so a record read never has to guess
 * what it deserialized — and so `resetDesk` can clear both in one sweep.
 */
export const AVAIL_PREFIX = `${DESK_PREFIX}avail:`;

export function deskKey(itemNumber: string): string {
  return `${DESK_PREFIX}${itemNumber}`;
}

export function availKey(itemNumber: string): string {
  return `${AVAIL_PREFIX}${itemNumber}`;
}

export async function readRecord(
  kv: KVNamespace | null | undefined,
  itemNumber: string
): Promise<OfferDeskRecord | null> {
  if (!kv) return null;
  try {
    return await kv.get<OfferDeskRecord>(deskKey(itemNumber), 'json');
  } catch (err) {
    console.error('offerDesk readRecord failed:', err);
    return null;
  }
}

export async function writeRecord(
  kv: KVNamespace | null | undefined,
  record: OfferDeskRecord
): Promise<void> {
  if (!kv) return;
  await kv.put(deskKey(record.itemNumber), JSON.stringify(record));
}

/** Every desk record, in staging-file order (the tray reads top to bottom). */
export async function listRecords(kv: KVNamespace | null | undefined): Promise<OfferDeskRecord[]> {
  if (!kv) return [];
  try {
    const staged = stagedItems();
    const order = new Map(staged.map((s, i) => [s.itemNumber, i]));
    const listed = await kv.list({ prefix: DESK_PREFIX });
    const records = await Promise.all(
      listed.keys
        .filter((k) => !k.name.startsWith(AVAIL_PREFIX)) // overrides are not records
        .map(async (k) => {
        try {
          return await kv.get<OfferDeskRecord>(k.name, 'json');
        } catch {
          return null;
        }
      })
    );
    return records
      .filter((r): r is OfferDeskRecord => !!r && typeof r.itemNumber === 'string')
      .sort((a, b) => (order.get(a.itemNumber) ?? 99) - (order.get(b.itemNumber) ?? 99));
  } catch (err) {
    console.error('offerDesk listRecords failed:', err);
    return [];
  }
}

/** Every availability override in force, keyed by item number. */
export async function listOverrides(
  kv: KVNamespace | null | undefined
): Promise<Map<string, AvailabilityOverride>> {
  const out = new Map<string, AvailabilityOverride>();
  if (!kv) return out;
  try {
    const listed = await kv.list({ prefix: AVAIL_PREFIX });
    const values = await Promise.all(
      listed.keys.map(async (k) => {
        try {
          return await kv.get<AvailabilityOverride>(k.name, 'json');
        } catch {
          return null;
        }
      })
    );
    for (const v of values) {
      if (v && typeof v.itemNumber === 'string' && v.ats) out.set(v.itemNumber, v);
    }
  } catch (err) {
    console.error('offerDesk listOverrides failed:', err);
  }
  return out;
}

export async function writeOverride(
  kv: KVNamespace | null | undefined,
  override: AvailabilityOverride
): Promise<void> {
  if (!kv) return;
  await kv.put(availKey(override.itemNumber), JSON.stringify(override));
}

/** Restock: delete the override and the catalog's own availability is back. */
export async function clearOverride(
  kv: KVNamespace | null | undefined,
  itemNumber: string
): Promise<void> {
  if (!kv) return;
  await kv.delete(availKey(itemNumber));
}

/**
 * Restore the tray to its staged state — every presenter re-runs Beat 2, and a
 * beat you can only run once is not a beat. Deletes every `bh:offerdesk:*` key
 * (records AND availability overrides, so a reset also restocks the shelf) and
 * re-seeds from the file.
 */
export async function resetDesk(
  kv: KVNamespace | null | undefined,
  nowMs: number
): Promise<OfferDeskRecord[]> {
  if (!kv) return stagedItems().map((s) => newRecord(s, nowMs));
  const listed = await kv.list({ prefix: DESK_PREFIX });
  await Promise.all(listed.keys.map((k) => kv.delete(k.name)));
  const records = stagedItems().map((s) => newRecord(s, nowMs));
  await Promise.all(records.map((r) => writeRecord(kv, r)));
  return records;
}

/** Seed the tray if it is empty; otherwise leave it exactly as the presenter left it. */
export async function ensureSeeded(
  kv: KVNamespace | null | undefined,
  nowMs: number
): Promise<OfferDeskRecord[]> {
  const existing = await listRecords(kv);
  if (existing.length > 0) return existing;
  return resetDesk(kv, nowMs);
}

/**
 * The approved overlay, materialized through the CATALOG'S OWN LOADER against
 * the same epoch — so an approved item reaches the composer byte-shaped exactly
 * like a committed one and is gated, ranked, expired and succeeded by the same
 * code. This is the only function the composer calls.
 */
export async function overlayItems(
  kv: KVNamespace | null | undefined,
  epochMs: number
): Promise<Array<Record<string, unknown>>> {
  if (!kv) return [];
  try {
    const records = await listRecords(kv);
    const raws = records
      .map((r) => approvedRawItem(r, epochMs))
      .filter((r): r is Record<string, unknown> => r !== null);
    if (raws.length === 0) return [];
    const { loadBrighthourProducts } = await import('./catalog');
    return loadBrighthourProducts(epochMs, raws) as unknown as Array<Record<string, unknown>>;
  } catch (err) {
    console.error('offerDesk overlayItems failed (composition continues without it):', err);
    return [];
  }
}

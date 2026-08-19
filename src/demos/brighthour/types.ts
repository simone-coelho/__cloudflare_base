// src/demos/brighthour/types.ts
// ─────────────────────────────────────────────────────────────────────────────
// The Bright Hour item / offer / window schema (recon §B3, §B4, §A6, §A7).
//
// The schema mirrors QVC's own published product fields 1:1 — itemNumber,
// shortDubner, primaryClassCode, multi-membership categories[], ats ∈ Y|N|W,
// lastOnAirDate, maxOrderableQuantity — because "this uses a field you already
// have" is the whole posture. The DATA is fictional; the SHAPE is theirs.
//
// TWO deliberate deviations from §B3, both for the same reason (a demo must be
// stageable on any day, from one committed file):
//
//   1. `offer.window` stores OFFSETS from a demo epoch, not fixed timestamps.
//      demoClock.materializeWindow() turns them into genuine ISO instants at
//      load. `window: null` = always-on (gated by availability + rules, never
//      by a clock).
//   2. `signals.lastOnAirDate` is null in the data file; the stored form is
//      `signals.lastOnAirOffsetHours`, materialized the same way.
//
// And one field that is NEVER stored: `offer.lifecycleState`. It is derived at
// read time from (window, now, config) by offerLifecycle.lifecycleStateAt(),
// exactly as the reflex core derives affinity from a raw score and elapsed
// time. It is typed here as `null` on the stored item and non-null only on the
// materialized item.
// ─────────────────────────────────────────────────────────────────────────────

// ── Enumerations (all closed sets — the storefront may not invent members) ────

/** Their exact availability vocabulary (§A6). No "almost gone", ever. */
export type UrgencyState = 'in_stock' | 'low_stock' | 'sold_out' | 'waitlist' | 'advanced_order';

/** Their machine availability model: sellable | not sellable | waitlist (§A6). */
export type Ats = 'Y' | 'N' | 'W';

/** Mirrors their tsvprev / tsvprelaunch / tsvpresale / tsvpostsale codes (§A5). */
export type LifecycleState =
  | 'preview'
  | 'prelaunch'
  | 'presale'
  | 'live'
  | 'ending_today'
  | 'postsale'
  | 'expired';

export type OfferType =
  | 'daily_deal'
  | 'limited_time_event'
  | 'on_air'
  | 'one_time_only'
  | 'web_exclusive'
  | 'clearance'
  | 'final_sale'
  | 'evergreen';

/** Badge STYLE comes from the code via this bucket; badge TEXT comes from `label` (§A5). */
export type BadgeBucket = 'tsv' | 'sale' | 'informational' | 'lowstock' | 'spb' | 'webonly' | 'ioabadge';

/** entry <40 | core 40–120 | elevated 120–300 | premium 300+ (§B3). */
export type PriceBand = 'entry' | 'core' | 'elevated' | 'premium';

export type BrandPersonality =
  | 'heritage-classic'
  | 'modern-clean'
  | 'host-led'
  | 'value-workhorse'
  | 'artisan'
  | 'tech-forward';

/** Final Sale = non-returnable — an eligibility constraint, not a label (§C3). */
export type ReturnPolicy = 'standard' | 'final_sale';

/**
 * The shopper-facing urgency posture of an offer construct — the axis the
 * `urgencyResponsiveness` dimension scores and Beat 11 governs.
 * Never a countdown, never a counter: a posture, decayed by default.
 */
export type UrgencyCue = 'time_bound' | 'until_gone' | 'standing';

/** Whether the item leads with video (an on-air clip) or with text. Feeds `mediaAffinity`. */
export type MediaFormat = 'video' | 'still';

// ── Windows ──────────────────────────────────────────────────────────────────

/**
 * How every window in this catalog is stored: hours relative to the demo epoch
 * (midnight ET of demo day zero). Negative start = already running.
 */
export interface WindowOffsets {
  startOffsetHours: number;
  durationHours: number;
}

/** What the loader adds to a window once materialized against a real epoch. */
export interface MaterializedWindow extends WindowOffsets {
  startMs: number;
  endMs: number;
}

// ── Pricing ──────────────────────────────────────────────────────────────────

/** Bright Pay = their Easy Pay. Hard cap 6 installments (§C3). */
export interface BrightPay {
  code: string;
  installments: number;
  amount: number;
  phrasing: string;
}

/** The Bright Card benefit — itself time-windowed, exactly as their Q5 term is (§A4). */
export interface CardGatedPay extends BrightPay {
  window: WindowOffsets;
}

/** Deferred-interest financing. MUTUALLY EXCLUSIVE with brightPay, both ways (§C3). */
export interface SpecialFinancing {
  code: string;
  months: number;
  phrasing: string;
}

export interface Pricing {
  /** Their CMR — comparison-shopped value. Always > ourPrice. */
  comparableRetail: number;
  /** The struck-through "was" anchor. > currentSellingPrice on every promo item. */
  ourPrice: number;
  currentSellingPrice: number;
  priceBand: PriceBand;
  /** null when specialFinancing is set — the two can never coexist. */
  brightPay: BrightPay | null;
  cardGatedPay: CardGatedPay | null;
  /** null when brightPay is set. */
  specialFinancing: SpecialFinancing | null;
}

// ── Offer ────────────────────────────────────────────────────────────────────

export interface Offer {
  /** Construct code — drives badge style and slot identity: TBO, BH2, EVT120, LHS… (§B4). */
  code: string;
  /** Merchandiser-authored text. Beat 2c edits THIS without touching the code. */
  label: string;
  badgeBucket: BadgeBucket;
  type: OfferType;
  /** null = always-on: gated by availability and business rules, never by a clock. */
  window: WindowOffsets | null;
  /** ALWAYS null in the data file — derived at read time (see file header). */
  lifecycleState: null;
  /** Only flagged offers get the presale lead (their tsvpresale construct, §A4/§A5). */
  presaleEligible: boolean;
  /** Parent event id — set on nested reveals AND on items that hang off an event (a finale). */
  parentEvent: string | null;
  /**
   * Index in the parent's reveal ladder. When set, the item carries NO window of
   * its own: reveal i runs [parentStart + i·cadence, +cadence).
   */
  revealIndex: number | null;
  /** Merchandiser pin — precedence layer 2, above ranking (§C2). */
  pinned: boolean;
}

/** A named multi-item event. Reveal children derive their windows from it. */
export interface CatalogEvent {
  id: string;
  name: string;
  code: string;
  window: WindowOffsets;
  /** Hours between nested reveals; null on events without a reveal ladder. */
  revealCadenceHours: number | null;
  revealCount: number | null;
  note: string;
}

// ── Item sub-blocks ──────────────────────────────────────────────────────────

export interface CategoryRef {
  id: string;
  name: string;
  /** Exactly one entry per item is primary — their multi-membership taxonomy (§A7). */
  primary: boolean;
}

export interface Availability {
  ats: Ats;
  unitsRemaining: number;
  /** Their real per-item cap. Drives the +/− stepper's ceiling (§A10). */
  maxOrderableQuantity: number;
  /** Below this, urgencyState is low_stock — a threshold, never a shopper-facing counter. */
  lowStockThreshold: number;
}

export interface Signals {
  /** null in the data file — materialized from lastOnAirOffsetHours (see file header). */
  lastOnAirDate: string | null;
  /** Hours relative to the demo epoch; negative = already aired. null = never on air. */
  lastOnAirOffsetHours: number | null;
  /** Their "Sold Last 30 Days Quantity" velocity attribute — INTERNAL, never rendered. */
  soldLast30Days: number;
  bestSeller: boolean;
  /** Host id, e.g. 'host_dana_reyes'. Source of the hostAffinity dimension. */
  presentedBy: string | null;
}

/** Their LLSHOWCLIP pattern: the PDP plays the host's actual segment (§A10). */
export interface OnAirClip {
  type: 'LLSHOWCLIP';
  caption: 'On-Air Presentation';
  poster: string;
  src: string;
}

export interface Media {
  onAirClip: OnAirClip | null;
}

export interface Merch {
  season: string;
  collection: string | null;
  occasion: string[];
  adaptive: boolean;
  discoveryTag: string;
  /** Contextual editorial tabs by merch class — their moreInfoTabs[] (§A10). */
  moreInfoTabs: string[];
}

export interface Reviews {
  count: number;
  averageRating: number;
}

export interface Assets {
  /** Sharded image base, e.g. '/img/b/41/'. */
  base: string;
  /** Primary asset stem, e.g. 'b412907.001'. */
  primary: string;
}

// ── The item ─────────────────────────────────────────────────────────────────

/**
 * One catalog item exactly as `catalog.data.json` stores it.
 *
 * The last block is the FLAT MIRROR set. core.extractTouches() reads
 * `product[spec.source]` with no path support, so every reflex dimension source
 * must exist as a top-level key. These mirror nested values and are generated,
 * never hand-edited — see README.md "Field mirroring".
 */
export interface BrightHourItem {
  /** === identity === */
  /** Loader contract: catalog.ts drops any item without `id`. Equals itemNumber. */
  id: string;
  /** "B" + 6 digits — mirrors their A###### format; labelled "Item #" (§A7). */
  itemNumber: string;
  /** Coach-Product-shaped mirror of shortDescription (the shared Product type wants `name`). */
  name: string;
  shortDescription: string;
  /** Their TV-chyron field, kept deliberately: the web schema is named after broadcast hardware. */
  shortDubner: string;
  /** Written in the on-air host voice (§D3). */
  longDescription: string;
  bulletedDescription: string[];

  brandName: string;
  /** Mirror of brandName — the loader maps flat `brand` onto Product.line. */
  brand: string;
  /** A BRAND trait: every item of a brand carries the same value. */
  brandPersonality: BrandPersonality;
  /** Their merch class code, e.g. 'K221'. 1:1 with the `subcategory` label. */
  primaryClassCode: string;
  categories: CategoryRef[];

  pricing: Pricing;
  offer: Offer;
  availability: Availability;
  urgencyState: UrgencyState;
  signals: Signals;
  media: Media;
  merch: Merch;
  returnPolicy: ReturnPolicy;
  shippingHandling: number;
  reviews: Reviews;
  assets: Assets;

  /** === flat mirrors: the reflex dimension sources === */
  /** Primary category display name. Source of the `category` dimension. */
  category: string;
  /** Shopper-facing label for primaryClassCode. Source of the `subcategory` dimension. */
  subcategory: string;
  /** Coach-Product-shaped selling price. Source of the derived `priceBand` dimension. */
  price_usd: number;
  /** Same value as pricing.currentSellingPrice, under its schema-native name. */
  currentSellingPrice: number;
  /** Mirror of offer.type. Source of `offerTypeAffinity`. */
  offerType: OfferType;
  /** Derived from offer.type. Source of `urgencyResponsiveness`. */
  urgencyCue: UrgencyCue;
  /** Mirror of signals.presentedBy. Source of `hostAffinity`. */
  presentedBy: string | null;
  /** 'video' when media.onAirClip is present. Source of `mediaAffinity`. */
  mediaFormat: MediaFormat;

  /** === Coach-Product-shaped fields the similarity kernel indexes === */
  occasion: string[];
  colors: string[];
  material: string;
  silhouette: string;
  size: string;
  image_url: string;
  product_url: string;
  /** Arrays of objects do not survive the loader's flatten; these do. */
  categoryIds: string[];
  categoryNames: string[];
}

// ── The file ─────────────────────────────────────────────────────────────────

export interface CatalogMeta {
  brand: string;
  surface: 'brighthour';
  route: string;
  version: string;
  generatedFor: string;
  itemCount: number;
  currency: string;
  timezone: string;
  windowConvention: string;
  lifecycleNote: string;
  onAirNote: string;
  mirrorNote: string;
  provenance: string;
  voice: string;
  hosts: Array<{ id: string; displayName: string; channel: string }>;
  categories: Array<{ id: string; name: string; primary: boolean }>;
  counts: Record<string, unknown>;
}

export interface BrightHourCatalog {
  _meta: CatalogMeta;
  events: CatalogEvent[];
  items: BrightHourItem[];
}

// ── The materialized view (what the loader produces) ─────────────────────────

/**
 * An offer after the loader has run against a real epoch. Carries BOTH forms
 * on purpose: `window.startMs/endMs` for arithmetic, `windowStart/windowEnd`
 * ISO for the lifecycle gates, the glass box and the export row — the house
 * rule is "scale the clock, never fake the stamps", so the ISO pair must be a
 * genuine Date(ms).toISOString(), never a hand-written literal.
 */
export interface MaterializedOffer extends Omit<Offer, 'window' | 'lifecycleState'> {
  window: MaterializedWindow | null;
  windowStart: string | null;
  windowEnd: string | null;
  /** Derived at read time; present only on a materialized item. */
  lifecycleState: LifecycleState;
}

export interface MaterializedItem extends Omit<BrightHourItem, 'offer' | 'signals'> {
  offer: MaterializedOffer;
  signals: Omit<Signals, 'lastOnAirDate'> & { lastOnAirDate: string | null };
}

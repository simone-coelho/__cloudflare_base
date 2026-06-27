/**
 * experimentScenarios.ts — preset experiment scenarios for the experiment-surface demo (owner: ab-cmab).
 *
 * Each scenario maps to a `launchExperiment` input: a per-scenario flag (`xsurf_<id>`), a type
 * (ab|mab|cmab), an event metric, and variations whose `payload` variable carries the self-contained
 * banner creative the storefront `#xsurf` renders. No structural HTML per variation — all data.
 */
import type { LaunchExperimentInput, ExperimentVariation } from '@/services/experimentFx';
import { sceneUrl } from '@/services/sceneGen';

export interface XsurfCreative {
  key: string; name: string;
  layout?: 'hero' | 'banner' | 'card'; theme?: 'noir' | 'paper' | 'sale' | 'tan';
  image?: string; productId?: string;
  eyebrow?: string; headline?: string; subcopy?: string; offer?: string;
  ctaLabel?: string; ctaAction?: 'capture' | 'navigate' | 'addToCart';
  captureType?: 'none' | 'email' | 'phone'; capturePlaceholder?: string; badge?: string;
}

/**
 * Map an XsurfCreative's fields → the discrete §4.3 (FROZEN) feature variables for the
 * Signal-Led Moment. These are the SAME fields, promoted from inside the `payload` JSON to
 * top-level flag variables so the moment hero composes from them and they show in the
 * Optimizely UI. undefined → '' (matches the flag defaults). Only the moment scenario uses
 * this (opt-in via ScenarioDef.discreteVars), so the existing 5 scenarios are unchanged.
 */
function toDiscreteVars(c: XsurfCreative): Record<string, { value: string }> {
  return {
    hero_image: { value: c.image ?? '' },
    eyebrow: { value: c.eyebrow ?? '' },
    headline: { value: c.headline ?? '' },
    subcopy: { value: c.subcopy ?? '' },
    offer: { value: c.offer ?? '' },
    cta_label: { value: c.ctaLabel ?? '' },
    cta_action: { value: c.ctaAction ?? '' },
    theme: { value: c.theme ?? '' },
    layout: { value: c.layout ?? '' },
    badge: { value: c.badge ?? '' },
  };
}

function toVariations(creatives: XsurfCreative[], discrete = false): ExperimentVariation[] {
  return creatives.map((c) => ({
    key: c.key, name: c.name,
    variables: {
      variant: { value: c.key }, module_enabled: { value: 'true' }, payload: { value: JSON.stringify(c) },
      // Signal-Led Moment: also promote the creative to discrete top-level variables (still keeps payload).
      ...(discrete ? toDiscreteVars(c) : {}),
    },
  }));
}

export interface ScenarioDef {
  id: string; label: string; type: 'ab' | 'mab' | 'cmab'; name: string;
  metric: { key: string; name: string; eventKey: string };
  creatives: XsurfCreative[];
  /** Signal-Led Moment opt-in: also deliver the discrete §4.3 feature variables per arm. */
  discreteVars?: boolean;
}

const TABBY = 'COA-CH857'; // known catalog SKU (used elsewhere); other variations use gradient themes

export const SCENARIOS: Record<string, ScenarioDef> = {
  welcome_email_phone: {
    id: 'welcome_email_phone', label: 'A/B · First-order welcome (email vs phone)', type: 'ab',
    name: 'First-Order Welcome — Email vs Phone',
    metric: { key: 'lead_capture', name: 'Lead captured', eventKey: 'lead_capture' },
    creatives: [
      { key: 'email_15', name: 'Email · 15% off', layout: 'hero', theme: 'noir', productId: TABBY,
        eyebrow: 'The Coach List', headline: '15% off your first Coach.', subcopy: 'Join The Coach List — your code arrives instantly.',
        offer: '15% OFF', ctaLabel: 'Get my code', ctaAction: 'capture', captureType: 'email', capturePlaceholder: 'Email address' },
      { key: 'phone_10', name: 'Phone · 10% off', layout: 'hero', theme: 'noir', productId: TABBY,
        eyebrow: 'Coach Texts', headline: 'Save 10% — by text.', subcopy: 'Drop your number; your code arrives in seconds.',
        offer: '10% OFF', ctaLabel: 'Text my code', ctaAction: 'capture', captureType: 'phone', capturePlaceholder: 'Mobile number' },
    ],
  },
  hero_creative_bandit: {
    id: 'hero_creative_bandit', label: 'MAB · Hero creative bandit', type: 'mab',
    name: 'Hero Creative Bandit — Tabby',
    metric: { key: 'add_to_cart', name: 'Add to cart', eventKey: 'add_to_cart' },
    creatives: [
      { key: 'editorial', name: 'Editorial', layout: 'hero', theme: 'noir', productId: TABBY, eyebrow: 'Coach Originals', headline: 'The Tabby, reimagined.', ctaLabel: 'Shop the Tabby', ctaAction: 'navigate' },
      { key: 'bestseller', name: 'Best seller', layout: 'hero', theme: 'noir', productId: TABBY, eyebrow: 'Most carried', headline: "This season's most-carried Coach.", offer: 'BEST SELLER', ctaLabel: 'Shop now', ctaAction: 'navigate' },
      { key: 'free_charm', name: 'Free charm', layout: 'hero', theme: 'tan', productId: TABBY, eyebrow: 'Gift with purchase', headline: 'Your Tabby, finished.', subcopy: 'Free bag charm with the Tabby this week.', offer: 'FREE CHARM', ctaLabel: 'Shop the Tabby', ctaAction: 'navigate' },
      { key: 'monogram', name: 'Monogram', layout: 'card', theme: 'paper', productId: TABBY, eyebrow: 'Made yours', headline: 'Make it yours — free monogramming.', offer: 'COMPLIMENTARY', ctaLabel: 'Personalize', ctaAction: 'navigate' },
    ],
  },
  context_welcome: {
    id: 'context_welcome', label: 'CMAB · Context-aware welcome (anti-DY)', type: 'cmab',
    name: 'Context-Aware Welcome',
    metric: { key: 'add_to_cart', name: 'Add to cart', eventKey: 'add_to_cart' },
    creatives: [
      { key: 'new_value', name: 'New · 15% off', layout: 'hero', theme: 'noir', productId: TABBY, eyebrow: 'Welcome', headline: '15% off your first Coach.', offer: '15% OFF', ctaLabel: 'Get my code', ctaAction: 'capture', captureType: 'email', capturePlaceholder: 'Email address' },
      { key: 'gen_z_drop', name: 'Gen-Z · The drop', layout: 'banner', theme: 'tan', productId: TABBY, eyebrow: 'New', headline: 'The drop is live — Tabby in new colorways.', ctaLabel: 'Shop the drop', ctaAction: 'navigate' },
      { key: 'mobile_quick', name: 'Mobile · SMS', layout: 'banner', theme: 'noir', eyebrow: 'Coach Texts', headline: 'Shop in two taps — get a code by text.', ctaLabel: 'Text me', ctaAction: 'capture', captureType: 'phone', capturePlaceholder: 'Mobile number' },
      { key: 'returning_elevated', name: 'Returning · Edit', layout: 'card', theme: 'paper', eyebrow: 'For you', headline: 'Considered, not ordinary.', subcopy: 'An elevated edit in our finest leathers.', ctaLabel: 'Explore the Edit', ctaAction: 'navigate' },
    ],
  },
  move_brooklyn: {
    id: 'move_brooklyn', label: 'MAB · Move Brooklyn (no markdown)', type: 'mab',
    name: 'Move Brooklyn Without a Markdown',
    metric: { key: 'add_to_cart', name: 'Add to cart', eventKey: 'add_to_cart' },
    creatives: [
      { key: 'craft', name: 'Craft story', layout: 'card', theme: 'paper', eyebrow: 'Made in heritage leather', headline: 'Made to be lived in.', ctaLabel: 'Discover Brooklyn', ctaAction: 'navigate' },
      { key: 'alt_to_tabby', name: 'Alt to Tabby', layout: 'hero', theme: 'noir', eyebrow: 'Coach Originals', headline: 'The quiet alternative to Tabby.', ctaLabel: 'Shop Brooklyn', ctaAction: 'navigate' },
      { key: 'scarcity', name: 'Scarcity', layout: 'hero', theme: 'sale', eyebrow: 'Nearly gone', headline: 'Brooklyn in shearling — almost sold out.', offer: 'LIMITED', ctaLabel: 'Shop now', ctaAction: 'navigate' },
    ],
  },
  bnpl_rogue: {
    id: 'bnpl_rogue', label: 'A/B · Pay-in-4 on the Rogue', type: 'ab',
    name: 'Pay-Over-Time — Rogue',
    metric: { key: 'add_to_cart', name: 'Add to cart', eventKey: 'add_to_cart' },
    creatives: [
      { key: 'price_forward', name: 'Price forward', layout: 'hero', theme: 'noir', eyebrow: 'The Rogue', headline: 'The Rogue. $595.', subcopy: 'Glovetanned leather, made to last.', ctaLabel: 'Shop the Rogue', ctaAction: 'navigate' },
      { key: 'pay_in_4', name: 'Pay in 4', layout: 'hero', theme: 'tan', eyebrow: 'The Rogue', headline: 'Yours today. Pay over time.', subcopy: 'Or 4 interest-free payments of $148.75.', offer: 'PAY IN 4', ctaLabel: 'Shop pay-over-time', ctaAction: 'navigate' },
    ],
  },
  // Signal-Led Moment encore (doc 12). MAB over a real-time TikTok signal on the Tabby (COA-CH857).
  // Delivers the discrete §4.3 feature variables per arm (discreteVars:true) AND keeps payload.
  // The winner (as_seen_tiktok) carries the AI-generated hero scene URL from sceneGen's sceneUrl().
  tiktok_tabby_moment: {
    id: 'tiktok_tabby_moment', label: 'MAB · Signal-led moment (Tabby on TikTok)', type: 'mab',
    name: 'Signal-Led Moment — Tabby on TikTok',
    metric: { key: 'add_to_cart', name: 'Add to cart', eventKey: 'add_to_cart' },
    discreteVars: true,
    creatives: [
      { key: 'control_new', name: 'New arrivals', layout: 'hero', theme: 'noir', productId: TABBY,
        eyebrow: 'New arrivals', headline: 'New arrivals from Coach.', subcopy: 'The latest edit, just in.',
        ctaLabel: 'Shop new', ctaAction: 'navigate' },
      { key: 'as_seen_tiktok', name: 'As seen on TikTok', layout: 'hero', theme: 'tan', productId: TABBY,
        image: sceneUrl(TABBY, 'signal-tabby-tiktok'),
        eyebrow: 'As seen on TikTok', headline: "The Tabby everyone's talking about", subcopy: 'Trending in NY right now',
        offer: 'Trending now', ctaLabel: 'Shop the Tabby', ctaAction: 'navigate', badge: 'Signal-led · trending' },
      { key: 'complete_tabby', name: 'Complete the look', layout: 'card', theme: 'paper', productId: TABBY,
        eyebrow: 'Complete the look', headline: 'Complete the Tabby look.', subcopy: 'Styled with the pieces it was made for.',
        ctaLabel: 'Shop the look', ctaAction: 'navigate' },
    ],
  },
};

export function getScenario(id?: string): ScenarioDef | null { return (id && SCENARIOS[id]) || null; }

/** Build a launchExperiment input from a scenario (per-scenario flag key `xsurf_<id>`). */
export function scenarioToLaunchInput(s: ScenarioDef): Partial<LaunchExperimentInput> {
  return { experimentKey: `xsurf_${s.id}`, name: s.name, type: s.type, metric: s.metric, variations: toVariations(s.creatives, s.discreteVars === true) };
}

/** Presenter/model copy overrides for the Signal-Led Moment (flow into the discrete hero variables). */
export interface MomentCopyOverride {
  eyebrow?: string; headline?: string; subcopy?: string; offer?: string; ctaLabel?: string; badge?: string;
}

/**
 * Overlay model- or presenter-supplied copy onto the moment's winning arm (`as_seen_tiktok`):
 * the words land in the discrete §4.3 feature variables AND are mirrored into `payload`
 * (back-compat). Only non-empty fields override; everything else keeps the scenario's canned,
 * on-brand copy (so the deterministic fallback is identical downstream).
 */
function applyMomentCopy(input: Partial<LaunchExperimentInput>, copy: MomentCopyOverride): Partial<LaunchExperimentInput> {
  if (!Array.isArray(input.variations)) return input;
  const discreteMap: Array<[keyof MomentCopyOverride, string]> = [
    ['eyebrow', 'eyebrow'], ['headline', 'headline'], ['subcopy', 'subcopy'],
    ['offer', 'offer'], ['ctaLabel', 'cta_label'], ['badge', 'badge'],
  ];
  const variations = input.variations.map((v) => {
    if (v.key !== 'as_seen_tiktok' || !v.variables) return v;
    const vars: Record<string, { value: string }> = { ...v.variables };
    for (const [src, dest] of discreteMap) {
      const val = copy[src];
      if (typeof val === 'string' && val.length) vars[dest] = { value: val };
    }
    // Mirror into payload (the creative JSON) so any back-compat consumer shows the same words.
    try {
      const p = JSON.parse(vars.payload?.value || '{}');
      if (copy.eyebrow) p.eyebrow = copy.eyebrow;
      if (copy.headline) p.headline = copy.headline;
      if (copy.subcopy) p.subcopy = copy.subcopy;
      if (copy.offer) p.offer = copy.offer;
      if (copy.ctaLabel) p.ctaLabel = copy.ctaLabel;
      if (copy.badge) p.badge = copy.badge;
      vars.payload = { value: JSON.stringify(p) };
    } catch { /* leave payload as-is on parse error */ }
    return { ...v, variables: vars };
  });
  return { ...input, variations };
}

/** If body.scenario names a preset, merge its launch input (scenario type/variations/metric win). */
export function applyScenario(body: any): any {
  const s = getScenario(body?.scenario);
  if (!s) return body;
  let input = scenarioToLaunchInput(s);
  // Signal-Led Moment: optional copy overrides (the model's or presenter's words) flow into the
  // discrete hero variables on the winning arm. Additive — no copy / non-moment scenario → unchanged.
  if (s.discreteVars && body?.copy && typeof body.copy === 'object') {
    input = applyMomentCopy(input, body.copy as MomentCopyOverride);
  }
  return { ...body, ...input };
}

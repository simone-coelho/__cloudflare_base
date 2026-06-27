/**
 * experimentScenarios.ts — preset experiment scenarios for the experiment-surface demo (owner: ab-cmab).
 *
 * Each scenario maps to a `launchExperiment` input: a per-scenario flag (`xsurf_<id>`), a type
 * (ab|mab|cmab), an event metric, and variations whose `payload` variable carries the self-contained
 * banner creative the storefront `#xsurf` renders. No structural HTML per variation — all data.
 */
import type { LaunchExperimentInput, ExperimentVariation } from '@/services/experimentFx';

export interface XsurfCreative {
  key: string; name: string;
  layout?: 'hero' | 'banner' | 'card'; theme?: 'noir' | 'paper' | 'sale' | 'tan';
  image?: string; productId?: string;
  eyebrow?: string; headline?: string; subcopy?: string; offer?: string;
  ctaLabel?: string; ctaAction?: 'capture' | 'navigate' | 'addToCart';
  captureType?: 'none' | 'email' | 'phone'; capturePlaceholder?: string; badge?: string;
}

function toVariations(creatives: XsurfCreative[]): ExperimentVariation[] {
  return creatives.map((c) => ({
    key: c.key, name: c.name,
    variables: { variant: { value: c.key }, module_enabled: { value: 'true' }, payload: { value: JSON.stringify(c) } },
  }));
}

export interface ScenarioDef {
  id: string; label: string; type: 'ab' | 'mab' | 'cmab'; name: string;
  metric: { key: string; name: string; eventKey: string };
  creatives: XsurfCreative[];
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
};

export function getScenario(id?: string): ScenarioDef | null { return (id && SCENARIOS[id]) || null; }

/** Build a launchExperiment input from a scenario (per-scenario flag key `xsurf_<id>`). */
export function scenarioToLaunchInput(s: ScenarioDef): Partial<LaunchExperimentInput> {
  return { experimentKey: `xsurf_${s.id}`, name: s.name, type: s.type, metric: s.metric, variations: toVariations(s.creatives) };
}

/** If body.scenario names a preset, merge its launch input (scenario type/variations/metric win). */
export function applyScenario(body: any): any {
  const s = getScenario(body?.scenario);
  if (!s) return body;
  return { ...body, ...scenarioToLaunchInput(s) };
}

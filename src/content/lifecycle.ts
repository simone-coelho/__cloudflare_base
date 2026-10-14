// src/content/lifecycle.ts
// A piece is live when its status says so AND the clock is inside its window.
// The window is the "publish and expire" the scope appendix promises in 1.3;
// the eligibility gate runs before any scoring, so an expired piece cannot be
// chosen no matter how well it would have scored.

import { STAGE_WORDS } from '@/services/JourneyStage';
import type { Cell, ContentPiece, EligibilityRule } from './types';

/**
 * P31: the engine's own context signals a module's eligibility rule may name,
 * beside `regions`: the decision cell's entry channel, visit bucket and journey
 * stage (in its words: exploring, considering, deciding).
 */
export const ELIGIBILITY_SIGNALS = ['entry_channel', 'visit_bucket', 'journey_stage'] as const;
export type EligibilitySignal = (typeof ELIGIBILITY_SIGNALS)[number];

/**
 * The context a request is decided in. A module's eligibility rule reads only
 * the region key and the engine's own signals (`ELIGIBILITY_SIGNALS`), and only
 * as the decision's cell carries them (`cellEligibility`), never a value the
 * page sends. The decision passes the page's asserted request signals in this
 * same shape for the anchor preference (`ANCHOR_SIGNAL`, src/content/decide.ts),
 * which no rule reads. An absent context admits only pieces that carry no rule.
 */
export interface EligibilityContext {
  region?: string | null;
  signals?: Readonly<Record<string, string>>;
}

/**
 * P31: the context a module's eligibility rule is evaluated on, read off the
 * decision's cell as the engine derived it: its region key, its entry channel,
 * its visit bucket and its journey stage in the engine's words. A component the
 * cell records as unknown is left out, so it satisfies no rule. Pure and total.
 */
export function cellEligibility(cell: Partial<Pick<Cell, 'channel' | 'visit_bucket' | 'region' | 'stage'>> | null | undefined): EligibilityContext {
  const signals: Record<string, string> = {};
  const channel = cell?.channel, bucket = cell?.visit_bucket, stage = cell?.stage, region = cell?.region;
  if (typeof channel === 'string' && channel && channel !== 'unknown') signals.entry_channel = channel;
  if (typeof bucket === 'string' && bucket && bucket !== 'unknown') signals.visit_bucket = bucket;
  if (stage === 'early' || stage === 'mid' || stage === 'late') signals.journey_stage = STAGE_WORDS[stage];
  return { region: typeof region === 'string' && region.trim() ? region : null, signals };
}

export function windowBounds(p: Pick<ContentPiece, 'window'>): { from: number | null; to: number | null } {
  const parse = (v: string | undefined) => {
    if (!v) return null;
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : null;
  };
  return { from: parse(p.window?.from), to: parse(p.window?.to) };
}

export function isLiveAt(p: ContentPiece, nowMs: number): boolean {
  if (p.lifecycle.status !== 'live') return false;
  const { from, to } = windowBounds(p);
  if (from !== null && nowMs < from) return false;
  if (to !== null && nowMs >= to) return false;
  return true;
}

/**
 * A module's eligibility rule, evaluated beside the window. FAIL CLOSED: every
 * condition the rule names must hold, and a condition the context cannot
 * satisfy excludes the piece — an unknown region, channel, visit bucket or
 * stage satisfies no rule, and a signal outside the engine's own
 * (`ELIGIBILITY_SIGNALS`), which only a retained document can carry, is never
 * satisfied. A request that carries no context at all therefore serves exactly
 * the pieces that carry no rule, which is every catalogue without rules unchanged.
 *
 * A region key matches exactly, or by country when the rule names a country and
 * the shopper's key is a region inside it ("US" admits "US-WA"). The reverse is
 * never true: a rule naming "US-WA" does not admit an unknown-region shopper.
 */
export function matchesEligibility(rule: EligibilityRule | undefined, ctx?: EligibilityContext): boolean {
  if (!rule) return true;
  if (rule.regions && rule.regions.length) {
    const here = (ctx?.region ?? '').trim().toUpperCase();
    if (!here) return false;
    const country = here.split('-')[0] ?? here;
    if (!rule.regions.some((r) => { const want = r.trim().toUpperCase(); return want === here || want === country; })) return false;
  }
  if (rule.context) {
    for (const [name, values] of Object.entries(rule.context)) {
      if (!Array.isArray(values) || !values.length) continue;
      const got = (ELIGIBILITY_SIGNALS as readonly string[]).includes(name) ? ctx?.signals?.[name] : undefined;
      if (typeof got !== 'string' || !values.some((v) => v === got)) return false;
    }
  }
  return true;
}

/**
 * CW33 (BTIE D11): eligible means live, inside its window, and not marked out
 * of stock by the catalog. `inStock` is the catalog's own flag; absent means
 * in stock, so a feed that never says is unaffected. It also means the piece's
 * own `eligibleWhen` rule holds in the context given (P31: the decision's cell,
 * `cellEligibility`); without a context a piece with a rule is not eligible.
 */
export function isEligibleAt(p: ContentPiece, nowMs: number, ctx?: EligibilityContext): boolean {
  return isLiveAt(p, nowMs) && p.inStock !== false && matchesEligibility(p.eligibleWhen, ctx);
}

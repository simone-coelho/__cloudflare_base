// src/content/lifecycle.ts
// A piece is live when its status says so AND the clock is inside its window.
// The window is the "publish and expire" the scope appendix promises in 1.3;
// the eligibility gate runs before any scoring, so an expired piece cannot be
// chosen no matter how well it would have scored.

import type { ContentPiece, EligibilityRule } from './types';

/**
 * What the request knows about where and when it is happening. `region` is the
 * engine's own region key from the edge; `signals` are the named conditions the
 * page or a scheduled job supplied. Both are optional, and an absent context
 * admits only pieces that carry no rule.
 */
export interface EligibilityContext {
  region?: string | null;
  signals?: Readonly<Record<string, string>>;
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
 * Garrett's targeting rule, evaluated beside the window. FAIL CLOSED: a rule
 * that names a region or a condition the request cannot satisfy excludes the
 * piece. A request that carries no context at all therefore serves exactly the
 * pieces that carry no rule, which is every existing catalog unchanged.
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
      const got = ctx?.signals?.[name];
      if (typeof got !== 'string' || !values.some((v) => v === got)) return false;
    }
  }
  return true;
}

/**
 * CW33 (BTIE D11): eligible means live, inside its window, and not marked out
 * of stock by the catalog. `inStock` is the catalog's own flag; absent means
 * in stock, so a feed that never says is unaffected. Since W-QVC it also means
 * the piece's own `eligibleWhen` rule holds for this request.
 */
export function isEligibleAt(p: ContentPiece, nowMs: number, ctx?: EligibilityContext): boolean {
  return isLiveAt(p, nowMs) && p.inStock !== false && matchesEligibility(p.eligibleWhen, ctx);
}

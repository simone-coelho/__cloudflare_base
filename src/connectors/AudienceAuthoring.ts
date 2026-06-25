// src/connectors/AudienceAuthoring.ts
// (b) AudienceAuthoring — mirrors Opal's ODP audience tools / Real-time Audience
// Builder (exposed via remote MCP exp_manage_entity_lifecycle).
// See docs/architecture/05-demo-build-spec.md §1.2 and §3 (Hero Moment 3).
//
// The operator-side wedge. `suggestAudiences` is the AI draft step (Opal NL → ODP
// audience definitions, status:'suggested' — NOTHING goes live). `createAudience`
// is the human-approved Publish step. Per the MCP reference (§8.1) writes are
// draft-only and a human clicks Publish — we model that as a hard two-call gate
// and frame it as a governance beat, not a limitation.

import type { AudienceDef } from './types';
import type { AudienceStore } from './AudienceStore';
import { NotWiredError } from './types';
import { INSIGHTS, insightToAudienceDef, type InsightView } from '@/data/seed-audiences';

export interface AudienceAuthoring {
  /**
   * Opal: turn a merchandiser's plain-language request into one or more
   * DRAFT audience definitions (status:'suggested'). NOTHING goes live here.
   */
  suggestAudiences(nlPrompt: string): Promise<AudienceDef[]>;

  /**
   * Human-approved publish. Persists the audience and returns its id.
   * After this, SegmentProvider.fetchQualifiedSegments() can qualify users into it.
   */
  createAudience(def: AudienceDef): Promise<string /* audienceId */>;
}

// ---------------------------------------------------------------------------
// Intent matching (the "AI" in the mock). Deterministic, no network, no model.
// We score each pre-aggregated insight against the merchandiser's prompt over its
// nl_prompt / key / name / description / anchor_line keywords and return the best
// matches as status:'suggested' AudienceDef[] for the Opal review card.
// ---------------------------------------------------------------------------

/** Words that carry no intent signal — dropped before scoring. */
const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'for', 'from', 'have',
  'has', 'in', 'into', 'is', 'it', 'just', 'of', 'on', 'or', 'our', 'right', 'the',
  'their', 'them', 'they', 'this', 'to', 'who', 'with', 'without', 'we', 'you',
  'your', 'shoppers', 'shopper', 'customers', 'customer', 'people', 'show', 'me',
  'create', 'make', 'build', 'audience', 'segment', 'switch', 'turn',
]);

/**
 * Short intent synonyms → the canonical tokens that appear in an insight's text.
 * Lets natural prompts ("complete the look", "abandoned cart") land on the right
 * audience even when the merchandiser's phrasing differs from the insight copy.
 */
const SYNONYMS: Record<string, string[]> = {
  'complete-the-look': ['intent', 'tabby', 'browsers'],
  'completethelook': ['intent', 'tabby', 'browsers'],
  abandon: ['abandoned', 'abandoner'],
  abandoned: ['abandoner'],
  cart: ['cart'],
  checkout: ['cart', 'buy', 'ready'],
  buying: ['buy', 'ready', 'cart'],
  purchase: ['buy', 'ready'],
  gift: ['gifter', 'gifters', 'gift'],
  gifts: ['gifter', 'gifters'],
  present: ['gifter', 'gifters', 'gift'],
  presents: ['gifter', 'gifters'],
  premium: ['premium', 'luxe', 'elevated'],
  luxury: ['premium', 'luxe', 'elevated'],
  luxe: ['premium', 'elevated'],
  vip: ['vip', 'loyal', 'loyalist'],
  loyal: ['vip', 'loyalist', 'loyalty'],
  loyalty: ['vip', 'loyalist'],
  lapsed: ['lapsed', 'churn', 'winback'],
  winback: ['lapsed', 'churn'],
  'win-back': ['lapsed', 'churn'],
  reengage: ['lapsed', 'reengaging', 'churn'],
  'new': ['early', 'cold', 'start', 'anonymous', 'landing'],
  anonymous: ['cold', 'start', 'early', 'anonymous'],
  cold: ['cold', 'start', 'early'],
  landing: ['early', 'cold', 'landing'],
  comparing: ['mid', 'considering', 'comparing'],
  considering: ['mid', 'considering'],
  browsing: ['browser', 'browsers', 'views', 'viewing'],
  browse: ['browser', 'browsers'],
  intent: ['intent'],
  'high-intent': ['intent', 'tabby', 'browsers'],
};

/** All Coach line names referenced by the insight corpus (for line-keyword boosts). */
const LINE_TOKENS = new Set(
  INSIGHTS.map((i) => i.anchor_line)
    .filter((l): l is string => !!l)
    .map((l) => l.toLowerCase())
);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

/** Expand a token list with intent synonyms so loose phrasing still matches. */
function expand(tokens: string[]): Set<string> {
  const out = new Set<string>();
  for (const t of tokens) {
    out.add(t);
    const syn = SYNONYMS[t];
    if (syn) for (const s of syn) out.add(s);
  }
  return out;
}

/** The corpus a single insight is matched against (its searchable keywords). */
function insightTokens(insight: InsightView): Set<string> {
  const text = [
    insight.nl_prompt,
    insight.key.replace(/_/g, ' '),
    insight.name,
    insight.description,
    insight.anchor_line ?? '',
    insight.recommended_module.replace(/_/g, ' '),
  ].join(' ');
  return new Set(tokenize(text));
}

/**
 * Score a prompt against one insight: count overlapping (expanded) keywords,
 * with extra weight when a Coach line name matches the insight's anchor line and
 * a strong boost for an exact key / nl_prompt substring hit.
 */
function scoreInsight(promptTokens: Set<string>, prompt: string, insight: InsightView): number {
  const corpus = insightTokens(insight);
  let score = 0;
  for (const t of promptTokens) {
    if (corpus.has(t)) score += LINE_TOKENS.has(t) && t === (insight.anchor_line ?? '').toLowerCase() ? 3 : 1;
  }
  // Strong signals: the operator typed (a chunk of) the canonical prompt or the key.
  const p = prompt.toLowerCase();
  if (insight.nl_prompt && p.includes(insight.nl_prompt.toLowerCase().slice(0, 24))) score += 5;
  if (p.includes(insight.key.replace(/_/g, ' '))) score += 5;
  return score;
}

/** Pure NL→audience mapping used by MockAudienceAuthoring.suggestAudiences. */
export function suggestFromPrompt(nlPrompt: string, limit = 3): AudienceDef[] {
  const promptTokens = expand(tokenize(nlPrompt));
  if (promptTokens.size === 0) return [];

  const ranked = INSIGHTS.map((insight) => ({ insight, score: scoreInsight(promptTokens, nlPrompt, insight) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  // Each match becomes a DRAFT suggestion: same conditions/stats/recommendedModule
  // as the seed, but status:'suggested' and source:'opal_nl' (Opal authored it).
  return ranked.map(({ insight }) => ({
    ...insightToAudienceDef(insight),
    source: 'opal_nl',
    status: 'suggested',
    createdAt: 0,
  }));
}

export class MockAudienceAuthoring implements AudienceAuthoring {
  constructor(private store: AudienceStore) {}

  async suggestAudiences(nlPrompt: string): Promise<AudienceDef[]> {
    // Deterministic NL→audience mapping over the Coach insight corpus.
    // e.g. "high-intent Tabby browsers who haven't added to cart, switch on
    //       complete-the-look" ⇒ high_intent_tabby_browser (complete_the_look),
    // returned as status:'suggested' drafts only. (See spec §3, Hero Moment 3.)
    return suggestFromPrompt(nlPrompt);
  }

  async createAudience(def: AudienceDef): Promise<string> {
    // Human-approved Publish. Persist into the shared AudienceStore that
    // MockSegmentProvider reads — now live to qualification with no redeploy.
    const audienceId = `aud_${crypto.randomUUID()}`;
    await this.store.publish({
      ...def,
      audienceId,
      status: 'published',
      createdAt: Date.now(),
    });
    return audienceId;
  }
}

export class LiveAudienceAuthoring implements AudienceAuthoring {
  constructor(private cfg: { mcpEndpoint?: string; optiIdToken?: string }) {}

  async suggestAudiences(nlPrompt: string): Promise<AudienceDef[]> {
    if (!this.cfg.mcpEndpoint) throw new NotWiredError('AudienceAuthoring');
    // LIVE: drive Opal over the remote MCP server (Streamable HTTP):
    //   endpoint: https://exp.mcp.opal.optimizely.com/mcp  (cfg.mcpEndpoint)
    //   auth:     OAuth 2.0 / Opti ID (cfg.optiIdToken) — inherits the user's perms.
    // 1. exp_get_entity_templates(audience) → required fields for an ODP audience.
    // 2. Map nlPrompt → a draft AudienceCondition tree using those templates.
    // 3. Return as AudienceDef[] with status:'suggested' (still a draft — nothing live).
    // Tool names per docs/architecture/Optimizely-Experimentation-MCP-Server-Technical-Reference.md §4.
    throw new NotWiredError('AudienceAuthoring'); // remove when mcpEndpoint + optiIdToken are supplied
  }

  async createAudience(def: AudienceDef): Promise<string> {
    if (!this.cfg.mcpEndpoint || !this.cfg.optiIdToken) throw new NotWiredError('AudienceAuthoring');
    // LIVE: exp_manage_entity_lifecycle(create, audience, def.conditions) → DRAFT in Optimizely.
    // NOTE (MCP ref §8.1): the agent CANNOT publish — writes are DRAFT-ONLY and a
    // human clicks Publish in the Optimizely UI for the audience to go live. The
    // returned id maps to that draft; ODP qualification follows once published.
    // This is the governance gate, modelled deliberately (two-call: draft → human Publish).
    throw new NotWiredError('AudienceAuthoring'); // remove when the publish path is sanctioned
  }
}

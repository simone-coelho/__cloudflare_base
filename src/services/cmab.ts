/**
 * cmab.ts — Contextual Multi-Armed Bandit decision service (owner: ab-cmab).
 *
 * A contextual bandit picks a DIFFERENT winning variation per context/segment (the thing a
 * fixed A/B or a context-blind MAB cannot do). This is a deterministic, fully-explainable
 * model: given a shopper context it scores each arm from weighted context features, returns the
 * winner + a plain-English reason + a representative lift. Deterministic so the demo and
 * `/__shot` verification are reproducible.
 *
 * Honesty tier (TDD §7): Optimizely CMAB is GA; the numbers here are clearly-labeled
 * REPRESENTATIVE — the demo simulates the outcome, it does not run a live bandit on Tapestry
 * production traffic.
 */

export interface CmabContext {
  device?: 'mobile' | 'desktop' | 'tablet';
  segment?: string;                 // persona/segment, e.g. 'tabby_enthusiast','gifter','luxe_collector','gen_z_bnpl'
  intent?: 'browsing' | 'high_intent' | 'ready_to_buy';
  genZ?: boolean;
  aovBand?: 'low' | 'mid' | 'high';
  bnplAffinity?: boolean;
  paymentStall?: boolean;           // stalled at the payment step (the Revenue Radar hero trigger)
  label?: string;                   // optional human label for the readout row
}

export interface CmabArm { key: string; name: string }

export interface CmabDecision {
  variation: string;
  variationName: string;
  confidence: number;               // 0..1, softmax margin of the winning arm
  lift: string;                     // representative, formatted e.g. "+11% checkout completion"
  liftPct: number;
  metric: string;                   // which metric the lift is on (per arm)
  reason: string;                   // plain-English, from the top context contributors
  contextLabel: string;
  context: CmabContext;
  representative: true;
}

/** Default arm set — the experiences the bandit chooses among (control + four treatments). */
export const DEFAULT_ARMS: CmabArm[] = [
  { key: 'classic_hero', name: 'Classic hero (control)' },
  { key: 'complete_the_look', name: 'Complete-the-Look' },
  { key: 'gift_edit', name: 'Gift edit' },
  { key: 'premium_edit', name: 'Premium edit' },
  { key: 'bnpl_save', name: 'BNPL + social proof' },
];

/** Per-arm metric + representative lift band (low..high %), chosen deterministically by context. */
const ARM_META: Record<string, { metric: string; lo: number; hi: number }> = {
  classic_hero: { metric: 'baseline', lo: 0, hi: 0 },
  complete_the_look: { metric: 'add-to-cart', lo: 18, hi: 24 },
  gift_edit: { metric: 'conversion', lo: 14, hi: 19 },
  premium_edit: { metric: 'revenue / visitor', lo: 12, hi: 16 },
  bnpl_save: { metric: 'checkout completion', lo: 9, hi: 13 },
};

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0);
}

/** Score every arm from the context, tracking each arm's top contributing features (for the reason). */
function scoreArms(ctx: CmabContext): { scores: Record<string, number>; why: Record<string, string[]> } {
  const scores: Record<string, number> = { classic_hero: 0.25, complete_the_look: 0, gift_edit: 0, premium_edit: 0, bnpl_save: 0 };
  const why: Record<string, string[]> = { classic_hero: [], complete_the_look: [], gift_edit: [], premium_edit: [], bnpl_save: [] };
  const add = (arm: string, w: number, reason: string) => { scores[arm] += w; if (w >= 0.5) why[arm].push(reason); };

  const seg = (ctx.segment || '').toLowerCase();
  if (ctx.device === 'mobile') { add('complete_the_look', 0.8, 'on mobile'); add('bnpl_save', 0.5, 'on mobile'); }
  if (ctx.device === 'desktop') { add('gift_edit', 0.6, 'on desktop'); add('premium_edit', 0.5, 'on desktop'); }

  if (/tabby|enthusiast/.test(seg)) add('complete_the_look', 1.0, 'a Tabby-lover');
  if (/gift/.test(seg)) add('gift_edit', 1.1, 'a gift shopper');
  if (/luxe|collector|high_aov|loyal/.test(seg)) add('premium_edit', 1.1, 'a high-AOV / luxe shopper');
  if (/gen_z|bnpl|hesitat/.test(seg)) add('bnpl_save', 1.0, 'a Gen-Z / BNPL-affinity shopper');

  if (ctx.intent === 'ready_to_buy') add('bnpl_save', 0.7, 'ready to buy');
  if (ctx.intent === 'high_intent') { add('complete_the_look', 0.4, 'high intent'); add('bnpl_save', 0.4, 'high intent'); }

  if (ctx.genZ) add('bnpl_save', 0.6, 'Gen-Z');
  if (ctx.bnplAffinity) add('bnpl_save', 0.7, 'BNPL-affinity');
  if (ctx.paymentStall) add('bnpl_save', 0.9, 'stalled at payment');
  if (ctx.aovBand === 'high') { add('premium_edit', 0.5, 'high basket'); add('bnpl_save', 0.4, 'high basket'); }

  return { scores, why };
}

function contextLabel(ctx: CmabContext): string {
  if (ctx.label) return ctx.label;
  const dev = ctx.device ? ctx.device[0].toUpperCase() + ctx.device.slice(1) : 'Any device';
  const seg = ctx.segment ? ctx.segment.replace(/_/g, ' ') : 'all shoppers';
  return `${dev} · ${seg}`;
}

/** Decide the winning variation for ONE context. */
export function decideCmab(ctx: CmabContext, arms: CmabArm[] = DEFAULT_ARMS): CmabDecision {
  const { scores, why } = scoreArms(ctx);
  const pool = arms.filter((a) => a.key in scores);
  const ranked = pool.slice().sort((a, b) => scores[b.key] - scores[a.key]);
  const winner = ranked[0] || DEFAULT_ARMS[0];
  const runnerUp = ranked[1];

  // Confidence = softmax margin between winner and runner-up over the pool.
  const exps = pool.map((a) => Math.exp(scores[a.key]));
  const sum = exps.reduce((x, y) => x + y, 0) || 1;
  const top = Math.exp(scores[winner.key]) / sum;
  const second = runnerUp ? Math.exp(scores[runnerUp.key]) / sum : 0;
  const confidence = Math.min(0.99, Math.max(0.55, 0.5 + (top - second)));

  // Representative lift: deterministic value inside the arm's band, varied by context.
  const meta = ARM_META[winner.key] || { metric: 'lift', lo: 8, hi: 12 };
  const span = Math.max(0, meta.hi - meta.lo);
  const liftPct = winner.key === 'classic_hero' ? 0 : meta.lo + (span ? hash(contextLabel(ctx) + winner.key) % (span + 1) : 0);
  const lift = liftPct ? `+${liftPct}% ${meta.metric}` : 'no measurable lift vs control';

  const drivers = (why[winner.key] || []).slice(0, 2);
  const reason = drivers.length
    ? `Because this shopper is ${drivers.join(' and ')}, the bandit serves “${winner.name}”.`
    : `The bandit serves “${winner.name}” for this context.`;

  return {
    variation: winner.key,
    variationName: winner.name,
    confidence: Math.round(confidence * 100) / 100,
    lift,
    liftPct,
    metric: meta.metric,
    reason,
    contextLabel: contextLabel(ctx),
    context: ctx,
    representative: true,
  };
}

/** The canonical demo contexts — each gets its OWN winner (the CMAB beat-13 story). */
export const DEFAULT_CONTEXTS: CmabContext[] = [
  { device: 'mobile', segment: 'tabby_enthusiast', intent: 'high_intent', label: 'Mobile · Tabby-lover' },
  { device: 'desktop', segment: 'gifter', intent: 'browsing', label: 'Desktop · Gift shopper' },
  { device: 'desktop', segment: 'luxe_collector', aovBand: 'high', intent: 'high_intent', label: 'Returning · High-AOV / luxe' },
  { device: 'mobile', segment: 'gen_z_bnpl', genZ: true, bnplAffinity: true, paymentStall: true, intent: 'ready_to_buy', label: 'Mobile · Gen-Z at payment' },
];

/** The per-context winners table for the Engine CMAB readout + beat 13. */
export function cmabMatrix(contexts: CmabContext[] = DEFAULT_CONTEXTS, arms: CmabArm[] = DEFAULT_ARMS): CmabDecision[] {
  return contexts.map((c) => decideCmab(c, arms));
}

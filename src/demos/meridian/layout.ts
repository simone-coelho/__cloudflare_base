// src/demos/meridian/layout.ts
// ─────────────────────────────────────────────────────────────────────────────
// PER-VISITOR SECTION ORDER — decision D4, doc 15 §6.2 step 2(d):
//
//   "compute order (intent stage priority, then weight, then deterministic
//    tie-break)" over a grammar of fixed vs re-orderable sections (§6.3).
//
// PURE, like composer.ts, and for the same two reasons: it ships to the browser
// so the page can restructure the instant a frame lands, and it runs unchanged
// on the server when the receipt is written. One implementation, one receipt.
//
// A SECTION IS SCORED AS IF IT WERE AN ITEM. Each section declares which
// dimension SHAPES it answers and how hard (ω per shape) — the vocabulary
// SLOT_STRATEGIES already uses, so one table serves both verticals. It is then
// scored through the same scoreOne() that ranks products, as a synthetic record
// carrying the visitor's leading value on every shape it answers (m_d = 1):
//
//   s(section | visitor) = Σ_d  ω_d(section) · a_d,lead(visitor)
//
// so the drivers fall out of the existing arithmetic, and the receipt for "why
// did the offer move above the hero" has the same shape as the receipt for "why
// did this bag win the hero".
//
// THE ORDER IS A WALK, NOT A SORT. Sections are taken in template order and
// each may climb past the sections above it only while it BEATS them:
//   (a) a locked section is never passed and never moves;
//   (b) intent outranks everything — a section that answers `stage` climbs to
//       the top while the deciding value sits at or above its θ_out;
//   (c) otherwise a section climbs past one it strictly outscores;
//   (d) ties resolve to template order, because that is where the walk began.
// A section may climb at all only while its LEAD confidence is ≥ θ_out. The
// moment the lead decays under θ_out it beats nothing and lands back at its
// template rank. That is the hysteresis, judged on one fixed, named dimension
// for the reason composer.ts judges slot confidence that way: a rank that
// flaps is worse than a rank that is slightly stale.
//
// `prevOrder` holds a raised rank. A section that sat above another last frame
// keeps beating it while its lead is still confident, even after the scores
// cross back — two page regions swapping every time a fast axis decays past a
// slow one would read as a page that cannot make up its mind. The claim ends
// the only way it can: the lead falls under θ_out, and the section returns.
// ─────────────────────────────────────────────────────────────────────────────

import type { ReflexConfig } from '@/reflex/core';
import { scoreOne, type AffinityView, type ComposeInput } from './composer';
import { STAGE_LABELS } from './reflexConfig';
import type {
  MeridianExplain, OfferCopy, SectionDecision, SectionExplain, SectionSpec, SectionStrategy, Vertical,
} from './types';

/**
 * The grammar (§6.3), in template order. `answers` is shape → ω; `lead` is the
 * shape whose confidence decides whether the section may sit above its template
 * rank — chosen, like the SLOT_STRATEGIES leads, so each region retreats on one
 * nameable axis. The takeover is not here: it is a moment, not a section, and
 * when it is on the page the caller locks it at rank 0.
 */
export const SECTIONS: readonly SectionSpec[] = [
  // The hero leans on the slow axes so it does not flap.
  { id: 'hero',    kind: 'hero',    answers: { broad: 0.5, durable: 0.5 },  lead: 'broad' },
  // The store-card offer answers the band and the verb. Its lead is the verb:
  // the rank is earned by intent and ends with it, exactly as the offer does.
  { id: 'offer',   kind: 'offer',   answers: { band: 0.5, stage: 0.5 },     lead: 'stage' },
  // The ranked row. Led by need rather than narrow for the composer's reason:
  // a row about "things for a project" outlives one about cordless sanders.
  { id: 'row',     kind: 'merch',   answers: { narrow: 0.5, need: 0.5 },    lead: 'need' },
  // Content: what KIND of asset earns attention decides whether it leads.
  { id: 'block_a', kind: 'content', answers: { content: 0.7, broad: 0.3 },  lead: 'content' },
];

/** The offer section's words. The page paints what it is handed; it does not invent copy. */
export const OFFER_COPY: Readonly<Record<Vertical, OfferCopy>> = {
  retail: {
    kicker: 'Calder Card',
    title: "10% off today's order when you're approved",
    body: 'An instant decision, no annual fee, and the discount lands on the bag you are holding.',
    cta: 'Apply in 60 seconds',
  },
  financial: {
    kicker: 'Your adviser',
    title: 'A named adviser on this application',
    body: 'Someone who has read what you have been comparing, on the line before you submit.',
    cta: 'Meet your adviser',
  },
};

export interface LayoutInput {
  affinity: AffinityView;
  config: ReflexConfig;
  /** dimension shape lookup, from reflexConfig.SHAPE_OF_KEY */
  shapeOfKey: Readonly<Record<string, string>>;
  /** Last frame's order. Holds a raised rank while its lead is still confident. */
  prevOrder?: readonly string[];
  /**
   * Sections that hold their rank regardless. Ids outside SECTIONS (the
   * takeover) sit ahead of the grammar, at rank 0 onward, in the order given.
   */
  locked?: readonly string[];
  /** The stage value that means "has chosen". Defaults to both verticals' words. */
  decidingValue?: string;
}

export interface LayoutResult {
  order: string[];
  sections: SectionDecision[];
}

/** The stage values that mean "has chosen", in either vocabulary. */
const DECIDING_VALUES: readonly string[] = Object.values(STAGE_LABELS).map((l) => l.decide);

/** Strictly greater, past float noise: equal scores are a tie, and ties keep template order. */
const EPS = 1e-6;
const round = (n: number) => Math.round(n * 1e4) / 1e4;
const fmt = (n: number) => n.toFixed(2);

interface Scored {
  spec: SectionSpec;
  templateRank: number;
  locked: boolean;
  score: number;
  drivers: MeridianExplain['drivers'];
  lead: NonNullable<SectionExplain['lead']>;
  confidence: number;
  thetaOut: number;
  /** May climb at all: lead ≥ θ_out (or intent priority), and something to climb on. */
  eligible: boolean;
  /** Intent priority is active for this section. */
  stage: boolean;
}

type Why = 'stage' | 'score' | 'hold';

function leadOf(spec: SectionSpec): string {
  return spec.lead ?? Object.entries(spec.answers).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
}

/** The answers with the lead first — scoreOne reads its lead off key order on ties. */
function strategyOf(spec: SectionSpec): Record<string, number> {
  const lead = leadOf(spec);
  const out: Record<string, number> = {};
  if (lead in spec.answers) out[lead] = spec.answers[lead]!;
  for (const [shape, omega] of Object.entries(spec.answers)) if (shape !== lead) out[shape] = omega;
  return out;
}

function argmax(perValue: Record<string, number>): string | undefined {
  let best: string | undefined;
  let bestA = 0;
  for (const [value, a] of Object.entries(perValue)) if (a > bestA) { best = value; bestA = a; }
  return best;
}

/**
 * The synthetic record. On every shape the section answers it carries the
 * visitor's leading value, so match() returns 1 and the score is Σ ω · a_lead.
 * The stage shape is the exception: a section answers the DECIDING value and
 * never "browsing" — an offer is not made stronger by someone wandering.
 */
function syntheticRecord(
  spec: SectionSpec, input: LayoutInput, decidingValues: readonly string[],
): Record<string, unknown> {
  const rec: Record<string, unknown> = {};
  for (const d of input.config.dimensions) {
    const shape = input.shapeOfKey[d.key];
    if (!shape || !(spec.answers[shape] ?? 0)) continue;
    const perValue = input.affinity.dims[d.key];
    if (!perValue) continue;
    const value = shape === 'stage'
      ? decidingValues.find((v) => (perValue[v] ?? 0) > 0)
      : argmax(perValue);
    if (value == null) continue;
    if (d.derive === 'band' && d.cuts && d.labels) {
      // A number that bandLabel() maps back to exactly this label.
      const i = d.labels.indexOf(value);
      if (i < 0) continue;
      rec[d.source] = i === 0 ? (d.cuts[0] ?? 0) - 1 : d.cuts[i - 1];
    } else {
      rec[d.source] = d.multi ? [value] : value;
    }
  }
  return rec;
}

function scoreSection(
  spec: SectionSpec, templateRank: number, locked: boolean,
  input: LayoutInput, composeInput: ComposeInput,
  decidingValues: readonly string[], stagePriority: boolean,
): Scored {
  const lead = leadOf(spec);
  const s = scoreOne(syntheticRecord(spec, input, decidingValues), composeInput, strategyOf(spec));
  const leadSpec = input.config.dimensions.find((d) => input.shapeOfKey[d.key] === lead);
  const leadDriver = leadSpec ? s.drivers.find((d) => d.dim === leadSpec.key) : undefined;
  // Confidence is the LEAD's affinity or nothing. scoreOne falls back to the
  // strongest driver when the lead is silent — right for a slot that must fill,
  // wrong for a rank that must be entitled to move.
  const confidence = leadDriver?.a ?? 0;
  const thetaOut = leadSpec?.thetaOut ?? input.config.thetaOut;
  const stage = (spec.answers.stage ?? 0) > 0 && stagePriority && s.score > 0;
  const eligible = s.score > 0 && (confidence >= thetaOut || stage);
  return {
    spec, templateRank, locked, score: s.score, drivers: s.drivers,
    lead: { shape: lead, dim: leadSpec?.key, value: leadDriver?.value },
    confidence, thetaOut, eligible, stage,
  };
}

/** Compute the page's section order for one visitor, each rank with its receipt. */
export function composeLayout(input: LayoutInput): LayoutResult {
  const { config } = input;
  const coldStart = Object.keys(input.affinity.dims).length === 0;
  const lockedIds = new Set(input.locked ?? []);
  const isSection = (id: string) => SECTIONS.some((s) => s.id === id);

  // Locked ids outside the grammar (the takeover) sit ahead of it, as given.
  const external = [...lockedIds].filter((id) => !isSection(id));
  const offset = external.length;

  // Previous ranks: raw for the receipt, grammar-relative for the walk — the
  // takeover appearing shifts every raw rank by one, and that is not a fall.
  const prevRaw = input.prevOrder ?? [];
  const prevGrammar = prevRaw.filter(isSection);
  const prevRankOf = (id: string) => { const i = prevRaw.indexOf(id); return i < 0 ? undefined : i; };
  const prevGrammarRank = (id: string) => { const i = prevGrammar.indexOf(id); return i < 0 ? undefined : i; };

  // The verb, in whichever vocabulary this config speaks. Membership, not
  // argmax: someone who added to the bag IS deciding, however much they browsed.
  const stageSpec = config.dimensions.find((d) => input.shapeOfKey[d.key] === 'stage');
  const decidingValues = input.decidingValue ? [input.decidingValue] : DECIDING_VALUES;
  const stageVals = stageSpec ? (input.affinity.dims[stageSpec.key] ?? {}) : {};
  const decidingA = Math.max(0, ...decidingValues.map((v) => stageVals[v] ?? 0));
  const stagePriority = decidingA >= (stageSpec?.thetaOut ?? config.thetaOut);

  const composeInput: ComposeInput = {
    affinity: input.affinity, config, shapeOfKey: input.shapeOfKey, items: [], blocks: [],
  };
  const scored = SECTIONS.map((spec, i) => scoreSection(
    spec, i, !!spec.locked || lockedIds.has(spec.id),
    input, composeInput, decidingValues, stagePriority,
  ));

  // ── the walk ─────────────────────────────────────────────────────────────
  const wasAbove = (b: Scored, a: Scored) => {
    const pb = prevGrammarRank(b.spec.id);
    const pa = prevGrammarRank(a.spec.id);
    return pb != null && pa != null && pb < pa;
  };
  const beats = (b: Scored, a: Scored): Why | null => {
    if (coldStart || !b.eligible) return null;
    if (a.stage && !b.stage) return null;          // nothing passes intent
    if (b.stage && !a.stage) return 'stage';       // (b) intent outranks
    if (b.score > a.score + EPS) return 'score';   // (c) weight
    if (wasAbove(b, a)) return 'hold';             // hysteresis on the rank
    return null;                                   // (d) template order
  };

  const placed: Scored[] = [];
  const climbs = new Map<string, Array<{ over: Scored; why: Why }>>();
  for (const s of scored) {
    if (s.locked) continue;
    let pos = placed.length;
    const climbed: Array<{ over: Scored; why: Why }> = [];
    while (pos > 0) {
      const over = placed[pos - 1]!;
      const why = beats(s, over);
      if (!why) break;
      climbed.unshift({ over, why });
      pos -= 1;
    }
    placed.splice(pos, 0, s);
    climbs.set(s.spec.id, climbed);
  }

  // Locked sections are put back at their template rank; the walk fills the rest.
  const final: Scored[] = [];
  let m = 0;
  for (const s of scored) final.push(s.locked ? s : placed[m++]!);

  // ── the receipts ─────────────────────────────────────────────────────────
  const sections: SectionDecision[] = external.map((id, i) => ({
    section: id, rank: i, prevRank: prevRankOf(id), templateRank: i, score: 0, strategy: 'locked',
    explain: {
      drivers: [], lead: null, confidence: 0, thetaOut: config.thetaOut,
      movedBecause: `locked at rank ${i}`, configVersion: config.version,
    },
  }));

  const name = (x: Scored) => `${x.spec.id} (${fmt(x.score)})`;
  const leadText = (x: Scored) => !x.lead.dim ? `${x.lead.shape} —`
    : x.lead.value ? `${x.lead.dim}·${x.lead.value} ${fmt(x.confidence)}`
    : `${x.lead.dim} 0`;

  final.forEach((s, i) => {
    const rank = offset + i;
    const templateRank = offset + s.templateRank;
    const climbed = climbs.get(s.spec.id) ?? [];
    const shapes = Object.keys(s.spec.answers).join('+');
    const pushedBy = final.slice(0, i).filter((x) => x.templateRank > s.templateRank);
    const prevG = prevGrammarRank(s.spec.id);
    const fell = !coldStart && prevG != null && prevG < s.templateRank && i >= s.templateRank;

    const strategy: SectionStrategy = s.locked ? 'locked'
      : coldStart ? 'template'
      : s.stage ? 'stage'
      : rank < templateRank && s.eligible ? 'affinity'
      : 'template';

    let movedBecause: string;
    if (strategy === 'locked') {
      movedBecause = `locked at template rank ${templateRank}`;
    } else if (coldStart) {
      movedBecause = 'cold start; template order';
    } else if (strategy === 'stage') {
      movedBecause = `${leadText(s)} ≥ θout ${s.thetaOut}; ` + (climbed.length
        ? `intent outranks ${climbed.map((c) => name(c.over)).join(', ')} on ${shapes}`
        : 'intent priority; already at template rank');
    } else if (strategy === 'affinity') {
      const won = climbed.filter((c) => c.why === 'score').map((c) => name(c.over));
      const held = climbed.filter((c) => c.why === 'hold').map((c) => name(c.over));
      const parts = [`${leadText(s)} ≥ θout ${s.thetaOut}`];
      if (won.length) parts.push(`outscored ${won.join(', ')} on ${shapes}`);
      if (held.length) parts.push(`holding above ${held.join(', ')} until ${s.lead.dim} decays under θout`);
      movedBecause = parts.join('; ');
    } else if (fell) {
      movedBecause = `${leadText(s)} < θout ${s.thetaOut}; returned to template rank ${templateRank}`
        + (rank > templateRank ? `, pushed to ${rank} by ${pushedBy.map(name).join(', ')}` : '');
    } else if (rank > templateRank) {
      movedBecause = `template order; pushed to rank ${rank} by ${pushedBy.map(name).join(', ')}`;
    } else if (s.eligible) {
      movedBecause = `${leadText(s)} ≥ θout ${s.thetaOut}; outscored nothing above it; template order`;
    } else {
      movedBecause = `${leadText(s)} < θout ${s.thetaOut}; template order`;
    }

    sections.push({
      section: s.spec.id, rank, prevRank: prevRankOf(s.spec.id), templateRank,
      score: round(s.score), strategy,
      explain: {
        drivers: s.drivers, lead: s.lead, confidence: round(s.confidence), thetaOut: s.thetaOut,
        movedBecause, configVersion: config.version,
      },
    });
  });

  return { order: sections.map((s) => s.section), sections };
}

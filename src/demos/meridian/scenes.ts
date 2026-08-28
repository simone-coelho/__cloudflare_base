// src/demos/meridian/scenes.ts
// ─────────────────────────────────────────────────────────────────────────────
// THE CURATED SCENE SET — the reason nothing here can hallucinate.
//
// A shopper types a sentence. The model's ONLY job is to map that sentence onto
// one of the scenes below. It cannot invent a scene, cannot invent a product,
// and cannot generate an image. The set is closed, the copy is written by us,
// and the artwork is approved before the demo ever runs.
//
// Everything downstream is deterministic: the scene carries dimension touches,
// those touches go through the same apply() every other signal does, and the
// same ranker chooses the products. The model contributes exactly one thing —
// reading the sentence — and that contribution is a choice from a fixed list.
//
// This is the answer to "what happens when the AI goes wrong in front of a
// customer." Structurally, it cannot: an enum has no room for an invention.
// ─────────────────────────────────────────────────────────────────────────────

import type { Vertical } from './types';
import type { Touch } from '@/reflex/core';

export interface Scene {
  id: string;
  /** What the shopper sees as the answer's title. Written by us, not a model. */
  headline: string;
  subhead: string;
  /** Deterministic fallback: if no model is available, these words select it. */
  aliases: string[];
  /** What the scene means to the engine. Ordinary touches, ordinary weights. */
  touches: Touch[];
  /** A brand-approved still. Nothing is generated at request time. */
  art: string;
}

export const RETAIL_SCENES: Scene[] = [
  {
    id: 'wedding',
    headline: 'A wedding, and what you wear to it',
    subhead: 'Quiet, considered, photographs well.',
    aliases: ['wedding', 'bride', 'groom', 'ceremony', 'reception', 'registry', 'best man', 'bridesmaid'],
    // 'statement' pulled OVERSIZED SUNGLASSES into a wedding. A wedding is an
    // evening you buy for, not a taste — so it leans on the two occasions it
    // genuinely is, and lets price do the rest.
    touches: [{ dim: 'occasion', value: 'evening' }, { dim: 'occasion', value: 'gift' },
              { dim: 'priceBand', value: 'premium' }],
    art: '/meridian/scenes/wedding.svg',
  },
  {
    id: 'black-tie',
    headline: 'A black-tie evening',
    subhead: 'The night that asks for the good version.',
    aliases: ['black tie', 'formal', 'gala', 'benefit', 'opera', 'tuxedo', 'evening do'],
    touches: [{ dim: 'occasion', value: 'evening' }, { dim: 'category', value: 'Jewellery' },
              { dim: 'styleWorld', value: 'statement' }],
    art: '/meridian/scenes/black-tie.svg',
  },
  {
    id: 'new-job',
    headline: 'Starting somewhere new',
    subhead: 'Dress for the room you are walking into.',
    aliases: ['new job', 'work', 'office', 'interview', 'promotion', 'first day', 'commute'],
    touches: [{ dim: 'occasion', value: 'work' }, { dim: 'styleWorld', value: 'modern' }],
    art: '/meridian/scenes/new-job.svg',
  },
  {
    id: 'cold-snap',
    headline: 'The weather turned',
    subhead: 'Wool, waxed cotton, and things that outlive a season.',
    aliases: ['cold', 'winter', 'coat', 'warm', 'snow', 'freezing', 'jacket', 'layers'],
    // Drover is the heritage waxed-canvas line — the field jacket, in olive,
    // navy and tan — which is what "the weather turned" means in this catalogue.
    touches: [{ dim: 'category', value: 'Outerwear' }, { dim: 'line', value: 'Drover' },
              { dim: 'styleWorld', value: 'heritage' }],
    art: '/meridian/scenes/cold-snap.svg',
  },
  {
    id: 'weekend-away',
    headline: 'A weekend away',
    subhead: 'Carry less, and carry it better.',
    aliases: ['weekend', 'travel', 'trip', 'flight', 'packing', 'getaway', 'holiday', 'vacation'],
    // Category alone once put an evening bag in a weekend bag row. Holloway is
    // the canvas travel line — the weekender, in green, navy and tan — which is
    // what actually distinguishes a travel bag from a going-out one.
    touches: [{ dim: 'occasion', value: 'travel' }, { dim: 'category', value: 'Bags' },
              { dim: 'line', value: 'Holloway' }],
    art: '/meridian/scenes/weekend-away.svg',
  },
  {
    id: 'hard-to-buy-for',
    headline: 'For someone impossible to buy for',
    subhead: 'Small, considered, and hard to get wrong.',
    aliases: ['gift', 'present', 'birthday', 'anniversary', 'christmas', 'no idea', 'thank you'],
    // A gift genuinely spans the store, so this scene deliberately carries no
    // category — the visitor's own affinity breaks the tie.
    touches: [{ dim: 'occasion', value: 'gift' }],
    art: '/meridian/scenes/hard-to-buy-for.svg',
  },
  {
    id: 'graduation',
    headline: 'Marking the end of something',
    subhead: 'A thing that lasts longer than the ceremony.',
    aliases: ['graduation', 'graduate', 'grad', 'diploma', 'commencement', 'milestone'],
    touches: [{ dim: 'occasion', value: 'gift' }, { dim: 'category', value: 'Jewellery' }],
    art: '/meridian/scenes/graduation.svg',
  },
  {
    id: 'investment-piece',
    headline: 'One good thing instead of three',
    subhead: 'The version you keep.',
    aliases: ['investment', 'quality', 'last', 'splurge', 'timeless', 'buy once', 'expensive'],
    // Ridgeline is the leather footwear line. A Chelsea boot is the archetypal
    // buy-once piece, and the line clears both premium and heritage.
    touches: [{ dim: 'priceBand', value: 'premium' }, { dim: 'styleWorld', value: 'heritage' },
              { dim: 'line', value: 'Ridgeline' }],
    art: '/meridian/scenes/investment-piece.svg',
  },
];

export const FINANCIAL_SCENES: Scene[] = [
  {
    id: 'first-home',
    headline: 'Buying the first one',
    subhead: 'What the payment actually looks like, before you fall in love with a kitchen.',
    aliases: ['first home', 'buy a house', 'mortgage', 'first time buyer', 'down payment', 'house'],
    touches: [{ dim: 'productFamily', value: 'Mortgage' }, { dim: 'lifeStage', value: 'building' }],
    art: '/meridian/scenes/first-home.svg',
  },
  {
    id: 'new-car',
    headline: 'A car that has to last',
    subhead: 'Terms that do not punish you for keeping it.',
    aliases: ['car', 'auto', 'vehicle', 'truck', 'lease', 'drive'],
    touches: [{ dim: 'productFamily', value: 'Auto' }, { dim: 'intent', value: 'borrow' }],
    art: '/meridian/scenes/new-car.svg',
  },
  {
    id: 'starting-out',
    headline: 'Starting out',
    subhead: 'Build the record before you need it.',
    aliases: ['first card', 'credit', 'starting out', 'student', 'build credit', 'young', 'kid', 'first job'],
    touches: [{ dim: 'lifeStage', value: 'starting-out' }, { dim: 'amountBand', value: 'modest' }],
    art: '/meridian/scenes/starting-out.svg',
  },
  {
    id: 'paying-down',
    headline: 'Getting out from under it',
    subhead: 'Fewer payments, less interest, a date on the calendar.',
    aliases: ['refinance', 'consolidate', 'pay off', 'debt', 'lower rate', 'interest'],
    touches: [{ dim: 'intent', value: 'refinance' }, { dim: 'productFamily', value: 'Mortgage' }],
    art: '/meridian/scenes/paying-down.svg',
  },
  {
    id: 'saving-up',
    headline: 'Saving for something specific',
    subhead: 'Somewhere it earns while it waits.',
    aliases: ['save', 'savings', 'emergency fund', 'rainy day', 'interest rate', 'deposit'],
    touches: [{ dim: 'productFamily', value: 'Savings' }, { dim: 'intent', value: 'save' }],
    art: '/meridian/scenes/saving-up.svg',
  },
  {
    id: 'retirement',
    headline: 'Planning for later',
    subhead: 'Decisions that compound quietly.',
    aliases: ['retirement', 'retire', 'roth', 'ira', '401k', 'invest', 'portfolio', 'long term'],
    touches: [{ dim: 'productFamily', value: 'Investing' }, { dim: 'lifeStage', value: 'planning' }],
    art: '/meridian/scenes/retirement.svg',
  },
];

export function scenesFor(vertical: Vertical): Scene[] {
  return vertical === 'retail' ? RETAIL_SCENES : FINANCIAL_SCENES;
}

export function sceneById(vertical: Vertical, id: string): Scene | undefined {
  return scenesFor(vertical).find((s) => s.id === id);
}

/**
 * The deterministic classifier — and the reason the demo cannot fail on stage.
 *
 * It scores the query against each scene's alias list and returns the best
 * match. No network, no key, no model. When a model IS available it goes first
 * because it reads intent better; this is what catches everything else, and it
 * is good enough that the audience cannot tell which one answered.
 */
export function classifyLocally(vertical: Vertical, query: string): { scene: Scene; confidence: number } | null {
  const q = ' ' + query.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ') + ' ';
  let best: { scene: Scene; confidence: number } | null = null;

  for (const scene of scenesFor(vertical)) {
    let hits = 0;
    for (const alias of scene.aliases) {
      if (q.includes(' ' + alias + ' ') || q.includes(' ' + alias)) hits += alias.includes(' ') ? 2 : 1;
    }
    if (hits === 0) continue;
    const confidence = Math.min(0.95, 0.45 + hits * 0.18);
    if (!best || confidence > best.confidence) best = { scene, confidence };
  }
  return best;
}

/** A hard price ceiling stated in words. Parsed, never inferred. */
export function parseCeiling(query: string): number | null {
  const m = query.match(/(?:under|below|less than|max|up to|budget of)\s*\$?\s*([\d,]+)\s*(k)?/i)
    ?? query.match(/\$\s*([\d,]+)\s*(k)?/);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ''));
  if (!Number.isFinite(n)) return null;
  return m[2] ? n * 1000 : n;
}

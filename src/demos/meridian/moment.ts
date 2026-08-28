// src/demos/meridian/moment.ts
// ─────────────────────────────────────────────────────────────────────────────
// The signal-led moment.
//
// A signal arrives, Opal writes the creative, it composes onto ARTWORK THE BRAND
// ALREADY APPROVED, and it ships as a real Optimizely flag. Signal to live
// creative, in the time it takes to say what is happening.
//
// WE DO NOT GENERATE THE IMAGE, and that is a deliberate strengthening rather
// than a shortcut. Generating a photograph live invites exactly the question the
// beat exists to answer — "what happens when it invents something?" — and the
// awe here was never in the picture. It is in the LOOP: detect, write, approve,
// ship, all inside a sentence. So the model writes words over a still that was
// signed off before the demo started, and we say so on screen.
//
// THE DETECTION IS SIMULATED AND LABELLED. We do not ship social listening, and
// a chip on screen says so. Everything after that line is ours and is real.
// ─────────────────────────────────────────────────────────────────────────────

import { z } from 'zod';
import { generateObject } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import type { Env } from '@/types/env';
import type { Vertical } from './types';
import { itemsFor } from './catalog';
import { scenesFor } from './scenes';

export interface MomentSignal {
  source: string;          // 'TikTok' — the platform named in the simulated feed
  subject: string;         // what is spiking, in their words
  itemId: string;          // the REAL catalogue item it maps to
  sceneId: string;         // an APPROVED still
}

export interface MomentCreative {
  ok: boolean;
  signal?: MomentSignal;
  eyebrow?: string;
  headline?: string;
  subcopy?: string;
  cta?: string;
  art?: string;
  itemName?: string;
  source: 'model' | 'none';
  ms: number;
  reason?: string;
  /** Always true, always shown: the detection layer is not ours. */
  detectionSimulated: true;
}

/** What the simulated feed can report. Each maps to a real item and an approved still. */
export function signalsFor(vertical: Vertical): MomentSignal[] {
  const items = itemsFor(vertical);
  const scenes = scenesFor(vertical);
  const pickScene = (id: string) => (scenes.find((s) => s.id === id) ?? scenes[0]).id;
  return vertical === 'retail'
    ? [
        // .find takes the family's FIRST colourway — the lead colour of each family.
        { source: 'TikTok', subject: 'waxed field jackets', itemId: items.find((i) => i.name.includes('Field Jacket'))?.id ?? items[0].id, sceneId: pickScene('cold-snap') },
        { source: 'TikTok', subject: 'silk scarves worn as tops', itemId: items.find((i) => i.name.includes('Silk Square'))?.id ?? items[0].id, sceneId: pickScene('investment-piece') },
        { source: 'Instagram', subject: 'signet rings', itemId: items.find((i) => i.name.includes('Signet'))?.id ?? items[0].id, sceneId: pickScene('graduation') },
      ]
    : [
        { source: 'TikTok', subject: 'refinancing before the next cut', itemId: items.find((i) => i.name.includes('Refinance'))?.id ?? items[0].id, sceneId: pickScene('paying-down') },
        { source: 'Reddit', subject: 'first-time buyer panic', itemId: items.find((i) => i.name.includes('30-Year'))?.id ?? items[0].id, sceneId: pickScene('first-home') },
      ];
}

const TIMEOUT_MS = 7000;

export async function writeMoment(env: Env, vertical: Vertical, signal: MomentSignal): Promise<MomentCreative> {
  const t0 = Date.now();
  const item = itemsFor(vertical).find((i) => i.id === signal.itemId);
  const scene = scenesFor(vertical).find((s) => s.id === signal.sceneId);
  const base = { signal, art: scene?.art, itemName: item?.name, detectionSimulated: true as const };

  if (!env.GEMINI_API_KEY) {
    return { ...base, ok: false, source: 'none', ms: 0,
             reason: 'No model configured — nothing was written and nothing shipped.' };
  }

  const schema = z.object({
    eyebrow: z.string().describe('Short overline, <= 5 words, no exclamation marks.'),
    headline: z.string().describe('<= 7 words. Editorial, not advertising. No urgency language, no countdowns, no scarcity.'),
    subcopy: z.string().describe('One sentence, <= 18 words, concrete and calm.'),
    cta: z.string().describe('<= 3 words.'),
  });

  const run = generateObject({
    model: env.GEMINI_MODEL ? createGoogleGenerativeAI({ apiKey: env.GEMINI_API_KEY })(env.GEMINI_MODEL)
                            : createGoogleGenerativeAI({ apiKey: env.GEMINI_API_KEY })('gemini-2.5-flash'),
    schema,
    prompt:
      `You write the creative for a moment on a ${vertical === 'retail' ? 'clothing and luxury goods' : 'banking'} site.\n` +
      `A partner feed reports rising interest in "${signal.subject}" on ${signal.source}.\n` +
      `The one real product this is about: ${item?.name ?? 'unknown'}.\n` +
      `Brand voice: considered, understated, slightly dry. Things made to be kept. Never exclamatory, ` +
      `never salesy, never "discover" or "explore" or "elevate". Write like a good shop assistant who ` +
      `respects your time, not like an ad.\n` +
      `House rules, non-negotiable: no countdowns, no stock scarcity, no pressure language, no invented ` +
      `statistics, no claims about the product we have not made. Calm and specific beats loud.`,
  });

  const out = await Promise.race([
    run.then((r) => r.object).catch(() => null),
    new Promise<null>((res) => setTimeout(() => res(null), TIMEOUT_MS)),
  ]);
  if (!out) {
    return { ...base, ok: false, source: 'none', ms: Date.now() - t0,
             reason: 'The model did not answer in time. Nothing shipped — we are not going to fake the creative.' };
  }
  return { ...base, ok: true, ...out, source: 'model', ms: Date.now() - t0 };
}

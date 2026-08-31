// src/demos/meridian/opal.ts
// ─────────────────────────────────────────────────────────────────────────────
// Opal proposes an audience. A person publishes it.
//
// THE MODEL CANNOT INVENT AN AUDIENCE. Its output schema is built at request
// time from the live dimension registry and the live catalogue, so every
// dimension is an enum of real keys and every value is an enum of values that
// actually occur in this catalogue. A hallucinated dimension or a made-up value
// is rejected at the schema boundary before it reaches any code of ours — the
// same structural guarantee the scene router has, applied to targeting.
//
// AND IT DOES NOT PUBLISH. Proposing and publishing are two calls, because the
// governance beat is the point: the machine proposes, a merchandiser decides,
// and both are on the record. That is not a limitation we are apologising for;
// it is the answer to every black-box objection in the room.
// ─────────────────────────────────────────────────────────────────────────────

import { z } from 'zod';
import { generateObject } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import type { Env } from '@/types/env';
import type { Vertical } from './types';
import { configFor } from './reflexConfig';
import { itemsFor } from './catalog';
import { extractTouches } from '@/reflex/core';

export interface AudienceCondition { dim: string; value: string; atLeast: number }
export interface AudienceProposal {
  ok: boolean;
  name?: string;
  rationale?: string;
  conditions?: AudienceCondition[];
  /** Everything the model was allowed to choose from — shown on screen. */
  vocabulary?: Record<string, string[]>;
  source: 'model' | 'none';
  ms: number;
  reason?: string;
}

/** Every (dimension → values) pair that genuinely occurs in this catalogue. */
export function vocabularyFor(vertical: Vertical): Record<string, string[]> {
  const cfg = configFor(vertical);
  const vocab: Record<string, Set<string>> = {};
  for (const item of itemsFor(vertical)) {
    for (const t of extractTouches(item as unknown as Record<string, unknown>, cfg)) {
      (vocab[t.dim] ??= new Set()).add(t.value);
    }
  }
  const out: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(vocab)) out[k] = [...v].sort();
  return out;
}

const TIMEOUT_MS = 6000;

/** The audience a follow-up is refining — the conversation's own memory. */
export interface PriorAudience { name: string; conditions: Array<{ dim: string; value: string; atLeast: number }> }

export async function propose(
  env: Env, vertical: Vertical, ask: string, prior?: PriorAudience | null,
): Promise<AudienceProposal> {
  const t0 = Date.now();
  const vocabulary = vocabularyFor(vertical);
  const dims = Object.keys(vocabulary) as [string, ...string[]];
  if (!env.GEMINI_API_KEY) {
    return { ok: false, source: 'none', ms: 0, vocabulary,
             reason: 'No model configured — nothing was proposed and nothing was written.' };
  }

  // The schema IS the guardrail. Dimensions are an enum of real registry keys;
  // values are validated against the real catalogue below.
  const schema = z.object({
    name: z.string().describe('Short audience name in the merchandiser\'s own language, Title Case, <= 5 words.'),
    rationale: z.string().describe('One sentence: who this is and why it is worth targeting.'),
    conditions: z.array(z.object({
      dim: z.enum(dims).describe('A dimension key from the registry.'),
      value: z.string().describe('A value that occurs in this catalogue for that dimension.'),
      atLeast: z.number().min(0.3).max(0.9).describe('Minimum affinity, typically 0.6 (the entry threshold).'),
    })).min(1).max(3),
  });

  const google = createGoogleGenerativeAI({ apiKey: env.GEMINI_API_KEY });
  const run = generateObject({
    model: google(env.GEMINI_MODEL || 'gemini-2.5-flash'),
    schema,
    prompt:
      `You define a shopper audience for a ${vertical === 'retail' ? 'clothing and luxury goods retailer' : 'bank'}.\n` +
      `You may ONLY use these dimensions and values — nothing else exists:\n` +
      Object.entries(vocabulary).map(([d, vs]) => `  ${d}: ${vs.join(', ')}`).join('\n') + '\n' +
      `Use one to three conditions. Default atLeast to 0.6 unless the request implies stronger intent.\n` +
      `Name it the way a merchandiser would, not the way a database would.\n` +
      // REFINEMENT IS A CONVERSATION, not a fresh question each time. The prior
      // audience travels with the request so "narrow that to the premium band"
      // KEEPS what it is narrowing. The model is told in the same breath that a
      // request describing a different audience is not a refinement, so a new
      // subject never inherits conditions nobody asked for.
      (prior
        ? `The merchandiser is refining this audience:\n`
          + `  name: ${prior.name}\n`
          + prior.conditions.map((c) => `  condition: ${c.dim} = ${c.value} >= ${c.atLeast}`).join('\n') + '\n'
          + `KEEP those conditions and add or tighten as the request asks, unless the request contradicts one — `
          + `then replace only the contradicted condition. If the request describes a DIFFERENT audience rather `
          + `than a change to this one, ignore the audience above and answer the request on its own.\n`
        : '') +
      `Request: """${ask}"""`,
  });

  const out = await Promise.race([
    run.then((r) => r.object).catch(() => null),
    new Promise<null>((res) => setTimeout(() => res(null), TIMEOUT_MS)),
  ]);
  if (!out) {
    return { ok: false, source: 'none', ms: Date.now() - t0, vocabulary,
             reason: 'The model did not answer in time. Nothing was proposed — we are not going to invent one.' };
  }

  // Values are checked against the real catalogue, not trusted. A value the
  // catalogue does not contain is dropped and the drop is visible in the count.
  const conditions = out.conditions.filter((c) => vocabulary[c.dim]?.includes(c.value));
  if (!conditions.length) {
    return { ok: false, source: 'model', ms: Date.now() - t0, vocabulary,
             reason: 'Every condition referenced a value this catalogue does not contain, so nothing was proposed.' };
  }

  return { ok: true, name: out.name, rationale: out.rationale, conditions,
           vocabulary, source: 'model', ms: Date.now() - t0 };
}

/** Stable key for a published audience, in the same grammar the generator uses. */
export function audienceKeyFor(name: string): string {
  return 'mrd_' + name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 48);
}

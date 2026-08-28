// src/demos/meridian/concierge.ts
// ─────────────────────────────────────────────────────────────────────────────
// THE STYLE CONCIERGE — a stylist that builds a look, not a search that returns
// a list.
//
// THE GUARANTEE IS STRUCTURAL, NOT BEHAVIOURAL. Everything the room is worried
// about with a conversational surface — it invents a product, it recommends
// something we do not sell, it shows the same piece twice, it quietly
// substitutes when it cannot find what you asked for — is prevented at the
// SCHEMA boundary rather than requested in a prompt:
//
//   · Item ids are a z.enum built from the LIVE catalogue on every call. An id
//     we do not stock is not a value the model is able to return.
//   · Ids already shown in this conversation are REMOVED from that enum before
//     the call. "It will not repeat itself" is therefore not a promise about
//     the model's behaviour; repeating is unrepresentable.
//   · Anything the catalogue cannot satisfy goes in `unmet`, which the surface
//     prints verbatim. Saying "we do not have that" is a first-class outcome,
//     not a failure path.
//
// WHAT THE MODEL ACTUALLY DOES: reads the sentence, picks an anchor and its
// complements from a fixed list, and writes the reason. It does not rank, it
// does not decide eligibility, and it never sees a price or a stock level. The
// deterministic engine still owns the decision — the model owns the language.
//
// AFFINITY LEANS, THE REQUEST WINS. The visitor's live affinity is supplied as
// context so an unprompted look reflects what they have been doing. But an
// explicit instruction outranks it, because a stylist who keeps steering you
// back to what you looked at ten minutes ago is not listening.
// ─────────────────────────────────────────────────────────────────────────────

import { z } from 'zod';
import { generateObject } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import type { Env } from '@/types/env';
import type { Vertical } from './types';
import { itemsFor } from './catalog';

export interface ConciergeTurn {
  role: 'visitor' | 'concierge';
  text: string;
}

export interface ConciergeLook {
  ok: boolean;
  /** The piece the look is built around. */
  anchorId: string | null;
  /** Pieces that complete it. Never includes the anchor, never a repeat. */
  withIds: string[];
  title: string;
  /** On-brand rationale, naming pieces. Written by the model, bounded by the enum. */
  rationale: string;
  /** What the catalogue could not satisfy. Printed verbatim; never smoothed over. */
  unmet: string | null;
  source: 'model' | 'none';
  ms: number;
  reason?: string;
  /** Every id the surface has now shown, so the next turn can exclude them. */
  shown: string[];
}

/**
 * A slow model must never hold a beat open. Past this we say so on screen and
 * show nothing rather than filling in a guess.
 *
 * Measured, and the measurement is the whole story: with Gemini's default
 * thinking ON, turns ran 5.3s to over 9s and blew a 9s ceiling two times in
 * three. With thinking OFF (see the call below) the same turns run 0.96–1.42s.
 * 4s is therefore ~3x the observed worst case — generous enough to absorb a bad
 * network without ever being the reason a beat sits silent.
 */
const BUDGET_MS = 4000;

/** Trim to a sentence boundary where we can, so a cut never reads as a glitch. */
function clip(text: string, max: number): string {
  const t = (text ?? '').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('; '));
  return stop > max * 0.5 ? cut.slice(0, stop + 1) : `${cut.trimEnd()}…`;
}

export async function concierge(
  env: Env,
  vertical: Vertical,
  message: string,
  history: ConciergeTurn[] = [],
  alreadyShown: string[] = [],
  affinity: Record<string, string[]> = {},
): Promise<ConciergeLook> {
  const t0 = Date.now();
  const catalogue = itemsFor(vertical);
  const shown = new Set(alreadyShown);

  // The enum IS the catalogue, minus what this conversation has already used.
  const eligible = catalogue.filter((i) => !shown.has(i.id));
  const ids = eligible.map((i) => i.id);

  const base = {
    anchorId: null, withIds: [], title: '', rationale: '', unmet: null,
    shown: [...shown],
  };

  if (!env.GEMINI_API_KEY) {
    return { ...base, ok: false, source: 'none', ms: Date.now() - t0,
             reason: 'No model key is configured, so nothing was asked and nothing was invented.' };
  }
  if (ids.length < 2) {
    return { ...base, ok: false, source: 'none', ms: Date.now() - t0,
             reason: 'Every piece in the catalogue has already been shown in this conversation.' };
  }

  const google = createGoogleGenerativeAI({ apiKey: env.GEMINI_API_KEY });
  const idEnum = z.enum(ids as [string, ...string[]]);

  const schema = z.object({
    anchorId: idEnum.describe('The single piece the look is built around.'),
    // No upper bound. A max() here does not trim the look, it REJECTS it — the
    // model styled with four complements against a cap of three and the entire
    // answer came back as "did not match schema". The rule that came out of
    // this: CONSTRAIN IDENTITY, NEVER QUANTITY OR LENGTH. The enum is what
    // makes a hallucinated product impossible; how many pieces are in the look
    // and how long the sentence runs are presentation, and presentation is
    // trimmed on our side where a mismatch costs nothing.
    withIds: z.array(idEnum).min(1)
      .describe('Two to four pieces that complete the anchor. Never the anchor itself.'),
    // NO length caps on the prose. A max() here does not shorten the answer, it
    // REJECTS it — a good look that ran two characters long came back as "no
    // object generated" and the beat died. Brevity is asked for in the
    // description and enforced by truncating on our side. The enum bounds are
    // the guarantees that matter; these fields are language, not decisions.
    title: z.string().describe('A short name for this look, under 50 characters. No trailing punctuation.'),
    rationale: z.string()
      .describe('Two short sentences, under 220 characters. Refer to pieces by name. Say why they work together.'),
    // NOT nullable. Gemini's structured output handles a union-with-null badly
    // and the whole call comes back as "response did not match schema" — which
    // loses the look as well as the caveat. An empty string carries the same
    // meaning and is a plain type. It is the only nullable in this codebase and
    // it was the only surface failing.
    unmet: z.string()
      .describe('If the request asked for something this catalogue does not carry, say so plainly '
        + 'here in one sentence. Otherwise return an empty string. Never substitute silently.'),
  });

  // The catalogue as the model sees it: enough to style with, nothing to rank on.
  const lines = eligible.map((i) =>
    `${i.id} | ${i.name} | ${i.category} | ${i.subcategory} | ${i.world} | ${(i.needs ?? []).join('/')}`);

  const affinityLine = Object.entries(affinity)
    .filter(([, v]) => v.length)
    .map(([k, v]) => `${k}: ${v.join(', ')}`)
    .join(' · ') || 'nothing observed yet';

  const convo = history.slice(-6)
    .map((t) => `${t.role === 'visitor' ? 'Visitor' : 'You'}: ${t.text}`).join('\n');

  const prompt = [
    'You are the style concierge for Calder & Co. You build one look at a time.',
    '',
    'THE CATALOGUE — id | name | category | material | world | occasions:',
    ...lines,
    '',
    `What this visitor has actually been engaging with: ${affinityLine}.`,
    'Lean toward that when the request is open-ended. When the request is explicit,',
    'the request wins — do not steer them back to earlier behaviour.',
    '',
    convo ? `The conversation so far:\n${convo}\n` : '',
    `Visitor: ${message}`,
    '',
    'Choose an anchor and the pieces that complete it. Do not put the anchor in withIds.',
    'If they asked for something this catalogue does not carry, put that in unmet and',
    'build the closest honest look anyway — but say what is missing.',
  ].filter(Boolean).join('\n');

  try {
    // Thinking OFF. Gemini 2.5 reasons before answering by default, which is
    // most of the latency here and buys nothing: the hard part of this task —
    // "is this a real product" — is already solved by the enum, so the model is
    // only choosing and describing. With it on, turns ran 5.3s to over 9s and
    // blew the budget two times in three.
    const run = generateObject({
      model: google(env.GEMINI_MODEL || 'gemini-2.5-flash'),
      schema, prompt,
      providerOptions: { google: { thinkingConfig: { thinkingBudget: 0 } } },
    });
    const timeout = new Promise<never>((_, rej) =>
      setTimeout(() => rej(new Error('budget')), BUDGET_MS));
    const { object } = await Promise.race([run, timeout]) as Awaited<typeof run>;

    // Belt and braces on top of the enum: the anchor cannot also be a complement,
    // and duplicates within one look are dropped.
    const withIds = [...new Set(object.withIds)]
      .filter((id) => id !== object.anchorId)
      .slice(0, 4);
    const nowShown = [...shown, object.anchorId, ...withIds];

    return {
      ok: true,
      anchorId: object.anchorId,
      withIds,
      title: clip(object.title, 60),
      rationale: clip(object.rationale, 300),
      unmet: object.unmet && object.unmet.trim() ? clip(object.unmet.trim(), 180) : null,
      source: 'model',
      ms: Date.now() - t0,
      shown: nowShown,
    };
  } catch (e) {
    const budget = (e as Error).message === 'budget';
    // "did not match schema" alone is useless at 8am on a stage. Carry what the
    // model actually said, and which field the validator rejected.
    const detail = !budget
      ? [(e as any)?.text, JSON.stringify((e as any)?.cause?.issues ?? (e as any)?.cause?.message ?? '')]
          .filter(Boolean).join(' :: ').slice(0, 500)
      : '';
    return {
      ...base, ok: false, source: 'none', ms: Date.now() - t0,
      reason: budget
        ? `The concierge did not answer within ${BUDGET_MS}ms, so nothing is shown. It is not filled in with a guess.`
        : `The concierge call failed: ${(e as Error).message}${detail ? ` — ${detail}` : ''}`,
    };
  }
}

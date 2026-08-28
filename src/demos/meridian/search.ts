// src/demos/meridian/search.ts
// ─────────────────────────────────────────────────────────────────────────────
// Reading the sentence. That is the model's entire job here.
//
// The output schema's `scene` field is an ENUM built from the curated set, so a
// hallucinated scene is not a thing the model is able to return — it is rejected
// at the schema boundary before it reaches any code of ours. The model does not
// choose products, does not write the headline, and does not make an image.
//
// If the model is unavailable, slow, or wrong, the deterministic classifier
// answers instead and the shopper cannot tell. Every response says which one
// answered, and the demo surfaces it, because a system that admits when it fell
// back is more persuasive than one that pretends it never does.
// ─────────────────────────────────────────────────────────────────────────────

import { z } from 'zod';
import { generateObject } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import type { Env } from '@/types/env';
import type { Vertical } from './types';
import { scenesFor, sceneById, classifyLocally, parseCeiling, type Scene } from './scenes';

export interface SearchAnswer {
  ok: boolean;
  query: string;
  scene: Scene | null;
  /** Dimension touches the scene contributes. Ordinary signal, ordinary weight. */
  touches: Scene['touches'];
  ceiling: number | null;
  /** Which path answered. Shown on screen — never hidden. */
  source: 'model' | 'local' | 'none';
  confidence: number;
  ms: number;
  /** True when the model was tried and did not answer in time or at all. */
  fellBack: boolean;
}

/**
 * Hard ceiling so a slow model can never hold up a demo beat. Measured routing
 * latency runs ~0.9-1.9s, so 2.2s tripped on the slow tail and dropped answers
 * the model would have got right. 3.5s clears the tail; past that the local
 * classifier is genuinely the better answer because it is instant.
 */
const MODEL_TIMEOUT_MS = 3500;

async function classifyWithModel(
  env: Env, vertical: Vertical, query: string, budgetMs: number,
): Promise<{ id: string; confidence: number } | null> {
  if (!env.GEMINI_API_KEY) return null;
  const ids = scenesFor(vertical).map((s) => s.id) as [string, ...string[]];

  const schema = z.object({
    // An enum. There is no room in this type for an invention.
    scene: z.enum(ids).describe('The single closest scene from this fixed list.'),
    confidence: z.number().min(0).max(1).describe('How well the sentence fits that scene.'),
  });

  const google = createGoogleGenerativeAI({ apiKey: env.GEMINI_API_KEY });
  const run = generateObject({
    model: google(env.GEMINI_MODEL || 'gemini-2.5-flash'),
    schema,
    prompt:
      `You route a shopper's sentence to ONE scene from a fixed list. You do not invent scenes, ` +
      `products, or copy — routing is the whole task.\n` +
      `Scenes: ${scenesFor(vertical).map((s) => `${s.id} (${s.headline})`).join('; ')}\n` +
      `If nothing fits well, still pick the closest and report low confidence.\n` +
      `Sentence: """${query}"""`,
  });

  const timeout = new Promise<null>((res) => setTimeout(() => res(null), budgetMs));
  const out = await Promise.race([run.then((r) => r.object).catch(() => null), timeout]);
  return out ? { id: out.scene, confidence: out.confidence } : null;
}

export async function search(env: Env, vertical: Vertical, query: string): Promise<SearchAnswer> {
  const t0 = Date.now();
  const ceiling = parseCeiling(query);
  const trimmed = query.trim();

  if (!trimmed) {
    return { ok: false, query, scene: null, touches: [], ceiling, source: 'none', confidence: 0, ms: 0, fellBack: false };
  }

  const modelTried = Boolean(env.GEMINI_API_KEY);

  // Run the deterministic classifier FIRST — it is instant and costs nothing.
  // Its result then sets how long the model is allowed to take.
  const local = classifyLocally(vertical, trimmed);

  // Adaptive budget. When the words clearly match a scene we already have a good
  // answer in hand, so the model only gets a short window to produce a better
  // one. When nothing matched, waiting is worth it — that is the case the model
  // exists for. Previously a fixed ceiling meant an unrecognised sentence sat
  // through the FULL timeout before falling back to an answer we already had.
  // 0.6 = a single unambiguous alias hit. That is already a good answer, so the
  // model gets the short window rather than the long one.
  const budget = local && local.confidence >= 0.6 ? 1_200 : MODEL_TIMEOUT_MS;

  const viaModel = await classifyWithModel(env, vertical, trimmed, budget).catch(() => null);
  const chosen = viaModel ? sceneById(vertical, viaModel.id) : undefined;

  if (chosen) {
    return {
      ok: true, query: trimmed, scene: chosen, touches: chosen.touches, ceiling,
      source: 'model', confidence: viaModel!.confidence, ms: Date.now() - t0, fellBack: false,
    };
  }

  return {
    ok: Boolean(local),
    query: trimmed,
    scene: local?.scene ?? null,
    touches: local?.scene.touches ?? [],
    ceiling,
    source: local ? 'local' : 'none',
    confidence: local?.confidence ?? 0,
    ms: Date.now() - t0,
    fellBack: modelTried,
  };
}

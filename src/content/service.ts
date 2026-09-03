// src/content/service.ts
// The decision service: everything decide.ts needs, resolved from where it lives,
// with the failure posture doc 22 §1 requires — a store or state read that fails
// produces a cold decision, never a failed request. Reads only. Nothing here
// writes a record; the ledger writer is Phase 0's and consumes `records` as is.

import type { Env } from '@/types/env';
import { readRevision } from '@/config/versionedStore';
import { readReflexConfigRevision } from '@/reflex/configStore';
import { DEFAULT_REFLEX_CONFIG, snapshot as reflexSnapshot, type AffinitySnapshot, type ReflexConfig } from '@/reflex/core';
import { RealtimeSegmentEngine } from '@/services/RealtimeSegmentEngine';
import { getConnectors } from '@/connectors';
import { CONTENT_KIND, DEFAULT_LEARN, DEFAULT_SLOTS, EMPTY_CATALOG, LEARN_KIND, SLOTS_KIND } from './kinds';
import { armFor } from './holdout';
import { cellFor, type CfLike } from './cell';
import { decideContent } from './decide';
import { blendAffinity, lambdaFor, readTrend, regionKeyOf } from '@/reflex/regionTrend';
import type { ContentDecisionSet } from './types';

export interface ServeRequest {
  tenant: string;
  brand?: string;
  page: string;
  visitorId: string;
  cookieHeader: string | null;
  cf?: CfLike | null;
  channel?: string | null;
  nowMs?: number;
}

/** Where each input came from, so a reader can tell a tuned scope from a compiled default. */
export interface DecisionSources {
  catalog: { version: string | null; revision: number; pieces: number };
  slots: { version: string | null; revision: number; count: number };
  learn: { version: string | null; revision: number };
  config: { label: string; revision: number };
  state: 'do' | 'session' | 'none';
}

interface ShopperRead {
  affinity: AffinitySnapshot | null;
  sessionId: string | null;
  isNewSession: boolean | null;
  state: DecisionSources['state'];
}

/**
 * The shopper's live affinity, from whichever host holds it. Mirrors the two
 * branches of GET /realtime/reflex so the decision reads the same state the
 * instrument shows. A read failure is a cold shopper, not an error.
 */
async function readShopper(
  env: Env, visitorId: string, cookieHeader: string | null, cfg: ReflexConfig, now: number,
): Promise<ShopperRead> {
  if ((env.REFLEX_HOST ?? 'session') === 'do') {
    try {
      const stub = env.SHOPPER_REFLEX.get(env.SHOPPER_REFLEX.idFromName(visitorId));
      const res = await stub.fetch('https://shopper-reflex/snapshot');
      const body = (await res.json()) as { affinity?: AffinitySnapshot | null };
      return { affinity: body.affinity ?? null, sessionId: null, isNewSession: null, state: 'do' };
    } catch {
      return { affinity: null, sessionId: null, isNewSession: null, state: 'none' };
    }
  }
  try {
    const engine = new RealtimeSegmentEngine(env, getConnectors(env));
    const { sessionId, sessionData, isNewSession } = await engine.getOrCreateSessionFromCookies(cookieHeader, visitorId);
    return {
      affinity: sessionData.reflex ? reflexSnapshot(sessionData.reflex, now, cfg) : null,
      sessionId, isNewSession, state: 'session',
    };
  } catch {
    return { affinity: null, sessionId: null, isNewSession: null, state: 'none' };
  }
}

export async function serveContentDecisions(
  env: Env, r: ServeRequest,
): Promise<ContentDecisionSet & { sources: DecisionSources }> {
  const now = r.nowMs ?? Date.now();
  const scope = r.tenant;
  const brand = r.brand ?? r.tenant;

  const [catalogRev, slotsRev, learnRev, cfgRev] = await Promise.all([
    readRevision(env, CONTENT_KIND, scope, now),
    readRevision(env, SLOTS_KIND, scope, now),
    readRevision(env, LEARN_KIND, scope, now),
    readReflexConfigRevision(env, scope, now),
  ]);
  const catalog = catalogRev?.value ?? EMPTY_CATALOG;
  const slotsDoc = slotsRev?.value ?? DEFAULT_SLOTS;
  const learn = learnRev?.value ?? DEFAULT_LEARN;
  const cfg = cfgRev?.config ?? DEFAULT_REFLEX_CONFIG;
  const configRevision = cfgRev?.revision ?? 0;

  const shopper = await readShopper(env, r.visitorId, r.cookieHeader, cfg, now);
  const cell = cellFor({
    cf: r.cf, snap: shopper.affinity, cfg, channel: r.channel,
    // Only a session boundary the engine itself observed counts as evidence of
    // a first visit; anything else is unknown until CW7 gives visit number real semantics.
    visitNumber: shopper.isNewSession === true ? 1 : null,
  });
  const arm = armFor(r.visitorId, { ...learn.holdout, salt: learn.holdout.salt || brand });
  const slots = slotsDoc.pages[r.page] ?? [];

  // CW6: the population prior. Read from KV through the isolate cache, never
  // from the object; blended into a COPY of the affinity view. Off for the
  // holdout's default arm, since defaults are the point of that arm.
  const regionalCfg = learn.regional ?? { enabled: false, kBlend: 1, minEvents: 30 };
  let affinity: { dims: Record<string, Record<string, number>> } | null = shopper.affinity;
  let regional: Parameters<typeof decideContent>[0]['regional'] = null;
  if (regionalCfg.enabled && arm !== 'default') {
    const trend = await readTrend(env, scope, regionKeyOf(r.cf), regionalCfg.minEvents, now);
    if (trend) {
      const lambda = lambdaFor(shopper.affinity?.dims, regionalCfg.kBlend);
      const blended = blendAffinity(shopper.affinity?.dims, trend.snapshot.share, lambda);
      affinity = { dims: blended.dims };
      regional = { region: trend.region, level: trend.level, lambda, version: trend.snapshot.version, events: trend.snapshot.events, share: trend.snapshot.share };
    }
  }

  // What the state hung on: the DO host keys it on the durable visitor id, the
  // session host on the cookie, and a failed read on nothing at all.
  const identityAnchor = shopper.state === 'do' ? 'visitor' : shopper.state === 'session' ? 'session' : 'none';
  const set = decideContent({
    tenant: r.tenant, brand, page: r.page, visitorId: r.visitorId, sessionId: shopper.sessionId, identityAnchor, nowMs: now,
    pieces: catalog.pieces, slots, affinity, regional, cell, arm,
    versions: { config: configRevision, lift: 0, prior: 0, policy: 0 },
    configLabel: cfg.version,
  });

  return {
    ...set,
    sources: {
      catalog: { version: catalog.version ?? null, revision: catalogRev?.revision ?? 0, pieces: catalog.pieces.length },
      slots: { version: slotsDoc.version ?? null, revision: slotsRev?.revision ?? 0, count: slots.length },
      learn: { version: learn.version ?? null, revision: learnRev?.revision ?? 0 },
      config: { label: cfg.version, revision: configRevision },
      state: shopper.state,
    },
  };
}

// src/routes/sort.ts
// ---------------------------------------------------------------------------
// POST /sort: custom product sort over a candidate set. Ledger 20 row 9,
// scope appendix §1.11.
//
// The commerce platform calls its search exactly as it does today, sends us the
// candidate ids with the attributes the registry reads, and gets the same ids
// back in a per-shopper order. Its front end renders. That is the whole
// contract, and it is the same one the content decisions already use: decisions
// by id, over the wire, the customer's system paints.
//
// The ranking itself lives in @/reflex/sortCandidates and is pure. This file
// resolves three things and hands them to it: which brand, which shopper
// vector, and which registry. The shopper vector is read exactly the way
// GET /realtime/reflex reads it, on both hosts, so a sort and a snapshot can
// never disagree about who the shopper is.
// ---------------------------------------------------------------------------

import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from '@/types/env';
import { getConnectors } from '@/connectors';
import { RealtimeSegmentEngine } from '@/services/RealtimeSegmentEngine';
import { resolveReflexConfig, resolveSurface } from '@/demos/registry';
import { snapshot } from '@/reflex/core';
import { sortCandidates, type AffinityDims, type Candidate } from '@/reflex/sortCandidates';
import { shopperObject } from '@/tenancy/objects';
import { DEFAULT_TENANT, type TenantVariables } from '@/tenancy/tenant';

export const sortRoutes = new Hono<{ Bindings: Env; Variables: TenantVariables }>();

/** Bounded, because a candidate set is a page of results and not a catalog. */
const MAX_CANDIDATES = 500;

const bodySchema = z.object({
  userId: z.string().trim().min(1).max(200),
  sessionId: z.string().optional(),
  surface: z.string().optional(),
  candidates: z.array(z.object({ id: z.string() }).passthrough()).max(MAX_CANDIDATES),
  weights: z.object({
    affinity: z.number().optional(),
    dims: z.record(z.string(), z.number()).optional(),
  }).optional(),
});

/**
 * The shopper's affinity vector, read the way GET /realtime/reflex reads it.
 * Null when the shopper has no state yet, which the sorter treats as "nothing
 * to personalize on": the platform's order stands.
 */
async function affinityFor(
  c: { env: Env; get: (k: 'tenant') => string; req: { header: (n: string) => string | undefined } },
  userId: string,
  surfaceHint: string | undefined,
): Promise<{ dims: AffinityDims; configVersion: string }> {
  const env = c.env;
  // Explicit fallback. If this router is ever mounted without the tenancy
  // middleware, every helper below would default to the default brand on its
  // own -- but silently, and the response would echo undefined. Saying it once
  // here makes the fallback visible where it can be seen.
  const tenant = c.get('tenant') ?? DEFAULT_TENANT;

  if ((env.REFLEX_HOST ?? 'session') === 'do') {
    const stub = shopperObject(env.SHOPPER_REFLEX, userId, tenant);
    const res = await stub.fetch('https://shopper-reflex/snapshot');
    const body = (await res.json()) as {
      affinity?: { dims?: AffinityDims } | null;
      config?: { version?: string };
    };
    const cfg = await resolveReflexConfig(env, resolveSurface({ surface: surfaceHint }));
    return { dims: body.affinity?.dims ?? {}, configVersion: cfg.version };
  }

  const engine = new RealtimeSegmentEngine(env, getConnectors(env), { tenant });
  const { sessionData } = await engine.getOrCreateSessionFromCookies(c.req.header('Cookie') ?? null, userId);
  const cfg = await resolveReflexConfig(env, resolveSurface({ surface: surfaceHint ?? sessionData.surface }));
  const dims = sessionData.reflex ? snapshot(sessionData.reflex, Date.now(), cfg).dims : {};
  return { dims, configVersion: cfg.version };
}

sortRoutes.post('/', async (c) => {
  const parsed = bodySchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ ok: false, error: 'Invalid sort request', details: parsed.error.issues }, 400);
  }
  const { userId, surface, candidates, weights } = parsed.data;

  try {
    const { dims, configVersion } = await affinityFor(c, userId, surface);
    const cfg = await resolveReflexConfig(c.env, resolveSurface({ surface }));
    const result = sortCandidates(candidates as Candidate[], dims, cfg, weights);
    return c.json({
      ok: true,
      tenant: c.get('tenant') ?? DEFAULT_TENANT,
      configVersion,
      ...result,
    });
  } catch (error) {
    // A visitor id that addresses another brand's namespace lands here from
    // shopperObject(); it is refused, never served.
    const message = error instanceof Error ? error.message : 'sort failed';
    const status = /may not start with/.test(message) ? 400 : 500;
    return c.json({ ok: false, error: message }, status);
  }
});

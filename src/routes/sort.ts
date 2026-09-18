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
// vector, and which registry. Only an owned, consenting profile supplies the
// vector. Sorting never creates behavioral state or advances a visit.
// ---------------------------------------------------------------------------

import { Hono } from 'hono';
import { currentOwnerConsent, requireConsentPurpose } from '@/identity/sessionAuthority';
import { z } from 'zod';
import type { Env } from '@/types/env';
import { SessionManager } from '@/services/SessionManager';
import { consentOf, consentFromCookies, refusalHints, intersectConsent, storedConsent, personalizes, type Consent } from '@/content/consent';
import { resolveTenantReflexConfig, resolveSurface } from '@/demos/registry';
import { snapshot, type ReflexConfig } from '@/reflex/core';
import { sortCandidates, type AffinityDims, type Candidate } from '@/reflex/sortCandidates';
import { searchCandidates, InvalidSearchIntent } from '@/reflex/searchCandidates';
import { shopperObject } from '@/tenancy/objects';
import { DEFAULT_TENANT, type TenantVariables } from '@/tenancy/tenant';
import { requireShopper, shopperPrincipal, assertSessionTarget, privateShopperHeaders, SessionAccessError } from '@/identity/sessionCapability';
import { productSortIdentity, scheduleProductSort } from '@/ledger/productSort';

export const sortRoutes = new Hono<{ Bindings: Env; Variables: TenantVariables }>();

/** Bounded, because a candidate set is a page of results and not a catalog. */
const MAX_CANDIDATES = 500;

const bodySchema = z.object({
  userId: z.string().trim().min(1).max(200),
  sessionId: z.string().optional(),
  surface: z.string().optional(),
  consent: z.object({ tracking: z.boolean().optional(), personalization: z.boolean().optional() }).optional(),
  candidates: z.array(z.object({ id: z.string() }).passthrough()).max(MAX_CANDIDATES),
  weights: z.object({
    affinity: z.number().optional(),
    dims: z.record(z.string(), z.number()).optional(),
  }).optional(),
});

/**
 * Read existing owned state only. Empty affinity under either refusal also
 * removes private drivers; a zero ranking weight alone would still expose them.
 */
export async function affinityFor(
  c: { env: Env; get: (k: 'tenant') => string; req: { raw: Request; header: (n: string) => string | undefined } },
  userId: string,
  surfaceHint: string | undefined,
  hints: Consent,
): Promise<{ dims: AffinityDims; cfg: ReflexConfig; consent: Consent }> {
  const env = c.env;
  // Explicit fallback. If this router is ever mounted without the tenancy
  // middleware, every helper below would default to the default brand on its
  // own -- but silently, and the response would echo undefined. Saying it once
  // here makes the fallback visible where it can be seen.
  const tenant = c.get('tenant') ?? DEFAULT_TENANT;

  if ((env.REFLEX_HOST ?? 'session') === 'do') {
    const stub = shopperObject(env.SHOPPER_REFLEX, userId, tenant);
    const headers = privateShopperHeaders(c.req.raw);
    // Reuse the signed door's existing false-only cookie transport. Body hints
    // cannot enable a switch or replace the original request's capability.
    if (!hints.tracking || !hints.personalization) headers.Cookie = [
      ...(!hints.tracking ? ['opt_tracking_consent=false'] : []),
      ...(!hints.personalization ? ['opt_personalization_enabled=false'] : []),
    ].join('; ');
    const query = new URLSearchParams({ projection: 'sort', ...(surfaceHint ? { surface: surfaceHint } : {}) });
    const res = await stub.fetch(`https://shopper-reflex/snapshot?${query}`, { headers });
    if (!res.ok) throw new SessionAccessError();
    const body = (await res.json()) as {
      ok?: boolean; consent?: unknown;
      affinity?: { dims?: AffinityDims } | null;
      surface?: 'coach' | 'brighthour';
    };
    if (!body || body.ok !== true || body.consent === undefined) throw new Error('Sort consent unavailable');
    const consent = intersectConsent(storedConsent(body.consent), hints);
    if (consent.tracking) requireConsentPurpose(consent, personalizes(consent) ? 'personalization' : 'tracking');
    const cfg = await resolveTenantReflexConfig(env, tenant, resolveSurface({ surface: body.surface ?? surfaceHint }));
    return { dims: personalizes(consent) ? body.affinity?.dims ?? {} : {}, cfg, consent };
  }

  const principal = shopperPrincipal(c.req.raw);
  const manager = new SessionManager(env, { tenant, principal });
  const sessionData = await manager.readRaw(principal.sessionId, true);
  const consent = intersectConsent(await currentOwnerConsent() ?? consentOf(sessionData), hints);
  if (consent.tracking) requireConsentPurpose(consent, personalizes(consent) ? 'personalization' : 'tracking');
  if (!consent.tracking || !consent.personalization) await manager.restrictConsent(principal.sessionId, consent, { sessionId: principal.sessionId, data: sessionData });
  const cfg = await resolveTenantReflexConfig(env, tenant, resolveSurface({ surface: surfaceHint ?? sessionData?.surface }));
  const dims = personalizes(consent) && sessionData?.reflex ? snapshot(sessionData.reflex, Date.now(), cfg).dims : {};
  return { dims, cfg, consent };
}

sortRoutes.post('/', requireShopper({ bodyLimit: 2 * 1024 * 1024 }), async (c) => {
  const parsed = bodySchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ ok: false, error: 'Invalid sort request', details: parsed.error.issues }, 400);
  }
  const { userId, surface, candidates, weights } = parsed.data;
  assertSessionTarget(shopperPrincipal(c.req.raw), userId, parsed.data.sessionId);

  try {
    const identity = productSortIdentity(shopperPrincipal(c.req.raw), c.env);
    const hints = intersectConsent(consentFromCookies(c.req.header('Cookie')), refusalHints(parsed.data.consent));
    const { dims, cfg, consent } = await affinityFor(c, userId, surface, hints);
    const result = sortCandidates(candidates as Candidate[], dims, cfg, weights);
    const persistence = await scheduleProductSort(c.env.STORAGE, () => c.executionCtx, identity, consent, cfg, result, candidates.length, weights, null, c.env);
    if (consent.tracking && persistence.status !== 'durable') return c.json({ ok: false, error: 'Durable product receipt unavailable', persistence }, 503);
    return c.json({
      ok: true,
      tenant: c.get('tenant') ?? DEFAULT_TENANT,
      configVersion: cfg.version,
      ...result,
      persistence,
    });
  } catch (error) {
    if (error instanceof SessionAccessError) throw error;
    // A visitor id that addresses another brand's namespace lands here from
    // shopperObject(); it is refused, never served.
    const message = error instanceof Error ? error.message : 'sort failed';
    const status = /may not start with/.test(message) ? 400 : 500;
    return c.json({ ok: false, error: message }, status);
  }
});

const intentWeight = z.number().finite().min(0).max(10);
const intentBodySchema = z.object({
  userId: z.string().trim().min(1).max(200),
  sessionId: z.string().min(1).max(200).optional(),
  surface: z.string().max(64).optional(),
  consent: z.object({ tracking: z.boolean().optional(), personalization: z.boolean().optional() }).strict().optional(),
  candidates: z.array(z.object({
    id: z.string().trim().min(1).max(200),
    inStock: z.boolean(),
  }).catchall(z.union([z.string(), z.number().finite(), z.boolean(), z.null(), z.array(z.string())]))).max(MAX_CANDIDATES),
  intent: z.object({
    filters: z.array(z.object({
      dimension: z.string().trim().min(1).max(64),
      values: z.array(z.string().trim().min(1).max(128)).min(1).max(8),
    }).strict()).max(16),
  }).strict(),
  weights: z.object({ affinity: intentWeight.optional(), dims: z.record(z.string(), intentWeight).optional() }).strict().optional(),
  limit: z.number().int().min(1).max(MAX_CANDIDATES).default(9),
}).strict();

/** Count actual bytes before decoding/JSON parsing; Content-Length is untrusted. */
async function readIntentBody(request: Request): Promise<{ body: unknown; oversized: boolean }> {
  const reader = request.body?.getReader();
  if (!reader) return { body: null, oversized: false };
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false });
  let bytes = 0;
  let json = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 256 * 1024) {
        void reader.cancel().catch(() => undefined);
        return { body: null, oversized: true };
      }
      json += decoder.decode(value, { stream: true });
    }
    return { body: JSON.parse(json + decoder.decode()), oversized: false };
  } catch {
    void reader.cancel().catch(() => undefined);
    return { body: null, oversized: false };
  } finally { reader.releaseLock(); }
}

sortRoutes.post('/intent', requireShopper({ bodyLimit: 256 * 1024, bodyTooLarge: 'Intent request too large' }), async (c) => {
  const input = await readIntentBody(c.req.raw);
  if (input.oversized) return c.json({ ok: false, error: 'Intent request too large' }, 413);
  const parsed = intentBodySchema.safeParse(input.body);
  if (!parsed.success) return c.json({ ok: false, error: 'Invalid intent request' }, 400);
  const { userId, sessionId, surface, consent, candidates, intent, weights, limit } = parsed.data;
  assertSessionTarget(shopperPrincipal(c.req.raw), userId, sessionId);
  try {
    const identity = productSortIdentity(shopperPrincipal(c.req.raw), c.env);
    const hints = intersectConsent(consentFromCookies(c.req.header('Cookie')), refusalHints(consent));
    const { dims, cfg, consent: effectiveConsent } = await affinityFor(c, userId, surface, hints);
    const result = searchCandidates(candidates, intent, dims, cfg, weights, limit);
    const persistence = await scheduleProductSort(c.env.STORAGE, () => c.executionCtx, identity, effectiveConsent, cfg, result, candidates.length, weights, { filters: intent.filters, limit }, c.env);
    if (effectiveConsent.tracking && persistence.status !== 'durable') return c.json({ ok: false, error: 'Durable product receipt unavailable', persistence }, 503);
    return c.json({
      ok: true,
      tenant: c.get('tenant') ?? DEFAULT_TENANT,
      configVersion: cfg.version,
      ...result,
      persistence,
    });
  } catch (error) {
    if (error instanceof SessionAccessError) throw error;
    if (error instanceof InvalidSearchIntent) return c.json({ ok: false, error: 'Invalid intent filters' }, 400);
    return c.json({ ok: false, error: 'Intent ranking unavailable' }, 503);
  }
});

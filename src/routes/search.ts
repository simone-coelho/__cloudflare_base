import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from '@/types/env';
import type { TenantVariables } from '@/tenancy/tenant';
import type { ReflexConfig } from '@/reflex/core';
import { readSigningConfig } from '@/auth/signingConfig.mjs';
import { connectorConfiguration, connectorDigest } from '@/connectors/config';
import { ConnectorUnavailable, connectorDeadline, connectorJson } from '@/connectors/model';
import { groundSearchCandidates, retrieveSearchCatalog, type CatalogResult } from '@/connectors/catalogSearch';
import { interpretSearch, validateSearchIntent } from '@/reflex/searchIntent';
import { sortCandidates } from '@/reflex/sortCandidates';
import { consentFromCookies, intersectConsent, refusalHints } from '@/content/consent';
import { requireShopper, shopperPrincipal, SessionAccessError } from '@/identity/sessionCapability';
import { forwardShopperRequest, shopperRequestHeld } from '@/identity/sessionAuthority';
import { affinityFor } from './sort';
import { productSortIdentity, scheduleProductSort } from '@/ledger/productSort';
import { loadTombstone } from '@/ledger/erasure';

const publicSchema = z.object({ query: z.string().trim().min(1).max(2000), limit: z.number().int().min(1).max(100).default(9),
  consent: z.object({ tracking: z.boolean().optional(), personalization: z.boolean().optional() }).strict().optional(),
}).strict();
interface SearchPermit {
  version: 1; tenant: string; subject: string; sessionId: string; principal: string; consent: string;
  configuration: string; registry: string; query: string; at: number; until: number; nonce: string; signature: string;
}
const encode = (value: ArrayBuffer) => [...new Uint8Array(value)].map(v => v.toString(16).padStart(2, '0')).join('');
async function sealPermit(env: Env, value: Omit<SearchPermit, 'signature'>): Promise<string> {
  const material = readSigningConfig(env); if (!material) throw new SessionAccessError();
  const key = await crypto.subtle.importKey('raw', material.key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return encode(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(JSON.stringify([
    'owned-search-admission/v1', material.issuer, material.audience, await connectorDigest(value),
  ]))));
}
export const searchRoutes = new Hono<{ Bindings: Env; Variables: TenantVariables }>();
searchRoutes.post('/', requireShopper({ forward: false, bodyLimit: 8192, ownedBodyLimit: 2 * 1024 * 1024, bodyTimeoutMs: 5000 }), async c => {
  const principal = shopperPrincipal(c.req.raw), tenant = principal.tenant;
  const held = shopperRequestHeld(c.req.raw, principal);
  try {
    const config = connectorConfiguration(c.env, tenant);
    if (!config.search || !config.catalogSearch) throw new ConnectorUnavailable('disabled');
    const configuration = await connectorDigest({ search: config.search, catalogSearch: config.catalogSearch });
    if (!held) {
      // This is the raw edge environment, not an escaped owner effect wrapper.
      // Only the short admission/finalization messages enter owner serialization.
      return await connectorDeadline(Math.min(60000, config.search.timeoutMs + config.catalogSearch.timeoutMs), async deadline => {
        const value = await connectorJson(new Response(c.req.raw.body), 8192, deadline);
        const parsed = publicSchema.safeParse(value);
        if (!parsed.success) return c.json({ ok: false, code: 'invalid_search' }, 400);
        const input = parsed.data, query = await connectorDigest(input.query);
        const phase = async (body: unknown) => {
          deadline.live();
          const request = new Request(c.req.raw.url, { method: 'POST', headers: c.req.raw.headers, body: JSON.stringify(body) });
          const response = await forwardShopperRequest(c.env, request, principal); deadline.live(); return response;
        };
        const admitted = await phase({ stage: 'admit', query, configuration, consent: input.consent });
        if (!admitted.ok) return admitted;
        const initial = await connectorJson(admitted, 256 * 1024, deadline) as { permit: SearchPermit; registry: ReflexConfig };
        const permitted = { ...deadline, until: Math.min(deadline.until, initial.permit.until), live() {
          deadline.live(); if (Date.now() >= initial.permit.until) throw new ConnectorUnavailable('deadline');
        } };
        const authorize = async () => {
          permitted.live(); const checked = await phase({ stage: 'check', permit: initial.permit, consent: input.consent });
          if (!checked.ok) throw new SessionAccessError(); permitted.live();
        };
        const interpreted = await connectorDeadline(config.search!.timeoutMs, inner => interpretSearch(c.env, tenant, input.query, initial.registry, inner, authorize), permitted);
        deadline.live();
        if (!interpreted.intent.supported) return c.json({ ok: false, code: 'unsupported_query', complete: false }, 422);
        const catalog = await connectorDeadline(config.catalogSearch!.timeoutMs, inner => retrieveSearchCatalog(c.env, tenant, interpreted.intent, inner, authorize), permitted);
        deadline.live();
        return phase({ stage: 'complete', permit: initial.permit, intent: interpreted.intent, catalog,
          limit: input.limit, consent: input.consent, interpretation: { id: interpreted.witness.id, configurationDigest: interpreted.witness.configurationDigest } });
      });
    }
    const body = await c.req.json() as { stage?: unknown; query?: unknown; configuration?: unknown; consent?: Parameters<typeof refusalHints>[0];
      permit?: SearchPermit; intent?: unknown; catalog?: CatalogResult; limit?: number; interpretation?: { id?: string; configurationDigest?: string } };
    const hints = intersectConsent(consentFromCookies(c.req.header('Cookie')), refusalHints(body.consent));
    const owned = await affinityFor(c, principal.subject, undefined, hints);
    if (!owned.consent.tracking || !owned.consent.personalization) throw new SessionAccessError();
    const consent = await connectorDigest(owned.consent), registry = await connectorDigest(owned.cfg), identity = await connectorDigest(principal);
    if (body.stage === 'admit') {
      if (body.configuration !== configuration || typeof body.query !== 'string' || !/^[a-f0-9]{64}$/.test(body.query)) throw new SessionAccessError();
      const at = Date.now(), value: Omit<SearchPermit, 'signature'> = { version: 1, tenant, subject: principal.subject, sessionId: principal.sessionId,
        principal: identity, consent, configuration, registry, query: body.query, at,
        until: Math.min(principal.exp * 1000, at + config.search.timeoutMs + config.catalogSearch.timeoutMs), nonce: crypto.randomUUID() };
      const cutoff = await loadTombstone(c.env.STORAGE, tenant, principal.subject);
      if (cutoff && at <= cutoff.erased_at) throw new SessionAccessError();
      return c.json({ permit: { ...value, signature: await sealPermit(c.env, value) }, registry: owned.cfg });
    }
    if (!['complete', 'check'].includes(String(body.stage)) || !body.permit) throw new SessionAccessError();
    const { signature, ...permit } = body.permit;
    if (signature !== await sealPermit(c.env, permit) || permit.version !== 1 || permit.tenant !== tenant || permit.subject !== principal.subject
      || permit.sessionId !== principal.sessionId || permit.principal !== identity || permit.consent !== consent || permit.configuration !== configuration
      || permit.registry !== registry || permit.at > Date.now() || permit.until <= Date.now()) throw new SessionAccessError();
    // The original short permit cannot cross an erasure cutoff during a model
    // or feed wait. This does not change an already admitted durable record's
    // independent original retention/recovery lifetime.
    const cutoff = await loadTombstone(c.env.STORAGE, tenant, principal.subject);
    if (cutoff && permit.at <= cutoff.erased_at) throw new SessionAccessError();
    if (body.stage === 'check') return c.json({ ok: true });
    if (!body.catalog || !Number.isInteger(body.limit) || body.limit! < 1 || body.limit! > 100) throw new SessionAccessError();
    const catalog = body.catalog;
    if (catalog.configurationDigest !== await connectorDigest({ purpose: 'catalogSearch', tenant, ...config.catalogSearch })
      || !Number.isSafeInteger(catalog.asOf) || catalog.asOf > Date.now() || Date.now() - catalog.asOf > config.catalogSearch.maxAgeMs
      || catalog.digest !== await connectorDigest({ candidates: catalog.candidates, revision: catalog.revision, asOf: catalog.asOf })) throw new ConnectorUnavailable('conflict');
    const intent = validateSearchIntent(body.intent, config.search, owned.cfg);
    if (!intent.supported) throw new ConnectorUnavailable('schema');
    if (!body.interpretation?.id || body.interpretation.configurationDigest !== await connectorDigest({ purpose: 'search', tenant, ...config.search })) throw new ConnectorUnavailable('schema');
    const candidates = groundSearchCandidates(catalog.candidates, intent, config.search, owned.cfg);
    const ranked = sortCandidates(candidates, owned.dims, owned.cfg);
    const result = { ...ranked, source: 'structured-intent' as const, inputCount: candidates.length, filteredCount: 0,
      eligibleCount: ranked.items.length, items: ranked.items.slice(0, body.limit), order: ranked.order.slice(0, body.limit) };
    const persistence = await scheduleProductSort(c.env.STORAGE, () => c.executionCtx, productSortIdentity(principal, c.env), owned.consent,
      owned.cfg, result, candidates.length, undefined, { filters: [], limit: body.limit! }, c.env,
      { schema: 'catalog-search-context/v1', catalogRevision: catalog.revision, catalogAsOf: catalog.asOf, catalogDigest: catalog.digest,
        configurationDigest: configuration, interpretationId: body.interpretation.id, intent: { ...intent, supported: true } });
    if (persistence.status !== 'durable') throw new ConnectorUnavailable('transport');
    if (permit.until <= Date.now()) throw new ConnectorUnavailable('deadline');
    return c.json({ ok: true, complete: true, tenant, configVersion: owned.cfg.version,
      catalog: { revision: catalog.revision, asOf: catalog.asOf, digest: catalog.digest }, intent, ...result, source: 'catalog-search', persistence });
  } catch (error) {
    if (error instanceof SessionAccessError) throw error;
    return c.json({ ok: false, complete: false, code: error instanceof ConnectorUnavailable ? error.code : 'search_unavailable' },
      error instanceof ConnectorUnavailable && error.code === 'conflict' ? 409 : 503);
  }
});

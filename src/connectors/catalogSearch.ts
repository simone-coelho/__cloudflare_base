import { z } from 'zod';
import type { Env } from '@/types/env';
import type { ReflexConfig } from '@/reflex/core';
import type { SearchIntent } from '@/reflex/searchIntent';
import type { Candidate } from '@/reflex/sortCandidates';
import { connectorConfiguration, connectorDigest, connectorSecret, type SearchConfiguration } from './config';
import { ConnectorUnavailable, connectorBytes, type ConnectorDeadline } from './model';
import { destinationRetentionCategory, requireRetention, retentionBirth } from '@/retention';

const itemSchema = z.object({ id: z.string().min(1).max(200).refine(v => v.trim() === v), inStock: z.boolean(), entitled: z.boolean(),
  price: z.object({ currency: z.string().regex(/^[A-Z]{3}$/), minor: z.number().int().safe().nonnegative() }).strict(),
  giftEligible: z.boolean(), attributes: z.record(z.string(), z.array(z.string().min(1).max(128)).max(32)),
}).strict();
const pageSchema = z.object({ schema: z.literal('commerce-candidates/v1'), tenant: z.string(), mappingRevision: z.string(),
  revision: z.string().min(1).max(128), asOf: z.number().int().safe().nonnegative(), complete: z.boolean(),
  next: z.string().min(1).max(1024).nullable(), candidates: z.array(itemSchema).max(500),
}).strict();
export type CommerceCandidate = z.infer<typeof itemSchema>;
export interface CatalogResult { candidates: CommerceCandidate[]; revision: string; asOf: number; configurationDigest: string; digest: string }
export async function retrieveSearchCatalog(env: Env, tenant: string, intent: SearchIntent, deadline: ConnectorDeadline, authorize: () => Promise<void>): Promise<CatalogResult> {
  const config = connectorConfiguration(env, tenant).catalogSearch;
  if (!config) throw new ConnectorUnavailable('disabled');
  const descriptor = { purpose: 'catalogSearch', tenant, ...config }, configurationDigest = await connectorDigest(descriptor);
  const category = await destinationRetentionCategory('catalog', descriptor), born = retentionBirth(env, tenant, category, Date.now());
  const selected = new URL(config.url); let next: string | null = null, revision = '', asOf = 0, totalBytes = 0;
  const candidates: CommerceCandidate[] = [], seen = new Set<string>(), cursors = new Set<string>();
  const check = async () => {
    deadline.live(); const current = connectorConfiguration(env, tenant).catalogSearch;
    if (!current || await connectorDigest({ purpose: 'catalogSearch', tenant, ...current }) !== configurationDigest) throw new ConnectorUnavailable('conflict');
    requireRetention(env, born, tenant, category); await authorize(); deadline.live();
  };
  for (let n = 0; n < config.maxPages; n++) {
    await check();
    const body = JSON.stringify({ schema: 'commerce-query/v1', tenant, mappingRevision: config.mappingRevision, intent,
      revision: revision || null, cursor: next, limit: Math.min(100, config.maxCandidates - candidates.length) });
    deadline.live(); requireRetention(env, born, tenant, category);
    if (JSON.stringify(connectorConfiguration(env, tenant).catalogSearch) !== JSON.stringify(config)) throw new ConnectorUnavailable('conflict');
    const response = await fetch(selected, { method: 'POST', redirect: 'manual', signal: deadline.signal,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + connectorSecret(env, config.tokenRef) }, body });
    if (!response.ok) { void response.body?.cancel().catch(() => undefined); throw new ConnectorUnavailable('transport'); }
    const bytes = await connectorBytes(response, config.responseBytes - totalBytes, deadline);
    totalBytes += bytes.byteLength;
    let raw: unknown; try { raw = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes)); } catch { throw new ConnectorUnavailable('schema'); }
    const parsed = pageSchema.safeParse(raw); if (!parsed.success) throw new ConnectorUnavailable('schema');
    const page = parsed.data; await check();
    if (page.tenant !== tenant || page.mappingRevision !== config.mappingRevision || (revision && revision !== page.revision)
      || (asOf && asOf !== page.asOf) || page.asOf > Date.now() || Date.now() - page.asOf > config.maxAgeMs
      || page.complete !== (page.next === null)) throw new ConnectorUnavailable('conflict');
    revision = page.revision; asOf = page.asOf;
    for (const item of page.candidates) {
      if (seen.has(item.id) || candidates.length >= config.maxCandidates) throw new ConnectorUnavailable('limit');
      seen.add(item.id); candidates.push(item);
    }
    next = page.next;
    if (next === null) return { candidates, revision, asOf, configurationDigest, digest: await connectorDigest({ candidates, revision, asOf }) };
    if (!page.candidates.length || candidates.length >= config.maxCandidates || cursors.has(next)) throw new ConnectorUnavailable('limit');
    cursors.add(next);
  }
  throw new ConnectorUnavailable('limit');
}

/** Feed facts and all explicit constraints are hard filters. The ranker never
 * supplies prices, IDs, stock or entitlements, nor relaxes an empty result. */
export function groundSearchCandidates(candidates: readonly CommerceCandidate[], intent: SearchIntent, config: SearchConfiguration, registry: ReflexConfig): Candidate[] {
  const allowed = new Map(config.taxonomy.map(t => [t.dimension, new Set(t.values.map(v => v.value))]));
  const result: Candidate[] = [];
  for (const raw of candidates) {
    const item = itemSchema.parse(raw);
    if (item.price.currency !== config.currency) throw new ConnectorUnavailable('schema');
    for (const [dimension, values] of Object.entries(item.attributes)) {
      if (!allowed.has(dimension) || new Set(values).size !== values.length || values.some(v => !allowed.get(dimension)!.has(v))) throw new ConnectorUnavailable('schema');
    }
    for(const dimension of registry.dimensions)if(dimension.derive&&dimension.source===config.priceSource){
      if(!dimension.labels||!dimension.cuts)throw new ConnectorUnavailable('schema');
      const amount=item.price.minor/10**config.priceMinorUnits,found=dimension.cuts.findIndex(cut=>amount<cut);
      const label=dimension.labels[found<0?dimension.cuts.length:found];if(!label)throw new ConnectorUnavailable('schema');
      const supplied=item.attributes[dimension.key];
      if(supplied&&(supplied.length!==1||supplied[0]!==label))throw new ConnectorUnavailable('schema');
      item.attributes[dimension.key]=[label];
    }
    if (!item.inStock || !item.entitled || (intent.gift === 'required' && !item.giftEligible) || (intent.gift === 'exclude' && item.giftEligible)) continue;
    if (intent.price && ((intent.price.minMinor !== null && item.price.minor < intent.price.minMinor)
      || (intent.price.maxMinor !== null && item.price.minor > intent.price.maxMinor))) continue;
    if (intent.filters.some(f => !f.values.some(v => item.attributes[f.dimension]?.includes(v)))
      || intent.exclusions.some(f => f.values.some(v => item.attributes[f.dimension]?.includes(v)))) continue;
    const candidate: Candidate = { id: item.id, inStock: true };
    for (const dimension of registry.dimensions) {
      if (['id', 'inStock', '__proto__', 'constructor', 'prototype'].includes(dimension.source)) throw new ConnectorUnavailable('schema');
      const values = item.attributes[dimension.key];
      if (dimension.derive) {
        // A derived price band requires exact configured currency semantics;
        // other numeric derivations have no implied commerce mapping.
        if (dimension.source !== config.priceSource || !dimension.labels || !dimension.cuts) throw new ConnectorUnavailable('schema');
        candidate[dimension.source] = item.price.minor / 10 ** config.priceMinorUnits;
      } else if (values) {
        if (!dimension.multi && values.length > 1) throw new ConnectorUnavailable('schema');
        candidate[dimension.source] = dimension.multi ? values : values[0];
      }
    }
    result.push(candidate);
  }
  return result;
}

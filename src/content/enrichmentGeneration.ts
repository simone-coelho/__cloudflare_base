import { z } from 'zod';
import type { Env } from '@/types/env';
import { readPublication } from '@/config/publication';
import { REFLEX_KIND, reflexScopeForTenant } from '@/reflex/configStore';
import { CONTENT_KIND } from './kinds';
import { captureGeneratedEnrichment, EnrichmentError } from './enrichment';
import { connectorConfiguration, connectorDigest } from '@/connectors/config';
import { admitModel, ConnectorUnavailable, connectorBytes, connectorDeadline, invokeModel } from '@/connectors/model';

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const inputSchema = z.object({ catalogRevision: z.number().int().positive(), registryRevision: z.number().int().positive(),
  configurationDigest: hash, pieceIds: z.array(z.string().min(1).max(256)).min(1).max(500)
    .refine(v => new Set(v).size === v.length),
}).strict();
const outputSchema = z.object({ labels: z.array(z.object({ pieceId: z.string().min(1).max(256),
  dimension: z.string().min(1).max(96), value: z.string().min(1).max(128),
}).strict()).min(1).max(4000) }).strict();

export async function generateEnrichment(env: Env, tenant: string, actor: string, credential: 'access' | 'service',
  raw: unknown, authorize: () => Promise<void>) {
  const parsed = inputSchema.safeParse(raw);
  if (!parsed.success) throw new EnrichmentError('Generation requires exact catalog, registry, configuration and sample pins', 422);
  const input = parsed.data, config = connectorConfiguration(env, tenant).enrichment;
  if (!config) throw new ConnectorUnavailable('disabled');
  return connectorDeadline(config.timeoutMs, async deadline => {
    await authorize();
    const admission = await admitModel(env, tenant, 'enrichment');
    if (admission.configurationDigest !== input.configurationDigest) throw new ConnectorUnavailable('conflict');
    const catalog = await readPublication(env, CONTENT_KIND, tenant);
    const registry = await readPublication(env, REFLEX_KIND, reflexScopeForTenant(tenant));
    if (catalog.revision !== input.catalogRevision || registry.revision !== input.registryRevision) throw new ConnectorUnavailable('conflict');
    const catalogDigest = await connectorDigest(catalog), registryDigest = await connectorDigest(registry);
    const dimensions = new Set(registry.value.dimensions.filter(d => !d.derive).map(d => d.key));
    if (config.taxonomy.some(t => !dimensions.has(t.dimension))) throw new ConnectorUnavailable('schema');
    const byId = new Map(catalog.value.pieces.map(p => [p.id, p]));
    const samplePieces = input.pieceIds.map(id => { const p = byId.get(id); if (!p) throw new ConnectorUnavailable('schema'); return p; });
    const check = async () => {
      deadline.live(); await authorize(); await admission.recheck();
      const currentCatalog = await readPublication(env, CONTENT_KIND, tenant);
      const currentRegistry = await readPublication(env, REFLEX_KIND, reflexScopeForTenant(tenant));
      if (await connectorDigest(currentCatalog) !== catalogDigest || await connectorDigest(currentRegistry) !== registryDigest) throw new ConnectorUnavailable('conflict');
      deadline.live();
    };
    const images: Array<{ bytes: Uint8Array; mediaType: string }> = [], imageDigests: string[] = [];
    // Validate the entire selected projection before any image/model egress.
    const pieces = samplePieces.map(piece => {
      const source = piece as unknown as Record<string, unknown>, projected: Record<string, unknown> = { id: piece.id };
      for (const field of config.fields) if (Object.hasOwn(source, field)) {
        const value = source[field];
        if ((typeof value === 'string' && value.trim()) || (Array.isArray(value) && value.length)
          || (value && typeof value === 'object' && Object.keys(value).length)) projected[field] = value;
      }
      if (Object.keys(projected).length === 1 && !(config.images && source[config.images.field])) throw new ConnectorUnavailable('schema');
      if (config.images && source[config.images.field] !== undefined) {
        if (typeof source[config.images.field] !== 'string') throw new ConnectorUnavailable('schema');
        let url: URL; try { url = new URL(source[config.images.field] as string); } catch { throw new ConnectorUnavailable('schema'); }
        if (url.protocol !== 'https:' || url.username || url.password || url.hash || !config.images.origins.includes(url.origin + '/')) throw new ConnectorUnavailable('policy');
      }
      return projected;
    });
    for (const [index, piece] of samplePieces.entries()) {
      const source = piece as unknown as Record<string, unknown>, projected = pieces[index];
      if (config.images && source[config.images.field] !== undefined) {
        if (images.length >= config.images.maxImages || typeof source[config.images.field] !== 'string') throw new ConnectorUnavailable('limit');
        let url: URL; try { url = new URL(source[config.images.field] as string); } catch { throw new ConnectorUnavailable('schema'); }
        if (url.protocol !== 'https:' || url.username || url.password || url.hash || !config.images.origins.includes(url.origin + '/')) throw new ConnectorUnavailable('policy');
        await check();
        deadline.live(); admission.transport();
        const response = await fetch(url, { redirect: 'manual', signal: deadline.signal, headers: { Accept: 'image/png,image/jpeg,image/webp' } });
        const mediaType = response.headers.get('Content-Type')?.split(';')[0];
        if (!response.ok || !mediaType || !['image/png', 'image/jpeg', 'image/webp'].includes(mediaType)) {
          void response.body?.cancel().catch(() => undefined); throw new ConnectorUnavailable('transport');
        }
        const bytes = await connectorBytes(response, config.images.maxBytes, deadline); await check();
        projected.imageIndex = images.length;
        imageDigests.push(await connectorDigest(Array.from(bytes))); images.push({ bytes, mediaType });
      }
    }
    const { value, witness } = await invokeModel(env, tenant, 'enrichment', admission, outputSchema,
      { task: 'Propose only supported taxonomy labels for the provided sample. A human must approve each label before publication.',
        taxonomy: config.taxonomy, pieces, imageDigests }, deadline, images, authorize);
    const selected = new Set(input.pieceIds), allowed = new Map(config.taxonomy.map(t => [t.dimension, new Set(t.values.map(v => v.value))]));
    const duplicate = new Set<string>();
    const labels = value.labels.map((label, i) => {
      const id = JSON.stringify([label.pieceId, label.dimension, label.value]);
      if (!selected.has(label.pieceId) || !allowed.get(label.dimension)?.has(label.value) || duplicate.has(id)) throw new ConnectorUnavailable('schema');
      duplicate.add(id); return { ...label, id: 'label-' + i };
    });
    await check();
    const declared = { source: 'configured-model-generation', model: config.model };
    return captureGeneratedEnrichment(env.STORAGE, tenant, actor, credential,
      { sample: { ...catalog.value, pieces: samplePieces }, labels, provenance: declared },
      { declared, verified: true, invocation: witness, catalogRevision: catalog.revision, registryRevision: registry.revision,
        catalogDigest, registryDigest, taxonomyDigest: await connectorDigest(config.taxonomy), imageDigests }, check);
  });
}

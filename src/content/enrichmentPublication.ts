// Explicit design-time publication of retained human-reviewed tag additions.
// The catalog publisher owns reservation, immutable receipts and replay.
import type { Env } from '@/types/env';
import type { WriteMeta } from '@/config/versionedStore';
import { publish } from '@/config/publication';
import { EnrichmentError, exportEnrichment } from './enrichment';
import { CONTENT_KIND } from './kinds';

const HASH = /^[0-9a-f]{64}$/;
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export async function publishEnrichment(env: Env, tenant: string, id: string, input: unknown, meta: WriteMeta) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).length !== 2 || !Object.hasOwn(input, 'proposalDigest') || !Object.hasOwn(input, 'reviewDigest')) {
    throw new EnrichmentError('Publication requires exactly proposalDigest and reviewDigest', 422);
  }
  const { proposalDigest, reviewDigest } = input as Record<string, unknown>;
  if (typeof proposalDigest !== 'string' || !HASH.test(proposalDigest) || typeof reviewDigest !== 'string' || !HASH.test(reviewDigest)) {
    throw new EnrichmentError('Publication digests must be canonical SHA-256 strings', 422);
  }
  const { proposal, review, additions } = await exportEnrichment(env.STORAGE, tenant, id);
  if (proposal.digest !== proposalDigest || review.digest !== reviewDigest) throw new EnrichmentError('Publication evidence digest does not match', 409);
  const request = { type: 'enrichment', proposalId: id, proposalDigest, reviewDigest };
  const result = await publish(env, CONTENT_KIND, tenant, request, { ...meta, note: JSON.stringify(request) }, base => {
    if (!additions.length) throw new EnrichmentError('No approved tag additions to publish', 409);
    const samples = new Map(proposal.sample.pieces.map(piece => [piece.id, piece]));
    const targets = new Map<string, typeof additions>();
    for (const addition of additions) {
      const entries = targets.get(addition.pieceId);
      if (entries) entries.push(addition); else targets.set(addition.pieceId, [addition]);
    }
    const current = new Map(base.pieces.map(piece => [piece.id, piece]));
    for (const id of targets.keys()) {
      const piece = current.get(id);
      if (!piece || canonical(piece) !== canonical(samples.get(id))) throw new EnrichmentError('Approved sample target differs from the current catalog', 409);
    }
    let changed = false;
    const pieces = base.pieces.map(piece => {
      const entries = targets.get(piece.id); if (!entries) return piece;
      const tags = { ...piece.tags }, seen = new Map<string, { values: string[]; unique: Set<string> }>();
      for (const { dimension, value } of entries) {
        let entry = seen.get(dimension);
        if (!entry) {
          const original = Object.hasOwn(tags, dimension) ? tags[dimension]! : [];
          entry = { values: [...original], unique: new Set(original) };
          tags[dimension] = entry.values; seen.set(dimension, entry);
        }
        if (!entry.unique.has(value)) {
          entry.values.push(value); entry.unique.add(value); changed = true;
        }
      }
      return { ...piece, tags };
    });
    if (!changed) throw new EnrichmentError('Approved tags already exist; no catalog change', 409);
    return { ...base, pieces };
  });
  return result.ok ? { ok: true as const, schema: 'content-enrichment-publication/v1' as const,
    proposalId: id, proposalDigest, reviewDigest, operationId: meta.operationId,
    revision: result.revision.revision, actor: result.revision.actor, at: result.revision.at,
    note: result.revision.note, document: result.revision.value } : result;
}

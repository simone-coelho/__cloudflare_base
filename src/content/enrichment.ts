// Immutable design-time evidence. Supplied claims remain explicitly unverified;
// the separate admitted generator supplies a validated invocation witness.
import { CONTENT_KIND, validateContentCatalog } from './kinds';
import { isValidTenantId } from '@/tenancy/tenant';
import type { ModelWitness } from '@/connectors/model';
import { readRetention, type RetentionCategory } from '@/retention';

export const ENRICHMENT_MAX_BYTES = 2 * 1024 * 1024;
const MAX_PIECES = 500, MAX_LABELS = 4000, MAX_DEPTH = 16;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HASH = /^[0-9a-f]{64}$/;
const forbidden = new Set(['__proto__', 'constructor', 'prototype']);
const encoder = new TextEncoder();
type JsonObject = Record<string, unknown>;
type Sample = JsonObject & { pieces: Array<JsonObject & { id: string; customerContentId: string }> };
type Label = { id: string; pieceId: string; dimension: string; value: string };
type Provenance = { source: string; model?: string };
type Disposition = { labelId: string; action: 'approve' | 'reject' }
  | { labelId: string; action: 'edit'; dimension: string; value: string };
export interface EnrichmentProposal {
  schema: 'content-enrichment-proposal/v1'; id: string; tenant: string;
  createdAt: string; createdBy: string; createdWith: 'access' | 'service';
  sample: Sample; labels: Label[]; provenance: { declared: Provenance; verified: false }
    | { declared: Provenance; verified: true; invocation: ModelWitness; catalogRevision: number; registryRevision: number;
      catalogDigest: string; registryDigest: string; taxonomyDigest: string; imageDigests: string[] }; digest: string;
}
export interface EnrichmentReview {
  schema: 'content-enrichment-review/v1'; id: string; tenant: string; proposalDigest: string;
  reviewedAt: string; reviewedBy: string; reviewerType: 'access'; dispositions: Disposition[]; digest: string;
}

export class EnrichmentError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409 | 413 | 422 | 503, readonly proposalId?: string) { super(message); }
}
function requireValue(ok: unknown, message = 'Invalid enrichment payload'): asserts ok {
  if (!ok) throw new EnrichmentError(message, 422);
}
const object = (v: unknown): v is JsonObject => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown, max: number): v is string => typeof v === 'string' && v.length > 0 && v.length <= max
  && v.trim() === v && !Array.from(v).some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127);
function fields(v: unknown, required: string[], optional: string[] = []): asserts v is JsonObject {
  requireValue(object(v) && required.every(k => Object.hasOwn(v, k))
    && Object.keys(v).every(k => required.includes(k) || optional.includes(k)));
}
function safeJson(v: unknown, depth = 0): void {
  requireValue(depth <= MAX_DEPTH, 'JSON nesting exceeds 16 levels');
  if (Array.isArray(v)) { for (const item of v) safeJson(item, depth + 1); }
  else if (object(v)) {
    for (const [key, value] of Object.entries(v)) {
      requireValue(!forbidden.has(key), 'Prototype keys are not accepted'); safeJson(value, depth + 1);
    }
  } else requireValue(v === null || typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v)));
}
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (object(v)) return `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  return JSON.stringify(v);
}
async function digest(v: unknown): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(canonical(v)))))
    .map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Count actual UTF-8 bytes, including streamed bodies with a false/missing length. */
async function readJson(stream: ReadableStream<Uint8Array> | null): Promise<{ value: unknown; bytes: number }> {
  if (!stream) throw new EnrichmentError('JSON body required', 400);
  const reader = stream.getReader(), decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  let bytes = 0, raw = '';
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      bytes += value.byteLength;
      if (bytes > ENRICHMENT_MAX_BYTES) {
        void reader.cancel().catch(() => undefined);
        throw new EnrichmentError('Enrichment body exceeds 2 MiB', 413);
      }
      raw += decoder.decode(value, { stream: true });
    }
    raw += decoder.decode();
    const value: unknown = JSON.parse(raw); safeJson(value);
    return { value, bytes };
  } catch (error) {
    void reader.cancel().catch(() => undefined);
    if (error instanceof EnrichmentError) throw error;
    throw new EnrichmentError('Body must be valid UTF-8 JSON', 400);
  } finally { reader.releaseLock(); }
}
export async function readEnrichmentBody(request: Request): Promise<unknown> {
  if (request.headers.get('Content-Type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json') {
    throw new EnrichmentError('Content-Type must be application/json', 400);
  }
  return (await readJson(request.body)).value;
}
function captureInput(v: unknown, stored = false): { sample: Sample; labels: Label[]; provenance: Provenance } {
  fields(v, ['sample', 'labels', 'provenance']);
  requireValue(object(v.sample) && Array.isArray(v.sample.pieces)
    && v.sample.pieces.length > 0 && v.sample.pieces.length <= MAX_PIECES, 'Sample requires 1–500 pieces');
  // Samples retain raw metadata/aliases, not normalized catalog bodies. Read old
  // evidence under its original schema OR the current one; new captures stay strict.
  requireValue(validateContentCatalog(v.sample).ok || (stored && CONTENT_KIND.validateStored!(v.sample).ok),
    'Sample must satisfy the content catalog schema');
  const sample = v.sample as Sample;
  requireValue(sample.pieces.every(p => text(p.id, 256) && text(p.customerContentId, 256)), 'Content IDs must be bounded strings');
  requireValue(Array.isArray(v.labels) && v.labels.length > 0 && v.labels.length <= MAX_LABELS, 'Proposal requires 1–4000 labels');
  const ids = new Set<string>(), targets = new Set(sample.pieces.map(p => p.id));
  for (const label of v.labels) {
    fields(label, ['id', 'pieceId', 'dimension', 'value']);
    requireValue(text(label.id, 128) && !ids.has(label.id) && typeof label.pieceId === 'string' && targets.has(label.pieceId)
      && text(label.dimension, 256) && !forbidden.has(label.dimension) && text(label.value, 256), 'Invalid or duplicate label ID, target or tag');
    ids.add(label.id);
  }
  fields(v.provenance, ['source'], ['model']);
  requireValue(text(v.provenance.source, 1000) && (v.provenance.model === undefined || text(v.provenance.model, 256)), 'Declared source/model required');
  // Intentionally discard the validator's normalized output: it drops metadata.
  return { sample, labels: v.labels as Label[], provenance: v.provenance as Provenance };
}
function reviewInput(v: unknown, proposal: EnrichmentProposal): { proposalDigest: string; dispositions: Disposition[] } {
  fields(v, ['proposalDigest', 'dispositions']);
  requireValue(typeof v.proposalDigest === 'string' && HASH.test(v.proposalDigest));
  if (v.proposalDigest !== proposal.digest) throw new EnrichmentError('Proposal digest does not match', 409);
  requireValue(Array.isArray(v.dispositions) && v.dispositions.length === proposal.labels.length, 'Review must decide every label exactly once');
  const expected = new Set(proposal.labels.map(label => label.id));
  for (const item of v.dispositions) {
    requireValue(object(item));
    fields(item, item.action === 'edit' ? ['labelId', 'action', 'dimension', 'value'] : ['labelId', 'action']);
    requireValue(typeof item.labelId === 'string' && expected.delete(item.labelId)
      && (item.action === 'approve' || item.action === 'edit' || item.action === 'reject'), 'Invalid, duplicate or unknown review label');
    if (item.action === 'edit') requireValue(text(item.dimension, 256) && !forbidden.has(item.dimension) && text(item.value, 256), 'Edit requires a valid dimension and value');
  }
  requireValue(expected.size === 0, 'Review must decide every label exactly once');
  return v as { proposalDigest: string; dispositions: Disposition[] };
}
function keyOf(tenant: string, id: string, kind: 'proposal' | 'review'): string {
  if (!isValidTenantId(tenant) || !UUID.test(id)) throw new EnrichmentError('Invalid enrichment identity', 400);
  return `content-enrichment/v1/${tenant}/${id}/${kind}.json`;
}
const timestamp = (v: unknown) => typeof v === 'string' && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
async function stored(storage: R2Bucket, key: string): Promise<unknown | null> {
  try {
    const result = await storage.get(key);
    if (result === null) return null;
    requireValue(result && result.key === key && text(result.etag, 256) && Number.isInteger(result.size)
      && result.size > 0 && result.size <= ENRICHMENT_MAX_BYTES && result.body);
    const parsed = await readJson(result.body); requireValue(parsed.bytes === result.size && object(parsed.value));
    return parsed.value;
  } catch { throw new EnrichmentError('Enrichment storage unavailable or corrupt', 503); }
}
async function createOnly(storage: R2Bucket, key: string, value: unknown): Promise<void> {
  const body = JSON.stringify(value), bytes = encoder.encode(body).byteLength;
  if (bytes > ENRICHMENT_MAX_BYTES) throw new EnrichmentError('Stored enrichment envelope exceeds 2 MiB', 413);
  let result: R2Object | null;
  try {
    result = await storage.put(key, body, { onlyIf: new Headers({ 'If-None-Match': '*' }), httpMetadata: { contentType: 'application/json' } });
    if (result !== null && (!result || result.key !== key || !text(result.etag, 256) || result.size !== bytes)) throw new Error('Unconfirmed write');
  } catch { throw new EnrichmentError('Enrichment write unconfirmed; use readback before retry', 503); }
  if (result === null) throw new EnrichmentError('Immutable enrichment object already exists', 409);
}
async function capture(storage: R2Bucket, tenant: string, actor: string, credential: 'access' | 'service', input: unknown,
  provenance?: Extract<EnrichmentProposal['provenance'], { verified: true }>, authorize?: () => Promise<void>): Promise<EnrichmentProposal> {
  safeJson(input); const parsed = captureInput(input);
  requireValue(text(actor, 256));
  const basis = { schema: 'content-enrichment-proposal/v1' as const, id: crypto.randomUUID(), tenant,
    createdAt: new Date().toISOString(), createdBy: actor, createdWith: credential,
    sample: parsed.sample, labels: parsed.labels, provenance: provenance ?? { declared: parsed.provenance, verified: false as const } };
  const proposal = { ...basis, digest: await digest(basis) };
  await authorize?.();
  try { await createOnly(storage, keyOf(tenant, proposal.id, 'proposal'), proposal); }
  catch (error) {
    if (error instanceof EnrichmentError && error.status === 503) throw new EnrichmentError(error.message, 503, proposal.id);
    throw error;
  }
  return proposal;
}
export function captureEnrichment(storage: R2Bucket, tenant: string, actor: string, credential: 'access' | 'service', input: unknown): Promise<EnrichmentProposal> {
  return capture(storage, tenant, actor, credential, input);
}
/** Only the server-side generation route constructs this provenance. The public
 * supplied-proposal schema still rejects every purported verified field. */
export function captureGeneratedEnrichment(storage: R2Bucket, tenant: string, actor: string, credential: 'access' | 'service',
  input: unknown, provenance: Extract<EnrichmentProposal['provenance'], { verified: true }>, authorize: () => Promise<void>): Promise<EnrichmentProposal> {
  validateGenerated(provenance, tenant);
  return capture(storage, tenant, actor, credential, input, provenance, authorize);
}
function validateGenerated(value: unknown, tenant: string): void {
  fields(value, ['declared', 'verified', 'invocation', 'catalogRevision', 'registryRevision', 'catalogDigest', 'registryDigest', 'taxonomyDigest', 'imageDigests']);
  requireValue(value.verified === true && Number.isSafeInteger(value.catalogRevision) && Number(value.catalogRevision) > 0
    && Number.isSafeInteger(value.registryRevision) && Number(value.registryRevision) > 0);
  for (const key of ['catalogDigest', 'registryDigest', 'taxonomyDigest']) requireValue(typeof value[key] === 'string' && HASH.test(value[key] as string));
  requireValue(Array.isArray(value.imageDigests) && value.imageDigests.length <= 16 && value.imageDigests.every(v => typeof v === 'string' && HASH.test(v)));
  fields(value.invocation, ['schema', 'id', 'tenant', 'purpose', 'provider', 'model', 'configurationDigest', 'inputDigest', 'outputDigest',
    'requestDigest', 'responseDigest', 'startedAt', 'completedAt', 'retention']);
  const w = value.invocation;
  requireValue(w.schema === 'model-invocation/v1' && w.tenant === tenant && w.purpose === 'enrichment' && w.provider === 'google'
    && typeof w.id === 'string' && UUID.test(w.id) && text(w.model, 101)
    && Number.isSafeInteger(w.startedAt) && Number.isSafeInteger(w.completedAt) && Number(w.completedAt) >= Number(w.startedAt));
  for (const key of ['configurationDigest', 'inputDigest', 'outputDigest', 'requestDigest', 'responseDigest']) requireValue(typeof w[key] === 'string' && HASH.test(w[key] as string));
  requireValue(object(w.retention) && w.retention.tenant === tenant && typeof w.retention.category === 'string'
    && /^external\.model\.[a-f0-9]{64}$/.test(w.retention.category) && Number(w.retention.expiresAt) > Number(w.completedAt));
  readRetention(w.retention, tenant, w.retention.category as RetentionCategory);
}
async function loadProposal(storage: R2Bucket, tenant: string, id: string): Promise<EnrichmentProposal> {
  const value = await stored(storage, keyOf(tenant, id, 'proposal'));
  if (value === null) throw new EnrichmentError('Proposal not found', 404);
  try {
    fields(value, ['schema', 'id', 'tenant', 'createdAt', 'createdBy', 'createdWith', 'sample', 'labels', 'provenance', 'digest']);
    requireValue(value.schema === 'content-enrichment-proposal/v1' && value.id === id && value.tenant === tenant
      && timestamp(value.createdAt) && text(value.createdBy, 256) && (value.createdWith === 'access' || value.createdWith === 'service'));
    requireValue(object(value.provenance));
    if (value.provenance.verified === true) validateGenerated(value.provenance, tenant);
    else { fields(value.provenance, ['declared', 'verified']); requireValue(value.provenance.verified === false); }
    captureInput({ sample: value.sample, labels: value.labels, provenance: value.provenance.declared }, true);
    const { digest: hash, ...basis } = value; requireValue(typeof hash === 'string' && HASH.test(hash) && hash === await digest(basis));
    return value as unknown as EnrichmentProposal;
  } catch { throw new EnrichmentError('Stored proposal is corrupt', 503); }
}
export async function readEnrichment(storage: R2Bucket, tenant: string, id: string) {
  const proposal = await loadProposal(storage, tenant, id), value = await stored(storage, keyOf(tenant, id, 'review'));
  let review: EnrichmentReview | null = null;
  if (value !== null) {
    try {
      fields(value, ['schema', 'id', 'tenant', 'proposalDigest', 'reviewedAt', 'reviewedBy', 'reviewerType', 'dispositions', 'digest']);
      requireValue(value.schema === 'content-enrichment-review/v1' && value.id === id && value.tenant === tenant
        && timestamp(value.reviewedAt) && text(value.reviewedBy, 256) && value.reviewerType === 'access');
      reviewInput({ proposalDigest: value.proposalDigest, dispositions: value.dispositions }, proposal);
      const { digest: hash, ...basis } = value; requireValue(typeof hash === 'string' && HASH.test(hash) && hash === await digest(basis));
      review = value as unknown as EnrichmentReview;
    } catch { throw new EnrichmentError('Stored review is corrupt', 503); }
  }
  return { status: review ? 'reviewed' as const : 'pending' as const, published: false as const, proposal, review };
}
export async function reviewEnrichment(storage: R2Bucket, tenant: string, id: string, actor: string, input: unknown,
  authorize?: () => Promise<void>): Promise<EnrichmentReview> {
  const proposal = await loadProposal(storage, tenant, id); safeJson(input);
  const parsed = reviewInput(input, proposal); requireValue(text(actor, 256));
  const basis = { schema: 'content-enrichment-review/v1' as const, id, tenant, ...parsed,
    reviewedAt: new Date().toISOString(), reviewedBy: actor, reviewerType: 'access' as const };
  const review = { ...basis, digest: await digest(basis) };
  await authorize?.();
  await createOnly(storage, keyOf(tenant, id, 'review'), review); return review;
}
export async function exportEnrichment(storage: R2Bucket, tenant: string, id: string) {
  const { proposal, review } = await readEnrichment(storage, tenant, id);
  if (!review) throw new EnrichmentError('Explicit human review required before export', 409);
  const labels = new Map(proposal.labels.map(label => [label.id, label]));
  const pieces = new Map(proposal.sample.pieces.map(piece => [piece.id, piece]));
  const additions = review.dispositions.filter(d => d.action !== 'reject').map(d => {
    const label = labels.get(d.labelId)!;
    return { labelId: label.id, pieceId: label.pieceId, customerContentId: pieces.get(label.pieceId)!.customerContentId,
      dimension: d.action === 'edit' ? d.dimension : label.dimension, value: d.action === 'edit' ? d.value : label.value,
      reviewDigest: review.digest };
  });
  return { schema: 'content-enrichment-tag-additions/v1' as const, published: false as const,
    proposal, review, additions };
}

// One conditional R2 head activates an immutable, coherent set. Pending intent
// never expires or reallocates a revision; the previous committed set still serves.
import type { Env } from '@/types/env';
import { HTTPException } from 'hono/http-exception';
import type { DocumentKind, IndexEntry, Revision, WriteMeta, WriteResult } from './versionedStore';

export const PUBLICATION_MAX_BYTES = 2 * 1024 * 1024;
export const PUBLICATION_CACHE_MS = 30_000;
const LIMIT = 50, MEMBERS = 16, CACHE_ENTRIES = 32, CACHE_BYTES = 8 * 1024 * 1024;
const encoder = new TextEncoder(), HASH = /^[0-9a-f]{64}$/;
const OPERATION = /^(0|[1-9][0-9]*):[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const KINDS = new Set(['content', 'slots', 'learn', 'reflex', 'prior', 'proposals']);
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const integer = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
const text = (v: unknown, max: number): v is string => typeof v === 'string' && v.length > 0 && v.length <= max && v.trim() === v;
export class PublicationError extends Error {
  constructor(message: string, readonly status: 400 | 401 | 403 | 404 | 409 | 413 | 422 | 428 | 503 = 503,
    readonly code = 'publication_unavailable') { super(message); }
}
const unavailable = () => new PublicationError('Configuration publication authority unavailable');
/**
 * A typed owner/consent refusal raised INSIDE a publication storage read or
 * write is that request's own answer, not a failure of the configuration
 * authority. The owner serializer rechecks the grant, the choice and the
 * retention stamp around every binding call, so its refusal arrives here as the
 * rejection of `storage.get`/`storage.put`; rewriting it as `PublicationError`
 * answered 500 on one host where the other answered 401 on the same body. It
 * propagates unchanged; every other failure is still the authority being
 * unavailable.
 *
 * Recognised by its base class and status rather than by importing
 * `SessionAccessError` (`src/identity/sessionCapability.ts:26`, an
 * `HTTPException(401)`): that module reaches the owner serializer and
 * `node:async_hooks`, and this one is bundled for workerd on its own
 * (`src/config/versionedStore.test.ts:410`).
 */
function storageFailure(error: unknown): PublicationError {
  if (error instanceof HTTPException && error.status === 401) throw error;
  return unavailable();
}
const conflict = () => new PublicationError('Publication conflicts with the retained operation or authored revision set', 409, 'publication_conflict');
function required(condition: unknown): asserts condition { if (!condition) throw unavailable(); }
function fields(v: unknown, keys: string[]): asserts v is Record<string, unknown> {
  required(object(v) && keys.length === Object.keys(v).length && keys.every(k => Object.hasOwn(v, k)));
}
function canonical(v: unknown, depth = 0): string {
  if (depth > 32) throw new PublicationError('Configuration JSON nesting exceeds 32 levels', 422, 'invalid_document');
  if (Array.isArray(v)) return '[' + v.map(x => canonical(x, depth + 1)).join(',') + ']';
  if (object(v)) return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canonical(v[k], depth + 1)).join(',') + '}';
  if (v === null || typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))) return JSON.stringify(v);
  throw new PublicationError('Configuration request must be JSON', 422, 'invalid_document');
}
async function digest(value: unknown): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(canonical(value))))).map(n => n.toString(16).padStart(2, '0')).join('');
}
function serialized(value: unknown): string {
  const raw = canonical(value);
  if (encoder.encode(raw).byteLength > PUBLICATION_MAX_BYTES) throw new PublicationError('Publication exceeds 2 MiB', 413, 'document_too_large');
  return raw;
}
function storageOf(env: Env): R2Bucket {
  try { const s = env.STORAGE; required(s && typeof s.get === 'function' && typeof s.put === 'function'); return s; } catch { throw unavailable(); }
}
function scopeValid(scope: string): boolean { return /^(?:tenant:)?[a-z0-9][a-z0-9-]{0,31}$/.test(scope); }
/** Demo brighthour Reflex is owned by coach, not the real brighthour tenant. */
export function publicationScope(kind: { name: string }, scope: string): string {
  if (!KINDS.has(kind.name) || !scopeValid(scope)) throw unavailable();
  return kind.name === 'reflex' && scope === 'brighthour' ? 'coach' : scope.replace(/^tenant:/, '');
}
function member(kind: { name: string }, scope: string): string { publicationScope(kind, scope); return kind.name + ':' + scope; }
const root = (scope: string) => 'config-publication/v2/' + scope;
const headKey = (scope: string) => root(scope) + '/head.json';
const setKey = (scope: string, n: number) => root(scope) + '/set/' + n + '.json';
// Catalog numeric body addresses remain unchanged. Other kinds get the same
// immutable envelope protocol; legacy mutable KV is never an authority fallback.
const revisionKey = (kind: string, scope: string, n: number) => 'config-publication/v1/' + scope + '/' + kind + '/rev/' + n + '.json';
interface Identity { revision: number; digest: string }
interface Operation { operationId: string; expectedRevision: number; requestDigest: string; initialize: boolean }
interface Envelope<T> extends Revision<T> { schema: 'catalog-revision/v1'; kind: string; scope: string; operation: Operation; digest: string }
interface Ref extends Identity { kind: string; scope: string; minRevision: number; index: IndexEntry[] }
interface SetOperation extends Operation { kind: string; scope: string; actor: string; note: string; at: number; base: Identity | null }
export interface PublicationPin { schema: 'configuration-set/v1'; scope: string; revision: number; refs: Record<string, Ref>; operation: SetOperation; digest: string }
interface Pending { set: PublicationPin; documents: Envelope<unknown>[] }
interface Head { schema: 'configuration-head/v1'; scope: string; committed: Identity | null; pending: Pending | null; digest: string }
interface Loaded { head: Head; etag: string }
function identity(v: unknown): v is Identity { return object(v) && Object.keys(v).length === 2 && integer(v.revision) && v.revision > 0 && typeof v.digest === 'string' && HASH.test(v.digest); }
export function publicationPreconditions(meta: WriteMeta, initialization = false): { operationId: string; expectedRevision: number; expectedPublication?: Identity } {
  if (meta.expectedRevision === undefined || meta.operationId === undefined || (!initialization && meta.expectedPublication === undefined)) {
    throw new PublicationError('Authored document and publication-set preconditions plus Idempotency-Key are required', 428, 'precondition_required');
  }
  if (!integer(meta.expectedRevision) || (!initialization && meta.expectedRevision === 0) || typeof meta.operationId !== 'string' || !OPERATION.test(meta.operationId)
    || (!initialization && !identity(meta.expectedPublication))) throw new PublicationError('Invalid publication preconditions', 400, 'invalid_precondition');
  if (Number(meta.operationId.split(':')[0]) !== meta.expectedRevision) throw conflict();
  if (!text(meta.actor, 256) || (meta.note !== undefined && (typeof meta.note !== 'string' || meta.note.length > 500))) throw new PublicationError('Invalid publication attribution', 422, 'invalid_attribution');
  return { operationId: meta.operationId, expectedRevision: meta.expectedRevision, ...(meta.expectedPublication ? { expectedPublication: meta.expectedPublication } : {}) };
}
/** One existing CORS-approved header carries both authored identities. */
export function publicationMeta(headers: Headers, actor: string, note?: string): WriteMeta {
  const match = headers.get('If-Match'), operationId = headers.get('Idempotency-Key');
  if (!match || !operationId) throw new PublicationError('Authored document/set If-Match and Idempotency-Key required', 428, 'precondition_required');
  if (/^"[1-9][0-9]*"$/.test(match)) {
    const meta = { actor, note, operationId, expectedRevision: Number(match.slice(1, -1)) };
    publicationPreconditions(meta, true); return meta; // Committed v1 receipt readback only; never a new write base.
  }
  const parsed = /^"([1-9][0-9]*)\/([1-9][0-9]*)\/([0-9a-f]{64})"$/.exec(match);
  if (!parsed) throw new PublicationError('Invalid authored document/set If-Match', 400, 'invalid_precondition');
  const meta = { actor, note, operationId, expectedRevision: Number(parsed[1]), expectedPublication: { revision: Number(parsed[2]), digest: parsed[3] } };
  publicationPreconditions(meta); return meta;
}
async function readObject(storage: R2Bucket, key: string): Promise<{ value: unknown; etag: string; bytes: number } | null> {
  try {
    const result = await storage.get(key); if (result === null) return null;
    required(result && text(result.etag, 256) && integer(result.size) && result.size > 0 && result.size <= PUBLICATION_MAX_BYTES && result.body);
    const reader = result.body.getReader(), decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false });
    let bytes = 0, raw = '';
    try {
      for (;;) { const part = await reader.read(); if (part.done) break; bytes += part.value.byteLength; required(bytes <= PUBLICATION_MAX_BYTES); raw += decoder.decode(part.value, { stream: true }); }
      raw += decoder.decode(); required(bytes === result.size);
    } catch (error) { void reader.cancel().catch(() => undefined); throw error; } finally { reader.releaseLock(); }
    return { value: JSON.parse(raw), etag: result.etag, bytes };
  } catch (error) { throw storageFailure(error); }
}
async function sealed<T extends object>(value: T): Promise<T & { digest: string }> { return { ...value, digest: await digest(value) }; }
async function validDigest(value: Record<string, unknown>): Promise<void> {
  const { digest: hash, ...basis } = value; required(typeof hash === 'string' && HASH.test(hash) && hash === await digest(basis));
}
function validOperation(v: unknown): asserts v is Record<string, unknown> & Operation {
  fields(v, ['operationId', 'expectedRevision', 'requestDigest', 'initialize']);
  required(typeof v.operationId === 'string' && OPERATION.test(v.operationId) && integer(v.expectedRevision)
    && Number(v.operationId.split(':')[0]) === v.expectedRevision && typeof v.initialize === 'boolean' && typeof v.requestDigest === 'string' && HASH.test(v.requestDigest));
}
async function envelope<T>(value: unknown, kind: DocumentKind<T>, scope: string, expected?: number): Promise<Envelope<T>> {
  try {
    fields(value, ['schema', 'kind', 'scope', 'revision', 'value', 'actor', 'note', 'at', 'operation', 'digest']);
    required(value.schema === 'catalog-revision/v1' && value.kind === kind.name && value.scope === scope && integer(value.revision) && value.revision > 0
      && (expected === undefined || value.revision === expected) && text(value.actor, 256) && typeof value.note === 'string' && value.note.length <= 500 && integer(value.at));
    validOperation(value.operation); required(value.operation.expectedRevision + 1 === value.revision);
    const validated = (kind.validateStored ?? kind.validate)(value.value);
    required(validated.ok); await validDigest(value);
    return value as unknown as Envelope<T>;
  } catch { throw unavailable(); }
}
function validIndex(ref: Ref): void {
  required(Array.isArray(ref.index) && ref.index.length === Math.min(LIMIT, ref.revision - ref.minRevision + 1));
  for (const [i, row] of ref.index.entries()) {
    fields(row, ['revision', 'version', 'actor', 'note', 'at']);
    required(row.revision === ref.revision - i && typeof row.version === 'string' && row.version.length <= 4096
      && text(row.actor, 256) && typeof row.note === 'string' && row.note.length <= 500 && integer(row.at));
  }
}
async function validateSet(value: unknown, scope: string): Promise<PublicationPin> {
  fields(value, ['schema', 'scope', 'revision', 'refs', 'operation', 'digest']);
  required(value.schema === 'configuration-set/v1' && value.scope === scope && integer(value.revision) && value.revision > 0 && object(value.refs));
  const refs = Object.entries(value.refs); required(refs.length > 0 && refs.length <= MEMBERS);
  for (const [key, raw] of refs) {
    fields(raw, ['kind', 'scope', 'revision', 'digest', 'minRevision', 'index']);
    required(typeof raw.kind === 'string' && typeof raw.scope === 'string' && publicationScope({ name: raw.kind }, raw.scope) === scope
      && key === member({ name: raw.kind }, raw.scope) && integer(raw.revision) && integer(raw.minRevision) && raw.minRevision > 0 && raw.revision >= raw.minRevision && typeof raw.digest === 'string' && HASH.test(raw.digest));
    validIndex(raw as unknown as Ref);
  }
  fields(value.operation, ['operationId', 'expectedRevision', 'requestDigest', 'initialize', 'kind', 'scope', 'actor', 'note', 'at', 'base']);
  const op = value.operation, { kind: _k, scope: _s, actor: _a, note: _n, at: _t, base: _b, ...basic } = op;
  void _k; void _s; void _a; void _n; void _t; void _b;
  validOperation(basic);
  required(typeof op.kind === 'string' && typeof op.scope === 'string' && publicationScope({ name: op.kind }, op.scope) === scope
    && text(op.actor, 256) && typeof op.note === 'string' && op.note.length <= 500 && integer(op.at));
  required(op.initialize ? op.base === null && value.revision === 1 : identity(op.base) && op.base.revision + 1 === value.revision);
  required((value.refs[member({ name: op.kind }, op.scope)] as Ref)?.revision === basic.expectedRevision + 1);
  await validDigest(value); return value as unknown as PublicationPin;
}
async function loadHead(storage: R2Bucket, scope: string): Promise<Loaded | null> {
  const found = await readObject(storage, headKey(scope)); if (!found) return null;
  const v = found.value; fields(v, ['schema', 'scope', 'committed', 'pending', 'digest']);
  required(v.schema === 'configuration-head/v1' && v.scope === scope && (v.committed === null || identity(v.committed)));
  if (v.pending !== null) {
    fields(v.pending, ['set', 'documents']); const set = await validateSet(v.pending.set, scope);
    required(Array.isArray(v.pending.documents) && v.pending.documents.length > 0 && v.pending.documents.length <= MEMBERS
      && (v.committed === null ? set.operation.initialize : canonical(set.operation.base) === canonical(v.committed)));
    const seen = new Set<string>();
    for (const raw of v.pending.documents) {
      fields(raw, ['schema', 'kind', 'scope', 'revision', 'value', 'actor', 'note', 'at', 'operation', 'digest']);
      required(typeof raw.kind === 'string' && typeof raw.scope === 'string'); const key = member({ name: raw.kind }, raw.scope), ref = set.refs[key];
      required(ref && !seen.has(key) && ref.revision === raw.revision && ref.digest === raw.digest); seen.add(key); await validDigest(raw);
    }
  } else required(v.committed !== null);
  await validDigest(v);
  const loaded = { head: v as unknown as Head, etag: found.etag };
  if (loaded.head.pending) await validatePending(storage, loaded);
  return loaded;
}
async function kindFor(name: string): Promise<DocumentKind<unknown>> {
  switch (name) {
    case 'content': return (await import('@/content/kinds')).CONTENT_KIND;
    case 'slots': return (await import('@/content/kinds')).SLOTS_KIND;
    case 'learn': return (await import('@/content/kinds')).LEARN_KIND;
    case 'reflex': return (await import('@/reflex/configStore')).REFLEX_KIND;
    case 'prior': return (await import('@/learn/priors')).PRIORS_KIND;
    case 'proposals': return (await import('@/learn/cycle')).PROPOSALS_KIND;
    default: throw unavailable();
  }
}
async function validatePending(storage: R2Bucket, loaded: Loaded): Promise<void> {
  const pending = loaded.head.pending; required(pending);
  const set = pending.set, base = loaded.head.committed ? await retainedSet(storage, set.scope, loaded.head.committed) : null;
  const changed = new Set<string>();
  if (base) required(canonical(Object.keys(base.refs).sort()) === canonical(Object.keys(set.refs).sort()));
  for (const raw of pending.documents) {
    const kind = await kindFor(raw.kind), document = await envelope(raw, kind, raw.scope), key = member(kind, raw.scope), ref = set.refs[key];
    required(ref && !changed.has(key)); changed.add(key);
    required(canonical(rowOf(kind, document)) === canonical(ref.index[0]));
    if (base) {
      const previous = base.refs[key]; required(previous && ref.revision === previous.revision + 1 && ref.minRevision === previous.minRevision
        && canonical(ref.index) === canonical([rowOf(kind, document), ...previous.index].slice(0, LIMIT))
        && document.actor === set.operation.actor && document.note === set.operation.note && document.at === set.operation.at
        && !document.operation.initialize && document.operation.requestDigest === set.operation.requestDigest
        && document.operation.operationId === previous.revision + ':' + set.operation.operationId.split(':')[1]);
      const valid = kind.validate(document.value); required(valid.ok && canonical(valid.value) === canonical(document.value));
    }
  }
  for (const [key, ref] of Object.entries(set.refs)) {
    if (!changed.has(key)) required(base && canonical(base.refs[key]) === canonical(ref));
  }
  required(changed.has(member({ name: set.operation.kind }, set.operation.scope)));
}
async function requiredHead(storage: R2Bucket, scope: string): Promise<Loaded> {
  const found = await loadHead(storage, scope); if (!found) throw new PublicationError('Coherent configuration publication is uninitialized', 503, 'publication_uninitialized'); return found;
}
async function retainedSet(storage: R2Bucket, scope: string, id: Identity): Promise<PublicationPin> {
  const found = await readObject(storage, setKey(scope, id.revision)); required(found);
  const set = await validateSet(found.value, scope); required(set.revision === id.revision && set.digest === id.digest); return set;
}
async function currentSet(storage: R2Bucket, loaded: Loaded): Promise<PublicationPin> {
  if (!loaded.head.committed) throw new PublicationError('Configuration initialization is pending', 503, 'publication_uninitialized');
  return retainedSet(storage, loaded.head.scope, loaded.head.committed);
}
function freeze<T>(v: T): T { if (v && typeof v === 'object') { Object.freeze(v); for (const child of Object.values(v)) freeze(child); } return v; }
interface CacheEntry { storage: R2Bucket; scope: string; at: number; bytes: number; value: PublicationPin; documents: Map<string, Revision<unknown>> }
const cache = new Set<CacheEntry>(); let cacheBytes = 0, cacheEpoch = {};
const fresh = (at: number, now: number) => Number.isFinite(now) && now >= at && now - at < PUBLICATION_CACHE_MS;
function remove(entry: CacheEntry): void { if (cache.delete(entry)) cacheBytes -= entry.bytes; }
export function invalidatePublicationCache(): void { cache.clear(); cacheBytes = 0; cacheEpoch = {}; }
function invalidateScope(storage: R2Bucket, scope: string): void { for (const entry of cache) if (entry.storage === storage && entry.scope === scope) remove(entry); cacheEpoch = {}; }
async function invalidating<T>(storage: R2Bucket, scope: string, run: () => Promise<T>): Promise<T> { invalidateScope(storage, scope); try { return await run(); } finally { invalidateScope(storage, scope); } }
/** One pin is shared by every dependent read in an operation. Administrative
 * callers opt out of the bounded serving cache; it never refreshes on failure. */
export async function pinPublication(env: Env, scope: string, servingCache = false): Promise<PublicationPin> {
  required(/^[a-z0-9][a-z0-9-]{0,31}$/.test(scope)); const storage = storageOf(env), started = Date.now(), epoch = cacheEpoch;
  for (const entry of cache) if (!fresh(entry.at, started)) remove(entry);
  if (servingCache) for (const entry of cache) if (entry.storage === storage && entry.scope === scope) { cache.delete(entry); cache.add(entry); return entry.value; }
  const value = freeze(await currentSet(storage, await requiredHead(storage, scope)));
  const bytes = encoder.encode(serialized(value)).byteLength + 256, now = Date.now();
  if (servingCache && epoch === cacheEpoch && fresh(started, now) && bytes <= CACHE_BYTES) {
    const resident = [...cache].find(e => e.storage === storage && e.scope === scope);
    if (!resident || resident.at <= started && resident.value.revision <= value.revision) {
      if (resident) remove(resident);
      while (cache.size >= CACHE_ENTRIES || cacheBytes + bytes > CACHE_BYTES) remove(cache.values().next().value!);
      cache.add({ storage, scope, at: started, bytes, value, documents: new Map() }); cacheBytes += bytes;
    }
  }
  return value;
}
const identityOf = (set: PublicationPin): Identity => ({ revision: set.revision, digest: set.digest });
function rowOf<T>(kind: DocumentKind<T>, revision: Revision<T>): IndexEntry {
  const version = kind.versionOf?.(revision.value) ?? String(revision.revision);
  if (typeof version !== 'string' || version.length > 4096) throw new PublicationError('Configuration version exceeds 4096 characters', 422, 'invalid_document');
  return { revision: revision.revision, version, actor: revision.actor, note: revision.note, at: revision.at };
}
async function retained<T>(storage: R2Bucket, kind: DocumentKind<T>, scope: string, n: number): Promise<Envelope<T>> {
  const found = await readObject(storage, revisionKey(kind.name, scope, n)); required(found); return envelope(found.value, kind, scope, n);
}
function publicRevision<T>(value: Envelope<T>, set: PublicationPin, kind: DocumentKind<T>): Revision<T> {
  const interpreted = (kind.validateStored ?? kind.validate)(value.value); required(interpreted.ok);
  return freeze({ revision: value.revision, value: interpreted.value, actor: value.actor, note: value.note, at: value.at, publication: identityOf(set) });
}
export async function readPinnedPublication<T>(env: Env, kind: DocumentKind<T>, scope: string, set: PublicationPin): Promise<Revision<T>> {
  required(set.scope === publicationScope(kind, scope)); const key = member(kind, scope), ref = set.refs[key]; required(ref);
  const storage = storageOf(env), epoch = cacheEpoch, now = Date.now();
  for (const entry of cache) if (!fresh(entry.at, now)) remove(entry);
  const resident = [...cache].find(e => e.storage === storage && e.scope === set.scope && e.value.digest === set.digest);
  const hit = resident?.documents.get(key);
  if (hit) return hit as Revision<T>;
  const value = await retained(storage, kind, scope, ref.revision);
  required(value.digest === ref.digest && canonical(rowOf(kind, value)) === canonical(ref.index[0]));
  const result = publicRevision(value, set, kind), charge = encoder.encode(serialized(value)).byteLength + encoder.encode(key).byteLength + 256;
  if (resident && cache.has(resident) && epoch === cacheEpoch && fresh(resident.at, Date.now()) && !resident.documents.has(key)
    && resident.bytes + charge <= CACHE_BYTES) {
    while (cacheBytes + charge > CACHE_BYTES) { const oldest = [...cache].find(entry => entry !== resident); if (!oldest) break; remove(oldest); }
    resident.documents.set(key, result); resident.bytes += charge; cacheBytes += charge;
  }
  return result;
}
export async function readPublication<T>(env: Env, kind: DocumentKind<T>, scope: string, servingCache = false): Promise<Revision<T>> {
  return readPinnedPublication(env, kind, scope, await pinPublication(env, publicationScope(kind, scope), servingCache));
}
export async function committedPublication(env: Env, scope: string, id: Identity): Promise<PublicationPin> {
  if (!identity(id)) throw conflict();
  const storage = storageOf(env), loaded = await requiredHead(storage, scope);
  if (!loaded.head.committed || loaded.head.committed.revision < id.revision) throw conflict();
  return retainedSet(storage, scope, id);
}
export async function publicationHistory<T>(env: Env, kind: DocumentKind<T>, scope: string): Promise<IndexEntry[]> {
  const set = await pinPublication(env, publicationScope(kind, scope)); await readPinnedPublication(env, kind, scope, set); return set.refs[member(kind, scope)].index;
}
export async function publicationVersion<T>(env: Env, kind: DocumentKind<T>, scope: string, n: number): Promise<Revision<T> | null> {
  if (!integer(n) || n < 1) throw new PublicationError('Revision must be a positive safe integer', 400, 'invalid_revision');
  const set = await pinPublication(env, publicationScope(kind, scope)), ref = set.refs[member(kind, scope)]; required(ref);
  if (n < ref.minRevision) throw new PublicationError('History predates the explicitly retained baseline', 409, 'legacy_history_unavailable');
  if (n > ref.revision) return null;
  const value = await retained(storageOf(env), kind, scope, n); if (n === ref.revision) required(value.digest === ref.digest);
  return publicRevision(value, set, kind);
}
async function put(storage: R2Bucket, key: string, body: string, etag?: string): Promise<boolean> {
  try {
    const result = await storage.put(key, body, { onlyIf: etag === undefined ? new Headers({ 'If-None-Match': '*' }) : { etagMatches: etag }, httpMetadata: { contentType: 'application/json' } });
    if (result === null) return false;
    required(result && result.key === key && text(result.etag, 256) && result.size === encoder.encode(body).byteLength); return true;
  } catch (error) { throw storageFailure(error); }
}
async function createExact(storage: R2Bucket, key: string, value: unknown): Promise<void> {
  const body = serialized(value); if (await put(storage, key, body)) return;
  const found = await readObject(storage, key); if (!found || canonical(found.value) !== body) throw conflict();
}
async function finish(storage: R2Bucket, loaded: Loaded, authorize?: () => Promise<void>): Promise<PublicationPin> {
  const pending = loaded.head.pending; required(pending); const set = pending.set;
  for (const document of pending.documents) { await authorize?.(); await createExact(storage, revisionKey(document.kind, document.scope, document.revision), document); }
  await authorize?.();
  await createExact(storage, setKey(set.scope, set.revision), set);
  const next = await sealed({ schema: 'configuration-head/v1' as const, scope: set.scope, committed: identityOf(set), pending: null });
  await authorize?.(); await put(storage, headKey(set.scope), serialized(next), loaded.etag);
  const after = await requiredHead(storage, set.scope); required(after.head.committed);
  if (after.head.committed.revision < set.revision) throw conflict();
  if (after.head.committed.revision === set.revision && after.head.committed.digest !== set.digest) throw conflict();
  return retainedSet(storage, set.scope, identityOf(set));
}
function sameOperation(set: PublicationPin, kind: { name: string }, scope: string, meta: WriteMeta, requestDigest?: string, actor = true): boolean {
  const op = set.operation;
  return op.kind === kind.name && op.scope === scope && op.operationId === meta.operationId && op.expectedRevision === meta.expectedRevision
    && canonical(op.base) === canonical(meta.expectedPublication ?? null) && (!actor || op.actor === meta.actor)
    && (requestDigest === undefined || op.requestDigest === requestDigest);
}
async function operationAt(storage: R2Bucket, loaded: Loaded, kind: { name: string }, scope: string, meta: WriteMeta, actor = true): Promise<PublicationPin | null> {
  const n = meta.expectedPublication!.revision + 1;
  let set: PublicationPin | null = null;
  if (loaded.head.committed && n <= loaded.head.committed.revision) {
    const found = await readObject(storage, setKey(loaded.head.scope, n)); required(found); set = await validateSet(found.value, loaded.head.scope);
  } else if (loaded.head.pending) set = loaded.head.pending.set;
  if (set && !sameOperation(set, kind, scope, meta, undefined, actor)) throw conflict(); return set;
}
export async function assertPublicationBase<T>(env: Env, kind: DocumentKind<T>, scope: string, meta: WriteMeta): Promise<void> {
  await meta.authorize?.();
  publicationPreconditions(meta); const storage = storageOf(env), loaded = await requiredHead(storage, publicationScope(kind, scope));
  if (loaded.head.pending || canonical(loaded.head.committed) !== canonical(meta.expectedPublication)) throw conflict();
  const base = await readPinnedPublication(env, kind, scope, await currentSet(storage, loaded)); if (base.revision !== meta.expectedRevision) throw conflict();
}
export interface PublicationChange<T = unknown> { kind: DocumentKind<T>; scope: string; request: unknown; candidate: (base: T) => unknown | Promise<unknown> }
/** Several related documents are one intent and become visible in one CAS. */
export async function publishSet(env: Env, changes: PublicationChange[], meta: WriteMeta): Promise<WriteResult<unknown>> {
  const preconditions = publicationPreconditions(meta); if (!changes.length || changes.length > MEMBERS) throw new PublicationError('Invalid publication members', 422, 'invalid_document');
  const first = changes[0], scope = publicationScope(first.kind, first.scope), storage = storageOf(env), seen = new Set<string>();
  for (const change of changes) {
    const key = member(change.kind, change.scope); if (publicationScope(change.kind, change.scope) !== scope || seen.has(key)) throw conflict(); seen.add(key);
  }
  return invalidating(storage, scope, async () => {
    const requestDigest = await digest({ ...preconditions, actor: meta.actor, note: meta.note ?? '', changes: changes.map(c => ({ kind: c.kind.name, scope: c.scope, request: c.request })) });
    const loaded = await requiredHead(storage, scope), previous = await operationAt(storage, loaded, first.kind, first.scope, meta);
    if (previous) {
      if (!sameOperation(previous, first.kind, first.scope, meta, requestDigest) || previous.operation.initialize) throw conflict();
      await meta.authorize?.();
      const set = loaded.head.pending?.set.digest === previous.digest ? await finish(storage, loaded, meta.authorize) : previous;
      return { ok: true, revision: await readPinnedPublication(env, first.kind, first.scope, set) };
    }
    if (canonical(loaded.head.committed) !== canonical(meta.expectedPublication) || meta.expectedPublication!.revision === Number.MAX_SAFE_INTEGER) throw conflict();
    const base = await currentSet(storage, loaded), refs = structuredClone(base.refs), documents: Envelope<unknown>[] = [], at = meta.nowMs ?? Date.now();
    if (!integer(at)) throw new PublicationError('Invalid publication time', 422, 'invalid_attribution');
    for (const [i, change] of changes.entries()) {
      const current = await readPinnedPublication(env, change.kind, change.scope, base);
      if (current.revision === Number.MAX_SAFE_INTEGER || i === 0 && current.revision !== meta.expectedRevision) throw conflict();
      const validated = change.kind.validate(await change.candidate(current.value)); if (!validated.ok) return validated;
      const revision = current.revision + 1, value = change.kind.stamp ? change.kind.stamp(validated.value, revision) : validated.value;
      // Secondary members retain their numeric IDs; the set operation is their
      // joint receipt, and no independently writable pointer can expose them.
      const op = { operationId: i === 0 ? meta.operationId! : current.revision + ':' + meta.operationId!.split(':')[1], expectedRevision: current.revision, requestDigest, initialize: false };
      const document = await envelope(await sealed({ schema: 'catalog-revision/v1' as const, kind: change.kind.name, scope: change.scope,
        revision, value, actor: meta.actor, note: meta.note ?? '', at, operation: op }), change.kind, change.scope);
      serialized(document); documents.push(document);
      const key = member(change.kind, change.scope), old = refs[key];
      refs[key] = { ...old, revision, digest: document.digest, index: [rowOf(change.kind, document), ...old.index].slice(0, LIMIT) };
    }
    const set = await sealed({ schema: 'configuration-set/v1' as const, scope, revision: base.revision + 1, refs,
      operation: { operationId: meta.operationId!, expectedRevision: meta.expectedRevision!, requestDigest, initialize: false,
        kind: first.kind.name, scope: first.scope, actor: meta.actor, note: meta.note ?? '', at, base: identityOf(base) } });
    await validateSet(set, scope);
    const next = await sealed({ schema: 'configuration-head/v1' as const, scope, committed: identityOf(base), pending: { set, documents } });
    await meta.authorize?.();
    if (!await put(storage, headKey(scope), serialized(next), loaded.etag)) throw conflict();
    const reservation = await requiredHead(storage, scope); if (reservation.head.pending?.set.digest !== set.digest) throw conflict();
    return { ok: true, revision: await readPinnedPublication(env, first.kind, first.scope, await finish(storage, reservation, meta.authorize)) };
  });
}
export async function publish<T>(env: Env, kind: DocumentKind<T>, scope: string, request: unknown, meta: WriteMeta,
  candidate: (base: T) => unknown | Promise<unknown>): Promise<WriteResult<T>> {
  if (!meta.expectedPublication) {
    const { document, set } = await legacyCommitted(env, kind, scope, meta);
    const requestDigest = await digest({ operationId: meta.operationId, expectedRevision: meta.expectedRevision, actor: meta.actor, note: meta.note ?? '', request });
    if (document.actor !== meta.actor || document.operation.requestDigest !== requestDigest) throw conflict();
    return { ok: true, revision: publicRevision(document, set, kind) };
  }
  return publishSet(env, [{ kind, scope, request, candidate } as PublicationChange], meta) as Promise<WriteResult<T>>;
}
async function legacyCommitted<T>(env: Env, kind: DocumentKind<T>, scope: string, meta: WriteMeta) {
  publicationPreconditions(meta, true);
  if (kind.name !== 'content') throw new PublicationError('Authored publication-set precondition required', 428, 'precondition_required');
  const set = await pinPublication(env, publicationScope(kind, scope)), ref = set.refs[member(kind, scope)], n = meta.expectedRevision! + 1;
  if (!ref || n < ref.minRevision || n > ref.revision) throw new PublicationError('Authored publication-set precondition required', 428, 'precondition_required');
  const document = await retained(storageOf(env), kind, scope, n);
  if (document.operation.initialize || document.operation.operationId !== meta.operationId || document.operation.expectedRevision !== meta.expectedRevision) throw conflict();
  return { document, set };
}
export async function publicationStatus<T>(env: Env, kind: DocumentKind<T>, scope: string, meta?: WriteMeta) {
  if (meta && !meta.expectedPublication) {
    const { document, set } = await legacyCommitted(env, kind, scope, meta);
    return { state: 'committed', legacyReceipt: true, publication: identityOf(set), committedRevision: set.refs[member(kind, scope)].revision,
      minRevision: set.refs[member(kind, scope)].minRevision, operationId: document.operation.operationId, expectedRevision: document.operation.expectedRevision,
      revision: document.revision, actor: document.actor, note: document.note, at: document.at, requestDigest: document.operation.requestDigest };
  }
  if (meta) publicationPreconditions(meta);
  const storage = storageOf(env), loaded = await requiredHead(storage, publicationScope(kind, scope));
  const committed = loaded.head.committed ? await currentSet(storage, loaded) : null;
  const operation = meta ? await operationAt(storage, loaded, kind, scope, meta, false) : loaded.head.pending?.set;
  const ref = committed?.refs[member(kind, scope)];
  return { state: !committed ? 'initializing' : operation ? (committed.revision >= operation.revision ? 'committed' : 'pending') : meta ? 'absent' : 'idle',
    publication: committed ? identityOf(committed) : null, committedRevision: ref?.revision ?? null, minRevision: ref?.minRevision ?? null,
    ...(operation ? { operationId: operation.operation.operationId, expectedRevision: operation.operation.expectedRevision, expectedPublication: operation.operation.base,
      revision: operation.refs[member(kind, scope)]?.revision, actor: operation.operation.actor, note: operation.operation.note, at: operation.operation.at,
      requestDigest: operation.operation.requestDigest, publicationRevision: operation.revision } : {}) };
}
export async function recoverPublication<T>(env: Env, kind: DocumentKind<T>, scope: string, meta: WriteMeta): Promise<WriteResult<T>> {
  if (!meta.expectedPublication) {
    const { document, set } = await legacyCommitted(env, kind, scope, meta);
    return { ok: true, revision: publicRevision(document, set, kind) };
  }
  publicationPreconditions(meta); const storage = storageOf(env), owner = publicationScope(kind, scope);
  return invalidating(storage, owner, async () => {
    const loaded = await requiredHead(storage, owner); if (!loaded.head.committed) throw conflict();
    const operation = await operationAt(storage, loaded, kind, scope, meta, false); if (!operation || operation.operation.initialize) throw conflict();
    await meta.authorize?.();
    const set = loaded.head.pending?.set.digest === operation.digest ? await finish(storage, loaded, meta.authorize) : operation;
    return { ok: true, revision: await readPinnedPublication(env, kind, scope, set) };
  });
}
export interface PublicationBaseline {
  kind: DocumentKind<unknown>; scope: string; revision: Revision<unknown>;
  /** Explicit reviewed historical bytes: read interpretation is not a new write. */
  retainedValue?: true;
  /** Explicit reviewed old catalog head identity; never discovered/adopted implicitly. */
  retainedCatalogHead?: { digest: string };
}
/** Library-only explicit baseline. No KV inference, live route or migration.
 * All required members must be supplied together by the authorized initializer. */
export async function initializePublicationSet(env: Env, baselines: PublicationBaseline[], operationId: string): Promise<PublicationPin> {
  if (!baselines.length || baselines.length > MEMBERS) throw new PublicationError('Invalid baseline set', 422, 'invalid_baseline');
  const first = baselines[0], scope = publicationScope(first.kind, first.scope), meta = { actor: first.revision.actor, note: first.revision.note, expectedRevision: first.revision.revision - 1, operationId };
  publicationPreconditions(meta, true); const storage = storageOf(env);
  return invalidating(storage, scope, async () => {
    const requestDigest = await digest({ baselines: baselines.map(b => ({ kind: b.kind.name, scope: b.scope, revision: b.revision, retainedValue: b.retainedValue === true, retainedCatalogHead: b.retainedCatalogHead ?? null })), operationId });
    const refs: Record<string, Ref> = {}, documents: Envelope<unknown>[] = [];
    for (const b of baselines) {
      const key = member(b.kind, b.scope), raw = b.revision;
      if (publicationScope(b.kind, b.scope) !== scope || refs[key] || !integer(raw.revision) || raw.revision < 1) throw conflict();
      if (b.retainedCatalogHead) {
        if (b.kind.name !== 'content' || !HASH.test(b.retainedCatalogHead.digest)) throw conflict();
        const found = await readObject(storage, 'config-publication/v1/' + b.scope + '/content/head.json'); required(found);
        const old = found.value;
        fields(old, ['schema', 'kind', 'scope', 'committed', 'minRevision', 'index', 'pending', 'digest']);
        required(old.schema === 'catalog-publication/v1' && old.kind === 'content' && old.scope === b.scope && old.pending === null
          && identity(old.committed) && old.committed.revision === raw.revision && integer(old.minRevision) && old.minRevision > 0
          && old.digest === b.retainedCatalogHead.digest); await validDigest(old);
        const document = await retained(storage, b.kind, b.scope, raw.revision);
        required(document.digest === old.committed.digest && canonical({ revision: document.revision, value: document.value,
          actor: document.actor, note: document.note, at: document.at }) === canonical(raw));
        const ref = { kind: b.kind.name, scope: b.scope, revision: raw.revision, digest: document.digest,
          minRevision: old.minRevision, index: old.index as IndexEntry[] }; validIndex(ref);
        required(canonical(rowOf(b.kind, document)) === canonical(ref.index[0]));
        refs[key] = ref; documents.push(document); continue;
      }
      const validated = (b.retainedValue ? b.kind.validateStored ?? b.kind.validate : b.kind.validate)(raw.value);
      if (!validated.ok) throw new PublicationError('Invalid baseline configuration', 422, 'invalid_baseline');
      const document = await envelope(await sealed({ revision: raw.revision, value: b.retainedValue ? raw.value : validated.value, actor: raw.actor, note: raw.note, at: raw.at,
        schema: 'catalog-revision/v1' as const, kind: b.kind.name, scope: b.scope,
        operation: { operationId: (raw.revision - 1) + ':' + operationId.split(':')[1], expectedRevision: raw.revision - 1, requestDigest, initialize: true } }), b.kind, b.scope);
      serialized(document); documents.push(document);
      refs[key] = { kind: b.kind.name, scope: b.scope, revision: raw.revision, digest: document.digest, minRevision: raw.revision, index: [rowOf(b.kind, document)] };
    }
    const set = await sealed({ schema: 'configuration-set/v1' as const, scope, revision: 1, refs,
      operation: { ...meta, requestDigest, initialize: true, kind: first.kind.name, scope: first.scope, note: meta.note ?? '', at: first.revision.at, base: null } });
    await validateSet(set, scope);
    const head = await sealed({ schema: 'configuration-head/v1' as const, scope, committed: null, pending: { set, documents } }); serialized(head);
    let loaded = await loadHead(storage, scope);
    if (!loaded) {
      // Detect occupied immutable addresses before reserving a new initialization.
      for (const document of documents) {
        const prior = await readObject(storage, revisionKey(document.kind, document.scope, document.revision));
        if (prior && canonical(prior.value) !== canonical(document)) throw conflict();
      }
      if (!await put(storage, headKey(scope), serialized(head))) throw conflict(); loaded = await requiredHead(storage, scope);
    }
    if (loaded.head.committed) {
      const existing = await retainedSet(storage, scope, identityOf(set)); if (canonical(existing) !== canonical(set)) throw conflict(); return existing;
    }
    if (loaded.head.pending?.set.digest !== set.digest) throw conflict(); return finish(storage, loaded);
  });
}
export async function initializePublication<T>(env: Env, kind: DocumentKind<T>, scope: string, baseline: Revision<T>, operationId: string): Promise<Revision<T>> {
  const set = await initializePublicationSet(env, [{ kind, scope, revision: baseline } as PublicationBaseline], operationId);
  return readPinnedPublication(env, kind, scope, set);
}

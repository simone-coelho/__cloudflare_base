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
const KINDS = new Set(['content', 'slots', 'learn', 'reflex', 'prior', 'proposals', 'vocabulary', 'vocabulary-approval', 'import-sources', 'layouts']);
/**
 * P38: the members a coherent set may lack and a publication may ADD. A tenant
 * that never published a vocabulary has a set without one, and that set stays
 * exactly as it is (an absent member reads as absent through the optional door);
 * the first publication of such a member creates it at revision 1, against the
 * authored precondition of revision 0, inside the same one-CAS set publication
 * every other member uses. No other member can be created or removed this way.
 */
// P91 (E16): the tenant's import-sources list is optional too: a tenant that publishes none allows every caller.
// P88 (E13): and its approved layouts: a tenant that publishes none keeps every per-context order as before.
const OPTIONAL_MEMBERS = new Set(['vocabulary', 'vocabulary-approval', 'import-sources', 'layouts']);
/**
 * P48 (R-P78, R-P82 (4)): the two members a committed set lacks only because
 * the demo bootstrap created it with four, by kind name, with the name an
 * operator reads each by. They are not optional: a read or a publish of one the
 * set lacks is still refused, in words that name it and the path that adds it.
 * `completePublicationSet` is the one capability that adds them, each as its
 * compiled empty and nothing else.
 */
const COMPLETION_MEMBERS: ReadonlyMap<string, string> = new Map([['prior', 'priors'], ['proposals', 'proposals']]);
/**
 * P54 (R-P78): the path that adds them, per deployment profile. The demo
 * bootstrap's path is not mounted on the customer profile, so a customer
 * deployment names the stamp owner's sibling of the W08 door
 * (src/routes/content.ts), which is. Any other binding, the demo profile and a
 * binding that names no profile, keeps P48's words.
 */
const COMPLETION_PATH = 'POST /ops/demo-bootstrap/complete';
const CUSTOMER_COMPLETION_PATH = 'POST /content/publication/complete';
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const integer = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
const text = (v: unknown, max: number): v is string => typeof v === 'string' && v.length > 0 && v.length <= max && v.trim() === v;
export class PublicationError extends Error {
  constructor(message: string, readonly status: 400 | 401 | 403 | 404 | 409 | 410 | 413 | 422 | 428 | 503 = 503,
    readonly code = 'publication_unavailable') { super(message); }
}
const UNAVAILABLE = 'Configuration publication authority unavailable';
const unavailable = () => new PublicationError(UNAVAILABLE);
/**
 * P48 (R-P78): the refusal for a member the set does not carry. Today's words,
 * status and code for every member, followed, for the two a four-member demo
 * bootstrap left out, by the member's name and the path that adds it on this
 * deployment's profile (P54).
 */
function absent(env: Env, kind: { name: string }): PublicationError {
  const name = COMPLETION_MEMBERS.get(kind.name);
  const path = env.DEPLOYMENT_PROFILE === 'customer' ? CUSTOMER_COMPLETION_PATH : COMPLETION_PATH;
  return name ? new PublicationError(`${UNAVAILABLE}: ${name} is not in this tenant's publication set; add it with ${path}, which adds its compiled empty once and changes no other member`)
    : unavailable();
}
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
/** P91 (R-P330): the digest of a document's value, keys sorted, as the publication computes it: equal values, equal digests. */
export function documentDigest(value: unknown): Promise<string> { return digest(value); }
function serialized(value: unknown): string {
  const raw = canonical(value);
  if (encoder.encode(raw).byteLength > PUBLICATION_MAX_BYTES) throw new PublicationError('Publication exceeds 2 MiB', 413, 'document_too_large');
  return raw;
}
/**
 * W32 E1.01 (F32 §2.4-§2.6, §4 item 8, §6.2): the bytes the ceiling is charged
 * against, as a number anything outside this module may answer.
 *
 * `PUBLICATION_MAX_BYTES` is compared against the CANONICAL serialization — keys
 * sorted, no insignificant whitespace — so the only honest size to show an
 * operator is that same string's UTF-8 length. `JSON.stringify` of the document
 * as it happens to be ordered is a different number, and a merchandiser who
 * budgeted against it would discover the real ceiling as a refusal. It throws
 * exactly where `serialized()` would refuse the document as unpublishable (a
 * value that is not JSON, or nesting past 32 levels); it never refuses a
 * document for its size, because its whole purpose is to report that size.
 */
export function documentBytes(value: unknown): number {
  return encoder.encode(canonical(value)).byteLength;
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
interface Loaded {
  head: Head; etag: string;
  /** The head object's exact stored text (P102: the backfill rewrites a head with its own bytes). */
  text: string;
  /** P102 (B): the revision of each member of the committed set, as the head object's storage metadata names it. A hint, never authority. */
  hint?: Record<string, number>;
  /** P102 (C): the commit found the serving copy of the committed set past its bound and wrote none. */
  copyOmitted?: true;
}
/**
 * P102 (E27, fix B): the head object names its members. Every commit (`finish`)
 * writes, as the committed head object's storage metadata, the revision of each
 * member of the set it commits (`members`, the JSON of `<kind>:<scope>` →
 * revision), and, where the set's serving copy passed its bound and none was
 * written, `serving: none`. The head's JSON, its digest and its field set are
 * untouched, so a reader that does not know the metadata reads the head exactly
 * as before. A serving read on a machine holding nothing then reads the set and
 * the members its caller names in one round; a member read so is kept only
 * where its revision, digest and index row are the set's own ref, so the
 * metadata is a hint and never authority (anything malformed is dropped).
 */
const MEMBERS_META = 'members', SERVING_META = 'serving', HINT_MAX_BYTES = 1792;
const MEMBER_KEY = /^[a-z][a-z-]{0,31}:(?:tenant:)?[a-z0-9][a-z0-9-]{0,31}$/;
function headMetadata(set: PublicationPin, copyOmitted: boolean): Record<string, string> {
  const members = JSON.stringify(Object.fromEntries(Object.keys(set.refs).sort().map(key => [key, set.refs[key]!.revision])));
  return { ...(encoder.encode(members).byteLength <= HINT_MAX_BYTES ? { [MEMBERS_META]: members } : {}), ...(copyOmitted ? { [SERVING_META]: 'none' } : {}) };
}
function hintOf(meta: Record<string, unknown> | undefined): Pick<Loaded, 'hint' | 'copyOmitted'> {
  const omitted = meta?.[SERVING_META] === 'none' ? { copyOmitted: true as const } : {}, raw = meta?.[MEMBERS_META];
  if (typeof raw !== 'string' || encoder.encode(raw).byteLength > HINT_MAX_BYTES) return omitted;
  try {
    const value: unknown = JSON.parse(raw), entries = object(value) ? Object.entries(value) : [];
    if (!entries.length || entries.length > MEMBERS || !entries.every(([key, n]) => MEMBER_KEY.test(key) && integer(n) && n > 0)) return omitted;
    return { hint: Object.fromEntries(entries) as Record<string, number>, ...omitted };
  } catch { return omitted; }
}
/** Whether a hint names exactly the members of a set at their revisions. */
const hintMatches = (hint: Record<string, number> | undefined, set: PublicationPin) => !!hint
  && Object.keys(hint).length === Object.keys(set.refs).length && Object.entries(set.refs).every(([key, ref]) => hint[key] === ref.revision);
function identity(v: unknown): v is Identity { return object(v) && Object.keys(v).length === 2 && integer(v.revision) && v.revision > 0 && typeof v.digest === 'string' && HASH.test(v.digest); }
/**
 * `creation` (P38): the write may create an optional member, so its authored
 * document precondition may be revision 0 — "there is no such document yet" —
 * beside the set precondition every write carries.
 */
export function publicationPreconditions(meta: WriteMeta, initialization = false, creation = false): { operationId: string; expectedRevision: number; expectedPublication?: Identity } {
  if (meta.expectedRevision === undefined || meta.operationId === undefined || (!initialization && meta.expectedPublication === undefined)) {
    throw new PublicationError('Authored document and publication-set preconditions plus Idempotency-Key are required', 428, 'precondition_required');
  }
  if (!integer(meta.expectedRevision) || (!initialization && !creation && meta.expectedRevision === 0) || typeof meta.operationId !== 'string' || !OPERATION.test(meta.operationId)
    || (!initialization && !identity(meta.expectedPublication))) throw new PublicationError('Invalid publication preconditions', 400, 'invalid_precondition');
  if (Number(meta.operationId.split(':')[0]) !== meta.expectedRevision) throw conflict();
  if (!text(meta.actor, 256) || (meta.note !== undefined && (typeof meta.note !== 'string' || meta.note.length > 500))) throw new PublicationError('Invalid publication attribution', 422, 'invalid_attribution');
  return { operationId: meta.operationId, expectedRevision: meta.expectedRevision, ...(meta.expectedPublication ? { expectedPublication: meta.expectedPublication } : {}) };
}
/**
 * One existing CORS-approved header carries both authored identities. With
 * `creation` (P38, a write that may create an optional member), the authored
 * document revision may be 0: the member the operator read was absent.
 */
export function publicationMeta(headers: Headers, actor: string, note?: string, creation = false): WriteMeta {
  const match = headers.get('If-Match'), operationId = headers.get('Idempotency-Key');
  if (!match || !operationId) throw new PublicationError('Authored document/set If-Match and Idempotency-Key required', 428, 'precondition_required');
  if (/^"[1-9][0-9]*"$/.test(match)) {
    const meta = { actor, note, operationId, expectedRevision: Number(match.slice(1, -1)) };
    publicationPreconditions(meta, true); return meta; // Committed v1 receipt readback only; never a new write base.
  }
  const parsed = (creation ? /^"(0|[1-9][0-9]*)\/([1-9][0-9]*)\/([0-9a-f]{64})"$/ : /^"([1-9][0-9]*)\/([1-9][0-9]*)\/([0-9a-f]{64})"$/).exec(match);
  if (!parsed) throw new PublicationError('Invalid authored document/set If-Match', 400, 'invalid_precondition');
  const meta = { actor, note, operationId, expectedRevision: Number(parsed[1]), expectedPublication: { revision: Number(parsed[2]), digest: parsed[3] } };
  publicationPreconditions(meta, false, creation); return meta;
}
/** One stored object as read: its value, its etag, its size, its exact text and (P102) its storage metadata, where it has any. */
interface Found { value: unknown; etag: string; bytes: number; text: string; meta?: Record<string, unknown> }
async function readObject(storage: R2Bucket, key: string, max = PUBLICATION_MAX_BYTES): Promise<Found | null> {
  try {
    const result = await storage.get(key); if (result === null) return null;
    required(result && text(result.etag, 256) && integer(result.size) && result.size > 0 && result.size <= max && result.body);
    const reader = result.body.getReader(), decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false });
    let bytes = 0, raw = '';
    try {
      for (;;) { const part = await reader.read(); if (part.done) break; bytes += part.value.byteLength; required(bytes <= max); raw += decoder.decode(part.value, { stream: true }); }
      raw += decoder.decode(); required(bytes === result.size);
    } catch (error) { void reader.cancel().catch(() => undefined); throw error; } finally { reader.releaseLock(); }
    const meta: unknown = (result as { customMetadata?: unknown }).customMetadata;
    return { value: JSON.parse(raw), etag: result.etag, bytes, text: raw, ...(object(meta) ? { meta } : {}) };
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
/**
 * W21 E1.07 (ruling R130): a DERIVED annotation a document carries, so that a
 * serving read of the head answers it without reading a single earlier revision.
 *
 * The salt version freezes a randomisation, and counting the salts behind a
 * revision needs the revisions behind it. Doing that walk where the shopper
 * waits cost a cold isolate up to 24 extra object reads on her first decision
 * (NR3). It is computed HERE instead, once, on the operator's publish — the
 * request that already knows the history is about to change — and stored beside
 * the document it describes. The customer's own document is never touched: this
 * lives on the envelope, is validated as optional so every document published
 * before it stays readable, and is absent rather than guessed.
 *
 * It names the effective salt it was computed for, so a reader uses it only
 * where that salt is the one in force; anything else is an explicit unknown
 * rather than a number from another experiment.
 */
const DERIVED = 'derived';
const ENVELOPE_FIELDS = ['schema', 'kind', 'scope', 'revision', 'value', 'actor', 'note', 'at', 'operation', 'digest'];
export interface CarriedSalt { salt: string; version: number | null }
const carried = new WeakMap<object, CarriedSalt>();
/** The salt annotation this revision carries, or `null` where it carries none. */
export function carriedSaltVersion(revision: object | null | undefined): CarriedSalt | null {
  return revision && typeof revision === 'object' ? carried.get(revision) ?? null : null;
}
/**
 * The annotation a document about to be published carries. Learn documents only;
 * every other kind carries nothing, and a count that cannot be established is
 * `null` rather than a smaller number (W21 E1.07, NR4). It never throws, so a
 * derived annotation can never refuse a publication.
 *
 * W38 B4, P95 (E20): the count is stored with each revision and carried. Where
 * the revision before this one carries an exact count, this one's is built from
 * it — the same count, or one more where the effective salt changed, which is
 * exactly what a count over the history gives — whatever the revision number,
 * and no earlier revision is read. A purge under the tenant's
 * configuration-revision setting may have removed revisions a count would need;
 * the count they contributed is already in the annotation the previous revision
 * carries. Only where the previous revision carries no exact count (a history
 * published before W21 E1.07, or a count that could not finish) is the count
 * taken over the whole stored history (`saltVersionOf`, src/content/holdout.ts,
 * no read horizon), here on the operator's time and never on a shopper's; and
 * that count finds every revision it reads, because while the current learn
 * revision carries no exact count the purge removes no learn revision
 * (`saltCountCarried`, below). So the purge never turns an exact count into an
 * unknown, and a tenant reading the unknown recovers at its next learn
 * publication wherever its stored history still establishes the count.
 */
async function derivedFor(env: Env, kind: DocumentKind<unknown>, scope: string, revision: number, value: unknown,
  previous?: CarriedSalt | null): Promise<{ derived: CarriedSalt } | Record<string, never>> {
  if (kind.name !== 'learn') return {};
  try {
    const owner = publicationScope(kind, scope);
    const holdout = (value as { holdout?: { salt?: unknown } } | null | undefined)?.holdout;
    // The published salt, or the brand fallback the decision service applies.
    const salt = typeof holdout?.salt === 'string' && holdout.salt.trim() === holdout.salt && holdout.salt ? holdout.salt : owner;
    if (!text(salt, 256)) return {};
    if (revision > 1 && previous && integer(previous.version) && previous.version > 0) {
      return { derived: { salt, version: previous.salt === salt ? previous.version : previous.version + 1 } };
    }
    const { saltVersionOf } = await import('@/content/holdout');
    return { derived: { salt, version: await saltVersionOf(env, owner, revision, owner, salt) } };
  } catch { return {}; }
}
/**
 * A stored revision envelope's own key set. The derived annotation is OPTIONAL
 * in both directions: a document published before it exists carries none and
 * still reads, and one that carries it is validated as strictly as the rest.
 */
function envelopeFields(value: unknown): asserts value is Record<string, unknown> {
  required(object(value));
  fields(value, Object.hasOwn(value, DERIVED) ? [...ENVELOPE_FIELDS, DERIVED] : ENVELOPE_FIELDS);
  if (!Object.hasOwn(value, DERIVED)) return;
  const annotation = value[DERIVED];
  fields(annotation, ['salt', 'version']);
  required(text(annotation.salt, 256) && (annotation.version === null || (integer(annotation.version) && annotation.version > 0)));
}
async function envelope<T>(value: unknown, kind: DocumentKind<T>, scope: string, expected?: number): Promise<Envelope<T>> {
  try {
    envelopeFields(value);
    required(!Object.hasOwn(value, DERIVED) || kind.name === 'learn');
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
      envelopeFields(raw);
      required(typeof raw.kind === 'string' && typeof raw.scope === 'string'); const key = member({ name: raw.kind }, raw.scope), ref = set.refs[key];
      required(ref && !seen.has(key) && ref.revision === raw.revision && ref.digest === raw.digest); seen.add(key); await validDigest(raw);
    }
  } else required(v.committed !== null);
  await validDigest(v);
  // P102 (B): a committed head's storage metadata, as a hint; a pending head's is never read.
  const loaded: Loaded = { head: v as unknown as Head, etag: found.etag, text: found.text, ...(v.pending === null ? hintOf(found.meta) : {}) };
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
    case 'vocabulary': return (await import('@/content/kinds')).VOCABULARY_KIND as unknown as DocumentKind<unknown>;
    case 'vocabulary-approval': return (await import('@/content/kinds')).VOCABULARY_APPROVAL_KIND as unknown as DocumentKind<unknown>;
    case 'import-sources': return (await import('@/content/import')).IMPORT_SOURCES_KIND as unknown as DocumentKind<unknown>;
    case 'layouts': return (await import('@/content/kinds')).LAYOUTS_KIND as unknown as DocumentKind<unknown>;
    default: throw unavailable();
  }
}
/**
 * P48: a completion member's compiled empty (EMPTY_PRIORS, EMPTY_PROPOSALS) as
 * its kind's validator admits it, which is the value the initializer stores.
 */
async function compiledEmpty(kind: DocumentKind<unknown>): Promise<unknown> {
  const value = kind.name === 'prior' ? (await import('@/learn/priors')).EMPTY_PRIORS
    : kind.name === 'proposals' ? (await import('@/learn/cycle')).EMPTY_PROPOSALS : undefined;
  const validated = value === undefined ? null : kind.validate(value);
  if (!validated?.ok) throw unavailable();
  return validated.value;
}
async function validatePending(storage: R2Bucket, loaded: Loaded): Promise<void> {
  const pending = loaded.head.pending; required(pending);
  const set = pending.set, base = loaded.head.committed ? await retainedSet(storage, set.scope, loaded.head.committed) : null;
  const changed = new Set<string>();
  let completed = 0;
  // Every member of the committed set stays in the pending one; a member the
  // pending set adds is an optional member it creates (P38) or a completion
  // member's compiled empty (P48), checked below.
  if (base) required(Object.keys(base.refs).every(key => Object.hasOwn(set.refs, key))
    && Object.keys(set.refs).every(key => Object.hasOwn(base.refs, key) || OPTIONAL_MEMBERS.has((set.refs[key] as Ref).kind)
      || COMPLETION_MEMBERS.has((set.refs[key] as Ref).kind)));
  for (const raw of pending.documents) {
    const kind = await kindFor(raw.kind), document = await envelope(raw, kind, raw.scope), key = member(kind, raw.scope), ref = set.refs[key];
    required(ref && !changed.has(key)); changed.add(key);
    required(canonical(rowOf(kind, document)) === canonical(ref.index[0]));
    if (base) {
      const previous: Ref | undefined = Object.hasOwn(base.refs, key) ? base.refs[key] : undefined;
      // P38: a created member starts at revision 1 over no previous one.
      // P48: so does an added completion member, as its compiled empty alone.
      const completion = !previous && COMPLETION_MEMBERS.has(kind.name);
      required(previous || ((OPTIONAL_MEMBERS.has(kind.name) || completion) && ref.revision === 1 && ref.minRevision === 1));
      if (completion) { required(canonical(document.value) === canonical(await compiledEmpty(kind))); completed++; }
      const before = previous?.revision ?? 0;
      required(ref.revision === before + 1 && ref.minRevision === (previous?.minRevision ?? 1)
        && canonical(ref.index) === canonical([rowOf(kind, document), ...(previous?.index ?? [])].slice(0, LIMIT))
        && document.actor === set.operation.actor && document.note === set.operation.note && document.at === set.operation.at
        && !document.operation.initialize && document.operation.requestDigest === set.operation.requestDigest
        && document.operation.operationId === before + ':' + set.operation.operationId.split(':')[1]);
      const valid = kind.validate(document.value); required(valid.ok && canonical(valid.value) === canonical(document.value));
    }
  }
  for (const [key, ref] of Object.entries(set.refs)) {
    if (!changed.has(key)) required(base && canonical(base.refs[key]) === canonical(ref));
  }
  required(changed.has(member({ name: set.operation.kind }, set.operation.scope)));
  // P48: a set that adds a completion member changes no other member.
  required(completed === 0 || completed === changed.size);
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
/**
 * W19 LG1 (R74(b)): the serving cache belongs to the BACKING storage binding,
 * not to the wrapper one request happens to hold.
 *
 * The owner fence (`ownerEnvironment`, src/identity/sessionAuthority.ts) hands
 * every owner operation its own guarded proxy of the same R2 binding, and every
 * shopper request on both hosts is an owner operation. Keyed by the object the
 * request held, each shopper request therefore missed the cache it had just
 * filled and read the whole publication from storage again, on every event. The
 * fence names the binding each of its proxies fronts here, and the cache key
 * follows that chain to the binding itself — the same rule the lift cache
 * follows through `ownerBindingIdentity`. This module cannot import the fence:
 * it is bundled for workerd on its own (src/config/versionedStore.test.ts).
 *
 * Only a wrapper the fence names is followed. Any other wrapper — a synthetic
 * monitor's scoped bucket, which admits only its own tenant's keys and only its
 * pinned configuration — stays its own physical context, so nothing it did not
 * read itself is ever served to it, and nothing it read is served to anyone
 * else. The key never widens what a caller may read: the scope and the set
 * digest still select the entry, and a hit serves only a document the same
 * binding already returned for that exact publication.
 */
const storageOrigins = new WeakMap<object, object>();
export function nameServingStorage(wrapper: object, origin: object): void {
  // A wrapper is named once, for the binding it was built over; it never moves.
  if (wrapper !== origin && !storageOrigins.has(wrapper)) storageOrigins.set(wrapper, origin);
}
function storageIdentity(storage: R2Bucket): object {
  let current: object = storage;
  for (let hops = 0; hops < 8 && storageOrigins.has(current); hops++) current = storageOrigins.get(current)!;
  return current;
}
/**
 * One resident publication set. `handle` is the storage object the read that
 * filled it held; `binding` is the backing binding that handle fronts
 * (`storageIdentity`). The identical handle is answered from its own entry with
 * no storage read; any other handle of the same binding validates the head and
 * may reuse the set and documents of an entry of that binding only.
 */
interface CacheEntry { handle: object; binding: object; scope: string; at: number; bytes: number; value: PublicationPin; documents: Map<string, Revision<unknown>> }
const cache = new Set<CacheEntry>(); let cacheBytes = 0, cacheEpoch = {};
const fresh = (at: number, now: number) => Number.isFinite(now) && now >= at && now - at < PUBLICATION_CACHE_MS;
function remove(entry: CacheEntry): void { if (cache.delete(entry)) cacheBytes -= entry.bytes; }
/**
 * P102 (E27, fix A): a publication's set and the documents read under it, held
 * by that publication's identity for as long as memory allows.
 *
 * A committed set and its members never change once published: the identity is
 * the digest of the sealed set, and every document was validated against the
 * set's own ref when it was first read. So what a serving read reads is held per
 * isolate, backing binding (`storageIdentity`) and identity (the scope, the set's
 * revision and digest) with no lifetime, bounded in bytes and in entries, the
 * least recently used leaving first. A serving pin by a new handle still reads
 * and validates the head every time (Lane E4) and takes what is held only for the
 * committed identity that head names, so a publication committed anywhere is
 * served on the very next read, and nothing held ever answers when the head
 * cannot be read. `invalidatePublicationCache` and the writers' invalidation
 * clear it; an administrative pin never takes from it and never adds to it.
 *
 * `lent` ties each set object a serving pin returned to its held record, so the
 * member reads of the operation holding that object find what its pin read even
 * where the record has since left `held` (a bound, or a writer's invalidation
 * meanwhile): an operation reads each document of its one pinned set once.
 */
interface Held { key: string; binding: object; value: PublicationPin; documents: Map<string, Revision<unknown>>; setBytes: number; bytes: number }
const HELD_BYTES = 8 * 1024 * 1024, HELD_ENTRIES = 64;
const held = new Map<string, Held>(); let heldBytes = 0;
const lent = new WeakMap<PublicationPin, Held>();
const bindingIds = new WeakMap<object, number>(); let bindingCount = 0;
function heldKey(binding: object, scope: string, id: Identity): string {
  let n = bindingIds.get(binding); if (n === undefined) bindingIds.set(binding, n = ++bindingCount);
  return n + '\u0000' + scope + '\u0000' + id.revision + '\u0000' + id.digest;
}
function release(record: Held): void { if (held.get(record.key) === record) { held.delete(record.key); heldBytes -= record.bytes; } }
/** The record held for a committed identity of this binding, made the most recently used. */
function heldFor(binding: object, scope: string, id: Identity): Held | undefined {
  const record = held.get(heldKey(binding, scope, id));
  if (record) { held.delete(record.key); held.set(record.key, record); }
  return record;
}
/** Whether this isolate holds anything of a scope under a binding: a fresh serving entry or a held identity. */
function holdsAny(binding: object, scope: string): boolean {
  for (const entry of cache) if (entry.binding === binding && entry.scope === scope) return true;
  for (const record of held.values()) if (record.binding === binding && record.value.scope === scope) return true;
  return false;
}
/** The record a serving pin's set object is lent under, made where it has none. */
function lend(binding: object, value: PublicationPin): Held {
  const found = lent.get(value); if (found) return found;
  const setBytes = encoder.encode(serialized(value)).byteLength + 256;
  const record: Held = { key: heldKey(binding, value.scope, identityOf(value)), binding, value, documents: new Map(), setBytes, bytes: setBytes };
  lent.set(value, record); return record;
}
/** Make room for `bytes` more in `held`, the least recently used other records leaving first. */
function room(bytes: number, keep: Held): boolean {
  while (heldBytes + bytes > HELD_BYTES || held.size > HELD_ENTRIES) {
    const oldest = [...held.values()].find(record => record !== keep); if (!oldest) break; release(oldest);
  }
  return heldBytes + bytes <= HELD_BYTES;
}
/** Hold a record (most recently used), unless a writer's invalidation came after the read that made it. */
function keep(record: Held, epoch: object): void {
  if (epoch !== cacheEpoch) return;
  if (held.get(record.key) === record) { held.delete(record.key); held.set(record.key, record); return; }
  const other = held.get(record.key); if (other) release(other);
  if (record.bytes > HELD_BYTES) return;
  held.set(record.key, record); heldBytes += record.bytes;
  if (!room(0, record)) release(record);
}
/** A document validated under a lent set, added to its record and, where the record is held, charged to the bound. */
function attach(record: Held, key: string, document: Revision<unknown>, charge: number): void {
  if (record.documents.has(key)) return;
  record.documents.set(key, document); record.bytes += charge;
  if (held.get(record.key) !== record) return;
  heldBytes += charge;
  if (!room(0, record)) release(record);
}
export function invalidatePublicationCache(): void {
  cache.clear(); cacheBytes = 0; cacheEpoch = {}; partCache.clear(); partCacheBytes = 0; shardCache.clear(); shardCacheBytes = 0; held.clear(); heldBytes = 0;
}
function invalidateScope(storage: R2Bucket, scope: string): void {
  const binding = storageIdentity(storage);
  for (const entry of cache) if (entry.binding === binding && entry.scope === scope) remove(entry);
  for (const record of [...held.values()]) if (record.binding === binding && record.value.scope === scope) release(record);
  cacheEpoch = {};
}
async function invalidating<T>(storage: R2Bucket, scope: string, run: () => Promise<T>): Promise<T> { invalidateScope(storage, scope); try { return await run(); } finally { invalidateScope(storage, scope); } }
/** One pin is shared by every dependent read in an operation. Administrative
 * callers opt out of the bounded serving cache; it never refreshes on failure.
 *
 * Lane E4: a serving read whose storage handle has no resident entry still reads
 * and validates the head, every time, so a publication committed anywhere is
 * honoured on the very next read. When the head's committed identity (revision and
 * digest) is one this isolate already holds a set for under the SAME backing
 * binding (W19 LG1, `storageIdentity`), that set and the documents already read
 * under it are used instead of reading them again: the identity is
 * the digest of the sealed set, and the set and its documents are immutable and
 * were validated against it when first read. This is what lets a shopper's owner
 * operations share the cache, because every operation fences its bindings behind
 * a handle of its own (`ownerEnvironment`): without it, each action read the head,
 * the set and every document again. Nothing else changes: a head that cannot be
 * read or does not validate refuses as before, and a new identity reads the set.
 * A read by the identical handle that filled an entry is answered from it with
 * no storage read until the entry expires, as before; a wrapper the fence does
 * not name is its own binding and reuses nothing another binding read.
 *
 * P102 (E27): past that, a serving read takes the set and documents held by the
 * committed identity (fix A, `held`); a serving read that names the members it
 * reads next (`serving.members`) reads, on a machine holding nothing of the
 * scope under this binding, the head and the scope's serving copy together and
 * uses the copy only where it is the head's committed identity and every member
 * matches its ref (fix C), else the set and the named members in one round by
 * the head's member metadata (fix B), and reads by the set's refs any named
 * member still missing, so the operation's member reads are answered from what
 * its pin read. Every storage trip it waits on is reported in `serving.trips`.
 * An administrative pin names nothing and reads as before. */
export async function pinPublication(env: Env, scope: string, servingCache = false, serving: ServingRead = {}): Promise<PublicationPin> {
  required(/^[a-z0-9][a-z0-9-]{0,31}$/.test(scope)); const storage = storageOf(env), binding = storageIdentity(storage), started = Date.now(), epoch = cacheEpoch;
  for (const entry of cache) if (!fresh(entry.at, started)) remove(entry);
  const named = servingCache ? await namedMembers(scope, serving.members) : [], trips = servingCache ? serving.trips : undefined;
  // The identical handle: its own entry answers with no storage read, so one
  // operation reads the head once however many members it reads, and a read
  // the same handle already made serves through an authority outage until expiry.
  if (servingCache) for (const entry of cache) if (entry.handle === storage && entry.scope === scope) {
    cache.delete(entry); cache.add(entry);
    await readMissing(storage, binding, entry.value, named, entry.documents, new Map(), trips);
    return entry.value;
  }
  // P102 (C): a pin naming its members on a machine holding nothing of this scope and binding reads the copy beside the head.
  const bare = named.length > 0 && !holdsAny(binding, scope), headStarted = performance.now();
  const [loaded, copy] = await Promise.all([requiredHead(storage, scope), bare ? servingCopyRead(storage, scope) : null]);
  trips?.push({ read: bare ? ['head', 'serving copy'] : ['head'], ms: since(headStarted) });
  const committed = loaded.head.committed;
  // Any other handle has read and validated the head above. The most recently
  // used entry of the SAME backing binding for exactly this committed identity
  // lends its set and the documents read under it (each operation starts from
  // what the one before it held and adds what it reads, so the newest holds the
  // most); nothing another binding read is ever served (W19 LG1).
  let known: CacheEntry | undefined;
  if (servingCache && committed) for (const e of cache) if (e.binding === binding && e.scope === scope && e.value.revision === committed.revision && e.value.digest === committed.digest) known = e;
  // P102 (A): no fresh entry holds the identity: what is held by the identity, if anything.
  const kept = servingCache && committed && !known ? heldFor(binding, scope, committed) : undefined;
  // P102 (C): nothing held: the serving copy, where it is exactly the committed identity.
  const copied = servingCache && committed && !known && !kept && copy ? await fromServingCopy(copy.value, scope, committed) : null;
  const read = new Map<string, [Revision<unknown>, number]>();
  let value: PublicationPin;
  if (known) value = known.value;
  else if (kept) value = kept.value;
  else if (copied) { value = copied.set; for (const [key, entry] of copied.documents) read.set(key, entry); }
  else {
    // P102 (B): the set and, by the head's member metadata, the named members in one round; each kept only where it is the set's ref.
    const hinted = loaded.hint ? named.filter(m => integer(loaded.hint![m.key])) : [], setStarted = performance.now();
    const [set, early] = await Promise.all([currentSet(storage, loaded),
      Promise.all(hinted.map(m => retained(storage, m.kind, m.scope, loaded.hint![m.key]!).then(document => ({ m, document }), () => null)))]);
    trips?.push({ read: ['set', ...hinted.map(m => m.kind.name)], ms: since(setStarted) });
    value = freeze(set);
    for (const found of early) {
      const ref = found && value.refs[found.m.key];
      if (found && ref && found.document.revision === ref.revision && matchesRef(found.m.kind, found.document, ref)) read.set(found.m.key, served(found.m.kind, found.m.key, found.document, value));
    }
  }
  const record = servingCache ? lend(binding, value) : undefined;
  if (record) for (const [key, [document, charge]] of read) attach(record, key, document, charge);
  await readMissing(storage, binding, value, named, known?.documents, read, trips);
  if (record) keep(record, epoch);
  const bytes = known ? known.bytes : record ? record.setBytes : encoder.encode(serialized(value)).byteLength + 256, now = Date.now();
  if (servingCache && epoch === cacheEpoch && fresh(started, now) && bytes <= CACHE_BYTES) {
    const resident = [...cache].find(e => e.handle === storage && e.scope === scope);
    if (!resident || resident.at <= started && resident.value.revision <= value.revision) {
      if (resident) remove(resident);
      while (cache.size >= CACHE_ENTRIES || cacheBytes + bytes > CACHE_BYTES) remove(cache.values().next().value!);
      cache.add({ handle: storage, binding, scope, at: started, bytes, value, documents: new Map(known?.documents) }); cacheBytes += bytes;
    }
  }
  return value;
}
/** P102 (B): a member a serving read names, so that a pin on a machine holding nothing reads it in the same round. */
export interface PinMember { kind: { name: string }; scope: string }
/** P102 (CR4): one storage trip a serving read waited on: what it read, and its time in whole milliseconds. */
export interface StorageTrip { read: string[]; ms: number }
/** P102: what a serving pin is told: the members its operation reads under it next, and where to report its storage trips. */
export interface ServingRead { members?: readonly PinMember[]; trips?: StorageTrip[] }
interface Named { key: string; kind: DocumentKind<unknown>; scope: string }
const since = (start: number) => Math.round(performance.now() - start);
/** The named members of a scope, each once, with its kind; a name that is not a member of the scope is left to its own read. */
async function namedMembers(scope: string, members: readonly PinMember[] | undefined): Promise<Named[]> {
  const out: Named[] = [];
  for (const m of members ?? []) {
    try {
      if (publicationScope(m.kind, m.scope) !== scope) continue;
      const key = member(m.kind, m.scope);
      if (!out.some(n => n.key === key)) out.push({ key, kind: await kindFor(m.kind.name), scope: m.scope });
    } catch { /* not a publication member: its own read answers for it */ }
  }
  return out;
}
/** Whether a stored envelope is exactly a set's ref: its digest and its index row (`readPinnedPublication`'s check). */
function matchesRef(kind: DocumentKind<unknown>, document: Envelope<unknown>, ref: Ref): boolean {
  return document.digest === ref.digest && canonical(rowOf(kind, document)) === canonical(ref.index[0]);
}
/** A validated envelope as the revision a reader is answered, and what holding it is charged. */
function served(kind: DocumentKind<unknown>, key: string, document: Envelope<unknown>, set: PublicationPin): [Revision<unknown>, number] {
  return [publicRevision(document, set, kind), encoder.encode(serialized(document)).byteLength + encoder.encode(key).byteLength + 256];
}
/**
 * P102: the named members that neither the pin nor what is held for its set has
 * yet read, read by the set's own refs in one round (a member the set does not
 * list is left to its own read, which refuses it as before), each validated as
 * `readPinnedPublication` validates it and lent under the set; a read that fails
 * refuses the pin exactly as that member's own read would have refused.
 */
async function readMissing(storage: R2Bucket, binding: object, value: PublicationPin, named: readonly Named[], resident: Map<string, Revision<unknown>> | undefined,
  read: Map<string, [Revision<unknown>, number]>, trips: StorageTrip[] | undefined): Promise<void> {
  if (!named.length) return;
  const record = lend(binding, value);
  const missing = named.filter(m => Object.hasOwn(value.refs, m.key) && !resident?.has(m.key) && !record.documents.has(m.key) && !read.has(m.key));
  if (!missing.length) return;
  const started = performance.now();
  const documents = await Promise.all(missing.map(async m => {
    const ref = value.refs[m.key]!, document = await retained(storage, m.kind, m.scope, ref.revision); required(matchesRef(m.kind, document, ref));
    return [m.key, served(m.kind, m.key, document, value)] as const;
  }));
  trips?.push({ read: missing.map(m => m.kind.name), ms: since(started) });
  for (const [key, [document, charge]] of documents) attach(record, key, document, charge);
}
/**
 * P102 (E27, fix C): the serving copy. Every commit writes one object per scope,
 * `config-publication/v2/<scope>/serving.json`, holding the committed set and
 * every member's stored envelope, exactly as the revision objects hold them,
 * where its canonical bytes are at most 1 MiB (above that none is written and
 * the head's metadata says so). A machine holding nothing of the scope reads it
 * beside the head, so a brand-new machine reaches the content in one storage
 * trip. It is a copy and never authority: it is used only where its set is the
 * head's committed identity (revision and digest, the set's own seal checked)
 * and every member it holds is exactly the set's ref, its envelope validated
 * and its bytes' digest recomputed as the revision object's are. A copy that is
 * stale, altered in any member, malformed, over its bound or missing is not
 * used, and the read takes the set and its members (fix B) as without it.
 */
export const SERVING_COPY_MAX_BYTES = 1024 * 1024;
const SERVING_SCHEMA = 'configuration-serving/v1';
const servingKey = (scope: string) => root(scope) + '/serving.json';
/** The scope's serving copy as read, or null where it is absent or cannot be read; a typed owner refusal stays the request's answer. */
function servingCopyRead(storage: R2Bucket, scope: string): Promise<Found | null> {
  return readObject(storage, servingKey(scope), SERVING_COPY_MAX_BYTES).catch((error: unknown) => { if (error instanceof PublicationError) return null; throw error; });
}
/** The copy's set and every member as served, where the copy is exactly the committed identity; otherwise null. */
async function fromServingCopy(raw: unknown, scope: string, committed: Identity): Promise<{ set: PublicationPin; documents: Map<string, [Revision<unknown>, number]> } | null> {
  try {
    fields(raw, ['schema', 'scope', 'set', 'documents']);
    required(raw.schema === SERVING_SCHEMA && raw.scope === scope && object(raw.set) && object(raw.documents)
      && raw.set.revision === committed.revision && raw.set.digest === committed.digest);
    const set = freeze(await validateSet(raw.set, scope)), stored = raw.documents, documents = new Map<string, [Revision<unknown>, number]>();
    required(set.revision === committed.revision && set.digest === committed.digest && Object.keys(stored).length === Object.keys(set.refs).length);
    for (const [key, ref] of Object.entries(set.refs)) {
      required(Object.hasOwn(stored, key));
      const kind = await kindFor(ref.kind), document = await envelope(stored[key], kind, ref.scope, ref.revision);
      required(matchesRef(kind, document, ref));
      documents.set(key, served(kind, key, document, set));
    }
    return { set, documents };
  } catch { return null; }
}
/**
 * The canonical text of a set's serving copy: the envelopes of the members a
 * commit wrote, and every other member read from its revision object and checked
 * against its ref. `null` text and not `omitted` where a member cannot be read
 * now (nothing is written, and a later run tries again); `omitted` where the
 * copy cannot hold this set at all: past its 1 MiB bound, or past the
 * publication's JSON nesting limit once its members sit inside it.
 */
async function servingCopyOf(storage: R2Bucket, set: PublicationPin, written: readonly Envelope<unknown>[]): Promise<{ text: string | null; omitted: boolean }> {
  let documents: Record<string, Envelope<unknown>>;
  try {
    const own = new Map(written.map(document => [member({ name: document.kind }, document.scope), document] as const));
    documents = Object.fromEntries(await Promise.all(Object.entries(set.refs).map(async ([key, ref]) => {
      const kind = await kindFor(ref.kind), document = own.get(key) ?? await retained(storage, kind, ref.scope, ref.revision);
      required(document.revision === ref.revision && matchesRef(kind, document, ref));
      return [key, document] as const;
    })));
  } catch (error) {
    if (error instanceof HTTPException && error.status === 401) throw error;
    return { text: null, omitted: false };
  }
  try {
    const copy = canonical({ schema: SERVING_SCHEMA, scope: set.scope, set, documents });
    return encoder.encode(copy).byteLength <= SERVING_COPY_MAX_BYTES ? { text: copy, omitted: false } : { text: null, omitted: true };
  } catch { return { text: null, omitted: true }; }
}
/** Write the serving copy (create-only for the backfill); a failure writes nothing and never fails the caller, but an owner's refusal does. */
async function writeServingCopy(storage: R2Bucket, scope: string, copy: string, createOnly: boolean): Promise<boolean> {
  try {
    return await storage.put(servingKey(scope), copy, { ...(createOnly ? { onlyIf: new Headers({ 'If-None-Match': '*' }) } : {}), httpMetadata: { contentType: 'application/json' } }) !== null;
  } catch (error) {
    if (error instanceof HTTPException && error.status === 401) throw error;
    return false;
  }
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
  const result = freeze({ revision: value.revision, value: interpreted.value, actor: value.actor, note: value.note, at: value.at, publication: identityOf(set) });
  // W21 E1.07 (R130): the derived annotation travels with the revision object a
  // reader already holds, so the head read carries it and nothing is serialized
  // into the delivery contract that was not already there.
  const annotation = (value as unknown as Record<string, unknown>)[DERIVED];
  if (annotation && typeof annotation === 'object') carried.set(result, annotation as CarriedSalt);
  return result;
}
export async function readPinnedPublication<T>(env: Env, kind: DocumentKind<T>, scope: string, set: PublicationPin): Promise<Revision<T>> {
  required(set.scope === publicationScope(kind, scope)); const key = member(kind, scope), ref = set.refs[key]; if (!ref) throw absent(env, kind);
  const storage = storageOf(env), binding = storageIdentity(storage), epoch = cacheEpoch, now = Date.now();
  for (const entry of cache) if (!fresh(entry.at, now)) remove(entry);
  const matching = [...cache].filter(e => e.binding === binding && e.scope === set.scope && e.value.digest === set.digest);
  const resident = matching.find(e => e.handle === storage) ?? matching[matching.length - 1];
  const hit = resident?.documents.get(key);
  if (hit) return hit as Revision<T>;
  // P102 (A): a set a serving pin returned answers with what was read under it, held by its identity; an
  // administrative pin's set is never lent, so its reads take nothing held.
  const record = lent.get(set), kept = record?.documents.get(key);
  if (kept) return kept as Revision<T>;
  const value = await retained(storage, kind, scope, ref.revision);
  required(value.digest === ref.digest && canonical(rowOf(kind, value)) === canonical(ref.index[0]));
  const result = publicRevision(value, set, kind), charge = encoder.encode(serialized(value)).byteLength + encoder.encode(key).byteLength + 256;
  if (resident && cache.has(resident) && epoch === cacheEpoch && fresh(resident.at, Date.now()) && !resident.documents.has(key)
    && resident.bytes + charge <= CACHE_BYTES) {
    while (cacheBytes + charge > CACHE_BYTES) { const oldest = [...cache].find(entry => entry !== resident); if (!oldest) break; remove(oldest); }
    resident.documents.set(key, result); resident.bytes += charge; cacheBytes += charge;
  }
  if (record) attach(record, key, result as Revision<unknown>, charge);
  return result;
}
/**
 * One member of a pinned set, or `null` where the set itself says the member
 * does not exist (lane E2).
 *
 * Absence and unreadability are kept apart, as `publishedProposals` keeps them
 * for the proposals list (`src/routes/decisions.ts`). The set was read and its
 * digest checked like every other pin, so a missing member is the sealed set's
 * own statement and never a guess: a set cannot lose a member without failing
 * its digest. Everything else refuses exactly as `readPinnedPublication` does: a
 * set of another scope, and a member the set DOES list whose document cannot be
 * read or does not match its ref.
 *
 * For a member a tenant may legitimately never publish, such as imported priors:
 * the demo bootstrap creates a set of reflex, catalog, slots and learn, and no
 * prior. A member every reader needs is read with `readPinnedPublication`, where
 * absence is still an authority failure.
 */
export async function readOptionalPinnedPublication<T>(env: Env, kind: DocumentKind<T>, scope: string, set: PublicationPin): Promise<Revision<T> | null> {
  required(set.scope === publicationScope(kind, scope) && object(set.refs));
  if (!Object.hasOwn(set.refs, member(kind, scope))) return null;
  return readPinnedPublication(env, kind, scope, set);
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
/**
 * Revision `n` of one member, or `null` past the member's committed revision.
 * `pinned`, where given, is the committed set to read it against (P95: the salt
 * count reads a whole history under one set, not one head read per revision);
 * otherwise the head is pinned for this read alone.
 */
export async function publicationVersion<T>(env: Env, kind: DocumentKind<T>, scope: string, n: number, pinned?: PublicationPin): Promise<Revision<T> | null> {
  if (!integer(n) || n < 1) throw new PublicationError('Revision must be a positive safe integer', 400, 'invalid_revision');
  const set = pinned ?? await pinPublication(env, publicationScope(kind, scope));
  required(set.scope === publicationScope(kind, scope));
  const ref = set.refs[member(kind, scope)]; if (!ref) throw absent(env, kind);
  if (n < ref.minRevision) throw new PublicationError('History predates the explicitly retained baseline', 409, 'legacy_history_unavailable');
  if (n > ref.revision) return null;
  const found = await readObject(storageOf(env), revisionKey(kind.name, scope, n));
  // W38 B4: a historical body absent under a tenant that sets the
  // configuration-revision retention setting is one that setting purged, and is
  // answered by name. Absent anywhere else, it is the store failing, as before.
  if (!found && n < ref.revision && await purgesConfiguration(env, set.scope)) {
    throw new PublicationError('Revision was purged under the tenant configuration-revision retention setting', 410, 'revision_purged');
  }
  required(found);
  const value = await envelope(found.value, kind, scope, n); if (n === ref.revision) required(value.digest === ref.digest);
  return publicRevision(value, set, kind);
}
async function put(storage: R2Bucket, key: string, body: string, etag?: string, customMetadata?: Record<string, string>): Promise<boolean> {
  try {
    const result = await storage.put(key, body, { onlyIf: etag === undefined ? new Headers({ 'If-None-Match': '*' }) : { etagMatches: etag }, httpMetadata: { contentType: 'application/json' },
      ...(customMetadata ? { customMetadata } : {}) });
    if (result === null) return false;
    required(result && result.key === key && text(result.etag, 256) && result.size === encoder.encode(body).byteLength); return true;
  } catch (error) { throw storageFailure(error); }
}
async function createExact(storage: R2Bucket, key: string, value: unknown): Promise<void> {
  const body = serialized(value); if (await put(storage, key, body)) return;
  const found = await readObject(storage, key); if (!found || canonical(found.value) !== body) throw conflict();
}

// ── P86 (E10, design A, R-P405): the catalogue's per-product parts ─────────────
//
// A catalogue whose value is a manifest (`products`, src/content/types.ts) keeps
// each product's records in one immutable, content-addressed part object beside
// the revision bodies: its key names the digest of its canonical value, so the
// manifest's pointer, the key and the bytes are one fact. A part is written
// with the store's exact-create by the catalogue's door BEFORE the publication
// reserves the head (the candidate step of `publishSet`), never inside `finish`,
// so a load whose part cannot be written commits nothing and leaves nothing
// pending; a retry writes the same key. A part is at most 2 MiB, as a revision
// body is, and it is kept while any stored revision's manifest names it
// (`purgeByPolicy` removes the parts only purged revisions named).

const partKey = (scope: string, digest: string) => 'config-publication/v1/' + scope + '/content/part/' + digest + '.json';
const idIndexKey = (scope: string, digest: string) => 'config-publication/v1/' + scope + '/content/ids/' + digest + '.json';
/** P86: one product's part, `{ product, pieces }`, as it is stored. */
export interface CatalogPart { product: string; pieces: unknown[] }
function validPart(value: unknown): value is CatalogPart {
  return !!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 2
    && typeof (value as CatalogPart).product === 'string' && Array.isArray((value as CatalogPart).pieces);
}
/**
 * P86: the parts read on this isolate, by backing binding, scope and digest. A
 * part is immutable, so an entry never goes stale; the cache is bounded by the
 * canonical bytes it holds (8 MiB, beside the publication cache's own 8 MiB),
 * the oldest leaving first, and `invalidatePublicationCache` clears it.
 */
const PART_CACHE_BYTES = 8 * 1024 * 1024;
const partCache = new Map<string, { binding: object; value: CatalogPart; bytes: number }>(); let partCacheBytes = 0;
function partCacheKey(storage: R2Bucket, scope: string, digest: string): string { void storage; return scope + '\u0000' + digest; }
function rememberPart(storage: R2Bucket, scope: string, digest: string, value: CatalogPart, bytes: number): void {
  if (bytes > PART_CACHE_BYTES) return;
  const key = partCacheKey(storage, scope, digest), binding = storageIdentity(storage), held = partCache.get(key);
  if (held) { partCache.delete(key); partCacheBytes -= held.bytes; }
  while (partCacheBytes + bytes > PART_CACHE_BYTES && partCache.size) { const [oldest, entry] = partCache.entries().next().value!; partCache.delete(oldest); partCacheBytes -= entry.bytes; }
  partCache.set(key, { binding, value, bytes }); partCacheBytes += bytes;
}
/**
 * P86: write one product's part with the store's exact-create and answer its
 * digest. Refused 413 `part_too_large` past 2 MiB; a part already stored with
 * the same bytes is the same part (a retry), any other bytes a conflict.
 */
export async function writeCatalogPart(env: Env, scope: string, part: CatalogPart): Promise<string> {
  const storage = storageOf(env), home = publicationScope({ name: 'content' }, scope), value = freeze(structuredClone(part)) as CatalogPart;
  if (encoder.encode(canonical(value)).byteLength > PUBLICATION_MAX_BYTES) {
    throw new PublicationError(`The part of product ${JSON.stringify(part.product).slice(0, 80)} exceeds 2 MiB`, 413, 'part_too_large');
  }
  const hash = await digest(value);
  await createExact(storage, partKey(home, hash), value);
  rememberPart(storage, home, hash, value, encoder.encode(canonical(value)).byteLength);
  return hash;
}
/**
 * P86: one part by its digest: from this isolate's part cache, else one read of
 * its object, whose canonical value must hash to the digest it is named by.
 * A part the store does not hold, or holds otherwise, is refused 503
 * `part_unavailable`, naming the digest.
 */
export async function readCatalogPart(env: Env, scope: string, hash: string, trips?: StorageTrip[]): Promise<CatalogPart> {
  const storage = storageOf(env), home = publicationScope({ name: 'content' }, scope);
  if (!HASH.test(hash)) throw new PublicationError('Invalid catalogue part digest', 503, 'part_unavailable');
  const held = partCache.get(partCacheKey(storage, home, hash));
  if (held && held.binding === storageIdentity(storage)) return held.value;
  // P102 (CR4): a read that goes to storage is a trip of the caller's documents stage.
  const started = performance.now(), found = await readObject(storage, partKey(home, hash));
  trips?.push({ read: ['part'], ms: since(started) });
  if (!found || !validPart(found.value) || await digest(found.value) !== hash) throw new PublicationError(`Catalogue part ${hash} unavailable`, 503, 'part_unavailable');
  const value = freeze(found.value) as CatalogPart;
  rememberPart(storage, home, hash, value, found.bytes);
  return value;
}
/** P86: whether the store holds a part, by one HEAD of its object (a rollback's check of every pointer). */
export async function catalogPartStored(env: Env, scope: string, hash: string): Promise<boolean> {
  const storage = storageOf(env), home = publicationScope({ name: 'content' }, scope);
  if (!HASH.test(hash)) return false;
  try { return (await storage.head(partKey(home, hash))) !== null; } catch (error) { throw storageFailure(error); }
}

// ── P86 (R-P424, amending R-P407 (5)): the catalogue's id index ────────────────
//
// One immutable, content-addressed object per manifest revision with a part:
// every part record's id (expired ones included) and the product whose
// part holds it, `{ ids: { "<id>": "<product id>" } }` (the shared pieces are in
// the manifest itself), stored at `content/ids/<digest>.json` under the scope,
// its digest that of its canonical value. The manifest names it (`idIndex`), and it is written with the
// store's exact-create before the publication reserves the head, as a part is.
// Only the loads read it — the import, the pull, the validation, the PUT and a
// rollback's existence check — never a decision. Its own limit is 8 MiB; it is
// kept while a stored revision names it and purged with the parts.

/** P86 (R-P424): the id index's own ceiling. */
export const ID_INDEX_MAX_BYTES = 8 * 1024 * 1024;
/** P86 (R-P424): the id index as it is stored: each part record's id and its product (canonical JSON sorts the ids). */
export interface CatalogIdIndex { ids: Record<string, string> }
/**
 * P86 (R-P424): the index value of a map of id → product, its digest and its
 * record count, refused 413 `id_index_too_large` naming it past 8 MiB. Nothing
 * is written.
 */
export async function catalogIdIndexOf(ids: ReadonlyMap<string, string>): Promise<{ value: CatalogIdIndex; digest: string; records: number }> {
  const value: CatalogIdIndex = { ids: Object.fromEntries(ids) };
  const bytes = encoder.encode(canonical(value)).byteLength;
  if (bytes > ID_INDEX_MAX_BYTES) {
    throw new PublicationError(`The catalogue's id index would be ${bytes} bytes for ${ids.size} part records, past its 8 MiB limit; nothing was written`, 413, 'id_index_too_large');
  }
  return { value, digest: await digest(value), records: ids.size };
}
/** P86 (R-P424): write the id index with the store's exact-create (a retry writes the same key; other bytes there are a conflict). */
export async function writeCatalogIdIndex(env: Env, scope: string, value: CatalogIdIndex): Promise<string> {
  const storage = storageOf(env), home = publicationScope({ name: 'content' }, scope), raw = canonical(value);
  if (encoder.encode(raw).byteLength > ID_INDEX_MAX_BYTES) throw new PublicationError('The catalogue\'s id index is past its 8 MiB limit; nothing was written', 413, 'id_index_too_large');
  const hash = await digest(value), key = idIndexKey(home, hash);
  if (await put(storage, key, raw)) return hash;
  const found = await readObject(storage, key, ID_INDEX_MAX_BYTES); if (!found || canonical(found.value) !== raw) throw conflict();
  return hash;
}
function validIdIndex(value: unknown): value is CatalogIdIndex {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 1) return false;
  const ids = (value as CatalogIdIndex).ids;
  return !!ids && typeof ids === 'object' && !Array.isArray(ids) && Object.values(ids).every(product => typeof product === 'string');
}
/**
 * P86 (R-P424): the id index a manifest names, as id → product: one read of
 * its object, whose canonical value must hash to its digest. One the store does
 * not hold, or holds otherwise, is refused 503 `id_index_unavailable`.
 */
export async function readCatalogIdIndex(env: Env, scope: string, hash: string): Promise<Map<string, string>> {
  const storage = storageOf(env), home = publicationScope({ name: 'content' }, scope);
  const refused = () => new PublicationError('The catalogue\'s id index is unavailable, so the load cannot be checked against the records the parts hold; nothing was written', 503, 'id_index_unavailable');
  if (!HASH.test(hash)) throw refused();
  const found = await readObject(storage, idIndexKey(home, hash), ID_INDEX_MAX_BYTES);
  if (!found || !validIdIndex(found.value) || await digest(found.value) !== hash) throw refused();
  return new Map(Object.entries(found.value.ids));
}
/** P86 (R-P424): whether the store holds an id index, by one HEAD of its object (a rollback's existence check). */
export async function catalogIdIndexStored(env: Env, scope: string, hash: string): Promise<boolean> {
  const storage = storageOf(env), home = publicationScope({ name: 'content' }, scope);
  if (!HASH.test(hash)) return false;
  try { return (await storage.head(idIndexKey(home, hash))) !== null; } catch (error) { throw storageFailure(error); }
}

// ── P93 (E18, R-P487): the catalogue's sharded index ───────────────────────────
//
// The manifest of a catalogue with product slots names 256 fixed product
// shards and 256 id shards (`index`, src/content/types.ts), each an immutable,
// content-addressed object beside the parts: a product shard maps each of its
// products to its part's pointer, an id shard maps each part record's id to the
// product whose part holds it. A product falls in the shard named by the first
// two hex digits of the SHA-256 of its id's UTF-8 bytes, a record id likewise,
// so the scheme assumes nothing of any id's form. Shards are written with the
// store's exact-create before the publication reserves the head, as parts are,
// each at most 2 MiB; the manifest stays the size of its shared pieces and 512
// pointers whatever the number of products. A product page reads the anchor's
// shard (held per isolate by digest) and its part; the id shards are read by the
// loads alone.

/** P93: the shard a product id or a record id falls in: the first two hex digits of the SHA-256 of its UTF-8 bytes. */
export async function catalogShardName(id: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(id)));
  return bytes[0]!.toString(16).padStart(2, '0');
}
const shardKey = (scope: string, digest: string) => 'config-publication/v1/' + scope + '/content/shard/' + digest + '.json';
const idShardKey = (scope: string, digest: string) => 'config-publication/v1/' + scope + '/content/idshard/' + digest + '.json';
/** P93: a product shard as stored: its name and each product's part pointer. */
export interface CatalogShard { shard: string; products: Record<string, { digest: string; records: number }> }
/** P93: an id shard as stored: its name and, for each part record's id, the product whose part holds it. */
export interface CatalogIdShard { shard: string; ids: Record<string, string> }
const SHARD_NAME = /^[0-9a-f]{2}$/;
function validShard(value: unknown): value is CatalogShard {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 2) return false;
  const { shard, products } = value as CatalogShard;
  return typeof shard === 'string' && SHARD_NAME.test(shard) && !!products && typeof products === 'object' && !Array.isArray(products)
    && Object.values(products).every(p => !!p && typeof p === 'object' && typeof p.digest === 'string' && HASH.test(p.digest) && Number.isSafeInteger(p.records) && p.records >= 1);
}
function validIdShard(value: unknown): value is CatalogIdShard {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 2) return false;
  const { shard, ids } = value as CatalogIdShard;
  return typeof shard === 'string' && SHARD_NAME.test(shard) && !!ids && typeof ids === 'object' && !Array.isArray(ids) && Object.values(ids).every(p => typeof p === 'string');
}
/**
 * P93: the product shards read on this isolate, by scope and digest, apart from
 * the parts so a large part never evicts them (4 MiB of canonical bytes, the
 * oldest leaving first); `invalidatePublicationCache` clears it.
 */
const SHARD_CACHE_BYTES = 4 * 1024 * 1024;
const shardCache = new Map<string, { binding: object; value: CatalogShard; bytes: number }>(); let shardCacheBytes = 0;
function rememberShard(storage: R2Bucket, scope: string, digest: string, value: CatalogShard, bytes: number): void {
  if (bytes > SHARD_CACHE_BYTES) return;
  const key = scope + '\u0000' + digest, binding = storageIdentity(storage), held = shardCache.get(key);
  if (held) { shardCache.delete(key); shardCacheBytes -= held.bytes; }
  while (shardCacheBytes + bytes > SHARD_CACHE_BYTES && shardCache.size) { const [oldest, entry] = shardCache.entries().next().value!; shardCache.delete(oldest); shardCacheBytes -= entry.bytes; }
  shardCache.set(key, { binding, value, bytes }); shardCacheBytes += bytes;
}
/**
 * P93: a product shard's value and pointer from its products' part pointers
 * (nothing written), refused 413 `index_shard_too_large` naming the shard and
 * its count past 2 MiB.
 */
export async function catalogShardOf(shard: string, products: ReadonlyMap<string, { digest: string; records: number }>):
  Promise<{ value: CatalogShard; pointer: { digest: string; products: number; records: number } }> {
  const value: CatalogShard = { shard, products: Object.fromEntries([...products].map(([product, p]) => [product, { digest: p.digest, records: p.records }])) };
  const bytes = encoder.encode(canonical(value)).byteLength;
  if (bytes > PUBLICATION_MAX_BYTES) {
    throw new PublicationError(`The catalogue's index shard ${shard} would be ${bytes} bytes for ${products.size} products, past its 2 MiB limit; nothing was written`, 413, 'index_shard_too_large');
  }
  let records = 0; for (const p of products.values()) records += p.records;
  return { value, pointer: { digest: await digest(value), products: products.size, records } };
}
/** P93: an id shard's value and pointer (nothing written), refused 413 `id_index_too_large` naming the shard past 2 MiB. */
export async function catalogIdShardOf(shard: string, ids: ReadonlyMap<string, string>): Promise<{ value: CatalogIdShard; pointer: { digest: string; records: number } }> {
  const value: CatalogIdShard = { shard, ids: Object.fromEntries(ids) };
  const bytes = encoder.encode(canonical(value)).byteLength;
  if (bytes > PUBLICATION_MAX_BYTES) {
    throw new PublicationError(`The catalogue's id index shard ${shard} would be ${bytes} bytes for ${ids.size} part records, past its 2 MiB limit; nothing was written`, 413, 'id_index_too_large');
  }
  return { value, pointer: { digest: await digest(value), records: ids.size } };
}
/** P93: write a product shard with the store's exact-create (a retry writes the same key; other bytes there are a conflict). */
export async function writeCatalogShard(env: Env, scope: string, value: CatalogShard): Promise<string> {
  const storage = storageOf(env), home = publicationScope({ name: 'content' }, scope), held = freeze(structuredClone(value)) as CatalogShard;
  const hash = await digest(held);
  await createExact(storage, shardKey(home, hash), held);
  rememberShard(storage, home, hash, held, encoder.encode(canonical(held)).byteLength);
  return hash;
}
/** P93: write an id shard with the store's exact-create. */
export async function writeCatalogIdShard(env: Env, scope: string, value: CatalogIdShard): Promise<string> {
  const storage = storageOf(env), home = publicationScope({ name: 'content' }, scope), hash = await digest(value);
  await createExact(storage, idShardKey(home, hash), value);
  return hash;
}
/**
 * P93: one product shard by its digest: from this isolate's shard cache, else
 * one read of its object, whose canonical value must hash to its digest. A shard
 * the store does not hold, or holds otherwise, is refused 503 `part_unavailable`
 * (a product page is never decided from the shared pieces alone, R-P412 (2)).
 */
export async function readCatalogShard(env: Env, scope: string, hash: string, trips?: StorageTrip[]): Promise<CatalogShard> {
  const storage = storageOf(env), home = publicationScope({ name: 'content' }, scope);
  if (!HASH.test(hash)) throw new PublicationError('Invalid catalogue shard digest', 503, 'part_unavailable');
  const held = shardCache.get(home + '\u0000' + hash);
  if (held && held.binding === storageIdentity(storage)) return held.value;
  // P102 (CR4): a read that goes to storage is a trip of the caller's documents stage.
  const started = performance.now(), found = await readObject(storage, shardKey(home, hash));
  trips?.push({ read: ['shard'], ms: since(started) });
  if (!found || !validShard(found.value) || await digest(found.value) !== hash) throw new PublicationError(`Catalogue index shard ${hash} unavailable`, 503, 'part_unavailable');
  const value = freeze(found.value) as CatalogShard;
  rememberShard(storage, home, hash, value, found.bytes);
  return value;
}
/** P93: one id shard by its digest (the loads alone read it); one the store does not hold, or holds otherwise, is refused 503 `id_index_unavailable`. */
export async function readCatalogIdShard(env: Env, scope: string, hash: string): Promise<CatalogIdShard> {
  const storage = storageOf(env), home = publicationScope({ name: 'content' }, scope);
  const refused = () => new PublicationError(`The catalogue's id index shard ${hash.slice(0, 64)} is unavailable, so the load cannot be checked against the records the parts hold; nothing was written`, 503, 'id_index_unavailable');
  if (!HASH.test(hash)) throw refused();
  const found = await readObject(storage, idShardKey(home, hash));
  if (!found || !validIdShard(found.value) || await digest(found.value) !== hash) throw refused();
  return found.value;
}
/** P93: whether the store holds a product shard, by one HEAD of its object (a rollback's existence check). */
export async function catalogShardStored(env: Env, scope: string, hash: string): Promise<boolean> {
  const storage = storageOf(env), home = publicationScope({ name: 'content' }, scope);
  if (!HASH.test(hash)) return false;
  try { return (await storage.head(shardKey(home, hash))) !== null; } catch (error) { throw storageFailure(error); }
}
/** P93: whether the store holds an id shard, by one HEAD of its object. */
export async function catalogIdShardStored(env: Env, scope: string, hash: string): Promise<boolean> {
  const storage = storageOf(env), home = publicationScope({ name: 'content' }, scope);
  if (!HASH.test(hash)) return false;
  try { return (await storage.head(idShardKey(home, hash))) !== null; } catch (error) { throw storageFailure(error); }
}
/**
 * P93: a product's part pointer in a catalogue of either form: from the
 * one-level index, or through its shard (one read, held per isolate by digest);
 * none where it has no part. A shard the store no longer holds is refused 503
 * `part_unavailable`.
 */
export async function catalogPartPointer(env: Env, scope: string, catalog: { products?: Record<string, { digest: string; records: number }>; index?: { shards: Record<string, { digest: string }> } },
  product: string, trips?: StorageTrip[]): Promise<{ digest: string; records: number } | undefined> {
  if (catalog.products) return Object.hasOwn(catalog.products, product) ? catalog.products[product] : undefined;
  const shards = catalog.index?.shards;
  if (!shards) return undefined;
  const name = await catalogShardName(product);
  if (!Object.hasOwn(shards, name)) return undefined;
  const shard = await readCatalogShard(env, scope, shards[name]!.digest, trips);
  return Object.hasOwn(shard.products, product) ? shard.products[product] : undefined;
}
async function finish(storage: R2Bucket, loaded: Loaded, authorize?: () => Promise<void>): Promise<PublicationPin> {
  const pending = loaded.head.pending; required(pending); const set = pending.set;
  for (const document of pending.documents) { await authorize?.(); await createExact(storage, revisionKey(document.kind, document.scope, document.revision), document); }
  await authorize?.();
  await createExact(storage, setKey(set.scope, set.revision), set);
  // P102 (C): the set's serving copy, built before the head is written so the head's metadata can say when none fits;
  // nothing is written for it until the head commits, and a copy that cannot be built or written never fails the commit.
  const copy = await servingCopyOf(storage, set, pending.documents);
  const next = await sealed({ schema: 'configuration-head/v1' as const, scope: set.scope, committed: identityOf(set), pending: null });
  // P102 (B): the committed head object names its members' revisions as its storage metadata; its JSON is unchanged.
  await authorize?.(); await put(storage, headKey(set.scope), serialized(next), loaded.etag, headMetadata(set, copy.omitted));
  const after = await requiredHead(storage, set.scope); required(after.head.committed);
  if (after.head.committed.revision < set.revision) throw conflict();
  if (after.head.committed.revision === set.revision && after.head.committed.digest !== set.digest) throw conflict();
  // P102 (C): written only while the head names exactly this set, so a later commit's copy is not replaced by this one.
  if (copy.text !== null && after.head.committed.revision === set.revision) { await authorize?.(); await writeServingCopy(storage, set.scope, copy.text, false); }
  return retainedSet(storage, set.scope, identityOf(set));
}
/**
 * A publication's reservation: the head's compare-and-set from the head it read.
 * P102 (B): the five-minute backfill rewrites a committed head with its own bytes
 * and its members' metadata, which moves only the etag; a reservation that meets
 * that rewrite reads the head once more and, where its bytes are still exactly
 * the bytes it read, reserves over it, once. Any other change refuses as before.
 */
async function reserve(storage: R2Bucket, scope: string, body: string, loaded: Loaded): Promise<boolean> {
  if (await put(storage, headKey(scope), body, loaded.etag)) return true;
  const again = await readObject(storage, headKey(scope)).catch((error: unknown) => { if (error instanceof PublicationError) return null; throw error; });
  if (!again || again.text !== loaded.text || again.etag === loaded.etag) return false;
  return put(storage, headKey(scope), body, again.etag);
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
/**
 * `candidate` receives the member's document in the base set — absent (P38) for
 * an optional member this publication creates — and the base set itself, so a
 * door can read another member of exactly the set it publishes over.
 */
export interface PublicationChange<T = unknown> { kind: DocumentKind<T>; scope: string; request: unknown; candidate: (base: T, set: PublicationPin) => unknown | Promise<unknown> }
/** Several related documents are one intent and become visible in one CAS. */
export async function publishSet(env: Env, changes: PublicationChange[], meta: WriteMeta): Promise<WriteResult<unknown>> {
  // P38: only a write whose first member is optional may name revision 0, and
  // it then creates that member; every other write is checked exactly as before.
  const preconditions = publicationPreconditions(meta, false, changes.length > 0 && OPTIONAL_MEMBERS.has(changes[0]!.kind.name));
  if (!changes.length || changes.length > MEMBERS) throw new PublicationError('Invalid publication members', 422, 'invalid_document');
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
      // P38: an optional member the base set does not carry is created at
      // revision 1; any other absent member is the authority failing, as before.
      const present = Object.hasOwn(base.refs, member(change.kind, change.scope));
      if (!present && !OPTIONAL_MEMBERS.has(change.kind.name)) throw absent(env, change.kind);
      const current = present ? await readPinnedPublication(env, change.kind, change.scope, base) : null, previous = current?.revision ?? 0;
      if (previous === Number.MAX_SAFE_INTEGER || i === 0 && previous !== meta.expectedRevision) throw conflict();
      const validated = change.kind.validate(await change.candidate(current?.value as unknown, base)); if (!validated.ok) return validated;
      const revision = previous + 1, value = change.kind.stamp ? change.kind.stamp(validated.value, revision) : validated.value;
      // Secondary members retain their numeric IDs; the set operation is their
      // joint receipt, and no independently writable pointer can expose them.
      const op = { operationId: i === 0 ? meta.operationId! : previous + ':' + meta.operationId!.split(':')[1], expectedRevision: previous, requestDigest, initialize: false };
      const document = await envelope(await sealed({ schema: 'catalog-revision/v1' as const, kind: change.kind.name, scope: change.scope,
        revision, value, actor: meta.actor, note: meta.note ?? '', at, operation: op,
        // W21 E1.07 (R130): computed on the operator's publish, where the history
        // is already being read, and never on the shopper's decision.
        ...(await derivedFor(env, change.kind, change.scope, revision, value, carriedSaltVersion(current))) }), change.kind, change.scope);
      serialized(document); documents.push(document);
      const key = member(change.kind, change.scope), old = present ? refs[key] : undefined;
      refs[key] = old ? { ...old, revision, digest: document.digest, index: [rowOf(change.kind, document), ...old.index].slice(0, LIMIT) }
        : { kind: change.kind.name, scope: change.scope, revision, digest: document.digest, minRevision: 1, index: [rowOf(change.kind, document)] };
    }
    const set = await sealed({ schema: 'configuration-set/v1' as const, scope, revision: base.revision + 1, refs,
      operation: { operationId: meta.operationId!, expectedRevision: meta.expectedRevision!, requestDigest, initialize: false,
        kind: first.kind.name, scope: first.scope, actor: meta.actor, note: meta.note ?? '', at, base: identityOf(base) } });
    await validateSet(set, scope);
    const next = await sealed({ schema: 'configuration-head/v1' as const, scope, committed: identityOf(base), pending: { set, documents } });
    await meta.authorize?.();
    if (!await reserve(storage, scope, serialized(next), loaded)) throw conflict();
    const reservation = await requiredHead(storage, scope); if (reservation.head.pending?.set.digest !== set.digest) throw conflict();
    const committed = await finish(storage, reservation, meta.authorize);
    // W38 B4: only after the new set is committed, and never able to fail it.
    await purgeByPolicy(env, storage, scope, committed);
    return { ok: true, revision: await readPinnedPublication(env, first.kind, first.scope, committed) };
  });
}
export async function publish<T>(env: Env, kind: DocumentKind<T>, scope: string, request: unknown, meta: WriteMeta,
  candidate: (base: T, set: PublicationPin) => unknown | Promise<unknown>): Promise<WriteResult<T>> {
  if (!meta.expectedPublication) {
    const { document, set } = await legacyCommitted(env, kind, scope, meta);
    const requestDigest = await digest({ operationId: meta.operationId, expectedRevision: meta.expectedRevision, actor: meta.actor, note: meta.note ?? '', request });
    if (document.actor !== meta.actor || document.operation.requestDigest !== requestDigest) throw conflict();
    return { ok: true, revision: publicRevision(document, set, kind) };
  }
  return publishSet(env, [{ kind, scope, request, candidate } as PublicationChange], meta) as Promise<WriteResult<T>>;
}
/**
 * P38 (decision D1): publish one member under the authored precondition of
 * ANOTHER member, the anchor. An approval is its own member, so approving a
 * vocabulary revision writes no vocabulary revision, yet the operator approves
 * the vocabulary as read: `meta` carries the anchor's revision and the set it
 * was read in (If-Match), exactly as a write of the anchor would. The set named
 * there must be a committed set whose anchor is that revision; the change is
 * then published over it as an ordinary set publication, its own document
 * precondition the target member's revision in that same set (0, and the member
 * created, when it has none). An exact retry therefore maps to the same
 * operation and is answered from the committed result; a stale read is refused
 * (409), as every other write's is.
 */
export async function publishAnchored<T>(env: Env, anchor: { kind: { name: string }; scope: string }, change: PublicationChange<T>, meta: WriteMeta): Promise<WriteResult<T>> {
  const preconditions = publicationPreconditions(meta), read = preconditions.expectedPublication!;
  const scope = publicationScope(change.kind, change.scope), storage = storageOf(env);
  if (publicationScope(anchor.kind, anchor.scope) !== scope) throw conflict();
  const loaded = await requiredHead(storage, scope);
  if (!loaded.head.committed || loaded.head.committed.revision < read.revision) throw conflict();
  const found = await readObject(storage, setKey(scope, read.revision)); required(found);
  const set = await validateSet(found.value, scope);
  if (set.digest !== read.digest || set.refs[member(anchor.kind, anchor.scope)]?.revision !== preconditions.expectedRevision) throw conflict();
  const target = Object.hasOwn(set.refs, member(change.kind, change.scope)) ? set.refs[member(change.kind, change.scope)].revision : 0;
  return publishSet(env, [change as PublicationChange], { ...meta, expectedRevision: target, operationId: target + ':' + preconditions.operationId.split(':')[1] }) as Promise<WriteResult<T>>;
}
/**
 * P38: a member that may be absent, read from one pin of the current set
 * (administrative: never the serving cache), with that set's identity — the
 * identity an authored write of the member names, whether or not it exists.
 */
export async function readOptionalPublication<T>(env: Env, kind: DocumentKind<T>, scope: string): Promise<{ publication: Identity; revision: Revision<T> | null; set: PublicationPin }> {
  const set = await pinPublication(env, publicationScope(kind, scope));
  return { publication: identityOf(set), revision: await readOptionalPinnedPublication(env, kind, scope, set), set };
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
  if (meta) publicationPreconditions(meta, false, OPTIONAL_MEMBERS.has(kind.name));
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
  publicationPreconditions(meta, false, OPTIONAL_MEMBERS.has(kind.name)); const storage = storageOf(env), owner = publicationScope(kind, scope);
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
/**
 * W38 B3 (F32 §1.1, §6.1): the document of a revision the retired store wrote,
 * read exactly as its own reader read it — `'value' in envelope ? envelope.value
 * : envelope.config`. Before 1877fc6 the Reflex writer stored the document under
 * `config` alone; from 1877fc6 to 7b01c14 every kind stored it under `value` and
 * duplicated it under `config`. Both forms are adopted as stored: `value` wins
 * where it is present, and nothing is merged, repaired or rewritten.
 */
function retainedDocument(revision: Revision<unknown>): unknown {
  const stored = revision as unknown as Record<string, unknown>;
  return Object.hasOwn(stored, 'value') || !Object.hasOwn(stored, 'config') ? stored.value : stored.config;
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
      const stored = b.retainedValue ? retainedDocument(raw) : raw.value;
      const validated = (b.retainedValue ? b.kind.validateStored ?? b.kind.validate : b.kind.validate)(stored);
      if (!validated.ok) throw new PublicationError('Invalid baseline configuration', 422, 'invalid_baseline');
      const document = await envelope(await sealed({ revision: raw.revision, value: b.retainedValue ? stored : validated.value, actor: raw.actor, note: raw.note, at: raw.at,
        schema: 'catalog-revision/v1' as const, kind: b.kind.name, scope: b.scope,
        operation: { operationId: (raw.revision - 1) + ':' + operationId.split(':')[1], expectedRevision: raw.revision - 1, requestDigest, initialize: true },
        ...(await derivedFor(env, b.kind, b.scope, raw.revision, b.retainedValue ? stored : validated.value)) }), b.kind, b.scope);
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
/**
 * P48 (R-P78, R-P82 (4); D01: it creates, it never overwrites): the one
 * capability that ADDS a member that is not optional to a COMMITTED set.
 *
 * The demo bootstrap created sets of four members before it seeded six, and
 * every read and publish refuses a member the set lacks, so such a tenant could
 * never read or publish its priors or proposals. This adds exactly the
 * completion members the committed set lacks, each as its compiled empty
 * (EMPTY_PRIORS, EMPTY_PROPOSALS) at revision 1, as the initializer stores it,
 * in one set publication that changes no other member: what init-local and the
 * W08 door write for them, and what an absent member already means to the
 * learning path (no imported prior, no proposal). Nothing but the attribution
 * comes from the caller; the authority is the caller's (the demo door's, or the
 * stamp owner's sibling of the W08 door, P54).
 *
 *  · a set that has both answers `added: []` and writes nothing;
 *  · a scope with no set refuses 503 `publication_uninitialized`, as a read does;
 *  · a completion left pending by an interrupted call is finished by the next;
 *    any other pending publication refuses 409 `publication_conflict`;
 *  · an occupied revision address refuses 409 before the head is reserved, as
 *    the initializer's check does, and a concurrent publication loses the CAS.
 * `added` names the members as an operator reads them (`priors`, `proposals`).
 */
export async function completePublicationSet(env: Env, scope: string, attribution: { actor: string; note: string }): Promise<{ added: string[]; set: PublicationPin }> {
  required(/^[a-z0-9][a-z0-9-]{0,31}$/.test(scope));
  const { actor, note } = attribution;
  if (!text(actor, 256) || typeof note !== 'string' || note.length > 500) throw new PublicationError('Invalid publication attribution', 422, 'invalid_attribution');
  const storage = storageOf(env), named = (kinds: string[]) => kinds.map(name => COMPLETION_MEMBERS.get(name)!);
  return invalidating(storage, scope, async () => {
    const loaded = await requiredHead(storage, scope), base = await currentSet(storage, loaded);
    if (loaded.head.pending) {
      // The head validation admits a completion member only in a set that changes nothing else.
      const added = loaded.head.pending.documents.filter(d => COMPLETION_MEMBERS.has(d.kind) && !Object.hasOwn(base.refs, member({ name: d.kind }, d.scope)));
      if (!added.length) throw conflict();
      return { added: named(added.map(d => d.kind)), set: await finish(storage, loaded) };
    }
    const missing = [...COMPLETION_MEMBERS.keys()].filter(name => !Object.hasOwn(base.refs, member({ name }, scope)));
    if (!missing.length) return { added: [], set: base };
    const kinds = await Promise.all(missing.map(name => kindFor(name))), at = Date.now(), operationId = '0:' + crypto.randomUUID();
    const requestDigest = await digest({ complete: missing, scope, actor, note, operationId });
    const refs = structuredClone(base.refs), documents: Envelope<unknown>[] = [];
    for (const kind of kinds) {
      const document = await envelope(await sealed({ schema: 'catalog-revision/v1' as const, kind: kind.name, scope, revision: 1, value: await compiledEmpty(kind),
        actor, note, at, operation: { operationId, expectedRevision: 0, requestDigest, initialize: false } }), kind, scope);
      serialized(document); documents.push(document);
      const occupied = await readObject(storage, revisionKey(kind.name, scope, 1));
      if (occupied && canonical(occupied.value) !== canonical(document)) throw conflict();
      refs[member(kind, scope)] = { kind: kind.name, scope, revision: 1, digest: document.digest, minRevision: 1, index: [rowOf(kind, document)] };
    }
    const set = await sealed({ schema: 'configuration-set/v1' as const, scope, revision: base.revision + 1, refs,
      operation: { operationId, expectedRevision: 0, requestDigest, initialize: false, kind: kinds[0]!.name, scope, actor, note, at, base: identityOf(base) } });
    await validateSet(set, scope);
    const next = await sealed({ schema: 'configuration-head/v1' as const, scope, committed: identityOf(base), pending: { set, documents } });
    if (!await reserve(storage, scope, serialized(next), loaded)) throw conflict();
    const reservation = await requiredHead(storage, scope); if (reservation.head.pending?.set.digest !== set.digest) throw conflict();
    return { added: named(missing), set: await finish(storage, reservation) };
  });
}

/**
 * P102 (E27): an existing tenant's committed head gains its members' metadata
 * (fix B) and its serving copy (fix C) without anyone publishing, from the
 * tenant's five-minute scheduled job (src/index.ts), off every shopper's time;
 * a serving read never writes. The head is rewritten with its own bytes and the
 * metadata under a conditional write on the etag it was read with, so a
 * publication committed meanwhile wins and the run then writes nothing at all;
 * a publication whose reservation meets the rewrite reserves over it
 * (`reserve`). The copy is created only where the scope has none
 * (create-only), so a copy a commit wrote is never replaced. A head that
 * already names its members and a scope that already has its copy (or whose
 * copy the commit found past its bound) cost one read of the head and one HEAD
 * of the copy, and write nothing. It answers what it wrote; a failure writes
 * nothing more and is the caller's to log.
 */
export async function backfillPublication(env: Env, scope: string): Promise<{ head: boolean; copy: boolean }> {
  const nothing = { head: false, copy: false };
  if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(scope)) return nothing;
  const storage = storageOf(env), loaded = await loadHead(storage, scope);
  if (!loaded || !loaded.head.committed || loaded.head.pending) return nothing;
  let copyWanted = false;
  if (!loaded.copyOmitted && typeof storage.head === 'function') {
    try { copyWanted = (await storage.head(servingKey(scope))) === null; } catch (error) { throw storageFailure(error); }
  }
  if (loaded.hint && !copyWanted) return nothing;
  const set = await currentSet(storage, loaded);
  const copy = copyWanted ? await servingCopyOf(storage, set, []) : { text: null, omitted: false };
  const omitted = copy.omitted || loaded.copyOmitted === true;
  let head = false;
  if (!hintMatches(loaded.hint, set) || omitted !== (loaded.copyOmitted === true)) {
    if (!await put(storage, headKey(scope), loaded.text, loaded.etag, headMetadata(set, omitted))) return nothing;
    head = true;
  }
  return { head, copy: copy.text !== null && await writeServingCopy(storage, scope, copy.text, true) };
}

/*
 * W38 B4 (decision D3, amendment A35; decision D2; document 35 §5 row W38
 * "retain needed immutable revisions and purge by policy"): purge by policy.
 *
 * WHAT IS PURGED. Nothing, unless the tenant's retention registry sets its
 * configuration-revision category (`configuration`, src/retention.ts). Unset,
 * or a registry that cannot be read, stops here before any storage call, so the
 * tenants that set nothing keep every revision exactly as before (D2). Where it
 * is set, a configuration publication — the only writer of configuration
 * revisions — purges, after its own set is committed, the stored revisions of
 * every member of its scope that are
 *   · neither the current nor the previous revision of their kind (rollback);
 *   · older than the setting, counted from when the revision stopped being in
 *     force (the publication of the next stored revision): a revision is never
 *     aged while it is the one that serves;
 *   · named by no stored replay manifest (below);
 *   · for learning revisions, not needed by the next learn publication's salt
 *     count (W21 E1.07, P95): while the current learn revision carries no exact
 *     count, that publication counts by reading the whole history back to the
 *     first revision, so no learn revision is purged (`saltCountCarried`,
 *     below).
 * "Purged" means its immutable body object is deleted. The set, its index rows
 * and every other revision stay as they are; a read of a purged revision
 * answers 410 `revision_purged` (publicationVersion, above).
 *
 * NAMED BY A STORED REPLAY MANIFEST. A stored decision record (the ledger's
 * decision stream, `{tenant}/{yyyy-mm-dd}/{hh}/decision/{min}-{max}-….ndjson`,
 * src/ledger/writer.ts) names the catalog, slots, learning and Reflex revisions
 * in force when it was served (`versions.catalog/slots/learn/config`) and, per
 * learning slot, the prior revision its lift snapshot was built with
 * (`versions.prior`, `inputs.replay.slots[].prior`). Proposals are never named.
 * The ledger is never scanned whole: a revision can only be named by decisions
 * served while it could be read, so only the ledger hours of that window are
 * listed, the days and hours the ledger actually holds found by rolled-up
 * listings, and each object placed by the time range its key carries:
 *   · a document revision is served between its publication and the next one,
 *     plus the serving cache's staleness (30 s) and clock skew — PURGE_MARGIN_MS
 *     on each side. An object wholly inside the window's interior holds only
 *     decisions that name it; objects at the edges are read.
 *   · a prior revision reaches a decision only through a lift snapshot built
 *     while it was in force, and such a snapshot is served until its placement
 *     publishes the next one (the live witness refuses any other). The lift
 *     archive (`lift/{tenant}/{brand}/{placement}/{version}.json`, versions are
 *     millisecond publication times) bounds that reach; a placement that has
 *     published nothing since still serves it, and the prior is kept. The
 *     objects of the reached window are read.
 * Anything this cannot establish — an object it cannot place or parse, a
 * listing it cannot page, the work budget running out, a storage failure —
 * keeps the revision. Each publication examines at most PURGE_CANDIDATES
 * candidates, rotated by the set's revision so none is starved, within
 * PURGE_OPERATIONS storage calls and PURGE_BYTES of ledger text; what it does
 * not reach stays retained until a later publication. It never throws: a purge
 * can never fail, delay into failure or roll back the publication it follows.
 */
const PURGE_MARGIN_MS = 5 * 60_000;
const PURGE_CANDIDATES = 16, PURGE_OPERATIONS = 256, PURGE_BYTES = 16 * 1024 * 1024;
const HOUR_MS = 3_600_000;
/** The fields of a decision record's `versions` that name a revision of each document kind. */
const NAMING_FIELDS: Record<string, readonly string[]> = { content: ['catalog'], slots: ['slots'], learn: ['learn', 'policy'], reflex: ['config'] };
class PurgeStopped extends Error {}
interface PurgeWork { operations: number; bytes: number }
function spend(work: PurgeWork, bytes = 0): void {
  if (++work.operations > PURGE_OPERATIONS || (work.bytes += bytes) > PURGE_BYTES) throw new PurgeStopped();
}
interface Listed { objects: Array<{ key: string; size: number }>; delimitedPrefixes: string[]; truncated: boolean; cursor?: string }
/** Every page of one listing, in key order, until `visit` answers true. */
async function eachListed(storage: R2Bucket, work: PurgeWork, options: R2ListOptions, visit: (page: Listed) => boolean | void): Promise<void> {
  let cursor: string | undefined;
  for (let first = true; first || cursor; first = false) {
    spend(work);
    const page = await storage.list(first ? options : { prefix: options.prefix, ...(options.delimiter ? { delimiter: options.delimiter } : {}), cursor }) as unknown as Listed;
    if (!page || !Array.isArray(page.objects) || typeof page.truncated !== 'boolean') throw new PurgeStopped();
    if (visit({ objects: page.objects, delimitedPrefixes: Array.isArray(page.delimitedPrefixes) ? page.delimitedPrefixes : [], truncated: page.truncated })) return;
    cursor = page.truncated ? page.cursor : undefined;
    if (page.truncated && !cursor) throw new PurgeStopped();
  }
}
/** W38 B4: does this tenant set the configuration-revision retention setting? Never throws. */
async function purgesConfiguration(env: Env, tenant: string): Promise<boolean> {
  try { return (await import('@/retention')).configurationRetention(env, tenant) !== null; } catch { return false; }
}
async function purgeByPolicy(env: Env, storage: R2Bucket, scope: string, set: PublicationPin): Promise<void> {
  let durationMs: number;
  try {
    const policy = (await import('@/retention')).configurationRetention(env, scope);
    if (!policy || typeof storage.list !== 'function' || typeof storage.delete !== 'function') return;
    durationMs = policy.durationMs;
  } catch { return; }
  const work: PurgeWork = { operations: 0, bytes: 0 }, now = set.operation.at;
  try {
    const { hourPrefix, fromTs36 } = await import('@/ledger/records');
    const ledger = { hourPrefix, fromTs36 };
    const candidates: Array<{ ref: Ref; n: number; next: number }> = [];
    for (const ref of Object.values(set.refs)) {
      // P38: vocabulary revisions and approvals are the audit of what governed
      // the tenant's data, and an approval names a revision by number: kept.
      if (ref.revision - 2 < ref.minRevision || OPTIONAL_MEMBERS.has(ref.kind)) continue;
      if (!await saltCountCarried(env, work, set, ref)) continue;
      const stored = await storedRevisions(storage, work, ref);
      for (const [i, n] of stored.entries()) {
        const next = stored[i + 1];
        if (n >= ref.minRevision && n <= ref.revision - 2 && next !== undefined) candidates.push({ ref, n, next });
      }
    }
    const start = candidates.length ? (set.revision * PURGE_CANDIDATES) % candidates.length : 0;
    // P86, P93: a scope that holds no part at all (one listing) reads no revision for its attachments.
    const parted = await holdsParts(storage, work, scope, candidates.map(c => c.ref)), values = new Map<string, unknown>();
    for (let i = 0; i < Math.min(PURGE_CANDIDATES, candidates.length); i++) {
      const { ref, n, next } = candidates[(start + i) % candidates.length]!;
      // Its successor's publication is when it stopped being in force; where that
      // successor was itself purged, the next stored revision's is later still.
      const born = await revisionTime(storage, work, ref, n), superseded = ref.index.find(entry => entry.revision === n + 1)?.at ?? await revisionTime(storage, work, ref, next);
      if (born === null || superseded === null || now - superseded <= durationMs) continue;
      if (await namedByStoredManifest(storage, work, ledger, scope, ref.kind, n, born, superseded)) continue;
      // P86, P93 (R-P487 (8)): the objects only this revision names beside its body (its id index or its shards, and the
      // parts behind them) are resolved against every other stored revision and removed BEFORE the body: a purge that
      // stops on its budget leaves the body, so the next publication resolves them again and nothing is lost for good.
      if (parted && ref.kind === 'content') {
        const value = await revisionValue(storage, work, ref, n, values);
        if (value) {
          const others: unknown[] = [];
          for (const m of await storedRevisions(storage, work, ref)) if (m !== n) { const other = await revisionValue(storage, work, ref, m, values); if (other) others.push(other); }
          await sweep(storage, work, await orphansOf(storage, work, ref.scope, value, others), now - ATTACHMENT_GRACE_MS);
        }
      }
      spend(work);
      await storage.delete(revisionKey(ref.kind, ref.scope, n));
      values.delete(`${ref.kind}\u0000${n}`);
    }
  } catch { /* whatever this publication did not reach stays retained */ }
}
/** P93: a stored content revision's value, read once per purge within its budget (null where it is gone). */
async function revisionValue(storage: R2Bucket, work: PurgeWork, ref: Ref, n: number, values: Map<string, unknown>): Promise<unknown> {
  const key = `${ref.kind}\u0000${n}`;
  if (values.has(key)) return values.get(key);
  spend(work);
  const found = await readObject(storage, revisionKey(ref.kind, ref.scope, n));
  if (found && (work.bytes += found.bytes) > PURGE_BYTES) throw new PurgeStopped();
  const value = found ? (found.value as { value?: unknown } | null)?.value ?? null : null;
  values.set(key, value);
  return value;
}
interface IndexedValue { products?: Record<string, { digest?: unknown }>; idIndex?: { digest?: unknown }; index?: { shards?: Record<string, { digest?: unknown }>; ids?: Record<string, { digest?: unknown }> } }
const ownDigest = (record: Record<string, { digest?: unknown }> | undefined, key: string): string | undefined => {
  const value = record && typeof record === 'object' && Object.hasOwn(record, key) ? record[key]?.digest : undefined;
  return typeof value === 'string' && HASH.test(value) ? value : undefined;
};
/**
 * P86, P93: the keys of the objects one revision names beside its body that no
 * other stored revision names. A one-level revision (P86): each part no other
 * revision points the same product at, and its id index. A sharded one (P93):
 * each shard no other revision names under the same name, and, bucket by bucket
 * (a product's pointer lives in its own shard in every revision), each part
 * behind such a shard that no other revision points the same product at; each id
 * shard likewise. A shard another revision names whole is named with every part
 * behind it, and is not read.
 */
async function orphansOf(storage: R2Bucket, work: PurgeWork, scope: string, value: unknown, others: readonly unknown[]): Promise<string[]> {
  const v = value as IndexedValue, peers = others as IndexedValue[], orphans: string[] = [], shards = new Map<string, CatalogShard | null>();
  const shardAt = async (hash: string): Promise<CatalogShard | null> => {
    if (shards.has(hash)) return shards.get(hash)!;
    spend(work);
    const found = await readObject(storage, shardKey(scope, hash));
    if (found && (work.bytes += found.bytes) > PURGE_BYTES) throw new PurgeStopped();
    const shard = found && validShard(found.value) ? found.value : null;
    shards.set(hash, shard);
    return shard;
  };
  const pointedBy = async (peer: IndexedValue, product: string): Promise<string | undefined> => {
    if (peer.products) return ownDigest(peer.products, product);
    const hash = ownDigest(peer.index?.shards, await catalogShardName(product));
    const shard = hash ? await shardAt(hash) : null;
    return shard ? ownDigest(shard.products, product) : undefined;
  };
  const named = async (product: string, hash: string) => { for (const peer of peers) if (await pointedBy(peer, product) === hash) return true; return false; };
  if (v.products && typeof v.products === 'object') {
    for (const product of Object.keys(v.products)) { const hash = ownDigest(v.products, product); if (hash && !await named(product, hash)) orphans.push(partKey(scope, hash)); }
    const hash = typeof v.idIndex?.digest === 'string' && HASH.test(v.idIndex.digest) ? v.idIndex.digest : undefined;
    if (hash && !peers.some(peer => peer.idIndex?.digest === hash)) orphans.push(idIndexKey(scope, hash));
  } else if (v.index && typeof v.index === 'object') {
    for (const name of Object.keys(v.index.shards ?? {})) {
      const hash = ownDigest(v.index.shards, name);
      if (!hash || peers.some(peer => ownDigest(peer.index?.shards, name) === hash)) continue;
      orphans.push(shardKey(scope, hash));
      const shard = await shardAt(hash);
      for (const product of Object.keys(shard?.products ?? {})) { const part = ownDigest(shard!.products, product); if (part && !await named(product, part)) orphans.push(partKey(scope, part)); }
    }
    for (const name of Object.keys(v.index.ids ?? {})) {
      const hash = ownDigest(v.index.ids, name);
      if (hash && !peers.some(peer => ownDigest(peer.index?.ids, name) === hash)) orphans.push(idShardKey(scope, hash));
    }
  }
  return [...new Set(orphans)];
}
/**
 * P93 (R-P487 (8)): remove the objects named, each only when it was uploaded 15
 * minutes ago or more (R-P424: a load in flight may have written that very
 * object for the head it is about to reserve). The upload times are read from
 * the listing — one call per object for a few, else the directory in pages of
 * 1,000 — and the deletions go 1,000 to a call, all within the purge's budget.
 */
async function sweep(storage: R2Bucket, work: PurgeWork, keys: readonly string[], cutoff: number): Promise<void> {
  const groups = new Map<string, Set<string>>();
  for (const key of keys) { const dir = key.slice(0, key.lastIndexOf('/') + 1), group = groups.get(dir) ?? new Set<string>(); group.add(key); groups.set(dir, group); }
  const old: string[] = [];
  for (const [dir, group] of groups) {
    if (group.size <= 8) { for (const key of group) if (await uploadedBefore(storage, work, key, cutoff)) old.push(key); continue; }
    const pending = new Set(group);
    await eachListed(storage, work, { prefix: dir }, page => {
      for (const object of page.objects as Array<{ key: string; uploaded?: unknown }>) {
        if (!pending.delete(object.key)) continue;
        const at = object.uploaded instanceof Date ? object.uploaded.getTime() : NaN;
        if (Number.isFinite(at) && at < cutoff) old.push(object.key);
      }
      return pending.size === 0;
    });
  }
  for (let i = 0; i < old.length; i += 1000) { spend(work); await storage.delete(old.slice(i, i + 1000)); }
}
/** P86 (R-P424): the pending-publication grace: an attachment younger than this is never purged. */
const ATTACHMENT_GRACE_MS = 15 * 60_000;
/** P86 (R-P424): whether the object was uploaded before `cutoff`, by its listed upload time; an object not listed, or listed without a time, is not. */
async function uploadedBefore(storage: R2Bucket, work: PurgeWork, key: string, cutoff: number): Promise<boolean> {
  spend(work);
  const page = await storage.list({ prefix: key, limit: 1 }) as unknown as { objects?: Array<{ key?: unknown; uploaded?: unknown }> };
  const found = Array.isArray(page?.objects) ? page.objects.find(object => object?.key === key) : undefined;
  const at = found?.uploaded instanceof Date ? found.uploaded.getTime() : NaN;
  return Number.isFinite(at) && at < cutoff;
}
/** P86: whether a purge has parts to consider: a content candidate, and at least one part object of the scope. */
async function holdsParts(storage: R2Bucket, work: PurgeWork, scope: string, refs: Ref[]): Promise<boolean> {
  if (!refs.some(ref => ref.kind === 'content')) return false;
  spend(work);
  const page = await storage.list({ prefix: partKey(scope, '').slice(0, -'.json'.length), limit: 1 }) as unknown as Listed;
  return Array.isArray(page?.objects) && page.objects.length > 0;
}
/**
 * W38 B4 with W21 E1.07: may this member's old revisions be purged without
 * costing the next learn publication its exact salt count? Every kind but
 * learning, yes. A learn revision's count is carried from the current one where
 * that carries an exact count (`derivedFor`), whatever its revision number, so
 * older learn revisions may then go. Where it carries none — a history published
 * before the annotation existed, or a count that could not finish — the next
 * publication counts over the whole stored history instead (P95: no read
 * horizon), so every learn revision is kept until a publication establishes an
 * exact count again.
 *
 * It reads the current learn revision exactly as that publication will
 * (`readPinnedPublication`, then `carriedSaltVersion`), once per publication,
 * charged to the purge's work. Any failure throws into the purge's own catch:
 * nothing is purged, and the publication it follows is unaffected.
 */
async function saltCountCarried(env: Env, work: PurgeWork, set: PublicationPin, ref: Ref): Promise<boolean> {
  if (ref.kind !== 'learn') return true;
  spend(work);
  const count = carriedSaltVersion(await readPinnedPublication(env, await kindFor(ref.kind), ref.scope, set))?.version;
  return integer(count) && count > 0;
}
/** The revision numbers of one member whose bodies are still stored, ascending. */
async function storedRevisions(storage: R2Bucket, work: PurgeWork, ref: Ref): Promise<number[]> {
  const prefix = revisionKey(ref.kind, ref.scope, 0).slice(0, -'0.json'.length), out: number[] = [];
  await eachListed(storage, work, { prefix }, page => {
    for (const { key } of page.objects) {
      const m = /^([1-9][0-9]*)\.json$/.exec(key.slice(prefix.length)), n = m ? Number(m[1]) : NaN;
      if (integer(n)) out.push(n);
    }
  });
  return out.sort((a, b) => a - b);
}
/**
 * A revision's publication time: from the set's own index where the revision is
 * still listed there, otherwise from the head of its stored body. The body is
 * canonical JSON (`serialized`), whose sorted keys begin `{"actor":…,"at":N`, so
 * a bounded ranged read answers it without reading a document of up to 2 MiB.
 */
async function revisionTime(storage: R2Bucket, work: PurgeWork, ref: Ref, n: number): Promise<number | null> {
  const row = ref.index.find(entry => entry.revision === n);
  if (row) return row.at;
  spend(work);
  const found = await storage.get(revisionKey(ref.kind, ref.scope, n), { range: { offset: 0, length: 4096 } });
  if (!found) return null;
  const m = /^\{"actor":"(?:[^"\\]|\\.)*","at":(0|[1-9][0-9]*)[,}]/.exec(await found.text()), at = m ? Number(m[1]) : NaN;
  return integer(at) ? at : null;
}
type LedgerKeys = { hourPrefix(tenant: string, ms: number): string; fromTs36(value: string): number };
async function namedByStoredManifest(storage: R2Bucket, work: PurgeWork, ledger: LedgerKeys, tenant: string, kind: string, n: number, born: number, superseded: number): Promise<boolean> {
  if (kind === 'proposals') return false;
  const versions = (record: unknown): Record<string, unknown> => {
    const value = object(record) ? record.versions : undefined;
    return object(value) ? value : {};
  };
  if (kind === 'prior') {
    const reach = await priorReach(storage, work, tenant, born - PURGE_MARGIN_MS, superseded + PURGE_MARGIN_MS);
    if (reach === 'serving') return true;
    if (reach === null) return false;
    return decisionsName(storage, work, ledger, tenant, reach.from - PURGE_MARGIN_MS, reach.to + PURGE_MARGIN_MS, null, record => {
      if (versions(record).prior === n) return true;
      const inputs = object(record) ? record.inputs : undefined, replay = object(inputs) ? inputs.replay : undefined, slots = object(replay) ? replay.slots : undefined;
      return Array.isArray(slots) && slots.some(row => object(row) && row.prior === n);
    });
  }
  const fields = NAMING_FIELDS[kind];
  if (!fields) return true;
  return decisionsName(storage, work, ledger, tenant, born - PURGE_MARGIN_MS, superseded + PURGE_MARGIN_MS,
    [born + PURGE_MARGIN_MS, superseded - PURGE_MARGIN_MS], record => fields.some(field => versions(record)[field] === n));
}
/**
 * Does a stored decision served in [from, to] name the revision (`names`)? An
 * object wholly inside `interior` counts without being read.
 */
async function decisionsName(storage: R2Bucket, work: PurgeWork, ledger: LedgerKeys, tenant: string, from: number, to: number,
  interior: [number, number] | null, names: (record: unknown) => boolean): Promise<boolean> {
  if (to < from) return false;
  const root = tenant + '/', dayOf = (ms: number) => ledger.hourPrefix(tenant, ms).slice(root.length, root.length + 10);
  const first = dayOf(from), last = dayOf(to), days: string[] = [];
  await eachListed(storage, work, { prefix: root, delimiter: '/', startAfter: root + first }, page => {
    for (const prefix of page.delimitedPrefixes) {
      const day = prefix.slice(root.length, -1);
      if (day > last) return true;
      if (/^\d{4}-\d{2}-\d{2}$/.test(day) && day >= first) days.push(day);
    }
  });
  for (const day of days) {
    const hours: string[] = [];
    await eachListed(storage, work, { prefix: `${root}${day}/`, delimiter: '/' }, page => {
      for (const prefix of page.delimitedPrefixes) { const hour = prefix.slice(root.length + 11, -1); if (/^\d{2}$/.test(hour)) hours.push(hour); }
    });
    for (const hour of hours.sort()) {
      const opens = Date.parse(`${day}T${hour}:00:00Z`);
      if (!(opens <= to && opens + HOUR_MS > from)) continue;
      const prefix = `${root}${day}/${hour}/decision/`, read: Array<{ key: string; size: number }> = [];
      let kept = false;
      await eachListed(storage, work, { prefix }, page => {
        for (const listed of page.objects) {
          const m = /^([0-9a-z]{9})-([0-9a-z]{9})-[^/]+\.ndjson$/.exec(listed.key.slice(prefix.length));
          const min = m ? ledger.fromTs36(m[1]!) : NaN, max = m ? ledger.fromTs36(m[2]!) : NaN;
          // An object this reader cannot place in time could hold anything: keep the revision.
          if (!integer(min) || !integer(max) || min > max) { kept = true; return true; }
          if (min > to || max < from) continue;
          if (interior && min >= interior[0] && max <= interior[1]) { kept = true; return true; }
          read.push(listed);
        }
      });
      if (kept) return true;
      for (const listed of read) if (await objectNames(storage, work, listed, names)) return true;
    }
  }
  return false;
}
async function objectNames(storage: R2Bucket, work: PurgeWork, listed: { key: string; size: number }, names: (record: unknown) => boolean): Promise<boolean> {
  spend(work, integer(listed.size) ? listed.size : PURGE_BYTES + 1);
  const found = await storage.get(listed.key);
  // Gone since it was listed (a rewrite after erasure): it names nothing any more.
  if (!found) return false;
  for (const line of (await found.text()).split('\n')) {
    if (!line) continue;
    let record: unknown;
    try { record = JSON.parse(line); } catch { return true; }
    if (names(record)) return true;
  }
  return false;
}
/**
 * The window in which a decision could have been served a lift snapshot built
 * while a prior revision was in force ([builtFrom, builtTo]): from the first
 * such snapshot of any placement to the first snapshot each of those placements
 * published after it. `null` where no snapshot was built then, so nothing can
 * name the prior; `'serving'` where a placement has published nothing since,
 * so the prior may still be named by the next decision.
 */
async function priorReach(storage: R2Bucket, work: PurgeWork, tenant: string, builtFrom: number, builtTo: number): Promise<{ from: number; to: number } | 'serving' | null> {
  const root = `lift/${tenant}/`, brands: string[] = [];
  let from = Infinity, to = builtTo;
  await eachListed(storage, work, { prefix: root, delimiter: '/' }, page => { brands.push(...page.delimitedPrefixes); });
  for (const brand of brands) {
    const placements: string[] = [];
    await eachListed(storage, work, { prefix: brand, delimiter: '/' }, page => { placements.push(...page.delimitedPrefixes); });
    for (const placement of placements) {
      const built = await versionAbove(storage, work, placement, builtFrom - 1);
      if (built === null || built > builtTo) continue;
      const after = await versionAbove(storage, work, placement, builtTo);
      if (after === null) return 'serving';
      from = Math.min(from, built); to = Math.max(to, after);
    }
  }
  return from === Infinity ? null : { from, to };
}
/**
 * The smallest archived snapshot version above `t` in one placement's archive.
 * Versions are millisecond times, 13 digits wide from 2001 to 2286, and key
 * order is numeric order among keys of one width: from a 13-digit `t` the
 * listing starts after it and stops at the first 13-digit version above it.
 * Any other `t` reads the whole archive listing.
 */
async function versionAbove(storage: R2Bucket, work: PurgeWork, placement: string, t: number): Promise<number | null> {
  const ordered = t >= 1e12 && t < 1e13 - 1;
  let found: number | null = null;
  await eachListed(storage, work, ordered ? { prefix: placement, startAfter: placement + String(t) } : { prefix: placement }, page => {
    for (const { key } of page.objects) {
      const m = /^(0|[1-9][0-9]*)\.json$/.exec(key.slice(placement.length)), v = m ? Number(m[1]) : NaN;
      if (!integer(v) || v <= t) continue;
      found = found === null ? v : Math.min(found, v);
      if (ordered && m![1]!.length === 13) return true;
    }
  });
  return found;
}

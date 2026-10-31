// src/connectors/AudienceStore.ts
// The small persistence seam shared by SegmentProvider (reads) and
// AudienceAuthoring (writes). Because both mock adapters point at the same store,
// an audience created by Opal is immediately qualifiable by ODP — no redeploy.
// See docs/architecture/05-demo-build-spec.md §1.5.
//
// P105 (E30): a tenant's published audiences are one document, the optional
// `audiences` member of its configuration publication (src/config/publication.ts).
// Every qualification reads it through the pin the operation already holds, so an
// action reads no audience while the publication is unchanged and the isolate holds
// it, and one storage read after a change or on a new isolate, at any number of
// audiences. Every publish, archive, rename, pin and seed is one set publication of
// the member (compare-and-swap on the head, a conflict retried, bounded), and the
// per-audience KV record is written with it, so `get(key)` still resolves an
// archived audience. A tenant whose set has no member yet (the sealed set's own
// statement) is read from its KV records until its first audience write, or the
// five-minute run (`moveAudiences`), creates the member from them. A tenant with no
// publication at all (no STORAGE binding, or a head storage says does not exist)
// keeps its KV records. A publication that exists and cannot be read fails the read:
// it never falls back to KV.
//
// R-P713 (AL4): the run's move is made within the run's budget and resumes across runs.
// The member is published whole or not at all: the records the run has read so far, and
// the key it stopped after, are the move's progress, one KV record of the store's own
// (`MOVE_KEY`, under the tenant), and every reader and every write keeps base's KV path
// until the member exists. A tenant whose set cannot fit the member's bound is not moved:
// its refusal is stored by name with the size measured (in that record, or in the member
// where one exists), its reads and writes stay base's KV path (the operator's publish
// answers 200, never 413), and the run tries the move again only when the list shows its
// records changed (their count, names or metadata), never at full cost every run.
//
// R-P727 (AL4; the design note S53/builder-p105/DESIGN-r725.md): only writes put audience
// records, and the five-minute run never puts or deletes one (I1): KV has no
// compare-and-swap and a read can be up to 60 s stale, so any put by the run could
// overwrite a write answered 200. Each write of this release puts its content's digest
// as the record's KV metadata (I2: `_seal`, carried or on base's KV path; `archived` for
// an archive), so a list tells the run, with no get, every record this release wrote; an
// earlier release's put carries none, so KV keeps every write (I3). The member dates the
// records without reading KV (I4): an entry the run took from KV is its own `seen`; a
// carried commit notes `+` what the run last took for that key, and when. The run adopts a
// record only when it is newer by construction, or seen unchanged beside the same entry
// 60 s apart (I5), and a get counts only where it agrees with its listing (I6).
//
// R-P730 (the design note's addendum r730): a carried write puts its KV records inside its
// set publication, after the head holds its intent and before the set is finished
// (`reserved`), so a put that fails fails the write with nothing committed, and a committed
// write's KV record is never older than its commit; a `+` note therefore refuses the record
// it replaced only within KV's 60 s staleness bound, and a body mark that dates a record
// newer is honoured before any note. A record no write of this release touched costs one metered get per pass
// of the run's cursor (`RECONCILE_KEY`), until this release writes it. A write on base's
// KV path fences itself (`fenceKey`, object storage, compare-and-swap) and, if the member
// was created while it wrote, carries itself into it before it answers; a move reads the
// fence before and after it publishes, so no write it missed stays out of the member.

import type { Env } from '@/types/env';
import type { AudienceDef } from './types';
import { DEFAULT_TENANT, TenantKV, type KVLike, type TenantId } from '@/tenancy/tenant';
import { ownerBindingIdentity } from '@/identity/sessionAuthority';
import type { DocumentKind } from '@/config/versionedStore';
import { documentBytes, nameServingStorage, PUBLICATION_MAX_BYTES, PublicationError, pinPublication, publicationStatus, publishSet, readOptionalPinnedPublication, recoverPublication, type PublicationPin } from '@/config/publication';

/**
 * R-P713: the refusal of the move, by name: the tenant's set cannot fit the member's bound.
 * `bytes` is the size measured against `limit`; `records` the tenant's KV records as the
 * list showed them (how many, and the digest of their names and metadata), so the run
 * tries the move again only when they change.
 */
export interface MoveRefusal { phase: 'refused'; reason: 'document_too_large'; member: 'audiences'; bytes: number; limit: number; records: RecordsListed }
/** The tenant's KV records as the list shows them: their count, and the digest of their names and metadata. */
export interface RecordsListed { keys: number; digest: string }

/**
 * The member's value: every published audience of the tenant, by key, each once; and the
 * reconciliation's ledger by audience key (a `Note`), present only when not empty.
 * R-P722: a member carrying `move` is the refusal of a tenant whose set outgrew the bound
 * after it was moved; it is nobody's set, and every reader keeps base's KV path.
 */
export interface AudiencesDocument { version: 1; audiences: AudienceDef[]; ledger?: Record<string, string>; move?: MoveRefusal }

function validRefusal(candidate: unknown): candidate is MoveRefusal {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return false;
  const v = candidate as Record<string, unknown>, records = v.records as Record<string, unknown> | null | undefined;
  return v.phase === 'refused' && v.reason === 'document_too_large' && v.member === 'audiences' && Object.keys(v).length === 6
    && Number.isSafeInteger(v.bytes) && (v.bytes as number) >= 0 && Number.isSafeInteger(v.limit) && (v.limit as number) > 0
    && !!records && typeof records === 'object' && !Array.isArray(records) && Object.keys(records).length === 2
    && Number.isSafeInteger(records.keys) && (records.keys as number) >= 0 && typeof records.digest === 'string';
}
function validateAudiences(candidate: unknown): { ok: true; value: AudiencesDocument } | { ok: false; errors: string[] } {
  const doc = candidate as Partial<AudiencesDocument> | null;
  if (!doc || typeof doc !== 'object' || doc.version !== 1 || !Array.isArray(doc.audiences)) return { ok: false, errors: ['audiences: { version: 1, audiences: [] } required'] };
  const errors: string[] = [], seen = new Set<string>();
  for (const [i, a] of doc.audiences.entries()) {
    if (!a || typeof a !== 'object' || typeof a.key !== 'string' || !a.key || seen.has(a.key)) errors.push(`audiences[${i}].key`);
    else seen.add(a.key);
    if (a?.status !== 'published') errors.push(`audiences[${i}].status`);
    if (!a?.conditions || typeof a.conditions !== 'object') errors.push(`audiences[${i}].conditions`);
  }
  const ledger = doc.ledger as unknown;
  if (ledger !== undefined && (!ledger || typeof ledger !== 'object' || Array.isArray(ledger) || Object.values(ledger).some(note => typeof note !== 'string'))) errors.push('ledger');
  const move = doc.move as unknown;
  if (move !== undefined && (!validRefusal(move) || doc.audiences.length)) errors.push('move');
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: documentOf([...doc.audiences].sort((x, y) => x.key < y.key ? -1 : x.key > y.key ? 1 : 0), (ledger ?? {}) as Record<string, string>, move as MoveRefusal | undefined) };
}
/** The member's document, its ledger's keys in order and the ledger left out when empty; a refusal carried only where there is one. */
function documentOf(audiences: AudienceDef[], ledger: Readonly<Record<string, string>>, move?: MoveRefusal): AudiencesDocument {
  const keys = Object.keys(ledger).sort();
  const doc: AudiencesDocument = keys.length ? { version: 1, audiences, ledger: Object.fromEntries(keys.map(key => [key, ledger[key]])) } : { version: 1, audiences };
  if (move) doc.move = move;
  return doc;
}
/** The publication kind of the tenant's published audiences (publication.ts KINDS, OPTIONAL_MEMBERS, kindFor). */
export const AUDIENCES_KIND: DocumentKind<AudiencesDocument> = { name: 'audiences', publication: 'r2', validate: validateAudiences, versionOf: () => '' };
/** The member as the tenant's set, or null where there is none or it carries the refusal (R-P722): the tenant is then not moved. */
const movedMember = (doc: AudiencesDocument | null | undefined): AudiencesDocument | null => doc && !doc.move ? doc : null;

/**
 * Lane E4, kept only on the path of a tenant not yet moved into its publication:
 * its published audiences, remembered by this isolate for AUDIENCE_LIST_MS per
 * backing KV binding (`ownerBindingIdentity`) and tenant. A write through any store
 * of this isolate forgets it at once. A moved tenant never reads it.
 */
export const AUDIENCE_LIST_MS = 10_000;
interface Listed { at: number; defs: AudienceDef[] }
let listed = new WeakMap<object, { lists: Map<string, Listed>; writes: Map<string, number> }>();
/** Tests: forget every remembered list. */
export function forgetListedAudiences(): void { listed = new WeakMap(); }

/** One change of a batched write (`apply`). */
export type AudienceChange = { op: 'publish'; def: AudienceDef } | { op: 'archive'; key: string };

export interface AudienceStore {
  /** `administrative`: the operator's own list, read through a pin of its own (the head read every time). */
  listPublished(options?: { administrative?: boolean }): Promise<AudienceDef[]>;
  publish(def: AudienceDef): Promise<void>;
  get(key: string): Promise<AudienceDef | null>;
  /** Load Coach launch audiences at boot (idempotent — won't clobber runtime-created ones). */
  seed(defs: AudienceDef[]): Promise<void>;
  /** Retire an audience (e.g. its catalog value disappeared) — drops out of qualification. */
  archive(key: string): Promise<void>;
  /**
   * The three human verbs the scope appendix §1.2 promises: "Your team renames,
   * pins, or prunes anything the engine proposes." The generator has always
   * honoured the RESULT of these (audienceGenerator.ts:193 skips pinned,
   * :197 skips human-edited); nothing could perform them.
   */
  rename(key: string, name: string, description?: string): Promise<AudienceDef | null>;
  setPinned(key: string, pinned: boolean): Promise<AudienceDef | null>;
  /** P105: several publishes and archives as one write (the demo's regeneration: one publication per pass). */
  apply?(changes: AudienceChange[]): Promise<void>;
}

const PREFIX = 'audience:';
const memberKey = (tenant: string) => 'audiences:' + tenant;
/** The audience key a listed KV name carries. */
const keyOf = (name: string) => name.slice(PREFIX.length);
/**
 * R-P713: the move's progress, one KV record of the store's own under the tenant (never
 * listed with the audience records: it does not carry their prefix): the records the run
 * has read so far and the key it stopped after, or the refusal of a set that cannot fit
 * the member. Spent once the member exists.
 */
const MOVE_KEY = 'audiences-move';
/** Set publications attempted before a write gives up on a head that keeps moving. */
const ATTEMPTS = 8;
/** No publication at all: no STORAGE binding. */
const hasStorage = (env: Env) => {
  try { const s = env.STORAGE as unknown as { get?: unknown } | undefined; return !!s && typeof s.get === 'function'; } catch { return false; }
};
/** A head storage says does not exist, or an initialization still pending: the tenant has no publication yet. */
const uninitialized = (error: unknown) => error instanceof PublicationError && error.code === 'publication_uninitialized';
/** The publication refused the member past its 2 MiB bound. */
const tooLarge = (error: unknown) => error instanceof PublicationError && error.status === 413;

/** Canonical text of a JSON value (keys in order, undefined left out as JSON leaves it out). */
const canonical = (v: unknown): string => {
  if (Array.isArray(v)) return '[' + v.map(item => item === undefined ? 'null' : canonical(item)).join(',') + ']';
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return '{' + Object.keys(o).filter(k => o[k] !== undefined).sort().map(k => JSON.stringify(k) + ':' + canonical(o[k])).join(',') + '}';
  }
  return JSON.stringify(v) ?? 'null';
};
/** A 53-bit digest (cyrb53) of a value's canonical text, in base 36. */
function digestOf(v: unknown): string {
  const text = canonical(v);
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) { const c = text.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}


/**
 * R-P727 (I2): the KV metadata this release's writes put on an audience record, and only writes put it: the digest of
 * the record's content (`_seal`), and `archived` for an archive, the same whether the member carries the write or it
 * stays on base's KV path (R-P730 (f): no decision ever told the two apart). A list returns it with the key's name, so
 * the run knows every record this release wrote without a get. An earlier release's put carries none (Workers KV clears
 * it). A record the member carries keeps `_seal` in its own text too (`marked`), which an earlier release's rename, pin
 * or prune spreads, broken; a KV-path record keeps base's text.
 */
const MARK = '_seal', ARCHIVED = 'archived';
type StoredRecord = AudienceDef & { [MARK]?: unknown };
/** A key as the list returns it: its name under the tenant, and the metadata its last put carried. */
interface ListedKey { name: string; metadata?: unknown }
/** A record without this release's mark: what readers and the member see. */
function unmarked(record: StoredRecord): AudienceDef {
  if (!Object.hasOwn(record, MARK)) return record;
  const plain: StoredRecord = { ...record };
  delete plain[MARK];
  return plain;
}
function metadataOf(plain: AudienceDef): Record<string, string> {
  const metadata: Record<string, string> = { [MARK]: digestOf(plain) };
  if (plain.status === 'archived') metadata[ARCHIVED] = '1';
  return metadata;
}
/** The KV text this release writes for a definition the member carries (the definition and its mark), and its metadata. */
function marked(def: AudienceDef): { text: string; options: { metadata: Record<string, string> } } {
  const plain = unmarked(def), metadata = metadataOf(plain);
  return { text: JSON.stringify({ ...plain, [MARK]: metadata[MARK] }), options: { metadata } };
}
/** The KV text this release writes on base's KV path (as an earlier release wrote it, no mark in its text), its digest as metadata. */
function plainWrite(def: AudienceDef): { text: string; options: { metadata: Record<string, string> } } {
  const plain = unmarked(def);
  return { text: JSON.stringify(plain), options: { metadata: metadataOf(plain) } };
}
/** What a listed key's metadata says: this release's put (its content's digest, an archive or not), or none (`own` false). */
interface ListedPut { own: boolean; digest: string; archived: boolean }
function putOf(key: ListedKey): ListedPut {
  const metadata = key.metadata as Record<string, unknown> | null | undefined;
  if (metadata && typeof metadata === 'object' && typeof metadata[MARK] === 'string') return { own: true, digest: metadata[MARK] as string, archived: metadata[ARCHIVED] === '1' };
  return { own: false, digest: '', archived: false };
}
/** A record carrying its own mark: this release wrote it, after the commit that carried it. */
const isOwn = (record: StoredRecord): boolean => typeof record[MARK] === 'string' && record[MARK] === digestOf(unmarked(record));
/** R-P727 (I6): a read counts only where it agrees with its listing: a record listed with this release's metadata must have that digest. */
const agrees = (key: ListedKey, record: StoredRecord | null): boolean => {
  const put = putOf(key);
  return !put.own || (!!record && digestOf(unmarked(record)) === put.digest);
};
const validRecord = (record: unknown): record is StoredRecord => !!record && typeof record === 'object' && typeof (record as AudienceDef).key === 'string';
/** The tenant's records as the list shows them (every key, or those at or before `upTo`): what a run compares to see them changed. */
const recordsOf = (keys: readonly ListedKey[], upTo?: string): RecordsListed => {
  const named = upTo === undefined ? keys : keys.filter(key => keyOf(key.name) <= upTo);
  return { keys: named.length, digest: digestOf(named.map(key => [key.name, key.metadata ?? null])) };
};
const sameRecords = (a: RecordsListed, b: RecordsListed): boolean => a.keys === b.keys && a.digest === b.digest;
/** The list as it will read once the named records' metadata is written: each one's entry replaced (or added), in key order. */
const withMetadata = (keys: readonly ListedKey[], written: ReadonlyArray<[string, Record<string, string>]>): ListedKey[] => {
  const byName = new Map(keys.map(key => [key.name, key] as const));
  for (const [key, metadata] of written) byName.set(PREFIX + key, { name: PREFIX + key, metadata });
  return [...byName.values()].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
};
/** The refusal of the move, by name, with the size measured and the records it was measured on. */
const refusalOf = (bytes: number, keys: readonly ListedKey[]): MoveRefusal =>
  ({ phase: 'refused', reason: 'document_too_large', member: 'audiences', bytes, limit: PUBLICATION_MAX_BYTES, records: recordsOf(keys) });
/** Whether the member says what these records say: each published one held as it is, each archived one not held. */
const reflects = (doc: AudiencesDocument, records: ReadonlyArray<readonly [string, AudienceDef]>): boolean => {
  const byKey = new Map(doc.audiences.map(a => [a.key, a] as const));
  return records.every(([key, def]) => def.status === 'archived' ? !byKey.has(key) : byKey.has(key) && canonical(byKey.get(key)) === canonical(unmarked(def)));
};

/**
 * R-P713: the move's progress (`MOVE_KEY`). `moving`: the published records the run has
 * read so far, in key order, the audience key it stopped `after`, and (R-P722) the records
 * at or before it as the list showed them (`behind`), so a later run restarts the move
 * where a write landed behind the cursor. `refused`: the refusal, where no member exists.
 * It holds nothing a reader serves: lost, stale or overwritten, it makes a run re-read, never skip (R-P727).
 */
type MoveProgress =
  | { version: 1; phase: 'moving'; after: string; behind: RecordsListed; audiences: AudienceDef[] }
  | ({ version: 1 } & MoveRefusal);
/** The progress record as stored, or null where there is none or it cannot be read (the move then starts over). */
function progressOf(raw: unknown): MoveProgress | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const v = raw as Record<string, unknown>;
  if (v.version !== 1) return null;
  if (v.phase === 'moving') {
    const behind = v.behind as Record<string, unknown> | null | undefined;
    if (typeof v.after !== 'string' || !Array.isArray(v.audiences) || !behind || typeof behind !== 'object' || !Number.isSafeInteger(behind.keys) || typeof behind.digest !== 'string') return null;
    return { version: 1, phase: 'moving', after: v.after, behind: { keys: behind.keys as number, digest: behind.digest },
      audiences: (v.audiences as unknown[]).filter((a): a is AudienceDef => !!a && typeof a === 'object' && typeof (a as AudienceDef).key === 'string') };
  }
  const rest: Record<string, unknown> = { ...v }; delete rest.version;
  return validRefusal(rest) ? { version: 1, ...rest } : null;
}

/**
 * R-P727 (I4): the ledger's note on one audience, as text `+<seen>` or `=<seen>`, then `?<record>@<entry>@<time>`.
 * `authored`: a carried commit of this release changed the entry after the run last took that key from KV; it holds
 * the digest of what the run had taken ('' for nothing), so no record this release wrote before the commit (a KV-path
 * write, an older put) is adopted over it. `seen`: the run took an archived record of a key the member does not hold.
 * Where neither is noted, the entry itself is what the run took. `pending`: a record the run found and could not date
 * yet, the entry it found it beside, and when.
 */
interface Note { authored?: string; authoredAt?: number; seen?: string; pending?: { record: string; entry: string; at: number } }
const AUTHORED = '+', SEEN = '=', PENDING = '?';
function noteOf(text: string | undefined): Note {
  if (text === undefined) return {};
  const at = text.indexOf(PENDING), head = at < 0 ? text : text.slice(0, at), note: Note = {};
  if (head.startsWith(AUTHORED)) {
    // R-P730 (b): `+<seen>,<time of the commit>`; a note with no time is past its window.
    const body = head.slice(1), comma = body.indexOf(','), when = comma < 0 ? 0 : Number(body.slice(comma + 1));
    note.authored = comma < 0 ? body : body.slice(0, comma);
    note.authoredAt = Number.isFinite(when) ? when : 0;
  } else if (head.startsWith(SEEN)) note.seen = head.slice(1);
  if (at >= 0) {
    const [record = '', entry = '', time = ''] = text.slice(at + 1).split('@'), when = Number(time);
    if (record && time && Number.isFinite(when)) note.pending = { record, entry, at: when };
  }
  return note;
}
function setNote(ledger: Record<string, string>, key: string, note: Note): void {
  const head = note.authored !== undefined ? `${AUTHORED}${note.authored},${note.authoredAt ?? 0}` : note.seen !== undefined ? SEEN + note.seen : '';
  const text = head + (note.pending ? `${PENDING}${note.pending.record}@${note.pending.entry}@${note.pending.at}` : '');
  if (text) ledger[key] = text; else delete ledger[key];
}
/**
 * R-P727 (I4): a carried commit of this release changes `key`'s entry (`replaced`, absent for a new key): it notes what
 * the run last took from KV for that key, from the member alone (no KV read): an existing note's, else the entry it
 * replaces, and (R-P730 (b)) when it committed. A key the member never held nor noted needs none: no record of it was
 * taken, so none can be taken back over the commit but on a second sighting (I5), and the member's bound is not spent
 * on new keys. A pending note goes.
 */
function author(ledger: Record<string, string>, key: string, replaced: AudienceDef | undefined, now: number): void {
  const note = noteOf(ledger[key]), authored = note.authored ?? (replaced ? digestOf(replaced) : note.seen);
  setNote(ledger, key, authored === undefined ? {} : { authored, authoredAt: now });
}

/** R-P727 (I5): a record seen again unchanged beside the same entry is adopted only this long after it was first seen (KV's staleness bound). */
const SIGHTING_MS = 60_000;
/**
 * R-P730 (b): a `+` note refuses only within KV's staleness bound of its commit. The commit's KV records were put
 * before it (R-P730 (a)), so past that bound no read can show a record older than the commit, and a record that differs
 * is a later write, judged as if no note were there.
 */
const noteHolds = (note: Note, now: number): boolean => note.authored !== undefined && now - (note.authoredAt ?? 0) < SIGHTING_MS;
/**
 * R-P727: what the run does with one listed key of a moved tenant, from the list alone: `nothing`; `clear` (its
 * `+`/`=` note can go: the list shows this release's put saying what the member says); `read` (a get, under I6 and
 * I5); `legacy` (no metadata: an earlier release's put, read on the cursor's pass).
 */
function classify(byKey: ReadonlyMap<string, AudienceDef>, ledger: Readonly<Record<string, string>>, key: ListedKey, now: number): 'nothing' | 'clear' | 'read' | 'legacy' {
  const put = putOf(key);
  if (!put.own) return 'legacy';
  const k = keyOf(key.name), held = byKey.get(k), note = noteOf(ledger[k]);
  const says = put.archived ? held === undefined : held !== undefined && digestOf(held) === put.digest;
  if (says) return note.authored !== undefined || note.seen !== undefined ? 'clear' : 'nothing';
  // A carried commit of this release within KV's staleness bound: this put is older, or a stale read of one (I5, R-P730 (b)).
  if (noteHolds(note, now)) return 'nothing';
  return 'read';
}
/** R-P727 (I5): one record read for a moved tenant, judged against the member's entry and note: adopted, noted pending, or left. */
function judge(held: AudienceDef | undefined, note: Note, record: StoredRecord, now: number): { adopt: boolean; pending?: Note['pending'] } {
  const plain = unmarked(record), archived = plain.status === 'archived', print = digestOf(plain);
  if (archived ? held === undefined : held !== undefined && canonical(held) === canonical(plain)) return { adopt: false };
  const entry = held ? digestOf(held) : '', mark = record[MARK];
  // Newer by construction, before any note's refusal (R-P730 (d)): a broken body mark equal to the entry's digest (an
  // earlier release spread the very record this release wrote for that version, after its put).
  if (held && typeof mark === 'string' && mark === entry && !isOwn(record)) return { adopt: true };
  // The record a carried commit replaced, within KV's staleness bound of the commit (R-P730 (b)); what the run took.
  if ((noteHolds(note, now) && print === note.authored) || print === note.seen) return { adopt: false };
  // Newer by construction: a key the member never held nor noted (nothing to revert).
  if (!held && !archived && note.authored === undefined && note.seen === undefined && !note.pending) return { adopt: true };
  // Otherwise a second sighting, unchanged beside the same entry, at least SIGHTING_MS after the first.
  const pending = note.pending;
  if (pending && pending.record === print && pending.entry === entry) return { adopt: now - pending.at >= SIGHTING_MS };
  return { adopt: false, pending: { record: print, entry, at: now } };
}

/**
 * R-P727: the KV-path writes a move must not miss, in object storage (strongly consistent, compare-and-swap): each
 * KV-path write records its records here after its KV put and before it looks for the member; a move reads it before
 * it publishes (a write younger than KV's staleness bound must show in its list) and after (a write it missed is
 * carried into the member). Entries older than FENCE_KEEP_MS are visible to every list and are pruned by the next write.
 */
interface FenceEntry { record: AudienceDef; at: number }
interface Fence { version: 1; writes: Record<string, FenceEntry> }
interface FenceRead { fence: Fence; etag: string | null }
const fenceKey = (tenant: string) => `audiences-fence/v1/${tenant}.json`;
/** KV's staleness bound: a write's put older than this shows in every list. */
const FENCE_SHOWN_MS = 60_000;
const FENCE_KEEP_MS = 600_000;
function fenceOf(raw: unknown): Fence {
  const writes: Record<string, FenceEntry> = {};
  const held = (raw as { writes?: unknown } | null)?.writes;
  if (held && typeof held === 'object' && !Array.isArray(held)) {
    for (const [key, entry] of Object.entries(held as Record<string, unknown>)) {
      const e = entry as Partial<FenceEntry> | null;
      if (e && validRecord(e.record) && Number.isFinite(e.at)) writes[key] = { record: unmarked(e.record), at: e.at as number };
    }
  }
  return { version: 1, writes };
}
/** The fenced writes younger than KV's staleness bound that this list does not show with the digest they put. */
function unshownFenced(read: FenceRead, keys: readonly ListedKey[], now: number): Set<string> {
  const byName = new Map(keys.map(key => [key.name, key] as const)), unshown = new Set<string>();
  for (const [key, entry] of Object.entries(read.fence.writes)) {
    if (!(now - entry.at < FENCE_SHOWN_MS)) continue;
    const listedKey = byName.get(PREFIX + key);
    if (!listedKey || putOf(listedKey).digest !== digestOf(entry.record)) unshown.add(key);
  }
  return unshown;
}
/** The member's document with these fenced writes in it: each published record held as written, each archived one not held. */
function withFenced(doc: AudiencesDocument, entries: ReadonlyArray<readonly [string, FenceEntry]>): AudiencesDocument {
  const byKey = new Map(doc.audiences.map(a => [a.key, a] as const));
  for (const [key, entry] of entries) { if (entry.record.status === 'archived') byKey.delete(key); else byKey.set(key, entry.record); }
  return documentOf([...byKey.values()].sort((x, y) => x.key < y.key ? -1 : x.key > y.key ? 1 : 0), doc.ledger ?? {});
}
/** The fenced writes in `after` that `before` did not hold, and those `before` held that its list did not show (`unshown`). */
function fencedSince(before: FenceRead | null, after: FenceRead, unshown: ReadonlySet<string>): Array<[string, FenceEntry]> {
  return Object.entries(after.fence.writes).filter(([key, entry]) => {
    const was = before?.fence.writes[key];
    return unshown.has(key) || !was || was.at !== entry.at || canonical(was.record) !== canonical(entry.record);
  }).sort((a, b) => a[1].at - b[1].at);
}

/** A write's set publication, as `mutate` answers it: `carried`, the member carries the write; else the write stays on base's KV path (`publication`: the tenant has one), and `refused` holds the size and the list this write measured over the bound. */
interface Mutated { carried: boolean; publication: boolean; written?: Array<[string, AudienceDef]>; refused?: { bytes: number; listed: ListedKey[] } }
/** A write's change of the member: the next document, or null for none. */
type Change = (current: AudiencesDocument) => AudiencesDocument | null;
/** An object-storage binding as the fence uses it. */
interface FenceStorage {
  get(key: string): Promise<{ etag: string; json(): Promise<unknown> } | null>;
  put(key: string, value: string, options?: unknown): Promise<unknown>;
}

/**
 * R-P713: one step of the move, before the member exists: every record read joins the records being moved
 * (published) or stays out of them (archived), as the unmoved read answers it; no member is anybody's authority yet,
 * so nothing is dated here.
 */
function moveInto(doc: AudiencesDocument, stored: readonly StoredRecord[]): AudiencesDocument {
  const byKey = new Map(doc.audiences.map(a => [a.key, a] as const));
  for (const record of stored) {
    const plain = unmarked(record);
    if (plain.status === 'archived') byKey.delete(plain.key); else byKey.set(plain.key, plain);
  }
  return documentOf([...byKey.values()].sort((x, y) => x.key < y.key ? -1 : x.key > y.key ? 1 : 0), doc.ledger ?? {});
}

/** The run-only record of the reconciliation's cursor over the records no write of this release touched (R-P727). */
const RECONCILE_KEY = 'audiences-reconcile';
/** Clearable notes the run lets wait for its next publication before it publishes for them alone. */
const NOTE_SWEEP = 64;

export class KvAudienceStore implements AudienceStore {
  /**
   * KV scoped to one brand (CW1). The default tenant's keys are unprefixed, so
   * an existing `new KvAudienceStore(env)` reads and writes exactly the keys it
   * always did; a second brand cannot see them and they cannot see it.
   *
   * NOT the same axis as the demo-surface prefix in @/demos/registry. That
   * namespaces the audience KEY ('' for coach, 'bh_' for brighthour) to keep two
   * demos apart inside one store; this namespaces the KV key to keep two
   * customers apart. Surfaces are pseudo-tenants and should eventually become
   * real ones, but converging them now would break both demos for no gain.
   */
  private readonly kv: KVLike;
  /** Lane E4: this isolate's remembered lists for the backing binding (unmoved tenants only), or null where none can be kept. */
  private readonly memory: { lists: Map<string, Listed>; writes: Map<string, number> } | null;

  constructor(private env: Env, readonly tenant: TenantId = DEFAULT_TENANT) {
    this.kv = new TenantKV(env.CACHE as unknown as KVLike, tenant);
    const binding = ownerBindingIdentity(env.CACHE as unknown as object | undefined);
    let memory = binding ? listed.get(binding) : undefined;
    if (binding && !memory) { memory = { lists: new Map(), writes: new Map() }; listed.set(binding, memory); }
    this.memory = memory ?? null;
  }

  /**
   * The member, read through the operation's own pin (the publication's serving
   * cache), or null where the tenant is not moved: no publication, a set with no
   * audiences member, or a member carrying the refusal (R-P722). The entries are the
   * publication's frozen revision, never a copy.
   */
  private async fromPublication(administrative = false): Promise<readonly AudienceDef[] | null> {
    if (!hasStorage(this.env)) return null;
    let pin: PublicationPin;
    try { pin = await pinPublication(this.env, this.tenant, !administrative); } catch (error) { if (uninitialized(error)) return null; throw error; }
    const revision = await readOptionalPinnedPublication(this.env, AUDIENCES_KIND, this.tenant, pin);
    return movedMember(revision?.value)?.audiences ?? null;
  }

  async listPublished(options: { administrative?: boolean } = {}): Promise<AudienceDef[]> {
    const carried = await this.fromPublication(options.administrative === true);
    if (carried) return carried as AudienceDef[];
    return this.unmovedList();
  }

  /** An unmoved tenant: every page of its records, the gets together; remembered as lane E4 remembered it. */
  private async unmovedList(): Promise<AudienceDef[]> {
    const held = this.memory?.lists.get(this.tenant), started = Date.now();
    if (held && Number.isFinite(started) && started >= held.at && started - held.at < AUDIENCE_LIST_MS) return structuredClone(held.defs);
    const writes = this.memory?.writes.get(this.tenant) ?? 0;
    const defs = (await this.records()).filter(def => def.status === 'published');
    // Remembered only when no write through this isolate landed while it was being read.
    if (this.memory && (this.memory.writes.get(this.tenant) ?? 0) === writes) this.memory.lists.set(this.tenant, { at: started, defs: structuredClone(defs) });
    return defs;
  }

  /** Every key of the tenant's KV records, in key order, with the metadata the list returns: every page of the list followed. */
  private async listedKeys(): Promise<ListedKey[]> {
    const keys: ListedKey[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.kv.list({ prefix: PREFIX, ...(cursor ? { cursor } : {}) }) as { keys: ListedKey[]; list_complete?: boolean; cursor?: string };
      keys.push(...page.keys);
      cursor = page.list_complete === false && page.cursor ? page.cursor : undefined;
    } while (cursor);
    return keys.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  }

  /** The records under these names as stored (the mark kept), in the names' order (null where none), every get issued at once. */
  private async readEach(names: readonly string[]): Promise<Array<StoredRecord | null>> {
    const read = await Promise.all(names.map(name => this.kv.get(name, 'json') as Promise<unknown>));
    return read.map(record => validRecord(record) ? record : null);
  }

  /** Every KV record of the tenant, without this release's mark: every page of the list followed, then every get issued at once. */
  private async records(): Promise<AudienceDef[]> {
    const keys = await this.listedKeys();
    return (await this.readEach(keys.map(k => k.name))).filter((r): r is StoredRecord => r !== null).map(unmarked);
  }

  /** This release's KV write of a record the member carries: its content and its mark, the mark also its metadata. */
  private putMarked(key: string, def: AudienceDef): Promise<void> {
    const { text, options } = marked(def);
    return this.kv.put(PREFIX + key, text, options);
  }
  /** R-P722: this release's KV write on the KV path (the tenant not moved): the record as an earlier release wrote it, its digest as metadata, no mark. */
  private putPlain(key: string, def: AudienceDef): Promise<void> {
    const { text, options } = plainWrite(def);
    return this.kv.put(PREFIX + key, text, options);
  }
  /** The KV write a finished write makes for each of its records: marked where the member carries it, plain where the write stayed on the KV path. */
  private putRecord(carried: boolean, key: string, def: AudienceDef): Promise<void> {
    return carried ? this.putMarked(key, def) : this.putPlain(key, def);
  }
  /**
   * R-P713, R-P722: a write that measured the tenant's set over the bound stores the refusal by name with the size,
   * after its own KV records are written and naming them as a run's list will show them (`plainWrite`'s metadata),
   * so the run tries the move again only when the records change after this write. Best effort: the write stays a
   * KV write either way, and the five-minute run measures and stores the refusal itself.
   */
  private async refuseAfterWrite(refused: { bytes: number; listed: ListedKey[] }, written: ReadonlyArray<[string, AudienceDef]>): Promise<void> {
    const keys = withMetadata(refused.listed, written.map(([key, def]) => [key, plainWrite(def).options.metadata]));
    await this.writeProgress({ version: 1, ...refusalOf(refused.bytes, keys) }).catch(() => undefined);
  }

  /** R-P713: the move's progress record, or null where there is none. */
  private async readProgress(): Promise<MoveProgress | null> {
    return progressOf(await this.kv.get(MOVE_KEY, 'json'));
  }
  private writeProgress(progress: MoveProgress): Promise<void> {
    return this.kv.put(MOVE_KEY, JSON.stringify(progress));
  }
  private clearProgress(): Promise<void> {
    return this.kv.delete(MOVE_KEY);
  }

  /** R-P727: the fence, as object storage holds it now (its etag for the compare-and-swap; none where absent). */
  private async readFence(): Promise<FenceRead> {
    const held = await (this.env.STORAGE as unknown as FenceStorage).get(fenceKey(this.tenant));
    return held ? { fence: fenceOf(await held.json()), etag: held.etag } : { fence: { version: 1, writes: {} }, etag: null };
  }
  /** R-P727: a KV-path write records its records in the fence after its KV put (compare-and-swap, retried), entries past FENCE_KEEP_MS pruned. */
  private async fenceWrites(records: ReadonlyArray<readonly [string, AudienceDef]>): Promise<void> {
    const storage = this.env.STORAGE as unknown as FenceStorage;
    for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
      const read = await this.readFence(), now = Date.now(), writes: Record<string, FenceEntry> = {};
      for (const [key, entry] of Object.entries(read.fence.writes)) if (now - entry.at < FENCE_KEEP_MS) writes[key] = entry;
      for (const [key, def] of records) writes[key] = { record: unmarked(def), at: now };
      const put = await storage.put(fenceKey(this.tenant), JSON.stringify({ version: 1, writes }),
        { onlyIf: read.etag === null ? new Headers({ 'If-None-Match': '*' }) : { etagMatches: read.etag }, httpMetadata: { contentType: 'application/json' } });
      if (put !== null) return;
    }
    throw new PublicationError('The audience write could not record itself for a move in flight; its record is written', 409, 'publication_conflict');
  }
  /**
   * R-P727: a move that published the member carries in every write fenced since it read the fence (`before`) that the
   * member does not say yet: such a write may have looked for the member before it was published. A key a carried
   * commit of this release changed since (its `+` note) keeps the commit. Past the bound, the member is the refusal.
   */
  private async carryFenced(before: FenceRead | null, unshown: ReadonlySet<string> = new Set()): Promise<void> {
    const fresh = fencedSince(before, await this.readFence(), unshown);
    if (!fresh.length) return;
    const measured = { bytes: 0 };
    try {
      await this.commit('audiences: writes fenced during the move', async latest => {
        const member = movedMember(latest);
        if (!member) return null;
        const byKey = new Map(member.audiences.map(a => [a.key, a] as const)), ledger: Record<string, string> = { ...member.ledger };
        let changed = false;
        for (const [key, entry] of fresh) {
          if (noteOf(ledger[key]).authored !== undefined) continue;
          const held = byKey.get(key);
          if (entry.record.status === 'archived') {
            if (held) { byKey.delete(key); setNote(ledger, key, { seen: digestOf(entry.record) }); changed = true; }
          } else if (!held || canonical(held) !== canonical(entry.record)) { byKey.set(key, entry.record); delete ledger[key]; changed = true; }
        }
        if (!changed) return null;
        const next = documentOf([...byKey.values()], ledger);
        measured.bytes = documentBytes(next);
        if (measured.bytes > PUBLICATION_MAX_BYTES) throw new PublicationError('Publication exceeds 2 MiB', 413, 'document_too_large');
        return next;
      });
    } catch (error) {
      if (!tooLarge(error)) throw error;
      await this.demote(measured.bytes);
    }
  }
  /** R-P722: a moved tenant whose set no longer fits the member: the member is published as the refusal, by name with the size, and every reader returns to base's KV path (complete, R-P727 I3). */
  private async demote(bytes: number): Promise<void> {
    const keys = await this.listedKeys();
    await this.commit('audiences: refused', async latest => movedMember(latest) ? documentOf([], {}, refusalOf(bytes, keys)) : null);
  }

  /** Lane E4: a write through this isolate makes its remembered list unusable at once. */
  private written(): void {
    if (!this.memory) return;
    this.memory.writes.set(this.tenant, (this.memory.writes.get(this.tenant) ?? 0) + 1);
    this.memory.lists.delete(this.tenant);
  }

  /**
   * One set publication of the member over the current head: `change` receives the member
   * as committed (null where the set has none; a refusal member as it is) and answers the
   * next document, or null for no change. A conflict on the head is retried from a fresh
   * head, at most ATTEMPTS times. Answers the document published, null where `change` asked
   * for none, or 'no-publication' where the tenant has no publication at all. A member past
   * the publication's 2 MiB bound throws its 413; nothing changes.
   */
  private async commit(note: string, change: (current: AudiencesDocument | null) => Promise<AudiencesDocument | null>, reserved?: () => Promise<void>): Promise<AudiencesDocument | null | 'no-publication'> {
    for (let attempt = 1; ; attempt++) {
      let pin: PublicationPin;
      try { pin = await pinPublication(this.env, this.tenant); } catch (error) { if (uninitialized(error)) return 'no-publication'; throw error; }
      const current = await readOptionalPinnedPublication(this.env, AUDIENCES_KIND, this.tenant, pin);
      const next = await change(current?.value ?? null);
      if (next === null) return null;
      const expected = pin.refs[memberKey(this.tenant)]?.revision ?? 0;
      try {
        const result = await publishSet(this.env, [{ kind: AUDIENCES_KIND as DocumentKind<unknown>, scope: this.tenant, request: { note }, candidate: () => next, ...(reserved ? { reserved } : {}) }],
          { actor: 'audience-store', note, operationId: `${expected}:${crypto.randomUUID()}`, expectedRevision: expected,
            expectedPublication: { revision: pin.revision, digest: pin.digest } });
        if (!result.ok) throw new PublicationError('Invalid audiences: ' + result.errors.join(', '), 422, 'invalid_document');
        return next;
      } catch (error) {
        // R-P733: the head may be held by an audience write whose finish failed; it is finished first, then the publication retried.
        if (error instanceof PublicationError && error.status === 409 && attempt < ATTEMPTS) { await this.finishPending(); continue; }
        throw error;
      }
    }
  }

  /**
   * R-P733: a publication head left pending by an audience write of this release (its reservation held, its KV records
   * put in the reservation, its finish failed) refuses every other publication of the tenant. The next audience write
   * finishes it through the publication's own recovery (`recoverPublication`) when its set publication meets it, before
   * it reserves; the five-minute run finishes it before it plans, whether or not it publishes (R-P736). Finishing
   * commits what the KV records already hold, so the member and KV agree. Only an audience write's operation is finished (the recovery refuses any other kind): exactly the commit its
   * writer reserved. A writer still in flight finds its set committed and answers as committed (its finish accepts a head
   * that already holds its set); were its KV put to fail after that, the record it replaced is taken back by the run,
   * the `+` note bounded to 60 s (R-P730 (b)). Answers whether it finished one.
   */
  private async finishPending(): Promise<boolean> {
    try {
      const status = await publicationStatus(this.env, AUDIENCES_KIND, this.tenant) as {
        state?: string; actor?: string; operationId?: string; expectedRevision?: number; expectedPublication?: { revision: number; digest: string } };
      if (status.state !== 'pending' || status.actor !== 'audience-store' || typeof status.operationId !== 'string' || !Number.isSafeInteger(status.expectedRevision)
        || !status.expectedPublication) return false;
      await recoverPublication(this.env, AUDIENCES_KIND as DocumentKind<unknown>, this.tenant, { actor: 'audience-store', note: 'audiences: a pending write finished',
        operationId: status.operationId, expectedRevision: status.expectedRevision as number, expectedPublication: status.expectedPublication });
      return true;
    } catch (error) {
      // No head yet, a head another kind's operation holds, or one finished meanwhile: nothing of this store's to finish.
      if (error instanceof PublicationError) return false;
      throw error;
    }
  }

  /**
   * A write's set publication of the member: `change` receives the current document (the
   * member, or the KV records where the tenant is not moved yet, which creates the whole
   * member) and answers the next one, or null for no change. A moved tenant's member past
   * the publication's 2 MiB bound is refused 413 `document_too_large` by name and nothing
   * changes. Answers `carried: false` where the write stays a KV write (R-P713): the tenant
   * has no publication, its set cannot fit the member (stored before, or measured by this
   * write), a read of its records disagrees with its listing (R-P727 I6), or a write fenced
   * within KV's staleness bound does not show in its list yet, so no answer differs from base's.
   * `read` receives each record of the unmoved tenant as it was read (its own archive's record).
   *
   * R-P730 (a): the write's KV records (`records`, from the document its change saw), with their metadata, are put in
   * the publication's `reserved` hook: after the head holds the write's intent (its size, conflict and compare-and-swap
   * passed) and before the set is finished. A put that fails abandons the reservation, so nothing is committed and the
   * write fails; a committed write's KV record is never older than its commit. `written` answers the records put there.
   */
  private async mutate(note: string, change: Change, read: Map<string, StoredRecord | null>,
    records: (seen: AudiencesDocument) => Promise<Array<[string, AudienceDef]>>): Promise<Mutated> {
    if (!hasStorage(this.env)) return { carried: false, publication: false };
    let seen: AudiencesDocument | null = null, written: Array<[string, AudienceDef]> | undefined;
    const hook = async (): Promise<void> => {
      const recs = await records(seen ?? { version: 1, audiences: [] });
      await Promise.all(recs.map(([key, def]) => this.putMarked(key, def)));
      written = recs;
    };
    // What the last attempt found on an unmoved tenant: the list that named its records, the progress record, the fence,
    // the whole member it measured, whether it moved the tenant, and whether the write keeps base's KV path.
    const found: { listed: ListedKey[] | null; progress: MoveProgress | null; fence: FenceRead | null; candidate: AudiencesDocument | null; moved: boolean; kvOnly: boolean } =
      { listed: null, progress: null, fence: null, candidate: null, moved: false, kvOnly: false };
    try {
      const outcome = await this.commit(note, async raw => {
        found.listed = null; found.fence = null; found.candidate = null; found.moved = false; found.kvOnly = false;
        const current = movedMember(raw);
        if (current) { seen = current; return change(current); }
        // Not moved. R-P713: a set that cannot fit the member keeps base's KV path; else its records, every page, every get at once, make the whole member.
        if (raw?.move) { found.kvOnly = true; return null; }
        found.progress = await this.readProgress();
        if (found.progress?.phase === 'refused') { found.kvOnly = true; return null; }
        const keys = await this.listedKeys(), records = await this.readEach(keys.map(k => k.name));
        found.listed = keys;
        keys.forEach((key, i) => read.set(keyOf(key.name), records[i] ?? null));
        // R-P727: a read that disagrees with its listing, or a fenced write the list does not show yet: base's KV path for this write.
        if (records.some((record, i) => !agrees(keys[i]!, record))) { found.kvOnly = true; return null; }
        const fence = await this.readFence();
        if (unshownFenced(fence, keys, Date.now()).size) { found.kvOnly = true; return null; }
        found.fence = fence;
        const base: AudiencesDocument = { version: 1, audiences: records.filter((r): r is StoredRecord => r !== null).map(unmarked).filter(def => def.status === 'published') };
        const candidate = change(base) ?? documentOf([...base.audiences], {});
        found.candidate = candidate;
        if (documentBytes(candidate) > PUBLICATION_MAX_BYTES) { found.kvOnly = true; return null; }
        found.moved = true;
        seen = base;
        return candidate;
      }, hook);
      if (outcome === 'no-publication') return { carried: false, publication: false };
      if (!found.kvOnly) {
        if (found.moved) {
          // The member exists now: the move's progress, if any, is spent, and a KV-path write fenced meanwhile is carried in.
          if (found.progress) await this.clearProgress().catch(() => undefined);
          await this.carryFenced(found.fence);
        }
        return { carried: true, publication: true, ...(written ? { written } : {}) };
      }
    } catch (error) {
      if (!tooLarge(error)) throw error;
      if (!found.listed) throw new PublicationError("The tenant's published audiences (the audiences member) would exceed 2 MiB; nothing was changed", 413, 'document_too_large');
    }
    // R-P713: the tenant keeps base's KV path. Where this write measured its set over the bound, the caller stores the refusal
    // by name with the size once its KV records are written, so the records it names are the ones a run lists (R-P722).
    const over = found.listed && found.candidate && documentBytes(found.candidate) > PUBLICATION_MAX_BYTES;
    return { carried: false, publication: true, ...(over ? { refused: { bytes: documentBytes(found.candidate!), listed: found.listed! } } : {}) };
  }

  /**
   * R-P727: a write that stayed on base's KV path, its KV records written: it stores the refusal it measured, records
   * itself in the fence, and then, where the member was created while it wrote, carries itself into the member
   * (compare-and-swap, retried) before it answers, so it is visible at once; past the bound the member is the refusal.
   */
  private async afterKvPath(outcome: Mutated, note: string, change: Change, records: ReadonlyArray<[string, AudienceDef]>): Promise<void> {
    if (outcome.carried || !outcome.publication) return;
    if (outcome.refused) await this.refuseAfterWrite(outcome.refused, records);
    if (!records.length) return;
    await this.fenceWrites(records);
    const measured = { bytes: 0 };
    try {
      await this.commit(note + ' (carried into the member created meanwhile)', async latest => {
        const member = movedMember(latest);
        if (!member || reflects(member, records)) return null;
        const next = change(member);
        if (!next) return null;
        measured.bytes = documentBytes(next);
        if (measured.bytes > PUBLICATION_MAX_BYTES) throw new PublicationError('Publication exceeds 2 MiB', 413, 'document_too_large');
        return next;
      });
    } catch (error) {
      if (!tooLarge(error)) throw error;
      await this.demote(measured.bytes);
    }
  }

  async publish(def: AudienceDef): Promise<void> {
    await this.apply([{ op: 'publish', def }]);
  }

  async get(key: string): Promise<AudienceDef | null> {
    const found = (await this.fromPublication())?.find(a => a.key === key);
    if (found) return structuredClone(found);
    const record = (await this.kv.get(PREFIX + key, 'json')) as StoredRecord | null;
    return record ? unmarked(record) : null;
  }

  async seed(defs: AudienceDef[]): Promise<void> {
    const have = new Set((await this.fromPublication() ?? []).map(a => a.key));
    const records = await Promise.all(defs.map(def => have.has(def.key) ? 'held' : this.kv.get(PREFIX + def.key)));
    const missing = defs.filter((_, i) => !records[i]);
    if (missing.length) await this.apply(missing.map(def => ({ op: 'publish' as const, def })), true);
  }

  /**
   * Several publishes and archives as one set publication, each KV record put inside it
   * before it is finished (marked; R-P730 (a)), or after it where nothing was committed
   * (marked where the tenant is moved, plain where the write stayed on the KV path). `onlyNew`:
   * a publish of a key the member already holds is skipped (the seed). Each audience a
   * commit changes is noted authored (R-P727 I4).
   */
  async apply(changes: AudienceChange[], onlyNew = false): Promise<void> {
    if (!changes.length) return;
    const change: Change = current => {
      const byKey = new Map(current.audiences.map(a => [a.key, a] as const));
      const ledger: Record<string, string> = { ...current.ledger }, now = Date.now();
      let changed = false;
      for (const c of changes) {
        if (c.op === 'publish') {
          if (onlyNew && byKey.has(c.def.key)) continue;
          author(ledger, c.def.key, byKey.get(c.def.key), now); byKey.set(c.def.key, { ...unmarked(c.def), status: 'published' }); changed = true;
        } else if (byKey.has(c.key)) { author(ledger, c.key, byKey.get(c.key), now); byKey.delete(c.key); changed = true; }
      }
      return changed ? documentOf([...byKey.values()], ledger) : null;
    };
    const read = new Map<string, StoredRecord | null>();
    /** Each change's KV record: an archive's from the entry the change removed, else from the records read, else from KV. */
    const recordsFor = async (seen: AudiencesDocument | null): Promise<Array<[string, AudienceDef]>> => {
      const out: Array<[string, AudienceDef]> = [];
      for (const c of changes) {
        if (c.op === 'publish') out.push([c.def.key, { ...unmarked(c.def), status: 'published' }]);
        else {
          const def = seen?.audiences.find(a => a.key === c.key) ?? (read.has(c.key) ? read.get(c.key) : (await this.kv.get(PREFIX + c.key, 'json')) as StoredRecord | null);
          if (def && def.status !== 'archived') out.push([c.key, { ...unmarked(def), status: 'archived' }]);
        }
      }
      return out;
    };
    const note = `audiences: ${changes.length} change(s)`;
    let records: Array<[string, AudienceDef]> = [];
    try {
      const outcome = await this.mutate(note, change, read, recordsFor);
      if (outcome.written) records = outcome.written;
      else { records = await recordsFor(null); await Promise.all(records.map(([key, def]) => this.putRecord(outcome.carried, key, def))); }
      await this.afterKvPath(outcome, note, change, records);
    } finally { this.written(); }
  }

  async archive(key: string): Promise<void> {
    const def = await this.get(key);
    if (!def || def.status === 'archived') return;
    const change: Change = doc => {
      const held = doc.audiences.find(a => a.key === key);
      if (!held) return null;
      const ledger: Record<string, string> = { ...doc.ledger };
      author(ledger, key, held, Date.now());
      return documentOf(doc.audiences.filter(a => a.key !== key), ledger);
    };
    const archived: AudienceDef = { ...def, status: 'archived' };
    try {
      const outcome = await this.mutate('archive ' + key, change, new Map(), async () => [[key, archived]]);
      if (!outcome.written) await this.putRecord(outcome.carried, key, archived);
      await this.afterKvPath(outcome, 'archive ' + key, change, [[key, archived]]);
    } finally { this.written(); }
  }

  /**
   * Rename. The KEY never moves, because it is load-bearing in cookies,
   * stored decisions and ODP qualification: renaming is a label change, not an
   * identity change, and treating it as one would orphan everything already tagged.
   *
   * Nothing here touches generatorHash. It does not need to: hashDef() covers
   * name, description and conditions, so a rename makes the stored def stop
   * hashing to its recorded value, and regeneration reads that as a human edit
   * and leaves the audience alone. The protection is a consequence of the edit
   * rather than a flag someone has to remember to set.
   */
  async rename(key: string, name: string, description?: string): Promise<AudienceDef | null> {
    const def = await this.get(key);
    if (!def) return null;
    const next: AudienceDef = {
      ...def,
      name,
      ...(description === undefined ? {} : { description }),
    };
    await this.replacePublished(next, 'rename ' + key);
    return next;
  }

  /**
   * Pin or unpin. Checked BEFORE the ownership hash during regeneration, so a
   * pinned audience survives even when its content still hashes to the
   * generator's own output — which is the case that matters, because that is
   * exactly an audience a merchandiser wanted kept without changing a word of it.
   */
  async setPinned(key: string, pinned: boolean): Promise<AudienceDef | null> {
    const def = await this.get(key);
    if (!def) return null;
    const next: AudienceDef = { ...def, pinned };
    await this.replacePublished(next, 'pin ' + key);
    return next;
  }

  /** A published audience's entry replaced in the member (an archived one lives in KV only), then its KV record, marked where the member carries it. */
  private async replacePublished(next: AudienceDef, note: string): Promise<void> {
    if (next.status !== 'published') {
      // An archived audience lives in KV only; its record is marked where the tenant is moved, plain where it is not.
      const carried = (await this.fromPublication(true)) !== null;
      try { await this.putRecord(carried, next.key, next); } finally { this.written(); }
      return;
    }
    const change: Change = doc => {
      const held = doc.audiences.find(a => a.key === next.key);
      if (!held) return null;
      const ledger: Record<string, string> = { ...doc.ledger };
      author(ledger, next.key, held, Date.now());
      return documentOf(doc.audiences.map(a => a.key === next.key ? next : a), ledger);
    };
    try {
      const outcome = await this.mutate(note, change, new Map(), async () => [[next.key, next]]);
      if (!outcome.written) await this.putRecord(outcome.carried, next.key, next);
      await this.afterKvPath(outcome, note, change, [[next.key, next]]);
    } finally { this.written(); }
  }

  /**
   * The five-minute run's pass for this tenant: a set with no audiences member gets one
   * from the KV records (every page; `move`); a moved tenant's records newer than the
   * member's entry (an earlier release's writes, a write made on the KV path) are
   * reconciled into it (`reconcileMoved`), one publication, none when nothing is newer.
   * R-P727: the run never puts or deletes an audience record (I1). With `budget`, no call
   * is made past the run's limit, the move's included (R-P713): what a run could not do
   * waits for the next.
   */
  async moveAndReconcile(budget?: { run: RunBudget; capped: { on: boolean } }): Promise<void> {
    if (!hasStorage(this.env)) return;
    if (budget) budget.capped.on = true;
    // R-P736: a head an audience write left pending is finished first, whether or not this run then has anything to
    // publish; its reads and the recovery's writes go through the run's own storage, so they count in its meter.
    await this.finishPending();
    let pin: PublicationPin;
    try { pin = await pinPublication(this.env, this.tenant); } catch (error) { if (uninitialized(error)) return; throw error; }
    const current = (await readOptionalPinnedPublication(this.env, AUDIENCES_KIND, this.tenant, pin))?.value ?? null;
    const member = movedMember(current);
    if (member) await this.reconcileMoved(member, budget?.run);
    else await this.move(current, budget?.run);
  }

  /** R-P727: the reconciliation's cursor over the records no write of this release touched (the key it stopped after), or null. */
  private async readCursor(): Promise<string | null> {
    const raw = await this.kv.get(RECONCILE_KEY, 'json') as { version?: unknown; after?: unknown } | null;
    return raw && raw.version === 1 && typeof raw.after === 'string' ? raw.after : null;
  }

  /**
   * R-P727: the reconciliation of a moved tenant. The list dates every record this release wrote (I2): one saying what
   * the member says costs nothing, and none is read under a carried commit's note (I4). A record of this release that
   * says otherwise is read and judged (I6, I5); a record no write of this release touched (no metadata) is read once per
   * pass of the cursor (`RECONCILE_KEY`, the run's own record), as many as `run` affords, PUBLISH_RESERVE kept. An
   * adoption past the bound publishes the member as the refusal (R-P722). The run puts no audience record (I1).
   */
  private async reconcileMoved(current: AudiencesDocument, run?: RunBudget): Promise<void> {
    const keys = await this.listedKeys(), now = Date.now();
    const byKey = new Map(current.audiences.map(a => [a.key, a] as const)), ledger = current.ledger ?? {};
    const toRead: ListedKey[] = [], legacy: ListedKey[] = [];
    let clearable = 0;
    for (const key of keys) {
      const verdict = classify(byKey, ledger, key, now);
      if (verdict === 'read') toRead.push(key); else if (verdict === 'legacy') legacy.push(key); else if (verdict === 'clear') clearable++;
    }
    let room = run ? run.limit - run.meter.calls - PUBLISH_RESERVE : Infinity;
    const batch = toRead.slice(0, Math.max(0, Math.min(toRead.length, room)));
    room -= batch.length;
    let cursorNext: string | null | undefined;
    if (legacy.length && legacy.length <= room) { batch.push(...legacy); room -= legacy.length; }
    else if (legacy.length && room > 2) {
      // A pass longer than one run: resumed after the key the last run stopped at (a cursor get and a cursor put).
      room -= 2;
      const after = await this.readCursor();
      let start = after === null ? 0 : legacy.findIndex(key => keyOf(key.name) > after);
      if (start < 0) start = 0;
      const slice = legacy.slice(start, start + room);
      batch.push(...slice);
      // The key this pass stopped after, or '' where the pass ended: the next run starts the next pass.
      cursorNext = slice.length && start + slice.length < legacy.length ? keyOf(slice[slice.length - 1]!.name) : '';
    }
    const records = await this.readEach(batch.map(key => key.name));
    const plan = (doc: AudiencesDocument): { next: AudiencesDocument | null; bytes: number } => {
      const held = new Map(doc.audiences.map(a => [a.key, a] as const)), notes: Record<string, string> = { ...doc.ledger };
      let changed = false;
      batch.forEach((key, i) => {
        const record = records[i];
        // I6: a read that disagrees with its listing is stale; nothing is built on it this run.
        if (!record || !agrees(key, record)) return;
        const verdict = classify(held, notes, key, now);
        if (verdict !== 'read' && verdict !== 'legacy') return;
        const k = keyOf(key.name), note = noteOf(notes[k]), judged = judge(held.get(k), note, record, now);
        if (judged.adopt) {
          const plain = unmarked(record);
          if (plain.status === 'archived') { held.delete(k); setNote(notes, k, { seen: digestOf(plain) }); }
          else { held.set(k, plain); delete notes[k]; }
          changed = true;
        } else if (judged.pending) { setNote(notes, k, { ...note, pending: judged.pending }); changed = true; }
      });
      // Notes the list shows spent (this release's put says what the member says) go with a publication, or on their own past NOTE_SWEEP.
      if (changed || clearable >= NOTE_SWEEP) {
        for (const key of keys) if (classify(held, notes, key, now) === 'clear') { delete notes[keyOf(key.name)]; changed = true; }
      }
      if (!changed) return { next: null, bytes: 0 };
      const next = documentOf([...held.values()], notes);
      return { next, bytes: documentBytes(next) };
    };
    let measured = plan(current);
    if (measured.next) {
      try {
        if (measured.bytes > PUBLICATION_MAX_BYTES) throw new PublicationError('Publication exceeds 2 MiB', 413, 'document_too_large');
        await this.commit('reconcile', async latest => {
          const member = movedMember(latest);
          if (!member) return null;
          measured = plan(member);
          if (measured.bytes > PUBLICATION_MAX_BYTES) throw new PublicationError('Publication exceeds 2 MiB', 413, 'document_too_large');
          return measured.next;
        });
      } catch (error) {
        if (!tooLarge(error)) throw error;
        await this.commit('reconcile: refused', async latest => movedMember(latest) ? documentOf([], {}, refusalOf(measured.bytes, keys)) : null);
      }
    }
    if (cursorNext !== undefined) await this.kv.put(RECONCILE_KEY, JSON.stringify({ version: 1, after: cursorNext }));
  }

  /**
   * R-P713: the move, within the run's budget, resumed across runs. The run reads the
   * tenant's records in key order, one get each, as many as the budget affords
   * (PUBLISH_RESERVE kept for one publication or the progress record), after the key the
   * previous run stopped at; the records read so far are the move's progress (`MOVE_KEY`),
   * and the member is published only once every record is in it, so nothing reads a member
   * that is not the tenant's whole set. A set the member cannot carry (past the
   * publication's 2 MiB bound) is refused by name, the size measured and the records it was
   * measured on kept (in the progress record, or in the member where one carries the
   * refusal), so a later run tries again only when the list shows them changed.
   *
   * R-P722: before it publishes, or writes its progress, the run lists the records again
   * and writes nothing if those at or before its cursor changed meanwhile; the progress
   * carries the records behind its cursor as the list showed them, and a run that finds them
   * changed (or a stale progress) restarts the move. R-P727: a read that disagrees with its
   * listing ends the step before it (I6); a write fenced within KV's staleness bound that its
   * list did not show is taken from the fence before it publishes, and every write fenced since
   * it read the fence is carried in after; it publishes only over the member state it started
   * from, and marks nothing.
   */
  private async move(start: AudiencesDocument | null, run?: RunBudget): Promise<void> {
    const refused = start?.move ?? null;
    const keys = await this.listedKeys(), progress = await this.readProgress();
    const refusal = refused ?? (progress?.phase === 'refused' ? progress : null);
    if (refusal && sameRecords(refusal.records, recordsOf(keys))) return;
    // The progress stands only while the records behind its cursor are as it saw them; otherwise the move restarts.
    const standing = progress?.phase === 'moving' && sameRecords(progress.behind, recordsOf(keys, progress.after)) ? progress : null;
    const partial = standing ? standing.audiences : [], after = standing ? standing.after : null;
    const held = new Set(partial.map(a => a.key));
    const candidates = keys.filter(key => (after === null || keyOf(key.name) > after) && !held.has(keyOf(key.name)));
    const room = run ? Math.max(0, run.limit - run.meter.calls - PUBLISH_RESERVE) : Infinity;
    const batch = candidates.slice(0, Math.min(candidates.length, room));
    if (batch.length < candidates.length && !batch.length) return;
    const raw = await this.readEach(batch.map(key => key.name));
    // R-P727 (I6): a read that disagrees with its listing is stale: the step ends before it.
    const stale = raw.findIndex((record, i) => !agrees(batch[i]!, record));
    if (stale === 0) return;
    if (stale > 0) { batch.length = stale; raw.length = stale; }
    const complete = batch.length === candidates.length;
    const stored = raw.filter((record): record is StoredRecord => record !== null);
    const doc = moveInto({ version: 1, audiences: partial }, stored);
    const bytes = documentBytes(doc), last = batch.length ? keyOf(batch[batch.length - 1]!.name) : after;
    // R-P722: nothing is written over records that changed during this step; the next run sees them.
    const whole = complete || bytes > PUBLICATION_MAX_BYTES;
    const again = await this.listedKeys();
    if (!sameRecords(recordsOf(again, whole ? undefined : last!), recordsOf(keys, whole ? undefined : last!))) return;
    if (bytes > PUBLICATION_MAX_BYTES) { await this.storeRefusal(refused !== null, refusalOf(bytes, again)); return; }
    if (!complete) { await this.writeProgress({ version: 1, phase: 'moving', after: last!, behind: recordsOf(again, last!), audiences: doc.audiences }); return; }
    // R-P727: a write fenced within KV's staleness bound that the list this member was built from does not show is
    // taken from the fence into the member before it is published (past the bound, the move is refused by name, the
    // records named as the next list will show them); every write fenced after this read is carried in once it is.
    const fence = await this.readFence(), unshown = [...unshownFenced(fence, again, Date.now())].map(key => [key, fence.fence.writes[key]!] as const);
    const full = unshown.length ? withFenced(doc, unshown) : doc, fullBytes = documentBytes(full);
    const named = unshown.length ? withMetadata(again, unshown.map(([key, entry]) => [key, plainWrite(entry.record).options.metadata])) : again;
    if (fullBytes > PUBLICATION_MAX_BYTES) { await this.storeRefusal(refused !== null, refusalOf(fullBytes, named)); return; }
    const startText = canonical(start);
    let published: AudiencesDocument | null | 'no-publication' = null;
    try { published = await this.commit('move', async latest => canonical(latest) === startText ? full : null); }
    catch (error) {
      if (!tooLarge(error)) throw error;
      await this.storeRefusal(refused !== null, refusalOf(fullBytes, named)); return;
    }
    if (published === null || published === 'no-publication') return;
    if (progress) await this.clearProgress();
    await this.carryFenced(fence);
  }

  /** The refusal stored where the tenant's refusal lives: in the member where one carries it (R-P722), else in the progress record. */
  private async storeRefusal(inMember: boolean, refusal: MoveRefusal): Promise<void> {
    if (inMember) await this.commit('move: refused', async latest => latest?.move ? documentOf([], {}, refusal) : null);
    else await this.writeProgress({ version: 1, ...refusal });
  }
}

/**
 * R-P699: the five-minute run's budget for one tenant's job: `meter` counts every storage
 * call the job makes (src/index.ts shares it with the folds' `countedStorage`), `limit` is
 * the run's (src/learn/hourly.ts RUN_BUDGET).
 */
export interface RunBudget { meter: { calls: number }; limit: number }
/** Calls kept for one publication of the member (its head, set and member reads and writes, with room for one retry), the second list's pages, the fence's reads and the cursor. */
const PUBLISH_RESERVE = 40;
/** The run's limit reached: no call is made past it; the run stops and the next resumes. */
class RunBudgetSpent extends Error {}

/**
 * The environment the run's store works through: every KV and object-storage call counted
 * in `run.meter`, and refused past `run.limit` while `capped.on`. The object-storage wrapper
 * is named to its binding (`nameServingStorage`), so the publication treats it as the binding.
 */
function metered(env: Env, run: RunBudget, capped: { on: boolean }): Env {
  const call = <T>(make: () => Promise<T>): Promise<T> => {
    if (capped.on && run.meter.calls >= run.limit) return Promise.reject(new RunBudgetSpent('audience reconciliation: run budget spent'));
    run.meter.calls++;
    return make();
  };
  const kv = env.CACHE as unknown as KVLike;
  const cache: KVLike = {
    get: (key, type) => call(() => kv.get(key, type)),
    put: (key, value, options) => call(() => kv.put(key, value, options)),
    delete: key => call(() => kv.delete(key)),
    list: options => call(() => kv.list(options)),
  };
  const r2 = env.STORAGE as unknown as Record<'get' | 'put' | 'head' | 'list' | 'delete', (...args: unknown[]) => Promise<unknown>>;
  const storage = {
    get: (...args: unknown[]) => call(() => r2.get(...args)),
    put: (...args: unknown[]) => call(() => r2.put(...args)),
    head: (...args: unknown[]) => call(() => r2.head(...args)),
    list: (...args: unknown[]) => call(() => r2.list(...args)),
    delete: (...args: unknown[]) => call(() => r2.delete(...args)),
  };
  nameServingStorage(storage, r2);
  return { ...env, CACHE: cache as unknown as Env['CACHE'], STORAGE: storage as unknown as Env['STORAGE'] };
}

/**
 * The five-minute run (src/index.ts): the tenant's audiences moved into its publication, or
 * reconciled there. With `run`, every call is counted in its meter and none made past its
 * limit, the move's included (R-P713); a run stopped by the limit leaves the rest to the next run.
 */
export async function moveAudiences(env: Env, tenant: TenantId, run?: RunBudget): Promise<void> {
  if (!run || !hasStorage(env)) { await new KvAudienceStore(env, tenant).moveAndReconcile(); return; }
  const capped = { on: false };
  try { await new KvAudienceStore(metered(env, run, capped), tenant).moveAndReconcile({ run, capped }); }
  catch (error) { if (!(error instanceof RunBudgetSpent)) throw error; }
}

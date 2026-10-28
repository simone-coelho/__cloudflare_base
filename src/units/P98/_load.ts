// src/units/P98/_load.ts
// P98's harness (programme `tapestry-parity-hardening`, amendment 13, E25; design C and C2 of R-P549): the storage meter
// and fault injector on the mount's bucket (every call classed, counted, its bytes and the calls in flight; a rule may
// answer any call with a storage fault), the reader that checks each object a pointer names by its own digest, wherever
// it lives (a pack's byte range or an object of its own), the upload-time wrapper, the stage and publish doors (the
// names are the specification's reading, see the unit file's header), the two forms stored before packs planted beside
// the routes (P93's shards and parts; P86's one-level manifest), and the retention setting. It holds no expected value:
// it mounts, calls and reads back. Synthetic, customer-neutral names; tenant ids only.

import { createHash } from 'node:crypto';
import { expect } from 'vitest';

import { invalidatePublicationCache, publish } from '@/config/publication';
import { CONTENT_KIND } from '@/content/kinds';
import type { ContentCatalog } from '@/content/types';

import { asOperator, expectPublished, loadDocument, MODULES, mount, TENANT, type Answer, type Documents, type Host, type Mounted } from '../_parity';
import { ANCHOR_IMAGES, bucketOf, CAROUSEL, classOf, declareProductSlots, DOCS_WITH_CART, indexOf, KEY, OTHER_IMAGES, preconditions, rangeRecords,
  show, type IndexView, type Place } from '../P93/_catalog';

// ── Canonical values and digests (the publication's own rule: keys sorted, no insignificant whitespace) ─────────────
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonicalJson((value as Record<string, unknown>)[k])).join(',') + '}';
  return JSON.stringify(value);
}
export const digestOf = (value: unknown) => createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
export const HEX64 = /[0-9a-f]{64}/;

// ── The meter and the fault injector ─────────────────────────────────────────────────────────────────────────────────
export type OpName = 'get' | 'put' | 'head' | 'list' | 'delete';
/** Where the request stood when a call was issued: before its head reservation, reserved, or after its commit landed. */
export type Phase = 'before' | 'reserved' | 'committed';
export interface Call {
  op: OpName; key: string; cls: string;
  /** A ranged read's range (R2 `get(key, { range })`). */
  range: { offset: number; length: number } | null;
  /** This call's occurrence among the calls of the same operation on the same key (and the same range), from 1. */
  n: number; idx: number;
  /** For a put of the head: a reservation (the body holds a pending set) or a commit (it holds none). */
  head: 'reservation' | 'commit' | null;
  phase: Phase;
  /** Bytes read (a ranged read's length, else the object's size) or written. */
  bytes: number;
  failed: boolean;
}
/** A storage fault: thrown before the call (with the platform's number, or without), a null answer, or the call landing and then throwing. */
export type Fault = 'throw' | 'throw-bare' | 'null' | 'land-then-throw';
export type Rule = (call: Call, meter: Meter) => Fault | undefined;
export interface Meter {
  calls: Call[]; inflight: number; maxInflight: number; phase: Phase;
  /** The calls the rule failed, in order. */
  failed: Call[];
  restore(): void;
}
/** The platform's words a failing call carries (with its number, as R2's binding errors end), and the key, so that a 503 echoing it is seen. */
export const STORAGE_WORDS = 'We encountered an internal error. Please try again.';
export const STORAGE_NUMBER = 10001;
const storageError = (call: Call, bare: boolean) => new Error(bare ? `Network connection lost (${call.op})` : `${call.op} ${call.key}: ${STORAGE_WORDS} (${STORAGE_NUMBER})`);
const keyOf = (op: OpName, first: unknown) => op === 'list' ? String((first as { prefix?: string } | undefined)?.prefix ?? '') : Array.isArray(first) ? first.join(',') : String(first);
const headKind = (body: unknown): Call['head'] => {
  try { const head = JSON.parse(String(body)) as { pending?: unknown }; return head.pending === null ? 'commit' : 'reservation'; } catch { return null; }
};
/**
 * Every call on the mount's bucket while installed, through whatever the bucket answers with now (an earlier override
 * included); `rule` may answer any call with a fault, `after` runs once a call has answered (a concurrent writer's turn).
 */
export function meter(m: Mounted, rule?: Rule, after?: (call: Call, meter: Meter) => Promise<void> | void): Meter {
  const bucket = m.storage as unknown as Record<string, unknown>, saved = new Map<string, PropertyDescriptor | undefined>();
  const seen = new Map<string, number>();
  const st: Meter = { calls: [], inflight: 0, maxInflight: 0, phase: 'before', failed: [], restore: () => undefined };
  for (const name of ['get', 'put', 'head', 'list', 'delete'] as const) {
    saved.set(name, Object.getOwnPropertyDescriptor(bucket, name));
    const current = (bucket[name] as (...args: unknown[]) => Promise<unknown>).bind(m.storage);
    Object.defineProperty(bucket, name, { configurable: true, writable: true, value: async (...args: unknown[]) => {
      const key = keyOf(name, args[0]), rangeIn = name === 'get' ? (args[1] as { range?: { offset?: number; length?: number } } | undefined)?.range : undefined;
      const range = rangeIn ? { offset: rangeIn.offset ?? 0, length: rangeIn.length ?? -1 } : null;
      const tag = `${name} ${key} ${range ? `${range.offset}+${range.length}` : ''}`, n = (seen.get(tag) ?? 0) + 1; seen.set(tag, n);
      const call: Call = { op: name, key, cls: name === 'list' ? 'list' : classOf(key), range, n, idx: st.calls.length, head: name === 'put' && classOf(key) === 'head' ? headKind(args[1]) : null,
        phase: st.phase, bytes: name === 'put' ? Buffer.byteLength(String(args[1] ?? ''), 'utf8') : 0, failed: false };
      st.calls.push(call); st.inflight++; st.maxInflight = Math.max(st.maxInflight, st.inflight);
      try {
        const fault = rule?.(call, st);
        if (fault === 'throw' || fault === 'throw-bare') { call.failed = true; st.failed.push(call); throw storageError(call, fault === 'throw-bare'); }
        if (fault === 'null') { call.failed = true; st.failed.push(call); return null; }
        const result = await current(...args) as Record<string, unknown> | null;
        if (name === 'get' && result) call.bytes = range ? Number((result.range as { length?: number } | undefined)?.length ?? range.length) : Number(result.size ?? 0);
        if (name === 'put' && result && call.head === 'reservation') st.phase = 'reserved';
        if (name === 'put' && result && call.head === 'commit') st.phase = 'committed';
        if (fault === 'land-then-throw') { call.failed = true; st.failed.push(call); throw storageError(call, false); }
        await after?.(call, st);
        return result;
      } finally { st.inflight--; }
    } });
  }
  st.restore = () => { for (const [name, d] of saved) { if (d) Object.defineProperty(bucket, name, d); else Reflect.deleteProperty(bucket, name); } };
  return st;
}
/** One operation run under a meter (and a rule), the meter restored after it. */
export async function under<T>(m: Mounted, run: () => Promise<T>, rule?: Rule, after?: (call: Call, meter: Meter) => Promise<void> | void): Promise<{ result: T; meter: Meter }> {
  const st = meter(m, rule, after);
  try { return { result: await run(), meter: st }; } finally { st.restore(); }
}
/** The calls of one operation by `op class`, e.g. `{ 'put pack': 1, 'put head': 2 }`. */
export const tally = (calls: readonly Call[], op?: OpName) => {
  const out: Record<string, number> = {};
  for (const c of calls) if (!op || c.op === op) out[`${c.op} ${c.cls}`] = (out[`${c.op} ${c.cls}`] ?? 0) + 1;
  return Object.fromEntries(Object.keys(out).sort().map(k => [k, out[k]!]));
};
/** The kind of stored object a call named, in the words the 503 uses (reading: the storage object's own kind). */
export const objectKindOf = (cls: string) => /revision$/.test(cls) ? 'revision' : cls;
/** A rule failing the first `times` attempts of the first call that `pick` accepts (the same operation, key and range). */
export function failFirst(pick: (call: Call, meter: Meter) => boolean, times = 1, fault: Fault = 'throw'): Rule {
  let target: string | null = null, done = 0;
  return (call, st) => {
    const tag = `${call.op} ${call.key} ${call.range ? `${call.range.offset}+${call.range.length}` : ''}`;
    if (target === null && pick(call, st)) target = tag;
    if (target === tag && done < times) { done++; return fault; }
    return undefined;
  };
}
/**
 * The consecutive attempts of the failed call: the calls of its operation, key and range from the first failure of the
 * run that ends in `target` through the first attempt that did not fail (a later call of the same key, such as a head
 * read again after the reservation, is a call of its own).
 */
export function attemptsOf(st: Meter, target: Call | undefined): number {
  if (!target) return 0;
  const same = st.calls.filter(c => c.op === target.op && c.key === target.key && JSON.stringify(c.range) === JSON.stringify(target.range));
  let at = same.indexOf(target);
  while (at > 0 && same[at - 1]!.failed) at--;
  let n = 0;
  for (let i = at; i < same.length; i++) { n++; if (!same[i]!.failed) break; }
  return n;
}

// ── Objects in packs, checked by their own digest ────────────────────────────────────────────────────────────────────
const packBuffers = new Map<string, { raw: string; bytes: Buffer }>();
/** The stored bytes of a pack (null where the store does not hold it). */
export function packBytes(m: Mounted, pack: string): Buffer | null {
  const key = KEY.pack(pack), raw = m.storage.objects.get(key);
  if (raw === undefined) return null;
  let held = packBuffers.get(key);
  if (!held || held.raw !== raw) { held = { raw, bytes: Buffer.from(raw, 'utf8') }; packBuffers.set(key, held); }
  return held.bytes;
}
/** The value at a place in a pack (null where the pack, or a JSON value at that range, is missing). */
export function valueAt(m: Mounted, place: Place): Record<string, unknown> | null {
  const bytes = packBytes(m, place.pack);
  if (!bytes || place.at < 0 || place.at + place.bytes > bytes.length) return null;
  try { return JSON.parse(bytes.subarray(place.at, place.at + place.bytes).toString('utf8')) as Record<string, unknown>; } catch { return null; }
}
/** The pack table of a manifest: the digests it names (an entry is the digest or an object naming it as `digest`). */
export const packTable = (document: Record<string, unknown>): string[] => {
  const table = (document.index as { packs?: unknown } | undefined)?.packs;
  return Array.isArray(table) ? table.map(e => typeof e === 'string' ? e : String((e as { digest?: unknown } | null)?.digest ?? '')) : [];
};
/**
 * Every object the revision names, resolved: each shard and id shard pointer and each part pointer, where it lives (its
 * pack and range, or its own object), and whether the bytes there are the value its digest names. `bad` lists each
 * pointer whose object is missing or another value.
 */
export function resolve(m: Mounted, document: Record<string, unknown>): {
  view: IndexView; packed: { shards: number; idShards: number; parts: number }; own: { shards: number; idShards: number; parts: number };
  places: Array<{ kind: 'shard' | 'idshard' | 'part'; digest: string; place: Place | null }>; bad: string[];
} {
  const view = indexOf(m, document), bad: string[] = [], places: Array<{ kind: 'shard' | 'idshard' | 'part'; digest: string; place: Place | null }> = [];
  const packed = { shards: 0, idShards: 0, parts: 0 }, own = { shards: 0, idShards: 0, parts: 0 };
  const check = (kind: 'shard' | 'idshard' | 'part', name: string, digest: string, place: Place | undefined) => {
    places.push({ kind, digest, place: place ?? null });
    const value = place ? valueAt(m, place) : (() => { const raw = m.storage.objects.get(KEY[kind](digest)); return raw === undefined ? null : JSON.parse(raw) as unknown; })();
    if (value === null || digestOf(value) !== digest) bad.push(`${kind} ${name}${place ? ` in pack ${place.pack.slice(0, 12)}@${place.at}+${place.bytes}` : ''}`);
    const into = place ? packed : own;
    if (kind === 'shard') into.shards++; else if (kind === 'idshard') into.idShards++; else into.parts++;
  };
  for (const [name, p] of Object.entries(view.shards)) check('shard', name, p.digest, view.places?.shards[name]);
  for (const [name, p] of Object.entries(view.idShards)) check('idshard', name, p.digest, view.places?.idShards[name]);
  for (const [product, p] of Object.entries(view.products)) check('part', product, p.digest, p.place);
  return { view, packed, own, places, bad };
}
/** The packs a revision reaches through its pointers, with the objects and bytes it reaches in each. */
export function reached(m: Mounted, document: Record<string, unknown>): Map<string, { objects: number; bytes: number }> {
  const out = new Map<string, { objects: number; bytes: number }>(), seen = new Set<string>();
  for (const { place } of resolve(m, document).places) {
    if (!place || seen.has(`${place.pack}@${place.at}`)) continue;
    seen.add(`${place.pack}@${place.at}`);
    const held = out.get(place.pack) ?? { objects: 0, bytes: 0 }; held.objects++; held.bytes += place.bytes; out.set(place.pack, held);
  }
  return out;
}
/** The stored packs, and those no stored content revision names in its table or through a pointer. */
export const storedPacks = (m: Mounted) => [...m.storage.objects.keys()].filter(k => classOf(k) === 'pack').sort();

// ── The doors ─────────────────────────────────────────────────────────────────────────────────────────────────────────
const q = (members: Record<string, string>) => new URLSearchParams({ scope: TENANT, ...members }).toString();
/** Reading S1: `POST /content/catalog/stage?scope=&mode=…` with the records as the import takes them, over the base its `If-Match` names. */
export const STAGE_PATH = '/content/catalog/stage';
/** Reading S1: `POST /content/catalog/publish?scope=` with `{ stages: [<the stage answers' `stage`>…] }` and the publication's preconditions. */
export const PUBLISH_PATH = '/content/catalog/publish';
export const stageOf = async (m: Mounted, records: unknown[], headers?: Record<string, string>, members: Record<string, string> = { mode: 'merge' }) =>
  asOperator(m, 'POST', `${STAGE_PATH}?${q(members)}`, records, headers ?? await preconditions(m));
export const publishOf = async (m: Mounted, stages: unknown[], headers?: Record<string, string>) =>
  asOperator(m, 'POST', `${PUBLISH_PATH}?${q({})}`, { stages }, headers ?? await preconditions(m));
export const importOf = async (m: Mounted, records: unknown[], headers?: Record<string, string>, members: Record<string, string> = { mode: 'merge' }) =>
  asOperator(m, 'POST', `/content/catalog/import?${q(members)}`, records, headers ?? await preconditions(m));
/** The publication's own status (`GET /content/catalog/publication`): `idle`, `pending` or `committed`. */
export const statusOf = async (m: Mounted) => String((await asOperator(m, 'GET', `/content/catalog/publication?scope=${TENANT}`)).body.state ?? 'unreadable');
export const recoverOf = (m: Mounted, headers: Record<string, string>) => asOperator(m, 'POST', `/content/catalog/publication/recover?scope=${TENANT}`, undefined, headers);
export const revisionOf = async (m: Mounted) => (await loadDocument(m, 'catalog')).revision;

// ── Upload times and the retention setting ───────────────────────────────────────────────────────────────────────────
/** The bucket's own `uploaded` member (R2's, on list, head and get), as `when` names it for each key; over whatever the bucket answers now. */
export function uploadedAt(m: Mounted, when: (key: string) => Date): () => void {
  const bucket = m.storage as unknown as Record<string, unknown>, saved = new Map<string, PropertyDescriptor | undefined>();
  const wrap = (name: 'list' | 'head' | 'get', map: (result: Record<string, unknown>, key: string) => unknown) => {
    saved.set(name, Object.getOwnPropertyDescriptor(bucket, name));
    const current = (bucket[name] as (...args: unknown[]) => Promise<Record<string, unknown> | null>).bind(m.storage);
    Object.defineProperty(bucket, name, { configurable: true, writable: true, value: async (...args: unknown[]) => {
      const result = await current(...args); return result ? map(result, String(args[0])) : result;
    } });
  };
  wrap('list', result => ({ ...result, objects: (result.objects as Array<{ key: string }>).map(o => ({ ...o, uploaded: when(o.key) })) }));
  wrap('head', (result, key) => ({ ...result, uploaded: when(key) }));
  wrap('get', (result, key) => ({ ...result, uploaded: when(key) }));
  return () => { for (const [name, d] of saved) { if (d) Object.defineProperty(bucket, name, d); else Reflect.deleteProperty(bucket, name); } };
}
export const minutesAgo = (minutes: number) => () => new Date(Date.now() - minutes * 60_000);
/** The configuration retention setting at its smallest admitted duration (W38 B4), as P86's and P93's retention legs set it. */
export function shortRetention(m: Mounted): void {
  const retention = JSON.parse(String(m.env.RETENTION)) as { version: number; tenants: Record<string, Record<string, unknown>> };
  retention.tenants[TENANT]!.configuration = { id: 'p98-configuration-revisions', revision: 1, durationMs: 1, basis: 'occurred', renewal: 'new-record-only' };
  m.env.RETENTION = JSON.stringify(retention);
}

// ── Tenants ───────────────────────────────────────────────────────────────────────────────────────────────────────────
/** A tenant declaring its product slots, with P80's images and the generator's products 1…n loaded through the import, in files of `chunk`. */
export async function loadedTenant(host: Host, n: number, chunk = 5000, documents: Documents = DOCS_WITH_CART): Promise<Mounted> {
  const m = await mount(host, documents);
  expectPublished(m, 'P98 — the tenant documents publish');
  await declareProductSlots(m);
  for (let from = 1; from <= n; from += chunk) {
    const records = [...(from === 1 ? [...ANCHOR_IMAGES, ...OTHER_IMAGES] : []), ...rangeRecords(from, Math.min(chunk, n - from + 1))];
    const loaded = await importOf(m, records);
    expect(loaded.status, `PRECONDITION (${host}): the range's products ${from}… load (${show(loaded)})`).toBe(200);
  }
  invalidatePublicationCache();
  return m;
}
/** The pieces the content kind admits, routed as the catalogue routes them: shared, or one product's part (every slot type the carousel, its first featured product). */
function routed(records: unknown[]): { shared: unknown[]; parts: Map<string, unknown[]> } {
  const checked = CONTENT_KIND.validate({ pieces: [...MODULES, ...records] });
  if (!checked.ok) throw new Error(`P98 fixture: ${checked.errors.slice(0, 3).join('; ')}`);
  const shared: unknown[] = [], parts = new Map<string, unknown[]>();
  for (const piece of checked.value.pieces) {
    const product = piece.slotTypes?.every(s => s === CAROUSEL) && piece.featuredProductIds?.[0] ? piece.featuredProductIds[0] : null;
    if (product === null) shared.push(piece); else parts.set(product, [...(parts.get(product) ?? []), piece]);
  }
  return { shared, parts };
}
async function publishManifest(m: Mounted, manifest: Record<string, unknown>, note: string): Promise<void> {
  const base = await loadDocument(m, 'catalog');
  const written = await publish<ContentCatalog>(m.env, CONTENT_KIND, TENANT, { type: 'replace', candidate: manifest },
    { actor: 'p98-fixture', note, operationId: `${base.revision}:${crypto.randomUUID()}`, expectedRevision: base.revision, expectedPublication: base.publication },
    () => manifest);
  if (!written.ok) throw new Error(`P98 fixture: the stored form was refused: ${written.errors.slice(0, 3).join('; ')}`);
  invalidatePublicationCache();
}
/**
 * A catalogue stored as the release before packs stores it (P93's form): each product's part, each product shard and
 * each id shard an object of its own at its content address, the manifest's `index` naming them with no byte range,
 * written beside the routes (no route writes that form once packs exist) and published by the publication authority.
 */
export async function shardedTenant(host: Host, records: unknown[]): Promise<{ m: Mounted; parts: Map<string, string> }> {
  const m = await mount(host, DOCS_WITH_CART);
  expectPublished(m, 'P98 — the tenant documents publish');
  const { shared, parts } = routed(records), digests = new Map<string, string>();
  const shards = new Map<string, Record<string, { digest: string; records: number }>>(), idShards = new Map<string, Record<string, string>>();
  for (const [product, pieces] of parts) {
    const value = { product, pieces }, digest = digestOf(value);
    await m.storage.put(KEY.part(digest), canonicalJson(value)); digests.set(product, digest);
    const shard = shards.get(bucketOf(product)) ?? {}; shard[product] = { digest, records: pieces.length }; shards.set(bucketOf(product), shard);
    for (const piece of pieces as Array<{ id: string }>) { const ids = idShards.get(bucketOf(piece.id)) ?? {}; ids[piece.id] = product; idShards.set(bucketOf(piece.id), ids); }
  }
  const sortedOf = <T>(o: Record<string, T>) => Object.fromEntries(Object.keys(o).sort().map(k => [k, o[k]!]));
  const index = { key: 'sha256-hex2', shards: {} as Record<string, unknown>, ids: {} as Record<string, unknown> };
  for (const name of [...shards.keys()].sort()) {
    const value = { shard: name, products: sortedOf(shards.get(name)!) }, digest = digestOf(value);
    await m.storage.put(KEY.shard(digest), canonicalJson(value));
    index.shards[name] = { digest, products: Object.keys(value.products).length, records: Object.values(value.products).reduce((n, p) => n + p.records, 0) };
  }
  for (const name of [...idShards.keys()].sort()) {
    const value = { shard: name, ids: sortedOf(idShards.get(name)!) }, digest = digestOf(value);
    await m.storage.put(KEY.idshard(digest), canonicalJson(value));
    index.ids[name] = { digest, records: Object.keys(value.ids).length };
  }
  await publishManifest(m, { version: 'p98-sharded', productSlots: [CAROUSEL], pieces: shared, index }, 'P93\'s form, before packs');
  return { m, parts: digests };
}
/** A catalogue in P86's one-level form (its parts and its one id index objects of their own; `products` and `idIndex` in the manifest). */
export async function oneLevelTenant(host: Host, records: unknown[]): Promise<{ m: Mounted; parts: Map<string, string> }> {
  const m = await mount(host, DOCS_WITH_CART);
  expectPublished(m, 'P98 — the tenant documents publish');
  const { shared, parts } = routed(records), digests = new Map<string, string>();
  const products: Record<string, { digest: string; records: number }> = {}, ids: Record<string, string> = {};
  for (const [product, pieces] of parts) {
    const value = { product, pieces }, digest = digestOf(value);
    await m.storage.put(KEY.part(digest), canonicalJson(value)); products[product] = { digest, records: pieces.length }; digests.set(product, digest);
    for (const piece of pieces as Array<{ id: string }>) ids[piece.id] = product;
  }
  const idsValue = { ids: Object.fromEntries(Object.keys(ids).sort().map(id => [id, ids[id]!])) }, idsDigest = digestOf(idsValue);
  await m.storage.put(KEY.ids(idsDigest), canonicalJson(idsValue));
  await publishManifest(m, { version: 'p98-one-level', productSlots: [CAROUSEL], pieces: shared,
    products: Object.fromEntries(Object.keys(products).sort().map(p => [p, products[p]!])), idIndex: { digest: idsDigest, records: Object.keys(ids).length } }, 'P86\'s one-level form');
  return { m, parts: digests };
}

/** The 503's members a client acts on, and what it must never carry. */
export function leaked(answer: Answer, failing: Call | undefined, token: string): string[] {
  const text = JSON.stringify(answer.body), out: string[] = [];
  if (failing && text.includes(failing.key)) out.push('the object key');
  if (text.includes('config-publication')) out.push('an object path');
  if (HEX64.test(text)) out.push('a 64-hex digest');
  if (text.includes(token)) out.push('the credential');
  if (text.includes(STORAGE_WORDS) || text.includes('Network connection lost')) out.push('the storage error\'s words');
  return out;
}

/**
 * An import through the mounted routes without waiting on the mount's background work (a concurrent writer's turn,
 * taken inside another request's storage call): its preconditions read and the load sent with them.
 */
export async function rawImport(m: Mounted, records: unknown[]): Promise<{ answer: Answer; headers: Record<string, string> }> {
  const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Answer> => {
    const response = await m.fetch(new Request(`http://console.test${path}`, { method,
      headers: { 'X-Tenant': TENANT, Authorization: `Bearer ${m.operatorToken}`, 'content-type': 'application/json', ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
    return { status: response.status, body: await response.json().catch(() => ({})) as Record<string, unknown> };
  };
  const base = await call('GET', `/content/catalog?scope=${TENANT}`), publication = base.body.publication as { revision: number; digest: string };
  const headers = { 'If-Match': `"${String(base.body.revision)}/${publication.revision}/${publication.digest}"`, 'Idempotency-Key': `${String(base.body.revision)}:${crypto.randomUUID()}` };
  return { answer: await call('POST', `/content/catalog/import?scope=${TENANT}&mode=merge`, records, headers), headers };
}

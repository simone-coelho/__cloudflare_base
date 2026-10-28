// src/units/P93/_catalog.ts
// P93's harness. P86's fixture and generator (src/units/P86/LEDGER.unit.test.ts :202–258, copied here because a test
// file exports nothing), the catalogue's objects read in either form — P86's one-level manifest (`products`, `idIndex`,
// `content/part/`, `content/ids/`) and P93's sharded one (`index`, `content/shard/`, `content/idshard/`) — the storage
// meter (every call on the mount's bucket, classed), the decision request with the page's ctx signals and the range
// loaded in chunks within the import's caps. It holds no expected value: it mounts, calls and reads back.

import { createHash } from 'node:crypto';
import { expect, vi } from 'vitest';

import { INPUT_MAX_BYTES, INPUT_MAX_RECORDS } from '@/config/input';
import { invalidatePublicationCache, publish } from '@/config/publication';
import { CONTENT_KIND } from '@/content/kinds';
import type { ContentCatalog } from '@/content/types';
import { SHOPPER_HEADER } from '@/identity/sessionCapability';

import { asOperator, BRAND, declaredSlots, expectPublished, layoutSlot, learnDocument, loadDocument, MODULES, mount, pageInstanceOf, putDocument, recentSlot,
  servedIn, TENANT, type Answer, type Decision, type Documents, type Host, type LoadedSlots, type Mounted, type Shopper, type Snapshot } from '../_parity';

// ── The fixture (P86's) ──────────────────────────────────────────────────────────────────────────────────────────────
export const CAROUSEL = 'pdp-carousel';
/** P80's anchor and its colours; the wallet; the quilted bag; a product the catalogue does not carry. */
export const A = 'COA-CH857', B = 'COA-CB925', C = 'COA-CW620', UNKNOWN = 'COA-ZZ999';
export const BLACK = 'COA-CH857-BLACK', CHALK = 'COA-CH857-CHALK';
const CATEGORY: Record<string, string> = { [A]: 'Handbags', [B]: 'Small Leather Goods', [C]: 'Handbags', [UNKNOWN]: 'Small Leather Goods' };
export const SHOTS = ['on-model', 'studio', 'detail', 'flat-lay'] as const;
const slug = (product: string) => product.toLowerCase().replace(/^coa-/, '');
export type Rec = Record<string, unknown> & { id: string; title: string };
export const image = (id: string, products: string[] | undefined, category: string, shot: string, extra: Record<string, unknown> = {}): Rec => ({ id,
  customerContentId: `TAP-${id.toUpperCase()}`, type: shot, title: `${id} (${shot})`,
  tags: { category: [category], line: ['Tabby'], shot: [shot], contentType: [shot] }, slotTypes: [CAROUSEL], lifecycle: { status: 'live' },
  ...(products ? { featuredProductIds: products } : {}), ...extra });
export const ANCHOR_IMAGES = [
  image('img-ch857-1', [A], 'Handbags', 'on-model'), image('img-ch857-2', [A], 'Handbags', 'studio'),
  image('img-ch857-black-3', [A, BLACK], 'Handbags', 'detail'), image('img-ch857-chalk-4', [A, CHALK], 'Handbags', 'detail'),
];
export const OTHER_IMAGES = [image('img-cb925-1', [B], 'Small Leather Goods', 'on-model'), image('img-zz999-1', [UNKNOWN], 'Small Leather Goods', 'on-model'),
  image('img-brand-1', undefined, 'Small Leather Goods', 'flat-lay')];
/** What the scoped carousel serves the anchor with its Black variant (P80's matching rule). */
export const SERVED_FOR_BLACK = ['img-ch857-1', 'img-ch857-2', 'img-ch857-black-3'];
export const fourOf = (product: string): Rec[] => [1, 2, 3, 4].map(i => image(`img-${slug(product)}-s${i}`, [product], CATEGORY[product] ?? 'Handbags', SHOTS[i % 4]!));

/** The generator (P86's S8, its records from product `from`): one image record per product, four categories, two lines, every seventh on an unmapped dimension. */
const RANGE_CATEGORIES = ['Handbags', 'Small Leather Goods', 'Shoes', 'Ready-to-Wear'];
export const rangeProduct = (k: number) => `COA-R${String(k).padStart(5, '0')}`;
export const rangeRecordId = (k: number) => `img-r${String(k).padStart(5, '0')}-1`;
export const rangeRecords = (from: number, count: number, suffix = ''): Rec[] => Array.from({ length: count }, (_, i) => {
  const k = from + i, shot = SHOTS[k % 4]!;
  return { id: rangeRecordId(k), customerContentId: `TAP-IMG-R${String(k).padStart(5, '0')}-1`, type: shot, title: `Range product ${k}, ${shot}${suffix}`,
    tags: { category: [RANGE_CATEGORIES[k % 4]!], line: [k % 3 ? 'Tabby' : 'Willow'], shot: [shot], ...(k % 7 === 0 ? { styleWorld: ['downtown'] } : {}) },
    slotTypes: [CAROUSEL], lifecycle: { status: 'live' }, featuredProductIds: [rangeProduct(k)] };
});
const carouselSlot = { slot: CAROUSEL, take: 7, weights: { category: 1, line: 0.5 }, scope: 'anchor' };
export const LEARN = learnDocument({ [CAROUSEL]: { measurementBasis: 'rendered-v1', reward: 'click' } });
export const DOCS = { pieces: [...MODULES], slots: declaredSlots([layoutSlot(), carouselSlot]), learn: LEARN };
/** The tenant with a cart page that holds no scoped slot. */
export const DOCS_WITH_CART: Documents = { ...DOCS, slots: { version: 'parity-coach-slots', governanceVersion: 4, pages: { pdp: [layoutSlot(), carouselSlot], cart: [recentSlot()] } } };
export const MODULE_IDS = MODULES.map(p => p.id);

export const show = (a: { status: number; body: unknown }) => `${a.status} ${JSON.stringify(a.body).slice(0, 300)}`;
export const sorted = (ids: Iterable<string>) => [...ids].sort();
export const unique = (ids: Iterable<string>) => sorted(new Set(ids));

// ── The operator's doors (P86's) ─────────────────────────────────────────────────────────────────────────────────────
export const preconditions = async (m: Mounted) => {
  const base = await loadDocument(m, 'catalog');
  return { 'If-Match': `"${base.revision}/${base.publication.revision}/${base.publication.digest}"`, 'Idempotency-Key': `${base.revision}:${crypto.randomUUID()}` };
};
const q = (members: Record<string, string>) => new URLSearchParams({ scope: TENANT, ...members }).toString();
export const importJson = async (m: Mounted, records: unknown[], members: Record<string, string>, headers?: Record<string, string>) =>
  asOperator(m, 'POST', `/content/catalog/import?${q(members)}`, records, headers ?? await preconditions(m));
export const FEED_URL = 'https://cms.example.invalid/p93-feed.json';
/** `POST /content/catalog/pull` of a feed `{ content: records }` answered by a stub of its URL (no network). */
export async function pull(m: Mounted, records: unknown[], members: Record<string, unknown>): Promise<Answer> {
  const original = globalThis.fetch;
  const stub = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) =>
    String(input instanceof Request ? input.url : input) === FEED_URL ? new Response(JSON.stringify({ content: records }), { headers: { 'Content-Type': 'application/json' } }) : original(input, init));
  try { return await asOperator(m, 'POST', `/content/catalog/pull?scope=${TENANT}`, { url: FEED_URL, path: 'content', ...members }, await preconditions(m)); }
  finally { stub.mockRestore(); }
}
/** The catalogue declared product-scoped on the carousel (P86's S1), over the given shared pieces. */
export async function declareProductSlots(m: Mounted, pieces: unknown[] = MODULES): Promise<void> {
  const put = await putDocument(m, 'catalog', { version: 'p93-catalogue', productSlots: [CAROUSEL], pieces }, 'p93 product slots');
  expect(put.status, `PRECONDITION (${m.host}): the catalogue declaring its product slots is published (${show(put)})`).toBe(200);
}
export const productRead = (m: Mounted, product: string) => asOperator(m, 'GET', `/content/catalog?scope=${TENANT}&product=${encodeURIComponent(product)}`);
export const shardRead = (m: Mounted, shard: string) => asOperator(m, 'GET', `/content/catalog?scope=${TENANT}&shard=${encodeURIComponent(shard)}`);
export const readIds = (a: Answer) => sorted((((a.body.document as { pieces?: unknown } | undefined)?.pieces ?? []) as Array<{ id: string }>).map(p => p.id));

// ── The objects, in either form ──────────────────────────────────────────────────────────────────────────────────────
/** The bucket of an id (reading 1): the first two hex digits of SHA-256 of its UTF-8 bytes. */
export const bucketOf = (id: string) => createHash('sha256').update(id, 'utf8').digest('hex').slice(0, 2);
const CONTENT = `config-publication/v1/${TENANT}/content`;
export const KEY = {
  part: (digest: string) => `${CONTENT}/part/${digest}.json`,
  shard: (digest: string) => `${CONTENT}/shard/${digest}.json`,
  idshard: (digest: string) => `${CONTENT}/idshard/${digest}.json`,
  ids: (digest: string) => `${CONTENT}/ids/${digest}.json`,
  revision: (n: number) => `${CONTENT}/rev/${n}.json`,
  /** P98 R10 (R-P549, R-P551): one load's pack, the content-addressed object its parts and shards live in by byte range. */
  pack: (digest: string) => `${CONTENT}/pack/${digest}.pack`,
};
const CLASSES: Array<[string, RegExp]> = [['part', /\/content\/part\/[0-9a-f]{64}\.json$/], ['shard', /\/content\/shard\/[0-9a-f]{64}\.json$/],
  ['idshard', /\/content\/idshard\/[0-9a-f]{64}\.json$/], ['ids', /\/content\/ids\/[0-9a-f]{64}\.json$/], ['pack', /\/content\/pack\/[0-9a-f]{64}\.pack$/]];
/** A key's class: part, shard, idshard, ids (P86's one id index), pack (P98), head, set, `<kind> revision`, else the key itself. */
export function classOf(key: string): string {
  for (const [name, pattern] of CLASSES) if (pattern.test(key)) return name;
  if (/\/head\.json$/.test(key)) return 'head';
  if (/\/set\/[0-9]+\.json$/.test(key)) return 'set';
  const revision = /^config-publication\/v1\/[^/]+\/([^/]+)\/rev\/[0-9]+\.json$/.exec(key);
  return revision ? `${revision[1]} revision` : key;
}
export const objectKeys = (m: Mounted, cls: string) => sorted([...m.storage.objects.keys()].filter(key => classOf(key) === cls));
export const bytesOf = (raw: string) => new TextEncoder().encode(raw).byteLength;
const parsedAt = (m: Mounted, key: string): Record<string, unknown> | null => { const raw = m.storage.objects.get(key); return raw === undefined ? null : JSON.parse(raw) as Record<string, unknown>; };
/** P98 R10: where an object lives inside a pack (the pack's digest and the object's byte range). */
export interface Place { pack: string; at: number; bytes: number }
/**
 * P98 R10 (R-P569 (b)): the objects inside each stored pack, by their own digest. A pack holds the canonical bytes of
 * its objects end to end (S44/analyst-load/DESIGN.md §4), so each object is found by its JSON value's boundaries and
 * named by the SHA-256 of its canonical value — whatever encoding the pointers that name it use.
 */
const packed = new Map<string, { raw: string; bytes: Buffer; objects: Map<string, Place & { kind: 'part' | 'shard' | 'idshard' | null }> }>();
const canonical = (v: unknown): string => Array.isArray(v) ? '[' + v.map(canonical).join(',') + ']'
  : v && typeof v === 'object' ? '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canonical((v as Record<string, unknown>)[k])).join(',') + '}' : JSON.stringify(v);
function packObjects(m: Mounted, pack: string): { bytes: Buffer; objects: Map<string, Place & { kind: 'part' | 'shard' | 'idshard' | null }> } | null {
  const key = KEY.pack(pack), raw = m.storage.objects.get(key);
  if (raw === undefined) return null;
  const held = packed.get(key);
  if (held && held.raw === raw) return held;
  const bytes = Buffer.from(raw, 'utf8'), objects = new Map<string, Place & { kind: 'part' | 'shard' | 'idshard' | null }>();
  for (let i = 0; i < bytes.length;) {
    const open = bytes[i]!;
    if (open !== 0x7b && open !== 0x5b) { i++; continue; }
    let depth = 0, inString = false, j = i;
    for (; j < bytes.length; j++) {
      const c = bytes[j]!;
      if (inString) { if (c === 0x5c) j++; else if (c === 0x22) inString = false; continue; }
      if (c === 0x22) inString = true; else if (c === 0x7b || c === 0x5b) depth++; else if (c === 0x7d || c === 0x5d) { depth--; if (depth === 0) break; }
    }
    try {
      const value = JSON.parse(bytes.subarray(i, j + 1).toString('utf8')) as unknown;
      const digest = createHash('sha256').update(canonical(value), 'utf8').digest('hex');
      const v = value as Record<string, unknown>, kind = v && typeof v === 'object' ? 'pieces' in v && 'product' in v ? 'part' : 'products' in v ? 'shard' : 'ids' in v && 'shard' in v ? 'idshard' : null : null;
      if (!objects.has(digest)) objects.set(digest, { pack, at: i, bytes: j + 1 - i, kind });
    } catch { /* not a JSON value: skipped */ }
    i = j + 1;
  }
  const entry = { raw, bytes, objects };
  packed.set(key, entry);
  return entry;
}
/** P98 R10: the value at a place in a stored pack, as the bucket holds it (null where the pack or a JSON value there is missing). */
const placedAt = (m: Mounted, place: Place): Record<string, unknown> | null => {
  const held = packObjects(m, place.pack);
  if (!held) return null;
  try { return JSON.parse(held.bytes.subarray(place.at, place.at + place.bytes).toString('utf8')) as Record<string, unknown>; } catch { return null; }
};
/** P98 R10: a pack table's entry as its digest (an entry may be the digest or an object naming it as `digest`). */
const packDigest = (entry: unknown): string => typeof entry === 'string' ? entry : String((entry as { digest?: unknown } | null)?.digest ?? '');
/** P98 R10 (R-P578 (c)): a pointer's place: `pack` the row of `table`, else `own` (a part inside its shard's own pack); none for an object of its own. */
const placeOf = (pointer: { pack?: unknown; at?: unknown; bytes?: unknown }, table: readonly unknown[] | undefined, own?: string): Place | undefined => {
  if (typeof pointer.at !== 'number' || typeof pointer.bytes !== 'number') return undefined;
  const pack = typeof pointer.pack === 'number' ? packDigest(table?.[pointer.pack]) : own;
  return pack ? { pack, at: pointer.at, bytes: pointer.bytes } : undefined;
};
/** P98 R10: the SHA-256 of a value's canonical form (a stored object's digest). */
const digestOfValue = (value: unknown) => createHash('sha256').update(canonical(value), 'utf8').digest('hex');
/**
 * P98 R10 (R-P578 (c), R-P582): the digest a view names a pointer's object by. An object of its own: its pointer's digest.
 * One in a pack: its pointer carries the first 128 bits (32 hex) of the object's digest, and the view names it by the
 * full digest of the object stored there when that prefix is its own, else by what is wrong.
 */
const named = (digest: string | undefined, place: Place | undefined, body: Record<string, unknown> | null): string => {
  if (!place) return digest ?? 'no digest';
  if (!body) return 'no object at its place';
  const full = digestOfValue(body);
  return digest === undefined || full.startsWith(digest) ? full : `not the object its pointer names (${digest})`;
};
/**
 * P98 R10 (R-P569 (b)): where the object a pointer names by its digest is stored: in one of the packs `prefer` names
 * (the revision's table), else as an object of its own at `own`, else in any stored pack; none where it is nowhere.
 */
const locate = (m: Mounted, digest: string, own: string, prefer: readonly string[]): Place | 'own' | undefined => {
  for (const pack of prefer) { const at = packObjects(m, pack)?.objects.get(digest); if (at) return at; }
  if (m.storage.objects.has(own)) return 'own';
  for (const key of m.storage.objects.keys()) {
    const pack = /\/content\/pack\/([0-9a-f]{64})\.pack$/.exec(key)?.[1];
    const at = pack && !prefer.includes(pack) ? packObjects(m, pack)?.objects.get(digest) : undefined;
    if (at) return at;
  }
  return undefined;
};

/** A part's pointer; P98 R10: `place` where the part lives inside a pack (none for a part stored as its own object). */
export interface Pointer { digest: string; records: number; place?: Place }
export interface ShardPointer { digest: string; products: number; records: number }
/**
 * The catalogue's index as stored, in whichever form the manifest carries it; `missing` names an object a pointer names
 * and the store lacks (P98 R10: the pack's key where the object lives in a pack); `places` names, for each shard and id
 * shard pointer that carries a byte range, the pack and range it is read from (P98, R-P549).
 */
export interface IndexView {
  form: 'one-level' | 'sharded' | 'none';
  products: Record<string, Pointer>;
  ids: Record<string, string>;
  shards: Record<string, ShardPointer>;
  idShards: Record<string, { digest: string; records: number }>;
  missing: string[];
  places?: { shards: Record<string, Place>; idShards: Record<string, Place> };
}
export function indexOf(m: Mounted, document: Record<string, unknown>): IndexView {
  const view: IndexView = { form: 'none', products: {}, ids: {}, shards: {}, idShards: {}, missing: [] };
  const index = document.index as { shards?: Record<string, ShardPointer>; ids?: Record<string, { digest: string; records: number }>; packs?: unknown[] } | undefined;
  if (index && typeof index === 'object') {
    view.form = 'sharded'; view.shards = index.shards ?? {}; view.idShards = index.ids ?? {};
    const places: NonNullable<IndexView['places']> = { shards: {}, idShards: {} };
    // P98 R10 (R-P569 (b), R-P578 (c)): a manifest pointer into a pack carries `{ pack, at, bytes, … }` (its pack the table's
    // row) and no digest; the view names it by the digest of the object stored there. A pointer with a digest and no range
    // is an object of its own; a part pointer inside a shard carries its digest and, in a pack, its range.
    const table = (index.packs ?? []).map(packDigest);
    const shards: Record<string, ShardPointer> = {}, idShards: Record<string, { digest: string; records: number }> = {};
    for (const [name, pointer] of Object.entries(view.shards)) {
      const place = placeOf(pointer as { pack?: unknown; at?: unknown; bytes?: unknown }, table);
      if (place) places.shards[name] = place;
      const body = place ? placedAt(m, place) : parsedAt(m, KEY.shard(pointer.digest));
      shards[name] = { ...pointer, digest: named(pointer.digest, place, body) };
      if (!body) { view.missing.push(place ? KEY.pack(place.pack) : KEY.shard(pointer.digest)); continue; }
      const own = Array.isArray(body.packs) ? body.packs as unknown[] : undefined;
      for (const [product, p] of Object.entries(body.products as Record<string, Pointer & { pack?: unknown; at?: unknown; bytes?: unknown }>)) {
        const partPlace = placeOf(p, own, place?.pack);
        view.products[product] = { digest: p.digest, records: p.records, ...(partPlace ? { place: partPlace } : {}) };
      }
    }
    for (const [name, pointer] of Object.entries(view.idShards)) {
      const place = placeOf(pointer as { pack?: unknown; at?: unknown; bytes?: unknown }, table);
      if (place) places.idShards[name] = place;
      const body = place ? placedAt(m, place) : parsedAt(m, KEY.idshard(pointer.digest));
      idShards[name] = { ...pointer, digest: named(pointer.digest, place, body) };
      if (!body) { view.missing.push(place ? KEY.pack(place.pack) : KEY.idshard(pointer.digest)); continue; }
      Object.assign(view.ids, body.ids as Record<string, string>);
    }
    view.shards = shards; view.idShards = idShards;
    if (Object.keys(places.shards).length || Object.keys(places.idShards).length) view.places = places;
  } else if (document.products && typeof document.products === 'object') {
    view.form = 'one-level'; view.products = document.products as Record<string, Pointer>;
    const pointer = document.idIndex as { digest?: string } | undefined;
    if (pointer?.digest) {
      const body = parsedAt(m, KEY.ids(pointer.digest));
      if (body) view.ids = body.ids as Record<string, string>; else view.missing.push(KEY.ids(pointer.digest));
    }
  }
  view.products = Object.fromEntries(Object.keys(view.products).sort().map(p => [p, view.products[p]!]));
  return view;
}
/**
 * Every object a revision value names beside its body (either form): its parts, its id index or id shards and its
 * shards, each by the key of the object the store holds it in — P98 R10: the pack's key for one that lives in a pack,
 * and every pack the manifest's pack table names.
 */
export function namedBy(m: Mounted, value: Record<string, unknown>): Set<string> {
  const view = indexOf(m, value), out = new Set<string>();
  for (const pointer of Object.values(view.products)) out.add(pointer.place ? KEY.pack(pointer.place.pack) : KEY.part(pointer.digest));
  for (const [name, pointer] of Object.entries(view.shards)) { const place = view.places?.shards[name]; out.add(place ? KEY.pack(place.pack) : KEY.shard(pointer.digest)); }
  for (const [name, pointer] of Object.entries(view.idShards)) { const place = view.places?.idShards[name]; out.add(place ? KEY.pack(place.pack) : KEY.idshard(pointer.digest)); }
  const table = (value.index as { packs?: unknown[] } | undefined)?.packs;
  if (Array.isArray(table)) for (const entry of table) if (packDigest(entry)) out.add(KEY.pack(packDigest(entry)));
  const ids = value.idIndex as { digest?: string } | undefined;
  if (ids?.digest) out.add(KEY.ids(ids.digest));
  return out;
}
/** The content revisions whose bodies are still stored, and their values. */
export function storedRevisionValues(m: Mounted): Array<Record<string, unknown>> {
  return [...m.storage.objects.entries()].filter(([key]) => /\/content\/rev\/[0-9]+\.json$/.test(key))
    .map(([, raw]) => (JSON.parse(raw) as { value?: Record<string, unknown> }).value ?? {});
}
/** P98 R10 (R-P569 (b)): the objects inside a stored pack, each named by the key it would have as an object of its own (its kind read from its value). */
export function packedObjects(m: Mounted, pack: string): Array<{ key: string; at: number; bytes: number }> {
  const held = packObjects(m, pack);
  if (!held) return [];
  return [...held.objects].filter(([, place]) => place.kind !== null).map(([digest, place]) => ({ key: KEY[place.kind!](digest), at: place.at, bytes: place.bytes }));
}
/** P98 R10: the key an object of its own has (a part, a shard or an id shard, by its class and its full digest). */
const OWN = /\/content\/(part|shard|idshard)\/([0-9a-f]{64})\.json$/;
/** P98 R10: an object inside a stored pack, by the key it would have as its own: the pack's key, its raw text and the object's place. */
function inPack(m: Mounted, key: string): { packKey: string; raw: string; at: number; bytes: number } | null {
  const own = OWN.exec(key);
  if (!own || m.storage.objects.has(key)) return null;
  const where = locate(m, own[2]!, key, []);
  if (!where || where === 'own') return null;
  return { packKey: KEY.pack(where.pack), raw: m.storage.objects.get(KEY.pack(where.pack))!, at: where.at, bytes: where.bytes };
}
/** P98 R10: rewrite one object's bytes where they lie in its pack (its range and the pack's length kept). Answers what to put back. */
function alterInPack(m: Mounted, key: string, change: (bytes: Buffer) => void): () => void {
  const found = inPack(m, key);
  if (!found) return () => undefined;
  const bytes = Buffer.from(found.raw, 'utf8');
  change(bytes.subarray(found.at, found.at + found.bytes));
  m.storage.objects.set(found.packKey, bytes.toString('utf8'));
  return () => { m.storage.objects.set(found.packKey, found.raw); };
}
/**
 * P98 R10 (R-P569 (b)): lose an object as a test loses it: an object of its own is deleted; one inside a pack has its
 * bytes lost where they lie (each byte of its range a space; its neighbours, its pack and the pack's length untouched),
 * for a pack never loses one object alone. Answers what to put back.
 */
export function loseObject(m: Mounted, key: string): () => void {
  const raw = m.storage.objects.get(key);
  if (raw !== undefined) { m.storage.objects.delete(key); return () => { m.storage.objects.set(key, raw); }; }
  return alterInPack(m, key, bytes => { bytes.fill(0x20); });
}
/**
 * P98 R10 (R-P569 (b)): a body that is not its digest's where the object lies: an object of its own is replaced by
 * `other`'s stored text (as before packs); one inside a pack keeps its range and length, one character of its first
 * string value changed (a well-formed value whose digest is another). Answers what to put back.
 */
export function forgeObject(m: Mounted, key: string, other: string): () => void {
  const raw = m.storage.objects.get(key);
  if (raw !== undefined) { m.storage.objects.set(key, heldRaw(m, other) ?? raw); return () => { m.storage.objects.set(key, raw); }; }
  return alterInPack(m, key, bytes => {
    const at = bytes.indexOf('":"', 0, 'utf8') + 3, c = bytes[at];
    if (at >= 3 && c !== undefined && c >= 0x41 && c <= 0x7a && c !== 0x5c) bytes[at] = c === 0x41 ? 0x42 : 0x41;
  });
}
/**
 * P98 R10 (R-P569 (b)): the stored text of the object a key names — its object of its own, else (a part, a shard or an
 * id shard) the bytes a stored pack holds of the object with that digest; null where the store holds it nowhere.
 */
export function heldRaw(m: Mounted, key: string): string | null {
  const raw = m.storage.objects.get(key);
  if (raw !== undefined) return raw;
  const own = OWN.exec(key);
  return own ? storedValue(m, own[1] as 'part' | 'shard' | 'idshard', own[2]!).raw : null;
}
/** P98 R10: whether the store holds the object a key names (as its own, or inside a stored pack by that digest). */
export const held = (m: Mounted, key: string) => heldRaw(m, key) !== null;
/**
 * P98 R10 (R-P569 (b)): the keys of one class the store holds — its objects of their own and, for parts, shards and id
 * shards, each object inside a stored pack, by the key it would have as its own (one key per digest).
 */
export function heldKeys(m: Mounted, cls: string): string[] {
  const out = new Set(objectKeys(m, cls));
  if (cls === 'part' || cls === 'shard' || cls === 'idshard') {
    for (const key of objectKeys(m, 'pack')) for (const o of packedObjects(m, /([0-9a-f]{64})\.pack$/.exec(key)![1]!)) if (classOf(o.key) === cls) out.add(o.key);
  }
  return sorted(out);
}
/** P98 R10 (R-P569 (b)): a shard, an id shard or a part as stored, by its digest: from the pack that holds it, else its own object. */
export function storedValue(m: Mounted, kind: 'shard' | 'idshard' | 'part', digest: string, prefer: readonly string[] = []): { value: Record<string, unknown> | null; key: string; raw: string | null } {
  const own = KEY[kind](digest), where = locate(m, digest, own, prefer);
  if (where === 'own') { const raw = m.storage.objects.get(own) ?? null; return { value: raw === null ? null : JSON.parse(raw) as Record<string, unknown>, key: own, raw }; }
  if (!where) return { value: null, key: own, raw: null };
  const bytes = packObjects(m, where.pack)!.bytes.subarray(where.at, where.at + where.bytes).toString('utf8');
  return { value: JSON.parse(bytes) as Record<string, unknown>, key: KEY.pack(where.pack), raw: bytes };
}
/**
 * P98 R10 (R-P569 (b)): the records stored in P93's form beside the routes, as the release before packs stores them —
 * each product's part, product shard and id shard an object of its own at its content address (canonical bytes), the
 * manifest's `index` naming them with no byte range — published over the catalogue in force by the publication
 * authority (no route writes that form once packs exist). The pieces are the validator's own, routed as the catalogue
 * routes them (every slot type the carousel and a featured product: that product's part; else shared). Answers each
 * product's part digest.
 */
export async function storedBeforePacks(m: Mounted, records: unknown[], version: string, note: string): Promise<Map<string, string>> {
  const checked = CONTENT_KIND.validate({ pieces: [...MODULES, ...records] });
  if (!checked.ok) throw new Error(`P93 fixture: ${checked.errors.slice(0, 3).join('; ')}`);
  const shared: unknown[] = [], byProduct = new Map<string, unknown[]>();
  for (const piece of checked.value.pieces) {
    const product = piece.slotTypes?.every(s => s === CAROUSEL) && piece.featuredProductIds?.[0] ? piece.featuredProductIds[0] : null;
    if (product === null) shared.push(piece); else byProduct.set(product, [...(byProduct.get(product) ?? []), piece]);
  }
  const digests = new Map<string, string>(), shards = new Map<string, Record<string, { digest: string; records: number }>>(), idShards = new Map<string, Record<string, string>>();
  for (const [product, pieces] of byProduct) {
    const value = { product, pieces }, digest = digestOfValue(value);
    await m.storage.put(KEY.part(digest), canonical(value)); digests.set(product, digest);
    const shard = shards.get(bucketOf(product)) ?? {}; shard[product] = { digest, records: pieces.length }; shards.set(bucketOf(product), shard);
    for (const piece of pieces as Array<{ id: string }>) { const ids = idShards.get(bucketOf(piece.id)) ?? {}; ids[piece.id] = product; idShards.set(bucketOf(piece.id), ids); }
  }
  const sortedOf = <T>(o: Record<string, T>) => Object.fromEntries(Object.keys(o).sort().map(k => [k, o[k]!]));
  const index = { key: 'sha256-hex2', shards: {} as Record<string, unknown>, ids: {} as Record<string, unknown> };
  for (const name of [...shards.keys()].sort()) {
    const value = { shard: name, products: sortedOf(shards.get(name)!) }, digest = digestOfValue(value);
    await m.storage.put(KEY.shard(digest), canonical(value));
    index.shards[name] = { digest, products: Object.keys(value.products).length, records: Object.values(value.products).reduce((n, p) => n + p.records, 0) };
  }
  for (const name of [...idShards.keys()].sort()) {
    const value = { shard: name, ids: sortedOf(idShards.get(name)!) }, digest = digestOfValue(value);
    await m.storage.put(KEY.idshard(digest), canonical(value));
    index.ids[name] = { digest, records: Object.keys(value.ids).length };
  }
  const manifest = { version, productSlots: [CAROUSEL], pieces: shared, index }, base = await loadDocument(m, 'catalog');
  const written = await publish<ContentCatalog>(m.env, CONTENT_KIND, TENANT, { type: 'replace', candidate: manifest },
    { actor: 'p93-fixture', note, operationId: `${base.revision}:${crypto.randomUUID()}`, expectedRevision: base.revision, expectedPublication: base.publication }, () => manifest);
  if (!written.ok) throw new Error(`P93 fixture: the stored form was refused: ${written.errors.slice(0, 3).join('; ')}`);
  invalidatePublicationCache();
  return digests;
}
/** A product's part as stored, read through a pointer (P98 R10: from its pack's byte range where it lives in a pack). */
export function partAt(m: Mounted, pointer: Pointer | undefined): { ids: string[]; value: Record<string, unknown> | null } {
  const value = pointer ? pointer.place ? placedAt(m, pointer.place) : parsedAt(m, KEY.part(pointer.digest)) : null;
  return { ids: sorted(((value?.pieces ?? []) as Array<{ id: string }>).map(p => p.id)), value };
}

// ── The meter: every call on the mount's bucket ──────────────────────────────────────────────────────────────────────
export interface Op { op: 'get' | 'put' | 'head' | 'list' | 'delete'; key: string }
/** Every bucket call one operation makes, in order, through whatever the bucket answers with now (an earlier override included). */
export async function metered<T>(m: Mounted, run: () => Promise<T>): Promise<{ result: T; ops: Op[] }> {
  const bucket = m.storage as unknown as Record<string, unknown>, ops: Op[] = [], saved = new Map<string, PropertyDescriptor | undefined>();
  for (const name of ['get', 'put', 'head', 'list', 'delete'] as const) {
    saved.set(name, Object.getOwnPropertyDescriptor(bucket, name));
    const current = (bucket[name] as (...args: unknown[]) => unknown).bind(m.storage);
    Object.defineProperty(bucket, name, { configurable: true, writable: true, value: async (...args: unknown[]) => {
      const first = args[0], key = name === 'list' ? String((first as { prefix?: string } | undefined)?.prefix ?? '') : Array.isArray(first) ? first.join(',') : String(first);
      // P98 R10 (R-P569 (b)): a read or a write of a pack is a read or a write of each object inside the bytes it moves.
      const pack = /\/content\/pack\/([0-9a-f]{64})\.pack$/.exec(key)?.[1];
      if (pack && name === 'get') {
        const range = (args[1] as { range?: { offset?: number; length?: number } } | undefined)?.range, inside = packedObjects(m, pack);
        const from = range?.offset ?? 0, to = range?.length === undefined ? Infinity : from + range.length;
        if (inside.length) { for (const o of inside) if (o.at >= from && o.at + o.bytes <= to) ops.push({ op: name, key: o.key }); return current(...args); }
      }
      const result = await current(...args);
      if (pack && name === 'put' && result) { for (const o of packedObjects(m, pack)) ops.push({ op: name, key: o.key }); return result; }
      ops.push({ op: name, key });
      return result;
    } });
  }
  try { return { result: await run(), ops }; }
  finally { for (const [name, descriptor] of saved) { if (descriptor) Object.defineProperty(bucket, name, descriptor); else Reflect.deleteProperty(bucket, name); } }
}
/** The distinct keys of one class an operation touched with one call. */
export const touched = (ops: readonly Op[], op: Op['op'], cls: string) => unique(ops.filter(o => o.op === op && classOf(o.key) === cls).map(o => o.key));
/** The reads of one operation, classed, in sorted order (the page counter of P86's S8, with the shard and id-shard classes). */
export const readClasses = (ops: readonly Op[]) => sorted(ops.filter(o => o.op === 'get' && o.key.startsWith('config-publication/')).map(o => classOf(o.key) === 'part' || classOf(o.key) === 'shard' ? o.key : classOf(o.key)));

// ── The shopper's page ───────────────────────────────────────────────────────────────────────────────────────────────
export async function snapshotOf(m: Mounted, s: Shopper, page: string, signals: Record<string, string>, label: string): Promise<Snapshot> {
  const pageInstance = pageInstanceOf(label);
  const ctx = Object.entries(signals).map(([name, value]) => `&ctx.${name}=${encodeURIComponent(value)}`).join('');
  const response = await m.fetch(new Request(`https://shop.invalid/v1/${TENANT}/decisions/snapshot?page=${page}&brand=${BRAND}&pageInstance=${pageInstance}${ctx}`,
    { method: 'GET', headers: { 'X-Tenant': TENANT, [SHOPPER_HEADER]: s.grant.capability } }));
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  await m.drain();
  return { status: response.status, body, page, pageInstance, decisions: (body.decisions ?? []) as Decision[] };
}
export const carousel = (snapshot: Snapshot) => sorted(servedIn(snapshot, CAROUSEL));

// ── The range ────────────────────────────────────────────────────────────────────────────────────────────────────────
/** The import's caps hold for one load (src/config/input.ts, unchanged). */
export const withinCaps = (records: unknown[]) => records.length <= INPUT_MAX_RECORDS && bytesOf(JSON.stringify(records)) < INPUT_MAX_BYTES;
/** A tenant declaring its product slots, with P80's images and the generator's first `n` products loaded in chunks of `chunk`. */
export async function rangeTenant(host: Host, n: number, chunk = 5000, documents: Documents = DOCS_WITH_CART): Promise<Mounted> {
  const m = await mount(host, documents);
  expectPublished(m, 'P93 — the tenant documents publish');
  await declareProductSlots(m);
  for (let from = 1; from <= n; from += chunk) {
    const records = [...(from === 1 ? [...ANCHOR_IMAGES, ...OTHER_IMAGES] : []), ...rangeRecords(from, Math.min(chunk, n - from + 1))];
    expect(withinCaps(records), `PRECONDITION: the load of products ${from}… is within the import's caps`).toBe(true);
    const loaded = await importJson(m, records, { mode: 'merge' });
    expect(loaded.status, `PRECONDITION (${host}): the range's products ${from}… load (${show(loaded)})`).toBe(200);
  }
  invalidatePublicationCache();
  return m;
}
/** The manifest in force and its index. */
export async function catalogue(m: Mounted): Promise<{ doc: LoadedSlots; view: IndexView }> {
  const doc = await loadDocument(m, 'catalog');
  return { doc, view: indexOf(m, doc.document) };
}

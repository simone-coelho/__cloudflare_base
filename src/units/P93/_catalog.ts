// src/units/P93/_catalog.ts
// P93's harness. P86's fixture and generator (src/units/P86/LEDGER.unit.test.ts :202–258, copied here because a test
// file exports nothing), the catalogue's objects read in either form — P86's one-level manifest (`products`, `idIndex`,
// `content/part/`, `content/ids/`) and P93's sharded one (`index`, `content/shard/`, `content/idshard/`) — the storage
// meter (every call on the mount's bucket, classed), the decision request with the page's ctx signals and the range
// loaded in chunks within the import's caps. It holds no expected value: it mounts, calls and reads back.

import { createHash } from 'node:crypto';
import { expect, vi } from 'vitest';

import { INPUT_MAX_BYTES, INPUT_MAX_RECORDS } from '@/config/input';
import { invalidatePublicationCache } from '@/config/publication';
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
};
const CLASSES: Array<[string, RegExp]> = [['part', /\/content\/part\/[0-9a-f]{64}\.json$/], ['shard', /\/content\/shard\/[0-9a-f]{64}\.json$/],
  ['idshard', /\/content\/idshard\/[0-9a-f]{64}\.json$/], ['ids', /\/content\/ids\/[0-9a-f]{64}\.json$/]];
/** A key's class: part, shard, idshard, ids (P86's one id index), head, set, `<kind> revision`, else the key itself. */
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

export interface Pointer { digest: string; records: number }
export interface ShardPointer { digest: string; products: number; records: number }
/** The catalogue's index as stored, in whichever form the manifest carries it; `missing` names an object a pointer names and the store lacks. */
export interface IndexView {
  form: 'one-level' | 'sharded' | 'none';
  products: Record<string, Pointer>;
  ids: Record<string, string>;
  shards: Record<string, ShardPointer>;
  idShards: Record<string, { digest: string; records: number }>;
  missing: string[];
}
export function indexOf(m: Mounted, document: Record<string, unknown>): IndexView {
  const view: IndexView = { form: 'none', products: {}, ids: {}, shards: {}, idShards: {}, missing: [] };
  const index = document.index as { shards?: Record<string, ShardPointer>; ids?: Record<string, { digest: string; records: number }> } | undefined;
  if (index && typeof index === 'object') {
    view.form = 'sharded'; view.shards = index.shards ?? {}; view.idShards = index.ids ?? {};
    for (const pointer of Object.values(view.shards)) {
      const body = parsedAt(m, KEY.shard(pointer.digest));
      if (!body) { view.missing.push(KEY.shard(pointer.digest)); continue; }
      Object.assign(view.products, body.products as Record<string, Pointer>);
    }
    for (const pointer of Object.values(view.idShards)) {
      const body = parsedAt(m, KEY.idshard(pointer.digest));
      if (!body) { view.missing.push(KEY.idshard(pointer.digest)); continue; }
      Object.assign(view.ids, body.ids as Record<string, string>);
    }
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
/** Every object a revision value names beside its body (either form): its parts, its id index or id shards and its shards. */
export function namedBy(m: Mounted, value: Record<string, unknown>): Set<string> {
  const view = indexOf(m, value), out = new Set<string>();
  for (const pointer of Object.values(view.products)) out.add(KEY.part(pointer.digest));
  for (const pointer of Object.values(view.shards)) out.add(KEY.shard(pointer.digest));
  for (const pointer of Object.values(view.idShards)) out.add(KEY.idshard(pointer.digest));
  const ids = value.idIndex as { digest?: string } | undefined;
  if (ids?.digest) out.add(KEY.ids(ids.digest));
  return out;
}
/** The content revisions whose bodies are still stored, and their values. */
export function storedRevisionValues(m: Mounted): Array<Record<string, unknown>> {
  return [...m.storage.objects.entries()].filter(([key]) => /\/content\/rev\/[0-9]+\.json$/.test(key))
    .map(([, raw]) => (JSON.parse(raw) as { value?: Record<string, unknown> }).value ?? {});
}
/** A product's part as stored, read through a pointer. */
export function partAt(m: Mounted, pointer: Pointer | undefined): { ids: string[]; value: Record<string, unknown> | null } {
  const value = pointer ? parsedAt(m, KEY.part(pointer.digest)) : null;
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
      ops.push({ op: name, key });
      return current(...args);
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

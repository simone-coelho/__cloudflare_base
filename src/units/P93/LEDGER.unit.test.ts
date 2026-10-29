// src/units/P93/LEDGER.unit.test.ts
// P93 under the Closure Ledger (programme `tapestry-parity-scale`, amendment 12, item E18): the tests for the LOCAL
// criteria CS1–CS7 of the P93 work order (docs/parity/scale/program.json). LV1 is a deferred live row and gets no test.
//
// THE REQUIREMENT, verbatim (docs/parity/authority/amendment-12/BTI-Parity-Amendment-2026-10-26-scale.md:9–13, E18):
//   "#### E18 · The catalogue index for 40,000 products and more
//    - **Authority:** the owner's words above (recorded under E10 of the 22 October amendment, §3 row 6); the analyst's
//      read `S37/analyst/E10-40K-SHAPES.md` ruled R-P487.
//    - **Done when:** the catalogue's index is sharded (256 content-addressed product shards and 256 id shards by a hash
//      of the product id and of the record id; the manifest names the shards and stays about 55 KB at any size); a
//      product page reads the manifest, one shard and one part; a load reads and rewrites only the shards and parts its
//      products touch; the three collision refusals, the skip, the dry run, the per-product modes, the per-product read,
//      the rollback (bounded by the difference, `rollback_too_large` past 900 checks) and the purge (attachments resolved
//      before a body is deleted, bucket-local, paged, the 15-minute grace) hold across shards; a one-level catalogue is
//      rewritten into shards by its next publication with no operator step; the ingest vocabulary resolves a parted
//      product's ids; verified in the harness at 40,000 products on both hosts and 100,000 on the session host with the
//      real caps; the kits state it.
//    - **Starts from:** … **Relates to:** E2, E10. **Needed by:** the December test. Two to three days."
//   The owner (amendment 12 §1): "They can have up to 40,000 products or more. You cannot gate it to 20,000."
//
// THE READINGS THE LEAD SET (R-P487, the brief S37/SPEC-BRIEF-P93.md; R-P490), each shown by a leg below:
//   1 The index. The manifest keeps `version`, `typeFallback`, `productSlots` and the shared `pieces` and carries
//     `index: { key: "sha256-hex2", shards: { "<hex2>": { digest, products, records } }, ids: { "<hex2>": { digest,
//     records } } }` in place of `products`/`idIndex`; only non-empty shards listed; a product's shard is the first two
//     hex digits of SHA-256 of its id's UTF-8 bytes, an id shard the same of the record id. Shard objects at
//     `content/shard/<digest>.json` (`{ shard, products: { "<productId>": { digest, records } } }`) and
//     `content/idshard/<digest>.json` (`{ shard, ids: { "<record id>": "<product id>" } }`), written by exact-create
//     before the head is reserved, at most 2 MiB each (413 `index_shard_too_large`, 413 `id_index_too_large`, each
//     naming the shard and its count: the ticket's CS3); `manifest_too_large` driven by the shared pieces alone; the
//     manifest's bytes equal within 5% at 5,000, 40,000 and 100,000 products and at most 64 KB beside the shared
//     pieces.                                                                                                      CS1, CS3
//   2 The page reads head, set, the four revisions, the anchor's shard and part (8 reads; P102 R10, R-P570: the head, the
//     serving copy, the shard and the part by its range in its pack, 4 reads) at N = 50, 5,000, 40,000 and
//     100,000; warm no shard and no part; none where none is needed; a listed-but-absent anchor reads the shard alone;
//     a lost shard or part 503 `part_unavailable`.                                                                    CS2
//   3 The loads read the shards of the products they name, their parts, and only the id shards of ids whose place can
//     change; they write only what moved; skip, dry run, P91's modes and the three collisions as today.               CS3
//   4 The reads (the sharded manifest, `?shard=<hex2>`, `?product=`) and the PUT (`index` exactly as read, else 422
//     naming the shard; `removeProducts`, which also clears a lost part; the envelope counted from the pointers).  CS3, CS6
//   5 The rollback bounded by the difference (410 `part_missing` naming what is missing; 413 `rollback_too_large` past
//     900 checks with the count); the purge resolving attachments before a body, the 15-minute grace.                 CS5
//   6 The readers through the shard: replay, receipts, learn routes, telemetry (own ring), P85's beacon, the per-product
//     read, the ingest vocabulary.                                                                                     CS6
//   7 The migration: both forms read; the next PUT, import, pull or rollback writes the sharded form, part digests
//     unchanged, at most 512 shard writes; LOCK: no `productSlots`, no shard.                                         CS4
//   8 The verification at 40,000 on both hosts and 100,000 on the session host, chunks of 5,000 within the input caps.
//                                                                                                                  CS1, CS2
//   9 The kits.                                                                                                       CS7
//  10 The locks (the gate).
//   R-P490 (the lead, on the builder's first head): (1) a one-level document (no `index`) PUT over a one-level catalogue
//   keeps P86's rule, a product omitted is removed, and lands sharded with every other part digest unchanged; a
//   one-level document PUT over a sharded catalogue that holds products is refused 422 for the missing `index`; every
//   other PUT removes a product only by `removeProducts`. (2) `?shard=` for a shard the index does not list answers an
//   empty shard (200, no products); a malformed shard name 400. (3) The migration from a STORED one-level catalogue,
//   planted beside the routes (oneLevelTenant below). (4) The purge with its budget exhausted mid-sweep: attachments
//   before the body, the sweep resuming on the next pass, no part lost.
//
// SPECIFIER'S READINGS (where the rulings leave a shape open; the lead may re-rule):
//   a `?shard=<hex2>` answers 200 with `digest` (the pointer's) and `document` = the shard object as stored.
//   b `removeProducts` is a member of the PUT's document (beside `index`, as read), never stored in the revision.
//   c The rollback's checks are counted as the target's shards and id shards whose digest differs from the revision in
//     force under the same name, plus the part pointers inside those product shards that differ; reading the in-force
//     shard of a differing bucket to compare is a read, not a check, and is allowed. A missing part is named by its
//     product (P86's R-P409 (3) leg names the product; that leg is a lock), a missing shard by its two hex digits.
//   d The one-level fixture is planted through the publication authority's own `publish` with the content kind as
//     registered (no route: none writes that form any more), its parts and id index written into the bucket directly.
//     The pending-head check re-validates a document with the registered kind, so the content kind keeps admitting
//     P86's form (reading 7: every reader accepts both forms).
//   e "Exhausted mid-sweep" is the purge's first deletion of an attachment (a part, shard, id shard or id index) failing
//     once, before it deletes anything; "no part lost" is: nothing left that no stored revision names, and every object
//     the current and the previous revision name still stored.
//
// THE R10 ON src/units/P86/LEDGER.unit.test.ts (granted by name, R-P489): the report lists each item before/after.
//
// DEFERRALS: LV1 (the pair at the next release; the live probe of R2's per-invocation call limit; the chunking advice
// of 200–300 products stands until measured). RESIDUALS: the storage calls of one 5,000-product chunk (about 5,000 part
// writes) are not bounded by this ticket; the purge's orphan lag on churn nights is told, not tested; the time at 40k and
// 100k is recorded in the failure messages, never asserted.
//
// HARNESS: src/units/_parity.ts (the mounted application, both hosts, the bucket double) and ./_catalog.ts (P86's
// fixture and generator, the two forms read back, the storage meter). Imports from src/units/: ../_parity, ./_catalog.

import { describe, expect, it } from 'vitest';

import { documentBytes, documentDigest, invalidatePublicationCache, publish, PUBLICATION_MAX_BYTES } from '@/config/publication';
import { CONTENT_KIND } from '@/content/kinds';
import type { ContentCatalog, DecisionRecord } from '@/content/types';

import {
  asOperator, declaredSlots, errorsOf, expectPublished, HOSTS, layoutSlot, loadDocument, M, MODULES, mount, pageInstanceOf, putDocument, readTree,
  receiptsOf, replayOf, servePage, shopperOn, storedDecisions, TENANT, UnitR2, type Answer, type Host, type Mounted, type Shopper,
} from '../_parity';
import {
  A, ANCHOR_IMAGES, B, BLACK, bucketOf, bytesOf, C, carousel, CAROUSEL, catalogue, classOf, declareProductSlots, DOCS, DOCS_WITH_CART, fourOf, heldKeys, heldRaw, image,
  importJson, KEY, LEARN, loseObject, metered, MODULE_IDS, namedBy, objectKeys, OTHER_IMAGES, placedKey, placedReadClasses, preconditions, productRead, pull, rangeProduct, rangeRecordId,
  rangeRecords, rangeTenant, readAsWanted, readClasses, readIds, SERVED_FOR_BLACK, shardRead, SHOTS, show, snapshotOf, sorted, storedBeforePacks, touched, unique, UNKNOWN, withinCaps,
  type IndexView, type Op, type Rec,
} from './_catalog';

const MiB2 = PUBLICATION_MAX_BYTES;
const HEX64 = /^[0-9a-f]{64}$/;
/** The shared pieces of the range tenant: the modules and the brand image (no product). */
const SHARED = sorted([...MODULE_IDS, 'img-brand-1']);
/** The products and part records the range tenant holds: P80's anchor images in A's part, one each for B and the unknown product, one per range product. */
function expectedParts(n: number): Map<string, string[]> {
  const parts = new Map<string, string[]>([[A, ANCHOR_IMAGES.map(r => r.id)], [B, ['img-cb925-1']], [UNKNOWN, ['img-zz999-1']]]);
  for (let k = 1; k <= n; k++) parts.set(rangeProduct(k), [rangeRecordId(k)]);
  return parts;
}
/**
 * Reading 2's read list as P102 re-points it (E27, CR3; R10 by name): the head and the serving copy, the anchor's shard
 * and its part, once each; P102 R10 onto P98's pack reads (R-P570 (d)): a shard or part inside a pack is read by its
 * range in that pack (placedKey), one of its own as its own object.
 */
const pageReads = (view: IndexView, anchor = A) => sorted(['head', `config-publication/v2/${TENANT}/serving.json`,
  placedKey(KEY.shard(view.shards[bucketOf(anchor)]?.digest ?? `no shard for ${anchor}`), view.places?.shards[bucketOf(anchor)]),
  placedKey(KEY.part(view.products[anchor]?.digest ?? `no pointer for ${anchor}`), view.products[anchor]?.place)]);
const shardOrPart = (reads: string[]) => reads.filter(r => ['shard', 'idshard', 'part'].includes(classOf(r)));
/** Whether an error of the answer names each word as a word (a shard's two hex digits are not matched inside a number or a digest). */
const names = (a: Answer, ...words: string[]) => errorsOf(a).some(e => words.every(w => new RegExp(`(^|[^0-9A-Za-z])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^0-9A-Za-z]|$)`).test(e)));
const named = (a: Answer, ...words: string[]) => names(a, ...words) ? `names ${words.join(', ')}` : `does not (${show(a)})`;
const countNamed = (a: Answer, n: number) => names(a, String(n)) || names(a, n.toLocaleString('en-US')) ? `names ${n}` : `does not (${show(a)})`;
const requireSharded = (view: IndexView, what: string) => expect(view.form, `PRECONDITION: ${what} — the manifest carries the sharded index (today: ${view.form})`).toBe('sharded');
/** An id `<prefix><k>` whose bucket the index lists (`listed`) or does not, and which no shard holds as a product. */
function idByListing(prefix: string, view: IndexView, listed: boolean): string {
  for (let k = 0; ; k++) { const id = `${prefix}${k}`; if (Object.hasOwn(view.shards, bucketOf(id)) === listed && !view.products[id]) return id; }
}
/** The bytes of every shard object in force (product shards and id shards). */
const shardSizes = (m: Mounted, view: IndexView) => [...Object.values(view.shards).map(p => KEY.shard(p.digest)), ...Object.values(view.idShards).map(p => KEY.idshard(p.digest))]
  .map(key => bytesOf(heldRaw(m, key) ?? '')); // P98 R10 (R-P569 (b)): the object as stored, in its pack or as its own
const digestsOf = (view: IndexView) => Object.fromEntries(Object.entries(view.products).map(([p, v]) => [p, v.digest]));
const without = (digests: Record<string, string>, ...products: string[]) => Object.fromEntries(Object.entries(digests).filter(([p]) => !products.includes(p)));
const pause = () => new Promise(resolve => setTimeout(resolve, 5));
/** R-P424: the bucket's own `uploaded` member (R2's, on list, head and get), as `when` names it for each key. */
function uploadedAt(m: Mounted, when: (key: string) => Date): () => void {
  const bucket = m.storage as unknown as Record<string, unknown>, proto = UnitR2.prototype;
  Object.defineProperty(bucket, 'list', { configurable: true, writable: true, value: async (options?: { prefix?: string; cursor?: string; limit?: number }) => {
    const listed = await proto.list.call(m.storage, options);
    return { ...listed, objects: listed.objects.map(o => ({ ...o, uploaded: when(o.key) })) };
  } });
  Object.defineProperty(bucket, 'head', { configurable: true, writable: true, value: async (key: string) => {
    const found = await proto.head.call(m.storage, key); return found ? { ...found, uploaded: when(key) } : null;
  } });
  Object.defineProperty(bucket, 'get', { configurable: true, writable: true, value: async (key: string, options?: { range?: { offset?: number; length?: number } }) => {
    // P98 R10 (R-P569 (b)): the read's range is honoured.
    const found = await proto.get.call(m.storage, key, options); return found ? { ...found, uploaded: when(key) } : null;
  } });
  return () => { for (const name of ['list', 'head', 'get']) Reflect.deleteProperty(bucket, name); };
}
/** The configuration retention setting at its smallest admitted duration (W38 B4), as P86's retention leg sets it. */
function shortRetention(m: Mounted): void {
  const retention = JSON.parse(String(m.env.RETENTION)) as { version: number; tenants: Record<string, Record<string, unknown>> };
  retention.tenants[TENANT]!.configuration = { id: 'p93-configuration-revisions', revision: 1, durationMs: 1, basis: 'occurred', renewal: 'new-record-only' };
  m.env.RETENTION = JSON.stringify(retention);
}

// ===========================================================================
// Reading 8: the verification at 40,000 (both hosts) and 100,000 (the session host), measured once per host and read by
// CS1 (capacity) and CS2 (the page at those sizes). It holds measured values only; the legs hold the expectations.
// ===========================================================================

interface SizeRow { products: number; largestShard: number; reads: Array<[number, string[]]>; page: [number, string[], string[], string[]]; expectedPage: string[] }
interface Verification { statuses: number[]; refused: string | null; at: Record<number, SizeRow>; bytes: Record<number, number>; shared: number; seconds: number;
  /** P98 R10 (R-P578 (a)): the manifest's bytes less its pack table, and the table's rows, at each size. */
  lessTable: Record<number, number>; tableRows: Record<number, number> }
const VERIFIED = new Map<Host, Promise<Verification>>();
const SIZES: Record<Host, number[]> = { session: [40000, 100000], do: [40000] };
function verified(host: Host): Promise<Verification> {
  let run = VERIFIED.get(host);
  if (!run) { run = verification(host, SIZES[host]); VERIFIED.set(host, run); }
  return run;
}
async function verification(host: Host, sizes: readonly number[]): Promise<Verification> {
  const started = Date.now(), chunk = 5000, last = Math.max(...sizes), m = await mount(host, DOCS_WITH_CART);
  expectPublished(m, 'P93 — the tenant documents publish');
  await declareProductSlots(m);
  const out: Verification = { statuses: [], refused: null, at: {}, bytes: {}, shared: 0, seconds: 0, lessTable: {}, tableRows: {} };
  for (let loaded = 0; loaded < last;) {
    const records = [...(loaded === 0 ? [...ANCHOR_IMAGES, ...OTHER_IMAGES] : []), ...rangeRecords(loaded + 1, chunk)];
    expect(withinCaps(records), `PRECONDITION: the load of products ${loaded + 1}… is within the import's caps`).toBe(true);
    const answer = await importJson(m, records, { mode: 'merge' });
    out.statuses.push(answer.status);
    if (answer.status !== 200) { out.refused = `products ${loaded + 1}–${loaded + chunk} refused: ${show(answer)}`; break; }
    loaded += chunk;
    if (loaded !== 5000 && !sizes.includes(loaded)) continue;
    const { doc, view } = await catalogue(m);
    out.bytes[loaded] = documentBytes(doc.document);
    { const index = (doc.document.index ?? {}) as Record<string, unknown>, { packs, ...rest } = index;
      out.lessTable[loaded] = documentBytes({ ...doc.document, ...(doc.document.index ? { index: rest } : {}) }); out.tableRows[loaded] = Array.isArray(packs) ? packs.length : 0; }
    if (!sizes.includes(loaded)) continue;
    const reads: Array<[number, string[]]> = [];
    for (const k of [1, Math.floor(loaded / 2), loaded]) { const read = await productRead(m, rangeProduct(k)); reads.push([read.status, readIds(read)]); }
    const s = await shopperOn(m);
    invalidatePublicationCache();
    const cold = await metered(m, () => snapshotOf(m, s, 'pdp', { anchor: A, variant: BLACK }, 'p93-verify-cold'));
    const warm = await metered(m, () => snapshotOf(m, s, 'pdp', { anchor: A, variant: BLACK }, 'p93-verify-warm'));
    out.at[loaded] = { products: Object.keys(view.products).length, largestShard: Math.max(0, ...shardSizes(m, view)), reads,
      page: [cold.result.status, carousel(cold.result), placedReadClasses(cold), shardOrPart(readClasses(warm.ops))], expectedPage: pageReads(view) };
  }
  out.shared = documentBytes((await loadDocument(m, 'catalog')).document.pieces);
  out.seconds = Math.round((Date.now() - started) / 1000);
  return out;
}
const capacityOf = (run: Verification, n: number) => {
  const row = run.at[n];
  return row ? { products: row.products, largestShard: row.largestShard > 0 && row.largestShard <= MiB2 ? 'at most 2 MiB' : `${row.largestShard} bytes`, reads: row.reads }
    : `not reached (${run.refused ?? 'no refusal'})`;
};
const capacityExpected = (n: number) => ({ products: n + 3, largestShard: 'at most 2 MiB', reads: [1, Math.floor(n / 2), n].map(k => [200, [rangeRecordId(k)]]) });
const pageOf = (run: Verification, n: number) => run.at[n] ? { page: run.at[n]!.page } : `not reached (${run.refused ?? 'no refusal'})`;
const pageExpected = (run: Verification, n: number) => ({ page: [200, SERVED_FOR_BLACK, run.at[n]?.expectedPage ?? 'the 4 reads at this size', []] });

// ===========================================================================
// unit:P93.CS1 — capacity: the sharded index, and the range at 40,000 and 100,000 products
// ===========================================================================

describe('unit:P93.CS1 (R-P487: 256 shards by SHA-256 of the product id and of the record id)', () => {
  for (const host of HOSTS) {
    it(`host (${host}): reading 1 — the manifest keeps version, productSlots and the shared pieces and carries index { key: "sha256-hex2", shards, ids } in place of products and idIndex; each listed shard is the content-addressed object content/shard/<digest>.json holding exactly the products whose id's SHA-256 begins with its two hex digits, each id shard content/idshard/<digest>.json exactly the part records whose id's SHA-256 does; only non-empty shards listed; every shard at most 2 MiB; a shard written before the head is reserved (its write failing answers 503, nothing committed, nothing pending)`, async () => {
      const n = 600, m = await rangeTenant(host, n);
      const { doc, view } = await catalogue(m);
      expect.soft(sorted(Object.keys(doc.document)), `${host}: P93.CS1 — the manifest's members (today: ${sorted(Object.keys(doc.document)).join(', ')})`)
        .toEqual(['index', 'pieces', 'productSlots', 'version']);
      requireSharded(view, 'P93.CS1');
      const parts = expectedParts(n), byBucket = new Map<string, string[]>(), idsByBucket = new Map<string, string[]>();
      for (const [product, ids] of parts) {
        byBucket.set(bucketOf(product), [...(byBucket.get(bucketOf(product)) ?? []), product]);
        for (const id of ids) idsByBucket.set(bucketOf(id), [...(idsByBucket.get(bucketOf(id)) ?? []), id]);
      }
      const shards: Record<string, unknown> = {};
      for (const [bucket, pointer] of Object.entries(view.shards)) {
        // P98 R10 (R-P569 (b)): each object read as stored, in its pack or as its own (the view names a packed pointer's object by its full digest).
        const raw = heldRaw(m, KEY.shard(pointer.digest)), body = raw ? JSON.parse(raw) as { shard?: unknown; products?: Record<string, { digest: string; records: number }> } : null;
        const held = body?.products ?? {}, partsHeld: boolean[] = [];
        for (const [product, p] of Object.entries(held)) {
          const part = heldRaw(m, KEY.part(p.digest)), value = part ? JSON.parse(part) as { product?: unknown; pieces?: unknown[] } : null;
          partsHeld.push(value !== null && await documentDigest(value) === p.digest && value.product === product && value.pieces?.length === p.records);
        }
        shards[bucket] = { shard: body?.shard ?? null, products: sorted(Object.keys(held)), counted: [pointer.products, pointer.records],
          addressed: HEX64.test(pointer.digest) && body !== null && await documentDigest(body) === pointer.digest, parts: partsHeld.every(Boolean) };
      }
      const idShards: Record<string, unknown> = {};
      for (const [bucket, pointer] of Object.entries(view.idShards)) {
        const raw = heldRaw(m, KEY.idshard(pointer.digest)), body = raw ? JSON.parse(raw) as { shard?: unknown; ids?: Record<string, string> } : null;
        idShards[bucket] = { shard: body?.shard ?? null, ids: sorted(Object.keys(body?.ids ?? {})), records: pointer.records,
          addressed: HEX64.test(pointer.digest) && body !== null && await documentDigest(body) === pointer.digest };
      }
      const byKey = <T>(entries: Array<[string, T]>) => Object.fromEntries(entries.sort(([a], [b]) => a < b ? -1 : 1));
      expect.soft({ key: (doc.document.index as { key?: unknown }).key, shared: sorted((doc.document.pieces as Array<{ id: string }>).map(p => p.id)), shards, idShards,
        owners: Object.entries(view.ids).every(([id, product]) => parts.get(product)?.includes(id)), oneLevel: objectKeys(m, 'ids') },
      `${host}: P93.CS1 — 256-way shards keyed by SHA-256 of the product id and of the record id, only non-empty ones listed, each object content-addressed`).toEqual({
        key: 'sha256-hex2', shared: SHARED,
        shards: byKey([...byBucket].map(([bucket, products]) => [bucket, { shard: bucket, products: sorted(products),
          counted: [products.length, products.reduce((sum, p) => sum + parts.get(p)!.length, 0)], addressed: true, parts: true }])),
        idShards: byKey([...idsByBucket].map(([bucket, ids]) => [bucket, { shard: bucket, ids: sorted(ids), records: ids.length, addressed: true }])),
        owners: true, oneLevel: [] });
      expect.soft(shardSizes(m, view).every(bytes => bytes > 0 && bytes <= MiB2), `${host}: P93.CS1 — every shard object stored and at most 2 MiB`).toBe(true);
      // Written before the head is reserved: a shard write failing commits nothing and leaves nothing pending.
      const bucket = m.storage as unknown as Record<string, unknown>, put = UnitR2.prototype.put;
      Object.defineProperty(bucket, 'put', { configurable: true, writable: true, value: async (key: string, raw: string, options?: R2PutOptions) => {
        // P98 R10 (R-P569 (b)): a shard written inside its load's pack is written by that pack's PUT.
        if (classOf(key) === 'shard' || classOf(key) === 'idshard' || classOf(key) === 'pack') throw new Error('P93 fixture: the shard write fails');
        return put.call(m.storage, key, raw, options);
      } });
      let failed: Answer;
      try { failed = await importJson(m, rangeRecords(n + 1, 4), { mode: 'merge' }); } finally { Reflect.deleteProperty(bucket, 'put'); }
      const unchanged = await loadDocument(m, 'catalog');
      const retried = await importJson(m, rangeRecords(n + 1, 4), { mode: 'merge' });
      expect.soft({ failed: [failed.status, unchanged.revision, unchanged.publication], retried: [retried.status, Object.hasOwn((await catalogue(m)).view.products, rangeProduct(n + 4))] },
        `${host}: P93.CS1 — a shard is written before the head (today no shard is written and the load commits: ${show(failed)})`).toEqual({
        failed: [503, doc.revision, doc.publication], retried: [200, true] });
    }, 300_000);
  }

  it('host (session): reading 8 — the range at N = 40,000 and then 100,000 products, loaded in chunks of 5,000 within the import\'s caps: every load 200 and no 413; every shard at most 2 MiB; the per-product read answers the first, a middle and the last product; the manifest\'s bytes equal within 5% at 5,000, 40,000 and 100,000 and at most 64 KB beside the shared pieces', async () => {
    const run = await verified('session');
    expect.soft({ loads: run.statuses.length === 20 && run.statuses.every(s => s === 200) ? '20 loads, every one 200' : run.statuses.join(' '),
      sizes: [capacityOf(run, 40000), capacityOf(run, 100000)] },
    `session: P93.CS1 — 100,000 products in 20 loads of 5,000 (${run.seconds} s; today the one-level manifest refuses past about 20,250: ${run.refused})`).toEqual({
      loads: '20 loads, every one 200', sizes: [capacityExpected(40000), capacityExpected(100000)] });
    // P98 R10 (R-P578 (a)): within 5% in its structural form — the manifest less its pack table against the 5,000 manifest
    // less its table, and the table at most S5's cap of rows (65), so growth with the catalogue is still caught.
    const b5 = run.lessTable[5000] ?? 0, within = (n: number) => run.lessTable[n] !== undefined && Math.abs(run.lessTable[n]! - b5) <= 0.05 * b5 && (run.tableRows[n] ?? 0) <= 65;
    expect.soft({ within: [within(40000), within(100000)], bounded: [5000, 40000, 100000].map(n => run.bytes[n] !== undefined && run.bytes[n]! <= 65536 + run.shared) },
      `session: P93.CS1 — the manifest's bytes (${JSON.stringify(run.bytes)}; the shared pieces ${run.shared})`).toEqual({ within: [true, true], bounded: [true, true, true] });
  }, 1_800_000);

  it('host (do): reading 8 — the range at N = 40,000 products, loaded in chunks of 5,000: every load 200, every shard at most 2 MiB, the per-product read answers the first, a middle and the last product, the manifest within 5% of its bytes at 5,000 and at most 64 KB beside the shared pieces', async () => {
    const run = await verified('do');
    // P98 R10 (R-P578 (a)): the 5% in its structural form (the manifest less its pack table; the table at most 65 rows).
    const b5 = run.lessTable[5000] ?? 0, l40 = run.lessTable[40000], b40 = run.bytes[40000];
    expect.soft({ loads: run.statuses.length === 8 && run.statuses.every(s => s === 200) ? '8 loads, every one 200' : run.statuses.join(' '), size: capacityOf(run, 40000),
      bytes: [l40 !== undefined && Math.abs(l40 - b5) <= 0.05 * b5 && (run.tableRows[40000] ?? 0) <= 65, b40 !== undefined && b40 <= 65536 + run.shared] },
    `do: P93.CS1 — 40,000 products in 8 loads (${run.seconds} s; bytes ${JSON.stringify(run.bytes)}; today: ${run.refused})`).toEqual({
      loads: '8 loads, every one 200', size: capacityExpected(40000), bytes: [true, true] });
  }, 1_800_000);
});

// ===========================================================================
// unit:P93.CS2 — the page: the head, the serving copy (P102), the anchor's shard and its part
// ===========================================================================

describe('unit:P93.CS2 (R-P487 (9): the same reads at any size; P102, R-P570: 4)', () => {
  for (const host of HOSTS) {
    it(`host (${host}): at N = 50 and N = 5,000 the anchor's page reads exactly the head, the serving copy, the anchor's shard and the anchor's part, once each, the shard and the part each by its range in its pack (P102, R-P570 (a), (d)), and serves P80's carousel; warm (the shard and the part cached per isolate by digest) it reads no shard and no part`, async () => {
      const seen: Record<number, unknown> = {}, wanted: Record<number, unknown> = {};
      for (const n of [50, 5000]) {
        const m = await rangeTenant(host, n);
        const { view } = await catalogue(m);
        requireSharded(view, `P93.CS2 at N = ${n}`);
        const s = await shopperOn(m);
        invalidatePublicationCache();
        const cold = await metered(m, () => snapshotOf(m, s, 'pdp', { anchor: A, variant: BLACK }, 'p93-cs2-cold'));
        const warm = await metered(m, () => snapshotOf(m, s, 'pdp', { anchor: A, variant: BLACK }, 'p93-cs2-warm'));
        seen[n] = { status: cold.result.status, served: carousel(cold.result), reads: placedReadClasses(cold), warm: [carousel(warm.result), shardOrPart(readClasses(warm.ops))] };
        wanted[n] = { status: 200, served: SERVED_FOR_BLACK, reads: pageReads(view), warm: [SERVED_FOR_BLACK, []] };
      }
      expect.soft(seen, `${host}: P93.CS2 — 4 reads at each size, the same classes`).toEqual(wanted);
    }, 600_000);
  }

  it('host (session): at N = 40,000 and N = 100,000 the anchor\'s page reads the same 4 objects (its shard and its part at that size, by their ranges in their packs) and serves P80\'s carousel; warm it reads no shard and no part', async () => {
    const run = await verified('session');
    expect.soft([pageOf(run, 40000), pageOf(run, 100000)], `session: P93.CS2 — the page at 40,000 and 100,000 products (today the catalogue stops at about 20,250: ${run.refused})`)
      .toEqual([pageExpected(run, 40000), pageExpected(run, 100000)]);
  }, 1_800_000);

  it('host (do): at N = 40,000 the anchor\'s page reads the same 4 objects and serves P80\'s carousel; warm it reads no shard and no part', async () => {
    const run = await verified('do');
    expect.soft(pageOf(run, 40000), `do: P93.CS2 — the page at 40,000 products (today: ${run.refused})`).toEqual(pageExpected(run, 40000));
  }, 1_800_000);

  for (const host of HOSTS) {
    it(`host (${host}): no shard is read where none is needed — a page with no scoped slot, a page naming no anchor, an anchor whose bucket the index does not list; an anchor in a listed bucket but not in its shard reads that shard and no part; the anchor's shard or part lost fails the page 503 part_unavailable, never the shared pieces alone`, async () => {
      const m = await rangeTenant(host, 50);
      const { view } = await catalogue(m);
      requireSharded(view, 'P93.CS2');
      const s = await shopperOn(m), empty = idByListing('COA-EMPTY-', view, false), absent = idByListing('COA-ABSENT-', view, true);
      const cases: Array<[string, string, Record<string, string>]> = [['a page with no scoped slot', 'cart', { anchor: A }], ['no anchor', 'pdp', {}],
        ['an anchor in an unlisted bucket', 'pdp', { anchor: empty }], ['an anchor in a listed bucket, not in its shard', 'pdp', { anchor: absent }]];
      const seen: unknown[] = [];
      for (const [name, page, signals] of cases) {
        invalidatePublicationCache();
        const { result, ops } = await metered(m, () => snapshotOf(m, s, page, signals, 'p93-cs2-none'));
        seen.push([name, result.status, page === 'cart' ? 'cart' : carousel(result), shardOrPart(readClasses(ops))]);
      }
      const outcome = async (key: string) => {
        const restore = loseObject(m, key); invalidatePublicationCache(); // P98 R10 (R-P569 (b)): lost as its own, or its bytes in its pack
        const page = await snapshotOf(m, s, 'pdp', { anchor: A, variant: BLACK }, 'p93-cs2-lost');
        restore(); invalidatePublicationCache();
        return [page.status, JSON.stringify(page.body).includes('part_unavailable') ? 'names part_unavailable' : `does not (${JSON.stringify(page.body).slice(0, 160)})`, carousel(page)];
      };
      const lostShard = await outcome(KEY.shard(view.shards[bucketOf(A)]!.digest)), lostPart = await outcome(KEY.part(view.products[A]!.digest));
      expect.soft({ seen, lostShard, lostPart }, `${host}: P93.CS2 — a shard read only where the anchor's bucket is listed; a lost shard or part 503`).toEqual({
        seen: [['a page with no scoped slot', 200, 'cart', []], ['no anchor', 200, [], []], ['an anchor in an unlisted bucket', 200, [], []],
          ['an anchor in a listed bucket, not in its shard', 200, [], [KEY.shard(view.shards[bucketOf(absent)]!.digest)]]],
        lostShard: [503, 'names part_unavailable', []], lostPart: [503, 'names part_unavailable', []] });
    }, 300_000);
  }
});

// ===========================================================================
// unit:P93.CS3 — the loads touch only their shards and parts; the collisions, the caps and the PUT across shards
// ===========================================================================

/** 6,400 product ids of 256 characters (isProductId's bound), all in bucket 00: about 2.25 MB of pointers in one shard. */
const TARGET = '00';
let capProducts: string[] | undefined, capRecordIds: string[] | undefined;
const productsInTarget = () => capProducts ??= (() => {
  const out: string[] = []; for (let k = 0; out.length < 6400; k++) { const id = `COA-CAP-${k}-`.padEnd(256, 'X'); if (bucketOf(id) === TARGET) out.push(id); } return out;
})();
/** 280 record ids of 8,000 characters, all in bucket 00: about 2.25 MB of entries in one id shard. */
const recordIdsInTarget = () => capRecordIds ??= (() => {
  const out: string[] = []; for (let k = 0; out.length < 280; k++) { const id = `cap-record-${k}-`.padEnd(8000, 'y'); if (bucketOf(id) === TARGET) out.push(id); } return out;
})();
const capRecord = (id: string, product: string) => ({ id, type: 'on-model', title: 't', slotTypes: [CAROUSEL], featuredProductIds: [product] });
/** P98 R10 (R-P569 (b)): the objects the store holds, of their own or inside a stored pack. */
const counts = (m: Mounted) => [heldKeys(m, 'part').length, heldKeys(m, 'shard').length, heldKeys(m, 'idshard').length, objectKeys(m, 'ids').length];

describe('unit:P93.CS3 (R-P487 (2), (5); R-P490 (1): the loads and the PUT across shards)', () => {
  for (const host of HOSTS) {
    it(`host (${host}): a load reads the shards of the products it names and their parts, and the id shards only of ids whose place can change (a retitle reads none, new records read theirs), and writes only the shards and parts whose digest moved (an unchanged part is not re-put); the skip and the dry run write nothing`, async () => {
      const m = await rangeTenant(host, 600);
      const start = await catalogue(m);
      requireSharded(start.view, 'P93.CS3');
      const buckets = (products: string[]) => unique(products.map(bucketOf));
      const twelve = Array.from({ length: 12 }, (_, i) => rangeProduct(i + 1));
      const retitle = await metered(m, async () => importJson(m, rangeRecords(1, 12, ', retitled'), { mode: 'merge' }));
      const one = await catalogue(m);
      const half = await metered(m, async () => importJson(m, [...rangeRecords(13, 6, ', retitled'), ...rangeRecords(19, 6)], { mode: 'merge' }));
      const two = await catalogue(m);
      const newIds = Array.from({ length: 8 }, (_, i) => rangeRecordId(601 + i)), newProducts = Array.from({ length: 8 }, (_, i) => rangeProduct(601 + i));
      const added = await metered(m, async () => importJson(m, rangeRecords(601, 8), { mode: 'merge' }));
      const three = await catalogue(m);
      const again = await metered(m, async () => importJson(m, rangeRecords(601, 8), { mode: 'merge' }));
      const dryHeaders = await preconditions(m);
      const dry = await metered(m, async () => importJson(m, rangeRecords(609, 4), { mode: 'merge', dryRun: '1' }, { 'If-Match': dryHeaders['If-Match']! }));
      const puts = (ops: readonly Op[]) => ops.filter(o => o.op === 'put').map(o => o.key);
      // P98 R10 (R-P599): a load's reads in the ruled form — every object it wants read; any other object read only between
      // two wanted objects of one read of a pack, each gap at most 256 KiB and each read at most 16 MiB (the build merges
      // neighbouring places into one ranged read). The objects each load wants: the shards of the products it names and
      // their parts, and the id shards of ids whose place can change (before: exactly the objects it wants).
      const wantedOf = (view: IndexView, products: string[], ids: string[]) => [...buckets(products).filter(b => view.shards[b]).map(b => KEY.shard(view.shards[b]!.digest)),
        ...products.filter(p => view.products[p]).map(p => KEY.part(view.products[p]!.digest)), ...ids.map(bucketOf).filter(b => view.idShards[b]).map(b => KEY.idshard(view.idShards[b]!.digest))];
      const sixAndSix = Array.from({ length: 12 }, (_, i) => rangeProduct(13 + i));
      const wanted = { retitle: wantedOf(start.view, twelve, []), half: wantedOf(one.view, sixAndSix, []), added: wantedOf(two.view, newProducts, newIds) };
      expect.soft({
        retitle: [retitle.result.status, readAsWanted(retitle, 'shard', wanted.retitle), readAsWanted(retitle, 'idshard', wanted.retitle), readAsWanted(retitle, 'part', wanted.retitle),
          touched(retitle.ops, 'put', 'part'), touched(retitle.ops, 'put', 'shard'), touched(retitle.ops, 'put', 'idshard')],
        half: [half.result.status, touched(half.ops, 'put', 'part'), readAsWanted(half, 'idshard', wanted.half)],
        added: [added.result.status, readAsWanted(added, 'idshard', wanted.added), touched(added.ops, 'put', 'idshard'), newProducts.every(p => three.view.products[p])],
        nothing: [again.result.status, again.result.body.skipped ?? null, puts(again.ops), dry.result.status, dry.result.body.dryRun ?? null, puts(dry.ops)],
      }, `${host}: P93.CS3 — each load touches only its own shards and moved parts (today the one id index is read whole: ${unique(retitle.ops.filter(o => o.op === 'get').map(o => classOf(o.key))).join(', ')})`).toEqual({
        retitle: [200, unique(buckets(twelve).map(b => KEY.shard(start.view.shards[b]!.digest))), [], unique(twelve.map(p => KEY.part(start.view.products[p]!.digest))),
          unique(twelve.map(p => KEY.part(one.view.products[p]?.digest ?? 'no pointer'))), unique(buckets(twelve).map(b => KEY.shard(one.view.shards[b]?.digest ?? 'no shard'))), []],
        half: [200, unique(Array.from({ length: 6 }, (_, i) => KEY.part(two.view.products[rangeProduct(13 + i)]?.digest ?? 'no pointer'))), []],
        added: [200, unique(newIds.map(bucketOf).filter(b => Object.hasOwn(two.view.idShards, b)).map(b => KEY.idshard(two.view.idShards[b]!.digest))),
          unique(newIds.map(bucketOf).map(b => KEY.idshard(three.view.idShards[b]?.digest ?? 'no id shard'))), true],
        nothing: [200, true, [], 200, true, []] });
    }, 600_000);

    it(`host (${host}): P91's modes per product across the shards — replace of one product reads the id shards of the id it drops and the id it brings and rewrites that product alone; full of ${C}'s records keeps the left-out record expired and reads no id shard; record_moved (naming both products, accepted with the source in the same file), id_in_part and id_shared refused across buckets, nothing written`, async () => {
      const m = await rangeTenant(host, 600);
      expect((await importJson(m, fourOf(C), { mode: 'merge' })).status, `${host}: PRECONDITION — ${C}'s four images load`).toBe(200);
      const start = await catalogue(m);
      requireSharded(start.view, 'P93.CS3');
      const five = rangeProduct(5), dropped = rangeRecordId(5), fresh = { ...rangeRecords(5, 1)[0]!, id: 'img-r00005-2', customerContentId: 'TAP-IMG-R00005-2' };
      const replaced = await metered(m, async () => importJson(m, [fresh], { mode: 'replace' }));
      const one = await catalogue(m);
      const others = (from: IndexView, to: IndexView, except: string[]) => Object.keys(from.products).filter(p => !except.includes(p)).every(p => to.products[p]?.digest === from.products[p]!.digest);
      const c = fourOf(C);
      const full = await metered(m, async () => importJson(m, c.slice(0, 3), { mode: 'full', expire: '1' }));
      const two = await catalogue(m);
      const cPart = JSON.parse(heldRaw(m, KEY.part(two.view.products[C]?.digest ?? 'none')) ?? '{"pieces":[]}') as { pieces: Array<{ id: string; lifecycle?: { status?: string } }> };
      expect.soft({
        replace: [replaced.result.status, one.view.products[five]?.records ?? null, one.view.ids[fresh.id] ?? null, Object.hasOwn(one.view.ids, dropped), others(start.view, one.view, [five]),
          touched(replaced.ops, 'get', 'idshard'), sorted((one.doc.document.pieces as Array<{ id: string }>).map(p => p.id))],
        full: [full.result.status, cPart.pieces.map(p => [p.id, p.lifecycle?.status ?? 'live']), c.every(r => two.view.ids[r.id] === C), others(one.view, two.view, [C]),
          touched(full.ops, 'get', 'idshard'), touched(full.ops, 'put', 'idshard')],
      }, `${host}: P93.CS3 — the modes per product, each touching its own shards (${show(replaced.result)})`).toEqual({
        replace: [200, 1, five, false, true, unique([dropped, fresh.id].map(bucketOf).filter(b => Object.hasOwn(start.view.idShards, b)).map(b => KEY.idshard(start.view.idShards[b]!.digest))), SHARED],
        full: [200, [[c[0]!.id, 'live'], [c[1]!.id, 'live'], [c[2]!.id, 'live'], [c[3]!.id, 'expired']], true, true, [], []] });
      // The collisions, across buckets: the record leaves A for a product of another bucket.
      const target = [B, UNKNOWN, ...Array.from({ length: 50 }, (_, i) => rangeProduct(100 + i))].find(p => bucketOf(p) !== bucketOf(A))!;
      const moving = { ...ANCHOR_IMAGES[1]!, featuredProductIds: [target] };
      const before = await loadDocument(m, 'catalog'), stored = counts(m);
      const moved = await importJson(m, [moving], { mode: 'merge' });
      const sharedReuse = { ...MODULES.find(p => p.id === M.editorial)!, id: rangeRecordId(40), customerContentId: 'TAP-P93-REUSE' };
      const inPart = await importJson(m, [sharedReuse], { mode: 'merge' });
      const shared = await importJson(m, [image(M.editorial, [rangeProduct(50)], 'Handbags', 'studio')], { mode: 'merge' });
      const refusedAfter = await loadDocument(m, 'catalog'), unwritten = [refusedAfter.revision === before.revision, counts(m)];
      const both = await importJson(m, [moving, ANCHOR_IMAGES[0]!], { mode: 'merge' });
      const after = await catalogue(m);
      expect.soft({ moved: [moved.status, named(moved, 'record_moved', A, target)], inPart: [inPart.status, named(inPart, 'id_in_part', rangeRecordId(40), rangeProduct(40))],
        shared: [shared.status, named(shared, 'id_shared', M.editorial, rangeProduct(50))], unwritten,
        both: [both.status, after.view.ids[moving.id] ?? null, Object.hasOwn(after.view.products, A), after.view.products[A]?.records ?? null] },
      `${host}: P93.CS3 — the three refusals across buckets, nothing written; the move with both products in one file accepted (${show(both)})`).toEqual({
        moved: [422, `names record_moved, ${A}, ${target}`], inPart: [422, `names id_in_part, ${rangeRecordId(40)}, ${rangeProduct(40)}`],
        shared: [422, `names id_shared, ${M.editorial}, ${rangeProduct(50)}`], unwritten: [true, stored], both: [200, target, true, ANCHOR_IMAGES.length - 1] });
    }, 600_000);

    it(`host (${host}): the three 413s, nothing written — a load whose product shard would pass 2 MiB is refused index_shard_too_large naming the shard and its product count; one whose id shard would is refused id_index_too_large naming the shard and its record count; one whose shared pieces would pass the manifest's 2 MiB is refused manifest_too_large; each load before it accepted`, async () => {
      // The product shard: 6,400 products of bucket 00 in two loads of 3,200.
      const m = await mount(host, DOCS);
      await declareProductSlots(m);
      const products = productsInTarget(), first = products.slice(0, 3200).map((p, i) => capRecord(`capp-${i}`, p)), second = products.slice(3200).map((p, i) => capRecord(`capp-${3200 + i}`, p));
      expect([withinCaps(first), withinCaps(second)], 'PRECONDITION: each load of the product shard\'s cap is within the import\'s caps').toEqual([true, true]);
      const one = await importJson(m, first, { mode: 'merge' });
      const afterOne = await loadDocument(m, 'catalog'), held = counts(m);
      const two = await importJson(m, second, { mode: 'merge' });
      expect.soft({ one: one.status, two: [two.status, two.body.code ?? null, named(two, TARGET), countNamed(two, 6400)], written: [(await loadDocument(m, 'catalog')).revision === afterOne.revision, counts(m)] },
        `${host}: P93.CS3 — the product shard's cap (today the one-level manifest refuses first: ${show(two)})`).toEqual({
        one: 200, two: [413, 'index_shard_too_large', `names ${TARGET}`, 'names 6400'], written: [true, held] });
      // The id shard: 280 records of bucket 00, one product each, in two loads of 140.
      const ids = recordIdsInTarget(), loadIds = (from: number, to: number) => ids.slice(from, to).map((id, i) => capRecord(id, `COA-IDS-${from + i}`));
      expect([withinCaps(loadIds(0, 140)), withinCaps(loadIds(140, 280))], 'PRECONDITION: each load of the id shard\'s cap is within the import\'s caps').toEqual([true, true]);
      const n = await mount(host, DOCS);
      await declareProductSlots(n);
      const three = await importJson(n, loadIds(0, 140), { mode: 'merge' }), afterThree = await loadDocument(n, 'catalog'), before = counts(n);
      const four = await importJson(n, loadIds(140, 280), { mode: 'merge' });
      expect.soft({ three: three.status, four: [four.status, four.body.code ?? null, named(four, TARGET), countNamed(four, 280)], written: [(await loadDocument(n, 'catalog')).revision === afterThree.revision, counts(n)] },
        `${host}: P93.CS3 — the id shard's cap (today the one 8 MiB id index takes it: ${show(four)})`).toEqual({
        three: 200, four: [413, 'id_index_too_large', `names ${TARGET}`, 'names 280'], written: [true, before] });
      // The manifest: shared pieces alone past 2 MiB, in two loads.
      const sharedRecords = (from: number, count: number) => Array.from({ length: count }, (_, i) => ({ id: `shared-${from + i}`, type: 'flat-lay', title: `Shared piece ${from + i}`.padEnd(160, '.'),
        slotTypes: [CAROUSEL] }));
      expect([withinCaps(sharedRecords(0, 6000)), withinCaps(sharedRecords(6000, 6000))], 'PRECONDITION: each load of shared pieces is within the import\'s caps').toEqual([true, true]);
      const p = await mount(host, DOCS);
      await declareProductSlots(p);
      const five = await importJson(p, sharedRecords(0, 6000), { mode: 'merge' }), afterFive = await loadDocument(p, 'catalog');
      const six = await importJson(p, sharedRecords(6000, 6000), { mode: 'merge' });
      expect.soft({ five: [five.status, documentBytes(afterFive.document) < MiB2], six: [six.status, six.body.code ?? null], written: (await loadDocument(p, 'catalog')).revision === afterFive.revision },
        `${host}: P93.CS3 — the manifest's own cap, driven by the shared pieces (${show(six)})`).toEqual({ five: [200, true], six: [413, 'manifest_too_large'], written: true });
    }, 900_000);

    it(`host (${host}): the PUT round trip carries index exactly as read and writes no shard and no part; a PUT whose index differs (a shard pointer left out, changed or added) is refused 422 naming the shard, and a document without index 422 naming index, nothing written; a product leaves only by an explicit removeProducts list (never stored), which also clears a lost part`, async () => {
      const m = await rangeTenant(host, 600);
      const start = await catalogue(m);
      requireSharded(start.view, 'P93.CS3');
      const asRead = start.doc.document as Record<string, unknown> & { index: { shards: Record<string, { digest: string }> } };
      const round = await metered(m, () => putDocument(m, 'catalog', asRead, 'p93 round trip'));
      const one = await catalogue(m);
      const [left, changed] = Object.keys(asRead.index.shards).sort().slice(0, 2) as [string, string];
      const { [left]: _left, ...rest } = asRead.index.shards; void _left;
      const leftOut = await putDocument(m, 'catalog', { ...asRead, index: { ...asRead.index, shards: rest } }, 'p93 a shard left out');
      const altered = await putDocument(m, 'catalog', { ...asRead, index: { ...asRead.index, shards: { ...asRead.index.shards, [changed]: { ...asRead.index.shards[changed]!, digest: 'f'.repeat(64) } } } }, 'p93 a shard changed');
      // A pointer ADDED under a bucket the index does not list (a copy of a real pointer, so only the comparison can refuse it).
      const unlisted = [...Array(256).keys()].map(i => i.toString(16).padStart(2, '0')).find(b => !Object.hasOwn(asRead.index.shards, b));
      expect(unlisted, `${host}: PRECONDITION — the index of 603 products leaves some bucket unlisted`).toBeDefined();
      const addedShard = await putDocument(m, 'catalog', { ...asRead, index: { ...asRead.index, shards: { ...asRead.index.shards, [unlisted!]: { ...asRead.index.shards[changed]! } } } }, 'p93 a shard added');
      const { index: _index, ...noIndex } = asRead; void _index;
      const oneLevel = await putDocument(m, 'catalog', noIndex, 'p93 a document without index');
      const refusedAt = await loadDocument(m, 'catalog');
      const seven = rangeProduct(7), eight = rangeProduct(8);
      const removed = await putDocument(m, 'catalog', { ...(await loadDocument(m, 'catalog')).document, removeProducts: [seven] }, 'p93 remove a product');
      const two = await catalogue(m);
      const readSeven = await productRead(m, seven);
      const lostKey = KEY.part(two.view.products[eight]?.digest ?? 'no pointer');
      loseObject(m, lostKey); invalidatePublicationCache(); // P98 R10 (R-P569 (b)): lost as its own, or its bytes in its pack
      const lostRead = await productRead(m, eight);
      const cleared = await putDocument(m, 'catalog', { ...(await loadDocument(m, 'catalog')).document, removeProducts: [eight] }, 'p93 clear a lost part');
      const three = await catalogue(m);
      const readEight = await productRead(m, eight);
      expect.soft({
        round: [round.result.status, JSON.stringify([one.view.shards, one.view.idShards]) === JSON.stringify([start.view.shards, start.view.idShards]),
          [...touched(round.ops, 'put', 'part'), ...touched(round.ops, 'put', 'shard'), ...touched(round.ops, 'put', 'idshard')]],
        leftOut: [leftOut.status, named(leftOut, left)], altered: [altered.status, named(altered, changed)], added: [addedShard.status, named(addedShard, unlisted!)],
        oneLevel: [oneLevel.status, named(oneLevel, 'index')],
        unwritten: refusedAt.revision === one.doc.revision,
        removed: [removed.status, Object.hasOwn(two.view.products, seven), Object.hasOwn(two.view.ids, rangeRecordId(7)), readSeven.status, Object.keys(two.view.products).length],
        cleared: [lostRead.status, cleared.status, Object.hasOwn(three.view.products, eight), Object.hasOwn(three.view.ids, rangeRecordId(8)), readEight.status],
        notStored: [Object.hasOwn(two.doc.document, 'removeProducts'), Object.hasOwn(three.doc.document, 'removeProducts')],
      }, `${host}: P93.CS3 — the index as read, by name otherwise; removal only by removeProducts (${show(leftOut)} | ${show(removed)})`).toEqual({
        round: [200, true, []], leftOut: [422, `names ${left}`], altered: [422, `names ${changed}`], added: [422, `names ${unlisted}`], oneLevel: [422, 'names index'], unwritten: true,
        removed: [200, false, false, 404, Object.keys(one.view.products).length - 1], cleared: [503, 200, false, false, 404], notStored: [false, false] });
    }, 600_000);
  }
});

// ===========================================================================
// unit:P93.CS4 — a stored one-level catalogue (P86's form) is served as it is and rewritten sharded by its next publication
// ===========================================================================

/**
 * R-P490 (3): a tenant whose catalogue revision is in P86's one-level form, as a store written before this ticket holds
 * it: the parts and the id index written into the bucket at their content addresses, and the manifest naming them
 * published over the mounted set by the publication authority itself (specifier's reading d; no route writes that form).
 * The pieces are the validator's own, as an import stores them.
 */
async function oneLevelTenant(host: Host, n = 40): Promise<{ m: Mounted; parts: Map<string, string> }> {
  const m = await mount(host, DOCS_WITH_CART);
  expectPublished(m, 'P93.CS4 — the tenant documents publish');
  const checked = CONTENT_KIND.validate({ pieces: [...MODULES, ...ANCHOR_IMAGES, ...OTHER_IMAGES, ...rangeRecords(1, n)] });
  if (!checked.ok) throw new Error(`P93 fixture: ${checked.errors.slice(0, 3).join('; ')}`);
  const shared: unknown[] = [], byProduct = new Map<string, unknown[]>();
  for (const piece of checked.value.pieces) {
    const product = piece.slotTypes?.every(s => s === CAROUSEL) && piece.featuredProductIds?.[0] ? piece.featuredProductIds[0] : null;
    if (product === null) shared.push(piece); else byProduct.set(product, [...(byProduct.get(product) ?? []), piece]);
  }
  const products: Record<string, { digest: string; records: number }> = {}, ids: Record<string, string> = {}, parts = new Map<string, string>();
  for (const [product, pieces] of byProduct) {
    const value = { product, pieces }, digest = await documentDigest(value);
    await m.storage.put(KEY.part(digest), JSON.stringify(value)); products[product] = { digest, records: pieces.length }; parts.set(product, digest);
    for (const piece of pieces) ids[(piece as { id: string }).id] = product;
  }
  const idsValue = { ids: Object.fromEntries(Object.keys(ids).sort().map(id => [id, ids[id]!])) }, idsDigest = await documentDigest(idsValue);
  await m.storage.put(KEY.ids(idsDigest), JSON.stringify(idsValue));
  const manifest = { version: 'p93-one-level', productSlots: [CAROUSEL], pieces: shared,
    products: Object.fromEntries(Object.keys(products).sort().map(p => [p, products[p]!])), idIndex: { digest: idsDigest, records: Object.keys(ids).length } };
  const base = await loadDocument(m, 'catalog');
  const written = await publish<ContentCatalog>(m.env, CONTENT_KIND, TENANT, { type: 'replace', candidate: manifest },
    { actor: 'p93-fixture', note: 'P86\'s one-level form', operationId: `${base.revision}:${crypto.randomUUID()}`, expectedRevision: base.revision, expectedPublication: base.publication },
    () => manifest);
  if (!written.ok) throw new Error(`P93 fixture: the one-level revision was refused: ${written.errors.slice(0, 3).join('; ')}`);
  invalidatePublicationCache();
  return { m, parts };
}
const shardWrites = (ops: readonly Op[]) => touched(ops, 'put', 'shard').length + touched(ops, 'put', 'idshard').length;
const atMost512 = (ops: readonly Op[]) => shardWrites(ops) > 0 && shardWrites(ops) <= 512 ? 'at most 512 shard writes' : `${shardWrites(ops)} shard writes`;

describe('unit:P93.CS4 (R-P487 (9), R-P490 (1), (3): the migration needs no operator step)', () => {
  for (const host of HOSTS) {
    it(`host (${host}): a stored one-level catalogue is served as it is (the page reads its one part and no shard; the per-product read answers); its next import, rollback, PUT or pull writes the sharded form, every part digest it does not change equal and no part rewritten, at most 512 shard writes; a rollback to a one-level revision is written sharded; a one-level PUT leaving a product out removes it (P86's rule, R-P490 (1)), written sharded`, async () => {
      const { m, parts } = await oneLevelTenant(host);
      const level = await catalogue(m);
      const s = await shopperOn(m);
      invalidatePublicationCache();
      const page = await metered(m, () => snapshotOf(m, s, 'pdp', { anchor: A, variant: BLACK }, 'p93-cs4-one-level'));
      const read = await productRead(m, A);
      // P102 R10 onto P98's pack reads (R-P570 (d)): the one-level part, an object of its own (planted), is read as its own.
      expect.soft({ form: level.view.form, page: [page.result.status, carousel(page.result), placedReadClasses(page)], read: [read.status, readIds(read)] },
        `${host}: P93.CS4 — LOCK: the one-level catalogue served as P86 serves it`).toEqual({
        form: 'one-level', page: [200, SERVED_FOR_BLACK, sorted(['head', `config-publication/v2/${TENANT}/serving.json`, KEY.part(parts.get(A)!)])],
        read: [200, sorted(ANCHOR_IMAGES.map(r => r.id))] });
      const one = rangeProduct(1);
      const imported = await metered(m, async () => importJson(m, rangeRecords(1, 1, ', retitled'), { mode: 'merge' }));
      const sharded = await catalogue(m);
      const back = await metered(m, async () => asOperator(m, 'POST', `/content/catalog/rollback/${level.doc.revision}?scope=${TENANT}`, {}, await preconditions(m)));
      const rolled = await catalogue(m);
      expect.soft({
        imported: [imported.result.status, sharded.view.form, without(digestsOf(sharded.view), one), touched(imported.ops, 'put', 'part').length, atMost512(imported.ops)],
        rolled: [back.result.status, rolled.view.form, digestsOf(rolled.view), touched(back.ops, 'put', 'part').length, atMost512(back.ops)] },
      `${host}: P93.CS4 — the next import and a rollback to the one-level revision write the sharded form (today it stays one-level: ${show(imported.result)})`).toEqual({
        imported: [200, 'sharded', without(Object.fromEntries(parts), one), 1, 'at most 512 shard writes'],
        rolled: [200, 'sharded', Object.fromEntries(parts), 0, 'at most 512 shard writes'] });
      const forPut = await oneLevelTenant(host), forPull = await oneLevelTenant(host), forOmission = await oneLevelTenant(host);
      const put = await metered(forPut.m, async () => putDocument(forPut.m, 'catalog', (await loadDocument(forPut.m, 'catalog')).document, 'p93 one-level round trip'));
      const pulled = await metered(forPull.m, () => pull(forPull.m, rangeRecords(2, 1, ', pulled'), { mode: 'merge' }));
      const level3 = (await loadDocument(forOmission.m, 'catalog')).document as Record<string, unknown> & { products: Record<string, unknown> };
      const { [rangeProduct(3)]: _three, ...kept } = level3.products; void _three;
      const omitted = await metered(forOmission.m, () => putDocument(forOmission.m, 'catalog', { ...level3, products: kept }, 'p93 one-level PUT leaving a product out'));
      const afterPut = await catalogue(forPut.m), afterPull = await catalogue(forPull.m), afterOmission = await catalogue(forOmission.m);
      expect.soft({ put: [put.result.status, afterPut.view.form, digestsOf(afterPut.view), touched(put.ops, 'put', 'part').length, atMost512(put.ops)],
        pull: [pulled.result.status, afterPull.view.form, without(digestsOf(afterPull.view), rangeProduct(2)), touched(pulled.ops, 'put', 'part').length, atMost512(pulled.ops)],
        omitted: [omitted.result.status, afterOmission.view.form, digestsOf(afterOmission.view), Object.hasOwn(afterOmission.view.ids, rangeRecordId(3)), (await productRead(forOmission.m, rangeProduct(3))).status] },
      `${host}: P93.CS4 — the next PUT and the next pull write the sharded form (${show(put.result)} | ${show(omitted.result)})`).toEqual({
        put: [200, 'sharded', Object.fromEntries(forPut.parts), 0, 'at most 512 shard writes'],
        pull: [200, 'sharded', without(Object.fromEntries(forPull.parts), rangeProduct(2)), 1, 'at most 512 shard writes'],
        omitted: [200, 'sharded', without(Object.fromEntries(forOmission.parts), rangeProduct(3)), false, 404] });
    }, 600_000);

    it(`host (${host}): LOCK — a catalogue that declares no product slots is today's document: a load writes no shard, no id shard and no part, and the anchor's page reads none`, async () => {
      const plain = await mount(host, { ...DOCS_WITH_CART, pieces: [...MODULES, ...ANCHOR_IMAGES, ...OTHER_IMAGES] });
      expectPublished(plain, 'P93.CS4 — the tenant documents publish');
      const merged = await importJson(plain, [image('img-ch857-5', [A], 'Handbags', 'studio')], { mode: 'merge' });
      const s = await shopperOn(plain);
      invalidatePublicationCache();
      const page = await metered(plain, () => snapshotOf(plain, s, 'pdp', { anchor: A, variant: BLACK }, 'p93-cs4-plain'));
      expect.soft([merged.status, sorted(Object.keys((await loadDocument(plain, 'catalog')).document)), counts(plain), page.result.status, carousel(page.result), shardOrPart(readClasses(page.ops))],
        `${host}: P93.CS4 — LOCK: no productSlots, no shard`).toEqual([200, ['pieces', 'version'], [0, 0, 0, 0], 200, sorted([...SERVED_FOR_BLACK, 'img-ch857-5']), []]);
    }, 120_000);
  }
});

// ===========================================================================
// unit:P93.CS5 — the rollback bounded by the difference; the purge resolves attachments before a body
// ===========================================================================

/** Reading 5 and the specifier's reading c: the objects a rollback to `target` must check, against the revision in force. */
function differing(target: IndexView, inForce: IndexView): { shards: string[]; idShards: string[]; parts: string[]; buckets: string[] } {
  const buckets = Object.entries(target.shards).filter(([b, p]) => inForce.shards[b]?.digest !== p.digest).map(([b]) => b);
  const idShards = Object.entries(target.idShards).filter(([b, p]) => inForce.idShards[b]?.digest !== p.digest).map(([, p]) => KEY.idshard(p.digest));
  const parts = Object.entries(target.products).filter(([p, v]) => buckets.includes(bucketOf(p)) && inForce.products[p]?.digest !== v.digest).map(([, v]) => KEY.part(v.digest));
  return { shards: unique(buckets.map(b => KEY.shard(target.shards[b]!.digest))), idShards: unique(idShards), parts: unique(parts), buckets };
}
const checksOf = (d: ReturnType<typeof differing>) => d.shards.length + d.idShards.length + d.parts.length;
/**
 * P98 R10 (R-P569 (b), R-P578): the range's revisions stored before packs — P93's form, planted beside the routes over a
 * tenant declaring its product slots — the world where a rollback checks the objects it names one by one (a rollback
 * across revisions in packs checks one HEAD per pack: unit:P98). `stored` publishes the next revision of the range: the
 * records held, with `changes` merged in by id.
 */
async function rangeStoredBeforePacks(host: Host, n: number): Promise<{ m: Mounted; stored: (changes: Rec[]) => Promise<void> }> {
  const m = await mount(host, DOCS_WITH_CART);
  expectPublished(m, 'P93 — the tenant documents publish');
  await declareProductSlots(m);
  let held: Rec[] = [...ANCHOR_IMAGES, ...OTHER_IMAGES, ...rangeRecords(1, n)];
  const stored = async (changes: Rec[]) => {
    const ids = new Set(changes.map(r => r.id));
    held = [...held.filter(r => !ids.has(r.id)), ...changes];
    await storedBeforePacks(m, held, 'p93-range', 'P93 R10: the range stored before packs');
  };
  await stored([]);
  return { m, stored };
}
/** The stored content revisions, by number, with their values. */
function storedRevisions(m: Mounted): Array<[number, Record<string, unknown>]> {
  return [...m.storage.objects.entries()].map(([key, raw]) => [/\/content\/rev\/([0-9]+)\.json$/.exec(key), raw] as const).filter(([match]) => match)
    .map(([match, raw]) => [Number(match![1]), (JSON.parse(raw) as { value?: Record<string, unknown> }).value ?? {}] as [number, Record<string, unknown>]).sort(([a], [b]) => a - b);
}

describe('unit:P93.CS5 (R-P487 (6), (8), R-P490 (4): the rollback and the purge across shards)', () => {
  for (const host of HOSTS) {
    it(`host (${host}): a rollback checks the shards and id shards the target names that the revision in force does not and the part pointers inside them that differ, never every product; a missing part or shard is refused 410 part_missing naming it, nothing written; a rollback of about 700 checks is accepted, and past 900 checks one is refused 413 rollback_too_large naming the count, nothing written`, async () => {
      // P98 R10 (R-P569 (b), R-P578): every revision of this leg stored before packs (before: loaded by the import).
      const { m, stored } = await rangeStoredBeforePacks(host, 600);
      const target = await catalogue(m);
      requireSharded(target.view, 'P93.CS5');
      await stored([...rangeRecords(1, 10, ', v2'), ...rangeRecords(601, 5)]); // ten products change and five arrive
      const now = await catalogue(m), expected = differing(target.view, now.view);
      const allowed = new Set([...expected.shards, ...expected.buckets.map(b => KEY.shard(now.view.shards[b]?.digest ?? 'none'))]);
      const back = await metered(m, async () => asOperator(m, 'POST', `/content/catalog/rollback/${target.doc.revision}?scope=${TENANT}`, {}, await preconditions(m)));
      const rolled = await catalogue(m);
      const seen = (ops: readonly Op[], cls: string) => unique(ops.filter(o => (o.op === 'head' || o.op === 'get') && classOf(o.key) === cls).map(o => o.key));
      expect.soft({ status: back.result.status, parts: seen(back.ops, 'part'), idShards: seen(back.ops, 'idshard'),
        shardsChecked: expected.shards.filter(k => !seen(back.ops, 'shard').includes(k)), shardsOutside: seen(back.ops, 'shard').filter(k => !allowed.has(k)),
        restored: JSON.stringify(digestsOf(rolled.view)) === JSON.stringify(digestsOf(target.view)) && JSON.stringify(rolled.view.ids) === JSON.stringify(target.view.ids) },
      `${host}: P93.CS5 — the check covers the difference (${checksOf(expected)} objects), never the ${Object.keys(target.view.products).length} products (measured: ${seen(back.ops, 'part').length} parts checked)`).toEqual({
        status: 200, parts: expected.parts, idShards: expected.idShards, shardsChecked: [], shardsOutside: [], restored: true });
      // The 410: the target's part of product 3, then the target's shard of product 4's bucket, lost after they changed again.
      await stored(rangeRecords(1, 10, ', v3')); // they change again
      const refusedFor = async (key: string) => {
        const raw = m.storage.objects.get(key)!, head = await loadDocument(m, 'catalog');
        m.storage.objects.delete(key);
        const answer = await asOperator(m, 'POST', `/content/catalog/rollback/${target.doc.revision}?scope=${TENANT}`, {}, await preconditions(m));
        const unwritten = (await loadDocument(m, 'catalog')).revision === head.revision;
        m.storage.objects.set(key, raw);
        return { answer, unwritten };
      };
      const partLost = await refusedFor(KEY.part(target.view.products[rangeProduct(3)]!.digest));
      const shardBucket = bucketOf(rangeProduct(4)), shardLost = await refusedFor(KEY.shard(target.view.shards[shardBucket]!.digest));
      expect.soft({ part: [partLost.answer.status, partLost.answer.body.code ?? null, named(partLost.answer, rangeProduct(3)), partLost.unwritten],
        shard: [shardLost.answer.status, shardLost.answer.body.code ?? null, named(shardLost.answer, shardBucket), shardLost.unwritten] },
      `${host}: P93.CS5 — a missing object refused by name (${show(partLost.answer)} | ${show(shardLost.answer)})`).toEqual({
        part: [410, 'part_missing', `names ${rangeProduct(3)}`, true], shard: [410, 'part_missing', `names ${shardBucket}`, true] });
      // Within 900 checks: a rollback across a reload of 500 products (about 700 checks) is accepted.
      const { m: mid, stored: midStored } = await rangeStoredBeforePacks(host, 500);
      const midTarget = await catalogue(mid);
      await midStored(rangeRecords(1, 500, ', reloaded')); // the 500 products reload
      const midCount = checksOf(differing(midTarget.view, (await catalogue(mid)).view)), midHead = await loadDocument(mid, 'catalog');
      expect(midCount > 100 && midCount <= 900, `${host}: PRECONDITION — the rollback needs between 101 and 900 checks (${midCount})`).toBe(true);
      const accepted = await asOperator(mid, 'POST', `/content/catalog/rollback/${midTarget.doc.revision}?scope=${TENANT}`, {}, await preconditions(mid));
      const midAfter = await catalogue(mid);
      expect.soft([accepted.status, midAfter.doc.revision, JSON.stringify(digestsOf(midAfter.view)) === JSON.stringify(digestsOf(midTarget.view))],
        `${host}: P93.CS5 — ${midCount} checks, within 900, accepted (${show(accepted)})`).toEqual([200, midHead.revision + 1, true]);
      // Past 900 checks: a rollback across a reload of 1,000 products.
      const { m: big, stored: bigStored } = await rangeStoredBeforePacks(host, 1000);
      const bigTarget = await catalogue(big);
      await bigStored(rangeRecords(1, 1000, ', reloaded')); // the 1,000 products reload
      const bigNow = await catalogue(big), count = checksOf(differing(bigTarget.view, bigNow.view)), bigHead = await loadDocument(big, 'catalog');
      const tooLarge = await asOperator(big, 'POST', `/content/catalog/rollback/${bigTarget.doc.revision}?scope=${TENANT}`, {}, await preconditions(big));
      expect.soft([count > 900, tooLarge.status, tooLarge.body.code ?? null, countNamed(tooLarge, count), (await loadDocument(big, 'catalog')).revision === bigHead.revision],
        `${host}: P93.CS5 — past 900 checks refused by name with the count, nothing written (${show(tooLarge)})`).toEqual([true, 413, 'rollback_too_large', `names ${count}`, true]);
    }, 900_000);

    it(`host (${host}): the purge under the configuration retention setting — within the 15-minute grace it deletes no shard, id shard or part though the revision naming them is purged; past it, it leaves nothing no stored revision names; with its budget exhausted at its first deletion of an attachment it has deleted no body whose attachments it did not resolve, so nothing is lost for good and the next publication's purge resumes and finishes the sweep`, async () => {
      const [a1] = fourOf(A) as [Rec];
      const loadsOf = [[...fourOf(A), ...fourOf(B)], [{ ...a1, title: `${a1.title}, first retouch` }], [{ ...a1, title: `${a1.title}, second retouch` }]];
      const loadAndWait = async (m: Mounted, records: unknown[]) => {
        const loaded = await importJson(m, records, { mode: 'merge' });
        expect(loaded.status, `${host}: PRECONDITION — the load is accepted (${show(loaded)})`).toBe(200);
        await pause();
      };
      const nameAll = (m: Mounted, into: Set<string>, values = storedRevisions(m).map(([, value]) => value)) => { for (const value of values) for (const key of namedBy(m, value)) into.add(key); return into; };
      // P98 R10 (R-P569 (b)): and the packs, the objects the parts and shards of a load are stored in (namedBy names a pack by its key).
      const attachments = (m: Mounted) => [...objectKeys(m, 'part'), ...objectKeys(m, 'shard'), ...objectKeys(m, 'idshard'), ...objectKeys(m, 'ids'), ...objectKeys(m, 'pack')];
      /** Objects no stored revision names (a leak), and objects the current or the previous revision names that are gone (a loss). */
      const state = (m: Mounted) => {
        const named = nameAll(m, new Set()), kept = nameAll(m, new Set(), storedRevisions(m).slice(-2).map(([, value]) => value));
        return { unnamed: attachments(m).filter(key => !named.has(key)), lost: sorted([...kept].filter(key => !m.storage.objects.has(key))) };
      };
      // 1. The grace: every upload reported a moment ago.
      const g = await mount(host, DOCS);
      shortRetention(g);
      const recent = uploadedAt(g, () => new Date());
      await declareProductSlots(g);
      const everNamed = new Set<string>();
      for (const records of loadsOf) { await loadAndWait(g, records); nameAll(g, everNamed); }
      const first = await catalogue(g);
      requireSharded(first.view, 'P93.CS5');
      const purged = await asOperator(g, 'GET', `/content/catalog/revisions/${first.doc.revision - 2}?scope=${TENANT}`);
      expect(purged.status, `${host}: PRECONDITION — the first load's revision was purged under the setting (${show(purged)})`).toBe(410);
      const graceKept = sorted([...everNamed].filter(key => !g.storage.objects.has(key)));
      recent();
      // 2. Past the grace.
      const m = await mount(host, DOCS);
      shortRetention(m);
      const old = uploadedAt(m, () => new Date(0));
      await declareProductSlots(m);
      for (const records of loadsOf) await loadAndWait(m, records);
      const clean = { ...state(m), shards: heldKeys(m, 'shard').length > 0 };
      // 3. The budget exhausted at the purge's first deletion of an attachment, once, before it deletes anything.
      const bucket = m.storage as unknown as Record<string, unknown>, saved = Object.getOwnPropertyDescriptor(bucket, 'delete');
      const deleteNow = (bucket.delete as (keys: string | string[]) => Promise<void>).bind(m.storage);
      let faulted = false;
      Object.defineProperty(bucket, 'delete', { configurable: true, writable: true, value: async (keys: string | string[]) => {
        if (!faulted && [keys].flat().some(key => ['part', 'shard', 'idshard', 'ids', 'pack'].includes(classOf(key)))) { faulted = true; throw new Error('P93 fixture: the purge\'s budget is exhausted'); }
        return deleteNow(keys);
      } });
      try { await loadAndWait(m, [{ ...a1, title: `${a1.title}, third retouch` }]); }
      finally { if (saved) Object.defineProperty(bucket, 'delete', saved); else Reflect.deleteProperty(bucket, 'delete'); }
      const cut = { faulted, ...state(m) };
      // 4. The next publication's purge resumes.
      await loadAndWait(m, [{ ...a1, title: `${a1.title}, fourth retouch` }]);
      const resumed = { ...state(m), revisions: storedRevisions(m).length };
      old();
      expect.soft({ graceKept, clean, cut, resumed }, `${host}: P93.CS5 — the grace kept, nothing unnamed left, no body deleted before its attachments, the sweep resumed (today the body goes first: ${JSON.stringify(cut.unnamed)})`).toEqual({
        graceKept: [], clean: { unnamed: [], lost: [], shards: true }, cut: { faulted: true, unnamed: [], lost: [] }, resumed: { unnamed: [], lost: [], revisions: 2 } });
    }, 300_000);
  }
});

// ===========================================================================
// unit:P93.CS6 — the reads and the readers resolve through the anchor's shard
// ===========================================================================

/** P84's carousel and P85's measurement, unscoped as P85's own fixture has it (P86's beacon fixture). */
const P85_CAROUSEL = { slot: CAROUSEL, take: 8, weights: { category: 1 }, shotOrders: [
  { context: { channel: 'paid_social', visitBuckets: ['1'], device: 'mobile' }, order: ['on-model', 'detail', 'studio', 'flat-lay'] }] };
const P85_DOCS = { pieces: [...MODULES], slots: { ...declaredSlots([]), pages: { pdp: [layoutSlot(), P85_CAROUSEL] } }, learn: LEARN };
const BEACON_IMAGES = Array.from({ length: 8 }, (_, i) => image(`img-ch857-b${i + 1}`, i === 7 ? [A, BLACK] : [A], 'Handbags', SHOTS[i % 4]!));
async function tableVersionOf(m: Mounted): Promise<string> {
  const response = await m.fetch(new Request(`https://shop.invalid/v1/${TENANT}/context-table/pdp`, { headers: { 'X-Tenant': TENANT } }));
  const body = await response.json().catch(() => ({})) as { version?: unknown };
  return typeof body.version === 'string' ? body.version : `no table (${response.status})`;
}
const beaconOf = (s: Shopper, version: string, extra: Record<string, unknown> = {}) => s.action({ type: 'carousel_exposure', data: { tableVersion: version,
  context: 'default', page: 'pdp', slot: CAROUSEL, images: BEACON_IMAGES.map(r => r.id), arm: 'personalized', pageInstance: pageInstanceOf('p93-beacon'), ...extra } });
const beaconAnswer = (a: Answer) => [a.status, a.body.exposure ?? null, a.body.reason ?? a.body.images ?? null];

describe('unit:P93.CS6 (R-P487 (4), (7), R-P490 (2): the reads and the readers through the shard)', () => {
  for (const host of HOSTS) {
    it(`host (${host}): GET /content/catalog answers the sharded manifest (no products list) with its envelope counted from the shard pointers; ?shard=<hex2> answers that one shard as stored (an empty one for a shard the index does not list, 400 for a malformed name); ?product= reads the product's shard and part (404 for a product no shard holds, in a listed bucket or not; 503 for a lost part)`, async () => {
      const m = await rangeTenant(host, 600);
      const { doc, view } = await catalogue(m);
      requireSharded(view, 'P93.CS6');
      const read = await asOperator(m, 'GET', `/content/catalog?scope=${TENANT}`), envelope = (read.body.envelope ?? {}) as Record<string, unknown>;
      const bucket = bucketOf(A), pointer = view.shards[bucket]!, shard = await shardRead(m, bucket);
      const stored = JSON.parse(heldRaw(m, KEY.shard(pointer.digest)) ?? 'null') as unknown; // P98 R10 (R-P569 (b)): as stored, in its pack or as its own
      const unlisted = [...Array(256).keys()].map(i => i.toString(16).padStart(2, '0')).find(b => !Object.hasOwn(view.shards, b));
      const none = unlisted ? await shardRead(m, unlisted) : null, malformed = await shardRead(m, 'zz');
      const productsOfShard = (a: Answer) => Object.keys(((a.body.document as { products?: object } | undefined)?.products ?? { 'no products member': 1 }));
      invalidatePublicationCache();
      const product = await metered(m, () => productRead(m, A));
      const inListed = idByListing('COA-ABSENT-', view, true), inEmpty = idByListing('COA-EMPTY-', view, false);
      const misses = [(await productRead(m, inListed)).status, (await productRead(m, inEmpty)).status];
      const restoreLost = loseObject(m, KEY.part(view.products[rangeProduct(9)]!.digest)); invalidatePublicationCache(); // P98 R10 (R-P569 (b))
      const lost = await productRead(m, rangeProduct(9));
      restoreLost(); invalidatePublicationCache();
      const records = ANCHOR_IMAGES.length + 2 + 600;
      expect.soft({ document: [read.status, Object.hasOwn(read.body.document as object, 'products'), Object.hasOwn(read.body.document as object, 'index')],
        envelope: [envelope.pieces ?? null, envelope.products ?? null, envelope.bytes ?? null],
        shard: [shard.status, shard.body.digest ?? null, JSON.stringify(shard.body.document) === JSON.stringify(stored)],
        none: none ? [none.status, productsOfShard(none)] : 'every bucket listed', malformed: malformed.status,
        product: [product.result.status, readIds(product.result), shardOrPart(readClasses(product.ops))], misses, lost: [lost.status, JSON.stringify(lost.body).includes('part_unavailable')] },
      `${host}: P93.CS6 — the reads (today the manifest lists every product: ${show(read).slice(0, 160)})`).toEqual({
        document: [200, false, true], envelope: [SHARED.length + records, 603, documentBytes(doc.document)], shard: [200, pointer.digest, true],
        none: unlisted ? [200, []] : 'every bucket listed', malformed: 400,
        product: [200, sorted(ANCHOR_IMAGES.map(r => r.id)), sorted([KEY.shard(pointer.digest), KEY.part(view.products[A]!.digest)])], misses: [404, 404], lost: [503, true] });
    }, 600_000);

    it(`host (${host}): every reader resolves the anchor's part through its shard — each carousel decision replays equal; its receipt names the image's title; the learn routes keep each image named unresolved; a click on the shopper's own decision teaches its catalogue format reading at most one shard and one part, another visitor's decision resolves nothing; an event naming a parted product is recognized by the ingest vocabulary`, async () => {
      const m = await rangeTenant(host, 600);
      const { view } = await catalogue(m);
      requireSharded(view, 'P93.CS6');
      const s = await shopperOn(m), y = await shopperOn(m);
      const page = await snapshotOf(m, s, 'pdp', { anchor: A, variant: BLACK }, 'p93-cs6-readers');
      const images = page.decisions.filter(d => d.slot === CAROUSEL);
      expect(sorted(images.map(d => d.contentId)), `${host}: PRECONDITION — the anchor's carousel is served (${page.status})`).toEqual(SERVED_FOR_BLACK);
      for (const d of images) expect((await s.ack(page, d)).status, `${host}: PRECONDITION — ${d.contentId} is acknowledged`).toBe(200);
      await m.drainLedger();
      const decided = storedDecisions(m, s.subject).filter((r: DecisionRecord) => r.slot === CAROUSEL);
      expect(decided.length, `${host}: PRECONDITION — the carousel's records are stored`).toBe(images.length);
      const replays: unknown[] = [];
      for (const r of decided) { invalidatePublicationCache(); const replay = await replayOf(m, r.decision_id); replays.push([r.item_id, replay.status, replay.body.classification ?? replay.body.reason ?? null]); }
      const titles = new Map(ANCHOR_IMAGES.map(r => [r.id, r.title]));
      invalidatePublicationCache();
      const receipts = (await receiptsOf(m, s.subject)).filter(x => x.slot === CAROUSEL);
      const published = await asOperator(m, 'POST', `/v1/${TENANT}/learn/publish`, { slot: CAROUSEL });
      const rowsOf = (a: Answer) => sorted(((a.body.rows ?? []) as Array<Record<string, unknown>>).map(r => JSON.stringify([r.item, r.title ?? null, r.unresolved ?? 'no unresolved member'])));
      const rows = await asOperator(m, 'GET', `/v1/${TENANT}/lift/rows?slot=${CAROUSEL}`), exploring = await asOperator(m, 'GET', `/v1/${TENANT}/learn/exploring?slot=${CAROUSEL}`);
      const clicked = images.find(d => d.contentId === 'img-ch857-1')!;
      invalidatePublicationCache();
      const foreign = await metered(m, () => y.click(page, clicked));
      invalidatePublicationCache();
      const own = await metered(m, () => s.click(page, clicked));
      const ownReads = shardOrPart(readClasses(own.ops));
      const taught = (((await servePage(m, s, 'pdp')).records[0]?.inputs?.affinity ?? {}) as Record<string, Record<string, number>>).contentType ?? {};
      const recognized = (a: Answer) => (a.body.signals as { recognized?: unknown } | undefined)?.recognized ?? 'no signals member';
      const parted = await s.action({ type: 'product_view', data: { productId: rangeProduct(77) } });
      const stranger = await s.action({ type: 'product_view', data: { productId: 'COA-NOT-IN-THE-CATALOGUE' } });
      const unrecognized = (a: Answer) => (a.body.signals as { unrecognized?: unknown } | undefined)?.unrecognized ?? 'no signals member';
      const expectedRows = sorted(SERVED_FOR_BLACK.map(id => JSON.stringify([id, null, true])));
      expect.soft({ replays, receipts: receipts.map(x => [x.item, x.title ?? null]), learn: [published.status, rows.status, rowsOf(rows), exploring.status, rowsOf(exploring)],
        foreign: [foreign.result.status, recognized(foreign.result), shardOrPart(readClasses(foreign.ops))],
        own: [own.result.status, recognized(own.result), ownReads.filter(k => classOf(k) === 'shard').length <= 1 && ownReads.filter(k => classOf(k) === 'part').length <= 1, Object.keys(taught)],
        vocabulary: [parted.status, unrecognized(parted), stranger.status, unrecognized(stranger)] },
      `${host}: P93.CS6 — the readers resolve through the shard (receipts ${JSON.stringify(receipts.map(x => [x.item, x.title ?? null])).slice(0, 200)}; vocabulary ${JSON.stringify(unrecognized(parted))})`).toEqual({
        replays: decided.map(r => [r.item_id, 200, 'equal']), receipts: receipts.map(x => [x.item, titles.get(String(x.item)) ?? 'not an anchor image']),
        learn: [200, 200, expectedRows, 200, expectedRows], foreign: [200, false, []], own: [200, true, true, ['on-model']],
        vocabulary: [200, [], 200, ['COA-NOT-IN-THE-CATALOGUE']] });
    }, 600_000);

    it(`host (${host}): P85's carousel beacon on a sharded tenant — a beacon naming its product reads that product's shard and its one part and is admitted; one naming none is ignored product_required`, async () => {
      const m = await mount(host, P85_DOCS);
      expectPublished(m, 'P93.CS6 — the parted tenant publishes');
      await declareProductSlots(m);
      const loaded = await importJson(m, [...BEACON_IMAGES, ...rangeRecords(1, 50)], { mode: 'merge' });
      expect(loaded.status, `${host}: PRECONDITION — the anchor's images load (${show(loaded)})`).toBe(200);
      const { view } = await catalogue(m);
      requireSharded(view, 'P93.CS6');
      const s = await shopperOn(m), version = await tableVersionOf(m);
      invalidatePublicationCache();
      const withProduct = await metered(m, () => beaconOf(s, version, { product: A }));
      const unnamed = await beaconOf(s, version);
      expect.soft({ named: beaconAnswer(withProduct.result), reads: shardOrPart(readClasses(withProduct.ops)), unnamed: beaconAnswer(unnamed) },
        `${host}: P93.CS6 — the named product's shard and part read and admitted (${show(withProduct.result)})`).toEqual({
        named: [200, 'admitted', 8], reads: sorted([KEY.shard(view.shards[bucketOf(A)]!.digest), KEY.part(view.products[A]!.digest)]), unnamed: [200, 'ignored', 'product_required'] });
    }, 120_000);
  }
});

// ===========================================================================
// unit:P93.CS7 — the kits state the sharded index
// ===========================================================================

describe('unit:P93.CS7 (R-P487: the kits)', () => {
  it('logic: kits 03 and 02 state the sharded index (`index`, `sha256-hex2`, 256 product shards by the SHA-256 of the product id and id shards by the record id), the product page\'s 8 reads, the caps with their 413 names (`index_shard_too_large`, `id_index_too_large`, `manifest_too_large` from the shared pieces, `rollback_too_large` past 900 checks), the `removeProducts` list, the migration needing nothing of the operator, and the chunking advice (files of about 200 to 300 products); kit 02\'s GET row names the `shard=` read; today\'s one-level sentences are gone', () => {
    const kit02 = readTree('docs/kit/02-api-reference.md'), kit03 = readTree('docs/kit/03-payload-schemas.md');
    const paragraphs = (text: string) => text.split(/\n\s*\n/).map(p => p.split('\n').join(' '));
    const has = (text: string, ...words: Array<string | RegExp>) => paragraphs(text).some(p => words.every(w => typeof w === 'string' ? p.includes(w) : w.test(p)));
    const flat03 = kit03.replace(/\s+/g, ' ');
    const getRow = kit02.split('\n').find(line => line.startsWith('| `GET /content/{kind}?scope=`')) ?? '';
    expect.soft({
      // The code names and members are matched as words (a kit may quote them in backticks or inside a JSON literal).
      index: has(kit03, /`index`/, /sha256-hex2/, /\b256\b/, /\bshards?\b/),
      productKey: has(kit03, /SHA-256/, /\bshard\b/, /\bproduct\b/),
      idShards: has(kit03, /\bid shards?\b/, /\brecord id\b/, /SHA-256|keyed the same way/),
      page: has(kit03, /\b(?:8|eight) reads\b/, /\bshard\b/, /\bpart\b/),
      shardCap: has(kit03, /\bindex_shard_too_large\b/, /\b413\b/, /\bshard\b/),
      idCap: has(kit03, /\bid_index_too_large\b/, /\b413\b/, /\bid shard\b/),
      manifestCap: has(kit03, /\bmanifest_too_large\b/, /\bshared pieces\b/),
      rollback: has(kit03, /\brollback_too_large\b/, /\b900\b/),
      removeProducts: has(kit03, /`removeProducts\b/, /\bPUT\b/),
      migration: has(kit03, /\boperator\b/, /\bnext\b/, /\bshard/),
      chunking: has(kit03, /\b200\b/, /\b300\b/, /\bproducts\b/),
      shardRead: getRow.includes('shard='),
      gone: ['The index has its own limit of 8 MiB', 'Each load reads the index once', 'leaves that product\'s pointer out',
        'a PUT that leaves a product\'s pointer out removes that product\'s part', 'roughly 15,000 to 20,000 products',
        'is the next step for a larger range and is not built'].filter(sentence => flat03.includes(sentence)),
    }, 'P93.CS7 — the kit states the sharded index (today it states the one-level index and its 15,000–20,000 limit)').toEqual({
      index: true, productKey: true, idShards: true, page: true, shardCap: true, idCap: true, manifestCap: true, rollback: true, removeProducts: true, migration: true,
      chunking: true, shardRead: true, gone: [] });
  });
});

// src/units/P86/LEDGER.unit.test.ts
// P86 under the Closure Ledger (programme `tapestry-parity-activation`, amendment 11, item E10): the tests for the LOCAL
// criteria CS1–CS3 of the P86 work order (docs/parity/activation/program.json). LV1 is a deferred live row and gets no test.
//
// THE FORM IN FORCE (P93, amendment 12 E18; R-P487, R-P489, R-P490, R-P491): the catalogue's index is SHARDED. The
// manifest carries `index: { key: 'sha256-hex2', shards: { <hex2>: { digest, products, records } }, ids: { <hex2>:
// { digest, records } } }` in place of P86's one-level `products` and `idIndex`. A product shard
// (`config-publication/v1/<scope>/content/shard/<digest>.json`, `{ shard, products }`) points each of its products at its
// part; an id shard (`.../content/idshard/<digest>.json`, `{ shard, ids }`) names the product whose part holds each part
// record; a product or a record id falls in the shard named by the first two hex digits of the SHA-256 of its id. A
// product page reads the head, the set, the four revisions, the anchor's shard and its part (8 reads); a load reads the
// shards of the products it names and the id shards only of ids whose place can change, and writes only what moved; a PUT
// carries `index` exactly as read and removes a product only by `removeProducts`; each shard is capped at 2 MiB
// (`index_shard_too_large`, `id_index_too_large`), the manifest by its shared pieces alone; a one-level catalogue is
// written sharded by its next publication (src/units/P93). The shapes below are P86's as ruled (one-level), kept as this
// file's history; its helpers and the legs R-P489/R-P490 name read the sharded form.
//
// THE REQUIREMENT, verbatim (docs/parity/authority/amendment-11/BTI-Parity-Amendment-2026-10-22-activation.md:87–91, E10):
//   "#### E10 · Catalogue size beyond the test scope
//    - **Authority:** the kit's catalogue limit (about 2,000 pieces, 2 MiB per catalogue document); one item per image
//      across the whole product range exceeds it.
//    - **Done when:** a design decision first (per-product scoping of image records, sharding by product range, or a
//      larger store), then the build; the test scope fits today and the first dataset is sized with Tapestry after the
//      first test.
//    - **Relates to:** E2. **Needed by:** the full range, after the first test. Design first; then within a day or two."
// DECISION D2 AS RULED (R-P405, _evidence/parity-step3/AMENDMENTS.md): design A, per-product scoping as a manifest with
// immutable per-product parts (the analyst's note _evidence/parity-step3/S32/analyst/E10-DESIGN.md §2 A3, §6). Its shapes:
//   "`content` stays ONE member with ONE revision. Its value becomes a manifest: today's shape (`version`, `typeFallback`,
//    and `pieces` = the shared pieces …), plus an optional `products: {"<productId>": {digest, records}}` and a
//    declaration of the product-scoped slot types (for example `productSlots: ["pdp-carousel"]`)"; "Each product's image
//    records are one immutable, content-addressed part object (`config-publication/v1/<scope>/content/part/<sha256>.json`),
//    ≤ 2 MiB"; "A manifest without `products` is today's catalogue"; "A piece whose `slotTypes` are all product-scoped and
//    which names `featuredProductIds` goes to its product's part; every other piece is shared"; R-P405: "a two-id record
//    routes by its product id, the first id"; "reads ONE part only when the page has an anchor-scoped slot and
//    `ctx.anchor` names an indexed product (the part cached per isolate by digest)"; "P91's modes per product"; "the skip
//    on the manifest digest, the dry run assembling the touched parts"; "a manifest that would exceed its cap is refused
//    413 by name, and the two-level index (256 fixed buckets) is recorded as the next step"; "a part is kept while any
//    revision in the publication's kept history references it and purged with the revision purge".
//
// THE SHAPES, RATIFIED (R-P407, on the provisional abbe8da5; S9–S11 added by R-P407's rulings):
//   S1 The manifest, as `GET /content/catalog` answers it in `document`: `{ version, typeFallback?, productSlots, pieces,
//      products }` — `pieces` the shared pieces only; `productSlots` the slot names declared product-scoped (written by a
//      PUT of the catalogue, kept by every load); `products` `{ "<productId>": { digest: <64 lowercase hex>, records:
//      <the part's record count> } }`. A catalogue that declares no `productSlots` carries neither member and is today's
//      document, every piece shared, no part written (the locks). `productSlots` is the catalogue's own declaration, not
//      derived from the slots document's `scope: 'anchor'`. (P93: the manifest carries `index`, the shard pointers, in
//      place of `products`; the per-product pointers live in the product shards.)
//   S2 A part: the R2 object `config-publication/v1/<scope>/content/part/<digest>.json`, its body the canonical JSON of
//      `{ product, pieces }` (the stored pieces, defaults applied as an import applies them), `documentDigest` of that
//      value the `<digest>` of its key and of the manifest's pointer; at most 2 MiB; written before the pending head is
//      reserved (reading 3 below), so a load whose part cannot be written commits nothing and leaves nothing pending.
//   S3 Routing on the import, the pull and the PUT: a piece whose `slotTypes` are all in `productSlots` and which names
//      `featuredProductIds` goes to the part of its FIRST id; every other piece is shared; such a piece declaring
//      `pooled: true` is refused 422 naming it (`records[k] '<id>'`, P82's address, on a load) and `pooled`. A PUT may
//      carry `products` pointers equal to those of the revision its If-Match names (a GET→PUT round trip keeps every
//      part); any other pointer is refused 422 naming the product.
//   S4 The modes per product (reading 1 below): `merge` upserts inside the parts the file touches and the shared pieces;
//      `replace` and `full` replace each product the file names, whole (`full` keeping that product's left-out records
//      expired, `expire` counted over the named products), and the shared pieces only when the file carries one; every
//      other product untouched. The skip: the stamped manifest's digest equals the stored one (it covers every part
//      digest). The dry run writes nothing, no part included. The import answer's `pieces` and the GET's
//      `envelope.pieces` count shared + parts; `envelope.bytes` is the manifest's; `envelope.products` the index's size.
//   S5 The cap: a load whose manifest (its index) would pass 2 MiB is refused 413 `code: 'manifest_too_large'`, nothing
//      written (no part either); the two-level index was the next step (P93 built it as the sharded index: the
//      manifest no longer grows with the products, and each shard is capped at 2 MiB instead).
//   S6 The per-product read: `GET /content/catalog?scope=<tenant>&product=<productId>` → 200 `{ scope, kind, source,
//      revision, publication, product, digest, document: { product, pieces }, envelope }`; a product the manifest does
//      not index → 404 naming it. (Not `/content/catalog/products/<id>`: reading 6.)
//   S7 The decision: pin, the manifest, and ONE part only for a page with a slot declared `scope: 'anchor'` whose request
//      names an indexed `ctx.anchor`; `shared ∪ part` enters `decideContent`; the part cache is keyed as the publication
//      cache is (backing binding, scope) and by digest, and `invalidatePublicationCache` clears it.
//   S8 THE READ COUNTER (CS2): the R2 `get` calls on the mount's bucket under `config-publication/`, each classed (head,
//      set, `<kind> revision`, `part <digest>`) with its object size; the parsed records are the manifest's shared pieces
//      plus the records of the parts read. THE GENERATOR: N products `COA-R00001…`, one image record each, four
//      categories, two lines and every seventh tagged on a dimension no registry maps; one load, inside INPUT_MAX_RECORDS
//      and INPUT_MAX_BYTES (asserted); N = 50 and N = 5,000; every part at most 2 MiB.
//   S9 `variant_first`: on an import's or a pull's answer, `diagnostics.warnings` carries `{ code: 'variant_first',
//      recordIndex, recordId, … }` (P82's record members) for each two-id record whose first id is its second followed by
//      `-` and more; the record is routed to its first id and the load is accepted.
//   S10 The learn routes (`/lift/rows`, `/learn/exploring`): in a catalogue with parts, a row whose item the shared pieces
//      do not carry and which names no anchor is kept and named `unresolved: true` (its title and customer id null); W25's
//      rule (an id the catalogue does not carry is never offered) stays as it is for a catalogue without parts.
//   S11 The purge (W38 B4's `purgeByPolicy`, under the tenant's `configuration` retention setting): when it removes a
//      revision, it removes that revision's parts that no kept revision's manifest references, and only those.
//
// THE READINGS, RULED (R-P407), where the code or the note left them open:
//   1 `replace` and `full` act on the products the file names and on the shared pieces ONLY when the file carries a shared
//     piece (the brief's "and the shared pieces" read so; literally, a replace of one product's images would empty the
//     page's modules).
//   2 The first id routes. The kit states the canonical order [product, variant]; a two-id record written variant-first
//     is routed to its first id as written, and the import warns `variant_first` (S9, a diagnostic, never a refusal) when
//     the first id extends the second as a variant form (`<product>-<variant>`); P80's either-order scope filter
//     (decide.ts inScope, :920–923) is unchanged inside the part read. A routed `[variant, product]` record therefore
//     lands in the variant's part and is no candidate on the product's page: the routing leg shows it.
//   3 Parts are written before the pending head's reservation, never inside `finish` (the recovery path: the pending head
//     carries only the manifest, so a recovery could not rewrite a part).
//   4 The pending head embeds the manifest's envelope beside the set (publication.ts publishSet, `next`), so the head's
//     2 MiB is met before the manifest's; the refusal names the manifest whichever check fires (S5).
//   5 Content-id readers resolve through an anchor they hold, never a content-id index: the receipts through the record's
//     scope, the replay through `inputs.anchor`, telemetry through the acknowledged decision; the learn routes in
//     decisions.ts read the shared pieces, resolve a part for a record that carries its anchor, and name a content id
//     with no anchor as unresolved (S10).
//   6 The per-product read is `?product=` on `GET /content/{kind}` (S6); the brief's `/content/catalog/products/<id>` is
//     withdrawn: no customer-boundary change, P77.VR3 untouched.
//   7 The PUT round trip as S3. 8 Kit 02 :1790's limits sentence names the part. 9 A purged revision's parts are removed
//     when no kept revision references them (S11), in this file's own leg; the kit states the retention.
// R-P409 (from the builder's plan, S32/builder-p86/REPORT-prepared.md), three legs added:
//   (1) P85's carousel beacon on a parted tenant carries an optional `product` (the SDK sends the beacon's `productId` as
//       `product`; src/sdk/listen.ts, types.ts, src/routes/realtime.ts and the SDK bundles granted, b8d7198a): with it the
//       admission reads that one part and admits; without it, on a parted tenant, `ignored` with the new reason
//       `product_required`; on a tenant without parts the member changes nothing (a lock; P85's own legs stay green).
//       P85 is not in this file's tree (20fab871): each beacon leg asserts P85's beacon first as PRECONDITION P85 and is
//       measured behind it on a scratch copy of the P85 join 7dd77ce8 (R-P6).
//   (2) A PUT that leaves a product's pointer out removes that product (as a PUT that leaves a piece out removes it); the
//       kit says so.
//   (3) A rollback to a kept manifest whose parts the store lost is refused 410, naming every product whose part is
//       missing, after checking every pointer (one HEAD per part); nothing is written.
//   Ruled, no leg: telemetry resolves a part-held content id through the acknowledged decision's ring record (one ring
//   read, only when the id is not shared); the part cache is separate, 8 MiB.
//
// THE R10 SWEEP (src/**/*.test.ts, scripts/**): no test declares `productSlots`, reads a catalogue's `products`, a
// `content/part/` key, a `product=` read or `manifest_too_large`; no test pins kit 03's size paragraph (:277–292: "the
// catalog is one such document per scope", "a conversation about sharding the catalog") or kit 02 :1790; W32.E1.01
// (src/units/W32/B1.unit.test.ts :306–310, :355) reads `envelope` on a catalogue without parts (unchanged under S4).
// The brief's withdrawn path would have collided with P77.VR3 (reading 6); a purge that lists parts on every publication
// could move W38 B4's bounded purge work (to be measured by the whole-suite comparison).
//
// DEFERRALS AND RESIDUALS: the two-level index (R-P405 (1), told); the ingest vocabulary's publish-time summary (service.ts
// tenantCatalogVocabulary; no leg); the kit 03 cost table (:294–326, predates P80/P84/P91, not re-run); the learn routes
// other than the two S10 names (`/learn/slots` evidence, `/learn/queue`) follow the same rule and get no leg of their own;
// a scoped slot not declared in `productSlots` keeps its records shared (no consistency check is ruled).
//
// NO NEW EXPORT IS IMPORTED: the manifest, the part, the read and the refusal are read loosely through the routes and the
// mount's bucket.
//
// R-P424 (the delivery review at 28ef79d9; R-P407 (5) amended), specification round 3, test-only. The shapes:
//   S12 The id index (P93 replaced it by the 256 id shards under `content/idshard/`, read only for ids whose place can
//       change): the manifest's `idIndex: { digest, records }` (present exactly when `products` is) points at one
//       object per revision, `config-publication/v1/<scope>/content/ids/<digest>.json`, the canonical JSON of
//       `{ ids: { "<id>": "<product id>" } }` — every part record, expired ones included — whose `documentDigest` is its
//       address; written by exact-create before the pending head, as a part is; read by the loads only (import, pull,
//       validate, PUT, the rollback's existence check), never by a page (the anchor page's pinned read list below holds
//       exactly); its own limit 8 MiB, a load past it refused 413 `id_index_too_large`, nothing written; none without
//       `productSlots`; a rollback references the old revision's index.
//   S13 The load checks, each refusal 422 with an error naming its code: `record_moved` naming both products (a part
//       record whose id the index lists under another product), unless the file carries the source product too, which
//       then drops it (the move); `id_in_part` naming the id and the product (a shared piece reusing a part record's id,
//       an untouched part's included); `id_shared` naming the id and the product (a part record reusing a shared id);
//       on a PUT the same codes. Nothing written on any refusal.
//   S14 The purge removes a purged revision's index object as it removes its parts (kept while a kept revision
//       references it); it never deletes a part or an index object the bucket reports uploaded less than 15 minutes ago
//       (R2's own `uploaded`, on list, head and get; the legs set it through the bucket double).
//   Legs added (both hosts): the index written, referenced and rolled back; the move refused on a merge and on a PUT and
//   accepted with both products in one file; the two collisions; the grace; the index cap. Changed: the retention leg
//   (index objects purged with the parts; uploads reported old), the modes leg (the index follows replace and full), the
//   LOCK (no index without productSlots), the kit leg (the move rule, the collisions, the index, the lost-part fact).
// R-P416 (the specification review at 0ff67749, fix round 2), test-only: (1) the retention leg's last load retouches A again,
// so the previous kept revision alone names A's second part: it survives the purge and a rollback to that revision is
// accepted (a purge consulting the head manifest alone is RED); (2) a merge changing one shared piece alone on a parted
// catalogue writes one revision, every pointer unchanged, and the same file again is skipped (a skip comparing the product
// index alone is RED); (3) a replace carrying one shared piece and B's records leaves exactly that shared piece and B's new
// part, and a full carrying a shared piece counts the left-out shared piece in `expire` (replace/full merging the shared
// pieces is RED); the residual closed: the N = 50 and N = 5,000 anchor pages read exactly the head, the set, the content,
// slots, learn and reflex revisions and the anchor's part, once each. MEASURED (logs/s32i-*): 44/44 under the sketch on both
// hosts; each control RED on its own leg alone on both hosts (sketches/p86.py purgehead, skipindex, sharedmerge); today 42
// RED and the two locks green; the build's head c571fbb8 44/44 on a scratch copy.
// R-P412, R-P413 (from the build at fa8a8920), two legs added: (1) telemetry resolves a part-held content id only through
// the acting shopper's own ring — a click naming another visitor's decision id, one unknown to her ring, or none, reads no
// part and no other shopper's ring or key, recognizes nothing (`signals.recognized` false) and teaches no catalogue format,
// while the visitor whose decision it is learns her image's format (no counter exists or is built: R-P413); (2) the
// anchor's part unreadable (lost, or a body that is not its digest's) fails the product page 503 `part_unavailable`, never
// decided from the shared pieces alone. Also ruled, no leg: a record moving between products is refused 422.
//
// MEASURED (_evidence/parity-step3/S32/specifier/logs/, serial, --no-cache, one worker, the tree its working directory;
// sketches/p86.py; trees under scratch/): at this file's tree (20fab871, a-today) 38 RED for the missing behaviour and the
// two LOCK legs GREEN; the R-P409 (1) legs RED at PRECONDITION P85 there (the beacon is refused 400 'Invalid action
// event'; the SDK has no carouselExposure). On the P85 join 7dd77ce8 (c-today): the same 38 RED, the beacon legs now for
// the missing behaviour (a beacon naming no product admitted where product_required is expected; the SDK sends no
// `product`). The sketch (fix: src/config/publication.ts the part, its cache, the cap's name, the parts before the
// reservation, the purge, missingCatalogueParts; src/content/kinds.ts, types.ts; src/routes/content.ts the parted import,
// pull and PUT, ?product=, the envelope, the rollback's part check; src/content/service.ts the one-part read and the
// beacon's product; src/learn/replay.ts; src/reflex/contentTelemetry.ts the own-ring resolution; src/routes/decisions.ts
// the receipts, the learn routes, the snapshot's part_unavailable; src/sdk/listen.ts the beacon's product; the kit) 40/40
// three times; tsc exit 0 on the sketch tree. The wrong fixes, each RED on its own legs (both hosts): wholerange (every
// part read) the N leg, the no-part leg and the part_unavailable leg; embedded (no routing) 36; secondid 14; skipshared
// 22; pooledpart, replaceall, sharedreplace, partafter, pendingpart, capdoc, replayshared, receiptsshared, learnshared,
// anyanchor, nocache, nopurge, purgeall, novariantwarn, beaconshared, putkeep, rollbackblind, telemetryforeign (any
// visitor's ring), partfallback (an unreadable part decided from the shared pieces) 2 each, on their own leg;
// telemetryshared 4 (the readers leg and the R-P412 leg); kitleft and sdknoproduct 1 each. The whole suite (R-P248) on the
// P85 join (logs/s32f-compare.txt): 4071 tests today, 4075 under the sketch; failing under the sketch alone only the five
// generated-SDK checks (P34.T5, P60.SD3, P84.CO2, W40.P3 ×2: the sketch changes src/sdk/listen.ts and rebuilds no bundle; the
// builder's regenerated bundles, granted at b8d7198a, are exact); failing today alone only P86's own; 50 failing on both
// trees are the scratch layout (the .mjs suites, root.worker, and the console legs reading the base commit through git).
//
// HARNESS: src/units/_parity.ts (the mounted application, both hosts, the operator routes, the bucket double). Imports from
// src/units/: ../_parity.

import { describe, expect, it, vi } from 'vitest';

import { INPUT_MAX_BYTES, INPUT_MAX_RECORDS } from '@/config/input';
import { documentBytes, documentDigest, invalidatePublicationCache, PUBLICATION_MAX_BYTES } from '@/config/publication';
import type { DecisionRecord } from '@/content/types';
import { SHOPPER_HEADER } from '@/identity/sessionCapability';
import { createCore } from '@/sdk/core';
import { createListen } from '@/sdk/listen';
import { testHost } from '@/sdk/testHost';

import {
  asOperator, BRAND, declaredSlots, errorsOf, expectPublished, HOSTS, layoutSlot, learnDocument, loadDocument, M, MODULES, mount, pageInstanceOf,
  putDocument, readTree, receiptsOf, recentSlot, replayOf, servedIn, servePage, shopperOn, storedDecisions, TENANT, UnitR2,
  type Answer, type Decision, type Documents, type Host, type LoadedSlots, type Mounted, type Shopper, type Snapshot,
} from '../_parity';

// ===========================================================================
// The fixture: P80's anchor product and images, three products of a range, and a generated range.
// ===========================================================================

const CAROUSEL = 'pdp-carousel', COMPLETE = 'pdp-complete-the-look';
/** P80's anchor (Tabby Shoulder Bag 26, Handbags) and its colours; the wallet (Small Leather Goods, another category); the
 * quilted bag (Handbags); a product the catalogue does not carry; Tabby 20, a product no image names. */
const A = 'COA-CH857', B = 'COA-CB925', C = 'COA-CW620', UNKNOWN = 'COA-ZZ999', UNINDEXED = 'COA-CY201';
const BLACK = 'COA-CH857-BLACK', CHALK = 'COA-CH857-CHALK';
const CATEGORY: Record<string, string> = { [A]: 'Handbags', [B]: 'Small Leather Goods', [C]: 'Handbags', [UNKNOWN]: 'Small Leather Goods' };
const SHOTS = ['on-model', 'studio', 'detail', 'flat-lay'] as const;
const slug = (product: string) => product.toLowerCase().replace(/^coa-/, '');
type Rec = Record<string, unknown> & { id: string; title: string };

/** One image record (the carousel note's shot tags; its format as `contentType`). */
const image = (id: string, products: string[] | undefined, category: string, shot: string, extra: Record<string, unknown> = {}): Rec => ({ id,
  customerContentId: `TAP-${id.toUpperCase()}`, type: shot, title: `${id} (${shot})`,
  tags: { category: [category], line: ['Tabby'], shot: [shot], contentType: [shot] }, slotTypes: [CAROUSEL], lifecycle: { status: 'live' },
  ...(products ? { featuredProductIds: products } : {}), ...extra });
/** P80's carousel images of the anchor, two of them colour-specific. */
const ANCHOR_IMAGES = [
  image('img-ch857-1', [A], 'Handbags', 'on-model'), image('img-ch857-2', [A], 'Handbags', 'studio'),
  image('img-ch857-black-3', [A, BLACK], 'Handbags', 'detail'), image('img-ch857-chalk-4', [A, CHALK], 'Handbags', 'detail'),
];
/** The wallet's image, an image of a product the catalogue does not carry, and a brand image naming no product (shared). */
const OTHER_IMAGES = [image('img-cb925-1', [B], 'Small Leather Goods', 'on-model'), image('img-zz999-1', [UNKNOWN], 'Small Leather Goods', 'on-model'),
  image('img-brand-1', undefined, 'Small Leather Goods', 'flat-lay')];
/** What the scoped carousel serves the anchor with its Black variant (P80's matching rule). */
const SERVED_FOR_BLACK = ['img-ch857-1', 'img-ch857-2', 'img-ch857-black-3'];
/** Four small records of a product, for the modes. */
const fourOf = (product: string): Rec[] => [1, 2, 3, 4].map(i => image(`img-${slug(product)}-s${i}`, [product], CATEGORY[product]!, SHOTS[i % 4]!));

/** CS1's bulk record, about 700 canonical bytes (kit 03 :280 measures 671 for the shipped average piece). */
const FILLER = 'Photographed in natural light on a neutral sweep; the frame shows the hardware, the stitching and the lining as a '
  + 'shopper sees them in the boutique, cropped for the carousel and checked against the master colour reference.';
const bulk = (product: string, n: number): Rec => {
  const frame = String(n).padStart(4, '0'), shot = SHOTS[n % 4]!;
  return { id: `img-${slug(product)}-${frame}`, customerContentId: `TAP-IMG-${product}-${frame}`, type: shot, title: `${product} image ${frame}, ${shot}`,
    excerpt: `${FILLER} (${product}, frame ${frame})`, art: `https://images.example.invalid/catalog/${product}/${frame}.jpg`,
    tags: { category: [CATEGORY[product]!], line: ['Tabby'], shot: [shot], contentType: [shot], ...(n % 7 === 0 ? { styleWorld: ['downtown'] } : {}) },
    slotTypes: [CAROUSEL], lifecycle: { status: 'live' }, featuredProductIds: n % 10 === 0 ? [product, `${product}-V${n % 3}`] : [product] };
};
const BULK = 1200;
const bulkOf = (product: string) => Array.from({ length: BULK }, (_, i) => bulk(product, i + 1));

/** The generator (S8): `count` products of a range, one image record each. */
const RANGE_CATEGORIES = ['Handbags', 'Small Leather Goods', 'Shoes', 'Ready-to-Wear'];
const rangeProduct = (k: number) => `COA-R${String(k).padStart(5, '0')}`;
const rangeRecords = (count: number): Rec[] => Array.from({ length: count }, (_, i) => {
  const k = i + 1, shot = SHOTS[k % 4]!;
  return { id: `img-r${String(k).padStart(5, '0')}-1`, customerContentId: `TAP-IMG-R${String(k).padStart(5, '0')}-1`, type: shot, title: `Range product ${k}, ${shot}`,
    tags: { category: [RANGE_CATEGORIES[k % 4]!], line: [k % 3 ? 'Tabby' : 'Willow'], shot: [shot], ...(k % 7 === 0 ? { styleWorld: ['downtown'] } : {}) },
    slotTypes: [CAROUSEL], lifecycle: { status: 'live' }, featuredProductIds: [rangeProduct(k)] };
});

const carouselSlot = { slot: CAROUSEL, take: 7, weights: { category: 1, line: 0.5 }, scope: 'anchor' };
const LEARN = learnDocument({ [CAROUSEL]: { measurementBasis: 'rendered-v1', reward: 'click' } });
/** The tenant as mounted: the modules shared, the carousel declared scoped, and (CS2) a cart page with no scoped slot. */
const DOCS = { pieces: [...MODULES], slots: declaredSlots([layoutSlot(), carouselSlot]), learn: LEARN };
const DOCS_WITH_CART = { ...DOCS, slots: { version: 'parity-coach-slots', governanceVersion: 4, pages: { pdp: [layoutSlot(), carouselSlot], cart: [recentSlot()] } } };
const MODULE_IDS = MODULES.map(p => p.id);

// ===========================================================================
// The operator's harness (P91's): the loads, the reads, the bucket.
// ===========================================================================

const show = (a: Answer) => `${a.status} ${JSON.stringify(a.body).slice(0, 300)}`;
const sorted = (ids: string[]) => [...ids].sort();
const preconditions = async (m: Mounted) => {
  const base = await loadDocument(m, 'catalog');
  return { 'If-Match': `"${base.revision}/${base.publication.revision}/${base.publication.digest}"`, 'Idempotency-Key': `${base.revision}:${crypto.randomUUID()}` };
};
const q = (members: Record<string, string>) => new URLSearchParams({ scope: TENANT, ...members }).toString();
const importJson = async (m: Mounted, records: unknown[], members: Record<string, string>, headers?: Record<string, string>) =>
  asOperator(m, 'POST', `/content/catalog/import?${q(members)}`, records, headers ?? await preconditions(m));
const FEED_URL = 'https://cms.example.invalid/p86-feed.json';
/** `POST /content/catalog/pull` of a feed `{ content: records }` answered by a stub of its URL (no network). */
async function pull(m: Mounted, records: unknown[], members: Record<string, unknown>): Promise<Answer> {
  const original = globalThis.fetch;
  const stub = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) =>
    String(input instanceof Request ? input.url : input) === FEED_URL ? new Response(JSON.stringify({ content: records }), { headers: { 'Content-Type': 'application/json' } }) : original(input, init));
  try { return await asOperator(m, 'POST', `/content/catalog/pull?scope=${TENANT}`, { url: FEED_URL, path: 'content', ...members }, await preconditions(m)); }
  finally { stub.mockRestore(); }
}
/** The catalogue declared product-scoped on the carousel (S1), over the given shared pieces. */
async function declareProductSlots(m: Mounted, pieces: unknown[] = MODULES): Promise<void> {
  const put = await putDocument(m, 'catalog', { version: 'p86-catalogue', productSlots: [CAROUSEL], pieces }, 'p86 product slots');
  expect(put.status, `PRECONDITION (${m.host}): the catalogue declaring its product slots is published (${show(put)})`).toBe(200);
}
/**
 * P93 R10 (R-P487, R-P489): the manifest's index read in either form — P86's one-level `products`, or P93's sharded
 * `index`, whose product shards (`content/shard/<digest>.json`, `{ shard, products }`) are read back from the bucket
 * that holds them. Shard objects are content-addressed, so the buckets this file's mounts wrote are searched by key,
 * newest first (each registered on its first write; a WeakRef, so a finished mount's bucket is released).
 */
const BUCKETS: Array<WeakRef<UnitR2>> = [];
const unitPut = UnitR2.prototype.put;
UnitR2.prototype.put = function (this: UnitR2, ...args: Parameters<UnitR2['put']>) {
  if (!BUCKETS.some(ref => ref.deref() === this)) BUCKETS.unshift(new WeakRef(this));
  return unitPut.apply(this, args);
};
const storedAt = (key: string): Record<string, unknown> | null => {
  for (const ref of BUCKETS) { const raw = ref.deref()?.objects.get(key); if (raw !== undefined) return JSON.parse(raw) as Record<string, unknown>; }
  return null;
};
const SHARD = /^config-publication\/v1\/coach\/content\/shard\/([0-9a-f]{64})\.json$/;
const shardKey = (digest: string) => `config-publication/v1/${TENANT}/content/shard/${digest}.json`;
const shardPointersOf = (d: LoadedSlots) => ((d.document.index as { shards?: unknown } | undefined)?.shards ?? null) as Record<string, { digest?: unknown }> | null;
/** The manifest's index, product → pointer, or `{}` where it has none (today). */
const productsOf = (d: LoadedSlots) => {
  const shards = shardPointersOf(d);
  if (!shards) return (d.document.products ?? {}) as Record<string, { digest?: unknown; records?: unknown }>;
  const out: Record<string, { digest?: unknown; records?: unknown }> = {};
  for (const pointer of Object.values(shards)) Object.assign(out, (storedAt(shardKey(String(pointer.digest)))?.products ?? {}) as object);
  return Object.fromEntries(Object.keys(out).sort().map(p => [p, out[p]!]));
};
/** P93 R10: the key of the product shard that holds a product (the sharded form), or what is missing. */
const shardOf = (d: LoadedSlots, product: string) => Object.values(shardPointersOf(d) ?? {}).map(p => shardKey(String(p.digest)))
  .find(key => Object.hasOwn((storedAt(key)?.products ?? {}) as object, product)) ?? `no shard holds ${product}`;
/** P93 R10: the shard bucket of an id: the first two hex digits of the SHA-256 of its UTF-8 bytes (R-P487 (1)). */
const bucketOfId = async (id: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(id)))][0]!.toString(16).padStart(2, '0');
const sharedOf = (d: LoadedSlots) => ((d.document.pieces ?? []) as Array<{ id: string }>).map(p => p.id);
const digestOf = (d: LoadedSlots, product: string) => String(productsOf(d)[product]?.digest ?? `no pointer for ${product}`);
const PART = /^config-publication\/v1\/coach\/content\/part\/([0-9a-f]{64})\.json$/;
const partKey = (digest: string) => `config-publication/v1/${TENANT}/content/part/${digest}.json`;
const partKeys = (m: Mounted) => [...m.storage.objects.keys()].filter(k => PART.test(k)).sort();
/** A product's part as stored, read through its pointer: its record ids, or what is missing. */
function partOf(m: Mounted, d: LoadedSlots, product: string): { ids: string[]; value: Record<string, unknown> | null; bytes: number; missing: string | null } {
  const digest = digestOf(d, product), raw = m.storage.objects.get(partKey(digest));
  if (raw === undefined) return { ids: [], value: null, bytes: 0, missing: `no part object for ${product} (${digest})` };
  const value = JSON.parse(raw) as Record<string, unknown>;
  return { ids: sorted(((value.pieces ?? []) as Array<{ id: string }>).map(p => p.id)), value, bytes: new TextEncoder().encode(raw).byteLength, missing: null };
}
/**
 * R-P424 (S12), P93 R10: the id index — P86's one object (`content/ids/`) or P93's id shards (`content/idshard/`,
 * `{ shard, ids }`, named by the manifest's `index.ids`): the stored objects, the manifest's pointers and the entries
 * (id → product). `digest` names the index as a whole: the one object's digest, or the id-shard pointers as written.
 */
const IDS = /^config-publication\/v1\/coach\/content\/(?:ids|idshard)\/([0-9a-f]{64})\.json$/;
const idsKey = (digest: string) => `config-publication/v1/${TENANT}/content/idshard/${digest}.json`;
const idsKeys = (m: Mounted) => [...m.storage.objects.keys()].filter(k => IDS.test(k)).sort();
/** The id index's pointers: the sharded `index.ids` (hex2 → { digest, records }) or P86's `idIndex`; null where there is none. */
const indexPointerOf = (d: LoadedSlots) => ((d.document.index as { ids?: unknown } | undefined)?.ids ?? d.document.idIndex ?? null) as Record<string, unknown> | null;
/** The id shard keys the manifest names (the sharded form). */
const idShardKeysOf = (d: LoadedSlots) => sorted(Object.values(((d.document.index as { ids?: unknown } | undefined)?.ids ?? {}) as Record<string, { digest?: unknown }>).map(p => idsKey(String(p.digest))));
function indexOf(m: Mounted, d: LoadedSlots): { digest: string; ids: Record<string, string> | null; value: unknown } {
  const sharded = (d.document.index as { ids?: Record<string, { digest?: unknown }> } | undefined)?.ids;
  if (sharded) {
    const ids: Record<string, string> = {};
    for (const pointer of Object.values(sharded)) {
      const raw = m.storage.objects.get(idsKey(String(pointer.digest)));
      if (raw === undefined) return { digest: JSON.stringify(sharded), ids: null, value: null };
      Object.assign(ids, (JSON.parse(raw) as { ids?: Record<string, string> }).ids ?? {});
    }
    const value = { ids: Object.fromEntries(Object.keys(ids).sort().map(id => [id, ids[id]!])) };
    return { digest: JSON.stringify(sharded), ids: value.ids, value };
  }
  const digest = String((d.document.idIndex as { digest?: unknown } | undefined)?.digest ?? 'no idIndex');
  const raw = m.storage.objects.get(`config-publication/v1/${TENANT}/content/ids/${digest}.json`);
  const value = raw === undefined ? null : JSON.parse(raw) as { ids?: Record<string, string> };
  return { digest, ids: value?.ids ?? null, value };
}
/** Every part record's id → its product, read from the parts the manifest points at: what the index must hold. */
function partEntries(m: Mounted, d: LoadedSlots): Record<string, string> {
  const out: Record<string, string> = {};
  for (const product of Object.keys(productsOf(d)).sort()) for (const id of partOf(m, d, product).ids) out[id] = product;
  return out;
}
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
  Object.defineProperty(bucket, 'get', { configurable: true, writable: true, value: async (key: string) => {
    const found = await proto.get.call(m.storage, key); return found ? { ...found, uploaded: when(key) } : null;
  } });
  return () => { for (const name of ['list', 'head', 'get']) Reflect.deleteProperty(bucket, name); };
}
const errorsWith = (a: Answer, ...words: string[]) => errorsOf(a).some(e => words.every(w => e.includes(w))) ? `names ${words.join(', ')}` : `does not (${show(a)})`;
/** S6: the per-product read. */
const productRead = (m: Mounted, product: string) => asOperator(m, 'GET', `/content/catalog?scope=${TENANT}&product=${encodeURIComponent(product)}`);
const readIds = (a: Answer) => sorted((((a.body.document as { pieces?: unknown } | undefined)?.pieces ?? []) as Array<{ id: string }>).map(p => p.id));

/** S8: the R2 reads one operation makes under `config-publication/`, each key with its object's size. */
interface Read { key: string; bytes: number }
async function counted<T>(m: Mounted, run: () => Promise<T>): Promise<{ result: T; reads: Read[] }> {
  const bucket = m.storage as unknown as Record<string, unknown>, original = UnitR2.prototype.get, reads: Read[] = [];
  Object.defineProperty(bucket, 'get', { configurable: true, writable: true, value: async (key: string) => {
    const found = await original.call(m.storage, key);
    if (key.startsWith('config-publication/')) reads.push({ key, bytes: found?.size ?? 0 });
    return found;
  } });
  try { return { result: await run(), reads }; } finally { Reflect.deleteProperty(bucket, 'get'); }
}
const partReads = (reads: Read[]) => reads.filter(r => PART.test(r.key));
const classOf = (key: string): string => {
  const part = PART.exec(key); if (part) return `part ${part[1]}`;
  if (/\/head\.json$/.test(key)) return 'head';
  if (/\/set\/[0-9]+\.json$/.test(key)) return 'set';
  const revision = /^config-publication\/v1\/[^/]+\/([^/]+)\/rev\/[0-9]+\.json$/.exec(key);
  return revision ? `${revision[1]} revision` : key;
};
const classes = (reads: Read[]) => reads.map(r => classOf(r.key)).sort();

/** R-P413: the reads one operation makes that name another shopper — R2 keys and decision-ring objects carrying her subject — and its part reads. */
async function foreignReads<T>(m: Mounted, other: string, run: () => Promise<T>): Promise<{ result: T; foreign: string[]; parts: number }> {
  const bucket = m.storage as unknown as Record<string, unknown>, original = UnitR2.prototype.get, foreign: string[] = [];
  const rings = m.env.DECISION_RING as unknown as { get: (name: string) => unknown }, ringGet = rings.get;
  let parts = 0;
  Object.defineProperty(bucket, 'get', { configurable: true, writable: true, value: async (key: string) => {
    if (key.includes(other)) foreign.push(`R2 ${key}`);
    if (PART.test(key)) parts++;
    return original.call(m.storage, key);
  } });
  rings.get = (name: string) => { if (String(name).includes(other)) foreign.push(`ring ${String(name)}`); return ringGet(name); };
  try { return { result: await run(), foreign, parts }; } finally { Reflect.deleteProperty(bucket, 'get'); rings.get = ringGet; }
}
/** The decision request with the page's ctx signals on the GET's query string (P80's form). */
async function snapshotOf(m: Mounted, s: Shopper, page: string, signals: Record<string, string>, label: string): Promise<Snapshot> {
  const pageInstance = pageInstanceOf(label);
  const ctx = Object.entries(signals).map(([name, value]) => `&ctx.${name}=${encodeURIComponent(value)}`).join('');
  const response = await m.fetch(new Request(`https://shop.invalid/v1/${TENANT}/decisions/snapshot?page=${page}&brand=${BRAND}&pageInstance=${pageInstance}${ctx}`,
    { method: 'GET', headers: { 'X-Tenant': TENANT, [SHOPPER_HEADER]: s.grant.capability } }));
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  await m.drain();
  return { status: response.status, body, page, pageInstance, decisions: (body.decisions ?? []) as Decision[] };
}
const carousel = (snapshot: Snapshot) => sorted(servedIn(snapshot, CAROUSEL));

/** A tenant with the range of `n` generated products and P80's images loaded in one merge load (CS2). */
async function rangeTenant(host: Host, n: number, documents: Documents = DOCS_WITH_CART): Promise<Mounted> {
  const m = await mount(host, documents);
  expectPublished(m, 'P86.CS2 — the tenant documents publish');
  await declareProductSlots(m);
  const records = [...ANCHOR_IMAGES, ...OTHER_IMAGES, ...rangeRecords(n)];
  // The generator's bounds (S8): one load within the import's own caps (src/config/input.ts, unchanged).
  expect([records.length <= INPUT_MAX_RECORDS, new TextEncoder().encode(JSON.stringify(records)).byteLength < INPUT_MAX_BYTES],
    `PRECONDITION: the range of ${n} products is one load within ${INPUT_MAX_RECORDS} records and ${INPUT_MAX_BYTES} bytes`).toEqual([true, true]);
  const loaded = await importJson(m, records, { mode: 'merge' });
  expect(loaded.status, `PRECONDITION (${host}): the range of ${n} products loads (${show(loaded)})`).toBe(200);
  return m;
}

// ===========================================================================
// unit:P86.CS1 — the range is accepted in several loads, each product one immutable part behind one catalogue revision
// ===========================================================================

describe('unit:P86.CS1 (D2: design A, R-P405)', () => {
  for (const host of HOSTS) {
    it(`host (${host}): three merge loads of ${BULK} image records each (A and B imported, C pulled; more than one 2 MiB document holds) are each one revision; each product's records are one part of at most 2 MiB at its content address, the manifest's pointer; the manifest holds the shared pieces, productSlots and the index, under the cap and smaller than any part; GET /content/catalog answers it; the per-product read answers each product's records; the answer's pieces and the envelope count shared + parts`, async () => {
      const m = await mount(host, DOCS);
      expectPublished(m, 'P86.CS1 — the tenant documents publish');
      await declareProductSlots(m);
      const range: Record<string, Rec[]> = { [A]: bulkOf(A), [B]: bulkOf(B), [C]: bulkOf(C) };
      expect(documentBytes({ pieces: [...MODULES, ...range[A]!, ...range[B]!, ...range[C]!] }), 'PRECONDITION: the three products\' records exceed one 2 MiB document')
        .toBeGreaterThan(PUBLICATION_MAX_BYTES);
      const base = (await loadDocument(m, 'catalog')).revision;
      const loads: Array<[string, Answer]> = [
        ['import A', await importJson(m, range[A]!, { mode: 'merge' })],
        ['import B', await importJson(m, range[B]!, { mode: 'merge' })],
        ['pull C', await pull(m, range[C]!, { mode: 'merge' })],
      ];
      expect.soft(loads.map(([name, a]) => [name, a.status, a.body.revision, a.body.pieces]),
        `${host}: P86.CS1 — each load one revision, its pieces shared + parts (today the third is refused 413 document_too_large: ${loads.map(([n, a]) => `${n} ${show(a)}`).join(' | ').slice(0, 400)})`)
        .toEqual([['import A', 200, base + 1, MODULES.length + BULK], ['import B', 200, base + 2, MODULES.length + 2 * BULK], ['pull C', 200, base + 3, MODULES.length + 3 * BULK]]);
      const manifest = await loadDocument(m, 'catalog');
      const index = productsOf(manifest);
      expect.soft({ productSlots: manifest.document.productSlots ?? 'no productSlots', shared: sorted(sharedOf(manifest)),
        products: Object.fromEntries(Object.entries(index).map(([p, v]) => [p, [/^[0-9a-f]{64}$/.test(String(v.digest)), v.records]])) },
      `${host}: P86.CS1 — the manifest: productSlots, the shared pieces only, one pointer per product (today one document of every record)`).toEqual({
        productSlots: [CAROUSEL], shared: sorted(MODULE_IDS), products: { [A]: [true, BULK], [B]: [true, BULK], [C]: [true, BULK] } });
      const parts = [A, B, C].map(p => [p, partOf(m, manifest, p)] as const);
      expect.soft(parts.map(([p, part]) => [p, part.missing ?? 'stored', part.ids.length, part.value?.product ?? null,
        part.value ? Object.keys(part.value).sort() : null, part.bytes > 0 && part.bytes <= PUBLICATION_MAX_BYTES]),
      `${host}: P86.CS1 — each product's records one part { product, pieces } of at most 2 MiB at its pointer's address`).toEqual(
        [A, B, C].map(p => [p, 'stored', BULK, p, ['pieces', 'product'], true]));
      const addressed: Array<[string, boolean]> = [];
      for (const [p, part] of parts) addressed.push([p, part.value !== null && await documentDigest(part.value) === digestOf(manifest, p)]);
      expect.soft(addressed, `${host}: P86.CS1 — each part content-addressed: the digest of its value is its key's and the pointer's`).toEqual([[A, true], [B, true], [C, true]]);
      expect.soft(parts.map(([p, part]) => [p, part.ids]), `${host}: P86.CS1 — each part holds exactly its product's records`).toEqual(
        [A, B, C].map(p => [p, sorted(range[p]!.map(r => r.id))]));
      const manifestBytes = documentBytes(manifest.document);
      expect.soft([manifestBytes < PUBLICATION_MAX_BYTES, manifestBytes < Math.min(...parts.map(([, part]) => part.bytes || Infinity))],
        `${host}: P86.CS1 — the manifest (${manifestBytes} bytes) under the cap and smaller than any part`).toEqual([true, true]);
      const read = await asOperator(m, 'GET', `/content/catalog?scope=${TENANT}`);
      const envelope = (read.body.envelope ?? {}) as Record<string, unknown>;
      expect.soft([read.status, envelope.pieces, envelope.bytes, envelope.products ?? 'no products count'],
        `${host}: P86.CS1 — the envelope: the catalogue's pieces (shared + parts), the manifest's bytes, the index's size`).toEqual(
        [200, MODULES.length + 3 * BULK, manifestBytes, 3]);
      const reads: Array<[string, number, unknown, unknown, unknown, string[]]> = [];
      for (const p of [A, B, C]) { const a = await productRead(m, p); reads.push([p, a.status, a.body.product ?? null, a.body.digest ?? null, a.body.revision ?? null, readIds(a)]); }
      expect.soft(reads, `${host}: P86.CS1 — the per-product read answers each product's records at the revision in force (today the whole catalogue, no product)`).toEqual(
        [A, B, C].map(p => [p, 200, p, digestOf(manifest, p), manifest.revision, sorted(range[p]!.map(r => r.id))]));
    }, 300_000);

    it(`host (${host}): routing — on a PUT and on an import, a record whose slotTypes are all product slots and which names featuredProductIds goes to the part of its FIRST id ([${A}, ${BLACK}] to ${A}; [${BLACK}, ${A}] to ${BLACK}); a record naming no product, or with a slot that is not a product slot, stays shared; a product the catalogue does not carry is indexed as any other; an import warns variant_first for a record written variant-first and accepts it; a GET→PUT round trip of the manifest keeps every part`, async () => {
      const m = await mount(host, DOCS);
      expectPublished(m, 'P86.CS1 — the tenant documents publish');
      const reversed = image('img-ch857-black-r', [BLACK, A], 'Handbags', 'detail');
      const twoSlots = image('img-ch857-look', [A], 'Handbags', 'on-model', { slotTypes: [CAROUSEL, COMPLETE] });
      const [a1, a2, , a4] = ANCHOR_IMAGES as [Rec, Rec, Rec, Rec];
      await declareProductSlots(m, [...MODULES, a1, a2, reversed, twoSlots, ...OTHER_IMAGES]);
      const afterPut = await loadDocument(m, 'catalog');
      const merged = await importJson(m, [a4], { mode: 'merge' });
      expect(merged.status, `${host}: PRECONDITION — the merge of ${a4.id} is accepted (${show(merged)})`).toBe(200);
      const manifest = await loadDocument(m, 'catalog');
      expect.soft({ shared: sorted(sharedOf(manifest)), products: Object.keys(productsOf(manifest)).sort(),
        parts: Object.fromEntries([A, BLACK, B, UNKNOWN].map(p => [p, partOf(m, manifest, p).missing ?? partOf(m, manifest, p).ids])) },
      `${host}: P86.CS1 — routed by the first id; the rest shared (today every record in the one document, no index)`).toEqual({
        shared: sorted([...MODULE_IDS, twoSlots.id, 'img-brand-1']), products: sorted([A, BLACK, B, UNKNOWN]),
        parts: { [A]: sorted([a1.id, a2.id, a4.id]), [BLACK]: [reversed.id], [B]: ['img-cb925-1'], [UNKNOWN]: ['img-zz999-1'] } });
      expect.soft(digestOf(afterPut, A) !== digestOf(manifest, A) && digestOf(afterPut, B) === digestOf(manifest, B),
        `${host}: P86.CS1 — the merge touched ${A}'s part alone (a new part for it, ${B}'s pointer unchanged)`).toBe(true);
      // R-P407 (2): written variant-first, a record is routed to its first id as written and the import warns variant_first
      // (S9) — only where the first id extends the second as a variant form; never a refusal.
      const chalkFirst = image('img-ch857-chalk-r', [CHALK, A], 'Handbags', 'detail');
      const productFirst = image('img-ch857-black-5', [A, BLACK], 'Handbags', 'detail');
      const twoProducts = image('img-cb925-with-ch857', [B, A], 'Small Leather Goods', 'on-model');
      const warned = await importJson(m, [productFirst, chalkFirst, twoProducts], { mode: 'merge' });
      const afterWarn = await loadDocument(m, 'catalog');
      const warnings = (((warned.body.diagnostics as { warnings?: unknown } | undefined)?.warnings ?? []) as Array<Record<string, unknown>>)
        .filter(w => w.code === 'variant_first').map(w => [w.recordIndex, w.recordId]);
      expect.soft({ status: warned.status, warnings, parts: Object.fromEntries([A, CHALK, B].map(p => [p, partOf(m, afterWarn, p).missing ?? partOf(m, afterWarn, p).ids])) },
        `${host}: P86.CS1 — the variant-first record routed to its first id and warned; the product-first and the two-product records not warned (${show(warned)})`).toEqual({
        status: 200, warnings: [[1, chalkFirst.id]],
        parts: { [A]: sorted([a1.id, a2.id, a4.id, productFirst.id]), [CHALK]: [chalkFirst.id], [B]: sorted(['img-cb925-1', twoProducts.id]) } });
      // The merchandiser's round trip: the manifest as read, one module retitled, PUT back.
      const edited = { ...afterWarn.document, pieces: ((afterWarn.document.pieces ?? []) as Rec[]).map(p => p.id === M.editorial ? { ...p, title: 'A styling story, revised' } : p) };
      const put = await putDocument(m, 'catalog', edited, 'p86 round trip');
      const after = await loadDocument(m, 'catalog');
      expect.soft([put.status, after.revision, JSON.stringify(productsOf(after)) === JSON.stringify(productsOf(afterWarn)) && Object.keys(productsOf(after)).length === 5,
        ((after.document.pieces ?? []) as Rec[]).find(p => p.id === M.editorial)?.title ?? null],
      `${host}: P86.CS1 — the GET→PUT round trip is one revision and keeps every part's pointer (${show(put)})`).toEqual([200, afterWarn.revision + 1, true, 'A styling story, revised']);
    }, 120_000);

    it(`host (${host}): a record that would go to a part and declares pooled: true is refused 422 naming it by its record address and pooled; nothing written (no revision, no part)`, async () => {
      const m = await mount(host, DOCS);
      expectPublished(m, 'P86.CS1 — the tenant documents publish');
      await declareProductSlots(m);
      const before = await loadDocument(m, 'catalog'), stored = partKeys(m);
      const pooled = image('img-ch857-pooled', [A], 'Handbags', 'studio', { pooled: true });
      const refused = await importJson(m, [ANCHOR_IMAGES[0]!, pooled], { mode: 'merge' });
      const named = errorsOf(refused).some(e => e.includes(`records[1] '${pooled.id}'`) && e.includes('pooled'));
      expect.soft([refused.status, named ? 'names the record and pooled' : `does not (${show(refused)})`],
        `${host}: P86.CS1 — a pooled piece stays shared, so one routed to a part is refused (today it is written)`).toEqual([422, 'names the record and pooled']);
      expect.soft([(await loadDocument(m, 'catalog')).revision, partKeys(m)], `${host}: P86.CS1 — nothing written`).toEqual([before.revision, stored]);
    }, 120_000);

    it(`host (${host}): the modes per product — replace of ${B}'s records replaces ${B}'s part alone; full of ${C}'s records expires ${C}'s left-out record behind expire counted over ${C} alone (another number refused 409 naming 1); ${A} and the shared pieces untouched`, async () => {
      const m = await mount(host, DOCS);
      expectPublished(m, 'P86.CS1 — the tenant documents publish');
      await declareProductSlots(m);
      const loaded = await importJson(m, [...fourOf(A), ...fourOf(B), ...fourOf(C)], { mode: 'merge' });
      expect(loaded.status, `${host}: PRECONDITION — the three products load (${show(loaded)})`).toBe(200);
      const start = await loadDocument(m, 'catalog');
      const [b1, b2] = fourOf(B) as [Rec, Rec];
      const replaced = await importJson(m, [b1, { ...b2, title: `${b2.title}, reshot` }], { mode: 'replace' });
      const afterReplace = await loadDocument(m, 'catalog');
      expect.soft({ status: replaced.status, pieces: replaced.body.pieces, shared: sorted(sharedOf(afterReplace)), b: partOf(m, afterReplace, B).ids,
        bTitle: ((partOf(m, afterReplace, B).value?.pieces ?? []) as Rec[]).find(p => p.id === b2.id)?.title ?? null,
        untouched: [digestOf(afterReplace, A) === digestOf(start, A), digestOf(afterReplace, C) === digestOf(start, C)] },
      `${host}: P86.CS1 — replace names ${B} alone (today it replaces the whole catalogue: ${show(replaced)})`).toEqual({
        status: 200, pieces: MODULES.length + 4 + 2 + 4, shared: sorted(MODULE_IDS), b: sorted([b1.id, b2.id]), bTitle: `${b2.title}, reshot`, untouched: [true, true] });
      const c = fourOf(C);
      const wrong = await importJson(m, c.slice(0, 3), { mode: 'full', expire: '13' });
      expect.soft([wrong.status, wrong.body.expire ?? null], `${host}: P86.CS1 — full's guard counted over ${C} alone: 13 refused 409 naming 1 (${show(wrong)})`).toEqual([409, 1]);
      const full = await importJson(m, c.slice(0, 3), { mode: 'full', expire: '1' });
      const afterFull = await loadDocument(m, 'catalog');
      const cPieces = (partOf(m, afterFull, C).value?.pieces ?? []) as Array<{ id: string; lifecycle?: { status?: string } }>;
      expect.soft({ status: full.status, c: cPieces.map(p => [p.id, p.lifecycle?.status ?? 'live']), shared: sorted(sharedOf(afterFull)),
        untouched: [digestOf(afterFull, A) === digestOf(start, A), digestOf(afterFull, B) === digestOf(afterReplace, B)] },
      `${host}: P86.CS1 — full keeps ${C}'s left-out record expired; ${A}, ${B} and the shared pieces untouched (${show(full)})`).toEqual({
        status: 200, c: [[c[0]!.id, 'live'], [c[1]!.id, 'live'], [c[2]!.id, 'live'], [c[3]!.id, 'expired']], shared: sorted(MODULE_IDS), untouched: [true, true] });
      // R-P424: replace and full rebuild the index entries of the products they name.
      expect.soft([indexOf(m, afterReplace).ids, indexOf(m, afterFull).ids], `${host}: P86.CS1 — the id index follows each mode, every part record once`)
        .toEqual([partEntries(m, afterReplace), partEntries(m, afterFull)]);
    }, 120_000);

    it(`host (${host}): R-P416 (2) — the skip covers the shared pieces: on a parted catalogue a merge changing one shared piece alone (a module retitled) writes one revision, every product pointer unchanged and the new title stored; the same file again is skipped`, async () => {
      const m = await mount(host, DOCS);
      expectPublished(m, 'P86.CS1 — the tenant documents publish');
      await declareProductSlots(m);
      const loaded = await importJson(m, [...fourOf(A), ...fourOf(B), ...fourOf(C)], { mode: 'merge' });
      expect(loaded.status, `${host}: PRECONDITION — the three products load (${show(loaded)})`).toBe(200);
      const start = await loadDocument(m, 'catalog');
      expect(Object.keys(productsOf(start)).sort(), `${host}: PRECONDITION — the catalogue is parted (today it indexes nothing)`).toEqual(sorted([A, B, C]));
      const editorialModule = MODULES.find(p => p.id === M.editorial)!, retitled = [{ ...editorialModule, title: 'A styling story, retitled' }];
      const written = await importJson(m, retitled, { mode: 'merge' });
      const after = await loadDocument(m, 'catalog');
      const again = await importJson(m, retitled, { mode: 'merge' });
      const afterAgain = await loadDocument(m, 'catalog');
      expect.soft({ written: [written.status, written.body.skipped ?? 'no skipped member', after.revision], pointers: JSON.stringify(productsOf(after)) === JSON.stringify(productsOf(start)),
        title: ((after.document.pieces ?? []) as Rec[]).find(p => p.id === M.editorial)?.title ?? null,
        again: [again.status, again.body.skipped ?? 'no skipped member', afterAgain.revision] },
      `${host}: P86.CS1 — the shared change written once, then skipped (${show(written)})`).toEqual({
        written: [200, 'no skipped member', start.revision + 1], pointers: true, title: 'A styling story, retitled', again: [200, true, start.revision + 1] });
    }, 120_000);

    it(`host (${host}): R-P416 (3) — replace and full act on the shared pieces when the file carries one: a replace carrying one shared piece and ${B}'s records leaves exactly that shared piece and ${B}'s new part, ${A} and ${C} untouched; a full carrying a shared piece and ${C}'s records counts the left-out shared piece in expire and keeps it expired`, async () => {
      const m = await mount(host, DOCS);
      expectPublished(m, 'P86.CS1 — the tenant documents publish');
      await declareProductSlots(m);
      const loaded = await importJson(m, [...fourOf(A), ...fourOf(B), ...fourOf(C)], { mode: 'merge' });
      expect(loaded.status, `${host}: PRECONDITION — the three products load (${show(loaded)})`).toBe(200);
      const start = await loadDocument(m, 'catalog');
      expect(Object.keys(productsOf(start)).sort(), `${host}: PRECONDITION — the catalogue is parted (today it indexes nothing)`).toEqual(sorted([A, B, C]));
      const editorial = { ...MODULES.find(p => p.id === M.editorial)!, title: 'A styling story, replaced' }, grid = MODULES.find(p => p.id === M.grid)!;
      const [b1, b2] = fourOf(B) as [Rec, Rec];
      const replaced = await importJson(m, [editorial, b1, b2], { mode: 'replace' });
      const afterReplace = await loadDocument(m, 'catalog');
      expect.soft({ status: replaced.status, pieces: replaced.body.pieces, shared: sharedOf(afterReplace),
        title: ((afterReplace.document.pieces ?? []) as Rec[]).find(p => p.id === M.editorial)?.title ?? null, b: partOf(m, afterReplace, B).ids,
        untouched: [digestOf(afterReplace, A) === digestOf(start, A), digestOf(afterReplace, C) === digestOf(start, C)] },
      `${host}: P86.CS1 — the shared pieces replaced by the one the file carries, ${B} replaced, ${A} and ${C} untouched (${show(replaced)})`).toEqual({
        status: 200, pieces: 1 + 4 + 2 + 4, shared: [M.editorial], title: 'A styling story, replaced', b: sorted([b1.id, b2.id]), untouched: [true, true] });
      const c = fourOf(C);
      const wrong = await importJson(m, [grid, ...c.slice(0, 3)], { mode: 'full', expire: '1' });
      expect.soft([wrong.status, wrong.body.expire ?? null], `${host}: P86.CS1 — full counts the left-out shared piece with ${C}'s: 1 refused 409 naming 2 (${show(wrong)})`).toEqual([409, 2]);
      const full = await importJson(m, [grid, ...c.slice(0, 3)], { mode: 'full', expire: '2' });
      const afterFull = await loadDocument(m, 'catalog');
      const status = (pieces: unknown) => ((pieces ?? []) as Array<{ id: string; lifecycle?: { status?: string } }>).map(p => [p.id, p.lifecycle?.status ?? 'live']);
      expect.soft({ status: full.status, shared: status(afterFull.document.pieces), c: status(partOf(m, afterFull, C).value?.pieces),
        untouched: [digestOf(afterFull, A) === digestOf(start, A), digestOf(afterFull, B) === digestOf(afterReplace, B)] },
      `${host}: P86.CS1 — full keeps the left-out shared piece and ${C}'s left-out record expired (${show(full)})`).toEqual({
        status: 200, shared: [[M.grid, 'live'], [M.editorial, 'expired']], c: [[c[0]!.id, 'live'], [c[1]!.id, 'live'], [c[2]!.id, 'live'], [c[3]!.id, 'expired']],
        untouched: [true, true] });
    }, 120_000);

    it(`host (${host}): the skip and the dry run — an identical merge of ${A}'s records is skipped (the manifest digest unchanged); a one-field change to one record writes one revision, moving N, S and H, ${A}'s pointer alone; a dry run of a new product writes nothing, no part included`, async () => {
      const m = await mount(host, DOCS);
      expectPublished(m, 'P86.CS1 — the tenant documents publish');
      await declareProductSlots(m);
      const loaded = await importJson(m, [...fourOf(A), ...fourOf(B), ...fourOf(C)], { mode: 'merge' });
      expect(loaded.status, `${host}: PRECONDITION — the three products load (${show(loaded)})`).toBe(200);
      const start = await loadDocument(m, 'catalog'), parts = partKeys(m);
      const same = await importJson(m, fourOf(A), { mode: 'merge' });
      expect.soft([same.status, same.body.skipped ?? 'no skipped member', same.body.revision, Object.keys(productsOf(start)).sort()],
        `${host}: P86.CS1 — the identical load skipped at the revision in force (${show(same)})`).toEqual([200, true, start.revision, sorted([A, B, C])]);
      const { 'If-Match': ifMatch } = await preconditions(m);
      const dry = await importJson(m, fourOf(UNKNOWN), { mode: 'merge', dryRun: '1' }, { 'If-Match': ifMatch! });
      const afterDry = await loadDocument(m, 'catalog');
      expect.soft([dry.status, dry.body.dryRun ?? 'no dryRun member', dry.body.pieces, afterDry.revision, partKeys(m), Object.keys(productsOf(afterDry)).sort()],
        `${host}: P86.CS1 — the dry run answers the assembled count and writes nothing (${show(dry)})`).toEqual(
        [200, true, MODULES.length + 16, start.revision, parts, sorted([A, B, C])]);
      const [a1] = fourOf(A) as [Rec];
      const edited = await importJson(m, [{ ...a1, title: `${a1.title}, retouched` }], { mode: 'merge' });
      const after = await loadDocument(m, 'catalog');
      expect.soft({ status: edited.status, N: after.revision, S: after.publication.revision, H: after.publication.digest !== start.publication.digest,
        pointers: [digestOf(after, A) !== digestOf(start, A), digestOf(after, B) === digestOf(start, B), digestOf(after, C) === digestOf(start, C)] },
      `${host}: P86.CS1 — a change inside a part is a change of the catalogue (${show(edited)})`).toEqual({
        status: 200, N: start.revision + 1, S: start.publication.revision + 1, H: true, pointers: [true, true, true] });
    }, 120_000);

    it(`host (${host}): one If-Match and one rollback for the whole catalogue — a load over a stale base is refused 409 whatever product it names; a rollback to the revision after ${A}'s load is one revision whose manifest indexes ${A} alone at its pointer then, ${B} read 404 naming it`, async () => {
      const m = await mount(host, DOCS);
      expectPublished(m, 'P86.CS1 — the tenant documents publish');
      await declareProductSlots(m);
      expect((await importJson(m, fourOf(A), { mode: 'merge' })).status, `${host}: PRECONDITION — ${A} loads`).toBe(200);
      const afterA = await loadDocument(m, 'catalog'), stale = await preconditions(m);
      expect((await importJson(m, fourOf(B), { mode: 'merge' })).status, `${host}: PRECONDITION — ${B} loads`).toBe(200);
      expect((await importJson(m, fourOf(C), { mode: 'merge' })).status, `${host}: PRECONDITION — ${C} loads`).toBe(200);
      const head = await loadDocument(m, 'catalog');
      const refused = await importJson(m, fourOf(UNKNOWN), { mode: 'merge' }, stale);
      expect.soft(refused.status, `${host}: P86.CS1 — a stale base refused for a product no later load touched (${show(refused)})`).toBe(409);
      const back = await asOperator(m, 'POST', `/content/catalog/rollback/${afterA.revision}?scope=${TENANT}`, {}, await preconditions(m));
      const after = await loadDocument(m, 'catalog');
      const b = await productRead(m, B), a = await productRead(m, A);
      expect.soft({ status: back.status, revision: after.revision, products: Object.keys(productsOf(after)), a: digestOf(after, A) === digestOf(afterA, A) && /^[0-9a-f]{64}$/.test(digestOf(after, A)),
        aRead: [a.status, readIds(a)], bRead: [b.status, errorsOf(b).some(e => e.includes(B)) ? `names ${B}` : `does not (${show(b)})`] },
      `${host}: P86.CS1 — the rollback writes ${A}'s manifest forward (today no index: ${show(back)})`).toEqual({
        status: 200, revision: head.revision + 1, products: [A], a: true, aRead: [200, sorted(fourOf(A).map(r => r.id))], bRead: [404, `names ${B}`] });
    }, 120_000);

    it(`host (${host}): a part is written before the pending head — a load whose part cannot be written answers 503 and leaves the catalogue in force and nothing pending, so the next load is accepted`, async () => {
      const m = await mount(host, DOCS);
      expectPublished(m, 'P86.CS1 — the tenant documents publish');
      await declareProductSlots(m);
      expect((await importJson(m, fourOf(A), { mode: 'merge' })).status, `${host}: PRECONDITION — ${A} loads`).toBe(200);
      const before = await loadDocument(m, 'catalog');
      const bucket = m.storage as unknown as Record<string, unknown>, original = UnitR2.prototype.put;
      Object.defineProperty(bucket, 'put', { configurable: true, writable: true, value: async (key: string, raw: string, options?: R2PutOptions) => {
        if (PART.test(key)) throw new Error('P86 fixture: the part write fails');
        return original.call(m.storage, key, raw, options);
      } });
      let failed: Answer;
      try { failed = await importJson(m, fourOf(B), { mode: 'merge' }); } finally { Reflect.deleteProperty(bucket, 'put'); }
      const unchanged = await loadDocument(m, 'catalog');
      expect.soft([failed.status, unchanged.revision, unchanged.publication, Object.keys(productsOf(unchanged))],
        `${host}: P86.CS1 — nothing committed (today no part is written and the load commits: ${show(failed)})`).toEqual([503, before.revision, before.publication, [A]]);
      const retried = await importJson(m, fourOf(B), { mode: 'merge' });
      const after = await loadDocument(m, 'catalog');
      expect.soft([retried.status, Object.keys(productsOf(after)).sort(), partOf(m, after, B).missing ?? 'stored'],
        `${host}: P86.CS1 — nothing left pending: the next load is accepted and writes ${B}'s part (${show(retried)})`).toEqual([200, sorted([A, B]), 'stored']);
    }, 120_000);

    it(`host (${host}): retention (R-P407 (9)) — under a configuration retention setting, the purge that removes a revision removes the parts no kept revision references and keeps every part a kept revision references, the previous revision's own included (R-P416 (1): a rollback to it is accepted)`, async () => {
      const m = await mount(host, DOCS);
      expectPublished(m, 'P86.CS1 — the tenant documents publish');
      // The tenant's configuration-revision setting (W38 B4), at its smallest admitted duration: every revision older than
      // the current and the previous one, superseded before this publication, is purged when nothing names it.
      const retention = JSON.parse(String(m.env.RETENTION)) as { version: number; tenants: Record<string, Record<string, unknown>> };
      retention.tenants[TENANT]!.configuration = { id: 'p86-configuration-revisions', revision: 1, durationMs: 1, basis: 'occurred', renewal: 'new-record-only' };
      m.env.RETENTION = JSON.stringify(retention);
      // R-P424: every object the bucket holds reports an upload long past the purge's 15-minute grace.
      const restore = uploadedAt(m, () => new Date(0));
      await declareProductSlots(m);
      const [a1] = fourOf(A) as [Rec];
      const pointers: Array<Record<string, string>> = [], indexes: string[][] = [];
      // R-P416 (1): the last load retouches A again, so the previous kept revision alone names A's second part.
      for (const records of [fourOf(A), [{ ...a1, title: `${a1.title}, retouched` }], fourOf(B), [{ ...a1, title: `${a1.title}, retouched again` }]]) {
        const loaded = await importJson(m, records, { mode: 'merge' });
        expect(loaded.status, `${host}: PRECONDITION — the load is accepted (${show(loaded)})`).toBe(200);
        const d = await loadDocument(m, 'catalog');
        pointers.push(Object.fromEntries(Object.entries(productsOf(d)).map(([p, v]) => [p, String(v.digest)])));
        indexes.push(idShardKeysOf(d)); // P93 R10: the id shards this revision names (P86: its one id index object)
        await new Promise(resolve => setTimeout(resolve, 5));
      }
      const head = await loadDocument(m, 'catalog');
      const purged = await asOperator(m, 'GET', `/content/catalog/revisions/${head.revision - 3}?scope=${TENANT}`);
      expect(purged.status, `${host}: PRECONDITION — the revision of ${A}'s first load was purged under the setting (${show(purged)})`).toBe(410);
      // R-P424, P93 R10: the id shards are purged with the parts: those the kept revisions reference stay, the others go.
      expect.soft(idsKeys(m), `${host}: P86.CS1 — the id shards are exactly those a kept revision references`)
        .toEqual(sorted([...new Set([...indexes[2]!, ...indexes[3]!])]));
      // Kept: the current and the previous revision. The current names A's third part and B's; the previous alone names
      // A's second part (the first retouch), which a purge consulting only the current manifest would remove.
      const kept = sorted([...new Set([...Object.values(pointers[3] ?? {}), ...Object.values(pointers[2] ?? {})])].map(partKey));
      const previousA = partKey(pointers[2]?.[A] ?? 'no pointer'), currentA = partKey(pointers[3]?.[A] ?? 'no pointer');
      const read = await productRead(m, A);
      expect.soft({ parts: partKeys(m), firstA: m.storage.objects.has(partKey(pointers[0]?.[A] ?? 'no pointer')),
        previousA: [previousA !== currentA, m.storage.objects.has(previousA)], read: [read.status, readIds(read)] },
        `${host}: P86.CS1 — the parts are exactly those a kept revision references, the previous revision's part of ${A} kept (today no part is written)`).toEqual({
        parts: kept.length === 3 ? kept : ['three referenced parts expected', ...kept], firstA: false, previousA: [true, true], read: [200, sorted(fourOf(A).map(r => r.id))] });
      const back = await asOperator(m, 'POST', `/content/catalog/rollback/${head.revision - 1}?scope=${TENANT}`, {}, await preconditions(m));
      const after = await loadDocument(m, 'catalog');
      expect.soft([back.status, after.revision, digestOf(after, A) === pointers[2]?.[A], digestOf(after, B) === pointers[2]?.[B]],
        `${host}: P86.CS1 — a rollback to the previous kept revision is accepted, its parts all held (${show(back)})`).toEqual([200, head.revision + 1, true, true]);
      restore();
    }, 120_000);

    // P93 R10 (R-P487 (5), R-P490 (1), overturning R-P409 (2)): a product leaves the sharded catalogue only by an explicit
    // `removeProducts` list on the PUT, beside the index as read (before: a PUT leaving the product's pointer out of `products`).
    it(`host (${host}): R-P409 (2) as amended by R-P487 (5) — a PUT of the manifest as read naming a product in removeProducts removes that product: one revision, the others' pointers kept`, async () => {
      const m = await mount(host, DOCS);
      expectPublished(m, 'P86.CS1 — the tenant documents publish');
      await declareProductSlots(m);
      const loaded = await importJson(m, [...fourOf(A), ...fourOf(B)], { mode: 'merge' });
      expect(loaded.status, `${host}: PRECONDITION — ${A} and ${B} load (${show(loaded)})`).toBe(200);
      const before = await loadDocument(m, 'catalog');
      const put = await putDocument(m, 'catalog', { ...before.document, removeProducts: [B] }, 'p86 drop a product');
      const after = await loadDocument(m, 'catalog');
      const b = await productRead(m, B), a = await productRead(m, A);
      expect.soft({ status: put.status, revision: after.revision, products: Object.keys(productsOf(after)), a: [digestOf(after, A) === digestOf(before, A) && /^[0-9a-f]{64}$/.test(digestOf(after, A)), a.status, readIds(a)],
        b: [b.status, errorsOf(b).some(e => e.includes(B)) ? `names ${B}` : `does not (${show(b)})`] },
      `${host}: P86.CS1 — ${B} removed, ${A} kept (${show(put)})`).toEqual({
        status: 200, revision: before.revision + 1, products: [A], a: [true, 200, sorted(fourOf(A).map(r => r.id))], b: [404, `names ${B}`] });
    }, 120_000);

    it(`host (${host}): R-P409 (3) — a rollback to a kept manifest whose parts are missing from the store is refused 410 naming every product whose part is missing, nothing written; with the parts back it is accepted`, async () => {
      const m = await mount(host, DOCS);
      expectPublished(m, 'P86.CS1 — the tenant documents publish');
      await declareProductSlots(m);
      expect((await importJson(m, [...fourOf(A), ...fourOf(B), ...fourOf(C)], { mode: 'merge' })).status, `${host}: PRECONDITION — three products load`).toBe(200);
      const kept = await loadDocument(m, 'catalog');
      const [a1] = fourOf(A) as [Rec], [b1] = fourOf(B) as [Rec];
      expect((await importJson(m, [{ ...a1, title: `${a1.title}, v2` }, { ...b1, title: `${b1.title}, v2` }], { mode: 'merge' })).status,
        `${host}: PRECONDITION — ${A} and ${B} change`).toBe(200);
      const head = await loadDocument(m, 'catalog');
      // A store fault outside the purge: the kept revision's parts of A and B are lost.
      const lost = [A, B].map(p => [partKey(digestOf(kept, p)), m.storage.objects.get(partKey(digestOf(kept, p)))] as const);
      expect(lost.every(([, raw]) => raw !== undefined), `${host}: PRECONDITION — the kept revision's parts of ${A} and ${B} are stored (today there are none)`).toBe(true);
      for (const [key] of lost) m.storage.objects.delete(key);
      const refused = await asOperator(m, 'POST', `/content/catalog/rollback/${kept.revision}?scope=${TENANT}`, {}, await preconditions(m));
      const names = (a: Answer) => [A, B, C].filter(p => errorsOf(a).some(e => e.includes(p)));
      expect.soft([refused.status, names(refused), (await loadDocument(m, 'catalog')).revision],
        `${host}: P86.CS1 — refused 410 naming ${A} and ${B}, not ${C}; nothing written (${show(refused)})`).toEqual([410, [A, B], head.revision]);
      for (const [key, raw] of lost) await m.storage.put(key, raw!);
      const back = await asOperator(m, 'POST', `/content/catalog/rollback/${kept.revision}?scope=${TENANT}`, {}, await preconditions(m));
      const after = await loadDocument(m, 'catalog');
      expect.soft([back.status, after.revision, [A, B, C].map(p => digestOf(after, p) === digestOf(kept, p))],
        `${host}: P86.CS1 — with the parts back the rollback writes the kept manifest forward (${show(back)})`).toEqual([200, head.revision + 1, [true, true, true]]);
    }, 120_000);

    // P93 R10 (R-P487 (2)): the id index is sharded — content-addressed id shards named by the manifest's `index.ids`
    // (before: one `content/ids/` object per revision named by `idIndex`).
    it(`host (${host}): R-P424 as sharded by R-P487 (2) — the id index: content-addressed id shards, written before the pending head (a failing id shard write answers 503, nothing committed and nothing pending, the next load accepted), named by the manifest's index, holding every part record's id → product; a rollback names the old revision's id shards`, async () => {
      const m = await mount(host, DOCS);
      expectPublished(m, 'P86.CS1 — the tenant documents publish');
      await declareProductSlots(m);
      const declared = await loadDocument(m, 'catalog');
      expect.soft([Object.keys(indexPointerOf(declared) ?? {}).length, idsKeys(m)], `${host}: P86.CS1 — no part, no index`).toEqual([0, []]);
      expect((await importJson(m, [...fourOf(A), ...fourOf(B)], { mode: 'merge' })).status, `${host}: PRECONDITION — ${A} and ${B} load`).toBe(200);
      const first = await loadDocument(m, 'catalog'), index = indexOf(m, first);
      const pointers = Object.values(indexPointerOf(first) ?? {}) as Array<{ digest?: unknown; records?: unknown }>, addressed: boolean[] = [];
      for (const pointer of pointers) { const raw = m.storage.objects.get(idsKey(String(pointer.digest))); addressed.push(raw !== undefined && await documentDigest(JSON.parse(raw)) === pointer.digest); }
      expect.soft({ pointer: [pointers.length > 0 && pointers.every(p => /^[0-9a-f]{64}$/.test(String(p.digest))), pointers.reduce((n, p) => n + Number(p.records), 0)], stored: idsKeys(m),
        addressed: addressed.length > 0 && addressed.every(Boolean), ids: index.ids }, `${host}: P86.CS1 — the manifest names its id shards, each at its content address, together holding every part record (today none)`).toEqual({
        pointer: [true, 8], stored: idShardKeysOf(first), addressed: true, ids: Object.fromEntries([...fourOf(A).map(r => [r.id, A]), ...fourOf(B).map(r => [r.id, B])].sort()) });
      // The index written before the pending head, as a part is: its write failing commits nothing and leaves nothing pending.
      const bucket = m.storage as unknown as Record<string, unknown>, put = UnitR2.prototype.put;
      Object.defineProperty(bucket, 'put', { configurable: true, writable: true, value: async (key: string, raw: string, options?: R2PutOptions) => {
        if (IDS.test(key)) throw new Error('P86 fixture: the id shard write fails');
        return put.call(m.storage, key, raw, options);
      } });
      let failed: Answer;
      try { failed = await importJson(m, fourOf(C), { mode: 'merge' }); } finally { Reflect.deleteProperty(bucket, 'put'); }
      const unchanged = await loadDocument(m, 'catalog');
      expect.soft([failed.status, unchanged.revision, unchanged.publication, Object.keys(productsOf(unchanged)).sort(), indexOf(m, unchanged).digest],
        `${host}: P86.CS1 — nothing committed (${show(failed)})`).toEqual([503, first.revision, first.publication, sorted([A, B]), index.digest]);
      const retried = await importJson(m, fourOf(C), { mode: 'merge' });
      const second = await loadDocument(m, 'catalog');
      expect.soft([retried.status, indexOf(m, second).ids], `${host}: P86.CS1 — nothing pending: the next load is accepted and indexes ${C} (${show(retried)})`)
        .toEqual([200, partEntries(m, second)]);
      const back = await asOperator(m, 'POST', `/content/catalog/rollback/${first.revision}?scope=${TENANT}`, {}, await preconditions(m));
      const rolled = await loadDocument(m, 'catalog');
      expect.soft([back.status, indexOf(m, rolled).digest === index.digest, Object.keys(productsOf(rolled)).sort()],
        `${host}: P86.CS1 — the rollback references the old revision's index (${show(back)})`).toEqual([200, true, sorted([A, B])]);
    }, 120_000);

    it(`host (${host}): R-P424, R-P412 (3) — a record re-pointed to another product is refused 422 record_moved naming both products on a merge naming only the new product and on a PUT carrying the old pointer, nothing written; a file carrying both products moves it: the old part drops it, the new part holds it, the index moved`, async () => {
      const m = await mount(host, DOCS);
      expectPublished(m, 'P86.CS1 — the tenant documents publish');
      await declareProductSlots(m);
      expect((await importJson(m, [...fourOf(A), ...fourOf(B)], { mode: 'merge' })).status, `${host}: PRECONDITION — ${A} and ${B} load`).toBe(200);
      const start = await loadDocument(m, 'catalog');
      expect(Object.keys(productsOf(start)).sort(), `${host}: PRECONDITION — the catalogue is parted (today it indexes nothing)`).toEqual(sorted([A, B]));
      const [a1, a2] = fourOf(A) as [Rec, Rec], moved = { ...a1, featuredProductIds: [B] };
      const before = { parts: partKeys(m), ids: idsKeys(m) };
      const merged = await importJson(m, [moved], { mode: 'merge' });
      const put = await putDocument(m, 'catalog', { ...start.document, pieces: [...((start.document.pieces ?? []) as Rec[]), moved] }, 'p86 move by put');
      const refusedAfter = await loadDocument(m, 'catalog');
      expect.soft({ merge: [merged.status, errorsWith(merged, 'record_moved', A, B)], put: [put.status, errorsWith(put, 'record_moved', A, B)],
        written: [refusedAfter.revision, refusedAfter.publication.digest === start.publication.digest, partKeys(m), idsKeys(m)] },
      `${host}: P86.CS1 — the move refused on a merge and on a PUT, nothing written (today both accepted: ${show(merged)})`).toEqual({
        merge: [422, `names record_moved, ${A}, ${B}`], put: [422, `names record_moved, ${A}, ${B}`], written: [start.revision, true, before.parts, before.ids] });
      const both = await importJson(m, [{ ...a2, title: `${a2.title}, reshot` }, moved], { mode: 'merge' });
      const after = await loadDocument(m, 'catalog');
      expect.soft({ status: both.status, a: partOf(m, after, A).ids, b: partOf(m, after, B).ids, entry: indexOf(m, after).ids?.[a1.id] ?? null, index: indexOf(m, after).ids },
        `${host}: P86.CS1 — a file carrying both products moves the record (${show(both)})`).toEqual({
        status: 200, a: sorted(fourOf(A).slice(1).map(r => r.id)), b: sorted([...fourOf(B).map(r => r.id), a1.id]), entry: B, index: partEntries(m, after) });
    }, 120_000);

    it(`host (${host}): R-P424 — ids stay unique across the shared pieces and every part, untouched ones included: a shared piece whose id the index lists in a part is refused 422 id_in_part naming the id and the product; a part record whose id a shared piece holds is refused 422 id_shared naming the id and the product; nothing written`, async () => {
      const m = await mount(host, DOCS);
      expectPublished(m, 'P86.CS1 — the tenant documents publish');
      await declareProductSlots(m);
      expect((await importJson(m, [...fourOf(A), ...fourOf(B), ...fourOf(C)], { mode: 'merge' })).status, `${host}: PRECONDITION — three products load`).toBe(200);
      const start = await loadDocument(m, 'catalog');
      expect(Object.keys(productsOf(start)).sort(), `${host}: PRECONDITION — the catalogue is parted (today it indexes nothing)`).toEqual(sorted([A, B, C]));
      const b2 = (fourOf(B) as [Rec, Rec])[1];
      // A shared piece (a module of the layout slot) reusing B's record id; the file touches no part.
      const sharedReuse = { ...MODULES.find(p => p.id === M.editorial)!, id: b2.id, customerContentId: 'TAP-P86-REUSE' };
      // A part record of C reusing a module's id.
      const partReuse = image(M.editorial, [C], 'Handbags', 'studio');
      const inPart = await importJson(m, [sharedReuse], { mode: 'merge' });
      const shared = await importJson(m, [partReuse], { mode: 'merge' });
      const after = await loadDocument(m, 'catalog');
      expect.soft({ inPart: [inPart.status, errorsWith(inPart, 'id_in_part', b2.id, B)], shared: [shared.status, errorsWith(shared, 'id_shared', M.editorial, C)],
        written: [after.revision, after.publication.digest === start.publication.digest, indexOf(m, after).digest === indexOf(m, start).digest] },
      `${host}: P86.CS1 — each collision refused by name, nothing written (today both accepted: ${show(inPart)})`).toEqual({
        inPart: [422, `names id_in_part, ${b2.id}, ${B}`], shared: [422, `names id_shared, ${M.editorial}, ${C}`], written: [start.revision, true, true] });
    }, 120_000);

    // P93 R10 (R-P487 (2), (8)): the index objects of the grace are the id shards (before: the one `content/ids/` object).
    it(`host (${host}): R-P424 — the purge's grace: a part or index object uploaded less than 15 minutes ago is never deleted, though the revision naming it is purged`, async () => {
      const m = await mount(host, DOCS);
      expectPublished(m, 'P86.CS1 — the tenant documents publish');
      const retention = JSON.parse(String(m.env.RETENTION)) as { version: number; tenants: Record<string, Record<string, unknown>> };
      retention.tenants[TENANT]!.configuration = { id: 'p86-configuration-revisions', revision: 1, durationMs: 1, basis: 'occurred', renewal: 'new-record-only' };
      m.env.RETENTION = JSON.stringify(retention);
      const restore = uploadedAt(m, () => new Date());
      await declareProductSlots(m);
      const [a1] = fourOf(A) as [Rec];
      const firsts: Array<[string, string[]]> = [];
      for (const records of [fourOf(A), [{ ...a1, title: `${a1.title}, retouched` }], fourOf(B), [{ ...a1, title: `${a1.title}, retouched again` }]]) {
        const loaded = await importJson(m, records, { mode: 'merge' });
        expect(loaded.status, `${host}: PRECONDITION — the load is accepted (${show(loaded)})`).toBe(200);
        const d = await loadDocument(m, 'catalog');
        firsts.push([partKey(digestOf(d, A)), idShardKeysOf(d)]);
        await new Promise(resolve => setTimeout(resolve, 5));
      }
      const head = await loadDocument(m, 'catalog');
      const purged = await asOperator(m, 'GET', `/content/catalog/revisions/${head.revision - 3}?scope=${TENANT}`);
      expect(purged.status, `${host}: PRECONDITION — the revision of ${A}'s first load was purged under the setting (${show(purged)})`).toBe(410);
      expect.soft([m.storage.objects.has(firsts[0]![0]), firsts[0]![1].length > 0 && firsts[0]![1].every(key => m.storage.objects.has(key))],
        `${host}: P86.CS1 — the first load's part and index, uploaded moments ago, survive the purge of the revision naming them`).toEqual([true, true]);
      restore();
    }, 120_000);

    // P93 R10 (R-P487 (1), (2)): the id index's cap is per id shard, 2 MiB, refused naming the shard (before: one 8 MiB
    // object); the long record ids are chosen in one shard so the shard grows by about one load's bytes per load.
    it(`host (${host}): R-P424 as sharded by R-P487 (2) — the id shard's own cap: a load whose id shard would pass 2 MiB is refused 413 id_index_too_large naming the shard, nothing written; every load before it accepted`, async () => {
      const m = await mount(host, DOCS);
      expectPublished(m, 'P86.CS1 — the tenant documents publish');
      await declareProductSlots(m);
      const ID_LENGTH = 4000, INDEX_CAP = 2 * 1024 * 1024, perLoad = 300, shard = await bucketOfId('cap-0-'.padEnd(ID_LENGTH, 'x')), sameShard: string[] = [];
      for (let k = 0; sameShard.length < 3 * perLoad; k++) { const id = `cap-${k}-`.padEnd(ID_LENGTH, 'x'); if (await bucketOfId(id) === shard) sameShard.push(id); }
      const loadOf = (k: number) => sameShard.slice((k - 1) * perLoad, k * perLoad).map((id, i) => ({ id, customerContentId: `TAP-CAP-${k}-${i}`,
        type: 'on-model', title: 't', tags: {}, slotTypes: [CAROUSEL], lifecycle: { status: 'live' }, featuredProductIds: [`COA-IDX${k}`] }));
      expect([perLoad <= INPUT_MAX_RECORDS, new TextEncoder().encode(JSON.stringify(loadOf(1))).byteLength < INPUT_MAX_BYTES],
        `PRECONDITION: ${perLoad} records per load within the import's caps`).toEqual([true, true]);
      let accepted = 0, refused: Answer | null = null, before = await loadDocument(m, 'catalog'), parts = partKeys(m), ids = idsKeys(m);
      for (let k = 1; k <= 3 && !refused; k++) {
        const answer = await importJson(m, loadOf(k), { mode: 'merge' });
        if (answer.status === 200) { accepted++; before = await loadDocument(m, 'catalog'); parts = partKeys(m); ids = idsKeys(m); } else refused = answer;
      }
      const acceptedBytes = accepted * perLoad * ID_LENGTH;
      const shardNamed = (a: Answer) => errorsOf(a).some(e => new RegExp(`(^|[^0-9a-z])${shard}([^0-9a-z]|$)`).test(e)) ? `names ${shard}` : `does not (${show(a)})`;
      expect.soft({ refused: refused ? [refused.status, refused.body.code ?? errorsOf(refused).join(' ').slice(0, 60), shardNamed(refused)] : 'no load refused',
        accepted: acceptedBytes > INDEX_CAP - perLoad * ID_LENGTH && acceptedBytes <= INDEX_CAP ? 'up to the cap' : `${accepted} loads (${acceptedBytes} bytes of ids)`,
        written: [(await loadDocument(m, 'catalog')).revision === before.revision, partKeys(m).length === parts.length, idsKeys(m).length === ids.length] },
      `${host}: P86.CS1 — refused by name at the id shard's 2 MiB, nothing written`).toEqual({ refused: [413, 'id_index_too_large', `names ${shard}`], accepted: 'up to the cap', written: [true, true, true] });
    }, 600_000);

    // P93 R10 (R-P487 (1)): the products ride the shards, so the manifest's 2 MiB is reached by the shared pieces alone
    // (before: the second load of 60% of the cap refused manifest_too_large for its product index).
    it(`host (${host}): the cap as sharded by R-P487 (1) — the products no longer count toward the manifest's 2 MiB: two loads of 60% of P86's one-level cap each index their products and the manifest stays small; a load whose shared pieces would pass 2 MiB is refused 413 manifest_too_large, nothing written (no revision, no part)`, async () => {
      const m = await mount(host, DOCS);
      expectPublished(m, 'P86.CS1 — the tenant documents publish');
      await declareProductSlots(m);
      // 64-character product ids (the anchor's own bound); the per-load count from P86's one-level pointer's size (S1).
      const productOf = (k: number) => `COA-CAP-${String(k).padStart(8, '0')}-`.padEnd(64, 'X');
      const entry = documentBytes({ [productOf(1)]: { digest: 'f'.repeat(64), records: 1 } }) - 1;
      const perLoad = Math.ceil(0.6 * PUBLICATION_MAX_BYTES / entry);
      const recordsFrom = (from: number) => Array.from({ length: perLoad }, (_, i) => ({ id: `c${String(from + i).padStart(8, '0')}`, type: 'on-model', title: 't',
        slotTypes: [CAROUSEL], featuredProductIds: [productOf(from + i)] }));
      const first = recordsFrom(1), second = recordsFrom(1 + perLoad);
      expect([perLoad <= INPUT_MAX_RECORDS, new TextEncoder().encode(JSON.stringify(first)).byteLength < INPUT_MAX_BYTES],
        `PRECONDITION: ${perLoad} records per load within the import's caps`).toEqual([true, true]);
      const one = await importJson(m, first, { mode: 'merge' });
      const afterOne = await loadDocument(m, 'catalog');
      expect.soft([one.status, Object.keys(productsOf(afterOne)).length, partKeys(m).length],
        `${host}: P86.CS1 — the first load indexes its ${perLoad} products (${show(one)})`).toEqual([200, perLoad, perLoad]);
      const two = await importJson(m, second, { mode: 'merge' });
      const afterTwo = await loadDocument(m, 'catalog');
      expect.soft([two.status, Object.keys(productsOf(afterTwo)).length, documentBytes(afterTwo.document) <= 65536 + documentBytes(afterTwo.document.pieces)],
        `${host}: P86.CS1 — the second load indexes its products too, the manifest bounded beside its shared pieces (today: ${show(two)})`).toEqual([200, 2 * perLoad, true]);
      // The shared pieces alone: one piece's stored bytes measured, then two loads of 60% of the cap each.
      const sharedFrom = (from: number, count: number) => Array.from({ length: count }, (_, i) => ({ id: `s${String(from + i).padStart(8, '0')}`, type: 'flat-lay',
        title: 'A shared piece'.padEnd(100, '.'), slotTypes: [CAROUSEL] }));
      expect((await importJson(m, sharedFrom(0, 1), { mode: 'merge' })).status, `${host}: PRECONDITION — one shared piece loads`).toBe(200);
      const afterProbe = await loadDocument(m, 'catalog'), per = documentBytes(afterProbe.document.pieces) - documentBytes(afterTwo.document.pieces);
      const count = Math.ceil(0.6 * PUBLICATION_MAX_BYTES / per);
      expect([count <= INPUT_MAX_RECORDS, new TextEncoder().encode(JSON.stringify(sharedFrom(1, count))).byteLength < INPUT_MAX_BYTES],
        `PRECONDITION: ${count} shared pieces per load within the import's caps`).toEqual([true, true]);
      expect((await importJson(m, sharedFrom(1, count), { mode: 'merge' })).status, `${host}: PRECONDITION — the first shared load is accepted`).toBe(200);
      const afterThree = await loadDocument(m, 'catalog'), parts = partKeys(m);
      const four = await importJson(m, sharedFrom(1 + count, count), { mode: 'merge' });
      expect.soft([four.status, four.body.code ?? null, (await loadDocument(m, 'catalog')).revision, partKeys(m).length],
        `${host}: P86.CS1 — the shared pieces past the manifest's 2 MiB refused by name, nothing written (${show(four)})`).toEqual([413, 'manifest_too_large', afterThree.revision, parts.length]);
    }, 600_000);

    it(`host (${host}): LOCK — a catalogue that declares no product slots is today's document: its images shared, no index, no part object; the anchor's page reads no part; a load over the import's caps refused 413 as today`, async () => {
      const m = await mount(host, { ...DOCS, pieces: [...MODULES, ...ANCHOR_IMAGES, ...OTHER_IMAGES] });
      expectPublished(m, 'P86.CS1 — the tenant documents publish');
      const merged = await importJson(m, [image('img-ch857-5', [A], 'Handbags', 'studio')], { mode: 'merge' });
      const d = await loadDocument(m, 'catalog');
      expect.soft([merged.status, Object.keys(d.document).sort(), sharedOf(d).includes('img-ch857-5'), partKeys(m), idsKeys(m)],
        `${host}: P86.CS1 — today's document, no part and no id index (${show(merged)})`).toEqual([200, ['pieces', 'version'], true, [], []]);
      const s = await shopperOn(m);
      invalidatePublicationCache();
      const page = await counted(m, () => snapshotOf(m, s, 'pdp', { anchor: A, variant: BLACK }, 'p86-lock'));
      expect.soft([page.result.status, carousel(page.result), partReads(page.reads).length], `${host}: P86.CS1 — P80's carousel with the merged image, no part read`).toEqual(
        [200, sorted([...SERVED_FOR_BLACK, 'img-ch857-5']), 0]);
      const over = await importJson(m, Array.from({ length: INPUT_MAX_RECORDS + 1 }, (_, i) => ({ id: `x${i}` })), { mode: 'merge' });
      expect.soft([over.status, over.body.code ?? null, (await loadDocument(m, 'catalog')).revision], `${host}: P86.CS1 — over the caps as today (${show(over)})`).toEqual(
        [413, 'input_budget_exceeded', d.revision]);
    }, 120_000);
  }
});

// ===========================================================================
// unit:P86.CS2 — a product page's decision reads the manifest and one part; its work does not grow with the range
// ===========================================================================

/** One product page measured (S8): the operator's per-product read cold, then the decision for the anchor and its Black
 * variant cold, then the same page warm. */
async function measured(m: Mounted) {
  const s = await shopperOn(m);
  const manifest = await loadDocument(m, 'catalog');
  invalidatePublicationCache();
  const operator = await counted(m, () => productRead(m, A));
  invalidatePublicationCache();
  const cold = await counted(m, () => snapshotOf(m, s, 'pdp', { anchor: A, variant: BLACK }, 'p86-cs2-cold'));
  const warm = await counted(m, () => snapshotOf(m, s, 'pdp', { anchor: A, variant: BLACK }, 'p86-cs2-warm'));
  return { cold, warm, operator, manifest };
}

// ---------------------------------------------------------------------------
// R-P409 (1): P85's carousel beacon on a parted tenant. P85 (E9) is not in this specification's tree (cut from 20fab871):
// each of these legs first asserts P85's beacon as PRECONDITION P85, and is measured behind it on a scratch copy of the
// P85 join (R-P6). P85's shapes: the action `carousel_exposure` with data { tableVersion, context, page, slot, images,
// pageInstance, arm } answered { exposure: 'admitted', images } or { exposure: 'ignored', reason }; `listen.carouselExposure`.
// ---------------------------------------------------------------------------

/** P84's carousel (per-context shot orders) and P85's measurement, unscoped as P85's own fixture has it. */
const P85_CAROUSEL = { slot: CAROUSEL, take: 8, weights: { category: 1 }, shotOrders: [
  { context: { channel: 'paid_social', visitBuckets: ['1'], device: 'mobile' }, order: ['on-model', 'detail', 'studio', 'flat-lay'] }] };
const P85_DOCS = { pieces: [...MODULES], slots: { ...declaredSlots([]), pages: { pdp: [layoutSlot(), P85_CAROUSEL] } }, learn: LEARN };
/** The anchor's eight carousel images (P85's count), one colour-specific. */
const BEACON_IMAGES = Array.from({ length: 8 }, (_, i) => image(`img-ch857-b${i + 1}`, i === 7 ? [A, BLACK] : [A], 'Handbags', SHOTS[i % 4]!));
/** The context table's version in force (P84's GET /v1/<tenant>/context-table/<page>). */
async function tableVersionOf(m: Mounted): Promise<string> {
  const response = await m.fetch(new Request(`https://shop.invalid/v1/${TENANT}/context-table/pdp`, { headers: { 'X-Tenant': TENANT } }));
  const body = await response.json().catch(() => ({})) as { version?: unknown };
  return typeof body.version === 'string' ? body.version : `no table (${response.status})`;
}
/** P85's beacon through POST /realtime/action, the default context (counted as an unknown context is), the images in their order. */
const beaconOf = (s: Shopper, version: string, extra: Record<string, unknown> = {}) => s.action({ type: 'carousel_exposure', data: { tableVersion: version,
  context: 'default', page: 'pdp', slot: CAROUSEL, images: BEACON_IMAGES.map(r => r.id), arm: 'personalized', pageInstance: pageInstanceOf('p86-beacon'), ...extra } });
const beaconAnswer = (a: Answer) => [a.status, a.body.exposure ?? null, a.body.reason ?? a.body.images ?? null];

describe('unit:P86.CS2 (D2: design A, R-P405)', () => {
  for (const host of HOSTS) {
    it(`host (${host}): with a range of N = 50 and of N = 5,000 products, the anchor's page reads the manifest and ONE part — the anchor's, at the same address at both sizes — and serves P80's carousel; its reads are the same at both sizes; the manifest it parses holds the shared pieces only; warm, it reads no part; the operator's per-product read reads that one part`, async () => {
      const at: Record<number, Awaited<ReturnType<typeof measured>>> = {};
      for (const n of [50, 5000]) at[n] = await measured(await rangeTenant(host, n));
      for (const n of [50, 5000]) {
        const { cold, warm, operator, manifest } = at[n]!;
        const anchorPart = partKey(digestOf(manifest, A));
        expect.soft({ status: cold.result.status, served: carousel(cold.result), parts: partReads(cold.reads).map(r => r.key), shared: sorted(sharedOf(manifest)),
          indexed: Object.keys(productsOf(manifest)).length, warm: [carousel(warm.result), partReads(warm.reads).length], operator: partReads(operator.reads).map(r => r.key) },
        `${host}: P86.CS2 — N = ${n}: the manifest and the anchor's part alone (today the whole range in one document, no part: ${classes(cold.reads).join(', ')})`).toEqual({
          status: 200, served: SERVED_FOR_BLACK, parts: [anchorPart], shared: sorted([...MODULE_IDS, 'img-brand-1']), indexed: n + 3,
          warm: [SERVED_FOR_BLACK, 0], operator: [anchorPart] });
      }
      // R-P416 (residual), P93 R10 (R-P487 (9)): the exact read list — the head, the set, the four members, the anchor's
      // product shard and the anchor's one part — at each size (before: 7 reads, no shard).
      for (const n of [50, 5000]) {
        const { cold, manifest } = at[n]!;
        expect.soft(classes(cold.reads), `${host}: P86.CS2 — N = ${n}: exactly the head, the set, the content, slots, learn and reflex revisions, the anchor's shard and the anchor's part, once each`)
          .toEqual(sorted(['head', 'set', 'content revision', 'slots revision', 'learn revision', 'reflex revision', shardOf(manifest, A), `part ${digestOf(manifest, A)}`]));
      }
      const [small, large] = [at[50]!, at[5000]!];
      // A shard holds the other products of its bucket, so its address differs between the two ranges: compared by class.
      const byClass = (reads: Read[]) => classes(reads).map(c => SHARD.test(c) ? 'shard' : c);
      expect.soft({ reads: byClass(large.cold.reads), partBytes: partReads(large.cold.reads).map(r => r.bytes) },
        `${host}: P86.CS2 — the decision's reads and the part it parses are the same at N = 5,000 as at N = 50`).toEqual({
        reads: byClass(small.cold.reads), partBytes: partReads(small.cold.reads).map(r => r.bytes) });
    }, 600_000);

    it(`host (${host}): no part is read where none is needed — a page naming no anchor, a variant alone, or an anchor the manifest does not index (${UNINDEXED}) decides the scoped carousel empty (P80 AS2) and reads no part; a page with no scoped slot reads no part though it names the anchor`, async () => {
      const m = await rangeTenant(host, 50);
      const indexed = await loadDocument(m, 'catalog');
      expect(Object.keys(productsOf(indexed)), `${host}: PRECONDITION — the manifest indexes ${A} (today it indexes nothing)`).toContain(A);
      const s = await shopperOn(m);
      const cases: Array<[string, string, Record<string, string>]> = [['no anchor', 'pdp', {}], ['a variant alone', 'pdp', { variant: BLACK }],
        ['an anchor not indexed', 'pdp', { anchor: UNINDEXED }], ['a page with no scoped slot', 'cart', { anchor: A }]];
      const seen: unknown[] = [];
      for (const [name, page, signals] of cases) {
        invalidatePublicationCache();
        const { result, reads } = await counted(m, () => snapshotOf(m, s, page, signals, 'p86-cs2-none'));
        seen.push([name, result.status, page === 'cart' ? servedIn(result, 'pdp-recent') : carousel(result), partReads(reads).length]);
      }
      expect.soft(seen, `${host}: P86.CS2 — the scoped carousel empty and no part read; the cart's own slot served`).toEqual([
        ['no anchor', 200, [], 0], ['a variant alone', 200, [], 0], ['an anchor not indexed', 200, [], 0], ['a page with no scoped slot', 200, [M.recent], 0]]);
    }, 300_000);

    it(`host (${host}): every reader resolves the anchor's part — each carousel decision replays equal; its receipt names the image's title; a click on an image teaches its own catalogue format reading at most one part`, async () => {
      const m = await rangeTenant(host, 50);
      const indexed = await loadDocument(m, 'catalog');
      expect(Object.keys(productsOf(indexed)), `${host}: PRECONDITION — the manifest indexes ${A} (today it indexes nothing)`).toContain(A);
      const s = await shopperOn(m);
      const page = await snapshotOf(m, s, 'pdp', { anchor: A, variant: BLACK }, 'p86-cs2-readers');
      const images = page.decisions.filter(d => d.slot === CAROUSEL);
      expect(sorted(images.map(d => d.contentId)), `${host}: PRECONDITION — the anchor's carousel is served (${page.status})`).toEqual(SERVED_FOR_BLACK);
      for (const d of images) expect((await s.ack(page, d)).status, `${host}: PRECONDITION — ${d.contentId} is acknowledged`).toBe(200);
      await m.drainLedger();
      const records = storedDecisions(m, s.subject).filter((r: DecisionRecord) => r.slot === CAROUSEL);
      expect(records.length, `${host}: PRECONDITION — the carousel's records are stored`).toBe(images.length);
      const replays: unknown[] = [];
      for (const r of records) { const replay = await replayOf(m, r.decision_id); replays.push([r.item_id, replay.status, replay.body.classification ?? replay.body.reason ?? null]); }
      expect.soft(replays, `${host}: P86.CS2 — replay reads the record's anchor's part`).toEqual(records.map(r => [r.item_id, 200, 'equal']));
      const titles = new Map(ANCHOR_IMAGES.map(r => [r.id, r.title]));
      const receipts = (await receiptsOf(m, s.subject)).filter(x => x.slot === CAROUSEL);
      expect.soft(receipts.map(x => [x.item, x.title ?? null]), `${host}: P86.CS2 — the receipts route names each image as it names a shared piece`).toEqual(
        receipts.map(x => [x.item, titles.get(String(x.item)) ?? 'not an anchor image']));
      const clicked = images.find(d => d.contentId === 'img-ch857-1')!;
      const click = await counted(m, () => s.click(page, clicked));
      expect.soft([click.result.status, partReads(click.reads).length <= 1 ? 'at most one part read' : `${partReads(click.reads).length} part reads`],
        `${host}: P86.CS2 — the click is accepted reading at most one part`).toEqual([200, 'at most one part read']);
      const set = await servePage(m, s, 'pdp');
      const taught = ((set.records[0]?.inputs?.affinity ?? {}) as Record<string, Record<string, number>>).contentType ?? {};
      expect.soft(Object.keys(taught).sort(), `${host}: P86.CS2 — the click teaches the image's own format (its catalogue tag, read from its part)`).toEqual(['on-model']);
    }, 300_000);

    it(`host (${host}): the learn routes (R-P407 (5), S10) — the carousel's lift rows and its exploring rows keep each image the shared pieces do not carry, named unresolved: true, title null (no anchor on a row)`, async () => {
      const m = await rangeTenant(host, 50);
      const indexed = await loadDocument(m, 'catalog');
      expect(Object.keys(productsOf(indexed)), `${host}: PRECONDITION — the manifest indexes ${A} (today it indexes nothing)`).toContain(A);
      const s = await shopperOn(m);
      const page = await snapshotOf(m, s, 'pdp', { anchor: A, variant: BLACK }, 'p86-cs2-learn');
      const images = page.decisions.filter(d => d.slot === CAROUSEL);
      expect(sorted(images.map(d => d.contentId)), `${host}: PRECONDITION — the anchor's carousel is served (${page.status})`).toEqual(SERVED_FOR_BLACK);
      for (const d of images) expect((await s.ack(page, d)).status, `${host}: PRECONDITION — ${d.contentId} is rendered`).toBe(200);
      await m.drainLedger();
      const published = await asOperator(m, 'POST', `/v1/${TENANT}/learn/publish`, { slot: CAROUSEL });
      expect(published.status, `${host}: PRECONDITION — the carousel's lift snapshot is published (${show(published)})`).toBe(200);
      const named = (a: Answer) => sorted(((a.body.rows ?? []) as Array<Record<string, unknown>>).map(r => JSON.stringify([r.item, r.title ?? null, r.unresolved ?? 'no unresolved member'])));
      const rows = await asOperator(m, 'GET', `/v1/${TENANT}/lift/rows?slot=${CAROUSEL}`);
      const exploring = await asOperator(m, 'GET', `/v1/${TENANT}/learn/exploring?slot=${CAROUSEL}`);
      const expected = sorted(SERVED_FOR_BLACK.map(id => JSON.stringify([id, null, true])));
      expect.soft({ rows: [rows.status, named(rows)], exploring: [exploring.status, named(exploring)] },
        `${host}: P86.CS2 — each image kept and named unresolved on both routes (lift rows: ${show(rows)}; exploring: ${show(exploring)})`).toEqual({
        rows: [200, expected], exploring: [200, expected] });
    }, 300_000);

    it(`host (${host}): R-P412 (1), R-P413 — a content click naming a decision id that is not in the acting shopper's own ring (another visitor's, or one unknown) or naming none resolves no part, teaches only the event's own values (no catalogue format, signals.recognized false) and reads no other shopper's ring or key; her own decision's click resolves its part`, async () => {
      const m = await rangeTenant(host, 50);
      expect(Object.keys(productsOf(await loadDocument(m, 'catalog'))), `${host}: PRECONDITION — the manifest indexes ${A} (today it indexes nothing)`).toContain(A);
      const x = await shopperOn(m), y = await shopperOn(m);
      const page = await snapshotOf(m, x, 'pdp', { anchor: A, variant: BLACK }, 'p86-cs2-foreign');
      const images = page.decisions.filter(d => d.slot === CAROUSEL);
      expect(sorted(images.map(d => d.contentId)), `${host}: PRECONDITION — her carousel is served (${page.status})`).toEqual(SERVED_FOR_BLACK);
      for (const d of images) expect((await x.ack(page, d)).status, `${host}: PRECONDITION — ${d.contentId} is acknowledged`).toBe(200);
      await m.drainLedger();
      const clicked = images.find(d => d.contentId === 'img-ch857-1')!, foreignId = String(clicked.decisionId);
      const segments = foreignId.split(':');
      const unknownId = [...segments.slice(0, 2), y.subject, ...segments.slice(3, -1), crypto.randomUUID()].join(':');
      const clicks: Array<[string, Decision]> = [['another visitor\'s decision', clicked], ['a decision unknown to her ring', { ...clicked, decisionId: unknownId }],
        ['no decision', { ...clicked, decisionId: undefined }]];
      const seen: unknown[] = [];
      for (const [name, d] of clicks) {
        const { result, foreign, parts } = await foreignReads(m, x.subject, () => y.click(page, d));
        seen.push([name, result.status, (result.body.signals as { recognized?: unknown } | undefined)?.recognized ?? 'no signals member', parts, foreign]);
      }
      expect.soft(seen, `${host}: P86.CS2 — unresolved: no part read, nothing recognized, no read naming another shopper`).toEqual(
        clicks.map(([name]) => [name, 200, false, 0, []]));
      const ofY = ((await servePage(m, y, 'pdp')).records[0]?.inputs?.affinity ?? {}) as Record<string, Record<string, number>>;
      const own = await x.click(page, clicked);
      const ofX = ((await servePage(m, x, 'pdp')).records[0]?.inputs?.affinity ?? {}) as Record<string, Record<string, number>>;
      expect.soft({ y: Object.keys(ofY.contentType ?? {}), x: [own.status, (own.body.signals as { recognized?: unknown } | undefined)?.recognized ?? 'no signals member', Object.keys(ofX.contentType ?? {})] },
        `${host}: P86.CS2 — her clicks taught no catalogue format; the visitor whose decision it is learns her image's own format`).toEqual({ y: [], x: [200, true, ['on-model']] });
    }, 300_000);

    it(`host (${host}): R-P412 (2) — the anchor's part unreadable (lost, or a body that is not its digest's) fails the product page's decision 503 part_unavailable and never serves the shared pieces alone; a page that reads no part is served as before`, async () => {
      const m = await rangeTenant(host, 50);
      const manifest = await loadDocument(m, 'catalog'), key = partKey(digestOf(manifest, A));
      expect(m.storage.objects.has(key), `${host}: PRECONDITION — ${A}'s part is stored (today there is none)`).toBe(true);
      const s = await shopperOn(m);
      const outcome = (page: Snapshot) => [page.status, JSON.stringify(page.body).includes('part_unavailable') ? 'names part_unavailable' : `does not (${JSON.stringify(page.body).slice(0, 160)})`, carousel(page)];
      m.storage.objects.delete(key); invalidatePublicationCache();
      const lost = await snapshotOf(m, s, 'pdp', { anchor: A, variant: BLACK }, 'p86-cs2-lost');
      const plain = await snapshotOf(m, s, 'pdp', {}, 'p86-cs2-plain');
      m.storage.objects.set(key, m.storage.objects.get(partKey(digestOf(manifest, B)))!); invalidatePublicationCache();
      const forged = await snapshotOf(m, s, 'pdp', { anchor: A, variant: BLACK }, 'p86-cs2-forged');
      expect.soft({ lost: outcome(lost), forged: outcome(forged), plain: [plain.status, servedIn(plain, 'pdp-modules').length > 0, carousel(plain)] },
        `${host}: P86.CS2 — 503 part_unavailable, no fallback; the page without an anchor served`).toEqual({
        lost: [503, 'names part_unavailable', []], forged: [503, 'names part_unavailable', []], plain: [200, true, []] });
    }, 300_000);

    it(`host (${host}): R-P409 (1) — P85's carousel beacon: on a parted tenant a beacon naming its product (\`product\`) reads that one part and is admitted; one naming none is ignored product_required; on a tenant without parts the member changes nothing (both admitted)`, async () => {
      const plain = await mount(host, { ...P85_DOCS, pieces: [...MODULES, ...BEACON_IMAGES] });
      expectPublished(plain, 'P86.CS2 — the tenant without parts publishes');
      const shopper = await shopperOn(plain), version = await tableVersionOf(plain);
      const first = await beaconOf(shopper, version);
      expect(beaconAnswer(first), `${host}: PRECONDITION P85 — P85's carousel beacon is admitted on a tenant without parts (P85 is not in this tree until it lands: ${show(first)})`)
        .toEqual([200, 'admitted', 8]);
      const named = await beaconOf(shopper, version, { product: A });
      expect.soft(beaconAnswer(named), `${host}: P86.CS2 — LOCK: on a tenant without parts the product member changes nothing`).toEqual([200, 'admitted', 8]);
      const m = await mount(host, P85_DOCS);
      expectPublished(m, 'P86.CS2 — the parted tenant publishes');
      await declareProductSlots(m);
      const loaded = await importJson(m, BEACON_IMAGES, { mode: 'merge' });
      expect(loaded.status, `${host}: PRECONDITION — the anchor's images load (${show(loaded)})`).toBe(200);
      const s = await shopperOn(m), parted = await tableVersionOf(m), manifest = await loadDocument(m, 'catalog');
      invalidatePublicationCache();
      const withProduct = await counted(m, () => beaconOf(s, parted, { product: A }));
      const without = await beaconOf(s, parted);
      expect.soft({ named: beaconAnswer(withProduct.result), parts: partReads(withProduct.reads).map(r => r.key), unnamed: beaconAnswer(without) },
        `${host}: P86.CS2 — the named product's one part read and admitted; unnamed, product_required (today every image is a shared piece: ${show(without)})`).toEqual({
        named: [200, 'admitted', 8], parts: [partKey(digestOf(manifest, A))], unnamed: [200, 'ignored', 'product_required'] });
    }, 120_000);
  }

  it('sdk: R-P409 (1) — the real SDK sends the page view\'s product with P85\'s carousel beacon as `product` when the beacon names its productId, and no product member when it names none', async () => {
    const f = testHost({ responses: () => ({ success: true }) });
    const core = createCore({ tenant: TENANT, source: 'coach-pdp' }, f.host);
    const listen = createListen(core) as unknown as Record<string, unknown>;
    expect(await core.ready(), 'PRECONDITION: the client is ready').toBe(true);
    const send = listen.carouselExposure as ((beacon: Record<string, unknown>) => Promise<unknown>) | undefined;
    expect(typeof send, 'PRECONDITION P85 — the SDK offers listen.carouselExposure (P85 is not in this tree until it lands)').toBe('function');
    const beacon = { tableVersion: 'a'.repeat(64), context: 'paid_social|1|mobile', page: 'pdp', slot: CAROUSEL, images: BEACON_IMAGES.map(r => r.id), arm: 'personalized' };
    await send!({ ...beacon, productId: A });
    await send!({ ...beacon, page: 'pdp-quickview' });
    for (let i = 0; i < 8; i++) await new Promise(r => setTimeout(r, 5));
    const sent = f.calls.filter(c => c.url.endsWith('/action')).map(c => JSON.parse(c.init!.body!) as { type: string; data: Record<string, unknown> })
      .filter(e => e.type === 'carousel_exposure').map(e => [e.data.page, Object.hasOwn(e.data, 'product') ? e.data.product : 'no product member']);
    expect.soft(sent, 'P86.CS2 — the product sent with the beacon that names it, none with the beacon that does not (today it is kept and not sent)').toEqual(
      [['pdp', A], ['pdp-quickview', 'no product member']]);
  });
});

// ===========================================================================
// unit:P86.CS3 — the kit states the manifest, the parts and their limits
// ===========================================================================

describe('unit:P86.CS3 (D2: design A, R-P405)', () => {
  // P93 R10 (R-P487 (1), (5)): the manifest names its parts through `index` (before: `products`), a PUT removes a product by
  // `removeProducts` (before: by leaving its pointer out), the id index is the id shards, their cap and the loads reading
  // them (before: one id index object), and the cap kit 03 names is the shard's (before: manifest_too_large with the
  // two-level index next). Code names and members are matched as words.
  it('logic: kit 03 states the manifest (`productSlots`, `index`), the parts, the routing by the first id with the canonical order [product, variant] and the `variant_first` warning, the modes per product, the shard cap\'s refusal `index_shard_too_large`, the PUT\'s `removeProducts`, and part retention under the purge; kit 02 states the per-product read on GET /content/{kind} and the part beside the 2 MiB limits; today\'s one-document sentences are gone', () => {
    const kit02 = readTree('docs/kit/02-api-reference.md'), kit03 = readTree('docs/kit/03-payload-schemas.md');
    const paragraphs = (text: string) => text.split(/\n\s*\n/).map(p => p.split('\n').join(' '));
    const has = (text: string, ...words: Array<string | RegExp>) => paragraphs(text).some(p => words.every(w => typeof w === 'string' ? p.includes(w) : w.test(p)));
    const flat03 = kit03.replace(/\s+/g, ' ');
    const getRow = kit02.split('\n').find(line => line.startsWith('| `GET /content/{kind}?scope=`')) ?? '';
    const limits = paragraphs(kit02).find(p => p.startsWith('Configuration PUT/PATCH, import, pull')) ?? '';
    expect.soft({
      manifest: has(kit03, '`productSlots`', '`index`', /\bpart\b/),
      routing: has(kit03, '`featuredProductIds`', '`productSlots`', /\bfirst id\b/),
      variantFirst: has(kit03, '`variant_first`', /\[product, variant\]/),
      putRemoves: has(kit03, /`removeProducts\b/, /\bPUT\b/, /\bremoves?\b/),
      moveRule: has(kit03, /\brecord_moved\b/, /\bsource\b/, /\bone file\b|\bsame file\b/),
      collisions: has(kit03, /\bid_in_part\b/, /\bid_shared\b/),
      idIndex: has(kit03, /\bid shards?\b/, /\bid_index_too_large\b/) && has(kit03, /\bid shards\b/, /\bloads\b/),
      lostPart: has(kit03, /\blost\b/, /\b503\b/, /\brollback\b/),
      modes: has(kit03, '`merge`', '`replace`', '`full`', /\bpart\b/),
      cap: has(kit03, /\bindex_shard_too_large\b/, /\bshard\b/),
      retention: has(kit03, /\bparts?\b/, /\bpurge/),
      oneDocument: flat03.includes('the catalog is one such document per scope'),
      sharding: flat03.includes('a larger corpus is a conversation about sharding the catalog'),
      perProductRead: getRow.includes('product='),
      partLimit: /\bparts?\b/.test(limits),
    }, 'P86.CS3 — the kit states design A (today it states one catalogue document per scope and sharding as a conversation)').toEqual({
      manifest: true, routing: true, variantFirst: true, putRemoves: true, moveRule: true, collisions: true, idIndex: true, lostPart: true, modes: true, cap: true, retention: true, oneDocument: false, sharding: false, perProductRead: true, partLimit: true });
  });
});

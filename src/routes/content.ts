// src/routes/content.ts
// ─────────────────────────────────────────────────────────────────────────────
// CW2 — the write side of the three content documents CW4 reads: the catalog,
// the per-page slot strategies, and the learning settings. Same store, same
// line as the config routes: reads and writes authenticated and fail closed,
// every write validated as a whole, versioned, attributed, and rolled forward.
//
//   GET  /content/:kind                  the document in force, and where it came from
//   GET  /content/:kind/history          the audit index
//   GET  /content/:kind/revisions/:n     one historical revision
//   POST /content/:kind/validate         authenticated dry run
//   PUT  /content/:kind                  full replace (JWT)
//   POST /content/:kind/rollback/:n      roll forward to an old body (JWT)
//   POST /content/catalog/import         a JSON or CSV export, replace or merge (JWT)
//   POST /content/catalog/pull           a JSON URL, the CMS/DAM seam (JWT)
//   POST /content/publication/complete   P54: a four-member set's priors and proposals, once (stamp owner)
//   POST /content/vocabulary/approve/:n  P38: put vocabulary revision n in effect (JWT)
//   GET  /content/vocabulary/rejections  P38: the values the vocabulary in effect refused at ingest
//
// :kind is catalog | slots | learn | priors | vocabulary. ?scope= selects the tenant scope, as /config does.
// ─────────────────────────────────────────────────────────────────────────────

import { Hono, type Context } from 'hono';
import { InputError, inputRecords, readInputBytes, readInputJson, readInputText } from '@/config/input';
import type { Env } from '@/types/env';
import type { AuthContext } from '@/middleware/auth';
import { hasOperatorGrant, operatorJwt } from '@/middleware/operatorAuth';
import { storeFor } from '@/auth/accounts';
import { stampOwner } from '@/auth/authority';
import { isValidTenantId, type TenantVariables } from '@/tenancy/tenant';
import { LegacyDocumentError, readIndex, readVersion, rollback, write, type DocumentKind, type Revision, type WriteMeta } from '@/config/versionedStore';
import { assertPublicationBase, completePublicationSet, documentBytes, initializePublicationSet, PUBLICATION_MAX_BYTES, PublicationError, publicationMeta, publicationStatus, publicationScope, publicationVersion, publish, publishAnchored, publishSet, readOptionalPinnedPublication,
  catalogPackHeld, pinPublication, readPinnedPublication, readStageDirectory, STAGE_DIRECTORY_MAX_BYTES,
  readOptionalPublication, readPublication, recoverPublication, documentDigest, type PublicationBaseline, type PublicationChange, type PublicationPin,
  catalogPartStored, readCatalogPart, type CatalogPart, catalogIdIndexStored, readCatalogIdIndex,
  catalogIdShardOf, catalogIdShardStored, catalogPartPointer, catalogShardStored, catalogShardName, catalogShardOf, readCatalogIdShard, readCatalogShard,
  type CatalogIdShard, type CatalogShard, catalogPackStored, catalogueRevisionNameable, holdPack, indexAddress, NEW_PACK, PACK_MAX_BYTES, PackWriter, placedDigest, placeKey, publicationFailureOf,
  readCatalogPacked, resolvedPart, stagePackNameable, writePack, type WrittenPack, type PackAddress, type PackedRead, type ResolvedPartPointer, type SealedPack, type StoredPartPointer } from '@/config/publication';
import { catalogNamesRuleWords, catalogRuleErrors, CONTENT_KIND, DEFAULT_LEARN, DEFAULT_SLOTS, EMPTY_CATALOG, governedCatalogue, LEARN_KIND, learnBlendLayoutErrors, learnConversionDiagnostics, learnPositionLayoutErrors, type LearnConversionDiagnostics, namesPositionDials, PIECE_FIELDS, slotInnerCatalogueErrors, slotOrderCatalogueErrors, slotsNameContext, SLOTS_KIND, validateSlotCatalog,
  VOCABULARY_APPROVAL_KIND, VOCABULARY_KIND, vocabularyTableOf, LAYOUTS_KIND, slotsCarryOrders, unapprovedOrders } from '@/content/kinds';
import { readVocabularyRejections } from '@/content/service';
import { contextTermsOf } from '@/content/cell';
import { invalidateConfigCache, REFLEX_KIND, reflexScopeForTenant } from '@/reflex/configStore';
import { DEFAULT_REFLEX_CONFIG } from '@/reflex/core';
import { EMPTY_PROPOSALS, PROPOSALS_KIND } from '@/learn/cycle';
import { cellGrammarFor, EMPTY_PRIORS, parsePriorsCsv, PRIORS_KIND, priorUnitErrors, validatePriors } from '@/learn/priors';
import { addressAllowed, hostAllowed, HttpJsonSource, assembleFrom, catalogDocumentFields, csvColumnCaseVariants, FEED_FIELDS, IMPORT_SOURCES_KIND, isImportMode, parseCsvTable, pullUrlOf, positionedCandidates, recordAddress, recordAddressed, recordsInJson, storedPieceRecords, type ImportMode, type PulledExport } from '@/content/import';
import type { CatalogIndex, CatalogPackEntry, CatalogPartPointer, ContentCatalog, ContentPiece, DocumentEnvelope, LayoutsDocument, LearnConfig, SlotCatalog, VocabularyApproval } from '@/content/types';
import { catalogParted, catalogPieceCount, catalogProductCount, partProductOf, variantFirst } from '@/content/kinds';
import { captureEnrichment, EnrichmentError, exportEnrichment, readEnrichment, readEnrichmentBody, reviewEnrichment } from '@/content/enrichment';
import { publishEnrichment } from '@/content/enrichmentPublication';
import { generateEnrichment } from '@/content/enrichmentGeneration';
import { ConnectorUnavailable } from '@/connectors/model';
import { catalogDiagnostics } from '@/content/catalogDiagnostics';
import { slotConstraintDiagnostics, slotDiagnostics } from '@/content/slotDiagnostics';

type Ctx = { Bindings: Env; Variables: TenantVariables & { auth: AuthContext; catalogImportRoute?: boolean } };
export const contentRoutes = new Hono<Ctx>();
/** W38.04: the one representation of an input refusal, named, on every consuming route. */
const inputRefusal = (c: Context<Ctx>, error: InputError) => c.json({ ok: false, error: error.message, code: error.code,
  ...(error.status === 413 ? { budget: error.budget, limit: error.limit, observed: error.observed } : {}) }, error.status);
contentRoutes.onError((error, c) => {
  if (error instanceof InputError) return inputRefusal(c, error);
  // P38 (VA2): a catalogue publication the vocabulary in effect refuses, raised inside the publication before anything is written.
  if (error instanceof VocabularyRefusal) return c.json({ ok: false, errors: error.errors }, 422);
  // P88 (E13): a slots publication the approved layouts of its set refuse, raised inside the publication before anything is written.
  if (error instanceof LayoutRefusal) return c.json({ ok: false, errors: error.errors }, 422);
  if (error instanceof LegacyDocumentError) return c.json({ ok: false, error: error.message, code: error.code }, error.status);
  // P98 (LD4): a storage failure also names the call, the object's kind, the store's error number and the state it left.
  if (error instanceof PublicationError) return c.json({ ok: false, error: error.message, code: error.code, ...publicationFailureOf(error) }, error.status);
  throw error;
});
/**
 * P87 (E11): the routes of the catalogue import a `catalog-import` service credential is admitted to, marked
 * before `operatorJwt` runs (every other operator route refuses that credential there, before its handler): GET the
 * document, its history, a revision and the catalogue's publication; POST validate, import, pull, the catalogue's
 * publication recover and (P98, C2) the stage and the publish of staged files. A kind, in the path or in `?kind=`, is read as `kindOf` reads every kind, lower-cased, so another
 * spelling answers the credential as it answers an operator; HEAD is the GET route Hono serves it as.
 */
function catalogImportRoute(c: Context<Ctx>): boolean {
  const [root, name = '', ...rest] = c.req.path.split('/').slice(1), method = c.req.method === 'HEAD' ? 'GET' : c.req.method;
  if (root !== 'content' || name.toLowerCase() !== 'catalog') return false;
  const kinds = c.req.queries('kind'), catalogueTarget = !kinds || (kinds.length === 1 && kinds[0]!.toLowerCase() === 'catalog');
  const at = (...tail: string[]) => rest.length === tail.length && tail.every((part, i) => (part === '*' ? rest[i] !== '' : rest[i] === part));
  if (method === 'GET') return at() || at('history') || at('revisions', '*') || (at('publication') && catalogueTarget);
  // P98 (C2, LD2): the staged files and their one publication are the import's, and admit its credential alike.
  if (method === 'POST') return at('validate') || at('import') || at('pull') || at('stage') || at('publish') || (at('publication', 'recover') && catalogueTarget);
  return false;
}
// Reads and validation require access authentication too; enforced operations
// additionally bind the operator and document scope to the canonical tenant.
contentRoutes.use('*', async (c, next) => {
  c.header('Cache-Control', 'no-store');
  if (catalogImportRoute(c)) c.set('catalogImportRoute', true);
  return operatorJwt()(c, next);
});
contentRoutes.use('*', async (c, next) => {
  if (c.env.AUTH_MODE === 'enforced') {
    for (const key of ['tenant', 'scope']) {
      const values = c.req.queries(key);
      if (values && (values.length !== 1 || values[0] !== c.get('tenant'))) {
        return c.json({ error: 'Tenant scope unavailable' }, 403);
      }
    }
  }
  return next();
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const KINDS: Record<string, { kind: DocumentKind<any>; fallback: any; fromCsv?: (text: string) => unknown }> = {
  catalog: { kind: CONTENT_KIND, fallback: EMPTY_CATALOG },
  slots: { kind: SLOTS_KIND, fallback: DEFAULT_SLOTS },
  learn: { kind: LEARN_KIND, fallback: DEFAULT_LEARN },
  // Phase 3 (doc 22 §8): imported priors, as JSON rows or as the CSV a warehouse exports.
  priors: { kind: PRIORS_KIND, fallback: EMPTY_PRIORS, fromCsv: parsePriorsCsv },
  // P38: the tenant's attribute vocabulary. An optional member: a tenant that
  // never published one has none, and reads it as absent (revision 0).
  vocabulary: { kind: VOCABULARY_KIND, fallback: null },
  // P91 (E16): the tenant's import-sources list, an optional member: absent until published, and then every caller of
  // the import, the pull and the dry run is checked against it.
  'import-sources': { kind: IMPORT_SOURCES_KIND, fallback: null },
  // P88 (E13, N2): the tenant's approved layouts, an optional member: absent until published, and then every
  // per-context order on a page it names is published only as one of that page's approved layouts.
  layouts: { kind: LAYOUTS_KIND, fallback: null },
};
const UNKNOWN_KIND = 'kind must be catalog, slots, learn, priors, vocabulary, import-sources or layouts';

function kindOf(name: string | undefined) { return KINDS[(name ?? '').toLowerCase()] ?? null; }
const isVocabulary = (kind: { name: string }) => kind.name === VOCABULARY_KIND.name;
/** An optional member of the publication set (P38, P91, P88): absent until its tenant publishes one, its first write over revision 0. */
const isOptionalMember = (kind: { name: string }) => isVocabulary(kind) || kind.name === IMPORT_SOURCES_KIND.name || kind.name === LAYOUTS_KIND.name;

/**
 * P38: the vocabulary's two members, read from ONE pin of the current set: the
 * latest stored revision (`revision`, 0 when none is stored) and the approval in
 * effect (`effectiveRevision`, 0 when none is), with the set identity an
 * authored write of the vocabulary names.
 */
async function vocabularyState(env: Env, scope: string) {
  const { publication, revision, set } = await readOptionalPublication(env, VOCABULARY_KIND, scope);
  const approval = await readOptionalPinnedPublication(env, VOCABULARY_APPROVAL_KIND, scope, set);
  return { publication, revision, approval };
}

/** P38: a catalogue publication refused by the vocabulary in effect, raised inside the publication and answered 422. */
class VocabularyRefusal extends Error {
  constructor(readonly errors: string[]) { super('vocabulary refusal'); }
}
/** P88 (E13): a slots publication refused by the approved layouts in effect, raised inside the publication and answered 422. */
class LayoutRefusal extends Error {
  constructor(readonly errors: string[]) { super('layout refusal'); }
}
/**
 * P88 (E13, N2): a slots document's candidate step at its publication (a PUT, a rollback, a `publicationChanges`
 * member). The approved layouts are those this request publishes as a `layouts` member, or else the member of the set
 * the publication is written over (its pin), so the rule reads the document in effect for exactly that set. A
 * document carrying no per-context order, or one the slots validator refuses (it names the errors then), passes on
 * untouched and nothing is read for it.
 */
function slotsOverLayouts(env: Env, scope: string, document: unknown, requestLayouts?: unknown) {
  return async (_base: unknown, set: PublicationPin) => {
    const checked = SLOTS_KIND.validate(document);
    if (!checked.ok || !slotsCarryOrders(checked.value)) return document;
    const own = requestLayouts === undefined ? null : LAYOUTS_KIND.validate(requestLayouts);
    const layouts = own ? (own.ok ? own.value : null) : (await readOptionalPinnedPublication(env, LAYOUTS_KIND, scope, set))?.value ?? null;
    const errors = unapprovedOrders(checked.value, layouts);
    if (errors.length) throw new LayoutRefusal(errors);
    return document;
  };
}
/**
 * P88 (E13): the slots validate's answer under the approved layouts in effect now, the same errors a publication
 * would raise. Fail closed: layouts that cannot be read refuse 503.
 */
async function layoutRefusals(c: Context<Ctx>, scope: string, slotsCandidate: unknown): Promise<{ errors: string[]; status: 422 | 503 } | null> {
  const checked = SLOTS_KIND.validate(slotsCandidate);
  if (!checked.ok || !slotsCarryOrders(checked.value)) return null;
  let layouts: LayoutsDocument | null;
  try { layouts = (await readOptionalPublication(c.env, LAYOUTS_KIND, scope)).revision?.value ?? null; }
  catch { return { status: 503, errors: ['layouts: the approved layouts in effect are unavailable, so the per-context orders cannot be checked against them'] }; }
  const errors = unapprovedOrders(checked.value, layouts);
  return errors.length ? { status: 422, errors } : null;
}
/** P88: the layouts document one PUT publishes, the primary document or a `publicationChanges` member, or undefined. */
function requestLayoutsDocument(primary: DocumentKind<unknown>, candidate: unknown, related: unknown): unknown {
  if (primary.name === LAYOUTS_KIND.name) return candidate;
  if (!Array.isArray(related)) return undefined;
  for (const entry of related as unknown[]) {
    if (!entry || typeof entry !== 'object') continue;
    const { kind, document } = entry as { kind?: unknown; document?: unknown };
    if (typeof kind === 'string' && kindOf(kind)?.kind.name === LAYOUTS_KIND.name) return document;
  }
  return undefined;
}
/**
 * P38 (VA2): a catalogue document published over `set`, under the vocabulary
 * that set has in effect: its governed tags mapped to ids, or the publication
 * refused naming each piece, field and value. A set with no approval in effect
 * publishes the document exactly as it came. The approval is read from the very
 * set the publication is made over, so the check and the write can never see
 * two different vocabularies.
 */
async function governedOver(env: Env, scope: string, set: PublicationPin, candidate: unknown): Promise<unknown> {
  const approval = await readOptionalPinnedPublication(env, VOCABULARY_APPROVAL_KIND, scope, set);
  if (!approval) return candidate;
  const governed = governedCatalogue(candidate, vocabularyTableOf(approval.value));
  if (!governed.ok) throw new VocabularyRefusal(governed.errors);
  return governed.value;
}

// ── P86 (E10, design A, R-P405, R-P407, R-P409): the catalogue's per-product parts at its doors ──
//
// A catalogue that declares `productSlots` is stored as a manifest: its shared
// pieces, its product slots and an index of one immutable part per product
// (src/config/publication.ts `writeCatalogPart`). Every door that publishes the
// catalogue — a PUT (alone or with related members), an import, a pull, a
// rollback — routes the records here, inside the publication's candidate step,
// so each part is written before the head is reserved and a refusal writes
// nothing. A catalogue declaring no product slots is today's document, untouched.

/**
 * A catalogue's pieces routed under its product slots: the shared pieces, each
 * product's records in their order, and the refusals (a pooled record that
 * would go to a part: pooled evidence is one record across every page, which a
 * part read on one product's page would split), addressed `pieces[i]` in the
 * list given, so an import names the record of the file sent.
 */
function routedPieces(pieces: readonly ContentPiece[], productSlots: readonly string[], offset = 0):
  { shared: ContentPiece[]; parts: Map<string, ContentPiece[]>; errors: string[] } {
  const slots = new Set(productSlots), shared: ContentPiece[] = [], parts = new Map<string, ContentPiece[]>(), errors: string[] = [];
  pieces.forEach((piece, i) => {
    const product = partProductOf(piece, slots);
    if (product === null) { shared.push(piece); return; }
    if (piece.pooled === true) {
      errors.push(`pieces[${offset + i}]: ${JSON.stringify(piece.id).slice(0, 80)} is a record of product ${JSON.stringify(product).slice(0, 80)}'s part (every slot type a product slot), so it cannot be pooled: a pooled piece stays shared`);
      return;
    }
    parts.set(product, [...(parts.get(product) ?? []), piece]);
  });
  return { shared, parts, errors };
}
/** The manifest a catalogue publishes: its own members, the shared pieces and (P93) the sharded index. */
function manifestOf(catalog: Pick<ContentCatalog, 'version' | 'typeFallback' | 'productSlots'>, shared: ContentPiece[], index: CatalogIndex): ContentCatalog {
  return { ...(catalog.version !== undefined ? { version: catalog.version } : {}), ...(catalog.typeFallback ? { typeFallback: catalog.typeFallback } : {}),
    productSlots: [...(catalog.productSlots ?? [])], pieces: shared, index };
}
/**
 * The cap (S5, P93): the manifest rides the pending head beside the set, both
 * under the store's 2 MiB, so a manifest whose shared pieces would leave no room
 * for them is refused 413 `manifest_too_large`, naming it, before any part or
 * shard is written. Its index is 512 pointers at most, whatever the number of
 * products: the shared pieces alone drive it.
 */
function manifestCap(manifest: ContentCatalog, set: PublicationPin): void {
  const bytes = documentBytes(manifest), reserve = documentBytes(set) + 4096;
  if (bytes + reserve > PUBLICATION_MAX_BYTES) {
    throw new PublicationError(`The catalogue manifest would be ${bytes} bytes (its ${manifest.pieces.length} shared pieces and its index), past what one 2 MiB publication holds beside its set; nothing was written`, 413, 'manifest_too_large');
  }
}
/** Each part's pointer: the digest of its canonical `{ product, pieces }` and its record count. Nothing is written. */
async function partPointers(parts: ReadonlyMap<string, ContentPiece[]>): Promise<Record<string, CatalogPartPointer>> {
  const out: Record<string, CatalogPartPointer> = {};
  for (const [product, pieces] of parts) out[product] = { digest: await documentDigest({ product, pieces } satisfies CatalogPart), records: pieces.length };
  return out;
}
/**
 * R-P424 (amending R-P407 (5)): where each part record's id lives in a one-level
 * catalogue (P86's form), from the id index its manifest names — read by a load
 * only, never by a decision; none for a manifest without parts. A manifest with
 * parts and no index cannot be checked, and is refused 503 `id_index_unavailable`.
 */
async function idIndexInForce(env: Env, scope: string, current: ContentCatalog | undefined): Promise<Map<string, string>> {
  if (!current?.products || !Object.keys(current.products).length) return new Map();
  if (!current.idIndex) throw new PublicationError('The catalogue names parts but no id index, so the load cannot be checked against the records the parts hold; nothing was written', 503, 'id_index_unavailable');
  return readCatalogIdIndex(env, scope, current.idIndex.digest);
}

// ── P93 (E18, R-P487): the sharded index at the catalogue's doors ─────────────
// ── P98 (E25, R-P549): built into one pack per load ─────────────────────────

/**
 * P93: the index a publication writes; P98: and the one pack that holds every object it placed (none where it placed
 * none), and (R-P646) the same index naming that pack by the digest of the fresh pack it was written as instead.
 */
interface BuiltIndex { index: CatalogIndex; pack: SealedPack | null; rebase: (fresh: SealedPack) => CatalogIndex }
const own = <T>(record: Record<string, T> | undefined, key: string): T | undefined => record && Object.hasOwn(record, key) ? record[key] : undefined;
const partTooLarge = (product: string) => () => new PublicationError(`The part of product ${JSON.stringify(product).slice(0, 80)} exceeds 2 MiB`, 413, 'part_too_large');
const tableInconsistent = () => new PublicationError('The catalogue\'s pack table does not account for the objects its index reaches; nothing was written', 503, 'publication_unavailable');
/** P98: run `task` over `items`, at most `width` at a time, each next item started as soon as one finishes. */
async function pooled<T>(items: readonly T[], task: (item: T) => Promise<unknown>, width = 16): Promise<void> {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(width, items.length) }, async () => { while (next < items.length) await task(items[next++]!); }));
}
/**
 * P98 (LD6): the packs a writing load re-homes: the one most dead of those under a quarter live, and (R-P646) as many
 * more, fewest live bytes first, as keep the table within its 65 rows once the load's own pack and every pack it names
 * that the table does not (a publish's stages) enter it (`need`). Fewest live bytes first, so the fewest bytes move.
 */
const COMPACT_LIVE = 0.25, PACK_TABLE_CAP = 65;
function compactionVictims(rows: readonly CatalogPackEntry[], need: number): CatalogPackEntry[] {
  let thin: CatalogPackEntry | undefined;
  for (const row of rows) if (row.bytes / row.size < COMPACT_LIVE && (!thin || row.bytes / row.size < thin.bytes / thin.size)) thin = row;
  const victims = thin ? [thin] : [];
  for (const row of [...rows].sort((a, b) => a.bytes - b.bytes || (a.digest < b.digest ? -1 : 1))) {
    if (victims.length >= need) break;
    if (row !== thin) victims.push(row);
  }
  return victims;
}
/**
 * P93: the index a door publishes over, read as little as the door needs and
 * edited in place: a product's part pointer through its shard, a record id's
 * owner through its id shard — read only for the ids whose place can change —
 * each shard read once; then the shards the edits touch rebuilt. Over a one-level
 * catalogue (P86's `products` and `idIndex`) it reads those instead, and the
 * publication writes the sharded form whole (at most 256 + 256 shards), every
 * part's digest unchanged: the migration needs no step of its own.
 *
 * P98 (E25, design C): what it writes is ONE pack — every part whose digest moved
 * (`place`) and every shard and id shard it rebuilt — and the manifest's pointers
 * name each object's pack through the pack table and its byte range. What a load
 * reads it reads ahead, each pack's objects in as few ranged reads as their places
 * allow (`prefetchShards`, `prefetchParts`, `prefetchIdShards`); an object stored
 * before packs (P86, P93) is read as its own object, once. The table counts, for
 * every pack the revision reaches, the objects and bytes of it reached, from the
 * pointers the edits replace (so no other object is read), and `legacy` counts the
 * objects reached that are stored before packs. A load that writes (`writing`)
 * also moves into its pack what it read of the objects stored before packs, and
 * re-homes the live objects of one pack the table shows under a quarter live (or,
 * past 64 packs, the one with the fewest live bytes).
 */
class IndexEdit {
  private readonly shards = new Map<string, Map<string, ResolvedPartPointer>>();
  private readonly idShards = new Map<string, Map<string, string>>();
  private readonly pointers = new Map<string, ResolvedPartPointer | null>();
  private readonly owners = new Map<string, string | null>();
  /** P98: the parts whose digest moved, in the order they are placed in the pack. */
  private readonly placed = new Map<string, CatalogPart>();
  /** P98: objects read ahead, by digest. */
  private readonly fetched = new Map<string, unknown>();
  /** P98 (LD8): what this load read of the objects stored before packs: shard and id-shard names, and parts by product. */
  private readonly legacyShards = new Set<string>();
  private readonly legacyIdShards = new Set<string>();
  private readonly legacyParts = new Map<string, CatalogPart>();
  /** P98: the digest of each shard and id shard read, by name (a pointer into a pack names its place, not its digest). */
  private readonly shardDigests = new Map<string, string>();
  private readonly idShardDigests = new Map<string, string>();
  private oneLevelIds?: Map<string, string>;
  constructor(private readonly env: Env, private readonly scope: string, private readonly current: ContentCatalog | undefined) {}
  /** Over a one-level manifest the next publication writes every shard. */
  private get migrating(): boolean { return !!this.current?.products; }
  /** The sharded index in force (none over a one-level catalogue). */
  private get held(): CatalogIndex | undefined { return this.migrating ? undefined : this.current?.index; }
  private where(pointer: { digest?: string; pack?: number; at?: number; bytes?: number }): PackAddress | undefined {
    const index = this.held; return index ? indexAddress(index, pointer) : undefined;
  }
  private async productShard(name: string): Promise<Map<string, ResolvedPartPointer>> {
    let held = this.shards.get(name);
    if (held) return held;
    held = new Map();
    const pointer = own(this.held?.shards, name);
    if (pointer) {
      const where = this.where(pointer);
      const shard = (this.fetched.get(pointer.digest ?? placeKey(where!)) as CatalogShard | undefined) ?? await readCatalogShard(this.env, this.scope, pointer.digest, where, name, pointer.products);
      if (!where) this.legacyShards.add(name);
      this.shardDigests.set(name, pointer.digest?.length === 64 ? pointer.digest : await documentDigest(shard));
      for (const [product, p] of Object.entries(shard.products)) held.set(product, resolvedPart(shard, where, p));
    }
    this.shards.set(name, held);
    return held;
  }
  private async idShard(name: string): Promise<Map<string, string>> {
    let held = this.idShards.get(name);
    if (held) return held;
    held = new Map();
    const pointer = own(this.held?.ids, name);
    if (pointer) {
      const where = this.where(pointer);
      const shard = (this.fetched.get(pointer.digest ?? placeKey(where!)) as CatalogIdShard | undefined) ?? await readCatalogIdShard(this.env, this.scope, pointer.digest, where, name);
      if (!where) this.legacyIdShards.add(name);
      this.idShardDigests.set(name, pointer.digest?.length === 64 ? pointer.digest : await documentDigest(shard));
      for (const [id, product] of Object.entries(shard.ids)) held.set(id, product);
    }
    this.idShards.set(name, held);
    return held;
  }
  /** P98: read ahead, each pack's in as few ranged reads as their places allow, the packed shards of these names not yet read. */
  private async ahead(group: 'shards' | 'ids', names: Iterable<string>): Promise<void> {
    const index = this.held;
    if (!index) return;
    const wanted = new Map<string, PackedRead>();
    for (const name of names) {
      if ((group === 'shards' ? this.shards : this.idShards).has(name)) continue;
      const pointer = own(index[group], name), address = pointer ? indexAddress(index, pointer) : undefined;
      if (!pointer || !address) continue;
      const key = pointer.digest ?? placeKey(address);
      if (wanted.has(key) || this.fetched.has(key)) continue;
      wanted.set(key, { kind: group === 'shards' ? 'shard' : 'idshard', ...(pointer.digest ? { digest: pointer.digest } : {}), name, address });
    }
    if (wanted.size) for (const [hash, value] of await readCatalogPacked(this.env, this.scope, wanted.values())) this.fetched.set(hash, value);
  }
  private async namesOf(keys: Iterable<string>): Promise<Set<string>> {
    const names = new Set<string>(); for (const key of keys) names.add(await catalogShardName(key)); return names;
  }
  /** P98: read ahead the shards these products fall in. */
  async prefetchShards(products: Iterable<string>): Promise<void> { await this.ahead('shards', await this.namesOf(products)); }
  /** P98: read ahead the id shards these record ids fall in. */
  async prefetchIdShards(ids: Iterable<string>): Promise<void> { await this.ahead('ids', await this.namesOf(ids)); }
  /** P98: read ahead the packed parts of these pointers (a part stored before packs is read on its own, when needed). */
  async prefetchParts(pointers: Iterable<ResolvedPartPointer | undefined>): Promise<void> {
    const wanted: PackedRead[] = [];
    for (const p of pointers) if (p?.address && !this.fetched.has(p.digest)) wanted.push({ kind: 'part', digest: p.digest, address: p.address });
    if (wanted.length) for (const [hash, value] of await readCatalogPacked(this.env, this.scope, wanted)) this.fetched.set(hash, value);
  }
  /** P98: a product's part, as read ahead, else by its own read (by its range in its pack, or as its own object). */
  async part(pointer: ResolvedPartPointer): Promise<CatalogPart> {
    const value = (this.fetched.get(pointer.digest) as CatalogPart | undefined) ?? await readCatalogPart(this.env, this.scope, pointer.digest, pointer.address);
    if (!pointer.address && !this.migrating) this.legacyParts.set(value.product, value);
    return value;
  }
  /** P98: every id shard in force, the packed ones read ahead together (a removed product's lost part names its ids nowhere else). */
  async allIdShards(): Promise<Map<string, string>[]> {
    const names = Object.keys(this.held?.ids ?? {});
    await this.ahead('ids', names);
    return Promise.all(names.map(name => this.idShard(name)));
  }
  private async oneLevel(): Promise<Map<string, string>> { return this.oneLevelIds ??= await idIndexInForce(this.env, this.scope, this.current); }
  /** A product's part pointer, as edited, else as the revision in force names it; none where it has no part. */
  async pointer(product: string): Promise<ResolvedPartPointer | undefined> {
    if (this.pointers.has(product)) return this.pointers.get(product) ?? undefined;
    if (this.current?.products) { const p = own(this.current.products, product); return p ? { digest: p.digest, records: p.records } : undefined; }
    if (!this.current?.index) return undefined;
    return (await this.productShard(await catalogShardName(product))).get(product);
  }
  /** The product whose part holds a record id, as edited, else as the index in force lists it; none for an id no part holds. */
  async owner(id: string): Promise<string | undefined> {
    if (this.owners.has(id)) return this.owners.get(id) ?? undefined;
    if (this.current?.products) return (await this.oneLevel()).get(id);
    if (!this.current?.index) return undefined;
    return (await this.idShard(await catalogShardName(id))).get(id);
  }
  /** P98: a product's part whose digest moved, placed in this load's pack when the index is built. */
  place(product: string, part: CatalogPart, pointer: CatalogPartPointer): void {
    this.placed.set(product, part); this.pointers.set(product, { digest: pointer.digest, records: pointer.records });
  }
  setPointer(product: string, pointer: ResolvedPartPointer | null): void { this.placed.delete(product); this.pointers.set(product, pointer); }
  setOwner(id: string, product: string | null): void { this.owners.set(id, product); }
  /** P98 (C2): the record ids whose place this edit changes, and the product each now lives in (null: in none). */
  ownerEdits(): ReadonlyMap<string, string | null> { return this.owners; }
  /** R-P646: a one-level catalogue's products and record ids by the shard and id shard they fall in, grouped once. */
  private grouped?: { products: Map<string, Map<string, ResolvedPartPointer>>; ids: Map<string, Map<string, string>> };
  private async oneLevelGrouped(): Promise<NonNullable<IndexEdit['grouped']>> {
    if (this.grouped) return this.grouped;
    const products = new Map<string, Map<string, ResolvedPartPointer>>(), ids = new Map<string, Map<string, string>>();
    for (const [product, p] of Object.entries(this.current?.products ?? {})) {
      const name = await catalogShardName(product), group = products.get(name) ?? new Map<string, ResolvedPartPointer>();
      group.set(product, { digest: p.digest, records: p.records }); products.set(name, group);
    }
    for (const [id, product] of await this.oneLevel()) {
      const name = await catalogShardName(id), group = ids.get(name) ?? new Map<string, string>();
      group.set(id, product); ids.set(name, group);
    }
    return this.grouped = { products, ids };
  }
  /** R-P646: the names of the shards and id shards in force (over a one-level catalogue, those its products and ids fall in). */
  async namesInForce(group: 'shards' | 'ids'): Promise<string[]> {
    if (this.migrating) return [...(await this.oneLevelGrouped())[group === 'shards' ? 'products' : 'ids'].keys()];
    return Object.keys(this.held?.[group] ?? {});
  }
  /** R-P646: the part pointers one shard in force lists (read ahead with `prefetchNamed`). */
  async shardPointers(name: string): Promise<ReadonlyMap<string, ResolvedPartPointer>> {
    return this.migrating ? (await this.oneLevelGrouped()).products.get(name) ?? new Map() : this.productShard(name);
  }
  /** R-P646: the owners one id shard in force lists. */
  async idShardOwners(name: string): Promise<ReadonlyMap<string, string>> {
    return this.migrating ? (await this.oneLevelGrouped()).ids.get(name) ?? new Map() : this.idShard(name);
  }
  /** R-P646: read ahead the packed shards or id shards in force of these names. */
  async prefetchNamed(group: 'shards' | 'ids', names: Iterable<string>): Promise<void> { await this.ahead(group, names); }
  /**
   * The index after the edits and the one pack holding every object it placed (nothing written): the parts placed, then
   * — for a load that writes — what it read of the objects stored before packs and the live parts of the one pack it
   * re-homes, then each shard and id shard whose digest moved (or that is re-homed). The manifest's pointers name each
   * object's pack by its row in the pack table, ordered by digest.
   */
  async build(options: { writing?: boolean; sizes?: ReadonlyMap<string, number> } = {}): Promise<BuiltIndex> {
    const held = this.held;
    if (!options.writing || this.migrating || !held?.packs) return this.assemble(options, new Set());
    // The packs to re-home: the table's rows, every pack the edits name that the table does not, and this load's own.
    const rows = held.packs, tabledPacks = new Set(rows.map(row => row.digest)), entering = new Set<string>();
    for (const p of this.pointers.values()) if (p?.address && p.address.pack !== NEW_PACK && !tabledPacks.has(p.address.pack)) entering.add(p.address.pack);
    const planned = compactionVictims(rows, rows.length + entering.size + 1 - PACK_TABLE_CAP);
    if (!planned.length) return this.assemble(options, new Set());
    try { return await this.assemble(options, new Set(planned.map(row => row.digest))); }
    catch (error) {
      if (!(error instanceof PublicationError) || error.code !== 'load_too_large') throw error;
    }
    // R-P646: re-homing never makes a load that fits on its own refuse 413 `load_too_large`. Without the packs it
    // re-homes (refused only where the load itself does not fit), then with as many of them, fewest live bytes first, as
    // the room its own objects leave holds; where even those do not fit, without them.
    const alone = await this.assemble(options, new Set()), room = PACK_MAX_BYTES - (alone.pack?.bytes ?? 0), fitting = new Set<string>();
    let moved = 0;
    for (const row of [...planned].sort((a, b) => a.bytes - b.bytes)) { if (moved + row.bytes > room) break; fitting.add(row.digest); moved += row.bytes; }
    if (!fitting.size) return alone;
    try { return await this.assemble(options, fitting); }
    catch (error) { if (error instanceof PublicationError && error.code === 'load_too_large') return alone; throw error; }
  }
  /** The index after the edits, re-homing the live objects of the packs `victims` names (a writing load only). */
  private async assemble(options: { writing?: boolean; sizes?: ReadonlyMap<string, number> }, victims: ReadonlySet<string>): Promise<BuiltIndex> {
    const held = this.held, tabled = !!held?.packs, pack = new PackWriter();
    // The pack table as the revision in force holds it, and the objects it reaches that are stored before packs.
    const live = new Map<string, { objects: number; bytes: number; size: number }>();
    for (const row of held?.packs ?? []) live.set(row.digest, { objects: row.objects, bytes: row.bytes, size: row.size });
    let legacy = tabled ? held!.legacy ?? 0 : 0;
    if (held && !tabled) {
      // P93's form: every shard, id shard and part is an object of its own.
      for (const p of Object.values(held.shards)) legacy += 1 + p.products;
      legacy += Object.keys(held.ids).length;
    }
    const count = (address: PackAddress | undefined, sign: 1 | -1) => {
      if (!address) { legacy += sign; return; }
      // P98 (C2): a pack outside the table (a stage's) enters it with the size its HEAD answered.
      const row = live.get(address.pack) ?? { objects: 0, bytes: 0, size: options.sizes?.get(address.pack) ?? 0 };
      row.objects += sign; row.bytes += sign * address.bytes; live.set(address.pack, row);
    };
    const pointers = new Map(this.pointers), forced = new Set<string>(), forcedIds = new Set<string>();
    const newly = (at: { at: number; bytes: number }): PackAddress => ({ pack: NEW_PACK, at: at.at, bytes: at.bytes });
    for (const [product, part] of this.placed) {
      const at = await pack.add(part, partTooLarge(product)), pointer = pointers.get(product)!;
      if (at.digest !== pointer.digest) throw tableInconsistent();
      pointers.set(product, { digest: pointer.digest, records: pointer.records, address: newly(at) });
    }
    if (options.writing && !this.migrating) {
      // P98 (LD6, LD8): a load that writes over an index still naming shards or id shards stored before packs reads each
      // of them (once, a bounded number at a time) and moves them into its pack, so the loads after the release leave none.
      if (held && legacy > 0) {
        const ownObjects = (group: Record<string, { digest?: string; pack?: number; at?: number; bytes?: number }>) => Object.keys(group).filter(name => !indexAddress(held, group[name]!));
        await pooled(ownObjects(held.shards), name => this.productShard(name));
        await pooled(ownObjects(held.ids), name => this.idShard(name));
      }
      // P98 (LD8): what this load read of the objects stored before packs moves into its pack, each part keeping its digest.
      for (const [product, part] of this.legacyParts) {
        const now = pointers.has(product) ? pointers.get(product) : await this.pointer(product);
        if (!now || now.address || now.digest !== await documentDigest(part)) continue;
        pointers.set(product, { digest: now.digest, records: now.records, address: newly(await pack.add(part, partTooLarge(product))) });
      }
      for (const name of this.legacyShards) forced.add(name);
      for (const name of this.legacyIdShards) forcedIds.add(name);
      // P98 (LD6): the live objects of the packs re-homed (one the table shows mostly dead; R-P646: those the cap asks for).
      if (tabled && victims.size) {
        const inVictim = (p: { digest?: string; pack?: number; at?: number; bytes?: number }) => { const a = indexAddress(held!, p); return !!a && victims.has(a.pack); };
        for (const [name, p] of Object.entries(held!.shards)) if (inVictim(p)) forced.add(name);
        for (const [name, p] of Object.entries(held!.ids)) if (inVictim(p)) forcedIds.add(name);
        await this.ahead('ids', forcedIds);
        const names = Object.keys(held!.shards).filter(name => !!indexAddress(held!, held!.shards[name]!));
        await this.ahead('shards', names);
        const moving: Array<[string, ResolvedPartPointer]> = [];
        for (const name of names) for (const [product, p] of await this.productShard(name)) if (p.address && victims.has(p.address.pack) && !pointers.has(product)) moving.push([product, p]);
        const read = await readCatalogPacked(this.env, this.scope, moving.map(([, p]) => ({ kind: 'part' as const, digest: p.digest, address: p.address! })));
        for (const [product, p] of moving) {
          const part = read.get(p.digest) as CatalogPart | undefined;
          if (part) pointers.set(product, { digest: p.digest, records: p.records, address: newly(await pack.add(part, partTooLarge(product))) });
        }
      }
    }
    const products = new Map<string, Map<string, ResolvedPartPointer | null>>(), ids = new Map<string, Map<string, string | null>>();
    const into = async <T>(groups: Map<string, Map<string, T>>, key: string, value: T) => {
      const name = await catalogShardName(key), group = groups.get(name) ?? new Map<string, T>();
      group.set(key, value); groups.set(name, group);
    };
    if (this.migrating) {
      for (const [product, pointer] of Object.entries(this.current!.products!)) await into(products, product, { digest: pointer.digest, records: pointer.records } as ResolvedPartPointer | null);
      for (const [id, product] of await this.oneLevel()) await into(ids, id, product as string | null);
    }
    for (const [product, pointer] of pointers) await into(products, product, pointer);
    for (const [id, product] of this.owners) await into(ids, id, product);
    for (const name of forced) if (!products.has(name)) products.set(name, new Map());
    for (const name of forcedIds) if (!ids.has(name)) ids.set(name, new Map());
    const shardPointers = new Map<string, { digest?: string; products: number; records: number; address?: PackAddress }>();
    const idPointers = new Map<string, { digest?: string; records: number; address?: PackAddress }>();
    for (const [name, p] of Object.entries(held?.shards ?? {})) shardPointers.set(name, { digest: p.digest, products: p.products, records: p.records, address: indexAddress(held!, p) });
    for (const [name, p] of Object.entries(held?.ids ?? {})) idPointers.set(name, { digest: p.digest, records: p.records, address: indexAddress(held!, p) });
    for (const name of [...products.keys()].sort()) {
      const before = this.migrating ? new Map<string, ResolvedPartPointer>() : await this.productShard(name), next = new Map(before), old = shardPointers.get(name);
      for (const [product, pointer] of products.get(name)!) { if (pointer) next.set(product, pointer); else next.delete(product); }
      // The shard as stored: each part where it lives, relative to this load's pack (a part in it carries its range alone).
      const others: string[] = [], stored = new Map<string, StoredPartPointer>();
      for (const product of [...next.keys()].sort()) {
        const p = next.get(product)!;
        if (!p.address) stored.set(product, { digest: p.digest, records: p.records });
        else if (p.address.pack === NEW_PACK) stored.set(product, { digest: p.digest, records: p.records, at: p.address.at, bytes: p.address.bytes });
        else {
          let i = others.indexOf(p.address.pack); if (i < 0) i = others.push(p.address.pack) - 1;
          stored.set(product, { digest: p.digest, records: p.records, at: p.address.at, bytes: p.address.bytes, pack: i });
        }
      }
      const built = next.size ? await catalogShardOf(name, stored, others) : null;
      if (built && old && built.pointer.digest === this.shardDigests.get(name) && !forced.has(name)) continue;
      if (old) count(old.address, -1);
      for (const p of before.values()) count(p.address, -1);
      if (!built) { shardPointers.delete(name); continue; }
      for (const p of next.values()) count(p.address, 1);
      const address = newly(await pack.add(built.value));
      count(address, 1);
      shardPointers.set(name, { ...built.pointer, address });
    }
    for (const name of [...ids.keys()].sort()) {
      const next = new Map(this.migrating ? [] : await this.idShard(name)), old = idPointers.get(name);
      for (const [id, product] of ids.get(name)!) { if (product) next.set(id, product); else next.delete(id); }
      const built = next.size ? await catalogIdShardOf(name, next) : null;
      if (built && old && built.pointer.digest === this.idShardDigests.get(name) && !forcedIds.has(name)) continue;
      if (old) count(old.address, -1);
      if (!built) { idPointers.delete(name); continue; }
      const address = newly(await pack.add(built.value));
      count(address, 1);
      idPointers.set(name, { ...built.pointer, address });
    }
    const sealed = await pack.seal();
    if (legacy < 0) throw tableInconsistent();
    /** The table and the pointers, naming this load's pack by the digest it is stored under (R-P646: a fresh one's, `rebase`). */
    const indexNaming = (own: SealedPack | null): CatalogIndex => {
      const rows = new Map<string, { objects: number; bytes: number; size: number }>();
      for (const [digest, row] of live) rows.set(digest, { ...row });
      if (own) {
        const row = rows.get(NEW_PACK)!, same = rows.get(own.digest);
        rows.delete(NEW_PACK);
        rows.set(own.digest, same ? { objects: same.objects + row.objects, bytes: same.bytes + row.bytes, size: own.bytes } : { ...row, size: own.bytes });
      }
      for (const [digest, row] of rows) {
        if (row.objects < 0 || row.bytes < 0 || row.bytes > row.size) throw tableInconsistent();
        if (row.objects === 0) rows.delete(digest);
      }
      const digests = [...rows.keys()].sort();
      const placedFields = (a: PackAddress | undefined) => {
        if (!a) return {};
        const at = digests.indexOf(a.pack === NEW_PACK ? own!.digest : a.pack);
        if (at < 0) throw tableInconsistent();
        return { pack: at, at: a.at, bytes: a.bytes };
      };
      // A pointer into a pack names it by its place (P98: the row, the offset, the length) and the first 128 bits of its
      // digest; one of its own, by its full digest.
      const named = (p: { digest?: string; address?: PackAddress }) => p.address ? { digest: placedDigest(p.digest!), ...placedFields(p.address) } : { digest: p.digest! };
      const shards = Object.fromEntries([...shardPointers.keys()].sort().map(name => {
        const p = shardPointers.get(name)!; return [name, { ...named(p), products: p.products, records: p.records }];
      }));
      const idsOut = Object.fromEntries([...idPointers.keys()].sort().map(name => {
        const p = idPointers.get(name)!; return [name, { ...named(p), records: p.records }];
      }));
      // An index written before packs keeps its form until a load places something in a pack.
      const table = tabled || !!own ? { packs: digests.map(digest => ({ digest, ...rows.get(digest)! })), legacy } : {};
      return { key: 'sha256-hex2', ...table, shards, ids: idsOut };
    };
    return { index: indexNaming(sealed), pack: sealed, rebase: fresh => indexNaming(fresh) };
  }
}
/**
 * P98: store a built index's one pack with the store's exact-create, before the publication reserves the head. A pack
 * already stored with the same bytes is adopted while young (`writePack`, R-P646), and `held` remembers it so the door
 * checks it again once it holds the head (`packReserved`, LD6). Answers the index to publish: the one built, or, where
 * the pack was written under a fresh key, the same index naming that key.
 */
async function writeIndex(env: Env, scope: string, built: BuiltIndex, held?: PackHold): Promise<CatalogIndex> {
  if (!built.pack) return built.index;
  const written = await writePack(env, scope, built.pack);
  if (held) held.written = written;
  return written.pack === built.pack ? built.index : built.rebase(written.pack);
}
/** P98 (LD6): the pack one door wrote or adopted, and (R-P646) what else its publication must still be able to name once it holds the head. */
interface PackHold { written?: WrittenPack; fence?: () => Promise<void> }
/** P98 (LD6, R-P646): once the head holds the door's publication, the fence: its pack (`holdPack`), and whatever else the door names. */
const packReserved = (env: Env, scope: string, held: PackHold) => async () => { if (held.written) await holdPack(env, scope, held.written); await held.fence?.(); };

/**
 * P93: the product whose part holds a record id, checked against that part: the
 * index's entry, where the owner's part (as the caller read it, else read here)
 * still holds the id; none for an id no part holds or an entry no part bears out
 * (a product removed while its part was lost leaves its ids behind; they name
 * nothing). Only ids whose place can change are looked up, so a retitle reads
 * no id shard.
 */
function ownerCheck(edit: IndexEdit, known: ReadonlyMap<string, ReadonlySet<unknown>>, stale: Set<string>) {
  return async (id: string): Promise<string | undefined> => {
    const owner = await edit.owner(id);
    if (owner === undefined) return undefined;
    let holds = known.get(owner)?.has(id);
    if (holds === undefined) {
      const pointer = await edit.pointer(owner);
      holds = !!pointer && ((await edit.part(pointer)).pieces as ContentPiece[]).some(piece => piece.id === id);
    }
    if (!holds) { stale.add(id); return undefined; }
    return owner;
  };
}
/**
 * R-P424: a load that would leave one id in two places is refused 422, naming
 * the id and the products: `record_moved` (a part record the index lists under
 * another product the load does not carry), `id_in_part` (a shared piece whose
 * id a part holds), `id_shared` (a part record whose id a shared piece holds).
 */
interface Collision { code: 'record_moved' | 'id_in_part' | 'id_shared'; message: string }
const quotedId = (v: unknown) => JSON.stringify(String(v)).slice(0, 80);
function collisionRefusal(collisions: readonly Collision[]): PublicationError {
  const shown = collisions.slice(0, 20).map(collision => collision.message).join('; ');
  return new PublicationError(`${shown}${collisions.length > 20 ? `; and ${collisions.length - 20} more` : ''}; an id lives in one place, so nothing was written`, 422, collisions[0]!.code);
}
const movedCollision = (at: string, owner: string, product: string): Collision => ({ code: 'record_moved',
  message: `record_moved: ${at} is a record of product ${quotedId(owner)}'s part and is loaded into product ${quotedId(product)}'s; a record moves between products in a load that carries both products, or once ${quotedId(owner)}'s part no longer holds it` });
const inPartCollision = (at: string, owner: string): Collision => ({ code: 'id_in_part',
  message: `id_in_part: ${at} is a shared piece whose id a record of product ${quotedId(owner)}'s part holds` });
const sharedCollision = (at: string, product: string): Collision => ({ code: 'id_shared',
  message: `id_shared: ${at} is a record of product ${quotedId(product)}'s part whose id a shared piece holds` });

/** The 413 the store raises for the content member's head, named as the manifest's (R-P407 (4)). */
function namedManifest(error: unknown): unknown {
  return error instanceof PublicationError && error.code === 'document_too_large'
    ? new PublicationError('The catalogue manifest is past what one 2 MiB publication holds beside its set (its shared pieces drive it); nothing was written', 413, 'manifest_too_large')
    : error;
}
/**
 * A PUT's catalogue (alone or as a related member), under the vocabulary in
 * effect and, where it declares product slots, routed: its records into their
 * products' parts, its `index` carried exactly as the revision in force holds it
 * (P93; P86's one-level `products` pointers as stored, over a one-level
 * catalogue), each product named in `removeProducts` removed (R-P487 (5)), the
 * shards the PUT changes written beside its parts before the head is reserved.
 */
async function catalogueOverPut(env: Env, scope: string, current: ContentCatalog | undefined, set: PublicationPin, document: unknown, seen?: { manifest: boolean }, held?: PackHold): Promise<unknown> {
  const governed = await governedOver(env, scope, set, document);
  const checked = CONTENT_KIND.validate(governed);
  if (!checked.ok || !checked.value.productSlots) return governed;
  const catalog = checked.value, plan = await partedPutPlan(env, scope, current, catalog, true);
  const manifest = manifestOf(catalog, plan.routed.shared, plan.built.index);
  if (seen) seen.manifest = true;
  manifestCap(manifest, set);
  // P98: the PUT's one pack (its parts, shards and id shards), before the head is reserved.
  const index = await writeIndex(env, scope, plan.built, held);
  return index === plan.built.index ? manifest : { ...manifest, index };
}
/**
 * A PUT's parted document checked against the revision in force, as its write
 * and its validation check it: the index as the revision in force holds it
 * (anything else refused naming the shard), or P86's one-level pointers as
 * stored over a one-level catalogue (where, as there, a product neither pointed
 * at nor sent is removed); `removeProducts` naming products the catalogue holds
 * and the PUT does not also send; the records routed; and (R-P424) no id in two
 * places — a record whose id a product the PUT keeps holds is refused
 * `record_moved`, a newly shared piece whose id such a part holds `id_in_part`
 * (the document's own pieces answer to the validator's one-id rule). Answers the
 * routed records, the parts whose digest moved and the index after the PUT.
 */
async function partedPutPlan(env: Env, scope: string, current: ContentCatalog | undefined, catalog: ContentCatalog, writing = false):
  Promise<{ routed: ReturnType<typeof routedPieces>; changed: Map<string, ContentPiece[]>; built: BuiltIndex }> {
  const errors: string[] = [], held = current?.index;
  if (catalog.index) {
    if (!held && current?.products) errors.push('index: the catalogue in force carries its one-level products index; a PUT carries the index exactly as it reads it');
    // P98: the pack table and the count of objects stored before packs, exactly as the revision in force holds them.
    for (const member of ['packs', 'legacy'] as const) {
      if (JSON.stringify(catalog.index[member] ?? null) !== JSON.stringify(held?.[member] ?? null)) {
        errors.push(`index.${member}: is not the ${member === 'packs' ? 'pack table' : 'count of objects stored before packs'} the revision in force holds; a PUT carries the index exactly as it reads it`);
      }
    }
    for (const group of ['shards', 'ids'] as const) {
      const sent = catalog.index[group] as Record<string, unknown>, stored = (held?.[group] ?? {}) as Record<string, unknown>;
      for (const name of [...new Set([...Object.keys(sent), ...Object.keys(stored)])].sort()) {
        if (JSON.stringify(own(sent, name) ?? null) !== JSON.stringify(own(stored, name) ?? null)) {
          errors.push(`index.${group}['${name.slice(0, 16)}']: is not the shard the revision in force holds; a PUT carries the index exactly as it reads it, a product's records to change its part and removeProducts to remove it`);
        }
      }
    }
  } else if (held && Object.keys(held.shards).length) {
    errors.push('index: the catalogue in force indexes products in shards; a PUT carries the index exactly as it reads it, a product\'s records to change its part and removeProducts to remove it');
  }
  if (catalog.products) {
    if (held) errors.push('products: the catalogue in force is sharded; a PUT carries its index exactly as it reads it');
    else for (const [product, pointer] of Object.entries(catalog.products)) {
      const stored = own(current?.products, product);
      if (!stored || stored.digest !== pointer.digest || stored.records !== pointer.records) {
        errors.push(`products['${product.slice(0, 80)}']: names no part the revision in force holds for that product; a PUT carries a product's pointer only as it reads it, and its records otherwise`);
      }
    }
  }
  const routed = routedPieces(catalog.pieces, catalog.productSlots!);
  errors.push(...routed.errors);
  for (const product of catalog.removeProducts ?? []) {
    if (routed.parts.has(product)) errors.push(`removeProducts: ${quotedId(product)} is removed and sent with records in one PUT; send one or the other`);
  }
  if (errors.length) throw new VocabularyRefusal(errors);
  const edit = new IndexEdit(env, scope, current);
  // P98: the shards of the products the PUT names, each pack's in as few ranged reads as their places allow.
  await edit.prefetchShards([...(catalog.removeProducts ?? []), ...routed.parts.keys()]);
  // The products the PUT removes: by name; and, over a one-level catalogue (P86, R-P409 (2)), each the PUT neither points at nor sends.
  const removed = new Set(catalog.removeProducts ?? []);
  if (current?.products && !catalog.index) {
    for (const product of Object.keys(current.products)) if (!own(catalog.products, product) && !routed.parts.has(product)) removed.add(product);
  }
  const unknown = [...(catalog.removeProducts ?? [])];
  for (const product of unknown) if (!await edit.pointer(product)) errors.push(`removeProducts: ${quotedId(product)} names no product the catalogue in force holds`);
  if (errors.length) throw new VocabularyRefusal(errors);
  // The ids each product the PUT changes holds now (its part as stored; a lost part holds none it can name).
  const known = new Map<string, Set<unknown>>(), lost = new Set<string>();
  const idsOf = async (product: string): Promise<Set<unknown>> => {
    const pointer = await edit.pointer(product);
    if (!pointer) return new Set();
    try { return new Set(((await edit.part(pointer)).pieces as ContentPiece[]).map(piece => piece.id)); }
    catch (error) { if (error instanceof PublicationError && error.code === 'part_unavailable') { lost.add(product); return new Set(); } throw error; }
  };
  // P98: the parts of the products the PUT names, likewise.
  const named = [...removed, ...routed.parts.keys()];
  const before = new Map<string, ResolvedPartPointer | undefined>();
  for (const product of named) before.set(product, await edit.pointer(product));
  await edit.prefetchParts(before.values());
  for (const product of named) known.set(product, await idsOf(product));
  // A removed product whose part is lost names its ids nowhere but the id index in force: they are read from there
  // (every id shard, or P86's one-level index) and dropped with it, so no id is left naming a product that is gone.
  const removedLost = [...lost].filter(product => removed.has(product));
  if (removedLost.length) {
    const owners: Array<ReadonlyMap<string, string>> = current?.index ? await edit.allIdShards() : [await idIndexInForce(env, scope, current)];
    for (const ids of owners) for (const [id, owner] of ids) if (removedLost.includes(owner)) known.get(owner)!.add(id);
  }
  const stale = new Set<string>(), ownerOf = ownerCheck(edit, known, stale);
  const keeps = (owner: string) => !removed.has(owner) && !routed.parts.has(owner);
  const shared = new Set(current?.pieces.map(piece => piece.id) ?? []), slots = new Set(catalog.productSlots), collisions: Collision[] = [];
  for (const [i, piece] of catalog.pieces.entries()) {
    const product = partProductOf(piece, slots);
    if (product === null ? shared.has(piece.id) : known.get(product)?.has(piece.id)) continue;
    const owner = await ownerOf(piece.id);
    if (owner === undefined || owner === product || !keeps(owner)) continue;
    const at = `pieces[${i}] ${quotedId(piece.id)}`;
    collisions.push(product === null ? inPartCollision(at, owner) : movedCollision(at, owner, product));
  }
  if (collisions.length) throw collisionRefusal(collisions);
  // The index's edits: each sent product's pointer where its part's digest moved (only those parts written), each
  // removed product's pointer gone, and the ids whose place changed.
  const after = await partPointers(routed.parts), changed = new Map<string, ContentPiece[]>(), sent = new Set<unknown>();
  for (const pieces of routed.parts.values()) for (const piece of pieces) sent.add(piece.id);
  for (const [product, pieces] of routed.parts) {
    const now = after[product]!;
    if (before.get(product)?.digest !== now.digest) { edit.place(product, { product, pieces }, now); changed.set(product, pieces); }
    for (const piece of pieces) if (!known.get(product)!.has(piece.id)) edit.setOwner(piece.id, product);
  }
  for (const product of removed) edit.setPointer(product, null);
  for (const [product, ids] of known) for (const id of ids) if (typeof id === 'string' && !sent.has(id)) { void product; edit.setOwner(id, null); }
  for (const id of stale) if (!sent.has(id)) edit.setOwner(id, null);
  return { routed, changed, built: await edit.build({ writing }) };
}
/** P93 (R-P487 (6)): the most objects a rollback's existence check reads or heads; P98: a pack counts once, however many objects it holds. */
const ROLLBACK_CHECKS = 900;
const rollbackTooLarge = (count: number) => new PublicationError(`The rollback would check ${count} packs, index shards and parts the revision in force does not name, past the ${ROLLBACK_CHECKS} a rollback checks; nothing was written`, 413, 'rollback_too_large');
/**
 * A rollback's catalogue: the kept revision forward. Its existence check covers
 * what differs from the revision in force (P93, R-P487 (6)): each shard it names
 * that the revision in force does not, and each part pointer inside those that
 * differs — refused 410 `part_missing` naming what the store no longer holds,
 * and 413 `rollback_too_large` past 900 checks. A one-level revision (P86's form)
 * is checked by its parts that differ and its id index, and written sharded.
 *
 * P98 (E25): an object inside a pack is checked by its pack, one HEAD per pack
 * the target's table names that the table in force does not, so a rollback
 * counts packs, not parts: the target's shards are read (each pack's in as few
 * ranged reads as their places allow) only where it still names objects stored
 * before packs, which are checked one by one as before.
 */
async function catalogueOverRollback(env: Env, scope: string, current: ContentCatalog | undefined, set: PublicationPin, value: unknown, n: number, held?: PackHold): Promise<unknown> {
  const target = value && typeof value === 'object' ? value as ContentCatalog : null;
  if (!target || !catalogParted(target)) return governedOver(env, scope, set, value);
  const inForce = new IndexEdit(env, scope, current), missing: string[] = [], parts: Array<[string, string]> = [];
  let checks = 0;
  if (target.index) {
    const index = target.index, inForceIndex = current?.index, identityOf = indexIdentity;
    const shards = Object.entries(index.shards).filter(([name, pointer]) => identityOf(inForceIndex, own(inForceIndex?.shards, name)) !== identityOf(index, pointer));
    const ids = Object.entries(index.ids).filter(([name, pointer]) => identityOf(inForceIndex, own(inForceIndex?.ids, name)) !== identityOf(index, pointer));
    // P98: the packs the target reaches that the revision in force does not (its table's rows, all of them over an
    // index written before packs), each checked by one HEAD.
    const heldPacks = new Set((inForceIndex?.packs ?? []).map(row => row.digest));
    const packs = (index.packs ?? []).map(row => row.digest).filter(pack => !heldPacks.has(pack));
    // The objects stored before packs that differ: their shards and id shards, one HEAD each, and the part pointers
    // inside the differing shards (read only where the target still names objects stored before packs).
    const legacyShards = shards.filter(([, pointer]) => !indexAddress(index, pointer)), legacyIds = ids.filter(([, pointer]) => !indexAddress(index, pointer));
    checks = packs.length + legacyShards.length + legacyIds.length;
    if (checks > ROLLBACK_CHECKS) throw rollbackTooLarge(checks);
    const packHeld = new Map<string, boolean>();
    for (const pack of packs) { packHeld.set(pack, await catalogPackStored(env, scope, pack)); if (!packHeld.get(pack)) missing.push(`pack ${pack}`); }
    if (!index.packs || index.legacy !== 0) {
      const placed: PackedRead[] = [];
      for (const [name, pointer] of shards) { const address = indexAddress(index, pointer); if (address && packHeld.get(address.pack) !== false) placed.push({ kind: 'shard', digest: pointer.digest, name, address }); }
      const read = placed.length ? await readCatalogPacked(env, scope, placed) : new Map<string, unknown>();
      const found: Array<[CatalogShard, PackAddress | undefined]> = [];
      for (const [name, pointer] of shards) {
        const where = indexAddress(index, pointer);
        if (where && packHeld.get(where.pack) === false) continue;
        // The store is the witness of a shard's existence, never this isolate's shard cache: one HEAD each (P98: one per pack).
        if (!where && !await catalogShardStored(env, scope, pointer.digest)) { missing.push(`index shard ${name}`); continue; }
        let shard: CatalogShard;
        try { shard = (read.get(pointer.digest!) as CatalogShard | undefined) ?? await readCatalogShard(env, scope, pointer.digest, where, name, pointer.products); }
        catch (error) { if (error instanceof PublicationError && error.code === 'part_unavailable') { missing.push(`index shard ${name}`); continue; } throw error; }
        found.push([shard, where]);
      }
      await inForce.prefetchShards(found.flatMap(([shard]) => Object.keys(shard.products)));
      for (const [shard, where] of found) for (const [product, part] of Object.entries(shard.products)) {
        if ((await inForce.pointer(product))?.digest === part.digest) continue;
        const address = resolvedPart(shard, where, part).address;
        if (!address) { parts.push([product, part.digest]); continue; }
        if (!packHeld.has(address.pack) && !heldPacks.has(address.pack)) { checks++; packHeld.set(address.pack, await catalogPackStored(env, scope, address.pack)); }
        if (packHeld.get(address.pack) === false) missing.push(JSON.stringify(product));
      }
      checks += parts.length;
      if (checks > ROLLBACK_CHECKS) throw rollbackTooLarge(checks);
    }
    for (const [name, pointer] of legacyIds) if (!await catalogIdShardStored(env, scope, pointer.digest)) missing.push(`id shard ${name}`);
  } else {
    for (const [product, part] of Object.entries(target.products ?? {})) if ((await inForce.pointer(product))?.digest !== part.digest) parts.push([product, part.digest]);
    checks = parts.length + (target.idIndex ? 1 : 0);
    if (checks > ROLLBACK_CHECKS) throw rollbackTooLarge(checks);
    // R-P424: the revision's own id index travels with it, so it must be held too.
    if (target.idIndex && !await catalogIdIndexStored(env, scope, target.idIndex.digest)) missing.push('its id index');
  }
  for (const [product, digest] of parts) if (!await catalogPartStored(env, scope, digest)) missing.push(JSON.stringify(product));
  if (missing.length) {
    throw new PublicationError(`The revision names parts the store no longer holds, so it cannot be rolled forward: ${missing.join(', ')}; nothing was written`, 410, 'part_missing');
  }
  const governed = await governedOver(env, scope, set, value) as ContentCatalog;
  // R-P646: a revision the purge may remove meanwhile is rolled forward as a load of the difference, into this
  // rollback's own pack; any other names what it names, so long as the purge still cannot remove it once the head is
  // held (the fence, else the reservation is abandoned and nothing is written).
  if (!await catalogueRevisionNameable(env, scope, set, n, false)) {
    return manifestOf(governed, governed.pieces, await writeIndex(env, scope, await rollbackOfDifference(env, scope, current, target), held));
  }
  if (held) held.fence = async () => { if (!await catalogueRevisionNameable(env, scope, set, n, true)) throw rollbackPastRetention(n); };
  if (target.index) return governed;
  // P93 (R-P487 (7)): a one-level revision is written sharded, its parts unchanged (P98: its shards in one pack).
  const built = await new IndexEdit(env, scope, target).build();
  return manifestOf(governed, governed.pieces, await writeIndex(env, scope, built, held));
}
/** P98: a pointer names its object by its digest, or by its place in a pack (the pack's digest and its range). */
function indexIdentity(held: CatalogIndex | undefined, pointer: { digest?: string; pack?: number; at?: number; bytes?: number } | undefined): string | undefined {
  if (!held || !pointer) return undefined;
  const address = indexAddress(held, pointer); return address ? placeKey(address) : pointer.digest;
}
const rollbackPastRetention = (n: number) => new PublicationError(`Revision ${n} passed the configuration retention while the rollback ran, so the purge may remove what only it names; nothing was written; a rollback to it made now writes what only that revision names into its own pack`, 409, 'publication_conflict');
/**
 * P98 (LD6, R-P646): a rollback to a revision the purge may remove while it runs (`catalogueRevisionNameable`) names
 * nothing only that revision names. It is published as a load of the difference over the revision in force: each
 * shard and id shard of the target that is not the one in force is read (each pack's in as few ranged reads as their
 * places allow), each part whose digest differs from the one in force read from the target and placed in the
 * rollback's own pack, each product the target lacks removed and each record id whose owner differs set; the shards
 * and id shards those edits touch are rebuilt into the same pack. Every object its revision names is then in force or
 * in its own pack (the fence at `holdPack`).
 */
async function rollbackOfDifference(env: Env, scope: string, current: ContentCatalog | undefined, target: ContentCatalog): Promise<BuiltIndex> {
  const edit = new IndexEdit(env, scope, current), inForce = current?.index, index = target.index;
  const products = new Map<string, Map<string, ResolvedPartPointer>>(), ids = new Map<string, Map<string, string>>();
  if (index) {
    // The target's shards and id shards that are not the ones in force, read where they live.
    const shardNames = Object.keys(index.shards).filter(name => indexIdentity(inForce, own(inForce?.shards, name)) !== indexIdentity(index, index.shards[name]));
    const idNames = Object.keys(index.ids).filter(name => indexIdentity(inForce, own(inForce?.ids, name)) !== indexIdentity(index, index.ids[name]));
    const wanted: PackedRead[] = [];
    for (const name of shardNames) { const p = index.shards[name]!, address = indexAddress(index, p); if (address) wanted.push({ kind: 'shard', digest: p.digest, name, address }); }
    for (const name of idNames) { const p = index.ids[name]!, address = indexAddress(index, p); if (address) wanted.push({ kind: 'idshard', digest: p.digest, name, address }); }
    const read = wanted.length ? await readCatalogPacked(env, scope, wanted) : new Map<string, unknown>();
    for (const name of shardNames) {
      const p = index.shards[name]!, where = indexAddress(index, p);
      const shard = (read.get(p.digest!) as CatalogShard | undefined) ?? await readCatalogShard(env, scope, p.digest, where, name, p.products);
      products.set(name, new Map(Object.entries(shard.products).map(([product, part]) => [product, resolvedPart(shard, where, part)])));
    }
    for (const name of idNames) {
      const p = index.ids[name]!, where = indexAddress(index, p);
      const shard = (read.get(p.digest!) as CatalogIdShard | undefined) ?? await readCatalogIdShard(env, scope, p.digest, where, name);
      ids.set(name, new Map(Object.entries(shard.ids)));
    }
    for (const name of await edit.namesInForce('shards')) if (!Object.hasOwn(index.shards, name)) products.set(name, new Map());
    for (const name of await edit.namesInForce('ids')) if (!Object.hasOwn(index.ids, name)) ids.set(name, new Map());
  } else {
    // A one-level target (P86's form): its parts are its own objects, its ids its id index.
    for (const [product, p] of Object.entries(target.products ?? {})) {
      const name = await catalogShardName(product), group = products.get(name) ?? new Map<string, ResolvedPartPointer>();
      group.set(product, { digest: p.digest, records: p.records }); products.set(name, group);
    }
    for (const [id, product] of await idIndexInForce(env, scope, target)) {
      const name = await catalogShardName(id), group = ids.get(name) ?? new Map<string, string>();
      group.set(id, product); ids.set(name, group);
    }
    for (const name of await edit.namesInForce('shards')) if (!products.has(name)) products.set(name, new Map());
    for (const name of await edit.namesInForce('ids')) if (!ids.has(name)) ids.set(name, new Map());
  }
  // Each product whose part differs, placed from the target; each the target lacks, removed.
  await edit.prefetchNamed('shards', products.keys());
  const differing: Array<[string, ResolvedPartPointer]> = [];
  for (const [name, wantedParts] of products) {
    const held = await edit.shardPointers(name);
    for (const [product, p] of wantedParts) if (held.get(product)?.digest !== p.digest) differing.push([product, p]);
    for (const product of held.keys()) if (!wantedParts.has(product)) edit.setPointer(product, null);
  }
  const packed = differing.flatMap(([, p]) => p.address ? [{ kind: 'part' as const, digest: p.digest, address: p.address }] : []);
  const parts = packed.length ? await readCatalogPacked(env, scope, packed) : new Map<string, unknown>();
  for (const [product, p] of differing) {
    const part = (parts.get(p.digest) as CatalogPart | undefined) ?? await readCatalogPart(env, scope, p.digest, p.address);
    edit.place(product, part, { digest: p.digest, records: p.records });
  }
  // Each record id whose owner differs, set; each the target lacks, removed.
  await edit.prefetchNamed('ids', ids.keys());
  for (const [name, owners] of ids) {
    const held = await edit.idShardOwners(name);
    for (const [id, product] of owners) if (held.get(id) !== product) edit.setOwner(id, product);
    for (const id of held.keys()) if (!owners.has(id)) edit.setOwner(id, null);
  }
  return edit.build({ writing: true });
}

/**
 * W32 E1.01 (F32 §2.4-§2.6, §4 item 8, §6.2): the size of the document this
 * answer carries, against the ceiling it is stored under.
 *
 * F32's finding is that a merchandiser could only discover the publication
 * ceiling by hitting it — the document grows, a publish is refused, and nothing
 * before that moment said how close it was. The read every operator surface
 * already makes now answers the two numbers that make the refusal predictable,
 * beside `diagnostics` rather than inside it, because `diagnostics` is the
 * catalog's own validation report and its key set is a contract of its own
 * (`src/routes/content.test.ts:466`).
 *
 * It is a SIBLING of the document and never part of it: it is derived from the
 * document on the way out, so nothing here can reach a stored body.
 *
 * `bytes` is the canonical length the ceiling is charged against, so it is the
 * same number the refusal would use. The serialization is the one this answer
 * is about to perform anyway, so the read costs no new order of work, and it
 * cannot fail this read: a document whose shape `documentBytes` refuses to
 * canonicalize would never have been stored, and if one ever is, the member is
 * absent and the document still reads.
 */
function documentEnvelopeOf(kind: DocumentKind<unknown>, value: unknown): { envelope?: DocumentEnvelope } {
  try {
    // P86: a manifest's pieces are its shared pieces and every part's records; `products` the index's size.
    const catalog = kind.name === CONTENT_KIND.name && value !== null && typeof value === 'object' && Array.isArray((value as ContentCatalog).pieces) ? value as ContentCatalog : null;
    const pieces = catalog ? { pieces: catalogPieceCount(catalog), ...(catalogParted(catalog) ? { products: catalogProductCount(catalog) } : {}) } : {};
    return { envelope: { ...pieces, bytes: documentBytes(value), limitBytes: PUBLICATION_MAX_BYTES } };
  } catch { return {}; }
}
function inputCollection(kind: string, candidate: unknown): void {
  if (candidate && typeof candidate === 'object') {
    const body = candidate as Record<string, unknown>;
    if (kind === 'content') inputRecords(body.pieces);
    if (kind === 'prior') inputRecords(body.rows);
  }
}
/**
 * W25 Z1.01 (F20 §1.5): the unit a prior is in, against the unit its slot learns
 * in, at the door a data scientist actually imports through.
 *
 * `p_prior` is a probability; a slot whose objective is money does not learn one.
 * The objective comes from the tenant's own published learning document, never
 * from a compiled list of slots, so the check holds for any tenant's vocabulary.
 * A document whose rows do not validate is left to the validator that already
 * names them; only a document that would otherwise be ACCEPTED is refused here.
 *
 * Fail closed: if the learning document cannot be read, the prior cannot be
 * checked against the unit its slot learns in, and the import is refused rather
 * than published unchecked. An absent learning document is not an unreadable
 * one — the compiled default learns in units, and the import proceeds.
 *
 * P36 fix round 1 (R-P54): the learning document is the one the same request
 * publishes when it carries one (`learnCandidate`: the primary document or a
 * `publicationChanges` member of the learn kind, `requestLearnDocument`), so a
 * prior is read under the grammar and the objectives the tenant reads it under
 * once the request is published; otherwise the one in force. A learn member its
 * own validator refuses is left to that validator, which refuses the whole
 * request, so nothing is written either way.
 */
async function priorUnitRefusals(c: Context<Ctx>, scope: string, candidate: unknown, learnCandidate?: unknown): Promise<{ errors: string[]; status: 422 | 503 } | null> {
  const valid = PRIORS_KIND.validate(candidate);
  // P36: a document that declares the grammar it was exported under is checked
  // against the tenant's grammar in force, so it is read whether or not the
  // store's own validator admits it; a row error in an undeclared document is
  // left to that validator, as before.
  const declares = candidate !== null && typeof candidate === 'object' && !Array.isArray(candidate)
    && (candidate as Record<string, unknown>).cellGrammar !== undefined;
  if (!valid.ok && !declares) return null;
  let learn: LearnConfig;
  if (learnCandidate !== undefined) {
    const checked = LEARN_KIND.validate(learnCandidate);
    if (!checked.ok) return null;
    learn = checked.value;
  } else {
    try { learn = (await readPublication(c.env, LEARN_KIND, scope))?.value ?? DEFAULT_LEARN; }
    catch { return { status: 503, errors: ['learn: the learning document is unavailable, so a prior cannot be checked against the unit its slot learns in'] }; }
  }
  // P36 (R-P46, W25): the cell grammar follows the tenant's published context
  // vocabulary — today's grammar for a tenant without the settings — and a file
  // exported under another one is refused by name, with the re-export named.
  const tenant = validatePriors(candidate, cellGrammarFor(learn.contextVocabulary));
  if (!tenant.ok) return { status: 422, errors: tenant.errors };
  const errors = priorUnitErrors(tenant.value, (slot) => learn.slots?.[slot]?.objective ?? 'unit');
  return errors.length ? { status: 422, errors } : null;
}

/**
 * P36 fix round 1 (R-P54): the learn document one PUT publishes — the primary
 * document, or else the first `publicationChanges` member whose kind `kindOf`
 * resolves to the learn kind (`learn`, `Learn`, `LEARN` are one kind) — or
 * undefined when the request publishes none, so the learn document in force
 * applies. A malformed member is skipped here; the member loop refuses it.
 */
function requestLearnDocument(primary: DocumentKind<unknown>, candidate: unknown, related: unknown): unknown {
  if (primary.name === LEARN_KIND.name) return candidate;
  if (!Array.isArray(related)) return undefined;
  for (const entry of related as unknown[]) {
    if (!entry || typeof entry !== 'object') continue;
    const { kind, document } = entry as { kind?: unknown; document?: unknown };
    if (typeof kind === 'string' && kindOf(kind)?.kind.name === LEARN_KIND.name) return document;
  }
  return undefined;
}

/**
 * P84 (E8, R-P359 Q4): a carousel's shot orders name `contentType` values. Where
 * the vocabulary in effect governs `contentType` (P38), each value must be one
 * of its ids, the form every governed catalogue tag is stored in, so a shot type
 * the images cannot carry is refused 422 naming the order, the position and the
 * value; where none governs it the values stand as the slot validator bounds
 * them, never checked against the catalogue's current values. A document naming
 * no shot order is never touched: no read is made for it. Fail closed: a
 * vocabulary that cannot be read refuses the publication 503.
 */
async function shotVocabularyRefusals(env: Env, scope: string, slotsCandidate: unknown): Promise<{ errors: string[]; status: 422 | 503 } | null> {
  const named: Array<{ at: string; value: string }> = [];
  const pages = slotsCandidate && typeof slotsCandidate === 'object' ? (slotsCandidate as { pages?: unknown }).pages : undefined;
  if (pages && typeof pages === 'object' && !Array.isArray(pages)) for (const [page, list] of Object.entries(pages as Record<string, unknown>)) {
    if (!Array.isArray(list)) continue;
    list.forEach((slot: unknown, i) => {
      const orders = slot && typeof slot === 'object' ? (slot as { shotOrders?: unknown }).shotOrders : undefined;
      if (!Array.isArray(orders)) return;
      orders.forEach((order: unknown, k) => {
        const values = order && typeof order === 'object' ? (order as { order?: unknown }).order : undefined;
        if (Array.isArray(values)) values.forEach((value: unknown, j) => { if (typeof value === 'string') named.push({ at: `pages.${page}[${i}].shotOrders[${k}].order[${j}]`, value }); });
      });
    });
  }
  if (!named.length) return null;
  let approval: Awaited<ReturnType<typeof vocabularyState>>['approval'];
  try { approval = (await vocabularyState(env, scope)).approval; }
  catch { return { status: 503, errors: ['vocabulary: the vocabulary in effect is unavailable, so the contentType values this slots document\'s shot orders name cannot be checked against it'] }; }
  const attribute = approval ? vocabularyTableOf(approval.value).attributes.get('contentType') : undefined;
  if (!approval || !attribute) return null;
  const revision = approval.value.revision, ids = [...attribute.ids], offered = `${ids.slice(0, 8).join(' | ')}${ids.length > 8 ? ` | … (${ids.length} ids)` : ''}`;
  const errors = named.filter(({ value }) => !attribute.ids.has(value)).map(({ at, value }) => {
    const id = attribute.words.get(value);
    return `${at}: ${JSON.stringify(value)} is outside the vocabulary in effect (revision ${revision}) for contentType; ${id === undefined ? `name one of its ids (${offered})` : `it is a synonym of ${JSON.stringify(id)}, and a shot order names the id`}`;
  });
  return errors.length ? { status: 422, errors } : null;
}

/**
 * P36 (R-P46): a slots document that names what a tenant's context vocabulary
 * decides — a seed rule on the channel, the source platform or the landing-page
 * type, or a per-context order's channel and visit buckets — is checked against
 * the tenant's own vocabulary: its channel ids, the names of its published cut,
 * its source platforms and landing-page types, or today's six words and
 * buckets for a tenant without the settings, every refusal worded as the
 * validator words it. The learn document is the one published with it in the
 * same request when there is one, otherwise the one in force. A slots document
 * naming none of these is never touched: no read is made for it. Fail closed: a
 * learn document that cannot be read refuses the publication.
 */
async function vocabularyRefusals(c: Context<Ctx>, scope: string, slotsCandidate: unknown, learnCandidate?: unknown): Promise<{ errors: string[]; status: 422 | 503 } | null> {
  const shots = await shotVocabularyRefusals(c.env, scope, slotsCandidate);
  if (shots) return shots;
  if (!slotsNameContext(slotsCandidate)) return null;
  let learn: LearnConfig;
  if (learnCandidate !== undefined) {
    const checked = LEARN_KIND.validate(learnCandidate);
    if (!checked.ok) return null;
    learn = checked.value;
  } else {
    try { learn = (await readPublication(c.env, LEARN_KIND, scope))?.value ?? DEFAULT_LEARN; }
    catch { return { status: 503, errors: ['learn: the learning document is unavailable, so the channels, visit buckets, source platforms and landing-page types this slots document names cannot be checked against the tenant\'s context vocabulary'] }; }
  }
  const checked = validateSlotCatalog(slotsCandidate, contextTermsOf(learn.contextVocabulary));
  return checked.ok ? null : { status: 422, errors: checked.errors };
}

/**
 * P31 (R-P59 (4)): a catalogue whose eligibility rules name an entry channel or
 * a visit bucket — the words a tenant's context vocabulary decides — is checked
 * at the door against the tenant's channel ids and the names of its
 * visit-bucket cut in force (P36), or today's six channel words and 1, 2-3, 4+
 * for a tenant without the settings, every refusal worded as the validator
 * words it, as P36's slots door checks seeds and orders. The learn document is
 * the one published with it in the same request when there is one, otherwise
 * the one in force. A catalogue naming neither word is never touched: no read
 * is made for it. Fail closed: a learn document that cannot be read refuses the
 * publication. The publication store, which holds no tenant, reads the words by
 * their grammar alone, and a retained catalogue by the grammar of the rule.
 */
async function catalogueVocabularyRefusals(c: Context<Ctx>, scope: string, catalogCandidate: unknown, learnCandidate?: unknown): Promise<{ errors: string[]; status: 422 | 503 } | null> {
  if (!catalogNamesRuleWords(catalogCandidate)) return null;
  let learn: LearnConfig;
  if (learnCandidate !== undefined) {
    const checked = LEARN_KIND.validate(learnCandidate);
    if (!checked.ok) return null;
    learn = checked.value;
  } else {
    try { learn = (await readPublication(c.env, LEARN_KIND, scope))?.value ?? DEFAULT_LEARN; }
    catch { return { status: 503, errors: ['learn: the learning document is unavailable, so the entry channels and visit buckets this catalogue\'s eligibility rules name cannot be checked against the tenant\'s context vocabulary'] }; }
  }
  const errors = catalogRuleErrors(catalogCandidate, contextTermsOf(learn.contextVocabulary));
  return errors.length ? { status: 422, errors } : null;
}
/** P31 (R-P59 (4)): every catalogue member one request publishes, against the learn member it publishes or else the learn document in force. */
async function requestCatalogueVocabularyRefusals(c: Context<Ctx>, scope: string, members: readonly PublishedMember[]): Promise<{ errors: string[]; status: 422 | 503 } | null> {
  const learn = members.find(member => member.kind.name === LEARN_KIND.name)?.document;
  const errors: string[] = [];
  for (const member of members) {
    if (member.kind.name !== CONTENT_KIND.name) continue;
    const refused = await catalogueVocabularyRefusals(c, scope, member.document, learn);
    if (!refused) continue;
    const named = member.at === null ? refused.errors : refused.errors.map(error => `${member.at}: ${error}`);
    if (refused.status === 503) return { status: 503, errors: named };
    errors.push(...named);
  }
  return errors.length ? { status: 422, errors } : null;
}

/**
 * P01 (O5, R-P24): an order names modules, and only the catalogue says which
 * modules exist, so the refusal of an order naming a module the catalogue does
 * not register for its slot — or one the slot's tag and type gates refuse — is
 * made here, beside the prior check above, where both documents are at hand.
 * A slot document without orders is never touched: no read is made for it.
 * The catalogue is the one published with it in the same request when there is
 * one, otherwise the catalogue in force. Fail closed: a catalogue that cannot
 * be read refuses the publication rather than publishing an unchecked order;
 * an absent catalogue registers no module.
 *
 * P26 (NC5, R-P24): the same check, at the same door and against the same
 * catalogue, refuses a declared layout slot's `inner` key naming a module the
 * catalogue does not define as a candidate of that layout slot (no piece has
 * the id, or the piece does not name the slot in its `slotTypes`), by name
 * (`pages.{page}[i].inner['…']`). A slots document with neither orders nor
 * inner content slots is never touched: no read is made for it.
 */
async function orderRefusals(c: Context<Ctx>, scope: string, slotsCandidate: unknown, catalogCandidate?: unknown): Promise<{ errors: string[]; status: 422 | 503 } | null> {
  const valid = SLOTS_KIND.validate(slotsCandidate);
  // P26 (NC5, R-P24): a layout slot's inner content slots name modules too, so they are checked here as well.
  const ordered = valid.ok && Object.values(valid.value.pages).some(slots => slots.some(slot => slot.orders?.length));
  const nested = valid.ok && Object.values(valid.value.pages).some(slots => slots.some(slot => slot.layout === true && slot.inner));
  if (!valid.ok || (!ordered && !nested)) return null;
  let catalog: ContentCatalog;
  if (catalogCandidate !== undefined) {
    const checked = CONTENT_KIND.validate(catalogCandidate);
    if (!checked.ok) return null;
    catalog = checked.value;
  } else {
    try { catalog = (await readPublication(c.env, CONTENT_KIND, scope))?.value ?? EMPTY_CATALOG; }
    catch {
      return { status: 503, errors: [...(ordered ? ['catalog: the content catalogue is unavailable, so a per-context order cannot be checked against the modules it registers'] : []),
        ...(nested ? ['catalog: the content catalogue is unavailable, so a module\'s inner content slot (inner) cannot be checked against the modules it registers'] : [])] };
    }
  }
  const errors = [...(ordered ? slotOrderCatalogueErrors(valid.value, catalog) : []), ...(nested ? slotInnerCatalogueErrors(valid.value, catalog) : [])];
  return errors.length ? { status: 422, errors } : null;
}
/**
 * P01 fix round 1 (R-P24, the lead's ruling): EVERY slots document one request
 * publishes — the primary document or a related member, its kind resolved as
 * `kindOf` resolves every kind (so `slots`, `Slots` and `SLOTS` are one kind),
 * whatever the primary is — is checked against the catalogue the same request
 * publishes (the primary, or a related member of the catalogue kind in any case
 * of the word), or else the catalogue in force. A refusal of a related member
 * names it (`publicationChanges[i]`) before the validator's own path and refuses
 * the whole request, so no member of it is written.
 */
interface PublishedMember { kind: DocumentKind<unknown>; document: unknown; at: string | null }
/** P36: every slots member one request publishes, against the learn member it publishes or else the learn document in force. */
async function requestVocabularyRefusals(c: Context<Ctx>, scope: string, members: readonly PublishedMember[]): Promise<{ errors: string[]; status: 422 | 503 } | null> {
  const learn = members.find(member => member.kind.name === LEARN_KIND.name)?.document;
  const errors: string[] = [];
  for (const member of members) {
    if (member.kind.name !== SLOTS_KIND.name) continue;
    const refused = await vocabularyRefusals(c, scope, member.document, learn);
    if (!refused) continue;
    const named = member.at === null ? refused.errors : refused.errors.map(error => `${member.at}: ${error}`);
    if (refused.status === 503) return { status: 503, errors: named };
    errors.push(...named);
  }
  return errors.length ? { status: 422, errors } : null;
}
async function requestOrderRefusals(c: Context<Ctx>, scope: string, members: readonly PublishedMember[]): Promise<{ errors: string[]; status: 422 | 503 } | null> {
  const catalogue = members.find(member => member.kind.name === CONTENT_KIND.name)?.document;
  const errors: string[] = [];
  for (const member of members) {
    if (member.kind.name !== SLOTS_KIND.name) continue;
    const refused = await orderRefusals(c, scope, member.document, catalogue);
    if (!refused) continue;
    const named = member.at === null ? refused.errors : refused.errors.map(error => `${member.at}: ${error}`);
    if (refused.status === 503) return { status: 503, errors: named };
    errors.push(...named);
  }
  return errors.length ? { status: 422, errors } : null;
}

/**
 * P28 (decision D1, R-P31): a learn document's layout-blend opt-in is published
 * only on a page's declared layout slot, and only the slots document says which
 * slot that is, so the refusal is made here, on the pattern of the order check
 * above: EVERY learn document one request publishes — the primary document or a
 * related member, its kind resolved as `kindOf` resolves every kind — whose
 * dials carry a blend is checked against the slots document the same request
 * publishes (the primary, or a related member of the slots kind in any case of
 * the word), or else the one in force. P05 (R-P61): a learn document whose dials
 * name the adjacent-swap mode or the position-normalisation switch is checked
 * the same way (`learnPositionLayoutErrors`). A learn document with none of the
 * three is never touched: no read is made for it. A refusal of a related member names it
 * (`publicationChanges[i]`) and refuses the whole request, so no member of it is
 * written. Fail closed: a slots document that cannot be read refuses the
 * publication rather than publishing an unchecked opt-in; an absent one
 * declares no layout slot.
 */
async function blendRefusals(c: Context<Ctx>, scope: string, learnCandidate: unknown, slotsCandidate?: unknown): Promise<{ errors: string[]; status: 422 | 503 } | null> {
  const valid = LEARN_KIND.validate(learnCandidate);
  // P05 (R-P61): the adjacent-swap mode and the position-normalisation switch
  // are checked against the page's declared layout slot exactly as the blend is.
  if (!valid.ok || !(Object.values(valid.value.slots ?? {}).some(dials => dials.blend !== undefined) || namesPositionDials(valid.value))) return null;
  let slots: SlotCatalog;
  if (slotsCandidate !== undefined) {
    const checked = SLOTS_KIND.validate(slotsCandidate);
    if (!checked.ok) return null;
    slots = checked.value;
  } else {
    try { slots = (await readPublication(c.env, SLOTS_KIND, scope))?.value ?? { pages: {} }; }
    catch { return { status: 503, errors: ['slots: the slots document is unavailable, so a layout blend or an adjacent swap cannot be checked against the page\'s declared layout slot'] }; }
  }
  const errors = [...learnBlendLayoutErrors(valid.value, slots), ...learnPositionLayoutErrors(valid.value, slots)];
  return errors.length ? { status: 422, errors } : null;
}
async function requestBlendRefusals(c: Context<Ctx>, scope: string, members: readonly PublishedMember[]): Promise<{ errors: string[]; status: 422 | 503 } | null> {
  const slotsDocument = members.find(member => member.kind.name === SLOTS_KIND.name)?.document;
  const errors: string[] = [];
  for (const member of members) {
    if (member.kind.name !== LEARN_KIND.name) continue;
    const refused = await blendRefusals(c, scope, member.document, slotsDocument);
    if (!refused) continue;
    const named = member.at === null ? refused.errors : refused.errors.map(error => `${member.at}: ${error}`);
    if (refused.status === 503) return { status: 503, errors: named };
    errors.push(...named);
  }
  return errors.length ? { status: 422, errors } : null;
}

function catalogScope(c: Context<Ctx>): string {
  const tenant = c.get('tenant'), user = c.get('auth')?.user;
  if (!user || (user.type !== 'access' && user.type !== 'service')) throw new PublicationError('Typed access or service credential required', 401, 'operator_required');
  if (!isValidTenantId(tenant) || !hasOperatorGrant(c.env, user.sub, tenant, c.get('auth'))) throw new PublicationError('Operator tenant authority unavailable', 403, 'tenant_unavailable');
  for (const key of ['tenant', 'scope']) {
    const values = c.req.queries(key);
    if (values && (values.length !== 1 || values[0] !== tenant)) throw new PublicationError('Tenant scope unavailable', 403, 'tenant_unavailable');
  }
  return tenant;
}
function scopeOf(c: Context<Ctx>, _kind?: DocumentKind<unknown>): string { void _kind; return catalogScope(c); }
/** The slot document's own canonical catalog tenant, for the advisory channels that read the catalogue. */
const slotCatalogTenant = (c: Context<Ctx>, scope: string) => () => {
  const tenant = catalogScope(c);
  if (scope !== tenant) throw new Error('Unbound slot scope');
  return tenant;
};
function pinDiagnosticsFor(c: Context<Ctx>, scope: string, slots: SlotCatalog | null, revision: number | null) {
  return slotDiagnostics(c.env, slots, revision, slotCatalogTenant(c, scope));
}
/**
 * P41 (R-P78): the learn publication's advisory channel, for the success
 * answers of `PUT /content/learn` and `POST /content/learn/validate`, and
 * (P52) for the current read `GET /content/learn`, as its last member: a
 * `diagnostics` member only when a slot's conversion table does not name the
 * slot's own reward, so every other answer is the bytes it was. Computed from
 * the document the answer carries, with no further read and nothing stored;
 * advice, never a refusal, and never able to turn an accepted or committed
 * publication, or a read, into a failure. The history and revision reads never
 * carry it.
 */
function learnAdvisory(kind: DocumentKind<unknown>, document: unknown): { diagnostics?: LearnConversionDiagnostics } {
  if (kind.name !== LEARN_KIND.name) return {};
  try {
    const diagnostics = learnConversionDiagnostics(document as LearnConfig);
    return diagnostics ? { diagnostics } : {};
  } catch { return {}; }
}
/**
 * The records a direct publication submitted, for the advisory channel alone.
 * A direct PUT is never routed through the import normalizer (F27 §4.2), so the
 * field set it is read against is the validator's own closed one: a name
 * outside it reaches no stored piece and is named rather than lost in silence.
 */
function submittedPieces(candidate: unknown): unknown[] {
  const pieces = (candidate as { pieces?: unknown } | null | undefined)?.pieces;
  return Array.isArray(pieces) ? pieces : [];
}
/**
 * The fields a direct publication's body carries BESIDE its catalogue: the
 * `document` it wraps the catalogue in, the `note` the write is attributed with
 * and the `publicationChanges` it publishes together. They are how the request
 * is carried, so when a body IS its own document they are still envelope and are
 * never named as keys the catalogue lost.
 */
const REQUEST_ENVELOPE_FIELDS = ['document', 'note', 'publicationChanges'] as const;
const publishedRequest = (candidate: unknown, envelope: readonly string[] = []) =>
  ({ records: submittedPieces(candidate), accepted: PIECE_FIELDS,
    document: { value: candidate, accepted: catalogDocumentFields(...envelope) } });

/**
 * The catalogue's authored version label, carried across a partial import so a
 * customer's own label survives a refresh that says nothing about it. The
 * compiled default's sentinel is not an authored label: a catalogue that has
 * been written is no longer the empty one, so carrying it would leave every
 * later revision stamped `content-empty+rN` on the feed paths while the same
 * catalogue published directly is stamped `content+rN` by the kind's own
 * `stampLabel` root. One contract, one label.
 */
function carriedVersion(current: ContentCatalog): string | undefined {
  const root = (current.version ?? '').replace(/\+r\d+$/, '');
  return root && root !== EMPTY_CATALOG.version ? current.version : undefined;
}

/**
 * How many stored pieces one write created or altered, from the stored values
 * themselves rather than from the feed's row count: a refresh that carries the
 * catalogue back unchanged reports none. A piece the operation removed is
 * neither created nor altered and is not counted here.
 */
function changedPieces(before: ContentCatalog, after: ContentCatalog): number {
  const previous = new Map(before.pieces.map((piece: ContentPiece) => [piece.id, sortedJson(piece)]));
  let changed = 0;
  for (const piece of after.pieces) if (previous.get(piece.id) !== sortedJson(piece)) changed++;
  return changed;
}
/**
 * P98 (E25, LD5): a piece's value as JSON with every object's keys in sorted order, so two equal pieces compare equal
 * whatever order their fields were written or read back in: a stored part reads back in canonical key order on a fresh
 * isolate, where the isolate that validated it holds the validator's order (live: one retitle counted 1,199 changed).
 */
function sortedJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => v && typeof v === 'object' && !Array.isArray(v)
    ? Object.fromEntries(Object.keys(v as Record<string, unknown>).sort().map(k => [k, (v as Record<string, unknown>)[k]])) : v);
}

/**
 * How many stored pieces one write removed: the ids the catalogue held before
 * and no longer holds. A replace that drops two of three pieces changed nothing
 * about the third, so without this the answer would say nothing about the two
 * that are gone. A merge is a partial upsert by id and removes none, and says so
 * with a zero rather than with an absence.
 */
function removedPieces(before: ContentCatalog, after: ContentCatalog): number {
  const kept = new Set(after.pieces.map((piece: ContentPiece) => piece.id));
  let removed = 0;
  for (const piece of before.pieces) if (!kept.has(piece.id)) removed++;
  return removed;
}

function actorOf(c: { get: (k: 'auth') => AuthContext | undefined }): string {
  return c.get('auth')?.user?.sub ?? c.get('auth')?.user?.email ?? 'unknown';
}
const noteOf = (v: unknown) => (typeof v === 'string' ? v.slice(0, 500) : '');
function catalogMeta(c: Context<Ctx>, note?: string, creation = false, headers: Headers = c.req.raw.headers): WriteMeta {
  const meta = publicationMeta(headers, actorOf(c), note, creation);
  meta.authorize = async () => {
    let allowed = false;
    await operatorJwt()(c, async () => {
      catalogScope(c); const user = c.get('auth').user;
      if (user?.sub !== meta.actor || !Number.isSafeInteger(user.exp) || user.exp! * 1000 <= Date.now()) throw new PublicationError('Current operator authority required', 403, 'operator_required');
      allowed = true;
    });
    if (!allowed) throw new PublicationError('Current operator authority required', 403, 'operator_required');
  };
  return meta;
}

// Supplied design-time proposals use canonical tenant authority in EVERY mode.
// The outer JWT middleware has already checked actual access sessions/accounts.
const enrichmentRoutes = new Hono<Ctx>();
enrichmentRoutes.use('*', async (c, next) => {
  const tenant = c.get('tenant'), user = c.get('auth')?.user;
  if (!user || (user.type !== 'access' && user.type !== 'service')) return c.json({ error: 'Typed access or service credential required' }, 401);
  if (!isValidTenantId(tenant) || !hasOperatorGrant(c.env, user.sub, tenant, c.get('auth'))) return c.json({ error: 'Operator tenant authority unavailable' }, 403);
  for (const key of ['tenant', 'scope']) {
    const values = c.req.queries(key);
    if (values && (values.length !== 1 || values[0] !== tenant)) return c.json({ error: 'Tenant scope unavailable' }, 403);
  }
  return next();
});
/**
 * W38 B2: an enrichment body is admitted by the byte budget every other
 * consuming route applies (W38.04), counted on the bytes actually delivered and
 * refused BY NAME — 413 `input_budget_exceeded` with its budget, limit and
 * observed count — before the proposal reader, storage or any model sees it.
 * The admitted bytes then reach the enrichment reader unchanged, so its own
 * content-type, strict UTF-8 and JSON rules still decide everything else.
 */
async function enrichmentBody(request: Request): Promise<unknown> {
  const body = request.body === null ? null : await readInputBytes(request.body), type = request.headers.get('Content-Type');
  return readEnrichmentBody(new Request(request.url, { method: request.method, headers: type === null ? {} : { 'Content-Type': type }, body }));
}
async function enrichmentResult(c: Context<Ctx>, operation: () => Promise<object>, status: 200 | 201 = 200) {
  try { return c.json(await operation(), status); }
  catch (error) {
    if (error instanceof InputError) return inputRefusal(c, error);
    if (error instanceof ConnectorUnavailable) return c.json({ ok: false, error: 'Enrichment generation unavailable', code: error.code }, error.code === 'conflict' ? 409 : 503);
    if (error instanceof PublicationError) return c.json({ ok: false, error: error.message, code: error.code }, error.status);
    return error instanceof EnrichmentError ? c.json({ error: error.message, ...(error.proposalId ? { proposalId: error.proposalId } : {}) }, error.status)
      : c.json({ error: 'Enrichment storage unavailable' }, 503);
  }
}
enrichmentRoutes.post('/', c => enrichmentResult(c, async () => {
  const input = await enrichmentBody(c.req.raw), user = c.get('auth').user!;
  const proposal = await captureEnrichment(c.env.STORAGE, c.get('tenant'), user.sub, user.type as 'access' | 'service', input);
  return { status: 'pending', published: false, proposal, review: null };
}, 201));
enrichmentRoutes.post('/generate', c => enrichmentResult(c, async () => {
  const input = await enrichmentBody(c.req.raw), user = c.get('auth').user!, actor = user.sub;
  const authorize = async () => {
    let allowed = false;
    await operatorJwt()(c, async () => {
      const current = c.get('auth').user;
      if (catalogScope(c) !== c.get('tenant') || current?.sub !== actor || current.type !== user.type
        || !Number.isSafeInteger(current.exp) || current.exp! * 1000 <= Date.now()) throw new ConnectorUnavailable('policy');
      allowed = true;
    });
    if (!allowed) throw new ConnectorUnavailable('policy');
  };
  const proposal = await generateEnrichment(c.env, c.get('tenant'), actor, user.type as 'access' | 'service', input, authorize);
  return { status: 'pending', published: false, proposal, review: null };
}, 201));
enrichmentRoutes.get('/:id', c => enrichmentResult(c, () => readEnrichment(c.env.STORAGE, c.get('tenant'), c.req.param('id'))));
enrichmentRoutes.post('/:id/review', c => {
  const user = c.get('auth').user!;
  if (user.type !== 'access') return c.json({ error: 'Current human operator session required' }, 403);
  if (!user.roles?.some(role => role === 'operator' || role === 'admin')) return c.json({ error: 'Operator or admin role required' }, 403);
  return enrichmentResult(c, async () => {
    const input = await enrichmentBody(c.req.raw);
    const tenant = c.get('tenant'), actor = user.sub;
    const authorize = async () => {
      let allowed = false;
      await operatorJwt()(c, async () => {
        const current = c.get('auth').user;
        if (catalogScope(c) !== tenant || current?.sub !== actor || current.type !== 'access'
          || !current.roles?.some(role => role === 'operator' || role === 'admin')
          || !Number.isSafeInteger(current.exp) || current.exp! * 1000 <= Date.now()) {
          throw new PublicationError('Current human review authority required', 403, 'operator_required');
        }
        allowed = true;
      });
      if (!allowed) throw new PublicationError('Current human review authority required', 403, 'operator_required');
    };
    const review = await reviewEnrichment(c.env.STORAGE, tenant, c.req.param('id'), actor, input, authorize);
    return { status: 'reviewed', published: false, review };
  }, 201);
});
enrichmentRoutes.get('/:id/export', c => enrichmentResult(c, () => exportEnrichment(c.env.STORAGE, c.get('tenant'), c.req.param('id'))));
enrichmentRoutes.post('/:id/publish', c => {
  const user = c.get('auth').user!;
  if (user.type !== 'access') return c.json({ error: 'Current human operator session required' }, 403);
  if (!user.roles?.some(role => role === 'operator' || role === 'admin')) return c.json({ error: 'Operator or admin role required' }, 403);
  return enrichmentResult(c, async () => {
    const meta = catalogMeta(c), input = await enrichmentBody(c.req.raw);
    const result = await publishEnrichment(c.env, c.get('tenant'), c.req.param('id'), input, meta);
    if (!result.ok) throw new EnrichmentError(result.errors.join('; '), 422);
    return { ...result, diagnostics: await catalogDiagnostics(c.env, c.get('tenant'), result.document, result.revision) };
  });
});
contentRoutes.route('/catalog/enrichment/proposals', enrichmentRoutes);

// ── Reads ────────────────────────────────────────────────────────────────────
contentRoutes.get('/:kind', async (c) => {
  const k = kindOf(c.req.param('kind')); if (!k) return c.json({ error: UNKNOWN_KIND }, 404);
  const scope = scopeOf(c, k.kind);
  if (isVocabulary(k.kind)) {
    // P38 (VA1): the latest stored revision and the revision in effect, never one for the other.
    const { publication, revision: stored, approval } = await vocabularyState(c.env, scope);
    return c.json({ scope, kind: k.kind.name, source: stored ? 'stored' : 'absent', revision: stored?.revision ?? 0,
      effectiveRevision: approval?.value.revision ?? 0, publication, actor: stored?.actor ?? null, note: stored?.note ?? null, at: stored?.at ?? null,
      document: stored?.value ?? null,
      approval: approval ? { revision: approval.value.revision, actor: approval.actor, note: approval.note, at: approval.at } : null,
      ...(stored ? documentEnvelopeOf(k.kind, stored.value) : {}) });
  }
  if (k.kind.name === IMPORT_SOURCES_KIND.name || k.kind.name === LAYOUTS_KIND.name) {
    // P91, P88: absent until published (revision 0), and then the document in force.
    const { publication, revision: listed } = await readOptionalPublication(c.env, k.kind, scope);
    return c.json({ scope, kind: k.kind.name, source: listed ? 'stored' : 'absent', revision: listed?.revision ?? 0, publication,
      actor: listed?.actor ?? null, note: listed?.note ?? null, at: listed?.at ?? null, document: listed?.value ?? null });
  }
  const rev = await readPublication(c.env, k.kind, scope);
  const value = rev ? rev.value : k.fallback;
  // P93 (R-P487 (4)): `?shard=<two hex digits>` reads one index shard of the catalogue in force, never the whole index.
  const shard = c.req.query('shard');
  if (shard !== undefined && k.kind.name === CONTENT_KIND.name) {
    if (!/^[0-9a-f]{2}$/.test(shard)) return c.json({ ok: false, error: 'shard must be two lowercase hexadecimal digits (00 to ff)' }, 400);
    const index = rev ? (rev.value as ContentCatalog).index : undefined, pointer = own(index?.shards, shard);
    // P98: a shard inside a pack is read by its range there.
    const document = pointer ? await readCatalogShard(c.env, scope, pointer.digest, indexAddress(index!, pointer), shard, pointer.products) : { shard, products: {} };
    // P98: a shard in a pack is named by the first 128 bits of its digest; its answer names its full digest.
    return c.json({ scope, kind: k.kind.name, source: 'stored', revision: rev?.revision ?? 0, publication: rev?.publication, shard, digest: pointer ? (pointer.digest?.length === 64 ? pointer.digest : await documentDigest(document)) : null,
      document, envelope: { products: Object.keys(document.products).length, records: pointer?.records ?? 0, bytes: documentBytes(document), limitBytes: PUBLICATION_MAX_BYTES } });
  }
  // P86 (S6): `?product=` reads one product's part of the catalogue in force, through its manifest pointer (P93: through its shard).
  const product = c.req.query('product');
  if (product !== undefined && k.kind.name === CONTENT_KIND.name) {
    const pointer = rev ? await catalogPartPointer(c.env, scope, rev.value as ContentCatalog, product) : undefined;
    if (!pointer) return c.json({ ok: false, error: `product ${JSON.stringify(product.slice(0, 256))} has no part in the catalogue in force` }, 404);
    const part = await readCatalogPart(c.env, scope, pointer.digest, pointer.address);
    return c.json({ scope, kind: k.kind.name, source: 'stored', revision: rev!.revision, publication: rev!.publication, product, digest: pointer.digest,
      document: { product: part.product, pieces: part.pieces }, envelope: { pieces: part.pieces.length, bytes: documentBytes(part), limitBytes: PUBLICATION_MAX_BYTES } });
  }
  return c.json({ scope, kind: k.kind.name, source: rev ? 'stored' : 'compiled-default', revision: rev?.revision ?? 0,
    publication: rev?.publication, actor: rev?.actor ?? null, note: rev?.note ?? null, at: rev?.at ?? null, document: value,
    ...documentEnvelopeOf(k.kind, value),
    ...(k.kind.name === 'content' ? { diagnostics: await catalogDiagnostics(c.env, scope, value, rev?.revision ?? 0) } : {}),
    ...(k.kind.name === 'slots' ? { pinDiagnostics: await pinDiagnosticsFor(c, scope, rev?.value ?? null, rev?.revision ?? null),
      // W20 R1 (R77(b), R82(c)): the public home of the refusals the published
      // hard controls make, beside the pin channel and in a channel of its own.
      constraintDiagnostics: await slotConstraintDiagnostics(c.env, rev?.value ?? null, rev?.revision ?? null, slotCatalogTenant(c, scope)) } : {}),
    // P52 (R-P78): the learn document in force tells its reader what its
    // publication would be told (P41's envelope), last; nothing for any other kind.
    ...learnAdvisory(k.kind, value) });
});

contentRoutes.get('/:kind/history', async (c) => {
  const k = kindOf(c.req.param('kind')); if (!k) return c.json({ error: UNKNOWN_KIND }, 404);
  const scope = scopeOf(c, k.kind);
  // P38: a tenant that never published a vocabulary has no history of one.
  if (isOptionalMember(k.kind) && !(await readOptionalPublication(c.env, k.kind, scope)).revision) return c.json({ scope, kind: k.kind.name, revisions: [] });
  return c.json({ scope, kind: k.kind.name, revisions: await readIndex(c.env, k.kind, scope) });
});

contentRoutes.get('/:kind/revisions/:n', async (c) => {
  const k = kindOf(c.req.param('kind')); if (!k) return c.json({ error: UNKNOWN_KIND }, 404);
  const scope = scopeOf(c, k.kind);
  const n = Number(c.req.param('n'));
  if (!Number.isInteger(n) || n < 1) return c.json({ error: 'revision must be a positive integer' }, 400);
  if (isOptionalMember(k.kind) && !(await readOptionalPublication(c.env, k.kind, scope)).revision) return c.json({ error: `revision ${n} not found for scope "${scope}"` }, 404);
  const rev = await readVersion(c.env, k.kind, scope, n);
  return rev ? c.json({ scope, kind: k.kind.name, ...rev }) : c.json({ error: `revision ${n} not found for scope "${scope}"` }, 404);
});

/** Authenticated dry run: the same validator the write path runs. */
contentRoutes.post('/:kind/validate', async (c) => {
  const k = kindOf(c.req.param('kind')); if (!k) return c.json({ error: UNKNOWN_KIND }, 404);
  const scope = scopeOf(c, k.kind);
  const body = await readInputJson(c.req.raw.body);
  if (body === null) return c.json({ error: 'body must be JSON' }, 400);
  const candidate = (body as { document?: unknown }).document ?? body;
  inputCollection(k.kind.name, candidate);
  if (k.kind.name === PRIORS_KIND.name) {
    const unit = await priorUnitRefusals(c, scope, candidate);
    if (unit) return c.json({ valid: false, errors: unit.errors }, unit.status);
  }
  if (k.kind.name === SLOTS_KIND.name) {
    // P36 (R-P46): the tenant's own vocabulary, before the catalogue check.
    const vocabulary = await vocabularyRefusals(c, scope, candidate);
    if (vocabulary) return c.json({ valid: false, errors: vocabulary.errors }, vocabulary.status);
    const refused = await orderRefusals(c, scope, candidate);
    if (refused) return c.json({ valid: false, errors: refused.errors }, refused.status);
    // P88 (E13): each per-context order against the page's approved layouts in effect, as its publication checks it.
    const layouts = await layoutRefusals(c, scope, candidate);
    if (layouts) return c.json({ valid: false, errors: layouts.errors }, layouts.status);
  }
  // P28 (R-P31): a dry run of a learn document says what its write would say about a blend.
  if (k.kind.name === LEARN_KIND.name) {
    const refused = await blendRefusals(c, scope, candidate);
    if (refused) return c.json({ valid: false, errors: refused.errors }, refused.status);
  }
  // P38 (VA2): the dry run says what the write would: the catalogue under the
  // vocabulary in effect now. It stays advisory: where the publication cannot be
  // read the document is checked as before (the write itself reads the vocabulary
  // from the set it publishes over, and refuses when that set cannot be read).
  let checked: unknown = candidate;
  if (k.kind.name === CONTENT_KIND.name) {
    // P31 (R-P59 (4)): a rule's channel and bucket against the tenant's own vocabulary and cut, as the write checks them.
    const vocabulary = await catalogueVocabularyRefusals(c, scope, candidate);
    if (vocabulary) return c.json({ valid: false, errors: vocabulary.errors }, vocabulary.status);
    let approval: { value: VocabularyApproval } | null = null;
    try { approval = (await readOptionalPublication(c.env, VOCABULARY_APPROVAL_KIND, scope)).revision; }
    catch (error) { if (!(error instanceof PublicationError)) throw error; }
    const governed = approval ? governedCatalogue(candidate, vocabularyTableOf(approval.value)) : null;
    if (governed && !governed.ok) return c.json({ valid: false, errors: governed.errors }, 422);
    if (governed?.ok) checked = governed.value;
    // P86 (R-P424): a parted document is checked as its PUT is, against the revision in force and its id index
    // (advisory as above: where the revision in force cannot be read, the document is checked as before).
    const parted = CONTENT_KIND.validate(checked);
    let inForce: ContentCatalog | null = null;
    if (parted.ok && parted.value.productSlots) {
      try { inForce = (await readPublication(c.env, CONTENT_KIND, scope)).value; } catch (error) { if (!(error instanceof PublicationError)) throw error; }
    }
    if (parted.ok && parted.value.productSlots && inForce) {
      try { await partedPutPlan(c.env, scope, inForce, parted.value); }
      catch (error) {
        if (error instanceof VocabularyRefusal) return c.json({ valid: false, errors: error.errors }, 422);
        if (error instanceof PublicationError) return c.json({ valid: false, errors: [error.message], code: error.code }, error.status);
        throw error;
      }
    }
  }
  const result = k.kind.validate(checked);
  return result.ok ? c.json({ valid: true, document: result.value,
    ...(k.kind.name === 'content' ? { diagnostics: await catalogDiagnostics(c.env, scope, result.value, null,
      publishedRequest(candidate, candidate === body ? REQUEST_ENVELOPE_FIELDS : [])) } : {}),
    ...(k.kind.name === 'slots' ? { pinDiagnostics: await pinDiagnosticsFor(c, scope, result.value, null) } : {}),
    ...learnAdvisory(k.kind, result.value) }) : c.json({ valid: false, errors: result.errors }, 422);
});

// ── Writes ───────────────────────────────────────────────────────────────────
contentRoutes.put('/:kind', async (c) => {
  const k = kindOf(c.req.param('kind')); if (!k) return c.json({ error: UNKNOWN_KIND }, 404);
  // P38, P91: the first revision of an optional member is written over revision 0 (none stored).
  const scope = scopeOf(c, k.kind), meta = catalogMeta(c, undefined, isOptionalMember(k.kind));
  let candidate: unknown;
  let related: unknown;
  let note = '';
  // The keys this body carried the document in, which belong to the request and
  // not to the catalogue; none when the body wrapped its document in `document`.
  let envelope: readonly string[] = [];
  if ((c.req.header('content-type') ?? '').toLowerCase().includes('text/csv')) {
    if (!k.fromCsv) return c.json({ error: `${c.req.param('kind')} does not accept CSV` }, 415);
    candidate = k.fromCsv(await readInputText(c.req.raw.body));
    note = noteOf(c.req.query('note'));
  } else {
    const body = await readInputJson(c.req.raw.body);
    if (body === null) return c.json({ error: 'body must be JSON' }, 400);
    const { document, note: n } = body as { document?: unknown; note?: unknown };
    candidate = document ?? body;
    if (candidate === body) envelope = REQUEST_ENVELOPE_FIELDS;
    related = (body as { publicationChanges?: unknown }).publicationChanges;
    note = noteOf(n);
  }
  inputCollection(k.kind.name, candidate);
  // P36 fix round 1 (R-P54): every priors document this request publishes, the
  // primary or a related member, is read under the learn document it publishes,
  // or else the one in force.
  const learnDocument = requestLearnDocument(k.kind, candidate, related);
  if (k.kind.name === PRIORS_KIND.name) {
    const unit = await priorUnitRefusals(c, scope, candidate, learnDocument);
    if (unit) return c.json({ ok: false, errors: unit.errors }, unit.status);
  }
  // P36 (R-P46): a slots document published alone names only the tenant's own
  // channels, buckets, source platforms and landing-page types; one published
  // with related members is checked below, against the learn member among them.
  if (k.kind.name === SLOTS_KIND.name && related === undefined) {
    const vocabulary = await vocabularyRefusals(c, scope, candidate);
    if (vocabulary) return c.json({ ok: false, errors: vocabulary.errors }, vocabulary.status);
  }
  // P31 (R-P59 (4)): a catalogue published alone names only the tenant's own
  // channels and buckets in its eligibility rules; one published with related
  // members is checked below, against the learn member among them.
  if (k.kind.name === CONTENT_KIND.name && related === undefined) {
    const vocabulary = await catalogueVocabularyRefusals(c, scope, candidate);
    if (vocabulary) return c.json({ ok: false, errors: vocabulary.errors }, vocabulary.status);
  }
  // A replacement is self-contained: reject invalid new drafts before any
  // authority read. Original v1 receipt resolution is deliberately read-only
  // and may retain a value that the current write validator no longer admits.
  if (meta.expectedPublication) {
    const valid = k.kind.validate(candidate);
    if (!valid.ok) return c.json({ ok: false, errors: valid.errors }, 422);
  }
  // P38 (VA2): a catalogue document, primary or related, is published under the
  // vocabulary in effect in the set it is published over; any other document as it came.
  // P86: and, where it declares product slots, routed into its parts before the head is reserved.
  const seen = { manifest: false }, held: PackHold = {};
  // P88 (E13): a slots document, primary or related, meets the approved layouts of the set it is published over.
  const requestLayouts = requestLayoutsDocument(k.kind, candidate, related);
  const governedMember = (kind: DocumentKind<unknown>, document: unknown) => kind.name === CONTENT_KIND.name
    ? (base: unknown, set: PublicationPin) => catalogueOverPut(c.env, scope, base as ContentCatalog | undefined, set, document, seen, held)
    : kind.name === SLOTS_KIND.name ? slotsOverLayouts(c.env, scope, document, requestLayouts) : () => document;
  // P98 (LD6): the catalogue's pack, where the PUT adopted one already stored, headed again once the head is held.
  const reserved = packReserved(c.env, scope, held);
  const named = (error: unknown) => { throw seen.manifest ? namedManifest(error) : error; };
  let result;
  if (related !== undefined) {
    if (!Array.isArray(related) || related.length > 5) throw new PublicationError('Invalid related publication members', 422, 'invalid_document');
    const changes: PublicationChange[] = [{ kind: k.kind, scope, request: { type: 'replace', candidate }, candidate: governedMember(k.kind, candidate), reserved }];
    const members: PublishedMember[] = [{ kind: k.kind, document: candidate, at: null }];
    for (const [index, entry] of related.entries()) {
      if (!entry || typeof entry !== 'object' || Object.keys(entry).some(key => !['kind', 'document'].includes(key))) throw new PublicationError('Invalid related document', 422, 'invalid_document');
      const target = entry.kind === 'reflex' ? { kind: REFLEX_KIND } : kindOf(entry.kind);
      if (!target) throw new PublicationError('Unsupported related document kind', 422, 'invalid_document');
      inputCollection(target.kind.name, entry.document);
      // P36 fix round 1 (R-P54): a priors member is read at the door the primary
      // is read at, before the store's own validator (which holds no tenant), and
      // a refusal names the member and refuses the whole request.
      if (target.kind.name === PRIORS_KIND.name) {
        const unit = await priorUnitRefusals(c, scope, entry.document, learnDocument);
        if (unit) return c.json({ ok: false, errors: unit.errors.map(error => `publicationChanges[${index}]: ${error}`) }, unit.status);
      }
      const valid = target.kind.validate(entry.document);
      if (!valid.ok) return c.json({ ok: false, errors: valid.errors }, 422);
      changes.push({ kind: target.kind, scope: entry.kind === 'reflex' && scope === 'brighthour' ? 'tenant:brighthour' : scope,
        request: { type: 'replace', candidate: entry.document }, candidate: governedMember(target.kind, entry.document) });
      members.push({ kind: target.kind, document: entry.document, at: `publicationChanges[${index}]` });
    }
    // P36 (R-P46): every slots member against the tenant's context vocabulary,
    // the learn member this request publishes or else the one in force.
    const vocabulary = await requestVocabularyRefusals(c, scope, members);
    if (vocabulary) return c.json({ ok: false, errors: vocabulary.errors }, vocabulary.status);
    // P31 (R-P59 (4)): every catalogue member's eligibility rules, against the
    // tenant's context vocabulary in the learn member this request publishes or
    // else the one in force.
    const ruleWords = await requestCatalogueVocabularyRefusals(c, scope, members);
    if (ruleWords) return c.json({ ok: false, errors: ruleWords.errors }, ruleWords.status);
    // P01 (R-P24): the per-context orders of every slots member, against the
    // catalogue this request publishes or else the one in force.
    const orders = await requestOrderRefusals(c, scope, members);
    if (orders) return c.json({ ok: false, errors: orders.errors }, orders.status);
    // P28 (R-P31): the layout blend of every learn member, against the slots
    // document this request publishes or else the one in force.
    const blends = await requestBlendRefusals(c, scope, members);
    if (blends) return c.json({ ok: false, errors: blends.errors }, blends.status);
    result = await publishSet(c.env, changes, { ...meta, note }).catch(named);
  } else {
    // P01 (R-P24): a slots document published alone is checked against the catalogue in force.
    const orders = await requestOrderRefusals(c, scope, [{ kind: k.kind, document: candidate, at: null }]);
    if (orders) return c.json({ ok: false, errors: orders.errors }, orders.status);
    // P28 (R-P31): a learn document published alone is checked against the slots document in force.
    const blends = await requestBlendRefusals(c, scope, [{ kind: k.kind, document: candidate, at: null }]);
    if (blends) return c.json({ ok: false, errors: blends.errors }, blends.status);
    // P38: the catalogue through the same replace a write makes, under the vocabulary in effect.
    // P88: a slots document through the same replace a write makes, under the approved layouts of its set.
    result = k.kind.name === CONTENT_KIND.name || k.kind.name === SLOTS_KIND.name
      ? await publish(c.env, k.kind, scope, { type: 'replace', candidate }, { ...meta, note }, governedMember(k.kind, candidate), { reserved }).catch(named)
      : await write(c.env, k.kind, scope, candidate, { ...meta, note });
  }
  return result.ok
    ? c.json({ ok: true, revision: result.revision.revision, publication: result.revision.publication, version: k.kind.versionOf?.(result.revision.value) ?? '', document: result.revision.value,
        ...(k.kind.name === 'content' ? { diagnostics: await catalogDiagnostics(c.env, scope, result.revision.value, result.revision.revision, publishedRequest(candidate, envelope)) } : {}),
        ...(k.kind.name === 'slots' ? { pinDiagnostics: await pinDiagnosticsFor(c, scope, result.revision.value, result.revision.revision) } : {}),
        ...learnAdvisory(k.kind, result.revision.value) })
    : c.json({ ok: false, errors: result.errors }, 422);
});

contentRoutes.post('/:kind/rollback/:n', async (c) => {
  const k = kindOf(c.req.param('kind')); if (!k) return c.json({ error: UNKNOWN_KIND }, 404);
  const scope = scopeOf(c, k.kind), meta = catalogMeta(c);
  const n = Number(c.req.param('n'));
  if (!Number.isInteger(n) || n < 1) return c.json({ error: 'revision must be a positive integer' }, 400);
  const body = await readInputJson(c.req.raw.body, {});
  const rollbackMeta = { ...meta, note: noteOf((body as { note?: unknown })?.note) || undefined };
  // P38 (VA2): rolling the catalogue forward to an old body publishes that body
  // under the vocabulary in effect, as every catalogue publication is; the
  // request, the note and the body read are versionedStore.rollback's own.
  const held: PackHold = {};
  const result = k.kind.name === CONTENT_KIND.name
    ? await publish(c.env, k.kind, scope, { type: 'rollback', toRevision: n }, { ...rollbackMeta, note: rollbackMeta.note ?? `rollback to revision ${n}` },
      async (base: unknown, set: PublicationPin) => catalogueOverRollback(c.env, scope, base as ContentCatalog | undefined, set, (await publicationVersion(c.env, k.kind, scope, n))?.value ?? null, n, held),
      { reserved: packReserved(c.env, scope, held) })
    // P88 (E13): a slots body rolled forward meets the approved layouts of the set it is published over.
    : k.kind.name === SLOTS_KIND.name
      ? await publish(c.env, k.kind, scope, { type: 'rollback', toRevision: n }, { ...rollbackMeta, note: rollbackMeta.note ?? `rollback to revision ${n}` },
        async (base: unknown, set: PublicationPin) => slotsOverLayouts(c.env, scope, (await publicationVersion(c.env, k.kind, scope, n))?.value ?? null)(base, set))
      : await rollback(c.env, k.kind, scope, n, rollbackMeta);
  return result.ok
    ? c.json({ ok: true, revision: result.revision.revision, publication: result.revision.publication, version: k.kind.versionOf?.(result.revision.value) ?? '',
        ...(k.kind.name === 'content' ? { diagnostics: await catalogDiagnostics(c.env, scope, result.revision.value, result.revision.revision) } : {}),
        ...(k.kind.name === 'slots' ? { pinDiagnostics: await pinDiagnosticsFor(c, scope, result.revision.value, result.revision.revision) } : {}) })
    : c.json({ ok: false, errors: result.errors }, 404);
});

// ── The import adapter ───────────────────────────────────────────────────────

/**
 * P91 (E16, R-P330): a load the publication does not write, decided inside the publication's own candidate step, after
 * the preconditions and the assembly and before anything is written: a result equal to the catalogue in force (the
 * skip), a dry run, or a full export whose guard names another number than the pieces it would expire.
 */
class HeldLoad extends Error {
  constructor(readonly held: 'unchanged' | 'dry-run' | 'expire', readonly candidate: ContentCatalog | null, readonly expiring = 0) { super(held); }
}

/**
 * P86 (S4, R-P407 (1)): a load over a catalogue with product slots. Each record
 * of the file routes by its own `slotTypes` and FIRST `featuredProductIds`; the
 * mode applies per product — `merge` upserts inside the parts the file names,
 * `replace` and `full` replace each named product's part (`full` keeping its
 * left-out records expired, `expire` counted over the named products) — and to
 * the shared pieces only when the file carries one. Every other product keeps
 * its pointer. Only the named products' parts are read: the work is the file's,
 * never the range's. The assembled records go through the vocabulary in effect
 * and the validator as one list (so a refusal names the record of the file
 * sent), then each product's records become one part. Answers the manifest and
 * the parts to write, or the invalid document for the validator to refuse.
 */
async function assembleParted(env: Env, scope: string, current: ContentCatalog, set: PublicationPin, incoming: Record<string, unknown>[], positions: readonly number[],
  mode: ImportMode, opts: { expire?: number }, sink: { placed?: { pieces: unknown[]; positions: (number | null)[] }; touched?: { before: ContentCatalog; after: ContentCatalog } },
  stage?: StageSink):
  Promise<{ manifest?: ContentCatalog; built?: BuiltIndex; document?: unknown; writing?: () => Promise<{ manifest: ContentCatalog; built: BuiltIndex }> }> {
  const slots = new Set(current.productSlots ?? []), sharedIn: number[] = [], productIn = new Map<string, number[]>();
  incoming.forEach((piece, j) => {
    const product = partProductOf(piece, slots);
    if (product === null) sharedIn.push(j); else productIn.set(product, [...(productIn.get(product) ?? []), j]);
  });
  // P93: the stored parts of the products the file names, through their shards (only those shards are read). P98: the
  // shards first, then the parts, then (below) the id shards of the ids whose place can change, each pack's objects in as
  // few ranged reads as their places allow.
  const edit = new IndexEdit(env, scope, current), stored = new Map<string, ContentPiece[]>(), known = new Map<string, Set<unknown>>();
  const pointers = new Map<string, ResolvedPartPointer | undefined>();
  await edit.prefetchShards(productIn.keys());
  for (const product of productIn.keys()) pointers.set(product, await edit.pointer(product));
  await edit.prefetchParts(pointers.values());
  for (const product of productIn.keys()) {
    const pointer = pointers.get(product), pieces = pointer ? (await edit.part(pointer)).pieces as ContentPiece[] : [];
    stored.set(product, pieces); known.set(product, new Set(pieces.map(piece => piece.id)));
  }
  {
    const ids: string[] = [], sharedNow = new Set(current.pieces.map(piece => piece.id));
    for (const [product, from] of productIn) for (const j of from) { const id = incoming[j]!.id; if (typeof id === 'string' && !known.get(product)!.has(id)) ids.push(id); }
    for (const j of sharedIn) { const id = incoming[j]!.id; if (typeof id === 'string' && !sharedNow.has(id)) ids.push(id); }
    await edit.prefetchIdShards(ids);
  }
  // R-P424 through the id shards, looked up only for the ids whose place can change (P93): an incoming part record its
  // product's part does not already hold. One the index lists under another product moves only when the file carries
  // that product too — its part then drops it — and is refused otherwise.
  const collisions: Collision[] = [], movedOut = new Map<string, Set<unknown>>(), stale = new Set<string>();
  const ownerOf = ownerCheck(edit, known, stale);
  const at = (j: number) => recordAddress(positions[j]!, incoming[j]!.id);
  for (const [product, from] of productIn) {
    for (const j of from) {
      const id = incoming[j]!.id;
      if (typeof id !== 'string' || known.get(product)!.has(id)) continue;
      const owner = await ownerOf(id);
      if (owner === undefined || owner === product) continue;
      if (productIn.has(owner)) movedOut.set(owner, (movedOut.get(owner) ?? new Set()).add(id));
      // P98 (C2): a stage leaves to the publish a record whose product another staged file may carry.
      else if (stage) stage.moves.push({ id, from: owner, to: product, at: at(j) });
      else collisions.push(movedCollision(at(j), owner, product));
    }
  }
  const segments: Array<{ product: string | null; stored: ContentPiece[]; pieces: unknown[]; origins: (number | null)[] }> = [];
  const actsOnShared = sharedIn.length > 0;
  const shared = actsOnShared ? assembleFrom(current, sharedIn.map(j => incoming[j]!), mode) : { pieces: current.pieces as unknown[], origins: current.pieces.map(() => null) };
  segments.push({ product: null, stored: actsOnShared ? current.pieces : [], pieces: shared.pieces, origins: shared.origins.map(o => o === null ? null : sharedIn[o]!) });
  for (const [product, from] of productIn) {
    const leaving = movedOut.get(product), held = stored.get(product)!;
    const assembled = assembleFrom({ pieces: leaving ? held.filter(piece => !leaving.has(piece.id)) : held }, from.map(j => incoming[j]!), mode);
    segments.push({ product, stored: held, pieces: assembled.pieces, origins: assembled.origins.map(o => o === null ? null : from[o]!) });
  }
  // R-P424: and no id both shared and in a part once assembled: a shared piece whose id a part holds (a part the load
  // writes, as assembled; any other, through the id shards, for a piece not already shared), a part record whose id a
  // shared piece holds.
  const assembledIds = new Map<unknown, string>();
  for (const segment of segments) if (segment.product !== null) for (const piece of segment.pieces) assembledIds.set((piece as { id?: unknown } | null)?.id, segment.product);
  const sharedBefore = new Set(current.pieces.map(piece => piece.id)), sharedIds = new Set(shared.pieces.map(piece => (piece as { id?: unknown } | null)?.id));
  for (const j of sharedIn) {
    const id = incoming[j]!.id;
    if (typeof id !== 'string') continue;
    const written = assembledIds.get(id);
    if (written !== undefined) { collisions.push(inPartCollision(at(j), written)); continue; }
    if (sharedBefore.has(id)) continue;
    const owner = await ownerOf(id);
    if (owner !== undefined && !productIn.has(owner)) collisions.push(inPartCollision(at(j), owner));
  }
  for (const [product, from] of productIn) for (const j of from) if (typeof incoming[j]!.id === 'string' && sharedIds.has(incoming[j]!.id)) collisions.push(sharedCollision(at(j), product));
  if (collisions.length) throw collisionRefusal(collisions);
  if (mode === 'full') {
    const expiring = segments.reduce((n, segment) => n + (segment.product === null && !actsOnShared ? 0 : segment.origins.filter(o => o === null).length), 0);
    if (opts.expire !== expiring) throw new HeldLoad('expire', null, expiring);
  }
  const combined = segments.flatMap(segment => segment.pieces);
  sink.placed = { pieces: combined, positions: segments.flatMap(segment => segment.origins.map(o => o === null ? null : positions[o]!)) };
  const version = carriedVersion(current);
  const governed = await governedOver(env, scope, set, { ...(version ? { version } : {}), pieces: combined }) as { pieces: unknown[] };
  const checked = CONTENT_KIND.validate({ ...(version ? { version } : {}), pieces: governed.pieces });
  if (!checked.ok) return { document: { ...(version ? { version } : {}), pieces: governed.pieces } };
  // Each product's records as validated, in their segment; a record whose validated fields route it elsewhere, and a pooled
  // record in a part, are refused by their position in the list (the record of the file sent).
  const errors: string[] = [], parts = new Map<string, ContentPiece[]>(), before: ContentPiece[] = [], after: ContentPiece[] = [];
  let sharedPieces: ContentPiece[] = current.pieces, offset = 0;
  for (const segment of segments) {
    const pieces = checked.value.pieces.slice(offset, offset + segment.pieces.length);
    if (segment.product === null) {
      if (actsOnShared) {
        const routed = routedPieces(pieces, [...slots], offset);
        errors.push(...routed.errors);
        for (const [product] of routed.parts) errors.push(`pieces[${offset + pieces.findIndex(p => partProductOf(p, slots) === product)}]: routes to product ${JSON.stringify(product).slice(0, 80)}'s part, but was loaded as a shared piece; send it with its slotTypes and featuredProductIds`);
        sharedPieces = pieces;
      }
    } else {
      const routed = routedPieces(pieces, [...slots], offset);
      errors.push(...routed.errors);
      pieces.forEach((piece, i) => {
        const product = partProductOf(piece, slots);
        if (product !== null && product !== segment.product) errors.push(`pieces[${offset + i}]: routes to product ${JSON.stringify(product).slice(0, 80)}'s part, but was loaded into ${JSON.stringify(segment.product).slice(0, 80)}'s; send it with its slotTypes and featuredProductIds`);
        else if (product === null) errors.push(`pieces[${offset + i}]: is a shared piece once assembled, but was loaded into product ${JSON.stringify(segment.product).slice(0, 80)}'s part; send it with its slotTypes and featuredProductIds`);
      });
      parts.set(segment.product, pieces);
    }
    if (segment.product !== null || actsOnShared) { before.push(...segment.stored); after.push(...pieces); }
    offset += segment.pieces.length;
  }
  if (errors.length) throw new VocabularyRefusal(errors);
  sink.touched = { before: { pieces: before }, after: { pieces: after } };
  // P93: the index's edits — each named product's pointer where its part's digest moved (only those parts are written:
  // an unchanged part is never put again), and the ids whose place changed (added to a part, or dropped from one); a
  // retitle changes neither.
  // P98: each part whose digest moved is placed in the load's one pack.
  const now = await partPointers(parts), kept = new Set<unknown>();
  for (const pieces of parts.values()) for (const piece of pieces) kept.add(piece.id);
  for (const [product, pieces] of parts) {
    if (pointers.get(product)?.digest !== now[product]!.digest) edit.place(product, { product, pieces }, now[product]!);
    for (const piece of pieces) if (!known.get(product)!.has(piece.id)) edit.setOwner(piece.id, product);
  }
  for (const ids of known.values()) for (const id of ids) if (typeof id === 'string' && !kept.has(id)) edit.setOwner(id, null);
  for (const id of stale) if (!kept.has(id)) edit.setOwner(id, null);
  if (stage) {
    // P98 (C2): a stage keeps, for its publish, each named product's part after the load and whether its digest moved,
    // the record ids whose place it changes, and the shared pieces where the file acts on them; no index is built.
    for (const [product, pieces] of parts) stage.products.set(product, { part: { product, pieces }, pointer: now[product]!, moved: pointers.get(product)?.digest !== now[product]!.digest });
    for (const [id, product] of edit.ownerEdits()) stage.owners.set(id, product);
    stage.shared = actsOnShared ? sharedPieces : null;
    return {};
  }
  const members = { ...(version ? { version } : {}), ...(current.typeFallback ? { typeFallback: current.typeFallback } : {}), productSlots: current.productSlots };
  const built = await edit.build();
  // The skip and the dry run read the index above; a load that writes builds it once more (only where it read objects
  // stored before packs or the table asks for a pack to be re-homed: `IndexEdit.build`'s `writing`).
  const writing = async () => { const final = await edit.build({ writing: true }); return { manifest: manifestOf(members, sharedPieces, final.index), built: final }; };
  return { manifest: manifestOf(members, sharedPieces, built.index), built, writing };
}
/**
 * P86 (S9, R-P407 (2)): on a catalogue with product slots, an import's and a pull's diagnostics name each routed
 * two-id record written variant-first (its first id is its second followed by `-` and more): it is routed to its
 * first id as written, the load accepted; the canonical order is [product, variant].
 */
function withVariantFirst<T extends { warnings: unknown[] | null; warningCount?: number | null; counts?: Record<string, number> | null }>(diagnostics: T,
  catalog: ContentCatalog, incoming: readonly Record<string, unknown>[], positions: readonly number[]): T {
  if (!catalog.productSlots) return diagnostics;
  const slots = new Set(catalog.productSlots), BOUND = 64;
  const warnings = incoming.flatMap((piece, j) => partProductOf(piece, slots) !== null && variantFirst(piece) ? [(() => {
    const id = typeof piece.id === 'string' ? piece.id : '';
    return { code: 'variant_first' as const, recordIndex: positions[j]!, recordId: id.slice(0, BOUND), recordIdTruncated: id.length > BOUND,
      product: partProductOf(piece, slots)! };
  })()] : []);
  if (!warnings.length) return diagnostics;
  return { ...diagnostics, warnings: [...(diagnostics.warnings ?? []), ...warnings],
    ...(typeof diagnostics.warningCount === 'number' ? { warningCount: diagnostics.warningCount + warnings.length } : {}),
    ...(diagnostics.counts ? { counts: { ...diagnostics.counts, variant_first: warnings.length } } : {}) };
}

async function importInto(c: Context<Ctx>, records: unknown[], mode: ImportMode, note: string, source: object, meta: WriteMeta,
  document?: { value: unknown; accepted: ReadonlySet<string> }, opts: { dryRun?: boolean; expire?: number } = {}) {
  const scope = catalogScope(c);
  const { pieces: incoming, positions } = positionedCandidates(records); // P82: each candidate's position in the file sent
  if (incoming.length === 0) return c.json({ ok: false, errors: ['no records found in the import'] }, 422);
  // P31 (R-P59 (4)): the eligibility rules the import writes, against the
  // tenant's context vocabulary and cut in force, at the one door the JSON and
  // CSV imports and the pull all pass through.
  const vocabulary = await catalogueVocabularyRefusals(c, scope, { pieces: incoming });
  if (vocabulary) return c.json({ ok: false, errors: recordAddressed(vocabulary.errors, incoming, positions), received: records.length }, vocabulary.status);
  // The catalogue this operation was published over, so `changed` is measured
  // against the stored values. The mutator runs for every publication; an
  // exact-request retry serves a retained answer without running it, and the
  // revision it declared is the base that answer was measured against.
  let base: ContentCatalog | undefined;
  // P82 (E5): the assembled pieces and, beside them, the position in the file sent of the record each came from.
  let placed: { pieces: unknown[]; positions: (number | null)[] } | undefined;
  // P86: on a catalogue with parts, the records the load read and wrote (the shared pieces it acted on and the parts
  // of the products it named), before and after, for the answer's counts and diagnostics.
  let touched: { before: ContentCatalog; after: ContentCatalog } | undefined;
  const addressed = (errors: string[]) => placed ? recordAddressed(errors, placed.pieces, placed.positions) : errors;
  const diagnosed = async (catalog: ContentCatalog, revision: number | null) => {
    const view = touched ? { ...catalog, pieces: touched.after.pieces } : catalog;
    return withVariantFirst(await catalogDiagnostics(c.env, scope, view, revision,
      { records, accepted: FEED_FIELDS, ...(document ? { document } : {}), pieceRecords: storedPieceRecords(view, incoming, positions) }), catalog, incoming, positions);
  };
  let result;
  const held: PackHold = {};
  try {
    // P38 (VA2): the assembled catalogue under the vocabulary in effect in the set it is published over.
    result = await publish<ContentCatalog>(c.env, CONTENT_KIND, scope, { type: 'import', source, records, mode, ...(opts.expire !== undefined ? { expire: opts.expire } : {}) },
      { ...meta, note },
      async (current, set) => {
        base = current;
        // P86: a catalogue with product slots assembles per product (`assembleParted`).
        if (current.productSlots) {
          const sink: Parameters<typeof assembleParted>[8] = {};
          let parted: Awaited<ReturnType<typeof assembleParted>>;
          try { parted = await assembleParted(c.env, scope, current, set, incoming, positions, mode, opts, sink); }
          finally { placed = sink.placed; touched = sink.touched; }
          if (!parted.manifest) return parted.document;
          if (await documentDigest(CONTENT_KIND.stamp!(parted.manifest, meta.expectedRevision!)) === await documentDigest(current)) throw new HeldLoad('unchanged', current);
          if (opts.dryRun) throw new HeldLoad('dry-run', parted.manifest);
          const written = await parted.writing!();
          manifestCap(written.manifest, set);
          // P98: the load's one pack, before the head is reserved.
          const index = await writeIndex(c.env, scope, written.built, held);
          return index === written.built.index ? written.manifest : { ...written.manifest, index };
        }
        const assembled = assembleFrom(current, incoming, mode);
        placed = { pieces: assembled.pieces, positions: assembled.origins.map(j => j === null ? null : positions[j]!) };
        // P91: the full export's guard, compared with what the assembly expires, before anything is written.
        if (mode === 'full') {
          const expiring = assembled.origins.filter(j => j === null).length;
          if (opts.expire !== expiring) throw new HeldLoad('expire', null, expiring);
        }
        const governed = await governedOver(c.env, scope, set, { ...(carriedVersion(current) ? { version: carriedVersion(current) } : {}), pieces: assembled.pieces });
        const checked = CONTENT_KIND.validate(governed);
        if (checked.ok) {
          // P91 (R-P330): unchanged when the candidate, stamped at the stored revision, has the stored document's digest.
          if (await documentDigest(CONTENT_KIND.stamp!(checked.value, meta.expectedRevision!)) === await documentDigest(current)) throw new HeldLoad('unchanged', current);
          if (opts.dryRun) throw new HeldLoad('dry-run', checked.value);
        }
        return governed;
      }, { reserved: packReserved(c.env, scope, held), retry: true });
  } catch (error) {
    if (error instanceof VocabularyRefusal) return c.json({ ok: false, errors: addressed(error.errors), received: records.length }, 422);
    if (base?.productSlots && error instanceof PublicationError && error.code === 'document_too_large') throw namedManifest(error);
    if (error instanceof HeldLoad) {
      if (error.held === 'expire') {
        return c.json({ ok: false, error: `mode=full expires ${error.expiring} stored piece${error.expiring === 1 ? '' : 's'} the file leaves out; expire=${opts.expire} names another number, so nothing was written`,
          code: 'expire_mismatch', expire: error.expiring }, 409);
      }
      // The skip and the dry run: nothing was written, so the answer names the revision in force.
      const stored = base!, shown = error.held === 'unchanged' ? stored : error.candidate!;
      const compared = touched && error.held !== 'unchanged' ? touched : { before: stored, after: shown };
      return c.json({ ok: true, scope, mode, received: records.length, imported: incoming.length, pieces: catalogPieceCount(shown),
        changed: error.held === 'unchanged' ? 0 : changedPieces(compared.before, compared.after), removed: error.held === 'unchanged' ? 0 : removedPieces(compared.before, compared.after),
        changedBasis: 'stored' as const,
        ...(error.held === 'unchanged' ? { skipped: true, reason: 'unchanged' } : {}), ...(opts.dryRun ? { dryRun: true } : {}),
        revision: meta.expectedRevision, publication: meta.expectedPublication, version: stored.version ?? '',
        diagnostics: await diagnosed(shown, meta.expectedRevision ?? null) });
    }
    throw error;
  }
  if (!result.ok) return c.json({ ok: false, errors: addressed(result.errors), received: records.length }, 422);
  const before = base !== undefined ? { catalog: base, basis: 'stored' as const } : await publishedOver(c.env, scope, meta.expectedRevision);
  const measured = before.basis === 'stored';
  const compared = touched ?? { before: before.catalog, after: result.revision.value };
  return c.json({ ok: true, scope, mode, received: records.length, imported: incoming.length, pieces: catalogPieceCount(result.revision.value),
    changed: measured ? changedPieces(compared.before, compared.after) : null,
    removed: measured ? removedPieces(compared.before, compared.after) : null,
    changedBasis: before.basis,
    revision: result.revision.revision, publication: result.revision.publication, version: result.revision.value.version ?? '',
    diagnostics: await diagnosed(result.revision.value, result.revision.revision) });
}

/**
 * The catalogue at a declared base revision, and whether the store could read
 * it. `changed` and `removed` are differences against that base, so a base
 * nobody can read is said by name — `changedBasis: 'unavailable'`, and no count
 * at all — instead of being treated as the empty catalogue, which would report
 * every stored piece as created and every removal as none. A base revision of
 * zero IS the empty catalogue and is a reading, not an outage.
 */
async function publishedOver(env: Env, scope: string, revision: number | undefined): Promise<{ catalog: ContentCatalog; basis: 'stored' | 'unavailable' }> {
  if (revision === undefined) return { catalog: EMPTY_CATALOG, basis: 'unavailable' };
  if (revision < 1) return { catalog: EMPTY_CATALOG, basis: 'stored' };
  try {
    const found = await readVersion<ContentCatalog>(env, CONTENT_KIND, scope, revision);
    return found ? { catalog: found.value, basis: 'stored' } : { catalog: EMPTY_CATALOG, basis: 'unavailable' };
  } catch { return { catalog: EMPTY_CATALOG, basis: 'unavailable' }; }
}

/** P91 (R-P330): a load names its mode; anything else, none included, is refused naming the three, before anything is read or written. */
const modeRefusal = (c: Context<Ctx>) => c.json({ ok: false, code: 'mode_required',
  error: 'mode is required: merge (upsert by id), replace (the whole catalog) or full (replace, and expire the stored pieces the file leaves out, with expire=<n>, their number)' }, 400);
/** P91: the full export's guard, required with `full` (428 without it) and a whole number when present; ignored by the other modes. */
function guardOf(c: Context<Ctx>, mode: ImportMode, raw: unknown): number | undefined | Response {
  if (raw === undefined || raw === null || raw === '') {
    return mode === 'full' ? c.json({ ok: false, code: 'expire_required', error: 'mode=full requires expire=<n>, the number of stored pieces the file leaves out, which it expires' }, 428) : undefined;
  }
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && /^(0|[1-9][0-9]*)$/.test(raw) ? Number(raw) : NaN;
  return Number.isSafeInteger(n) && n >= 0 ? n : c.json({ ok: false, code: 'invalid_expire', error: 'expire must be a whole number of pieces' }, 400);
}
/**
 * P91 (R-P330): the tenant's import-sources list, read from `CF-Connecting-IP` alone (never `X-Forwarded-For`, which a
 * caller writes): with a list published, a caller outside it, or with no readable address, is refused 403 naming it;
 * with none, every caller is allowed as before.
 */
async function sourceRefusal(c: Context<Ctx>, scope: string): Promise<Response | null> {
  const { revision } = await readOptionalPublication(c.env, IMPORT_SOURCES_KIND, scope);
  // P90: a document naming `hosts` alone restricts no caller.
  if (!revision || !revision.value.addresses) return null;
  const address = (c.req.header('CF-Connecting-IP') ?? '').trim();
  if (address && addressAllowed(revision.value.addresses, address)) return null;
  return c.json({ ok: false, code: 'source_not_allowed', error: address
    ? `the caller's address ${address.slice(0, 64)} is outside the tenant's import-sources list`
    : "no caller address (CF-Connecting-IP) to check against the tenant's import-sources list" }, 403);
}
/**
 * P91 (R-P330): a dry run's preconditions. It merges over the revision its If-Match names and is refused 428 or 409 as
 * the import is, but carries no Idempotency-Key: it retains nothing, so it runs under an operation id of its own.
 */
function dryRunMeta(c: Context<Ctx>): WriteMeta {
  const headers = new Headers(c.req.raw.headers);
  const named = /^"(0|[1-9][0-9]*)\//.exec(headers.get('If-Match') ?? '');
  if (named) headers.set('Idempotency-Key', `${named[1]}:${crypto.randomUUID()}`);
  return catalogMeta(c, undefined, false, headers);
}

/** P91: the file a load carries, as the import reads it: CSV by its header, or JSON by its records' carrier (`?path=`). */
async function loadedFile(c: Context<Ctx>, format: string): Promise<Response | { records: unknown[]; document?: { value: unknown; accepted: ReadonlySet<string> } }> {
  if (format === 'csv') {
    const text = await readInputText(c.req.raw.body);
    if (!text.trim()) return c.json({ error: 'body must be CSV text' }, 400);
    const table = parseCsvTable(text);
    // A header that matches a documented column only when case is ignored is a
    // typo the boundary can recognise, and reading it as an unknown column
    // would land every row with that field empty (F27 §5.3). Refused, naming
    // the column the feed sent and the spelling the contract publishes. The
    // columns are the feed's own parsed HEADER, so a header-only export and one
    // whose rows are all blank are refused by exactly the same words as an
    // export with rows, rather than by reporting that no record was found.
    const variants = csvColumnCaseVariants(table.columns);
    if (variants.length) return c.json({ ok: false, errors: variants.map(({ column, expected }) =>
      `column '${column.slice(0, 64)}': column names are matched exactly; the published contract spells this column '${expected}'`) }, 422);
    return { records: table.records };
  }
  const body = await readInputJson(c.req.raw.body);
  if (body === null) return c.json({ error: 'body must be JSON' }, 400);
  const found = recordsInJson(body, c.req.query('path') ?? undefined);
  return { records: found.records, document: { value: body, accepted: catalogDocumentFields(found.carrier) } };
}
const formatOf = (c: Context<Ctx>) => (c.req.query('format') ?? '').toLowerCase() || (c.req.header('content-type')?.includes('csv') ? 'csv' : 'json');

/**
 * POST /content/catalog/import?scope=&format=json|csv&mode=merge|replace|full&expire=&dryRun=1&path=
 * JSON: the body, or its `pieces` / `content` / `items` array, or ?path=a.b.
 * CSV: header row of CSV_COLUMNS in any order; tags as `dim:value;dim:v1|v2`.
 * P91 (R-P330): the authority, then the import-sources list, then the mode, the switch and the guard, then the
 * preconditions; the assembly, the guard's count and the skip are the publication's, before any write.
 */
contentRoutes.post('/catalog/import', async (c) => {
  const scope = catalogScope(c);
  const outside = await sourceRefusal(c, scope); if (outside) return outside;
  const mode = c.req.query('mode');
  if (!isImportMode(mode)) return modeRefusal(c);
  const dryRun = c.req.query('dryRun');
  if (dryRun !== undefined && dryRun !== '1') return c.json({ ok: false, code: 'invalid_dry_run', error: 'dryRun must be 1 (a dry run, which writes nothing) or absent' }, 400);
  const expire = guardOf(c, mode, c.req.query('expire')); if (expire instanceof Response) return expire;
  const meta = dryRun === '1' ? dryRunMeta(c) : catalogMeta(c);
  const format = formatOf(c);
  const note = noteOf(c.req.query('note')) || `${format} import (${mode})`;
  const file = await loadedFile(c, format); if (file instanceof Response) return file;
  return importInto(c, file.records, mode, note, { format, path: c.req.query('path') ?? null }, meta, file.document, { dryRun: dryRun === '1', expire });
});

// ── P98 (E25, R-P549, design C2): files staged in parallel, published once ─────────────────────────────────────────
//
// A catalogue of 40,000 products is sent as files of up to 5,000 (today's input caps), each STAGED over the same
// base — the catalogue revision and set its If-Match names — and in parallel: a stage runs the import's whole
// assembly for its file (the modes per product, the vocabulary, the validator, the refusals of an id in two places
// against the base), writes ONE pack holding each part whose digest moved and the stage's directory, and publishes
// nothing. The PUBLISH then names the stages: it reads each stage's directory (one ranged read), runs the refusals of
// an id in two places ACROSS them, as across one file, rebuilds the shards and id shards the stages touch into one
// pack, and commits them all in one compare-and-set. A stage's parts stay in its pack, which the revision's pack table
// names. A stage never published names nothing, and the pack-aware purge collects it past the grace.

/** P98 (C2): a stage's id, as its answer gives it: its pack's digest, its directory's digest and the directory's place. */
const STAGE_ID = /^([0-9a-f]{64})\.([0-9a-f]{64})\.(0|[1-9][0-9]{0,9})\.([1-9][0-9]{0,8})$/;
/** P98 (C2): the most stages one publish names. */
const MAX_STAGES = 64;
/** P98 (C2): what a stage keeps of its assembly for the publish (`assembleParted`). */
interface StageSink {
  products: Map<string, { part: CatalogPart; pointer: CatalogPartPointer; moved: boolean }>;
  owners: Map<string, string | null>;
  moves: Array<{ id: string; from: string; to: string; at: string }>;
  shared: ContentPiece[] | null;
}
/**
 * P98 (C2): a stage's directory, the last object of its pack: the base it was assembled over, every product the file
 * names with its part pointer after the load (a range in this pack where its digest moved), the record ids whose place
 * it changes, every record id the file carries (its address in the file and its product, null for a shared record),
 * the records it would move from a product the file does not carry, the shared pieces where it acts on them, and the
 * counts its answer gave.
 */
interface StageDirectory {
  schema: 'catalog-stage/v1'; scope: string; base: { revision: number; publication: { revision: number; digest: string } }; mode: ImportMode;
  received: number; imported: number; changed: number; removed: number;
  products: Record<string, { digest: string; records: number; at?: number; bytes?: number }>;
  owners: Record<string, string | null>;
  sent: Record<string, [string, string | null]>;
  moves: Array<{ id: string; from: string; to: string; at: string }>;
  shared: ContentPiece[] | null;
}
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
function stageDirectoryOf(value: unknown, scope: string): StageDirectory | null {
  if (!isObject(value) || value.schema !== 'catalog-stage/v1' || value.scope !== scope || !isObject(value.base) || !isObject(value.products) || !isObject(value.owners)
    || !isObject(value.sent) || !Array.isArray(value.moves) || !(value.shared === null || Array.isArray(value.shared))) return null;
  return value as unknown as StageDirectory;
}
const stageName = (id: string) => `stage ${id.slice(0, 12)}`;
const stageMissing = (id: string) => new PublicationError(`${stageName(id)} is not stored (never written, or collected as a stage never published); stage its file again; nothing was written`, 410, 'stage_missing');
/**
 * R-P646: a stage stored too long ago to name: the purge collects a pack no revision names 15 minutes after the store
 * took it, so a publish names a stage stored less than 10 minutes before (less than 14 once it holds the head).
 */
const stageExpired = (id: string) => new PublicationError(`${stageName(id)} was stored 10 minutes ago or more, and the purge may collect a stage never published from 15 minutes; stage its file again; nothing was written`, 410, 'stage_missing');

/**
 * POST /content/catalog/stage?scope=&format=json|csv&mode=merge|replace|full&expire=&path=  (P98, C2)
 * One file of a load, assembled over the base its If-Match names (`"<catalogue revision>/<set revision>/<set digest>"`,
 * as the import's) and written as one pack; nothing is published. Answers its `stage` id for the publish. The order
 * is the import's: the authority, the import-sources list, the mode and the guard, then the preconditions.
 */
contentRoutes.post('/catalog/stage', async (c) => {
  const scope = catalogScope(c);
  const outside = await sourceRefusal(c, scope); if (outside) return outside;
  const mode = c.req.query('mode');
  if (!isImportMode(mode)) return modeRefusal(c);
  if (c.req.query('dryRun') !== undefined) return c.json({ ok: false, code: 'invalid_dry_run', error: 'a stage publishes nothing; a dry run is the import\'s (POST /content/catalog/import?dryRun=1)' }, 400);
  const expire = guardOf(c, mode, c.req.query('expire')); if (expire instanceof Response) return expire;
  // A stage carries no Idempotency-Key: its pack is content-addressed and it publishes nothing.
  const meta = dryRunMeta(c), format = formatOf(c);
  const file = await loadedFile(c, format); if (file instanceof Response) return file;
  const { pieces: incoming, positions } = positionedCandidates(file.records);
  if (incoming.length === 0) return c.json({ ok: false, errors: ['no records found in the import'] }, 422);
  const vocabulary = await catalogueVocabularyRefusals(c, scope, { pieces: incoming });
  if (vocabulary) return c.json({ ok: false, errors: recordAddressed(vocabulary.errors, incoming, positions), received: file.records.length }, vocabulary.status);
  // The base: the set and the catalogue revision the If-Match names, else 409 as a stale import.
  const set = await pinPublication(c.env, scope), named = meta.expectedPublication!;
  if (set.revision !== named.revision || set.digest !== named.digest) throw new PublicationError('Publication conflicts with the retained operation or authored revision set', 409, 'publication_conflict');
  const current = (await readPinnedPublication(c.env, CONTENT_KIND, scope, set));
  if (current.revision !== meta.expectedRevision) throw new PublicationError('Publication conflicts with the retained operation or authored revision set', 409, 'publication_conflict');
  if (!current.value.productSlots) {
    return c.json({ ok: false, code: 'stage_unsupported', error: 'staged files load a catalogue that declares productSlots; load this catalogue with POST /content/catalog/import' }, 422);
  }
  const sink: Parameters<typeof assembleParted>[8] = {}, stage: StageSink = { products: new Map(), owners: new Map(), moves: [], shared: null };
  const addressed = (errors: string[]) => sink.placed ? recordAddressed(errors, sink.placed.pieces, sink.placed.positions) : errors;
  let parted: Awaited<ReturnType<typeof assembleParted>>;
  try { parted = await assembleParted(c.env, scope, current.value, set, incoming, positions, mode, { expire }, sink, stage); }
  catch (error) {
    if (error instanceof VocabularyRefusal) return c.json({ ok: false, errors: addressed(error.errors), received: file.records.length }, 422);
    if (error instanceof HeldLoad && error.held === 'expire') {
      return c.json({ ok: false, error: `mode=full expires ${error.expiring} stored piece${error.expiring === 1 ? '' : 's'} the file leaves out; expire=${expire} names another number, so nothing was written`,
        code: 'expire_mismatch', expire: error.expiring }, 409);
    }
    throw error;
  }
  if (parted.document !== undefined) {
    const checked = CONTENT_KIND.validate(parted.document);
    return c.json({ ok: false, errors: addressed(checked.ok ? ['the staged records do not validate'] : checked.errors), received: file.records.length }, 422);
  }
  // The stage's one pack: each part whose digest moved, then its directory.
  const pack = new PackWriter(), products: StageDirectory['products'] = {}, slots = new Set(current.value.productSlots);
  for (const [product, { part, pointer, moved }] of stage.products) {
    if (!moved) { products[product] = { digest: pointer.digest, records: pointer.records }; continue; }
    const at = await pack.add(part, partTooLarge(product));
    products[product] = { digest: pointer.digest, records: pointer.records, at: at.at, bytes: at.bytes };
  }
  const sent: StageDirectory['sent'] = {};
  incoming.forEach((piece, j) => { if (typeof piece.id === 'string') sent[piece.id] = [recordAddress(positions[j]!, piece.id), partProductOf(piece, slots)]; });
  const compared = sink.touched ?? { before: { pieces: [] }, after: { pieces: [] } };
  const directory: StageDirectory = { schema: 'catalog-stage/v1', scope, base: { revision: current.revision, publication: { revision: set.revision, digest: set.digest } }, mode,
    received: file.records.length, imported: incoming.length, changed: changedPieces(compared.before, compared.after), removed: removedPieces(compared.before, compared.after),
    products, owners: Object.fromEntries(stage.owners), sent, moves: stage.moves, shared: stage.shared };
  const at = await pack.add(directory, () => new PublicationError(`The stage's directory would pass ${STAGE_DIRECTORY_MAX_BYTES} bytes; stage the file in smaller files; nothing was written`, 413, 'load_too_large'), STAGE_DIRECTORY_MAX_BYTES);
  // R-P646: a pack already stored (the same file staged again over the same base) is taken while young, else written fresh.
  const written = await writePack(c.env, scope, (await pack.seal())!);
  const view = { ...current.value, pieces: compared.after.pieces };
  return c.json({ ok: true, staged: true, scope, mode, stage: `${written.pack.digest}.${at.digest}.${at.at}.${at.bytes}`,
    base: { revision: current.revision, publication: current.publication }, received: directory.received, imported: directory.imported,
    products: Object.keys(products).length, changed: directory.changed, removed: directory.removed, changedBasis: 'stored' as const,
    diagnostics: withVariantFirst(await catalogDiagnostics(c.env, scope, view, null,
      { records: file.records, accepted: FEED_FIELDS, ...(file.document ? { document: file.document } : {}), pieceRecords: storedPieceRecords(view, incoming, positions) }), current.value, incoming, positions) });
});

/**
 * P98 (C2): the publication of staged files over the catalogue in force: each stage's pack headed (its size, for the
 * pack table) and its directory read by one ranged read; every stage over this very base (409 `stage_stale` otherwise);
 * no product, and no record id, in two stages, and the shared pieces acted on by one stage at most (422 `stage_overlap`,
 * or the collision an id in two places is in one file: `record_moved`, `id_in_part`, `id_shared`); a record a stage
 * moves from a product another stage carries leaves that product's part, as in one file, and one moved from a product
 * no stage carries is refused `record_moved`. Answers the manifest, the built index and the counts.
 */
async function stagedPlan(env: Env, scope: string, current: ContentCatalog, ids: readonly string[], expected: { revision: number; publication: { revision: number; digest: string } }):
  Promise<{ manifest: ContentCatalog; stages: Array<{ id: string; pack: string }>; counts: { received: number; imported: number; changed: number; removed: number };
    writing: () => Promise<{ manifest: ContentCatalog; built: BuiltIndex }> }> {
  if (!current.productSlots) throw new PublicationError('staged files load a catalogue that declares productSlots', 422, 'stage_unsupported');
  const stages: Array<{ id: string; pack: string; directory: StageDirectory }> = [], sizes = new Map<string, number>();
  for (const id of ids) {
    const m = STAGE_ID.exec(id)!, pack = m[1]!, held = await catalogPackHeld(env, scope, pack);
    if (!held) throw stageMissing(id);
    if (!stagePackNameable(held, false)) throw stageExpired(id);
    sizes.set(pack, held.size);
    const directory = stageDirectoryOf(await readStageDirectory(env, scope, m[2]!, { pack, at: Number(m[3]), bytes: Number(m[4]) }), scope);
    if (!directory) throw stageMissing(id);
    if (directory.base.revision !== expected.revision || directory.base.publication.revision !== expected.publication.revision || directory.base.publication.digest !== expected.publication.digest) {
      throw new PublicationError(`${stageName(id)} was staged over catalogue revision ${directory.base.revision}, not the revision this publish names (${expected.revision}); stage the files again over the catalogue in force; nothing was written`, 409, 'stage_stale');
    }
    stages.push({ id, pack, directory });
  }
  // No product in two stages, and the shared pieces acted on by one stage at most.
  const carrier = new Map<string, number>(), overlaps: string[] = [];
  stages.forEach(({ id, directory }, k) => {
    for (const product of Object.keys(directory.products)) {
      const other = carrier.get(product);
      if (other === undefined) carrier.set(product, k); else overlaps.push(`product ${quotedId(product)} is loaded by ${stageName(stages[other]!.id)} and ${stageName(id)}`);
    }
  });
  const sharing = stages.filter(({ directory }) => directory.shared !== null);
  if (sharing.length > 1) overlaps.push(`the shared pieces are loaded by ${sharing.map(({ id }) => stageName(id)).join(' and ')}`);
  if (overlaps.length) throw new PublicationError(`${overlaps.slice(0, 20).join('; ')}${overlaps.length > 20 ? `; and ${overlaps.length - 20} more` : ''}; a product, and the shared pieces, are loaded by one staged file; nothing was written`, 422, 'stage_overlap');
  // An id in two places, across the stages as within one file, and named in the order one file names them: the records
  // moved first, then a shared piece whose id a part record holds, then a part record whose id a shared piece holds.
  const moved: Collision[] = [], inPart: Collision[] = [], inShared: Collision[] = [], sentBy = new Map<string, [string, string | null]>();
  for (const { directory } of stages) for (const [id, [at, product]] of Object.entries(directory.sent)) {
    const other = sentBy.get(id);
    if (!other) { sentBy.set(id, [at, product]); continue; }
    if (product !== null && other[1] !== null) moved.push(movedCollision(at, other[1], product));
    else if (product !== null || other[1] !== null) {
      const [sharedAt, partAt, owner] = product === null ? [at, other[0], other[1]!] : [other[0], at, product];
      inPart.push(inPartCollision(sharedAt, owner)); inShared.push(sharedCollision(partAt, owner));
    }
  }
  const leaving = new Map<string, Set<string>>();
  for (const { directory } of stages) for (const move of directory.moves) {
    if (!carrier.has(move.from)) { moved.push(movedCollision(move.at, move.from, move.to)); continue; }
    leaving.set(move.from, (leaving.get(move.from) ?? new Set()).add(move.id));
  }
  const collisions = [...moved, ...inPart, ...inShared];
  if (collisions.length) throw collisionRefusal(collisions);
  // The index's edits: each staged part where its digest moved (in its stage's pack), each record a stage moves out of
  // a product another stage carries dropped from that product's part, and the ids whose place changed.
  const edit = new IndexEdit(env, scope, current);
  await edit.prefetchShards(carrier.keys());
  for (const { pack, directory } of stages) for (const [product, p] of Object.entries(directory.products)) {
    if (p.at !== undefined && p.bytes !== undefined) edit.setPointer(product, { digest: p.digest, records: p.records, address: { pack, at: p.at, bytes: p.bytes } });
  }
  for (const [product, ids] of leaving) {
    const pointer = await edit.pointer(product);
    if (!pointer) continue;
    const part = await edit.part(pointer), pieces = (part.pieces as ContentPiece[]).filter(piece => !ids.has(piece.id));
    if (pieces.length === part.pieces.length) continue;
    edit.place(product, { product, pieces }, { digest: await documentDigest({ product, pieces } satisfies CatalogPart), records: pieces.length });
  }
  const owners = new Map<string, string | null>();
  for (const { directory } of stages) for (const [id, product] of Object.entries(directory.owners)) if (product !== null || !owners.has(id)) owners.set(id, product);
  await edit.prefetchIdShards(owners.keys());
  for (const [id, product] of owners) edit.setOwner(id, product);
  const version = carriedVersion(current), shared = sharing[0]?.directory.shared ?? current.pieces;
  const members = { ...(version ? { version } : {}), ...(current.typeFallback ? { typeFallback: current.typeFallback } : {}), productSlots: current.productSlots };
  const counts = { received: 0, imported: 0, changed: 0, removed: 0 };
  for (const { directory } of stages) for (const key of ['received', 'imported', 'changed', 'removed'] as const) counts[key] += directory[key];
  // The skip reads the index as the stages leave it; the publish that writes builds it once more (`IndexEdit.build`'s `writing`).
  const plain = await edit.build({ sizes });
  const writing = async () => { const built = await edit.build({ writing: true, sizes }); return { manifest: manifestOf(members, shared, built.index), built }; };
  return { manifest: manifestOf(members, shared, plain.index), stages: stages.map(({ id, pack }) => ({ id, pack })), counts, writing };
}

/**
 * POST /content/catalog/publish?scope=  { stages: ["<stage id>", …], note? }  (P98, C2)
 * The staged files published once, over the catalogue revision and set the If-Match names, with an Idempotency-Key, as
 * an import is: one head reservation, one commit. A publish whose result is the catalogue in force writes nothing (the
 * skip). Each stage's pack is headed again once the head is held; one collected meanwhile abandons the reservation and
 * answers 410 `stage_missing`, nothing written.
 */
contentRoutes.post('/catalog/publish', async (c) => {
  const scope = catalogScope(c);
  const outside = await sourceRefusal(c, scope); if (outside) return outside;
  const body = await readInputJson(c.req.raw.body) as { stages?: unknown; note?: unknown } | null;
  const ids = body?.stages;
  if (!Array.isArray(ids) || !ids.length || ids.length > MAX_STAGES || !ids.every(id => typeof id === 'string' && STAGE_ID.test(id)) || new Set(ids).size !== ids.length) {
    return c.json({ ok: false, code: 'invalid_stages', error: `stages must name 1 to ${MAX_STAGES} distinct stage ids, each as POST /content/catalog/stage answered it` }, 400);
  }
  const meta = catalogMeta(c), note = noteOf(body?.note) || `publish of ${ids.length} staged file${ids.length === 1 ? '' : 's'}`, held: PackHold = {};
  let plan: Awaited<ReturnType<typeof stagedPlan>> | undefined, base: ContentCatalog | undefined;
  const stillHeld = async () => {
    await packReserved(c.env, scope, held)();
    for (const stage of plan?.stages ?? []) {
      const stored = await catalogPackHeld(c.env, scope, stage.pack);
      if (!stored) throw stageMissing(stage.id);
      if (!stagePackNameable(stored, true)) throw stageExpired(stage.id);
    }
  };
  let result;
  try {
    result = await publish<ContentCatalog>(c.env, CONTENT_KIND, scope, { type: 'publish', stages: ids }, { ...meta, note }, async (current, set) => {
      base = current;
      plan = await stagedPlan(c.env, scope, current, ids as string[], { revision: meta.expectedRevision!, publication: meta.expectedPublication! });
      if (await documentDigest(CONTENT_KIND.stamp!(plan.manifest, meta.expectedRevision!)) === await documentDigest(current)) throw new HeldLoad('unchanged', current);
      const written = await plan.writing();
      manifestCap(written.manifest, set);
      // P98: the publish's one pack (the shards and id shards the stages touch), before the head is reserved.
      const index = await writeIndex(c.env, scope, written.built, held);
      return index === written.built.index ? written.manifest : { ...written.manifest, index };
    }, { reserved: stillHeld, retry: true });
  } catch (error) {
    if (error instanceof PublicationError && error.code === 'document_too_large') throw namedManifest(error);
    if (error instanceof HeldLoad && error.held === 'unchanged' && plan) {
      return c.json({ ok: true, scope, stages: ids.length, ...plan.counts, changed: 0, removed: 0, changedBasis: 'stored' as const, skipped: true, reason: 'unchanged',
        pieces: catalogPieceCount(base!), revision: meta.expectedRevision, publication: meta.expectedPublication, version: base!.version ?? '' });
    }
    throw error;
  }
  if (!result.ok) return c.json({ ok: false, errors: result.errors }, 422);
  return c.json({ ok: true, scope, stages: ids.length, ...(plan ? { ...plan.counts, changedBasis: 'stored' as const } : { changed: null, removed: null, changedBasis: 'unavailable' as const }),
    pieces: catalogPieceCount(result.revision.value), revision: result.revision.revision, publication: result.revision.publication, version: result.revision.value.version ?? '' });
});

/**
 * POST /content/catalog/pull  { url, path?, mode, expire?, note? }
 * The CMS/DAM seam: the worker fetches a JSON document and imports it.
 * P91 (R-P330): the body is read first, for the mode and the guard it carries; then the order is the import's.
 * P90 (E15, R-P344): the URL is https (http only on a loopback host) and, with the tenant's import-sources naming
 * `hosts`, one of those hosts; both are checked before the preconditions, so nothing is fetched or written for a URL
 * refused; the fetch follows no redirect.
 */
contentRoutes.post('/catalog/pull', async (c) => {
  const scope = catalogScope(c);
  const body = await readInputJson(c.req.raw.body) as { url?: unknown; path?: unknown; mode?: unknown; expire?: unknown; note?: unknown } | null;
  const outside = await sourceRefusal(c, scope); if (outside) return outside;
  const mode = body?.mode;
  if (!isImportMode(mode)) return modeRefusal(c);
  const expire = guardOf(c, mode, body?.expire); if (expire instanceof Response) return expire;
  const target = pullUrlOf(body?.url);
  if (!target) return c.json({ ok: false, code: 'invalid_url', error: 'url must be an https URL (http only on localhost, 127.0.0.1 or [::1])' }, 400);
  const { revision: sources } = await readOptionalPublication(c.env, IMPORT_SOURCES_KIND, scope);
  if (sources?.value.hosts && !hostAllowed(sources.value.hosts, target)) {
    return c.json({ ok: false, code: 'host_not_allowed', error: `the feed host ${target.host} is outside the hosts of the tenant's import-sources list; nothing was fetched` }, 403);
  }
  const meta = catalogMeta(c);
  await assertPublicationBase(c.env, CONTENT_KIND, scope, meta);
  const url = target.href;
  let pulled: PulledExport;
  try {
    pulled = await new HttpJsonSource(url, typeof body?.path === 'string' ? body.path : undefined).pullExport();
  } catch (e) {
    if (e instanceof InputError && e.status === 413) throw e;
    return c.json({ ok: false, errors: [`pull failed: ${e instanceof Error ? e.message : String(e)}`] }, 502);
  }
  return importInto(c, pulled.records, mode, noteOf(body?.note) || `pull from ${new URL(url).host} (${mode})`,
    { type: 'pull', url, path: typeof body?.path === 'string' ? body.path : null }, meta,
    { value: pulled.document, accepted: catalogDocumentFields(pulled.carrier) }, { expire });
});

function publicationTarget(c: Context<Ctx>) {
  const tenant = catalogScope(c), selectors = c.req.queries('kind'), scopes = c.req.queries('memberScope');
  if (selectors && selectors.length !== 1 || scopes && scopes.length !== 1) throw new PublicationError('Ambiguous publication target', 400, 'invalid_precondition');
  const name = selectors?.[0] ?? 'catalog', kind = name === 'reflex' ? REFLEX_KIND : kindOf(name)?.kind;
  if (!kind) throw new PublicationError('Unsupported publication kind', 400, 'invalid_precondition');
  const scope = scopes?.[0] ?? (name === 'reflex' && tenant === 'brighthour' ? 'tenant:brighthour' : tenant);
  if (publicationScope(kind, scope) !== tenant || name !== 'reflex' && scope !== tenant) throw new PublicationError('Publication target unavailable', 403, 'tenant_unavailable');
  return { kind, scope };
}
contentRoutes.get('/catalog/publication', c => {
  const { kind, scope } = publicationTarget(c);
  const meta = c.req.header('If-Match') || c.req.header('Idempotency-Key') ? catalogMeta(c, undefined, isOptionalMember(kind)) : undefined;
  return publicationStatus(c.env, kind, scope, meta).then(status => c.json(status));
});
contentRoutes.post('/catalog/publication/recover', async c => {
  const { kind, scope } = publicationTarget(c), meta = catalogMeta(c, undefined, isOptionalMember(kind));
  const result = await recoverPublication(c.env, kind, scope, meta);
  return result.ok ? c.json({ ok: true, revision: result.revision.revision, publication: result.revision.publication, document: result.revision.value,
    ...(kind.name === 'content' ? { diagnostics: await catalogDiagnostics(c.env, scope, result.revision.value, result.revision.revision) } : {}) }) : c.json(result, 422);
});

// ── W08: a provisioned tenant's first configuration publication set ─────────

/**
 * W08 (document 35 §5 row W08: seed idempotently, fail visibly; decision D01):
 * POST /content/publication/initialize creates a provisioned tenant's FIRST
 * configuration publication set, on every deployment profile.
 *
 * Every versioned write publishes over a committed set, so a tenant without one
 * can never be configured: the demo door (src/routes/demoBootstrap.ts) is not
 * mounted on the customer profile, and scripts/init-local.mjs acts only on a
 * local store. This door writes exactly what init-local writes — the six
 * compiled defaults below, in its order, each at revision 1 — attributed to the
 * caller. It takes no document: nothing is supplied, discovered, migrated or
 * defaulted from the caller, and a request carrying anything is refused.
 *
 * Authority, in the order a request meets it: the tenant middleware (a
 * provisioned tenant), `operatorJwt` above (a credential, then in enforced mode
 * a grant on the tenant), `catalogScope` (a typed credential granted to the
 * tenant, in every mode), then a stamp owner's own human session. A service
 * credential never qualifies: its subject is whatever its issuer named.
 *
 * Idempotent, failing visibly:
 *  · a committed set answers `already initialized` and writes nothing;
 *  · a tenant with no committed set can hold only a pending INITIALIZATION
 *    (the head validation of src/config/publication.ts); it is re-issued with
 *    its own operationId, actor, note and time, which the library initializer
 *    finishes when it is this same request and refuses 409
 *    `publication_conflict`, before writing anything, when it is not;
 *  · a storage failure answers its PublicationError (503, `contentRoutes.onError`),
 *    and the same call again finishes what it left pending.
 * One owner-action audit row is written per set this door writes.
 */
const INITIALIZE_NOTE = 'initialized from the compiled defaults (POST /content/publication/initialize)';
const NO_DOCUMENT = 'no document is accepted; publish through /content and /config';
/** init-local's members and compiled defaults, in init-local's order (scripts/init-local.mjs). */
function compiledBaselines(tenant: string, revision: Omit<Revision<unknown>, 'value' | 'publication'>): PublicationBaseline[] {
  const members: Array<[DocumentKind<unknown>, string, unknown]> = [
    [CONTENT_KIND as DocumentKind<unknown>, tenant, EMPTY_CATALOG],
    [SLOTS_KIND as DocumentKind<unknown>, tenant, DEFAULT_SLOTS],
    [LEARN_KIND as DocumentKind<unknown>, tenant, DEFAULT_LEARN],
    [REFLEX_KIND as DocumentKind<unknown>, reflexScopeForTenant(tenant), DEFAULT_REFLEX_CONFIG],
    [PRIORS_KIND as DocumentKind<unknown>, tenant, EMPTY_PRIORS],
    [PROPOSALS_KIND as DocumentKind<unknown>, tenant, EMPTY_PROPOSALS],
  ];
  return members.map(([kind, scope, value]) => ({ kind, scope, revision: { ...revision, value } }));
}
/** The door's only request: no body, or an empty JSON object. */
function carriesNothing(text: string): boolean {
  if (!text.trim()) return true;
  try {
    const value: unknown = JSON.parse(text);
    return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0;
  } catch { return false; }
}
contentRoutes.post('/publication/initialize', async (c) => {
  const tenant = catalogScope(c), auth = c.get('auth'), user = auth.user!;
  if (user.type !== 'access' || auth.authority?.credentialId !== undefined || !stampOwner(c.env, user.sub)) {
    return c.json({ ok: false, error: 'Stamp owner required' }, 403);
  }
  if (!carriesNothing(await readInputText(c.req.raw.body))) return c.json({ ok: false, error: NO_DOCUMENT }, 400);

  const status = await publicationStatus(c.env, CONTENT_KIND, tenant).catch((error: unknown) => {
    if (error instanceof PublicationError && error.code === 'publication_uninitialized') return null; // no head at all
    throw error;
  });
  if (status?.publication) return c.json({ ok: true, publication: status.publication.revision, state: 'already initialized' });
  const intent = status
    ? { operationId: status.operationId, actor: status.actor, note: status.note, at: status.at }
    : { operationId: `0:${crypto.randomUUID()}`, actor: user.sub, note: INITIALIZE_NOTE, at: Date.now() };
  const { operationId, actor, note, at } = intent;
  if (typeof operationId !== 'string' || typeof actor !== 'string' || typeof note !== 'string' || typeof at !== 'number') {
    throw new PublicationError('Configuration publication authority unavailable');
  }
  const set = await initializePublicationSet(c.env, compiledBaselines(tenant, { revision: 1, actor, note, at }), operationId);
  invalidateConfigCache(reflexScopeForTenant(tenant));
  const state = status ? 'initialization finished' : 'initialized';
  await storeFor(c.env).audit({ at: Date.now(), action: 'publication_initialized', actorId: user.sub, actorEmail: user.email ?? null,
    targetId: tenant, detail: JSON.stringify({ operationId, publication: set.revision, state }) });
  return c.json({ ok: true, publication: set.revision, state });
});

/**
 * P54 (R-P78; D01: it creates, it never overwrites): POST
 * /content/publication/complete, the W08 door's sibling, adds `priors` and
 * `proposals` to a COMMITTED set that lacks them, on every deployment profile.
 *
 * A set holds four members only when the demo bootstrap created it before it
 * seeded six, which reaches a customer deployment only through a retained
 * adoption; the demo bootstrap's completion path is not mounted there, and the
 * door answers such a set `already initialized`, which is true. This is the
 * completion as its own named act: each member the committed set lacks is added
 * as its compiled empty at revision 1, in one set publication that changes no
 * other member (`completePublicationSet`, src/config/publication.ts), attributed
 * to the caller.
 *
 * The door's authority, in the door's order: the tenant middleware,
 * `operatorJwt` above, `catalogScope`, then a stamp owner's own human session;
 * no document is accepted. Every refusal answers before anything is read or
 * written.
 *
 *  · it answers `{ added, ok, publication, state: 'completed' }` with `added`
 *    naming the members added as an operator reads them and `publication` the
 *    new set's revision;
 *  · a set that has both answers `added: []`, `already complete`, with the
 *    committed set's revision, and writes nothing;
 *  · a scope with no committed set is refused 503 `publication_uninitialized`
 *    (`contentRoutes.onError`); the door initializes it, with six;
 *  · a completion left pending by an interrupted call is finished by the next
 *    one; any other pending publication is refused 409 `publication_conflict`.
 * One owner-action audit row, the door's action, is written per set this path
 * writes; none for `already complete`, a refusal or a failure.
 */
const COMPLETE_NOTE = 'completed with the compiled empties (POST /content/publication/complete)';
contentRoutes.post('/publication/complete', async (c) => {
  const tenant = catalogScope(c), auth = c.get('auth'), user = auth.user!;
  if (user.type !== 'access' || auth.authority?.credentialId !== undefined || !stampOwner(c.env, user.sub)) {
    return c.json({ ok: false, error: 'Stamp owner required' }, 403);
  }
  if (!carriesNothing(await readInputText(c.req.raw.body))) return c.json({ ok: false, error: NO_DOCUMENT }, 400);

  const { added, set } = await completePublicationSet(c.env, tenant, { actor: user.sub, note: COMPLETE_NOTE });
  if (!added.length) return c.json({ added, ok: true, publication: set.revision, state: 'already complete' });
  const state = 'completed';
  await storeFor(c.env).audit({ at: Date.now(), action: 'publication_initialized', actorId: user.sub, actorEmail: user.email ?? null,
    targetId: tenant, detail: JSON.stringify({ added, operationId: set.operation.operationId, publication: set.revision, state }) });
  return c.json({ added, ok: true, publication: set.revision, state });
});

// ── P38: the vocabulary's approval and its rejection report ─────────────────

/**
 * POST /content/vocabulary/approve/:n — the tenant's operator puts stored
 * vocabulary revision n in effect (decision D1). Authored like every write:
 * If-Match names the vocabulary revision and the set the operator read, with an
 * Idempotency-Key; the approval is its own member, so no vocabulary revision is
 * written and a later revision blocks nothing. Any stored revision may be put
 * in effect, an earlier one included; an unknown revision answers 404.
 */
contentRoutes.post('/vocabulary/approve/:n', async (c) => {
  const scope = catalogScope(c), meta = catalogMeta(c);
  const n = Number(c.req.param('n'));
  if (!Number.isSafeInteger(n) || n < 1) return c.json({ ok: false, error: 'revision must be a positive integer' }, 400);
  const body = await readInputJson(c.req.raw.body, {});
  const { revision: latest } = await readOptionalPublication(c.env, VOCABULARY_KIND, scope);
  if (!latest || n > latest.revision) return c.json({ ok: false, error: `vocabulary revision ${n} not found for scope "${scope}"` }, 404);
  const approved = n === latest.revision ? latest : await readVersion(c.env, VOCABULARY_KIND, scope, n);
  if (!approved) return c.json({ ok: false, error: `vocabulary revision ${n} not found for scope "${scope}"` }, 404);
  const note = noteOf((body as { note?: unknown } | null)?.note) || `approve vocabulary revision ${n}`;
  const result = await publishAnchored(c.env, { kind: VOCABULARY_KIND, scope },
    { kind: VOCABULARY_APPROVAL_KIND, scope, request: { type: 'approve', revision: n, vocabularyRevision: meta.expectedRevision }, candidate: () => ({ revision: n, document: approved.value }) },
    { ...meta, note });
  return result.ok
    ? c.json({ ok: true, scope, kind: VOCABULARY_KIND.name, revision: meta.expectedRevision, effectiveRevision: result.revision.value.revision, publication: result.revision.publication,
        approval: { revision: result.revision.revision, actor: result.revision.actor, note: result.revision.note, at: result.revision.at } })
    : c.json({ ok: false, errors: result.errors }, 422);
});

/**
 * GET /content/vocabulary/rejections — the tenant's rejection report: per
 * governed attribute, each value the ingest hosts refused under the revision in
 * effect and how many events carried it (src/content/service.ts
 * `recordVocabularyRejections`). Empty when no revision is in effect or nothing
 * was refused; a report that cannot be read answers 503, never an empty one.
 */
contentRoutes.get('/vocabulary/rejections', async (c) => {
  const scope = catalogScope(c);
  const { revision: approval } = await readOptionalPublication(c.env, VOCABULARY_APPROVAL_KIND, scope);
  const effectiveRevision = approval?.value.revision ?? 0;
  let report;
  try { report = await readVocabularyRejections(c.env, scope, effectiveRevision, Date.now()); }
  catch { return c.json({ ok: false, error: 'The rejection report is unavailable' }, 503); }
  return c.json({ scope, kind: VOCABULARY_KIND.name, effectiveRevision, since: report.since, rejections: report.rejections, omitted: report.omitted });
});

export default contentRoutes;

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
  readOptionalPublication, readPublication, recoverPublication, documentDigest, type PublicationBaseline, type PublicationPin } from '@/config/publication';
import { catalogNamesRuleWords, catalogRuleErrors, CONTENT_KIND, DEFAULT_LEARN, DEFAULT_SLOTS, EMPTY_CATALOG, governedCatalogue, LEARN_KIND, learnBlendLayoutErrors, learnConversionDiagnostics, learnPositionLayoutErrors, type LearnConversionDiagnostics, namesPositionDials, PIECE_FIELDS, slotInnerCatalogueErrors, slotOrderCatalogueErrors, slotsNameContext, SLOTS_KIND, validateSlotCatalog,
  VOCABULARY_APPROVAL_KIND, VOCABULARY_KIND, vocabularyTableOf } from '@/content/kinds';
import { readVocabularyRejections } from '@/content/service';
import { contextTermsOf } from '@/content/cell';
import { invalidateConfigCache, REFLEX_KIND, reflexScopeForTenant } from '@/reflex/configStore';
import { DEFAULT_REFLEX_CONFIG } from '@/reflex/core';
import { EMPTY_PROPOSALS, PROPOSALS_KIND } from '@/learn/cycle';
import { cellGrammarFor, EMPTY_PRIORS, parsePriorsCsv, PRIORS_KIND, priorUnitErrors, validatePriors } from '@/learn/priors';
import { addressAllowed, hostAllowed, HttpJsonSource, assembleFrom, catalogDocumentFields, csvColumnCaseVariants, FEED_FIELDS, IMPORT_SOURCES_KIND, isImportMode, parseCsvTable, pullUrlOf, positionedCandidates, recordAddressed, recordsInJson, storedPieceRecords, type ImportMode, type PulledExport } from '@/content/import';
import type { ContentCatalog, ContentPiece, DocumentEnvelope, LearnConfig, SlotCatalog, VocabularyApproval } from '@/content/types';
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
  if (error instanceof LegacyDocumentError) return c.json({ ok: false, error: error.message, code: error.code }, error.status);
  if (error instanceof PublicationError) return c.json({ ok: false, error: error.message, code: error.code }, error.status);
  throw error;
});
/**
 * P87 (E11): the eight routes of the catalogue import a `catalog-import` service credential is admitted to, marked
 * before `operatorJwt` runs (every other operator route refuses that credential there, before its handler): GET the
 * document, its history, a revision and the catalogue's publication; POST validate, import, pull and the catalogue's
 * publication recover. A kind, in the path or in `?kind=`, is read as `kindOf` reads every kind, lower-cased, so another
 * spelling answers the credential as it answers an operator; HEAD is the GET route Hono serves it as.
 */
function catalogImportRoute(c: Context<Ctx>): boolean {
  const [root, name = '', ...rest] = c.req.path.split('/').slice(1), method = c.req.method === 'HEAD' ? 'GET' : c.req.method;
  if (root !== 'content' || name.toLowerCase() !== 'catalog') return false;
  const kinds = c.req.queries('kind'), catalogueTarget = !kinds || (kinds.length === 1 && kinds[0]!.toLowerCase() === 'catalog');
  const at = (...tail: string[]) => rest.length === tail.length && tail.every((part, i) => (part === '*' ? rest[i] !== '' : rest[i] === part));
  if (method === 'GET') return at() || at('history') || at('revisions', '*') || (at('publication') && catalogueTarget);
  if (method === 'POST') return at('validate') || at('import') || at('pull') || (at('publication', 'recover') && catalogueTarget);
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
};
const UNKNOWN_KIND = 'kind must be catalog, slots, learn, priors, vocabulary or import-sources';

function kindOf(name: string | undefined) { return KINDS[(name ?? '').toLowerCase()] ?? null; }
const isVocabulary = (kind: { name: string }) => kind.name === VOCABULARY_KIND.name;
/** An optional member of the publication set (P38, P91): absent until its tenant publishes one, its first write over revision 0. */
const isOptionalMember = (kind: { name: string }) => isVocabulary(kind) || kind.name === IMPORT_SOURCES_KIND.name;

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
    const pieces = kind.name === CONTENT_KIND.name && value !== null && typeof value === 'object' && Array.isArray((value as ContentCatalog).pieces)
      ? { pieces: (value as ContentCatalog).pieces.length } : {};
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
  const previous = new Map(before.pieces.map((piece: ContentPiece) => [piece.id, JSON.stringify(piece)]));
  let changed = 0;
  for (const piece of after.pieces) if (previous.get(piece.id) !== JSON.stringify(piece)) changed++;
  return changed;
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
  if (k.kind.name === IMPORT_SOURCES_KIND.name) {
    // P91: absent until published (revision 0), and then the list in force.
    const { publication, revision: listed } = await readOptionalPublication(c.env, k.kind, scope);
    return c.json({ scope, kind: k.kind.name, source: listed ? 'stored' : 'absent', revision: listed?.revision ?? 0, publication,
      actor: listed?.actor ?? null, note: listed?.note ?? null, at: listed?.at ?? null, document: listed?.value ?? null });
  }
  const rev = await readPublication(c.env, k.kind, scope);
  const value = rev ? rev.value : k.fallback;
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
  const governedMember = (kind: DocumentKind<unknown>, document: unknown) => kind.name === CONTENT_KIND.name
    ? (_base: unknown, set: PublicationPin) => governedOver(c.env, scope, set, document) : () => document;
  let result;
  if (related !== undefined) {
    if (!Array.isArray(related) || related.length > 5) throw new PublicationError('Invalid related publication members', 422, 'invalid_document');
    const changes = [{ kind: k.kind, scope, request: { type: 'replace', candidate }, candidate: governedMember(k.kind, candidate) }];
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
    result = await publishSet(c.env, changes, { ...meta, note });
  } else {
    // P01 (R-P24): a slots document published alone is checked against the catalogue in force.
    const orders = await requestOrderRefusals(c, scope, [{ kind: k.kind, document: candidate, at: null }]);
    if (orders) return c.json({ ok: false, errors: orders.errors }, orders.status);
    // P28 (R-P31): a learn document published alone is checked against the slots document in force.
    const blends = await requestBlendRefusals(c, scope, [{ kind: k.kind, document: candidate, at: null }]);
    if (blends) return c.json({ ok: false, errors: blends.errors }, blends.status);
    // P38: the catalogue through the same replace a write makes, under the vocabulary in effect.
    result = k.kind.name === CONTENT_KIND.name
      ? await publish(c.env, k.kind, scope, { type: 'replace', candidate }, { ...meta, note }, governedMember(k.kind, candidate))
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
  const result = k.kind.name === CONTENT_KIND.name
    ? await publish(c.env, k.kind, scope, { type: 'rollback', toRevision: n }, { ...rollbackMeta, note: rollbackMeta.note ?? `rollback to revision ${n}` },
      async (_base: unknown, set: PublicationPin) => governedOver(c.env, scope, set, (await publicationVersion(c.env, k.kind, scope, n))?.value ?? null))
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
  const addressed = (errors: string[]) => placed ? recordAddressed(errors, placed.pieces, placed.positions) : errors;
  const diagnosed = (catalog: ContentCatalog, revision: number | null) => catalogDiagnostics(c.env, scope, catalog, revision,
    { records, accepted: FEED_FIELDS, ...(document ? { document } : {}), pieceRecords: storedPieceRecords(catalog, incoming, positions) });
  let result;
  try {
    // P38 (VA2): the assembled catalogue under the vocabulary in effect in the set it is published over.
    result = await publish<ContentCatalog>(c.env, CONTENT_KIND, scope, { type: 'import', source, records, mode, ...(opts.expire !== undefined ? { expire: opts.expire } : {}) },
      { ...meta, note },
      async (current, set) => {
        base = current;
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
      });
  } catch (error) {
    if (error instanceof VocabularyRefusal) return c.json({ ok: false, errors: addressed(error.errors), received: records.length }, 422);
    if (error instanceof HeldLoad) {
      if (error.held === 'expire') {
        return c.json({ ok: false, error: `mode=full expires ${error.expiring} stored piece${error.expiring === 1 ? '' : 's'} the file leaves out; expire=${opts.expire} names another number, so nothing was written`,
          code: 'expire_mismatch', expire: error.expiring }, 409);
      }
      // The skip and the dry run: nothing was written, so the answer names the revision in force.
      const stored = base!, shown = error.held === 'unchanged' ? stored : error.candidate!;
      return c.json({ ok: true, scope, mode, received: records.length, imported: incoming.length, pieces: shown.pieces.length,
        changed: error.held === 'unchanged' ? 0 : changedPieces(stored, shown), removed: error.held === 'unchanged' ? 0 : removedPieces(stored, shown),
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
  return c.json({ ok: true, scope, mode, received: records.length, imported: incoming.length, pieces: result.revision.value.pieces.length,
    changed: measured ? changedPieces(before.catalog, result.revision.value) : null,
    removed: measured ? removedPieces(before.catalog, result.revision.value) : null,
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
  const format = (c.req.query('format') ?? '').toLowerCase() || (c.req.header('content-type')?.includes('csv') ? 'csv' : 'json');
  const note = noteOf(c.req.query('note')) || `${format} import (${mode})`;
  let records: unknown[];
  let document: { value: unknown; accepted: ReadonlySet<string> } | undefined;
  if (format === 'csv') {
    const text = await readInputText(c.req.raw.body);
    if (!text.trim()) return c.json({ error: 'body must be CSV text' }, 400);
    const table = parseCsvTable(text);
    records = table.records;
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
  } else {
    const body = await readInputJson(c.req.raw.body);
    if (body === null) return c.json({ error: 'body must be JSON' }, 400);
    const found = recordsInJson(body, c.req.query('path') ?? undefined);
    records = found.records;
    document = { value: body, accepted: catalogDocumentFields(found.carrier) };
  }
  return importInto(c, records, mode, note, { format, path: c.req.query('path') ?? null }, meta, document, { dryRun: dryRun === '1', expire });
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

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
//
// :kind is catalog | slots | learn. ?scope= selects the tenant scope, as /config does.
// ─────────────────────────────────────────────────────────────────────────────

import { Hono, type Context } from 'hono';
import { InputError, inputRecords, readInputBytes, readInputJson, readInputText } from '@/config/input';
import type { Env } from '@/types/env';
import type { AuthContext } from '@/middleware/auth';
import { hasOperatorGrant, operatorJwt } from '@/middleware/operatorAuth';
import { isValidTenantId, type TenantVariables } from '@/tenancy/tenant';
import { LegacyDocumentError, readIndex, readVersion, rollback, write, type DocumentKind, type WriteMeta } from '@/config/versionedStore';
import { assertPublicationBase, documentBytes, PUBLICATION_MAX_BYTES, PublicationError, publicationMeta, publicationStatus, publicationScope, publish, publishSet, readPublication, recoverPublication } from '@/config/publication';
import { CONTENT_KIND, DEFAULT_LEARN, DEFAULT_SLOTS, EMPTY_CATALOG, LEARN_KIND, learnBlendLayoutErrors, PIECE_FIELDS, slotOrderCatalogueErrors, slotsNameContext, SLOTS_KIND, validateSlotCatalog } from '@/content/kinds';
import { contextTermsOf } from '@/content/cell';
import { REFLEX_KIND } from '@/reflex/configStore';
import { cellGrammarFor, EMPTY_PRIORS, parsePriorsCsv, PRIORS_KIND, priorUnitErrors, validatePriors } from '@/learn/priors';
import { HttpJsonSource, assemble, candidatesFrom, catalogDocumentFields, csvColumnCaseVariants, FEED_FIELDS, parseCsvTable, recordsInJson, type ImportMode, type PulledExport } from '@/content/import';
import type { ContentCatalog, ContentPiece, DocumentEnvelope, LearnConfig, SlotCatalog } from '@/content/types';
import { captureEnrichment, EnrichmentError, exportEnrichment, readEnrichment, readEnrichmentBody, reviewEnrichment } from '@/content/enrichment';
import { publishEnrichment } from '@/content/enrichmentPublication';
import { generateEnrichment } from '@/content/enrichmentGeneration';
import { ConnectorUnavailable } from '@/connectors/model';
import { catalogDiagnostics } from '@/content/catalogDiagnostics';
import { slotConstraintDiagnostics, slotDiagnostics } from '@/content/slotDiagnostics';

type Ctx = { Bindings: Env; Variables: TenantVariables & { auth: AuthContext } };
export const contentRoutes = new Hono<Ctx>();
/** W38.04: the one representation of an input refusal, named, on every consuming route. */
const inputRefusal = (c: Context<Ctx>, error: InputError) => c.json({ ok: false, error: error.message, code: error.code,
  ...(error.status === 413 ? { budget: error.budget, limit: error.limit, observed: error.observed } : {}) }, error.status);
contentRoutes.onError((error, c) => {
  if (error instanceof InputError) return inputRefusal(c, error);
  if (error instanceof LegacyDocumentError) return c.json({ ok: false, error: error.message, code: error.code }, error.status);
  if (error instanceof PublicationError) return c.json({ ok: false, error: error.message, code: error.code }, error.status);
  throw error;
});
// Reads and validation require access authentication too; enforced operations
// additionally bind the operator and document scope to the canonical tenant.
contentRoutes.use('*', async (c, next) => {
  c.header('Cache-Control', 'no-store');
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
};

function kindOf(name: string | undefined) { return KINDS[(name ?? '').toLowerCase()] ?? null; }
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
 * P01 (O5, R-P24): an order names modules, and only the catalogue says which
 * modules exist, so the refusal of an order naming a module the catalogue does
 * not register for its slot — or one the slot's tag and type gates refuse — is
 * made here, beside the prior check above, where both documents are at hand.
 * A slot document without orders is never touched: no read is made for it.
 * The catalogue is the one published with it in the same request when there is
 * one, otherwise the catalogue in force. Fail closed: a catalogue that cannot
 * be read refuses the publication rather than publishing an unchecked order;
 * an absent catalogue registers no module.
 */
async function orderRefusals(c: Context<Ctx>, scope: string, slotsCandidate: unknown, catalogCandidate?: unknown): Promise<{ errors: string[]; status: 422 | 503 } | null> {
  const valid = SLOTS_KIND.validate(slotsCandidate);
  if (!valid.ok || !Object.values(valid.value.pages).some(slots => slots.some(slot => slot.orders?.length))) return null;
  let catalog: ContentCatalog;
  if (catalogCandidate !== undefined) {
    const checked = CONTENT_KIND.validate(catalogCandidate);
    if (!checked.ok) return null;
    catalog = checked.value;
  } else {
    try { catalog = (await readPublication(c.env, CONTENT_KIND, scope))?.value ?? EMPTY_CATALOG; }
    catch { return { status: 503, errors: ['catalog: the content catalogue is unavailable, so a per-context order cannot be checked against the modules it registers'] }; }
  }
  const errors = slotOrderCatalogueErrors(valid.value, catalog);
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
 * the word), or else the one in force. A learn document without a blend is never
 * touched: no read is made for it. A refusal of a related member names it
 * (`publicationChanges[i]`) and refuses the whole request, so no member of it is
 * written. Fail closed: a slots document that cannot be read refuses the
 * publication rather than publishing an unchecked opt-in; an absent one
 * declares no layout slot.
 */
async function blendRefusals(c: Context<Ctx>, scope: string, learnCandidate: unknown, slotsCandidate?: unknown): Promise<{ errors: string[]; status: 422 | 503 } | null> {
  const valid = LEARN_KIND.validate(learnCandidate);
  if (!valid.ok || !Object.values(valid.value.slots ?? {}).some(dials => dials.blend !== undefined)) return null;
  let slots: SlotCatalog;
  if (slotsCandidate !== undefined) {
    const checked = SLOTS_KIND.validate(slotsCandidate);
    if (!checked.ok) return null;
    slots = checked.value;
  } else {
    try { slots = (await readPublication(c.env, SLOTS_KIND, scope))?.value ?? { pages: {} }; }
    catch { return { status: 503, errors: ['slots: the slots document is unavailable, so a layout blend cannot be checked against the page\'s declared layout slot'] }; }
  }
  const errors = learnBlendLayoutErrors(valid.value, slots);
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
function catalogMeta(c: Context<Ctx>, note?: string): WriteMeta {
  const meta = publicationMeta(c.req.raw.headers, actorOf(c), note);
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
  const k = kindOf(c.req.param('kind')); if (!k) return c.json({ error: 'kind must be catalog, slots, learn or priors' }, 404);
  const scope = scopeOf(c, k.kind);
  const rev = await readPublication(c.env, k.kind, scope);
  const value = rev ? rev.value : k.fallback;
  return c.json({ scope, kind: k.kind.name, source: rev ? 'stored' : 'compiled-default', revision: rev?.revision ?? 0,
    publication: rev?.publication, actor: rev?.actor ?? null, note: rev?.note ?? null, at: rev?.at ?? null, document: value,
    ...documentEnvelopeOf(k.kind, value),
    ...(k.kind.name === 'content' ? { diagnostics: await catalogDiagnostics(c.env, scope, value, rev?.revision ?? 0) } : {}),
    ...(k.kind.name === 'slots' ? { pinDiagnostics: await pinDiagnosticsFor(c, scope, rev?.value ?? null, rev?.revision ?? null),
      // W20 R1 (R77(b), R82(c)): the public home of the refusals the published
      // hard controls make, beside the pin channel and in a channel of its own.
      constraintDiagnostics: await slotConstraintDiagnostics(c.env, rev?.value ?? null, rev?.revision ?? null, slotCatalogTenant(c, scope)) } : {}) });
});

contentRoutes.get('/:kind/history', async (c) => {
  const k = kindOf(c.req.param('kind')); if (!k) return c.json({ error: 'kind must be catalog, slots, learn or priors' }, 404);
  const scope = scopeOf(c, k.kind);
  return c.json({ scope, kind: k.kind.name, revisions: await readIndex(c.env, k.kind, scope) });
});

contentRoutes.get('/:kind/revisions/:n', async (c) => {
  const k = kindOf(c.req.param('kind')); if (!k) return c.json({ error: 'kind must be catalog, slots, learn or priors' }, 404);
  const scope = scopeOf(c, k.kind);
  const n = Number(c.req.param('n'));
  if (!Number.isInteger(n) || n < 1) return c.json({ error: 'revision must be a positive integer' }, 400);
  const rev = await readVersion(c.env, k.kind, scope, n);
  return rev ? c.json({ scope, kind: k.kind.name, ...rev }) : c.json({ error: `revision ${n} not found for scope "${scope}"` }, 404);
});

/** Authenticated dry run: the same validator the write path runs. */
contentRoutes.post('/:kind/validate', async (c) => {
  const k = kindOf(c.req.param('kind')); if (!k) return c.json({ error: 'kind must be catalog, slots, learn or priors' }, 404);
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
  const result = k.kind.validate(candidate);
  return result.ok ? c.json({ valid: true, document: result.value,
    ...(k.kind.name === 'content' ? { diagnostics: await catalogDiagnostics(c.env, scope, result.value, null,
      publishedRequest(candidate, candidate === body ? REQUEST_ENVELOPE_FIELDS : [])) } : {}),
    ...(k.kind.name === 'slots' ? { pinDiagnostics: await pinDiagnosticsFor(c, scope, result.value, null) } : {}) }) : c.json({ valid: false, errors: result.errors }, 422);
});

// ── Writes ───────────────────────────────────────────────────────────────────
contentRoutes.put('/:kind', async (c) => {
  const k = kindOf(c.req.param('kind')); if (!k) return c.json({ error: 'kind must be catalog, slots, learn or priors' }, 404);
  const scope = scopeOf(c, k.kind), meta = catalogMeta(c);
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
  // A replacement is self-contained: reject invalid new drafts before any
  // authority read. Original v1 receipt resolution is deliberately read-only
  // and may retain a value that the current write validator no longer admits.
  if (meta.expectedPublication) {
    const valid = k.kind.validate(candidate);
    if (!valid.ok) return c.json({ ok: false, errors: valid.errors }, 422);
  }
  let result;
  if (related !== undefined) {
    if (!Array.isArray(related) || related.length > 5) throw new PublicationError('Invalid related publication members', 422, 'invalid_document');
    const changes = [{ kind: k.kind, scope, request: { type: 'replace', candidate }, candidate: () => candidate }];
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
        request: { type: 'replace', candidate: entry.document }, candidate: () => entry.document });
      members.push({ kind: target.kind, document: entry.document, at: `publicationChanges[${index}]` });
    }
    // P36 (R-P46): every slots member against the tenant's context vocabulary,
    // the learn member this request publishes or else the one in force.
    const vocabulary = await requestVocabularyRefusals(c, scope, members);
    if (vocabulary) return c.json({ ok: false, errors: vocabulary.errors }, vocabulary.status);
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
    result = await write(c.env, k.kind, scope, candidate, { ...meta, note });
  }
  return result.ok
    ? c.json({ ok: true, revision: result.revision.revision, publication: result.revision.publication, version: k.kind.versionOf?.(result.revision.value) ?? '', document: result.revision.value,
        ...(k.kind.name === 'content' ? { diagnostics: await catalogDiagnostics(c.env, scope, result.revision.value, result.revision.revision, publishedRequest(candidate, envelope)) } : {}),
        ...(k.kind.name === 'slots' ? { pinDiagnostics: await pinDiagnosticsFor(c, scope, result.revision.value, result.revision.revision) } : {}) })
    : c.json({ ok: false, errors: result.errors }, 422);
});

contentRoutes.post('/:kind/rollback/:n', async (c) => {
  const k = kindOf(c.req.param('kind')); if (!k) return c.json({ error: 'kind must be catalog, slots, learn or priors' }, 404);
  const scope = scopeOf(c, k.kind), meta = catalogMeta(c);
  const n = Number(c.req.param('n'));
  if (!Number.isInteger(n) || n < 1) return c.json({ error: 'revision must be a positive integer' }, 400);
  const body = await readInputJson(c.req.raw.body, {});
  const result = await rollback(c.env, k.kind, scope, n, { ...meta, note: noteOf((body as { note?: unknown })?.note) || undefined });
  return result.ok
    ? c.json({ ok: true, revision: result.revision.revision, publication: result.revision.publication, version: k.kind.versionOf?.(result.revision.value) ?? '',
        ...(k.kind.name === 'content' ? { diagnostics: await catalogDiagnostics(c.env, scope, result.revision.value, result.revision.revision) } : {}),
        ...(k.kind.name === 'slots' ? { pinDiagnostics: await pinDiagnosticsFor(c, scope, result.revision.value, result.revision.revision) } : {}) })
    : c.json({ ok: false, errors: result.errors }, 404);
});

// ── The import adapter ───────────────────────────────────────────────────────

async function importInto(c: Context<Ctx>, records: unknown[], mode: ImportMode, note: string, source: object, meta: WriteMeta,
  document?: { value: unknown; accepted: ReadonlySet<string> }) {
  const scope = catalogScope(c);
  const incoming = candidatesFrom(records);
  if (incoming.length === 0) return c.json({ ok: false, errors: ['no records found in the import'] }, 422);
  // The catalogue this operation was published over, so `changed` is measured
  // against the stored values. The mutator runs for every publication; an
  // exact-request retry serves a retained answer without running it, and the
  // revision it declared is the base that answer was measured against.
  let base: ContentCatalog | undefined;
  const result = await publish<ContentCatalog>(c.env, CONTENT_KIND, scope, { type: 'import', source, records, mode }, { ...meta, note },
    current => { base = current; return { ...(carriedVersion(current) ? { version: carriedVersion(current) } : {}), ...assemble(current, incoming, mode) }; });
  if (!result.ok) return c.json({ ok: false, errors: result.errors, received: records.length }, 422);
  const before = base !== undefined ? { catalog: base, basis: 'stored' as const } : await publishedOver(c.env, scope, meta.expectedRevision);
  const measured = before.basis === 'stored';
  return c.json({ ok: true, scope, mode, received: records.length, imported: incoming.length, pieces: result.revision.value.pieces.length,
    changed: measured ? changedPieces(before.catalog, result.revision.value) : null,
    removed: measured ? removedPieces(before.catalog, result.revision.value) : null,
    changedBasis: before.basis,
    revision: result.revision.revision, publication: result.revision.publication, version: result.revision.value.version ?? '',
    diagnostics: await catalogDiagnostics(c.env, scope, result.revision.value, result.revision.revision,
      { records, accepted: FEED_FIELDS, ...(document ? { document } : {}) }) });
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

/**
 * POST /content/catalog/import?scope=&format=json|csv&mode=replace|merge
 * JSON: the body, or its `pieces` / `content` / `items` array, or ?path=a.b.
 * CSV: header row of CSV_COLUMNS in any order; tags as `dim:value;dim:v1|v2`.
 */
contentRoutes.post('/catalog/import', async (c) => {
  catalogScope(c); const meta = catalogMeta(c);
  const format = (c.req.query('format') ?? '').toLowerCase() || (c.req.header('content-type')?.includes('csv') ? 'csv' : 'json');
  const mode: ImportMode = c.req.query('mode') === 'merge' ? 'merge' : 'replace';
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
  return importInto(c, records, mode, note, { format, path: c.req.query('path') ?? null }, meta, document);
});

/**
 * POST /content/catalog/pull  { url, path?, mode?, note? }
 * The CMS/DAM seam: the worker fetches a JSON document and imports it. The URL
 * must be http(s); what URLs a tenant may name is a policy for CW1 to bind.
 */
contentRoutes.post('/catalog/pull', async (c) => {
  const scope = catalogScope(c), meta = catalogMeta(c);
  await assertPublicationBase(c.env, CONTENT_KIND, scope, meta);
  const body = await readInputJson(c.req.raw.body) as { url?: unknown; path?: unknown; mode?: unknown; note?: unknown } | null;
  const url = typeof body?.url === 'string' ? body.url.trim() : '';
  if (!/^https?:\/\//i.test(url)) return c.json({ error: 'url must be http(s)' }, 400);
  let pulled: PulledExport;
  try {
    pulled = await new HttpJsonSource(url, typeof body?.path === 'string' ? body.path : undefined).pullExport();
  } catch (e) {
    if (e instanceof InputError && e.status === 413) throw e;
    return c.json({ ok: false, errors: [`pull failed: ${e instanceof Error ? e.message : String(e)}`] }, 502);
  }
  const mode: ImportMode = body?.mode === 'merge' ? 'merge' : 'replace';
  return importInto(c, pulled.records, mode, noteOf(body?.note) || `pull from ${new URL(url).host} (${mode})`,
    { type: 'pull', url, path: typeof body?.path === 'string' ? body.path : null }, meta,
    { value: pulled.document, accepted: catalogDocumentFields(pulled.carrier) });
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
  const meta = c.req.header('If-Match') || c.req.header('Idempotency-Key') ? catalogMeta(c) : undefined;
  return publicationStatus(c.env, kind, scope, meta).then(status => c.json(status));
});
contentRoutes.post('/catalog/publication/recover', async c => {
  const { kind, scope } = publicationTarget(c), meta = catalogMeta(c);
  const result = await recoverPublication(c.env, kind, scope, meta);
  return result.ok ? c.json({ ok: true, revision: result.revision.revision, publication: result.revision.publication, document: result.revision.value,
    ...(kind.name === 'content' ? { diagnostics: await catalogDiagnostics(c.env, scope, result.revision.value, result.revision.revision) } : {}) }) : c.json(result, 422);
});

export default contentRoutes;

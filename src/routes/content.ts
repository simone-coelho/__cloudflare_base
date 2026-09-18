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
import { InputError, inputRecords, readInputJson, readInputText } from '@/config/input';
import type { Env } from '@/types/env';
import type { AuthContext } from '@/middleware/auth';
import { hasOperatorGrant, operatorJwt } from '@/middleware/operatorAuth';
import { isValidTenantId, type TenantVariables } from '@/tenancy/tenant';
import { LegacyDocumentError, readIndex, readVersion, rollback, write, type DocumentKind, type WriteMeta } from '@/config/versionedStore';
import { assertPublicationBase, PublicationError, publicationMeta, publicationStatus, publicationScope, publish, publishSet, readPublication, recoverPublication } from '@/config/publication';
import { CONTENT_KIND, DEFAULT_LEARN, DEFAULT_SLOTS, EMPTY_CATALOG, LEARN_KIND, SLOTS_KIND } from '@/content/kinds';
import { REFLEX_KIND } from '@/reflex/configStore';
import { EMPTY_PRIORS, parsePriorsCsv, PRIORS_KIND } from '@/learn/priors';
import { HttpJsonSource, assemble, candidatesFrom, parseCsv, recordsFromJson, type ImportMode } from '@/content/import';
import type { ContentCatalog, SlotCatalog } from '@/content/types';
import { captureEnrichment, EnrichmentError, exportEnrichment, readEnrichment, readEnrichmentBody, reviewEnrichment } from '@/content/enrichment';
import { publishEnrichment } from '@/content/enrichmentPublication';
import { generateEnrichment } from '@/content/enrichmentGeneration';
import { ConnectorUnavailable } from '@/connectors/model';
import { catalogDiagnostics } from '@/content/catalogDiagnostics';
import { slotDiagnostics } from '@/content/slotDiagnostics';

type Ctx = { Bindings: Env; Variables: TenantVariables & { auth: AuthContext } };
export const contentRoutes = new Hono<Ctx>();
contentRoutes.onError((error, c) => {
  if (error instanceof InputError) return c.json({ ok: false, error: error.message, code: error.code,
    ...(error.status === 413 ? { budget: error.budget, limit: error.limit, observed: error.observed } : {}) }, error.status);
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
function inputCollection(kind: string, candidate: unknown): void {
  if (candidate && typeof candidate === 'object') {
    const body = candidate as Record<string, unknown>;
    if (kind === 'content') inputRecords(body.pieces);
    if (kind === 'prior') inputRecords(body.rows);
  }
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
function pinDiagnosticsFor(c: Context<Ctx>, scope: string, slots: SlotCatalog | null, revision: number | null) {
  return slotDiagnostics(c.env, slots, revision, () => {
    const tenant = catalogScope(c);
    if (scope !== tenant) throw new Error('Unbound slot scope');
    return tenant;
  });
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
async function enrichmentResult(c: Context<Ctx>, operation: () => Promise<object>, status: 200 | 201 = 200) {
  try { return c.json(await operation(), status); }
  catch (error) {
    if (error instanceof ConnectorUnavailable) return c.json({ ok: false, error: 'Enrichment generation unavailable', code: error.code }, error.code === 'conflict' ? 409 : 503);
    if (error instanceof PublicationError) return c.json({ ok: false, error: error.message, code: error.code }, error.status);
    return error instanceof EnrichmentError ? c.json({ error: error.message, ...(error.proposalId ? { proposalId: error.proposalId } : {}) }, error.status)
      : c.json({ error: 'Enrichment storage unavailable' }, 503);
  }
}
enrichmentRoutes.post('/', c => enrichmentResult(c, async () => {
  const input = await readEnrichmentBody(c.req.raw), user = c.get('auth').user!;
  const proposal = await captureEnrichment(c.env.STORAGE, c.get('tenant'), user.sub, user.type as 'access' | 'service', input);
  return { status: 'pending', published: false, proposal, review: null };
}, 201));
enrichmentRoutes.post('/generate', c => enrichmentResult(c, async () => {
  const input = await readEnrichmentBody(c.req.raw), user = c.get('auth').user!, actor = user.sub;
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
    const input = await readEnrichmentBody(c.req.raw);
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
    const meta = catalogMeta(c), input = await readEnrichmentBody(c.req.raw);
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
    ...(k.kind.name === 'content' ? { diagnostics: await catalogDiagnostics(c.env, scope, value, rev?.revision ?? 0) } : {}),
    ...(k.kind.name === 'slots' ? { pinDiagnostics: await pinDiagnosticsFor(c, scope, rev?.value ?? null, rev?.revision ?? null) } : {}) });
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
  const result = k.kind.validate(candidate);
  return result.ok ? c.json({ valid: true, document: result.value,
    ...(k.kind.name === 'content' ? { diagnostics: await catalogDiagnostics(c.env, scope, result.value, null) } : {}),
    ...(k.kind.name === 'slots' ? { pinDiagnostics: await pinDiagnosticsFor(c, scope, result.value, null) } : {}) }) : c.json({ valid: false, errors: result.errors }, 422);
});

// ── Writes ───────────────────────────────────────────────────────────────────
contentRoutes.put('/:kind', async (c) => {
  const k = kindOf(c.req.param('kind')); if (!k) return c.json({ error: 'kind must be catalog, slots, learn or priors' }, 404);
  const scope = scopeOf(c, k.kind), meta = catalogMeta(c);
  let candidate: unknown;
  let related: unknown;
  let note = '';
  if ((c.req.header('content-type') ?? '').toLowerCase().includes('text/csv')) {
    if (!k.fromCsv) return c.json({ error: `${c.req.param('kind')} does not accept CSV` }, 415);
    candidate = k.fromCsv(await readInputText(c.req.raw.body));
    note = noteOf(c.req.query('note'));
  } else {
    const body = await readInputJson(c.req.raw.body);
    if (body === null) return c.json({ error: 'body must be JSON' }, 400);
    const { document, note: n } = body as { document?: unknown; note?: unknown };
    candidate = document ?? body;
    related = (body as { publicationChanges?: unknown }).publicationChanges;
    note = noteOf(n);
  }
  inputCollection(k.kind.name, candidate);
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
    for (const entry of related) {
      if (!entry || typeof entry !== 'object' || Object.keys(entry).some(key => !['kind', 'document'].includes(key))) throw new PublicationError('Invalid related document', 422, 'invalid_document');
      const target = entry.kind === 'reflex' ? { kind: REFLEX_KIND } : kindOf(entry.kind);
      if (!target) throw new PublicationError('Unsupported related document kind', 422, 'invalid_document');
      inputCollection(target.kind.name, entry.document);
      const valid = target.kind.validate(entry.document);
      if (!valid.ok) return c.json({ ok: false, errors: valid.errors }, 422);
      changes.push({ kind: target.kind, scope: entry.kind === 'reflex' && scope === 'brighthour' ? 'tenant:brighthour' : scope,
        request: { type: 'replace', candidate: entry.document }, candidate: () => entry.document });
    }
    result = await publishSet(c.env, changes, { ...meta, note });
  } else result = await write(c.env, k.kind, scope, candidate, { ...meta, note });
  return result.ok
    ? c.json({ ok: true, revision: result.revision.revision, publication: result.revision.publication, version: k.kind.versionOf?.(result.revision.value) ?? '', document: result.revision.value,
        ...(k.kind.name === 'content' ? { diagnostics: await catalogDiagnostics(c.env, scope, result.revision.value, result.revision.revision) } : {}),
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

async function importInto(c: Context<Ctx>, records: unknown[], mode: ImportMode, note: string, source: object, meta: WriteMeta) {
  const scope = catalogScope(c);
  const incoming = candidatesFrom(records);
  if (incoming.length === 0) return c.json({ ok: false, errors: ['no records found in the import'] }, 422);
  const result = await publish<ContentCatalog>(c.env, CONTENT_KIND, scope, { type: 'import', source, records, mode }, { ...meta, note },
    current => ({ ...(current.version ? { version: current.version } : {}), ...assemble(current, incoming, mode) }));
  return result.ok
    ? c.json({ ok: true, scope, mode, received: records.length, imported: incoming.length, pieces: result.revision.value.pieces.length,
        revision: result.revision.revision, publication: result.revision.publication, version: result.revision.value.version ?? '',
        diagnostics: await catalogDiagnostics(c.env, scope, result.revision.value, result.revision.revision) })
    : c.json({ ok: false, errors: result.errors, received: records.length }, 422);
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
  if (format === 'csv') {
    const text = await readInputText(c.req.raw.body);
    if (!text.trim()) return c.json({ error: 'body must be CSV text' }, 400);
    records = parseCsv(text);
  } else {
    const body = await readInputJson(c.req.raw.body);
    if (body === null) return c.json({ error: 'body must be JSON' }, 400);
    records = recordsFromJson(body, c.req.query('path') ?? undefined);
  }
  return importInto(c, records, mode, note, { format, path: c.req.query('path') ?? null }, meta);
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
  let records: unknown[];
  try {
    records = await new HttpJsonSource(url, typeof body?.path === 'string' ? body.path : undefined).pull();
  } catch (e) {
    if (e instanceof InputError && e.status === 413) throw e;
    return c.json({ ok: false, errors: [`pull failed: ${e instanceof Error ? e.message : String(e)}`] }, 502);
  }
  const mode: ImportMode = body?.mode === 'merge' ? 'merge' : 'replace';
  return importInto(c, records, mode, noteOf(body?.note) || `pull from ${new URL(url).host} (${mode})`,
    { type: 'pull', url, path: typeof body?.path === 'string' ? body.path : null }, meta);
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

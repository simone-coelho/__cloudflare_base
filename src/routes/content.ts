// src/routes/content.ts
// ─────────────────────────────────────────────────────────────────────────────
// CW2 — the write side of the three content documents CW4 reads: the catalog,
// the per-page slot strategies, and the learning settings. Same store, same
// line as the config routes: reads open, writes authenticated and fail closed,
// every write validated as a whole, versioned, attributed, and rolled forward.
//
//   GET  /content/:kind                  the document in force, and where it came from
//   GET  /content/:kind/history          the audit index
//   GET  /content/:kind/revisions/:n     one historical revision
//   POST /content/:kind/validate         dry run, open
//   PUT  /content/:kind                  full replace (JWT)
//   POST /content/:kind/rollback/:n      roll forward to an old body (JWT)
//   POST /content/catalog/import         a JSON or CSV export, replace or merge (JWT)
//   POST /content/catalog/pull           a JSON URL, the CMS/DAM seam (JWT)
//
// :kind is catalog | slots | learn. ?scope= selects the tenant scope, as /config does.
// ─────────────────────────────────────────────────────────────────────────────

import { Hono, type Context } from 'hono';
import type { Env } from '@/types/env';
import { jwt, type AuthContext } from '@/middleware/auth';
import { read, readIndex, readRevision, readVersion, rollback, write, type DocumentKind } from '@/config/versionedStore';
import { CONTENT_KIND, DEFAULT_LEARN, DEFAULT_SLOTS, EMPTY_CATALOG, LEARN_KIND, SLOTS_KIND } from '@/content/kinds';
import { HttpJsonSource, assemble, candidatesFrom, parseCsv, recordsFromJson, type ImportMode } from '@/content/import';
import type { ContentCatalog } from '@/content/types';

type Ctx = { Bindings: Env; Variables: { auth: AuthContext } };
export const contentRoutes = new Hono<Ctx>();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const KINDS: Record<string, { kind: DocumentKind<any>; fallback: any }> = {
  catalog: { kind: CONTENT_KIND, fallback: EMPTY_CATALOG },
  slots: { kind: SLOTS_KIND, fallback: DEFAULT_SLOTS },
  learn: { kind: LEARN_KIND, fallback: DEFAULT_LEARN },
};

function kindOf(name: string | undefined) { return KINDS[(name ?? '').toLowerCase()] ?? null; }
function scopeOf(c: { req: { query: (k: string) => string | undefined } }): string {
  const raw = (c.req.query('scope') ?? '').trim();
  return /^[a-z0-9][a-z0-9:_-]{0,63}$/i.test(raw) ? raw : 'default';
}
function actorOf(c: { get: (k: 'auth') => AuthContext | undefined }): string {
  return c.get('auth')?.user?.sub ?? c.get('auth')?.user?.email ?? 'unknown';
}
const noteOf = (v: unknown) => (typeof v === 'string' ? v.slice(0, 500) : '');

// ── Auth: reads open, writes fail closed, regardless of AUTH_MODE ───────────
contentRoutes.use('/:kind', async (c, next) => (c.req.method === 'GET' ? next() : jwt({ required: true })(c, next)));
contentRoutes.use('/:kind/rollback/*', jwt({ required: true }));
contentRoutes.use('/catalog/import', jwt({ required: true }));
contentRoutes.use('/catalog/pull', jwt({ required: true }));

// ── Reads ────────────────────────────────────────────────────────────────────
contentRoutes.get('/:kind', async (c) => {
  const k = kindOf(c.req.param('kind')); if (!k) return c.json({ error: 'kind must be catalog, slots or learn' }, 404);
  const scope = scopeOf(c);
  const rev = await readRevision(c.env, k.kind, scope);
  const value = rev ? rev.value : k.fallback;
  return c.json({ scope, kind: k.kind.name, source: rev ? 'stored' : 'compiled-default', revision: rev?.revision ?? 0,
    actor: rev?.actor ?? null, note: rev?.note ?? null, at: rev?.at ?? null, document: value });
});

contentRoutes.get('/:kind/history', async (c) => {
  const k = kindOf(c.req.param('kind')); if (!k) return c.json({ error: 'kind must be catalog, slots or learn' }, 404);
  const scope = scopeOf(c);
  return c.json({ scope, kind: k.kind.name, revisions: await readIndex(c.env, k.kind, scope) });
});

contentRoutes.get('/:kind/revisions/:n', async (c) => {
  const k = kindOf(c.req.param('kind')); if (!k) return c.json({ error: 'kind must be catalog, slots or learn' }, 404);
  const n = Number(c.req.param('n'));
  if (!Number.isInteger(n) || n < 1) return c.json({ error: 'revision must be a positive integer' }, 400);
  const scope = scopeOf(c);
  const rev = await readVersion(c.env, k.kind, scope, n);
  return rev ? c.json({ scope, kind: k.kind.name, ...rev }) : c.json({ error: `revision ${n} not found for scope "${scope}"` }, 404);
});

/** Dry run, open: the same validator the write path runs, so a form cannot drift from the store. */
contentRoutes.post('/:kind/validate', async (c) => {
  const k = kindOf(c.req.param('kind')); if (!k) return c.json({ error: 'kind must be catalog, slots or learn' }, 404);
  const body = await c.req.json().catch(() => null);
  if (body === null) return c.json({ error: 'body must be JSON' }, 400);
  const candidate = (body as { document?: unknown }).document ?? body;
  const result = k.kind.validate(candidate);
  return result.ok ? c.json({ valid: true, document: result.value }) : c.json({ valid: false, errors: result.errors }, 422);
});

// ── Writes ───────────────────────────────────────────────────────────────────
contentRoutes.put('/:kind', async (c) => {
  const k = kindOf(c.req.param('kind')); if (!k) return c.json({ error: 'kind must be catalog, slots or learn' }, 404);
  const body = await c.req.json().catch(() => null);
  if (body === null) return c.json({ error: 'body must be JSON' }, 400);
  const { document, note } = body as { document?: unknown; note?: unknown };
  const result = await write(c.env, k.kind, scopeOf(c), document ?? body, { actor: actorOf(c), note: noteOf(note) });
  return result.ok
    ? c.json({ ok: true, revision: result.revision.revision, version: k.kind.versionOf?.(result.revision.value) ?? '', document: result.revision.value })
    : c.json({ ok: false, errors: result.errors }, 422);
});

contentRoutes.post('/:kind/rollback/:n', async (c) => {
  const k = kindOf(c.req.param('kind')); if (!k) return c.json({ error: 'kind must be catalog, slots or learn' }, 404);
  const n = Number(c.req.param('n'));
  if (!Number.isInteger(n) || n < 1) return c.json({ error: 'revision must be a positive integer' }, 400);
  const body = await c.req.json().catch(() => ({}));
  const result = await rollback(c.env, k.kind, scopeOf(c), n, { actor: actorOf(c), note: noteOf((body as { note?: unknown })?.note) || undefined });
  return result.ok
    ? c.json({ ok: true, revision: result.revision.revision, version: k.kind.versionOf?.(result.revision.value) ?? '' })
    : c.json({ ok: false, errors: result.errors }, 404);
});

// ── The import adapter ───────────────────────────────────────────────────────

async function importInto(c: Context<Ctx>, records: unknown[], mode: ImportMode, note: string) {
  const scope = scopeOf(c);
  const current = await read<ContentCatalog>(c.env, CONTENT_KIND, scope, EMPTY_CATALOG);
  const incoming = candidatesFrom(records);
  if (incoming.length === 0) return c.json({ ok: false, errors: ['no records found in the import'] }, 422);
  const candidate = { ...(current.version ? { version: current.version } : {}), ...assemble(current, incoming, mode) };
  const result = await write(c.env, CONTENT_KIND, scope, candidate, { actor: actorOf(c), note });
  return result.ok
    ? c.json({ ok: true, scope, mode, received: records.length, imported: incoming.length, pieces: result.revision.value.pieces.length,
        revision: result.revision.revision, version: result.revision.value.version ?? '' })
    : c.json({ ok: false, errors: result.errors, received: records.length }, 422);
}

/**
 * POST /content/catalog/import?scope=&format=json|csv&mode=replace|merge
 * JSON: the body, or its `pieces` / `content` / `items` array, or ?path=a.b.
 * CSV: header row of CSV_COLUMNS in any order; tags as `dim:value;dim:v1|v2`.
 */
contentRoutes.post('/catalog/import', async (c) => {
  const format = (c.req.query('format') ?? '').toLowerCase() || (c.req.header('content-type')?.includes('csv') ? 'csv' : 'json');
  const mode: ImportMode = c.req.query('mode') === 'merge' ? 'merge' : 'replace';
  const note = noteOf(c.req.query('note')) || `${format} import (${mode})`;
  let records: unknown[];
  if (format === 'csv') {
    const text = await c.req.text().catch(() => '');
    if (!text.trim()) return c.json({ error: 'body must be CSV text' }, 400);
    records = parseCsv(text);
  } else {
    const body = await c.req.json().catch(() => null);
    if (body === null) return c.json({ error: 'body must be JSON' }, 400);
    records = recordsFromJson(body, c.req.query('path') ?? undefined);
  }
  return importInto(c, records, mode, note);
});

/**
 * POST /content/catalog/pull  { url, path?, mode?, note? }
 * The CMS/DAM seam: the worker fetches a JSON document and imports it. The URL
 * must be http(s); what URLs a tenant may name is a policy for CW1 to bind.
 */
contentRoutes.post('/catalog/pull', async (c) => {
  const body = await c.req.json().catch(() => null) as { url?: unknown; path?: unknown; mode?: unknown; note?: unknown } | null;
  const url = typeof body?.url === 'string' ? body.url.trim() : '';
  if (!/^https?:\/\//i.test(url)) return c.json({ error: 'url must be http(s)' }, 400);
  let records: unknown[];
  try {
    records = await new HttpJsonSource(url, typeof body?.path === 'string' ? body.path : undefined).pull();
  } catch (e) {
    return c.json({ ok: false, errors: [`pull failed: ${e instanceof Error ? e.message : String(e)}`] }, 502);
  }
  const mode: ImportMode = body?.mode === 'merge' ? 'merge' : 'replace';
  return importInto(c, records, mode, noteOf(body?.note) || `pull from ${new URL(url).host} (${mode})`);
});

export default contentRoutes;

// src/routes/decisions.ts
// CW4 — the content decision surface (scope appendix §2.3, API-first delivery).
//
//   GET /v1/:tenant/decisions/snapshot?page=home&visitorId=…[&brand=&channel=]
//
// Returns the delivery contract the customer's front end paints (`decisions`,
// one per slot position, addressed by their own content id) and the ledger
// records the outcome-learning design records (`records`, doc 22 §3.1). Reads
// only; never cached; SDK-key authentication arrives with CW10.

import { Hono } from 'hono';
import type { Env } from '@/types/env';
import { serveContentDecisions } from '@/content/service';
import { NAMESPACE_MARKER, type TenantVariables } from '@/tenancy/tenant';
import { enqueueDecisions } from '@/ledger/enqueue';
import { findById, type R2Like } from '@/ledger/writer';
import { eraseVisitorLedger, hidden, loadTombstones, retentionDays, rewriteErasures, type R2Erasable } from '@/ledger/erasure';
import type { DecisionRecord } from '@/content/types';
import type { OutcomeRecord } from '@/ledger/records';
import { readTrend, regionKeyOf, rollupTenant } from '@/reflex/regionTrend';
import { liftArchiveKey, liftKey, ringName, statsName } from '@/learn/fan';
import { decideProposal, EMPTY_PROPOSALS, PROPOSALS_KIND, runCycle, type ProposalsDoc } from '@/learn/cycle';
import { read } from '@/config/versionedStore';
import { replayDecision } from '@/learn/replay';
import { reportKey, runReport, type DayReport, type ReportPolicy } from '@/learn/report';
import { windowReport } from '@/measure/window';
import { LEARN_KIND, DEFAULT_LEARN, CONTENT_KIND, SLOTS_KIND, EMPTY_CATALOG, DEFAULT_SLOTS } from '@/content/kinds';
import { decodeCursor, encodeCursor, pageRows, rowsOf, slotsIndex, DEFAULT_LIMIT, MAX_LIMIT, SORT_KEYS, type RowLevel, type SortKey } from '@/learn/rows';
import type { ContentCatalog, SlotCatalog } from '@/content/types';
import type { LiftSnapshot } from '@/learn/stats';
import { write } from '@/config/versionedStore';
import { invalidateLiftCache } from '@/content/service';
import type { LearnConfig } from '@/content/types';
import { referenceScore, type ExternalRequest } from '@/learn/external';
import type { AuthContext } from '@/middleware/auth';
import { jwt } from '@/middleware/auth';

export const decisionRoutes = new Hono<{ Bindings: Env; Variables: TenantVariables }>();

const TENANT = /^[a-z0-9][a-z0-9_-]{0,63}$/i;

/**
 * GET /v1/:tenant/trend[?region=US-NY]
 * The population prior in force for a region: which level answered (region,
 * country, everyone), how much evidence it holds, and the shares themselves.
 * Aggregates only, so it is open. Absent ?region=, the request's own geolocation.
 */
decisionRoutes.get('/:tenant/trend', async (c) => {
  const tenant = (c.req.param('tenant') ?? '').trim();
  if (!TENANT.test(tenant)) return c.json({ ok: false, error: 'tenant must be a short slug' }, 400);
  const cf = ((c.req.raw as unknown as { cf?: { country?: string; regionCode?: string } }).cf) ?? null;
  const region = (c.req.query('region') ?? '').trim().toUpperCase() || regionKeyOf(cf);
  const minEvents = Math.max(1, Number(c.req.query('minEvents') ?? 30) || 30);
  const read = await readTrend(c.env, tenant, region, minEvents);
  c.header('Cache-Control', 'no-store');
  if (!read) return c.json({ ok: true, tenant, region, level: null, snapshot: null });
  return c.json({ ok: true, tenant, region, asked: region, level: read.level, answered: read.region, snapshot: read.snapshot });
});

/**
 * GET /v1/:tenant/lift/rows?slot=&brand=&level=pooled|cells&item=&q=&sort=&dir=&limit=&cursor= (doc 28 §4).
 * The grid as pages: one pooled row per item, or one item's cells; filtered, sorted and cut by the
 * server, with the catalog's names and the merchandiser's controls joined on. The cursor names the
 * snapshot version it was cut from, so a page never straddles two snapshots; when the snapshot has
 * moved on, the answer is 409 and the application starts the listing again. Same access as /lift.
 */
decisionRoutes.get('/:tenant/lift/rows', async (c) => {
  const tenant = (c.req.param('tenant') ?? '').trim();
  if (!TENANT.test(tenant)) return c.json({ ok: false, error: 'tenant must be a short slug' }, 400);
  const slot = (c.req.query('slot') ?? '').trim();
  if (!slot) return c.json({ ok: false, error: 'slot required' }, 400);
  const brand = (c.req.query('brand') ?? '').trim() || tenant;
  const cur = decodeCursor(c.req.query('cursor'));
  if (c.req.query('cursor') && !cur) return c.json({ ok: false, error: 'cursor not recognised' }, 400);
  const levelQ = c.req.query('level');
  const level: RowLevel = cur ? cur.level : levelQ === 'cells' ? 'cells' : 'pooled';
  const item = cur ? cur.item : ((c.req.query('item') ?? '').trim() || undefined);
  const q = cur ? cur.q : ((c.req.query('q') ?? '').trim() || undefined);
  const sortQ = cur ? cur.sort : (c.req.query('sort') ?? '').trim();
  const sort = sortQ && (SORT_KEYS as readonly string[]).includes(sortQ) ? (sortQ as SortKey) : undefined;
  if (sortQ && !sort) return c.json({ ok: false, error: `sort must be one of ${SORT_KEYS.join(', ')}` }, 400);
  const dirQ = cur ? cur.dir : c.req.query('dir');
  const dir = dirQ === 'asc' || dirQ === 'desc' ? dirQ : undefined;
  const limit = cur ? cur.limit ?? DEFAULT_LIMIT : Math.max(1, Math.min(MAX_LIMIT, Number(c.req.query('limit')) || DEFAULT_LIMIT));
  const offset = cur ? cur.o : 0;
  let snapshot: LiftSnapshot | null = null;
  try { snapshot = (await c.env.CACHE.get(liftKey(tenant, brand, slot), 'json')) as LiftSnapshot | null; } catch { snapshot = null; }
  c.header('Cache-Control', 'no-store');
  if (!snapshot) return c.json({ ok: true, tenant, brand, slot, version: 0, published: false, level, total: 0, offset: 0, limit, rows: [], cursor: null });
  if (cur && cur.v !== snapshot.version) return c.json({ ok: false, error: 'the snapshot has moved on since this page was cut; start the listing again', version: snapshot.version }, 409);
  const [catalog, learn] = await Promise.all([read<ContentCatalog>(c.env, CONTENT_KIND, tenant, EMPTY_CATALOG), read<LearnConfig>(c.env, LEARN_KIND, tenant, DEFAULT_LEARN)]);
  const names = new Map(catalog.pieces.map((p) => [p.id, { customerContentId: p.customerContentId, title: p.title }]));
  const rows = rowsOf(snapshot, names, learn.slots?.[slot]?.items, level, item);
  const page = pageRows(rows, { level, item, q, sort, dir, offset, limit });
  const cursor = page.next === null ? null : encodeCursor({ v: snapshot.version, o: page.next, level, item, q, sort, dir, limit });
  return c.json({ ok: true, tenant, brand, slot, version: snapshot.version, published: true, publishedAt: snapshot.publishedAt, reward: snapshot.reward, objective: snapshot.objective ?? 'unit', n0: snapshot.n0, nMin: snapshot.nMin, level, item: item ?? null, q: q ?? null, sort: sort ?? 'lift', dir: dir ?? (sort === 'item' || sort === 'name' || sort === 'key' ? 'asc' : 'desc'), total: page.total, offset: page.offset, limit: page.limit, rows: page.rows, cursor });
});

/**
 * GET /v1/:tenant/learn/slots?brand=&q=&evidence=1 (doc 28 §4): every slot on every page, grouped by
 * page, with what is configured on it and how many pieces are eligible now; `q` narrows by slot or
 * page name; `evidence=1` adds what each slot has learned so far (items, events, when published),
 * for up to 200 slots. The application's picker and its overview.
 */
decisionRoutes.get('/:tenant/learn/slots', async (c) => {
  const tenant = (c.req.param('tenant') ?? '').trim();
  if (!TENANT.test(tenant)) return c.json({ ok: false, error: 'tenant must be a short slug' }, 400);
  const brand = (c.req.query('brand') ?? '').trim() || tenant;
  const q = (c.req.query('q') ?? '').trim() || undefined;
  const now = Date.now();
  const [slots, catalog, learn] = await Promise.all([read<SlotCatalog>(c.env, SLOTS_KIND, tenant, DEFAULT_SLOTS), read<ContentCatalog>(c.env, CONTENT_KIND, tenant, EMPTY_CATALOG), read<LearnConfig>(c.env, LEARN_KIND, tenant, DEFAULT_LEARN)]);
  const index = slotsIndex(slots, catalog, learn, now, q);
  if (c.req.query('evidence') === '1') {
    let budget = 200;
    for (const page of index.pages) for (const s of page.slots) {
      if (budget-- <= 0) { s.evidence = null; continue; }
      try {
        const snap = (await c.env.CACHE.get(liftKey(tenant, brand, s.slot), 'json')) as LiftSnapshot | null;
        s.evidence = snap ? { items: Object.keys(snap.items).length, events: snap.events, publishedAt: snap.publishedAt } : null;
      } catch { s.evidence = null; }
    }
  }
  c.header('Cache-Control', 'no-store');
  return c.json({ ok: true, tenant, brand, q: q ?? null, total: index.total, pages: index.pages });
});

/**
 * GET /v1/:tenant/lift?slot=hero[&brand=]
 * The lift snapshot in force for a slot: every item's decayed counts, estimate and
 * lift at every pooling level, and the slot's own rate per cell. Aggregates only,
 * so it is open. This is the console's grid (doc 22 §12.2) as data.
 */
decisionRoutes.get('/:tenant/lift', async (c) => {
  const tenant = (c.req.param('tenant') ?? '').trim();
  if (!TENANT.test(tenant)) return c.json({ ok: false, error: 'tenant must be a short slug' }, 400);
  const slot = (c.req.query('slot') ?? '').trim();
  if (!slot) return c.json({ ok: false, error: 'slot required' }, 400);
  const brand = (c.req.query('brand') ?? '').trim() || tenant;
  let snapshot: unknown = null;
  // Phase 3 / CW22: ?version= reads an archived snapshot instead of the one in force.
  const version = Number(c.req.query('version') ?? 0) || 0;
  if (version > 0) {
    try { const obj = await c.env.STORAGE.get(liftArchiveKey(tenant, brand, slot, version)); snapshot = obj ? await obj.json() : null; } catch { snapshot = null; }
  } else {
    try { snapshot = await c.env.CACHE.get(liftKey(tenant, brand, slot), 'json'); } catch { snapshot = null; }
  }
  c.header('Cache-Control', 'no-store');
  return c.json({ ok: true, tenant, brand, slot, snapshot });
});

/** GET /v1/:tenant/visitors/:visitorId/recent: what this visitor was shown, from her own object. Authenticated. */
decisionRoutes.get('/:tenant/visitors/:visitorId/recent', jwt({ required: true }), async (c) => {
  const tenant = (c.req.param('tenant') ?? '').trim();
  const visitorId = (c.req.param('visitorId') ?? '').trim();
  if (!TENANT.test(tenant) || !visitorId || visitorId.startsWith(NAMESPACE_MARKER)) return c.json({ ok: false, error: 'bad tenant or visitor id' }, 400);
  const ns = c.env.DECISION_RING;
  if (!ns) return c.json({ ok: false, error: 'ring not bound' }, 503);
  const res = await ns.get(ns.idFromName(ringName(tenant, visitorId))).fetch('https://learn/recent');
  c.header('Cache-Control', 'no-store');
  return c.json(await res.json());
});

/**
 * The autonomy cycle (doc 22 §11). POST /v1/:tenant/learn/cycle runs it for the
 * scope now, as the daily cron does; GET /v1/:tenant/learn/proposals lists what
 * it proposed with the evidence; POST .../proposals/:id/apply or /reject is a
 * person's decision, applied as a new revision of the slots document with the
 * evidence in its note. Every one of these leaves a trail. All authenticated.
 */
decisionRoutes.post('/:tenant/learn/cycle', jwt({ required: true }), async (c) => {
  const tenant = (c.req.param('tenant') ?? '').trim();
  if (!TENANT.test(tenant)) return c.json({ ok: false, error: 'tenant must be a short slug' }, 400);
  const actor = (c as unknown as { get: (k: 'auth') => AuthContext | undefined }).get('auth')?.user?.sub ?? 'operator';
  const results = await runCycle(c.env, tenant, (c.req.query('brand') ?? '').trim() || tenant, Date.now(), actor);
  return c.json({ ok: true, tenant, results });
});
decisionRoutes.get('/:tenant/learn/proposals', jwt({ required: true }), async (c) => {
  const tenant = (c.req.param('tenant') ?? '').trim();
  if (!TENANT.test(tenant)) return c.json({ ok: false, error: 'tenant must be a short slug' }, 400);
  const doc = await read<ProposalsDoc>(c.env, PROPOSALS_KIND, tenant, EMPTY_PROPOSALS);
  c.header('Cache-Control', 'no-store');
  return c.json({ ok: true, tenant, proposals: doc.proposals });
});
decisionRoutes.post('/:tenant/learn/proposals/:id/:decision', jwt({ required: true }), async (c) => {
  const tenant = (c.req.param('tenant') ?? '').trim();
  const decision = c.req.param('decision');
  if (!TENANT.test(tenant) || (decision !== 'apply' && decision !== 'reject')) return c.json({ ok: false, error: 'tenant slug and apply | reject' }, 400);
  const actor = (c as unknown as { get: (k: 'auth') => AuthContext | undefined }).get('auth')?.user?.sub ?? 'operator';
  const res = await decideProposal(c.env, tenant, c.req.param('id') ?? '', decision, actor);
  return res.ok ? c.json(res) : c.json(res, 404);
});

/** POST /v1/:tenant/trend/rollup: what the hourly cron does, on demand. Authenticated. */
decisionRoutes.post('/:tenant/trend/rollup', jwt({ required: true }), async (c) => {
  const tenant = (c.req.param('tenant') ?? '').trim();
  if (!TENANT.test(tenant)) return c.json({ ok: false, error: 'tenant must be a short slug' }, 400);
  return c.json({ ok: true, tenant, ...(await rollupTenant(c.env, tenant)) });
});

decisionRoutes.get('/:tenant/decisions/snapshot', async (c) => {
  const tenant = (c.req.param('tenant') ?? '').trim();
  if (!TENANT.test(tenant)) return c.json({ ok: false, error: 'tenant must be a short slug' }, 400);
  const visitorId = (c.req.query('visitorId') ?? '').trim().slice(0, 128);
  if (!visitorId) return c.json({ ok: false, error: 'visitorId required' }, 400);
  // A visitor id is a Durable Object name and a session key. One that starts with
  // the namespace marker would address another brand's namespace directly.
  if (visitorId.startsWith(NAMESPACE_MARKER)) return c.json({ ok: false, error: 'visitorId may not start with the namespace marker' }, 400);
  const page = ((c.req.query('page') ?? 'home').trim() || 'home').slice(0, 64);
  const brand = (c.req.query('brand') ?? '').trim() || undefined;
  const channel = (c.req.query('channel') ?? '').trim() || null;
  const sessionId = (c.req.query('sessionId') ?? '').trim().slice(0, 64) || null;
  const cf = ((c.req.raw as unknown as { cf?: unknown }).cf ?? null) as { country?: string; regionCode?: string } | null;

  // Two names, on purpose, until CW1 provisions tenants: the path names the SCOPE
  // the documents are read under; the tenancy middleware names the brand whose
  // shopper state and session this request belongs to.
  const out = await serveContentDecisions(c.env, {
    tenant, brand, page, visitorId, sessionId, channel, cf, cookieHeader: c.req.header('Cookie') ?? null,
    stateTenant: c.get('tenant'),
  });
  // Phase 0 and Phase 1, after the response, never on it: the ledger, the visitor's ring, each slot's exposures.
  // CW31: nothing at all when the shopper withheld tracking consent.
  const ledger = out.write ? enqueueDecisions(c.env, out.records) : Promise.resolve();
  try { c.executionCtx.waitUntil(ledger); c.executionCtx.waitUntil(out.afterResponse); } catch { void ledger; void out.afterResponse; }
  c.header('Cache-Control', 'no-store');
  return c.json({ ok: true, ...out });
});

/**
 * GET /v1/:tenant/ledger/batches?date=YYYY-MM-DD[&stream=decision|outcome][&cursor=]
 * The export (doc 22 §12.4) is the R2 partition itself; this lists one day's
 * batch objects so a warehouse job knows what to fetch. Authenticated.
 * Registered before /ledger/:id so the literal segment wins.
 */
decisionRoutes.get('/:tenant/ledger/batches', jwt({ required: true }), async (c) => {
  const tenant = (c.req.param('tenant') ?? '').trim();
  const date = (c.req.query('date') ?? '').trim();
  if (!TENANT.test(tenant) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return c.json({ ok: false, error: 'tenant slug and date=YYYY-MM-DD' }, 400);
  const stream = c.req.query('stream') === 'outcome' ? 'outcome' : c.req.query('stream') === 'decision' ? 'decision' : null;
  const cursor = (c.req.query('cursor') ?? '').trim() || undefined;
  const [listed, tombs] = await Promise.all([
    c.env.STORAGE.list({ prefix: `${tenant}/${date}/`, ...(cursor ? { cursor } : {}), limit: 1000 }),
    loadTombstones(c.env.STORAGE as unknown as R2Erasable, tenant),
  ]);
  const objects = listed.objects
    .filter((o) => !stream || o.key.includes(`/${stream}/`))
    .map((o) => ({ key: o.key, size: o.size, uploaded: o.uploaded instanceof Date ? o.uploaded.toISOString() : String(o.uploaded) }));
  c.header('Cache-Control', 'no-store');
  // CW28: a warehouse job applies the pending erasures to what it loads; the nightly rewrite makes the objects themselves clean.
  return c.json({ ok: true, tenant, date, stream: stream ?? 'both', objects, truncated: listed.truncated, ...(listed.truncated ? { cursor: listed.cursor } : {}), erasures: { pending: tombs.size, list: `/v1/${tenant}/ledger/erasures` } });
});

/**
 * CW28, the ledger half of erasure (doc 22 §15). GET lists the pending
 * tombstones so an export consumer can apply them at once; POST writes one for
 * a visitor and empties her ring (the identity route calls the same function
 * after erasing the profile); POST .../rewrite runs the scheduled rewrite now,
 * as the nightly cron does. All authenticated; the list carries visitor ids.
 * Registered before /ledger/:id so the literal segment wins.
 */
decisionRoutes.get('/:tenant/ledger/erasures', jwt({ required: true }), async (c) => {
  const tenant = (c.req.param('tenant') ?? '').trim();
  if (!TENANT.test(tenant)) return c.json({ ok: false, error: 'tenant must be a short slug' }, 400);
  const tombs = await loadTombstones(c.env.STORAGE as unknown as R2Erasable, tenant);
  c.header('Cache-Control', 'no-store');
  return c.json({ ok: true, tenant, retentionDays: retentionDays(c.env), pending: [...tombs.values()].sort((a, b) => b.erased_at - a.erased_at) });
});
decisionRoutes.post('/:tenant/ledger/erasures', jwt({ required: true }), async (c) => {
  const tenant = (c.req.param('tenant') ?? '').trim();
  if (!TENANT.test(tenant)) return c.json({ ok: false, error: 'tenant must be a short slug' }, 400);
  const b = (await c.req.json().catch(() => null)) as { visitorId?: string } | null;
  const visitorId = (b?.visitorId ?? '').trim();
  if (!visitorId || visitorId.length > 200 || visitorId.startsWith(NAMESPACE_MARKER)) return c.json({ ok: false, error: 'visitorId required' }, 400);
  const actor = (c as unknown as { get: (k: 'auth') => AuthContext | undefined }).get('auth')?.user?.sub ?? 'operator';
  const res = await eraseVisitorLedger(c.env, tenant, visitorId, actor);
  c.header('Cache-Control', 'no-store');
  return c.json({ ...res, tenant });
});
decisionRoutes.post('/:tenant/ledger/erasures/rewrite', jwt({ required: true }), async (c) => {
  const tenant = (c.req.param('tenant') ?? '').trim();
  if (!TENANT.test(tenant)) return c.json({ ok: false, error: 'tenant must be a short slug' }, 400);
  const b = (await c.req.json().catch(() => ({}))) as { maxObjects?: number } | null;
  const maxObjects = typeof b?.maxObjects === 'number' && b.maxObjects > 0 ? Math.floor(b.maxObjects) : undefined;
  const result = await rewriteErasures(c.env.STORAGE as unknown as R2Erasable, tenant, { retentionDays: retentionDays(c.env), ...(maxObjects ? { maxObjects } : {}) });
  c.header('Cache-Control', 'no-store');
  return c.json({ ok: true, ...result });
});

/**
 * GET /v1/:tenant/ledger/:id[?stream=outcome]
 * One record by id, straight from R2 with no index (doc 22 §3.4): the id names
 * the brand and the hour, the batch objects are named by the id range they hold.
 * Authenticated, because a record carries a visitor id. Behind by the queue lag
 * during a peak; exact afterwards.
 */
decisionRoutes.get('/:tenant/ledger/:id', jwt({ required: true }), async (c) => {
  const tenant = (c.req.param('tenant') ?? '').trim();
  const id = (c.req.param('id') ?? '').trim();
  if (!TENANT.test(tenant) || !id.startsWith(`${tenant}:`)) return c.json({ ok: false, error: 'id must belong to the tenant in the path' }, 400);
  const stream = c.req.query('stream') === 'outcome' ? 'outcome' : 'decision';
  const found = await findById<DecisionRecord | OutcomeRecord>(c.env.STORAGE as unknown as R2Like, id, stream);
  c.header('Cache-Control', 'no-store');
  if (!found) return c.json({ ok: false, error: 'not found, or not yet written by the consumer' }, 404);
  if (hidden(await loadTombstones(c.env.STORAGE as unknown as R2Erasable, tenant), found.record)) return c.json({ ok: false, error: 'erased at the visitor\'s request' }, 410);
  return c.json({ ok: true, stream, key: found.key, record: found.record });
});

/**
 * GET /v1/:tenant/replay/:id (doc 22 §12.3). Fetch the decision record, decide
 * again from the documents at the recorded revisions, the archived lift
 * snapshot and the inputs the record carries, and compare. Authenticated,
 * because the record carries a visitor id. Behind by the queue lag at a peak.
 */
decisionRoutes.get('/:tenant/replay/:id', jwt({ required: true }), async (c) => {
  const tenant = (c.req.param('tenant') ?? '').trim();
  const id = (c.req.param('id') ?? '').trim();
  if (!TENANT.test(tenant) || !id.startsWith(`${tenant}:`)) return c.json({ ok: false, error: 'id must belong to the tenant in the path' }, 400);
  const found = await findById<DecisionRecord>(c.env.STORAGE as unknown as R2Like, id, 'decision');
  c.header('Cache-Control', 'no-store');
  if (!found) return c.json({ ok: false, error: 'not found, or not yet written by the consumer' }, 404);
  if (hidden(await loadTombstones(c.env.STORAGE as unknown as R2Erasable, tenant), found.record)) return c.json({ ok: false, error: 'erased at the visitor\'s request' }, 410);
  const result = await replayDecision(c.env, found.record);
  return c.json({ ok: result.ok, equal: result.equal, ...(result.reason ? { reason: result.reason } : {}), used: result.used, diff: result.diff, key: found.key, served: result.served, replayed: result.replayed });
});

/**
 * POST /v1/:tenant/models/reference (doc 22 §9). The reference implementation
 * of the model contract, as a service a data science team can call to see the
 * shape, and point the `service` kind at by URL to see the term on a receipt.
 * Stateless; no visitor id crosses it.
 */
decisionRoutes.post('/:tenant/models/reference', async (c) => {
  const tenant = (c.req.param('tenant') ?? '').trim();
  if (!TENANT.test(tenant)) return c.json({ ok: false, error: 'tenant must be a short slug' }, 400);
  const body = (await c.req.json().catch(() => null)) as Partial<ExternalRequest> | null;
  if (!body || typeof body !== 'object' || !Array.isArray(body.candidates)) return c.json({ ok: false, error: 'a contract request: affinity and candidates' }, 400);
  const req: ExternalRequest = {
    tenant, brand: typeof body.brand === 'string' ? body.brand : tenant, page: typeof body.page === 'string' ? body.page : '', slots: Array.isArray(body.slots) ? body.slots.map(String) : [],
    cell: (body.cell as ExternalRequest['cell']) ?? { channel: 'unknown', visit_bucket: 'unknown', region: null, affinity: null },
    affinity: body.affinity && typeof body.affinity === 'object' ? body.affinity : {},
    candidates: body.candidates.filter((x): x is ExternalRequest['candidates'][number] => Boolean(x) && typeof x === 'object' && typeof (x as { id?: unknown }).id === 'string').map((x) => ({ id: x.id, tags: x.tags && typeof x.tags === 'object' ? x.tags : {} })),
  };
  return c.json(referenceScore(req));
});

/** GET /v1/:tenant/lift/history?slot=[&brand=]: every archived snapshot version for the slot (doc 22 §12.2). */
decisionRoutes.get('/:tenant/lift/history', async (c) => {
  const tenant = (c.req.param('tenant') ?? '').trim();
  const slot = (c.req.query('slot') ?? '').trim();
  if (!TENANT.test(tenant) || !slot) return c.json({ ok: false, error: 'tenant slug and slot' }, 400);
  const brand = (c.req.query('brand') ?? '').trim() || tenant;
  const prefix = `lift/${tenant}/${brand}/${slot}/`;
  const versions: Array<{ version: number; size: number; uploaded: string }> = [];
  let cursor: string | undefined;
  do {
    const page = await c.env.STORAGE.list({ prefix, ...(cursor ? { cursor } : {}), limit: 1000 });
    for (const o of page.objects) {
      const v = Number(o.key.slice(prefix.length).replace(/\.json$/, ''));
      if (v > 0) versions.push({ version: v, size: o.size, uploaded: o.uploaded instanceof Date ? o.uploaded.toISOString() : String(o.uploaded) });
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  versions.sort((a, b) => b.version - a.version);
  c.header('Cache-Control', 'no-store');
  return c.json({ ok: true, tenant, brand, slot, versions });
});

/**
 * POST /v1/:tenant/learn/items/reset (doc 22 §12.2): discard one item's evidence in one slot and start
 * again from the prior. The next snapshot publishes at once; the learn document gets a revision whose
 * content is unchanged and whose note records who reset what, so the audit trail shows it.
 */
decisionRoutes.post('/:tenant/learn/items/reset', jwt({ required: true }), async (c) => {
  const tenant = (c.req.param('tenant') ?? '').trim();
  if (!TENANT.test(tenant)) return c.json({ ok: false, error: 'tenant must be a short slug' }, 400);
  const b = (await c.req.json().catch(() => null)) as { slot?: string; item?: string; brand?: string } | null;
  if (!b?.slot || !b.item) return c.json({ ok: false, error: 'slot and item required' }, 400);
  const brand = (b.brand ?? '').trim() || tenant;
  if (!c.env.LEARN_STATS) return c.json({ ok: false, error: 'LEARN_STATS binding absent on this stamp' }, 503);
  const actor = (c as unknown as { get: (k: 'auth') => AuthContext | undefined }).get('auth')?.user?.sub ?? 'operator';
  const stub = c.env.LEARN_STATS.get(c.env.LEARN_STATS.idFromName(statsName(tenant, brand, b.slot)));
  const res = (await (await stub.fetch('https://learn/reset-item', { method: 'POST', body: JSON.stringify({ item: b.item }) })).json()) as { ok: boolean; had?: boolean };
  invalidateLiftCache();
  const current = await read<LearnConfig>(c.env, LEARN_KIND, tenant, DEFAULT_LEARN);
  const rev = await write(c.env, LEARN_KIND, tenant, current, { actor, note: `reset ${b.item} in ${b.slot}${brand !== tenant ? ` (${brand})` : ''}: evidence discarded by ${actor}, estimate restarts from the prior` });
  return c.json({ ok: res.ok, had: res.had ?? false, revision: rev.ok ? rev.revision.revision : null });
});

/**
 * POST /v1/:tenant/learn/publish { slot, brand? }: publish the slot's lift snapshot now, as the object's
 * alarm does within the minute. For an operator who has just changed a dial, and for the acceptance run.
 */
decisionRoutes.post('/:tenant/learn/publish', jwt({ required: true }), async (c) => {
  const tenant = (c.req.param('tenant') ?? '').trim();
  if (!TENANT.test(tenant)) return c.json({ ok: false, error: 'tenant must be a short slug' }, 400);
  const b = (await c.req.json().catch(() => null)) as { slot?: string; brand?: string } | null;
  if (!b?.slot) return c.json({ ok: false, error: 'slot required' }, 400);
  const brand = (b.brand ?? '').trim() || tenant;
  if (!c.env.LEARN_STATS) return c.json({ ok: false, error: 'LEARN_STATS binding absent on this stamp' }, 503);
  const stub = c.env.LEARN_STATS.get(c.env.LEARN_STATS.idFromName(statsName(tenant, brand, b.slot)));
  const res = (await (await stub.fetch('https://learn/publish', { method: 'POST' })).json()) as { ok: boolean; published?: boolean; snapshot?: unknown };
  invalidateLiftCache();
  c.header('Cache-Control', 'no-store');
  // The object answers with what it published, ahead of KV's cache; `published` is false when it has no evidence yet.
  return c.json({ ok: res.ok, tenant, brand, slot: b.slot, published: res.published ?? false, snapshot: res.snapshot ?? null });
});

/**
 * POST /v1/:tenant/learn/report (doc 22 §4.2, §7, §10): the day's ledger under the learning policy and
 * any reporting policies, side by side; what explored; the holdout arms. Body: { date, brand?, policies? }.
 * GET reads the last report built for the day. Aggregates only; no visitor id in the result.
 */
decisionRoutes.post('/:tenant/learn/report', jwt({ required: true }), async (c) => {
  const tenant = (c.req.param('tenant') ?? '').trim();
  if (!TENANT.test(tenant)) return c.json({ ok: false, error: 'tenant must be a short slug' }, 400);
  const b = (await c.req.json().catch(() => ({}))) as { date?: string; brand?: string; policies?: unknown };
  const date = (b.date ?? new Date().toISOString().slice(0, 10)).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return c.json({ ok: false, error: 'date=YYYY-MM-DD' }, 400);
  const brand = (b.brand ?? '').trim() || tenant;
  const learn = await read<LearnConfig>(c.env, LEARN_KIND, tenant, DEFAULT_LEARN);
  let policies: ReportPolicy[] | null = null;
  if (Array.isArray(b.policies)) {
    policies = [];
    for (const p of b.policies as Array<Record<string, unknown>>) {
      const okScope = p.scope === 'session' || p.scope === 'visitor', okMatch = p.match === 'direct' || p.match === 'any', okCredit = p.credit === 'last' || p.credit === 'first';
      if (!p || typeof p.name !== 'string' || !okScope || !okMatch || !okCredit) return c.json({ ok: false, error: 'each policy: name, scope session|visitor, match direct|any, credit last|first, windowsMs?' }, 400);
      const windowsMs: Record<string, number> = {};
      if (p.windowsMs && typeof p.windowsMs === 'object') for (const [k, v] of Object.entries(p.windowsMs as Record<string, unknown>)) if (typeof v === 'number' && v > 0) windowsMs[k] = v;
      policies.push({ name: p.name.slice(0, 40), scope: p.scope as 'session' | 'visitor', match: p.match as 'direct' | 'any', credit: p.credit as 'last' | 'first', windowsMs: Object.keys(windowsMs).length ? windowsMs : learn.policy?.windowsMs ?? {} });
    }
  }
  const report = await runReport(c.env.STORAGE as unknown as Parameters<typeof runReport>[0], { tenant, brand, date }, learn, policies);
  c.header('Cache-Control', 'no-store');
  return c.json({ ok: true, report });
});
/**
 * CW34 (delivery lane, named in plan 21): the day reports over a window, pooled per
 * slot and arm and compared at the asked confidence against the pre-set targets.
 * Reads reports already built; a day without one is listed as missing.
 */
decisionRoutes.get('/:tenant/learn/report/window', async (c) => {
  const tenant = (c.req.param('tenant') ?? '').trim();
  const from = (c.req.query('from') ?? '').trim();
  const to = (c.req.query('to') ?? '').trim();
  if (!TENANT.test(tenant) || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return c.json({ ok: false, error: 'tenant slug, from=YYYY-MM-DD and to=YYYY-MM-DD' }, 400);
  const brand = (c.req.query('brand') ?? '').trim() || tenant;
  const conf = Number(c.req.query('confidence') ?? '0.95');
  const confidence = [0.9, 0.95, 0.99].includes(conf) ? conf : 0.95;
  const report = await windowReport(c.env.STORAGE as unknown as Parameters<typeof windowReport>[0], { tenant, brand, from, to }, { confidence });
  c.header('Cache-Control', 'no-store');
  return c.json({ ok: true, report });
});
decisionRoutes.get('/:tenant/learn/report', async (c) => {
  const tenant = (c.req.param('tenant') ?? '').trim();
  const date = (c.req.query('date') ?? '').trim();
  if (!TENANT.test(tenant) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return c.json({ ok: false, error: 'tenant slug and date=YYYY-MM-DD' }, 400);
  const brand = (c.req.query('brand') ?? '').trim() || tenant;
  let report: DayReport | null = null;
  try { const obj = await c.env.STORAGE.get(reportKey(tenant, brand, date)); report = obj ? ((await obj.json()) as DayReport) : null; } catch { report = null; }
  c.header('Cache-Control', 'no-store');
  return report ? c.json({ ok: true, report }) : c.json({ ok: false, error: 'no report built for that day yet' }, 404);
});

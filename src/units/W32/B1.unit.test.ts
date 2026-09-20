// src/units/W32/B1.unit.test.ts
// Batch W32-B1 — the report envelope and the catalogue envelope (document 35 §5
// row W32 :434, §2 N20/N21/N24; F34 §2F and §4 items 2-4; F32 §2.1-2.7, §4
// items 1-10, §6; HANDOFF-2026-09-16 :236; HANDOFF-2026-09-18 :328, §7 item 7,
// §8 D09; ruling R186).
//
// The local scope only. The whole accepted workload qualification on the Worker
// and the model evaluation of zero-base influence and the serving-mixture
// reference against an agreed objective are the owner's and Data Science's
// (W32.P1.01, D09); leave-one-out is never mandated here (N21: a
// MODEL-VALIDATION question, not a proved defect).
//
// N24 is explicit that "Node timing is not a reproduced Worker CPU-limit
// failure", so NOTHING in this file gates on wall clock. Cost is measured by
// SHAPE: a counter on the fixture's own property reads, at two sizes, with a
// negative control that proves the counter can see a quadratic lookup.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { JSDOM } from 'jsdom';
import { Hono } from 'hono';
import * as jose from 'jose';

import type { Env } from '@/types/env';
import type { DecisionRecord, ContentCatalog, LearnConfig } from '@/content/types';
import type { OutcomeRecord } from '@/ledger/records';
import type { DocumentKind } from '@/config/versionedStore';
import { invalidateCache, write } from '@/config/versionedStore';
import { initializePublicationSet, PUBLICATION_MAX_BYTES, readPublication } from '@/config/publication';
import { CONTENT_KIND, DEFAULT_LEARN, DEFAULT_SLOTS, EMPTY_CATALOG, LEARN_KIND, SLOTS_KIND } from '@/content/kinds';
import { DEFAULT_REFLEX_CONFIG } from '@/reflex/core';
import { REFLEX_KIND, reflexScopeForTenant } from '@/reflex/configStore';
import { EMPTY_PRIORS, indexPriors, PRIORS_KIND, type PriorsDoc } from '@/learn/priors';
import { EMPTY_PROPOSALS, PROPOSALS_KIND } from '@/learn/cycle';
import { contentRoutes } from '@/routes/content';
import { decisionRoutes } from '@/routes/decisions';
import { tenantMiddleware } from '@/tenancy/middleware';
import { buildReport, REPORT_LIMITS, ReportBudgetExceeded, readReportView, canonicalReportJson, type ReportPolicy } from '@/learn/report';
import { DEFAULT_POLICY } from '@/learn/policy';
import { buildSnapshot, DEFAULT_STATS, emptyStats, liftReferenceOf, recordExposure, recordSuccess } from '@/learn/stats';
import { liftKey } from '@/learn/fan';
import { receiptOf } from '@/learn/receipts';
import { composeContentDetailed, type ContentPieceLike, type ContentSlotSpec } from '@/reflex/contentCompose';

// ── Witnesses are resolved from THIS file, never from `process.cwd()` ────────
const repoFile = (path: string) => readFileSync(new URL('../../../' + path, import.meta.url), 'utf8');
const KIT = ['docs/kit/01-integration-guide.md', 'docs/kit/02-api-reference.md', 'docs/kit/03-payload-schemas.md']
  .map(repoFile).join('\n\n');
const utf8 = (s: string) => new TextEncoder().encode(s).length;

// ── Shared publication fixture (the same shape `src/routes/content.test.ts` uses) ──
class CatalogR2 {
  objects = new Map<string, string>(); etags = new Map<string, string>(); puts = 0;
  async get(key: string) {
    const raw = this.objects.get(key); if (raw === undefined) return null;
    return { key, etag: this.etags.get(key), size: utf8(raw), body: new Response(raw).body };
  }
  async put(key: string, raw: string, options: R2PutOptions) {
    const attempt = ++this.puts, condition = options.onlyIf;
    if (condition instanceof Headers ? this.objects.has(key) : condition?.etagMatches !== this.etags.get(key)) return null;
    this.objects.set(key, raw); this.etags.set(key, `w32-${attempt}`);
    return { key, etag: this.etags.get(key), size: utf8(raw) };
  }
}
class FakeKV {
  store = new Map<string, string>();
  async get(key: string, type?: string): Promise<unknown> {
    const raw = this.store.get(key); return raw === undefined ? null : type === 'stream' ? new Response(raw).body : JSON.parse(raw);
  }
  async put(key: string, value: string): Promise<void> { this.store.set(key, value); }
}
const SIGNING = 'w32b1-synthetic-route-signing-material-only';
const mkEnv = (): Env => ({ CACHE: new FakeKV(), STORAGE: new CatalogR2(), JWT_SECRET: SIGNING, JWT_ISSUER: 'i', JWT_AUDIENCE: 'a',
  TENANTS: JSON.stringify({ provisioned: ['coach'], operatorGrants: { ops: ['coach'] } }) } as unknown as Env);
const bearer = async () => `Bearer ${await new jose.SignJWT({ sub: 'ops', type: 'service' }).setProtectedHeader({ alg: 'HS256' })
  .setIssuedAt().setIssuer('i').setAudience('a').setExpirationTime('5m').sign(new TextEncoder().encode(SIGNING))}`;
const FIXTURE_KINDS: DocumentKind<unknown>[] = [CONTENT_KIND, SLOTS_KIND, LEARN_KIND, REFLEX_KIND, PRIORS_KIND, PROPOSALS_KIND];
async function initialize(env: Env, catalog: ContentCatalog = EMPTY_CATALOG, scope = 'coach') {
  const values = [catalog, DEFAULT_SLOTS, DEFAULT_LEARN, DEFAULT_REFLEX_CONFIG, EMPTY_PRIORS, EMPTY_PROPOSALS];
  return initializePublicationSet(env, FIXTURE_KINDS.map((kind, i) => ({ kind, scope: kind.name === 'reflex' ? reflexScopeForTenant(scope) : scope,
    revision: { revision: 1, value: values[i], actor: 'w32-synthetic', note: '', at: 1 } })), '0:' + crypto.randomUUID());
}
/** The exact canonical form `src/config/publication.ts` charges the ceiling against. */
const canonical = (value: unknown): string => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']'
  : value && typeof value === 'object' ? '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical((value as Record<string, unknown>)[k])).join(',') + '}'
    : JSON.stringify(value);
const publicationHeaders = (env: Env, auth: Record<string, string>, revision: number, scope = 'coach') => {
  const storage = env.STORAGE as unknown as CatalogR2;
  const head = JSON.parse(storage.objects.get('config-publication/v2/' + scope + '/head.json')!);
  return { ...auth, 'If-Match': `"${revision}/${head.committed.revision}/${head.committed.digest}"`, 'Idempotency-Key': `${revision}:${crypto.randomUUID()}` };
};
const catalogPiece = (id: string) => ({ id, customerContentId: `CMP-${id}`, type: 'editorial', title: `Piece ${id}`,
  tags: { line: ['Tabby'], occasion: ['Everyday'] }, slotTypes: ['story', 'hero'] });
/**
 * The SHIPPED catalogue's own piece shape, read from the tenant catalogue this
 * repository ships: F32 §2.1's calibration is that a real piece costs ~672
 * compact bytes, and the audit's own numbers were 3.4x optimistic because they
 * sized a thinner synthetic piece. Anything that measures the envelope is
 * measured against this shape and never against a thin one.
 */
const SHIPPED = (JSON.parse(repoFile('public/data/coach-content.json')) as { pieces: Array<Record<string, unknown>> }).pieces;
const shippedPiece = (n: number) => ({ ...SHIPPED[n % SHIPPED.length]!, id: 'shipped-' + n, customerContentId: 'CCH-' + n });

// ════════════════════════════════════════════════════════════════════════════
// W32.L1.01 — the indexed lookup and the report bounds, by name; any remaining
// construction linear by SHAPE (N24, F34 §2F.2, §4 item 2).
// ════════════════════════════════════════════════════════════════════════════
const T0 = Date.parse('2026-09-03T10:00:00Z');
const CELL = { channel: 'email', visit_bucket: '2-3' as const, stage: 'mid' as const, region: 'US-NY', affinity: 'line:tabby' };
const ITEMS = ['tabby-film', 'willow-slg', 'signature-charms', 'fragrance-note', 'drover-edit', 'weekend-edit', 'evening-edit', 'gift-edit'];

/** A decision whose `decision_id` COUNTS every read, so the lookup's shape is observable. */
function countingDecision(counter: { reads: number }, n: number): DecisionRecord {
  const visitor = 'v' + n, ts = T0 + n, id = `coach:${ts.toString(36)}:${visitor}:home:hero:0`;
  const row = { tenant: 'coach', brand: 'coach', visitor_id: visitor, session_id: 's' + n, identity_anchor: 'visitor', ts,
    page: 'home', slot: 'hero', position: 0, item_id: ITEMS[n % ITEMS.length]!, customer_item_id: 'cms', candidates: [], cell: CELL,
    arm: 'personalized', explored: false, authority: 'engine', versions: { config: 1, lift: 0, prior: 0, policy: 1 },
    config_label: 'v1', explain: { drivers: [], score_base: 0, lift: null, score_final: 0 } };
  Object.defineProperty(row, 'decision_id', { get() { counter.reads++; return id; }, enumerable: true, configurable: true });
  return row as unknown as DecisionRecord;
}
/** An outcome with NO `decision_id`: the path that resolves through the id index. */
const clickFor = (n: number): OutcomeRecord => ({ outcome_id: `coach:${(T0 + n).toString(36)}:v${n}:click`, tenant: 'coach', brand: 'coach',
  visitor_id: 'v' + n, session_id: 's' + n, ts: T0 + n + 1000, type: 'click', event: 'click', item_id: ITEMS[n % ITEMS.length]!,
  slot: null, value: null, currency: null, margin: null, products: null, arm: null } as unknown as OutcomeRecord);

const LEARN: LearnConfig = { holdout: { share: 0.1, salt: '', arms: ['default'] }, slots: { hero: { reward: 'click' } } } as LearnConfig;
const LEARNING: ReportPolicy = { name: 'learning', ...DEFAULT_POLICY };
const dayOf = (decisions: DecisionRecord[], outcomes: OutcomeRecord[]) => ({ tenant: 'coach', brand: 'coach', date: '2026-09-03',
  learning: LEARNING, reporting: [], learn: LEARN, decisions, outcomes, now: T0 + 86_400_000, truncated: false });

describe('unit:W32.L1.01', () => {
  it('logic: the report budgets refuse by name, the day is built through an id INDEX whose cost per record does not grow with the day, and a day whose work is quadratic in records is refused as `work`', () => {
    // 1 · The budgets, by name and value (F34 §2F: the report object exceeded a
    // Worker because nothing bounded the records, the cells or the payload).
    expect(REPORT_LIMITS.records).toBe(50_000);
    expect(REPORT_LIMITS.work).toBe(1_000_000);
    expect(REPORT_LIMITS.cells).toBe(16_384);
    expect(REPORT_LIMITS.policies).toBe(6);
    expect(REPORT_LIMITS.objects).toBe(800);
    expect(REPORT_LIMITS.rawBytes).toBe(16 * 1024 * 1024);
    expect(REPORT_LIMITS.outputBytes).toBe(8 * 1024 * 1024);
    expect(REPORT_LIMITS.savedBytes).toBe(8 * 1024 * 1024);
    expect(REPORT_LIMITS.windowBytes).toBe(16 * 1024 * 1024);
    expect(REPORT_LIMITS.summaryBytes).toBe(64 * 1024);

    // 2 · SHAPE, not milliseconds. One decision and one credited outcome per
    // visitor, at two sizes four times apart. `buildReport` reads each stored
    // decision's own id a FIXED number of times, so the reads per record are the
    // same number at 4,000 records as at 16,000. A lookup that scanned the
    // decisions once per credited outcome (F34 §4 item 2, report.ts:113 as
    // audited) would read them 4x more often per record at the larger size.
    const measure = (n: number) => {
      const counter = { reads: 0 };
      const decisions = Array.from({ length: n }, (_, i) => countingDecision(counter, i));
      const outcomes = Array.from({ length: n }, (_, i) => clickFor(i));
      const report = buildReport(dayOf(decisions, outcomes));
      expect(report.counts.decisions).toBe(n);
      expect(report.holdout.hero!.find(row => row.arm === 'personalized')!.credited).toBe(n);
      return counter.reads;
    };
    const small = measure(4_000), large = measure(16_000);
    expect(small).toBeGreaterThan(0);
    expect(large / 16_000).toBe(small / 4_000);

    // Negative control for the counter itself: the lookup this fix replaced,
    // run here in the test and nowhere else, IS visible to it as 4x the reads
    // per record. A measurement that cannot see the defect proves nothing.
    const scanned = (n: number) => {
      const counter = { reads: 0 };
      const decisions = Array.from({ length: n }, (_, i) => countingDecision(counter, i));
      for (let i = 0; i < n; i++) decisions.find(d => d.decision_id === 'coach:absent');
      return counter.reads / n;
    };
    expect(scanned(1_000) * 4).toBe(scanned(4_000));

    // 3 · The day whose work really is quadratic in records — one visitor with a
    // thousand decisions and two hundred outcomes, each of which must be
    // attributed against her whole ring — is REFUSED, by the budget's own name,
    // before any grid is built (N24: bound the work, do not time it).
    const one = { reads: 0 };
    const heavy = Array.from({ length: 1_000 }, (_, i) => {
      const row = countingDecision(one, i) as unknown as { visitor_id: string; session_id: string };
      row.visitor_id = 'one-visitor'; row.session_id = 'one-session'; return row as unknown as DecisionRecord;
    });
    const many = Array.from({ length: 200 }, (_, i) => ({ ...clickFor(i), visitor_id: 'one-visitor', session_id: 'one-session' }) as OutcomeRecord);
    let refusal: unknown;
    try { buildReport(dayOf(heavy, many)); } catch (error) { refusal = error; }
    expect(refusal).toBeInstanceOf(ReportBudgetExceeded);
    expect((refusal as ReportBudgetExceeded).budget).toBe('work');
    expect((refusal as ReportBudgetExceeded).limit).toBe(REPORT_LIMITS.work);
  });

  it('logic: a saved day is read back as a paged, slot-projected view whose page states its own total, offset and links, and the canonical body carries a summary inside the summary budget', async () => {
    const rows = Array.from({ length: 120 }, (_, i) => {
      const counter = { reads: 0 }, row = countingDecision(counter, i) as unknown as { item_id: string };
      row.item_id = 'item-' + String(i).padStart(3, '0'); return row as unknown as DecisionRecord;
    });
    const report = buildReport(dayOf(rows, []));
    const body = canonicalReportJson(report);
    expect(body.startsWith('{"_summary":')).toBe(true);
    expect(utf8(body.slice(0, body.indexOf('\n')))).toBeLessThanOrEqual(REPORT_LIMITS.summaryBytes);

    const r2 = { get: async () => ({ text: async () => body }) };
    const ids = { tenant: 'coach', brand: 'coach', date: '2026-09-03' };
    const first = await readReportView(r2, ids, { slot: 'hero', limit: '50' });
    expect(first!.page!.total).toBe(120);
    expect(first!.page!.offset).toBe(0);
    expect(first!.page!.limit).toBe(50);
    expect(first!.page!.previous).toBeNull();
    expect(Object.keys(first!.report.grids.hero!.learning!.items)).toHaveLength(50);
    const second = await readReportView(r2, ids, { slot: 'hero', limit: '50', cursor: first!.page!.next! });
    expect(second!.page!.offset).toBe(50);
    expect(Object.keys(second!.report.grids.hero!.learning!.items)[0]).toBe('item-050');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// W32.E1.01 — the catalogue envelope: no stored duplicate, a named refusal at
// the ceiling, the size ANSWERED and RENDERED, the supported envelope PUBLISHED
// (F32 §2.1, §2.4-§2.6, §4 items 1-4 and 8, §6 items 1-4).
// ════════════════════════════════════════════════════════════════════════════
const ENVELOPE_FIELDS = ['actor', 'at', 'digest', 'kind', 'note', 'operation', 'revision', 'schema', 'scope', 'value'];
/** Kit assertions report the clause, never the whole kit, so a failure is readable. */
const kitStates = (pattern: RegExp) => pattern.test(KIT);

describe('unit:W32.E1.01', () => {
  it('logic: a stored revision carries the document ONCE, reads back whole, and the bytes the ceiling is charged against are answered by `documentBytes`; the kit publishes the supported envelope as a measured number per scope', async () => {
    invalidateCache();
    const env = mkEnv(), storage = env.STORAGE as unknown as CatalogR2;
    const catalog = { pieces: [catalogPiece('a'), catalogPiece('b')] } as unknown as ContentCatalog;
    await initialize(env, catalog);

    // 1 · No second copy of the document under another name. F32 §1.1/§6.1: the
    // write stored the value twice and the read used one of them, so the stored
    // envelope's key set is the property that says the duplicate is gone — and
    // every stored document still reads through the ordinary read.
    const stored = JSON.parse(storage.objects.get('config-publication/v1/coach/content/rev/1.json')!) as Record<string, unknown>;
    expect(Object.keys(stored).sort()).toEqual(ENVELOPE_FIELDS);
    expect((await readPublication(env, CONTENT_KIND, 'coach')).value.pieces.map(p => p.id)).toEqual(['a', 'b']);

    // 2 · The ceiling is a constant read off the module, and the bytes an
    // operator is shown are the bytes that constant is compared against.
    const publication = await import('@/config/publication') as unknown as Record<string, unknown>;
    expect(typeof publication.documentBytes,
      'W32.E1.01: `documentBytes(value)` — the UTF-8 bytes the publication ceiling is charged against — must be exported from src/config/publication.ts')
      .toBe('function');
    const documentBytes = publication.documentBytes as (value: unknown) => number;
    expect(documentBytes(catalog)).toBe(utf8(canonical(catalog)));
    expect(PUBLICATION_MAX_BYTES).toBe(2 * 1024 * 1024);

    // The ceiling refuses inside `write()` itself, by its own name, before any
    // object is put — never as a raw storage failure (F32 §4 item 8, §6.2).
    const over = { pieces: Array.from({ length: 4_000 }, (_, i) => shippedPiece(i)) };
    expect(documentBytes(over)).toBeGreaterThan(PUBLICATION_MAX_BYTES);
    const head = JSON.parse(storage.objects.get('config-publication/v2/coach/head.json')!) as { committed: { revision: number; digest: string } };
    const puts = storage.puts;
    await expect(write(env, CONTENT_KIND, 'coach', over,
      { actor: 'ops', note: '', expectedRevision: 1, operationId: '1:' + crypto.randomUUID(), expectedPublication: head.committed }))
      .rejects.toMatchObject({ status: 413, code: 'document_too_large' });
    expect(storage.puts).toBe(puts);
    expect((await readPublication(env, CONTENT_KIND, 'coach')).value.pieces).toHaveLength(2);

    // 3 · The supported envelope, published as a number the platform can carry
    // (F32 §6.4: "so the next customer conversation starts from a number rather
    // than from an assumption"). The document ceiling the kit states is the
    // module's own constant, and the piece count it states is one this engine
    // really admits under that ceiling at the shipped catalogue's piece shape.
    const mib = `${PUBLICATION_MAX_BYTES / 1024 / 1024} MiB`;
    expect(kitStates(new RegExp(`${mib}|${PUBLICATION_MAX_BYTES.toLocaleString('en-US')}`)),
      `W32.E1.01: the kit must state the supported configuration-document ceiling as ${mib} (PUBLICATION_MAX_BYTES)`).toBe(true);
    const published = /up to ([0-9][0-9,]*) content pieces per scope/.exec(KIT);
    expect(Boolean(published), 'W32.E1.01: the kit must publish the measured supported envelope as "up to N content pieces per scope"').toBe(true);
    const supported = Number(published![1]!.replace(/,/g, ''));
    expect(supported).toBeGreaterThan(0);
    const measured = { pieces: Array.from({ length: supported }, (_, i) => shippedPiece(i)) };
    expect(documentBytes(measured),
      `W32.E1.01: the kit publishes ${supported} pieces per scope, so ${supported} pieces of the shipped catalogue's shape must fit the ceiling`)
      .toBeLessThanOrEqual(PUBLICATION_MAX_BYTES);
  });

  it('host: the mounted content routes answer the catalogue\'s byte size and piece count, and refuse a document over the ceiling with a NAMED refusal that stores nothing', async () => {
    invalidateCache();
    const env = mkEnv(), storage = env.STORAGE as unknown as CatalogR2;
    const app = new Hono<{ Bindings: Env; Variables: { tenant: string } }>();
    app.use('*', tenantMiddleware()); app.route('/', contentRoutes);
    const auth = { 'Content-Type': 'application/json', Authorization: await bearer() };
    const catalog = { pieces: Array.from({ length: 12 }, (_, i) => catalogPiece('piece-' + i)) } as unknown as ContentCatalog;
    await initialize(env, catalog);

    const publication = await import('@/config/publication') as unknown as Record<string, unknown>;
    const documentBytes = publication.documentBytes as ((value: unknown) => number) | undefined;

    const read = await app.request('http://w/catalog?scope=coach', { headers: auth }, env);
    expect(read.status).toBe(200);
    const body = await read.json() as { document: ContentCatalog; envelope?: { pieces: number; bytes: number; limitBytes: number } };
    expect(body.envelope, 'W32.E1.01: GET /content/:kind must answer `envelope: { pieces, bytes, limitBytes }` — F32 §6.2, the merchandiser must never discover the ceiling as a 500').toBeDefined();
    expect(body.envelope!.pieces).toBe(12);
    expect(body.envelope!.limitBytes).toBe(PUBLICATION_MAX_BYTES);
    expect(body.envelope!.bytes).toBe(utf8(canonical(body.document)));
    if (documentBytes) expect(body.envelope!.bytes).toBe(documentBytes(body.document));

    // The same answer at a different size is a different number: it is measured
    // from the document, not a constant.
    const bigger = { pieces: Array.from({ length: 40 }, (_, i) => catalogPiece('piece-' + i)) } as unknown as ContentCatalog;
    const env2 = mkEnv(); invalidateCache(); await initialize(env2, bigger);
    const read2 = await app.request('http://w/catalog?scope=coach', { headers: auth }, env2);
    const body2 = await read2.json() as { envelope?: { pieces: number; bytes: number } };
    expect(body2.envelope!.pieces).toBe(40);
    expect(body2.envelope!.bytes).toBeGreaterThan(body.envelope!.bytes);

    // Over the ceiling: a NAMED refusal carried to the operator, with the budget
    // it broke and the numbers behind it, and nothing written — never the raw KV
    // 500 through `app.onError` that F32 §4 item 8 describes. The route's own
    // input bound is the same 2 MiB as the publication ceiling, so this door
    // answers first; the ceiling inside `write()` is locked by the logic leg.
    invalidateCache();
    const before = storage.puts, revisions = storage.objects.size;
    const huge = { pieces: [{ ...catalogPiece('huge'), title: 'é'.repeat(PUBLICATION_MAX_BYTES) }] };
    const refused = await app.request('http://w/catalog?scope=coach',
      { method: 'PUT', headers: publicationHeaders(env, auth, 1), body: JSON.stringify({ document: huge }) }, env);
    expect(refused.status).toBe(413);
    expect(await refused.json()).toMatchObject({ ok: false, code: 'input_budget_exceeded', budget: 'bytes', limit: PUBLICATION_MAX_BYTES });
    expect(storage.puts).toBe(before);
    expect(storage.objects.size).toBe(revisions);
    expect((await readPublication(env, CONTENT_KIND, 'coach')).revision).toBe(1);
  });

  it('sdk: the console\'s catalogue card renders the catalogue\'s piece count and byte size, and renders no stray value when a deployment answers without them', async () => {
    const ENVELOPE = { pieces: 12, bytes: 3584, limitBytes: PUBLICATION_MAX_BYTES };
    const open = async (envelope: typeof ENVELOPE | null) => {
      const dom = new JSDOM(repoFile('public/console/index.html'),
        { url: 'http://console.test/console/#/history?scope=coach&slot=chero', pretendToBeVisual: true, runScripts: 'outside-only' });
      const w = dom.window as unknown as Record<string, unknown> & {
        document: { body: { textContent: string | null }; getElementById(id: string): unknown; querySelectorAll(s: string): ArrayLike<{ textContent: string | null }> };
        eval(source: string): unknown; close(): void; Event: new (t: string, o: object) => unknown };
      const json = (value: unknown, status = 200) => Response.json(value, { status });
      w.fetch = async (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => {
        const u = new URL(url, 'http://console.test'), path = u.pathname;
        if (path === '/auth/login') return json({ accessToken: 'h.' + Buffer.from(JSON.stringify({ sub: 'ops-1', roles: ['admin'], exp: Math.floor(Date.now() / 1000) + 900 })).toString('base64url') + '.s',
          refreshToken: 'r', user: { id: 'ops-1', email: 'ops@brand.test', name: 'Test Operator', roles: ['admin'] }, mustChangePassword: false, expiresIn: 900 });
        if (path === '/auth/authority') return json({ customer: false, stampOwner: true });
        if (path === '/auth/logout') return json({ success: true });
        if (path === '/content/catalog') return json({ ok: true, source: 'stored', revision: 4,
          document: { pieces: Array.from({ length: 12 }, (_, i) => ({ id: 'p' + i, title: 'P' + i })) }, ...(envelope ? { envelope } : {}) });
        if (path.endsWith('/history')) {
          const kind = path.split('/').slice(-2)[0];
          return json({ ok: true, revisions: kind === 'priors' ? [] : [{ revision: 2, version: `${kind}-v1+r2`, actor: 'Local Ops', note: 'the second', at: 1_788_000_000_000 }] });
        }
        if (path === '/v1/coach/lift/history') return json({ ok: true, versions: [] });
        if (path === '/config/reflex') return json({ scope: 'coach', source: 'stored', revision: 3, actor: 'ops', note: '', at: 1_788_000_000_000, config: DEFAULT_REFLEX_CONFIG, inherited: [], warnings: [] });
        if (path === '/content/learn') return json({ ok: true, source: 'stored', revision: 2, document: { holdout: { share: 0.1, salt: '', arms: ['default'] }, slots: {} } });
        if (path === '/content/slots') return json({ ok: true, source: 'stored', revision: 3, document: DEFAULT_SLOTS });
        if (path === '/content/priors') return json({ ok: true, source: 'compiled-default', revision: 0, document: EMPTY_PRIORS });
        if (path === '/v1/coach/learn/slots') return json({ ok: true, total: 1, pages: [{ page: 'home', slots: [{ slot: 'chero', take: 1 }] }] });
        return json({ ok: true });
      };
      w.Headers = Headers; w.TextEncoder = TextEncoder; w.confirm = () => true; w.setInterval = () => 0;
      w.eval(repoFile('public/operator-session.js'));
      for (const file of ['shell.js', 'views.js', 'views-config.js', 'views-measure.js', 'views-accounts.js', 'views-explore.js']) w.eval(repoFile('public/console/' + file));
      const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(r => setTimeout(r, 12)); };
      await settle();
      const $ = (id: string) => w.document.getElementById(id) as unknown as { value: string; click(): void; dispatchEvent(e: unknown): boolean };
      $('sign-in').click(); await settle();
      $('si-email').value = 'ops@brand.test'; $('si-password').value = 'right-password';
      $('sign-in-form').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
      await settle(); await settle();
      (w as unknown as { location: { hash: string } }).location.hash = '#/history?scope=coach&slot=chero';
      await settle(); await settle();
      const text = (w.document.body.textContent || '').replace(/\s+/g, ' ');
      const card = Array.from(w.document.querySelectorAll('#view .card'))
        .map(node => (node.textContent || '').replace(/\s+/g, ' ')).find(t => t.includes('The content catalog')) ?? '';
      return { text, card, close: () => w.close() };
    };

    const shown = await open(ENVELOPE);
    try {
      expect(shown.card, 'W32.E1.01: the console must render a catalogue card (the History view names it "The content catalog")').toContain('The content catalog');
      expect(shown.card, 'W32.E1.01: the catalogue card must show the catalogue\'s piece count').toMatch(/\b12 pieces\b/);
      expect(shown.card, 'W32.E1.01: the catalogue card must show the catalogue\'s size against the ceiling (the console renders sizes as KB)').toMatch(/3\.5 KB|3,584 bytes/);
      expect(shown.text).not.toMatch(/\b(null|undefined|NaN)\b/);
    } finally { shown.close(); }

    // A deployment whose answer predates the member says nothing rather than
    // printing a stray value — the property every console view already holds.
    const absent = await open(null);
    try {
      expect(absent.card).toContain('The content catalog');
      expect(absent.text).not.toMatch(/\b(null|undefined|NaN)\b/);
    } finally { absent.close(); }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// W32.S1.01 — scans, sorts and full-catalogue structures (F32 §1.2, §1.3, §4
// items 5-7 and 9, §6 "then (M)"). Top-k is NOT ruled: F32 §2.7's own caveat is
// that with `ScoreAdjust` configured it becomes a two-stage rerank that CAN
// change what is served, so what is ruled here is the parity a top-k would have
// to keep, and the bound on what the join reads.
// ════════════════════════════════════════════════════════════════════════════
describe('unit:W32.S1.01', () => {
  it('logic: the operator name join reads the catalogue for the paged ids without rebuilding a full-catalogue map per call, the priors cross-product keeps its named capacity bound, and the recorded candidate set reproduces the served ranking', async () => {
    // 1 · The join. F32 §4 item 5: three operator routes each build a
    // full-catalogue `Map` per request to put `title`/`customerContentId` on at
    // most `limit` rows. The catalogue is read for the ids asked for, and a
    // second page of the SAME catalogue does not read it again.
    const rows = await import('@/learn/rows') as unknown as Record<string, unknown>;
    expect(typeof rows.catalogNames,
      'W32.S1.01: `catalogNames(catalog, ids)` — the bounded join of `customerContentId`/`title` onto the paged ids — must be exported from src/learn/rows.ts')
      .toBe('function');
    const catalogNames = rows.catalogNames as (catalog: { pieces: unknown[] }, ids: Iterable<string>) => ReadonlyMap<string, { customerContentId?: string; title?: string }>;

    const pieces = Array.from({ length: 5_000 }, (_, i) => catalogPiece('piece-' + String(i).padStart(4, '0')));
    let corpusReads = 0;
    const catalog = { get pieces() { corpusReads++; return pieces; } };
    const page = ['piece-0000', 'piece-0007', 'piece-4999'];
    const first = catalogNames(catalog, page);
    expect([...first.keys()].sort()).toEqual([...page].sort());
    expect(first.get('piece-0007')).toMatchObject({ customerContentId: 'CMP-piece-0007', title: 'Piece piece-0007' });
    const second = catalogNames(catalog, ['piece-0100']);
    expect(second.get('piece-0100')).toMatchObject({ customerContentId: 'CMP-piece-0100' });
    expect(corpusReads,
      'W32.S1.01: a second page of the same catalogue must not rebuild a full-catalogue map; the catalogue is read once per revision, not once per request')
      .toBe(1);
    // An id the catalogue does not carry is simply absent from the join, and the
    // join never answers more rows than it was asked for.
    expect(catalogNames(catalog, ['piece-0000', 'not-in-catalogue']).size).toBe(1);

    // 2 · The second whole-document cross product (F32 §4 item 9) keeps the
    // capacity bound W25 gave it, by name and by both of its numbers.
    const overRows = { rows: Array.from({ length: 4_097 }, (_, i) => ({ slot: 'hero', item: 'i' + i, cell: '*', p_prior: 0.1, n_equiv: 200 })) } as unknown as PriorsDoc;
    expect(() => indexPriors(overRows, 'hero')).toThrow('Prior capacity exceeded');
    const overBytes = { rows: Array.from({ length: 400 }, (_, i) => ({ slot: 'hero', item: 'i'.repeat(700) + i, cell: '*', p_prior: 0.1, n_equiv: 200 })) } as unknown as PriorsDoc;
    expect(utf8(JSON.stringify(overBytes))).toBeGreaterThan(256 * 1024);
    expect(() => indexPriors(overBytes, 'hero')).toThrow('Prior capacity exceeded');
    expect(indexPriors({ rows: [{ slot: 'hero', item: 'i0', cell: '*', p_prior: 0.1, n_equiv: 200 }] } as unknown as PriorsDoc, 'hero').size).toBe(1);

    // 3 · Decision parity, the clause any bounded ranking has to keep: the
    // candidate set the ledger records is bounded, and it is SUFFICIENT — the
    // same composer over just those candidates serves the identical decisions
    // and the identical candidate list (F32 §2.7: winners and recorded candidate
    // sets byte-identical).
    const corpus: ContentPieceLike[] = Array.from({ length: 300 }, (_, i) =>
      ({ id: 'c' + String(i).padStart(3, '0'), customerContentId: 'cms-' + i, type: 'editorial', title: 't' + i,
        tags: { line: [i % 3 === 0 ? 'drover' : 'tabby'], occasion: [i % 2 === 0 ? 'evening' : 'weekend'] }, slotTypes: ['hero'] }));
    const slots: ContentSlotSpec[] = [{ slot: 'hero', take: 3, weights: { occasion: 0.35, line: 0.25 } }];
    const view = { dims: { occasion: { evening: 0.8 }, line: { drover: 0.7 } } };
    const full = composeContentDetailed(corpus, view, slots);
    expect(full.candidates.hero).toHaveLength(10);
    const recorded = full.candidates.hero!.map(c => c.contentId);
    const replayed = composeContentDetailed(corpus.filter(p => recorded.includes(p.id)), view, slots);
    expect(replayed.decisions.map(d => d.contentId)).toEqual(full.decisions.map(d => d.contentId));
    expect(replayed.candidates.hero!.map(c => c.contentId)).toEqual(recorded);
  });

  it('host: the paged operator surfaces answer the page\'s names out of a catalogue far larger than the page, and never more rows than the page', async () => {
    invalidateCache();
    const env = mkEnv(), kv = env.CACHE as unknown as FakeKV;
    const pieces = Array.from({ length: 1_200 }, (_, i) => catalogPiece('piece-' + String(i).padStart(4, '0')));
    await initialize(env, { pieces } as unknown as ContentCatalog);
    const items: Record<string, Record<string, unknown>> = {};
    for (let i = 0; i < 120; i++) items['piece-' + String(i).padStart(4, '0')] = { '*': { level: 0, key: '*', n: 40 - i / 10, s: 2, p0: 0.05, n0: 30, p_hat: 0.06, lift: 1.1, liftReference: 'slot-rate' } };
    // W25 V1.01 (F20 §4.4), which a bounded join must not lose: a row for an id
    // the CATALOGUE does not carry is never offered as something to explore
    // next. The join is bounded to the page; catalogue MEMBERSHIP is not.
    items['prior-only-not-in-catalogue'] = { '*': { level: 0, key: '*', n: 0, s: 0, p0: 0.05, n0: 200, p_hat: 0.1, lift: 1, liftReference: 'slot-rate' } };
    kv.store.set(liftKey('coach', 'coach', 'hero'), JSON.stringify({ tenant: 'coach', brand: 'coach', slot: 'hero', reward: 'click', objective: 'unit',
      version: T0, publishedAt: T0, events: 900, n0: 30, nMin: 30, liftMin: 0.5, liftMax: 2, priorVersion: 0, items,
      slotRates: { '*': { n: 900, s: 45, rate: 0.05 } } }));

    const app = new Hono<{ Bindings: Env; Variables: { tenant: string } }>();
    app.use('*', tenantMiddleware()); app.route('/v1', decisionRoutes);
    const headers = { 'X-Tenant': 'coach', Authorization: await bearer() };

    const listing = await app.request('http://w/v1/coach/lift/rows?slot=hero&limit=10', { headers }, env);
    expect(listing.status).toBe(200);
    const page = await listing.json() as { total: number; limit: number; rows: Array<{ item: string; name?: string | null; customer_item_id?: string | null; title?: string | null }> };
    // The grid lists every row the snapshot holds — including the prior-only id
    // the catalogue does not carry, which is what an operator must be able to
    // see — and the page carries the names for the page's own ids.
    expect(page.total).toBe(121);
    expect(page.rows).toHaveLength(10);
    for (const row of page.rows.filter(r => r.item.startsWith('piece-'))) {
      expect(row.customer_item_id ?? null).toBe('CMP-' + row.item);
      expect(row.title ?? null).toBe('Piece ' + row.item);
    }
    expect(page.rows.filter(r => r.item.startsWith('piece-')).length).toBeGreaterThan(0);

    const exploring = await app.request('http://w/v1/coach/learn/exploring?slot=hero&limit=10', { headers }, env);
    expect(exploring.status).toBe(200);
    const explore = await exploring.json() as { total: number; rows: Array<{ item: string; customer_item_id: string | null; title: string | null }> };
    expect(explore.rows.length).toBeLessThanOrEqual(10);
    for (const row of explore.rows) {
      expect(row.customer_item_id).toBe('CMP-' + row.item);
      expect(row.title).toBe('Piece ' + row.item);
    }
    // Every offered row is one the catalogue really carries: the snapshot holds
    // 121 rows and only the 120 catalogue items may be offered.
    expect(explore.total).toBe(120);
    expect(explore.rows.map(r => r.item).every(id => id.startsWith('piece-'))).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// W32.Z1.01 — zero-base honesty and the self-inclusive reference, as MECHANISM
// (document 35 §2 N20 :281, N21 :283; settled HANDOFF-2026-09-18 §7 item 7).
// No leave-one-out is ruled or built; the comparison of alternatives under
// clamps, shrinkage, context and single-item cases is the DS evaluation
// (W32.P1.01, D09). What is ruled is that the platform SAYS what its reference
// is and claims no validation for it.
// ════════════════════════════════════════════════════════════════════════════
const liftExplain = (over: Record<string, unknown>) => ({ lift: 1.5, gamma: 1, applied: 0.21, level_words: 'everyone', level: 0,
  key: '*', n: 40, s: 3, p0: 0.05, p_hat: 0.075, n0: 30, objective: 'unit', measurementBasis: 'served-v1', ...over });
const record = (explain: Record<string, unknown>): DecisionRecord => ({ decision_id: 'coach:x:v1:home:hero:0', tenant: 'coach', brand: 'coach',
  visitor_id: 'v1', session_id: 's1', ts: T0, page: 'home', slot: 'hero', position: 0, item_id: 'willow-slg', customer_item_id: 'cms-willow',
  candidates: [], cell: CELL, arm: 'personalized', explored: false, authority: 'engine',
  versions: { config: 1, lift: T0, prior: 0, policy: 1 }, config_label: 'v1', explain } as unknown as DecisionRecord);

describe('unit:W32.Z1.01', () => {
  it('logic: a learned lift that moved an exactly zero base by nothing is reported as having moved nothing, the snapshot names the reference its lift was measured against, and the kit states that the reference includes the item\'s own exposures', () => {
    // 1 · N20, at the receipt: a multiplicative term cannot change an exactly
    // zero final pre-lift base, and the sentence a person reads says so. The
    // ranking half of this clause is W16 C7.01's observable and is not
    // re-specified here (src/units/W16/C3.unit.test.ts:1102).
    const moved = receiptOf(record({ drivers: [], score_base: 0.42, score_final: 0.63, lift: liftExplain({}) }), new Map());
    expect(moved.why.join(' ')).toContain('applied at trust 1');
    const zeroed = receiptOf(record({ drivers: [], score_base: 0.25, score_final: 0,
      merchandising: { sentence: 'a merchandising rule took this piece to zero', boost: 0 }, lift: liftExplain({ applied: 0 }) }), new Map());
    expect(zeroed.score_final).toBe(0);
    expect(zeroed.why.join(' ')).toContain('it moved this score by nothing');
    expect(zeroed.lift_terms!.lift).toBe(1.5);

    // 2 · N21, at the snapshot: the reference the lift was measured against is
    // NAMED on every row (W25's member), so a reader is never left to assume it.
    const state = emptyStats();
    for (let i = 0; i < 40; i++) recordExposure(state, 'willow-slg', CELL, T0 + i, DEFAULT_STATS);
    for (let i = 0; i < 20; i++) recordExposure(state, 'tabby-film', CELL, T0 + i, DEFAULT_STATS);
    recordSuccess(state, 'willow-slg', CELL, 'click', T0 + 100, 1, DEFAULT_STATS);
    recordSuccess(state, 'tabby-film', CELL, 'click', T0 + 100, 1, DEFAULT_STATS);
    const snap = buildSnapshot(state, { tenant: 'coach', brand: 'coach', slot: 'hero' }, 'click', T0 + 200, DEFAULT_STATS);
    const row = snap.items['willow-slg']!['*']!;
    expect(row.liftReference).toBe('slot-rate');
    expect(liftReferenceOf(row)).toBe('slot-rate');
    // The slot rate this row was divided by is the slot's OWN rate in the cell,
    // which counts this item's exposures and successes too: 2 successes over 60
    // exposures, decayed, against the item's own 1 over 40. That self-inclusion
    // is the whole of N21 and is what the kit must say out loud.
    expect(snap.slotRates['*']!.n).toBeGreaterThan(row.n);
    expect(row.p0).toBe(snap.slotRates['*']!.rate);

    // 3 · N21, where a customer reads. The kit states that the reference
    // includes the item's own exposures, that a lift near one is therefore not
    // proof of collapse, and that no validation of the reference is claimed —
    // and it mandates no leave-one-out repair, because none is proved.
    expect(kitStates(/includes? (?:the )?(?:item|piece)'?s own exposures/i),
      'W32.Z1.01: the kit must say that the `slot-rate` reference INCLUDES the item\'s own exposures (document 35 §2 N21)').toBe(true);
    expect(kitStates(/lift (?:near|close to|approaching|of about) one[^.]*(?:does not|is not) (?:prove|proof|evidence)/i),
      'W32.Z1.01: the kit must say that a lift near one is not proof that ranking has collapsed (N21: "lift approaching one alone does not prove winner-ranking collapse")').toBe(true);
    expect(kitStates(/(?:model[- ]validation|not (?:yet )?validated|no validation is claimed)/i),
      'W32.Z1.01: the kit must say that this reference is an open model-validation question and that no validation of it is claimed (N21, D09)').toBe(true);
  });
});

// src/learn/report.test.ts
// CW22 / doc 22 §4.2, §7, §10: the day report over the ledger.

import { describe, it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { buildReport, canonicalReportJson, countDayObjects, diagnosticDayReport, loadDay, presetPolicies, rawReportJson, REPORT_LIMITS, ReportBudgetExceeded, ReportInputError, ReportUnavailableError, reportCoverage, reportKey, ringsOf, runReport, type DayReport, type ReportPolicy } from './report';
import * as stats from './stats';
import { decisionRoutes } from '@/routes/decisions';
import { windowReport } from '@/measure/window';
import type { Env } from '@/types/env';
import { DEFAULT_POLICY } from './policy';
import { recordedComputation, slotComputation, readSavedReport } from './report';
import type { DecisionRecord, LearnConfig } from '@/content/types';
import type { OutcomeRecord } from '@/ledger/records';
import { hourPrefix, ts36, outcomeFromAction } from '@/ledger/records';
import { buildHour, runDayReport } from './hourly';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { tenantMiddleware } from '@/tenancy/middleware';
import { invalidateCache } from '@/config/versionedStore';
import { initializePublicationSet } from '@/config/publication';
import { captureRetention, type RetentionEnv } from '@/retention';
import { DEFAULT_LEARN, LEARN_KIND } from '@/content/kinds';

const T0 = Date.UTC(2026, 8, 3, 12, 0, 0);

it('W14.07 counts only actual learning streams and never opens nonlearning payloads',async()=>{
  const r2=new ReportR2(),prefix='product-sort/2026-09-03/12/';
  for(let i=0;i<300;i++)for(const stream of ['behavior','product-sort'])r2.objects.set(prefix+stream+'/'+i+'.ndjson','not learning JSON');
  r2.objects.set(prefix+'decision/a.ndjson','');r2.objects.set(prefix+'outcome/b.ndjson','');
  const get=vi.spyOn(r2,'get');expect(await countDayObjects(r2,'product-sort','2026-09-03',2)).toBe(2);expect(get).not.toHaveBeenCalled();
  expect(await loadDay(r2,'product-sort','2026-09-03','decision',1)).toMatchObject({records:[],truncated:false});
  expect(get.mock.calls.map(([key])=>key)).toEqual([prefix+'decision/a.ndjson']);
});
const cell = { channel: 'direct', visit_bucket: '1' as const, region: 'US-NY', affinity: null };
const dec = (id: string, visitor: string, session: string, ts: number, item: string, arm: DecisionRecord['arm'] = 'personalized', explored = false, slot = 'hero'): DecisionRecord => ({
  decision_id: `coach:${ts.toString(36)}:${visitor}:home:${slot}:0`, tenant: 'coach', brand: 'coach', visitor_id: visitor, session_id: session, identity_anchor: 'visitor', ts,
  page: 'home', slot, position: 0, item_id: item, customer_item_id: `cms-${item}`, candidates: [], cell, arm, explored, authority: 'engine',
  versions: { config: 1, lift: 0, prior: 0, policy: 1 }, config_label: 'v1', explain: { drivers: [], score_base: 0, lift: null, score_final: 0 },
} as DecisionRecord);
const out = (visitor: string, session: string | null, ts: number, type: OutcomeRecord['type'], item: string | null): OutcomeRecord =>
  ({ outcome_id: `coach:${ts.toString(36)}:${visitor}:${type}`, tenant: 'coach', brand: 'coach', visitor_id: visitor, session_id: session, ts, type, event: type, item_id: item, slot: null, value: null, currency: null, margin: null, products: null, arm: null });

const learn: LearnConfig = { holdout: { share: 0.1, salt: '', arms: ['default'] }, slots: { hero: { reward: 'click', exploration: { mode: 'rotation', share: 0.5, floor: 50 } } } };
const learning: ReportPolicy = { name: 'learning', ...DEFAULT_POLICY };

it('W15 saved reports preserve their exact served/rendered basis and objective rather than upgrading archived metadata', async () => {
  const ids = { tenant: 'coach', brand: 'coach', date: '2026-09-03' }, row = dec('one', 'v', 's', T0, 'a');
  const rendered: DecisionRecord = { ...row, measurementBasis: 'rendered-v1', rendered: { version: 1, at: T0 + 100, eventId: 'paint', pageInstance: 'page' } };
  const config: LearnConfig = { ...learn, slots: { hero: { measurementBasis: 'rendered-v1', reward: 'purchase', objective: 'revenue' } } };
  const current = buildReport({ ...ids, decisions: [rendered], outcomes: [], learn: config, learning, reporting: [], now: T0 + 1000, truncated: false });
  const r2 = new ReportR2(), key = reportKey(ids.tenant, ids.brand, ids.date);
  r2.objects.set(key, canonicalReportJson(current));
  const read = await readSavedReport(r2, ids); expect(read!.computation).toEqual(current.computation);
  expect(read!.grids.hero!.learning!).toMatchObject({ measurementBasis: 'rendered-v1', objective: 'revenue' });
  const served = buildReport({ ...ids, decisions: [row], outcomes: [], learn, learning, reporting: [], now: T0 + 1000, truncated: false });
  for (const version of [1, 2, 3] as const) {
    const old = structuredClone(served); old.computation!.version = version;
    for (const slot of old.computation!.slots) delete slot.measurementBasis;
    for (const grid of Object.values(old.grids.hero!)) delete grid.measurementBasis;
    const bytes = JSON.stringify(old); r2.objects.set(key, bytes);
    const retained = await readSavedReport(r2, ids); expect(retained!.computation).toEqual(old.computation);
    expect(retained!.grids.hero!.learning!).not.toHaveProperty('measurementBasis'); expect(r2.objects.get(key)).toBe(bytes);
  }
  expect(r2.puts).toEqual([]);
});

/** Only storage/credentials are synthetic; builders and mounted routes are real. */
class ReportR2 {
  objects = new Map<string, string>();
  beforeRead?: (key: string) => Promise<void>;
  beforePut?: (key: string) => Promise<void>;
  puts: string[] = [];
  async get(key: string, options?: R2GetOptions) {
    await this.beforeRead?.(key);
    const raw = this.objects.get(key);
    if (raw === undefined) return null;
    const bytes = new TextEncoder().encode(raw), range = options?.range;
    const selected = range && 'length' in range ? bytes.slice('offset' in range ? range.offset ?? 0 : 0, (('offset' in range ? range.offset : 0) ?? 0) + (range.length ?? bytes.length)) : bytes;
    return { etag: createHash('sha256').update(raw).digest('hex'), size: bytes.length, body: new ReadableStream<Uint8Array>({ start(c) { c.enqueue(selected); c.close(); } }), text: async () => raw, json: async () => JSON.parse(raw) as unknown };
  }
  async list({ prefix }: { prefix: string }) { return { objects: [...this.objects.keys()].filter(key => key.startsWith(prefix)).sort().map(key => ({ key })), truncated: false }; }
  async put(key: string, raw: string, options?: R2PutOptions) {
    await this.beforePut?.(key);
    const before = this.objects.get(key);
    // The publication writer states its create-only precondition as a Headers
    // If-None-Match and checks the returned key/size, not just the etag
    // (src/config/publication.ts:291-296); an incomplete result is refused.
    const rawCondition = options?.onlyIf;
    const onlyIf: R2Conditional | undefined = rawCondition instanceof Headers
      ? { ...(rawCondition.get('If-None-Match') === '*' ? { etagDoesNotMatch: '*' } : {}),
        ...(rawCondition.get('If-Match') ? { etagMatches: rawCondition.get('If-Match')! } : {}) }
      : rawCondition as R2Conditional | undefined;
    const etag = before === undefined ? null : createHash('sha256').update(before).digest('hex');
    if ((onlyIf?.etagMatches !== undefined && onlyIf.etagMatches !== etag)
      || (onlyIf?.etagDoesNotMatch === '*' && before !== undefined)
      || (onlyIf?.etagDoesNotMatch !== undefined && onlyIf.etagDoesNotMatch !== '*' && onlyIf.etagDoesNotMatch === etag)) return null;
    this.puts.push(key); this.objects.set(key, raw);
    return { key, etag: createHash('sha256').update(raw).digest('hex'), size: new TextEncoder().encode(raw).length };
  }
}
/**
 * SYNTHETIC registry, not an approved retention period. The report route admits a
 * ledger row only against an explicit per-category policy
 * (src/routes/decisions.ts:850 → src/learn/report.ts:887; src/retention.ts:96-99);
 * shape from src/index.api-boundary.test.ts:34-37.
 */
const REPORT_RETENTION = JSON.stringify({ version: 1, tenants: { coach: Object.fromEntries(
  ['ledger', 'online', 'hourly'].map((category) => [category,
    { id: 'report-fixture-' + category, revision: 1, durationMs: 365 * 86400_000, basis: 'occurred', renewal: 'new-record-only' }])) } });
const REPORT_RETENTION_ENV = { TENANTS: JSON.stringify({ provisioned: ['coach'] }), RETENTION: REPORT_RETENTION } as RetentionEnv;

/** `retention` stamps every fixture row the way the ledger writer does, for the
 *  routes that carry a retention authority into the report. */
function overlayFixture(retention?: RetentionEnv) {
  const storage = new ReportR2(), ids = { tenant: 'coach', brand: 'coach', date: '2026-09-03' };
  const stamp = <T extends { ts: number }>(row: T): T =>
    retention ? { ...row, retention: captureRetention(retention, ids.tenant, row.ts) } : row;
  const rows = [stamp(dec('1', 'v1', 's1', T0, 'a')), stamp(dec('2', 'v2', 's2', T0 + 60_000, 'b'))];
  const event = stamp(out('v2', 's2', T0 + 120_000, 'click', 'b'));
  for (const row of [...rows, event]) {
    const stream = 'decision_id' in row ? 'decision' : 'outcome';
    storage.objects.set(`${hourPrefix(ids.tenant, row.ts)}/${stream}/${ts36(row.ts)}-${ts36(row.ts)}-fixture.ndjson`, JSON.stringify(row) + '\n');
  }
  const key = reportKey(ids.tenant, ids.brand, ids.date), now = T0 + 4 * 3600_000;
  const custom: ReportPolicy[] = [{ ...DEFAULT_POLICY, name: 'custom-any-first', match: 'any', credit: 'first' }];
  return { storage, ids, key, now, custom };
}
/**
 * The coherent R2 publication is the only configuration authority the report
 * route reads (src/routes/decisions.ts:57-60, :844; src/config/publication.ts:204-206,
 * :225-240): with no published head the request answers 500 before any report work.
 * The document published here is this suite's `learn` configuration completed by
 * the compiled default (src/content/kinds.ts:476-485) — a publication is a whole
 * authored document, and the default attribution policy is part of it. Never a KV fallback.
 */
async function publishLearnConfig(storage: ReportR2, tenant: string, value: LearnConfig = { ...DEFAULT_LEARN, ...learn }): Promise<void> {
  await initializePublicationSet({ STORAGE: storage } as unknown as Env, [
    { kind: LEARN_KIND, scope: tenant, revision: { revision: 1, value, actor: 'report-fixture', note: '', at: T0 } },
  ], '0:' + crypto.randomUUID());
  storage.puts.length = 0;
}
function barrier() {
  let entered!: () => void, release!: () => void;
  const ready = new Promise<void>(resolve => { entered = resolve; });
  const wait = new Promise<void>(resolve => { release = resolve; });
  return { ready, release, hold: async () => { entered(); await wait; } };
}

/**
 * R10/R126(a): the operator credential the report routes require, signed with
 * this file's own synthetic material. Nothing else in the file authenticates,
 * because nothing else in it calls a gated route.
 */
const reportJwtSecret = 'w21-b2-report-test-operator-signing-material';
async function operatorCredential(): Promise<string> {
  const { SignJWT } = await import('jose');
  return new SignJWT({ sub: 'ops', type: 'service' }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setIssuer('i').setAudience('a').setExpirationTime('2h')
    .sign(new TextEncoder().encode(reportJwtSecret));
}

describe('the day report', () => {
  it('W22.02 refuses incomplete listed raw input before canonical replacement and retries restored input', async () => {
    for (const fault of ['missing-decision', 'missing-outcome', 'malformed', 'cursor-missing', 'cursor-repeat']) {
      const f = overlayFixture(), prefix = `${f.ids.tenant}/${f.ids.date}/`;
      f.storage.objects.set(f.key, canonicalReportJson(await runReport(f.storage, f.ids, learn, [], f.now)));
      const stream = fault === 'missing-outcome' ? 'outcome' : 'decision';
      const target = [...f.storage.objects.keys()].filter(key => key.includes(`/${stream}/`)).sort().at(-1)!;
      const original = f.storage.objects.get(target)!;
      if (fault === 'malformed') f.storage.objects.set(target, original + 'not json\n');
      const before = [...f.storage.objects], get = f.storage.get.bind(f.storage), list = f.storage.list.bind(f.storage);
      const reads = vi.spyOn(f.storage, 'get').mockImplementation(async (key, options) =>
        fault.startsWith('missing-') && key === target ? null : get(key, options));
      let pages = 0;
      const listing = vi.spyOn(f.storage, 'list').mockImplementation(async options => {
        if (options.prefix !== prefix || !fault.startsWith('cursor-')) return list(options);
        if (++pages > 2) throw new Error('Synthetic pagination failed to terminate');
        return { objects: [{ key: target }], truncated: true, ...(fault === 'cursor-repeat' ? { cursor: 'same' } : {}) };
      });
      await expect(runReport(f.storage, f.ids, learn, null, f.now)).rejects.toThrow(
        fault.startsWith('missing-') ? ReportUnavailableError : ReportInputError);
      if (!fault.startsWith('cursor-')) {
        const legacy = await loadDay(f.storage, f.ids.tenant, f.ids.date, stream, 10);
        expect(legacy.records).toHaveLength(fault === 'missing-outcome' ? 0 : fault === 'missing-decision' ? 1 : 2);
        expect(legacy.truncated).toBe(false);
      } else expect(pages).toBe(fault === 'cursor-repeat' ? 2 : 1);
      expect(f.storage.puts).toEqual([]); expect([...f.storage.objects]).toEqual(before);
      reads.mockRestore(); listing.mockRestore(); f.storage.objects.set(target, original);
      const visited: Array<string | undefined> = [];
      const paged = vi.spyOn(f.storage, 'list').mockImplementation(async options => {
        const page = await list(options);
        if (options.prefix !== prefix) return page;
        const cursor = (options as { cursor?: string }).cursor; visited.push(cursor);
        return cursor ? { ...page, objects: page.objects.slice(1) }
          : { ...page, objects: page.objects.slice(0, 1), truncated: true, cursor: 'next' };
      });
      const recovered = await runReport(f.storage, f.ids, learn, null, f.now);
      expect(recovered.counts).toEqual({ decisions: 2, outcomes: 1, visitors: 2, truncated: false });
      expect(recovered.policies[0]!.credits).toBe(1); expect(visited).toEqual([undefined, 'next']);
      expect(f.storage.puts).toEqual([f.key]); expect(JSON.parse(f.storage.objects.get(f.key)!).counts).toEqual(recovered.counts);
      paged.mockRestore();
    }
  });

  it('W22.01 deduplicates complete raw identities before logical caps and refuses ambiguous input before publication', async () => {
    const ids = { tenant: 'coach', brand: 'coach', date: '2026-09-03' }, now = T0 + 10_000;
    const first = dec('1', 'v1', 's1', T0, 'a'), second = dec('2', 'v1', 's1', T0 + 1, 'b');
    const event = outcomeFromAction({ type: 'content_click', userId: 'v1', sessionId: 's1', timestamp: T0 + 1000,
      eventId: 'raw-event', eventIdSource: 'provided', data: { contentId: 'a' } }, 'coach')!;
    const reordered = Object.fromEntries(Object.entries(first).reverse()) as unknown as DecisionRecord;
    const provenance = (id: string) => ({ id, ordinal: 0 });
    const managed = { ...reordered, _ledger_delivery: provenance('00000000-0000-4000-8000-000000000001') };
    const storage = (rows: unknown[], events: unknown[]) => {
      const r2 = new ReportR2();
      for (const [stream, records] of [['decision', rows], ['outcome', events]] as const) records.forEach((row, n) =>
        r2.objects.set(`${hourPrefix('coach', T0)}/${stream}/${n}.ndjson`, JSON.stringify(row) + '\n'));
      r2.objects.set(reportKey('coach', 'coach', ids.date), 'sentinel'); return r2;
    };
    const clean = buildReport({ ...ids, learning, reporting: [], learn, decisions: [first, second], outcomes: [event], now, truncated: false });
    expect(clean.policies[0]!.credits).toBe(1);
    const duplicate = storage([first, managed, second, { ...managed, _ledger_delivery: provenance('00000000-0000-4000-8000-000000000002') }], [event, { ...event }]);
    const before = [...duplicate.objects];
    const read = await loadDay<DecisionRecord>(duplicate, 'coach', ids.date, 'decision', 2);
    expect(read.records).toEqual([first, second]); expect(read.truncated).toBe(false);
    const report = await runReport(duplicate, ids, learn, [], now);
    expect(report.counts).toEqual({ ...clean.counts, duplicates: { decisions: 2, outcomes: 1 } });
    expect(report.policies[0]!.credits).toBe(1);
    expect(report.grids).toEqual(clean.grids); expect(report.holdout).toEqual(clean.holdout); expect(report.exploration).toEqual(clean.exploration);
    expect([...duplicate.objects]).toEqual(before); expect(duplicate.puts).toEqual([]);
    const pureInput = { ...ids, learning, reporting: [], learn, decisions: [first, managed, second], outcomes: [event, { ...event }], now, truncated: false };
    const pureBefore = JSON.stringify(pureInput), pure = buildReport(pureInput);
    expect(pure.counts.duplicates).toEqual({ decisions: 1, outcomes: 1 }); expect(pure.grids).toEqual(clean.grids); expect(JSON.stringify(pureInput)).toBe(pureBefore);
    const third = dec('3', 'v2', 's2', T0 + 2, 'c');
    const capped = storage([first, first, second, third], []);
    expect(await loadDay(capped, 'coach', ids.date, 'decision', 2)).toMatchObject({ records: [first, second], truncated: true });
    await expect(loadDay(capped, 'coach', ids.date, 'decision', 2, { objects: 0, bytes: 0 })).rejects.toMatchObject({ budget: 'records', observed: 3 });
    for (const changed of [{ ...first, arm: 'default' }, { ...first, brand: 'other' }, { ...first, visitor_id: 'other' },
      { ...first, explain: { ...first.explain, extra: true } }, { ...first, _ledger_delivery: { id: 'invalid', ordinal: 0 } },
      { ...first, _ledger_delivery: { ...provenance('00000000-0000-4000-8000-000000000001'), extra: true } }, { ...first, tenant: 'other' }]) {
      const r2 = storage([first, second, changed], []), saved = [...r2.objects];
      await expect(runReport(r2, ids, learn, null, now)).rejects.toThrow(ReportInputError);
      await expect(loadDay(r2, 'coach', ids.date, 'decision', 2)).rejects.toThrow(ReportInputError);
      expect(r2.puts).toEqual([]); expect([...r2.objects]).toEqual(saved);
    }
    const legacy = out('v1', 's1', T0 + 1000, 'click', 'a');
    expect((await runReport(storage([first], [legacy]), ids, learn, [], now)).counts.outcomes).toBe(1);
    for (const events of [[legacy, legacy], [event, { ...event, value: 5 }], [{ ...event, event_id: undefined }],
      [{ ...event, event_id_source: 'bad' }], [{ ...event, outcome_id: event.outcome_id + '-changed' }], [{ ...event, outcome_id: '' }], [{ ...event, type: 'purchase' }]]) {
      const r2 = storage([first], events); await expect(runReport(r2, ids, learn, null, now)).rejects.toThrow(ReportInputError); expect(r2.puts).toEqual([]);
    }
    const distinct = { ...event, event_id: 'second-event', outcome_id: event.outcome_id.replace('raw-event', 'second-event') };
    const separate = await runReport(storage([first], [event, distinct]), ids, learn, [], now);
    expect(separate.counts.outcomes).toBe(2); expect(separate.policies[0]!.credits).toBe(2);
  });

  it('W31.01 records actual raw computation through canonical and custom reads without blessing legacy or duplicate labels', async () => {
    const f = overlayFixture();
    const canonical = await runReport(f.storage, f.ids, learn, null, f.now);
    const body = JSON.parse(f.storage.objects.get(f.key)!);
    expect(body._summary.computation).toEqual(canonical.computation);
    // Version 4 is the recorded computation basis: it states each slot's measurement
    // basis (src/learn/report.ts:119, type at :71, :75; document 35 §5 W26 "defined
    // served/rendered/viewable unit"). Retained 1-3 documents stay readable as history.
    expect(canonical.computation).toMatchObject({ version: 4, profile: { source: 'raw-day', horizonMs: null, ringCap: null },
      slots: [{ slot: 'hero', reward: 'click', objective: 'unit', tauLearnMs: stats.DEFAULT_STATS.tauLearnMs }] });
    expect(recordedComputation(canonical.computation)).toEqual(canonical.computation);
    // R10/R126(a) with F25 §5.1: the day report GET is behind the build POST's
    // own operator gate, so this read presents the operator credential. The
    // test's own claim — that a canonical read answers the recorded computation
    // basis — and every expected value below are unchanged.
    const operatorEnv = { STORAGE: f.storage, JWT_SECRET: reportJwtSecret, JWT_ISSUER: 'i', JWT_AUDIENCE: 'a' } as unknown as Env;
    const response = await decisionRoutes.request('https://report.test/coach/learn/report?date=' + f.ids.date + '&slot=hero',
      { headers: { Authorization: `Bearer ${await operatorCredential()}` } }, operatorEnv);
    expect(response.status).toBe(200);
    expect((await response.json() as { report: DayReport }).report.computation).toEqual(canonical.computation);
    const request = { ...f.ids, learn, reporting: [], decisions: [dec('a', 'v', 's', T0, 'a')], outcomes: [out('v', 's', T0 + 1, 'click', 'a')], now: f.now, truncated: false };
    const fallback = buildReport({ ...request, learning: { ...learning, windowsMs: { custom: 1234 } } });
    expect(fallback.computation!.policies[0]!.policy.windowsMs).toEqual(Object.fromEntries(['click', 'dwell', 'video_complete', 'wishlist', 'add_to_bag', 'purchase', 'custom'].map(r => [r, 1234])));
    const weighted = buildReport({ ...request, learning, learn: { ...learn, slots: { hero: { reward: 'click', objective: 'revenue' } } } });
    expect(weighted.holdout.hero![0]!.credited).toBe(1); // unweighted even though null value produces no weighted success
    expect(slotComputation(weighted.computation!, 'hero')).not.toBe(slotComputation(canonical.computation!, 'hero'));
    const before = f.storage.objects.get(f.key), puts = f.storage.puts.length;
    const duplicate = await runReport(f.storage, f.ids, learn, [{ ...learning }, { ...learning, match: 'any' }], f.now);
    expect(duplicate.computation).toBeNull(); expect(duplicate.policies).toHaveLength(3);
    expect(f.storage.objects.get(f.key)).toBe(before); expect(f.storage.puts).toHaveLength(puts);
    const legacy = { ...canonical }; delete legacy.computation;
    expect(diagnosticDayReport(legacy).computation).toBeNull();
    for (const invalid of [null, { ...canonical.computation, version: 99 }, { ...canonical.computation, policies: [canonical.computation!.policies[0], canonical.computation!.policies[0]] }]) {
      expect(recordedComputation(invalid)).toBeNull();
    }
  });
  it('W32.05 pages authenticated saved reports by exact content and query while preserving full exports and diagnostics', async () => {
    const f = overlayFixture();
    const rows = Array.from({ length: 120 }, (_, i) => dec(String(i), 'v' + i, 's', T0 + i, 'item-' + String(i).padStart(3, '0')));
    const raw = buildReport({ ...f.ids, learn, learning, reporting: [], decisions: rows, outcomes: [], now: f.now, truncated: false });
    const snap = raw.grids.hero!.learning!;
    raw.policies.push({ ...raw.policies[0]!, name: 'second', role: 'reporting' });
    raw.grids.hero!.second = { ...structuredClone(snap), items: { 'z-second-only': structuredClone(snap.items['item-000']!) } };
    delete snap.items['item-001']!['*']; // Present item with no pooled evidence must still have a blank row.
    raw.grids.other = { learning: { ...structuredClone(snap), slot: 'other' } };
    f.storage.objects.set(f.key, canonicalReportJson(raw));
    const get = vi.spyOn(f.storage, 'get');
    const env = { AUTH_MODE: 'enforced', JWT_SECRET: 'w3205-synthetic-signing-material-only', JWT_ISSUER: 'i', JWT_AUDIENCE: 'a',
      TENANTS: JSON.stringify({ provisioned: ['coach', 'meridian'], operatorGrants: { reporter: ['coach'] } }), STORAGE: f.storage } as unknown as Env;
    const token = await new SignJWT({ type: 'service', roles: ['admin'] }).setProtectedHeader({ alg: 'HS256' }).setSubject('reporter').setIssuer('i').setAudience('a').setExpirationTime('5m').sign(new TextEncoder().encode(env.JWT_SECRET));
    const app = new Hono().use('*', tenantMiddleware()).route('/v1', decisionRoutes);
    const request = (q: string, tenant = 'coach') => app.request(`/v1/${tenant}/learn/report?date=${f.ids.date}${q}`, { headers: { 'X-Tenant': tenant, Authorization: `Bearer ${token}` } }, env);
    const full = await request(''), fullText = await full.text(); expect(full.status).toBe(200);
    expect(JSON.parse(fullText).report).toEqual(diagnosticDayReport(raw));
    const beforePage = get.mock.calls.length;
    const first = await request('&slot=hero'), firstText = await first.text(), one = JSON.parse(firstText), pageGets = get.mock.calls.length - beforePage;
    expect(pageGets).toBe(1);
    expect(first.status).toBe(200); expect(first.headers.get('Cache-Control')).toBe('no-store');
    expect(one.page).toMatchObject({ slot: 'hero', total: 121, offset: 0, limit: 50, previous: null });
    expect(one.page.revision).toMatch(/^[a-f0-9]{64}$/);
    expect(Object.keys(one.report.grids)).toEqual(['hero']); expect(Object.keys(one.report.grids.hero.learning.items)).toHaveLength(50);
    expect(one.report.grids.hero.learning.items['item-001']).toEqual({});
    for (const s of Object.values(one.report.grids.hero) as stats.LiftSnapshot[]) {
      expect(Object.keys(s.slotRates)).toEqual(['*']); for (const keys of Object.values(s.items)) expect(Object.keys(keys).every(k => k === '*')).toBe(true);
    }
    const { grids: ignored, ...metadata } = one.report; void ignored;
    // Compare all non-grid fields, not just page counters.
    const expectedMetadata = { ...diagnosticDayReport(raw) } as Partial<DayReport>; delete expectedMetadata.grids;
    expect(metadata).toEqual(expectedMetadata);
    const two = await (await request('&slot=hero&cursor=' + one.page.next)).json() as typeof one;
    expect(two.page.offset).toBe(50);
    const back = await (await request('&slot=hero&cursor=' + two.page.previous)).json(); expect(back).toEqual(one);
    const three = await (await request('&slot=hero&cursor=' + two.page.next)).json() as typeof one;
    expect(three.page).toMatchObject({ offset: 100, next: null }); expect(three.report.grids.hero.second.items).toHaveProperty('z-second-only');
    const empty = await (await request('&slot=absent')).json() as typeof one; expect(empty.page.total).toBe(0); expect(empty.report.grids).toEqual({});
    expect(await (await request('&revision=' + one.page.revision)).text()).toBe(fullText);
    for (const q of ['&limit=2', '&cursor=x', '&slot=', '&slot=constructor', '&slot=' + encodeURIComponent('é'.repeat(129)), '&slot=' + encodeURIComponent('a' + '\u0001'.repeat(255)), '&slot=hero&brand=' + encodeURIComponent('a' + '\u0001'.repeat(255)), '&slot=hero&limit=0', '&slot=hero&limit=501', '&slot=hero&limit=1%0A', '&slot=hero&cursor=x', '&revision=x', '&slot=other&cursor=' + one.page.next, '&slot=hero&limit=1&cursor=' + one.page.next, '&slot=hero&brand=other&cursor=' + one.page.next]) {
      const before = get.mock.calls.length; expect((await request(q)).status).toBe(400); expect(get).toHaveBeenCalledTimes(before);
    }
    const cursor = JSON.parse(Buffer.from(one.page.next, 'base64url').toString());
    for (const offset of [-1, 1, Number.MAX_SAFE_INTEGER]) {
      const before = get.mock.calls.length;
      expect((await request('&slot=hero&cursor=' + Buffer.from(JSON.stringify({ ...cursor, offset })).toString('base64url'))).status).toBe(400); expect(get).toHaveBeenCalledTimes(before);
    }
    const beforeDenied = get.mock.calls.length; expect((await request('&slot=hero', 'meridian')).status).toBe(403); expect(get).toHaveBeenCalledTimes(beforeDenied);
    raw.counts.outcomes++; f.storage.objects.set(f.key, canonicalReportJson(raw)); // same builtAt, different body
    for (const q of ['&slot=hero&cursor=' + one.page.next, '&revision=' + one.page.revision]) expect((await request(q)).status).toBe(409);
    f.storage.objects.set(f.key, '{}'); expect((await request('&slot=hero')).status).toBe(503);
    f.storage.objects.delete(f.key); expect((await request('&slot=hero')).status).toBe(404); expect(f.storage.puts).toEqual([]);
    expect(Buffer.byteLength(firstText)).toBeLessThan(Buffer.byteLength(fullText) / 3);
    console.log('W32.05 response bytes', JSON.stringify({ full_get_bytes: Buffer.byteLength(fullText), page_envelope_bytes: Buffer.byteLength(firstText), union_items: 121, page_items: 50, gets_per_page: pageGets, note: 'same bounded full server read; no CPU/storage-read improvement claimed' }));
  });

  it('W32.04 publishes one canonical raw object with a matching summary and unchanged public or custom reports', async () => {
    const f = overlayFixture();
    const report = await runReport(f.storage, f.ids, learn, null, f.now), body = f.storage.objects.get(f.key)!;
    const stored = JSON.parse(body), summary = stored._summary; delete stored._summary;
    expect(stored).toEqual(report); expect(report).not.toHaveProperty('_summary'); expect(summary).toMatchObject({ version: 1, ...f.ids, builtAt: report.builtAt, counts: report.counts });
    expect(summary.holdout.hero[0]).toEqual({ arm: report.holdout.hero![0]!.arm, decisions: report.holdout.hero![0]!.decisions, credited: report.holdout.hero![0]!.credited });
    expect(summary.coverage).toEqual(reportCoverage(report)); expect(summary).not.toHaveProperty('grids');
    expect(body.startsWith('{"_summary":')).toBe(true); expect(body.slice(0, body.indexOf('\n'))).toMatch(/,$/); expect(f.storage.puts).toEqual([f.key]);
    const env = { AUTH_MODE: 'enforced', JWT_SECRET: 'w3204-synthetic-signing-material-only', JWT_ISSUER: 'i', JWT_AUDIENCE: 'a',
      TENANTS: JSON.stringify({ provisioned: ['coach'], operatorGrants: { reporter: ['coach'] } }), STORAGE: f.storage } as unknown as Env;
    const token = await new SignJWT({ type: 'service', roles: ['admin'] }).setProtectedHeader({ alg: 'HS256' }).setSubject('reporter')
      .setIssuer('i').setAudience('a').setExpirationTime('5m').sign(new TextEncoder().encode(env.JWT_SECRET));
    const app = new Hono().use('*', tenantMiddleware()).route('/v1', decisionRoutes);
    const request = (path: string) => app.request('/v1/coach/learn/report' + path, { headers: { 'X-Tenant': 'coach', Authorization: `Bearer ${token}` } }, env);
    const day = await request('?date=' + f.ids.date); expect(day.status).toBe(200);
    expect((await day.json() as { report: DayReport }).report).toEqual(diagnosticDayReport(report));
    const window = await request('/window?from=' + f.ids.date + '&to=' + f.ids.date); expect(window.status).toBe(200);
    expect((await window.json() as { report: Awaited<ReturnType<typeof windowReport>> }).report.slots.hero!.arms[0]).toMatchObject(summary.holdout.hero[0]);
    for (const policies of [[], f.custom, presetPolicies(DEFAULT_POLICY)]) {
      const custom = await runReport(f.storage, f.ids, learn, policies, f.now); expect(custom).not.toHaveProperty('_summary');
      expect(f.storage.objects.get(f.key)).toBe(body); expect(f.storage.puts).toEqual([f.key]);
    }
    expect(() => canonicalReportJson({ ...report, _summary: {} } as DayReport)).toThrow(ReportInputError);
    const sparse = overlayFixture(); sparse.storage.objects.clear();
    const rows = Array.from({ length: 700 }, (_, i) => dec(''+i, 'v'+i, 's'+i, T0+i, 'a', ('arm'+i+'x'.repeat(100)) as DecisionRecord['arm']));
    sparse.storage.objects.set(`${hourPrefix('coach', T0)}/decision/test.ndjson`, rows.map(r => JSON.stringify(r)).join('\n'));
    await expect(runReport(sparse.storage, sparse.ids, learn, null, sparse.now)).rejects.toMatchObject({ budget: 'summaryBytes' });
    expect(sparse.storage.puts).toEqual([]);
    expect((await runReport(sparse.storage, sparse.ids, learn, [], sparse.now)).holdout.hero).toHaveLength(700); expect(sparse.storage.puts).toEqual([]);
    const fullOnly = { ...report, padding: '' };
    fullOnly.padding = 'x'.repeat(REPORT_LIMITS.outputBytes - new TextEncoder().encode(rawReportJson(fullOnly)).length);
    expect(new TextEncoder().encode(rawReportJson(fullOnly))).toHaveLength(REPORT_LIMITS.outputBytes);
    expect(() => canonicalReportJson(fullOnly)).toThrow(ReportBudgetExceeded);
  });
  it('W32.03 refuses oversized or unavailable saved payloads through authenticated day and window routes without effects', async () => {
    const raw = buildReport({ tenant: 'coach', brand: 'coach', date: '2026-09-03', learning, reporting: [], learn,
      decisions: [dec('1', 'v1', 's1', T0, 'a')], outcomes: [], now: T0 + 1000, truncated: false });
    let selected: unknown = { text: async () => JSON.stringify(raw) };
    const storage = { get: vi.fn(async () => selected), put: vi.fn(), delete: vi.fn(), list: vi.fn() };
    const env = { AUTH_MODE: 'enforced', JWT_SECRET: 'w3203-synthetic-signing-material-only', JWT_ISSUER: 'i', JWT_AUDIENCE: 'a',
      TENANTS: JSON.stringify({ provisioned: ['coach', 'meridian'], operatorGrants: { reporter: ['coach'] } }), STORAGE: storage } as unknown as Env;
    const token = await new SignJWT({ type: 'service', roles: ['admin'] }).setProtectedHeader({ alg: 'HS256' }).setSubject('reporter')
      .setIssuer('i').setAudience('a').setExpirationTime('5m').sign(new TextEncoder().encode(env.JWT_SECRET));
    const app = new Hono().use('*', tenantMiddleware()).route('/v1', decisionRoutes);
    const request = (suffix: string, tenant = 'coach') => app.request(`/v1/${tenant}/learn/report${suffix}`, {
      headers: { 'X-Tenant': tenant, Authorization: `Bearer ${token}` },
    }, env);
    const paths = ['?date=2026-09-03', '/window?from=2026-09-03&to=2026-09-03'];
    for (const path of paths) expect((await request(path)).status).toBe(200);
    for (const tenant of ['meridian']) { const before = storage.get.mock.calls.length; expect((await request(paths[0]!, tenant)).status).toBe(403); expect(storage.get).toHaveBeenCalledTimes(before); }
    for (const brand of ['constructor', 'é'.repeat(129)]) for (const path of paths) {
      const before = storage.get.mock.calls.length;
      expect((await request(path + '&brand=' + encodeURIComponent(brand))).status).toBe(400); expect(storage.get).toHaveBeenCalledTimes(before);
    }
    const body = vi.fn(async () => 'secret-storage-detail');
    selected = { size: REPORT_LIMITS.savedBytes + 1, text: body };
    for (const path of paths) {
      const response = await request(path); expect(response.status).toBe(413); expect(response.headers.get('Cache-Control')).toBe('no-store');
      expect(await response.json()).toMatchObject({ code: 'report_budget_exceeded', budget: 'savedBytes', limit: REPORT_LIMITS.savedBytes, observed: REPORT_LIMITS.savedBytes + 1 });
    }
    expect(body).not.toHaveBeenCalled();
    for (const value of [undefined, { text: async () => '{' }, { text: async () => { throw new Error('secret-storage-detail'); } },
      ...['tenant', 'brand', 'date'].map(key => ({ text: async () => JSON.stringify({ ...raw, [key]: 'wrong' }) })),
      { text: async () => JSON.stringify({ ...raw, holdout: { hero: [null] } }) },
      { text: async () => JSON.stringify({ ...raw, holdout: { hero: [{ arm: 'a', decisions: 1e-308, credited: 1e308 }] } }) }]) {
      selected = value;
      for (const path of paths) { const response = await request(path); expect(response.status).toBe(503); expect(response.headers.get('Cache-Control')).toBe('no-store'); expect(await response.text()).toBe('{"ok":false,"error":"report unavailable"}'); }
    }
    const cancel = vi.fn();
    selected = { body: new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array(REPORT_LIMITS.savedBytes + 1)); }, cancel }) };
    expect((await request(paths[0]!)).status).toBe(413); expect(cancel).toHaveBeenCalledTimes(1);
    selected = { body: new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array([255])); c.close(); } }) };
    expect((await request(paths[0]!)).status).toBe(503);
    selected = null;
    expect((await request(paths[0]!)).status).toBe(404);
    const empty = await request(paths[1]!); expect(empty.status).toBe(200);
    expect(await empty.json()).toMatchObject({ report: { days: [], missing: ['2026-09-03'] } });
    expect(storage.put).not.toHaveBeenCalled(); expect(storage.delete).not.toHaveBeenCalled(); expect(storage.list).not.toHaveBeenCalled();
  });
  it('W32.02 shares exposures once while preserving ordered arithmetic and independent policy snapshots', () => {
    const input = { tenant: 'coach', brand: 'coach', date: '2026-09-03', learning, reporting: presetPolicies(learning), learn,
      decisions: [dec('x', 'v', 's', T0 + 4000, 'b', 'personalized', true), dec('x', 'v', 's', T0, 'a'),
        dec('x', 'other', 'other', T0 + 1000, 'a', 'default'), dec('x', 'v', 's', T0 + 2000, 'c', 'personalized', false, 'story')],
      outcomes: [out('v', 's', T0 + 6000, 'click', 'b'), out('v', 's', T0 + 5000, 'click', 'b')], now: T0 + 7000, truncated: true };
    const before = JSON.stringify(input), exposure = vi.spyOn(stats, 'recordExposure');
    let combined: DayReport;
    try { combined = buildReport(input); expect(exposure).toHaveBeenCalledTimes(3); } finally { exposure.mockRestore(); }
    expect(combined.coverage!.truncated).toBe(true);
    for (const p of [learning, ...input.reporting]) {
      const alone = buildReport({ ...input, learning: p, reporting: [] });
      for (const slot of Object.keys(combined.grids)) expect(combined.grids[slot]![p.name]).toEqual(alone.grids[slot]![p.name]);
    }
    expect(combined.grids.hero!.learning!.items.b!['*']!.s).toBeGreaterThan(1.99);
    expect(combined.grids.hero!['first-touch']!.items.a!['*']!.s).toBe(0);
    expect(combined.grids.hero!['any-item']!.items.b!['*']!.s).toBeGreaterThan(1.99);
    const duplicate = buildReport({ ...input, reporting: [input.reporting[0]!, { ...input.reporting[2]!, name: input.reporting[0]!.name }] });
    const last = buildReport({ ...input, learning: { ...input.reporting[2]!, name: input.reporting[0]!.name }, reporting: [] });
    expect(duplicate.grids.hero![input.reporting[0]!.name]).toEqual(last.grids.hero![input.reporting[0]!.name]);
    expect(JSON.stringify(input)).toBe(before); expect(buildReport(input)).toEqual(combined);
  });

  it('W32.02 refuses pure raw record, work, parent-cell and output overflow without mutating admitted inputs', () => {
    const base = { tenant: 'coach', brand: 'coach', date: '2026-09-03', learning, reporting: [] as ReportPolicy[], learn,
      decisions: [dec('x', 'v', 's', T0, 'a')], outcomes: [] as OutcomeRecord[], now: T0 + 6000, truncated: false };
    const refuses = (input: Parameters<typeof buildReport>[0], budget: string) => {
      try { buildReport(input); throw new Error('expected budget refusal'); } catch (error) { expect(error).toBeInstanceOf(ReportBudgetExceeded); expect(error).toMatchObject({ budget }); }
    };
    const minimal = { tenant: 'coach', brand: 'coach', visitor_id: 'v', ts: T0 };
    refuses({ ...base, decisions: Array.from({ length: REPORT_LIMITS.records + 1 }, (_, n) => ({ ...minimal, decision_id: String(n),
      slot: 's', item_id: 'i', arm: 'default', position: 0, explored: false, cell: {} } as DecisionRecord)) }, 'records');
    refuses({ ...base, outcomes: Array.from({ length: REPORT_LIMITS.records + 1 }, (_, n) => ({ ...minimal, outcome_id: String(n), type: 'click' } as OutcomeRecord)) }, 'records');
    const six = [...presetPolicies(learning), { ...learning, name: 'custom' }];
    expect(buildReport({ ...base, reporting: six }).policies).toHaveLength(6);
    refuses({ ...base, reporting: [...six, { ...learning, name: 'seventh' }] }, 'policies');
    for (const field of ['item_id', 'slot', 'arm'] as const) expect(() => buildReport({ ...base, decisions: [{ ...base.decisions[0]!, [field]: 'constructor' }] })).toThrow(ReportInputError);
    expect(() => buildReport({ ...base, decisions: [{ ...base.decisions[0]!, item_id: 'é'.repeat(129) }] })).toThrow(ReportInputError);
    expect(buildReport({ ...base, decisions: [{ ...base.decisions[0]!, item_id: 'é'.repeat(128) }] }).counts.decisions).toBe(1);
    expect(() => buildReport({ ...base, decisions: [null as unknown as DecisionRecord] })).toThrow(ReportInputError);
    const featured = { ...base.decisions[0]!, featured_product_ids: ['f', 'f', 'f', 'f'] };
    const productOutcome = { ...out('v', 's', T0 + 1, 'click', null), products: Array<string>(199_998).fill('x') };
    // 7 base units + (1 + 199998) + (2 + 4*199998) = exactly one million.
    expect(buildReport({ ...base, decisions: [featured], outcomes: [productOutcome] }).policies[0]!.credits).toBe(0);
    refuses({ ...base, decisions: [featured], outcomes: [{ ...productOutcome, products: [...productOutcome.products, 'x'] }] }, 'work');
    refuses({ ...base, decisions: [{ ...featured, featured_product_ids: Array<string>(REPORT_LIMITS.work).fill('x') }] }, 'work');
    const dense = Array.from({ length: 2729 }, (_, n) => ({ ...dec('x', `v${n}`, 's', T0, `i${n}`, 'default'), cell: { ...cell, channel: 'a|b|c|d|e' } }));
    // 2729*6 item keys +10 slot/recursive-parent keys =16384, including default rows.
    expect(buildReport({ ...base, decisions: dense }).counts.decisions).toBe(2729);
    expect(buildReport({ ...base, decisions: Array<DecisionRecord>(1000).fill(dense[0]!) }).counts).toMatchObject({ decisions: 1, duplicates: { decisions: 999, outcomes: 0 } });
    refuses({ ...base, decisions: [...dense, { ...dense[0]!, decision_id: 'one-more', item_id: 'one-more' }] }, 'cells');
    const rich = Array.from({ length: 2000 }, (_, n) => ({ ...dec('x', `v${n}`, 's', T0, `i${n}`),
      cell: { channel: 'c'.repeat(256), visit_bucket: 'v'.repeat(256), stage: 's'.repeat(256), region: 'r'.repeat(256), affinity: 'a'.repeat(256) } as DecisionRecord['cell'] }));
    refuses({ ...base, decisions: rich }, 'outputBytes');
    const empty = buildReport({ ...base, decisions: [] });
    const padded = { ...empty, date: '' }, overhead = new TextEncoder().encode(JSON.stringify(padded)).length;
    padded.date = 'x'.repeat(REPORT_LIMITS.outputBytes - overhead);
    expect(new TextEncoder().encode(rawReportJson(padded)).length).toBe(REPORT_LIMITS.outputBytes);
    expect(() => rawReportJson({ ...padded, date: padded.date + 'x' })).toThrow(ReportBudgetExceeded);
  });

  it('W32.02 bounds actual raw reads and authenticated POST bodies before later work or canonical publication', async () => {
    const ids = { tenant: 'coach', brand: 'coach', date: '2026-09-03' }, prefix = 'coach/2026-09-03/12/';
    const row = dec('x', 'v', 's', T0, 'a'), event = out('v', 's', T0 + 1000, 'click', 'a');
    type Body = { text(): Promise<string>; size?: number; body?: ReadableStream<Uint8Array> };
    const storage = (bodies: Array<[string, Body]>) => ({
      get: vi.fn(async (key: string) => bodies.find(([k]) => k === key)?.[1] ?? null),
      list: vi.fn(async ({ prefix: p }: { prefix: string }) => ({ objects: bodies.filter(([k]) => k.startsWith(p)).map(([key]) => ({ key })), truncated: false })),
      put: vi.fn(async () => undefined),
    });
    const raw = (s: Parameters<typeof runReport>[0]) => runReport(s, ids, learn, [], T0 + 6000);
    const text = (value: string): Body => ({ text: vi.fn(async () => value) });
    const cancel = vi.fn(), unread = vi.fn(async () => 'must not read');
    const oversized = storage([[prefix + 'decision/first', { size: REPORT_LIMITS.objectBytes + 1, text: unread, body: new ReadableStream({ cancel }) }], [prefix + 'outcome/later', text(JSON.stringify(event))]]);
    await expect(raw(oversized)).rejects.toMatchObject({ budget: 'objectBytes' });
    expect(unread).not.toHaveBeenCalled(); expect(cancel).toHaveBeenCalledOnce(); expect(oversized.get).toHaveBeenCalledTimes(1); expect(oversized.put).not.toHaveBeenCalled();
    const unicode = 'é'.repeat(REPORT_LIMITS.rawBytes / 2 + 1);
    const fallback = storage([[prefix + 'decision/first', text(unicode)], [prefix + 'outcome/later', text(JSON.stringify(event))]]);
    await expect(raw(fallback)).rejects.toMatchObject({ budget: 'objectBytes' }); expect(fallback.get).toHaveBeenCalledTimes(1);
    const padded = JSON.stringify(row).padEnd(REPORT_LIMITS.rawBytes / 2, ' ');
    const laterText = vi.fn(async () => JSON.stringify(event));
    const combined = storage([[prefix + 'decision/first', text(padded)], [prefix + 'outcome/later', { size: REPORT_LIMITS.rawBytes / 2 + 1, text: laterText }]]);
    await expect(raw(combined)).rejects.toMatchObject({ budget: 'rawBytes', observed: REPORT_LIMITS.rawBytes + 1 });
    expect(laterText).not.toHaveBeenCalled(); expect(combined.put).not.toHaveBeenCalled();
    const exact = storage([[prefix + 'decision/first', text(JSON.stringify(row).padEnd(REPORT_LIMITS.rawBytes, ' '))]]);
    expect((await raw(exact)).counts.decisions).toBe(1);
    const streamCancel = vi.fn();
    const streamed = storage([[prefix + 'decision/first', { text: unread, body: new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(REPORT_LIMITS.rawBytes)); controller.enqueue(new Uint8Array(1)); }, cancel: streamCancel,
    }) }]]);
    await expect(raw(streamed)).rejects.toMatchObject({ budget: 'objectBytes' }); expect(streamCancel).toHaveBeenCalledOnce();
    const invalidUtf8 = storage([[prefix + 'decision/first', { text: unread, body: new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array([255])); c.close(); } }) }]]);
    await expect(raw(invalidUtf8)).rejects.toBeInstanceOf(ReportInputError);
    const tiny = (n: number) => JSON.stringify({ outcome_id: String(n), tenant: 'coach', brand: 'other', visitor_id: 'v', session_id: null, ts: T0, type: 'click', item_id: null, slot: null, products: null }) + '\n';
    const atCap = storage([[prefix + 'outcome/first', text(Array.from({ length: REPORT_LIMITS.records }, (_, n) => tiny(n)).join(''))]]);
    expect((await raw(atCap)).counts.outcomes).toBe(0); // count admission precedes brand filtering
    const overCap = storage([[prefix + 'outcome/first', text(Array.from({ length: REPORT_LIMITS.records + 1 }, (_, n) => tiny(n)).join(''))], [prefix + 'outcome/later', text(tiny(REPORT_LIMITS.records + 1))]]);
    await expect(raw(overCap)).rejects.toMatchObject({ budget: 'records', observed: REPORT_LIMITS.records + 1 }); expect(overCap.get).toHaveBeenCalledTimes(1);
    expect(await loadDay(overCap, ids.tenant, ids.date, 'outcome', 2)).toMatchObject({ truncated: true, records: [{ brand: 'other' }, { brand: 'other' }] });
    const keys = Array.from({ length: REPORT_LIMITS.objects + 1 }, (_, n): [string, Body] => [prefix + `outcome/${n}`, text('')]);
    const tooMany = storage(keys); await expect(raw(tooMany)).rejects.toMatchObject({ budget: 'objects', objects: 801 });
    expect(tooMany.list).toHaveBeenCalledTimes(1); expect(tooMany.get).not.toHaveBeenCalled();
    const atObjects = storage(keys.slice(0, REPORT_LIMITS.objects)); expect((await raw(atObjects)).counts.decisions).toBe(0);
    expect(atObjects.list.mock.calls.filter(([p]) => p.prefix === 'coach/2026-09-03/')).toHaveLength(1);
    const stalled = { ...storage([]), list: vi.fn(async () => ({ objects: [], truncated: true, cursor: 'same' })) };
    await expect(raw(stalled)).rejects.toBeInstanceOf(ReportInputError); expect(stalled.list).toHaveBeenCalledTimes(2); expect(stalled.get).not.toHaveBeenCalled();
    await expect(runDayReport(stalled, ids, learn, [], T0, { maxObjects: 800 })).rejects.toBeInstanceOf(ReportInputError);
    expect(stalled.list).toHaveBeenCalledTimes(4);

    const f = overlayFixture(REPORT_RETENTION_ENV); invalidateCache('learn', 'coach');
    await publishLearnConfig(f.storage, 'coach');
    f.storage.objects.set(f.key, 'canonical-sentinel');
    const cacheGet = vi.fn(async () => null), lists = vi.spyOn(f.storage, 'list'), gets = vi.spyOn(f.storage, 'get');
    const env = { AUTH_MODE: 'enforced', JWT_SECRET: 'w3202-synthetic-signing-material-only', JWT_ISSUER: 'i', JWT_AUDIENCE: 'a',
      TENANTS: JSON.stringify({ provisioned: ['coach'], operatorGrants: { reporter: ['coach'] } }), RETENTION: REPORT_RETENTION,
      CACHE: { get: cacheGet }, STORAGE: f.storage } as unknown as Env;
    const token = await new SignJWT({ type: 'service', roles: ['admin'] }).setProtectedHeader({ alg: 'HS256' }).setSubject('reporter')
      .setIssuer('i').setAudience('a').setExpirationTime('5m').sign(new TextEncoder().encode(env.JWT_SECRET));
    const app = new Hono().use('*', tenantMiddleware()).route('/v1', decisionRoutes);
    const request = (body: string) => app.request('/v1/coach/learn/report', { method: 'POST', headers: { 'X-Tenant': 'coach', Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Content-Length': '1' }, body }, env);
    const five = [...presetPolicies(learning), { ...learning, name: 'custom' }];
    for (const body of ['{', JSON.stringify({ policies: [null] }), JSON.stringify({ policies: false }), JSON.stringify({ brand: 'é'.repeat(129) }),
      JSON.stringify({ policies: [{ ...learning, name: 'é'.repeat(129) }] }), JSON.stringify({ policies: [{ ...learning, name: 'constructor' }] })]) {
      const res = await request(body); expect(res.status).toBe(400); expect(res.headers.get('Cache-Control')).toBe('no-store');
    }
    const policyRefusal = await request(JSON.stringify({ date: ids.date, policies: [...five, { ...learning, name: 'seventh' }] }));
    expect(policyRefusal.status).toBe(413); expect(await policyRefusal.json()).toMatchObject({ code: 'report_budget_exceeded', budget: 'policies', limit: 6, observed: 7 });
    const bodyRefusal = await request(' '.repeat(REPORT_LIMITS.requestBytes + 1));
    expect(bodyRefusal.status).toBe(413); expect(await bodyRefusal.json()).toMatchObject({ budget: 'requestBytes', limit: 65536, observed: 65537 });
    expect(cacheGet).not.toHaveBeenCalled(); expect(lists).not.toHaveBeenCalled(); expect(gets).not.toHaveBeenCalled();
    const accepted = await request(JSON.stringify({ date: ids.date, policies: five })); expect(accepted.status).toBe(200);
    expect((await accepted.json() as { report: DayReport }).report.policies).toHaveLength(6);
    const zero = await request(JSON.stringify({ date: ids.date, policies: [{ ...learning, name: 'zero', windowsMs: { click: 0 } }] }));
    expect(zero.status).toBe(200);
    const zeroPolicy = (await zero.json() as { report: DayReport }).report.policies.find(p => p.name === 'zero')!;
    expect(zeroPolicy.credits).toBe(1); expect(zeroPolicy.policy.windowsMs.click).toBeGreaterThan(0);
    const normal = JSON.stringify({ date: ids.date, policies: [] });
    expect((await request(normal.padEnd(REPORT_LIMITS.requestBytes, ' '))).status).toBe(200);
    expect(f.storage.objects.get(f.key)).toBe('canonical-sentinel'); expect(f.storage.puts).toEqual([]);
    f.storage.beforeRead = async key => { if (key.includes('/decision/')) f.storage.objects.set(key, JSON.stringify(row).padEnd(REPORT_LIMITS.rawBytes + 1, ' ')); };
    const rawRefusal = await request(JSON.stringify({ date: ids.date, policies: [] }));
    expect(rawRefusal.status).toBe(413); expect(await rawRefusal.json()).toMatchObject({ code: 'report_budget_exceeded', budget: 'objectBytes' });
    expect(f.storage.objects.get(f.key)).toBe('canonical-sentinel'); expect(f.storage.puts).toEqual([]);
  });

  it('W32.01 refuses conflicting duplicate arms and preserves unique policy credits and inputs', () => {
    for (const crossSlot of [false, true]) for (const personalizedFirst of [false, true]) {
      const first = { ...dec('unused', 'other', 'other-session', T0, 'a', 'default', false, crossSlot ? 'story' : 'hero'), decision_id: 'shared-id' };
      const later = { ...dec('unused', 'v1', 's1', T0 + 1000, 'a'), decision_id: 'shared-id' };
      const rows = [
        ...(personalizedFirst ? [later, first] : [first, later]),
        { ...dec('unused', 'v1', 's1', T0 + 2000, 'a'), decision_id: 'last-hero' },
        { ...dec('unused', 'v1', 's1', T0 + 1500, 'c', 'personalized', false, 'story'), decision_id: 'story' },
      ];
      const input = {
        tenant: 'coach', brand: 'coach', date: '2026-09-03', learn, decisions: rows,
        learning: { ...learning, credit: 'first' as const },
        reporting: [
          { ...learning, name: 'direct-last' },
          { ...learning, name: 'any-first', match: 'any' as const, credit: 'first' as const },
          { ...learning, name: 'any-last', match: 'any' as const },
        ],
        outcomes: [
          ...[3000, 4000].map(dt => ({ ...out('v1', 's1', T0 + dt, 'click', 'a'), slot: 'hero' })),
          { ...out('v1', 's1', T0 + 5000, 'click', 'missing'), slot: 'missing-slot' },
        ],
        now: T0 + 6000, truncated: false,
      };
      const before = JSON.stringify(input);
      expect(() => buildReport(input)).toThrow(ReportInputError);
      const uniqueInput = { ...input, decisions: input.decisions.map(row => row === first ? { ...row, decision_id: 'independent-first' } : row) };
      const result = buildReport(uniqueInput);
      expect(result.counts).toEqual({ decisions: 4, outcomes: 3, visitors: 2, truncated: false });
      expect(result.policies.map(p => [p.name, p.credits])).toEqual([
        ['learning', 2], ['direct-last', 2], ['any-first', 6], ['any-last', 6],
      ]);
      expect(result.holdout.hero!.find(arm => arm.arm === 'personalized')).toMatchObject({ decisions: 2, credited: 2 });
      if (!crossSlot) expect(result.holdout.hero!.find(arm => arm.arm === 'default')).toMatchObject({ decisions: 1, credited: 0 });
      else expect(result.holdout.hero!.map(arm => arm.arm)).toEqual(['personalized']);
      const hero = result.grids.hero!;
      const firstSuccess = hero.learning!.items.a!['*']!.s;
      const lastSuccess = hero['direct-last']!.items.a!['*']!.s;
      expect(lastSuccess).toBeGreaterThan(1.99);
      expect(firstSuccess).toBe(lastSuccess);
      expect(hero['any-first']!.items.a!['*']!.s).toBe(hero['any-last']!.items.a!['*']!.s);
      expect(hero['any-last']!.items.a!['*']!.s).toBeGreaterThan(2.99);
      expect(result.grids.story!['any-first']!.items.c!['*']!.s).toBeGreaterThan(2.99);
      expect(result.holdoutComparison).toEqual({ hero: [], story: [] });
      expect(result.coverage).toMatchObject({ source: 'ledger', maturity: 'unknown' });
      expect(buildReport(uniqueInput)).toEqual(result);
      expect(JSON.stringify(input)).toBe(before);
    }
  });

  it('W33.01 only null persists while empty, custom and preset arrays remain usable without creating or replacing a day', async () => {
    const f = overlayFixture();
    for (const policies of [[], f.custom, presetPolicies(DEFAULT_POLICY)]) {
      const result = await runReport(f.storage, f.ids, learn, policies, f.now);
      expect(result.counts).toMatchObject({ decisions: 2, outcomes: 1 });
      expect(result.policies.map(p => p.name)).toEqual(['learning', ...policies.map(p => p.name)]);
      expect(result.policies[0]!.credits).toBe(1);
      expect(result.coverage).toMatchObject({ source: 'ledger', maturity: 'unknown' });
      expect(f.storage.objects.has(f.key)).toBe(false); expect(f.storage.puts).toEqual([]);
    }
    const fallback = await runReport(f.storage, f.ids, learn, null, f.now);
    const storedFallback = JSON.parse(f.storage.objects.get(f.key)!); expect(storedFallback._summary.version).toBe(1); delete storedFallback._summary;
    expect(storedFallback).toEqual(fallback); expect(f.storage.puts).toEqual([f.key]);
    await buildHour(f.storage, f.ids.tenant, { date: f.ids.date, hour: 12 }, learn, f.now, { shards: 1, maxObjects: 1 });
    const canonical = await runDayReport(f.storage, f.ids, learn, null, f.now);
    expect(canonical.counts).toMatchObject({ decisions: 1, outcomes: 0, truncated: true });
    expect(canonical.policies[0]!.credits).toBe(0); expect(canonical.hours!.source).toBe('aggregates');
    const bytes = f.storage.objects.get(f.key), puts = [...f.storage.puts];
    for (const policies of [[], f.custom, presetPolicies(DEFAULT_POLICY)]) {
      const result = await runDayReport(f.storage, f.ids, learn, policies, f.now, { maxObjects: 10 });
      expect(result.counts.decisions).toBe(2); expect(result.policies[0]!.credits).toBe(1);
      expect(result.hours!.source).toBe('ledger'); expect(result.coverage!.minHorizonMs).toBeNull();
      expect(f.storage.objects.get(f.key)).toBe(bytes); expect(f.storage.puts).toEqual(puts);
    }
  });

  it('W33.01 authenticated custom POST cannot replace canonical GET/window across either publication completion order', async () => {
    for (const customFinishesLast of [true, false]) {
      const f = overlayFixture(REPORT_RETENTION_ENV); invalidateCache('learn', 'coach');
      await publishLearnConfig(f.storage, 'coach');
      const env = { AUTH_MODE: 'enforced', JWT_SECRET: 'w3301-synthetic-signing-material-only', JWT_ISSUER: 'i', JWT_AUDIENCE: 'a',
        TENANTS: JSON.stringify({ provisioned: ['coach', 'meridian'], operatorGrants: { reporter: ['coach'] } }), RETENTION: REPORT_RETENTION,
        CACHE: { get: async () => null }, STORAGE: f.storage } as unknown as Env;
      const token = await new SignJWT({ type: 'service', roles: ['admin'] }).setProtectedHeader({ alg: 'HS256' }).setSubject('reporter')
        .setIssuer('i').setAudience('a').setExpirationTime('5m').sign(new TextEncoder().encode(env.JWT_SECRET));
      const app = new Hono().use('*', tenantMiddleware()).route('/v1', decisionRoutes);
      const request = (suffix: string, body?: unknown, tenant = 'coach') => app.request(`/v1/${tenant}/learn/report${suffix}`, {
        method: body === undefined ? 'GET' : 'POST', headers: { 'X-Tenant': tenant, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }, env);
      const sentinels = [reportKey('meridian', 'meridian', f.ids.date), reportKey('coach', 'other-brand', f.ids.date), reportKey('coach', 'coach', '2026-09-02')];
      for (const key of sentinels) f.storage.objects.set(key, `sentinel:${key}`);
      await buildHour(f.storage, f.ids.tenant, { date: f.ids.date, hour: 12 }, learn, f.now, { shards: 1, maxObjects: 1 });
      const initial = await request('', { date: f.ids.date }); expect(initial.status).toBe(200);
      const initialBytes = f.storage.objects.get(f.key); const initialPuts = f.storage.puts.length;
      const read = async () => {
        const day = await request(`?date=${f.ids.date}`), window = await request(`/window?from=${f.ids.date}&to=${f.ids.date}`);
        for (const response of [day, window]) { expect(response.status).toBe(200); expect(response.headers.get('Cache-Control')).toBe('no-store'); }
        return { day: (await day.json() as { report: DayReport }).report, window: (await window.json() as { report: Awaited<ReturnType<typeof windowReport>> }).report };
      };
      const before = await read();
      for (const policies of [[], f.custom, presetPolicies(DEFAULT_POLICY)]) {
        const response = await request('', { date: f.ids.date, policies }); expect(response.status).toBe(200); expect(response.headers.get('Cache-Control')).toBe('no-store');
        const { report } = await response.json() as { report: DayReport };
        expect(report.policies.map(p => p.name)).toEqual(['learning', ...policies.map(p => p.name)]);
        expect(report.counts.decisions).toBe(2); expect(report.policies[0]!.credits).toBe(1);
        expect(f.storage.objects.get(f.key)).toBe(initialBytes); expect(f.storage.puts.length).toBe(initialPuts);
        expect(await read()).toEqual(before);
      }
      const gate = barrier();
      if (customFinishesLast) {
        f.storage.beforeRead = async key => { if (key.includes('/decision/')) { f.storage.beforeRead = undefined; await gate.hold(); } };
      } else f.storage.beforePut = async key => { if (key === f.key) { f.storage.beforePut = undefined; await gate.hold(); } };
      const first = request('', { date: f.ids.date, ...(customFinishesLast ? { policies: f.custom } : {}) });
      await gate.ready;
      const second = await request('', { date: f.ids.date, ...(customFinishesLast ? {} : { policies: [] }) });
      expect(second.status).toBe(200);
      const secondReport = (await second.json() as { report: DayReport }).report;
      const during = f.storage.objects.get(f.key);
      if (customFinishesLast) { const value = JSON.parse(during!); expect(value._summary.version).toBe(1); delete value._summary; expect(value).toEqual(secondReport); }
      else expect(during).toBe(initialBytes);
      gate.release();
      const firstResponse = await first; expect(firstResponse.status).toBe(200);
      const firstReport = (await firstResponse.json() as { report: DayReport }).report;
      const canonical = customFinishesLast ? secondReport : firstReport;
      const storedCanonical = JSON.parse(f.storage.objects.get(f.key)!); expect(storedCanonical._summary.version).toBe(1); delete storedCanonical._summary;
      expect(storedCanonical).toEqual(canonical);
      expect(f.storage.puts.length).toBe(initialPuts + 1);
      const after = await read(); expect(after.day).toEqual(diagnosticDayReport(canonical));
      expect(after.window).toEqual(before.window);
      expect(after.day.counts.decisions).toBe(1); expect(after.day.coverage!.truncated).toBe(true);
      for (const key of sentinels) expect(f.storage.objects.get(key)).toBe(`sentinel:${key}`);
      const writes = f.storage.puts.length;
      expect((await request('', { date: f.ids.date, policies: [] }, 'meridian')).status).toBe(403);
      expect(f.storage.puts.length).toBe(writes);
    }
  });

  it('W30.02 normalizes new, legacy and malformed coverage through actual day and window reads without writeback', async () => {
    const raw = buildReport({ tenant: 'coach', brand: 'coach', date: '2026-09-03', learning, reporting: [], learn,
      decisions: [dec('1', 'v1', 's1', T0, 'a')], outcomes: [out('v1', 's1', T0 + 1000, 'click', 'a')], now: T0 + 10_000, truncated: false });
    expect(raw.coverage).toMatchObject({ source: 'ledger', maturity: 'unknown', minHorizonMs: null });
    expect(diagnosticDayReport(raw).coverage).toEqual(raw.coverage);
    const hours = { source: 'aggregates' as const, built: [12, 13], missing: [], horizonMs: 48 * 3600_000 };
    const coverage = reportCoverage({ counts: raw.counts, hours }, { version: 1, source: 'aggregates', truncated: false, visitorsIncomplete: false,
      missingHours: [], truncatedHours: [], unadvancedHours: [], unknownHours: [], horizons: [{ hour: 12, horizonMs: 3600_000 }, { hour: 13, horizonMs: 48 * 3600_000 }] });
    const reports: Record<string, unknown> = {
      '2026-09-03': { ...raw, hours, coverage },
      '2026-09-04': { ...raw, date: '2026-09-04', hours, coverage: undefined },
      '2026-09-05': { ...raw, date: '2026-09-05', counts: { ...raw.counts, truncated: true }, hours: { ...hours, missing: [14] },
        coverage: { ...coverage, maturity: 'complete', visitorsIncomplete: true, truncatedHours: [12], unadvancedHours: [13], horizons: 'bad' } },
      '2026-09-06': { ...raw, date: '2026-09-06', coverage: undefined },
    };
    const before = JSON.stringify(reports);
    const storage = { get: vi.fn(async (key: string) => { const value = Object.entries(reports).find(([date]) => key === reportKey('coach', 'coach', date))?.[1]; const text = JSON.stringify(value); return value ? { size: new TextEncoder().encode(text).length, text: async () => text } : null; }), put: vi.fn(), delete: vi.fn(), list: vi.fn() };
    // R10/R126(a) with F25 §5.1: the report GETs are behind the build POST's own
    // operator gate, so this read presents the operator credential. The claim and
    // every expected value below are unchanged.
    const env = { STORAGE: storage, JWT_SECRET: reportJwtSecret, JWT_ISSUER: 'i', JWT_AUDIENCE: 'a' } as unknown as Env;
    const operator = { headers: { Authorization: `Bearer ${await operatorCredential()}` } };
    for (const [date, metadata] of [['2026-09-03', 'recorded'], ['2026-09-04', 'absent'], ['2026-09-05', 'invalid'], ['2026-09-06', 'absent']]) {
      const response = await decisionRoutes.request(`https://report.test/coach/learn/report?date=${date}`, operator, env);
      expect(response.status).toBe(200); expect(response.headers.get('Cache-Control')).toBe('no-store');
      const { report } = await response.json() as { report: typeof raw };
      expect(report.coverage!.metadata).toBe(metadata); expect(report.coverage!.maturity).toBe('unknown');
      expect(reportCoverage(report)).toEqual(report.coverage);
      expect(report.coverage!.minHorizonMs).toBe(metadata === 'recorded' ? 3600_000 : null);
      if (metadata === 'invalid') expect(report.coverage).toMatchObject({ truncated: true, visitorsIncomplete: true, missingHours: [14], truncatedHours: [12], unadvancedHours: [13], unknownHours: [12, 13] });
      expect(report.holdout.hero).toEqual(raw.holdout.hero); expect(report.holdoutComparison.hero).toEqual([]);
    }
    // R10/R126(a): the window GET is behind the same operator gate as the day GET above.
    const response = await decisionRoutes.request('https://report.test/coach/learn/report/window?from=2026-09-03&to=2026-09-07', { headers: { Authorization: `Bearer ${await operatorCredential()}` } }, env);
    expect(response.status).toBe(200); expect(response.headers.get('Cache-Control')).toBe('no-store');
    const { report: window } = await response.json() as { report: Awaited<ReturnType<typeof windowReport>> };
    expect(window.coverage.days.map(d => d.coverage.metadata)).toEqual(['recorded', 'absent', 'invalid', 'absent']);
    expect(window.coverage).toMatchObject({ status: 'incomplete', maturity: 'unknown', minHorizonMs: null });
    expect(window.missing).toEqual(['2026-09-07']);
    expect(window.slots.hero!.arms[0]).toMatchObject({ decisions: 4, credited: 4 });
    const single = await windowReport(storage, { tenant: 'coach', brand: 'coach', from: '2026-09-03', to: '2026-09-03' });
    expect(single.coverage).toMatchObject({ status: 'unknown', maturity: 'unknown', minHorizonMs: 3600_000 });
    expect(JSON.stringify(reports)).toBe(before);
    expect(storage.get).toHaveBeenCalledTimes(10); expect(storage.put).not.toHaveBeenCalled(); expect(storage.delete).not.toHaveBeenCalled(); expect(storage.list).not.toHaveBeenCalled();
  });

  const decisions = [
    dec('1', 'v1', 's1', T0, 'a'),                                  // v1 sees a, then b, clicks b: last-touch pays b, first-touch pays a (any-item)
    dec('2', 'v1', 's1', T0 + 60_000, 'b', 'personalized', true),
    dec('3', 'v2', 's2', T0, 'a', 'default'),                       // the holdout's default arm: no exposure, its click counts for the arm
    dec('4', 'v3', 's3', T0, 'a'),                                  // v3 buys 2 days later: outside the 30 min click window, inside a purchase window only under a purchase policy
  ];
  const outcomes = [
    out('v1', 's1', T0 + 120_000, 'click', 'b'),
    out('v2', 's2', T0 + 30_000, 'click', 'a'),
    out('v3', 's3', T0 + 2 * 24 * 3600_000, 'purchase', 'a'),
  ];

  it('rings are per visitor, oldest first', () => {
    const rings = ringsOf(decisions);
    expect(rings.size).toBe(3);
    expect(rings.get('v1')!.map((e) => e.item)).toEqual(['a', 'b']);
  });

  it('the learning grid, the reporting overlays beside it, the arms and what explored', () => {
    const anyFirst: ReportPolicy = { name: 'first-any', ...DEFAULT_POLICY, match: 'any', credit: 'first' };
    const r = buildReport({ tenant: 'coach', brand: 'coach', date: '2026-09-03', learning, reporting: [anyFirst], learn, decisions, outcomes, now: T0 + 3 * 3600_000, truncated: false });
    expect(r.counts).toEqual({ decisions: 4, outcomes: 3, visitors: 3, truncated: false });
    const L = r.grids.hero!.learning!, F = r.grids.hero!['first-any']!;
    // learning: last-touch, direct: the click on b pays b; the default arm's click pays no item; the purchase is a different reward for this slot
    expect(L.items.b!['*']!.s).toBeCloseTo(1, 1); expect(L.items.a!['*']!.s).toBe(0);   // decayed three hours on a 21-day τ
    expect(L.items.a!['*']!.n).toBeCloseTo(2, 1);                   // v1's and v3's exposures; the default arm is not an exposure
    // first-touch over any item: the same click pays a instead
    expect(F.items.a!['*']!.s).toBeCloseTo(1, 1); expect(F.items.b!['*']!.s).toBe(0);
    expect(r.policies.map((p) => [p.name, p.role, p.credits])).toEqual([['learning', 'learning', 2], ['first-any', 'reporting', 2]]);
    expect(r.holdout.hero).toEqual([{ arm: 'default', decisions: 1, credited: 1, creditedPerDecision: 1, rate: 1 }, { arm: 'personalized', decisions: 3, credited: 1, creditedPerDecision: 1 / 3, rate: 1 / 3 }]);
    expect(r.exploration).toEqual([{ slot: 'hero', decisions: 3, explored: 1, realized: 0.333, configured: 0.5, mode: 'rotation' }]);
  });

  it('presets are the natural overlays of the learning policy', () => {
    expect(presetPolicies(DEFAULT_POLICY).map((p) => p.name)).toEqual(['first-touch', 'any-item', 'visitor-scope', 'purchase-1d']);
    // the learning policy carries a name of its own; the overlays must keep theirs
    expect(presetPolicies(learning).map((p) => p.name)).toEqual(['first-touch', 'any-item', 'visitor-scope', 'purchase-1d']);
    expect(presetPolicies(DEFAULT_POLICY)[3]!.windowsMs.purchase).toBe(86_400_000);
  });

  it('W21 retains repeated credits in raw reports and withdraws historic GET inference without storage mutation', async () => {
    const report = buildReport({
      tenant: 'coach', brand: 'coach', date: '2026-09-03', learning, reporting: [], learn,
      decisions: [dec('1', 'v1', 's1', T0, 'a')],
      outcomes: [1, 2, 3].map((n) => out('v1', 's1', T0 + n * 1000, 'click', 'a')),
      now: T0 + 10_000, truncated: true,
    });
    expect(report.holdout.hero).toEqual([{ arm: 'personalized', decisions: 1, credited: 3, creditedPerDecision: 3, rate: 3 }]);
    expect(report.holdoutComparison).toEqual({ hero: [] });
    expect(report.measurement).toEqual({ kind: 'attribution_diagnostic', unit: 'credited_outcomes_per_content_item_decision', inference: 'unavailable', experimentalCoverage: 'not_assessed' });
    const historic = {
      ...report, measurement: { inference: 'available' }, confidence: 0.99, words: 'UNSUPPORTED HISTORIC CLAIM',
      holdout: { hero: [
        { arm: 'personalized', decisions: 1, credited: 3, rate: 1, targets: { standing: 'reached_stretch' } },
        { arm: 'default', decisions: 0, credited: 2, rate: 0, confidence: 0.99 },
      ] },
      holdoutComparison: { hero: [{ words: 'UNSUPPORTED HISTORIC CLAIM', verdict: 'treatment_better', targets: { standing: 'reached_stretch' }, neededPerArm: 123 }] },
      hours: { source: 'aggregates', built: [12], missing: [13], horizonMs: 3600_000 },
    };
    const stored = JSON.stringify(historic);
    const storage = {
      get: vi.fn(async (key: string, options?: R2GetOptions) => {
        void options; // This text-only legacy adapter returns the complete body even for a range request.
        return key === reportKey('coach', 'coach', '2026-09-03') ? { text: async () => JSON.stringify(historic) } : null;
      }),
      put: vi.fn(), delete: vi.fn(), list: vi.fn(),
    };
    // R10/R126(a) with F25 §5.1: the report GETs are behind the build POST's own
    // operator gate, so this read presents the operator credential. The claim and
    // every expected value below are unchanged.
    const env = { STORAGE: storage, JWT_SECRET: reportJwtSecret, JWT_ISSUER: 'i', JWT_AUDIENCE: 'a' } as unknown as Env;
    const response = await decisionRoutes.request('https://report.test/coach/learn/report?date=2026-09-03',
      { headers: { Authorization: `Bearer ${await operatorCredential()}` } }, env);
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    const body = await response.json() as { report: typeof report };
    expect(body.report.holdout.hero).toEqual([
      { arm: 'personalized', decisions: 1, credited: 3, creditedPerDecision: 3, rate: 3 },
      { arm: 'default', decisions: 0, credited: 2, creditedPerDecision: null, rate: null },
    ]);
    expect(body.report.holdoutComparison).toEqual({ hero: [] });
    expect(body.report.measurement.inference).toBe('unavailable');
    expect(body.report.hours).toEqual(historic.hours);
    expect(body.report.counts.truncated).toBe(true);
    // R10/R126(a): the window GET is behind the same operator gate as the day GET above.
    const windowResponse = await decisionRoutes.request('https://report.test/coach/learn/report/window?from=2026-09-03&to=2026-09-04&confidence=0.99', { headers: { Authorization: `Bearer ${await operatorCredential()}` } }, env);
    expect(windowResponse.status).toBe(200);
    const windowBody = await windowResponse.json() as { report: Awaited<ReturnType<typeof windowReport>> };
    expect(windowBody.report.slots.hero.arms.find((arm) => arm.arm === 'personalized')).toMatchObject({ decisions: 1, credited: 3, creditedPerDecision: 3 });
    expect(windowBody.report.slots.hero.arms.find((arm) => arm.arm === 'default')).toMatchObject({ decisions: 0, credited: 2, creditedPerDecision: null });
    expect(windowBody.report.incomplete).toEqual([{ date: '2026-09-03', truncated: true, missingHours: [13] }]);
    expect(windowBody.report.missing).toEqual(['2026-09-04']);
    for (const result of [body, windowBody]) expect(JSON.stringify(result)).not.toMatch(/UNSUPPORTED|confidence|verdict|targets|neededPerArm|relative|"lo"|"hi"/);
    expect(JSON.stringify(historic)).toBe(stored);
    expect(storage.get.mock.calls.map(([key]) => key)).toEqual([
      reportKey('coach', 'coach', '2026-09-03'), reportKey('coach', 'coach', '2026-09-03'),
      reportKey('coach', 'coach', '2026-09-03'), reportKey('coach', 'coach', '2026-09-04'), // Text-only legacy prefix requires a separate complete read.
    ]);
    expect(storage.get.mock.calls.map(([, options]) => options?.range)).toEqual([
      undefined, { offset: 0, length: REPORT_LIMITS.summaryBytes }, undefined, { offset: 0, length: REPORT_LIMITS.summaryBytes },
    ]);
    expect(storage.put).not.toHaveBeenCalled(); expect(storage.delete).not.toHaveBeenCalled(); expect(storage.list).not.toHaveBeenCalled();
  });

  it('W21 rejects invalid, nonexistent, reversed and oversized windows before storage I/O through the actual route', async () => {
    const storage = { get: vi.fn(), put: vi.fn(), delete: vi.fn(), list: vi.fn() };
    // R10/R126(a) with F25 §5.1: the report GETs are behind the build POST's own
    // operator gate, so this read presents the operator credential. The claim and
    // every expected value below are unchanged.
    const env = { STORAGE: storage, JWT_SECRET: reportJwtSecret, JWT_ISSUER: 'i', JWT_AUDIENCE: 'a' } as unknown as Env;
    const operator = { headers: { Authorization: `Bearer ${await operatorCredential()}` } };
    for (const [from, to] of [
      ['nope', '2026-09-01'], ['2026-02-30', '2026-03-01'], ['2026-09-03', '2026-09-01'],
      ['2026-06-30', '2026-12-31'],
    ]) {
      const response = await decisionRoutes.request(`https://report.test/coach/learn/report/window?from=${from}&to=${to}`, operator, env);
      expect(response.status).toBe(400);
      const body = await response.json() as { ok: boolean; error: string };
      expect(body.ok).toBe(false); expect(body.error).toBeTruthy();
    }
    expect(storage.get).not.toHaveBeenCalled(); expect(storage.put).not.toHaveBeenCalled();
    expect(storage.delete).not.toHaveBeenCalled(); expect(storage.list).not.toHaveBeenCalled();

    // Previously refused 93/181-day requests now retain their exact missing-day envelope.
    storage.get.mockResolvedValue(null);
    for (const [to, length] of [['2026-04-03', 93], ['2026-06-30', 181]] as const) {
      storage.get.mockClear();
      // R10/R126(a): the window GET is behind the same operator gate.
      const response = await decisionRoutes.request(`https://report.test/coach/learn/report/window?from=2026-01-01&to=${to}`, { headers: { Authorization: `Bearer ${await operatorCredential()}` } }, env);
      expect(response.status).toBe(200);
      const { report } = await response.json() as { report: Awaited<ReturnType<typeof windowReport>> };
      expect(report.from).toBe('2026-01-01'); expect(report.to).toBe(to);
      expect(report.days).toEqual([]); expect(report.missing).toHaveLength(length); expect(report.missing[length - 1]).toBe(to);
      expect(storage.get).toHaveBeenCalledTimes(length);
    }
    // Synthetic daily counters, real canonical serializer, ranged reader and route.
    const template = buildReport({ tenant: 'coach', brand: 'coach', date: '2026-09-03', learning, reporting: [], learn,
      decisions: [dec('1', 'v1', 's1', T0, 'a')], outcomes: [1, 2, 3].map(n => out('v1', 's1', T0 + n * 1000, 'click', 'a')),
      now: T0 + 10_000, truncated: false });
    const days = Array.from({ length: 184 }, (_, i) => new Date(Date.UTC(2026, 6, 1) + i * 86400_000).toISOString().slice(0, 10));
    const missing = '2026-12-30', encoder = new TextEncoder();
    storage.get.mockClear();
    storage.get.mockImplementation(async (key: string, options?: R2GetOptions) => {
      const date = key.slice(-15, -5);
      expect(options).toEqual({ range: { offset: 0, length: REPORT_LIMITS.summaryBytes } });
      if (date === missing) return null;
      const bytes = encoder.encode(canonicalReportJson({ ...template, date }));
      return { size: bytes.length, body: new ReadableStream<Uint8Array>({ start(c) { c.enqueue(bytes.slice(0, REPORT_LIMITS.summaryBytes)); c.close(); } }) };
    });
    // R10/R126(a): the window GET is behind the same operator gate as the day GET above.
    const response = await decisionRoutes.request('https://report.test/coach/learn/report/window?from=2026-07-01&to=2026-12-31', { headers: { Authorization: `Bearer ${await operatorCredential()}` } }, env);
    expect(response.status).toBe(200); expect(response.headers.get('Cache-Control')).toBe('no-store');
    const { report } = await response.json() as { report: Awaited<ReturnType<typeof windowReport>> };
    expect(report.from).toBe(days[0]); expect(report.to).toBe(days[183]);
    expect(report.days).toEqual(days.filter(date => date !== missing)); expect(report.missing).toEqual([missing]);
    expect(report.slots.hero!.arms[0]).toMatchObject({ decisions: 183, credited: 549 });
    expect(report.compatibility.experimental).toBe('unverified'); expect(report.coverage.maturity).toBe('unknown');
    expect(storage.get.mock.calls.map(([key]) => key)).toEqual(days.map(date => reportKey('coach', 'coach', date)));
    expect(storage.put).not.toHaveBeenCalled(); expect(storage.delete).not.toHaveBeenCalled(); expect(storage.list).not.toHaveBeenCalled();
  });

  it("loadDay reads a day's NDJSON batches for one stream and stops at the cap", async () => {
    const objects: Record<string, string> = {
      'coach/2026-09-03/12/decision/a-b-1.ndjson': [JSON.stringify(decisions[0]), JSON.stringify(decisions[1]), 'not json'].join('\n'),
      'coach/2026-09-03/12/outcome/a-b-1.ndjson': JSON.stringify(outcomes[0]),
      'coach/2026-09-03/13/decision/c-d-2.ndjson': JSON.stringify(decisions[2]),
      'coach/2026-09-04/00/decision/e-f-3.ndjson': JSON.stringify(decisions[3]),
    };
    const r2 = {
      put: async () => undefined,
      get: async (k: string) => (k in objects ? { text: async () => objects[k]! } : null),
      list: async ({ prefix }: { prefix: string }) => ({ objects: Object.keys(objects).filter((k) => k.startsWith(prefix)).map((key) => ({ key })), truncated: false }),
    };
    const d = await loadDay<DecisionRecord>(r2, 'coach', '2026-09-03', 'decision', 10);
    expect(d.records.map((x) => x.visitor_id)).toEqual(['v1', 'v1', 'v2']); expect(d.truncated).toBe(false);
    const capped = await loadDay<DecisionRecord>(r2, 'coach', '2026-09-03', 'decision', 1);
    expect(capped.records).toHaveLength(1); expect(capped.truncated).toBe(true);
  });
});

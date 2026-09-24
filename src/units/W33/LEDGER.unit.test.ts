// src/units/W33/LEDGER.unit.test.ts
//
// W33 — "Custom overlays never overwrite canonical day reports."
//
// AUTHORITY (docs/remediation/delivery-control/program.json, ticket W33, quoting
// document 35 §5 row W33, line 435): "Custom overlays never overwrite canonical
// day reports. Use separate policy/version identity or non-persistent results,
// verify subsequent canonical GET/window unchanged, and define safe
// repair/provenance for any historical canonical results affected. Protect
// against concurrent overlay/canonical writes."
//
// WITNESSES
//   · document 35 §3 N09 — "Custom report overlays can overwrite the canonical
//     stored day result subsequently pooled by the window report" (related
//     F17/F25).
//   · docs/architecture/35-verification-reports/sweep-learning-and-statistics.md
//     L1 — the overwrite, and the "stored `hours` block also degrades from
//     {source:'aggregates'…} to {source:'ledger', built:[], missing:[]}"; its
//     remedy: "Persist under `reportKey` only when `reporting === null` … leave
//     the canonical key to the fold … Consider making stored reports
//     immutable-versioned".
//   · HANDOFF-2026-09-18 §6 W33 row — "Verify concurrency and original scope;
//     historical repair is conditional on actual contaminated data, not an
//     assumed fresh-stamp blocker" (the ticket's decision D1).
//
// CRITERIA SPECIFIED HERE: O2, O3, O4. O1 and LG1 are proven by the two legacy
// W33.01 tests of src/learn/report.test.ts (:622, :648), which the ticket's
// acceptance command runs as its second command; they are cited, not rewritten.
//
// RULED MEMBERS (the witness names the capability, not the spelling):
//   · `provenance` on the canonical day, read through GET /v1/:tenant/learn/report:
//       { version: 1, status: 'canonical' | 'repaired' | 'declared', policies: string[] }
//     `policies` is the ordered list of policy names the day's numbers were
//     computed under. A day that records no provenance reads `provenance: null`
//     (unknown), the convention this report already uses for `computation`.
//   · `repairCanonicalDay(r2, ids, learn, now)` exported by src/learn/hourly.ts,
//     answering `{ status: 'unaffected' | 'repaired' | 'declared' }`.
//
// Storage is the only synthetic part: the writers (runDayReport, which the POST
// route and the nightly job call; catchUp, which the five-minute job calls) and
// the mounted GET routes are the product's own.

import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import type { Env } from '@/types/env';
import type { DecisionRecord, LearnConfig } from '@/content/types';
import { hourPrefix, ts36, type OutcomeRecord } from '@/ledger/records';
import { canonicalReportJson, presetPolicies, reportKey, runReport, type DayReport, type ReportPolicy } from '@/learn/report';
import { DEFAULT_POLICY } from '@/learn/policy';
import { buildHour, catchUp, runDayReport, type R2Agg } from '@/learn/hourly';
// RULED EXPORT (O4). Absent at the base revision: the test is RED on it.
import { repairCanonicalDay } from '@/learn/hourly';
import { decisionRoutes } from '@/routes/decisions';
import { tenantMiddleware } from '@/tenancy/middleware';

// ─── the fixture day ─────────────────────────────────────────────────────────

const TENANT = 'coach';
const DATE = '2026-09-03';
const IDS = { tenant: TENANT, brand: TENANT, date: DATE };
const T12 = Date.UTC(2026, 8, 3, 12, 0, 0);
const MIN = 60_000, H = 3_600_000;
/** 16:00 on the fixture day: hours 12, 13 and 14 are closed (hourStart + 1 h + 5 min grace). */
const NOW = T12 + 4 * H;
const LEARN: LearnConfig = { holdout: { share: 0.1, salt: '', arms: ['default'] }, slots: { hero: { reward: 'click' } } };
/** The canonical policy set: the learning policy plus the preset overlays (src/learn/report.ts presetPolicies; kit 02 "the existing 4 presets"). */
const CANONICAL_POLICIES = ['learning', ...presetPolicies(DEFAULT_POLICY).map(p => p.name)];
/** An overlay a data scientist posts (report.test.ts overlayFixture uses the same shape). */
const CUSTOM: ReportPolicy[] = [{ ...DEFAULT_POLICY, name: 'custom-any-first', match: 'any', credit: 'first' }];

const cell = { channel: 'direct', visit_bucket: '1' as const, region: 'US-NY', affinity: null };
const dec = (visitor: string, ts: number, item: string, arm: DecisionRecord['arm'] = 'personalized'): DecisionRecord => ({
  decision_id: `${TENANT}:${ts36(ts)}:${visitor}:home:hero:0`, tenant: TENANT, brand: TENANT, visitor_id: visitor, session_id: `s-${visitor}`,
  identity_anchor: 'visitor', ts, page: 'home', slot: 'hero', position: 0, item_id: item, customer_item_id: `cms-${item}`, candidates: [], cell, arm,
  explored: false, authority: 'engine', versions: { config: 1, lift: 0, prior: 0, policy: 1 }, config_label: 'v1',
  explain: { drivers: [], score_base: 0, lift: null, score_final: 0 },
} as DecisionRecord);
const click = (visitor: string, ts: number, item: string): OutcomeRecord => ({
  outcome_id: `${TENANT}:${ts36(ts)}:${visitor}:click`, tenant: TENANT, brand: TENANT, visitor_id: visitor, session_id: `s-${visitor}`, ts,
  type: 'click', event: 'click', item_id: item, slot: null, value: null, currency: null, margin: null, products: null, arm: null,
});

// ─── storage: an R2 bucket with R2's own conditional semantics ──────────────

interface Stored { body: string; etag: string; uploaded: Date; version: string }
type Hook = (key: string) => Promise<void> | void;

/**
 * Synthetic R2. Conditional reads/writes follow R2: `onlyIf` as an R2Conditional
 * (etagMatches, etagDoesNotMatch, uploadedBefore, uploadedAfter) or as Headers
 * (If-Match, If-None-Match, If-Unmodified-Since, If-Modified-Since); a failed
 * precondition on put answers null and writes nothing. `beforeGet`/`beforePut`
 * let a test hold one writer at an exact point while another completes.
 */
class DayR2 {
  private objects = new Map<string, Stored>();
  private seq = 0;
  puts: string[] = [];
  beforeGet?: Hook;
  beforePut?: Hook;

  /** Fixture placement: never counted as a product write. */
  place(key: string, body: string): void { this.objects.set(key, this.record(body)); }
  text(key: string): string | undefined { return this.objects.get(key)?.body; }
  snapshot(): Array<[string, string]> { return [...this.objects].map(([k, v]) => [k, v.body] as [string, string]).sort(([a], [b]) => a.localeCompare(b)); }
  clone(): DayR2 { const copy = new DayR2(); for (const [k, v] of this.objects) copy.objects.set(k, { ...v }); copy.seq = this.seq; return copy; }

  private record(body: string): Stored {
    this.seq += 1;
    return { body, etag: createHash('sha256').update(body).digest('hex'), uploaded: new Date(Date.UTC(2026, 8, 1) + this.seq * 1000), version: `v${this.seq}` };
  }
  private meta(key: string, s: Stored) {
    return { key, etag: s.etag, httpEtag: `"${s.etag}"`, version: s.version, uploaded: s.uploaded, size: new TextEncoder().encode(s.body).length,
      httpMetadata: { contentType: 'application/json' }, customMetadata: {}, checksums: {}, storageClass: 'Standard' };
  }
  private passes(s: Stored | undefined, onlyIf: unknown): boolean {
    if (!onlyIf) return true;
    const strip = (e: string) => e.replace(/^W\//, '').replace(/^"|"$/g, '');
    let c: { etagMatches?: string; etagDoesNotMatch?: string; uploadedBefore?: Date; uploadedAfter?: Date };
    if (onlyIf instanceof Headers) {
      const since = onlyIf.get('If-Modified-Since'), unmodified = onlyIf.get('If-Unmodified-Since');
      c = { ...(onlyIf.get('If-Match') ? { etagMatches: onlyIf.get('If-Match')! } : {}),
        ...(onlyIf.get('If-None-Match') ? { etagDoesNotMatch: onlyIf.get('If-None-Match')! } : {}),
        ...(unmodified ? { uploadedBefore: new Date(unmodified) } : {}), ...(since ? { uploadedAfter: new Date(since) } : {}) };
    } else c = onlyIf as typeof c;
    if (c.etagMatches !== undefined) {
      if (!s) return false;
      const wanted = c.etagMatches.split(',').map(e => strip(e.trim()));
      if (!wanted.includes('*') && !wanted.includes(s.etag)) return false;
    }
    if (c.etagDoesNotMatch !== undefined && s) {
      const refused = c.etagDoesNotMatch.split(',').map(e => strip(e.trim()));
      if (refused.includes('*') || refused.includes(s.etag)) return false;
    }
    if (c.uploadedBefore !== undefined && s && !(s.uploaded.getTime() < new Date(c.uploadedBefore).getTime())) return false;
    if (c.uploadedAfter !== undefined && s && !(s.uploaded.getTime() > new Date(c.uploadedAfter).getTime())) return false;
    return true;
  }

  async head(key: string) { const s = this.objects.get(key); return s ? this.meta(key, s) : null; }
  async get(key: string, options?: { range?: { offset?: number; length?: number; suffix?: number } | Headers; onlyIf?: unknown }) {
    await this.beforeGet?.(key);
    const s = this.objects.get(key);
    if (!s) return null;
    if (!this.passes(s, options?.onlyIf)) return this.meta(key, s);
    const bytes = new TextEncoder().encode(s.body);
    const r = options?.range && !(options.range instanceof Headers) ? options.range : undefined;
    let from = 0, to = bytes.length;
    if (r?.suffix !== undefined) from = Math.max(0, bytes.length - r.suffix);
    else if (r) { from = r.offset ?? 0; to = r.length !== undefined ? Math.min(bytes.length, from + r.length) : bytes.length; }
    const selected = bytes.slice(from, to), text = new TextDecoder().decode(selected);
    return { ...this.meta(key, s), range: r, bodyUsed: false,
      body: new ReadableStream<Uint8Array>({ start(ctrl) { ctrl.enqueue(selected); ctrl.close(); } }),
      text: async () => text, json: async () => JSON.parse(text) as unknown, arrayBuffer: async () => selected.buffer };
  }
  async put(key: string, value: string, options?: { onlyIf?: unknown }) {
    await this.beforePut?.(key);
    const body = String(value);
    if (!this.passes(this.objects.get(key), options?.onlyIf)) return null;
    const s = this.record(body);
    this.objects.set(key, s); this.puts.push(key);
    return this.meta(key, s);
  }
  async delete(keys: string | string[]) { for (const key of Array.isArray(keys) ? keys : [keys]) this.objects.delete(key); }
  async list(options: { prefix?: string; cursor?: string; limit?: number } = {}) {
    const names = [...this.objects.keys()].filter(k => k.startsWith(options.prefix ?? '')).sort();
    const start = Number(options.cursor ?? 0), end = start + Math.min(options.limit ?? 1000, 1000);
    return { objects: names.slice(start, end).map(key => this.meta(key, this.objects.get(key)!)), truncated: end < names.length,
      ...(end < names.length ? { cursor: String(end) } : {}), delimitedPrefixes: [] as string[] };
  }
}

/** The product's structural bucket type for the synthetic one. */
const bucket = (r2: DayR2): R2Agg => r2 as unknown as R2Agg;

/** The ledger as the consumer writes it: one object per hour, stream and batch. */
function ledger(r2: DayR2, batch: string, decisions: DecisionRecord[], outcomes: OutcomeRecord[]): void {
  const groups = new Map<string, string[]>();
  for (const d of decisions) { const k = `${hourPrefix(TENANT, d.ts)}/decision/${ts36(d.ts)}-${ts36(d.ts)}-${batch}.ndjson`; groups.set(k, [...(groups.get(k) ?? []), JSON.stringify(d)]); }
  for (const o of outcomes) { const k = `${hourPrefix(TENANT, o.ts)}/outcome/${ts36(o.ts)}-${ts36(o.ts)}-${batch}.ndjson`; groups.set(k, [...(groups.get(k) ?? []), JSON.stringify(o)]); }
  for (const [k, lines] of groups) r2.place(k, lines.join('\n') + '\n');
}
/** Two shoppers at noon; the second clicks what she was served. */
const NOON = { decisions: [dec('v1', T12, 'a'), dec('v2', T12 + MIN, 'b')], outcomes: [click('v2', T12 + 2 * MIN, 'b')] };
/** A third shopper, delivered after the first writer has already read its view of the day. */
const LATE_NOON = { decisions: [dec('v3', T12 + 30 * MIN, 'a')], outcomes: [click('v3', T12 + 31 * MIN, 'a')] };
/** A third shopper in the following hour. */
const ONE_PM = { decisions: [dec('v3', T12 + H + 10 * MIN, 'a')], outcomes: [click('v3', T12 + H + 11 * MIN, 'a')] };

function gate() {
  let entered!: () => void, release!: () => void;
  const ready = new Promise<void>(r => { entered = r; });
  const opened = new Promise<void>(r => { release = r; });
  return { ready, release, hold: async () => { entered(); await opened; } };
}
/** Hold the FIRST read that matches, once; every later read passes. */
function holdFirstGet(r2: DayR2, match: (key: string) => boolean) {
  const g = gate();
  r2.beforeGet = async key => { if (match(key)) { r2.beforeGet = undefined; await g.hold(); } };
  return g;
}

// ─── the mounted read routes ─────────────────────────────────────────────────

const OPERATOR_SECRET = 'w33-ledger-synthetic-operator-signing-material';
type DayView = DayReport & { provenance?: unknown };
interface Reads { dayStatus: number; dayText: string; day: DayView; windowStatus: number; windowText: string; window: { slots: Record<string, { arms: unknown[]; compatibility: { status: string } }> } }

async function reads(r2: DayR2, date = DATE): Promise<Reads> {
  const env = { AUTH_MODE: 'enforced', JWT_SECRET: OPERATOR_SECRET, JWT_ISSUER: 'i', JWT_AUDIENCE: 'a',
    TENANTS: JSON.stringify({ provisioned: [TENANT], operatorGrants: { ops: [TENANT] } }),
    CACHE: { get: async () => null }, STORAGE: r2 } as unknown as Env;
  const token = await new SignJWT({ type: 'service' }).setProtectedHeader({ alg: 'HS256' }).setSubject('ops')
    .setIssuer('i').setAudience('a').setIssuedAt().setExpirationTime('5m').sign(new TextEncoder().encode(OPERATOR_SECRET));
  const app = new Hono<{ Bindings: Env }>().use('*', tenantMiddleware()).route('/v1', decisionRoutes);
  const get = (suffix: string) => app.request(`/v1/${TENANT}/learn/report${suffix}`,
    { headers: { 'X-Tenant': TENANT, Authorization: `Bearer ${token}` } }, env);
  const day = await get(`?date=${date}`), window = await get(`/window?from=${date}&to=${date}`);
  const dayText = await day.text(), windowText = await window.text();
  const parse = (text: string) => { try { return (JSON.parse(text) as { report?: unknown }).report; } catch { return undefined; } };
  return { dayStatus: day.status, dayText, day: parse(dayText) as DayView, windowStatus: window.status, windowText, window: parse(windowText) as Reads['window'] };
}
const withoutProvenance = (view: DayView) => { const { provenance: _omitted, ...rest } = view; void _omitted; return rest; };

// ─── historical day bodies ───────────────────────────────────────────────────

/** A day in the format the audited baseline c10ccff wrote: plain JSON, no summary frame, no computation/coverage/provenance. */
function preFixBody(report: DayReport): string {
  return JSON.stringify({
    tenant: report.tenant, brand: report.brand, date: report.date, builtAt: report.builtAt,
    counts: { decisions: report.counts.decisions, outcomes: report.counts.outcomes, visitors: report.counts.visitors, truncated: report.counts.truncated },
    policies: report.policies.map(({ name, policy, role, credits }) => ({ name, policy, role, credits })),
    grids: report.grids, exploration: report.exploration, holdout: report.holdout, holdoutComparison: report.holdoutComparison,
    ...(report.erasures ? { erasures: report.erasures } : {}), ...(report.hours ? { hours: report.hours } : {}),
  });
}
/** A day in the current stored format that records no provenance member. */
function unrecordedBody(report: DayReport): string {
  const copy = structuredClone(report) as DayView; delete copy.provenance;
  return canonicalReportJson(copy);
}

// =============================================================================
// unit:W33.O2 — canonical day writes are conditional
// =============================================================================

describe('unit:W33.O2', () => {
  // The overlay half of O2 ("an overlay-derived write never replaces …") is the
  // legacy W33.01 test src/learn/report.test.ts:648, which runs a custom overlay
  // and a canonical publication in both completion orders. What is specified
  // here is the canonical half: runReport (src/learn/report.ts:1351) and
  // publishAggregateDay (src/learn/hourly.ts:1884) replace the day
  // unconditionally, so the writer that read the OLDER view of the day and
  // finishes LAST wins.

  it('host: a ledger-path canonical write (runReport) that read an older ledger never replaces the newer canonical day another writer published meanwhile', async () => {
    const r2 = new DayR2();
    ledger(r2, 'first', NOON.decisions, NOON.outcomes);
    // Writer A reads its view of the day: decisions, then the outcome listing; it is held at its first outcome read.
    const held = holdFirstGet(r2, key => key.includes('/outcome/'));
    const a = runDayReport(bucket(r2), IDS, LEARN, null, NOW).then(() => 'resolved', () => 'rejected');
    await held.ready;
    // Meanwhile the ledger grows and writer B publishes the day from the newer view.
    ledger(r2, 'late', LATE_NOON.decisions, LATE_NOON.outcomes);
    const b = await runDayReport(bucket(r2), IDS, LEARN, null, NOW + MIN);
    expect(b.counts.decisions, 'fixture: B read the grown ledger').toBe(3);
    const newer = await reads(r2);
    expect(newer.day.counts.decisions, 'fixture: B published the newer canonical day').toBe(3);

    held.release(); await a;
    const after = await reads(r2);
    expect(after.day.counts.decisions, 'O2 — the stale ledger-path write (2 decisions) must not replace the newer canonical day (3 decisions)').toBe(3);
    expect(after.day.builtAt, 'O2 — the canonical day is still the one built at B\'s time').toBe(NOW + MIN);
    expect(after.dayText, 'O2 — the canonical day GET is byte-identical to what B published').toBe(newer.dayText);
    expect(after.windowText, 'O2 — and so is the window read').toBe(newer.windowText);
  });

  it('host: an aggregate-path canonical write (publishAggregateDay) that read fewer hours never replaces the newer canonical day the five-minute job published meanwhile', async () => {
    const r2 = new DayR2();
    ledger(r2, 'first', NOON.decisions, NOON.outcomes);
    await buildHour(bucket(r2), TENANT, { date: DATE, hour: 12 }, LEARN, NOW, { shards: 1 });
    // Writer A (the POST/nightly path) reads the hour aggregates and is held at its read of hour 12.
    const held = holdFirstGet(r2, key => key === `aggregates/${TENANT}/${DATE}/12.json`);
    const a = runDayReport(bucket(r2), IDS, LEARN, null, NOW).then(() => 'resolved', () => 'rejected');
    await held.ready;
    // Meanwhile hour 13 is folded and the scheduler publishes the day from both hours.
    ledger(r2, 'next', ONE_PM.decisions, ONE_PM.outcomes);
    await buildHour(bucket(r2), TENANT, { date: DATE, hour: 13 }, LEARN, NOW, { shards: 1 });
    const job = await catchUp(bucket(r2), TENANT, LEARN, NOW + MIN, { shards: 1, maxHours: 0, lookbackHours: 26 });
    expect(job.reports.published, 'fixture: the scheduler published the day').toEqual([DATE]);
    const newer = await reads(r2);
    expect(newer.day.hours?.built, 'fixture: the newer canonical day sums hours 12 and 13').toEqual([12, 13]);

    held.release(); await a;
    const after = await reads(r2);
    expect(after.day.hours?.built, 'O2 — the stale aggregate write (hour 12 only) must not replace the newer canonical day (hours 12 and 13)').toEqual([12, 13]);
    expect(after.day.counts.decisions, 'O2 — the newer day\'s three decisions stand').toBe(3);
    expect(after.dayText, 'O2 — the canonical day GET is byte-identical to what the scheduler published').toBe(newer.dayText);
    expect(after.windowText, 'O2 — and so is the window read').toBe(newer.windowText);
  });

  it('host: a ledger-path canonical write computed before the fold never replaces the aggregate-backed canonical day the fold published meanwhile', async () => {
    const r2 = new DayR2();
    ledger(r2, 'first', NOON.decisions, NOON.outcomes);
    // No aggregates yet: writer A takes the ledger path and is held at its first outcome read.
    const held = holdFirstGet(r2, key => key.includes('/outcome/'));
    const a = runDayReport(bucket(r2), IDS, LEARN, null, NOW).then(() => 'resolved', () => 'rejected');
    await held.ready;
    await buildHour(bucket(r2), TENANT, { date: DATE, hour: 12 }, LEARN, NOW, { shards: 1 });
    const job = await catchUp(bucket(r2), TENANT, LEARN, NOW + MIN, { shards: 1, maxHours: 0, lookbackHours: 26 });
    expect(job.reports.published, 'fixture: the scheduler published the day from its aggregates').toEqual([DATE]);
    const newer = await reads(r2);
    expect(newer.day.hours?.source, 'fixture: the newer canonical day is aggregate-backed').toBe('aggregates');

    held.release(); await a;
    const after = await reads(r2);
    expect(after.day.hours?.source, 'O2 (L1: the overwrite degrades `hours` to the ledger) — the stale ledger write must not replace the aggregate-backed day').toBe('aggregates');
    expect(after.dayText, 'O2 — the canonical day GET is byte-identical to what the fold published').toBe(newer.dayText);
    expect(after.windowText, 'O2 — and so is the window read').toBe(newer.windowText);
  });
});

// =============================================================================
// unit:W33.O3 — the canonical day records the policy and version identity that produced it
// =============================================================================

describe('unit:W33.O3', () => {
  const RULED = { version: 1, status: 'canonical', policies: CANONICAL_POLICIES };

  it('host: every canonical writer records its provenance on the day, and GET reads it back', async () => {
    // (a) the POST/nightly path from hour aggregates (publishAggregateDay, non-strict)
    const aggregate = new DayR2();
    ledger(aggregate, 'first', NOON.decisions, NOON.outcomes);
    await buildHour(bucket(aggregate), TENANT, { date: DATE, hour: 12 }, LEARN, NOW, { shards: 1 });
    await runDayReport(bucket(aggregate), IDS, LEARN, null, NOW);
    const a = await reads(aggregate);
    expect(a.dayStatus).toBe(200); expect(a.day.hours?.source, 'fixture: aggregate path').toBe('aggregates');
    expect(a.day.provenance, 'O3 — a day published from the hour aggregates records the canonical policy set and the provenance version').toEqual(RULED);

    // (b) the five-minute job (catchUp → publishAggregateDay, strict)
    const scheduled = new DayR2();
    ledger(scheduled, 'first', NOON.decisions, NOON.outcomes);
    await buildHour(bucket(scheduled), TENANT, { date: DATE, hour: 12 }, LEARN, NOW, { shards: 1 });
    expect((await catchUp(bucket(scheduled), TENANT, LEARN, NOW, { shards: 1, maxHours: 0, lookbackHours: 26 })).reports.published).toEqual([DATE]);
    const s = await reads(scheduled);
    expect(s.day.provenance, 'O3 — a day the scheduler publishes records the same provenance').toEqual(RULED);

    // (c) the ledger path (runReport with reporting === null) on a day with no aggregates
    const raw = new DayR2();
    ledger(raw, 'first', NOON.decisions, NOON.outcomes);
    await runDayReport(bucket(raw), IDS, LEARN, null, NOW);
    const r = await reads(raw);
    expect(r.day.hours?.source, 'fixture: ledger path').toBe('ledger');
    expect(r.day.provenance, 'O3 — a day published from the ledger records the same provenance').toEqual(RULED);
  });

  it('host: a day that records no provenance reads as unknown, never as canonical', async () => {
    const source = new DayR2();
    ledger(source, 'first', NOON.decisions, NOON.outcomes);
    await buildHour(bucket(source), TENANT, { date: DATE, hour: 12 }, LEARN, NOW, { shards: 1 });
    const report = await runDayReport(bucket(source), IDS, LEARN, null, NOW);
    for (const [label, body] of [['the c10ccff format', preFixBody(report)], ['the current format without the member', unrecordedBody(report)]] as const) {
      const r2 = source.clone(); r2.place(reportKey(TENANT, TENANT, DATE), body);
      const view = await reads(r2);
      expect(view.dayStatus, label).toBe(200);
      expect(view.day.provenance, `O3 — ${label}: absent provenance is the explicit unknown, so a historical day is never mistaken for a recorded canonical one`).toBeNull();
    }
  });
});

// =============================================================================
// unit:W33.O4 — a local repair-or-declare path for an affected canonical day
// =============================================================================

describe('unit:W33.O4', () => {
  // AFFECTED (L1): a day the pre-fix overlay write left under the canonical key.
  // Its recorded reporting policies are not the canonical preset set of its own
  // learning policy. The bodies below are exactly what that write stored: the
  // current format (canonicalReportJson of an overlay result, which the
  // unguarded runReport persisted) and the audited c10ccff format.
  // UNAFFECTED: a day the canonical writer produced, recorded or not (D1:
  // "Repair is conditional on contaminated data, not assumed").
  //
  // Not specified (the witness does not determine it): a day written by an
  // overlay whose policies equal the preset list. Its recorded policy set is
  // canonical and only its source differs from what the fold would publish.

  it('logic: the repair-or-declare path exists', () => {
    expect(typeof repairCanonicalDay, 'O4 — src/learn/hourly.ts exports repairCanonicalDay(r2, ids, learn, now)').toBe('function');
  });

  it('host: an unaffected day — recorded canonical, or historical canonical in either format — is left byte-identical with no write', async () => {
    const source = new DayR2();
    ledger(source, 'first', NOON.decisions, NOON.outcomes);
    await buildHour(bucket(source), TENANT, { date: DATE, hour: 12 }, LEARN, NOW, { shards: 1 });
    const recorded = source.clone(); await runDayReport(bucket(recorded), IDS, LEARN, null, NOW);
    const report = await runDayReport(bucket(source.clone()), IDS, LEARN, null, NOW);
    const historicalFold = source.clone(); historicalFold.place(reportKey(TENANT, TENANT, DATE), preFixBody(report));
    const unrecordedFold = source.clone(); unrecordedFold.place(reportKey(TENANT, TENANT, DATE), unrecordedBody(report));
    // A historical canonical day built from the ledger, for a date that never had aggregates.
    const rawSource = new DayR2(); ledger(rawSource, 'first', NOON.decisions, NOON.outcomes);
    const rawReport = await runDayReport(bucket(rawSource.clone()), IDS, LEARN, null, NOW);
    const historicalRaw = rawSource.clone(); historicalRaw.place(reportKey(TENANT, TENANT, DATE), preFixBody(rawReport));

    for (const [label, r2] of [['recorded canonical day', recorded], ['c10ccff fold day', historicalFold],
      ['current-format fold day without provenance', unrecordedFold], ['c10ccff ledger day', historicalRaw]] as const) {
      const before = r2.snapshot(), puts = r2.puts.length;
      const result = await repairCanonicalDay(r2, IDS, LEARN, NOW + H);
      expect(result, `O4/D1 — ${label}: not contaminated, so not repaired`).toMatchObject({ status: 'unaffected' });
      expect(r2.snapshot(), `O4/D1 — ${label}: storage unchanged`).toEqual(before);
      expect(r2.puts.length, `O4/D1 — ${label}: no write`).toBe(puts);
    }
  });

  it('host: an affected day on a date with hour aggregates is repaired to the canonical day the fold publishes, with repair provenance', async () => {
    const source = new DayR2();
    ledger(source, 'first', NOON.decisions, NOON.outcomes);
    await buildHour(bucket(source), TENANT, { date: DATE, hour: 12 }, LEARN, NOW, { shards: 1 });
    // The control: what the canonical writer publishes for this date at the repair's time.
    const control = source.clone(); await runDayReport(bucket(control), IDS, LEARN, null, NOW + H);
    const expected = await reads(control);
    // The affected day: the overlay result the unguarded writer stored under the canonical key.
    const overlay = await runReport(bucket(source.clone()), IDS, LEARN, CUSTOM, NOW);
    expect(overlay.policies.map(p => p.name), 'fixture: the overlay day carries the custom policy set').toEqual(['learning', 'custom-any-first']);
    const r2 = source.clone(); r2.place(reportKey(TENANT, TENANT, DATE), canonicalReportJson(overlay));
    expect((await reads(r2)).day.hours?.source, 'fixture (L1): the overwritten day is ledger-sourced').toBe('ledger');

    const result = await repairCanonicalDay(r2, IDS, LEARN, NOW + H);
    expect(result, 'O4 — an affected day whose sources are retained is repaired').toMatchObject({ status: 'repaired' });
    const repaired = await reads(r2);
    expect(repaired.day.hours?.source, 'O4 (L1 remedy: leave the canonical key to the fold) — the repaired day is aggregate-backed again').toBe('aggregates');
    expect(withoutProvenance(repaired.day), 'O4 — the repaired day GET answers exactly the canonical day the fold publishes').toEqual(withoutProvenance(expected.day));
    expect(repaired.window.slots, 'O4 — and the window pools the canonical numbers').toEqual(expected.window.slots);
    expect(repaired.day.provenance, 'O4 ("define safe repair/provenance") — the day records that it was repaired, under the canonical policy set')
      .toEqual({ version: 1, status: 'repaired', policies: CANONICAL_POLICIES });

    const puts = r2.puts.length, stable = r2.snapshot();
    expect(await repairCanonicalDay(r2, IDS, LEARN, NOW + 2 * H), 'O4 — a repaired day is recognized as clean on the next pass').toMatchObject({ status: 'unaffected' });
    expect(r2.puts.length).toBe(puts); expect(r2.snapshot()).toEqual(stable);
  });

  it('host: an affected historical day on a ledger-only date is repaired from the retained ledger', async () => {
    const source = new DayR2();
    ledger(source, 'first', NOON.decisions, NOON.outcomes);
    const control = source.clone(); await runDayReport(bucket(control), IDS, LEARN, null, NOW + H);
    const expected = await reads(control);
    // The empty-array overlay in the c10ccff format: only the learning policy, ledger-sourced.
    const overlay = await runReport(bucket(source.clone()), IDS, LEARN, [], NOW);
    const r2 = source.clone(); r2.place(reportKey(TENANT, TENANT, DATE), preFixBody(overlay));
    expect((await reads(r2)).day.policies.map(p => p.name), 'fixture: the overlay day carries only the learning policy').toEqual(['learning']);

    const result = await repairCanonicalDay(r2, IDS, LEARN, NOW + H);
    expect(result, 'O4 — repaired from the ledger the canonical writer reads').toMatchObject({ status: 'repaired' });
    const repaired = await reads(r2);
    expect(repaired.day.policies.map(p => p.name), 'O4 — the canonical policy set is restored').toEqual(CANONICAL_POLICIES);
    expect(withoutProvenance(repaired.day), 'O4 — the repaired day GET answers exactly the canonical ledger day').toEqual(withoutProvenance(expected.day));
    expect(repaired.day.provenance).toEqual({ version: 1, status: 'repaired', policies: CANONICAL_POLICIES });
  });

  it('host: an affected day whose sources are gone is declared: kept readable, marked with the overlay that produced it, and withheld from the window', async () => {
    // No ledger rows and no aggregates remain for the date; only the overwritten day does.
    const scratch = new DayR2(); ledger(scratch, 'first', NOON.decisions, NOON.outcomes);
    const overlay = await runReport(bucket(scratch), IDS, LEARN, CUSTOM, NOW);
    const r2 = new DayR2(); r2.place(reportKey(TENANT, TENANT, DATE), canonicalReportJson(overlay));

    const result = await repairCanonicalDay(r2, IDS, LEARN, NOW + H);
    expect(result, 'O4 — an affected day that cannot be rebuilt is declared').toMatchObject({ status: 'declared' });
    const declared = await reads(r2);
    expect(declared.dayStatus, 'O4 — the declared day stays readable: declaring is not deleting evidence').toBe(200);
    expect(declared.day.counts, 'O4 — with the numbers it held').toEqual(overlay.counts);
    expect(declared.day.provenance, 'O4 — its provenance names the policy set that actually produced it')
      .toEqual({ version: 1, status: 'declared', policies: ['learning', 'custom-any-first'] });
    expect(declared.windowStatus).toBe(200);
    expect(declared.window.slots.hero?.arms, 'N09 — the window no longer pools the overlay\'s numbers as canonical').toEqual([]);
    expect(['unknown', 'mixed'], 'N09 — the withheld slot says it is not compatible').toContain(declared.window.slots.hero?.compatibility.status);
  });
});

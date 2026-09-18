// src/measure/window.test.ts — CW34: outcomes over a window, from the day reports already built.
import { describe, it, expect, vi } from 'vitest';
import { datesBetween, windowReport, MAX_WINDOW_DAYS, WindowRangeError } from '@/measure/window';
import { attributionArm, canonicalReportJson, reportCoverage, reportKey, REPORT_LIMITS, REPORT_MEASUREMENT, ReportBudgetExceeded, ReportUnavailableError, type DayReport } from '@/learn/report';
import { buildSnapshot, DEFAULT_STATS, emptyStats, recordExposure } from '@/learn/stats';
import { Miniflare } from 'miniflare';
import { computationBasis } from '@/learn/report';
import { DEFAULT_POLICY } from '@/learn/policy';
const syntheticBasis = (slots: string[]) => computationBasis({ holdout: { share: 0, salt: '', arms: ['default'] }, slots: {} },
  [{ name: 'learning', role: 'learning', policy: DEFAULT_POLICY }], slots, { source: 'raw-day', horizonMs: null, ringCap: null });

class FakeR2 {
  store = new Map<string, string>();
  async get(key: string, options?: R2GetOptions) {
    const v = this.store.get(key); if (v === undefined) return null;
    const bytes = new TextEncoder().encode(v), range = options?.range;
    const selected = range && 'length' in range ? bytes.slice(0, range.length ?? bytes.length) : bytes;
    return { size: bytes.length, body: new ReadableStream<Uint8Array>({ start(c) { c.enqueue(selected); c.close(); } }) };
  }
  day(tenant: string, brand: string, date: string, holdout: Record<string, Array<{ arm: string; decisions: number; credited: number }>>) {
    this.store.set(reportKey(tenant, brand, date), JSON.stringify({ tenant, brand, date, computation: syntheticBasis(Object.keys(holdout)), holdout: Object.fromEntries(Object.entries(holdout).map(([s, rows]) => [s, rows.map((r) => ({ ...r, rate: r.decisions ? r.credited / r.decisions : 0 }))])) }));
  }
}

describe('datesBetween', () => {
  it('is inclusive, ordered, and refuses nonsense', () => {
    expect(datesBetween('2026-09-01', '2026-09-03')).toEqual(['2026-09-01', '2026-09-02', '2026-09-03']);
    expect(() => datesBetween('2026-09-03', '2026-09-01')).toThrow(WindowRangeError);
    expect(() => datesBetween('nope', '2026-09-01')).toThrow(WindowRangeError);
  });
  it('allows exactly 184 days and rejects larger windows without shortening them', () => {
    expect(MAX_WINDOW_DAYS).toBe(184);
    for (const [from, to, length] of [
      ['2026-07-01', '2026-09-30', 92], ['2026-01-01', '2026-06-30', 181],
      ['2024-01-01', '2024-06-30', 182], ['2026-07-01', '2026-12-31', 184],
    ] as const) {
      const days = datesBetween(from, to);
      expect(days).toHaveLength(length); expect(days[0]).toBe(from); expect(days[length - 1]).toBe(to);
      expect(days).toEqual(Array.from({ length }, (_, i) => new Date(Date.parse(from + 'T00:00:00Z') + i * 86400_000).toISOString().slice(0, 10)));
    }
    expect(() => datesBetween('2026-06-30', '2026-12-31')).toThrow(WindowRangeError);
    expect(() => datesBetween('2020-01-01', '2030-01-01')).toThrow(WindowRangeError);
  });
});

describe('windowReport', () => {
  it('W31.01 pools only matching recorded slot bases and withholds unknown mixed or unrepresented contributions', async () => {
    const r2 = new FakeR2(), ids = { tenant: 'coach', brand: 'coach', from: '2026-09-01', to: '2026-09-02' };
    const rows = { hero: [{ arm: 'personalized', decisions: 1, credited: 3 }], stable: [{ arm: 'default', decisions: 0, credited: 2 }] };
    const reset = () => { for (const date of [ids.from, ids.to]) r2.day(ids.tenant, ids.brand, date, rows); };
    reset(); const key = reportKey(ids.tenant, ids.brand, ids.to), original = r2.store.get(key)!;
    const good = await windowReport(r2, ids);
    expect(good.slots.hero!.arms[0]).toMatchObject({ decisions: 2, credited: 6 });
    expect(good.slots.stable!.arms[0]!.creditedPerDecision).toBeNull();
    expect(good.compatibility.experimental).toBe('unverified');
    for (const field of ['reward', 'objective', 'tauLearnMs', 'policy', 'profile', 'absent', 'malformed', 'empty', 'missing'] as const) {
      const report = JSON.parse(original);
      const config = report.computation.slots.find((s: { slot: string }) => s.slot === 'hero');
      if (field === 'reward') config.reward = 'purchase';
      if (field === 'objective') config.objective = 'revenue';
      if (field === 'tauLearnMs') config.tauLearnMs += 1;
      if (field === 'policy') report.computation.policies[0].policy.credit = 'first';
      if (field === 'profile') report.computation.profile = { source: 'hourly-ring', horizonMs: 0, ringCap: 200 };
      if (field === 'absent') delete report.computation;
      if (field === 'malformed') report.computation.version = 99;
      if (field === 'empty') report.holdout.hero = [];
      if (field === 'missing') delete report.holdout.hero;
      r2.store.set(key, JSON.stringify(report));
      const get = vi.spyOn(r2, 'get'), w = await windowReport(r2, ids);
      expect(get).toHaveBeenCalledTimes(2); get.mockRestore();
      expect(w.days).toEqual([ids.from, ids.to]); expect(w.missing).toEqual([]);
      expect(w.slots.hero!.arms).toEqual([]);
      expect(w.slots.hero!.compatibility).toMatchObject({ status: ['absent', 'malformed', 'empty', 'missing'].includes(field) ? 'unknown' : 'mixed', days: [ids.from, ids.to] });
      if (['reward', 'objective', 'tauLearnMs', 'empty', 'missing'].includes(field)) expect(w.slots.stable!.arms[0]!.credited).toBe(4);
      expect(w.coverage.maturity).toBe('unknown'); expect(r2.store.get(key)).toBe(JSON.stringify(report));
    }
    reset(); const reversed = JSON.parse(original);
    reversed.computation.policies[0].policy.windowsMs = Object.fromEntries(Object.entries(reversed.computation.policies[0].policy.windowsMs).reverse());
    reversed.computation.slots.reverse(); r2.store.set(key, JSON.stringify(reversed));
    expect(await windowReport(r2, ids)).toEqual(good);
    for (const absent of [false, true]) for (const reverse of [false, true]) {
      reset(); const changed = JSON.parse(original);
      changed.computation.slots.find((s: { slot: string }) => s.slot === 'hero').objective = 'revenue';
      if (absent) delete changed.holdout.hero; else changed.holdout.hero = [];
      const date = reverse ? ids.from : ids.to;
      r2.store.set(reportKey(ids.tenant, ids.brand, date), JSON.stringify({ ...changed, date }));
      const w = await windowReport(r2, ids);
      expect(w.slots.hero).toMatchObject({ arms: [], compatibility: { status: 'mixed', reasons: ['mixed_basis', 'unrepresented_counts'], days: [ids.from, ids.to] } });
    }
    process.stdout.write('W31.01 counts ' + JSON.stringify({ compatible: { decisions: 2, credited: 6 }, mixed_unknown_or_unrepresented_pooled_rows: 0, reads_per_two_days: 2 }) + '\n');
  });
  it('W32.04 reads consistent bounded prefixes across 28, 92 and 184 days with coherent legacy fallback and actual R2 ranges', async () => {
    const start = Date.UTC(2026, 6, 1), encoder = new TextEncoder(), st = emptyStats();
    for (let i = 0; i < 1000; i++) recordExposure(st, 'item' + i, { channel: 'direct', visit_bucket: '1', region: null, affinity: null }, start, DEFAULT_STATS);
    const grid = buildSnapshot(st, { tenant: 'coach', brand: 'coach', slot: 'hero' }, 'click', start, DEFAULT_STATS);
    const dayOf = (date: string): DayReport => {
      const index = Math.round((Date.parse(date + 'T00:00:00Z') - start) / 86400_000);
      const counts = { decisions: 1, outcomes: 3, visitors: 1, truncated: index % 7 === 0 };
      const hours = { source: 'aggregates' as const, built: [0], missing: index % 3 === 0 ? [1] : [], horizonMs: 3600_000 };
      const computation = { ...syntheticBasis(['hero']), profile: { source: 'hourly-ring' as const, horizonMs: hours.horizonMs, ringCap: 200 } };
      return { tenant: 'coach', brand: 'coach', date, builtAt: start + index * 86400_000, counts, computation, policies: [], grids: { hero: { learning: grid } }, exploration: [],
        holdout: { hero: [attributionArm('personalized', 1, 3)] }, holdoutComparison: { hero: [] }, measurement: REPORT_MEASUREMENT, hours,
        coverage: reportCoverage({ counts, hours }, { version: 1, source: 'aggregates', truncated: counts.truncated, visitorsIncomplete: false,
          missingHours: hours.missing, truncatedHours: counts.truncated ? [0] : [], unadvancedHours: index % 3 === 1 ? [0] : [], unknownHours: [], horizons: [{ hour: 0, horizonMs: hours.horizonMs }] }) };
    };
    const resultOf = (text: string, options?: R2GetOptions) => {
      const bytes = encoder.encode(text), length = options?.range && 'length' in options.range ? options.range.length ?? bytes.length : bytes.length;
      return { size: bytes.length, body: new ReadableStream<Uint8Array>({ start(c) { c.enqueue(bytes.slice(0, length)); c.close(); } }) };
    };
    const measurements = [];
    for (const length of [28, 92, 184]) {
      const ids = { tenant: 'coach', brand: 'coach', from: '2026-07-01', to: new Date(start + (length - 1) * 86400_000).toISOString().slice(0, 10) };
      let fullBytes = 0, deliveredBytes = 0;
      const get = vi.fn(async (key: string, options?: R2GetOptions) => {
        const body = canonicalReportJson(dayOf(key.slice(-15, -5))), size = encoder.encode(body).length;
        fullBytes += size; deliveredBytes += Math.min(size, REPORT_LIMITS.summaryBytes);
        expect(options).toEqual({ range: { offset: 0, length: REPORT_LIMITS.summaryBytes } }); return resultOf(body, options);
      });
      const actual = await windowReport({ get }, ids);
      // Independent reference comes from original full fields, not the embedded summary.
      // Remove only unused grids to keep the legacy reference within its admitted byte budget.
      const reference = await windowReport({ get: async (key, options) => resultOf(JSON.stringify({ ...dayOf(key.slice(-15, -5)), grids: {} }), options) }, ids);
      expect(actual).toEqual(reference); expect(actual.days).toHaveLength(length); expect(get).toHaveBeenCalledTimes(length);
      expect(actual.slots.hero!.arms[0]).toMatchObject({ decisions: length, credited: 3 * length });
      expect(deliveredBytes).toBe(length * REPORT_LIMITS.summaryBytes); expect(fullBytes).toBeGreaterThan(deliveredBytes * 5);
      measurements.push({ days: length, requests: get.mock.calls.length, full_canonical_bytes: fullBytes, delivered_and_charged_prefix_bytes: deliveredBytes,
        parity: 'exact window vs independent legacy full-field projection without unused grids' });
    }
    process.stdout.write('W32.04 byte_measurement ' + JSON.stringify(measurements) + '\n');
    const ids = { tenant: 'coach', brand: 'coach', from: '2026-07-01', to: '2026-07-01' }, full = canonicalReportJson(dayOf(ids.from));
    const line = full.slice(0, full.indexOf('\n') + 1), lineBytes = encoder.encode(line);
    const cut = new Uint8Array(REPORT_LIMITS.summaryBytes); cut.set(lineBytes); cut.fill(120, lineBytes.length); cut[cut.length - 1] = 0xc3;
    expect((await windowReport({ get: async () => ({ size: cut.length + 1, body: new ReadableStream<Uint8Array>({ start(c) { c.enqueue(cut); c.close(); } }) }) }, ids)).slots.hero!.arms[0]!.credited).toBe(3);
    for (const bad of [line.replace('"version":1', '"version":2'), line.replace('"tenant":"coach"', '"tenant":"wrong"'),
      line.replace(',\n', '\n'), '{"_summary":' + 'x'.repeat(REPORT_LIMITS.summaryBytes), '{"_summary":\xff,\n']) {
      const get = vi.fn(async (_key: string, options?: R2GetOptions) => resultOf(bad, options));
      await expect(windowReport({ get }, ids)).rejects.toThrow(); expect(get).toHaveBeenCalledTimes(1);
    }
    const legacyPrefix = '{"tenant":"discard-me","holdout":{}}' + ' '.repeat(REPORT_LIMITS.summaryBytes);
    const current = { ...dayOf(ids.from), grids: {}, holdout: { hero: [attributionArm('personalized', 1, 7)] } };
    let reads = 0;
    const replacement = await windowReport({ get: async (_key, options) => ++reads === 1 ? resultOf(legacyPrefix, options) : resultOf(JSON.stringify(current)) }, ids);
    expect(reads).toBe(2); expect(replacement.slots.hero!.arms[0]!.credited).toBe(7);
    reads = 0;
    await expect(windowReport({ get: async (_key, options) => ++reads === 1 ? resultOf(legacyPrefix, options) : null }, ids)).rejects.toBeInstanceOf(ReportUnavailableError);
    expect(reads).toBe(2);
    for (const invalid of [full.replace(',\n', ','), line.slice(0, -2) + ' '.repeat(REPORT_LIMITS.summaryBytes) + ',\n' + full.slice(full.indexOf('\n') + 1)]) {
      reads = 0;
      await expect(windowReport({ get: async (_key, options) => ++reads === 1 ? resultOf(legacyPrefix, options) : resultOf(invalid) }, ids)).rejects.toThrow();
      expect(reads).toBe(2);
    }
    const runtime = new Miniflare({ cf: false, modules: true, script: 'export default { fetch() { return new Response("synthetic"); } };',
      compatibilityDate: '2025-06-01', r2Buckets: ['REPORTS'], outboundService() { throw new Error('No external network in W32.04'); } });
    try {
      const native = await runtime.getR2Bucket('REPORTS'), key = reportKey('coach', 'coach', ids.from);
      await native.put(key, full);
      const ranged = await native.get(key, { range: { offset: 0, length: REPORT_LIMITS.summaryBytes } });
      expect(ranged!.size).toBe(encoder.encode(full).length); expect((await ranged!.arrayBuffer()).byteLength).toBe(REPORT_LIMITS.summaryBytes);
      expect(await windowReport(native as unknown as Parameters<typeof windowReport>[0], ids)).toEqual(await windowReport({ get: async (_key, options) => resultOf(JSON.stringify({ ...dayOf(ids.from), grids: {} }), options) }, ids));
    } finally { await runtime.dispose(); }
  }, 30_000);
  it('W32.03 bounds cumulative saved bytes and pooled cardinality without hiding missing or failed days', async () => {
    const ids = { tenant: 'coach', brand: 'coach', from: '2026-09-01', to: '2026-09-02' };
    const text = vi.fn(async () => '');
    const get = vi.fn(async (key: string, options?: R2GetOptions) => {
      const date = key.slice(-15, -5), base = JSON.stringify({ tenant: 'coach', brand: 'coach', date, holdout: {}, padding: '' });
      const size = REPORT_LIMITS.savedBytes - REPORT_LIMITS.summaryBytes;
      const body = base.slice(0, -2) + 'x'.repeat(size - base.length) + base.slice(-2);
      return { size, text: () => { text(); return Promise.resolve(options?.range ? body.slice(0, REPORT_LIMITS.summaryBytes) : body); } };
    });
    expect((await windowReport({ get }, ids)).days).toHaveLength(2);
    expect(text).toHaveBeenCalledTimes(4); get.mockClear(); text.mockClear();
    await expect(windowReport({ get }, { ...ids, to: '2026-09-04' })).rejects.toMatchObject({ budget: 'windowBytes', limit: REPORT_LIMITS.windowBytes });
    expect(get).toHaveBeenCalledTimes(5); expect(text).toHaveBeenCalledTimes(5);
    const r2 = new FakeR2(), rows = Array.from({ length: REPORT_LIMITS.cells - 3 }, () => ({ arm: 'personalized', decisions: 1, credited: 3 }));
    r2.day('coach', 'coach', ids.from, { hero: rows });
    const exact = await windowReport(r2, ids);
    expect(exact.slots.hero!.arms[0]).toMatchObject({ decisions: rows.length, credited: rows.length * 3 });
    expect(exact.missing).toEqual([ids.to]); expect(exact.coverage).toMatchObject({ maturity: 'unknown', minHorizonMs: null });
    r2.day('coach', 'coach', ids.from, { hero: [...rows, rows[0]!] });
    await expect(windowReport(r2, ids)).rejects.toBeInstanceOf(ReportBudgetExceeded);
    for (const value of [undefined, { size: 1, text: async () => '{' }, { json: async () => ({ holdout: {} }) }]) {
      const get = vi.fn(async () => value);
      await expect(windowReport({ get }, ids)).rejects.toBeInstanceOf(ReportUnavailableError);
      expect(get).toHaveBeenCalledTimes(1);
    }
    r2.day('coach', 'coach', ids.from, { hero: [{ arm: 'a', decisions: Number.MAX_VALUE, credited: 0 }] });
    r2.day('coach', 'coach', ids.to, { hero: [{ arm: 'a', decisions: Number.MAX_VALUE, credited: 0 }] });
    await expect(windowReport(r2, ids)).rejects.toBeInstanceOf(ReportUnavailableError);
    r2.day('coach', 'coach', ids.from, { hero: [{ arm: 'a', decisions: 0, credited: Number.MAX_VALUE }] });
    r2.day('coach', 'coach', ids.to, { hero: [{ arm: 'a', decisions: 1e-308, credited: 0 }] });
    await expect(windowReport(r2, ids)).rejects.toBeInstanceOf(ReportUnavailableError);
  });
  it('pools the arms across the days that have a report and names the days that do not', async () => {
    const r2 = new FakeR2();
    r2.day('coach', 'coach', '2026-09-01', { chero: [{ arm: 'default', decisions: 100, credited: 3 }, { arm: 'personalized', decisions: 1900, credited: 76 }] });
    r2.day('coach', 'coach', '2026-09-03', { chero: [{ arm: 'default', decisions: 120, credited: 4 }, { arm: 'personalized', decisions: 2100, credited: 90 }], story: [{ arm: 'personalized', decisions: 50, credited: 2 }] });
    const w = await windowReport(r2, { tenant: 'coach', brand: 'coach', from: '2026-09-01', to: '2026-09-03' });
    expect(w.days).toEqual(['2026-09-01', '2026-09-03']);
    expect(w.missing).toEqual(['2026-09-02']);
    const chero = w.slots.chero;
    expect(chero.arms.find((a) => a.arm === 'default')).toMatchObject({ n: 220, s: 7 });
    expect(chero.arms.find((a) => a.arm === 'personalized')).toMatchObject({ n: 4000, s: 166 });
    expect(chero.arms.find((a) => a.arm === 'personalized')!.creditedPerDecision).toBe(166 / 4000);
    expect(chero.comparisons).toEqual([]);
    // No inferred comparisons are available, including a slot with one arm.
    expect(w.slots.story.comparisons).toEqual([]);
  });

  it('preserves repeated credits and zero-denominator counts without probability clamping', async () => {
    const r2 = new FakeR2();
    r2.day('coach', 'coach', '2026-09-01', { chero: [{ arm: 'default', decisions: 0, credited: 2 }, { arm: 'personalized', decisions: 1, credited: 3 }] });
    const w = await windowReport(r2, { tenant: 'coach', brand: 'coach', from: '2026-09-01', to: '2026-09-01' });
    expect(w.measurement.inference).toBe('unavailable');
    expect(w.slots.chero.arms.map((arm) => [arm.decisions, arm.credited, arm.creditedPerDecision])).toEqual([[0, 2, null], [1, 3, 3]]);
    expect(w.slots.chero.comparisons).toEqual([]);
  });

  it('is empty, not wrong, when no day has a report', async () => {
    const w = await windowReport(new FakeR2(), { tenant: 'coach', brand: 'coach', from: '2026-09-01', to: '2026-09-02' });
    expect(w.days).toEqual([]);
    expect(w.missing).toHaveLength(2);
    expect(w.slots).toEqual({});
  });
});

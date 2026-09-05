// src/measure/window.test.ts — CW34: outcomes over a window, from the day reports already built.
import { describe, it, expect } from 'vitest';
import { datesBetween, windowReport, MAX_WINDOW_DAYS } from '@/measure/window';
import { reportKey } from '@/learn/report';

class FakeR2 {
  store = new Map<string, string>();
  async get(key: string) { const v = this.store.get(key); return v === undefined ? null : { json: async () => JSON.parse(v) }; }
  day(tenant: string, brand: string, date: string, holdout: Record<string, Array<{ arm: string; decisions: number; credited: number }>>) {
    this.store.set(reportKey(tenant, brand, date), JSON.stringify({ tenant, brand, date, holdout: Object.fromEntries(Object.entries(holdout).map(([s, rows]) => [s, rows.map((r) => ({ ...r, rate: r.decisions ? r.credited / r.decisions : 0 }))])) }));
  }
}

describe('datesBetween', () => {
  it('is inclusive, ordered, and refuses nonsense', () => {
    expect(datesBetween('2026-09-01', '2026-09-03')).toEqual(['2026-09-01', '2026-09-02', '2026-09-03']);
    expect(datesBetween('2026-09-03', '2026-09-01')).toEqual([]);
    expect(datesBetween('nope', '2026-09-01')).toEqual([]);
  });
  it('caps a window so a typo cannot ask for a decade', () => {
    expect(datesBetween('2020-01-01', '2030-01-01')).toHaveLength(MAX_WINDOW_DAYS);
  });
});

describe('windowReport', () => {
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
    expect(chero.comparisons).toHaveLength(1);
    expect(chero.comparisons[0].control.arm).toBe('default');
    expect(chero.comparisons[0].treatment.n).toBe(4000);
    expect(chero.comparisons[0].words).toContain('personalized 4.2% of 4,000 decisions vs default 3.2% of 220');
    // A slot with no personalized arm has nothing to compare against.
    expect(w.slots.story.comparisons).toEqual([]);
  });

  it('compares at the confidence asked for, and carries it on the report', async () => {
    const r2 = new FakeR2();
    r2.day('coach', 'coach', '2026-09-01', { chero: [{ arm: 'default', decisions: 300, credited: 9 }, { arm: 'personalized', decisions: 300, credited: 19 }] });
    const w = await windowReport(r2, { tenant: 'coach', brand: 'coach', from: '2026-09-01', to: '2026-09-01' }, { confidence: 0.9 });
    expect(w.confidence).toBe(0.9);
    expect(w.slots.chero.comparisons[0].confidence).toBe(0.9);
    expect(w.slots.chero.comparisons[0].verdict).toBe('treatment_better');
  });

  it('is empty, not wrong, when no day has a report', async () => {
    const w = await windowReport(new FakeR2(), { tenant: 'coach', brand: 'coach', from: '2026-09-01', to: '2026-09-02' });
    expect(w.days).toEqual([]);
    expect(w.missing).toHaveLength(2);
    expect(w.slots).toEqual({});
  });
});

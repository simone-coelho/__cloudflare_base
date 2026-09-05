// src/measure/window.ts
// ---------------------------------------------------------------------------
// CW34: aggregate outcomes over a window, not a point in time.
//
// Tapestry's measurement chapter (BTIE §6.4.3) says why: an adaptive system
// learns, so a snapshot in week two understates it and one in week four may
// overstate it; the number that means anything is cumulative over a window
// the reader chose in advance. The day reports already exist, one per brand
// and day, built from the ledger. This pools their arm counts across the
// window and compares the pooled arms, at the confidence asked for, against
// the pre-set targets. Nothing is recomputed from the ledger; a day that has
// no report yet is named as missing rather than silently treated as zero.
// ---------------------------------------------------------------------------

import { reportKey, type DayReport } from '@/learn/report';
import { compareArms, pooled, wilson, zFor, type ArmComparison, type ArmCount, type CompareOptions } from '@/measure/holdout';

export interface R2ReportReader { get(key: string): Promise<{ json(): Promise<unknown> } | null> }

export const MAX_WINDOW_DAYS = 92;

export interface WindowReport {
  tenant: string;
  brand: string;
  from: string;
  to: string;
  /** Days whose report was found and pooled, in order. */
  days: string[];
  /** Days in the window with no report built. */
  missing: string[];
  confidence: number;
  slots: Record<string, {
    arms: Array<ArmCount & { arm: string; rate: { p: number; lo: number; hi: number } }>;
    comparisons: ArmComparison[];
  }>;
}

/** Every date from `from` to `to` inclusive, ISO, capped so a typo cannot ask for a decade. */
export function datesBetween(from: string, to: string): string[] {
  const a = Date.parse(from + 'T00:00:00Z');
  const b = Date.parse(to + 'T00:00:00Z');
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return [];
  const out: string[] = [];
  for (let t = a; t <= b && out.length < MAX_WINDOW_DAYS; t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

export async function windowReport(
  r2: R2ReportReader,
  ids: { tenant: string; brand: string; from: string; to: string },
  options: CompareOptions = {},
): Promise<WindowReport> {
  const confidence = options.confidence ?? 0.95;
  const z = zFor(confidence);
  const dates = datesBetween(ids.from, ids.to);
  const days: string[] = [];
  const missing: string[] = [];
  const counts = new Map<string, Map<string, ArmCount[]>>();   // slot → arm → per-day counts

  for (const date of dates) {
    let report: DayReport | null = null;
    try { const obj = await r2.get(reportKey(ids.tenant, ids.brand, date)); report = obj ? ((await obj.json()) as DayReport) : null; } catch { report = null; }
    if (!report || !report.holdout) { missing.push(date); continue; }
    days.push(date);
    for (const [slot, rows] of Object.entries(report.holdout)) {
      const bySlot = counts.get(slot) ?? new Map<string, ArmCount[]>();
      for (const r of rows) {
        const list = bySlot.get(r.arm) ?? [];
        list.push({ n: r.decisions, s: r.credited });
        bySlot.set(r.arm, list);
      }
      counts.set(slot, bySlot);
    }
  }

  const slots: WindowReport['slots'] = {};
  for (const [slot, bySlot] of counts) {
    const arms = [...bySlot.entries()].map(([arm, rows]) => { const p = pooled(rows); return { arm, ...p, rate: wilson(p.s, p.n, z) }; }).sort((a, b) => a.arm.localeCompare(b.arm));
    const treated = arms.find((a) => a.arm === 'personalized');
    const comparisons = treated
      ? arms.filter((a) => a.arm !== 'personalized').map((a) => compareArms({ arm: a.arm, n: a.n, s: a.s }, { arm: 'personalized', n: treated.n, s: treated.s }, { ...options, confidence }))
      : [];
    slots[slot] = { arms, comparisons };
  }
  return { tenant: ids.tenant, brand: ids.brand, from: ids.from, to: ids.to, days, missing, confidence, slots };
}

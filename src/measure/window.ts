// Pool raw attribution counts from saved day reports. Experimental inference
// requires enrollment, control, outcome and analysis contracts outside this report.
import { attributionArm, readWindowSummary, reportCoverage, reportPayloadJson, REPORT_LIMITS, ReportBudgetExceeded, ReportUnavailableError, REPORT_MEASUREMENT, type ArmRow, type ReportCoverage, type SavedReportReader } from '@/learn/report';
import { recordedComputation, slotComputation, type DayReport } from '@/learn/report';

export type R2ReportReader = SavedReportReader;

export const MAX_WINDOW_DAYS = 184; // Longest six consecutive full calendar months, inclusive.

export interface WindowReport {
  tenant: string;
  brand: string;
  from: string;
  to: string;
  /** Found reports, including days whose incompatible/unknown counts were withheld. */
  days: string[];
  missing: string[];
  /** Known incomplete sources. Absence of a warning does not establish maturity or policy compatibility. */
  incomplete: Array<{ date: string; truncated: boolean; missingHours: number[] }>;
  coverage: { version: 1; status: 'incomplete' | 'unknown'; maturity: 'unknown'; minHorizonMs: number | null; days: Array<{ date: string; coverage: ReportCoverage }> };
  measurement: typeof REPORT_MEASUREMENT;
  compatibility: { version: 1; experimental: 'unverified' };
  sourceCounts: Array<{ date: string; counts: DayReport['counts'] | null }>;
  slots: Record<string, {
    /** n/s are compatibility aliases for decisions/credited, not Bernoulli trials/successes. */
    arms: Array<ArmRow & { n: number; s: number }>;
    comparisons: never[];
    compatibility: { status: 'compatible' | 'unknown' | 'mixed'; reasons: Array<'unknown_basis' | 'mixed_basis' | 'unrepresented_counts'>; days: string[] };
  }>;
}

export class WindowRangeError extends Error {}

/** Validate the entire inclusive range before any storage read; never silently shorten it. */
export function datesBetween(from: string, to: string): string[] {
  const parse = (date: string): number => {
    const value = /^\d{4}-\d{2}-\d{2}$/.test(date) ? Date.parse(date + 'T00:00:00Z') : NaN;
    if (!Number.isFinite(value) || new Date(value).toISOString().slice(0, 10) !== date) {
      throw new WindowRangeError('from and to must be real dates in YYYY-MM-DD format');
    }
    return value;
  };
  const a = parse(from), b = parse(to);
  if (b < a) throw new WindowRangeError('to must be on or after from');
  const length = (b - a) / 86_400_000 + 1;
  if (length > MAX_WINDOW_DAYS) throw new WindowRangeError(`window must be at most ${MAX_WINDOW_DAYS} days inclusive`);
  return Array.from({ length }, (_, index) => new Date(a + index * 86_400_000).toISOString().slice(0, 10));
}

export async function windowReport(
  r2: R2ReportReader,
  ids: { tenant: string; brand: string; from: string; to: string },
): Promise<WindowReport> {
  const dates = datesBetween(ids.from, ids.to);
  const days: string[] = [], missing: string[] = [];
  const incomplete: WindowReport['incomplete'] = [];
  const coverageDays: WindowReport['coverage']['days'] = [];
  const counts = new Map<string, Map<string, { decisions: number; credited: number }>>();
  const compatibility = new Map<string, WindowReport['slots'][string]['compatibility']>();
  const identities = new Map<string, string>();
  const sourceCounts: WindowReport['sourceCounts'] = [];
  const budget = { bytes: 0, cells: 0 };
  const pooled = () => { if (++budget.cells > REPORT_LIMITS.cells) throw new ReportBudgetExceeded('cells', REPORT_LIMITS.cells, budget.cells); };

  for (const date of dates) {
    const report = await readWindowSummary(r2, { ...ids, date }, budget);
    if (report === null) { missing.push(date); continue; }
    days.push(date);
    sourceCounts.push({ date, counts: report.counts ?? null });
    const coverage = reportCoverage(report);
    coverageDays.push({ date, coverage });
    const { truncated, missingHours } = coverage;
    if (coverage.status === 'incomplete') incomplete.push({ date, truncated, missingHours: [...missingHours] });
    const basis = recordedComputation(report.computation);
    for (const slot of new Set([...Object.keys(report.holdout), ...(basis?.slots.map(s => s.slot) ?? [])])) {
      const rows = report.holdout[slot];
      const info: WindowReport['slots'][string]['compatibility'] = compatibility.get(slot) ?? { status: 'compatible', reasons: [], days: [] };
      const identity = slotComputation(basis, slot);
      const addReason = (reason: typeof info.reasons[number]) => { if (!info.reasons.includes(reason)) info.reasons.push(reason); };
      if (!identity) addReason('unknown_basis');
      if (!rows?.length) addReason('unrepresented_counts');
      if (identity && identities.has(slot) && identities.get(slot) !== identity) addReason('mixed_basis');
      info.reasons.sort();
      if (identity) identities.set(slot, identities.get(slot) ?? identity);
      info.status = info.reasons.includes('mixed_basis') ? 'mixed' : info.reasons.length ? 'unknown' : 'compatible';
      info.days.push(date); compatibility.set(slot, info);
      if (!counts.has(slot)) pooled();
      const bySlot = counts.get(slot) ?? new Map<string, { decisions: number; credited: number }>();
      if (info.status !== 'compatible') { bySlot.clear(); counts.set(slot, bySlot); continue; }
      for (const row of rows ?? []) {
        if (!bySlot.has(row.arm)) pooled();
        const total = bySlot.get(row.arm) ?? { decisions: 0, credited: 0 };
        total.decisions += row.decisions;
        total.credited += row.credited;
        if (!Number.isFinite(total.decisions) || !Number.isFinite(total.credited)
          || (total.decisions > 0 && !Number.isFinite(total.credited / total.decisions))) throw new ReportUnavailableError();
        bySlot.set(row.arm, total);
      }
      counts.set(slot, bySlot);
    }
  }

  const slots: WindowReport['slots'] = {};
  for (const [slot, bySlot] of counts) {
    const arms = [...bySlot.entries()].map(([arm, total]) => ({
      ...attributionArm(arm, total.decisions, total.credited), n: total.decisions, s: total.credited,
    })).sort((a, b) => a.arm.localeCompare(b.arm));
    const info = compatibility.get(slot)!;
    slots[slot] = { arms: info.status === 'compatible' ? arms : [], comparisons: [], compatibility: info };
  }
  const report: WindowReport = { ...ids, days, missing, incomplete, measurement: REPORT_MEASUREMENT, slots,
    compatibility: { version: 1, experimental: 'unverified' }, sourceCounts,
    coverage: { version: 1, status: missing.length || incomplete.length ? 'incomplete' : 'unknown', maturity: 'unknown', days: coverageDays,
      minHorizonMs: !missing.length && coverageDays.length && coverageDays.every(d => d.coverage.minHorizonMs !== null)
        ? Math.min(...coverageDays.map(d => d.coverage.minHorizonMs!)) : null },
  };
  reportPayloadJson(report); return report;
}

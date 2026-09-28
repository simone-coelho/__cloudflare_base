// Pool raw attribution counts from saved day reports. Experimental inference
// requires enrollment, control, outcome and analysis contracts outside this report.
import { attributionArm, readWindowSummary, reportCoverage, reportPayloadJson, validAllocation, validArmVisitors, REPORT_LIMITS, ReportBudgetExceeded, ReportUnavailableError, REPORT_MEASUREMENT, type ArmRow, type ArmVisitors, type ReportAllocation, type ReportCoverage, type SavedReportReader } from '@/learn/report';
import { effectiveReportPolicy, recordedComputation, slotComputation, validProvenance, type ComputationBasis, type DayReport } from '@/learn/report';
import type { AttributionPolicy } from '@/learn/policy';
import { validAttributionContract } from '@/learn/route';
import type { AttributionContract } from '@/learn/stats';

export type R2ReportReader = SavedReportReader;

export const MAX_WINDOW_DAYS = 184; // Longest six consecutive full calendar months, inclusive.

/**
 * W31 M1.01: the recorded computation one slot pooled under, as members rather
 * than as the opaque identity `slotComputation` compares. Both are read from the
 * same recorded `ComputationBasis`, so the members an operator reads and the key
 * the window pools by cannot describe different things.
 */
export interface WindowSlotComputation {
  version: ComputationBasis['version'];
  profile: ComputationBasis['profile'];
  /** The attribution policy the pooled days were credited under, as the basis records it. */
  learning: AttributionPolicy;
  reward: ComputationBasis['slots'][number]['reward'];
  objective: ComputationBasis['slots'][number]['objective'];
  tauLearnMs: number;
  measurementBasis: 'served-v1' | 'rendered-v1';
}
function slotComputationMembers(basis: ComputationBasis | null, slot: string): WindowSlotComputation | null {
  const config = basis?.slots.find(s => s.slot === slot), learning = basis?.policies.find(p => p.role === 'learning');
  if (!basis || !config || !learning) return null;
  return { version: basis.version, profile: { ...basis.profile }, learning: effectiveReportPolicy(learning.policy),
    reward: config.reward, objective: config.objective, tauLearnMs: config.tauLearnMs,
    measurementBasis: config.measurementBasis ?? 'served-v1' };
}
/**
 * Two recorded allocations agree when they hold out the same share of traffic to
 * the same set of arms. The order the tenant listed those arms in is not part of
 * what was allocated, so it never turns an unchanged experiment into a mixed one.
 */
const allocationKey = (allocation: ReportAllocation): string =>
  JSON.stringify([allocation.version, allocation.source, allocation.share, [...allocation.arms].sort()]);
/** Every mixed reason makes the slot mixed: a disagreement is never reported as merely unknown. */
const MIXED_REASONS = ['mixed_basis', 'mixed_allocation'] as const;
const mixedStatus = (reasons: readonly string[]): boolean => MIXED_REASONS.some(reason => reasons.includes(reason));

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
  /**
   * W21 C1.03: per-arm VISITOR-DAYS over the window — the per-day distinct
   * counts summed, which is why the basis is not called "visitors". Null when
   * any pooled day was written before the field existed: a missing denominator
   * is never replaced by a smaller one.
   */
  armVisitors: ArmVisitors | null;
  /**
   * W31 M1.01 (F25 §1.3, §5.7): the published allocation every pooled day agrees
   * on, so sample sufficiency is computable on the customer's side instead of
   * being read here from a fixed confidence and an assumption of equal arms.
   * Null when two pooled days disagree — that is a mixed basis, reported per slot
   * as `mixed_allocation` — and null when any pooled day carries none: absence is
   * an unknown, never a guess and never a disagreement (R149).
   */
  allocation: ReportAllocation | null;
  /**
   * W22 A1.01: the one named attribution contract this window pooled under.
   * `windowsMs` is what every pooled day was asked for; `appliedWindowsMs` is
   * the LEAST any of them actually applied, because a pooled number can claim
   * only the shortest reach that went into it. Null when no pooled day carries
   * a contract, and the days that disagree on its version are not pooled at
   * all — each such slot is reported `mixed_basis` instead.
   */
  attributionContract?: AttributionContract;
  slots: Record<string, {
    /** n/s are compatibility aliases for decisions/credited, not Bernoulli trials/successes. */
    arms: Array<ArmRow & { n: number; s: number }>;
    comparisons: never[];
    /**
     * W33 O4: `declared_day` — a pooled day is a declared day (`provenance.status:
     * 'declared'`): its numbers were computed under a custom overlay and could not
     * be rebuilt, so they are shown on the day and never pooled here as canonical.
     */
    compatibility: { status: 'compatible' | 'unknown' | 'mixed'; reasons: Array<'unknown_basis' | 'mixed_basis' | 'mixed_allocation' | 'unrepresented_counts' | 'declared_day'>; days: string[] };
    /**
     * W31 M1.01: the one recorded computation this slot pooled under, stated
     * rather than assumed. Null where the slot is not compatible, because an
     * incompatible slot pooled under no single computation.
     */
    computation: WindowSlotComputation | null;
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
  const slotComputations = new Map<string, WindowSlotComputation>();
  const sourceCounts: WindowReport['sourceCounts'] = [];
  // W31 M1.01: the published allocation each pooled day was served under.
  let allocation: ReportAllocation | undefined;
  let allocationMixed = false, allocationUnknown = false;
  // W21 C1.03: visitor-days per arm, and whether every day could supply them.
  const visitorDays = new Map<string, number>();
  let armVisitorsKnown = true;
  // W22 A1.01: the contract each pooled day was written under.
  let contract: AttributionContract | undefined;
  let contractMixed = false;
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
    const dayVisitors = validArmVisitors(report.armVisitors, 'distinct_visitors');
    if (!dayVisitors) armVisitorsKnown = false;
    else for (const row of dayVisitors.arms) {
      if (!visitorDays.has(row.arm)) pooled();
      visitorDays.set(row.arm, (visitorDays.get(row.arm) ?? 0) + row.visitors);
    }
    // W22 A1.01: a day written under an EARLIER contract version is never
    // pooled with a later one. The version names what the numbers mean, so two
    // versions in one window is a mixed basis, exactly as two computations are.
    const dayContract = validAttributionContract(report.attributionContract);
    if (dayContract) {
      const pooledContract = contract;
      if (!pooledContract) contract = dayContract;
      else if (dayContract.version !== pooledContract.version) contractMixed = true;
      else contract = { ...pooledContract,
        appliedWindowsMs: Object.fromEntries(Object.entries(pooledContract.appliedWindowsMs)
          .map(([reward, applied]) => [reward, Math.min(applied, dayContract.appliedWindowsMs[reward] ?? applied)])) };
    }
    // W31 M1.01 (F25 §5.7, which names holdout shares beside policies, rewards
    // and objectives): a day served under a DIFFERENT published allocation is
    // not pooled with this one. A day that records none leaves the window's
    // allocation unknown and is pooled exactly as it is today (R149).
    const dayAllocation = validAllocation(report.allocation);
    if (!dayAllocation) allocationUnknown = true;
    else if (!allocation) allocation = dayAllocation;
    else if (allocationKey(dayAllocation) !== allocationKey(allocation)) allocationMixed = true;
    const basis = recordedComputation(report.computation);
    // W33 O4 (N09): a declared day's counts are an overlay's, not the canonical
    // day's, so every slot it reaches withholds its pooled arms and says why.
    const declared = validProvenance(report.provenance)?.status === 'declared';
    for (const slot of new Set([...Object.keys(report.holdout), ...(basis?.slots.map(s => s.slot) ?? [])])) {
      const rows = report.holdout[slot];
      const info: WindowReport['slots'][string]['compatibility'] = compatibility.get(slot) ?? { status: 'compatible', reasons: [], days: [] };
      const identity = slotComputation(basis, slot);
      const addReason = (reason: typeof info.reasons[number]) => { if (!info.reasons.includes(reason)) info.reasons.push(reason); };
      if (contractMixed) addReason('mixed_basis');
      if (allocationMixed) addReason('mixed_allocation');
      if (!identity) addReason('unknown_basis');
      if (!rows?.length) addReason('unrepresented_counts');
      if (declared) addReason('declared_day');
      if (identity && identities.has(slot) && identities.get(slot) !== identity) addReason('mixed_basis');
      info.reasons.sort();
      if (identity) identities.set(slot, identities.get(slot) ?? identity);
      if (identity && !slotComputations.has(slot)) {
        const members = slotComputationMembers(basis, slot);
        if (members) slotComputations.set(slot, members);
      }
      info.status = mixedStatus(info.reasons) ? 'mixed' : info.reasons.length ? 'unknown' : 'compatible';
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

  // A mixed contract or a mixed allocation is decided after every day is read,
  // so it reaches the slots the earlier days had already been pooled into.
  for (const [mixed, reason] of [[contractMixed, 'mixed_basis'], [allocationMixed, 'mixed_allocation']] as const) {
    if (!mixed) continue;
    for (const info of compatibility.values()) {
      if (!info.reasons.includes(reason)) info.reasons.push(reason);
      info.reasons.sort(); info.status = 'mixed';
    }
  }
  const slots: WindowReport['slots'] = {};
  for (const [slot, bySlot] of counts) {
    const arms = [...bySlot.entries()].map(([arm, total]) => ({
      ...attributionArm(arm, total.decisions, total.credited), n: total.decisions, s: total.credited,
    })).sort((a, b) => a.arm.localeCompare(b.arm));
    const info = compatibility.get(slot)!;
    slots[slot] = { arms: info.status === 'compatible' ? arms : [], comparisons: [], compatibility: info,
      computation: info.status === 'compatible' ? slotComputations.get(slot) ?? null : null };
  }
  const report: WindowReport = { ...ids, days, missing, incomplete, measurement: REPORT_MEASUREMENT, slots,
    compatibility: { version: 1, experimental: 'unverified' }, sourceCounts,
    ...(contract ? { attributionContract: contract } : {}),
    allocation: allocationMixed || allocationUnknown ? null : allocation ?? null,
    armVisitors: armVisitorsKnown && days.length
      ? { version: 1, basis: 'visitor_days', arms: [...visitorDays.entries()].map(([arm, visitors]) => ({ arm, visitors })).sort((a, b) => a.arm.localeCompare(b.arm)) }
      : null,
    coverage: { version: 1, status: missing.length || incomplete.length ? 'incomplete' : 'unknown', maturity: 'unknown', days: coverageDays,
      minHorizonMs: !missing.length && coverageDays.length && coverageDays.every(d => d.coverage.minHorizonMs !== null)
        ? Math.min(...coverageDays.map(d => d.coverage.minHorizonMs!)) : null },
  };
  reportPayloadJson(report); return report;
}

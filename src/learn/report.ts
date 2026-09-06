// src/learn/report.ts
// Doc 22 §4.2, §7, §10, §12.2: the batch half of attribution, over the ledger.
// Because both ledgers are immutable, attribution is a read: any number of
// reporting policies can run over the same day's decisions and outcomes and
// produce the lift grid the engine WOULD have learned under each, beside the
// learning policy, without changing what is served. The same pass counts what
// explored against the configured share (§7) and reports the holdout arms
// against each other (§10), from R2 and never from Analytics Engine. Pure
// where it can be: `buildReport` takes records; `runReport` fetches them.

import type { DecisionRecord, LearnConfig } from '@/content/types';
import { loadTombstones, withoutErased } from '@/ledger/erasure';
import type { OutcomeRecord, RewardType } from '@/ledger/records';
import type { R2Like } from '@/ledger/writer';
import { attribute, creditWeight, DEFAULT_POLICY, type AttributionPolicy, type RingEntry } from './policy';
import { ringEntryOf } from './fan';
import { buildSnapshot, DEFAULT_STATS, emptyStats, recordExposure, recordSuccess, type LiftSnapshot, type StatsConfig } from './stats';
import { policyOf, slotConfigsOf } from './route';
import { compareArms, type ArmComparison } from '@/measure/holdout';

export interface ReportPolicy extends AttributionPolicy { name: string }

export interface ReportInput {
  tenant: string;
  brand: string;
  date: string;
  /** The learning policy in force (from the learn document) and the reporting overlays to compare. */
  learning: ReportPolicy;
  reporting: ReportPolicy[];
  learn: LearnConfig;
  decisions: readonly DecisionRecord[];
  outcomes: readonly OutcomeRecord[];
  now: number;
  truncated: boolean;
}

export interface ArmRow { arm: string; decisions: number; credited: number; rate: number }
export interface ExploreRow { slot: string; decisions: number; explored: number; realized: number; configured: number | null; mode: string | null }

export interface DayReport {
  tenant: string;
  brand: string;
  date: string;
  builtAt: number;
  counts: { decisions: number; outcomes: number; visitors: number; truncated: boolean };
  policies: Array<{ name: string; policy: AttributionPolicy; role: 'learning' | 'reporting'; credits: number }>;
  /** slot → policy name → the grid the engine would have learned under that policy, from this day alone. */
  grids: Record<string, Record<string, LiftSnapshot>>;
  exploration: ExploreRow[];
  /** slot → arms compared under the learning policy. */
  holdout: Record<string, ArmRow[]>;
  /** slot → each holdout arm against the personalized arm: intervals, verdict, decisions still needed, and the sentence (doc 22 §10). */
  holdoutComparison: Record<string, ArmComparison[]>;
  /** CW28: tombstones pending for the tenant, and the rows this report dropped for them (doc 22 §15). */
  erasures?: { pending: number; rows_hidden: number };
  /** Doc 31 §3: how the day was built. `aggregates`: the sum of the hours in `built`, the closed hours still unfolded in `missing`, the batch ring's reach in `horizonMs`; `ledger`: read straight from the day's records. */
  hours?: { source: 'aggregates' | 'ledger'; built: number[]; missing: number[]; horizonMs?: number };
}

const r3 = (x: number) => Math.round(x * 1000) / 1000;

/** Presets a data scientist reaches for first (§4.2): the natural reporting overlays. */
export function presetPolicies(learning: AttributionPolicy): ReportPolicy[] {
  // The name comes after the spread: the learning policy may carry its own.
  const base = { scope: learning.scope, match: learning.match, credit: learning.credit, windowsMs: learning.windowsMs };
  return [
    { ...base, name: 'first-touch', credit: 'first' },
    { ...base, name: 'any-item', match: 'any' },
    { ...base, name: 'visitor-scope', scope: 'visitor' },
    { ...base, name: 'purchase-1d', windowsMs: { ...base.windowsMs, purchase: 24 * 60 * 60 * 1000 } },
  ];
}

/** Rings per visitor from the day's decisions, oldest first: what the online object would have held. */
export function ringsOf(decisions: readonly DecisionRecord[]): Map<string, RingEntry[]> {
  const rings = new Map<string, RingEntry[]>();
  for (const d of decisions) {
    const list = rings.get(d.visitor_id) ?? [];
    list.push(ringEntryOf(d));
    rings.set(d.visitor_id, list);
  }
  for (const list of rings.values()) list.sort((a, b) => a.ts - b.ts);
  return rings;
}

export function buildReport(i: ReportInput): DayReport {
  const rings = ringsOf(i.decisions);
  const slotCfg = slotConfigsOf(i.learn);
  const statsCfg: StatsConfig = i.learn.stats ?? DEFAULT_STATS;
  const slots = [...new Set(i.decisions.map((d) => d.slot))].sort();
  const policies: DayReport['policies'] = [];
  const grids: DayReport['grids'] = {};
  const holdout: DayReport['holdout'] = {};
  const holdoutComparison: DayReport['holdoutComparison'] = {};

  const all: Array<{ p: ReportPolicy; role: 'learning' | 'reporting' }> = [{ p: i.learning, role: 'learning' }, ...i.reporting.map((p) => ({ p, role: 'reporting' as const }))];
  for (const { p, role } of all) {
    // Exposures: the personalized arm's decisions only, as the fan-in records them (§10: holdout traffic
    // never feeds the statistics; the arms are compared from the ledger below).
    const states = new Map<string, ReturnType<typeof emptyStats>>();
    const stateOf = (slot: string) => { let s = states.get(slot); if (!s) { s = emptyStats(); states.set(slot, s); } return s; };
    for (const d of i.decisions) if (d.arm === 'personalized') recordExposure(stateOf(d.slot), d.item_id, d.cell, d.ts, statsCfg);
    // Credits under this policy, from every outcome against its visitor's ring.
    let credits = 0;
    const armCredits = new Map<string, number>();
    for (const o of i.outcomes) {
      const ring = rings.get(o.visitor_id);
      if (!ring) continue;
      for (const c of attribute(o, ring, p)) {
        const reward = slotCfg[c.slot]?.reward ?? 'click';
        if (c.reward !== reward) continue;                       // the slot learns against one reward
        credits += 1;
        const d = i.decisions.find((x) => x.decision_id === c.decision_id);
        const arm = d?.arm ?? 'personalized';
        armCredits.set(`${c.slot}|${arm}`, (armCredits.get(`${c.slot}|${arm}`) ?? 0) + 1);
        if (arm === 'personalized') { const w = creditWeight(slotCfg[c.slot]?.objective, o); if (w > 0) recordSuccess(stateOf(c.slot), c.item, c.cell, c.reward as RewardType, c.ts, w, statsCfg); }
      }
    }
    policies.push({ name: p.name, policy: { scope: p.scope, match: p.match, credit: p.credit, windowsMs: p.windowsMs }, role, credits });
    for (const slot of slots) {
      const st = states.get(slot) ?? emptyStats();
      (grids[slot] ??= {})[p.name] = buildSnapshot(st, { tenant: i.tenant, brand: i.brand, slot }, slotCfg[slot]?.reward ?? 'click', i.now, statsCfg, null, slotCfg[slot]?.objective ?? 'unit');
    }
    // §10: the arms, under the learning policy only.
    if (role === 'learning') {
      for (const slot of slots) {
        const arms = [...new Set(i.decisions.filter((d) => d.slot === slot).map((d) => d.arm))].sort();
        holdout[slot] = arms.map((arm) => {
          const decisions = i.decisions.filter((d) => d.slot === slot && d.arm === arm).length;
          const credited = armCredits.get(`${slot}|${arm}`) ?? 0;
          return { arm, decisions, credited, rate: decisions ? r3(credited / decisions) : 0 };
        });
        // Each holdout arm against the personalized one, with the uncertainty a person needs to read the number.
        const rows = holdout[slot]!;
        const treated = rows.find((r) => r.arm === 'personalized');
        holdoutComparison[slot] = treated ? rows.filter((r) => r.arm !== 'personalized').map((r) => compareArms({ arm: r.arm, n: r.decisions, s: r.credited }, { arm: 'personalized', n: treated.decisions, s: treated.credited })) : [];
      }
    }
  }

  // §7: what explored, against the configured share.
  const exploration: ExploreRow[] = slots.map((slot) => {
    const rows = i.decisions.filter((d) => d.slot === slot && d.position === 0 && d.arm !== 'default');
    const explored = rows.filter((d) => d.explored).length;
    const cfg = i.learn.slots?.[slot]?.exploration ?? null;
    return { slot, decisions: rows.length, explored, realized: rows.length ? r3(explored / rows.length) : 0, configured: cfg && cfg.mode !== 'off' ? cfg.share : null, mode: cfg?.mode ?? null };
  });

  return {
    tenant: i.tenant, brand: i.brand, date: i.date, builtAt: i.now,
    counts: { decisions: i.decisions.length, outcomes: i.outcomes.length, visitors: rings.size, truncated: i.truncated },
    policies, grids, exploration, holdout, holdoutComparison,
  };
}

/** The ledger's NDJSON batches for one day, both streams, capped. */
export async function loadDay<T>(r2: R2Like, tenant: string, date: string, stream: 'decision' | 'outcome', cap: number): Promise<{ records: T[]; truncated: boolean }> {
  const prefix = `${tenant}/${date}/`;
  const keys: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await r2.list({ prefix, cursor, limit: 1000 });
    for (const o of page.objects) if (o.key.includes(`/${stream}/`)) keys.push(o.key);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  keys.sort();
  const records: T[] = [];
  let truncated = false;
  for (const key of keys) {
    const obj = await r2.get(key);
    if (!obj) continue;
    for (const line of (await obj.text()).split('\n')) {
      if (!line) continue;
      if (records.length >= cap) { truncated = true; break; }
      try { records.push(JSON.parse(line) as T); } catch { /* a bad line never hides the good ones */ }
    }
    if (truncated) break;
  }
  return { records, truncated };
}

export const reportKey = (tenant: string, brand: string, date: string) => `reports/${tenant}/${brand}/${date}.json`;
export const REPORT_CAP = 50_000;
/** A Worker may open only so many storage objects in one request; past this many ledger objects a day is built by the nightly job, not on demand. */
export const REPORT_MAX_OBJECTS = 800;

/** How many ledger objects a day holds, both streams, without opening any. */
export async function countDayObjects(r2: R2Like, tenant: string, date: string): Promise<number> {
  let n = 0, cursor: string | undefined;
  do {
    const page = await r2.list({ prefix: `${tenant}/${date}/`, cursor, limit: 1000 });
    n += page.objects.length;
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return n;
}

export async function runReport(
  r2: R2Like & { put(key: string, body: string, opts?: unknown): Promise<unknown> },
  ids: { tenant: string; brand: string; date: string },
  learn: LearnConfig,
  reporting: ReportPolicy[] | null,
  now = Date.now(),
): Promise<DayReport> {
  const [d, o, tombs] = await Promise.all([
    loadDay<DecisionRecord>(r2, ids.tenant, ids.date, 'decision', REPORT_CAP),
    loadDay<OutcomeRecord>(r2, ids.tenant, ids.date, 'outcome', REPORT_CAP),
    loadTombstones(r2, ids.tenant),
  ]);
  // CW28: an erased visitor's rows are dropped here at once; the nightly rewrite removes them from the objects.
  const dBrand = d.records.filter((x) => x.brand === ids.brand), oBrand = o.records.filter((x) => x.brand === ids.brand);
  const decisions = withoutErased(dBrand, tombs), outcomes = withoutErased(oBrand, tombs);
  const learning: ReportPolicy = { name: 'learning', ...policyOf(learn) };
  const report = buildReport({
    ...ids, learning, reporting: reporting ?? presetPolicies(learning), learn,
    decisions, outcomes,
    now, truncated: d.truncated || o.truncated,
  });
  report.erasures = { pending: tombs.size, rows_hidden: dBrand.length + oBrand.length - decisions.length - outcomes.length };
  report.hours = { source: 'ledger', built: [], missing: [] };
  try { await r2.put(reportKey(ids.tenant, ids.brand, ids.date), JSON.stringify(report), { httpMetadata: { contentType: 'application/json' } }); } catch { /* the response still carries it */ }
  return report;
}

export { DEFAULT_POLICY };

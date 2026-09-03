// src/demos/meridian/receipts.ts
// ─────────────────────────────────────────────────────────────────────────────
// The receipts.
//
// Every decision the page makes is written as one warehouse-shaped row: what was
// chosen, out of how many, by which drivers, at what score, against which
// thresholds, under which config version, and what a rule refused. The room can
// export it and compute their own lift.
//
// THIS IS THE HONEST CLOSER. We do not present an uplift number of our own as
// proof — we hand over the rows that would let anyone check us. A demo that
// exports its own reasoning is making a harder claim than one that shows a chart,
// and it is the only one of the two we can actually stand behind.
//
// Written off the response path via ctx.waitUntil: capture must never be able to
// slow a decision down.
// ─────────────────────────────────────────────────────────────────────────────

import type { MeridianDecision, SectionDecision, Vertical } from './types';
import { DEFAULT_TENANT, type TenantId } from '@/tenancy/tenant';

/** Column order MUST match migrations/0007_meridian_decisions.sql exactly. */
export const MRD_DECISION_COLUMNS = [
  'decision_id', 'ts', 'visitor_id', 'vertical', 'slot_id', 'rank_position',
  'chosen_item', 'strategy', 'candidate_set', 'gates_failed', 'refused',
  'dimension_scores', 'rank_score', 'confidence', 'theta_out', 'config_version',
  'arrival_surface', 'demo_run_id',
  // Appended last (migration 0009) so the eighteen columns above keep the order
  // the writer has always used. Two brands' receipts in one table with no way
  // to tell them apart after the fact is the leak this closes.
  'tenant',
] as const;

export interface CaptureInput {
  visitorId: string;
  vertical: Vertical;
  /** The brand these receipts belong to. Absent means the default brand, which
   *  is also what the column's SQL DEFAULT resolves to for an unconverted writer. */
  tenant?: TenantId;
  decisions: MeridianDecision[];
  arrivalSurface?: string | null;
  demoRunId?: string | null;
  now: number;
  /**
   * Section-order decisions (composeLayout), written in the same batch as rows
   * whose slot_id is 'layout:<section>' and whose rank_position is the rank.
   */
  sections?: SectionDecision[];
}

/** The section-order receipt on its own: same rows, same table, no slot decisions. */
export interface CaptureLayoutInput {
  visitorId: string;
  vertical: Vertical;
  tenant?: TenantId;
  sections: SectionDecision[];
  arrivalSurface?: string | null;
  demoRunId?: string | null;
  now: number;
}

function rowFor(d: MeridianDecision, i: CaptureInput): unknown[] {
  const e = d.explain ?? ({} as MeridianDecision['explain']);
  const drivers: Record<string, number> = {};
  for (const x of e.drivers ?? []) drivers[`${x.dim}.${x.value}`] = x.a;
  const rankScore = (e.drivers ?? []).reduce((n, x) => n + (x.weight ?? 0), 0);
  return [
    `${i.visitorId}:${i.now}:${d.slot}:${d.order}`,
    i.now, i.visitorId, i.vertical, d.slot, d.order,
    d.itemId ?? d.blockId ?? null, d.strategy, e.candidates ?? 0,
    JSON.stringify(e.gatesFailed ?? []), JSON.stringify(e.refused ?? []),
    JSON.stringify(drivers), Math.round(rankScore * 1e4) / 1e4,
    e.confidence ?? null, e.thetaOut ?? null, e.configVersion ?? 'unknown',
    i.arrivalSurface ?? null, i.demoRunId ?? null,
    i.tenant ?? DEFAULT_TENANT,
  ];
}

/**
 * A section's place on the page, in the SAME shape as a slot decision, so the
 * export the room takes away has one schema: slot_id 'layout:<section>',
 * rank_position = the rank, chosen_item = the section, drivers/score/confidence/
 * θ_out straight from the receipt. A locked section records 'locked' as the
 * gate that outranked the engine, the way a pin does.
 */
function layoutRowFor(s: SectionDecision, i: CaptureLayoutInput, candidates: number): unknown[] {
  const e = s.explain;
  const drivers: Record<string, number> = {};
  for (const x of e.drivers ?? []) drivers[`${x.dim}.${x.value}`] = x.a;
  return [
    `${i.visitorId}:${i.now}:layout:${s.section}:${s.rank}`,
    i.now, i.visitorId, i.vertical, `layout:${s.section}`, s.rank,
    s.section, s.strategy, candidates,
    JSON.stringify(s.strategy === 'locked' ? ['locked'] : []), JSON.stringify([]),
    JSON.stringify(drivers), Math.round(s.score * 1e4) / 1e4,
    e.confidence ?? null, e.thetaOut ?? null, e.configVersion ?? 'unknown',
    i.arrivalSurface ?? null, i.demoRunId ?? null,
    i.tenant ?? DEFAULT_TENANT,
  ];
}

/** The layout rows, pure — one per section, each MRD_DECISION_COLUMNS wide. */
export function rowsForLayout(input: CaptureLayoutInput): unknown[][] {
  return input.sections.map((s) => layoutRowFor(s, input, input.sections.length));
}

/**
 * Normalize an untrusted POST /decisions body into a CaptureInput, or null when
 * there is nothing to write.
 *
 * This exists as its own function because of the bug it fixes. The route used to
 * build the input inline and never read `body.sections`, so every page-ordering
 * receipt the client posted — and it has always posted them, meridian.js:3093 —
 * was silently dropped. The guard also required `decisions` to be an array, so a
 * sections-only post was rejected outright. Page order is half the Experience
 * milestone, and its receipts were the half that never reached D1.
 *
 * Either list may be empty; both empty is the only failure. Pulling it out of the
 * handler is what makes that assertable.
 */
export function captureInputFrom(
  body: unknown, vertical: Vertical, now: number, tenant: TenantId = DEFAULT_TENANT,
): CaptureInput | null {
  const b = (body ?? {}) as Record<string, unknown>;
  const visitorId = typeof b.visitorId === 'string' ? b.visitorId.trim() : '';
  if (visitorId === '') return null;

  const decisions = Array.isArray(b.decisions) ? (b.decisions as MeridianDecision[]) : [];
  const sections = Array.isArray(b.sections) ? (b.sections as SectionDecision[]) : [];
  if (decisions.length === 0 && sections.length === 0) return null;

  return {
    visitorId, vertical, tenant, decisions, sections, now,
    arrivalSurface: typeof b.arrivalSurface === 'string' ? b.arrivalSurface : null,
    demoRunId: typeof b.demoRunId === 'string' ? b.demoRunId : null,
  };
}

export async function capture(db: D1Database, input: CaptureInput): Promise<number> {
  const rows = [
    ...input.decisions.map((d) => rowFor(d, input)),
    ...(input.sections?.length ? rowsForLayout({ ...input, sections: input.sections }) : []),
  ];
  if (!rows.length) return 0;
  const cols = MRD_DECISION_COLUMNS.join(', ');
  const marks = MRD_DECISION_COLUMNS.map(() => '?').join(', ');
  const sql = `INSERT OR REPLACE INTO mrd_decisions (${cols}) VALUES (${marks})`;
  const stmts = rows.map((row) => db.prepare(sql).bind(...(row as never[])));
  await db.batch(stmts);
  return stmts.length;
}

/** Section-order receipts alone. Off the response path, like capture. */
export function captureLayout(db: D1Database, input: CaptureLayoutInput): Promise<number> {
  return capture(db, { ...input, decisions: [] });
}

/**
 * The rows for ONE brand. The tenant predicate is not optional: an export that
 * could omit it is an export that leaks another brand's receipts the first time
 * someone forgets, and the whole point of the column is that nobody has to
 * remember.
 */
export async function exportRows(
  db: D1Database, visitorId: string | null, limit: number, tenant: TenantId = DEFAULT_TENANT,
) {
  const n = Math.max(1, Math.min(500, limit || 100));
  const q = visitorId
    ? db.prepare(`SELECT * FROM mrd_decisions WHERE tenant = ? AND visitor_id = ? ORDER BY ts DESC, slot_id LIMIT ?`).bind(tenant, visitorId, n)
    : db.prepare(`SELECT * FROM mrd_decisions WHERE tenant = ? ORDER BY ts DESC, slot_id LIMIT ?`).bind(tenant, n);
  const res = await q.all();
  return { columns: MRD_DECISION_COLUMNS, rows: res.results ?? [] };
}

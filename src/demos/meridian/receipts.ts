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

import type { MeridianDecision, Vertical } from './types';

/** Column order MUST match migrations/0007_meridian_decisions.sql exactly. */
export const MRD_DECISION_COLUMNS = [
  'decision_id', 'ts', 'visitor_id', 'vertical', 'slot_id', 'rank_position',
  'chosen_item', 'strategy', 'candidate_set', 'gates_failed', 'refused',
  'dimension_scores', 'rank_score', 'confidence', 'theta_out', 'config_version',
  'arrival_surface', 'demo_run_id',
] as const;

export interface CaptureInput {
  visitorId: string;
  vertical: Vertical;
  decisions: MeridianDecision[];
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
  ];
}

export async function capture(db: D1Database, input: CaptureInput): Promise<number> {
  if (!input.decisions.length) return 0;
  const cols = MRD_DECISION_COLUMNS.join(', ');
  const marks = MRD_DECISION_COLUMNS.map(() => '?').join(', ');
  const sql = `INSERT OR REPLACE INTO mrd_decisions (${cols}) VALUES (${marks})`;
  const stmts = input.decisions.map((d) => db.prepare(sql).bind(...(rowFor(d, input) as never[])));
  await db.batch(stmts);
  return stmts.length;
}

export async function exportRows(db: D1Database, visitorId: string | null, limit: number) {
  const n = Math.max(1, Math.min(500, limit || 100));
  const q = visitorId
    ? db.prepare(`SELECT * FROM mrd_decisions WHERE visitor_id = ? ORDER BY ts DESC, slot_id LIMIT ?`).bind(visitorId, n)
    : db.prepare(`SELECT * FROM mrd_decisions ORDER BY ts DESC, slot_id LIMIT ?`).bind(n);
  const res = await q.all();
  return { columns: MRD_DECISION_COLUMNS, rows: res.results ?? [] };
}

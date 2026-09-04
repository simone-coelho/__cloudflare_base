// src/identity/history.ts
// ---------------------------------------------------------------------------
// Historical rows: the warehouse's past, applied to a shopper as actions that
// arrived late.
//
// A row names a shopper one of three ways: the site's account id (hashed here
// to the shopper id, so the raw id is read once and stored never), a shopper
// id the site already computed, or a visitor id. A visitor id that was linked
// resolves to its person; one that was not is applied to that browser's own
// profile, which is still right: it is the same browser.
//
// A row's product attributes become touches exactly as a live event's would,
// through the sanitizer and the registry, so an imported purchase of a Tabby
// scores `line: Tabby` at weight 5 the way a live purchase does. The weight is
// then discounted by everything that has decayed between the row's time and the
// present (identityMerge.applyHistorical), which is what "arriving late" means.
//
// Rows are grouped by shopper and applied in one write per shopper. Bounded at
// 1000 rows per request: a warehouse export is a stream of requests, not one.
// ---------------------------------------------------------------------------

import { z } from 'zod';
import type { Env } from '@/types/env';
import type { TenantId } from '@/tenancy/tenant';
import { shopperObject } from '@/tenancy/objects';
import { resolveReflexConfig, resolveSurface } from '@/demos/registry';
import { SessionManager } from '@/services/SessionManager';
import { extractTouches, sanitizeEventAttributes, tick, type ReflexConfig, type Touch } from '@/reflex/core';
import { applyHistorical } from '@/reflex/identityMerge';
import { IdentityStore } from '@/identity/store';
import { isSalted, isShopperId, shopperIdFor } from '@/identity/shopperId';

export const MAX_ROWS = 1000;

const timeSchema = z.union([z.number().finite(), z.string().min(4)]).transform((v, ctx) => {
  const ms = typeof v === 'number' ? (v < 1e11 ? v * 1000 : v) : Date.parse(v);
  if (!Number.isFinite(ms)) { ctx.addIssue({ code: 'custom', message: 'unparseable time' }); return z.NEVER; }
  return ms;
});

export const historyRowSchema = z.object({
  accountId: z.string().trim().min(1).max(200).optional(),
  shopperId: z.string().trim().min(1).max(64).optional(),
  visitorId: z.string().trim().min(1).max(200).optional(),
  action: z.string().trim().min(1).max(64),
  at: timeSchema,
  product: z.record(z.string(), z.unknown()).optional(),
  attributes: z.record(z.string(), z.unknown()).optional(),
}).refine((r) => r.accountId || r.shopperId || r.visitorId, { message: 'a row needs accountId, shopperId or visitorId' });

export type HistoryRow = z.infer<typeof historyRowSchema>;

export interface HistoryReport {
  received: number;
  applied: number;
  shoppers: number;
  /** Rows that named nobody we could resolve, or carried no registry touch. Index into the request. */
  skipped: Array<{ index: number; reason: string }>;
  perShopper: Array<{ shopperId: string; rows: number; audiences: string[]; created: boolean }>;
}

/**
 * CSV with a header row. Columns: account_id | shopper_id | visitor_id, action,
 * at, then any product attribute the registry can read (line, category, …).
 * Quoted fields are honoured; that is the whole grammar.
 */
export function parseHistoryCsv(text: string): Array<Record<string, unknown>> {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length < 2) return [];
  const split = (line: string): string[] => {
    const out: string[] = []; let cur = ''; let q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q) { if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
      else if (ch === '"') q = true; else if (ch === ',') { out.push(cur); cur = ''; } else cur += ch;
    }
    out.push(cur);
    return out.map((s) => s.trim());
  };
  const header = split(lines[0]).map((h) => h.toLowerCase());
  const known: Record<string, string> = { account_id: 'accountId', accountid: 'accountId', shopper_id: 'shopperId', shopperid: 'shopperId', visitor_id: 'visitorId', visitorid: 'visitorId', action: 'action', at: 'at', time: 'at', timestamp: 'at' };
  return lines.slice(1).map((line) => {
    const cells = split(line);
    const row: Record<string, unknown> = {}; const product: Record<string, unknown> = {};
    header.forEach((h, i) => {
      const v = cells[i] ?? '';
      if (v === '') return;
      const k = known[h];
      if (k) row[k] = k === 'at' && /^\d+(\.\d+)?$/.test(v) ? Number(v) : v;
      else product[h] = /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v;
    });
    if (Object.keys(product).length) row.product = product;
    return row;
  });
}

function touchesOf(row: HistoryRow, cfg: ReflexConfig): Touch[] {
  const attrs = { ...(row.product ?? {}), ...(row.attributes ?? {}) };
  return extractTouches(sanitizeEventAttributes(attrs, cfg), cfg);
}

/** Apply a batch. Rows are validated by the caller; this resolves, groups and writes. */
export async function applyHistory(env: Env, tenant: TenantId, rows: HistoryRow[], now = Date.now()): Promise<HistoryReport> {
  const store = new IdentityStore(env.SESSIONS as never, tenant);
  const cfg = await resolveReflexConfig(env, resolveSurface(null));
  const report: HistoryReport = { received: rows.length, applied: 0, shoppers: 0, skipped: [], perShopper: [] };

  // Resolve every row to a target id, then group.
  const groups = new Map<string, Array<{ action: string; at: number; touches: Touch[]; index: number }>>();
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    let target: string | null = null;
    if (r.shopperId) {
      if (!isShopperId(r.shopperId)) { report.skipped.push({ index: i, reason: 'shopperId is not a shopper id' }); continue; }
      target = r.shopperId;
    } else if (r.accountId) {
      target = await shopperIdFor(env, tenant, r.accountId);
    } else if (r.visitorId) {
      target = (await store.resolveVisitor(r.visitorId)) ?? r.visitorId;
    }
    if (!target) { report.skipped.push({ index: i, reason: 'no shopper' }); continue; }
    if ((cfg.weights[r.action] ?? 0) <= 0) { report.skipped.push({ index: i, reason: `action "${r.action}" has no weight` }); continue; }
    const touches = touchesOf(r, cfg);
    if (touches.length === 0) { report.skipped.push({ index: i, reason: 'no registry attribute on the row' }); continue; }
    const g = groups.get(target) ?? [];
    g.push({ action: r.action, at: r.at, touches, index: i });
    groups.set(target, g);
  }

  const onObjectHost = (env.REFLEX_HOST ?? 'session') === 'do';
  const sm = new SessionManager(env, { tenant });

  for (const [target, batch] of groups) {
    const person = isShopperId(target);
    const latestAt = Math.max(...batch.map((b) => b.at));
    if (onObjectHost) {
      const stub = shopperObject(env.SHOPPER_REFLEX, target, tenant);
      const res = (await (await stub.fetch('https://shopper-reflex/identity/import', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shopperId: target, now, rows: batch.map(({ action, at, touches }) => ({ action, at, touches })) }),
      })).json()) as { audiences?: string[] };
      report.perShopper.push({ shopperId: target, rows: batch.length, audiences: res.audiences ?? [], created: false });
    } else {
      const sid = await sm.resolveSessionIdByUserId(target);
      const existing = sid ? (await sm.resolveRecord(sid)).data : null;
      let state = existing?.reflex ?? null;
      for (const b of batch) state = applyHistorical(state, { action: b.action, touches: b.touches }, b.at, cfg);
      const evaluated = tick(state, now, cfg);
      const written = await sm.applyImport({
        userId: target, reflex: evaluated.state, now,
        identity: person ? { shopperId: target, linkedAt: now } : undefined,
      });
      report.perShopper.push({ shopperId: target, rows: batch.length, audiences: evaluated.state.audiences, created: written.created });
    }
    if (person) await store.noteHistory(target, batch.length, latestAt, isSalted(env), now);
    report.applied += batch.length;
  }
  report.shoppers = groups.size;
  return report;
}

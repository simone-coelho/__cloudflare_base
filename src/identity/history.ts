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
import { importUnderOwner } from '@/identity/sessionAuthority';
import { requireRetention } from '@/retention';
import type { Env } from '@/types/env';
import { TenantKV, type TenantId } from '@/tenancy/tenant';
import { shopperObject } from '@/tenancy/objects';
import { resolveTenantReflexConfig } from '@/demos/registry';
import { SessionManager } from '@/services/SessionManager';
import { extractTouches, sanitizeEventAttributes, type ReflexConfig, type Touch } from '@/reflex/core';
import { IdentityStore } from '@/identity/store';
import { isSalted, isShopperId, shopperIdFor } from '@/identity/shopperId';
import { loadTombstone, type Tombstone } from '@/ledger/erasure';
import { enrichmentInputs, type ImportOutcome, type ProfileRow, type ProfileSnapshotRow } from '@/identity/profileEnrichment';

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

export class HistoryCsvError extends Error {
  constructor(message: string, readonly status: 400 | 413 = 400) { super(message); }
}

/** Strict CSV framing, then either legacy actions or explicit profile snapshots. */
export function parseHistoryCsv(text: string): Array<Record<string, unknown>> {
  const records: string[][] = [];
  let cells: string[] = [], cell = '', quoted = false, closed = false, started = false;
  const finish = () => {
    // Only a physically empty record is blank; commas/quotes/whitespace count.
    if (started) {
      records.push([...cells, cell]);
      if (records.length > MAX_ROWS + 1) throw new HistoryCsvError(`at most ${MAX_ROWS} rows per request`, 413);
    }
    cells = []; cell = ''; closed = false; started = false;
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') { quoted = false; closed = true; }
      else cell += ch;
    } else if (ch === ',') {
      cells.push(cell); cell = ''; closed = false; started = true;
    } else if (ch === '\r' || ch === '\n') {
      finish();
      if (ch === '\r' && text[i + 1] === '\n') i++;
    } else if (ch === '"' && !closed && cell === '') {
      quoted = true; started = true;
    } else {
      if (closed || ch === '"') throw new HistoryCsvError('invalid CSV quoting');
      cell += ch; started = true;
    }
  }
  if (quoted) throw new HistoryCsvError('unterminated CSV quote');
  finish();
  if (!records.length) return [];
  const aliases: Record<string, string> = { account_id: 'accountId', accountid: 'accountId', shopper_id: 'shopperId', shopperid: 'shopperId', visitor_id: 'visitorId', visitorid: 'visitorId', time: 'at', timestamp: 'at' };
  const header = records[0].map(value => {
    const name = value.trim().toLowerCase();
    if (!name || ['__proto__', 'prototype', 'constructor'].includes(name)) throw new HistoryCsvError('invalid CSV heading');
    return Object.hasOwn(aliases, name) ? aliases[name] : name;
  });
  if (new Set(header).size !== header.length) throw new HistoryCsvError('duplicate CSV heading');
  const selectors = ['accountId', 'shopperId', 'visitorId'];
  const typed = header.some(name => ['kind', 'version', 'fields', 'audiences'].includes(name));
  if (typed) {
    const required = ['kind', 'version', 'source', 'at', 'fields', 'audiences'];
    if (required.some(name => !header.includes(name)) || !selectors.some(name => header.includes(name))
      || header.some(name => ![...required, ...selectors].includes(name))) throw new HistoryCsvError('invalid typed CSV headings');
  }
  return records.slice(1).map((cells, index) => {
    if (cells.length !== header.length) throw new HistoryCsvError(`row ${index}: CSV column count differs from header`);
    if (typed) {
      const row: Record<string, unknown> = Object.fromEntries(header.map((name, i) => [name, cells[i].trim()]));
      if (row.kind !== 'profile' || row.version !== '1') throw new HistoryCsvError(`row ${index}: expected profile version 1`);
      row.version = 1;
      for (const name of ['fields', 'audiences']) {
        let value: unknown;
        try { value = JSON.parse(row[name] as string); } catch { throw new HistoryCsvError(`row ${index}: invalid ${name} JSON object`); }
        if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new HistoryCsvError(`row ${index}: invalid ${name} JSON object`);
        row[name] = value;
      }
      for (const name of selectors) if (row[name] === '') delete row[name];
      if (/^\d+(\.\d+)?$/.test(row.at as string)) row.at = Number(row.at);
      return row;
    }
    const row: Record<string, unknown> = {}; const product: Record<string, unknown> = {};
    header.forEach((h, i) => {
      const v = cells[i].trim();
      if (v === '') return;
      if ([...selectors, 'action', 'at'].includes(h)) row[h] = h === 'at' && /^\d+(\.\d+)?$/.test(v) ? Number(v) : v;
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
export async function applyHistory(env: Env, tenant: TenantId, rows: Array<HistoryRow | ProfileRow>, now = Date.now()): Promise<HistoryReport> {
  const kv = new TenantKV(env.SESSIONS as never, tenant);
  const cfg = await resolveTenantReflexConfig(env, tenant);
  const report: HistoryReport = { received: rows.length, applied: 0, shoppers: 0, skipped: [], perShopper: [] };
  // Request-local point reads only; resolve every barrier before the first profile/history mutation.
  const barriers = new Map<string, Tombstone | null>();
  const cutoff = async (id: string) => {
    if (!barriers.has(id)) barriers.set(id, await loadTombstone(env.STORAGE, tenant, id));
    return barriers.get(id)?.erased_at;
  };

  // Resolve every row to a target id, then group.
  type ResolvedRow = ({ action: string; at: number; touches: Touch[] } | ProfileSnapshotRow) & { index: number };
  const groups = new Map<string, ResolvedRow[]>();
  const identityRetention = new Map<string, ReturnType<typeof requireRetention>[]>();
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    // The route normalized seconds/ISO input to milliseconds. Never replace an old event time with arrival time.
    if (!Number.isSafeInteger(r.at) || r.at < 0 || !Number.isFinite(new Date(r.at).getTime())) throw new Error('Historical event time unavailable');
    const targets: string[] = [];
    if (r.shopperId) {
      if (!isShopperId(r.shopperId)) { report.skipped.push({ index: i, reason: 'shopperId is not a shopper id' }); continue; }
      targets.push(r.shopperId);
    }
    if (r.accountId) targets.push(await shopperIdFor(env, tenant, r.accountId));
    if (r.visitorId) {
      if (!/^[A-Za-z0-9_.-]{1,200}$/.test(r.visitorId)) { report.skipped.push({ index: i, reason: 'visitorId is not a visitor id' }); continue; }
      if (isShopperId(r.visitorId)) targets.push(r.visitorId);
      else {
        const raw = await kv.get(`identity:visitor:${r.visitorId}`);
        if (raw === null) targets.push(r.visitorId);
        else {
          if (typeof raw !== 'string') throw new Error('Historical identity unavailable');
          let link: { visitorId?: unknown; shopperId?: unknown; retention?: unknown } | null;
          try { link = JSON.parse(raw); } catch { throw new Error('Historical identity unavailable'); }
          if (!link || Array.isArray(link) || link.visitorId !== r.visitorId
            || typeof link.shopperId !== 'string' || !isShopperId(link.shopperId)) throw new Error('Historical identity unavailable');
          const stamp = requireRetention(env, link.retention, tenant, 'identity');
          identityRetention.set(link.shopperId, [...identityRetention.get(link.shopperId) ?? [], stamp]);
          targets.push(link.shopperId);
        }
      }
    }
    if (!targets.length) { report.skipped.push({ index: i, reason: 'no shopper' }); continue; }
    const cutoffs = await Promise.all([...new Set([...targets, ...(r.visitorId ? [r.visitorId] : [])])].map(cutoff));
    if (cutoffs.some(at => at !== undefined && r.at <= at)) {
      report.skipped.push({ index: i, reason: 'event is at or before subject erasure' }); continue;
    }
    if (new Set(targets).size !== 1) { report.skipped.push({ index: i, reason: 'identity selectors disagree' }); continue; }
    const target = targets[0];
    if ('kind' in r) {
      if (r.at > now) throw new Error('Profile snapshot is in the future');
      const g = groups.get(target) ?? [];
      g.push({ kind: r.kind, version: r.version, source: r.source, at: r.at, fields: r.fields, audiences: r.audiences, index: i });
      groups.set(target, g);
      continue;
    }
    if ((cfg.weights[r.action] ?? 0) <= 0) { report.skipped.push({ index: i, reason: `action "${r.action}" has no weight` }); continue; }
    const touches = touchesOf(r, cfg);
    if (touches.length === 0) { report.skipped.push({ index: i, reason: 'no registry attribute on the row' }); continue; }
    const g = groups.get(target) ?? [];
    g.push({ action: r.action, at: r.at, touches, index: i });
    groups.set(target, g);
  }

  for (const [target, batch] of groups) {
    const person = isShopperId(target);
    let outcomes: ImportOutcome[];
    let audiences: string[];
    {
      const dependencies = identityRetention.get(target) ?? [];
      for (const stamp of dependencies) requireRetention(env, stamp, tenant, 'identity');
      const res = await importUnderOwner(env, tenant, target, { now, history: person, retentionDependencies: dependencies, rows: batch.map(row => 'kind' in row
          ? { kind: row.kind, version: row.version, source: row.source, at: row.at, fields: row.fields, audiences: row.audiences }
          : { action: row.action, at: row.at, touches: row.touches }) }) as { ok?: unknown; applied?: unknown; audiences?: unknown; reason?: unknown; outcomes?: unknown } | null;
      if (res?.ok === true && res.applied === 0 && Array.isArray(res.audiences) && res.audiences.length === 0
        && ['profile_missing', 'consent_missing', 'consent_refused'].includes(res.reason as string)) {
        report.skipped.push(...batch.map(({ index }) => ({ index, reason: res.reason as string })));
        continue;
      }
      const parsedOutcomes = z.array(z.union([
        z.object({ index: z.number().int().nonnegative(), applied: z.literal(true) }).strict(),
        z.object({ index: z.number().int().nonnegative(), applied: z.literal(false), reason: z.enum(['stale_profile', 'replayed_profile']) }).strict(),
      ])).safeParse(res?.outcomes);
      // Preserve the old behavioral acknowledgment shape for existing internal adapters.
      outcomes = res?.outcomes === undefined && batch.every(row => !('kind' in row))
        ? batch.map((_, index) => ({ index, applied: true })) : parsedOutcomes.success ? parsedOutcomes.data : [];
      if (res?.ok !== true || outcomes.length !== batch.length
        || new Set(outcomes.map(outcome => outcome.index)).size !== batch.length
        || outcomes.some(outcome => outcome.index >= batch.length || (!outcome.applied && !('kind' in batch[outcome.index])))
        || res.applied !== outcomes.filter(outcome => outcome.applied).length || !Array.isArray(res.audiences)
        || res.audiences.some(a => typeof a !== 'string') || res.reason !== undefined) throw new Error('Historical import acknowledgment unavailable');
      audiences = res.audiences as string[];
    }
    const applied = outcomes.filter(outcome => outcome.applied).map(outcome => batch[outcome.index]);
    for (const outcome of outcomes) if (!outcome.applied) report.skipped.push({ index: batch[outcome.index].index, reason: outcome.reason });
    if (applied.length) report.perShopper.push({ shopperId: target, rows: applied.length, audiences, created: false });
    report.applied += applied.length;
  }
  report.shoppers = report.perShopper.length;
  report.skipped.sort((a, b) => a.index - b.index);
  return report;
}

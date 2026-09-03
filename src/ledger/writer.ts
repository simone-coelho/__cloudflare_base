// src/ledger/writer.ts
// The consumer: messages in, batches out. Each batch is one R2 object under
// `{tenant}/{date}/{hour}/{stream}/`, and the object is NAMED by the id range it
// holds, `{minTs}-{maxTs}-{batch}.ndjson`. That name is the hour's manifest
// entry, written atomically with the batch, so two consumers draining the same
// hour never race on a shared manifest file. A point lookup lists the hour and
// opens the one or two objects whose range contains the id's time.
//
// R2 and Analytics Engine are two destinations, not one reading the other. This
// file writes R2; the producer wrote the points.

import { fromTs36, hourPrefix, parseId, ts36, type LedgerMessage } from './records';
import type { DecisionRecord } from '@/content/types';
import type { OutcomeRecord } from './records';

export interface R2Like {
  put(key: string, body: string): Promise<unknown>;
  get(key: string): Promise<{ text(): Promise<string> } | null>;
  list(opts: { prefix: string; cursor?: string; limit?: number }): Promise<{ objects: Array<{ key: string }>; truncated: boolean; cursor?: string }>;
}

export interface WrittenBatch { key: string; count: number; stream: 'decision' | 'outcome'; prefix: string }

const streamOf = (m: LedgerMessage) => m.type;
const idOf = (m: LedgerMessage) => (m.type === 'decision' ? m.record.decision_id : m.record.outcome_id);

/** Is this a ledger message with a record we can place? Anything else is dropped, and counted by the caller. */
export function isLedgerMessage(body: unknown): body is LedgerMessage {
  if (!body || typeof body !== 'object') return false;
  const m = body as { kind?: unknown; type?: unknown; record?: unknown };
  if (m.kind !== 'ledger' || (m.type !== 'decision' && m.type !== 'outcome') || !m.record || typeof m.record !== 'object') return false;
  const id = idOf(m as LedgerMessage);
  return typeof id === 'string' && parseId(id) !== null;
}

/** Group messages by stream and hour, write one object per group, return what was written. */
export async function writeBatches(r2: R2Like, messages: readonly LedgerMessage[], batchId: string): Promise<WrittenBatch[]> {
  const groups = new Map<string, { prefix: string; stream: 'decision' | 'outcome'; rows: LedgerMessage[]; min: number; max: number }>();
  for (const m of messages) {
    const id = parseId(idOf(m));
    if (!id) continue;
    const prefix = hourPrefix(id.tenant, id.ts);
    const stream = streamOf(m);
    const k = `${prefix}/${stream}`;
    const g = groups.get(k) ?? { prefix, stream, rows: [], min: Infinity, max: -Infinity };
    g.rows.push(m); g.min = Math.min(g.min, id.ts); g.max = Math.max(g.max, id.ts);
    groups.set(k, g);
  }
  const written: WrittenBatch[] = [];
  for (const g of groups.values()) {
    const key = `${g.prefix}/${g.stream}/${ts36(g.min)}-${ts36(g.max)}-${batchId}.ndjson`;
    const body = g.rows.map((m) => JSON.stringify(m.record)).join('\n') + '\n';
    await r2.put(key, body);
    written.push({ key, count: g.rows.length, stream: g.stream, prefix: g.prefix });
  }
  return written;
}

/** The objects under an hour whose id range could contain `ts`. */
export async function candidateKeys(r2: R2Like, tenant: string, ts: number, stream: 'decision' | 'outcome'): Promise<string[]> {
  const prefix = `${hourPrefix(tenant, ts)}/${stream}/`;
  const out: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await r2.list({ prefix, cursor, limit: 1000 });
    for (const o of page.objects) {
      const name = o.key.slice(prefix.length);
      const m = /^([0-9a-z]{9})-([0-9a-z]{9})-/.exec(name);
      if (!m) continue;
      if (fromTs36(m[1]!) <= ts && ts <= fromTs36(m[2]!)) out.push(o.key);
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return out;
}

/** One decision or outcome by id: parse the id, list the hour, open the candidates. No index anywhere. */
export async function findById<T extends DecisionRecord | OutcomeRecord>(r2: R2Like, id: string, stream: 'decision' | 'outcome'): Promise<{ record: T; key: string } | null> {
  const parsed = parseId(id);
  if (!parsed) return null;
  const field = stream === 'decision' ? 'decision_id' : 'outcome_id';
  for (const key of await candidateKeys(r2, parsed.tenant, parsed.ts, stream)) {
    const obj = await r2.get(key);
    if (!obj) continue;
    for (const line of (await obj.text()).split('\n')) {
      if (!line) continue;
      try {
        const rec = JSON.parse(line) as Record<string, unknown>;
        if (rec[field] === id) return { record: rec as unknown as T, key };
      } catch { /* a bad line never hides the good ones */ }
    }
  }
  return null;
}

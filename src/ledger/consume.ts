// src/ledger/consume.ts
// What the worker's queue handler calls for the ledger messages in a batch.
// Never throws: a message the writer cannot place is acknowledged and counted,
// because a poison message that retries forever would stall every ledger write
// behind it, and R2 never sees anything the consumer could not parse.

import type { Env } from '@/types/env';
import { isLedgerMessage, writeBatches, type R2Like } from './writer';
import type { LedgerMessage } from './records';

export interface ConsumeResult { written: number; objects: number; skipped: number; ok: boolean; error?: string }

/**
 * Write every placeable message in `bodies` to R2. Returns ok:false only when
 * R2 itself failed, which is the one case the caller should retry the batch.
 */
export async function consumeLedger(env: Pick<Env, 'STORAGE'>, bodies: readonly unknown[], now = Date.now()): Promise<ConsumeResult> {
  const messages: LedgerMessage[] = [];
  let skipped = 0;
  for (const b of bodies) { if (isLedgerMessage(b)) messages.push(b); else skipped++; }
  if (messages.length === 0) return { written: 0, objects: 0, skipped, ok: true };
  const batchId = `${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    const written = await writeBatches(env.STORAGE as unknown as R2Like, messages, batchId);
    return { written: messages.length, objects: written.length, skipped, ok: true };
  } catch (e) {
    return { written: 0, objects: 0, skipped, ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

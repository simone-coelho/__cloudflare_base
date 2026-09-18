import type { Consent } from '@/content/consent';
import type { SessionCapability } from '@/identity/sessionCapability';
import type { ReflexConfig } from '@/reflex/core';
import type { SearchResult, StructuredIntent } from '@/reflex/searchCandidates';
import type { SortResult, SortWeights } from '@/reflex/sortCandidates';
import type { Env } from '@/types/env';
import { admitOwnedRecovery } from '@/identity/sessionAuthority';
import { captureRetention, externalRetentionBirths } from '@/retention';
import type { RecoveryReceipt } from './recovery';
import { isProductSortRecord, PRODUCT_SORT_MAX_BYTES, ts36, type ProductSortRecord } from './records';
import type { R2Like } from './writer';

export type ProductSortPersistence = { status: 'durable'; recordId: string; receipt: RecoveryReceipt }
  | { status: 'not_scheduled'; reason: 'tracking_refused' | 'storage_unavailable' | 'context_unavailable' | 'invalid_record' | 'record_too_large' | 'capture_unavailable' };

/** Mint before profile resolution, so a pending read cannot move the erasure cutoff. */
export function productSortIdentity(principal: SessionCapability, env?: Env) {
  const ts = Date.now(), request_id = crypto.randomUUID();
  return { tenant: principal.tenant, visitor_id: principal.subject, session_id: principal.sessionId, ts, request_id,
    ...(env ? { retention: captureRetention(env, principal.tenant, ts, ts), externalRetention: externalRetentionBirths(env, principal.tenant, ts, ts) } : {}),
    record_id: `${principal.tenant}:${ts36(ts)}:${principal.subject}:product-sort:${request_id}` };
}

/** The original complete response now has owner-durable admission before it is
 * returned. Queue acceptance and canonical readback remain separate receipts. */
export async function scheduleProductSort(
  storage: R2Like | undefined,
  context: () => { waitUntil(task: Promise<unknown>): void },
  identity: ReturnType<typeof productSortIdentity>,
  consent: Consent,
  cfg: ReflexConfig,
  result: SortResult | SearchResult,
  inputCount: number,
  weights: SortWeights | undefined,
  intent: { filters: StructuredIntent['filters']; limit: number } | null = null,
  authorityEnv?: Env,
  searchContext?: ProductSortRecord['search'],
): Promise<ProductSortPersistence> {
  void context;
  if (!consent.tracking) return { status: 'not_scheduled', reason: 'tracking_refused' };
  if (!storage || typeof storage.get !== 'function' || typeof storage.put !== 'function') return { status: 'not_scheduled', reason: 'storage_unavailable' };
  const clamp = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? Math.min(10, Math.max(0, value)) : 1;
  const search = result as SearchResult;
  let record: ProductSortRecord;
  try { record = {
    version: 1, ...identity, configVersion: cfg.version, mode: intent ? 'intent' : 'sort',
    ...(searchContext ? { search: searchContext } : {}),
    consent: { tracking: true, personalization: consent.personalization },
    weights: { affinity: result.affinityWeight, dims: Object.fromEntries(cfg.dimensions.map(dim => [dim.key, clamp(weights?.dims?.[dim.key])])) },
    affinityWeight: result.affinityWeight, order: result.order, items: result.items,
    inputCount, dropped: result.dropped, filteredCount: intent ? search.filteredCount : 0,
    eligibleCount: intent ? search.eligibleCount : result.items.length, returnedCount: result.order.length,
    limit: intent?.limit ?? null,
    intent: intent ? { filters: intent.filters.map(filter => ({ dimension: filter.dimension,
      values: [...new Set(filter.values.map(value => value.trim().toLowerCase()))] })) } : null,
  };
    if (new TextEncoder().encode(JSON.stringify(record) + '\n').byteLength > PRODUCT_SORT_MAX_BYTES) return { status: 'not_scheduled', reason: 'record_too_large' };
    if (!isProductSortRecord(record)) return { status: 'not_scheduled', reason: 'invalid_record' };
  } catch { return { status: 'not_scheduled', reason: 'invalid_record' }; }

  try {
    if (!authorityEnv || authorityEnv.STORAGE !== storage) throw new Error('Product-sort authority unavailable');
    const receipt = await admitOwnedRecovery({ kind: 'product-sort', tenant: record.tenant, subject: record.visitor_id, brand: record.tenant, record });
    if (receipt.source.state === 'suppressed_erased' || receipt.source.state === 'expired_unrecovered') {
      return { status: 'not_scheduled', reason: 'capture_unavailable' };
    }
    return { status: 'durable', recordId: record.record_id, receipt };
  } catch { return { status: 'not_scheduled', reason: 'capture_unavailable' }; }
}

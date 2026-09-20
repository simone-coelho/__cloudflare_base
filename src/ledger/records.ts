// src/ledger/records.ts
// Phase 0 of the outcome-learning design (doc 22 §3): the two append-only
// streams, their message shapes, and the id arithmetic that makes a record
// findable with no index. The decision record is the §3.1 DecisionRecord the
// decision service already emits; the outcome record is §3.2.

import type { DecisionRecord } from '@/content/types';
import { z } from 'zod';
import { isEventNonce, isEventTimestamp } from '@/events/actionTypes';

/** Whole UTF-8 NDJSON receipt, including its final newline; never truncated. */
export const PRODUCT_SORT_MAX_BYTES = 1024 * 1024;
/** Match the stream segment, never a tenant or batch name with the same text. */
export const isProductSortKey = (key: string): boolean => /^[^/]+\/[^/]+\/[^/]+\/product-sort\//.test(key);
export const isLearningKey = (key: string): boolean => /^[^/]+\/\d{4}-\d{2}-\d{2}\/\d{2}\/(?:decision|outcome)\//.test(key);
const productNumber = z.number().finite().nonnegative();
const productCount = z.number().int().min(0).max(500);
const productWeight = productNumber.max(10);
const productSortSchema = z.object({
  retention: z.custom<import('@/retention').CaptureRetention>().optional(),
  externalRetention: z.custom<import('@/retention').ExternalRetention>().optional(),
  search: z.object({ schema: z.literal('catalog-search-context/v1'), catalogRevision: z.string().min(1).max(128),
    catalogAsOf: z.number().int().safe().nonnegative(), catalogDigest: z.string().regex(/^[a-f0-9]{64}$/),
    configurationDigest: z.string().regex(/^[a-f0-9]{64}$/), interpretationId: z.string().uuid(),
    intent: z.object({ supported: z.literal(true),
      filters: z.array(z.object({ dimension: z.string().min(1).max(96), values: z.array(z.string().min(1).max(128)).min(1).max(32) }).strict()).max(32),
      exclusions: z.array(z.object({ dimension: z.string().min(1).max(96), values: z.array(z.string().min(1).max(128)).min(1).max(32) }).strict()).max(32),
      price: z.object({ currency: z.string().regex(/^[A-Z]{3}$/), minMinor: z.number().int().safe().nonnegative().nullable(), maxMinor: z.number().int().safe().nonnegative().nullable() }).strict().nullable(),
      gift: z.enum(['any', 'required', 'exclude']), unsupported: z.array(z.string()).length(0),
    }).strict(),
  }).strict().optional(),
  version: z.literal(1),
  record_id: z.string(),
  request_id: z.string().uuid(),
  tenant: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/i),
  visitor_id: z.string().regex(/^[A-Za-z0-9_.-]{1,200}$/),
  session_id: z.string().regex(/^[A-Za-z0-9_.-]{1,200}$/),
  ts: z.number().int().nonnegative().refine(n => Number.isSafeInteger(n) && Number.isFinite(new Date(n).getTime())),
  configVersion: z.string().min(1),
  mode: z.enum(['sort', 'intent']),
  consent: z.object({ tracking: z.literal(true), personalization: z.boolean() }).strict(),
  weights: z.object({ affinity: productWeight, dims: z.record(z.string(), productWeight) }).strict(),
  affinityWeight: productWeight,
  order: z.array(z.string().min(1)).max(500),
  items: z.array(z.object({
    id: z.string().min(1), feedRank: productCount, rank: productCount, score: productNumber,
    drivers: z.array(z.object({ dim: z.string(), value: z.string(), a: productNumber, w: productWeight, contribution: productNumber }).strict()),
  }).strict()).max(500),
  inputCount: productCount, dropped: productCount, filteredCount: productCount, eligibleCount: productCount,
  returnedCount: productCount,
  limit: z.number().int().min(1).max(500).nullable(),
  intent: z.object({ filters: z.array(z.object({
    dimension: z.string().min(1).max(64),
    // Lowercasing a validated 128-unit request value can double its length.
    values: z.array(z.string().min(1).max(256)).min(1).max(8),
  }).strict()).max(16) }).strict().nullable(),
}).strict().refine(r => r.record_id === `${r.tenant}:${ts36(r.ts)}:${r.visitor_id}:product-sort:${r.request_id}`
  && r.weights.affinity === r.affinityWeight
  && r.inputCount === r.dropped + r.filteredCount + r.eligibleCount
  && r.returnedCount === r.order.length && r.items.length === r.order.length
  && new Set(r.order).size === r.order.length
  && r.items.every((item, index) => item.id === r.order[index] && item.rank === index && item.feedRank < r.inputCount
    && (r.consent.personalization || (item.score === 0 && item.drivers.length === 0)))
  && new Set(r.items.map(item => item.feedRank)).size === r.items.length
  && (r.mode === 'sort' ? r.intent === null && r.limit === null && r.filteredCount === 0 && r.returnedCount === r.eligibleCount
    : r.intent !== null && r.limit !== null && r.returnedCount === Math.min(r.limit, r.eligibleCount)
      && new Set(r.intent.filters.map(f => f.dimension)).size === r.intent.filters.length
      && r.intent.filters.every(f => f.dimension === f.dimension.trim() && f.values.every(v => v === v.trim().toLowerCase()))));

/** A ranking response, not a rendered exposure or a content-learning decision. */
export type ProductSortRecord = z.infer<typeof productSortSchema>;
export type ProductSortMessage = { kind: 'ledger'; type: 'product-sort'; version?: 1; delivery_id?: string; record: ProductSortRecord };

export function isProductSortRecord(value: unknown): value is ProductSortRecord {
  try {
    return new TextEncoder().encode(JSON.stringify(value) + '\n').byteLength <= PRODUCT_SORT_MAX_BYTES
      && productSortSchema.safeParse(value).success;
  } catch { return false; }
}

export const behaviorItemSchema = z.object({ id: z.string().min(1).max(200).optional(), productId: z.string().min(1).max(200).optional(),
  product_id: z.string().min(1).max(200).optional(), sku: z.string().min(1).max(200).optional(), item_id: z.string().min(1).max(200).optional(),
  quantity: z.number().finite().nonnegative().optional(), value: z.number().finite().optional(), price: z.number().finite().nonnegative().optional(),
  margin: z.number().finite().optional(), currency: z.string().regex(/^[A-Z]{3}$/).optional(),
}).strict().refine(item=>!!(item.id||item.productId||item.product_id||item.sku||item.item_id));
const behaviorSchema = z.object({ version: z.literal(1), record_id: z.string(), event_id: z.string().refine(isEventNonce),
  event_id_source: z.enum(['provided', 'request']), tenant: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/i),
  brand: z.string().min(1).max(64), visitor_id: z.string().regex(/^[A-Za-z0-9_.-]{1,200}$/),
  session_id: z.string().max(200).nullable(), ts: z.number().refine(isEventTimestamp),
  event: z.string().min(1).max(128), source: z.string().min(1).max(128),
  data: z.record(z.string().max(96), z.union([z.string().max(2000), z.number().finite(), z.boolean(), z.null(), z.array(z.string().max(256)).max(100), z.array(behaviorItemSchema).max(500)]))
    .refine(v => Object.keys(v).length <= 64 && Object.keys(v).every(k => !['__proto__', 'constructor', 'prototype'].includes(k))),
  retention: z.custom<import('@/retention').CaptureRetention>(),
  externalRetention: z.custom<import('@/retention').ExternalRetention>().optional(),
}).strict().refine(r => r.brand === r.tenant && r.record_id === `${r.tenant}:${ts36(r.ts)}:${r.visitor_id}:behavior:${r.event_id}`);
export type BehaviorRecord = z.infer<typeof behaviorSchema>;
export type BehaviorMessage = { kind: 'ledger'; type: 'behavior'; version?: 1; delivery_id?: string; record: BehaviorRecord };
export function isBehaviorRecord(value: unknown): value is BehaviorRecord {
  try { return new TextEncoder().encode(JSON.stringify(value) + '\n').length <= 128 * 1024 && behaviorSchema.safeParse(value).success; }
  catch { return false; }
}
export type LedgerStream = 'decision' | 'outcome' | 'product-sort' | 'behavior';
export type CapturedMessage = LedgerMessage | ProductSortMessage | BehaviorMessage;
export type CapturedRecord = CapturedMessage['record'];
export const recordStream = (row: CapturedRecord): LedgerStream => 'decision_id' in row && !('outcome_id' in row) ? 'decision'
  : 'outcome_id' in row ? 'outcome' : 'event_id' in row ? 'behavior' : 'product-sort';

export type RewardType = 'click' | 'dwell' | 'video_complete' | 'wishlist' | 'add_to_bag' | 'purchase' | 'custom';

/** Validate original evidence kind before any online/offline counter can see it. */
export function validDecisionMeasurement(value: Pick<DecisionRecord, 'measurementBasis' | 'rendered' | 'ts'>): boolean {
  const basis = value.measurementBasis ?? 'served-v1';
  if (basis === 'served-v1') return value.rendered === undefined;
  const r = value.rendered;
  return basis === 'rendered-v1' && !!r && r.version === 1 && isEventNonce(r.eventId) && isEventNonce(r.pageInstance)
    && isEventTimestamp(r.at) && r.at >= value.ts
    && Object.keys(r).sort().join(',') === 'at,eventId,pageInstance,version';
}

/** Doc 22 §3.2. One per reward-bearing event. */
export interface OutcomeRecord {
  retention?: import('@/retention').CaptureRetention;
  outcome_id: string;
  /** Optional exact receipt selector. Absent is legacy attribution, never an invalid-reference fallback. */
  decision_id?: string;
  event_id?: string;
  event_id_source?: 'provided' | 'request';
  tenant: string;
  brand: string;
  visitor_id: string;
  session_id: string | null;
  ts: number;
  type: RewardType;
  /** The wire event name, so a custom reward keeps its own name. */
  event: string;
  item_id: string | null;
  slot: string | null;
  value: number | null;
  currency: string | null;
  /** CW27: the outcome's margin when the feed gives one (`data.margin`, or the items' margins summed); null otherwise. */
  margin: number | null;
  /** CW32: the products the outcome names (`data.items[].id`, `productId`, `sku`), so a purchase can credit the content that featured one of them. Null when none. */
  products: string[] | null;
  arm: string | null;
  /**
   * W21 E1.03: the experiment the visitor is enrolled in, resolved from her
   * persistent enrollment anchor when this outcome was recorded. Absent on
   * records written before enrollment was persistent, on a visitor the platform
   * could not resolve, and on one who is not eligible for the experiment.
   */
  experiment?: import('@/content/types').EnrollmentProvenance;
}

export type LedgerMessage =
  | { kind: 'ledger'; type: 'decision'; version?: 1; delivery_id?: string; record: DecisionRecord }
  | { kind: 'ledger'; type: 'outcome'; version?: 1; delivery_id?: string; record: OutcomeRecord };
/** Independently readable, byte-bounded full-record chunks; unversioned legacy sets remain readable. */
export type LedgerSetMessage = { kind: 'ledger'; type: 'decisions'; version?: 1; delivery_id?: string; records: DecisionRecord[] };
export type LedgerWireMessage = CapturedMessage | LedgerSetMessage;

export const LEDGER_KIND = 'ledger' as const;

/** Fixed-width base-36 milliseconds, so lexicographic order is time order until well past this century. */
export const TS_WIDTH = 9;
export const ts36 = (ms: number): string => Math.max(0, Math.floor(ms)).toString(36).padStart(TS_WIDTH, '0');
export const fromTs36 = (s: string): number => parseInt(s, 36);

/** `{tenant}/{yyyy-mm-dd}/{hh}`: the brand and the hour, derivable from a record's tenant and time. */
export function hourPrefix(tenant: string, ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${tenant}/${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}/${p(d.getUTCHours())}`;
}

/**
 * The id is `{tenant}:{ts36}:{rest}`, assigned at decision time (doc 22 §3.4).
 * Tenant first and time second is what lets a pasted id resolve on its own.
 */
export function parseId(id: string): { tenant: string; ts: number } | null {
  const m = /^([a-z0-9][a-z0-9_-]{0,63}):([0-9a-z]+):/i.exec(id);
  if (!m) return null;
  const ts = fromTs36(m[2]!);
  return Number.isFinite(ts) ? { tenant: m[1]!, ts } : null;
}

/** Same 2048-byte receipt bound as the ring/report; this selector conveys no routing authority. */
export function isDecisionReference(value: unknown): value is string {
  if (typeof value !== 'string' || !value.length || value !== value.trim() || value.length > 2048 || new TextEncoder().encode(value).length > 2048) return false;
  const carrier = parseId(value), parts = value.split(':');
  return carrier !== null && Number.isSafeInteger(carrier.ts) && carrier.ts >= 0
    && Number.isFinite(new Date(carrier.ts).getTime()) && parts.length >= 6
    && /^[A-Za-z0-9_.-]{1,200}$/.test(parts[2]!);
}

// ── Outcomes from actions ────────────────────────────────────────────────────

/** The action names that are rewards, and what reward type they are. */
const REWARD_OF: Record<string, RewardType> = {
  add_to_cart: 'add_to_bag', cart_add: 'add_to_bag',
  wishlist_add: 'wishlist', wishlist: 'wishlist',
  purchase: 'purchase', checkout: 'purchase', order_complete: 'purchase',
  content_click: 'click', click: 'click',
  content_dwell: 'dwell', dwell: 'dwell',
  video_complete: 'video_complete',
};

export interface ActionLike {
  eventId?: string;
  eventIdSource?: 'provided' | 'request';
  type: string;
  userId: string;
  sessionId?: string | null;
  timestamp?: number;
  data?: Record<string, unknown>;
}

/**
 * The reward a wire event carries, or null. A `custom` event's real name lives
 * in `data.event`, which is how the SDK sends content interactions and the
 * conversion until the server names them first-class (CW3).
 */
export function rewardOf(action: Pick<ActionLike, 'type' | 'data'>): { type: RewardType; event: string } | null {
  const name = action.type === 'custom' && typeof action.data?.event === 'string' ? action.data.event : action.type;
  const type = REWARD_OF[name];
  return type ? { type, event: name } : null;
}

/**
 * W26 U1.01 (F21 §5 item 5): what the learning loop counts, said in one place a
 * caller can read.
 *
 * The wire carries events the loop learns from and events it does not, and
 * until now the difference was only an ABSENCE — `REWARD_OF` has no
 * `content_impression` row, so a viewable impression is thrown away silently
 * and an integrator reading the event list cannot tell a signal that is counted
 * from one that is accepted and discarded. This states it: `counted: false`
 * with the reason, or `counted: true` with the reward and the event name the
 * outcome record will carry.
 *
 * It is DERIVED from `rewardOf` — the function `outcomeFromAction` itself
 * consults — and never from a second table, so the declaration cannot drift
 * away from the engine when a reward is added or removed. It decides nothing
 * and gates nothing: it only reports what the engine already does.
 */
export type LearningInput =
  | { counted: true; reward: RewardType; event: string }
  | { counted: false; reason: 'not-a-learning-input' };

export function learningInputOf(action: Pick<ActionLike, 'type' | 'data'>): LearningInput {
  const reward = rewardOf(action);
  return reward === null
    ? { counted: false, reason: 'not-a-learning-input' }
    : { counted: true, reward: reward.type, event: reward.event };
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null);

/** The margin the feed gave, if any: `data.margin`, else the items' margins (× quantity) summed. */
function marginOf(d: Record<string, unknown>): number | null {
  const direct = num(d.margin);
  if (direct !== null) return direct;
  if (!Array.isArray(d.items)) return null;
  let sum = 0, any = false;
  for (const it of d.items as unknown[]) {
    if (!it || typeof it !== 'object') continue;
    const m = num((it as Record<string, unknown>).margin);
    if (m === null) continue;
    any = true; sum += m * (num((it as Record<string, unknown>).quantity) ?? 1);
  }
  return any ? Math.round(sum * 100) / 100 : null;
}

/** The product ids an event names: `productId` / `product_id` / `sku` on the event, and the same on each of `items[]`. */
function productsOf(d: Record<string, unknown>): string[] | null {
  const out = new Set<string>();
  for (const k of ['productId', 'product_id', 'sku']) { const v = str(d[k]); if (v) out.add(v); }
  if (Array.isArray(d.items)) for (const it of d.items as unknown[]) {
    if (!it || typeof it !== 'object') continue;
    const r = it as Record<string, unknown>;
    const v = str(r.id) ?? str(r.productId) ?? str(r.product_id) ?? str(r.sku) ?? str(r.item_id);
    if (v) out.add(v);
  }
  return out.size ? [...out] : null;
}

/**
 * Build the §3.2 record from a wire action, or null when the action is not a reward.
 *
 * W26 C1.01 (F21 §6(c), §8): the outcome's BRAND is the brand the shopper's page
 * was served under, which the action itself names in `data.brand` — the same
 * value the decision request carried. It was defaulted to the tenant id before,
 * and for the first tenant that actually uses brands that put the numerator in
 * one statistics object and the denominator in another. It is resolved HERE,
 * once, from what the caller already holds: no second read, nothing to fail on
 * the serving path, and no branch on the host. An action that names no brand
 * keeps the caller's brand (the tenant by default), so every client that never
 * sent one goes on learning exactly as it did.
 */
export function outcomeFromAction(action: ActionLike, tenant: string, brand = tenant, arm: string | null = null): OutcomeRecord | null {
  const d = action.data ?? {}, hasDecision = Object.prototype.hasOwnProperty.call(d, 'decisionId');
  if (hasDecision && !isDecisionReference(d.decisionId)) throw new Error('Invalid decision reference');
  const hasNonce = Object.prototype.hasOwnProperty.call(action, 'eventId');
  if (hasNonce && (!isEventNonce(action.eventId) || !isEventTimestamp(action.timestamp))) throw new Error('Invalid event identity');
  if (action.eventIdSource !== undefined && (!hasNonce || !['provided', 'request'].includes(action.eventIdSource))) throw new Error('Invalid event identity source');
  const reward = rewardOf(action);
  if (!reward) return null;
  const ts = typeof action.timestamp === 'number' && Number.isFinite(action.timestamp) ? action.timestamp : Date.now();
  return {
    outcome_id: `${tenant}:${ts36(ts)}:${action.userId}:${reward.event}${hasNonce ? `:n1:${action.eventId}` : ''}`,
    ...(hasDecision ? { decision_id: d.decisionId as string } : {}),
    ...(hasNonce ? { event_id: action.eventId, event_id_source: action.eventIdSource ?? 'provided' } : {}),
    tenant, brand: str(d.brand) ?? brand,
    visitor_id: action.userId,
    session_id: str(action.sessionId) ,
    ts,
    type: reward.type,
    event: reward.event,
    item_id: str(d.contentId) ?? str(d.productId) ?? str(d.product_id) ?? str(d.sku) ?? str(d.orderId),
    slot: str(d.slot),
    value: num(d.value) ?? num(d.price) ?? null,
    currency: str(d.currency),
    margin: marginOf(d),
    products: productsOf(d),
    arm,
  };
}

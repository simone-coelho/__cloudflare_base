// src/ledger/records.ts
// Phase 0 of the outcome-learning design (doc 22 §3): the two append-only
// streams, their message shapes, and the id arithmetic that makes a record
// findable with no index. The decision record is the §3.1 DecisionRecord the
// decision service already emits; the outcome record is §3.2.

import type { DecisionRecord } from '@/content/types';

export type RewardType = 'click' | 'dwell' | 'video_complete' | 'wishlist' | 'add_to_bag' | 'purchase' | 'custom';

/** Doc 22 §3.2. One per reward-bearing event. */
export interface OutcomeRecord {
  outcome_id: string;
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
}

export type LedgerMessage =
  | { kind: 'ledger'; type: 'decision'; record: DecisionRecord }
  | { kind: 'ledger'; type: 'outcome'; record: OutcomeRecord };
/** One message per decision set (2026-09-05, doc 31): nine records in one message, not nine messages, so a busy hour is dozens of objects, not thousands. */
export type LedgerSetMessage = { kind: 'ledger'; type: 'decisions'; records: DecisionRecord[] };
export type LedgerWireMessage = LedgerMessage | LedgerSetMessage;

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
export function rewardOf(action: ActionLike): { type: RewardType; event: string } | null {
  const name = action.type === 'custom' && typeof action.data?.event === 'string' ? action.data.event : action.type;
  const type = REWARD_OF[name];
  return type ? { type, event: name } : null;
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

/** Build the §3.2 record from a wire action, or null when the action is not a reward. */
export function outcomeFromAction(action: ActionLike, tenant: string, brand = tenant, arm: string | null = null): OutcomeRecord | null {
  const reward = rewardOf(action);
  if (!reward) return null;
  const ts = typeof action.timestamp === 'number' && Number.isFinite(action.timestamp) ? action.timestamp : Date.now();
  const d = action.data ?? {};
  return {
    outcome_id: `${tenant}:${ts36(ts)}:${action.userId}:${reward.event}`,
    tenant, brand,
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

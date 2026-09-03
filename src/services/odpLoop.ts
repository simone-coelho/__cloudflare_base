// src/services/odpLoop.ts
// ─────────────────────────────────────────────────────────────────────────────
// The ODP loop (doc 16 §8): the edge is the REFLEX, ODP is the MEMORY.
//
//   forward:  every behavioral event → ODP `/v3/events` (async, waitUntil — the
//             hot path never waits on ODP)
//   seed:     qualified real-time audiences ← ODP `/v3/graphql` once per session
//             + refreshed every ~2 min (ODP's own RTS cadence is ~a minute)
//
// ADDITIVE BY DESIGN: gated only on ODP creds being present; the mock connector
// triad stays untouched (no CONNECTOR_MODE flip — 'live' would swap all three
// connectors and the unwired ones throw). ODP being slow or down degrades to
// exactly the pre-ODP behavior: the edge keeps qualifying on its own.
//
// Wire contract — LIVE-VERIFIED against the Coach RTS instance (2026-07-03):
//   • events: type:"product" + action:"detail"/"add_to_cart", flattened product_*
//     fields, identifiers.vuid — accepted 202; High Purchase Intent QUALIFIED
//     end-to-end off these events. NOTE: the RTS builder's "Product Detail"
//     behavior = action "detail" (read off the segment UI) — the handoff note
//     saying action "view" was imprecise and cost the three attribute segments.
//   • vuid MUST be char(32) (API-validated) → SHA-256(sessionId) → 32 hex.
//     Session-derived: stable across reloads; "New shopper" mints a fresh one.
//   • GraphQL `audiences(subset: [...])` takes THE LIST OF AUDIENCE NAMES you
//     care about (API-validated) — NOT a category filter. Our old spec's
//     subset:["realtime"] silently returned nothing.
// ─────────────────────────────────────────────────────────────────────────────

import { shopperObject } from '@/tenancy/objects';
import { DEFAULT_TENANT, type TenantId } from '@/tenancy/tenant';
import type { Env } from '@/types/env';
import { CatalogService, priceBandOf, type Product } from './CatalogService';
import type { ActionEvent } from './RealtimeSegmentEngine';

/** The audiences the ODP team mirrored 1:1 with our edge keys (handoff 2026-07-03).
    GraphQL subset queries MUST enumerate names — unknown names risk validation
    errors, so we ask only for the mirrored set. Extend as ODP mirrors more. */
export const ODP_MIRRORED_AUDIENCES = [
  'line_tabby_affinity',
  'silhouette_tote_affinity',
  'occasion_evening_affinity',
  'luxe_affinity',
  'late_journey_ready_to_buy',
] as const;

export function odpEnabled(env: Env): boolean {
  return Boolean(env.ODP_API_HOST && env.ODP_PUBLIC_KEY);
}

/**
 * Who ODP thinks this is.
 *
 * THE CUTOVER (CW7b). The vuid used to be SHA-256(sessionId), which meant a new
 * session was a new person: a cleared cookie, a new device, or simply coming back
 * tomorrow produced a profile ODP had never seen. Every durable memory claim in
 * the scope appendix rests on this identifier, and so does doc 22's visit bucket,
 * because a visit count is only as good as the thing it is counted against.
 *
 * The stable id already existed. The client has minted and persisted
 * `opt_visitor_id` in localStorage with a cookie fallback for some time, and
 * sends it as `userId` on every action; it is also the name the per-shopper
 * Durable Object is keyed on. Only the ODP derivation was still reading the
 * session.
 */
export interface OdpIdentity {
  /** The stable first-party visitor id (`opt_visitor_id`). Preferred. */
  visitorId?: string | null;
  /** The session id. Used ONLY when no stable id is available. */
  sessionId: string;
}

/**
 * The string the vuid is derived from, and whether it is the stable one.
 *
 * The fallback is deliberate rather than defensive: a client that predates the
 * stable id, or one with localStorage and cookies both blocked, still gets a
 * working profile for the length of its session. It is worse, and it is not
 * nothing, and nothing throws.
 */
export function identityKeyOf(identity: OdpIdentity): { key: string; stable: boolean } {
  const v = typeof identity.visitorId === 'string' ? identity.visitorId.trim() : '';
  return v !== '' ? { key: v, stable: true } : { key: identity.sessionId, stable: false };
}

/** char(32) vuid from an identity key — ODP validates the length hard. */
export async function vuidFrom(key: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
  return [...new Uint8Array(digest)]
    .slice(0, 16)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** The vuid for a shopper: stable across sessions wherever the stable id exists. */
export async function vuidFor(identity: OdpIdentity): Promise<string> {
  return vuidFrom(identityKeyOf(identity).key);
}

/**
 * @deprecated Session-derived, so it produces a NEW person per session. Kept
 * because it is the pre-cutover behaviour and its test pins the hash. Call
 * vuidFor() with an OdpIdentity instead.
 */
export async function vuidFromSession(sessionId: string): Promise<string> {
  return vuidFrom(sessionId);
}

// One catalog per isolate — never rebuild the affinity graph per event.
let _catalog: CatalogService | null = null;
function catalog(): CatalogService {
  return (_catalog = _catalog ?? new CatalogService());
}

/** Our internal action names → the ODP wire taxonomy the RTS conditions fire on. */
export function mapActionToOdp(
  event: ActionEvent
): { type: string; action?: string; data: Record<string, unknown> } | null {
  const data = event.data ?? {};
  const action = String(data.action ?? data.eventName ?? event.type);
  const productId: string | undefined = data.productId ?? data.product_id ?? data.sku;
  const product: Product | undefined = productId ? catalog().getProduct(String(productId)) : undefined;

  const productFields = (p: Product): Record<string, unknown> => ({
    product_id: p.id,
    // Flattened catalog attributes (spec §3/§4) so RTS can qualify without a join;
    // the product OBJECTS are also uploaded, so attribute-join conditions work too.
    product_line: p.line,
    product_silhouette: p.silhouette,
    product_subcategory: p.subcategory,
    product_occasions: (p.occasion || []).join(','),
    product_price_band: priceBandOf(p.price_usd),
  });

  switch (action) {
    case 'product_view':
    case 'pdp_view':
    case 'view_product':
      if (!product) return null;
      // ODP's standard PDP-view action is "detail" — the RTS conditions are built
      // on the "Product Detail" behavior (confirmed from the segment UI).
      return { type: 'product', action: 'detail', data: productFields(product) };
    case 'add_to_cart':
    case 'cart_add':
      if (!product) return null;
      return { type: 'product', action: 'add_to_cart', data: productFields(product) };
    case 'wishlist':
    case 'wishlist_add':
    case 'add_to_wishlist':
    case 'save_for_later':
      if (!product) return null;
      return { type: 'product', action: 'save_for_later', data: productFields(product) };
    case 'page_view':
      return { type: 'pageview', data: { page: typeof data.path === 'string' ? data.path : '/' } };
    default:
      return null; // internal signals (reflex_tick, xsurf_*, …) never leave the edge
  }
}

/**
 * REST event → the FLAT `recent_events` shape (Lancelot's reference, Part 1):
 * fields sit at the event's top level (NOT under `data`), `ts` is epoch SECONDS,
 * and each event carries an idempotence_id so replays dedupe.
 */
export function toRecentEventFlat(
  mapped: { type: string; action?: string; data: Record<string, unknown> },
  tsMs: number
): Record<string, unknown> {
  return {
    idempotence_id: crypto.randomUUID(),
    type: mapped.type,
    ...(mapped.action ? { action: mapped.action } : {}),
    ts: Math.floor(tsMs / 1000),
    ...mapped.data,
  };
}

/**
 * Maintain the session's ring of recent events in the FLAT `recent_events` shape
 * (≤10 entries, ≤55 min — inside the segments' 3600s windows). Pure policy,
 * shared by the request-path engine AND the ShopperReflex DO (doc 16 §6, P2) so
 * ring semantics can never drift between hosts. Returns a NEW array; events that
 * don't map to the ODP taxonomy return the input ring unchanged.
 */
export function updateOdpRing(
  ring: Array<Record<string, unknown>>,
  event: ActionEvent,
  nowMs: number
): Array<Record<string, unknown>> {
  const mapped = mapActionToOdp(event);
  if (!mapped) return ring;
  const next = [...ring, toRecentEventFlat(mapped, nowMs)];
  const floorTs = Math.floor(nowMs / 1000) - 3300;
  return next.filter((e) => typeof e.ts === 'number' && (e.ts as number) > floorTs).slice(-10);
}

/**
 * Seed read policy (doc 16 §8), shared by both hosts: a reflex membership CHANGE
 * forces an instant read (the "· ODP" badge lands on the very action that caused
 * the entry — recent_events makes the answer ~200ms); otherwise throttle to 10s
 * while events flow / 120s idle. `seedAt` advances even when the read fails —
 * natural retry on the next boundary. Behavior-identical to the engine's
 * original inline policy (it moved here verbatim for the P2 DO).
 */
export async function refreshOdpSeedIfDue(
  env: Env,
  identity: OdpIdentity,
  ring: Array<Record<string, unknown>>,
  current: { seed: string[]; seedAt: number },
  nowMs: number,
  membershipChanged: boolean
): Promise<{ seed: string[]; seedAt: number }> {
  const throttle = ring.length ? 10_000 : 120_000;
  if (!membershipChanged && nowMs - current.seedAt <= throttle) return current;
  const fetched = await fetchOdpAudiences(env, identity, ring);
  return { seed: fetched ?? current.seed, seedAt: nowMs };
}

/** Serialize a flat object as a GraphQL literal (bare keys), pre-escaped for our
    manually-built JSON body (strings land as \" in the body string). */
export function gqlObjectLiteral(obj: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    if (typeof v === 'number') parts.push(`${k}: ${v}`);
    else parts.push(`${k}: \\"${String(v).replace(/\\/g, '').replace(/"/g, '')}\\"`);
  }
  return `{${parts.join(', ')}}`;
}

/** Fire-and-forget event forward (call via executionCtx.waitUntil). Never throws.
    When a receiptId is supplied, the ODP response status is pushed to the shopper as
    an `odp_receipt` — the feed's "dispatched → ✓ 202" upgrade. By default that push
    goes to the PersonalizationWebSocket relay DO (the request-path transport); a
    host owning its OWN sockets (the ShopperReflex DO, doc 16 §6 — no cross-object
    hop) supplies `pushReceipt` and the receipt is delivered through it instead. */
export async function forwardEventToOdp(
  env: Env,
  event: ActionEvent,
  identity: OdpIdentity,
  receiptId?: string,
  pushReceipt?: (data: { receiptId: string; status: number; ts: number; source: string }) => void,
  /**
   * The brand whose socket receives the receipt. Two brands share a visitor id,
   * so without this the receipt for one is pushed to a socket the other is also
   * addressed by.
   */
  tenant: TenantId = DEFAULT_TENANT,
): Promise<void> {
  try {
    if (!odpEnabled(env)) return;
    const mapped = mapActionToOdp(event);
    if (!mapped) return;
    const vuid = await vuidFor(identity);
    const res = await fetch(`${env.ODP_API_HOST}/v3/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': env.ODP_PUBLIC_KEY as string },
      body: JSON.stringify({ ...mapped, identifiers: { vuid } }),
    });
    if (!res.ok) console.warn(`[odp] event forward ${res.status}: ${(await res.text()).slice(0, 200)}`);
    if (receiptId) {
      const receipt = { receiptId, status: res.status, ts: Date.now(), source: 'odp' };
      try {
        if (pushReceipt) {
          pushReceipt(receipt);
        } else {
          const stub = shopperObject(env.PERSONALIZATION_WEBSOCKET, event.userId, tenant);
          await stub.fetch('https://internal/broadcast', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              type: 'odp_receipt',
              userId: event.userId,
              data: receipt,
            }),
          });
        }
      } catch { /* receipt push is chrome — never let it fail the forward */ }
    }
  } catch (e) {
    console.warn('[odp] event forward failed:', e instanceof Error ? e.message : e);
  }
}

/**
 * §4 profile upsert (Lancelot's reference, Part 2): persist the edge's LIVE
 * affinity scores onto the ODP profile — the reflex's numbers, on the memory's
 * record, queryable back by vuid. Called on membership changes via waitUntil.
 */
export async function upsertOdpProfile(
  env: Env,
  identity: OdpIdentity,
  affinity: { dims?: Record<string, Record<string, number>>; audiences?: string[] },
  journeyStage?: string
): Promise<void> {
  try {
    if (!odpEnabled(env)) return;
    const vuid = await vuidFor(identity);
    const dims = affinity.dims ?? {};
    const lines = dims.line ?? {};
    const dominant = Object.entries(lines).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
    const attributes: Record<string, unknown> = {
      vuid,
      line_affinity_tabby: lines.Tabby ?? 0,
      silhouette_affinity_tote: dims.silhouette?.tote ?? 0,
      occasion_affinity_evening: dims.occasion?.evening ?? 0,
      dominant_line: dominant,
      journey_stage: journeyStage ?? '',
    };
    const res = await fetch(`${env.ODP_API_HOST}/v3/profiles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': env.ODP_PUBLIC_KEY as string },
      body: JSON.stringify([{ attributes }]),
    });
    if (!res.ok) console.warn(`[odp] profile upsert ${res.status}: ${(await res.text()).slice(0, 200)}`);
  } catch (e) {
    console.warn('[odp] profile upsert failed:', e instanceof Error ? e.message : e);
  }
}

/**
 * Read the session's qualified ODP real-time audiences (the SEED).
 * Hard-capped at 1500ms — ODP slowness must never hold the storefront hostage.
 * Returns null on any failure/timeout so the caller keeps its previous seed.
 *
 * With `recentEvents` (the session's ring of FLAT events, Part 1 of the ODP
 * reference) the evaluation is INSTANT (~85–200ms P99): the events are injected
 * inline, so qualification lands on the SAME action that caused it — no waiting
 * for the ingest/RTS cycle. Nothing is persisted by the read; the durable write
 * still happens via the normal /v3/events forward.
 */
export async function fetchOdpAudiences(
  env: Env,
  identity: OdpIdentity,
  recentEvents?: Array<Record<string, unknown>>
): Promise<string[] | null> {
  try {
    if (!odpEnabled(env)) return null;
    const vuid = await vuidFor(identity);
    const subset = ODP_MIRRORED_AUDIENCES.map((k) => `\\"${k}\\"`).join(',');
    const recentArg = recentEvents && recentEvents.length
      ? `, recent_events: [${recentEvents.map(gqlObjectLiteral).join(', ')}]`
      : '';
    const query = `query { customer(vuid: \\"${vuid}\\") { audiences(subset: [${subset}]${recentArg}) { edges { node { name state } } } } }`;
    const res = (await Promise.race([
      fetch(`${env.ODP_API_HOST}/v3/graphql`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': env.ODP_PUBLIC_KEY as string },
        body: `{"query":"${query}"}`,
      }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('odp seed timeout')), 1500)),
    ])) as Response;
    if (!res.ok) return null;
    const json = (await res.json()) as {
      data?: { customer?: { audiences?: { edges?: Array<{ node: { name: string; state: string } }> } } };
      errors?: unknown[];
    };
    if (json.errors?.length) {
      console.warn('[odp] seed graphql errors:', JSON.stringify(json.errors).slice(0, 200));
      return null;
    }
    const edges = json.data?.customer?.audiences?.edges ?? [];
    return edges.filter((e) => e.node.state === 'qualified').map((e) => e.node.name);
  } catch (e) {
    console.warn('[odp] seed failed:', e instanceof Error ? e.message : e);
    return null;
  }
}

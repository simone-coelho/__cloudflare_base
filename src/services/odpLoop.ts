// src/services/odpLoop.ts
// ─────────────────────────────────────────────────────────────────────────────
// The ODP loop (doc 16 §8): the edge is the REFLEX, ODP is the MEMORY.
//
//   forward:  every behavioral event → ODP `/v3/events` (async, waitUntil — the
//             hot path never waits on ODP)
//   seed:     qualified real-time audiences ← ODP `/v3/graphql` once per session
//             + refreshed every ~2 min (ODP's own RTS cadence is ~a minute)
//
// The legacy Coach contract belongs only to the default tenant. Its credentials,
// taxonomy and identity mapping are not a customer connector configuration.
// Within that owner, ODP is additive when credentials are present; the mock connector
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

import { actionOf } from '@/reflex/contentTelemetry';
import { shopperObject } from '@/tenancy/objects';
import { DEFAULT_TENANT, type TenantId } from '@/tenancy/tenant';
import type { Env } from '@/types/env';
import { ownerFetch, currentOwnerConsent, currentProfileBirth, currentExternalRetention, requireConsentPurpose, pinRetention } from '@/identity/sessionAuthority';
import { destinationRetentionCategory, retentionPolicy, type ExternalRetention } from '@/retention';
import { CatalogService, priceBandOf, type Product } from './CatalogService';
import type { ActionEvent } from './RealtimeSegmentEngine';
import { connectorConfiguration, connectorDigest, connectorIdentity, connectorSecret, legacyConnectors, type OdpConfiguration } from '@/connectors/config';
import { PERSISTED_STAGE, type JourneyWord } from '@/services/JourneyStage';
import { admittedTouches, effectiveScore, emptyState, type CatalogVocabulary, type ReflexConfig, type ReflexEntry, type ReflexState, type Touch } from '@/reflex/core';
import { personalizes, type Consent } from '@/content/consent';
import { SessionAccessError, type SessionCapability } from '@/identity/sessionCapability';
import { loadTombstone } from '@/ledger/erasure';

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

export function isLegacyOdpTenant(tenant: TenantId): boolean {
  return tenant === DEFAULT_TENANT;
}

export function odpEnabled(env: Env, tenant: TenantId): boolean {
  try { return resolveOdp(env, tenant) !== null; } catch { return false; }
}


function resolveOdp(env: Env, tenant: string): { host: string; key: string; config?: OdpConfiguration } | null {
  if (!tenant) return null;
  if (legacyConnectors(env, tenant)) return env.ODP_API_HOST && env.ODP_PUBLIC_KEY
    ? { host: env.ODP_API_HOST, key: env.ODP_PUBLIC_KEY } : null;
  const config = connectorConfiguration(env, tenant).odp;
  return config ? { host: config.apiHost.replace(/\/$/, ''), key: connectorSecret(env, config.publicKeyRef), config } : null;
}

async function admitOdp(env: Env, tenant: string, resolved: NonNullable<ReturnType<typeof resolveOdp>>, _bornAt: number): Promise<void> {
  // The descriptor contains references, never the resolved secret. Each actual
  // configured destination has its own policy and copies keep their source birth.
  const category = await destinationRetentionCategory('odp', resolved.config ?? { apiHost: resolved.host, identityNamespace: 'legacy-vuid' });
  currentExternalRetention(env, tenant, category);
}

export interface OdpState { odpContext?: string; odpSeed?: string[]; odpSeedAt?: number; odpRecentEvents?: Array<Record<string, unknown>> }
/** Remove the previous source's contributions before adopting a current pin. No network. */
export function projectedOdpSegments(segments: string[], previous: OdpState | null | undefined, current: OdpState): string[] {
  return [...new Set([...segments.filter(s => !previous?.odpSeed?.includes(s)), ...(current.odpSeed ?? [])])];
}
/** Every retained source must prove its own current mapping; another source's pin is not authority. */
export async function projectOdpState(env: Env, tenant: string, state: (OdpState & { externalRetention?: ExternalRetention }) | null | undefined): Promise<Required<OdpState>> {
  const empty = { odpContext: '', odpSeed: [] as string[], odpSeedAt: 0, odpRecentEvents: [] as Array<Record<string, unknown>> };
  try {
    const resolved = resolveOdp(env, tenant);
    if (!resolved) return empty;
    const context = resolved.config ? await connectorDigest(['odp-context-v1', tenant, resolved]) : 'legacy-demo';
    if (resolved.config && state?.odpContext !== context) return { ...empty, odpContext: context };
    if (state?.odpSeed?.length || state?.odpRecentEvents?.length) {
      const category = await destinationRetentionCategory('odp', resolved.config ?? { apiHost: resolved.host, identityNamespace: 'legacy-vuid' });
      pinRetention(env, state.externalRetention?.[category], tenant, category);
    }
    const allowed = resolved.config ? new Set(Object.values(resolved.config.audiences)) : null;
    return { odpContext: context, odpSeed: (state?.odpSeed ?? []).filter(k => !allowed || allowed.has(k)),
      odpSeedAt: state?.odpSeedAt ?? 0, odpRecentEvents: state?.odpRecentEvents?.slice() ?? [] };
  } catch { return empty; }
}

export async function mergeOdpState(env: Env, tenant: string, first: (OdpState & { externalRetention?: ExternalRetention }) | null | undefined, second: (OdpState & { externalRetention?: ExternalRetention }) | null | undefined): Promise<Required<OdpState>> {
  const [a, b] = await Promise.all([projectOdpState(env, tenant, first), projectOdpState(env, tenant, second)]);
  return { odpContext: a.odpContext, odpSeed: [...new Set([...a.odpSeed, ...b.odpSeed])],
    odpSeedAt: Math.max(a.odpSeedAt, b.odpSeedAt), odpRecentEvents: [...b.odpRecentEvents, ...a.odpRecentEvents].slice(-10) };
}

async function mappedIdentity(tenant: string, identity: OdpIdentity, config?: OdpConfiguration): Promise<string> {
  return config ? connectorIdentity(tenant, config.identityNamespace, identityKeyOf(identity).key) : vuidFor(identity);
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
  event: ActionEvent,
  tenant: TenantId,
  env?: Env,
): { type: string; action?: string; data: Record<string, unknown> } | null {
  if (env && !legacyConnectors(env, tenant)) {
    try {
      const mapping = connectorConfiguration(env, tenant).odp?.actions[actionOf(event)];
      if (!mapping) return null;
      const data: Record<string, unknown> = {};
      for (const [destination, source] of Object.entries(mapping.fields)) {
        const value = Object.hasOwn(event.data ?? {}, source) ? event.data?.[source] : undefined;
        if (typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) data[destination] = value;
      }
      return { type: mapping.type, ...(mapping.action ? { action: mapping.action } : {}), data };
    } catch { return null; }
  }
  if (!isLegacyOdpTenant(tenant)) return null;
  const data = event.data ?? {};
  const action = actionOf(event);
  const productId: string | undefined = data.productId ?? data.product_id ?? data.sku;
  const product: Product | undefined = productId ? catalog().getProduct(String(productId)) : undefined;

  // Whatever the checkout carried about the order itself. Only what was sent,
  // coerced to the types ODP expects; nothing invented.
  const orderFields = (d: Record<string, unknown>): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    const orderId = d.orderId ?? d.order_id;
    if (typeof orderId === 'string' && orderId.trim()) out.order_id = orderId.trim();
    const total = Number(d.total ?? d.order_total ?? d.revenue);
    if (Number.isFinite(total) && total >= 0) out.total = total;
    if (typeof d.currency === 'string' && d.currency.trim()) out.currency = d.currency.trim().toUpperCase();
    return out;
  };

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
    case 'purchase':
    case 'checkout':
    case 'order_complete': {
      // The highest-weighted action in the engine (core.ts weights: 5) fell
      // through the default below and never reached ODP, so a shopper's
      // purchases shaped the edge's affinity and ODP's memory of her was blind
      // to them. Product-level when the event names one, so the RTS can qualify
      // on the flattened fields like every other product action; order-level
      // when it does not, because a checkout is an order before it is a product.
      if (product) {
        return {
          type: 'product', action: 'purchase',
          data: { ...productFields(product), ...orderFields(data) },
        };
      }
      const order = orderFields(data);
      return Object.keys(order).length ? { type: 'order', action: 'purchase', data: order } : null;
    }
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
  nowMs: number,
  tenant: TenantId,
  env?: Env,
): Array<Record<string, unknown>> {
  if (env ? !odpEnabled(env, tenant) : !isLegacyOdpTenant(tenant)) return [];
  const mapped = mapActionToOdp(event, tenant, env);
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
  tenant: TenantId,
  identity: OdpIdentity,
  ring: Array<Record<string, unknown>>,
  current: { seed: string[]; seedAt: number },
  nowMs: number,
  membershipChanged: boolean
): Promise<{ seed: string[]; seedAt: number }> {
  if (!odpEnabled(env, tenant)) return { seed: [], seedAt: 0 };
  const throttle = ring.length ? 10_000 : 120_000;
  if (!membershipChanged && nowMs - current.seedAt <= throttle) return current;
  const fetched = await fetchOdpAudiences(env, tenant, identity, ring);
  return { seed: fetched ?? current.seed, seedAt: nowMs };
}

/** A GraphQL object literal. JSON encoding belongs to the outer request body. */
export function gqlObjectLiteral(obj: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(k)) throw new Error('Invalid GraphQL field');
    if (v === undefined || v === null) continue;
    if (typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))) {
      parts.push(`${k}: ${JSON.stringify(v)}`);
    } else throw new Error('Invalid GraphQL value');
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
  tenant: TenantId,
  event: ActionEvent,
  identity: OdpIdentity,
  receiptId?: string,
  pushReceipt?: (data: { receiptId: string; status: number; ts: number; source: string }) => void,
): Promise<void> {
  const admittedAt = Date.now();
  const consent = await currentOwnerConsent();
  if (consent) requireConsentPurpose(consent, 'tracking');
  try {
    const resolved = resolveOdp(env, tenant);
    if (!resolved) return;
    const mapped = mapActionToOdp(event, tenant, env);
    if (!mapped) return;
    await admitOdp(env, tenant, resolved, currentProfileBirth(tenant) ?? admittedAt);
    const vuid = await mappedIdentity(tenant, identity, resolved.config);
    const res = await ownerFetch(`${resolved.host}/v3/events`, {
      redirect: 'error',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': resolved.key },
      body: JSON.stringify({ ...mapped, identifiers: { vuid } }),
    });
    if (!res.ok) console.warn('[odp] event forward HTTP', res.status);
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
    console.warn('[odp] event forward failed');
  }
}

/**
 * §4 profile upsert (Lancelot's reference, Part 2): persist the edge's LIVE
 * affinity scores onto the ODP profile — the reflex's numbers, on the memory's
 * record, queryable back by vuid. Called on membership changes via waitUntil.
 */
export async function upsertOdpProfile(
  env: Env,
  tenant: TenantId,
  identity: OdpIdentity,
  affinity: { dims?: Record<string, Record<string, number>>; audiences?: string[] },
  journeyStage?: string
): Promise<void> {
  const consent = await currentOwnerConsent();
  if (consent) requireConsentPurpose(consent, 'personalization');
  try {
    const resolved = resolveOdp(env, tenant);
    if (!resolved) return;
    const bornAt = currentProfileBirth(tenant);
    if (bornAt === undefined) throw new Error('Profile retention authority unavailable');
    await admitOdp(env, tenant, resolved, bornAt);
    const vuid = await mappedIdentity(tenant, identity, resolved.config);
    const dims = affinity.dims ?? {};
    const lines = dims.line ?? {};
    const dominant = Object.entries(lines).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
    const attributes: Record<string, unknown> = resolved.config ? { vuid } : {
      vuid,
      line_affinity_tabby: lines.Tabby ?? 0,
      silhouette_affinity_tote: dims.silhouette?.tote ?? 0,
      occasion_affinity_evening: dims.occasion?.evening ?? 0,
      dominant_line: dominant,
      journey_stage: journeyStage ?? '',
    };
    if (resolved.config) for (const [field, mapping] of Object.entries(resolved.config.profile)) {
      if ('journey' in mapping) attributes[field] = journeyStage ?? '';
      else if ('value' in mapping) attributes[field] = dims[mapping.dimension]?.[mapping.value] ?? 0;
      else attributes[field] = Object.entries(dims[mapping.dimension] ?? {}).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
    }
    const res = await ownerFetch(`${resolved.host}/v3/profiles`, {
      redirect: 'error',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': resolved.key },
      body: JSON.stringify([{ attributes }]),
    });
    if (!res.ok) console.warn('[odp] profile upsert HTTP', res.status);
  } catch (e) {
    console.warn('[odp] profile upsert failed');
  }
}

/**
 * CRITERION C5 — THE ONE THING A STAGE-ONLY CHANGE MAY SAY.
 *
 * A read can move a shopper's journey stage without her doing anything: the
 * visit those counters belonged to ends while she is away, so the next read
 * reports the first stage of a new visit (`readTimeStageChange`). The platform
 * is allowed to tell the tenant's configured destination the stage that moved
 * — the exact allowed stage projection, through the same profile upsert a live
 * membership change uses — and it is allowed to say NOTHING else: no
 * behavioral event is forwarded, no ring entry is written, no seed is read, no
 * outcome, exposure or regional count is produced, and no retained-data
 * lifetime is renewed. Fabricating an event to carry a stage the shopper never
 * produced is the failure this criterion exists to prevent.
 *
 * The wire value is the PERSISTED grammar, reached through the single mapping
 * point `PERSISTED_STAGE` (R32(2), R40(b)): `journey_stage` on an ODP profile
 * is an external published grammar the tenant's own audience conditions are
 * written against, so the reported vocabulary is projected onto it here rather
 * than leaking the shared word onto a wire nobody mirrored it to.
 *
 * Returns the dispatched work so the caller can keep it off the response path
 * (`waitUntil` / `retainOwnerWork`), or null when the read said nothing. Both
 * hosts call this one function, so they cannot drift about what a stage-only
 * change is worth telling anybody.
 */
/**
 * The one coded diagnostic a skipped stage projection reports (W16 C5.06, R63).
 *
 * It is a fixed string, so it cannot name a shopper, a session, a tenant or a
 * destination identity, and both hosts emit the SAME words — the session host
 * from `GET /realtime/reflex`, the object host from its snapshot door — so an
 * operator reading the worker log cannot tell which host skipped and does not
 * need to.
 */
export const STAGE_PROJECTION_RETENTION_SKIP = '[odp] stage projection skipped: profile retention unavailable';

/**
 * Report the skip, once, in those words. Exported beside the constant so the
 * two hosts share the emission and not only the string.
 */
export function warnStageProjectionSkipped(): void {
  console.warn(STAGE_PROJECTION_RETENTION_SKIP);
}

export function stageOnlyOdpProjection(
  env: Env,
  tenant: TenantId,
  identity: OdpIdentity,
  affinity: { dims?: Record<string, Record<string, number>>; audiences?: string[] },
  change: { to: JourneyWord } | null,
): Promise<void> | null {
  if (!change || !odpEnabled(env, tenant)) return null;
  return upsertOdpProfile(env, tenant, identity, affinity, PERSISTED_STAGE[change.to]);
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
  tenant: TenantId,
  identity: OdpIdentity,
  recentEvents?: Array<Record<string, unknown>>
): Promise<string[] | null> {
  const consent = await currentOwnerConsent();
  if (consent) requireConsentPurpose(consent, 'personalization');
  try {
    const resolved = resolveOdp(env, tenant);
    if (!resolved) return null;
    const bornAt = currentProfileBirth(tenant);
    if (bornAt === undefined) throw new Error('Profile retention authority unavailable');
    await admitOdp(env, tenant, resolved, bornAt);
    const vuid = await mappedIdentity(tenant, identity, resolved.config);
    const subset = (resolved.config ? Object.keys(resolved.config.audiences) : ODP_MIRRORED_AUDIENCES).map(k => JSON.stringify(k)).join(',');
    const recentArg = recentEvents && recentEvents.length
      ? `, recent_events: [${recentEvents.map(gqlObjectLiteral).join(', ')}]`
      : '';
    const query = `query { customer(vuid: ${JSON.stringify(vuid)}) { audiences(subset: [${subset}]${recentArg}) { edges { node { name state } } } } }`;
    const res = await ownerFetch(`${resolved.host}/v3/graphql`, {
        redirect: 'error',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': resolved.key },
        body: JSON.stringify({ query }),
      }, ODP_READ_TIMEOUT_MS);
    if (!res.ok) return null;
    const json = (await res.json()) as {
      data?: { customer?: { audiences?: { edges?: Array<{ node: { name: string; state: string } }> } } };
      errors?: unknown[];
    };
    if (json.errors?.length) {
      console.warn('[odp] seed graphql errors');
      return null;
    }
    const edges = json.data?.customer?.audiences?.edges ?? [];
    return edges.filter((e) => e.node.state === 'qualified').flatMap((e) => {
      if (!resolved.config) return [e.node.name];
      return Object.hasOwn(resolved.config.audiences, e.node.name) ? [resolved.config.audiences[e.node.name]!] : [];
    });
  } catch (e) {
    console.warn('[odp] seed failed');
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// W41 — INTEREST-VECTOR RESTORATION (doc 35 §5 W41; F13, F31, N16).
//
// The loop above writes the edge's live affinity onto the tenant's ODP profile
// through the tenant's own `odp.profile` mapping (`upsertOdpProfile`). This is
// the read back. Once per sign-in, at a RECOGNIZED shopper's first event after
// it under personalization, her mapped profile attributes are read from her
// tenant's ODP and merged into her current interests before that event is
// applied: "If edge state is ever absent, it is re-seeded from ODP on the first
// event of the session".
//
//   • Once per sign-in, whatever her choice at the sign-in. The attempt's
//     record names the sign-in it was made under: a digest of the recognized
//     grant her capability carries, which only the identity link mints (a
//     retried link replays the same grant; rotation, return continuity and the
//     socket relay mint anonymous grants or re-sign the same one). A record of
//     an earlier sign-in never answers for a later one, also when that later
//     sign-in kept her state as it was (tracking only). A consent choice is not
//     a sign-in and re-arms nothing. Whatever she built before is kept: a
//     restored pair is added where she has none and replaces hers only where it
//     is the stronger at that moment. An attempt that could not read
//     (`unavailable`) is retried once in each later visit of the same sign-in;
//     every other answer stands until her next sign-in.
//
//   • Tenant-scoped. Only a tenant's own connector configuration — its host, key,
//     identity namespace and attribute mapping — is read. The default tenant's
//     stamp-global legacy settings (isLegacyOdpTenant) never restore anything.
//   • A vector is a numeric `{dimension, value}` attribute on a dimension the
//     tenant's registry defines, with a value its catalogue admits (the one R64
//     rule, admittedTouches). A dominant-value label, a journey label and an
//     audience are labels and never become interests.
//   • The value is the affinity a the attribute recorded AT ODP's
//     `last_modified_at`, so the restored entry holds R = K·a/(1−a) touched at
//     that observation and decays from it by the engine's own law, never from
//     the moment it was restored.
//   • Only under the shopper's current personalization choice, and never after
//     her erasure. ODP's `last_modified_at` is profile-wide: any writer moves it,
//     and our erasure leaves her ODP profile to the brand's operator
//     (src/identity/erase.ts), so no ODP timestamp can prove a value newer than
//     the erasure. Once her own subject carries an erasure barrier her profile
//     is not read at all; the timestamp is never consulted for it. Never an
//     observation older than the tenant's own profile retention.
//   • Cold, missing, malformed and unreadable state leaves her cold with a named
//     reason. The read is capped like the seed read and every provider failure
//     is absorbed, so it can delay her first event by at most that cap and never
//     fails the event or a decision.
// ─────────────────────────────────────────────────────────────────────────────

/** Why a restoration left her cold. `cold`, `missing` and `malformed` are the profile's own state. */
export type OdpColdReason = 'cold' | 'missing' | 'malformed' | 'unavailable' | 'erased' | 'expired';
/** The provenance `GET /realtime/reflex` answers as `affinity.restoration`, identically on both hosts. */
export type OdpRestoration =
  | { source: 'odp'; status: 'restored'; observedAt: number }
  | { source: 'odp'; status: 'cold'; reason: OdpColdReason };
/**
 * Stored on the reflex state it produced, with the sign-in it was made under (a
 * digest of the recognized grant, never the grant id itself) and the start of the
 * visit it was attempted in. Neither is ever answered.
 */
type OdpRestorationRecord = OdpRestoration & { signIn?: string; visit?: number };

/** The cap every ODP read on the serving path shares: ODP slowness never holds the shopper. */
export const ODP_READ_TIMEOUT_MS = 1500;
const COLD_REASONS: ReadonlySet<string> = new Set<OdpColdReason>(['cold', 'missing', 'malformed', 'unavailable', 'erased', 'expired']);

const plainObject = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;

function storedRestoration(state: unknown): OdpRestorationRecord | undefined {
  const r = plainObject(plainObject(state)?.restoration);
  if (!r || r.source !== 'odp' || (r.visit !== undefined && !Number.isSafeInteger(r.visit))
    || (r.signIn !== undefined && typeof r.signIn !== 'string')) return undefined;
  if (r.status === 'restored' && Number.isSafeInteger(r.observedAt)) return r as unknown as OdpRestorationRecord;
  if (r.status === 'cold' && typeof r.reason === 'string' && COLD_REASONS.has(r.reason)) return r as unknown as OdpRestorationRecord;
  return undefined;
}

/** The provenance a stored reflex state carries, exactly as the read answers it; undefined when it has none. */
export function odpRestorationOf(state: unknown): OdpRestoration | undefined {
  const r = storedRestoration(state);
  if (!r) return undefined;
  return r.status === 'restored'
    ? { source: 'odp', status: 'restored', observedAt: r.observedAt }
    : { source: 'odp', status: 'cold', reason: r.reason };
}

/** Every reducer step returns a fresh state; the provenance of this sign-in's restoration rides on with it. */
export function carryOdpRestoration<T extends ReflexState>(next: T, from: unknown): T {
  const r = storedRestoration(from);
  return r && !storedRestoration(next) ? { ...next, restoration: r } : next;
}

/** `last_modified_at` is int64 epoch SECONDS, returned as a string (docs/ODP-Recent-Events-Reference.md Part 2). */
function observationTime(raw: unknown): number | null {
  const seconds = typeof raw === 'number' ? raw : typeof raw === 'string' && /^\d{1,12}$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isSafeInteger(seconds) || seconds < 0) return null;
  const ms = seconds * 1000;
  return Number.isSafeInteger(ms) && Number.isFinite(new Date(ms).getTime()) ? ms : null;
}

/** A recorded affinity a ∈ [0, 1): null when nothing was recorded, undefined when the value is not one. */
function recordedAffinity(raw: unknown): number | null | undefined {
  if (raw === null || raw === undefined) return null;
  const a = typeof raw === 'number' ? raw
    : typeof raw === 'string' && /^-?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(raw) ? Number(raw) : NaN;
  return Number.isFinite(a) && a >= 0 && a < 1 ? a : undefined;
}

type ProfileRead = { kind: 'profile'; customer: Record<string, unknown> } | { kind: 'missing' | 'malformed' | 'unavailable' };

/**
 * Read the mapped attributes of one person's profile BY VUID from her tenant's
 * own ODP (the recorded contract: `customer(vuid) { vuid <attributes…>
 * last_modified_at }`). A personalization read, admitted exactly as the seed
 * read is; capped; every provider failure is `unavailable`, never a throw.
 */
async function readOdpProfile(
  env: Env, tenant: TenantId, odp: { host: string; key: string; config: OdpConfiguration }, subject: string, attributes: string[],
): Promise<ProfileRead> {
  const consent = await currentOwnerConsent();
  if (consent) requireConsentPurpose(consent, 'personalization');
  try {
    const bornAt = currentProfileBirth(tenant);
    if (bornAt === undefined) throw new Error('Profile retention authority unavailable');
    await admitOdp(env, tenant, odp, bornAt);
    const vuid = await connectorIdentity(tenant, odp.config.identityNamespace, subject);
    const fields = [...new Set(['vuid', 'last_modified_at', ...attributes])].join(' ');
    const res = await ownerFetch(`${odp.host}/v3/graphql`, {
      redirect: 'error',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': odp.key },
      body: JSON.stringify({ query: `query { customer(vuid: ${JSON.stringify(vuid)}) { ${fields} } }` }),
    }, ODP_READ_TIMEOUT_MS);
    if (!res.ok) return { kind: 'unavailable' };
    let body: Record<string, unknown> | null;
    try { body = plainObject(await res.json()); } catch { body = null; }
    if (!body || (Array.isArray(body.errors) && body.errors.length > 0)) return { kind: 'unavailable' };
    const data = plainObject(body.data);
    if (!data) return { kind: 'malformed' };
    if (data.customer === null || data.customer === undefined) return { kind: 'missing' };
    const customer = plainObject(data.customer);
    return customer && customer.vuid === vuid ? { kind: 'profile', customer } : { kind: 'malformed' };
  } catch (error) {
    if (error instanceof SessionAccessError) throw error;
    console.warn('[odp] profile read failed');
    return { kind: 'unavailable' };
  }
}

/**
 * The sign-in a recognized capability was issued by. The identity link is the
 * only minter of a recognized grant and a retried link replays the same one, so
 * the grant identifies the sign-in; a recognized bearer without one (never
 * minted today) is identified by its issue time. Stored as a digest.
 */
async function signInOf(principal: Pick<SessionCapability, 'subject' | 'iat' | 'grantId'>): Promise<string> {
  const grant = typeof principal.grantId === 'string' && principal.grantId ? ['grant', principal.grantId] : ['issued', principal.iat];
  return (await connectorDigest(['w41-sign-in-v1', principal.subject, ...grant])).slice(0, 32);
}

export interface OdpRestorationInput {
  /** The caller's shopper authority; only a recognized (signed-in) shopper is restored. */
  principal: Pick<SessionCapability, 'kind' | 'subject' | 'iat' | 'grantId'> | null | undefined;
  /** Her choice current at this event. */
  consent: Consent;
  /** Her stored interest state before this event. */
  prior: ReflexState | null | undefined;
  config: ReflexConfig;
  now: number;
  /** When the visit this event belongs to began (`liveVisit(...).lastVisitAt`): an `unavailable` attempt is retried in a later one. */
  visit: number;
  /** The tenant's catalogue vocabulary, read only when there is a value to admit. */
  vocabulary: () => Promise<CatalogVocabulary>;
}

/**
 * The state her first event after a sign-in is applied to: her current state
 * with her restored interests merged in (or unchanged, cold), carrying the
 * provenance. `null` when no attempt is due, and the caller then proceeds
 * exactly as before. An authority refusal propagates; nothing else escapes.
 */
export async function restoreOdpInterests(env: Env, tenant: TenantId, input: OdpRestorationInput): Promise<ReflexState | null> {
  const { principal, prior, config, now } = input;
  if (principal?.kind !== 'recognized' || !personalizes(input.consent)) return null;
  // Once per sign-in: a record made under THIS sign-in answers for it; a record
  // of an earlier one never does. Only an attempt of this sign-in that could not
  // read is made again, once in a later visit.
  const signIn = await signInOf(principal);
  const previous = storedRestoration(prior);
  if (previous && previous.signIn === signIn
    && !(previous.status === 'cold' && previous.reason === 'unavailable' && previous.visit !== input.visit)) return null;
  let resolved: ReturnType<typeof resolveOdp>;
  try { resolved = resolveOdp(env, tenant); } catch { return null; }
  if (!resolved?.config) return null;
  const odp = { host: resolved.host, key: resolved.key, config: resolved.config };

  const base = prior ?? emptyState(config);
  const answer = (outcome: OdpRestoration, dims: ReflexState['dims'] = base.dims): ReflexState =>
    ({ ...base, dims, restoration: { ...outcome, signIn, visit: input.visit } }) as ReflexState;
  const cold = (reason: OdpColdReason) => answer({ source: 'odp', status: 'cold', reason });

  // Only a numeric {dimension, value} attribute on a dimension the registry
  // defines is a vector. A dominant-value label, a journey label and an
  // audience never are; a dimension the registry lacks builds nothing (apply()).
  const vectors: Array<{ attribute: string; dim: string; value: string }> = [];
  for (const [attribute, mapping] of Object.entries(odp.config.profile)) {
    if (!('value' in mapping)) continue;
    const { dimension, value } = mapping;
    if (config.dimensions.some(spec => spec.key === dimension)) vectors.push({ attribute, dim: dimension, value });
  }
  if (vectors.length === 0) return cold('cold');

  // Her own erasure barrier, read first: once it exists nothing is restored
  // from ODP and her profile is not read, whatever ODP's timestamp says. An
  // unreadable barrier proves nothing either way, and nothing is read then too.
  let erased: boolean;
  try { erased = (await loadTombstone(env.STORAGE, tenant, principal.subject)) !== null; }
  catch (error) { if (error instanceof SessionAccessError) throw error; return cold('unavailable'); }
  if (erased) return cold('erased');

  const read = await readOdpProfile(env, tenant, odp, principal.subject, vectors.map(v => v.attribute));
  if (read.kind !== 'profile') return cold(read.kind);
  const observedAt = observationTime(read.customer.last_modified_at);
  if (observedAt === null) return cold('malformed');
  let horizonMs: number;
  try { horizonMs = retentionPolicy(env, tenant, 'profile').durationMs; } catch { return cold('unavailable'); }
  if (observedAt + horizonMs <= now) return cold('expired');

  const recorded = new Map<string, Touch & { a: number }>();
  for (const { attribute, dim, value } of vectors) {
    const a = recordedAffinity(read.customer[attribute]);
    if (a === undefined) return cold('malformed');
    if (a === null || a === 0) continue;
    const key = JSON.stringify([dim, value]), seen = recorded.get(key);
    if (!seen || a > seen.a) recorded.set(key, { dim, value, a });
  }
  if (recorded.size === 0) return cold('cold');

  let admitted: Touch[];
  try { admitted = admittedTouches([...recorded.values()].map(({ dim, value }) => ({ dim, value })), await input.vocabulary()); }
  catch (error) { if (error instanceof SessionAccessError) throw error; return cold('unavailable'); }
  const dims: ReflexState['dims'] = {};
  for (const dim of Object.keys(base.dims)) dims[dim] = { ...base.dims[dim] };
  const at = Math.min(observedAt, now);
  let live = false;
  for (const { dim, value } of admitted) {
    const { a } = recorded.get(JSON.stringify([dim, value]))!;
    const spec = config.dimensions.find(d => d.key === dim)!, tauMs = spec.tauMs ?? config.tauMs;
    const entry: ReflexEntry = { s: (spec.K ?? config.K) * a / (1 - a), t: at };
    // Merged, never overwriting: what she built in this session is kept, and a
    // pair both hold keeps whichever is the stronger now (adding the two would
    // count twice what the platform itself wrote to ODP).
    const held = dims[dim]?.[value];
    if (!held || effectiveScore(held, now, tauMs) < effectiveScore(entry, now, tauMs)) (dims[dim] ??= {})[value] = entry;
    if (effectiveScore(entry, now, tauMs) >= config.epsilon) live = true;
  }
  return live ? answer({ source: 'odp', status: 'restored', observedAt }, dims) : cold('cold');
}

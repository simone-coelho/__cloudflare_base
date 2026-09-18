// Explicit caller-buffered HTTP actions: original-time interest, no live activity.
import type { Env } from '@/types/env';
import type { ActionEvent } from '@/services/RealtimeSegmentEngine';
import type { SegmentProvider } from '@/connectors/SegmentProvider';
import { isEventNonce, isEventTimestamp } from '@/events/actionTypes';
import { isDecisionReference } from '@/ledger/records';
import { loadTombstone } from '@/ledger/erasure';
import { DEFAULT_TENANT } from '@/tenancy/tenant';
import { enrichmentInputs, type ProfileEnrichment } from '@/identity/profileEnrichment';
import { projectOdpState } from '@/services/odpLoop';
import { deriveStage } from '@/services/JourneyStage';
import { resolveSurface, resolveTenantCatalog, resolveTenantReflexConfig, tenantAudienceKeyPrefix } from '@/demos/registry';
import { actionOf, isContentAction, resolvedContentTouches } from './contentTelemetry';
import { attributesFrom, tick, touchesForEvent, type ReflexConfig, type ReflexState } from './core';
import { applyHistorical } from './identityMerge';

export interface BufferedAction {
  processing: 'buffered'; eventId: string; timestamp: number; browsingSessionId: string | null;
  sessionId?: unknown;
}

/** Numeric validity and explicit original context, not an age/lifecycle policy. */
export function validBufferedAction(input: unknown, now: number): input is BufferedAction {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return false;
  const value = input as Record<string, unknown>, session = value.browsingSessionId;
  const data = value.data as Record<string, unknown> | null | undefined;
  return value.processing === 'buffered' && isEventNonce(value.eventId)
    && isEventTimestamp(value.timestamp) && value.timestamp <= now
    && (session === null || (typeof session === 'string' && session.length > 0 && session.length <= 128 && session.trim() === session))
    && (!data || !Object.hasOwn(data, 'decisionId') || isDecisionReference(data.decisionId));
}

/** Unknown/corrupt storage is a refusal; only definite absence means no barrier. */
export async function bufferedEventAllowed(env: Env, tenant: string, subject: string, at: number): Promise<boolean> {
  const tombstone = await loadTombstone(env.STORAGE, tenant, subject);
  return !tombstone || at > tombstone.erased_at;
}

export interface BufferedProfile {
  reflex?: ReflexState; attributes: Record<string, unknown>; segments: string[];
  surface?: string; anonymousId?: string; profileEnrichment?: ProfileEnrichment; odpSeed?: string[]; odpContext?: string;
}

/** Current configuration and existing canonical touches; no historical policy reconstruction. */
export async function bufferedInterest(env: Env, tenant: string, event: ActionEvent, profile: BufferedProfile,
  provider: SegmentProvider, now: number): Promise<{ applied: boolean; reflex?: ReflexState; segments: string[]; config?: ReflexConfig }> {
  const unchanged = { applied: false, reflex: profile.reflex, segments: profile.segments };
  if ((env.REFLEX_ENABLED ?? 'true') === 'false') return unchanged;
  const surface = resolveSurface({ surface: profile.surface });
  const cfg = await resolveTenantReflexConfig(env, tenant, surface), action = actionOf(event);
  if ((cfg.weights[action] ?? 0) <= 0) return unchanged;
  const catalog = await resolveTenantCatalog(tenant, surface), data = event.data ?? {};
  const pid = data.productId ?? data.product_id ?? data.sku;
  const product = pid ? catalog?.getProduct(String(pid)) : undefined;
  const touches = isContentAction(action) ? await resolvedContentTouches(env, tenant, data, cfg)
    : touchesForEvent(data, product as unknown as Record<string, unknown> | undefined, cfg);
  if (!touches.length) return unchanged;
  const reflex = tick(applyHistorical(profile.reflex, { action, touches }, event.timestamp, cfg), now, cfg).state;
  const external = enrichmentInputs(profile.profileEnrichment);
  const context = { userId: event.userId, anonymousId: profile.anonymousId, attributes: { ...profile.attributes }, segments: [] as string[],
    ...(tenant === DEFAULT_TENANT ? { surface } : {}) };
  context.attributes.journey_stage = deriveStage(context);
  Object.assign(context.attributes, attributesFrom(reflex, now, cfg), external.attributes);
  // Do not seed old derived names into qualification or retain them on failure.
  const local = await provider.fetchQualifiedSegments(event.userId, context);
  const prefix = tenantAudienceKeyPrefix(tenant, surface);
  return { applied: true, reflex, config: cfg, segments: [...new Set([...local, ...reflex.audiences.map(key => prefix + key),
    ...external.audiences, ...(await projectOdpState(env, tenant, profile)).odpSeed])].sort() };
}

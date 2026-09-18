import { Hono } from 'hono';
import { currentOwnerConsent, requireConsentPurpose } from '@/identity/sessionAuthority';
import { z } from 'zod';
import type { Env } from '@/types/env';
import { EventSchema, Event } from '@/types/events';
import { EventDispatcher, dispatchForResponse, type DeliveryReceipt } from '@/services/EventDispatcher';
import { getPageContext } from '@/utils/context';
import { requireShopper, shopperPrincipal, assertSessionTarget, capabilityToken, SHOPPER_HEADER, SessionAccessError, type SessionCapability } from '@/identity/sessionCapability';
import { SessionManager } from '@/services/SessionManager';
import { shopperObject } from '@/tenancy/objects';
import { consentFromCookies, consentOf, refusalHints, intersectConsent, storedConsent, type Consent } from '@/content/consent';
import type { TenantVariables } from '@/tenancy/tenant';
import { isEventTimestamp } from '@/events/actionTypes';

const tracking = new Hono<{ Bindings: Env; Variables: TenantVariables }>();
const consentSchema = z.object({ tracking: z.boolean().optional(), personalization: z.boolean().optional() });
const contextSchema = z.object({ source: z.string().optional(), campaignId: z.string().optional(), sessionId: z.string().optional() });
const eventHintsSchema = z.object({ consent: consentSchema.optional(), recipientId: z.string().optional(), context: contextSchema.optional() });
const batchSchema = z.object({ events: z.array(z.unknown()), consent: consentSchema.optional(), context: contextSchema.optional() });

/** Validate every formal alias and consent hint before any member can dispatch. */
function parseOwnedEvent(raw: unknown, principal: SessionCapability) {
  const event = EventSchema.parse(raw) as Event;
  if (!isEventTimestamp(event.timestamp)) throw new Error('Invalid event timestamp');
  const hints = eventHintsSchema.parse(raw);
  for (const subject of [event.user?.userId, event.user?.anonymousId, hints.recipientId]) assertSessionTarget(principal, subject);
  assertSessionTarget(principal, undefined, hints.context?.sessionId);
  // EventSchema strips consent: it is authority input, never destination payload.
  return { event, consent: refusalHints(hints.consent) };
}

/** One owned read/operation, with necessary refusal committed before dispatch. */
async function resolveConsent(env: Env, principal: SessionCapability, capability: string, hints: Consent): Promise<Consent> {
  try {
    if ((env.REFLEX_HOST ?? 'session') === 'do') {
      const refusal = !hints.tracking || !hints.personalization;
      const response = await shopperObject(env.SHOPPER_REFLEX, principal.subject, principal.tenant).fetch(`https://shopper-reflex/consent${refusal ? '/refusal' : ''}`, {
        method: refusal ? 'POST' : 'GET', headers: { [SHOPPER_HEADER]: capability, 'X-Tenant': principal.tenant, 'Content-Type': 'application/json' },
        ...(refusal ? { body: JSON.stringify(hints) } : {}),
      });
      if (!response.ok) throw new SessionAccessError();
      const body = await response.json() as { ok?: boolean; consent?: unknown };
      if (!body || body.ok !== true || body.consent === undefined) throw new SessionAccessError();
      const consent = storedConsent(body.consent);
      const declared = body.consent as Partial<Consent>;
      if ((declared.tracking === true && !consent.tracking) || (declared.personalization === true && !consent.personalization)) throw new SessionAccessError();
      if ((!hints.tracking && consent.tracking) || (!hints.personalization && consent.personalization)) throw new SessionAccessError();
      return consent;
    }
    const manager = new SessionManager(env, { tenant: principal.tenant, principal });
    const sessionId = principal.sessionId, data = await manager.readRaw(sessionId, true);
    const consent = intersectConsent(await currentOwnerConsent() ?? consentOf(data), hints);
    if (!consent.tracking || !consent.personalization) await manager.restrictConsent(sessionId, consent, { sessionId, data });
    return consent;
  } catch { throw new SessionAccessError(); }
}

tracking.post('/event', requireShopper(), async (c) => {
  try {
    const principal = shopperPrincipal(c.req.raw);
    const { event, consent: hint } = parseOwnedEvent(await c.req.json(), principal);
    const consent = await resolveConsent(c.env, principal, capabilityToken(c.req.raw)!, intersectConsent(consentFromCookies(c.req.header('Cookie')), hint));
    if (!consent.tracking) return c.json({ success: true, eventId: event.eventId, status: 'skipped', dispatched: false, reason: 'tracking_refused', consent });
    requireConsentPurpose(consent, 'tracking');
    assertSessionTarget(principal);
    
    const enrichedEvent = {
      ...event,
      source: 'api',
      user: {
        ...(event.user || {}),
        anonymousId: principal.subject,
      },
      page: 'page' in event && event.page ? {
        ...event.page,
        ...getPageContext(c.req),
      } : getPageContext(c.req),
    };

    const dispatcher = new EventDispatcher(c.env);
    const delivery = await dispatchForResponse(dispatcher, enrichedEvent);

    return c.json({
      ...delivery.result,
      eventId: enrichedEvent.eventId,
      timestamp: enrichedEvent.timestamp,
    }, delivery.httpStatus);
  } catch (error) {
    if (error instanceof SessionAccessError) throw error;
    console.error('Tracking error');
    return c.json({ error: 'Invalid event data' }, 400);
  }
});

tracking.post('/batch', requireShopper(), async (c) => {
  try {
    const principal = shopperPrincipal(c.req.raw);
    const { events: raw, context, consent: batchHint } = batchSchema.parse(await c.req.json());
    const parsed = raw.map(event => parseOwnedEvent(event, principal));
    assertSessionTarget(principal, undefined, context?.sessionId);
    const events = parsed.map(p => p.event);
    const hints = intersectConsent(consentFromCookies(c.req.header('Cookie')), refusalHints(batchHint), ...parsed.map(p => p.consent));
    const consent = await resolveConsent(c.env, principal, capabilityToken(c.req.raw)!, hints);
    if (!consent.tracking) return c.json({ success: true, processed: 0, skipped: events.length, dispatched: false, reason: 'tracking_refused', consent,
      results: events.map(event => ({ eventId: event.eventId, status: 'skipped', reason: 'tracking_refused' })),
    });
    requireConsentPurpose(consent, 'tracking');
    const dispatcher = new EventDispatcher(c.env);
    const results: { eventId: string; status: 'success' | 'error'; error?: string; delivery?: DeliveryReceipt }[] = [];

    for (const event of events) {
      try {
        assertSessionTarget(principal);
        const enrichedEvent = {
          ...event,
          source: context?.source || 'batch',
          user: {
            ...(event.user || {}),
            anonymousId: principal.subject,
          },
          page: 'page' in event && event.page ? {
            ...event.page,
            ...getPageContext(c.req),
          } : getPageContext(c.req),
        };

        const { result } = await dispatchForResponse(dispatcher, enrichedEvent);
        results.push(result.success ? {
          eventId: enrichedEvent.eventId,
          status: 'success',
        } : {
          eventId: enrichedEvent.eventId,
          status: 'error',
          error: result.error,
          delivery: result.delivery,
        });
      } catch (error) {
        if (error instanceof SessionAccessError) throw error;
        console.error('Batch event error');
        results.push({
          eventId: event.eventId,
          status: 'error',
          error: 'Event delivery not confirmed',
          delivery: { status: 'unconfirmed', attempted: null, acknowledged: null },
        });
      }
    }

    const success = results.every(result => result.status === 'success');
    const unconfigured = results.length > 0 && results.every(result => result.delivery?.status === 'unconfigured');
    return c.json({
      success,
      processed: results.length,
      results,
    }, success ? 200 : unconfigured ? 503 : 502);
  } catch (error) {
    if (error instanceof SessionAccessError) throw error;
    console.error('Batch tracking error');
    return c.json({ error: 'Invalid batch data' }, 400);
  }
});

tracking.get('/health', (c) => {
  return c.json({ status: 'ok', service: 'tracking' });
});

export { tracking as trackingRoutes };

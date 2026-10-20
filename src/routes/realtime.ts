import type { TenantVariables } from '@/tenancy/tenant';
import { shopperObject, shopperObjectName } from '@/tenancy/objects';
import { DEFAULT_TENANT, TenantKV, type KVLike } from '@/tenancy/tenant';
// Singleton objects: one per worker on purpose, never per brand.
const SINGLETON_ADMIN = 'admin';
const SINGLETON_HEALTH = 'health-check';
import { Hono } from 'hono';
import type { Env } from '@/types/env';
import { RealtimeSegmentEngine, type ActionEvent } from '@/services/RealtimeSegmentEngine';
import { getConnectors } from '@/connectors';
import { snapshot as reflexSnapshot, type ReflexConfig } from '@/reflex/core';
import { resolveTenantReflexConfig, resolveSurface } from '@/demos/registry';
import { forwardEventToOdp, odpRestorationOf, projectOdpState, mapActionToOdp, odpEnabled, stageOnlyOdpProjection, upsertOdpProfile, warnStageProjectionSkipped } from '@/services/odpLoop';
import { isCarriedCustomerId, isDecisionReference, outcomeFromAction, type OutcomeRecord } from '@/ledger/records';
import { enqueueOutcome } from '@/ledger/enqueue';
import { outcomeEnrollment } from '@/content/holdout';
import { storedConsent, consentOf, personalizes, type Consent } from '@/content/consent';
import { ACTION_EVENT_TYPES, isEventNonce, isEventTimestamp } from '@/events/actionTypes';
import { validBufferedAction } from '@/reflex/bufferedAction';
import { projectVisit, validEntry, visitArrival, type ChannelSignals } from '@/services/visit';
import { deviceOf } from '@/services/platform';
import { journeyCountersNow, journeyStageFrom, journeyThresholdsInForce, persistedStageOf, readTimeStageChange } from '@/services/JourneyStage';
import { admitPreparedOutcome, outcomePreparationFailed, outcomeToLearning, prepareOutcomeAdmission } from '@/learn/route';
import { CatalogService } from '@/services/CatalogService';
import { demoEventCaptureEnabled } from '@/services/demoEventCapture';
export { demoEventCaptureEnabled } from '@/services/demoEventCapture';
import { z } from 'zod';
import { requireShopper, shopperPrincipal, assertSessionTarget, privateShopperHeaders, SessionAccessError } from '@/identity/sessionCapability';
import { anonymousWithConsent, ownedConsent, rotateObjectSession } from '@/identity/consentContinuity';
import { capabilityToken } from '@/identity/sessionCapability';
import { SessionManager } from '@/services/SessionManager';
import { AcknowledgementConflictError, assertShopperSelectors, carryOwnerCustomerId, parseShopperContext, currentOwnerConsent, ownerRelay, pinProfileRetention } from '@/identity/sessionAuthority';
import { captureRetention, RetentionUnavailable } from '@/retention';
import { captureBehaviorCarrying } from '@/ledger/behavior';
import { recoveryJSON, type OutcomeRecoveryInput } from '@/ledger/recovery';
import { consentFromCookies, intersectConsent, refusalHints } from '@/content/consent';
import { redeemRenderOffer } from '@/content/renderOffer';
import { admitLayoutExposure, layoutExposureBeaconOf } from '@/content/service';

const realtimeRoutes = new Hono<{ Bindings: Env; Variables: TenantVariables }>();
for (const path of ['/ws', '/action', '/personalization/:userId', '/reflex', '/session/reset', '/session/preferences', '/session/:sessionId/preferences', '/session/:sessionId/analytics', '/segments/:userId', '/connections/:userId']) {
  // Authenticate before parsing an action, without entering the subject owner.
  if (path === '/action') realtimeRoutes.use(path, requireShopper({ forward: false, bodyLimit: 2 * 1024 * 1024, bodyTimeoutMs: 5000 }));
  realtimeRoutes.use(path, async (c, next) => {
    assertShopperSelectors(c.req.raw);
    if (c.req.method === 'POST' && path === '/action') {
      // Invalid logical identity must not acquire/forward the subject owner.
      let body: unknown; try { body = await c.req.raw.clone().json(); } catch { return c.json({ error: 'Invalid action event' }, 400); }
      const event = actionEventSchema.safeParse(body);
      if (!event.success || event.data.processing === 'buffered' && !validBufferedAction(event.data, Date.now())) {
        return c.json({ error: 'Invalid action event' }, 400);
      }
      if (Object.hasOwn(event.data.data, 'renderOffer') && (event.data.type !== 'content_impression'
        || !isEventNonce(event.data.eventId) || !isEventTimestamp(event.data.timestamp))) throw new SessionAccessError();
    }
    if (c.req.method === 'POST' && path.endsWith('/preferences')) {
      const body = parseShopperContext(await c.req.raw.clone().text());
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new SessionAccessError();
      // Preferences do not resolve tenant authority from payload/query fields.
      // Validate supplied selectors before requireShopper can adopt an owner.
      const tenant = c.get('tenant'), queryTenant = c.req.query('tenant');
      if ((queryTenant !== undefined && queryTenant !== tenant)
        || (Object.hasOwn(body, 'tenant') && (body as Record<string, unknown>).tenant !== tenant)) throw new SessionAccessError();
    }
    await next();
  });
  realtimeRoutes.use(path, requireShopper());
}

// WebSocket upgrade endpoint
realtimeRoutes.get('/ws', async (c) => {
  const upgradeHeader = c.req.header('Upgrade');
  if (upgradeHeader !== 'websocket') {
    return c.text('Expected Upgrade: websocket', 426);
  }

  const userId = shopperPrincipal(c.req.raw).subject;

  try {
    // Edge Affinity Reflex P2 (doc 16 §6): REFLEX_HOST='do' relocates the socket
    // INTO the per-shopper ShopperReflex DO — state + compute co-located, hot,
    // hibernating. `userId` is the STABLE visitor id the client persists
    // (opt_visitor_id), so every tab/device lands on the same object. Default
    // 'session' keeps the original relay DO — byte-identical behavior.
    if ((c.env.REFLEX_HOST ?? 'session') === 'do') {
      const id = c.env.SHOPPER_REFLEX.idFromName(shopperObjectName(c.get('tenant'), userId));
      return c.env.SHOPPER_REFLEX.get(id).fetch(c.req.raw);
    }

    // Get the Durable Object instance for this user
    const id = c.env.PERSONALIZATION_WEBSOCKET.idFromName(shopperObjectName(c.get('tenant'), userId));
    const durableObject = c.env.PERSONALIZATION_WEBSOCKET.get(id);

    // Forward the WebSocket upgrade request to the Durable Object
    const owned = new URL(c.req.url); owned.pathname = '/owner/upgrade';
    return durableObject.fetch(new Request(owned, c.req.raw));
  } catch (error) {
      if (error instanceof SessionAccessError) throw error;
    console.error('Error establishing WebSocket connection');
    return c.text('Failed to establish WebSocket connection', 500);
  }
});

// Real-time action event processing.
// Retail event types ('product_view','add_to_cart','wishlist_add') are accepted
// alongside the original B2B types so the Coach storefront and existing callers
// share one ingestion path (REAL SEAMS, MOCKED CALLS — see docs/architecture/05-demo-build-spec.md §3).
export const actionEventSchema = z.object({
  // One list, in @/events/actionTypes, so this and the shopper object's door
  // cannot drift apart again (doc 31 §4: the object refused every content event).
  type: z.enum(ACTION_EVENT_TYPES),
  userId: z.string(),
  anonymousId: z.string().optional(),
  eventId: z.string().refine(isEventNonce).optional(),
  processing: z.literal('buffered').optional(),
  browsingSessionId: z.unknown().optional(),
  data: z.record(z.string(), z.any()),
  source: z.string(),
  // Which demo posted this (@/demos/registry). Optional and stripped-if-absent:
  // the engine falls back to `source`, and then to the default surface (coach),
  // so every existing client is unaffected.
  surface: z.string().optional(),
  // How the shopper arrived. Captured once per page load by the client and sent
  // with every action, because the server cannot know in advance which event
  // will be the one that opens a new visit. Optional, so every existing client
  // is unaffected; omitted/unobserved entry stays unknown.
  entry: z.custom<ChannelSignals>(value => value !== undefined && validEntry(value)).optional(),
  timestamp: z.number().refine(isEventTimestamp).optional(),
  // P13 (decision D1): the customer's identifier the page passed before
  // recognition (`setCustomerId`). Carried beside the visitor's own identifier
  // onto the outcome this event records under tracking consent, and never
  // proof: it is taken off the event before the shopper's state, the ODP loop
  // or any other consumer sees it, so it links, merges and selects nothing.
  customerId: z.string().refine(isCarriedCustomerId).optional(),
}).superRefine((event, ctx) => {
  if (Object.prototype.hasOwnProperty.call(event.data, 'decisionId') && !isDecisionReference(event.data.decisionId)) {
    ctx.addIssue({ code: 'custom', path: ['data', 'decisionId'], message: 'Invalid decision reference' });
  }
  if (event.eventId !== undefined && !isEventTimestamp(event.timestamp)) {
    ctx.addIssue({ code: 'custom', path: ['timestamp'], message: 'eventId requires a safe integer event timestamp' });
  }
  if (event.processing === 'buffered' && !validBufferedAction(event, Number.MAX_SAFE_INTEGER)) {
    ctx.addIssue({ code: 'custom', path: ['processing'], message: 'Buffered action requires original event identity, timestamp and browsing session' });
  }
});

realtimeRoutes.post('/action', async (c) => {
  // P65: settles the outcome the behaviour capture's admission carried, once it is captured (below).
  let withdrawCarried = async (): Promise<void> => { /* nothing captured yet, so nothing carried */ };
  try {
    const body = await c.req.json();
    assertSessionTarget(shopperPrincipal(c.req.raw), body?.userId, body?.sessionId);
    // P13: the carried identifier is held apart from the event itself; only the outcome record names it.
    const { customerId: carriedCustomerId, ...validatedEvent } = actionEventSchema.parse(body);
    // Render retries carry their first wire identity/time. Generic legacy
    // synthesis would turn a lost acknowledgement into a different render.
    if (Object.hasOwn(validatedEvent.data, 'renderOffer') && (validatedEvent.type !== 'content_impression'
      || !isEventNonce(validatedEvent.eventId) || !isEventTimestamp(validatedEvent.timestamp))) throw new SessionAccessError();
    if (validatedEvent.processing === 'buffered' && !validBufferedAction(validatedEvent, Date.now())) {
      return c.json({ error: 'Invalid buffered action' }, 400);
    }

    // Add timestamp if not provided.
    // Cast: the zod schema accepts the retail event types ('product_view',
    // 'add_to_cart','wishlist_add'); ActionEvent['type'] is widened to the same
    // union by the catalog-aware engine refactor (build-spec §2.1/§2.2). The
    // runtime values are always valid events, so this stays correct post-refactor.
    const cfGeo = ((c.req.raw as unknown as { cf?: { country?: string; regionCode?: string } }).cf) ?? null;
    // W23 T1.01 (doc 16 §4 :104 "The engine clock is authoritative. Events are
    // stamped on arrival; client timestamps are advisory only — a forged or
    // skewed clock cannot inflate affinity"). The engine's own stamp BOUNDS the
    // admitted event time, and bounds it only from above:
    //   · a client time after the engine's present is admitted AT the present.
    //     The event is still counted, still durable, still visible — the clock
    //     it claimed is what is refused, not the event (F18 §2 F: ten crafted
    //     future-dated events destroyed 81.8 % of an item's purchase evidence,
    //     slot-wide, from one self-served visitor id).
    //   · a client time at or before it is admitted EXACTLY as given. An old
    //     delivery is admitted as old — the settled buffered/late-history
    //     decisions (HANDOFF-2026-09-18 §7 :353, :354) — never restamped as
    //     fresh activity and never rejected for its age.
    // Malformed times (non-integer, out of calendar, non-numeric) are refused
    // before this point by `isEventTimestamp` on the schema, and the buffered
    // door's own `value.timestamp <= now` (`src/reflex/bufferedAction.ts:30`)
    // still applies to a buffered delivery's original time, unchanged.
    const engineNow = Date.now();
    const admittedTimestamp = Math.min(validatedEvent.timestamp ?? engineNow, engineNow);
    // P37: the device class this request reports (client hint, else user agent),
    // read here at the edge and never taken from the body; the visit the event
    // opens records it. A request reporting neither carries none.
    const device = deviceOf(c.req.raw.headers);
    const actionEvent = {
      ...validatedEvent,
      eventId: validatedEvent.eventId,
      anonymousId: shopperPrincipal(c.req.raw).kind === 'anonymous' ? shopperPrincipal(c.req.raw).subject : undefined,
      timestamp: admittedTimestamp,
      // CW6: coarse request geolocation rides the event so the scoring host can
      // fan the touches into the shopper's region. Aggregates only, never stored per person.
      ...(cfGeo?.country ? { geo: { country: cfGeo.country, regionCode: cfGeo.regionCode ?? null } } : {}),
      ...(device ? { device } : {}),
    } as ActionEvent;

    // Browsing attribution is separate from the signed profile session. Capture
    // and measurement below start only after the host returns resolved consent.
    const sessionId = validatedEvent.processing === 'buffered' ? validatedEvent.browsingSessionId as string | null
      : typeof body.browsingSessionId === 'string' && body.browsingSessionId.trim()
      ? body.browsingSessionId.trim().slice(0, 128) : shopperPrincipal(c.req.raw).sessionId;
    // Actual accepted action source is admitted durably BEFORE profile, queue,
    // learning or external side effects; a downstream refusal cannot erase the
    // original event identity or turn transport ACK into canonical completion.
    const priorConsent = await currentOwnerConsent();
    if (!priorConsent) throw new SessionAccessError();
    const captureConsent = intersectConsent(priorConsent, consentFromCookies(c.req.header('Cookie')), refusalHints(actionEvent.data.consent));
    // P30 (decision D2): the per-view beacon of a cached layout, answered here
    // before any host. It is no behaviour of the shopper's: it reaches neither
    // the shopper's state (no interest, journey counter, visit or signal), nor
    // the ledger, the outcome path or any provider. Under the tracking consent
    // just resolved, it only counts the drawn modules' exposures in the learning
    // of the context its key names (src/content/service.ts `admitLayoutExposure`),
    // after the answer; without it, or with a key the engine did not issue,
    // nothing at all. The brand is the action's own, as an outcome's is.
    if (validatedEvent.type === 'layout_exposure') {
      const beacon = layoutExposureBeaconOf(actionEvent.data);
      if (!beacon) return c.json({ error: 'Invalid layout exposure' }, 400);
      const named = actionEvent.data.brand;
      const brand = typeof named === 'string' && named.trim() ? named.trim() : c.get('tenant');
      const { answer, work } = await admitLayoutExposure(c.env, { tenant: c.get('tenant'), brand, subject: shopperPrincipal(c.req.raw).subject,
        tracking: captureConsent.tracking, beacon, now: engineNow });
      if (work) { try { c.executionCtx.waitUntil(work); } catch { void work; } }
      return c.json({ success: true, ...answer });
    }
    if (captureConsent.tracking && !actionEvent.eventId) actionEvent.eventId = crypto.randomUUID();
    const hasOffer = Object.hasOwn(actionEvent.data, 'renderOffer');
    if (hasOffer && actionEvent.type !== 'content_impression') throw new SessionAccessError();
    const redeemed = hasOffer ? await redeemRenderOffer(c.env, shopperPrincipal(c.req.raw), captureConsent, actionEvent) : undefined;
    const render = redeemed?.acknowledgment;
    // P57: a re-send of an acknowledged render carries the time that render was admitted at, so its behaviour record is the same record.
    if (redeemed) actionEvent.timestamp = redeemed.at;
    // The ciphertext is an admission capability, never behavior, demo capture,
    // pipeline input or provider data. Remove it before any ordinary handler.
    if (hasOffer) { const { renderOffer: _offer, ...data } = actionEvent.data; void _offer; actionEvent.data = data; }
    // P65 (amendment 7, R-P124): with durable recovery on, the outcome a tracked
    // action emits is prepared HERE, before the behaviour capture's durable
    // admission, and that admission carries it (src/ledger/recovery.ts
    // `CarriedOutcome`): the record `emitOutcome` below builds (the same event,
    // identity, admitted time, session and carried identifier), its retention, the
    // visitor's experiment block under the consent the capture holds, and its
    // learning preparation (src/learn/route.ts `prepareOutcomeAdmission`, the learn
    // document read). So the read that can fail decides whether anything is
    // carried: one that fails carries nothing, and the outcome the engine then
    // emits is counted lost once after the answer (R-P124(4)); a record that cannot
    // be built here is built after the engine as before, its failure answered as
    // before. These are the reads the outcome made after the engine before the
    // answer until now, made earlier, so the answer waits for no new remote call.
    // A reset between the behaviour capture's admission and the outcome's own then
    // leaves the alarm both, and it writes both unless it decides again that the
    // engine drops the event (src/durable-objects/ShopperReflex.ts
    // `carriedEventDropped`, src/ledger/recovery.ts `settleCarriedOutcome`).
    const buffered = actionEvent.processing === 'buffered';
    /** The outcome record this event emits (records.ts `outcomeFromAction`), the server's session where the client names none. */
    const outcomeOf = (serverSessionId?: string): OutcomeRecord | null => outcomeFromAction({ ...actionEvent, sessionId: buffered ? sessionId : sessionId ?? serverSessionId,
      eventId: actionEvent.eventId ?? crypto.randomUUID(),
      eventIdSource: validatedEvent.eventId === undefined ? 'request' : 'provided',
      // P13: under tracking consent only, beside the visitor's own identifier.
      ...(carriedCustomerId !== undefined ? { customerId: carriedCustomerId } : {}),
    }, c.get('tenant'));
    const prepared = await (async (): Promise<{ input: OutcomeRecoveryInput; personalizing: boolean } | { failed: true } | undefined> => {
      if (!captureConsent.tracking || c.env.LEDGER_RECOVERY_ENABLED !== 'true' || (!buffered && sessionId == null)) return undefined;
      let outcome: OutcomeRecord | null;
      try {
        outcome = outcomeOf();
        if (outcome) outcome.retention = captureRetention(c.env, c.get('tenant'), outcome.ts);
      } catch { return undefined; }
      if (!outcome) return undefined;
      const personalizing = personalizes(captureConsent);
      // W21 E1.06 (NR1): a failed annotation leaves the block off (as below).
      let experiment: Awaited<ReturnType<typeof outcomeEnrollment>> = null;
      try { experiment = await outcomeEnrollment(c.env, c.get('tenant'), outcome.brand, outcome.visitor_id, personalizing); }
      catch { experiment = null; }
      if (experiment) outcome.experiment = experiment;
      try { return { input: await prepareOutcomeAdmission(c.env, c.get('tenant'), outcome), personalizing }; }
      catch { return { failed: true }; }
    })();
    const ready = prepared && 'input' in prepared ? prepared : undefined;
    // P58 (amendment 5): every tracked action's behaviour capture answers at its
    // durable admission, whatever its type and whether or not it acknowledges a
    // render (P56's mechanism, src/ledger/recovery.ts `answerAtAdmission`): its
    // queue send and ledger write continue right after the answer in the
    // shopper's own serializer, the alarm armed at admission the backstop. The
    // record, its id and the projection are behavior.ts's as before; an
    // admission that fails still fails the action. P65: its admission carries
    // the outcome prepared above, with what the event's drop is decided by
    // beyond the behaviour record (the door it came through, the surface it named).
    const surface = validatedEvent.surface ?? (typeof actionEvent.data.surface === 'string' ? actionEvent.data.surface : undefined);
    const capture = await captureBehaviorCarrying(c.env, shopperPrincipal(c.req.raw), captureConsent,
      { type: actionEvent.type, eventId: actionEvent.eventId!, eventIdSource: validatedEvent.eventId === undefined ? 'request' : 'provided',
        timestamp: actionEvent.timestamp!, source: actionEvent.source, data: actionEvent.data }, sessionId ?? null, { answerAtAdmission: true },
      ready ? { input: ready.input, ...(buffered ? { buffered: true as const } : {}), ...(surface !== undefined ? { surface } : {}) } : undefined);
    const behavior = capture.persistence;
    // P65: the carried outcome is settled once, before the answer: by its own
    // admission under its id (`emitOutcome`), or withdrawn when the engine answered
    // that the event records none, or failed (after a failed preparation, whatever
    // an earlier delivery of the same event left carried is withdrawn, since this
    // one is counted lost). A withdrawal that cannot be made (the object reset)
    // leaves it carried, for the alarm.
    let carriedSettled = !(capture.carrying || (prepared !== undefined && 'failed' in prepared && behavior.status === 'durable'));
    withdrawCarried = async () => {
      if (carriedSettled) return;
      carriedSettled = true;
      try { await capture.withdraw(); } catch { /* left carried: the alarm settles it */ }
    };
    /** The record without its processing stamps and experiment block, in the engine's canonical form. */
    const recordOf = (record: OutcomeRecord) => recoveryJSON(Object.fromEntries(Object.entries(record).filter(([key]) => !['retention', 'externalRetention', 'experiment'].includes(key))));
    // Phase 0 (doc 22 §3.2): a reward-bearing action becomes an outcome record, after the response.
    // The outcome's session must be the session the decision record carries, or session-scope
    // attribution compares two id spaces and credits nothing (found 2026-09-04). Both now prefer the
    // client's browsing session, which the SDK persists with an idle rule and sends on the snapshot and
    // on every event; a client that sends none gets the server's session on both. Called once the host
    // has answered, so the server's session is known.
    // Both hosts return the strict stored/hint intersection; cookie mirrors are
    // not independent authority for capture or outcome processing.
    // P64 (amendment 7, R-P125): it returns the outcome it emitted as the answer names
    // it, records.ts's own `outcome_id` (built from the time the engine admitted the
    // event at, the time the behaviour record's id carries), with whether that outcome
    // was durably admitted: with durable recovery on, its own admission
    // (`outcomeToLearning`'s `onAdmitted`); without it, the producer's hand-off to the
    // queue or the canonical store. The answer names `outcome: { recordId }` beside
    // `behavior` only for an admitted outcome (`told` below). The owner already holds
    // the answer for this work (P59), so the route's waiting for it there adds no
    // remote call and no wait. No outcome (refused tracking, no reward): nothing.
    type EmittedOutcome = { recordId: string; admitted: Promise<boolean> };
    const emitOutcome =(serverSessionId: unknown, consent: Consent): EmittedOutcome | undefined => {
      if (!consent.tracking) return undefined;
      if (actionEvent.processing !== 'buffered') {
        const capture = captureDemoEvent(c.env, c.get('tenant'), actionEvent, sessionId);
        try { c.executionCtx.waitUntil(capture); } catch { void capture; }
      }
      const server = typeof serverSessionId === 'string' && serverSessionId ? serverSessionId : undefined;
      const outcome = outcomeOf(server);
      if (outcome) {
        outcome.retention = captureRetention(c.env, c.get('tenant'), outcome.ts);
        // P65 (R-P124(4)): its learning preparation failed before the behaviour
        // capture's admission, so nothing carries it and it is admitted nowhere:
        // lost, logged and counted once after the answer, and named nowhere (P64).
        if (prepared && 'failed' in prepared) {
          const lost = outcomePreparationFailed(c.env, c.get('tenant'));
          try { c.executionCtx.waitUntil(lost); } catch { void lost; }
          return undefined;
        }
        // P65: prepared and carried under this id, its own admission below settles the carried copy.
        if (ready && ready.input.outcome.outcome_id === outcome.outcome_id) carriedSettled = true;
        // W21 E1.02/E1.03 (R118(1)): the outcome carries the experimental
        // assignment of the visitor who produced it, resolved HERE — where her
        // consent at this moment is known and the read is an ordinary serving
        // read — and then stored and exported unchanged. An ineligible shopper's
        // outcome says `ineligible`; a failure to resolve leaves the block off
        // and never delays or drops the record.
        let admitted = false;
        const p = (async () => {
          // W21 E1.06 (NR1): the annotation is CONTAINED here, at the producer,
          // and not only inside the resolver. The resolver's own guard cannot
          // cover a resolver that fails before it runs — a publication binding
          // withdrawn under a fence, an import that will not load, a future
          // caller — and without this the whole emission was lost with it: the
          // action answered 500 and the outcome was never enqueued. A failed
          // annotation leaves the block off; it never guesses one, never delays
          // the record and never costs it.
          // P65: the outcome prepared before the behaviour capture's admission, when
          // it is this one under the consent the engine answered with, is admitted
          // from that input: the learn document is not read again for it.
          if (ready && ready.personalizing === personalizes(consent) && recordOf(ready.input.outcome) === recordOf(outcome)) {
            return admitPreparedOutcome(ready.input, { answerAtAdmission: true, onAdmitted: () => { admitted = true; } });
          }
          let experiment: Awaited<ReturnType<typeof outcomeEnrollment>> = null;
          try { experiment = await outcomeEnrollment(c.env, c.get('tenant'), outcome.brand, outcome.visitor_id, personalizes(consent)); }
          catch { experiment = null; }
          if (experiment) outcome.experiment = experiment;
          // P65: built again from the engine's answer, on the same learning preparation.
          if (ready) return admitPreparedOutcome({ ...ready.input, brand: outcome.brand, outcome }, { answerAtAdmission: true, onAdmitted: () => { admitted = true; } });
          // P59 (amendment 5): the outcome recovery answers at its durable admission
          // (P56's mechanism, src/learn/route.ts `outcomeToLearning`): the owner's
          // drain of this work holds the click's answer for the outcome's admission
          // and its armed alarm only; its attribution, queue send, ledger write and
          // credits continue right after the answer in the shopper's own serializer,
          // after the behaviour capture's (P58), the alarm the backstop. The record,
          // its experiment block and retention are the same as before.
          return c.env.LEDGER_RECOVERY_ENABLED === 'true'
            ? outcomeToLearning(c.env, c.get('tenant'), outcome, { answerAtAdmission: true, onAdmitted: () => { admitted = true; } })
            : Promise.all([enqueueOutcome(c.env, outcome).then(receipt => { admitted = receipt.code === 'accepted' || receipt.capture?.ok === true; }),
              outcomeToLearning(c.env, c.get('tenant'), outcome)]);
        })();
        try { c.executionCtx.waitUntil(p); } catch { void p; }
        return { recordId: outcome.outcome_id, admitted: p.then(() => admitted, () => false) };
      }
      return undefined;
    };
    /** P64 (R-P125): the answer's `outcome` member, only for an outcome emitted and durably admitted. */
    const told = async (emitted: EmittedOutcome | undefined) => (emitted && await emitted.admitted ? { outcome: { recordId: emitted.recordId } } : {});

    // P13 (R-P66 item 2): an accepted event's carried identifier is handed to the
    // shopper's own object under the tracking consent the host answered, kept
    // there for the browser's link answer; its failure never fails the event.
    const carry = async (consent: () => Consent) => {
      if (carriedCustomerId === undefined) return;
      try { if (consent().tracking) await carryOwnerCustomerId(c.env, shopperPrincipal(c.req.raw), carriedCustomerId); } catch { /* carried again on the next event */ }
    };

    // ── Edge Affinity Reflex P2 (doc 16 §6): REFLEX_HOST='do' forwards to the
    // shopper's ShopperReflex DO, which runs the same pipeline IN-OBJECT (reflex →
    // qualify → decide → push over its own socket) and returns the same envelope
    // shape ({success, update?, sessionId, cookiesUpdated, odp?}). The DO owns the
    // ODP loop on this path (forward + seed + receipt over its own socket), so no
    // route-level ODP dispatch here. The same envelope gates D1 capture/outcomes.
    const tEngine = performance.now();
    if ((c.env.REFLEX_HOST ?? 'session') === 'do') {
      const stub = shopperObject(c.env.SHOPPER_REFLEX, actionEvent.userId, c.get('tenant'));
      const doRes = await stub.fetch('https://shopper-reflex/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...privateShopperHeaders(c.req.raw) },
        body: JSON.stringify(actionEvent),
      });
      const out = (await doRes.json()) as Record<string, unknown>;
      c.header('Server-Timing', `object;dur=${Math.round(performance.now() - tEngine)}`);
      let emitted: EmittedOutcome | undefined;
      if (doRes.ok && out.success === true && !out.dropped) {
        if (!out.consent) throw new Error('Consent state unavailable');
        emitted = emitOutcome(out.sessionId, storedConsent(out.consent));
      }
      await withdrawCarried();
      if (doRes.ok && out.success === true && out.consent) await carry(() => storedConsent(out.consent));
      return c.json({ ...out, behavior, ...(await told(emitted)), ...(render ? { render } : {}) }, doRes.status as 200);
    }

    // Get cookie header for session management
    const cookieHeader = c.req.header('Cookie') ?? null;

    // Process the action event with enhanced session management
    const segmentEngine = new RealtimeSegmentEngine(c.env, getConnectors(c.env, c.get('tenant')), { tenant: c.get('tenant'), principal: shopperPrincipal(c.req.raw) });
    let execCtx: { waitUntil(p: Promise<unknown>): void } | undefined;
    try { execCtx = c.executionCtx; } catch { execCtx = undefined; /* no execCtx (e.g. tests) */ }
    const result = await segmentEngine.processActionEventWithSession(actionEvent, cookieHeader, execCtx);
    const consent = result.consent;
    // Where the time went: the engine's own work on the session host, for whoever is measuring.
    c.header('Server-Timing', `engine;dur=${Math.round(performance.now() - tEngine)}`);
    const emitted = result.dropped ? undefined : emitOutcome(result.sessionId, consent);
    await withdrawCarried();
    await carry(() => consent);
    if (actionEvent.processing === 'buffered') return c.json({ success: true, processing: 'buffered',
      interestApplied: result.interestApplied === true, ...(result.dropped ? { dropped: result.dropped } : {}),
      ...(result.signals ? { signals: result.signals } : {}),
      sessionId: result.sessionId, cookiesUpdated: false, consent, behavior, ...(await told(emitted)), ...(render ? { render } : {}) });
    // W35 A1: the drop is answered as the shopper's own object answers it
    // (ShopperReflex.ingest): named, with the signals that name the product, no
    // outcome, no provider forward and no cookie refresh. P40 (R-P48): a second
    // purchase of the same order is dropped the same way, named as a duplicate.
    if (result.dropped) return c.json({ success: true,
      message: result.dropped === 'duplicate_order' ? 'Action ignored: duplicate order' : 'Action ignored: unknown productId', dropped: result.dropped,
      ...(result.signals ? { signals: result.signals } : {}), sessionId: result.sessionId, cookiesUpdated: false,
      consent, behavior, ...(render ? { render } : {}) });

    // ODP loop (doc 16 §8): forward the behavioral event to ODP OFF the response
    // path — the shopper never waits on the memory; ODP down = zero impact.
    // The response carries a dispatch RECEIPT (server truth: what the platform is
    // forwarding); the forwarder later pushes the ODP status over the WebSocket as
    // an `odp_receipt` so the feed row upgrades to its real ✓ 202.
    let odpReceipt: { receiptId: string; type: string; action?: string; product_id?: string } | undefined;
    if (consent.tracking && odpEnabled(c.env, c.get('tenant'))) {
      const mapped = mapActionToOdp(actionEvent, c.get('tenant'), c.env);
      if (mapped) {
        odpReceipt = {
          receiptId: crypto.randomUUID(),
          type: mapped.type,
          ...(mapped.action ? { action: mapped.action } : {}),
          ...(typeof mapped.data.product_id === 'string' ? { product_id: mapped.data.product_id } : {}),
        };
        c.executionCtx.waitUntil(forwardEventToOdp(
          c.env, c.get('tenant'), actionEvent,
          { visitorId: actionEvent.userId, sessionId: result.sessionId },
          odpReceipt.receiptId,
        ));
      }
      // §4 score upsert: on membership changes, persist the reflex's live scores
      // onto the ODP profile (the memory carrying the edge's numbers).
      const aff = result.update?.data?.affinity;
      if (personalizes(consent) && aff && Array.isArray(aff.changed) && aff.changed.length > 0) {
        c.executionCtx.waitUntil(
          upsertOdpProfile(
            c.env,
            c.get('tenant'),
            { visitorId: actionEvent.userId, sessionId: result.sessionId },
            // W16 C5.08 (R40(b), R85(a)): the update carries the REPORTED word,
            // because that is what the SDK paints; the customer's own ODP
            // profile has only ever spoken the persisted grammar, and the
            // mirrored RTS audiences are keyed on it. Carried across by the one
            // mapping point (R32(2)), never by a second literal here, so this
            // host and the shopper's own object write one grammar.
            aff, persistedStageOf(result.update?.data?.journeyStage) ?? undefined,
          )
        );
      }
    }

    // Set updated cookies in response
    result.cookieHeaders.forEach(cookieHeader => {
      c.header('Set-Cookie', cookieHeader, { append: true });
    });

    if (result.update) {
      return c.json({
        success: true,
        message: 'Action processed and personalization updated',
        update: result.update,
        // W16 C8.03: what the tenant's own catalogue could and could not place
        // in this input, named, on the same answer both hosts return.
        ...(result.signals ? { signals: result.signals } : {}),
        sessionId: result.sessionId,
        cookiesUpdated: result.cookieHeaders.length > 0,
        odp: odpReceipt,
        behavior,
        ...(await told(emitted)),
        ...(render ? { render } : {}),
        consent,
      });
    } else {
      return c.json({
        success: true,
        message: 'Action processed, no personalization changes needed',
        ...(render ? { render } : {}),
        ...(result.signals ? { signals: result.signals } : {}),
        sessionId: result.sessionId,
        cookiesUpdated: result.cookieHeaders.length > 0,
        odp: odpReceipt,
        behavior,
        ...(await told(emitted)),
        consent,
      });
    }

  } catch (error) {
    // P65: a failed action records no outcome, as before; an outcome it cannot withdraw (the object reset) is the alarm's.
    await withdrawCarried();
      if (error instanceof SessionAccessError || error instanceof AcknowledgementConflictError) throw error;
    console.error('Error processing action event');
    
    if (error instanceof z.ZodError) {
      return c.json({
        error: 'Invalid action event format',
        details: error.issues
      }, 400);
    }

    return c.json({
      error: 'Failed to process action event',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});

// Get personalization config with session management
realtimeRoutes.get('/personalization/:userId', async (c) => {
  try {
    const userId = c.req.param('userId');
    if ((c.env.REFLEX_HOST ?? 'session') === 'do') {
      const response = await shopperObject(c.env.SHOPPER_REFLEX, shopperPrincipal(c.req.raw).subject, c.get('tenant')).fetch('https://shopper-reflex/personalization', { headers: privateShopperHeaders(c.req.raw) });
      return new Response(response.body, response);
    }
    
    if (!userId) {
      return c.json({ error: 'User ID is required' }, 400);
    }

    const cookieHeader = c.req.header('Cookie') ?? null;
    const segmentEngine = new RealtimeSegmentEngine(c.env, getConnectors(c.env, c.get('tenant')), { tenant: c.get('tenant'), principal: shopperPrincipal(c.req.raw) });
    
    // Get or create session from cookies
    const { sessionId, sessionData, isNewSession, reflexConfig } = await segmentEngine.getOrCreateSessionFromCookies(
      cookieHeader,
      userId
    );

    // Get personalization configuration
    const config = await segmentEngine.getSessionPersonalizationConfig(sessionId, sessionData, reflexConfig);
    assertSessionTarget(shopperPrincipal(c.req.raw), userId, sessionId);
    
    if (!config) {
      return c.json({ error: 'Failed to get personalization configuration' }, 500);
    }

    return c.json({
      userId,
      sessionId,
      isNewSession,
      config: {
        segments: config.segments,
        featureFlags: config.featureFlags,
        featureVariables: config.featureVariables,
        experiments: config.experiments
      },
      cookiesSet: false,
      timestamp: Date.now()
    });

  } catch (error) {
      if (error instanceof SessionAccessError) throw error;
    console.error('Error getting personalization config');
    return c.json({
      error: 'Failed to get personalization configuration',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});

// Edge Affinity Reflex — hydrate snapshot for the Affinity Instrument (doc 16 §10).
/**
 * The `config` block the snapshot answer carries. Per-dimension overrides (e.g.
 * priceBand's slower τ) ride along so the client's honest drain animation decays
 * each bar at its TRUE rate. One function, so the ordinary answer and the answer
 * that carries no retained profile (W16 C5.06) can never describe the same
 * published runtime differently.
 */
const reflexConfigView = (cfg: ReflexConfig) => ({
  version: cfg.version,
  tauMs: cfg.tauMs,
  K: cfg.K,
  thetaIn: cfg.thetaIn,
  thetaOut: cfg.thetaOut,
  dims: Object.fromEntries(
    cfg.dimensions
      .filter((d) => d.tauMs || d.K || d.thetaIn || d.thetaOut)
      .map((d) => [d.key, { tauMs: d.tauMs, K: d.K, thetaIn: d.thetaIn, thetaOut: d.thetaOut }])
  ),
});

// Resolves the shopper's session from cookies and returns freshly-computed live
// affinity (scores decay by construction, so they are ALWAYS computed at read).
realtimeRoutes.get('/reflex', async (c) => {
  try {
    const cookieHeader = c.req.header('Cookie') ?? null;
    const userId = shopperPrincipal(c.req.raw).subject;

    // REFLEX_HOST='do' (doc 16 §6): the vector lives in the shopper's own
    // ShopperReflex DO — read the snapshot there (same response shape).
    if ((c.env.REFLEX_HOST ?? 'session') === 'do') {
      const stub = shopperObject(c.env.SHOPPER_REFLEX, userId, c.get('tenant'));
      const doRes = await stub.fetch('https://shopper-reflex/snapshot', { headers: privateShopperHeaders(c.req.raw) });
      return c.json((await doRes.json()) as Record<string, unknown>, doRes.status as 200);
    }

    const segmentEngine = new RealtimeSegmentEngine(c.env, getConnectors(c.env, c.get('tenant')), { tenant: c.get('tenant'), principal: shopperPrincipal(c.req.raw) });
    // W16 C5.06 (R63). The ONE retained-data authority this read pins is the
    // shopper's own PROFILE stamp — the record the answer would be built from
    // (`SessionManager.readOwnedConsent`, and the profile birth a cold owned
    // answer mints). When the authority that stamp was born under is no longer
    // in force, nothing of that record may be read out, projected or sent; but
    // refusing to SERVE her page is not a retention remedy. The read then
    // answers with no retained profile at all, and the skip is reported once, in
    // coded words that name nobody. Nothing else is absorbed here: the
    // destination's own retained-data policy is pinned later, inside the
    // projection below, under its own narrow catch, and every other path that
    // pins retention still fails closed exactly as it did.
    let owned: Awaited<ReturnType<RealtimeSegmentEngine['getOrCreateSessionFromCookies']>>;
    try {
      owned = await segmentEngine.getOrCreateSessionFromCookies(cookieHeader, userId);
    } catch (error) {
      if (!(error instanceof RetentionUnavailable)) throw error;
      warnStageProjectionSkipped();
      const cold = await resolveTenantReflexConfig(c.env, shopperPrincipal(c.req.raw).tenant,
        resolveSurface({ surface: c.req.query('surface') }));
      return c.json({ ok: true, now: Date.now(), config: reflexConfigView(cold),
        affinity: null, journeyStage: null, visit: null, arrival: null, consent: await currentOwnerConsent() ?? storedConsent(undefined) });
    }
    const { sessionId, sessionData, reflexConfig } = owned;
    const consent = consentOf(sessionData);
    // Surface-aware tuning (@/demos/registry): an explicit ?surface= wins, else
    // the session remembers which demo it belongs to, else DEFAULT_SURFACE.
    // With both absent and nothing stored, this resolves to
    // DEFAULT_REFLEX_CONFIG BY IDENTITY — every pre-existing caller gets a
    // byte-identical response until someone tunes the scope.
    const cfg = reflexConfig ?? await resolveTenantReflexConfig(
      c.env,
      shopperPrincipal(c.req.raw).tenant,
      resolveSurface({ surface: c.req.query('surface') ?? sessionData.surface })
    );
    const now = Date.now();
    assertSessionTarget(shopperPrincipal(c.req.raw), userId);
    const live = personalizes(consent) && sessionData.reflex ? reflexSnapshot(sessionData.reflex, now, cfg) : null;

    // W16 C5: this read may have moved her stage on its own — the visit those
    // counters belonged to ended while she was away. That is a stage-only
    // change: it fabricates no event, writes nothing and renews no retained
    // lifetime, and the single thing it is allowed to do is tell the tenant's
    // configured destination the stage, off the response path. The object host
    // does the identical thing in ShopperReflex.handleSnapshot.
    const moved = live ? readTimeStageChange(sessionData.journey, sessionData.metadata.lastSeen, now, journeyThresholdsInForce(cfg)) : null;
    if (moved) {
      let deferred: { waitUntil(p: Promise<unknown>): void } | undefined;
      try { deferred = c.executionCtx; } catch { deferred = undefined; /* no execCtx (e.g. tests) */ }
      try {
        // The projection is an external copy of her profile, so it needs the
        // retained-data authority her record was born with. No stamp, no
        // projection: the read still answers, and nothing leaves the platform.
        pinProfileRetention(c.env, sessionData, c.get('tenant'));
        const projection = deferred
          ? stageOnlyOdpProjection(c.env, c.get('tenant'), { visitorId: userId, sessionId }, live!, moved)
          : null;
        if (projection) deferred!.waitUntil(projection);
      } catch (error) {
        // Only an unusable retained-data stamp is answered by skipping the
        // projection. Everything else — an owner or consent refusal above all —
        // is the caller's to see, and propagates.
        if (!(error instanceof RetentionUnavailable)) throw error;
        // Coded and non-identifying, like every other ODP diagnostic, and in the
        // same words the object host uses for the same skip.
        warnStageProjectionSkipped();
      }
    }

    // W41: the provenance of this session's ODP restoration, when one was
    // attempted — the same member the object host answers (handleSnapshot).
    const restoration = odpRestorationOf(sessionData.reflex);
    return c.json({
      ok: true,
      now,
      config: reflexConfigView(cfg),
      affinity: live
        ? { ...live, odpConfirmed: (await projectOdpState(c.env, c.get('tenant'), sessionData)).odpSeed, ...(restoration ? { restoration } : {}) }
        : null,
      // W16 C4 / R29: the SDK-visible journey stage, in the shared vocabulary,
      // derived from THIS VISIT's counters against the tenant's published
      // journey thresholds — identically on the object host
      // (ShopperReflex.handleSnapshot). A shopper who declined personalization
      // is told null, exactly as before.
      journeyStage: personalizes(consent)
        ? journeyStageFrom(journeyCountersNow(sessionData.journey, sessionData.metadata.lastSeen, now), journeyThresholdsInForce(cfg))
        : null,
      // R20 / unit W16.C2.07: the SDK-visible hydrate carries the shopper's
      // visit number and entry channel in the `projectVisit` shape, identically
      // on both hosts (the DO host answers from ShopperReflex.handleSnapshot).
      // The object's internal `projection=content` shape stays internal.
      visit: personalizes(consent) ? projectVisit(sessionData.metadata, sessionData.metadata.lastSeen, now) : null,
      // P37: the visit's arrival context beside it — the device and the recency
      // the visit recorded, each only when there is one — always present and null
      // exactly where `visit` is, identically on the object host.
      arrival: personalizes(consent) ? visitArrival(sessionData.metadata, sessionData.metadata.lastSeen, now) : null,
      consent,
    });
  } catch (error) {
      if (error instanceof SessionAccessError) throw error;
    return c.json(
      { ok: false, error: error instanceof Error ? error.message : 'reflex snapshot failed' },
      500
    );
  }
});

// New shopper — expire the session cookies (opt_session_id is HttpOnly, so only the
// server can clear it) and drop the KV session. The next page load cold-starts clean:
// fresh reflex, fresh journey, geo cold-start hero. Powers the "New shopper" button
// so presenters restart WITHOUT hunting for an incognito window.
realtimeRoutes.post('/session/reset', async (c) => {
  const principal = shopperPrincipal(c.req.raw);
  const session = await rotateObjectSession(c.env, principal, capabilityToken(c.req.raw)!, 'reset', c.req.header('Cookie'));
  for (const header of new SessionManager(c.env, { tenant: principal.tenant }).clearCookieHeaders()) c.header('Set-Cookie', header, { append: true });
  return c.json({ ok: true, cleared: true, session });
});

// Session preferences management
const preferencesSchema = z.object({
  choice: z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{1,96}$/), expectedRevision: z.string().nullable(), grantId: z.string(), iat: z.number().int(), exp: z.number().int() }).strict().optional(),
  trackingConsent: z.boolean().optional(),
  personalizationEnabled: z.boolean().optional(),
  cookieConsent: z.boolean().optional(),
  // CW31: on the object host the switches live on the shopper's object, which is named by the visitor id.
  userId: z.string().trim().min(1).max(200).optional(),
});

realtimeRoutes.on('POST', ['/session/preferences', '/session/:sessionId/preferences'], async (c) => {
  try {
    const sessionId = c.req.param('sessionId') ?? shopperPrincipal(c.req.raw).sessionId;
    const body = await c.req.json();
    const preferences = preferencesSchema.parse(body);
    const principal = shopperPrincipal(c.req.raw);
    assertSessionTarget(principal, preferences.userId, sessionId);

    if (!sessionId) {
      return c.json({ error: 'Session ID is required' }, 400);
    }

    const manager = new SessionManager(c.env, { tenant: principal.tenant, principal });
    if (preferences.trackingConsent === undefined && preferences.personalizationEnabled === undefined) {
      if (preferences.cookieConsent === undefined) return c.json({ error: 'Explicit preference required' }, 400);
      const current = await manager.updateUserPreferences(sessionId, { cookieConsent: preferences.cookieConsent });
      if (!current) return c.json({ error: 'Session not found' }, 404);
      return c.json({ success: true, sessionId, preferences: current.preferences, consent: await currentOwnerConsent(), cookiesUpdated: false });
    }
    if (!preferences.choice) return c.json({ error: 'Invalid explicit consent choice' }, 400);
    // The object's necessary switch write is acknowledged before preference cookies.
    {
      const told = await shopperObject(c.env.SHOPPER_REFLEX, principal.subject, principal.tenant).fetch('https://shopper-reflex/consent', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...privateShopperHeaders(c.req.raw) },
        body: JSON.stringify({ tracking: preferences.trackingConsent, personalization: preferences.personalizationEnabled, choice: preferences.choice }),
      });
      if (told.status === 404) return c.json({ error: 'Session not found' }, 404);
      if (told.status === 409) return c.json({ error: 'Consent choice conflict' }, 409);
      if (told.status === 400) return c.json({ error: 'Invalid explicit consent choice' }, 400);
      if (!told.ok) throw new SessionAccessError();
      const body = await told.json() as { ok?: unknown; consent?: unknown };
      if (body.ok !== true || body.consent === undefined) throw new SessionAccessError();
      const consent = storedConsent(body.consent);
      if (preferences.cookieConsent !== undefined) await manager.updateUserPreferences(sessionId, { cookieConsent: preferences.cookieConsent });
      assertSessionTarget(principal, undefined, sessionId);
      const effective = { trackingConsent: consent.tracking, personalizationEnabled: consent.personalization, cookieConsent: preferences.cookieConsent };
      const cookieHeaders = manager.generateConsentCookieHeaders(effective, consent);
      cookieHeaders.forEach(cookie => c.header('Set-Cookie', cookie, { append: true }));
      return c.json({ success: true, sessionId, preferences: effective, consent, cookiesUpdated: cookieHeaders.length > 0, timestamp: Date.now() });
    }

  } catch (error) {
      if (error instanceof SessionAccessError) throw error;
    console.error('Error updating session preferences');
    
    if (error instanceof z.ZodError) {
      return c.json({
        error: 'Invalid preferences format',
        details: error.issues
      }, 400);
    }

    return c.json({
      error: 'Failed to update session preferences',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});

// Get session analytics
realtimeRoutes.get('/session/:sessionId/analytics', async (c) => {
  try {
    const sessionId = c.req.param('sessionId');
    if ((c.env.REFLEX_HOST ?? 'session') === 'do') {
      const response = await shopperObject(c.env.SHOPPER_REFLEX, shopperPrincipal(c.req.raw).subject, c.get('tenant')).fetch('https://shopper-reflex/analytics', { headers: privateShopperHeaders(c.req.raw) });
      return new Response(response.body, response);
    }
    
    if (!sessionId) {
      return c.json({ error: 'Session ID is required' }, 400);
    }

    const segmentEngine = new RealtimeSegmentEngine(c.env, getConnectors(c.env, c.get('tenant')), { tenant: c.get('tenant'), principal: shopperPrincipal(c.req.raw) });
    const analytics = await segmentEngine.getSessionAnalytics(sessionId);

    if (!analytics) {
      // W05.BASE.03 (host parity): a session that keeps no profile publishes no record on
      // this host (nothing is stored without consent), yet the grant reading it is one its
      // owner admitted on the way here. The owner answers it as the object host does, with
      // its zeros; it answers nothing for a session holding a profile, and any refusal or
      // failure of that read keeps this host's 404.
      try {
        const owned = await shopperObject(c.env.SHOPPER_REFLEX, shopperPrincipal(c.req.raw).subject, c.get('tenant')).fetch('https://shopper-reflex/analytics', { headers: privateShopperHeaders(c.req.raw) });
        if (owned.ok) return new Response(owned.body, owned);
      } catch {
        // The owner's answer is unavailable: this host's own answer stands.
      }
      return c.json({ error: 'Session not found' }, 404);
    }

    return c.json({
      sessionId,
      analytics,
      timestamp: Date.now()
    });

  } catch (error) {
      if (error instanceof SessionAccessError) throw error;
    console.error('Error retrieving session analytics');
    return c.json({
      error: 'Failed to retrieve session analytics',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});

// Get user segments endpoint
realtimeRoutes.get('/segments/:userId', async (c) => {
  try {
    const userId = c.req.param('userId');
    if ((c.env.REFLEX_HOST ?? 'session') === 'do') {
      const response = await shopperObject(c.env.SHOPPER_REFLEX, shopperPrincipal(c.req.raw).subject, c.get('tenant')).fetch('https://shopper-reflex/segments', { headers: privateShopperHeaders(c.req.raw) });
      return new Response(response.body, response);
    }
    
    if (!userId) {
      return c.json({ error: 'User ID is required' }, 400);
    }

    const segmentEngine = new RealtimeSegmentEngine(c.env, getConnectors(c.env, c.get('tenant')), { tenant: c.get('tenant'), principal: shopperPrincipal(c.req.raw) });
    const segments = await segmentEngine.getUserSegments(userId, c.req.header('Cookie'));
    assertSessionTarget(shopperPrincipal(c.req.raw), userId);

    return c.json({
      userId,
      segments,
      timestamp: Date.now()
    });

  } catch (error) {
      if (error instanceof SessionAccessError) throw error;
    console.error('Error retrieving user segments');
    return c.json({
      error: 'Failed to retrieve user segments',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});

// Manual segment assignment endpoint
const assignSegmentSchema = z.object({
  segment: z.string(),
  source: z.string().optional().default('manual')
});

realtimeRoutes.post('/segments/:userId', async (c) => {
  try {
    const userId = c.req.param('userId');
    const body = await c.req.json();
    const { segment, source } = assignSegmentSchema.parse(body);
    assertSessionTarget(shopperPrincipal(c.req.raw), body.userId, body.sessionId);
    if ((c.env.REFLEX_HOST ?? 'session') === 'do') {
      const response = await shopperObject(c.env.SHOPPER_REFLEX, shopperPrincipal(c.req.raw).subject, c.get('tenant')).fetch('https://shopper-reflex/segments', { method: 'POST', headers: { ...privateShopperHeaders(c.req.raw), 'Content-Type': 'application/json' }, body: JSON.stringify({ segment, source }) });
      return new Response(response.body, response);
    }

    if (!userId) {
      return c.json({ error: 'User ID is required' }, 400);
    }

    const segmentEngine = new RealtimeSegmentEngine(c.env, getConnectors(c.env, c.get('tenant')), { tenant: c.get('tenant'), principal: shopperPrincipal(c.req.raw) });
    if (!await segmentEngine.assignSegment(userId, segment, source, c.req.header('Cookie'))) {
      return c.json({ ok: false, error: 'Shopper consent refused segment assignment' }, 403);
    }
    assertSessionTarget(shopperPrincipal(c.req.raw), userId);

    return c.json({
      success: true,
      message: `Segment '${segment}' assigned to user ${userId}`,
      userId,
      segment,
      source,
      timestamp: Date.now()
    });

  } catch (error) {
      if (error instanceof SessionAccessError) throw error;
    console.error('Error assigning segment');
    
    if (error instanceof z.ZodError) {
      return c.json({
        error: 'Invalid segment assignment format',
        details: error.issues
      }, 400);
    }

    return c.json({
      error: 'Failed to assign segment',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});

// Get WebSocket connection info
realtimeRoutes.get('/connections/:userId', async (c) => {
  try {
    const userId = c.req.param('userId');
    if ((c.env.REFLEX_HOST ?? 'session') === 'do') await ownedConsent(c.env, shopperPrincipal(c.req.raw), capabilityToken(c.req.raw)!);
    
    if (!userId) {
      return c.json({ error: 'User ID is required' }, 400);
    }

    // Get the Durable Object instance for this user
    const response = await ownerRelay(c.env, 'connections', c.get('tenant'), userId);
    const connectionInfo = await response.json() as Record<string, unknown>;

    return c.json(connectionInfo);

  } catch (error) {
      if (error instanceof SessionAccessError) throw error;
    console.error('Error retrieving connection info');
    return c.json({
      error: 'Failed to retrieve connection info',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});

// Get all WebSocket connections (admin endpoint)
realtimeRoutes.get('/connections', async (c) => {
  try {
    // Create a temporary ID to get any instance of the Durable Object
    const id = c.env.PERSONALIZATION_WEBSOCKET.idFromName(SINGLETON_ADMIN);
    const durableObject = c.env.PERSONALIZATION_WEBSOCKET.get(id);
    
    // Request all connections info from the Durable Object
    const response = await durableObject.fetch(new Request('http://fake/connections'));
    const connectionsInfo = await response.json() as Record<string, unknown>;

    return c.json(connectionsInfo);

  } catch (error) {
      if (error instanceof SessionAccessError) throw error;
    console.error('Error retrieving all connections');
    return c.json({
      error: 'Failed to retrieve connections info',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});

// Health check for real-time services
realtimeRoutes.get('/health', async (c) => {
  try {
    // Test WebSocket Durable Object health
    const id = c.env.PERSONALIZATION_WEBSOCKET.idFromName(SINGLETON_HEALTH);
    const durableObject = c.env.PERSONALIZATION_WEBSOCKET.get(id);
    const wsHealth = await durableObject.fetch(new Request('http://fake/health'));
    const wsHealthData = await wsHealth.json();

    // Test segment engine by creating a dummy instance
    const segmentEngine = new RealtimeSegmentEngine(c.env, getConnectors(c.env, c.get('tenant')), { tenant: c.get('tenant') });
    const testProfile = await segmentEngine.getUserProfile('health-check-user');
    
    return c.json({
      status: 'healthy',
      services: {
        websocket: {
          status: wsHealth.ok ? 'healthy' : 'unhealthy',
          data: wsHealthData
        },
        segmentEngine: {
          status: testProfile ? 'healthy' : 'unhealthy'
        },
        timestamp: Date.now()
      }
    });

  } catch (error) {
      if (error instanceof SessionAccessError) throw error;
    console.error('Health check failed');
    return c.json({
      status: 'unhealthy',
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: Date.now()
    }, 500);
  }
});

// Demo endpoint for testing real-time flow
const demoEventSchema = z.object({
  scenario: z.enum(['email_campaign', 'form_submission', 'pricing_page', 'demo_request']),
  userId: z.string(),
  metadata: z.record(z.string(), z.any()).optional()
});

realtimeRoutes.post('/demo/trigger', async (c) => {
  try {
    const body = await c.req.json();
    const { scenario, userId, metadata = {} } = demoEventSchema.parse(body);

    let actionEvent: ActionEvent;

    // Create demo action events based on scenario
    switch (scenario) {
      case 'email_campaign':
        actionEvent = {
          type: 'email_open',
          userId,
          data: {
            campaignId: metadata.campaignId || 'demo-campaign-001',
            emailId: metadata.emailId || 'demo-email-001',
            timestamp: Date.now()
          },
          source: 'demo',
          timestamp: Date.now()
        };
        break;

      case 'form_submission':
        actionEvent = {
          type: 'form_submit',
          userId,
          data: {
            formType: metadata.formType || 'lead_capture',
            formId: metadata.formId || 'demo-form-001',
            fields: metadata.fields || { email: 'demo@example.com', interest: 'enterprise' }
          },
          source: 'demo',
          timestamp: Date.now()
        };
        break;

      case 'pricing_page':
        actionEvent = {
          type: 'page_view',
          userId,
          data: {
            path: '/pricing',
            duration: metadata.duration || 120000, // 2 minutes
            plan_viewed: metadata.plan || 'enterprise'
          },
          source: 'demo',
          timestamp: Date.now()
        };
        break;

      case 'demo_request':
        actionEvent = {
          type: 'form_submit',
          userId,
          data: {
            formType: 'demo_request',
            formId: 'demo-request-form',
            company: metadata.company || 'Demo Company Inc',
            useCase: metadata.useCase || 'E-commerce personalization'
          },
          source: 'demo',
          timestamp: Date.now()
        };
        break;

      default:
        return c.json({ error: 'Invalid demo scenario' }, 400);
    }

    // Process the demo action event
    const segmentEngine = new RealtimeSegmentEngine(c.env, getConnectors(c.env, c.get('tenant')), { tenant: c.get('tenant') });
    const personalizationUpdate = await segmentEngine.processActionEvent(actionEvent);

    return c.json({
      success: true,
      scenario,
      actionEvent,
      personalizationUpdate,
      message: `Demo scenario '${scenario}' triggered successfully`
    });

  } catch (error) {
      if (error instanceof SessionAccessError) throw error;
    console.error('Error triggering demo scenario');
    
    if (error instanceof z.ZodError) {
      return c.json({
        error: 'Invalid demo trigger format',
        details: error.issues
      }, 400);
    }

    return c.json({
      error: 'Failed to trigger demo scenario',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});

/**
 * Persist one demo-run shopper action into D1 `demo_events` (source='demo').
 *
 * This is the action-event capture path; /funnel/event also writes demo rows.
 * Both use the same explicit development-demo gate. Rows are separate from the
 * historical synthetic dataset (coach_odp_profiles / coach_transactions /
 * coach_purchase_items), so POST /operator/events/reset can delete ONLY these and
 * never touch history. Opal aggregates these via v_demo_profiles into
 * v_audience_base — the UNION (historical + demo) surface it builds audiences over
 * — so demo shoppers grow audience sizes meaningfully. line/category/price_band
 * are enriched authoritatively from coach_catalog inside v_demo_profiles, so we
 * only store what the click carried. Best-effort: never throws into the request.
 */
// One catalog per isolate for capture-time enrichment (mirrors odpLoop's pattern);
// the CatalogService constructor builds the affinity graph — never rebuild per event.
let _captureCatalog: CatalogService | null = null;
function captureCatalog(): CatalogService {
  return (_captureCatalog = _captureCatalog ?? new CatalogService());
}

async function captureDemoEvent(
  env: Env,
  tenant: string | undefined,
  event: ActionEvent,
  sessionId?: string
): Promise<void> {
  try {
    if (!demoEventCaptureEnabled(env, tenant)) return;
    if (!env.DB) return; // D1 not bound (e.g. some test envs) — skip silently
    const d = event.data ?? {};
    const vuid = event.anonymousId ?? event.userId;
    const productId = d.product_id ?? d.productId ?? d.sku ?? null;
    // 0005: enrich the captured row with silhouette/subcategory/occasions
    // server-side (catalog-authoritative — no client payload change needed).
    // v_demo_profiles still re-joins the catalog; these are the self-contained
    // copy + the fallback when a stray product id misses the join.
    const product = productId ? captureCatalog().getProduct(String(productId)) : undefined;
    await env.DB.prepare(
      `INSERT INTO demo_events
         (ts, vuid, session_id, demo_run_id, event_type,
          product_id, product_name, line, price_usd, path, label, dwell_ms, raw_json, source,
          silhouette, subcategory, occasions)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'demo', ?, ?, ?)`
    )
      .bind(
        event.timestamp ?? Date.now(),
        vuid,
        sessionId ?? null,
        sessionId ?? null, // demo_run_id defaults to the session — enables per-run reset
        event.type,
        productId,
        d.product_name ?? d.name ?? product?.name ?? null,
        typeof d.line === 'string' ? d.line : (product?.line ?? null),
        typeof d.price_usd === 'number' ? Math.round(d.price_usd) : (product?.price_usd ?? null),
        typeof d.path === 'string' ? d.path : null,
        d.label ?? d.query ?? null,
        typeof d.dwellMs === 'number' ? Math.round(d.dwellMs) : null,
        JSON.stringify({ source: event.source, data: d }), // full payload (provenance incl. original source)
        product?.silhouette ?? null,
        product?.subcategory ?? null,
        product?.occasion && product.occasion.length ? product.occasion.join(',') : null
      )
      .run();
  } catch (err) {
    console.error('captureDemoEvent failed (non-fatal)');
  }
}

export default realtimeRoutes;

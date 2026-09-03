// src/reflex/contentTelemetry.ts
// ---------------------------------------------------------------------------
// CW3, the server half: content interactions become affinity.
//
// The SDK (CW8) already emits content_impression, content_click, content_dwell
// and video_complete, each carrying the piece's contentType. Until this module
// nothing on the server could hear them, for two separate reasons:
//
//   1. The SDK rides them on the accepted `custom` type with the real event named
//      in `data.event` (src/sdk/wire.ts). Every server-side action resolver read
//      `data.action ?? data.eventName ?? event.type` and never `data.event`, so
//      every SDK content event -- and every SDK purchase -- resolved to the action
//      'custom', weighed zero, and never reached ODP. actionOf() is the one
//      resolver that knows the SDK's convention, for all four call sites.
//
//   2. Content is by definition not in the product catalog, and touchesForEvent()
//      derives touches from the product when one resolves and from the event only
//      under an opt-in mode. A content event has no product and should not depend
//      on that mode. contentTouches() reads the registry off the event's own
//      attributes through the same sanitizer, so a contentType dimension in the
//      registry scores from the contentType the SDK sent.
//
// This is stage one, learning the SHOPPER: does she engage with video, with
// editorial, with on-model imagery. Stage two, learning what WORKS, is doc 22's
// attribution and lives with the outcome ledger; the two are not the same thing
// and this module makes no claim on the second.
//
// EXPOSURE, STATED ONCE. Impressions are dense and weak: every piece rendered is
// an impression whether or not the shopper wanted it, so an impression must not
// build interest the way a click does. The default weight for content_impression
// is therefore ZERO. It is a tunable like every other weight, and a team that
// wants a faint impression signal can set it, but the shipped default does not
// let "we showed her a video" read as "she likes video".
// ---------------------------------------------------------------------------

import { extractTouches, sanitizeEventAttributes, type ReflexConfig, type Touch } from '@/reflex/core';

/** The content actions the SDK emits and the registry can learn from. */
export const CONTENT_ACTIONS = ['content_impression', 'content_click', 'content_dwell', 'video_complete'] as const;
export type ContentAction = (typeof CONTENT_ACTIONS)[number];

const CONTENT_SET: ReadonlySet<string> = new Set(CONTENT_ACTIONS);

export function isContentAction(action: string): action is ContentAction {
  return CONTENT_SET.has(action);
}

/**
 * Default accumulation weights for content actions, on the same scale as the
 * product actions in DEFAULT_REFLEX_CONFIG (view 1, save 2, cart 3, buy 5).
 *
 *   impression   0   dense and involuntary; see the note above
 *   dwell        0.5 sustained attention, but passive
 *   click        1   a deliberate act, like opening a product page
 *   video_complete 2 the strongest content signal there is: she stayed to the end
 */
export const CONTENT_WEIGHTS: Record<ContentAction, number> = {
  content_impression: 0,
  content_dwell: 0.5,
  content_click: 1,
  video_complete: 2,
};

/**
 * The action an event names, honouring every convention on the wire.
 *
 * The storefront sends `data.action`; some legacy paths send `data.eventName`;
 * the SDK sends the accepted `type` with the real event in `data.event`; and a
 * first-class type carries its own name. First match wins, in that order, so no
 * existing caller changes and the SDK's events are finally heard.
 */
export function actionOf(event: { type: string; data?: Record<string, unknown> | null }): string {
  const d = event.data ?? {};
  for (const key of ['action', 'eventName', 'event'] as const) {
    const v = d[key];
    if (typeof v === 'string' && v.trim() !== '') return v.trim();
  }
  return event.type;
}

/**
 * Touches for a content event, from the event's own attributes.
 *
 * Goes through sanitizeEventAttributes so the same guards that protect the
 * product path (prototype keys, oversized values, unknown fields) protect this
 * one, and through extractTouches so the registry is the only thing that decides
 * which attributes matter. The SDK sends contentType today; if it sends more
 * tomorrow, a registry entry with that source is all it takes.
 */
export function contentTouches(data: Record<string, unknown>, config: ReflexConfig): Touch[] {
  return extractTouches(sanitizeEventAttributes(data, config), config);
}

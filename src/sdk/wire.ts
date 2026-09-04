// src/sdk/wire.ts
// What goes on the wire. The server's action schema (src/routes/realtime.ts,
// actionEventSchema) names every event the SDK sends, and each row here is that
// name. The table exists for the day an event reaches the SDK before the server
// names it: such a row rides the accepted `custom` type with the real event in
// `data.event` (the `event` field below), so nothing is dropped and nothing is
// misdescribed, and when the server learns the type only its row changes.
// Content interactions and the conversion event travelled that way until CW3
// (2026-09-03) made them first-class on both sides. A contract test parses every
// row through the real schema.

import type { SdkEventType } from './types';

export interface WireMapping { type: string; event?: string }

export const WIRE: Record<SdkEventType, WireMapping> = {
  page_view: { type: 'page_view' },
  product_view: { type: 'product_view' },
  add_to_cart: { type: 'add_to_cart' },
  wishlist_add: { type: 'wishlist_add' },
  email_open: { type: 'email_open' },
  form_submit: { type: 'form_submit' },
  button_click: { type: 'button_click' },
  custom: { type: 'custom' },
  // First-class since CW3: the conversion event and the four content interactions.
  purchase: { type: 'purchase' },
  content_impression: { type: 'content_impression' },
  content_click: { type: 'content_click' },
  content_dwell: { type: 'content_dwell' },
  video_complete: { type: 'video_complete' },
};

/** The wire type and the payload, with the real event name kept where it is not the type. */
export function toWire(type: SdkEventType, data: Record<string, unknown>): { type: string; data: Record<string, unknown> } {
  const m = WIRE[type] ?? WIRE.custom;
  return { type: m.type, data: m.event ? { event: m.event, ...data } : { ...data } };
}

// src/sdk/wire.ts
// What goes on the wire. The server's action schema (src/routes/realtime.ts,
// actionEventSchema) accepts a fixed set of types today. Events the design
// promises but the server does not yet name — content interactions and the
// conversion event — ride the accepted `custom` type with the real event named
// in `data.event`, so nothing is dropped and nothing is misdescribed. When the
// server learns a type (CW3 for content telemetry), its row here changes and
// nothing else does. A contract test parses every row through the real schema.

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
  // Not yet first-class server-side; named honestly inside the payload.
  purchase: { type: 'custom', event: 'purchase' },
  content_impression: { type: 'custom', event: 'content_impression' },
  content_click: { type: 'custom', event: 'content_click' },
  content_dwell: { type: 'custom', event: 'content_dwell' },
  video_complete: { type: 'custom', event: 'video_complete' },
};

/** The wire type and the payload, with the real event name kept where it is not the type. */
export function toWire(type: SdkEventType, data: Record<string, unknown>): { type: string; data: Record<string, unknown> } {
  const m = WIRE[type] ?? WIRE.custom;
  return { type: m.type, data: m.event ? { event: m.event, ...data } : { ...data } };
}

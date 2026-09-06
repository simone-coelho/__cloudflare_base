// src/events/actionTypes.test.ts
//
// The two doors accept the same events, and can no longer be made to disagree.
//
// Doc 31's load run found the object host answering 400 to every content_click.
// The cause was two lists: a zod enum on POST /realtime/action and a Set inside
// ShopperReflex, the second carrying a comment asking it to stay in step with
// the first. It had not. The cost was not one refused event: staging stays on
// the slower session host until the object host can take the traffic.

import { describe, it, expect } from 'vitest';
import { ACTION_EVENT_TYPES, ACTION_EVENT_TYPE_SET } from '@/events/actionTypes';
import { actionEventSchema } from '@/routes/realtime';

const envelope = (type: string) => ({ type, userId: 'v1', data: {}, source: 'web' });

describe('the event types both doors accept', () => {
  it('accepts every content event and the purchase, which the object used to refuse', () => {
    for (const type of ['purchase', 'content_impression', 'content_click', 'content_dwell', 'video_complete']) {
      expect(ACTION_EVENT_TYPE_SET.has(type), `${type} is refused at the object's door`).toBe(true);
      expect(actionEventSchema.safeParse(envelope(type)).success, `${type} is refused at the route`).toBe(true);
    }
  });

  it('still accepts everything it accepted before, so no client breaks', () => {
    for (const type of ['email_open', 'form_submit', 'page_view', 'button_click', 'custom', 'product_view', 'add_to_cart', 'wishlist_add']) {
      expect(ACTION_EVENT_TYPE_SET.has(type)).toBe(true);
      expect(actionEventSchema.safeParse(envelope(type)).success).toBe(true);
    }
  });

  it('refuses what neither door should take', () => {
    expect(ACTION_EVENT_TYPE_SET.has('drop_tables')).toBe(false);
    expect(actionEventSchema.safeParse(envelope('drop_tables')).success).toBe(false);
  });

  it('is one list, so the route and the object cannot drift apart', () => {
    // The property the old comment asked for and could not enforce: every type
    // the route validates is a type the object ingests, and the reverse.
    for (const type of ACTION_EVENT_TYPES) {
      expect(actionEventSchema.safeParse(envelope(type)).success, `${type} parses at the route`).toBe(true);
      expect(ACTION_EVENT_TYPE_SET.has(type), `${type} passes the object's door`).toBe(true);
    }
    expect(ACTION_EVENT_TYPE_SET.size).toBe(ACTION_EVENT_TYPES.length);
  });
});

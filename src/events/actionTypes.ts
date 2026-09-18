// src/events/actionTypes.ts
//
// The event types the platform accepts, in ONE place.
//
// There were two lists: the zod enum on POST /realtime/action, and a Set inside
// ShopperReflex guarding the same events at the object's own door. The Set
// carried the comment "keep in sync with actionEventSchema" and had drifted
// anyway: it was missing `purchase` and all four content events, so the object
// host answered 400 to every content click. Doc 31's load run found it, and the
// consequence was larger than a refused event -- staging stays on the slower
// session host until the object host can take the traffic.
//
// A comment asking two lists to agree is not a mechanism. This is the list, and
// both sides are built from it, so the next event type is added once.

/** Every type POST /realtime/action accepts, and every type the shopper object ingests. */
export const ACTION_EVENT_TYPES = [
  // The original five.
  'email_open', 'form_submit', 'page_view', 'button_click', 'custom',
  // Retail signals, the Coach storefront's.
  'product_view', 'add_to_cart', 'wishlist_add',
  // First-class since CW3. The SDK may still send these as custom + data.event;
  // actionOf() reads both, so its wire table can flip whenever it likes.
  'purchase', 'content_impression', 'content_click', 'content_dwell', 'video_complete',
] as const;

export type ActionEventType = (typeof ACTION_EVENT_TYPES)[number];

/** The same list as a membership test, for the doors that guard on it. */
export const ACTION_EVENT_TYPE_SET: ReadonlySet<string> = new Set(ACTION_EVENT_TYPES);

/** Opaque logical identity, including the SDK's non-UUID Host fallback. */
export const isEventNonce = (value: unknown): value is string =>
  typeof value === 'string' && value.length >= 1 && value.length <= 128 && !/[^A-Za-z0-9_-]/.test(value);

/** An immutable nonce-bearing event time; zero is valid. No skew policy implied. */
export const isEventTimestamp = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && Number.isFinite(new Date(value).getTime());

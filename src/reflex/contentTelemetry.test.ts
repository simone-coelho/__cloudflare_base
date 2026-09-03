// src/reflex/contentTelemetry.test.ts
//
// CW3, proven end to end through the real reflex transition. The events here are
// shaped exactly as the SDK sends them (src/sdk/wire.ts): type 'custom', the real
// event in data.event, contentType riding along.

import { describe, it, expect } from 'vitest';
import { DEFAULT_REFLEX_CONFIG, apply, snapshot, type ReflexConfig } from '@/reflex/core';
import {
  CONTENT_ACTIONS, CONTENT_WEIGHTS, actionOf, contentTouches, isContentAction,
} from '@/reflex/contentTelemetry';

const T0 = 1_700_000_000_000;

/** An event the way the SDK puts it on the wire. */
const sdk = (event: string, data: Record<string, unknown> = {}) =>
  ({ type: 'custom', data: { event, ...data } });

describe('actionOf — every convention on the wire', () => {
  it('reads the storefront convention, data.action, first', () => {
    expect(actionOf({ type: 'custom', data: { action: 'product_view', event: 'ignored' } })).toBe('product_view');
  });

  it('reads the legacy data.eventName', () => {
    expect(actionOf({ type: 'custom', data: { eventName: 'wishlist_add' } })).toBe('wishlist_add');
  });

  it('reads the SDK convention, data.event, which nothing did before', () => {
    // The gap: content events and SDK purchases resolved to 'custom', weight 0.
    expect(actionOf(sdk('content_click'))).toBe('content_click');
    expect(actionOf(sdk('purchase'))).toBe('purchase');
  });

  it('falls back to the type for a first-class event', () => {
    expect(actionOf({ type: 'product_view', data: {} })).toBe('product_view');
    expect(actionOf({ type: 'content_click', data: null })).toBe('content_click');
  });

  it('ignores empty or non-string names rather than returning them', () => {
    expect(actionOf({ type: 'page_view', data: { action: '  ', event: 42 as never } })).toBe('page_view');
  });
});

describe('the default registry learns content', () => {
  it('names the four content actions with impression at ZERO', () => {
    for (const a of CONTENT_ACTIONS) expect(DEFAULT_REFLEX_CONFIG.weights[a]).toBe(CONTENT_WEIGHTS[a]);
    // Dense and involuntary: showing her a video must not read as liking video.
    expect(DEFAULT_REFLEX_CONFIG.weights.content_impression).toBe(0);
    expect(DEFAULT_REFLEX_CONFIG.weights.video_complete).toBeGreaterThan(DEFAULT_REFLEX_CONFIG.weights.content_click);
  });

  it('has a contentType dimension sourced from the attribute the SDK sends', () => {
    const dim = DEFAULT_REFLEX_CONFIG.dimensions.find((d) => d.key === 'contentType');
    expect(dim).toMatchObject({ source: 'contentType' });
  });

  it('classifies exactly the four content actions', () => {
    for (const a of CONTENT_ACTIONS) expect(isContentAction(a)).toBe(true);
    for (const a of ['product_view', 'purchase', 'custom', 'tick']) expect(isContentAction(a)).toBe(false);
  });
});

describe('contentTouches — the registry decides what matters', () => {
  it('turns the SDK contentType into a registry touch', () => {
    const touches = contentTouches({ contentId: 'c1', slot: 'hero', contentType: 'video' }, DEFAULT_REFLEX_CONFIG);
    expect(touches).toEqual([{ dim: 'contentType', value: 'video' }]);
  });

  it('ignores attributes the registry does not name, so slot and contentId never become dimensions', () => {
    const touches = contentTouches({ contentId: 'c1', slot: 'hero', contentType: 'editorial', ms: 4000 }, DEFAULT_REFLEX_CONFIG);
    expect(touches.map((t) => t.dim)).toEqual(['contentType']);
  });

  it('picks up a second attribute the moment the registry names it', () => {
    // The "any event becomes an action against the registry" property: a tag
    // the SDK starts sending needs a registry entry and nothing else.
    const cfg: ReflexConfig = {
      ...DEFAULT_REFLEX_CONFIG,
      dimensions: [...DEFAULT_REFLEX_CONFIG.dimensions, { key: 'line', source: 'line' }],
    };
    const touches = contentTouches({ contentType: 'video', line: 'Tabby' }, cfg);
    expect(touches).toEqual(expect.arrayContaining([
      { dim: 'contentType', value: 'video' }, { dim: 'line', value: 'Tabby' },
    ]));
  });

  it('runs through the sanitizer, so a hostile value is dropped', () => {
    const touches = contentTouches({ contentType: '<script>' }, DEFAULT_REFLEX_CONFIG);
    expect(touches).toEqual([]);
  });
});

describe('end to end through apply(): content engagement becomes affinity', () => {
  const cfg = DEFAULT_REFLEX_CONFIG;
  const run = (events: Array<{ action: string; data: Record<string, unknown> }>) => {
    let state = apply(null, { action: 'tick', touches: [] }, T0, cfg).state;
    let t = T0;
    for (const e of events) {
      t += 5_000;
      state = apply(state, { action: e.action, touches: contentTouches(e.data, cfg) }, t, cfg).state;
    }
    return snapshot(state, t, cfg);
  };

  it('a shopper who finishes videos builds video affinity', () => {
    const snap = run([
      { action: 'video_complete', data: { contentType: 'video' } },
      { action: 'video_complete', data: { contentType: 'video' } },
    ]);
    expect(snap.dims.contentType?.video).toBeGreaterThan(0.5);
  });

  it('impressions alone build NOTHING, however many there are', () => {
    // Twelve renders of editorial. She never clicked. That is exposure, not interest.
    const snap = run(Array.from({ length: 12 }, () => ({ action: 'content_impression', data: { contentType: 'editorial' } })));
    expect(snap.dims.contentType?.editorial ?? 0).toBe(0);
  });

  it('a click outweighs a dwell, and a completed video outweighs both', () => {
    const one = (action: string) => run([{ action, data: { contentType: 'x' } }]).dims.contentType?.x ?? 0;
    expect(one('content_dwell')).toBeGreaterThan(0);
    expect(one('content_click')).toBeGreaterThan(one('content_dwell'));
    expect(one('video_complete')).toBeGreaterThan(one('content_click'));
  });

  it('crosses the audience threshold on content alone, so content-type audiences can form', () => {
    const snap = run([
      { action: 'video_complete', data: { contentType: 'video' } },
      { action: 'content_click', data: { contentType: 'video' } },
      { action: 'video_complete', data: { contentType: 'video' } },
    ]);
    expect(snap.dims.contentType?.video).toBeGreaterThanOrEqual(cfg.thetaIn);
  });
});

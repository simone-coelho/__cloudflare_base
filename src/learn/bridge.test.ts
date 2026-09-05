// src/learn/bridge.test.ts
// CW32, the featured-products bridge. Under the default policy an outcome
// credits a decision only when it names the served item, which a purchase of
// a product never does for a piece of content. A piece now carries the
// products it features onto its record and into the ring, an outcome carries
// the products it names, and a direct match accepts one naming the other.

import { describe, it, expect } from 'vitest';
import { attribute, DEFAULT_POLICY, type RingEntry } from './policy';
import { ringEntryOf } from './fan';
import { outcomeFromAction } from '@/ledger/records';
import { decideContent, type DecideInput } from '@/content/decide';
import type { Cell, ContentPiece, DecisionRecord } from '@/content/types';

const T0 = 1_725_000_000_000;
const cell: Cell = { channel: 'direct', visit_bucket: '1', region: null, affinity: null, stage: 'unknown' };
const entry = (id: string, item: string, products?: string[]): RingEntry => ({ id, ts: T0, page: 'home', slot: 'story', item, session_id: 's1', arm: 'personalized', cell, ...(products ? { products } : {}) });

describe('CW32 the featured-products bridge', () => {
  it('a purchase names its products, from the event and from each line item', () => {
    const o = outcomeFromAction({ type: 'purchase', userId: 'v1', sessionId: 's1', timestamp: T0 + 1000, data: { orderId: 'o-1', value: 250, items: [{ id: 'P-100', price: 250, quantity: 1 }, { sku: 'P-200' }, { id: 'P-100' }] } }, 'coach')!;
    expect(o.item_id).toBe('o-1');
    expect(o.products).toEqual(['P-100', 'P-200']);
    expect(outcomeFromAction({ type: 'content_click', userId: 'v1', timestamp: T0, data: { contentId: 'c1', slot: 'hero' } }, 'coach')!.products).toBeNull();
    expect(outcomeFromAction({ type: 'add_to_cart', userId: 'v1', timestamp: T0, data: { productId: 'P-300' } }, 'coach')!.products).toEqual(['P-300']);
  });

  it('a direct match accepts an outcome naming a product the served piece features, and still refuses a stranger', () => {
    const ring = [entry('d-story', 's-featured', ['P-100', 'P-101']), entry('d-plain', 'plain')];
    const purchase = outcomeFromAction({ type: 'purchase', userId: 'v1', sessionId: 's1', timestamp: T0 + 1000, data: { orderId: 'o-1', value: 250, items: [{ id: 'P-100' }] } }, 'coach')!;
    expect(attribute(purchase, ring, DEFAULT_POLICY).map((c) => c.decision_id)).toEqual(['d-story']);
    const other = outcomeFromAction({ type: 'purchase', userId: 'v1', sessionId: 's1', timestamp: T0 + 1000, data: { orderId: 'o-2', value: 10, items: [{ id: 'P-999' }] } }, 'coach')!;
    expect(attribute(other, ring, DEFAULT_POLICY)).toEqual([]);
    // Naming the piece itself still works, and a bag added by product id credits the piece that featured it.
    const click = outcomeFromAction({ type: 'content_click', userId: 'v1', sessionId: 's1', timestamp: T0 + 1000, data: { contentId: 's-featured', slot: 'story' } }, 'coach')!;
    expect(attribute(click, ring, DEFAULT_POLICY).map((c) => c.decision_id)).toEqual(['d-story']);
    const bag = outcomeFromAction({ type: 'add_to_cart', userId: 'v1', sessionId: 's1', timestamp: T0 + 1000, data: { productId: 'P-101' } }, 'coach')!;
    expect(attribute(bag, ring, DEFAULT_POLICY).map((c) => c.decision_id)).toEqual(['d-story']);
  });

  it('the decision record carries the piece\'s featured products and the ring entry keeps them', () => {
    const piece = (id: string, extra: Partial<ContentPiece> = {}): ContentPiece =>
      ({ id, customerContentId: `cms-${id}`, type: 'editorial', title: id, tags: {}, slotTypes: ['story'], lifecycle: { status: 'live' }, ...extra });
    const input: DecideInput = {
      tenant: 'coach', brand: 'coach', page: 'home', visitorId: 'v1', sessionId: 's1', identityAnchor: 'visitor', nowMs: T0,
      pieces: [piece('s-featured', { featuredProductIds: ['P-100'] }), piece('plain')], slots: [{ slot: 'story', take: 2, weights: {} }],
      affinity: null, cell, arm: 'personalized', versions: { config: 1, lift: 0, prior: 0, policy: 0 }, configLabel: 'v1',
    };
    const out = decideContent(input);
    const featured = out.records.find((r) => r.item_id === 's-featured')!, plain = out.records.find((r) => r.item_id === 'plain')!;
    expect(featured.featured_product_ids).toEqual(['P-100']);
    expect(plain.featured_product_ids).toBeUndefined();
    expect(ringEntryOf(featured as DecisionRecord).products).toEqual(['P-100']);
    expect(ringEntryOf(plain as DecisionRecord).products).toBeUndefined();
  });
});

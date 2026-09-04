// src/services/JourneyStage.test.ts
//
// CW29. The rule the engine has always applied per event, now callable from a
// shopper's counters by anything that holds them. deriveStage() must be exactly
// stageFromCounters() on a QualificationContext, so the demo path and the content
// decision can never disagree about where a shopper is.

import { describe, it, expect } from 'vitest';
import { STAGE_WORDS, asStage, deriveStage, stageFromCounters } from '@/services/JourneyStage';

describe('stageFromCounters', () => {
  it('a shopper who has done nothing is early', () => {
    expect(stageFromCounters({})).toBe('early');
    expect(stageFromCounters(null)).toBe('early');
    expect(stageFromCounters({ product_views: 1 })).toBe('early');
  });

  it('two product views, a long dwell, or a wishlist add is mid', () => {
    expect(stageFromCounters({ product_views: 2 })).toBe('mid');
    expect(stageFromCounters({ category_dwell_ms: 120_001 })).toBe('mid');
    expect(stageFromCounters({ wishlist_adds: 1 })).toBe('mid');
  });

  it('anything in the bag, or a purchase, is late', () => {
    expect(stageFromCounters({ cart_adds: 1 })).toBe('late');
    expect(stageFromCounters({ purchases: 1, product_views: 0 })).toBe('late');
  });

  it('a segment can pin the stage ahead of the counts', () => {
    expect(stageFromCounters({}, ['ready_to_buy'])).toBe('late');
    expect(stageFromCounters({}, ['Mid_Journey_Considering'])).toBe('mid');
  });

  it('ignores values that are not numbers rather than trusting them', () => {
    expect(stageFromCounters({ cart_adds: '1' as never, product_views: NaN })).toBe('early');
  });

  it('is exactly what deriveStage does with a qualification context', () => {
    const ctx = { attributes: { product_views: 3, cart_adds: 0 }, segments: [] } as never;
    expect(deriveStage(ctx)).toBe(stageFromCounters({ product_views: 3, cart_adds: 0 }, []));
    expect(deriveStage({ attributes: { cart_adds: 2 }, segments: [] } as never)).toBe('late');
  });
});

describe('the names', () => {
  it("gives BTIE's words for the three states", () => {
    expect(STAGE_WORDS).toEqual({ early: 'exploring', mid: 'considering', late: 'deciding' });
  });

  it('parses a stored value and refuses anything else', () => {
    expect(asStage('mid')).toBe('mid');
    expect(asStage('unknown')).toBeNull();
    expect(asStage(undefined)).toBeNull();
    expect(asStage('MID')).toBeNull();
  });
});

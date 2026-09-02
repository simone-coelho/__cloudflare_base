// src/services/visit.test.ts
//
// The regression that matters most is the first one: a visit number that does not
// move while a shopper is still on the same visit. The old `sessionCount`
// incremented on every call, so this is the assertion that would have caught it.

import { describe, it, expect } from 'vitest';
import {
  VISIT_GAP_MS,
  classifyEntryChannel,
  isNewVisit,
  nextVisitCount,
  visitAttributes,
  visitBucket,
} from '@/services/visit';

const T0 = 1_700_000_000_000;

describe('visit boundaries', () => {
  it('does NOT advance the visit while the shopper is still on it', () => {
    // The exact defect: twelve events in one visit used to read as visit 12.
    let count = 1;
    let lastSeen = T0;
    for (let i = 1; i <= 12; i++) {
      const now = T0 + i * 20_000; // an event every 20 seconds
      count = nextVisitCount(count, lastSeen, now);
      lastSeen = now;
    }
    expect(count).toBe(1);
  });

  it('advances once when the shopper comes back after the idle gap', () => {
    const count = nextVisitCount(1, T0, T0 + VISIT_GAP_MS + 1);
    expect(count).toBe(2);
  });

  it('advances once per return, not once per event after the gap', () => {
    let count = nextVisitCount(1, T0, T0 + VISIT_GAP_MS + 1); // visit 2 begins
    let lastSeen = T0 + VISIT_GAP_MS + 1;
    for (let i = 1; i <= 5; i++) {
      const now = lastSeen + 10_000;
      count = nextVisitCount(count, lastSeen, now);
      lastSeen = now;
    }
    expect(count).toBe(2);
  });

  it('treats a never-seen shopper as visit 1', () => {
    expect(nextVisitCount(undefined, undefined, T0)).toBe(1);
    expect(nextVisitCount(null, null, T0)).toBe(1);
    expect(nextVisitCount(0, T0, T0)).toBe(1);
  });

  it('is exactly at the boundary, not almost', () => {
    expect(isNewVisit(T0, T0 + VISIT_GAP_MS - 1)).toBe(false);
    expect(isNewVisit(T0, T0 + VISIT_GAP_MS)).toBe(true);
  });

  it('treats a missing or unusable last-seen as a new visit rather than throwing', () => {
    expect(isNewVisit(undefined, T0)).toBe(true);
    expect(isNewVisit(NaN, T0)).toBe(true);
  });

  it('never rewinds a visit count on a clock skew', () => {
    expect(nextVisitCount(5, T0, T0 - 60_000)).toBe(5);
  });
});

describe('visit bucket', () => {
  it('cuts where Mandeep cut: first visit, the 2-3 window, then everything after', () => {
    expect(visitBucket(1)).toBe('1');
    expect(visitBucket(2)).toBe('2-3');
    expect(visitBucket(3)).toBe('2-3');
    expect(visitBucket(4)).toBe('4+');
    expect(visitBucket(97)).toBe('4+');
  });

  it('degrades to the first visit for nonsense rather than inventing a bucket', () => {
    expect(visitBucket(0)).toBe('1');
    expect(visitBucket(-3)).toBe('1');
    expect(visitBucket(undefined)).toBe('1');
    expect(visitBucket(NaN)).toBe('1');
  });
});

describe('entry channel', () => {
  it('reads a UTM tag as a declaration, ahead of the referrer', () => {
    // Paid search click that Google also referred: the tag wins, or paid and
    // organic search become indistinguishable.
    expect(classifyEntryChannel({ utmMedium: 'cpc', referrer: 'https://www.google.com/' })).toBe('paid_search');
    expect(classifyEntryChannel({ utmMedium: 'paid_social', referrer: 'https://www.facebook.com/' })).toBe('paid_social');
  });

  it('classifies the common mediums', () => {
    const cases: Array<[string, string]> = [
      ['cpc', 'paid_search'], ['ppc', 'paid_search'], ['sem', 'paid_search'],
      ['paidsocial', 'paid_social'], ['display', 'paid_social'],
      ['email', 'email'], ['newsletter', 'email'],
      ['organic', 'organic'], ['referral', 'referral'], ['affiliate', 'referral'],
    ];
    for (const [medium, expected] of cases) {
      expect(classifyEntryChannel({ utmMedium: medium })).toBe(expected);
    }
  });

  it('is case and whitespace insensitive, because campaign tags are hand-typed', () => {
    expect(classifyEntryChannel({ utmMedium: '  CPC ' })).toBe('paid_search');
    expect(classifyEntryChannel({ utmMedium: 'Paid_Social' })).toBe('paid_social');
  });

  it('recognises an email platform from the source when the medium is missing', () => {
    expect(classifyEntryChannel({ utmSource: 'klaviyo' })).toBe('email');
    expect(classifyEntryChannel({ utmSource: 'Mailchimp' })).toBe('email');
  });

  it('resolves a bare social medium by whether the source is a known network', () => {
    expect(classifyEntryChannel({ utmMedium: 'social', utmSource: 'instagram' })).toBe('paid_social');
    expect(classifyEntryChannel({ utmMedium: 'social', utmSource: 'somebodys-blog' })).toBe('referral');
  });

  it('reads a search referrer as organic', () => {
    expect(classifyEntryChannel({ referrer: 'https://www.google.com/search?q=coach+bag' })).toBe('organic');
    expect(classifyEntryChannel({ referrer: 'https://duckduckgo.com/' })).toBe('organic');
  });

  it('classes an UNTAGGED social click as referral, not organic', () => {
    // The judgement call recorded in the module: "organic" in a six-value
    // grouping means organic SEARCH, and pooling untagged social alongside
    // search would compare populations that are not comparable.
    expect(classifyEntryChannel({ referrer: 'https://www.instagram.com/' })).toBe('referral');
    expect(classifyEntryChannel({ referrer: 'https://t.co/abc123' })).toBe('referral');
  });

  it('reads no referrer and no tag as direct', () => {
    expect(classifyEntryChannel({})).toBe('direct');
    expect(classifyEntryChannel({ referrer: '' })).toBe('direct');
    expect(classifyEntryChannel({ referrer: null, utmMedium: null })).toBe('direct');
  });

  it('does not read internal navigation as a referral', () => {
    expect(classifyEntryChannel({ referrer: 'https://www.coach.com/collections', siteHost: 'www.coach.com' })).toBe('direct');
    expect(classifyEntryChannel({ referrer: 'https://shop.coach.com/x', siteHost: 'coach.com' })).toBe('direct');
  });

  it('reads an ordinary third-party site as a referral', () => {
    expect(classifyEntryChannel({ referrer: 'https://www.vogue.com/article', siteHost: 'coach.com' })).toBe('referral');
  });

  it('accepts a bare host as well as a full URL', () => {
    expect(classifyEntryChannel({ referrer: 'google.com' })).toBe('organic');
  });

  it('falls back to direct on an unparseable referrer rather than throwing', () => {
    expect(classifyEntryChannel({ referrer: '::::' })).toBe('direct');
  });
});

describe('the attribute bundle the engine publishes', () => {
  it('carries the number, the bucket and the channel under the names already in use', () => {
    expect(visitAttributes(3, 'paid_social')).toEqual({
      visit_number: 3, visit_bucket: '2-3', entry_channel: 'paid_social',
    });
  });
});

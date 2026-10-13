// src/services/visit.gclid.test.ts
//
// Google's auto-tagged click: a landing URL carrying `gclid` and no
// `utm_source` reads as paid search in the channel classification, with the
// referrer's host as the source when it is a search engine. The change is to
// the CLASSIFICATION only: the entry contract (`validEntry`, W16 C2) still
// refuses the key, so no request carries it until that ruling is made.

import { describe, it, expect } from 'vitest';
import { classifyEntryChannel, entrySourceOf, projectVisit, validEntry, type ChannelSignals } from '@/services/visit';

const GCLID = 'EAIaIQobChMIp6Lq0d2-iAMVBJlQBh3k3QAaEAAYASAAEgJ_8fD_BwE';

describe('the auto-tagged Google click', () => {
  it('reads as paid search where it declares no source, with the search engine that referred it as its source', () => {
    for (const referrer of ['https://www.google.com/', 'www.google.co.uk', 'https://www.bing.com/search?q=lg+tvs']) {
      expect(classifyEntryChannel({ gclid: GCLID, referrer }), referrer).toBe('paid_search');
    }
    expect(entrySourceOf({ gclid: GCLID, referrer: 'https://www.google.com/' })).toBe('www.google.com');
    expect(entrySourceOf({ gclid: GCLID, referrer: 'www.google.co.uk' })).toBe('www.google.co.uk');
  });

  it('is still paid search with no referrer, or a referrer that is not a search engine, and then names no source', () => {
    expect(classifyEntryChannel({ gclid: GCLID })).toBe('paid_search');
    expect(entrySourceOf({ gclid: GCLID })).toBeNull();
    expect(classifyEntryChannel({ gclid: GCLID, referrer: 'https://news.example.com/article' })).toBe('paid_search');
    expect(entrySourceOf({ gclid: GCLID, referrer: 'https://news.example.com/article' })).toBeNull();
    // A host that merely contains a search engine's name is not one (the classifier's dot-boundary rule).
    expect(entrySourceOf({ gclid: GCLID, referrer: 'https://google.com.evil.example/' })).toBeNull();
  });

  it('leaves a declared source to the rules that judge it', () => {
    expect(classifyEntryChannel({ gclid: GCLID, utmSource: 'newsletter', utmMedium: 'email' })).toBe('email');
    expect(classifyEntryChannel({ gclid: GCLID, utmSource: 'facebook', utmMedium: 'cpc' })).toBe('paid_social');
    expect(classifyEntryChannel({ gclid: GCLID, utmSource: 'google', utmMedium: 'cpc' })).toBe('paid_search');
    expect(entrySourceOf({ gclid: GCLID, utmSource: 'Google', referrer: 'https://www.bing.com/' })).toBe('google');
  });

  it('changes nothing without a usable click id', () => {
    const google = { referrer: 'https://www.google.com/' };
    expect(classifyEntryChannel(google)).toBe('organic');
    for (const gclid of ['', '   ', null, undefined, 'x'.repeat(513)]) {
      expect(classifyEntryChannel({ ...google, gclid }), String(gclid).slice(0, 8)).toBe('organic');
      expect(entrySourceOf({ ...google, gclid })).toBeNull();
    }
    expect(classifyEntryChannel({ referrer: 'https://news.example.com/' })).toBe('referral');
  });

  it('does not widen the entry contract: a boundary still refuses the key, so the visit is classified as before', () => {
    expect(validEntry({ referrer: 'www.google.com' }, true)).toBe(true);
    expect(validEntry({ referrer: 'www.google.com', gclid: GCLID }, true)).toBe(false);
    expect(validEntry({ gclid: GCLID })).toBe(false);
    // What reaches the stored visit is a contract-valid entry, which has no click id to read.
    const entry: ChannelSignals = { referrer: 'www.google.com', siteHost: 'shop.example.com' };
    expect(projectVisit(null, null, 1_790_000_000_000, entry).entryChannel).toBe('organic');
  });
});

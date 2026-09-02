import { describe, it, expect } from 'vitest';
import { DEFAULT_REFLEX_CONFIG } from '@/reflex/core';
import { affinityCellOf, cellFor, regionOf, visitBucketOf } from './cell';

const cfg = { ...DEFAULT_REFLEX_CONFIG, thetaIn: 0.6, dimensions: [
  { key: 'line', source: 'line' },
  { key: 'occasion', source: 'occasion', multi: true, thetaIn: 0.7 },
] };

describe('cell', () => {
  it('region is country-region, country alone, or null', () => {
    expect(regionOf({ country: 'US', regionCode: 'NY' })).toBe('US-NY');
    expect(regionOf({ country: 'US' })).toBe('US');
    expect(regionOf({ regionCode: 'NY' })).toBeNull();
    expect(regionOf(null)).toBeNull();
  });

  it('the affinity cell is the leading interest above ITS dimension threshold', () => {
    expect(affinityCellOf({ dims: { line: { drover: 0.65 }, occasion: { evening: 0.68 } } }, cfg)).toBe('line:drover');
    expect(affinityCellOf({ dims: { line: { drover: 0.65 }, occasion: { evening: 0.9 } } }, cfg)).toBe('occasion:evening');
    expect(affinityCellOf({ dims: { line: { drover: 0.5 } } }, cfg)).toBeNull();
    expect(affinityCellOf(null, cfg)).toBeNull();
  });

  it('visit buckets, with unknown for anything the engine has not observed', () => {
    expect(visitBucketOf(1)).toBe('1'); expect(visitBucketOf(3)).toBe('2-3'); expect(visitBucketOf(9)).toBe('4+');
    expect(visitBucketOf(null)).toBe('unknown'); expect(visitBucketOf(0)).toBe('unknown');
  });

  it('never guesses a channel', () => {
    const c = cellFor({ cfg, cf: { country: 'GB' }, snap: null });
    expect(c).toEqual({ channel: 'unknown', visit_bucket: 'unknown', region: 'GB', affinity: null });
    expect(cellFor({ cfg, channel: ' Paid Social ' }).channel).toBe('paid social');
  });
});

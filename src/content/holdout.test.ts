import { describe, it, expect } from 'vitest';
import { armFor, bucketOf } from './holdout';

const ids = Array.from({ length: 20_000 }, (_, i) => `v${i.toString(36)}-${(i * 7919) % 1000}`);

describe('holdout assignment', () => {
  it('is deterministic and sticky for a given salt', () => {
    const h = { share: 0.05, salt: 'coach', arms: ['default' as const] };
    for (const id of ids.slice(0, 500)) expect(armFor(id, h)).toBe(armFor(id, h));
  });

  it('honours the share within tolerance over many visitors', () => {
    const h = { share: 0.05, salt: 'coach', arms: ['default' as const] };
    const held = ids.filter((id) => armFor(id, h) === 'default').length / ids.length;
    expect(held).toBeGreaterThan(0.04);
    expect(held).toBeLessThan(0.06);
  });

  it('a new salt reassigns; share 0 and 1 are the two edges', () => {
    const a = ids.slice(0, 2000).map((id) => armFor(id, { share: 0.5, salt: 'one', arms: ['default'] }));
    const b = ids.slice(0, 2000).map((id) => armFor(id, { share: 0.5, salt: 'two', arms: ['default'] }));
    expect(a.filter((x, i) => x !== b[i]).length).toBeGreaterThan(500);
    expect(ids.slice(0, 200).every((id) => armFor(id, { share: 0, salt: 's', arms: ['default'] }) === 'personalized')).toBe(true);
    expect(ids.slice(0, 200).every((id) => armFor(id, { share: 1, salt: 's', arms: ['default'] }) === 'default')).toBe(true);
  });

  it('splits the holdout slice evenly across arms', () => {
    const h = { share: 0.2, salt: 'coach', arms: ['default' as const, 'no_learning' as const] };
    const arms = ids.map((id) => armFor(id, h));
    const d = arms.filter((a) => a === 'default').length, n = arms.filter((a) => a === 'no_learning').length;
    expect(d + n).toBeGreaterThan(ids.length * 0.18);
    expect(Math.abs(d - n)).toBeLessThan(ids.length * 0.02);
  });

  it('buckets lie in [0, 1)', () => {
    for (const id of ids.slice(0, 1000)) { const b = bucketOf(id, 'x'); expect(b).toBeGreaterThanOrEqual(0); expect(b).toBeLessThan(1); }
  });
});

import { describe, it, expect } from 'vitest';
import { RESERVED_PREFIXES } from '@/config/versionedStore';
import {
  CONTENT_KIND, DEFAULT_LEARN, DEFAULT_SLOTS, LEARN_KIND, SLOTS_KIND,
  validateContentCatalog, validateLearnConfig, validateSlotCatalog,
} from './kinds';

describe('document kinds', () => {
  it('own reserved prefixes, so lift snapshots cannot collide with them', () => {
    expect(RESERVED_PREFIXES).toContain('content:config:');
    expect(RESERVED_PREFIXES).toContain('slots:config:');
    expect(RESERVED_PREFIXES).toContain('learn:config:');
    expect([CONTENT_KIND.name, SLOTS_KIND.name, LEARN_KIND.name]).toEqual(['content', 'slots', 'learn']);
  });

  it('the compiled defaults validate under their own kind', () => {
    expect(validateSlotCatalog(DEFAULT_SLOTS).ok).toBe(true);
    expect(validateLearnConfig(DEFAULT_LEARN).ok).toBe(true);
    expect(validateContentCatalog({ pieces: [] }).ok).toBe(true);
  });

  it('a catalog validator returns every error, not the first', () => {
    const r = validateContentCatalog({ pieces: [
      { id: 'a', customerContentId: 'x', type: 'editorial', title: 'A', tags: { line: ['drover'] }, slotTypes: ['hero'] },
      { id: 'a', customerContentId: '', type: 'editorial', title: 'B', tags: { line: 'drover' }, slotTypes: [], lifecycle: { status: 'gone' } },
    ] });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors).toEqual(expect.arrayContaining([
        expect.stringContaining("duplicate 'a'"),
        expect.stringContaining('customerContentId'),
        expect.stringContaining('tags.line'),
        expect.stringContaining('slotTypes'),
        expect.stringContaining('lifecycle.status'),
      ]));
      expect(r.errors.length).toBeGreaterThanOrEqual(5);
    }
  });

  it('a slot validator rejects weights outside 0..1, bad takes, and duplicate slots', () => {
    const r = validateSlotCatalog({ pages: { home: [
      { slot: 'hero', take: 0, weights: { line: 1.5 } },
      { slot: 'hero', take: 1, weights: {} },
    ] } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toEqual(expect.arrayContaining([
      expect.stringContaining('take'), expect.stringContaining('weights.line'), expect.stringContaining("duplicate 'hero'"),
    ]));
  });

  it('stamps the revision into the label without stacking suffixes', () => {
    const v1 = SLOTS_KIND.stamp!(DEFAULT_SLOTS, 3);
    const v2 = SLOTS_KIND.stamp!(v1, 4);
    expect(v1.version).toBe('slots-default+r3');
    expect(v2.version).toBe('slots-default+r4');
  });

  it('learn validates the regional section when present, and the default carries one', () => {
    expect(DEFAULT_LEARN.regional).toEqual({ enabled: true, kBlend: 1, minEvents: 30 });
    expect(validateLearnConfig({ holdout: { share: 0.1, arms: ['default'] }, regional: { enabled: false, kBlend: 2, minEvents: 10 } }).ok).toBe(true);
    const bad = validateLearnConfig({ holdout: { share: 0.1, arms: ['default'] }, regional: { enabled: 'yes', kBlend: 0, minEvents: 0 } });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors).toHaveLength(3);
  });

  it('learn accepts only known arms and a share in range', () => {
    expect(validateLearnConfig({ holdout: { share: 0.1, arms: ['default', 'no_learning'] } }).ok).toBe(true);
    const bad = validateLearnConfig({ holdout: { share: 2, arms: ['default', 'default', 'x'] } });
    expect(bad.ok).toBe(false);
  });
});

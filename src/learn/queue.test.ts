// src/learn/queue.test.ts
// The work queue: counts of what needs a person, nothing else.

import { describe, it, expect } from 'vitest';
import { queueOf } from './queue';
import type { Proposal } from './autonomy';
import type { SlotIndexEntry } from './rows';
import type { LearnConfig } from '@/content/types';

const slot = (page: string, s: string, extra: Partial<SlotIndexEntry> = {}): SlotIndexEntry =>
  ({ page, slot: s, take: 1, pinned: null, dimensions: [], rules: [], pieces: 3, reward: 'click', objective: 'unit', gamma: 0, exploration: 'off', autonomy: 'configured', controls: 0, evidence: null, ...extra });

describe('the work queue', () => {
  it('counts pending proposals, slots without evidence, slots acting, controls and erasures', () => {
    const proposals = [{ status: 'proposed' }, { status: 'applied' }, { status: 'proposed' }, { status: 'rejected' }] as Proposal[];
    const slots = [
      slot('home', 'merch', { pinned: 'm' }),
      slot('home', 'hero', { gamma: 0.5, evidence: { items: 3, events: 27, publishedAt: 1 } }),
      slot('home', 'story', { evidence: { items: 0, events: 0, publishedAt: 0 } }),
      slot('pdp', 'rail'),
    ];
    const learn: LearnConfig = { holdout: { share: 0, salt: '', arms: ['default'] }, slots: { hero: { items: { a: { mode: 'freeze', lift: 1.2 }, b: { mode: 'reject' } } }, rail: { items: { c: { mode: 'reject' } } } } };
    expect(queueOf({ proposals, slots, learn, erasuresPending: 2 })).toEqual({
      proposals_pending: 2,
      slots_without_evidence: [{ page: 'home', slot: 'story' }, { page: 'pdp', slot: 'rail' }],
      slots_acting: [{ page: 'home', slot: 'hero', gamma: 0.5 }],
      items_frozen: 1, items_rejected: 2, erasures_pending: 2, slots_total: 4,
    });
  });
});

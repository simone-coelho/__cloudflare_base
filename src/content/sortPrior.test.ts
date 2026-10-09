// src/content/sortPrior.test.ts
// The regional prior for POST /sort, at its own seam: it reads nothing for a
// shopper who has not consented to personalization, and an unreadable learn
// publication costs the shopper no grid — the sort is the one it always was.
// The route-level proof (allowlist, region, assertion, label) is in
// src/routes/sort.regional.test.ts.

import { describe, it, expect } from 'vitest';
import type { Env } from '@/types/env';
import { invalidatePublicationCache } from '@/config/publication';
import { regionalPriorForSort } from './sortPrior';

const CONSENTING = { tracking: true, personalization: true };

describe('regionalPriorForSort', () => {
  it('reads nothing at all for a shopper who withheld tracking or personalization', async () => {
    const untouchable = new Proxy({}, { get() { throw new Error('read for a shopper who did not consent'); } });
    const env = { STORAGE: untouchable, CACHE: untouchable } as unknown as Env;
    for (const consent of [{ tracking: false, personalization: true }, { tracking: true, personalization: false }, { tracking: false, personalization: false }]) {
      expect(await regionalPriorForSort(env, 'acme', { personal: {}, consent, cf: { country: 'US', regionCode: 'NC' } })).toBeNull();
    }
  });

  it('answers no prior, not a refusal, where the tenant has no readable learn publication', async () => {
    invalidatePublicationCache();
    const empty = {
      async get() { return null; }, async head() { return null; },
      async list() { return { objects: [], truncated: false }; }, async put() { return null; },
    };
    const env = { STORAGE: empty, CACHE: { get: async () => null } } as unknown as Env;
    expect(await regionalPriorForSort(env, 'acme', { personal: {}, consent: CONSENTING, cf: { country: 'US', regionCode: 'NC' } })).toBeNull();
  });
});

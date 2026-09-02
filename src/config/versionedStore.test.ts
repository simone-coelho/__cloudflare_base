// src/config/versionedStore.test.ts
//
// The point of these tests is the SECOND kind. configStore.test.ts already proves
// the reflex document works; what has to be proven here is that a kind doc 22 has
// not written yet -- the per-slot learning catalog in its section 13, a lift
// snapshot, a prior, a policy -- inherits versioning, attribution, audit,
// rollback and failure-safety without adding a line of store code.
//
// If that is true, phases 0 to 3 add a DocumentKind. If it is not, they build a
// second store, and the programme has two answers to "what changed, when, by
// whom, and how do I put it back".

import { describe, it, expect, beforeEach } from 'vitest';
import type { Env } from '@/types/env';
import {
  RESERVED_PREFIXES,
  deepMerge,
  invalidateCache,
  patch,
  read,
  readIndex,
  readRevision,
  readVersion,
  rollback,
  write,
  type DocumentKind,
} from '@/config/versionedStore';

class FakeKV {
  store = new Map<string, string>();
  reads = 0;
  failReads = false;
  async get(key: string): Promise<unknown> {
    this.reads++;
    if (this.failReads) throw new Error('KV unavailable');
    const raw = this.store.get(key);
    return raw === undefined ? null : JSON.parse(raw);
  }
  async put(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }
}

/**
 * A stand-in for doc 22's per-slot learning catalog: the gamma trust dial, the
 * exploration share, and the autonomy bounds. Deliberately nothing like
 * ReflexConfig, so nothing reflex-shaped can be hiding in the generic store.
 */
interface SlotLearning {
  slot: string;
  gamma: number;
  exploration: { mode: string; share: number };
  autonomy: { mode: string; step: number; pinned: string[] };
}

const LEARNING_KIND: DocumentKind<SlotLearning> = {
  name: 'learn',
  validate(candidate) {
    const errors: string[] = [];
    if (typeof candidate !== 'object' || candidate === null) {
      return { ok: false, errors: ['must be an object'] };
    }
    const c = candidate as Record<string, unknown>;
    if (typeof c.slot !== 'string' || c.slot === '') errors.push('slot must be a non-empty string');
    if (typeof c.gamma !== 'number' || !(c.gamma >= 0 && c.gamma <= 1)) {
      errors.push('gamma must be between 0 and 1');
    }
    if (errors.length) return { ok: false, errors };
    return { ok: true, value: JSON.parse(JSON.stringify(c)) as SlotLearning };
  },
};

const FALLBACK: SlotLearning = {
  slot: 'home.hero',
  gamma: 0,
  exploration: { mode: 'rotation', share: 0.1 },
  autonomy: { mode: 'assisted', step: 0.05, pinned: [] },
};

let kv: FakeKV;
let env: Env;

beforeEach(() => {
  kv = new FakeKV();
  env = { CACHE: kv } as unknown as Env;
  invalidateCache();
});

describe('a second document kind inherits the whole store', () => {
  it('falls back to the caller default when nothing is stored', async () => {
    expect(await read(env, LEARNING_KIND, 'coach', FALLBACK)).toBe(FALLBACK);
  });

  it('versions, attributes and serves a stored document', async () => {
    const res = await write(env, LEARNING_KIND, 'coach', { ...FALLBACK, gamma: 0.4 }, {
      actor: 'ds@tapestry', note: 'trust the lift on hero', nowMs: 500,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.revision.revision).toBe(1);
    expect(res.revision.value.gamma).toBe(0.4);

    const live = await readRevision(env, LEARNING_KIND, 'coach');
    expect(live).toMatchObject({ revision: 1, actor: 'ds@tapestry', note: 'trust the lift on hero', at: 500 });
  });

  it('refuses an invalid document and leaves what is live untouched', async () => {
    await write(env, LEARNING_KIND, 'coach', { ...FALLBACK, gamma: 0.4 }, { actor: 'a' });
    const bad = await write(env, LEARNING_KIND, 'coach', { ...FALLBACK, gamma: 9 }, { actor: 'b' });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.join(' ')).toMatch(/gamma/);
    expect((await read(env, LEARNING_KIND, 'coach', FALLBACK)).gamma).toBe(0.4);
  });

  it('keeps an audit index, newest first', async () => {
    await write(env, LEARNING_KIND, 'coach', FALLBACK, { actor: 'a', note: 'first' });
    await write(env, LEARNING_KIND, 'coach', { ...FALLBACK, gamma: 0.2 }, { actor: 'b', note: 'second' });
    const index = await readIndex(env, LEARNING_KIND, 'coach');
    expect(index.map((e) => e.revision)).toEqual([2, 1]);
    expect(index[0].actor).toBe('b');
  });

  it('rolls forward on rollback: the counter never rewinds', async () => {
    await write(env, LEARNING_KIND, 'coach', { ...FALLBACK, gamma: 0.1 }, { actor: 'a' });
    await write(env, LEARNING_KIND, 'coach', { ...FALLBACK, gamma: 0.9 }, { actor: 'b' });
    const res = await rollback(env, LEARNING_KIND, 'coach', 1, { actor: 'c' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.revision.revision).toBe(3);
    expect(res.revision.value.gamma).toBe(0.1);
    expect(res.revision.note).toMatch(/rollback to revision 1/);
  });

  it('serves the fallback rather than throwing when KV is down', async () => {
    kv.failReads = true;
    await expect(read(env, LEARNING_KIND, 'coach', FALLBACK)).resolves.toBe(FALLBACK);
  });

  it('ignores a stored document that no longer validates', async () => {
    kv.store.set('learn:config:coach:current', JSON.stringify({
      revision: 1, at: 1, actor: 'old-build', note: '', value: { slot: 'home.hero', gamma: 42 },
    }));
    expect(await read(env, LEARNING_KIND, 'coach', FALLBACK)).toBe(FALLBACK);
  });
});

describe('kinds and scopes never collide', () => {
  it('two kinds at the same scope are independent', async () => {
    await write(env, LEARNING_KIND, 'coach', { ...FALLBACK, gamma: 0.5 }, { actor: 'a' });
    // The reflex kind writes under reflex:config:coach:*; nothing here touched it.
    expect([...kv.store.keys()].every((k) => k.startsWith('learn:config:coach:'))).toBe(true);
  });

  it('two scopes of one kind are independent', async () => {
    await write(env, LEARNING_KIND, 'coach', { ...FALLBACK, gamma: 0.1 }, { actor: 'a' });
    await write(env, LEARNING_KIND, 'kate-spade', { ...FALLBACK, gamma: 0.8 }, { actor: 'a' });
    expect((await read(env, LEARNING_KIND, 'coach', FALLBACK)).gamma).toBe(0.1);
    expect((await read(env, LEARNING_KIND, 'kate-spade', FALLBACK)).gamma).toBe(0.8);
  });

  it('reserves the prefixes doc 22 will publish under, so nothing claims them twice', () => {
    expect(RESERVED_PREFIXES).toContain('reflex:config:');
    expect(RESERVED_PREFIXES).toContain('learn:config:');
    expect(RESERVED_PREFIXES).toContain('lift:');
    expect(RESERVED_PREFIXES).toContain('prior:');
    expect(RESERVED_PREFIXES).toContain('policy:');
  });
});

describe('the default deep merge', () => {
  it('merges nested objects instead of replacing them, so one dial does not clear its neighbours', async () => {
    await write(env, LEARNING_KIND, 'coach', FALLBACK, { actor: 'a' });
    const res = await patch(env, LEARNING_KIND, 'coach', FALLBACK, { exploration: { share: 0.25 } }, { actor: 'b' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.revision.value.exploration).toEqual({ mode: 'rotation', share: 0.25 });
    expect(res.revision.value.autonomy.step).toBe(0.05);
  });

  it('replaces arrays wholesale, because a pinned list is a set and not a merge', () => {
    const out = deepMerge(FALLBACK, { autonomy: { pinned: ['occasion'] } });
    expect(out.autonomy.pinned).toEqual(['occasion']);
    expect(out.autonomy.mode).toBe('assisted');
  });

  it('does not mutate the base', () => {
    const before = JSON.stringify(FALLBACK);
    deepMerge(FALLBACK, { gamma: 1, exploration: { share: 0.9 } });
    expect(JSON.stringify(FALLBACK)).toBe(before);
  });

  it('refuses prototype-polluting keys', () => {
    const out = deepMerge({ a: 1 }, JSON.parse('{"__proto__": {"polluted": true}, "a": 2}'));
    expect(out.a).toBe(2);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('validates the MERGED document, so a partial patch cannot slip past an invariant', async () => {
    const res = await patch(env, LEARNING_KIND, 'coach', FALLBACK, { gamma: 5 }, { actor: 'b' });
    expect(res.ok).toBe(false);
  });
});

describe('reading what an older build wrote', () => {
  it('accepts the legacy `config` envelope field as well as `value`', async () => {
    kv.store.set('learn:config:coach:current', JSON.stringify({
      revision: 7, at: 1, actor: 'old-build', note: 'written before the generalization',
      config: { ...FALLBACK, gamma: 0.33 },
    }));
    const rev = await readRevision(env, LEARNING_KIND, 'coach');
    expect(rev?.value.gamma).toBe(0.33);
    expect(rev?.revision).toBe(7);
  });

  it('writes both field names, so an older build can still read a newer write', async () => {
    await write(env, LEARNING_KIND, 'coach', FALLBACK, { actor: 'a' });
    const raw = JSON.parse(kv.store.get('learn:config:coach:current') as string);
    expect(raw.value).toBeTruthy();
    expect(raw.config).toEqual(raw.value);
  });

  it('keeps every revision body addressable for replay', async () => {
    await write(env, LEARNING_KIND, 'coach', { ...FALLBACK, gamma: 0.1 }, { actor: 'a' });
    await write(env, LEARNING_KIND, 'coach', { ...FALLBACK, gamma: 0.2 }, { actor: 'a' });
    expect((await readVersion(env, LEARNING_KIND, 'coach', 1))?.value.gamma).toBe(0.1);
    expect((await readVersion(env, LEARNING_KIND, 'coach', 2))?.value.gamma).toBe(0.2);
  });
});

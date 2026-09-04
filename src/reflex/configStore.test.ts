// src/reflex/configStore.test.ts
// CW0's proof. The store's job is to make tuning safe without a deploy, so the
// tests are weighted toward the two ways that goes wrong: an invalid config
// reaching the decision path, and a config read failure taking the engine down.

import { describe, it, expect, beforeEach } from 'vitest';
import { DEFAULT_REFLEX_CONFIG, type ReflexConfig } from '@/reflex/core';
import type { Env } from '@/types/env';
import {
  CACHE_TTL_MS,
  applyPatch,
  invalidateConfigCache,
  patchReflexConfig,
  readConfigIndex,
  readReflexConfig,
  readReflexConfigRevision,
  readReflexConfigVersion,
  rollbackReflexConfig,
  stampVersion,
  validateReflexConfig,
  writeReflexConfig,
} from '@/reflex/configStore';

// ── A KV stand-in with the two behaviours the store depends on ───────────────

class FakeKV {
  store = new Map<string, string>();
  reads = 0;
  failReads = false;
  async get(key: string, _type?: string): Promise<unknown> {
    this.reads++;
    if (this.failReads) throw new Error('KV unavailable');
    const raw = this.store.get(key);
    return raw === undefined ? null : JSON.parse(raw);
  }
  async put(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }
}

function envWith(kv: FakeKV): Env {
  return { CACHE: kv } as unknown as Env;
}

/** A valid config that is not the compiled default, so identity is meaningful. */
function sampleConfig(over: Partial<ReflexConfig> = {}): ReflexConfig {
  return JSON.parse(JSON.stringify({ ...DEFAULT_REFLEX_CONFIG, version: 'tuned-v1', ...over }));
}

const SCOPE = 'coach';
let kv: FakeKV;
let env: Env;

beforeEach(() => {
  kv = new FakeKV();
  env = envWith(kv);
  invalidateConfigCache();
});

// ── Validation ───────────────────────────────────────────────────────────────

describe('validateReflexConfig', () => {
  it('accepts the compiled default — the validator must never reject what ships', () => {
    const r = validateReflexConfig(JSON.parse(JSON.stringify(DEFAULT_REFLEX_CONFIG)));
    expect(r.ok).toBe(true);
  });

  it('rejects thetaOut equal to or above thetaIn, because the band is what stops flapping', () => {
    for (const [thetaIn, thetaOut] of [[0.6, 0.6], [0.6, 0.7]]) {
      const r = validateReflexConfig(sampleConfig({ thetaIn, thetaOut }));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.errors.join(' ')).toMatch(/thetaOut .* must be strictly below thetaIn/);
    }
  });

  it('catches a dimension override that inverts the band against the GLOBAL other side', () => {
    // The subtle case: the dimension only overrides thetaIn, and 0.4 sits below
    // the global thetaOut of 0.45. Per-dimension alone looks fine; effective does not.
    const cfg = sampleConfig();
    cfg.dimensions = [{ ...cfg.dimensions[0], thetaIn: 0.4 }];
    const r = validateReflexConfig(cfg);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toMatch(/dimensions\[0\].*strictly below/);
  });

  it('rejects out-of-range scalars', () => {
    const cases: Array<[Partial<ReflexConfig>, RegExp]> = [
      [{ tauMs: 0 }, /tauMs must be greater than 0/],
      [{ tauMs: -1 }, /tauMs/],
      [{ K: 0 }, /K must be greater than 0/],
      [{ thetaIn: 1.5 }, /thetaIn must be at most 1/],
      [{ epsilon: 0 }, /epsilon must be greater than 0/],
      [{ maxValuesPerDim: 0 }, /maxValuesPerDim must be at least 1/],
      [{ maxValuesPerDim: 2.5 }, /maxValuesPerDim must be an integer/],
    ];
    for (const [over, re] of cases) {
      const r = validateReflexConfig(sampleConfig(over));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.errors.join(' ')).toMatch(re);
    }
  });

  it('rejects duplicate dimension keys', () => {
    const cfg = sampleConfig();
    cfg.dimensions = [{ key: 'line', source: 'line' }, { key: 'line', source: 'category' }];
    const r = validateReflexConfig(cfg);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toMatch(/duplicated/);
  });

  it('rejects an empty dimension list', () => {
    const r = validateReflexConfig(sampleConfig({ dimensions: [] }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toMatch(/must not be empty/);
  });

  it('enforces the band arity: N cuts need N+1 labels, ascending', () => {
    const cfg = sampleConfig();
    cfg.dimensions = [{ key: 'priceBand', source: 'price_usd', derive: 'band', cuts: [150, 400], labels: ['a', 'b'] }];
    let r = validateReflexConfig(cfg);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toMatch(/2 cuts need 3 labels/);

    cfg.dimensions = [{ key: 'priceBand', source: 'price_usd', derive: 'band', cuts: [400, 150], labels: ['a', 'b', 'c'] }];
    r = validateReflexConfig(cfg);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toMatch(/strictly ascending/);
  });

  it('rejects negative weights and prototype-polluting action names', () => {
    let r = validateReflexConfig(sampleConfig({ weights: { product_view: -1 } }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toMatch(/weights.product_view must be at least 0/);

    r = validateReflexConfig(sampleConfig({ weights: JSON.parse('{"__proto__": 2}') }));
    expect(r.ok).toBe(false);
  });

  it('reports every error at once rather than the first', () => {
    const r = validateReflexConfig(sampleConfig({ tauMs: -1, K: 0, thetaIn: 5 }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.length).toBeGreaterThanOrEqual(3);
  });

  it('rejects non-objects outright', () => {
    for (const bad of [null, 42, 'x', []]) {
      expect(validateReflexConfig(bad).ok).toBe(false);
    }
  });

  it('freezes what it returns, so a caller cannot mutate the shared config', () => {
    const r = validateReflexConfig(sampleConfig());
    expect(r.ok).toBe(true);
    if (r.ok) expect(() => { (r.config as { tauMs: number }).tauMs = 1; }).toThrow();
  });
});

// ── Version stamping ─────────────────────────────────────────────────────────

describe('stampVersion', () => {
  it('appends the revision and replaces an existing stamp rather than accreting', () => {
    expect(stampVersion('reflex-demo-v1', 3)).toBe('reflex-demo-v1+r3');
    expect(stampVersion('reflex-demo-v1+r3', 4)).toBe('reflex-demo-v1+r4');
  });
});

// ── Read path ────────────────────────────────────────────────────────────────

describe('readReflexConfig', () => {
  it('returns the compiled default BY IDENTITY when nothing is stored', async () => {
    expect(await readReflexConfig(env, SCOPE)).toBe(DEFAULT_REFLEX_CONFIG);
  });

  it('returns the compiled default when KV throws, and does not propagate the error', async () => {
    kv.failReads = true;
    expect(await readReflexConfig(env, SCOPE)).toBe(DEFAULT_REFLEX_CONFIG);
  });

  it('ignores a stored config that no longer validates, rather than scoring with it', async () => {
    // Written by an older build, or by hand. thetaOut above thetaIn would flap.
    kv.store.set('reflex:config:coach:current', JSON.stringify({
      revision: 1, at: 1, actor: 'legacy', note: '',
      config: { ...DEFAULT_REFLEX_CONFIG, thetaIn: 0.5, thetaOut: 0.9 },
    }));
    expect(await readReflexConfig(env, SCOPE)).toBe(DEFAULT_REFLEX_CONFIG);
  });

  it('ignores malformed stored JSON', async () => {
    kv.store.set('reflex:config:coach:current', JSON.stringify({ revision: 1, config: 'not-a-config' }));
    expect(await readReflexConfig(env, SCOPE)).toBe(DEFAULT_REFLEX_CONFIG);
  });

  it('serves repeat reads from the isolate cache — the hot path pays no KV read', async () => {
    await writeReflexConfig(env, SCOPE, sampleConfig(), { actor: 'test' });
    const before = kv.reads;
    for (let i = 0; i < 20; i++) await readReflexConfig(env, SCOPE, 1_000);
    expect(kv.reads - before).toBe(1);
  });

  it('re-reads once the TTL has passed', async () => {
    await writeReflexConfig(env, SCOPE, sampleConfig(), { actor: 'test' });
    await readReflexConfig(env, SCOPE, 1_000);
    const before = kv.reads;
    await readReflexConfig(env, SCOPE, 1_000 + CACHE_TTL_MS + 1);
    expect(kv.reads - before).toBe(1);
  });
});

// ── Write path ───────────────────────────────────────────────────────────────

describe('writeReflexConfig', () => {
  it('stores, stamps the version with the revision, and serves it on the next read', async () => {
    const res = await writeReflexConfig(env, SCOPE, sampleConfig(), { actor: 'simone', note: 'raise cart weight' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.revision.revision).toBe(1);
    expect(res.revision.config.version).toBe('tuned-v1+r1');

    const live = await readReflexConfig(env, SCOPE);
    expect(live).not.toBe(DEFAULT_REFLEX_CONFIG);
    expect(live.version).toBe('tuned-v1+r1');
  });

  it('increments the revision and re-stamps rather than accreting suffixes', async () => {
    await writeReflexConfig(env, SCOPE, sampleConfig(), { actor: 'a' });
    const second = await writeReflexConfig(env, SCOPE, sampleConfig(), { actor: 'b' });
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.revision.revision).toBe(2);
      expect(second.revision.config.version).toBe('tuned-v1+r2');
    }
  });

  it('changes the version stamp on every tune, so two explain records cannot claim the same provenance', async () => {
    const a = await writeReflexConfig(env, SCOPE, sampleConfig({ K: 1.8 }), { actor: 'a' });
    const b = await writeReflexConfig(env, SCOPE, sampleConfig({ K: 2.4 }), { actor: 'a' });
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) expect(a.revision.config.version).not.toBe(b.revision.config.version);
  });

  it('refuses an invalid config and leaves what is live untouched', async () => {
    await writeReflexConfig(env, SCOPE, sampleConfig(), { actor: 'a' });
    const bad = await writeReflexConfig(env, SCOPE, sampleConfig({ thetaOut: 0.99 }), { actor: 'b' });
    expect(bad.ok).toBe(false);
    const live = await readReflexConfig(env, SCOPE);
    expect(live.version).toBe('tuned-v1+r1');
  });

  it('records an audit entry per revision, newest first', async () => {
    await writeReflexConfig(env, SCOPE, sampleConfig(), { actor: 'simone', note: 'first' });
    await writeReflexConfig(env, SCOPE, sampleConfig(), { actor: 'mark', note: 'second' });
    const index = await readConfigIndex(env, SCOPE);
    expect(index.map((e) => e.revision)).toEqual([2, 1]);
    expect(index[0].actor).toBe('mark');
    expect(index[1].note).toBe('first');
  });

  it('keeps every revision body addressable for diffing', async () => {
    await writeReflexConfig(env, SCOPE, sampleConfig({ K: 1.8 }), { actor: 'a' });
    await writeReflexConfig(env, SCOPE, sampleConfig({ K: 2.4 }), { actor: 'a' });
    expect((await readReflexConfigVersion(env, SCOPE, 1))?.config.K).toBe(1.8);
    expect((await readReflexConfigVersion(env, SCOPE, 2))?.config.K).toBe(2.4);
  });

  it('scopes are isolated from each other', async () => {
    await writeReflexConfig(env, 'coach', sampleConfig({ K: 1.1 }), { actor: 'a' });
    await writeReflexConfig(env, 'brighthour', sampleConfig({ K: 9.9 }), { actor: 'a' });
    expect((await readReflexConfig(env, 'coach')).K).toBe(1.1);
    expect((await readReflexConfig(env, 'brighthour')).K).toBe(9.9);
  });
});

// ── Patch path — what the tuning surface actually calls ──────────────────────

describe('applyPatch and patchReflexConfig', () => {
  it('merges weights without dropping the ones it did not mention', () => {
    const next = applyPatch(DEFAULT_REFLEX_CONFIG, { weights: { add_to_cart: 4 } });
    expect(next.weights.add_to_cart).toBe(4);
    expect(next.weights.purchase).toBe(DEFAULT_REFLEX_CONFIG.weights.purchase);
    expect(Object.keys(next.weights).length).toBe(Object.keys(DEFAULT_REFLEX_CONFIG.weights).length);
  });

  it('merges a dimension BY KEY without replacing the array', () => {
    const next = applyPatch(DEFAULT_REFLEX_CONFIG, { dimensions: [{ key: 'priceBand', tauMs: 300_000 }] });
    expect(next.dimensions.length).toBe(DEFAULT_REFLEX_CONFIG.dimensions.length);
    expect(next.dimensions.find((d) => d.key === 'priceBand')?.tauMs).toBe(300_000);
    expect(next.dimensions.find((d) => d.key === 'line')).toBeTruthy();
  });

  it('does not mutate the config it patches', () => {
    const before = JSON.stringify(DEFAULT_REFLEX_CONFIG);
    applyPatch(DEFAULT_REFLEX_CONFIG, { weights: { purchase: 99 }, tauMs: 1 });
    expect(JSON.stringify(DEFAULT_REFLEX_CONFIG)).toBe(before);
  });

  it('validates the MERGED result, so a one-sided patch cannot slip past the band', async () => {
    // thetaOut alone looks like a single number. Against the live thetaIn it inverts.
    const res = await patchReflexConfig(env, SCOPE, { thetaOut: 0.95 }, { actor: 'merch' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.join(' ')).toMatch(/strictly below/);
    expect(await readReflexConfig(env, SCOPE)).toBe(DEFAULT_REFLEX_CONFIG);
  });

  it('tunes one weight off the compiled default and stamps a revision', async () => {
    const res = await patchReflexConfig(env, SCOPE, { weights: { add_to_cart: 4 } }, { actor: 'merch', note: 'cart up' });
    expect(res.ok).toBe(true);
    const live = await readReflexConfig(env, SCOPE);
    expect(live.weights.add_to_cart).toBe(4);
    expect(live.weights.purchase).toBe(DEFAULT_REFLEX_CONFIG.weights.purchase);
    expect(live.version).toBe(`${DEFAULT_REFLEX_CONFIG.version}+r1`);
  });
});

// ── Rollback ─────────────────────────────────────────────────────────────────

describe('rollbackReflexConfig', () => {
  it('rolls forward: the old body returns as a NEW revision, the counter never rewinds', async () => {
    await writeReflexConfig(env, SCOPE, sampleConfig({ K: 1.1 }), { actor: 'a' });
    await writeReflexConfig(env, SCOPE, sampleConfig({ K: 9.9 }), { actor: 'b' });
    const res = await rollbackReflexConfig(env, SCOPE, 1, { actor: 'c' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(res.revision.revision).toBe(3);
    expect(res.revision.config.K).toBe(1.1);
    expect(res.revision.config.version).toBe('tuned-v1+r3');
    expect(res.revision.note).toMatch(/rollback to revision 1/);

    const index = await readConfigIndex(env, SCOPE);
    expect(index.map((e) => e.revision)).toEqual([3, 2, 1]);
  });

  it('refuses a revision that does not exist', async () => {
    const res = await rollbackReflexConfig(env, SCOPE, 7, { actor: 'c' });
    expect(res.ok).toBe(false);
  });
});

// ── The envelope the API reads ───────────────────────────────────────────────

describe('readReflexConfigRevision', () => {
  it('carries actor, note and timestamp so a change can be attributed', async () => {
    await writeReflexConfig(env, SCOPE, sampleConfig(), { actor: 'simone', note: 'why', nowMs: 1234 });
    const rev = await readReflexConfigRevision(env, SCOPE);
    expect(rev).toMatchObject({ revision: 1, actor: 'simone', note: 'why', at: 1234 });
  });

  it('is null when nothing is stored, which is how the API reports compiled-default', async () => {
    expect(await readReflexConfigRevision(env, SCOPE)).toBeNull();
  });
});

describe('error list quality', () => {
  it('reports a broken global band once, not once per dimension', () => {
    const r = validateReflexConfig(sampleConfig({ thetaIn: 0.5, thetaOut: 0.9 }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.filter((e) => /strictly below/.test(e))).toHaveLength(1);
    }
  });

  it('still reports the dimension that overrides a threshold badly', () => {
    const cfg = sampleConfig();
    cfg.dimensions = [{ ...cfg.dimensions[0], thetaOut: 0.99 }, cfg.dimensions[1]];
    const r = validateReflexConfig(cfg);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const band = r.errors.filter((e) => /strictly below/.test(e));
      expect(band).toHaveLength(1);
      expect(band[0]).toMatch(/dimensions\[0\]/);
    }
  });
});

// ── The seam the decision path actually calls ────────────────────────────────

describe('resolveReflexConfig — the wiring, not just the store', () => {
  it('falls back to the compiled default BY IDENTITY when nothing is stored', async () => {
    const { resolveReflexConfig } = await import('@/demos/registry');
    const { DEFAULT_REFLEX_CONFIG: D } = await import('@/reflex/core');
    expect(await resolveReflexConfig(env, 'coach')).toBe(D);
  });

  it('serves stored tuning to the decision path once a config has been written', async () => {
    const { resolveReflexConfig } = await import('@/demos/registry');
    await writeReflexConfig(env, 'coach', sampleConfig({ K: 3.3 }), { actor: 'merch' });
    const cfg = await resolveReflexConfig(env, 'coach');
    expect(cfg.K).toBe(3.3);
    expect(cfg.version).toBe('tuned-v1+r1');
  });

  it('keeps surfaces on their own tuning', async () => {
    const { resolveReflexConfig } = await import('@/demos/registry');
    await writeReflexConfig(env, 'coach', sampleConfig({ K: 1.1 }), { actor: 'a' });
    expect((await resolveReflexConfig(env, 'coach')).K).toBe(1.1);
    // brighthour has no stored config, so it still resolves to its own compiled one.
    const bh = await resolveReflexConfig(env, 'brighthour');
    expect(bh.K).not.toBe(1.1);
  });

  it('survives a KV outage by serving the compiled default rather than throwing', async () => {
    const { resolveReflexConfig } = await import('@/demos/registry');
    const { DEFAULT_REFLEX_CONFIG: D } = await import('@/reflex/core');
    kv.failReads = true;
    await expect(resolveReflexConfig(env, 'coach')).resolves.toBe(D);
  });
});

// ── The integer doc 22 records as versions.config ────────────────────────────

describe('resolveReflexConfigRevision — the join key, not the display string', () => {
  it('reports revision 0 for the compiled default, with the config by identity', async () => {
    const { resolveReflexConfigRevision } = await import('@/demos/registry');
    const { DEFAULT_REFLEX_CONFIG: D } = await import('@/reflex/core');
    const r = await resolveReflexConfigRevision(env, 'coach');
    expect(r.revision).toBe(0);
    expect(r.config).toBe(D);
  });

  it('reports the integer and the string together, and they agree', async () => {
    const { resolveReflexConfigRevision } = await import('@/demos/registry');
    await writeReflexConfig(env, 'coach', sampleConfig(), { actor: 'a' });
    await writeReflexConfig(env, 'coach', sampleConfig({ K: 2.2 }), { actor: 'a' });
    const r = await resolveReflexConfigRevision(env, 'coach');
    expect(r.revision).toBe(2);
    expect(r.config.version).toBe('tuned-v1+r2');
    // The ledger writer records the integer. Nothing should ever need to parse
    // '+r2' back out of the display string to get it.
    expect(r.config.version.endsWith(`+r${r.revision}`)).toBe(true);
  });
});

// ── Inheritance from the compiled default (2026-09-04) ───────────────────────
//
// The gap this closes: coach at revision 14 was written before CW3, so it had
// no content weights and every content event scored zero there until a person
// wrote revision 15 by hand. Absent means inherit; explicit zero means off;
// dimensions are never added silently, only named.

describe('inheritWeights: absent means inherit, zero means off', () => {
  /** A document written before the content weights existed. */
  function preContentConfig(): ReflexConfig {
    const c = sampleConfig();
    for (const k of ['content_impression', 'content_dwell', 'content_click', 'video_complete']) delete c.weights[k];
    return c;
  }

  it('fills a weight the document does not mention from the compiled default, and names it', async () => {
    const { inheritWeights, compiledDefaultFor } = await import('@/reflex/configStore');
    const { config, inherited } = inheritWeights(preContentConfig(), await compiledDefaultFor('coach'));
    expect(inherited).toEqual(['content_click', 'content_dwell', 'content_impression', 'video_complete']);
    expect(config.weights.content_click).toBe(DEFAULT_REFLEX_CONFIG.weights.content_click);
    expect(config.weights.video_complete).toBe(DEFAULT_REFLEX_CONFIG.weights.video_complete);
  });

  it('keeps an explicit zero: that is how an action is switched off', async () => {
    const { inheritWeights } = await import('@/reflex/configStore');
    const doc = preContentConfig();
    doc.weights.content_click = 0;
    const { config, inherited } = inheritWeights(doc, DEFAULT_REFLEX_CONFIG);
    expect(config.weights.content_click).toBe(0);
    expect(inherited).not.toContain('content_click');
  });

  it('keeps an authored value over the default, and a custom action the default lacks', async () => {
    const { inheritWeights } = await import('@/reflex/configStore');
    const doc = sampleConfig({ weights: { ...DEFAULT_REFLEX_CONFIG.weights, purchase: 9, try_on: 4 } });
    const { config, inherited } = inheritWeights(doc, DEFAULT_REFLEX_CONFIG);
    expect(config.weights.purchase).toBe(9);
    expect(config.weights.try_on).toBe(4);
    expect(inherited).toEqual([]);
  });

  it('returns the very same object when nothing is inherited, so identity comparisons still hold', async () => {
    const { inheritWeights } = await import('@/reflex/configStore');
    const doc = sampleConfig();
    expect(inheritWeights(doc, DEFAULT_REFLEX_CONFIG).config).toBe(doc);
  });

  it('never adds a dimension; it names it in the warnings instead', async () => {
    const { inheritWeights, configWarnings } = await import('@/reflex/configStore');
    const doc = sampleConfig({ dimensions: DEFAULT_REFLEX_CONFIG.dimensions.filter((d) => d.key !== 'contentType') });
    const { config } = inheritWeights(doc, DEFAULT_REFLEX_CONFIG);
    expect(config.dimensions.some((d) => d.key === 'contentType')).toBe(false);
    const warnings = configWarnings(config, DEFAULT_REFLEX_CONFIG);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/dimension 'contentType' \(source 'contentType'\)/);
    expect(configWarnings(sampleConfig(), DEFAULT_REFLEX_CONFIG)).toEqual([]);
  });

  it('reaches every reader: the stored revision, the plain read, a historical version, and the decision path', async () => {
    const { resolveReflexConfig } = await import('@/demos/registry');
    await writeReflexConfig(env, SCOPE, preContentConfig(), { actor: 'before-cw3' });
    const rev = await readReflexConfigRevision(env, SCOPE);
    expect(rev?.inherited).toContain('content_click');
    expect(rev?.config.weights.content_click).toBe(1);
    expect((await readReflexConfig(env, SCOPE)).weights.video_complete).toBe(2);
    expect((await readReflexConfigVersion(env, SCOPE, 1))?.config.weights.content_dwell).toBe(0.5);
    expect((await resolveReflexConfig(env, 'coach')).weights.content_click).toBe(1);
    // The STORED document is untouched: the fill is a read-time rule, not a rewrite.
    const key = [...kv.store.keys()].find((k) => k.includes('reflex') && k.includes('current'));
    const raw = JSON.parse(kv.store.get(key!) as string) as { value: ReflexConfig };
    expect(raw.value.weights.product_view).toBe(1);          // the stored document is real
    expect('content_click' in raw.value.weights).toBe(false); // and was not rewritten
  });

  it('a patch that switches an inherited weight off stores the zero, and the read honours it', async () => {
    await writeReflexConfig(env, SCOPE, preContentConfig(), { actor: 'before-cw3' });
    const r = await patchReflexConfig(env, SCOPE, { weights: { content_click: 0 } }, { actor: 'merch' });
    expect(r.ok).toBe(true);
    const rev = await readReflexConfigRevision(env, SCOPE);
    expect(rev?.config.weights.content_click).toBe(0);
    expect(rev?.inherited).not.toContain('content_click');
    expect(rev?.inherited).toContain('video_complete');
  });

  it('brighthour inherits from its own compiled default, not the engine’s', async () => {
    const { compiledDefaultFor } = await import('@/reflex/configStore');
    const bh = await compiledDefaultFor('brighthour');
    expect(bh).not.toBe(DEFAULT_REFLEX_CONFIG);
    expect(await compiledDefaultFor('coach')).toBe(DEFAULT_REFLEX_CONFIG);
    expect(await compiledDefaultFor('kate-spade')).toBe(DEFAULT_REFLEX_CONFIG);
  });
});

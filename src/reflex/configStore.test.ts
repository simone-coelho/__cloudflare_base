// Pure validation/merge assertions are retained. Mutable-KV/fallback oracles
// are superseded by explicit coherent R2 authority and authored-base mutations.
import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import type { Env } from '@/types/env';
import { DEFAULT_REFLEX_CONFIG, type ReflexConfig } from '@/reflex/core';
import { resolveTenantReflexConfig, resolveReflexConfig } from '@/demos/registry';
import { tenantMiddleware } from '@/tenancy/middleware';
import configRoutes from '@/routes/config';
import { initializePublicationSet, readPublication, type PublicationBaseline } from '@/config/publication';
import { REFLEX_KIND, reflexScopeForTenant, applyPatch, invalidateConfigCache, patchReflexConfig,
  readConfigIndex, readReflexConfig, readReflexConfigRevision, readReflexConfigVersion, rollbackReflexConfig,
  stampVersion, validateReflexConfig, writeReflexConfig } from '@/reflex/configStore';
function sampleConfig(over: Partial<ReflexConfig> = {}): ReflexConfig {
  return JSON.parse(JSON.stringify({ ...DEFAULT_REFLEX_CONFIG, version: 'tuned-v1', ...over }));
}
beforeEach(() => invalidateConfigCache());
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


describe('applyPatch pure invariants', () => {
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


});

class Authority {
  map = new Map<string, string>(); etags = new Map<string, string>(); reads = 0; puts = 0; fail = false;
  async get(key: string) { this.reads++; if (this.fail) throw new Error('Synthetic outage'); const raw = this.map.get(key);
    return raw === undefined ? null : { key, etag: this.etags.get(key), size: new TextEncoder().encode(raw).length, body: new Response(raw).body }; }
  async put(key: string, raw: string, options: R2PutOptions) { this.puts++; const cond = options.onlyIf;
    if (cond instanceof Headers ? this.map.has(key) : cond?.etagMatches !== this.etags.get(key)) return null;
    this.map.set(key, raw); this.etags.set(key, String(this.puts)); return { key, etag: String(this.puts), size: new TextEncoder().encode(raw).length }; }
}
async function fixture(entries: Array<[string, ReflexConfig]> = [['coach', sampleConfig()]]) {
  const storage = new Authority(), env = { STORAGE: storage, CACHE: { get() { throw new Error('Not config authority'); }, put() { throw new Error('Forbidden'); } } } as unknown as Env;
  const groups = new Map<string, PublicationBaseline[]>();
  for (const [scope, value] of entries) {
    const owner = scope === 'brighthour' ? 'coach' : scope.replace(/^tenant:/, '');
    const list = groups.get(owner) ?? []; list.push({ kind: REFLEX_KIND, scope, revision: { revision: 1, value, actor: 'initializer', note: '', at: 1 } }); groups.set(owner, list);
  }
  for (const group of groups.values()) await initializePublicationSet(env, group, '0:' + crypto.randomUUID());
  return { storage, env };
}
async function meta(env: Env, scope = 'coach', actor = 'writer') {
  const base = await readPublication(env, REFLEX_KIND, scope);
  return { actor, expectedRevision: base.revision, expectedPublication: base.publication, operationId: base.revision + ':' + crypto.randomUUID() };
}
describe('W11.02 strict Reflex authority and authored operator bases', () => {
  it('W11.02 refuses missing or failed authority for demos and tenants rather than substituting a default', async () => {
    const env = { CACHE: { get: async () => JSON.stringify({ config: DEFAULT_REFLEX_CONFIG }) } } as unknown as Env;
    for (const scope of ['coach', 'brighthour', 'meridian', 'tenant:brighthour']) await expect(readReflexConfig(env, scope)).rejects.toMatchObject({ status: 503 });
    const f = await fixture(); f.storage.fail = true;
    await expect(readReflexConfig(f.env, 'coach')).rejects.toMatchObject({ status: 503 });
    expect(f.storage.puts).toBeGreaterThan(0);
  });
  it('W11.02 preserves stamping attribution exact authored weights history and forward-only rollback', async () => {
    const f = await fixture(), base = await meta(f.env);
    const first = await writeReflexConfig(f.env, 'coach', sampleConfig({ K: 1.8 }), { ...base, actor: 'simone', note: 'first', nowMs: 20 });
    expect(first).toMatchObject({ ok: true, revision: { revision: 2, actor: 'simone', note: 'first', at: 20, config: { version: 'tuned-v1+r2', K: 1.8 } } });
    const second = await patchReflexConfig(f.env, 'coach', { K: 2.4 }, await meta(f.env));
    expect(second).toMatchObject({ ok: true, revision: { revision: 3, config: { version: 'tuned-v1+r3', K: 2.4 } } });
    expect(await patchReflexConfig(f.env, 'coach', { thetaOut: 0.99 }, await meta(f.env))).toMatchObject({ ok: false });
    expect((await readReflexConfigVersion(f.env, 'coach', 2))?.config.K).toBe(1.8);
    expect(await rollbackReflexConfig(f.env, 'coach', 2, await meta(f.env))).toMatchObject({ ok: true, revision: { revision: 4, config: { K: 1.8 } } });
    expect((await readConfigIndex(f.env, 'coach')).map(r => r.revision)).toEqual([4, 3, 2, 1]);
    await expect(writeReflexConfig(f.env, 'coach', sampleConfig(), base)).rejects.toMatchObject({ status: 409 });
  });
  it('W11.02 retains demo-only inheritance without rewriting authored bytes and isolates real BrightHour', async () => {
    const old = sampleConfig(); delete old.weights.content_click; delete old.weights.video_complete;
    const tenant = sampleConfig({ weights: { purchase: 4 }, dimensions: [{ key: 'taste', source: 'taste' }] });
    const f = await fixture([['coach', old], ['brighthour', sampleConfig({ K: 1.1 })], ['tenant:brighthour', tenant], ['meridian', tenant]]);
    const before = new Map(f.storage.map), revision = await readReflexConfigRevision(f.env, 'coach');
    expect(revision?.inherited).toContain('content_click'); expect(revision?.config.weights.content_click).toBe(1);
    expect(revision?.authored.weights).not.toHaveProperty('content_click');
    expect((await readReflexConfigVersion(f.env, 'coach', 1))?.config.weights.video_complete).toBe(2);
    expect((await resolveReflexConfig(f.env, 'coach')).weights.content_click).toBe(1);
    expect(f.storage.map).toEqual(before);
    expect((await resolveTenantReflexConfig(f.env, 'brighthour')).weights).toEqual({ purchase: 4 });
    expect((await resolveTenantReflexConfig(f.env, 'coach', 'brighthour')).K).toBe(1.1);
    expect(await patchReflexConfig(f.env, 'coach', { weights: { content_click: 0 } }, await meta(f.env))).toMatchObject({ ok: true });
    expect((await readReflexConfig(f.env, 'coach')).weights.content_click).toBe(0);
    expect(reflexScopeForTenant('brighthour')).toBe('tenant:brighthour');
  });
  it('W11.02 authenticates canonical typed scope before I/O and compares the loaded authored set on actual routes', async () => {
    const f = await fixture([['coach', sampleConfig()], ['brighthour', sampleConfig({ K: 2 })], ['tenant:brighthour', sampleConfig({ K: 3 })]]);
    Object.assign(f.env, { JWT_SECRET: 'synthetic-w1102-config-only-signing-material', JWT_ISSUER: 'i', JWT_AUDIENCE: 'a',
      TENANTS: JSON.stringify({ provisioned: ['coach', 'brighthour'], operatorGrants: { ops: ['coach', 'brighthour'] } }) });
    const app = new Hono(); app.use('*', tenantMiddleware()); app.route('/config', configRoutes);
    const token = await new SignJWT({ sub: 'ops', type: 'service' }).setProtectedHeader({ alg: 'HS256' }).setIssuer('i').setAudience('a').setExpirationTime('5m').sign(new TextEncoder().encode(f.env.JWT_SECRET));
    const call = (query: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) => app.request('https://synthetic.invalid/config/reflex' + query,
      { method, headers: { Authorization: 'Bearer ' + token, 'X-Tenant': 'coach', 'content-type': 'application/json', ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, f.env);
    for (const query of ['?scope=coach&scope=coach', '?tenant=brighthour', '?scope=tenant:brighthour', '?scope=bad%2Fscope']) {
      const reads = f.storage.reads; expect((await call(query)).status).toBeGreaterThanOrEqual(400); expect(f.storage.reads).toBe(reads);
    }
    const loaded = await (await call('?scope=coach')).json() as { revision: number; publication: { revision: number; digest: string }; authored: ReflexConfig };
    const headers = { 'If-Match': '"' + loaded.revision + '/' + loaded.publication.revision + '/' + loaded.publication.digest + '"', 'Idempotency-Key': loaded.revision + ':' + crypto.randomUUID() };
    expect((await call('?scope=coach', 'PATCH', { patch: { K: 5 } })).status).toBe(428);
    expect((await call('?scope=coach', 'PATCH', { patch: { K: 5 } }, headers)).status).toBe(200);
    expect((await call('?scope=coach', 'PATCH', { patch: { K: 6 } }, headers)).status).toBe(409);
    expect((await call('?scope=brighthour')).status).toBe(200);
    expect((await call('?scope=tenant:brighthour', 'GET', undefined, { 'X-Tenant': 'brighthour' })).status).toBe(200);
  });
});

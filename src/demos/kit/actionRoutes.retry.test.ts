// src/demos/kit/actionRoutes.retry.test.ts — lane E3: a beat that meets another
// publish on the demo tenant's publication set waits, reads the base again and
// publishes on it, a bounded number of times, instead of answering 502 for a
// conflict that resolves in a moment.
//
// Two layers. The first holds the route to its policy with a stand-in pipeline
// and a fake clock: which refusal is retried, how often, after how long, on
// which base, and that every other refusal answers at once. The second runs the
// route through the REAL content routes onto the REAL publication engine (an
// in-memory R2 whose conditional writes compare etags), and stages the other
// publish where the hosted beat 12 met it: between the beat's read and its
// write, or holding the set's head while it finishes. It also states the ruling
// on the lift snapshot: the learning alarm's archive and KV writes are not a
// publication, and a beat never conflicts with them.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '@/types/env';
import { tenantMiddleware } from '@/tenancy/middleware';
import { contentRoutes } from '@/routes/content';
import { initializePublicationSet, invalidatePublicationCache, readPublication, type PublicationBaseline } from '@/config/publication';
import { write, type DocumentKind } from '@/config/versionedStore';
import { CONTENT_KIND, EMPTY_CATALOG, SLOTS_KIND, DEFAULT_SLOTS, LEARN_KIND, DEFAULT_LEARN } from '@/content/kinds';
import { REFLEX_KIND, reflexScopeForTenant } from '@/reflex/configStore';
import { DEFAULT_REFLEX_CONFIG } from '@/reflex/core';
import { CONFLICT_RETRY_MS, demoActionRoutes, type DemoActionConfig } from './actionRoutes';

const SECRET = 'e3-demo-kit-retry-test-secret-long-enough';
const ISSUER = 'edge-platform', AUDIENCE = 'edge-platform-api';
const ctx = { waitUntil: () => undefined, passThroughOnException: () => undefined } as unknown as ExecutionContext;
const CONFLICT_MESSAGE = 'Publication conflicts with the retained operation or authored revision set';

/** A fictional demo on its own tenant: the route is the kit's, not OH's. */
const WREN: DemoActionConfig = {
  tenant: 'wren',
  operator: 'wren-demo',
  beats: { 'open-catalog': 'catalog', 'open-slots': 'slots', '05-window-closes': 'catalog', '06-pin-launch': 'slots' },
  reset: ['open-slots', 'open-catalog'],
  reportSlots: new Set(['deals']),
  asserted: new Set(['replace']),
  beatsPath: '/wren/beats',
  seedScript: 'scripts/seed-wren.mjs',
};

const catalogOf = (id: string) => ({ version: `catalog-${id}`, pieces: [{ id, customerContentId: `CMS-${id}`, type: 'editorial', title: id,
  tags: { line: ['Wren'] }, slotTypes: ['story'], lifecycle: { status: 'live' as const } }] });
const slotsOf = (version: string) => ({ ...DEFAULT_SLOTS, version });
/** Each beat's document, as the worker's own static asset holds it. */
const DOCUMENTS: Record<string, Record<string, unknown>> = {
  'open-catalog': catalogOf('opening'), '05-window-closes': catalogOf('closed-window'),
  'open-slots': slotsOf('slots-opening'), '06-pin-launch': slotsOf('slots-pinned-launch'),
};
const assets = (config: DemoActionConfig) => ({
  fetch: async (request: Request) => {
    const path = new URL(request.url).pathname, prefix = `${config.beatsPath}/`;
    const name = path.startsWith(prefix) && path.endsWith('.json') ? path.slice(prefix.length, -'.json'.length) : '';
    if (!Object.hasOwn(config.beats, name)) return new Response('Not Found', { status: 404 });
    return Response.json({ name, kind: 'publish', publish: { kind: config.beats[name], document: DOCUMENTS[name] } });
  },
});

// ── Layer 1: the policy, with a stand-in pipeline and a fake clock ────────────

type Call = { at: number; method: string; path: string; headers: Headers; body: unknown };
const BASES = [7, 8, 9, 10, 11].map((revision, i) => ({ revision, publication: { revision: 3 + i, digest: String(i).repeat(64) } }));

/** A pipeline whose n-th write answers `writes[n]` (the last one repeats); each read answers the next base. */
function policyRig(writes: Array<{ status: number; body: Record<string, unknown> }>) {
  const calls: Call[] = [];
  let reads = 0, puts = 0;
  const dispatch = async (request: Request) => {
    const body = request.method === 'PUT' ? await request.json() : undefined;
    calls.push({ at: Date.now(), method: request.method, path: new URL(request.url).pathname, headers: request.headers, body });
    if (request.method === 'GET') return Response.json({ ok: true, ...BASES[Math.min(reads++, BASES.length - 1)] });
    const answer = writes[Math.min(puts++, writes.length - 1)]!;
    return Response.json(answer.body, { status: answer.status });
  };
  const env = { DEPLOYMENT_PROFILE: 'demo', JWT_SECRET: SECRET, JWT_ISSUER: ISSUER, JWT_AUDIENCE: AUDIENCE,
    TENANTS: JSON.stringify({ provisioned: [WREN.tenant] }), ASSETS: assets(WREN) };
  const app = demoActionRoutes({ ...WREN, dispatch: dispatch as never });
  const post = (path: string, body: unknown) => app.request(`https://demo.example${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }, env, ctx);
  return { calls, post };
}
const CONFLICT = { status: 409, body: { ok: false, error: CONFLICT_MESSAGE, code: 'publication_conflict' } };
const LANDED = (revision: number) => ({ status: 200, body: { ok: true, revision } });

/** Runs a press to its answer on the fake clock, returning the answer and how long it took. */
async function settle(pressed: Response | Promise<Response>) {
  const started = Date.now(), answer = Promise.resolve(pressed);
  let done = false;
  void answer.finally(() => { done = true; });
  for (let i = 0; i < 200 && !done; i++) await vi.advanceTimersByTimeAsync(50);
  const res = await answer;
  return { res, body: await res.json() as Record<string, unknown>, took: Date.now() - started };
}

describe('E3 a beat that meets another publish on the set (the policy)', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout', 'Date'] }); vi.spyOn(console, 'warn').mockImplementation(() => undefined); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('retries three times at most, about two seconds in all', () => {
    expect(CONFLICT_RETRY_MS).toEqual([250, 600, 1150]);
    expect(CONFLICT_RETRY_MS.reduce((a, b) => a + b, 0)).toBe(2000);
    expect(Object.isFrozen(CONFLICT_RETRY_MS)).toBe(true);
  });

  it('waits, reads the base that is current, and publishes the worker’s own document on it with a fresh operation', async () => {
    const r = policyRig([CONFLICT, LANDED(9)]);
    const { res, body, took } = await settle(r.post('/beat', { name: '06-pin-launch', note: 'pin', document: { version: 'smuggled' } }));
    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, name: '06-pin-launch', kind: 'slots', revision: 9, retried: 1 });
    expect(r.calls.map((c) => `${c.method} ${c.path}`)).toEqual(['GET /content/slots', 'PUT /content/slots', 'GET /content/slots', 'PUT /content/slots']);
    // The second write is conditional on the SECOND read, never on the base the conflict refused.
    const [first, second] = r.calls.filter((c) => c.method === 'PUT');
    expect(first!.headers.get('If-Match')).toBe(`"7/3/${'0'.repeat(64)}"`);
    expect(second!.headers.get('If-Match')).toBe(`"8/4/${'1'.repeat(64)}"`);
    expect(second!.headers.get('Idempotency-Key')).toMatch(/^8:[0-9a-f-]{36}$/);
    expect(second!.headers.get('Idempotency-Key')).not.toBe(first!.headers.get('Idempotency-Key'));
    // The same document both times: the worker's own, never the request's.
    for (const put of [first, second]) expect(put!.body).toEqual({ document: DOCUMENTS['06-pin-launch'], note: 'pin' });
    // It read again only after the first wait.
    expect(r.calls[2]!.at - r.calls[1]!.at).toBeGreaterThanOrEqual(CONFLICT_RETRY_MS[0]!);
    expect(took).toBeLessThan(CONFLICT_RETRY_MS[0]! + 100);
  });

  it('answers 502 with the engine’s refusal after the third retry, having waited about two seconds', async () => {
    const r = policyRig([CONFLICT]);
    const { res, body, took } = await settle(r.post('/beat', { name: '05-window-closes' }));
    expect(res.status).toBe(502);
    expect(body).toEqual({ ok: false, name: '05-window-closes', stage: 'write', status: 409, error: CONFLICT_MESSAGE,
      code: 'publication_conflict', retried: 3 });
    expect(r.calls.map((c) => c.method)).toEqual(['GET', 'PUT', 'GET', 'PUT', 'GET', 'PUT', 'GET', 'PUT']);
    // Each read again comes after its wait, in the schedule's order (the fake clock steps 50 ms at a time).
    const reads = r.calls.filter((c) => c.method === 'GET').map((c) => c.at);
    reads.slice(1).forEach((at, i) => {
      expect(at - reads[i]!, `wait ${i + 1}`).toBeGreaterThanOrEqual(CONFLICT_RETRY_MS[i]!);
      expect(at - reads[i]!, `wait ${i + 1}`).toBeLessThan(CONFLICT_RETRY_MS[i]! + 100);
    });
    expect(took).toBeGreaterThanOrEqual(2000);
    expect(took).toBeLessThan(2200);
  });

  it('answers every other refusal at once, with one read and one write', async () => {
    const others = [
      { status: 422, body: { ok: false, errors: ['pages.home: unknown slot'] } },
      { status: 403, body: { ok: false, error: 'Current operator authority required', code: 'operator_required' } },
      { status: 503, body: { ok: false, error: 'Configuration publication authority unavailable', code: 'publication_unavailable' } },
      { status: 428, body: { ok: false, error: 'Authored document/set If-Match and Idempotency-Key required', code: 'precondition_required' } },
      // A 409 that is not the publication conflict, and a 409 that names no code: neither is the refusal a wait resolves.
      { status: 409, body: { ok: false, error: 'History predates the explicitly retained baseline', code: 'legacy_history_unavailable' } },
      { status: 409, body: { ok: false, error: 'conflict' } },
      // The conflict's code on another status is not the engine's conflict either.
      { status: 503, body: { ok: false, error: CONFLICT_MESSAGE, code: 'publication_conflict' } },
    ];
    for (const refusal of others) {
      const r = policyRig([refusal]);
      const { res, body, took } = await settle(r.post('/beat', { name: '06-pin-launch' }));
      const label = `${refusal.status} ${String(refusal.body.code)}`;
      expect(res.status, label).toBe(502);
      expect(body, label).not.toHaveProperty('retried');
      expect(body, label).toMatchObject({ ok: false, name: '06-pin-launch', stage: 'write', status: refusal.status });
      expect(r.calls.map((c) => c.method), label).toEqual(['GET', 'PUT']);
      expect(took, label).toBeLessThan(CONFLICT_RETRY_MS[0]!);
    }
  });

  it('a first-time publish answers exactly as before, with no retry field', async () => {
    const r = policyRig([LANDED(8)]);
    const { res, body } = await settle(r.post('/beat', { name: '06-pin-launch' }));
    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, name: '06-pin-launch', kind: 'slots', revision: 8 });
    expect(r.calls).toHaveLength(2);
  });

  it('a reset retries each of its beats on its own and still answers in its order', async () => {
    const r = policyRig([CONFLICT, LANDED(8), LANDED(9)]);
    const { res, body } = await settle(r.post('/reset', {}));
    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, applied: [
      { ok: true, name: 'open-slots', kind: 'slots', revision: 8, retried: 1 },
      { ok: true, name: 'open-catalog', kind: 'catalog', revision: 9 },
    ] });
    expect(r.calls.map((c) => `${c.method} ${c.path}`)).toEqual(['GET /content/slots', 'PUT /content/slots', 'GET /content/slots', 'PUT /content/slots',
      'GET /content/catalog', 'PUT /content/catalog']);
  });
});

// ── Layer 2: the real content routes on the real publication engine ───────────

/** R2 as the engine uses it: conditional writes compare a per-write etag; a gate can hold chosen writes. */
class GatedR2 {
  objects = new Map<string, string>(); etags = new Map<string, string>(); puts = 0;
  private held: Array<{ match: (key: string) => boolean; open: Promise<void> }> = [];
  /** Holds every write whose key matches until the returned function is called. */
  hold(match: (key: string) => boolean): () => void {
    let release!: () => void;
    const open = new Promise<void>((done) => { release = done; });
    this.held.push({ match, open });
    return () => { release(); };
  }
  async get(key: string) {
    const raw = this.objects.get(key); if (raw === undefined) return null;
    return { key, etag: this.etags.get(key)!, size: new TextEncoder().encode(raw).length, body: new Response(raw).body };
  }
  async put(key: string, raw: string, options: R2PutOptions) {
    for (const gate of this.held) if (gate.match(key)) await gate.open;
    const attempt = ++this.puts, condition = options.onlyIf, exists = this.objects.has(key);
    if (condition instanceof Headers ? exists : !exists || (condition as { etagMatches?: string } | undefined)?.etagMatches !== this.etags.get(key)) return null;
    this.objects.set(key, raw); this.etags.set(key, `etag-${attempt}`);
    return { key, etag: this.etags.get(key), size: new TextEncoder().encode(raw).length };
  }
}
class MemoryKV {
  store = new Map<string, string>();
  async get(key: string) { const raw = this.store.get(key); return raw === undefined ? null : JSON.parse(raw); }
  async put(key: string, value: string) { this.store.set(key, value); }
}
const HEAD = (tenant: string) => `config-publication/v2/${tenant}/head.json`;
const headOf = (storage: GatedR2, tenant: string) => JSON.parse(storage.objects.get(HEAD(tenant))!) as
  { committed: { revision: number } | null; pending: { set: { operation: { actor: string } } } | null };

/** The demo tenant as the bootstrap leaves it, the kit's routes in front of the real /content routes, and a second writer beside them. */
async function engineRig(config: DemoActionConfig = WREN) {
  invalidatePublicationCache();
  const storage = new GatedR2(), kv = new MemoryKV();
  const env = {
    DEPLOYMENT_PROFILE: 'demo', JWT_SECRET: SECRET, JWT_ISSUER: ISSUER, JWT_AUDIENCE: AUDIENCE,
    TENANTS: JSON.stringify({ provisioned: [config.tenant], operatorGrants: { [config.operator]: [config.tenant] } }),
    STORAGE: storage, CACHE: kv, ASSETS: assets(config),
  } as unknown as Env;
  const rows: Array<[DocumentKind<unknown>, string, unknown]> = [
    [REFLEX_KIND as DocumentKind<unknown>, reflexScopeForTenant(config.tenant), DEFAULT_REFLEX_CONFIG],
    [CONTENT_KIND as DocumentKind<unknown>, config.tenant, EMPTY_CATALOG],
    [SLOTS_KIND as DocumentKind<unknown>, config.tenant, DEFAULT_SLOTS],
    [LEARN_KIND as DocumentKind<unknown>, config.tenant, DEFAULT_LEARN],
  ];
  await initializePublicationSet(env, rows.map(([kind, scope, value]): PublicationBaseline =>
    ({ kind, scope, revision: { revision: 1, value, actor: 'demo-bootstrap', note: '', at: 1 } })), '0:' + crypto.randomUUID());
  const pipeline = new Hono<{ Bindings: Env }>();
  pipeline.use('*', tenantMiddleware());
  pipeline.route('/content', contentRoutes);
  /** Every call the beat route makes goes through `before` first, so a test can put another publish exactly there. */
  let before: (request: Request) => Promise<void> = async () => undefined;
  const calls: string[] = [];
  const dispatch = async (request: Request, e: Env, c: ExecutionContext) => {
    await before(request);
    const res = await pipeline.fetch(request, e, c);
    calls.push(`${request.method} ${new URL(request.url).pathname} ${res.status}`);
    return res;
  };
  const app = demoActionRoutes({ ...config, dispatch });
  const post = (path: string, body: unknown) => app.request(`https://demo.example${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }, env, ctx);
  /** Another operator's publish on the same set, through the engine, against the base current now. */
  const otherPublish = async (document: unknown, kind = CONTENT_KIND as DocumentKind<unknown>) => {
    const base = await readPublication(env, kind, config.tenant);
    return write(env, kind, config.tenant, document, { actor: 'another-operator', note: 'meanwhile',
      expectedRevision: base.revision, expectedPublication: base.publication!, operationId: `${base.revision}:${crypto.randomUUID()}` });
  };
  const current = async (kind: DocumentKind<unknown>) => (await readPublication(env, kind, config.tenant));
  return { env, storage, kv, calls, post, otherPublish, current, setBefore: (fn: typeof before) => { before = fn; } };
}

describe('E3 through the real content routes and publication engine', () => {
  beforeEach(() => { vi.spyOn(console, 'warn').mockImplementation(() => undefined); });
  afterEach(() => { vi.restoreAllMocks(); invalidatePublicationCache(); });

  it('a beat alone publishes on its first try (the control)', async () => {
    const r = await engineRig();
    const res = await r.post('/beat', { name: '06-pin-launch' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, name: '06-pin-launch', kind: 'slots', revision: 2 });
    expect(r.calls).toEqual(['GET /content/slots 200', 'PUT /content/slots 200']);
    expect((await r.current(SLOTS_KIND as DocumentKind<unknown>)).value).toMatchObject({ version: 'slots-pinned-launch+r2' });
  });

  it('another publish between the beat’s read and its write: the engine refuses with 409, and the beat lands on the base after it', async () => {
    const r = await engineRig();
    let interleaved = false;
    r.setBefore(async (request) => {
      // The hosted beat 12 shape: the beat publishes slots, another writer publishes the CATALOG on the same set first.
      if (request.method === 'PUT' && !interleaved) { interleaved = true; expect((await r.otherPublish(catalogOf('meanwhile'))).ok).toBe(true); }
    });
    const res = await r.post('/beat', { name: '06-pin-launch' });
    expect(r.calls).toEqual(['GET /content/slots 200', 'PUT /content/slots 409', 'GET /content/slots 200', 'PUT /content/slots 200']);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, name: '06-pin-launch', kind: 'slots', revision: 2, retried: 1 });
    // Both intents stand: the other writer's catalog was not overwritten, and the beat's slots are in force.
    expect((await r.current(CONTENT_KIND as DocumentKind<unknown>)).value).toMatchObject({ version: 'catalog-meanwhile+r2' });
    const slots = await r.current(SLOTS_KIND as DocumentKind<unknown>);
    expect(slots.value).toMatchObject({ version: 'slots-pinned-launch+r2' });
    expect(slots.publication!.revision).toBe(3);   // bootstrap 1, the other catalog 2, the beat 3
    expect(slots.actor).toBe('wren-demo');
  });

  it('another publish holding the set while it finishes: the beat waits for it, then lands', async () => {
    const r = await engineRig();
    // The other publish reserves the head, then its revision write is held: the set is pending under its operation.
    const release = r.storage.hold((key) => key.startsWith(`config-publication/v1/${WREN.tenant}/content/rev/`));
    const other = r.otherPublish(catalogOf('slow-writer'));
    for (let i = 0; i < 100 && !headOf(r.storage, WREN.tenant).pending; i++) await new Promise((done) => setTimeout(done, 5));
    expect(headOf(r.storage, WREN.tenant).pending?.set.operation.actor).toBe('another-operator');
    setTimeout(release, CONFLICT_RETRY_MS[0]! + 300);   // it finishes between the first and second retries
    const res = await r.post('/beat', { name: '06-pin-launch' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, name: '06-pin-launch', kind: 'slots', revision: 2, retried: 2 });
    expect((await other).ok).toBe(true);
    expect(r.calls.filter((c) => c.startsWith('PUT')).map((c) => c.split(' ')[2])).toEqual(['409', '409', '200']);
    expect((await r.current(CONTENT_KIND as DocumentKind<unknown>)).value).toMatchObject({ version: 'catalog-slow-writer+r2' });
    expect((await r.current(SLOTS_KIND as DocumentKind<unknown>)).value).toMatchObject({ version: 'slots-pinned-launch+r2' });
  });

  it('a set held past the retries answers 502 with the engine’s message, and the beat forces nothing', async () => {
    const r = await engineRig();
    const release = r.storage.hold((key) => key.startsWith(`config-publication/v1/${WREN.tenant}/content/rev/`));
    const other = r.otherPublish(catalogOf('stuck-writer'));
    for (let i = 0; i < 100 && !headOf(r.storage, WREN.tenant).pending; i++) await new Promise((done) => setTimeout(done, 5));
    const started = Date.now();
    const res = await r.post('/beat', { name: '06-pin-launch' });
    expect(Date.now() - started).toBeGreaterThanOrEqual(1950);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ ok: false, name: '06-pin-launch', stage: 'write', status: 409, error: CONFLICT_MESSAGE,
      code: 'publication_conflict', retried: 3 });
    // The other operation still holds the set: nothing was overwritten or recovered on its behalf.
    expect(headOf(r.storage, WREN.tenant).pending?.set.operation.actor).toBe('another-operator');
    expect(headOf(r.storage, WREN.tenant).committed?.revision).toBe(1);
    release();
    expect((await other).ok).toBe(true);
    expect((await r.current(SLOTS_KIND as DocumentKind<unknown>)).value).toMatchObject({ version: 'slots-default' });
  }, 10_000);

  it('the learning alarm’s lift snapshot is not a publication: its archive and KV writes between a read and a write never conflict', async () => {
    const r = await engineRig();
    let interleaved = false;
    r.setBefore(async (request) => {
      if (request.method !== 'PUT' || interleaved) return;
      interleaved = true;
      // What LearnStats.publish writes when its alarm publishes a lift snapshot (src/learn/fan.ts liftArchiveKey, liftKey).
      const snapshot = JSON.stringify({ version: 7, items: {} });
      expect(await r.storage.put(`lift/${WREN.tenant}/${WREN.tenant}/deals/7.json`, snapshot, { onlyIf: new Headers({ 'If-None-Match': '*' }) })).not.toBeNull();
      await r.kv.put(`lift:${WREN.tenant}:${WREN.tenant}:deals`, snapshot);
    });
    const res = await r.post('/beat', { name: '05-window-closes' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, name: '05-window-closes', kind: 'catalog', revision: 2 });
    expect(r.calls).toEqual(['GET /content/catalog 200', 'PUT /content/catalog 200']);
  });

  it('two presses at once both land, one after the other', async () => {
    const r = await engineRig();
    const [a, b] = await Promise.all([r.post('/beat', { name: '06-pin-launch' }), r.post('/beat', { name: '05-window-closes' })]);
    const answers = [await a.json(), await b.json()] as Array<Record<string, unknown>>;
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(answers.map((x) => x.ok)).toEqual([true, true]);
    expect((await r.current(SLOTS_KIND as DocumentKind<unknown>)).value).toMatchObject({ version: 'slots-pinned-launch+r2' });
    expect((await r.current(CONTENT_KIND as DocumentKind<unknown>)).value).toMatchObject({ version: 'catalog-closed-window+r2' });
    expect((await r.current(CONTENT_KIND as DocumentKind<unknown>)).publication!.revision).toBe(3);
  });
});

// src/routes/oh.test.ts — the OH demo's live sign-in (lane P3, beat 15).
//
// The route is a site backend for a closed list of fictional accounts: absent
// off the demo profile, a name from OH_ACCOUNTS and nothing else, the caller's
// own browser only, the assertion minted in the worker with IDENTITY_SECRETS and
// spent on the ordinary link route in process, and an answer that carries
// success, the linked flag and her new session, never the secret or the proof.
// The last block runs the real identity link (src/routes/identity.ts) and the
// real shopper objects on the session host, as src/routes/identity.test.ts does,
// and shows the engine's contract through this route: a laptop and a phone sign
// in to the same account, and the person is the sum of both. R4's two rulings are
// here too: the account is a fresh person on every showing (its id carries the reset
// generation), and a session its own sign-in retired signs in no more.
import { describe, expect, it, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '@/types/env';
import type { TenantVariables } from '@/tenancy/tenant';
import { issueSessionCapability, SHOPPER_HEADER } from '@/identity/sessionCapability';
import { signAssertion, verifyAssertion } from '@/identity/assertion';
import { shopperIdFor } from '@/identity/shopperId';
import { identityRoutes } from '@/routes/identity';
import { SessionManager } from '@/services/SessionManager';
import { ShopperReflex } from '@/durable-objects/ShopperReflex';
import { DecisionRing } from '@/durable-objects/DecisionRing';
import { PersonalizationWebSocket } from '@/durable-objects/PersonalizationWebSocket';
import { shopperObjectName } from '@/tenancy/objects';
import { tenantMiddleware } from '@/tenancy/middleware';
import { DEFAULT_REFLEX_CONFIG, snapshot, type ReflexState } from '@/reflex/core';
import { initializePublicationSet, readPublication, type PublicationBaseline } from '@/config/publication';
import { write } from '@/config/versionedStore';
import { reflexScopeForTenant, REFLEX_KIND } from '@/reflex/configStore';
import { CONTENT_KIND, SLOTS_KIND, LEARN_KIND } from '@/content/kinds';
import type { RetentionCategory } from '@/retention';
import { OH_ACCOUNTS, OH_BEATS, RESET_NOTE, SIGN_IN_ASSERTION_TTL_SECONDS, linkedAccountId, ohAccountId, ohRoutes, ohSignInRoutes, resetGeneration } from './oh';

const JWT = 'p3-synthetic-route-signing-material-0123456789';
const SECRET = 'p3-Synthetic-OH-Identity-Material-0123456789abcdef';
const ACCOUNT = OH_ACCOUNTS[0]!;
const LAPTOP = 'vis-00000000-0000-4000-8000-0000000000a1';
const PHONE = 'vis-00000000-0000-4000-8000-0000000000b2';
const tick = () => undefined;
const ctx = { waitUntil: tick, passThroughOnException: tick } as unknown as ExecutionContext;

const fixturePolicy = { id: 'p3-oh-sign-in-fixture', revision: 1, durationMs: 365 * 86400_000, basis: 'admitted' as const, renewal: 'new-record-only' as const };
const RETENTION = JSON.stringify({ version: 1, tenants: { oh: Object.fromEntries((['profile', 'identity', 'ledger', 'online', 'hourly', 'recovery', 'quarantine'] as RetentionCategory[]).map((c) => [c, fixturePolicy])) } });

/** The env every block shares: the demo profile, OH provisioned, a signing key and the tenant's identity secret. */
const baseEnv = (over: Record<string, unknown> = {}) => ({
  DEPLOYMENT_PROFILE: 'demo', ENVIRONMENT: 'test', CONNECTOR_MODE: 'mock',
  JWT_SECRET: JWT, JWT_ISSUER: 'edge-platform', JWT_AUDIENCE: 'edge-platform-api',
  TENANTS: JSON.stringify({ provisioned: ['oh'] }), RETENTION, IDENTITY_SECRETS: `oh:${SECRET}`,
  ...over,
}) as unknown as Env;

const session = (env: Env, subject = LAPTOP, tenant = 'oh', kind: 'anonymous' | 'recognized' = 'anonymous', sessionId = 's-laptop') =>
  issueSessionCapability(env, { tenant, subject, sessionId, kind });

// ── The route on its own: the ordinary link route stood in for by a recorder ──
/** The link route's own answer shape for a signed link (src/routes/identity.ts), with a cookie, unless a test supplies its own. */
const linkReply = async (request: Request) => {
  const body = await request.clone().json() as { visitorId: string };
  return Response.json({
    ok: true, tenant: 'oh', shopperId: 'sh_' + 'a'.repeat(32), visitorId: body.visitorId, outcome: 'linked', assurance: 'signed',
    salted: true, audiences: ['oh-private-audience'], changes: { entered: [], exited: [] }, carry: 'sh_' + 'a'.repeat(32),
    session: { capability: 'ss1.recognized.capability', tenant: 'oh', subject: 'sh_' + 'a'.repeat(32), sessionId: 's-person', kind: 'recognized', iat: 1, exp: 2 },
  }, { headers: { 'Set-Cookie': 'opt_session_id=s-person; Path=/; HttpOnly' } });
};

/**
 * Her own object as the route asks it (the identity export door, with her capability): it answers to a live
 * session, and refuses one its own sign-in retired, as the real object does (src/durable-objects/ShopperReflex.ts).
 */
const objectStub = (retired = false) => ({ idFromName: (n: string) => n,
  get: () => ({ fetch: async () => (retired ? Response.json({ ok: false, error: 'Shopper session unavailable' }, { status: 401 }) : Response.json({ ok: true })) }) });

function rig(options: { profile?: string; env?: Record<string, unknown>; reply?: (request: Request) => Response | Promise<Response>; retired?: boolean; storage?: boolean } = {}) {
  const calls: Array<{ method: string; url: string; headers: Headers; body: Record<string, unknown> }> = [];
  const dispatch = async (request: Request) => {
    calls.push({ method: request.method, url: request.url, headers: request.headers, body: await request.clone().json() as Record<string, unknown> });
    return (options.reply ?? linkReply)(request);
  };
  // R4's rulings add two reads: the reset generation, off the configuration publication, and her own object.
  const env = baseEnv({ DEPLOYMENT_PROFILE: options.profile ?? 'demo', ...(options.storage === false ? {} : { STORAGE: new FakeR2() }),
    SHOPPER_REFLEX: objectStub(options.retired), ...(options.env ?? {}) });
  const ready = options.storage === false ? Promise.resolve() : publishBaseline(env);
  const app = ohRoutes(dispatch as never);
  const post = async (path: string, body: unknown, headers: Record<string, string> = {}) => {
    await ready;
    return app.request(`https://demo.example/${path.replace(/^\//, '')}`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'X-Tenant': 'oh', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body),
    }, env, ctx);
  };
  return { app, env, calls, post };
}

describe('the OH sign-in route', () => {
  it('is absent off the demo profile, before any session is looked at', async () => {
    for (const profile of ['customer', '', 'staging']) {
      const { post, calls, env } = rig({ profile });
      const res = await post('/sign-in', { account: ACCOUNT }, { [SHOPPER_HEADER]: (await session(env)).capability });
      expect(res.status, profile).toBe(404);
      expect(calls).toHaveLength(0);
    }
  });

  it('refuses any name that is not on the closed list, and any body but { account }', async () => {
    const { post, calls, env } = rig();
    const cap = { [SHOPPER_HEADER]: (await session(env)).capability };
    for (const account of ['dana whitfield', ' Dana Whitfield', 'Dana', 'constructor', '__proto__', 'toString', 'hasOwnProperty', '', 'oh-demo-dana-whitfield']) {
      const res = await post('/sign-in', { account }, cap);
      expect(res.status, account).toBe(400);
      expect(((await res.json()) as { ok: boolean }).ok).toBe(false);
    }
    for (const body of [{}, { account: ACCOUNT, accountId: 'acct-1' }, { account: ACCOUNT, visitorId: LAPTOP }, { name: ACCOUNT }, [ACCOUNT], ACCOUNT, { account: ['Dana Whitfield'] }]) {
      const res = await post('/sign-in', body, cap);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    expect(calls).toHaveLength(0);
  });

  it('signs in only the caller’s own browser, on the demo’s own tenant', async () => {
    const { post, calls, env } = rig({ env: { TENANTS: JSON.stringify({ provisioned: ['oh', 'vantage'] }) } });
    expect((await post('/sign-in', { account: ACCOUNT })).status).toBe(401);                                          // no session
    expect((await post('/sign-in', { account: ACCOUNT }, { [SHOPPER_HEADER]: 'ss1.forged.capability' })).status).toBe(401);
    const other = await session(env, LAPTOP, 'vantage');
    expect((await post('/sign-in', { account: ACCOUNT }, { [SHOPPER_HEADER]: other.capability, 'X-Tenant': 'vantage' })).status).toBe(404);
    // A browser that already carries a person is refused before anything is minted, as the link route refuses it.
    const person = await session(env, 'sh_' + 'b'.repeat(32), 'oh', 'recognized', 's-person');
    const signedIn = await post('/sign-in', { account: ACCOUNT }, { [SHOPPER_HEADER]: person.capability });
    expect(signedIn.status).toBe(409);
    expect(calls).toHaveLength(0);
  });

  it('mints the assertion in the worker for her own visitor, and spends it only on the ordinary link route', async () => {
    const { post, calls, env } = rig();
    const cap = await session(env);
    const before = Math.floor(Date.now() / 1000);
    const res = await post('/sign-in', { account: ACCOUNT }, { [SHOPPER_HEADER]: cap.capability, 'X-SDK-Key': 'demo-site', Cookie: 'opt_tracking_consent=true' });
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    const [link] = calls;
    expect(link.method).toBe('POST');
    expect(link.url).toBe('https://demo.example/v1/oh/identity/link');
    expect(link.headers.get(SHOPPER_HEADER)).toBe(cap.capability);
    expect(link.headers.get('X-Tenant')).toBe('oh');
    expect(link.headers.get('X-SDK-Key')).toBe('demo-site');
    expect(link.headers.get('Cookie')).toBe('opt_tracking_consent=true');
    expect(Object.keys(link.body).sort()).toEqual(['accountId', 'assertion', 'exp', 'source', 'visitorId']);
    // No reset on record in this rig: the generation is 0 (the id rule, R4 F3).
    expect(link.body).toMatchObject({ visitorId: LAPTOP, accountId: linkedAccountId(ACCOUNT, 0), source: 'login' });
    const exp = link.body.exp as number;
    expect(exp - before).toBeGreaterThanOrEqual(SIGN_IN_ASSERTION_TTL_SECONDS - 1);
    expect(exp - before).toBeLessThanOrEqual(SIGN_IN_ASSERTION_TTL_SECONDS + 1);
    // The proof is the identity code's own: it verifies for exactly this visitor and account, and for nothing else.
    expect(link.body.assertion).toBe(await signAssertion(SECRET, 'oh', LAPTOP, linkedAccountId(ACCOUNT, 0), exp));
    expect(await verifyAssertion(env, 'oh', { visitorId: LAPTOP, accountId: linkedAccountId(ACCOUNT, 0), exp, assertion: link.body.assertion as string })).toEqual({ ok: true, assurance: 'signed' });
    expect((await verifyAssertion(env, 'oh', { visitorId: PHONE, accountId: linkedAccountId(ACCOUNT, 0), exp, assertion: link.body.assertion as string })).ok).toBe(false);
  });

  it('answers success, the linked flag and her new session, and never the secret, the proof or the account', async () => {
    const { post, calls, env } = rig();
    const res = await post('/sign-in', { account: ACCOUNT }, { [SHOPPER_HEADER]: (await session(env)).capability });
    const text = await res.text();
    const body = JSON.parse(text) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['linked', 'ok', 'session']);
    expect(body).toMatchObject({ ok: true, linked: true, session: { kind: 'recognized', capability: 'ss1.recognized.capability' } });
    const assertion = calls[0].body.assertion as string;
    for (const hidden of [SECRET, assertion, ohAccountId(ACCOUNT), 'oh-private-audience', 'assurance', 'carry']) expect(text).not.toContain(hidden);
    for (const [name, value] of res.headers) {
      expect(value, name).not.toContain(SECRET);
      expect(value, name).not.toContain(assertion);
    }
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.headers.get('Set-Cookie')).toContain('opt_session_id=s-person');
  });

  it('names a refused link without the proof, and refuses to mint where no identity secret is configured', async () => {
    const refused = rig({ reply: () => Response.json({ ok: false, error: 'assertion does not verify' }, { status: 401 }) });
    const res = await refused.post('/sign-in', { account: ACCOUNT }, { [SHOPPER_HEADER]: (await session(refused.env)).capability });
    expect(res.status).toBe(401);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ ok: false, linked: false, error: 'the sign-in was refused: assertion does not verify' });
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain(refused.calls[0].body.assertion as string);
    // A link that answers without a recognised session is not a sign-in.
    const hollow = rig({ reply: () => Response.json({ ok: true }) });
    expect((await hollow.post('/sign-in', { account: ACCOUNT }, { [SHOPPER_HEADER]: (await session(hollow.env)).capability })).status).toBe(502);
    for (const IDENTITY_SECRETS of [undefined, '', 'vantage:another-tenants-material-0123456789']) {
      const bare = rig({ env: { IDENTITY_SECRETS } });
      const r = await bare.post('/sign-in', { account: ACCOUNT }, { [SHOPPER_HEADER]: (await session(bare.env)).capability });
      expect(r.status, String(IDENTITY_SECRETS)).toBe(503);
      expect(bare.calls).toHaveLength(0);
    }
  });

  it('refuses a session its own sign-in already retired (401), before anything is minted (R4 F6)', async () => {
    const { post, calls, env } = rig({ retired: true });
    const res = await post('/sign-in', { account: ACCOUNT }, { [SHOPPER_HEADER]: (await session(env)).capability });
    // 401, not 409: the engine answers a retired capability with 401 on every owned route; there is nothing to detach.
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ ok: false, error: 'this session was retired by its own sign-in; it signs in no more' });
    expect(calls).toHaveLength(0);
  });

  it('refuses to guess which showing’s person it is when the reset generation cannot be read (503)', async () => {
    const { post, calls, env } = rig({ storage: false });
    const res = await post('/sign-in', { account: ACCOUNT }, { [SHOPPER_HEADER]: (await session(env)).capability });
    expect(res.status).toBe(503);
    expect(calls).toHaveLength(0);
  });

  it('leaves the kit’s routes in place beside it', async () => {
    const { post, calls } = rig();
    expect((await post('/beat', { name: 'not-a-beat' })).status).toBe(400);
    expect((await post('/report', { date: 'today', slot: 'hero' })).status).toBe(400);
    expect(Object.keys(OH_BEATS)).toContain('open-catalog');
    expect(calls).toHaveLength(0);
    expect(() => ohSignInRoutes(undefined as never)).toThrow(/dispatch/);
  });

  it('keeps the account list closed and frozen, each name a fictional account id', () => {
    expect(Object.isFrozen(OH_ACCOUNTS)).toBe(true);
    expect(OH_ACCOUNTS.length).toBeGreaterThan(0);
    for (const name of OH_ACCOUNTS) expect(ohAccountId(name)).toMatch(/^oh-demo-[a-z0-9-]+$/);
    expect(new Set(OH_ACCOUNTS.map(ohAccountId)).size).toBe(OH_ACCOUNTS.length);
  });
});

// ── Through the real link: two devices, one person ────────────────────────────
class FakeKV {
  store = new Map<string, string>();
  async get(key: string, type?: string) { const r = this.store.get(key); return r === undefined ? null : type === 'stream' ? new Response(r).body : (type === 'json' ? JSON.parse(r) : r); }
  async put(key: string, value: string) { this.store.set(key, value); }
  async delete(key: string) { this.store.delete(key); }
  async list(o?: { prefix?: string; limit?: number; cursor?: string }) {
    const names = [...this.store.keys()].filter((k) => k.startsWith(o?.prefix ?? '')).sort();
    const start = Number(o?.cursor ?? 0), end = start + Math.min(1000, o?.limit ?? 1000);
    return { keys: names.slice(start, end).map((name) => ({ name })), list_complete: end >= names.length, ...(end < names.length ? { cursor: String(end) } : {}) };
  }
}
/** Enough of R2 for the configuration publication (src/config/publication.ts): conditional put, get with etag and body, list. */
class FakeR2 {
  store = new Map<string, string>();
  versions = new Map<string, number>();
  async put(key: string, body: string, options?: { onlyIf?: Headers | R2Conditional }) {
    const current = this.store.has(key) ? 'v' + (this.versions.get(key) ?? 0) : null;
    const condition = options?.onlyIf;
    if (condition instanceof Headers ? (condition.get('If-None-Match') === '*' && current !== null)
      || (condition.has('If-Match') && condition.get('If-Match') !== JSON.stringify(current))
      : (condition?.etagDoesNotMatch === '*' && current !== null) || (condition?.etagMatches !== undefined && condition.etagMatches !== current)) return null;
    this.store.set(key, body); const version = (this.versions.get(key) ?? 0) + 1; this.versions.set(key, version);
    return { key, etag: 'v' + version, size: new TextEncoder().encode(body).length };
  }
  async get(key: string) {
    const v = this.store.get(key);
    return v === undefined ? null : { key, text: async () => v, json: async () => JSON.parse(v) as unknown,
      etag: 'v' + (this.versions.get(key) ?? 0), size: new TextEncoder().encode(v).length, body: new Response(v).body };
  }
  async delete(key: string) { this.store.delete(key); }
  async list(o: { prefix: string }) { return { objects: [...this.store.keys()].filter((k) => k.startsWith(o.prefix)).map((key) => ({ key })), truncated: false }; }
}

/** The registry as a demo tenant publishes it: products stay out of the catalog, their attributes ride on the event (CW24). */
const cfg = { ...DEFAULT_REFLEX_CONFIG, eventAttributes: 'event-when-unknown' as const };

/** The tenant's configuration, published as an explicit baseline, as the identity suite publishes coach's. */
async function publishBaseline(env: Env) {
  const baseline = (kind: PublicationBaseline['kind'], value: unknown, scope = 'oh'): PublicationBaseline =>
    ({ kind, scope, revision: { revision: 1, at: 1, actor: 'synthetic-fixture', note: '', value } });
  await initializePublicationSet(env, [
    baseline(REFLEX_KIND, cfg, reflexScopeForTenant('oh')),
    baseline(CONTENT_KIND, { pieces: [] }), baseline(SLOTS_KIND, { pages: {} }),
    baseline(LEARN_KIND, { holdout: { share: 0, salt: 'fixture', arms: ['default'] } }),
  ], '0:' + crypto.randomUUID());
}
/** One catalog publish with its note, as the content route records it (the kit's reset notes "reset: open-catalog"). Answers its revision. */
async function publishCatalog(env: Env, note: string): Promise<number> {
  const base = await readPublication(env, CONTENT_KIND, 'oh');
  const r = await write(env, CONTENT_KIND, 'oh', { pieces: [] }, { actor: 'oh-demo', note, operationId: `${base.revision}:${crypto.randomUUID()}`,
    expectedRevision: base.revision, ...(base.publication ? { expectedPublication: base.publication } : {}) });
  if (!r.ok) throw new Error(r.errors.join('; '));
  return r.revision.revision;
}

describe('the sign-in through the real link, on the session host', () => {
  let env: Env;

  /** Real shopper objects over in-memory storage, as src/routes/identity.test.ts binds them. */
  function bindObjects() {
    const make = <T extends { fetch(request: Request): Promise<Response> }>(build: (state: DurableObjectState) => T) => {
      const items = new Map<string, { data: Map<string, unknown>; object: T }>();
      const open = (name: string) => {
        let item = items.get(name);
        if (!item) {
          const data = new Map<string, unknown>();
          const state = { id: name, getWebSockets: () => [], blockConcurrencyWhile: (run: () => Promise<unknown>) => run(), waitUntil: (p: Promise<unknown>) => p, storage: {
            get: async (key: string | string[]) => (Array.isArray(key) ? new Map(key.map((k) => [k, data.get(k)])) : data.get(key)),
            put: async (key: string | Record<string, unknown>, value?: unknown) => { if (typeof key === 'string') data.set(key, value); else for (const [k, v] of Object.entries(key)) data.set(k, v); },
            delete: async (key: string) => data.delete(key), deleteAll: async () => { data.clear(); },
            list: async (o?: { prefix?: string; startAfter?: string; limit?: number; reverse?: boolean }) => structuredClone(new Map([...data]
              .filter(([key]) => key.startsWith(o?.prefix ?? '') && (!o?.startAfter || key > o.startAfter))
              .sort(([a], [b]) => (o?.reverse ? -1 : 1) * a.localeCompare(b)).slice(0, o?.limit))),
            transaction: async (run: (tx: DurableObjectTransaction) => Promise<unknown>) => {
              const candidate = structuredClone(data);
              const result = await run({ list: async () => structuredClone(candidate),
                delete: async (keys: string[]) => { for (const key of keys) candidate.delete(key); return keys.length; },
                put: async (values: Record<string, unknown>) => { for (const [key, value] of Object.entries(values)) candidate.set(key, structuredClone(value)); },
                deleteAlarm: async () => undefined, setAlarm: async () => undefined } as unknown as DurableObjectTransaction);
              data.clear(); for (const [key, value] of candidate) data.set(key, value); return result;
            },
            getAlarm: async () => null, setAlarm: async () => undefined,
          } } as unknown as DurableObjectState;
          item = { data, object: build(state) }; items.set(name, item);
        }
        return item;
      };
      const ns = { idFromName: (n: string) => n, get: (name: string) => ({ fetch: async (input: RequestInfo | URL, init?: RequestInit) => open(name).object.fetch(new Request(input, init)) }) } as unknown as DurableObjectNamespace;
      return { ns, open };
    };
    const shopper = make((state) => new ShopperReflex(state, env));
    const ring = make((state) => new DecisionRing(state, env));
    const relay = make((state) => new PersonalizationWebSocket(state, env));
    env.SHOPPER_REFLEX = shopper.ns; env.DECISION_RING = ring.ns; env.PERSONALIZATION_WEBSOCKET = relay.ns;
  }

  /**
   * A consenting anonymous browser with some taste, accrued the way live traffic accrues it: her explicit choice
   * through her own object's consent door, then product views through its ingest door, each with her capability
   * (as src/reflex/shopperReflex.identity.test.ts browses). Answers the capability she then signs in with.
   */
  async function browseAs(visitorId: string, sessionId: string, values: string[]): Promise<string> {
    const issued = await session(env, visitorId, 'oh', 'anonymous', sessionId);
    const object = env.SHOPPER_REFLEX.get(env.SHOPPER_REFLEX.idFromName(shopperObjectName('oh', visitorId)));
    const send = (path: string, body: unknown) => object.fetch(`https://shopper-reflex${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', [SHOPPER_HEADER]: issued.capability, 'X-Tenant': 'oh' }, body: JSON.stringify(body) });
    const chosen = await send('/consent', { tracking: true, personalization: true,
      choice: { id: crypto.randomUUID(), expectedRevision: null, grantId: issued.grantId, iat: issued.iat, exp: issued.exp } });
    expect(chosen.status, await chosen.clone().text()).toBe(200);
    for (const line of values) {
      const r = await send('/ingest', { type: 'product_view', userId: visitorId, sessionId, source: 'test', data: { productId: `p-${line}`, action: 'product_view', line } });
      expect(r.status, await r.clone().text()).toBe(200);
    }
    return issued.capability;
  }

  /** What a session may read of its own object: the identity export door, with the capability, as the owner reads it. */
  const read = (subject: string, capability: string) => env.SHOPPER_REFLEX.get(env.SHOPPER_REFLEX.idFromName(shopperObjectName('oh', subject)))
    .fetch('https://shopper-reflex/identity/export', { headers: { [SHOPPER_HEADER]: capability, 'X-Tenant': 'oh' } });

  /** The worker as src/index.ts composes it: the tenant gate, the identity routes, and OH's routes re-entering the same app. */
  function worker() {
    const app = new Hono<{ Bindings: Env; Variables: TenantVariables }>();
    const dispatch = (request: Request, e: Env, c: ExecutionContext) => app.fetch(request, e, c);
    app.use('*', tenantMiddleware());
    app.route('/v1', identityRoutes as never);
    app.route('/oh/api', ohRoutes(dispatch as never) as never);
    return (capability: string, body: unknown = { account: ACCOUNT }) => app.request('https://demo.example/oh/api/sign-in', {
      method: 'POST', headers: { 'content-type': 'application/json', 'X-Tenant': 'oh', [SHOPPER_HEADER]: capability }, body: JSON.stringify(body),
    }, env, ctx);
  }

  beforeEach(async () => {
    env = baseEnv({ CACHE: new FakeKV(), SESSIONS: new FakeKV(), STORAGE: new FakeR2() });
    bindObjects();
    await publishBaseline(env);
  });

  it('a laptop and then a phone sign in as the same fictional account: one person, the sum of both', async () => {
    const laptopCap = await browseAs(LAPTOP, 's-laptop', ['OLED', 'OLED', 'Laundry']);
    const phoneCap = await browseAs(PHONE, 's-phone', ['Soundbar']);
    const signIn = worker();
    const laptop = await signIn(laptopCap);
    expect(laptop.status).toBe(200);
    const a = await laptop.json() as { ok: boolean; linked: boolean; session: { subject: string; kind: string; capability: string } };
    const phone = await signIn(phoneCap);
    expect(phone.status).toBe(200);
    const b = await phone.json() as typeof a;

    // One person, named by the account and the reset generation (0: none on record), and the session each device carries from now on is hers.
    const person = await shopperIdFor(env, 'oh', linkedAccountId(ACCOUNT, 0));
    for (const r of [a, b]) {
      expect(r).toMatchObject({ ok: true, linked: true, session: { kind: 'recognized', subject: person } });
      expect(Object.keys(r).sort()).toEqual(['linked', 'ok', 'session']);
    }
    expect(b.session.capability).not.toBe(a.session.capability);

    // The engine's contract (identity.test.ts, "cross-device, the person is the sum"): both histories, one profile.
    const sm = new SessionManager(env, { tenant: 'oh' });
    const profile = await sm.getSessionByUserId(person);
    const dims = snapshot(profile!.reflex!, Date.now(), cfg).dims.line ?? {};
    expect(Object.keys(dims).sort()).toEqual(['Laundry', 'OLED', 'Soundbar']);
    expect(dims.OLED!).toBeGreaterThan(dims.Soundbar!);       // the laptop's taste leads on the phone now
    expect(profile!.attributes.product_views).toBe(4);
    // The phone's next request is the person's: its new session reads the laptop's taste from the person's own object,
    // and the anonymous sessions the sign-ins retired read nothing (each browser's object now forwards to the person).
    const mine = await read(person, b.session.capability);
    expect(mine.status).toBe(200);
    const exported = await mine.json() as { affinity: { reflex: ReflexState } };
    expect(Object.keys(snapshot(exported.affinity.reflex, Date.now(), cfg).dims.line ?? {}).sort()).toEqual(['Laundry', 'OLED', 'Soundbar']);
    expect((await read(PHONE, phoneCap)).status).toBe(401);
    expect((await read(LAPTOP, laptopCap)).status).toBe(401);
  });

  it('a session its own sign-in retired signs in no more: 401, no new session, nothing folded twice (R4 F6)', async () => {
    const old = await browseAs(LAPTOP, 's-laptop', ['OLED']);
    const signIn = worker();
    const first = await signIn(old);
    expect(first.status).toBe(200);
    const again = await signIn(old);
    // Without the check the link's own idempotent receipt would answer 200 with a fresh recognised session.
    expect(again.status).toBe(401);
    const body = await again.json() as Record<string, unknown>;
    expect(body.ok).toBe(false);
    expect(body).not.toHaveProperty('session');
    const person = await shopperIdFor(env, 'oh', linkedAccountId(ACCOUNT, 0));
    const profile = await new SessionManager(env, { tenant: 'oh' }).getSessionByUserId(person);
    expect(profile!.attributes.product_views).toBe(1);
  });

  it('a fresh person on every showing: each reset gives a new linked id; one reset gives one person on the laptop and the phone (R4 F3)', async () => {
    const signIn = worker();
    const subjectOf = async (r: Response) => { expect(r.status).toBe(200); return ((await r.json()) as { session: { subject: string } }).session.subject; };
    // The first showing: its reset, then the laptop, a beat's own catalog publish (beat 13's), then the phone.
    const first = await publishCatalog(env, RESET_NOTE);
    expect(await resetGeneration(env)).toBe(first);
    const laptop1 = await subjectOf(await signIn(await browseAs(LAPTOP, 's-laptop', ['OLED'])));
    await publishCatalog(env, 'three weeks pass: every window moves back 21 days');
    expect(await resetGeneration(env)).toBe(first);
    const phone1 = await subjectOf(await signIn(await browseAs(PHONE, 's-phone', ['Soundbar'])));
    expect(phone1).toBe(laptop1);
    expect(laptop1).toBe(await shopperIdFor(env, 'oh', linkedAccountId(ACCOUNT, first)));
    // The next showing: a new reset, and the same name is a new person; the first showing's devices are not in her.
    const second = await publishCatalog(env, RESET_NOTE);
    expect(second).toBeGreaterThan(first);
    const laptop2 = await subjectOf(await signIn(await browseAs('vis-00000000-0000-4000-8000-0000000000c3', 's-laptop-2', ['QNED'])));
    expect(laptop2).toBe(await shopperIdFor(env, 'oh', linkedAccountId(ACCOUNT, second)));
    expect(laptop2).not.toBe(laptop1);
    const today = await new SessionManager(env, { tenant: 'oh' }).getSessionByUserId(laptop2);
    expect(Object.keys(snapshot(today!.reflex!, Date.now(), cfg).dims.line ?? {})).toEqual(['QNED']);
  });

  it('an unknown name never reaches the link, whatever the session', async () => {
    const cap = await browseAs(LAPTOP, 's-laptop', ['OLED']);
    const signIn = worker();
    const res = await signIn(cap, { account: 'Somebody Real' });
    expect(res.status).toBe(400);
    // Her browser is still her own, and nobody became anybody.
    const own = await read(LAPTOP, cap);
    expect(own.status).toBe(200);
    expect(((await own.json()) as { forwardTo: unknown }).forwardTo).toBeNull();
    expect(await new SessionManager(env, { tenant: 'oh' }).getSessionByUserId(await shopperIdFor(env, 'oh', linkedAccountId(ACCOUNT, 0)))).toBeNull();
  });
});

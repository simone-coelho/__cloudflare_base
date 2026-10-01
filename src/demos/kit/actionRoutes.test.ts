// src/demos/kit/actionRoutes.test.ts — the demo kit's action routes, built for a
// second, fictional demo (an appliance maker on the tenant `kestrel`) that
// differs from Vantage on every constant the factory takes: its own closed list
// of beats, beats path and seed script, reset order, report slots, operator
// subject, receipt-id prefix and asserted intents. Each is checked with the
// Vantage value refused beside it, so the factory is proven general rather than
// Vantage-shaped. src/routes/vantage.test.ts stays the regression gate for the
// real demo; this file is the gate for the factory.
import { describe, expect, it } from 'vitest';
import { jwtVerify } from 'jose';
import type { Env } from '@/types/env';
import { issueSessionCapability } from '@/identity/sessionCapability';
import { VANTAGE_ACTIONS } from '@/demos/vantage.config';
import { demoActionRoutes, type DemoActionConfig } from './actionRoutes';
import { assertedContextOf, ownDecisionId } from './helpers';

const SECRET = 'k1-demo-kit-test-secret-long-enough-0000';
const ISSUER = 'edge-platform', AUDIENCE = 'edge-platform-api';
const ctx = { waitUntil: () => undefined, passThroughOnException: () => undefined } as unknown as ExecutionContext;

/** A second demo, fictional, shaped unlike Vantage on every constant the factory takes. */
const KESTREL: DemoActionConfig = {
  tenant: 'kestrel',
  operator: 'kestrel-demo',
  beats: { 'open-catalog': 'catalog', 'open-slots': 'slots', '04-spring-sale': 'catalog', '07-pin-bundle': 'slots' },
  // Catalog first: the order is the config's, not Vantage's slots-then-catalog.
  reset: ['open-catalog', 'open-slots'],
  reportSlots: new Set(['companions', 'packages']),
  asserted: new Set(['gift', 'self']),
  // Deeper than Vantage's /vantage/beats, so a hard-coded path finds nothing.
  beatsPath: '/kestrel/kit/beats',
  seedScript: 'scripts/seed-kestrel.mjs',
};

type Call = { method: string; url: string; headers: Headers; body: unknown };

/** The worker's own beat document, as a seed writes it. */
const beatFile = (name: string, kind: string) => ({
  name, beat: 4, kind: 'publish', publish: { kind, document: { version: `doc-${name}`, pages: {}, pieces: [] } },
});

/** The ordinary pipeline's publication answers, unless a test supplies its own reply. */
const publicationReply = (request: Request) => request.method === 'GET'
  ? Response.json({ ok: true, revision: 7, publication: { revision: 3, digest: 'd'.repeat(64) } })
  : Response.json({ ok: true, revision: 8 });

function rig(config: DemoActionConfig = KESTREL, o: {
  profile?: string; tenants?: string[]; reply?: (request: Request) => Response; assets?: (path: string) => Response;
} = {}) {
  const calls: Call[] = [];
  const assetPaths: string[] = [];
  const dispatch = async (request: Request) => {
    const body = request.method === 'PUT' || request.method === 'POST' ? await request.json() : undefined;
    calls.push({ method: request.method, url: request.url, headers: request.headers, body });
    return (o.reply ?? publicationReply)(request);
  };
  const env = {
    DEPLOYMENT_PROFILE: o.profile ?? 'demo',
    JWT_SECRET: SECRET, JWT_ISSUER: ISSUER, JWT_AUDIENCE: AUDIENCE,
    // The receipt's shopper check resolves the tenant from X-Tenant against this, as on a demo worker.
    TENANTS: JSON.stringify({ provisioned: o.tenants ?? [config.tenant] }),
    ASSETS: {
      fetch: async (request: Request) => {
        const path = new URL(request.url).pathname;
        assetPaths.push(path);
        if (o.assets) return o.assets(path);
        // Served only under this demo's own beats path, as the static host would.
        const prefix = `${config.beatsPath}/`;
        if (!path.startsWith(prefix) || !path.endsWith('.json')) return new Response('Not Found', { status: 404 });
        const name = path.slice(prefix.length, -'.json'.length);
        return Response.json(beatFile(name, Object.hasOwn(config.beats, name) ? config.beats[name]! : 'catalog'));
      },
    },
  };
  const app = demoActionRoutes({ ...config, dispatch: dispatch as never });
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) => app.request(`https://demo.example${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
  }, env, ctx);
  return { app, env, calls, assetPaths, post };
}

const subjectOf = async (call: Call) => (await jwtVerify((call.headers.get('Authorization') ?? '').slice('Bearer '.length),
  new TextEncoder().encode(SECRET), { issuer: ISSUER, audience: AUDIENCE })).payload;

const SHOPPER = 'vis-5d0c7a7e-3f1b-4c8e-9a2d-6b1e0f4c2a91';
/** A decision id as src/content/decide.ts builds them, on the tenant named. */
const idOn = (tenant: string, visitor = SHOPPER) => `${tenant}:muoojel3:${visitor}:laundry:companions:0:n1:2f9d4c1e-8b7a-4e3d-a1c2-5f6e7d8c9b0a`;

/** A kestrel ledger that answers every id as the shopper's own record. */
const kestrelLedger = (request: Request) => {
  const id = decodeURIComponent(new URL(request.url).pathname.replace(/^\/v1\/kestrel\/ledger\//, ''));
  return Response.json({ ok: true, record: { decision_id: id, visitor_id: SHOPPER, session_id: 's-1', page: 'laundry', slot: 'companions',
    position: 0, item_id: 'pedestal', explain: { drivers: [] }, inputs: { affinity: { finish: { steel: 0.7 } } } } });
};

/** The receipt as the kestrel page asks for it: her own session capability, X-Tenant: kestrel. */
async function asShopper(r: ReturnType<typeof rig>, body: unknown) {
  const { capability } = await issueSessionCapability(r.env as unknown as Env, { tenant: 'kestrel', subject: SHOPPER, sessionId: 's-1', kind: 'anonymous' });
  return r.post('/receipt', body, { 'X-Tenant': 'kestrel', 'X-Shopper-Session': capability });
}

describe('demoActionRoutes for a second demo: absent off the demo profile', () => {
  it('answers 404 to every action off the demo profile, reading and dispatching nothing', async () => {
    for (const profile of ['customer', '', 'staging', 'Demo']) {
      const { post, calls, assetPaths } = rig(KESTREL, { profile });
      for (const path of ['/beat', '/reset', '/receipt', '/report']) {
        const res = await post(path, { name: '04-spring-sale' });
        expect(res.status, `${profile || '(none)'} ${path}`).toBe(404);
        expect(res.headers.get('Cache-Control')).toBe('no-store');
        expect(await res.json()).toEqual({ error: 'Not Found' });
      }
      expect(calls).toEqual([]);
      expect(assetPaths).toEqual([]);
    }
  });
});

describe('its own closed list of beats', () => {
  it('refuses Vantage’s names, prototype names, paths and a wrong kind before reading anything', async () => {
    const { post, calls, assetPaths } = rig();
    const refused = ['11-two-weeks-pass', '12-black-friday', '13-pin-duo-preorder', 'constructor', '__proto__', 'toString', 'hasOwnProperty',
      '../open-catalog', 'open-catalog.json', 'OPEN-CATALOG', ''];
    for (const name of refused) {
      const res = await post('/beat', { name });
      expect(res.status, name).toBe(400);
      expect(await res.json(), name).toEqual({ ok: false, error: 'unknown beat; the publishable beats are open-catalog, open-slots, 04-spring-sale, 07-pin-bundle' });
    }
    expect((await post('/beat', 'open-catalog')).status).toBe(400);
    const wrongKind = await post('/beat', { name: '04-spring-sale', kind: 'slots' });
    expect(wrongKind.status).toBe(400);
    expect(await wrongKind.json()).toEqual({ ok: false, error: '04-spring-sale publishes catalog' });
    expect(calls).toEqual([]);
    expect(assetPaths).toEqual([]);
  });

  it('publishes its own asset, from its own beats path, into its own tenant, never a document from the request', async () => {
    const { post, calls, assetPaths } = rig();
    const res = await post('/beat', { name: '07-pin-bundle', note: 'rehearsal <b>', document: { version: 'smuggled', pieces: [{ id: 'x' }] } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, name: '07-pin-bundle', kind: 'slots', revision: 8 });
    expect(assetPaths).toEqual(['/kestrel/kit/beats/07-pin-bundle.json']);
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'GET https://demo.example/content/slots?scope=kestrel', 'PUT https://demo.example/content/slots?scope=kestrel']);
    expect(calls.map((c) => c.headers.get('X-Tenant'))).toEqual(['kestrel', 'kestrel']);
    const write = calls[1]!;
    expect(write.headers.get('If-Match')).toBe(`"7/3/${'d'.repeat(64)}"`);
    expect(write.headers.get('Idempotency-Key')).toMatch(/^7:[0-9a-f-]{36}$/);
    expect(write.body).toEqual({ document: { version: 'doc-07-pin-bundle', pages: {}, pieces: [] }, note: 'rehearsal b' });
  });

  it('mints a genuine 60-second operator token for its own subject', async () => {
    const { post, calls } = rig();
    await post('/beat', { name: '04-spring-sale' });
    expect(calls[0]!.headers.get('Authorization')).toMatch(/^Bearer /);
    const payload = await subjectOf(calls[0]!);
    expect(payload).toMatchObject({ sub: 'kestrel-demo', roles: ['operator'], type: 'service' });
    expect((payload.exp ?? 0) - (payload.iat ?? 0)).toBe(60);
  });

  it('names its own seed script for a missing document, and its own tenant for a missing grant', async () => {
    const missing = rig(KESTREL, { assets: () => new Response('<!doctype html><title>app</title>', { headers: { 'content-type': 'text/html' } }) });
    const res = await missing.post('/beat', { name: '04-spring-sale' });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false, name: '04-spring-sale',
      error: '04-spring-sale.json is missing or is not a catalog publish; run scripts/seed-kestrel.mjs, then redeploy' });
    expect(missing.calls).toEqual([]);
    const ungranted = rig(KESTREL, { reply: () => Response.json({}, { status: 403 }) });
    const refused = await ungranted.post('/beat', { name: '04-spring-sale' });
    expect(refused.status).toBe(503);
    expect(await refused.json()).toEqual({ ok: false, name: '04-spring-sale', stage: 'read', status: 403, error: 'the demo operator has no grant on "kestrel"' });
  });

  it('resets in its own order, each publish noted as the reset', async () => {
    const { post, calls } = rig();
    const res = await post('/reset', {});
    expect(res.status).toBe(200);
    const out = await res.json() as { ok: boolean; applied: Array<{ name: string; kind: string }> };
    expect(out.ok).toBe(true);
    expect(out.applied.map((a) => `${a.name} ${a.kind}`)).toEqual(['open-catalog catalog', 'open-slots slots']);
    expect(calls.map((c) => `${c.method} ${new URL(c.url).pathname}`)).toEqual([
      'GET /content/catalog', 'PUT /content/catalog', 'GET /content/slots', 'PUT /content/slots']);
    expect(calls.filter((c) => c.method === 'PUT').map((c) => (c.body as { note: string }).note)).toEqual(['reset: open-catalog', 'reset: open-slots']);
  });
});

describe('its own report slots', () => {
  it('reads a report only for one of its slots, and only from its own tenant', async () => {
    const report = { date: '2026-10-01', builtAt: 1, grids: { companions: { learning: { items: {} } } } };
    const { post, calls } = rig(KESTREL, { reply: () => Response.json({ ok: true, report }) });
    for (const slot of ['deals', 'pdp-modules', 'top-offers', 'constructor']) {
      const res = await post('/report', { date: '2026-10-01', slot });
      expect(res.status, slot).toBe(400);
      expect(await res.json()).toEqual({ ok: false, error: 'date (YYYY-MM-DD) and a slot (companions, packages) are required' });
    }
    expect(calls).toEqual([]);
    const res = await post('/report', { date: '2026-10-01', slot: 'companions', build: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, report });
    expect(calls.map((c) => `${c.method} ${new URL(c.url).pathname}${new URL(c.url).search}`)).toEqual([
      'POST /v1/kestrel/learn/report', 'GET /v1/kestrel/learn/report?date=2026-10-01&slot=companions']);
    expect(calls.map((c) => c.headers.get('X-Tenant'))).toEqual(['kestrel', 'kestrel']);
  });
});

describe('its own receipts: the tenant prefix and the asserted intents', () => {
  it('answers her own kestrel decision from the kestrel ledger, without her ids or her vector (the control)', async () => {
    const r = rig(KESTREL, { reply: kestrelLedger });
    const res = await asShopper(r, { decisionId: idOn('kestrel') });
    expect(res.status).toBe(200);
    const out = await res.json() as { ok: boolean; record: Record<string, unknown> };
    expect(out.ok).toBe(true);
    expect(out.record).toMatchObject({ decision_id: idOn('kestrel'), slot: 'companions', item_id: 'pedestal' });
    for (const hidden of ['visitor_id', 'session_id', 'inputs']) expect(out.record, hidden).not.toHaveProperty(hidden);
    expect(r.calls.map((c) => `${c.method} ${new URL(c.url).pathname}`)).toEqual([`GET /v1/kestrel/ledger/${encodeURIComponent(idOn('kestrel'))}`]);
    expect(r.calls[0]!.headers.get('X-Tenant')).toBe('kestrel');
    expect((await subjectOf(r.calls[0]!)).sub).toBe('kestrel-demo');
  });

  it('refuses an id on any other prefix before any read, even one that names her', async () => {
    const r = rig(KESTREL, { reply: kestrelLedger });
    for (const id of [idOn('vantage'), idOn('kestrel-2'), idOn('kest'), idOn('kestrel').slice('kestrel'.length)]) {
      const res = await asShopper(r, { decisionIds: [id] });
      expect(res.status, id).toBe(400);
      expect(await res.json()).toMatchObject({ ok: false, error: expect.stringContaining('own decisions') });
    }
    expect(r.calls).toEqual([]);
  });

  it('labels an intent from its own set as asserted, and refuses one of Vantage’s before any read', async () => {
    const r = rig(KESTREL, { reply: kestrelLedger });
    const res = await asShopper(r, { decisionId: idOn('kestrel'), context: { intent: 'gift', region: 'us-ca' } });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { record: { asserted: unknown } }).record.asserted).toEqual({
      'ctx.region': { value: 'US-CA', from: 'request' }, 'ctx.intent': { value: 'gift', from: 'request' },
    });
    const before = r.calls.length;
    const byod = await asShopper(r, { decisionId: idOn('kestrel'), context: { intent: 'byod' } });
    expect(byod.status).toBe(400);
    expect(await byod.json()).toEqual({ ok: false, error: 'context.intent must be one of gift, self' });
    expect(r.calls).toHaveLength(before);
  });
});

describe('one factory, two demos', () => {
  it('builds Vantage and a second demo side by side, sharing nothing', async () => {
    const kestrel = rig(KESTREL, { tenants: ['kestrel', 'vantage'] });
    const vantage = rig(VANTAGE_ACTIONS, { tenants: ['kestrel', 'vantage'] });
    expect((await kestrel.post('/beat', { name: '11-two-weeks-pass' })).status).toBe(400);
    expect((await vantage.post('/beat', { name: '04-spring-sale' })).status).toBe(400);
    expect((await kestrel.post('/beat', { name: 'open-slots' })).status).toBe(200);
    expect((await vantage.post('/beat', { name: 'open-slots' })).status).toBe(200);
    expect(kestrel.assetPaths).toEqual(['/kestrel/kit/beats/open-slots.json']);
    expect(vantage.assetPaths).toEqual(['/vantage/beats/open-slots.json']);
    expect(kestrel.calls[0]!.url).toBe('https://demo.example/content/slots?scope=kestrel');
    expect(vantage.calls[0]!.url).toBe('https://demo.example/content/slots?scope=vantage');
    expect((await subjectOf(kestrel.calls[0]!)).sub).toBe('kestrel-demo');
    expect((await subjectOf(vantage.calls[0]!)).sub).toBe('vantage-demo');
    const kestrelReport = await kestrel.post('/report', { date: '2026-10-01', slot: 'deals' });
    expect(kestrelReport.status).toBe(400);
    const vantageReport = await vantage.post('/report', { date: '2026-10-01', slot: 'companions' });
    expect(vantageReport.status).toBe(400);
  });

  it('is closed when built: widening the config objects afterwards widens nothing', async () => {
    const beats: Record<string, 'catalog' | 'slots'> = { ...KESTREL.beats };
    const reset = [...KESTREL.reset];
    const reportSlots = new Set(KESTREL.reportSlots);
    const asserted = new Set(KESTREL.asserted);
    const engine = (request: Request) => (new URL(request.url).pathname.startsWith('/v1/kestrel/ledger/') ? kestrelLedger : publicationReply)(request);
    const r = rig({ ...KESTREL, beats, reset, reportSlots, asserted }, { reply: engine });
    beats['99-smuggled'] = 'catalog';
    reset.push('99-smuggled');
    reportSlots.add('everything');
    asserted.add('anything');
    expect((await r.post('/beat', { name: '99-smuggled' })).status).toBe(400);
    expect((await r.post('/report', { date: '2026-10-01', slot: 'everything' })).status).toBe(400);
    expect((await asShopper(r, { decisionId: idOn('kestrel'), context: { intent: 'anything' } })).status).toBe(400);
    expect(r.calls).toEqual([]);
    const res = await r.post('/reset', {});
    expect(res.status).toBe(200);
    expect(((await res.json()) as { applied: Array<{ name: string }> }).applied.map((a) => a.name)).toEqual(['open-catalog', 'open-slots']);
  });
});

describe('a misconfigured demo fails when its routes are built, never on a request', () => {
  const dispatch = (async () => new Response(null)) as never;
  const build = (patch: Record<string, unknown>) => () => demoActionRoutes({ ...KESTREL, dispatch, ...patch } as never);

  it('builds Vantage’s config and the second demo’s (the control)', () => {
    expect(() => demoActionRoutes({ ...VANTAGE_ACTIONS, dispatch })).not.toThrow();
    expect(build({})).not.toThrow();
  });

  it('refuses a tenant that is not a tenant id, since it scopes every call and prefixes every receipt id', () => {
    for (const tenant of ['', 'Kestrel', 'kes:trel', 'kestrel/../vantage', ' kestrel', 'k'.repeat(40), undefined]) {
      expect(build({ tenant }), String(tenant)).toThrow(/is not a tenant id/);
    }
  });

  it('refuses beat names that are not plain words, kinds that are not catalog or slots, and a reset off the list', () => {
    for (const name of ['../open-catalog', 'open.catalog', 'open catalog', '-open', '']) {
      expect(build({ beats: { [name]: 'catalog' }, reset: [] }), name).toThrow(/is not a plain name/);
    }
    expect(build({ beats: { 'open-catalog': 'context' }, reset: [] })).toThrow(/publishes catalog or slots/);
    expect(build({ beats: null })).toThrow(/beats must be an object/);
    expect(build({ reset: ['open-catalog', '99-missing'] })).toThrow(/"99-missing", which is not on the beat list/);
    expect(build({ reset: ['constructor'] })).toThrow(/not on the beat list/);
    expect(build({ reset: 'open-catalog' })).toThrow(/reset must be a list/);
  });

  it('refuses a beats path that is not an absolute path of plain segments', () => {
    for (const beatsPath of ['kestrel/beats', '/kestrel/beats/', '/kestrel/../beats', '//beats', '/kestrel beats', '', 'https://cdn.example/beats']) {
      expect(build({ beatsPath }), beatsPath).toThrow(/is not an absolute asset path/);
    }
  });

  it('refuses a missing operator, seed script or dispatch, and closed lists that are not sets of names', () => {
    expect(build({ operator: '' })).toThrow(/an operator subject is required/);
    expect(build({ seedScript: '' })).toThrow(/a seed script is required/);
    expect(build({ reportSlots: ['companions'] })).toThrow(/reportSlots must be a Set/);
    expect(build({ asserted: new Set(['gift', '']) })).toThrow(/asserted holds ""/);
    expect(build({ dispatch: undefined })).toThrow(/dispatch must re-enter/);
  });
});

describe('the kit helpers, with the tenant and the asserted set as parameters', () => {
  it('ownDecisionId: the prefix is the whole tenant named, up to its colon', () => {
    const own = `kestrel:muoojel3:${SHOPPER}:laundry:companions:0`;
    expect(ownDecisionId(own, SHOPPER, 'kestrel')).toBe(true);
    expect(ownDecisionId(idOn('kestrel'), SHOPPER, 'kestrel')).toBe(true);
    expect(ownDecisionId(idOn('kestrel-2'), SHOPPER, 'kestrel-2')).toBe(true);
    // Another tenant's id, or a tenant that is a prefix of another, names none of hers.
    expect(ownDecisionId(own, SHOPPER, 'vantage')).toBe(false);
    expect(ownDecisionId(own, SHOPPER, 'kest')).toBe(false);
    expect(ownDecisionId(own, SHOPPER, 'kestrel-2')).toBe(false);
    expect(ownDecisionId(idOn('kestrel-2'), SHOPPER, 'kestrel')).toBe(false);
    // An empty tenant, like an empty subject, names no one's decisions.
    expect(ownDecisionId(own.slice('kestrel'.length), SHOPPER, '')).toBe(false);
    expect(ownDecisionId(own, '', 'kestrel')).toBe(false);
    // The shape after the prefix is unchanged: a base-36 time, then her id whole.
    expect(ownDecisionId(`kestrel:MUOOJEL3:${SHOPPER}:laundry:companions:0`, SHOPPER, 'kestrel')).toBe(false);
    expect(ownDecisionId(`kestrel::${SHOPPER}:laundry:companions:0`, SHOPPER, 'kestrel')).toBe(false);
    expect(ownDecisionId(`kestrel:muoojel3:${SHOPPER}0:laundry:companions:0`, SHOPPER, 'kestrel')).toBe(false);
    expect(ownDecisionId(`kestrel:muoojel3:${SHOPPER}:laundry/../x:0`, SHOPPER, 'kestrel')).toBe(false);
  });

  it('assertedContextOf: the intents are the set named; the region rule is the engine’s, whatever the set', () => {
    const kestrel = new Set(['gift', 'self']), vantage = new Set(['new', 'add-line', 'upgrade', 'byod']);
    expect(assertedContextOf({ intent: 'gift', region: 'us-ca' }, kestrel)).toEqual({ intent: 'gift', region: 'US-CA' });
    expect(assertedContextOf({ 'ctx.intent': 'self' }, kestrel)).toEqual({ intent: 'self' });
    const message = (value: unknown, set: ReadonlySet<string>) => {
      const out = assertedContextOf(value, set);
      return out instanceof Error ? out.message : null;
    };
    expect(message({ intent: 'byod' }, kestrel)).toBe('context.intent must be one of gift, self');
    expect(message({ intent: 'gift' }, vantage)).toBe('context.intent must be one of new, add-line, upgrade, byod');
    // A demo that asserts no intent still accepts an asserted region, and refuses every intent.
    expect(assertedContextOf({ region: 'US-NY' }, new Set())).toEqual({ region: 'US-NY' });
    expect(message({ intent: 'gift' }, new Set())).toMatch(/^context\.intent must be one of/);
    expect(message({ region: 'Texas' }, kestrel)).toBe('context.region must be a region key such as US-TX');
    expect(assertedContextOf(undefined, kestrel)).toBeNull();
  });
});

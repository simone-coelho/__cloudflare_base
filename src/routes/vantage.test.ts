// src/routes/vantage.test.ts — the Vantage demo route's safety properties:
// absent off the demo profile, a closed list of publishable names, the document
// always the worker's own asset, a genuine short-lived operator token into the
// ordinary pipeline, receipts that answer only the caller's own decisions
// without her ids or her vector (checked on the route itself, before and after
// the read), and a day report whose budget refusal is named, never a 502.
import { describe, expect, it } from 'vitest';
import { jwtVerify } from 'jose';
import type { Env } from '@/types/env';
import { issueSessionCapability } from '@/identity/sessionCapability';
import { VANTAGE_BEATS, VANTAGE_RESET, assertedContextOf, assertedOf, ownDecisionId, publishedDocument, receiptOf, reportTooLarge, vantageRoutes } from './vantage';

const SECRET = 'l1-test-secret-that-is-long-enough-000';
const ctx = { waitUntil: () => undefined, passThroughOnException: () => undefined } as unknown as ExecutionContext;

const beatFile = (name: string, kind = VANTAGE_BEATS[name], extra: Record<string, unknown> = {}) => ({
  name, beat: 11, kind: 'publish', publish: { kind, document: { version: `doc-${name}`, pages: {}, pieces: [] } }, ...extra,
});

/** The ordinary pipeline's publication answers, unless a test supplies its own reply (ledger and report reads). */
const publicationReply = (request: Request) => request.method === 'GET'
  ? Response.json({ ok: true, revision: 7, publication: { revision: 3, digest: 'd'.repeat(64) } })
  : Response.json({ ok: true, revision: 8 });

function rig(options: { profile?: string; assets?: (name: string) => Response; secret?: string | null; reply?: (request: Request) => Response } = {}) {
  const calls: Array<{ method: string; url: string; headers: Headers; body: unknown }> = [];
  const dispatch = async (request: Request) => {
    const body = request.method === 'PUT' || request.method === 'POST' ? await request.json() : undefined;
    calls.push({ method: request.method, url: request.url, headers: request.headers, body });
    return (options.reply ?? publicationReply)(request);
  };
  const env = {
    DEPLOYMENT_PROFILE: options.profile ?? 'demo',
    ...(options.secret === null ? {} : { JWT_SECRET: options.secret ?? SECRET }),
    JWT_ISSUER: 'edge-platform',
    JWT_AUDIENCE: 'edge-platform-api',
    // The receipt's shopper check resolves the tenant from X-Tenant against this, as on the demo worker.
    TENANTS: JSON.stringify({ provisioned: ['vantage'] }),
    ASSETS: {
      fetch: async (request: Request) => {
        const name = new URL(request.url).pathname.replace(/^\/vantage\/beats\//, '').replace(/\.json$/, '');
        return options.assets ? options.assets(name) : Response.json(beatFile(name));
      },
    },
  };
  const app = vantageRoutes(dispatch as never);
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) => app.request(`https://demo.example${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
  }, env, ctx);
  return { app, env, calls, post };
}

describe('the Vantage beat route', () => {
  it('is absent off the demo profile, for every action', async () => {
    for (const profile of ['customer', '', 'staging']) {
      const { post, calls } = rig({ profile });
      for (const path of ['/beat', '/reset', '/receipt', '/report']) {
        const res = await post(path, { name: '11-two-weeks-pass' });
        expect(res.status, `${profile} ${path}`).toBe(404);
      }
      expect(calls).toHaveLength(0);
    }
  });

  it('accepts only the closed list of names, including against prototype names', async () => {
    const { post, calls } = rig();
    for (const name of ['03-browse-galaxy-pixel', 'constructor', '__proto__', 'toString', '../anchor', 'open-catalog.json', '']) {
      const res = await post('/beat', { name });
      expect(res.status, name).toBe(400);
    }
    expect((await post('/beat', 'open-catalog')).status).toBe(400);
    expect((await post('/beat', { name: '11-two-weeks-pass', kind: 'slots' })).status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it('publishes the worker’s own asset and never a document from the request', async () => {
    const { post, calls } = rig();
    const res = await post('/beat', { name: '12-black-friday', note: 'rehearsal <script>', document: { version: 'smuggled', pieces: [{ id: 'x' }] } });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, name: '12-black-friday', kind: 'catalog', revision: 8 });
    const [read, write] = calls;
    expect(read.method).toBe('GET');
    expect(read.url).toBe('https://demo.example/content/catalog?scope=vantage');
    expect(write.method).toBe('PUT');
    expect(write.headers.get('If-Match')).toBe(`"7/3/${'d'.repeat(64)}"`);
    expect(write.headers.get('Idempotency-Key')).toMatch(/^7:[0-9a-f-]{36}$/);
    expect(write.headers.get('X-Tenant')).toBe('vantage');
    expect(write.body).toEqual({ document: { version: 'doc-12-black-friday', pages: {}, pieces: [] }, note: 'rehearsal script' });
  });

  it('mints a genuine 60-second operator token for the demo subject', async () => {
    const { post, calls } = rig();
    await post('/beat', { name: 'open-slots' });
    const bearer = calls[0].headers.get('Authorization') ?? '';
    expect(bearer).toMatch(/^Bearer /);
    const { payload } = await jwtVerify(bearer.slice(7), new TextEncoder().encode(SECRET), { issuer: 'edge-platform', audience: 'edge-platform-api' });
    expect(payload).toMatchObject({ sub: 'vantage-demo', roles: ['operator'], type: 'service' });
    expect((payload.exp ?? 0) - (payload.iat ?? 0)).toBe(60);
    expect(calls[0].url).toBe('https://demo.example/content/slots?scope=vantage');
  });

  it('refuses an asset that is not this beat’s publish, and a worker with no signing material', async () => {
    const html = rig({ assets: () => new Response('<!doctype html><title>app</title>', { headers: { 'content-type': 'text/html' } }) });
    expect((await html.post('/beat', { name: '11-two-weeks-pass' })).status).toBe(503);
    const context = rig({ assets: (name) => Response.json({ name, kind: 'context', events: [] }) });
    expect((await context.post('/beat', { name: '11-two-weeks-pass' })).status).toBe(503);
    const renamed = rig({ assets: () => Response.json(beatFile('12-black-friday', 'catalog')) });
    expect((await renamed.post('/beat', { name: '11-two-weeks-pass' })).status).toBe(503);
    for (const r of [html, context, renamed]) expect(r.calls).toHaveLength(0);
    const unsigned = rig({ secret: null });
    expect((await unsigned.post('/beat', { name: '11-two-weeks-pass' })).status).toBe(503);
    expect((await unsigned.post('/reset', {})).status).toBe(503);
  });

  it('resets to the opening slots, then the opening catalog', async () => {
    const { post, calls } = rig();
    const res = await post('/reset', {});
    expect(res.status).toBe(200);
    expect(VANTAGE_RESET).toEqual(['open-slots', 'open-catalog']);
    expect(calls.map((c) => `${c.method} ${new URL(c.url).pathname}`)).toEqual([
      'GET /content/slots', 'PUT /content/slots', 'GET /content/catalog', 'PUT /content/catalog',
    ]);
  });

  it('reads a report only for a date and one of the demo’s slots', async () => {
    const { post, calls } = rig();
    expect((await post('/report', { date: '2026-09-30', slot: 'top-offers' })).status).toBe(400);
    expect((await post('/report', { date: '30/09/2026', slot: 'deals' })).status).toBe(400);
    expect(calls).toHaveLength(0);
  });
});

describe('the day report (R1 7b-iii)', () => {
  // What the engine answered on a busy rehearsal day: the whole UTC day's raw ledger is past its byte budget.
  const refusal = { ok: false, error: 'report budget exceeded', code: 'report_budget_exceeded', budget: 'rawBytes', limit: 16_777_216, observed: 16_802_288 };
  const report = { date: '2026-10-01', builtAt: 1, hours: { source: 'ledger', built: [], missing: [] }, grids: { deals: { learning: { items: {} } } } };
  const engine = (build: number, read = 200) => (request: Request) => {
    const url = new URL(request.url);
    if (url.pathname !== '/v1/vantage/learn/report') return Response.json({ ok: false, error: 'unexpected' }, { status: 500 });
    if (request.method === 'POST') return build === 200 ? Response.json({ ok: true, report }) : Response.json(build === 413 ? refusal : { ok: false, error: 'boom' }, { status: build });
    return read === 200 ? Response.json({ ok: true, report, page: { slot: url.searchParams.get('slot') } }) : Response.json(refusal, { status: read });
  };

  it('builds the day once, then reads the one slot it was asked for', async () => {
    const { post, calls } = rig({ reply: engine(200) });
    const res = await post('/report', { date: '2026-10-01', slot: 'deals', build: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, report });
    expect(calls.map((c) => `${c.method} ${new URL(c.url).pathname}${new URL(c.url).search}`)).toEqual([
      'POST /v1/vantage/learn/report', 'GET /v1/vantage/learn/report?date=2026-10-01&slot=deals']);
    // The build names the day and nothing else: the engine has no narrower window and no slot filter.
    expect(calls[0].body).toEqual({ date: '2026-10-01' });
    expect(calls.every((c) => c.headers.get('X-Tenant') === 'vantage')).toBe(true);
  });

  it('a build the engine refuses on its budget is "report too large for the window", 413, and nothing is read after it', async () => {
    const { post, calls } = rig({ reply: engine(413) });
    const res = await post('/report', { date: '2026-10-01', slot: 'deals', build: true });
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ ok: false, code: 'report_too_large', error: 'report too large for the window',
      window: { date: '2026-10-01', unit: 'UTC day', slot: 'deals' }, budget: 'rawBytes', limit: 16_777_216, observed: 16_802_288 });
    expect(calls.map((c) => c.method)).toEqual(['POST']);
  });

  it('a read refused on its budget is named the same way; any other failure is still a 502', async () => {
    const read = await rig({ reply: engine(200, 413) }).post('/report', { date: '2026-10-01', slot: 'pdp-modules' });
    expect(read.status).toBe(413);
    expect(await read.json()).toMatchObject({ code: 'report_too_large', window: { date: '2026-10-01', unit: 'UTC day', slot: 'pdp-modules' } });
    const broken = await rig({ reply: engine(500) }).post('/report', { date: '2026-10-01', slot: 'deals', build: true });
    expect(broken.status).toBe(502);
    expect(await broken.json()).toEqual({ ok: false, error: 'the report could not be built (500)' });
  });

  it('carries only the refusal’s budget figures, never free text from it', () => {
    expect(reportTooLarge('2026-10-01', 'deals', { budget: 'objects', limit: 800, observed: 912, error: '<script>', objects: 912 }))
      .toEqual({ ok: false, code: 'report_too_large', error: 'report too large for the window',
        window: { date: '2026-10-01', unit: 'UTC day', slot: 'deals' }, budget: 'objects', limit: 800, observed: 912 });
    expect(reportTooLarge('2026-10-01', 'deals', 'not json')).toMatchObject({ budget: null, limit: null, observed: null });
  });
});

describe('the beat document check', () => {
  it('returns the document only for this beat, as a publish of its kind', () => {
    const file = beatFile('11-two-weeks-pass');
    expect(publishedDocument(file, '11-two-weeks-pass', 'catalog')).toEqual(file.publish.document);
    expect(publishedDocument(file, '12-black-friday', 'catalog')).toBeNull();
    expect(publishedDocument(file, '11-two-weeks-pass', 'slots')).toBeNull();
    expect(publishedDocument({ ...file, kind: 'context' }, '11-two-weeks-pass', 'catalog')).toBeNull();
    expect(publishedDocument({ ...file, publish: { kind: 'catalog', document: [] } }, '11-two-weeks-pass', 'catalog')).toBeNull();
    expect(publishedDocument(null, '11-two-weeks-pass', 'catalog')).toBeNull();
  });

  it('names every publishable beat with the kind the seed writes', () => {
    expect(VANTAGE_BEATS).toEqual({
      'open-catalog': 'catalog', 'open-slots': 'slots',
      '11-two-weeks-pass': 'catalog', '12-black-friday': 'catalog', '13-pin-duo-preorder': 'slots',
    });
  });
});

describe('the receipt', () => {
  const subject = 'vis-39673fbb-81aa-4f3c-83d9-88a3817f9941';
  const own = `vantage:muoojel3:${subject}:home:deals:0:n1:4c26776d-24f1-4402-abd4-b524b342c5ea`;

  it('answers only ids that name the caller’s own decisions', () => {
    expect(ownDecisionId(own, subject)).toBe(true);
    expect(ownDecisionId(`vantage:muoojel3:${subject}:phone:pdp-modules:3`, subject)).toBe(true);
    expect(ownDecisionId(own, 'vis-someone-else')).toBe(false);
    expect(ownDecisionId(own.replace('vantage:', 'shn:'), subject)).toBe(false);
    expect(ownDecisionId(`vantage:muoojel3:${subject}0:home:deals:0`, subject)).toBe(false);
    expect(ownDecisionId(`vantage::${subject}:home:deals:0`, subject)).toBe(false);
    expect(ownDecisionId(`vantage:muoojel3:${subject}:home/../x:0`, subject)).toBe(false);
    expect(ownDecisionId(`vantage:x:${subject}:h`.padEnd(600, 'a'), subject)).toBe(false);
    expect(ownDecisionId(42, subject)).toBe(false);
    expect(ownDecisionId(own, '')).toBe(false);
  });

  it('shows the explanation and leaves out her ids and her vector', () => {
    const record = {
      decision_id: own, request_id: 'r', tenant: 'vantage', brand: 'vantage', visitor_id: subject, session_id: 's-1', identity_anchor: 'visitor',
      ts: 1, page: 'home', slot: 'deals', position: 0, ranking_position: 0, item_id: 'promo_x', customer_item_id: 'promo-x',
      candidates: [{ contentId: 'promo_x', score: 0.4 }], cell: { channel: 'paid_social', visit_bucket: '1', region: 'US-TX', affinity: null },
      journey: { stage: 'exploring', version: 'reflex-vantage-v1+r2' }, arm: 'personalized', experiment: { id: 'e' }, explored: false, authority: 'engine',
      versions: { config: 2 }, config_label: 'reflex-vantage-v1+r2',
      explain: { drivers: [], score_base: 0.4, score_final: 0.4, lift: null, contextual: { applied: 0.09, drivers: [] }, regional: { region: 'US-TX' } },
      inputs: { affinity: { brand: { samsung: 0.7 } } }, retention: { ledger: {} }, measurementBasis: 'served-v1',
    };
    const receipt = receiptOf(record);
    for (const hidden of ['visitor_id', 'session_id', 'request_id', 'identity_anchor', 'tenant', 'brand', 'experiment', 'inputs', 'retention']) {
      expect(receipt, hidden).not.toHaveProperty(hidden);
    }
    expect(receipt).toMatchObject({ slot: 'deals', customer_item_id: 'promo-x', authority: 'engine', cell: record.cell, journey: record.journey,
      explain: record.explain, candidates: record.candidates, measurementBasis: 'served-v1' });
  });
});

describe('the receipt route: her own decisions only, checked on the route (R1 N3)', () => {
  const subject = 'vis-39673fbb-81aa-4f3c-83d9-88a3817f9941';
  const other = 'vis-0b8e5b8e-2b9c-4c55-9a51-7d0e2f6c1a42';
  const idOf = (visitor: string) => `vantage:muoojel3:${visitor}:home:deals:0:n1:4c26776d-24f1-4402-abd4-b524b342c5ea`;
  const recordOf = (id: string, visitor: string) => ({ decision_id: id, visitor_id: visitor, session_id: 's-1', page: 'home', slot: 'deals', position: 0,
    item_id: 'promo_x', customer_item_id: 'promo-x', explain: { drivers: [] }, inputs: { affinity: { brand: { samsung: 0.7 } } } });
  /** The ledger read answers with whatever record the test names, for any id it is asked for. */
  const ledger = (visitor: (id: string) => string) => (request: Request) => {
    const id = decodeURIComponent(new URL(request.url).pathname.replace(/^\/v1\/vantage\/ledger\//, ''));
    return Response.json({ ok: true, record: recordOf(id, visitor(id)) });
  };
  async function asHer(r: ReturnType<typeof rig>, body: unknown) {
    const { capability } = await issueSessionCapability(r.env as unknown as Env, { tenant: 'vantage', subject, sessionId: 's-1', kind: 'anonymous' });
    return r.post('/receipt', body, { 'X-Tenant': 'vantage', 'X-Shopper-Session': capability });
  }

  it('answers her own decision with its projection (the control for the two refusals below)', async () => {
    const r = rig({ reply: ledger(() => subject) });
    const res = await asHer(r, { decisionIds: [idOf(subject)] });
    expect(res.status).toBe(200);
    const out = await res.json() as { ok: boolean; records: Array<Record<string, unknown>>; pending: string[] };
    expect(out.ok).toBe(true);
    expect(out.records).toHaveLength(1);
    expect(out.records[0]).toMatchObject({ decision_id: idOf(subject), item_id: 'promo_x' });
    expect(out.records[0]).not.toHaveProperty('visitor_id');
    expect(out.records[0]).not.toHaveProperty('inputs');
    expect(r.calls.map((c) => `${c.method} ${new URL(c.url).pathname}`)).toEqual([`GET /v1/vantage/ledger/${encodeURIComponent(idOf(subject))}`]);
  });

  it('refuses an id that names another visitor before any read: nothing is dispatched', async () => {
    const r = rig({ reply: ledger((id) => (id.includes(other) ? other : subject)) });
    for (const body of [{ decisionIds: [idOf(other)] }, { decisionIds: [idOf(subject), idOf(other)] }, { decisionId: idOf(other) }]) {
      const res = await asHer(r, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(await res.json()).toMatchObject({ ok: false, error: expect.stringContaining('own decisions') });
    }
    expect(r.calls).toHaveLength(0);
  });

  it('answers 404 when the record behind her own id belongs to someone else, and shows nothing of it', async () => {
    const r = rig({ reply: ledger(() => other) });
    const res = await asHer(r, { decisionIds: [idOf(subject)] });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ ok: false, error: 'not found' });
    expect(r.calls).toHaveLength(1);
  });

  it('needs her session capability at all', async () => {
    const r = rig({ reply: ledger(() => subject) });
    const res = await r.post('/receipt', { decisionIds: [idOf(subject)] }, { 'X-Tenant': 'vantage' });
    expect(res.status).toBe(401);
    expect(r.calls).toHaveLength(0);
  });
});

describe('the asserted context on a receipt', () => {
  it('accepts only what the page can assert, in the engine’s spellings', () => {
    expect(assertedContextOf(undefined)).toBeNull();
    expect(assertedContextOf({ intent: 'byod', region: 'us-tx' })).toEqual({ intent: 'byod', region: 'US-TX' });
    expect(assertedContextOf({ 'ctx.intent': 'upgrade', 'ctx.region': 'US' })).toEqual({ intent: 'upgrade', region: 'US' });
    for (const bad of [{ intent: 'switch' }, { intent: 'new', weather: 'snow' }, { region: 'Texas' }, { region: 7 }, 'new', ['new']]) {
      expect(assertedContextOf(bad), JSON.stringify(bad)).toBeInstanceOf(Error);
    }
  });

  it('marks each value asserted and says where it came from', () => {
    const plain = { explain: { drivers: [] }, cell: { region: 'US-NC' } };
    expect(assertedOf(plain, null)).toBeNull();
    expect(assertedOf(plain, { intent: 'new', region: 'US-TX' })).toEqual({
      'ctx.intent': { value: 'new', from: 'request' }, 'ctx.region': { value: 'US-TX', from: 'request' },
    });
    // The demo profile's override records the region it used for the prior; the record wins.
    const overridden = { explain: { regional: { region: 'US-NY', asserted: true } } };
    expect(assertedOf(overridden, { intent: 'upgrade', region: 'US-TX' })).toEqual({
      'ctx.region': { value: 'US-NY', from: 'record' }, 'ctx.intent': { value: 'upgrade', from: 'request' },
    });
    // An edge-selected prior is observed, not asserted.
    expect(assertedOf({ explain: { regional: { region: 'US-NC' } } }, null)).toBeNull();
  });
});

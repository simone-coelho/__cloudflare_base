// src/demos/kit/root.test.ts — a demo worker's root and its unknown pages (lane K6): the rule and its table.
//
// The table is read from the demo configs, so a demo whose beats live under
// another path redirects there, and a second, fictional demo (kestrel, as in
// actionRoutes.test.ts) gets its root from its own config. The rule redirects
// only under the demo profile, only GET and HEAD, and only on a worker that
// provisions exactly one tenant that is a demo's: "/" always, and any other page
// a browser loads that no route owns. The API paths come from the app's route
// table, so they are tested on a small app mounted the way src/index.ts mounts
// its own (root.worker.test.ts checks the real entry's mounts). Every other
// worker serves "/" and every other path as before. The drift guards hold the
// table to what is mounted: every kit config under src/demos has a root, its
// page exists, and its routes and Top Offers' are mounted in src/index.ts with
// the tenant this file declares.
import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Hono } from 'hono';
import type { Env } from '@/types/env';
import { VANTAGE_ACTIONS } from '@/demos/vantage.config';
import { OH_ACTIONS } from '@/demos/oh.config';
import {
  DEMO_ROOTS, TOP_OFFERS_ROOT, apiPrefixes, demoRootOf, demoRootResponse, demoRoots, isApiPath, isNavigation, singleDemoRoot,
} from './root';

const REPO = resolve(__dirname, '..', '..', '..');
const read = (path: string) => readFileSync(resolve(REPO, path), 'utf8');

/** What the asset layer would serve at "/", recorded. */
function assets() {
  const calls: Request[] = [];
  return {
    calls,
    binding: { fetch: async (request: Request) => { calls.push(request); return new Response('<title>Edge Platform</title>', { status: 200, headers: { 'Content-Type': 'text/html' } }); } },
  };
}

const envOf = (tenants: string[] | null, over: Record<string, unknown> = {}) => ({
  DEPLOYMENT_PROFILE: 'demo', AUTH_MODE: 'enforced',
  ...(tenants === null ? {} : { TENANTS: JSON.stringify({ provisioned: tenants }) }),
  ...over,
}) as unknown as Env;

const get = (url: string, method = 'GET') => new Request(url, { method });
const NAV = { 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Dest': 'document', Accept: 'text/html,application/xhtml+xml' };
const nav = (url: string, method = 'GET') => new Request(url, { method, headers: NAV });

// A small app mounted the way src/index.ts mounts its own: middleware on the app itself, sub-apps under their paths
// (one with a parameter and its own middleware), and a route on the app itself.
const routeOk = () => new Response('route');
const table = (() => {
  const demoApi = new Hono(); demoApi.post('/beat', routeOk); demoApi.post('/reset', routeOk); demoApi.get('/coldstart', routeOk);
  const v1 = new Hono(); v1.use('/:tenant/*', async (_c, next) => { await next(); }); v1.get('/:tenant/decisions/snapshot', routeOk);
  const sort = new Hono(); sort.post('/', routeOk);
  const realtime = new Hono(); realtime.get('/ws', routeOk);
  const app = new Hono();
  app.use('*', async (_c, next) => { await next(); });
  app.use('/realtime/*', async (_c, next) => { await next(); });
  app.route('/vantage/api', demoApi);
  app.route('/v1', v1);
  app.route('/sort', sort);
  app.route('/realtime', realtime);
  app.get('/api-info', routeOk);
  return app.routes;
})();

describe('a demo root from its config', () => {
  it('is the first segment of the asset path the config declares', () => {
    expect(demoRootOf(VANTAGE_ACTIONS.beatsPath)).toBe('/vantage/');
    expect(demoRootOf(OH_ACTIONS.beatsPath)).toBe('/oh/');
    expect(demoRootOf('/kestrel/kit/beats')).toBe('/kestrel/');
    expect(demoRootOf('/kestrel')).toBe('/kestrel/');
  });

  it('refuses a path that is not an absolute asset path', () => {
    for (const bad of ['vantage/beats', '', '/', '//beats', '/../beats', '/-x/beats', undefined as unknown as string]) {
      expect(() => demoRootOf(bad), String(bad)).toThrow(/not an absolute asset path/);
    }
  });

  it('builds a checked table: a tenant id, a one-segment root, neither claimed twice', () => {
    expect(demoRoots([{ tenant: 'kestrel', root: '/kestrel/' }])).toEqual({ kestrel: '/kestrel/' });
    expect(() => demoRoots([{ tenant: 'Kestrel!', root: '/kestrel/' }])).toThrow(/not a tenant id/);
    expect(() => demoRoots([{ tenant: 'kestrel', root: '/kestrel' }])).toThrow(/not a path/);
    expect(() => demoRoots([{ tenant: 'kestrel', root: '/kestrel/kit/' }])).toThrow(/not a path/);
    expect(() => demoRoots([{ tenant: 'kestrel', root: 'https://elsewhere.example/' }])).toThrow(/not a path/);
    expect(() => demoRoots([{ tenant: 'kestrel', root: '/kestrel/' }, { tenant: 'kestrel', root: '/k2/' }])).toThrow(/declared twice/);
    expect(() => demoRoots([{ tenant: 'kestrel', root: '/kestrel/' }, { tenant: 'heron', root: '/kestrel/' }])).toThrow(/two tenants/);
    expect(Object.isFrozen(DEMO_ROOTS)).toBe(true);
  });

  it('names Vantage and OH from their configs and Top Offers beside them', () => {
    expect({ ...DEMO_ROOTS }).toEqual({
      [VANTAGE_ACTIONS.tenant]: demoRootOf(VANTAGE_ACTIONS.beatsPath),
      [OH_ACTIONS.tenant]: demoRootOf(OH_ACTIONS.beatsPath),
      [TOP_OFFERS_ROOT.tenant]: TOP_OFFERS_ROOT.root,
    });
    expect({ ...DEMO_ROOTS }).toEqual({ vantage: '/vantage/', oh: '/oh/', shn: '/top-offers/' });
  });
});

describe('the table against what is mounted (drift guards)', () => {
  const index = read('src/index.ts');

  it('every kit demo config under src/demos has its root, its page and its mounted routes', async () => {
    const files = readdirSync(resolve(REPO, 'src', 'demos')).filter((f) => f.endsWith('.config.ts'));
    expect(files.length).toBeGreaterThanOrEqual(2);
    const found: string[] = [];
    for (const file of files) {
      const mod = await import(resolve(REPO, 'src', 'demos', file)) as Record<string, unknown>;
      for (const value of Object.values(mod)) {
        const c = value as { tenant?: unknown; beatsPath?: unknown; beats?: unknown };
        if (!c || typeof c !== 'object' || typeof c.tenant !== 'string' || typeof c.beatsPath !== 'string' || !c.beats) continue;
        const root = demoRootOf(c.beatsPath);
        found.push(c.tenant);
        expect(DEMO_ROOTS[c.tenant], `${file}: ${c.tenant}`).toBe(root);
        expect(existsSync(resolve(REPO, 'public', root.slice(1, -1), 'index.html')), `public${root}index.html`).toBe(true);
        expect(index, `src/index.ts mounts ${root}api`).toContain(`app.route('${root}api',`);
      }
    }
    // The scan finds the configs it must; a new one fails above until its root is in DEMO_ROOTS.
    expect(found).toEqual(expect.arrayContaining(['oh', 'vantage']));
  });

  it("Top Offers' declared tenant is the one its route uses, and its page and routes are there", () => {
    expect(read('src/routes/topOffers.ts')).toMatch(new RegExp(`^const TENANT = '${TOP_OFFERS_ROOT.tenant}';$`, 'm'));
    expect(index).toContain(`app.route('${TOP_OFFERS_ROOT.root}api',`);
    expect(existsSync(resolve(REPO, 'public', 'top-offers', 'index.html'))).toBe(true);
  });
});

describe('the one demo a worker serves', () => {
  it('is its tenant when it provisions exactly one, and that one a demo', () => {
    expect(singleDemoRoot(envOf(['vantage']))).toBe('/vantage/');
    expect(singleDemoRoot(envOf(['oh']))).toBe('/oh/');
    expect(singleDemoRoot(envOf(['shn']))).toBe('/top-offers/');
    expect(singleDemoRoot(envOf(['vantage', 'vantage']))).toBe('/vantage/'); // the manifest's own de-duplication
  });

  it('is none on a worker that provisions several tenants, or none that is a demo', () => {
    expect(singleDemoRoot(envOf(['vantage', 'oh']))).toBeNull();
    expect(singleDemoRoot(envOf(['vantage', 'coach']))).toBeNull();
    expect(singleDemoRoot(envOf(['coach', 'shn', 'holdout-proof', 'vantage']))).toBeNull();
    expect(singleDemoRoot(envOf(['acme']))).toBeNull();
    expect(singleDemoRoot(envOf(null))).toBeNull(); // TENANTS absent: the implicit default tenant
    expect(singleDemoRoot(envOf(null, { TENANTS: 'not json' }))).toBeNull();
    expect(singleDemoRoot(envOf(null, { TENANTS: JSON.stringify({ provisioned: [] }) }))).toBeNull();
  });

  it('is none off the demo profile', () => {
    expect(singleDemoRoot(envOf(['vantage'], { DEPLOYMENT_PROFILE: 'customer' }))).toBeNull();
    expect(singleDemoRoot(envOf(['vantage'], { DEPLOYMENT_PROFILE: undefined }))).toBeNull();
    expect(singleDemoRoot(envOf(['vantage'], { DEPLOYMENT_PROFILE: 'Demo' }))).toBeNull();
  });

  it('reads any table it is given, so a new demo needs only its config', () => {
    const kestrel = demoRoots([{ tenant: 'kestrel', root: demoRootOf('/kestrel/kit/beats') }]);
    expect(singleDemoRoot(envOf(['kestrel']), kestrel)).toBe('/kestrel/');
    expect(singleDemoRoot(envOf(['vantage']), kestrel)).toBeNull();
  });
});

describe('the API paths, derived from the route table', () => {
  it("are each sub-app's mount path, each route on the app itself, and the Agents SDK's prefix", () => {
    expect(apiPrefixes(table)).toEqual(['/agents', '/api-info', '/realtime', '/sort', '/v1', '/vantage/api']);
    expect(apiPrefixes(table)).toBe(apiPrefixes(table)); // derived once per table
  });

  it('take a route\'s static part and never "/": middleware on the app is not a mount, and a root route owns nothing', () => {
    const app = new Hono();
    app.use('*', async (_c, next) => { await next(); });
    app.get('/', routeOk);
    app.get('/files/:name', routeOk);
    app.all('/hook', routeOk);
    expect(apiPrefixes(app.routes)).toEqual(['/agents', '/files', '/hook']);
  });

  it('match a prefix itself or below it, never a longer name', () => {
    const prefixes = apiPrefixes(table);
    for (const path of ['/v1', '/v1/vantage/x', '/vantage/api', '/vantage/api/nope', '/sort', '/api-info', '/agents/opal', '/realtime/ws']) {
      expect(isApiPath(path, prefixes), path).toBe(true);
    }
    for (const path of ['/v1x', '/vantage/', '/vantage/apix', '/vantage/phone/galaxy-s26', '/sorted', '/api-info.html', '/no-such-page']) {
      expect(isApiPath(path, prefixes), path).toBe(false);
    }
  });

  it('take a navigation from fetch metadata, or, without it, from a request for HTML', () => {
    expect(isNavigation(new Request('https://x.example/a', { headers: { 'Sec-Fetch-Mode': 'navigate' } }))).toBe(true);
    expect(isNavigation(new Request('https://x.example/a', { headers: { 'Sec-Fetch-Mode': 'cors', Accept: 'text/html' } }))).toBe(false);
    expect(isNavigation(new Request('https://x.example/a', { headers: { 'Sec-Fetch-Mode': 'no-cors' } }))).toBe(false);
    expect(isNavigation(new Request('https://x.example/a', { headers: { Accept: 'text/html,application/xhtml+xml' } }))).toBe(true);
    expect(isNavigation(new Request('https://x.example/a', { headers: { Accept: '*/*' } }))).toBe(false);
    expect(isNavigation(new Request('https://x.example/a'))).toBe(false);
  });
});

describe('the answer for "/"', () => {
  it('is a 302 to the demo root on a one-demo worker, query kept, no body, not cached', async () => {
    for (const [tenant, root] of [['vantage', '/vantage/'], ['oh', '/oh/'], ['shn', '/top-offers/']] as const) {
      const a = assets();
      const res = await demoRootResponse(get('https://edge-platform-x.example/'), envOf([tenant], { ASSETS: a.binding }), table);
      expect(res?.status, tenant).toBe(302);
      expect(res?.headers.get('Location')).toBe(`https://edge-platform-x.example${root}`);
      expect(res?.headers.get('Cache-Control')).toBe('no-store');
      expect(await res?.text()).toBe('');
      expect(a.calls).toHaveLength(0);
    }
    const flagged = await demoRootResponse(get('https://edge-platform-x.example/?wait=45&debug'), envOf(['vantage']), table);
    expect(flagged?.headers.get('Location')).toBe('https://edge-platform-x.example/vantage/?wait=45&debug');
    const head = await demoRootResponse(get('https://edge-platform-x.example/', 'HEAD'), envOf(['oh']), table);
    expect(head?.status).toBe(302);
    expect(head?.headers.get('Location')).toBe('https://edge-platform-x.example/oh/');
  });

  it('stays on the request origin whatever the path spelling', async () => {
    const res = await demoRootResponse(get('http://localhost:9138'), envOf(['vantage']), table);
    expect(res?.headers.get('Location')).toBe('http://localhost:9138/vantage/');
  });

  it('is the root page as before on a worker with several tenants or none a demo', async () => {
    for (const tenants of [['vantage', 'oh'], ['vantage', 'coach'], ['acme'], null]) {
      const a = assets();
      const request = get('https://edge-platform-x.example/');
      const res = await demoRootResponse(request, envOf(tenants, { ASSETS: a.binding }), table);
      expect(res?.status, String(tenants)).toBe(200);
      expect(await res?.text()).toBe('<title>Edge Platform</title>');
      expect(a.calls).toEqual([request]);
    }
    // Without an assets binding there is nothing to serve here: the worker's ordinary path answers.
    expect(demoRootResponse(get('https://edge-platform-x.example/'), envOf(['vantage', 'oh']), table)).toBeNull();
  });

  it('is nothing under the customer profile, which keeps its own answers', async () => {
    const a = assets();
    for (const over of [{ DEPLOYMENT_PROFILE: 'customer' }, { DEPLOYMENT_PROFILE: undefined }, { DEPLOYMENT_PROFILE: 'staging' }]) {
      for (const tenants of [['vantage'], ['vantage', 'oh']]) {
        expect(demoRootResponse(get('https://acme.example/'), envOf(tenants, { ASSETS: a.binding, ...over }), table), JSON.stringify(over)).toBeNull();
        expect(demoRootResponse(nav('https://acme.example/no-such-page'), envOf(tenants, { ASSETS: a.binding, ...over }), table), JSON.stringify(over)).toBeNull();
      }
    }
    expect(a.calls).toHaveLength(0);
  });
});

describe('the answer for an unknown page', () => {
  it('is the same 302 for a browser loading any page no route owns, on a one-demo worker', async () => {
    const a = assets();
    for (const path of ['/no-such-page', '/vantage/phone/galaxy-s26', '/vantage/nope.html', '/oh/', '/index.htm', '/favicon.ico', '/vantage/apix']) {
      for (const method of ['GET', 'HEAD']) {
        const res = await demoRootResponse(nav(`https://edge-platform-x.example${path}`, method), envOf(['vantage'], { ASSETS: a.binding }), table);
        expect(res?.status, `${method} ${path}`).toBe(302);
        expect(res?.headers.get('Location'), path).toBe('https://edge-platform-x.example/vantage/');
        expect(res?.headers.get('Cache-Control')).toBe('no-store');
      }
    }
    const kept = await demoRootResponse(nav('https://edge-platform-x.example/vantage/phone/galaxy-s26?wait=45'), envOf(['vantage']), table);
    expect(kept?.headers.get('Location')).toBe('https://edge-platform-x.example/vantage/?wait=45');
    // A browser that sends no fetch metadata asks for HTML.
    const old = await demoRootResponse(new Request('https://edge-platform-x.example/nope', { headers: { Accept: 'text/html' } }), envOf(['oh']), table);
    expect(old?.headers.get('Location')).toBe('https://edge-platform-x.example/oh/');
    expect(a.calls).toHaveLength(0);
  });

  it('leaves an API path its own answer, even as a navigation', () => {
    for (const path of ['/v1', '/v1/vantage/nope', '/vantage/api', '/vantage/api/nope', '/sort', '/api-info', '/agents/opal-agent/x', '/realtime/nope']) {
      expect(demoRootResponse(nav(`https://edge-platform-x.example${path}`), envOf(['vantage']), table), path).toBeNull();
    }
  });

  it("leaves a script's fetch of a missing file its 4xx: a 302 to a page would read as served", () => {
    const fetches: Record<string, string>[] = [{}, { Accept: '*/*' }, { 'Sec-Fetch-Mode': 'cors', Accept: 'application/json' }, { 'Sec-Fetch-Mode': 'no-cors', Accept: 'text/html' }];
    for (const headers of fetches) {
      for (const path of ['/vantage/beats/operator.local.json', '/vantage/beats/token.json', '/no-such-page']) {
        expect(demoRootResponse(new Request(`https://edge-platform-x.example${path}`, { headers }), envOf(['vantage']), table), `${path} ${JSON.stringify(headers)}`).toBeNull();
      }
    }
  });

  it("never redirects the demo's own page to itself, which reaches the worker only when it is missing", () => {
    for (const path of ['/vantage/', '/vantage']) {
      expect(demoRootResponse(nav(`https://edge-platform-x.example${path}`), envOf(['vantage']), table), path).toBeNull();
    }
  });

  it("is the app's answer as before on a worker with several tenants or none a demo", () => {
    const a = assets();
    for (const tenants of [['vantage', 'oh'], ['vantage', 'coach'], ['acme'], null]) {
      expect(demoRootResponse(nav('https://edge-platform-x.example/no-such-page'), envOf(tenants, { ASSETS: a.binding }), table), String(tenants)).toBeNull();
    }
    expect(a.calls).toHaveLength(0);
  });

  it("reads no environment for another method, an API path or a script's fetch", () => {
    const reads: string[] = [];
    const env = new Proxy(envOf(['vantage'], { ASSETS: assets().binding }) as unknown as Record<string, unknown>, {
      get(target, key, receiver) { reads.push(String(key)); return Reflect.get(target, key, receiver); },
      has(target, key) { reads.push(`has:${String(key)}`); return Reflect.has(target, key); },
    }) as unknown as Env;
    for (const path of ['/vantage/', '/index.html', '/api-info', '/oh/', '//', '/%2F', '/vantage/api/reset', '/cdp/track', '/health', '/no-such-page']) {
      expect(demoRootResponse(get(`https://edge-platform-x.example${path}`), env, table), path).toBeNull();
    }
    for (const path of ['/v1/vantage/x', '/vantage/api/reset', '/sort', '/agents/x']) {
      expect(demoRootResponse(nav(`https://edge-platform-x.example${path}`), env, table), path).toBeNull();
    }
    for (const method of ['POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH']) {
      expect(demoRootResponse(nav('https://edge-platform-x.example/', method), env, table), method).toBeNull();
      expect(demoRootResponse(nav('https://edge-platform-x.example/no-such-page', method), env, table), method).toBeNull();
    }
    // The entry's pre-dispatch reads are pinned (src/index.api-boundary.test.ts): these pass here unread.
    expect(reads).toEqual([]);
    expect(demoRootResponse(nav('https://edge-platform-x.example/no-such-page'), env, table)).not.toBeNull();
    expect(reads.length).toBeGreaterThan(0);
  });
});

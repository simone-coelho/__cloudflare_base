// src/demos/kit/root.worker.test.ts — each demo worker's "/" and unknown pages, through the worker's own entry (lane K6).
//
// The route tests (src/routes/vantage.test.ts, oh.test.ts) exercise the route
// factories; the root and an unknown page are answered by the worker entry, so
// this file calls src/index.ts's default fetch with each demo worker's own [vars]
// (read from wrangler.vantage.toml, wrangler.oh.toml and wrangler.top-offers.toml)
// and the TENANTS its hosted worker carries: its own tenant alone
// (scripts/demo-kit/lib/host.mjs; docs/qvc/RESUME-top-offers.md). The assets
// binding is a recorder standing in for public/index.html. The API paths are
// every path src/index.ts mounts, read from its source here and checked to keep
// their own answers, so the helper's derivation from the route table is held to
// what is mounted.
//
// Three packages the entry imports need the Workers runtime to load and are not
// on these paths: the Agents SDK router runs only when AUTH_MODE is not
// 'enforced' (every demo worker config is enforced, checked below), the chat
// agent class is only a Durable Object export, and the browser binding's
// client only serves /__shot. They are stubbed so the entry loads under Node.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Env } from '@/types/env';

vi.mock('agents', () => ({ routeAgentRequest: async () => { throw new Error('the Agents router is not on these paths'); } }));
vi.mock('agents/ai-chat-agent', () => ({ AIChatAgent: class {} }));
vi.mock('@cloudflare/puppeteer', () => ({ default: {} }));

const REPO = resolve(__dirname, '..', '..', '..');
/** A browser loading a page. */
const NAV = { 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Dest': 'document', Accept: 'text/html,application/xhtml+xml' };
const ctx = { waitUntil: () => undefined, passThroughOnException: () => undefined } as unknown as ExecutionContext;

/** One [vars] table of a wrangler config: KEY = "basic" or 'literal' strings, which is all these files hold. */
function varsOf(file: string, table = 'vars'): Record<string, string> {
  const text = readFileSync(resolve(REPO, file), 'utf8');
  const start = text.indexOf(`\n[${table}]\n`);
  if (start < 0) throw new Error(`${file} has no [${table}]`);
  const body = text.slice(start + table.length + 4).split(/\n\[/)[0]!;
  const out: Record<string, string> = {};
  for (const line of body.split('\n')) {
    const m = /^([A-Z][A-Z0-9_]*)\s*=\s*("(?:[^"\\]|\\.)*"|'[^']*')\s*$/.exec(line.trim());
    if (m) out[m[1]!] = m[2]!.startsWith('"') ? JSON.parse(m[2]!) as string : m[2]!.slice(1, -1);
  }
  return out;
}

/** What the asset layer serves at "/" (public/index.html, the legacy dashboard), recorded. */
function assets() {
  const calls: string[] = [];
  return {
    calls,
    binding: { fetch: async (request: Request) => { calls.push(new URL(request.url).pathname); return new Response('<title>Edge Platform</title>', { status: 200, headers: { 'Content-Type': 'text/html' } }); } },
  };
}

const WORKERS = [
  { config: 'wrangler.vantage.toml', host: 'edge-platform-vantage.expedge.workers.dev', tenant: 'vantage', root: '/vantage/' },
  { config: 'wrangler.oh.toml', host: 'edge-platform-oh.expedge.workers.dev', tenant: 'oh', root: '/oh/' },
  { config: 'wrangler.top-offers.toml', host: 'edge-platform-top-offers.expedge.workers.dev', tenant: 'shn', root: '/top-offers/' },
] as const;

type Worker = { fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> };
let worker: Worker;
beforeAll(async () => { worker = (await import('@/index')).default as unknown as Worker; }, 120_000);

const envFor = (config: string, tenants: string[] | null, binding: unknown, table = 'vars') => ({
  ...varsOf(config, table),
  ...(tenants === null ? {} : { TENANTS: JSON.stringify({ provisioned: tenants }) }),
  ASSETS: binding,
}) as unknown as Env;

describe.each(WORKERS)('the root of $config', ({ config, host, tenant, root }) => {
  it('is the demo profile, enforced', () => {
    expect(varsOf(config)).toMatchObject({ DEPLOYMENT_PROFILE: 'demo', AUTH_MODE: 'enforced' });
  });

  it(`redirects "/" to ${root} under the demo profile with its one tenant`, async () => {
    const a = assets();
    for (const method of ['GET', 'HEAD']) {
      const res = await worker.fetch(new Request(`https://${host}/`, { method, headers: { 'Sec-Fetch-Mode': 'navigate' } }), envFor(config, [tenant], a.binding), ctx);
      expect(res.status, method).toBe(302);
      expect(res.headers.get('Location')).toBe(`https://${host}${root}`);
      expect(res.headers.get('Cache-Control')).toBe('no-store');
    }
    const flagged = await worker.fetch(new Request(`https://${host}/?wait=45`), envFor(config, [tenant], a.binding), ctx);
    expect(flagged.headers.get('Location')).toBe(`https://${host}${root}?wait=45`);
    expect(a.calls).toEqual([]);
  });

  it('serves the root page as before with two tenants', async () => {
    const other = tenant === 'oh' ? 'vantage' : 'oh';
    for (const tenants of [[tenant, other], [tenant, 'coach'], ['coach', 'shn', 'holdout-proof', 'vantage']]) {
      const a = assets();
      const res = await worker.fetch(new Request(`https://${host}/`), envFor(config, tenants, a.binding), ctx);
      expect(res.status, tenants.join(',')).toBe(200);
      expect(res.headers.get('Location')).toBeNull();
      expect(await res.text()).toBe('<title>Edge Platform</title>');
      expect(a.calls).toEqual(['/']);
    }
  });

  it('does not redirect under the customer profile', async () => {
    // The customer stamp's own vars (wrangler.toml [env.staging.vars]); its boundary answers "/" itself, with the console.
    const a = assets();
    const env = { ...envFor('wrangler.toml', [tenant], a.binding, 'env.staging.vars') } as unknown as Env;
    expect(env.DEPLOYMENT_PROFILE).toBe('customer');
    const res = await worker.fetch(new Request(`https://${host}/`), env, ctx);
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe(`https://${host}/console/`);
    expect(a.calls).toEqual([]);
    // And an unknown page keeps the customer boundary's own 404.
    const page = await worker.fetch(new Request(`https://${host}/no-such-page`, { headers: NAV }), env, ctx);
    expect(page.status).toBe(404);
    expect(a.calls).toEqual([]);
  });

  it('routes "/" to the worker first and leaves an unmatched request to it (the builder\'s [assets])', () => {
    const assetsTable = /\n\[assets\]\n([\s\S]*?)(?:\n\[|$)/.exec(readFileSync(resolve(REPO, config), 'utf8'))?.[1] ?? '';
    expect(assetsTable).toMatch(/^run_worker_first = \[ "\/" \]$/m);
    expect(assetsTable).toMatch(/^not_found_handling = "none"$/m);
  });
});

/** Every path src/index.ts mounts on its app, read from its source: the API paths the helper must derive, never type. */
const MOUNTS = [...readFileSync(resolve(REPO, 'src', 'index.ts'), 'utf8').matchAll(/^app\.(?:route|get|post|put|patch|delete|all|on)\('([^']+)'/gm)].map((m) => m[1]!);

/** status and body: what a caller sees (X-Request-Id differs per request by design). */
const seen = async (res: Response) => `${res.status} ${res.headers.get('Location') ?? ''} ${await res.text()}`;

describe.each(WORKERS)('an unknown page on $config', ({ config, host, tenant, root }) => {
  it(`redirects a browser to ${root}, so a visitor never sees "Tenant unavailable" or the dashboard`, async () => {
    const a = assets();
    for (const path of ['/no-such-page', `${root}nope`, '/vantage/phone/galaxy-s26', '/index.htm']) {
      for (const method of ['GET', 'HEAD']) {
        const res = await worker.fetch(new Request(`https://${host}${path}`, { method, headers: NAV }), envFor(config, [tenant], a.binding), ctx);
        expect(res.status, `${method} ${path}`).toBe(302);
        expect(res.headers.get('Location'), path).toBe(`https://${host}${root}`);
      }
    }
    expect(a.calls).toEqual([]);
  });

  it("leaves a script's fetch of a missing file the worker's own answer, as before", async () => {
    const res = await worker.fetch(new Request(`https://${host}${root}beats/operator.local.json`), envFor(config, [tenant], assets().binding), ctx);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: 'Tenant unavailable' });
  });

  it('leaves every API path src/index.ts mounts its own answer exactly, navigation or not', async () => {
    expect(MOUNTS).toEqual(expect.arrayContaining(['/v1', '/realtime', '/sort', '/api-info', `${root}api`, '/vantage/api', '/oh/api', '/top-offers/api']));
    for (const mount of [...MOUNTS, '/agents', '/api']) {
      for (const path of [mount, `${mount}/k6-unknown`]) {
        const asNavigation = await worker.fetch(new Request(`https://${host}${path}`, { headers: NAV }), envFor(config, [tenant], assets().binding), ctx);
        const asFetch = await worker.fetch(new Request(`https://${host}${path}`), envFor(config, [tenant], assets().binding), ctx);
        expect(asNavigation.status, path).not.toBe(302);
        expect(await seen(asNavigation), path).toBe(await seen(asFetch));
      }
    }
  });

  it("is the app's answer as before with two tenants", async () => {
    for (const tenants of [[tenant, tenant === 'oh' ? 'vantage' : 'oh'], ['coach', 'shn', 'holdout-proof', 'vantage']]) {
      const asNavigation = await worker.fetch(new Request(`https://${host}/no-such-page`, { headers: NAV }), envFor(config, tenants, assets().binding), ctx);
      const asFetch = await worker.fetch(new Request(`https://${host}/no-such-page`), envFor(config, tenants, assets().binding), ctx);
      expect(asNavigation.status, tenants.join(',')).not.toBe(302);
      expect(await seen(asNavigation)).toBe(await seen(asFetch));
    }
  });
});

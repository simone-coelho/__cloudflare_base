// src/demos/kit/root.ts
// ──────────────────────────────────────────────────────
// A demo worker's root path (docs/demo-kit/Demo-Kit-Design.md, decision K6).
//
// Every demo worker serves public/ wholesale, so its "/" was the repository's
// legacy dashboard (public/index.html, a WebSocket status page that reads
// "Disconnected"), and an unknown page was that dashboard too, or the worker's
// "Tenant unavailable", while the demo itself lives at /vantage/, /oh/ or
// /top-offers/. The rule, in this one place:
//
//   • Under DEPLOYMENT_PROFILE=demo, a worker that provisions exactly one
//     tenant, and that tenant a demo's, answers GET and HEAD "/" with a 302 to
//     that demo's root (the query string kept, so "/?wait=45" lands on
//     "/vantage/?wait=45").
//   • The same worker answers a browser loading any other page that no route
//     owns (a GET or HEAD navigation whose path is not an API path) with the
//     same 302, so a visitor never sees "Tenant unavailable" or the dashboard.
//     An API path keeps its own answer exactly: it is a path under anything
//     src/index.ts mounts, derived from the app's own route table (each
//     sub-app's mount path, each route on the app itself) and the Agents SDK's
//     prefix, never typed here. A script's fetch of a missing file is not a
//     navigation and keeps its 4xx: a 302 to a page would read as "served".
//   • A demo worker that provisions several tenants, or one that is no demo's
//     (TENANTS absent means the implicit default tenant), serves "/" exactly as
//     before (the same file, through the worker's own ASSETS binding) and every
//     other path as before.
//   • The customer profile never reaches this (src/index.ts answers it first),
//     and this answers null for it anyway.
//
// Each demo's root is read from the path its config declares (the first
// segment of its beats path: /vantage/beats → /vantage/). Top Offers predates
// the kit and keeps its tenant private to src/routes/topOffers.ts, so its
// tenant and root are declared here, beside the others. A new demo adds its
// line to DEMO_ROOTS; scripts/demo-kit/lib/scaffold.mjs prints it.
//
// The worker sees "/" and an unknown page only because the demo workers'
// configs route "/" to it first and leave unmatched requests to it
// ([assets] run_worker_first = ["/"], not_found_handling = "none", written by
// scripts/build-demo-worker-config.mjs).
// ──────────────────────────────────────────────────────

import { getPath } from 'hono/utils/url';
import type { Env } from '@/types/env';
import { deploymentProfile } from '@/customerBoundary';
import { tenantConfig } from '@/tenancy/middleware';
import { isValidTenantId } from '@/tenancy/tenant';
import { VANTAGE_ACTIONS } from '@/demos/vantage.config';
import { OH_ACTIONS } from '@/demos/oh.config';

/** One demo's tenant and the path its page lives at. */
export interface DemoRoot {
  tenant: string;
  /** An absolute path of one plain segment with its trailing slash: `/vantage/`. */
  root: string;
}

/** Top Offers' tenant (`TENANT` in src/routes/topOffers.ts, which keeps it private) and its page. */
export const TOP_OFFERS_ROOT: Readonly<DemoRoot> = Object.freeze({ tenant: 'shn', root: '/top-offers/' });

const SEGMENT = /^\/([A-Za-z0-9][A-Za-z0-9_-]*)(?:\/|$)/;
const ROOT = /^\/[A-Za-z0-9][A-Za-z0-9_-]*\/$/;

/** A demo's root from an absolute asset path its config declares: its first segment, `/vantage/beats` → `/vantage/`. */
export function demoRootOf(assetPath: string): string {
  const m = typeof assetPath === 'string' ? SEGMENT.exec(assetPath) : null;
  if (!m) throw new Error(`demo root: "${String(assetPath)}" is not an absolute asset path such as /vantage/beats`);
  return `/${m[1]}/`;
}

/** tenant → root, checked: a valid tenant id, a one-segment root, and no tenant or root claimed twice. */
export function demoRoots(entries: readonly DemoRoot[]): Readonly<Record<string, string>> {
  const out: Record<string, string> = Object.create(null);
  const roots = new Set<string>();
  for (const { tenant, root } of entries) {
    if (!isValidTenantId(tenant)) throw new Error(`demo root: "${String(tenant)}" is not a tenant id`);
    if (typeof root !== 'string' || !ROOT.test(root)) throw new Error(`demo root: "${String(root)}" for ${tenant} is not a path such as /vantage/`);
    if (Object.hasOwn(out, tenant)) throw new Error(`demo root: the tenant ${tenant} is declared twice`);
    if (roots.has(root)) throw new Error(`demo root: ${root} is declared for two tenants`);
    out[tenant] = root;
    roots.add(root);
  }
  return Object.freeze(out);
}

/** Every demo with a worker of its own: the kit's demos from their configs, and Top Offers. */
export const DEMO_ROOTS: Readonly<Record<string, string>> = demoRoots([
  { tenant: VANTAGE_ACTIONS.tenant, root: demoRootOf(VANTAGE_ACTIONS.beatsPath) },
  { tenant: OH_ACTIONS.tenant, root: demoRootOf(OH_ACTIONS.beatsPath) },
  TOP_OFFERS_ROOT,
]);

type RootEnv = Pick<Env, 'DEPLOYMENT_PROFILE' | 'AUTH_MODE' | 'TENANTS'>;

/** The root of the one demo this worker serves, or null: not the demo profile, several tenants, none a demo's, or an unreadable TENANTS. */
export function singleDemoRoot(env: RootEnv, roots: Readonly<Record<string, string>> = DEMO_ROOTS): string | null {
  if (deploymentProfile(env as Env) !== 'demo') return null;
  let provisioned: readonly string[];
  try { provisioned = tenantConfig(env).provisioned; } catch { return null; }
  if (provisioned.length !== 1) return null;
  const [tenant] = provisioned;
  return tenant !== undefined && Object.hasOwn(roots, tenant) ? roots[tenant]! : null;
}

// ── API paths: what src/index.ts mounts ─────────────────────────────────────

/** A route as Hono records it in `app.routes`: its method, its full path, and the path it was mounted under. */
export interface MountedRoute {
  method: string;
  path: string;
  basePath?: string;
}

/**
 * The one prefix src/index.ts routes outside the app: `routeAgentRequest` (the Agents SDK) answers /agents/* before
 * the app sees a request, so the app's route table cannot name it.
 */
export const AGENTS_PREFIX = '/agents';

/** A route path's static part: its segments up to the first parameter or wildcard (`/v1/:tenant/x` → `/v1`). */
function staticPart(path: string): string {
  const out: string[] = [];
  for (const segment of path.split('/').filter(Boolean)) {
    if (segment.startsWith(':') || segment.includes('*')) break;
    out.push(segment);
  }
  return `/${out.join('/')}`;
}

const prefixMemo = new WeakMap<readonly MountedRoute[], { size: number; prefixes: readonly string[] }>();

/**
 * The API prefixes, from the app's route table: the mount path of every sub-app (`app.route('/vantage/api', …)`
 * records `basePath: '/vantage/api'` on each of its routes) and the static part of every route registered on the app
 * itself (`app.get('/api-info', …)`), plus the Agents SDK's. Middleware on the app itself (`app.use('*')`,
 * `app.use('/x/*')`: method ALL with a wildcard) is not a mount. "/" is never a prefix: it would own every path.
 */
export function apiPrefixes(routes: readonly MountedRoute[]): readonly string[] {
  const memo = prefixMemo.get(routes);
  if (memo && memo.size === routes.length) return memo.prefixes;
  const found = new Set<string>([AGENTS_PREFIX]);
  for (const r of routes) {
    const base = typeof r.basePath === 'string' ? r.basePath : '/';
    let prefix: string;
    if (base !== '/') prefix = staticPart(base);
    else if (r.method === 'ALL' && r.path.includes('*')) continue;
    else prefix = staticPart(r.path);
    if (prefix !== '/') found.add(prefix);
  }
  const prefixes = Object.freeze([...found].sort());
  prefixMemo.set(routes, { size: routes.length, prefixes });
  return prefixes;
}

/** Whether a decoded path is a prefix itself or under one. */
export const isApiPath = (path: string, prefixes: readonly string[]): boolean =>
  prefixes.some((p) => path === p || path.startsWith(`${p}/`));

/** A browser loading a page: fetch metadata says so, or, from a client that sends none, it asks for HTML. */
export function isNavigation(request: Request): boolean {
  const mode = request.headers.get('Sec-Fetch-Mode');
  if (mode !== null) return mode.toLowerCase() === 'navigate';
  return (request.headers.get('Accept') ?? '').toLowerCase().includes('text/html');
}

/**
 * The worker's answer for "/" and for an unknown page under the demo profile, or null for every other request,
 * which then takes the worker's ordinary path.
 *
 *   GET or HEAD "/"                               one demo: 302 to its root; otherwise the root page through ASSETS
 *   a GET or HEAD navigation, not an API path     one demo: 302 to its root; otherwise null (the app answers, as before)
 *   anything else                                 null, without reading the environment
 *
 * `routes` is the app's route table (`app.routes`), from which the API paths are derived. The method, the path and
 * the headers are read first, so an API request, a script's fetch and every other method leave here without
 * reading the environment (src/index.api-boundary.test.ts pins what the entry reads before dispatch).
 */
export function demoRootResponse(request: Request, env: Env, routes: readonly MountedRoute[],
  roots: Readonly<Record<string, string>> = DEMO_ROOTS): Response | Promise<Response> | null {
  if (request.method !== 'GET' && request.method !== 'HEAD') return null;
  const path = getPath(request);
  const atRoot = path === '/';
  if (!atRoot && (!isNavigation(request) || isApiPath(path, apiPrefixes(routes)))) return null;
  if (deploymentProfile(env) !== 'demo') return null;
  const root = singleDemoRoot(env, roots);
  if (!root) return atRoot && env.ASSETS ? env.ASSETS.fetch(request) : null;
  // The demo's own page reaches the worker only when it is missing; redirecting it to itself would loop.
  if (path === root || `${path}/` === root) return null;
  const from = new URL(request.url);
  const to = new URL(root, from);
  to.search = from.search;
  return new Response(null, { status: 302, headers: { Location: to.href, 'Cache-Control': 'no-store' } });
}

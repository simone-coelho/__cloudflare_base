import type { Env } from '@/types/env';

/** A missing or misspelled profile must never select the demo deployment. */
export function deploymentProfile(env: Env): 'customer' | 'demo' | null {
  const profile = env.DEPLOYMENT_PROFILE;
  if (profile === 'demo') return profile;
  return profile === 'customer' && env.AUTH_MODE === 'enforced' ? profile : null;
}

export const CUSTOMER_OMITTED_BINDINGS = ['OpalAgent', 'MERIDIAN_REFLEX', 'BROWSER', 'STATE_MANAGER'] as const;

export function customerBindingsOmitted(env: Env): boolean {
  return CUSTOMER_OMITTED_BINDINGS.every(binding => env[binding] === undefined);
}

type CustomerRoute = { path: string; methods: readonly string[] };
const read = ['GET', 'HEAD'] as const;
const post = ['POST'] as const;

// Each entry admits an operation, not a route family. The actual handler still
// enforces its current tenant, operator or owned-shopper authority.
export const CUSTOMER_ROUTES: readonly CustomerRoute[] = [
  { path: '/health/live', methods: read },
  { path: '/health/ready', methods: read },
  { path: '/api-info', methods: read },
  { path: '/geo', methods: read },
  { path: '/auth/login', methods: post },
  { path: '/auth/oidc/start', methods: post },
  { path: '/auth/oidc/callback/:tenant', methods: ['GET'] },
  { path: '/auth/oidc/complete', methods: post },
  { path: '/auth/users/:id/federation', methods: ['GET', 'PUT', 'DELETE'] },
  { path: '/auth/refresh', methods: post },
  { path: '/auth/logout', methods: post },
  { path: '/auth/password', methods: post },
  { path: '/auth/me', methods: read },
  { path: '/auth/users', methods: [...read, 'POST'] },
  { path: '/auth/users/:id', methods: ['PATCH', 'DELETE'] },
  { path: '/auth/users/:id/reset', methods: post },
  { path: '/auth/audit', methods: read },
  { path: '/auth/authority', methods: read },
  { path: '/auth/memberships', methods: [...read, 'POST'] },
  { path: '/auth/memberships/:id', methods: ['PATCH', 'DELETE'] },
  { path: '/auth/service-credentials', methods: [...read, 'POST'] },
  { path: '/auth/service-credentials/:id', methods: ['DELETE'] },
  { path: '/operator/audiences', methods: ['GET'] },
  { path: '/operator/ledger-recovery', methods: read },
  { path: '/operator/ledger-recovery/:id', methods: read },
  { path: '/operator/ledger-recovery/:id/redrive', methods: post },
  { path: '/operator/ledger-recovery/:id/resolve', methods: post },
  { path: '/operator/audiences/publish', methods: post },
  { path: '/operator/audiences/:key/rename', methods: post },
  { path: '/operator/audiences/:key/pin', methods: post },
  { path: '/operator/audiences/:key/prune', methods: post },
  { path: '/config/reflex', methods: [...read, 'PUT', 'PATCH'] },
  { path: '/config/reflex/history', methods: read },
  { path: '/config/reflex/revisions/:n', methods: read },
  { path: '/config/reflex/validate', methods: post },
  { path: '/config/reflex/rollback/:n', methods: post },
  { path: '/content/:kind', methods: [...read, 'PUT'] },
  { path: '/content/:kind/history', methods: read },
  { path: '/content/:kind/revisions/:n', methods: read },
  { path: '/content/:kind/validate', methods: post },
  { path: '/content/:kind/rollback/:n', methods: post },
  { path: '/content/catalog/import', methods: post },
  { path: '/content/catalog/pull', methods: post },
  { path: '/content/catalog/publication', methods: read },
  { path: '/content/catalog/publication/recover', methods: post },
  { path: '/content/catalog/enrichment/proposals', methods: post },
  { path: '/content/catalog/enrichment/proposals/generate', methods: post },
  { path: '/content/catalog/enrichment/proposals/:id', methods: read },
  { path: '/content/catalog/enrichment/proposals/:id/export', methods: read },
  { path: '/content/catalog/enrichment/proposals/:id/review', methods: post },
  { path: '/content/catalog/enrichment/proposals/:id/publish', methods: post },
  { path: '/sort', methods: post },
  { path: '/sort/intent', methods: post },
  { path: '/search', methods: post },
  { path: '/realtime/ws', methods: ['GET'] },
  { path: '/realtime/action', methods: post },
  { path: '/realtime/personalization/:userId', methods: ['GET'] },
  { path: '/realtime/reflex', methods: ['GET'] },
  { path: '/realtime/session/reset', methods: post },
  { path: '/realtime/session/:sessionId/preferences', methods: post },
  { path: '/realtime/session/preferences', methods: post },
  { path: '/realtime/session/:sessionId/analytics', methods: read },
  { path: '/realtime/segments/:userId', methods: [...read, 'POST'] },
  { path: '/realtime/connections/:userId', methods: read },
  { path: '/v1/:tenant/trend', methods: read },
  { path: '/v1/:tenant/decisions/snapshot', methods: ['GET', 'POST'] },
  { path: '/v1/:tenant/identity/session', methods: post },
  { path: '/v1/:tenant/identity/link', methods: post },
  { path: '/v1/:tenant/identity/detach', methods: post },
  { path: '/v1/:tenant/identity/resolve', methods: post },
  { path: '/v1/:tenant/identity/visitor/:visitorId', methods: read },
  { path: '/v1/:tenant/identity/shopper/:shopperId', methods: read },
  { path: '/v1/:tenant/identity/events', methods: post },
  { path: '/v1/:tenant/identity/erase', methods: post },
  { path: '/v1/:tenant/audit', methods: read },
  { path: '/v1/:tenant/brands', methods: read },
  { path: '/v1/:tenant/monitor', methods: [...read, 'POST'] },
  { path: '/v1/:tenant/lift', methods: read },
  { path: '/v1/:tenant/lift/rows', methods: read },
  { path: '/v1/:tenant/lift/history', methods: read },
  { path: '/v1/:tenant/learn/slots', methods: read },
  { path: '/v1/:tenant/learn/exploring', methods: read },
  { path: '/v1/:tenant/learn/queue', methods: read },
  { path: '/v1/:tenant/learn/cycle', methods: post },
  { path: '/v1/:tenant/learn/proposals', methods: read },
  { path: '/v1/:tenant/learn/proposals/:id/:decision', methods: post },
  { path: '/v1/:tenant/learn/items/reset', methods: post },
  { path: '/v1/:tenant/learn/recovery', methods: post },
  { path: '/v1/:tenant/learn/publish', methods: post },
  { path: '/v1/:tenant/learn/report', methods: [...read, 'POST'] },
  { path: '/v1/:tenant/learn/report/window', methods: read },
  { path: '/v1/:tenant/trend/rollup', methods: post },
  { path: '/v1/:tenant/visitors/:visitorId/receipts', methods: read },
  { path: '/v1/:tenant/visitors/:visitorId/recent', methods: read },
  { path: '/v1/:tenant/ledger/batches', methods: read },
  { path: '/v1/:tenant/ledger/erasures', methods: [...read, 'POST'] },
  { path: '/v1/:tenant/ledger/erasures/rewrite', methods: post },
  { path: '/v1/:tenant/ledger/:id', methods: read },
  { path: '/v1/:tenant/replay/:id', methods: read },
];

const routes = CUSTOMER_ROUTES.map(route => ({ ...route,
  pattern: new RegExp('^' + route.path.split('/').map(part => {
    if (part === ':kind') return '(?:catalog|slots|learn|priors)';
    if (part === ':decision') return '(?:apply|reject)';
    return part.startsWith(':') ? '[^/\\\\%]+' : part;
  }).join('/') + '$'),
}));

/** No percent, empty-segment, trailing-slash or alternate HTML aliases. */
export const CUSTOMER_ASSETS: Readonly<Record<string, string>> = Object.freeze({
  '/console': '/console/index.html',
  '/console/': '/console/index.html',
  '/console/index.html': '/console/index.html',
  '/console/shell.js': '/console/shell.js',
  '/console/views.js': '/console/views.js',
  '/console/views-config.js': '/console/views-config.js',
  '/console/views-measure.js': '/console/views-measure.js',
  '/console/views-accounts.js': '/console/views-accounts.js',
  '/console/views-explore.js': '/console/views-explore.js',
  '/operator-session.js': '/operator-session.js',
  '/sdk/edge-personalization.js': '/sdk/edge-personalization.js',
  '/sdk/edge-personalization.esm.js': '/sdk/edge-personalization.esm.js',
  '/sdk/debug.js': '/sdk/debug.js',
  '/tuning.html': '/tuning.html',
  '/learning.html': '/learning.html',
});

export type CustomerRequest = { kind: 'api' } | { kind: 'asset'; path: string } | { kind: 'redirect' };

export function customerRequest(request: Request, path: string): CustomerRequest | null {
  const upgrade = request.headers.get('Upgrade');
  if (upgrade && (upgrade.toLowerCase() !== 'websocket' || request.method !== 'GET' || path !== '/realtime/ws')) return null;
  // Raw asset paths are exact: decoding must not turn a forbidden alias into an
  // allowed static resource. API matching uses the same decoded path as Hono.
  const rawPath = new URL(request.url).pathname;
  if (!upgrade && (request.method === 'GET' || request.method === 'HEAD')) {
    if (rawPath === '/') return { kind: 'redirect' };
    if (Object.hasOwn(CUSTOMER_ASSETS, rawPath)) return { kind: 'asset', path: CUSTOMER_ASSETS[rawPath]! };
  }
  const method = request.method === 'OPTIONS' ? request.headers.get('Access-Control-Request-Method') : request.method;
  if (!method || (request.method === 'OPTIONS' && upgrade)) return null;
  return routes.some(route => route.methods.includes(method) && route.pattern.test(path)) ? { kind: 'api' } : null;
}

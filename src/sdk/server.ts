// First-party server integration. This module is not a browser credential store.
// The host mounts broker() at its configured same-origin POST route and calls
// snapshot() before rendering HTML. Canonical identity/consent remain owned by
// the engine; a site cookie or account hint cannot substitute for that check.
import type { ContentDecision, DecisionSet } from './types';

export interface ServerBootstrap extends DecisionSet {
  version: 1; tenant: string; endpoint: string; pageInstance: string;
  sessionWitness: string; until: number;
}
export interface ServerBridgeConfig { tenant: string; origin: string; endpoint: string; sdkKey: string; timeoutMs?: number }
const MAX_BYTES = 2 * 1024 * 1024;
const tokenPattern = /^ss1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const slug = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
const privateHeaders = { 'Cache-Control': 'private, no-store', 'Vary': 'Cookie', 'Content-Type': 'application/json' };
export async function sessionWitness(token: string): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)))].map(v => v.toString(16).padStart(2, '0')).join('');
}
/** Safe inert JSON text, not an HTML template and never a bearer. */
export function bootstrapJSON(value: ServerBootstrap): string {
  const text = JSON.stringify(value);
  if (new TextEncoder().encode(text).byteLength > MAX_BYTES) throw new Error('Bootstrap unavailable');
  return text.replace(/[<>&\u2028\u2029]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
}
export function createServerBridge(config: ServerBridgeConfig, transport: typeof fetch = fetch) {
  const origin = new URL(config.origin), endpoint = new URL(config.endpoint);
  if (!slug.test(config.tenant) || origin.protocol !== 'https:' || origin.origin !== config.origin || endpoint.protocol !== 'https:'
    || endpoint.origin !== config.endpoint || !config.sdkKey || config.sdkKey.length > 4096) throw new Error('Server bridge configuration unavailable');
  const cookieName = `__Host-opt-shopper-${config.tenant}`;
  const timeout = Math.max(100, Math.min(5000, config.timeoutMs ?? 3000));
  function cookie(request: Request): string | undefined {
    if (new URL(request.url).origin !== origin.origin) throw new Error('Server bridge unavailable');
    const values = (request.headers.get('Cookie') ?? '').split(';').map(v => v.trim()).filter(v => v.startsWith(cookieName + '='));
    if (values.length > 1) throw new Error('Server bridge unavailable');
    if (!values.length) return undefined;
    const token = values[0]!.slice(cookieName.length + 1);
    if (token.length > 2048 || !tokenPattern.test(token)) throw new Error('Server bridge unavailable');
    return token;
  }
  async function json(response: Response, max = MAX_BYTES, signal?: AbortSignal): Promise<unknown> {
    if (!response.ok || response.status >= 300) { void response.body?.cancel(); throw new Error('Server bridge unavailable'); }
    const reader = response.body?.getReader(); if (!reader) throw new Error('Server bridge unavailable');
    const cancel = () => { void reader.cancel().catch(() => undefined); };
    signal?.addEventListener('abort', cancel, { once: true });
    let bytes = 0, text = ''; const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false });
    try { for (;;) { if (signal?.aborted) throw new Error('Server bridge unavailable'); const chunk = await reader.read();
      if (signal?.aborted) throw new Error('Server bridge unavailable'); if (chunk.done) return JSON.parse(text + decoder.decode());
      bytes += chunk.value.byteLength; if (bytes > max) throw new Error('Server bridge unavailable'); text += decoder.decode(chunk.value, { stream: true });
    } } finally { signal?.removeEventListener('abort', cancel); cancel(); }
  }
  async function bounded<T>(work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
    try { return await Promise.race([work(controller.signal), new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('Server bridge unavailable')); }, timeout); })]); }
    finally { if (timer) clearTimeout(timer); controller.abort(); }
  }
  async function resolve(request: Request, consent?: Record<string, false>) {
    const prior = cookie(request);
    const supplied = request.headers.get('X-Shopper-Session');
    if (supplied !== null && supplied !== prior) throw new Error('Server bridge unavailable');
    const value = await bounded(async signal => json(await transport(`${endpoint.origin}/v1/${config.tenant}/identity/session`, {
      method: 'POST', redirect: 'manual', signal, headers: { 'Content-Type': 'application/json', 'X-Tenant': config.tenant, 'X-SDK-Key': config.sdkKey,
        ...(prior ? { 'X-Shopper-Session': prior } : {}) }, body: JSON.stringify(consent ? { consent } : {}),
    }), 16 * 1024, signal)) as { ok?: boolean; session?: { tenant?: string; capability?: string; exp?: number; consent?: unknown } };
    const session = value?.session;
    if (value?.ok !== true || !session || session.tenant !== config.tenant || typeof session.capability !== 'string' || !tokenPattern.test(session.capability)
      || !Number.isSafeInteger(session.exp) || session.exp! * 1000 <= Date.now() || prior && prior !== session.capability) throw new Error('Server bridge unavailable');
    return { session, setCookie: `${cookieName}=${session.capability}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${Math.max(0, session.exp! - Math.floor(Date.now() / 1000))}` };
  }
  async function broker(request: Request): Promise<Response> {
    try {
      if (request.method !== 'POST' || request.headers.get('Origin') !== origin.origin
        || request.headers.get('Sec-Fetch-Site') && request.headers.get('Sec-Fetch-Site') !== 'same-origin') throw new Error();
      const body = await bounded(signal => json(new Response(request.body), 4096, signal)) as { consent?: unknown };
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(k => k !== 'consent')) throw new Error();
      const refusal: Record<string, false> = {};
      if (body.consent !== undefined) {
        if (!body.consent || typeof body.consent !== 'object' || Array.isArray(body.consent)) throw new Error();
        for (const [k, v] of Object.entries(body.consent)) { if (!['tracking', 'personalization'].includes(k) || v !== false) throw new Error(); refusal[k] = false; }
      }
      const { session, setCookie } = await resolve(request, refusal);
      return Response.json({ ok: true, session }, { headers: { ...privateHeaders, 'Set-Cookie': setCookie } });
    } catch { return Response.json({ ok: false, error: 'First-party session unavailable' }, { status: 401, headers: privateHeaders }); }
  }
  async function snapshot(request: Request, page: string): Promise<{ bootstrap: ServerBootstrap | null; headers: Headers }> {
    const headers = new Headers(privateHeaders);
    try {
      if (!/^[A-Za-z0-9_.-]{1,64}$/.test(page)) throw new Error();
      const { session, setCookie } = await resolve(request); headers.set('Set-Cookie', setCookie);
      const pageInstance = crypto.randomUUID();
      const raw = await bounded(async signal => json(await transport(`${endpoint.origin}/v1/${config.tenant}/decisions/snapshot`, {
        method: 'POST', redirect: 'manual', signal, headers: { 'Content-Type': 'application/json', 'X-Tenant': config.tenant, 'X-SDK-Key': config.sdkKey,
          'X-Shopper-Session': session.capability! }, body: JSON.stringify({ page, pageInstance }),
      }), MAX_BYTES, signal)) as DecisionSet & { ok?: boolean; tenant?: string };
      if (raw?.ok !== true || raw.tenant !== config.tenant || raw.page !== page || raw.pageInstance !== pageInstance || !Array.isArray(raw.decisions)
        || raw.decisions.length > 1000 || raw.decisions.some(d => !d || typeof d.contentId !== 'string' || typeof d.slot !== 'string' || !Number.isSafeInteger(d.order))) throw new Error();
      // No full score drivers/profile/source diagnostics in the HTML bootstrap.
      const decisions: ContentDecision[] = raw.decisions.map(d => ({ contentId: d.contentId, customerContentId: d.customerContentId, slot: d.slot,
        order: d.order, type: d.type, score: d.score, strategy: d.strategy, explain: { drivers: [] },
        ...(d.decisionId ? { decisionId: d.decisionId } : {}), ...(d.renderOffer ? { renderOffer: d.renderOffer } : {}) }));
      const bootstrap: ServerBootstrap = { version: 1, tenant: config.tenant, endpoint: endpoint.origin, page, pageInstance,
        sessionWitness: await sessionWitness(session.capability!), until: Math.min(session.exp! * 1000, Date.now() + 30_000), decisions,
        arm: raw.arm, versions: raw.versions, config_label: raw.config_label, ts: raw.ts };
      bootstrapJSON(bootstrap); return { bootstrap, headers };
    } catch { return { bootstrap: null, headers }; }
  }
  return { broker, snapshot, cookieName };
}

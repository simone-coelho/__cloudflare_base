// First-party server integration. This module is not a browser credential store.
// The host mounts broker() at its configured same-origin POST route and calls
// snapshot() before rendering HTML. Canonical identity/consent remain owned by
// the engine; a site cookie or account hint cannot substitute for that check.
import type { ContentDecision, DecisionSet } from './types';
import { CONTINUITY_OPERATION_HEADER } from './identity';

export interface ServerBootstrap extends DecisionSet {
  version: 1; tenant: string; endpoint: string; pageInstance: string;
  sessionWitness: string; until: number;
}
export interface ServerBridgeConfig { tenant: string; origin: string; endpoint: string; sdkKey: string; timeoutMs?: number }
const MAX_BYTES = 2 * 1024 * 1024;
const tokenPattern = /^ss1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
/** W16 R4: the engine's broker-mode recognition proof, its cookie, and the operation id a return is keyed by. */
const proofPattern = /^rc1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const ENGINE_CONTINUITY_COOKIE = 'opt_shopper_continuity';
const operationPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
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
  // W16 R4 (LANE-LOG R81(c)): in broker mode the engine hands its long
  // recognition proof to THIS server as its `opt_shopper_continuity` cookie. The
  // broker keeps it in the shopper's browser as its own first-party, HttpOnly,
  // tenant-scoped cookie and relays it on her return, so the proof is never
  // readable by script and never crosses to the engine's origin from the browser.
  const continuityCookieName = `__Host-opt-continuity-${config.tenant}`;
  const timeout = Math.max(100, Math.min(5000, config.timeoutMs ?? 3000));
  function named(request: Request, name: string, pattern: RegExp): string | undefined {
    const values = (request.headers.get('Cookie') ?? '').split(';').map(v => v.trim()).filter(v => v.startsWith(name + '='));
    if (values.length > 1) throw new Error('Server bridge unavailable');
    if (!values.length) return undefined;
    const token = values[0]!.slice(name.length + 1);
    if (token.length > 2048 || !pattern.test(token)) throw new Error('Server bridge unavailable');
    return token;
  }
  function cookie(request: Request): string | undefined {
    if (new URL(request.url).origin !== origin.origin) throw new Error('Server bridge unavailable');
    return named(request, cookieName, tokenPattern);
  }
  /**
   * The broker-mode proof this browser holds. Never a reason to refuse her
   * session: a malformed or duplicated value is not relayed and is cleared.
   */
  function heldProof(request: Request): { proof?: string; malformed: boolean } {
    const values = (request.headers.get('Cookie') ?? '').split(';').map(v => v.trim()).filter(v => v.startsWith(continuityCookieName + '='));
    if (!values.length) return { malformed: false };
    const proof = values[0]!.slice(continuityCookieName.length + 1);
    return values.length === 1 && proof.length <= 2048 && proofPattern.test(proof) ? { proof, malformed: false } : { malformed: true };
  }
  /** The first-party cookie the engine's successor proof is kept under, or the one that clears it. */
  function continuitySetCookie(proof: string | null, maxAge: number): string {
    return `${continuityCookieName}=${proof ?? ''}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${proof ? Math.max(0, maxAge) : 0}`;
  }
  /** The engine's own broker-mode proof cookie on its answer, read without trusting its shape. */
  function engineProof(response: Response): { proof: string; maxAge: number } | undefined {
    const headers = response.headers as Headers & { getSetCookie?: () => string[] };
    const all = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : (response.headers.get('Set-Cookie') ?? '').split(/,(?=\s*[A-Za-z0-9_.-]+=)/);
    const found = all.map(v => v.trim()).filter(v => v.startsWith(ENGINE_CONTINUITY_COOKIE + '='));
    if (found.length !== 1) return undefined;
    const [pair, ...attributes] = found[0]!.split(';');
    const proof = pair!.slice(ENGINE_CONTINUITY_COOKIE.length + 1).trim();
    const maxAge = Number(/^\s*Max-Age=(\d{1,10})\s*$/i.exec(attributes.find(a => /^\s*Max-Age=/i.test(a)) ?? '')?.[1] ?? NaN);
    return proof.length <= 2048 && proofPattern.test(proof) && Number.isSafeInteger(maxAge) && maxAge > 0 ? { proof, maxAge } : undefined;
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
  async function resolve(request: Request, consent?: Record<string, false>, operationId?: string) {
    const prior = cookie(request);
    const supplied = request.headers.get('X-Shopper-Session');
    if (supplied !== null && supplied !== prior) throw new Error('Server bridge unavailable');
    // W16 R4: a return is relayed only when the browser holds the broker's proof
    // AND the SDK named the operation it is keyed by; the engine answers the
    // exact retry of a lost answer once, from one receipt, under that id.
    const held = heldProof(request);
    const proof = operationId ? held.proof : undefined;
    const relayed = proof !== undefined && operationId !== undefined;
    let answered: Response | undefined;
    const value = await bounded(async signal => json(answered = await transport(`${endpoint.origin}/v1/${config.tenant}/identity/session`, {
      method: 'POST', redirect: 'manual', signal, headers: { 'Content-Type': 'application/json', 'X-Tenant': config.tenant, 'X-SDK-Key': config.sdkKey,
        ...(prior ? { 'X-Shopper-Session': prior } : {}), ...(relayed ? { Cookie: `${ENGINE_CONTINUITY_COOKIE}=${proof}` } : {}) },
      body: JSON.stringify({ ...(consent ? { consent } : {}), ...(relayed ? { continuity: { operationId } } : {}) }),
    }), 16 * 1024, signal)) as { ok?: boolean; session?: { tenant?: string; capability?: string; exp?: number; consent?: unknown };
      continuity?: { enabled?: unknown; reason?: unknown; mode?: unknown; purpose?: unknown; generation?: unknown; expiresAt?: unknown; revision?: unknown } };
    const session = value?.session;
    // A relayed return the engine RECOGNIZED legitimately answers another
    // session than the provisional one the browser held (W16.C6.13); nothing
    // else may swap the session this first-party cookie names.
    const recognized = relayed && value?.continuity?.enabled === true;
    if (value?.ok !== true || !session || session.tenant !== config.tenant || typeof session.capability !== 'string' || !tokenPattern.test(session.capability)
      || !Number.isSafeInteger(session.exp) || session.exp! * 1000 <= Date.now() || prior && prior !== session.capability && !recognized) throw new Error('Server bridge unavailable');
    const setCookies = [`${cookieName}=${session.capability}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${Math.max(0, session.exp! - Math.floor(Date.now() / 1000))}`];
    // The proof the engine issued or rotated is kept first-party. A relayed
    // proof the engine decided about — spent, unknown, refused — is cleared, as
    // the SDK clears a direct-mode proof; an outage (`unavailable`) keeps it for
    // the same consume on the next load, and an answer that relayed nothing
    // says nothing about the proof the browser holds.
    const successor = answered ? engineProof(answered) : undefined;
    if (successor) setCookies.push(continuitySetCookie(successor.proof, successor.maxAge));
    else if (held.malformed || relayed && value?.continuity?.enabled === false && value.continuity.reason !== 'unavailable') setCookies.push(continuitySetCookie(null, 0));
    // The engine's continuity statement, passed on WITHOUT any proof, so the SDK
    // knows a return is possible without ever holding the credential.
    const reported = value?.continuity;
    const continuity = reported && typeof reported === 'object' ? {
      enabled: reported.enabled === true,
      ...(typeof reported.reason === 'string' ? { reason: reported.reason } : {}),
      ...(typeof reported.mode === 'string' ? { mode: reported.mode } : {}),
      ...(typeof reported.purpose === 'string' ? { purpose: reported.purpose } : {}),
      ...(Number.isSafeInteger(reported.generation) ? { generation: reported.generation } : {}),
      ...(Number.isSafeInteger(reported.expiresAt) ? { expiresAt: reported.expiresAt } : {}),
      ...(Number.isSafeInteger(reported.revision) ? { revision: reported.revision } : {}),
    } : undefined;
    return { session, setCookies, continuity };
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
      const operation = request.headers.get(CONTINUITY_OPERATION_HEADER);
      if (operation !== null && !operationPattern.test(operation)) throw new Error();
      const { session, setCookies, continuity } = await resolve(request, refusal, operation ?? undefined);
      const headers = new Headers(privateHeaders);
      for (const value of setCookies) headers.append('Set-Cookie', value);
      return Response.json({ ok: true, session, ...(continuity ? { continuity } : {}) }, { headers });
    } catch { return Response.json({ ok: false, error: 'First-party session unavailable' }, { status: 401, headers: privateHeaders }); }
  }
  async function snapshot(request: Request, page: string): Promise<{ bootstrap: ServerBootstrap | null; headers: Headers }> {
    const headers = new Headers(privateHeaders);
    try {
      if (!/^[A-Za-z0-9_.-]{1,64}$/.test(page)) throw new Error();
      const { session, setCookies } = await resolve(request); for (const value of setCookies) headers.append('Set-Cookie', value);
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

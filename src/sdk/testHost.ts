// src/sdk/testHost.ts — a browser with nothing behind it, for the SDK's own tests.
import { memoryHost } from './memoryHost';
import type { DecisionSet, Host, RequestInitLike, ResponseLike, SocketLike } from './types';

export class FakeSocket implements SocketLike {
  readyState = 0;
  onopen: ((ev?: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev?: unknown) => void) | null = null;
  onerror: ((ev?: unknown) => void) | null = null;
  sent: string[] = [];
  constructor(public url: string, public protocols: string[] = []) {}
  send(data: string): void { this.sent.push(data); }
  close(): void { this.readyState = 3; this.onclose?.(); }
  open(): void { this.readyState = 1; this.onopen?.(); }
  receive(frame: unknown): void { this.onmessage?.({ data: JSON.stringify(frame) }); }
}

export interface Call { url: string; init?: RequestInitLike }

/** SDK-only wire fixture; actual route tests must obtain cryptographic offers. */
export function offeredSet<T extends DecisionSet>(set: T, pageInstance = 'synthetic-page', revision = 'original'): T {
  return { ...set, pageInstance, decisions: set.decisions.map(d => ({ ...d,
    decisionId: `${revision}-${d.slot}-${d.order}-${d.contentId}`, renderOffer: `synthetic-offer-${revision}-${d.slot}-${d.order}-${d.contentId}` })) };
}
export function renderAck(init?: RequestInitLike) {
  const body = JSON.parse(init?.body ?? '{}');
  if (body.type !== 'content_impression' || !body.data?.renderOffer) return { success: true };
  return { success: true, render: { version: 1, status: 'durable', source: 'recovered', eventId: body.eventId,
    decisionId: body.data.decisionId, pageInstance: body.data.pageInstance } };
}

let sessionSequence = 0;
/** Deterministic exclusive-lock double, also shareable by multiple synthetic tabs. */
export function authorityLocks(): NonNullable<Host['acquireAuthorityLock']> {
  const tails = new Map<string, Promise<void>>();
  return async name => {
    const previous = tails.get(name) ?? Promise.resolve();
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    tails.set(name, previous.then(() => held));
    await previous;
    return release;
  };
}
/** Explicit synthetic server response; never used by actual-router crypto tests. */
export function syntheticSession(now = 1_725_000_000_000, subject?: string, tenant = 'coach') {
  const n = (++sessionSequence).toString(16).padStart(12, '0');
  const claims = { tenant, subject: subject ?? `vis-00000000-0000-4000-8000-${n}`, sessionId: `s-00000000-0000-4000-8000-${n}`,
    kind: subject ? 'recognized' : 'anonymous', grantId: `00000000-0000-4000-8000-${n}`, authorityEpoch: `10000000-0000-4000-8000-${n}`,
    iat: Math.floor(now / 1000), exp: Math.floor(now / 1000) + 3600 };
  // Existing behavioral SDK positives represent an already-chosen server owner;
  // unknown/legacy/expiry cases explicitly replace this synthetic response.
  const choice = { value: true, chosenAt: now, expiresAt: now + 30 * 86400 * 1000 };
  return { ...claims, consent: { tracking: true, personalization: true,
    instruction: { version: 1 as const, tenant, subject: claims.subject, revision: 'synthetic-explicit', tracking: { ...choice }, personalization: { ...choice } } },
    capability: `ss1.${btoa(JSON.stringify(claims)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')}.AA` };
}

/** Explicit synthetic choice response, bound to the request's owner/operation. */
export function preferenceAck(host: Host, init: RequestInitLike | undefined, preferences: Record<string, unknown>, sessionId?: string) {
  const body = JSON.parse(init?.body ?? '{}');
  const claims = JSON.parse(atob(init!.headers!['X-Shopper-Session']!.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/')));
  const previous = { value: true, chosenAt: claims.iat * 1000, expiresAt: claims.iat * 1000 + 30 * 86400 * 1000 };
  const choice = (key: string) => typeof preferences[key] === 'boolean'
    ? { value: preferences[key] as boolean, chosenAt: host.now(), expiresAt: host.now() + 30 * 86400 * 1000 } : previous;
  return { success: true, sessionId: sessionId ?? claims.sessionId, preferences, consent: { instruction: {
    version: 1, tenant: claims.tenant, subject: claims.subject, revision: body.choice?.id,
    tracking: choice('trackingConsent'), personalization: choice('personalizationEnabled'),
  } } };
}

export function testHost(opts: {
  responses?: (url: string, init?: RequestInitLike) => unknown | Promise<unknown>;
  location?: Host['location'];
  referrer?: string;
  withSocket?: boolean;
  now?: () => number;
  renderAcks?: boolean;
} = {}) {
  const calls: Call[] = [];
  const sockets: FakeSocket[] = [];
  const beacons: Array<{ url: string; body: string }> = [];
  let clock = 1_725_000_000_000;
  let uuidSequence = 0;
  const grants = new Map<string, ReturnType<typeof syntheticSession>>();
  const host = memoryHost({
    acquireAuthorityLock: authorityLocks(),
    now: opts.now ?? (() => clock),
    uuid: () => `0f0f0f0f-1111-4222-8333-${String(++uuidSequence).padStart(12, '0')}`,
    location: opts.location ?? { href: 'https://shop.example/home?utm_source=tiktok&utm_medium=paid_social', host: 'shop.example', hostname: 'shop.example', protocol: 'https:', search: '?utm_source=tiktok&utm_medium=paid_social' },
    referrer: opts.referrer ?? 'https://www.tiktok.com/',
    fetch: async (url, init): Promise<ResponseLike> => {
      calls.push({ url, init });
      if (url.endsWith('/identity/session')) {
        const token = init?.headers?.['X-Shopper-Session'];
        const session = token && grants.get(token) || syntheticSession(opts.now?.() ?? clock, undefined, init?.headers?.['X-Tenant'] ?? 'coach');
        grants.set(session.capability, session);
        return { ok: true, status: 200, json: async () => ({ ok: true, session }) };
      }
      const body = opts.renderAcks && url.endsWith('/action') ? renderAck(init) : opts.responses ? await opts.responses(url, init) : { success: true };
      return { ok: true, status: 200, json: async () => body };
    },
    sendBeacon: (url, body) => { beacons.push({ url, body }); return true; },
    ...(opts.withSocket === false ? {} : { openSocket: (url: string, protocols?: string[]) => { const s = new FakeSocket(url, protocols); sockets.push(s); return s; } }),
  });
  return { host, calls, sockets, beacons, tick: (ms: number) => { clock += ms; } };
}

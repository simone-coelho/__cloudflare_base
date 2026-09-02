// src/sdk/testHost.ts — a browser with nothing behind it, for the SDK's own tests.
import { memoryHost } from './memoryHost';
import type { Host, RequestInitLike, ResponseLike, SocketLike } from './types';

export class FakeSocket implements SocketLike {
  readyState = 0;
  onopen: ((ev?: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev?: unknown) => void) | null = null;
  onerror: ((ev?: unknown) => void) | null = null;
  sent: string[] = [];
  constructor(public url: string) {}
  send(data: string): void { this.sent.push(data); }
  close(): void { this.readyState = 3; this.onclose?.(); }
  open(): void { this.readyState = 1; this.onopen?.(); }
  receive(frame: unknown): void { this.onmessage?.({ data: JSON.stringify(frame) }); }
}

export interface Call { url: string; init?: RequestInitLike }

export function testHost(opts: {
  responses?: (url: string, init?: RequestInitLike) => unknown | Promise<unknown>;
  location?: Host['location'];
  referrer?: string;
  withSocket?: boolean;
  now?: () => number;
} = {}) {
  const calls: Call[] = [];
  const sockets: FakeSocket[] = [];
  const beacons: Array<{ url: string; body: string }> = [];
  let clock = 1_725_000_000_000;
  const host = memoryHost({
    now: opts.now ?? (() => clock),
    uuid: () => '0f0f0f0f-1111-2222-3333-444444444444',
    location: opts.location ?? { href: 'https://shop.example/home?utm_source=tiktok&utm_medium=paid_social', host: 'shop.example', hostname: 'shop.example', protocol: 'https:', search: '?utm_source=tiktok&utm_medium=paid_social' },
    referrer: opts.referrer ?? 'https://www.tiktok.com/',
    fetch: async (url, init): Promise<ResponseLike> => {
      calls.push({ url, init });
      const body = opts.responses ? await opts.responses(url, init) : { success: true };
      return { ok: true, status: 200, json: async () => body };
    },
    sendBeacon: (url, body) => { beacons.push({ url, body }); return true; },
    ...(opts.withSocket === false ? {} : { openSocket: (url: string) => { const s = new FakeSocket(url); sockets.push(s); return s; } }),
  });
  return { host, calls, sockets, beacons, tick: (ms: number) => { clock += ms; } };
}

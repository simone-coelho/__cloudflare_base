// src/sdk/memoryHost.ts
// A host with nothing behind it: tests, server-side rendering, and the shape a
// native port fills in. DOM-free on purpose, so a Workers-typed test can import it.

import type { Host, ResponseLike } from './types';

export function memoryHost(overrides: Partial<Host> = {}): Host {
  const storage = new Map<string, string>();
  const cookies = new Map<string, string>();
  const base: Host = {
    now: () => Date.now(),
    uuid: () => `${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`,
    storage: { get: (k) => storage.get(k) ?? null, set: (k, v) => { storage.set(k, v); } },
    cookie: { get: (k) => cookies.get(k) ?? null, set: (k, v) => { cookies.set(k, v); } },
    location: null,
    referrer: '',
    fetch: async (): Promise<ResponseLike> => ({ ok: false, status: 0, json: async () => null }),
    setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
    clearTimeout: (h) => globalThis.clearTimeout(h as ReturnType<typeof setTimeout>),
    setInterval: (fn, ms) => globalThis.setInterval(fn, ms),
    clearInterval: (h) => globalThis.clearInterval(h as ReturnType<typeof setInterval>),
  };
  return { ...base, ...overrides };
}

// src/sdk/memoryHost.ts
// A host with nothing behind it: tests, server-side rendering, and the shape a
// native port fills in. DOM-free on purpose, so a Workers-typed test can import it.

import type { Host, ResponseLike } from './types';

export function memoryHost(overrides: Partial<Host> = {}): Host {
  const storage = new Map<string, string>();
  const cookies = new Map<string, { value: string; expires: number; timer?: unknown }>();
  const now = overrides.now ?? (() => Date.now());
  const schedule = overrides.setTimeout ?? ((fn: () => void, ms: number) => globalThis.setTimeout(fn, ms));
  const cancel = overrides.clearTimeout ?? ((h: unknown) => globalThis.clearTimeout(h as ReturnType<typeof setTimeout>));
  const base: Host = {
    now: () => Date.now(),
    uuid: () => `${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`,
    storage: { get: (k) => storage.get(k) ?? null, set: (k, v) => { storage.set(k, v); } },
    cookie: {
      get: k => { const row = cookies.get(k); if (!row || row.expires <= now()) { cookies.delete(k); return null; } return row.value; },
      set: (k, value, maxAge) => {
        const previous = cookies.get(k); if (previous?.timer !== undefined) cancel(previous.timer);
        if (maxAge <= 0) { cookies.delete(k); return; }
        const row: { value: string; expires: number; timer?: unknown } = { value, expires: now() + maxAge * 1000 };
        cookies.set(k, row);
        const arm = (remaining: number) => {
          const delay = Math.min(2147483647, remaining);
          row.timer = schedule(() => {
            if (cookies.get(k) !== row) return;
            if (remaining <= delay || row.expires <= now()) cookies.delete(k);
            else arm(remaining - delay);
          }, delay);
          (row.timer as { unref?: () => void })?.unref?.();
        };
        arm(maxAge * 1000);
      },
    },
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

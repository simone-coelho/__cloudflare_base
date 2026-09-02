// src/sdk/host.ts
// Two hosts. `browserHost` binds the real browser. `memoryHost` runs the same
// SDK with nothing behind it: tests, server-side rendering, and the shape a
// native port fills in. Everything DOM-shaped in the SDK is reached through
// these, and only here.

import type { DomLike, ElementLike, Host, SocketLike } from './types';
export { memoryHost } from './memoryHost';


function domOf(doc: Document, win: Window & typeof globalThis): DomLike {
  return {
    querySelectorAll: (sel) => Array.from(doc.querySelectorAll(sel)) as unknown as ArrayLike<ElementLike> & Iterable<ElementLike>,
    observe: (el, cb) => {
      if (typeof win.IntersectionObserver !== 'function') { cb(true); return () => {}; }
      const io = new win.IntersectionObserver((entries) => {
        for (const e of entries) cb(e.intersectionRatio >= 0.5);
      }, { threshold: [0, 0.5] });
      io.observe(el as unknown as Element);
      return () => io.disconnect();
    },
  };
}

export function browserHost(): Host {
  const win = globalThis as unknown as Window & typeof globalThis;
  const doc: Document | undefined = typeof document !== 'undefined' ? document : undefined;
  const loc = typeof location !== 'undefined' ? location : undefined;
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  const cookieRe = (k: string) => new RegExp(`(?:^|;\\s*)${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}=([^;]+)`);
  return {
    now: () => Date.now(),
    uuid: () => (win.crypto && typeof win.crypto.randomUUID === 'function')
      ? win.crypto.randomUUID()
      : `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`,
    storage: {
      get: (k) => { try { return win.localStorage.getItem(k); } catch { return null; } },
      set: (k, v) => { try { win.localStorage.setItem(k, v); } catch { /* blocked */ } },
    },
    cookie: {
      get: (k) => { try { return (doc?.cookie.match(cookieRe(k)) ?? [])[1] ?? null; } catch { return null; } },
      set: (k, v, maxAge) => { try { if (doc) doc.cookie = `${k}=${v}; Max-Age=${maxAge}; Path=/; SameSite=Lax`; } catch { /* blocked */ } },
    },
    location: loc ? { href: loc.href, host: loc.host, hostname: loc.hostname, protocol: loc.protocol, search: loc.search } : null,
    referrer: doc?.referrer ?? '',
    fetch: (url, init) => win.fetch(url, init as RequestInit),
    ...(nav && typeof nav.sendBeacon === 'function'
      ? { sendBeacon: (url: string, body: string) => { try { return nav.sendBeacon(url, new Blob([body], { type: 'application/json' })); } catch { return false; } } }
      : {}),
    ...(typeof win.WebSocket === 'function' ? { openSocket: (url: string) => new win.WebSocket(url) as unknown as SocketLike } : {}),
    setTimeout: (fn, ms) => win.setTimeout(fn, ms),
    clearTimeout: (h) => win.clearTimeout(h as number),
    setInterval: (fn, ms) => win.setInterval(fn, ms),
    clearInterval: (h) => win.clearInterval(h as number),
    onPageHide: (fn) => {
      try { win.addEventListener('pagehide', fn); } catch { /* ignore */ }
      try { doc?.addEventListener('visibilitychange', () => { if (doc.visibilityState === 'hidden') fn(); }); } catch { /* ignore */ }
    },
    ...(doc ? { dom: domOf(doc, win) } : {}),
    ...(Array.isArray((win as unknown as { dataLayer?: unknown }).dataLayer)
      ? { dataLayer: (win as unknown as { dataLayer: unknown[] }).dataLayer } : {}),
  };
}

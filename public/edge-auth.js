/* public/edge-auth.js
 *
 * DEMO PAGES ONLY. Makes a demo page work when the worker runs with
 * AUTH_MODE=enforced, by attaching the two credentials the gates look for:
 *
 *   X-SDK-Key       on same-origin calls into /realtime/ and /v1/
 *                   The site key. Not a secret: it identifies the SITE, the way
 *                   an Optimizely SDK key does. Read from
 *                   <meta name="edge-sdk-key" content="…"> in the page.
 *
 *   Authorization   on same-origin WRITES into /operator/, /config/, /content/
 *                   The operator token: the presenter's, pasted once into
 *                   /tuning.html, kept in sessionStorage. The audience never
 *                   needs it; only the merchandiser's actions do.
 *
 * Why a shim rather than editing every call site: the storefront and the
 * console reach gated routes from about ten places between them, and a missed
 * one is a broken beat on stage. Patching fetch and WebSocket once is total.
 * The customer's integration never uses this file; it uses the SDK, which
 * carries both credentials properly.
 *
 * It does nothing at all when the page has no meta key and no token, so a
 * worker in open mode behaves exactly as before.
 */
(() => {
  'use strict';
  if (window.__edgeAuthInstalled) return;
  window.__edgeAuthInstalled = true;

  const meta = document.querySelector('meta[name="edge-sdk-key"]');
  const SDK_KEY = (meta && meta.getAttribute('content') || '').trim();
  const token = () => { try { return (sessionStorage.getItem('tuning-token') || '').trim(); } catch { return ''; } };

  const sameOrigin = (url) => {
    try { return new URL(url, location.href).origin === location.origin; } catch { return false; }
  };
  const pathOf = (url) => { try { return new URL(url, location.href).pathname; } catch { return ''; } };
  const needsKey = (p) => p.startsWith('/realtime/') || p.startsWith('/v1/');
  const needsToken = (p) => p.startsWith('/operator/') || p.startsWith('/config/') || p.startsWith('/content/') || p.startsWith('/sort');

  // -- fetch --------------------------------------------------------------
  const origFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    try {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      if (!sameOrigin(url)) return origFetch(input, init);
      const p = pathOf(url);
      const method = ((init && init.method) || (input && input.method) || 'GET').toUpperCase();
      const headers = new Headers((init && init.headers) || (input && input.headers) || undefined);
      let changed = false;
      if (SDK_KEY && needsKey(p) && !headers.has('X-SDK-Key')) { headers.set('X-SDK-Key', SDK_KEY); changed = true; }
      const t = token();
      if (t && needsToken(p) && method !== 'GET' && method !== 'HEAD' && !headers.has('Authorization')) {
        headers.set('Authorization', 'Bearer ' + t); changed = true;
      }
      return changed ? origFetch(input, { ...(init || {}), headers }) : origFetch(input, init);
    } catch {
      return origFetch(input, init);
    }
  };

  // -- WebSocket: a socket cannot carry a header, so the key rides the query --
  const OrigWS = window.WebSocket;
  if (OrigWS && SDK_KEY) {
    const Patched = function (url, protocols) {
      let u = url;
      try {
        const parsed = new URL(url, location.href);
        if (parsed.host === location.host && needsKey(parsed.pathname) && !parsed.searchParams.has('sdkKey')) {
          parsed.searchParams.set('sdkKey', SDK_KEY);
          u = parsed.toString();
        }
      } catch { /* leave the url alone */ }
      return protocols === undefined ? new OrigWS(u) : new OrigWS(u, protocols);
    };
    Patched.prototype = OrigWS.prototype;
    for (const k of ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED']) Patched[k] = OrigWS[k];
    window.WebSocket = Patched;
  }
})();

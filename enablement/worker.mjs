// enablement/worker.mjs
// The passphrase gate in front of the internal enablement site, worker edge-platform-bti
// (https://edge-platform-bti.expedge.workers.dev). Every request passes through it first
// (run_worker_first = true in wrangler.enablement.toml), and the pages in enablement/site/ are served
// through the ASSETS binding only to a visitor holding a valid signed session cookie.
//
// A temporary measure, approved by the owner on 2026-10-02, until the Microsoft sign-in replaces it.
// It is one shared passphrase, not an identity: it cannot tell one person from another, and anyone
// who is told the passphrase can open the site. The rate limit below slows guessing; it does not stop
// it. docs/enablement/lanes/E2.md says what the gate is and is not, and how to rotate it.
//
//   GET|HEAD /auth    the sign-in page (a visitor already signed in is sent on to the return path)
//   POST     /auth    check the passphrase; on success set the cookie and 303 to the return path
//   GET|HEAD /logout  clear the cookie and redirect to /auth
//   anything else     with a valid cookie, the static site; without one, 302 to /auth?return=<path>
//
// Its two secrets are never written in this file, in a response or in a log:
//   ACCESS_PASSPHRASE  the shared passphrase, at least 15 characters
//   COOKIE_SECRET      at least 32 random bytes, hex or base64: the key that signs the session cookie
// If either is missing or too short, every request answers 503 "Site not configured".
// Setting ACCESS_PASSPHRASE again changes what is asked from then on; sessions already granted stay
// valid until they expire. Setting COOKIE_SECRET again signs everyone out at once.
//
// Nothing is logged by default. AUTH_EVENT_LOG = "on" logs one JSON line per sign-in outcome (never
// the passphrase, the cookie or anything typed) for `wrangler tail` or Workers Logs.

const SIGN_IN = '/auth';
const SIGN_OUT = '/logout';
const COOKIE_NAME = '__Host-enablement_session'; // __Host-: the browser keeps it Secure, host-only, Path=/
const SESSION_SECONDS = 604800; // seven days
const CLOCK_SKEW_SECONDS = 300;
const MIN_PASSPHRASE_CHARACTERS = 15; // the floor NIST SP 800-63B-4 sets for a single-factor password
const MIN_KEY_BYTES = 32;
const MAX_FAILURES = 5; // failed sign-ins allowed per address...
const WINDOW_MS = 10 * 60 * 1000; // ...in any ten minutes
const MAX_TRACKED_ADDRESSES = 10000;
const MAX_FORM_BYTES = 4096;
const MAX_PASSPHRASE_CHARACTERS = 1024;
const MAX_RETURN_LENGTH = 512;

// Every failed sign-in is answered only after this fixed delay. A module value so the unit tests can
// set it to 0; the worker itself never changes it.
let failureDelayMs = 1000;

// The sign-in page's only style. The Content-Security-Policy allows it by this SHA-256 and allows no
// other style; enablement/worker.test.mjs recomputes the hash from the served page and fails if the
// two differ. After editing STYLE, put the hash the failing test prints into STYLE_HASH.
const STYLE = `
:root{
  --fir:#08251A;--mid-fir:#0D3A29;--light-fir:#197050;
  --lf-green:#ABFF44;--grass:#7DDD3D;
  --neutral-3:#E4F0DA;--neutral-5:#C3CEAF;--white:#FFFFFF;
  --bg:var(--neutral-3);--surface:var(--white);--ink:var(--fir);--muted:var(--light-fir);
  --field:var(--white);--line:var(--light-fir);
  --radius:32px;
  --head:"Roboto Condensed",Roboto,"Segoe UI",system-ui,-apple-system,"Helvetica Neue",Arial,sans-serif;
  --body:Roboto,"Segoe UI",system-ui,-apple-system,"Helvetica Neue",Arial,sans-serif;
  --mono:"Roboto Mono",ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  color-scheme:light dark;
}
@media (prefers-color-scheme:dark){
  :root{--bg:var(--fir);--surface:var(--mid-fir);--ink:var(--white);--muted:var(--neutral-5);--field:var(--fir);--line:var(--neutral-5)}
}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;min-height:100vh;min-height:100dvh;display:flex;flex-direction:column;background:var(--bg);color:var(--ink);font:400 1rem/1.3 var(--body)}
main{flex:1;width:100%;max-width:1040px;margin:0 auto;padding:clamp(40px,8vw,96px) clamp(16px,4vw,32px) 0}
.eyebrow{display:inline-block;margin:0 0 20px;padding:6px 16px;border-radius:999px;background:var(--lf-green);color:var(--fir);font:700 .875rem/1.1 var(--body)}
h1{margin:0 0 20px;font:900 clamp(1.75rem,7vw,3.25rem)/1.04 var(--head);letter-spacing:-.03em;overflow-wrap:break-word;text-wrap:balance}
.lede{max-width:40rem;margin:0 0 24px;font-size:clamp(1.0625rem,2.2vw,1.25rem);line-height:1.35;text-wrap:pretty}
.msg{max-width:32rem;margin:0 0 16px;padding:12px 20px;border-radius:16px;background:var(--ink);color:var(--bg);font-weight:700;line-height:1.35}
.card{display:flex;flex-direction:column;gap:12px;max-width:32rem;margin:0;padding:28px;border-radius:var(--radius);background:var(--surface)}
label{font:700 1rem/1.2 var(--body)}
input{width:100%;min-height:48px;padding:12px 18px;border:2px solid var(--line);border-radius:16px;background:var(--field);color:var(--ink);font:400 1.0625rem/1.2 var(--body)}
button{align-self:flex-start;min-height:48px;margin-top:4px;padding:12px 28px;border:0;border-radius:999px;background:var(--lf-green);color:var(--fir);font:600 1.0625rem/1.1 var(--head);letter-spacing:-.02em;cursor:pointer}
button:hover{background:var(--grass)}
input:focus-visible,button:focus-visible{outline:3px solid var(--ink);outline-offset:3px}
.note{max-width:32rem;margin:20px 0 0;color:var(--muted);font-size:.9375rem;line-height:1.35;text-wrap:pretty}
.foot{padding:48px 16px 32px;text-align:center;color:var(--muted);font:400 .8125rem/1.3 var(--mono);letter-spacing:.03em}
.foot p{margin:0;text-wrap:balance}
@supports (corner-shape:squircle){.card{corner-shape:squircle}}
`;
const STYLE_HASH = 'sha256-1pCAVB9WnT/49lTVcGYDLmy3zh0qcyLYC33TYzYmbOc=';

// The same inline tab icon as the site's pages (allowed by img-src data:).
const ICON = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='10' fill='%23ABFF44'/%3E%3Ccircle cx='16' cy='16' r='6' fill='%2308251A'/%3E%3C/svg%3E";

const CSP = `default-src 'none'; style-src '${STYLE_HASH}'; img-src data:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`;

// On every response the worker itself produces: the same eight headers as enablement/site/_headers,
// with this page's own policy in place of the pages' one.
const SECURITY_HEADERS = Object.freeze({
  'Content-Security-Policy': CSP,
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'Cache-Control': 'private, no-store',
  'X-Robots-Tag': 'noindex, nofollow, noarchive',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
});

// The pages carry their own policy from enablement/site/_headers, which the assets binding applies.
// Should a page ever arrive without one, it gets this policy: nothing may run or load, so the page
// shows unstyled rather than unprotected.
const PAGE_FALLBACK_CSP = "default-src 'none'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

const HTML = 'text/html; charset=utf-8';
const TEXT = 'text/plain; charset=utf-8';
const NOT_ACCEPTED = 'That passphrase was not accepted.';

const encoder = new TextEncoder();

export default {
  async fetch(request, env) {
    try {
      return await route(request, env);
    } catch (error) {
      // Generic to the visitor; with the event log on, only the error's class name is recorded.
      logEvent(env, request, 'error', { error: error instanceof Error ? error.name : 'unknown' });
      return plain(request.method, 500, 'Something went wrong. Try again shortly.');
    }
  },
};

async function route(request, env) {
  const { method } = request;
  const config = readConfig(env);
  if (!config) return plain(method, 503, 'Site not configured');

  const url = new URL(request.url);
  const onSignIn = url.pathname === SIGN_IN;
  if (method !== 'GET' && method !== 'HEAD' && !(method === 'POST' && onSignIn)) {
    return plain(method, 405, 'Method Not Allowed', { Allow: onSignIn ? 'GET, HEAD, POST' : 'GET, HEAD' });
  }

  const now = Date.now();
  if (onSignIn) return method === 'POST' ? signIn(request, env, config, now) : showSignIn(request, env, config, url, now);

  if (url.pathname === SIGN_OUT) {
    logEvent(env, request, 'logout');
    return redirect(method, 302, SIGN_IN, { 'Set-Cookie': `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0` });
  }

  if (await hasSession(request, config.key, Math.floor(now / 1000))) return serveAsset(request, env);

  // Unknown and known addresses answer alike, so nothing about the site shows before sign-in.
  const path = safeReturnPath(url.pathname);
  return redirect(method, 302, path === '/' ? SIGN_IN : `${SIGN_IN}?return=${encodeURIComponent(path)}`);
}

async function showSignIn(request, env, config, url, now) {
  const { method } = request;
  const returnPath = safeReturnPath(url.searchParams.get('return'));
  if (await hasSession(request, config.key, Math.floor(now / 1000))) return redirect(method, 302, returnPath);
  const wait = lockedForSeconds(addressKey(request.headers.get('CF-Connecting-IP')), now);
  if (wait) return page(method, 429, { message: waitMessage(wait), returnPath }, { 'Retry-After': String(wait) });
  return page(method, 200, { returnPath });
}

async function signIn(request, env, config, now) {
  const { method } = request;

  // A form posted from another site is refused unread. Browsers mark it in Sec-Fetch-Site; a client
  // that sends no such header (curl, an old browser) is judged on the passphrase alone.
  const fetchSite = request.headers.get('Sec-Fetch-Site');
  if (fetchSite === 'cross-site' || fetchSite === 'same-site') return plain(method, 403, 'Forbidden');

  const type = (request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
  if (type !== 'application/x-www-form-urlencoded') return plain(method, 415, 'Unsupported Media Type');

  const body = await readLimited(request, MAX_FORM_BYTES);
  if (body === null) return plain(method, 413, 'Payload Too Large');
  const form = new URLSearchParams(body);
  const returnPath = safeReturnPath(form.get('return'));
  const given = form.get('passphrase') || '';

  // The check and the count happen together, with no await between them, and before the comparison:
  // guesses sent in parallel cannot overtake the limit. A correct passphrase takes its count back.
  const key = addressKey(request.headers.get('CF-Connecting-IP'));
  const wait = lockedForSeconds(key, now);
  if (wait) {
    // While an address is held back, even the right passphrase is not checked: the answer would
    // tell a guesser that the guess was right.
    logEvent(env, request, 'locked');
    return page(method, 429, { message: waitMessage(wait), returnPath }, { 'Retry-After': String(wait) });
  }
  recordFailure(key, now);
  const accepted = given.length > 0 && given.length <= MAX_PASSPHRASE_CHARACTERS && (await passphraseMatches(given, config.expected));
  if (accepted) {
    forgiveOne(key, now);
    logEvent(env, request, 'success');
    return redirect(method, 303, returnPath, { 'Set-Cookie': await sessionCookie(config.key, Math.floor(now / 1000)) });
  }

  logEvent(env, request, 'failure');
  if (failureDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, failureDelayMs));
  return page(method, 401, { message: NOT_ACCEPTED, returnPath, invalid: true });
}

async function serveAsset(request, env) {
  const upstream = await env.ASSETS.fetch(request);
  const response = new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: new Headers(upstream.headers),
  });
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    // A page behind the gate must never be kept by a shared cache, whatever the asset said.
    if (name === 'Cache-Control') response.headers.set(name, value);
    else if (!response.headers.has(name)) response.headers.set(name, name === 'Content-Security-Policy' ? PAGE_FALLBACK_CSP : value);
  }
  return response;
}

// ---- configuration ---------------------------------------------------------------------------------

function readConfig(env) {
  if (!env || typeof env.ASSETS?.fetch !== 'function') return null;
  const expected = typeof env.ACCESS_PASSPHRASE === 'string' ? normalize(env.ACCESS_PASSPHRASE) : '';
  const key = typeof env.COOKIE_SECRET === 'string' ? decodeKey(env.COOKIE_SECRET) : null;
  if ([...expected].length < MIN_PASSPHRASE_CHARACTERS || !key || key.length < MIN_KEY_BYTES) return null;
  return { expected, key };
}

// The same passphrase typed on any keyboard or pasted with a stray space or newline.
function normalize(text) {
  return text.normalize('NFC').trim();
}

// COOKIE_SECRET as hex or as base64 (standard or URL-safe); anything else is not a key.
function decodeKey(text) {
  const value = text.trim();
  if (/^(?:[0-9a-fA-F]{2})+$/.test(value)) return Uint8Array.from(value.match(/../g), (pair) => parseInt(pair, 16));
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(value)) return null;
  const standard = value.replace(/=+$/, '').replace(/-/g, '+').replace(/_/g, '/');
  try {
    return Uint8Array.from(atob(standard + '='.repeat((4 - (standard.length % 4)) % 4)), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

// ---- comparison and signing ------------------------------------------------------------------------

// A fixed-length XOR loop: it always runs over every byte and never stops at the first difference.
// Callers pass SHA-256 digests or HMAC encodings, whose lengths are fixed and public.
function sameBytes(a, b) {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
  return difference === 0;
}

async function sha256(text) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(text)));
}

// Both sides are hashed first, so the comparison is over 32 bytes whatever was typed: neither the
// passphrase's length nor the place of a first wrong character can show in the timing. (SHA-256
// here only levels the lengths; the passphrase itself is held by Cloudflare as a secret.)
async function passphraseMatches(given, expected) {
  const [a, b] = await Promise.all([sha256(normalize(given)), sha256(expected)]);
  return sameBytes(a, b);
}

async function hmac(keyBytes, message) {
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return base64url(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(message))));
}

function base64url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// <expiry-unix-seconds>.<base64url HMAC-SHA256(expiry, COOKIE_SECRET)>. Stateless: no session store.
async function sessionCookie(keyBytes, nowSeconds) {
  const expiry = String(nowSeconds + SESSION_SECONDS);
  return `${COOKIE_NAME}=${expiry}.${await hmac(keyBytes, expiry)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_SECONDS}`;
}

async function hasSession(request, keyBytes, nowSeconds) {
  const value = readCookie(request.headers.get('Cookie'), COOKIE_NAME);
  const parts = value ? /^([1-9]\d{0,11})\.([A-Za-z0-9_-]{43})$/.exec(value) : null;
  if (!parts) return false;
  const expiry = Number(parts[1]);
  // Expired, or later than any cookie this worker issues: refused before any signature is computed.
  if (expiry <= nowSeconds || expiry > nowSeconds + SESSION_SECONDS + CLOCK_SKEW_SECONDS) return false;
  return sameBytes(encoder.encode(parts[2]), encoder.encode(await hmac(keyBytes, parts[1])));
}

function readCookie(header, name) {
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

// ---- the return path -------------------------------------------------------------------------------

// Only a path on this site: one leading "/", then letters, digits, "-", ".", "_", "~", "/" and percent
// escapes. That rules out "//host" and "/\host" (browsers read both as another site), any scheme,
// control characters, spaces, a query and a fragment. /auth and /logout are never a destination, so a
// crafted link cannot sign someone out the moment they sign in. Anything else becomes "/".
function safeReturnPath(value) {
  if (typeof value !== 'string' || value.length > MAX_RETURN_LENGTH) return '/';
  if (!/^\/(?:[A-Za-z0-9\-._~/]|%[0-9A-Fa-f]{2})*$/.test(value) || value.includes('//')) return '/';
  if (/^\/(?:auth|logout)(?:\/|$)/i.test(value)) return '/';
  return value;
}

// ---- the rate limit --------------------------------------------------------------------------------

// Failed sign-ins per address, kept in this isolate's memory only. Cloudflare runs many isolates and
// may recycle any of them at any time, so this is a slowdown for one address, never a guarantee: a
// patient or distributed guesser is held back only by the passphrase's length. The address is the
// CF-Connecting-IP header, which Cloudflare sets; IPv6 addresses are counted per /64, because one
// subscriber usually holds a whole /64.
const failures = new Map(); // address key -> times (ms) of recent failures, oldest first

function addressKey(raw) {
  const ip = String(raw || '').trim().toLowerCase().slice(0, 64);
  if (!ip) return 'unknown';
  if (!ip.includes(':') || ip.includes('.')) return ip;
  const halves = ip.split('::');
  if (halves.length > 2) return ip;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const fill = halves.length === 2 ? Math.max(0, 8 - head.length - tail.length) : 0;
  const groups = [...head, ...Array(fill).fill('0'), ...tail].slice(0, 4);
  return `${groups.map((g) => g.replace(/^0+(?=.)/, '')).join(':')}::/64`;
}

function recentFailures(key, now) {
  const recent = (failures.get(key) || []).filter((time) => now - time < WINDOW_MS);
  if (recent.length) failures.set(key, recent);
  else failures.delete(key);
  return recent;
}

// Seconds until this address may try again: 0 while it has had fewer than MAX_FAILURES failures in
// the last ten minutes, otherwise the time until the oldest of the counted failures leaves the window.
function lockedForSeconds(key, now) {
  const recent = recentFailures(key, now);
  if (recent.length < MAX_FAILURES) return 0;
  return Math.max(1, Math.ceil((recent[recent.length - MAX_FAILURES] + WINDOW_MS - now) / 1000));
}

function recordFailure(key, now) {
  const recent = recentFailures(key, now);
  recent.push(now);
  if (recent.length > MAX_FAILURES * 2) recent.splice(0, recent.length - MAX_FAILURES * 2);
  failures.set(key, recent);
  if (failures.size > MAX_TRACKED_ADDRESSES) {
    for (const [k, times] of failures) if (!times.some((time) => now - time < WINDOW_MS)) failures.delete(k);
    for (const k of failures.keys()) {
      if (failures.size <= MAX_TRACKED_ADDRESSES) break;
      failures.delete(k);
    }
  }
}

function forgiveOne(key, time) {
  const times = failures.get(key);
  const at = times ? times.indexOf(time) : -1;
  if (at >= 0) times.splice(at, 1);
  if (times && !times.length) failures.delete(key);
}

function waitMessage(seconds) {
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  return `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`;
}

// ---- requests and responses ------------------------------------------------------------------------

// The form body, or null when it is larger than the limit (whatever Content-Length claims).
async function readLimited(request, limit) {
  const declared = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(declared) && declared > limit) return null;
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function respond(method, status, body, headers = {}) {
  const all = new Headers(SECURITY_HEADERS);
  for (const [name, value] of Object.entries(headers)) all.set(name, value);
  return new Response(method === 'HEAD' ? null : body, { status, headers: all });
}

function plain(method, status, text, headers = {}) {
  return respond(method, status, `${text}\n`, { 'Content-Type': TEXT, ...headers });
}

function redirect(method, status, location, headers = {}) {
  return respond(method, status, null, { Location: location, ...headers });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// The sign-in page. Nothing the visitor sent is written into it except the return path, and that only
// after safeReturnPath has reduced it to a path on this site, and escaped all the same.
function page(method, status, { message = '', returnPath = '/', invalid = false } = {}, headers = {}) {
  const notice = message ? `\n  <p class="msg" id="msg" role="alert">${escapeHtml(message)}</p>` : '';
  const describedBy = message ? ' aria-describedby="msg"' : '';
  const ariaInvalid = invalid ? ' aria-invalid="true"' : '';
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow, noarchive">
<meta name="theme-color" content="#E4F0DA" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#08251A" media="(prefers-color-scheme: dark)">
<title>Sign in | Optimizely enablement</title>
<link rel="icon" href="${ICON}">
<style>${STYLE}</style>
</head>
<body>
<main id="main">
  <p class="eyebrow">Internal &middot; Optimizely</p>
  <h1>This site is for Optimizely staff</h1>
  <p class="lede">Enter the passphrase you were given to open the enablement pages.</p>${notice}
  <form class="card" method="post" action="${SIGN_IN}">
    <input type="hidden" name="return" value="${escapeHtml(returnPath)}">
    <label for="passphrase">Passphrase</label>
    <input id="passphrase" name="passphrase" type="password" autocomplete="current-password" required maxlength="${MAX_PASSPHRASE_CHARACTERS}" autocapitalize="none" spellcheck="false" autofocus${describedBy}${ariaInvalid}>
    <button type="submit">Sign in</button>
  </form>
  <p class="note">The passphrase is shared with Optimizely staff only. Never post it or send it outside Optimizely. After you sign in, this browser stays signed in for seven days.</p>
</main>
<footer class="foot"><p>Internal reference &middot; do not forward outside Optimizely</p></footer>
</body>
</html>
`;
  return respond(method, status, html, { 'Content-Type': HTML, ...headers });
}

// ---- the opt-in event log --------------------------------------------------------------------------

// Off unless AUTH_EVENT_LOG is "on". One structured line per outcome: what happened, when, from which
// address, and Cloudflare's ray id for correlation. Never the passphrase, the cookie, the form or the
// return path.
function logEvent(env, request, outcome, extra = {}) {
  if (!env || env.AUTH_EVENT_LOG !== 'on') return;
  console.log(JSON.stringify({
    event: 'enablement.signin',
    outcome,
    at: new Date().toISOString(),
    address: request.headers.get('CF-Connecting-IP') || null,
    ray: request.headers.get('CF-Ray') || null,
    ...extra,
  }));
}

// ---- test hooks ------------------------------------------------------------------------------------
// For enablement/worker.test.mjs only; the worker never calls them and no request can reach them.

/** Sets the delay before a failed sign-in is answered, and returns the previous value. */
export function setFailureDelayForTests(ms) {
  const previous = failureDelayMs;
  failureDelayMs = Math.max(0, Number(ms) || 0);
  return previous;
}

/** Forgets every recorded failure. */
export function resetRateLimitForTests() {
  failures.clear();
}

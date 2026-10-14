// enablement/worker.test.mjs
// Unit tests for the passphrase gate, enablement/worker.mjs. Run:  node --test enablement/worker.test.mjs
// Node 22's fetch classes and Web Crypto stand in for the Workers runtime. Every run generates its own
// passphrase and cookie key, so no secret is written in this file. The ASSETS binding is a stub that
// answers 200 with a fixed text and records each request it is given.
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import worker, { resetRateLimitForTests, setFailureDelayForTests } from './worker.mjs';

const ORIGIN = 'https://edge-platform-bti.expedge.workers.dev';
const COOKIE = '__Host-enablement_session';
const PASSPHRASE = `gate ${randomBytes(12).toString('base64url')} test`;
const KEY_HEX = randomBytes(32).toString('hex');
const EMPTY = '';
const SPACES = ' '.repeat(20);
const ASSET_TEXT = 'a page of the static site';
const FALLBACK_CSP = "default-src 'none'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

const initialDelay = setFailureDelayForTests(0);
beforeEach(() => resetRateLimitForTests());

function makeEnv(overrides = {}) {
  const asked = [];
  const env = {
    ACCESS_PASSPHRASE: PASSPHRASE,
    COOKIE_SECRET: KEY_HEX,
    ASSETS: {
      async fetch(request) {
        asked.push(request);
        const body = request.method === 'HEAD' ? null : ASSET_TEXT;
        return new Response(body, { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
      },
    },
    ...overrides,
  };
  return { env, asked };
}

function send(env, path, { method = 'GET', headers = {}, body } = {}) {
  return worker.fetch(new Request(ORIGIN + path, { method, headers, body }), env);
}

function post(env, fields, { ip = '203.0.113.7', headers = {} } = {}) {
  return send(env, '/auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Sec-Fetch-Site': 'same-origin', 'CF-Connecting-IP': ip, ...headers },
    body: new URLSearchParams(fields).toString(),
  });
}

const signIn = (env, fields = {}, options = {}) => post(env, { passphrase: PASSPHRASE, ...fields }, options);
const nowSeconds = () => Math.floor(Date.now() / 1000);
// An independent implementation of the cookie's signature, from node:crypto.
const mac = (message, keyHex = KEY_HEX) => createHmac('sha256', Buffer.from(keyHex, 'hex')).update(message).digest('base64url');
const cookieFor = (expiry, keyHex) => `${COOKIE}=${expiry}.${mac(String(expiry), keyHex)}`;
const hiddenReturn = (html) => (html.match(/<input type="hidden" name="return" value="([^"]*)">/) || [])[1];

async function cookieFromSignIn(env) {
  const res = await signIn(env, {}, { ip: '203.0.113.200' });
  assert.equal(res.status, 303);
  return res.headers.getSetCookie()[0].split(';')[0];
}

const SECURITY = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'cache-control': 'private, no-store',
  'x-robots-tag': 'noindex, nofollow, noarchive',
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
};
const WORKER_CSP = /^default-src 'none'; style-src 'sha256-[A-Za-z0-9+/]{43}='; img-src data:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'$/;

function assertWorkerHeaders(res) {
  for (const [name, value] of Object.entries(SECURITY)) assert.equal(res.headers.get(name), value, name);
  assert.match(res.headers.get('content-security-policy') || '', WORKER_CSP);
}

test('a failed sign-in is held back about one second by default', () => {
  assert.equal(initialDelay, 1000);
});

test('an unauthenticated GET / is redirected to /auth, and nothing is served', async () => {
  const { env, asked } = makeEnv();
  const res = await send(env, '/');
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/auth');
  assert.equal(res.headers.getSetCookie().length, 0);
  assertWorkerHeaders(res);
  assert.equal(await res.text(), '');
  assert.equal(asked.length, 0);
});

test('every other address redirects alike, carrying only its own validated path', async () => {
  const { env, asked } = makeEnv();
  for (const [path, location] of [
    ['/what-it-is/', '/auth?return=%2Fwhat-it-is%2F'],
    ['/no-such-page', '/auth?return=%2Fno-such-page'],
    ['/glossary/?q=<b>hello</b>', '/auth?return=%2Fglossary%2F'],
    ['/index.html', '/auth?return=%2Findex.html'],
    ['/404.html', '/auth?return=%2F404.html'],
    ['/_headers', '/auth?return=%2F_headers'],
    ['//evil.example/x', '/auth'],
    ['/logout/again', '/auth'],
  ]) {
    const res = await send(env, path);
    assert.equal(res.status, 302, path);
    assert.equal(res.headers.get('location'), location, path);
  }
  assert.equal(asked.length, 0);
});

test('GET /auth serves the sign-in form with the security headers', async () => {
  const { env } = makeEnv();
  const res = await send(env, '/auth');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'text/html; charset=utf-8');
  assertWorkerHeaders(res);
  const html = await res.text();
  assert.match(html, /<form class="card" method="post" action="\/auth">/);
  assert.equal((html.match(/<input\b/g) || []).length, 2, 'one hidden field and one password field');
  assert.match(html, /<input id="passphrase" name="passphrase" type="password" autocomplete="current-password" required/);
  assert.match(html, /<button type="submit">Sign in<\/button>/);
  assert.equal(hiddenReturn(html), '/');
  assert.doesNotMatch(html, /<script|\son[a-z]+\s*=|javascript:/i);
});

test('the policy allows exactly the inline style of the sign-in page', async () => {
  const res = await send(makeEnv().env, '/auth');
  const html = await res.text();
  const styles = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]);
  assert.equal(styles.length, 1);
  const hash = `'sha256-${createHash('sha256').update(styles[0], 'utf8').digest('base64')}'`;
  const styleSrc = res.headers.get('content-security-policy').match(/(?:^|;\s*)style-src ([^;]+)/)[1].trim().split(/\s+/);
  assert.deepEqual(styleSrc, [hash], `set STYLE_HASH in enablement/worker.mjs to ${hash.slice(1, -1)}`);
  assert.doesNotMatch(html, /\sstyle\s*=/i, 'no style attribute');
});

test('the return path fills the hidden field only when it is a path on this site', async () => {
  const { env } = makeEnv();
  for (const good of ['/', '/what-it-is/', '/glossary/', '/credits/index.html', '/a-b_c.d~e/%20f']) {
    const html = await (await send(env, `/auth?return=${encodeURIComponent(good)}`)).text();
    assert.equal(hiddenReturn(html), good, good);
  }
  const bad = [
    '//evil.example', 'https://x', 'https://evil.example/', '/\\evil.example', '\\\\evil.example', '/\t/evil.example',
    '/\n/evil.example', ' /x', 'javascript:alert(1)', 'what-it-is/', '/a//b', '/x?y=1', '/x#y', '/x y',
    '/"><script>alert(1)</script>', '/auth', '/AUTH', '/auth/', '/logout', '/logout/x', '/%zz', `/${'a'.repeat(600)}`, EMPTY,
  ];
  for (const value of bad) {
    const html = await (await send(env, `/auth?return=${encodeURIComponent(value)}`)).text();
    assert.equal(hiddenReturn(html), '/', JSON.stringify(value));
    assert.doesNotMatch(html, /evil\.example|<script|alert\(/, JSON.stringify(value));
  }
});

test('POST /auth with the right passphrase sets the session cookie and 303s to the return path', async () => {
  const { env } = makeEnv();
  const before = nowSeconds();
  const res = await signIn(env, { return: '/what-it-is/' });
  const after = nowSeconds();
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), '/what-it-is/');
  assertWorkerHeaders(res);
  const cookies = res.headers.getSetCookie();
  assert.equal(cookies.length, 1);
  const parts = cookies[0].match(/^__Host-enablement_session=(\d+)\.([A-Za-z0-9_-]{43}); HttpOnly; Secure; SameSite=Lax; Path=\/; Max-Age=604800$/);
  assert.ok(parts, 'the cookie has exactly the expected name, value shape and attributes');
  const expiry = Number(parts[1]);
  assert.ok(expiry >= before + 604800 && expiry <= after + 604800, 'it expires seven days from now');
  assert.equal(parts[2], mac(parts[1]), 'the signature is HMAC-SHA256 of the expiry under COOKIE_SECRET');
  assert.equal(await res.text(), '');
});

test('a sign-in without a return path goes to /', async () => {
  const res = await signIn(makeEnv().env);
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), '/');
});

test('a hostile return path in the form is replaced by /', async () => {
  const { env } = makeEnv();
  for (const value of ['//evil.example', 'https://x', '/\\evil.example', 'javascript:alert(1)', '/logout', '/%0d%0aSet-Cookie:x=1']) {
    const res = await signIn(env, { return: value });
    assert.equal(res.status, 303, value);
    assert.equal(res.headers.get('location'), '/', value);
    assert.equal(res.headers.getSetCookie().length, 1, value);
  }
});

test('POST /auth with a wrong passphrase answers 401 with no cookie', async () => {
  const { env } = makeEnv();
  const wrong = `wrong-${randomBytes(6).toString('hex')}`;
  const res = await post(env, { passphrase: wrong, return: '/glossary/' });
  assert.equal(res.status, 401);
  assert.equal(res.headers.getSetCookie().length, 0);
  assertWorkerHeaders(res);
  const html = await res.text();
  assert.match(html, /<p class="msg" id="msg" role="alert">That passphrase was not accepted\.<\/p>/);
  assert.ok(!html.includes(wrong), 'what was typed is not written back');
  assert.equal(hiddenReturn(html), '/glossary/', 'the return path survives a retry');
  assert.match(html, /aria-describedby="msg" aria-invalid="true"/);
});

test('an empty, overlong or nearly right passphrase is refused like any other', async () => {
  const { env } = makeEnv();
  for (const [i, value] of [EMPTY, 'x'.repeat(1025), `${PASSPHRASE}x`, PASSPHRASE.slice(1), PASSPHRASE.toUpperCase()].entries()) {
    const res = await post(env, { passphrase: value }, { ip: `203.0.113.${100 + i}` });
    assert.equal(res.status, 401, `case ${i}`);
    assert.equal(res.headers.getSetCookie().length, 0);
  }
  const missing = await post(env, { return: '/' }, { ip: '203.0.113.110' });
  assert.equal(missing.status, 401, 'no passphrase field at all');
});

test('surrounding spaces and a trailing newline in the typed passphrase are ignored', async () => {
  const res = await signIn(makeEnv().env, { passphrase: `  ${PASSPHRASE}\n` });
  assert.equal(res.status, 303);
});

test('a valid cookie serves the site, with the security headers added', async () => {
  const { env, asked } = makeEnv();
  const cookie = await cookieFromSignIn(env);
  const res = await send(env, '/what-it-is/', { headers: { Cookie: `theme=dark; ${cookie}; other=1` } });
  assert.equal(res.status, 200);
  assert.equal(await res.text(), ASSET_TEXT);
  assert.equal(asked.length, 1);
  assert.equal(new URL(asked[0].url).pathname, '/what-it-is/');
  for (const [name, value] of Object.entries(SECURITY)) assert.equal(res.headers.get(name), value, name);
  assert.equal(res.headers.get('content-security-policy'), FALLBACK_CSP, 'a page without its own policy gets the strict fallback');
});

test("a page keeps its own headers, but never a cacheable Cache-Control", async () => {
  const pagePolicy = "default-src 'none'; style-src 'sha256-abc='; img-src data:";
  const { env } = makeEnv({
    ASSETS: {
      fetch: async () => new Response('not found page', {
        status: 404,
        headers: { 'Content-Security-Policy': pagePolicy, 'Cache-Control': 'public, max-age=3600', 'X-Frame-Options': 'SAMEORIGIN' },
      }),
    },
  });
  const res = await send(env, '/no-such-page', { headers: { Cookie: await cookieFromSignIn(env) } });
  assert.equal(res.status, 404);
  assert.equal(await res.text(), 'not found page');
  assert.equal(res.headers.get('content-security-policy'), pagePolicy);
  assert.equal(res.headers.get('x-frame-options'), 'SAMEORIGIN');
  assert.equal(res.headers.get('cache-control'), 'private, no-store');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
});

test('a forged, foreign or malformed cookie is refused', async () => {
  const { env, asked } = makeEnv();
  const expiry = nowSeconds() + 3600;
  const genuine = cookieFor(expiry);
  const signature = genuine.split('.')[1];
  const forged = [
    `${COOKIE}=${expiry}.${randomBytes(32).toString('base64url')}`,
    cookieFor(expiry, randomBytes(32).toString('hex')),
    `${COOKIE}=${expiry + 1}.${signature}`,
    `${COOKIE}=${expiry}`,
    `${COOKIE}=${expiry}.`,
    `${COOKIE}=.${signature}`,
    `${COOKIE}=0${expiry}.${mac(`0${expiry}`)}`,
    `${COOKIE}=${expiry}.${signature}x`,
    `${COOKIE}=${expiry}.${signature.slice(0, -1)}`,
    `${COOKIE}=abc.${mac('abc')}`,
    `${COOKIE}="${expiry}.${signature}"`,
    `enablement_session=${expiry}.${signature}`,
    `${COOKIE.toLowerCase()}=${expiry}.${signature}`,
  ];
  for (const cookie of forged) {
    const res = await send(env, '/', { headers: { Cookie: cookie } });
    assert.equal(res.status, 302, cookie);
    assert.equal(res.headers.get('location'), '/auth');
  }
  assert.equal(asked.length, 0);
  assert.equal((await send(env, '/', { headers: { Cookie: genuine } })).status, 200, 'the genuine cookie, for contrast');
});

test('an expired cookie, or one dated beyond the session lifetime, is refused', async () => {
  const { env } = makeEnv();
  const now = nowSeconds();
  for (const expiry of [now - 60, now - 604800, now + 604800 * 2]) {
    const res = await send(env, '/', { headers: { Cookie: cookieFor(expiry) } });
    assert.equal(res.status, 302, `expiry ${expiry - now} s from now`);
  }
  assert.equal((await send(env, '/', { headers: { Cookie: cookieFor(now + 604800) } })).status, 200);
});

test('six wrong attempts from one address: five 401s, then 429 with Retry-After', async () => {
  const { env } = makeEnv();
  const ip = '198.51.100.20';
  for (let i = 1; i <= 5; i++) assert.equal((await post(env, { passphrase: `wrong ${i}` }, { ip })).status, 401, `attempt ${i}`);
  const sixth = await post(env, { passphrase: 'wrong 6' }, { ip });
  assert.equal(sixth.status, 429);
  const retry = Number(sixth.headers.get('retry-after'));
  assert.ok(Number.isInteger(retry) && retry >= 1 && retry <= 600, `Retry-After ${retry}`);
  assertWorkerHeaders(sixth);
  assert.match(await sixth.text(), /Too many attempts\. Try again in \d+ minutes?\./);
  const right = await signIn(env, {}, { ip });
  assert.equal(right.status, 429, 'while held back, even the right passphrase is not checked');
  assert.equal(right.headers.getSetCookie().length, 0);
  assert.equal((await send(env, '/auth', { headers: { 'CF-Connecting-IP': ip } })).status, 429, 'the sign-in page says to wait');
  assert.equal((await signIn(env, {}, { ip: '198.51.100.21' })).status, 303, 'another address is not affected');
});

test('the hold lasts until the ten-minute window has passed', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1_900_000_000_000 });
  const { env } = makeEnv();
  const ip = '198.51.100.30';
  for (let i = 0; i < 5; i++) assert.equal((await post(env, { passphrase: 'wrong' }, { ip })).status, 401);
  let res = await signIn(env, {}, { ip });
  assert.equal(res.status, 429);
  assert.equal(res.headers.get('retry-after'), '600');
  t.mock.timers.tick(9 * 60 * 1000);
  res = await signIn(env, {}, { ip });
  assert.equal(res.status, 429);
  assert.equal(res.headers.get('retry-after'), '60');
  t.mock.timers.tick(60 * 1000);
  res = await signIn(env, {}, { ip });
  assert.equal(res.status, 303);
});

test('a right passphrase does not use up one of the five attempts', async () => {
  const { env } = makeEnv();
  const ip = '198.51.100.40';
  for (let i = 0; i < 4; i++) await post(env, { passphrase: 'wrong' }, { ip });
  assert.equal((await signIn(env, {}, { ip })).status, 303);
  assert.equal((await post(env, { passphrase: 'wrong' }, { ip })).status, 401, 'the fifth failure');
  assert.equal((await post(env, { passphrase: 'wrong' }, { ip })).status, 429);
});

test('guesses sent in parallel cannot overtake the limit', async () => {
  const { env } = makeEnv();
  const results = await Promise.all(Array.from({ length: 12 }, () => post(env, { passphrase: 'wrong' }, { ip: '198.51.100.50' })));
  const statuses = results.map((r) => r.status);
  assert.equal(statuses.filter((s) => s === 401).length, 5, statuses.join(' '));
  assert.equal(statuses.filter((s) => s === 429).length, 7);
});

test('IPv6 addresses are counted per /64', async () => {
  const { env } = makeEnv();
  for (let i = 1; i <= 5; i++) await post(env, { passphrase: 'wrong' }, { ip: `2001:db8:1:2::${i.toString(16)}` });
  assert.equal((await post(env, { passphrase: 'wrong' }, { ip: '2001:db8:1:2:ffff:ffff:ffff:ffff' })).status, 429);
  assert.equal((await post(env, { passphrase: 'wrong' }, { ip: '2001:0db8:0001:0002:0:0:0:9' })).status, 429, 'the same /64 written in full');
  assert.equal((await signIn(env, {}, { ip: '2001:db8:1:3::1' })).status, 303, 'the next /64 is not held back');
});

test('missing or weak secrets answer 503 to every request, and say nothing else', async () => {
  const cases = {
    'no passphrase': { ACCESS_PASSPHRASE: undefined },
    'no cookie key': { COOKIE_SECRET: undefined },
    'an empty passphrase': { ACCESS_PASSPHRASE: EMPTY },
    'a passphrase under 15 characters': { ACCESS_PASSPHRASE: PASSPHRASE.slice(0, 14) },
    'a passphrase of spaces': { ACCESS_PASSPHRASE: SPACES },
    'a hex key under 32 bytes': { COOKIE_SECRET: KEY_HEX.slice(0, 62) },
    'a base64 key under 32 bytes': { COOKIE_SECRET: randomBytes(31).toString('base64') },
    'a key that is neither hex nor base64': { COOKIE_SECRET: KEY_HEX + '!' },
    'no assets binding': { ASSETS: undefined },
  };
  const requests = [
    ['/', {}],
    ['/auth', {}],
    ['/auth', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `passphrase=${encodeURIComponent(PASSPHRASE)}` }],
    ['/logout', {}],
    ['/', { method: 'PUT', body: 'x' }],
    ['/auth', { method: 'HEAD' }],
  ];
  for (const [label, overrides] of Object.entries(cases)) {
    const { env } = makeEnv(overrides);
    for (const [path, init] of requests) {
      const res = await send(env, path, init);
      const what = `${label}: ${init.method || 'GET'} ${path}`;
      assert.equal(res.status, 503, what);
      assert.equal(res.headers.get('content-type'), 'text/plain; charset=utf-8', what);
      assert.equal(await res.text(), init.method === 'HEAD' ? '' : 'Site not configured\n', what);
      assert.equal(res.headers.getSetCookie().length, 0, what);
      assertWorkerHeaders(res);
    }
  }
  assert.equal((await worker.fetch(new Request(`${ORIGIN}/`), undefined)).status, 503, 'no environment at all');
});

test('methods other than GET, HEAD and POST answer 405', async () => {
  const { env, asked } = makeEnv();
  for (const method of ['PUT', 'DELETE', 'PATCH', 'OPTIONS']) {
    for (const path of ['/', '/auth', '/logout', '/what-it-is/']) {
      const init = method === 'PUT' || method === 'PATCH' ? { method, body: 'x' } : { method };
      const res = await send(env, path, init);
      assert.equal(res.status, 405, `${method} ${path}`);
      assert.equal(res.headers.get('allow'), path === '/auth' ? 'GET, HEAD, POST' : 'GET, HEAD');
      assertWorkerHeaders(res);
    }
  }
  const elsewhere = await send(env, '/', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'passphrase=x' });
  assert.equal(elsewhere.status, 405, 'POST anywhere but /auth');
  assert.equal(elsewhere.headers.get('allow'), 'GET, HEAD');
  assert.equal(asked.length, 0);
});

test('HEAD behaves like GET without a body', async () => {
  const { env, asked } = makeEnv();
  const head = await send(env, '/auth', { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('content-type'), 'text/html; charset=utf-8');
  assertWorkerHeaders(head);
  assert.equal(await head.text(), '');
  const anonymous = await send(env, '/glossary/', { method: 'HEAD' });
  assert.equal(anonymous.status, 302);
  assert.equal(anonymous.headers.get('location'), '/auth?return=%2Fglossary%2F');
  const signedIn = await send(env, '/glossary/', { method: 'HEAD', headers: { Cookie: await cookieFromSignIn(env) } });
  assert.equal(signedIn.status, 200);
  assert.equal(await signedIn.text(), '');
  assert.equal(asked.at(-1).method, 'HEAD');
});

test('GET /logout clears the cookie and redirects to /auth', async () => {
  const { env } = makeEnv();
  const res = await send(env, '/logout', { headers: { Cookie: await cookieFromSignIn(env) } });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/auth');
  assert.deepEqual(res.headers.getSetCookie(), [`${COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`]);
  assertWorkerHeaders(res);
});

test('a visitor already signed in who opens /auth is sent on to the return path', async () => {
  const { env } = makeEnv();
  const cookie = await cookieFromSignIn(env);
  const res = await send(env, '/auth?return=%2Fglossary%2F', { headers: { Cookie: cookie } });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/glossary/');
  const hostile = await send(env, '/auth?return=%2F%2Fevil.example', { headers: { Cookie: cookie } });
  assert.equal(hostile.headers.get('location'), '/');
});

test('only a same-origin form of modest size is read', async () => {
  const { env } = makeEnv();
  for (const site of ['cross-site', 'same-site']) {
    const res = await signIn(env, {}, { headers: { 'Sec-Fetch-Site': site } });
    assert.equal(res.status, 403, site);
    assert.equal(res.headers.getSetCookie().length, 0);
  }
  const json = await send(env, '/auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.50' },
    body: JSON.stringify({ passphrase: PASSPHRASE }),
  });
  assert.equal(json.status, 415);
  const huge = await post(env, { passphrase: PASSPHRASE, filler: 'x'.repeat(5000) });
  assert.equal(huge.status, 413);
  assert.equal(huge.headers.getSetCookie().length, 0);
  // A client that sends no Sec-Fetch-Site (curl, an older browser) is judged on the passphrase alone.
  const curlLike = await send(env, '/auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
    body: `passphrase=${encodeURIComponent(PASSPHRASE)}`,
  });
  assert.equal(curlLike.status, 303);
});

test('a wrong passphrase is answered only after the fixed delay', async () => {
  const { env } = makeEnv();
  setFailureDelayForTests(150);
  try {
    const started = performance.now();
    const res = await post(env, { passphrase: 'wrong' }, { ip: '203.0.113.60' });
    assert.equal(res.status, 401);
    assert.ok(performance.now() - started >= 140, 'the answer waited for the delay');
  } finally {
    setFailureDelayForTests(0);
  }
});

test('a base64 cookie key works as well as a hex one', async () => {
  for (const key of [randomBytes(32).toString('base64'), randomBytes(48).toString('base64url')]) {
    const { env } = makeEnv({ COOKIE_SECRET: key });
    const cookie = await cookieFromSignIn(env);
    assert.equal((await send(env, '/', { headers: { Cookie: cookie } })).status, 200);
  }
});

test('an unexpected failure answers a generic 500', async () => {
  const { env } = makeEnv();
  const cookie = await cookieFromSignIn(env);
  env.ASSETS = { fetch: async () => { throw new Error(`assets failed near ${PASSPHRASE}`); } };
  const res = await send(env, '/', { headers: { Cookie: cookie } });
  assert.equal(res.status, 500);
  assertWorkerHeaders(res);
  assert.equal(await res.text(), 'Something went wrong. Try again shortly.\n');
});

test('nothing is logged by default', async (t) => {
  const spies = ['log', 'info', 'warn', 'error', 'debug'].map((name) => t.mock.method(console, name, () => {}));
  const { env } = makeEnv();
  const ip = '203.0.113.90';
  await send(env, '/');
  await send(env, '/auth');
  for (let i = 0; i < 6; i++) await post(env, { passphrase: 'wrong' }, { ip });
  const cookie = await cookieFromSignIn(env);
  await send(env, '/what-it-is/', { headers: { Cookie: cookie } });
  await send(env, '/logout', { headers: { Cookie: cookie } });
  await send(env, '/', { method: 'PUT', body: 'x' });
  await send(makeEnv({ COOKIE_SECRET: undefined }).env, '/');
  env.ASSETS = { fetch: async () => { throw new Error('assets failed'); } };
  await send(env, '/', { headers: { Cookie: cookie } });
  for (const spy of spies) assert.equal(spy.mock.callCount(), 0);
});

test('the opt-in event log records outcomes, never a passphrase, a cookie or a path', async (t) => {
  const lines = [];
  t.mock.method(console, 'log', (line) => lines.push(String(line)));
  const { env } = makeEnv({ AUTH_EVENT_LOG: 'on' });
  const ip = '203.0.113.70';
  const wrong = `typed-${randomBytes(6).toString('hex')}`;
  await post(env, { passphrase: wrong, return: '/glossary/' }, { ip, headers: { 'CF-Ray': 'ray-1' } });
  const ok = await signIn(env, { return: '/glossary/' }, { ip });
  const cookie = ok.headers.getSetCookie()[0].split(';')[0];
  await send(env, '/logout', { headers: { Cookie: cookie } });
  for (let i = 0; i < 5; i++) await post(env, { passphrase: wrong }, { ip });
  env.ASSETS = { fetch: async () => { throw new Error(`assets failed near ${PASSPHRASE}`); } };
  await send(env, '/', { headers: { Cookie: cookie } });
  const events = lines.map((line) => JSON.parse(line));
  assert.deepEqual(events.map((e) => e.outcome), ['failure', 'success', 'logout', 'failure', 'failure', 'failure', 'failure', 'locked', 'error']);
  assert.ok(events.every((e) => e.event === 'enablement.signin' && !Number.isNaN(Date.parse(e.at))));
  assert.equal(events[0].address, ip);
  assert.equal(events[0].ray, 'ray-1');
  assert.equal(events.at(-1).error, 'Error');
  for (const line of lines) {
    for (const forbidden of [PASSPHRASE, KEY_HEX, cookie.split('=')[1], wrong, '/glossary/', 'assets failed']) {
      assert.ok(!line.includes(forbidden), 'a logged line holds nothing typed, signed or secret');
    }
  }
});

test('no response carries the passphrase or the cookie key', async () => {
  const { env } = makeEnv();
  const cookie = await cookieFromSignIn(env);
  const responses = [
    await send(env, '/'),
    await send(env, '/auth'),
    await send(env, '/auth?return=%2Fx'),
    await post(env, { passphrase: 'wrong' }, { ip: '203.0.113.80' }),
    await signIn(env, {}, { ip: '203.0.113.81' }),
    await send(env, '/', { headers: { Cookie: cookie } }),
    await send(env, '/logout'),
    await send(env, '/', { method: 'PUT', body: 'x' }),
    await send(makeEnv({ COOKIE_SECRET: undefined }).env, '/auth'),
  ];
  const keyBase64 = Buffer.from(KEY_HEX, 'hex').toString('base64');
  for (const res of responses) {
    const text = `${[...res.headers].map(([k, v]) => `${k}: ${v}`).join('\n')}\n${await res.text()}`;
    assert.ok(!text.includes(PASSPHRASE), 'the passphrase');
    assert.ok(!text.includes(KEY_HEX) && !text.includes(keyBase64), 'the cookie key');
  }
});

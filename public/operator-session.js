// public/operator-session.js — the operator's sign-in, shared by the operator surfaces.
//
// A person signs in once with an email and a password. The platform answers with a
// fifteen-minute access token and a seven-day refresh token; this keeps both, renews the
// access token in the background before it runs out, hands the current token to the page
// on request, and signs out. Nothing here is ever typed by a person except the email and
// the password. The token is also mirrored into the older `tuning-token` slot so a page
// that still reads it keeps working until it adopts this module.
(() => {
  const KEY = 'operator-session';
  const LEGACY = 'tuning-token';
  const listeners = [];
  const expOf = (jwt) => { try { return (JSON.parse(atob(String(jwt).split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).exp || 0) * 1000; } catch { return 0; } };
  let s = null;
  try { s = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { s = null; }

  function save(next) {
    s = next;
    try { if (next) localStorage.setItem(KEY, JSON.stringify(next)); else localStorage.removeItem(KEY); } catch { /* storage may be unavailable */ }
    try { if (next) sessionStorage.setItem(LEGACY, next.accessToken); else sessionStorage.removeItem(LEGACY); } catch { /* same */ }
    for (const f of listeners) { try { f(s); } catch { /* a listener's error is its own */ } }
  }
  async function post(path, body, headers = {}) {
    const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body || {}) });
    let data = null; try { data = await res.json(); } catch { data = null; }
    return { ok: res.ok, status: res.status, data: data || {} };
  }

  /** Sign in. Resolves with the user; rejects with a sentence a person can read. */
  async function signIn(email, password) {
    const r = await post('/auth/login', { email: String(email || '').trim(), password: String(password || '') });
    if (!r.ok || !r.data.accessToken) throw new Error(r.status === 401 || r.status === 400 ? 'That email and password were not accepted.' : 'Sign-in did not go through. Try again in a moment.');
    save({ accessToken: r.data.accessToken, refreshToken: r.data.refreshToken, exp: expOf(r.data.accessToken), user: r.data.user || null });
    return s.user;
  }
  /** Renew the access token with the refresh token. A refusal ends the session. */
  async function refresh() {
    if (!s || !s.refreshToken) return null;
    const r = await post('/auth/refresh', { refreshToken: s.refreshToken });
    if (!r.ok || !r.data.accessToken) { save(null); return null; }
    save({ ...s, accessToken: r.data.accessToken, exp: expOf(r.data.accessToken), user: r.data.user || s.user });
    return s.accessToken;
  }
  /** The current access token, renewed first when it is about to run out; empty when signed out. */
  async function token() {
    if (!s) return '';
    if (Date.now() > (s.exp || 0) - 60_000) await refresh();
    return s ? s.accessToken : '';
  }
  async function signOut() {
    const t = s && s.accessToken;
    save(null);
    if (t) { try { await post('/auth/logout', {}, { authorization: `Bearer ${t}` }); } catch { /* signed out locally regardless */ } }
  }

  // Keep the session alive while the tab is open: renew a few minutes before the token runs out.
  setInterval(() => { if (s && Date.now() > (s.exp || 0) - 3 * 60_000) refresh().catch(() => {}); }, 60_000);
  // A session found on load whose token has already run out is renewed at once.
  if (s && Date.now() > (s.exp || 0) - 60_000) refresh().catch(() => {});

  window.OperatorSession = {
    signIn, signOut, token, refresh,
    user: () => (s ? s.user : null),
    signedIn: () => Boolean(s),
    onChange: (f) => { listeners.push(f); },
  };
})();

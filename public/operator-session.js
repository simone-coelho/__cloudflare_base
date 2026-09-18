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
  let tenantOf = null;
  let renewing = null;
  let generation = 0;
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
    const tenant = tenantOf && tenantOf();
    const controller = new AbortController();
    let timer;
    try {
      return await Promise.race([(async () => {
        const res = await fetch(path, { method: 'POST', redirect: 'manual', credentials: 'same-origin', signal: controller.signal,
          headers: { 'Content-Type': 'application/json', ...(tenantOf ? { 'X-Tenant': tenant } : {}), ...headers }, body: JSON.stringify(body || {}) });
        let data = null; try { data = await res.json(); } catch { data = null; }
        return { ok: res.ok && !controller.signal.aborted, status: res.status, data: data || {} };
      })(), new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('Sign-in request timed out.')); }, 10000); })]);
    } finally { clearTimeout(timer); controller.abort(); }
  }

  /** Sign in. Resolves with the user; rejects with a sentence a person can read. */
  async function signIn(email, password) {
    const currentGeneration = ++generation, tenant = tenantOf && tenantOf();
    const r = await post('/auth/login', { email: String(email || '').trim(), password: String(password || '') });
    if (currentGeneration !== generation || tenant !== (tenantOf && tenantOf())) return null;
    if (!r.ok || !r.data.accessToken) throw new Error(r.status === 401 || r.status === 400 ? 'That email and password were not accepted.' : 'Sign-in did not go through. Try again in a moment.');
    save({ accessToken: r.data.accessToken, refreshToken: r.data.refreshToken, exp: expOf(r.data.accessToken), user: r.data.user || null, mustChangePassword: Boolean(r.data.mustChangePassword) });
    return s.user;
  }
  async function startFederation(email) {
    const currentGeneration = ++generation, tenant = tenantOf && tenantOf();
    const r = await post('/auth/oidc/start', { email: String(email || '').trim() });
    if (currentGeneration !== generation || tenant !== (tenantOf && tenantOf())) return null;
    if (!r.ok || typeof r.data.authorizationUrl !== 'string') throw new Error('Federated sign-in is unavailable for this account and tenant.');
    const url = new URL(r.data.authorizationUrl);
    if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new Error('Federated sign-in destination refused.');
    return url.href;
  }
  async function completeFederation() {
    const currentGeneration = ++generation, tenant = tenantOf && tenantOf();
    const r = await post('/auth/oidc/complete', {});
    if (currentGeneration !== generation || tenant !== (tenantOf && tenantOf())) return null;
    if (!r.ok || !r.data.accessToken || !r.data.refreshToken) throw new Error('Federated sign-in was not completed. Start again.');
    save({ accessToken: r.data.accessToken, refreshToken: r.data.refreshToken, exp: expOf(r.data.accessToken), user: r.data.user || null, mustChangePassword: false });
    return s.user;
  }
  /** Change the signed-in person's own password. Resolves when done; rejects with a sentence. */
  async function changePassword(currentPassword, newPassword) {
    if (!s) throw new Error('Sign in first.');
    const current = s;
    const r = await post('/auth/password', { currentPassword: String(currentPassword || ''), newPassword: String(newPassword || '') }, { authorization: `Bearer ${current.accessToken}` });
    // Access renewal may finish during the request; logout or a new login wins.
    if (!s || !current.refreshToken || s.refreshToken !== current.refreshToken) return null;
    if (!r.ok) throw new Error(r.data.error || 'The password was not changed.');
    if (!r.data.accessToken || !r.data.refreshToken) {
      save(null);
      throw new Error('Password changed. Sign in again to continue.');
    }
    save({ ...s, accessToken: r.data.accessToken, refreshToken: r.data.refreshToken,
      exp: expOf(r.data.accessToken), user: r.data.user || s.user, mustChangePassword: false });
    return s.user;
  }
  /** Renew the access token with the refresh token. A refusal ends the session. */
  async function refresh() {
    if (renewing) return renewing;
    if (!s || !s.refreshToken) return null;
    const current = s;
    renewing = (async () => {
      const r = await post('/auth/refresh', { refreshToken: current.refreshToken });
      if (s !== current) return null; // logout or a newer session must win
      if (!r.ok || !r.data.accessToken) { save(null); return null; }
      save({ ...s, accessToken: r.data.accessToken, exp: expOf(r.data.accessToken), user: r.data.user || s.user, mustChangePassword: r.data.mustChangePassword !== undefined ? Boolean(r.data.mustChangePassword) : Boolean(s.mustChangePassword) });
      return s.accessToken;
    })();
    try { return await renewing; } finally { renewing = null; }
  }
  /** The current access token, renewed first when it is about to run out; empty when signed out. */
  async function token() {
    if (!s) return '';
    if (Date.now() > (s.exp || 0) - 60_000) await refresh();
    return s ? s.accessToken : '';
  }
  async function signOut() {
    ++generation;
    const t = s && s.accessToken;
    save(null);
    if (t) { try { await post('/auth/logout', {}, { authorization: `Bearer ${t}` }); } catch { /* signed out locally regardless */ } }
  }

  // Keep the session alive while the tab is open: renew a few minutes before the token runs out.
  setInterval(() => { if (tenantOf && s && Date.now() > (s.exp || 0) - 3 * 60_000) refresh().catch(() => {}); }, 60_000);
  // The page sets its explicit tenant provider before token() renews a stored
  // session. Never send an eager refresh before the page has selected context.

  window.OperatorSession = {
    signIn, signOut, token, refresh, changePassword, startFederation, completeFederation,
    setTenantProvider: (provider) => { ++generation; tenantOf = provider; },
    user: () => (s ? s.user : null),
    signedIn: () => Boolean(s),
    isAdmin: () => Boolean(s && s.user && Array.isArray(s.user.roles) && s.user.roles.includes('admin')),
    mustChangePassword: () => Boolean(s && s.mustChangePassword),
    onChange: (f) => { listeners.push(f); },
  };
})();

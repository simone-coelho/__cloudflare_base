#!/usr/bin/env node
// scripts/console-operator.mjs
// ---------------------------------------------------------------------------
// An operator account on a LOCAL worker, with a password you chose, made the
// way a person would make one:
//
//   1. an admin creates the account          POST /auth/users
//   2. the platform answers with a temporary password, once
//   3. the person signs in with it           POST /auth/login
//   4. and changes it before anything else   POST /auth/password
//
// Open registration is closed (2026-09-05), and rightly, so there is no shortcut
// and this does not want one: it goes through the routes and never near the
// store. The admin token is minted from the dev JWT settings in wrangler.toml,
// which is what every local script in this repo already does. That is only
// possible because the dev secret is in the file; against a deployed stamp an
// admin signs in and creates the account from the Accounts screen.
//
//   node scripts/console-operator.mjs http://localhost:9200 ops@local.test a-password
// ---------------------------------------------------------------------------
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';

const base = (process.argv[2] || 'http://localhost:9200').replace(/\/+$/, '');
const email = process.argv[3] || 'ops@local.test';
const password = process.argv[4] || 'local-pass-1234';

if (!/localhost|127\.0\.0\.1/.test(base)) {
  console.error('This mints an admin token from the dev secret, so it is for a local worker only.');
  process.exit(1);
}
if (password.length < 10) {
  console.error('A password needs at least ten characters.');
  process.exit(1);
}

const toml = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
const v = (k) => (toml.match(new RegExp(`^${k} = "([^"]+)"`, 'm')) || [])[1];
const b64 = (s) => Buffer.from(s).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const head = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
const body = b64(JSON.stringify({ sub: 'console-preview-admin', email: 'admin@local.test', name: 'Preview Admin', roles: ['admin'], permissions: ['*'], iss: v('JWT_ISSUER'), aud: v('JWT_AUDIENCE'), iat: now, exp: now + 600 }));
const adminToken = `${head}.${body}.${createHmac('sha256', v('JWT_SECRET')).update(`${head}.${body}`).digest('base64url')}`;

const call = async (path, body, token) => {
  const res = await fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
};

/** The preview account is an ADMIN, because the preview exists to be looked at
    and the Accounts screen is an admin's. A real brand's people are operators;
    an admin is the person who creates them. */
async function ensureAdmin() {
  const users = await fetch(`${base}/auth/users`, { headers: { authorization: `Bearer ${adminToken}` } })
    .then((r) => r.json()).catch(() => ({}));
  const found = (users.users || []).find((u) => u.email === email);
  if (!found || (found.roles || []).includes('admin')) return;
  await fetch(`${base}/auth/users/${encodeURIComponent(found.id)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ roles: ['admin'] }),
  });
  console.log('  Raised to admin, so the Accounts screen has something to show.');
}

// 1. Does it already work? Then there is nothing to do but check the role.
const already = await call('/auth/login', { email, password });
if (already.status === 200 && !already.data.mustChangePassword) {
  console.log(`▸ Operator already there and its password is set: ${email}`);
  await ensureAdmin();
  process.exit(0);
}

// 2. Create it, unless it exists.
let temporary = null;
const made = await call('/auth/users', { email, name: 'Local Ops', roles: ['admin'] }, adminToken);
if (made.status === 201) {
  temporary = made.data.temporaryPassword;
  console.log(`▸ Operator created by an admin: ${email}`);
} else if (made.status === 409) {
  // It exists with some other password. An admin can issue a new temporary one.
  const id = already.data && already.data.user ? already.data.user.id : null;
  const users = await fetch(`${base}/auth/users`, { headers: { authorization: `Bearer ${adminToken}` } }).then((r) => r.json()).catch(() => ({}));
  const found = (users.users || []).find((u) => u.email === email);
  if (!found && !id) { console.error('  The account exists but could not be found to reset.'); process.exit(1); }
  const reset = await call(`/auth/users/${encodeURIComponent(found ? found.id : id)}/reset`, {}, adminToken);
  if (reset.status !== 200) { console.error(`  Could not reset the account (HTTP ${reset.status}).`); process.exit(1); }
  temporary = reset.data.temporaryPassword;
  console.log(`▸ Operator was already there; an admin issued a new temporary password: ${email}`);
} else {
  console.error(`  Could not create the account (HTTP ${made.status}): ${made.data.error || ''}`);
  process.exit(1);
}

// 3 and 4. Sign in with the temporary password and change it, as the console asks a person to.
const signedIn = await call('/auth/login', { email, password: temporary });
if (signedIn.status !== 200) { console.error(`  The temporary password was not accepted (HTTP ${signedIn.status}).`); process.exit(1); }
const changed = await call('/auth/password', { currentPassword: temporary, newPassword: password }, signedIn.data.accessToken);
if (changed.status !== 200) { console.error(`  The password was not changed: ${changed.data.error || changed.status}`); process.exit(1); }
await ensureAdmin();
console.log(`  Password set. Sign in with ${email} and the password this script was given.`);

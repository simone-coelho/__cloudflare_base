#!/usr/bin/env node
// scripts/identity-proof.mjs — CW25 proven live against a running worker.
//
//   node scripts/identity-proof.mjs [http://localhost:9100]
//
// A phone and a laptop browse as strangers, both sign in to the same account,
// and the person is the sum; a straggler by visitor id still lands on the person;
// history by account id builds someone who has never visited; a browser that
// carries a shopper id is refused a second account; the data team's doors answer
// with the operator token and refuse without it. Every line is a real request.
//
// Needs the site key (X-SDK-Key, default demo-site) because the worker is
// enforced, and mints an operator token from wrangler.toml's dev JWT settings.

import { createHmac } from 'node:crypto';

const B = process.argv[2] || process.env.BASE || 'http://localhost:9100';
const SDK_KEY = process.env.SDK_KEY || 'demo-site';
const TENANT = 'coach';
const run = Date.now().toString(36);
const PHONE = `vis-phone-${run}`;
const LAPTOP = `vis-laptop-${run}`;
const ACCOUNT = `acct-${run}`;

const b64u = (s) => Buffer.from(s).toString('base64url');
function mintToken() {
  const secret = process.env.JWT_SECRET || 'development-secret-key-change-in-production';
  const now = Math.floor(Date.now() / 1000);
  const h = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const p = b64u(JSON.stringify({ sub: 'identity-proof', iss: process.env.JWT_ISSUER || 'edge-platform', aud: process.env.JWT_AUDIENCE || 'edge-platform-api', iat: now, exp: now + 600 }));
  return `${h}.${p}.${createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url')}`;
}
const TOKEN = mintToken();

let pass = 0, fail = 0;
const ok = (cond, label, detail = '') => { if (cond) { pass++; console.log(`  ✓ ${label}`); } else { fail++; console.log(`  ✗ ${label} ${detail}`); } };

async function j(path, init = {}) {
  const headers = { 'Content-Type': 'application/json', 'X-SDK-Key': SDK_KEY, ...(init.headers || {}) };
  const res = await fetch(`${B}${path}`, { ...init, headers, body: init.body === undefined ? undefined : (typeof init.body === 'string' ? init.body : JSON.stringify(init.body)) });
  let body = null; try { body = await res.json(); } catch { /* not json */ }
  return { status: res.status, body, cookie: res.headers.get('set-cookie') || '' };
}
const view = (userId, productId) => j('/realtime/action', { method: 'POST', body: { type: 'product_view', userId, source: 'identity-proof', data: { productId, action: 'product_view' } } });
const reflex = (userId) => j(`/realtime/reflex?userId=${encodeURIComponent(userId)}`);
const auth = { Authorization: `Bearer ${TOKEN}` };

console.log(`CW25 identity proof against ${B} (run ${run})`);

// 1. Two devices, two strangers.
console.log('\n1. two devices browse as strangers');
for (let i = 0; i < 3; i++) await view(PHONE, 'COA-CH857');     // Tabby ×3
for (const p of ['COA-CP133', 'COA-CP133', 'COA-CH857']) await view(LAPTOP, p);   // Rogue ×2, Tabby ×1
const phoneBefore = await reflex(PHONE);
const laptopBefore = await reflex(LAPTOP);
ok(phoneBefore.status === 200 && phoneBefore.body?.affinity?.dims?.line?.Tabby > 0, 'the phone knows Tabby', JSON.stringify(phoneBefore.body?.affinity?.dims));
ok(laptopBefore.status === 200 && Object.keys(laptopBefore.body?.affinity?.dims?.line ?? {}).length > 0, 'the laptop knows its own lines', JSON.stringify(laptopBefore.body?.affinity?.dims));

// 2. The phone signs in.
console.log('\n2. the phone signs in');
const linkPhone = await j(`/v1/${TENANT}/identity/link`, { method: 'POST', body: { visitorId: PHONE, accountId: ACCOUNT, source: 'login' } });
ok(linkPhone.status === 200 && linkPhone.body?.outcome === 'linked', 'link accepted, outcome linked', JSON.stringify(linkPhone.body));
const SH = linkPhone.body?.shopperId;
ok(typeof SH === 'string' && /^sh_[0-9a-f]{32}$/.test(SH), `the person is named ${SH}`);
ok(linkPhone.body?.carry === SH, 'the response says which id to carry');
ok(linkPhone.cookie.includes('opt_session_id=') && linkPhone.cookie.includes(`opt_user_id=${SH}`), 'the cookie moved to the person');
ok(!linkPhone.cookie.includes(ACCOUNT), 'the account id is nowhere in the response cookies');

// 3. The laptop signs in to the same account: cross-device.
console.log('\n3. the laptop signs in to the same account');
const linkLaptop = await j(`/v1/${TENANT}/identity/link`, { method: 'POST', body: { visitorId: LAPTOP, accountId: ACCOUNT, source: 'checkout' } });
ok(linkLaptop.body?.shopperId === SH, 'same account, same person');
ok(linkLaptop.body?.outcome === 'linked', 'second device folded in');
const person = await reflex(SH);
const lines = person.body?.affinity?.dims?.line ?? {};
ok(person.status === 200 && lines.Tabby > 0 && Object.keys(lines).length >= 2, 'the person carries both devices’ lines', JSON.stringify(lines));
ok((person.body?.affinity?.audiences ?? []).some((a) => /tabby/i.test(a)), 'the person is in the Tabby audience', JSON.stringify(person.body?.affinity?.audiences));

// 4. Stragglers by visitor id, no cookie: still the person.
console.log('\n4. a request that still carries the old visitor id');
const straggler = await reflex(PHONE);
const sl = straggler.body?.affinity?.dims?.line ?? {};
ok(straggler.status === 200 && Object.keys(sl).length >= 2, 'the phone’s old id reads the person’s vector', JSON.stringify(sl));
const strayView = await view(LAPTOP, 'COA-CH857');
ok(strayView.status === 200 && strayView.body?.success === true, 'a stray event on the laptop’s old id is accepted');

// 5. A browser carrying a shopper id cannot be linked to another account.
console.log('\n5. the shared computer rule');
const refused = await j(`/v1/${TENANT}/identity/link`, { method: 'POST', body: { visitorId: SH, accountId: `other-${run}` } });
ok(refused.status === 409, 'a shopper id is refused a second account (409)', String(refused.status));

// 6. The data team's doors.
console.log('\n6. the data team’s doors');
const noToken = await j(`/v1/${TENANT}/identity/visitor/${PHONE}`);
ok(noToken.status === 401, 'visitor lookup refuses without the operator token', String(noToken.status));
const visitor = await j(`/v1/${TENANT}/identity/visitor/${PHONE}`, { headers: auth });
ok(visitor.status === 200 && visitor.body?.shopperId === SH && visitor.body?.link?.source === 'login', 'visitor lookup resolves the phone to the person');
const shopper = await j(`/v1/${TENANT}/identity/shopper/${SH}`, { headers: auth });
const visitors = (shopper.body?.shopper?.visitors ?? []).map((v) => v.visitorId).sort();
ok(shopper.status === 200 && visitors.join() === [LAPTOP, PHONE].sort().join(), 'shopper record lists both browsers', visitors.join());
ok(!JSON.stringify(shopper.body).includes(ACCOUNT), 'the account id is not on the shopper record');
const resolve = await j(`/v1/${TENANT}/identity/resolve`, { method: 'POST', headers: auth, body: { accountIds: [ACCOUNT] } });
ok(resolve.body?.resolved?.[ACCOUNT] === SH, 'resolve gives the warehouse the same id');

// 7. History for someone who has never visited.
console.log('\n7. history by account id, for a person who has never visited');
const ACCOUNT2 = `acct-hist-${run}`;
const hist = await j(`/v1/${TENANT}/identity/events`, { method: 'POST', headers: auth, body: { rows: [
  { accountId: ACCOUNT2, action: 'purchase', at: Date.now() - 20_000, product: { line: 'Brooklyn', price_usd: 495 } },
  { accountId: ACCOUNT2, action: 'purchase', at: Date.now() - 10_000, product: { line: 'Brooklyn', price_usd: 495 } },
  { accountId: ACCOUNT2, action: 'purchase', at: '2024-01-01T00:00:00Z', product: { line: 'Rogue' } },   // ancient: dust
  { accountId: ACCOUNT2, action: 'purchase', at: Date.now() - 5_000, product: { sku: 'nothing-the-registry-reads' } },
] } });
ok(hist.status === 200 && hist.body?.applied === 3 && hist.body?.skipped?.length === 1, 'three rows applied, one skipped and named', JSON.stringify(hist.body));
const SH2 = hist.body?.perShopper?.[0]?.shopperId;
const csv = `account_id,action,at,line,price_usd\n${ACCOUNT2},add_to_cart,${Math.floor(Date.now() / 1000) - 3},Brooklyn,495\n`;
const histCsv = await j(`/v1/${TENANT}/identity/events`, { method: 'POST', headers: { ...auth, 'Content-Type': 'text/csv' }, body: csv });
ok(histCsv.status === 200 && histCsv.body?.applied === 1, 'a CSV row lands on the same person', JSON.stringify(histCsv.body));
const person2 = await reflex(SH2);
const d2 = person2.body?.affinity?.dims ?? {};
ok(d2.line?.Brooklyn > 0 && !(d2.line?.Rogue > 0.01), 'recent purchases count, the 2024 one is dust', JSON.stringify(d2.line));
ok(d2.priceBand?.elevated > 0, 'the derived price band scored from the imported price (495 is elevated: cuts at 150 and 400)', JSON.stringify(d2.priceBand));
const rec2 = await j(`/v1/${TENANT}/identity/shopper/${SH2}`, { headers: auth });
ok(rec2.body?.shopper?.history?.rows === 4, 'the shopper record counts the history applied', JSON.stringify(rec2.body?.shopper?.history));

// 8. Then she signs in for the first time on a fresh phone: the import is waiting for her.
console.log('\n8. her first visit');
const FRESH = `vis-fresh-${run}`;
await view(FRESH, 'COA-CH857');
const first = await j(`/v1/${TENANT}/identity/link`, { method: 'POST', body: { visitorId: FRESH, accountId: ACCOUNT2 } });
ok(first.body?.shopperId === SH2 && first.body?.outcome === 'linked', 'her first sign-in finds the person the import built');
ok((first.body?.audiences ?? []).some((a) => /brooklyn/i.test(a)), 'and she is already in the Brooklyn audience', JSON.stringify(first.body?.audiences));

// 9. Detach.
console.log('\n9. detach');
const detach = await j(`/v1/${TENANT}/identity/detach`, { method: 'POST' });
ok(detach.status === 200 && detach.cookie.includes('opt_session_id=; Max-Age=0'), 'detach clears the session cookie');
const stillThere = await reflex(SH2);
ok(stillThere.body?.affinity?.dims?.line?.Brooklyn > 0, 'and the person is untouched');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

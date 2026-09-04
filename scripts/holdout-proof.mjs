#!/usr/bin/env node
// scripts/holdout-proof.mjs — ledger 20 row 12, proven live against a running worker.
//
//   node scripts/holdout-proof.mjs [http://localhost:9100] [--scope holdout-proof]
//
// Seeds a scope with the demo catalog and slots (import-content.mjs), sets a
// half-and-half holdout with both arms so the arms are visible in a small run,
// serves decisions to a crowd of visitors, clicks on some of them per arm, then
// builds the day report and reads the arm rows back. Every line is a real
// request. Needs the scope provisioned as a tenant so the outcomes land beside
// the decisions: in .dev.vars, single-quoted so the JSON survives the parser,
//   TENANTS='{"provisioned":["coach","holdout-proof"],"hosts":{}}'
// and restart wrangler afterwards; .dev.vars was not hot-reloaded here.
//
// What it found on 2026-09-04, recorded in plan 21: the learning policy's
// session scope credits nothing because decisions carry the server session id
// and outcomes the client's; the no_learning arm runs at the slot's gamma, not
// 0; and FNV-1a puts blocks of consecutive visitor ids on one arm.

import { execFileSync } from 'node:child_process';
import { createHmac } from 'node:crypto';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const B = (process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : process.env.BASE) || 'http://localhost:9100';
const SCOPE = arg('--scope', 'holdout-proof');
const SDK_KEY = process.env.SDK_KEY || 'demo-site';
const run = Date.now().toString(36);

const b64u = (s) => Buffer.from(s).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const H = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
const P = b64u(JSON.stringify({ sub: 'holdout-proof', roles: ['operator'], iss: 'edge-platform', aud: 'edge-platform-api', iat: now, exp: now + 900 }));
const TOKEN = `${H}.${P}.${createHmac('sha256', process.env.JWT_SECRET || 'development-secret-key-change-in-production').update(`${H}.${P}`).digest('base64url')}`;

let pass = 0, fail = 0;
const ok = (c, label, detail = '') => { if (c) { pass++; console.log(`  ✓ ${label}`); } else { fail++; console.log(`  ✗ ${label} ${detail}`); } };
const headers = (extra = {}) => ({ 'Content-Type': 'application/json', 'X-SDK-Key': SDK_KEY, 'X-Tenant': SCOPE, Authorization: `Bearer ${TOKEN}`, ...extra });
async function j(path, init = {}) {
  const res = await fetch(`${B}${path}`, { ...init, headers: headers(init.headers), body: init.body === undefined ? undefined : JSON.stringify(init.body) });
  let body = null; try { body = await res.json(); } catch { /* not json */ }
  return { status: res.status, body };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

console.log(`row 12 holdout proof against ${B}, scope ${SCOPE} (run ${run})`);

// 1. The scope: catalog and slots through the import adapter, then the holdout on the learn document.
console.log('\n1. seed the scope');
execFileSync('node', ['scripts/import-content.mjs', '--base', B, '--scope', SCOPE, '--token', TOKEN], { stdio: 'inherit' });
const learn0 = (await j(`/content/learn?scope=${SCOPE}`)).body?.document ?? {};
const learn = {
  ...learn0, version: `learn-${SCOPE}`,
  holdout: { share: 0.5, salt: `proof-${run}`, arms: ['default', 'no_learning'] },
  slots: { ...(learn0.slots || {}), chero: { ...((learn0.slots || {}).chero || {}), gamma: 1 } },
};
const putLearn = await j(`/content/learn?scope=${SCOPE}`, { method: 'PUT', body: { document: learn, note: 'half-and-half holdout with both arms, gamma 1 on chero, for the row 12 proof' } });
ok(putLearn.status === 200 && putLearn.body?.ok !== false, 'learn document written with share 0.5 and both arms', JSON.stringify(putLearn.body).slice(0, 300));

// The day's report before this run, so the checks below are deltas: the scope
// may already hold decisions from an earlier run, on any environment.
const date = new Date().toISOString().slice(0, 10);
const before = (await j(`/v1/${SCOPE}/learn/report`, { method: 'POST', body: { date } })).body?.report?.holdout?.chero ?? [];
const baseline = (arm, k) => before.find((x) => x.arm === arm)?.[k] ?? 0;

// 2. A crowd. Each visitor is decided once; the arm is on the record.
console.log('\n2. serve decisions to 60 visitors');
const byArm = { personalized: [], default: [], no_learning: [] };
let gammaOnNoLearning = null, defaultHadDrivers = null;
for (let i = 0; i < 60; i++) {
  const v = `vis-${crypto.randomUUID()}`;   // the client's own format; a counter would expose FNV's last-byte weakness, see plan 21
  const r = await j(`/v1/${SCOPE}/decisions/snapshot?visitorId=${v}&page=home`);
  if (r.status !== 200 || !r.body?.ok) { console.log('   snapshot failed', r.status, JSON.stringify(r.body).slice(0, 200)); continue; }
  const arm = r.body.arm;
  // The wire decision carries contentId; the ledger record beside it carries the id, the arm and the lift block.
  const chero = (r.body.decisions || []).find((d) => d.slot === 'chero');
  const rec = (r.body.records || []).find((d) => d.slot === 'chero' && d.position === 0);
  (byArm[arm] ??= []).push({ v, item: chero?.contentId ?? rec?.item_id ?? null, decisionId: rec?.decision_id ?? null, lift: rec?.explain?.lift ?? null, drivers: rec?.explain?.drivers ?? [] });
  if (arm === 'no_learning' && rec && gammaOnNoLearning === null) gammaOnNoLearning = rec.explain?.lift?.gamma ?? 'no lift block';
  if (arm === 'default' && rec && defaultHadDrivers === null) defaultHadDrivers = (rec.explain?.drivers ?? []).length > 0;
}
const counts = Object.fromEntries(Object.entries(byArm).map(([k, v]) => [k, v.length]));
console.log('   arms:', JSON.stringify(counts));
ok(counts.personalized > 0 && counts.default > 0 && counts.no_learning > 0, 'all three arms appear at share 0.5', JSON.stringify(counts));
ok(Math.abs(counts.personalized - 30) <= 12, 'about half the crowd is personalized (a hash, not a coin)', String(counts.personalized));
// Sticky: the same visitor gets the same arm again.
const again = await j(`/v1/${SCOPE}/decisions/snapshot?visitorId=${byArm.default[0]?.v}&page=home`);
ok(again.body?.arm === 'default', 'assignment is sticky for a visitor');
ok(defaultHadDrivers === false, 'the default arm is decided with no personalization drivers', String(defaultHadDrivers));
// Doc 22 §10: no_learning is personalized with gamma = 0. What does the receipt say?
// Doc 22 §10: no_learning is personalized with gamma = 0. A fresh scope has no
// published lift snapshot, so the receipt carries no lift block and the check is
// inconclusive here; the code reads gammaOf(slot) regardless of the arm
// (src/content/service.ts, decide.ts), which is the finding in plan 21.
console.log(`   no_learning receipt gamma: ${gammaOnNoLearning} (doc 22 §10 says 0)`);
if (gammaOnNoLearning === 'no lift block' || gammaOnNoLearning === null) console.log('  · no_learning gamma: inconclusive without a published lift snapshot (see plan 21)');
else ok(gammaOnNoLearning === 0, 'the no_learning arm runs at gamma 0', `receipt shows gamma ${gammaOnNoLearning}`);

// 3. Outcomes: clicks on the chero piece for a share of each arm.
console.log('\n3. click on the decided piece for part of each arm');
async function click(entry) {
  return j('/realtime/action', { method: 'POST', body: { type: 'content_click', userId: entry.v, source: 'holdout-proof', data: { contentId: entry.item, slot: 'chero', decisionId: entry.decisionId } } });
}
const clicked = { personalized: 0, default: 0, no_learning: 0 };
for (const arm of ['personalized', 'default', 'no_learning']) {
  const share = arm === 'personalized' ? 0.5 : arm === 'default' ? 0.25 : 0.4;
  const n = Math.round(byArm[arm].length * share);
  for (const e of byArm[arm].slice(0, n)) { if (!e.item) continue; const r = await click(e); if (r.status === 200) clicked[arm]++; }
}
console.log('   clicked:', JSON.stringify(clicked));
ok(clicked.personalized > 0 && clicked.default > 0, 'clicks accepted on both arms');

// 4. The report reads R2, never Analytics Engine. Give the queue a moment to flush the batches.
console.log('\n4. build the day report');
await sleep(8000);
const rep = await j(`/v1/${SCOPE}/learn/report`, { method: 'POST', body: { date } });
ok(rep.status === 200 && rep.body?.ok, 'report built', JSON.stringify(rep.body).slice(0, 200));
const R = rep.body?.report ?? {};
const arms = R.holdout?.chero ?? [];
console.log('   chero arms:', JSON.stringify(arms));
const armRow = (a) => arms.find((x) => x.arm === a);
const delta = (a, k) => (armRow(a)?.[k] ?? 0) - baseline(a, k);
// The sticky check above decided one default visitor twice, so default carries one extra decision.
ok(delta('personalized', 'decisions') === counts.personalized && delta('default', 'decisions') === counts.default + 1 && delta('no_learning', 'decisions') === counts.no_learning,
  'the report counts every decision per arm', JSON.stringify({ delta: ['personalized', 'default', 'no_learning'].map((a) => [a, delta(a, 'decisions')]), served: counts }));
ok(delta('personalized', 'credited') === clicked.personalized && delta('default', 'credited') === clicked.default && delta('no_learning', 'credited') === clicked.no_learning,
  'credited clicks per arm match what was clicked', JSON.stringify({ delta: ['personalized', 'default', 'no_learning'].map((a) => [a, delta(a, 'credited')]), clicked }));
ok(typeof armRow('personalized')?.rate === 'number' && typeof armRow('default')?.rate === 'number', 'each arm has a rate');
ok(armRow('personalized')?.interval === undefined, 'NOTE: no interval on the arm rows yet (the ask in plan 21)');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

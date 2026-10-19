// src/units/H3/ORIGIN.unit.test.ts
// Unit H3-1 — the kit's connection check (scripts/verify-origin.sh) passes against a customer-profile stamp.
//
// THE DEFECTS, measured on the staging stamp: (1) its first check, `/health/ready` with no tenant, read an outage
// (PROBE.unit.test.ts is the property); (2) its "signed default decisions" check required `snapshot.write === false`,
// a member today's snapshot answer does not carry (src/routes/decisions.ts builds `payload` without it; `out.write` is
// internal to the route), so a shopper under explicit refusal, answered correctly, read as a failure.
//
// THE PROOF EXECUTES THE SCRIPT. The REAL script is run as a child process, over HTTP, against the REAL Worker default
// export on a customer stamp (the W08 stamp's environment, its publication initialized through the owner's own door
// `POST /content/publication/initialize`). The only thing between them is a node http server that hands each request to
// `worker.fetch`; a variant of it may rewrite the snapshot answer, to prove the check refuses what it must.
//
// THE ONE CHECK THIS HARNESS CANNOT ANSWER is 'signed live-channel handshake': an HTTP 101 upgrade needs the platform's
// WebSocketPair, which node does not have. That check is read from the live rig (the lead's local-rig run), not here;
// every other check is asserted.
//
// The kit's promise for a refusing shopper (docs/kit/02-api-reference.md:331): "Tracking-refused choices contain no render
// offer; personalization-refused choices use defaults. `sources.consent` names that state."; `arm` is "the experience served" (:1327).

import { vi, describe, it, expect, beforeAll, afterAll } from 'vitest';
vi.mock('agents', () => ({ routeAgentRequest: async () => { throw new Error('the Agents router is not on these paths'); } }));
vi.mock('agents/ai-chat-agent', () => ({ AIChatAgent: class {} }));
vi.mock('@cloudflare/puppeteer', () => ({ default: {} }));

import { spawn } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';

import type { Env } from '@/types/env';
import { CHECKOUT_ROOT } from '../_native';
import { customerStamp, SDK_KEY, TENANT, type Stamp } from '../W08/_customer';

type Worker = { fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> };
const PAGE_ORIGIN = 'https://shop.example.invalid';
const SCRIPT = resolve(CHECKOUT_ROOT, 'scripts/verify-origin.sh');
const SNAPSHOT = `/v1/${TENANT}/decisions/snapshot`;
const HANDSHAKE = 'signed live-channel handshake';
/** The nine named checks, in the order the script prints them. */
const CHECKS = ['signing readiness only', 'credentialed browser preflight', 'signed anonymous session', 'explicit refusal preserved',
  'signed default decisions', 'site key required', 'wrong site key refused', 'signed event under refusal', HANDSHAKE];

type Rewrite = (body: Record<string, unknown>) => Record<string, unknown>;
let stamp: Stamp, worker: Worker, server: Server, base = '';
let rewrite: Rewrite | null = null;

beforeAll(async () => {
  stamp = await customerStamp('session');
  const env = stamp.env as unknown as Record<string, unknown>;
  // A ready stamp (its identity material names both provisioned tenants, 32 bytes or more) that allows the page's origin.
  env.IDENTITY_SECRETS = 'acme:h3-1-identity-proof-material-for-acme-0123,globex:h3-1-identity-proof-material-for-globex-0123';
  env.CORS_ORIGINS = PAGE_ORIGIN;
  env.SDK_KEYS = `${TENANT}:${SDK_KEY}`;
  worker = (await import('@/index')).default as unknown as Worker;
  const initialized = await stamp.call('POST', '/content/publication/initialize');
  if (initialized.status !== 200) throw new Error(`the stamp's publication was not initialized: ${initialized.status} ${JSON.stringify(initialized.body).slice(0, 200)}`);
  const retained: Promise<unknown>[] = [];
  const ctx = { waitUntil: (p: Promise<unknown>) => { retained.push(p); }, passThroughOnException() { /* never */ }, props: {} } as unknown as ExecutionContext;
  server = createServer((incoming, outgoing) => {
    void (async () => {
      const chunks: Buffer[] = []; for await (const chunk of incoming) chunks.push(chunk as Buffer);
      const headers = new Headers(); for (const [k, v] of Object.entries(incoming.headers)) if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(', ') : v);
      headers.delete('host');
      const hasBody = !['GET', 'HEAD'].includes(incoming.method ?? 'GET');
      const request = new Request(`https://stamp.invalid${incoming.url}`, { method: incoming.method, headers, ...(hasBody ? { body: Buffer.concat(chunks) } : {}) });
      const response = await worker.fetch(request, stamp.env, ctx);
      let text = await response.text();
      if (rewrite && incoming.url === SNAPSHOT && response.status === 200) text = JSON.stringify(rewrite(JSON.parse(text) as Record<string, unknown>));
      const out: Record<string, string> = {}; response.headers.forEach((v, k) => { if (!['content-length', 'content-encoding', 'transfer-encoding'].includes(k)) out[k] = v; });
      outgoing.writeHead(response.status, out); outgoing.end(text);
      while (retained.length) await Promise.all(retained.splice(0)).catch(() => undefined);
    })().catch(() => { outgoing.writeHead(500); outgoing.end(); });
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}, 60_000);
afterAll(() => new Promise<void>(r => { server.closeAllConnections(); server.close(() => r()); }));

/** Run the real script; its lines `PASS <name>` / `FAIL <name>` as a name -> verdict map, and its closing line. */
async function verify(): Promise<{ verdicts: Record<string, string>; last: string; code: number | null }> {
  const child = spawn('bash', [SCRIPT, base, PAGE_ORIGIN, SDK_KEY, TENANT], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; child.stdout.on('data', d => { out += d; }); child.stderr.on('data', d => { out += d; });
  const code = await new Promise<number | null>(r => child.on('close', r));
  const lines = out.trim().split('\n');
  const verdicts: Record<string, string> = {};
  for (const line of lines) { const m = /^(PASS|FAIL) (.+)$/.exec(line); if (m) verdicts[m[2]!] = m[1]!; }
  return { verdicts, last: lines.at(-1) ?? '', code };
}
/** The lines the script printed for every check but the handshake, as one array a failure prints whole. */
const everythingButHandshake = (except: string[] = []) => CHECKS.filter(c => c !== HANDSHAKE).map(c => `${except.includes(c) ? 'FAIL' : 'PASS'} ${c}`);
const withoutHandshake = (verdicts: Record<string, string>) => Object.entries(verdicts).filter(([name]) => name !== HANDSHAKE).map(([name, verdict]) => `${verdict} ${name}`);

describe('unit:H3.1 the connection check against a customer-profile stamp', () => {
  it('every check but the live-channel handshake passes against the real Worker: no tenant on the probe, and the answer a refusing shopper is given', async () => {
    rewrite = null;
    const { verdicts } = await verify();
    expect(Object.keys(verdicts)).toEqual(CHECKS);
    expect(withoutHandshake(verdicts)).toEqual(everythingButHandshake());
  }, 120_000);

  // Each is one shape of answer the check must refuse; each flips ONLY that check.
  const MUTANTS: Array<[string, Rewrite]> = [
    ['the arm is not the default', b => ({ ...b, arm: 'personalized' })],
    ['decisions is not an array', b => ({ ...b, decisions: 'none' })],
    ['a decision carries a render offer', b => ({ ...b, decisions: [{ contentId: 'x', renderOffer: 'ro1.x' }] })],
    ['the consent names tracking', b => ({ ...b, sources: { ...(b.sources as object), consent: { ...((b.sources as { consent: object }).consent), tracking: true } } })],
    ['the consent names personalization', b => ({ ...b, sources: { ...(b.sources as object), consent: { ...((b.sources as { consent: object }).consent), personalization: true } } })],
    ['no consent is named', b => ({ ...b, sources: {} })],
  ];
  for (const [name, mutate] of MUTANTS) {
    it(`refuses an answer where ${name}`, async () => {
      rewrite = mutate;
      try { expect(withoutHandshake((await verify()).verdicts)).toEqual(everythingButHandshake(['signed default decisions'])); }
      finally { rewrite = null; }
    }, 120_000);
  }

  it('does not require a `write` member, which the answer never carried; and does not accept one in its place', async () => {
    rewrite = b => ({ ...b, write: false });
    try { expect(withoutHandshake((await verify()).verdicts)).toEqual(everythingButHandshake()); }
    finally { rewrite = null; }
    rewrite = b => { const { arm: _arm, ...rest } = b; return { ...rest, write: false }; };
    try { expect(withoutHandshake((await verify()).verdicts)).toEqual(everythingButHandshake(['signed default decisions'])); }
    finally { rewrite = null; }
  }, 120_000);
});

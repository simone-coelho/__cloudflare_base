// src/content/consent.test.ts
// CW31 (BTIE D10), the content service's half: either switch off means the
// site's defaults whatever the holdout hash says; tracking off means the
// engine writes nothing about the request (no ring, no exposure, no ledger);
// a host that says nothing is consenting, which is what every stored session
// already says today.

import { describe, it, expect, beforeEach } from 'vitest';
import type { Env } from '@/types/env';
import { invalidateCache, write } from '@/config/versionedStore';
import { CONTENT_KIND, LEARN_KIND, SLOTS_KIND } from './kinds';
import { armUnder, consentFromCookies, consentOf, personalizes } from './consent';
import { serveContentDecisions } from './service';

class FakeKV {
  store = new Map<string, string>();
  async get(key: string): Promise<unknown> { const raw = this.store.get(key); return raw === undefined ? null : JSON.parse(raw); }
  async put(key: string, value: string): Promise<void> { this.store.set(key, value); }
}
/** A namespace whose one object answers every fetch with `reply` and records what was asked. */
const fakeNs = (reply: unknown, calls: string[]) => ({
  idFromName: (n: string) => n,
  get: (id: string) => ({ fetch: async (url: string, init?: { method?: string }) => { calls.push(`${id} ${init?.method ?? 'GET'} ${new URL(url).pathname}`); return new Response(JSON.stringify(reply), { status: 200, headers: { 'Content-Type': 'application/json' } }); } }),
}) as unknown as DurableObjectNamespace;

const piece = (id: string) => ({ id, customerContentId: `cms-${id}`, type: 'editorial', title: id, tags: { line: ['Drover'] }, slotTypes: ['hero'] });

async function envWith(snapshot: Record<string, unknown>): Promise<{ env: Env; ring: string[]; shopper: string[] }> {
  const ring: string[] = [], shopper: string[] = [];
  const env = {
    CACHE: new FakeKV(), REFLEX_HOST: 'do', ENVIRONMENT: 'test',
    SHOPPER_REFLEX: fakeNs({ ok: true, affinity: null, journeyStage: 'mid', ...snapshot }, shopper),
    DECISION_RING: fakeNs({ ok: true }, ring),
  } as unknown as Env;
  invalidateCache();
  await write(env, CONTENT_KIND, 'coach', { pieces: [piece('a'), piece('b')] }, { actor: 'test' });
  await write(env, SLOTS_KIND, 'coach', { pages: { home: [{ slot: 'hero', take: 1, weights: { line: 0.5 } }] } }, { actor: 'test' });
  await write(env, LEARN_KIND, 'coach', { holdout: { share: 0, salt: '', arms: ['default'] } }, { actor: 'test' });
  return { env, ring, shopper };
}
const serve = (env: Env) => serveContentDecisions(env, { tenant: 'coach', page: 'home', visitorId: 'v1', sessionId: 's1', channel: 'direct', cf: null, cookieHeader: null, stateTenant: 'coach' });

describe('CW31 consent, the pure part', () => {
  it('reads either source, treats absence as consenting, and forces the default arm when either switch is off', () => {
    expect(consentOf(null)).toEqual({ tracking: true, personalization: true });
    expect(consentOf({ preferences: { trackingConsent: false, personalizationEnabled: true } })).toEqual({ tracking: false, personalization: true });
    expect(consentOf({ consent: { tracking: true, personalization: false } })).toEqual({ tracking: true, personalization: false });
    expect(consentOf({ consent: { tracking: 'false' } })).toEqual({ tracking: false, personalization: true });
    expect(consentFromCookies('opt_session=abc; opt_tracking_consent=false; opt_personalization_enabled=true')).toEqual({ tracking: false, personalization: true });
    expect(consentFromCookies(null)).toEqual({ tracking: true, personalization: true });
    expect(armUnder({ tracking: true, personalization: true }, 'personalized')).toBe('personalized');
    expect(armUnder({ tracking: true, personalization: false }, 'personalized')).toBe('default');
    expect(armUnder({ tracking: false, personalization: true }, 'no_learning')).toBe('default');
    expect(personalizes({ tracking: true, personalization: false })).toBe(false);
  });
});

describe('CW31 consent on the content service', () => {
  beforeEach(() => invalidateCache());

  it('a consenting shopper is personalized, recorded, and fed to the ring', async () => {
    const { env, ring } = await envWith({});
    const out = await serve(env);
    await out.afterResponse;
    expect(out.arm).toBe('personalized');
    expect(out.write).toBe(true);
    expect(out.sources.consent).toEqual({ tracking: true, personalization: true, personalized: true });
    expect(out.records).toHaveLength(1);
    expect(out.records[0]!.explain.note ?? '').not.toContain('shopper');
    expect(ring).toEqual(['coach:v1 POST /append']);
  });

  it('tracking withheld: the defaults, no ring, no ledger, and the receipt says why', async () => {
    const { env, ring } = await envWith({ consent: { tracking: false, personalization: true } });
    const out = await serve(env);
    await out.afterResponse;
    expect(out.arm).toBe('default');
    expect(out.write).toBe(false);
    expect(out.sources.consent).toEqual({ tracking: false, personalization: true, personalized: false });
    expect(out.records[0]!.arm).toBe('default');
    expect(out.records[0]!.explain.note).toContain('personalization is off by the shopper');
    expect(ring).toEqual([]);
  });

  it('personalization withheld with tracking on: the defaults, still recorded', async () => {
    const { env, ring } = await envWith({ consent: { tracking: true, personalization: false } });
    const out = await serve(env);
    await out.afterResponse;
    expect(out.arm).toBe('default');
    expect(out.write).toBe(true);
    expect(out.records[0]!.explain.note).toContain('personalization is off by the shopper');
    expect(ring).toEqual(['coach:v1 POST /append']);
  });
});

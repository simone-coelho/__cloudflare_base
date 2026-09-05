// src/ops/monitor.test.ts
// The monitor's pure parts: what counts as a problem, what the webhook
// receives, and the alert's cooldown and recovery rules.

import { describe, it, expect } from 'vitest';
import type { Env } from '@/types/env';
import { alert, alertPayload, problemsOf, type MonitorResult } from './monitor';

class FakeKV {
  store = new Map<string, string>();
  async get(key: string, type?: string): Promise<unknown> { const raw = this.store.get(key); if (raw === undefined) return null; return type === 'json' ? JSON.parse(raw) : raw; }
  async put(key: string, value: string): Promise<void> { this.store.set(key, value); }
}

describe('the monitor', () => {
  it('names a failed check and a slow decision as problems, and nothing else', () => {
    expect(problemsOf({ kv: { ok: true, ms: 3 }, decision: { ok: true, ms: 120 } })).toEqual([]);
    expect(problemsOf({ kv: { ok: false, ms: 5000, detail: 'timed out' }, decision: { ok: true, ms: 2100 } })).toEqual(['kv failed: timed out (5000 ms)', 'a decision took 2100 ms, above 1500 ms']);
    expect(problemsOf({ decision: { ok: true, ms: 900 } }, { decisionMs: 800 })).toEqual(['a decision took 900 ms, above 800 ms']);
  });

  it('the webhook receives a sentence and the facts', () => {
    const r: MonitorResult = { at: Date.UTC(2026, 8, 5, 12, 0, 0), tenant: 'coach', environment: 'production', ok: false, checks: { database: { ok: false, ms: 40, detail: 'no such table' } }, problems: ['database failed: no such table (40 ms)'] };
    const p = alertPayload(r);
    expect(p.text).toBe('production: coach has a problem at 2026-09-05T12:00:00.000Z: database failed: no such table (40 ms)');
    expect(alertPayload({ ...r, ok: true, problems: [] }).text).toBe('production: coach recovered at 2026-09-05T12:00:00.000Z');
  });

  it('alerts once per half hour per tenant, always on recovery, and never without a webhook', async () => {
    const posts: string[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (_url: unknown, init?: { body?: string }) => { posts.push(String(init?.body)); return new Response('ok', { status: 200 }); }) as typeof fetch;
    try {
      const env = { CACHE: new FakeKV(), ALERT_WEBHOOK_URL: 'https://hooks.example.test/x' } as unknown as Env;
      const bad: MonitorResult = { at: 1_000_000, tenant: 'coach', environment: 'staging', ok: false, checks: {}, problems: ['kv failed (1 ms)'] };
      expect(await alert(env, bad, 1_000_000)).toBe('sent');
      expect(await alert(env, bad, 1_000_000 + 60_000)).toBe('cooling-down');
      expect(await alert(env, bad, 1_000_000 + 31 * 60_000)).toBe('sent');
      expect(await alert(env, { ...bad, ok: true, problems: [] }, 1_000_000 + 32 * 60_000)).toBe('sent');
      expect(posts).toHaveLength(3);
      expect(JSON.parse(posts[2]!).text).toContain('recovered');
      expect(await alert({ CACHE: new FakeKV() } as unknown as Env, bad)).toBe('no-webhook');
    } finally { globalThis.fetch = realFetch; }
  });
});

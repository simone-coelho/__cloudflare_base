// src/identity/erase.ts
// ---------------------------------------------------------------------------
// CW28: the right to be forgotten, end to end.
//
// A person is a shopper id and every browser ever linked to it. Erasing them
// means, in this order: the link table (so no browser resolves to them again),
// every profile that held their behaviour (the person's session and each
// browser's, or the shopper objects on the object host), and their rows in the
// ledger, which the other session's eraseVisitorLedger() handles with a
// tombstone every reader honours at once and a nightly rewrite of the batches.
//
// A visitor id that was never linked is erased on its own: its profile and its
// ledger rows. A visitor id that was linked erases the whole person, because
// the browser's behaviour already folded into them and a partial erasure would
// leave it there.
//
// What this does not reach: ODP (Optimizely Data Platform) holds its own copy
// under the vuid derived from the id; its erasure is ODP's API, run by the
// brand's operator, and the receipt says so. Analytics Engine holds aggregate
// points with no identifier worth erasing.
// ---------------------------------------------------------------------------

import type { Env } from '@/types/env';
import type { TenantId } from '@/tenancy/tenant';
import { shopperObject } from '@/tenancy/objects';
import { SessionManager } from '@/services/SessionManager';
import { IdentityStore } from '@/identity/store';
import { isShopperId } from '@/identity/shopperId';
import { eraseVisitorLedger } from '@/ledger/erasure';

export interface EraseReceipt {
  tenant: string;
  /** What was asked for. */
  subject: { visitorId?: string; shopperId?: string };
  /** The person this resolved to, if the subject was linked. */
  shopperId: string | null;
  /** Every id whose profile and ledger rows were erased. */
  erased: string[];
  profiles: Array<{ id: string; host: 'session' | 'object'; result: 'erased' | 'absent' | 'failed' }>;
  ledger: Array<{ id: string; tombstone: string | null; ring: string }>;
  links: { visitors: number; shopper: boolean };
  /** What this cannot reach, said plainly. */
  notReached: string[];
  actor: string;
  at: number;
}

async function eraseProfile(env: Env, tenant: TenantId, id: string, ownSessionId: string | null): Promise<EraseReceipt['profiles'][number]> {
  if ((env.REFLEX_HOST ?? 'session') === 'do') {
    try {
      const res = await shopperObject(env.SHOPPER_REFLEX, id, tenant).fetch('https://shopper-reflex/reset', { method: 'POST' });
      return { id, host: 'object', result: res.ok ? 'erased' : 'failed' };
    } catch { return { id, host: 'object', result: 'failed' }; }
  }
  const sm = new SessionManager(env, { tenant });
  try {
    const sid = await sm.resolveSessionIdByUserId(id);
    // The record the pointer names (the person's, after a link), then the pointer
    // itself and the browser's own pre-link record, which nothing else reaches.
    const ok = sid ? await sm.deleteSession(sid) : false;
    await sm.forgetVisitor(id, ownSessionId);
    return { id, host: 'session', result: sid || ownSessionId ? (ok || !sid ? 'erased' : 'failed') : 'absent' };
  } catch { return { id, host: 'session', result: 'failed' }; }
}

export async function eraseSubject(
  env: Env,
  tenant: TenantId,
  subject: { visitorId?: string; shopperId?: string },
  actor: string,
  now = Date.now(),
): Promise<EraseReceipt> {
  const store = new IdentityStore(env.SESSIONS as never, tenant);

  // 1. Who is being forgotten.
  let shopperId: string | null = subject.shopperId ?? null;
  if (!shopperId && subject.visitorId) shopperId = isShopperId(subject.visitorId) ? subject.visitorId : await store.resolveVisitor(subject.visitorId);

  const ids = new Map<string, string | null>();   // id → the browser's own session record, when the link remembered one
  let links: EraseReceipt['links'] = { visitors: 0, shopper: false };
  if (shopperId) {
    const own = new Map<string, string>();
    const rec = await store.shopper(shopperId);
    for (const v of rec?.visitors ?? []) { const l = await store.visitorLink(v.visitorId); if (l?.ownSessionId) own.set(v.visitorId, l.ownSessionId); }
    const { visitors } = await store.erase(shopperId);
    links = { visitors: visitors.length, shopper: true };
    ids.set(shopperId, null);
    for (const v of visitors) ids.set(v, own.get(v) ?? null);
    if (subject.visitorId && !ids.has(subject.visitorId)) ids.set(subject.visitorId, null);
  } else if (subject.visitorId) {
    const { ownSessionId } = await store.eraseVisitor(subject.visitorId);
    ids.set(subject.visitorId, ownSessionId);
  }

  // 2. Every profile, then 3. every ledger row.
  const profiles: EraseReceipt['profiles'] = [];
  const ledger: EraseReceipt['ledger'] = [];
  for (const [id, ownSessionId] of ids) {
    profiles.push(await eraseProfile(env, tenant, id, ownSessionId));
    try {
      const r = await eraseVisitorLedger(env, tenant, id, actor, now);
      ledger.push({ id, tombstone: r.tombstone.key, ring: r.ring });
    } catch {
      ledger.push({ id, tombstone: null, ring: 'failed' });
    }
  }

  return {
    tenant, subject, shopperId, erased: [...ids.keys()], profiles, ledger, links,
    notReached: ['ODP: the profile under the derived vuid is erased through ODP\'s own API by the brand\'s operator'],
    actor, at: now,
  };
}

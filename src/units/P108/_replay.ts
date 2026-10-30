// src/units/P108/_replay.ts
// P108.XB2 round 2 (R-P708): the worlds in which a decision's exploration-rules
// marker is written and read, shared by src/units/P108/LEDGER.unit.test.ts and
// by the one-off capture that recorded the v1 receipts of ./_v1Records.ts at
// fedda087 (so the receipts and the worlds they replay in are one definition).
//
//   logic — unit:W28.R2's idiom (src/units/W28/LEDGER.unit.test.ts replayWorld,
//     currentReceipt): the tenant's documents at revision 1 in memory, the
//     decision by the real `decideContent`, the replay by the real
//     `replayDecision` with the real `replayDeps`.
//   host  — the mounted app on either host (src/units/_parity.ts), served-v1
//     without the durable recovery path (R-P14), the decision by the serving
//     route's own composer (`servePage`), the replay through
//     `GET /v1/:tenant/replay/:decisionId` (`replayOf`).
// Both worlds explore the page's layout slot by rotation at share 1, floor 50,
// at the pinned hour, for a shopper with P04's three Tabby views.

import { expect } from 'vitest';

import { initializePublicationSet, invalidatePublicationCache, type PublicationBaseline } from '@/config/publication';
import { invalidateCache } from '@/config/versionedStore';
import { decideContent } from '@/content/decide';
import { CONTENT_KIND, LEARN_KIND, SLOTS_KIND } from '@/content/kinds';
import { invalidateLiftCache } from '@/content/service';
import type { ContentPiece, DecisionRecord, LearnConfig, SlotStrategy } from '@/content/types';
import { REFLEX_KIND, reflexScopeForTenant } from '@/reflex/configStore';
import { DEFAULT_REFLEX_CONFIG } from '@/reflex/core';
import { captureRetention, RETENTION_CATEGORIES, type RetentionCategory, type RetentionPolicy } from '@/retention';
import type { Env } from '@/types/env';

import {
  declaredSlots, expectPublished, LAYOUT, layoutSlot, learnDocument, MODULES, mount, PAGE_VIEW, PAID_SOCIAL_ENTRY, recentSlot, servePage,
  shopperOn, storedDecisions, TABBY_VIEWS, TENANT, toLedger, UnitKV, UnitR2, type Host, type Mounted, type Shopper,
} from '../_parity';
import { drawnAs, type Pin, PINNED_AT } from './_pins';

/** The exploration dials of both worlds: rotation at share 1, floor 50. */
export const SHARE_1 = { mode: 'rotation', share: 1, floor: 50 } as const;

// ---------------------------------------------------------------------------
// logic
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;
const POLICY: RetentionPolicy = { id: 'p108-fixture-policy', revision: 1, durationMs: 365 * DAY_MS, basis: 'admitted', renewal: 'new-record-only' };
/** The page's layout slot as a plain slot of the pdp page, over the registered modules (src/units/_parity.ts MODULES, layoutSlot's weights). */
const SLOT: SlotStrategy = { slot: LAYOUT, take: 4, weights: { line: 1, category: 0.5, occasion: 0.5 } } as SlotStrategy;
const PIECES = MODULES.filter(p => !['module.PDP.lookbook.1', 'module.PDP.charms.1', 'module.PDP.recent.1', 'module.PDP.reviews.1'].includes(p.id)) as unknown as ContentPiece[];
/** The interest vector three Tabby views build (P02.A2): the line Tabby, the occasion evening and the category Handbags. */
const AFFINITY = { dims: { line: { Tabby: 0.6 }, occasion: { evening: 0.3 }, category: { Handbags: 0.4 } } };

/** The tenant's documents at revision 1, no lift archive (every module under the floor), as the replay reads them. */
export async function logicWorld(): Promise<Env> {
  invalidateCache(); invalidateLiftCache(); invalidatePublicationCache();
  const env = {
    DEPLOYMENT_PROFILE: 'demo', CACHE: new UnitKV(), STORAGE: new UnitR2(),
    TENANTS: JSON.stringify({ provisioned: [TENANT] }),
    RETENTION: JSON.stringify({ version: 1, tenants: { [TENANT]: Object.fromEntries(RETENTION_CATEGORIES.map(c => [c, POLICY])) as Record<RetentionCategory, RetentionPolicy> } }),
  } as unknown as Env;
  const learn = { version: 'p108-logic', holdout: { share: 0, salt: '', arms: ['default'] }, slots: { [LAYOUT]: { gamma: 0, exploration: SHARE_1 } } } as unknown as LearnConfig;
  const baseline = (kind: PublicationBaseline['kind'], value: unknown, scope: string = TENANT): PublicationBaseline =>
    ({ kind, scope, revision: { revision: 1, at: 1, actor: 'p108-fixture', note: 'fixture', value } });
  await initializePublicationSet(env, [
    baseline(CONTENT_KIND, { pieces: PIECES }), baseline(SLOTS_KIND, { pages: { pdp: [SLOT] } }), baseline(LEARN_KIND, learn),
    baseline(REFLEX_KIND, DEFAULT_REFLEX_CONFIG, reflexScopeForTenant(TENANT)),
  ], '0:' + crypto.randomUUID());
  invalidatePublicationCache();
  return env;
}

/** The receipts the engine under test writes for the visitor's page load at `nowMs` (unit:W28.R2's seam), position order. */
export function logicReceipts(env: Env, visitorId: string, nowMs = PINNED_AT): DecisionRecord[] {
  const set = decideContent({
    tenant: TENANT, brand: TENANT, page: 'pdp', visitorId, sessionId: visitorId, identityAnchor: 'visitor', nowMs,
    pieces: PIECES, slots: [SLOT], affinity: AFFINITY, cell: { channel: 'paid_social', visit_bucket: '1', region: null, affinity: 'line:Tabby' },
    arm: 'personalized', versions: { config: 1, catalog: 1, slots: 1, learn: 1, lift: 0, prior: 0, policy: 1 }, configLabel: 'p108-logic', candidateLimit: 10,
    learning: { snapshots: {}, gammaOf: () => 0, exploreOf: () => SHARE_1, controlOf: () => null,
      metadataOf: () => ({ reward: 'click', objective: 'unit', measurementBasis: 'served-v1' }) },
  } as unknown as Parameters<typeof decideContent>[0]);
  return set.records.filter(r => r.slot === LAYOUT).sort((a, b) => a.position - b.position).map(r => ({ ...r, retention: captureRetention(env, TENANT, r.ts) }));
}

// ---------------------------------------------------------------------------
// host
// ---------------------------------------------------------------------------

/** The declared layout slot exploring at share 1, served-v1, without the durable recovery path (R-P14). Build it at the pinned hour. */
export async function hostWorld(host: Host): Promise<Mounted> {
  const m = await mount(host, { pieces: MODULES, slots: declaredSlots([layoutSlot(), recentSlot()]), learn: learnDocument({ [LAYOUT]: { reward: 'click', exploration: SHARE_1 } }) },
    { recovery: false });
  expectPublished(m, 'P108.XB2 — the declared layout slot exploring at share 1, served-v1, publishes');
  return m;
}

/** P04's shopper drawn as the pinned visitor: an arrival from paid social and three Tabby views. */
export async function tabbyShopperAs(m: Mounted, pin: Pick<Pin, 'uuid' | 'subject'>): Promise<Shopper> {
  const s = await drawnAs(pin, () => shopperOn(m));
  expect((await s.action(PAGE_VIEW, PAID_SOCIAL_ENTRY)).status, `${m.host}: PRECONDITION — the shopper's page view is accepted`).toBe(200);
  for (const view of TABBY_VIEWS.slice(0, 3)) expect((await s.action(view)).status, `${m.host}: PRECONDITION — the shopper's view is accepted`).toBe(200);
  return s;
}

/** The layout slot's decisions the real producer and consumer stored for the visitor's page, in position order. */
export async function hostRecords(m: Mounted, s: Shopper): Promise<DecisionRecord[]> {
  const set = await servePage(m, s, 'pdp', { offer: false });
  await toLedger(m, set.records);
  return storedDecisions(m, s.subject).filter(r => r.slot === LAYOUT).sort((a, b) => a.position - b.position);
}

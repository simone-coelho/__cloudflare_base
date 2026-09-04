// src/identity/store.ts
// ---------------------------------------------------------------------------
// The link table: which browsers belong to which person.
//
// Two records, both under the brand's prefix in the SESSIONS namespace, beside
// the profiles they describe:
//
//   identity:visitor:{visitorId}   → the shopper this browser was linked to,
//                                    when, how sure we were, and where it came
//                                    from. A browser re-linked to a different
//                                    account keeps its history here.
//   identity:shopper:{shopperId}   → every browser linked to this person, and
//                                    whether the id was minted with a salt.
//
// The raw account id appears in neither. What the warehouse can join on is the
// shopper id, which is on every record that leaves; the site's backend can
// compute it (same salt, same hash) or ask `POST /v1/:tenant/identity/resolve`.
//
// These are NOT on the decision path. A request for a linked browser is served
// from the profile that already carries the pointer (SessionManager's
// `forwardTo`, the shopper object's `forwardTo`), so an anonymous visitor costs
// nothing here and a linked one costs nothing here either. The table is for the
// link itself, for resolution queries, and for doc 22's `identity` scope.
// ---------------------------------------------------------------------------

import { DEFAULT_TENANT, TenantKV, type KVLike, type TenantId } from '@/tenancy/tenant';
import type { Assurance } from '@/identity/assertion';
import { isShopperId } from '@/identity/shopperId';

/** A link lives a long time; it is the memory the scope promises identity lengthens. */
export const LINK_TTL_S = 400 * 24 * 3600;

export type LinkSource = 'login' | 'signup' | 'checkout' | 'import' | 'other';

export interface VisitorLink {
  visitorId: string;
  shopperId: string;
  linkedAt: number;
  assurance: Assurance;
  source: LinkSource;
  /** Earlier links this browser had, newest first. A shared computer leaves a trail here. */
  previous?: Array<{ shopperId: string; linkedAt: number; until: number }>;
}

export interface ShopperRecord {
  shopperId: string;
  createdAt: number;
  salted: boolean;
  visitors: Array<{ visitorId: string; linkedAt: number; assurance: Assurance; source: LinkSource }>;
  /** Historical rows applied to this shopper, if any: how many and the latest event time. */
  history?: { rows: number; latestAt: number; appliedAt: number };
}

export class IdentityStore {
  private readonly kv: KVLike;

  constructor(kv: KVLike, readonly tenant: TenantId = DEFAULT_TENANT) {
    this.kv = new TenantKV(kv, tenant);
  }

  private vkey(visitorId: string) { return `identity:visitor:${visitorId}`; }
  private skey(shopperId: string) { return `identity:shopper:${shopperId}`; }

  async visitorLink(visitorId: string): Promise<VisitorLink | null> {
    return ((await this.kv.get(this.vkey(visitorId), 'json')) as VisitorLink | null) ?? null;
  }

  async shopper(shopperId: string): Promise<ShopperRecord | null> {
    return ((await this.kv.get(this.skey(shopperId), 'json')) as ShopperRecord | null) ?? null;
  }

  /**
   * The person behind an id, or null when the id is an unlinked browser.
   * A shopper id resolves to itself: once a client carries it, it is the person.
   * This is the resolver doc 22's `identity` attribution scope needs.
   */
  async resolveVisitor(id: string): Promise<string | null> {
    if (isShopperId(id)) return id;
    return (await this.visitorLink(id))?.shopperId ?? null;
  }

  /**
   * Record that a browser belongs to a person. Idempotent for the same pair;
   * a different person moves the browser and keeps the old link in `previous`.
   * Returns what changed, so the caller knows whether a merge is due: a browser
   * already on this shopper has nothing left to merge.
   */
  async link(input: {
    visitorId: string; shopperId: string; assurance: Assurance; source: LinkSource; salted: boolean; now?: number;
  }): Promise<{ link: VisitorLink; shopper: ShopperRecord; outcome: 'linked' | 'already' | 'relinked' }> {
    const now = input.now ?? Date.now();
    const existing = await this.visitorLink(input.visitorId);

    let outcome: 'linked' | 'already' | 'relinked' = 'linked';
    let previous = existing?.previous;
    if (existing) {
      if (existing.shopperId === input.shopperId) outcome = 'already';
      else {
        outcome = 'relinked';
        previous = [{ shopperId: existing.shopperId, linkedAt: existing.linkedAt, until: now }, ...(existing.previous ?? [])].slice(0, 10);
      }
    }

    const link: VisitorLink = {
      visitorId: input.visitorId, shopperId: input.shopperId,
      linkedAt: outcome === 'already' ? existing!.linkedAt : now,
      assurance: input.assurance, source: input.source,
      ...(previous && previous.length ? { previous } : {}),
    };

    const shopper: ShopperRecord = (await this.shopper(input.shopperId)) ?? {
      shopperId: input.shopperId, createdAt: now, salted: input.salted, visitors: [],
    };
    if (!shopper.visitors.some((v) => v.visitorId === input.visitorId)) {
      shopper.visitors.push({ visitorId: input.visitorId, linkedAt: now, assurance: input.assurance, source: input.source });
      shopper.visitors = shopper.visitors.slice(-50);
    }

    if (outcome !== 'already') await this.kv.put(this.vkey(input.visitorId), JSON.stringify(link), { expirationTtl: LINK_TTL_S });
    await this.kv.put(this.skey(input.shopperId), JSON.stringify(shopper), { expirationTtl: LINK_TTL_S });
    return { link, shopper, outcome };
  }

  /** Make sure a shopper record exists, for a person seen first through an import. */
  async ensureShopper(shopperId: string, salted: boolean, now = Date.now()): Promise<ShopperRecord> {
    const existing = await this.shopper(shopperId);
    if (existing) return existing;
    const created: ShopperRecord = { shopperId, createdAt: now, salted, visitors: [] };
    await this.kv.put(this.skey(shopperId), JSON.stringify(created), { expirationTtl: LINK_TTL_S });
    return created;
  }

  async noteHistory(shopperId: string, rows: number, latestAt: number, salted: boolean, now = Date.now()): Promise<void> {
    const rec = await this.ensureShopper(shopperId, salted, now);
    const prev = rec.history;
    rec.history = {
      rows: (prev?.rows ?? 0) + rows,
      latestAt: Math.max(prev?.latestAt ?? 0, latestAt),
      appliedAt: now,
    };
    await this.kv.put(this.skey(shopperId), JSON.stringify(rec), { expirationTtl: LINK_TTL_S });
  }
}

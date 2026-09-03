// src/tenancy/objects.ts
// ---------------------------------------------------------------------------
// Per-shopper Durable Objects, scoped to a brand.
//
// A Durable Object is addressed by NAME, and the per-shopper objects were named
// by visitor id alone. So one shopper browsing two brands was one object holding
// one merged affinity profile, exactly like the `session:{id}` collision in KV,
// except here the object holds the interest vector every decision is made from.
//
// TWO THINGS MAKE THIS SHARPER THAN THE KV CASE.
//
// A DO name is permanent and the namespace cannot be listed. An object orphaned
// by a naming change is invisible and its storage lingers, with no way to
// enumerate what was stranded. That is why the default tenant stays unprefixed
// here too, and why it matters more: a KV key written under the wrong prefix can
// at least be found again.
//
// And the namespace escape is worse. Visitor ids arrive as `userId` on every
// action, so a caller could ask for the object named `t:kate-spade:vis-victim`
// and, under the default tenant, be handed exactly that brand's shopper object.
// tenantKey() refuses it, which is the same guard as KV, applied at the place
// where the affinity state actually lives.
// ---------------------------------------------------------------------------

import { DEFAULT_TENANT, tenantKey, type TenantId } from '@/tenancy/tenant';

/** The shape this module needs from a DurableObjectNamespace, so tests can fake it. */
export interface DONamespaceLike<Id = unknown, Stub = unknown> {
  idFromName(name: string): Id;
  get(id: Id): Stub;
}

/**
 * The name a per-shopper object takes for this brand.
 *
 * The default tenant gets the bare visitor id, so every object that already
 * exists keeps its identity and its stored affinity. Every other brand is
 * namespaced.
 *
 * Throws if the visitor id tries to address a namespace directly. Routes should
 * validate ids at the boundary; this is the layer that cannot be forgotten.
 */
export function shopperObjectName(tenant: TenantId, visitorId: string): string {
  return tenantKey(tenant, visitorId);
}

/** A stub for this brand's per-shopper object. */
export function shopperObject<Id, Stub>(
  ns: DONamespaceLike<Id, Stub>,
  visitorId: string,
  tenant: TenantId = DEFAULT_TENANT,
): Stub {
  return ns.get(ns.idFromName(shopperObjectName(tenant, visitorId)));
}

/**
 * A stub for a SINGLETON object, which is not per-shopper and not per-brand.
 *
 * `admin` and `health-check` are one object for the whole worker on purpose. This
 * exists so a reader can tell at the call site that the missing tenant is a
 * decision rather than an omission, which is the failure mode this whole file is
 * written against: tenancy that looks finished because the default is invisible.
 */
export function singletonObject<Id, Stub>(ns: DONamespaceLike<Id, Stub>, name: string): Stub {
  return ns.get(ns.idFromName(name));
}

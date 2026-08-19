// src/connectors/SegmentProvider.ts
// (a) SegmentProvider — mirrors ODP (Optimizely Data Platform) real-time segments.
// `fetchQualifiedSegments` is the exact ODP/JS-SDK method name so the live swap is
// literal. See docs/architecture/05-demo-build-spec.md §1.1.
//
// REAL SEAMS, MOCKED CALLS: this interface is named after the real ODP call. The
// Mock adapter evaluates published AudienceDefs from the shared AudienceStore against
// the live QualificationContext (identical condition-tree semantics to the future live
// path); the Live adapter has the real wiring shape but throws NotWiredError until
// ODP credentials are supplied. Flipping mock ↔ live is config-only (CONNECTOR_MODE).

import type { SegmentKey, QualificationContext } from './types';
import type { AudienceStore } from './AudienceStore';
import { evaluateCondition } from './evaluateCondition'; // pure fn, shared with the live path
import { NotWiredError } from './types';

export interface SegmentProvider {
  /** ODP: return every real-time segment key the user currently qualifies for. */
  fetchQualifiedSegments(userId: string, ctx?: QualificationContext): Promise<SegmentKey[]>;

  /** Convenience predicate used by the engine for fast single-segment checks. */
  isQualifiedFor(userId: string, segment: SegmentKey, ctx?: QualificationContext): Promise<boolean>;
}

/**
 * Mock adapter — evaluates published AudienceDefs (seeded + Opal-created) against the
 * live QualificationContext using the same condition-tree evaluator the live path uses.
 * This is the linchpin that makes Hero Moment 3 look real: a brand-new Opal audience
 * becomes qualifiable with ZERO code change because the mock provider reads audiences
 * from the shared AudienceStore (the same store MockAudienceAuthoring writes to).
 */
export class MockSegmentProvider implements SegmentProvider {
  constructor(private store: AudienceStore) {}

  async fetchQualifiedSegments(userId: string, ctx?: QualificationContext): Promise<SegmentKey[]> {
    const audiences = await this.store.listPublished(); // seed + Opal-created, all here
    const context = ctx ?? { userId, attributes: {}, segments: [] };
    // Surface scoping (multi-demo isolation): when the caller declares a surface,
    // only THAT surface's audiences are evaluated — otherwise counter-based
    // audiences from one demo ('product_views gte 3') qualify the other demo's
    // shoppers. An untagged audience is the default surface's by definition, so a
    // coach context evaluates exactly the set it always did.
    const surface = context.surface;
    return audiences
      .filter(
        (a) =>
          a.evaluation === 'realtime' &&
          (surface === undefined || (a.surface ?? 'coach') === surface) &&
          evaluateCondition(a.conditions, context.attributes)
      )
      .map((a) => a.key);
  }

  async isQualifiedFor(
    userId: string,
    segment: SegmentKey,
    ctx?: QualificationContext
  ): Promise<boolean> {
    return (await this.fetchQualifiedSegments(userId, ctx)).includes(segment);
  }
}

/**
 * Live adapter stub — real shape, inert until wired. Calls the actual ODP endpoint/SDK.
 * Returned segment keys are used identically to the mock path, so the storefront and
 * engine never know which mode is active.
 */
export class LiveSegmentProvider implements SegmentProvider {
  constructor(private cfg: { odpApiHost?: string; odpPublicKey?: string }) {}

  async fetchQualifiedSegments(
    userId: string,
    _ctx?: QualificationContext
  ): Promise<SegmentKey[]> {
    if (!this.cfg.odpApiHost || !this.cfg.odpPublicKey) throw new NotWiredError('SegmentProvider');
    // LIVE: query ODP for the user's real-time qualified segments, e.g. the ODP
    // GraphQL endpoint at POST {odpApiHost}/v3/graphql with the public key:
    //
    //   const res = await fetch(`${this.cfg.odpApiHost}/v3/graphql`, {
    //     method: 'POST',
    //     headers: {
    //       'Content-Type': 'application/json',
    //       'x-api-key': this.cfg.odpPublicKey!,
    //     },
    //     body: JSON.stringify({
    //       query: `query($id: String!) {
    //         customer(vuid: $id) {
    //           audiences(subset: ["realtime"]) {
    //             edges { node { name state } }
    //           }
    //         }
    //       }`,
    //       variables: { id: userId },
    //     }),
    //   });
    //   const json = await res.json();
    //   return json.data.customer.audiences.edges
    //     .filter((e: any) => e.node.state === 'qualified')
    //     .map((e: any) => e.node.name as SegmentKey);
    //
    // Equivalently, on an Optimizely UserContext:
    //   await optimizelyUserContext.fetchQualifiedSegments();
    //   return optimizelyUserContext.qualifiedSegments ?? [];
    throw new NotWiredError('SegmentProvider'); // remove when credentials are supplied
  }

  async isQualifiedFor(
    userId: string,
    segment: SegmentKey,
    ctx?: QualificationContext
  ): Promise<boolean> {
    return (await this.fetchQualifiedSegments(userId, ctx)).includes(segment);
  }
}

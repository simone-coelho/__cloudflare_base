// src/connectors/index.ts
// One environment variable, CONNECTOR_MODE, selects the mock or live triad.
// Nothing else in the app knows which mode it is in — callers depend only on the
// interfaces. See docs/architecture/05-demo-build-spec.md §1.4.

import type { Env } from '@/types/env';
import type { SegmentProvider } from './SegmentProvider';
import type { AudienceAuthoring } from './AudienceAuthoring';
import type { DecisionProvider } from './DecisionProvider';
import type { SignalProvider } from './SignalProvider';
import { MockSegmentProvider, LiveSegmentProvider } from './SegmentProvider';
import { MockAudienceAuthoring, LiveAudienceAuthoring } from './AudienceAuthoring';
import { MockDecisionProvider, LiveDecisionProvider } from './DecisionProvider';
import { MockSignalProvider, LiveSignalProvider } from './SignalProvider';
import { KvAudienceStore } from './AudienceStore';
import { OptimizelyService } from '@/services/OptimizelyService';

export interface Connectors {
  segments: SegmentProvider;
  audiences: AudienceAuthoring;
  decisions: DecisionProvider;
  signals: SignalProvider; // DETECT layer for the Signal-Led Moment (mocked partner social-listening)
}

export function getConnectors(env: Env): Connectors {
  const mode = env.CONNECTOR_MODE ?? 'mock'; // 'mock' | 'live' — the triad switch
  const store = new KvAudienceStore(env); // shared by SegmentProvider + AudienceAuthoring

  if (mode === 'live') {
    return {
      segments: new LiveSegmentProvider({ odpApiHost: env.ODP_API_HOST, odpPublicKey: env.ODP_PUBLIC_KEY }),
      audiences: new LiveAudienceAuthoring({ mcpEndpoint: env.OPAL_MCP_ENDPOINT, optiIdToken: env.OPTI_ID_TOKEN }),
      decisions: new LiveDecisionProvider(new OptimizelyService(env)),
      signals: new LiveSignalProvider({ signalApiHost: env.SIGNAL_API_HOST, signalApiKey: env.SIGNAL_API_KEY }),
    };
  }

  // Mock triad (the default demo). DECISION_SOURCE independently flips ONLY the
  // decision seam to the real Optimizely FX SDK (Mode B) — segments/audiences stay
  // mock. The live provider degrades per-flag back to mock, so the demo never breaks.
  // Default 'mock' keeps the current demo unaffected.
  const decisions =
    env.DECISION_SOURCE === 'optimizely'
      ? new LiveDecisionProvider(new OptimizelyService(env))
      : new MockDecisionProvider();

  return {
    segments: new MockSegmentProvider(store),
    audiences: new MockAudienceAuthoring(store),
    decisions,
    signals: new MockSignalProvider(),
  };
}

export type { SegmentProvider } from './SegmentProvider';
export type { AudienceAuthoring } from './AudienceAuthoring';
export type { DecisionProvider } from './DecisionProvider';
export type { SignalProvider, TrendSignal } from './SignalProvider';
export { KvAudienceStore } from './AudienceStore';
export type { AudienceStore } from './AudienceStore';
export * from './types';

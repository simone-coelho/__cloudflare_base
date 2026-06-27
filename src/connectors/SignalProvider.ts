// src/connectors/SignalProvider.ts
// (d) SignalProvider — the DETECT layer of the Signal-Led Moment encore.
//
// MOCKED PARTNER LAYER, REAL SEAM: this interface is shaped like a real-time
// social-listening / trend partner feed (the kind that pushes "this SKU is spiking
// on TikTok in NY" signals). Optimizely ships NO native social listener — DETECT is
// the ONLY mocked stage of the moment. The Mock adapter reads the bundled fixture
// (src/data/signals.json); the Live adapter has the real wiring shape but throws
// NotWiredError until a partner endpoint + key are supplied. Mirrors the
// Mock + inert-Live + NotWiredError pattern of AudienceAuthoring / SegmentProvider.
//
// See docs/architecture/12-signal-led-moment-build-brief.md §4.2 + §6 Phase A.

import { NotWiredError } from './types';
import signalsData from '@/data/signals.json';

/**
 * A real-time trend signal as a social-listening partner would emit it (DETECT).
 * velocityPct / windowMinutes / confidence are INVENTED demo props (simulated:true);
 * the SKUs and anchorLine are real Coach catalog values.
 */
export interface TrendSignal {
  id: string;
  source: string;        // "partner_social_listening" — the mocked partner layer
  platform: string;      // "TikTok" — where the signal was observed
  headline: string;      // human signal headline (Opal reads this; drives the toast)
  hashtag?: string;      // "#CoachTabby"
  skus: string[];        // real Coach SKUs the signal is about (e.g. COA-CH857, COA-CY201)
  anchorLine: string;    // "Tabby" — the Coach line
  velocityPct: number;   // 480 — % spike (INVENTED demo prop)
  unit?: string;         // "views/hr" — what velocity measures
  windowMinutes: number; // 28 — minutes before the moment cools (INVENTED demo prop)
  region: string;        // "US-NY" — mocked; overlaid with the REAL /geo region at serve time
  confidence: number;    // 0.86 — detector confidence (INVENTED demo prop)
  nlSeed: string;        // the prompt handed to Opal to write + launch the moment
  simulated: true;       // ALWAYS true — DETECT is mocked, not Optimizely
  detectedAt: number;    // epoch ms; 0 in the fixture (the route stamps serve-time)
}

export interface SignalProvider {
  /** The next trend signal to act on (mock: the fixture; live: the partner feed). */
  nextSignal(): Promise<TrendSignal>;

  /** Partner-push seam: ingest an externally-detected signal (live: a real push webhook; mock: echo + queue). */
  ingest(signal: Partial<TrendSignal>): Promise<TrendSignal>;
}

/** The bundled DETECT fixture (the canonical Tabby-on-TikTok signal + honesty _meta). */
const FIXTURE = signalsData as { _meta?: Record<string, unknown>; signals: TrendSignal[] };

/**
 * Module-level partner-push queue. A POST /signals/ingest in mock mode pushes here so
 * nextSignal() can reflect it (newest first). Ephemeral (per-isolate) — which is all the
 * mock seam needs: the canonical demo path never POSTs and so deterministically gets the
 * fixture Tabby signal back from nextSignal().
 */
const INGESTED: TrendSignal[] = [];

/** Normalize a partner-pushed payload into a full TrendSignal (fixture-backed defaults; simulated forced). */
function normalizeSignal(input: Partial<TrendSignal>): TrendSignal {
  const base = FIXTURE.signals[0];
  return {
    ...base,
    ...input,
    skus: Array.isArray(input.skus) ? input.skus : base.skus,
    simulated: true,                                    // DETECT is always mocked
    detectedAt: typeof input.detectedAt === 'number' && input.detectedAt > 0 ? input.detectedAt : Date.now(),
  };
}

/**
 * Mock adapter — deterministic DETECT. nextSignal() returns the most-recently ingested
 * signal if a partner pushed one this isolate, else the canonical fixture (stage-safe:
 * the same demo run detects the same Tabby-on-TikTok moment every time). No network and
 * no clock dependency in the default path. (Mirrors MockAudienceAuthoring's determinism.)
 */
export class MockSignalProvider implements SignalProvider {
  async nextSignal(): Promise<TrendSignal> {
    if (INGESTED.length) return INGESTED[INGESTED.length - 1];
    return FIXTURE.signals[0];
  }

  async ingest(signal: Partial<TrendSignal>): Promise<TrendSignal> {
    // Mock partner-push: normalize, queue (so nextSignal can reflect it), and echo it back.
    const normalized = normalizeSignal(signal);
    INGESTED.push(normalized);
    return normalized;
  }
}

/**
 * Live adapter stub — real shape, inert until wired. A real social-listening partner
 * (e.g. a TikTok trend API / brand-watch vendor) would stream signals into nextSignal();
 * ingest() would be the partner's push webhook. Returned signals are used identically to
 * the mock path, so the storefront / Opal never know which mode is active.
 */
export class LiveSignalProvider implements SignalProvider {
  constructor(private cfg: { signalApiHost?: string; signalApiKey?: string }) {}

  async nextSignal(): Promise<TrendSignal> {
    if (!this.cfg.signalApiHost || !this.cfg.signalApiKey) throw new NotWiredError('SignalProvider');
    // LIVE: poll/subscribe the partner social-listening feed for the latest qualifying trend
    // signal (SKU velocity over a window, by region) and map it onto TrendSignal. NOTE:
    // Optimizely ships no native social listener — this is a partner integration seam.
    throw new NotWiredError('SignalProvider'); // remove when the partner feed is supplied
  }

  async ingest(_signal: Partial<TrendSignal>): Promise<TrendSignal> {
    if (!this.cfg.signalApiHost || !this.cfg.signalApiKey) throw new NotWiredError('SignalProvider');
    // LIVE: this is the partner's push webhook — validate the signature, normalize, persist.
    throw new NotWiredError('SignalProvider'); // remove when the partner push is sanctioned
  }
}

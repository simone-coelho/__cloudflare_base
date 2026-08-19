export interface Env {
  ASSETS: Fetcher;   // static-assets binding (public/) for server-side reads — see wrangler.toml [assets]
  BROWSER?: Fetcher; // Browser Rendering (headless Chromium) for the /__shot verification route
  CACHE: KVNamespace;
  SESSIONS: KVNamespace;
  STORAGE: R2Bucket;
  EVENT_QUEUE: Queue;
  ANALYTICS: AnalyticsEngineDataset;
  STATE_MANAGER: DurableObjectNamespace;
  RATE_LIMITER: DurableObjectNamespace;
  PERSONALIZATION_WEBSOCKET: DurableObjectNamespace;
  // Edge Affinity Reflex P2 (doc 16 §6): per-shopper SQLite DO owning the
  // WebSocket + affinity state (wrangler migration v4). Keyed on the STABLE
  // visitor id; used only when REFLEX_HOST = 'do'.
  SHOPPER_REFLEX: DurableObjectNamespace;
  // Opal chat agent (SQLite-backed DO, wrangler migration v3) — reached via
  // routeAgentRequest(/agents/*), not app routes; declared here for Env completeness.
  OpalAgent: DurableObjectNamespace;

  // D1 — Coach demo dataset (ODP profiles + commerce + warehouse-export mirror).
  // Backs the Opal chat's aggregate-then-reason query surface. See
  // docs/architecture/10-d1-schema.md; binding declared in wrangler.toml.
  DB: D1Database;

  ENVIRONMENT: string;
  JWT_SECRET: string;
  JWT_ISSUER: string;
  JWT_AUDIENCE: string;
  // Optimizely FX SDK key — NOT secret (datafile at cdn.optimizely.com/datafiles/<key>.json is public).
  OPTIMIZELY_SDK_KEY: string;
  OPTIMIZELY_DATAFILE_URL: string;

  API_KEYS?: string;
  WEBHOOK_ENDPOINTS?: string;
  CDP_ENDPOINTS?: string;

  // Edge Affinity Reflex (docs/architecture/16-edge-affinity-reflex.md) — on by
  // default; set 'false' as the kill-switch. Purely additive attributes/segments.
  REFLEX_ENABLED?: string;
  // Reflex host (doc 16 §6, P2): 'session' (default — state rides the KV session,
  // WS on the relay DO) | 'do' (socket + state + closed-form alarms co-located in
  // the per-shopper ShopperReflex DO). Flag off ⇒ byte-identical default behavior.
  REFLEX_HOST?: 'session' | 'do';
  // ShopperReflex lifecycle/abuse knobs (optional; sensible defaults in the DO):
  // idle self-expiry in days (default 30) and per-minute ingest cap (default 240).
  REFLEX_RETENTION_DAYS?: string;
  REFLEX_RATE_LIMIT_PER_MIN?: string;

  // Bright Hour demo (docs/qvc/QVC-Demo-Design-Brief.md §3): pins the demo epoch
  // offer windows are materialized against, so a rehearsed run replays identically.
  // Absent ⇒ midnight ET at or before the request stamp.
  BRIGHTHOUR_EPOCH_MS?: string;
  BRIGHTHOUR_CLOCK_MULTIPLIER?: string;

  // Connector layer — "real seams, mocked calls" (docs/architecture/05-demo-build-spec.md)
  CONNECTOR_MODE?: 'mock' | 'live';
  // Mode-B decision source, independent of CONNECTOR_MODE:
  //   'mock' (default) — deterministic insight-driven decisions (current demo)
  //   'optimizely'     — real FX SDK over the live datafile (LiveDecisionProvider),
  //                      degrading per-flag to the mock decision when a flag is absent.
  DECISION_SOURCE?: 'mock' | 'optimizely';
  ODP_API_HOST?: string;
  ODP_PUBLIC_KEY?: string;
  OPAL_MCP_ENDPOINT?: string;
  OPTI_ID_TOKEN?: string;
  // Signal-Led Moment DETECT seam — credentials for a LIVE partner social-listening feed.
  // Absent by default: LiveSignalProvider throws NotWiredError and the demo runs on the
  // mocked fixture (src/data/signals.json). DETECT is the only mocked stage of the moment.
  SIGNAL_API_HOST?: string;
  SIGNAL_API_KEY?: string;

  // Opal chat (Gemini) + FX write-tools — provide via wrangler secret / .dev.vars.
  GEMINI_API_KEY: string;
  GEMINI_MODEL?: string;
  GEMINI_IMAGE_MODEL?: string;   // "nano banana" image model for /ai/scene (default gemini-3.1-flash-image)
  OPTIMIZELY_API_TOKEN?: string;
  OPTIMIZELY_PROJECT_ID?: string;
  OPTIMIZELY_ENVIRONMENT?: string;
  OPTIMIZELY_WRITE_ENABLED?: string;
  OPTIMIZELY_WEBHOOK_SECRET?: string;   // HMAC secret for the datafile webhook (X-Hub-Signature)
}
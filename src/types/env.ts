export interface Env {
  ASSETS: Fetcher;   // static-assets binding (public/) for server-side reads — see wrangler.toml [assets]
  BROWSER?: Fetcher; // Browser Rendering (headless Chromium) for the /__shot verification route
  /** Shared secret for /__shot. UNSET DISABLES THE ROUTE ENTIRELY — see src/routes/shot.ts. */
  SHOT_TOKEN?: string;
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
  /** Meridian (Opticon) — its own reflex object, never the shared one. */
  MERIDIAN_REFLEX: DurableObjectNamespace;
  /** CW6 — one object per tenant and region: the population's decaying interest vector. Optional so tests and older stamps run without it. */
  REGION_TREND?: DurableObjectNamespace;
  /** CW6 — tenants the hourly cron rolls region snapshots up for, comma-separated. */
  TREND_ROLLUP_TENANTS?: string;
  // Opal chat agent (SQLite-backed DO, wrangler migration v3) — reached via
  // routeAgentRequest(/agents/*), not app routes; declared here for Env completeness.
  OpalAgent: DurableObjectNamespace;

  // D1 — Coach demo dataset (ODP profiles + commerce + warehouse-export mirror).
  // Backs the Opal chat's aggregate-then-reason query surface. See
  // docs/architecture/10-d1-schema.md; binding declared in wrangler.toml.
  DB: D1Database;

  /**
   * Stamp tenancy (CW1). JSON:
   *   { "provisioned": ["coach","kate-spade"],
   *     "hosts": { "shop.katespade.com": "kate-spade" } }
   * Absent or malformed means the default brand only, which is the safe reading
   * of an unconfigured stamp rather than the permissive one.
   */
  TENANTS?: string;

  /**
   * Whether every shopper action is also written to D1 `demo_events`.
   *
   * That write exists for the demo's operator reset and for Opal's audience
   * sizing. It is also a per-request write into a single-primary SQLite from
   * every edge location, which is the exact pattern doc 22 §18.10 says must
   * never be inherited by a production decision path.
   *
   * 'true' captures, 'false' does not. ABSENT captures only when ENVIRONMENT is
   * not 'production', so the demo keeps working everywhere it works today and
   * production is safe by omission rather than by someone remembering.
   */
  DEMO_EVENT_CAPTURE?: string;

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

  // CW10 — access policy (src/middleware/edgeAccess.ts). 'open' (default) is
  // today's behavior for the shared demo worker; 'enforced' is what the staging
  // stamp sets: SDK keys on /realtime and /v1, JWT on operator writes, CORS
  // answers only CORS_ORIGINS and the page's own origin.
  AUTH_MODE?: 'open' | 'enforced';
  // Comma-separated origins; `*.example.com` matches apex and subdomains. When
  // set, the allow-list applies in either mode. Empty + enforced = same-origin only.
  CORS_ORIGINS?: string;
  // Secret. `tenant:key[|key2],tenant2:key3`; tenant `*` accepts the key anywhere.
  SDK_KEYS?: string;

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
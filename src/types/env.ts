export interface Env {
  /** Exact deployment boundary. Missing/invalid values refuse all entry points. */
  DEPLOYMENT_PROFILE?: 'customer' | 'demo';
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
  /** Phase 1 — the visitor's own ring of served decisions, with online attribution. */
  DECISION_RING?: DurableObjectNamespace;
  /** Phase 1 — one object per tenant, brand and slot: decayed counts, published as lift snapshots. */
  LEARN_STATS?: DurableObjectNamespace;
  /** Phase 3 (doc 22 §9) — Workers AI, for the `workers_ai` model kind. Absent on this stamp; the kind reports unavailable. */
  AI?: { run(model: string, input: Record<string, unknown>): Promise<unknown> };
  /** CW6 — tenants the hourly cron rolls region snapshots up for, comma-separated. */
  TREND_ROLLUP_TENANTS?: string;
  /**
   * CW28 (doc 22 §15) — the ledger's retention window in days, the span the nightly erasure rewrite
   * walks back from an erasure. Must match the R2 bucket's lifecycle rule. Absent means the design's 90.
   * The number itself is Tapestry's privacy team's to agree.
   */
  LEDGER_RETENTION_DAYS?: string;
  /** Exact true opts producers into managed recovery; deploy recognizing consumers/eraser first. */
  LEDGER_RECOVERY_ENABLED?: string;
  /**
   * Where the platform posts an alert when its five-minute self-check fails or recovers (src/ops/monitor.ts):
   * any URL that accepts a JSON post, a chat webhook or an on-call tool. A secret. Absent means the result is
   * kept and logged but nobody is paged.
   */
  ALERT_WEBHOOK_URL?: string;
  // Opal chat agent (SQLite-backed DO, wrangler migration v3) — reached via
  // routeAgentRequest(/agents/*), not app routes; declared here for Env completeness.
  OpalAgent: DurableObjectNamespace;

  // D1 — Coach demo dataset (ODP profiles + commerce + warehouse-export mirror).
  // Backs the Opal chat's aggregate-then-reason query surface. See
  // docs/architecture/10-d1-schema.md; binding declared in wrangler.toml.
  DB: D1Database;
  /** Operator accounts (doc 30) live in D1 behind src/auth/store; a test hands its own store in here. Never set on a stamp. */
  ACCOUNTS?: import('@/auth/store').AccountStore;
  /** Test-only authority store; deployed authority uses the same D1 database. */
  AUTHORITY?: import('@/auth/authority').AuthorityStore;
  /** Explicit JSON array of human account IDs; never inferred from admin roles or tenant grants. */
  STAMP_OWNER_SUBJECTS?: string;
  /** Disabled when absent. Explicit pre-provisioned OIDC providers and secret references, never discovery/JIT grants. */
  OPERATOR_OIDC?: string;

  /**
   * Stamp tenancy (CW1). JSON:
   *   { "provisioned": ["coach","kate-spade"],
   *     "hosts": { "shop.katespade.com": "kate-spade" } }
   * Undefined retains legacy Coach-only operation. An explicit manifest is the
   * complete provisioned set; malformed configuration refuses requests/jobs.
   * Retain tenants with pending work until authorized retirement/recovery.
   */
  TENANTS?: string;
  /** Explicit per-tenant/per-category approved lifetimes. No implicit defaults. */
  // Explicit per-category policy; telemetry.* is separate from behavioral
  // external.*. Local descriptors/access references do not attest deployment.
  RETENTION?: string;
  /** Exact source/DLQ identities and explicit unknown-owner policy; no defaults. */
  LEDGER_RECOVERY_CONFIG?: string;

  /**
   * Whether legacy demo shopper actions and checkout events may write D1 `demo_events`.
   *
   * That write exists for the demo's operator reset and for Opal's audience
   * sizing. It is also a per-request write into a single-primary SQLite from
   * every edge location, which is the exact pattern doc 22 §18.10 says must
   * never be inherited by a production decision path.
   *
   * Requires explicit AUTH_MODE='open', normalized ENVIRONMENT='development',
   * normalized DEMO_EVENT_CAPTURE='true', and the resolved DEFAULT_TENANT.
   * Missing/invalid values, enforced mode and every other environment/tenant
   * disable both writers. This does not authorize real data or erase historic rows.
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
  // CW25 — identity stitching. IDENTITY_SALT (secret) salts the shopper id; IDENTITY_SECRETS
  // (secret, `tenant:secret[|previous],…`) verifies the backend proof required for every link.
  IDENTITY_SALT?: string;
  IDENTITY_SECRETS?: string;

  // Connector layer — "real seams, mocked calls" (docs/architecture/05-demo-build-spec.md)
  CONNECTOR_MODE?: 'mock' | 'live';
  // Mode-B decision source, independent of CONNECTOR_MODE:
  //   'mock' (default) — deterministic insight-driven decisions (current demo)
  //   'optimizely'     — real FX SDK over the live datafile (LiveDecisionProvider),
  //                      degrading per-flag to the mock decision when a flag is absent.
  DECISION_SOURCE?: 'mock' | 'optimizely';
  ODP_API_HOST?: string;
  /** JSON {version:1,tenants:{tenant:{fx?,odp?,telemetry?,enrichment?,search?,catalogSearch?,warehouse?}}}; see connectors/config.ts.
   * Credentials are explicit CONNECTOR_SECRET_* binding references, never embedded values. */
  TENANT_CONNECTORS?: string;
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

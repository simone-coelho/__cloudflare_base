export interface Env {
  CACHE: KVNamespace;
  SESSIONS: KVNamespace;
  STORAGE: R2Bucket;
  EVENT_QUEUE: Queue;
  ANALYTICS: AnalyticsEngineDataset;
  STATE_MANAGER: DurableObjectNamespace;
  RATE_LIMITER: DurableObjectNamespace;
  PERSONALIZATION_WEBSOCKET: DurableObjectNamespace;

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
}
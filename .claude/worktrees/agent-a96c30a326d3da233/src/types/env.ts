export interface Env {
  CACHE: KVNamespace;
  SESSIONS: KVNamespace;
  STORAGE: R2Bucket;
  EVENT_QUEUE: Queue;
  ANALYTICS: AnalyticsEngineDataset;
  STATE_MANAGER: DurableObjectNamespace;
  RATE_LIMITER: DurableObjectNamespace;
  PERSONALIZATION_WEBSOCKET: DurableObjectNamespace;

  // Opal conversational agent (Cloudflare Agents SDK, SQLite-backed DO).
  OpalAgent: DurableObjectNamespace;

  ENVIRONMENT: string;
  JWT_SECRET: string;
  JWT_ISSUER: string;
  JWT_AUDIENCE: string;
  OPTIMIZELY_SDK_KEY: string;
  OPTIMIZELY_DATAFILE_URL: string;

  // Opal chat (Gemini) — provide GEMINI_API_KEY via `wrangler secret` / .dev.vars.
  GEMINI_API_KEY: string;
  GEMINI_MODEL?: string;

  // Optional: D1 for queryAudienceData (aggregate-then-reason). Mocked when absent.
  DB?: D1Database;

  // Optional: gates for the Optimizely FX REST write tools (audience/flag creation).
  OPTIMIZELY_WRITE_ENABLED?: string;
  OPTIMIZELY_API_TOKEN?: string;
  OPTIMIZELY_PROJECT_ID?: string;

  API_KEYS?: string;
  WEBHOOK_ENDPOINTS?: string;
  CDP_ENDPOINTS?: string;
}
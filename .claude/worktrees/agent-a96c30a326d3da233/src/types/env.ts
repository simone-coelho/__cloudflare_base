export interface Env {
  CACHE: KVNamespace;
  SESSIONS: KVNamespace;
  STORAGE: R2Bucket;
  EVENT_QUEUE: Queue;
  ANALYTICS: AnalyticsEngineDataset;
  STATE_MANAGER: DurableObjectNamespace;
  RATE_LIMITER: DurableObjectNamespace;
  PERSONALIZATION_WEBSOCKET: DurableObjectNamespace;
  
  ENVIRONMENT: string;
  JWT_SECRET: string;
  JWT_ISSUER: string;
  JWT_AUDIENCE: string;
  OPTIMIZELY_SDK_KEY: string;
  OPTIMIZELY_DATAFILE_URL: string;
  
  API_KEYS?: string;
  WEBHOOK_ENDPOINTS?: string;
  CDP_ENDPOINTS?: string;
}
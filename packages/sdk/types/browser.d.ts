import { createClient, browserHost, memoryHost, GA4_MAPPING, DEFAULT_PATHS } from './index.js';
declare global {
    interface Window {
        EdgePersonalization?: {
            createClient: typeof createClient;
            VERSION: string;
            browserHost: typeof browserHost;
            memoryHost: typeof memoryHost;
            GA4_MAPPING: typeof GA4_MAPPING;
            DEFAULT_PATHS: typeof DEFAULT_PATHS;
        };
    }
}

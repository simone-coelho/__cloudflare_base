// src/sdk/browser.ts — the <script src> build. Exposes window.EdgePersonalization.
import { createClient, VERSION, browserHost, memoryHost, GA4_MAPPING, DEFAULT_PATHS } from './index';

declare global {
  interface Window {
    EdgePersonalization?: {
      createClient: typeof createClient; VERSION: string; browserHost: typeof browserHost;
      memoryHost: typeof memoryHost; GA4_MAPPING: typeof GA4_MAPPING; DEFAULT_PATHS: typeof DEFAULT_PATHS;
    };
  }
}

(globalThis as unknown as Window).EdgePersonalization = { createClient, VERSION, browserHost, memoryHost, GA4_MAPPING, DEFAULT_PATHS };

import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    // The route suites dynamically import the whole worker graph inside the
    // FIRST test body (catalog JSON, segment engine, connectors, experiment
    // module), which on a cold run costs several seconds before any assertion
    // runs. Vitest's 5s default was timing that one test out on slower machines
    // while every assertion in it passed. 15s is a ceiling for module loading,
    // not a licence for slow tests.
    testTimeout: 15_000,
    environment: 'miniflare',
    environmentOptions: {
      kvNamespaces: ['CACHE', 'SESSIONS'],
      r2Buckets: ['STORAGE'],
      durableObjects: {
        STATE_MANAGER: 'StateManager',
        RATE_LIMITER: 'RateLimiter',
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@lib': path.resolve(__dirname, './src/lib'),
      '@middleware': path.resolve(__dirname, './src/middleware'),
      '@routes': path.resolve(__dirname, './src/routes'),
      '@services': path.resolve(__dirname, './src/services'),
      '@types': path.resolve(__dirname, './src/types'),
      '@utils': path.resolve(__dirname, './src/utils'),
    },
  },
});
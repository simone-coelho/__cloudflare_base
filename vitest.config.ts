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
    // 'node', not 'miniflare'. The declared vitest-environment-miniflare package
    // is Miniflare v2 tooling, has not been installable against the wrangler 4 /
    // miniflare 4 line this repo pins for over a year, and was absent from
    // package.json the whole time — so `vitest` exited on a MISSING DEPENDENCY
    // before collecting a single file. Nothing under test needs the Workers
    // runtime: every suite here exercises pure decision logic (decay and
    // saturation math, composition, layout, content scoring, isolation) with its
    // bindings passed in or stubbed. Route suites that dynamically import the
    // worker graph do so for module side effects, not for Workers globals.
    // If a future suite genuinely needs a real KV/D1/DO, add
    // @cloudflare/vitest-pool-workers for that project rather than putting the
    // whole suite back behind a runtime it does not use.
    environment: 'node',
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      // Agent worktrees are full repo copies. Without this, vitest collects
      // every stale duplicate of every suite: 189 files and 3,701 cases instead
      // of this checkout's own, and failures in abandoned branches read as
      // failures here.
      '**/.claude/**',
    ],
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
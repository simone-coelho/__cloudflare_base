// src/units/_monotonicClock.setup.ts
// Amendment A51: registered in vitest.config.ts `test.setupFiles`. Installs,
// in every test worker, the non-decreasing `Date.now` described in
// ./_monotonicClock.ts (what it covers and what it does not).
import { installMonotonicDateNow } from './_monotonicClock';

installMonotonicDateNow();

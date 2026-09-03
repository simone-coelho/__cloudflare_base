// src/routes/demoEventCapture.test.ts
//
// The property under test is the DEFAULT. A flag that is safe only when someone
// remembers to set it is not a fence.

import { describe, it, expect } from 'vitest';
import { demoEventCaptureEnabled } from '@/routes/realtime';

describe('the demo event write is off in production by omission', () => {
  it('captures in development and staging with nothing set', () => {
    expect(demoEventCaptureEnabled({ ENVIRONMENT: 'development' })).toBe(true);
    expect(demoEventCaptureEnabled({ ENVIRONMENT: 'staging' })).toBe(true);
  });

  it('does NOT capture in production with nothing set', () => {
    // The whole point. Production is safe because nobody had to remember.
    expect(demoEventCaptureEnabled({ ENVIRONMENT: 'production' })).toBe(false);
    expect(demoEventCaptureEnabled({ ENVIRONMENT: 'Production' })).toBe(false);
  });

  it('can be forced on or off explicitly, in any environment', () => {
    expect(demoEventCaptureEnabled({ ENVIRONMENT: 'production', DEMO_EVENT_CAPTURE: 'true' })).toBe(true);
    expect(demoEventCaptureEnabled({ ENVIRONMENT: 'development', DEMO_EVENT_CAPTURE: 'false' })).toBe(false);
    expect(demoEventCaptureEnabled({ ENVIRONMENT: 'production', DEMO_EVENT_CAPTURE: ' TRUE ' })).toBe(true);
  });

  it('treats an unrecognised flag value as unset rather than as permission', () => {
    expect(demoEventCaptureEnabled({ ENVIRONMENT: 'production', DEMO_EVENT_CAPTURE: 'yes' })).toBe(false);
    expect(demoEventCaptureEnabled({ ENVIRONMENT: 'development', DEMO_EVENT_CAPTURE: 'maybe' })).toBe(true);
  });

  it('treats a MISSING environment as production, because the silent failure is the harmful one', () => {
    // "Demo reset shows nothing" is visible and fixable. "Per-request D1 writes
    // in production" is neither. When we cannot tell, we assume the worse case.
    expect(demoEventCaptureEnabled({} as never)).toBe(false);
    expect(demoEventCaptureEnabled({ ENVIRONMENT: '' })).toBe(false);
    expect(demoEventCaptureEnabled({ ENVIRONMENT: '   ' })).toBe(false);
  });
});

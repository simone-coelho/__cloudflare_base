// src/routes/realtime.sdkContract.test.ts
// The SDK's wire table against the server's own validator: every event the SDK
// can send must parse through actionEventSchema exactly as POST /realtime/action
// would parse it. When the server learns a new first-class type, the SDK row
// changes and this test is what says the two still agree.

import { describe, it, expect } from 'vitest';
import { actionEventSchema } from './realtime';
import { createCore } from '../sdk/core';
import { memoryHost } from '../sdk/memoryHost';
import { WIRE } from '../sdk/wire';
import type { SdkEventType } from '../sdk/types';

describe('SDK ↔ /realtime/action contract', () => {
  const core = createCore({ tenant: 'coach', source: 'sdk', surface: 'coach' }, memoryHost({ uuid: () => 'u' }));

  it('every SDK event type produces an envelope the server accepts', () => {
    for (const type of Object.keys(WIRE) as SdkEventType[]) {
      const env = core.envelope(type, { productId: 'SKU-1', contentId: 'c1', slot: 'hero' });
      const parsed = actionEventSchema.safeParse(env);
      expect(parsed.success, `${type} → ${env.type}: ${parsed.success ? '' : JSON.stringify(parsed.error.issues)}`).toBe(true);
    }
  });

  it('events the server does not yet name first-class keep their real name in the payload', () => {
    const env = core.envelope('content_impression', { contentId: 'c1', slot: 'hero' });
    expect(env.type).toBe('custom');
    expect(env.data).toMatchObject({ event: 'content_impression', contentId: 'c1', slot: 'hero' });
  });
});

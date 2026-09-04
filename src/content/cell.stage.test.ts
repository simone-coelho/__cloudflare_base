// src/content/cell.stage.test.ts — CW29: the journey stage on the context cell.
import { describe, it, expect } from 'vitest';
import { DEFAULT_REFLEX_CONFIG } from '@/reflex/core';
import { cellFor } from '@/content/cell';

describe('cellFor with a stage', () => {
  it('records the stage the engine derived', () => {
    expect(cellFor({ cfg: DEFAULT_REFLEX_CONFIG, stage: 'mid' }).stage).toBe('mid');
    expect(cellFor({ cfg: DEFAULT_REFLEX_CONFIG, stage: 'late', channel: 'email' })).toMatchObject({ stage: 'late', channel: 'email' });
  });

  it('records unknown when no stage is known, never a guess', () => {
    expect(cellFor({ cfg: DEFAULT_REFLEX_CONFIG }).stage).toBe('unknown');
    expect(cellFor({ cfg: DEFAULT_REFLEX_CONFIG, stage: null }).stage).toBe('unknown');
    expect(cellFor({ cfg: DEFAULT_REFLEX_CONFIG, stage: 'deciding' }).stage).toBe('unknown');   // BTIE's word is not the stored value
  });

  it('changes nothing else about the cell', () => {
    const before = cellFor({ cfg: DEFAULT_REFLEX_CONFIG, channel: 'paid_social', visitNumber: 2, cf: { country: 'US', regionCode: 'NY' } });
    const after = cellFor({ cfg: DEFAULT_REFLEX_CONFIG, channel: 'paid_social', visitNumber: 2, cf: { country: 'US', regionCode: 'NY' }, stage: 'early' });
    expect({ ...after, stage: undefined }).toEqual({ ...before, stage: undefined });
    expect(before).toMatchObject({ channel: 'paid_social', visit_bucket: '2-3', region: 'US-NY' });
  });
});

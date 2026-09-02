// src/demos/meridian/receipts.test.ts
// The regression this file exists for: POST /decisions built its CaptureInput
// without `sections`, so every page-ordering receipt the client posted was
// dropped before it reached D1 — and the guard rejected a sections-only post
// outright. Page order is half the Experience milestone; its receipts were the
// half that never persisted.

import { describe, it, expect } from 'vitest';
import { capture, captureInputFrom, rowsForLayout, MRD_DECISION_COLUMNS } from './receipts';

class FakeD1 {
  batched: unknown[][] = [];
  prepare(sql: string) {
    const self = this;
    return { bind: (...args: unknown[]) => ({ sql, args, _self: self }) } as never;
  }
  async batch(stmts: Array<{ args: unknown[] }>): Promise<unknown[]> {
    this.batched.push(...stmts.map((s) => s.args));
    return [];
  }
}

const section = (name: string, rank: number, strategy = 'ranked') => ({
  section: name, rank, strategy, score: 0.42,
  explain: { drivers: [{ dim: 'line', value: 'drover', a: 0.7 }], confidence: 0.7, thetaOut: 0.45, configVersion: 'v1' },
});
const decision = (slot: string, order: number) => ({
  slot, order, itemId: `item-${order}`, strategy: 'ranked',
  explain: { candidates: 12, drivers: [{ dim: 'line', value: 'drover', a: 0.7 }], configVersion: 'v1' },
  rankScore: 0.5,
});

describe('captureInputFrom', () => {
  it('carries sections through — the field the route used to drop', () => {
    const input = captureInputFrom(
      { visitorId: 'v1', decisions: [decision('hero', 0)], sections: [section('offers', 1)] },
      'retail' as never, 1000,
    );
    expect(input).not.toBeNull();
    expect(input!.sections).toHaveLength(1);
    expect(input!.sections![0].section).toBe('offers');
  });

  it('accepts a sections-only post, which the old guard rejected with a 400', () => {
    const input = captureInputFrom({ visitorId: 'v1', sections: [section('offers', 1)] }, 'retail' as never, 1000);
    expect(input).not.toBeNull();
    expect(input!.decisions).toEqual([]);
    expect(input!.sections).toHaveLength(1);
  });

  it('accepts a decisions-only post, unchanged from before', () => {
    const input = captureInputFrom({ visitorId: 'v1', decisions: [decision('hero', 0)] }, 'retail' as never, 1000);
    expect(input!.decisions).toHaveLength(1);
    expect(input!.sections).toEqual([]);
  });

  it('is null when there is nothing to write, and when the visitor is missing', () => {
    expect(captureInputFrom({ visitorId: 'v1', decisions: [], sections: [] }, 'retail' as never, 1)).toBeNull();
    expect(captureInputFrom({ decisions: [decision('hero', 0)] }, 'retail' as never, 1)).toBeNull();
    expect(captureInputFrom({ visitorId: '  ' }, 'retail' as never, 1)).toBeNull();
    expect(captureInputFrom(null, 'retail' as never, 1)).toBeNull();
  });

  it('ignores non-array decisions/sections rather than throwing on bad input', () => {
    const input = captureInputFrom(
      { visitorId: 'v1', decisions: 'nope', sections: [section('offers', 1)] } as never, 'retail' as never, 1,
    );
    expect(input!.decisions).toEqual([]);
    expect(input!.sections).toHaveLength(1);
  });
});

describe('capture writes section rows', () => {
  it('persists one row per section, keyed as layout:<section>', async () => {
    const db = new FakeD1();
    const input = captureInputFrom(
      { visitorId: 'v1', sections: [section('offers', 1), section('editorial', 2)] }, 'retail' as never, 1000,
    )!;
    const n = await capture(db as never, input);
    expect(n).toBe(2);

    const slotIdx = MRD_DECISION_COLUMNS.indexOf('slot_id' as never);
    const slots = db.batched.map((row) => row[slotIdx]);
    expect(slots).toEqual(['layout:offers', 'layout:editorial']);
  });

  it('writes slot decisions and section decisions in ONE batch, so a page is one receipt', async () => {
    const db = new FakeD1();
    const input = captureInputFrom(
      { visitorId: 'v1', decisions: [decision('hero', 0), decision('rail', 1)], sections: [section('offers', 1)] },
      'retail' as never, 1000,
    )!;
    expect(await capture(db as never, input)).toBe(3);
    expect(db.batched).toHaveLength(3);
  });

  it('records a locked section with "locked" as the gate that outranked the engine', () => {
    const rows = rowsForLayout({
      visitorId: 'v1', vertical: 'retail' as never, now: 1,
      sections: [section('merch', 1, 'locked')],
    });
    const gatesIdx = MRD_DECISION_COLUMNS.indexOf('gates_failed' as never);
    expect(JSON.parse(rows[0][gatesIdx] as string)).toEqual(['locked']);
  });

  it('writes nothing rather than an empty batch when both lists are empty', async () => {
    const db = new FakeD1();
    expect(await capture(db as never, {
      visitorId: 'v1', vertical: 'retail' as never, decisions: [], sections: [], now: 1,
    })).toBe(0);
    expect(db.batched).toHaveLength(0);
  });
});

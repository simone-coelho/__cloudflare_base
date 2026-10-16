// node --test scripts/demo-kit/lib/capture.test.mjs
// The equivalence instrument (scripts/demo-kit/capture.mjs): it removes only the server's own revision label
// from a document's version, and it keeps from a panel read exactly what was seeded and what a stranger
// opens with, never the times or the live counters.
import assert from 'node:assert/strict';
import test from 'node:test';
import { panelSummary, unstamped } from '../capture.mjs';

test('the server\'s revision label is removed only when it is this capture\'s own revision', () => {
  assert.deepEqual(unstamped({ version: 'content-vantage-open+r4', pieces: [] }, 4), { version: 'content-vantage-open', pieces: [] });
  assert.deepEqual(unstamped({ version: 'content-vantage-open+r4' }, 3), { version: 'content-vantage-open+r4' }, 'another revision\'s label is a real difference');
  assert.deepEqual(unstamped({ version: 'slots+r12' }, 2), { version: 'slots+r12' });
  assert.equal(unstamped(null, 1), null);
  assert.deepEqual(unstamped({ pages: {} }, 1), { pages: {} });
});

test('a panel summary keeps what was seeded and what a stranger opens with, and drops times and live counters', () => {
  const read = {
    ok: true, tenant: 'vantage', region: { key: 'US-NY', source: 'asserted', metro: null, notes: [] }, grain: 'state',
    census: { grain: 'state', medianHouseholdIncomeUsd: 85820, medianHomeValueUsd: 449800, label: 'New York' },
    lean: { inForce: true, level: 'region', answered: 'US-NY', events: 425, minEvents: 30, lambdaForStranger: 1, kBlend: 0.5,
      leaders: { brand: 'apple' }, share: { brand: { apple: 1 } }, publishedAt: 1, dataSource: 'synthetic', swapTo: 'warehouse',
      label: 'synthetic → warehouse', seeded: { units: 425, at: 2, label: 'New York: synthetic carrier sales, rehearsal region B' }, liveEvents: 0, horizonHours: 24 },
  };
  assert.deepEqual(panelSummary(read), {
    region: 'US-NY', source: 'asserted', grain: 'state', census: { grain: 'state', income: 85820 },
    lean: { level: 'region', answered: 'US-NY', events: 425, seededUnits: 425, seededLabel: 'New York: synthetic carrier sales, rehearsal region B',
      dataSource: 'synthetic', label: 'synthetic → warehouse', leaders: { brand: 'apple' }, share: { brand: { apple: 1 } } },
  });
  assert.equal(panelSummary(null), null);
});

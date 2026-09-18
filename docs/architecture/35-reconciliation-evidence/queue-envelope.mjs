import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
// Read-only, synthetic audit evidence. Compiles the actual modules in memory.
// No queue/cloud calls, product writes, or claimed customer workload/SLO.
const repo = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\/$/, '');
const { build } = await import(repo + '/node_modules/esbuild/lib/main.js');
const bundled = await build({
  stdin: { contents: "export { decideContent } from './src/content/decide'; export { validateContentCatalog, validateSlotCatalog } from './src/content/kinds';", resolveDir: repo, loader: 'ts' },
  absWorkingDir: repo, bundle: true, write: false, platform: 'node', format: 'esm', alias: { '@': repo + '/src' },
});
const { decideContent, validateContentCatalog, validateSlotCatalog } = await import('data:text/javascript;base64,' + Buffer.from(bundled.outputFiles[0].text).toString('base64'));
const nowMs = Date.UTC(2026, 8, 6, 12);
function measure(positions, dimensions, values, regional) {
  const dims = Array.from({length: dimensions}, (_, d) => ['dim' + d, Array.from({length: values}, (_, v) => 'dim' + d + '-v' + v)]);
  const catalog = validateContentCatalog({pieces: Array.from({length: 400}, (_, i) => ({
    id: 'piece-' + i, customerContentId: 'cms-entry-' + (100000 + i), type: 'editorial', title: 'Editorial ' + i,
    tags: Object.fromEntries(dims.map(([d, vs]) => [d, [vs[i % values], vs[(i+5) % values]]])),
    slotTypes: ['slot-' + i % positions, 'any'], lifecycle: {status: 'live'},
  }))});
  const page = validateSlotCatalog({pages: {home: Array.from({length: positions}, (_, i) => ({slot: 'slot-' + i, take: 1, weights: Object.fromEntries(dims.map(([d]) => [d, 0.3]))}))}});
  assert.equal(catalog.ok, true); assert.equal(page.ok, true);
  const vector = Object.fromEntries(dims.map(([d, vs]) => [d, Object.fromEntries(vs.map((v, i) => [v, Math.round((1 - i / values)*1000)/1000]))]));
  const set = decideContent({
    tenant: 'coach', brand: 'coach', page: 'home', visitorId: 'v-audit-0001', sessionId: 's-audit-0001', identityAnchor: 'visitor', nowMs,
    pieces: catalog.value.pieces, slots: page.value.pages.home, affinity: {dims: vector},
    ...(regional ? {regional: {region: 'US-NY', level: 'region', lambda: 0.3, version: 1, events: 480, share: vector}} : {}),
    cell: {channel: 'paid_social', visit_bucket: '2-3', region: 'US-NY', affinity: 'dim0-v0', stage: 'mid'},
    arm: 'personalized', versions: {config: 12, catalog: 4, slots: 3, learn: 2, lift: 0, prior: 0, policy: 1}, configLabel: 'autumn-2026-r12',
  });
  assert.equal(set.records.length, positions);
  const bytes = Buffer.byteLength(JSON.stringify({kind: 'ledger', type: 'decisions', records: set.records}));
  return {positions, dimensions, valuesPerDimension: values, regional, records: set.records.length, bytes, exceeds128000: bytes > 128000};
}
const cases = [measure(8,8,24,false), measure(30,8,24,false), measure(30,6,24,true), measure(8,8,128,true)];
assert.equal(cases[0].exceeds128000, false);
assert.equal(cases[1].exceeds128000, true);
assert.equal(cases[2].exceeds128000, true);
assert.equal(cases[3].exceeds128000, true);
console.log(JSON.stringify({runtime: process.version, officialMessageLimitBytes: 128000, platformMetadataExcluded: true, cases}, null, 2));

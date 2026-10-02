// scripts/demo-kit/lib/region.mjs — the all-states synthetic regional seed, from a vocabulary.
//
// Lifted from scripts/seed-vantage-region.mjs with the demo's constants made config (region section):
// the seeded vocabulary, the rehearsed regions written verbatim, and a model for every other state: the
// income-tilt model (docs/verizon/lanes/F2.md §2), or the fixed model (a seeded, stable lean per state with
// declared skews and no census term, below at fixedRegion):
//
//   x = clamp((state median household income − national median) / spreadUsd, −1, 1)
//   t = 0.5 + tSpan · x
//   the blended rows (one category, keyed by a few dimensions): low(row) · (1 − t) + high(row) · t,
//       whole sales by largest remainder
//   extras (home internet in Vantage): a fixed row in the listed states, none elsewhere
//
// Income is the state's own row in the shared geo_census seed file. The census shapes only this synthetic
// stand-in; the engine reads no census figure at decision time, and in production the lean is the
// customer's real warehouse sales. Every region the seed writes is read back through the panel's own
// read, labelled synthetic → warehouse; a region that reads wrong is read again, then seeded again.
import { readFileSync } from 'node:fs';

export const round3 = (n) => Math.round(n * 1000) / 1000;
export const usd = (n) => `$${Number(n).toLocaleString('en-US')}`;

// ── The census rows ─────────────────────────────────────────────────────────

const CENSUS_ROW = /\(\s*'(region|national)'\s*,\s*'([A-Z]{2})'\s*,\s*'([^']+)'\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*'([^']+)'\s*,\s*'([^']+)'\s*\)/g;

/**
 * The census rows as migrations/seed/seed_011_geo.sql loads them into geo_census: one region row per
 * state and DC, and the national row. INSERT OR IGNORE keeps the first row of a key, so this does too.
 */
export function parseCensus(sql) {
  const rows = new Map();
  let national = null;
  for (const m of String(sql).matchAll(CENSUS_ROW)) {
    const row = { key: m[1] === 'national' ? 'US' : `US-${m[2]}`, label: m[3], income: Number(m[4]), homeValue: Number(m[5]), source: m[6], vintage: m[7] };
    if (m[1] === 'national') national ??= row;
    else if (!rows.has(row.key)) rows.set(row.key, row);
  }
  return { rows, national };
}
export const readCensus = (file) => parseCensus(readFileSync(file, 'utf8'));

// ── The model ───────────────────────────────────────────────────────────────

const rowKeyOf = (touches, key) => key.map((k) => touches[k]).join('|');

/** Units of the blended category by row key (brand|ecosystem|priceBand in Vantage), so two regions blend row by row. */
export function blendUnits(rows, blend) {
  const m = new Map();
  for (const r of rows) {
    if (r.touches[blend.dimension] !== blend.value) continue;
    const k = rowKeyOf(r.touches, blend.key);
    m.set(k, (m.get(k) ?? 0) + r.units);
  }
  return m;
}

/** The regions an extra row is sold in: a list, or an object of named lists taken together. */
export const extraRegions = (extra) => new Set(Array.isArray(extra.regions) ? extra.regions : Object.values(extra.regions).flat());

/** One modelled state: low · (1 − t) + high · t over the blended rows, whole sales by largest remainder, plus the extras listed for it. */
export function modelledRegion(key, census, { national, model, rehearsed }) {
  const x = Math.max(-1, Math.min(1, (census.income - national.income) / model.spreadUsd));
  const t = 0.5 + model.tSpan * x;
  const lo = blendUnits(rehearsed[model.low].rows, model.blend), hi = blendUnits(rehearsed[model.high].rows, model.blend);
  const exact = [...new Set([...lo.keys(), ...hi.keys()])].map((k) => ({ k, u: (lo.get(k) ?? 0) * (1 - t) + (hi.get(k) ?? 0) * t }));
  const total = Math.round(exact.reduce((n, r) => n + r.u, 0));
  for (const r of exact) { r.n = Math.floor(r.u); r.rem = r.u - r.n; }
  let short = total - exact.reduce((n, r) => n + r.n, 0);
  for (const r of [...exact].sort((a, b) => b.rem - a.rem || a.k.localeCompare(b.k))) { if (short <= 0) break; r.n += 1; short -= 1; }
  const rows = exact.filter((r) => r.n > 0).map((r) => {
    const parts = r.k.split('|');
    return { touches: { [model.blend.dimension]: model.blend.value, ...Object.fromEntries(model.blend.key.map((k, i) => [k, parts[i]])) }, units: r.n };
  });
  for (const extra of model.extras) if (extraRegions(extra).has(key)) rows.push({ touches: { ...extra.touches }, units: extra.units });
  // Shown on the panel under the lean; the route keeps letters, digits and .,:;'’()—- to 80 characters.
  return { label: model.label.replace(/\{\{census\.label\}\}/g, census.label), rows, census, model: { x: round3(x), t: round3(t) } };
}

// ── The fixed model: a seeded, stable lean per state with declared skews, no census term anywhere ──
//
//   model.kind 'fixed' (lane K5, on Lane D1's need: OH's regional sales lean by a seeded draw, not by income):
//     rows    the mix every modelled state sells before its lean (the national rows)
//     leans   drawn per state from the seed, in order. With `factor`: one of `values` leads, and the rows that carry it
//             (and every `within` touch) are scaled by the factor. With `shares`: a seeded shuffle of `values` gives
//             the order, and the rows that carry the i-th value (within `within`) share shares[i] of those rows' total
//     skews   declared, never drawn: in the listed regions, the rows that carry every `when` touch are scaled by the factor
//     extras  as the income-tilt model's: a fixed row in the listed states
//   The draw: FNV-1a (32-bit, over the UTF-16 code units) of "<seed>|<region key>" seeds mulberry32, so a region's lean
//   is the same on every run and every machine. The census file names the states; no census figure enters a row.

/** FNV-1a, 32-bit, over a string's UTF-16 code units. */
export function fnv1a(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}
/** mulberry32: a small seeded generator in [0, 1). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const carries = (touches, when) => Object.entries(when || {}).every(([d, v]) => touches[d] === v);
const arr = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);

/** One state under the fixed model: the national rows, its seeded leans, the declared skews, whole sales, the extras. */
export function fixedRegion(key, census, { model, limits = null }) {
  const draw = mulberry32(fnv1a(`${model.seed}|${key}`));
  const rows = model.rows.map((r) => ({ touches: { ...r.touches }, units: r.units }));
  const leads = {};
  for (const lean of model.leans) {
    const within = rows.filter((r) => carries(r.touches, lean.within) && lean.values.includes(r.touches[lean.dimension]));
    if (lean.factor !== undefined) {
      const v = lean.values[Math.floor(draw() * lean.values.length)];
      leads[lean.dimension] = v;
      for (const r of within) if (r.touches[lean.dimension] === v) r.units *= lean.factor;
      continue;
    }
    const order = [...lean.values];
    for (let i = order.length - 1; i > 0; i -= 1) { const j = Math.floor(draw() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    leads[lean.dimension] = order[0];
    const total = within.reduce((n, r) => n + r.units, 0), sum = lean.shares.reduce((n, s) => n + s, 0);
    order.forEach((v, i) => {
      const mine = within.filter((r) => r.touches[lean.dimension] === v);
      const had = mine.reduce((n, r) => n + r.units, 0);
      for (const r of mine) r.units = had > 0 ? (r.units / had) * total * (lean.shares[i] / sum) : 0;
    });
  }
  const skewed = [];
  for (const s of model.skews) {
    if (!arr(s.regions).includes(key)) continue;
    skewed.push(s.name);
    for (const r of rows) if (carries(r.touches, s.when)) r.units *= s.factor;
  }
  const cap = limits && limits.unitsPerRow ? limits.unitsPerRow : Infinity;
  const out = rows.map((r) => ({ touches: r.touches, units: Math.min(cap, Math.round(r.units)) })).filter((r) => r.units > 0);
  for (const extra of model.extras) if (extraRegions(extra).has(key)) out.push({ touches: { ...extra.touches }, units: extra.units });
  return { label: model.label.replace(/\{\{census\.label\}\}/g, census.label), rows: out, census, model: { kind: 'fixed', leads, skews: skewed } };
}

/** Every region the seed can write: the rehearsed ones first, verbatim, then every other census region by key. */
export function allRegions({ census, national, rehearsed, model, limits = null }) {
  const all = {};
  for (const [key, r] of Object.entries(rehearsed)) all[key] = { label: r.label, rows: r.rows, census: census.get(key) ?? null, model: null };
  for (const key of [...census.keys()].sort()) {
    if (all[key]) continue;
    all[key] = model.kind === 'fixed' ? fixedRegion(key, census.get(key), { model, limits }) : modelledRegion(key, census.get(key), { national, model, rehearsed });
  }
  return all;
}

/** The whole model from a validated region section: census read, every region built. */
export function buildRegions(region, { path }) {
  const { rows: census, national } = readCensus(path(region.census));
  if (!national || census.size !== region.expectRegions) {
    throw new Error(`${region.census}: expected ${region.expectRegions} region rows and a national row, read ${census.size}${national ? '' : ' and no national row'}`);
  }
  return { census, national, all: allRegions({ census, national, rehearsed: region.rehearsed, model: region.model, limits: region.limits }) };
}

export const unitsOf = (rows) => rows.reduce((n, r) => n + r.units, 0);

/** Units per dimension per value: what the region object will hold, before decay. */
export function unitsByDimension(rows) {
  const out = {};
  for (const r of rows) for (const [dim, value] of Object.entries(r.touches)) { (out[dim] ??= {})[value] = (out[dim][value] ?? 0) + r.units; }
  return out;
}

/** Within-dimension shares, leader = 1, exactly as the region object will publish them (before decay). */
export function sharesOf(rows) {
  const r = unitsByDimension(rows);
  return Object.fromEntries(Object.entries(r).map(([dim, values]) => {
    const max = Math.max(...Object.values(values));
    return [dim, Object.fromEntries(Object.entries(values).sort((a, b) => b[1] - a[1]).map(([v, x]) => [v, Math.round((x / max) * 1000) / 1000]))];
  }));
}
export const shareLine = (s, order) => order.map((d) => Object.entries(s[d] || {}).map(([v, x]) => `${v} ${x}`).join(' ')).join(' · ');

/** The seed route's own checks (vantageColdStart.ts, validSeed), made before anything is sent. */
export function rowsProblems(rows, vocabulary, limits) {
  const out = [];
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > limits.rows) return [`rows: 1..${limits.rows}`];
  let total = 0;
  rows.forEach((r, i) => {
    for (const [dim, value] of Object.entries(r.touches ?? {})) {
      if (!Object.hasOwn(vocabulary, dim)) out.push(`rows[${i}].touches.${dim}: not a seeded dimension (${Object.keys(vocabulary).join(', ')})`);
      else if (!vocabulary[dim].includes(value)) out.push(`rows[${i}].touches.${dim}: one of ${vocabulary[dim].join(', ')}`);
    }
    if (!Number.isSafeInteger(r.units) || r.units < 1 || r.units > limits.unitsPerRow) out.push(`rows[${i}].units: whole number 1..${limits.unitsPerRow}`);
    total += r.units;
  });
  if (total > limits.units) out.push(`at most ${limits.units} units per region`);
  return out;
}

// ── Printing (the same lines scripts/seed-vantage-region.mjs prints) ────────

const TEXT_DEFAULTS = { rehearsedNote: 'rehearsed', shareOrder: null, blendWord: 'blended', extraWord: 'extra' };
export const textOf = (region) => ({ ...TEXT_DEFAULTS, ...(region.text ?? {}), shareOrder: region.text?.shareOrder ?? Object.keys(region.vocabulary) });

export function modelLine(region, { national, all }) {
  const m = region.model, text = textOf(region);
  const short = (k) => k.replace(/^US-/, '');
  if (m.kind === 'fixed') {
    const leans = m.leans.map((l) => `${l.dimension} ${l.factor !== undefined ? `leads ×${l.factor} with one of ${l.values.join('/')}` : `in a seeded order of ${l.values.join('/')} at ${l.shares.join('/')}`}`).join('; ');
    const skews = m.skews.map((s) => `${s.name} ×${s.factor} in ${arr(s.regions).length} region(s)`).join('; ');
    const extras = m.extras.map((x) => `${x.name} ${x.units} in the listed states (${extraRegions(x).size})`).join('; ');
    return `The model: fixed, seeded "${m.seed}" (FNV-1a of "<seed>|<region>" seeding mulberry32, the same every run); ${unitsOf(m.rows)} national units a state; ${leans || 'no drawn lean'}; skews: ${skews || 'none'}`
      + `${extras ? `; ${extras}` : ''}. No census figure enters a row; ${region.census} names the states only.\n`;
  }
  const totals = [...new Set([m.low, m.high].map((k) => unitsOf(region.rehearsed[k].rows.filter((r) => r.touches[m.blend.dimension] === m.blend.value))))];
  const extras = m.extras.map((x) => `${x.name} ${x.units} in the listed states (${extraRegions(x).size})`).join('; ');
  return `The model: x = clamp((income − ${usd(national.income)}) / ${usd(m.spreadUsd)}, −1, 1); t = 0.5 + ${m.tSpan}·x; ${text.blendWord} = ${short(m.low)}·(1 − t) + ${short(m.high)}·t, ${totals.join(' to ')};`
    + ` ${extras}. Income: the geo_census region rows (${national.source}, 1-year), from ${region.census}.\n`;
}

export function regionLine(region, key, r) {
  const m = region.model, text = textOf(region);
  if (m.kind === 'fixed') {
    const how = r.model ? `leads ${Object.entries(r.model.leads).map(([d, v]) => `${d} ${v}`).join(', ') || 'none'}${r.model.skews.length ? ` · ${r.model.skews.join(', ')}` : ''}` : text.rehearsedNote;
    return `${key.padEnd(6)} ${(r.census ? r.census.label : key).padEnd(21)} ${how.padEnd(40)} ${String(unitsOf(r.rows)).padStart(4)} units  ${shareLine(sharesOf(r.rows), text.shareOrder)}`;
  }
  const blended = r.rows.filter((x) => x.touches[m.blend.dimension] === m.blend.value).reduce((n, x) => n + x.units, 0);
  return `${key.padEnd(6)} ${(r.census ? r.census.label : key).padEnd(21)} ${r.census ? usd(r.census.income).padStart(9) : ''.padStart(9)}  `
    + `${r.model ? `x ${r.model.x.toFixed(3).padStart(6)} t ${r.model.t.toFixed(3)}` : text.rehearsedNote.padEnd(20)}  `
    + `${String(blended).padStart(3)} ${text.blendWord} ${String(unitsOf(r.rows) - blended).padStart(2)} ${text.extraWord}  ${shareLine(sharesOf(r.rows), text.shareOrder)}`;
}
export const rowsLine = (r) => `       ${JSON.stringify(r.rows.map((x) => [Object.values(x.touches).join('/'), x.units]))}`;

// ── The panel read-back ─────────────────────────────────────────────────────

export async function panelOf({ base, panel, tenant, region, fetchImpl = fetch }) {
  try {
    const res = await fetchImpl(`${base}${panel}?region=${encodeURIComponent(region)}`, { headers: { 'X-Tenant': tenant }, signal: AbortSignal.timeout(20_000) });
    const body = await res.json().catch(() => null);
    return res.ok && body?.ok ? body : null;
  } catch { return null; }
}

/** What a stranger from the region now opens with, through the panel's own read, checked against what was seeded. */
export function panelProblems(region, body, want) {
  if (!body) return ['the panel did not answer'];
  const l = body.lean, c = body.census, out = [];
  if (!l || l.level !== 'region' || l.answered !== region) out.push(`lean answered at ${l ? `${l.level} ${l.answered}` : 'nothing'}`);
  if (!l || l.dataSource !== 'synthetic') out.push(`lean labelled “${l ? l.label : 'none'}”`);
  if (!l || !l.seeded || l.seeded.units !== unitsOf(want.rows)) out.push(`seed marker ${l && l.seeded ? l.seeded.units : 'missing'}, seeded ${unitsOf(want.rows)}`);
  if (want.census && (!c || c.grain !== 'state' || c.medianHouseholdIncomeUsd !== want.census.income)) out.push(`census ${c ? `${c.grain} $${c.medianHouseholdIncomeUsd}` : 'none'}, model ${usd(want.census.income)}`);
  return out;
}

export function panelLine(region, b) {
  const c = b && b.census, l = b && b.lean;
  return `${region} panel: grain ${b ? b.grain : '—'}; census ${c ? `${c.label} $${c.medianHouseholdIncomeUsd} / $${c.medianHomeValueUsd} (${c.estimate})` : 'none'}; `
    + `lean ${l ? `${l.level} ${l.answered}, ${l.events} events${l.liveEvents ? ` (${l.liveEvents} live)` : ''}, in force ${l.inForce}, ${l.label}, leaders ${JSON.stringify(l.leaders)}` : 'none'}`;
}

/** The region the edge places this machine in, as the panel reads it with nothing asserted; null when it gives none. */
export async function hereRegion({ base, panel, tenant, fetchImpl = fetch }) {
  const res = await fetchImpl(`${base}${panel}`, { headers: { 'X-Tenant': tenant }, signal: AbortSignal.timeout(20_000) }).catch(() => null);
  const body = res && res.ok ? await res.json().catch(() => null) : null;
  return body && body.region && body.region.source === 'edge' ? body.region.key : null;
}

/**
 * One region, replaced. A rerun leaves exactly this data, so a transient refusal (a 5xx, or no answer: the
 * local dev runtime restarts when a durable object throws) is asked again, twice, seconds apart.
 */
export async function seedRegion({ base, route, headers, region, label, rows, log = console.log, sleep, fetchImpl = fetch }) {
  const t0 = Date.now();
  let res, body;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      res = await fetchImpl(`${base}${route}`, { method: 'POST', headers, body: JSON.stringify({ region, label, rows }), signal: AbortSignal.timeout(120_000) });
      body = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
    } catch (error) { res = { ok: false, status: 0 }; body = { ok: false, error: error.message }; }
    if ((res.ok && body.ok === true) || (res.status > 0 && res.status < 500) || attempt === 3) break;
    log(`${region}: answered ${res.status || 'nothing'}; asking again (${attempt + 1} of 3)`);
    await sleep(3000 * attempt);
  }
  if (!res.ok || body.ok !== true) { log(`${region}: ${JSON.stringify({ status: res.status, ...body })}`); return { ok: false, body }; }
  log(`${region}: ${body.frames} synthetic sales in ${((Date.now() - t0) / 1000).toFixed(1)} s, dataSource ${body.dataSource} → ${body.swapTo}; leaders ${JSON.stringify(body.published?.leaders ?? null)}`);
  return { ok: true, body };
}

/**
 * Seed the chosen regions (unless checkOnly), then read every one back; KV and the isolates' trend caches
 * settle within a minute, so a region that reads wrong is read again after `settleMs`, and if it still
 * reads wrong it is seeded once more and read again. Returns the panels and the regions still wrong.
 */
export async function runRegionSeed({ region, tenant, base, all, chosen, headers, checkOnly = false, log = console.log,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)), settleMs = 65_000, fetchImpl = fetch }) {
  let ok = true;
  const seeded = {};
  const seedOne = async (key) => {
    const r = await seedRegion({ base, route: region.route, headers, region: key, label: all[key].label, rows: all[key].rows, log, sleep, fetchImpl });
    seeded[key] = r.body;
    return r.ok;
  };
  if (!checkOnly) for (const key of chosen) if (!await seedOne(key)) ok = false;
  const read = (key) => panelOf({ base, panel: region.panel, tenant, region: key, fetchImpl });
  const panels = new Map();
  let wrong = [];
  for (const key of chosen) { const b = await read(key); panels.set(key, b); if (panelProblems(key, b, all[key]).length) wrong.push(key); }
  for (const pass of checkOnly ? [] : ['read', 'seed']) {
    if (!wrong.length) break;
    log(`\n${wrong.length} region(s) read wrong (${wrong.join(', ')}); ${pass === 'seed' ? 'seeding them again, then ' : ''}waiting ${Math.round(settleMs / 1000)} s for KV and the trend caches before reading again`);
    if (pass === 'seed') for (const key of wrong) await seedOne(key);
    await sleep(settleMs);
    const still = [];
    for (const key of wrong) { const b = await read(key); panels.set(key, b); if (panelProblems(key, b, all[key]).length) still.push(key); }
    wrong = still;
  }
  log('');
  for (const key of chosen) {
    const problems = panelProblems(key, panels.get(key), all[key]);
    log(panelLine(key, panels.get(key)) + (problems.length ? `  ✗ ${problems.join('; ')}` : ''));
  }
  log(`\n${chosen.length - wrong.length} of ${chosen.length} region(s) answer at region level, labelled synthetic → warehouse, with the census the model used`
    + `${wrong.length ? `; wrong: ${wrong.join(', ')}` : ''}.`);
  if (!ok && !wrong.length) log('Every refusal above was put right by the second pass.');
  return { ok, wrong, panels, seeded };
}

// scripts/demo-kit/lib/seed.mjs — a demo's documents: windows re-anchored to now, the beat envelopes,
// the local checks, and the bootstrap publish.
//
// Lifted from scripts/seed-vantage.mjs with every Vantage constant made a parameter:
//   §2  time: windows in days around an anchor, and time passing as a uniform shift of every window
//   §5  the envelope every beat document shares
//   §6  the local checks made before anything is written (vocabulary, registry, regional list, seeds)
//   §8  the publish: the demo bootstrap once, then one versioned write per document against exactly
//       what was read (revision and publication digest in If-Match)
//
// A demo's beat documents are DATA. A seed run reads them, slides every window by (now − the recorded
// anchor), writes them back (the worker applies beats from its own ASSETS copy, so a reseed is followed
// by a deploy on a hosted worker) and publishes the opening documents. Nothing here knows Vantage.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const MINUTE = 60_000, HOUR = 60 * MINUTE, DAY = 24 * HOUR;
export const iso = (ms) => new Date(ms).toISOString();

/** An instant as the documents write it (Date#toISOString), alone or inside a sentence. */
export const ISO_INSTANT = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z/;
const ISO_INSTANT_ALL = new RegExp(ISO_INSTANT.source, 'g');
const ISO_INSTANT_WHOLE = new RegExp(`^${ISO_INSTANT.source}$`);

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// ── Time ────────────────────────────────────────────────────────────────────

/** A window in days either side of the anchor (seed-vantage.mjs, windowAt). */
export const windowAt = (anchorMs, [fromDays, toDays]) => ({ from: iso(anchorMs + fromDays * DAY), to: iso(anchorMs + toDays * DAY) });

/** Time passes by publishing: every window moves back by the same amount, and the real clock is untouched. */
export const shifted = (pieces, byMs) => pieces.map((p) => (!p.window ? p : { ...p,
  window: { from: iso(Date.parse(p.window.from) - byMs), to: iso(Date.parse(p.window.to) - byMs) } }));

function assertWindows(pieces, where) {
  for (const p of pieces) {
    if (!p.window) continue;
    const ok = ISO_INSTANT_WHOLE.test(p.window.from ?? '') && ISO_INSTANT_WHOLE.test(p.window.to ?? '');
    if (!ok) throw new Error(`${where}: piece ${p.customerContentId ?? p.id} has a window that is not two ISO instants`);
  }
}

/** A catalog document with every window moved from one anchor to another; anything else unchanged. */
export function reanchorDocument(document, fromMs, toMs, where = 'document') {
  if (!isObject(document) || !Array.isArray(document.pieces)) return document;
  assertWindows(document.pieces, where);
  return { ...document, pieces: shifted(document.pieces, fromMs - toMs) };
}

/** A beat envelope re-anchored: a publish of a catalog slides its windows; a context beat carries none. */
export function reanchorEnvelope(envelope, fromMs, toMs) {
  if (envelope?.kind !== 'publish' || !Array.isArray(envelope.publish?.document?.pieces)) return envelope;
  return { ...envelope, publish: { ...envelope.publish, document: reanchorDocument(envelope.publish.document, fromMs, toMs, envelope.name) } };
}

/**
 * Every beat envelope and the anchor file slid from the recorded anchor to `toMs`. The story keeps its
 * shape: a window that opened 18 days before the old anchor opens 18 days before the new one.
 */
export function reanchorBeats({ envelopes, anchorDoc, anchorField, toMs }) {
  const fromMs = Date.parse(anchorDoc?.[anchorField] ?? '');
  if (!Number.isFinite(fromMs) || !ISO_INSTANT_WHOLE.test(anchorDoc[anchorField])) throw new Error(`the anchor file's "${anchorField}" is not an ISO instant`);
  const out = {};
  for (const [name, e] of Object.entries(envelopes)) out[name] = reanchorEnvelope(e, fromMs, toMs);
  return { envelopes: out, anchorDoc: { ...anchorDoc, [anchorField]: iso(toMs) }, fromMs, toMs, deltaMs: toMs - fromMs };
}

/** Every instant in a value written relative to an anchor (@anchor+…ms), inside sentences too: for comparing two seeds. */
export function relativeTimestamps(value, anchorMs) {
  if (typeof value === 'string') return value.replace(ISO_INSTANT_ALL, (s) => { const d = Date.parse(s) - anchorMs; return `@anchor${d < 0 ? '-' : '+'}${Math.abs(d)}ms`; });
  if (Array.isArray(value)) return value.map((v) => relativeTimestamps(v, anchorMs));
  if (isObject(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, relativeTimestamps(v, anchorMs)]));
  return value;
}

/** Paths of instants a reseed would NOT move: anything but a piece window, and the anchor field itself. */
export function loneTimestamps(value, { path = '$', skip = [] } = {}) {
  const out = [];
  const walk = (v, p, keys) => {
    if (typeof v === 'string') {
      if (!ISO_INSTANT.test(v)) return;
      const n = keys.length;
      const inWindow = n >= 4 && (keys[n - 1] === 'from' || keys[n - 1] === 'to') && keys[n - 2] === 'window' && keys[n - 4] === 'pieces';
      if (!inWindow && !skip.includes(p)) out.push(p);
      return;
    }
    if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${p}[${i}]`, [...keys, i]));
    else if (isObject(v)) for (const [k, x] of Object.entries(v)) walk(x, `${p}.${k}`, [...keys, k]);
  };
  walk(value, path, []);
  return out;
}

/** Structural differences between two JSON values, as { path, a, b }; empty when equal. Key order is ignored. */
export function deepDiff(a, b, path = '$', out = [], limit = 500) {
  if (out.length >= limit || Object.is(a, b)) return out;
  const kind = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);
  if (kind(a) !== kind(b) || (kind(a) !== 'object' && kind(a) !== 'array')) { out.push({ path, a, b }); return out; }
  if (Array.isArray(a)) {
    if (a.length !== b.length) out.push({ path: `${path}.length`, a: a.length, b: b.length });
    for (let i = 0; i < Math.min(a.length, b.length); i += 1) deepDiff(a[i], b[i], `${path}[${i}]`, out, limit);
    return out;
  }
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (!Object.hasOwn(a, k)) out.push({ path: `${path}.${k}`, a: undefined, b: b[k] });
    else if (!Object.hasOwn(b, k)) out.push({ path: `${path}.${k}`, a: a[k], b: undefined });
    else deepDiff(a[k], b[k], `${path}.${k}`, out, limit);
  }
  return out;
}

// ── Beat envelopes ──────────────────────────────────────────────────────────

/** The act a beat falls in, from a list of { n, through, name } in order (seed-vantage.mjs, actOf). */
export const actOfFrom = (acts) => (beat) => {
  const act = acts.find((a) => beat <= a.through);
  if (!act) throw new Error(`beat ${beat} falls after the last act`);
  return act;
};

/** The envelope every beat document shares (seed-vantage.mjs §5). The route publishes `publish.document` for the names on its closed list. */
export function envelope(name, def, actOf) {
  const act = def.beat ? actOf(def.beat) : null;
  const { kind, document, beat, press, engine, sees, ...rest } = def;
  return {
    name,
    ...(beat ? { beat, act: act.n, actName: act.name } : { beat: 0, act: 0, actName: 'Reset' }),
    press,
    kind: document ? 'publish' : 'context',
    ...(document ? { publish: { kind, document } } : {}),
    ...rest,
    ...(engine ? { engine } : {}),
    ...(sees ? { sees } : {}),
  };
}

export const PUBLISH_KINDS = Object.freeze(['catalog', 'slots', 'learn']);

/** What is wrong with one envelope's shape; empty when it is sound. */
export function envelopeProblems(name, e) {
  if (!isObject(e)) return [`${name}: not a JSON object`];
  const out = [];
  if (e.name !== name) out.push(`${name}: its name field says "${e.name}"`);
  if (!Number.isSafeInteger(e.beat) || e.beat < 0) out.push(`${name}: beat must be a whole number, 0 for a reset document`);
  if (!Number.isSafeInteger(e.act) || e.act < 0) out.push(`${name}: act must be a whole number`);
  if (typeof e.actName !== 'string' || !e.actName) out.push(`${name}: actName is required`);
  if (typeof e.press !== 'string' || !e.press) out.push(`${name}: press is required (what the presenter presses)`);
  if (e.kind === 'publish') {
    if (!isObject(e.publish) || !PUBLISH_KINDS.includes(e.publish.kind) || !isObject(e.publish.document)) out.push(`${name}: a publish carries publish: { kind: ${PUBLISH_KINDS.join(' | ')}, document }`);
  } else if (e.kind === 'context') {
    if (e.publish !== undefined) out.push(`${name}: a context beat publishes nothing`);
  } else out.push(`${name}: kind must be publish or context`);
  if (e.beat === 0 && (e.act !== 0 || e.kind !== 'publish')) out.push(`${name}: beat 0 is a reset document: act 0 and a publish`);
  return out;
}

/** The numbered beats must be exactly 1..count, once each (seed-vantage.mjs, BEAT_ORDER). */
export function beatOrderProblems(envelopes, count) {
  const numbered = Object.values(envelopes).filter((d) => d.beat > 0).map((d) => d.beat).sort((a, b) => a - b);
  return numbered.length !== count || numbered.some((n, i) => n !== i + 1) ? [`the beats must be exactly 1..${count}; found ${numbered.join(', ') || 'none'}`] : [];
}

/** Every piece any catalog publish names, by id, first occurrence kept (the opening catalog plus what beats add). */
export function catalogPieces(envelopes) {
  const byId = new Map();
  for (const e of Object.values(envelopes)) {
    if (e?.kind !== 'publish' || e.publish?.kind !== 'catalog') continue;
    for (const p of e.publish.document.pieces ?? []) if (!byId.has(p.id)) byId.set(p.id, p);
  }
  return [...byId.values()];
}

// ── Local checks (seed-vantage.mjs §6) ─────────────────────────────────────

/**
 * Every vocabulary value is named by at least one piece (a value no piece names builds no taste at all,
 * by the engine's own rule), every tag is in the vocabulary, the registry names exactly the vocabulary's
 * dimensions in order, and the regional prior's list names registry dimensions only.
 */
export function vocabularyProblems({ pieces, vocabulary, registryKeys, regionalDimensions = [], seedOnly = [] }) {
  const errors = [];
  const named = new Map();
  for (const p of pieces) for (const [dim, values] of Object.entries(p.tags ?? {})) {
    if (seedOnly.includes(dim)) continue;
    if (!Object.hasOwn(vocabulary, dim)) { errors.push(`${p.customerContentId ?? p.id}: tag dimension "${dim}" is not in the registry`); continue; }
    for (const v of values) {
      if (!vocabulary[dim].includes(v)) { errors.push(`${p.customerContentId ?? p.id}: ${dim}=${v} is not in the vocabulary`); continue; }
      if (!named.has(dim)) named.set(dim, new Set());
      named.get(dim).add(v);
    }
  }
  for (const [dim, values] of Object.entries(vocabulary)) {
    const missing = values.filter((v) => !named.get(dim)?.has(v));
    if (missing.length) errors.push(`no piece names ${dim}=${missing.join(', ')}; events carrying it would build no taste`);
  }
  if (registryKeys.join() !== Object.keys(vocabulary).join()) errors.push(`registry and vocabulary disagree (registry ${registryKeys.join(', ')}; vocabulary ${Object.keys(vocabulary).join(', ')})`);
  const unknown = regionalDimensions.filter((d) => !registryKeys.includes(d));
  if (unknown.length) errors.push(`learn.regional.dimensions names ${unknown.join(', ')}, not a registry dimension`);
  return errors;
}

/** The arrival seeds on a slots document: each tag a dimension the slot weights (an error), and carried by a piece of that slot (a warning). */
export function seedRuleProblems({ slotsDocument, pieces }) {
  const errors = [], warnings = [];
  for (const slots of Object.values(slotsDocument?.pages ?? {})) {
    for (const s of slots ?? []) {
      for (const [i, rule] of (s.seeds ?? []).entries()) {
        for (const tag of rule?.tags ?? []) {
          if (!Object.hasOwn(s.weights ?? {}, tag.dimension)) {
            errors.push(`${s.slot}.seeds[${i}]: '${tag.dimension}' is not a dimension the ${s.slot} slot weights (${Object.keys(s.weights ?? {}).join(', ')})`);
          }
          const carried = pieces.some((p) => (p.slotTypes ?? []).includes(s.slot) && (p.tags?.[tag.dimension] ?? []).includes(tag.value));
          if (!carried) warnings.push(`${s.slot}.seeds[${i}]: no ${s.slot} piece carries ${tag.dimension}=${tag.value}; that tag lifts nothing`);
        }
      }
    }
  }
  return { errors, warnings };
}

// ── Reading, preparing and writing ─────────────────────────────────────────

export const jsonText = (value) => `${JSON.stringify(value, null, 1)}\n`;
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));

/** The beat documents a config names, and its anchor file, as written on disk. */
export function readBeats(dir, names, anchorFile) {
  const envelopes = {};
  for (const name of names) envelopes[name] = readJson(join(dir, `${name}.json`));
  return { envelopes, anchorDoc: readJson(join(dir, anchorFile)) };
}

export const countByType = (pieces) => pieces.reduce((n, p) => ({ ...n, [p.type]: (n[p.type] ?? 0) + 1 }), {});

/** A publish note from the config, with {{anchor}} and {{count.<type>}} filled from the opening catalog. */
export const fillNote = (template, { anchorIso, counts }) => (template === undefined ? undefined : String(template)
  .replace(/\{\{anchor\}\}/g, anchorIso)
  .replace(/\{\{count\.([A-Za-z0-9_-]+)\}\}/g, (_, type) => String(counts[type] ?? 0)));

/**
 * Everything a seed run needs, from a validated config, with nothing written and nothing sent: the
 * re-anchored envelopes and anchor file, the four opening documents, the notes, and every problem the
 * local checks found. `path` resolves a repository-relative path.
 */
export function prepareSeed({ config, path, nowMs }) {
  const seed = config.seed;
  const errors = [], warnings = [];
  const dir = path(seed.beats.dir);
  const raw = readBeats(dir, seed.beats.files, seed.beats.anchor.file);
  for (const [name, e] of Object.entries(raw.envelopes)) errors.push(...envelopeProblems(name, e));
  if (errors.length) return { errors, warnings };

  const { envelopes, anchorDoc, fromMs, toMs, deltaMs } = reanchorBeats({ envelopes: raw.envelopes, anchorDoc: raw.anchorDoc, anchorField: seed.beats.anchor.field, toMs: nowMs });

  const documents = {};
  for (const member of ['reflex', 'catalog', 'slots', 'learn']) {
    const d = seed.documents[member];
    if (d.file) documents[member] = readJson(path(d.file));
    else {
      const e = envelopes[d.beat];
      if (e?.kind !== 'publish' || e.publish.kind !== member) { errors.push(`seed.documents.${member}: ${d.beat} is not a ${member} publish`); continue; }
      documents[member] = e.publish.document;
    }
  }

  errors.push(...beatOrderProblems(envelopes, seed.beats.count));
  for (const [name, kind] of Object.entries(seed.beats.publishable)) {
    const e = envelopes[name];
    if (e?.kind !== 'publish') errors.push(`${name}: on the closed list, but its document publishes nothing`);
    else if (e.publish.kind !== kind) errors.push(`${name}: listed as ${kind}, but it publishes ${e.publish.kind}`);
  }
  for (const [name, e] of Object.entries(envelopes)) if (e.kind === 'publish' && !Object.hasOwn(seed.beats.publishable, name)) warnings.push(`${name}: a publish the route's closed list does not name, so no press can apply it`);
  if (Array.isArray(anchorDoc.beatIndex)) {
    for (const b of anchorDoc.beatIndex) {
      const e = envelopes[b?.name];
      if (!e) warnings.push(`${seed.beats.anchor.file}: beatIndex names ${b?.name}, which is not a beat document`);
      else if (e.beat !== b.beat || e.kind !== b.kind) warnings.push(`${seed.beats.anchor.file}: beatIndex says ${b.name} is beat ${b.beat} (${b.kind}); the document says ${e.beat} (${e.kind})`);
    }
  }

  const pieces = catalogPieces(envelopes);
  if (documents.reflex && documents.learn) {
    errors.push(...vocabularyProblems({
      pieces, vocabulary: seed.vocabulary,
      registryKeys: (documents.reflex.dimensions ?? []).map((d) => d.key),
      regionalDimensions: documents.learn.regional?.dimensions ?? [],
      seedOnly: seed.seedOnlyDimensions ?? [],
    }));
  }
  const slotsDocuments = new Set([documents.slots, ...Object.values(envelopes).filter((e) => e.kind === 'publish' && e.publish.kind === 'slots').map((e) => e.publish.document)]);
  const seen = new Set();
  for (const slotsDocument of slotsDocuments) {
    const found = seedRuleProblems({ slotsDocument, pieces });
    for (const m of found.errors) if (!seen.has(m)) { seen.add(m); errors.push(m); }
    for (const m of found.warnings) if (!seen.has(m)) { seen.add(m); warnings.push(m); }
  }
  for (const [name, e] of Object.entries(envelopes)) for (const p of loneTimestamps(e, { path: name })) warnings.push(`${p}: an instant a reseed does not move`);
  for (const p of loneTimestamps(anchorDoc, { path: seed.beats.anchor.file, skip: [`${seed.beats.anchor.file}.${seed.beats.anchor.field}`] })) warnings.push(`${p}: an instant a reseed does not move`);

  const opening = documents.catalog?.pieces ?? [];
  const counts = countByType(opening);
  const openingIds = new Set(opening.map((p) => p.id));
  const added = countByType(pieces.filter((p) => !openingIds.has(p.id)));
  const anchorIso = iso(toMs);
  const notes = Object.fromEntries(['reflex', 'catalog', 'slots', 'learn'].map((m) => [m, fillNote(seed.notes?.[m], { anchorIso, counts })]));
  const art = {};
  for (const p of pieces) { const a = (art[p.type] ??= { with: 0, of: 0 }); a.of += 1; if (p.renderUrl) a.with += 1; }
  return { errors, warnings, envelopes, anchorDoc, anchorFile: seed.beats.anchor.file, documents, notes, fromMs, toMs, deltaMs, counts, added, art, pieces };
}

/** The re-anchored envelopes and the anchor file, written in the seed's own format. Returns the file count. */
export function writeBeatFiles(dir, { envelopes, anchorFile, anchorDoc }) {
  mkdirSync(dir, { recursive: true });
  for (const [name, e] of Object.entries(envelopes)) writeFileSync(join(dir, `${name}.json`), jsonText(e));
  writeFileSync(join(dir, anchorFile), jsonText(anchorDoc));
  return Object.keys(envelopes).length + 1;
}

// ── Publish (seed-vantage.mjs §8) ──────────────────────────────────────────

export const authHeaders = (token, tenant) => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'X-Tenant': tenant });

/** The four documents a scope needs, in publish order, and the path each is written through. */
export const MEMBERS = Object.freeze([
  { member: 'reflex', path: '/config/reflex' },
  { member: 'catalog', path: '/content/catalog' },
  { member: 'slots', path: '/content/slots' },
  { member: 'learn', path: '/content/learn' },
]);

/**
 * One versioned publish with the preconditions the configuration authority requires: read first, then
 * write against exactly what was read (revision and publication digest in If-Match, the expected
 * revision in Idempotency-Key).
 */
export async function versionedPut({ base, scope, headers, path, document, note, fetchImpl = fetch }) {
  const url = `${base}${path}?scope=${encodeURIComponent(scope)}`;
  const current = await fetchImpl(url, { headers });
  const head = await current.json().catch(() => null);
  if (!current.ok || !head || head.ok === false || !head.publication) {
    return { status: current.status, ok: false, error: (head && head.error) || `could not read ${path}` };
  }
  const put = { ...headers,
    'If-Match': `"${head.revision}/${head.publication.revision}/${head.publication.digest}"`,
    'Idempotency-Key': `${head.revision}:${crypto.randomUUID()}` };
  const envelopeOf = path.startsWith('/config/') ? { config: document, note } : { document, note };
  const res = await fetchImpl(url, { method: 'PUT', headers: put, body: JSON.stringify(envelopeOf) });
  const body = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
  return { status: res.status, ...body };
}

export const reportLine = (what, r) => `${what}: ${JSON.stringify({ ok: r.ok, status: r.status, revision: r.revision, version: r.version, errors: r.errors, error: r.error })}`;

/**
 * The scope needs a publication set before anything can read or write it. This creates one, once; a
 * re-run is refused with already_initialized and the caller falls through to the versioned writes.
 */
export async function bootstrapScope({ base, scope, headers, documents, fetchImpl = fetch }) {
  const res = await fetchImpl(`${base}/ops/demo-bootstrap?scope=${encodeURIComponent(scope)}`, { method: 'POST', headers, body: JSON.stringify(documents) });
  const body = await res.json().catch(() => ({}));
  if (res.ok && body.ok) return { outcome: 'created', status: res.status, body };
  if (body.code === 'already_initialized') return { outcome: 'already_initialized', status: res.status, body };
  return { outcome: 'failed', status: res.status, body };
}

/** The bootstrap, then the four versioned writes, logged line by line as scripts/seed-vantage.mjs logs them. */
export async function publishOpening({ base, scope, token, documents, notes = {}, log = console.log, fetchImpl = fetch }) {
  const headers = authHeaders(token, scope);
  const opened = { reflex: documents.reflex, catalog: documents.catalog, slots: documents.slots, learn: documents.learn };
  const boot = await bootstrapScope({ base, scope, headers, documents: opened, fetchImpl });
  if (boot.outcome === 'created') log(`bootstrap: created the publication set for "${scope}"`);
  else if (boot.outcome === 'already_initialized') log(`bootstrap: "${scope}" already has a publication set`);
  else { log(`bootstrap: ${JSON.stringify({ status: boot.status, ...boot.body })}`); return { ok: false, bootstrap: boot.outcome, results: {} }; }
  let ok = true;
  const results = {};
  for (const { member, path } of MEMBERS) {
    const r = await versionedPut({ base, scope, headers, path, document: opened[member], note: notes[member], fetchImpl });
    results[member] = r;
    log(reportLine(member, r));
    ok = r.ok === true && ok;
  }
  return { ok, bootstrap: boot.outcome, results };
}

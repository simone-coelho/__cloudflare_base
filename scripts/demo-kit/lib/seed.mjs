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
// A demo's beat documents are DATA, the edited source of its story (the design's ruling, K3 part b). A seed
// run reads them, slides every window by (now − the recorded anchor), writes them back (the worker applies
// beats from its own ASSETS copy, so a reseed is followed by a deploy on a hosted worker) and publishes the
// opening documents. Because nothing generates them any more, the local checks also hold the copies a
// generator once kept equal by construction: the anchor file's registry, learn summary, reset and closed
// list against what the seed publishes, and each piece's art against the files the worker serves.
// Nothing here knows Vantage.
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
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

/**
 * The anchor file carries the page's own copies of what the seed publishes: the registry its arithmetic
 * reads (`registry`, with the room-memory labels it shows), the learn summary (`learn`), the reset and the
 * closed list by role (`reset`, `beats`). A generator used to write them from the same definitions; as
 * data they must be checked, because a copy that disagrees puts a figure on stage the engine does not use,
 * or a press the route refuses. Only the copies the anchor file carries are compared. Returns errors.
 */
export function anchorCopyProblems({ anchorDoc, anchorFile = 'the anchor file', documents = {}, seed }) {
  const errors = [];
  const differs = (a, b) => deepDiff(a, b).length > 0;
  const reg = anchorDoc?.registry, reflex = documents.reflex;
  if (isObject(reg) && isObject(reflex)) {
    for (const [k, v] of Object.entries(reg)) {
      if (k === 'vocabulary') { if (differs(v, seed.vocabulary)) errors.push(`${anchorFile}: registry.vocabulary differs from the config's seed.vocabulary`); continue; }
      if (k === 'memory') {
        const dims = new Map((reflex.dimensions ?? []).map((d) => [d.key, d.tauMs ?? reflex.tauMs]));
        for (const m of v?.dimensions ?? []) {
          if (!dims.has(m?.key)) errors.push(`${anchorFile}: registry.memory names ${m?.key}, not a dimension of the registry the seed publishes`);
          else if (m.tauMs !== dims.get(m.key)) errors.push(`${anchorFile}: registry.memory says ${m.key} remembers for ${m.tauMs} ms; the registry the seed publishes says ${dims.get(m.key)} ms`);
        }
        continue;
      }
      if (Object.hasOwn(reflex, k) && differs(v, reflex[k])) errors.push(`${anchorFile}: registry.${k} differs from the registry the seed publishes`);
    }
  }
  const learn = anchorDoc?.learn, learnDoc = documents.learn;
  if (isObject(learn) && isObject(learnDoc)) {
    for (const [k, v] of Object.entries(learn)) {
      if (k === 'gamma') {
        const off = Object.entries(learnDoc.slots ?? {}).filter(([, s]) => s?.gamma !== v).map(([slot]) => slot);
        if (off.length) errors.push(`${anchorFile}: learn.gamma says ${v}; the learn document the seed publishes gives ${off.join(', ')} another γ`);
        continue;
      }
      if (Object.hasOwn(learnDoc, k) && differs(v, learnDoc[k])) errors.push(`${anchorFile}: learn.${k} differs from the learn document the seed publishes`);
    }
  }
  if (Array.isArray(anchorDoc?.reset) && anchorDoc.reset.join() !== (seed.beats.reset ?? []).join()) {
    errors.push(`${anchorFile}: reset is ${anchorDoc.reset.join(', ')}; the config's seed.beats.reset is ${(seed.beats.reset ?? []).join(', ')}`);
  }
  if (isObject(anchorDoc?.beats)) {
    const named = Object.values(anchorDoc.beats).flatMap((byKind) => (isObject(byKind) ? Object.entries(byKind) : []));
    for (const [kind, name] of named) {
      const listed = seed.beats.publishable[name];
      if (listed !== kind) errors.push(`${anchorFile}: beats names ${name} as a ${kind} publish; the closed list ${listed ? `says ${listed}` : 'does not name it'}`);
    }
    const reached = new Set(named.map(([, name]) => name));
    for (const name of Object.keys(seed.beats.publishable)) if (!reached.has(name)) errors.push(`${anchorFile}: beats gives the page no role for ${name}, which the closed list publishes`);
  }
  return errors;
}

/**
 * The product facts a demo's beat documents state, held to its products file (lane K4; K3b's build item in the
 * design's decisions log): the documents carry literal copies of product facts (the ids a piece features, the
 * attributes an event sends, a price), so a product change no longer reaches them and nothing else checks them.
 *
 *   • every `featuredProductIds` entry names a product in the file;
 *   • every object that names a product by `spec.eventId` (default productId: an event's data, a snapshot's
 *     subject) names one the file has, and states only facts it agrees with: each attribute in `spec.attributes`
 *     equals the product's field (one of its values when the field is a list); where `spec.variants` maps an
 *     attribute and the object names a variant by `variants.key` (a storage step), that variant's field; where it
 *     names none, a value one of the product's configurations has (the price of the step she chose).
 *
 * `documents` maps a document's name to its JSON; `products` is the parsed file. Returns errors, by document and
 * path, so a seed refuses before anything is written.
 */
/**
 * A products file with an overlay merged over it (spec.overlay: another lane's rows, OH's specs.json): each overlay
 * row's top-level fields replace the product's own, matched by the product's id. The overlay is a list of rows each
 * naming its product (`overlay.by`, default the id field), under the products' list key, `specs` or `rows`, or an
 * object keyed by the product's id under `specs` or `bySku`. Returns a new products document; neither input changes.
 */
export function mergeOverlay(products, overlay, spec) {
  const listKey = spec.list ?? 'products';
  if (!isObject(products) || !Array.isArray(products[listKey]) || !overlay) return products;
  const by = spec.overlay?.by ?? spec.id;
  const rows = Array.isArray(overlay) ? overlay : [overlay[listKey], overlay.specs, overlay.rows].find(Array.isArray) ?? null;
  const keyed = rows ? Object.fromEntries(rows.filter(isObject).map((r) => [String(r[by]), r])) : [overlay.specs, overlay.bySku].find(isObject) ?? {};
  return { ...products, [listKey]: products[listKey].map((p) => (isObject(p) && keyed[String(p[spec.id])] ? { ...p, ...keyed[String(p[spec.id])] } : p)) };
}

export function productFactProblems({ documents, products, spec }) {
  const listKey = spec.list ?? 'products';
  const list = Array.isArray(products?.[listKey]) ? products[listKey] : null;
  if (!list) return [`the products file has no "${listKey}" list`];
  const get = (o, path) => String(path).split('.').reduce((v, k) => (v == null ? undefined : v[k]), o);
  const byId = new Map(list.filter(isObject).map((p) => [String(get(p, spec.id)), p]));
  const eventId = spec.eventId ?? 'productId';
  const variants = spec.variants ?? null;
  const same = (a, b) => (typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) < 0.005 : String(a) === String(b));
  /** The value an object states agrees with the product's field: equal, or (a list on either side) contained. */
  const agrees = (stated, field) => {
    const want = Array.isArray(field) ? field : [field];
    return (Array.isArray(stated) ? stated : [stated]).every((x) => want.some((y) => same(x, y)));
  };
  const show = (v) => (typeof v === 'string' ? `"${v}"` : JSON.stringify(v));
  const errors = [];
  const check = (obj, where) => {
    const id = String(obj[eventId]);
    const p = byId.get(id);
    if (!p) { errors.push(`${where}: names product ${id}, which the products file does not have`); return; }
    const configs = variants && Array.isArray(get(p, variants.list)) ? get(p, variants.list).filter(isObject) : [];
    const named = variants && obj[variants.key] !== undefined ? configs.find((c) => same(get(c, variants.key), obj[variants.key])) : null;
    if (variants && obj[variants.key] !== undefined && !named) errors.push(`${where}: names ${id} ${variants.key} ${show(obj[variants.key])}, which the products file does not list for it`);
    for (const [attr, field] of Object.entries(spec.attributes)) {
      if (obj[attr] === undefined || attr === eventId) continue;
      const vField = variants?.attributes?.[attr];
      if (vField && named) {
        if (!agrees(obj[attr], get(named, vField))) errors.push(`${where}: ${attr} ${show(obj[attr])} for ${id} ${variants.key} ${show(obj[variants.key])}; the products file says ${show(get(named, vField))}`);
        continue;
      }
      const allowed = [get(p, field), ...(vField ? configs.map((c) => get(c, vField)) : [])].filter((v) => v !== undefined && v !== null);
      if (!allowed.length) { errors.push(`${where}: states ${attr} for ${id}, which the products file does not record (${field})`); continue; }
      if (!allowed.some((v) => agrees(obj[attr], v))) errors.push(`${where}: ${attr} ${show(obj[attr])} for ${id}; the products file says ${show(get(p, field))}${vField && configs.length ? ` (or a configuration's ${vField}: ${configs.map((c) => show(get(c, vField))).join(', ')})` : ''}`);
    }
  };
  const walk = (v, path) => {
    if (Array.isArray(v)) { v.forEach((x, i) => walk(x, `${path}[${i}]`)); return; }
    if (!isObject(v)) return;
    if (typeof v[eventId] === 'string' || typeof v[eventId] === 'number') check(v, path);
    if (Array.isArray(v.featuredProductIds)) {
      v.featuredProductIds.forEach((pid, i) => { if (!byId.has(String(pid))) errors.push(`${path}.featuredProductIds[${i}]: ${pid} is not in the products file`); });
    }
    for (const [k, x] of Object.entries(v)) if (k !== 'featuredProductIds') walk(x, `${path}.${k}`);
  };
  for (const [name, doc] of Object.entries(documents)) walk(doc, name);
  return errors;
}

/**
 * Each piece's art is a file the worker serves (public/ is served at the site root), so a card paints its
 * image or, with no renderUrl, the placeholder; never a broken tag. `served(url)` says whether a site path
 * names a served file. Returns warnings.
 */
export function renderUrlProblems(pieces, served) {
  const out = [];
  for (const p of pieces) {
    if (typeof p.renderUrl !== 'string' || !p.renderUrl.startsWith('/')) continue;
    if (!served(p.renderUrl)) out.push(`${p.customerContentId ?? p.id}: renderUrl ${p.renderUrl} is not a file under public/, so its card would paint a broken image`);
  }
  return out;
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
  // The products file, when the config names one: a beat document's product facts must agree with it (lane K4).
  if (seed.products) {
    let products = null;
    try { products = readJson(path(seed.products.file)); } catch (error) { errors.push(`seed.products.file: ${seed.products.file} could not be read (${error.message})`); }
    const overlayFile = seed.products.overlay?.file ? path(seed.products.overlay.file) : null;
    if (products && overlayFile && existsSync(overlayFile)) {
      try { products = mergeOverlay(products, readJson(overlayFile), seed.products); } catch (error) { errors.push(`seed.products.overlay.file: ${seed.products.overlay.file} could not be read (${error.message})`); }
    } else if (overlayFile) warnings.push(`seed.products.overlay.file: ${seed.products.overlay.file} does not exist yet; the product facts are checked against ${seed.products.file} alone`);
    if (products) errors.push(...productFactProblems({ documents: { ...raw.envelopes, [seed.beats.anchor.file.replace(/\.json$/, '')]: raw.anchorDoc }, products, spec: seed.products }));
  }

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
    const indexed = new Set(anchorDoc.beatIndex.map((b) => b?.name));
    for (const [name, e] of Object.entries(envelopes)) if (e.beat > 0 && !indexed.has(name)) warnings.push(`${seed.beats.anchor.file}: beatIndex leaves out ${name}, beat ${e.beat}`);
  }
  errors.push(...anchorCopyProblems({ anchorDoc, anchorFile: seed.beats.anchor.file, documents, seed }));

  const pieces = catalogPieces(envelopes);
  const served = (url) => {
    let rel;
    try { rel = `public${decodeURIComponent(url.split(/[?#]/)[0])}`; } catch { return false; }
    const abs = path(rel);
    return Boolean(abs) && existsSync(abs) && statSync(abs).isFile();
  };
  warnings.push(...renderUrlProblems(pieces, served));
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

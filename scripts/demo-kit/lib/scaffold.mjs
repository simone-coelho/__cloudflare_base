// scripts/demo-kit/lib/scaffold.mjs — a new demo, from its demo.config.json, as a plan of files (lane K4).
//
// docs/demo-kit/Demo-Kit-Design.md §2.3–§2.5. Pure: planScaffold reads the repository (the kit's templates, the
// demo's own data files when they exist, the other demos' configs for collisions) and returns every file the
// demo needs with its content; scripts/demo-kit/new-demo.mjs writes them, never over an existing file.
//
//   the server        src/demos/<slug>.config.ts (the constants) and src/routes/<slug>.ts (the kit's factories),
//                     plus the mount lines for src/index.ts, printed for the lead and never applied here
//   the worker        wrangler.<slug>.toml, written by scripts/build-demo-worker-config.mjs (new-demo.mjs runs it)
//   the page          public/<slug>/index.html, product.html, m.html on the kit's modules; <slug>.css (the palette as
//                     token overrides); <slug>.js (empty renderers, the facts skeleton the director validates)
//   the beats         public/<slug>/beats.json (the director's script, as data) and beats/: the anchor file, the
//                     opening catalog and slots, and one document per numbered beat, the publishes cut mechanically
//                     from the documents before them
//   the data          catalog.json and the products file when the demo has none yet (a labelled starter set),
//                     img/MANIFEST.json (an empty manifest)
//   the kit config    scripts/demo-kit/configs/<slug>.json with its reflex and learn documents, and two suites with
//                     the arrival checks written (scripts/rehearse-<slug>-page.mjs and -dom.mjs)
//   the documents     docs/<slug>/: the design pointer, the presenter script and the resume, each with a decisions
//                     log and the morning routine
//
// Everything a demo's worker needs that is a cloud resource (its worker, queues, secrets, tenant) is PRINTED, never
// created: that is the owner's one-time approval.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { REPO_ROOT, demoSlots, durationMs } from './config.mjs';
import { DAY, MINUTE, actOfFrom, envelope, iso, jsonText, shifted } from './seed.mjs';

export const TEMPLATES = resolve(REPO_ROOT, 'scripts', 'demo-kit', 'templates');
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const arr = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);

// ── Names ───────────────────────────────────────────────────────────────────

/** A slug's identifiers: oh → { camel: 'oh', pascal: 'Oh', constant: 'OH' }; top-offers → topOffers, TopOffers, TOP_OFFERS. */
export function idents(slug) {
  const words = String(slug).split('-').filter(Boolean);
  const camel = words.map((w, i) => (i ? w[0].toUpperCase() + w.slice(1) : w)).join('');
  return { camel, pascal: camel[0].toUpperCase() + camel.slice(1), constant: words.join('_').toUpperCase() };
}
/** The three operator subjects a demo's TENANTS grants: the routes', the seed's, the region seed's. */
export const operatorsOf = (slug) => ({ routes: `${slug}-demo`, seed: `seed-${slug}`, region: `seed-${slug}-region` });
/** The secrets a demo worker needs, by name only (docs/verizon/RESUME-vantage.md, the deploy checklist). */
export const WORKER_SECRETS = Object.freeze(['TENANTS', 'SDK_KEYS', 'RETENTION', 'JWT_SECRET', 'IDENTITY_SALT']);
const titleCase = (s) => String(s).replace(/[-_]+/g, ' ').replace(/^./, (c) => c.toUpperCase());

// ── The kit's documented defaults (Vantage's, scripts/demo-kit/configs/vantage/reflex.json and learn.json) ──

/** The engine's compiled action weights, plus the shopper actions a demo's page sends as custom events. */
export const DEFAULT_WEIGHTS = Object.freeze({
  product_view: 1, pdp_view: 1, view_product: 1, wishlist: 2, wishlist_add: 2, add_to_wishlist: 2, save_for_later: 2,
  add_to_cart: 3, cart_add: 3, purchase: 5, checkout: 5, order_complete: 5, content_impression: 0, content_dwell: 0.5,
  content_click: 1, video_complete: 2, tick: 0, page_view: 1, search: 1.5, select: 2, filter: 2, compare: 2, start_order: 3,
});
export const DEFAULT_REGISTRY = Object.freeze({
  tauMs: 14 * DAY, K: 1.8, thetaIn: 0.6, thetaOut: 0.45, epsilon: 0.01, maxValuesPerDim: 64, eventAttributes: 'event-when-unknown',
  journey: { stages: [{ stage: 'thinking', anyOf: { product_views: 6 } }, { stage: 'deciding', anyOf: { cart_adds: 1, purchases: 1 } }] },
});
export const DEFAULT_LEARN = Object.freeze({
  policy: { scope: 'session', match: 'direct', credit: 'last', windowsMs: { click: 1800000, dwell: 1800000, video_complete: 1800000, wishlist: 21600000, add_to_bag: 21600000, purchase: 604800000, custom: 1800000 } },
  stats: { n0: 30, tauLearnMs: 1814400000, liftMin: 0.5, liftMax: 2, nMin: 30 },
});
const PIECE_TYPES = { hero: 'hero', continue: 'hero', deals: 'promotion', 'grid-promo': 'promotion', 'pdp-offers': 'promotion', 'pdp-modules': 'module', 'category-rail': 'tile' };
const pieceTypeOf = (s) => s.pieceType || PIECE_TYPES[s.slot] || 'piece';
/** "60 s", "10 min", "60 days": how the machine panel names a memory. */
export function roomWords(ms) {
  if (ms % DAY === 0) return `${ms / DAY} day${ms === DAY ? '' : 's'}`;
  if (ms % (60 * MINUTE) === 0) return `${ms / (60 * MINUTE)} h`;
  if (ms % MINUTE === 0) return `${ms / MINUTE} min`;
  return `${Math.round(ms / 1000)} s`;
}

// ── Templates ───────────────────────────────────────────────────────────────

/**
 * A template filled: every @@NAME@@ replaced by vars[NAME]. A name the vars do not hold is an error, never an empty
 * string (the director's rule for its own templates). @@ never occurs in a page, a script or a stylesheet otherwise.
 */
export function fill(template, vars, where = 'template') {
  return String(template).replace(/@@([A-Z][A-Z0-9_]*)@@/g, (_, name) => {
    if (!Object.hasOwn(vars, name)) throw new Error(`${where}: @@${name}@@ has no value`);
    return String(vars[name]);
  });
}
const readTemplate = (name, dir = TEMPLATES) => readFileSync(join(dir, name), 'utf8');
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
/** A JSON value as a JS literal inside a template: escaped so it cannot close a script element. */
const jsLiteral = (v) => JSON.stringify(v, null, 2).replace(/</g, '\\u003c');

// ── The catalog ─────────────────────────────────────────────────────────────

/**
 * The demo's catalog pieces in the engine's shape, from public/<slug>/catalog.json when it exists: every piece with
 * an id and a customer content id (one derived from the other), live unless it says otherwise, and its window in ISO
 * instants (a window written as `windowDays: [from, to]` is placed around the anchor; a file that records its own
 * `anchor` has its windows moved to this one). Null when the file has no pieces list.
 */
export function catalogPieces(doc, anchorMs, { fields = null } = {}) {
  if (!isObject(doc) || !Array.isArray(doc.pieces) || !doc.pieces.length) return null;
  const moveBy = doc.anchor && Number.isFinite(Date.parse(doc.anchor)) ? anchorMs - Date.parse(doc.anchor) : 0;
  return doc.pieces.filter(isObject).map((p) => {
    const cid = p.customerContentId || String(p.id || '').replace(/_/g, '-');
    const id = p.id || cid.replace(/-/g, '_');
    const out = { id, customerContentId: cid, ...p, lifecycle: p.lifecycle || { status: 'live' } };
    out.id = id; out.customerContentId = cid;
    if (Array.isArray(p.windowDays)) { out.window = { from: iso(anchorMs + p.windowDays[0] * DAY), to: iso(anchorMs + p.windowDays[1] * DAY) }; delete out.windowDays; }
    else if (out.window && moveBy) out.window = { from: iso(Date.parse(out.window.from) + moveBy), to: iso(Date.parse(out.window.to) + moveBy) };
    // The published document carries the engine's fields only: a page's own fields (display, provenance) stay in
    // catalog.json, which the page reads; the engine names any other key as unknown and refuses the write.
    if (fields) for (const k of Object.keys(out)) if (!fields.has(k)) delete out[k];
    return out;
  });
}

/** The engine's piece fields, read from src/content/kinds.ts (PIECE_FIELDS), so the cut never drifts from the engine. */
export function enginePieceFields(root = REPO_ROOT) {
  const file = resolve(root, 'src', 'content', 'kinds.ts');
  const m = existsSync(file) ? /export const PIECE_FIELDS[^=]*=\s*new Set\(\[([\s\S]*?)\]\)/.exec(readFileSync(file, 'utf8')) : null;
  const names = m ? [...m[1].matchAll(/'([A-Za-z]+)'/g)].map((x) => x[1]) : [];
  return names.length ? new Set(names) : null;
}

/**
 * A slot's declared gate (demo.config.json `gate`: ctx name → the values that admit) on every piece of that slot
 * that carries no eligibility rule of its own, so the slot fails closed until the page asserts it (OH's continue
 * hero: a stranger is never told to pick up where she left off). Returns the content ids it gated.
 */
export function applyGates(demo, pieces) {
  const gated = [];
  for (const s of demoSlots(demo)) {
    if (!isObject(s.gate)) continue;
    for (const p of pieces) if (arr(p.slotTypes).includes(s.slot) && !p.eligibleWhen) { p.eligibleWhen = { context: structuredClone(s.gate) }; gated.push(p.customerContentId); }
  }
  return gated;
}

/**
 * A starter catalog, when the demo has none yet: for every snapshot slot, a few pieces of its type, labelled as the
 * scaffold's, so the first paint has something decided to show. Every value of every dimension is named by at least
 * one piece (a value no piece names builds no taste, and the seed refuses it), each arrival seed's tags are carried
 * by the first piece of its slot, and a slot with a `gate` fails closed until the page asserts it.
 */
export function starterCatalog(demo, anchorMs) {
  const dims = demo.dimensions;
  const missing = dims.filter((d) => !Array.isArray(d.values) || !d.values.length).map((d) => d.key);
  if (missing.length) throw new Error(`the starter catalog needs every dimension's values (dimensions[].values), or a catalog.json: ${missing.join(', ')} ${missing.length === 1 ? 'has' : 'have'} none`);
  const cursor = Object.fromEntries(dims.map((d) => [d.key, 0]));
  const next = (key) => { const d = dims.find((x) => x.key === key); const v = d.values[cursor[key] % d.values.length]; cursor[key] += 1; return v; };
  const pieces = [];
  for (const s of demoSlots(demo)) {
    const count = s.take === 1 ? 2 : s.take + 2;
    for (let n = 1; n <= count; n += 1) {
      const tags = {};
      for (const key of Object.keys(s.weights)) if (dims.some((d) => d.key === key)) tags[key] = [next(key)];
      if (n === 1) for (const r of arr(demo.seeds)) if (arr(r.slots).includes(s.slot)) for (const t of r.tags) tags[t.dimension] = [t.value];
      const named = Object.entries(tags).slice(0, 2).map(([, v]) => v[0]).join(' · ');
      const cid = `${s.slot}-${n}`;
      pieces.push({
        id: cid.replace(/-/g, '_'), customerContentId: cid, type: pieceTypeOf(s),
        title: `${titleCase(s.slot)} ${n}${named ? `: ${named}` : ''}`,
        subtitle: 'A starter piece from the scaffold; the demo\u2019s own catalog replaces it.',
        tags, slotTypes: [s.slot], lifecycle: { status: 'live' },
        window: { from: iso(anchorMs - 7 * DAY), to: iso(anchorMs + 60 * DAY) }, inStock: true,
        ...(s.gate ? { eligibleWhen: { context: structuredClone(s.gate) } } : {}),
      });
    }
  }
  // Coverage: a value no piece names yet joins the pieces round-robin, so every value builds taste.
  let i = 0;
  for (const d of dims) for (const v of d.values) {
    if (pieces.some((p) => arr(p.tags[d.key]).includes(v))) continue;
    const p = pieces[i % pieces.length]; i += 1;
    p.tags[d.key] = [...arr(p.tags[d.key]), v];
  }
  return { about: 'A STARTER catalog written by scripts/demo-kit/new-demo.mjs because the demo had none: placeholder pieces, one set per decided slot, tagged so every dimension value is named once. The demo\u2019s own catalog replaces this file; then rebuild the opening documents (node scripts/demo-kit/new-demo.mjs --config <demo.config.json> --rebuild-beats).', starter: true, anchor: iso(anchorMs), pieces };
}

/**
 * The seed's vocabulary: for every registry dimension, the values the pieces name, in the order the config lists
 * them, then any the config does not list. Warnings name a config value no piece names (it is left out: an event
 * carrying it would build no taste, and the seed would refuse it) and a dimension no piece names at all (the seed
 * refuses that; the catalog must name it).
 */
export function derivedVocabulary(demo, pieces) {
  const vocabulary = {}, warnings = [];
  for (const d of demo.dimensions) {
    const named = new Set(pieces.flatMap((p) => arr(p.tags?.[d.key])));
    const listed = arr(d.values);
    // The config's values first, in its order, then what else the catalog names: an event carrying a value no piece
    // names builds no taste, so the vocabulary is exactly what the pieces name.
    const values = [...listed.filter((v) => named.has(v)), ...[...named].filter((v) => !listed.includes(v))];
    if (!values.length) warnings.push(`no catalog piece names any ${d.key}: the seed refuses a registry dimension no piece names`);
    vocabulary[d.key] = values;
  }
  const known = new Set([...demo.dimensions.map((d) => d.key), ...arr(demo.seedOnlyDimensions)]);
  const foreign = [...new Set(pieces.flatMap((p) => Object.keys(p.tags || {})).filter((k) => !known.has(k)))];
  if (foreign.length) warnings.push(`catalog pieces tag ${foreign.join(', ')}, which is neither a registry nor a seed-only dimension: the seed refuses that`);
  return { vocabulary, warnings };
}

// ── The four documents ──────────────────────────────────────────────────────

export function reflexDocument(demo) {
  return {
    version: `reflex-${demo.slug}`,
    dimensions: demo.dimensions.map((d) => ({ key: d.key, source: d.source || d.key, ...(d.multi ? { multi: true } : {}), ...(d.tau !== undefined ? { tauMs: durationMs(d.tau) } : {}) })),
    weights: { ...DEFAULT_WEIGHTS, ...(isObject(demo.actions) ? demo.actions : {}) },
    ...structuredClone(DEFAULT_REGISTRY),
  };
}

export function learnDocument(demo) {
  return {
    version: `learn-${demo.slug}`,
    holdout: { share: 0, salt: demo.slug, arms: ['default'] },
    regional: { enabled: true, kBlend: 0.5, minEvents: 30, dimensions: [...demo.regional.dimensions] },
    ...structuredClone(DEFAULT_LEARN),
    slots: Object.fromEntries(demoSlots(demo).map((s) => [s.slot, { reward: 'click', objective: 'unit', gamma: 0, exploration: { mode: 'off', share: 0, floor: 0 } }])),
  };
}

/** The opening slots: per engine page, its slots in page order, with their arrival seeds. */
export function slotsDocument(demo) {
  const pages = {};
  for (const s of demoSlots(demo)) {
    const seeds = arr(demo.seeds).filter((r) => arr(r.slots).includes(s.slot)).map(({ signal, value, tags, weight, dampen }) => ({ signal, value, tags, weight, ...(dampen ? { dampen } : {}) }));
    (pages[s.engine] ??= []).push({
      slot: s.slot, take: s.take, weights: { ...s.weights },
      ...(s.diversity ? { diversity: { ...s.diversity } } : {}),
      ...(s.stage ? { stage: { ...s.stage } } : {}),
      ...(s.merchandising ? { merchandising: { ...s.merchandising } } : {}),
      ...(s.complements ? { complements: { ...s.complements } } : {}),
      ...(seeds.length ? { seeds } : {}),
    });
  }
  return { version: `slots-${demo.slug}`, pages };
}

// ── The beats ───────────────────────────────────────────────────────────────

/** The numbered beat document's name: 01-arrive. */
export const beatFile = (i, key) => `${String(i + 1).padStart(2, '0')}-${key}`;
const roleOf = (key) => key.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());

/** The acts as the seed's envelope reads them: [{ n, through, name }], in beat order. Throws when an act comes back. */
export function actsOf(demo) {
  const out = [];
  demo.beats.list.forEach((b, i) => {
    const n = Number(b.act);
    const last = out[out.length - 1];
    if (last && last.n === n) { last.through = i + 1; return; }
    if (out.some((a) => a.n === n)) throw new Error(`beats.list[${i}]: act ${n} comes back after another act; a demo's acts run in order`);
    out.push({ n, through: i + 1, name: demo.beats.acts[String(n)] });
  });
  return out;
}

/** One piece by a selector: { slotType?, type?, hasTag?, pick: first | last | <content id> }. */
export function selectPiece(pieces, sel = {}, fallbackSlot = null) {
  const slotType = sel.slotType ?? fallbackSlot;
  const fits = pieces.filter((p) => (!slotType || arr(p.slotTypes).includes(slotType)) && (!sel.type || p.type === sel.type)
    && (!sel.hasTag || arr(p.tags?.[sel.hasTag]).length > 0));
  if (sel.pick && sel.pick !== 'first' && sel.pick !== 'last') return fits.find((p) => p.customerContentId === sel.pick) ?? pieces.find((p) => p.customerContentId === sel.pick) ?? null;
  return (sel.pick === 'last' ? fits[fits.length - 1] : fits[0]) ?? null;
}

/**
 * The beat documents: the opening catalog and slots, then one per beat in order. A context beat records what it
 * presses, what moves and what the room sees; a publish beat carries the whole document it publishes, cut from the
 * one before it of its kind by the beat's changes (time passing as every window moving back, a window closing a
 * minute before the anchor, a piece out of stock, a pin), so beats publish in order onto each other and the reset
 * restores the opening pair. Returns { envelopes (in file order), ids (what each change recorded `as`), publishable,
 * roles, warnings }.
 */
export function beatDocuments(demo, { pieces, anchorMs }) {
  const warnings = [];
  const acts = actsOf(demo);
  const actOf = actOfFrom(acts);
  const ids = {};
  let catalog = { version: `catalog-${demo.slug}`, pieces: structuredClone(pieces) };
  let slots = slotsDocument(demo);
  const envelopes = {
    'open-catalog': envelope('open-catalog', { kind: 'catalog', document: structuredClone(catalog), press: 'Reset: the opening catalog' }, actOf),
    'open-slots': envelope('open-slots', { kind: 'slots', document: structuredClone(slots), press: 'Reset: the opening slots' }, actOf),
  };
  const publishable = { 'open-catalog': 'catalog', 'open-slots': 'slots' };
  const roles = { open: { slots: 'open-slots', catalog: 'open-catalog' } };
  demo.beats.list.forEach((b, i) => {
    const name = beatFile(i, b.key);
    const base = { beat: i + 1, press: b.press, label: b.label, who: b.who, ...(b.lane ? { lane: b.lane } : {}), ...(b.moves ? { engine: b.moves } : {}), ...(b.sees ? { sees: b.sees } : {}) };
    if (b.kind === 'context') { envelopes[name] = envelope(name, base, actOf); return; }
    if (b.kind === 'catalog') {
      let next = structuredClone(catalog.pieces);
      for (const c of b.change) {
        if (c.shiftDays) { next = shifted(next, c.shiftDays * DAY); continue; }
        const verb = c.close ? 'close' : 'outOfStock';
        const p = selectPiece(next, c[verb]);
        if (!p) { warnings.push(`beat ${b.no} (${b.key}): no piece matches its ${verb} selector ${JSON.stringify(c[verb])}; the change is left out`); continue; }
        if (verb === 'close') p.window = { from: p.window?.from ?? iso(anchorMs - 30 * DAY), to: iso(anchorMs - MINUTE) };
        else p.inStock = false;
        if (c.as) ids[c.as] = p.customerContentId;
      }
      catalog = { version: `catalog-${demo.slug}-${b.key}`, pieces: next };
      envelopes[name] = envelope(name, { ...base, kind: 'catalog', document: structuredClone(catalog) }, actOf);
    } else {
      const next = structuredClone(slots);
      for (const c of b.change) {
        const strategy = Object.values(next.pages).flat().find((s) => s.slot === c.pin.slot);
        const p = selectPiece(catalog.pieces, c.pin.piece, c.pin.slot);
        if (!strategy || !p) { warnings.push(`beat ${b.no} (${b.key}): its pin names ${c.pin.slot} and ${JSON.stringify(c.pin.piece)}, which match nothing; the pin is left out`); continue; }
        strategy.pinnedPieceIds = [...arr(strategy.pinnedPieceIds), p.id];
        if (c.as) ids[c.as] = p.customerContentId;
      }
      slots = { ...next, version: `slots-${demo.slug}-${b.key}` };
      envelopes[name] = envelope(name, { ...base, kind: 'slots', document: structuredClone(slots) }, actOf);
    }
    publishable[name] = b.kind;
    roles[roleOf(b.key)] = { [b.kind]: name };
  });
  return { envelopes, ids, publishable, roles, acts, warnings };
}

/** The director's script (public/<slug>/beats.json): each beat as data on the kit's verbs (public/demo-kit/director.js). */
export function directorScript(demo) {
  const unbuilt = (b) => [{ call: 'notBuilt', lane: b.lane || 'a page lane', what: b.press }];
  return {
    about: `${demo.name}'s director script: the ${demo.beats.list.length} beats as data the demo kit's director runs (public/demo-kit/director.js), scaffolded by scripts/demo-kit/new-demo.mjs from demo.config.json. Not a published beat document: those are beats/*.json, which scripts/demo-kit/seed.mjs re-anchors and the worker applies by name. Strings are templates over the facts ${demo.slug}.js computes (facts()); run lists are the kit's verbs; call is the one escape hatch into ${demo.slug}.js. A beat whose run is notBuilt says so on the status line and stops: its presses are its lane's to write.`,
    total: demo.beats.list.length,
    acts: { ...demo.beats.acts },
    places: {},
    beats: demo.beats.list.map((b) => ({
      key: b.key, no: String(b.no), act: Number(b.act), who: b.who, ...(b.arrives ? { arrives: true } : {}),
      label: b.label, declare: [...b.declare], ...(b.acts ? { acts: b.acts } : {}), will: [...b.will], line: b.line,
      run: Array.isArray(b.run) && b.run.length ? b.run : unbuilt(b),
    })),
  };
}

/**
 * The anchor file: the instant every window is written against, and the page's own copies of what the seed
 * publishes (the registry with its vocabulary and memory labels, the learn summary, the reset and the closed list by
 * role), which the seed holds to the published documents on every run (lib/seed.mjs anchorCopyProblems).
 */
export function anchorDocument(demo, { anchorMs, reflex, learn, vocabulary, ids, roles, envelopes, acts }) {
  const landing = new URLSearchParams(Object.entries(demo.arrival).filter(([k, v]) => /^utm_/.test(k) && v));
  const entry = { ...(demo.arrival.utm_source ? { utmSource: demo.arrival.utm_source } : {}), ...(demo.arrival.utm_medium ? { utmMedium: demo.arrival.utm_medium } : {}), utmTerm: demo.arrival.utm_term };
  const memory = reflex.dimensions.map((d) => {
    const tauMs = d.tauMs ?? reflex.tauMs;
    const compressed = tauMs < DAY;
    return { key: d.key, tauMs, room: roomWords(tauMs), compressed, ...(compressed ? { label: 'memory compressed for this room; production runs days' } : {}) };
  });
  return {
    anchor: iso(anchorMs),
    tenant: demo.tenant, scope: demo.tenant,
    brand: { name: demo.name, wordmark: demo.brand.wordmark, ...(demo.brand.tagline ? { tagline: demo.brand.tagline } : {}) },
    pages: Object.fromEntries(demo.pages.map((p) => [p.key, p.page])),
    pageSlots: Object.fromEntries(Object.entries(slotsDocument(demo).pages).map(([page, list]) => [page, list.map((s) => s.slot)])),
    decidedBy: Object.fromEntries([
      ...demoSlots(demo).map((s) => [s.slot, 'snapshot']),
      ...demo.pages.flatMap((p) => arr(p.sorted).map((s) => [s.slot, `POST /sort (${demo.products.file.replace(`public/${demo.slug}/`, '')})`])),
    ]),
    ids,
    arrival: { ...demo.arrival },
    landing: { url: `/${demo.slug}/?${landing}`, entry, campaignTerm: demo.arrival.utm_term },
    regions: { contrast: arr(demo.region.contrast) },
    ctx: { intent: { values: [...demo.asserted.intents], default: null }, region: 'US-XX, asserted by the page for rehearsal and labelled', names: arr(demo.asserted.context) },
    registry: { ...reflex, vocabulary, memory: { label: 'memory compressed for this room; production runs days', dimensions: memory } },
    learn: { holdout: learn.holdout, regional: learn.regional, gamma: 0, exploration: 'off' },
    events: { endpoint: 'POST /realtime/action', source: `${demo.slug}-demo`, body: '{ userId, sessionId, source, type, data }', customActions: ['select', 'filter', 'compare', 'search', 'start_order'] },
    routes: { beat: `POST /${demo.slug}/api/beat { kind, name, note? }`, reset: `POST /${demo.slug}/api/reset`, receipt: `POST /${demo.slug}/api/receipt { decisionIds, context? }`, report: `POST /${demo.slug}/api/report { date, slot, build? }`, coldstart: `GET /${demo.slug}/api/coldstart`, headers: `Every call sends X-Tenant: ${demo.tenant}` },
    beats: roles,
    beatIndex: Object.values(envelopes).filter((e) => e.beat > 0).map((e) => ({ beat: e.beat, act: e.act, actName: e.actName, name: e.name, kind: e.kind, press: e.press })),
    acts,
    reset: ['open-slots', 'open-catalog'],
  };
}

// ── The page's own settings, which <slug>.js reads ─────────────────────────

export function siteSettings(demo, { ids, roles }) {
  const p = (entry) => demo.pages.find((x) => x.entry === entry) || null;
  const intents = demo.asserted.intents.map((v) => [v, titleCase(v)]);
  return {
    slug: demo.slug, name: demo.name, tenant: demo.tenant, base: `/${demo.slug}/`, source: `${demo.slug}-demo`,
    api: Object.fromEntries(['beat', 'reset', 'receipt', 'report', 'coldstart'].map((k) => [k, `/${demo.slug}/api/${k}`])),
    brand: { ...demo.brand },
    pages: demo.pages.map((x) => ({ key: x.key, page: x.page, entry: x.entry, url: x.url, slotsOf: x.slotsOf ?? null,
      slots: arr(x.slots).map((s) => ({ slot: s.slot, take: s.take, label: s.label || titleCase(s.slot), gated: Boolean(s.gate) })),
      sorted: arr(x.sorted).map((s) => ({ slot: s.slot, take: s.take ?? 8, label: s.label || titleCase(s.slot), category: s.category ?? null })) })),
    entries: Object.fromEntries(['home', 'grid', 'product', 'phone'].map((e) => [e, p(e) ? p(e).key : null])),
    dimLabels: Object.fromEntries(demo.dimensions.map((d) => [d.key, d.label || titleCase(d.key).toLowerCase()])),
    intents,
    products: { file: `/${demo.products.file.replace(/^public\//, '')}`, list: demo.products.list ?? 'products', id: demo.products.id, attributes: { ...demo.products.attributes },
      name: demo.products.nameField ?? 'name', category: demo.products.categoryField ?? 'category', image: demo.products.imageField ?? 'image',
      overlay: demo.products.overlay ? { file: `/${demo.products.overlay.file.replace(/^public\//, '')}`, by: demo.products.overlay.by ?? demo.products.id } : null,
      // What a product page asserts about its product, as ctx.<name> = the row's field (OH: anchor = the sku, family = its family).
      pageContext: { ...(demo.products.pageContext ?? {}) }, family: demo.products.familyField ?? null, modelFamily: demo.products.modelFamilyField ?? null },
    reportSlots: [...demo.reportSlots],
    regionDims: [...demo.region.dimensions],
    contrast: arr(demo.region.contrast),
    copy: { ...demo.copy },
    beatNames: Object.fromEntries(Object.entries(roles).filter(([k]) => k !== 'open').map(([k, v]) => [k, Object.values(v)[0]])),
    ids,
    signIn: demo.flags?.signIn ? { accounts: demo.flags.signIn.accounts.map((a) => a.name) } : null,
    clockJump: demo.flags?.clockJump ?? null,
    roadmap: arr(demo.roadmap),
  };
}

// ── The page's markup ───────────────────────────────────────────────────────

/** A decided slot's module: the region the vertical's renderer fills, in the order the engine returned. */
function slotModule(s) {
  return `      <!-- Slot ${s.slot}, take ${s.take}: the page renders what comes back, in the order it comes back. -->
      <section class="module decided" id="mod-${s.slot}" data-slot="${s.slot}"${s.gate ? ' data-gated="true" hidden' : ''} aria-labelledby="head-${s.slot}">
        <header class="module-head"><div>
          <p class="module-where">slot <b>${esc(s.slot)}</b> &middot; take ${s.take} &middot; decided per visitor</p>
          <h2 id="head-${s.slot}">${esc(s.label || titleCase(s.slot))}</h2>
        </div></header>
        <div class="cards cards--${s.take === 1 ? 'one' : 'many'}" id="slot-${s.slot}" aria-live="polite"><p class="slot-wait">Not asked yet.</p></div>
        <p class="engine-down" id="down-${s.slot}" hidden></p>
      </section>`;
}
function railModule(s) {
  return `      <!-- Rail ${s.slot}: POST /sort over the products file; at an affinity weight of zero the site's own order. -->
      <section class="module" id="mod-${s.slot}" data-rail="${s.slot}" aria-labelledby="head-${s.slot}">
        <header class="module-head"><div>
          <p class="module-where">rail <b>${esc(s.slot)}</b> &middot; <code>POST /sort</code> over the products</p>
          <h2 id="head-${s.slot}">${esc(s.label || titleCase(s.slot))}</h2>
        </div><span class="rail-chip" id="chip-${s.slot}">the site&rsquo;s own order</span></header>
        <div class="rail" id="rail-${s.slot}"></div>
      </section>`;
}
const offLimits = (items) => (items.length ? `      <p class="offlimits-note"><b>Off limits</b> ${items.map(esc).join(' &middot; ')}: never decided, never personalised</p>\n` : '');

/** The site's views: one per page of the config that has its own slots, in the shell every entry shares. */
export function siteViews(demo) {
  const views = [];
  for (const p of demo.pages) {
    if (p.slotsOf) continue;
    const id = `view-${p.key}`;
    const parts = [];
    if (p.entry === 'product') {
      parts.push(`      <nav class="crumbs" id="crumbs-${p.key}"></nav>
      <!-- THE BUY BOX. Off limits: never decided, never personalised. -->
      <section class="buybox" id="buyBox" aria-label="Buy box">
        <p class="offlimits"><b>Off limits</b> the buy box is never decided and never personalised</p>
        <div class="bb-grid"><div class="bb-image" id="bbImage"></div><div class="bb-config">
          <h1 class="bb-title" id="bbTitle">Product</h1><p class="bb-meta" id="bbMeta"></p><div class="bb-price" id="bbPrice"></div>
          <div class="bb-actions"><button type="button" class="btn btn--brand" id="bbAdd" data-act="add-to-cart" data-ctl="add-to-cart">Add to Cart</button></div>
        </div></div>
      </section>`);
    } else if (p.entry === 'grid') {
      parts.push(`      <nav class="crumbs"><a data-nav="home" data-ctl="crumb-home">Home</a><span>/</span><span>${esc(p.label || titleCase(p.key))}</span></nav>
      <header class="view-head"><h1 class="view-title">${esc(p.label || titleCase(p.key))}</h1><span class="nper">filters and sort: not personalised</span></header>`);
    }
    for (const s of arr(p.slots)) parts.push(slotModule(s));
    for (const s of arr(p.sorted)) parts.push(railModule(s));
    views.push(`    <section class="view view--${p.entry}" id="${id}" data-page="${p.key}"${p.entry === 'home' ? '' : ' hidden'}>
${offLimits(arr(p.offLimits))}${parts.join('\n')}
    </section>`);
  }
  return views.join('\n\n');
}

/** The primary navigation: home, and every page that is not the phone's or the product's. */
function navLinks(demo) {
  return demo.pages.filter((p) => !p.slotsOf && p.entry === 'grid').map((p) => `<button type="button" data-nav="${p.key}" data-ctl="nav-${p.key}">${esc(p.label || titleCase(p.key))}</button>`).join('\n          ');
}

function googleFonts(fonts = {}) {
  const fam = (name, weights) => `family=${encodeURIComponent(name).replace(/%20/g, '+')}:wght@${weights}`;
  const list = [fonts.font && fam(fonts.font, '400;500;600;700;800'), fonts.mono && fam(fonts.mono, '400;500;600')].filter(Boolean);
  return list.length ? `<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?${list.join('&')}&display=swap" />` : '';
}

/** The token overrides: the palette as the kit's tokens, with the brand's tints derived where the palette leaves them. */
export function tokenOverrides(demo) {
  const pal = { ...demo.palette };
  const rgb = (hex) => { const h = hex.replace('#', ''); const f = h.length === 3 ? h.split('').map((c) => c + c).join('') : h; return [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16)); };
  if (/^#/.test(pal.brand)) {
    const [r, g, b] = rgb(pal.brand);
    pal['brand-glow'] ??= `rgba(${r},${g},${b},.7)`;
    pal['brand-glow-2'] ??= `rgba(${r},${g},${b},.45)`;
    pal['brand-glow-0'] ??= `rgba(${r},${g},${b},0)`;
    pal['brand-wash'] ??= `#${[r, g, b].map((c) => Math.round(c + (255 - c) * 0.93).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
  }
  const lines = Object.entries(pal).map(([k, v]) => `  --${k}: ${v};`);
  if (demo.fonts?.font) lines.push(`  --font: "${demo.fonts.font}", "Segoe UI", system-ui, -apple-system, sans-serif;`);
  if (demo.fonts?.mono) lines.push(`  --mono: "${demo.fonts.mono}", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;`);
  return lines.join('\n');
}

// ── The kit config and the server's constants ──────────────────────────────

export function kitConfig(demo, { vocabulary, envelopes, publishable }) {
  const ops = operatorsOf(demo.slug);
  const dir = `scripts/demo-kit/configs/${demo.slug}`;
  const seedOnly = arr(demo.seedOnlyDimensions);
  const { file, list, id, eventId, attributes, variants, overlay } = demo.products;
  return {
    about: `The demo kit's config for ${demo.name}${demo.customer ? `, the ${demo.customer} demo` : ''}: written by scripts/demo-kit/new-demo.mjs from public/${demo.slug}/demo.config.json (the file a solutions engineer edits first). The beat documents under public/${demo.slug}/beats/ are the edited data: every seed re-anchors their windows to now, checks them (and their product facts against ${file}), writes them back for the worker's ASSETS binding and publishes the opening ones. The registry and the learn document are ${dir}/reflex.json and learn.json, published as they are; the regional seed and the imagery are ${dir}/region.json and imagery.json, each its own lane's file. Paths are relative to the repository root. A config never carries a credential: the seed's token comes from --token or from local minting.`,
    name: demo.name, slug: demo.slug, tenant: demo.tenant, publicDir: `public/${demo.slug}`,
    worker: { name: demo.worker.name, queue: demo.worker.queue, devPort: demo.worker.devPort, config: `wrangler.${demo.slug}.toml` },
    seed: {
      operator: ops.seed,
      documents: {
        reflex: { file: `${dir}/reflex.json`, about: `the registry, published as it is: ${demo.dimensions.length} dimensions with their memory from demo.config.json, the kit's action weights` },
        catalog: { beat: 'open-catalog' },
        slots: { beat: 'open-slots' },
        learn: { file: `${dir}/learn.json`, about: `holdout 0 on stage, γ 0 and exploration off on every slot, the regional prior on ${demo.regional.dimensions.join(', ')}` },
      },
      notes: {
        reflex: `${demo.name} registry, ${demo.dimensions.length} dimensions: memory compressed for this room where the design says so; production runs days`,
        catalog: `${demo.name} opening catalog; windows anchored {{anchor}}`,
        slots: `${demo.name} opening slots: ${demoSlots(demo).map((s) => `${s.slot} take ${s.take}`).join('; ')}`.slice(0, 500),
        learn: `holdout 0 on stage; γ 0; exploration off; the regional prior on ${demo.regional.dimensions.join(', ')}`,
      },
      beats: {
        dir: `public/${demo.slug}/beats`,
        anchor: { file: 'anchor.json', field: 'anchor' },
        count: demo.beats.list.length,
        files: Object.keys(envelopes),
        publishable,
        reset: ['open-slots', 'open-catalog'],
      },
      vocabulary,
      ...(seedOnly.length ? { seedOnlyDimensions: seedOnly } : {}),
      products: { file, list: list ?? 'products', id, eventId: eventId ?? 'productId', attributes, ...(variants ? { variants } : {}), ...(overlay ? { overlay } : {}) },
    },
    region: demo.region.config ?? `${dir}/region.json`,
    imagery: demo.imagery?.config ?? `${dir}/imagery.json`,
    check: {
      suites: [
        { name: 'request level', kind: 'page', script: `scripts/rehearse-${demo.slug}-page.mjs` },
        { name: 'DOM', kind: 'dom', script: `scripts/rehearse-${demo.slug}-dom.mjs` },
      ],
    },
  };
}

const tsString = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
const tsList = (list) => `[${list.map(tsString).join(', ')}]`;

export function serverVars(demo, { publishable, seedVocabulary = demo.region.vocabulary }) {
  const { constant: C, camel } = idents(demo.slug);
  const ops = operatorsOf(demo.slug);
  const beats = Object.entries(publishable).map(([n, k]) => `  ${tsString(n)}: ${tsString(k)},`).join('\n');
  const vocab = Object.entries(seedVocabulary).map(([d, v]) => `  ${d}: ${tsList(v)},`).join('\n');
  return {
    SLUG: demo.slug, NAME: demo.name, CONST: C, CAMEL: camel, TENANT: demo.tenant,
    DESIGN: demo.design ?? `docs/${demo.slug}`, CUSTOMER: demo.customer ? ` for ${demo.customer}` : '',
    BEATS: beats, REPORT_SLOTS: tsList(demo.reportSlots), OPERATOR: ops.routes,
    ASSERTED: tsList(demo.asserted.intents), SENTENCE: tsString(demo.copy.coldStartSentence), VOCABULARY: vocab,
    ACCOUNTS: tsList(arr(demo.flags?.signIn?.accounts).map((a) => a.name)),
    SCORED: tsString(demo.copy.scoredSentence),
    SEED_SCRIPT: tsString(`scripts/demo-kit/seed.mjs --config scripts/demo-kit/configs/${demo.slug}.json`),
    REGION_SCRIPT: tsString(`scripts/demo-kit/region-seed.mjs --config scripts/demo-kit/configs/${demo.slug}.json`),
  };
}

/** The lines the lead adds to src/index.ts: the import with the others, the two mounts after Vantage's. */
export function mountLines(demo) {
  const { camel } = idents(demo.slug);
  return {
    import: `import { ${camel}Routes, ${camel}ColdStartRoutes } from '@/routes/${demo.slug}'; // ${demo.name} demo: beats, receipts and the cold-start panel (docs/${demo.slug})`,
    mounts: [
      `app.route('/${demo.slug}/api', ${camel}Routes(async (request, env, ctx) => app.fetch(request, env, ctx)));`,
      `app.route('/${demo.slug}/api/coldstart', ${camel}ColdStartRoutes);`,
    ],
  };
}

// ── Collisions with what the repository already holds ──────────────────────

/**
 * Whether the slug, worker, queue, tenant, dev port or public directory belongs to another demo already: every
 * wrangler*.toml but this demo's own, every kit config but this demo's own. Returns the refusals, each naming the file.
 */
export function collisions(demo, { root = REPO_ROOT } = {}) {
  const out = [];
  const own = `wrangler.${demo.slug}.toml`;
  for (const f of readdirSync(root).filter((n) => /^wrangler(\..+)?\.toml$/i.test(n) && n.toLowerCase() !== own)) {
    const text = readFileSync(join(root, f), 'utf8');
    const name = (/^name\s*=\s*"([^"]+)"/m.exec(text) || [])[1];
    if (name === demo.worker.name) out.push(`${f} already names the worker ${name}`);
    for (const m of text.matchAll(/^\s*(?:queue|dead_letter_queue)\s*=\s*"([^"]+)"/gm)) if (m[1] === demo.worker.queue || m[1] === `${demo.worker.queue}-dlq`) out.push(`${f} already names the queue ${m[1]}`);
    const port = (/^\[dev\][^[]*?^port\s*=\s*(\d+)/ms.exec(text) || [])[1];
    if (port && Number(port) === demo.worker.devPort) out.push(`${f} already uses the dev port ${port}`);
  }
  const configs = join(root, 'scripts', 'demo-kit', 'configs');
  if (existsSync(configs)) for (const f of readdirSync(configs).filter((n) => n.endsWith('.json') && n !== `${demo.slug}.json`)) {
    let c; try { c = JSON.parse(readFileSync(join(configs, f), 'utf8')); } catch { continue; }
    const w = c.worker || {};
    if (c.slug === demo.slug) out.push(`scripts/demo-kit/configs/${f} already has the slug ${demo.slug}`);
    if (c.tenant === demo.tenant) out.push(`scripts/demo-kit/configs/${f} already has the tenant ${demo.tenant}`);
    if (w.name === demo.worker.name) out.push(`scripts/demo-kit/configs/${f} already names the worker ${w.name}`);
    if (w.queue === demo.worker.queue) out.push(`scripts/demo-kit/configs/${f} already names the queue ${w.queue}`);
    if (w.devPort === demo.worker.devPort) out.push(`scripts/demo-kit/configs/${f} already uses the dev port ${w.devPort}`);
  }
  return out;
}

// ── The plan ────────────────────────────────────────────────────────────────

const readJsonIf = (abs) => { try { return existsSync(abs) ? JSON.parse(readFileSync(abs, 'utf8')) : null; } catch { return null; } };

/**
 * Every file the demo needs, with its content, and what new-demo.mjs prints. `rebuildBeats` re-derives the beat
 * documents and the kit config from the catalog as it stands (the opening documents are cut from catalog.json),
 * and only those. Nothing is written here.
 */
export function planScaffold({ demo, root = REPO_ROOT, nowMs = Date.now(), templates = TEMPLATES }) {
  const slug = demo.slug;
  const pub = `public/${slug}`;
  const warnings = [], notes = [];
  const catalogFile = demo.catalog?.file ?? `${pub}/catalog.json`;
  const given = readJsonIf(resolve(root, catalogFile));
  // The anchor every window is written against: the catalog's own when it records one (its windows are the
  // source's instants, kept as they are), else the scaffold's moment, to the second. A seed re-anchors to now.
  const catalogAnchor = isObject(given) && Array.isArray(given.pieces) && given.pieces.length && Number.isFinite(Date.parse(given.anchor ?? '')) ? Date.parse(given.anchor) : null;
  const anchorMs = catalogAnchor ?? Math.floor(nowMs / 1000) * 1000;
  const fields = enginePieceFields(root);
  let pieces = catalogPieces(given, anchorMs, { fields });
  let starter = null;
  if (!pieces) {
    starter = starterCatalog(demo, anchorMs);
    pieces = catalogPieces(starter, anchorMs, { fields });
    notes.push(given ? `${catalogFile} has no pieces list the scaffold can read; the opening catalog is the starter set (and ${catalogFile} is left as it is)` : `${catalogFile} does not exist yet: a labelled starter catalog is written there`);
  } else {
    const dropped = [...new Set(given.pieces.flatMap((p) => Object.keys(p)).filter((k) => fields && !fields.has(k) && k !== 'windowDays'))];
    notes.push(`the opening catalog is cut from ${catalogFile} (${pieces.length} pieces${catalogAnchor ? `, its windows against its own anchor ${given.anchor}, which the anchor file carries` : ''})${dropped.length ? `, the engine's fields only (${dropped.join(', ')} stay in the file, for the page)` : ''}`);
  }
  const gated = applyGates(demo, pieces);
  if (gated.length) notes.push(`gated on the slot's own rule until the page asserts it: ${gated.join(', ')}`);
  const { vocabulary, warnings: vw } = derivedVocabulary(demo, pieces);
  warnings.push(...vw);
  const reflex = reflexDocument(demo);
  const learn = learnDocument(demo);
  const { envelopes, ids, publishable, roles, acts, warnings: bw } = beatDocuments(demo, { pieces, anchorMs });
  warnings.push(...bw);
  const anchorDoc = anchorDocument(demo, { anchorMs, reflex, learn, vocabulary, ids, roles, envelopes, acts });
  const site = siteSettings(demo, { ids, roles });
  const kit = kitConfig(demo, { vocabulary, envelopes, publishable });
  const { constant: C, camel, pascal } = idents(slug);
  const T = (name) => readTemplate(name, templates);
  const files = [];
  const add = (path, content, group) => files.push({ path, content, group });

  // The server. The seed door's closed vocabulary is the region section's when its lane has written it.
  const regionPath = demo.region.config ?? `scripts/demo-kit/configs/${slug}/region.json`;
  const regionFile = readJsonIf(resolve(root, regionPath));
  let seedVocabulary = demo.region.vocabulary;
  if (regionFile && isObject(regionFile.vocabulary)) {
    seedVocabulary = regionFile.vocabulary;
    if (JSON.stringify(regionFile.vocabulary) !== JSON.stringify(demo.region.vocabulary)) notes.push(`the seed door's vocabulary is ${regionPath}'s, which differs from demo.config.json's region.vocabulary (that should follow it)`);
  } else notes.push(`${regionPath} does not exist yet: the seed door's vocabulary is demo.config.json's region.vocabulary, which the region lane's file must equal`);
  const sv = serverVars(demo, { publishable, seedVocabulary });
  add(`src/demos/${slug}.config.ts`, fill(T('server.config.ts.tpl'), sv, 'server.config.ts.tpl'), 'server');
  add(`src/routes/${slug}.ts`, fill(T('server.routes.ts.tpl'), sv, 'server.routes.ts.tpl'), 'server');

  // The page.
  const shell = T('page.shell.html.tpl');
  const pageVars = (entry, title) => ({
    SLUG: slug, NAME: esc(demo.name), TITLE: esc(title), ENTRY: entry, FONTS: googleFonts(demo.fonts), WORDMARK: esc(demo.brand.wordmark),
    TAGLINE: esc(demo.brand.tagline ?? ''), NAV: navLinks(demo), VIEWS: siteViews(demo), LEGAL: esc(demo.brand.legal ?? `${demo.name} is a fictional brand built for a demonstration.`),
    FIRST_LINE: esc(`${demo.beats.list[0].label}. Press Next to begin.`), FIRST_LABEL: esc(`${demo.beats.list[0].no} · ${demo.beats.list[0].label}`),
    BODY_CLASS: entry === 'phone' ? 'shell--phone' : '',
  });
  add(`${pub}/index.html`, fill(shell, pageVars('home', demo.brand.title), 'page.shell.html.tpl'), 'page');
  add(`${pub}/product.html`, fill(shell, pageVars('product', demo.brand.title), 'page.shell.html.tpl'), 'page');
  add(`${pub}/m.html`, fill(shell, pageVars('phone', demo.brand.title), 'page.shell.html.tpl'), 'page');
  add(`${pub}/${slug}.css`, fill(T('page.css.tpl'), { SLUG: slug, NAME: demo.name, TOKENS: tokenOverrides(demo) }, 'page.css.tpl'), 'page');
  add(`${pub}/${slug}.js`, fill(T('page.js.tpl'), { SLUG: slug, NAME: demo.name, SITE: jsLiteral(site), DEBUG: `__${camel}` }, 'page.js.tpl'), 'page');

  // The beats.
  add(`${pub}/beats.json`, jsonText(directorScript(demo)), 'beats');
  for (const [name, e] of Object.entries(envelopes)) add(`${pub}/beats/${name}.json`, jsonText(e), 'beats');
  add(`${pub}/beats/anchor.json`, jsonText(anchorDoc), 'beats');

  // The data.
  if (starter) add(catalogFile, jsonText(starter), 'data');
  add(demo.products.file, jsonText({ about: `A PLACEHOLDER written by scripts/demo-kit/new-demo.mjs because the demo had no products file: the products the beats speak about go here, one row each, with the fields demo.config.json's products map names. The seed checks every beat document's product facts against this file.`, placeholder: true, [demo.products.list ?? 'products']: [] }), 'data');
  add(demo.imagery?.manifest ?? `${pub}/img/MANIFEST.json`, jsonText({ about: `The image manifest for ${demo.name}: every image the pages paint, with its provenance, the source hash and a by-eye verdict per file (docs/demos/BOOTSTRAP.md §6). Empty until the imagery lane fetches them (scripts/demo-kit/fetch-imagery.mjs).`, budgetMegabytes: 25, files: [] }), 'data');

  // The kit config and its documents, and the suites.
  add(`scripts/demo-kit/configs/${slug}.json`, `${JSON.stringify(kit, null, 2)}\n`, 'kit');
  add(`scripts/demo-kit/configs/${slug}/reflex.json`, `${JSON.stringify(reflex, null, 2)}\n`, 'kit');
  add(`scripts/demo-kit/configs/${slug}/learn.json`, `${JSON.stringify(learn, null, 2)}\n`, 'kit');
  const suiteVars = { SLUG: slug, NAME: demo.name, TENANT: demo.tenant, PORT: String(demo.worker.devPort), DEBUG: `__${camel}`, TOTAL: String(demo.beats.list.length),
    WORDMARK: demo.brand.wordmark.replace(/'/g, "\\'"), BRAND: demo.palette.brand, SENTENCE: demo.copy.coldStartSentence.replace(/'/g, "\\'") };
  add(`scripts/rehearse-${slug}-page.mjs`, fill(T('rehearse-page.mjs.tpl'), suiteVars, 'rehearse-page.mjs.tpl'), 'suites');
  add(`scripts/rehearse-${slug}-dom.mjs`, fill(T('rehearse-dom.mjs.tpl'), suiteVars, 'rehearse-dom.mjs.tpl'), 'suites');

  // The documents.
  const mounts = mountLines(demo);
  const beatsTable = demo.beats.list.map((b, i) => `| ${b.no} | ${demo.beats.acts[String(b.act)]} | ${b.press.replace(/\|/g, '\\|')} | ${(b.moves || b.will[0]).replace(/<[^>]+>/g, '').replace(/\|/g, '\\|')} | ${beatFile(i, b.key)} (${b.kind}) | ${b.lane || '—'} |`).join('\n');
  const docVars = {
    SLUG: slug, NAME: demo.name, CUSTOMER: demo.customer ?? '—', DESIGN: demo.design ?? '(none named)', TENANT: demo.tenant, WORKER: demo.worker.name, QUEUE: demo.worker.queue, PORT: String(demo.worker.devPort),
    DATE: iso(nowMs).slice(0, 10), BEATS_TABLE: beatsTable, SECRETS: WORKER_SECRETS.join(', '), OPERATORS: Object.values(operatorsOf(slug)).join(', '),
    MOUNT_IMPORT: mounts.import, MOUNT_1: mounts.mounts[0], MOUNT_2: mounts.mounts[1], CAMEL: camel, PASCAL: pascal, CONST: C,
    BEATS_COUNT: String(demo.beats.list.length), SLOTS: demoSlots(demo).map((s) => `\`${s.slot}\``).join(', '),
  };
  add(`docs/${slug}/${demo.name}-Demo-Design.md`, fill(T('doc.design.md.tpl'), docVars, 'doc.design.md.tpl'), 'docs');
  add(`docs/${slug}/${demo.name}-Presenter-Script.md`, fill(T('doc.presenter.md.tpl'), docVars, 'doc.presenter.md.tpl'), 'docs');
  add(`docs/${slug}/RESUME-${slug}.md`, fill(T('doc.resume.md.tpl'), docVars, 'doc.resume.md.tpl'), 'docs');

  return { files, notes, warnings, anchorMs, mounts, vocabulary, ids, publishable, kit, starter: Boolean(starter) };
}

/** Whether a planned file already exists, and so is left as it is (never overwritten by a scaffold). */
export const exists = (root, rel) => { const abs = resolve(root, rel); return existsSync(abs) && statSync(abs).isFile(); };
export const relPath = (root, abs) => relative(root, abs).split('\\').join('/');

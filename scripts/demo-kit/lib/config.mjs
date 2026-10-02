// scripts/demo-kit/lib/config.mjs — the demo kit's configs: load them, resolve their paths, validate them.
//
// Two files per demo. The DEMO config, public/<slug>/demo.config.json (docs/demo-kit/Demo-Kit-Design.md §2.4), is
// the one a solutions engineer edits first: validateDemoConfig checks it, and scripts/demo-kit/new-demo.mjs
// scaffolds the demo from it. The KIT config, scripts/demo-kit/configs/<slug>.json, is what the kit's command lines
// read (seed, region seed, imagery, check-demo, rehearse); new-demo.mjs derives it, and validateConfig checks it.
// Every path in either is relative to the repository root. A kit config's section may be written inline or as
// the path of a JSON file that holds it ("region": "…/region.json"), and a section the command does not need
// may not exist yet (another lane is writing it).
//
// The rules a config must keep, checked before any script reads a document or touches the network:
//   • names are slugs; the worker is never the shared one nor a customer stamp (staging, production), its
//     queue never theirs, and its wrangler config never wrangler.toml;
//   • every path stays inside the repository; the public directory is public/<slug>, and everything a
//     script WRITES (the beat documents, the imagery) stays inside it;
//   • the beat lists are closed and consistent (publishable ⊆ files, reset ⊆ publishable);
//   • vocabularies are exact and duplicate-free;
//   • NO CREDENTIAL: no key that names one (matched by pattern, isCredentialKey), no value shaped like a
//     token. Tokens come from --token or from local minting, never from a file.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tokenFindings } from './credentials.mjs';

/** The repository root: scripts/demo-kit/lib/ is three levels below it. */
export const REPO_ROOT = resolve(fileURLToPath(new URL('../../../', import.meta.url)));

export const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;
const NAME = /^[a-z0-9][a-z0-9-]{0,62}$/;
const DIM = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const REGION_KEY = /^US-[A-Z]{2}$/;
export const SECTIONS = ['seed', 'region', 'imagery', 'check'];

/**
 * The workers and queues a demo config may never name: the shared demo worker and its queues, and the
 * customer stamps wrangler.toml deploys as `--env staging` and `--env production` (DEPLOYMENT_PROFILE=customer,
 * never a demo target, AGENTS.md). Each maps to the sentence the refusal prints.
 */
const FORBIDDEN_WORKERS = Object.freeze({
  'edge-platform': 'edge-platform is the SHARED demo worker; a demo has its own',
  'edge-platform-staging': 'edge-platform-staging is the customer staging stamp, never a demo target; a demo has its own worker',
  'edge-platform-production': 'edge-platform-production is the customer production stamp, never a demo target; a demo has its own worker',
});
const FORBIDDEN_QUEUES = Object.freeze({
  events: 'must not be the shared worker\'s queue',
  'events-dead-letter': 'must not be the shared worker\'s queue',
  'events-staging': 'must not be the customer staging stamp\'s queue',
  'events-staging-dead-letter': 'must not be the customer staging stamp\'s queue',
  'events-production': 'must not be the customer production stamp\'s queue',
  'events-production-dead-letter': 'must not be the customer production stamp\'s queue',
});
/** The shared worker's config, which also holds the customer stamps' environments. */
const SHARED_WORKER_CONFIG = 'wrangler.toml';

/**
 * Whether a config key would hold a credential's value, by pattern rather than by an exact list (R2): any
 * key that contains token, secret, password (or passwd), jwt, bearer, authorization or credential, in any
 * case and in any spelling (apiToken, CLIENT_SECRET, dbPassword, x-jwt), and any key whose LAST word is
 * key or keys (apiKey, private_key, SIGNING-KEY, sdkKey). A bare `key` is a lookup key, not a credential
 * (imagery.placeholder.key, a source's chroma key, a dimension's key), and `keyTol` leads with it, so
 * neither is matched. Lists of secret NAMES (for a worker's setup) are fine, since only a string value
 * under such a key is refused.
 */
const CREDENTIAL_WORD = /token|secret|passw(?:or)?d|jwt|bearer|authorization|credential/i;
const wordsOf = (key) => String(key).split(/[^A-Za-z0-9]+|(?<=[a-z0-9])(?=[A-Z])/).filter(Boolean).map((w) => w.toLowerCase());
export function isCredentialKey(key) {
  if (CREDENTIAL_WORD.test(key)) return true;
  const words = wordsOf(key);
  if (words.length > 1 && /^keys?$/.test(words[words.length - 1])) return true;
  // Run-together spellings of the common compounds: apikey, privatekey, accesskey, signingkey, secretkey, sdkkey.
  return words.length === 1 && /^(?:api|private|access|signing|sdk|client|master|encryption|license)keys?$/.test(words[0]);
}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isString = (v, max = 2000) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
const isInt = (v, min, max) => Number.isSafeInteger(v) && v >= min && v <= max;

/** True when `abs` is `dir` itself or lies inside it. */
export function isInside(abs, dir) {
  const back = relative(dir, abs);
  return back === '' || (!back.startsWith('..') && !isAbsolute(back));
}

/** A repository-relative path, resolved; null when it is absolute or climbs out of `root`. */
export function resolveInside(root, rel) {
  if (typeof rel !== 'string' || !rel.trim() || isAbsolute(rel) || /^[A-Za-z]:/.test(rel)) return null;
  const abs = resolve(root, rel);
  return isInside(abs, root) ? abs : null;
}

const readJson = (abs) => JSON.parse(readFileSync(abs, 'utf8'));

/**
 * Read a config file and inline every section given as a path. Throws on unreadable JSON; returns the
 * config as written otherwise. Validation is separate (`validateConfig`), so a caller can report every
 * problem at once.
 *
 * `sections` names what the caller needs (lane K4): a section it needs must be a file, as before; a section it
 * does not need whose file does not exist YET is left as its path and listed in `pending`, so a new demo's seed
 * and check run while another lane is still writing its region or imagery section. A path outside the
 * repository is refused whichever section it is. Without `sections`, every section is needed.
 */
export function loadConfig(file, { root = REPO_ROOT, sections = SECTIONS } = {}) {
  const abs = isAbsolute(file) ? file : resolve(process.cwd(), file);
  if (!existsSync(abs)) throw new Error(`config ${file}: no such file`);
  const config = readJson(abs);
  if (!isObject(config)) throw new Error(`config ${file}: not a JSON object`);
  const sources = { config: abs };
  const pending = {};
  for (const section of SECTIONS) {
    if (typeof config[section] !== 'string') continue;
    const sectionFile = resolveInside(root, config[section]);
    if (sectionFile && !existsSync(sectionFile) && !sections.includes(section)) { pending[section] = config[section]; continue; }
    if (!sectionFile || !existsSync(sectionFile)) throw new Error(`config ${file}: section "${section}" names ${config[section]}, which is not a file inside the repository`);
    const value = readJson(sectionFile);
    if (!isObject(value)) throw new Error(`config ${file}: section "${section}" (${config[section]}) is not a JSON object`);
    config[section] = value;
    sources[section] = sectionFile;
  }
  return { config, root, file: abs, sources, pending };
}

// ── Validation ──────────────────────────────────────────────────────────────

function pathRule(errors, root, where, rel, { kind = 'any', mustExist = true, inside = null, ext = null } = {}) {
  const abs = resolveInside(root, rel);
  if (!abs) { errors.push(`${where}: "${rel}" must be a path relative to the repository root, inside it`); return null; }
  if (ext && !abs.toLowerCase().endsWith(ext)) errors.push(`${where}: "${rel}" must be a ${ext} file`);
  if (inside && !isInside(abs, inside.abs)) errors.push(`${where}: "${rel}" must lie inside ${inside.rel} (a script writes there)`);
  if (mustExist) {
    if (!existsSync(abs)) errors.push(`${where}: "${rel}" does not exist`);
    else if (kind === 'dir' && !statSync(abs).isDirectory()) errors.push(`${where}: "${rel}" is not a directory`);
    else if (kind === 'file' && !statSync(abs).isFile()) errors.push(`${where}: "${rel}" is not a file`);
  }
  return abs;
}

function vocabularyRule(errors, where, vocabulary) {
  if (!isObject(vocabulary) || !Object.keys(vocabulary).length) { errors.push(`${where}: an object of dimension → exact values`); return; }
  for (const [dim, values] of Object.entries(vocabulary)) {
    if (!DIM.test(dim)) errors.push(`${where}.${dim}: not a dimension name`);
    if (!Array.isArray(values) || !values.length || values.length > 1000) { errors.push(`${where}.${dim}: a list of 1..1000 values`); continue; }
    const seen = new Set();
    for (const v of values) {
      if (!isString(v, 64)) errors.push(`${where}.${dim}: "${v}" is not a value of 1..64 characters`);
      else if (seen.has(v)) errors.push(`${where}.${dim}: "${v}" is listed twice`);
      seen.add(v);
    }
  }
}

function noCredentials(errors, value, where = 'config') {
  if (Array.isArray(value)) { value.forEach((v, i) => noCredentials(errors, v, `${where}[${i}]`)); return; }
  if (isObject(value)) {
    for (const [k, v] of Object.entries(value)) {
      if (isCredentialKey(k) && typeof v === 'string' && v.trim()) errors.push(`${where}.${k}: a config never carries a credential (tokens come from --token or local minting)`);
      noCredentials(errors, v, `${where}.${k}`);
    }
    return;
  }
  if (typeof value === 'string') for (const what of tokenFindings(value)) errors.push(`${where}: carries ${what}; a config never carries a credential`);
}

function seedRules(errors, root, seed, publicDir) {
  if (!isObject(seed)) { errors.push('seed: required, an object'); return; }
  if (!isString(seed.operator, 63) || !NAME.test(seed.operator)) errors.push('seed.operator: the operator subject the seed mints as (TENANTS must grant it the tenant), e.g. seed-vantage');
  const beats = seed.beats;
  let files = [];
  if (!isObject(beats)) errors.push('seed.beats: required, an object');
  else {
    const dir = pathRule(errors, root, 'seed.beats.dir', beats.dir, { kind: 'dir', inside: publicDir });
    if (!isObject(beats.anchor) || !isString(beats.anchor.file, 120) || !/^[A-Za-z0-9._-]+\.json$/.test(beats.anchor.file) || !isString(beats.anchor.field, 64)) {
      errors.push('seed.beats.anchor: { file: "<name>.json" inside the beats directory, field: "<the anchor instant\'s key>" }');
    } else if (dir && !existsSync(resolve(dir, beats.anchor.file))) errors.push(`seed.beats.anchor.file: ${beats.dir}/${beats.anchor.file} does not exist`);
    if (!isInt(beats.count, 1, 100)) errors.push('seed.beats.count: the number of numbered beats, 1..100');
    if (!Array.isArray(beats.files) || !beats.files.length) errors.push('seed.beats.files: the closed list of beat document names (without .json)');
    else {
      const seen = new Set();
      for (const name of beats.files) {
        if (!isString(name, 63) || !NAME.test(name)) { errors.push(`seed.beats.files: "${name}" is not a document name`); continue; }
        if (seen.has(name)) errors.push(`seed.beats.files: "${name}" is listed twice`);
        seen.add(name);
        if (dir && !existsSync(resolve(dir, `${name}.json`))) errors.push(`seed.beats.files: ${beats.dir}/${name}.json does not exist`);
        if (beats.anchor && `${name}.json` === beats.anchor.file) errors.push(`seed.beats.files: "${name}" is the anchor file, not a beat`);
      }
      files = [...seen];
    }
    if (!isObject(beats.publishable) || !Object.keys(beats.publishable).length) errors.push('seed.beats.publishable: the route\'s closed list, name → document kind');
    else for (const [name, kind] of Object.entries(beats.publishable)) {
      if (!files.includes(name)) errors.push(`seed.beats.publishable: "${name}" is not in seed.beats.files`);
      if (!['catalog', 'slots', 'learn'].includes(kind)) errors.push(`seed.beats.publishable.${name}: kind must be catalog, slots or learn`);
    }
    if (!Array.isArray(beats.reset) || !beats.reset.length) errors.push('seed.beats.reset: the names the demo\'s reset publishes, in order');
    else for (const name of beats.reset) if (!isObject(beats.publishable) || !Object.hasOwn(beats.publishable, name)) errors.push(`seed.beats.reset: "${name}" is not publishable`);
  }
  const docs = seed.documents;
  if (!isObject(docs)) errors.push('seed.documents: required, { reflex, catalog, slots, learn }');
  else for (const member of ['reflex', 'catalog', 'slots', 'learn']) {
    const d = docs[member];
    if (isObject(d) && typeof d.file === 'string') pathRule(errors, root, `seed.documents.${member}.file`, d.file, { kind: 'file', ext: '.json' });
    else if (isObject(d) && typeof d.beat === 'string') {
      if (!files.includes(d.beat)) errors.push(`seed.documents.${member}.beat: "${d.beat}" is not in seed.beats.files`);
      else if (isObject(beats?.publishable) && beats.publishable[d.beat] && beats.publishable[d.beat] !== member) errors.push(`seed.documents.${member}.beat: "${d.beat}" publishes ${beats.publishable[d.beat]}, not ${member}`);
    } else errors.push(`seed.documents.${member}: { file: "<path>.json" } or { beat: "<beat document name>" }`);
  }
  if (seed.notes !== undefined) {
    if (!isObject(seed.notes)) errors.push('seed.notes: an object of member → publish note');
    else for (const [k, v] of Object.entries(seed.notes)) {
      if (!['reflex', 'catalog', 'slots', 'learn'].includes(k)) errors.push(`seed.notes.${k}: not a member`);
      if (!isString(v, 500)) errors.push(`seed.notes.${k}: a note of 1..500 characters`);
    }
  }
  vocabularyRule(errors, 'seed.vocabulary', seed.vocabulary);
  if (seed.products !== undefined) productsRule(errors, root, 'seed.products', seed.products, publicDir);
  if (seed.seedOnlyDimensions !== undefined) {
    if (!Array.isArray(seed.seedOnlyDimensions)) errors.push('seed.seedOnlyDimensions: a list of dimension names');
    else for (const d of seed.seedOnlyDimensions) {
      if (!isString(d, 64) || !DIM.test(d)) errors.push(`seed.seedOnlyDimensions: "${d}" is not a dimension name`);
      else if (isObject(seed.vocabulary) && Object.hasOwn(seed.vocabulary, d)) errors.push(`seed.seedOnlyDimensions: "${d}" is a registry dimension, not a seed-only one`);
    }
  }
}

function touchesRule(errors, where, touches, vocabulary) {
  if (!isObject(touches) || !Object.keys(touches).length) { errors.push(`${where}.touches: an object of dimension → value`); return; }
  for (const [dim, value] of Object.entries(touches)) {
    if (!isObject(vocabulary) || !Object.hasOwn(vocabulary, dim)) errors.push(`${where}.touches.${dim}: not a seeded dimension`);
    else if (!vocabulary[dim].includes(value)) errors.push(`${where}.touches.${dim}: "${value}" is not one of ${vocabulary[dim].join(', ')}`);
  }
}

function regionRules(errors, root, region) {
  if (!isObject(region)) { errors.push('region: required, an object (or the path of a JSON file holding it)'); return; }
  if (!isString(region.operator, 63) || !NAME.test(region.operator)) errors.push('region.operator: the operator subject the region seed mints as');
  for (const k of ['route', 'panel']) if (!isString(region[k], 200) || !region[k].startsWith('/')) errors.push(`region.${k}: a path on the worker, starting with /`);
  vocabularyRule(errors, 'region.vocabulary', region.vocabulary);
  pathRule(errors, root, 'region.census', region.census, { kind: 'file' });
  if (!isInt(region.expectRegions, 1, 1000)) errors.push('region.expectRegions: how many census regions the file must hold');
  const limits = region.limits;
  if (!isObject(limits) || !isInt(limits.rows, 1, 10000) || !isInt(limits.unitsPerRow, 1, 100000) || !isInt(limits.units, 1, 1000000)) errors.push('region.limits: { rows, unitsPerRow, units }, the seed route\'s own limits');
  if (!isObject(region.rehearsed) || !Object.keys(region.rehearsed).length) errors.push('region.rehearsed: the anchor regions, verbatim, keyed US-XX');
  else for (const [key, r] of Object.entries(region.rehearsed)) {
    if (!REGION_KEY.test(key)) errors.push(`region.rehearsed.${key}: a region key such as US-TX`);
    if (!isObject(r) || !isString(r.label, 80)) { errors.push(`region.rehearsed.${key}.label: 1..80 characters`); continue; }
    if (!Array.isArray(r.rows) || !r.rows.length) { errors.push(`region.rehearsed.${key}.rows: at least one row`); continue; }
    r.rows.forEach((row, i) => {
      touchesRule(errors, `region.rehearsed.${key}.rows[${i}]`, row?.touches, region.vocabulary);
      if (!isInt(row?.units, 1, limits?.unitsPerRow ?? 100000)) errors.push(`region.rehearsed.${key}.rows[${i}].units: a whole number within the per-row limit`);
    });
  }
  if (region.text !== undefined) {
    const t = region.text;
    if (!isObject(t)) errors.push('region.text: the words the dry run prints');
    else {
      for (const k of ['rehearsedNote', 'blendWord', 'extraWord']) if (t[k] !== undefined && !isString(t[k], 40)) errors.push(`region.text.${k}: 1..40 characters`);
      if (t.shareOrder !== undefined && !(Array.isArray(t.shareOrder) && t.shareOrder.every((d) => isObject(region.vocabulary) && Object.hasOwn(region.vocabulary, d)))) {
        errors.push('region.text.shareOrder: seeded dimensions, in the order the dry run prints them');
      }
    }
  }
  const m = region.model;
  if (!isObject(m)) { errors.push('region.model: required'); return; }
  if (m.kind !== 'income-tilt') errors.push('region.model.kind: "income-tilt" (the only model the kit has)');
  if (!(typeof m.spreadUsd === 'number' && m.spreadUsd > 0)) errors.push('region.model.spreadUsd: dollars of median income per unit of x, > 0');
  if (!(typeof m.tSpan === 'number' && m.tSpan > 0 && m.tSpan <= 0.5)) errors.push('region.model.tSpan: how far from the middle a state may lean, in (0, 0.5]');
  for (const k of ['low', 'high']) if (!isObject(region.rehearsed) || !Object.hasOwn(region.rehearsed, m[k] ?? '')) errors.push(`region.model.${k}: one of the rehearsed regions`);
  if (m.low && m.low === m.high) errors.push('region.model: low and high must be two different regions');
  const b = m.blend;
  if (!isObject(b) || !isString(b.dimension, 64) || !isString(b.value, 64) || !Array.isArray(b.key) || !b.key.length) errors.push('region.model.blend: { dimension, value, key: [dimensions] }');
  else {
    if (!region.vocabulary?.[b.dimension]?.includes(b.value)) errors.push(`region.model.blend: ${b.dimension}=${b.value} is not in the vocabulary`);
    for (const k of b.key) if (!isObject(region.vocabulary) || !Object.hasOwn(region.vocabulary, k)) errors.push(`region.model.blend.key: "${k}" is not a seeded dimension`);
  }
  if (!Array.isArray(m.extras)) errors.push('region.model.extras: a list (empty when the model adds nothing)');
  else m.extras.forEach((x, i) => {
    if (!isString(x?.name, 80)) errors.push(`region.model.extras[${i}].name: 1..80 characters`);
    touchesRule(errors, `region.model.extras[${i}]`, x?.touches, region.vocabulary);
    if (!isInt(x?.units, 1, limits?.unitsPerRow ?? 100000)) errors.push(`region.model.extras[${i}].units: a whole number within the per-row limit`);
    const lists = Array.isArray(x?.regions) ? [x.regions] : isObject(x?.regions) ? Object.values(x.regions) : null;
    if (!lists || !lists.every((l) => Array.isArray(l) && l.every((k) => REGION_KEY.test(k)))) errors.push(`region.model.extras[${i}].regions: a list of region keys, or an object of named lists`);
  });
  if (!isString(m.label, 200) || m.label.replace(/\{\{census\.label\}\}/g, 'Wyoming').length > 80) errors.push('region.model.label: the panel label, at most 80 characters once {{census.label}} is filled');
}

function imageryRules(errors, root, imagery, publicDir) {
  if (!isObject(imagery)) { errors.push('imagery: required, an object (or the path of a JSON file holding it)'); return; }
  pathRule(errors, root, 'imagery.dir', imagery.dir, { kind: 'dir', inside: publicDir });
  pathRule(errors, root, 'imagery.manifest', imagery.manifest, { kind: 'file', inside: publicDir, ext: '.json', mustExist: false });
  for (const k of ['section', 'subdir', 'cacheName']) if (!isString(imagery[k], 64) || !/^[a-z0-9][a-z0-9-]*$/.test(imagery[k])) errors.push(`imagery.${k}: a lower-case name`);
  if (!isString(imagery.manifestAbout, 2000)) errors.push('imagery.manifestAbout: the manifest\'s own sentence about its provenance, written into it on every run');
  if (!(typeof imagery.budgetMegabytes === 'number' && imagery.budgetMegabytes > 0)) errors.push('imagery.budgetMegabytes: the image payload budget');
  if (imagery.render !== undefined) {
    const r = imagery.render;
    if (!isObject(r)) errors.push('imagery.render: an object of render settings over the defaults');
    else {
      if (r.size !== undefined && !isInt(r.size, 64, 4096)) errors.push('imagery.render.size: the output square in pixels, 64..4096');
      if (r.fill !== undefined && !(typeof r.fill === 'number' && r.fill > 0 && r.fill <= 1)) errors.push('imagery.render.fill: the fraction of the frame the product\'s longer side fills, (0, 1]');
      for (const k of ['webp', 'png', 'jpg']) if (r[k] !== undefined && !isObject(r[k])) errors.push(`imagery.render.${k}: encoder options`);
    }
  }
  if (imagery.gate !== undefined) {
    if (!isObject(imagery.gate)) errors.push('imagery.gate: id → { verdict, checked, sha, note }');
    else for (const [id, g] of Object.entries(imagery.gate)) {
      if (!isObject(g) || !['accept', 'reject', 'pending'].includes(g.verdict) || !/^[0-9a-f]{64}$/.test(g.sha ?? '')) errors.push(`imagery.gate.${id}: { verdict: accept | reject | pending, checked, sha: <the reviewed file's sha256>, note }`);
    }
  }
  if (!isObject(imagery.placeholder) || !isString(imagery.placeholder.key, 32) || !isString(imagery.placeholder.file, 120)) errors.push('imagery.placeholder: { key, file }, what a missing image renders');
  if (!isObject(imagery.views) || !isString(imagery.views.pair, 200) || !isString(imagery.views.compose, 200)) errors.push('imagery.views: { pair, compose }, the sentence each kind records');
  if (!isObject(imagery.licences) || !Object.keys(imagery.licences).length) errors.push('imagery.licences: maker → what the source says, recorded as found');
  if (!Array.isArray(imagery.sources) || !imagery.sources.length) { errors.push('imagery.sources: the URL list'); return; }
  const ids = new Set();
  imagery.sources.forEach((s, i) => {
    const where = `imagery.sources[${i}]`;
    if (!isObject(s)) { errors.push(`${where}: an object`); return; }
    if (!isString(s.id, 63) || !SLUG.test(s.id)) errors.push(`${where}.id: a slug`);
    else if (ids.has(s.id)) errors.push(`${where}.id: "${s.id}" is listed twice`);
    ids.add(s.id);
    if (!isString(s.name, 120)) errors.push(`${where}.name: required`);
    if (!isString(s.maker, 40) || !isObject(imagery.licences) || !isString(imagery.licences[s.maker])) errors.push(`${where}.maker: "${s.maker}" has no licence note in imagery.licences`);
    if (!isString(s.page, 500) || !/^https:\/\//.test(s.page)) errors.push(`${where}.page: the https page the image was taken from`);
    if (!['pair', 'compose'].includes(s.kind)) errors.push(`${where}.kind: pair or compose`);
    const roles = Array.isArray(s.src) ? s.src.map((x) => x?.role) : [];
    if (!Array.isArray(s.src) || !s.src.length) errors.push(`${where}.src: at least one source`);
    else {
      s.src.forEach((x, j) => { if (!isString(x?.url, 2000) || !/^https:\/\//.test(x.url)) errors.push(`${where}.src[${j}].url: an https URL`); });
      if (s.kind === 'pair' && roles.join() !== 'pair') errors.push(`${where}.src: a pair is one source with role "pair"`);
      if (s.kind === 'compose' && (roles.length !== 2 || !roles.includes('back') || !roles.includes('front'))) errors.push(`${where}.src: a compose is a "back" and a "front"`);
    }
  });
}

/** The kinds of suite a demo has, which scripts/demo-kit/rehearse.mjs --suite selects: request level and DOM. */
export const SUITE_KINDS = Object.freeze(['page', 'dom']);

function checkRules(errors, root, check) {
  if (!isObject(check)) { errors.push('check: required, { suites }'); return; }
  if (!Array.isArray(check.suites) || !check.suites.length) { errors.push('check.suites: the demo\'s suites, each { name, kind, script, args? }'); return; }
  const kinds = new Set();
  check.suites.forEach((s, i) => {
    if (!isObject(s) || !isString(s.name, 80)) errors.push(`check.suites[${i}].name: required`);
    if (!SUITE_KINDS.includes(s?.kind)) errors.push(`check.suites[${i}].kind: ${SUITE_KINDS.join(' or ')} (page: the request-level suite; dom: the real page in headless Chrome), the name rehearse.mjs --suite selects it by`);
    else if (kinds.has(s.kind)) errors.push(`check.suites[${i}].kind: "${s.kind}" is listed twice; a demo has one suite of each kind`);
    else kinds.add(s.kind);
    pathRule(errors, root, `check.suites[${i}].script`, s?.script, { kind: 'file' });
    if (s?.args !== undefined && !(Array.isArray(s.args) && s.args.every((a) => typeof a === 'string'))) errors.push(`check.suites[${i}].args: a list of strings`);
  });
}

/**
 * Every problem with a config, as sentences naming the field. `sections` limits the check to what a script
 * needs (the seed needs `seed`, the region seed `region`, and so on); the common fields are always checked.
 */
export function validateConfig(config, { root = REPO_ROOT, sections = SECTIONS } = {}) {
  const errors = [];
  if (!isObject(config)) return { ok: false, errors: ['the config must be a JSON object'] };
  if (!isString(config.name, 80)) errors.push('name: the demo\'s name, 1..80 characters');
  if (!isString(config.slug, 63) || !SLUG.test(config.slug)) errors.push('slug: lower-case letters, digits and hyphens');
  if (!isString(config.tenant, 63) || !SLUG.test(config.tenant)) errors.push('tenant: the demo\'s tenant id, a slug');
  let publicDir = null;
  if (typeof config.publicDir !== 'string' || !/^public\/[a-z0-9][a-z0-9-]*\/?$/.test(config.publicDir)) errors.push('publicDir: "public/<slug>", the directory the demo serves');
  else {
    // Bound to the slug (R2): a config copied from another demo and left unedited would otherwise seed and
    // publish that demo's beat documents into this demo's tenant.
    const own = isString(config.slug, 63) && SLUG.test(config.slug) ? `public/${config.slug}` : null;
    if (own && config.publicDir.replace(/\/$/, '') !== own) errors.push(`publicDir: "${config.publicDir}" must be "${own}", the directory of this demo's own slug`);
    const abs = pathRule(errors, root, 'publicDir', config.publicDir, { kind: 'dir' });
    if (abs) publicDir = { abs, rel: config.publicDir };
  }
  const w = config.worker;
  if (!isObject(w)) errors.push('worker: { name, queue, devPort }');
  else {
    if (!isString(w.name, 63) || !SLUG.test(w.name)) errors.push('worker.name: a worker name such as edge-platform-vantage');
    else if (Object.hasOwn(FORBIDDEN_WORKERS, w.name)) errors.push(`worker.name: ${FORBIDDEN_WORKERS[w.name]}`);
    if (!isString(w.queue, 63) || !SLUG.test(w.queue)) errors.push('worker.queue: a queue name such as events-vantage');
    else if (Object.hasOwn(FORBIDDEN_QUEUES, w.queue)) errors.push(`worker.queue: ${FORBIDDEN_QUEUES[w.queue]}`);
    if (!isInt(w.devPort, 1024, 65535)) errors.push('worker.devPort: the local wrangler dev port');
    // A demo's worker is edge-platform-<slug> and its queue events-<slug> (the design's ruling on H1's question,
    // 2026-10-01): derived by the scaffolder, enforced here, so two demos can never share a worker or a queue.
    const slug = isString(config.slug, 63) && SLUG.test(config.slug) ? config.slug : null;
    if (slug && isString(w.name, 63) && SLUG.test(w.name) && !Object.hasOwn(FORBIDDEN_WORKERS, w.name) && w.name !== `edge-platform-${slug}`) {
      errors.push(`worker.name: "${w.name}" must be "edge-platform-${slug}", the worker of this demo's own slug`);
    }
    if (slug && isString(w.queue, 63) && SLUG.test(w.queue) && !Object.hasOwn(FORBIDDEN_QUEUES, w.queue) && w.queue !== `events-${slug}`) {
      errors.push(`worker.queue: "${w.queue}" must be "events-${slug}", the queue of this demo's own slug`);
    }
    if (w.config !== undefined) {
      const abs = pathRule(errors, root, 'worker.config', w.config, { kind: 'file', mustExist: false, ext: '.toml' });
      // Compared case-insensitively, since a Windows checkout opens WRANGLER.TOML as the same file.
      if (abs && relative(root, abs).split(sep).join('/').toLowerCase() === SHARED_WORKER_CONFIG) {
        errors.push(`worker.config: "${w.config}" is the shared worker's config, which also deploys the customer stamps (staging, production); a demo has its own, such as wrangler.${isString(config.slug, 63) ? config.slug : '<slug>'}.toml`);
      }
    }
  }
  if (sections.includes('seed')) seedRules(errors, root, config.seed, publicDir);
  if (sections.includes('region')) regionRules(errors, root, config.region);
  if (sections.includes('imagery')) imageryRules(errors, root, config.imagery, publicDir);
  if (sections.includes('check')) checkRules(errors, root, config.check);
  noCredentials(errors, config);
  return { ok: errors.length === 0, errors };
}

/** Load and validate in one step, exiting with every problem named. For the command lines. */
export function loadValidConfig(file, { sections, root = REPO_ROOT, exit = (code) => process.exit(code), log = console.error } = {}) {
  let loaded;
  try { loaded = loadConfig(file, { root, ...(sections ? { sections } : {}) }); } catch (error) { log(`✗ ${error.message}`); return exit(2); }
  const { ok, errors } = validateConfig(loaded.config, { root, sections });
  if (!ok) { log(`✗ ${relative(process.cwd(), loaded.file) || loaded.file}: ${errors.length} problem(s)\n  - ${errors.join('\n  - ')}`); return exit(2); }
  return { ...loaded, path: (rel) => resolveInside(root, rel) };
}

/** The value of a command-line flag (`--flag value`), or the fallback. argv is already sliced. */
export const argOf = (argv, flag, fallback) => { const i = argv.indexOf(flag); return i >= 0 && argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback; };

/**
 * The config file a --config value names: a file as given (relative to the working directory or to the
 * repository root), or a demo's slug, which names scripts/demo-kit/configs/<slug>.json. Null when neither exists.
 */
export function configFileFor(value, { root = REPO_ROOT, cwd = process.cwd(), exists = existsSync } = {}) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const candidates = isAbsolute(value) ? [value] : [resolve(cwd, value), resolve(root, value)];
  if (SLUG.test(value)) candidates.push(resolve(root, 'scripts', 'demo-kit', 'configs', `${value}.json`));
  return candidates.find((p) => exists(p) && /\.json$/i.test(p)) ?? null;
}

/** The config named by --config, or by the first argument that is not a flag or a flag's value. */
export function configArg(argv, valued = []) {
  const named = argOf(argv, '--config');
  if (named) return named;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith('--')) { if (valued.includes(argv[i])) i += 1; continue; }
    return argv[i];
  }
  return null;
}

// ── The products file (lane K4) ─────────────────────────────────────────────

/**
 * The products file a demo's beats speak about, and how its facts are read: `file` (inside the demo's public
 * directory), `list` (the array of products in it, default "products"), `id` (each product's id field),
 * `eventId` (the key an event or a piece names a product by, default "productId"), `attributes` (an event's
 * attribute → the product field it must equal) and, optionally, `variants` ({ list, key, attributes }: a
 * product's configurations, such as storage steps, each with its own facts). lib/seed.mjs productFactProblems
 * reads beat documents through it, and a seed refuses when they disagree.
 */
const FIELD = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
/** A product field, which may sit inside an object of the row (attributes.category). */
const FIELD_PATH = /^[A-Za-z_][A-Za-z0-9_]{0,63}(?:\.[A-Za-z_][A-Za-z0-9_]{0,63}){0,3}$/;
function productsRule(errors, root, where, p, publicDir, { mustExist = true } = {}) {
  if (!isObject(p)) { errors.push(`${where}: { file, list, id, eventId?, attributes, variants? }`); return; }
  pathRule(errors, root, `${where}.file`, p.file, { kind: 'file', ext: '.json', inside: publicDir, mustExist });
  for (const k of ['list', 'eventId']) if (p[k] !== undefined && !(isString(p[k], 64) && FIELD.test(p[k]))) errors.push(`${where}.${k}: a field name`);
  if (!(isString(p.id, 64) && FIELD_PATH.test(p.id))) errors.push(`${where}.id: the field that holds each product's id`);
  const map = (m, at) => {
    if (!isObject(m) || !Object.keys(m).length) { errors.push(`${at}: an object of event attribute → product field`); return; }
    for (const [k, v] of Object.entries(m)) if (!FIELD.test(k) || !(isString(v, 200) && FIELD_PATH.test(v))) errors.push(`${at}.${k}: "${v}" is not a field name (or a dotted path into the row)`);
  };
  map(p.attributes, `${where}.attributes`);
  // An overlay another lane writes (OH: Lane D2's specs.json), merged over each row by id before anything reads it.
  if (p.overlay !== undefined) {
    if (!isObject(p.overlay)) errors.push(`${where}.overlay: { file, by? }, rows merged over the products by id`);
    else {
      pathRule(errors, root, `${where}.overlay.file`, p.overlay.file, { ext: '.json', inside: publicDir, mustExist: false });
      if (p.overlay.by !== undefined && !(isString(p.overlay.by, 64) && FIELD.test(p.overlay.by))) errors.push(`${where}.overlay.by: the field each overlay row names its product by`);
    }
  }
  if (p.variants !== undefined) {
    const v = p.variants;
    if (!isObject(v) || !(isString(v.list, 64) && FIELD.test(v.list)) || !(isString(v.key, 64) && FIELD.test(v.key))) errors.push(`${where}.variants: { list, key, attributes }, a product's configurations`);
    else map(v.attributes, `${where}.variants.attributes`);
  }
}

// ── The demo config: public/<slug>/demo.config.json (lane K4) ───────────────

/** The kit's design tokens, read from public/demo-kit/tokens.css: a palette may set only these. */
export function kitTokens(root = REPO_ROOT) {
  const file = resolve(root, 'public', 'demo-kit', 'tokens.css');
  if (!existsSync(file)) return new Set();
  return new Set([...readFileSync(file, 'utf8').matchAll(/^\s*--([a-z0-9-]+)\s*:/gm)].map((m) => m[1]));
}

/** A duration as the design writes it: 60s, 10m, 2h, 14d (or a number of milliseconds). Null when it is not one. */
export function durationMs(value) {
  if (Number.isSafeInteger(value) && value > 0) return value;
  const m = /^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)$/.exec(String(value ?? '').trim());
  if (!m) return null;
  const ms = Number(m[1]) * { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[m[2]];
  return Number.isSafeInteger(ms) && ms > 0 ? ms : null;
}

const COLOUR = /^(?:#[0-9A-Fa-f]{6}|#[0-9A-Fa-f]{3}|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(?:,\s*(?:0|1|0?\.\d+)\s*)?\))$/;
const FONT_FAMILY = /^[A-Za-z0-9 ]{1,60}$/;
const CTX_NAME = /^[a-zA-Z][a-zA-Z0-9_]{0,31}$/;
/** The views a page shell boots into (the shell's data-entry). */
export const DEMO_ENTRIES = Object.freeze(['home', 'grid', 'product', 'phone']);
export const DEMO_SHELLS = Object.freeze(['index.html', 'product.html', 'm.html']);
export const BEAT_WHO = Object.freeze(['shopper', 'merch', 'engine']);
export const BEAT_KINDS = Object.freeze(['context', 'catalog', 'slots']);
export const SEED_SIGNALS = Object.freeze(['entry_channel', 'campaign_term', 'referrer_network', 'platform']);
/** The changes a scaffolded publish beat may make to the document before it, in beat order (lib/scaffold.mjs). */
export const BEAT_CHANGES = Object.freeze(['shiftDays', 'close', 'outOfStock', 'pin']);
/** The only fields a sign-in demo account carries: a fictional name and what it is for. Its secret lives on the worker. */
const ACCOUNT_FIELDS = Object.freeze(['name', 'about']);

/** The snapshot slots of a demo config's pages, in page order, each with its page key and engine page name. */
export function demoSlots(demo) {
  const out = [];
  for (const p of Array.isArray(demo?.pages) ? demo.pages : []) for (const s of Array.isArray(p?.slots) ? p.slots : []) if (isObject(s)) out.push({ page: p.key, engine: p.page, ...s });
  return out;
}

/**
 * Every problem with a demo config (docs/demo-kit/Demo-Kit-Design.md §2.4), as sentences naming the field:
 * the one file a solutions engineer edits first, from which scripts/demo-kit/new-demo.mjs scaffolds the demo.
 * It holds no credential (a sign-in demo account is a fictional name; its secret exists only on the worker), and
 * what it derives keeps the kit's rules: the worker is edge-platform-<slug>, the queue events-<slug>, the
 * public directory public/<slug>, every path inside the repository.
 */
export function validateDemoConfig(demo, { root = REPO_ROOT, tokens = kitTokens(root) } = {}) {
  const errors = [];
  if (!isObject(demo)) return { ok: false, errors: ['the demo config must be a JSON object'] };
  const at = (field, problem) => errors.push(`${field}: ${problem}`);
  if (!isString(demo.name, 80)) at('name', 'the demo’s name, 1..80 characters');
  const slugOk = isString(demo.slug, 40) && SLUG.test(demo.slug);
  if (!slugOk) at('slug', 'lower-case letters, digits and hyphens, at most 40');
  const slug = slugOk ? demo.slug : '<slug>';
  if (!isString(demo.tenant, 63) || !SLUG.test(demo.tenant)) at('tenant', 'the demo’s tenant id, a slug');
  if (demo.customer !== undefined && !isString(demo.customer, 80)) at('customer', 'whose demo this is, 1..80 characters');
  const publicDir = slugOk ? { abs: resolve(root, 'public', slug), rel: `public/${slug}` } : null;

  const w = demo.worker;
  if (!isObject(w)) at('worker', '{ name, queue, devPort }');
  else {
    if (w.name !== `edge-platform-${slug}`) at('worker.name', `"${w.name}" must be "edge-platform-${slug}": a demo’s worker is edge-platform-<slug>`);
    if (Object.hasOwn(FORBIDDEN_WORKERS, w.name)) at('worker.name', FORBIDDEN_WORKERS[w.name]);
    if (w.queue !== `events-${slug}`) at('worker.queue', `"${w.queue}" must be "events-${slug}": a demo’s queue is events-<slug>`);
    if (Object.hasOwn(FORBIDDEN_QUEUES, w.queue)) at('worker.queue', FORBIDDEN_QUEUES[w.queue]);
    if (!isInt(w.devPort, 1024, 65535)) at('worker.devPort', 'the local wrangler dev port, 1024..65535');
  }
  if (demo.design !== undefined) pathRule(errors, root, 'design', demo.design, { kind: 'file', ext: '.md' });

  const b = demo.brand;
  if (!isObject(b) || !isString(b.wordmark, 24) || !isString(b.title, 80)) at('brand', '{ wordmark (1..24), tagline?, title (the page title, 1..80), legal? }');
  else {
    if (b.tagline !== undefined && !isString(b.tagline, 80)) at('brand.tagline', '1..80 characters');
    if (b.legal !== undefined && !isString(b.legal, 800)) at('brand.legal', 'the footer’s sentence about what is real, 1..800 characters');
  }
  const pal = demo.palette;
  if (!isObject(pal)) at('palette', 'an object of kit token → colour (public/demo-kit/tokens.css names the tokens)');
  else {
    for (const need of ['brand', 'ink', 'paper']) if (!Object.hasOwn(pal, need)) at(`palette.${need}`, 'required');
    for (const [k, v] of Object.entries(pal)) {
      if (['font', 'mono'].includes(k)) at(`palette.${k}`, 'the families are fonts.font and fonts.mono');
      else if (tokens.size && !tokens.has(k)) at(`palette.${k}`, 'not a token of public/demo-kit/tokens.css');
      else if (!(typeof v === 'string' && COLOUR.test(v.trim()))) at(`palette.${k}`, `"${v}" is not a colour (#rrggbb, #rgb or rgb[a](…))`);
    }
  }
  const f = demo.fonts;
  if (f !== undefined) {
    if (!isObject(f)) at('fonts', '{ font, mono }: the families, from Google Fonts');
    else for (const k of ['font', 'mono']) if (f[k] !== undefined && !(isString(f[k], 60) && FONT_FAMILY.test(f[k]))) at(`fonts.${k}`, 'a font family name');
  }

  // Dimensions with their memory.
  const dims = new Map();
  if (!Array.isArray(demo.dimensions) || !demo.dimensions.length || demo.dimensions.length > 32) at('dimensions', 'a list of 1..32 dimensions, each { key, tau?, source?, multi?, values? }');
  else demo.dimensions.forEach((d, i) => {
    const where = `dimensions[${i}]`;
    if (!isObject(d) || !isString(d.key, 64) || !DIM.test(d.key)) { at(`${where}.key`, 'a dimension name'); return; }
    if (dims.has(d.key)) at(`${where}.key`, `"${d.key}" is listed twice`);
    if (d.tau !== undefined && durationMs(d.tau) === null) at(`${where}.tau`, `"${d.tau}" is not a duration such as 60s, 10m, 2h or 14d`);
    if (d.source !== undefined && !(isString(d.source, 64) && FIELD.test(d.source))) at(`${where}.source`, 'the event attribute it reads');
    if (d.multi !== undefined && typeof d.multi !== 'boolean') at(`${where}.multi`, 'true when an event may carry several values');
    if (d.values !== undefined) vocabularyRule(errors, `dimensions[${i}].values`, { [d.key]: d.values });
    dims.set(d.key, d);
  });
  const seedOnly = new Set(Array.isArray(demo.seedOnlyDimensions) ? demo.seedOnlyDimensions : []);
  if (demo.seedOnlyDimensions !== undefined && !(Array.isArray(demo.seedOnlyDimensions) && demo.seedOnlyDimensions.every((d) => DIM.test(d) && !dims.has(d)))) at('seedOnlyDimensions', 'dimension names that are not registry dimensions');
  const known = (d) => dims.has(d) || seedOnly.has(d);
  if (!isObject(demo.regional) || !Array.isArray(demo.regional.dimensions)) at('regional', '{ dimensions: [the regional allowlist] }');
  else for (const d of demo.regional.dimensions) if (!dims.has(d)) at('regional.dimensions', `"${d}" is not a dimension`);

  // Pages and their slots.
  const slotNames = new Set();
  const pageKeys = new Set();
  if (!Array.isArray(demo.pages) || !demo.pages.length) at('pages', 'a list of { key, page, entry, url, shell, slots, sorted?, offLimits? }');
  else demo.pages.forEach((p, i) => {
    const where = `pages[${i}]`;
    if (!isObject(p) || !isString(p.key, 40) || !NAME.test(p.key)) { at(`${where}.key`, 'a page key'); return; }
    if (pageKeys.has(p.key)) at(`${where}.key`, `"${p.key}" is listed twice`);
    pageKeys.add(p.key);
    if (!isString(p.page, 40) || !NAME.test(p.page)) at(`${where}.page`, 'the engine’s page name for the snapshot');
    if (!DEMO_ENTRIES.includes(p.entry)) at(`${where}.entry`, DEMO_ENTRIES.join(' | '));
    if (!DEMO_SHELLS.includes(p.shell)) at(`${where}.shell`, DEMO_SHELLS.join(', '));
    if (!isString(p.url, 200) || !p.url.startsWith(`/${slug}`)) at(`${where}.url`, `the page’s address, under /${slug}`);
    if (p.slotsOf !== undefined && !demo.pages.some((q) => q && q.key === p.slotsOf && q !== p)) at(`${where}.slotsOf`, `"${p.slotsOf}" is not another page`);
    if (p.slots !== undefined && !Array.isArray(p.slots)) at(`${where}.slots`, 'a list of slots');
    (Array.isArray(p.slots) ? p.slots : []).forEach((s, j) => {
      const sw = `${where}.slots[${j}]`;
      if (!isObject(s) || !isString(s.slot, 40) || !NAME.test(s.slot)) { at(`${sw}.slot`, 'a slot name'); return; }
      if (slotNames.has(s.slot)) at(`${sw}.slot`, `"${s.slot}" is named on another page too`);
      slotNames.add(s.slot);
      if (!isInt(s.take, 1, 24)) at(`${sw}.take`, 'how many pieces it holds, 1..24');
      if (!isObject(s.weights) || !Object.keys(s.weights).length) at(`${sw}.weights`, 'an object of dimension → weight');
      else for (const [d, x] of Object.entries(s.weights)) {
        if (!known(d)) at(`${sw}.weights.${d}`, 'not a dimension');
        if (!(typeof x === 'number' && x >= 0 && x <= 10)) at(`${sw}.weights.${d}`, 'a weight in 0..10');
      }
      if (s.diversity !== undefined && !(isObject(s.diversity) && dims.has(s.diversity.dimension) && isInt(s.diversity.max, 1, 24))) at(`${sw}.diversity`, '{ dimension, max }');
      if (s.pieceType !== undefined && !(isString(s.pieceType, 40) && NAME.test(s.pieceType))) at(`${sw}.pieceType`, 'the type of piece the slot holds');
      if (s.complements !== undefined && !(isObject(s.complements) && typeof s.complements.weight === 'number' && s.complements.weight >= 0 && s.complements.weight <= 1)) at(`${sw}.complements`, '{ weight 0..1 }: prefer the pieces that complete the anchor product the request names');
      if (s.gate !== undefined && !(isObject(s.gate) && Object.entries(s.gate).every(([n, v]) => CTX_NAME.test(n) && Array.isArray(v) && v.length && v.every((x) => isString(x, 64))))) at(`${sw}.gate`, 'an object of ctx name → the values that admit its starter pieces');
    });
    if (p.sorted !== undefined && !Array.isArray(p.sorted)) at(`${where}.sorted`, 'a list of /sort rails');
    (Array.isArray(p.sorted) ? p.sorted : []).forEach((s, j) => {
      const sw = `${where}.sorted[${j}]`;
      if (!isObject(s) || !isString(s.slot, 40) || !NAME.test(s.slot)) { at(`${sw}.slot`, 'a rail name'); return; }
      if (slotNames.has(s.slot)) at(`${sw}.slot`, `"${s.slot}" is named twice`);
      slotNames.add(s.slot);
      if (!isObject(s.weights) || !Object.keys(s.weights).length || !Object.keys(s.weights).every(known)) at(`${sw}.weights`, 'an object of dimension → weight, over the products');
    });
    if (p.offLimits !== undefined && !(Array.isArray(p.offLimits) && p.offLimits.every((x) => isString(x, 200)))) at(`${where}.offLimits`, 'what on the page is never decided, in words');
  });
  const slotList = demoSlots(demo);
  const snapshotSlots = new Set(slotList.map((s) => s.slot));

  // Seeds: the arrival as context, never evidence.
  if (demo.seeds !== undefined) {
    if (!Array.isArray(demo.seeds)) at('seeds', 'a list of { slots, signal, value, tags, weight }');
    else demo.seeds.forEach((r, i) => {
      const where = `seeds[${i}]`;
      if (!isObject(r)) { at(where, 'an object'); return; }
      if (!SEED_SIGNALS.includes(r.signal)) at(`${where}.signal`, SEED_SIGNALS.join(' | '));
      if (!isString(r.value, 256)) at(`${where}.value`, 'the signal value it fires on');
      if (!(typeof r.weight === 'number' && r.weight >= 0 && r.weight <= 1)) at(`${where}.weight`, 'a rule weight in 0..1');
      if (!Array.isArray(r.slots) || !r.slots.length) at(`${where}.slots`, 'the slots it applies to');
      if (!Array.isArray(r.tags) || !r.tags.length) at(`${where}.tags`, 'a list of { dimension, value }');
      for (const name of Array.isArray(r.slots) ? r.slots : []) {
        const s = slotList.find((x) => x.slot === name);
        if (!s) { at(`${where}.slots`, `"${name}" is not a snapshot slot`); continue; }
        for (const t of Array.isArray(r.tags) ? r.tags : []) if (!Object.hasOwn(s.weights ?? {}, t?.dimension)) at(`${where}.tags`, `"${t?.dimension}" is not a dimension the ${name} slot weights`);
      }
    });
  }

  // The beats, as data.
  const beats = demo.beats;
  const beatKeys = new Set();
  if (!isObject(beats) || !Array.isArray(beats.list) || !beats.list.length || beats.list.length > 40) at('beats', '{ file, acts, list: [1..40 beats] }');
  else {
    pathRule(errors, root, 'beats.file', beats.file, { ext: '.json', inside: publicDir, mustExist: false });
    if (!isObject(beats.acts) || !Object.keys(beats.acts).length) at('beats.acts', 'an object of act number → name');
    const nos = new Set();
    beats.list.forEach((x, i) => {
      const where = `beats.list[${i}]`;
      if (!isObject(x)) { at(where, 'an object'); return; }
      if (!isString(x.key, 40) || !NAME.test(x.key)) at(`${where}.key`, 'a beat key, lower-case');
      else if (beatKeys.has(x.key)) at(`${where}.key`, `"${x.key}" is listed twice`);
      beatKeys.add(x.key);
      const no = String(x.no ?? '');
      if (!/^[0-9]{1,2}[a-z]?$/.test(no) || nos.has(no)) at(`${where}.no`, 'its number on the director bar (3, or 9a), once');
      nos.add(no);
      if (!isObject(beats.acts) || !Object.hasOwn(beats.acts, String(x.act))) at(`${where}.act`, 'one of beats.acts');
      if (!BEAT_WHO.includes(x.who)) at(`${where}.who`, BEAT_WHO.join(' | '));
      for (const k of ['label', 'press', 'line']) if (!isString(x[k], k === 'label' ? 80 : 1200)) at(`${where}.${k}`, k === 'label' ? '1..80 characters' : 'required');
      for (const k of ['declare', 'will']) if (!Array.isArray(x[k]) || !x[k].length) at(`${where}.${k}`, 'a list of sentences');
      if (!BEAT_KINDS.includes(x.kind)) at(`${where}.kind`, `${BEAT_KINDS.join(' | ')}: what its beat document is`);
      if (x.kind && x.kind !== 'context') {
        if (!Array.isArray(x.change) || !x.change.length) at(`${where}.change`, `what the ${x.kind} publish changes: a list of { ${BEAT_CHANGES.join(' | ')} }`);
        else x.change.forEach((c, j) => {
          const verbs = isObject(c) ? Object.keys(c).filter((k) => BEAT_CHANGES.includes(k)) : [];
          if (verbs.length !== 1) { at(`${where}.change[${j}]`, `exactly one of ${BEAT_CHANGES.join(', ')}`); return; }
          if ((verbs[0] === 'pin') !== (x.kind === 'slots')) at(`${where}.change[${j}]`, verbs[0] === 'pin' ? 'a pin changes a slots document' : `${verbs[0]} changes a catalog document`);
          if (verbs[0] === 'shiftDays' && !(typeof c.shiftDays === 'number' && c.shiftDays > 0 && c.shiftDays <= 365)) at(`${where}.change[${j}].shiftDays`, 'days, 1..365');
          if (verbs[0] === 'pin' && !(isObject(c.pin) && snapshotSlots.has(c.pin.slot) && isObject(c.pin.piece))) at(`${where}.change[${j}].pin`, '{ slot: a snapshot slot, piece: a selector }');
          if (['close', 'outOfStock'].includes(verbs[0]) && !isObject(c[verbs[0]])) at(`${where}.change[${j}].${verbs[0]}`, 'a selector: { slotType?, type?, hasTag?, pick: first | last | <content id> }');
          if (c.as !== undefined && !(isString(c.as, 40) && FIELD.test(c.as))) at(`${where}.change[${j}].as`, 'the anchor id it is recorded under');
        });
      } else if (x.change !== undefined) at(`${where}.change`, 'a context beat publishes nothing');
      if (x.run !== undefined && !Array.isArray(x.run)) at(`${where}.run`, 'a list of the kit’s verbs (public/demo-kit/director.js)');
      if (x.lane !== undefined && !isString(x.lane, 60)) at(`${where}.lane`, 'the lane that writes its presses');
    });
  }

  // Data: products, the catalog, imagery, the regional vocabulary.
  if (demo.products === undefined) at('products', 'the products file and its attribute map');
  else {
    productsRule(errors, root, 'products', demo.products, publicDir, { mustExist: false });
    const pc = demo.products.pageContext;
    if (pc !== undefined) {
      if (!isObject(pc)) at('products.pageContext', 'an object of ctx name → the product field a product page asserts it from');
      else for (const [n, field] of Object.entries(pc)) {
        if (!CTX_NAME.test(n) || !(isString(field, 200) && FIELD_PATH.test(field))) at(`products.pageContext.${n}`, 'a ctx name and the product field it is read from');
        else if (!Array.isArray(demo.asserted?.context) || !demo.asserted.context.includes(n)) at(`products.pageContext.${n}`, `"${n}" is not one of asserted.context, the names the page may assert`);
      }
    }
  }
  if (demo.catalog !== undefined) pathRule(errors, root, 'catalog.file', demo.catalog?.file, { ext: '.json', inside: publicDir, mustExist: false });
  if (demo.imagery !== undefined) {
    pathRule(errors, root, 'imagery.manifest', demo.imagery?.manifest, { ext: '.json', inside: publicDir, mustExist: false });
    if (demo.imagery?.config !== undefined) pathRule(errors, root, 'imagery.config', demo.imagery.config, { ext: '.json', mustExist: false });
  }
  const region = demo.region;
  if (!isObject(region)) at('region', '{ dimensions, vocabulary, config?, contrast? }: the regional seed by name');
  else {
    if (!Array.isArray(region.dimensions) || !region.dimensions.length || !region.dimensions.every((d) => dims.has(d))) at('region.dimensions', 'the dimensions a seeded regional sale touches, each a dimension');
    if (isObject(region.vocabulary)) {
      vocabularyRule(errors, 'region.vocabulary', region.vocabulary);
      for (const d of Object.keys(region.vocabulary)) if (!Array.isArray(region.dimensions) || !region.dimensions.includes(d)) at(`region.vocabulary.${d}`, 'not one of region.dimensions');
    } else at('region.vocabulary', 'an object of dimension → the exact values a seeded sale may carry');
    if (region.config !== undefined) pathRule(errors, root, 'region.config', region.config, { ext: '.json', mustExist: false });
    if (region.contrast !== undefined && !(Array.isArray(region.contrast) && region.contrast.length && region.contrast.every((k) => REGION_KEY.test(k)))) at('region.contrast', 'region keys such as US-CA, in order of preference');
  }

  // What the page may assert, the report, the flags, the arrival, the copy, the documents.
  const as = demo.asserted;
  if (!isObject(as)) at('asserted', '{ intents: [the values the page may assert as ctx.intent], context?: [other ctx names] }');
  else {
    if (!Array.isArray(as.intents) || !as.intents.every((v) => isString(v, 40) && NAME.test(v))) at('asserted.intents', 'a list of intent values');
    if (as.context !== undefined && !(Array.isArray(as.context) && as.context.length <= 8 && as.context.every((n) => CTX_NAME.test(n)))) at('asserted.context', 'at most 8 context names (ctx.<name>)');
  }
  if (!Array.isArray(demo.reportSlots) || !demo.reportSlots.length) at('reportSlots', 'the snapshot slots a day report may be read for');
  else for (const s of demo.reportSlots) if (!snapshotSlots.has(s)) at('reportSlots', `"${s}" is not a snapshot slot`);
  const fl = demo.flags;
  if (fl !== undefined) {
    if (!isObject(fl)) at('flags', 'an object');
    else {
      if (fl.exitBeat !== undefined && typeof fl.exitBeat !== 'boolean') at('flags.exitBeat', 'true or false');
      if (fl.clockJump !== undefined && !(isObject(fl.clockJump) && beatKeys.has(fl.clockJump.beat) && typeof fl.clockJump.days === 'number' && fl.clockJump.days > 0)) at('flags.clockJump', '{ beat: a beat key, days }');
      const si = fl.signIn;
      if (si !== undefined) {
        if (!isObject(si) || !Array.isArray(si.accounts) || !si.accounts.length) at('flags.signIn', '{ live, beat?, accounts: [{ name, about? }] }');
        else {
          if (si.beat !== undefined && !beatKeys.has(si.beat)) at('flags.signIn.beat', 'a beat key');
          si.accounts.forEach((a, i) => {
            if (!isObject(a) || !isString(a.name, 80)) at(`flags.signIn.accounts[${i}].name`, 'a fictional name');
            const extra = isObject(a) ? Object.keys(a).filter((k) => !ACCOUNT_FIELDS.includes(k)) : [];
            if (extra.length) at(`flags.signIn.accounts[${i}]`, `carries ${extra.join(', ')}: a demo account is a fictional name only, and its secret exists only on the worker`);
          });
        }
      }
    }
  }
  const ar = demo.arrival;
  if (!isObject(ar) || !isString(ar.utm_term, 256)) at('arrival', '{ utm_source, utm_medium, utm_term, utm_campaign? }: the landing beat 1 opens on');
  const copy = demo.copy;
  if (!isObject(copy) || !isString(copy.coldStartSentence, 200) || !isString(copy.scoredSentence, 400)) at('copy', '{ coldStartSentence, scoredSentence, salesOf? }');
  if (!isObject(demo.docs) || demo.docs.dir !== `docs/${slug}`) at('docs.dir', `"docs/${slug}", where the design pointer, presenter script and resume live`);
  noCredentials(errors, demo, 'demo');
  return { ok: errors.length === 0, errors };
}

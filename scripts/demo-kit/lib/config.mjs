// scripts/demo-kit/lib/config.mjs — the demo kit's config: load it, resolve its paths, validate it.
//
// A demo config is one JSON file (scripts/demo-kit/configs/<slug>.json today; public/<slug>/demo.config.json
// in the design, docs/demo-kit/Demo-Kit-Design.md §2.4). Every path in it is relative to the repository
// root. A section may be written inline or as the path of a JSON file that holds it ("region": "…/region.json").
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
 */
export function loadConfig(file, { root = REPO_ROOT } = {}) {
  const abs = isAbsolute(file) ? file : resolve(process.cwd(), file);
  if (!existsSync(abs)) throw new Error(`config ${file}: no such file`);
  const config = readJson(abs);
  if (!isObject(config)) throw new Error(`config ${file}: not a JSON object`);
  const sources = { config: abs };
  for (const section of SECTIONS) {
    if (typeof config[section] !== 'string') continue;
    const sectionFile = resolveInside(root, config[section]);
    if (!sectionFile || !existsSync(sectionFile)) throw new Error(`config ${file}: section "${section}" names ${config[section]}, which is not a file inside the repository`);
    const value = readJson(sectionFile);
    if (!isObject(value)) throw new Error(`config ${file}: section "${section}" (${config[section]}) is not a JSON object`);
    config[section] = value;
    sources[section] = sectionFile;
  }
  return { config, root, file: abs, sources };
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

function checkRules(errors, root, check) {
  if (!isObject(check)) { errors.push('check: required, { suites }'); return; }
  if (!Array.isArray(check.suites) || !check.suites.length) { errors.push('check.suites: the demo\'s suites, each { name, script, args? }'); return; }
  check.suites.forEach((s, i) => {
    if (!isObject(s) || !isString(s.name, 80)) errors.push(`check.suites[${i}].name: required`);
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
  try { loaded = loadConfig(file, { root }); } catch (error) { log(`✗ ${error.message}`); return exit(2); }
  const { ok, errors } = validateConfig(loaded.config, { root, sections });
  if (!ok) { log(`✗ ${relative(process.cwd(), loaded.file) || loaded.file}: ${errors.length} problem(s)\n  - ${errors.join('\n  - ')}`); return exit(2); }
  return { ...loaded, path: (rel) => resolveInside(root, rel) };
}

/** The value of a command-line flag (`--flag value`), or the fallback. argv is already sliced. */
export const argOf = (argv, flag, fallback) => { const i = argv.indexOf(flag); return i >= 0 && argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback; };

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

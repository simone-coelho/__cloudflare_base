// scripts/demo-kit/lib/credentials.mjs — the credential grep over everything a demo's pages load.
//
// public/ is served wholesale (wrangler.toml [assets]), so a token written into a demo's directory is a
// credential anyone with the URL can fetch (AGENTS.md, "No demo page carries a credential"). This is the
// repository's own check, lifted from scripts/rehearse-vantage-page.mjs ("No credential is served,
// embedded or committed"): the same three token shapes, over the same text files, plus the file names
// the suites probe for (operator.local.json, token.json), plus one more check the suites cannot make:
// that no secret value from the local .dev.vars appears in any served file. That last check reports the
// variable's NAME and the file, never the value.
//
// What is scanned is what the pages load, not only the demo's own directory (R2): `servedPaths` starts
// from the config's public/<slug> and the kit's public/demo-kit, and follows every path the files there
// name (an import, a stylesheet, a script, a fetched document, html2canvas at the public root) to the
// top-level directory or file under public/ it lands in, until nothing new is named.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

/** The token shapes, verbatim from scripts/rehearse-vantage-page.mjs (TOKENISH). */
export const TOKEN_PATTERNS = Object.freeze([
  [/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{8,}/, 'a JWT'],
  [/Bearer\s+(?!\$\{)[A-Za-z0-9._~+/=-]{24,}/, 'a bearer token literal'],
  [/ss1\.[A-Za-z0-9._-]{30,}/, 'a shopper capability literal'],
]);

/** The files the suites check are never served (operator tokens once lived in beats/operator.local.json). */
export const FORBIDDEN_NAMES = Object.freeze(['operator.local.json', 'token.json', '.dev.vars']);

/** The text files the suite reads, by extension (scripts/rehearse-vantage-page.mjs, TEXT). */
export const TEXT_FILE = /\.(html|js|mjs|ts|css|json|svg|md|toml|txt)$/i;

/**
 * The .dev.vars names whose values are secrets. Public by design and therefore not searched: SDK_KEYS (the
 * page sends its site key on every call), ODP_PUBLIC_KEY, OPTIMIZELY_SDK_KEY, and configuration such as TENANTS.
 */
export const SECRET_NAME = /(SECRET|SALT|PRIVATE|PASSWORD|API_KEY|_TOKEN)$|^TOKEN$/;
const MIN_SECRET_LENGTH = 16;

/** Which token shapes a text carries ("a JWT", …); empty when none. */
export const tokenFindings = (text) => TOKEN_PATTERNS.filter(([re]) => re.test(text)).map(([, what]) => what);

/** Every file under `dir`; a file given instead of a directory is itself. */
export function walkFiles(dir) {
  if (!existsSync(dir)) return [];
  if (!statSync(dir).isDirectory()) return [dir];
  return readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? walkFiles(p) : [p]; });
}

// ── What a demo's pages load ────────────────────────────────────────────────

/** The kit's page modules, which every kit demo's pages load (docs/demo-kit/Demo-Kit-Design.md §2.2). */
export const KIT_DIR = 'public/demo-kit';

/** The files whose text names what a page loads: markup, scripts, styles and the documents the pages fetch. */
const REFERENCE_FILE = /\.(html|js|mjs|css|json|svg)$/i;

/**
 * A path a file names: after a quote, a backtick, `url(` or `=`, root-absolute (`/demo-kit/kit.js`) or
 * relative (`./util.js`, `../demo-kit/compare.css`); never protocol-relative (`//cdn…`). A template
 * literal's path is read up to its first `${`: `/vantage/beats/${name}.json` names /vantage/beats/.
 */
const REFERENCE = /[\x27"`(=]\s*((?:\.{1,2})?\/(?!\/)[A-Za-z0-9_.~/-]*)/g;

/** The paths a text names, as written. */
export const referencesIn = (text) => [...String(text).matchAll(REFERENCE)].map((m) => m[1]);

const within = (abs, dir) => { const back = relative(dir, abs); return back !== '' && !back.startsWith('..') && !isAbsolute(back); };

/**
 * Every top-level directory or file under public/ that a demo's pages load, from its config's public
 * directory and the kit's: each one, then whatever the text files in it name, followed until nothing new
 * is named. A name that lands outside public/, or on nothing that exists (an API route such as
 * /v1/vantage/decisions), is not a served file and is skipped. Returns repository-relative paths in the
 * order found, each with the file that first named it (`via`; null for the two starting points).
 */
export function servedPaths({ root, publicDir, kit = KIT_DIR }) {
  const publicRoot = join(root, 'public');
  const found = new Map();
  const queue = [];
  const add = (abs, via) => {
    if (found.has(abs) || !existsSync(abs)) return;
    found.set(abs, { path: relative(root, abs).split(sep).join('/'), via, dir: statSync(abs).isDirectory() });
    queue.push(abs);
  };
  /** The top-level entry under public/ that a path named in `file` lands in, or null. */
  const topOf = (file, ref) => {
    const abs = ref.startsWith('/') ? join(publicRoot, ref) : resolve(dirname(file), ref);
    if (!within(abs, publicRoot)) return null;
    return join(publicRoot, relative(publicRoot, abs).split(sep)[0]);
  };
  for (const start of [publicDir, kit]) {
    const abs = resolve(root, start);
    if (within(abs, publicRoot)) add(abs, null);
  }
  while (queue.length) {
    for (const file of walkFiles(queue.shift())) {
      if (!REFERENCE_FILE.test(file)) continue;
      const via = relative(root, file).split(sep).join('/');
      for (const ref of referencesIn(readFileSync(file, 'utf8'))) {
        const top = topOf(file, ref);
        if (top) add(top, via);
      }
    }
  }
  return [...found.values()];
}

/**
 * The secret values in a .dev.vars text, by name. Values are returned for comparison only; a caller must
 * never print them. Quotes around a value are removed the way the resume's shell lines remove them.
 */
export function secretValues(devVarsText) {
  const out = [];
  for (const line of String(devVarsText).split(/\r?\n/)) {
    const m = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line.trim());
    if (!m || !SECRET_NAME.test(m[1])) continue;
    const value = m[2].trim().replace(/^(['"])(.*)\1$/, '$2');
    if (value.length >= MIN_SECRET_LENGTH) out.push({ name: m[1], value });
  }
  return out;
}

/**
 * Scan every file under `dir`, or under each of `dirs` (a directory or a single file each, as
 * `servedPaths` returns them), and any `extraFiles`. Text files are read for the token shapes; every file,
 * text or binary, is searched for each secret value. Returns findings as { file, what }, where `what`
 * names a shape, a forbidden file name or a .dev.vars variable, and never a value.
 */
export function scanForCredentials({ dir, dirs = dir === undefined ? [] : [dir], extraFiles = [], secrets = [], root = dirs[0] }) {
  const inDir = [...new Set(dirs.flatMap(walkFiles))];
  const inDirSet = new Set(inDir);
  const extra = [...new Set(extraFiles)].filter((f) => existsSync(f) && !inDirSet.has(f));
  const files = [...inDir, ...extra];
  const findings = [];
  let textFiles = 0;
  for (const file of files) {
    const rel = relative(root, file).split(sep).join('/');
    const base = rel.split('/').pop();
    if (FORBIDDEN_NAMES.includes(base)) findings.push({ file: rel, what: `a file named ${base}, which must never be served` });
    const buf = readFileSync(file);
    if (TEXT_FILE.test(file)) {
      textFiles += 1;
      for (const what of tokenFindings(buf.toString('utf8'))) findings.push({ file: rel, what });
    }
    for (const s of secrets) if (buf.includes(s.value)) findings.push({ file: rel, what: `the value of ${s.name} from .dev.vars` });
  }
  return { files: files.length, dirFiles: inDir.length, extraFiles: extra.length, textFiles, secretsSearched: secrets.length, findings };
}

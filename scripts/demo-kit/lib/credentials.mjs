// scripts/demo-kit/lib/credentials.mjs — the credential grep over a demo's public directory.
//
// public/ is served wholesale (wrangler.toml [assets]), so a token written into a demo's directory is a
// credential anyone with the URL can fetch (AGENTS.md, "No demo page carries a credential"). This is the
// repository's own check, lifted from scripts/rehearse-vantage-page.mjs ("No credential is served,
// embedded or committed"): the same three token shapes, over the same text files, plus the file names
// the suites probe for (operator.local.json, token.json), plus one more check the suites cannot make:
// that no secret value from the local .dev.vars appears in any served file. That last check reports the
// variable's NAME and the file, never the value.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

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

export function walkFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? walkFiles(p) : [p]; });
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
 * Scan every file under `dir` (and any `extraFiles`). Text files are read for the token shapes; every file,
 * text or binary, is searched for each secret value. Returns findings as { file, what }, where `what`
 * names a shape, a forbidden file name or a .dev.vars variable, and never a value.
 */
export function scanForCredentials({ dir, extraFiles = [], secrets = [], root = dir }) {
  const inDir = walkFiles(dir);
  const extra = extraFiles.filter((f) => existsSync(f) && !inDir.includes(f));
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

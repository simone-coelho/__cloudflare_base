// W01.01 source-only inspection. Never imports application modules or writes files.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import ts from 'typescript';

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const hash = (p) => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, p))).digest('hex');
const walk = (dir) => fs.readdirSync(path.join(root, dir), { withFileTypes: true })
  .sort((a, b) => a.name.localeCompare(b.name, 'en'))
  .flatMap((e) => e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`]);
const sourceFiles = walk('src').filter((p) => !/\.(test|spec)\.[^.]+$/.test(p));
const modules = new Map();
const uncertainties = [];
const methods = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'all', 'on']);
const literal = (n) => n && (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) ? n.text : null;
const localModule = (from, name) => {
  const base = name.startsWith('@/') ? `src/${name.slice(2)}` : path.posix.normalize(path.posix.join(path.posix.dirname(from), name));
  return [base, `${base}.ts`, `${base}/index.ts`].find((p) => fs.existsSync(path.join(root, p))) ?? null;
};

for (const file of sourceFiles.filter((p) => p.endsWith('.ts'))) {
  const source = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true);
  const mod = { file, source, routers: new Set(), imports: new Map(), exports: new Map(), registrations: [] };
  modules.set(file, mod);
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && ts.isNewExpression(node.initializer) && node.initializer.expression.getText(source) === 'Hono') {
      mod.routers.add(node.name.text);
      if (node.parent.parent.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) mod.exports.set(node.name.text, node.name.text);
    }
    if (ts.isImportDeclaration(node) && literal(node.moduleSpecifier)?.match(/^(@\/|\.)/)) {
      const target = localModule(file, literal(node.moduleSpecifier));
      if (node.importClause?.name) mod.imports.set(node.importClause.name.text, { file: target, exported: 'default' });
      const bindings = node.importClause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) for (const e of bindings.elements) mod.imports.set(e.name.text, { file: target, exported: e.propertyName?.text ?? e.name.text });
    }
    if (ts.isExportAssignment(node) && ts.isIdentifier(node.expression)) mod.exports.set('default', node.expression.text);
    if (ts.isExportDeclaration(node) && node.exportClause && ts.isNamedExports(node.exportClause)) for (const e of node.exportClause.elements) mod.exports.set(e.name.text, e.propertyName?.text ?? e.name.text);
    ts.forEachChild(node, visit);
  };
  visit(source);
  const registrations = (node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.expression) && mod.routers.has(node.expression.expression.text)) {
      const operation = node.expression.name.text;
      if (methods.has(operation) || ['use', 'route', 'basePath', 'mount'].includes(operation)) {
        const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
        const receiver = node.expression.expression.text;
        let paths = [literal(node.arguments[0])];
        let verbs = [operation.toUpperCase()];
        if (operation === 'on') {
          const values = (arg) => ts.isArrayLiteralExpression(arg) ? arg.elements.map(literal) : [literal(arg)];
          verbs = values(node.arguments[0]);
          paths = values(node.arguments[1]);
        }
        const conditional = [];
        for (let p = node.parent; p && !ts.isSourceFile(p); p = p.parent) {
          if (ts.isIfStatement(p) || ts.isForStatement(p) || ts.isForOfStatement(p) || ts.isForInStatement(p) || ts.isWhileStatement(p) || ts.isFunctionLike(p)) conditional.push(ts.SyntaxKind[p.kind]);
        }
        if (paths.includes(null) || verbs.includes(null) || conditional.length || ['basePath', 'mount'].includes(operation)) uncertainties.push({ file, line, operation, reason: 'Dynamic, conditional, or unsupported registration requires manual expansion.', conditional });
        for (const routePath of paths) for (const method of verbs) mod.registrations.push({ file, line, receiver, operation, method, path: routePath, target: operation === 'route' ? node.arguments[1]?.getText(source) : undefined });
      }
    }
    ts.forEachChild(node, registrations);
  };
  registrations(source);
}

const routes = [];
const mounts = [];
const middleware = [];
const visited = new Set();
const join = (a, b) => b === '/' ? (a || '/') : `${a}${b}`;
function expand(file, router, prefix, ancestry = []) {
  const key = `${file}:${router}`;
  if (ancestry.includes(key)) throw new Error(`Cyclic Hono mount: ${key}`);
  const mod = modules.get(file);
  if (!mod || !mod.routers.has(router)) throw new Error(`Unresolved Hono router: ${key}`);
  visited.add(key);
  for (const reg of mod.registrations.filter((r) => r.receiver === router)) {
    if (reg.path === null) continue;
    const fullPath = join(prefix, reg.path);
    const location = { file: reg.file, line: reg.line };
    if (reg.operation === 'route') {
      const imported = mod.imports.get(reg.target);
      const targetFile = imported?.file ?? file;
      const target = imported ? modules.get(targetFile)?.exports.get(imported.exported) : reg.target;
      mounts.push({ prefix: fullPath, symbol: reg.target, ...location, target_file: targetFile, target_router: target });
      expand(targetFile, target, fullPath, [...ancestry, key]);
    } else if (reg.operation === 'use') {
      middleware.push({ path: fullPath, ...location, router });
    } else if (methods.has(reg.operation)) {
      routes.push({ id: `R${String(routes.length + 1).padStart(3, '0')}`, method: reg.method, path: fullPath, ...location, mount: prefix || '/', local_path: reg.path, derived_head: reg.method === 'GET' });
    }
  }
}
expand('src/index.ts', 'app', '');
const routerFetchDispatches = [];
for (const mod of modules.values()) {
  const visit = (node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'fetch' && ts.isIdentifier(node.expression.expression)) {
      const receiver = node.expression.expression.text;
      const imported = mod.imports.get(receiver);
      const targetFile = imported?.file ?? mod.file;
      const router = imported ? modules.get(targetFile)?.exports.get(imported.exported) : receiver;
      if (modules.get(targetFile)?.routers.has(router)) routerFetchDispatches.push({ file: mod.file, line: mod.source.getLineAndCharacterOfPosition(node.getStart(mod.source)).line + 1, receiver, target_file: targetFile, target_router: router });
    }
    ts.forEachChild(node, visit);
  };
  visit(mod.source);
}
const unmounted = [...modules.values()].flatMap((m) => [...m.routers].filter((r) => !visited.has(`${m.file}:${r}`)).map((router) => ({ file: m.file, router, registrations: m.registrations.filter((r) => r.receiver === router) })));
const dependencies = [
  'package.json', 'package-lock.json', 'wrangler.toml',
  'node_modules/hono/package.json', 'node_modules/hono/dist/hono-base.js', 'node_modules/hono/dist/compose.js',
  'node_modules/hono/dist/utils/url.js', 'node_modules/hono/dist/middleware/cors/index.js',
  'node_modules/agents/package.json', 'node_modules/agents/dist/index.js',
  'node_modules/partyserver/package.json', 'node_modules/partyserver/dist/index.js',
  'node_modules/@cloudflare/ai-chat/package.json', 'node_modules/@cloudflare/ai-chat/dist/index.js',
  'node_modules/wrangler/package.json', 'node_modules/wrangler/config-schema.json',
  'node_modules/typescript/package.json', 'node_modules/typescript/lib/typescript.js',
].filter((p) => fs.existsSync(path.join(root, p)));
const assets = walk('public');
const identities = (files) => files.map((file) => ({ file, sha256: hash(file) }));
const manifest = {
  schema: 'W01.01-source-routes-v1', claim: 'source_confirmed; no handlers executed or deployment attested',
  generator: 'docs/remediation/evidence/W01.01/inspect-routes.mjs',
  counts: { mounts: mounts.length, explicit_routes: routes.length, get_routes_with_derived_head: routes.filter((r) => r.derived_head).length, middleware_registrations: middleware.length, router_fetch_dispatches: routerFetchDispatches.length, unmounted_routers: unmounted.length, source_files: sourceFiles.length, public_files: assets.length },
  dependency_versions: Object.fromEntries(['hono', 'agents', 'partyserver', '@cloudflare/ai-chat', 'wrangler', 'typescript'].map((p) => { const file = `node_modules/${p}/package.json`; return [p, fs.existsSync(path.join(root, file)) ? JSON.parse(read(file)).version : null]; })),
  mounts, routes, middleware, router_fetch_dispatches: routerFetchDispatches, unmounted, uncertainties,
  derived_dispatch: { HEAD: 'Hono invokes GET route with original Request then strips response body; per-route middleware can still inspect HEAD.', OPTIONS: 'Global Hono CORS returns 204 before rate/auth/routes; pre-Hono Agents and asset service are separate.', agents: '/agents/:namespace/:name[/...] forwards original URL to each discovered idFromName binding; all methods and upgrades require separate review.', assets: 'Declared public/ and SPA fallback; no run_worker_first configured; deployed edge/host behavior unverified.' },
  source_hashes: identities(sourceFiles), dependency_hashes: identities(dependencies), public_asset_hashes: identities(assets),
};
if (process.argv.includes('--table')) {
  process.stdout.write('| ID | Method | Mounted path | Source |\n|---|---|---|---|\n' + routes.map((r) => `| ${r.id} | ${r.method}${r.derived_head ? ' (+ HEAD)' : ''} | \`${r.path}\` | [${r.file}:${r.line}](../../../../${r.file}#L${r.line}) |`).join('\n') + '\n');
} else if (process.argv.includes('--summary')) {
  process.stdout.write(JSON.stringify({ counts: manifest.counts, dependency_versions: manifest.dependency_versions, uncertainties, unmounted }, null, 2) + '\n');
} else {
  process.stdout.write(JSON.stringify(manifest, null, 2) + '\n');
}
if (uncertainties.length) process.exitCode = 2;

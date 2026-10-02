import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import ts from "typescript";
import { createApiInspector } from "./source-api-boundaries.mjs";

export const SOURCE_EXTENSION = /\.(?:[cm]?js|[cm]?ts|tsx|jsx)$/u;
const UI = /^(?:entrypoints\/learning-center\/|src\/learning-center\/)/u;
const ROOT_RUNTIME = new Set(["background.js", "content.js", "popup.js", "options.js"]);
export const isRuntimeSource = (path) => path.startsWith("src/") || path.startsWith("entrypoints/") || ROOT_RUNTIME.has(path);
const isReact = (name) => /^(?:react|react-dom)(?:\/|$)/u.test(name);
function dependencies(tree, api) {
  const found = [];
  function visit(node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      const clause = ts.isImportDeclaration(node) ? node.importClause : node.exportClause;
      const names = ts.isImportDeclaration(node) ? clause?.namedBindings : clause;
      const namedTypesOnly = names && (ts.isNamedImports(names) || ts.isNamedExports(names)) &&
        names.elements.length > 0 && names.elements.every((element) => element.isTypeOnly) &&
        !(ts.isImportDeclaration(node) && clause?.name);
      found.push({ specifier: node.moduleSpecifier.text, typeOnly: node.isTypeOnly || clause?.isTypeOnly || namedTypesOnly });
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      found.push({ specifier: node.moduleReference.expression?.text, typeOnly: node.isTypeOnly });
    } else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || api.moduleLoader(node.expression))) {
      found.push({ specifier: node.arguments[0] && ts.isStringLiteralLike(node.arguments[0]) ? node.arguments[0].text : null, typeOnly: false });
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  return found;
}

function sourceEffects(tree) {
  let esm = false, jsx = false;
  function visit(node) {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node) || ts.isExportAssignment(node) ||
        node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ||
        (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) ||
        (ts.isMetaProperty(node) && node.keywordToken === ts.SyntaxKind.ImportKeyword)) esm = true;
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) jsx = true;
    ts.forEachChild(node, visit);
  }
  visit(tree);
  return { esm, jsx };
}

function resolveSource(root, owner, specifier) {
  const target = resolve(dirname(resolve(root, owner)), specifier);
  const rel = relative(root, target);
  if (isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`)) return null;
  const candidates = [target];
  if (/\.js$/u.test(target)) candidates.push(target.replace(/\.js$/u, ".ts"), target.replace(/\.js$/u, ".tsx"));
  if (!SOURCE_EXTENSION.test(target)) candidates.push(...[".js", ".ts", ".tsx", "/index.js", "/index.ts", "/index.tsx"].map((suffix) => target + suffix));
  return candidates.find((candidate) => existsSync(candidate) && SOURCE_EXTENSION.test(candidate)) || null;
}

export function inspectSources(root, files) {
  const failures = [], graph = new Map();
  for (const file of files) {
    const path = relative(root, file).replaceAll(sep, "/");
    const code = readFileSync(file, "utf8");
    const tree = ts.createSourceFile(path, code, ts.ScriptTarget.Latest, true);
    for (const error of tree.parseDiagnostics) failures.push(`${path}: syntax: ${ts.flattenDiagnosticMessageText(error.messageText, " ")}`);
    if (!isRuntimeSource(path)) continue;
    const { esm, jsx } = sourceEffects(tree);
    const api = createApiInspector(tree);
    const { effects } = api;
    // Erased TS edges do not enter a runtime allowlist or runtime API/React graph.
    // Empty, mixed and side-effect imports retain their runtime edges.
    const deps = dependencies(tree, api).filter(({ typeOnly }) => !typeOnly);
    for (const node of api.unknownComputed) failures.push(`${path} 无法审计的全局 API 计算属性: ${node.getText(tree)}`);
    if (jsx) {
      const pragmas = tree.pragmas.get("jsximportsource");
      const pragma = Array.isArray(pragmas) ? pragmas.at(-1) : pragmas;
      deps.push({ specifier: `${pragma?.arguments.factory || "react"}/jsx-runtime`, typeOnly: false });
    }
    graph.set(path, { effects, deps, jsx, resolved: [] });
    if (path.startsWith("src/") && code.split(/\r?\n/u).length > 420) failures.push(`${path} 超过 420 行；请继续拆分职责`);
    if (path.startsWith("entrypoints/") && !UI.test(path) && code.split(/\r?\n/u).length > 20) failures.push(`${path} 必须保持 20 行以内的组合入口`);
    if (path.startsWith("src/content/") && esm) failures.push(`${path} classic Content 不允许 ESM import/export/dynamic import`);
    if (effects.has("fetch") && !path.startsWith("src/background/providers/") &&
        path !== "src/background/lexical/package-assets.js" && path !== "src/content/subtitles/youtube-main-bridge.js") failures.push(`${path} 直接使用 fetch；网络只允许 Provider，包资源只允许 lexical/package-assets.js`);
    if (effects.has("indexedDB") && path !== "src/background/cache-db.js") failures.push(`${path} 直接访问 IndexedDB；只能位于 src/background/cache-db.js`);
    if (effects.has("registerContentScripts") && path !== "src/background/auto-sites.js") failures.push(`${path} 注册动态 Content Script；只能位于 src/background/auto-sites.js`);
    if (path === "src/content/subtitles/youtube-main-bridge.js" && api.fetchCalls.size) failures.push(`${path} MAIN observer 不允许主动 fetch`);
    for (const dependency of deps) {
      const { specifier } = dependency;
      if (!specifier) { failures.push(`${path} 不允许无法审计的动态依赖`); continue; }
      if (specifier.startsWith(".")) {
        const dependencyFile = resolveSource(root, path, specifier);
        if (!dependencyFile) failures.push(`${path} 无法解析或越界的源码依赖: ${specifier}`);
        else graph.get(path).resolved.push(relative(root, dependencyFile).replaceAll(sep, "/"));
      } else if (!(isReact(specifier) && UI.test(path)) &&
          !(path === "entrypoints/background.ts" && specifier === "wxt/utils/define-background") &&
          !(path === "entrypoints/background.js" && specifier === "wxt/utils/define-background")) {
        failures.push(`${path} 未批准的 runtime 依赖: ${specifier}`);
      }
    }
  }
  for (const [origin] of graph) {
    const seen = new Set();
    function visit(path, chain) {
      if (seen.has(path)) return;
      seen.add(path);
      const module = graph.get(path);
      if (!module) { failures.push(`${origin} runtime 依赖进入非 runtime 源码: ${chain.join(" → ")}`); return; }
      if (!UI.test(origin) && (module.jsx || module.deps.some(({ specifier }) => specifier && isReact(specifier)))) failures.push(`${origin} React/JSX 泄漏到非学习中心运行环境: ${chain.join(" → ")}`);
      if (origin.startsWith("src/shared/") && ["chrome", "browser", "fetch", "indexedDB", "registerContentScripts"].some((name) => module.effects.has(name))) failures.push(`${origin} shared 层不允许浏览器/网络/存储 API: ${chain.join(" → ")}`);
      for (const dependency of module.resolved) visit(dependency, [...chain, dependency]);
    }
    visit(origin, [origin]);
  }
  return failures;
}

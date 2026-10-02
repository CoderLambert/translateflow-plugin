import ts from "typescript";

const ROOT = "$global";
const GLOBALS = new Set(["globalThis", "window", "self"]);
const APIS = new Set(["chrome", "browser", "fetch", "indexedDB", "registerContentScripts", "require"]);
const unwrap = (node) => {
  while (node && (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isTypeAssertionExpression(node) || ts.isNonNullExpression(node) || ts.isSatisfiesExpression(node))) node = node.expression;
  return node;
};

// One isolated AST binding program per source: no dependency/global declarations
// can turn a local parameter or block binding into a privileged global name.
export function createApiInspector(tree) {
  const options = { allowJs: true, noLib: true, noResolve: true };
  const host = ts.createCompilerHost(options);
  host.getSourceFile = (name) => name === tree.fileName ? tree : undefined;
  const checker = ts.createProgram([tree.fileName], options, host).getTypeChecker();
  const effects = new Set(), unknownComputed = new Set(), fetchCalls = new Set();
  const privileged = (path) => path && path[0] === ROOT && (path.length === 1 || APIS.has(path[1]));
  function declaration(node) {
    const declarations = checker.getSymbolAtLocation(node)?.declarations;
    return declarations?.length === 1 ? declarations[0] : null;
  }
  function isConst(decl) {
    while (decl && ts.isBindingElement(decl)) decl = decl.parent.parent;
    return decl && ts.isVariableDeclaration(decl) && (decl.parent.flags & ts.NodeFlags.Const) !== 0;
  }
  function constant(node, seen = new Set()) {
    node = unwrap(node);
    if (!node) return null;
    if (ts.isStringLiteralLike(node)) return node.text;
    if (ts.isNumericLiteral(node)) return Number(node.text.replaceAll("_", ""));
    if (ts.isIdentifier(node)) {
      const decl = declaration(node);
      if (!isConst(decl) || !ts.isVariableDeclaration(decl) || seen.has(decl)) return null;
      return constant(decl.initializer, new Set([...seen, decl]));
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const left = constant(node.left, seen), right = constant(node.right, seen);
      return left !== null && right !== null ? left + right : null;
    }
    if (ts.isTemplateExpression(node)) {
      let result = node.head.text;
      for (const span of node.templateSpans) {
        const part = constant(span.expression, seen);
        if (part === null) return null;
        result += part + span.literal.text;
      }
      return result;
    }
    return null;
  }
  const key = (node) => { const value = constant(node); return value === null ? null : String(value); };
  function property(base, name, at) {
    if (!base) return null;
    if (name === null) {
      if (privileged(base)) unknownComputed.add(at);
      return null;
    }
    return [...base, name];
  }
  function binding(decl, seen) {
    if (!isConst(decl) || seen.has(decl)) return null;
    seen = new Set([...seen, decl]);
    if (ts.isVariableDeclaration(decl)) return path(decl.initializer, seen);
    const parent = decl.parent.parent;
    const base = ts.isBindingElement(parent) ? binding(parent, seen) : path(parent.initializer, seen);
    const name = decl.propertyName || decl.name;
    const propertyName = ts.isComputedPropertyName(name) ? key(name.expression) : ts.isIdentifier(name) || ts.isStringLiteralLike(name) ? name.text : null;
    return property(base, propertyName, decl);
  }
  function path(node, seen = new Set()) {
    node = unwrap(node);
    if (!node) return null;
    if (ts.isIdentifier(node)) {
      const symbol = checker.getSymbolAtLocation(node);
      // TypeScript supplies intrinsic globalThis even with noLib. Only real
      // declarations represent local/imported shadowing in this isolated AST.
      if (symbol?.declarations?.length) return binding(declaration(node), seen);
      if (GLOBALS.has(node.text)) return [ROOT];
      return APIS.has(node.text) ? [ROOT, node.text] : null;
    }
    if (ts.isPropertyAccessExpression(node)) return property(path(node.expression, seen), node.name.text, node);
    if (ts.isElementAccessExpression(node)) return property(path(node.expression, seen), key(node.argumentExpression), node);
    return null;
  }
  function reference(node) {
    const parent = node.parent;
    if (!parent) return true;
    if (ts.isPropertyAccessExpression(parent) && parent.name === node) return false;
    if (parent.name === node && !ts.isShorthandPropertyAssignment(parent)) return false;
    if ((ts.isImportSpecifier(parent) || ts.isExportSpecifier(parent) || ts.isBindingElement(parent)) && parent.propertyName === node) return false;
    return !ts.isJsxAttribute(parent);
  }
  function observe(resolved) {
    if (!resolved || resolved[0] !== ROOT) return;
    if (APIS.has(resolved[1]) && resolved[1] !== "require") effects.add(resolved[1]);
    if (["chrome", "browser"].includes(resolved[1]) && resolved.slice(2).includes("registerContentScripts")) effects.add("registerContentScripts");
  }
  function reviewedMainForward(call) {
    const expression = unwrap(call.expression);
    if (!ts.isPropertyAccessExpression(expression) || expression.name.text !== "apply" ||
        !ts.isIdentifier(expression.expression) || expression.expression.text !== "original" || call.arguments.length !== 2 ||
        call.arguments[0].kind !== ts.SyntaxKind.ThisKeyword || !ts.isIdentifier(call.arguments[1])) return false;
    const original = declaration(expression.expression);
    if (!original || !isConst(original) || !ts.isVariableDeclaration(original)) return false;
    let wrapper = call.parent;
    while (wrapper && !ts.isFunctionLike(wrapper)) wrapper = wrapper.parent;
    const args = declaration(call.arguments[1]);
    return wrapper && ts.isFunctionExpression(wrapper) && wrapper.name?.text === "translateFlowYouTubeFetchWrapper" &&
      args && ts.isParameter(args) && args.parent === wrapper && args.dotDotDotToken &&
      original.parent.parent.parent && ts.isFunctionDeclaration(original.parent.parent.parent.parent) &&
      original.parent.parent.parent.parent.name?.text === "installFetch";
  }
  function visit(node) {
    if (ts.isIdentifier(node) && reference(node) || ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) observe(path(node));
    if (ts.isBindingElement(node)) observe(binding(node, new Set()));
    if (ts.isCallExpression(node)) {
      const resolved = path(node.expression);
      if (resolved?.[0] === ROOT && resolved[1] === "fetch" && !reviewedMainForward(node)) fetchCalls.add(node);
      // Passing fetch to Reflect.apply or another callback also delegates a
      // request capability. The reviewed original.apply(this,args) forwarder
      // passes only this/args, so its exact exception remains unchanged.
      if (node.arguments.some((argument) => {
        const value = path(argument);
        return value?.[0] === ROOT && value[1] === "fetch";
      })) fetchCalls.add(node);
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  return { effects, unknownComputed, fetchCalls,
    moduleLoader: (expression) => { const resolved = path(expression); return resolved?.[0] === ROOT && resolved.length === 2 && resolved[1] === "require"; }
  };
}

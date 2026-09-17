// Small AST queries for responsibility boundaries.
//
// These helpers intentionally expose imports, calls, construction and literal
// comparisons as semantic facts. They do not expose class-member names or
// exact property paths, so implementation renames and harmless reflow do not
// become architecture failures.

import { readFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

function scriptKindFor(filePath) {
  switch (path.extname(filePath)) {
    case ".tsx":
      return ts.ScriptKind.TSX;
    case ".ts":
      return ts.ScriptKind.TS;
    case ".jsx":
      return ts.ScriptKind.JSX;
    default:
      return ts.ScriptKind.JS;
  }
}

export async function loadModule(filePath) {
  return parseModule(filePath, await readFile(filePath, "utf8"));
}

export function parseModule(filePath, text) {
  return {
    filePath,
    text,
    sourceFile: ts.createSourceFile(
      filePath,
      text,
      ts.ScriptTarget.Latest,
      true,
      scriptKindFor(filePath),
    ),
  };
}

function visit(node, callback) {
  callback(node);
  node.forEachChild((child) => visit(child, callback));
}

function eachNode(handle, callback) {
  visit(handle.sourceFile, callback);
}

function expressionPath(node) {
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isPrivateIdentifier(node)) return node.text;
  if (node.kind === ts.SyntaxKind.ThisKeyword) return "this";
  if (ts.isParenthesizedExpression(node) || ts.isNonNullExpression(node)) {
    return expressionPath(node.expression);
  }
  if (ts.isPropertyAccessExpression(node)) {
    const left = expressionPath(node.expression);
    return left === null ? null : `${left}.${node.name.text}`;
  }
  return null;
}

export function moduleSpecifiers(handle) {
  const values = [];
  eachNode(handle, (node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
      && node.moduleSpecifier
      && ts.isStringLiteral(node.moduleSpecifier)
    ) {
      values.push(node.moduleSpecifier.text);
    }
    if (
      ts.isCallExpression(node)
      && node.expression.kind === ts.SyntaxKind.ImportKeyword
      && node.arguments[0]
      && ts.isStringLiteral(node.arguments[0])
    ) {
      values.push(node.arguments[0].text);
    }
  });
  return [...new Set(values)];
}

export function importBindings(handle) {
  const bindings = [];
  eachNode(handle, (node) => {
    if (
      !ts.isImportDeclaration(node)
      || !node.importClause
      || !ts.isStringLiteral(node.moduleSpecifier)
    ) return;
    const source = node.moduleSpecifier.text;
    if (node.importClause.name) {
      bindings.push({ source, imported: "default", local: node.importClause.name.text, kind: "default" });
    }
    const named = node.importClause.namedBindings;
    if (named && ts.isNamespaceImport(named)) {
      bindings.push({ source, imported: "*", local: named.name.text, kind: "namespace" });
    }
    if (named && ts.isNamedImports(named)) {
      for (const element of named.elements) {
        bindings.push({
          source,
          imported: element.propertyName?.text || element.name.text,
          local: element.name.text,
          kind: "named",
        });
      }
    }
  });
  return bindings;
}

export function syntaxErrors(handle) {
  return handle.sourceFile.parseDiagnostics.map((diagnostic) => {
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, " ");
    if (typeof diagnostic.start !== "number") return message;
    const position = handle.sourceFile.getLineAndCharacterOfPosition(diagnostic.start);
    return `${position.line + 1}:${position.character + 1} ${message}`;
  });
}

export function importsModule(handle, specifier) {
  return moduleSpecifiers(handle).includes(specifier);
}

function argumentKind(argument) {
  if (argument.kind === ts.SyntaxKind.NullKeyword) return "null";
  if (ts.isObjectLiteralExpression(argument)) return "object";
  if (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument)) return "string";
  if (ts.isTemplateExpression(argument)) return "template";
  return "other";
}

export function callExpressions(handle) {
  const values = [];
  eachNode(handle, (node) => {
    if (!ts.isCallExpression(node)) return;
    const pathName = expressionPath(node.expression);
    if (!pathName) return;
    values.push({
      path: pathName,
      args: node.arguments.map((argument) => {
        if (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument)) {
          return argument.text;
        }
        if (ts.isTemplateExpression(argument)) return argument.head.text;
        return null;
      }),
      argKinds: node.arguments.map((argument) => argumentKind(argument)),
    });
  });
  return values;
}

export function jsxElementNames(handle) {
  const values = [];
  eachNode(handle, (node) => {
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node))
      && ts.isIdentifier(node.tagName)
    ) {
      values.push(node.tagName.text);
    }
  });
  return values;
}

export function callNames(handle) {
  return callExpressions(handle).map((call) => call.path.split(".").at(-1));
}

export function hasCallName(handle, name) {
  return callNames(handle).includes(name);
}

export function memberAccesses(handle) {
  const values = [];
  eachNode(handle, (node) => {
    if (!ts.isPropertyAccessExpression(node)) return;
    const pathName = expressionPath(node);
    if (pathName) values.push(pathName);
  });
  return values;
}

export function newExpressionNames(handle) {
  const values = [];
  eachNode(handle, (node) => {
    if (!ts.isNewExpression(node)) return;
    const pathName = expressionPath(node.expression);
    if (pathName) values.push(pathName.split(".").at(-1));
  });
  return values;
}

export function stringLiterals(handle) {
  const values = [];
  eachNode(handle, (node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      values.push(node.text);
    }
  });
  return values;
}

export function hasIdentifier(handle, name) {
  let found = false;
  eachNode(handle, (node) => {
    if (found) return;
    if (ts.isIdentifier(node) && node.text === name) found = true;
  });
  return found;
}

export function hasLiteralComparison(handle, { literals = [], propertyNames = [] } = {}) {
  const allowed = new Set(literals);
  const propertySet = new Set(propertyNames);
  let found = false;
  eachNode(handle, (node) => {
    if (found || !ts.isBinaryExpression(node)) return;
    const operator = node.operatorToken.kind;
    if (![ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken,
      ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken]
      .includes(operator)) return;
    const sides = [node.left, node.right];
    const literal = sides.find((side) => ts.isStringLiteral(side));
    const other = sides.find((side) => side !== literal);
    const otherPath = other ? expressionPath(other) : null;
    if (literal && otherPath && allowed.has(literal.text)
      && propertySet.has(otherPath.split(".").at(-1))) found = true;
  });
  return found;
}

export function hasFilesystemWrite(handle) {
  const imports = moduleSpecifiers(handle);
  if (!imports.some((specifier) => /^node:fs(?:\/promises)?$/u.test(specifier))) return false;
  const writerNames = new Set([
    "appendFile",
    "appendFileSync",
    "createWriteStream",
    "mkdir",
    "mkdirSync",
    "rename",
    "renameSync",
    "rm",
    "rmSync",
    "unlink",
    "unlinkSync",
    "writeFile",
    "writeFileSync",
  ]);
  const calls = callExpressions(handle).map((call) => call.path);
  const bindings = importBindings(handle)
    .filter((binding) => /^node:fs(?:\/promises)?$/u.test(binding.source));
  if (bindings.some((binding) => {
    if (binding.kind === "named") {
      return writerNames.has(binding.imported) && calls.includes(binding.local);
    }
    return calls.some((call) => (
      call.startsWith(`${binding.local}.`)
      && writerNames.has(call.split(".").at(-1))
    ));
  })) return true;
  return callNames(handle).some((name) => writerNames.has(name));
}

export const REACT_HOOKS = [
  "useState",
  "useEffect",
  "useLayoutEffect",
  "useRef",
  "useCallback",
  "useMemo",
  "useReducer",
  "useContext",
  "useImperativeHandle",
  "useInsertionEffect",
  "useSyncExternalStore",
  "useTransition",
  "useDeferredValue",
];

export function countReactHooks(handle) {
  const names = callNames(handle);
  return REACT_HOOKS.reduce((total, hook) => total + names.filter((name) => name === hook).length, 0);
}

// Persisted filesystem observations may be refreshed, but must never feed a
// physical equality gate. Follow local aliases so reformatting/renaming does
// not hide the dependency; behavioral restart tests cover the public outcome.
export function persistentFileIdentityComparisons(handle) {
  const observationNames = new Set(["fileIdentity", "rootFileIdentity", "preparedWorkingCopyFileIdentity"]);
  const aliases = new Set();
  const comparators = new Set(["sameFileIdentity"]);
  eachNode(handle, (node) => {
    if (ts.isImportSpecifier(node) && node.propertyName?.text === "sameFileIdentity") comparators.add(node.name.text);
  });
  function persisted(node) {
    if (!node) return false;
    if (ts.isIdentifier(node) && aliases.has(node.text)) return true;
    if (ts.isPropertyAccessExpression(node) && observationNames.has(node.name.text)) return true;
    if (ts.isElementAccessExpression(node) && ts.isStringLiteral(node.argumentExpression)
      && observationNames.has(node.argumentExpression.text)) return true;
    let result = false;
    node.forEachChild((child) => { if (persisted(child)) result = true; });
    return result;
  }
  let changed = true;
  while (changed) {
    changed = false;
    eachNode(handle, (node) => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)
        && !aliases.has(node.name.text) && persisted(node.initializer)) {
        aliases.add(node.name.text); changed = true;
      }
      if (ts.isBindingElement(node) && ts.isIdentifier(node.name)
        && observationNames.has(node.propertyName?.getText(handle.sourceFile) || node.name.text)
        && !aliases.has(node.name.text)) {
        aliases.add(node.name.text); changed = true;
      }
    });
  }
  const violations = [];
  eachNode(handle, (node) => {
    if (ts.isCallExpression(node) && comparators.has(expressionPath(node.expression))
      && node.arguments.some(persisted)) {
      violations.push("persisted fileIdentity cannot authorize physical identity equality; compare live observations only");
    }
  });
  return violations;
}

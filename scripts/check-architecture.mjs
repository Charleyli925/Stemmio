#!/usr/bin/env node

import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  callExpressions,
  callNames,
  countReactHooks,
  hasFilesystemWrite,
  hasIdentifier,
  hasLiteralComparison,
  importBindings,
  memberAccesses,
  moduleSpecifiers,
  newExpressionNames,
  parseModule,
  persistentFileIdentityComparisons,
  stringLiterals,
  syntaxErrors,
} from "./architecture-ast-query.mjs";
import {
  loadNoticeLedger,
  noticeInventoryViolations,
  noticePolicyViolations,
} from "./notice-policy.mjs";

const PRODUCT_ROOT = fileURLToPath(new URL("../", import.meta.url));
const SOURCE_EXTENSIONS = new Set([".js", ".mjs", ".ts", ".tsx"]);
const REQUIRED_SOURCE_ROOTS = Object.freeze(["app", "bridge", "scripts", "desktop", "shared"]);
const DEFAULT_IO = Object.freeze({ readdir, readFile, stat });
const COMPOSITION_ROOT = "app/application/workspace-controller.js";
const LOCAL_PRESENTATION_RUNTIME_OWNERS = new Set([
  "ReviewAnalysisSession",
  "CanvasSnapshotSession",
  "RuntimeCanvasResidencySession",
  "WorkspacePreferencesSession",
]);
const RUNTIME_OWNERS = new Set([
  "ProjectSession",
  "DocumentSession",
  "CommentSession",
  "DraftSession",
  "VersionSession",
  "SourceHistorySession",
  "RunSession",
  "ProjectRulesSession",
  "ExternalFileOpenSession",
  "ProjectApplicationSession",
  "EditAuthorRuntimeSession",
  "WorkbenchTabsSession",
  "WorkbenchNavigationSession",
  "WorkbenchTabsPersistenceCoordinator",
  "ConversationSession",
  "DocumentSurfaceCacheSession",
  "ProjectWorkflow",
  "DocumentWorkflow",
  "CommentWorkflow",
  "ProjectRulesWorkflow",
  "RunWorkflow",
  "VersionWorkflow",
  "ConversationWorkflow",
  "WorkbenchNavigationWorkflow",
]);
const RETIRED_MODULES = new Set([
  "app/components/NativeEditingController.ts",
  "app/lib/format-skeleton.js",
  "app/lib/native-block-edit-draft.js",
  "app/lib/native-edit-transaction.js",
  "app/lib/native-input-intent.js",
  "app/lib/native-structural-edit-planner.js",
  "app/application/browser-document-session.js",
  "app/application/browser-file-tab-identity.js",
  "app/application/runtime-capabilities.js",
  "app/workbench/ReviewAnalysisPrewarm.tsx",
  "app/workbench/WorkbenchDocumentCanvasPool.tsx",
  "app/workbench/use-runtime-canvas-residency.ts",
  "app/lib/version-audit-records.js",
]);
const RETIRED_IMPORT_NAMES = new Set([
  "NativeEditingController",
  "format-skeleton",
  "native-block-edit-draft",
  "native-edit-transaction",
  "native-input-intent",
  "native-structural-edit-planner",
  "browser-document-session",
  "browser-file-tab-identity",
  "runtime-capabilities",
  "ReviewAnalysisPrewarm",
  "WorkbenchDocumentCanvasPool",
  "use-runtime-canvas-residency",
  "version-audit-records",
]);
const RETIRED_PRODUCTION_LITERALS = new Set([
  ["", "source-history", "action"].join("/"),
  ["source-history", "v1"].join("."),
  ["source-history", "v1", "schema", "json"].join("."),
]);
const RETIRED_COMPAT_IDENTIFIERS = new Set([
  "commitPendingEdit",
  "fencePendingEdit",
  "checkpointPendingEdit",
  "baseVersionId",
  "capturedRevision",
  "editEvents",
  "editEventIds",
]);
const SOURCE_NODE_ID_LITERAL = ["data", "html", "ai", "source", "node", "id"].join("-");
const SOURCE_NODE_ID_ALLOWED_FILES = new Set([
  ["app", "lib", "source-index.js"].join("/"),
  ["app", "components", "IslandEditingController.ts"].join("/"),
  ["shared", "editable-island.mjs"].join("/"),
]);
const REVIEW_SOURCE_NODE_ID_LITERAL = ["data", "stemmio", "review", "source", "node", "id"].join("-");
const PARSE_KEY_PATTERN_SOURCE = ["element", ":\\d+", ":\\d+", ":"].join("");
const PARSE_KEY_ALLOWED_FILES = new Set([
  ["app", "lib", "source-index.js"].join("/"),
  ["app", "lib", "source-patch-core.js"].join("/"),
  ["app", "lib", "source-patch-engine.js"].join("/"),
  ["app", "lib", "target-resolver.js"].join("/"),
]);
const PAGE_VIEW_CONTEXT_FILE = ["app", "lib", "page-view-context.js"].join("/");
const DOCUMENT_WORKFLOW_FILE = ["app", "application", "document-workflow.js"].join("/");
const WORKBENCH_FILE = ["app", "workbench.tsx"].join("/");
const TEXT_FRAGMENT_HOST_LITERAL = ["stemmio", "text", "fragment"].join("-");
const PAGE_VIEW_CONTEXT_RETIRED_ADAPTERS =
  /\bdata-p\b|\bdata-tab\b|resolveDataLinkedTabAction|resolveIndexedHandlerTabAction|SIMPLE_INDEXED_TAB_HANDLER|LEGACY_TAB_/u;
const PROVIDER_LITERALS = ["qoder", "codex", "qoder-acp", "codex-acp"];
const RAW_ENDPOINTS = new Set([
  "/workspace",
  "/source",
  "/source-preview",
  "/source-stat",
  "/autosave",
  "/draft",
  "/request",
  "/attachment",
  "/status",
  "/version-file",
  "/project-file",
]);
const ALLOWED_SHOW_ERROR_BOX_TITLES = new Set([
  "源页启动失败",
]);
const ALLOWED_WINDOW_CONFIRM_PREFIXES = Object.freeze([
  "确定删除",
  "确定要用磁盘上的版本继续吗",
  "确定要用外部版本覆盖当前编辑吗",
  "重新载入会舍弃尚未写回的当前编辑内容",
  "成功导入后会将原文件移至废纸篓",
]);

const APPROVED_PERSISTENCE_OWNERS = new Set([
  "bridge/agent/agent-lease-store.mjs",
  "bridge/agent/catalog/agent-installer.mjs",
  "bridge/agent/hosts/execution-host.mjs",
  "bridge/agent/runtimes/http-runtime.mjs",
  "bridge/ai-task-projection.mjs",
  "bridge/lifecycle-core.mjs",
  "bridge/project-file-repository.mjs",
  "bridge/project-file-repository/current-draft.mjs",
  "bridge/project-file-repository/request-attachments.mjs",
  "bridge/project-file-repository/path-safety.mjs",
  "bridge/project-file-repository/source-binding.mjs",
  "bridge/project-file-repository/save-retirement.mjs",
  "bridge/project-file-repository/registry.mjs",
  "bridge/project-file-repository/working-copy.mjs",
  "bridge/workspace-bridge.mjs",
  "desktop/after-pack.mjs",
  "desktop/device-identity.mjs",
  "desktop/edit-runtime-library-store.mjs",
  "desktop/external-file-open.mjs",
  "desktop/main.mjs",
  "desktop/project-files.mjs",
  "desktop/recovery-journal-store.mjs",
  "desktop/agent-session-credential-store.mjs",
  "desktop/ui-preferences.mjs",
  "desktop/usage-telemetry.mjs",
  "desktop/workbench-tabs-state.mjs",
]);
const HOST_ONLY_SHARED_MODULES = new Set([
  "shared/project-storage-contract.mjs",
]);

async function sourceFiles(directory, { io = DEFAULT_IO, productRoot = PRODUCT_ROOT } = {}) {
  let entries;
  try {
    entries = await io.readdir(directory, { withFileTypes: true });
  } catch (error) {
    const target = relative(directory, productRoot) || ".";
    throw new Error(`cannot read architecture source directory ${target}: ${error.message}`, {
      cause: error,
    });
  }
  const nested = await Promise.all(entries.map(async (entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(absolute, { io, productRoot });
    return SOURCE_EXTENSIONS.has(path.extname(entry.name)) ? [absolute] : [];
  }));
  return nested.flat();
}

function validateLimitedInclude(value) {
  if (
    typeof value !== "string"
    || value.length === 0
    || path.isAbsolute(value)
    || value.split(/[\\/]/u).includes("..")
  ) {
    throw new Error(`limited scan include must be a relative path inside the root: ${value || "<missing>"}`);
  }
  return value.split(/[\\/]/u).filter(Boolean).join(path.sep);
}

async function sourceTargetFiles(target, { io, productRoot, required }) {
  let targetStat;
  try {
    targetStat = await io.stat(target);
  } catch (error) {
    const name = relative(target, productRoot) || ".";
    const prefix = required ? "required architecture source" : "limited architecture source";
    throw new Error(`${prefix} ${name} is unavailable: ${error.message}`, { cause: error });
  }
  if (targetStat.isDirectory()) return sourceFiles(target, { io, productRoot });
  if (targetStat.isFile()) {
    if (!SOURCE_EXTENSIONS.has(path.extname(target))) {
      throw new Error(`architecture source ${relative(target, productRoot)} has an unsupported extension`);
    }
    return [target];
  }
  throw new Error(`architecture source ${relative(target, productRoot)} is not a regular file or directory`);
}

export async function discoverSourceFiles({
  productRoot = PRODUCT_ROOT,
  scope = "full",
  includes = [],
  io = DEFAULT_IO,
} = {}) {
  const resolvedRoot = path.resolve(productRoot);
  let rootStat;
  try {
    rootStat = await io.stat(resolvedRoot);
  } catch (error) {
    throw new Error(`architecture root is unavailable: ${resolvedRoot}: ${error.message}`, { cause: error });
  }
  if (!rootStat.isDirectory()) {
    throw new Error(`architecture root must be a directory: ${resolvedRoot}`);
  }
  if (scope !== "full" && scope !== "limited") {
    throw new Error(`architecture scan scope must be "full" or "limited", received: ${scope}`);
  }
  if (scope === "full" && includes.length > 0) {
    throw new Error("--include is only valid with --scope limited");
  }
  if (scope === "limited" && includes.length === 0) {
    throw new Error("limited architecture scan requires at least one explicit --include path");
  }
  const roots = scope === "full"
    ? [...REQUIRED_SOURCE_ROOTS]
    : [...new Set(includes.map(validateLimitedInclude))];
  const files = [];
  for (const root of roots) {
    files.push(...await sourceTargetFiles(path.join(resolvedRoot, root), {
      io,
      productRoot: resolvedRoot,
      required: scope === "full",
    }));
  }
  const uniqueFiles = [...new Set(files.map((file) => path.resolve(file)))].sort();
  if (uniqueFiles.length === 0) {
    throw new Error(`architecture scan completed no work for ${scope} scope: ${roots.join(", ")}`);
  }
  return { productRoot: resolvedRoot, scope, roots, files: uniqueFiles };
}

function relative(filePath, productRoot = PRODUCT_ROOT) {
  return path.relative(productRoot, filePath).split(path.sep).join("/");
}

function isApplication(file) {
  return file.startsWith("app/application/");
}

function isRenderer(file) {
  return file === "app/workbench.tsx"
    || file.startsWith("app/workbench/")
    || file.startsWith("app/components/")
    || file === "app/page.tsx"
    || file === "app/layout.tsx";
}

function isBridgeClient(file) {
  return file === "app/application/bridge-client.js";
}

function isProviderWorkflow(file) {
  return /^app\/application\/(?:run|review|version)[^/]*\.(?:js|ts)$/u.test(file);
}

function presentationImport(specifier) {
  return /(?:^|\/)(?:workbench|components|desktop)(?:\/|$)/u.test(specifier)
    || /(?:^|\/)(?:page|layout)(?:\.[^/]*)?$/u.test(specifier);
}

function bridgeImport(specifier) {
  return /(?:^|\/)(?:bridge-client|bridge)(?:\.[^/]+)?(?:\/|$)/u.test(specifier);
}

function hasProviderImplementationImport(imports) {
  return imports.some((specifier) => /(?:^|\/)(?:qoder-provider)(?:\.[^/]*)?$/u.test(specifier));
}

function hostDependencyImport(specifier) {
  return specifier === "electron"
    || specifier.startsWith("electron/")
    || specifier.startsWith("node:")
    || specifier === "react"
    || specifier.startsWith("react/")
    || /(?:^|\/)(?:application|components|workbench|desktop|bridge)(?:\/|\.|$)/u.test(specifier);
}

function hostOnlySharedImport(specifier) {
  return /(?:^|\/)project-storage-contract(?:\.mjs)?$/u.test(specifier);
}

export function layerBoundaryViolations({ file = "", source = "", module = null } = {}) {
  const handle = module || parseModule(file || "fixture.js", source);
  const imports = moduleSpecifiers(handle);
  const violations = [];
  if (file.startsWith("app/domain/")) {
    for (const specifier of imports) {
      if (hostDependencyImport(specifier) || hostOnlySharedImport(specifier)) {
        violations.push(`${file}: domain code cannot import ${specifier}`);
      }
    }
  }
  if (isApplication(file)) {
    for (const specifier of imports) {
      if (specifier === "react" || specifier.startsWith("react/") || presentationImport(specifier)) {
        violations.push(`${file}: application code cannot import ${specifier}`);
      }
    }
  }
  if (isRenderer(file) && imports.some(bridgeImport)) {
    violations.push(`${file}: views cannot import the Bridge client`);
  }
  if (file.startsWith("app/") && imports.some(hostOnlySharedImport)) {
    violations.push(`${file}: renderer code cannot import host-only shared storage paths`);
  }
  if (file.startsWith("shared/") && !HOST_ONLY_SHARED_MODULES.has(file)) {
    for (const specifier of imports) {
      if (specifier === "electron" || specifier.startsWith("electron/") || specifier.startsWith("node:")) {
        violations.push(`${file}: cross-runtime shared code cannot import host module ${specifier}`);
      }
    }
  }
  if (file.startsWith("bridge/") || file.startsWith("scripts/")) {
    for (const specifier of imports) {
      if (/(?:^|\/)app\/(?:application|components|workbench)(?:\/|\.|$)/u.test(specifier)) {
        violations.push(`${file}: Bridge and build scripts cannot import renderer code`);
      }
    }
  }
  return violations;
}

export function ownershipBoundaryViolations({ file = "", source = "", module = null } = {}) {
  const handle = module || parseModule(file || "fixture.js", source);
  const violations = [];
  const aliases = new Map(importBindings(handle).map((binding) => [binding.local, binding.imported]));
  const constructions = newExpressionNames(handle)
    .map((name) => aliases.get(name) || name)
    .filter((name) => (
      (RUNTIME_OWNERS.has(name) || /(?:Session|Workflow)$/u.test(name))
      && !LOCAL_PRESENTATION_RUNTIME_OWNERS.has(name)
    ));
  if (constructions.length > 0 && file !== COMPOSITION_ROOT) {
    violations.push(`${file}: runtime Sessions and Workflows may only be constructed by the composition root`);
  }
  if (
    /^(?:app|bridge|desktop)\//u.test(file)
    && hasFilesystemWrite(handle)
    && !APPROVED_PERSISTENCE_OWNERS.has(file)
  ) {
    violations.push(`${file}: persistence writes belong to an approved repository or service owner`);
  }
  return violations;
}

export function escapeBoundaryViolations({ file = "", source = "", module = null } = {}) {
  const handle = module || parseModule(file || "fixture.js", source);
  const violations = [];
  const calls = callNames(handle);
  const imports = moduleSpecifiers(handle);
  if (isApplication(file) && !isBridgeClient(file) && calls.includes("fetch")) {
    violations.push(`${file}: raw fetch belongs to the typed Bridge client`);
  }
  if (isRenderer(file) && calls.includes("fetch")) {
    violations.push(`${file}: views cannot issue raw business requests`);
  }
  if (
    isApplication(file)
    && file !== "app/application/recovery-store.js"
    && file !== "app/lib/opaque-sandbox-storage.js"
    && (hasIdentifier(handle, "localStorage") || hasIdentifier(handle, "sessionStorage"))
  ) {
    violations.push(`${file}: browser persistence belongs to an approved recovery owner`);
  }
  if (isApplication(file) && !isBridgeClient(file)
    && stringLiterals(handle).some((value) => RAW_ENDPOINTS.has(value))) {
    violations.push(`${file}: Bridge endpoint knowledge belongs to the typed Bridge client`);
  }
  if (isApplication(file) && !isBridgeClient(file)
    && (calls.includes("executeCommand") || calls.includes("executeBridge"))) {
    violations.push(`${file}: generic Bridge command escapes are forbidden`);
  }
  if (isRenderer(file)
    && (calls.includes("createRuntimeBridgeClient")
      || memberAccesses(handle).some((value) => value.startsWith("bridgeClient.")))) {
    violations.push(`${file}: views cannot call the Bridge client`);
  }
  if (isProviderWorkflow(file)
    && (hasLiteralComparison(handle, { literals: PROVIDER_LITERALS, propertyNames: ["providerId", "mode"] })
      || hasProviderImplementationImport(imports))) {
    violations.push(`${file}: provider selection must use canonical delivery and descriptor data`);
  }
  return violations;
}

function callPathKind(pathName) {
  if (!pathName) return null;
  if (pathName === "window.confirm") {
    return "window.confirm";
  }
  if (pathName === "dialog.showErrorBox" || pathName.endsWith(".showErrorBox")) {
    return "showErrorBox";
  }
  if (pathName === "dialog.showMessageBox" || pathName.endsWith(".showMessageBox")) {
    return "showMessageBox";
  }
  return null;
}

export function dialogPolicyViolations({ file = "", source = "", module = null } = {}) {
  const handle = module || parseModule(file || "fixture.js", source);
  const violations = [];
  if (
    file.startsWith("tests/")
    || file.startsWith("scripts/")
    || file.startsWith(".codex-worktrees/")
  ) {
    return violations;
  }
  for (const call of callExpressions(handle)) {
    const kind = callPathKind(call.path);
    if (!kind) continue;
    if (kind === "showMessageBox") {
      violations.push(`${file}: ordinary showMessageBox is forbidden; keep only registered content-loss confirms`);
      continue;
    }
    if (kind === "showErrorBox") {
      const title = call.args[0];
      if (!title || !ALLOWED_SHOW_ERROR_BOX_TITLES.has(title)) {
        violations.push(`${file}: showErrorBox is forbidden except the registered startup failure`);
      }
      continue;
    }
    const prefix = call.args[0];
    if (
      typeof prefix !== "string"
      || !ALLOWED_WINDOW_CONFIRM_PREFIXES.some((allowed) => prefix.startsWith(allowed))
    ) {
      violations.push(`${file}: window.confirm is forbidden unless the copy is a registered delete/overwrite/abandon confirm`);
    }
  }
  return violations;
}

export { noticePolicyViolations, noticeInventoryViolations } from "./notice-policy.mjs";

export function retiredArtifactViolations({ file = "", source = "", module = null } = {}) {
  const handle = module || parseModule(file || "fixture.js", source);
  const violations = [];
  if (RETIRED_MODULES.has(file)) {
    violations.push(`${file}: retired production modules cannot return`);
  }
  for (const name of RETIRED_COMPAT_IDENTIFIERS) {
    if (hasIdentifier(handle, name)) {
      violations.push(
        `${file}: retired compatibility identifier ${name} cannot return`,
      );
    }
  }
  for (const specifier of moduleSpecifiers(handle)) {
    const basename = path.posix.basename(specifier).replace(/\.[^.]+$/u, "");
    if (RETIRED_IMPORT_NAMES.has(basename)) {
      violations.push(`${file}: production code cannot import retired module ${specifier}`);
    }
  }
  for (const literal of stringLiterals(handle)) {
    if (RETIRED_PRODUCTION_LITERALS.has(literal)) {
      violations.push(`${file}: retired source-history compatibility literal cannot return`);
    }
    if (literal === SOURCE_NODE_ID_LITERAL && !SOURCE_NODE_ID_ALLOWED_FILES.has(file)) {
      violations.push(
        `${file}: Source Node ID cannot leave source-index internals or Runtime DOM`,
      );
    }
    if (literal === REVIEW_SOURCE_NODE_ID_LITERAL) {
      violations.push(
        `${file}: Review cannot write parseKey identity onto source HTML`,
      );
    }
  }
  if (hasIdentifier(handle, "instrumentPreviewHtml")) {
    violations.push(
      `${file}: instrumentPreviewHtml cannot return; parseKey must not be written onto DOM`,
    );
  }
  if (hasIdentifier(handle, "resolveFromPreview")) {
    violations.push(
      `${file}: resolveFromPreview cannot return; preview parseKey is not an edit authority`,
    );
  }
  if (hasIdentifier(handle, "liveExactCommandTarget")) {
    violations.push(
      `${file}: liveExactCommandTarget cannot return; SourcePatch authorizes only by Stable ID`,
    );
  }
  if (hasIdentifier(handle, "planDirectTextNodePatch")) {
    violations.push(
      `${file}: planDirectTextNodePatch cannot return; text edits use replace-editable-island`,
    );
  }
  if (hasIdentifier(handle, "mountNativeTextFragmentHost")) {
    violations.push(
      `${file}: disposable text-fragment hosts cannot return`,
    );
  }
  if (source.includes(TEXT_FRAGMENT_HOST_LITERAL)) {
    violations.push(
      `${file}: disposable text-fragment hosts cannot return`,
    );
  }
  if (file === WORKBENCH_FILE && hasIdentifier(handle, "HtmlDisplaySurface")) {
    violations.push(
      `${file}: Workbench cannot replace the live editor with HtmlDisplaySurface`,
    );
  }
  if (
    file === DOCUMENT_WORKFLOW_FILE
    && (
      hasIdentifier(handle, "recoveryStore")
      || source.includes("stemmio-recovery")
    )
  ) {
    violations.push(
      `${file}: document HTML recovery is Main journal only`,
    );
  }
  if (
    !PARSE_KEY_ALLOWED_FILES.has(file)
    && source.includes(PARSE_KEY_PATTERN_SOURCE)
  ) {
    violations.push(
      `${file}: parseKey cannot leave source-index/source-patch`,
    );
  }
  if (
    file === PAGE_VIEW_CONTEXT_FILE
    && PAGE_VIEW_CONTEXT_RETIRED_ADAPTERS.test(source)
  ) {
    violations.push(`${file}: retired page-view tab adapters cannot return`);
  }
  return violations;
}

export function providerNeutralRendererViolations(input = {}) {
  return escapeBoundaryViolations(input);
}

// Compatibility wrapper for focused callers. It delegates to the four
// responsibility checks and intentionally does not inspect implementation
// member names or ordered call text.
export function compositionBoundaryViolations({
  workbench = "",
  workspaceController = "",
  applicationSources = [],
} = {}) {
  return [
    ...layerBoundaryViolations({ file: "app/workbench.tsx", source: workbench }),
    ...ownershipBoundaryViolations({ file: "app/workbench.tsx", source: workbench }),
    ...escapeBoundaryViolations({ file: "app/workbench.tsx", source: workbench }),
    ...layerBoundaryViolations({ file: COMPOSITION_ROOT, source: workspaceController }),
    ...ownershipBoundaryViolations({ file: COMPOSITION_ROOT, source: workspaceController }),
    ...escapeBoundaryViolations({ file: COMPOSITION_ROOT, source: workspaceController }),
    ...applicationSources.flatMap(({ file, source }) => [
      ...layerBoundaryViolations({ file, source }),
      ...ownershipBoundaryViolations({ file, source }),
      ...escapeBoundaryViolations({ file, source }),
    ]),
  ];
}

export async function architectureScan({
  productRoot = PRODUCT_ROOT,
  scope = "full",
  includes = [],
  io = DEFAULT_IO,
} = {}) {
  const discovery = await discoverSourceFiles({ productRoot, scope, includes, io });
  const useRepositoryLedgers = scope === "full"
    && discovery.productRoot === path.resolve(PRODUCT_ROOT);
  const ledger = useRepositoryLedgers ? await loadNoticeLedger() : null;
  const scanned = [];
  const violations = [];
  for (const filePath of discovery.files) {
    const file = relative(filePath, discovery.productRoot);
    let source;
    try {
      source = await io.readFile(filePath, "utf8");
    } catch (error) {
      throw new Error(`cannot read architecture source file ${file}: ${error.message}`, { cause: error });
    }
    const ast = parseModule(filePath, source);
    scanned.push({ file, source, module: ast });
    violations.push(...syntaxErrors(ast).map((reason) => `${file}: parse error ${reason}`));
    if (file.startsWith("bridge/project-file-repository")) {
      violations.push(...persistentFileIdentityComparisons(ast).map((reason) => `${file}: ${reason}`));
    }
    violations.push(...layerBoundaryViolations({ file, source, module: ast }));
    violations.push(...ownershipBoundaryViolations({ file, source, module: ast }));
    violations.push(...escapeBoundaryViolations({ file, source, module: ast }));
    violations.push(...retiredArtifactViolations({ file, source, module: ast }));
    violations.push(...dialogPolicyViolations({ file, source, module: ast }));
    if (useRepositoryLedgers) {
      violations.push(...noticePolicyViolations({ file, source, module: ast, ledger }));
    }
  }
  if (useRepositoryLedgers) {
    violations.push(...await noticeInventoryViolations(scanned, ledger));
  }
  return {
    ...discovery,
    scannedCount: discovery.files.length,
    violations: [...new Set(violations)].sort(),
  };
}

export async function architectureViolations(options = {}) {
  return (await architectureScan(options)).violations;
}

export async function budgetFindings({ productRoot = PRODUCT_ROOT } = {}) {
  const budgetPath = path.join(productRoot, "scripts", "architecture-budget.json");
  let budget;
  try {
    budget = JSON.parse(await readFile(budgetPath, "utf8"));
  } catch {
    return { violations: ["scripts/architecture-budget.json: missing or invalid JSON"], hints: [] };
  }
  const violations = [];
  const hints = [];
  for (const [relPath, limits] of Object.entries(budget.files ?? {})) {
    const source = await readFile(path.join(productRoot, relPath), "utf8");
    const handle = parseModule(path.join(productRoot, relPath), source);
    for (const [metric, ceiling] of Object.entries(limits)) {
      const actual = metric === "maxLines"
        ? source.split("\n").length
        : metric === "maxHooks"
          ? countReactHooks(handle)
          : null;
      if (actual === null) {
        violations.push(`scripts/architecture-budget.json: unknown metric "${metric}" for ${relPath}`);
      } else if (actual > ceiling) {
        violations.push(`${relPath}: ${metric} ${actual} exceeds budget ${ceiling} (+${actual - ceiling})`);
      } else if (actual < ceiling) {
        hints.push(`${relPath}: ${metric} is ${actual}, under budget ${ceiling}; lower it to ${actual} to keep the ratchet tight.`);
      }
    }
  }
  return { violations, hints };
}

export function parseArchitectureCliArgs(args) {
  let productRoot = PRODUCT_ROOT;
  let scope = "full";
  const includes = [];
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument !== "--root" && argument !== "--scope" && argument !== "--include") {
      throw new Error(`unknown architecture check argument: ${argument}`);
    }
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`${argument} requires a value`);
    }
    index += 1;
    if (argument === "--root") productRoot = path.resolve(value);
    if (argument === "--scope") scope = value;
    if (argument === "--include") includes.push(value);
  }
  return { productRoot, scope, includes };
}

async function runCli() {
  try {
    const options = parseArchitectureCliArgs(process.argv.slice(2));
    const result = await architectureScan(options);
    const summary = `${result.scannedCount} source files across ${result.scope} scope: ${result.roots.join(", ")}`;
    if (result.violations.length > 0) {
      process.stderr.write(`Architecture contract failed after scanning ${summary}:\n- ${result.violations.join("\n- ")}\n`);
      process.exitCode = 1;
    } else {
      process.stdout.write(`Architecture contract passed. Scanned ${summary}.\n`);
    }
    if (result.scope === "full") {
      const { violations: budgetViolations, hints } = await budgetFindings({
        productRoot: result.productRoot,
      });
      const notices = [...budgetViolations, ...hints];
      if (notices.length > 0) process.stdout.write(`Budget advisory:\n- ${notices.join("\n- ")}\n`);
    }
  } catch (error) {
    process.stderr.write(`Architecture check could not complete: ${error.message}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await runCli();
}

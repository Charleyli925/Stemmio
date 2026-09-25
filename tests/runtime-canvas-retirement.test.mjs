import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

test("the Workbench owns one active Runtime Canvas and the cache remains data-only", () => {
  const workbench = readFileSync(new URL("../app/workbench.tsx", import.meta.url), "utf8");
  const preparation = readFileSync(
    new URL("../app/workbench/use-edit-runtime-preparation.ts", import.meta.url),
    "utf8",
  );
  const activeHost = readFileSync(
    new URL("../app/workbench/WorkbenchActiveDocumentCanvas.tsx", import.meta.url),
    "utf8",
  );
  const presentation = readFileSync(
    new URL("../app/workbench/document-surface-presentation.ts", import.meta.url),
    "utf8",
  );
  const sandbox = readFileSync(
    new URL("../app/components/html-preview-sandbox.js", import.meta.url),
    "utf8",
  );
  const retired = {
    cacheFile: ["WorkbenchDocumentSurface", "Cache.tsx"].join(""),
    cacheCss: ["workbench-document-surface", "-cache.module.css"].join(""),
    displayFile: ["HtmlDisplay", "Surface.tsx"].join(""),
    displayCss: ["HtmlDisplay", "Surface.module.css"].join(""),
    displayComponent: ["HtmlDisplay", "Surface"].join(""),
    canvasPool: ["WorkbenchDocumentCanvas", "Pool"].join(""),
    canvasResidency: ["useRuntimeCanvas", "Residency"].join(""),
    handoffHook: ["useDocumentSurface", "Handoff"].join(""),
    handoffToken: ["DocumentSurfaceHandoff", "Token"].join(""),
    handoffTokenCompare: ["sameDocumentSurfaceHandoff", "Token"].join(""),
    cacheTokenCallback: ["updatePresentation", "ForToken"].join(""),
    cachedTabFlag: ["e2eCachedTab", "Handoff"].join(""),
    passthroughProp: ["cachedSurfaceInteraction", "Passthrough"].join(""),
    surfaceRoleAttribute: ["data-surface", "-role"].join(""),
    visibleHandoffAttribute: ["data-visible", "-handoff"].join(""),
    enabledState: ["cachedTabHandoff", "Enabled"].join(""),
    visibleSurface: ["visibleCached", "Surface"].join(""),
    blocksCanvas: ["cachedSurface", "BlocksCanvas"].join(""),
    scrollableSanitizer: ["sanitizeScrollableDisplay", "Document"].join(""),
    displayPolicy: ["data-stemmio-display", "-policy"].join(""),
  };

  for (const file of [
    `../app/workbench/${retired.cacheFile}`,
    `../app/workbench/${retired.cacheCss}`,
    `../app/components/${retired.displayFile}`,
    `../app/components/${retired.displayCss}`,
    `../app/workbench/${retired.canvasPool}.tsx`,
    `../app/workbench/${retired.canvasResidency}.ts`,
  ]) {
    assert.equal(existsSync(new URL(file, import.meta.url)), false, `retired file remains: ${file}`);
  }

  assert.doesNotMatch(workbench, new RegExp(`${retired.canvasPool}|${retired.canvasResidency}`, "u"));
  assert.doesNotMatch(workbench, new RegExp(`${retired.displayComponent}|${retired.handoffHook}|${retired.handoffToken}|${retired.cachedTabFlag}`, "u"));
  assert.doesNotMatch(workbench, new RegExp(`${retired.passthroughProp}|${retired.surfaceRoleAttribute}|${retired.visibleHandoffAttribute}`, "u"));
  assert.match(workbench, /data-testid="workbench-active-document-canvas"/u);
  assert.match(workbench, /data-runtime-hot-limit=\{1\}/u);
  assert.match(workbench, /<WorkbenchActiveDocumentCanvas/u);
  assert.match(workbench, /<HtmlCanvasEditor/u);
  assert.match(workbench, /key=\{`editor-authority-\$\{documentRuntimeTabId \|\| "none"\}`\}/u);
  assert.match(workbench, /rememberActiveDocumentPresentation|restoreCachedDocumentPresentation/u);
  assert.doesNotMatch(workbench, new RegExp(`${retired.enabledState}|${retired.visibleSurface}|${retired.blocksCanvas}`, "u"));

  assert.doesNotMatch(preparation, /\[\.\.\.|\.filter\(|\.slice\(/u);
  assert.doesNotMatch(preparation, new RegExp(`${retired.displayComponent}|${retired.cacheFile}`, "u"));

  assert.match(presentation, /export function rememberActiveDocumentPresentation/u);
  assert.match(presentation, /export function restoreCachedDocumentPresentation/u);
  assert.doesNotMatch(
    presentation,
    new RegExp(`${retired.handoffHook}|${retired.handoffToken}|${retired.handoffTokenCompare}|${retired.cacheTokenCallback}`, "u"),
  );
  assert.doesNotMatch(sandbox, new RegExp(`${retired.scrollableSanitizer}|${retired.displayPolicy}`, "u"));
  assert.match(sandbox, /export function sanitizePreviewDocument/u);

  assert.match(activeHost, /data-testid="workbench-active-document-canvas-host"/u);
  assert.match(activeHost, /data-runtime-hot-limit=\{2\}/u);
  assert.doesNotMatch(
    activeHost,
    /DOCUMENT_CANVAS_POOL_MINIMUM|retainedTabIds|\.map\(|\.slice\(/u,
  );
});

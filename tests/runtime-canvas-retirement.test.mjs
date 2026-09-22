import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { createSourceReceipt, sameSourceReceipt } from "../app/application/source-receipt.js";

test("the Workbench owns one active Runtime Canvas and no multi-tab pool", () => {
  const workbench = readFileSync(new URL("../app/workbench.tsx", import.meta.url), "utf8");
  const preparation = readFileSync(
    new URL("../app/workbench/use-edit-runtime-preparation.ts", import.meta.url),
    "utf8",
  );
  const activeHost = readFileSync(
    new URL("../app/workbench/WorkbenchActiveDocumentCanvas.tsx", import.meta.url),
    "utf8",
  );
  const handoff = readFileSync(
    new URL("../app/workbench/document-surface-presentation.ts", import.meta.url),
    "utf8",
  );
  const displaySurface = readFileSync(
    new URL("../app/components/HtmlDisplaySurface.tsx", import.meta.url),
    "utf8",
  );
  assert.equal(
    existsSync(new URL("../app/workbench/WorkbenchDocumentCanvasPool.tsx", import.meta.url)),
    false,
  );
  assert.equal(
    existsSync(new URL("../app/workbench/use-runtime-canvas-residency.ts", import.meta.url)),
    false,
  );
  assert.doesNotMatch(workbench, /WorkbenchDocumentCanvasPool|useRuntimeCanvasResidency/u);
  assert.match(workbench, /data-testid="workbench-active-document-canvas"/u);
  assert.match(workbench, /data-runtime-hot-limit=\{1\}/u);
  assert.match(workbench, /<WorkbenchActiveDocumentCanvas/u);
  assert.match(workbench, /<HtmlCanvasEditor/u);
  assert.match(
    workbench,
    /key=\{`editor-authority-\$\{documentRuntimeTabId \|\| "none"\}`\}/u,
  );
  assert.doesNotMatch(workbench, /editor-authority-\$\{documentRuntimeTabId[^}]*canvasGeneration/u);
  assert.doesNotMatch(preparation, /\[\.\.\.|\.filter\(|\.slice\(/u);
  assert.doesNotMatch(workbench, /editRuntimePreparing/u);
  assert.doesNotMatch(workbench, /HtmlDisplaySurface/u);
  assert.doesNotMatch(workbench, /cachedSurfaceInteractionPassthrough/u);
  assert.doesNotMatch(activeHost, /cloneElement/u);
  assert.doesNotMatch(handoff, /\bactiveCandidate\b/u);
  assert.match(handoff, /pendingHandoffToken/u);
  assert.match(handoff, /navigationTransactionId/u);
  assert.match(handoff, /sameDocumentSurfaceHandoffToken/u);
  assert.match(handoff, /sameSourceReceipt/u);
  assert.match(handoff, /eligibleCandidateRef/u);
  assert.match(handoff, /acceptDisplayReady/u);
  assert.match(handoff, /presentedHandoffToken/u);
  assert.match(handoff, /visibleHandoffId/u);
  assert.match(handoff, /sameDocumentSurfaceHandoffToken\(current, exactToken\)/u);
  assert.doesNotMatch(handoff, /completeHandoff|retainPresentedTab/u);
  assert.match(displaySurface, /const \{ resourceBase, ready \} = usePreviewResourceBase/u);
  assert.match(displaySurface, /\{frameHtml \? <iframe/u);
  assert.match(displaySurface, /handoffId: string/u);
  assert.match(displaySurface, /key=\{frameIdentity/u);
  assert.match(displaySurface, /onDisplayReady\?\.\(displayReadyToken\)/u);
  assert.match(activeHost, /data-testid="workbench-active-document-canvas-host"/u);
  assert.match(activeHost, /data-runtime-hot-limit=\{1\}/u);
  assert.doesNotMatch(
    activeHost,
    /DOCUMENT_CANVAS_POOL_MINIMUM|WorkbenchDocumentCanvasPool|retainedTabIds|\.map\(|\.slice\(/u,
  );
});


function compiledModuleUrl(source, fileName) {
  const compiled = ts.transpileModule(source, { fileName, compilerOptions: {
    module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  return `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`;
}

const presentationFile = new URL("../app/workbench/document-surface-presentation.ts", import.meta.url);
const projectModelUrl = compiledModuleUrl(readFileSync(
  new URL("../app/workbench/project-model.ts", import.meta.url), "utf8",
), "project-model.ts");
const presentationSource = readFileSync(presentationFile, "utf8").replace(
  /from "([^"]+)"/gu,
  (statement, specifier) => `from ${JSON.stringify(specifier === "./project-model"
    ? projectModelUrl
    : specifier.startsWith(".") ? new URL(specifier, presentationFile).href
      : import.meta.resolve(specifier))}`,
);
const { isSameActivationAuthoritySuccessor } = await import(
  compiledModuleUrl(presentationSource, "document-surface-presentation.ts"),
);

const sourceHash = `sha256:${"a".repeat(64)}`;
const initialReceipt = createSourceReceipt({
  sessionIncarnation: 3, sequence: 6, origin: "authority", operationId: "open",
  editRevision: 2, canvasGeneration: 4, sourceSha256: sourceHash,
  context: {
    epoch: 7, sessionEpoch: 7, projectId: "project_a", documentId: "document_a",
    sourcePath: "/private/tmp/project-a/page.html", projectRootPath: "/tmp/project-a",
    exactSourcePath: "/tmp/project-a/page.html", targetKind: "working-copy",
    workingCopyId: "work_a", versionId: "ver_a", sourceSha256: sourceHash,
  },
});
function successor(patch = {}, contextPatch = {}) {
  return createSourceReceipt({
    ...initialReceipt, sequence: 7, canvasGeneration: 5, editRevision: 3,
    operationId: "hydrate", ...patch,
    context: { ...initialReceipt.context, exactSourcePath: "/private/tmp/project-a/page.html", ...contextPatch },
  });
}

test("cache retirement recognizes a same-activation authority successor without weakening exact ACK", () => {
  const current = successor();
  assert.equal(sameSourceReceipt(current, initialReceipt), false);
  assert.equal(isSameActivationAuthoritySuccessor(current, initialReceipt), true);
  assert.equal(isSameActivationAuthoritySuccessor(initialReceipt, current), false);
  assert.equal(isSameActivationAuthoritySuccessor(initialReceipt, initialReceipt), false);
});

test("cache authority successor rejects stale, cross-target and different-source receipts", () => {
  for (const [label, patch, contextPatch] of [
    ["incarnation", { sessionIncarnation: 4 }],
    ["sequence", { sequence: 6 }],
    ["generation", { canvasGeneration: 4 }],
    ["revision", { editRevision: 1 }],
    ["local edit", { origin: "local-edit" }],
    ["history", { origin: "history" }],
    ["source", { sourceSha256: `sha256:${"b".repeat(64)}` }],
    ["epoch", {}, { epoch: 8 }],
    ["session epoch", {}, { sessionEpoch: 8 }],
    ["project", {}, { projectId: "project_b" }],
    ["document", {}, { documentId: "document_b" }],
    ["working copy", {}, { workingCopyId: "work_b" }],
    ["version", {}, { versionId: "ver_b" }],
    ["kind", {}, { targetKind: "version" }],
    ["source path", {}, { sourcePath: "/tmp/project-b/page.html" }],
    ["root path", {}, { projectRootPath: "/tmp/project-b" }],
    ["similar exact path", {}, { exactSourcePath: "/tmp/project-a-copy/page.html" }],
    ["context hash", {}, { sourceSha256: `sha256:${"b".repeat(64)}` }],
  ]) assert.equal(isSameActivationAuthoritySuccessor(successor(patch, contextPatch), initialReceipt), false, label);
  assert.equal(isSameActivationAuthoritySuccessor(null, initialReceipt), false);
  assert.equal(isSameActivationAuthoritySuccessor({ ...successor(), sequence: "7" }, initialReceipt), false);
});

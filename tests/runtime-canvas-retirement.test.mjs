import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

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
  assert.match(handoff, /pendingToken/u);
  assert.match(handoff, /sameSourceReceipt/u);
  assert.match(handoff, /eligibleCandidateRef/u);
  assert.match(displaySurface, /const \{ resourceBase, ready \} = usePreviewResourceBase/u);
  assert.match(displaySurface, /\{frameHtml \? <iframe/u);
  assert.match(displaySurface, /key=\{presentationKey/u);
  assert.match(activeHost, /data-testid="workbench-active-document-canvas-host"/u);
  assert.match(activeHost, /data-runtime-hot-limit=\{1\}/u);
  assert.doesNotMatch(
    activeHost,
    /DOCUMENT_CANVAS_POOL_MINIMUM|WorkbenchDocumentCanvasPool|retainedTabIds|\.map\(|\.slice\(/u,
  );
});

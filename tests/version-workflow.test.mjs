import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { CommentSession } from "../app/application/comment-session.js";
import { BridgeRequestError } from "../app/application/bridge-client.js";
import { DocumentSession } from "../app/application/document-session.js";
import { ProjectSession } from "../app/application/project-session.js";
import { RunSession } from "../app/application/run-session.js";
import { VersionSession } from "../app/application/version-session.js";
import { VersionWorkflow } from "../app/application/version-workflow.js";

import { loadWorkbenchModel } from "./helpers/workbench-model-loader.mjs";
const { versionsFromWorkspace, changesFromDraftRecords } = await loadWorkbenchModel("version-model");
const { commentsFromRecords } = await loadWorkbenchModel("comment-model");
const { draftAuthorityFromWorkspace } = await loadWorkbenchModel("record-model");
function decodedVersions(versions) {
  return versionsFromWorkspace({ versions, projectId: "project_a", documentId: "document_a" });
}

const SOURCE_A = "/tmp/version-workflow-a.html";
const SOURCE_B = "/tmp/version-workflow-b.html";
const BASE_HTML = "<!doctype html><html><body><p>base</p></body></html>";
const CANDIDATE_HTML = "<!doctype html><html><body><p>candidate</p></body></html>";
const HISTORY_HTML = "<!doctype html><html><body><p>history</p></body></html>";
const DRAINED_HTML = "<!doctype html><html><body><p>drained</p></body></html>";
const B_HTML = "<!doctype html><html><body><p>B</p></body></html>";
const HISTORY_WORKING_COPY_PATH = "/tmp/version-workflow-v2.html";

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function sameSourcePath(left, right) {
  return Boolean(left && right && String(left) === String(right));
}

function operationKey(run) {
  return [run.requestId, run.attemptId, run.sourcePath].join("::");
}

function versionRecord({
  id = "ver_0002",
  content = CANDIDATE_HTML,
  projectId = "project_a",
  documentId = "document_a",
} = {}) {
  return {
    schemaVersion: "4.0.0",
    versionId: id,
    ordinal: Number(id.slice(4)),
    sourceType: id === "ver_0001" ? "initial" : "internal-ai",
    projectId,
    documentId,
    contentSha256: sha256(content),
    generatedAt: "2026-08-12T00:00:00.000Z",
  };
}

function readyRun(overrides = {}) {
  const version = versionRecord();
  const candidateId = overrides.candidateId || "candidate_ready_0001";
  const sourceWorkingCopyId = overrides.sourceWorkingCopyId || "work_ver_0001";
  const readyPayloadOverrides = overrides.readyPayload || {};
  const runOverrides = { ...overrides };
  delete runOverrides.candidateId;
  delete runOverrides.readyPayload;
  const baseCandidate = {
    candidateId,
    projectId: "project_a",
    documentId: "document_a",
    requestId: "req_0001",
    attemptId: "attempt_001",
    sourceWorkingCopyId,
    proposedVersionId: version.versionId,
    proposedVersionOrdinal: 2,
    expectedSourceSha256: sha256(BASE_HTML),
    outputSha256: version.contentSha256,
    createdAt: "2026-08-12T00:00:01.000Z",
  };
  const baseReadyPayload = {
    projectId: "project_a",
    documentId: "document_a",
    requestId: "req_0001",
    attemptId: "attempt_001",
    candidateId,
    versionId: version.versionId,
    contentSha256: version.contentSha256,
    candidateDisplayVersionLabel: "版本 2",
    version,
    openTarget: {
      projectId: "project_a",
      documentId: "document_a",
      projectRootPath: "/tmp/project-a",
      targetKind: "working-copy",
      workingCopyId: sourceWorkingCopyId,
      versionId: "ver_0001",
      exactSourcePath: SOURCE_A,
      sourceSha256: sha256(BASE_HTML),
    },
    candidate: baseCandidate,
    completion: { completedAt: "2026-08-12T00:00:01.000Z" },
    outcome: {
      projectId: "project_a",
      documentId: "document_a",
      requestId: "req_0001",
      attemptId: "attempt_001",
      versionId: version.versionId,
      contentSha256: version.contentSha256,
      generatedAt: version.generatedAt,
    },
  };
  return {
    projectId: "project_a",
    documentId: "document_a",
    requestId: "req_0001",
    attemptId: "attempt_001",
    requestPath: "/tmp/req_0001",
    attemptPath: "/tmp/req_0001/attempt_001",
    handoffMessage: "request",
    status: "ready-to-open",
    sourcePath: SOURCE_A,
    sourceWorkingCopyId,
    baseSnapshotSha256: sha256(BASE_HTML),
    previousVersionId: "ver_0001",
    basedOnVersionId: "ver_0001",
    freezeCutoffRevision: 0,
    candidateVersionId: version.versionId,
    candidateVersionLabel: "版本 2",
    submittedAt: "2026-08-12T00:00:00.000Z",
    completionObserved: true,
    ...runOverrides,
    readyPayload: {
      ...baseReadyPayload,
      ...readyPayloadOverrides,
      candidateId: readyPayloadOverrides.candidateId || candidateId,
      candidate: {
        ...baseCandidate,
        ...(readyPayloadOverrides.candidate || {}),
      },
    },
  };
}

function promotedOpenTarget(input, {
  sourcePath = SOURCE_A,
  sourceSha256 = sha256(CANDIDATE_HTML),
  documentId = input.documentId,
  targetKind = "working-copy",
  versionId = input.versionId || input.candidateVersionId,
} = {}) {
  return {
    projectId: input.projectId,
    documentId,
    projectRootPath: "/tmp/project-a",
    targetKind,
    workingCopyId: "work_ver_0002",
    versionId,
    exactSourcePath: sourcePath,
    sourceSha256,
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

function createHarness({
  currentPath = SOURCE_A,
  versionRead = null,
  sourceRead = null,
  activation = null,
  createHistory = null,
  queryCreation = null,
  workspaceRead = null,
  confirmCreation = async () => ({}),
  verifyRendered = null,
  commitCurrentSurface = null,
  onDrain = null,
  observeExternalSourceChange = async () => ({ status: "succeeded" }),
  onCatalogAfterSettlement = null,
  prepareTransition = null,
  advanceSourceIdentity = false,
  currentDraft = false,
  createCurrent = null,
  queryCurrent = null,
  exportHtmlCopy = null,
  checkpointSource = null,
  hashSource = async (html) => sha256(html),
  sameSourcePathCodec = sameSourcePath,
} = {}) {
  const projectSession = new ProjectSession();
  const locator = projectSession.openLocator(currentPath);
  const projectId = currentPath === SOURCE_B ? "project_b" : "project_a";
  const documentId = currentPath === SOURCE_B ? "document_b" : "document_a";
  const context = projectSession.register({
    ...locator,
    projectId,
    documentId,
    ...(currentDraft ? { openTarget: { projectId, documentId, projectRootPath: "/tmp/project-a",
      targetKind: "working-copy", workingCopyId: "work_ver_0001", versionId: "ver_0001",
      exactSourcePath: currentPath, sourceSha256: sha256(BASE_HTML) } } : {}),
  });
  const initialHtml = currentPath === SOURCE_B ? B_HTML : BASE_HTML;
  const documentSession = new DocumentSession({
    html: initialHtml,
    persistedSourceSha256: sha256(initialHtml),
  });
  const versionSession = new VersionSession();
  versionSession.hydrate({
    versions: decodedVersions([versionRecord({ id: "ver_0001", content: BASE_HTML })]),
    latestVersionId: "ver_0001",
    currentBasedOnVersionId: "ver_0001",
    currentExactVersionId: "ver_0001",
  });
  const runSession = new RunSession({ sourcePath: SOURCE_A });
  const commentSession = new CommentSession();
  const calls = {
    createHistory: [],
    queryCreation: [],
    activate: 0,
    activateInputs: [],
    versionFile: [],
    source: [],
    drain: [],
    prepare: [],
    commit: [],
    refresh: [],
    render: [],
    currentSurface: [],
    invalidate: 0,
    unlock: 0,
    freeze: 0,
    clearRecovery: 0,
    pageRecovery: [],
    clearAudit: 0,
    resetComments: 0,
    queueDraft: 0,
    draftAuthorities: [],
    catalogAfterSettlement: [],
    verifiedExports: [],
    order: [],
  };
  const bridgeClient = {
    createVersionFromCurrent: (input) => createCurrent(input),
    queryCurrentVersionCreation: (input) => queryCurrent(input),
    workspace: (path) => workspaceRead(path),
    confirmHistoryCreationOpened: confirmCreation,
    async createVersionFromHistory(input) {
      calls.createHistory.push(input);
      return createHistory(input);
    },
    async queryHistoryCreation(input) {
      calls.queryCreation.push(input);
      return queryCreation(input);
    },
    async versionFile(sourcePath, versionId) {
      calls.versionFile.push([sourcePath, versionId]);
      if (versionRead) return versionRead(sourcePath, versionId);
      const content = versionId === "ver_0001" ? HISTORY_HTML : CANDIDATE_HTML;
      return {
        projectId: "project_a",
        documentId: "document_a",
        versionId,
        content,
        sha256: sha256(content),
      };
    },
    async source(sourcePath) {
      calls.source.push(sourcePath);
      if (sourceRead) return sourceRead(sourcePath);
      const content = sourcePath === SOURCE_B ? B_HTML : CANDIDATE_HTML;
      return {
        projectId: sourcePath === SOURCE_B ? "project_b" : "project_a",
        documentId: sourcePath === SOURCE_B ? "document_b" : "document_a",
        sourcePath,
        content,
        sha256: sha256(content),
        currentBasedOnVersionId: "ver_0002",
        currentExactVersionId: "ver_0002",
        restoredFromVersionId: null,
        lastModifiedAt: "2026-08-12T00:00:02.000Z",
      };
    },
    async activateReadyVersion(input) {
      calls.activate += 1;
      calls.activateInputs.push(input);
      if (activation) return activation(input);
      const version = versionRecord({ id: input.versionId });
      return {
        projectId: input.projectId,
        documentId: input.documentId,
        requestId: input.requestId,
        attemptId: input.attemptId,
        versionId: input.versionId,
        contentSha256: version.contentSha256,
        sourceSha256: version.contentSha256,
        currentHtmlSha256: version.contentSha256,
        sourcePath: SOURCE_A,
        openTarget: promotedOpenTarget(input, { sourceSha256: version.contentSha256 }),
        candidateDisplayVersionLabel: "版本 2",
        version,
      };
    },

  };
  const projectWorkflow = {
    projectHydrating: false,
    projectLoadError: null,
    async drain(boundary, input) {
      calls.drain.push([boundary, input]);
      if (onDrain) return onDrain({ boundary, input, documentSession });
      return { ok: true };
    },
    async prepareManagedSourceTransition(input) {
      calls.prepare.push(input);
      if (prepareTransition) return prepareTransition(input);
      const updatesCurrentProject = (
        projectSession.projectId === input.nextProjectId
        && projectSession.documentId === input.nextDocumentId
      );
      return Object.freeze({
        previousSourcePath: input.previousSourcePath,
        nextSourcePath: input.nextSourcePath,
        projectId: input.nextProjectId,
        documentId: input.nextDocumentId,
        openTarget: input.openTarget || null,
        updatesCurrentProject,
        activatedProject: updatesCurrentProject && !sameSourcePath(input.previousSourcePath, input.nextSourcePath)
          ? {
              operationId: input.operationId,
              sourcePath: input.nextSourcePath,
              sha256: input.expectedSha256,
              html: input.nextSourcePath === HISTORY_WORKING_COPY_PATH ? HISTORY_HTML : CANDIDATE_HTML,
            }
          : null,
      });
    },
    commitManagedSourceTransition({ prepared, html, sourceSha256, publishVersion, publishSessions }) {
      calls.commit.push({ prepared, html, sourceSha256 });
      let nextContext = projectSession.context;
      if (advanceSourceIdentity || !sameSourcePath(projectSession.sourcePath, prepared.nextSourcePath)) {
        nextContext = projectSession.transitionSource({
          previousSourcePath: prepared.previousSourcePath,
          sourcePath: prepared.nextSourcePath,
          projectId: prepared.projectId,
          documentId: prepared.documentId,
          openTarget: prepared.openTarget || null,
        });
      }
      if (!nextContext || !projectSession.context) return null;
      if (!sameSourcePath(projectSession.sourcePath, prepared.previousSourcePath)) {
        commentWorkflow.resetForProjectTransition();
      }
      documentSession.publishAuthority({ html, persistedSourceSha256: sourceSha256, pendingWrite: null });
      if (publishSessions) publishSessions(projectSession.context);
      else publishVersion();
      calls.invalidate += 1;
      return projectSession.context;
    },
    captureManagedSourceTransitionAuthority() {
      return {
        context: projectSession.context,
        document: documentSession.snapshot,
        version: versionSession.captureSnapshot(),
        comment: commentSession.snapshot,
      };
    },
    restoreManagedSourceTransitionAuthority(previous) {
      if (!previous?.context) return null;
      const locator = projectSession.openLocator(previous.context.sourcePath);
      const restored = projectSession.register({
        ...locator,
        projectId: previous.context.projectId,
        documentId: previous.context.documentId,
      });
      documentSession.publishAuthority({
        html: previous.document.html,
        persistedSourceSha256: previous.document.persistedSourceSha256,
      });
      versionSession.restoreSnapshot(previous.version);
      commentSession.update(previous.comment);
      return restored;
    },
    async refreshWorkspace(input) {
      calls.refresh.push(input);
      return { status: "succeeded", value: { hydrated: true } };
    },
    scheduleProjectListRefreshAfterSettlement(context) {
      calls.order.push("catalog");
      calls.catalogAfterSettlement.push(context);
      if (onCatalogAfterSettlement) onCatalogAfterSettlement(context);
    },
  };
  const recoveryState = {
    context,
    recoveryId: "recovery-existing-001",
    status: "pending",
  };
  const documentWorkflow = {
    recordVerifiedExport: async (input) => {
      calls.verifiedExports.push(input);
      return { status: "succeeded" };
    },
    observeExternalSourceChange,
    clearRecovery() {
      calls.clearRecovery += 1;
      recoveryState.status = "cleared";
    },
    markCanvasRecoveryRequired(input) {
      calls.pageRecovery.push(input);
      return true;
    },
    clearAudit() {
      calls.clearAudit += 1;
    },
  };
  const commentWorkflow = {
    resetForProjectTransition() {
      calls.resetComments += 1;
    },
    queueDraft() {
      calls.queueDraft += 1;
      return { status: "succeeded", value: { queued: true } };
    },
  };
  const draftSession = {
    replaceAuthority(context, draftRevision, authority) {
      calls.draftAuthorities.push({ context, draftRevision, authority });
      return true;
    },
  };
  const workflow = new VersionWorkflow({
    bridgeClient,
    projectSession,
    documentSession,
    versionSession,
    runSession,
    projectWorkflow,
    commentSession,
    draftSession,
    documentWorkflow,
    commentWorkflow,
    codecs: {
      versionsFromWorkspace, changesFromDraftRecords, commentsFromRecords, draftAuthorityFromWorkspace,
      isRecord: (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value),
      sameSourcePath: sameSourcePathCodec,
      operationKey,
      errorMessage: (cause, fallback) => String(cause?.message || fallback),
    },
    ports: {
      files: exportHtmlCopy ? { exportHtmlCopy } : null,
      hash: { sha256: hashSource },
      canvas: {
        checkpointSource,
        requestFrame(callback) {
          queueMicrotask(callback);
        },
        freezeWorkingSource: () => ({ ok: true }),
        freeze: () => {
          calls.freeze += 1;
          return { ok: true, html: documentSession.html };
        },
        async verifyRendered(html, hash, nextContext) {
          calls.render.push({ html, hash, context: nextContext });
          calls.order.push("render");
          if (verifyRendered) await verifyRendered(html, hash, nextContext);
        },
        invalidateRenderAcks() {
          calls.invalidate += 1;
        },
        unlock() {
          calls.unlock += 1;
        },
      },
      currentSurface: {
        async commit(input) {
          calls.currentSurface.push(input);
          calls.order.push("current-surface");
          return commitCurrentSurface
            ? commitCurrentSurface(input)
            : { status: "succeeded", value: { committed: true } };
        },
      },
    },
    clock: { now: () => Date.parse("2026-08-12T00:00:03.000Z") },
  });
  return {
    workflow,
    projectSession,
    documentSession,
    versionSession,
    runSession,
    projectWorkflow,
    commentSession,
    draftSession,
    calls,
    recoveryState,
    context,
    bridgeClient,
  };
}

function currentVersionReceipt(input, overrides = {}) {
  return { status: "created", operationId: input.operationId,
    projectId: input.target.projectId, documentId: input.target.documentId,
    sourcePath: input.target.sourcePath, workingCopyId: input.target.workingCopyId,
    versionId: "ver_0002", versionOrdinal: 2,
    sourceSha256: input.expectedSourceSha256, ...overrides };
}

test("local checkpoint preserves current HTML, comments, attachments and editing Canvas", async () => {
  const writes = [];
  const h = createHarness({ currentDraft: true, createCurrent: async (input) => {
    writes.push(input); return currentVersionReceipt(input);
  } });
  const comments = [{ id: "comment_1", text: "Keep this comment", attachments: [{ id: "attachment_1" }] }];
  h.commentSession.update({ comments });
  const outcome = await h.workflow.saveCurrentVersion();
  assert.equal(outcome.status, "succeeded");
  assert.equal(writes.length, 1);
  assert.equal(writes[0].expectedSourceSha256, sha256(BASE_HTML));
  assert.equal(h.documentSession.html, BASE_HTML);
  assert.deepEqual(h.commentSession.comments, comments);
  assert.equal(h.calls.invalidate, 0);
  assert.equal(h.calls.render.length, 0);
  assert.equal(h.calls.resetComments, 0);
  assert.equal(h.workflow.getSnapshot().draftVersion.phase, "saved");
  assert.equal(h.workflow.getSnapshot().navigation.phase, "idle");
});

test("unchanged local checkpoint reports existing version without rebuilding Canvas", async () => {
  const h = createHarness({ currentDraft: true, createCurrent: async (input) => currentVersionReceipt(input,
    { status: "unchanged", versionId: "ver_0001", versionOrdinal: 1 }) });
  assert.equal((await h.workflow.saveCurrentVersion()).status, "succeeded");
  assert.equal(h.workflow.getSnapshot().draftVersion.phase, "unchanged");
  assert.equal(h.calls.invalidate, 0);
});

test("lost local checkpoint response queries same operation and does not create twice", async () => {
  let input; let writes = 0; const queries = [];
  const h = createHarness({ currentDraft: true,
    createCurrent: async (value) => { input = value; writes++; throw new Error("lost response"); },
    queryCurrent: async (value) => { queries.push(value); return currentVersionReceipt(input); },
  });
  assert.equal((await h.workflow.saveCurrentVersion()).status, "succeeded");
  assert.equal(writes, 1);
  assert.equal(queries[0].operationId, input.operationId);
  assert.equal(h.workflow.getSnapshot().draftVersion.phase, "saved");
});

test("unknown checkpoint blocks a second operation and retry only queries authority", async () => {
  let input; let queryWorks = false; let writes = 0;
  const h = createHarness({ currentDraft: true,
    createCurrent: async (value) => { input = value; writes++; throw new Error("lost response"); },
    queryCurrent: async () => { if (!queryWorks) throw new Error("offline"); return currentVersionReceipt(input); },
  });
  assert.equal((await h.workflow.saveCurrentVersion()).status, "unknown");
  assert.equal((await h.workflow.saveCurrentVersion()).status, "blocked");
  queryWorks = true;
  assert.equal((await h.workflow.retryCurrentVersion()).status, "succeeded");
  assert.equal(writes, 1);
});

test("mismatched local checkpoint receipt never publishes a saved result", async () => {
  const h = createHarness({ currentDraft: true,
    createCurrent: async (input) => currentVersionReceipt(input, { projectId: "project_other" }),
    queryCurrent: async (input) => ({ ...currentVersionReceipt(input), projectId: "project_other" }),
  });
  assert.equal((await h.workflow.saveCurrentVersion()).status, "unknown");
  assert.equal(h.calls.refresh.length, 0);
});

test("local checkpoint refuses unpersisted content and releases navigation", async () => {
  let writes = 0;
  const h = createHarness({ currentDraft: true,
    createCurrent: async (input) => { writes++; return currentVersionReceipt(input); },
    onDrain: async ({ documentSession }) => {
      documentSession.acceptEdit({ html: DRAINED_HTML, write: null });
      return { ok: true };
    },
  });
  assert.equal((await h.workflow.saveCurrentVersion()).status, "rejected");
  assert.equal(writes, 0);
  assert.equal(h.documentSession.html, DRAINED_HTML);
  assert.equal(h.workflow.getSnapshot().navigation.phase, "idle");
});

test("project switch during local checkpoint discards old UI response", async () => {
  const response = deferred();
  let input;
  const h = createHarness({ currentDraft: true, createCurrent: async (value) => { input = value; return response.promise; } });
  const pending = h.workflow.saveCurrentVersion();
  while (!input) await new Promise((resolve) => setImmediate(resolve));
  const locator = h.projectSession.openLocator(SOURCE_B);
  h.projectSession.register({ ...locator, projectId: "project_b", documentId: "document_b" });
  response.resolve(currentVersionReceipt(input));
  assert.equal((await pending).status, "stale");
  assert.equal(h.calls.refresh.length, 0);
  assert.equal(h.workflow.getSnapshot().navigation.phase, "idle");
});

test("plain export includes latest native edits and does not create a version", async () => {
  const exports = []; let writes = 0; let h;
  h = createHarness({ currentDraft: true,
    checkpointSource: () => {
      h.documentSession.acceptEdit({ html: DRAINED_HTML, write: null });
      return { ok: true };
    },
    exportHtmlCopy: async (input) => { exports.push(input); return { path: "/tmp/shared.html", sha256: sha256(input.html) }; },
    createCurrent: async () => { writes++; },
  });
  assert.equal((await h.workflow.exportHtml({ suggestedName: "report.html" })).status, "succeeded");
  assert.equal(exports[0].html, DRAINED_HTML);
  assert.equal(writes, 0);
  assert.equal(h.workflow.getSnapshot().export.phase, "exported");
});

for (const saveVersion of [false, true]) {
  test(`pathless document downloads exact checkpoint bytes without persistence or version creation (saveVersion=${saveVersion})`, async () => {
    const exports = [];
    const hashed = [];
    const latest = "\uFEFF<!doctype html>\r\n<html><body>latest local edit</body></html>\r\n";
    let writes = 0;
    let h;
    h = createHarness({ currentPath: null,
      checkpointSource: () => {
        h.documentSession.acceptEdit({ html: latest, write: null });
        return { ok: true };
      },
      hashSource: async (html) => { hashed.push(html); return sha256(html); },
      exportHtmlCopy: async (input) => { exports.push(input); return { kind: "download-started" }; },
      createCurrent: async () => { writes++; },
    });
    const result = await h.workflow.exportHtml({ suggestedName: "local.html", saveVersion });
    assert.deepEqual(result.value, { downloadStarted: true });
    assert.deepEqual(exports, [{ html: latest, sourcePath: null, suggestedName: "local.html" }]);
    assert.deepEqual(hashed, [latest]);
    assert.equal(h.workflow.getSnapshot().export.phase, "download-started");
    assert.equal(h.workflow.getSnapshot().export.context, null);
    assert.equal(h.workflow.getSnapshot().export.path, undefined);
    assert.equal(h.documentSession.html, latest);
    assert.equal(h.documentSession.lastPersistedRevision, 0);
    assert.equal(h.documentSession.persistedSourceSha256, sha256(BASE_HTML));
    assert.equal(h.documentSession.snapshot.persistState, "preview-dirty");
    assert.equal(h.calls.verifiedExports.length, 0);
    assert.equal((await h.workflow.saveCurrentVersion()).status, "stale");
    assert.equal(writes, 0);
    assert.equal(h.workflow.getSnapshot().draftVersion, undefined);
  });
}

test("export requires an open document and never treats an unregistered file path as pathless", async () => {
  let downloads = 0;
  for (const sourcePath of [null, SOURCE_A]) {
    const h = createHarness({ currentPath: null, exportHtmlCopy: async () => { downloads++; return { kind: "download-started" }; } });
    h.projectSession.openLocator(sourcePath);
    if (!sourcePath) h.documentSession.reset({ html: "" });
    assert.equal((await h.workflow.exportHtml()).code, "PROJECT_CONTEXT_REQUIRED");
  }
  assert.equal(downloads, 0);
});

test("pathless export refuses unfinished native input", async () => {
  let downloads = 0;
  const h = createHarness({ currentPath: null,
    checkpointSource: () => ({ ok: false, reason: "input pending" }),
    exportHtmlCopy: async () => { downloads++; return { kind: "download-started" }; },
  });
  assert.equal((await h.workflow.exportHtml()).code, "EXPORT_EDIT_PENDING");
  assert.equal(downloads, 0);
});

test("pathless export refuses a filesystem receipt without managed authority", async () => {
  let writes = 0;
  const h = createHarness({ currentPath: null,
    exportHtmlCopy: async ({ html }) => ({ path: "/tmp/unverified.html", sha256: sha256(html) }),
    createCurrent: async () => { writes++; },
  });
  assert.equal((await h.workflow.exportHtml({ saveVersion: true })).code, "EXPORT_FAILED");
  assert.equal(h.workflow.getSnapshot().export.phase, "failed");
  assert.equal(h.calls.verifiedExports.length, 0);
  assert.equal(writes, 0);
});

test("switching pathless documents while hashing prevents a stale download", async () => {
  const hashing = deferred();
  const hashResult = deferred();
  let downloads = 0;
  const h = createHarness({ currentPath: null,
    hashSource: async () => { hashing.resolve(); return hashResult.promise; },
    exportHtmlCopy: async () => { downloads++; return { kind: "download-started" }; },
  });
  const exporting = h.workflow.exportHtml();
  await hashing.promise;
  h.projectSession.openLocator(null);
  h.documentSession.reset({ html: B_HTML });
  hashResult.resolve(sha256(BASE_HTML));
  assert.equal((await exporting).status, "stale");
  assert.equal(downloads, 0);
  assert.equal(h.workflow.getSnapshot().export, undefined);
});

test("a late pathless download result preserves the new document and releases the export operation", async () => {
  const started = deferred();
  const completion = deferred();
  let downloads = 0;
  const h = createHarness({ currentPath: null, exportHtmlCopy: async () => {
    if (++downloads === 1) { started.resolve(); return completion.promise; }
    return { kind: "download-started" };
  } });
  const exporting = h.workflow.exportHtml();
  await started.promise;
  h.projectSession.openLocator(null);
  h.documentSession.reset({ html: B_HTML });
  completion.resolve({ kind: "download-started" });
  assert.equal((await exporting).status, "stale");
  assert.equal(h.workflow.getSnapshot().export, undefined);
  assert.equal(h.documentSession.html, B_HTML);
  assert.deepEqual((await h.workflow.exportHtml()).value, { downloadStarted: true });
  assert.equal(h.calls.verifiedExports.length, 0);
});

test("cancelled or failed export never creates a version", async () => {
  for (const fail of [false, true]) {
    let writes = 0;
    const h = createHarness({ currentDraft: true,
      exportHtmlCopy: async () => { if (fail) throw new Error("write failed"); return null; },
      createCurrent: async () => { writes++; },
    });
    await h.workflow.exportHtml({ saveVersion: true });
    assert.equal(writes, 0);
    assert.equal(h.workflow.getSnapshot().export.phase, fail ? "failed" : "cancelled");
  }
});

test("export and optional checkpoint use the same confirmed source bytes", async () => {
  const exports = []; const writes = [];
  const h = createHarness({ currentDraft: true,
    exportHtmlCopy: async (input) => { exports.push(input); return { path: "/tmp/shared.html", sha256: sha256(input.html) }; },
    createCurrent: async (input) => { writes.push(input); return currentVersionReceipt(input); },
  });
  assert.equal((await h.workflow.exportHtml({ saveVersion: true })).status, "succeeded");
  assert.equal(writes.length, 1);
  assert.equal(writes[0].expectedSourceSha256, sha256(exports[0].html));
});

test("export succeeds independently when optional version is unknown; retry does not export again", async () => {
  let exports = 0; let input; let queryWorks = false;
  const h = createHarness({ currentDraft: true,
    exportHtmlCopy: async (value) => { exports++; return { path: "/tmp/shared.html", sha256: sha256(value.html) }; },
    createCurrent: async (value) => { input = value; throw new Error("lost reply"); },
    queryCurrent: async () => { if (!queryWorks) throw new Error("offline"); return currentVersionReceipt(input); },
  });
  assert.equal((await h.workflow.exportHtml({ saveVersion: true })).status, "succeeded");
  assert.equal(h.workflow.getSnapshot().export.phase, "version-pending");
  queryWorks = true;
  assert.equal((await h.workflow.retryCurrentVersion()).status, "succeeded");
  assert.equal(exports, 1);
});

test("history export uses immutable viewed bytes and a readable Vn filename", async () => {
  const exports = [];
  const h = createHarness({ currentDraft: true,
    exportHtmlCopy: async (input) => { exports.push(input); return { path: "/tmp/history.html", sha256: sha256(input.html) }; },
  });
  await h.workflow.viewHistory({ version: { id: "ver_0001" } });
  assert.equal((await h.workflow.exportHtml({ suggestedName: "report", saveVersion: true })).status, "succeeded");
  assert.equal(exports[0].html, HISTORY_HTML);
  assert.equal(exports[0].suggestedName, "report-V1.html");
});

test("review preparation returns an immutable candidate without activating or publishing source", async () => {
  const harness = createHarness();
  const run = readyRun();
  harness.runSession.trackRun(run, { activate: "always" });

  const outcome = await harness.workflow.prepareReviewCandidate({ run });

  assert.equal(outcome.status, "succeeded");
  assert.equal(Object.isFrozen(outcome.value), true);
  assert.equal(outcome.value.content, CANDIDATE_HTML);
  assert.equal(outcome.value.sha256, sha256(CANDIDATE_HTML));
  assert.equal(harness.calls.activate, 0);
  assert.equal(harness.calls.source.length, 0);
  assert.equal(harness.documentSession.html, BASE_HTML);
  assert.equal(harness.versionSession.snapshot.currentExactVersionId, "ver_0001");
});

test("review preparation fences a late candidate read after cancellation", async () => {
  const delayed = deferred();
  const harness = createHarness({
    versionRead: async () => delayed.promise,
  });
  const run = readyRun();
  harness.runSession.trackRun(run, { activate: "always" });

  const reviewing = harness.workflow.prepareReviewCandidate({ run });
  harness.runSession.removeRun(run);
  delayed.resolve({
    projectId: run.projectId,
    documentId: run.documentId,
    versionId: run.candidateVersionId,
    content: CANDIDATE_HTML,
    sha256: sha256(CANDIDATE_HTML),
  });

  const outcome = await reviewing;
  assert.equal(outcome.status, "stale");
  assert.equal(harness.calls.activate, 0);
  assert.equal(harness.documentSession.html, BASE_HTML);
});

test("activation validates all content and synchronously publishes every Session authority", async () => {
  const harness = createHarness();
  const run = readyRun({ sourceWorkingCopyId: "work_ver_0001" });
  harness.runSession.trackRun(run, { activate: "always" });

  const outcome = await harness.workflow.activateReadyVersion({ run });

  assert.equal(outcome.status, "succeeded");
  assert.equal(outcome.value.current, true);
  assert.equal(harness.calls.activate, 1);
  assert.equal(harness.calls.commit.length, 1);
  assert.equal(harness.documentSession.html, CANDIDATE_HTML);
  assert.equal(harness.versionSession.snapshot.currentExactVersionId, "ver_0002");
  assert.equal(harness.versionSession.snapshot.viewMode, "current");
  assert.equal(harness.runSession.activeRun?.status, "complete");
  assert.equal(harness.runSession.activeRun.sourceWorkingCopyId, "work_ver_0001");
  assert.equal(harness.calls.render.at(-1)?.html, CANDIDATE_HTML);
  assert.equal(harness.calls.clearAudit, 1);
  assert.equal(harness.calls.resetComments, 0);
  assert.equal(harness.calls.draftAuthorities.length, 1);
  assert.equal(harness.calls.draftAuthorities[0].draftRevision, 0);
  assert.deepEqual(harness.commentSession.snapshot.comments, []);
  assert.equal(harness.calls.catalogAfterSettlement.length, 1);
});

test("activation publishes committed display identity before Canvas verification settles", async () => {
  const canvasGate = deferred();
  const publication = deferred();
  const harness = createHarness({
    verifyRendered: async (html) => {
      if (html === CANDIDATE_HTML) await canvasGate.promise;
    },
  });
  const run = readyRun();
  harness.runSession.trackRun(run, { activate: "always" });
  harness.workflow.subscribeEvents((event) => {
    if (event.type === "version-activation-published") publication.resolve(event);
  });

  const activation = harness.workflow.activateReadyVersion({ run });
  const event = await publication.promise;
  assert.equal(event.operationKey, operationKey(run));
  assert.equal(event.context.sourcePath, SOURCE_A);
  assert.equal(harness.documentSession.html, CANDIDATE_HTML);
  assert.equal(harness.runSession.activeRun?.status, "ready-to-open");

  canvasGate.resolve();
  assert.equal((await activation).status, "succeeded");
  assert.equal(harness.runSession.activeRun?.status, "complete");
});

for (const advanceSourceIdentity of [false, true]) test(`activation keeps the Canvas locked when rendered-byte verification fails (new source identity: ${advanceSourceIdentity})`, async () => {
  const harness = createHarness({
    advanceSourceIdentity,
    verifyRendered: async (html) => {
      if (html === CANDIDATE_HTML) throw new Error("canvas did not acknowledge candidate");
    },
  });
  const run = readyRun();
  harness.runSession.trackRun(run, { activate: "always" });

  const outcome = await harness.workflow.activateReadyVersion({ run });

  assert.equal(outcome.status, "rejected");
  assert.equal(harness.calls.activate, 1);
  assert.equal(harness.calls.commit.length, 1);
  assert.equal(harness.documentSession.html, CANDIDATE_HTML);
  assert.equal(harness.versionSession.snapshot.currentExactVersionId, "ver_0002");
  assert.equal(harness.runSession.activeRun?.status, "complete");
  assert.equal(harness.runSession.activeRun?.pageRecoveryRequired, true);
  assert.match(harness.runSession.activeRun?.pageRecoveryReason, /canvas did not acknowledge candidate/u);
  assert.equal(harness.runSession.activeLocked, true);
  assert.equal(harness.calls.unlock, 0);
  assert.equal(harness.calls.pageRecovery.length, 1);
  assert.equal(harness.calls.clearAudit, 0);
  assert.equal(harness.calls.resetComments, 0);
  assert.equal(harness.calls.draftAuthorities.length, 1);
  assert.equal(harness.calls.queueDraft, 0);
  assert.equal(harness.calls.refresh.length, 0);

  const repeat = await harness.workflow.activateReadyVersion({
    run: harness.runSession.activeRun,
  });
  assert.equal(repeat.status, "blocked");
  assert.equal(harness.calls.activate, 1);
});

test("verified page recovery completes cleanup before Run resolution", async () => {
  const harness = createHarness({
    verifyRendered: async (html) => {
      if (html === CANDIDATE_HTML) throw new Error("canvas did not acknowledge candidate");
    },
  });
  const run = readyRun();
  harness.runSession.trackRun(run, { activate: "always" });

  const failed = await harness.workflow.activateReadyVersion({ run });
  assert.equal(failed.status, "rejected");
  const recoveryRun = harness.runSession.activeRun;
  assert.equal(recoveryRun?.pageRecoveryRequired, true);
  const clearRecoveryBefore = harness.calls.clearRecovery;

  // The real repair path reloads the accepted projection with the current
  // managed context before acknowledging its Canvas generation.
  harness.documentSession.publishAuthority({
    html: CANDIDATE_HTML,
    persistedSourceSha256: sha256(CANDIDATE_HTML),
    pendingWrite: null,
    context: harness.context,
    operationId: "test-page-recovery-authority",
  });
  const receipt = harness.documentSession.sourceReceipt;
  assert.equal(harness.documentSession.confirmCanvas({
    receipt,
    renderedHtml: CANDIDATE_HTML,
    renderedSha256: sha256(CANDIDATE_HTML),
    generation: harness.documentSession.canvasGeneration,
  }), true);

  const recovered = harness.workflow.completePageRecovery({ run: recoveryRun });
  assert.equal(recovered.status, "succeeded", JSON.stringify(recovered));
  assert.equal(recovered.value.current, true);
  assert.equal(harness.runSession.activeRun?.pageRecoveryRequired, true);
  assert.equal(harness.runSession.resolvePageRecovery(recoveryRun), true);
  assert.equal(harness.calls.clearAudit, 1);
  assert.equal(harness.calls.queueDraft, 1);
  assert.equal(harness.calls.clearRecovery, clearRecoveryBefore + 1);
  assert.equal(harness.calls.refresh.length, 1);
  assert.equal(harness.calls.refresh[0].sourcePath, SOURCE_A);
  assert.equal(
    harness.calls.refresh[0].authorityReceiptContinuation,
    harness.documentSession.sourceReceipt,
  );
  assert.equal(harness.calls.catalogAfterSettlement.length, 1);
  assert.equal(harness.calls.activate, 1);

  // The existing Run page-recovery gate is one-shot; a late repeat cannot
  // reach Version cleanup or create another adoption operation.
  assert.equal(harness.runSession.resolvePageRecovery(recoveryRun), false);
  assert.equal(harness.calls.clearAudit, 1);
  assert.equal(harness.calls.queueDraft, 1);
  assert.equal(harness.calls.refresh.length, 1);
});

test("activation rejects completion/version hash drift before publishing current source", async () => {
  const harness = createHarness({
    activation: async (input) => ({
      projectId: input.projectId,
      documentId: input.documentId,
      requestId: input.requestId,
      attemptId: input.attemptId,
      versionId: input.versionId,
      contentSha256: sha256("tampered"),
      sourceSha256: sha256("tampered"),
      sourcePath: SOURCE_A,
      openTarget: promotedOpenTarget(input, { sourceSha256: sha256("tampered") }),
      version: {
        ...versionRecord({ id: input.versionId }),
        contentSha256: sha256("tampered"),
      },
    }),
  });
  const run = readyRun();
  harness.runSession.trackRun(run, { activate: "always" });

  const outcome = await harness.workflow.activateReadyVersion({ run });

  assert.equal(outcome.status, "rejected");
  assert.equal(harness.documentSession.html, BASE_HTML);
  assert.equal(harness.versionSession.snapshot.currentExactVersionId, "ver_0001");
  assert.equal(harness.calls.commit.length, 0);
  assert.equal(harness.runSession.activeRun?.status, "ready-to-open");
});

test("activation rejects malformed ready identity before the explicit Bridge mutation", async () => {
  const harness = createHarness();
  const run = readyRun();
  run.readyPayload = {
    ...run.readyPayload,
    outcome: {
      ...run.readyPayload.outcome,
      versionId: "ver_9999",
    },
  };
  harness.runSession.trackRun(run, { activate: "always" });

  const outcome = await harness.workflow.activateReadyVersion({ run });

  assert.equal(outcome.status, "rejected");
  assert.equal(harness.calls.activate, 0);
  assert.equal(harness.documentSession.html, BASE_HTML);
  assert.equal(harness.versionSession.snapshot.currentExactVersionId, "ver_0001");
});

test("activation fails closed when a hydrated ready run has no Candidate identity", async () => {
  const harness = createHarness();
  const run = readyRun();
  run.readyPayload = {
    ...run.readyPayload,
    candidateId: null,
    candidate: null,
    navigationOperationId: "navigation_should_not_be_used",
  };
  harness.runSession.trackRun(run, { activate: "always" });

  const outcome = await harness.workflow.activateReadyVersion({ run });

  assert.equal(outcome.status, "blocked");
  assert.equal(outcome.code, "VERSION_ACTIVATION_PRECONDITION");
  assert.equal(harness.calls.activate, 0);
  assert.equal(harness.calls.commit.length, 0);
  assert.equal(harness.documentSession.html, BASE_HTML);
  assert.equal(harness.versionSession.snapshot.currentExactVersionId, "ver_0001");
});

test("Candidate Promotion rejects an incomplete or wrong-kind response target before local Desktop transition", async () => {
  const mutations = [
    ["null target", () => null],
    ["version target", (target) => ({ ...target, targetKind: "version" })],
    ["missing version", (target) => ({ ...target, versionId: "" })],
    ["missing path", (target) => ({ ...target, exactSourcePath: "" })],
    ["missing hash", (target) => ({ ...target, sourceSha256: "" })],
    ["wrong document", (target) => ({ ...target, documentId: "document_other" })],
  ];

  for (const [label, mutate] of mutations) {
    const harness = createHarness({
      activation: async (input) => {
        const version = versionRecord({ id: input.versionId });
        const target = promotedOpenTarget(input, { sourceSha256: version.contentSha256 });
        return {
          projectId: input.projectId,
          documentId: input.documentId,
          requestId: input.requestId,
          attemptId: input.attemptId,
          versionId: input.versionId,
          sourcePath: SOURCE_A,
          contentSha256: version.contentSha256,
          sourceSha256: version.contentSha256,
          currentHtmlSha256: version.contentSha256,
          openTarget: mutate(target),
          version,
        };
      },
    });
    const run = readyRun();
    harness.runSession.trackRun(run, { activate: "always" });
    const beforeDocument = harness.documentSession.snapshot;
    const beforeVersion = harness.versionSession.snapshot;
    const beforeProject = harness.projectSession.context;

    const outcome = await harness.workflow.activateReadyVersion({ run });

    assert.equal(outcome.status, "rejected", label);
    assert.equal(harness.calls.activate, 1, label);
    assert.equal(harness.calls.prepare.length, 0, label);
    assert.equal(harness.calls.commit.length, 0, label);
    assert.deepEqual(harness.documentSession.snapshot, beforeDocument, label);
    assert.deepEqual(harness.versionSession.snapshot, beforeVersion, label);
    assert.deepEqual(harness.projectSession.context, beforeProject, label);
  }
});

test("activation remains read-only while project hydration is in flight", async () => {
  const harness = createHarness();
  const run = readyRun();
  harness.runSession.trackRun(run, { activate: "always" });
  harness.projectWorkflow.projectHydrating = true;

  const outcome = await harness.workflow.activateReadyVersion({ run });

  assert.equal(outcome.status, "blocked");
  assert.equal(outcome.code, "VERSION_ACTIVATION_PROJECT_UNAVAILABLE");
  assert.equal(harness.calls.activate, 0);
  assert.equal(harness.calls.commit.length, 0);
  assert.equal(harness.documentSession.html, BASE_HTML);
  assert.equal(harness.versionSession.snapshot.currentExactVersionId, "ver_0001");
  assert.equal(harness.runSession.activeRun?.status, "ready-to-open");
});

test("background activation never replaces the active Canvas", async () => {
  const harness = createHarness({ currentPath: SOURCE_B });
  const run = readyRun();
  harness.runSession.trackRun(run, { activate: "always" });

  const outcome = await harness.workflow.activateReadyVersion({ run });

  assert.equal(outcome.status, "succeeded");
  assert.equal(outcome.value.current, false);
  assert.equal(harness.documentSession.html, B_HTML);
  assert.equal(harness.versionSession.snapshot.currentExactVersionId, "ver_0001");
  assert.equal(harness.calls.activate, 0);
  assert.equal(harness.calls.commit.length, 0);
  assert.equal(harness.calls.catalogAfterSettlement.length, 0);
});

test("openCommittedVersion does not clear background-document recovery for a same-project different-document result", async () => {
  const harness = createHarness();
  const locator = harness.projectSession.openLocator(SOURCE_A);
  harness.projectSession.register({
    ...locator,
    projectId: "project_a",
    documentId: "document_other",
    openTarget: {
      projectId: "project_a",
      documentId: "document_other",
      projectRootPath: "/tmp/project-a",
      targetKind: "working-copy",
      workingCopyId: "work_ver_0001",
      versionId: "ver_0001",
      exactSourcePath: SOURCE_A,
      sourceSha256: sha256(BASE_HTML),
    },
  });
  const run = readyRun();
  const beforeDocument = harness.documentSession.snapshot;
  const beforeVersion = harness.versionSession.snapshot;
  const beforeComments = harness.commentSession.snapshot;
  const outcome = await harness.workflow.openCommittedVersion({
    run,
    payload: {
      ...run.readyPayload,
      ok: true,
      status: "version-activated",
      projectId: run.projectId,
      documentId: run.documentId,
      versionId: run.candidateVersionId,
      sourcePath: SOURCE_A,
      content: CANDIDATE_HTML,
      contentSha256: sha256(CANDIDATE_HTML),
      sourceSha256: sha256(CANDIDATE_HTML),
      currentHtmlSha256: sha256(CANDIDATE_HTML),
      lastModifiedAt: "2026-08-12T00:00:02.000Z",
      openTarget: promotedOpenTarget(run, {
        sourceSha256: sha256(CANDIDATE_HTML),
        versionId: run.candidateVersionId,
      }),
      version: versionRecord({ id: run.candidateVersionId }),
    },
  });
  assert.equal(outcome.status, "succeeded");
  assert.equal(outcome.value.current, false);
  assert.equal(harness.calls.commit.length, 0);
  assert.equal(harness.calls.clearRecovery, 0);
  assert.equal(harness.calls.resetComments, 0);
  assert.deepEqual(harness.documentSession.snapshot, beforeDocument);
  assert.deepEqual(harness.versionSession.snapshot, beforeVersion);
  assert.deepEqual(harness.commentSession.snapshot, beforeComments);
});

test("openCommittedVersion rejects incomplete or mismatched OpenTarget before current classification", async () => {
  const cases = [
    ["null target", () => null],
    ["wrong document target", (target) => ({ ...target, documentId: "document_other" })],
    ["wrong version target", (target) => ({ ...target, versionId: "ver_0099" })],
  ];

  for (const [label, mutateTarget] of cases) {
    const harness = createHarness();
    const run = readyRun();
    const candidateSha256 = sha256(CANDIDATE_HTML);
    const beforeProject = harness.projectSession.context;
    const beforeDocument = harness.documentSession.snapshot;
    const beforeVersion = harness.versionSession.snapshot;
    const beforeComments = harness.commentSession.snapshot;
    const beforeRecovery = { ...harness.recoveryState };
    const outcome = await harness.workflow.openCommittedVersion({
      run,
      payload: {
        ...run.readyPayload,
        ok: true,
        status: "version-activated",
        projectId: run.projectId,
        documentId: run.documentId,
        versionId: run.candidateVersionId,
        sourcePath: SOURCE_A,
        content: CANDIDATE_HTML,
        contentSha256: candidateSha256,
        sourceSha256: candidateSha256,
        currentHtmlSha256: candidateSha256,
        lastModifiedAt: "2026-08-12T00:00:02.000Z",
        openTarget: mutateTarget(promotedOpenTarget(run, { sourceSha256: candidateSha256 })),
        version: versionRecord({ id: run.candidateVersionId }),
      },
    });

    // A valid target for a later Version is an explicit supersession result;
    // incomplete or cross-document identity remains a rejection.
    assert.equal(outcome.status, label === "wrong version target" ? "blocked" : "rejected", label);
    if (label === "wrong version target") assert.equal(outcome.code, "VERSION_ACTIVATION_SUPERSEDED", label);
    assert.equal(harness.calls.freeze, 0, label);
    assert.equal(harness.calls.clearRecovery, 0, label);
    assert.equal(harness.calls.prepare.length, 0, label);
    assert.equal(harness.calls.commit.length, 0, label);
    assert.deepEqual(harness.projectSession.context, beforeProject, label);
    assert.deepEqual(harness.documentSession.snapshot, beforeDocument, label);
    assert.deepEqual(harness.versionSession.snapshot, beforeVersion, label);
    assert.deepEqual(harness.commentSession.snapshot, beforeComments, label);
    assert.deepEqual(harness.recoveryState, beforeRecovery, label);
  }
});

test("Version to Project transition with the same project but another document stays publication-free", async () => {
  const harness = createHarness();
  const run = readyRun();
  run.documentId = "document_other";
  run.readyPayload = {
    ...run.readyPayload,
    documentId: "document_other",
    candidate: { ...run.readyPayload.candidate, documentId: "document_other" },
    openTarget: { ...run.readyPayload.openTarget, documentId: "document_other" },
    version: { ...run.readyPayload.version, documentId: "document_other" },
    outcome: { ...run.readyPayload.outcome, documentId: "document_other" },
  };
  harness.runSession.trackRun(run, { activate: "always" });
  const beforeProject = harness.projectSession.context;
  const beforeDocument = harness.documentSession.snapshot;
  const beforeVersion = harness.versionSession.snapshot;
  const beforeComments = harness.commentSession.snapshot;

  const outcome = await harness.workflow.activateReadyVersion({ run });

  assert.equal(outcome.status, "succeeded");
  assert.equal(outcome.value.current, false);
  assert.equal(harness.calls.activate, 0);
  assert.equal(harness.calls.commit.length, 0);
  assert.deepEqual(harness.projectSession.context, beforeProject);
  assert.deepEqual(harness.documentSession.snapshot, beforeDocument);
  assert.deepEqual(harness.versionSession.snapshot, beforeVersion);
  assert.deepEqual(harness.commentSession.snapshot, beforeComments);
});

test("activation reuses activation-response bytes without a Bridge read-back", async () => {
  const harness = createHarness({
    activation: async (input) => ({
      ok: true,
      status: "version-activated",
      projectId: input.projectId,
      documentId: input.documentId,
      requestId: input.requestId,
      attemptId: input.attemptId,
      versionId: input.versionId,
      contentSha256: sha256(CANDIDATE_HTML),
      sourceSha256: sha256(CANDIDATE_HTML),
      currentHtmlSha256: sha256(CANDIDATE_HTML),
      sourcePath: SOURCE_A,
      openTarget: promotedOpenTarget(input),
      content: CANDIDATE_HTML,
      lastModifiedAt: "2026-08-12T00:00:02.000Z",
      candidateDisplayVersionLabel: "版本 2",
      version: versionRecord({ id: input.versionId }),
    }),
  });
  const run = readyRun();
  harness.runSession.trackRun(run, { activate: "always" });

  const outcome = await harness.workflow.activateReadyVersion({ run });

  assert.equal(outcome.status, "succeeded");
  assert.equal(outcome.value.current, true);
  assert.equal(harness.calls.versionFile.length, 0);
  assert.equal(harness.calls.source.length, 0);
  assert.equal(harness.documentSession.html, CANDIDATE_HTML);
  assert.equal(harness.calls.render.at(-1)?.html, CANDIDATE_HTML);
  assert.equal(harness.versionSession.snapshot.currentExactVersionId, "ver_0002");
});

test("activation rejects activation-response bytes whose hash does not match", async () => {
  const harness = createHarness({
    activation: async (input) => ({
      ok: true,
      status: "version-activated",
      projectId: input.projectId,
      documentId: input.documentId,
      requestId: input.requestId,
      attemptId: input.attemptId,
      versionId: input.versionId,
      contentSha256: sha256(CANDIDATE_HTML),
      sourceSha256: sha256(CANDIDATE_HTML),
      currentHtmlSha256: sha256(CANDIDATE_HTML),
      sourcePath: SOURCE_A,
      openTarget: promotedOpenTarget(input),
      content: CANDIDATE_HTML.replace("candidate", "tampered"),
      lastModifiedAt: "2026-08-12T00:00:02.000Z",
      candidateDisplayVersionLabel: "版本 2",
      version: versionRecord({ id: input.versionId }),
    }),
  });
  const run = readyRun();
  harness.runSession.trackRun(run, { activate: "always" });

  const outcome = await harness.workflow.activateReadyVersion({ run });

  assert.equal(outcome.status, "rejected");
  assert.equal(harness.calls.commit.length, 0);
  assert.equal(harness.documentSession.html, BASE_HTML);
  assert.equal(harness.versionSession.snapshot.currentExactVersionId, "ver_0001");
  assert.equal(harness.runSession.activeRun?.status, "ready-to-open");
});

test("a failed workspace refresh never blocks activation and reports through events", async () => {
  const harness = createHarness();
  const refreshDeferred = deferred();
  harness.projectWorkflow.refreshWorkspace = async (input) => {
    harness.calls.refresh.push(input);
    return refreshDeferred.promise;
  };
  const events = [];
  harness.workflow.subscribeEvents((event) => events.push(event));
  const run = readyRun();
  harness.runSession.trackRun(run, { activate: "always" });

  const outcome = await harness.workflow.activateReadyVersion({ run });

  assert.equal(outcome.status, "succeeded");
  assert.equal(outcome.value.refreshWarning, undefined);
  assert.equal(harness.calls.refresh.length, 1);
  assert.equal(
    events.some((event) => event.type === "version-refresh-warning"),
    false,
  );

  refreshDeferred.resolve({ status: "blocked", reason: "复核未完成" });
  await new Promise((resolve) => setTimeout(resolve, 0));

  const warning = events.find((event) => event.type === "version-refresh-warning");
  assert.ok(warning);
  assert.equal(warning.reason, "复核未完成");
  assert.equal(warning.candidateLabel, "版本 2");
});

test("history preview never publishes historical bytes or renders the working Canvas", async () => {
  const harness = createHarness({ verifyRendered: async () => { throw new Error("must not render"); } });
  const before = harness.documentSession.snapshot;
  const outcome = await harness.workflow.viewHistory({ version: { id: "ver_0001", contentSha256: sha256(HISTORY_HTML) }, context: harness.context });
  assert.equal(outcome.status, "succeeded");
  assert.deepEqual(harness.documentSession.snapshot, before);
  assert.equal(harness.versionSession.snapshot.historyPreview.content, HISTORY_HTML);
  assert.equal(harness.versionSession.snapshot.currentExactVersionId, "ver_0001");
  assert.equal(harness.calls.render.length, 0);
});

test("detached history reads and exports its project without replacing or draining the runtime project", async () => {
  const detachedHistory = "<!doctype html><html><body><p>detached B</p></body></html>";
  const exports = [];
  const harness = createHarness({
    versionRead: async (sourcePath, versionId) => ({
      projectId: "project_b",
      documentId: "document_b",
      versionId,
      content: detachedHistory,
      sha256: sha256(detachedHistory),
    }),
    exportHtmlCopy: async (input) => {
      exports.push(input);
      return { path: "/tmp/detached-history.html", sha256: sha256(input.html) };
    },
  });
  harness.runSession.trackRun({
    projectId: "project_a",
    documentId: "document_a",
    sourcePath: SOURCE_A,
    requestId: "request_a",
    attemptId: "attempt_a",
    status: "processing",
  }, { activate: "always" });
  const context = Object.freeze({
    surfaceContextId: "surface:history:project_b:document_b",
    epoch: 4,
    projectId: "project_b",
    documentId: "document_b",
    sourcePath: SOURCE_B,
    projectRootPath: "/tmp/project-b",
    targetKind: "working-copy",
    workingCopyId: "work_project_b",
    versionId: "ver_0002",
    exactSourcePath: SOURCE_B,
    sourceSha256: sha256(B_HTML),
    sessionEpoch: 4,
  });

  const outcome = await harness.workflow.viewHistory({
    version: { id: "ver_0001", contentSha256: sha256(detachedHistory) },
    context,
    switchPrepared: true,
  });

  assert.equal(outcome.status, "succeeded");
  assert.equal(harness.projectSession.projectId, "project_a");
  assert.equal(harness.calls.drain.length, 0);
  assert.equal(harness.calls.freeze, 0);
  assert.equal(harness.versionSession.snapshot.historyPreview.projectId, "project_b");
  assert.equal(harness.versionSession.snapshot.historyPreview.context.surfaceContextId, context.surfaceContextId);
  assert.equal((await harness.workflow.exportHtml({ suggestedName: "detached-b" })).status, "succeeded");
  assert.equal(exports.length, 1);
  assert.equal(exports[0].html, detachedHistory);
  assert.equal(exports[0].sourcePath, SOURCE_B);
  assert.equal(exports[0].suggestedName, "detached-b-V1.html");
});

test("failed history read retains persistence advanced by a successful drain", async () => {
  let write;
  const harness = createHarness({
    onDrain: async ({ documentSession }) => {
      documentSession.acceptWriteConfirmation({
        write,
        html: write.html,
        sourceSha256: sha256(write.html),
        persistedRevision: write.revision,
      });
      return { ok: true };
    },
    versionRead: async () => { throw new Error("history read failed"); },
  });
  const accepted = harness.documentSession.acceptEdit({
    html: DRAINED_HTML,
    write: {
      targetHtmlSha256: sha256(DRAINED_HTML),
    },
  });
  write = accepted.write;
  harness.documentSession.beginWrite();

  const outcome = await harness.workflow.viewHistory({
    version: {
      id: "ver_0001",
      contentSha256: sha256(HISTORY_HTML),
    },
    context: harness.context,
  });

  assert.equal(outcome.status, "rejected");
  assert.equal(harness.documentSession.html, DRAINED_HTML);
  assert.equal(harness.documentSession.persistedSourceSha256, sha256(DRAINED_HTML));
  assert.equal(harness.documentSession.editRevision, 1);
  assert.equal(harness.documentSession.lastPersistedRevision, 1);
  assert.equal(harness.documentSession.persistState, "idle");
  assert.equal(harness.documentSession.pendingWrite, null);
  assert.equal(harness.calls.render.length, 0);
});

test("history rollback retains persistence advanced before a later drain failure", async () => {
  let write;
  const harness = createHarness({
    onDrain: async ({ documentSession }) => {
      documentSession.acceptWriteConfirmation({
        write,
        html: write.html,
        sourceSha256: sha256(write.html),
        persistedRevision: write.revision,
      });
      return { ok: false, reason: "draft persistence failed" };
    },
  });
  const accepted = harness.documentSession.acceptEdit({
    html: DRAINED_HTML,
    write: {
      targetHtmlSha256: sha256(DRAINED_HTML),
    },
  });
  write = accepted.write;
  harness.documentSession.beginWrite();

  const outcome = await harness.workflow.viewHistory({
    version: {
      id: "ver_0001",
      contentSha256: sha256(HISTORY_HTML),
    },
    context: harness.context,
  });

  assert.equal(outcome.status, "rejected");
  assert.equal(harness.calls.versionFile.length, 0);
  assert.equal(harness.documentSession.html, DRAINED_HTML);
  assert.equal(harness.documentSession.persistedSourceSha256, sha256(DRAINED_HTML));
  assert.equal(harness.documentSession.editRevision, 1);
  assert.equal(harness.documentSession.lastPersistedRevision, 1);
  assert.equal(harness.documentSession.persistState, "idle");
  assert.equal(harness.documentSession.pendingWrite, null);
  assert.equal(harness.calls.render.length, 0);
});

test("failed history load leaves the current source and navigation exit available", async () => {
  const harness = createHarness({ versionRead: async () => ({ projectId: "other", documentId: "document_a", versionId: "ver_0001", content: HISTORY_HTML, sha256: sha256(HISTORY_HTML) }) });
  const outcome = await harness.workflow.viewHistory({ version: { id: "ver_0001" }, context: harness.context });
  assert.equal(outcome.status, "rejected");
  assert.equal(harness.documentSession.html, BASE_HTML);
  assert.equal(harness.versionSession.snapshot.viewMode, "current");
  assert.equal(harness.workflow.getSnapshot().navigation.phase, "idle");
  assert.equal((await harness.workflow.returnToCurrent({ context: harness.context })).status, "succeeded");
});

test("return-current preserves working authority and checks external changes independently", async () => {
  const observation = deferred();
  let observedPath;
  const harness = createHarness({ observeExternalSourceChange: ({ sourcePath }) => {
    observedPath = sourcePath;
    return observation.promise;
  } });
  const before = harness.documentSession.snapshot;
  await harness.workflow.viewHistory({ version: { id: "ver_0001" }, context: harness.context });
  const outcome = await harness.workflow.returnToCurrent({ context: harness.context });
  assert.equal(outcome.status, "succeeded");
  assert.equal(observedPath, SOURCE_A);
  assert.deepEqual(harness.documentSession.snapshot, before);
  assert.equal(harness.calls.source.length, 0);
  assert.equal(harness.calls.render.length, 0);
  assert.equal(harness.versionSession.snapshot.viewMode, "current");
  assert.equal(harness.versionSession.snapshot.historyPreview, null);
  assert.equal(harness.versionSession.snapshot.currentExactVersionId, "ver_0001");
  observation.resolve({ status: "rejected", reason: "file unavailable" });
});

test("a late historical read cannot publish into another project", async () => {
  const read = deferred();
  const harness = createHarness({ versionRead: () => read.promise });
  const pending = harness.workflow.viewHistory({ version: { id: "ver_0001" }, context: harness.context });
  await new Promise((resolve) => setTimeout(resolve, 0));
  harness.projectSession.openLocator(SOURCE_B);
  harness.versionSession.reset();
  harness.documentSession.publishAuthority({ html: B_HTML, persistedSourceSha256: sha256(B_HTML) });
  read.resolve({ projectId: "project_a", documentId: "document_a", versionId: "ver_0001", content: HISTORY_HTML, sha256: sha256(HISTORY_HTML) });
  assert.equal((await pending).status, "stale");
  assert.equal(harness.documentSession.html, B_HTML);
  assert.equal(harness.versionSession.snapshot.historyPreview, null);
});

function historyCreatedResult(operationId) {
  return { status: "created", operationId, projectId: "project_a", documentId: "document_a",
    versionId: "ver_0002", versionOrdinal: 2, workingCopyId: "work_ver_0002", basedOnVersionId: "ver_0001",
    previousVersionId: "ver_0001", contentSha256: sha256(HISTORY_HTML), sourcePath: HISTORY_WORKING_COPY_PATH, openedAt: null, recoveryState: "pending" };
}

test("manual creation reconciles a lost receipt without repeating the command or publishing Document", async () => {
  const operationId = "history_create_lost_0001";
  const harness = createHarness({ createHistory: async () => { throw new Error("lost receipt"); },
    queryCreation: async () => historyCreatedResult(operationId) });
  await harness.workflow.viewHistory({ version: { id: "ver_0001" }, context: harness.context });
  const before = harness.documentSession.snapshot;
  const result = await harness.workflow.createVersionFromHistory({ operationId, context: harness.context });
  assert.equal(result.status, "succeeded");
  assert.equal(result.value.versionId, "ver_0002");
  assert.equal(harness.calls.createHistory.length, 1);
  assert.equal(harness.calls.queryCreation.length, 1);
  assert.equal(harness.calls.queryCreation[0].operationId, operationId);
  assert.deepEqual(harness.documentSession.snapshot, before);
  assert.equal(harness.versionSession.snapshot.viewMode, "history");
  assert.equal(harness.workflow.getSnapshot().creation.phase, "created");
});

test("detached history creation uses its own source identity without draining the runtime project", async () => {
  const operationId = "history_create_detached_0001";
  const detachedHistory = "<!doctype html><html><body><p>detached history</p></body></html>";
  const context = Object.freeze({
    surfaceContextId: "surface:create:project_b:document_b",
    epoch: 0,
    projectId: "project_b",
    documentId: "document_b",
    sourcePath: SOURCE_B,
    projectRootPath: "/tmp/project-b",
    targetKind: "working-copy",
    workingCopyId: "work_ver_0001",
    versionId: "ver_0001",
    exactSourcePath: SOURCE_B,
    sourceSha256: sha256(B_HTML),
    sessionEpoch: 0,
  });
  const created = {
    status: "created",
    operationId,
    projectId: context.projectId,
    documentId: context.documentId,
    versionId: "ver_0002",
    versionOrdinal: 2,
    workingCopyId: "work_ver_0002",
    basedOnVersionId: "ver_0001",
    previousVersionId: "ver_0001",
    contentSha256: sha256(detachedHistory),
    sourcePath: "/tmp/version-workflow-b-v2.html",
    openedAt: null,
    recoveryState: "pending",
  };
  const harness = createHarness({
    versionRead: async (_sourcePath, versionId) => ({
      projectId: context.projectId,
      documentId: context.documentId,
      versionId,
      content: detachedHistory,
      sha256: sha256(detachedHistory),
    }),
    createHistory: async () => created,
  });
  await harness.workflow.viewHistory({
    version: { id: "ver_0001", contentSha256: sha256(detachedHistory) },
    context,
    switchPrepared: true,
  });

  const outcome = await harness.workflow.createVersionFromHistory({ operationId, context });

  assert.equal(outcome.status, "succeeded");
  assert.equal(harness.calls.drain.length, 0);
  assert.equal(harness.calls.createHistory[0].expectedSourceSha256, sha256(B_HTML));
  assert.equal(harness.calls.createHistory[0].expectedSnapshotSha256, sha256(detachedHistory));
  assert.equal(harness.projectSession.projectId, "project_a");
});

test("unknown manual creation stays queryable with the same operation", async () => {
  const operationId = "history_create_unknown_0001";
  let available = false;
  const harness = createHarness({ createHistory: async () => { throw new Error("timeout"); }, queryCreation: async () => {
    if (!available) throw new Error("offline");
    return historyCreatedResult(operationId);
  } });
  await harness.workflow.viewHistory({ version: { id: "ver_0001" }, context: harness.context });
  const result = await harness.workflow.createVersionFromHistory({ operationId, context: harness.context });
  assert.equal(result.status, "unknown");
  assert.equal(result.operationId, operationId);
  available = true;
  const queried = await harness.workflow.queryHistoryCreation({ operationId, context: harness.context });
  assert.equal(queried.status, "succeeded");
  assert.equal(harness.calls.createHistory.length, 1);
});

test("a delayed operation query cannot overwrite the next operation result", async () => {
  const delayed = deferred();
  const harness = createHarness({ queryCreation: ({ operationId }) => operationId === "history_old_0001"
    ? delayed.promise : Promise.resolve(historyCreatedResult(operationId)) });
  const old = harness.workflow.queryHistoryCreation({ operationId: "history_old_0001", context: harness.context });
  await harness.workflow.queryHistoryCreation({ operationId: "history_new_0001", context: harness.context });
  delayed.resolve(historyCreatedResult("history_old_0001"));
  await old;
  assert.equal(harness.workflow.getSnapshot().creation.operationId, "history_new_0001");
});

function createdWorkspace() {
  return { ok: true, projectId: "project_a", documentId: "document_a", sourcePath: HISTORY_WORKING_COPY_PATH,
    content: HISTORY_HTML, currentHtmlSha256: sha256(HISTORY_HTML), latestVersionId: "ver_0002",
    currentBasedOnVersionId: "ver_0002", currentExactVersionId: "ver_0002", restoredFromVersionId: null,
    versions: [versionRecord({ id: "ver_0001", content: HISTORY_HTML }), {
      ...versionRecord({ id: "ver_0002", content: HISTORY_HTML }), sourceType: "history-copy",
      sourceOperationId: "history_open_0001", sourceRequestId: null, sourceCandidateId: null,
      basedOnVersionId: "ver_0001", previousVersionId: "ver_0001", baseSnapshotSha256: sha256(HISTORY_HTML),
    }], activeDraft: { draftRevision: 0, comments: [], changeEvents: [] },
    openTarget: { targetKind: "working-copy", projectId: "project_a", documentId: "document_a",
      projectRootPath: "/tmp/project-a", versionId: "ver_0002", workingCopyId: "work_ver_0002",
      exactSourcePath: HISTORY_WORKING_COPY_PATH, sourceSha256: sha256(HISTORY_HTML) } };
}

test("created history opens through verified workspace and lost opened acknowledgement cannot recreate", async () => {
  const operationId = "history_open_0001";
  const harness = createHarness({ queryCreation: async () => historyCreatedResult(operationId),
    workspaceRead: async () => createdWorkspace(), confirmCreation: async () => { throw new Error("lost acknowledgement"); } });
  const outcome = await harness.workflow.openCreatedHistoryVersion({ operationId, context: harness.context });
  assert.equal(outcome.status, "succeeded", outcome.reason);
  assert.equal(harness.documentSession.html, HISTORY_HTML);
  assert.equal(harness.versionSession.snapshot.currentBasedOnVersionId, "ver_0002");
  assert.equal(harness.versionSession.snapshot.viewMode, "current");
  assert.ok(harness.calls.order.indexOf("current-surface") < harness.calls.order.indexOf("render"));
  assert.equal(harness.calls.currentSurface[0].context.workingCopyId, "work_ver_0002");
  assert.equal(harness.calls.drain.length, 0);
  assert.equal(harness.workflow.getSnapshot().creation.phase, "opened");
  assert.equal(harness.calls.createHistory.length, 0);
});

test("created history stops before Canvas verification when the current surface cannot commit", async () => {
  const operationId = "history_open_0001";
  const harness = createHarness({
    queryCreation: async () => historyCreatedResult(operationId),
    workspaceRead: async () => createdWorkspace(),
    commitCurrentSurface: async () => ({
      status: "rejected",
      code: "WORKBENCH_TAB_COMMIT_REJECTED",
      reason: "current tab unavailable",
    }),
  });

  const outcome = await harness.workflow.openCreatedHistoryVersion({
    operationId,
    context: harness.context,
  });

  assert.equal(outcome.status, "rejected");
  assert.equal(outcome.code, "HISTORY_CREATED_OPEN_FAILED");
  assert.match(outcome.reason, /current tab unavailable/u);
  assert.equal(harness.calls.currentSurface.length, 1);
  assert.equal(harness.calls.render.length, 0);
  assert.equal(harness.versionSession.snapshot.viewMode, "current");
  assert.equal(harness.workflow.getSnapshot().creation.phase, "open-failed");
});

test("created history workspace failure keeps history usable and retries only opening", async () => {
  const operationId = "history_open_0001";
  let fail = true;
  const harness = createHarness({ queryCreation: async () => historyCreatedResult(operationId), workspaceRead: async () => {
    if (fail) throw new Error("load failed");
    return createdWorkspace();
  } });
  await harness.workflow.viewHistory({ version: { id: "ver_0001" }, context: harness.context });
  const before = harness.documentSession.snapshot;
  assert.equal((await harness.workflow.openCreatedHistoryVersion({ operationId, context: harness.context })).status, "rejected");
  assert.deepEqual(harness.documentSession.snapshot, before);
  assert.equal(harness.versionSession.snapshot.viewMode, "history");
  assert.equal(harness.workflow.getSnapshot().creation.phase, "open-failed");
  assert.equal((await harness.workflow.createVersionFromHistory({ operationId: "history_duplicate_0001", context: harness.context })).status, "blocked");
  fail = false;
  assert.equal((await harness.workflow.openCreatedHistoryVersion({ operationId, context: harness.context })).status, "succeeded");
  assert.equal(harness.calls.createHistory.length, 0);
});

test("created history reports a current-authority failure when Canvas verification fails after commit", async () => {
  const operationId = "history_open_0001";
  const harness = createHarness({
    queryCreation: async () => historyCreatedResult(operationId),
    workspaceRead: async () => createdWorkspace(),
    verifyRendered: async (_html, _hash, nextContext) => {
      if (nextContext.workingCopyId === "work_ver_0002") throw new Error("canvas failed after commit");
    },
  });
  assert.equal((await harness.workflow.viewHistory({
    version: { id: "ver_0001" },
    context: harness.context,
  })).status, "succeeded");

  const outcome = await harness.workflow.openCreatedHistoryVersion({ operationId, context: harness.context });
  assert.equal(outcome.status, "rejected");
  assert.equal(outcome.code, "HISTORY_CREATED_OPEN_FAILED");
  assert.match(outcome.reason, /canvas failed after commit/u);
  assert.equal(harness.documentSession.html, HISTORY_HTML);
  assert.equal(harness.projectSession.context.workingCopyId, "work_ver_0002");
  assert.equal(harness.versionSession.snapshot.viewMode, "current");
  assert.equal(harness.versionSession.snapshot.currentBasedOnVersionId, "ver_0002");
  assert.equal(harness.workflow.getSnapshot().creation.phase, "open-failed");
});

test("created history preserves its creation operation when managed transition outcome is unknown", async () => {
  const operationId = "history_open_unknown_0001";
  const harness = createHarness({
    queryCreation: async () => historyCreatedResult(operationId),
    workspaceRead: async () => createdWorkspace(),
    prepareTransition: async () => {
      throw Object.assign(new Error("managed transition response lost"), {
        projectOutcome: "unknown",
      });
    },
  });

  const outcome = await harness.workflow.openCreatedHistoryVersion({
    operationId,
    context: harness.context,
  });

  assert.equal(outcome.status, "unknown");
  assert.equal(outcome.operationId, operationId);
  assert.equal(harness.calls.prepare.length, 1);
  assert.equal(harness.calls.prepare[0].operationId, operationId);
  assert.equal(harness.calls.commit.length, 0);
  assert.equal(harness.workflow.getSnapshot().creation.phase, "open-failed");
});

test("created history becomes same-operation unknown when navigation retires after host activation", async () => {
  const operationId = "history_open_retired_0001";
  const transition = deferred();
  const harness = createHarness({
    queryCreation: async () => historyCreatedResult(operationId),
    workspaceRead: async () => createdWorkspace(),
    prepareTransition: async () => transition.promise,
  });
  const opening = harness.workflow.openCreatedHistoryVersion({
    operationId,
    context: harness.context,
  });
  while (harness.calls.prepare.length === 0) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  harness.workflow.dispose();
  transition.resolve(Object.freeze({
    updatesCurrentProject: true,
    coordination: Object.freeze({ operationId }),
    activatedProject: Object.freeze({
      operationId,
      sourcePath: HISTORY_WORKING_COPY_PATH,
      sha256: sha256(HISTORY_HTML),
      html: HISTORY_HTML,
    }),
  }));

  const outcome = await opening;

  assert.equal(outcome.status, "unknown");
  assert.equal(outcome.operationId, operationId);
  assert.equal(harness.calls.commit.length, 0);
});

test("created history late workspace never publishes across a project switch", async () => {
  const delayed = deferred();
  const harness = createHarness({ queryCreation: async () => historyCreatedResult("history_open_0001"), workspaceRead: () => delayed.promise });
  const opening = harness.workflow.openCreatedHistoryVersion({ operationId: "history_open_0001", context: harness.context });
  await new Promise((resolve) => setTimeout(resolve, 0));
  harness.projectSession.openLocator(SOURCE_B);
  harness.documentSession.publishAuthority({ html: B_HTML, persistedSourceSha256: sha256(B_HTML) });
  delayed.resolve(createdWorkspace());
  assert.equal((await opening).status, "stale");
  assert.equal(harness.documentSession.html, B_HTML);
  assert.equal(harness.calls.commit.length, 0);
});

test("restart restores an unacknowledged creation and leaves acknowledged operation quiet", async () => {
  let openedAt = null;
  const harness = createHarness({ queryCreation: async () => ({ ...historyCreatedResult("history_open_0001"), openedAt }) });
  await harness.workflow.restoreHistoryCreation({ operationId: "history_open_0001", context: harness.context });
  assert.equal(harness.workflow.getSnapshot().creation.phase, "created");
  openedAt = "2026-09-08T00:00:00.000Z";
  await harness.workflow.restoreHistoryCreation({ operationId: "history_open_0001", context: harness.context });
  assert.equal(harness.workflow.getSnapshot().creation.phase, "opened");
  assert.equal(harness.calls.createHistory.length, 0);
});

test("restart acknowledges a created Version after the hydrated current Canvas settles", async () => {
  let acknowledgements = 0;
  const operationId = "history_open_0001";
  const harness = createHarness({
    currentDraft: true,
    queryCreation: async () => historyCreatedResult(operationId),
    confirmCreation: async () => { acknowledgements += 1; },
  });
  const locator = harness.projectSession.openLocator(HISTORY_WORKING_COPY_PATH);
  const context = harness.projectSession.register({
    ...locator,
    projectId: "project_a",
    documentId: "document_a",
    openTarget: {
      projectId: "project_a",
      documentId: "document_a",
      projectRootPath: "/tmp/project-a",
      targetKind: "working-copy",
      workingCopyId: "work_ver_0002",
      versionId: "ver_0002",
      exactSourcePath: HISTORY_WORKING_COPY_PATH,
      sourceSha256: sha256(HISTORY_HTML),
    },
  });
  harness.documentSession.publishAuthority({
    html: HISTORY_HTML,
    persistedSourceSha256: sha256(HISTORY_HTML),
  });
  harness.versionSession.hydrate({
    versions: decodedVersions([
      versionRecord({ id: "ver_0001", content: BASE_HTML }),
      versionRecord({ id: "ver_0002", content: HISTORY_HTML }),
    ]),
    latestVersionId: "ver_0002",
    currentBasedOnVersionId: "ver_0002",
    currentExactVersionId: "ver_0002",
  });

  await harness.workflow.restoreHistoryCreation({ operationId, context });

  assert.equal(harness.workflow.getSnapshot().creation.phase, "opened");
  assert.equal(acknowledgements, 1);
  assert.equal(harness.calls.render.length, 1);
});

test("return-current reconciles committed creation rather than re-exposing the old working file", async () => {
  const operationId = "history_open_0001";
  const currentSurfaceCommitScope = Object.freeze({});
  const harness = createHarness({ queryCreation: async () => historyCreatedResult(operationId), workspaceRead: async () => createdWorkspace() });
  await harness.workflow.viewHistory({ version: { id: "ver_0001" }, context: harness.context });
  await harness.workflow.queryHistoryCreation({ operationId, context: harness.context });
  assert.equal((await harness.workflow.returnToCurrent({
    context: harness.context,
    currentSurfaceCommitScope,
  })).status, "succeeded");
  assert.equal(harness.projectSession.sourcePath, HISTORY_WORKING_COPY_PATH);
  assert.equal(harness.calls.createHistory.length, 0);
  assert.equal(harness.calls.currentSurface[0].currentSurfaceCommitScope, currentSurfaceCommitScope);
});


test("a lost opened acknowledgement followed by a later Version cannot resurrect the old recovery action", async () => {
  const operationId = "history_open_0001";
  let workspaceReads = 0;
  const harness = createHarness({ queryCreation: async () => ({ ...historyCreatedResult(operationId), recoveryState: "superseded" }),
    workspaceRead: async () => { workspaceReads += 1; return createdWorkspace(); } });
  await harness.workflow.restoreHistoryCreation({ operationId, context: harness.context });
  assert.equal(harness.workflow.getSnapshot().creation.phase, "superseded");
  assert.equal((await harness.workflow.openCreatedHistoryVersion({ operationId, context: harness.context })).code, "HISTORY_CREATION_SUPERSEDED");
  assert.equal(workspaceReads, 0);
  assert.equal(harness.calls.commit.length, 0);
  assert.equal(harness.documentSession.html, BASE_HTML);
});

test("later iteration while reading the created workspace stops publication", async () => {
  let queries = 0;
  const harness = createHarness({ queryCreation: async () => ({ ...historyCreatedResult("history_open_0001"),
    recoveryState: ++queries > 1 ? "superseded" : "pending" }), workspaceRead: async () => createdWorkspace() });
  assert.equal((await harness.workflow.openCreatedHistoryVersion({ operationId: "history_open_0001", context: harness.context })).code, "HISTORY_CREATION_SUPERSEDED");
  assert.equal(harness.calls.prepare.length, 0);
  assert.equal(harness.calls.commit.length, 0);
});


test("repairing an opened acknowledgement verifies current Canvas without reopening its workspace", async () => {
  let reads = 0;
  let acknowledgements = 0;
  const harness = createHarness({ queryCreation: async () => historyCreatedResult("history_open_0001"),
    workspaceRead: async () => { reads += 1; return createdWorkspace(); },
    confirmCreation: async () => { acknowledgements += 1; throw new Error("lost acknowledgement"); } });
  assert.equal((await harness.workflow.openCreatedHistoryVersion({ operationId: "history_open_0001", context: harness.context })).status, "succeeded");
  const createdContext = harness.projectSession.context;
  await harness.workflow.viewHistory({ version: { id: "ver_0001" }, context: createdContext });
  await harness.workflow.queryHistoryCreation({ operationId: "history_open_0001", context: createdContext });
  const commits = harness.calls.commit.length;
  assert.equal((await harness.workflow.returnToCurrent({ context: createdContext })).status, "succeeded");
  assert.equal(harness.workflow.getSnapshot().creation.phase, "opened");
  assert.equal(reads, 1);
  assert.equal(harness.calls.commit.length, commits);
  assert.equal(acknowledgements, 2);
});


test("adoption refuses mutation when newer draft comments cannot drain", async () => {
  const harness = createHarness({ onDrain: async () => ({ ok: false, reason: "Draft save failed" }) });
  const run = readyRun();
  harness.runSession.trackRun(run, { activate: "always" });
  const outcome = await harness.workflow.activateReadyVersion({ run });
  assert.equal(outcome.code, "ADOPTION_DRAFT_NOT_SAVED");
  assert.equal(harness.calls.activate, 0);
  assert.equal(harness.runSession.activeRun.status, "ready-to-open");
});


test("lost adoption reply reconciles the same Candidate decision without a new operation", async () => {
  let count = 0;
  const harness = createHarness({ activation: async (input) => {
    if (++count === 1) throw new BridgeRequestError("response lost", { outcome: "unknown" });
    const version = versionRecord({ id: input.versionId });
    return { ...input, contentSha256: version.contentSha256, sourceSha256: version.contentSha256,
      currentHtmlSha256: version.contentSha256, sourcePath: SOURCE_A,
      openTarget: promotedOpenTarget(input, { sourceSha256: version.contentSha256 }), version };
  } });
  const run = readyRun({ candidateId: "candidate_synthetic" });
  harness.runSession.trackRun(run, { activate: "always" });
  const outcome = await harness.workflow.activateReadyVersion({ run });
  assert.equal(outcome.status, "succeeded");
  assert.equal(harness.calls.activate, 2);
  assert.deepEqual(harness.calls.activateInputs[0], harness.calls.activateInputs[1]);
  assert.equal(harness.calls.activateInputs[0].decisionOperationId, "promote_candidate_synthetic");
  assert.equal(harness.calls.prepare[0].operationId, "promote_candidate_synthetic");
  assert.equal(harness.calls.commit.length, 1);
});

test("committed adoption read failure reconciles the same decision without draining the old draft again", async (t) => {
  let reads = 0;
  const harness = createHarness({ sourceRead: async (sourcePath) => {
    if (++reads === 1) throw new BridgeRequestError("current bytes unavailable", { outcome: "rejected" });
    return {
      projectId: "project_a", documentId: "document_a", sourcePath,
      content: CANDIDATE_HTML, sha256: sha256(CANDIDATE_HTML),
      currentBasedOnVersionId: "ver_0002", currentExactVersionId: "ver_0002",
      restoredFromVersionId: null, lastModifiedAt: "2026-08-12T00:00:02.000Z",
    };
  } });
  t.after(() => harness.workflow.dispose());
  const run = readyRun();
  harness.runSession.trackRun(run, { activate: "always" });

  const outcome = await harness.workflow.activateReadyVersion({ run });

  assert.equal(outcome.status, "unknown");
  assert.equal(outcome.operationId, "promote_candidate_ready_0001");
  assert.equal(harness.calls.commit.length, 0);
  assert.equal(harness.documentSession.html, BASE_HTML);
  assert.equal(harness.runSession.activeRun.adoptionPhase, "unknown");
  assert.equal((await harness.workflow.activateReadyVersion({ run })).code, "VERSION_ACTIVATION_BUSY");

  await new Promise((resolve) => setTimeout(resolve, 1150));

  assert.equal(harness.runSession.activeRun.status, "complete");
  assert.equal(harness.calls.activate, 2);
  assert.deepEqual(harness.calls.activateInputs[0], harness.calls.activateInputs[1]);
  assert.equal(harness.calls.drain.length, 1);
  assert.equal(harness.calls.commit.length, 1);
  assert.equal(harness.documentSession.html, CANDIDATE_HTML);
  assert.equal(harness.runSession.isOperationBusy("activate", operationKey(run)), false);
});

test("adoption read reconciliation retains a real source conflict instead of publishing different bytes", async (t) => {
  let reads = 0;
  const harness = createHarness({ sourceRead: async (sourcePath) => {
    if (++reads === 1) throw new BridgeRequestError("current bytes unavailable", { outcome: "rejected" });
    return {
      projectId: "project_a", documentId: "document_a", sourcePath,
      content: B_HTML, sha256: sha256(B_HTML),
      lastModifiedAt: "2026-08-12T00:00:02.000Z",
    };
  } });
  t.after(() => harness.workflow.dispose());
  const run = readyRun();
  harness.runSession.trackRun(run, { activate: "always" });
  assert.equal((await harness.workflow.activateReadyVersion({ run })).status, "unknown");
  harness.documentSession.recordPersistenceFailure({ conflict: true, error: "external bytes changed" });

  await new Promise((resolve) => setTimeout(resolve, 1150));

  assert.equal(harness.calls.activate, 2);
  assert.deepEqual(harness.calls.activateInputs[0], harness.calls.activateInputs[1]);
  assert.equal(harness.calls.commit.length, 0);
  assert.equal(harness.documentSession.html, BASE_HTML);
  assert.equal(harness.documentSession.persistState, "conflict");
  assert.equal(harness.runSession.activeRun.adoptionPhase, undefined);
  assert.equal(harness.runSession.isOperationBusy("activate", operationKey(run)), false);
});

test("adoption preserves and reconciles the Candidate decision when managed transition outcome is unknown", async (t) => {
  const candidateId = "candidate_transition_unknown";
  let transitions = 0;
  const harness = createHarness({
    prepareTransition: async (input) => {
      transitions += 1;
      if (transitions === 1) {
        throw Object.assign(new Error("managed transition response lost"), {
          projectOutcome: "unknown",
        });
      }
      return Object.freeze({
        previousSourcePath: input.previousSourcePath,
        nextSourcePath: input.nextSourcePath,
        projectId: input.nextProjectId,
        documentId: input.nextDocumentId,
        openTarget: input.openTarget || null,
        updatesCurrentProject: true,
        activatedProject: null,
      });
    },
  });
  t.after(() => harness.workflow.dispose());
  const run = readyRun({ candidateId });
  harness.runSession.trackRun(run, { activate: "always" });

  const outcome = await harness.workflow.activateReadyVersion({ run });

  assert.equal(outcome.status, "unknown");
  assert.equal(outcome.operationId, `promote_${candidateId}`);
  assert.equal(harness.calls.activate, 1);
  assert.equal(
    harness.calls.activateInputs[0].decisionOperationId,
    `promote_${candidateId}`,
  );
  assert.equal(harness.calls.prepare.length, 1);
  assert.equal(harness.calls.prepare[0].operationId, `promote_${candidateId}`);
  assert.equal(harness.calls.commit.length, 0);
  assert.equal(harness.runSession.activeRun.adoptionPhase, "unknown");
  assert.equal(harness.runSession.isOperationBusy("activate", operationKey(run)), true);
  assert.equal((await harness.workflow.activateReadyVersion({ run })).code, "VERSION_ACTIVATION_BUSY");

  await new Promise((resolve) => setTimeout(resolve, 1150));

  assert.equal(harness.runSession.activeRun.status, "complete");
  assert.equal(harness.runSession.activeRun.adoptionPhase, undefined);
  assert.equal(harness.calls.activate, 2);
  assert.deepEqual(harness.calls.activateInputs[0], harness.calls.activateInputs[1]);
  assert.equal(harness.calls.prepare.length, 2);
  assert.equal(harness.calls.prepare[1].operationId, `promote_${candidateId}`);
  assert.equal(harness.calls.commit.length, 1);
  assert.equal(harness.runSession.isOperationBusy("activate", operationKey(run)), false);
});

test("adoption becomes same-decision unknown when navigation retires after host activation", async () => {
  const candidateId = "candidate_transition_retired";
  const decisionOperationId = `promote_${candidateId}`;
  const transition = deferred();
  const harness = createHarness({
    prepareTransition: async () => transition.promise,
  });
  const run = readyRun({ candidateId });
  harness.runSession.trackRun(run, { activate: "always" });
  const activation = harness.workflow.activateReadyVersion({ run });
  while (harness.calls.prepare.length === 0) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  harness.workflow.dispose();
  transition.resolve(Object.freeze({
    updatesCurrentProject: true,
    coordination: Object.freeze({ operationId: decisionOperationId }),
    activatedProject: Object.freeze({
      operationId: decisionOperationId,
      sourcePath: SOURCE_A,
      sha256: sha256(CANDIDATE_HTML),
      html: CANDIDATE_HTML,
    }),
  }));

  const outcome = await activation;

  assert.equal(outcome.status, "unknown");
  assert.equal(outcome.operationId, decisionOperationId);
  assert.equal(harness.calls.commit.length, 0);
});

test("two lost adoption replies retain one decision and automatically reconcile without a second user action", async (t) => {
  let replies = 0;
  const harness = createHarness({ activation: async (input) => {
    replies += 1;
    if (replies <= 2) throw new BridgeRequestError("lost committed reply", { outcome: "unknown" });
    const version = versionRecord({ id: input.versionId });
    return { projectId: input.projectId, documentId: input.documentId,
      requestId: input.requestId, attemptId: input.attemptId, versionId: input.versionId,
      contentSha256: version.contentSha256, sourceSha256: version.contentSha256,
      currentHtmlSha256: version.contentSha256, sourcePath: SOURCE_A,
      openTarget: promotedOpenTarget(input, { sourceSha256: version.contentSha256 }),
      candidateDisplayVersionLabel: "版本 2", version };
  } });
  t.after(() => harness.workflow.dispose());
  const run = readyRun({ candidateId: "candidate_adoption_recovery" });
  harness.runSession.trackRun(run, { activate: "always" });
  const outcome = await harness.workflow.activateReadyVersion({ run });
  assert.equal(outcome.status, "unknown");
  assert.equal(harness.runSession.activeRun.adoptionPhase, "unknown");
  assert.equal(harness.runSession.isOperationBusy("activate", operationKey(run)), true);
  assert.equal(harness.workflow.getSnapshot().navigation.phase, "idle");
  assert.equal((await harness.workflow.activateReadyVersion({ run })).code, "VERSION_ACTIVATION_BUSY");
  assert.equal(harness.calls.activate, 2);
  await new Promise((resolve) => setTimeout(resolve, 1150));
  assert.equal(harness.runSession.activeRun.status, "complete");
  assert.equal(harness.calls.activate, 3);
  assert.deepEqual(harness.calls.activateInputs, Array(3).fill(harness.calls.activateInputs[0]));
  assert.equal(harness.calls.activateInputs[0].decisionOperationId, "promote_candidate_adoption_recovery");
  assert.equal(harness.calls.commit.length, 1);
  assert.equal(harness.runSession.isOperationBusy("activate", operationKey(run)), false);
});


for (const completion of ["success", "cancel", "failure"]) {
  test(`an export finishing after project switch releases the operation on ${completion}`, async () => {
    const pending = deferred();
    let count = 0;
    const h = createHarness({ currentDraft: true, exportHtmlCopy: async (input) => {
      if (++count === 1) {
        await pending.promise;
        if (completion === "cancel") return null;
        if (completion === "failure") throw new Error("export failed");
      }
      return { path: "/tmp/export-current.html", sha256: sha256(input.html) };
    } });
    const first = h.workflow.exportHtml();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const locator = h.projectSession.openLocator(SOURCE_B);
    h.projectSession.register({ ...locator, projectId: "project_b", documentId: "document_b" });
    h.documentSession.publishAuthority({ html: B_HTML, persistedSourceSha256: sha256(B_HTML) });
    pending.resolve();
    await first;
    assert.equal(h.workflow.getSnapshot().export, undefined);
    assert.equal((await h.workflow.exportHtml()).status, "succeeded");
    assert.equal(count, 2);
  });
}

test("browser download initiation never claims a verified export or creates a Version", async () => {
  let versions = 0;
  const h = createHarness({ currentDraft: true,
    createCurrent: async () => { versions++; },
    exportHtmlCopy: async () => ({ kind: "download-started" }) });
  assert.deepEqual((await h.workflow.exportHtml({ saveVersion: true })).value, { downloadStarted: true });
  assert.equal(h.workflow.getSnapshot().export.phase, "download-started");
  assert.equal(h.workflow.getSnapshot().export.path, undefined);
  assert.equal(versions, 0);
});

test("export blocked before local version creation never offers an unrelated operation retry", async () => {
  const h = createHarness({ currentDraft: true,
    createCurrent: async (input) => currentVersionReceipt(input),
    exportHtmlCopy: async (input) => ({ path: "/tmp/export-current.html", sha256: sha256(input.html) }) });
  await h.workflow.saveCurrentVersion();
  const previous = h.workflow.getSnapshot().draftVersion.operationId;
  h.runSession.trackRun(readyRun(), { activate: "always" });
  assert.equal((await h.workflow.exportHtml({ saveVersion: true })).status, "succeeded");
  assert.equal(h.workflow.getSnapshot().export.phase, "version-pending");
  assert.equal(h.workflow.getSnapshot().export.versionOperationId, undefined);
  assert.equal(h.workflow.getSnapshot().draftVersion.operationId, previous);
});

test("an old adoption receipt cannot open after current advances even with identical HTML", async () => {
  const h = createHarness();
  const run = readyRun();
  const outcome = await h.workflow.openCommittedVersion({ run, payload: {
    ...run.readyPayload, content: CANDIDATE_HTML, currentHtmlSha256: sha256(CANDIDATE_HTML),
    openTarget: { ...run.readyPayload.openTarget, versionId: "ver_0003", sourceSha256: sha256(CANDIDATE_HTML) },
  } });
  assert.equal(outcome.code, "VERSION_ACTIVATION_SUPERSEDED");
  assert.equal(h.calls.prepare.length, 0);
  assert.equal(h.calls.commit.length, 0);
  assert.equal(h.documentSession.html, BASE_HTML);
});

for (const reconcile of [false, true]) {
  test(`superseded adoption ${reconcile ? "reconciliation" : "response"} ends its operation without replacing current authority`, async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const run = readyRun({ candidateId: "candidate_superseded" });
    let replies = 0;
    const h = createHarness({ currentDraft: true, activation: async () => {
      if (reconcile && ++replies <= 2) {
        throw new BridgeRequestError("lost committed reply", { outcome: "unknown" });
      }
      return { ...run.readyPayload, openTarget: h.projectSession.openTarget };
    } });
    t.after(() => h.workflow.dispose());
    h.projectSession.register({ ...h.context, openTarget: {
      ...h.projectSession.openTarget, versionId: "ver_0003", sourceSha256: sha256(DRAINED_HTML),
    } });
    h.documentSession.publishAuthority({ html: DRAINED_HTML, persistedSourceSha256: sha256(DRAINED_HTML) });
    h.versionSession.hydrate({
      versions: decodedVersions([versionRecord({ id: "ver_0003", content: DRAINED_HTML })]),
      latestVersionId: "ver_0003", currentBasedOnVersionId: "ver_0003", currentExactVersionId: "ver_0003",
    });
    const currentContext = h.projectSession.context;
    const currentVersions = h.versionSession.captureSnapshot();
    h.runSession.trackRun(run, { activate: "always" });
    h.runSession.publishHandoff({ ...run, status: "starting" });
    const settled = deferred();
    h.runSession.subscribe(({ activeRun }) => {
      if (activeRun?.status === "complete") settled.resolve();
    });
    const outcome = await h.workflow.activateReadyVersion({ run });
    if (reconcile) {
      assert.equal(outcome.status, "unknown");
      assert.equal(h.runSession.isOperationBusy("activate", operationKey(run)), true);
      t.mock.timers.tick(1000);
      await settled.promise;
    } else {
      assert.equal(outcome.code, "VERSION_ACTIVATION_SUPERSEDED");
    }
    assert.equal(h.runSession.activeRun.status, "complete");
    assert.equal(h.runSession.activeRun.adoptionPhase, undefined);
    assert.equal(h.runSession.activeHandoff, null);
    assert.equal(h.runSession.hasRun(run), false);
    assert.equal(h.runSession.activeLocked, false);
    assert.equal(h.runSession.isOperationBusy("activate", operationKey(run)), false);
    assert.equal(h.workflow.getSnapshot().navigation.phase, "idle");
    assert.deepEqual(h.projectSession.context, currentContext);
    assert.deepEqual(h.versionSession.captureSnapshot(), currentVersions);
    assert.equal(h.documentSession.html, DRAINED_HTML);
    assert.equal(h.documentSession.persistedSourceSha256, sha256(DRAINED_HTML));
    assert.equal(h.calls.prepare.length, 0);
    assert.equal(h.calls.commit.length, 0);
    assert.equal(h.calls.refresh.length, 0);
    assert.equal(h.calls.versionFile.length, 0);
    await h.workflow.activateReadyVersion({ run });
    t.mock.timers.tick(60_000);
    assert.equal(h.calls.activate, reconcile ? 3 : 1);
  });
}

test("a superseded activation response cannot reclaim a newer active run or handoff", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const pending = deferred();
  const requested = deferred();
  const h = createHarness({ activation: async () => { requested.resolve(); return pending.promise; } });
  t.after(() => h.workflow.dispose());
  const run = readyRun({ candidateId: "candidate_superseded_owner" });
  h.runSession.trackRun(run, { activate: "always" });
  const activation = h.workflow.activateReadyVersion({ run });
  await requested.promise;
  const newerRun = readyRun({ requestId: "req_0002", candidateId: "candidate_new_owner" });
  h.runSession.trackRun(newerRun, { activate: "always" });
  h.runSession.publishHandoff({ ...newerRun, status: "starting" });
  const newerHandoff = h.runSession.activeHandoff;
  pending.resolve({ ...run.readyPayload, openTarget: { ...run.readyPayload.openTarget, versionId: "ver_0003" } });
  assert.equal((await activation).status, "stale");
  assert.deepEqual(h.runSession.activeRun, newerRun);
  assert.deepEqual(h.runSession.activeHandoff, newerHandoff);
  assert.equal(h.runSession.isOperationBusy("activate", operationKey(run)), false);
  assert.equal(h.calls.commit.length, 0);
  t.mock.timers.tick(60_000);
  assert.equal(h.calls.activate, 1);
});


test("a committed local version accepts the existing macOS path alias without losing draft hydration", async () => {
  const h = createHarness({ currentDraft: true, currentPath: "/private/tmp/version-workflow-a.html",
    sameSourcePathCodec: (a, b) => a?.replace(/^\/private(?=\/tmp\/)/u, "") === b?.replace(/^\/private(?=\/tmp\/)/u, ""),
    createCurrent: async (input) => currentVersionReceipt(input, { sourcePath: "/tmp/version-workflow-a.html" }),
  });
  const result = await h.workflow.saveCurrentVersion();
  assert.equal(result.status, "succeeded");
  assert.equal(h.workflow.getSnapshot().draftVersion.phase, "saved");
  assert.equal(h.calls.refresh.length, 1);
});

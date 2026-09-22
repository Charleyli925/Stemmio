import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { BridgeRequestError } from "../app/application/bridge-client.js";
import { CommentSession } from "../app/application/comment-session.js";
import { DocumentSession } from "../app/application/document-session.js";
import { DocumentWorkflow } from "../app/application/document-workflow.js";
import { ProjectSession } from "../app/application/project-session.js";
import { SourceHistorySession } from "../app/application/source-history-session.js";
import { VersionSession } from "../app/application/version-session.js";
import { auditEventKey, removeAcknowledgedAuditEvents } from "../app/lib/audit-events.js";
import { appendDirectEditEvent } from "../app/lib/direct-edit-events.js";
const SOURCE_PATH = "/tmp/document-workflow.html";
const NEXT_SOURCE_PATH = "/tmp/document-workflow-managed.html";
const PROJECT_ID = "project_document_workflow";
const DOCUMENT_ID = "document_document_workflow";

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function createScheduler() {
  let sequence = 0;
  const tasks = new Map();
  return {
    setTimeout(callback, delay) {
      const id = ++sequence;
      tasks.set(id, { callback, delay });
      return id;
    },
    clearTimeout(id) {
      tasks.delete(id);
    },
    run(id) {
      const task = tasks.get(id);
      tasks.delete(id);
      task?.callback();
    },
    get pending() {
      return [...tasks.entries()].map(([id, task]) => ({ id, ...task }));
    },
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolveValue, rejectValue) => {
    resolve = resolveValue;
    reject = rejectValue;
  });
  return { promise, resolve, reject };
}

function operation(before, after) {
  let startOffset = 0;
  while (
    startOffset < before.length
    && startOffset < after.length
    && before[startOffset] === after[startOffset]
  ) startOffset += 1;
  let beforeEnd = before.length;
  let afterEnd = after.length;
  while (
    beforeEnd > startOffset
    && afterEnd > startOffset
    && before[beforeEnd - 1] === after[afterEnd - 1]
  ) {
    beforeEnd -= 1;
    afterEnd -= 1;
  }
  return {
    operationId: "sourceop_document_workflow_001",
    kind: "text",
    editRevision: 1,
    createdAt: "2026-08-11T00:00:00.000Z",
    beforeSourceSha256: sha256(before),
    afterSourceSha256: sha256(after),
    forwardPatches: [{
      startOffset,
      endOffset: beforeEnd,
      before: before.slice(startOffset, beforeEnd),
      after: after.slice(startOffset, afterEnd),
      kind: "text",
    }],
    reversePatches: [{
      startOffset,
      endOffset: afterEnd,
      before: after.slice(startOffset, afterEnd),
      after: before.slice(startOffset, beforeEnd),
      kind: "inverse:text",
    }],
    beforeTarget: { id: "target-history", text: "one", resolution: "exact" },
    afterTarget: { id: "target-history", text: "two", resolution: "exact" },
    beforeSelection: { anchor: startOffset, focus: startOffset + 3, affinity: "right" },
    afterSelection: { anchor: startOffset + 3, focus: startOffset + 3, affinity: "right" },
  };
}

function createHarness({
  html = "<!doctype html><html><body><p>one</p></body></html>",
  bridge = {},
  codecOverrides = {},
  canvasOverrides = {},
  registered = true,
  ensureRegistered,
  recoveryJournal = null,
} = {}) {
  const projectSession = new ProjectSession();
  projectSession.openLocator(SOURCE_PATH);
  const context = {
    epoch: projectSession.epoch,
    projectId: PROJECT_ID,
    documentId: DOCUMENT_ID,
    sourcePath: SOURCE_PATH,
  };
  if (registered) projectSession.register(context);
  const documentSession = new DocumentSession({
    html,
    persistedSourceSha256: sha256(html),
  });
  const commentSession = new CommentSession();
  const versionSession = new VersionSession();
  const sourceHistorySession = new SourceHistorySession();
  sourceHistorySession.activate(
    context,
    sha256(html),
    null,
  );
  const scheduler = createScheduler();
  const configuredVerifyRendered = canvasOverrides.verifyRendered;
  const canvas = {
    invalidations: 0,
    rebuilds: 0,
    unlocks: 0,
    history: [],
    invalidateRenderAcks() {
      this.invalidations += 1;
    },
    adoptHistorySource(htmlValue, target, selection, operation) {
      this.history.push({ html: htmlValue, target, selection, operation });
    },
    rebuildActiveFrame() {
      this.rebuilds += 1;
    },
    captureActiveFrameFence() {
      return undefined;
    },
    unlock() {
      this.unlocks += 1;
    },
    ...canvasOverrides,
  };
  canvas.verifyRendered = async (...args) => {
    const configured = await configuredVerifyRendered?.(...args);
    if (configured) return configured;
    const [renderedHtml, renderedSha256, , receipt] = args;
    return Object.freeze({
      receipt: receipt || documentSession.sourceReceipt,
      renderedHtml: String(renderedHtml || ""),
      renderedSha256: String(renderedSha256 || ""),
      frameGeneration: documentSession.canvasGeneration,
    });
  };
  const client = {
    async autosave() {
      throw new Error("autosave test double was not configured");
    },
    async source() {
      throw new Error("source test double was not configured");
    },
    async workspace() {
      return {};
    },
    async resolveConflict() {
      return {};
    },
    ...bridge,
  };
  const workflow = new DocumentWorkflow({
    bridgeClient: client,
    ensureRegistered: ensureRegistered || (async () => ({
      status: "succeeded",
      value: context,
    })),
    projectSession,
    documentSession,
    commentSession,
    versionSession,
    sourceHistorySession,
    codecs: {
      isRecord,
      sameSourcePath: (left, right) => Boolean(left && right && left === right),
      persistedChangeEvent: (value) => value,
      recoveryIdentityFromRecord: (value) => value || null,
      sourceHistoryOperationsFromRecord: (value) => Array.isArray(value) ? value : [],
      changesFromRecords: (value) => Array.isArray(value) ? value : [],
      historyTextSelectionFromRecord: (value) => value || null,
      selectionFromRecord: (value) => value || null,
      rebindTargetsPreservingGlobal: (_html, targets) => targets,
      rebindTargetsAcrossHistoryPreservingGlobal: (_before, _after, targets) => targets,
      canLocateTarget: () => true,
      appendDirectEditEvent,
      auditEventKey,
      removeAcknowledgedAuditEvents,
      errorMessage: (cause, fallback) => String(cause?.message || fallback),
      ...codecOverrides,
    },
    ports: {
      hash: { sha256: async (value) => sha256(value) },
      ...(recoveryJournal ? { recoveryJournal } : {}),
      canvas,
    },
    scheduler,
    clock: { now: () => Date.parse("2026-08-11T00:00:00.000Z") },
  });
  return {
    workflow,
    context,
    projectSession,
    client,
    documentSession,
    commentSession,
    versionSession,
    sourceHistorySession,
    scheduler,
    canvas,
  };
}

test("DocumentWorkflow detaches a failed source only after Main journal readback evidence", async () => {
  const before = "<!doctype html><html><body><p>one</p></body></html>";
  const after = before.replace("one", "protected");
  const committed = [];
  const recoveryJournal = {
    async commit(input) {
      committed.push(structuredClone(input));
      return {
        schemaVersion: "2.0.0",
        ...input,
        recoveryHtmlSha256: sha256(input.html),
        journalSha256: sha256(JSON.stringify(input)),
        updatedAt: "2026-09-01T00:00:00.000Z",
        byteLength: Buffer.byteLength(input.html),
      };
    },
    async readVerified() {
      return null;
    },
    async remove() {
      return { removed: true };
    },
  };
  const harness = createHarness({
    html: before,
    recoveryJournal,
    bridge: {
      async autosave() {
        throw new BridgeRequestError("SOURCE_WRITE_FAILED", "disk denied");
      },
    },
  });

  harness.workflow.enqueueEdit({ html: after });
  const failed = await harness.workflow.flush({ throughRevision: 1 });
  assert.notEqual(failed.status, "succeeded");
  assert.equal(harness.documentSession.persistState, "failed");

  const protectedOutcome = await harness.workflow.protectForDetach({
    context: harness.context,
  });
  assert.equal(protectedOutcome.status, "succeeded");
  assert.equal(protectedOutcome.value.evidence, "recoveryVerified");
  assert.equal(harness.workflow.hasVerifiedRecoveryCheckpoint({
    context: harness.context,
    revision: 1,
  }), true);
  assert.equal(committed.at(-1).html, after);
  assert.equal(committed.at(-1).revision, 1);
});

test("DocumentWorkflow remains fail-closed when journal acknowledgement Hash is wrong", async () => {
  const before = "<!doctype html><html><body>one</body></html>";
  const after = before.replace("one", "unsafe");
  const harness = createHarness({
    html: before,
    recoveryJournal: {
      async commit(input) {
        return {
          ...input,
          recoveryHtmlSha256: sha256("different"),
          journalSha256: sha256("journal"),
          updatedAt: "2026-09-01T00:00:00.000Z",
        };
      },
      async readVerified() { return null; },
      async remove() { return { removed: true }; },
    },
  });
  harness.workflow.enqueueEdit({ html: after });
  const outcome = await harness.workflow.protectForDetach({ context: harness.context });
  assert.equal(outcome.status, "rejected");
  assert.equal(harness.workflow.hasVerifiedRecoveryCheckpoint({
    context: harness.context,
    revision: 1,
  }), false);
});

test("DocumentWorkflow rebases an exact recovery receipt after the source file moves", async () => {
  const before = "<!doctype html><html><body>one</body></html>";
  const after = before.replace("one", "protected-move");
  const movedPath = "/tmp/moved/document-workflow.html";
  let receipt = null;
  let rebaseCalls = 0;
  let readCalls = 0;
  const recoveryJournal = {
    async commit(input) {
      receipt = {
        ...input,
        recoveryHtmlSha256: sha256(input.html),
        journalSha256: sha256(`move:${input.sourcePath}:${input.revision}`),
        updatedAt: "2026-09-01T00:00:00.000Z",
      };
      return receipt;
    },
    async readVerified() {
      readCalls += 1;
      return receipt;
    },
    async rebase(input) {
      rebaseCalls += 1;
      assert.equal(input.previousSourcePath, SOURCE_PATH);
      assert.equal(input.sourcePath, movedPath);
      assert.equal(input.expectedJournalSha256, receipt.journalSha256);
      if (rebaseCalls === 1) throw new Error("transient rebase failure");
      receipt = {
        ...receipt,
        sourcePath: movedPath,
        journalSha256: sha256(`move:${movedPath}:${receipt.revision}`),
      };
      return receipt;
    },
    async remove() { return { removed: true }; },
  };
  const harness = createHarness({ html: before, recoveryJournal });
  harness.workflow.enqueueEdit({ html: after });
  assert.equal((await harness.workflow.protectForDetach({
    context: harness.context,
  })).status, "succeeded");
  const nextContext = harness.projectSession.transitionSource({
    previousSourcePath: SOURCE_PATH,
    sourcePath: movedPath,
    projectId: PROJECT_ID,
    documentId: DOCUMENT_ID,
  });
  const rebased = await harness.workflow.rebaseRecoveryJournal({
    previousContext: harness.context,
    context: nextContext,
  });
  assert.equal(rebased.status, "succeeded");
  assert.equal(rebased.value.rebased, true);
  assert.equal(rebaseCalls, 2);
  assert.equal(readCalls, 1);
  assert.equal(harness.workflow.recoveryCheckpoint.sourcePath, movedPath);
  assert.equal(harness.workflow.hasVerifiedRecoveryCheckpoint({
    context: nextContext,
    revision: 1,
  }), true);
});

test("DocumentWorkflow adopts Main authority when a journal rebase ACK is lost", async () => {
  const before = "<!doctype html><html><body>one</body></html>";
  const after = before.replace("one", "lost-ack");
  const movedPath = "/tmp/moved/lost-ack.html";
  let receipt = null;
  let rebaseCalls = 0;
  const recoveryJournal = {
    async commit(input) {
      receipt = {
        ...input,
        recoveryHtmlSha256: sha256(input.html),
        journalSha256: sha256(`lost-ack:${input.sourcePath}`),
        updatedAt: "2026-09-01T00:00:00.000Z",
      };
      return receipt;
    },
    async readVerified() { return receipt; },
    async rebase() {
      rebaseCalls += 1;
      receipt = {
        ...receipt,
        sourcePath: movedPath,
        journalSha256: sha256(`lost-ack:${movedPath}`),
      };
      throw new Error("ACK lost after publish");
    },
    async remove() { return { removed: true }; },
  };
  const harness = createHarness({ html: before, recoveryJournal });
  harness.workflow.enqueueEdit({ html: after });
  assert.equal((await harness.workflow.protectForDetach({
    context: harness.context,
  })).status, "succeeded");
  const nextContext = harness.projectSession.transitionSource({
    previousSourcePath: SOURCE_PATH,
    sourcePath: movedPath,
    projectId: PROJECT_ID,
    documentId: DOCUMENT_ID,
  });

  const rebased = await harness.workflow.rebaseRecoveryJournal({
    previousContext: harness.context,
    context: nextContext,
  });

  assert.equal(rebased.status, "succeeded");
  assert.equal(rebaseCalls, 1);
  assert.equal(harness.workflow.recoveryCheckpoint.sourcePath, movedPath);
});

test("detach retries a stranded journal rebase after a moved source settles", async () => {
  const before = "<!doctype html><html><body>one</body></html>";
  const after = before.replace("one", "retry-on-detach");
  const movedPath = "/tmp/moved/retry-on-detach.html";
  let receipt = null;
  let rebaseCalls = 0;
  const recoveryJournal = {
    async commit(input) {
      receipt = {
        ...input,
        recoveryHtmlSha256: sha256(input.html),
        journalSha256: sha256(`detach:${input.sourcePath}`),
        updatedAt: "2026-09-01T00:00:00.000Z",
      };
      return receipt;
    },
    async readVerified() { return receipt; },
    async rebase() {
      rebaseCalls += 1;
      if (rebaseCalls < 3) throw new Error("injected transient rebase failure");
      receipt = {
        ...receipt,
        sourcePath: movedPath,
        journalSha256: sha256(`detach:${movedPath}`),
      };
      return receipt;
    },
    async remove() { return { removed: true }; },
  };
  const harness = createHarness({ html: before, recoveryJournal });
  harness.workflow.enqueueEdit({ html: after });
  assert.equal((await harness.workflow.protectForDetach({
    context: harness.context,
  })).status, "succeeded");
  const nextContext = harness.projectSession.transitionSource({
    previousSourcePath: SOURCE_PATH,
    sourcePath: movedPath,
    projectId: PROJECT_ID,
    documentId: DOCUMENT_ID,
  });
  assert.equal((await harness.workflow.rebaseRecoveryJournal({
    previousContext: harness.context,
    context: nextContext,
  })).status, "rejected");

  const protectedDetach = await harness.workflow.protectForDetach({
    context: nextContext,
  });

  assert.equal(protectedDetach.status, "succeeded");
  assert.equal(protectedDetach.value.evidence, "recoveryVerified");
  assert.equal(rebaseCalls, 3);
  assert.equal(harness.workflow.recoveryCheckpoint.sourcePath, movedPath);
});

test("DocumentWorkflow accepts only an exact exported HTML Hash as detach evidence", async () => {
  const before = "<!doctype html><html><body>one</body></html>";
  const after = before.replace("one", "exported");
  const harness = createHarness({ html: before });
  harness.workflow.enqueueEdit({ html: after });

  const invalid = await harness.workflow.recordVerifiedExport({
    context: harness.context,
    html: after,
    revision: 1,
    exported: { path: "/tmp/report-copy.html", sha256: sha256("wrong") },
  });
  assert.equal(invalid.status, "rejected");

  const verified = await harness.workflow.recordVerifiedExport({
    context: harness.context,
    html: after,
    revision: 1,
    exported: { path: "/tmp/report-copy.html", sha256: sha256(after) },
  });
  assert.equal(verified.status, "succeeded");
  assert.equal(verified.value.evidence, "exportVerified");
  assert.equal(harness.workflow.hasVerifiedProtectionEvidence({
    context: harness.context,
    revision: 1,
  }), true);
  assert.equal((await harness.workflow.protectForDetach({
    context: harness.context,
  })).value.evidence, "exportVerified");

  const newer = after.replace("exported", "edited-after-export");
  harness.workflow.enqueueEdit({ html: newer });
  const raced = await harness.workflow.recordVerifiedExport({
    context: harness.context,
    html: after,
    revision: 2,
    exported: { path: "/tmp/report-copy.html", sha256: sha256(after) },
  });
  assert.equal(raced.status, "blocked");
  assert.equal(harness.workflow.hasVerifiedProtectionEvidence({
    context: harness.context,
    revision: 2,
  }), false);
});

test("DocumentWorkflow can protect failed HTML before explicitly reloading the disk version", async () => {
  const before = "<!doctype html><html><body>disk</body></html>";
  const after = before.replace("disk", "protected-unsaved");
  const recoveryJournal = {
    async commit(input) {
      return {
        ...input,
        recoveryHtmlSha256: sha256(input.html),
        journalSha256: sha256(`reload:${input.revision}`),
        updatedAt: "2026-09-02T00:00:00.000Z",
      };
    },
    async readVerified() { return null; },
    async remove() { return { removed: true }; },
  };
  const harness = createHarness({
    html: before,
    recoveryJournal,
    bridge: {
      async autosave() { throw new Error("disk denied"); },
      async source() {
        return {
          projectId: PROJECT_ID,
          documentId: DOCUMENT_ID,
          sourcePath: SOURCE_PATH,
          content: before,
          sha256: sha256(before),
          lastModifiedAt: "2026-09-02T00:00:00.000Z",
        };
      },
    },
  });
  harness.workflow.enqueueEdit({ html: after });
  assert.notEqual((await harness.workflow.flush()).status, "succeeded");
  assert.equal((await harness.workflow.protectForDetach({
    context: harness.context,
  })).status, "succeeded");
  assert.equal(harness.workflow.hasVerifiedProtectionEvidence({
    context: harness.context,
    revision: 1,
  }), true);

  const requested = await harness.workflow.reloadFromDisk({ context: harness.context });
  assert.equal(requested.status, "blocked");
  const reloaded = await harness.workflow.reloadFromDisk({
    context: harness.context,
    intent: { kind: "confirm", confirmation: requested.confirmation },
  });
  assert.equal(reloaded.status, "succeeded");
  assert.equal(reloaded.value.permission.status, "accepted");
  assert.equal(reloaded.value.source.status, "accepted");
  assert.equal(reloaded.value.page.status, "restored");
  assert.equal(harness.documentSession.html, before);
  assert.equal(harness.documentSession.persistState, "idle");
  assert.equal(harness.documentSession.persistedSourceSha256, sha256(before));
  assert.equal(harness.documentSession.workingHtmlSha256, sha256(before));
});

test("clean reload freezes once and needs no destructive permission", async () => {
  const before = "<!doctype html><html><body>disk</body></html>";
  const external = before.replace("disk", "external");
  let sourceCalls = 0;
  const harness = createHarness({
    html: before,
    bridge: {
      async source() {
        sourceCalls += 1;
        return {
          projectId: PROJECT_ID,
          documentId: DOCUMENT_ID,
          sourcePath: SOURCE_PATH,
          content: external,
          sha256: sha256(external),
        };
      },
    },
  });

  const outcome = await harness.workflow.reloadFromDisk({ context: harness.context });

  assert.equal(outcome.status, "succeeded");
  assert.equal(outcome.value.permission.status, "not-required");
  assert.equal(outcome.value.source.status, "accepted");
  assert.equal(outcome.value.page.status, "restored");
  assert.equal(sourceCalls, 1);
  assert.equal(harness.canvas.unlocks, 1);
});

test("reload requests confirmation for a native edit checkpointed by freeze", async () => {
  const before = "<!doctype html><html><body>disk</body></html>";
  const checkpointed = before.replace("disk", "checkpointed");
  let sourceCalls = 0;
  const harness = createHarness({
    html: before,
    bridge: {
      async source() {
        sourceCalls += 1;
        return {};
      },
    },
  });
  harness.canvas.freeze = async () => {
    harness.workflow.enqueueEdit({ html: checkpointed });
    return { ok: true };
  };

  const outcome = await harness.workflow.reloadFromDisk({ context: harness.context });

  assert.equal(outcome.status, "blocked");
  assert.equal(outcome.code, "DOCUMENT_RELOAD_CONFIRMATION_REQUIRED");
  assert.equal(harness.documentSession.html, checkpointed);
  assert.equal(sourceCalls, 0);
  assert.equal(harness.canvas.unlocks, 1);
});

test("reload confirmation is consumed only after a fresh freeze checkpoint", async () => {
  const before = "<!doctype html><html><body>disk</body></html>";
  const edited = before.replace("disk", "edited");
  const checkpointed = before.replace("disk", "checkpointed-later");
  let sourceCalls = 0;
  const harness = createHarness({
    html: before,
    bridge: {
      async source() {
        sourceCalls += 1;
        return {};
      },
    },
  });
  harness.workflow.enqueueEdit({ html: edited });
  const requested = await harness.workflow.reloadFromDisk({ context: harness.context });
  harness.canvas.freeze = async () => {
    harness.workflow.enqueueEdit({ html: checkpointed });
    return { ok: true };
  };

  const outcome = await harness.workflow.reloadFromDisk({
    context: harness.context,
    intent: { kind: "confirm", confirmation: requested.confirmation },
  });

  assert.equal(outcome.status, "blocked");
  assert.equal(outcome.code, "DOCUMENT_SOURCE_CONFIRMATION_STALE");
  assert.equal(harness.documentSession.html, checkpointed);
  assert.equal(sourceCalls, 0);
});

test("a failed source freeze never unlocks Canvas", async () => {
  const harness = createHarness({
    canvasOverrides: {
      async freeze() { return { ok: false, reason: "native edit still active" }; },
    },
  });

  const outcome = await harness.workflow.reloadFromDisk({ context: harness.context });

  assert.equal(outcome.status, "blocked");
  assert.equal(outcome.code, "DOCUMENT_SOURCE_FREEZE_BLOCKED");
  assert.equal(harness.canvas.unlocks, 0);
});

test("duplicate reloads join while a different source command is busy", async () => {
  const read = deferred();
  let sourceCalls = 0;
  const harness = createHarness({
    bridge: {
      async source() {
        sourceCalls += 1;
        return read.promise;
      },
    },
  });

  const first = harness.workflow.reloadFromDisk({ context: harness.context });
  const duplicate = harness.workflow.reloadFromDisk({ context: harness.context });
  await Promise.resolve();
  const busy = await harness.workflow.repairCurrentCanvas({ context: harness.context });
  assert.equal(busy.status, "blocked");
  assert.equal(busy.code, "DOCUMENT_SOURCE_OPERATION_BUSY");
  read.resolve({
    projectId: PROJECT_ID,
    documentId: DOCUMENT_ID,
    sourcePath: SOURCE_PATH,
    content: harness.documentSession.html,
    sha256: harness.documentSession.workingHtmlSha256,
  });

  assert.equal((await first).status, "succeeded");
  assert.equal((await duplicate).status, "succeeded");
  assert.equal(sourceCalls, 1);
  assert.equal(harness.canvas.unlocks, 1);
});

test("reload confirmation cannot cross a later edit boundary", async () => {
  const before = "<!doctype html><html><body>disk</body></html>";
  const edited = before.replace("disk", "first edit");
  const newer = before.replace("disk", "newer edit");
  let sourceCalls = 0;
  const harness = createHarness({
    html: before,
    bridge: {
      async source() {
        sourceCalls += 1;
        return {
          projectId: PROJECT_ID,
          documentId: DOCUMENT_ID,
          sourcePath: SOURCE_PATH,
          content: before,
          sha256: sha256(before),
        };
      },
    },
  });
  harness.workflow.enqueueEdit({ html: edited });
  const requested = await harness.workflow.reloadFromDisk({ context: harness.context });
  assert.equal(requested.status, "blocked");
  harness.workflow.enqueueEdit({ html: newer });

  const staleConfirmation = await harness.workflow.reloadFromDisk({
    context: harness.context,
    intent: { kind: "confirm", confirmation: requested.confirmation },
  });

  assert.equal(staleConfirmation.status, "blocked");
  assert.equal(staleConfirmation.code, "DOCUMENT_SOURCE_CONFIRMATION_STALE");
  assert.equal(harness.documentSession.html, newer);
  assert.equal(sourceCalls, 0);
});

test("an older reload completion and finally cannot mutate or unlock a newer document", async () => {
  const aHtml = "<!doctype html><html><body>A</body></html>";
  const bHtml = "<!doctype html><html><body>B</body></html>";
  const aRead = deferred();
  const bRead = deferred();
  let aReads = 0;
  const harness = createHarness({
    html: aHtml,
    bridge: {
      async source(sourcePath) {
        if (sourcePath === SOURCE_PATH) {
          aReads += 1;
          return aRead.promise;
        }
        return bRead.promise;
      },
    },
  });

  const oldReload = harness.workflow.reloadFromDisk({ context: harness.context });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(aReads, 1);

  harness.workflow.resetForProjectTransition();
  harness.projectSession.openLocator(NEXT_SOURCE_PATH);
  const bContext = {
    epoch: harness.projectSession.epoch,
    projectId: "project_b",
    documentId: "document_b",
    sourcePath: NEXT_SOURCE_PATH,
  };
  harness.projectSession.register(bContext);
  harness.documentSession.reset({
    html: bHtml,
    persistedSourceSha256: sha256(bHtml),
    context: bContext,
    operationId: "open-b",
  });
  const newReload = harness.workflow.reloadFromDisk({ context: bContext });
  await Promise.resolve();
  await Promise.resolve();

  aRead.resolve({
    projectId: PROJECT_ID,
    documentId: DOCUMENT_ID,
    sourcePath: SOURCE_PATH,
    content: aHtml,
    sha256: sha256(aHtml),
  });
  assert.equal((await oldReload).status, "stale");
  assert.equal(harness.documentSession.html, bHtml);
  assert.equal(harness.canvas.unlocks, 0);

  bRead.resolve({
    projectId: bContext.projectId,
    documentId: bContext.documentId,
    sourcePath: bContext.sourcePath,
    content: bHtml,
    sha256: sha256(bHtml),
  });
  assert.equal((await newReload).status, "succeeded");
  assert.equal(harness.documentSession.html, bHtml);
  assert.equal(harness.canvas.unlocks, 1);
});

test("DocumentWorkflow restores source-history and recovery authority after a project transition reset", () => {
  const before = "<!doctype html><html><body><p>one</p></body></html>";
  const after = before.replace("one", "two");
  const harness = createHarness({ html: before });
  const recoveryIdentity = {
    schemaVersion: "1.0.0",
    token: sha256("transition-recovery"),
    projectId: PROJECT_ID,
    documentId: DOCUMENT_ID,
    sourcePath: SOURCE_PATH,
    basedOnVersionId: "version_001",
    sourceSha256: sha256(before),
    editRevision: 1,
  };
  const pending = operation(before, after);
  harness.workflow.replaceRecoveryIdentity(recoveryIdentity);
  harness.sourceHistorySession.restorePendingEvidence(harness.context, [pending]);
  const authority = harness.workflow.captureProjectTransitionAuthority();

  harness.workflow.resetForProjectTransition();
  assert.equal(harness.workflow.recoveryIdentity, null);
  assert.equal(harness.sourceHistorySession.snapshot, null);
  assert.deepEqual(harness.sourceHistorySession.pendingOperations, []);

  assert.equal(harness.workflow.restoreProjectTransitionAuthority({
    authority,
    context: harness.context,
    sourceSha256: sha256(before),
  }), true);
  assert.deepEqual(harness.workflow.recoveryIdentity, recoveryIdentity);
  assert.equal(harness.sourceHistorySession.capabilities.depth, 0);
  assert.deepEqual(harness.sourceHistorySession.pendingOperations, [pending]);
});

test("DocumentWorkflow coalesces a 100ms source write and only accepts exact HTML/Hash acknowledgement", async () => {
  const before = "<!doctype html><html><body><p>one</p></body></html>";
  const after = before.replace("one", "two");
  const calls = [];
  const harness = createHarness({
    html: before,
    bridge: {
      async autosave(body) {
        calls.push(body);
        return {
          ok: true,
          content: body.html,
          sha256: sha256(body.html),
          persistedRevision: body.editRevision,
          lastModifiedAt: "2026-08-11T00:00:01.000Z",
        };
      },
    },
  });

  const queued = harness.workflow.enqueueEdit({ html: after });
  assert.equal(queued.status, "succeeded");
  assert.equal(queued.value.revision, 1);
  assert.deepEqual(harness.scheduler.pending.map((task) => task.delay), [100]);
  assert.equal(harness.documentSession.persistState, "queued");

  const outcome = await harness.workflow.flush({ throughRevision: 1 });
  assert.equal(outcome.status, "succeeded");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].html, after);
  assert.equal(harness.documentSession.persistedSourceSha256, sha256(after));
  assert.equal(harness.documentSession.persistState, "idle");
});

test("DocumentWorkflow flushes a native-edit checkpoint immediately", async () => {
  const before = "<!doctype html><html><body><p>one</p></body></html>";
  const after = before.replace("one", "two");
  const calls = [];
  const harness = createHarness({
    html: before,
    bridge: {
      async autosave(body) {
        calls.push(body);
        return {
          ok: true,
          content: body.html,
          sha256: sha256(body.html),
          persistedRevision: body.editRevision,
          lastModifiedAt: "2026-08-11T00:00:01.000Z",
        };
      },
    },
  });

  const queued = harness.workflow.enqueueEdit({
    html: after,
    mutation: {
      kind: "text",
      property: "editableIslandHtml",
      target: { id: "island" },
    },
  });
  assert.equal(queued.status, "succeeded");
  assert.deepEqual(harness.scheduler.pending.map((task) => task.delay), []);
  const outcome = await harness.workflow.flush();
  assert.equal(outcome.status, "succeeded");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].changeEvents.length, 1);
  assert.equal(calls[0].changeEvents[0].revision, 1);
  assert.equal(calls[0].changeEvents[0].target.id, "island");
  assert.equal(harness.documentSession.persistState, "idle");
});

test("DocumentWorkflow rebinds a moved Working Copy before the next autosave", async () => {
  const before = "<!doctype html><html><body><p>one</p></body></html>";
  const after = before.replace("one", "two");
  const final = after.replace("two", "three");
  const movedPath = "/tmp/project-renamed/document-V1.html";
  const initialTarget = {
    projectId: PROJECT_ID,
    documentId: DOCUMENT_ID,
    projectRootPath: "/tmp/project-original",
    targetKind: "working-copy",
    workingCopyId: "work_ver_0001",
    versionId: "ver_0001",
    exactSourcePath: SOURCE_PATH,
    sourceSha256: sha256(before),
  };
  const calls = [];
  let markFirstStarted;
  const firstStarted = new Promise((resolve) => { markFirstStarted = resolve; });
  let resolveFirst;
  const harness = createHarness({
    html: before,
    bridge: {
      async autosave(body) {
        calls.push(body);
        const currentTarget = {
          ...initialTarget,
          projectRootPath: "/tmp/project-renamed",
          exactSourcePath: movedPath,
          sourceSha256: sha256(body.html),
        };
        const response = {
          ok: true,
          content: body.html,
          sha256: sha256(body.html),
          persistedRevision: body.editRevision,
          lastModifiedAt: "2026-08-11T00:00:01.000Z",
          openTarget: currentTarget,
          activeDraft: {
            draftRevision: 0,
            comments: [],
            changeEvents: [],
            deletedCommentIds: [],
          },
        };
        if (calls.length === 1) {
          markFirstStarted();
          return new Promise((resolve) => { resolveFirst = () => resolve(response); });
        }
        return response;
      },
    },
  });
  const registered = harness.projectSession.register({
    ...harness.context,
    openTarget: initialTarget,
  });
  assert.equal(registered?.exactSourcePath, SOURCE_PATH);
  const events = [];
  harness.workflow.subscribeEvents((event) => events.push(event));

  harness.workflow.enqueueEdit({ html: after });
  const flushing = harness.workflow.flush();
  await firstStarted;
  harness.workflow.enqueueEdit({ html: final });
  resolveFirst();
  assert.equal((await flushing).status, "succeeded");
  assert.equal(harness.projectSession.context?.sourcePath, movedPath);
  assert.equal(harness.projectSession.context?.projectRootPath, "/tmp/project-renamed");
  assert.equal(
    events.find((event) => event.type === "document-open-target-rebound")?.context?.sourcePath,
    movedPath,
  );

  assert.equal(calls.length, 2);
  assert.equal(calls[1].sourcePath, movedPath);
  assert.equal(calls[1].exactSourcePath, movedPath);
  assert.equal(calls[1].projectRootPath, "/tmp/project-renamed");
  assert.equal(calls[1].expectedSourceSha256, sha256(after));
});

test("DocumentWorkflow publishes an authority receipt when a same-byte autosave adopts a moved Working Copy", async () => {
  const before = "<!doctype html><html><body><p>one</p></body></html>";
  const after = before.replace("one", "two");
  const movedPath = "/tmp/project-renamed/document-V1.html";
  const initialTarget = {
    projectId: PROJECT_ID,
    documentId: DOCUMENT_ID,
    projectRootPath: "/tmp/project-original",
    targetKind: "working-copy",
    workingCopyId: "work_ver_0001",
    versionId: "ver_0001",
    exactSourcePath: SOURCE_PATH,
    sourceSha256: sha256(before),
  };
  const harness = createHarness({
    html: before,
    bridge: {
      async autosave(body) {
        return {
          ok: true,
          content: body.html,
          sha256: sha256(body.html),
          persistedRevision: body.editRevision,
          lastModifiedAt: "2026-09-01T00:00:00.000Z",
          openTarget: {
            ...initialTarget,
            projectRootPath: "/tmp/project-renamed",
            exactSourcePath: movedPath,
            sourceSha256: sha256(body.html),
          },
        };
      },
    },
  });
  assert.ok(harness.projectSession.register({
    ...harness.context,
    openTarget: initialTarget,
  }));
  const oldReceipt = harness.documentSession.sourceReceipt;
  const oldGeneration = harness.documentSession.canvasGeneration;

  assert.equal(harness.workflow.enqueueEdit({ html: after }).status, "succeeded");
  assert.equal((await harness.workflow.flush()).status, "succeeded");

  assert.equal(harness.documentSession.html, after);
  assert.equal(harness.projectSession.context?.sourcePath, movedPath);
  assert.equal(harness.projectSession.context?.projectRootPath, "/tmp/project-renamed");
  assert.equal(harness.documentSession.canvasGeneration, oldGeneration + 1);
  assert.equal(harness.documentSession.sourceReceipt.origin, "authority");
  assert.equal(harness.documentSession.sourceReceipt.context.sourcePath, movedPath);
  assert.equal(
    harness.documentSession.sourceReceipt.editRevision,
    harness.documentSession.editRevision,
  );
  assert.equal(harness.canvas.invalidations, 2);
  assert.equal(harness.documentSession.confirmCanvas({
    generation: harness.documentSession.canvasGeneration,
    renderedSha256: sha256(after),
    workingHtmlSha256: sha256(after),
    renderedHtml: after,
    receipt: oldReceipt,
  }), false);
});

test("DocumentWorkflow keeps a same-route hash-only autosave in the existing Canvas generation", async () => {
  const before = "<!doctype html><html><body><p>one</p></body></html>";
  const after = before.replace("one", "two");
  const target = {
    projectId: PROJECT_ID,
    documentId: DOCUMENT_ID,
    projectRootPath: "/tmp/project-original",
    targetKind: "working-copy",
    workingCopyId: "work_ver_0001",
    versionId: "ver_0001",
    exactSourcePath: SOURCE_PATH,
    sourceSha256: sha256(before),
  };
  const harness = createHarness({
    html: before,
    bridge: {
      async autosave(body) {
        return {
          ok: true,
          content: body.html,
          sha256: sha256(body.html),
          persistedRevision: body.editRevision,
          lastModifiedAt: "2026-09-01T00:00:00.000Z",
          openTarget: { ...target, sourceSha256: sha256(body.html) },
        };
      },
    },
  });
  assert.ok(harness.projectSession.register({ ...harness.context, openTarget: target }));
  const oldGeneration = harness.documentSession.canvasGeneration;
  assert.equal(harness.workflow.enqueueEdit({
    html: after,
    sourceTransaction: operation(before, after),
  }).status, "succeeded");
  const localReceipt = harness.documentSession.sourceReceipt;
  assert.equal((await harness.workflow.flush()).status, "succeeded");

  assert.equal(harness.documentSession.canvasGeneration, oldGeneration);
  assert.equal(harness.documentSession.sourceReceipt.sequence, localReceipt.sequence);
  assert.equal(harness.documentSession.sourceReceipt.origin, "local-edit");
  assert.equal(harness.documentSession.persistedSourceSha256, sha256(after));
});

test("DocumentWorkflow exposes no user-selected moved-project rebinding API", () => {
  const harness = createHarness();
  assert.equal("rebindRelocatedOpenTarget" in harness.workflow, false);
});

test("DocumentWorkflow rejects an unchainable source transaction without publishing the canvas edit", () => {
  const before = "<!doctype html><html><body><p>one</p></body></html>";
  const after = before.replace("one", "two");
  const harness = createHarness({ html: before });
  const transaction = {
    ...operation(before, after),
    beforeSourceSha256: sha256("a different authoritative source"),
  };

  const outcome = harness.workflow.enqueueEdit({
    html: after,
    mutation: {
      kind: "style",
      target: { id: "target_rejected_source_history" },
      stylePatch: { color: "red" },
    },
    sourceTransaction: transaction,
  });

  assert.deepEqual(outcome, {
    status: "rejected",
    code: "SOURCE_HISTORY_RECORD_REJECTED",
    reason: "源码历史与当前画布补丁链不一致。",
  });
  assert.equal(harness.documentSession.html, before);
  assert.equal(harness.documentSession.editRevision, 0);
  assert.equal(harness.documentSession.pendingWrite, null);
  assert.deepEqual(harness.commentSession.changeEvents, []);
  assert.deepEqual(harness.sourceHistorySession.pendingOperations, []);
  assert.equal(harness.canvas.invalidations, 0);
});

test("DocumentWorkflow drains a newer managed write after the earlier ACK refreshes its source hash", async () => {
  const before = "<!doctype html><html><body><p>one</p></body></html>";
  const middle = before.replace("one", "two");
  const after = before.replace("one", "three");
  const calls = [];
  let resolveFirst;
  const openTarget = (sourceSha256) => ({
    projectId: PROJECT_ID,
    documentId: DOCUMENT_ID,
    projectRootPath: "/tmp/document-workflow-project",
    targetKind: "working-copy",
    workingCopyId: "working_document_workflow",
    versionId: "version_document_workflow",
    exactSourcePath: SOURCE_PATH,
    sourceSha256,
  });
  const harness = createHarness({
    html: before,
    bridge: {
      autosave(body) {
        calls.push(body);
        if (calls.length === 1) {
          return new Promise((resolve) => { resolveFirst = resolve; });
        }
        return Promise.resolve({
          ok: true,
          content: body.html,
          sha256: sha256(body.html),
          persistedRevision: body.editRevision,
          lastModifiedAt: "2026-08-11T00:00:02.000Z",
          openTarget: openTarget(sha256(body.html)),
        });
      },
    },
  });
  assert.ok(harness.projectSession.adoptOpenTarget({
    previousSourcePath: SOURCE_PATH,
    target: openTarget(sha256(before)),
  }));

  harness.workflow.enqueueEdit({ html: middle });
  const flushing = harness.workflow.flush();
  await Promise.resolve();
  assert.equal(calls.length, 1);
  harness.workflow.enqueueEdit({ html: after });
  resolveFirst({
    ok: true,
    content: middle,
    sha256: sha256(middle),
    persistedRevision: 1,
    lastModifiedAt: "2026-08-11T00:00:01.000Z",
    openTarget: openTarget(sha256(middle)),
  });

  assert.equal((await flushing).status, "succeeded");
  assert.equal(calls.length, 2);
  assert.equal(calls[1].html, after);
  assert.equal(calls[1].expectedSourceSha256, sha256(middle));
  assert.equal(harness.documentSession.html, after);
  assert.equal(harness.documentSession.persistState, "idle");
});

test("DocumentWorkflow accepts an older ACK and drains the newer source-history prefix", async () => {
  const before = "<!doctype html><html><body><p>one</p></body></html>";
  const middle = before.replace("one", "two");
  const after = middle.replace("two", "three");
  const calls = [];
  let resolveFirst;
  const harness = createHarness({
    html: before,
    bridge: {
      autosave(body) {
        calls.push(body);
        if (calls.length === 1) {
          return new Promise((resolve) => { resolveFirst = resolve; });
        }
        return Promise.resolve({
          ok: true,
          content: body.html,
          sha256: sha256(body.html),
          persistedRevision: body.editRevision,
          lastModifiedAt: `2026-08-11T00:00:0${calls.length}.000Z`,
        });
      },
    },
  });

  assert.equal(harness.workflow.enqueueEdit({
    html: middle,
    sourceTransaction: operation(before, middle),
  }).status, "succeeded");
  const flushing = harness.workflow.flush();
  await Promise.resolve();
  assert.equal(calls.length, 1);

  assert.equal(harness.workflow.enqueueEdit({
    html: after,
    sourceTransaction: operation(middle, after),
  }).status, "succeeded");
  resolveFirst({
    ok: true,
    content: middle,
    sha256: sha256(middle),
    persistedRevision: 1,
    lastModifiedAt: "2026-08-11T00:00:01.000Z",
  });

  assert.equal((await flushing).status, "succeeded");
  assert.equal(calls.length, 2);
  assert.equal(calls[0].html, middle);
  assert.equal(calls[1].html, after);
  assert.equal(calls[1].expectedSourceSha256, sha256(middle));
  assert.equal(calls[1].sourceHistoryOperations.length, 1);
  assert.equal(
    calls[1].sourceHistoryOperations[0].beforeSourceSha256,
    sha256(middle),
  );
  assert.equal(harness.documentSession.html, after);
  assert.equal(harness.sourceHistorySession.capabilities.canUndo, true);

  assert.equal(
    (await harness.workflow.performHistoryAction({
      direction: "undo",
      context: harness.context,
    })).status,
    "succeeded",
  );
  assert.equal(harness.documentSession.html, middle);
  assert.equal(
    (await harness.workflow.performHistoryAction({
      direction: "undo",
      context: harness.context,
    })).status,
    "succeeded",
  );
  assert.equal(harness.documentSession.html, before);
  assert.equal(harness.sourceHistorySession.capabilities.canRedo, true);
});

test("DocumentWorkflow reconstructs a missing pending write and rebinds comment targets after acknowledgement", async () => {
  const before = "<!doctype html><html><body><p>one</p></body></html>";
  const after = before.replace("one", "two");
  const harness = createHarness({
    html: before,
    codecOverrides: {
      rebindTargetsPreservingGlobal: (_html, targets) => targets.map((target) => ({
        ...target,
        selector: "[data-rebound]",
      })),
    },
    bridge: {
      async autosave(body) {
        return {
          ok: true,
          content: body.html,
          sha256: sha256(body.html),
          persistedRevision: body.editRevision,
          lastModifiedAt: "2026-08-11T00:00:01.000Z",
          currentExactVersionId: "version_002",
        };
      },
    },
  });
  harness.commentSession.setComments([{
    commentId: "comment_rebind",
    text: "keep target",
    sourceAnchor: { id: "target_rebind", selector: "p", resolution: "exact" },
    attachments: [],
  }]);
  harness.documentSession.publishAuthority({
    html: after,
    persistedSourceSha256: sha256(before),
    workingHtmlSha256: sha256(after),
    editRevision: 1,
    lastPersistedRevision: 0,
    persistState: "queued",
    pendingWrite: null,
    context: harness.context,
    operationId: "restore-missing-pending-write",
  });

  const outcome = await harness.workflow.flush({ throughRevision: 1 });

  assert.equal(outcome.status, "succeeded");
  assert.equal(harness.documentSession.pendingWrite, null);
  assert.equal(harness.commentSession.comments[0].sourceAnchor.selector, "[data-rebound]");
  assert.equal(harness.versionSession.snapshot.currentExactVersionId, "version_002");
});

test("DocumentWorkflow registers an unbound source write before its first autosave", async () => {
  const before = "<!doctype html><html><body><p>one</p></body></html>";
  const after = before.replace("one", "two");
  let registrations = 0;
  const harness = createHarness({
    html: before,
    registered: false,
    ensureRegistered: async () => {
      registrations += 1;
      const context = harness.projectSession.register({
        epoch: harness.projectSession.epoch,
        projectId: PROJECT_ID,
        documentId: DOCUMENT_ID,
        sourcePath: SOURCE_PATH,
      });
      return { status: "succeeded", value: context };
    },
    bridge: {
      async autosave(body) {
        return {
          ok: true,
          content: body.html,
          sha256: sha256(body.html),
          persistedRevision: body.editRevision,
          lastModifiedAt: "2026-08-11T00:00:01.000Z",
        };
      },
    },
  });

  harness.workflow.enqueueEdit({ html: after });
  const boundary = harness.workflow.captureLeaveBoundary();
  const outcome = await harness.workflow.flush();

  assert.equal(outcome.status, "succeeded");
  assert.equal(registrations, 1);
  assert.equal(harness.documentSession.persistedSourceSha256, sha256(after));
  assert.equal(harness.workflow.verifyLeaveBoundary(boundary, {
    needsSourceProtection: true, committedSourceSha256: sha256(after),
  }).kind, "ready");
});

test("DocumentWorkflow rebinds a newer queued write when registration moves to a managed source path", async () => {
  const before = "<!doctype html><html><body><p>one</p></body></html>";
  const after = before.replace("one", "two");
  const latest = before.replace("one", "latest");
  let markRegistrationStarted;
  const registrationStarted = new Promise((resolve) => {
    markRegistrationStarted = resolve;
  });
  let releaseRegistration;
  const registrationBarrier = new Promise((resolve) => {
    releaseRegistration = resolve;
  });
  const autosaves = [];
  let registrations = 0;
  const harness = createHarness({
    html: before,
    registered: false,
    ensureRegistered: async () => {
      registrations += 1;
      markRegistrationStarted();
      await registrationBarrier;
      harness.projectSession.openLocator(NEXT_SOURCE_PATH);
      const context = harness.projectSession.register({
        epoch: harness.projectSession.epoch,
        projectId: PROJECT_ID,
        documentId: DOCUMENT_ID,
        sourcePath: NEXT_SOURCE_PATH,
      });
      return { status: "succeeded", value: context };
    },
    bridge: {
      async autosave(body) {
        autosaves.push(body);
        return {
          ok: true,
          content: body.html,
          sha256: sha256(body.html),
          persistedRevision: body.editRevision,
          lastModifiedAt: "2026-09-13T00:00:00.000Z",
        };
      },
    },
  });

  assert.equal(harness.workflow.enqueueEdit({ html: after }).status, "succeeded");
  const flushing = harness.workflow.flush();
  await registrationStarted;
  assert.equal(harness.workflow.enqueueEdit({ html: latest }).status, "succeeded");
  assert.equal(harness.documentSession.pendingWrite.sourcePath, SOURCE_PATH);
  assert.equal(harness.documentSession.pendingWrite.html, latest);
  assert.equal(harness.documentSession.pendingWrite.revision, 2);
  releaseRegistration();

  const outcome = await flushing;

  assert.equal(
    outcome.status,
    "succeeded",
    JSON.stringify({ outcome, autosaves, snapshot: harness.projectSession.snapshot }),
  );
  assert.equal(registrations, 1);
  assert.equal(autosaves.length, 2);
  assert.deepEqual(autosaves.map((write) => write.sourcePath), [
    NEXT_SOURCE_PATH,
    NEXT_SOURCE_PATH,
  ]);
  assert.deepEqual(autosaves.map((write) => write.html), [after, latest]);
  assert.deepEqual(autosaves.map((write) => write.editRevision), [1, 2]);
  assert.deepEqual(autosaves.map((write) => write.projectId), [PROJECT_ID, PROJECT_ID]);
  assert.deepEqual(autosaves.map((write) => write.documentId), [DOCUMENT_ID, DOCUMENT_ID]);
  assert.equal(autosaves[0].expectedSourceSha256, sha256(before));
  assert.equal(autosaves[1].expectedSourceSha256, sha256(after));
  assert.equal(harness.documentSession.html, latest);
  assert.equal(harness.documentSession.pendingWrite, null);
  assert.equal(harness.documentSession.persistedSourceSha256, sha256(latest));
  harness.workflow.dispose();
});

test("DocumentWorkflow settles a failed first registration as a retryable persistence failure", async () => {
  const before = "<!doctype html><html><body><p>one</p></body></html>";
  const after = before.replace("one", "two");
  let registrationAttempts = 0;
  let autosaves = 0;
  const events = [];
  const harness = createHarness({
    html: before,
    registered: false,
    ensureRegistered: async () => {
      registrationAttempts += 1;
      if (registrationAttempts === 1) {
        return {
          status: "blocked",
          code: "PROJECT_REGISTRATION_UNAVAILABLE",
          reason: "项目资料暂时无法建立，修改已保留在恢复记录中。",
        };
      }
      const context = harness.projectSession.register({
        epoch: harness.projectSession.epoch,
        projectId: PROJECT_ID,
        documentId: DOCUMENT_ID,
        sourcePath: SOURCE_PATH,
      });
      return { status: "succeeded", value: context };
    },
    bridge: {
      async autosave(body) {
        autosaves += 1;
        return {
          ok: true,
          content: body.html,
          sha256: sha256(body.html),
          persistedRevision: body.editRevision,
          lastModifiedAt: "2026-08-11T00:00:01.000Z",
        };
      },
    },
  });
  harness.workflow.subscribeEvents((event) => events.push(event));

  harness.workflow.enqueueEdit({ html: after });
  const first = await harness.workflow.flush();

  assert.deepEqual(first, {
    status: "blocked",
    code: "PROJECT_REGISTRATION_UNAVAILABLE",
    reason: "项目资料暂时无法建立，修改已保留在恢复记录中。",
  });
  assert.equal(autosaves, 0);
  assert.equal(harness.documentSession.persistState, "failed");
  assert.equal(harness.documentSession.pendingWrite?.html, after);
  const failure = events.find((event) => event.type === "document-persistence-failed");
  assert.equal(failure?.code, "PROJECT_REGISTRATION_UNAVAILABLE");
  assert.equal(failure?.fatal, false);

  const second = await harness.workflow.flush();

  assert.equal(second.status, "succeeded");
  assert.equal(registrationAttempts, 2);
  assert.equal(autosaves, 1);
  assert.equal(harness.documentSession.persistState, "idle");
});

test("DocumentWorkflow rekeys recovery to registered identity before the first autosave resolves", async () => {
  const before = "<!doctype html><html><body><p>one</p></body></html>";
  const after = before.replace("one", "two");
  let resolveAutosave;
  let enteredAutosave;
  const autosaveEntered = new Promise((resolve) => { enteredAutosave = resolve; });
  const commits = [];
  const harness = createHarness({
    html: before,
    registered: false,
    recoveryJournal: {
      async commit(input) {
        commits.push(structuredClone(input));
        return {
          ...input,
          recoveryHtmlSha256: sha256(input.html),
          journalSha256: sha256(`rekey:${input.revision}:${input.html}`),
          updatedAt: "2026-08-11T00:00:00.000Z",
        };
      },
      async readVerified() { return null; },
      async remove() { return { removed: true }; },
    },
    ensureRegistered: async () => {
      const context = harness.projectSession.register({
        epoch: harness.projectSession.epoch,
        projectId: PROJECT_ID,
        documentId: DOCUMENT_ID,
        sourcePath: SOURCE_PATH,
      });
      return { status: "succeeded", value: context };
    },
    bridge: {
      autosave() {
        enteredAutosave();
        return new Promise((resolve) => { resolveAutosave = resolve; });
      },
    },
  });

  harness.workflow.enqueueEdit({ html: after });
  const flushing = harness.workflow.flush();
  await autosaveEntered;
  await Promise.resolve();
  await Promise.resolve();

  assert.ok(commits.some((record) => (
    record.projectId === PROJECT_ID
    && record.documentId === DOCUMENT_ID
    && record.sourcePath === SOURCE_PATH
    && record.html === after
  )));

  resolveAutosave({
    ok: true,
    content: after,
    sha256: sha256(after),
    persistedRevision: 1,
    lastModifiedAt: "2026-08-11T00:00:01.000Z",
  });
  assert.equal((await flushing).status, "succeeded");
});

test("DocumentWorkflow returns stale after a durable acknowledgement races a new project locator", async () => {
  const before = "<!doctype html><html><body><p>one</p></body></html>";
  const after = before.replace("one", "two");
  let resolveWrite;
  const harness = createHarness({
    html: before,
    bridge: {
      autosave() {
        return new Promise((resolve) => { resolveWrite = resolve; });
      },
    },
  });
  harness.workflow.enqueueEdit({ html: after });
  const flushing = harness.workflow.flush();
  await Promise.resolve();
  // The public Session transition, rather than the old write, is the stale authority.
  harness.projectSession.openLocator("/tmp/other.html");
  resolveWrite({
    ok: true,
    content: after,
    sha256: sha256(after),
    persistedRevision: 1,
    lastModifiedAt: "2026-08-11T00:00:01.000Z",
  });

  assert.equal((await flushing).status, "stale");
});

test("DocumentWorkflow leaves the next document Source History untouched by a stale ACK", async () => {
  const before = "<!doctype html><html><body><p>one</p></body></html>";
  const after = before.replace("one", "two");
  const nextBefore = "<!doctype html><html><body><p>next</p></body></html>";
  const nextAfter = nextBefore.replace("next", "later");
  const nextSourcePath = "/tmp/next-document.html";
  const nextProjectId = "project_document_workflow_next";
  const nextDocumentId = "document_document_workflow_next";
  let resolveWrite;
  const harness = createHarness({
    bridge: {
      autosave() {
        return new Promise((resolve) => { resolveWrite = resolve; });
      },
    },
  });

  harness.workflow.enqueueEdit({ html: after });
  const flushing = harness.workflow.flush();
  await Promise.resolve();

  harness.projectSession.transitionSource({
    previousSourcePath: SOURCE_PATH,
    sourcePath: nextSourcePath,
    projectId: nextProjectId,
    documentId: nextDocumentId,
  });
  const nextContext = {
    epoch: harness.projectSession.epoch,
    projectId: nextProjectId,
    documentId: nextDocumentId,
    sourcePath: nextSourcePath,
  };
  harness.sourceHistorySession.activate(
    nextContext,
    sha256(nextBefore),
    null,
  );
  harness.sourceHistorySession.record(
    nextContext,
    operation(nextBefore, nextAfter),
    1,
  );
  const expectedSnapshot = structuredClone(harness.sourceHistorySession.snapshot);
  const expectedPending = harness.sourceHistorySession.pendingOperations;

  let activateCalls = 0;
  const activate = harness.sourceHistorySession.activate.bind(harness.sourceHistorySession);
  harness.sourceHistorySession.activate = (...args) => {
    activateCalls += 1;
    return activate(...args);
  };

  resolveWrite({
    ok: true,
    content: after,
    sha256: sha256(after),
    persistedRevision: 1,
    lastModifiedAt: "2026-08-11T00:00:01.000Z",
  });

  assert.equal((await flushing).status, "stale");
  assert.equal(activateCalls, 0, "inactive-context ACK must not reactivate the old document");
  const actualSnapshot = harness.sourceHistorySession.snapshot;
  assert.deepEqual(actualSnapshot, expectedSnapshot);
  assert.deepEqual(harness.sourceHistorySession.pendingOperations, expectedPending);
  assert.equal(harness.sourceHistorySession.capabilities.sourceSha256, sha256(nextAfter));
});

test("DocumentWorkflow rebuilds Source History for an invalid ACK in the current context", async () => {
  const before = "<!doctype html><html><body><p>one</p></body></html>";
  const after = before.replace("one", "two");
  const harness = createHarness({
    bridge: {
      async autosave(body) {
        return {
          ok: true,
          content: body.html,
          sha256: sha256(body.html),
          persistedRevision: body.editRevision,
          lastModifiedAt: "2026-08-11T00:00:01.000Z",
        };
      },
    },
  });
  let activateCalls = 0;
  const activate = harness.sourceHistorySession.activate.bind(harness.sourceHistorySession);
  harness.sourceHistorySession.activate = (...args) => {
    activateCalls += 1;
    return activate(...args);
  };

  harness.workflow.enqueueEdit({ html: after });
  assert.equal((await harness.workflow.flush()).status, "succeeded");
  assert.equal(activateCalls, 1);
  assert.equal(harness.sourceHistorySession.snapshot.projectId, PROJECT_ID);
  assert.equal(harness.sourceHistorySession.capabilities.sourceSha256, sha256(after));
  assert.deepEqual(harness.sourceHistorySession.pendingOperations, []);
});

test("DocumentWorkflow preserves recovery and fails closed when autosave acknowledgement bytes differ", async () => {
  const before = "<!doctype html><html><body><p>one</p></body></html>";
  const after = before.replace("one", "two");
  const harness = createHarness({
    html: before,
    bridge: {
      async autosave(body) {
        return {
          ok: true,
          content: body.html.replace("two", "three"),
          sha256: sha256(body.html.replace("two", "three")),
          persistedRevision: body.editRevision,
          lastModifiedAt: "2026-08-11T00:00:01.000Z",
        };
      },
    },
  });

  harness.workflow.enqueueEdit({ html: after });
  const outcome = await harness.workflow.flush();

  assert.equal(outcome.status, "rejected");
  assert.equal(outcome.code, "INVALID_AUTOSAVE_ACK");
  assert.equal(harness.documentSession.persistState, "failed");
  assert.equal(harness.documentSession.pendingWrite?.html, after);
});

test("DocumentWorkflow keeps an externally accepted source when its canvas cannot render", async () => {
  const before = "<!doctype html><html><body><p>one</p></body></html>";
  const external = before.replace("one", "external");
  const conflictResolutions = [];
  const events = [];
  const harness = createHarness({
    html: before,
    canvasOverrides: {
      async verifyRendered() {
        throw new Error("canvas did not render external source");
      },
    },
    bridge: {
      async resolveConflict(request) {
        conflictResolutions.push(request);
        return {
          projectId: PROJECT_ID,
          documentId: DOCUMENT_ID,
          sourcePath: SOURCE_PATH,
          content: external,
          sha256: sha256(external),
        };
      },
      async sourcePreview() {
        return {
          content: external,
          sha256: sha256(external),
          lastModifiedAt: "2026-08-11T00:00:01.000Z",
        };
      },
    },
  });
  harness.workflow.subscribeEvents((event) => events.push(event));

  const requested = await harness.workflow.acceptExternalConflict({
    context: harness.context,
  });
  const outcome = await harness.workflow.acceptExternalConflict({
    context: harness.context,
    intent: { kind: "confirm", confirmation: requested.confirmation },
  });

  assert.equal(outcome.status, "succeeded");
  assert.equal(outcome.value.permission.status, "accepted");
  assert.equal(outcome.value.source.status, "accepted");
  assert.equal(outcome.value.page.status, "repair-required");
  assert.equal(conflictResolutions.length, 1);
  assert.match(conflictResolutions[0].operationId, /^accept-external-conflict_/u);
  const resolution = { ...conflictResolutions[0] };
  delete resolution.operationId;
  assert.deepEqual(resolution, {
    ...harness.context,
    action: "force-unlock",
    expectedSourceSha256: sha256(external),
  });
  assert.equal(harness.documentSession.html, external);
  assert.equal(harness.documentSession.persistedSourceSha256, sha256(external));
  assert.equal(harness.documentSession.pendingWrite, null);
  assert.equal(harness.documentSession.persistState, "idle");
  assert.equal(harness.documentSession.canvasAuthority.status, "failed");
  assert.equal(
    events.some((event) => event.type === "document-conflict-force-unlocked"),
    true,
  );
});

test("a lost force-unlock reply reconciles the original operation without issuing a new mutation", async () => {
  const before = "<!doctype html><html><body><p>one</p></body></html>";
  const external = before.replace("one", "external");
  const conflictResolutions = [];
  const harness = createHarness({
    html: before,
    bridge: {
      async sourcePreview() {
        return {
          content: external,
          sha256: sha256(external),
          lastModifiedAt: "2026-08-11T00:00:01.000Z",
        };
      },
      async resolveConflict(request) {
        conflictResolutions.push(request);
        if (request.action === "force-unlock") {
          throw new BridgeRequestError("force-unlock reply lost", { outcome: "unknown" });
        }
        return {
          status: "unknown",
          operationId: request.operationId,
          projectId: PROJECT_ID,
          documentId: DOCUMENT_ID,
          sourcePath: SOURCE_PATH,
        };
      },
    },
  });
  harness.documentSession.recordPersistenceFailure({
    conflict: true,
    error: "源文件在磁盘上被其他程序修改了。",
  });

  const firstRequest = await harness.workflow.acceptExternalConflict({ context: harness.context });
  const first = await harness.workflow.acceptExternalConflict({
    context: harness.context,
    intent: { kind: "confirm", confirmation: firstRequest.confirmation },
  });
  assert.equal(first.status, "unknown");

  const retryRequest = await harness.workflow.acceptExternalConflict({ context: harness.context });
  const retried = await harness.workflow.acceptExternalConflict({
    context: harness.context,
    intent: { kind: "confirm", confirmation: retryRequest.confirmation },
  });

  assert.equal(retried.status, "unknown");
  assert.equal(retried.operationId, first.operationId);
  assert.equal(conflictResolutions.length, 2);
  assert.equal(conflictResolutions[0].action, "force-unlock");
  assert.equal(conflictResolutions[1].action, "force-unlock-result");
  assert.equal(conflictResolutions[1].operationId, conflictResolutions[0].operationId);
});

test("a lost force-unlock reply reconciles preview Hash separately from the materialized final Hash", async () => {
  const before = "<!doctype html><html><body><p>one</p></body></html>";
  const acceptedExternal = "<!doctype html><html><body><p>external</p></body></html>";
  const materializedExternal = "<!doctype html><html><body><p data-stemmio-id=\"sm1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\">external</p></body></html>";
  let previewHtml = acceptedExternal;
  const conflictResolutions = [];
  const harness = createHarness({
    html: before,
    bridge: {
      async sourcePreview() {
        return {
          content: previewHtml,
          sha256: sha256(previewHtml),
          lastModifiedAt: "2026-08-11T00:00:01.000Z",
        };
      },
      async resolveConflict(request) {
        conflictResolutions.push(request);
        if (request.action === "force-unlock") {
          throw new BridgeRequestError("force-unlock reply lost", { outcome: "unknown" });
        }
        return {
          status: "force-unlocked",
          operationId: request.operationId,
          acceptedSourceSha256: sha256(acceptedExternal),
          projectId: PROJECT_ID,
          documentId: DOCUMENT_ID,
          sourcePath: SOURCE_PATH,
          sourceSha256: sha256(materializedExternal),
          sha256: sha256(materializedExternal),
          content: materializedExternal,
          lastModifiedAt: "2026-08-11T00:00:02.000Z",
        };
      },
    },
  });
  harness.documentSession.recordPersistenceFailure({
    conflict: true,
    error: "源文件在磁盘上被其他程序修改了。",
  });

  const firstRequest = await harness.workflow.acceptExternalConflict({ context: harness.context });
  const first = await harness.workflow.acceptExternalConflict({
    context: harness.context,
    intent: { kind: "confirm", confirmation: firstRequest.confirmation },
  });
  assert.equal(first.status, "unknown");

  previewHtml = materializedExternal;
  const retryRequest = await harness.workflow.acceptExternalConflict({ context: harness.context });
  const retried = await harness.workflow.acceptExternalConflict({
    context: harness.context,
    intent: { kind: "confirm", confirmation: retryRequest.confirmation },
  });

  assert.equal(retried.status, "succeeded", JSON.stringify(retried));
  assert.equal(retried.value.source.html, materializedExternal);
  assert.equal(retried.value.source.sourceSha256, sha256(materializedExternal));
  assert.equal(conflictResolutions.length, 2);
  assert.equal(conflictResolutions[0].action, "force-unlock");
  assert.equal(conflictResolutions[1].action, "force-unlock-result");
  assert.equal(conflictResolutions[1].operationId, conflictResolutions[0].operationId);
});

test("DocumentWorkflow rebuilds one timed-out accepted projection without repeating source acceptance", async () => {
  const before = "<!doctype html><html><body><p>one</p></body></html>";
  const external = before.replace("one", "external");
  let verifyCalls = 0;
  let conflictResolutionCalls = 0;
  const rebuildFence = Object.freeze({ frameGeneration: 7, frameDocument: {} });
  const observedRebuildFences = [];
  let harness;
  harness = createHarness({
    html: before,
    canvasOverrides: {
      rebuildActiveFrame() {
        this.rebuilds += 1;
        return rebuildFence;
      },
      async verifyRendered(
        renderedHtml,
        renderedSha256,
        _context,
        receipt,
        receivedRebuildFence,
      ) {
        verifyCalls += 1;
        observedRebuildFences.push(receivedRebuildFence);
        if (verifyCalls === 1) {
          throw Object.assign(new Error("canvas acknowledgement timed out"), {
            code: "DOCUMENT_CANVAS_ACK_TIMEOUT",
          });
        }
        return Object.freeze({
          receipt,
          renderedHtml,
          renderedSha256,
          frameGeneration: harness.documentSession.canvasGeneration,
        });
      },
    },
    bridge: {
      async sourcePreview() {
        return {
          content: external,
          sha256: sha256(external),
          lastModifiedAt: "2026-08-11T00:00:01.000Z",
        };
      },
      async resolveConflict() {
        conflictResolutionCalls += 1;
        return {
          projectId: PROJECT_ID,
          documentId: DOCUMENT_ID,
          sourcePath: SOURCE_PATH,
          content: external,
          sha256: sha256(external),
        };
      },
    },
  });

  const requested = await harness.workflow.acceptExternalConflict({
    context: harness.context,
  });
  const outcome = await harness.workflow.acceptExternalConflict({
    context: harness.context,
    intent: { kind: "confirm", confirmation: requested.confirmation },
  });

  assert.equal(outcome.status, "succeeded");
  assert.equal(outcome.value.source.status, "accepted");
  assert.equal(outcome.value.page.status, "restored");
  assert.equal(conflictResolutionCalls, 1);
  assert.equal(verifyCalls, 2);
  assert.equal(harness.canvas.rebuilds, 1);
  assert.equal(observedRebuildFences[0], undefined);
  assert.equal(observedRebuildFences[1], rebuildFence);
  assert.equal(harness.documentSession.html, external);
  assert.equal(harness.documentSession.persistedSourceSha256, sha256(external));
  assert.notEqual(
    harness.documentSession.sourceReceipt.sequence,
    outcome.value.source.receipt.sequence,
  );
  assert.equal(harness.documentSession.canvasAuthority.status, "verified");
});

test("DocumentWorkflow preserves a durable external acceptance after the page switches", async () => {
  const before = "<!doctype html><html><body><p>one</p></body></html>";
  const external = before.replace("one", "external");
  const next = before.replace("one", "next");
  const accepted = deferred();
  const harness = createHarness({
    html: before,
    bridge: {
      async sourcePreview() {
        return { content: external, sha256: sha256(external) };
      },
      async resolveConflict() {
        return accepted.promise;
      },
    },
  });
  const preview = await harness.workflow.previewExternalSource({ context: harness.context });
  assert.equal(preview.status, "succeeded");

  const accepting = harness.workflow.adoptShownExternalPreview({
    context: harness.context,
    previewReceipt: preview.value,
  });
  await Promise.resolve();
  await Promise.resolve();

  harness.workflow.resetForProjectTransition();
  harness.projectSession.openLocator(NEXT_SOURCE_PATH);
  const nextContext = {
    epoch: harness.projectSession.epoch,
    projectId: "project_next",
    documentId: "document_next",
    sourcePath: NEXT_SOURCE_PATH,
  };
  harness.projectSession.register(nextContext);
  harness.documentSession.reset({
    html: next,
    persistedSourceSha256: sha256(next),
    context: nextContext,
    operationId: "open-next",
  });
  accepted.resolve({
    projectId: PROJECT_ID,
    documentId: DOCUMENT_ID,
    sourcePath: SOURCE_PATH,
    content: external,
    sha256: sha256(external),
  });
  const outcome = await accepting;

  assert.equal(outcome.status, "succeeded");
  assert.equal(outcome.value.source.status, "accepted");
  assert.equal(outcome.value.page.status, "not-current");
  assert.equal(harness.documentSession.html, next);
  assert.equal(harness.canvas.unlocks, 0);
});

test("DocumentWorkflow reconciles an unknown autosave only after reading matching authority", async () => {
  const before = "<!doctype html><html><body><p>one</p></body></html>";
  const after = before.replace("one", "two");
  const calls = [];
  const harness = createHarness({
    html: before,
    bridge: {
      async autosave(body) {
        calls.push(body);
        throw new BridgeRequestError("timeout", { status: 503, outcome: "unknown" });
      },
      async workspace() {
        return {
          projectId: PROJECT_ID,
          documentId: DOCUMENT_ID,
          sourcePath: SOURCE_PATH,
          currentHtmlSha256: sha256(after),
          lastPersistedRevision: 1,
          lastModifiedAt: "2026-08-11T00:00:01.000Z",
        };
      },
      async source() {
        return {
          projectId: PROJECT_ID,
          documentId: DOCUMENT_ID,
          sourcePath: SOURCE_PATH,
          content: after,
          sha256: sha256(after),
          lastModifiedAt: "2026-08-11T00:00:01.000Z",
        };
      },
    },
  });

  harness.workflow.enqueueEdit({ html: after });
  const outcome = await harness.workflow.flush();

  assert.equal(outcome.status, "succeeded");
  assert.equal(outcome.value.reconciled, true);
  assert.equal(calls.length, 1);
  assert.equal(harness.documentSession.persistedSourceSha256, sha256(after));
  assert.equal(harness.documentSession.persistState, "idle");
});

test("DocumentWorkflow restores a matching crash journal into the same durable queue", async () => {
  const before = "<!doctype html><html><body><p>one</p></body></html>";
  const after = before.replace("one", "two");
  const recoveryIdentity = {
    schemaVersion: "1.0.0",
    token: sha256("recovery"),
    projectId: PROJECT_ID,
    documentId: DOCUMENT_ID,
    sourcePath: SOURCE_PATH,
    basedOnVersionId: "version_001",
    sourceSha256: sha256(before),
    editRevision: 2,
  };
  const recoveryJournal = {
    async readVerified() {
      return {
        schemaVersion: "2.0.0",
        projectId: PROJECT_ID,
        documentId: DOCUMENT_ID,
        sourcePath: SOURCE_PATH,
        workingCopyId: "",
        expectedSourceSha256: sha256(before),
        revision: 2,
        html: after,
        recoveryHtmlSha256: sha256(after),
        journalSha256: sha256("crash-journal"),
        updatedAt: "2026-09-01T00:00:00.000Z",
      };
    },
    async commit(input) {
      return {
        ...input,
        recoveryHtmlSha256: sha256(input.html),
        journalSha256: sha256(`crash:${input.revision}`),
        updatedAt: "2026-09-01T00:00:03.000Z",
      };
    },
    async remove() { return { removed: true }; },
  };
  const harness = createHarness({ html: before, recoveryJournal });
  harness.workflow.replaceRecoveryIdentity(recoveryIdentity);
  harness.client.autosave = async (body) => ({
    ok: true,
    content: body.html,
    sha256: sha256(body.html),
    persistedRevision: body.editRevision,
    lastModifiedAt: "2026-08-11T00:00:03.000Z",
  });

  const recovered = await harness.workflow.recoverAutosave({
    context: harness.context,
    currentSourceSha256: sha256(before),
    serverRevision: 2,
  });

  assert.equal(recovered.status, "succeeded");
  assert.equal(recovered.value.queued, true);
  assert.equal(harness.documentSession.html, after);
  assert.equal(harness.documentSession.editRevision, 3);
  assert.equal(harness.documentSession.persistState, "queued");
  assert.deepEqual(harness.scheduler.pending.map((task) => task.delay), [0]);
  assert.equal((await harness.workflow.flush()).status, "succeeded");
  assert.equal(harness.documentSession.persistState, "idle");
});

function replacedRecoveryHarness({ mutateJournal, verify, remove } = {}) {
  const oldHtml = "<!doctype html><html><body><p>V8 current</p></body></html>";
  const currentHtml = oldHtml.replace("V8 current", "V9 current");
  const journal = {
    schemaVersion: "2.0.0", projectId: PROJECT_ID, documentId: DOCUMENT_ID,
    sourcePath: SOURCE_PATH, workingCopyId: "work_ver_0001",
    expectedSourceSha256: sha256(oldHtml), html: oldHtml,
    recoveryHtmlSha256: sha256(oldHtml), journalSha256: sha256("V8 journal"),
    revision: 12, updatedAt: "2026-09-01T00:00:00.000Z",
  };
  mutateJournal?.(journal);
  const removals = [];
  const verifications = [];
  const recoveryJournal = {
    async readVerified() { return structuredClone(journal); },
    async remove(input) {
      removals.push(input);
      return remove ? remove(input) : { removed: true };
    },
    async commit(input) {
      return { ...input, recoveryHtmlSha256: sha256(input.html), journalSha256: sha256("queued journal") };
    },
  };
  const harness = createHarness({ html: currentHtml, recoveryJournal });
  const context = harness.projectSession.register({
    ...harness.context,
    projectRootPath: "/tmp/replacement-project", targetKind: "working-copy",
    workingCopyId: journal.workingCopyId, versionId: "ver_0009",
    exactSourcePath: SOURCE_PATH, sourceSha256: sha256(currentHtml),
  });
  const proof = {
    projectId: PROJECT_ID, documentId: DOCUMENT_ID, workingCopyId: context.workingCopyId,
    currentVersionId: context.versionId, currentSourcePath: SOURCE_PATH,
    currentSourceSha256: sha256(currentHtml), replacementVersionId: "ver_0009",
    operationId: "history_replacement_test", preservedRecoveryId: "replaced_test_proof",
    replacedSourceSha256: sha256(oldHtml), journalSha256: journal.journalSha256,
    journalRevision: journal.revision,
  };
  harness.client.verifyReplacedCurrentDraft = async (input) => {
    verifications.push(input);
    return verify ? verify({ input, proof, harness }) : { verified: true, proof };
  };
  return { ...harness, context, journal, proof, removals, verifications, oldHtml, currentHtml,
    recover: () => harness.workflow.recoverAutosave({ context, currentSourceSha256: sha256(currentHtml) }) };
}

test("DocumentWorkflow retires only an exact verified replacement journal and retains current Version HTML", async (t) => {
  const h = replacedRecoveryHarness();
  t.after(() => h.workflow.dispose());
  const result = await h.recover();
  assert.equal(result.status, "succeeded");
  assert.deepEqual(result.value, { recovered: false, replaced: true, preservedRecoveryId: h.proof.preservedRecoveryId });
  assert.deepEqual(h.verifications, [{ target: h.context, journal: h.journal }]);
  assert.deepEqual(h.removals, [{
    projectId: PROJECT_ID, documentId: DOCUMENT_ID, sourcePath: SOURCE_PATH,
    workingCopyId: h.context.workingCopyId, revision: h.journal.revision,
    recoveryHtmlSha256: h.journal.recoveryHtmlSha256, expectedJournalSha256: h.journal.journalSha256,
  }]);
  assert.equal(h.documentSession.html, h.currentHtml);
  assert.equal(h.documentSession.workingHtmlSha256, sha256(h.currentHtml));
  assert.equal(h.documentSession.persistedSourceSha256, sha256(h.currentHtml));
  assert.equal(h.documentSession.editRevision, 0);
  assert.equal(h.documentSession.lastPersistedRevision, 0);
  assert.equal(h.documentSession.persistState, "idle");
  assert.equal(h.documentSession.pendingWrite, null);
  assert.equal(h.canvas.invalidations, 0);
});

test("DocumentWorkflow retains original recovery behavior without an exact replacement proof", async (t) => {
  const mismatches = [
    "projectId", "documentId", "workingCopyId", "currentVersionId", "currentSourcePath",
    "currentSourceSha256", "replacedSourceSha256", "journalSha256", "journalRevision",
  ];
  for (const variant of ["absent", "unavailable", ...mismatches]) {
    await t.test(variant, async (t) => {
      const h = replacedRecoveryHarness({
        verify: ({ proof }) => {
          if (variant === "unavailable") throw new Error("Bridge unavailable");
          return variant === "absent" ? { verified: false }
            : { verified: true, proof: { ...proof, [variant]: "unrelated" } };
        },
      });
      t.after(() => h.workflow.dispose());
      const result = await h.recover();
      assert.equal(result.status, "succeeded");
      assert.equal(result.value.conflict, true);
      assert.equal(h.documentSession.html, h.oldHtml);
      assert.equal(h.documentSession.persistedSourceSha256, sha256(h.currentHtml));
      assert.equal(h.documentSession.workingHtmlSha256, sha256(h.oldHtml));
      assert.equal(h.documentSession.pendingWrite.html, h.oldHtml);
      assert.equal(h.removals.length, 0);
    });
  }
});

test("DocumentWorkflow never discards unsaved journal bytes just because their base was replaced", async (t) => {
  const h = replacedRecoveryHarness({
    mutateJournal(journal) {
      journal.html = journal.html.replace("V8 current", "unsaved local changes");
      journal.recoveryHtmlSha256 = sha256(journal.html);
    },
  });
  t.after(() => h.workflow.dispose());
  const result = await h.recover();
  assert.equal(result.value.conflict, true);
  assert.equal(h.documentSession.html, h.journal.html);
  assert.equal(h.documentSession.workingHtmlSha256, sha256(h.journal.html));
  assert.equal(h.documentSession.pendingWrite.html, h.journal.html);
  assert.equal(h.verifications.length, 0);
  assert.equal(h.removals.length, 0);
});

test("DocumentWorkflow fences delayed replacement proof against a newer local edit", async (t) => {
  let releaseProof;
  let markProofStarted;
  const proofStarted = new Promise((resolve) => { markProofStarted = resolve; });
  const h = replacedRecoveryHarness({
    verify: ({ proof }) => new Promise((resolve) => {
      releaseProof = () => resolve({ verified: true, proof });
      markProofStarted();
    }),
  });
  t.after(() => h.workflow.dispose());
  const recovering = h.recover();
  await proofStarted;
  const localHtml = h.currentHtml.replace("V9 current", "new local edit");
  h.documentSession.acceptEdit({
    html: localHtml,
    context: h.context,
    write: h.context,
  });
  releaseProof();
  const result = await recovering;
  assert.equal(result.status, "stale");
  assert.equal(h.documentSession.html, localHtml);
  assert.equal(h.documentSession.editRevision, 1);
  assert.equal(h.removals.length, 0);
});

test("DocumentWorkflow leaves a newer Main journal and current HTML intact when replacement retirement loses CAS", async (t) => {
  const h = replacedRecoveryHarness({
    remove(input) {
      assert.notEqual(input.expectedJournalSha256, h.journal.journalSha256);
      throw new Error("RECOVERY_JOURNAL_CAS_MISMATCH");
    },
    verify({ proof }) {
      h.journal.html = "<!doctype html><html><body>newer recovery</body></html>";
      h.journal.revision += 1;
      h.journal.journalSha256 = sha256("newer journal");
      h.journal.recoveryHtmlSha256 = sha256(h.journal.html);
      return { verified: true, proof };
    },
  });
  t.after(() => h.workflow.dispose());
  const result = await h.recover();
  assert.equal(result.status, "blocked");
  assert.equal(result.code, "DOCUMENT_REPLACED_RECOVERY_RETIRE_FAILED");
  assert.equal(h.removals[0].expectedJournalSha256, sha256("V8 journal"));
  assert.equal(h.documentSession.html, h.currentHtml);
  assert.equal(h.documentSession.workingHtmlSha256, sha256(h.currentHtml));
  assert.equal(h.documentSession.persistedSourceSha256, sha256(h.currentHtml));
  assert.equal(h.documentSession.pendingWrite, null);
  assert.equal(h.journal.revision, 13);
  assert.equal(h.journal.html, "<!doctype html><html><body>newer recovery</body></html>");
});

test("DocumentWorkflow does not recover document HTML without a Main journal", async () => {
  const before = "<!doctype html><html><body><p>one</p></body></html>";
  const harness = createHarness({ html: before });
  const outcome = await harness.workflow.recoverAutosave({
    context: harness.context,
    currentSourceSha256: sha256(before),
    serverRevision: 2,
  });
  assert.equal(outcome.status, "succeeded");
  assert.equal(outcome.value.recovered, false);
  assert.equal(harness.documentSession.html, before);
  assert.equal(harness.documentSession.pendingWrite, null);
});

test("DocumentWorkflow restores only verified Main journal HTML", async () => {
  const before = "<!doctype html><html><body><p>one</p></body></html>";
  const journalHtml = before.replace("one", "older-main");
  const recoveryJournal = {
    async readVerified() {
      return {
        schemaVersion: "2.0.0",
        projectId: PROJECT_ID,
        documentId: DOCUMENT_ID,
        sourcePath: SOURCE_PATH,
        expectedSourceSha256: sha256(before),
        revision: 2,
        html: journalHtml,
        recoveryHtmlSha256: sha256(journalHtml),
        journalSha256: sha256("older-journal"),
        updatedAt: "2026-09-01T00:00:00.000Z",
      };
    },
    async commit(input) {
      return {
        ...input,
        recoveryHtmlSha256: sha256(input.html),
        journalSha256: sha256(`journal:${input.revision}`),
        updatedAt: "2026-09-01T00:00:01.000Z",
      };
    },
    async remove() { return { removed: true }; },
  };
  const harness = createHarness({ html: before, recoveryJournal });
  const outcome = await harness.workflow.recoverAutosave({
    context: harness.context,
    currentSourceSha256: sha256(before),
    serverRevision: 2,
  });
  assert.equal(outcome.status, "succeeded");
  assert.equal(outcome.value.queued, true);
  assert.equal(harness.documentSession.html, journalHtml);
  assert.equal(harness.documentSession.editRevision, 3);
});

test("DocumentWorkflow automatically restores a verified Main journal without local metadata", async () => {
  const before = "<!doctype html><html><body><p>one</p></body></html>";
  const recoveredHtml = before.replace("one", "main-only");
  const recoveryJournal = {
    async readVerified() {
      return {
        schemaVersion: "2.0.0",
        projectId: PROJECT_ID,
        documentId: DOCUMENT_ID,
        sourcePath: SOURCE_PATH,
        workingCopyId: "",
        expectedSourceSha256: sha256(before),
        revision: 3,
        html: recoveredHtml,
        recoveryHtmlSha256: sha256(recoveredHtml),
        journalSha256: sha256("main-only-journal"),
        updatedAt: "2026-09-01T00:00:00.000Z",
      };
    },
    async commit(input) {
      return {
        ...input,
        recoveryHtmlSha256: sha256(input.html),
        journalSha256: sha256(`main-only:${input.revision}`),
        updatedAt: "2026-09-01T00:00:01.000Z",
      };
    },
    async remove() { return { removed: true }; },
  };
  const harness = createHarness({ html: before, recoveryJournal });
  const outcome = await harness.workflow.recoverAutosave({
    context: harness.context,
    currentSourceSha256: sha256(before),
    serverRevision: 1,
  });
  assert.equal(outcome.status, "succeeded");
  assert.equal(outcome.value.queued, true);
  assert.equal(harness.documentSession.html, recoveredHtml);
  assert.equal(harness.documentSession.persistState, "queued");
  assert.equal(harness.documentSession.persistedSourceSha256, sha256(before));
  assert.equal(harness.documentSession.workingHtmlSha256, sha256(recoveredHtml));
});

test("DocumentWorkflow restores Main journal HTML without browser audit events", async () => {
  const before = "<!doctype html><html><body><p>one</p></body></html>";
  const recoveredHtml = before.replace("one", "merged");
  const recoveryJournal = {
    async readVerified() {
      return {
        schemaVersion: "2.0.0",
        projectId: PROJECT_ID,
        documentId: DOCUMENT_ID,
        sourcePath: SOURCE_PATH,
        workingCopyId: "",
        expectedSourceSha256: sha256(before),
        revision: 4,
        html: recoveredHtml,
        recoveryHtmlSha256: sha256(recoveredHtml),
        journalSha256: sha256("merged-journal"),
        updatedAt: "2026-09-01T00:00:00.000Z",
      };
    },
    async commit(input) {
      return {
        ...input,
        recoveryHtmlSha256: sha256(input.html),
        journalSha256: sha256(`merged:${input.revision}`),
        updatedAt: "2026-09-01T00:00:01.000Z",
      };
    },
    async remove() { return { removed: true }; },
  };
  const harness = createHarness({ html: before, recoveryJournal });
  const outcome = await harness.workflow.recoverAutosave({
    context: harness.context,
    currentSourceSha256: sha256(before),
    serverRevision: 1,
  });
  assert.equal(outcome.status, "succeeded");
  assert.equal(outcome.value.queued, true);
  assert.equal(harness.documentSession.html, recoveredHtml);
  assert.deepEqual(harness.commentSession.changeEvents, []);
});

test("DocumentWorkflow keeps one journal in flight and coalesces to the latest pending HTML", async () => {
  const before = "<!doctype html><html><body><p>one</p></body></html>";
  const commits = [];
  let releaseFirst;
  const firstBlocked = new Promise((resolve) => { releaseFirst = resolve; });
  const recoveryJournal = {
    async commit(input) {
      commits.push(structuredClone(input));
      if (commits.length === 1) await firstBlocked;
      return {
        ...input,
        recoveryHtmlSha256: sha256(input.html),
        journalSha256: sha256(`coalesced:${input.revision}`),
        updatedAt: "2026-09-01T00:00:00.000Z",
      };
    },
    async readVerified() { return null; },
    async remove() { return { removed: true }; },
  };
  const harness = createHarness({ html: before, recoveryJournal });
  harness.workflow.enqueueEdit({ html: before.replace("one", "revision-1") });
  await Promise.resolve();
  harness.workflow.enqueueEdit({ html: before.replace("one", "revision-2") });
  harness.workflow.enqueueEdit({ html: before.replace("one", "revision-3") });
  assert.equal(commits.length, 1);
  releaseFirst();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(commits.length, 2);
  assert.equal(commits[1].revision, 3);
  assert.equal(commits[1].html, before.replace("one", "revision-3"));
});

test("DocumentWorkflow waits for exact CAS retirement after source persistence succeeds", async () => {
  const before = "<!doctype html><html><body><p>one</p></body></html>";
  const after = before.replace("one", "saved-and-retired");
  let receipt = null;
  const removals = [];
  const recoveryJournal = {
    async commit(input) {
      receipt = {
        ...input,
        recoveryHtmlSha256: sha256(input.html),
        journalSha256: sha256(`retire:${input.revision}`),
        updatedAt: "2026-09-02T00:00:00.000Z",
      };
      return receipt;
    },
    async readVerified() { return receipt; },
    async remove(input) {
      removals.push(structuredClone(input));
      assert.equal(input.sourcePath, SOURCE_PATH);
      assert.equal(input.revision, receipt.revision);
      assert.equal(input.recoveryHtmlSha256, receipt.recoveryHtmlSha256);
      assert.equal(input.expectedJournalSha256, receipt.journalSha256);
      receipt = null;
      return { removed: true };
    },
  };
  const harness = createHarness({
    html: before,
    recoveryJournal,
    bridge: {
      async autosave(body) {
        return {
          ok: true,
          content: body.html,
          sha256: sha256(body.html),
          persistedRevision: body.editRevision,
          lastModifiedAt: "2026-09-02T00:00:01.000Z",
        };
      },
    },
  });
  harness.workflow.enqueueEdit({ html: after });
  assert.equal((await harness.workflow.protectForDetach({
    context: harness.context,
  })).status, "succeeded");
  assert.equal((await harness.workflow.flush({ throughRevision: 1 })).status, "succeeded");
  assert.equal(removals.length, 1);
  assert.equal(receipt, null);
  assert.equal(harness.workflow.recoveryCheckpoint, null);
});

test("DocumentWorkflow drains edits queued during recovery retirement without a second user action", async () => {
  const before = "<!doctype html><html><body><p>one</p></body></html>";
  let releaseRetirement;
  let retirementStarted;
  const retiring = new Promise((resolve) => { retirementStarted = resolve; });
  const barrier = new Promise((resolve) => { releaseRetirement = resolve; });
  let receipt = null;
  let removals = 0;
  const writes = [];
  const harness = createHarness({
    html: before,
    recoveryJournal: {
      async commit(input) {
        receipt = {
          ...input,
          recoveryHtmlSha256: sha256(input.html),
          journalSha256: sha256(`retirement-race:${input.revision}`),
          updatedAt: "2026-09-07T00:00:00.000Z",
        };
        return receipt;
      },
      async readVerified() { return receipt; },
      async remove() {
        if (++removals === 1) {
          retirementStarted();
          await barrier;
        }
        receipt = null;
        return { removed: true };
      },
    },
    bridge: {
      async autosave(body) {
        writes.push(body);
        return {
          ok: true, content: body.html, sha256: sha256(body.html),
          persistedRevision: body.editRevision,
          lastModifiedAt: "2026-09-07T00:00:01.000Z",
        };
      },
    },
  });
  harness.workflow.enqueueEdit({ html: before.replace("one", "two") });
  await harness.workflow.protectForDetach({ context: harness.context });
  const first = harness.workflow.flush();
  await retiring;
  assert.equal(harness.documentSession.lastPersistedRevision, 1);
  harness.workflow.enqueueEdit({ html: before.replace("one", "three") });
  // Several native checkpoints may join the same finishing flush. They must
  // share the next write, with the latest exact expected Hash, rather than
  // returning the old receipt or starting parallel writes.
  const followers = [harness.workflow.flush(), harness.workflow.flush(), harness.workflow.flush()];
  releaseRetirement();
  const outcomes = await Promise.all([first, ...followers]);
  assert.ok(outcomes.every((outcome) => outcome.status === "succeeded"));
  assert.deepEqual(writes.map((write) => write.editRevision), [1, 2]);
  assert.equal(writes[1].expectedSourceSha256, sha256(writes[0].html));
  assert.equal(writes[1].html, before.replace("one", "three"));
  assert.equal(harness.documentSession.lastPersistedRevision, 2);
  assert.equal(harness.documentSession.pendingWrite, null);
  assert.equal(harness.documentSession.persistState, "idle");
});

test("DocumentWorkflow never claims a newer journal receipt while deleting stale recovery", async () => {
  let reads = 0;
  let removals = 0;
  const harness = createHarness({
    recoveryJournal: {
      async readVerified() {
        reads += 1;
        return null;
      },
      async commit() {
        throw new Error("commit is not expected");
      },
      async remove() {
        removals += 1;
        return { removed: true };
      },
    },
  });

  harness.workflow.clearRecovery(harness.context);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(reads, 0);
  assert.equal(removals, 0);
});

test("DocumentWorkflow applies current-open undo locally and saves the resulting full HTML", async () => {
  const before = "<!doctype html><html><body><p>one</p></body></html>";
  const after = before.replace("one", "two");
  const entry = operation(before, after);
  const calls = [];
  const harness = createHarness({
    html: before,
    bridge: {
      async autosave(body) {
        calls.push(body);
        return {
          content: body.html,
          sha256: sha256(body.html),
          persistedRevision: body.editRevision,
          lastModifiedAt: "2026-08-11T00:00:02.000Z",
        };
      },
    },
  });
  assert.equal(harness.workflow.enqueueEdit({
    html: after,
    sourceTransaction: entry,
    context: harness.context,
  }).status, "succeeded");
  assert.equal((await harness.workflow.flush()).status, "succeeded");
  assert.equal(harness.sourceHistorySession.capabilities.canUndo, true);

  const outcome = await harness.workflow.performHistoryAction({
    direction: "undo",
    context: harness.context,
  });

  assert.equal(outcome.status, "succeeded");
  assert.equal(calls.length, 2);
  assert.equal(calls[0].html, after);
  assert.equal(calls[1].html, before);
  assert.equal(harness.documentSession.html, before);
  assert.equal(harness.documentSession.persistedSourceSha256, sha256(before));
  assert.equal(harness.canvas.history.length, 1);
  assert.deepEqual(harness.canvas.history[0].operation, {
    kind: "text",
  });
  assert.equal(harness.sourceHistorySession.capabilities.canRedo, true);
});

for (const change of ["hash", "working-copy", "project-root"]) {
  test(`DocumentWorkflow history drain accepts only a same-member Hash refresh (${change})`, async () => {
    const before = "<!doctype html><html><body><p>one</p></body></html>";
    const after = before.replace("one", "two");
    const target = {
      projectId: PROJECT_ID, documentId: DOCUMENT_ID,
      projectRootPath: "/tmp/managed-project", targetKind: "working-copy",
      workingCopyId: "work_ver_0001", versionId: "ver_0001",
      exactSourcePath: SOURCE_PATH, sourceSha256: sha256(before),
    };
    const writes = [];
    const harness = createHarness({ html: before, bridge: {
      async autosave(body) {
        writes.push(body);
        return { ok: true, content: body.html, sha256: sha256(body.html),
          persistedRevision: body.editRevision, lastModifiedAt: "2026-09-07T00:00:00.000Z",
          openTarget: { ...target, sourceSha256: sha256(body.html),
            ...(change === "working-copy" ? { workingCopyId: "work_ver_0002", versionId: "ver_0002" } : {}),
            ...(change === "project-root" ? { projectRootPath: "/tmp/other-project" } : {}),
          } };
      },
    } });
    harness.projectSession.refreshOpenTarget(target);
    const context = harness.projectSession.context;
    harness.sourceHistorySession.activate(context, sha256(before), null);
    harness.workflow.enqueueEdit({ html: after, sourceTransaction: operation(before, after), context });
    const outcome = await harness.workflow.performHistoryAction({ direction: "undo", context });
    if (change === "hash") {
      assert.equal(outcome.status, "succeeded");
      assert.deepEqual(writes.map((write) => write.html), [after, before]);
      assert.equal(harness.documentSession.html, before);
    } else {
      assert.equal(outcome.status, "stale");
      assert.equal(writes.length, 1);
      assert.equal(harness.documentSession.html, after);
    }
  });
}

test("DocumentWorkflow force-unlock adopts disk HTML and clears persistence conflict", async () => {
  const before = "<!doctype html><html><body><p>one</p></body></html>";
  const external = before.replace("one", "external");
  const harness = createHarness({
    html: before,
    bridge: {
      async resolveConflict(body) {
        assert.equal(body.action, "force-unlock");
        assert.equal(body.expectedSourceSha256, sha256(external));
        return {
          status: "force-unlocked",
          projectId: PROJECT_ID,
          documentId: DOCUMENT_ID,
          sourcePath: SOURCE_PATH,
          content: external,
          sha256: sha256(external),
          lastModifiedAt: "2026-08-11T00:00:02.000Z",
        };
      },
      async sourcePreview() {
        return {
          content: external,
          sha256: sha256(external),
          lastModifiedAt: "2026-08-11T00:00:02.000Z",
        };
      },
    },
  });
  harness.documentSession.publishAuthority({
    html: before,
    persistedSourceSha256: sha256(before),
    workingHtmlSha256: sha256(before),
    editRevision: 3,
    lastPersistedRevision: 0,
    persistState: "conflict",
    persistError: "源文件在磁盘上被其他程序修改了。",
    operationId: "test-force-unlock-conflict",
  });

  const requested = await harness.workflow.acceptExternalConflict({
    context: harness.context,
  });
  const outcome = await harness.workflow.acceptExternalConflict({
    context: harness.context,
    intent: { kind: "confirm", confirmation: requested.confirmation },
  });

  assert.equal(outcome.status, "succeeded");
  assert.equal(harness.documentSession.html, external);
  assert.equal(harness.documentSession.persistedSourceSha256, sha256(external));
  assert.equal(harness.documentSession.persistState, "idle");
  assert.equal(harness.documentSession.pendingWrite, null);
  assert.equal(harness.documentSession.lastPersistedRevision, 3);
});

test("DocumentWorkflow accepts a Working Copy conflict through preview-bound force-unlock", async () => {
  const before = "<!doctype html><html><body><p>one</p></body></html>";
  const external = before.replace("one", "external");
  const conflictResolutions = [];
  const harness = createHarness({
    html: before,
    bridge: {
      async resolveConflict(request) {
        conflictResolutions.push(request);
        return {
          status: "force-unlocked",
          projectId: PROJECT_ID,
          documentId: DOCUMENT_ID,
          sourcePath: SOURCE_PATH,
          content: external,
          sha256: sha256(external),
          lastModifiedAt: "2026-08-11T00:00:03.000Z",
        };
      },
      async sourcePreview() {
        return {
          content: external,
          sha256: sha256(external),
          lastModifiedAt: "2026-08-11T00:00:03.000Z",
        };
      },
    },
  });
  harness.documentSession.recordPersistenceFailure({
    conflict: true,
    error: "源文件在磁盘上被其他程序修改了。",
  });

  const requested = await harness.workflow.acceptExternalConflict({
    context: harness.context,
  });
  const outcome = await harness.workflow.acceptExternalConflict({
    context: harness.context,
    intent: { kind: "confirm", confirmation: requested.confirmation },
  });

  assert.equal(outcome.status, "succeeded");
  assert.equal(conflictResolutions.length, 1);
  assert.match(conflictResolutions[0].operationId, /^accept-external-conflict_/u);
  const resolution = { ...conflictResolutions[0] };
  delete resolution.operationId;
  assert.deepEqual(resolution, {
    ...harness.context,
    action: "force-unlock",
    expectedSourceSha256: sha256(external),
  });
  assert.equal(harness.documentSession.html, external);
  assert.equal(harness.documentSession.persistState, "idle");
  assert.equal(harness.documentSession.pendingWrite, null);
});

test("preview acceptance refuses an edit checkpointed during its freeze", async () => {
  const before = "<!doctype html><html><body><p>one</p></body></html>";
  const external = before.replace("one", "external");
  const checkpointed = before.replace("one", "checkpointed");
  let conflictResolutions = 0;
  const harness = createHarness({
    html: before,
    bridge: {
      async sourcePreview() {
        return { content: external, sha256: sha256(external) };
      },
      async resolveConflict() {
        conflictResolutions += 1;
        return {};
      },
    },
  });
  const preview = await harness.workflow.previewExternalSource({ context: harness.context });
  harness.canvas.freeze = async () => {
    harness.workflow.enqueueEdit({ html: checkpointed });
    return { ok: true };
  };

  const outcome = await harness.workflow.adoptShownExternalPreview({
    context: harness.context,
    previewReceipt: preview.value,
  });

  assert.equal(outcome.status, "blocked");
  assert.equal(outcome.code, "EXTERNAL_SOURCE_PREVIEW_STALE");
  assert.equal(harness.documentSession.html, checkpointed);
  assert.equal(conflictResolutions, 0);
});

test("a temporary preview adoption failure keeps the exact receipt retryable", async () => {
  const before = "<!doctype html><html><body><p>one</p></body></html>";
  const external = before.replace("one", "external");
  let conflictResolutions = 0;
  const harness = createHarness({
    html: before,
    bridge: {
      async sourcePreview() {
        return { content: external, sha256: sha256(external) };
      },
      async resolveConflict() {
        conflictResolutions += 1;
        if (conflictResolutions === 1) throw new Error("temporary bridge failure");
        return {
          projectId: PROJECT_ID,
          documentId: DOCUMENT_ID,
          sourcePath: SOURCE_PATH,
          content: external,
          sha256: sha256(external),
        };
      },
    },
  });
  const preview = await harness.workflow.previewExternalSource({ context: harness.context });

  const failed = await harness.workflow.adoptShownExternalPreview({
    context: harness.context,
    previewReceipt: preview.value,
  });
  const retried = await harness.workflow.adoptShownExternalPreview({
    context: harness.context,
    previewReceipt: preview.value,
  });

  assert.equal(failed.status, "rejected");
  assert.equal(retried.status, "succeeded");
  assert.equal(retried.value.source.sourceSha256, sha256(external));
  assert.equal(conflictResolutions, 2);
});

test("DocumentWorkflow treats matching source-stat hashes as a save echo", async () => {
  const html = "<!doctype html><html><body><p>one</p></body></html>";
  const harness = createHarness({
    html,
    bridge: {
      async sourceStat() {
        return { sha256: sha256(html), lastModifiedAt: "2026-08-11T00:00:02.000Z", size: 40 };
      },
    },
  });

  const outcome = await harness.workflow.observeExternalSourceChange({
    sourcePath: SOURCE_PATH,
  });

  assert.equal(outcome.status, "succeeded");
  assert.equal(outcome.value.changed, false);
  assert.equal(outcome.value.unchanged, true);
  assert.equal(harness.documentSession.persistState, "idle");
});

test("DocumentWorkflow projects a conflict when source-stat hash diverges", async () => {
  const html = "<!doctype html><html><body><p>one</p></body></html>";
  const harness = createHarness({
    html,
    bridge: {
      async sourceStat() {
        return {
          sha256: sha256(html.replace("one", "two")),
          lastModifiedAt: "2026-08-11T00:00:02.000Z",
          size: 40,
        };
      },
    },
  });

  const outcome = await harness.workflow.observeExternalSourceChange({
    sourcePath: SOURCE_PATH,
  });

  assert.equal(outcome.status, "succeeded");
  assert.equal(outcome.value.changed, true);
  assert.equal(outcome.value.conflict, true);
  assert.equal(harness.documentSession.persistState, "conflict");
  assert.equal(harness.documentSession.html, html);
});

test("observeExternalSourceChange keeps the editor when disk hash matches", async () => {
  const html = "<!doctype html><html><body><p>one</p></body></html>";
  const harness = createHarness({
    html,
    bridge: {
      async source(sourcePath) {
        return {
          projectId: PROJECT_ID,
          documentId: DOCUMENT_ID,
          sourcePath,
          content: html,
          sha256: sha256(html),
          lastModifiedAt: "2026-08-15T00:00:00.000Z",
        };
      },
    },
  });

  const outcome = await harness.workflow.observeExternalSourceChange({
    sourcePath: SOURCE_PATH,
  });

  assert.equal(outcome.status, "succeeded");
  assert.equal(outcome.value.unchanged, true);
  assert.equal(harness.documentSession.persistState, "idle");
  assert.equal(harness.documentSession.html, html);
});

test("observeExternalSourceChange enters conflict without adopting disk bytes", async () => {
  const html = "<!doctype html><html><body><p>one</p></body></html>";
  const disk = html.replace("one", "external");
  const harness = createHarness({
    html,
    bridge: {
      async source(sourcePath) {
        return {
          projectId: PROJECT_ID,
          documentId: DOCUMENT_ID,
          sourcePath,
          content: disk,
          sha256: sha256(disk),
        };
      },
    },
  });

  const outcome = await harness.workflow.observeExternalSourceChange({
    sourcePath: SOURCE_PATH,
  });

  assert.equal(outcome.status, "succeeded");
  assert.equal(outcome.value.conflict, true);
  assert.equal(harness.documentSession.persistState, "conflict");
  assert.equal(harness.documentSession.html, html);
  assert.equal(harness.documentSession.persistedSourceSha256, sha256(html));
});

test("an old disk observation cannot mark newly adopted source as conflicted", async () => {
  const html = "<!doctype html><html><body><p>before adoption</p></body></html>";
  const adopted = html.replace("before adoption", "adopted");
  let finishStat;
  let disk = html;
  const harness = createHarness({ html, bridge: {
    sourceStat() {
      return new Promise((resolve) => { finishStat = () => resolve({ sha256: sha256(disk) }); });
    },
  } });
  const observing = harness.workflow.observeExternalSourceChange({ sourcePath: SOURCE_PATH });
  harness.documentSession.publishAuthority({
    html: adopted, persistedSourceSha256: sha256(adopted), workingHtmlSha256: sha256(adopted),
    context: harness.context, operationId: "adoption-during-disk-observation",
  });
  finishStat();
  const outcome = await observing;
  assert.equal(outcome.status, "stale");
  assert.equal(harness.documentSession.persistState, "idle");
  assert.equal(harness.documentSession.html, adopted);

  // A fresh observation still detects a real external write against the new source.
  disk = adopted.replace("adopted", "external");
  const fresh = harness.workflow.observeExternalSourceChange({ sourcePath: SOURCE_PATH });
  finishStat();
  assert.equal((await fresh).value.conflict, true);
  assert.equal(harness.documentSession.persistState, "conflict");
  assert.equal(harness.documentSession.html, adopted);
  harness.workflow.dispose();
});

test("observeExternalSourceChange ignores stale paths and in-flight writes", async () => {
  const html = "<!doctype html><html><body><p>one</p></body></html>";
  let sourceCalls = 0;
  const harness = createHarness({
    html,
    bridge: {
      async source() {
        sourceCalls += 1;
        throw new Error("should not read while writing");
      },
    },
  });

  const stale = await harness.workflow.observeExternalSourceChange({
    sourcePath: "/tmp/other-document.html",
  });
  assert.equal(stale.status, "succeeded");
  assert.equal(stale.value.ignored, true);

  harness.documentSession.acceptEdit({ html, write: {} });
  harness.documentSession.beginWrite();
  const deferred = await harness.workflow.observeExternalSourceChange({
    sourcePath: SOURCE_PATH,
  });
  assert.equal(deferred.status, "succeeded");
  assert.equal(deferred.value.deferred, true);
  assert.equal(sourceCalls, 0);
});

test("repairCurrentCanvas records verified authority after a successful render", async () => {
  const html = "<!doctype html><html><body><p>one</p></body></html>";
  const harness = createHarness({ html });
  const outcome = await harness.workflow.repairCurrentCanvas({
    context: harness.context,
  });
  assert.equal(outcome.status, "succeeded");
  assert.deepEqual(harness.documentSession.canvasAuthority, {
    status: "verified",
    generation: 1,
    renderedSha256: sha256(html),
    error: null,
  });
});

test("repairCurrentCanvas reuses an exact verified Canvas without freezing or rebuilding", async () => {
  const html = "<!doctype html><html><body><p>already verified</p></body></html>";
  let freezes = 0;
  const harness = createHarness({
    html,
    canvasOverrides: {
      async freeze() {
        freezes += 1;
        return { ok: true };
      },
    },
  });
  const receipt = harness.documentSession.sourceReceipt;
  assert.equal(harness.workflow.confirmCanvas({
    receipt,
    renderedHtml: html,
    renderedSha256: sha256(html),
    frameGeneration: receipt.canvasGeneration,
  }), true);

  const outcome = await harness.workflow.repairCurrentCanvas({
    context: harness.context,
  });

  assert.equal(outcome.status, "succeeded");
  assert.equal(outcome.value.page.status, "restored");
  assert.equal(outcome.value.page.reusedCanvasAuthority, true);
  assert.equal(freezes, 0);
  assert.equal(harness.canvas.invalidations, 0);
  assert.equal(harness.canvas.rebuilds, 0);
  assert.equal(harness.canvas.unlocks, 0);
  assert.equal(harness.documentSession.canvasAuthority.status, "verified");
});

test("repairCurrentCanvas joins the existing document save before rebuilding the projection", async () => {
  const before = "<!doctype html><html><body><p>one</p></body></html>";
  const after = before.replace("one", "pending save");
  const save = deferred();
  let autosaveCalls = 0;
  let sourceCalls = 0;
  const openTarget = (sourceSha256) => ({
    projectId: PROJECT_ID,
    documentId: DOCUMENT_ID,
    projectRootPath: "/tmp/document-workflow-project",
    targetKind: "working-copy",
    workingCopyId: "working_document_workflow",
    versionId: "version_document_workflow",
    exactSourcePath: SOURCE_PATH,
    sourceSha256,
  });
  const harness = createHarness({
    html: before,
    bridge: {
      async autosave() {
        autosaveCalls += 1;
        return save.promise;
      },
      async source() {
        sourceCalls += 1;
        throw new Error("projection repair must not read source");
      },
    },
  });
  const requestedContext = harness.projectSession.refreshOpenTarget(openTarget(sha256(before)));
  const sourceEvents = [];
  harness.workflow.subscribeEvents((event) => {
    if (event.type === "document-source-operation") sourceEvents.push(event);
  });
  harness.workflow.enqueueEdit({ html: after, context: requestedContext });

  const repair = harness.workflow.repairCurrentCanvas({ context: requestedContext });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(autosaveCalls, 1);
  save.resolve({
    ok: true,
    content: after,
    sha256: sha256(after),
    persistedRevision: 1,
    lastModifiedAt: "2026-08-11T00:00:01.000Z",
    openTarget: openTarget(sha256(after)),
  });

  const outcome = await repair;
  assert.equal(outcome.status, "succeeded");
  assert.equal(outcome.value.page.status, "restored");
  assert.equal(harness.projectSession.matches(requestedContext), false);
  assert.equal(outcome.value.source.receipt.context.sourceSha256, sha256(after));
  assert.deepEqual(sourceEvents.map((event) => event.phase), ["running", "idle"]);
  assert.equal(sourceEvents[0].context.sourceSha256, sha256(before));
  assert.equal(sourceEvents[1].context.sourceSha256, sha256(after));
  assert.equal(harness.documentSession.html, after);
  assert.equal(harness.documentSession.persistedSourceSha256, sha256(after));
  assert.equal(autosaveCalls, 1);
  assert.equal(sourceCalls, 0);
  assert.equal(harness.canvas.rebuilds, 0);
  assert.equal(harness.canvas.unlocks, 1);
});

for (const interleave of ["own-save", "project-switch", "version-switch", "independent-edit", "wrong-freeze-receipt", "invalid-save-ack", "save-failure", "dispose", "verify-error"]) {
test(`repairCurrentCanvas freeze checkpoint: ${interleave}`, async () => {
  const before = "<!doctype html><html><body><p>one</p></body></html>";
  const after = before.replace("one", "native checkpoint");
  const freezeComplete = deferred();
  const saved = deferred();
  const openTarget = (sourceSha256) => ({
    projectId: PROJECT_ID, documentId: DOCUMENT_ID,
    projectRootPath: "/tmp/document-workflow-project", targetKind: "working-copy",
    workingCopyId: "working_document_workflow", versionId: "version_document_workflow",
    exactSourcePath: SOURCE_PATH, sourceSha256,
  });
  let writes = 0;
  let releases = 0;
  let freezes = 0;
  const harness = createHarness({
    html: before,
    bridge: {
      async autosave(body) {
        writes += 1;
        if (interleave === "save-failure") throw new Error("synthetic save failure");
        return { ok: true, content: body.html, sha256: interleave === "invalid-save-ack" ? sha256("wrong") : sha256(body.html),
          persistedRevision: body.editRevision, lastModifiedAt: "2026-09-22T00:00:00.000Z",
          openTarget: openTarget(sha256(body.html)) };
      },
    },
    canvasOverrides: {
      async verifyRendered() {
        if (interleave === "verify-error") throw new Error("synthetic render failure");
      },
      async freeze() {
        if (freezes++ > 0) return { ok: true };
        harness.workflow.enqueueEdit({ html: after, sourceTransaction: operation(before, after), context: harness.projectSession.context });
        const outcome = await harness.workflow.flush();
        saved.resolve(outcome);
        await freezeComplete.promise;
        return { ok: outcome.status === "succeeded", html: interleave === "wrong-freeze-receipt" ? before : after, workingSourceSha256: sha256(after),
          release: () => { releases += 1; } };
      },
    },
  });
  const context = harness.projectSession.refreshOpenTarget(openTarget(sha256(before)));
  const repair = harness.workflow.repairCurrentCanvas({ context });
  const saveOutcome = await saved.promise;
  const saveFailed = ["invalid-save-ack", "save-failure"].includes(interleave);
  assert.equal(saveOutcome.status === "succeeded", !saveFailed);
  if (!saveFailed) assert.equal(harness.projectSession.matches(context), false, "save advanced the exact open-target Hash during freeze");
  if (interleave === "project-switch") harness.projectSession.openLocator(NEXT_SOURCE_PATH);
  if (interleave === "version-switch") harness.projectSession.refreshOpenTarget({ ...openTarget(sha256(after)), targetKind: "version", versionId: "other-version" });
  if (interleave === "independent-edit") harness.workflow.enqueueEdit({ html: after + " ", context: harness.projectSession.context });
  if (interleave === "dispose") harness.workflow.dispose();
  freezeComplete.resolve();
  const outcome = await repair;
  if (interleave !== "own-save") {
    assert.equal(outcome.status, saveFailed ? "blocked" : interleave === "verify-error" ? "succeeded" : "stale");
    if (interleave === "verify-error") assert.equal(outcome.value.page.status, "repair-required");
    assert.equal(releases, saveFailed ? 0 : 1, "every acquired freeze settles through its original scoped release");
    assert.equal(harness.canvas.unlocks, 0);
    assert.equal(writes, 1);
    assert.equal(harness.canvas.rebuilds, 0);
    if (interleave === "independent-edit") assert.equal(harness.documentSession.html, after + " ");
    return;
  }
  assert.equal(outcome.status, "succeeded");
  assert.equal(outcome.value.page.status, "restored");
  assert.equal(outcome.value.source.sourceSha256, sha256(after));
  assert.equal(releases, 1);
  assert.equal(harness.canvas.unlocks, 0, "owned release does not call the unscoped unlock port");
  assert.equal(writes, 1);
  const continued = after.replace("native checkpoint", "continued editing");
  harness.workflow.enqueueEdit({ html: continued, context: harness.projectSession.context });
  assert.equal((await harness.workflow.flush()).status, "succeeded");
  assert.equal(harness.documentSession.persistedSourceSha256, sha256(continued));
  assert.equal(writes, 2);
});
}

test("repairCurrentCanvas rejects a hash refresh when an independent edit changes the source", async () => {
  const before = "<!doctype html><html><body><p>one</p></body></html>";
  const pending = before.replace("one", "pending save");
  const independent = before.replace("one", "independent edit");
  const firstSave = deferred();
  let autosaveCalls = 0;
  const openTarget = (sourceSha256) => ({
    projectId: PROJECT_ID,
    documentId: DOCUMENT_ID,
    projectRootPath: "/tmp/document-workflow-project",
    targetKind: "working-copy",
    workingCopyId: "working_document_workflow",
    versionId: "version_document_workflow",
    exactSourcePath: SOURCE_PATH,
    sourceSha256,
  });
  const harness = createHarness({
    html: before,
    bridge: {
      async autosave(body) {
        autosaveCalls += 1;
        if (autosaveCalls === 1) return firstSave.promise;
        return {
          ok: true,
          content: body.html,
          sha256: sha256(body.html),
          persistedRevision: body.editRevision,
          lastModifiedAt: "2026-08-11T00:00:02.000Z",
          openTarget: openTarget(sha256(body.html)),
        };
      },
    },
  });
  const requestedContext = harness.projectSession.refreshOpenTarget(openTarget(sha256(before)));
  harness.workflow.enqueueEdit({ html: pending, context: requestedContext });
  const repair = harness.workflow.repairCurrentCanvas({ context: requestedContext });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(autosaveCalls, 1);
  harness.workflow.enqueueEdit({ html: independent, context: requestedContext });
  firstSave.resolve({
    ok: true,
    content: pending,
    sha256: sha256(pending),
    persistedRevision: 1,
    lastModifiedAt: "2026-08-11T00:00:01.000Z",
    openTarget: openTarget(sha256(pending)),
  });

  const outcome = await repair;
  assert.equal(outcome.status, "stale");
  assert.equal(harness.documentSession.html, independent);
  assert.equal(harness.documentSession.persistedSourceSha256, sha256(independent));
  assert.equal(autosaveCalls, 2);
  assert.equal(harness.canvas.rebuilds, 0);
});

test("repairCurrentCanvas coalesces duplicate intents for one exact source", async () => {
  const html = "<!doctype html><html><body><p>one</p></body></html>";
  let verifyCalls = 0;
  const harness = createHarness({
    html,
    canvasOverrides: {
      async verifyRendered() {
        verifyCalls += 1;
      },
    },
  });
  const first = harness.workflow.repairCurrentCanvas({ context: harness.context });
  const duplicate = harness.workflow.repairCurrentCanvas({ context: harness.context });
  assert.equal((await first).status, "succeeded");
  assert.equal((await duplicate).status, "succeeded");
  assert.equal(verifyCalls, 1);
});

test("Canvas observation confirms exactly once and rejects an external duplicate", async () => {
  const html = "<!doctype html><html><body><p>observation</p></body></html>";
  let observation = null;
  let verifyCalls = 0;
  const harness = createHarness({
    html,
    canvasOverrides: {
      async verifyRendered(renderedHtml, renderedSha256, _context, receipt) {
        verifyCalls += 1;
        observation = Object.freeze({
          receipt,
          renderedHtml,
          renderedSha256,
          frameGeneration: 11,
        });
        return observation;
      },
    },
  });
  const outcome = await harness.workflow.repairCurrentCanvas({ context: harness.context });

  assert.equal(outcome.status, "succeeded");
  assert.equal(verifyCalls, 1);
  assert.ok(observation);
  assert.equal(harness.workflow.confirmCanvas(observation), false);
  assert.equal(harness.documentSession.canvasAuthority.status, "verified");
});

test("local and history observations with a receipt hash mismatch never verify", () => {
  const html = "<!doctype html><html><body><p>hash fence</p></body></html>";
  const nextHtml = html.replace("hash fence", "next");
  const nextSha256 = sha256(nextHtml);
  const wrongSha256 = sha256("different rendered bytes");
  for (const origin of ["local-edit", "history"]) {
    const harness = createHarness({ html });
    harness.documentSession.acceptEdit({
      html: nextHtml,
      origin,
      sourceSha256: nextSha256,
      context: harness.context,
      operationId: `${origin}-hash-fence`,
      write: null,
    });
    const receipt = harness.documentSession.sourceReceipt;
    assert.equal(harness.workflow.confirmCanvas({
      receipt,
      renderedHtml: nextHtml,
      renderedSha256: wrongSha256,
      frameGeneration: receipt.canvasGeneration,
    }), false, `${origin} rendered hash must match its receipt`);
    assert.equal(harness.documentSession.canvasAuthority.status, "pending");
    assert.equal(harness.workflow.confirmCanvas({
      receipt: { ...receipt, sourceSha256: wrongSha256 },
      renderedHtml: nextHtml,
      renderedSha256: wrongSha256,
      frameGeneration: receipt.canvasGeneration,
    }), false, `${origin} forged receipt hash must remain stale`);
    assert.equal(harness.documentSession.canvasAuthority.status, "pending");
    harness.workflow.dispose();
  }
});

test("a conflict candidate with no working hash cannot self-certify until a corrected receipt", () => {
  const html = "<!doctype html><html><body><p>external</p></body></html>";
  const candidateHtml = html.replace("external", "candidate");
  const candidateSha256 = sha256(candidateHtml);
  const harness = createHarness({ html });
  const adopted = harness.workflow.adoptConflictCandidate({
    context: harness.context,
    html: candidateHtml,
    authoritativeSourceSha256: sha256(html),
    expectedSourceSha256: sha256(html),
    revision: harness.documentSession.editRevision + 1,
  });
  assert.equal(adopted.status, "succeeded");
  assert.equal(harness.documentSession.workingHtmlSha256, null);
  assert.equal(harness.documentSession.sourceReceipt.sourceSha256, "");
  const conflictedReceipt = harness.documentSession.sourceReceipt;
  assert.equal(harness.workflow.confirmCanvas({
    receipt: conflictedReceipt,
    renderedHtml: candidateHtml,
    renderedSha256: candidateSha256,
    frameGeneration: conflictedReceipt.canvasGeneration,
  }), false);
  assert.equal(harness.documentSession.canvasAuthority.status, "pending");

  const correctedReceipt = harness.documentSession.publishAuthority({
    html: candidateHtml,
    persistedSourceSha256: candidateSha256,
    workingHtmlSha256: candidateSha256,
    context: harness.context,
    operationId: "conflict-candidate-corrected-hash",
  }).sourceReceipt;
  assert.notEqual(correctedReceipt.sequence, conflictedReceipt.sequence);
  assert.equal(harness.workflow.confirmCanvas({
    receipt: correctedReceipt,
    renderedHtml: candidateHtml,
    renderedSha256: candidateSha256,
    frameGeneration: correctedReceipt.canvasGeneration,
  }), true);
  harness.workflow.dispose();
});

test("an exact conflict-candidate autosave publishes a corrected hash receipt", async () => {
  const html = "<!doctype html><html><body><p>external</p></body></html>";
  const candidateHtml = html.replace("external", "autosaved-candidate");
  const candidateSha256 = sha256(candidateHtml);
  const harness = createHarness({
    html,
    bridge: {
      async autosave(body) {
        return {
          ok: true,
          content: body.html,
          sha256: candidateSha256,
          persistedRevision: body.editRevision,
          lastModifiedAt: "2026-09-13T00:00:00.000Z",
        };
      },
    },
  });
  const adopted = harness.workflow.adoptConflictCandidate({
    context: harness.context,
    html: candidateHtml,
    authoritativeSourceSha256: sha256(html),
    expectedSourceSha256: sha256(html),
    revision: harness.documentSession.editRevision + 1,
  });
  assert.equal(adopted.status, "succeeded");
  const conflictedReceipt = harness.documentSession.sourceReceipt;
  const beforeGeneration = harness.documentSession.canvasGeneration;
  const flushed = await harness.workflow.flush();

  assert.equal(flushed.status, "succeeded", JSON.stringify(flushed));
  assert.equal(harness.documentSession.sourceReceipt.origin, "authority");
  assert.equal(harness.documentSession.sourceReceipt.sourceSha256, candidateSha256);
  assert.notEqual(harness.documentSession.sourceReceipt.sequence, conflictedReceipt.sequence);
  assert.equal(harness.documentSession.canvasGeneration, beforeGeneration + 1);
  assert.equal(harness.workflow.confirmCanvas({
    receipt: harness.documentSession.sourceReceipt,
    renderedHtml: candidateHtml,
    renderedSha256: candidateSha256,
    frameGeneration: harness.documentSession.canvasGeneration,
  }), true);
  harness.workflow.dispose();
});

test("repairCurrentCanvas tolerates an exact observation confirmed by its composed verifier", async () => {
  const html = "<!doctype html><html><body><p>composed</p></body></html>";
  let harness;
  let observation = null;
  harness = createHarness({
    html,
    canvasOverrides: {
      async verifyRendered(renderedHtml, renderedSha256, _context, receipt) {
        observation = Object.freeze({
          receipt,
          renderedHtml,
          renderedSha256,
          frameGeneration: harness.documentSession.canvasGeneration,
        });
        assert.equal(harness.workflow.confirmCanvas(observation), true);
        return observation;
      },
    },
  });

  const outcome = await harness.workflow.repairCurrentCanvas({ context: harness.context });

  assert.equal(outcome.status, "succeeded");
  assert.equal(outcome.value.page.status, "restored");
  assert.equal(harness.documentSession.canvasAuthority.status, "verified");
  assert.ok(observation);
  assert.equal(harness.workflow.confirmCanvas(observation), false);
});

for (const mismatch of ["html", "hash", "receipt", "generation"]) {
  test(`repairCurrentCanvas rejects a ${mismatch} mismatch after another observer confirms`, async () => {
    const html = "<!doctype html><html><body><p>confirmed</p></body></html>";
    let harness;
    harness = createHarness({
      html,
      canvasOverrides: {
        async verifyRendered(renderedHtml, renderedSha256, _context, receipt) {
          const observation = {
            receipt,
            renderedHtml,
            renderedSha256,
            frameGeneration: harness.documentSession.canvasGeneration,
          };
          assert.equal(harness.workflow.confirmCanvas(observation), true);
          if (mismatch === "html") return { ...observation, renderedHtml: `${html}<!--wrong-->` };
          if (mismatch === "hash") return { ...observation, renderedSha256: sha256("wrong") };
          return {
            ...observation,
            receipt: {
              ...receipt,
              ...(mismatch === "receipt"
                ? { sequence: receipt.sequence - 1 }
                : { canvasGeneration: receipt.canvasGeneration - 1 }),
            },
          };
        },
      },
    });

    const outcome = await harness.workflow.repairCurrentCanvas({ context: harness.context });

    assert.equal(outcome.status, "succeeded");
    assert.equal(outcome.value.page.status, "repair-required");
    assert.equal(harness.documentSession.canvasAuthority.status, "verified");
    harness.workflow.dispose();
  });
}

test("repairCurrentCanvas restores only the accepted projection without reading disk", async () => {
  const oldHtml = "<!doctype html><html><body><p>old</p></body></html>";
  const repairedHtml = oldHtml.replace("old", "repaired");
  let sourceCalls = 0;
  const harness = createHarness({
    html: oldHtml,
    bridge: {
      async source() {
        sourceCalls += 1;
        return {
          projectId: PROJECT_ID,
          documentId: DOCUMENT_ID,
          sourcePath: SOURCE_PATH,
          content: repairedHtml,
          sha256: sha256(repairedHtml),
        };
      },
    },
  });
  harness.documentSession.publishAuthority({
    html: oldHtml,
    persistedSourceSha256: sha256("stale persisted bytes"),
    workingHtmlSha256: sha256(oldHtml),
    operationId: "test-stale-persisted-hash",
  });
  const beforeReceipt = harness.documentSession.sourceReceipt;

  const outcome = await harness.workflow.repairCurrentCanvas({ context: harness.context });

  assert.equal(outcome.status, "succeeded");
  assert.equal(outcome.value.source.status, "unchanged");
  assert.equal(outcome.value.page.status, "restored");
  assert.equal(harness.documentSession.html, oldHtml);
  assert.notEqual(harness.documentSession.sourceReceipt.sequence, beforeReceipt.sequence);
  assert.equal(sourceCalls, 0);
});

test("repairCurrentCanvas verifies its one rebuild fence and does not rebuild again after timeout", async () => {
  const html = "<!doctype html><html><body><p>one rebuild</p></body></html>";
  const rebuildFence = Object.freeze({ frameGeneration: 19, frameDocument: {} });
  const observed = [];
  let sourceCalls = 0;
  let harness;
  harness = createHarness({
    html,
    canvasOverrides: {
      captureActiveFrameFence() {
        return rebuildFence;
      },
      async verifyRendered(
        renderedHtml,
        renderedSha256,
        _context,
        receipt,
        receivedRebuildFence,
      ) {
        observed.push({
          renderedHtml,
          renderedSha256,
          receipt,
          rebuildFence: receivedRebuildFence,
        });
        throw Object.assign(new Error("canvas acknowledgement timed out"), {
          code: "DOCUMENT_CANVAS_ACK_TIMEOUT",
        });
      },
    },
    bridge: {
      async source() {
        sourceCalls += 1;
        throw new Error("projection repair must not read source");
      },
    },
  });

  const outcome = await harness.workflow.repairCurrentCanvas({ context: harness.context });

  assert.equal(outcome.status, "succeeded");
  assert.equal(outcome.value.source.status, "unchanged");
  assert.equal(outcome.value.page.status, "repair-required");
  assert.equal(harness.canvas.rebuilds, 0);
  assert.equal(observed.length, 1);
  assert.equal(observed[0].renderedHtml, html);
  assert.equal(observed[0].renderedSha256, sha256(html));
  assert.equal(observed[0].receipt, harness.documentSession.sourceReceipt);
  assert.equal(observed[0].rebuildFence, rebuildFence);
  assert.equal(sourceCalls, 0);
  assert.equal(harness.documentSession.canvasAuthority.status, "failed");
});

test("Canvas rebuild timeout fails the current R2 and a later R2 authority can verify", async () => {
  const html = "<!doctype html><html><body><p>rebuild</p></body></html>";
  let harness;
  let verifyCalls = 0;
  harness = createHarness({
    html,
    canvasOverrides: {
      async verifyRendered(renderedHtml, renderedSha256, _context, receipt) {
        verifyCalls += 1;
        if (verifyCalls === 1) {
          harness.documentSession.reloadCanvas({
            context: harness.context,
            operationId: "canvas-rebuild-r2",
          });
          throw new Error("canvas timeout after rebuild");
        }
        return Object.freeze({
          receipt,
          renderedHtml,
          renderedSha256,
          frameGeneration: harness.documentSession.canvasGeneration,
        });
      },
    },
  });

  const failed = await harness.workflow.repairCurrentCanvas({ context: harness.context });
  const failedReceipt = harness.documentSession.sourceReceipt;
  assert.equal(failed.status, "succeeded");
  assert.equal(failed.value.source.status, "unchanged");
  assert.equal(failed.value.page.status, "repair-required");
  assert.equal(harness.documentSession.canvasAuthority.status, "failed");
  assert.equal(harness.documentSession.canvasAuthority.generation, failedReceipt.canvasGeneration);
  assert.equal(failedReceipt.operationId, "canvas-rebuild-r2");

  const nextReceipt = harness.documentSession.publishAuthority({
    html,
    persistedSourceSha256: sha256(html),
    context: harness.context,
    operationId: "canvas-rebuild-r3",
  }).sourceReceipt;
  const recovered = await harness.workflow.repairCurrentCanvas({ context: harness.context });
  assert.equal(recovered.status, "succeeded");
  assert.notEqual(harness.documentSession.sourceReceipt.operationId, nextReceipt.operationId);
  assert.equal(harness.documentSession.sourceReceipt.operationId.startsWith("repair-current-canvas_"), true);
  assert.equal(harness.documentSession.canvasAuthority.status, "verified");
});

test("repairCurrentCanvas fails closed when the canvas cannot render", async () => {
  const html = "<!doctype html><html><body><p>one</p></body></html>";
  const harness = createHarness({
    html,
    canvasOverrides: {
      async verifyRendered() {
        throw new Error("canvas did not render");
      },
    },
  });
  const outcome = await harness.workflow.repairCurrentCanvas({
    context: harness.context,
  });
  assert.equal(outcome.status, "succeeded");
  assert.equal(outcome.value.source.status, "unchanged");
  assert.equal(outcome.value.page.status, "repair-required");
  assert.equal(harness.documentSession.canvasAuthority.status, "failed");
  assert.equal(harness.documentSession.canvasAuthority.generation, 1);
});

for (const change of ['none', 'working-copy', 'project-root', 'epoch', 'invalid-ack', 'independent-edit']) {
  test(`DocumentWorkflow serializes queued Undo then Redo against verified history receipts (${change})`, async () => {
    const before = '<!doctype html><html><body><p>one</p></body></html>';
    const after = before.replace('one', 'two');
    const target = {
      projectId: PROJECT_ID, documentId: DOCUMENT_ID,
      projectRootPath: '/tmp/managed-project', targetKind: 'working-copy',
      workingCopyId: 'work_ver_0001', versionId: 'ver_0001',
      exactSourcePath: SOURCE_PATH, sourceSha256: sha256(before),
    };
    const writes = [];
    let releaseUndo;
    const harness = createHarness({ html: before, bridge: {
      async autosave(body) {
        writes.push(body);
        if (writes.length === 2) await new Promise(resolve => { releaseUndo = resolve; });
        return { ok: true, content: body.html,
          sha256: change === 'invalid-ack' && writes.length === 2 ? sha256('wrong receipt') : sha256(body.html),
          persistedRevision: body.editRevision, lastModifiedAt: '2026-09-09T00:00:00.000Z',
          openTarget: { ...target, sourceSha256: sha256(body.html) } };
      },
    } });
    harness.projectSession.refreshOpenTarget(target);
    harness.sourceHistorySession.activate(harness.projectSession.context, sha256(before), null);
    harness.workflow.enqueueEdit({ html: after, sourceTransaction: operation(before, after), context: harness.projectSession.context });
    assert.equal((await harness.workflow.flush()).status, 'succeeded');
    const undo = harness.workflow.performHistoryAction({ direction: 'undo', context: harness.projectSession.context });
    while (!releaseUndo) await new Promise(resolve => setImmediate(resolve));
    const redo = harness.workflow.performHistoryAction({ direction: 'redo', context: harness.projectSession.context });
    assert.notEqual(redo, undo, 'opposite history intents must not share a success receipt');
    if (change === 'working-copy' || change === 'project-root') {
      harness.projectSession.refreshOpenTarget({ ...target, sourceSha256: sha256(after),
        ...(change === 'working-copy' ? { workingCopyId: 'work_ver_0002', versionId: 'ver_0002' } : { projectRootPath: '/tmp/other-project' }) });
    } else if (change === 'epoch') harness.projectSession.openLocator('/tmp/other-document.html');
    else if (change === 'independent-edit') {
      const independent = before.replace('one', 'independent');
      assert.equal(harness.workflow.enqueueEdit({ html: independent,
        sourceTransaction: { ...operation(before, independent), operationId: 'sourceop_document_workflow_002' },
        context: harness.projectSession.context }).status, 'succeeded');
    }
    releaseUndo();
    const outcomes = await Promise.all([undo, redo]);
    if (change === 'none') {
      assert.deepEqual(outcomes.map(outcome => outcome.value?.direction), ['undo', 'redo']);
      assert.deepEqual(writes.map(write => write.html), [after, before, after]);
      assert.equal(writes[2].expectedSourceSha256, sha256(before));
      assert.equal(harness.documentSession.html, after);
      assert.equal(harness.documentSession.persistedSourceSha256, sha256(after));
    } else {
      assert.notEqual(outcomes[1].status, 'succeeded');
      if (change === 'independent-edit') {
        assert.equal(harness.documentSession.html, before.replace('one', 'independent'));
        assert.equal(writes.slice(2).some(write => write.html === after), false);
      } else assert.equal(writes.length, 2, 'queued Redo must not write after its route or receipt changes');
    }
    assert.equal(harness.workflow.hasHistoryAction, false);
  });
}


test("DocumentWorkflow does not retarget Undo when a newer edit arrives during its initial drain", async () => {
  const before = '<!doctype html><html><body><p>one</p></body></html>';
  const after = before.replace('one', 'two');
  const newer = before.replace('one', 'three');
  let releaseSave;
  const writes = [];
  const harness = createHarness({ html: before, bridge: {
    async autosave(body) {
      writes.push(body);
      if (writes.length === 1) await new Promise(resolve => { releaseSave = resolve; });
      return { ok: true, content: body.html, sha256: sha256(body.html),
        persistedRevision: body.editRevision, lastModifiedAt: '2026-09-09T00:00:00.000Z' };
    },
  } });
  harness.sourceHistorySession.activate(harness.context, sha256(before), null);
  harness.workflow.enqueueEdit({ html: after, sourceTransaction: operation(before, after), context: harness.context });
  const undo = harness.workflow.performHistoryAction({ direction: 'undo', context: harness.context });
  while (!releaseSave) await new Promise(resolve => setImmediate(resolve));
  harness.workflow.enqueueEdit({ html: newer, sourceTransaction: operation(after, newer), context: harness.context });
  releaseSave();
  assert.equal((await undo).status, 'stale');
  assert.equal(harness.documentSession.html, newer);
  assert.equal((await harness.workflow.flush()).status, 'succeeded');
  assert.deepEqual(writes.map(write => write.html), [after, newer]);
});


test("leave readiness is current evidence, not a permission retained across an edit", (t) => {
  const h = createHarness();
  t.after(() => h.workflow.dispose());
  assert.equal(h.documentSession.confirmCanvas({ generation: 0,
    renderedSha256: sha256(h.documentSession.html) }), true);
  assert.equal(h.workflow.inspectLeaveReadiness().action, "reuse-verified");
  assert.equal(h.workflow.inspectLeaveReadiness({ hasPendingNativeEdit: true }).action, "full-check");
  const boundary = h.workflow.captureLeaveBoundary();
  assert.equal(h.workflow.verifyLeaveBoundary(boundary, { needsSourceProtection: true,
    committedSourceSha256: sha256(h.documentSession.html) }).kind, "ready");
  h.documentSession.acceptEdit({
    html: h.documentSession.html.replace("one", "newer"),
    context: h.context,
    write: h.context,
  });
  assert.equal(h.workflow.inspectLeaveReadiness().action, "full-check");
  assert.equal(h.workflow.verifyLeaveBoundary(boundary).code, "PROJECT_SWITCH_SOURCE_CHANGED");
});

test("leave boundary cannot cross a same-byte document switch or source replacement", (t) => {
  for (const change of ["context", "source"]) {
    const h = createHarness();
    t.after(() => h.workflow.dispose());
    const boundary = h.workflow.captureLeaveBoundary();
    if (change === "context") h.projectSession.openLocator("/tmp/another-document.html");
    else h.documentSession.acceptEdit({
      html: h.documentSession.html.replace("one", "replacement"),
      context: h.context,
      write: h.context,
    });
    assert.equal(h.workflow.verifyLeaveBoundary(boundary).code, "PROJECT_SWITCH_SOURCE_CHANGED", change);
  }
});

test("leave checks source protection independently of a stale rendered projection", (t) => {
  const h = createHarness();
  t.after(() => h.workflow.dispose());
  const boundary = h.workflow.captureLeaveBoundary();
  assert.equal(h.workflow.inspectLeaveReadiness().action, "full-check");
  assert.equal(h.workflow.verifyLeaveBoundary(boundary, {
    needsSourceProtection: true, committedSourceSha256: sha256(h.documentSession.html),
  }).kind, "ready");
  assert.equal(h.workflow.verifyLeaveBoundary(boundary, {
    needsSourceProtection: true, committedSourceSha256: sha256("different"),
  }).code, "PROJECT_SWITCH_SOURCE_MISMATCH");
  h.workflow.dispose();
  assert.equal(h.workflow.verifyLeaveBoundary(boundary).code, "PROJECT_SWITCH_SOURCE_CHANGED");
});

for (const change of ["none", "working-copy", "project-root", "epoch"]) {
  test(`leave boundary consumes an actual managed autosave acknowledgement (${change})`, async (t) => {
    const before = "<!doctype html><html><body><p>one</p></body></html>";
    const after = before.replace("one", "two");
    const target = {
      projectId: PROJECT_ID, documentId: DOCUMENT_ID,
      projectRootPath: "/tmp/managed-project", targetKind: "working-copy",
      workingCopyId: "work_ver_0001", versionId: "ver_0001",
      exactSourcePath: SOURCE_PATH, sourceSha256: sha256(before),
    };
    const h = createHarness({ html: before, bridge: {
      async autosave(body) {
        return { ok: true, content: body.html, sha256: sha256(body.html),
          persistedRevision: body.editRevision, lastModifiedAt: "2026-09-12T00:00:00.000Z",
          openTarget: { ...target, sourceSha256: sha256(body.html) } };
      },
    } });
    t.after(() => h.workflow.dispose());
    h.projectSession.refreshOpenTarget(target);
    assert.equal(h.workflow.enqueueEdit({ html: after, context: h.projectSession.context }).status, "succeeded");
    const boundary = h.workflow.captureLeaveBoundary();
    assert.equal(boundary.context.sourceSha256, sha256(before));
    const saved = await h.workflow.flush();
    assert.equal(saved.status, "succeeded", JSON.stringify(saved));
    assert.equal(h.projectSession.context.sourceSha256, sha256(after));
    assert.equal(h.projectSession.matches(boundary.context), false,
      "the pre-save target hash is stale even though this is the same managed source");
    if (change === "working-copy" || change === "project-root") {
      h.projectSession.refreshOpenTarget({ ...target, sourceSha256: sha256(after),
        ...(change === "working-copy"
          ? { workingCopyId: "work_ver_0002", versionId: "ver_0002" }
          : { projectRootPath: "/tmp/other-project" }) });
    } else if (change === "epoch") h.projectSession.openLocator(SOURCE_PATH);
    const result = h.workflow.verifyLeaveBoundary(boundary, {
      needsSourceProtection: true, committedSourceSha256: sha256(after),
    });
    assert.equal(result.kind, change === "none" ? "ready" : "reject", JSON.stringify(result));
    if (change !== "none") assert.equal(result.code, "PROJECT_SWITCH_SOURCE_CHANGED");
  });
}


test("unregistered leave boundary still rejects a different source locator", (t) => {
  const h = createHarness({ registered: false });
  t.after(() => h.workflow.dispose());
  const boundary = h.workflow.captureLeaveBoundary();
  h.projectSession.openLocator("/tmp/different-unregistered.html");
  assert.equal(h.workflow.verifyLeaveBoundary(boundary).code, "PROJECT_SWITCH_SOURCE_CHANGED");
});

test("first registration may leave through fresh recovery evidence when source save fails", async (t) => {
  const before = "<!doctype html><html><body><p>one</p></body></html>";
  const after = before.replace("one", "protected");
  const h = createHarness({ html: before, registered: false,
    ensureRegistered: async () => succeededRegistration(),
    bridge: { async autosave() { throw new BridgeRequestError("SOURCE_WRITE_FAILED", "disk denied"); } },
    recoveryJournal: {
      async commit(input) { return { schemaVersion: "2.0.0", ...input,
        recoveryHtmlSha256: sha256(input.html), journalSha256: sha256(JSON.stringify(input)),
        updatedAt: "2026-09-12T00:00:00.000Z", byteLength: Buffer.byteLength(input.html) }; },
      async readVerified() { return null; },
      async remove() { return { removed: true }; },
    },
  });
  function succeededRegistration() {
    return { status: "succeeded", value: h.projectSession.register({
      epoch: h.projectSession.epoch, projectId: PROJECT_ID, documentId: DOCUMENT_ID, sourcePath: SOURCE_PATH,
    }) };
  }
  t.after(() => h.workflow.dispose());
  h.workflow.enqueueEdit({ html: after });
  const boundary = h.workflow.captureLeaveBoundary();
  assert.equal(boundary.context.projectId, "");
  assert.notEqual((await h.workflow.flush()).status, "succeeded");
  assert.equal(h.projectSession.context.projectId, PROJECT_ID);
  const input = { needsSourceProtection: true, committedSourceSha256: sha256(after) };
  assert.equal(h.workflow.verifyLeaveBoundary(boundary, input).kind, "reject");
  assert.equal((await h.workflow.protectForDetach({ context: h.projectSession.context })).status, "succeeded");
  assert.equal(h.workflow.verifyLeaveBoundary(boundary, input).kind, "ready");
  assert.equal(h.workflow.verifyLeaveBoundary(boundary, {
    ...input, committedSourceSha256: sha256("wrong frozen source"),
  }).code, "PROJECT_SWITCH_PROTECTION_MISMATCH");
  assert.equal(h.documentSession.persistState, "failed");
  assert.equal(h.documentSession.persistedSourceSha256, sha256(before));
});

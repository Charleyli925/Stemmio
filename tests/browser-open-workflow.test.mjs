import assert from "node:assert/strict";
import test from "node:test";

import { BrowserOpenWorkflow } from "../app/application/browser-open-workflow.js";

const HASH_A = `sha256:${"a".repeat(64)}`;
const HASH_B = `sha256:${"b".repeat(64)}`;

function deferred() {
  let resolve;
  const promise = new Promise((accept) => { resolve = accept; });
  return { promise, resolve };
}

function harness({ history = false } = {}) {
  const context = {
    epoch: 3,
    projectId: "project_A",
    documentId: "document_A",
    sourcePath: "/project/A.html",
    exactSourcePath: "/project/A.html",
    projectRootPath: "/project",
    targetKind: "working-copy",
    workingCopyId: "work_A",
    versionId: "ver_0001",
    sourceSha256: HASH_A,
    sessionEpoch: 2,
  };
  const projectSession = {
    context,
    matches(candidate) {
      const baseMatches = candidate.epoch === this.context?.epoch
        && candidate.projectId === this.context?.projectId
        && candidate.documentId === this.context?.documentId
        && candidate.sourcePath === this.context?.sourcePath;
      return baseMatches && (
        !Object.hasOwn(candidate, "sourceSha256")
        || candidate.sourceSha256 === this.context?.sourceSha256
      );
    },
  };
  const documentSession = {
    snapshot: {
      html: "<!doctype html><p>A</p>",
      workingHtmlSha256: HASH_A,
      persistedSourceSha256: HASH_A,
      editRevision: 4,
      lastPersistedRevision: 4,
      hasPendingWrite: false,
      isFlushing: false,
      persistState: "idle",
    },
  };
  const versionSession = {
    snapshot: history ? {
      viewMode: "history",
      viewingVersionId: "ver_0002",
      historyPreview: {
        projectId: context.projectId,
        documentId: context.documentId,
        sourcePath: context.sourcePath,
        versionId: "ver_0002",
        content: "<!doctype html><p>history</p>",
        sha256: HASH_B,
      },
    } : {
      viewMode: "current",
      viewingVersionId: null,
      historyPreview: null,
    },
  };
  const calls = { checkpoint: 0, enqueue: [], flush: [], open: [] };
  const documentWorkflow = {
    hasHistoryAction: false,
    enqueueEdit(input) {
      calls.enqueue.push(input);
      documentSession.snapshot = {
        ...documentSession.snapshot,
        html: input.html,
        workingHtmlSha256: HASH_B,
        editRevision: 5,
        hasPendingWrite: true,
        persistState: "queued",
      };
      return { status: "succeeded", value: { revision: 5 } };
    },
    async flush(input) {
      calls.flush.push(input);
      documentSession.snapshot = {
        ...documentSession.snapshot,
        persistedSourceSha256: documentSession.snapshot.workingHtmlSha256,
        lastPersistedRevision: documentSession.snapshot.editRevision,
        hasPendingWrite: false,
        isFlushing: false,
        persistState: "idle",
      };
      projectSession.context = {
        ...projectSession.context,
        sourceSha256: documentSession.snapshot.persistedSourceSha256,
      };
      return { status: "succeeded", value: { revision: documentSession.snapshot.editRevision } };
    },
  };
  const ports = {
    canvas: {
      checkpointSource() {
        calls.checkpoint += 1;
        return {
          ok: true,
          html: documentSession.snapshot.html,
          pendingMutation: null,
        };
      },
    },
    files: {
      async openInDefaultBrowser(input) {
        calls.open.push(input);
        return { accepted: true };
      },
    },
  };
  const workflow = new BrowserOpenWorkflow({
    projectSession,
    documentSession,
    versionSession,
    documentWorkflow,
    ports,
    clock: { now: () => 100 },
  });
  return {
    calls,
    context,
    documentSession,
    documentWorkflow,
    ports,
    projectSession,
    versionSession,
    workflow,
  };
}

test("a clean current document opens without writing or rebuilding Canvas", async () => {
  const value = harness();
  const outcome = await value.workflow.openSelectedDocument();
  assert.deepEqual(outcome, {
    status: "succeeded",
    value: {
      operationId: "browser-open_100_1",
      target: {
        targetKind: "working-copy",
        sourcePath: "/project/A.html",
        expectedSha256: HASH_A,
      },
      opened: { accepted: true },
    },
  });
  assert.equal(value.calls.checkpoint, 1);
  assert.deepEqual(value.calls.enqueue, []);
  assert.deepEqual(value.calls.flush, [{ throughRevision: 4 }]);
  assert.deepEqual(value.calls.open, [{
    targetKind: "working-copy",
    sourcePath: "/project/A.html",
    expectedSha256: HASH_A,
  }]);
});

test("pending native input is accepted, persisted through its exact revision, then opened", async () => {
  const value = harness();
  value.ports.canvas.checkpointSource = () => ({
    ok: true,
    html: "<!doctype html><p>native input</p>",
    pendingMutation: { kind: "text" },
  });
  const outcome = await value.workflow.openSelectedDocument();
  assert.equal(outcome.status, "succeeded");
  assert.equal(value.calls.enqueue.length, 1);
  assert.deepEqual(value.calls.flush, [{ throughRevision: 5 }]);
  assert.equal(value.calls.open[0].expectedSha256, HASH_B);
});

test("failed or unknown persistence never reaches Desktop and never repeats the mutation", async () => {
  for (const flushOutcome of [
    { status: "rejected", code: "WRITE_FAILED", reason: "write failed" },
    { status: "unknown", operationId: "write_1", reason: "write result unknown" },
  ]) {
    const value = harness();
    value.ports.canvas.checkpointSource = () => ({
      ok: true,
      html: "<!doctype html><p>pending</p>",
      pendingMutation: { kind: "text" },
    });
    value.documentWorkflow.flush = async (input) => {
      value.calls.flush.push(input);
      return flushOutcome;
    };
    const outcome = await value.workflow.openSelectedDocument();
    assert.deepEqual(outcome, flushOutcome);
    assert.equal(value.calls.enqueue.length, 1);
    assert.equal(value.calls.open.length, 0);
  }
});

test("an A operation that becomes stale never opens the new B document", async () => {
  const value = harness();
  const gate = deferred();
  value.documentWorkflow.flush = async (input) => {
    value.calls.flush.push(input);
    await gate.promise;
    return { status: "succeeded", value: { revision: 4 } };
  };
  const opening = value.workflow.openSelectedDocument();
  value.projectSession.context = {
    ...value.context,
    epoch: 4,
    projectId: "project_B",
    documentId: "document_B",
    sourcePath: "/project/B.html",
  };
  gate.resolve();
  const outcome = await opening;
  assert.deepEqual(outcome, {
    status: "stale",
    context: value.context,
  });
  assert.deepEqual(value.calls.open, []);
});

test("a switch after the system request starts does not relabel the external action as cancelled", async () => {
  const value = harness();
  const gate = deferred();
  value.ports.files.openInDefaultBrowser = async (input) => {
    value.calls.open.push(input);
    await gate.promise;
    return { accepted: true };
  };
  const opening = value.workflow.openSelectedDocument();
  await Promise.resolve();
  await Promise.resolve();
  value.projectSession.context = {
    ...value.context,
    epoch: 4,
    projectId: "project_B",
    documentId: "document_B",
    sourcePath: "/project/B.html",
  };
  gate.resolve();
  assert.deepEqual(await opening, {
    status: "succeeded",
    value: {
      operationId: "browser-open_100_1",
      target: {
        targetKind: "working-copy",
        sourcePath: "/project/A.html",
        expectedSha256: HASH_A,
      },
      opened: { accepted: true },
    },
  });
  assert.equal(value.calls.open.length, 1);
});

test("duplicate clicks for one target share one in-flight Desktop request", async () => {
  const value = harness();
  const gate = deferred();
  value.ports.files.openInDefaultBrowser = async (input) => {
    value.calls.open.push(input);
    await gate.promise;
    return { accepted: true };
  };
  const first = value.workflow.openSelectedDocument();
  const second = value.workflow.openSelectedDocument();
  assert.strictEqual(first, second);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(value.calls.open.length, 1);
  gate.resolve();
  assert.equal((await first).status, "succeeded");
});

test("history opens the exact selected version without current-draft input or persistence", async () => {
  const value = harness({ history: true });
  const outcome = await value.workflow.openSelectedDocument();
  assert.deepEqual(outcome, {
    status: "succeeded",
    value: {
      operationId: "browser-open_100_1",
      target: {
        targetKind: "version",
        sourcePath: "/project/A.html",
        versionId: "ver_0002",
        expectedSha256: HASH_B,
      },
      opened: { accepted: true },
    },
  });
  assert.equal(value.calls.checkpoint, 0);
  assert.deepEqual(value.calls.enqueue, []);
  assert.deepEqual(value.calls.flush, []);
  assert.deepEqual(value.calls.open, [{
    targetKind: "version",
    sourcePath: "/project/A.html",
    versionId: "ver_0002",
    expectedSha256: HASH_B,
  }]);
});

test("new edits during the save boundary block launch instead of waiting forever or overstating persistence", async () => {
  const value = harness();
  value.documentWorkflow.flush = async (input) => {
    value.calls.flush.push(input);
    value.documentSession.snapshot = {
      ...value.documentSession.snapshot,
      editRevision: 5,
      hasPendingWrite: true,
      persistState: "queued",
    };
    return { status: "succeeded", value: { revision: 4 } };
  };
  const outcome = await value.workflow.openSelectedDocument();
  assert.deepEqual(outcome, {
    status: "blocked",
    code: "BROWSER_OPEN_SOURCE_NOT_SETTLED",
    reason: "当前修改尚未安全写入源 HTML，因此没有打开浏览器。请稍后重试。",
  });
  assert.deepEqual(value.calls.open, []);
});

test("definite Desktop refusal preserves the session while a lost reply stays unknown", async () => {
  for (const [code, expectedOutcome] of [
    ["UNKNOWN_SOURCE", {
      status: "rejected",
      code: "UNKNOWN_SOURCE",
      reason: "UNKNOWN_SOURCE failure",
    }],
    ["PROJECT_SERVICE_UNAVAILABLE", {
      status: "unknown",
      operationId: "browser-open_100_1",
      reason: "PROJECT_SERVICE_UNAVAILABLE failure",
    }],
  ]) {
    const value = harness();
    const before = { ...value.documentSession.snapshot };
    value.ports.files.openInDefaultBrowser = async () => {
      throw { code, message: `${code} failure` };
    };
    const outcome = await value.workflow.openSelectedDocument();
    assert.deepEqual(outcome, expectedOutcome);
    assert.deepEqual(value.documentSession.snapshot, before);
  }
});

import assert from "node:assert/strict";
import test from "node:test";

import { BridgeRequestError } from "../app/application/bridge-client.js";
import { ProjectRulesSession } from "../app/application/project-rules-session.js";
import { ProjectRulesWorkflow } from "../app/application/project-rules-workflow.js";
import { ProjectSession } from "../app/application/project-session.js";
import { RunSession } from "../app/application/run-session.js";

const SOURCE_PATH = "/tmp/project-rules-workflow.html";
const CONTEXT = Object.freeze({
  epoch: 1,
  projectId: "project_rules_workflow",
  documentId: "document_rules_workflow",
  sourcePath: SOURCE_PATH,
});

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
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

function createHarness({
  initialContent = "# Original",
  read = null,
  write = null,
} = {}) {
  const projectSession = new ProjectSession();
  projectSession.openLocator(SOURCE_PATH);
  const context = projectSession.register(CONTEXT);
  const runSession = new RunSession({ sourcePath: SOURCE_PATH });
  const projectRulesSession = new ProjectRulesSession();
  const scheduler = createScheduler();
  let persisted = initialContent;
  const calls = {
    reads: [],
    writes: [],
  };
  const bridgeClient = {
    async projectFile(sourcePath, relativePath) {
      calls.reads.push({ sourcePath, relativePath });
      if (read) return read({ sourcePath, relativePath, persisted });
      return { content: persisted };
    },
    async updateProjectFile(payload) {
      calls.writes.push(payload);
      if (write) return write(payload, {
        get persisted() {
          return persisted;
        },
        setPersisted(value) {
          persisted = String(value);
        },
      });
      persisted = payload.content;
      return {};
    },
  };
  const workflow = new ProjectRulesWorkflow({
    bridgeClient,
    projectSession,
    runSession,
    projectRulesSession,
    errorMessage: (cause, fallback) => String(cause?.message || fallback),
    scheduler,
    clock: { now: () => Date.parse("2026-08-12T00:00:00.000Z") },
  });
  return {
    workflow,
    projectSession,
    runSession,
    projectRulesSession,
    scheduler,
    calls,
    context,
    get persisted() {
      return persisted;
    },
  };
}

async function settle() {
  await new Promise((resolve) => setImmediate(resolve));
}

test("project rules workflow owns the deterministic 700ms autosave", async () => {
  const harness = createHarness();
  assert.equal((await harness.workflow.open({ context: harness.context })).status, "succeeded");
  assert.equal(harness.workflow.updateContent({ content: "# Updated" }).status, "succeeded");
  assert.deepEqual(
    harness.scheduler.pending.map((task) => task.delay),
    [700],
  );

  const [timer] = harness.scheduler.pending;
  harness.scheduler.run(timer.id);
  await settle();

  assert.deepEqual(harness.calls.writes, [{
    sourcePath: SOURCE_PATH,
    projectId: CONTEXT.projectId,
    documentId: CONTEXT.documentId,
    content: "# Updated",
  }]);
  assert.equal(harness.persisted, "# Updated");
  assert.equal(harness.workflow.getSnapshot().savedContent, "# Updated");
  assert.equal(harness.workflow.inspect().state, "resolved");
});

test("project rules workflow reconciles a lost write response by reading authority once", async () => {
  const harness = createHarness({
    write(payload, authority) {
      authority.setPersisted(payload.content);
      throw new Error("response lost after durable write");
    },
  });
  await harness.workflow.open({ context: harness.context });
  harness.workflow.updateContent({ content: "# Reconciled" });

  const outcome = await harness.workflow.save();
  assert.deepEqual(outcome, {
    status: "succeeded",
    value: { saved: true, reconciled: true },
  });
  assert.equal(harness.calls.writes.length, 1);
  assert.equal(harness.calls.reads.length, 2);
  assert.equal(harness.workflow.getSnapshot().savedContent, "# Reconciled");
});

test("an unknown PROJECT.md write reports unknown after its single failed authority read", async () => {
  let reads = 0;
  const harness = createHarness({
    read({ persisted }) {
      reads += 1;
      if (reads === 1) return { content: persisted };
      throw new Error("authority is unavailable");
    },
    write() {
      throw new BridgeRequestError("write response lost", { outcome: "unknown" });
    },
  });
  await harness.workflow.open({ context: harness.context });
  harness.workflow.updateContent({ content: "# Uncertain" });

  const outcome = await harness.workflow.save();
  assert.equal(outcome.status, "unknown");
  assert.match(outcome.operationId, /^project-rules-save_/u);
  assert.equal(harness.calls.writes.length, 1);
  assert.equal(harness.calls.reads.length, 2);
  assert.equal(harness.workflow.getSnapshot().savedContent, "# Original");
});

test("late PROJECT.md reads are stale and cannot replace the next project", async () => {
  const firstRead = deferred();
  const nextContext = Object.freeze({
    epoch: 2,
    projectId: "project_rules_next",
    documentId: "document_rules_next",
    sourcePath: "/tmp/project-rules-next.html",
  });
  const harness = createHarness({
    read({ sourcePath }) {
      return sourcePath === SOURCE_PATH
        ? firstRead.promise
        : { content: "# Next project" };
    },
  });

  const first = harness.workflow.open({ context: harness.context });
  harness.projectSession.openLocator(nextContext.sourcePath);
  assert.deepEqual(harness.projectSession.register(nextContext), nextContext);
  harness.workflow.resetForProjectTransition();
  assert.equal((await harness.workflow.open({ context: nextContext })).status, "succeeded");

  firstRead.resolve({ content: "# Stale project" });
  assert.equal((await first).status, "stale");
  assert.equal(harness.workflow.getSnapshot().content, "# Next project");
});

test("restore retires the composition inside ProjectRulesSession", async () => {
  const harness = createHarness();
  await harness.workflow.open({ context: harness.context });
  harness.workflow.updateContent({ content: "draft" });
  const target = {};
  harness.workflow.beginComposition({ target, baselineValue: "draft" });
  harness.workflow.updateContent({ content: "marked text" });

  assert.equal(harness.workflow.restore().status, "succeeded");
  assert.equal(harness.workflow.getSnapshot().content, "# Original");
  assert.equal(
    harness.workflow.updateContent({ content: "late marked text" }).status,
    "succeeded",
  );
  assert.equal(harness.workflow.getSnapshot().content, "late marked text");
  assert.equal(harness.workflow.getSnapshot().compositionActive, false);
});

test("a locked run blocks PROJECT.md saving and a disposed timer cannot write", async () => {
  const harness = createHarness();
  await harness.workflow.open({ context: harness.context });
  harness.workflow.updateContent({ content: "# Pending" });
  const [timer] = harness.scheduler.pending;
  harness.runSession.trackRun({
    sourcePath: SOURCE_PATH,
    requestId: "request_rules",
    attemptId: "attempt_001",
    status: "processing",
  }, { activate: "always" });

  assert.equal(harness.workflow.inspect().state, "blocked");
  assert.equal(await harness.workflow.drain(), false);
  harness.workflow.dispose();
  timer.callback();
  await settle();
  assert.equal(harness.calls.writes.length, 0);
});

test("close drains an edit that arrives while the prior PROJECT.md save is in flight", async () => {
  const firstWrite = deferred();
  let first = true;
  const harness = createHarness({
    write(payload, authority) {
      if (first) {
        first = false;
        return firstWrite.promise.then(() => {
          authority.setPersisted(payload.content);
        });
      }
      authority.setPersisted(payload.content);
      return {};
    },
  });
  await harness.workflow.open({ context: harness.context });
  harness.workflow.updateContent({ content: "# First write" });
  const pendingSave = harness.workflow.save();
  await settle();
  harness.workflow.updateContent({ content: "# Latest write" });

  const closing = harness.workflow.close();
  firstWrite.resolve();
  assert.equal((await pendingSave).status, "succeeded");
  assert.equal((await closing).status, "succeeded");
  assert.deepEqual(
    harness.calls.writes.map((call) => call.content),
    ["# First write", "# Latest write"],
  );
  assert.equal(harness.persisted, "# Latest write");
  assert.equal(harness.workflow.getSnapshot().open, false);
});

test("a stale write cannot stall saving PROJECT.md in the next project", async () => {
  const firstWrite = deferred();
  const nextContext = Object.freeze({
    epoch: 2,
    projectId: "project_rules_next",
    documentId: "document_rules_next",
    sourcePath: "/tmp/project-rules-next.html",
  });
  let first = true;
  const harness = createHarness({
    write(payload, authority) {
      if (first) {
        first = false;
        return firstWrite.promise.then(() => {
          authority.setPersisted(payload.content);
        });
      }
      authority.setPersisted(payload.content);
      return {};
    },
  });
  await harness.workflow.open({ context: harness.context });
  harness.workflow.updateContent({ content: "# Old project" });
  const oldSave = harness.workflow.save();
  await settle();

  harness.projectSession.openLocator(nextContext.sourcePath);
  assert.deepEqual(harness.projectSession.register(nextContext), nextContext);
  harness.workflow.resetForProjectTransition();
  await harness.workflow.open({ context: nextContext });
  harness.workflow.updateContent({ content: "# New project" });
  assert.equal((await harness.workflow.save()).status, "succeeded");

  firstWrite.resolve();
  assert.equal((await oldSave).status, "stale");
  assert.deepEqual(
    harness.calls.writes.map((call) => call.content),
    ["# Old project", "# New project"],
  );
  assert.equal(harness.workflow.getSnapshot().savedContent, "# New project");
});

test("detached project rules keep their own identity and ignore another project's run lock", async () => {
  const harness = createHarness();
  harness.runSession.trackRun({
    projectId: harness.context.projectId,
    documentId: harness.context.documentId,
    sourcePath: SOURCE_PATH,
    requestId: "request_other_project",
    attemptId: "attempt_001",
    status: "processing",
  }, { activate: "always" });
  const detached = Object.freeze({
    surfaceContextId: "surface:rules:project_b:document_b",
    epoch: 7,
    projectId: "project_b",
    documentId: "document_b",
    sourcePath: "/tmp/project-b.html",
    projectRootPath: "/tmp/project-b",
    targetKind: "working-copy",
    workingCopyId: "work_project_b",
    versionId: "ver_0001",
    exactSourcePath: "/tmp/project-b.html",
    sourceSha256: `sha256:${"b".repeat(64)}`,
    sessionEpoch: 7,
  });

  assert.equal((await harness.workflow.open({ context: detached })).status, "succeeded");
  assert.equal(harness.workflow.updateContent({ content: "# Project B" }).status, "succeeded");
  assert.equal((await harness.workflow.save()).status, "succeeded");
  assert.equal(harness.calls.writes.at(-1).projectId, "project_b");
  assert.equal(harness.projectSession.projectId, harness.context.projectId);
});

test("a failed detached rules preparation preserves the visible session and rejects mismatched commands", async () => {
  const detached = Object.freeze({
    surfaceContextId: "surface:rules:project_b:document_b",
    epoch: 7,
    projectId: "project_b",
    documentId: "document_b",
    sourcePath: "/tmp/project-b.html",
    projectRootPath: "/tmp/project-b",
    targetKind: "working-copy",
    workingCopyId: "work_project_b",
    versionId: "ver_0001",
    exactSourcePath: "/tmp/project-b.html",
    sourceSha256: `sha256:${"b".repeat(64)}`,
    sessionEpoch: 7,
  });
  const harness = createHarness({
    read({ sourcePath, persisted }) {
      if (sourcePath === detached.sourcePath) throw new Error("Beta rules unavailable");
      return { content: persisted };
    },
  });
  await harness.workflow.open({ context: harness.context });
  harness.workflow.updateContent({ content: "# Saved Alpha" });

  const failed = await harness.workflow.prepareOpen({ context: detached });
  assert.equal(failed.status, "rejected");
  assert.equal(harness.projectRulesSession.context.projectId, CONTEXT.projectId);
  assert.equal(harness.workflow.getSnapshot().content, "# Saved Alpha");
  assert.equal(harness.workflow.getSnapshot().savedContent, "# Saved Alpha");

  const betaScope = { projectId: detached.projectId, documentId: detached.documentId };
  assert.equal(
    harness.workflow.updateContent({ content: "# Wrong target", scope: betaScope }).code,
    "PROJECT_RULES_VISIBLE_CONTEXT_MISMATCH",
  );
  assert.equal(
    (await harness.workflow.save({ scope: betaScope })).code,
    "PROJECT_RULES_VISIBLE_CONTEXT_MISMATCH",
  );
  assert.equal(
    (await harness.workflow.retry({ scope: betaScope })).code,
    "PROJECT_RULES_VISIBLE_CONTEXT_MISMATCH",
  );
  assert.equal(harness.calls.writes.at(-1).projectId, CONTEXT.projectId);
});

test("prepared rules publish only when the navigation commits them", async () => {
  const detached = Object.freeze({
    surfaceContextId: "surface:rules:project_b:document_b",
    epoch: 7,
    projectId: "project_b",
    documentId: "document_b",
    sourcePath: "/tmp/project-b.html",
    projectRootPath: "/tmp/project-b",
    targetKind: "working-copy",
    workingCopyId: "work_project_b",
    versionId: "ver_0001",
    exactSourcePath: "/tmp/project-b.html",
    sourceSha256: `sha256:${"b".repeat(64)}`,
    sessionEpoch: 7,
  });
  const harness = createHarness({
    read({ sourcePath, persisted }) {
      return { content: sourcePath === detached.sourcePath ? "# Beta" : persisted };
    },
  });
  await harness.workflow.open({ context: harness.context });

  const prepared = await harness.workflow.prepareOpen({ context: detached });
  assert.equal(prepared.status, "succeeded");
  assert.equal(harness.projectRulesSession.context.projectId, CONTEXT.projectId);
  assert.equal(harness.workflow.getSnapshot().content, "# Original");

  const committed = harness.workflow.commitPreparedOpen({
    preparationId: prepared.value.preparationId,
  });
  assert.equal(committed.status, "succeeded");
  assert.equal(harness.projectRulesSession.context.projectId, detached.projectId);
  assert.equal(harness.workflow.getSnapshot().content, "# Beta");
});

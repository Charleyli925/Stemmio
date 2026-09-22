import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";

import {
  installRuntimeFailureEvidence,
  withRuntimeFailureEvidence,
} from "./e2e/electron/helpers/runtime-failure-evidence.mjs";

function fakePage({ installError = null, readError = null, stopError = null, evidence = null } = {}) {
  let call = 0;
  return {
    get calls() {
      return call;
    },
    async evaluate() {
      call += 1;
      if (call === 1 && installError) throw installError;
      if (call === 2 && readError) throw readError;
      if (call === 2) return evidence;
      if (call === 3 && stopError) throw stopError;
      return undefined;
    },
  };
}

async function rejectionOf(promise) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  return null;
}

test("the primary assertion object survives read, attach, stop, and cleanup failures", async () => {
  const primary = new Error("primary sentinel");
  const page = fakePage({
    readError: new Error("read sentinel"),
    stopError: new Error("stop sentinel"),
  });
  const attachmentError = new Error("attach sentinel");
  const received = await rejectionOf(withRuntimeFailureEvidence(
    page,
    { attach: async () => { throw attachmentError; } },
    async () => { throw primary; },
  ));

  assert.strictEqual(received, primary);
  assert.equal(page.calls, 3);
});

test("a falsy primary rejection is still rethrown", async () => {
  const page = fakePage();
  let rejected = false;
  let received;
  try {
    await withRuntimeFailureEvidence(
      page,
      { attach: async () => {} },
      async () => { throw undefined; },
    );
  } catch (cause) {
    rejected = true;
    received = cause;
  }
  assert.equal(rejected, true);
  assert.equal(received, undefined);
});

test("optional installation and diagnostics cannot change a successful result", async () => {
  const result = { status: "sentinel-result" };
  const page = fakePage({
    installError: new Error("install sentinel"),
    readError: new Error("read sentinel"),
    stopError: new Error("stop sentinel"),
  });
  const received = await withRuntimeFailureEvidence(
    page,
    { attach: async () => { throw new Error("attach sentinel"); } },
    async () => result,
  );

  assert.strictEqual(received, result);
  assert.equal(page.calls, 3);
});

test("a successful bounded evidence attachment does not replace the result", async () => {
  const result = { status: "ok" };
  const page = fakePage({ evidence: { entries: [], authorEvents: [] } });
  const attachments = [];
  const received = await withRuntimeFailureEvidence(
    page,
    {
      attach: async (name, value) => attachments.push({ name, value }),
    },
    async () => result,
    { caseId: "sentinel-case" },
  );

  assert.strictEqual(received, result);
  assert.equal(attachments.length, 1);
  assert.equal(attachments[0].name, "runtime-failure-evidence");
  assert.equal(attachments[0].value.contentType, "application/json");
});

test("renderer evidence is bounded and excludes raw event messages", () => {
  let clock = 1;
  const context = {
    performance: {
      timeOrigin: 100,
      now: () => clock++,
    },
    document: {
      body: {},
      querySelector: () => null,
      querySelectorAll: () => [],
    },
    window: {},
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
  };
  vm.runInNewContext(
    `(${installRuntimeFailureEvidence.toString()})('sentinel-case')`,
    context,
  );
  context.window.__STEMMIO_RUNTIME_RETRY_EVENTS__ = Array.from({ length: 300 }, (_, index) => ({
    kind: "execute",
    message: "PRIVATE_RAW_MESSAGE",
    executionId: `document-${index}`,
    time: index,
    count: index,
    generation: "generation-1",
    candidate: "candidate-1",
  }));
  context.window.__STEMMIO_TEXT_HISTORY_RUNTIME_EVENTS__ = Array.from({ length: 300 }, (_, index) => ({
    sequence: index,
    documentId: "history-document",
    at: index,
    frameGeneration: "generation-1",
    frameRole: "active",
  }));
  const evidence = context.window.__STEMMIO_RUNTIME_FAILURE_EVIDENCE__.read();

  assert.equal(evidence.authorEvents.length, 128);
  assert.equal(evidence.historyEvents.length, 128);
  assert.equal(evidence.authorEvents[0].executionId, "document-172");
  assert.equal("message" in evidence.authorEvents[0], false);
  assert.equal(JSON.stringify(evidence).includes("PRIVATE_RAW_MESSAGE"), false);
  assert.equal(evidence.armedAt, 101);
  context.window.__STEMMIO_RUNTIME_FAILURE_EVIDENCE__.stop();
});

test("Canvas ACK facts survive observation and every cleanup still restores repair", () => {
  const original = () => Promise.resolve({ status: "succeeded" });
  const controller = {
    repairDocumentCanvas: original,
    subscribe(listener) {
      listener({ document: { canvasAuthority: { status: "verified", generation: 3,
        renderedSha256: "sha256:abc", error: "PRIVATE_ERROR" } } });
      return () => { throw new Error("unsubscribe sentinel"); };
    },
  };
  const main = { __reactFiber$test: { memoizedState: { memoizedState: controller } } };
  const context = { performance: { timeOrigin: 1, now: () => 1 }, window: {},
    document: { body: {}, querySelector: selector => selector === "main.workbench" ? main : null,
      querySelectorAll: () => [] },
    MutationObserver: class { observe() {} disconnect() { throw new Error("disconnect sentinel"); } },
  };
  vm.runInNewContext(`(${installRuntimeFailureEvidence.toString()})()`, context);
  const evidence = context.window.__STEMMIO_RUNTIME_FAILURE_EVIDENCE__.read();
  const authority = evidence.entries.find(entry => entry.kind === "authority").data.document.canvasAuthority;
  assert.equal(authority.status, "verified");
  assert.equal(authority.generation, 3);
  assert.equal(JSON.stringify(evidence).includes("PRIVATE_ERROR"), false);
  assert.notEqual(controller.repairDocumentCanvas, original);
  context.window.__STEMMIO_RUNTIME_FAILURE_EVIDENCE__.stop();
  assert.equal(controller.repairDocumentCanvas, original);
});

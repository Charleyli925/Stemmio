import assert from "node:assert/strict";
import test from "node:test";

import {
  NativeDeferredCommandQueue,
  NativeEditRecoveryController,
  nativeEditLeasesMatch,
} from "../app/components/html-canvas-native-commands.js";

function lease(overrides = {}) {
  return {
    sessionId: "session-a",
    domGeneration: 1,
    sourceRevision: "rev-1",
    hostId: "host-a",
    ...overrides,
  };
}

function createSession() {
  let sequence = 0;
  let pending = null;
  return {
    queuePendingCommand(request) {
      sequence += 1;
      const replacedSequence = pending?.sequence ?? null;
      pending = {
        sequence,
        kind: request.kind,
        authority: request.authority ?? "user-explicit",
        payload: request.payload,
        compositionId: `island_${sequence}`,
      };
      return { queued: true, sequence, replacedSequence };
    },
    takePendingCommand() {
      const command = pending;
      pending = null;
      return command;
    },
  };
}

function receipt(overrides = {}) {
  return {
    sessionIncarnation: 1,
    sequence: 2,
    origin: "local-edit",
    operationId: "edit-2",
    editRevision: 2,
    canvasGeneration: 4,
    sourceSha256: `sha256:${"a".repeat(64)}`,
    context: null,
    epoch: null,
    projectId: null,
    documentId: null,
    sourcePath: null,
    sessionEpoch: null,
    ...overrides,
  };
}

function recoveryIntent(overrides = {}) {
  const acceptedReceipt = overrides.receipt ?? receipt();
  return {
    receipt: acceptedReceipt,
    sourceSha256: acceptedReceipt.sourceSha256,
    canvasGeneration: acceptedReceipt.canvasGeneration,
    retiredFrameGeneration: 8,
    retiredSessionId: "native-1",
    target: { id: "element:heading", label: "Heading" },
    selection: { anchor: 3, focus: 3, affinity: "right" },
    restoreFocus: true,
    toolbarVisible: true,
    ...overrides,
  };
}

function recoveryCurrent(intent, overrides = {}) {
  return {
    receipt: intent.receipt,
    sourceSha256: intent.sourceSha256,
    canvasGeneration: intent.canvasGeneration,
    frameGeneration: intent.retiredFrameGeneration + 1,
    targetId: intent.target.id,
    focusAllowed: true,
    ...overrides,
  };
}

test("nativeEditLeasesMatch requires every stamp field", () => {
  const current = lease();
  assert.equal(nativeEditLeasesMatch(current, lease()), true);
  assert.equal(nativeEditLeasesMatch(current, lease({ hostId: "host-b" })), false);
  assert.equal(nativeEditLeasesMatch(null, current), false);
});

test("a pending user-explicit command blocks later system work", () => {
  const queue = new NativeDeferredCommandQueue();
  const session = createSession();
  const discarded = [];
  const active = { session, lease: lease() };
  assert.equal(queue.deferNativeCommand("user", () => {}, null, {
    authority: "user-explicit",
    onDiscard: (reason) => discarded.push(`user:${reason}`),
  }, active), true);
  assert.equal(queue.deferNativeCommand("system", () => {}, null, {
    authority: "system",
    onDiscard: (reason) => discarded.push(`system:${reason}`),
  }, active), true);
  assert.deepEqual(discarded, ["system:blocked-by-user-command"]);
});

test("a later user-explicit command supersedes the incumbent", () => {
  const queue = new NativeDeferredCommandQueue();
  const session = createSession();
  const discarded = [];
  const active = { session, lease: lease() };
  assert.equal(queue.deferNativeCommand("first", () => {}, null, {
    authority: "user-explicit",
    onDiscard: (reason) => discarded.push(`first:${reason}`),
  }, active), true);
  assert.equal(queue.deferNativeCommand("second", () => {}, null, {
    authority: "user-explicit",
    onDiscard: (reason) => discarded.push(`second:${reason}`),
  }, active), true);
  assert.deepEqual(discarded, ["first:superseded"]);
});

test("drain discards a command whose lease no longer matches", () => {
  const queue = new NativeDeferredCommandQueue();
  const session = createSession();
  const discarded = [];
  const active = { session, lease: lease() };
  assert.equal(queue.deferNativeCommand("user", () => {}, null, {
    authority: "user-explicit",
    onDiscard: (reason) => discarded.push(reason),
  }, active), true);
  queue.drainPendingNativeCommand(session, {
    getActive: () => active,
    getCurrentLease: () => lease({ sourceRevision: "rev-2" }),
    schedule: (run) => run(),
  });
  assert.deepEqual(discarded, ["stale-session"]);
});

test("native edit recovery is consumed exactly once", () => {
  const recovery = new NativeEditRecoveryController();
  const intent = recoveryIntent();
  recovery.offer(intent);

  assert.deepEqual(recovery.takeIfCurrent(recoveryCurrent(intent)), intent);
  assert.equal(recovery.takeIfCurrent(recoveryCurrent(intent)), null);
});

test("a newer native edit recovery intent supersedes the older one", () => {
  const recovery = new NativeEditRecoveryController();
  const first = recoveryIntent();
  const second = recoveryIntent({
    receipt: receipt({ sequence: 3, operationId: "edit-3", editRevision: 3 }),
    target: { id: "element:paragraph", label: "Paragraph" },
  });
  recovery.offer(first);
  recovery.offer(second);

  assert.deepEqual(recovery.takeIfCurrent(recoveryCurrent(second)), second);
  assert.equal(recovery.takeIfCurrent(recoveryCurrent(first)), null);
});

test("native edit recovery mismatch retires the intent", () => {
  for (const mismatch of [
    { receipt: receipt({ sequence: 9, operationId: "edit-9" }) },
    { sourceSha256: `sha256:${"b".repeat(64)}` },
    { canvasGeneration: 5 },
    { frameGeneration: 8 },
    { targetId: "element:other" },
    { focusAllowed: false },
  ]) {
    const recovery = new NativeEditRecoveryController();
    const intent = recoveryIntent();
    recovery.offer(intent);
    assert.equal(recovery.takeIfCurrent(recoveryCurrent(intent, mismatch)), null);
    assert.equal(recovery.takeIfCurrent(recoveryCurrent(intent)), null);
  }
});

test("explicit cancellation retires native edit recovery", () => {
  const recovery = new NativeEditRecoveryController();
  const intent = recoveryIntent();
  recovery.offer(intent);
  assert.equal(recovery.cancel(), true);
  assert.equal(recovery.cancel(), false);
  assert.equal(recovery.takeIfCurrent(recoveryCurrent(intent)), null);
});

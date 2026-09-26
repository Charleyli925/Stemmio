import assert from "node:assert/strict";
import test from "node:test";

import { loadWorkbenchModel } from "./helpers/workbench-model-loader.mjs";

const { decideDisplayHandoff } = await loadWorkbenchModel("display-handoff-decision");

const editA = { surface: "edit", identity: "A:edit:1" };
const editB = { surface: "edit", identity: "B:edit:1" };
const previewA = { surface: "preview", identity: "A:preview:1" };

function decision(overrides = {}) {
  return decideDisplayHandoff({
    target: editB,
    targetReady: false,
    targetFailed: false,
    retained: editA,
    retainOutgoing: true,
    ...overrides,
  });
}

test("A -> B -> A keeps the last verified A surface inert until the new A proves ready", () => {
  const openingB = decision({ target: editB });
  assert.equal(openingB.phase, "opening");
  assert.deepEqual(openingB.actual, editA);
  assert.equal(openingB.keepOutgoing, true);
  assert.equal(openingB.outgoingInteractive, false);
  assert.equal(openingB.canHandoff, false);
  assert.deepEqual(openingB.missingEvidence, ["target-readiness"]);

  const openingAAgain = decision({ target: editA, retained: editA });
  assert.equal(openingAAgain.phase, "opening");
  assert.deepEqual(openingAAgain.actual, editA);
  assert.equal(openingAAgain.keepOutgoing, true);
  assert.equal(openingAAgain.canHandoff, false);

  const readyAAgain = decision({ target: editA, retained: editA, targetReady: true });
  assert.equal(readyAAgain.phase, "settled");
  assert.deepEqual(readyAAgain.actual, editA);
  assert.equal(readyAAgain.canHandoff, true);
  assert.equal(readyAAgain.releaseOutgoing, false);
});

test("Edit -> Preview -> Edit allows Preview to remain in front until Edit settles", () => {
  const previewReady = decision({
    target: previewA,
    targetReady: true,
    retained: editA,
    retainOutgoing: false,
  });
  assert.equal(previewReady.phase, "settled");
  assert.deepEqual(previewReady.actual, previewA);
  assert.equal(previewReady.releaseOutgoing, true);

  const editOpening = decision({
    target: editA,
    targetReady: false,
    retained: previewA,
    retainOutgoing: true,
  });
  assert.equal(editOpening.phase, "opening");
  assert.deepEqual(editOpening.actual, previewA);
  assert.equal(editOpening.outgoingInteractive, false);

  const editReady = decision({
    target: editA,
    targetReady: true,
    retained: previewA,
    retainOutgoing: true,
  });
  assert.equal(editReady.phase, "settled");
  assert.deepEqual(editReady.actual, editA);
  assert.equal(editReady.releaseOutgoing, true);
});

test("a checked target can hand off while an unrelated retained surface retires", () => {
  const handoffA = decision({
    target: editA,
    targetReady: true,
    retained: editB,
    retainOutgoing: true,
  });
  assert.equal(handoffA.canHandoff, true);
  assert.deepEqual(handoffA.actual, editA);
  assert.equal(handoffA.releaseOutgoing, true);
});

test("a superseded target cannot hand off even if its earlier proof was ready", () => {
  const superseded = decision({
    target: editB,
    targetReady: true,
    retained: editA,
    lifecycle: "superseded",
  });
  assert.equal(superseded.canHandoff, false);
  assert.equal(superseded.actual, null);
  assert.equal(superseded.releaseOutgoing, true);
  assert.equal(superseded.reason, "superseded");
});

test("failure releases the old attempt and retry starts without resurrecting it", () => {
  const failed = decision({
    target: editB,
    targetFailed: true,
    retained: editA,
    missingEvidence: ["canvas-authority", "physical-frame"],
  });
  assert.equal(failed.phase, "failed");
  assert.equal(failed.actual, null);
  assert.equal(failed.keepOutgoing, false);
  assert.equal(failed.releaseOutgoing, true);
  assert.deepEqual(failed.missingEvidence, ["canvas-authority", "physical-frame", "target-failed"]);

  const retry = decision({
    target: editB,
    retained: null,
    targetFailed: false,
    targetReady: false,
    retainOutgoing: true,
  });
  assert.equal(retry.phase, "opening");
  assert.equal(retry.actual, null);
  assert.equal(retry.keepOutgoing, false);
});

test("closing clears any retained display and never grants editability", () => {
  const closed = decision({
    target: editB,
    targetReady: true,
    retained: editA,
    lifecycle: "closing",
  });
  assert.equal(closed.phase, "closed");
  assert.equal(closed.actual, null);
  assert.equal(closed.canHandoff, false);
  assert.equal(closed.releaseOutgoing, true);
  assert.equal(closed.outgoingInteractive, false);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  DEFAULT_ACTIVE_REVIEW_FOCUS_GROUP_ID,
  nextActiveReviewFocusGroupId,
} from "../app/lib/review-focus-state.js";

async function loadReviewState() {
  const typescript = await import("typescript");
  const source = await readFile(
    new URL("../app/workbench/review-state.ts", import.meta.url),
    "utf8",
  );
  const compiled = typescript.transpileModule(source, {
    compilerOptions: {
      module: typescript.ModuleKind.ESNext,
      target: typescript.ScriptTarget.ES2022,
    },
    fileName: "review-state.ts",
  });
  const output = compiled.outputText.replace(
    '"../lib/review-focus-state.js"',
    JSON.stringify(new URL("../app/lib/review-focus-state.js", import.meta.url).href),
  );
  return import(`data:text/javascript;base64,${Buffer.from(output, "utf8").toString("base64")}`);
}

const {
  DEFAULT_REVIEW_STATE,
  reduceReviewState,
  restoreReviewPresentation,
} = await loadReviewState();

test("Review enters in overview without an active focus group", () => {
  assert.equal(DEFAULT_ACTIVE_REVIEW_FOCUS_GROUP_ID, null);
  assert.equal(DEFAULT_REVIEW_STATE.zoomMode, "fit");
});

test("navigation identity and visual focus identity remain independent", () => {
  const navigationTarget = "change-2";
  const focused = nextActiveReviewFocusGroupId(
    null,
    "focus-change-2-display-owner-2",
  );
  assert.equal(navigationTarget, "change-2");
  assert.equal(focused, "focus-change-2-display-owner-2");
  assert.equal(nextActiveReviewFocusGroupId(focused, null), null);
  assert.equal(nextActiveReviewFocusGroupId(null, ""), null);
});

test("focus group and side-local regions activate and clear atomically", () => {
  const focused = reduceReviewState(DEFAULT_REVIEW_STATE, {
    type: "set-active-focus",
    value: {
      groupId: "focus-change-2-display-owner-2",
      regionIds: {
        before: "region-before-2",
        after: "region-after-2",
      },
    },
  });
  assert.equal(focused.activeFocusGroupId, "focus-change-2-display-owner-2");
  assert.deepEqual(focused.activeFocusRegionIds, {
    before: "region-before-2",
    after: "region-after-2",
  });

  const overview = reduceReviewState(focused, {
    type: "set-active-focus",
    value: null,
  });
  assert.equal(overview.activeFocusGroupId, null);
  assert.deepEqual(overview.activeFocusRegionIds, { before: null, after: null });
  assert.equal(overview.navigationTarget, focused.navigationTarget);
});

function recoveryDocuments(suffix) {
  return {
    changes: [{ id: `change-${suffix}` }],
    focusGroups: [{
      id: `focus-${suffix}`,
      kind: "structure",
      regions: {
        before: [{ id: `region-before-${suffix}` }],
        after: [{ id: `region-after-${suffix}` }],
      },
    }],
  };
}

function presentation(suffix, overrides = {}) {
  return {
    reviewIdentity: `review-${suffix}`,
    state: {
      pageView: suffix === "a" ? "split" : "after",
      navigationTarget: `change-${suffix}`,
      activeFocusGroupId: `focus-${suffix}`,
      activeFocusRegionIds: {
        before: `region-before-${suffix}`,
        after: `region-after-${suffix}`,
      },
      pagePresentation: { before: [], after: [] },
      scrollMode: suffix === "a" ? "linked" : "independent",
      zoomMode: suffix === "a" ? "actual" : "fit",
      ...overrides,
    },
    positions: {
      before: { top: suffix === "a" ? 120 : 920, left: 7, viewportLeft: 13 },
      after: { top: suffix === "a" ? 220 : 1020, left: 9, viewportLeft: 17 },
    },
  };
}

test("per-tab recovery restores two independent Review identities without cross-state", () => {
  const restoredA = restoreReviewPresentation({
    documents: recoveryDocuments("a"),
    reviewIdentity: "review-a",
    contextVisibility: 25,
    presentation: presentation("a"),
  });
  const restoredB = restoreReviewPresentation({
    documents: recoveryDocuments("b"),
    reviewIdentity: "review-b",
    contextVisibility: 25,
    presentation: presentation("b"),
  });
  assert.equal(restoredA.restored, true);
  assert.equal(restoredA.state.activeFocusGroupId, "focus-a");
  assert.deepEqual(restoredA.state.activeFocusRegionIds, {
    before: "region-before-a",
    after: "region-after-a",
  });
  assert.equal(restoredA.positions.before.top, 120);
  assert.equal(restoredA.state.zoomMode, "actual");
  assert.equal(restoredB.state.activeFocusGroupId, "focus-b");
  assert.equal(restoredB.positions.before.top, 920);
  assert.equal(restoredB.state.zoomMode, "fit");
  assert.equal(restoredB.state.scrollMode, "independent");
});

test("resolved or replaced candidates cannot restore a stale Review object", () => {
  const identityMismatch = restoreReviewPresentation({
    documents: recoveryDocuments("b"),
    reviewIdentity: "review-b",
    contextVisibility: 25,
    presentation: presentation("a"),
  });
  assert.equal(identityMismatch.restored, false);
  assert.equal(identityMismatch.state.navigationTarget, "all");
  assert.equal(identityMismatch.state.activeFocusGroupId, null);
  assert.equal(identityMismatch.positions.before.top, 0);

  const stalePlan = restoreReviewPresentation({
    documents: recoveryDocuments("b"),
    reviewIdentity: "review-b",
    contextVisibility: 25,
    presentation: presentation("b", {
      navigationTarget: "change-gone",
      activeFocusGroupId: "focus-gone",
      activeFocusRegionIds: {
        before: "region-before-gone",
        after: "region-after-gone",
      },
    }),
  });
  assert.equal(stalePlan.restored, true);
  assert.equal(stalePlan.state.navigationTarget, "all");
  assert.equal(stalePlan.state.activeFocusGroupId, null);
  assert.deepEqual(stalePlan.state.activeFocusRegionIds, { before: null, after: null });
});

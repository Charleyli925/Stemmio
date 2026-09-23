import assert from "node:assert/strict";
import test from "node:test";

import {
  appendReviewProjectionFact,
  appendTrustedReviewProjectionFact,
  normalizeReviewExactAtomOccurrences,
  normalizeReviewFocusGroupPlans,
  normalizeReviewProjectionFact,
  parseReviewProjectionFacts,
  ReviewProjectionFactOverflowError,
  REVIEW_PROJECTION_FACTS_PER_ELEMENT_LIMIT,
  REVIEW_PROJECTION_FACTS_SERIALIZED_LENGTH_LIMIT,
  reviewProjectionFactKey,
  reviewProjectionFactsCanMerge,
  serializeReviewProjectionFacts,
} from "../app/lib/review-projection-facts.js";

const addedElement = {
  id: "element-added-1",
  type: "structure",
  semanticOwnerId: "semantic-owner-1",
  geometryOwnerId: "geometry-owner-1",
  scope: "element",
  operation: "insert",
  tone: "added",
  structureChange: "added",
  summary: "新增元素",
};

const removedText = {
  id: "text-removed-1",
  type: "text",
  semanticOwnerId: "semantic-owner-2",
  geometryOwnerId: "geometry-owner-2",
  scope: "text-phrase",
  operation: "delete",
  tone: "removed",
  textGroup: "text-group-1",
  summary: "删除内容",
  displayGroupId: "display-paragraph-1",
  displayOwnerId: "display-owner-paragraph-1",
  displayScope: "paragraph",
  geometryMode: "text-content",
};

test("projection keeps every text and source-structure fact", () => {
  const facts = appendReviewProjectionFact(
    appendReviewProjectionFact([], addedElement),
    removedText,
  );

  assert.deepEqual(facts, [addedElement, removedText]);
  assert.deepEqual(parseReviewProjectionFacts(serializeReviewProjectionFacts(facts)), facts);
});

test("movement, reorder, attributes, and element styles remain structure facts", () => {
  for (const structureChange of [
    "moved",
    "reordered",
    "attribute",
    "style",
  ]) {
    const normalized = normalizeReviewProjectionFact({
      ...addedElement,
      structureChange,
      summary: "元素调整",
    });
    assert.equal(normalized?.type, "structure");
    assert.equal(normalized?.structureChange, structureChange);
  }
  for (const sourceOnly of ["css-source", "script-source"]) {
    const normalized = normalizeReviewProjectionFact({
      ...addedElement,
      structureChange: sourceOnly,
      summary: "页面源码调整",
    });
    assert.ok(normalized);
    assert.equal(normalized.structureChange, undefined);
  }
});

test("retired visual fact types and layout operations still fail closed", () => {
  for (const fact of [
    { ...addedElement, type: "style", summary: "视觉调整" },
    { ...addedElement, structureChange: "layout", summary: "位置调整" },
    { ...removedText, operation: "layout", summary: "换行调整" },
  ]) {
    const normalized = normalizeReviewProjectionFact(fact);
    if (fact.type === "style") assert.equal(normalized, null);
    else {
      assert.ok(normalized);
      assert.equal(normalized.structureChange === "layout", false);
      assert.equal(normalized.operation === "layout", false);
    }
  }
});

test("only the same fact and owners may merge", () => {
  const geometrySibling = {
    ...addedElement,
    geometryOwnerId: "geometry-owner-3",
  };
  assert.equal(reviewProjectionFactsCanMerge(addedElement, { ...addedElement }), true);
  assert.equal(reviewProjectionFactsCanMerge(addedElement, removedText), false);
  assert.equal(reviewProjectionFactsCanMerge(addedElement, geometrySibling), false);
  assert.notEqual(reviewProjectionFactKey(addedElement), reviewProjectionFactKey(removedText));
  assert.notEqual(reviewProjectionFactKey(addedElement), reviewProjectionFactKey(geometrySibling));
  assert.equal(
    reviewProjectionFactKey(removedText),
    reviewProjectionFactKey({
      ...removedText,
      displayGroupId: "another-display-group",
      displayOwnerId: "another-display-owner",
      displayScope: "container",
    }),
    "presentation grouping must not replace exact atom identity",
  );
});

test("display grouping is bounded, optional, and uses semantic public scopes", () => {
  for (const displayScope of ["paragraph", "list-item", "cell", "component", "container"]) {
    assert.equal(normalizeReviewProjectionFact({ ...removedText, displayScope })?.displayScope, displayScope);
  }
  const legacy = normalizeReviewProjectionFact({
    id: "legacy-text",
    type: "text",
    semanticOwnerId: "legacy-owner",
  });
  assert.ok(legacy);
  assert.equal(legacy.displayGroupId, undefined);
  assert.equal(legacy.displayOwnerId, undefined);
  assert.equal(legacy.displayScope, undefined);
  assert.equal(normalizeReviewProjectionFact({
    ...removedText,
    displayScope: "text-line",
  })?.displayScope, undefined);
  for (const geometryMode of [
    "text-content",
    "element-box",
    "container-box",
    "numbered-line-range",
  ]) {
    assert.equal(normalizeReviewProjectionFact({ ...removedText, geometryMode })?.geometryMode, geometryMode);
  }
});

test("focus plans preserve scoped exact atom keys and reject malformed payloads as a unit", () => {
  const atomKey = `change-1\u001e${reviewProjectionFactKey(removedText)}`;
  const plan = {
    id: "focus-change-1-display-1",
    kind: "text",
    changeId: "change-1",
    changeIds: ["change-1"],
    displayGroupId: "display-1",
    displayScope: "paragraph",
    atomKeys: [atomKey, atomKey],
    presentation: { before: [], after: [] },
    regions: {
      before: [{
        id: "region-before-1",
        side: "before",
        correlationKey: "locality-1",
        contentCue: "第一项",
        primaryChangeId: "change-1",
        changeIds: ["change-1"],
        geometryMode: "text-content",
        displayOwnerIds: ["owner-1", "owner-1"],
        visualEvidenceStableIds: ["stable-1", "stable-1"],
        atomKeys: [atomKey, atomKey],
        presentation: [],
      }],
      after: [],
    },
    presence: { before: true, after: false },
  };
  const normalized = normalizeReviewFocusGroupPlans([plan]);
  assert.equal(normalized.length, 1);
  assert.equal(normalized[0].focusOutlinePolicy, "never");
  assert.deepEqual(normalized[0].atomKeys, [atomKey]);
  assert.equal(normalized[0].regions.before[0].navigationClusterId, "region-before-1");
  assert.equal(normalized[0].regions.before[0].contentCue, "第一项");
  assert.deepEqual(normalized[0].regions.before[0].displayOwnerIds, ["owner-1"]);
  assert.deepEqual(normalized[0].regions.before[0].visualEvidenceStableIds, ["stable-1"]);
  assert.deepEqual(normalized[0].regions.before[0].atomKeys, [atomKey]);

  assert.deepEqual(normalizeReviewFocusGroupPlans([plan, plan]), [], "duplicate groups reject payload");
  assert.deepEqual(normalizeReviewFocusGroupPlans([{
    ...plan,
    presence: { before: false, after: false },
  }]), [], "presence must match declared regions");
  assert.deepEqual(normalizeReviewFocusGroupPlans([{
    ...plan,
    focusOutlinePolicy: "always",
  }]), [], "an explicit unknown paint policy rejects the payload");
  assert.equal(normalizeReviewFocusGroupPlans([{
    ...plan,
    regions: {
      ...plan.regions,
      before: [{
        ...plan.regions.before[0],
        navigationClusterId: "reading-locality-1",
      }],
    },
  }])[0].regions.before[0].navigationClusterId, "reading-locality-1");
  assert.deepEqual(normalizeReviewFocusGroupPlans([{
    ...plan,
    regions: {
      ...plan.regions,
      before: [{
        ...plan.regions.before[0],
        atomKeys: [`change-2\u001e${reviewProjectionFactKey(removedText)}`],
      }],
    },
  }]), [], "region atoms must be a subset of group atoms and changes");
});

test("focus plan capacity, duplicate-region, and presentation ceilings fail closed", () => {
  const factKey = "text\u001fx\u001fy\u001f";
  const planFor = (index) => {
    const changeId = `c${index}`;
    const atomKey = `${changeId}\u001e${factKey}`;
    return {
      id: `g${index}`,
      kind: "text",
      changeId,
      changeIds: [changeId],
      displayGroupId: `d${index}`,
      displayScope: "paragraph",
      atomKeys: [atomKey],
      presentation: { before: [], after: [] },
      regions: { before: [], after: [] },
      presence: { before: false, after: false },
    };
  };
  assert.equal(normalizeReviewFocusGroupPlans(
    Array.from({ length: 256 }, (_, index) => planFor(index)),
  ).length, 256, "the documented group ceiling remains accepted");
  assert.deepEqual(normalizeReviewFocusGroupPlans(
    Array.from({ length: 257 }, (_, index) => planFor(index)),
  ), [], "one group beyond the ceiling rejects the payload");

  const plan = planFor(1);
  const regionFor = (index) => ({
    id: `r${index}`,
    side: "before",
    correlationKey: `l${index}`,
    primaryChangeId: plan.changeId,
    changeIds: [plan.changeId],
    geometryMode: "text-content",
    displayOwnerIds: ["o1"],
    atomKeys: plan.atomKeys,
    presentation: [],
  });
  const regionsAtCeiling = Array.from({ length: 512 }, (_, index) => regionFor(index));
  const withRegions = (before) => ({
    ...plan,
    regions: { before, after: [] },
    presence: { before: Boolean(before.length), after: false },
  });
  assert.equal(normalizeReviewFocusGroupPlans([withRegions(regionsAtCeiling)])[0]
    ?.regions.before.length, 512, "the documented region ceiling remains accepted");
  assert.deepEqual(normalizeReviewFocusGroupPlans([
    withRegions([...regionsAtCeiling, regionFor(512)]),
  ]), [], "one region beyond the ceiling rejects the payload");
  assert.deepEqual(normalizeReviewFocusGroupPlans([withRegions([
    regionFor(1),
    { ...regionFor(1), correlationKey: "other" },
  ])]), [], "duplicate region ids reject the payload");
  assert.deepEqual(normalizeReviewFocusGroupPlans([{
    ...plan,
    presentation: {
      before: Array.from({ length: 65 }, () => ({ kind: "panel", key: "panel" })),
      after: [],
    },
  }]), [], "presentation steps are bounded");
  assert.deepEqual(normalizeReviewFocusGroupPlans([{
    ...plan,
    padding: "x".repeat(131_072),
  }]), [], "the serialized plan payload is bounded");
  assert.deepEqual(normalizeReviewFocusGroupPlans([{
    ...plan,
    atomKeys: Array.from({ length: 513 }, () => plan.atomKeys[0]),
  }]), [], "group atom references are bounded before deduplication");
  assert.deepEqual(normalizeReviewFocusGroupPlans([withRegions([{
    ...regionFor(1),
    displayOwnerIds: Array.from({ length: 257 }, (_, index) => `o${index}`),
  }])]), [], "region owner references are bounded before deduplication");
  const evidenceHeavyRegions = Array.from({ length: 17 }, (_, regionIndex) => ({
    ...regionFor(regionIndex),
    visualEvidenceStableIds: Array.from(
      { length: 256 },
      (_, evidenceIndex) => `e${regionIndex}-${evidenceIndex}`,
    ),
  }));
  assert.equal(normalizeReviewFocusGroupPlans([
    withRegions(evidenceHeavyRegions.slice(0, 16)),
  ])[0]?.regions.before.length, 16, "the total visual-evidence ceiling remains accepted");
  assert.deepEqual(normalizeReviewFocusGroupPlans([
    withRegions(evidenceHeavyRegions),
  ]), [], "visual-evidence references are bounded across all regions");
});

test("exact atom occurrence plans are bounded independently from semantic focus plans", () => {
  const atomKey = `change-1\u001e${reviewProjectionFactKey(removedText)}`;
  assert.deepEqual(normalizeReviewExactAtomOccurrences([
    { atomKey, count: 4 },
  ]), [{ atomKey, count: 4 }]);
  assert.deepEqual(normalizeReviewExactAtomOccurrences([
    { atomKey, count: 1 },
    { atomKey, count: 1 },
  ]), [], "duplicate exact keys reject the payload");
  assert.deepEqual(normalizeReviewExactAtomOccurrences([
    { atomKey, count: 129 },
  ]), [], "one logical atom cannot claim an unbounded fragment count");
  assert.deepEqual(normalizeReviewExactAtomOccurrences(Array.from(
    { length: 4_097 },
    (_, index) => ({
      atomKey: `change-${index + 1}\u001e${reviewProjectionFactKey(removedText)}`,
      count: 1,
    }),
  )), [], "the exact registry has an independent entry ceiling");
});

test("a repeated fact updates itself without deleting an independent fact", () => {
  const facts = appendReviewProjectionFact(
    [addedElement, removedText],
    { ...addedElement, summary: "新增元素（卡片）" },
  );

  assert.deepEqual(facts, [
    { ...addedElement, summary: "新增元素（卡片）" },
    removedText,
  ]);
});

test("malformed serialized facts fail closed", () => {
  assert.deepEqual(parseReviewProjectionFacts("{not-json"), []);
  assert.deepEqual(parseReviewProjectionFacts(JSON.stringify([{
    id: "unsafe value",
    type: "structure",
    semanticOwnerId: "semantic-owner-4",
  }])), []);
});

test("the largest legal fact set round-trips inside the parser byte ceiling", () => {
  const key = "a".repeat(160);
  const summary = "\\\"".repeat(40);
  const facts = Array.from(
    { length: REVIEW_PROJECTION_FACTS_PER_ELEMENT_LIMIT },
    (_, index) => ({
      id: `${String(index).padStart(3, "0")}${key}`.slice(0, 160),
      type: "text",
      semanticOwnerId: key,
      geometryOwnerId: key,
      scope: "text-block",
      operation: "replace",
      tone: "added",
      textGroup: key,
      displayGroupId: key,
      displayOwnerId: key,
      displayScope: "paragraph",
      structureChange: "style",
      summary,
    }),
  );
  const serialized = serializeReviewProjectionFacts(facts);
  assert.ok(serialized.length <= REVIEW_PROJECTION_FACTS_SERIALIZED_LENGTH_LIMIT);
  assert.deepEqual(parseReviewProjectionFacts(serialized), facts);
});

test("trusted analysis fails explicitly instead of dropping a twenty-fifth fact", () => {
  const facts = Array.from({ length: REVIEW_PROJECTION_FACTS_PER_ELEMENT_LIMIT }, (_, index) => ({
    ...addedElement,
    id: `element-added-${index + 1}`,
  })).reduce((current, fact) => appendTrustedReviewProjectionFact(current, fact), []);
  const overflow = { ...addedElement, id: "element-added-overflow" };

  assert.equal(facts.length, REVIEW_PROJECTION_FACTS_PER_ELEMENT_LIMIT);
  assert.throws(
    () => appendTrustedReviewProjectionFact(facts, overflow),
    ReviewProjectionFactOverflowError,
  );
  assert.equal(appendReviewProjectionFact(facts, overflow).length, facts.length);
  assert.deepEqual(parseReviewProjectionFacts(JSON.stringify([...facts, overflow])), []);
});

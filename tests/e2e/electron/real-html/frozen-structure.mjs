import { parse, parseFragment } from "parse5";
import { expect } from "@playwright/test";
import { clickEditHistoryMenu, keyShortcut, waitForRuntimeHandoffSettled } from "../electron-native-harness.mjs";
import { executeFrozenSelection, frozenDigest, frozenFrameAccess } from "./frozen-selection.mjs";
import { readFrozenActiveGeneration, requireCurrentTextDocument, requireFrozenTextFocus,
  requireTextOperationLedger, verifyFrozenHistory } from "./frozen-text.mjs";
import { compareElementScopedMutation, compareElementStyleMutation, SOURCE_SCOPE_POLICIES } from "./source-scope.mjs";
import { withExpectedDeleteConfirmation } from "./expected-delete-dialog.mjs";
import { buildSourceIndex } from "../../../../app/lib/source-index.js";

const ID = /^sm1_[0-9a-f]{12}4[0-9a-f]{3}[89ab][0-9a-f]{15}$/u;
const failUnless = (condition, code, details) => {
  if (!condition) throw Object.assign(new Error(code), { code, details });
};
const PROJECTION_EXPECTATIONS = new Set(["in-place", "candidate", "recovered", "refuse"]);

export function requireIndependentProjectionExpectation(target, planned, outcome, operation = null) {
  const expected = (operation && target?.projectionByOperation?.[operation]) || target?.expectedProjection || null;
  if (!expected) {
    failUnless(
      planned !== "in-place" || outcome === "in-place",
      "PLANNED_IN_PLACE_DID_NOT_HOLD",
      { planned, outcome },
    );
    return { expected: null, planned, outcome };
  }
  failUnless(PROJECTION_EXPECTATIONS.has(expected), "FROZEN_PROJECTION_EXPECTATION_INVALID", {
    expected, planned, outcome,
  });
  failUnless(expected !== "refuse", "FROZEN_REFUSE_PATH_EXECUTED", { expected, planned, outcome });
  if (expected === "in-place") {
    failUnless(planned === "in-place" && outcome === "in-place", "EXPECTED_IN_PLACE_DID_NOT_HOLD", {
      expected, planned, outcome,
    });
  } else if (expected === "candidate") {
    failUnless(outcome === "candidate", "EXPECTED_CANDIDATE_DID_NOT_HOLD", {
      expected, planned, outcome,
    });
  } else {
    failUnless(outcome === "recovered", "EXPECTED_RECOVERY_DID_NOT_HOLD", {
      expected, planned, outcome,
    });
  }
  return { expected, planned, outcome };
}
const idOf = node => node?.attrs?.find(attribute => attribute.name === "data-stemmio-id")?.value;
function byteChanges(before, after) {
  let start = 0, suffix = 0;
  while (start < Math.min(before.length, after.length) && before[start] === after[start]) start++;
  while (suffix < Math.min(before.length, after.length) - start
    && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix++;
  return { before: { start, end: before.length - suffix }, after: { start, end: after.length - suffix } };
}
function sourceNodes(source) {
  const nodes = [];
  const visit = node => {
    if (node.tagName) nodes.push(node);
    for (const child of node.childNodes || []) visit(child);
    if (node.content) visit(node.content);
  };
  visit(parse(source, { sourceCodeLocationInfo: true }));
  return nodes;
}

// The deletion landing is a test oracle, not a call-through to the production
// projection planner. Keep the frozen rule explicit so a shared production
// regression cannot make the harness agree with the bug it is meant to catch.
const FROZEN_DELETE_UNSUPPORTED_TAGS = new Set([
  "button", "datalist", "fieldset", "form", "input", "label", "legend", "meter",
  "optgroup", "option", "output", "progress", "select", "textarea",
  "area", "audio", "canvas", "embed", "img", "map", "object", "picture", "source", "track", "video",
  "ul", "ol", "menu", "dl", "dt", "dd",
  "table", "thead", "tbody", "tfoot", "tr", "td", "th", "col", "colgroup", "caption",
  "template", "slot", "iframe", "applet", "script", "style", "link",
  "meta", "svg", "math", "html", "head", "body", "frameset", "frame", "noscript",
]);
const FROZEN_DELETE_NESTED_LIST_TAGS = new Set(["ul", "ol", "menu", "dl", "dt", "dd"]);

function frozenSourceElement(index, id) {
  if (!id) return null;
  const element = index?.byStemmioId?.get(id);
  return element?.type === "element" ? element : null;
}

function frozenLandingCandidate(element, role = "sibling") {
  const tag = String(element?.tagName || "").toLowerCase();
  const customized = element?.attrs?.some(attribute => (
    String(attribute.name || "").toLowerCase() === "is"
      && String(attribute.value || "").trim() !== ""
  ));
  return Boolean(element?.type === "element" && element.stemmioId
    && !tag.includes("-")
    && !customized
    && !(FROZEN_DELETE_UNSUPPORTED_TAGS.has(tag)
      && !(role === "parent" && FROZEN_DELETE_NESTED_LIST_TAGS.has(tag)))
    && !["html", "head", "body"].includes(tag));
}

export function resolveFrozenDeleteSelectionLanding(beforeIndex, removedRootElementId) {
  const target = frozenSourceElement(beforeIndex, removedRootElementId);
  if (!target) return null;
  const next = target.nextElementSiblingId
    ? beforeIndex.byNodeId.get(target.nextElementSiblingId) : null;
  if (frozenLandingCandidate(next, "sibling")) return next.stemmioId;
  const previous = target.previousElementSiblingId
    ? beforeIndex.byNodeId.get(target.previousElementSiblingId) : null;
  if (frozenLandingCandidate(previous, "sibling")) return previous.stemmioId;
  const parent = target.parentId ? beforeIndex.byNodeId.get(target.parentId) : null;
  return frozenLandingCandidate(parent, "parent") ? parent.stemmioId : null;
}

// Parse source to validate one predeclared insertion, never to choose a target.
// No production structure planner/materializer is used by this byte oracle.
export function bindFrozenCopy(beforeBytes, afterBytes, target) {
  const before = beforeBytes.toString("utf8"), after = afterBytes.toString("utf8");
  const nodes = sourceNodes(before), matches = nodes.filter(node => idOf(node) === target.selectedId);
  const original = matches.length === 1 ? matches[0] : null;
  const loc = original?.sourceCodeLocation, binding = target.copyBinding;
  const raw = loc ? before.slice(loc.startOffset, loc.endOffset) : "";
  const parent = original?.parentNode;
  const siblings = parent?.childNodes?.filter(node => node.tagName) || [];
  const next = siblings[siblings.indexOf(original) + 1];
  const insertion = next?.sourceCodeLocation?.startOffset ?? parent?.sourceCodeLocation?.endTag?.startOffset;
  const offset = binding.byteOffset, addedLength = afterBytes.length - beforeBytes.length;
  const insertedBytes = afterBytes.subarray(offset, offset + Math.max(addedLength, 0));
  const inserted = insertedBytes.toString("utf8");
  const fragment = parseFragment(inserted, { sourceCodeLocationInfo: true });
  const copy = fragment.childNodes.length === 1 ? fragment.childNodes[0] : null;
  const attr = loc?.attrs?.["data-stemmio-id"], copyAttr = copy?.sourceCodeLocation?.attrs?.["data-stemmio-id"];
  const identityFreeOriginal = attr ? before.slice(loc.startOffset, attr.startOffset)
    + before.slice(attr.endOffset, loc.endOffset) : null;
  // The kernel adds exactly one preceding space with the new identity attribute.
  const identityFreeCopy = copyAttr ? inserted.slice(0, copyAttr.startOffset - 1)
    + inserted.slice(copyAttr.endOffset) : null;
  const allAfter = sourceNodes(after), ids = allAfter.map(idOf).filter(Boolean);
  const copyId = idOf(copy);
  const conditions = {
    originalUnique: matches.length === 1,
    originalBytesMatch: frozenDigest(raw) === binding.originalElementSha256,
    originalLeaf: Boolean(original?.childNodes.length === 1 && original.childNodes[0].nodeName === "#text"),
    parentMatches: idOf(parent) === binding.parentId,
    siblingMatches: (idOf(next) || null) === binding.beforeSiblingId,
    offsetMatches: Number.isInteger(insertion) && Buffer.byteLength(before.slice(0, insertion)) === offset,
    positiveInsertion: addedLength > 0,
    prefixUnchanged: beforeBytes.subarray(0, offset).equals(afterBytes.subarray(0, offset)),
    suffixUnchanged: beforeBytes.subarray(offset).equals(afterBytes.subarray(offset + Math.max(addedLength, 0))),
    oneLeafInserted: Boolean(copy?.tagName === target.selectedTag && copy.childNodes.length === 1
      && copy.childNodes[0].nodeName === "#text" && copy.sourceCodeLocation?.startOffset === 0
      && copy.sourceCodeLocation?.endOffset === inserted.length),
    freshId: ID.test(copyId || "") && !nodes.some(node => idOf(node) === copyId),
    idsUnique: ids.length === new Set(ids).size,
    exactlyOneAdded: allAfter.length === nodes.length + 1,
    copyAttributeShape: Boolean(copyAttr && inserted[copyAttr.startOffset - 1] === " "
      && inserted.slice(copyAttr.startOffset, copyAttr.endOffset) === `data-stemmio-id="${copyId}"`),
    equivalentBytes: identityFreeOriginal !== null && identityFreeCopy === identityFreeOriginal,
    copyParentMatches: idOf(allAfter.find(node => idOf(node) === copyId)?.parentNode) === binding.parentId,
  };
  const changedRanges = { before: { start: offset, end: offset }, after: { start: offset, end: offset + addedLength } };
  failUnless(Object.values(conditions).every(Boolean), "FROZEN_COPY_SOURCE_INVALID",
    { conditions, changedRanges, actualChangedRanges: byteChanges(beforeBytes, afterBytes) });
  return { copyId, conditions, changedRanges };
}

export function bindFrozenMove(beforeBytes, afterBytes, { copyId, destinationParentId, originalParentId }) {
  const beforeNodes = sourceNodes(beforeBytes.toString("utf8"));
  const afterNodes = sourceNodes(afterBytes.toString("utf8"));
  const beforeCopy = beforeNodes.filter(node => idOf(node) === copyId);
  const afterCopy = afterNodes.filter(node => idOf(node) === copyId);
  const destination = afterNodes.filter(node => idOf(node) === destinationParentId);
  const beforeIds = beforeNodes.map(idOf).filter(Boolean).sort();
  const afterIds = afterNodes.map(idOf).filter(Boolean).sort();
  const siblingIds = (node) => node?.parentNode?.childNodes?.filter(child => child.tagName).map(idOf) || [];
  const beforeSiblingIds = siblingIds(beforeCopy[0]);
  const afterSiblingIds = siblingIds(afterCopy[0]);
  const beforeIndex = beforeSiblingIds.indexOf(copyId);
  const afterIndex = afterSiblingIds.indexOf(copyId);
  const adjacentSameParent = originalParentId === destinationParentId
    && beforeIndex >= 0 && afterIndex >= 0 && Math.abs(afterIndex - beforeIndex) === 1;
  const conditions = {
    copyUniqueBefore: beforeCopy.length === 1,
    copyUniqueAfter: afterCopy.length === 1,
    destinationUnique: destination.length === 1,
    movedFromOriginal: idOf(beforeCopy[0]?.parentNode) === originalParentId,
    landedAtDestination: idOf(afterCopy[0]?.parentNode) === destinationParentId,
    destinationChanged: originalParentId !== destinationParentId || adjacentSameParent,
    adjacentSameParent: originalParentId !== destinationParentId || adjacentSameParent,
    sameIdentitySet: beforeIds.length === afterIds.length && JSON.stringify(beforeIds) === JSON.stringify(afterIds),
    sameNodeCount: beforeNodes.length === afterNodes.length,
  };
  failUnless(Object.values(conditions).every(Boolean), "FROZEN_MOVE_SOURCE_INVALID", {
    conditions, copyId, destinationParentId, originalParentId,
    actualChangedRanges: byteChanges(beforeBytes, afterBytes),
  });
  return { conditions };
}

export function verifyFrozenStructureLifecycle({ path, before, after, sourceHash, records }) {
  if (path === "in-place") {
    const conditions = {
      knownPath: true,
      documentUnchanged: Boolean(before.documentId && after.documentId && before.documentId === after.documentId),
      generationUnchanged: Number(before.generation) > 0 && Number(after.generation) === Number(before.generation),
      sourceMatches: after.working === sourceHash && after.displayed === sourceHash,
      candidateAbsent: !records.some(row => row.kind === "candidate-created" || row.kind === "candidate-terminal"),
      terminalReady: after.phase === "settled" || after.phase === "static",
    };
    failUnless(Object.values(conditions).every(Boolean), "FROZEN_STRUCTURE_IN_PLACE_INVALID", {
      conditions, before, after,
    });
    return { conditions, path: "in-place", generation: after.generation, runtime: "in-place" };
  }
  if (path === "runtime-candidate") {
    const lifecycle = verifyFrozenHistory({ expectedPath: path, before,
      after: { ...after, path }, sourceHash, records });
    const terminalConditions = { phaseSettled: after.phase === "settled", runtimeReady: after.outcome === "ready" };
    failUnless(Object.values(terminalConditions).every(Boolean), "FROZEN_STRUCTURE_RUNTIME_TERMINAL_INVALID",
      { conditions: terminalConditions, phase: after.phase, outcome: after.outcome });
    return { ...lifecycle, terminalConditions };
  }
  const conditions = {
    knownPath: path === "static-rebuild",
    documentChanged: Boolean(before.documentId && after.documentId && before.documentId !== after.documentId),
    generationChanged: Number(before.generation) > 0 && Number(after.generation) > Number(before.generation),
    sourceMatches: after.working === sourceHash && after.displayed === sourceHash,
    candidateAbsent: !records.some(row => row.kind === "candidate-created" || row.kind === "candidate-terminal"),
    staticTerminal: after.phase === "static" && after.outcome === "not-candidate",
  };
  failUnless(Object.values(conditions).every(Boolean), "FROZEN_STATIC_REBUILD_INVALID", { conditions, before, after });
  return {
    conditions,
    path: "static-rebuild",
    terminalConditions: { phaseStatic: after.phase === "static", runtimeNotCandidate: after.outcome === "not-candidate" },
    candidate: { state: "NOT_APPLICABLE", reason: "AUTHORED_STATIC_PAGE_NOT_RUNTIME_CANDIDATE" },
    generation: after.generation,
    runtime: "static:not-candidate",
  };
}

export async function readFrozenCopyCapability(editor, target, sourceBytes) {
  // Selection DOM and React's toolbar commit are separate signals. Wait only
  // for the one toolbar, never for a copy button that may correctly be absent.
  await expect(editor.getByRole("toolbar").filter({ visible: true })).toHaveCount(1, { timeout: 2_000 });
  const actual = await editor.evaluate(element => {
    const attr = name => element.getAttribute(name);
    const probeBefore = Number(attr("data-e2e-copy-probe-sequence") || 0);
    element.dispatchEvent(new Event("stemmio:e2e-copy-capability-probe"));
    return { probeBefore, probeAfter: Number(attr("data-e2e-copy-probe-sequence")),
      ui: attr("data-element-copy-availability"), uiReason: attr("data-element-copy-reason"),
      uiDiagnostic: attr("data-element-copy-diagnostic"),
      live: attr("data-e2e-copy-live-availability"), liveReason: attr("data-e2e-copy-live-reason"),
      liveDiagnostic: attr("data-e2e-copy-live-diagnostic"), liveId: attr("data-e2e-copy-live-target-id"),
      sessionEnded: attr("data-e2e-copy-native-edit-ended"),
      candidateId: attr("data-runtime-candidate-id"),
      candidateCount: element.querySelectorAll('iframe[data-runtime-slot-role="candidate"]').length,
      working: attr("data-working-source-sha256"), displayed: attr("data-rendered-projection-sha256") };
  });
  const button = editor.getByRole("button", { name: "复制元素", exact: true });
  actual.buttonCount = await button.count();
  actual.buttonEnabled = actual.buttonCount === 1 && await button.isEnabled();
  actual.generation = await readFrozenActiveGeneration(editor);
  return verifyFrozenCopyCapability(actual, target, sourceBytes);
}

export function verifyFrozenCopyCapability(actual, target, sourceBytes) {
  const expected = target.copyCapability.expected === "AVAILABLE" ? "available" : "unsupported";
  const diagnostic = target.copyCapability.diagnostic ?? null;
  const conditions = { knownExpectation: ["AVAILABLE", "UNSUPPORTED"].includes(target.copyCapability.expected),
    probeFresh: Number.isInteger(actual.probeBefore) && actual.probeBefore >= 0 && actual.probeAfter === actual.probeBefore + 1,
    uiMatches: actual.ui === expected && actual.uiReason === target.copyCapability.reason,
    liveMatches: actual.live === expected && actual.liveReason === target.copyCapability.reason,
    diagnosticMatches: actual.uiDiagnostic === diagnostic && actual.liveDiagnostic === diagnostic,
    identityMatches: actual.liveId === target.selectedId,
    sessionEnded: actual.sessionEnded === "true", candidateAbsent: !actual.candidateId && actual.candidateCount === 0,
    sourceMatches: actual.working === `sha256:${frozenDigest(sourceBytes)}` && actual.displayed === actual.working,
    buttonMatches: expected === "available" ? actual.buttonCount === 1 && actual.buttonEnabled === true
      : actual.buttonCount === 0 && actual.buttonEnabled === false };
  failUnless(Object.values(conditions).every(Boolean), "FROZEN_COPY_CAPABILITY_MISMATCH", { conditions, actual });
  return { conditions, actual };
}

// Source-only witness verification; never discovers or substitutes a live target.
export function verifyFrozenDenialWitness(sourceBytes, target, live) {
  const html = sourceBytes.toString(), nodes = sourceNodes(html), proof = target.denialEvidence;
  const roots = nodes.filter(node => idOf(node) === target.selectedId);
  const witnesses = nodes.filter(node => idOf(node) === proof.witnessId);
  const root = roots[0], witness = witnesses[0], loc = root?.sourceCodeLocation;
  const ancestry = []; let cursor = witness;
  while (cursor && cursor !== root) {
    const parent = cursor.parentNode;
    // Copy diagnostics count maximal adjacent text runs, including whitespace.
    const children = (parent?.childNodes || []).filter(n => n.nodeName !== "#text" || n.value !== "");
    ancestry.unshift(`/${parent?.tagName}[${children.indexOf(cursor)}]`); cursor = parent;
  }
  const conditions = { uniqueRoot: roots.length === 1, uniqueWitness: witnesses.length === 1,
    rootBytesMatch: Boolean(loc) && frozenDigest(html.slice(loc.startOffset, loc.endOffset)) === proof.sourceElementSha256,
    witnessInRoot: Boolean(root && witness && cursor === root), witnessTagMatches: witness?.tagName === proof.witnessTag,
    diagnosticPathMatches: `root${ancestry.join("")}` === proof.diagnosticPath,
    liveIdentityMatches: live.count === 1 && live.id === proof.witnessId && live.tag === proof.witnessTag && live.connected === true };
  if (proof.kind === "attribute-extra") {
    conditions.sourceAttributeAbsent = Boolean(witness) && !witness.attrs.some(a => a.name.toLowerCase() === proof.attribute.toLowerCase());
    conditions.liveAttributeNonempty = typeof live.attributeValue === "string" && live.attributeValue.trim().length > 0;
  } else if (proof.kind === "empty-container-populated") {
    conditions.sourceContainerEmpty = witness?.childNodes.length === 0;
    conditions.liveChildrenPresent = Number.isInteger(live.childCount) && live.childCount > 0;
  } else conditions.opaqueCanvas = proof.kind === "opaque-canvas" && witness?.tagName === "canvas" && live.tag === "canvas";
  failUnless(Object.values(conditions).every(Boolean), "FROZEN_DENIAL_WITNESS_MISMATCH", { conditions, proof, live,
    sourceRange: loc ? { start: loc.startOffset, end: loc.endOffset } : null });
  return { conditions, sourceRange: { start: loc.startOffset, end: loc.endOffset }, live };
}

// A denied UI action is not force-dispatched through a private product command.
export async function executeFrozenCopyDenied({ frame, target, editor, readSource, rows, calls }) {
  const row = rows[0], started = performance.now();
  row.expected = target.copyCapability;
  try {
    const before = await readSource(), html = before.toString();
    const matches = sourceNodes(html).filter(node => idOf(node) === target.selectedId);
    const node = matches.length === 1 ? matches[0] : null, loc = node?.sourceCodeLocation;
    const proof = target.denialEvidence;
    const boundary = target.copyCapability.basis === "REVIEWED_AUTHORED_COPY_BOUNDARY";
    const sourceConditions = { uniqueSource: matches.length === 1,
      exactSource: Boolean(loc) && frozenDigest(html.slice(loc.startOffset, loc.endOffset)) === proof.sourceElementSha256,
      ...(!boundary ? { attributeAbsentFromSource: Boolean(node) && !node.attrs.some(attr => attr.name === proof.attribute) } : {}) };
    failUnless(Object.values(sourceConditions).every(Boolean), "FROZEN_DENIAL_SOURCE_MISMATCH", { conditions: sourceConditions });
    const handle = await frozenFrameAccess(frame, target, calls).target(target.selectedId).elementHandle();
    const documentHandle = await frame.evaluateHandle(() => document);
    const generation = await readFrozenActiveGeneration(editor);
    try {
      let runtimeValue, witness;
      if (boundary) {
        // The witness ID was independently frozen from source review.
        calls.push({ kind: "fixed-denial-witness", id: proof.witnessId });
        const exact = frame.locator(`[data-stemmio-id="${proof.witnessId}"]`), count = await exact.count();
        const live = count === 1 ? await exact.evaluate((e, attribute) => ({ id: e.getAttribute("data-stemmio-id"),
          tag: e.localName, connected: e.isConnected, childCount: e.childNodes.length,
          attributeValue: attribute ? e.getAttribute(attribute) : null }), proof.attribute) : {};
        witness = verifyFrozenDenialWitness(before, target, { ...live, count });
      } else {
        runtimeValue = await handle.getAttribute(proof.attribute);
        failUnless(runtimeValue === proof.value, "FROZEN_DENIAL_RUNTIME_DRIFT", { expected: proof.value, actual: runtimeValue });
      }
      const capability = await readFrozenCopyCapability(editor, target, before);
      const document = await requireCurrentTextDocument(frame, documentHandle, handle);
      const unchanged = (await readSource()).equals(before);
      const sameGeneration = await readFrozenActiveGeneration(editor) === generation;
      failUnless(unchanged && sameGeneration, "DENIED_COPY_CHANGED_STATE", { conditions: { unchanged, sameGeneration } });
      row.actual = { sourceConditions, runtimeValue, witness, capability, document, unchanged, sameGeneration };
    } finally { await handle.dispose(); await documentHandle.dispose(); }
    Object.assign(row, { state: "PASS", reason: "FROZEN_COPY_REFUSAL_MATCHES_SOURCE_AND_RUNTIME" });
  } catch (error) {
    Object.assign(row, { state: "FAIL", reason: error.code || "DENIED_COPY_ASSERTION_FAILED", details: error.details });
    throw error;
  } finally { row.durationMs = performance.now() - started; }
  requireTextOperationLedger(rows, target.operations);
}

export function verifyFrozenEndedContinuation(actual) {
  const conditions = Object.fromEntries(["sessionEnded", "frameFocusIsBody", "targetNotEditable", "outerFocusSafe",
    "sourceUnchanged", "targetTextUnchanged", "generationUnchanged", "currentDocument"].map(key => [key, actual[key] === true]));
  conditions.noInputDelivered = Array.isArray(actual.inputEvents) && actual.inputEvents.length === 0;
  failUnless(Object.values(conditions).every(Boolean), "FROZEN_DIRECT_CONTINUATION_MISMATCH", { conditions, actual });
  return { conditions, actual, mode: "session-ended-no-refocus" };
}

// One direct keyboard probe before any refocus. Observe input delivery rather
// than searching the document for the marker or guessing where it landed.
export async function probeFrozenEndedContinuation({ page, frame, editor, target, readSource, calls, marker }) {
  const locator = frozenFrameAccess(frame, target, calls).target(target.selectedId);
  const handle = await locator.elementHandle(), documentHandle = await frame.evaluateHandle(() => document);
  const source = await readSource(), text = await handle.textContent(), generation = await readFrozenActiveGeneration(editor);
  const start = () => {
    const events = [];
    const listener = event => events.push({ type: event.type, tag: event.target?.localName,
      id: event.target?.getAttribute?.("data-stemmio-id") || null });
    document.addEventListener("beforeinput", listener, true); document.addEventListener("input", listener, true);
    globalThis.__STEMMIO_FROZEN_INPUT_DELIVERY__ = { events, stop: () => {
      document.removeEventListener("beforeinput", listener, true); document.removeEventListener("input", listener, true);
      delete globalThis.__STEMMIO_FROZEN_INPUT_DELIVERY__; return events;
    } };
  };
  const stop = () => {
    if (!globalThis.__STEMMIO_FROZEN_INPUT_DELIVERY__) throw new Error("FROZEN_INPUT_OBSERVER_MISSING");
    const events = globalThis.__STEMMIO_FROZEN_INPUT_DELIVERY__.stop();
    if (!Array.isArray(events)) throw new Error("FROZEN_INPUT_OBSERVER_INVALID");
    return events;
  };
  try {
    await editor.evaluate(element => element.dispatchEvent(new Event("stemmio:e2e-copy-capability-probe")));
    const before = await handle.evaluate(element => ({ targetNotEditable: !element.isContentEditable,
      frameFocusIsBody: element.ownerDocument.activeElement === element.ownerDocument.body,
      frameFocusTag: element.ownerDocument.activeElement?.localName,
      frameFocusId: element.ownerDocument.activeElement?.getAttribute("data-stemmio-id") || null }));
    const outer = await page.evaluate(() => ({ tag: document.activeElement?.localName,
      safe: ["body", "iframe", "button"].includes(document.activeElement?.localName) && !document.activeElement?.isContentEditable }));
    before.sessionEnded = await editor.getAttribute("data-e2e-copy-native-edit-ended") === "true";
    // An already wrong editable focus is sufficient failure; never type into it.
    const focusConditions = { sessionEnded: before.sessionEnded, frameFocusIsBody: before.frameFocusIsBody,
      targetNotEditable: before.targetNotEditable, outerFocusSafe: outer.safe };
    failUnless(Object.values(focusConditions).every(Boolean),
      "FROZEN_CONTINUATION_UNSAFE_FOCUS", { conditions: focusConditions, before, outer });
    await page.evaluate(start); await frame.evaluate(start);
    await page.keyboard.type(marker);
    const inputEvents = [...(await page.evaluate(stop)), ...(await frame.evaluate(stop))];
    const document = await requireCurrentTextDocument(frame, documentHandle, handle);
    return verifyFrozenEndedContinuation({ ...before, outerFocusSafe: outer.safe, outerFocusTag: outer.tag,
      sourceUnchanged: (await readSource()).equals(source), targetTextUnchanged: await handle.textContent() === text,
      generationUnchanged: await readFrozenActiveGeneration(editor) === generation,
      currentDocument: Object.values(document).every(Boolean), inputEvents });
  } finally {
    await page.evaluate(stop).catch(() => {}); await frame.evaluate(stop).catch(() => {});
    await handle.dispose(); await documentHandle.dispose();
  }
}

export async function executeFrozenStructure({ frame, target, page, editor, electronApp, fileId, readSource, rows, calls }) {
  const baseline = await readSource();
  const closedLoop = target.operations.includes("style-copy");
  let currentBytes = baseline, copyTarget, copiedBytes, savedBytes, restoredBytes, selectionAfterDelete = null;
  let handle, documentHandle;
  const marker = ` PRCOPY_${fileId}`;
  const restoredMarker = ` PRREST_${fileId}`;
  const originalText = await frozenFrameAccess(frame, target, calls).target(target.selectedId).textContent();
  const documentId = () => frame.evaluate(() => globalThis.__STEMMIO_NATIVE_QA_DOCUMENT_TOKEN__ ||= crypto.randomUUID());
  let generation = await readFrozenActiveGeneration(editor);
  const record = async (operation, expected, action) => {
    const row = rows.find(item => item.operation === operation
      && (operation !== "copy" || item.targetId === target.selectedId));
    const start = performance.now();
    row.expected = expected; row.targetId = operation === "copy" || operation.startsWith("probe-") ? target.selectedId : copyTarget.selectedId;
    try { row.actual = await action(); Object.assign(row, { state: "PASS", reason: "EXPECTED_CHANGE_OBSERVED" }); }
    catch (error) { Object.assign(row, { state: "FAIL", reason: error.code || "OPERATION_ASSERTION_FAILED", details: error.details }); throw error; }
    finally { row.durationMs = performance.now() - start; }
  };
  const selectCopy = async (priorSelectionId) => {
    const audit = [];
    try { return await executeFrozenSelection({ access: frozenFrameAccess(frame, copyTarget, audit),
      keyboard: page.keyboard, mouse: page.mouse, target: copyTarget, calls: audit, priorSelectionId }); }
    finally { calls.push(...audit); }
  };
  const currentKnownPrior = async (allowed) => {
    const selected = frame.locator("[data-html-canvas-selected]");
    const count = await selected.count();
    failUnless(count <= 1, "FROZEN_SELECTION_NOT_UNIQUE", { count });
    const prior = count === 1 ? await selected.getAttribute("data-stemmio-id") : null;
    failUnless(prior === null || allowed.includes(prior), "FROZEN_SELECTION_NOT_KNOWN", { prior, allowed });
    return prior;
  };
  const refreshActiveFrame = async () => {
    const active = editor.locator('iframe[data-runtime-slot-role="active"]');
    failUnless(await active.count() === 1, "FROZEN_ACTIVE_FRAME_NOT_UNIQUE");
    frame = await (await active.elementHandle()).contentFrame();
  };
  const rebuild = async (action, verifySource, operation) => {
    const before = { generation, documentId: await documentId() };
    const cursor = await editor.evaluate(() => ({ candidate: globalThis.__STEMMIO_REAL_HTML_RUNTIME_OBSERVER__.records.length,
      lifecycle: globalThis.__STEMMIO_REAL_HTML_RUNTIME_OBSERVER__.lifecycleRecords.length }));
    await action();
    await expect.poll(async () => !(await readSource()).equals(currentBytes), { timeout: 5_000 }).toBe(true);
    const afterBytes = await readSource(), source = verifySource(afterBytes);
    const sourceHash = `sha256:${frozenDigest(afterBytes)}`;
    await expect.poll(async () => editor.getAttribute("data-structural-projection-kind"), {
      timeout: 5_000,
    }).not.toBeNull();
    await expect.poll(async () => editor.getAttribute("data-structural-projection-outcome"), {
      timeout: 5_000,
    }).not.toBe("pending");
    const planned = await editor.getAttribute("data-structural-projection-kind");
    const outcome = await editor.getAttribute("data-structural-projection-outcome");
    requireIndependentProjectionExpectation(target, planned, outcome, operation);
    const inPlace = outcome === "in-place";
    const settled = await waitForRuntimeHandoffSettled(page, {
      timeout: 7_000,
      expectedSourceRevision: sourceHash,
      priorGeneration: Number(generation),
      requireGenerationAdvance: !inPlace,
    });
    await refreshActiveFrame();
    const records = await editor.evaluate((_element, cursor) => {
      const state = globalThis.__STEMMIO_REAL_HTML_RUNTIME_OBSERVER__;
      return [...state.records.slice(cursor.candidate), ...state.lifecycleRecords.slice(cursor.lifecycle)];
    }, cursor);
    const runtime = verifyFrozenStructureLifecycle({
      path: inPlace ? "in-place" : target.rebuildPath,
      before,
      sourceHash,
      records,
      after: {
        documentId: await documentId(),
        generation: settled.activeFrameGeneration,
        working: settled.workingProjectionSha256,
        displayed: settled.renderedProjectionSha256,
        phase: settled.runtimeSurfacePhase,
        outcome: settled.runtimeSurfaceOutcome,
      },
    });
    currentBytes = afterBytes; generation = settled.activeFrameGeneration;
    return { source, runtime, planned, outcome };
  };
  const walkHistory = async (direction, expectedBytes, code) => {
    failUnless(electronApp, "FROZEN_HISTORY_APP_MISSING");
    const attempts = [];
    for (let index = 0; index < 12 && !(await readSource()).equals(expectedBytes); index += 1) {
      const prior = await readSource();
      const persist = page.locator("[data-persist-state]").first();
      await expect(persist).toHaveAttribute("data-persist-state", "idle", { timeout: 30_000 });
      const beforeRevision = Number(await persist.getAttribute("data-persisted-revision"));
      await clickEditHistoryMenu(electronApp, page, direction);
      await expect.poll(async () => !(await readSource()).equals(prior), { timeout: 15_000 }).toBe(true);
      const current = await readSource();
      attempts.push(frozenDigest(current));
      await expect.poll(async () => {
        const state = await persist.getAttribute("data-persist-state");
        const edit = await persist.getAttribute("data-edit-revision");
        const persisted = await persist.getAttribute("data-persisted-revision");
        return state === "idle" && edit === persisted && Number(edit) >= beforeRevision;
      }, { timeout: 30_000 }).toBe(true);
      await waitForRuntimeHandoffSettled(page, {
        timeout: 7_000,
        expectedSourceRevision: `sha256:${frozenDigest(current)}`,
      });
      await refreshActiveFrame();
    }
    const actual = await readSource();
    failUnless(actual.equals(expectedBytes), code, {
      attempts, expectedSha256: frozenDigest(expectedBytes), actualSha256: frozenDigest(actual),
    });
    currentBytes = actual;
    generation = await readFrozenActiveGeneration(editor);
    return { attempts };
  };
  const sameDocument = async () => {
    await requireCurrentTextDocument(frame, documentHandle, handle);
    failUnless(await readFrozenActiveGeneration(editor) === generation, "UNEXPECTED_COPY_TEXT_REBUILD");
  };
  const activateCopyLeaf = async () => {
    await handle?.dispose(); await documentHandle?.dispose();
    const locator = frozenFrameAccess(frame, copyTarget, calls).target(copyTarget.selectedId);
    handle = await locator.elementHandle(); documentHandle = await frame.evaluateHandle(() => document);
    const position = await handle.evaluate(element => {
      const outer = element.getBoundingClientRect();
      for (const text of [...element.childNodes].filter(node => node.nodeType === 3 && node.textContent)) {
        for (let offset = 0; offset < text.textContent.length; offset += 1) {
          const range = element.ownerDocument.createRange();
          range.setStart(text, offset); range.setEnd(text, offset + 1);
          const rect = range.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            return { x: rect.left - outer.left + rect.width / 2, y: rect.top - outer.top + rect.height / 2 };
          }
        }
      }
      return null;
    });
    failUnless(position, "COPY_PLAIN_LEAF_DRIFT");
    await handle.dblclick({ position, timeout: 2_000 });
    await expect(locator).toHaveAttribute("contenteditable", /^(?:true|plaintext-only)$/u, { timeout: 2_000 });
    await page.keyboard.press(keyShortcut("ArrowDown"));
    await sameDocument();
    return requireFrozenTextFocus(handle, copyTarget.selectedId, { atEnd: true });
  };
  try {
    await record("copy", { newLeafAtByteOffset: target.copyBinding.byteOffset }, async () => {
      const capability = await readFrozenCopyCapability(editor, target, baseline);
      const result = await rebuild(() => editor.getByRole("button", { name: "复制元素", exact: true }).click({ timeout: 2_000 }), after => {
        const source = bindFrozenCopy(baseline, after, target);
        copyTarget = Object.freeze({ ...target, clickId: source.copyId, selectedId: source.copyId });
        calls.push({ kind: "operation-output-binding", from: target.selectedId, id: source.copyId,
          byteOffset: target.copyBinding.byteOffset });
        return source;
      }, "copy");
      copiedBytes = currentBytes;
      failUnless(await editor.getAttribute("data-element-copy-command-availability") === "available"
        && await editor.getAttribute("data-element-copy-command-reason") === "available", "COPY_COMMAND_REFUSED");
      return { capability, ...result };
    });
    if (JSON.stringify(target.operations) === JSON.stringify(["copy"])) {
      failUnless(await frozenFrameAccess(frame, copyTarget, calls).target(copyTarget.selectedId).count() === 1,
        "FROZEN_COPY_DISPLAY_MISSING");
      failUnless(await frozenFrameAccess(frame, target, calls).target(target.selectedId).count() === 1,
        "ORIGINAL_IDENTITY_CHANGED");
      requireTextOperationLedger(
        rows.filter((row) => row.operation === "copy" && row.targetId === target.selectedId),
        target.operations,
      );
      return {
        finalSha256: frozenDigest(currentBytes), finalSize: currentBytes.length, originalText,
        copyId: copyTarget.selectedId, restoredMarker: null, reopenCopyPresent: true,
      };
    }
    if (target.continuationProbe) await record("probe-after-copy", { mode: target.continuationProbe }, () =>
      probeFrozenEndedContinuation({ page, frame, editor, target, readSource, calls, marker: `PRDIRECT_${fileId}_COPY` }));
    await record("select-copy", { id: copyTarget.selectedId }, async () => (
      selectCopy(await currentKnownPrior([target.selectedId, copyTarget.selectedId]))
    ));
    await record("activate-copy", { editableId: copyTarget.selectedId }, () => activateCopyLeaf());
    await record("input-copy", { appended: marker }, async () => {
      await sameDocument(); await requireFrozenTextFocus(handle, copyTarget.selectedId, { atEnd: true });
      await page.keyboard.type(marker);
      failUnless(await handle.textContent() === `${originalText}${marker}`, "FROZEN_COPY_INPUT_LANDING_MISMATCH");
      await sameDocument(); return { appended: marker, id: copyTarget.selectedId };
    });
    await record("save-copy", { sourceContains: marker, originalUnchanged: true }, async () => {
      await page.keyboard.press(keyShortcut("s"));
      await expect.poll(async () => (await readSource()).includes(marker), { timeout: 5_000 }).toBe(true);
      savedBytes = await readSource();
      const oracle = compareElementScopedMutation({ before: copiedBytes, after: savedBytes, sourceId: copyTarget.selectedId,
        normalizationPolicy: SOURCE_SCOPE_POLICIES.TEXT_INPUT_DELETE, expectedAfterContains: [marker],
        expectedAppendedPattern: new RegExp(marker, "u") });
      failUnless(oracle.ok, "SOURCE_SCOPE_ORACLE_FAILED", oracle);
      await sameDocument(); currentBytes = savedBytes;
      return { outsideUnchanged: oracle.outsideUnchanged, changedRanges: oracle.changedRanges };
    });
    if (closedLoop) {
      await record("style-copy", { fontWeight: "700" }, async () => {
        await page.keyboard.press("Escape");
        await editor.evaluate(element => element.dispatchEvent(new Event("stemmio:e2e-copy-capability-probe")));
        failUnless(await editor.getAttribute("data-e2e-copy-native-edit-ended") === "true", "COPY_EDIT_SESSION_NOT_ENDED");
        await selectCopy(copyTarget.selectedId);
        const locator = frozenFrameAccess(frame, copyTarget, calls).target(copyTarget.selectedId);
        await handle?.dispose(); handle = await locator.elementHandle();
        const button = editor.getByRole("button", { name: "加粗", exact: true });
        await expect(button).toHaveAttribute("aria-pressed", "false");
        const beforeStyle = currentBytes;
        await button.click();
        await expect(button).toHaveAttribute("aria-pressed", "true");
        await page.keyboard.press(keyShortcut("s"));
        let oracle;
        await expect.poll(async () => {
          const after = await readSource();
          oracle = compareElementStyleMutation({ before: beforeStyle, after, sourceId: copyTarget.selectedId,
            expectedProperty: "font-weight", expectedValue: "700" });
          return oracle.ok;
        }, { timeout: 5_000 }).toBe(true);
        currentBytes = await readSource();
        return { fontWeight: "700", outsideElementUnchanged: oracle.outsideElementUnchanged };
      });
      await record("move-copy", { parentId: target.destinationParentId }, async () => {
        if (target.rebuildTrigger === "accepted-projection-failure") {
          // The move is still a supported direct operation.  Inject failure
          // only after the kernel has been accepted so C proves the unified
          // recovery path rather than globally disabling structural in-place.
          await page.evaluate(() => {
            window.__STEMMIO_E2E_FAIL_NEXT_STRUCTURAL_PROJECTION__ = true;
          });
        }
        const result = await rebuild(async () => {
          const moved = await page.getByTestId("html-canvas-editor").evaluate(
            (element, { parentElementId, beforeElementId }) => {
              const run = element.__STEMMIO_E2E_STRUCTURE_COMMANDS__?.moveSelectedTo;
              if (typeof run !== "function") throw new Error("STRUCTURE_COMMAND_UNAVAILABLE:moveSelectedTo");
              return run({ parentElementId, beforeElementId });
            },
            {
              parentElementId: target.destinationParentId,
              beforeElementId: target.destinationBeforeElementId,
            },
          );
          failUnless(moved === true, "FROZEN_MOVE_COMMAND_REFUSED", { moved });
        }, after => bindFrozenMove(currentBytes, after, {
          copyId: copyTarget.selectedId,
          destinationParentId: target.destinationParentId,
          originalParentId: target.copyBinding.parentId,
        }), "move-copy");
        failUnless(await frozenFrameAccess(frame, copyTarget, calls).target(copyTarget.selectedId)
          .evaluate((element, parentId) => element.parentElement?.getAttribute("data-stemmio-id") === parentId,
            target.destinationParentId), "FROZEN_MOVE_DISPLAY_PARENT_MISMATCH");
        return result;
      });
    }
    await record("select-copy-for-delete", { id: copyTarget.selectedId }, async () => {
      await page.keyboard.press("Escape");
      await editor.evaluate(element => element.dispatchEvent(new Event("stemmio:e2e-copy-capability-probe")));
      failUnless(await editor.getAttribute("data-e2e-copy-native-edit-ended") === "true", "COPY_EDIT_SESSION_NOT_ENDED");
      return selectCopy(await currentKnownPrior([copyTarget.selectedId]));
    });
    await record("delete-copy", { sourceRestored: frozenDigest(baseline) }, async () => {
      const expectedLandingId = resolveFrozenDeleteSelectionLanding(
        buildSourceIndex(currentBytes.toString("utf8")),
        copyTarget.selectedId,
      );
      const toolbarLabel = await editor.getByRole("toolbar").getAttribute("aria-label");
      const deleteTargetLabel = typeof toolbarLabel === "string"
        ? toolbarLabel.replace(/^(?:编辑|评论)/u, "") : "";
      failUnless(deleteTargetLabel.length > 0, "DELETE_TARGET_LABEL_MISSING", { toolbarLabel });
      const result = await rebuild(() => withExpectedDeleteConfirmation(page, async () => {
        await editor.getByRole("button", { name: "删除元素", exact: true }).click({ timeout: 2_000 });
      }, { targetText: deleteTargetLabel }), after => {
        const restored = after.equals(baseline);
        failUnless(restored, "DELETE_COPY_SOURCE_NOT_RESTORED", { restored,
          expectedSha256: frozenDigest(baseline), actualSha256: frozenDigest(after),
          actualChangedRanges: byteChanges(currentBytes, after), remainingChanges: byteChanges(baseline, after) });
        return { restored };
      }, "delete-copy");
      failUnless(await frozenFrameAccess(frame, copyTarget, calls).target(copyTarget.selectedId).count() === 0, "DELETED_COPY_STILL_PRESENT");
      const original = frozenFrameAccess(frame, target, calls).target(target.selectedId);
      failUnless(await original.count() === 1 && await original.textContent() === originalText, "ORIGINAL_IDENTITY_CHANGED");
      const selected = frame.locator("[data-html-canvas-selected]");
      const selectedCount = await selected.count();
      failUnless(selectedCount <= 1, "FROZEN_SELECTION_NOT_UNIQUE", { selectedCount });
      selectionAfterDelete = selectedCount === 1
        ? await selected.getAttribute("data-stemmio-id")
        : null;
      failUnless(selectionAfterDelete === expectedLandingId, "FROZEN_DELETE_SELECTION_LANDING_MISMATCH", {
        expectedLandingId,
        actualLandingId: selectionAfterDelete,
      });
      return { ...result, selectionAfterDelete };
    });
    if (target.continuationProbe) await record("probe-after-delete", { mode: target.continuationProbe }, () =>
      probeFrozenEndedContinuation({ page, frame, editor, target, readSource, calls, marker: `PRDIRECT_${fileId}_DELETE` }));
    if (closedLoop) {
      await record("undo-delete", { copyPresent: true }, async () => {
        const result = await rebuild(() => clickEditHistoryMenu(electronApp, page, "undo"), after => {
          failUnless(!after.equals(baseline) && after.toString().includes(marker), "UNDO_DELETE_DID_NOT_RESTORE_COPY", {
            equalsBaseline: after.equals(baseline), containsMarker: after.toString().includes(marker),
          });
          return { restored: true };
        }, "undo-delete");
        failUnless(await frozenFrameAccess(frame, copyTarget, calls).target(copyTarget.selectedId).count() === 1,
          "UNDO_DELETE_COPY_MISSING");
        return result;
      });
      await record("activate-restored", { editableId: copyTarget.selectedId }, () => activateCopyLeaf());
      await record("input-restored", { appended: restoredMarker }, async () => {
        await sameDocument(); await requireFrozenTextFocus(handle, copyTarget.selectedId, { atEnd: true });
        await page.keyboard.type(restoredMarker);
        failUnless((await handle.textContent()).includes(restoredMarker), "FROZEN_RESTORED_INPUT_LANDING_MISMATCH");
        await sameDocument(); return { appended: restoredMarker, id: copyTarget.selectedId };
      });
      await record("save-restored", { sourceContains: restoredMarker }, async () => {
        const persist = page.locator("[data-persist-state]").first();
        const beforeRevision = Number(await persist.getAttribute("data-persisted-revision"));
        await page.keyboard.press(keyShortcut("s"));
        await expect.poll(async () => (await readSource()).includes(restoredMarker), { timeout: 5_000 }).toBe(true);
        await expect(persist).toHaveAttribute("data-persist-state", "idle", { timeout: 30_000 });
        const persistedRevision = Number(await persist.getAttribute("data-persisted-revision"));
        const editRevision = Number(await persist.getAttribute("data-edit-revision"));
        failUnless(editRevision === persistedRevision && persistedRevision >= beforeRevision,
          "RESTORED_SAVE_NOT_ACKNOWLEDGED", { beforeRevision, editRevision, persistedRevision });
        restoredBytes = await readSource();
        failUnless(restoredBytes.toString().includes(marker), "RESTORED_COPY_LOST_FIRST_EDIT");
        currentBytes = restoredBytes;
        return { restoredSha256: frozenDigest(restoredBytes), persistedRevision };
      });
      await record("restore-baseline", { sourceRestored: frozenDigest(baseline) }, async () => {
        await page.keyboard.press("Escape");
        await editor.evaluate(element => element.dispatchEvent(new Event("stemmio:e2e-copy-capability-probe")));
        failUnless(await editor.getAttribute("data-e2e-copy-native-edit-ended") === "true", "COPY_EDIT_SESSION_NOT_ENDED");
        const walked = await walkHistory("undo", baseline, "RESTORE_BASELINE_FAILED");
        failUnless(await frozenFrameAccess(frame, copyTarget, calls).target(copyTarget.selectedId).count() === 0,
          "BASELINE_STILL_HAS_COPY");
        return walked;
      });
      await record("redo-to-restored", { sourceRestored: frozenDigest(restoredBytes) }, async () => {
        const walked = await walkHistory("redo", restoredBytes, "REDO_TO_RESTORED_FAILED");
        failUnless(await frozenFrameAccess(frame, copyTarget, calls).target(copyTarget.selectedId).count() === 1,
          "REDO_RESTORED_COPY_MISSING");
        return walked;
      });
    }
    requireTextOperationLedger(rows, target.operations);
    return {
      finalSha256: frozenDigest(currentBytes), finalSize: currentBytes.length, originalText,
      copyId: copyTarget.selectedId, restoredMarker: closedLoop ? restoredMarker : null,
      reopenCopyPresent: closedLoop, selectionAfterDelete,
    };
  } finally { await handle?.dispose(); await documentHandle?.dispose(); }
}

export async function executeFrozenStructurePathRace({ plan, page, editor, readSource, rows, calls }) {
  const copies = [];
  for (const target of plan.targets) {
    const active = editor.locator('iframe[data-runtime-slot-role="active"]');
    failUnless(await active.count() === 1, "FROZEN_ACTIVE_FRAME_NOT_UNIQUE");
    const frame = await (await active.elementHandle()).contentFrame();
    failUnless(frame, "FROZEN_ACTIVE_FRAME_MISSING");
    const selected = frame.locator("[data-html-canvas-selected]");
    const count = await selected.count();
    failUnless(count <= 1, "FROZEN_SELECTION_NOT_UNIQUE", { count });
    const prior = count === 1 ? await selected.getAttribute("data-stemmio-id") : null;
    await executeFrozenSelection({
      access: frozenFrameAccess(frame, target, calls),
      keyboard: page.keyboard,
      mouse: page.mouse,
      target,
      calls,
      priorSelectionId: prior,
    });
    const result = await executeFrozenStructure({
      frame, target, page, editor, fileId: plan.fileId, readSource, rows, calls,
    });
    copies.push({
      originalId: target.selectedId,
      copyId: result.copyId,
      expectedProjection: target.expectedProjection,
    });
  }
  await waitForRuntimeHandoffSettled(page, { timeout: 10_000 });
  const active = editor.locator('iframe[data-runtime-slot-role="active"]');
  failUnless(await active.count() === 1, "FROZEN_ACTIVE_FRAME_NOT_UNIQUE");
  failUnless(await editor.locator('iframe[data-runtime-slot-role="candidate"]').count() === 0,
    "STALE_CANDIDATE_STILL_PRESENT");
  const frame = await (await active.elementHandle()).contentFrame();
  const after = await readSource();
  const working = await editor.getAttribute("data-working-source-sha256");
  const displayed = await editor.getAttribute("data-rendered-projection-sha256");
  failUnless(working === displayed && working === `sha256:${frozenDigest(after)}`,
    "FROZEN_PATH_RACE_SOURCE_DISPLAY_DRIFT", { working, displayed, source: frozenDigest(after) });
  for (const copy of copies) {
    failUnless(await frame.locator(`[data-stemmio-id="${copy.originalId}"]`).count() === 1,
      "PATH_RACE_ORIGINAL_MISSING", copy);
    failUnless(await frame.locator(`[data-stemmio-id="${copy.copyId}"]`).count() === 1,
      "PATH_RACE_COPY_MISSING", copy);
    failUnless(after.toString("utf8").includes(copy.originalId) && after.toString("utf8").includes(copy.copyId),
      "PATH_RACE_SOURCE_IDENTITY_MISSING", copy);
  }
  return {
    finalSha256: frozenDigest(after),
    finalSize: after.length,
    copies,
    reopenCopyPresent: true,
  };
}

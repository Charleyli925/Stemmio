import { expect } from "@playwright/test";

import {
  buildSourceIndex,
  createTargetRef,
} from "../../../../app/lib/source-patch-core.js";
import { isEditableIslandTarget } from "../../../../app/lib/editable-island.js";
import { CAPABILITY_STABLE_ID_PATTERN } from "./capability-manifest.mjs";

const TEXT_TAGS = new Set([
  "address", "blockquote", "caption", "dd", "dt", "figcaption", "h1", "h2",
  "h3", "h4", "h5", "h6", "label", "legend", "li", "p", "pre", "summary",
  "td", "th",
]);
const CONTROL_TAGS = new Set(["a", "button", "input", "option", "select", "textarea"]);
const MEDIA_TAGS = new Set(["audio", "canvas", "embed", "iframe", "img", "object", "svg", "video"]);
const TABLE_TAGS = new Set(["table", "tbody", "tfoot", "thead", "tr", "td", "th"]);
const LIST_TAGS = new Set(["dl", "ol", "ul", "li", "dd", "dt"]);

export function majorElementType(tagName) {
  const tag = String(tagName || "").toLowerCase();
  if (TEXT_TAGS.has(tag)) return "text";
  if (CONTROL_TAGS.has(tag)) return "control";
  if (MEDIA_TAGS.has(tag)) return "media";
  if (TABLE_TAGS.has(tag)) return "table";
  if (LIST_TAGS.has(tag)) return "list";
  if (["form", "fieldset"].includes(tag)) return "form";
  return "container";
}

export function authoredTabActivationDecision(snapshot) {
  if (snapshot.tabCount !== 1) {
    return { state: "failed", reason: "TAB_STABLE_ID_NOT_UNIQUE" };
  }
  if (snapshot.active === true) return { state: "active", reason: "TAB_ALREADY_ACTIVE" };
  if (snapshot.activationButtonCount > 1) {
    return { state: "failed", reason: "TAB_ACTIVATION_ACTION_AMBIGUOUS" };
  }
  if (
    snapshot.activationButtonCount === 1
    && snapshot.activationButtonVisible === true
    && snapshot.activationButtonEnabled === true
  ) return { state: "activate", reason: "TAB_ACTIVATION_ACTION_READY" };
  return { state: "pending", reason: "TAB_ACTIVATION_PENDING" };
}

export async function driveAuthoredTabActivation({
  readState,
  prepareSelection,
  selectTab,
  activateTab,
  timeoutMs = 5_000,
  pollIntervalMs = 25,
}) {
  const deadline = Date.now() + timeoutMs;
  let selected = false;
  try {
    await prepareSelection();
  } catch (cause) {
    const error = new Error("The previous selection did not settle before tab activation.");
    error.code = "TAB_ACTIVATION_NOT_SETTLED";
    error.details = {
      phase: "prepare-selection",
      causeCode: cause?.code || null,
      cause: String(cause?.message || cause),
    };
    throw error;
  }
  let latest = await readState();
  let lastActionError = null;
  while (Date.now() <= deadline) {
    const decision = authoredTabActivationDecision(latest);
    if (decision.state === "active") return { decision, snapshot: latest };
    if (decision.state === "failed") {
      const error = new Error("The authored tab activation state was ambiguous.");
      error.code = decision.reason;
      error.details = latest;
      throw error;
    }
    if (!selected) {
      try {
        await selectTab();
        selected = true;
      } catch (cause) {
        const error = new Error("The authored tab could not be selected for activation.");
        error.code = "TAB_ACTIVATION_NOT_SETTLED";
        error.details = {
          phase: "select-tab",
          causeCode: cause?.code || null,
          cause: String(cause?.message || cause),
        };
        throw error;
      }
    } else if (decision.state === "activate") {
      const confirmed = await readState();
      const confirmedDecision = authoredTabActivationDecision(confirmed);
      if (confirmedDecision.state === "active") {
        return { decision: confirmedDecision, snapshot: confirmed };
      }
      if (confirmedDecision.state === "activate") {
        try {
          await activateTab();
          lastActionError = null;
        } catch (cause) {
          lastActionError = String(cause?.message || cause);
        }
      }
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    latest = await readState();
  }
  const error = new Error("The authored tab did not reach its active terminal state.");
  error.code = "TAB_ACTIVATION_NOT_SETTLED";
  error.details = {
    decision: authoredTabActivationDecision(latest),
    snapshot: latest,
    lastActionError,
  };
  throw error;
}

export function sourceElementsForCapabilityManifest(source) {
  const index = buildSourceIndex(source);
  return index.elements.map((element, sourceOrder) => {
    let sourceEditable = false;
    if (element.stemmioIdentityStatus === "valid") {
      try {
        sourceEditable = isEditableIslandTarget(
          index,
          createTargetRef(index, element, { level: "subregion" }),
        ).editable;
      } catch {
        sourceEditable = false;
      }
    }
    const parent = element.parentId ? index.byNodeId.get(element.parentId) : null;
    return {
      stemmioId: element.stemmioId,
      stemmioIdentityStatus: element.stemmioIdentityStatus,
      tagName: element.tagName,
      parentId: parent?.type === "element" ? parent.stemmioId || null : null,
      sourceOrder,
      sourceEditable,
      boundarySafe: element.boundarySafe === true,
    };
  });
}

export async function collectVisibleAuthoredCandidates(frame, sourceElements, tabId = null) {
  return frame.locator("[data-stemmio-id]").evaluateAll((elements, payload) => {
    const sourceById = new Map(payload.sourceElements.map((entry) => [entry.stemmioId, entry]));
    const viewportHeight = Math.max(
      document.documentElement?.scrollHeight || 0,
      document.body?.scrollHeight || 0,
      innerHeight,
    );
    const regionFor = (rect) => {
      const center = scrollY + rect.top + rect.height / 2;
      if (center < viewportHeight / 3) return "top";
      if (center < viewportHeight * 2 / 3) return "middle";
      return "bottom";
    };
    const scrollContainerFor = (element) => {
      let ancestor = element.parentElement;
      while (ancestor && ancestor !== document.body) {
        const style = getComputedStyle(ancestor);
        if (/(?:auto|scroll)/u.test(`${style.overflowY} ${style.overflow}`)
          && ancestor.scrollHeight > ancestor.clientHeight + 1) {
          return ancestor.getAttribute("data-stemmio-id") || "nested-authored-scroller";
        }
        ancestor = ancestor.parentElement;
      }
      return "document";
    };
    return elements.map((element) => {
      const stableId = element.getAttribute("data-stemmio-id");
      const source = sourceById.get(stableId);
      if (!source) return null;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      const hidden = element.hasAttribute("hidden")
        || element.closest('[aria-hidden="true"], [hidden]') != null
        || style.display === "none"
        || style.visibility === "hidden"
        || Number(style.opacity || 1) === 0
        || rect.width <= 1
        || rect.height <= 1
        || element.getClientRects().length === 0;
      return {
        stableId,
        tag: element.localName,
        sourceOrder: source.sourceOrder,
        sourceEditable: source.sourceEditable === true,
        visible: !hidden,
        isConnected: element.isConnected,
        inert: element.closest("[inert]") != null,
        runtimeGenerated: false,
        tabId: payload.tabId,
        region: regionFor(rect),
        scrollContainer: scrollContainerFor(element),
      };
    }).filter(Boolean);
  }, { sourceElements, tabId });
}

async function authoredHitTest(frame, target, sourceElements) {
  const sampled = await target.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const fractions = [0.08, 0.2, 0.5, 0.8, 0.92];
    const descendantStableIds = new Set();
    const exactPoints = [];
    let sampleCount = 0;
    let blockedHitKind = null;
    for (const yFraction of fractions) {
      for (const xFraction of fractions) {
        const x = rect.left + Math.max(1, rect.width * xFraction);
        const y = rect.top + Math.max(1, rect.height * yFraction);
        if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) continue;
        sampleCount += 1;
        const hit = element.ownerDocument.elementFromPoint(x, y);
        if (hit?.closest("[data-stemmio-id]") === element) {
          exactPoints.push({
            targetX: x - rect.left,
            targetY: y - rect.top,
            clientX: x,
            clientY: y,
          });
          continue;
        }
        const stableHit = hit?.closest?.("[data-stemmio-id]") || null;
        const stableId = stableHit?.getAttribute("data-stemmio-id") || null;
        if (
          !hit
          || !stableHit
          || !stableId
          || stableHit === element
          || !element.contains(stableHit)
          || !element.contains(hit)
        ) {
          blockedHitKind ||= stableHit ? "stable-id-non-descendant" : hit?.localName || "no-hit";
          continue;
        }
        descendantStableIds.add(stableId);
      }
    }
    if (exactPoints.length > 0) {
      return {
        kind: "exact",
        points: exactPoints,
        pointCount: exactPoints.length,
      };
    }
    return {
      kind: blockedHitKind || descendantStableIds.size === 0
        ? "blocked"
        : "descendant-candidate",
      sampleCount,
      descendantStableIds: [...descendantStableIds].sort(),
      hitKind: blockedHitKind,
    };
  });
  if (sampled.kind === "exact") return sampled;
  if (
    sampled.kind !== "descendant-candidate"
    || !Number.isInteger(sampled.sampleCount)
    || sampled.sampleCount <= 0
    || sampled.descendantStableIds.length === 0
  ) return { ...sampled, kind: "blocked" };
  const targetStableId = await target.getAttribute("data-stemmio-id");
  for (const descendantStableId of sampled.descendantStableIds) {
    if (!CAPABILITY_STABLE_ID_PATTERN.test(descendantStableId)) {
      return { ...sampled, kind: "blocked", hitKind: "invalid-descendant-stable-id" };
    }
    const relationship = canonicalSourceRelationship(
      sourceElements,
      descendantStableId,
      targetStableId,
    );
    if (
      !relationship.validProbe
      || !relationship.validOperation
      || !relationship.sourceAncestor
      || await frame.locator(
        `[data-stemmio-id=${JSON.stringify(descendantStableId)}]`,
      ).count() !== 1
    ) {
      return { ...sampled, kind: "blocked", hitKind: "unproven-descendant" };
    }
  }
  const coverage = await target.evaluate((element, descendantStableIds) => {
    const targetRects = [...element.getClientRects()];
    if (targetRects.length !== 1) return null;
    const targetRect = targetRects[0];
    const epsilon = 0.5;
    const safePointerBox = (candidate) => {
      if (!(candidate instanceof HTMLElement)) return false;
      const style = getComputedStyle(candidate);
      return style.display !== "none"
        && style.visibility !== "hidden"
        && style.pointerEvents !== "none"
        && style.transform === "none"
        && style.clipPath === "none"
        && style.maskImage === "none"
        && style.borderTopLeftRadius === "0px"
        && style.borderTopRightRadius === "0px"
        && style.borderBottomRightRadius === "0px"
        && style.borderBottomLeftRadius === "0px";
    };
    for (const stableId of descendantStableIds) {
      const matches = [...element.querySelectorAll("[data-stemmio-id]")]
        .filter((candidate) => candidate.getAttribute("data-stemmio-id") === stableId);
      if (matches.length !== 1 || !safePointerBox(matches[0])) continue;
      const descendantRects = [...matches[0].getClientRects()];
      if (descendantRects.length !== 1) continue;
      const rect = descendantRects[0];
      if (
        rect.left <= targetRect.left + epsilon
        && rect.top <= targetRect.top + epsilon
        && rect.right >= targetRect.right - epsilon
        && rect.bottom >= targetRect.bottom - epsilon
      ) {
        return {
          kind: "single-untransformed-hit-box",
          stableId,
        };
      }
    }
    return null;
  }, sampled.descendantStableIds);
  if (!coverage) {
    return {
      ...sampled,
      kind: "blocked",
      hitKind: "descendant-coverage-unproven",
    };
  }
  return {
    kind: "valid-descendant-occlusion",
    sampleCount: sampled.sampleCount,
    validSampleCount: sampled.sampleCount,
    descendantStableIds: sampled.descendantStableIds,
    sourceAncestorVerified: true,
    liveUniqueVerified: true,
    coverageVerified: true,
    coverageKind: coverage.kind,
    coverageStableId: coverage.stableId,
  };
}

async function pageSpaceAuthoredHitPoint({ frame, editor, target, sourceElements }) {
  const position = await authoredHitTest(frame, target, sourceElements);
  if (position.kind !== "exact") return position;
  const topLevel = typeof frame.mainFrame === "function";
  if (topLevel) {
    return {
      kind: "exact",
      points: position.points.map((point) => ({
        ...point,
        kind: "exact",
        pageX: point.clientX,
        pageY: point.clientY,
        topLevel,
      })),
    };
  }
  const frameGeometry = await editor.evaluate((root) => {
    const frames = root.querySelectorAll('iframe[data-runtime-slot-role="active"]');
    if (frames.length !== 1) return { count: frames.length };
    const iframe = frames[0];
    const rect = iframe.getBoundingClientRect();
    const scaleX = iframe.offsetWidth > 0 ? rect.width / iframe.offsetWidth : 1;
    const scaleY = iframe.offsetHeight > 0 ? rect.height / iframe.offsetHeight : 1;
    return {
      count: 1,
      contentLeft: rect.left + iframe.clientLeft * scaleX,
      contentTop: rect.top + iframe.clientTop * scaleY,
      scaleX,
      scaleY,
    };
  });
  if (frameGeometry.count !== 1) {
    const error = new Error("The capability probe did not find one active Runtime iframe.");
    error.code = "CAPABILITY_PROBE_ACTIVE_FRAME_NOT_UNIQUE";
    error.details = { activeFrameCount: frameGeometry.count };
    throw error;
  }
  return {
    kind: "exact",
    points: position.points.map((point) => ({
      ...point,
      kind: "exact",
      pageX: frameGeometry.contentLeft + point.clientX * frameGeometry.scaleX,
      pageY: frameGeometry.contentTop + point.clientY * frameGeometry.scaleY,
      topLevel,
    })),
  };
}

async function hostPointerSnapshot({
  editor,
  candidate,
  point,
  mode,
  expectedOperationStableId,
}) {
  return editor.evaluate((root, payload) => {
    const {
      stableId,
      hitPoint,
      probeMode,
      expectedOperationId,
    } = payload;
    const hit = document.elementFromPoint(hitPoint.pageX, hitPoint.pageY);
    if (hitPoint.topLevel) {
      return {
        accepted: hit?.closest("[data-stemmio-id]")?.getAttribute("data-stemmio-id") === stableId,
        hitKind: hit?.closest("[data-stemmio-id]") ? "authored-target" : hit?.localName || null,
      };
    }
    const activeFrame = root.querySelector('iframe[data-runtime-slot-role="active"]');
    const hint = hit?.closest?.('[data-testid="canvas-capability-hint"]');
    const activeGeneration = activeFrame?.getAttribute("data-frame-generation") || null;
    const hintTargetId = hint?.getAttribute("data-capability-target-id") || null;
    const hintTargetKey = hint?.getAttribute("data-capability-target-key") || null;
    const hintTargetDomGeneration = hint?.getAttribute(
      "data-capability-target-dom-generation",
    ) || null;
    const hintCurrentDomGeneration = hint?.getAttribute(
      "data-capability-current-dom-generation",
    ) || null;
    const hintActiveFrameGeneration = hint?.getAttribute(
      "data-capability-active-frame-generation",
    ) || null;
    const frameDocument = activeFrame?.contentDocument || null;
    const probeElement = frameDocument
      ? Array.from(frameDocument.querySelectorAll("[data-stemmio-id]"))
        .find((element) => element.getAttribute("data-stemmio-id") === stableId) || null
      : null;
    const hintedOperationElement = frameDocument && hintTargetId
      ? Array.from(frameDocument.querySelectorAll("[data-stemmio-id]"))
        .find((element) => element.getAttribute("data-stemmio-id") === hintTargetId) || null
      : null;
    const hintMapsProbeToOperation = Boolean(
      probeElement
      && hintedOperationElement
      && hintedOperationElement.contains(probeElement)
      && (probeMode === "discover"
        || hintTargetId === expectedOperationId),
    );
    const validGeneration = (value) => Boolean(
      typeof value === "string"
      && /^(?:0|[1-9]\d*)$/u.test(value)
      && Number.isSafeInteger(Number(value)),
    );
    const exactCapabilityHint = Boolean(
      activeFrame
      && hint
      && hintMapsProbeToOperation
      && hintTargetKey === `element:${hintTargetId}`
      && validGeneration(activeGeneration)
      && validGeneration(hintTargetDomGeneration)
      && validGeneration(hintCurrentDomGeneration)
      && validGeneration(hintActiveFrameGeneration)
      && hintTargetDomGeneration === hintCurrentDomGeneration
      && hintActiveFrameGeneration === activeGeneration
    );
    return {
      accepted: Boolean(activeFrame && (hit === activeFrame || exactCapabilityHint)),
      hitKind: hit === activeFrame
        ? "active-runtime-frame"
        : exactCapabilityHint
          ? "exact-capability-hint"
          : hint
            ? "capability-hint-identity-mismatch"
            : hit?.localName || null,
      activeGeneration,
      hintTargetId,
      hintTargetKey,
      hintTargetDomGeneration,
      hintCurrentDomGeneration,
      hintActiveFrameGeneration,
      hintedOperationContainsProbe: hintMapsProbeToOperation,
    };
  }, {
    stableId: candidate.stableId,
    hitPoint: point,
    probeMode: mode,
    expectedOperationId: expectedOperationStableId,
  });
}

export function canonicalSourceRelationship(sourceElements, probeStableId, operationStableId) {
  const elements = Array.isArray(sourceElements) ? sourceElements : [];
  const matches = (stableId) => elements.filter((element) => element?.stemmioId === stableId);
  const probeMatches = matches(probeStableId);
  const operationMatches = matches(operationStableId);
  const validProbe = CAPABILITY_STABLE_ID_PATTERN.test(probeStableId || "")
    && probeMatches.length === 1
    && probeMatches[0].stemmioIdentityStatus === "valid";
  const validOperation = CAPABILITY_STABLE_ID_PATTERN.test(operationStableId || "")
    && operationMatches.length === 1
    && operationMatches[0].stemmioIdentityStatus === "valid";
  let sourceAncestor = validProbe && validOperation;
  if (sourceAncestor && probeStableId !== operationStableId) {
    const byId = new Map();
    for (const element of elements) {
      if (!element?.stemmioId) continue;
      const group = byId.get(element.stemmioId) || [];
      group.push(element);
      byId.set(element.stemmioId, group);
    }
    let parentId = probeMatches[0].parentId || null;
    sourceAncestor = false;
    const visited = new Set();
    while (parentId && !visited.has(parentId)) {
      const parentMatches = byId.get(parentId) || [];
      if (
        parentMatches.length !== 1
        || parentMatches[0].stemmioIdentityStatus !== "valid"
      ) break;
      if (parentId === operationStableId) {
        sourceAncestor = true;
        break;
      }
      visited.add(parentId);
      parentId = parentMatches[0].parentId || null;
    }
  }
  return {
    validProbe,
    validOperation,
    sourceAncestor,
    probe: probeMatches[0] || null,
    operation: operationMatches[0] || null,
  };
}

export function classifyCapabilityProbeFailure(cause) {
  if (typeof cause?.code === "string" && cause.code.length > 0) {
    return { code: cause.code, reasonClass: "EXPLICIT_CODE", errorName: cause?.name || null };
  }
  const name = typeof cause?.name === "string" ? cause.name : null;
  const message = String(cause?.message || "");
  const classification = /timeout/iu.test(`${name || ""} ${message}`)
    ? ["CAPABILITY_PROBE_TIMEOUT", "TIMEOUT"]
    : /strict mode|resolved to \d+ elements/iu.test(message)
      ? ["CAPABILITY_PROBE_LOCATOR_AMBIGUOUS", "LOCATOR_AMBIGUOUS"]
      : /not attached|detached/iu.test(message)
        ? ["CAPABILITY_PROBE_TARGET_DETACHED", "TARGET_DETACHED"]
        : /target page, context or browser has been closed|execution context was destroyed/iu.test(message)
          ? ["CAPABILITY_PROBE_CONTEXT_CLOSED", "CONTEXT_CLOSED"]
          : ["CAPABILITY_PROBE_UNCLASSIFIED_ERROR", "UNCLASSIFIED_ERROR"];
  return { code: classification[0], reasonClass: classification[1], errorName: name };
}

export function capabilityObservationSnapshot(entry) {
  return {
    capabilityFamilies: [...(entry.capabilityFamilies || [])].sort(),
    behaviorFamilies: [...(entry.behaviorFamilies || [])].sort(),
    copyAvailability: entry.copyAvailability || null,
    copyReason: entry.copyReason || null,
    runtimeGenerated: entry.runtimeGenerated === true,
    tag: entry.tag || null,
    sourceEditable: entry.sourceEditable === true,
    region: entry.region || null,
    scrollContainer: entry.scrollContainer || null,
  };
}

export function normalizeCapabilityProbeObservations(
  observations,
  { allowConflicts = false } = {},
) {
  const preProbeRejectionReasons = new Set([
    "HIDDEN_ELEMENT",
    "LIVE_DUPLICATE_STABLE_ID",
    "NO_EXACT_HIT_POINT",
  ]);
  const passthrough = [];
  const denominatorExclusions = [];
  const groups = new Map();
  for (const observation of observations || []) {
    const canonicalObservation = (
      CAPABILITY_STABLE_ID_PATTERN.test(observation?.probeStableId || "")
      && CAPABILITY_STABLE_ID_PATTERN.test(observation?.operationStableId || "")
      && observation.stableId === observation.operationStableId
    );
    if (!canonicalObservation) {
      if (observation?.probeReason === "AUTHORED_DESCENDANT_OCCLUSION") {
        const hitTest = observation?.hitTest;
        const descendantStableIds = hitTest?.descendantStableIds;
        const completeHitTest = Boolean(
          CAPABILITY_STABLE_ID_PATTERN.test(observation?.stableId || "")
          && hitTest?.kind === "valid-descendant-occlusion"
          && Number.isInteger(hitTest.sampleCount)
          && hitTest.sampleCount > 0
          && hitTest.validSampleCount === hitTest.sampleCount
          && hitTest.sourceAncestorVerified === true
          && hitTest.liveUniqueVerified === true
          && hitTest.coverageVerified === true
          && hitTest.coverageKind === "single-untransformed-hit-box"
          && CAPABILITY_STABLE_ID_PATTERN.test(hitTest.coverageStableId || "")
          && Array.isArray(descendantStableIds)
          && descendantStableIds.length > 0
          && new Set(descendantStableIds).size === descendantStableIds.length
          && descendantStableIds.every((stableId) => (
            CAPABILITY_STABLE_ID_PATTERN.test(stableId)
            && stableId !== observation.stableId
          ))
          && descendantStableIds.includes(hitTest.coverageStableId)
          && !observation?.probeStableId
          && !observation?.operationStableId
          && (observation?.capabilityFamilies?.length || 0) === 0
          && (observation?.behaviorFamilies?.length || 0) === 0
        );
        if (!completeHitTest) {
          const error = new Error("Authored denominator exclusion is missing complete hit-test proof.");
          error.code = "CAPABILITY_PROBE_DENOMINATOR_EXCLUSION_INVALID";
          error.details = {
            stableId: CAPABILITY_STABLE_ID_PATTERN.test(observation?.stableId || "")
              ? observation.stableId
              : null,
            probeReason: observation?.probeReason || null,
          };
          throw error;
        }
        denominatorExclusions.push({
          elementId: observation.stableId,
          reason: observation.probeReason,
          descendantStableIds: [...descendantStableIds],
          hitTest: {
            sampleCount: hitTest.sampleCount,
            validSampleCount: hitTest.validSampleCount,
            sourceAncestorVerified: true,
            liveUniqueVerified: true,
            coverageVerified: true,
            coverageKind: hitTest.coverageKind,
            coverageStableId: hitTest.coverageStableId,
          },
        });
        continue;
      }
      const explicitPreProbeRejection = (
        preProbeRejectionReasons.has(observation?.probeReason)
        && !observation?.probeStableId
        && !observation?.operationStableId
        && (observation?.capabilityFamilies?.length || 0) === 0
        && (observation?.behaviorFamilies?.length || 0) === 0
      );
      if (explicitPreProbeRejection) {
        passthrough.push(observation);
        continue;
      }
      const error = new Error("Capability observation is missing a valid canonical identity.");
      error.code = "CAPABILITY_PROBE_CANONICAL_IDENTITY_INVALID";
      error.details = {
        stableId: observation?.stableId || null,
        probeStableId: observation?.probeStableId || null,
        operationStableId: observation?.operationStableId || null,
        probeReason: observation?.probeReason || null,
      };
      throw error;
    }
    const group = groups.get(observation.stableId) || [];
    group.push(observation);
    groups.set(observation.stableId, group);
  }
  const liveDom = [];
  const aliases = [];
  const conflicts = [];
  for (const [operationStableId, group] of groups) {
    const observationsByProbe = group.map((entry) => ({
      probeStableId: entry.probeStableId,
      snapshot: capabilityObservationSnapshot(entry),
    }));
    const signatures = new Set(observationsByProbe.map(({ snapshot }) => JSON.stringify(snapshot)));
    if (signatures.size > 1) {
      const conflict = {
        operationStableId,
        probeStableIds: group.map((entry) => entry.probeStableId),
        observations: observationsByProbe,
      };
      if (allowConflicts) {
        conflicts.push(conflict);
      } else {
      const error = new Error("Canonical probe aliases observed conflicting operation capabilities.");
      error.code = "CAPABILITY_PROBE_ALIAS_CAPABILITY_CONFLICT";
      error.details = conflict;
      throw error;
      }
    }
    group.sort((left, right) => (
      Number(right.probeStableId === operationStableId)
      - Number(left.probeStableId === operationStableId)
      || Number(left.probeSourceOrder ?? Number.MAX_SAFE_INTEGER)
      - Number(right.probeSourceOrder ?? Number.MAX_SAFE_INTEGER)
      || String(left.probeStableId || "").localeCompare(String(right.probeStableId || ""))
    ));
    liveDom.push(group[0]);
    for (const entry of group) {
      if (entry.probeStableId !== operationStableId) {
        aliases.push({
          probeStableId: entry.probeStableId,
          operationStableId,
        });
      }
    }
  }
  return {
    liveDom: [...passthrough, ...liveDom],
    aliases,
    conflicts,
    denominatorExclusions,
  };
}

function behaviorFamiliesFor(capabilities) {
  const families = new Set(["activation", "persistence", "stable-id"]);
  if (capabilities.includes("text")) {
    for (const family of ["input", "backspace", "delete-key", "enter", "selection-replace", "undo-redo", "paste", "source-scope"]) {
      families.add(family);
    }
  }
  if (capabilities.includes("format")) {
    for (const family of [
      "bold",
      "italic",
      "underline",
      "font-size",
      "text-color",
      "fill-color",
      "padding",
      "margin",
      "line-height",
    ]) families.add(family);
  }
  if (capabilities.includes("comment")) {
    for (const family of ["comment-create", "comment-edit", "comment-delete", "comment-reopen"]) families.add(family);
  }
  if (capabilities.includes("copy")) {
    for (const family of ["duplicate", "delete-duplicate"]) families.add(family);
    if (capabilities.includes("text")) families.add("edit-duplicate");
  }
  if (capabilities.some((value) => value.startsWith("move-"))) families.add("move");
  return [...families];
}

const RUNTIME_GENERATED_DISCOVERY_SELECTOR = [
  "table",
  "td",
  "th",
  "svg",
  "canvas",
  "[data-chart]",
  "[data-chart-root]",
  "[data-echarts]",
  "[role='img']",
].join(", ");

const RUNTIME_PROBE_SUBSTAGES = Object.freeze({
  SELECTION_CLEAR: "selection-clear",
  TARGET_SCROLL: "target-scroll",
  TARGET_CLICK: "target-click",
  DIAGNOSTIC_READ: "diagnostic-read",
  DIAGNOSTIC_VALIDATE: "diagnostic-validate",
  DIAGNOSTIC_TARGET_MATCH: "diagnostic-target-match",
});

function safeRuntimeProbeCode(value, fallback) {
  return typeof value === "string" && /^[A-Z0-9_.:-]{1,120}$/u.test(value)
    ? value
    : fallback;
}

function safeRuntimeProbeTag(value) {
  return typeof value === "string" && /^[a-z][a-z0-9-]{0,31}$/u.test(value)
    ? value
    : null;
}

function safeRuntimeProbeGeneration(value) {
  return typeof value === "string" && /^(?:0|[1-9]\d*)$/u.test(value)
    ? value
    : null;
}

function safeRuntimeProbeHitKind(value) {
  return typeof value === "string" && /^[a-z][a-z0-9-]{0,63}$/u.test(value)
    ? value
    : null;
}

async function runtimeProbeContext({ editor, target, targetIndex }) {
  const [targetTag, connected, activeFrameCount] = await Promise.all([
    target.evaluate((element) => element.localName).catch(() => null),
    target.evaluate((element) => element.isConnected).catch(() => null),
    editor.locator('iframe[data-runtime-slot-role="active"]')
      .count()
      .catch(() => 0),
  ]);
  const frameGeneration = activeFrameCount === 1
    ? await editor.locator('iframe[data-runtime-slot-role="active"]')
      .getAttribute("data-frame-generation")
      .catch(() => null)
    : null;
  return {
    targetIndex: Number.isInteger(targetIndex) ? targetIndex : null,
    targetTag: safeRuntimeProbeTag(targetTag),
    connected: typeof connected === "boolean" ? connected : null,
    frameGeneration: safeRuntimeProbeGeneration(frameGeneration),
  };
}

function recordRuntimeProbeFailure(diagnostics, context, {
  substage,
  code,
  hitKind = null,
  diagnostic = false,
} = {}) {
  if (!diagnostic) diagnostics.probeFailureCount += 1;
  else diagnostics.rejectedDiagnosticCount += 1;
  if (diagnostics.firstFailure) return;
  diagnostics.firstFailure = {
    substage: typeof substage === "string" ? substage : null,
    code: safeRuntimeProbeCode(code, "RUNTIME_GENERATED_PROBE_FAILED"),
    targetIndex: context?.targetIndex ?? null,
    targetTag: context?.targetTag || null,
    connected: context?.connected ?? null,
    frameGeneration: context?.frameGeneration || null,
    hitKind: safeRuntimeProbeHitKind(hitKind),
  };
}

function recordRuntimeProbeUnreachable(diagnostics, context) {
  diagnostics.unreachableCandidateCount += 1;
  diagnostics.firstUnreachable ||= {
    targetIndex: context?.targetIndex ?? null,
    targetTag: context?.targetTag || null,
    connected: context?.connected ?? null,
    frameGeneration: context?.frameGeneration || null,
    reason: "NO_INNER_FRAME_HIT_POINT",
  };
}

async function pageSpaceRuntimeHitPoint({ frame, editor, target }) {
  const points = await target.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const fractions = [0.08, 0.2, 0.5, 0.8, 0.92];
    const hitPoints = [];
    for (const yFraction of fractions) {
      for (const xFraction of fractions) {
        const clientX = rect.left + Math.max(1, rect.width * xFraction);
        const clientY = rect.top + Math.max(1, rect.height * yFraction);
        if (clientX < 0 || clientY < 0 || clientX >= innerWidth || clientY >= innerHeight) {
          continue;
        }
        const hit = element.ownerDocument.elementFromPoint(clientX, clientY);
        if (hit === element || (hit && element.contains(hit))) {
          hitPoints.push({
            clientX,
            clientY,
            hitKind: hit === element ? "target" : "target-descendant",
          });
        }
      }
    }
    return hitPoints;
  });
  if (points.length === 0) return null;
  const topLevel = typeof frame.mainFrame === "function";
  if (topLevel) {
    return {
      points: points.map((point) => ({
        ...point,
        pageX: point.clientX,
        pageY: point.clientY,
        topLevel,
      })),
    };
  }
  const frameGeometry = await editor.evaluate((root) => {
    const frames = root.querySelectorAll('iframe[data-runtime-slot-role="active"]');
    if (frames.length !== 1) return { count: frames.length };
    const activeFrame = frames[0];
    const rect = activeFrame.getBoundingClientRect();
    const scaleX = activeFrame.offsetWidth > 0 ? rect.width / activeFrame.offsetWidth : 1;
    const scaleY = activeFrame.offsetHeight > 0 ? rect.height / activeFrame.offsetHeight : 1;
    return {
      count: 1,
      contentLeft: rect.left + activeFrame.clientLeft * scaleX,
      contentTop: rect.top + activeFrame.clientTop * scaleY,
      scaleX,
      scaleY,
    };
  });
  if (frameGeometry.count !== 1) return null;
  return {
    points: points.map((point) => ({
      ...point,
      pageX: frameGeometry.contentLeft + point.clientX * frameGeometry.scaleX,
      pageY: frameGeometry.contentTop + point.clientY * frameGeometry.scaleY,
      topLevel,
    })),
  };
}

async function runtimeHitStillSafe({ editor, target, point }) {
  const frameHitStillSafe = await target.evaluate((element, hitPoint) => {
    const hit = element.ownerDocument.elementFromPoint(hitPoint.clientX, hitPoint.clientY);
    return hit === element || Boolean(hit && element.contains(hit));
  }, point).catch(() => false);
  if (!frameHitStillSafe) {
    return { accepted: false, hitKind: "target-moved" };
  }
  if (point.topLevel) return { accepted: true, hitKind: point.hitKind };
  return editor.evaluate((root, hitPoint) => {
    const frames = root.querySelectorAll('iframe[data-runtime-slot-role="active"]');
    const hit = document.elementFromPoint(hitPoint.pageX, hitPoint.pageY);
    return {
      accepted: frames.length === 1 && hit === frames[0],
      hitKind: frames.length !== 1
        ? "active-frame-not-unique"
        : hit === frames[0]
          ? "active-runtime-frame"
          : hit?.localName || "no-hit",
    };
  }, point);
}

export function runtimeGeneratedDiagnosticsIssue(diagnostics) {
  if (!Array.isArray(diagnostics) || diagnostics.length === 0) {
    return "RUNTIME_GENERATED_DIAGNOSTICS_MISSING";
  }
  if (diagnostics.some((entry) => entry.truncated === true)) {
    return "RUNTIME_GENERATED_DISCOVERY_TRUNCATED";
  }
  if (diagnostics.some((entry) => entry.probeFailureCount > 0)) {
    return "RUNTIME_GENERATED_PROBE_FAILED";
  }
  if (diagnostics.some((entry) => entry.rejectedDiagnosticCount > 0)) {
    return "RUNTIME_GENERATED_DIAGNOSTICS_INCOMPLETE";
  }
  return null;
}

export async function discoverRuntimeGeneratedTargets({ page, frame, editor, tabId = null }) {
  const candidates = frame.locator(RUNTIME_GENERATED_DISCOVERY_SELECTOR);
  const candidateCount = await candidates.count();
  const targets = [];
  const keys = new Set();
  const diagnostics = {
    candidateCount,
    truncated: candidateCount > 512,
    probedCount: 0,
    visibleCount: 0,
    runtimeGeneratedCount: 0,
    frozenTargetCount: 0,
    rejectedDiagnosticCount: 0,
    diagnosticTargetMismatchCount: 0,
    probeFailureCount: 0,
    unreachableCandidateCount: 0,
    firstUnreachable: null,
    firstFailure: null,
  };
  for (let index = 0; index < Math.min(candidateCount, 512); index += 1) {
    const target = candidates.nth(index);
    if (!await target.isVisible().catch(() => false)) continue;
    diagnostics.visibleCount += 1;
    const context = await runtimeProbeContext({
      editor,
      target,
      targetIndex: index,
    });
    try {
      await page.keyboard.press("Escape");
      await page.evaluate(() => new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
      }));
    } catch (cause) {
      recordRuntimeProbeFailure(diagnostics, context, {
        substage: RUNTIME_PROBE_SUBSTAGES.SELECTION_CLEAR,
        code: cause?.code || "RUNTIME_PROBE_SELECTION_CLEAR_FAILED",
      });
      continue;
    }
    let staleSelectionDiagnostic = null;
    try {
      staleSelectionDiagnostic = await editor.getAttribute("data-selection-runtime-generated");
    } catch (cause) {
      recordRuntimeProbeFailure(diagnostics, context, {
        substage: RUNTIME_PROBE_SUBSTAGES.DIAGNOSTIC_READ,
        code: cause?.code || "RUNTIME_PROBE_SELECTION_DIAGNOSTIC_READ_FAILED",
      });
      continue;
    }
    if (staleSelectionDiagnostic !== null) {
      recordRuntimeProbeFailure(diagnostics, context, {
        substage: RUNTIME_PROBE_SUBSTAGES.SELECTION_CLEAR,
        code: "RUNTIME_PROBE_SELECTION_NOT_CLEARED",
      });
      continue;
    }
    try {
      await target.scrollIntoViewIfNeeded();
    } catch (cause) {
      recordRuntimeProbeFailure(diagnostics, context, {
        substage: RUNTIME_PROBE_SUBSTAGES.TARGET_SCROLL,
        code: cause?.code || "RUNTIME_PROBE_TARGET_SCROLL_FAILED",
      });
      continue;
    }
    let pointSet = null;
    try {
      pointSet = await pageSpaceRuntimeHitPoint({ frame, editor, target });
    } catch (cause) {
      recordRuntimeProbeFailure(diagnostics, context, {
        substage: RUNTIME_PROBE_SUBSTAGES.TARGET_CLICK,
        code: cause?.code || "RUNTIME_PROBE_HIT_POINT_READ_FAILED",
      });
      continue;
    }
    if (!pointSet) {
      recordRuntimeProbeUnreachable(diagnostics, context);
      continue;
    }
    let point = null;
    let lastUnsafeHit = null;
    try {
      for (const candidatePoint of pointSet.points) {
        await page.mouse.move(candidatePoint.pageX, candidatePoint.pageY);
        await page.evaluate(() => new Promise((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(resolve));
        }));
        const safeHit = await runtimeHitStillSafe({ editor, target, point: candidatePoint });
        if (!safeHit.accepted) {
          lastUnsafeHit = safeHit;
          continue;
        }
        point = candidatePoint;
        break;
      }
      if (!point) {
        recordRuntimeProbeFailure(diagnostics, context, {
          substage: RUNTIME_PROBE_SUBSTAGES.TARGET_CLICK,
          code: lastUnsafeHit?.hitKind === "target-moved"
            ? "RUNTIME_PROBE_TARGET_MOVED_BEFORE_POINTER_DOWN"
            : "RUNTIME_PROBE_HOST_POINTER_INTERCEPTED",
          hitKind: lastUnsafeHit?.hitKind,
        });
        continue;
      }
      await page.mouse.click(point.pageX, point.pageY);
      await page.evaluate(() => new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
      }));
      diagnostics.probedCount += 1;
    } catch (cause) {
      recordRuntimeProbeFailure(diagnostics, context, {
        substage: RUNTIME_PROBE_SUBSTAGES.TARGET_CLICK,
        code: cause?.code || "RUNTIME_PROBE_TARGET_CLICK_FAILED",
      });
      continue;
    }
    let snapshot;
    try {
      snapshot = await editor.evaluate((element) => ({
        runtimeGenerated: element.getAttribute("data-selection-runtime-generated"),
        generation: element.getAttribute("data-selection-runtime-generation"),
        sourceAnchorId: element.getAttribute("data-selection-runtime-source-anchor-id"),
        kind: element.getAttribute("data-selection-runtime-kind"),
        relativePath: element.getAttribute("data-selection-runtime-path"),
      }));
    } catch (cause) {
      recordRuntimeProbeFailure(diagnostics, context, {
        substage: RUNTIME_PROBE_SUBSTAGES.DIAGNOSTIC_READ,
        code: cause?.code || "RUNTIME_GENERATED_DIAGNOSTIC_READ_FAILED",
      });
      continue;
    }
    // A successful authored selection reports an explicit "false".  A null
    // value means the controller did not publish a selection diagnostic at
    // all, so it is a probe failure rather than evidence that no generated
    // target exists.  The authored-only/no-runtime case is covered by the
    // explicit false path and leaves probeFailureCount unchanged.
    if (snapshot.runtimeGenerated === null) {
      recordRuntimeProbeFailure(diagnostics, context, {
        substage: RUNTIME_PROBE_SUBSTAGES.DIAGNOSTIC_READ,
        code: "RUNTIME_GENERATED_DIAGNOSTIC_MISSING",
      });
      continue;
    }
    if (snapshot.runtimeGenerated !== "true") continue;
    diagnostics.runtimeGeneratedCount += 1;
    if (
      !snapshot.generation
      || !snapshot.sourceAnchorId
      || !snapshot.kind
      || !snapshot.relativePath
    ) {
      recordRuntimeProbeFailure(diagnostics, context, {
        substage: RUNTIME_PROBE_SUBSTAGES.DIAGNOSTIC_VALIDATE,
        code: "RUNTIME_GENERATED_DIAGNOSTIC_FIELDS_MISSING",
        hitKind: snapshot.kind,
        diagnostic: true,
      });
      continue;
    }
    let diagnosticMatchesCandidate = false;
    try {
      diagnosticMatchesCandidate = await target.evaluate((element, payload) => {
        const anchors = [...document.querySelectorAll("[data-stemmio-id]")].filter(
          (candidate) => candidate.getAttribute("data-stemmio-id") === payload.sourceAnchorId,
        );
        if (anchors.length !== 1) return false;
        let resolved = null;
        try {
          resolved = anchors[0].querySelector(payload.relativePath);
        } catch {
          return false;
        }
        return resolved === element || element.contains(resolved) || resolved?.contains(element) === true;
      }, snapshot);
    } catch (cause) {
      recordRuntimeProbeFailure(diagnostics, context, {
        substage: RUNTIME_PROBE_SUBSTAGES.DIAGNOSTIC_TARGET_MATCH,
        code: cause?.code || "RUNTIME_GENERATED_DIAGNOSTIC_TARGET_MATCH_FAILED",
        hitKind: snapshot.kind,
        diagnostic: true,
      });
      continue;
    }
    if (!diagnosticMatchesCandidate) {
      diagnostics.diagnosticTargetMismatchCount += 1;
      recordRuntimeProbeFailure(diagnostics, context, {
        substage: RUNTIME_PROBE_SUBSTAGES.DIAGNOSTIC_TARGET_MATCH,
        code: "RUNTIME_GENERATED_DIAGNOSTIC_TARGET_MISMATCH",
        hitKind: snapshot.kind,
        diagnostic: true,
      });
      continue;
    }
    if (keys.has(snapshot.kind)) continue;
    keys.add(snapshot.kind);
    const key = [snapshot.sourceAnchorId, snapshot.kind, snapshot.relativePath].join(":");
    targets.push({
      targetKey: key,
      tabId,
      generation: snapshot.generation,
      sourceAnchorId: snapshot.sourceAnchorId,
      kind: snapshot.kind,
      relativePath: snapshot.relativePath,
      capabilityFamilies: ["comment"],
      deniedCapabilityFamilies: ["text", "format", "copy", "move", "delete"],
    });
    diagnostics.frozenTargetCount = targets.length;
  }
  try {
    await page.keyboard.press("Escape");
  } catch (cause) {
    const activeFrame = editor.locator('iframe[data-runtime-slot-role="active"]');
    const activeFrameCount = await activeFrame.count().catch(() => 0);
    recordRuntimeProbeFailure(diagnostics, {
      targetIndex: null,
      targetTag: null,
      connected: null,
      frameGeneration: activeFrameCount === 1
        ? await activeFrame.getAttribute("data-frame-generation").catch(() => null)
        : null,
    }, {
      substage: RUNTIME_PROBE_SUBSTAGES.SELECTION_CLEAR,
      code: cause?.code || "RUNTIME_PROBE_FINAL_SELECTION_CLEAR_FAILED",
    });
  }
  return { targets, diagnostics };
}

async function authoredProbeSelectionSnapshot(frame, editor) {
  return {
    selectedMarkerCount: await frame.locator("[data-html-canvas-selected]").count(),
    visibleToolbarCount: await editor.getByRole("toolbar").filter({ visible: true }).count(),
  };
}

export async function resetAuthoredProbeSelection({ page, frame, editor }) {
  await page.keyboard.press("Escape");
  try {
    await expect.poll(
      () => authoredProbeSelectionSnapshot(frame, editor),
      { timeout: 2_000 },
    ).toEqual({ selectedMarkerCount: 0, visibleToolbarCount: 0 });
  } catch {
    const snapshot = await authoredProbeSelectionSnapshot(frame, editor);
    return {
      ok: false,
      reason: "PREVIOUS_SELECTION_OVERLAY_DID_NOT_CLOSE",
      ...snapshot,
    };
  }
  return {
    ok: true,
    reason: "PREVIOUS_SELECTION_CLEARED",
    ...(await authoredProbeSelectionSnapshot(frame, editor)),
  };
}

export async function probeAuthoredCapability({
  page,
  frame,
  editor,
  candidate,
  mode = "verify",
  sourceElements = [],
  selectedSnapshotReader = null,
}) {
  if (mode !== "discover" && mode !== "verify") {
    throw new Error(`Unknown capability probe mode: ${mode}`);
  }
  const expectedOperationStableId = candidate.expectedOperationStableId
    || candidate.stableId;
  const selectionReset = await resetAuthoredProbeSelection({ page, frame, editor });
  if (!selectionReset.ok) {
    const error = new Error("The previous capability selection overlay did not close.");
    error.code = "CAPABILITY_PROBE_SELECTION_NOT_CLEARED";
    error.details = { stableId: candidate.stableId, selectionReset };
    throw error;
  }
  const target = frame.locator(`[data-stemmio-id=${JSON.stringify(candidate.stableId)}]`);
  const count = await target.count();
  if (count !== 1) {
    const error = new Error("The frozen Stable ID did not resolve to exactly one live element.");
    error.code = count ? "CAPABILITY_PROBE_DUPLICATE_STABLE_ID" : "CAPABILITY_PROBE_STALE_STABLE_ID";
    error.details = { stableId: candidate.stableId, count };
    throw error;
  }
  const liveTag = await target.evaluate((element) => element.localName);
  await target.evaluate((element) => element.scrollIntoView({ block: "center", inline: "center" }));
  await page.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }));
  const relocated = await target.evaluate((element) => ({
    stableId: element.getAttribute("data-stemmio-id"),
    tag: element.localName,
    connected: element.isConnected,
  }));
  if (
    relocated.stableId !== candidate.stableId
    || relocated.tag !== liveTag
    || !relocated.connected
  ) {
    const error = new Error("The frozen capability target changed during viewport preparation.");
    error.code = "CAPABILITY_PROBE_TARGET_CHANGED_DURING_SCROLL";
    error.details = { expectedStableId: candidate.stableId, expectedTag: liveTag, relocated };
    throw error;
  }
  const initialPoints = await pageSpaceAuthoredHitPoint({
    frame,
    editor,
    target,
    sourceElements,
  });
  if (initialPoints.kind === "valid-descendant-occlusion") {
    return {
      ...candidate,
      capabilityFamilies: [],
      behaviorFamilies: [],
      visible: false,
      probeReason: "AUTHORED_DESCENDANT_OCCLUSION",
      hitTest: initialPoints,
      selectionReset,
    };
  }
  if (initialPoints.kind !== "exact") {
    return {
      ...candidate,
      capabilityFamilies: [],
      behaviorFamilies: [],
      visible: false,
      probeReason: "NO_EXACT_HIT_POINT",
      hitTest: initialPoints,
      selectionReset,
    };
  }
  let point = null;
  let hostPointer = null;
  let iframeHitStillExact = false;
  const hostHitKinds = [];
  for (let pointIndex = 0; pointIndex < initialPoints.points.length; pointIndex += 1) {
    const currentPoints = await pageSpaceAuthoredHitPoint({ frame, editor, target, sourceElements });
    if (currentPoints.kind !== "exact") continue;
    point = currentPoints.points[pointIndex] || null;
    if (!point) continue;
    await page.mouse.move(point.pageX, point.pageY);
    await page.evaluate(() => new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    }));
    hostPointer = await hostPointerSnapshot({
      editor,
      candidate,
      point,
      mode,
      expectedOperationStableId,
    });
    hostHitKinds.push(hostPointer.hitKind || "no-hit");
    if (!hostPointer.accepted) continue;
    iframeHitStillExact = await target.evaluate((element, hitPoint) => (
      element.ownerDocument.elementFromPoint(hitPoint.clientX, hitPoint.clientY)
        ?.closest("[data-stemmio-id]") === element
    ), point);
    if (iframeHitStillExact) break;
  }
  if (!point || point.kind !== "exact" || !hostPointer?.accepted) {
    const error = new Error("A host overlay intercepted the real capability probe point.");
    error.code = "CAPABILITY_PROBE_HOST_POINTER_INTERCEPTED";
    error.details = {
      stableId: candidate.stableId,
      hitKind: hostPointer?.hitKind || "no-exact-hit-point",
      hostPointer,
      attemptedPointCount: hostHitKinds.length,
      hostHitKinds: [...new Set(hostHitKinds)],
    };
    throw error;
  }
  if (!iframeHitStillExact) {
    const error = new Error("The iframe target moved away from the verified capability probe point.");
    error.code = "CAPABILITY_PROBE_TARGET_MOVED_BEFORE_POINTER_DOWN";
    error.details = { stableId: candidate.stableId };
    throw error;
  }
  await page.mouse.down();
  await page.mouse.up();
  let selectedId = null;
  let selectedSnapshot = null;
  const readSelectedSnapshot = selectedSnapshotReader || (async () => (
    frame.locator("[data-html-canvas-selected]").evaluateAll((selectedElements, expectedStableId) => {
      const expectedElement = Array.from(document.querySelectorAll("[data-stemmio-id]"))
        .find((element) => element.getAttribute("data-stemmio-id") === expectedStableId) || null;
      const selectedElement = selectedElements.length === 1 ? selectedElements[0] : null;
      const rect = selectedElement?.getBoundingClientRect() || null;
      const style = selectedElement ? getComputedStyle(selectedElement) : null;
      const documentHeight = Math.max(
        document.documentElement?.scrollHeight || 0,
        document.body?.scrollHeight || 0,
        innerHeight,
      );
      const center = rect ? scrollY + rect.top + rect.height / 2 : null;
      let scrollContainer = "document";
      let ancestor = selectedElement?.parentElement || null;
      while (ancestor && ancestor !== document.body) {
        const ancestorStyle = getComputedStyle(ancestor);
        if (/(?:auto|scroll)/u.test(`${ancestorStyle.overflowY} ${ancestorStyle.overflow}`)
          && ancestor.scrollHeight > ancestor.clientHeight + 1) {
          scrollContainer = ancestor.getAttribute("data-stemmio-id") || "nested-authored-scroller";
          break;
        }
        ancestor = ancestor.parentElement;
      }
      return {
        available: true,
        reasonCode: "SELECTION_SNAPSHOT_OBSERVED",
        selectedCount: selectedElements.length,
        selectedId: selectedElement?.getAttribute("data-stemmio-id") || null,
        selectedTag: selectedElement?.localName || null,
        selectedConnected: selectedElement?.isConnected === true,
        selectedVisible: Boolean(
          selectedElement
          && rect
          && style
          && rect.width > 1
          && rect.height > 1
          && style.display !== "none"
          && style.visibility !== "hidden",
        ),
        selectedInert: selectedElement?.closest("[inert]") != null,
        selectedRegion: center == null
          ? null
          : center < documentHeight / 3
            ? "top"
            : center < documentHeight * 2 / 3
              ? "middle"
              : "bottom",
        selectedScrollContainer: scrollContainer,
        selectedContainsExpected: Boolean(
          selectedElement && expectedElement && selectedElement.contains(expectedElement),
        ),
        expectedContainsSelected: Boolean(
          selectedElement && expectedElement && expectedElement.contains(selectedElement),
        ),
      };
    }, candidate.stableId)
  ));
  const unavailableSnapshot = () => ({
    available: false,
    reasonCode: "SELECTION_SNAPSHOT_UNAVAILABLE",
    selectedCount: null,
    selectedId: null,
    selectedTag: null,
    selectedConnected: false,
    selectedVisible: false,
    selectedInert: false,
    selectedRegion: null,
    selectedScrollContainer: null,
    selectedContainsExpected: false,
    expectedContainsSelected: false,
  });
  try {
    await expect.poll(async () => {
      selectedSnapshot = await readSelectedSnapshot().catch(unavailableSnapshot);
      selectedId = selectedSnapshot.selectedId;
      return mode === "discover"
        ? selectedSnapshot.available
          && selectedSnapshot.selectedCount === 1
          && CAPABILITY_STABLE_ID_PATTERN.test(selectedId || "")
        : selectedId;
    }, { timeout: 2_000 }).toBe(
      mode === "discover" ? true : expectedOperationStableId,
    );
  } catch {
    selectedSnapshot ||= await readSelectedSnapshot().catch(unavailableSnapshot);
    const error = new Error("The real pointer probe did not select the frozen Stable ID.");
    error.code = "CAPABILITY_PROBE_SELECTION_IDENTITY_MISMATCH";
    error.details = {
      expectedStableId: candidate.stableId,
      selectedId,
      selectedSnapshot,
      hostPointer,
      hitPoint: { x: point.pageX, y: point.pageY },
    };
    throw error;
  }
  const sourceRelationship = canonicalSourceRelationship(
    sourceElements,
    candidate.stableId,
    selectedId,
  );
  const sourceProofRequired = sourceElements.length > 0
    || mode === "discover"
    || selectedId !== candidate.stableId;
  const domAncestor = selectedId === candidate.stableId
    || selectedSnapshot?.selectedContainsExpected === true;
  const canonicalMappingValid = Boolean(
    selectedSnapshot?.available
    && selectedSnapshot.selectedCount === 1
    && selectedSnapshot.selectedConnected
    && !selectedSnapshot.selectedInert
    && domAncestor
    && (!sourceProofRequired || (
      sourceRelationship.validProbe
      && sourceRelationship.validOperation
      && sourceRelationship.sourceAncestor
    ))
  );
  const selectedStableIdCount = await frame.locator(
    `[data-stemmio-id=${JSON.stringify(selectedId)}]`,
  ).count();
  if (!canonicalMappingValid || selectedStableIdCount !== 1) {
    const error = new Error("The selected operation target was not the frozen authored target or its proven ancestor.");
    error.code = "CAPABILITY_PROBE_CANONICAL_MAPPING_INVALID";
    error.details = {
      probeStableId: candidate.stableId,
      expectedOperationStableId,
      selectedId,
      selectedStableIdCount,
      selectedSnapshot,
      sourceRelationship: {
        validProbe: sourceRelationship.validProbe,
        validOperation: sourceRelationship.validOperation,
        sourceAncestor: sourceRelationship.sourceAncestor,
      },
    };
    throw error;
  }
  const operationSourceEditable = sourceRelationship.operation?.sourceEditable
    ?? candidate.sourceEditable;
  const operationObservation = {
    ...candidate,
    stableId: selectedId,
    operationStableId: selectedId,
    probeStableId: candidate.stableId,
    probeTag: liveTag,
    probeSourceOrder: candidate.sourceOrder,
    tag: selectedSnapshot.selectedTag,
    sourceEditable: operationSourceEditable,
    parentId: sourceRelationship.operation?.parentId ?? candidate.parentId ?? null,
    sourceOrder: sourceRelationship.operation?.sourceOrder ?? candidate.sourceOrder,
    visible: selectedSnapshot.selectedVisible,
    isConnected: selectedSnapshot.selectedConnected,
    inert: selectedSnapshot.selectedInert,
    region: selectedSnapshot.selectedRegion,
    scrollContainer: selectedSnapshot.selectedScrollContainer,
  };

  const toolbar = editor.getByRole("toolbar").filter({ visible: true });
  try {
    // Selection's DOM marker can precede the React toolbar commit. This is an
    // observation boundary, not evidence that the selected element has no capabilities.
    await expect.poll(() => toolbar.count(), { timeout: 2_000 }).toBe(1);
  } catch (cause) {
    throw Object.assign(new Error("The selected target toolbar did not settle.", { cause }), {
      code: "CAPABILITY_PROBE_TOOLBAR_NOT_SETTLED",
      details: { selectedId, visibleToolbarCount: await toolbar.count() },
    });
  }
  const toolbarLabel = await toolbar.getAttribute("aria-label");
  const runtimeGenerated = Boolean(toolbarLabel?.startsWith("评论"));
  if (runtimeGenerated) {
    const error = new Error("An authored capability probe resolved to Runtime-generated content.");
    error.code = "CAPABILITY_PROBE_RUNTIME_GENERATED_OPERATION_TARGET";
    error.details = {
      probeStableId: candidate.stableId,
      operationStableId: selectedId,
    };
    throw error;
  }
  const enabled = async (name) => {
    const button = toolbar.getByRole("button", { name, exact: true });
    return await button.count() === 1 && await button.isEnabled().catch(() => false);
  };
  const capabilityFamilies = ["selection"];
  if (await toolbar.getByRole("button", { name: /留评论/u }).count()) capabilityFamilies.push("comment");
  if (!runtimeGenerated && operationSourceEditable && await enabled("编辑")) {
    capabilityFamilies.push("text", "format");
  }
  const copyAvailability = await editor.getAttribute("data-element-copy-availability");
  const copyReason = await editor.getAttribute("data-element-copy-reason");
  if (!runtimeGenerated && copyAvailability === "available" && await enabled("复制元素")) {
    capabilityFamilies.push("copy");
  }
  if (!runtimeGenerated && await enabled("上移")) capabilityFamilies.push("move-up");
  if (!runtimeGenerated && await enabled("下移")) capabilityFamilies.push("move-down");
  if (!runtimeGenerated && await toolbar.getByRole("button", { name: "删除元素", exact: true }).count()) {
    capabilityFamilies.push("delete");
  }
  return {
    ...operationObservation,
    runtimeGenerated,
    selectedId,
    capabilityFamilies,
    behaviorFamilies: behaviorFamiliesFor(capabilityFamilies),
    copyAvailability,
    copyReason,
    toolbarLabel,
    probeReason: "CAPABILITY_OBSERVED",
    selectionReset,
  };
}

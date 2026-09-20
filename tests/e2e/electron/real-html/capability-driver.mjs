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

function rectangleUnionCoversBox(rectangles, width, height, epsilon = 0.5) {
  if (!(width > epsilon) || !(height > epsilon) || rectangles.length === 0) return false;
  const clipped = rectangles.map((rect) => ({
    left: Math.max(0, rect.left),
    top: Math.max(0, rect.top),
    right: Math.min(width, rect.right),
    bottom: Math.min(height, rect.bottom),
  })).filter((rect) => (
    rect.right - rect.left > epsilon && rect.bottom - rect.top > epsilon
  ));
  const xBoundaries = [...new Set([
    0,
    width,
    ...clipped.flatMap((rect) => [rect.left, rect.right]),
  ])].sort((left, right) => left - right);
  for (let index = 0; index < xBoundaries.length - 1; index += 1) {
    const left = xBoundaries[index];
    const right = xBoundaries[index + 1];
    if (right - left <= epsilon) continue;
    const x = (left + right) / 2;
    const intervals = clipped
      .filter((rect) => rect.left <= x + epsilon && rect.right >= x - epsilon)
      .map((rect) => [rect.top, rect.bottom])
      .sort((a, b) => a[0] - b[0]);
    let coveredTo = 0;
    for (const [top, bottom] of intervals) {
      if (top > coveredTo + epsilon) break;
      coveredTo = Math.max(coveredTo, bottom);
    }
    if (coveredTo < height - epsilon) return false;
  }
  return clipped.length > 0;
}

async function completeAuthoredPointerMap({ frame, target, sourceElements }) {
  const hitMap = await target.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const visible = {
      left: Math.max(0, rect.left),
      top: Math.max(0, rect.top),
      right: Math.min(innerWidth, rect.right),
      bottom: Math.min(innerHeight, rect.bottom),
    };
    const scale = Math.max(1, devicePixelRatio || 1);
    const columns = Math.floor(Math.max(0, visible.right - visible.left) * scale);
    const rows = Math.floor(Math.max(0, visible.bottom - visible.top) * scale);
    const pointCount = columns * rows;
    if (pointCount === 0 || pointCount > 2_000_000) {
      return {
        complete: false,
        pointCount,
        exactPoint: null,
        unownedProbePoints: [],
        noHitPointCount: 0,
        blockingStableIds: [],
      };
    }
    const blockingStableIds = new Set();
    const unownedProbePoints = [];
    let noHitPointCount = 0;
    const dedicatedSelector = "iframe, audio, video, canvas, object, embed, svg, math, input, textarea, select";
    const dedicatedDescendants = [...element.querySelectorAll(dedicatedSelector)]
      .filter((candidate) => candidate.hasAttribute("data-stemmio-id"))
      .map((candidate) => {
        const candidateRect = candidate.getBoundingClientRect();
        return {
          candidate,
          left: candidateRect.left - 2,
          top: candidateRect.top - 2,
          right: candidateRect.right + 2,
          bottom: candidateRect.bottom + 2,
          usable: candidateRect.width > 0 && candidateRect.height > 0,
        };
      });
    const productStableHitAtPoint = (x, y) => {
      const hit = element.ownerDocument.elementFromPoint(x, y);
      const stableHit = hit?.closest?.("[data-stemmio-id]") || null;
      if (stableHit !== element) return stableHit;
      return dedicatedDescendants.find((candidate) => (
        candidate.usable
        && x >= candidate.left
        && x <= candidate.right
        && y >= candidate.top
        && y <= candidate.bottom
      ))?.candidate || stableHit;
    };
    for (let row = 0; row < rows; row += 1) {
      const y = visible.top + (row + 0.5) / scale;
      for (let column = 0; column < columns; column += 1) {
        const x = visible.left + (column + 0.5) / scale;
        const hit = element.ownerDocument.elementFromPoint(x, y);
        const stableHit = productStableHitAtPoint(x, y);
        if (stableHit === element) {
          return {
            complete: true,
            pointCount: row * columns + column + 1,
            exactPoint: {
              targetX: x - rect.left,
              targetY: y - rect.top,
              clientX: x,
              clientY: y,
            },
            unownedProbePoints,
            noHitPointCount,
            blockingStableIds: [...blockingStableIds],
          };
        }
        const stableId = stableHit?.getAttribute("data-stemmio-id") || null;
        if (!stableId && hit instanceof Element) {
          if (unownedProbePoints.length < 100) {
            unownedProbePoints.push({
              targetX: x - rect.left,
              targetY: y - rect.top,
              clientX: x,
              clientY: y,
              unownedRuntimeHit: true,
            });
          }
          continue;
        }
        if (!stableId) {
          noHitPointCount += 1;
          continue;
        }
        blockingStableIds.add(stableId);
      }
    }
    return {
      complete: true,
      pointCount,
      exactPoint: null,
      unownedProbePoints,
      noHitPointCount,
      blockingStableIds: [...blockingStableIds].sort(),
    };
  });
  const diagnostic = {
    complete: hitMap.complete,
    pointCount: hitMap.pointCount,
    exactPointFound: Boolean(hitMap.exactPoint),
    unownedProbePointCount: hitMap.unownedProbePoints.length,
    noHitPointCount: hitMap.noHitPointCount || 0,
    blockingStableIdCount: hitMap.blockingStableIds.length,
  };
  if (hitMap.exactPoint) {
    return {
      result: { kind: "exact", points: [hitMap.exactPoint], pointCount: 1 },
      diagnostic,
    };
  }
  if (hitMap.unownedProbePoints.length > 0) {
    return {
      result: {
        kind: "exact",
        points: hitMap.unownedProbePoints,
        pointCount: hitMap.unownedProbePoints.length,
      },
      diagnostic,
    };
  }
  if (hitMap.complete && hitMap.blockingStableIds.length > 0) {
    const validations = await Promise.all(
      hitMap.blockingStableIds.map(async (stableId) => ({
        stableId,
        sourceMatches: sourceElements.filter((entry) => (
          entry.stemmioId === stableId && entry.stemmioIdentityStatus === "valid"
        )).length,
        liveCount: await frame.locator(
          `[data-stemmio-id=${JSON.stringify(stableId)}]`,
        ).count(),
      })),
    );
    if (validations.every(({ stableId, sourceMatches, liveCount }) => (
      CAPABILITY_STABLE_ID_PATTERN.test(stableId)
      && sourceMatches === 1
      && liveCount === 1
    ))) {
      return {
        result: {
          kind: "valid-pointer-occlusion",
          blockingStableIdCount: hitMap.blockingStableIds.length,
          coverageRectangleCount: 0,
          hitMapPointCount: hitMap.pointCount,
          noHitPointCount: hitMap.noHitPointCount || 0,
          coverageVerified: true,
          coverageModel: "complete-device-pixel-hit-map",
        },
        diagnostic,
      };
    }
  }
  return { result: null, diagnostic };
}

async function authoredHitTest(frame, target, sourceElements) {
  const sampled = await target.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const fractions = [0.08, 0.2, 0.5, 0.8, 0.92];
    const descendantStableIds = new Set();
    const foreignStableIds = new Set();
    const foreignRuntimeRectangles = [];
    const exactPoints = [];
    let sampleCount = 0;
    let blockedHitKind = null;
    const dedicatedSelector = "iframe, audio, video, canvas, object, embed, svg, math, input, textarea, select";
    const dedicatedDescendants = [...element.querySelectorAll(dedicatedSelector)]
      .filter((candidate) => candidate.hasAttribute("data-stemmio-id"))
      .map((candidate) => {
        const candidateRect = candidate.getBoundingClientRect();
        return {
          candidate,
          left: candidateRect.left - 2,
          top: candidateRect.top - 2,
          right: candidateRect.right + 2,
          bottom: candidateRect.bottom + 2,
          usable: candidateRect.width > 0 && candidateRect.height > 0,
        };
      });
    const productStableHitAtPoint = (x, y) => {
      const hit = element.ownerDocument.elementFromPoint(x, y);
      const stableHit = hit?.closest?.("[data-stemmio-id]") || null;
      if (stableHit !== element) return stableHit;
      return dedicatedDescendants.find((candidate) => (
        candidate.usable
        && x >= candidate.left
        && x <= candidate.right
        && y >= candidate.top
        && y <= candidate.bottom
      ))?.candidate || stableHit;
    };
    for (const yFraction of fractions) {
      for (const xFraction of fractions) {
        const x = rect.left + Math.max(1, rect.width * xFraction);
        const y = rect.top + Math.max(1, rect.height * yFraction);
        if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) continue;
        sampleCount += 1;
        const hit = element.ownerDocument.elementFromPoint(x, y);
        const stableHit = productStableHitAtPoint(x, y);
        if (stableHit === element) {
          exactPoints.push({
            targetX: x - rect.left,
            targetY: y - rect.top,
            clientX: x,
            clientY: y,
          });
          continue;
        }
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
          if (stableId && stableHit && !element.contains(stableHit)) {
            foreignStableIds.add(stableId);
          } else if (!stableHit && hit instanceof Element && !element.contains(hit)) {
            const visibleLeft = Math.max(0, rect.left);
            const visibleTop = Math.max(0, rect.top);
            for (const hitRect of hit.getClientRects()) {
              foreignRuntimeRectangles.push({
                left: hitRect.left - visibleLeft,
                top: hitRect.top - visibleTop,
                right: hitRect.right - visibleLeft,
                bottom: hitRect.bottom - visibleTop,
              });
            }
          }
          continue;
        }
        descendantStableIds.add(stableId);
      }
    }
    {
      const viewportRect = {
        left: Math.max(0, rect.left),
        top: Math.max(0, rect.top),
        right: Math.min(innerWidth, rect.right),
        bottom: Math.min(innerHeight, rect.bottom),
      };
      const descendantRects = [...element.querySelectorAll("*")]
        .flatMap((candidate) => [...candidate.getClientRects()])
        .filter((candidateRect) => (
          candidateRect.right > viewportRect.left
          && candidateRect.left < viewportRect.right
          && candidateRect.bottom > viewportRect.top
          && candidateRect.top < viewportRect.bottom
        ));
      const foreignStableRects = [...element.ownerDocument.querySelectorAll("[data-stemmio-id]")]
        .filter((candidate) => candidate !== element && !element.contains(candidate))
        .flatMap((candidate) => [...candidate.getClientRects()])
        .filter((candidateRect) => (
          candidateRect.right > viewportRect.left
          && candidateRect.left < viewportRect.right
          && candidateRect.bottom > viewportRect.top
          && candidateRect.top < viewportRect.bottom
        ));
      const geometryRects = [...descendantRects, ...foreignStableRects];
      const xBoundaries = [...new Set([
        viewportRect.left,
        viewportRect.right,
        ...geometryRects.flatMap((candidateRect) => [
          Math.max(viewportRect.left, candidateRect.left),
          Math.min(viewportRect.right, candidateRect.right),
        ]),
      ])].sort((left, right) => left - right);
      const yBoundaries = [...new Set([
        viewportRect.top,
        viewportRect.bottom,
        ...geometryRects.flatMap((candidateRect) => [
          Math.max(viewportRect.top, candidateRect.top),
          Math.min(viewportRect.bottom, candidateRect.bottom),
        ]),
      ])].sort((left, right) => left - right);
      const xIntervals = xBoundaries.slice(0, -1).map((left, index) => ({
        left,
        right: xBoundaries[index + 1],
      })).filter(({ left, right }) => right - left > 0.25);
      const yIntervals = yBoundaries.slice(0, -1).map((top, index) => ({
        top,
        bottom: yBoundaries[index + 1],
      })).filter(({ top, bottom }) => bottom - top > 0.25);
      const totalCells = xIntervals.length * yIntervals.length;
      const adaptiveLimit = Math.min(totalCells, 8192);
      let previousCellIndex = -1;
      for (let sampleIndex = 0; sampleIndex < adaptiveLimit; sampleIndex += 1) {
        const cellIndex = Math.min(
          totalCells - 1,
          Math.floor(sampleIndex * totalCells / adaptiveLimit),
        );
        if (cellIndex === previousCellIndex) continue;
        previousCellIndex = cellIndex;
        const xInterval = xIntervals[cellIndex % xIntervals.length];
        const yInterval = yIntervals[Math.floor(cellIndex / xIntervals.length)];
        const x = (xInterval.left + xInterval.right) / 2;
        const y = (yInterval.top + yInterval.bottom) / 2;
        const hit = element.ownerDocument.elementFromPoint(x, y);
        const stableHit = productStableHitAtPoint(x, y);
        if (stableHit === element) {
          exactPoints.push({
            targetX: x - rect.left,
            targetY: y - rect.top,
            clientX: x,
            clientY: y,
          });
          if (exactPoints.length >= 100) break;
        } else {
          const stableId = stableHit?.getAttribute("data-stemmio-id") || null;
          if (stableId && stableHit && !element.contains(stableHit)) {
            foreignStableIds.add(stableId);
            blockedHitKind ||= "stable-id-non-descendant";
          } else if (!stableHit && hit instanceof Element && !element.contains(hit)) {
            for (const hitRect of hit.getClientRects()) {
              foreignRuntimeRectangles.push({
                left: hitRect.left - viewportRect.left,
                top: hitRect.top - viewportRect.top,
                right: hitRect.right - viewportRect.left,
                bottom: hitRect.bottom - viewportRect.top,
              });
            }
          }
        }
      }
    }
    if (exactPoints.length < 100) {
      const roundedOccludingElements = [...element.ownerDocument.querySelectorAll("[data-stemmio-id]")]
        .filter((candidate) => {
          if (candidate === element) return false;
          const style = getComputedStyle(candidate);
          return [
            style.borderTopLeftRadius,
            style.borderTopRightRadius,
            style.borderBottomRightRadius,
            style.borderBottomLeftRadius,
          ].some((value) => value !== "0px");
        });
      for (const candidate of roundedOccludingElements) {
        for (const candidateRect of candidate.getClientRects()) {
          const edgeInset = Math.min(1, candidateRect.width / 4, candidateRect.height / 4);
          const cornerPoints = [
            [candidateRect.left + edgeInset, candidateRect.top + edgeInset],
            [candidateRect.right - edgeInset, candidateRect.top + edgeInset],
            [candidateRect.right - edgeInset, candidateRect.bottom - edgeInset],
            [candidateRect.left + edgeInset, candidateRect.bottom - edgeInset],
          ];
          for (const [x, y] of cornerPoints) {
            if (
              x < Math.max(0, rect.left)
              || x >= Math.min(innerWidth, rect.right)
              || y < Math.max(0, rect.top)
              || y >= Math.min(innerHeight, rect.bottom)
            ) continue;
            const stableHit = productStableHitAtPoint(x, y);
            if (stableHit === element) {
              exactPoints.push({
                targetX: x - rect.left,
                targetY: y - rect.top,
                clientX: x,
                clientY: y,
              });
              if (exactPoints.length >= 100) break;
            }
          }
          if (exactPoints.length >= 100) break;
        }
        if (exactPoints.length >= 100) break;
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
      allDescendantStableIds: [...element.querySelectorAll("[data-stemmio-id]")]
        .map((candidate) => candidate.getAttribute("data-stemmio-id"))
        .filter((stableId) => typeof stableId === "string")
        .sort(),
      foreignStableIds: [...foreignStableIds].sort(),
      foreignRuntimeRectangles,
      hitKind: blockedHitKind,
    };
  });
  if (sampled.kind === "exact") return sampled;
  if (Array.isArray(sampled.foreignStableIds)) {
    const validations = await Promise.all(sampled.foreignStableIds.map(async (stableId) => ({
      stableId,
      sourceMatches: sourceElements.filter((entry) => (
        entry.stemmioId === stableId && entry.stemmioIdentityStatus === "valid"
      )).length,
      liveCount: await frame.locator(
        `[data-stemmio-id=${JSON.stringify(stableId)}]`,
      ).count(),
    })));
    const provenForeignIds = validations.filter(({ stableId, sourceMatches, liveCount }) => (
      CAPABILITY_STABLE_ID_PATTERN.test(stableId)
      && sourceMatches === 1
      && liveCount === 1
    )).map(({ stableId }) => stableId);
    const foreignCoverage = await target.evaluate((element, stableIds) => {
      const rect = element.getBoundingClientRect();
      const visible = {
        left: Math.max(0, rect.left),
        top: Math.max(0, rect.top),
        right: Math.min(innerWidth, rect.right),
        bottom: Math.min(innerHeight, rect.bottom),
      };
      const dedicatedSelector = "iframe, audio, video, canvas, object, embed, svg, math, input, textarea, select";
      const rectangles = [];
      const admittedIds = new Set();
      const rejectedReasonCounts = {};
      for (const stableId of stableIds) {
        const candidate = [...document.querySelectorAll("[data-stemmio-id]")].find(
          (item) => item.getAttribute("data-stemmio-id") === stableId,
        );
        if (!candidate) continue;
        const style = getComputedStyle(candidate);
        const dedicated = candidate.matches(dedicatedSelector);
        const rejectedReasons = [
          style.display === "none" ? "display" : null,
          style.visibility === "hidden" ? "visibility" : null,
          style.transform !== "none" ? "transform" : null,
          style.clipPath !== "none" ? "clip-path" : null,
          style.maskImage !== "none" ? "mask" : null,
          [
            style.borderTopLeftRadius,
            style.borderTopRightRadius,
            style.borderBottomRightRadius,
            style.borderBottomLeftRadius,
          ].some((value) => value !== "0px") ? "border-radius" : null,
        ].filter(Boolean);
        const safeBox = dedicated || (
          style.display !== "none"
          && style.visibility !== "hidden"
          && style.transform === "none"
          && style.clipPath === "none"
          && style.maskImage === "none"
          && style.borderTopLeftRadius === "0px"
          && style.borderTopRightRadius === "0px"
          && style.borderBottomRightRadius === "0px"
          && style.borderBottomLeftRadius === "0px"
        );
        if (!safeBox) {
          if (rejectedReasons.length === 1 && rejectedReasons[0] === "border-radius") {
            const radiusPair = (value) => {
              const parts = String(value || "").split(/\s+/u).map((part) => (
                /^\d+(?:\.\d+)?px$/u.test(part) ? Number.parseFloat(part) : Number.NaN
              ));
              if (parts.length === 1 && Number.isFinite(parts[0])) return [parts[0], parts[0]];
              if (parts.length === 2 && parts.every(Number.isFinite)) return parts;
              return null;
            };
            const topLeft = radiusPair(style.borderTopLeftRadius);
            const topRight = radiusPair(style.borderTopRightRadius);
            const bottomRight = radiusPair(style.borderBottomRightRadius);
            const bottomLeft = radiusPair(style.borderBottomLeftRadius);
            if (topLeft && topRight && bottomRight && bottomLeft) {
              for (const candidateRect of candidate.getClientRects()) {
                const leftInset = Math.max(topLeft[0], bottomLeft[0]);
                const rightInset = Math.max(topRight[0], bottomRight[0]);
                const topInset = Math.max(topLeft[1], topRight[1]);
                const bottomInset = Math.max(bottomLeft[1], bottomRight[1]);
                rectangles.push({
                  left: candidateRect.left + leftInset - visible.left,
                  top: candidateRect.top - visible.top,
                  right: candidateRect.right - rightInset - visible.left,
                  bottom: candidateRect.bottom - visible.top,
                }, {
                  left: candidateRect.left - visible.left,
                  top: candidateRect.top + topInset - visible.top,
                  right: candidateRect.right - visible.left,
                  bottom: candidateRect.bottom - bottomInset - visible.top,
                });
                admittedIds.add(stableId);
              }
              continue;
            }
          }
          for (const reason of rejectedReasons) {
            rejectedReasonCounts[reason] = (rejectedReasonCounts[reason] || 0) + 1;
          }
          continue;
        }
        for (const candidateRect of candidate.getClientRects()) {
          rectangles.push({
            left: candidateRect.left - visible.left,
            top: candidateRect.top - visible.top,
            right: candidateRect.right - visible.left,
            bottom: candidateRect.bottom - visible.top,
          });
          admittedIds.add(stableId);
        }
      }
      return {
        width: Math.max(0, visible.right - visible.left),
        height: Math.max(0, visible.bottom - visible.top),
        rectangles,
        stableIdCount: admittedIds.size,
        rejectedReasonCounts,
      };
    }, provenForeignIds);
    const foreignCoverageRectangles = [
      ...foreignCoverage.rectangles,
      ...(sampled.foreignRuntimeRectangles || []),
    ];
    const foreignCoverageVerified = (
      foreignCoverage.stableIdCount > 0
      || (sampled.foreignRuntimeRectangles?.length || 0) > 0
    )
      && rectangleUnionCoversBox(
        foreignCoverageRectangles,
        foreignCoverage.width,
        foreignCoverage.height,
      );
    sampled.foreignCoverageDiagnostic = {
      observedForeignStableIdCount: sampled.foreignStableIds.length,
      provenForeignStableIdCount: provenForeignIds.length,
      admittedForeignStableIdCount: foreignCoverage.stableIdCount,
      coverageRectangleCount: foreignCoverageRectangles.length,
      runtimeRectangleCount: sampled.foreignRuntimeRectangles?.length || 0,
      visibleWidth: foreignCoverage.width,
      visibleHeight: foreignCoverage.height,
      coverageVerified: foreignCoverageVerified,
      rejectedReasonCounts: foreignCoverage.rejectedReasonCounts,
    };
    if (
      foreignCoverageVerified
    ) {
      return {
        kind: "valid-foreign-occlusion",
        sampleCount: sampled.sampleCount,
        foreignStableIdCount: foreignCoverage.stableIdCount,
        coverageRectangleCount: foreignCoverageRectangles.length,
        runtimeRectangleCount: sampled.foreignRuntimeRectangles?.length || 0,
        coverageVerified: true,
        coverageModel: "visible-viewport-proven-foreign-box-union",
      };
    }
    if (sampled.descendantStableIds.length === 0) {
      const completeHitMap = await completeAuthoredPointerMap({
        frame,
        target,
        sourceElements,
      });
      sampled.completeHitMapDiagnostic = completeHitMap.diagnostic;
      if (completeHitMap.result) {
        return {
          ...completeHitMap.result,
          sampleCount: sampled.sampleCount,
        };
      }
    }
  }
  if (
    sampled.kind !== "descendant-candidate"
    || !Number.isInteger(sampled.sampleCount)
    || sampled.sampleCount <= 0
    || sampled.descendantStableIds.length === 0
  ) {
    if (
      Number.isInteger(sampled.sampleCount)
      && sampled.sampleCount > 0
      && sampled.descendantStableIds.length > 0
    ) {
      const completeHitMap = await completeAuthoredPointerMap({
        frame,
        target,
        sourceElements,
      });
      sampled.completeHitMapDiagnostic = completeHitMap.diagnostic;
      if (completeHitMap.result) {
        return {
          ...completeHitMap.result,
          sampleCount: sampled.sampleCount,
        };
      }
    }
    return { ...sampled, kind: "blocked" };
  }
  const targetStableId = await target.getAttribute("data-stemmio-id");
  const proofStableIds = [...new Set(sampled.allDescendantStableIds || [])];
  for (const descendantStableId of proofStableIds) {
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
    if (targetRects.length !== 1) {
      return {
        verified: false,
        reason: "TARGET_CLIENT_RECT_COUNT",
        targetRectCount: targetRects.length,
        candidateCount: descendantStableIds.length,
        rectangleCount: 0,
      };
    }
    const targetRect = targetRects[0];
    const epsilon = 0.5;
    const dedicatedSelector = "iframe, audio, video, canvas, object, embed, svg, math, input, textarea, select";
    const rectangularHitPath = (candidate) => {
      if (!(candidate instanceof HTMLElement)) return "non-html-element";
      let current = candidate;
      while (current && element.contains(current)) {
        const style = getComputedStyle(current);
        if (style.display === "none") return "display";
        if (style.visibility === "hidden") return "visibility";
        if (style.transform !== "none") return "transform";
        if (style.clipPath !== "none") return "clip-path";
        if (style.maskImage !== "none") return "mask";
        if (
          style.borderTopLeftRadius !== "0px"
          || style.borderTopRightRadius !== "0px"
          || style.borderBottomRightRadius !== "0px"
          || style.borderBottomLeftRadius !== "0px"
        ) return "border-radius";
        if (
          current !== element
          && current !== candidate
          && (style.overflowX !== "visible" || style.overflowY !== "visible")
        ) return "overflow-clipping";
        if (current === element) break;
        current = current.parentElement;
      }
      if (current !== element) return "not-descendant";
      if (getComputedStyle(candidate).pointerEvents === "none") return "pointer-events";
      return null;
    };
    const rectangles = [];
    let unsafeCandidateCount = 0;
    let ambiguousCandidateCount = 0;
    const unsafeReasonCounts = {};
    for (const stableId of descendantStableIds) {
      const matches = [...element.querySelectorAll("[data-stemmio-id]")]
        .filter((candidate) => candidate.getAttribute("data-stemmio-id") === stableId);
      if (matches.length !== 1) {
        ambiguousCandidateCount += 1;
        continue;
      }
      const unsafeReason = rectangularHitPath(matches[0]);
      if (unsafeReason) {
        unsafeCandidateCount += 1;
        unsafeReasonCounts[unsafeReason] = (unsafeReasonCounts[unsafeReason] || 0) + 1;
        continue;
      }
      const dedicated = matches[0].matches(dedicatedSelector);
      const hitTolerance = dedicated ? 2 : 0;
      const descendantRects = [...matches[0].getClientRects()];
      for (const rect of descendantRects) {
        const clipped = {
          left: Math.max(targetRect.left, rect.left - hitTolerance),
          top: Math.max(targetRect.top, rect.top - hitTolerance),
          right: Math.min(targetRect.right, rect.right + hitTolerance),
          bottom: Math.min(targetRect.bottom, rect.bottom + hitTolerance),
          stableId,
        };
        if (clipped.right - clipped.left > epsilon && clipped.bottom - clipped.top > epsilon) {
          rectangles.push(clipped);
        }
      }
    }
    if (rectangles.length === 0) {
      return {
        verified: false,
        reason: "NO_SAFE_DESCENDANT_RECTANGLES",
        targetRectCount: 1,
        candidateCount: descendantStableIds.length,
        unsafeCandidateCount,
        unsafeReasonCounts,
        ambiguousCandidateCount,
        rectangleCount: 0,
      };
    }
    const xBoundaries = [...new Set([
      targetRect.left,
      targetRect.right,
      ...rectangles.flatMap((rect) => [rect.left, rect.right]),
    ])].sort((left, right) => left - right);
    for (let index = 0; index < xBoundaries.length - 1; index += 1) {
      const left = xBoundaries[index];
      const right = xBoundaries[index + 1];
      if (right - left <= epsilon) continue;
      const x = (left + right) / 2;
      const intervals = rectangles
        .filter((rect) => rect.left <= x + epsilon && rect.right >= x - epsilon)
        .map((rect) => [rect.top, rect.bottom])
        .sort((a, b) => a[0] - b[0]);
      let coveredTo = targetRect.top;
      for (const [top, bottom] of intervals) {
        if (top > coveredTo + epsilon) break;
        coveredTo = Math.max(coveredTo, bottom);
      }
      if (coveredTo < targetRect.bottom - epsilon) {
        return {
          verified: false,
          reason: "DESCENDANT_RECTANGLE_UNION_GAP",
          targetRectCount: 1,
          candidateCount: descendantStableIds.length,
          unsafeCandidateCount,
          unsafeReasonCounts,
          ambiguousCandidateCount,
          rectangleCount: rectangles.length,
        };
      }
    }
    const stableIds = [...new Set(rectangles.map((rect) => rect.stableId))].sort();
    return stableIds.length === 0 ? {
      verified: false,
      reason: "NO_COVERAGE_IDENTITIES",
      targetRectCount: 1,
      candidateCount: descendantStableIds.length,
      unsafeCandidateCount,
      unsafeReasonCounts,
      ambiguousCandidateCount,
      rectangleCount: rectangles.length,
    } : {
      verified: true,
      kind: stableIds.length === 1
        ? "single-untransformed-hit-box"
        : "union-untransformed-hit-boxes",
      stableIds,
    };
  }, proofStableIds);
  if (!coverage.verified) {
    const completeHitMap = await completeAuthoredPointerMap({
      frame,
      target,
      sourceElements,
    });
    if (completeHitMap.result) {
      return {
        ...completeHitMap.result,
        sampleCount: sampled.sampleCount,
      };
    }
    return {
      ...sampled,
      kind: "blocked",
      hitKind: "descendant-coverage-unproven",
      coverageDiagnostic: {
        ...coverage,
        completeHitMap: completeHitMap.diagnostic,
      },
    };
  }
  return {
    kind: "valid-descendant-occlusion",
    sampleCount: sampled.sampleCount,
    validSampleCount: sampled.sampleCount,
    descendantStableIds: coverage.stableIds,
    sourceAncestorVerified: true,
    liveUniqueVerified: true,
    coverageVerified: true,
    coverageKind: coverage.kind,
    coverageStableIds: coverage.stableIds,
  };
}

async function provenAuthoredDescendantRectangles({ frame, target, sourceElements }) {
  const targetStableId = await target.getAttribute("data-stemmio-id");
  const descendantStableIds = await target.locator("[data-stemmio-id]").evaluateAll(
    (elements) => [...new Set(elements.map(
      (element) => element.getAttribute("data-stemmio-id"),
    ).filter(Boolean))],
  );
  const validations = await Promise.all(descendantStableIds.map(async (stableId) => ({
    stableId,
    relationship: canonicalSourceRelationship(sourceElements, stableId, targetStableId),
    liveCount: await frame.locator(
      `[data-stemmio-id=${JSON.stringify(stableId)}]`,
    ).count(),
  })));
  const provenStableIds = validations.filter(({ stableId, relationship, liveCount }) => (
    CAPABILITY_STABLE_ID_PATTERN.test(stableId)
    && relationship.validProbe
    && relationship.validOperation
    && relationship.sourceAncestor
    && liveCount === 1
  )).map(({ stableId }) => stableId);
  return target.evaluate((element, stableIds) => {
    const targetRects = [...element.getClientRects()];
    if (targetRects.length !== 1) {
      return {
        targetWidth: 0,
        targetHeight: 0,
        rectangles: [],
        stableIdCount: 0,
        runtimeDomRectangles: [],
        runtimeDomElementCount: 0,
      };
    }
    const targetRect = targetRects[0];
    const dedicatedSelector = "iframe, audio, video, canvas, object, embed, svg, math, input, textarea, select";
    const rectangles = [];
    const admittedStableIds = new Set();
    for (const stableId of stableIds) {
      const candidate = [...element.querySelectorAll("[data-stemmio-id]")].find(
        (item) => item.getAttribute("data-stemmio-id") === stableId,
      );
      if (!candidate) continue;
      let current = candidate;
      let rectangularPath = candidate.matches(dedicatedSelector);
      if (!rectangularPath) {
        rectangularPath = true;
        while (current && element.contains(current)) {
          const style = getComputedStyle(current);
          if (
            style.display === "none"
            || style.visibility === "hidden"
            || style.transform !== "none"
            || style.clipPath !== "none"
            || style.maskImage !== "none"
            || style.borderTopLeftRadius !== "0px"
            || style.borderTopRightRadius !== "0px"
            || style.borderBottomRightRadius !== "0px"
            || style.borderBottomLeftRadius !== "0px"
            || (current !== element && current !== candidate
              && (style.overflowX !== "visible" || style.overflowY !== "visible"))
          ) {
            rectangularPath = false;
            break;
          }
          if (current === element) break;
          current = current.parentElement;
        }
        rectangularPath = rectangularPath && current === element;
      }
      if (!rectangularPath) continue;
      for (const rect of candidate.getClientRects()) {
        rectangles.push({
          left: rect.left - targetRect.left,
          top: rect.top - targetRect.top,
          right: rect.right - targetRect.left,
          bottom: rect.bottom - targetRect.top,
        });
        admittedStableIds.add(stableId);
      }
    }
    const runtimeDomRectangles = [];
    let runtimeDomElementCount = 0;
    for (const candidate of element.querySelectorAll(":not([data-stemmio-id])")) {
      const candidateRects = [...candidate.getClientRects()];
      if (candidateRects.length === 0) continue;
      runtimeDomElementCount += 1;
      for (const rect of candidateRects) {
        runtimeDomRectangles.push({
          left: rect.left - targetRect.left,
          top: rect.top - targetRect.top,
          right: rect.right - targetRect.left,
          bottom: rect.bottom - targetRect.top,
        });
      }
    }
    return {
      targetWidth: targetRect.width,
      targetHeight: targetRect.height,
      rectangles,
      stableIdCount: admittedStableIds.size,
      runtimeDomRectangles,
      runtimeDomElementCount,
    };
  }, provenStableIds);
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
  const frameGeometry = await editor.evaluate(async (root, firstPoint) => {
    const frames = root.querySelectorAll('iframe[data-runtime-slot-role="active"]');
    if (frames.length !== 1) return { count: frames.length };
    const iframe = frames[0];
    iframe.scrollIntoView({ block: "center", inline: "center" });
    await new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    });
    let rect = iframe.getBoundingClientRect();
    let scaleX = iframe.offsetWidth > 0 ? rect.width / iframe.offsetWidth : 1;
    let scaleY = iframe.offsetHeight > 0 ? rect.height / iframe.offsetHeight : 1;
    const mappedPoint = () => ({
      x: iframe.getBoundingClientRect().left + iframe.clientLeft * scaleX + firstPoint.clientX * scaleX,
      y: iframe.getBoundingClientRect().top + iframe.clientTop * scaleY + firstPoint.clientY * scaleY,
    });
    for (let ancestor = iframe.parentElement; ancestor; ancestor = ancestor.parentElement) {
      const point = mappedPoint();
      const ancestorRect = ancestor.getBoundingClientRect();
      if (ancestor.scrollWidth > ancestor.clientWidth + 1) {
        const left = ancestorRect.left + ancestor.clientLeft;
        const right = left + ancestor.clientWidth;
        if (point.x < left || point.x >= right) {
          ancestor.scrollLeft += point.x - (left + ancestor.clientWidth / 2);
        }
      }
      if (ancestor.scrollHeight > ancestor.clientHeight + 1) {
        const top = ancestorRect.top + ancestor.clientTop;
        const bottom = top + ancestor.clientHeight;
        if (point.y < top || point.y >= bottom) {
          ancestor.scrollTop += point.y - (top + ancestor.clientHeight / 2);
        }
      }
    }
    await new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    });
    rect = iframe.getBoundingClientRect();
    scaleX = iframe.offsetWidth > 0 ? rect.width / iframe.offsetWidth : 1;
    scaleY = iframe.offsetHeight > 0 ? rect.height / iframe.offsetHeight : 1;
    const mapped = mappedPoint();
    if (mapped.x < 0 || mapped.x >= innerWidth || mapped.y < 0 || mapped.y >= innerHeight) {
      scrollBy(mapped.x - innerWidth / 2, mapped.y - innerHeight / 2);
      await new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
      });
      rect = iframe.getBoundingClientRect();
      scaleX = iframe.offsetWidth > 0 ? rect.width / iframe.offsetWidth : 1;
      scaleY = iframe.offsetHeight > 0 ? rect.height / iframe.offsetHeight : 1;
    }
    return {
      count: 1,
      contentLeft: rect.left + iframe.clientLeft * scaleX,
      contentTop: rect.top + iframe.clientTop * scaleY,
      scaleX,
      scaleY,
    };
  }, position.points[0]);
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
    const pointWithinViewport = hitPoint.pageX >= 0
      && hitPoint.pageY >= 0
      && hitPoint.pageX < innerWidth
      && hitPoint.pageY < innerHeight;
    const activeFrameRect = activeFrame?.getBoundingClientRect() || null;
    const activeFrameContainsPoint = Boolean(
      activeFrameRect
      && hitPoint.pageX >= activeFrameRect.left
      && hitPoint.pageX < activeFrameRect.right
      && hitPoint.pageY >= activeFrameRect.top
      && hitPoint.pageY < activeFrameRect.bottom
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
      pointWithinViewport,
      pointX: hitPoint.pageX,
      pointY: hitPoint.pageY,
      viewportWidth: innerWidth,
      viewportHeight: innerHeight,
      activeFrameTop: activeFrameRect?.top ?? null,
      activeFrameBottom: activeFrameRect?.bottom ?? null,
      activeFrameLeft: activeFrameRect?.left ?? null,
      activeFrameRight: activeFrameRect?.right ?? null,
      activeFrameContainsPoint,
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
      if (observation?.probeReason === "AUTHORED_VIEWPORT_UNREACHABLE") {
        const hitTest = observation?.hitTest;
        const completeViewportProof = Boolean(
          CAPABILITY_STABLE_ID_PATTERN.test(observation?.stableId || "")
          && hitTest?.kind === "valid-viewport-unreachable"
          && hitTest.scrollAttemptCount === 3
          && hitTest.connected === true
          && hitTest.cssVisible === true
          && hitTest.rectWidth > 1
          && hitTest.rectHeight > 1
          && hitTest.viewportIntersectionPointCount === 0
          && !observation?.probeStableId
          && !observation?.operationStableId
          && (observation?.capabilityFamilies?.length || 0) === 0
          && (observation?.behaviorFamilies?.length || 0) === 0
        );
        if (!completeViewportProof) {
          const error = new Error("Viewport reachability exclusion is missing complete proof.");
          error.code = "CAPABILITY_PROBE_VIEWPORT_EXCLUSION_INVALID";
          throw error;
        }
        denominatorExclusions.push({
          elementId: observation.stableId,
          reason: observation.probeReason,
        });
        continue;
      }
      if (observation?.probeReason === "AUTHORED_POINTER_OCCLUSION") {
        const hitTest = observation?.hitTest;
        const completePointerProof = Boolean(
          CAPABILITY_STABLE_ID_PATTERN.test(observation?.stableId || "")
          && hitTest?.kind === "valid-pointer-occlusion"
          && Number.isInteger(hitTest.sampleCount)
          && hitTest.sampleCount > 0
          && Number.isInteger(hitTest.blockingStableIdCount)
          && hitTest.blockingStableIdCount > 0
          && Number.isInteger(hitTest.hitMapPointCount)
          && hitTest.hitMapPointCount > 0
          && hitTest.coverageVerified === true
          && hitTest.coverageModel === "complete-device-pixel-hit-map"
          && !observation?.probeStableId
          && !observation?.operationStableId
          && (observation?.capabilityFamilies?.length || 0) === 0
          && (observation?.behaviorFamilies?.length || 0) === 0
        );
        if (!completePointerProof) {
          const error = new Error("Pointer occlusion exclusion is missing complete proof.");
          error.code = "CAPABILITY_PROBE_POINTER_OCCLUSION_EXCLUSION_INVALID";
          throw error;
        }
        denominatorExclusions.push({
          elementId: observation.stableId,
          reason: observation.probeReason,
        });
        continue;
      }
      if (observation?.probeReason === "AUTHORED_FOREIGN_SURFACE_OCCLUSION") {
        const hitTest = observation?.hitTest;
        const completeForeignCoverageProof = Boolean(
          CAPABILITY_STABLE_ID_PATTERN.test(observation?.stableId || "")
          && hitTest?.kind === "valid-foreign-occlusion"
          && Number.isInteger(hitTest.sampleCount)
          && hitTest.sampleCount > 0
          && Number.isInteger(hitTest.foreignStableIdCount)
          && hitTest.foreignStableIdCount > 0
          && Number.isInteger(hitTest.coverageRectangleCount)
          && hitTest.coverageVerified === true
          && (
            (
              hitTest.coverageRectangleCount > 0
              && hitTest.coverageModel === "visible-viewport-proven-foreign-box-union"
            )
            || (
              Number.isInteger(hitTest.hitMapPointCount)
              && hitTest.hitMapPointCount > 0
              && hitTest.coverageModel === "complete-device-pixel-hit-map"
            )
          )
          && !observation?.probeStableId
          && !observation?.operationStableId
          && (observation?.capabilityFamilies?.length || 0) === 0
          && (observation?.behaviorFamilies?.length || 0) === 0
        );
        if (!completeForeignCoverageProof) {
          const error = new Error("Foreign surface exclusion is missing complete proof.");
          error.code = "CAPABILITY_PROBE_FOREIGN_OCCLUSION_EXCLUSION_INVALID";
          error.details = {
            stableId: CAPABILITY_STABLE_ID_PATTERN.test(observation?.stableId || "")
              ? observation.stableId
              : null,
            observedTag: observation?.tag || null,
          };
          throw error;
        }
        denominatorExclusions.push({
          elementId: observation.stableId,
          reason: observation.probeReason,
        });
        continue;
      }
      if (observation?.probeReason === "AUTHORED_MIXED_DESCENDANT_OCCLUSION") {
        const hitTest = observation?.hitTest;
        const completeMixedCoverageProof = Boolean(
          CAPABILITY_STABLE_ID_PATTERN.test(observation?.stableId || "")
          && hitTest?.kind === "valid-mixed-descendant-occlusion"
          && Number.isInteger(hitTest.runtimeSelectionCount)
          && hitTest.runtimeSelectionCount > 0
          && Number.isInteger(hitTest.runtimeRectangleCount)
          && hitTest.runtimeRectangleCount > 0
          && Number.isInteger(hitTest.authoredStableIdCount)
          && hitTest.authoredStableIdCount >= 0
          && Number.isInteger(hitTest.authoredRectangleCount)
          && hitTest.authoredRectangleCount >= 0
          && Number.isInteger(hitTest.runtimeDomElementCount)
          && hitTest.runtimeDomElementCount >= 0
          && Number.isInteger(hitTest.runtimeDomRectangleCount)
          && hitTest.runtimeDomRectangleCount >= 0
          && (
            hitTest.authoredStableIdCount > 0
            || hitTest.runtimeDomElementCount > 0
          )
          && hitTest.coverageVerified === true
          && hitTest.coverageModel === "product-runtime-and-proven-authored-box-union"
          && !observation?.probeStableId
          && !observation?.operationStableId
          && (observation?.capabilityFamilies?.length || 0) === 0
          && (observation?.behaviorFamilies?.length || 0) === 0
        );
        if (!completeMixedCoverageProof) {
          const error = new Error("Mixed descendant exclusion is missing complete proof.");
          error.code = "CAPABILITY_PROBE_MIXED_OCCLUSION_EXCLUSION_INVALID";
          error.details = {
            stableId: CAPABILITY_STABLE_ID_PATTERN.test(observation?.stableId || "")
              ? observation.stableId
              : null,
            observedTag: observation?.tag || null,
          };
          throw error;
        }
        denominatorExclusions.push({
          elementId: observation.stableId,
          reason: observation.probeReason,
        });
        continue;
      }
      if (observation?.probeReason === "AUTHORED_DEDICATED_SURFACE_OCCLUSION") {
        const hitTest = observation?.hitTest;
        const completeDedicatedSurfaceProof = Boolean(
          CAPABILITY_STABLE_ID_PATTERN.test(observation?.stableId || "")
          && hitTest?.kind === "valid-authored-dedicated-surface-occlusion"
          && Number.isInteger(hitTest.selectedSurfaceCount)
          && hitTest.selectedSurfaceCount > 0
          && Number.isInteger(hitTest.selectionCount)
          && hitTest.selectionCount > 0
          && Number.isInteger(hitTest.coverageRectangleCount)
          && hitTest.coverageRectangleCount > 0
          && hitTest.coverageVerified === true
          && hitTest.coverageModel === "product-dedicated-surface-bounding-box-with-hit-tolerance"
          && !observation?.probeStableId
          && !observation?.operationStableId
          && (observation?.capabilityFamilies?.length || 0) === 0
          && (observation?.behaviorFamilies?.length || 0) === 0
        );
        if (!completeDedicatedSurfaceProof) {
          const error = new Error("Dedicated surface exclusion is missing complete proof.");
          error.code = "CAPABILITY_PROBE_DEDICATED_SURFACE_EXCLUSION_INVALID";
          error.details = {
            stableId: CAPABILITY_STABLE_ID_PATTERN.test(observation?.stableId || "")
              ? observation.stableId
              : null,
            observedTag: observation?.tag || null,
          };
          throw error;
        }
        denominatorExclusions.push({
          elementId: observation.stableId,
          reason: observation.probeReason,
        });
        continue;
      }
      if (observation?.probeReason === "AUTHORED_RUNTIME_DESCENDANT_OCCLUSION") {
        const hitTest = observation?.hitTest;
        const completeRuntimeCoverageProof = Boolean(
          CAPABILITY_STABLE_ID_PATTERN.test(observation?.stableId || "")
          && hitTest?.kind === "valid-runtime-descendant-occlusion"
          && Number.isInteger(hitTest.runtimeSelectionCount)
          && hitTest.runtimeSelectionCount > 0
          && Number.isInteger(hitTest.coverageRectangleCount)
          && hitTest.coverageRectangleCount > 0
          && hitTest.coverageVerified === true
          && hitTest.coverageModel === "product-runtime-bounding-box"
          && !observation?.probeStableId
          && !observation?.operationStableId
          && (observation?.capabilityFamilies?.length || 0) === 0
          && (observation?.behaviorFamilies?.length || 0) === 0
        );
        if (!completeRuntimeCoverageProof) {
          const error = new Error("Runtime descendant exclusion is missing complete proof.");
          error.code = "CAPABILITY_PROBE_RUNTIME_OCCLUSION_EXCLUSION_INVALID";
          error.details = {
            stableId: CAPABILITY_STABLE_ID_PATTERN.test(observation?.stableId || "")
              ? observation.stableId
              : null,
            observedTag: observation?.tag || null,
          };
          throw error;
        }
        denominatorExclusions.push({
          elementId: observation.stableId,
          reason: observation.probeReason,
        });
        continue;
      }
      if (observation?.probeReason === "AUTHORED_CANVAS_ROOT_NO_CAPABILITY") {
        const completeRootProof = Boolean(
          CAPABILITY_STABLE_ID_PATTERN.test(observation?.stableId || "")
          && ["body", "html"].includes(observation?.tag)
          && observation?.hitTest?.kind === "authored-canvas-root"
          && observation.hitTest.tag === observation.tag
          && !observation?.probeStableId
          && !observation?.operationStableId
          && (observation?.capabilityFamilies?.length || 0) === 0
          && (observation?.behaviorFamilies?.length || 0) === 0
        );
        if (!completeRootProof) {
          const error = new Error("Authored canvas root exclusion is missing complete proof.");
          error.code = "CAPABILITY_PROBE_CANVAS_ROOT_EXCLUSION_INVALID";
          error.details = {
            stableId: CAPABILITY_STABLE_ID_PATTERN.test(observation?.stableId || "")
              ? observation.stableId
              : null,
            observedTag: observation?.tag || null,
          };
          throw error;
        }
        denominatorExclusions.push({
          elementId: observation.stableId,
          reason: observation.probeReason,
        });
        continue;
      }
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
          && ["single-untransformed-hit-box", "union-untransformed-hit-boxes"]
            .includes(hitTest.coverageKind)
          && Array.isArray(hitTest.coverageStableIds)
          && hitTest.coverageStableIds.length > 0
          && hitTest.coverageStableIds.every((stableId) => (
            CAPABILITY_STABLE_ID_PATTERN.test(stableId)
          ))
          && Array.isArray(descendantStableIds)
          && descendantStableIds.length > 0
          && new Set(descendantStableIds).size === descendantStableIds.length
          && descendantStableIds.every((stableId) => (
            CAPABILITY_STABLE_ID_PATTERN.test(stableId)
            && stableId !== observation.stableId
          ))
          && hitTest.coverageStableIds.every((stableId) => descendantStableIds.includes(stableId))
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
            coverageStableIds: [...hitTest.coverageStableIds],
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
  diagnosticFacts = null,
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
    ...(diagnosticFacts && typeof diagnosticFacts === "object" ? diagnosticFacts : {}),
  };
}

async function pageSpaceRuntimeHitPoint({ frame, editor, target }) {
  const sampled = await target.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const fractions = [0.08, 0.2, 0.5, 0.8, 0.92];
    const hitPoints = [];
    const hitKinds = new Set();
    const targetPointerEvents = getComputedStyle(element).pointerEvents;
    let sampleCount = 0;
    let inViewportCount = 0;
    for (const yFraction of fractions) {
      for (const xFraction of fractions) {
        sampleCount += 1;
        const clientX = rect.left + Math.max(1, rect.width * xFraction);
        const clientY = rect.top + Math.max(1, rect.height * yFraction);
        if (clientX < 0 || clientY < 0 || clientX >= innerWidth || clientY >= innerHeight) {
          hitKinds.add("outside-viewport");
          continue;
        }
        inViewportCount += 1;
        const hit = element.ownerDocument.elementFromPoint(clientX, clientY);
        const hitKind = hit === element
          ? "target"
          : hit && element.contains(hit)
            ? "target-descendant"
            : hit instanceof Element && hit.contains(element)
              ? "target-ancestor"
              : hit?.localName || "no-hit";
        hitKinds.add(hitKind);
        if (
          hit === element
          || (hit && element.contains(hit))
          || (hit instanceof Element && hit.contains(element))
          || targetPointerEvents === "none"
        ) {
          hitPoints.push({
            clientX,
            clientY,
            hitKind: targetPointerEvents === "none"
              ? "pointer-transparent-bounding-box"
              : hit === element
                ? "target"
                : element.contains(hit)
                  ? "target-descendant"
                  : "target-ancestor",
          });
        }
      }
    }
    return {
      points: hitPoints,
      diagnostic: {
        sampleCount,
        inViewportCount,
        acceptedHitCount: hitPoints.length,
        hitKinds: [...hitKinds].sort(),
        targetPointerEvents,
        targetRectWidth: rect.width,
        targetRectHeight: rect.height,
        viewportWidth: innerWidth,
        viewportHeight: innerHeight,
      },
    };
  });
  const { points, diagnostic } = sampled;
  if (points.length === 0) return { points: [], diagnostic };
  const topLevel = typeof frame.mainFrame === "function";
  if (topLevel) {
    return {
      points: points.map((point) => ({
        ...point,
        pageX: point.clientX,
        pageY: point.clientY,
        topLevel,
      })),
      diagnostic,
    };
  }
  const frameGeometry = await editor.evaluate(async (root, firstPoint) => {
    const frames = root.querySelectorAll('iframe[data-runtime-slot-role="active"]');
    if (frames.length !== 1) return { count: frames.length };
    const activeFrame = frames[0];
    activeFrame.scrollIntoView({ block: "center", inline: "center" });
    await new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    });
    let rect = activeFrame.getBoundingClientRect();
    let scaleX = activeFrame.offsetWidth > 0 ? rect.width / activeFrame.offsetWidth : 1;
    let scaleY = activeFrame.offsetHeight > 0 ? rect.height / activeFrame.offsetHeight : 1;
    const mappedPoint = () => ({
      x: activeFrame.getBoundingClientRect().left
        + activeFrame.clientLeft * scaleX
        + firstPoint.clientX * scaleX,
      y: activeFrame.getBoundingClientRect().top
        + activeFrame.clientTop * scaleY
        + firstPoint.clientY * scaleY,
    });
    for (let ancestor = activeFrame.parentElement; ancestor; ancestor = ancestor.parentElement) {
      const point = mappedPoint();
      const ancestorRect = ancestor.getBoundingClientRect();
      if (ancestor.scrollWidth > ancestor.clientWidth + 1) {
        const left = ancestorRect.left + ancestor.clientLeft;
        const right = left + ancestor.clientWidth;
        if (point.x < left || point.x >= right) {
          ancestor.scrollLeft += point.x - (left + ancestor.clientWidth / 2);
        }
      }
      if (ancestor.scrollHeight > ancestor.clientHeight + 1) {
        const top = ancestorRect.top + ancestor.clientTop;
        const bottom = top + ancestor.clientHeight;
        if (point.y < top || point.y >= bottom) {
          ancestor.scrollTop += point.y - (top + ancestor.clientHeight / 2);
        }
      }
    }
    await new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    });
    rect = activeFrame.getBoundingClientRect();
    scaleX = activeFrame.offsetWidth > 0 ? rect.width / activeFrame.offsetWidth : 1;
    scaleY = activeFrame.offsetHeight > 0 ? rect.height / activeFrame.offsetHeight : 1;
    const mapped = mappedPoint();
    if (mapped.x < 0 || mapped.x >= innerWidth || mapped.y < 0 || mapped.y >= innerHeight) {
      scrollBy(mapped.x - innerWidth / 2, mapped.y - innerHeight / 2);
      await new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
      });
      rect = activeFrame.getBoundingClientRect();
      scaleX = activeFrame.offsetWidth > 0 ? rect.width / activeFrame.offsetWidth : 1;
      scaleY = activeFrame.offsetHeight > 0 ? rect.height / activeFrame.offsetHeight : 1;
    }
    return {
      count: 1,
      contentLeft: rect.left + activeFrame.clientLeft * scaleX,
      contentTop: rect.top + activeFrame.clientTop * scaleY,
      scaleX,
      scaleY,
    };
  }, points[0]);
  if (frameGeometry.count !== 1) return null;
  return {
    points: points.map((point) => ({
      ...point,
      pageX: frameGeometry.contentLeft + point.clientX * frameGeometry.scaleX,
      pageY: frameGeometry.contentTop + point.clientY * frameGeometry.scaleY,
      topLevel,
    })),
    diagnostic,
  };
}

async function runtimeHitStillSafe({ editor, target, point }) {
  const frameHitStillSafe = await target.evaluate((element, hitPoint) => {
    const hit = element.ownerDocument.elementFromPoint(hitPoint.clientX, hitPoint.clientY);
    const rect = element.getBoundingClientRect();
    const pointerTransparentBox = hitPoint.hitKind === "pointer-transparent-bounding-box"
      && getComputedStyle(element).pointerEvents === "none"
      && hitPoint.clientX >= rect.left
      && hitPoint.clientX < rect.right
      && hitPoint.clientY >= rect.top
      && hitPoint.clientY < rect.bottom;
    return pointerTransparentBox
      || hit === element
      || Boolean(hit && element.contains(hit))
      || Boolean(hit instanceof Element && hit.contains(element));
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
    if (!pointSet || pointSet.points.length === 0) {
      recordRuntimeProbeFailure(diagnostics, context, {
        substage: RUNTIME_PROBE_SUBSTAGES.TARGET_CLICK,
        code: "RUNTIME_PROBE_NO_SAFE_HIT_POINT",
        diagnosticFacts: pointSet?.diagnostic || null,
      });
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
  let snapshot = null;
  for (let escapeAttemptCount = 1; escapeAttemptCount <= 2; escapeAttemptCount += 1) {
    await page.keyboard.press("Escape");
    try {
      await expect.poll(
        () => authoredProbeSelectionSnapshot(frame, editor),
        { timeout: escapeAttemptCount === 1 ? 500 : 2_000 },
      ).toEqual({ selectedMarkerCount: 0, visibleToolbarCount: 0 });
      return {
        ok: true,
        reason: "PREVIOUS_SELECTION_CLEARED",
        escapeAttemptCount,
        ...(await authoredProbeSelectionSnapshot(frame, editor)),
      };
    } catch {
      snapshot = await authoredProbeSelectionSnapshot(frame, editor);
    }
  }
  return {
    ok: false,
    reason: "PREVIOUS_SELECTION_OVERLAY_DID_NOT_CLOSE",
    escapeAttemptCount: 2,
    ...snapshot,
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
  if (["body", "html"].includes(liveTag)) {
    return {
      ...candidate,
      capabilityFamilies: [],
      behaviorFamilies: [],
      probeReason: "AUTHORED_CANVAS_ROOT_NO_CAPABILITY",
      hitTest: { kind: "authored-canvas-root", tag: liveTag },
      selectionReset,
    };
  }
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
  let initialPoints = await pageSpaceAuthoredHitPoint({
    frame,
    editor,
    target,
    sourceElements,
  });
  const pointSearches = [initialPoints];
  if (
    initialPoints.kind !== "exact"
    && initialPoints.kind !== "valid-descendant-occlusion"
    && initialPoints.kind !== "valid-foreign-occlusion"
    && initialPoints.kind !== "valid-pointer-occlusion"
  ) {
    for (const block of ["start", "end"]) {
      await target.evaluate((element, position) => {
        element.scrollIntoView({ block: position, inline: "center" });
      }, block);
      await page.evaluate(() => new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
      }));
      const alternatePoints = await pageSpaceAuthoredHitPoint({
        frame,
        editor,
        target,
        sourceElements,
      });
      pointSearches.push(alternatePoints);
      if (
        alternatePoints.kind === "exact"
        || alternatePoints.kind === "valid-descendant-occlusion"
        || alternatePoints.kind === "valid-foreign-occlusion"
        || alternatePoints.kind === "valid-pointer-occlusion"
      ) {
        initialPoints = alternatePoints;
        break;
      }
      if (
        (alternatePoints.sampleCount || 0) > (initialPoints.sampleCount || 0)
      ) initialPoints = alternatePoints;
    }
  }
  if (
    pointSearches.length === 3
    && pointSearches.every((entry) => (
      entry.completeHitMapDiagnostic?.pointCount === 0
    ))
  ) {
    const viewportState = await target.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        connected: element.isConnected,
        cssVisible: style.display !== "none"
          && style.visibility !== "hidden"
          && Number(style.opacity || 1) !== 0
          && rect.width > 1
          && rect.height > 1,
        rectWidth: rect.width,
        rectHeight: rect.height,
      };
    });
    if (viewportState.connected && viewportState.cssVisible) {
      initialPoints = {
        kind: "valid-viewport-unreachable",
        scrollAttemptCount: pointSearches.length,
        connected: true,
        cssVisible: true,
        rectWidth: viewportState.rectWidth,
        rectHeight: viewportState.rectHeight,
        viewportIntersectionPointCount: 0,
      };
    }
  }
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
  if (initialPoints.kind === "valid-foreign-occlusion") {
    return {
      ...candidate,
      capabilityFamilies: [],
      behaviorFamilies: [],
      visible: false,
      probeReason: "AUTHORED_FOREIGN_SURFACE_OCCLUSION",
      hitTest: initialPoints,
      selectionReset,
    };
  }
  if (initialPoints.kind === "valid-pointer-occlusion") {
    return {
      ...candidate,
      capabilityFamilies: [],
      behaviorFamilies: [],
      visible: false,
      probeReason: "AUTHORED_POINTER_OCCLUSION",
      hitTest: initialPoints,
      selectionReset,
    };
  }
  if (initialPoints.kind === "valid-viewport-unreachable") {
    return {
      ...candidate,
      capabilityFamilies: [],
      behaviorFamilies: [],
      visible: false,
      probeReason: "AUTHORED_VIEWPORT_UNREACHABLE",
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
  let point = null;
  let hostPointer = null;
  let anyHostAccepted = false;
  let anyIframeHitStillExact = false;
  let verificationMismatch = false;
  const hostHitKinds = [];
  const selectionAttempts = [];
  for (let pointIndex = 0; pointIndex < initialPoints.points.length; pointIndex += 1) {
    const currentPoints = await pageSpaceAuthoredHitPoint({ frame, editor, target, sourceElements });
    if (currentPoints.kind !== "exact") continue;
    const candidatePoint = currentPoints.points[pointIndex] || null;
    if (!candidatePoint) continue;
    await page.mouse.move(candidatePoint.pageX, candidatePoint.pageY);
    await page.evaluate(() => new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    }));
    const currentHostPointer = await hostPointerSnapshot({
      editor,
      candidate,
      point: candidatePoint,
      mode,
      expectedOperationStableId,
    });
    hostPointer = currentHostPointer;
    hostHitKinds.push(currentHostPointer.hitKind || "no-hit");
    if (!currentHostPointer.accepted) continue;
    anyHostAccepted = true;
    const currentIframeHitStillExact = await target.evaluate((element, hitPoint) => {
      const hit = element.ownerDocument.elementFromPoint(hitPoint.clientX, hitPoint.clientY);
      if (hitPoint.unownedRuntimeHit) {
        return hit instanceof Element && !hit.closest("[data-stemmio-id]");
      }
      return hit?.closest("[data-stemmio-id]") === element;
    }, candidatePoint);
    if (!currentIframeHitStillExact) continue;
    anyIframeHitStillExact = true;
    await page.mouse.down();
    await page.mouse.up();
    const selectionDeadline = Date.now() + 100;
    let runtimeGeneratedSelection = null;
    do {
      selectedSnapshot = await readSelectedSnapshot().catch(unavailableSnapshot);
      selectedId = selectedSnapshot.selectedId;
      runtimeGeneratedSelection = await editor.getAttribute(
        "data-selection-runtime-generated",
      ).catch(() => null);
      if (
        runtimeGeneratedSelection === "true"
        || (
          selectedSnapshot.available
          && selectedSnapshot.selectedCount === 1
          && CAPABILITY_STABLE_ID_PATTERN.test(selectedId || "")
        )
      ) break;
      await page.waitForTimeout(25);
    } while (Date.now() <= selectionDeadline);
    const runtimeCoverage = runtimeGeneratedSelection === "true"
      ? await target.evaluate((element) => {
        const selectedElements = [...document.querySelectorAll("[data-html-canvas-selected]")];
        const selected = selectedElements.length === 1 ? selectedElements[0] : null;
        const targetRects = [...element.getClientRects()];
        if (!selected || !element.contains(selected) || targetRects.length !== 1) {
          return {
            productRuntimeBox: false,
            targetWidth: 0,
            targetHeight: 0,
            rectangles: [],
          };
        }
        const targetRect = targetRects[0];
        return {
          // The product's Runtime visual index deliberately resolves point
          // targets from getBoundingClientRect boxes. Use the same sealed
          // public behavior model here rather than a shape approximation.
          productRuntimeBox: true,
          targetWidth: targetRect.width,
          targetHeight: targetRect.height,
          rectangles: [...selected.getClientRects()].map((rect) => ({
            left: rect.left - targetRect.left,
            top: rect.top - targetRect.top,
            right: rect.right - targetRect.left,
            bottom: rect.bottom - targetRect.top,
          })),
        };
      }).catch(() => null)
      : null;
    const authoredVisualCoverage = runtimeGeneratedSelection !== "true"
      ? await target.evaluate((element) => {
        const selectedElements = [...document.querySelectorAll("[data-html-canvas-selected]")];
        const selected = selectedElements.length === 1 ? selectedElements[0] : null;
        const targetRects = [...element.getClientRects()];
        const dedicatedSelector = "iframe, audio, video, canvas, object, embed, svg, math, input, textarea, select";
        if (
          !selected
          || !selected.matches(dedicatedSelector)
          || !selected.hasAttribute("data-stemmio-id")
          || targetRects.length !== 1
        ) {
          return {
            productDedicatedBox: false,
            targetWidth: 0,
            targetHeight: 0,
            rectangles: [],
          };
        }
        const targetRect = targetRects[0];
        const hitTolerance = 2;
        return {
          // findDedicatedSourceSurfaceAtPoint intentionally uses the
          // dedicated surface's bounding box plus the same two-pixel hit
          // tolerance as its point authority.
          productDedicatedBox: true,
          targetWidth: targetRect.width,
          targetHeight: targetRect.height,
          rectangles: [...selected.getClientRects()].map((rect) => ({
            left: Math.max(0, rect.left - targetRect.left - hitTolerance),
            top: Math.max(0, rect.top - targetRect.top - hitTolerance),
            right: Math.min(
              targetRect.width,
              rect.right - targetRect.left + hitTolerance,
            ),
            bottom: Math.min(
              targetRect.height,
              rect.bottom - targetRect.top + hitTolerance,
            ),
          })),
        };
      }).catch(() => null)
      : null;
    selectionAttempts.push({
      point: {
        clientX: candidatePoint.clientX,
        clientY: candidatePoint.clientY,
        pageX: candidatePoint.pageX,
        pageY: candidatePoint.pageY,
        targetX: candidatePoint.targetX,
        targetY: candidatePoint.targetY,
      },
      runtimeGenerated: runtimeGeneratedSelection === "true",
      selectedCount: selectedSnapshot?.selectedCount ?? null,
      selectedStableId: selectedId,
      selectedTag: selectedSnapshot?.selectedTag || null,
      runtimeCoverage,
      authoredVisualCoverage,
    });
    const currentSourceRelationship = canonicalSourceRelationship(
      sourceElements,
      candidate.stableId,
      selectedId,
    );
    const currentCanonicalMapping = selectedId === candidate.stableId
      || Boolean(
        selectedSnapshot?.selectedContainsExpected
        && currentSourceRelationship.validProbe
        && currentSourceRelationship.validOperation
        && currentSourceRelationship.sourceAncestor,
      );
    selectionAttempts[selectionAttempts.length - 1].canonicalMapping = currentCanonicalMapping;
    const acceptedSelection = runtimeGeneratedSelection !== "true"
      && selectedSnapshot?.available
      && selectedSnapshot.selectedCount === 1
      && CAPABILITY_STABLE_ID_PATTERN.test(selectedId || "")
      && (mode === "discover" ? currentCanonicalMapping : selectedId === expectedOperationStableId);
    if (acceptedSelection) {
      point = candidatePoint;
      hostPointer = currentHostPointer;
      break;
    }
    if (
      mode === "verify"
      && runtimeGeneratedSelection !== "true"
      && CAPABILITY_STABLE_ID_PATTERN.test(selectedId || "")
    ) {
      hostPointer = currentHostPointer;
      verificationMismatch = true;
      break;
    }
    const retryReset = await resetAuthoredProbeSelection({ page, frame, editor })
      .catch(() => ({ ok: false, reason: "SELECTION_RESET_FAILED" }));
    selectionAttempts[selectionAttempts.length - 1].retryReset = retryReset;
    if (!retryReset.ok) break;
  }
  if (!anyHostAccepted) {
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
  if (!anyIframeHitStillExact) {
    const error = new Error("The iframe target moved away from the verified capability probe point.");
    error.code = "CAPABILITY_PROBE_TARGET_MOVED_BEFORE_POINTER_DOWN";
    error.details = { stableId: candidate.stableId };
    throw error;
  }
  const runtimeSelectionAttempts = selectionAttempts.filter(
    (attempt) => attempt.runtimeGenerated,
  );
  const runtimeCoverageReference = runtimeSelectionAttempts.find(
    (attempt) => attempt.runtimeCoverage?.productRuntimeBox,
  )?.runtimeCoverage || null;
  const runtimeCoverageRectangles = runtimeSelectionAttempts.flatMap((attempt) => (
    attempt.runtimeCoverage?.productRuntimeBox ? attempt.runtimeCoverage.rectangles : []
  ));
  const runtimeCoverageVerified = Boolean(
    selectionAttempts.length > 0
    && runtimeSelectionAttempts.length === selectionAttempts.length
    && runtimeCoverageReference
    && runtimeSelectionAttempts.every((attempt) => (
      attempt.runtimeCoverage?.productRuntimeBox === true
      && Math.abs(
        attempt.runtimeCoverage.targetWidth - runtimeCoverageReference.targetWidth,
      ) <= 0.5
      && Math.abs(
        attempt.runtimeCoverage.targetHeight - runtimeCoverageReference.targetHeight,
      ) <= 0.5
    ))
    && rectangleUnionCoversBox(
      runtimeCoverageRectangles,
      runtimeCoverageReference.targetWidth,
      runtimeCoverageReference.targetHeight,
    )
  );
  if (!point && runtimeCoverageVerified) {
    return {
      ...candidate,
      capabilityFamilies: [],
      behaviorFamilies: [],
      visible: false,
      probeReason: "AUTHORED_RUNTIME_DESCENDANT_OCCLUSION",
      hitTest: {
        kind: "valid-runtime-descendant-occlusion",
        runtimeSelectionCount: runtimeSelectionAttempts.length,
        coverageRectangleCount: runtimeCoverageRectangles.length,
        coverageVerified: true,
        coverageModel: "product-runtime-bounding-box",
      },
      selectionReset,
    };
  }
  if (
    !point
    && selectionAttempts.length > 0
    && runtimeSelectionAttempts.length === selectionAttempts.length
    && runtimeCoverageReference
  ) {
    const authoredDescendantCoverage = await provenAuthoredDescendantRectangles({
      frame,
      target,
      sourceElements,
    });
    const mixedCoverageVerified = (
      authoredDescendantCoverage.stableIdCount > 0
      || authoredDescendantCoverage.runtimeDomElementCount > 0
    )
      && Math.abs(
        authoredDescendantCoverage.targetWidth - runtimeCoverageReference.targetWidth,
      ) <= 0.5
      && Math.abs(
        authoredDescendantCoverage.targetHeight - runtimeCoverageReference.targetHeight,
      ) <= 0.5
      && rectangleUnionCoversBox(
        [
          ...runtimeCoverageRectangles,
          ...authoredDescendantCoverage.runtimeDomRectangles,
          ...authoredDescendantCoverage.rectangles,
        ],
        runtimeCoverageReference.targetWidth,
        runtimeCoverageReference.targetHeight,
      );
    if (mixedCoverageVerified) {
      return {
        ...candidate,
        capabilityFamilies: [],
        behaviorFamilies: [],
        visible: false,
        probeReason: "AUTHORED_MIXED_DESCENDANT_OCCLUSION",
        hitTest: {
          kind: "valid-mixed-descendant-occlusion",
          runtimeSelectionCount: runtimeSelectionAttempts.length,
          runtimeRectangleCount: runtimeCoverageRectangles.length,
          authoredStableIdCount: authoredDescendantCoverage.stableIdCount,
          authoredRectangleCount: authoredDescendantCoverage.rectangles.length,
          runtimeDomElementCount: authoredDescendantCoverage.runtimeDomElementCount,
          runtimeDomRectangleCount: authoredDescendantCoverage.runtimeDomRectangles.length,
          coverageVerified: true,
          coverageModel: "product-runtime-and-proven-authored-box-union",
        },
        selectionReset,
      };
    }
  }
  const authoredVisualAttempts = selectionAttempts.filter((attempt) => (
    !attempt.runtimeGenerated
    && CAPABILITY_STABLE_ID_PATTERN.test(attempt.selectedStableId || "")
    && attempt.authoredVisualCoverage?.productDedicatedBox === true
    && sourceElements.filter((entry) => (
      entry.stemmioId === attempt.selectedStableId
      && entry.stemmioIdentityStatus === "valid"
    )).length === 1
  ));
  const authoredVisualCoverageReference = authoredVisualAttempts[0]
    ?.authoredVisualCoverage || null;
  const authoredVisualCoverageRectangles = authoredVisualAttempts.flatMap((attempt) => (
    attempt.authoredVisualCoverage.rectangles
  ));
  const authoredVisualCoverageVerified = Boolean(
    selectionAttempts.length > 0
    && authoredVisualAttempts.length === selectionAttempts.length
    && authoredVisualCoverageReference
    && authoredVisualAttempts.every((attempt) => (
      Math.abs(
        attempt.authoredVisualCoverage.targetWidth
          - authoredVisualCoverageReference.targetWidth,
      ) <= 0.5
      && Math.abs(
        attempt.authoredVisualCoverage.targetHeight
          - authoredVisualCoverageReference.targetHeight,
      ) <= 0.5
    ))
    && rectangleUnionCoversBox(
      authoredVisualCoverageRectangles,
      authoredVisualCoverageReference.targetWidth,
      authoredVisualCoverageReference.targetHeight,
    )
  );
  if (!point && authoredVisualCoverageVerified) {
    return {
      ...candidate,
      capabilityFamilies: [],
      behaviorFamilies: [],
      visible: false,
      probeReason: "AUTHORED_DEDICATED_SURFACE_OCCLUSION",
      hitTest: {
        kind: "valid-authored-dedicated-surface-occlusion",
        selectedSurfaceCount: new Set(
          authoredVisualAttempts.map((attempt) => attempt.selectedStableId),
        ).size,
        selectionCount: authoredVisualAttempts.length,
        coverageRectangleCount: authoredVisualCoverageRectangles.length,
        coverageVerified: true,
        coverageModel: "product-dedicated-surface-bounding-box-with-hit-tolerance",
      },
      selectionReset,
    };
  }
  if (!point || !hostPointer || !selectedSnapshot) {
    selectedSnapshot ||= await readSelectedSnapshot().catch(unavailableSnapshot);
    const invalidCanonicalAttempt = mode === "discover" && selectionAttempts.find((attempt) => (
      !attempt.runtimeGenerated
      && CAPABILITY_STABLE_ID_PATTERN.test(attempt.selectedStableId || "")
      && attempt.canonicalMapping === false
    ));
    if (invalidCanonicalAttempt) {
      const error = new Error(
        "The selected operation target was not the frozen authored target or its proven ancestor.",
      );
      error.code = "CAPABILITY_PROBE_CANONICAL_MAPPING_INVALID";
      error.details = {
        probeStableId: candidate.stableId,
        observedTag: liveTag,
        expectedOperationStableId,
        selectedId: invalidCanonicalAttempt.selectedStableId,
        selectedStableIdCount: await frame.locator(
          `[data-stemmio-id=${JSON.stringify(invalidCanonicalAttempt.selectedStableId)}]`,
        ).count(),
        selectedSnapshot,
        selectionAttempts,
        targetGeometry: await target.evaluate((element) => {
          const rect = element.getBoundingClientRect();
          return {
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height,
          };
        }),
      };
      throw error;
    }
    const error = new Error("The real pointer probe did not select the frozen Stable ID.");
    error.code = "CAPABILITY_PROBE_SELECTION_IDENTITY_MISMATCH";
    error.details = {
      expectedStableId: candidate.stableId,
      observedTag: liveTag,
      selectedId,
      selectedSnapshot,
      hostPointer,
      attemptedSelectionCount: selectionAttempts.length,
      runtimeGeneratedSelectionCount: selectionAttempts.filter(
        (attempt) => attempt.runtimeGenerated,
      ).length,
      verificationMismatch,
      selectionAttempts,
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

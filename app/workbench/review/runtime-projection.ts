import { OPAQUE_SANDBOX_STORAGE_BOOTSTRAP } from "../../lib/opaque-sandbox-storage.js";
import {
  REVIEW_PROJECTION_FACTS_SERIALIZED_LENGTH_LIMIT,
  normalizeReviewExactAtomOccurrences,
  normalizeReviewFocusGroupPlans,
} from "../../lib/review-projection-facts.js";
import {
  alignReviewTextEvidenceDotRows,
  reviewTextEvidenceGraphemeEnd,
  reviewTextEvidenceIsPunctuationCode,
  reviewTextEvidenceMarkGeometry,
} from "../../lib/review-text-evidence-marks.js";
import {
  reviewFocusOutlineIsUseful,
  reviewTargetScrollTop,
} from "../../lib/review-region-annotation.js";
import {
  REVIEW_BOOTSTRAP_IDENTITY_ATTRIBUTE_LIMIT,
  REVIEW_COMMENT_BINDING_SOURCE_BOX_ATTRIBUTES,
} from "./constants";
import type {
  ReviewBootstrapElementBinding,
  ReviewCommentBootstrapBinding,
  ReviewFocusGroupPlan,
  ReviewSide,
} from "./types";

export function reviewBootstrapElementBinding(
  document: Document,
  element: Element,
  includeIdentityText = false,
): ReviewBootstrapElementBinding | null {
  const root = document.documentElement;
  if (!root) return null;
  const path: number[] = [];
  let current: Element | null = element;
  while (current && current !== root) {
    const parent: Element | null = current.parentElement;
    if (!parent) return null;
    const index = [...parent.children].indexOf(current);
    if (index < 0) return null;
    path.unshift(index);
    if (path.length > 256) return null;
    current = parent;
  }
  if (current !== root) return null;
  const nonReviewAttributes = [...element.attributes].filter((attribute) => (
    (
      attribute.name === "data-stemmio-id"
      || !attribute.name.startsWith("data-stemmio-")
    )
    && !REVIEW_COMMENT_BINDING_SOURCE_BOX_ATTRIBUTES.includes(attribute.name)
  ));
  const identityAttributePriority = (name: string) => {
    if (name === "data-stemmio-id") return 0;
    if (name === "id") return 1;
    if (name === "name" || name === "aria-label") return 2;
    if (name.startsWith("data-")) return 3;
    return 4;
  };
  const identityAttributes = (nonReviewAttributes.some(
    (attribute) => attribute.name !== "class",
  )
    ? nonReviewAttributes.filter((attribute) => attribute.name !== "class")
    : nonReviewAttributes
  ).map((attribute) => [attribute.name, attribute.value] as [string, string])
    .sort(([leftName, leftValue], [rightName, rightValue]) => (
      identityAttributePriority(leftName) - identityAttributePriority(rightName)
      || leftName.localeCompare(rightName)
      || leftValue.localeCompare(rightValue)
    ))
    .slice(0, REVIEW_BOOTSTRAP_IDENTITY_ATTRIBUTE_LIMIT);
  // A truncated fingerprint is never evidence of identity. Even an id/name
  // anchor can be shared by an authored parser decoy while an omitted
  // attribute distinguishes the real source target, so drop every binding
  // that cannot be represented completely.
  if (nonReviewAttributes.length > REVIEW_BOOTSTRAP_IDENTITY_ATTRIBUTE_LIMIT) return null;
  const identityText = includeIdentityText
    ? (element.textContent || "").replace(/\s+/gu, " ").trim().slice(0, 1024)
    : "";
  return {
    path,
    tagName: element.tagName,
    sourceBoxSignature: JSON.stringify(
      REVIEW_COMMENT_BINDING_SOURCE_BOX_ATTRIBUTES.map((attribute) => [
        attribute,
        element.getAttribute(attribute),
      ]),
    ),
    identityAttributes,
    ...(identityText ? { identityText } : {}),
  };
}

function reviewBootstrap(
  sessionId: string,
  side: ReviewSide,
  reviewCommentBindings: readonly ReviewCommentBootstrapBinding[] = [],
  reviewVisualStableIds: readonly string[] = [],
  reviewFocusGroupPlans: readonly ReviewFocusGroupPlan[] = [],
  reviewExactAtomOccurrences: readonly { atomKey: string; count: number }[] = [],
): string {
  const serializedBootstrapPayload = (value: unknown) => (
    JSON.stringify(value).replace(/</gu, "\\u003c")
  );
  return String.raw`
(() => {
  const sessionId = ${JSON.stringify(sessionId)};
  const side = ${JSON.stringify(side)};
  // This first managed script binds private projection targets before authored
  // scripts execute. The binding payload is available only through the first
  // one-shot bootstrap response; authored markup and ordinary window messages
  // never receive source identities, candidate keys, or screenshots.
  const reviewCommentInitialBindings = Object.freeze(
    ${serializedBootstrapPayload(reviewCommentBindings)},
  );
  const reviewVisualInitialStableIds = Object.freeze(
    ${serializedBootstrapPayload(reviewVisualStableIds)},
  );
  const normalizeReviewFocusGroupPlans = ${normalizeReviewFocusGroupPlans.toString()};
  const reviewFocusGroupPlans = Object.freeze(normalizeReviewFocusGroupPlans(
    ${serializedBootstrapPayload(reviewFocusGroupPlans)},
  ));
  const normalizeReviewExactAtomOccurrences = ${normalizeReviewExactAtomOccurrences.toString()};
  const reviewExactAtomOccurrences = Object.freeze(normalizeReviewExactAtomOccurrences(
    ${serializedBootstrapPayload(reviewExactAtomOccurrences)},
  ));
  // A script-enabled opaque sandbox intentionally has no durable origin. The
  // shared bootstrap supplies one frame-local compatibility surface so an
  // authored chart cannot abort merely by reading storage.
  ${OPAQUE_SANDBOX_STORAGE_BOOTSTRAP}
  const reviewTextEvidenceGraphemeEnd = ${reviewTextEvidenceGraphemeEnd.toString()};
  const reviewTextEvidenceIsPunctuationCode = ${reviewTextEvidenceIsPunctuationCode.toString()};
  const reviewTextEvidenceMarkGeometry = ${reviewTextEvidenceMarkGeometry.toString()};
  const alignReviewTextEvidenceDotRows = ${alignReviewTextEvidenceDotRows.toString()};
  const reviewFocusOutlineIsUseful = ${reviewFocusOutlineIsUseful.toString()};
  const reviewTargetScrollTop = ${reviewTargetScrollTop.toString()};
  const reviewProjectionFactsSerializedLengthLimit = ${REVIEW_PROJECTION_FACTS_SERIALIZED_LENGTH_LIMIT};
  const runtimeVisualBindCall = (method) => Function.prototype.call.bind(method);
  const runtimeVisualFunctionHasInstance = runtimeVisualBindCall(
    Function.prototype[Symbol.hasInstance],
  );
  const RuntimeVisualElement = Element;
  const RuntimeVisualMap = Map;
  const RuntimeVisualSet = Set;
  const RuntimeVisualString = String;
  const runtimeVisualBoolean = Boolean;
  const runtimeVisualMathFloor = Math.floor.bind(Math);
  const runtimeVisualMathImul = Math.imul.bind(Math);
  const runtimeVisualMathMin = Math.min.bind(Math);
  const runtimeVisualMathMax = Math.max.bind(Math);
  const runtimeVisualNumberIsFinite = Number.isFinite.bind(Number);
  const runtimeVisualSetTimeout = window.setTimeout.bind(window);
  const runtimeVisualRequestAnimationFrame = window.requestAnimationFrame.bind(window);
  const runtimeVisualPerformanceNow = performance.now.bind(performance);
  const runtimeVisualArrayPush = runtimeVisualBindCall(Array.prototype.push);
  const runtimeVisualArrayForEach = runtimeVisualBindCall(Array.prototype.forEach);
  const runtimeVisualArrayJoin = runtimeVisualBindCall(Array.prototype.join);
  const runtimeVisualArrayMap = runtimeVisualBindCall(Array.prototype.map);
  const runtimeVisualArrayFind = runtimeVisualBindCall(Array.prototype.find);
  const runtimeVisualArrayFindIndex = runtimeVisualBindCall(Array.prototype.findIndex);
  const runtimeVisualArrayFilter = runtimeVisualBindCall(Array.prototype.filter);
  const runtimeVisualArrayFlatMap = runtimeVisualBindCall(Array.prototype.flatMap);
  const runtimeVisualArraySort = runtimeVisualBindCall(Array.prototype.sort);
  const runtimeVisualArraySlice = runtimeVisualBindCall(Array.prototype.slice);
  const runtimeVisualArrayShift = runtimeVisualBindCall(Array.prototype.shift);
  const runtimeVisualArraySplice = runtimeVisualBindCall(Array.prototype.splice);
  const runtimeVisualArrayIncludes = runtimeVisualBindCall(Array.prototype.includes);
  const runtimeVisualArraySome = runtimeVisualBindCall(Array.prototype.some);
  const runtimeVisualArrayEvery = runtimeVisualBindCall(Array.prototype.every);
  const runtimeVisualArrayIsArray = Array.isArray.bind(Array);
  const runtimeVisualStringCharCodeAt = runtimeVisualBindCall(
    String.prototype.charCodeAt,
  );
  const runtimeVisualStringToLowerCase = runtimeVisualBindCall(String.prototype.toLowerCase);
  const runtimeVisualStringToUpperCase = runtimeVisualBindCall(String.prototype.toUpperCase);
  const runtimeVisualStringSplit = runtimeVisualBindCall(String.prototype.split);
  const runtimeVisualStringFromCharCode = String.fromCharCode.bind(String);
  const runtimeVisualRegExpExec = runtimeVisualBindCall(RegExp.prototype.exec);
  const runtimeVisualDocumentQuerySelectorAll = runtimeVisualBindCall(
    Document.prototype.querySelectorAll,
  );
  const runtimeVisualDocumentCreateElement = runtimeVisualBindCall(
    Document.prototype.createElement,
  );
  const runtimeVisualElementGetAttribute = runtimeVisualBindCall(
    Element.prototype.getAttribute,
  );
  const runtimeVisualElementSetAttribute = runtimeVisualBindCall(
    Element.prototype.setAttribute,
  );
  const runtimeVisualElementRemoveAttribute = runtimeVisualBindCall(
    Element.prototype.removeAttribute,
  );
  const runtimeVisualElementQuerySelectorAll = runtimeVisualBindCall(
    Element.prototype.querySelectorAll,
  );
  const runtimeVisualElementMatches = runtimeVisualBindCall(Element.prototype.matches);
  const runtimeVisualElementClosest = runtimeVisualBindCall(Element.prototype.closest);
  const runtimeVisualElementContains = runtimeVisualBindCall(Element.prototype.contains);
  const runtimeVisualHTMLElementIsContentEditable = runtimeVisualBindCall(
    Object.getOwnPropertyDescriptor(HTMLElement.prototype, "isContentEditable").get,
  );
  const runtimeVisualElementGetClientRects = runtimeVisualBindCall(
    Element.prototype.getClientRects,
  );
  const runtimeVisualElementGetBoundingClientRect = runtimeVisualBindCall(
    Element.prototype.getBoundingClientRect,
  );
  const runtimeVisualGetComputedStyle = window.getComputedStyle.bind(window);
  const runtimeVisualCanvasGetContext = runtimeVisualBindCall(
    HTMLCanvasElement.prototype.getContext,
  );
  const runtimeVisualCanvasWidth = runtimeVisualBindCall(
    Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, "width").get,
  );
  const runtimeVisualCanvasHeight = runtimeVisualBindCall(
    Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, "height").get,
  );
  const runtimeVisualCanvasGetImageData = runtimeVisualBindCall(
    CanvasRenderingContext2D.prototype.getImageData,
  );
  const runtimeVisualCanvasDrawImage = runtimeVisualBindCall(
    CanvasRenderingContext2D.prototype.drawImage,
  );
  const runtimeVisualDocumentGetAnimations = runtimeVisualBindCall(
    Document.prototype.getAnimations,
  );
  const runtimeVisualDocumentReadyState = runtimeVisualBindCall(
    Object.getOwnPropertyDescriptor(Document.prototype, "readyState").get,
  );
  const runtimeVisualNodeIsConnected = runtimeVisualBindCall(
    Object.getOwnPropertyDescriptor(Node.prototype, "isConnected").get,
  );
  const runtimeVisualNodeTextContent = runtimeVisualBindCall(
    Object.getOwnPropertyDescriptor(Node.prototype, "textContent").get,
  );
  const runtimeVisualNodeCompareDocumentPosition = runtimeVisualBindCall(
    Node.prototype.compareDocumentPosition,
  );
  const runtimeVisualElementTagName = runtimeVisualBindCall(
    Object.getOwnPropertyDescriptor(Element.prototype, "tagName").get,
  );
  const runtimeVisualElementChildren = runtimeVisualBindCall(
    Object.getOwnPropertyDescriptor(Element.prototype, "children").get,
  );
  const runtimeVisualHtmlCollectionLength = runtimeVisualBindCall(
    Object.getOwnPropertyDescriptor(HTMLCollection.prototype, "length").get,
  );
  const runtimeVisualHtmlCollectionItem = runtimeVisualBindCall(
    HTMLCollection.prototype.item,
  );
  const runtimeVisualNodeListLength = runtimeVisualBindCall(
    Object.getOwnPropertyDescriptor(NodeList.prototype, "length").get,
  );
  const runtimeVisualNodeListItem = runtimeVisualBindCall(NodeList.prototype.item);
  const RuntimeVisualMutationObserver = MutationObserver;
  const runtimeVisualMutationObserverObserve = runtimeVisualBindCall(
    MutationObserver.prototype.observe,
  );
  const runtimeVisualMutationObserverTakeRecords = runtimeVisualBindCall(
    MutationObserver.prototype.takeRecords,
  );
  const runtimeVisualMutationObserverDisconnect = runtimeVisualBindCall(
    MutationObserver.prototype.disconnect,
  );
  const runtimeVisualMutationRecordType = runtimeVisualBindCall(
    Object.getOwnPropertyDescriptor(MutationRecord.prototype, "type").get,
  );
  const runtimeVisualMutationRecordAddedNodes = runtimeVisualBindCall(
    Object.getOwnPropertyDescriptor(MutationRecord.prototype, "addedNodes").get,
  );
  const runtimeVisualMutationRecordRemovedNodes = runtimeVisualBindCall(
    Object.getOwnPropertyDescriptor(MutationRecord.prototype, "removedNodes").get,
  );
  const runtimeVisualMutationRecordTarget = runtimeVisualBindCall(
    Object.getOwnPropertyDescriptor(MutationRecord.prototype, "target").get,
  );
  const runtimeVisualMutationRecordOldValue = runtimeVisualBindCall(
    Object.getOwnPropertyDescriptor(MutationRecord.prototype, "oldValue").get,
  );
  const runtimeVisualMutationRecordAttributeName = runtimeVisualBindCall(
    Object.getOwnPropertyDescriptor(MutationRecord.prototype, "attributeName").get,
  );
  const runtimeVisualDomRectListLength = runtimeVisualBindCall(
    Object.getOwnPropertyDescriptor(DOMRectList.prototype, "length").get,
  );
  const runtimeVisualDomRectListItem = runtimeVisualBindCall(DOMRectList.prototype.item);
  const runtimeVisualMapGet = runtimeVisualBindCall(Map.prototype.get);
  const runtimeVisualMapHas = runtimeVisualBindCall(Map.prototype.has);
  const runtimeVisualMapSet = runtimeVisualBindCall(Map.prototype.set);
  const runtimeVisualMapForEach = runtimeVisualBindCall(Map.prototype.forEach);
  const runtimeVisualSetHas = runtimeVisualBindCall(Set.prototype.has);
  const runtimeVisualSetAdd = runtimeVisualBindCall(Set.prototype.add);
  const runtimeVisualSetForEach = runtimeVisualBindCall(Set.prototype.forEach);
  const runtimeVisualStringify = JSON.stringify.bind(JSON);
  const runtimeVisualIsInstance = (constructor, value) => (
    runtimeVisualFunctionHasInstance(constructor, value)
  );
  const runtimeVisualWhitespaceCode = (code) => (
    code === 0x0009
    || (code >= 0x000a && code <= 0x000d)
    || code === 0x0020
    || code === 0x00a0
    || code === 0x1680
    || (code >= 0x2000 && code <= 0x200a)
    || code === 0x2028
    || code === 0x2029
    || code === 0x202f
    || code === 0x205f
    || code === 0x3000
    || code === 0xfeff
  );
  const runtimeVisualNormalizeText = (value) => {
    const source = RuntimeVisualString(value || "");
    const values = [];
    let pendingWhitespace = false;
    for (let index = 0; index < source.length; index += 1) {
      const code = runtimeVisualStringCharCodeAt(source, index);
      if (runtimeVisualWhitespaceCode(code)) {
        if (values.length) pendingWhitespace = true;
        continue;
      }
      if (pendingWhitespace) runtimeVisualArrayPush(values, " ");
      runtimeVisualArrayPush(values, runtimeVisualStringFromCharCode(code));
      pendingWhitespace = false;
    }
    return runtimeVisualArrayJoin(values, "");
  };
  // The first managed script runs before authored script. Freeze the
  // session-derived fragment now so later authored prototype changes cannot
  // influence a reserved SVG mask identifier.
  const reviewMaskSessionKey = RuntimeVisualString(sessionId)
    .replace(/[^a-z0-9_-]/giu, "_") || "session";
  const runtimeVisualQueryElements = (selector) => {
    const list = runtimeVisualDocumentQuerySelectorAll(document, selector);
    const values = [];
    const length = runtimeVisualNodeListLength(list);
    for (let index = 0; index < length; index += 1) {
      const value = runtimeVisualNodeListItem(list, index);
      if (value) runtimeVisualArrayPush(values, value);
    }
    return values;
  };
  let overlayFrame = 0;
  let layoutReportFrame = 0;
  let layoutReportTimer = 0;
  let presentationReadyTimer = 0;
  let geometryRevision = 0;
  let activeScrollCommand = null;
  let followerGestureId = 0;
  let acceptsFollowerScroll = false;
  let projectionEpoch = 0;
  let overlayMaskSequence = 0;
  let projectionTransitioning = false;
  let initialProjectionCommitted = false;
  // These IDs authorize projection of analyzer-owned source facts. Runtime
  // visual observations decide only whether an optional outline is allowed.
  let projectedSourceChangeIds = new RuntimeVisualSet();
  let commentHighlightActive = false;
  let activeFocusReadingBounds = null;
  let mirroringPanel = false;
  let mirroringAction = false;
  let currentState = {
    focus: "all",
    activeFocusGroupId: null,
    activeFocusRegionId: null,
    paintPlan: null,
    transparency: 25,
    scale: 1,
  };
  const reviewParent = parent;
  const postToParent = reviewParent.postMessage.bind(reviewParent);
  const runtimeVisualAddEventListener = addEventListener.bind(window);
  // Comment lookup uses a private capability port that never appears in
  // authored markup or ordinary window messages.
  const reviewCommentChannel = side === "before" && typeof MessageChannel === "function"
    ? new MessageChannel()
    : null;
  const stopImmediateMessagePropagation = Function.prototype.call.bind(
    Event.prototype.stopImmediatePropagation,
  );
  let reviewCommentChannelTransferred = false;
  let reviewCommentTargets = [];
  let pendingReviewCommentChannelChallenge = null;
  // This second capability is deliberately separate from comments. Its port
  // carries only bound visual observations; authored scripts cannot enumerate
  // candidates or forge a verdict through window messages.
  const reviewVisualChannel = typeof MessageChannel === "function" ? new MessageChannel() : null;
  let reviewVisualChannelTransferred = false;
  let pendingReviewVisualChannelChallenge = null;
  let privateChannelRequestsReady = false;
  const capturePrivateChannelRequest = (event) => {
    const message = event.data;
    const requestsCommentChannel = message?.type === "request-review-comment-channel";
    const requestsVisualChannel = message?.type === "request-review-visual-channel";
    if (
      !event.isTrusted
      || event.source !== reviewParent
      || !message
      || message.source !== "stemmio-ai-review-parent"
      || message.sessionId !== sessionId
      || (!requestsCommentChannel && !requestsVisualChannel)
    ) return;
    // This listener is installed by the first owned script with capture=true.
    // It consumes the capability challenge before authored capture listeners can
    // observe it or race a forged port back to the parent.
    stopImmediateMessagePropagation(event);
    if (requestsCommentChannel) pendingReviewCommentChannelChallenge = message.challenge;
    if (requestsVisualChannel) pendingReviewVisualChannelChallenge = message.challenge;
    if (privateChannelRequestsReady) drainPrivateChannelRequests();
  };
  runtimeVisualAddEventListener("message", capturePrivateChannelRequest, { capture: true });
  const post = (type, extra = {}) => postToParent({
    source: "stemmio-ai-review",
    sessionId,
    side,
    type,
    ...extra,
  }, "*");
  const transferReviewCommentChannel = (rawChallenge) => {
    const challenge = String(rawChallenge || "");
    if (runtimeVisualRegExpExec(/^[a-f0-9]{32}$/u, challenge) === null) return;
    if (!reviewCommentChannel || reviewCommentChannelTransferred) return;
    reviewCommentChannelTransferred = true;
    postToParent({
      source: "stemmio-ai-review",
      sessionId,
      side,
      type: "review-comment-channel",
      challenge,
    }, "*", [reviewCommentChannel.port2]);
  };
  const transferReviewVisualChannel = (rawChallenge) => {
    const challenge = String(rawChallenge || "");
    if (runtimeVisualRegExpExec(/^[a-f0-9]{32}$/u, challenge) === null) return;
    if (!reviewVisualChannel || reviewVisualChannelTransferred) return;
    reviewVisualChannelTransferred = true;
    postToParent({ source: "stemmio-ai-review", sessionId, side, type: "review-visual-channel", challenge }, "*", [reviewVisualChannel.port2]);
  };
  const drainPrivateChannelRequests = () => {
    const commentChallenge = pendingReviewCommentChannelChallenge;
    pendingReviewCommentChannelChallenge = null;
    if (commentChallenge !== null) transferReviewCommentChannel(commentChallenge);
    const visualChallenge = pendingReviewVisualChannelChallenge;
    pendingReviewVisualChannelChallenge = null;
    if (visualChallenge !== null) transferReviewVisualChannel(visualChallenge);
  };
  privateChannelRequestsReady = true;
  drainPrivateChannelRequests();
  const reviewVisualHash = (values) => {
    let left = 2166136261;
    let right = 2246822507;
    const source = runtimeVisualArrayJoin(values, "\u001f");
    for (let index = 0; index < source.length; index += 1) {
      const code = runtimeVisualStringCharCodeAt(source, index);
      left = runtimeVisualMathImul(left ^ code, 16777619);
      right = runtimeVisualMathImul(right ^ code, 3266489909);
    }
    return RuntimeVisualString(left >>> 0) + ":" + RuntimeVisualString(right >>> 0);
  };
  const reviewVisualPixelHash = (pixels) => {
    let left = 2166136261;
    let right = 2246822507;
    for (let index = 0; index < pixels.length; index += 1) {
      left = runtimeVisualMathImul(left ^ pixels[index], 16777619);
      right = runtimeVisualMathImul(right ^ pixels[index], 3266489909);
    }
    return RuntimeVisualString(left >>> 0) + ":" + RuntimeVisualString(right >>> 0);
  };
  const reviewVisualOwnedElements = (host, budget) => {
    const descendants = runtimeVisualElementQuerySelectorAll(host, "*");
    if (runtimeVisualNodeListLength(descendants) > 2048) return null;
    budget.nodes += runtimeVisualNodeListLength(descendants) + 1;
    if (budget.nodes > 20_000) {
      budget.failureReason = "global-node-budget";
      return null;
    }
    const result = [host];
    for (let index = 0; index < runtimeVisualNodeListLength(descendants); index += 1) {
      const node = runtimeVisualNodeListItem(descendants, index);
      if (!node) continue;
      let owner = node;
      while (owner && owner !== host) {
        if (runtimeVisualElementGetAttribute(owner, "data-stemmio-id")) break;
        owner = owner.parentElement;
      }
      if (owner === host) runtimeVisualArrayPush(result, node);
    }
    return result;
  };
  const reviewVisualFingerprint = (element, positionSensitive = false, budget) => {
    if (budget.failureReason) {
      return { visible: false, unverified: true, failureReason: budget.failureReason };
    }
    if (runtimeVisualPerformanceNow() - budget.startedAt > 1_500) {
      return { visible: false, unverified: true, failureReason: "global-time-budget" };
    }
    const owned = reviewVisualOwnedElements(element, budget);
    if (!owned) return {
      visible: false,
      unverified: true,
      failureReason: budget.failureReason || "node-budget",
    };
    const rootStyle = runtimeVisualGetComputedStyle(element);
    const rootRect = runtimeVisualElementGetBoundingClientRect(element);
    let stableParent = element.parentElement;
    while (stableParent && !runtimeVisualElementGetAttribute(stableParent, "data-stemmio-id")) {
      stableParent = stableParent.parentElement;
    }
    const stableParentRect = stableParent
      ? runtimeVisualElementGetBoundingClientRect(stableParent)
      : null;
    const ownedSet = new RuntimeVisualSet(owned);
    if (runtimeVisualArraySome(budget.animations, (animation) => (
      animation.playState === "running"
      && runtimeVisualSetHas(ownedSet, animation.effect?.target)
    ))) {
      return { visible: false, unverified: true, failureReason: "animation" };
    }
    if (runtimeVisualArraySome(owned, (node) => runtimeVisualElementMatches(node, "video,audio"))) {
      return { visible: false, unverified: true, failureReason: "live-media" };
    }
    let visible = false;
    const pieces = [];
    const presentation = (style) => [
      style.display, style.visibility, style.opacity, style.color,
      style.backgroundColor, style.borderTopColor, style.borderRightColor,
      style.borderBottomColor, style.borderLeftColor, style.borderTopWidth,
      style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth,
      style.borderTopStyle, style.borderRightStyle, style.borderBottomStyle,
      style.borderLeftStyle, style.fontFamily, style.fontSize, style.fontWeight,
      style.lineHeight, style.width, style.height, style.paddingTop,
      style.paddingRight, style.paddingBottom, style.paddingLeft, style.marginTop,
      style.marginRight, style.marginBottom, style.marginLeft, style.gap,
      style.rowGap, style.columnGap, style.borderRadius, style.boxShadow,
      style.transform, style.filter, style.mask, style.clipPath,
    ];
    for (let index = 0; index < owned.length; index += 1) {
      const node = owned[index];
      const style = runtimeVisualGetComputedStyle(node);
      const rect = runtimeVisualElementGetBoundingClientRect(node);
      const directText = [];
      for (let child = node.firstChild; child; child = child.nextSibling) {
        if (child.nodeType === 3) runtimeVisualArrayPush(directText, runtimeVisualNodeTextContent(child));
      }
      let visibleText = runtimeVisualNormalizeText(runtimeVisualArrayJoin(directText, " "));
      let effectiveOpacity = 1;
      for (let ancestor = node; ancestor; ancestor = ancestor.parentElement) {
        effectiveOpacity *= Number(runtimeVisualGetComputedStyle(ancestor).opacity || 1);
        if (ancestor === element) break;
      }
      const nodeVisible = style.display !== "none" && style.visibility !== "hidden"
        && effectiveOpacity > 0 && (
          (rect.width > 0 && rect.height > 0)
          || (style.display === "contents" && Boolean(visibleText))
        );
      visible ||= nodeVisible;
      if (!nodeVisible) continue;
      if (style.textTransform === "uppercase") {
        visibleText = runtimeVisualStringToUpperCase(visibleText);
      } else if (style.textTransform === "lowercase") {
        visibleText = runtimeVisualStringToLowerCase(visibleText);
      }
      runtimeVisualArrayPush(
        pieces,
        visibleText,
        String(Math.round(rect.width * 2) / 2),
        String(Math.round(rect.height * 2) / 2),
      );
      runtimeVisualArrayForEach(presentation(style), (value) => runtimeVisualArrayPush(pieces, value));
      const pseudoNames = ["::before", "::after"];
      for (let pseudoIndex = 0; pseudoIndex < pseudoNames.length; pseudoIndex += 1) {
        const pseudoName = pseudoNames[pseudoIndex];
        const pseudo = runtimeVisualGetComputedStyle(node, pseudoName);
        runtimeVisualArrayPush(
          pieces,
          pseudo.content,
          pseudo.display,
          pseudo.visibility,
          pseudo.opacity,
          pseudo.color,
          pseudo.backgroundColor,
          pseudo.fontSize,
          pseudo.fontWeight,
          pseudo.width,
          pseudo.height,
        );
      }
      if (runtimeVisualElementMatches(node, "canvas")) {
        const width = runtimeVisualCanvasWidth(node);
        const height = runtimeVisualCanvasHeight(node);
        budget.pixels += width * height;
        if (budget.pixels > 4_000_000) {
          budget.failureReason = "global-pixel-budget";
          return { visible, unverified: true, failureReason: budget.failureReason };
        }
        try {
          const context = runtimeVisualCanvasGetContext(node, "2d", { willReadFrequently: true });
          if (!context) return { visible, unverified: true, failureReason: "webgl-or-unreadable-canvas" };
          const pixels = runtimeVisualCanvasGetImageData(context, 0, 0, width, height).data;
          runtimeVisualArrayPush(pieces, "canvas", String(width), String(height), reviewVisualPixelHash(pixels));
        } catch {
          return { visible, unverified: true, failureReason: "tainted-canvas" };
        }
      }
      if (runtimeVisualElementMatches(node, "img")) {
        if (!node.complete || !node.naturalWidth || !node.naturalHeight) {
          return { visible, unverified: true, failureReason: "image-not-ready" };
        }
        budget.pixels += node.naturalWidth * node.naturalHeight;
        if (budget.pixels > 4_000_000) {
          budget.failureReason = "global-pixel-budget";
          return { visible, unverified: true, failureReason: budget.failureReason };
        }
        try {
          const imageCanvas = runtimeVisualDocumentCreateElement(document, "canvas");
          imageCanvas.width = node.naturalWidth;
          imageCanvas.height = node.naturalHeight;
          const imageContext = runtimeVisualCanvasGetContext(
            imageCanvas,
            "2d",
            { willReadFrequently: true },
          );
          if (!imageContext) {
            return { visible, unverified: true, failureReason: "image-unreadable" };
          }
          runtimeVisualCanvasDrawImage(
            imageContext,
            node,
            0,
            0,
            node.naturalWidth,
            node.naturalHeight,
          );
          const imagePixels = runtimeVisualCanvasGetImageData(
            imageContext,
            0,
            0,
            node.naturalWidth,
            node.naturalHeight,
          ).data;
          runtimeVisualArrayPush(
            pieces,
            "image",
            String(node.naturalWidth),
            String(node.naturalHeight),
            reviewVisualPixelHash(imagePixels),
          );
        } catch {
          return { visible, unverified: true, failureReason: "tainted-image" };
        }
      }
      if (node.namespaceURI === "http://www.w3.org/2000/svg") {
        runtimeVisualArrayPush(
          pieces,
          "svg",
          runtimeVisualElementGetAttribute(node, "d") || "",
          runtimeVisualElementGetAttribute(node, "points") || "",
          runtimeVisualElementGetAttribute(node, "x") || "",
          runtimeVisualElementGetAttribute(node, "y") || "",
          runtimeVisualElementGetAttribute(node, "width") || "",
          runtimeVisualElementGetAttribute(node, "height") || "",
          style.fill,
          style.stroke,
          style.strokeWidth,
          style.opacity,
          style.filter,
          style.mask,
          style.clipPath,
        );
      }
      if (runtimeVisualPerformanceNow() - budget.startedAt > 1_500) {
        budget.failureReason = "global-time-budget";
        return { visible, unverified: true, failureReason: budget.failureReason };
      }
    }
    if (
      !visible
      && rootStyle.display !== "none"
      && rootStyle.visibility !== "hidden"
      && Number(rootStyle.opacity || 1) > 0
      && (rootRect.width <= 0 || rootRect.height <= 0)
    ) return { visible: false, unverified: true, failureReason: "hidden-context" };
    if (positionSensitive && stableParentRect) runtimeVisualArrayPush(
      pieces,
      "local-position",
      String(Math.round((rootRect.left - stableParentRect.left) * 2) / 2),
      String(Math.round((rootRect.top - stableParentRect.top) * 2) / 2),
    );
    return { visible, fingerprint: reviewVisualHash(pieces) };
  };
  let reviewVisualObservationSequence = 0;
  const renderReviewCommentHighlight = (stableIds, rawContextVisibility = 15) => {
    document.querySelector('[data-stemmio-review-comment-highlight-layer]')?.remove();
    if (!stableIds.length) return;
    const stableId = stableIds[0];
    const element = reviewVisualStableElement(stableId);
    if (!element) return;
    const rect = runtimeVisualElementGetBoundingClientRect(element);
    if (rect.width <= 0 || rect.height <= 0) return;
    const inset = 3;
    const documentWidth = runtimeVisualMathMax(
      innerWidth,
      document.documentElement.scrollWidth,
      document.body?.scrollWidth || 0,
    );
    const height = runtimeVisualMathMax(innerHeight, documentHeight());
    const left = clamp(rect.left + scrollX - inset, 0, documentWidth);
    const top = clamp(rect.top + scrollY - inset, 0, height);
    const right = clamp(rect.right + scrollX + inset, 0, documentWidth);
    const bottom = clamp(rect.bottom + scrollY + inset, 0, height);
    const width = right - left;
    const boxHeight = bottom - top;
    if (width <= 0 || boxHeight <= 0) return;
    const layer = document.createElement("div");
    layer.setAttribute("data-stemmio-review-comment-highlight-layer", "true");
    layer.style.setProperty("position", "absolute", "important");
    layer.style.setProperty("inset", "0", "important");
    layer.style.setProperty("z-index", "2147483000", "important");
    layer.style.setProperty("pointer-events", "none", "important");
    layer.style.setProperty("width", documentWidth + "px", "important");
    layer.style.setProperty("height", height + "px", "important");
    const namespace = "http://www.w3.org/2000/svg";
    const resetCommentPrimitive = (node, fill = "") => {
      node.style.setProperty("display", "block", "important");
      node.style.setProperty("margin", "0", "important");
      node.style.setProperty("padding", "0", "important");
      node.style.setProperty("border", "0", "important");
      node.style.setProperty("outline", "none", "important");
      node.style.setProperty("opacity", "1", "important");
      node.style.setProperty("filter", "none", "important");
      node.style.setProperty("backdrop-filter", "none", "important");
      node.style.setProperty("-webkit-backdrop-filter", "none", "important");
      node.style.setProperty("mix-blend-mode", "normal", "important");
      node.style.setProperty("transform", "none", "important");
      node.style.setProperty("pointer-events", "none", "important");
      if (!fill) return;
      node.style.setProperty("fill", fill, "important");
      node.style.setProperty("fill-opacity", "1", "important");
      node.style.setProperty("stroke", "none", "important");
    };
    const svg = document.createElementNS(namespace, "svg");
    svg.setAttribute("data-stemmio-review-comment-mask", "true");
    svg.setAttribute("width", String(documentWidth));
    svg.setAttribute("height", String(height));
    svg.setAttribute("viewBox", "0 0 " + documentWidth + " " + height);
    svg.style.setProperty("position", "absolute", "important");
    svg.style.setProperty("inset", "0", "important");
    resetCommentPrimitive(svg);
    const maskId = "stemmio-review-comment-mask-"
      + reviewMaskSessionKey + "-" + side + "-" + (++overlayMaskSequence);
    const mask = document.createElementNS(namespace, "mask");
    mask.setAttribute("id", maskId);
    mask.setAttribute("maskUnits", "userSpaceOnUse");
    mask.setAttribute("maskContentUnits", "userSpaceOnUse");
    resetCommentPrimitive(mask);
    const maskBackground = document.createElementNS(namespace, "rect");
    maskBackground.setAttribute("x", "0");
    maskBackground.setAttribute("y", "0");
    maskBackground.setAttribute("width", String(documentWidth));
    maskBackground.setAttribute("height", String(height));
    maskBackground.setAttribute("fill", "#ffffff");
    resetCommentPrimitive(maskBackground, "#ffffff");
    const hole = document.createElementNS(namespace, "rect");
    hole.setAttribute("data-stemmio-review-comment-mask-hole", stableId);
    hole.setAttribute("x", String(left));
    hole.setAttribute("y", String(top));
    hole.setAttribute("width", String(width));
    hole.setAttribute("height", String(boxHeight));
    hole.setAttribute("fill", "#000000");
    resetCommentPrimitive(hole, "#000000");
    mask.append(maskBackground, hole);
    const defs = document.createElementNS(namespace, "defs");
    resetCommentPrimitive(defs);
    defs.append(mask);
    const dim = document.createElementNS(namespace, "rect");
    dim.setAttribute("data-stemmio-review-comment-mask-dim", "true");
    dim.setAttribute("x", "0");
    dim.setAttribute("y", "0");
    dim.setAttribute("width", String(documentWidth));
    dim.setAttribute("height", String(height));
    dim.setAttribute("fill", "#ffffff");
    dim.setAttribute("mask", "url(#" + maskId + ")");
    const dimOpacity = String(
      Math.round((1 - clamp(Number(rawContextVisibility), 0, 100) / 100) * 1_000) / 1_000,
    );
    dim.setAttribute("fill-opacity", dimOpacity);
    resetCommentPrimitive(dim, "#ffffff");
    dim.style.setProperty("fill-opacity", dimOpacity, "important");
    svg.append(defs, dim);
    const box = document.createElement("div");
    box.setAttribute("data-stemmio-review-comment-highlight", "true");
    box.setAttribute("data-left", String(left));
    box.setAttribute("data-top", String(top));
    box.setAttribute("data-width", String(width));
    box.setAttribute("data-height", String(boxHeight));
    box.style.setProperty("position", "absolute", "important");
    box.style.setProperty("border", "2px solid #6258d6", "important");
    box.style.setProperty("border-radius", "6px", "important");
    box.style.setProperty("background", "rgb(98 88 214 / 6%)", "important");
    box.style.setProperty("box-shadow", "0 0 0 2px rgb(255 255 255 / 78%)", "important");
    box.style.setProperty("pointer-events", "none", "important");
    box.style.setProperty("left", left + "px", "important");
    box.style.setProperty("top", top + "px", "important");
    box.style.setProperty("width", width + "px", "important");
    box.style.setProperty("height", boxHeight + "px", "important");
    box.style.setProperty("margin", "0", "important");
    box.style.setProperty("padding", "0", "important");
    box.style.setProperty("outline", "none", "important");
    box.style.setProperty("opacity", "1", "important");
    box.style.setProperty("filter", "none", "important");
    box.style.setProperty("backdrop-filter", "none", "important");
    box.style.setProperty("-webkit-backdrop-filter", "none", "important");
    box.style.setProperty("mix-blend-mode", "normal", "important");
    box.style.setProperty("transform", "none", "important");
    layer.append(svg, box);
    document.documentElement.append(layer);
  };
  if (reviewVisualChannel) reviewVisualChannel.port1.onmessage = (event) => {
    const request = event.data;
    if (request?.type === "comment-highlight" && request.sessionId === sessionId
      && request.side === side && Array.isArray(request.stableIds)) {
      const stableIds = request.active === true
        ? runtimeVisualArraySlice(request.stableIds, 0, 1)
        : [];
      commentHighlightActive = stableIds.length > 0;
      document.documentElement.dataset.stemmioReviewCommentFocus = commentHighlightActive
        ? "true"
        : "false";
      document.documentElement.dataset.stemmioReviewFocusGroup = commentHighlightActive
        ? ""
        : currentState.activeFocusGroupId || "";
      document.documentElement.dataset.stemmioReviewFocusRegion = commentHighlightActive
        ? ""
        : currentState.activeFocusRegionId || "";
      renderReviewCommentHighlight(stableIds, request.contextVisibility);
      scheduleOverlayRender();
      return;
    }
    if (request?.type === "verdicts" && request.sessionId === sessionId && request.side === side
      && Array.isArray(request.changed)) {
      runtimeVisualArrayForEach(runtimeVisualQueryElements('[data-stemmio-review-confirmed="true"]'), (element) => {
        runtimeVisualElementRemoveAttribute(element, "data-stemmio-review-confirmed");
      });
      runtimeVisualArrayForEach(runtimeVisualQueryElements('[data-stemmio-review-runtime-visual-marker="true"]'), (element) => {
        runtimeVisualElementRemoveAttribute(element, "data-stemmio-review-marker");
        runtimeVisualElementRemoveAttribute(element, "data-stemmio-review-marker-types");
        runtimeVisualElementRemoveAttribute(element, "data-stemmio-review-summary");
        runtimeVisualElementRemoveAttribute(element, "data-stemmio-review-runtime-visual-marker");
      });
      const nextConfirmed = new RuntimeVisualSet();
      runtimeVisualArrayForEach(request.changed, (candidate) => {
        const changeId = safeKey(candidate?.id);
        if (!changeId) return;
        runtimeVisualSetAdd(nextConfirmed, changeId);
        const stableId = RuntimeVisualString(candidate?.stableId || "");
        const element = reviewVisualStableElement(stableId);
        if (!element) return;
        if (runtimeVisualElementGetAttribute(element, "data-stemmio-review-marker")) return;
        runtimeVisualElementSetAttribute(element, "data-stemmio-review-marker", changeId);
        runtimeVisualElementSetAttribute(
          element,
          "data-stemmio-review-marker-types",
          candidate.types ? runtimeVisualArrayJoin(candidate.types, " ") : "structure",
        );
        runtimeVisualElementSetAttribute(element, "data-stemmio-review-summary", "元素变化");
        runtimeVisualElementSetAttribute(element, "data-stemmio-review-active", "true");
        runtimeVisualElementSetAttribute(element, "data-stemmio-review-runtime-visual-marker", "true");
      });
      runtimeVisualArrayForEach(runtimeVisualQueryElements("[data-stemmio-review-marker]"), (element) => {
        const changeId = safeKey(runtimeVisualElementGetAttribute(
          element,
          "data-stemmio-review-marker",
        ));
        if (runtimeVisualSetHas(nextConfirmed, changeId)) {
          runtimeVisualElementSetAttribute(element, "data-stemmio-review-confirmed", "true");
        }
      });
      projectedSourceChangeIds = nextConfirmed;
      scheduleOverlayRender();
      return;
    }
    if (!request || request.type !== "observe" || request.sessionId !== sessionId || request.side !== side
      || !Array.isArray(request.candidates) || typeof request.sourceHash !== "string") return;
    const observationSequence = ++reviewVisualObservationSequence;
    const candidates = request.candidates;
    const sample = (complete) => {
      const observations = [];
      const budget = {
        startedAt: runtimeVisualPerformanceNow(),
        nodes: 0,
        pixels: 0,
        failureReason: "",
        animations: runtimeVisualDocumentGetAnimations(document),
      };
      let candidateIndex = 0;
      const sampleBatch = () => {
        const batchEnd = candidateIndex + 24;
        while (candidateIndex < candidates.length && candidateIndex < batchEnd) {
          const candidate = candidates[candidateIndex];
          const stableId = RuntimeVisualString(candidate?.stableId || "");
          const element = reviewVisualStableElement(stableId);
          const expectedPresent = candidate?.present === true;
          const result = element
            ? reviewVisualFingerprint(element, candidate?.positionSensitive === true, budget)
            : expectedPresent
              ? { visible: false, unverified: true, failureReason: "missing-runtime-host" }
              : { visible: false, fingerprint: "absent" };
          runtimeVisualArrayPush(observations, {
            sessionId,
            side,
            sourceHash: request.sourceHash,
            generation: request.generation,
            stableId,
            ...result,
          });
          candidateIndex += 1;
        }
        if (candidateIndex < candidates.length) {
          runtimeVisualRequestAnimationFrame(sampleBatch);
          return;
        }
        complete(observations);
      };
      sampleBatch();
    };
    sample((first) => {
      runtimeVisualSetTimeout(() => runtimeVisualRequestAnimationFrame(() => (
        runtimeVisualRequestAnimationFrame(() => {
          if (observationSequence !== reviewVisualObservationSequence) return;
          sample((second) => {
            if (observationSequence !== reviewVisualObservationSequence) return;
            const observations = runtimeVisualArrayMap(second, (current, index) => {
              const previous = first[index];
              if (
                !previous
                || previous.unverified
                || current.unverified
                || previous.visible !== current.visible
                || previous.fingerprint !== current.fingerprint
              ) return {
                ...current,
                fingerprint: undefined,
                unverified: true,
                failureReason: current.failureReason || previous?.failureReason || "unstable",
              };
              return current;
            });
            reviewVisualChannel.port1.postMessage({ type: "observations", observations });
          });
        })
      )), 650);
    });
  };
  const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
  const documentHeight = () => Math.max(
    document.documentElement.scrollHeight,
    document.body?.scrollHeight || 0,
  );
  // Scrollbars shrink the layout viewport below the window height: a vertical
  // bar narrows the page enough to grow a horizontal bar, and the visible
  // height then trails the window height by that bar. Measuring the scroll
  // range against the window height reports a maximum short of where native
  // scrolling actually lands, and every clamp built on it fights the browser:
  // at the page end the synchronized page gets yanked backwards.
  const visibleHeight = () => {
    const scroller = document.scrollingElement || document.documentElement;
    return scroller?.clientHeight || innerHeight;
  };
  const maximumScrollTop = () => Math.max(0, documentHeight() - visibleHeight());
  const safeKey = (value) => {
    const source = RuntimeVisualString(value || "");
    let result = "";
    for (let index = 0; index < source.length; index += 1) {
      const code = runtimeVisualStringCharCodeAt(source, index);
      if (
        (code >= 0x30 && code <= 0x39)
        || (code >= 0x41 && code <= 0x5a)
        || (code >= 0x61 && code <= 0x7a)
        || code === 0x2d
      ) result += source[index];
    }
    return result;
  };
  const safePanelPath = (value) => {
    const source = runtimeVisualArrayIsArray(value)
      ? value
      : runtimeVisualStringSplit(RuntimeVisualString(value || ""), /\s+/u);
    const safeValues = runtimeVisualArrayFilter(
      runtimeVisualArrayMap(source, safeKey),
      runtimeVisualBoolean,
    );
    const unique = [];
    runtimeVisualSetForEach(
      new RuntimeVisualSet(safeValues),
      (entry) => runtimeVisualArrayPush(unique, entry),
    );
    return unique;
  };
  const safeStableId = (value) => {
    const stableId = RuntimeVisualString(value || "");
    return runtimeVisualRegExpExec(/^sm1_[0-9a-f]{32}$/iu, stableId) !== null
      ? stableId
      : "";
  };
  const safeRevealSteps = (value) => {
    if (!Array.isArray(value)) return [];
    const seen = new Set();
    return runtimeVisualArrayFlatMap(value, (candidate) => {
      if (!candidate || typeof candidate !== "object") return [];
      if (candidate.kind === "panel") {
        const key = safeKey(candidate.key);
        const identity = "panel:" + key;
        if (!key || seen.has(identity)) return [];
        seen.add(identity);
        return [{ kind: "panel", key }];
      }
      if (candidate.kind === "details") {
        const stableId = safeStableId(candidate.stableId);
        const identity = "details:" + stableId;
        if (!stableId || seen.has(identity)) return [];
        seen.add(identity);
        return [{ kind: "details", stableId }];
      }
      return [];
    });
  };
  const runtimeVisualSourceBoxAttributes = ${JSON.stringify(REVIEW_COMMENT_BINDING_SOURCE_BOX_ATTRIBUTES)};
  const runtimeVisualIdentityAttributeLimit = ${REVIEW_BOOTSTRAP_IDENTITY_ATTRIBUTE_LIMIT};
  const safeReviewCommentSourceNodeId = (value) => safeStableId(value);
  const runtimeVisualSourceBoxSignature = (host) => runtimeVisualStringify(
    runtimeVisualArrayMap(
      runtimeVisualSourceBoxAttributes,
      (attribute) => [attribute, runtimeVisualElementGetAttribute(host, attribute)],
    ),
  );
  const runtimeVisualDocumentRoot = document.documentElement;
  const runtimeVisualInitialBindingPath = (value) => {
    if (!runtimeVisualArrayIsArray(value) || value.length > 256) return null;
    const path = [];
    for (let index = 0; index < value.length; index += 1) {
      const part = value[index];
      if (
        typeof part !== "number"
        || part < 0
        || part > 1000000
        || runtimeVisualMathFloor(part) !== part
      ) return null;
      runtimeVisualArrayPush(path, part);
    }
    return path;
  };
  const runtimeVisualInitialBindingPathElement = (rawPath) => {
    const path = runtimeVisualInitialBindingPath(rawPath);
    if (!path || !runtimeVisualIsInstance(RuntimeVisualElement, runtimeVisualDocumentRoot)) {
      return null;
    }
    let element = runtimeVisualDocumentRoot;
    for (let index = 0; index < path.length; index += 1) {
      const children = runtimeVisualElementChildren(element);
      const childIndex = path[index];
      if (childIndex >= runtimeVisualHtmlCollectionLength(children)) return null;
      const child = runtimeVisualHtmlCollectionItem(children, childIndex);
      if (!runtimeVisualIsInstance(RuntimeVisualElement, child)) return null;
      element = child;
    }
    return element;
  };
  const runtimeVisualInitialBindingPathMatches = (element, binding) => (
    runtimeVisualInitialBindingPathElement(binding?.path) === element
  );
  const runtimeVisualInitialBindingIdentityAttributes = (binding) => {
    const runtimeVisualBindingAttributeNamePattern = /^[a-z_:][a-z0-9:._-]{0,127}$/iu;
    const runtimeVisualOwnedAttributeNamePattern = /^data-stemmio-/iu;
    const rawAttributes = binding?.identityAttributes;
    if (
      !runtimeVisualArrayIsArray(rawAttributes)
      || rawAttributes.length > runtimeVisualIdentityAttributeLimit
    ) return null;
    const attributes = [];
    for (let index = 0; index < rawAttributes.length; index += 1) {
      const rawAttribute = rawAttributes[index];
      if (!runtimeVisualArrayIsArray(rawAttribute) || rawAttribute.length !== 2) return null;
      const name = RuntimeVisualString(rawAttribute[0] || "");
      const value = RuntimeVisualString(rawAttribute[1] || "");
      const ownedAttribute = runtimeVisualRegExpExec(
        runtimeVisualOwnedAttributeNamePattern,
        name,
      ) !== null;
      if (
        runtimeVisualRegExpExec(runtimeVisualBindingAttributeNamePattern, name) === null
        || (
          ownedAttribute
          && runtimeVisualStringToLowerCase(name) !== "data-stemmio-id"
        )
        || value.length > 1024
      ) return null;
      runtimeVisualArrayPush(attributes, [name, value]);
    }
    return attributes;
  };
  const runtimeVisualInitialBindingIgnoresIdentityText = (
    identityAttributes,
    identityText,
  ) => {
    if (!identityText) return true;
    if (!identityAttributes?.length) return false;
    // A class-only fingerprint is intentionally text-sensitive. Class names
    // are commonly shared by sibling comment targets, so dropping the frozen
    // text would make the final uniqueness pass bind an arbitrary sibling.
    return !identityAttributes.every(([name]) => (
      runtimeVisualStringToLowerCase(RuntimeVisualString(name)) === "class"
    ));
  };
  const runtimeVisualInitialBindingMatches = (
    element,
    binding,
    ignoreIdentityText = false,
  ) => {
    if (!runtimeVisualIsInstance(RuntimeVisualElement, element)) return false;
    const tagName = RuntimeVisualString(binding?.tagName || "");
    const sourceBoxSignature = RuntimeVisualString(binding?.sourceBoxSignature || "");
    const identityAttributes = runtimeVisualInitialBindingIdentityAttributes(binding);
    const identityText = typeof binding?.identityText === "string"
      ? RuntimeVisualString(binding.identityText)
      : "";
    if (
      !(
        tagName.length > 0
        && tagName.length <= 128
        && sourceBoxSignature.length > 0
        && sourceBoxSignature.length <= 4096
        && identityAttributes !== null
        && identityText.length <= 1024
        && runtimeVisualElementTagName(element) === tagName
      )
    ) return false;
    for (let index = 0; index < identityAttributes.length; index += 1) {
      const [name, value] = identityAttributes[index];
      if (runtimeVisualElementGetAttribute(element, name) !== value) return false;
    }
    return ignoreIdentityText
      || !identityText
      || runtimeVisualNormalizeText(runtimeVisualNodeTextContent(element) || "")
        .slice(0, 1024) === identityText;
  };
  const runtimeVisualInitialBindingHasFingerprint = (binding) => {
    const attributes = runtimeVisualInitialBindingIdentityAttributes(binding);
    return runtimeVisualBoolean(
      attributes?.length
      || (typeof binding?.identityText === "string" && binding.identityText.length),
    );
  };
  const runtimeVisualInitialBindingSourceBoxMatches = (element, binding) => (
    RuntimeVisualString(binding?.sourceBoxSignature || "")
      === runtimeVisualSourceBoxSignature(element)
  );
  const runtimeVisualInitialBindingElement = (binding, useFrozenPath = true) => {
    const pathElement = runtimeVisualInitialBindingPathElement(binding?.path);
    const identityAttributes = runtimeVisualInitialBindingIdentityAttributes(binding);
    const identityText = typeof binding?.identityText === "string"
      ? RuntimeVisualString(binding.identityText)
      : "";
    if (useFrozenPath && runtimeVisualInitialBindingMatches(
      pathElement,
      binding,
      runtimeVisualInitialBindingIgnoresIdentityText(identityAttributes, identityText),
    )) return pathElement;
    if (runtimeVisualDocumentReadyState(document) === "loading") return null;
    if (!runtimeVisualInitialBindingHasFingerprint(binding)) return null;
    const matching = [];
    runtimeVisualArrayForEach(runtimeVisualQueryElements("*"), (element) => {
      if (
        matching.length < 2
        && runtimeVisualInitialBindingMatches(
          element,
          binding,
          runtimeVisualInitialBindingIgnoresIdentityText(identityAttributes, identityText),
        )
      ) runtimeVisualArrayPush(matching, element);
    });
    return matching.length === 1 ? matching[0] : null;
  };
  const createPrivateInitialBindingRegistry = (
    initialBindings,
    bindingId,
  ) => {
    const identityElements = new RuntimeVisualMap();
    const deferredBindings = new RuntimeVisualMap();
    const invalidBindingIds = new RuntimeVisualSet();
    const bindingById = new RuntimeVisualMap();
    runtimeVisualArrayForEach(initialBindings, (binding) => {
      const id = bindingId(binding);
      if (!id) return;
      if (runtimeVisualMapHas(bindingById, id)) {
        runtimeVisualSetAdd(invalidBindingIds, id);
        return;
      }
      runtimeVisualMapSet(bindingById, id, binding);
    });
    const initialBindingForPath = (element, binding) => {
      let matchingBinding = null;
      runtimeVisualArrayForEach(initialBindings, (candidate) => {
        const candidateId = bindingId(candidate);
        if (
          matchingBinding
          || candidate === binding
          || !candidateId
          || runtimeVisualSetHas(invalidBindingIds, candidateId)
          || !runtimeVisualInitialBindingPathMatches(element, candidate)
          || !runtimeVisualInitialBindingMatches(element, candidate, true)
          || !runtimeVisualInitialBindingSourceBoxMatches(element, candidate)
        ) return;
        matchingBinding = candidate;
      });
      return matchingBinding;
    };
    const capture = (binding, observedElement = null) => {
      const id = bindingId(binding);
      if (!id || runtimeVisualSetHas(invalidBindingIds, id)) return;
      if (observedElement !== null) {
        const identityAttributes = runtimeVisualInitialBindingIdentityAttributes(binding);
        const identityText = typeof binding?.identityText === "string"
          ? RuntimeVisualString(binding.identityText)
          : "";
        const pathMatches = runtimeVisualInitialBindingPathMatches(observedElement, binding);
        const hasFingerprint = runtimeVisualInitialBindingHasFingerprint(binding);
        if (
          pathMatches
          && !hasFingerprint
          && runtimeVisualInitialBindingMatches(observedElement, binding, true)
        ) {
          const existing = runtimeVisualMapGet(identityElements, id);
          if (existing && existing !== observedElement) {
            runtimeVisualSetAdd(invalidBindingIds, id);
            return;
          }
          if (!existing) runtimeVisualMapSet(identityElements, id, observedElement);
          return;
        }
        // A path-only binding cannot distinguish a same-tag parser decoy after
        // its frozen path shifts. Keep that private identity unavailable.
        if (
          !pathMatches
          && !hasFingerprint
          && runtimeVisualInitialBindingMatches(observedElement, binding, true)
          && runtimeVisualInitialBindingSourceBoxMatches(observedElement, binding)
        ) {
          if (initialBindingForPath(observedElement, binding)) return;
          runtimeVisualSetAdd(invalidBindingIds, id);
          return;
        }
        if (!runtimeVisualInitialBindingMatches(
          observedElement,
          binding,
          runtimeVisualInitialBindingIgnoresIdentityText(identityAttributes, identityText),
        )) return;
        runtimeVisualMapSet(deferredBindings, binding, true);
        return;
      }
      const element = runtimeVisualInitialBindingElement(
        binding,
        !runtimeVisualMapHas(deferredBindings, binding),
      );
      if (!element) return;
      const existing = runtimeVisualMapGet(identityElements, id);
      if (existing && existing !== element) {
        runtimeVisualSetAdd(invalidBindingIds, id);
        return;
      }
      if (!existing) runtimeVisualMapSet(identityElements, id, element);
    };
    const captureAll = (observedElement = null) => runtimeVisualArrayForEach(
      initialBindings,
      (binding) => capture(binding, observedElement),
    );
    const captureDeferred = () => runtimeVisualArrayForEach(initialBindings, (binding) => {
      if (runtimeVisualMapHas(deferredBindings, binding)) capture(binding);
    });
    return {
      identityElements,
      deferredBindings,
      invalidBindingIds,
      captureAll,
      captureDeferred,
    };
  };
  const reviewCommentBindingRegistry = createPrivateInitialBindingRegistry(
    reviewCommentInitialBindings,
    (binding) => safeReviewCommentSourceNodeId(binding?.sourceNodeId),
  );
  const reviewCommentIdentityElements = reviewCommentBindingRegistry.identityElements;
  const reviewCommentDeferredBindings = reviewCommentBindingRegistry.deferredBindings;
  const reviewCommentInvalidSourceNodeIds = reviewCommentBindingRegistry.invalidBindingIds;
  const reviewVisualAllowedStableIds = new RuntimeVisualSet(reviewVisualInitialStableIds);
  const reviewFocusAllowedOwnerIds = new RuntimeVisualSet();
  runtimeVisualArrayForEach(reviewFocusGroupPlans, (plan) => {
    runtimeVisualArrayForEach(plan.regions[side] || [], (region) => {
      runtimeVisualArrayForEach(region.displayOwnerIds, (ownerId) => {
        runtimeVisualSetAdd(reviewFocusAllowedOwnerIds, ownerId);
      });
    });
  });
  const reviewExactAtomOccurrenceCounts = new RuntimeVisualMap();
  const safeProjectionIdentityPart = (value) => {
    const candidate = RuntimeVisualString(value || "");
    return runtimeVisualRegExpExec(/^[a-z0-9:_-]{1,160}$/iu, candidate) === null
      ? ""
      : candidate;
  };
  runtimeVisualArrayForEach(reviewExactAtomOccurrences, (entry) => {
    const atomKey = RuntimeVisualString(entry?.atomKey || "");
    const parts = runtimeVisualStringSplit(atomKey, "\u001e");
    const factParts = parts.length === 2 ? runtimeVisualStringSplit(parts[1], "\u001f") : [];
    const count = Number(entry?.count);
    if (
      parts.length !== 2
      || safeProjectionIdentityPart(parts[0]) !== parts[0]
      || factParts.length !== 4
      || (factParts[0] !== "text" && factParts[0] !== "structure")
      || safeProjectionIdentityPart(factParts[1]) !== factParts[1]
      || safeProjectionIdentityPart(factParts[2]) !== factParts[2]
      || (factParts[3] && safeProjectionIdentityPart(factParts[3]) !== factParts[3])
      || !runtimeVisualNumberIsFinite(count)
      || count < 1
      || count > 128
      || runtimeVisualMathFloor(count) !== count
      || runtimeVisualMapHas(reviewExactAtomOccurrenceCounts, atomKey)
    ) return;
    runtimeVisualMapSet(reviewExactAtomOccurrenceCounts, atomKey, count);
  });
  const reviewFocusOwnerElements = new RuntimeVisualMap();
  const reviewFocusInvalidOwnerIds = new RuntimeVisualSet();
  const reviewFocusAtomEntries = new RuntimeVisualMap();
  const reviewFocusInvalidAtomKeys = new RuntimeVisualSet();
  const reviewFocusAncestorForOwnerId = (element, ownerId) => {
    let candidate = element;
    while (candidate) {
      const currentIds = RuntimeVisualString(runtimeVisualElementGetAttribute(
        candidate,
        "data-stemmio-review-display-owner",
      ) || "");
      if (runtimeVisualArraySome(
        runtimeVisualStringSplit(currentIds, /\s+/u),
        (currentId) => currentId === ownerId,
      )) return candidate;
      candidate = candidate.parentElement;
    }
    return null;
  };
  const captureReviewFocusOwner = (element, rawOwnerIds = "") => {
    if (!runtimeVisualIsInstance(RuntimeVisualElement, element)) return;
    const serializedOwnerIds = RuntimeVisualString(
      rawOwnerIds || runtimeVisualElementGetAttribute(
        element,
        "data-stemmio-review-display-owner",
      ) || "",
    );
    runtimeVisualArrayForEach(runtimeVisualStringSplit(serializedOwnerIds, /\s+/u), (ownerId) => {
      if (!runtimeVisualSetHas(reviewFocusAllowedOwnerIds, ownerId)) return;
      const existing = runtimeVisualMapGet(reviewFocusOwnerElements, ownerId);
      if (existing && existing !== element) runtimeVisualSetAdd(reviewFocusInvalidOwnerIds, ownerId);
      else if (!existing) runtimeVisualMapSet(reviewFocusOwnerElements, ownerId, element);
    });
  };
  const captureReviewFocusAtom = (
    element,
    rawChangeId = "",
    rawSerializedFacts = "",
    rawTextTone = "",
  ) => {
    if (!runtimeVisualIsInstance(RuntimeVisualElement, element)) return;
    const changeId = safeKey(rawChangeId || runtimeVisualElementGetAttribute(
      element,
      "data-stemmio-review-marker",
    ));
    const serializedFacts = RuntimeVisualString(rawSerializedFacts || runtimeVisualElementGetAttribute(
      element,
      "data-stemmio-review-projection-facts",
    ) || "");
    if (!changeId || !serializedFacts) return;
    runtimeVisualArrayForEach(projectionFactsForSerialized(serializedFacts), (fact) => {
      const atomKey = changeId + "\u001e" + projectionFactIdentity(fact);
      const expectedCount = runtimeVisualMapGet(reviewExactAtomOccurrenceCounts, atomKey) || 0;
      if (!expectedCount || runtimeVisualSetHas(reviewFocusInvalidAtomKeys, atomKey)) return;
      const displayOwnerId = fact.displayOwnerId
        || fact.geometryOwnerId
        || fact.semanticOwnerId;
      const displayOwnerElement = reviewFocusAncestorForOwnerId(element, displayOwnerId);
      if (
        !displayOwnerElement
        || !runtimeVisualElementContains(displayOwnerElement, element)
      ) {
        runtimeVisualSetAdd(reviewFocusInvalidAtomKeys, atomKey);
        return;
      }
      const entries = runtimeVisualMapGet(reviewFocusAtomEntries, atomKey) || [];
      if (runtimeVisualArraySome(entries, (entry) => entry.element === element)) return;
      if (entries.length >= expectedCount) {
        runtimeVisualSetAdd(reviewFocusInvalidAtomKeys, atomKey);
        return;
      }
      runtimeVisualArrayPush(entries, {
        atomKey,
        changeId,
        element,
        fact,
        displayOwnerElement,
        displayOwnerId,
        textContent: RuntimeVisualString(runtimeVisualNodeTextContent(element) || ""),
        textTone: RuntimeVisualString(rawTextTone || runtimeVisualElementGetAttribute(
          element,
          "data-stemmio-review-text",
        ) || ""),
        serializedFacts,
      });
      runtimeVisualMapSet(reviewFocusAtomEntries, atomKey, entries);
    });
  };
  const captureReviewFocusTree = (node) => {
    if (!runtimeVisualIsInstance(RuntimeVisualElement, node)) return;
    captureReviewFocusOwner(node);
    runtimeVisualArrayForEach(
      runtimeVisualElementQuerySelectorAll(node, "[data-stemmio-review-display-owner]"),
      (element) => captureReviewFocusOwner(element),
    );
    captureReviewFocusAtom(node);
    runtimeVisualArrayForEach(
      runtimeVisualElementQuerySelectorAll(node, "[data-stemmio-review-marker]"),
      (element) => captureReviewFocusAtom(element),
    );
  };
  const reviewVisualIdentityElements = new RuntimeVisualMap();
  const reviewVisualInvalidStableIds = new RuntimeVisualSet();
  const captureReviewVisualElement = (element, rawStableId = "") => {
    if (!runtimeVisualIsInstance(RuntimeVisualElement, element)) return;
    const stableId = RuntimeVisualString(
      rawStableId || runtimeVisualElementGetAttribute(element, "data-stemmio-id") || "",
    );
    if (!runtimeVisualSetHas(reviewVisualAllowedStableIds, stableId)) return;
    const existing = runtimeVisualMapGet(reviewVisualIdentityElements, stableId);
    if (existing && existing !== element) {
      runtimeVisualSetAdd(reviewVisualInvalidStableIds, stableId);
      return;
    }
    if (!existing) runtimeVisualMapSet(reviewVisualIdentityElements, stableId, element);
  };
  const captureReviewVisualTree = (node) => {
    if (!runtimeVisualIsInstance(RuntimeVisualElement, node)) return;
    captureReviewVisualElement(node);
    captureReviewFocusTree(node);
    runtimeVisualArrayForEach(
      runtimeVisualElementQuerySelectorAll(node, "[data-stemmio-id]"),
      (element) => captureReviewVisualElement(element),
    );
  };
  runtimeVisualArrayForEach(
    runtimeVisualQueryElements("[data-stemmio-id]"),
    (element) => captureReviewVisualElement(element),
  );
  runtimeVisualArrayForEach(
    runtimeVisualQueryElements("[data-stemmio-review-display-owner]"),
    (element) => captureReviewFocusOwner(element),
  );
  let privateInitialBindingsBootstrapped = false;
  let privateInitialBindingsClosed = false;
  const captureInitialBindings = (records = []) => {
    if (privateInitialBindingsClosed) return;
    if (!privateInitialBindingsBootstrapped) {
      privateInitialBindingsBootstrapped = true;
      reviewCommentBindingRegistry.captureAll();
    }
    // Attribute mutations can remove both halves of an atom identity before
    // the observer callback runs. Reconstruct every marker/fact combination
    // seen in this delivery from oldValue plus the current companion values,
    // and bind those originals before considering newly added authored nodes.
    const atomAttributeHistories = new RuntimeVisualMap();
    runtimeVisualArrayForEach(records, (record) => {
      if (runtimeVisualMutationRecordType(record) !== "attributes") return;
      const element = runtimeVisualMutationRecordTarget(record);
      if (!runtimeVisualIsInstance(RuntimeVisualElement, element)) return;
      const attributeName = runtimeVisualMutationRecordAttributeName(record);
      if (
        attributeName !== "data-stemmio-review-marker"
        && attributeName !== "data-stemmio-review-projection-facts"
        && attributeName !== "data-stemmio-review-text"
      ) return;
      let history = runtimeVisualMapGet(atomAttributeHistories, element);
      if (!history) {
        history = { marker: [], facts: [], tones: [] };
        runtimeVisualArrayPush(history.marker, runtimeVisualElementGetAttribute(
          element,
          "data-stemmio-review-marker",
        ) || "");
        runtimeVisualArrayPush(history.facts, runtimeVisualElementGetAttribute(
          element,
          "data-stemmio-review-projection-facts",
        ) || "");
        runtimeVisualArrayPush(history.tones, runtimeVisualElementGetAttribute(
          element,
          "data-stemmio-review-text",
        ) || "");
        runtimeVisualMapSet(atomAttributeHistories, element, history);
      }
      const oldValue = runtimeVisualMutationRecordOldValue(record) || "";
      if (attributeName === "data-stemmio-review-marker") runtimeVisualArrayPush(history.marker, oldValue);
      if (attributeName === "data-stemmio-review-projection-facts") runtimeVisualArrayPush(history.facts, oldValue);
      if (attributeName === "data-stemmio-review-text") runtimeVisualArrayPush(history.tones, oldValue);
    });
    runtimeVisualMapForEach(atomAttributeHistories, (history, element) => {
      runtimeVisualArrayForEach(history.marker, (changeId) => {
        runtimeVisualArrayForEach(history.facts, (serializedFacts) => {
          runtimeVisualArrayForEach(history.tones, (tone) => {
            captureReviewFocusAtom(element, changeId, serializedFacts, tone);
          });
        });
      });
    });
    runtimeVisualArrayForEach(records, (record) => {
      const recordType = runtimeVisualMutationRecordType(record);
      if (recordType === "attributes") {
        captureReviewVisualElement(
          runtimeVisualMutationRecordTarget(record),
          runtimeVisualMutationRecordOldValue(record),
        );
        captureReviewVisualElement(runtimeVisualMutationRecordTarget(record));
        captureReviewFocusOwner(
          runtimeVisualMutationRecordTarget(record),
          runtimeVisualMutationRecordOldValue(record),
        );
        captureReviewFocusOwner(runtimeVisualMutationRecordTarget(record));
        return;
      }
      if (recordType !== "childList") return;
      const nodeLists = [
        runtimeVisualMutationRecordAddedNodes(record),
        runtimeVisualMutationRecordRemovedNodes(record),
      ];
      for (let listIndex = 0; listIndex < nodeLists.length; listIndex += 1) {
        const nodes = nodeLists[listIndex];
        const nodeCount = runtimeVisualNodeListLength(nodes);
        for (let nodeIndex = 0; nodeIndex < nodeCount; nodeIndex += 1) {
          const node = runtimeVisualNodeListItem(nodes, nodeIndex);
          if (!runtimeVisualIsInstance(RuntimeVisualElement, node)) continue;
          captureReviewVisualTree(node);
          const addedElements = [node];
          runtimeVisualArrayForEach(
            runtimeVisualElementQuerySelectorAll(node, "*"),
            (element) => runtimeVisualArrayPush(addedElements, element),
          );
          runtimeVisualArrayForEach(addedElements, (element) => {
            reviewCommentBindingRegistry.captureAll(element);
          });
        }
      }
    });
  };
  const initialBindingObserver = reviewCommentInitialBindings.length
    || reviewVisualInitialStableIds.length
    || reviewFocusAllowedOwnerIds.size
    || reviewExactAtomOccurrenceCounts.size
    ? new RuntimeVisualMutationObserver(captureInitialBindings)
    : null;
  if (initialBindingObserver && runtimeVisualDocumentRoot) {
    captureInitialBindings();
    runtimeVisualMutationObserverObserve(
      initialBindingObserver,
      runtimeVisualDocumentRoot,
      {
        subtree: true,
        childList: true,
        attributes: true,
        attributeOldValue: true,
        attributeFilter: [
          "data-stemmio-id",
          "data-stemmio-review-display-owner",
          "data-stemmio-review-marker",
          "data-stemmio-review-projection-facts",
          "data-stemmio-review-text",
        ],
      },
    );
  }
  const drainInitialBindings = () => {
    if (!initialBindingObserver || privateInitialBindingsClosed) return;
    captureInitialBindings(runtimeVisualMutationObserverTakeRecords(initialBindingObserver));
  };
  const closeInitialBindings = () => {
    if (!initialBindingObserver || privateInitialBindingsClosed) return;
    drainInitialBindings();
    reviewCommentBindingRegistry.captureDeferred();
    runtimeVisualMutationObserverDisconnect(initialBindingObserver);
    privateInitialBindingsClosed = true;
  };
  const reviewVisualStableElement = (rawStableId) => {
    const stableId = RuntimeVisualString(rawStableId || "");
    if (
      !runtimeVisualSetHas(reviewVisualAllowedStableIds, stableId)
      || runtimeVisualSetHas(reviewVisualInvalidStableIds, stableId)
    ) return null;
    const element = runtimeVisualMapGet(reviewVisualIdentityElements, stableId);
    if (
      !element
      || !runtimeVisualNodeIsConnected(element)
      || runtimeVisualElementGetAttribute(element, "data-stemmio-id") !== stableId
    ) return null;
    const matches = runtimeVisualQueryElements(
      "[data-stemmio-id=\"" + stableId + "\"]",
    );
    return matches.length === 1 && matches[0] === element ? element : null;
  };
  const reviewFocusOwnerElement = (rawOwnerId) => {
    const ownerId = RuntimeVisualString(rawOwnerId || "");
    if (
      !runtimeVisualSetHas(reviewFocusAllowedOwnerIds, ownerId)
      || runtimeVisualSetHas(reviewFocusInvalidOwnerIds, ownerId)
    ) return null;
    const element = runtimeVisualMapGet(reviewFocusOwnerElements, ownerId);
    if (!element || !runtimeVisualNodeIsConnected(element)) return null;
    const currentIds = RuntimeVisualString(runtimeVisualElementGetAttribute(
      element,
      "data-stemmio-review-display-owner",
    ) || "");
    return runtimeVisualArraySome(
      runtimeVisualStringSplit(currentIds, /\s+/u),
      (candidate) => candidate === ownerId,
    ) ? element : null;
  };
  const reviewFocusAtomEntriesForKey = (rawAtomKey) => {
    const atomKey = RuntimeVisualString(rawAtomKey || "");
    if (
      !runtimeVisualMapHas(reviewExactAtomOccurrenceCounts, atomKey)
      || runtimeVisualSetHas(reviewFocusInvalidAtomKeys, atomKey)
    ) return [];
    const entries = runtimeVisualMapGet(reviewFocusAtomEntries, atomKey) || [];
    if (entries.length !== runtimeVisualMapGet(reviewExactAtomOccurrenceCounts, atomKey)) return [];
    const valid = [];
    runtimeVisualArrayForEach(entries, (entry) => {
      if (!runtimeVisualNodeIsConnected(entry.element)) return;
      const currentOwnerIds = RuntimeVisualString(runtimeVisualElementGetAttribute(
        entry.displayOwnerElement,
        "data-stemmio-review-display-owner",
      ) || "");
      if (
        !runtimeVisualNodeIsConnected(entry.displayOwnerElement)
        || !runtimeVisualArraySome(
          runtimeVisualStringSplit(currentOwnerIds, /\s+/u),
          (candidate) => candidate === entry.displayOwnerId,
        )
        || !runtimeVisualElementContains(entry.displayOwnerElement, entry.element)
        || (
          runtimeVisualSetHas(reviewFocusAllowedOwnerIds, entry.displayOwnerId)
          && reviewFocusOwnerElement(entry.displayOwnerId) !== entry.displayOwnerElement
        )
      ) return;
      if (runtimeVisualElementGetAttribute(entry.element, "data-stemmio-review-marker") !== entry.changeId) return;
      if ((runtimeVisualElementGetAttribute(
        entry.element,
        "data-stemmio-review-projection-facts",
      ) || "") !== entry.serializedFacts) return;
      if (entry.fact.type === "text" && (
        RuntimeVisualString(runtimeVisualNodeTextContent(entry.element) || "") !== entry.textContent
        || entry.textTone !== entry.fact.tone
        || runtimeVisualElementGetAttribute(
          entry.element,
          "data-stemmio-review-text",
        ) !== entry.textTone
      )) return;
      runtimeVisualArrayPush(valid, entry);
    });
    return valid.length === entries.length ? valid : [];
  };
  const isSafePanelControl = (element) => element instanceof Element && element.matches(
    '[data-stemmio-review-panel-control="true"]',
  );
  const panelControlForKey = (panelKey) => [...document.querySelectorAll(
    '[data-stemmio-review-panel-control="true"][data-stemmio-review-panel-key]',
  )].find((candidate) => candidate.getAttribute("data-stemmio-review-panel-key") === panelKey) || null;
  const panelForKey = (panelKey) => [...document.querySelectorAll(
    '[data-stemmio-review-panel-container="true"][data-stemmio-review-panel-key]',
  )].find((candidate) => (
    candidate.getAttribute("data-stemmio-review-panel-key") === panelKey
  )) || null;
  const actionForKey = (actionKey) => [...document.querySelectorAll(
    '[data-stemmio-review-action-key]',
  )].find((candidate) => (
    candidate.getAttribute("data-stemmio-review-action-key") === actionKey
  )) || null;
  const scheduleOverlayRender = () => {
    if (projectionTransitioning || !initialProjectionCommitted) return;
    cancelAnimationFrame(overlayFrame);
    overlayFrame = requestAnimationFrame(renderReviewOverlays);
  };
  const reportReviewCommentLayouts = () => {
    if (projectionTransitioning) return;
    const commentLayouts = [];
    if (side === "before") {
      for (const commentTarget of reviewCommentTargets) {
        const key = safeKey(commentTarget?.key);
        if (!key) continue;
        if (commentTarget?.global === true) {
          runtimeVisualArrayPush(commentLayouts, {
            key,
            left: 22,
            top: 22,
            viewportLeft: 22,
            viewportTop: 22,
            targetLeft: 22,
            targetRight: 22,
            viewportTargetLeft: 22,
            viewportTargetRight: 22,
            global: true,
          });
          continue;
        }
        let target = commentTarget?.element || null;
        if (target && !runtimeVisualNodeIsConnected(target)) continue;
        if (!target) {
          let matches;
          try {
            matches = runtimeVisualDocumentQuerySelectorAll(
              document,
              RuntimeVisualString(commentTarget?.selector || ""),
            );
          } catch {
            continue;
          }
          if (runtimeVisualNodeListLength(matches) !== 1) continue;
          target = runtimeVisualNodeListItem(matches, 0);
        }
        if (!target) continue;
        const clientRects = runtimeVisualElementGetClientRects(target);
        const rects = [];
        for (let index = 0; index < runtimeVisualDomRectListLength(clientRects); index += 1) {
          const rect = runtimeVisualDomRectListItem(clientRects, index);
          if (rect && rect.width > 0 && rect.height > 0) runtimeVisualArrayPush(rects, rect);
        }
        if (!rects.length) continue;
        const firstRect = rects.reduce((current, rect) => (
          rect.top < current.top ? rect : current
        ));
        const targetLeft = Math.min(...rects.map((rect) => rect.left));
        const right = Math.max(...rects.map((rect) => rect.right));
        runtimeVisualArrayPush(commentLayouts, {
          key,
          left: right + scrollX + 10,
          top: firstRect.top + scrollY + firstRect.height / 2,
          viewportLeft: right + 10,
          viewportTop: firstRect.top + firstRect.height / 2,
          targetLeft: targetLeft + scrollX,
          targetRight: right + scrollX,
          viewportTargetLeft: targetLeft,
          viewportTargetRight: right,
          global: false,
        });
      }
    }
    post("comment-layout", { commentLayouts });
  };
  const reportScrollGeometry = () => {
    if (projectionTransitioning) return;
    geometryRevision += 1;
    const anchors = [...document.querySelectorAll("[data-stemmio-outline-id]")]
      .flatMap((element) => {
        const rect = element.getBoundingClientRect();
        const id = safeKey(element.getAttribute("data-stemmio-outline-id"));
        if (!id || rect.width <= 0 || rect.height <= 0) return [];
        return [{ id, top: Math.max(0, scrollY + rect.top), height: rect.height }];
      });
    post("scroll-geometry", {
      scrollGeometry: {
        viewportHeight: innerHeight,
        maximumScroll: maximumScrollTop(),
        revision: geometryRevision,
        anchors,
      },
    });
  };
  const reportLayoutMetrics = () => {
    layoutReportFrame = 0;
    if (projectionTransitioning) return;
    reportScrollGeometry();
    reportReviewCommentLayouts();
  };
  const scheduleLayoutReport = (immediate = false) => {
    if (projectionTransitioning) return;
    clearTimeout(layoutReportTimer);
    const queueReport = () => {
      cancelAnimationFrame(layoutReportFrame);
      layoutReportFrame = requestAnimationFrame(reportLayoutMetrics);
    };
    if (immediate) queueReport();
    else layoutReportTimer = window.setTimeout(queueReport, 80);
  };
  const acceptReviewCommentTargets = (rawTargets) => {
    if (side !== "before" || !runtimeVisualArrayIsArray(rawTargets)) return;
    const targets = [];
    const seenKeys = new RuntimeVisualSet();
    runtimeVisualArrayForEach(rawTargets, (candidate) => {
      if (!candidate || typeof candidate !== "object") return;
      const key = safeKey(candidate.key);
      const global = candidate.global === true;
      const selector = global
        ? "body"
        : typeof candidate.selector === "string"
          ? candidate.selector
          : "";
      const rawSourceNodeId = typeof candidate.stableId === "string" && candidate.stableId
        ? candidate.stableId
        : typeof candidate.sourceNodeId === "string"
          ? candidate.sourceNodeId
          : "";
      const sourceNodeId = safeReviewCommentSourceNodeId(rawSourceNodeId);
      if (rawSourceNodeId && !sourceNodeId) return;
      const identityElement = sourceNodeId
        ? runtimeVisualMapGet(reviewCommentIdentityElements, sourceNodeId)
        : null;
      if (!key || runtimeVisualSetHas(seenKeys, key)) return;
      if (
        sourceNodeId
        && (
          !identityElement
          || runtimeVisualSetHas(reviewCommentInvalidSourceNodeIds, sourceNodeId)
          || !runtimeVisualIsInstance(RuntimeVisualElement, identityElement)
        )
      ) return;
      if (!global && !sourceNodeId && !selector) return;
      runtimeVisualSetAdd(seenKeys, key);
      runtimeVisualArrayPush(targets, {
        key,
        selector,
        global,
        ...(identityElement ? { element: identityElement } : {}),
      });
    });
    reviewCommentTargets = targets;
    scheduleLayoutReport(true);
  };
  if (reviewCommentChannel) {
    reviewCommentChannel.port1.onmessage = (event) => {
      const message = event.data;
      if (
        !message
        || message.source !== "stemmio-ai-review-comment-targets"
        || message.sessionId !== sessionId
        || message.side !== side
        || message.type !== "comment-targets"
      ) return;
      acceptReviewCommentTargets(message.reviewCommentTargets);
    };
    reviewCommentChannel.port1.start();
  }
  const renderTransitionMask = () => {
    document.querySelector('[data-stemmio-review-transition-mask]')?.remove();
    const mask = document.createElement("div");
    mask.setAttribute("data-stemmio-review-transition-mask", "true");
    mask.style.setProperty("width", Math.max(
      innerWidth,
      document.documentElement.scrollWidth,
      document.body?.scrollWidth || 0,
    ) + "px", "important");
    mask.style.setProperty("height", Math.max(innerHeight, documentHeight()) + "px", "important");
    const contextVisibility = clamp(Number(currentState.transparency ?? 25), 0, 100) / 100;
    mask.style.setProperty("opacity", String(Math.round((1 - contextVisibility) * 1000) / 1000), "important");
    document.body.append(mask);
  };
  const beginProjectionTransition = (rawEpoch) => {
    const requestedEpoch = Number(rawEpoch || 0);
    if (
      Number.isFinite(requestedEpoch)
      && requestedEpoch > 0
      && requestedEpoch < projectionEpoch
    ) return projectionEpoch;
    projectionEpoch = Number.isFinite(requestedEpoch) && requestedEpoch > 0
      ? requestedEpoch
      : projectionEpoch + 1;
    projectionTransitioning = true;
    clearTimeout(presentationReadyTimer);
    clearTimeout(layoutReportTimer);
    cancelAnimationFrame(overlayFrame);
    cancelAnimationFrame(layoutReportFrame);
    document.querySelector('[data-stemmio-review-projection-layer]')?.remove();
    document.documentElement.dataset.stemmioReviewTransitioning = "true";
    renderTransitionMask();
    post("comment-layout", { commentLayouts: [] });
    return projectionEpoch;
  };
  const schedulePresentationReady = (rawEpoch) => {
    const epoch = Number(rawEpoch || projectionEpoch);
    if (!projectionTransitioning || epoch !== projectionEpoch) return;
    clearTimeout(presentationReadyTimer);
    presentationReadyTimer = window.setTimeout(() => {
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (!projectionTransitioning || epoch !== projectionEpoch) return;
        post("presentation-ready", { presentationEpoch: epoch });
      }));
    }, 80);
  };
  const commitProjectionTransition = (rawEpoch) => {
    const epoch = Number(rawEpoch || 0);
    if (epoch && epoch !== projectionEpoch) return;
    clearTimeout(presentationReadyTimer);
    projectionTransitioning = false;
    document.documentElement.removeAttribute("data-stemmio-review-transitioning");
    document.querySelector('[data-stemmio-review-transition-mask]')?.remove();
    renderReviewOverlays();
    scheduleLayoutReport(true);
  };
  const applyPanelGroupState = (panelKey) => {
    const panel = panelForKey(panelKey);
    const groupKey = panel?.getAttribute("data-stemmio-review-panel-group") || "";
    if (!groupKey) return;
    const members = [...document.querySelectorAll(
      '[data-stemmio-review-panel-group="' + groupKey + '"]',
    )];
    const stateClasses = [...new Set(members.flatMap((member) => String(
      member.getAttribute("data-stemmio-review-panel-active-classes") || "",
    ).split(/\s+/).filter(Boolean)))];
    members.forEach((candidate) => {
      const active = candidate.getAttribute("data-stemmio-review-panel-key") === panelKey;
      stateClasses.forEach((className) => candidate.classList.toggle(className, active));
      if (isSafePanelControl(candidate)) {
        candidate.setAttribute("aria-selected", active ? "true" : "false");
        candidate.setAttribute("aria-expanded", active ? "true" : "false");
        if (candidate.hasAttribute("tabindex") || candidate.getAttribute("role") === "tab") {
          candidate.tabIndex = active ? 0 : -1;
        }
      } else if (candidate.getAttribute("data-stemmio-review-panel-container") === "true") {
        candidate.toggleAttribute("hidden", !active);
        candidate.setAttribute("aria-hidden", active ? "false" : "true");
      }
    });
  };
  const activatePanelKey = (rawPanelKey) => {
    const panelKey = safeKey(rawPanelKey);
    if (!panelKey) return;
    const control = panelControlForKey(panelKey);
    const panel = panelForKey(panelKey);
    const alreadyPresented = panel instanceof HTMLElement
      && !panel.hidden
      && panel.getAttribute("aria-hidden") !== "true"
      && getComputedStyle(panel).display !== "none"
      && getComputedStyle(panel).visibility !== "hidden"
      && panel.getClientRects().length > 0;
    if (control instanceof HTMLElement && !alreadyPresented) {
      mirroringPanel = true;
      control.click();
      queueMicrotask(() => { mirroringPanel = false; });
    }
    applyPanelGroupState(panelKey);
  };
  const activatePanelPath = (rawPath) => {
    const panelPath = safePanelPath(rawPath);
    panelPath.forEach(activatePanelKey);
    return panelPath;
  };
  const activatePresentation = (rawSteps) => {
    const steps = safeRevealSteps(rawSteps);
    steps.forEach((step) => {
      if (step.kind === "panel") {
        activatePanelKey(step.key);
        return;
      }
      const details = document.querySelector(
        'details[data-stemmio-id="' + step.stableId + '"]',
      );
      if (details instanceof HTMLDetailsElement) details.open = true;
    });
    return steps;
  };
  const mirrorAction = (message) => {
    const actionKey = safeKey(message.actionKey);
    if (!actionKey) return;
    let action = actionForKey(actionKey);
    const actionActivatesRequestedPanel = action
      && isSafePanelControl(action)
      && action.getAttribute("data-stemmio-review-panel-key") === safeKey(message.panelKey);
    if (message.panelPath?.length) activatePanelPath(message.panelPath);
    else if (message.panelKey && !actionActivatesRequestedPanel) activatePanelKey(message.panelKey);
    action = actionForKey(actionKey);
    if (!(action instanceof HTMLElement) || action.matches(":disabled")) {
      post("action-applied", { actionKey, applied: false });
      return;
    }
    mirroringAction = true;
    try {
      if (message.actionType === "control-state") {
        if (action instanceof HTMLInputElement) {
          if (typeof message.checked === "boolean") action.checked = message.checked;
          if (typeof message.value === "string") action.value = message.value;
        } else if (action instanceof HTMLSelectElement || action instanceof HTMLTextAreaElement) {
          if (typeof message.value === "string") action.value = message.value;
        }
        action.dispatchEvent(new Event("input", { bubbles: true }));
        action.dispatchEvent(new Event("change", { bubbles: true }));
      } else {
        action.click();
      }
    } finally {
      queueMicrotask(() => {
        mirroringAction = false;
        scheduleOverlayRender();
        requestAnimationFrame(() => post("action-applied", { actionKey, applied: true }));
      });
    }
  };
  const matchingPanelControl = (panel) => {
    const panelKey = panel.getAttribute("data-stemmio-review-panel-key") || "";
    if (panelKey) return panelControlForKey(panelKey);
    const panelId = panel.id
      || panel.getAttribute("data-page")
      || panel.getAttribute("data-tab-panel")
      || "";
    if (!panelId) return null;
    return [...document.querySelectorAll('[data-stemmio-review-panel-control="true"]')]
      .find((candidate) => (
        candidate.getAttribute("aria-controls") === panelId
        || candidate.getAttribute("data-p") === panelId
        || candidate.getAttribute("data-tab") === panelId
        || (panelId.startsWith("p") && candidate.getAttribute("data-p") === panelId.slice(1))
      )) || null;
  };
  const revealTarget = (target, requestedPanelPath) => {
    if (requestedPanelPath?.length && typeof requestedPanelPath[0] === "object") {
      activatePresentation(requestedPanelPath);
    } else if (requestedPanelPath?.length) activatePanelPath(requestedPanelPath);
    else if (typeof requestedPanelPath === "string") activatePanelKey(requestedPanelPath);
    if (!target) return;
    const details = target.closest("details");
    if (details) details.open = true;
    const ancestors = [];
    let candidate = target;
    while (candidate && candidate !== document.body) {
      if (
        candidate.hasAttribute("data-stemmio-review-panel-key")
        || candidate.hasAttribute("hidden")
        || candidate.getAttribute("aria-hidden") === "true"
        || candidate.getAttribute("role") === "tabpanel"
        || candidate.hasAttribute("data-tab-panel")
      ) ancestors.unshift(candidate);
      candidate = candidate.parentElement;
    }
    ancestors.forEach((panel) => {
      const panelKey = panel.getAttribute("data-stemmio-review-panel-key") || "";
      if (panelKey) activatePanelKey(panelKey);
      const control = matchingPanelControl(panel);
      if (!panelKey && control instanceof HTMLElement) {
        mirroringPanel = true;
        control.click();
        queueMicrotask(() => { mirroringPanel = false; });
      }
      if (panel.hasAttribute("hidden")) panel.removeAttribute("hidden");
      if (panel.getAttribute("aria-hidden") === "true") panel.setAttribute("aria-hidden", "false");
      if (control) {
        control.setAttribute("aria-selected", "true");
        control.setAttribute("aria-expanded", "true");
      }
    });
  };
  const recordFocusScrollCommand = (commandId, top = scrollY, left = scrollX) => {
    const maximumScroll = maximumScrollTop();
    const resolvedTop = clamp(Number(top || 0), 0, maximumScroll);
    const resolvedLeft = Math.max(0, Number(left || 0));
    activeScrollCommand = { commandId, top: resolvedTop, left: resolvedLeft };
    return activeScrollCommand;
  };
  const scrollToReviewRect = (rect, behavior = "auto") => {
    if (!rect || rect.height <= 0 || !Number.isFinite(rect.top)) return false;
    const token = "focus-" + Date.now() + "-" + Math.random();
    const top = reviewTargetScrollTop({
      scrollTop: scrollY,
      rectTop: rect.top,
      rectHeight: rect.height,
      viewportHeight: innerHeight,
      maximumScrollTop: maximumScrollTop(),
    });
    if (top === null) return false;
    const command = recordFocusScrollCommand(token, top, scrollX);
    scrollTo({ top: command.top, left: command.left, behavior });
    return true;
  };
  const scrollIntoReviewTarget = (target, behavior = "auto") => {
    const token = "focus-" + Date.now() + "-" + Math.random();
    target.scrollIntoView({ block: "start", behavior });
    recordFocusScrollCommand(token);
  };
  const anchorTextNodes = (anchor) => {
    const ownerId = anchor.getAttribute("data-stemmio-review-geometry-owner") || "";
    const nodes = [];
    const walker = document.createTreeWalker(anchor, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      const parent = node.parentElement;
      let nestedOwner = parent;
      let crossesOwner = false;
      while (nestedOwner && nestedOwner !== anchor) {
        const candidateOwner = nestedOwner.getAttribute("data-stemmio-review-geometry-owner") || "";
        if (
          candidateOwner
          && candidateOwner !== ownerId
          && !nestedOwner.hasAttribute("data-stemmio-review-text")
        ) {
          crossesOwner = true;
          break;
        }
        nestedOwner = nestedOwner.parentElement;
      }
      if (
        parent
        && !crossesOwner
        && parent.namespaceURI === "http://www.w3.org/1999/xhtml"
        && !parent.closest("script, style, noscript, template, [data-stemmio-review-projection-layer]")
      ) nodes.push(node);
      node = walker.nextNode();
    }
    return nodes;
  };
  const collapsedAnchorRect = (anchor, changeId) => {
    if (anchor.getAttribute("data-stemmio-review-anchor-change") !== changeId) return null;
    const encoded = String(
      anchor.getAttribute("data-stemmio-review-text-anchors") || "",
    ).split(/\s+/).find(Boolean) || "";
    const offset = Math.max(0, Math.trunc(Number(encoded.slice(encoded.lastIndexOf("@") + 1)) || 0));
    const nodes = anchorTextNodes(anchor);
    if (!nodes.length) return null;
    let remaining = offset;
    let targetNode = nodes.at(-1);
    let targetOffset = targetNode?.textContent?.length || 0;
    for (const node of nodes) {
      const length = node.textContent?.length || 0;
      if (remaining <= length) {
        targetNode = node;
        targetOffset = remaining;
        break;
      }
      remaining -= length;
    }
    if (!targetNode) return null;
    const range = document.createRange();
    const targetLength = targetNode.textContent?.length || 0;
    targetOffset = Math.min(targetOffset, targetLength);
    range.setStart(targetNode, targetOffset);
    range.collapse(true);
    let rect = range.getBoundingClientRect();
    // A collapsed Range immediately after an authored <br> is often reported
    // on the preceding visual line. Its offset remains the navigation anchor,
    // while the next visible glyph supplies the measurable context rectangle.
    let probeNode = targetNode;
    let probeOffset = targetOffset;
    let probeIndex = nodes.indexOf(targetNode);
    while (probeNode && probeOffset >= (probeNode.textContent?.length || 0)) {
      probeIndex += 1;
      probeNode = nodes[probeIndex] || null;
      probeOffset = 0;
    }
    if (probeNode && (probeNode.textContent?.length || 0) > probeOffset) {
      const probe = document.createRange();
      probe.setStart(probeNode, probeOffset);
      probe.setEnd(probeNode, probeOffset + 1);
      const probeRect = probe.getBoundingClientRect();
      probe.detach();
      if (probeRect.height > 0) rect = probeRect;
    }
    if (rect.height <= 0) {
      const length = targetNode.textContent?.length || 0;
      const start = Math.max(0, Math.min(targetOffset > 0 ? targetOffset - 1 : 0, length));
      const end = Math.min(length, Math.max(start + 1, targetOffset));
      if (end > start) {
        range.setStart(targetNode, start);
        range.setEnd(targetNode, end);
        rect = range.getBoundingClientRect();
      }
    }
    range.detach();
    return rect.height > 0 ? rect : null;
  };
  const focusTarget = (target, panelPath) => {
    revealTarget(target, panelPath);
    if (!target) return;
    requestAnimationFrame(() => {
      if (!scrollToReviewRect(target.getBoundingClientRect())) {
        scrollIntoReviewTarget(target);
      }
    });
  };
  const focusChangeTarget = (
    changeId,
    target,
    panelPath,
    behavior = "auto",
    regionId = "",
    focusGroupId = "",
    commandId = "",
  ) => {
    revealTarget(target, panelPath);
    requestAnimationFrame(() => {
      if (commandId && cancelledNavigationCommandId === commandId) return;
      const reportNavigationResult = (located) => {
        if (!commandId || cancelledNavigationCommandId === commandId) return;
        post("navigation-result", { commandId, changeId, located });
      };
      if (focusGroupId && currentState.activeFocusGroupId === focusGroupId) {
        renderReviewOverlays();
      }
      const reportHorizontalFootprint = (rect, documentSpace = false) => {
        if (!rect) return;
        const left = Number(rect.left) + (documentSpace ? 0 : scrollX);
        const right = Number(rect.right) + (documentSpace ? 0 : scrollX);
        const maximum = Math.max(
          innerWidth,
          document.documentElement.scrollWidth,
          document.body?.scrollWidth || 0,
        );
        if (
          !runtimeVisualNumberIsFinite(left)
          || !runtimeVisualNumberIsFinite(right)
          || left < 0
          || right < left
          || right > maximum
        ) return;
        post("focus-horizontal-footprint", {
          changeId,
          focusGroupId,
          regionId,
          left,
          right,
        });
      };
      const visibleFocusGeometry = document.querySelector(regionId
        ? '[data-stemmio-review-mask-hole][data-stemmio-review-focus-region="' + regionId + '"]'
        : '[data-stemmio-review-mask-hole="' + changeId + '"]')
        || document.querySelector(regionId
          ? '[data-stemmio-review-overlay-box][data-stemmio-review-focus-region="' + regionId + '"]'
          : '[data-stemmio-review-overlay-box="' + changeId + '"]');
      let reportedFocusGeometry = false;
      if (visibleFocusGeometry) {
        reportHorizontalFootprint({
          left: visibleFocusGeometry.getAttribute("data-left"),
          right: Number(visibleFocusGeometry.getAttribute("data-left"))
            + Number(visibleFocusGeometry.getAttribute("data-width")),
        }, true);
        reportedFocusGeometry = true;
        if (scrollToReviewRect(visibleFocusGeometry.getBoundingClientRect(), behavior)) {
          reportNavigationResult(true);
          return;
        }
      }
      if (!regionId) {
        const anchors = [...document.querySelectorAll(
          '[data-stemmio-review-anchor-change="' + changeId + '"]',
        )];
        for (const anchor of anchors) {
          const rect = collapsedAnchorRect(anchor, changeId);
          if (!rect) continue;
          reportHorizontalFootprint(rect);
          if (scrollToReviewRect(rect, behavior)) {
            reportNavigationResult(true);
            return;
          }
        }
      }
      if (target) {
        const rect = target.getBoundingClientRect();
        if (!reportedFocusGeometry) reportHorizontalFootprint(rect);
        if (scrollToReviewRect(rect, behavior)) {
          reportNavigationResult(true);
          return;
        }
        // A command that promises a location result must fail closed here.
        // Legacy navigation has no acknowledgement contract, so preserve its
        // historical element-level fallback for zero-sized/transient boxes.
        if (!commandId) {
          scrollIntoReviewTarget(target, behavior);
          return;
        }
      }
      reportNavigationResult(false);
    });
  };
  const applyScrollOwner = (message) => {
    const gestureId = Math.max(0, Math.trunc(Number(message.gestureId || 0)));
    const leader = message.leader === "before" || message.leader === "after"
      ? message.leader
      : "";
    acceptsFollowerScroll = message.linked === true && runtimeVisualBoolean(leader) && leader !== side;
    followerGestureId = acceptsFollowerScroll ? gestureId : 0;
    if (!acceptsFollowerScroll) activeScrollCommand = null;
  };
  const applyScrollPosition = (message) => {
    const gestureId = Math.max(0, Math.trunc(Number(message.gestureId || 0)));
    const force = message.force === true;
    if (!force && (!acceptsFollowerScroll || gestureId !== followerGestureId)) return;
    const maximumScroll = maximumScrollTop();
    const top = clamp(Number(message.top || 0), 0, maximumScroll);
    const left = Math.max(0, Number(message.left || 0));
    const commandId = safeKey(message.commandId) || ("review-scroll-" + gestureId);
    activeScrollCommand = { commandId, top, left };
    scrollTo({ top, left, behavior: "auto" });
  };
  const markerTypes = (element) => String(
    element.getAttribute("data-stemmio-review-marker-types") || "",
  ).split(/\s+/).filter(Boolean);
  const safeProjectionFactKey = (value) => {
    const key = String(value || "").trim();
    return runtimeVisualRegExpExec(/^[a-z0-9:_-]{1,160}$/iu, key) !== null ? key : "";
  };
  const safeProjectionSummary = (value) => {
    const summary = String(value || "").trim();
    return summary && summary.length <= 80 ? summary : "";
  };
  const structureSummary = (change) => ({
    added: "新增元素",
    removed: "删除元素",
    moved: "移动元素",
    reordered: "元素顺序调整",
    attribute: "属性调整",
    style: "样式调整",
  })[change] || "元素调整";
  const normalizeProjectionFact = (value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const id = safeProjectionFactKey(value.id);
    const type = value.type === "text" || value.type === "structure"
      ? value.type
      : "";
    const semanticOwnerId = safeProjectionFactKey(value.semanticOwnerId);
    if (!id || !type || !semanticOwnerId) return null;
    const fact = { id, type, semanticOwnerId };
    const geometryOwnerId = safeProjectionFactKey(value.geometryOwnerId);
    const textGroup = safeProjectionFactKey(value.textGroup);
    const displayGroupId = safeProjectionFactKey(value.displayGroupId);
    const displayOwnerId = safeProjectionFactKey(value.displayOwnerId);
    const structureChange = [
      "added",
      "removed",
      "moved",
      "reordered",
      "attribute",
      "style",
    ].includes(value.structureChange)
      ? value.structureChange
      : "";
    const scope = ["text", "text-phrase", "text-line", "text-block", "element"]
      .includes(value.scope)
      ? value.scope
      : "";
    const displayScope = ["paragraph", "list-item", "cell", "component", "container"]
      .includes(value.displayScope)
      ? value.displayScope
      : "";
    const geometryMode = [
      "text-content",
      "element-box",
      "container-box",
      "numbered-line-range",
    ].includes(value.geometryMode)
      ? value.geometryMode
      : "";
    const operation = ["none", "insert", "delete", "replace"].includes(value.operation)
      ? value.operation
      : "";
    const tone = value.tone === "added" || value.tone === "removed" ? value.tone : "";
    const summary = safeProjectionSummary(value.summary);
    if (geometryOwnerId) fact.geometryOwnerId = geometryOwnerId;
    if (textGroup) fact.textGroup = textGroup;
    if (displayGroupId) fact.displayGroupId = displayGroupId;
    if (displayOwnerId) fact.displayOwnerId = displayOwnerId;
    if (displayScope) fact.displayScope = displayScope;
    if (geometryMode) fact.geometryMode = geometryMode;
    if (structureChange) fact.structureChange = structureChange;
    if (scope) fact.scope = scope;
    if (operation) fact.operation = operation;
    if (tone) fact.tone = tone;
    if (summary) fact.summary = summary;
    return fact;
  };
  const projectionFactIdentity = (fact) => [
    fact.type,
    fact.id,
    fact.semanticOwnerId,
    fact.geometryOwnerId || "",
  ].join("\u001f");
  const projectionFactsForSerialized = (serialized) => {
    if (serialized) {
      if (serialized.length > reviewProjectionFactsSerializedLengthLimit) return [];
      try {
        const parsed = JSON.parse(serialized);
        if (!Array.isArray(parsed) || parsed.length > 24) return [];
        const facts = [];
        for (const value of parsed) {
          const fact = normalizeProjectionFact(value);
          if (!fact) return [];
          const key = projectionFactIdentity(fact);
          const existingIndex = facts.findIndex((candidate) => (
            projectionFactIdentity(candidate) === key
          ));
          if (existingIndex >= 0) facts[existingIndex] = { ...facts[existingIndex], ...fact };
          else facts.push(fact);
        }
        return facts;
      } catch {
        return [];
      }
    }
    return [];
  };
  const projectionFactsForElement = (element, fallbackSequence) => {
    const serialized = element.getAttribute("data-stemmio-review-projection-facts");
    if (serialized) return projectionFactsForSerialized(serialized);
    const changeId = element.getAttribute("data-stemmio-review-marker") || "";
    const semanticOwnerId = element.getAttribute("data-stemmio-review-semantic-owner")
      || ("fallback-owner-" + changeId + "-" + fallbackSequence);
    const geometryOwnerId = element.getAttribute("data-stemmio-review-geometry-owner") || "";
    const facts = [];
    if (element.hasAttribute("data-stemmio-review-text")) {
      const textGroup = element.getAttribute("data-stemmio-review-text-group")
        || ("text-marker-" + fallbackSequence);
      facts.push({
        id: textGroup,
        type: "text",
        semanticOwnerId,
        ...(geometryOwnerId ? { geometryOwnerId } : {}),
        scope: "text",
        tone: element.getAttribute("data-stemmio-review-text") === "removed" ? "removed" : "added",
        textGroup,
        displayGroupId: "display-fact-" + textGroup,
        displayOwnerId: geometryOwnerId || semanticOwnerId,
        displayScope: "paragraph",
        geometryMode: "text-content",
        operation: element.getAttribute("data-stemmio-review-text-operation") || "",
        summary: element.getAttribute("data-stemmio-review-summary") || "",
      });
    }
    if (runtimeVisualArrayIncludes(markerTypes(element), "structure")) {
      const structureChange = element.getAttribute("data-stemmio-review-structure") || "changed";
      facts.push({
        id: "structure-" + semanticOwnerId + "-" + structureChange,
        type: "structure",
        semanticOwnerId,
        ...(geometryOwnerId ? { geometryOwnerId } : {}),
        scope: "element",
        displayGroupId: "display-fact-structure-" + semanticOwnerId,
        displayOwnerId: geometryOwnerId || semanticOwnerId,
        displayScope: "container",
        geometryMode: "element-box",
        structureChange,
        summary: element.getAttribute("data-stemmio-review-summary")
          || structureSummary(structureChange),
      });
    }
    return facts.map(normalizeProjectionFact).filter(Boolean);
  };
  // Every rendered box and mask hole is inflated by this much on all sides, so
  // geometry decisions taken before rendering must use the same number or they
  // will judge two rectangles apart that end up overlapping on screen.
  const overlayInset = 3;
  const allModeSummary = (types, summary) => {
    if (summary === "新增元素" || summary === "删除元素") return summary;
    if (types.length === 1 && summary) return summary;
    if (runtimeVisualArrayIncludes(types, "text") && runtimeVisualArrayIncludes(types, "structure")) return "文字、元素调整";
    if (runtimeVisualArrayIncludes(types, "text")) return "文字调整";
    if (runtimeVisualArrayIncludes(types, "structure")) return "元素调整";
    return "内容调整";
  };
  const roundedCoordinate = (value) => Math.round(value * 4) / 4;
  const unionPath = (rawRects, offsetLeft = 0, offsetTop = 0) => {
    const rects = runtimeVisualArrayMap(rawRects, (rect) => ({
      left: roundedCoordinate(rect.left - offsetLeft),
      top: roundedCoordinate(rect.top - offsetTop),
      right: roundedCoordinate(rect.right - offsetLeft),
      bottom: roundedCoordinate(rect.bottom - offsetTop),
    }));
    const xSet = new RuntimeVisualSet(runtimeVisualArrayFlatMap(
      rects,
      (rect) => [rect.left, rect.right],
    ));
    const xs = [];
    runtimeVisualSetForEach(xSet, (value) => runtimeVisualArrayPush(xs, value));
    runtimeVisualArraySort(xs, (left, right) => left - right);
    const ySet = new RuntimeVisualSet(runtimeVisualArrayFlatMap(
      rects,
      (rect) => [rect.top, rect.bottom],
    ));
    const ys = [];
    runtimeVisualSetForEach(ySet, (value) => runtimeVisualArrayPush(ys, value));
    runtimeVisualArraySort(ys, (top, bottom) => top - bottom);
    const filled = runtimeVisualArrayMap(runtimeVisualArraySlice(ys, 0, -1), (top, row) => (
      runtimeVisualArrayMap(runtimeVisualArraySlice(xs, 0, -1), (left, column) => {
      const centerX = (left + xs[column + 1]) / 2;
      const centerY = (top + ys[row + 1]) / 2;
      return runtimeVisualArraySome(rects, (rect) => centerX >= rect.left && centerX <= rect.right
        && centerY >= rect.top && centerY <= rect.bottom);
      })
    ));
    const edges = [];
    const hasCell = (row, column) => runtimeVisualBoolean(filled[row]?.[column]);
    runtimeVisualArrayForEach(filled, (row, rowIndex) => runtimeVisualArrayForEach(
      row,
      (inside, columnIndex) => {
      if (!inside) return;
      const left = xs[columnIndex];
      const right = xs[columnIndex + 1];
      const top = ys[rowIndex];
      const bottom = ys[rowIndex + 1];
      if (!hasCell(rowIndex - 1, columnIndex)) runtimeVisualArrayPush(edges, [[left, top], [right, top]]);
      if (!hasCell(rowIndex, columnIndex + 1)) runtimeVisualArrayPush(edges, [[right, top], [right, bottom]]);
      if (!hasCell(rowIndex + 1, columnIndex)) runtimeVisualArrayPush(edges, [[right, bottom], [left, bottom]]);
      if (!hasCell(rowIndex, columnIndex - 1)) runtimeVisualArrayPush(edges, [[left, bottom], [left, top]]);
      },
    ));
    const pointKey = (point) => point[0] + "," + point[1];
    const paths = [];
    while (edges.length) {
      const edge = runtimeVisualArrayShift(edges);
      const points = [edge[0], edge[1]];
      const startKey = pointKey(edge[0]);
      let currentKey = pointKey(edge[1]);
      while (currentKey !== startKey) {
        const nextIndex = runtimeVisualArrayFindIndex(
          edges,
          (candidate) => pointKey(candidate[0]) === currentKey,
        );
        if (nextIndex < 0) break;
        const next = runtimeVisualArraySplice(edges, nextIndex, 1)[0];
        runtimeVisualArrayPush(points, next[1]);
        currentKey = pointKey(next[1]);
      }
      const simplified = runtimeVisualArrayFilter(points, (point, index) => {
        if (index === 0 || index === points.length - 1) return true;
        const previous = points[index - 1];
        const next = points[index + 1];
        return !((previous[0] === point[0] && point[0] === next[0])
          || (previous[1] === point[1] && point[1] === next[1]));
      });
      if (simplified.length > 2) {
        runtimeVisualArrayPush(paths, "M " + runtimeVisualArrayJoin(runtimeVisualArrayMap(
          simplified,
          (point) => point[0] + " " + point[1],
        ), " L ") + " Z");
      }
    }
    return runtimeVisualArrayJoin(paths, " ");
  };
  const rangeClientRects = (element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const rects = runtimeVisualArrayFilter(
      [...range.getClientRects()],
      (rect) => rect.width > 1 && rect.height > 1,
    );
    range.detach();
    return rects;
  };
  const crossesGeometryOwner = (node, owner, ownerId) => {
    let candidate = node.parentElement;
    while (candidate && candidate !== owner) {
      const candidateId = candidate.getAttribute("data-stemmio-review-geometry-owner") || "";
      if (
        candidateId
        && candidateId !== ownerId
        && !candidate.hasAttribute("data-stemmio-review-text")
      ) return true;
      candidate = candidate.parentElement;
    }
    return false;
  };
  const reviewDirectFlowBoundarySelector = [
    "address", "article", "aside", "audio", "blockquote", "button", "canvas",
    "details", "div", "dl", "fieldset", "figure", "footer", "form",
    "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "iframe",
    "img", "input", "main", "nav", "ol", "p", "picture", "pre",
    "section", "select", "summary", "table", "textarea", "ul", "video",
  ].join(",");
  const directFlowSegmentId = (owner, node) => {
    let directChild = node;
    while (directChild && directChild.parentNode !== owner) directChild = directChild.parentNode;
    if (!directChild) return -1;
    let segment = 0;
    const children = owner.childNodes;
    for (let index = 0; index < children.length; index += 1) {
      const child = children[index];
      const boundary = runtimeVisualIsInstance(RuntimeVisualElement, child)
        && runtimeVisualElementMatches(child, reviewDirectFlowBoundarySelector);
      if (child === directChild) return boundary ? -1 : segment;
      if (boundary) segment += 1;
    }
    return -1;
  };
  const directFlowSegmentsForAtoms = (owner, atoms) => {
    const segments = new RuntimeVisualSet();
    runtimeVisualArrayForEach(atoms, (atom) => {
      const segment = directFlowSegmentId(owner, atom.element);
      if (segment >= 0) runtimeVisualSetAdd(segments, segment);
    });
    return segments;
  };
  const directFlowSegmentBoundaryNodes = (owner, targetSegment) => {
    let first = null;
    let last = null;
    let segment = 0;
    const children = owner.childNodes;
    for (let index = 0; index < children.length; index += 1) {
      const child = children[index];
      const boundary = runtimeVisualIsInstance(RuntimeVisualElement, child)
        && runtimeVisualElementMatches(child, reviewDirectFlowBoundarySelector);
      if (!boundary && segment === targetSegment) {
        if (!first) first = child;
        last = child;
      }
      if (boundary) segment += 1;
    }
    return { first, last };
  };
  const contentTextRects = (element, respectGeometryOwners = false, atoms = []) => {
    const rects = [];
    const ownerId = element.getAttribute("data-stemmio-review-geometry-owner") || "";
    const directFlowSegments = directFlowSegmentsForAtoms(element, atoms);
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      const parent = node.parentElement;
      if (
        (node.textContent || "").trim()
        && parent
        && (
          !directFlowSegments.size
          || runtimeVisualSetHas(directFlowSegments, directFlowSegmentId(element, node))
        )
        && (!respectGeometryOwners || !crossesGeometryOwner(node, element, ownerId))
        && !parent.closest("script, style, noscript, template")
      ) {
        const range = document.createRange();
        range.selectNodeContents(node);
        runtimeVisualArrayForEach(runtimeVisualArrayFilter(
          [...range.getClientRects()],
          (rect) => rect.width > 1 && rect.height > 1,
        ), (rect) => runtimeVisualArrayPush(rects, rect));
        range.detach();
      }
      node = walker.nextNode();
    }
    return rects;
  };
  const boundsForRects = (rects) => rects.length ? {
    left: runtimeVisualMathMin(...runtimeVisualArrayMap(rects, (rect) => rect.left)),
    top: runtimeVisualMathMin(...runtimeVisualArrayMap(rects, (rect) => rect.top)),
    right: runtimeVisualMathMax(...runtimeVisualArrayMap(rects, (rect) => rect.right)),
    bottom: runtimeVisualMathMax(...runtimeVisualArrayMap(rects, (rect) => rect.bottom)),
  } : null;
  const numberedLineBounds = (owner, atoms) => {
    const marker = runtimeVisualArrayFind(
      atoms,
      (atom) => runtimeVisualElementContains(owner, atom.element),
    )?.element;
    if (!marker) return null;
    const markerSegment = directFlowSegmentId(owner, marker);
    if (markerSegment < 0) return null;
    const breaks = [];
    const breakNodes = runtimeVisualElementQuerySelectorAll(owner, "br");
    for (let index = 0; index < runtimeVisualNodeListLength(breakNodes); index += 1) {
      const element = runtimeVisualNodeListItem(breakNodes, index);
      if (element && directFlowSegmentId(owner, element) === markerSegment) {
        runtimeVisualArrayPush(breaks, element);
      }
    }
    let previous = null;
    let next = null;
    for (const element of breaks) {
      const position = runtimeVisualNodeCompareDocumentPosition(element, marker);
      if (position & Node.DOCUMENT_POSITION_FOLLOWING) previous = element;
      if (!next && position & Node.DOCUMENT_POSITION_PRECEDING) next = element;
    }
    const segmentBounds = directFlowSegmentBoundaryNodes(owner, markerSegment);
    if (!segmentBounds.first || !segmentBounds.last) return null;
    const range = document.createRange();
    if (previous) range.setStartAfter(previous);
    else range.setStartBefore(segmentBounds.first);
    if (next) range.setEndBefore(next);
    else range.setEndAfter(segmentBounds.last);
    const bounds = boundsForRects(runtimeVisualArrayFilter(
      [...range.getClientRects()],
      (rect) => rect.width > 1 && rect.height > 1,
    ));
    range.detach();
    return bounds;
  };
  const resolveReviewFocusGeometry = (plans, atoms) => {
    const atomsByKey = new RuntimeVisualMap();
    runtimeVisualArrayForEach(atoms, (atom) => {
      const matches = runtimeVisualMapGet(atomsByKey, atom.atomKey) || [];
      runtimeVisualArrayPush(matches, atom);
      runtimeVisualMapSet(atomsByKey, atom.atomKey, matches);
    });
    return runtimeVisualArrayFlatMap(plans, (plan) => runtimeVisualArrayFlatMap(
      plan.regions[side] || [],
      (region) => {
      const regionAtoms = runtimeVisualArrayFlatMap(region.atomKeys, (atomKey) => (
        runtimeVisualMapGet(atomsByKey, atomKey) || []
      ));
      if (!regionAtoms.length) return [];
      const owners = runtimeVisualArrayFlatMap(region.displayOwnerIds, (ownerId) => {
        const owner = reviewFocusOwnerElement(ownerId);
        return owner ? [{ ownerId, owner }] : [];
      });
      if (!owners.length) return [];
      return runtimeVisualArrayFlatMap(owners, ({ ownerId, owner }, ownerIndex) => {
      const ownerAtoms = runtimeVisualArrayFilter(regionAtoms, (atom) => (
          atom.displayOwnerId === ownerId
        ));
      if (!ownerAtoms.length) return [];
      const semanticLineBounds = region.geometryMode === "numbered-line-range"
        ? numberedLineBounds(owner, ownerAtoms)
        : null;
      const textContentBounds = region.geometryMode === "text-content"
        ? boundsForRects(contentTextRects(owner, true, ownerAtoms))
        : null;
      if (
        (region.geometryMode === "text-content" && !textContentBounds)
        || (region.geometryMode === "numbered-line-range" && !semanticLineBounds)
      ) return [];
      const rect = semanticLineBounds || textContentBounds
        || runtimeVisualElementGetBoundingClientRect(owner);
      if (rect.width <= 1 || rect.height <= 1) return [];
      const representative = ownerAtoms[0];
      const toneSet = new RuntimeVisualSet(runtimeVisualArrayFlatMap(ownerAtoms, (atom) => atom.tones));
      const typeSet = new RuntimeVisualSet(runtimeVisualArrayFlatMap(ownerAtoms, (atom) => atom.types));
      const tones = [];
      const types = [];
      runtimeVisualSetForEach(toneSet, (tone) => runtimeVisualArrayPush(tones, tone));
      runtimeVisualSetForEach(typeSet, (type) => runtimeVisualArrayPush(types, type));
      const evidenceUiScale = 1 / Math.max(
        .32,
        Math.min(1, Number(currentState.scale || 1)),
      );
      const addedEvidenceClearance = runtimeVisualArraySome(
        tones,
        (tone) => tone === "text-added",
      )
        ? Math.max(...runtimeVisualArrayMap(runtimeVisualArrayFilter(
          ownerAtoms,
          (atom) => atom.tone === "text-added",
        ), (atom) => {
          const em = Number.parseFloat(
            runtimeVisualGetComputedStyle(atom.element).fontSize || "0",
          ) || 16;
          const dotRadius = Math.max(1.3, em * .08) * evidenceUiScale;
          const dotGap = Math.max(.7, em * .04) * evidenceUiScale;
          return dotGap + dotRadius + dotRadius * 1.17;
        }), 0)
        : 0;
      return [{
        ...representative,
        element: owner,
        focusGroupId: plan.id,
        focusRegionId: region.id,
        navigationClusterId: region.navigationClusterId,
        displayGroupId: plan.displayGroupId,
        displayScope: plan.displayScope,
        geometryMode: region.geometryMode,
        ownerKey: region.id + ":" + String(ownerIndex + 1),
        changeId: region.primaryChangeId,
        changeIds: region.changeIds,
        factKey: runtimeVisualArrayJoin(runtimeVisualArrayMap(
          ownerAtoms,
          (atom) => atom.factKey,
        ), " "),
        atomKeys: (() => {
          const keys = [];
          runtimeVisualSetForEach(
            new RuntimeVisualSet(runtimeVisualArrayMap(ownerAtoms, (atom) => atom.atomKey)),
            (atomKey) => runtimeVisualArrayPush(keys, atomKey),
          );
          return keys;
        })(),
        scope: runtimeVisualArraySome(types, (type) => type === "text")
          ? "text-block"
          : plan.displayScope,
        summary: allModeSummary(types, representative.summary),
        tones,
        tone: tones.length > 1 ? "mixed" : tones[0],
        types,
        addedEvidenceClearance,
        left: rect.left + scrollX,
        top: rect.top + scrollY,
        right: rect.right + scrollX,
        bottom: rect.bottom + scrollY,
      }];
      });
    }));
  };
  // Hover preview: moving the pointer over a change region previews its
  // precise outline without a click. The projection layer itself never takes
  // pointer events, so hit-testing rides the document's pointer stream, one
  // animation frame at a time; the smallest containing region wins so a small
  // change inside a large one stays reachable.
  let overlayHoverRegions = [];
  let overlayElementsByChange = new RuntimeVisualMap();
  let hoveredChangeId = "";
  const setHoverChange = (changeId) => {
    if (hoveredChangeId === changeId) return;
    const clear = runtimeVisualMapGet(overlayElementsByChange, hoveredChangeId);
    if (clear) runtimeVisualArrayForEach(clear, (element) => {
      element.dataset.hover = "false";
    });
    hoveredChangeId = changeId;
    const mark = runtimeVisualMapGet(overlayElementsByChange, changeId);
    if (mark) runtimeVisualArrayForEach(mark, (element) => {
      element.dataset.hover = "true";
    });
  };
  let hoverPointerFrame = 0;
  runtimeVisualAddEventListener("pointermove", (event) => {
    if (hoverPointerFrame) return;
    const pageX = event.clientX + scrollX;
    const pageY = event.clientY + scrollY;
    hoverPointerFrame = requestAnimationFrame(() => {
      hoverPointerFrame = 0;
      let match = "";
      let matchArea = Infinity;
      runtimeVisualArrayForEach(overlayHoverRegions, (region) => {
        if (
          pageX < region.left || pageX > region.right
          || pageY < region.top || pageY > region.bottom
        ) return;
        const area = (region.right - region.left) * (region.bottom - region.top);
        if (area < matchArea) {
          match = region.changeId;
          matchArea = area;
        }
      });
      setHoverChange(match);
    });
  }, { passive: true });
  runtimeVisualAddEventListener("pointerout", (event) => {
    if (event.relatedTarget === null) setHoverChange("");
  }, { passive: true });
  function renderReviewOverlays() {
    if (projectionTransitioning) return;
    document.querySelector('[data-stemmio-review-projection-layer]')?.remove();
    // Phase 1: collect immutable source-backed atoms. Their exact identities
    // continue to own evidence marks and never become display grouping keys.
    const collectReviewAtoms = () => {
    const records = [];
    runtimeVisualMapForEach(reviewExactAtomOccurrenceCounts, (_expectedCount, atomKey) => {
          runtimeVisualArrayForEach(reviewFocusAtomEntriesForKey(atomKey), (entry) => {
          if (!runtimeVisualSetHas(projectedSourceChangeIds, entry.changeId)) return;
          const { element, changeId, fact } = entry;
          const semanticOwnerId = fact.semanticOwnerId;
          const geometryOwnerId = fact.geometryOwnerId || "";
          const factKey = fact.type + ":" + fact.id;
          const factIdentity = projectionFactIdentity(fact);
          const factAtomKey = changeId + "\u001e" + factIdentity;
          if (factAtomKey !== atomKey) return;
          if (fact.type === "text") {
            const textTone = fact.tone === "removed" ? "text-removed" : "text-added";
            const textGroup = fact.textGroup || fact.id;
            runtimeVisualArrayForEach(rangeClientRects(element), (rect) => runtimeVisualArrayPush(records, {
              element,
              changeId,
              semanticOwnerId,
              geometryOwnerId,
              factKey,
              factIdentity,
              atomKey: factAtomKey,
              displayGroupId: fact.displayGroupId || ("display-fact-" + fact.id),
              displayOwnerId: fact.displayOwnerId || geometryOwnerId || semanticOwnerId,
              displayScope: fact.displayScope || "paragraph",
              ownerKey: "",
              textGroup,
              textOperation: fact.operation || "",
              scope: "text",
              summary: fact.summary || element.getAttribute("data-stemmio-review-summary") || "文本调整",
              tone: textTone,
              tones: [textTone],
              types: ["text"],
              left: rect.left + scrollX,
              top: rect.top + scrollY,
              right: rect.right + scrollX,
              bottom: rect.bottom + scrollY,
            }));
            return;
          }
          const scope = "element";
          const structureChange = fact.structureChange || "";
          const summary = fact.summary || structureSummary(structureChange);
          runtimeVisualArrayForEach([runtimeVisualElementGetBoundingClientRect(element)], (rect) => runtimeVisualArrayPush(records, {
            element,
            changeId,
            semanticOwnerId,
            geometryOwnerId,
            factKey,
            factIdentity,
            atomKey: factAtomKey,
            displayGroupId: fact.displayGroupId || ("display-fact-" + fact.id),
            displayOwnerId: fact.displayOwnerId || geometryOwnerId || semanticOwnerId,
            displayScope: fact.displayScope || "container",
            ownerKey: "",
            structureChange,
            scope,
            summary,
            tone: "structure",
            tones: ["structure"],
            types: [fact.type],
            left: rect.left + scrollX,
            top: rect.top + scrollY,
            right: rect.right + scrollX,
            bottom: rect.bottom + scrollY,
          }));
          });
    });
    return records;
    };
    const records = collectReviewAtoms();
    const visibleRecords = runtimeVisualArrayFilter(
      records,
      (rect) => rect.right - rect.left > 1 && rect.bottom - rect.top > 1,
    );
    runtimeVisualArraySort(
      visibleRecords,
      (left, right) => left.changeId.localeCompare(right.changeId)
        || left.top - right.top || left.left - right.left,
    );
    // The analyzer owns grouping and region identity. Runtime only resolves the
    // current geometry of declared atom keys and owner ids.
    const resolvedGroups = resolveReviewFocusGeometry(reviewFocusGroupPlans, visibleRecords);
    runtimeVisualArraySort(
      resolvedGroups,
      (left, right) => left.changeId.localeCompare(right.changeId)
        || left.top - right.top || left.left - right.left,
    );
    const requestedFocusGroupId = safeProjectionFactKey(currentState.activeFocusGroupId);
    const activeFocusGroupId = !commentHighlightActive && runtimeVisualArraySome(reviewFocusGroupPlans, (plan) => (
      plan.id === requestedFocusGroupId
    )) ? requestedFocusGroupId : "";
    const activeFocusRegionId = activeFocusGroupId
      ? safeProjectionFactKey(currentState.activeFocusRegionId)
      : "";
    const contextMaskRegionId = activeFocusRegionId
      && safeProjectionFactKey(currentState.paintPlan?.contextMask?.regionId) === activeFocusRegionId
      ? activeFocusRegionId
      : "";
    const focusOutlineRegionId = activeFocusRegionId
      && safeProjectionFactKey(currentState.paintPlan?.focusOutline?.regionId) === activeFocusRegionId
      ? activeFocusRegionId
      : "";
    const activeRecords = activeFocusGroupId && activeFocusRegionId
      ? runtimeVisualArrayFilter(resolvedGroups, (record) => (
        record.focusGroupId === activeFocusGroupId
        && record.focusRegionId === activeFocusRegionId
      ))
      : [];
    const inset = overlayInset;
    // Measure the authored document after the previous projection layer has
    // been removed. The projection may consume this width but must never grow
    // it: an inset at the right edge must not create horizontal scrolling.
    const documentWidth = runtimeVisualMathMax(
      innerWidth,
      document.documentElement.scrollWidth,
      document.body?.scrollWidth || 0,
    );
    const height = runtimeVisualMathMax(innerHeight, documentHeight());
    // One selected locality can still resolve multiple element boxes. A paint
    // plan chooses one useful local target; it never turns every measurement
    // into a visible outline or a disconnected multi-contour pseudo-outline.
    const preparedActiveRecords = runtimeVisualArrayFlatMap(
      runtimeVisualArraySlice(activeRecords, 0, 1),
      (record) => {
      const renderFragments = runtimeVisualArrayFilter(runtimeVisualArrayMap(
        record.fragments || [{
        left: record.left,
        top: record.top,
        right: record.right,
        bottom: record.bottom,
        }],
        (fragment) => ({
        left: clamp(fragment.left - inset, 0, documentWidth),
        top: clamp(fragment.top - inset, 0, height),
        right: clamp(fragment.right + inset, 0, documentWidth),
        bottom: clamp(
          fragment.bottom + runtimeVisualMathMax(inset, record.addedEvidenceClearance || 0),
          0,
          height,
        ),
        }),
      ), (fragment) => (
        fragment.right - fragment.left > 0
        && fragment.bottom - fragment.top > 0
      ));
      if (!renderFragments.length) return [];
      const left = runtimeVisualMathMin(...runtimeVisualArrayMap(
        renderFragments,
        (fragment) => fragment.left,
      ));
      const top = runtimeVisualMathMin(...runtimeVisualArrayMap(
        renderFragments,
        (fragment) => fragment.top,
      ));
      const right = runtimeVisualMathMax(...runtimeVisualArrayMap(
        renderFragments,
        (fragment) => fragment.right,
      ));
      const bottom = runtimeVisualMathMax(...runtimeVisualArrayMap(
        renderFragments,
        (fragment) => fragment.bottom,
      ));
      return [{
        ...record,
        left,
        top,
        right,
        bottom,
        renderFragments,
        pathData: unionPath(renderFragments),
      }];
      },
    );
    const contextMaskRecords = contextMaskRegionId ? preparedActiveRecords : [];
    const focusOutlineRecords = focusOutlineRegionId
      ? runtimeVisualArrayFilter(preparedActiveRecords, (record) => (
        reviewFocusOutlineIsUseful({
          left: record.left,
          top: record.top,
          right: record.right,
          bottom: record.bottom,
          viewportWidth: innerWidth,
          viewportHeight: innerHeight,
          documentWidth,
          documentHeight: height,
        })
      ))
      : [];
    activeFocusReadingBounds = preparedActiveRecords[0]
      ? {
        top: preparedActiveRecords[0].top,
        bottom: preparedActiveRecords[0].bottom,
      }
      : null;
    // Navigation bars remain available for every resolved group in overview;
    // only the active group's first outline carries the single public label.
    const badgeUiScale = 1 / runtimeVisualMathMax(
      .32,
      runtimeVisualMathMin(1, Number(currentState.scale || 1)),
    );
    const regionsById = new RuntimeVisualMap();
    runtimeVisualArrayForEach(resolvedGroups, (record) => {
      const navigationClusterId = record.navigationClusterId || record.focusRegionId;
      const existing = runtimeVisualMapGet(regionsById, navigationClusterId);
      if (existing) {
        runtimeVisualArrayPush(existing.members, record);
        return;
      }
      runtimeVisualMapSet(regionsById, navigationClusterId, {
        changeId: record.changeId,
        focusGroupId: record.focusGroupId,
        regionId: record.focusRegionId,
        navigationClusterId,
        left: record.left,
        top: record.top,
        right: record.right,
        bottom: record.bottom,
        carrier: record,
        members: [record],
      });
    });
    const regions = [];
    runtimeVisualMapForEach(regionsById, (region) => runtimeVisualArrayPush(regions, region));
    const labelByCarrier = new RuntimeVisualMap();
    if (focusOutlineRecords[0]) runtimeVisualMapSet(labelByCarrier, focusOutlineRecords[0], {
      text: focusOutlineRecords[0].summary,
      clusterCount: 1,
    });
    overlayElementsByChange = new RuntimeVisualMap();
    const layer = document.createElement("div");
    layer.setAttribute("data-stemmio-review-projection-layer", "true");
    layer.style.setProperty("width", documentWidth + "px", "important");
    layer.style.setProperty("height", height + "px", "important");
    const namespace = "http://www.w3.org/2000/svg";
    const resetMaskPrimitive = (element, fill = "") => {
      element.style.setProperty("display", "block", "important");
      element.style.setProperty("margin", "0", "important");
      element.style.setProperty("padding", "0", "important");
      element.style.setProperty("border", "0", "important");
      element.style.setProperty("outline", "none", "important");
      element.style.setProperty("opacity", "1", "important");
      element.style.setProperty("filter", "none", "important");
      element.style.setProperty("backdrop-filter", "none", "important");
      element.style.setProperty("-webkit-backdrop-filter", "none", "important");
      element.style.setProperty("mix-blend-mode", "normal", "important");
      element.style.setProperty("transform", "none", "important");
      element.style.setProperty("pointer-events", "none", "important");
      if (!fill) return;
      element.style.setProperty("fill", fill, "important");
      element.style.setProperty("fill-opacity", "1", "important");
      element.style.setProperty("stroke", "none", "important");
    };
    if (contextMaskRecords.length) {
    const svg = document.createElementNS(namespace, "svg");
    svg.setAttribute("data-stemmio-review-mask-layer", "true");
    svg.setAttribute("width", String(documentWidth));
    svg.setAttribute("height", String(height));
    svg.setAttribute("viewBox", "0 0 " + documentWidth + " " + height);
    svg.style.setProperty("width", documentWidth + "px", "important");
    svg.style.setProperty("height", height + "px", "important");
    resetMaskPrimitive(svg);
    const mask = document.createElementNS(namespace, "mask");
    const maskId = "stemmio-review-mask-"
      + reviewMaskSessionKey + "-" + side + "-" + projectionEpoch + "-" + (++overlayMaskSequence);
    mask.setAttribute("data-stemmio-review-mask", "true");
    mask.setAttribute("id", maskId);
    mask.setAttribute("maskUnits", "userSpaceOnUse");
    mask.setAttribute("maskContentUnits", "userSpaceOnUse");
    mask.setAttribute("mask-type", "luminance");
    mask.setAttribute("x", "0");
    mask.setAttribute("y", "0");
    mask.setAttribute("width", String(documentWidth));
    mask.setAttribute("height", String(height));
    resetMaskPrimitive(mask);
    mask.style.setProperty("mask-type", "luminance", "important");
    const maskBackground = document.createElementNS(namespace, "rect");
    maskBackground.setAttribute("data-stemmio-review-mask-background", "true");
    maskBackground.setAttribute("x", "0");
    maskBackground.setAttribute("y", "0");
    maskBackground.setAttribute("width", String(documentWidth));
    maskBackground.setAttribute("height", String(height));
    maskBackground.setAttribute("fill", "#ffffff");
    resetMaskPrimitive(maskBackground, "#ffffff");
    mask.append(maskBackground);
    const emphasizedRecords = contextMaskRecords;
    runtimeVisualArrayForEach(emphasizedRecords, (record) => {
      const hole = document.createElementNS(namespace, "path");
      hole.setAttribute("data-stemmio-review-mask-hole", record.changeId);
      hole.setAttribute("data-stemmio-review-semantic-owner", record.semanticOwnerId || "");
      hole.setAttribute("data-stemmio-review-geometry-owner", record.geometryOwnerId || "");
      hole.setAttribute("data-stemmio-review-fact", record.factKey || "");
      hole.setAttribute("data-stemmio-review-focus-group", record.focusGroupId || "");
      hole.setAttribute("data-stemmio-review-focus-region", record.focusRegionId || "");
      if (record.textGroup) hole.setAttribute("data-text-group", record.textGroup);
      if (record.textGroups?.length) {
        hole.setAttribute("data-text-groups", runtimeVisualArrayJoin(record.textGroups, " "));
      }
      if (record.ownerKey) {
        hole.setAttribute("data-stemmio-review-mask-owner", record.ownerKey);
      }
      const width = record.right - record.left;
      const holeHeight = record.bottom - record.top;
      hole.setAttribute("d", record.pathData);
      hole.setAttribute("data-left", String(record.left));
      hole.setAttribute("data-top", String(record.top));
      hole.setAttribute("data-width", String(width));
      hole.setAttribute("data-height", String(holeHeight));
      hole.setAttribute("fill", "#000000");
      resetMaskPrimitive(hole, "#000000");
      mask.append(hole);
    });
    const defs = document.createElementNS(namespace, "defs");
    defs.append(mask);
    svg.append(defs);
    const dim = document.createElementNS(namespace, "rect");
    dim.setAttribute("data-stemmio-review-mask-dim", "true");
    dim.setAttribute("x", "0");
    dim.setAttribute("y", "0");
    dim.setAttribute("width", String(documentWidth));
    dim.setAttribute("height", String(height));
    dim.setAttribute("fill", "#ffffff");
    dim.setAttribute("mask", "url(#" + maskId + ")");
    const contextVisibility = Math.max(0, Math.min(100, Number(currentState.transparency ?? 25))) / 100;
    const dimOpacity = String(Math.round((1 - contextVisibility) * 1_000) / 1_000);
    dim.setAttribute("fill-opacity", dimOpacity);
    resetMaskPrimitive(dim, "#ffffff");
    dim.style.setProperty("fill-opacity", dimOpacity, "important");
    // Chromium composites backdrop-filter across the full SVG rect before its
    // luminance mask is punched out, which dims the active region even though
    // the outline and hole share the same canonical path. The reset above also
    // prevents authored CSS from restoring that filter on Review-owned nodes.
    svg.append(dim);
    layer.append(svg);
    }
    {
      const uiScale = 1 / Math.max(.32, Math.min(1, Number(currentState.scale || 1)));
      const marksSvg = document.createElementNS(namespace, "svg");
      marksSvg.setAttribute("data-stemmio-review-text-marks", "true");
      marksSvg.setAttribute("width", String(documentWidth));
      marksSvg.setAttribute("height", String(height));
      marksSvg.setAttribute("viewBox", "0 0 " + documentWidth + " " + height);
      marksSvg.style.setProperty("width", documentWidth + "px", "important");
      marksSvg.style.setProperty("height", height + "px", "important");
      resetMaskPrimitive(marksSvg);
      const strikeRuns = [];
      const addedDots = [];
      const markedElements = new RuntimeVisualSet();
      runtimeVisualArrayForEach(visibleRecords, (atom) => {
        if (!runtimeVisualArraySome(atom.types, (type) => type === "text")) return;
        const entry = runtimeVisualArrayFind(
          reviewFocusAtomEntriesForKey(atom.atomKey),
          (candidate) => candidate.element === atom.element,
        );
        if (!entry || runtimeVisualSetHas(markedElements, entry.element)) return;
        runtimeVisualSetAdd(markedElements, entry.element);
        const marker = entry.element;
        const tone = entry.fact.tone || "";
        if (tone !== "added" && tone !== "removed") return;
        const fontSize = Number.parseFloat(runtimeVisualGetComputedStyle(marker).fontSize || "0");
        const walker = document.createTreeWalker(marker, NodeFilter.SHOW_TEXT);
        let node = walker.nextNode();
        while (node) {
          // A marker span normally holds one text node, but the walker would also
          // descend into a nested marker and draw its characters twice at two
          // slightly different baselines. Let the innermost marker own its text.
          if (node.parentElement?.closest("[data-stemmio-review-text]") !== marker) {
            node = walker.nextNode();
            continue;
          }
          const value = node.textContent || "";
          let index = 0;
          while (index < value.length) {
            const end = reviewTextEvidenceGraphemeEnd(value, index);
            const code = value.charCodeAt(index);
            // The strike is one continuous rule and crosses punctuation; a dot is
            // per written character and skips it.
            const marked = !runtimeVisualWhitespaceCode(code)
              && (tone === "removed" || !reviewTextEvidenceIsPunctuationCode(code));
            if (marked) {
              const range = document.createRange();
              range.setStart(node, index);
              range.setEnd(node, end);
              const rect = range.getBoundingClientRect();
              range.detach();
              if (rect.width > 0.5 && rect.height > 0.5) {
                const geometry = reviewTextEvidenceMarkGeometry({
                  left: rect.left + scrollX,
                  top: rect.top + scrollY,
                  right: rect.right + scrollX,
                  bottom: rect.bottom + scrollY,
                }, fontSize, uiScale);
                if (tone === "added") {
                  runtimeVisualArrayPush(addedDots, {
                    x: geometry.dotX,
                    y: geometry.dotY,
                    radius: geometry.dotRadius * 1.17,
                    em: geometry.em,
                  });
                } else {
                  runtimeVisualArrayPush(strikeRuns, geometry);
                }
              }
            }
            index = end;
          }
          node = walker.nextNode();
        }
      });
      runtimeVisualArrayForEach(alignReviewTextEvidenceDotRows(addedDots), (dot) => {
        const circle = document.createElementNS(namespace, "circle");
        circle.setAttribute("data-stemmio-review-text-mark", "added");
        circle.setAttribute("cx", String(dot.x));
        circle.setAttribute("cy", String(dot.y));
        circle.setAttribute("r", String(dot.radius));
        marksSvg.append(circle);
      });
      runtimeVisualArraySort(
        strikeRuns,
        (left, right) => left.strikeY - right.strikeY || left.strikeLeft - right.strikeLeft,
      );
      const mergedStrikes = [];
      runtimeVisualArrayForEach(strikeRuns, (run) => {
        const previous = mergedStrikes[mergedStrikes.length - 1];
        if (
          previous
          && Math.abs(previous.strikeY - run.strikeY) <= Math.max(1, run.strikeThickness)
          && run.strikeLeft - previous.strikeRight <= Math.max(2, run.gap)
        ) {
          previous.strikeLeft = Math.min(previous.strikeLeft, run.strikeLeft);
          previous.strikeRight = Math.max(previous.strikeRight, run.strikeRight);
          previous.strikeThickness = Math.max(previous.strikeThickness, run.strikeThickness);
          previous.dash = run.dash;
          previous.gap = run.gap;
          return;
        }
        runtimeVisualArrayPush(mergedStrikes, { ...run });
      });
      runtimeVisualArrayForEach(mergedStrikes, (run) => {
        const line = document.createElementNS(namespace, "line");
        line.setAttribute("data-stemmio-review-text-mark", "removed");
        line.setAttribute("x1", String(run.strikeLeft));
        line.setAttribute("y1", String(run.strikeY));
        line.setAttribute("x2", String(run.strikeRight));
        line.setAttribute("y2", String(run.strikeY));
        line.setAttribute("stroke-width", String(run.strikeThickness));
        line.setAttribute("stroke-dasharray", run.dash + " " + run.gap);
        marksSvg.append(line);
      });
      layer.append(marksSvg);
    }
    runtimeVisualArrayForEach(focusOutlineRecords, (record) => {
      const box = document.createElement("div");
      box.setAttribute("data-stemmio-review-overlay-box", record.changeId);
      box.setAttribute("data-stemmio-review-semantic-owner", record.semanticOwnerId || "");
      box.setAttribute("data-stemmio-review-geometry-owner", record.geometryOwnerId || "");
      box.setAttribute("data-stemmio-review-fact", record.factKey || "");
      box.setAttribute("data-stemmio-review-focus-group", record.focusGroupId || "");
      box.setAttribute("data-stemmio-review-focus-region", record.focusRegionId || "");
      box.setAttribute("data-stemmio-review-display-group", record.displayGroupId || "");
      if (record.ownerKey) {
        box.setAttribute("data-stemmio-review-overlay-owner", record.ownerKey);
      }
      box.dataset.tone = record.tone;
      box.dataset.tones = runtimeVisualArrayJoin(record.tones, " ");
      box.dataset.types = runtimeVisualArrayJoin(record.types, " ");
      box.dataset.scope = record.scope || "element";
      box.dataset.summary = record.summary;
      if (record.textGroup) box.dataset.textGroup = record.textGroup;
      if (record.textGroups?.length) {
        box.dataset.textGroups = runtimeVisualArrayJoin(record.textGroups, " ");
      }
      if (record.textOperation) box.dataset.textOperation = record.textOperation;
      if (record.visualLine) box.dataset.visualLine = record.visualLine;
      box.setAttribute(
        "data-stemmio-review-fragment-count",
        String((record.renderFragments || []).length || 1),
      );
      box.dataset.active = "true";
      const left = record.left;
      const top = record.top;
      const width = record.right - record.left;
      const boxHeight = record.bottom - record.top;
      box.style.setProperty("left", left + "px", "important");
      box.style.setProperty("top", top + "px", "important");
      box.style.setProperty("width", width + "px", "important");
      box.style.setProperty("height", boxHeight + "px", "important");
      box.setAttribute("data-left", String(left));
      box.setAttribute("data-top", String(top));
      box.setAttribute("data-width", String(width));
      box.setAttribute("data-height", String(boxHeight));
      box.setAttribute("data-path", record.pathData || "");
      const textOnly = record.types.length === 1 && record.types[0] === "text";
      if (!textOnly && (record.renderFragments || []).length > 1) {
        box.dataset.shaped = "true";
        const shapeSvg = document.createElementNS(namespace, "svg");
        shapeSvg.setAttribute("data-stemmio-review-overlay-shape-svg", "true");
        shapeSvg.setAttribute("viewBox", "0 0 " + width + " " + boxHeight);
        shapeSvg.setAttribute("preserveAspectRatio", "none");
        const shape = document.createElementNS(namespace, "path");
        shape.setAttribute("data-stemmio-review-overlay-shape", "true");
        shape.setAttribute("d", unionPath(record.renderFragments, left, top));
        shapeSvg.append(shape);
        box.append(shapeSvg);
      }
      const regionLabel = runtimeVisualMapGet(labelByCarrier, record);
      if (regionLabel) {
        if (top < 28 * badgeUiScale) box.dataset.labelInside = "true";
        const label = document.createElement("span");
        label.setAttribute("data-stemmio-review-overlay-label", "true");
        if (regionLabel.clusterCount > 1) {
          label.setAttribute(
            "data-stemmio-review-label-count",
            String(regionLabel.clusterCount),
          );
        }
        label.textContent = regionLabel.text;
        label.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          post("select-change", {
            changeId: record.changeId,
            focusGroupId: record.focusGroupId,
            regionId: record.focusRegionId,
          });
        });
        box.append(label);
      }
      const hoverElements = runtimeVisualMapGet(overlayElementsByChange, record.changeId) || [];
      runtimeVisualArrayPush(hoverElements, box);
      runtimeVisualMapSet(overlayElementsByChange, record.changeId, hoverElements);
      layer.append(box);
    });
    runtimeVisualArrayForEach(regions, (region) => {
      const focusedRegion = runtimeVisualArraySome(region.members, (member) => (
        activeFocusGroupId === member.focusGroupId
        && activeFocusRegionId === member.focusRegionId
      ));
      const regionElements = runtimeVisualMapGet(overlayElementsByChange, region.changeId) || [];
      const bar = document.createElement("div");
      bar.setAttribute("data-stemmio-review-region-bar", region.changeId);
      bar.setAttribute("data-stemmio-review-focus-group", region.focusGroupId || "");
      bar.setAttribute("data-stemmio-review-focus-region", region.regionId || "");
      bar.setAttribute("data-stemmio-review-navigation-cluster", region.navigationClusterId || "");
      bar.setAttribute("data-stemmio-review-region-count", String(region.members.length));
      bar.dataset.active = focusedRegion ? "true" : "false";
      const barTop = Math.max(0, region.top - inset);
      const barHeight = 10 * badgeUiScale;
      bar.style.setProperty("left", (2 * badgeUiScale) + "px", "important");
      bar.style.setProperty("top", barTop + "px", "important");
      bar.style.setProperty("height", barHeight + "px", "important");
      bar.setAttribute("data-top", String(barTop));
      bar.setAttribute("data-height", String(barHeight));
      bar.addEventListener("click", () => {
        post("select-change", {
          changeId: region.changeId,
          focusGroupId: region.focusGroupId,
          regionId: region.regionId,
        });
      });
      bar.addEventListener("pointerenter", () => setHoverChange(region.changeId));
      bar.addEventListener("pointerleave", () => setHoverChange(""));
      runtimeVisualArrayPush(regionElements, bar);
      layer.append(bar);
      runtimeVisualMapSet(overlayElementsByChange, region.changeId, regionElements);
    });
    overlayHoverRegions = runtimeVisualArrayMap(regions, (region) => ({
      changeId: region.changeId,
      left: region.left - inset,
      top: region.top - inset,
      right: region.right + inset,
      bottom: region.bottom + inset,
    }));
    const rehover = hoveredChangeId;
    hoveredChangeId = "";
    setHoverChange(rehover);
    document.body.append(layer);
    document.documentElement.dataset.stemmioReviewOverlays = resolvedGroups.length ? "true" : "false";
    scheduleLayoutReport();
  }
  const applyState = (state) => {
    const ownsFocusRegion = Object.prototype.hasOwnProperty.call(state, "activeFocusRegionId");
    const ownsPaintPlan = Object.prototype.hasOwnProperty.call(state, "paintPlan");
    currentState = {
      focus: Object.prototype.hasOwnProperty.call(state, "focus")
        ? state.focus
        : currentState.focus,
      activeFocusGroupId: Object.prototype.hasOwnProperty.call(state, "activeFocusGroupId")
        ? state.activeFocusGroupId
        : currentState.activeFocusGroupId,
      activeFocusRegionId: ownsFocusRegion
        ? state.activeFocusRegionId
        : currentState.activeFocusRegionId,
      paintPlan: ownsPaintPlan ? state.paintPlan : currentState.paintPlan,
      transparency: Object.prototype.hasOwnProperty.call(state, "transparency")
        ? state.transparency
        : currentState.transparency,
      scale: Object.prototype.hasOwnProperty.call(state, "scale")
        ? state.scale
        : currentState.scale,
    };
    const requestedFocusGroupId = safeProjectionFactKey(currentState.activeFocusGroupId);
    const activeFocusPlan = runtimeVisualArrayFind(
      reviewFocusGroupPlans,
      (plan) => plan.id === requestedFocusGroupId,
    );
    currentState.activeFocusGroupId = activeFocusPlan ? requestedFocusGroupId : null;
    const requestedFocusRegionId = safeProjectionFactKey(currentState.activeFocusRegionId);
    const activeFocusRegion = activeFocusPlan
      ? runtimeVisualArrayFind(activeFocusPlan.regions[side], (region) => (
        region.id === requestedFocusRegionId
      )) || (!ownsFocusRegion ? activeFocusPlan.regions[side][0] : null)
      : null;
    currentState.activeFocusRegionId = activeFocusRegion?.id || null;
    const requestedContextMaskRegionId = safeProjectionFactKey(
      currentState.paintPlan?.contextMask?.regionId,
    );
    const requestedFocusOutlineRegionId = safeProjectionFactKey(
      currentState.paintPlan?.focusOutline?.regionId,
    );
    currentState.paintPlan = {
      contextMask: activeFocusRegion?.id === requestedContextMaskRegionId || (
        !ownsPaintPlan && activeFocusRegion
      )
        ? { regionId: activeFocusRegion.id }
        : null,
      focusOutline: activeFocusRegion?.id === requestedFocusOutlineRegionId || (
        !ownsPaintPlan
        && activeFocusRegion
        && activeFocusPlan?.focusOutlinePolicy === "source-change"
      )
        ? { regionId: activeFocusRegion.id }
        : null,
    };
    const root = document.documentElement;
    root.dataset.stemmioReviewFocus = currentState.focus || "all";
    root.dataset.stemmioReviewFocusGroup = commentHighlightActive
      ? ""
      : currentState.activeFocusGroupId || "";
    root.dataset.stemmioReviewFocusRegion = commentHighlightActive
      ? ""
      : currentState.activeFocusRegionId || "";
    const transparency = Math.max(
      0,
      Math.min(100, Number(currentState.transparency ?? 25)),
    ) / 100;
    root.style.setProperty("--stemmio-review-context-opacity", String(transparency));
    root.style.setProperty("--stemmio-review-ui-scale", String(1 / Math.max(
      .32,
      Math.min(1, Number(currentState.scale || 1)),
    )));
    runtimeVisualArrayForEach(runtimeVisualQueryElements("[data-stemmio-outline-id]"), (element) => {
      element.dataset.stemmioReviewActive = currentState.focus === "all"
        || element.dataset.stemmioReviewId === currentState.focus
        || element.dataset.stemmioOutlineId === currentState.focus
        ? "true"
        : "false";
    });
    runtimeVisualArrayForEach(runtimeVisualQueryElements("[data-stemmio-review-marker]"), (element) => {
      element.dataset.stemmioReviewActive = currentState.focus !== "all"
        && element.getAttribute("data-stemmio-review-marker") === currentState.focus
        ? "true"
        : "false";
    });
    if (projectionTransitioning) renderTransitionMask();
    else scheduleOverlayRender();
  };
  let cancelledNavigationCommandId = "";
  runtimeVisualAddEventListener("message", (event) => {
    const message = event.data;
    if (
      !event.isTrusted
      || event.source !== reviewParent
      || !message
      || message.source !== "stemmio-ai-review-parent"
      || message.sessionId !== sessionId
    ) return;
    if (message.type === "state") applyState(message.state || {});
    if (message.type === "scroll-owner") applyScrollOwner(message);
    if (message.type === "set-scroll-position") applyScrollPosition(message);
    if (message.type === "begin-presentation") beginProjectionTransition(message.presentationEpoch);
    if (message.type === "activate-panel") {
      if (!projectionTransitioning) beginProjectionTransition(message.presentationEpoch);
      activatePanelPath(message.panelPath?.length ? message.panelPath : [message.panelKey]);
      schedulePresentationReady(message.presentationEpoch);
    }
    if (message.type === "activate-presentation") {
      if (!projectionTransitioning) beginProjectionTransition(message.presentationEpoch);
      activatePresentation(message.revealSteps);
      schedulePresentationReady(message.presentationEpoch);
    }
    if (message.type === "commit-presentation") commitProjectionTransition(message.presentationEpoch);
    if (message.type === "cancel-navigation") {
      cancelledNavigationCommandId = safeProjectionFactKey(message.commandId);
    }
    if (message.type === "mirror-action") mirrorAction(message);
    if (message.type === "navigate-change" || message.type === "focus-change") {
      const changeId = String(message.changeId || "").replace(/[^a-z0-9-]/gi, "");
      const focusGroupId = safeProjectionFactKey(message.focusGroupId);
      const regionId = safeProjectionFactKey(message.regionId);
      const focusPlan = runtimeVisualArrayFind(
        reviewFocusGroupPlans,
        (plan) => plan.id === focusGroupId,
      );
      const focusRegion = focusPlan ? runtimeVisualArrayFind(focusPlan.regions[side], (region) => (
        region.id === regionId && region.primaryChangeId === changeId
      )) : null;
      const commandId = safeProjectionFactKey(message.commandId);
      const target = focusRegion
        ? reviewFocusOwnerElement(focusRegion.displayOwnerIds[0])
        : !focusGroupId && !regionId
          ? document.querySelector('[data-stemmio-review-id="' + changeId + '"]')
          : null;
      if ((focusGroupId || regionId) && (!focusRegion || !target)) {
        if (commandId && cancelledNavigationCommandId !== commandId) {
          post("navigation-result", { commandId, changeId, located: false });
        }
        return;
      }
      // Legacy focus-change messages still activate; the current parent sends
      // navigation and paint state independently so restoration cannot behave
      // like a second click.
      if (message.type === "focus-change" && focusPlan) applyState({
        focus: changeId,
        activeFocusGroupId: focusPlan.id,
        activeFocusRegionId: focusRegion?.id || null,
        paintPlan: {
          contextMask: focusRegion ? { regionId: focusRegion.id } : null,
          focusOutline: focusPlan.focusOutlinePolicy === "source-change" && focusRegion
            ? { regionId: focusRegion.id }
            : null,
        },
      });
      focusChangeTarget(
        changeId,
        target,
        message.revealSteps?.length
          ? message.revealSteps
          : message.panelPath?.length ? message.panelPath : message.panelKey,
        message.behavior === "smooth" ? "smooth" : "auto",
        focusRegion?.id || "",
        focusPlan?.id || "",
        commandId,
      );
    }
    if (message.type === "focus-outline") {
      const outlineId = String(message.outlineId || "").replace(/[^a-z0-9-]/gi, "");
      const target = document.querySelector('[data-stemmio-outline-id="' + outlineId + '"]');
      focusTarget(target, message.panelPath?.length ? message.panelPath : message.panelKey);
    }
  }, true);
  addEventListener("click", (event) => {
    post("interaction");
    const action = event.target instanceof Element
      ? event.target.closest("[data-stemmio-review-action-key]")
      : null;
    if (action && !mirroringAction && !mirroringPanel) {
      const actionKey = action.getAttribute("data-stemmio-review-action-key") || "";
      const panelKey = action.closest("[data-stemmio-review-panel-key]")
        ?.getAttribute("data-stemmio-review-panel-key") || "";
      const panelPath = safePanelPath(
        action.getAttribute("data-stemmio-review-panel-path")
        || action.closest("[data-stemmio-review-panel-path]")
          ?.getAttribute("data-stemmio-review-panel-path"),
      );
      scheduleOverlayRender();
      requestAnimationFrame(() => {
        post("action", {
          actionKey,
          panelKey,
          panelPath,
          panelControl: isSafePanelControl(action),
        });
        requestAnimationFrame(scheduleOverlayRender);
      });
    }
    const control = event.target instanceof Element
      ? event.target.closest('[data-stemmio-review-panel-control="true"][data-stemmio-review-panel-key]')
      : null;
    if (control && !mirroringPanel && !mirroringAction) {
      const panelKey = control.getAttribute("data-stemmio-review-panel-key") || "";
      const panelPath = safePanelPath(
        control.getAttribute("data-stemmio-review-panel-path") || panelKey,
      );
      const localEpoch = beginProjectionTransition(projectionEpoch + 1);
      requestAnimationFrame(() => {
        post("panel-change", { panelKey, panelPath, presentationEpoch: localEpoch });
      });
    }
    if (event.target instanceof Element && event.target.closest("a[href], area[href]")) {
      event.preventDefault();
    }
  }, true);
  const postControlState = (event) => {
    if (mirroringAction || mirroringPanel) return;
    const action = event.target instanceof Element
      ? event.target.closest("[data-stemmio-review-action-key]")
      : null;
    if (!(action instanceof HTMLInputElement || action instanceof HTMLSelectElement || action instanceof HTMLTextAreaElement)) return;
    post("control-state", {
      actionKey: action.getAttribute("data-stemmio-review-action-key") || "",
      panelKey: action.closest("[data-stemmio-review-panel-key]")
        ?.getAttribute("data-stemmio-review-panel-key") || "",
      panelPath: safePanelPath(
        action.getAttribute("data-stemmio-review-panel-path")
        || action.closest("[data-stemmio-review-panel-path]")
          ?.getAttribute("data-stemmio-review-panel-path"),
      ),
      value: action.value,
      checked: action instanceof HTMLInputElement ? action.checked : undefined,
    });
  };
  addEventListener("input", postControlState, true);
  addEventListener("change", postControlState, true);
  addEventListener("submit", (event) => event.preventDefault(), true);
  const announceScrollIntent = () => {
    activeScrollCommand = null;
    acceptsFollowerScroll = false;
    followerGestureId = 0;
    post("scroll-intent");
  };
  const wheelPixels = (delta, mode, pageSize) => {
    const value = Number(delta || 0);
    if (!Number.isFinite(value) || !value) return 0;
    if (mode === 1) return value * 16;
    if (mode === 2) return value * Math.max(1, pageSize);
    return value;
  };
  // Horizontal review scrolling belongs to the pane viewport, not to this
  // document. A wheel gesture latches onto the first scroller that can consume
  // its combined delta, so a mixed swipe here keeps the horizontal component
  // and discards it instead of chaining out to the pane. Hand over what this
  // document cannot consume; the pane reconciles it against native chaining.
  const relayHorizontalWheel = (event) => {
    const deltaX = wheelPixels(event.deltaX, event.deltaMode, innerWidth);
    if (!deltaX) return;
    const scroller = document.scrollingElement || document.documentElement;
    const maximumScroll = Math.max(0, (scroller?.scrollWidth || 0) - innerWidth);
    const consumable = deltaX > 0 ? scrollX < maximumScroll - 1 : scrollX > 1;
    if (maximumScroll > 1 && consumable) return;
    post("wheel-horizontal", { deltaX });
  };
  addEventListener("wheel", (event) => {
    announceScrollIntent();
    relayHorizontalWheel(event);
  }, { capture: true, passive: true });
  addEventListener("touchstart", announceScrollIntent, { capture: true, passive: true });
  addEventListener("pointerdown", announceScrollIntent, { capture: true, passive: true });
  addEventListener("keydown", (event) => {
    const editableElement = runtimeVisualIsInstance(RuntimeVisualElement, event.target)
      ? event.target
      : null;
    const editableTarget = editableElement && (
      runtimeVisualBoolean(runtimeVisualElementClosest(editableElement, "input, textarea, select"))
      || runtimeVisualBoolean(runtimeVisualHTMLElementIsContentEditable(editableElement))
    );
    if (
      event.key === "Escape"
      && !event.defaultPrevented
      && !editableTarget
      && currentState.activeFocusGroupId
    ) {
      event.preventDefault();
      post("leave-focus");
      return;
    }
    const scrollKeys = new Set([
      "ArrowUp",
      "ArrowDown",
      "PageUp",
      "PageDown",
      "Home",
      "End",
      " ",
      "Spacebar",
    ]);
    if (!scrollKeys.has(event.key)) return;
    if (editableTarget) return;
    announceScrollIntent();
  });
  addEventListener("scroll", () => {
    const command = activeScrollCommand;
    post("scroll-position", {
      top: scrollY,
      left: scrollX,
      // Smooth scrolling reports intermediate positions before reaching its
      // target. They are still programmatic and must not become a user gesture.
      commandId: command ? command.commandId : "",
    });
  }, { passive: true });
  addEventListener("scrollend", (event) => {
    const command = activeScrollCommand;
    // An older animation may have queued its end before a replacement target.
    if (event.target === document && command
      && Math.abs(scrollY - command.top) <= 1
      && Math.abs(scrollX - command.left) <= 1) activeScrollCommand = null;
    if (
      event.target === document
      && !command
      && currentState.activeFocusGroupId
      && activeFocusReadingBounds
    ) {
      const readingMargin = Math.max(48, innerHeight * .35);
      const viewportTop = scrollY;
      const viewportBottom = scrollY + innerHeight;
      if (
        activeFocusReadingBounds.bottom < viewportTop - readingMargin
        || activeFocusReadingBounds.top > viewportBottom + readingMargin
      ) post("leave-focus");
    }
  }, { passive: true });
  const handleLayoutChange = () => {
    if (projectionTransitioning) {
      renderTransitionMask();
      schedulePresentationReady(projectionEpoch);
    } else {
      scheduleOverlayRender();
      scheduleLayoutReport();
    }
  };
  addEventListener("resize", handleLayoutChange, { passive: true });
  const mutationObserver = new MutationObserver((mutations) => {
    const onlyOverlayChanges = mutations.every((mutation) => {
      const changedNodes = [...mutation.addedNodes, ...mutation.removedNodes];
      return changedNodes.length > 0 && changedNodes.every((node) => (
        node instanceof Element
        && (node.matches("[data-stemmio-review-projection-layer], [data-stemmio-review-transition-mask]")
          || runtimeVisualBoolean(node.closest("[data-stemmio-review-projection-layer], [data-stemmio-review-transition-mask]")))
      ));
    });
    if (!onlyOverlayChanges) handleLayoutChange();
  });
  if (document.body) mutationObserver.observe(document.body, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["aria-expanded", "aria-hidden", "aria-selected", "class", "hidden", "open", "style"],
  });
  const resizeObserver = typeof ResizeObserver === "function"
    ? new ResizeObserver(handleLayoutChange)
    : null;
  if (resizeObserver && document.body) resizeObserver.observe(document.body);
  const announceReady = () => post("ready", {
    height: Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight || 0),
  });
  const ready = async () => {
    closeInitialBindings();
    // Static facts are independently complete. Runtime projection may arrive
    // later, fail, or be unavailable without delaying or clearing them.
    const sourceChangeIds = new RuntimeVisualSet();
    runtimeVisualQueryElements("[data-stemmio-review-marker]").forEach((element) => {
      const changeId = safeKey(runtimeVisualElementGetAttribute(
        element,
        "data-stemmio-review-marker",
      ));
      if (changeId) runtimeVisualSetAdd(sourceChangeIds, changeId);
    });
    projectedSourceChangeIds = sourceChangeIds;
    initialProjectionCommitted = true;
    scheduleOverlayRender();
    announceReady();
    // The initial ready can precede the parent iframe ref. Re-announce through
    // the captured native timer so the parent can replay its static state.
    runtimeVisualSetTimeout(announceReady, 64);
    scheduleLayoutReport(true);
    document.fonts?.ready?.then(() => {
      scheduleOverlayRender();
      scheduleLayoutReport();
    }).catch(() => {});
  };
  if (document.readyState === "loading") {
    addEventListener("DOMContentLoaded", () => { void ready(); }, { once: true });
  } else {
    void ready();
  }
})();
`;
}

export { reviewBootstrap };

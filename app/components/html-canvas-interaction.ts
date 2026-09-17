import {
  SOURCE_ELEMENT_ATTRIBUTE,
  sourceElementId,
} from "./html-canvas-source-element";
import { inferSelectionLevel, selectionForElement } from "./html-canvas-selection";
import {
  nativeEditHostForElement,
  sourceTextNodeForDomText,
} from "./html-canvas-preview-sync";
import { isFrozenEditableIslandSubtree } from "../lib/editable-island.js";
import { createElementTextLocator } from "../lib/comment-text-locator.js";
import type { ActiveTextRange, SourceIndexValue, TextRangeSegment } from "./html-canvas-internal-types";
import type { HtmlCanvasTextLocator } from "./HtmlCanvasEditor.types";
import type { NativeEditSelection } from "./native-edit-types";

export function activeTextRangeFromDocument(
  documentNode: Document,
  sourceIndex: SourceIndexValue | null,
): ActiveTextRange | null {
  const domSelection = documentNode.getSelection();
  if (!sourceIndex || !domSelection || domSelection.rangeCount !== 1 || domSelection.isCollapsed) {
    return null;
  }
  const range = domSelection.getRangeAt(0);
  const commonNode = range.commonAncestorContainer;
  const commonElement = commonNode.nodeType === 1
    ? commonNode as HTMLElement
    : commonNode.parentElement;
  const hitElement = commonElement?.closest<HTMLElement>(`[${SOURCE_ELEMENT_ATTRIBUTE}]`) ?? null;
  // A generated descendant maps to its nearest authored host for comments,
  // but its text is never a source-backed range or native editable island.
  if (commonElement && hitElement !== commonElement) return null;
  if (
    !hitElement
    || ["BODY", "HTML", "HEAD", "SCRIPT", "STYLE", "NOSCRIPT"].includes(hitElement.tagName)
  ) return null;
  // The DOM range keeps exact text-node/style evidence, while its logical
  // target follows the same native text host used by pointer selection.
  const targetElement = nativeEditHostForElement(hitElement, sourceIndex) ?? hitElement;

  const showText = documentNode.defaultView?.NodeFilter.SHOW_TEXT ?? 4;
  const walker = documentNode.createTreeWalker(targetElement, showText);
  const segments: TextRangeSegment[] = [];
  const styleElements: HTMLElement[] = [];
  let currentNode = walker.nextNode();
  while (currentNode) {
    const textNode = currentNode as Text;
    let intersects = false;
    try {
      intersects = range.intersectsNode(textNode);
    } catch {
      return null;
    }
    if (intersects) {
      const startOffset = range.startContainer === textNode ? range.startOffset : 0;
      const endOffset = range.endContainer === textNode ? range.endOffset : textNode.data.length;
      if (endOffset > startOffset) {
        const sourceText = sourceTextNodeForDomText(textNode, sourceIndex);
        if (!sourceText || endOffset > sourceText.value.length) return null;
        segments.push({
          textNodeId: sourceText.nodeId,
          startOffset,
          endOffset,
        });
        const textParent = textNode.parentElement;
        if (textParent && !styleElements.includes(textParent)) styleElements.push(textParent);
      }
    }
    currentNode = walker.nextNode();
  }
  if (segments.length === 0 || styleElements.length === 0) return null;
  let direction: ActiveTextRange["direction"] = "forward";
  if (domSelection.anchorNode && domSelection.focusNode) {
    try {
      const anchorRange = documentNode.createRange();
      anchorRange.setStart(domSelection.anchorNode, domSelection.anchorOffset);
      anchorRange.collapse(true);
      const focusRange = documentNode.createRange();
      focusRange.setStart(domSelection.focusNode, domSelection.focusOffset);
      focusRange.collapse(true);
      direction = anchorRange.compareBoundaryPoints(0, focusRange) <= 0
        ? "forward"
        : "backward";
    } catch {
      direction = "forward";
    }
  }
  return {
    target: selectionForElement(targetElement, sourceIndex, undefined, undefined, "part"),
    segments,
    text: range.toString(),
    styleElements,
    direction,
  };
}

export function textLocatorForActiveRange(
  range: ActiveTextRange | null,
  sourceIndex: SourceIndexValue | null,
): HtmlCanvasTextLocator | null {
  return createElementTextLocator(sourceIndex, range);
}

export type TextCaretPoint = {
  clientX: number;
  clientY: number;
};

export type NativeEditCaretPoint = TextCaretPoint & {
  lineBreakId?: string | null;
};

export function caretPointFromMouseEvent(event: MouseEvent): TextCaretPoint {
  // clientX/clientY are already in the same viewport coordinate system as
  // Range.getClientRects(). MouseEvent.offsetX/offsetY are not reliable for
  // inline descendants such as <pre><code>: Chromium can report them relative
  // to a different padding/offset parent and make a real glyph click look like
  // empty space.
  return {
    clientX: event.clientX,
    clientY: event.clientY,
  };
}

function textHitAtPoint(
  documentNode: Document,
  target: HTMLElement,
  point: TextCaretPoint,
): { textNode: Text; offset: number } | null {
  const caretPosition = documentNode.caretPositionFromPoint?.(point.clientX, point.clientY);
  const caretRange = !caretPosition
    ? documentNode.caretRangeFromPoint?.(point.clientX, point.clientY)
    : null;
  const pointNode = caretPosition?.offsetNode || caretRange?.startContainer;
  const pointOffset = caretPosition?.offset ?? caretRange?.startOffset;
  const textNode = pointNode?.nodeType === 3 ? pointNode as Text : null;
  if (!textNode || !target.contains(textNode) || !textNode.data.length) return null;
  const offset = typeof pointOffset === "number"
    ? Math.max(0, Math.min(textNode.data.length, pointOffset))
    : 0;
  return { textNode, offset };
}

export function identifyingTextRangeAtPoint(
  documentNode: Document,
  target: HTMLElement,
  point: TextCaretPoint,
): Range | null {
  const hit = textHitAtPoint(documentNode, target, point);
  if (!hit) return null;
  // Caret hit-testing reports an insertion boundary. A point on the right
  // half of a glyph may therefore resolve immediately after that glyph, so
  // validate both adjacent characters before treating the point as empty
  // layout space.
  const starts = [
    Math.min(hit.offset, hit.textNode.data.length - 1),
    Math.max(0, hit.offset - 1),
  ];
  for (const start of new Set(starts)) {
    const range = documentNode.createRange();
    range.setStart(hit.textNode, start);
    range.setEnd(hit.textNode, start + 1);
    if (nativeTextRangeContainsPoint(range, point)) return range;
  }
  return null;
}

function nativeLineBreakRangeContainsPoint(
  lineBreak: HTMLBRElement,
  point: TextCaretPoint,
): boolean {
  const range = lineBreak.ownerDocument.createRange();
  range.setStartBefore(lineBreak);
  range.setEndAfter(lineBreak);
  const rects = Array.from(range.getClientRects());
  if (rects.length === 0) rects.push(range.getBoundingClientRect());
  const blockTolerance = 2;
  const emptyLineInlineTarget = 10;
  return rects.some((rect) => (
    rect.height > 0
    && point.clientY >= rect.top - blockTolerance
    && point.clientY <= rect.bottom + blockTolerance
    && point.clientX >= rect.left - blockTolerance
    // A BR caret has a zero-width box. Keep the accepted area to the small
    // line-start target used by a native caret; never widen it to host padding.
    && point.clientX <= Math.max(
      rect.right + blockTolerance,
      rect.left + emptyLineInlineTarget,
    )
  ));
}

function firstVisibleSourceBackedHit(
  documentNode: Document,
  point: TextCaretPoint,
): { hit: HTMLElement; sourceSurface: HTMLElement } | null {
  const hits = typeof documentNode.elementsFromPoint === "function"
    ? documentNode.elementsFromPoint(point.clientX, point.clientY)
    : [];
  for (const hit of hits) {
    if (!hit || hit.nodeType !== 1) continue;
    const hitElement = hit as HTMLElement;
    const sourceSurface = hitElement.closest<HTMLElement>(`[${SOURCE_ELEMENT_ATTRIBUTE}]`);
    if (sourceSurface) return { hit: hitElement, sourceSurface };
    if (!['HTML', 'BODY'].includes(hitElement.tagName)) return null;
  }
  return null;
}

function frozenOrInteractiveHit(
  hit: HTMLElement,
  sourceSurface: HTMLElement,
): boolean {
  if (findNativeActionTarget(hit)) return true;
  let current: HTMLElement | null = hit;
  while (current) {
    if (
      current !== sourceSurface
      && isFrozenEditableIslandSubtree(
        current.localName,
        current.namespaceURI || undefined,
      )
    ) return true;
    if (current === sourceSurface) break;
    current = current.parentElement;
  }
  return false;
}

export function authoredLineBreakCaretRangeAtPoint(
  hostElement: HTMLElement,
  lineBreak: HTMLBRElement,
  point: TextCaretPoint,
): Range | null {
  if (
    !hostElement.isConnected
    || !lineBreak.isConnected
    || !hostElement.contains(lineBreak)
    || !sourceElementId(lineBreak)
    || !lineBreak.hasAttribute(SOURCE_ELEMENT_ATTRIBUTE)
    || !nativeLineBreakRangeContainsPoint(lineBreak, point)
  ) return null;
  const visibleHit = firstVisibleSourceBackedHit(hostElement.ownerDocument, point);
  if (!visibleHit || frozenOrInteractiveHit(visibleHit.hit, visibleHit.sourceSurface)) {
    return null;
  }
  if (
    visibleHit.sourceSurface !== lineBreak
    && !visibleHit.sourceSurface.contains(lineBreak)
    && !lineBreak.contains(visibleHit.sourceSurface)
  ) return null;
  const frozenAncestor = lineBreak.parentElement?.closest<HTMLElement>(
    '[contenteditable="false"]',
  );
  if (frozenAncestor && frozenAncestor !== hostElement) return null;
  const caret = lineBreak.ownerDocument.createRange();
  caret.setStartBefore(lineBreak);
  caret.collapse(true);
  return caret;
}

export type NativeEditPointTarget = Readonly<{
  host: HTMLElement;
  lineBreakId: string | null;
}>;

function nativeLineBreakTargetAtPoint(
  documentNode: Document,
  point: TextCaretPoint,
  sourceIndex: SourceIndexValue,
): NativeEditPointTarget | null {
  const visibleHit = firstVisibleSourceBackedHit(documentNode, point);
  if (!visibleHit || frozenOrInteractiveHit(visibleHit.hit, visibleHit.sourceSurface)) {
    return null;
  }
  const hitHost = nativeEditHostForElement(visibleHit.sourceSurface, sourceIndex);
  if (!hitHost) return null;
  const candidates = visibleHit.sourceSurface.tagName === "BR"
    ? [visibleHit.sourceSurface as HTMLBRElement]
    : Array.from(visibleHit.sourceSurface.querySelectorAll<HTMLBRElement>(
      `br[${SOURCE_ELEMENT_ATTRIBUTE}]`,
    ));
  for (const lineBreak of candidates) {
    const lineBreakHost = nativeEditHostForElement(lineBreak, sourceIndex);
    const lineBreakId = sourceElementId(lineBreak);
    if (
      !lineBreakId
      || lineBreakHost !== hitHost
      || !authoredLineBreakCaretRangeAtPoint(hitHost, lineBreak, point)
    ) continue;
    return { host: hitHost, lineBreakId };
  }
  return null;
}

export function nativeEditTargetAtPoint(
  documentNode: Document,
  point: TextCaretPoint,
  sourceIndex: SourceIndexValue | null,
): NativeEditPointTarget | null {
  if (!sourceIndex) return null;
  const caretPosition = documentNode.caretPositionFromPoint?.(point.clientX, point.clientY);
  const caretRange = !caretPosition
    ? documentNode.caretRangeFromPoint?.(point.clientX, point.clientY)
    : null;
  const pointNode = caretPosition?.offsetNode || caretRange?.startContainer;
  const textNode = pointNode?.nodeType === Node.TEXT_NODE ? pointNode as Text : null;
  const sourceElement = textNode?.parentElement?.closest<HTMLElement>(
    `[${SOURCE_ELEMENT_ATTRIBUTE}]`,
  ) ?? null;
  const host = sourceElement ? nativeEditHostForElement(sourceElement, sourceIndex) : null;
  if (host && identifyingTextRangeAtPoint(documentNode, host, point)) {
    return { host, lineBreakId: null };
  }
  return nativeLineBreakTargetAtPoint(documentNode, point, sourceIndex);
}

export function directTextNodeAtPoint(
  documentNode: Document,
  target: HTMLElement,
  point: TextCaretPoint,
): Text | null {
  const hit = textHitAtPoint(documentNode, target, point);
  return hit?.textNode ?? null;
}

function wordBoundsAtOffset(text: string, requestedOffset: number): {
  startOffset: number;
  endOffset: number;
} | null {
  if (!text || !text.trim()) return null;
  const offset = Math.max(0, Math.min(text.length, requestedOffset));
  if (typeof Intl.Segmenter === "function") {
    const segments = new Intl.Segmenter(undefined, { granularity: "word" }).segment(text);
    let nearest: { startOffset: number; endOffset: number; distance: number } | null = null;
    for (const segment of segments) {
      if (!segment.segment.trim()) continue;
      const startOffset = segment.index;
      const endOffset = segment.index + segment.segment.length;
      if (offset >= startOffset && offset <= endOffset) return { startOffset, endOffset };
      const distance = Math.min(
        Math.abs(offset - startOffset),
        Math.abs(offset - endOffset),
      );
      if (!nearest || distance < nearest.distance) {
        nearest = { startOffset, endOffset, distance };
      }
    }
    if (nearest) return nearest;
  }

  let characterOffset = Math.min(offset, text.length - 1);
  while (characterOffset > 0 && /\s/u.test(text[characterOffset])) characterOffset -= 1;
  if (/\p{Script=Han}/u.test(text[characterOffset])) {
    return { startOffset: characterOffset, endOffset: characterOffset + 1 };
  }
  const isWordCharacter = (character: string) => /[\p{L}\p{N}_-]/u.test(character);
  let startOffset = characterOffset;
  let endOffset = characterOffset + 1;
  while (startOffset > 0 && isWordCharacter(text[startOffset - 1])) startOffset -= 1;
  while (endOffset < text.length && isWordCharacter(text[endOffset])) endOffset += 1;
  return { startOffset, endOffset };
}

export function selectWordAtPoint(
  documentNode: Document,
  target: HTMLElement,
  point: TextCaretPoint,
): Range | null {
  const caretPosition = documentNode.caretPositionFromPoint?.(point.clientX, point.clientY);
  const caretRange = !caretPosition
    ? documentNode.caretRangeFromPoint?.(point.clientX, point.clientY)
    : null;
  const pointNode = caretPosition?.offsetNode || caretRange?.startContainer;
  const pointOffset = caretPosition?.offset ?? caretRange?.startOffset;
  const textNode = pointNode?.nodeType === 3 ? pointNode as Text : null;
  const textOffset = typeof pointOffset === "number" ? pointOffset : 0;
  // caretPositionFromPoint may return the nearest text when the pointer is on
  // an inert iframe/canvas or on empty layout space. Never turn that proximity
  // guess into an edit target: the point must lie on the chosen text glyphs.
  if (!textNode || !target.contains(textNode) || !textNode.data.trim()) return null;
  if (!textNode) return null;
  const bounds = wordBoundsAtOffset(textNode.data, textOffset);
  if (!bounds) return null;
  const range = documentNode.createRange();
  range.setStart(textNode, bounds.startOffset);
  range.setEnd(textNode, bounds.endOffset);
  if (!nativeTextRangeContainsPoint(range, point)) return null;
  const selection = documentNode.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  return range;
}

function nativeTextRangeContainsPoint(
  range: Range,
  point: TextCaretPoint,
): boolean {
  if (
    range.collapsed
    || !range.startContainer.isConnected
    || !range.endContainer.isConnected
  ) return false;
  const tolerance = 2;
  return Array.from(range.getClientRects()).some((rect) => (
    rect.width > 0
    && rect.height > 0
    && point.clientX >= rect.left - tolerance
    && point.clientX <= rect.right + tolerance
    && point.clientY >= rect.top - tolerance
    && point.clientY <= rect.bottom + tolerance
  ));
}

export function nativeTextRangeMatchesActivation(
  range: Range,
  target: HTMLElement,
  point: TextCaretPoint,
): boolean {
  return target.contains(range.startContainer)
    && target.contains(range.endContainer)
    && nativeTextRangeContainsPoint(range, point);
}

function findSelectableElement(target: EventTarget | null): HTMLElement | null {
  if (!target || typeof target !== "object" || !("nodeType" in target) || target.nodeType !== 1) return null;
  const element = target as HTMLElement;
  if (["HTML", "BODY", "HEAD", "SCRIPT", "STYLE"].includes(element.tagName)) return null;
  if (element.namespaceURI === "http://www.w3.org/1998/Math/MathML") {
    return element.closest("math") as unknown as HTMLElement | null;
  }
  return element;
}

const MEDIA_SURFACE_SELECTOR = "iframe, audio, video, canvas, object, embed";
const DEDICATED_SOURCE_SURFACE_SELECTOR = `${MEDIA_SURFACE_SELECTOR}, svg, math, input, textarea, select`;
const COMPOUND_VALUE_AFFIX_TAGS = new Set(["SMALL", "SUP", "SUB"]);

function pointHitsElementBox(element: HTMLElement, point: TextCaretPoint): boolean {
  const rect = element.getBoundingClientRect();
  const tolerance = 2;
  return rect.width > 0
    && rect.height > 0
    && point.clientX >= rect.left - tolerance
    && point.clientX <= rect.right + tolerance
    && point.clientY >= rect.top - tolerance
    && point.clientY <= rect.bottom + tolerance;
}

export function findDedicatedSourceSurfaceAtPoint(
  documentNode: Document,
  point: TextCaretPoint,
): HTMLElement | null {
  const hits = typeof documentNode.elementsFromPoint === "function"
    ? documentNode.elementsFromPoint(point.clientX, point.clientY)
    : [];
  const seen = new Set<HTMLElement>();
  const consider = (element: HTMLElement | null) => {
    if (!element || seen.has(element) || !element.hasAttribute(SOURCE_ELEMENT_ATTRIBUTE)) {
      return null;
    }
    seen.add(element);
    return element.matches(DEDICATED_SOURCE_SURFACE_SELECTOR)
      && pointHitsElementBox(element, point)
      ? element
      : null;
  };
  for (const hit of hits) {
    if (!hit || hit.nodeType !== 1) continue;
    const element = hit as HTMLElement;
    const dedicated = consider(element.closest<HTMLElement>(DEDICATED_SOURCE_SURFACE_SELECTOR))
      ?? Array.from(
        element.querySelectorAll<HTMLElement>(DEDICATED_SOURCE_SURFACE_SELECTOR),
      ).map((candidate) => consider(candidate)).find(Boolean)
      ?? null;
    if (dedicated) return dedicated;
  }
  return null;
}

function compoundValueSelectionRoot(element: HTMLElement): HTMLElement {
  if (!COMPOUND_VALUE_AFFIX_TAGS.has(element.tagName)) return element;
  const parent = element.parentElement;
  if (!parent || parent === parent.ownerDocument.body) return element;
  const directText = Array.from(parent.childNodes)
    .filter((node) => node.nodeType === 3)
    .map((node) => node.textContent ?? "")
    .join("")
    .trim();
  const combinedText = (parent.textContent ?? "").replace(/\s+/g, "");
  if (
    !/\d/u.test(directText)
    || combinedText.length === 0
    || combinedText.length > 40
    || parent.querySelector("div, section, article, header, footer, main, aside, table, ul, ol")
  ) return element;
  return parent;
}

function elementFromEventTarget(target: EventTarget | null): HTMLElement | null {
  if (!target || typeof target !== "object" || !("nodeType" in target)) return null;
  if (target.nodeType === 3) return (target as Text).parentElement;
  return findSelectableElement(target);
}

export function findCanvasHitSourceElement(target: EventTarget | null): HTMLElement | null {
  const selected = elementFromEventTarget(target);
  if (!selected) return null;
  const element = compoundValueSelectionRoot(selected);
  return element.closest<HTMLElement>(`[${SOURCE_ELEMENT_ATTRIBUTE}]`) ?? element;
}

export function findCanvasSelectionElement(
  target: EventTarget | null,
  options: { preserveRuntimeSurface?: boolean } = {},
): HTMLElement | null {
  const selected = findSelectableElement(target);
  if (!selected) return null;
  const element = compoundValueSelectionRoot(selected);
  const ownsMediaSurface = element.matches(MEDIA_SURFACE_SELECTOR)
    || Boolean(element.querySelector(MEDIA_SURFACE_SELECTOR));
  if (!ownsMediaSurface || options.preserveRuntimeSurface) return element;
  let candidate: HTMLElement | null = element;
  while (candidate && candidate !== candidate.ownerDocument.body) {
    if (
      candidate.hasAttribute(SOURCE_ELEMENT_ATTRIBUTE)
      && inferSelectionLevel(candidate) === "module"
    ) return candidate;
    candidate = candidate.parentElement;
  }
  return element;
}

export function eventTargetsRuntimeGeneratedNode(
  target: EventTarget | null,
  isProvenSourceElement: ((element: HTMLElement) => boolean) | null = null,
): boolean {
  if (!isProvenSourceElement) return false;
  const selected = elementFromEventTarget(target);
  if (!selected) return false;
  const sourceHost = selected.closest<HTMLElement>(`[${SOURCE_ELEMENT_ATTRIBUTE}]`);
  if (!sourceHost || sourceHost !== selected) return true;
  return !isProvenSourceElement(sourceHost);
}

export function findNativeActionTarget(target: EventTarget | null): HTMLElement | null {
  const element = findSelectableElement(target);
  return element?.closest<HTMLElement>(
    [
      "a[href]",
      "area[href]",
      "button",
      "form",
      "input",
      "select",
      "summary",
      "textarea",
      "[role=\"tab\"]",
      "[aria-expanded][aria-controls]",
    ].join(", "),
  ) ?? null;
}

export function sourceHistoryDirectionForShortcut(event: {
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  key: string;
}): "undo" | "redo" | null {
  if (!(event.metaKey || event.ctrlKey)) return null;
  const key = event.key.toLowerCase();
  if (key === "y" && event.ctrlKey && !event.metaKey) return "redo";
  if (key !== "z") return null;
  return event.shiftKey ? "redo" : "undo";
}

export function historySelectionFromMutationValue(
  value: unknown,
): NativeEditSelection | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const selection = (value as { selection?: unknown }).selection;
  if (!selection || typeof selection !== "object" || Array.isArray(selection)) {
    return undefined;
  }
  const candidate = selection as Partial<NativeEditSelection>;
  if (
    !Number.isSafeInteger(candidate.anchor)
    || !Number.isSafeInteger(candidate.focus)
    || Number(candidate.anchor) < 0
    || Number(candidate.focus) < 0
    || (candidate.affinity !== "left" && candidate.affinity !== "right")
  ) return undefined;
  return {
    anchor: Number(candidate.anchor),
    focus: Number(candidate.focus),
    affinity: candidate.affinity,
  };
}

function safeHistorySelectionOffset(text: string, rawOffset: number): number {
  let offset = Math.min(text.length, Math.max(0, rawOffset));
  if (
    offset > 0
    && offset < text.length
    && /[\uD800-\uDBFF]/u.test(text[offset - 1])
    && /[\uDC00-\uDFFF]/u.test(text[offset])
  ) offset -= 1;
  return offset;
}

export function boundedHistorySelection(
  selection: NativeEditSelection | undefined,
  text: string,
): NativeEditSelection | undefined {
  if (!selection) return undefined;
  return {
    anchor: safeHistorySelectionOffset(text, selection.anchor),
    focus: safeHistorySelectionOffset(text, selection.focus),
    affinity: selection.affinity,
  };
}

export function isCanvasRootElement(target: EventTarget | null): boolean {
  return Boolean(
    target
    && typeof target === "object"
    && "nodeType" in target
    && target.nodeType === 1
    && ["HTML", "BODY"].includes((target as HTMLElement).tagName),
  );
}

"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
} from "react";

import styles from "./read-only-comment-marker.module.css";

// The single read-only comment marker. Preview and Review both render this
// component, so the marker a user learns in one surface is the same marker in
// the other.
//
// It is deliberately not the editing-canvas marker. On the canvas the comment
// rail carries the content and the marker is only a locator, so it stays quiet.
// Here there is no rail: the marker is the only way to reach the comment and it
// sits on arbitrary authored HTML, so it keeps a solid high-contrast fill that
// survives any page background.
//
// Comment text stays in this trusted React host. It is never injected into
// authored HTML and the page's own scripts never receive it.

export type ReadOnlyCommentItem = {
  text: string;
  attachmentCount: number;
};

export type ReadOnlyCommentGroup = {
  key: string;
  items: readonly ReadOnlyCommentItem[];
};

export type ReadOnlyCommentMarkerProps = {
  group: ReadOnlyCommentGroup;
  left: number;
  top: number;
  /**
   * Live viewport bounds used to flip the bubble away from an edge. The marker
   * renders at its unscrolled position so scrolling never re-renders the pane;
   * pointer entry and keyboard focus measure the live position instead.
   */
  viewportRef: { current: HTMLElement | null };
  initialPlacement?: "left" | "right";
  initialVertical?: "above" | "below" | "center";
  testId?: string;
  bubbleTestId?: string;
  onActiveChange?: (active: boolean) => void;
  /** Parent-owned Escape dismissal for pointer-open bubbles without DOM focus. */
  dismissRevision?: number;
};

const EDGE_MARGIN = 96;
const BUBBLE_GAP = 10;

function markerLabel(items: readonly ReadOnlyCommentItem[]) {
  const text = items.map((item) => item.text).join("；");
  return items.length > 1
    ? `用户评论，共 ${items.length} 条：${text}`
    : `用户评论：${text}`;
}

export function readOnlyCommentBubblePlacement(
  marker: HTMLElement,
  viewport: HTMLElement,
  preferredPlacement: "left" | "right" = "right",
) {
  const markerBounds = marker.getBoundingClientRect();
  const viewportBounds = viewport.getBoundingClientRect();
  const bubble = marker.querySelector<HTMLElement>('[data-comment-bubble="true"]');
  const bubbleWidth = bubble?.getBoundingClientRect().width || 320;
  const leftSpace = markerBounds.left - viewportBounds.left - BUBBLE_GAP;
  const rightSpace = viewportBounds.right - markerBounds.right - BUBBLE_GAP;
  const preferredSpace = preferredPlacement === "right" ? rightSpace : leftSpace;
  const alternatePlacement = preferredPlacement === "right" ? "left" : "right";
  const alternateSpace = alternatePlacement === "right" ? rightSpace : leftSpace;
  const placement = preferredSpace >= bubbleWidth
    ? preferredPlacement
    : alternateSpace >= bubbleWidth
      ? alternatePlacement
      : rightSpace >= leftSpace ? "right" : "left";
  const centerY = markerBounds.top + markerBounds.height / 2 - viewportBounds.top;
  return {
    placement,
    vertical: centerY < EDGE_MARGIN
      ? "below"
      : centerY > viewportBounds.height - EDGE_MARGIN
        ? "above"
        : "center",
  } as const;
}

export default function ReadOnlyCommentMarker({
  group,
  left,
  top,
  viewportRef,
  initialPlacement = "right",
  initialVertical = "center",
  testId = "read-only-comment-marker",
  bubbleTestId = "read-only-comment-bubble",
  onActiveChange,
  dismissRevision = 0,
}: ReadOnlyCommentMarkerProps) {
  const count = group.items.length;
  const [bubbleOpen, setBubbleOpen] = useState(false);
  const activeRef = useRef(false);
  const pointerInsideRef = useRef(false);
  const keyboardActiveRef = useRef(false);
  const suppressPointerRef = useRef(false);
  const dismissRevisionRef = useRef(dismissRevision);
  const onActiveChangeRef = useRef(onActiveChange);
  useEffect(() => {
    onActiveChangeRef.current = onActiveChange;
  }, [onActiveChange]);
  const setActive = useCallback((active: boolean) => {
    if (activeRef.current === active) return;
    activeRef.current = active;
    setBubbleOpen(active);
    onActiveChangeRef.current?.(active);
  }, []);

  useEffect(() => () => {
    if (!activeRef.current) return;
    activeRef.current = false;
    onActiveChangeRef.current?.(false);
  }, []);

  useEffect(() => {
    if (dismissRevisionRef.current === dismissRevision) return;
    dismissRevisionRef.current = dismissRevision;
    suppressPointerRef.current = pointerInsideRef.current;
    keyboardActiveRef.current = false;
    setActive(false);
  }, [dismissRevision, setActive]);

  // Hover and keyboard focus open the same bubble through the same measurement,
  // so a keyboard user is never left without the comment body.
  const reposition = useCallback((marker: HTMLElement) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const { placement, vertical } = readOnlyCommentBubblePlacement(
      marker,
      viewport,
      initialPlacement,
    );
    marker.dataset.bubblePlacement = placement;
    marker.dataset.bubbleVertical = vertical;
  }, [initialPlacement, viewportRef]);

  const handlePointerEnter = useCallback((event: PointerEvent<HTMLButtonElement>) => {
    pointerInsideRef.current = true;
    reposition(event.currentTarget);
    if (!suppressPointerRef.current) setActive(true);
  }, [reposition, setActive]);

  const handlePointerLeave = useCallback(() => {
    pointerInsideRef.current = false;
    suppressPointerRef.current = false;
    if (!keyboardActiveRef.current) setActive(false);
  }, [setActive]);

  const handleFocus = useCallback((event: { currentTarget: HTMLButtonElement }) => {
    reposition(event.currentTarget);
    // Pointer focus is deliberately not a second owner. This prevents a mouse
    // click from pinning the 15% comment context after the pointer leaves.
    if (pointerInsideRef.current && !event.currentTarget.matches(":focus-visible")) return;
    keyboardActiveRef.current = true;
    setActive(true);
  }, [reposition, setActive]);

  const handleBlur = useCallback(() => {
    keyboardActiveRef.current = false;
    if (!pointerInsideRef.current || suppressPointerRef.current) setActive(false);
  }, [setActive]);

  // The marker is read-only. Enter and Space must not activate anything, and in
  // particular must never open the editing toolbar or move the selection.
  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "Escape" && activeRef.current) {
      event.preventDefault();
      event.stopPropagation();
      suppressPointerRef.current = pointerInsideRef.current;
      keyboardActiveRef.current = false;
      setActive(false);
      return;
    }
    if (event.key === "Enter" || event.key === " " || event.key === "Spacebar") {
      event.preventDefault();
    }
  }, [setActive]);

  const handleClick = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    if (event.target instanceof Element && event.target.closest('[data-comment-bubble="true"]')) {
      return;
    }
    suppressPointerRef.current = pointerInsideRef.current;
    keyboardActiveRef.current = false;
    setActive(false);
    event.currentTarget.blur();
  }, [setActive]);

  return (
    <button
      type="button"
      className={styles.marker}
      data-testid={testId}
      data-comment-key={group.key}
      data-comment-count={count}
      data-bubble-placement={initialPlacement}
      data-bubble-vertical={initialVertical}
      data-bubble-open={bubbleOpen ? "true" : "false"}
      aria-label={markerLabel(group.items)}
      aria-expanded={bubbleOpen}
      style={{ left, top }}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
      onFocus={handleFocus}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
      onClick={handleClick}
    >
      <span className={styles.glyph} aria-hidden="true">
        {count > 1 ? `评${count}` : "评"}
      </span>
      <span
        className={styles.bubble}
        data-testid={bubbleTestId}
        data-comment-bubble="true"
        aria-hidden={!bubbleOpen}
      >
        <strong>用户评论</strong>
        {group.items.map((item, index) => (
          <span className={styles.item} key={`${group.key}-${index}`}>
            <span>{item.text}</span>
            {item.attachmentCount > 0 && !item.text.startsWith("已添加 ") ? (
              <small>{item.attachmentCount} 个参考附件</small>
            ) : null}
          </span>
        ))}
      </span>
    </button>
  );
}

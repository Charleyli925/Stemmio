"use client";

import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";

const TOOLTIP_ID = "workbench-tooltip-overlay";
const TOOLTIP_DELAY_MS = 400;

type TooltipState = Readonly<{
  label: string;
  left: number;
  top: number;
  target: HTMLElement;
}>;

function targetForEvent(value: EventTarget | null): HTMLElement | null {
  if (!(value instanceof Element)) return null;
  const target = value.closest<HTMLElement>("[data-tooltip]");
  if (
    !target
    || !target.closest(".workbench")
    || !target.closest(".workbench-header, .workbench-tabbar, .workbench-sidebar-titlebar, .workbench-sidebar-toggle-titlebar")
    || (
      target.getAttribute("aria-expanded") === "true"
      && !target.hasAttribute("data-sidebar-toggle")
    )
  ) return null;
  const label = target.getAttribute("data-tooltip")?.trim();
  return label ? target : null;
}

function tooltipPosition(target: HTMLElement) {
  const rect = target.getBoundingClientRect();
  const maxLeft = Math.max(12, window.innerWidth - 12);
  return {
    left: Math.min(Math.max(rect.left + rect.width / 2, 12), maxLeft),
    top: Math.min(rect.bottom + 8, Math.max(8, window.innerHeight - 36)),
  };
}

/**
 * One workbench-wide tooltip surface. It listens at document level so a tooltip
 * cannot be clipped by the tab strip or the horizontally scrollable toolbar.
 * The element that owns the label receives aria-describedby only while visible.
 */
export function WorkbenchTooltipHost() {
  const [active, setActive] = useState<TooltipState | null>(null);
  const timerRef = useRef<number | null>(null);
  const targetRef = useRef<HTMLElement | null>(null);
  const previousDescribedByRef = useRef<string | null>(null);
  const activeTarget = active?.target;

  useEffect(() => {
    if (!activeTarget) return;
    const observer = new MutationObserver(() => {
      setActive((current) => current?.target === activeTarget
        ? { ...current, label: activeTarget.getAttribute("data-tooltip")?.trim() || "" }
        : current);
    });
    observer.observe(activeTarget, { attributes: true, attributeFilter: ["data-tooltip"] });
    return () => observer.disconnect();
  }, [activeTarget]);

  useEffect(() => {
    const clearTimer = () => {
      if (timerRef.current === null) return;
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    };
    const clearActive = () => {
      clearTimer();
      const target = targetRef.current;
      if (target) {
        const previous = previousDescribedByRef.current;
        if (previous === null) target.removeAttribute("aria-describedby");
        else target.setAttribute("aria-describedby", previous);
      }
      targetRef.current = null;
      previousDescribedByRef.current = null;
      setActive(null);
    };
    const showLater = (target: HTMLElement) => {
      if (
        targetRef.current === target
        && (
          timerRef.current !== null
          || target.getAttribute("aria-describedby") === TOOLTIP_ID
        )
      ) return;
      clearActive();
      targetRef.current = target;
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        if (
          !target.isConnected
          || (
            target.getAttribute("aria-expanded") === "true"
            && !target.hasAttribute("data-sidebar-toggle")
          )
        ) {
          clearActive();
          return;
        }
        previousDescribedByRef.current = target.getAttribute("aria-describedby");
        target.setAttribute("aria-describedby", TOOLTIP_ID);
        setActive({
          label: target.getAttribute("data-tooltip")?.trim() || "",
          target,
          ...tooltipPosition(target),
        });
      }, TOOLTIP_DELAY_MS);
    };
    const onMouseOver = (event: MouseEvent) => {
      const target = targetForEvent(event.target);
      const related = targetForEvent(event.relatedTarget);
      if (!target || target === related) return;
      showLater(target);
    };
    const onMouseOut = (event: MouseEvent) => {
      const current = targetRef.current;
      if (!current) return;
      const relatedNode = event.relatedTarget;
      if (relatedNode instanceof Node && current.contains(relatedNode)) return;
      if (targetForEvent(relatedNode) === current) return;
      clearActive();
    };
    const onFocusIn = (event: FocusEvent) => {
      const target = targetForEvent(event.target);
      if (target) showLater(target);
    };
    const onFocusOut = (event: FocusEvent) => {
      const current = targetRef.current;
      if (!current) return;
      const relatedNode = event.relatedTarget;
      if (relatedNode instanceof Node && current.contains(relatedNode)) return;
      if (targetForEvent(relatedNode) === current) return;
      clearActive();
    };
    const onViewportChange = () => {
      setActive((current) => current
        ? { ...current, ...tooltipPosition(current.target) }
        : current);
    };

    document.addEventListener("mouseover", onMouseOver, true);
    document.addEventListener("mouseout", onMouseOut, true);
    document.addEventListener("focusin", onFocusIn, true);
    document.addEventListener("focusout", onFocusOut, true);
    window.addEventListener("resize", onViewportChange);
    window.addEventListener("scroll", onViewportChange, true);
    return () => {
      document.removeEventListener("mouseover", onMouseOver, true);
      document.removeEventListener("mouseout", onMouseOut, true);
      document.removeEventListener("focusin", onFocusIn, true);
      document.removeEventListener("focusout", onFocusOut, true);
      window.removeEventListener("resize", onViewportChange);
      window.removeEventListener("scroll", onViewportChange, true);
      clearActive();
    };
  }, []);

  if (!active || typeof document === "undefined") return null;
  return createPortal(
    <div
      id={TOOLTIP_ID}
      className="workbench-tooltip-overlay"
      role="tooltip"
      data-placement="below"
      style={{ left: active.left, top: active.top }}
    >
      {active.label}
    </div>,
    document.body,
  );
}

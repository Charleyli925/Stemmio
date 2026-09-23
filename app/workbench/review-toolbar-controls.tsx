"use client";

import type { KeyboardEvent } from "react";
import {
  BrowsersIcon,
  CaretLeftIcon,
  CaretRightIcon,
  CornersOutIcon,
  LinkBreakIcon,
  LinkIcon,
} from "@phosphor-icons/react";

import type {
  ReviewPageView,
  ReviewScrollMode,
  ReviewZoomMode,
} from "./review-state";

function handleSegmentedKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
  const buttons = [...(event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
    "button:not(:disabled)",
  ) || [])];
  const currentIndex = buttons.indexOf(event.currentTarget);
  if (currentIndex < 0 || !buttons.length) return;
  let targetIndex: number | null = null;
  if (event.key === "ArrowRight" || event.key === "ArrowDown") {
    targetIndex = (currentIndex + 1) % buttons.length;
  } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
    targetIndex = (currentIndex - 1 + buttons.length) % buttons.length;
  } else if (event.key === "Home") {
    targetIndex = 0;
  } else if (event.key === "End") {
    targetIndex = buttons.length - 1;
  }
  if (targetIndex === null) return;
  event.preventDefault();
  buttons[targetIndex].focus();
  buttons[targetIndex].click();
}

export type ReviewToolbarControlsProps = {
  pageView?: ReviewPageView;
  scrollMode?: ReviewScrollMode;
  zoomMode?: ReviewZoomMode;
  onPageViewChange?: (value: ReviewPageView) => void;
  onScrollModeChange?: (value: ReviewScrollMode) => void;
  onZoomModeChange?: (value: ReviewZoomMode) => void;
};

export function ReviewToolbarControls({
  pageView = "split",
  scrollMode = "linked",
  zoomMode = "fit",
  onPageViewChange,
  onScrollModeChange,
  onZoomModeChange,
}: ReviewToolbarControlsProps) {
  return (
    <div
      className="unified-review-tools"
      aria-label="审阅工具"
    >
      <div className="toolbar-control-group" role="group" aria-label="页面预览">
        <button type="button" aria-label="双页对比" data-tooltip="双页对比" aria-pressed={pageView === "split"} onClick={() => onPageViewChange?.("split")} onKeyDown={handleSegmentedKeyDown}>
          <BrowsersIcon aria-hidden="true" size={14} weight="duotone" />
        </button>
        <button type="button" aria-label="只看修改前" data-tooltip="只看修改前" aria-pressed={pageView === "before"} onClick={() => onPageViewChange?.("before")} onKeyDown={handleSegmentedKeyDown}>
          <CaretLeftIcon aria-hidden="true" size={13} weight="bold" />
        </button>
        <button type="button" aria-label="只看修改后" data-tooltip="只看修改后" aria-pressed={pageView === "after"} onClick={() => onPageViewChange?.("after")} onKeyDown={handleSegmentedKeyDown}>
          <CaretRightIcon aria-hidden="true" size={13} weight="bold" />
        </button>
      </div>

      <div className="toolbar-control-group" role="group" aria-label="滚动方式">
        <button type="button" aria-label="同步滚动" data-tooltip="同步滚动" aria-pressed={scrollMode === "linked"} onClick={() => onScrollModeChange?.("linked")}>
          <LinkIcon aria-hidden="true" size={13} weight="bold" />
        </button>
        <button type="button" aria-label="独立滚动" data-tooltip="独立滚动" aria-pressed={scrollMode === "independent"} onClick={() => onScrollModeChange?.("independent")}>
          <LinkBreakIcon aria-hidden="true" size={13} weight="bold" />
        </button>
      </div>

      <div className="toolbar-control-group" role="group" aria-label="画布缩放">
        <button type="button" aria-label="适应画布" data-tooltip="适应画布" aria-pressed={zoomMode === "fit"} onClick={() => onZoomModeChange?.("fit")}>
          <CornersOutIcon aria-hidden="true" size={13} />
        </button>
        <button className="toolbar-actual-size" type="button" aria-label="原始大小" data-tooltip="原始大小" aria-pressed={zoomMode === "actual"} onClick={() => onZoomModeChange?.("actual")}>100%</button>
      </div>

    </div>
  );
}

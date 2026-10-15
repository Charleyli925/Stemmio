"use client";

import type { ReactNode } from "react";
import { CheckCircleIcon } from "@phosphor-icons/react/dist/csr/CheckCircle";
import { ClockCounterClockwiseIcon } from "@phosphor-icons/react/dist/csr/ClockCounterClockwise";
import { CircleNotchIcon } from "@phosphor-icons/react/dist/csr/CircleNotch";
import { EyeIcon } from "@phosphor-icons/react/dist/csr/Eye";
import { PencilSimpleIcon } from "@phosphor-icons/react/dist/csr/PencilSimple";

import type { WorkbenchPresentation } from "./workbench-header-projection";
import { WorkbenchMoreMenu, type WorkbenchMoreMenuProps } from "./workbench-more-menu";
import {
  WorkbenchHeaderActions,
  WorkbenchHeaderShell,
} from "./workbench-header-shell";

export type WorkbenchHeaderToolbarProps = {
  runInProgress: boolean;
  presentation: WorkbenchPresentation;
  recentRunOutcome: unknown;
  terminalRun: unknown;
  aiConversationVisible: boolean;
  aiAssistantEntry: ReactNode;
  moreMenu: WorkbenchMoreMenuProps;
  onSelectEdit: () => void;
  onSelectPreview: () => void;
  previewOpening: boolean;
  onOpenReview: () => void;
  reopenRecentRunOutcome: () => void;
};

export function WorkbenchHeaderToolbar({
  runInProgress,
  presentation,
  recentRunOutcome,
  terminalRun,
  aiConversationVisible,
  aiAssistantEntry,
  moreMenu,
  onSelectEdit,
  onSelectPreview,
  previewOpening,
  onOpenReview,
  reopenRecentRunOutcome,
}: WorkbenchHeaderToolbarProps) {
  const reviewActive = presentation.review.selected;
  const { reviewAvailable } = presentation;
  return (
    <>
      <WorkbenchHeaderActions aria-label="模式、审阅和文件操作">
          <div className="workbench-toolbar-primary">
            <div
              className="canvas-mode-switch"
              role="group"
              aria-label="工作模式"
              data-mode={presentation.mode}
              data-view-label={presentation.viewLabel || undefined}
              data-tooltip={presentation.edit.reason}
            >
              <button
                type="button"
                aria-pressed={presentation.edit.selected}
                disabled={!presentation.edit.enabled}
                data-tooltip={presentation.edit.reason}
                onClick={onSelectEdit}
              >
                <PencilSimpleIcon aria-hidden="true" size={16} weight="bold" />
                编辑
              </button>
              <button
                type="button"
                aria-pressed={presentation.preview.selected}
                aria-busy={previewOpening || undefined}
                data-preview-opening={previewOpening ? "true" : undefined}
                disabled={!presentation.preview.enabled}
                data-tooltip={presentation.preview.reason}
                onClick={onSelectPreview}
              >
                {previewOpening
                  ? <CircleNotchIcon aria-hidden="true" size={16} weight="bold" />
                  : <EyeIcon aria-hidden="true" size={16} weight="bold" />}
                预览
              </button>
              <button
                type="button"
                aria-pressed={reviewActive}
                aria-label={reviewActive
                  ? "审阅，正在审阅 AI 修改"
                  : reviewAvailable
                    ? "审阅，有 AI 修改待查看"
                    : "审阅"}
                disabled={!presentation.review.enabled}
                data-review-available={reviewAvailable ? "true" : undefined}
                data-tooltip={presentation.review.reason}
                onClick={onOpenReview}
              >
                <CheckCircleIcon aria-hidden="true" size={15} weight="duotone" />
                审阅
                {reviewAvailable ? <span className="review-attention-dot" aria-hidden="true" /> : null}
              </button>
            </div>
          </div>
          <div className="workbench-toolbar-center">
            {reviewActive ? <span className="toolbar-section-divider" aria-hidden="true" /> : null}
            <div
              id="workbench-review-tools-slot"
              className="workbench-review-tools-slot"
              aria-label="审阅工具与结果操作"
            >
            </div>
            {reviewActive ? <span className="toolbar-section-divider" aria-hidden="true" /> : null}
          </div>
          <div className="workbench-toolbar-actions">
            {recentRunOutcome && !runInProgress && !terminalRun ? (
              <button
                className="recent-run-button"
                type="button"
                aria-expanded={aiConversationVisible}
                onClick={reopenRecentRunOutcome}
              >
                <ClockCounterClockwiseIcon
                  aria-hidden="true"
                  size={18}
                  weight="duotone"
                />
                上轮处理
              </button>
            ) : null}
            {aiAssistantEntry}
            <WorkbenchMoreMenu {...moreMenu} />
          </div>
      </WorkbenchHeaderActions>
    </>
  );
}

export function WorkbenchHeaderView(props: WorkbenchHeaderToolbarProps) {
  return (
    <WorkbenchHeaderShell>
      <WorkbenchHeaderToolbar {...props} />
    </WorkbenchHeaderShell>
  );
}

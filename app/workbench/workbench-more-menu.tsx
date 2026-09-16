"use client";

import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ArrowClockwiseIcon } from "@phosphor-icons/react/dist/csr/ArrowClockwise";
import { ArrowSquareOutIcon } from "@phosphor-icons/react/dist/csr/ArrowSquareOut";
import { DotsThreeIcon } from "@phosphor-icons/react/dist/csr/DotsThree";
import { DownloadSimpleIcon } from "@phosphor-icons/react/dist/csr/DownloadSimple";
import { FolderOpenIcon } from "@phosphor-icons/react/dist/csr/FolderOpen";
import { FloppyDiskIcon } from "@phosphor-icons/react/dist/csr/FloppyDisk";
import { ClockCounterClockwiseIcon } from "@phosphor-icons/react/dist/csr/ClockCounterClockwise";
import { CheckSquareIcon } from "@phosphor-icons/react/dist/csr/CheckSquare";
import { SquareIcon } from "@phosphor-icons/react/dist/csr/Square";

type MoreMenuItem = Readonly<{
  id: string;
  label: string;
  icon: ReactNode;
  onSelect: () => void;
  dividerBefore?: boolean;
  disabled?: boolean;
  reason?: string;
  checked?: boolean;
  keepOpen?: boolean;
}>;

export type WorkbenchMoreMenuProps = Readonly<{
  isHistory?: boolean;
  canShowInFolder: boolean;
  showInFolderUnavailableReason?: string;
  onShowInFolder: () => void;
  canOpenInBrowser: boolean;
  openInBrowserUnavailableReason?: string;
  onOpenInBrowser: () => void;
  canExportCurrentHtml: boolean;
  exportUnavailableReason?: string;
  onExportCurrentHtml: (saveVersion?: boolean) => void;
  canSaveCurrentVersion?: boolean;
  saveCurrentVersionUnavailableReason?: string;
  exportAndSaveUnavailableReason?: string;
  onSaveCurrentVersion?: () => void;
  canCreateVersionFromHistory?: boolean;
  createVersionFromHistoryUnavailableReason?: string;
  onCreateVersionFromHistory?: () => void;
  canOpenPreservedDrafts?: boolean;
  preservedDraftsUnavailableReason?: string;
  onOpenPreservedDrafts?: () => void;
  canReloadCurrentSource: boolean;
  reloadCurrentSourceUnavailableReason?: string;
  onReloadCurrentSource: () => void;
  onRetryDynamicContent?: () => void;
}>;

function menuPosition(trigger: HTMLButtonElement) {
  const rect = trigger.getBoundingClientRect();
  const width = 220;
  return {
    top: Math.min(rect.bottom + 6, Math.max(8, window.innerHeight - 480)),
    left: Math.min(
      Math.max(8, rect.right - width),
      Math.max(8, window.innerWidth - width - 8),
    ),
  };
}

export function WorkbenchMoreMenu({
  isHistory = false,
  canShowInFolder,
  showInFolderUnavailableReason,
  onShowInFolder,
  canOpenInBrowser,
  openInBrowserUnavailableReason,
  onOpenInBrowser,
  canExportCurrentHtml,
  exportUnavailableReason,
  onExportCurrentHtml,
  canSaveCurrentVersion = false,
  saveCurrentVersionUnavailableReason,
  exportAndSaveUnavailableReason,
  onSaveCurrentVersion,
  canCreateVersionFromHistory = false,
  createVersionFromHistoryUnavailableReason,
  onCreateVersionFromHistory,
  canOpenPreservedDrafts = true,
  preservedDraftsUnavailableReason,
  onOpenPreservedDrafts,
  canReloadCurrentSource,
  reloadCurrentSourceUnavailableReason,
  onReloadCurrentSource,
  onRetryDynamicContent,
}: WorkbenchMoreMenuProps) {
  const menuId = useId();
  const [open, setOpen] = useState(false);
  const [saveVersionOnExport, setSaveVersionOnExport] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef(new Map<string, HTMLButtonElement>());
  const items = useMemo<readonly MoreMenuItem[]>(() => [
    ...(onSaveCurrentVersion ? [{
      id: "save-version", label: "保存为新版本",
      icon: <FloppyDiskIcon aria-hidden="true" size={16} weight="duotone" />,
      onSelect: onSaveCurrentVersion,
      disabled: isHistory || !canSaveCurrentVersion,
      reason: isHistory ? "该操作只针对当前稿" : saveCurrentVersionUnavailableReason,
    }] : []),
    ...(onCreateVersionFromHistory ? [{
      id: "create-from-history", label: "基于此版本创建新版本…",
      icon: <ClockCounterClockwiseIcon aria-hidden="true" size={16} />,
      onSelect: onCreateVersionFromHistory,
      disabled: !isHistory || !canCreateVersionFromHistory,
      reason: !isHistory
        ? "请先打开一个历史版本"
        : createVersionFromHistoryUnavailableReason,
    }] : []),
    {
      id: "show-in-folder",
      label: "在 Finder 中显示工作文件",
      icon: <FolderOpenIcon aria-hidden="true" size={16} weight="duotone" />,
      onSelect: onShowInFolder,
      disabled: !canShowInFolder,
      reason: showInFolderUnavailableReason,
    },
    {
      id: "open-in-browser",
      label: "在浏览器中打开工作文件",
      icon: <ArrowSquareOutIcon aria-hidden="true" size={16} weight="bold" />,
      onSelect: onOpenInBrowser,
      disabled: !canOpenInBrowser,
      reason: openInBrowserUnavailableReason,
    },
    {
      id: "export-html",
      label: isHistory ? "导出此版本…" : "导出当前 HTML…",
      icon: <DownloadSimpleIcon aria-hidden="true" size={16} weight="duotone" />,
      onSelect: () => onExportCurrentHtml(!isHistory && saveVersionOnExport),
      dividerBefore: true,
      disabled: !canExportCurrentHtml,
      reason: exportUnavailableReason,
    },
    ...(onSaveCurrentVersion ? [{
      id: "export-save-version", label: "同时保存为新版本",
      icon: saveVersionOnExport ? <CheckSquareIcon aria-hidden="true" size={16} /> : <SquareIcon aria-hidden="true" size={16} />,
      onSelect: () => setSaveVersionOnExport((value) => !value),
      checked: saveVersionOnExport,
      keepOpen: true,
      disabled: isHistory || !canSaveCurrentVersion || !canExportCurrentHtml,
      reason: isHistory ? "历史版本导出不会改变当前稿" : exportAndSaveUnavailableReason,
    }] : []),
    ...(onOpenPreservedDrafts ? [{
      id: "preserved-drafts", label: "找回此前的稿件…",
      icon: <ClockCounterClockwiseIcon aria-hidden="true" size={16} />,
      onSelect: onOpenPreservedDrafts,
      disabled: !canOpenPreservedDrafts,
      reason: preservedDraftsUnavailableReason,
    }] : []),
    ...(onRetryDynamicContent ? [{
      id: "retry-dynamic",
      label: "重新加载动态内容",
      icon: <ArrowClockwiseIcon aria-hidden="true" size={16} weight="duotone" />,
      onSelect: onRetryDynamicContent,
    }] : []),
    {
      id: "reload-source",
      label: "从磁盘重新载入 HTML",
      icon: <ArrowClockwiseIcon aria-hidden="true" size={16} weight="duotone" />,
      onSelect: onReloadCurrentSource,
      dividerBefore: true,
      disabled: !canReloadCurrentSource,
      reason: reloadCurrentSourceUnavailableReason,
    },
  ], [
    canCreateVersionFromHistory,
    canExportCurrentHtml,
    canOpenInBrowser,
    canOpenPreservedDrafts,
    canReloadCurrentSource,
    canSaveCurrentVersion,
    canShowInFolder,
    createVersionFromHistoryUnavailableReason,
    exportAndSaveUnavailableReason,
    exportUnavailableReason,
    isHistory,
    onCreateVersionFromHistory,
    onExportCurrentHtml,
    onOpenInBrowser,
    onOpenPreservedDrafts,
    onReloadCurrentSource,
    reloadCurrentSourceUnavailableReason,
    onRetryDynamicContent,
    onShowInFolder,
    onSaveCurrentVersion,
    openInBrowserUnavailableReason,
    preservedDraftsUnavailableReason,
    saveCurrentVersionUnavailableReason,
    saveVersionOnExport,
    showInFolderUnavailableReason,
  ]);
  const visibleItems = items;
  const close = (returnFocus = true) => {
    setOpen(false);
    if (returnFocus) window.requestAnimationFrame(() => triggerRef.current?.focus());
  };
  const closeIntoDocumentTabOrder = (backward: boolean) => {
    const trigger = triggerRef.current;
    const menu = menuRef.current;
    const focusable = Array.from(document.querySelectorAll<HTMLElement>([
      "a[href]",
      "button:not([disabled])",
      "input:not([disabled])",
      "select:not([disabled])",
      "textarea:not([disabled])",
      "[tabindex]:not([tabindex='-1'])",
    ].join(","))).filter((element) => !menu?.contains(element) && !element.hidden);
    const triggerIndex = trigger ? focusable.indexOf(trigger) : -1;
    const destination = triggerIndex < 0
      ? trigger
      : focusable[triggerIndex + (backward ? -1 : 1)] || trigger;
    setOpen(false);
    window.requestAnimationFrame(() => destination?.focus());
  };
  useEffect(() => {
    if (!open) return undefined;
    const trigger = triggerRef.current;
    if (!trigger) return undefined;
    const updatePosition = () => setPosition(menuPosition(trigger));
    const focusFirst = () => {
      if (!menuRef.current?.contains(document.activeElement)) itemRefs.current.get(visibleItems[0]?.id || "")?.focus();
    };
    updatePosition();
    window.requestAnimationFrame(focusFirst);
    const onViewportChange = () => updatePosition();
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (trigger.contains(target) || menuRef.current?.contains(target)) return;
      close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key === "Tab") {
        // The menu is portalled to body. Continue directly from the owning
        // trigger's place in document order so one Tab exits normally.
        event.preventDefault();
        closeIntoDocumentTabOrder(event.shiftKey);
        return;
      }
      if (!visibleItems.length) return;
      const currentIndex = visibleItems.findIndex(
        (item) => item.id === document.activeElement?.getAttribute("data-menu-item"),
      );
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const nextIndex = event.key === "Home"
        ? 0
        : event.key === "End"
          ? visibleItems.length - 1
          : (currentIndex + (event.key === "ArrowUp" ? -1 : 1) + visibleItems.length)
            % visibleItems.length;
      itemRefs.current.get(visibleItems[nextIndex]?.id || "")?.focus();
    };
    window.addEventListener("resize", onViewportChange);
    window.addEventListener("scroll", onViewportChange, true);
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("resize", onViewportChange);
      window.removeEventListener("scroll", onViewportChange, true);
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open, visibleItems]);

  return (
    <span className="workbench-more-menu-wrap">
      <button
        ref={triggerRef}
        className="workbench-more-menu-trigger"
        type="button"
        aria-label="更多"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        data-tooltip="更多"
        onClick={() => {
          if (open) close(false);
          else { setSaveVersionOnExport(false); setOpen(true); }
        }}
      >
        <DotsThreeIcon aria-hidden="true" size={18} weight="bold" />
      </button>
      {open ? createPortal(
        <div
          ref={menuRef}
          id={menuId}
          className="workbench-more-menu"
          role="menu"
          aria-label="更多操作"
          style={{ left: position.left, top: position.top }}
        >
          {visibleItems.map((item) => (
            <div className="workbench-more-menu-entry" key={item.id}>
              {item.dividerBefore ? <span className="workbench-more-menu-divider" role="separator" /> : null}
              <button
                ref={(element) => {
                  if (element) itemRefs.current.set(item.id, element);
                  else itemRefs.current.delete(item.id);
                }}
                type="button"
                role={item.checked === undefined ? "menuitem" : "menuitemcheckbox"}
                aria-label={item.label}
                aria-checked={item.checked}
                aria-disabled={item.disabled || undefined}
                data-menu-item={item.id}
                tabIndex={-1}
                aria-describedby={item.reason ? `${menuId}-${item.id}-reason` : undefined}
                onClick={() => {
                  if (item.disabled) return;
                  if (!item.keepOpen) close();
                  item.onSelect();
                }}
              >
                {item.icon}
                <span className="workbench-more-menu-copy">
                  <span>{item.label}</span>
                  {item.reason ? (
                    <small id={`${menuId}-${item.id}-reason`}>{item.reason}</small>
                  ) : null}
                </span>
              </button>
            </div>
          ))}
        </div>,
        document.body,
      ) : null}
    </span>
  );
}

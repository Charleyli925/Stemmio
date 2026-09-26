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

type MoreMenuItem = Readonly<{
  id: string;
  label: string;
  icon: ReactNode;
  onSelect: () => void;
  dividerBefore?: boolean;
  disabled?: boolean;
  reason?: string;
}>;

export type WorkbenchMoreMenuProps = Readonly<{
  contextKey: string;
  isHistory?: boolean;
  canShowInFolder: boolean;
  showInFolderUnavailableReason?: string;
  onShowInFolder: () => void;
  canOpenInBrowser: boolean;
  openInBrowserUnavailableReason?: string;
  onOpenInBrowser: () => void;
  canExportCurrentHtml: boolean;
  exportUnavailableReason?: string;
  onExportCurrentHtml: () => void;
  canSaveCurrentVersion?: boolean;
  saveCurrentVersionUnavailableReason?: string;
  onSaveCurrentVersion?: () => void;
  canCreateVersionFromHistory?: boolean;
  createVersionFromHistoryUnavailableReason?: string;
  onCreateVersionFromHistory?: () => void;
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

export function WorkbenchMoreMenu({ contextKey, ...props }: WorkbenchMoreMenuProps) {
  return <WorkbenchMoreMenuContent key={contextKey} {...props} />;
}

function WorkbenchMoreMenuContent({
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
  onSaveCurrentVersion,
  canCreateVersionFromHistory = false,
  createVersionFromHistoryUnavailableReason,
  onCreateVersionFromHistory,
  canReloadCurrentSource,
  reloadCurrentSourceUnavailableReason,
  onReloadCurrentSource,
  onRetryDynamicContent,
}: Omit<WorkbenchMoreMenuProps, "contextKey">) {
  const menuId = useId();
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef(new Map<string, HTMLButtonElement>());
  const items = useMemo<readonly MoreMenuItem[]>(() => [
    ...(onSaveCurrentVersion ? [{
      id: "save-version", label: "保存到历史版本",
      icon: <FloppyDiskIcon aria-hidden="true" size={16} weight="duotone" />,
      onSelect: onSaveCurrentVersion,
      disabled: isHistory || !canSaveCurrentVersion,
      reason: isHistory ? "该操作只针对当前稿" : saveCurrentVersionUnavailableReason
        || "保留此刻的内容，继续编辑当前稿",
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
      label: "在 Finder 中显示",
      icon: <FolderOpenIcon aria-hidden="true" size={16} weight="duotone" />,
      onSelect: onShowInFolder,
      disabled: !canShowInFolder,
      reason: showInFolderUnavailableReason,
    },
    {
      id: "open-in-browser",
      label: "在浏览器中打开",
      icon: <ArrowSquareOutIcon aria-hidden="true" size={16} weight="bold" />,
      onSelect: onOpenInBrowser,
      disabled: !canOpenInBrowser,
      reason: openInBrowserUnavailableReason,
    },
    {
      id: "export-html",
      label: isHistory ? "导出此版本…" : "导出当前 HTML…",
      icon: <DownloadSimpleIcon aria-hidden="true" size={16} weight="duotone" />,
      onSelect: onExportCurrentHtml,
      dividerBefore: true,
      disabled: !canExportCurrentHtml,
      reason: exportUnavailableReason,
    },
    ...(onRetryDynamicContent ? [{
      id: "retry-dynamic",
      label: "重新加载动态内容",
      icon: <ArrowClockwiseIcon aria-hidden="true" size={16} weight="duotone" />,
      onSelect: onRetryDynamicContent,
    }] : []),
    {
      id: "reload-source",
      label: "刷新",
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
    canReloadCurrentSource,
    canSaveCurrentVersion,
    canShowInFolder,
    createVersionFromHistoryUnavailableReason,
    exportUnavailableReason,
    isHistory,
    onCreateVersionFromHistory,
    onExportCurrentHtml,
    onOpenInBrowser,
    onReloadCurrentSource,
    reloadCurrentSourceUnavailableReason,
    onRetryDynamicContent,
    onShowInFolder,
    onSaveCurrentVersion,
    openInBrowserUnavailableReason,
    saveCurrentVersionUnavailableReason,
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
    const focusFrame = window.requestAnimationFrame(focusFirst);
    const onViewportChange = () => updatePosition();
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (trigger.contains(target) || menuRef.current?.contains(target)) return;
      close(false);
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
      window.cancelAnimationFrame(focusFrame);
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
          else setOpen(true);
        }}
      >
        <DotsThreeIcon aria-hidden="true" size={18} weight="bold" />
      </button>
      {open ? createPortal(
        <>
        <div className="workbench-more-menu-dismiss" aria-hidden="true" data-html-canvas-preserve-selection="true"
          onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); close(); }} />
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
                role="menuitem"
                aria-label={item.label}
                aria-disabled={item.disabled || undefined}
                data-menu-item={item.id}
                tabIndex={-1}
                aria-describedby={item.reason ? `${menuId}-${item.id}-reason` : undefined}
                onClick={() => {
                  if (item.disabled) return;
                  close(false);
                  if (item.id === "export-html") triggerRef.current?.focus();
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
        </div>
        </>,
        document.body,
      ) : null}
    </span>
  );
}

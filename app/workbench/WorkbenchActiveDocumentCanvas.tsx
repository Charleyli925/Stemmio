"use client";

import {
  cloneElement,
  useEffect,
  useState,
  type ReactElement,
  type Ref,
} from "react";

import type {
  HtmlCanvasEditorHandle,
  HtmlCanvasEditorProps,
} from "../components/HtmlCanvasEditor";

import styles from "./workbench-active-document-canvas.module.css";

export default function WorkbenchActiveDocumentCanvas({
  activeTabId,
  activeSourceSha256,
  activeElement,
  activeReady,
  activeFailed,
  presentationVisible,
  failureMessage,
  onRetry,
}: {
  activeTabId: string | null;
  activeSourceSha256: string | null;
  activeElement: ReactElement<HtmlCanvasEditorProps & {
    ref?: Ref<HtmlCanvasEditorHandle>;
  }> | null;
  activeReady: boolean;
  activeFailed: boolean;
  presentationVisible: boolean;
  failureMessage: string | null;
  onRetry(): void;
}) {
  const [lastVerified, setLastVerified] = useState<{
    tabId: string;
    sourceSha256: string | null;
    element: NonNullable<typeof activeElement>;
  } | null>(null);
  // Retain only the last verified document. Intermediate ProjectWorkflow
  // renders cannot replace A's exact element with B's unverified HTML.
  if (activeTabId && activeElement && activeReady
    && (lastVerified?.tabId !== activeTabId
      || lastVerified.sourceSha256 !== activeSourceSha256)) {
    setLastVerified({
      tabId: activeTabId,
      sourceSha256: activeSourceSha256,
      element: activeElement,
    });
  }
  const outgoing = lastVerified?.tabId !== activeTabId
    && lastVerified
    && !activeReady
    && !activeFailed
    && presentationVisible
    ? lastVerified
    : null;
  useEffect(() => {
    if (!activeTabId || !activeSourceSha256 || !activeElement) return;
    performance.mark("stemmio:runtime-hot:visible-ready", {
      detail: Object.freeze({ tabId: activeTabId, sourceSha256: activeSourceSha256 }),
    });
  }, [activeElement, activeSourceSha256, activeTabId]);

  if (!activeElement) return null;
  return (
    <div
      className={styles.host}
      data-testid="workbench-active-document-canvas-host"
      data-runtime-hot-count={outgoing ? 2 : 1}
      data-runtime-hot-limit={2}
    >
      {outgoing ? <div
        className={styles.entry}
        data-runtime-hot-active="false"
        data-outgoing-draft={outgoing.tabId}
        aria-hidden="true"
        inert
        key={outgoing.tabId}
      >
        {cloneElement(outgoing.element, {
          ref: null,
          locked: true,
          readOnly: true,
          interactionMode: "processing",
          enableReorder: false,
          onChange: (): false => false,
          onSelect: undefined,
          onInteraction: undefined,
          onCommentLayout: undefined,
          onReadingIntent: undefined,
          onRequestComment: undefined,
          onRequestFlush: undefined,
          onRequestExport: undefined,
          onRequestHistory: undefined,
          onRequestReload: undefined,
          onReady: undefined,
          onEditBlocked: undefined,
          onPageViewContextChange: undefined,
          onEditRuntimeLoadStart: undefined,
          onEditRuntimeLoadOutcome: undefined,
          onRuntimeDegradationChange: undefined,
          usageCapture: undefined,
        })}
      </div> : null}
      <div
        className={styles.entry}
        data-runtime-hot-active={outgoing ? "false" : "true"}
        data-handoff-candidate={outgoing ? "true" : undefined}
        aria-hidden={outgoing ? true : undefined}
        inert={outgoing ? true : undefined}
        key={activeTabId || "none"}
      >
        {activeElement}
      </div>
      {activeFailed && failureMessage ? <section
        className={styles.failure}
        role="alert"
        aria-label="当前稿打开失败"
      >
        <strong>当前稿暂时无法显示</strong>
        <span>{failureMessage}</span>
        <button type="button" onClick={onRetry}>重试打开</button>
      </section> : null}
    </div>
  );
}

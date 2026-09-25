"use client";

import {
  cloneElement,
  useEffect,
  useLayoutEffect,
  useRef,
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
  retirePreviousTab,
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
  retirePreviousTab: boolean;
  presentationVisible: boolean;
  failureMessage: string | null;
  onRetry(): void;
}) {
  const [lastVerified, setLastVerified] = useState<{
    tabId: string;
    sourceSha256: string | null;
    entryKey: string;
    element: NonNullable<typeof activeElement>;
  } | null>(null);
  const activeEntryRef = useRef<HTMLDivElement | null>(null);
  const [lastVerifiedGeometry, setLastVerifiedGeometry] = useState<{
    entryKey: string;
    width: number;
    height: number;
  } | null>(null);
  const [activation, setActivation] = useState({ tabId: activeTabId, ordinal: 0 });
  const currentActivation = activation.tabId === activeTabId
    ? activation
    : { tabId: activeTabId, ordinal: activation.ordinal + 1 };
  if (currentActivation !== activation) setActivation(currentActivation);
  const activeEntryKey = `${activeTabId || "none"}:${currentActivation.ordinal}`;
  // Retain only the last verified document. Intermediate ProjectWorkflow
  // renders cannot replace A's exact element with B's unverified HTML.
  if (activeTabId && activeElement && activeReady
    && (lastVerified?.tabId !== activeTabId
      || lastVerified.sourceSha256 !== activeSourceSha256
      || lastVerified.entryKey !== activeEntryKey)) {
    setLastVerified({
      tabId: activeTabId,
      sourceSha256: activeSourceSha256,
      entryKey: activeEntryKey,
      element: activeElement,
    });
  } else if (retirePreviousTab && lastVerified && lastVerified.tabId !== activeTabId) {
    // A ready Preview for the destination supersedes the prior document's
    // Edit image. Do not resurrect that image on Preview -> Edit.
    setLastVerified(null);
  }
  // Entry keys follow tab activations, preserving the mounted outgoing DOM.
  // Returning to A after starting B gets a distinct candidate key while the
  // earlier A keeps its original key until the returned A verifies.
  const outgoing = lastVerified?.entryKey !== activeEntryKey
    && lastVerified
    && !activeReady
    && !activeFailed
    && presentationVisible
    ? lastVerified
    : null;
  useLayoutEffect(() => {
    const entry = activeEntryRef.current;
    if (!entry || !activeReady || outgoing) return;
    const measure = () => {
      const bounds = entry.getBoundingClientRect();
      if (bounds.width <= 0 || bounds.height <= 0) return;
      setLastVerifiedGeometry((current) => current?.entryKey === activeEntryKey
        && current.width === bounds.width && current.height === bounds.height
        ? current
        : { entryKey: activeEntryKey, width: bounds.width, height: bounds.height });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(entry);
    return () => observer.disconnect();
  }, [activeEntryKey, activeReady, outgoing]);
  const outgoingGeometry = outgoing?.entryKey === lastVerifiedGeometry?.entryKey
    ? lastVerifiedGeometry : null;
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
        style={outgoingGeometry ? {
          width: outgoingGeometry.width,
          height: outgoingGeometry.height,
        } : undefined}
        data-runtime-hot-active="false"
        data-outgoing-draft={outgoing.tabId}
        aria-hidden="true"
        inert
        key={outgoing.entryKey}
      >
        {cloneElement(outgoing.element, {
          ref: null,
          height: outgoingGeometry?.height ?? outgoing.element.props.height,
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
        ref={activeEntryRef}
        className={styles.entry}
        data-runtime-hot-active={outgoing ? "false" : "true"}
        data-handoff-candidate={outgoing ? "true" : undefined}
        aria-hidden={outgoing ? true : undefined}
        inert={outgoing ? true : undefined}
        key={activeEntryKey}
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

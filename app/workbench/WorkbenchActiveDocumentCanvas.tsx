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
import type { DisplayTarget } from "./display-handoff-decision";
import type { DisplaySurfaceHandoffState } from "./use-display-handoff";

import styles from "./workbench-active-document-canvas.module.css";

export default function WorkbenchActiveDocumentCanvas({
  activeTabId,
  activeSourceSha256,
  activeElement,
  activeReady,
  activeFailed,
  handoff,
  onRetainedChange,
  presentationVisible,
  foregroundVisible,
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
  handoff: DisplaySurfaceHandoffState;
  onRetainedChange(target: DisplayTarget | null): void;
  presentationVisible: boolean;
  foregroundVisible: boolean;
  failureMessage: string | null;
  onRetry(): void;
}) {
  const [lastVerified, setLastVerified] = useState<{
    tabId: string;
    sourceSha256: string | null;
    entryKey: string;
    identity: string;
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
  const activeTarget = handoff.target;
  const canRegisterActive = Boolean(
    activeTabId
    && activeElement
    && activeReady
    && activeTarget
    && handoff.reveal,
  );
  if (canRegisterActive && activeTarget && activeTabId && activeElement) {
    if (!lastVerified
      || lastVerified.entryKey !== activeEntryKey
      || lastVerified.tabId !== activeTabId
      || lastVerified.sourceSha256 !== activeSourceSha256
      || lastVerified.identity !== activeTarget.identity) {
      setLastVerified({
        tabId: activeTabId,
        sourceSha256: activeSourceSha256,
        entryKey: activeEntryKey,
        identity: activeTarget.identity,
        element: activeElement,
      });
    }
  } else if (handoff.release || (!handoff.retain && !handoff.reveal && (activeFailed || !activeReady))) {
    if (lastVerified) setLastVerified(null);
  }
  useLayoutEffect(() => {
    if (canRegisterActive && activeTarget) {
      onRetainedChange(activeTarget);
      return;
    }
    if (handoff.release || (!handoff.retain && !handoff.reveal && (activeFailed || !activeReady))) {
      onRetainedChange(null);
    }
  }, [
    activeElement,
    activeEntryKey,
    activeFailed,
    activeReady,
    activeSourceSha256,
    activeTabId,
    canRegisterActive,
    handoff.retain,
    handoff.release,
    handoff.reveal,
    activeTarget,
    onRetainedChange,
  ]);
  // Entry keys follow tab activations, preserving the mounted outgoing DOM.
  // Returning to A after starting B gets a distinct candidate key while the
  // earlier A keeps its original key until the returned A verifies.
  const outgoing = handoff.retain
    && lastVerified
    && lastVerified.entryKey !== activeEntryKey
    && lastVerified.identity !== activeTarget?.identity
    ? lastVerified
    : null;
  const retainedActive = Boolean(
    handoff.retain
    && lastVerified?.entryKey === activeEntryKey,
  );
  const activeVisible = Boolean(
    (handoff.reveal && foregroundVisible && !outgoing)
    || retainedActive,
  );
  const outgoingEntryRef = useRef<string | null>(null);
  const displayedEntryRef = useRef<string | null>(null);
  const editVisibleRef = useRef(false);
  useEffect(() => {
    if (!presentationVisible || !foregroundVisible || !activeReady || !handoff.reveal || outgoing) {
      editVisibleRef.current = false;
      return;
    }
    if (editVisibleRef.current) return;
    performance.mark("stemmio:edit-canvas:display-handoff", {
      detail: Object.freeze({
        activationId: activeEntryKey,
        targetType: "edit-canvas",
        actionReason: displayedEntryRef.current === activeEntryKey ? "mode-return" : "tab-activation",
        outcome: "verified",
      }),
    });
    displayedEntryRef.current = activeEntryKey;
    editVisibleRef.current = true;
  }, [activeEntryKey, activeReady, foregroundVisible, handoff.reveal, outgoing, presentationVisible]);
  useEffect(() => {
    if (outgoing) {
      outgoingEntryRef.current = outgoing.entryKey;
      return;
    }
    if (!outgoingEntryRef.current || (!activeReady && !activeFailed && !handoff.release)) return;
    performance.mark("stemmio:edit-canvas:outgoing-release", {
      detail: Object.freeze({
        activationId: activeEntryKey,
        releasedActivationId: outgoingEntryRef.current,
        targetType: "edit-canvas",
        actionReason: activeFailed
          ? "target-failed"
          : handoff.release
            ? "handoff-release"
            : "target-ready",
      }),
    });
    outgoingEntryRef.current = null;
  }, [activeEntryKey, activeFailed, activeReady, handoff.release, outgoing]);
  useLayoutEffect(() => {
    const entry = activeEntryRef.current;
    if (!entry || !activeReady || !handoff.reveal || outgoing) return;
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
  }, [activeEntryKey, activeReady, handoff.reveal, outgoing]);
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
      data-display-handoff-role={handoff.reveal
        ? "target"
        : handoff.retain
          ? "outgoing"
          : "candidate"}
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
          diagnosticActivationId: outgoing.entryKey,
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
        data-runtime-hot-active={activeVisible ? "true" : "false"}
        data-handoff-candidate={activeVisible ? undefined : "true"}
        aria-hidden={foregroundVisible && !outgoing ? undefined : true}
        inert={foregroundVisible && !outgoing ? undefined : true}
        key={activeEntryKey}
      >
        {cloneElement(activeElement, { diagnosticActivationId: activeEntryKey })}
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

"use client";

import { cloneElement, useEffect, useLayoutEffect, useRef, useState, type ReactElement, type Ref } from "react";

import type {
  HtmlInteractionPreviewHandle,
  HtmlInteractionPreviewProps,
} from "../components/HtmlInteractionPreview";
import styles from "./workbench-active-preview.module.css";

type PreviewElement = ReactElement<HtmlInteractionPreviewProps & {
  ref?: Ref<HtmlInteractionPreviewHandle>;
}>;

/** Keep the last loaded Preview visible until the next exact document is ready. */
export default function WorkbenchActivePreview({
  identity,
  activeElement,
  activeReady,
  activeFailed,
  activeOutcome,
  activeDegradationReason,
  activeAttemptId,
  carryForEdit,
  onRetry,
}: {
  identity: string;
  activeElement: PreviewElement;
  activeReady: boolean;
  activeFailed: boolean;
  activeOutcome?: "verified" | "degraded" | "failed";
  activeDegradationReason?: "paint-timeout" | "host-timeout" | "history-static";
  activeAttemptId?: string;
  carryForEdit: boolean;
  onRetry(): void;
}) {
  const [lastDisplayed, setLastDisplayed] = useState<{
    identity: string;
    element: PreviewElement;
  } | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [previewGeometry, setPreviewGeometry] = useState<{ width: number; height: number } | null>(null);
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host || carryForEdit) return;
    const measure = () => {
      const bounds = host.getBoundingClientRect();
      if (bounds.width <= 0 || bounds.height <= 0) return;
      setPreviewGeometry((previous) => previous?.width === bounds.width && previous.height === bounds.height
        ? previous
        : { width: bounds.width, height: bounds.height });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    return () => observer.disconnect();
  }, [carryForEdit]);
  if (activeFailed && lastDisplayed) {
    setLastDisplayed(null);
  } else if (activeReady && lastDisplayed?.identity !== identity) {
    setLastDisplayed({ identity, element: activeElement });
  }
  const outgoing = lastDisplayed?.identity !== identity && !activeReady && !activeFailed
    ? lastDisplayed
    : null;
  const hadOutgoingRef = useRef(false);
  const lastHandoffAttemptRef = useRef<string | null>(null);
  useEffect(() => {
    if (outgoing) {
      hadOutgoingRef.current = true;
      return;
    }
    if (!activeAttemptId || (!activeReady && !activeFailed)) return;
    if (lastHandoffAttemptRef.current !== activeAttemptId && activeReady) {
      lastHandoffAttemptRef.current = activeAttemptId;
      performance.mark("stemmio:preview:display-handoff", {
        detail: Object.freeze({ attemptId: activeAttemptId, outcome: activeOutcome }),
      });
    }
    if (hadOutgoingRef.current) {
      hadOutgoingRef.current = false;
      performance.mark("stemmio:preview:outgoing-release", {
        detail: Object.freeze({ attemptId: activeAttemptId, outcome: activeOutcome }),
      });
    }
  }, [activeAttemptId, activeFailed, activeOutcome, activeReady, outgoing]);

  return (
    <div
      ref={hostRef}
      className={styles.host}
      style={carryForEdit && previewGeometry ? previewGeometry : undefined}
      data-testid="workbench-active-preview"
      data-preview-ready={activeReady ? "true" : "false"}
      data-preview-outcome={activeOutcome}
      data-preview-degradation={activeDegradationReason}
      data-outgoing-preview={outgoing ? "true" : undefined}
      data-preview-carry={carryForEdit ? "true" : undefined}
    >
      {outgoing ? (
        <div className={styles.entry} aria-hidden="true" inert key={outgoing.identity}>
          {cloneElement(outgoing.element, { ref: null })}
        </div>
      ) : null}
      <div
        className={styles.entry}
        data-handoff-candidate={!activeReady ? "true" : undefined}
        aria-hidden={!activeReady ? true : undefined}
        inert={!activeReady ? true : undefined}
        key={identity}
      >
        {activeElement}
      </div>
      {activeFailed ? (
        <div className={styles.status} role="status">
          <span>预览暂时无法显示</span>
          <button type="button" onClick={onRetry}>重试打开</button>
        </div>
      ) : null}
    </div>
  );
}

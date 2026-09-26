"use client";

import { cloneElement, useEffect, useLayoutEffect, useRef, useState, type ReactElement, type Ref } from "react";

import type {
  HtmlInteractionPreviewHandle,
  HtmlInteractionPreviewProps,
} from "../components/HtmlInteractionPreview";
import type { DisplayTarget } from "./display-handoff-decision";
import type { DisplaySurfaceHandoffState } from "./use-display-handoff";
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
  handoff,
  onRetainedChange,
  onPhysicalPresenceChange,
  carryForEdit,
  parked,
  onRetry,
}: {
  identity: string;
  activeElement: PreviewElement | null;
  activeReady: boolean;
  activeFailed: boolean;
  activeOutcome?: "verified" | "degraded" | "failed";
  activeDegradationReason?: "paint-timeout" | "host-timeout" | "history-static";
  activeAttemptId?: string;
  handoff: DisplaySurfaceHandoffState;
  onRetainedChange(target: DisplayTarget | null): void;
  onPhysicalPresenceChange(identity: string, mounted: boolean): void;
  carryForEdit: boolean;
  parked: boolean;
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
  const activeTarget = handoff.target;
  const canRegisterActive = Boolean(
    activeElement
    && activeReady
    && !activeFailed
    && activeTarget
    && handoff.reveal,
  );
  if (canRegisterActive && activeTarget && activeElement) {
    if (!lastDisplayed || lastDisplayed.identity !== identity) {
      setLastDisplayed({ identity, element: activeElement });
    }
  } else if (handoff.release || activeFailed || (!handoff.retain && !handoff.reveal && !activeReady)) {
    if (lastDisplayed) setLastDisplayed(null);
  }
  useLayoutEffect(() => {
    if (canRegisterActive && activeTarget) {
      onRetainedChange(activeTarget);
      return;
    }
    if (handoff.release || activeFailed || (!handoff.retain && !handoff.reveal && !activeReady)) {
      onRetainedChange(null);
    }
  }, [
    activeElement,
    activeFailed,
    activeReady,
    canRegisterActive,
    handoff.retain,
    handoff.release,
    handoff.reveal,
    activeTarget,
    identity,
    onRetainedChange,
  ]);
  const retainedActive = Boolean(
    handoff.retain
    && activeReady
    && lastDisplayed?.identity === identity,
  );
  const outgoing = handoff.retain && !retainedActive && lastDisplayed
    && lastDisplayed.identity !== identity
    ? lastDisplayed
    : null;
  const activeVisible = handoff.reveal || retainedActive;
  const activeInteractive = handoff.reveal && !carryForEdit;
  const activeContent = activeElement || (retainedActive ? lastDisplayed?.element : null);
  const hasActiveContent = Boolean(activeContent);
  // A retained iframe may keep running, but only the revealed foreground
  // instance may publish the tab's reading position.
  const presentedContent = activeContent ? cloneElement(activeContent, {
    onScrollTopChange: activeInteractive && !parked
      ? activeContent.props.onScrollTopChange
      : undefined,
  }) : null;
  // A Preview's physical iframe owns its session and author-script lifetime.
  // Keep the entry keyed by that instance as its role changes; a role-prefixed
  // key would unmount the verified iframe and create a second Preview session.
  const entries = [
    ...(outgoing ? [
      <div className={styles.entry} aria-hidden="true" inert key={`preview:${outgoing.identity}`}>
        {cloneElement(outgoing.element, { ref: null, onScrollTopChange: undefined })}
      </div>,
    ] : []),
    <div
      className={styles.entry}
      data-handoff-candidate={activeVisible ? undefined : "true"}
      aria-hidden={activeInteractive ? undefined : true}
      inert={activeInteractive ? undefined : true}
      key={`preview:${identity}`}
    >
      {presentedContent}
    </div>,
  ];
  useLayoutEffect(() => {
    if (!hasActiveContent) return undefined;
    onPhysicalPresenceChange(identity, true);
    return () => onPhysicalPresenceChange(identity, false);
  }, [hasActiveContent, identity, onPhysicalPresenceChange]);
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
      style={parked ? { visibility: "hidden", pointerEvents: "none" }
        : carryForEdit && previewGeometry ? previewGeometry : undefined}
      data-testid="workbench-active-preview"
      data-preview-ready={activeReady ? "true" : "false"}
      data-preview-outcome={activeOutcome}
      data-preview-degradation={activeDegradationReason}
      data-display-handoff-role={handoff.reveal
        ? "target"
        : handoff.retain
          ? "outgoing"
          : "candidate"}
      data-outgoing-preview={outgoing ? "true" : undefined}
      data-preview-carry={carryForEdit ? "true" : undefined}
      data-preview-parked={parked ? "true" : undefined}
    >
      {entries}
      {activeFailed ? (
        <div className={styles.status} role="status">
          <span>预览暂时无法显示</span>
          <button type="button" onClick={onRetry}>重试打开</button>
        </div>
      ) : null}
    </div>
  );
}

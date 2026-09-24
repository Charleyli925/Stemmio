"use client";

import { cloneElement, useLayoutEffect, useRef, useState, type ReactElement, type Ref } from "react";

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
  carryForEdit,
  onRetry,
}: {
  identity: string;
  activeElement: PreviewElement;
  activeReady: boolean;
  activeFailed: boolean;
  carryForEdit: boolean;
  onRetry(): void;
}) {
  const [lastVerified, setLastVerified] = useState<{
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
  if (activeReady && lastVerified?.identity !== identity) {
    setLastVerified({ identity, element: activeElement });
  }
  const outgoing = lastVerified?.identity !== identity && !activeReady
    ? lastVerified
    : null;

  return (
    <div
      ref={hostRef}
      className={styles.host}
      style={carryForEdit && previewGeometry ? previewGeometry : undefined}
      data-testid="workbench-active-preview"
      data-preview-ready={activeReady ? "true" : "false"}
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

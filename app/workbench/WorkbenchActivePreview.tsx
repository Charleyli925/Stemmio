"use client";

import { cloneElement, useState, type ReactElement, type Ref } from "react";

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
  onRetry,
}: {
  identity: string;
  activeElement: PreviewElement;
  activeReady: boolean;
  activeFailed: boolean;
  onRetry(): void;
}) {
  const [lastVerified, setLastVerified] = useState<{
    identity: string;
    element: PreviewElement;
  } | null>(null);
  if (activeReady && lastVerified?.identity !== identity) {
    setLastVerified({ identity, element: activeElement });
  }
  const outgoing = lastVerified?.identity !== identity && !activeReady
    ? lastVerified
    : null;

  return (
    <div
      className={styles.host}
      data-testid="workbench-active-preview"
      data-preview-ready={activeReady ? "true" : "false"}
      data-outgoing-preview={outgoing ? "true" : undefined}
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
      {!activeReady ? (
        <div className={styles.status} role="status">
          {activeFailed ? (
            <>
              <span>预览暂时无法显示</span>
              <button type="button" onClick={onRetry}>重试打开</button>
            </>
          ) : "正在打开预览…"}
        </div>
      ) : null}
    </div>
  );
}

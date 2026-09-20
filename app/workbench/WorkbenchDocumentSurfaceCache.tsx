"use client";

import { useCallback, useMemo } from "react";

import type {
  DocumentSurfaceCacheToken,
  DocumentSurfaceCacheSnapshot,
} from "../application/document-surface-cache-session.js";
import {
  documentSurfaceCacheToken,
  sameDocumentSurfaceCacheToken,
} from "../application/document-surface-cache-session.js";
import HtmlDisplaySurface from "../components/HtmlDisplaySurface";
import {
  sameDocumentSurfaceHandoffToken,
  type DocumentSurfaceHandoffToken,
} from "./document-surface-presentation";
import styles from "./workbench-document-surface-cache.module.css";

export default function WorkbenchDocumentSurfaceCache({
  snapshot,
  visibleTabId,
  visibleSourceSha256,
  candidateTabId = null,
  candidateSourceSha256 = null,
  candidateHandoffId = null,
  acceptDisplayReady,
  onHandoffScroll,
  onFirstScroll,
  height,
}: {
  snapshot: DocumentSurfaceCacheSnapshot;
  visibleTabId: string | null;
  visibleSourceSha256: string | null;
  candidateTabId?: string | null;
  candidateSourceSha256?: string | null;
  candidateHandoffId?: string | null;
  acceptDisplayReady: (token: DocumentSurfaceHandoffToken) => boolean;
  onHandoffScroll: (token: DocumentSurfaceCacheToken, scrollTop: number) => void;
  onFirstScroll: (tabId: string, scrollTop: number) => void;
  height: string;
}) {
  // Source projections are data-only until an exact tab-switch handoff asks
  // for them. Normal inactive and active tabs own no display iframe.
  const isExplicitHandoffSurface = (entry: DocumentSurfaceCacheSnapshot["entries"][number]) => (
    (entry.tabId === candidateTabId && entry.sourceSha256 === candidateSourceSha256)
    || (entry.tabId === visibleTabId && entry.sourceSha256 === visibleSourceSha256)
  );
  const handoffEntries = snapshot.entries.filter(isExplicitHandoffSurface);
  const visibleToken = useMemo(() => (
    visibleTabId && visibleSourceSha256
      ? documentSurfaceCacheToken({ tabId: visibleTabId, sourceSha256: visibleSourceSha256 })
      : null
  ), [visibleSourceSha256, visibleTabId]);
  const candidateToken = useMemo(() => (
    candidateTabId && candidateSourceSha256
      ? documentSurfaceCacheToken({ tabId: candidateTabId, sourceSha256: candidateSourceSha256 })
      : null
  ), [candidateSourceSha256, candidateTabId]);
  const candidateHandoffToken = useMemo<DocumentSurfaceHandoffToken | null>(() => (
    candidateToken && candidateHandoffId
      ? Object.freeze({ ...candidateToken, handoffId: candidateHandoffId })
      : null
  ), [candidateHandoffId, candidateToken]);
  const reportScrollableReady = useCallback((token: DocumentSurfaceHandoffToken) => {
    // Scroll wiring is observable separately, but it never admits a cache
    // cover. Static-frame readiness alone asks the existing handoff owner.
    if (!sameDocumentSurfaceHandoffToken(token, candidateHandoffToken)) return;
    performance.mark("stemmio:tab-cache:scrollable-ready", {
      detail: Object.freeze(token),
    });
  }, [candidateHandoffToken]);
  const reportDisplayReady = useCallback((token: DocumentSurfaceHandoffToken) => {
    if (!sameDocumentSurfaceHandoffToken(token, candidateHandoffToken)) return;
    if (!acceptDisplayReady(token)) return;
    performance.mark("stemmio:tab-cache:visible-ready", {
      detail: Object.freeze(token),
    });
  }, [acceptDisplayReady, candidateHandoffToken]);
  // The parent hook is the single presentation owner. This component mounts a
  // hidden candidate and renders only the exact token it has accepted.
  const renderedPresentedToken = visibleToken
    && candidateToken
    && sameDocumentSurfaceCacheToken(visibleToken, candidateToken)
    && handoffEntries.some((entry) => (
      entry.tabId === visibleToken.tabId
      && entry.sourceSha256 === visibleToken.sourceSha256
    ))
    ? visibleToken
    : null;
  return (
    <div
      className={styles.cache}
      data-testid="workbench-document-surface-cache"
      data-visible={renderedPresentedToken ? "true" : undefined}
      data-visible-tab-id={renderedPresentedToken?.tabId || undefined}
      data-visible-source-sha256={renderedPresentedToken?.sourceSha256 || undefined}
      data-candidate-tab-id={candidateHandoffToken?.tabId || undefined}
      data-candidate-handoff-id={candidateHandoffToken?.handoffId || undefined}
      data-mounted-count={handoffEntries.length}
      data-cache-entry-count={snapshot.entries.length}
      data-cold-count={snapshot.coldTabIds.length}
      data-cache-bytes={snapshot.totalBytes}
      data-presentation-count={snapshot.presentations.length}
      data-presentation-bytes={snapshot.presentationBytes}
      data-max-cache-entries={snapshot.limits.maxEntries}
      data-max-cache-bytes={snapshot.limits.maxBytes}
      aria-hidden={!renderedPresentedToken}
    >
      {handoffEntries.map((entry) => {
        const entryToken = documentSurfaceCacheToken(entry);
        const isCandidate = sameDocumentSurfaceCacheToken(entryToken, candidateToken);
        const displayReadyToken = isCandidate ? candidateHandoffToken : null;
        const presentationKey = `${entry.tabId}:${entry.sourceSha256}:${displayReadyToken?.handoffId || "presented"}`;
        return (
          <div
            className={styles.entry}
            data-tab-id={entry.tabId}
            data-source-sha256={entry.sourceSha256}
            data-scroll-top={entry.scrollTop}
            hidden={entry.tabId !== renderedPresentedToken?.tabId
              || entry.sourceSha256 !== renderedPresentedToken?.sourceSha256}
            key={`${entry.tabId}:${entry.sourceSha256}`}
          >
            <HtmlDisplaySurface
              presentationKey={presentationKey}
              displayReadyToken={displayReadyToken}
              html={entry.html}
              sourcePath={entry.sourcePath}
              height={height}
              status={null}
              initialScrollTop={entry.scrollTop}
              onScrollTopChange={(scrollTop) => onHandoffScroll({
                tabId: entry.tabId,
                sourceSha256: entry.sourceSha256,
              }, scrollTop)}
              onFirstScroll={(scrollTop) => onFirstScroll(entry.tabId, scrollTop)}
              onDisplayReady={displayReadyToken ? reportDisplayReady : undefined}
              onScrollableReady={displayReadyToken ? reportScrollableReady : undefined}
            />
          </div>
        );
      })}
    </div>
  );
}

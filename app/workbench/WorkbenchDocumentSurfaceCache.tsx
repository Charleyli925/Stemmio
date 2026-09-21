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
  visibleHandoffId = null,
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
  visibleHandoffId?: string | null;
  candidateTabId?: string | null;
  candidateSourceSha256?: string | null;
  candidateHandoffId?: string | null;
  acceptDisplayReady: (token: DocumentSurfaceHandoffToken) => boolean;
  onHandoffScroll: (token: DocumentSurfaceCacheToken, scrollTop: number) => void;
  onFirstScroll: (tabId: string, scrollTop: number) => void;
  height: string;
}) {
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
  const visibleHandoffToken = useMemo<DocumentSurfaceHandoffToken | null>(() => (
    visibleToken && visibleHandoffId
      ? Object.freeze({ ...visibleToken, handoffId: visibleHandoffId })
      : null
  ), [visibleHandoffId, visibleToken]);
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
  // The parent hook is the single presentation owner. It can legitimately
  // retain one accepted iframe while a distinct candidate is still loading.
  // Keep those physical instances separate even when their cache identity is
  // the same: the newer iframe must never inherit the older ready state.
  const handoffSurfaces = useMemo(() => {
    const surfaces: Array<Readonly<{
      entry: DocumentSurfaceCacheSnapshot["entries"][number];
      token: DocumentSurfaceHandoffToken;
    }>> = [];
    const append = (token: DocumentSurfaceHandoffToken | null) => {
      if (!token || surfaces.some((surface) => (
        sameDocumentSurfaceHandoffToken(surface.token, token)
      ))) return;
      const entry = snapshot.entries.find((candidate) => (
        sameDocumentSurfaceCacheToken(candidate, token)
      ));
      if (entry) surfaces.push(Object.freeze({ entry, token }));
    };
    append(visibleHandoffToken);
    append(candidateHandoffToken);
    return Object.freeze(surfaces);
  }, [candidateHandoffToken, snapshot.entries, visibleHandoffToken]);
  const renderedPresentedSurface = handoffSurfaces.find((surface) => (
    sameDocumentSurfaceHandoffToken(surface.token, visibleHandoffToken)
  )) || null;
  return (
    <div
      className={styles.cache}
      data-testid="workbench-document-surface-cache"
      data-visible={renderedPresentedSurface ? "true" : undefined}
      data-visible-tab-id={renderedPresentedSurface?.token.tabId || undefined}
      data-visible-source-sha256={renderedPresentedSurface?.token.sourceSha256 || undefined}
      data-visible-handoff-id={renderedPresentedSurface?.token.handoffId || undefined}
      data-candidate-tab-id={candidateHandoffToken?.tabId || undefined}
      data-candidate-handoff-id={candidateHandoffToken?.handoffId || undefined}
      data-mounted-count={handoffSurfaces.length}
      data-cache-entry-count={snapshot.entries.length}
      data-cold-count={snapshot.coldTabIds.length}
      data-cache-bytes={snapshot.totalBytes}
      data-presentation-count={snapshot.presentations.length}
      data-presentation-bytes={snapshot.presentationBytes}
      data-max-cache-entries={snapshot.limits.maxEntries}
      data-max-cache-bytes={snapshot.limits.maxBytes}
      aria-hidden={!renderedPresentedSurface}
    >
      {handoffSurfaces.map(({ entry, token }) => {
        const isPresented = sameDocumentSurfaceHandoffToken(token, visibleHandoffToken);
        const isCandidate = sameDocumentSurfaceHandoffToken(token, candidateHandoffToken);
        const displayReadyToken = isCandidate ? token : null;
        const presentationKey = `${entry.tabId}:${entry.sourceSha256}:${token.handoffId}`;
        return (
          <div
            className={styles.entry}
            data-tab-id={entry.tabId}
            data-source-sha256={entry.sourceSha256}
            data-handoff-id={token.handoffId}
            data-surface-role={isPresented ? "presented" : "candidate"}
            data-scroll-top={entry.scrollTop}
            hidden={!isPresented}
            key={presentationKey}
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

"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import type {
  DocumentSurfaceCacheToken,
  DocumentSurfaceCacheSnapshot,
} from "../application/document-surface-cache-session.js";
import HtmlDisplaySurface from "../components/HtmlDisplaySurface";
import styles from "./workbench-document-surface-cache.module.css";

function cacheTokenKey(token: DocumentSurfaceCacheToken | null): string | null {
  return token ? `${token.tabId}:${token.sourceSha256}` : null;
}

export default function WorkbenchDocumentSurfaceCache({
  snapshot,
  visibleTabId,
  visibleSourceSha256,
  candidateTabId = null,
  candidateSourceSha256 = null,
  onVisibleReady,
  onHandoffComplete,
  onHandoffScroll,
  onFirstScroll,
  height,
}: {
  snapshot: DocumentSurfaceCacheSnapshot;
  visibleTabId: string | null;
  visibleSourceSha256: string | null;
  candidateTabId?: string | null;
  candidateSourceSha256?: string | null;
  onVisibleReady: (token: DocumentSurfaceCacheToken) => boolean;
  onHandoffComplete: (token: DocumentSurfaceCacheToken) => void;
  onHandoffScroll: (token: DocumentSurfaceCacheToken, scrollTop: number) => void;
  onFirstScroll: (tabId: string, scrollTop: number) => void;
  height: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const priorVisibleTokenRef = useRef<DocumentSurfaceCacheToken | null>(null);
  // Keep the last ready projection painted while a newly selected cache entry
  // hydrates. The target remains mounted (but hidden) so its static display
  // can settle without exposing an unready frame.
  const [presentedToken, setPresentedToken] = useState<DocumentSurfaceCacheToken | null>(null);
  const readyTokenKeyRef = useRef<string | null>(null);
  // Source projections are data-only until an exact tab-switch handoff asks
  // for them. Normal inactive and active tabs own no display iframe.
  const isExplicitHandoffSurface = (entry: DocumentSurfaceCacheSnapshot["entries"][number]) => (
    (entry.tabId === candidateTabId && entry.sourceSha256 === candidateSourceSha256)
    || (entry.tabId === visibleTabId && entry.sourceSha256 === visibleSourceSha256)
  );
  const handoffEntries = snapshot.entries.filter(isExplicitHandoffSurface);
  const visibleToken = useMemo(() => (
    visibleTabId && visibleSourceSha256
      ? Object.freeze({ tabId: visibleTabId, sourceSha256: visibleSourceSha256 })
      : null
  ), [visibleSourceSha256, visibleTabId]);
  const candidateToken = useMemo(() => (
    candidateTabId && candidateSourceSha256
      ? Object.freeze({ tabId: candidateTabId, sourceSha256: candidateSourceSha256 })
      : null
  ), [candidateSourceSha256, candidateTabId]);
  const observedToken = candidateToken || visibleToken;
  const observedTokenKey = cacheTokenKey(observedToken);
  const presentedTokenIsRetained = Boolean(
    presentedToken && handoffEntries.some((entry) => (
      entry.tabId === presentedToken.tabId
      && entry.sourceSha256 === presentedToken.sourceSha256
    )),
  );

  useLayoutEffect(() => {
    if (!presentedToken || presentedTokenIsRetained) return;
    readyTokenKeyRef.current = null;
    // A finished handoff must release its complete display document. Returning
    // to the tab mounts a fresh hidden candidate and waits for its own ready.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPresentedToken(null);
  }, [presentedToken, presentedTokenIsRetained]);

  useEffect(() => {
    const prior = priorVisibleTokenRef.current;
    if (prior && cacheTokenKey(prior) !== cacheTokenKey(visibleToken)) {
      performance.mark("stemmio:tab-cache:handoff-complete", {
        detail: Object.freeze(prior),
      });
      onHandoffComplete(prior);
    }
    priorVisibleTokenRef.current = visibleToken;
    if (!observedToken) {
      readyTokenKeyRef.current = null;
      return undefined;
    }
    if (readyTokenKeyRef.current !== observedTokenKey) readyTokenKeyRef.current = null;

    const root = rootRef.current;
    let frame = 0;
    let observer: MutationObserver | null = null;
    let marked = false;
    let scrollableMarked = false;
    const markWhenReady = () => {
      const entry = [...(root?.querySelectorAll<HTMLElement>("[data-tab-id]") || [])]
        .find((candidate) => (
          candidate.dataset.tabId === observedToken.tabId
          && candidate.dataset.sourceSha256 === observedToken.sourceSha256
        ));
      const surface = entry?.querySelector<HTMLElement>("[data-display-ready]");
      if (surface?.dataset.displayReady !== "true") return false;
      // A candidate may still be waiting for the parent to publish its
      // retained id. It is safe to paint it now because this branch only runs
      // after the surface itself reports data-display-ready.
      if (!marked && readyTokenKeyRef.current !== observedTokenKey) {
        if (!onVisibleReady(observedToken)) return false;
        marked = true;
        readyTokenKeyRef.current = observedTokenKey;
        setPresentedToken(observedToken);
        performance.mark("stemmio:tab-cache:visible-ready", {
          detail: Object.freeze(observedToken),
        });
      } else {
        setPresentedToken(observedToken);
      }
      if (!scrollableMarked && surface.dataset.scrollableReady === "true") {
        scrollableMarked = true;
        performance.mark("stemmio:tab-cache:scrollable-ready", {
          detail: Object.freeze(observedToken),
        });
      }
      return scrollableMarked;
    };
    frame = window.requestAnimationFrame(() => {
      if (markWhenReady()) return;
      observer = new MutationObserver(() => {
        if (!markWhenReady()) return;
        observer?.disconnect();
        observer = null;
      });
      if (root) observer.observe(root, { attributes: true, subtree: true });
    });
    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [observedToken, observedTokenKey, onHandoffComplete, onVisibleReady, visibleToken]);

  const renderedPresentedToken = presentedToken
    && visibleToken
    && cacheTokenKey(presentedToken) === cacheTokenKey(visibleToken)
    && handoffEntries.some((entry) => (
      entry.tabId === presentedToken.tabId
      && entry.sourceSha256 === presentedToken.sourceSha256
    ))
    ? presentedToken
    : null;
  return (
    <div
      ref={rootRef}
      className={styles.cache}
      data-testid="workbench-document-surface-cache"
      data-visible={renderedPresentedToken ? "true" : undefined}
      data-visible-tab-id={renderedPresentedToken?.tabId || undefined}
      data-visible-source-sha256={renderedPresentedToken?.sourceSha256 || undefined}
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
      {handoffEntries.map((entry) => (
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
            presentationKey={`${entry.tabId}:${entry.sourceSha256}`}
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
          />
        </div>
      ))}
    </div>
  );
}

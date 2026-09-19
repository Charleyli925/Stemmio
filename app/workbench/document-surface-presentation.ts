import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import type { DocumentSurfaceControllerCapability } from "../application/workspace-controller-capabilities.js";
import type {
  DocumentSurfaceCacheEntry,
  DocumentSurfaceCacheSnapshot,
  DocumentSurfaceCacheToken,
  DocumentSurfacePresentation,
} from "../application/document-surface-cache-session.js";
import {
  clampRuntimeScroll,
  outerScrollLimits,
  outerScrollMetricsReady,
  scheduleWhenReady,
} from "../components/html-canvas-frame.js";
import {
  documentSurfaceCacheEntryMatchesToken,
  documentSurfaceCacheToken,
  sameDocumentSurfaceCacheToken,
} from "../application/document-surface-cache-session.js";
import type { WorkbenchTabsSnapshot } from "../application/workbench-tabs-session.js";
import type { PageViewContext } from "../lib/page-view-context.js";
import type { CanvasMode, HtmlProject } from "./types";
import type { ActiveRun } from "../domain/run-lifecycle.js";
import { sameSourceReceipt } from "../application/document-session.js";
import type { DocumentSourceReceipt } from "../application/document-session.js";
import type { WorkbenchNavigationReceipt } from "../application/workbench-navigation-session.js";

function tokenForEntry(entry: DocumentSurfaceCacheEntry | null): DocumentSurfaceCacheToken | null {
  return documentSurfaceCacheToken(entry);
}

function entryForToken(
  cache: DocumentSurfaceCacheSnapshot,
  token: DocumentSurfaceCacheToken | null,
): DocumentSurfaceCacheEntry | null {
  if (!token) return null;
  return cache.entries.find((entry) => (
    documentSurfaceCacheEntryMatchesToken(entry, token)
  )) || null;
}

export function useDocumentSurfaceHandoff({
  cache,
  tabs,
  sourceSha256,
  renderedSourceSha256,
  canvasAuthority,
  canvasGeneration,
  sourceReceipt,
  navigationReceipt,
  controller,
}: {
  cache: DocumentSurfaceCacheSnapshot;
  tabs: WorkbenchTabsSnapshot;
  sourceSha256: string | null;
  renderedSourceSha256: string | null;
  canvasAuthority: Readonly<{
    status?: string;
    generation?: number;
    renderedSha256?: string | null;
  }> | null;
  canvasGeneration: number;
  sourceReceipt: DocumentSourceReceipt | null;
  navigationReceipt: WorkbenchNavigationReceipt | null;
  controller: DocumentSurfaceControllerCapability | null;
}): {
  visibleCachedSurface: DocumentSurfaceCacheEntry | null;
  candidateCachedSurface: DocumentSurfaceCacheEntry | null;
  visibleCachedSurfaceReady: boolean;
  retainPresentedTab: (token: DocumentSurfaceCacheToken) => boolean;
  completeHandoff: (token: DocumentSurfaceCacheToken) => void;
  updateHandoffScroll: (token: DocumentSurfaceCacheToken, scrollTop: number) => void;
  markFirstScroll: (tabId: string, scrollTop: number) => void;
} {
  const pending = cache.entries.find((entry) => (
    entry.tabId === tabs.pendingTabId
  )) || null;
  const pendingToken = tokenForEntry(pending);
  const [presentedToken, setPresentedToken] = useState<DocumentSurfaceCacheToken | null>(null);
  const [retainedCandidateToken, setCandidateToken] = useState<DocumentSurfaceCacheToken | null>(null);
  const eligibleCandidateRef = useRef<DocumentSurfaceCacheToken | null>(null);
  const pendingTabId = pendingToken?.tabId || null;
  const pendingSourceSha256 = pendingToken?.sourceSha256 || null;
  const presentedEntryIsCached = Boolean(
    presentedToken && entryForToken(cache, presentedToken),
  );
  useLayoutEffect(() => {
    if (!presentedToken || presentedEntryIsCached) return;
    // An evicted projection must not become visible again merely because the
    // same tab later receives different source bytes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPresentedToken(null);
  }, [presentedEntryIsCached, presentedToken]);
  useEffect(() => {
    if (!pendingTabId || !pendingSourceSha256) return;
    // The pending tab can commit before the static candidate reports ready;
    // retain its exact token across that commit without creating another
    // navigation/state owner.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCandidateToken((current) => (
      current?.tabId === pendingTabId && current.sourceSha256 === pendingSourceSha256
        ? current
        : documentSurfaceCacheToken({ tabId: pendingTabId, sourceSha256: pendingSourceSha256 })
    ));
  }, [pendingSourceSha256, pendingTabId]);
  const active = tabs.tabs.find((tab) => tab.tabId === tabs.activeTabId);
  const exactReceiptApplies = Boolean(
    retainedCandidateToken
    && navigationReceipt?.kind === "document"
    && navigationReceipt.tabId === retainedCandidateToken.tabId
    && navigationReceipt.sourceReceipt,
  );
  const receiptVerified = Boolean(
    exactReceiptApplies
    && sourceReceipt
    && sameSourceReceipt(sourceReceipt, navigationReceipt?.sourceReceipt),
  );
  const canvasVerified = Boolean(
    canvasAuthority?.status === "verified"
    && canvasAuthority.generation === canvasGeneration
    && canvasAuthority.renderedSha256 === sourceSha256
  );
  const terminal = Boolean(
    (exactReceiptApplies
      ? receiptVerified && canvasVerified
      : (sourceSha256 && renderedSourceSha256 === sourceSha256) || canvasVerified)
    || canvasAuthority?.status === "failed",
  );
  useEffect(() => {
    if (!terminal || !retainedCandidateToken) return;
    // Tab-switch cover ends at the first verified Canvas for that tab.
    // A later same-document Runtime refresh must not reuse this token.
    if (tabs.activeTabId !== retainedCandidateToken.tabId) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCandidateToken(null);
  }, [retainedCandidateToken, tabs.activeTabId, terminal]);
  const retainPresentedTab = useCallback((token: DocumentSurfaceCacheToken) => {
    if (!sameDocumentSurfaceCacheToken(eligibleCandidateRef.current, token)) return false;
    const entry = controller?.getSnapshot().documentSurfaceCache?.entries
      .find((candidate) => documentSurfaceCacheEntryMatchesToken(candidate, token));
    if (!entry) return false;
    const exactToken = tokenForEntry(entry);
    if (!exactToken) return false;
    setPresentedToken((current) => sameDocumentSurfaceCacheToken(current, exactToken) ? current : exactToken);
    return true;
  }, [controller]);
  const completeHandoff = useCallback((token: DocumentSurfaceCacheToken) => {
    setPresentedToken((current) => sameDocumentSurfaceCacheToken(current, token) ? null : current);
  }, []);
  const updateHandoffScroll = useCallback((token: DocumentSurfaceCacheToken, scrollTop: number) => {
    controller?.updateDocumentSurfacePresentationForToken(token, { scrollTop });
  }, [controller]);
  const markFirstScroll = useCallback((tabId: string, scrollTop: number) => {
    performance.mark("stemmio:tab-cache:first-scroll-response", {
      detail: Object.freeze({ tabId, scrollTop }),
    });
  }, []);
  const retainedCandidateIsActive = Boolean(
    retainedCandidateToken
    && active?.kind === "document"
    && active.tabId === retainedCandidateToken.tabId
    && sourceSha256 === retainedCandidateToken.sourceSha256,
  );
  // Cache overlay is tab-switch presentation only: the pending destination,
  // or that destination retained until its first verified Canvas. Same-document
  // Runtime refresh stays inside the mounted HtmlCanvasEditor A/B slots.
  const candidateToken = pendingToken
    || (retainedCandidateIsActive && !terminal ? retainedCandidateToken : null);
  useLayoutEffect(() => {
    // Publish eligibility before the child surface's passive ready effect can
    // report. This keeps late callbacks fenced without mutating a ref during
    // render.
    eligibleCandidateRef.current = candidateToken;
  }, [candidateToken]);
  const candidateCachedSurface = entryForToken(cache, candidateToken);
  const presentedCachedSurface = entryForToken(cache, presentedToken);
  // During a tab switch, keep the last ready projection over the new live
  // Canvas until the destination reports its own display-ready token.
  const visibleCachedSurface = presentedCachedSurface && candidateCachedSurface
    ? presentedCachedSurface
    : null;
  return {
    visibleCachedSurface,
    candidateCachedSurface,
    visibleCachedSurfaceReady: Boolean(visibleCachedSurface),
    retainPresentedTab,
    completeHandoff,
    updateHandoffScroll,
    markFirstScroll,
  };
}

export function readyVersionPublicationMatches(
  controller: DocumentSurfaceControllerCapability,
  run: ActiveRun,
): boolean {
  const snapshot = controller.getSnapshot();
  return Boolean(
    snapshot.projectSession?.projectId === run.projectId
    && snapshot.projectSession?.documentId === run.documentId
    && snapshot.versionSession?.currentExactVersionId === run.candidateVersionId,
  );
}

export function rememberActiveDocumentPresentation({
  controller,
  tabs,
  canvasMode,
  pageViewContext,
  scrollTop,
}: {
  controller: DocumentSurfaceControllerCapability;
  tabs: WorkbenchTabsSnapshot;
  canvasMode: CanvasMode;
  pageViewContext: PageViewContext | null;
  scrollTop: number;
}) {
  const active = tabs.tabs.find((tab) => tab.tabId === tabs.activeTabId);
  if (active?.kind !== "document") return null;
  return controller.updateDocumentSurfacePresentation(active.tabId, {
    canvasMode,
    pageViewContext,
    scrollTop,
  });
}

export function restoreCachedDocumentPresentation({
  controller,
  tabId,
  project,
  setPageViewContext,
  stage,
}: {
  controller: DocumentSurfaceControllerCapability;
  tabId: string;
  project: HtmlProject;
  setPageViewContext: (value: PageViewContext | null) => void;
  stage: HTMLDivElement | null;
}): DocumentSurfacePresentation | null {
  const cached = controller.getSnapshot().documentSurfaceCache?.presentations.find((entry) => (
    entry.tabId === tabId
    && entry.projectId === project.projectId
    && entry.documentId === project.documentId
    && entry.sourceSha256 === project.sha256
  )) || null;
  setPageViewContext(cached?.pageViewContext as PageViewContext | null);
  if (!stage) return cached;
  if (!cached || cached.canvasMode !== "edit") {
    stage.scrollTo({ top: 0, left: 0, behavior: "auto" });
    return cached;
  }
  let userInterrupted = false;
  const stopForUser = () => {
    userInterrupted = true;
    cleanup();
  };
  const cleanup = () => {
    window.clearTimeout(cleanupTimer);
    stage.removeEventListener("wheel", stopForUser);
    stage.removeEventListener("touchstart", stopForUser);
    stage.removeEventListener("pointerdown", stopForUser);
    stage.removeEventListener("keydown", stopForUser);
  };
  stage.addEventListener("wheel", stopForUser, { passive: true, once: true });
  stage.addEventListener("touchstart", stopForUser, { passive: true, once: true });
  stage.addEventListener("pointerdown", stopForUser, { passive: true, once: true });
  stage.addEventListener("keydown", stopForUser, { once: true });
  const cleanupTimer = window.setTimeout(cleanup, 2_000);
  const exactActivationStillCurrent = () => {
    if (userInterrupted) return false;
    const snapshot = controller.getSnapshot();
    const activeTab = snapshot.workbenchTabs?.tabs.find((candidate) => (
      candidate.tabId === snapshot.workbenchTabs?.activeTabId
    ));
    const currentSourceSha256 = snapshot.document?.workingHtmlSha256
      || snapshot.document?.persistedSourceSha256;
    return Boolean(
      (activeTab?.tabId === tabId || snapshot.workbenchTabs?.pendingTabId === tabId)
      && snapshot.projectSession?.projectId === project.projectId
      && snapshot.projectSession?.documentId === project.documentId
      && currentSourceSha256 === project.sha256,
    );
  };
  const activationIsActive = () => (
    controller.getSnapshot().workbenchTabs?.activeTabId === tabId
  );
  scheduleWhenReady({
    isCurrent: exactActivationStillCurrent,
    isReady: () => (
      activationIsActive()
      && outerScrollMetricsReady(stage, cached.scrollTop)
    ),
    onReady: () => {
      cleanup();
      if (!exactActivationStillCurrent() || !activationIsActive()) return;
      const limits = outerScrollLimits(stage);
      stage.scrollTo({
        top: clampRuntimeScroll(cached.scrollTop, limits.maxTop),
        left: stage.scrollLeft,
        behavior: "auto",
      });
    },
  });
  return cached;
}

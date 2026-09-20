import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import type { DocumentSurfaceControllerCapability } from "../application/workspace-controller-capabilities.js";
import type { DocumentCanvasAuthority } from "../application/document-session.js";
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
import type { HtmlDisplaySurfaceReadyToken } from "../components/HtmlDisplaySurface";

export type DocumentSurfaceHandoffToken = HtmlDisplaySurfaceReadyToken;

export function sameDocumentSurfaceHandoffToken(
  left: DocumentSurfaceHandoffToken | null | undefined,
  right: DocumentSurfaceHandoffToken | null | undefined,
): boolean {
  return Boolean(
    left
    && right
    && left.handoffId === right.handoffId
    && sameDocumentSurfaceCacheToken(left, right),
  );
}

function documentSurfaceHandoffToken(
  token: DocumentSurfaceCacheToken | null,
  handoffId: string | null,
): DocumentSurfaceHandoffToken | null {
  if (!token || !handoffId) return null;
  return Object.freeze({ ...token, handoffId });
}

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
  canvasAuthority,
  canvasGeneration,
  sourceReceipt,
  navigationReceipt,
  navigationTransactionId,
  controller,
}: {
  cache: DocumentSurfaceCacheSnapshot;
  tabs: WorkbenchTabsSnapshot;
  sourceSha256: string | null;
  canvasAuthority: DocumentCanvasAuthority | null;
  canvasGeneration: number;
  sourceReceipt: DocumentSourceReceipt | null;
  navigationReceipt: WorkbenchNavigationReceipt | null;
  navigationTransactionId: string | null;
  controller: DocumentSurfaceControllerCapability | null;
}): {
  visibleCachedSurface: DocumentSurfaceCacheEntry | null;
  /** Exact physical static surface currently accepted for display. */
  visibleHandoffId: string | null;
  candidateCachedSurface: DocumentSurfaceCacheEntry | null;
  candidateHandoffId: string | null;
  visibleCachedSurfaceReady: boolean;
  acceptDisplayReady: (token: DocumentSurfaceHandoffToken) => boolean;
  updateHandoffScroll: (token: DocumentSurfaceCacheToken, scrollTop: number) => void;
  markFirstScroll: (tabId: string, scrollTop: number) => void;
} {
  const pending = cache.entries.find((entry) => (
    entry.tabId === tabs.pendingTabId
  )) || null;
  const pendingTabId = pending?.tabId || null;
  const pendingSourceSha256 = pending?.sourceSha256 || null;
  const pendingHandoffToken = useMemo(() => (
    documentSurfaceHandoffToken(
      pendingTabId && pendingSourceSha256
        ? documentSurfaceCacheToken({ tabId: pendingTabId, sourceSha256: pendingSourceSha256 })
        : null,
      navigationTransactionId || `pending:${tabs.revision}`,
    )
  ), [navigationTransactionId, pendingSourceSha256, pendingTabId, tabs.revision]);
  // Cache identity chooses the immutable source data. This distinct, complete
  // token chooses the disposable iframe that the owner already accepted. Do
  // not collapse it to tabId + Hash: a later same-Hash navigation needs a
  // separate hidden iframe while the earlier accepted one remains visible.
  const [presentedHandoffToken, setPresentedHandoffToken] = useState<DocumentSurfaceHandoffToken | null>(null);
  const [retainedCandidateHandoffToken, setCandidateToken] = useState<DocumentSurfaceHandoffToken | null>(null);
  const eligibleCandidateRef = useRef<DocumentSurfaceHandoffToken | null>(null);
  const presentedEntryIsCached = Boolean(
    presentedHandoffToken && entryForToken(cache, presentedHandoffToken),
  );
  useLayoutEffect(() => {
    if (!presentedHandoffToken || presentedEntryIsCached) return;
    // An evicted projection must not become visible again merely because the
    // same tab later receives different source bytes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPresentedHandoffToken(null);
  }, [presentedEntryIsCached, presentedHandoffToken]);
  useLayoutEffect(() => {
    if (!pendingHandoffToken) return;
    // The pending tab can commit before the static candidate reports ready;
    // retain its exact per-navigation token across that commit without
    // creating another navigation/state owner. The transaction id (or the
    // pending snapshot revision during bootstrap) fences a repeat visit to
    // identical bytes from an older disposable iframe.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCandidateToken((current) => (
      sameDocumentSurfaceHandoffToken(current, pendingHandoffToken)
        ? current
        : pendingHandoffToken
    ));
  }, [pendingHandoffToken]);
  const active = tabs.tabs.find((tab) => tab.tabId === tabs.activeTabId);
  const terminalHandoffToken = pendingHandoffToken || retainedCandidateHandoffToken;
  const exactReceiptApplies = Boolean(
    terminalHandoffToken
    && navigationReceipt?.kind === "document"
    && navigationReceipt.tabId === terminalHandoffToken.tabId
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
  // A cached handoff is never terminal merely because the currently mounted
  // Canvas happens to be verified. During B -> C, that Canvas may still be B
  // (and a same-Hash return makes the hash insufficient too). When the
  // navigation path published an exact receipt, only that receipt plus its
  // current Canvas generation retires the retained cover. Some already-open
  // tab paths publish a document receipt without a SourceReceipt; their
  // current Canvas authority is still receipt-fenced by DocumentSession and
  // must be allowed to retire the cover rather than leave it intercepting the
  // editor indefinitely.
  const canvasFailed = Boolean(
    canvasAuthority?.status === "failed"
    && canvasAuthority.generation === canvasGeneration,
  );
  const terminal = exactReceiptApplies
    ? receiptVerified && (canvasVerified || canvasFailed)
    : canvasVerified || canvasFailed;
  const retainedCandidateIsActive = Boolean(
    retainedCandidateHandoffToken
    && active?.kind === "document"
    && active.tabId === retainedCandidateHandoffToken.tabId
    && sourceSha256 === retainedCandidateHandoffToken.sourceSha256,
  );
  // Cache overlay is tab-switch presentation only: the pending destination,
  // or that destination retained until its first verified Canvas. Same-document
  // Runtime refresh stays inside the mounted HtmlCanvasEditor A/B slots.
  const candidateHandoffToken = pendingHandoffToken
    || (retainedCandidateIsActive && !terminal ? retainedCandidateHandoffToken : null);
  const candidateToken = useMemo(() => (
    candidateHandoffToken
      ? documentSurfaceCacheToken(candidateHandoffToken)
      : null
  ), [candidateHandoffToken]);
  useEffect(() => {
    if (!terminal || !retainedCandidateHandoffToken) return;
    // Tab-switch cover ends at the first verified Canvas for that tab.
    // A later same-document Runtime refresh must not reuse this token.
    if (tabs.activeTabId !== retainedCandidateHandoffToken.tabId) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCandidateToken((current) => (
      sameDocumentSurfaceHandoffToken(current, retainedCandidateHandoffToken) ? null : current
    ));
  }, [retainedCandidateHandoffToken, tabs.activeTabId, terminal]);
  useEffect(() => {
    if (candidateHandoffToken || retainedCandidateHandoffToken) return;
    // The same handoff owner releases its accepted presentation when no exact
    // candidate remains. The cache component only renders that owner state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPresentedHandoffToken((current) => current ? null : current);
  }, [candidateHandoffToken, retainedCandidateHandoffToken]);
  const acceptDisplayReady = useCallback((token: DocumentSurfaceHandoffToken) => {
    if (!sameDocumentSurfaceHandoffToken(eligibleCandidateRef.current, token)) return false;
    const entry = controller?.getSnapshot().documentSurfaceCache?.entries
      .find((candidate) => documentSurfaceCacheEntryMatchesToken(candidate, token));
    if (!entry) return false;
    const exactToken = documentSurfaceHandoffToken(tokenForEntry(entry), token.handoffId);
    if (!exactToken) return false;
    setPresentedHandoffToken((current) => (
      sameDocumentSurfaceHandoffToken(current, exactToken) ? current : exactToken
    ));
    return true;
  }, [controller]);
  const updateHandoffScroll = useCallback((token: DocumentSurfaceCacheToken, scrollTop: number) => {
    controller?.updateDocumentSurfacePresentationForToken(token, { scrollTop });
  }, [controller]);
  const markFirstScroll = useCallback((tabId: string, scrollTop: number) => {
    performance.mark("stemmio:tab-cache:first-scroll-response", {
      detail: Object.freeze({ tabId, scrollTop }),
    });
  }, []);
  useLayoutEffect(() => {
    // Publish eligibility before the child surface's passive ready effect can
    // report. This keeps late callbacks fenced without mutating a ref during
    // render.
    eligibleCandidateRef.current = candidateHandoffToken;
  }, [candidateHandoffToken]);
  const candidateCachedSurface = entryForToken(cache, candidateToken);
  const presentedCachedSurface = entryForToken(cache, presentedHandoffToken);
  // During a tab switch, keep the last ready projection over the new live
  // Canvas until the destination reports its own display-ready token.
  const visibleCachedSurface = presentedCachedSurface && candidateCachedSurface
    ? presentedCachedSurface
    : null;
  return {
    visibleCachedSurface,
    visibleHandoffId: visibleCachedSurface ? presentedHandoffToken?.handoffId || null : null,
    candidateCachedSurface,
    candidateHandoffId: candidateHandoffToken?.handoffId || null,
    visibleCachedSurfaceReady: Boolean(visibleCachedSurface),
    acceptDisplayReady,
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

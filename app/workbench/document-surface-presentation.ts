import type { DocumentSurfaceControllerCapability } from "../application/workspace-controller-capabilities.js";
import {
  clampRuntimeScroll,
  outerScrollLimits,
  outerScrollMetricsReady,
  scheduleWhenReady,
} from "../components/html-canvas-frame.js";
import type { DocumentSurfacePresentation } from "../application/document-surface-cache-session.js";
import type { WorkbenchTabsSnapshot } from "../application/workbench-tabs-session.js";
import type { PageViewContext } from "../lib/page-view-context.js";
import type { CanvasMode, HtmlProject } from "./types";
import type { ActiveRun } from "../domain/run-lifecycle.js";

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

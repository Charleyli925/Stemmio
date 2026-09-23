import type { WorkbenchTab } from "../application/workbench-tabs-session.js";
import type { CanvasMode } from "./types";

function actionAvailability(
  enabled: boolean,
  reason: string | undefined,
  target: "current" | "history" | "visible",
) {
  return Object.freeze({ enabled, reason: enabled ? undefined : reason, target });
}

type PresentationInput = {
  project: { projectId: string | null; documentId: string | null; sourcePath: string | null };
  version: {
    versions: readonly { id: string; label: string; displayFileName?: string }[];
    currentBasedOnVersionId: string | null; latestVersionId: string | null;
    viewingVersionId: string | null; viewMode: string;
  };
  activeTab: WorkbenchTab | null;
  runtimeOwnerTabId?: string | null;
  canvasMode: CanvasMode;
  reviewActive: boolean;
  activeRunStatus?: string;
  hasReadyPayload: boolean;
  hasReadyReviewSession: boolean;
  reviewPreparing: boolean;
  canShowCurrentFileInFolder: boolean;
  canOpenSelectedHtmlInDefaultBrowser: boolean;
  persistState: string;
  editRevision: number;
  lastPersistedRevision: number;
  hasWorkspaceController: boolean;
  previewContentReady: boolean;
  projectHydrating: boolean;
  projectLoadError: boolean;
  viewTransitioning: boolean;
  runInProgress: boolean;
  workspaceIssue: boolean;
  externalSourcePreview: boolean;
  hasDocumentHistoryAction: boolean;
  interactionLocked: boolean;
};

export function deriveWorkbenchPresentation(input: PresentationInput) {
  const { project, version, activeTab, runInProgress } = input;
  const sameDocument = Boolean(project.projectId && project.documentId
    && (activeTab?.kind === "document" || activeTab?.kind === "history")
    && activeTab.projectId === project.projectId && activeTab.documentId === project.documentId);
  // A source-less document has no registered Project identity. Its existing
  // navigation runtime owner still binds the visible in-memory source to a tab.
  const sameUnsavedDocument = !project.sourcePath && !project.projectId && !project.documentId
    && activeTab?.kind === "document" && activeTab.tabId === input.runtimeOwnerTabId;
  const hasDocumentTarget = sameDocument || sameUnsavedDocument;
  const reviewActive = activeTab?.kind === "document" && sameDocument && input.reviewActive;
  const isHistory = activeTab?.kind === "history" && sameDocument && version.viewMode === "history";
  const displayedVersionId = sameDocument
    ? isHistory ? version.viewingVersionId : version.currentBasedOnVersionId
    : null;
  const displayedVersion = version.versions.find((row) => row.id === displayedVersionId) || null;
  const reviewAvailable = Boolean(sameDocument && input.activeRunStatus === "ready-to-open"
    && input.hasReadyPayload && !input.hasReadyReviewSession && !input.reviewPreparing);
  const editReason = isHistory ? "历史版本以预览模式打开；如要继续编辑，请在更多菜单中创建新版本"
    : reviewActive ? "完成审阅后可继续编辑"
    : runInProgress ? "本轮还在进行，结束或采纳后可回到编辑"
      : input.viewTransitioning || input.projectHydrating || input.projectLoadError ? "当前版本暂时不可操作"
        : !hasDocumentTarget ? "请先打开当前文档" : undefined;
  const previewReason = !hasDocumentTarget ? "请先打开当前文档" : reviewActive ? "完成审阅后可继续预览"
    : !input.previewContentReady ? "当前文档内容尚未就绪" : undefined;
  const reviewReason = !sameDocument ? "请先打开当前文档" : reviewActive ? "正在审阅 AI 修改"
    : input.reviewPreparing ? "正在准备审阅…"
      : !reviewAvailable ? "有待审阅修改时自动可用" : undefined;
  const fileReady = hasDocumentTarget && input.hasWorkspaceController && !input.projectHydrating
    && !input.projectLoadError && !input.viewTransitioning;
  const canReloadCurrentSource = Boolean(sameDocument && project.sourcePath && version.viewMode === "current"
    && input.persistState === "idle" && input.editRevision === input.lastPersistedRevision
    && !runInProgress && !input.projectHydrating && !input.projectLoadError
    && !input.workspaceIssue && !input.externalSourcePreview && !input.viewTransitioning
    && !input.hasDocumentHistoryAction);
  const switching = input.projectHydrating || input.viewTransitioning;
  const currentActionReason = isHistory ? "该操作只针对当前稿"
    : !hasDocumentTarget ? "请先打开当前稿"
      : runInProgress ? "请先完成当前 AI 任务或候选处理"
        : reviewActive ? "请先采用或不用这次 AI 修改"
          : switching ? "页面正在切换，完成后可以继续"
            : input.projectLoadError || input.workspaceIssue ? "当前稿尚未恢复到可操作状态"
              : input.hasDocumentHistoryAction ? "版本操作完成后可以继续"
                : undefined;
  const canSaveCurrentVersion = !currentActionReason;
  const createHistoryReason = !isHistory ? "请先打开一个历史版本"
    : runInProgress ? "请先完成当前 AI 任务或候选处理"
      : switching ? "页面正在切换，完成后可以基于此版本继续编辑"
        : input.projectLoadError || input.workspaceIssue ? "历史版本尚未恢复到可操作状态"
          : input.hasDocumentHistoryAction ? "上一次版本操作完成后可以继续"
            : undefined;
  const showInFolderReason = isHistory ? "历史版本没有独立工作文件；请打开当前稿"
    : switching ? "页面正在切换，完成后可以在 Finder 中显示"
      : !sameDocument || !project.sourcePath ? "当前页面没有可在 Finder 中显示的工作文件"
        : !input.canShowCurrentFileInFolder ? "当前系统暂时无法在 Finder 中显示工作文件"
          : undefined;
  const openInBrowserReason = switching ? "页面正在切换，完成后可以在浏览器中打开"
    : input.projectLoadError ? "当前页面加载失败，恢复后可以在浏览器中打开"
      : !sameDocument || !project.sourcePath || !input.hasWorkspaceController
        ? "当前页面没有可在浏览器中打开的 HTML 文件"
        : !input.canOpenSelectedHtmlInDefaultBrowser ? "当前系统暂时无法打开 HTML 文件"
          : undefined;
  const exportReason = !hasDocumentTarget || !input.hasWorkspaceController
    ? "当前页面还没有可导出的 HTML"
    : switching ? "页面正在切换，完成后可以导出"
      : input.projectLoadError ? "当前页面加载失败，恢复后可以导出"
        : undefined;
  const preservedDraftsReason = isHistory ? "请先打开当前稿，再找回以前保留的稿件"
    : !hasDocumentTarget ? "请先打开当前稿"
      : runInProgress ? "请先完成当前 AI 任务或候选处理"
        : switching ? "页面正在切换，完成后可以找回稿件"
          : input.projectLoadError || input.workspaceIssue ? "当前稿恢复后可以找回稿件"
            : input.hasDocumentHistoryAction ? "版本操作完成后可以找回稿件"
              : undefined;
  const reloadReason = isHistory ? "历史版本不会从磁盘重载；请打开当前稿"
    : reviewActive ? "请先采用或不用这次 AI 修改，再从磁盘重新载入"
      : runInProgress ? "请先完成当前 AI 任务或候选处理"
        : switching ? "页面正在切换，完成后可以从磁盘重新载入"
          : input.persistState !== "idle" || input.editRevision !== input.lastPersistedRevision
            ? "当前修改保存完成后可以从磁盘重新载入"
            : input.projectLoadError || input.workspaceIssue ? "当前稿尚未恢复到可重载状态"
              : input.externalSourcePreview ? "请先完成当前外部文件处理"
                : input.hasDocumentHistoryAction ? "版本操作完成后可以从磁盘重新载入"
                  : !sameDocument || !project.sourcePath ? "当前页面没有可重新载入的工作文件"
                    : undefined;
  return {
    projectId: sameDocument ? project.projectId : null,
    documentId: sameDocument ? project.documentId : null,
    displayedVersion,
    displayedVersionId: displayedVersion?.id || null,
    selectedVersionId: displayedVersion?.id || null,
    currentEditingVersionId: sameDocument ? version.currentBasedOnVersionId : null,
    latestVersionId: sameDocument ? version.latestVersionId : null,
    tabId: activeTab?.tabId || null,
    tabTitle: activeTab?.title || "",
    viewLabel: !hasDocumentTarget ? null : reviewActive ? "审阅" : isHistory ? "历史" : "当前",
    isHistory,
    mode: reviewActive ? "review" : isHistory ? "preview" : input.canvasMode,
    edit: { enabled: !editReason, selected: !isHistory && !reviewActive && input.canvasMode === "edit", reason: editReason },
    preview: { enabled: hasDocumentTarget && !reviewActive && input.previewContentReady, selected: isHistory || (!reviewActive && input.canvasMode === "preview"), reason: previewReason },
    review: { enabled: !reviewActive && !input.reviewPreparing && reviewAvailable, selected: reviewActive, reason: reviewReason },
    reviewAvailable,
    canShowInFinder: !isHistory && sameDocument && input.canShowCurrentFileInFolder,
    canOpenSelectedHtml: Boolean(
      fileReady
      && sameDocument
      && project.sourcePath
      && input.canOpenSelectedHtmlInDefaultBrowser,
    ),
    canExportCurrentHtml: fileReady,
    canReloadCurrentSource,
    actions: Object.freeze({
      saveVersion: actionAvailability(canSaveCurrentVersion, currentActionReason, "current"),
      createFromHistory: actionAvailability(!createHistoryReason, createHistoryReason, "history"),
      showInFolder: actionAvailability(!showInFolderReason, showInFolderReason, "current"),
      openInBrowser: actionAvailability(!openInBrowserReason, openInBrowserReason, isHistory ? "history" : "current"),
      exportHtml: actionAvailability(!exportReason && fileReady, exportReason, isHistory ? "history" : "visible"),
      exportAndSave: actionAvailability(
        !exportReason && fileReady && canSaveCurrentVersion,
        exportReason || currentActionReason,
        "current",
      ),
      preservedDrafts: actionAvailability(!preservedDraftsReason, preservedDraftsReason, "current"),
      reloadSource: actionAvailability(canReloadCurrentSource, reloadReason, "current"),
    }),
    refreshAvailable: Boolean(hasDocumentTarget && (input.canvasMode === "preview" || reviewActive)
      && !input.projectHydrating && !input.projectLoadError && !input.viewTransitioning),
  };
}

export type WorkbenchPresentation = ReturnType<typeof deriveWorkbenchPresentation>;

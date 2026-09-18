"use client";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ClipboardEvent,
  type CSSProperties,
} from "react";
import { ClockCounterClockwiseIcon } from "@phosphor-icons/react/dist/csr/ClockCounterClockwise";
import { EyeIcon } from "@phosphor-icons/react/dist/csr/Eye";
import AttachmentLightbox from "./components/AttachmentLightbox";
import EditRuntimeStaticFallbackNotice from "./components/EditRuntimeStaticFallbackNotice";
import HtmlCanvasEditor from "./components/HtmlCanvasEditor";
import type {
  HtmlCanvasEditRuntimeLoadOutcome,
  HtmlCanvasCommentLayoutTarget,
  HtmlCanvasEditorHandle,
  HtmlCanvasMutation,
  HtmlCanvasSelection,
  HtmlCanvasRuntimeVisualHint,
  HtmlCanvasRuntimeDegradation,
  HtmlCanvasSourceTransaction,
  NativeDeferredCommandAuthority,
  NativeDeferredCommandDiscardReason,
} from "./components/HtmlCanvasEditor";
import type { DesktopEditRuntimeApi } from "./components/desktop-edit-runtime-api";
import type { DesktopUiPreferencesApi } from "./components/desktop-ui-preferences-api";
import AboutStemmioDialog from "./components/AboutStemmioDialog";
import SettingsPage from "./components/SettingsPage";
import { AgentDeliveryButton, type AgentDeliveryMode } from "./components/AgentDeliveryButton";
import HistoryCreationDialog from "./components/HistoryCreationDialog";
import PreservedDraftDialog from "./components/PreservedDraftDialog";
import { CurrentDraftStatus } from "./workbench/current-draft-status";
import CancelAiRunDialog from "./components/CancelAiRunDialog";
import HtmlInteractionPreview, {
  type HtmlInteractionPreviewHandle,
} from "./components/HtmlInteractionPreview";
import { useAiConversation } from "./workbench/use-ai-conversation";
import NoticeBar from "./components/NoticeBar";
import {
  MAX_ATTACHMENT_BYTES,
  MAX_COMMENT_ATTACHMENTS,
  planAttachmentSelection,
} from "./lib/attachment-selection.js";
import {
  commentMarkerGroupKey,
} from "./lib/comment-virtualization.js";
import {
  auditEventKey,
  removeAcknowledgedAuditEvents,
} from "./lib/audit-events";
import { appendDirectEditEvent } from "./lib/direct-edit-events.js";
import { productErrorMessage } from "./lib/notification-policy";
import { workspaceUnavailableFromCode } from "./lib/workspace-safety-state.js";
import {
  globalInterruptionPresentation,
  type GlobalInterruption,
} from "./lib/global-interruption.js";
import {
  DEFAULT_PROJECT_HTML,
  WELCOME_PROJECT_NAME,
} from "./lib/sample-html";
import {
  canCloseDuringHydration,
  shouldRecoverEditorAfterCloseAbort,
} from "../desktop/close-recovery.mjs";
import {
  createRuntimeWorkspaceController,
  registrationContextFromOutcome,
} from "./application/workspace-controller.js";
import type {
  WorkspaceController,
  WorkspaceShellCommentSnapshot,
} from "./application/workspace-controller.js";
import type {
  NavigationControllerCapability,
  RunControllerCapability,
} from "./application/workspace-controller-capabilities.js";
import { createCommentWorkflowCodecs } from "./application/comment-workflow-codecs.js";
import type {
  DocumentWorkflowOutcome,
  ExternalSourceObservationReceipt,
} from "./application/document-workflow.js";
import { createDocumentWorkflowCodecs } from "./application/document-workflow-codecs.js";
import { createRunWorkflowCodecs } from "./application/run-workflow-codecs.js";
import {
  INITIAL_QODER_AVAILABILITY,
} from "./domain/qoder-availability.js";
import { agentProviderCardsFromCatalog } from "./application/agent-provider-catalog.js";
import {
  DEFAULT_OPENAI_COMPATIBLE_REASONING,
  openAiCompatibleVendorDisplayNameForPublicModel,
} from "../shared/openai-compatible-vendors.mjs";
import { createWorkspaceControllerCodecs } from "./application/workspace-controller-codecs.js";
import { createDesktopRecoveryJournalPort } from "./workbench/desktop-recovery-journal-port";
import type { CommentSessionSnapshot } from "./application/comment-session.js";
import {
  sameSourceReceipt,
} from "./application/document-session.js";
import type {
  DocumentCanvasRenderObservation,
  DocumentSessionSnapshot,
  DocumentSourceReceipt,
} from "./application/document-session.js";
import { runLocalUserAction } from "./application/local-action-outcomes.js";
import {
  ReviewAnalysisCancelledError,
  ReviewAnalysisSession,
} from "./application/review-analysis-session.js";
import type { PageViewContext } from "./lib/page-view-context.js";
import type { ProjectSessionSnapshot } from "./application/project-session.js";
import type { RunSessionSnapshot } from "./application/run-session.js";
import type { VersionSessionSnapshot } from "./application/version-session.js";
import {
  INITIAL_WORKBENCH_TABS_SNAPSHOT,
  type WorkbenchTabsSnapshot,
} from "./application/workbench-tabs-session.js";
import {
  INITIAL_DOCUMENT_SURFACE_CACHE_SNAPSHOT,
} from "./application/document-surface-cache-session.js";
import type { SourceHistoryDirection } from "./domain/source-history.js";
import type { AgentSelection } from "./domain/agent-provider-state.js";
import {
  EDIT_AUTHOR_RUNTIME_BUDGET,
  EDIT_AUTHOR_RUNTIME_VERIFICATION_DEADLINE_MS,
} from "./domain/edit-runtime-contract.js";
import { assertDesktopHost } from "./application/desktop-host.js";
import {
  captureUsageEvent,
  countBucket,
  editPropertyGroup,
  noticeUsageCode,
  usageFingerprint,
} from "./application/usage-telemetry";
import {
  reportInternalFailure,
  setInternalFailureTelemetry,
} from "./application/internal-failure.js";
setInternalFailureTelemetry((record) => {
  captureUsageEvent("internal_failure", {
    area: record.area,
    operation: record.operation,
    code: record.code,
    recovered: record.recovered,
  });
});
import {
  activeRunFromRecord,
  canonicalLifecycleState,
  isLockedLifecycleState,
  type ActiveRun,
  type LifecycleState,
} from "./domain/run-lifecycle.js";
import {
  browserSha256,
  copyText,
  downloadHtml,
  fileAsBase64,
  isImageFile,
} from "./workbench/browser-io";
import {
  attachmentFromRecord,
  canLocateTarget,
  canSaveCommentTarget,
  commentVisualHintForSelection,
  commentVisualTarget,
  commentEditSessionHasChanges,
  commentHasContent,
  commentsFromRecords,
  formatFileSize,
  globalPageCommentTargetFromHtml,
  independentCommentTarget,
  insertionLabel,
  normalizeGlobalCommentTargets,
  persistedAttachment,
  persistedChangeEvent,
  persistedComment,
  persistedTargetRef,
  rebindTargetsAcrossHistoryPreservingGlobal,
  rebindTargetsPreservingGlobal,
  recordId,
  selectionFromRecord,
  uniqueTargets,
} from "./workbench/comment-model";
import {
  unsafeRelinkComments,
} from "./workbench/comment-relink-model.js";
import {
  CommentRailContainer,
  type CommentRailCapability,
} from "./workbench/comment-rail-container";
import { createCommentCanvasPort } from "./workbench/comment-canvas-port";
import {
  type CommentRailContainerContext,
  type CommentRailHostActions,
} from "./workbench/comment-rail-contract";
import {
  WorkbenchHeaderView,
} from "./workbench/file-header-view";
import {
  WorkbenchGlobalSidebarContainer,
  WorkbenchSettingsSidebar,
  WorkbenchStartPageContainer,
  type ProjectCatalogCapability,
} from "./workbench/workbench-sidebar-container";
import type { SettingsCategory } from "./workbench/settings-types";
import {
  type WorkspacePreferences,
} from "./application/workspace-preferences-session.js";
import { useWorkspacePreferences } from "./workbench/use-workspace-preferences";
import {
  PreviewNavigationBanner,
} from "./workbench/presentation";
import { deriveWorkbenchInspector } from "./workbench/inspector-presentation.js";
import { RunConversationOutlet } from "./workbench/run-conversation-outlet";
import { WorkbenchReviewOverlay } from "./workbench/workbench-review-overlay";
import WorkbenchActiveDocumentCanvas from "./workbench/WorkbenchActiveDocumentCanvas";
import WorkbenchDocumentSurfaceCache from "./workbench/WorkbenchDocumentSurfaceCache";
import ProjectRulesEditorPage from "./workbench/project-rules-editor";
import { useEditRuntimePreparation } from "./workbench/use-edit-runtime-preparation";
import {
  prepareReviewAnalysis,
  reviewSourceFactsByteSize,
  type ReviewSourceFacts,
} from "./workbench/review-analysis";
import {
  rememberActiveDocumentPresentation,
  readyVersionPublicationMatches,
  restoreCachedDocumentPresentation,
  useDocumentSurfaceHandoff,
} from "./workbench/document-surface-presentation";
import { markProjectApplied, markProjectHydrationStage, RendererStartupPerformance } from "./workbench/performance-timeline";
import {
  type ReviewDocuments,
} from "./workbench/review-document";
import type { ReviewPresentationSnapshot } from "./workbench/review-state";
import { useRuntimeBridgeConnectionReady } from "./workbench/runtime-bridge-connection";
import { WorkbenchTabBarContainer } from "./workbench/workbench-navigation-container";
import { WorkbenchResizer } from "./workbench/workbench-resizer";
import { createWorkbenchModeHandlers } from "./workbench/workbench-mode-handlers";
import { deriveWorkbenchPresentation } from "./workbench/workbench-header-projection";
import {
  activeRunOperationKey,
  fileStem,
  localFileNameFromSourcePath,
  safeVersionLabel,
  sameLocalSourcePath,
} from "./workbench/project-model";
import {
  authoritativeDraftRevision,
  draftAuthorityFromWorkspace,
  historyTextSelectionFromRecord,
  isRecord,
  ownsNativeTextHistory,
  recoveryIdentityFromRecord,
  sourceHistoryOperationsFromRecord,
} from "./workbench/record-model";
import {
  changesFromDraftRecords,
  versionsFromWorkspace,
} from "./workbench/version-model";
import { projectVersionSummariesFromVersions, projectVersionSummariesFromWorkspace } from "./workbench/project-version-tree-model";
import {
  isVendorApiKeyPageOpened,
  type ApplicationUpdateResult,
  type CanvasMode,
  type CloseAbortedDetail,
  type CloseReadiness,
  type CommentAttachment,
  type CommentEditSession,
  type CommentItem,
  type DirectEditEvent,
  type HtmlProject,
  type PersistState,
  type PrepareCloseDetail,
  type ProjectContext,
  type RegisteredProject,
  type ProjectVersionSummary,
  type StartupIssue,
  type Version,
  type WorkspaceIssue,
} from "./workbench/types";
const PROJECT_REPOSITORY_URL = "https://github.com/Charleyli925/Stemmio";
const LATEST_RELEASE_PAGE_URL =
  "https://github.com/Charleyli925/Stemmio/releases/latest";
class DeferredEditorCommandDiscardedError extends Error {
  readonly reason: NativeDeferredCommandDiscardReason;

  constructor(reason: NativeDeferredCommandDiscardReason) {
    super(`Deferred editor command discarded: ${reason}`);
    this.name = "DeferredEditorCommandDiscardedError";
    this.reason = reason;
  }
}

type CanvasRenderAck = Readonly<{
  generation: number;
  sha256: string;
}>;

type CanvasRenderAcks = Readonly<Record<CanvasMode, CanvasRenderAck | null>>;

const INITIAL_RUN_SNAPSHOT: RunSessionSnapshot = {
  activeSourcePath: null,
  activeRun: null,
  activeHandoff: null,
  activeHandoffMayBeRunning: false,
  activeHandoffManaged: false,
  activeSubmission: null,
  submissionPending: false,
  activeLocked: false,
  operationKeys: [],
  recentOutcome: null,
  backgroundResults: [],
};
const INITIAL_EXTERNAL_FILE_OPEN_SNAPSHOT = {
  status: "idle" as const,
  activeRequestId: null,
  queuedRequestId: null,
  queuedRequestIds: [],
  deferredRequestId: null,
  deferredSequence: 0,
  confirmation: null,
  attention: null,
};
const INITIAL_PROJECT_APPLICATION_SNAPSHOT = {
  status: "idle",
  activeApplicationId: null,
  queuedApplicationId: null,
  deferredApplicationId: null,
  deferredSequence: 0,
};
const INITIAL_PROJECT_SESSION_SNAPSHOT: ProjectSessionSnapshot = {
  epoch: 0,
  sourcePath: null,
  projectId: "",
  documentId: "",
  registered: false,
};
const INITIAL_VERSION_SNAPSHOT: VersionSessionSnapshot<Version> = {
  versions: [],
  latestVersionId: null,
  currentBasedOnVersionId: null,
  currentExactVersionId: null,
  restoredFromVersionId: null,
  viewMode: "current",
  viewingVersionId: null,
  historyPreview: null,
};
const INITIAL_DOCUMENT_SNAPSHOT: DocumentSessionSnapshot = {
  html: DEFAULT_PROJECT_HTML,
  persistedSourceSha256: null,
  workingHtmlSha256: null,
  canvasGeneration: 0,
  sourceReceipt: null,
  canvasAuthority: {
    status: "idle",
    generation: 0,
    renderedSha256: null,
    error: null,
  },
  editRevision: 0,
  lastPersistedRevision: 0,
  persistState: "idle",
  persistError: "",
  hasPendingWrite: false,
  isFlushing: false,
};
const EDIT_RUNTIME_PENDING_PHASES = new Set([
  "preparing",
  "ready",
  "running",
]);
const INITIAL_COMMENT_SNAPSHOT: CommentSessionSnapshot<
  CommentItem,
  DirectEditEvent,
  CommentAttachment,
  HtmlCanvasSelection,
  CommentEditSession
> = {
  comments: [],
  changeEvents: [],
  deletedCommentIds: [],
  composerDraft: "",
  composerCommentId: null,
  composerAttachments: [],
  composerTarget: null,
  editSession: null,
};

type ReadyReviewSession = {
  tabId: string;
  presentation: ReviewPresentationSnapshot | null;
  operationKey: string;
  sessionId: string;
  documents: ReviewDocuments;
  beforeHtml: string;
  sourceContentEqual: boolean;
  sourcePath: string;
  beforeLabel: string;
  afterLabel: string;
};

const WELCOME_PROJECT = {
  name: WELCOME_PROJECT_NAME,
  sourcePath: null as string | null,
};

function currentProjectNameFromFile(
  sourcePath: string | null,
  projectName: string,
): string {
  const fileName = localFileNameFromSourcePath(sourcePath) || projectName;
  return fileStem(fileName).replace(/-V\d+$/u, "") || "当前项目";
}

function requiredWorkspaceController(
  controller: WorkspaceController | null,
): WorkspaceController {
  if (!controller) {
    throw new Error("项目资料初始化尚未就绪，请稍后重试。");
  }
  return controller;
}

type DocumentEditOutcome = DocumentWorkflowOutcome<{
  revision: number;
  queued: boolean;
  receipt: DocumentSourceReceipt | null;
}>;

function documentEditFailureReason(outcome: DocumentEditOutcome): string {
  if (outcome.status === "succeeded") return "";
  if (outcome.status === "stale") {
    return "当前项目已经切换，当前修改没有被接受。";
  }
  return outcome.reason;
}

const emptyShellSnapshot = () => null;
const subscribeEmptyShell = () => () => {};

export default function Workbench() {
  const [globalSidebarOpen, setGlobalSidebarOpen] = useState(false);
  const desktopUiPreferencesApi: DesktopUiPreferencesApi | undefined = (
    typeof window !== "undefined" ? window.stemmioUiPreferences : undefined
  );
  const editorRef = useRef<HtmlCanvasEditorHandle>(null);
  const interactionPreviewRef = useRef<HtmlInteractionPreviewHandle>(null);
  const previewToEditPendingRef = useRef(false);
  const pageViewDocumentKeyRef = useRef("");
  const deferredEditorReplayRef = useRef<{
    exportCurrentHtml?: (saveVersion?: boolean) => void;
    reloadCurrentSource?: () => void;
    reloadReview?: () => void;
    requestReviewDecision?: (action: "return" | "accept") => void;
    requestUserFlush?: () => void;
    requestSourceHistoryAction?: (
      direction: SourceHistoryDirection,
    ) => Promise<boolean>;
    generateRequest?: () => void;
    agentDeliveryMode: AgentDeliveryMode;
  }>({ agentDeliveryMode: "clipboard" });
  const deferEditorCommand = useCallback((
    kind: string,
    run: () => void,
    payload?: unknown,
    options?: {
      authority?: NativeDeferredCommandAuthority;
      onDiscard?: (reason: NativeDeferredCommandDiscardReason) => void;
    },
  ) => Boolean(editorRef.current?.deferNativeCommand(
    kind,
    run,
    payload,
    options,
  )), []);
  const fenceAndFreezeCurrentCanvas = useCallback((missingReason: string) => {
    const editor = editorRef.current;
    if (!editor) {
      return { ok: false as const, reason: missingReason };
    }
    // freezeNow owns the complete source-authority fence: it checkpoints the source
    // transaction, retires Chromium's editing host, and only then locks input.
    const frozen = editor.freezeNow();
    if (!frozen.ok) {
      return {
        ok: false as const,
        reason: frozen.reason || "当前文字尚未安全收口。",
      };
    }
    if (editor.getSourceHtml() !== frozen.html) {
      return {
        ok: false as const,
        reason: "编辑画布的冻结快照与源码引擎不一致。",
      };
    }
    return { ...frozen, ok: true as const, html: frozen.html };
  }, []);
  const fenceAndFreezeCurrentCanvasRef = useRef(fenceAndFreezeCurrentCanvas);
  const [commentCanvasPort] = useState(createCommentCanvasPort);
  const reviewStageRef = useRef<HTMLDivElement>(null);
  const commentCounter = useRef(1);
  const commentEditResumePendingRef = useRef<string | null>(null);
  const pagePresentationScrollRequestRef = useRef(0);
  const [reviewAnalysisSession] = useState(
    () => new ReviewAnalysisSession<ReviewSourceFacts>({
      estimateSize: reviewSourceFactsByteSize,
    }),
  );
  const reviewSessionSequenceRef = useRef(0);
  const reviewSessionsRef = useRef(new Map<string, ReadyReviewSession>());
  const [desktopHostReady, setDesktopHostReady] = useState(false);
  const [desktopHostIssue, setDesktopHostIssue] = useState<string | null>(null);
  const workspaceControllerRef = useRef<WorkspaceController | null>(null);
  const verifyCanvasRenderedRef = useRef<(
    expectedHtml: string,
    expectedSha256: string,
    context?: ProjectContext,
    receipt?: DocumentSourceReceipt | null,
    previousFrameGeneration?: number | null,
    previousFrameDocument?: Document | null,
    explicitRebuild?: boolean,
  ) => Promise<DocumentCanvasRenderObservation>>(async () => {
    throw new Error("画布核对尚未完成初始化。");
  });
  const sourceTransitioningRef = useRef(false);
  const renameTransitioningRef = useRef(false);
  const versionTransitioningRef = useRef(false);
  const attachmentObjectUrlsRef = useRef<Map<string, string>>(new Map());
  const interruptionRef = useRef<GlobalInterruption | null>(null);
  const previousPersistStateRef = useRef(new Map<string, PersistState>());
  const previousRunStateRef = useRef(
    new Map<string, LifecycleState | "none">(),
  );
  const interruptionPresenceRef = useRef(new Map<string, boolean>());
  const normalizeCurrentGlobalCommentsRef = useRef<() => CommentItem[]>(() => []);
  const automaticProjectRegistrationRef = useRef("");
  const projectRegistrationPreparationRef = useRef("");
  const pendingSidebarHistoryRef = useRef<ProjectVersionSummary | null>(null);
  const pendingSidebarHistoryAttemptRef = useRef<ProjectVersionSummary | null>(null);
  const pendingPresentationCaptureRef = useRef<string | null>(null);
  useEffect(() => () => {
    pendingSidebarHistoryRef.current = null;
    pendingSidebarHistoryAttemptRef.current = null;
  }, []);
  const overlayReturnFocusRef = useRef<HTMLElement | null>(null);

  const [workspaceController, setWorkspaceController] =
    useState<WorkspaceController | null>(null);
  const shellSnapshot = useSyncExternalStore(
    workspaceController?.shell.subscribe ?? subscribeEmptyShell,
    workspaceController?.shell.getSnapshot ?? emptyShellSnapshot,
    emptyShellSnapshot,
  );
  // The shell snapshot is the reactive workspace-controller projection used by
  // the workbench; keep a named alias for version/status surfaces that consume
  // the controller snapshot shape.
  const workspaceControllerSnapshot = shellSnapshot;
  const runCapability = workspaceController
    ? workspaceController.runs as RunControllerCapability
    : null;
  const navigationCapability = workspaceController
    ? workspaceController.navigation as NavigationControllerCapability
    : null;
  const workbenchTabsSnapshot = shellSnapshot?.workbenchTabs
    ?? INITIAL_WORKBENCH_TABS_SNAPSHOT;
  const activeWorkbenchTab = workbenchTabsSnapshot.tabs.find(
    (tab) => tab.tabId === workbenchTabsSnapshot.activeTabId,
  ) || workbenchTabsSnapshot.tabs[0];
  const settingsPageActive = activeWorkbenchTab?.kind === "settings";
  const startPageActive = activeWorkbenchTab?.kind === "start"
    && desktopHostReady
    && !desktopHostIssue;
  const projectRulesPageActive = activeWorkbenchTab?.kind === "project-rules";
  const documentRuntimeTabId = activeWorkbenchTab?.kind === "document"
    ? activeWorkbenchTab.tabId
    : workbenchTabsSnapshot.runtimeOwnerTabId;
  const documentSurfaceCacheSnapshot = shellSnapshot?.documentSurfaceCache
    ?? INITIAL_DOCUMENT_SURFACE_CACHE_SNAPSHOT;
  const [importedCanvasBase, setImportedCanvasBase] = useState<{
    managedSourcePath: string;
    externalSourcePath: string;
  } | null>(null);
  const currentControllerSnapshot = useCallback(
    () => workspaceControllerRef.current?.getSnapshot() ?? null,
    [],
  );
  const currentProjectSessionSnapshot = useCallback(
    () => currentControllerSnapshot()?.projectSession
      ?? INITIAL_PROJECT_SESSION_SNAPSHOT,
    [currentControllerSnapshot],
  );
  const currentDocumentSessionSnapshot = useCallback(
    () => currentControllerSnapshot()?.document ?? INITIAL_DOCUMENT_SNAPSHOT,
    [currentControllerSnapshot],
  );
  const currentCommentSessionSnapshot = useCallback(
    () => (
      currentControllerSnapshot()?.commentSession as CommentSessionSnapshot<
        CommentItem,
        DirectEditEvent,
        CommentAttachment,
        HtmlCanvasSelection,
        CommentEditSession
      > | null
    ) ?? INITIAL_COMMENT_SNAPSHOT,
    [currentControllerSnapshot],
  );
  const currentRunSessionSnapshot = useCallback(
    () => currentControllerSnapshot()?.runSession ?? INITIAL_RUN_SNAPSHOT,
    [currentControllerSnapshot],
  );
  const documentSnapshot = shellSnapshot?.document
    ?? INITIAL_DOCUMENT_SNAPSHOT;
  const externalFileOpenSnapshot =
    shellSnapshot?.project?.externalOpen
    ?? INITIAL_EXTERNAL_FILE_OPEN_SNAPSHOT;
  const openConfirmation =
    shellSnapshot?.project?.openConfirmation || null;
  useEffect(() => {
    if (!workspaceController || !openConfirmation || openConfirmation.busy
      || openConfirmation.deleteOriginal !== true) return;
    if (confirmedOriginalDeletionRef.current === openConfirmation.requestId) return;
    confirmedOriginalDeletionRef.current = openConfirmation.requestId;
    if (!window.confirm("成功导入后会将原文件移至废纸篓。确定继续吗？")) {
      void workspaceController.cancelExternalOpen({ requestId: openConfirmation.requestId });
      return;
    }
    void workspaceController.confirmExternalOpen({
      requestId: openConfirmation.requestId,
      action: openConfirmation.classification === "new-external"
        ? "import-new"
        : "continue-current",
      deleteOriginal: openConfirmation.deleteOriginal === true,
    });
  }, [openConfirmation, workspaceController]);
  const projectApplicationSnapshot =
    shellSnapshot?.project?.projectApplication
    ?? INITIAL_PROJECT_APPLICATION_SNAPSHOT;
  const html = documentSnapshot.html;
  const sourceReceipt = documentSnapshot.sourceReceipt;
  const sourceSha256 = documentSnapshot.persistedSourceSha256;
  const canvasGeneration = documentSnapshot.canvasGeneration;
  const editRevision = documentSnapshot.editRevision;
  const lastPersistedRevision = documentSnapshot.lastPersistedRevision;
  const persistState = documentSnapshot.persistState;
  const persistError = documentSnapshot.persistError;
  const [projectName, setProjectName] = useState(WELCOME_PROJECT.name);
  const projectSnapshot = shellSnapshot?.projectSession
    ?? INITIAL_PROJECT_SESSION_SNAPSHOT;
  const { sourcePath, projectId, documentId } = projectSnapshot;
  const activeDocumentPresentation = documentSurfaceCacheSnapshot.presentations.find((entry) => (
    activeWorkbenchTab?.kind === "document"
    && entry.tabId === activeWorkbenchTab.tabId
    && entry.projectId === projectId
    && entry.documentId === documentId
    && entry.sourceSha256 === (
      documentSnapshot.workingHtmlSha256 || documentSnapshot.persistedSourceSha256
    )
  )) || null;
  // The first durable import changes the ProjectSession source from the
  // caller-owned HTML to V1's managed Working Copy without replacing the live
  // DocumentSession canvas. Keep the selected external HTML as the preview
  // base for that imported Working Copy during this session, so authored
  // relative resources remain preview-only rather than being copied into or
  // managed by the v4 Project. A subsequent navigation uses its own source.
  const canvasSourcePath = (
    importedCanvasBase
    && sameLocalSourcePath(sourcePath, importedCanvasBase.managedSourcePath)
  )
    ? importedCanvasBase.externalSourcePath
    : sourcePath || undefined;
  const commentSnapshot = shellSnapshot?.commentSession as WorkspaceShellCommentSnapshot<
    CommentItem, DirectEditEvent, CommentAttachment, HtmlCanvasSelection
  > | null;
  const draftTarget = commentSnapshot?.composerTarget ?? null;
  const draftCommentId = commentSnapshot?.composerCommentId ?? null;
  const draftAttachments = commentSnapshot?.composerAttachments ?? INITIAL_COMMENT_SNAPSHOT.composerAttachments;
  const comments = commentSnapshot?.comments ?? INITIAL_COMMENT_SNAPSHOT.comments;
  const changeEvents = commentSnapshot?.changeEvents ?? INITIAL_COMMENT_SNAPSHOT.changeEvents;
  const commentEditSession = commentSnapshot?.editSession ?? null;
  const [attachmentObjectUrls, setAttachmentObjectUrls] = useState<Record<string, string>>({});
  const attachmentUploadCount = shellSnapshot?.comment?.attachmentUploadCount ?? 0;
  const draftPersistError = shellSnapshot?.comment?.draftError ?? "";
  const runSnapshot = shellSnapshot?.runSession
    ?? INITIAL_RUN_SNAPSHOT;
  const agentCatalogSnapshot = shellSnapshot?.run?.agentCatalog ?? null;
  const catalogDisplaySelection = agentCatalogSnapshot?.displaySelection
    ?? agentCatalogSnapshot?.selected
    ?? null;
  const frozenAgentSelection = runSnapshot.activeRun?.agentDelivery?.selection
    ?? catalogDisplaySelection
    ?? null;
  const frozenProvider = frozenAgentSelection
    ? agentCatalogSnapshot?.providers?.[frozenAgentSelection.providerId]
    : null;
  const agentPresentation = frozenProvider?.presentation ?? {
    displayName: frozenAgentSelection?.providerId || "Agent",
    agentName: frozenAgentSelection?.providerId || "Agent",
    logoSrc: null,
    settingsSupported: false,
    localReadDisclosure: undefined,
    restartLabel: `重新启动 ${frozenAgentSelection?.providerId || "Agent"}`,
    restartSupported: false,
    stopLabel: `停止 ${frozenAgentSelection?.providerId || "Agent"} 并继续编辑`,
    frozenPreviewDetail: `这是本轮冻结并交给 ${frozenAgentSelection?.providerId || "Agent"} 的只读内容`,
  };
  const sidebarAgentPresentation = {
    providerId: frozenAgentSelection?.providerId || "agent",
    displayName: agentPresentation.displayName || frozenAgentSelection?.providerId || "Agent",
    agentName: agentPresentation.agentName || agentPresentation.displayName
      || frozenAgentSelection?.providerId || "Agent",
    logoSrc: typeof agentPresentation.logoSrc === "string" ? agentPresentation.logoSrc : null,
  };
  const agentDisplayName = agentPresentation.agentName
    || agentPresentation.displayName
    || frozenAgentSelection?.providerId
    || null;
  const executionDisplayName = frozenProvider?.connection?.vendorDisplayName
    || openAiCompatibleVendorDisplayNameForPublicModel(
      frozenAgentSelection?.resolvedModelId || frozenAgentSelection?.requestedModelId,
    )
    || agentDisplayName;
  const agentModels = Array.isArray(frozenProvider?.models)
    ? frozenProvider.models.map((model) => ({
      id: String(model.id),
      displayName: String(model.displayName || model.id),
      reasoningChoices: Array.isArray(model.reasoningChoices)
        ? model.reasoningChoices.map((choice: { id?: unknown; label?: unknown }) => ({
          id: String(choice.id),
          label: String(choice.label || choice.id),
        }))
        : [],
    }))
    : [];
  const selectedModelId = frozenAgentSelection?.requestedModelId
    || frozenAgentSelection?.resolvedModelId
    || agentModels.find((model) => model.id)?.id
    || null;
  const selectedAgentModel = agentModels.find((model) => model.id === selectedModelId)
    || agentModels.find((model) => model.id)
    || null;
  const reasoningChoices = selectedAgentModel?.reasoningChoices || [];
  const selectedReasoningId = frozenAgentSelection?.reasoning?.requested
    || (reasoningChoices.length ? DEFAULT_OPENAI_COMPATIBLE_REASONING : null);
  const agentProviderChoices = Object.values(agentCatalogSnapshot?.providers ?? {}).map(
    (provider) => ({
      id: `${provider.providerId}:${provider.runtimeId}`,
      label: provider.presentation.agentName || provider.presentation.displayName,
      logoSrc: provider.presentation.logoSrc,
      selection: provider.selection,
    }),
  );
  const qoderAvailability = shellSnapshot?.run?.qoderAvailability
    ?? INITIAL_QODER_AVAILABILITY;
  const agentCards = agentProviderCardsFromCatalog(agentCatalogSnapshot);
  const workspacePreferencesController = useWorkspacePreferences(
    desktopUiPreferencesApi,
    { workspaceController, agentCatalogSnapshot, documentId: documentId ?? "" },
  );
  const workspacePreferencesSessionPort = workspacePreferencesController.sessionPort;
  const workspacePreferencesSnapshot = workspacePreferencesController.snapshot;
  const workspacePreferences = workspacePreferencesSnapshot.workspace;
  const [previewAttachment, setPreviewAttachment] = useState<CommentAttachment | null>(null);
  const [preservedDraftDialogOpen, setPreservedDraftDialogOpen] = useState(false);
  const loadPreservedDrafts = useCallback(() => workspaceController!.loadPreservedDrafts(), [workspaceController]);
  const [historyCreationConfirmation, setHistoryCreationConfirmation] = useState<string | null>(null);
  const historyCreation = shellSnapshot?.version?.creation;
  const [handoffPreviewOpen, setHandoffPreviewOpen] = useState(false);
  const [projectRegistrationError, setProjectRegistrationError] = useState("");
  const versionSnapshot = (
    shellSnapshot?.versionSession as VersionSessionSnapshot<Version> | null
  ) ?? INITIAL_VERSION_SNAPSHOT;
  const versions = versionSnapshot.versions;
  const latestVersionId = versionSnapshot.latestVersionId;
  const currentBasedOnVersionId =
    versionSnapshot.currentBasedOnVersionId;
  const viewMode = versionSnapshot.viewMode;
  const [canvasMode, setCanvasMode] = useState<CanvasMode>("edit");
  const aiSourceFileName = localFileNameFromSourcePath(sourcePath) || projectName;
  // The AI conversation sidebar. All of its React state lives in this hook, so
  // the Workbench gains one hook call and no extra budget.
  // Declared before the conversation hook because the sidebar stays docked
  // through review: useAiConversation reads this to keep the thread alive.
  const [readyReviewSession, setReadyReviewSession] =
    useState<ReadyReviewSession | null>(null);
  const presentedReadyReviewSession = activeWorkbenchTab?.kind === "document"
    && readyReviewSession?.tabId === activeWorkbenchTab.tabId
    ? readyReviewSession
    : null;

  // The decision bar acts through a ref: its handlers are defined further down,
  // and the conversation hook is composed before them.

  const generateRequestRef = useRef<
    ((mode: AgentDeliveryMode) => void) | null
  >(null);
  const resumeCommentEditRef = useRef<(commentId?: string) => void>(() => {});
  const openAgentSettingsRef = useRef<(() => void) | null>(null);
  const openAgentSettings = useCallback(() => {
    openAgentSettingsRef.current?.();
  }, []);
  const aiConversation = useAiConversation({
    controllerRef: workspaceControllerRef,
    draftReadOnly: ["preparing", "ready"].includes(shellSnapshot?.project?.close.phase || ""),
    qoderAvailability,
    agentDisplayName,
    executionDisplayName,
    agentActionName: agentPresentation.agentName || agentPresentation.displayName,
    agentSettingsName: agentPresentation.displayName || agentPresentation.agentName,
    agentSettingsSupported: agentPresentation.settingsSupported !== false,
    credentialKind: frozenProvider?.presentation?.credentialKind === "api-token"
      ? "api-token"
      : null,
    agentPresentation: sidebarAgentPresentation,
    models: selectedAgentModel
      ? [selectedAgentModel]
      : agentModels,
    selectedModelId,
    reasoningChoices: [],
    selectedReasoningId,
    // The header's mode comes from Request authority, not from a local guess.
    // Review is the same workbench with a different Canvas: the thread stays
    // docked and read-only instead of disappearing and coming back.
    reviewing: Boolean(presentedReadyReviewSession),
    commentComposerOpen: commentCanvasPort.getSnapshot().composerOpen,
    canvasMode,
    documentPresented: activeWorkbenchTab?.kind === "document",
    projectId: projectId ?? "",
    documentId: documentId ?? "",
    sourcePath: sourcePath ?? "",
    sourceFileName: aiSourceFileName,
    pendingCommentCount: comments.length,
    /*
     * The same submission the header button performs. One owner, two surfaces.
     * Reached through a ref because generateRequest is declared far below this call.
     * Naming it directly here left React Compiler with a call to a function it had not
     * yet analysed, so it had to assume that call could mutate anything — and that
     * assumption cost every state setter in this component its stability, skipping
     * optimisation for the whole component.
     */
    onDeliverModification: (mode) => generateRequestRef.current?.(mode),
    onOpenAgentSettings: openAgentSettings,
  });
  const revealAiConversation = aiConversation.reveal;
  const editRuntimeSnapshot = shellSnapshot?.editRuntime ?? null;
  const {
    runtimePhase: editRuntimePhase,
    runtimeRenderPending: editRuntimeRenderPending,
    runtimeGrant: editRuntimeGrant,
  } = useEditRuntimePreparation({
    canvasMode,
    editRuntimeSnapshot,
    startPreparation: (input) => (
      workspaceControllerRef.current?.startEditAuthorRuntimePreparation(input)
    ),
  });
  const runtimeDegradationKey = `${sourcePath || "no-source"}:${canvasGeneration}`;
  const [runtimeDegradationSnapshot, setRuntimeDegradationSnapshot] = useState<{
    key: string;
    state: HtmlCanvasRuntimeDegradation;
  }>({ key: runtimeDegradationKey, state: "none" });
  const runtimeDegradation = runtimeDegradationSnapshot.key === runtimeDegradationKey
    ? runtimeDegradationSnapshot.state
    : "none";
  const runtimeNoticeState: HtmlCanvasRuntimeDegradation | "direct-static-visible" = (
    editRuntimePhase === "static-fallback" && runtimeDegradation === "none"
  ) ? "direct-static-visible" : runtimeDegradation;
  const staticFallbackNoticeIdentity = (
    editRuntimePhase === "static-fallback"
    || runtimeNoticeState === "runtime-partial"
  )
    ? [
        editRuntimeSnapshot?.sourcePath || sourcePath || "no-source",
        editRuntimeSnapshot?.canvasGeneration ?? canvasGeneration,
        editRuntimeSnapshot?.lastOutcome || "unknown",
        runtimeNoticeState,
      ].join(":")
    : null;
  const [pageViewContext, setPageViewContext] =
    useState<PageViewContext | null>(null);
  const viewingVersionId = versionSnapshot.viewingVersionId;
  const [canvasRenderAcks, setCanvasRenderAcks] = useState<CanvasRenderAcks>({
    edit: null,
    preview: null,
  });
  const [sourceTransitioning, setSourceTransitioning] = useState(false);
  const setSourceViewTransitioning = useCallback((transitioning: boolean) => {
    sourceTransitioningRef.current = transitioning;
    setSourceTransitioning(transitioning);
  }, []);
  const isViewTransitioning = useCallback(() => (
    sourceTransitioningRef.current
    || versionTransitioningRef.current
    || renameTransitioningRef.current
  ), []);
  const versionTransitioning = (shellSnapshot?.version?.navigation.phase || "idle") !== "idle";
  const renameTransitioning =
    shellSnapshot?.project?.rename?.phase === "renaming";
  const viewTransitioning = sourceTransitioning || versionTransitioning || renameTransitioning;
  const bridgeConnectionReady = useRuntimeBridgeConnectionReady();
  useEffect(() => {
    renameTransitioningRef.current = renameTransitioning;
  }, [renameTransitioning]);
  const invalidateCanvasRenderAcks = useCallback(() => {
    setCanvasRenderAcks({ edit: null, preview: null });
  }, []);
  useLayoutEffect(() => {
    if (!bridgeConnectionReady || !desktopHostReady || desktopHostIssue) {
      return undefined;
    }
    const editRuntimeApi: DesktopEditRuntimeApi | undefined = window.stemmioEditRuntime;
    const uiPreferencesApi: DesktopUiPreferencesApi | undefined = window.stemmioUiPreferences;
    const controller = createRuntimeWorkspaceController({
      initial: {
        documentHtml: DEFAULT_PROJECT_HTML,
        runSourcePath: WELCOME_PROJECT.sourcePath,
        documentSurfaceCacheMaxEntries:
          window.stemmioRuntime?.diagnostics?.e2eDocumentSurfaceCacheMaxEntries
          ?? undefined,
      },
      draftSession: {
        encodeComment: persistedComment,
        encodeChangeEvent: persistedChangeEvent,
      },
      codecs: createWorkspaceControllerCodecs({
        isRecord,
        sameSourcePath: sameLocalSourcePath,
        draftAuthorityFromWorkspace,
        authoritativeDraftRevision,
        recoveryIdentityFromRecord,
        versionsFromWorkspace,
        commentsFromRecords,
        changesFromDraftRecords,
        projectVersionSummariesFromVersions,
        projectVersionSummariesFromWorkspace,
        rebindTargetsPreservingGlobal,
      }),
      ports: {
        agentCredential: {
          persist: (payload) => {
            const operation = window.stemmioIntegrations?.persistSessionCredential;
            if (!operation) return Promise.reject(Object.assign(new Error("Credential persistence is unavailable."), { code: "AGENT_CREDENTIAL_STORE_UNAVAILABLE" }));
            return operation({
              operationId: payload.operationId,
              apiKey: payload.apiKey,
              ...(payload.vendorId ? { vendorId: payload.vendorId } : {}),
              ...(payload.baseUrl ? { baseUrl: payload.baseUrl } : {}),
              ...(payload.modelId ? { modelId: payload.modelId } : {}),
            });
          },
          clear: (payload) => {
            const operation = window.stemmioIntegrations?.clearSessionCredential;
            if (!operation) return Promise.reject(Object.assign(new Error("Credential clearing is unavailable."), { code: "AGENT_CREDENTIAL_STORE_UNAVAILABLE" }));
            return operation(payload);
          },
          status: (payload) => {
            const operation = window.stemmioIntegrations?.sessionCredentialStatus;
            if (!operation) return Promise.reject(Object.assign(new Error("Credential status is unavailable."), { code: "AGENT_CREDENTIAL_STORE_UNAVAILABLE" }));
            return operation(payload);
          },
          restore: () => {
            const operation = window.stemmioIntegrations?.restoreSessionCredential;
            if (!operation) return Promise.reject(Object.assign(new Error("Credential restore is unavailable."), { code: "AGENT_CREDENTIAL_STORE_UNAVAILABLE" }));
            return operation();
          },
        },
        agentPreferences: {
          getAgentConfigurations: async () => (
            (await workspacePreferencesSessionPort.load()).workspace.agentConfigurations
          ),
          saveAgentConfigurations: async (agentConfigurations, intent = null) => (
            intent
              ? workspacePreferencesSessionPort.commitAgentConfigurations({
                intentId: intent.intentId,
                agentConfigurations,
                isCurrent: intent.isCurrent,
              })
              : workspacePreferencesSessionPort.update({ agentConfigurations })
          ),
          commitDefaultAgent: async ({ providerId, isCurrent }) => (
            workspacePreferencesSessionPort.commitDefaultAgent({
              providerId: providerId as WorkspacePreferences["defaultAgentProviderId"],
              isCurrent,
            })
          ),
          setProviderDisabled: async ({ intentId, providerId, disabled, isCurrent }) => (
            workspacePreferencesSessionPort.setProviderDisabled({
              intentId,
              providerId: providerId as WorkspacePreferences["defaultAgentProviderId"],
              disabled,
              isCurrent,
            })
          ),
        },
        hash: { sha256: browserSha256 },
        canvas: { invalidateRenderAcks: invalidateCanvasRenderAcks },
        ...(window.stemmioWorkbenchTabs ? {
          workbenchTabs: {
            get: () => window.stemmioWorkbenchTabs!.get(),
            set: (value: Readonly<Record<string, unknown>>) => (
              window.stemmioWorkbenchTabs!.set(value)
            ),
          },
        } : {}),
        ...(window.stemmioAppLifecycle?.onExternalOpenRequested ? {
          navigation: {
            subscribeExternalOpen: (listener: (request: {
              requestId: string;
              sourcePath?: string;
            }) => void) => window.stemmioAppLifecycle!.onExternalOpenRequested(listener),
            readInitialExternalOpen: () => (
              window.stemmioAppLifecycle!.getInitialExternalOpen?.()
              ?? Promise.resolve(null)
            ),
          },
        } : {}),
        projectSource: {
          activateManagedWorkingCopy: async (input: {
            previousSourcePath: string;
            nextSourcePath: string;
            expectedSha256: string;
            projectId: string;
            documentId: string;
            workingCopyId: string;
            versionId: string;
            projectRootPath: string;
            operationId?: string;
          }) => {
            const activate = window.stemmioProjects?.activateManagedWorkingCopy;
            if (!activate) {
              throw new Error("当前运行环境不能安全切换到托管工作文件。");
            }
            return activate(input);
          },
        },
        ...(editRuntimeApi ? {
          editRuntime: {
            prepare: (request) => editRuntimeApi.prepare(request),
            revoke: (sessionId) => editRuntimeApi.revoke(sessionId),
          },
        } : {}),
        ...(uiPreferencesApi ? {
          uiPreferences: {
            get: () => uiPreferencesApi.get(),
            record: (input) => uiPreferencesApi.record(input),
          },
        } : {}),
      },
      documentWorkflow: {
        recoveryJournal: createDesktopRecoveryJournalPort(window.stemmioProjects),
        codecs: createDocumentWorkflowCodecs({
          isRecord,
          sameSourcePath: sameLocalSourcePath,
          persistedChangeEvent,
          recoveryIdentityFromRecord,
          sourceHistoryOperationsFromRecord,
          changesFromRecords: changesFromDraftRecords,
          historyTextSelectionFromRecord,
          selectionFromRecord,
          rebindTargetsPreservingGlobal,
          rebindTargetsAcrossHistoryPreservingGlobal,
          canLocateTarget,
          appendDirectEditEvent,
          auditEventKey,
          removeAcknowledgedAuditEvents,
          errorMessage: productErrorMessage,
        }),
        canvas: {
          verifyRendered: (
            expectedHtml,
            expectedSha256,
            context,
            receipt,
            rebuildFence,
          ) => {
            const fence = rebuildFence as Readonly<{
              previousFrameGeneration?: number | null;
              previousFrameDocument?: Document | null;
            }> | undefined;
            return verifyCanvasRenderedRef.current(
              expectedHtml,
              expectedSha256,
              context as ProjectContext | undefined,
              receipt,
              fence?.previousFrameGeneration,
              fence?.previousFrameDocument,
              Boolean(rebuildFence),
            );
          },
          freeze: (reason) => fenceAndFreezeCurrentCanvasRef.current(reason),
          unlock: () => editorRef.current?.unlockNow?.(),
          captureActiveFrameFence: () => Object.freeze({
              previousFrameGeneration: editorRef.current?.getRenderedFrameGeneration() ?? null,
              previousFrameDocument: editorRef.current?.getRenderedFrameDocument() || null,
            }),
          rebuildActiveFrame: () => {
            const rebuildFence = Object.freeze({
              previousFrameGeneration: editorRef.current?.getRenderedFrameGeneration() ?? null,
              previousFrameDocument: editorRef.current?.getRenderedFrameDocument() || null,
            });
            editorRef.current?.rebuildActiveFrame();
            return rebuildFence;
          },
          adoptHistorySource: (nextHtml, target, textSelection, operation) => {
            editorRef.current?.adoptHistorySource(
              nextHtml,
              target as HtmlCanvasSelection | null,
              textSelection as {
                anchor: number;
                focus: number;
                affinity: "left" | "right";
              } | null,
              operation,
            );
          },
        },
      },
      commentWorkflow: {
        codecs: createCommentWorkflowCodecs({
          isRecord,
          sameSourcePath: sameLocalSourcePath,
          persistedComment,
          persistedChangeEvent,
          persistedAttachment,
          persistedTargetRef,
          commentsFromRecords,
          changesFromDraftRecords,
          attachmentFromRecord,
          selectionFromRecord,
          independentCommentTarget,
          commentEditSessionHasChanges,
          canLocateTarget,
          rebindTargetsPreservingGlobal,
          errorMessage: productErrorMessage,
        }),
        attachmentBinary: {
          prepare: async (
            file: File,
            options: { includeDataBase64: boolean },
          ) => ({
            fileName: file.name || "附件",
            mediaType: file.type || "application/octet-stream",
            byteLength: file.size,
            kind: isImageFile(file) ? "image" : "file",
            ...(options.includeDataBase64
              ? { dataBase64: await fileAsBase64(file) }
              : {}),
            sourceFile: file,
          }),
        },
      },
      projectRulesWorkflow: {
        errorMessage: productErrorMessage,
        scheduler: {
          setTimeout: (callback: () => void, delayMs: number) => (
            window.setTimeout(callback, delayMs)
          ),
          clearTimeout: (handle: unknown) => window.clearTimeout(handle as number),
        },
      },
      projectWorkflow: {
        codecs: {
          isRecord,
          sameSourcePath: sameLocalSourcePath,
          versionsFromWorkspace,
          draftAuthorityFromWorkspace,
          authoritativeDraftRevision,
          commentsFromRecords,
          changesFromDraftRecords,
          rebindTargetsPreservingGlobal,
          activeRunFromRecord,
          isLockedLifecycleState,
          commentEditSessionHasChanges,
          recoveryIdentityFromRecord,
          errorMessage: productErrorMessage,
        },
        ports: {
          hash: { sha256: browserSha256 },
          canvas: {
            invalidateRenderAcks: invalidateCanvasRenderAcks,
            isMounted: () => Boolean(editorRef.current),
            deferCommand: (
              kind: string,
              run: () => void,
              options?: {
                authority?: NativeDeferredCommandAuthority;
                onDiscard?: (reason: NativeDeferredCommandDiscardReason) => void;
              },
            ) => deferEditorCommand(kind, run, undefined, options),
            freezeWorkingSource: (options: Record<string, unknown>) => (
              editorRef.current?.freezeWorkingSource(options)
            ),
            freeze: (reason?: string) => fenceAndFreezeCurrentCanvasRef.current(
              reason || "当前编辑画布尚未完成安全收口。",
            ),
            verifyRendered: (
              expectedHtml: string,
              expectedSha256: string,
              context?: ProjectContext,
              receipt?: DocumentSourceReceipt | null,
            ) => verifyCanvasRenderedRef.current(
              expectedHtml,
              expectedSha256,
              context,
              receipt,
            ),
            showCommitBlocked: (reason: string) => (
              editorRef.current?.showCommitBlocked(reason)
            ),
            unlock: () => editorRef.current?.unlockNow?.(),
            clearSelection: () => editorRef.current?.clearSelection(),
            applyPageViewContext: (context: PageViewContext | null) => (
              editorRef.current?.applyPageViewContext(context)
            ),
            hasPendingNativeEdit: () => Boolean(
              editorRef.current?.hasPendingNativeEdit(),
            ),
            requestFrame: (callback: () => void) => (
              window.requestAnimationFrame(callback)
            ),
          },
          projectOpen: {
            openLocal: async () => window.stemmioProjects?.openHtml() ?? null,
            openRecent: async (sourcePath: string) => {
              const api = window.stemmioProjects;
              if (!api) throw new Error("当前运行环境不能打开本地 HTML。");
              return api.openRecent(sourcePath);
            },
            getActive: async () => window.stemmioProjects?.getActiveProject() ?? null,
            listRecent: async () => window.stemmioProjects?.listRecentProjects() ?? [],
            listRegistered: async () => window.stemmioProjects?.listRegisteredProjects?.() ?? [],
            restoreRegisteredWorkingCopy: async (projectId: string) => {
              const restore = window.stemmioProjects?.restoreRegisteredWorkingCopy;
              if (!restore) throw new Error("当前应用缺少工作文件恢复通道。");
              return restore(projectId);
            },
            listRegisteredVersionSummaries: async (registeredProjectId: string) => {
              const list = window.stemmioProjects?.listRegisteredProjectVersionSummaries;
              if (!list) throw new Error("当前 Stemmio 版本缺少项目版本摘要通道。");
              return list(registeredProjectId);
            },
            readRegisteredProjection: async (registeredProjectId: string) => {
              const read = window.stemmioProjects?.readRegisteredProjectProjection;
              if (!read) throw new Error("当前 Stemmio 版本缺少项目展示预热通道。");
              return read(registeredProjectId);
            },
            openRegistered: async (registeredProjectId: string) => {
              const open = window.stemmioProjects?.openRegisteredProject;
              if (!open) throw new Error("当前 Stemmio 版本缺少项目目录打开通道。");
              return open(registeredProjectId);
            },
            acceptExternal: async (requestId: string) => {
              const accept = window.stemmioProjects?.acceptExternalOpen;
              if (!accept) throw new Error("当前 Stemmio 版本缺少外部文件打开通道。");
              return accept(requestId);
            },
            ackExternal: async (requestId: string) => {
              const acknowledge = window.stemmioProjects?.acknowledgeExternalOpen;
              if (!acknowledge) return { acknowledged: true, requestId };
              return acknowledge(requestId);
            },
            commitPrepared: async (payload: {
              requestId: string;
              action: "import-new" | "continue-current" | "open-managed";
              deleteOriginal?: boolean;
            }) => {
              const commit = window.stemmioProjects?.commitPreparedHtmlOpen;
              if (!commit) throw new Error("当前 Stemmio 版本缺少导入确认通道。");
              return commit(payload);
            },
            cancelPrepared: async (requestId: string) => {
              const cancel = window.stemmioProjects?.cancelPreparedHtmlOpen;
              if (!cancel) return { canceled: false };
              return cancel(requestId);
            },
            finalizePrepared: async (requestId: string) => {
              const finalize = window.stemmioProjects?.finalizePreparedHtmlOpen;
              if (!finalize) return { disposition: "kept" as const };
              return finalize(requestId);
            },
            rollbackPrepared: async (requestId: string) => {
              const rollback = window.stemmioProjects?.rollbackPreparedHtmlOpen;
              if (!rollback) return { rolledBack: false, project: null };
              return rollback(requestId);
            },
            activateGeneratedVersion: async (input: {
              operationId?: string;
              previousSourcePath: string;
              nextSourcePath: string;
              expectedSha256: string;
              projectId: string;
              versionId: string;
            }) => {
              const activate = window.stemmioProjects?.activateGeneratedVersion;
              if (!activate) throw new Error("当前运行环境不能安全切换生成版本。");
              return activate(input);
            },
            activateManagedWorkingCopy: async (input: {
              previousSourcePath: string;
              nextSourcePath: string;
              expectedSha256: string;
              projectId: string;
              documentId: string;
              workingCopyId: string;
              versionId: string;
              projectRootPath: string;
              operationId?: string;
            }) => {
              const activate = window.stemmioProjects?.activateManagedWorkingCopy;
              if (!activate) {
                throw new Error("当前运行环境不能安全切换到托管工作文件。");
              }
              return activate(input);
            },
            renameSource: async (input: {
              operationId: string;
              sourcePath: string;
              stem: string;
              expectedSha256: string;
            }) => {
              const rename = window.stemmioProjects?.renameHtml;
              if (!rename) throw new Error("当前运行环境不能安全修改 HTML 文件名。");
              return rename(input);
            },
            reconcileActiveManagedSource: async (input: {
              operationId?: string;
              previousSourcePath: string;
              expectedSourceSha256: string;
              projectId: string;
              documentId: string;
              workingCopyId: string;
              versionId: string;
              reason: "watch" | "rename" | "startup" | "safe-action";
              watcherGeneration?: number;
            }) => {
              const reconcile = window.stemmioProjects?.reconcileActiveManagedSource;
              if (!reconcile) {
                throw new Error("当前运行环境不能安全核对工作文件位置。");
              }
              return reconcile(input);
            },
          },
          viewState: {
            isTransitioning: () => isViewTransitioning(),
          },
        },
        policies: {
          canCloseDuringHydration,
          shouldRecoverAfterCloseAbort: shouldRecoverEditorAfterCloseAbort,
        },
      },
      runWorkflow: {
        codecs: createRunWorkflowCodecs({
          isRecord,
          sameSourcePath: sameLocalSourcePath,
          activeRunFromRecord,
          canonicalLifecycleState,
          commentHasContent,
          commentEditSessionHasChanges,
          canLocateTarget,
          persistedComment,
          persistedChangeEvent,
          persistedTargetRef,
          uniqueTargets,
          fileStem,
          operationKey: activeRunOperationKey,
          errorMessage: productErrorMessage,
        }),
        canvas: {
          checkpointNativeTextIntent: (options: Record<string, unknown>) => (
            editorRef.current?.checkpointNativeTextIntent(options)
          ),
          freeze: (reason: string) => fenceAndFreezeCurrentCanvasRef.current(reason),
          unlock: () => editorRef.current?.unlockNow?.(),
          normalizeComments: () => normalizeCurrentGlobalCommentsRef.current(),
        },
        handoff: {
          copy: async ({ message }: { message: string }) => {
            const integrations = window.stemmioIntegrations;
            if (integrations?.handoffToQoderWork) {
              const result = await integrations.handoffToQoderWork({ message });
              if (result.status !== "copied" || result.copied !== true) {
                throw new Error("桌面应用没有确认剪贴板写入并读回成功。");
              }
              return result;
            }
            if (!navigator.clipboard?.readText) {
              throw new Error("当前环境无法读回剪贴板内容，不能确认交接成功。");
            }
            await copyText(message);
            if (await navigator.clipboard.readText() !== message) {
              throw new Error("剪贴板读回内容与交接内容不一致。");
            }
            return { status: "copied", copied: true };
          },
          openLogin: async ({ providerId }: { providerId: string }) => {
            const integrations = window.stemmioIntegrations;
            if (typeof integrations?.openAgentLogin !== "function") {
              return { opened: false };
            }
            return integrations.openAgentLogin({ providerId });
          },
        },
        scheduler: {
          setTimeout: (callback: () => void, delayMs: number) => (
            window.setTimeout(callback, delayMs)
          ),
          clearTimeout: (handle: unknown) => window.clearTimeout(handle as number),
        },
      },
      versionWorkflow: {
        files: {
          exportHtmlCopy: async (input) => {
            if (typeof window.stemmioProjects?.exportHtmlCopy === "function") {
              return window.stemmioProjects.exportHtmlCopy(input);
            }
            downloadHtml(input.html, input.suggestedName || "项目.html");
            return { kind: "download-started" as const };
          },
        },
        codecs: {
          versionsFromWorkspace,
          draftAuthorityFromWorkspace,
          commentsFromRecords,
          changesFromDraftRecords,
          isRecord,
          sameSourcePath: sameLocalSourcePath,
          operationKey: activeRunOperationKey,
          errorMessage: productErrorMessage,
        },
        canvas: {
          checkpointSource: () => editorRef.current?.checkpointNativeTextIntent({ trigger: "export" }),
          deferCommand: (
            kind: string,
            run: () => void,
            options?: {
              authority?: NativeDeferredCommandAuthority;
              onDiscard?: (reason: NativeDeferredCommandDiscardReason) => void;
            },
          ) => deferEditorCommand(kind, run, undefined, options),
          freezeWorkingSource: (options: Record<string, unknown>) => (
            editorRef.current?.freezeWorkingSource(options)
          ),
          freeze: (reason: string) => fenceAndFreezeCurrentCanvasRef.current(reason),
          verifyRendered: (
            expectedHtml: string,
            expectedSha256: string,
            context?: ProjectContext,
            receipt?: DocumentSourceReceipt | null,
          ) => verifyCanvasRenderedRef.current(expectedHtml, expectedSha256, context, receipt)
            .then(() => undefined),
          invalidateRenderAcks: invalidateCanvasRenderAcks,
          unlock: () => editorRef.current?.unlockNow?.(),
          requestFrame: (callback: () => void) => window.requestAnimationFrame(callback),
          onNavigationChange: (transitioning: boolean) => {
            versionTransitioningRef.current = transitioning;
          },
        },
      },
      browserOpen: {
        canvas: {
          checkpointSource: (options?: { trigger?: string }) => (
            editorRef.current?.checkpointNativeTextIntent({
              trigger: options?.trigger === "save" ? "save" : "manual",
            })
          ),
        },
        files: {
          openInDefaultBrowser: async (input) => {
            const openInDefaultBrowser = window.stemmioProjects?.openInDefaultBrowser;
            if (typeof openInDefaultBrowser !== "function") {
              throw Object.freeze({
                code: "BROWSER_OPEN_UNAVAILABLE",
                message: "当前环境不能在系统浏览器中打开 HTML。",
              });
            }
            return openInDefaultBrowser(input);
          },
        },
        errorMessage: productErrorMessage,
      },
      clock: { now: Date.now },
    });
    workspaceControllerRef.current = controller;
    setWorkspaceController(controller);
    return () => {
      if (workspaceControllerRef.current === controller) {
        workspaceControllerRef.current = null;
      }
      setWorkspaceController((current) => current === controller ? null : current);
      controller.dispose();
    };
  }, [
    bridgeConnectionReady,
    deferEditorCommand,
    desktopHostIssue,
    invalidateCanvasRenderAcks,
    isViewTransitioning,
    desktopHostReady,
    workspacePreferencesSessionPort,
  ]);
  const invalidateEditCanvasRenderAck = useCallback(() => {
    setCanvasRenderAcks((current) => (
      current.edit ? { ...current, edit: null } : current
    ));
  }, []);
  const acknowledgeCanvasRender = useCallback((
    observation: DocumentCanvasRenderObservation,
  ): boolean => {
    const current = currentDocumentSessionSnapshot();
    if (
      observation.receipt.canvasGeneration !== current.canvasGeneration
      || !sameSourceReceipt(observation.receipt, current.sourceReceipt)
    ) return false;
    return workspaceControllerRef.current?.acknowledgeEditCanvas(observation) === true;
  }, [currentDocumentSessionSnapshot]);
  const renderedContentSha256 =
    canvasRenderAcks.edit?.generation === canvasGeneration
      ? canvasRenderAcks.edit.sha256
      : null;
  const handlePreviewReady = useCallback((sha256: string | null) => {
    setCanvasRenderAcks((current) => ({
      ...current,
      preview: sha256 ? { generation: canvasGeneration, sha256 } : null,
    }));
  }, [canvasGeneration]);
  const activeRun = runSnapshot.activeRun;
  const recentRunOutcome = runSnapshot.recentOutcome;
  const projectLocked = runSnapshot.activeLocked;
  const generating = runSnapshot.activeSubmission?.phase === "preparing";
  // Opening is not complete until the source has either proved its existing
  // v4 binding or been imported as a new V1. Keep the whole open/application/
  // hydration interval behind one interaction fence: ProjectWorkflow may then
  // reuse its first canonical prepareSwitch instead of repeating the drain
  // after the trusted Desktop read returns.
  const projectRegistrationPending = Boolean(
    workspaceController
    && sourcePath
    && (!projectId || !documentId)
    && !projectRegistrationError,
  );
  const projectHydrating =
    shellSnapshot?.project?.hydration.phase === "hydrating"
    || shellSnapshot?.project?.open.phase === "opening"
    || projectApplicationSnapshot.status !== "idle"
    || projectRegistrationPending;
  const projectLoadError =
    shellSnapshot?.project?.hydration.phase === "failed"
      ? shellSnapshot.project.hydration.error
      : projectRegistrationError || null;
  const [startupIssue, setStartupIssue] = useState<StartupIssue | null>(null);
  const [workspaceIssue, setWorkspaceIssue] = useState<WorkspaceIssue | null>(null);
  const [cancelRunConfirmationKey, setCancelRunConfirmationKey] =
    useState<string | null>(null);
  const [reviewPreparing, setReviewPreparing] = useState(false);
  const [openingReadyVersion, setOpeningReadyVersion] = useState(false);
  const agentHandoffState = runSnapshot.activeHandoff;
  const [updateResult, setUpdateResult] =
    useState<ApplicationUpdateResult | null>(null);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [settingsCategory, setSettingsCategory] = useState<SettingsCategory>("general");
  const [applicationVersion, setApplicationVersion] = useState("");
  const [desktopUpdatesAvailable, setDesktopUpdatesAvailable] = useState(false);
  const [manualUpdateCheckPending, setManualUpdateCheckPending] = useState(false);
  const [manualUpdateCheckFailed, setManualUpdateCheckFailed] = useState(false);
  const [repositoryOpenFailed, setRepositoryOpenFailed] = useState(false);
  const [releaseNotesOpenFailed, setReleaseNotesOpenFailed] = useState(false);
  const [userNoticeOpenFailed, setUserNoticeOpenFailed] = useState(false);
  const [pendingExit, setPendingExit] = useState(false);
  const [fileStatusNotice, setFileStatusNotice] = useState<string | null>(null);
  const [openHtmlError, setOpenHtmlError] = useState<string | null>(null);
  const confirmedOriginalDeletionRef = useRef<string | null>(null);
  const [interruption, setInterruption] = useState<GlobalInterruption | null>(null);
  const [pausedNoticeIdentity, setPausedNoticeIdentity] =
    useState<string | null>(null);
  const noticeDeadlineRef = useRef<{
    identity: string;
    deadlineAt: number;
    remainingMs: number;
    paused: boolean;
  } | null>(null);
  const [externalSourcePreview, setExternalSourcePreview] = useState<{
    html: string;
    sourceSha256: string;
    receipt: ExternalSourceObservationReceipt;
  } | null>(null);
  const presentedInterruption = globalInterruptionPresentation(interruption);
  const noticeIdentity = presentedInterruption
    ? `${presentedInterruption.usageKey}\n${presentedInterruption.title}\n${presentedInterruption.message}`
    : "";
  const noticeTimerPaused = Boolean(
    noticeIdentity && pausedNoticeIdentity === noticeIdentity,
  );
  useEffect(() => {
    if (!workspaceController) return undefined;
    const unsubscribe = workspaceController.subscribeEvents((event) => {
      if (event.type === "document-source-operation") {
        const sourceEvent = event as Readonly<{
          context?: ProjectContext;
          phase?: "running" | "idle";
        }>;
        if (
          sourceEvent.context
          && workspaceController.matchesCurrentProjectContext(sourceEvent.context)
        ) {
          setSourceViewTransitioning(sourceEvent.phase === "running");
        }
        return;
      }
      if (event.type === "registration-published") {
        const registrationEvent = event as Readonly<{
          context: ProjectContext;
          projectName: string | null;
          imported?: boolean;
          workingCopyRecovered?: boolean;
        }>;
        if (!workspaceController.matchesCurrentProjectContext(registrationEvent.context)) return;
        setProjectRegistrationError("");
        if (registrationEvent.projectName) setProjectName(registrationEvent.projectName);
        return;
      }
      if (event.type === "workbench-tabs-restore-missing") {
        setGlobalSidebarOpen(true);
        return;
      }
      if (event.type === "workbench-tabs-persistence-failed") {
        return;
      }
      if (event.type === "workbench-tabs-restore-failed") {
        const failure = event as { tabId?: unknown; committed?: unknown; reason?: unknown };
        if (failure.committed === true) return;
        setGlobalSidebarOpen(true);
        return;
      }
      if (event.type === "external-open-completed") {
        const openEvent = event as Readonly<{
          imported?: boolean;
          disposition?: string;
          visibleV1FileName?: string;
          sourcePath?: string | null;
        }>;
        if (!openEvent.imported) return;
        if (openEvent.disposition !== "trash-failed") return;
        setInterruption({
          kind: "import-trash-failed",
          fileName: openEvent.visibleV1FileName || "项目内的 V1 文件",
          sourcePath: openEvent.sourcePath || null,
        });
        return;
      }
      if (event.type === "external-open-ack-failed") {
        const ackEvent = event as Readonly<{
          confirmation?: boolean;
          requestId?: unknown;
          reason?: unknown;
        }>;
        const requestId = typeof ackEvent.requestId === "string"
          ? ackEvent.requestId
          : "";
        if (ackEvent.confirmation === true && requestId) {
          setInterruption({
            kind: "project-open-failed",
            detail: String(
              ackEvent.reason || "HTML 已完成打开，但下一个 Finder 请求尚未解锁。",
            ),
            requestId,
          });
        }
        return;
      }
      if (event.type === "external-open-canvas-failed") {
        return;
      }
      if (event.type === "version-refresh-warning") {
        const refreshEvent = event as Readonly<{
          context?: ProjectContext | null;
          candidateLabel?: string;
          reason?: string;
        }>;
        if (
          refreshEvent.context
          && !workspaceController.matchesCurrentProjectContext(refreshEvent.context)
        ) return;
        reportInternalFailure({
          area: "version",
          operation: "refresh-warning",
          code: "version-refresh-warning",
          recovered: false,
          cause: refreshEvent.reason,
        });
        return;
      }
      if (event.type === "version-activation-published") {
        const publication = event as Readonly<{ context?: ProjectContext | null; operationKey?: string }>;
        if (
          !publication.context
          || !workspaceController.matchesCurrentProjectContext(publication.context)
        ) return;
        const review = readyReviewSession;
        if (!review || review.operationKey === publication.operationKey) {
          // Prepared Review documents contain both HTML copies, bootstrap
          // scripts and comment targets. Once the Candidate is adopted, the
          // new source authority must release that comparison graph.
          reviewAnalysisSession.clear();
          if (review) reviewSessionsRef.current.delete(review.tabId);
          setReadyReviewSession(null);
          performance.mark("stemmio:accept:overlay-closed");
        }
        commentCanvasPort.setSelection(null);
        commentEditResumePendingRef.current = null;
        commentCanvasPort.setEditingCommentId(null);
        setPreviewAttachment(null);
        setHandoffPreviewOpen(false);
        setCanvasMode("edit");
        performance.mark("stemmio:accept:ui-published");
        return;
      }
      if (event.type === "attachment-cleanup-failed") {
        const attachmentEvent = event as Readonly<{
          context?: ProjectContext | null;
          attachment?: CommentAttachment;
          outcome?: { reason?: unknown };
        }>;
        if (
          attachmentEvent.context
          && !workspaceController.matchesCurrentProjectContext(attachmentEvent.context)
        ) return;
        reportInternalFailure({
          area: "attachments",
          operation: "copy-cleanup",
          code: "attachment-cleanup-failed",
          recovered: false,
          cause: attachmentEvent.outcome?.reason,
        });
        return;
      }
      const runEvent = event as Readonly<{
        type: string;
        run?: ActiveRun | null;
        state?: LifecycleState;
        current?: boolean;
        previousState?: LifecycleState;
        agentMayBeRunning?: boolean;
        message?: string;
      }>;
      if (runEvent.type === "run-submission-started" || runEvent.type === "run-submitted") {
        if (runEvent.current) {
          setHandoffPreviewOpen(false);
          // Reported in the thread, not as a duplicate toolbar status.
          setCanvasMode("preview");
          revealAiConversation();
        }
        return;
      }
      if (runEvent.type === "run-submission-uncertain") {
        return;
      }
      if (runEvent.type === "run-submission-failed") {
        return;
      }
      if (runEvent.type === "run-handoff-failed") {
        if (runEvent.current && runEvent.run) {
          revealAiConversation();
        }
        return;
      }
      if (runEvent.type === "run-agent-failed") {
        if (runEvent.current && runEvent.run) {
          // A refused *retry* is not a failed round. AGENT_RETRY_OUTPUT_PRESENT means
          // an earlier attempt already produced output, which the Bridge correctly
          // refuses to overwrite — but when that output is a usable candidate, the
          // failure copy ("请结束本轮后重新发送") tells the user to throw away the very
          // result the decision bar is asking them to accept. Both statements were on
          // screen at once and the user could not tell whether the round worked.
          if (runEvent.run.candidateVersionLabel) {
            return;
          }
          revealAiConversation();
        }
        return;
      }
      if (runEvent.type === "run-status") {
        const run = runEvent.run;
        const state = runEvent.state;
        if (runEvent.current) {
          if (state === "cancelled") {
            setHandoffPreviewOpen(false);
            setCanvasMode("edit");
          } else if (
            state === "ready-to-open"
            || state === "no-change"
            || state === "error"
            || state === "awaiting-conflict-resolution"
            || state === "recovering-transaction"
          ) {
            // A finished round is reported by the conversation: the sidebar moves to
            // "结果 · 等待决定" and its action bar carries the decision. Only the
            // Exceptional states stay in the same conversation when it is open;
            // background projects must never navigate the visible project.
            // Repeated ready polls must not erase a later Review outcome.
            if (state === "ready-to-open" && runEvent.previousState !== state) {
              setInterruption(null);
            }
            if (state === "error" && run) {
              revealAiConversation();
            }
          }
        }
        return;
      }
      if (runEvent.type === "run-cancelled") {
        if (runEvent.current) {
          setHandoffPreviewOpen(false);
          setCanvasMode("edit");
        }
        if (runEvent.agentMayBeRunning && runEvent.run) {
          setInterruption({
            kind: "external-agent-may-still-run",
            current: Boolean(runEvent.current),
            sourcePath: runEvent.run.sourcePath,
          });
        }
        return;
      }
      const projectEvent = event as Readonly<{
        type: string;
        project?: unknown;
        context?: ProjectContext;
        stage?: unknown;
        reason?: unknown;
        code?: unknown;
        kind?: unknown;
        operationId?: unknown;
        timing?: unknown;
        sourcePath?: unknown;
        projects?: unknown;
        projectName?: unknown;
        lastSavedAt?: unknown;
        showHandoff?: unknown;
        contentChanged?: unknown;
        activeLocked?: unknown;
        epoch?: unknown;
        requestId?: unknown;
        ackPending?: unknown;
      }>;
      if (projectEvent.type === "project-hydration-stage") {
        markProjectHydrationStage(String(projectEvent.stage || ""), projectEvent.operationId, projectEvent.timing);
        return;
      }
      if (projectEvent.type === "project-applied") {
        const project = projectEvent.project as HtmlProject;
        const tabSnapshot = workspaceController.getSnapshot().workbenchTabs;
        const targetTabId = tabSnapshot?.tabs.find((tab) => (
          tab.kind === "document"
          && tab.projectId === project.projectId
          && tab.documentId === project.documentId
        ))?.tabId || "";
        markProjectApplied(projectEvent.operationId, projectEvent.epoch);
        setStartupIssue(null);
        setProjectName(project.name);
        commentCanvasPort.setSelection(null);
        const restoredPresentation = restoreCachedDocumentPresentation({
          controller: workspaceController, tabId: targetTabId, project,
          setPageViewContext, stage: reviewStageRef.current,
        });
        // Exact identity keys let tab changes cancel work without purging cache.
        reviewAnalysisSession.cancel();
        commentCanvasPort.setComposerOpen(false);
        for (const url of attachmentObjectUrlsRef.current.values()) {
          try {
            URL.revokeObjectURL(url);
          } catch {
            // A retired preview URL cannot block the next project's authority.
          }
        }
        attachmentObjectUrlsRef.current.clear();
        setAttachmentObjectUrls({});
        setPreviewAttachment(null);
        commentEditResumePendingRef.current = null;
        commentCanvasPort.resetLayout();
        setCanvasMode(restoredPresentation?.canvasMode || "edit");
        setSourceViewTransitioning(false);
        setProjectRegistrationError("");
        setOpeningReadyVersion(Boolean(
          workspaceController.getSnapshot().runSession?.activeRun
          && workspaceController.getSnapshot().runSession?.operationKeys.some(
            ([kind, key]) => (
              kind === "activate"
              && key === activeRunOperationKey(
                workspaceController.getSnapshot().runSession?.activeRun as ActiveRun,
              )
            ),
          ),
        ));
        return;
      }
      if (projectEvent.type === "project-draft-recovered") {
        commentEditResumePendingRef.current = null;
        commentCanvasPort.setEditingCommentId(null);
        commentCanvasPort.setComposerOpen(false);
        return;
      }
      if (projectEvent.type === "project-hydrated") {
        if (
          projectEvent.context
          && !workspaceController.matchesCurrentProjectContext(projectEvent.context)
        ) return;
        if (typeof projectEvent.projectName === "string" && projectEvent.projectName) {
          setProjectName(projectEvent.projectName);
        }
        if (projectEvent.showHandoff) {
          setHandoffPreviewOpen(false);
          setCanvasMode("edit");
        }
        setWorkspaceIssue((current) => (
          current?.source === "locator" ? null : current
        ));
        return;
      }
      if (projectEvent.type === "project-startup-failed") {
        setStartupIssue({
          title: "上次打开的 HTML 无法恢复",
          message: String(
            projectEvent.reason
            || "文件可能已移动、删除或损坏。源页没有打开其他内容来替代它。",
          ),
        });
        return;
      }
      if (projectEvent.type === "project-startup-ready") {
        setStartupIssue(null);
        return;
      }
      if (projectEvent.type === "project-application-deferred") {
        return;
      }
      if (projectEvent.type === "external-project-open-deferred") {
        return;
      }
      if (projectEvent.type === "external-project-open-unavailable") {
        setInterruption({
          kind: "external-open-unavailable",
          detail: String(projectEvent.reason || "当前 Stemmio 版本缺少外部文件打开通道。"),
        });
        return;
      }
      if (projectEvent.type === "project-open-failed") {
        const message = String(
          projectEvent.reason || "文件暂时无法完成安全切换。",
        );
        if (projectEvent.kind === "external") {
          setOpenHtmlError(message);
          return;
        }
        setInterruption({
          kind: "project-open-failed",
          detail: message,
          recent: projectEvent.kind === "recent",
          ...(typeof projectEvent.requestId === "string" && projectEvent.requestId
            ? { requestId: projectEvent.requestId }
            : {}),
        });
        return;
      }
      if (projectEvent.type === "project-close-reconciliation-blocked") {
        const reason = String(projectEvent.reason || "关闭核对期间当前项目已切换。");
        if (projectEvent.code === "source-integrity-failed") {
          setWorkspaceIssue({
            title: "源文件需要重新核对",
            message: reason,
            source: "integrity",
          });
        } else {
          reportInternalFailure({
            area: "project",
            operation: "close-reconciliation",
            code: String(projectEvent.code || "close-source-reconciliation"),
            recovered: false,
            cause: reason,
          });
        }
        return;
      }
      if (projectEvent.type === "project-source-locator-failed") {
        const locator = workspaceUnavailableFromCode(String(projectEvent.code || ""));
        if (locator) setWorkspaceIssue(locator);
        return;
      }
      if (
        projectEvent.type === "project-source-renamed"
        || projectEvent.type === "project-source-relocated"
      ) {
        if (typeof projectEvent.projectName === "string" && projectEvent.projectName) {
          setProjectName(projectEvent.projectName);
        }
        setWorkspaceIssue((current) => (
          current?.source === "locator" ? null : current
        ));
        return;
      }
      const documentEvent = event as Readonly<{
        type: string;
        context?: ProjectContext;
        lastSavedAt?: unknown;
        events?: unknown;
        mutation?: HtmlCanvasMutation;
        code?: unknown;
        message?: unknown;
        fatal?: unknown;
      }>;
      if (
        documentEvent.context
        && !workspaceController.matchesCurrentProjectContext(documentEvent.context)
      ) return;
      if (documentEvent.type === "document-direct-edit-recorded") {
        if (documentEvent.mutation) {
          captureUsageEvent("direct_edit_committed", {
            edit_kind: documentEvent.mutation.kind,
            property_group: documentEvent.mutation.kind === "text"
              ? "text"
              : editPropertyGroup(documentEvent.mutation.property),
          }, documentEvent.context?.projectId || undefined);
        }
      }
      if (
        documentEvent.type === "document-persisted"
        && typeof documentEvent.lastSavedAt === "string"
        && documentEvent.lastSavedAt
      ) {
        setWorkspaceIssue((current) => (
          current?.source === "locator" ? null : current
        ));
      }
    });
    return () => {
      unsubscribe();
    };
  }, [
    commentCanvasPort,
    readyReviewSession,
    reviewAnalysisSession,
    revealAiConversation,
    setSourceViewTransitioning,
    workspaceController,
  ]);
  useEffect(() => () => reviewAnalysisSession.dispose(), [reviewAnalysisSession]);
  const reportInterruptionPresence = useCallback((
    interruptionCode: string,
    present: boolean,
    surface: "canvas" | "global" | "native" | "panel",
    resolvedResult: "dismissed" | "recovered" = "recovered",
    eventProjectId?: string,
    localScope?: string,
  ) => {
    const identity = `${localScope || eventProjectId || "global"}:${interruptionCode}`;
    const previous = interruptionPresenceRef.current.get(identity) || false;
    if (previous === present) return;
    interruptionPresenceRef.current.set(identity, present);
    captureUsageEvent("interruption_changed", {
      interruption_code: interruptionCode,
      phase: present ? "started" : "resolved",
      result: present ? "unknown" : resolvedResult,
      surface,
    }, eventProjectId);
  }, []);

  useEffect(() => {
    interruptionRef.current = interruption;
  }, [interruption]);

  useEffect(() => {
    if (!sourcePath) return;
    captureUsageEvent("project_context_opened", {
      registered: Boolean(projectId),
      view_mode: viewMode,
    }, projectId || undefined);
  }, [projectId, sourcePath, viewMode]);

  useEffect(() => {
    captureUsageEvent("module_viewed", {
      module: canvasMode === "preview" ? "canvas_preview" : "canvas_edit",
    }, projectId || undefined);
  }, [canvasMode, projectId]);

  useEffect(() => {
    if (aboutOpen) {
      captureUsageEvent("module_viewed", { module: "about" }, projectId || undefined);
    }
  }, [aboutOpen, projectId]);

  useEffect(() => {
    const localScope = projectId || usageFingerprint(sourcePath || "unregistered");
    const previous = previousPersistStateRef.current.get(localScope);
    previousPersistStateRef.current.set(localScope, persistState);
    if (previous && previous !== persistState) {
      captureUsageEvent("source_persistence_changed", {
        from_state: previous,
        to_state: persistState,
      }, projectId || undefined);
    }
    reportInterruptionPresence(
      "source_conflict",
      persistState === "conflict",
      "canvas",
      "recovered",
      projectId || undefined,
      localScope,
    );
  }, [persistState, projectId, reportInterruptionPresence, sourcePath]);

  useEffect(() => {
    const nextState = activeRun?.status || "none";
    const eventProjectId = activeRun?.projectId || projectId || undefined;
    const localScope = eventProjectId || usageFingerprint(sourcePath || "unregistered");
    const previous = previousRunStateRef.current.get(localScope);
    previousRunStateRef.current.set(localScope, nextState);
    if (previous && previous !== nextState) {
      captureUsageEvent("ai_run_state_changed", {
        from_state: previous,
        to_state: nextState,
        comment_count: countBucket(activeRun?.commentCount || 0),
        edit_count: countBucket(activeRun?.changeEventCount || 0),
      }, eventProjectId);
    }
    reportInterruptionPresence(
      "ai_conflict_resolution",
      nextState === "awaiting-conflict-resolution",
      "panel",
      "recovered",
      eventProjectId,
      localScope,
    );
  }, [activeRun, projectId, reportInterruptionPresence, sourcePath]);

  useEffect(() => {
    reportInterruptionPresence(
      "workspace_unavailable",
      Boolean(workspaceIssue),
      "global",
    );
  }, [reportInterruptionPresence, workspaceIssue]);

  useEffect(() => {
    reportInterruptionPresence(
      "startup_recovery",
      Boolean(startupIssue),
      "global",
    );
  }, [reportInterruptionPresence, startupIssue]);

  useEffect(() => {
    reportInterruptionPresence(
      "project_load_failure",
      Boolean(projectLoadError),
      "canvas",
      "recovered",
      projectId || undefined,
      projectId || usageFingerprint(sourcePath || "unregistered"),
    );
  }, [
    projectId,
    projectLoadError,
    reportInterruptionPresence,
    sourcePath,
  ]);

  useEffect(() => {
    const updates = window.stemmioUpdates;
    if (!updates) return undefined;
    let active = true;
    const receiveStatus = (result: ApplicationUpdateResult | null) => {
      if (active) setUpdateResult(result);
    };
    const unsubscribe = updates.onStatus(receiveStatus);
    queueMicrotask(() => {
      if (active) setDesktopUpdatesAvailable(true);
    });
    void updates.getStatus().then(receiveStatus).catch(() => undefined);
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) setApplicationVersion(window.stemmioRuntime?.appVersion || "");
    });
    return () => {
      active = false;
    };
  }, []);

  const relaunchApp = useCallback(async () => {
    try {
      await window.stemmioAppLifecycle?.relaunch();
    } catch (cause) {
      setWorkspaceIssue({
        title: "本地项目资料暂时不可用",
        message: productErrorMessage(
          cause,
          "当前页面内容仍保留。可先导出当前 HTML，再重新打开源页。",
        ),
        source: "lifecycle",
      });
    }
  }, []);

  const openAboutStemmio = useCallback(() => {
    const active = document.activeElement;
    if (active instanceof HTMLElement) overlayReturnFocusRef.current = active;
    setManualUpdateCheckFailed(false);
    setRepositoryOpenFailed(false);
    setReleaseNotesOpenFailed(false);
    setUserNoticeOpenFailed(false);
    setAboutOpen(true);
  }, []);

  const openSettingsPage = useCallback((category: SettingsCategory = "general") => {
    const active = document.activeElement;
    if (active instanceof HTMLElement) overlayReturnFocusRef.current = active;
    setGlobalSidebarOpen(true);
    setSettingsCategory(category);
    void navigationCapability?.commands.createSettingsTab();
  }, [navigationCapability]);

  useEffect(() => {
    openAgentSettingsRef.current = () => openSettingsPage("agent");
    return () => {
      openAgentSettingsRef.current = null;
    };
  }, [openSettingsPage]);

  useEffect(() => {
    const lifecycle = window.stemmioAppLifecycle;
    if (!lifecycle?.onWorkspaceUnavailable) return undefined;
    return lifecycle.onWorkspaceUnavailable((issue) => {
      setWorkspaceIssue({
        title: issue.title || "本地项目资料暂时不可用",
        message: issue.message
          || "当前页面内容仍保留。可先导出当前 HTML，再重新打开源页。",
        source: "lifecycle",
      });
    });
  }, []);

  useEffect(() => {
    const lifecycle = window.stemmioAppLifecycle;
    if (!lifecycle?.onExternalOpenFailed) return undefined;
    return lifecycle.onExternalOpenFailed((issue) => {
      setOpenHtmlError(issue.message || "无法读取这个 HTML 文件。");
      setGlobalSidebarOpen(true);
    });
  }, []);

  useEffect(() => {
    const lifecycle = window.stemmioAppLifecycle;
    if (!lifecycle?.onAboutRequested) return undefined;
    return lifecycle.onAboutRequested(openAboutStemmio);
  }, [openAboutStemmio]);

  const checkForApplicationUpdates = useCallback(async () => {
    const updates = window.stemmioUpdates;
    setManualUpdateCheckFailed(false);
    if (!updates) {
      setManualUpdateCheckFailed(true);
      return;
    }
    setManualUpdateCheckPending(true);
    try {
      const result = await updates.checkNow();
      setUpdateResult(result);
    } catch {
      setManualUpdateCheckFailed(true);
    } finally {
      setManualUpdateCheckPending(false);
    }
  }, []);

  const openProjectRepository = useCallback(async () => {
    setRepositoryOpenFailed(false);
    try {
      const updates = window.stemmioUpdates;
      if (updates) {
        const result = await updates.openRepository();
        if (!result?.opened) throw new Error("GitHub repository did not open.");
        return;
      }
      window.open(PROJECT_REPOSITORY_URL, "_blank", "noopener,noreferrer");
    } catch {
      setRepositoryOpenFailed(true);
    }
  }, []);

  const openReleaseNotes = useCallback(async () => {
    setReleaseNotesOpenFailed(false);
    try {
      const updates = window.stemmioUpdates;
      if (updates) {
        const result = await updates.openLatestRelease();
        if (!result?.opened) throw new Error("Release notes did not open.");
        return;
      }
      window.open(LATEST_RELEASE_PAGE_URL, "_blank", "noopener,noreferrer");
    } catch {
      setReleaseNotesOpenFailed(true);
    }
  }, []);

  const openUserNotice = useCallback(async () => {
    setUserNoticeOpenFailed(false);
    try {
      const result = await window.stemmioAppLifecycle?.openUserNotice();
      if (!result?.opened) throw new Error("User notice did not open.");
    } catch {
      setUserNoticeOpenFailed(true);
    }
  }, []);

  const closeAboutStemmio = useCallback(() => {
    setAboutOpen(false);
    window.requestAnimationFrame(() => {
      const returnFocus = overlayReturnFocusRef.current;
      if (returnFocus && document.contains(returnFocus)) returnFocus.focus();
      else document.querySelector<HTMLElement>(
        ".workbench-sidebar-product > button:first-child",
      )?.focus();
      overlayReturnFocusRef.current = null;
    });
  }, []);

  const downloadAvailableUpdate = useCallback(async () => {
    try {
      const result = await window.stemmioUpdates?.downloadAvailable();
      if (result) setUpdateResult(result);
    } catch {
      // The main-process controller publishes a bounded unavailable state.
    }
  }, []);

  const installDownloadedUpdate = useCallback(async (): Promise<boolean> => {
    try {
      const result = await window.stemmioUpdates?.installDownloaded();
      if (!result?.installing) {
        throw new Error(result?.reason || "下载的更新尚未准备完成。");
      }
      return true;
    } catch {
      return false;
    }
  }, []);

  const viewingVersion = useMemo(
    () => versions.find((version) => version.id === viewingVersionId) || null,
    [versions, viewingVersionId],
  );
  const runInProgress = projectLocked;
  const currentAgentHandoffStatus = (
    activeRun?.sourcePath
    && activeRun.requestId
    && sameLocalSourcePath(agentHandoffState?.sourcePath, activeRun.sourcePath)
    && agentHandoffState?.requestId === activeRun.requestId
    && agentHandoffState.attemptId === activeRun.attemptId
  )
    ? agentHandoffState.status
    : "idle";
  const currentAgentDeliveryState = currentAgentHandoffStatus === "idle" ? null : agentHandoffState;
  const currentAgentDeliveryMode =
    currentAgentDeliveryState?.mode || activeRun?.agentDelivery?.mode || "clipboard";
  const handoffCancellationNeedsConfirmation = Boolean(
    activeRun?.status === "processing"
    && runSnapshot.activeHandoffMayBeRunning
    && !runSnapshot.activeHandoffManaged,
  );
  const cancelRunConfirmationOpen = Boolean(
    cancelRunConfirmationKey
    && activeRun
    && activeRunOperationKey(activeRun) === cancelRunConfirmationKey
    && activeRun.status === "processing"
    && handoffCancellationNeedsConfirmation,
  );
  const updateActionVisible = Boolean(
    (
      updateResult?.status === "available"
      || updateResult?.status === "downloading"
      || updateResult?.status === "downloaded"
    )
    && updateResult.latestVersion,
  );
  const updateDownloaded = updateResult?.status === "downloaded";
  const updateDownloading = updateResult?.status === "downloading";
  const updateBadgeLabel = updateDownloaded ? "重启更新" : "New!";
  const currentSourceFileName = aiSourceFileName;
  useEffect(() => {
    if (!workspaceController || !projectId || !documentId) return;
    const tabId = `document:${projectId}:${documentId}`;
    const projected = workspaceController.getSnapshot().workbenchTabs;
    if (!projected?.tabs.some((tab) => tab.tabId === tabId)) return;
    workspaceController.updateWorkbenchTabTitle(
      projectId,
      documentId,
      currentSourceFileName,
    );
    workspaceController.updateWorkbenchTabStatus(
      projectId,
      documentId,
      projectLoadError || persistState === "failed" || persistState === "conflict"
        ? "error"
        : readyReviewSession || activeRun?.status === "ready-to-open"
          ? "review-ready"
          : runInProgress
            ? "processing"
            : "normal",
    );
  }, [
    currentSourceFileName,
    documentId,
    persistState,
    projectId,
    projectLoadError,
    projectName,
    readyReviewSession,
    activeRun?.status,
    runInProgress,
    workspaceController,
  ]);
  const interactionLocked = runInProgress
    || projectHydrating
    || Boolean(projectLoadError)
    || Boolean(workspaceIssue)
    || viewTransitioning
    || persistState === "conflict"
    || viewMode === "history";
  const isBuiltInWelcomePage = projectName === WELCOME_PROJECT.name;

  const activeCommentItems = useMemo(
    () => comments.filter(commentHasContent),
    [comments],
  );
  const activeCommentCount = activeCommentItems.length;
  const unfinishedEditedComment = commentEditSession
    ? activeCommentItems.find(
        (comment) => comment.commentId === commentEditSession.commentId,
      ) ?? null
    : null;
  const historyPreview = viewMode === "history"
    && versionSnapshot.historyPreview?.projectId === projectId
    && versionSnapshot.historyPreview?.documentId === documentId
    && versionSnapshot.historyPreview?.sourcePath === sourcePath
    ? versionSnapshot.historyPreview : null;
  const displayedCanvasMode = historyPreview ? "preview" : canvasMode;
  const interactionPreviewHtml = historyPreview?.content || externalSourcePreview?.html || html;
  const pageViewDocumentKey = [
    viewMode,
    sourcePath || documentId || projectId || "memory",
  ].join(":");
  const activePageViewContext = (
    pageViewContext?.documentKey === pageViewDocumentKey
  ) ? pageViewContext : null;
  const expectedCommentLayoutSourceSha256 = renderedContentSha256 || "";
  const otherTabCommentsContextKey = [
    canvasMode,
    pageViewDocumentKey,
    activePageViewContext?.generation ?? 0,
  ].join(":");
  const acceptPageViewContext = useCallback((
    nextContext: PageViewContext | null,
    documentKey: string,
  ): boolean => {
    if (
      pageViewDocumentKeyRef.current !== documentKey
      || (nextContext && nextContext.documentKey !== documentKey)
    ) return false;
    const stage = reviewStageRef.current;
    const scrollTop = stage?.scrollTop ?? 0;
    const requestId = ++pagePresentationScrollRequestRef.current;
    setPageViewContext(nextContext);
    window.requestAnimationFrame(() => {
      if (requestId !== pagePresentationScrollRequestRef.current) return;
      const currentStage = reviewStageRef.current;
      if (!currentStage) return;
      const maxTop = Math.max(
        0,
        currentStage.scrollHeight - currentStage.clientHeight,
      );
      currentStage.scrollTo({
        top: Math.min(scrollTop, maxTop),
        behavior: "auto",
      });
    });
    return true;
  }, []);
  const visibleCommentItems = useMemo(
    () => (
      viewMode === "history" && viewingVersion
        ? viewingVersion.comments.filter(commentHasContent)
        : activeCommentItems
    ),
    [activeCommentItems, viewMode, viewingVersion],
  );
  const hasCommentDraft = Boolean(
    viewMode === "current"
    && !interactionLocked
    && draftTarget
    && (commentSnapshot?.composerHasText || draftAttachments.length > 0),
  );
  const composerOpen = commentCanvasPort.getSnapshot().composerOpen;
  useEffect(() => {
    pageViewDocumentKeyRef.current = pageViewDocumentKey;
  }, [pageViewDocumentKey]);
  useEffect(() => {
    let issue: string | null = null;
    try {
      assertDesktopHost(window);
    } catch (cause) {
      issue = cause instanceof Error
        ? cause.message
        : "桌面运行环境未初始化。";
    }
    const frame = window.requestAnimationFrame(() => {
      setDesktopHostIssue(issue);
      setDesktopHostReady(true);
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);
  useEffect(() => () => {
    for (const url of attachmentObjectUrlsRef.current.values()) {
      URL.revokeObjectURL(url);
    }
    attachmentObjectUrlsRef.current.clear();
  }, []);

  const commentedTargets = useMemo(() => {
    const grouped = new Map<string, {
      target: HtmlCanvasSelection;
      layoutTargets: HtmlCanvasCommentLayoutTarget[];
      visualHint?: HtmlCanvasRuntimeVisualHint;
      count: number;
      label: string;
      showMarker?: boolean;
      hasDraft?: boolean;
    }>();
    for (const comment of visibleCommentItems) {
      const sourceTarget = comment.sourceAnchor;
      const visualHint = comment.visualHint;
      const markerTarget = commentVisualTarget(comment);
      const markerKey = commentMarkerGroupKey(markerTarget);
      const current = grouped.get(markerKey);
      if (current) {
        current.count += 1;
        current.layoutTargets.push({
          target: sourceTarget,
          ...(visualHint ? { visualHint } : {}),
        });
      }
      else {
        grouped.set(markerKey, {
          target: sourceTarget,
          layoutTargets: [{
            target: sourceTarget,
            ...(visualHint ? { visualHint } : {}),
          }],
          ...(visualHint ? { visualHint } : {}),
          count: 1,
          label: visualHint?.label || insertionLabel(sourceTarget),
        });
      }
    }
    if ((hasCommentDraft || composerOpen) && draftTarget) {
      const sourceTarget = draftTarget.commentAnchor ?? draftTarget;
      const visualHint = commentVisualHintForSelection(draftTarget);
      const markerTarget = visualHint ? { ...sourceTarget, visualHint } : sourceTarget;
      const markerKey = commentMarkerGroupKey(markerTarget);
      const current = grouped.get(markerKey);
      if (current) {
        current.hasDraft = true;
        if (!current.layoutTargets.some((entry) => entry.target.id === sourceTarget.id)) {
          current.layoutTargets.push({
            target: sourceTarget,
            ...(visualHint ? { visualHint } : {}),
          });
        }
      } else {
        grouped.set(markerKey, {
          target: sourceTarget,
          layoutTargets: [{
            target: sourceTarget,
            ...(visualHint ? { visualHint } : {}),
          }],
          ...(visualHint ? { visualHint } : {}),
          count: 0,
          label: visualHint?.label || insertionLabel(sourceTarget),
          showMarker: false,
          hasDraft: true,
        });
      }
    }
    return [...grouped.values()];
  }, [composerOpen, draftTarget, hasCommentDraft, visibleCommentItems]);

  const trackedAuditTargets = useMemo(() => {
    const byTargetId = new Map<string, HtmlCanvasSelection>();
    for (const event of changeEvents) {
      if (event.target.id) byTargetId.set(event.target.id, event.target);
    }
    return [...byTargetId.values()];
  }, [changeEvents]);

  const captureProjectContext = useCallback((): ProjectContext | null => {
    return workspaceControllerRef.current?.getCurrentProjectContext() ?? null;
  }, []);

  const isCurrentProjectContext = useCallback(
    (context: ProjectContext): boolean => (
      workspaceControllerRef.current?.matchesCurrentProjectContext(context) ?? false
    ),
    [],
  );

  const prepareProjectRecords = useCallback(async () => {
    const currentProject = currentProjectSessionSnapshot();
    const activeSource = currentProject.sourcePath;
    const epoch = currentProject.epoch;
    if (
      !workspaceController
      || !activeSource
      || (currentProject.projectId && currentProject.documentId)
    ) return;
    const preparationKey = `${epoch}\0${activeSource}`;
    projectRegistrationPreparationRef.current = preparationKey;
    let registrationPublished = false;
    setProjectRegistrationError("");
    try {
      const registered = registrationContextFromOutcome(
        await requiredWorkspaceController(workspaceController).ensureRegistered(),
      );
      registrationPublished = Boolean(registered);
      if (
        registered
        && !sameLocalSourcePath(registered.sourcePath, activeSource)
      ) {
        setImportedCanvasBase({
          managedSourcePath: registered.sourcePath,
          externalSourcePath: activeSource,
        });
      }
      const settledProject = currentProjectSessionSnapshot();
      const hydrationPublishedBinding = Boolean(
        settledProject.projectId && settledProject.documentId,
      );
      if (
        !registered
        && !hydrationPublishedBinding
        && settledProject.epoch === epoch
        && sameLocalSourcePath(settledProject.sourcePath, activeSource)
      ) {
        throw new Error("项目资料没有完成初始化。");
      }
    } catch (cause) {
      if (
        currentProjectSessionSnapshot().epoch !== epoch
        || !sameLocalSourcePath(
          currentProjectSessionSnapshot().sourcePath,
          activeSource,
        )
      ) return;
      setProjectRegistrationError(productErrorMessage(
        cause,
        "项目资料暂时无法建立；当前 HTML 和评论仍保留，可在这里重试。",
      ));
    } finally {
      const settledProject = currentProjectSessionSnapshot();
      const hasSettledProjectBinding = Boolean(
        settledProject.projectId && settledProject.documentId,
      );
      if (
        projectRegistrationPreparationRef.current === preparationKey
        && (
          registrationPublished
          || hasSettledProjectBinding
          || (
            settledProject.epoch === epoch
            && sameLocalSourcePath(settledProject.sourcePath, activeSource)
          )
        )
      ) {
      }
    }
  }, [currentProjectSessionSnapshot, workspaceController]);

  useEffect(() => {
    if (
      !workspaceController
      || !sourcePath
      || (projectId && documentId)
    ) return;
    const registrationKey = `${projectSnapshot.epoch}\0${sourcePath}`;
    if (automaticProjectRegistrationRef.current === registrationKey) return;
    automaticProjectRegistrationRef.current = registrationKey;
    void prepareProjectRecords();
  }, [
    documentId,
    prepareProjectRecords,
    projectId,
    projectSnapshot.epoch,
    sourcePath,
    workspaceController,
  ]);

  const verifyCanvasRendered = useCallback(async (
    expectedHtml: string,
    expectedSha256: string,
    context?: ProjectContext,
    receipt?: DocumentSourceReceipt | null,
    previousFrameGeneration?: number | null,
    previousFrameDocument?: Document | null,
    explicitRebuild = false,
  ): Promise<DocumentCanvasRenderObservation> => {
    performance.mark("stemmio:canvas:verify-start");
    const expectedGeneration = currentDocumentSessionSnapshot().canvasGeneration;
    const expectedReceipt = receipt || currentDocumentSessionSnapshot().sourceReceipt;
    const initialFrameDocument = previousFrameDocument
      || editorRef.current?.getRenderedFrameDocument()
      || null;
    const requirePhysicalReload = Boolean(
      expectedReceipt?.origin === "authority"
      && initialFrameDocument,
    );
    const waitForCurrentGeneration = async (): Promise<DocumentCanvasRenderObservation | null> => {
      const explicitRebuildAttemptLimit = Math.ceil(
        EDIT_AUTHOR_RUNTIME_BUDGET.runtimeSurfaceDeadlineMs / 25,
      );
      // The imperative rebuild invalidates the old frame synchronously, but
      // React may not commit and verify its static replacement within the
      // ordinary one-second observation window on a loaded desktop. Give that
      // explicitly requested projection rebuild the existing surface budget;
      // it still cannot repeat source acceptance or trigger another rebuild.
      let attemptLimit = explicitRebuild
        ? explicitRebuildAttemptLimit
        : 40;
      const runtimeAttemptLimit = Math.ceil(
        EDIT_AUTHOR_RUNTIME_VERIFICATION_DEADLINE_MS / 25,
      );
      for (let attempt = 0; attempt < attemptLimit; attempt += 1) {
        await new Promise<void>((resolve) => window.setTimeout(resolve, 25));
        const runtimePending = EDIT_RUNTIME_PENDING_PHASES.has(
          currentControllerSnapshot()?.editRuntime?.phase || "static",
        );
        if (runtimePending) {
          // Main bounds preparation and visible iframe load independently.
          // The disposable author frame cannot acknowledge its source until
          // both phases settle; treating that permitted interval as a failed
          // static render would replace the iframe unnecessarily.
          attemptLimit = Math.max(attemptLimit, runtimeAttemptLimit);
        }
        if (context && !isCurrentProjectContext(context)) {
          throw new Error("项目已切换，停止核对旧项目画布。");
        }
        if (
          currentDocumentSessionSnapshot().canvasGeneration !== expectedGeneration
          || currentDocumentSessionSnapshot().html !== expectedHtml
        ) {
          throw new Error("画布核对期间当前文档已经切换。");
        }
        const currentReceipt = currentDocumentSessionSnapshot().sourceReceipt;
        if (
          expectedReceipt
          && (!currentReceipt
            || !sameSourceReceipt(currentReceipt, expectedReceipt))
        ) {
          throw new Error("画布核对期间当前源码回执已经切换。");
        }
        const renderedSource = editorRef.current?.getRenderedSourceHtml();
        if (renderedSource !== expectedHtml) continue;
        const frameGeneration = editorRef.current?.getRenderedFrameGeneration();
        const frameDocument = editorRef.current?.getRenderedFrameDocument() || null;
        if (
          (previousFrameGeneration != null && frameGeneration === previousFrameGeneration)
          || (requirePhysicalReload && frameDocument === initialFrameDocument)
        ) {
          // Same bytes in the old frame are not a reload receipt. Let the new
          // author candidate finish. A static Runtime phase is a valid interval
          // before React commits the authority receipt's replacement frame, so
          // keep observing within the existing bound instead of misclassifying
          // that interval as an immediate acknowledgement timeout.
          continue;
        }
        const renderedSha256 = await browserSha256(renderedSource);
        if (renderedSha256 !== expectedSha256) {
          throw new Error("画布已载入内容的 Hash 与源 HTML 不一致。");
        }
        if (!currentReceipt || frameGeneration == null) continue;
        performance.mark("stemmio:canvas:verify-ack");
        return Object.freeze({
          receipt: currentReceipt,
          renderedHtml: renderedSource,
          renderedSha256,
          frameGeneration,
        });
      }
      return null;
    };
    const firstObservation = await waitForCurrentGeneration();
    if (firstObservation) return firstObservation;
    throw Object.assign(
      new Error("画布没有在时限内确认载入目标 HTML。"),
      { code: "DOCUMENT_CANVAS_ACK_TIMEOUT" },
    );
  }, [
    currentControllerSnapshot,
    currentDocumentSessionSnapshot,
    isCurrentProjectContext,
  ]);
  useEffect(() => {
    verifyCanvasRenderedRef.current = verifyCanvasRendered;
  }, [verifyCanvasRendered]);

  useEffect(() => {
    if (canvasMode !== "edit") return undefined;
    if (editRuntimeRenderPending) return undefined;
    let cancelled = false;
    const expectedHtml = html;
    const expectedGeneration = canvasGeneration;
    const expectedReceipt = currentDocumentSessionSnapshot().sourceReceipt;
    const verifyInitialRender = async () => {
      for (let attempt = 0; attempt < 40; attempt += 1) {
        await new Promise<void>((resolve) => window.setTimeout(resolve, 25));
        if (cancelled) return;
        if (editorRef.current?.getRenderedSourceHtml() !== expectedHtml) continue;
        const renderedSha256 = await browserSha256(expectedHtml);
        if (
          !cancelled
          && currentDocumentSessionSnapshot().html === expectedHtml
          && currentDocumentSessionSnapshot().canvasGeneration === expectedGeneration
          && currentDocumentSessionSnapshot().workingHtmlSha256 === renderedSha256
        ) {
          const currentReceipt = currentDocumentSessionSnapshot().sourceReceipt;
          const frameGeneration = editorRef.current?.getRenderedFrameGeneration();
          if (
            currentReceipt
            && expectedReceipt
            && sameSourceReceipt(currentReceipt, expectedReceipt)
            && frameGeneration != null
          ) acknowledgeCanvasRender(Object.freeze({
            receipt: currentReceipt,
            renderedHtml: expectedHtml,
            renderedSha256,
            frameGeneration,
          }));
        }
        return;
      }
    };
    void verifyInitialRender();
    return () => {
      cancelled = true;
    };
  }, [
    acknowledgeCanvasRender,
    canvasGeneration,
    canvasMode,
    currentDocumentSessionSnapshot,
    editRuntimePhase,
    editRuntimeRenderPending,
    html,
    sourceSha256,
    sourceReceipt,
  ]);

  const clearAutosaveTimer = useCallback(() => {
    workspaceController?.clearDocumentAutosaveTimer();
  }, [workspaceController]);

  const normalizeCurrentGlobalComments = useCallback((): CommentItem[] => {
    const currentComments = currentCommentSessionSnapshot();
    const normalized = normalizeGlobalCommentTargets(
      currentComments.comments.filter(commentHasContent),
    );
    if (!normalized.changed) return normalized.comments;
    const normalizedById = new Map(
      normalized.comments.map((comment) => [comment.commentId, comment]),
    );
    const nextComments = currentComments.comments.map(
      (comment) => normalizedById.get(comment.commentId) || comment,
    );
    workspaceControllerRef.current?.applyCommentItems(nextComments);
    return nextComments.filter(commentHasContent);
  }, [currentCommentSessionSnapshot]);
  useEffect(() => {
    normalizeCurrentGlobalCommentsRef.current = normalizeCurrentGlobalComments;
  }, [normalizeCurrentGlobalComments]);

  // Workbench only creates CanvasChangeInput and delegates durable source
  // authority to the composed application Workflow.
  const flushAutosave = useCallback(async (throughRevision?: number): Promise<boolean> => {
    if (!workspaceController || workspaceIssue) return false;
    const outcome = await requiredWorkspaceController(workspaceController)
      .flushDocument({ throughRevision });
    return outcome.status === "succeeded";
  }, [workspaceController, workspaceIssue]);

  const enqueueAutosave = useCallback((
    nextHtml: string,
    mutation?: HtmlCanvasMutation,
    sourceTransaction?: HtmlCanvasSourceTransaction,
  ): DocumentEditOutcome => {
    if (!workspaceController || workspaceIssue) {
      return {
        status: "blocked",
        code: "DOCUMENT_WORKFLOW_UNAVAILABLE",
        reason: workspaceIssue
          ? "本地项目资料暂时不可用，已暂停保存。"
          : "项目资料初始化尚未就绪，当前修改没有被接受。",
      };
    }
    return requiredWorkspaceController(workspaceController)
      .enqueueDocumentEdit({
        html: nextHtml,
        mutation,
        sourceTransaction,
        context: workspaceControllerRef.current?.getCurrentProjectContext() || undefined,
      });
  }, [workspaceController, workspaceIssue]);

  const refreshWorkspace = useCallback(async (
    sourceOverride?: string | null,
    epochOverride?: number,
    fromDeferred = false,
    sourceTransitionToken?: number,
    authorityReceiptContinuation?: DocumentSourceReceipt | null,
  ) => {
    if (!workspaceController) return;
    await workspaceController.refreshProject({
      sourcePath: sourceOverride,
      epoch: epochOverride,
      fromDeferred,
      sourceTransitionToken,
      authorityReceiptContinuation,
    });
  }, [workspaceController]);
  useEffect(() => {
    if (!presentedInterruption) {
      noticeDeadlineRef.current = null;
      return;
    }
    const dismissAfter = presentedInterruption.dismissMs;
    if (dismissAfter === null) {
      noticeDeadlineRef.current = null;
      return;
    }
    const now = Date.now();
    const existing = noticeDeadlineRef.current;
    const remaining = existing?.identity === noticeIdentity
      ? existing.paused
        ? existing.remainingMs
        : Math.max(0, existing.deadlineAt - now)
      : dismissAfter;
    if (noticeTimerPaused) {
      noticeDeadlineRef.current = {
        identity: noticeIdentity,
        deadlineAt: now + remaining,
        remainingMs: remaining,
        paused: true,
      };
      return;
    }
    noticeDeadlineRef.current = {
      identity: noticeIdentity,
      deadlineAt: now + remaining,
      remainingMs: remaining,
      paused: false,
    };
    const timeout = window.setTimeout(() => {
      captureUsageEvent("notification_interacted", {
        notice_code: noticeUsageCode(presentedInterruption.usageKey),
        interaction: "auto-dismiss",
        surface: "global",
      }, currentProjectSessionSnapshot().projectId || undefined);
      setInterruption(null);
    }, remaining);
    return () => window.clearTimeout(timeout);
  }, [currentProjectSessionSnapshot, noticeIdentity, noticeTimerPaused, presentedInterruption]);

  const rememberAttachmentObjectUrl = useCallback((
    attachmentId: string,
    objectUrl: string,
  ) => {
    const previous = attachmentObjectUrlsRef.current.get(attachmentId);
    if (previous && previous !== objectUrl) URL.revokeObjectURL(previous);
    attachmentObjectUrlsRef.current.set(attachmentId, objectUrl);
    setAttachmentObjectUrls((current) => ({
      ...current,
      [attachmentId]: objectUrl,
    }));
  }, []);

  const forgetAttachmentObjectUrl = useCallback((attachmentId: string) => {
    const previous = attachmentObjectUrlsRef.current.get(attachmentId);
    if (previous) URL.revokeObjectURL(previous);
    attachmentObjectUrlsRef.current.delete(attachmentId);
    setAttachmentObjectUrls((current) => {
      if (!current[attachmentId]) return current;
      const next = { ...current };
      delete next[attachmentId];
      return next;
    });
  }, []);

  const attachmentBlob = useCallback(async (
    attachment: CommentAttachment,
  ): Promise<Blob> => {
    const outcome = await requiredWorkspaceController(workspaceController)
      .readAttachment({ attachment });
    if (outcome.status === "succeeded") return outcome.value;
    throw new Error(
      ("reason" in outcome && outcome.reason) || "附件暂时无法读取。",
    );
  }, [workspaceController]);

  const ensureAttachmentObjectUrl = useCallback(async (
    attachment: CommentAttachment,
  ): Promise<string> => {
    const existing = attachmentObjectUrlsRef.current.get(attachment.attachmentId);
    if (existing) return existing;
    const objectUrl = URL.createObjectURL(await attachmentBlob(attachment));
    rememberAttachmentObjectUrl(attachment.attachmentId, objectUrl);
    return objectUrl;
  }, [attachmentBlob, rememberAttachmentObjectUrl]);

  const removeComposerAttachment = useCallback((attachment: CommentAttachment) => {
    const outcome = workspaceController?.removeComposerAttachment({
      attachmentId: attachment.attachmentId,
    });
    if (outcome?.status !== "succeeded") return;
    forgetAttachmentObjectUrl(attachment.attachmentId);
  }, [forgetAttachmentObjectUrl, workspaceController]);

  const removeCommentAttachment = useCallback((
    commentId: string,
    attachment: CommentAttachment,
  ) => {
    const outcome = workspaceController?.removeCommentEditAttachment({
      commentId,
      attachmentId: attachment.attachmentId,
    });
    if (outcome?.status !== "succeeded") return;
    forgetAttachmentObjectUrl(attachment.attachmentId);
  }, [forgetAttachmentObjectUrl, workspaceController]);

  const uploadAttachments = useCallback(async (
    files: File[],
    target: { kind: "composer" | "comment"; commentId: string },
    source: "clipboard" | "file-picker",
  ) => {
    if (files.length === 0) return;
    const currentComments = currentCommentSessionSnapshot();
    const targetIsOpen = target.kind === "composer"
      ? currentComments.composerCommentId === target.commentId
      : (
          currentComments.editSession?.commentId === target.commentId
          && currentComments.comments.some(
            (comment) => comment.commentId === target.commentId,
          )
        );
    if (!targetIsOpen) return;
    const checkpoint = editorRef.current?.checkpointNativeTextIntent({
      trigger: "attachment",
    });
    if (checkpoint && !checkpoint.ok) {
      editorRef.current?.showCommitBlocked(
        checkpoint.reason || "请完成当前文字输入，再添加附件。",
      );
      return;
    }
    const existingCount = target.kind === "composer"
      ? currentComments.composerAttachments.length
      : currentComments.editSession?.draftAttachments.length ?? 0;
    const attachmentPlan = planAttachmentSelection(files, existingCount);
    const selected = attachmentPlan.accepted;
    const issueNotes: string[] = [];
    const failedNames: string[] = [];
    let addedAttachmentCount = 0;
    for (const invalidFile of attachmentPlan.invalid) {
      const fileName = invalidFile?.name || "未命名文件";
      if (!invalidFile || !Number.isFinite(invalidFile.size) || invalidFile.size <= 0) {
        issueNotes.push(`${fileName} 是空文件`);
      } else if (invalidFile.size > MAX_ATTACHMENT_BYTES) {
        issueNotes.push(
          `${fileName} 为 ${(invalidFile.size / 1024 / 1024).toFixed(1)} MB，超过 25 MB`,
        );
      } else {
        issueNotes.push(`${fileName} 无法读取`);
      }
    }
    if (attachmentPlan.overLimit.length > 0) {
      issueNotes.push(
        `已达到每条评论 ${MAX_COMMENT_ATTACHMENTS} 个附件的上限，`
        + `${attachmentPlan.overLimit.length} 个未加入`,
      );
    }
    if (selected.length === 0 && issueNotes.length > 0) {
      const needsRemoval = attachmentPlan.overLimit.length > 0
        && attachmentPlan.available === 0;
      setInterruption({
        kind: "attachment-rejected",
        detail: `${issueNotes.join("；")}。${
          needsRemoval
            ? "请先移除一个附件，再重新选择。"
            : "请选择其他文件。"
        }`,
        needsRemoval,
        target,
      });
      return;
    }
    const uploadFiles = selected.map((originalFile) => (
      source === "clipboard" && !originalFile.name
        ? new File(
            [originalFile],
            `粘贴图片-${Date.now()}.${originalFile.type.split("/")[1] || "png"}`,
            { type: originalFile.type || "image/png" },
          )
        : originalFile
    ));
    const outcome = await requiredWorkspaceController(workspaceController)
      .uploadAttachments({
        files: uploadFiles,
        target,
        source,
      });
    if (outcome.status !== "succeeded") {
      return;
    }
    const uploaded = outcome.value as {
      attachments: Array<{
        attachment: CommentAttachment;
        sourceFile?: File;
      }>;
      failures: Array<{ fileName: string; reason: string }>;
    };
    addedAttachmentCount = uploaded.attachments.length;
    for (const item of uploaded.attachments) {
      if (item.attachment.kind === "image" && item.sourceFile) {
        rememberAttachmentObjectUrl(
          item.attachment.attachmentId,
          URL.createObjectURL(item.sourceFile),
        );
      }
    }
    for (const failure of uploaded.failures) {
      failedNames.push(failure.fileName);
      if (failedNames.length === 1) issueNotes.push(failure.reason);
    }
    if (failedNames.length > 0) {
      issueNotes.push(`${failedNames.join("、")} 未加入评论`);
    }
    if (issueNotes.length > 0) {
      const settledComments = currentCommentSessionSnapshot();
      const targetStillOpen = target.kind === "composer"
        ? settledComments.composerCommentId === target.commentId
        : settledComments.editSession?.commentId === target.commentId;
      const currentAttachmentCount = target.kind === "composer"
        ? settledComments.composerAttachments.length
        : settledComments.editSession?.draftAttachments.length ?? 0;
      const needsRemoval = attachmentPlan.overLimit.length > 0
        && currentAttachmentCount >= MAX_COMMENT_ATTACHMENTS;
      setInterruption({
        kind: "attachment-batch-partial",
        detail: `${issueNotes.join("；")}。${
          addedAttachmentCount > 0
            ? needsRemoval
              ? "已加入的附件仍然保留；如需加入其余文件，请先移除一个附件。"
              : "已加入的附件仍然保留。"
            : targetStillOpen
              ? needsRemoval
                ? "请先移除一个附件，再重新选择。"
                : "请选择其他文件。"
              : "请重新打开评论后再选择附件。"
        }`,
        added: addedAttachmentCount > 0,
        failed: failedNames.length > 0,
        composerOpen: targetStillOpen,
        needsRemoval,
        target,
      });
    }
  }, [
    currentCommentSessionSnapshot,
    rememberAttachmentObjectUrl,
    setInterruption,
    workspaceController,
  ]);

  const openAttachmentPicker = useCallback((
    target: { kind: "composer" | "comment"; commentId: string },
    accept: "all" | "image" = "all",
  ) => {
    commentCanvasPort.requestAttachmentPicker(target, accept);
  }, [commentCanvasPort]);

  const pasteImages = useCallback((
    event: ClipboardEvent<HTMLTextAreaElement>,
    target: { kind: "composer" | "comment"; commentId: string },
  ) => {
    const files = [...event.clipboardData.items]
      .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
      .map((item) => item.getAsFile())
      .filter((item): item is File => Boolean(item));
    if (files.length === 0) return;
    event.preventDefault();
    void uploadAttachments(files, target, "clipboard");
  }, [uploadAttachments]);

  const openAttachmentPreview = useCallback(async (
    attachment: CommentAttachment,
  ) => {
    if (attachment.kind !== "image") return;
    try {
      await ensureAttachmentObjectUrl(attachment);
      setPreviewAttachment(attachment);
    } catch (cause) {
      reportInternalFailure({
        area: "attachments",
        operation: "preview",
        code: "attachment-preview-failed",
        recovered: false,
        cause,
      });
    }
  }, [ensureAttachmentObjectUrl, setPreviewAttachment]);

  const downloadAttachment = useCallback(async (
    attachment: CommentAttachment,
  ) => {
    try {
      const objectUrl = URL.createObjectURL(await attachmentBlob(attachment));
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = attachment.fileName;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
    } catch (cause) {
      reportInternalFailure({
        area: "attachments",
        operation: "download",
        code: "attachment-download-failed",
        recovered: false,
        cause,
      });
    }
  }, [attachmentBlob]);

  useEffect(() => {
    if (!workspaceController) return undefined;
    const subscribe = window.stemmioProjects?.onSourceFileChanged;
    if (typeof subscribe !== "function") return undefined;
    return subscribe((payload) => {
      void workspaceController.observeExternalSourceChange({
        reason: "watch",
        previousSourcePath: payload.sourcePath,
        watcherGeneration: payload.watcherGeneration,
        sourceMissing: payload.sourceMissing,
      });
    });
  }, [workspaceController]);

  useEffect(() => {
    if (!workspaceController) return undefined;
    const handlePrepareClose = (event: Event) => {
      const detail = (event as CustomEvent<PrepareCloseDetail>).detail;
      if (!detail || typeof detail.waitUntil !== "function") return;
      // The desktop shell only accepts checks registered synchronously.
      detail.waitUntil(workspaceController.prepareClose({
        requestId: detail.requestId,
        deadlineAt: detail.deadlineAt,
      }) as Promise<CloseReadiness>);
      setPendingExit(true);
    };
    window.addEventListener("stemmio:prepare-close", handlePrepareClose);
    return () => window.removeEventListener(
      "stemmio:prepare-close",
      handlePrepareClose,
    );
  }, [workspaceController, workspacePreferencesController]);

  useEffect(() => {
    if (!workspaceController) return undefined;
    const handleCloseAborted = (event: Event) => {
      const detail = (event as CustomEvent<CloseAbortedDetail>).detail;
      if (!detail || typeof detail.requestId !== "string") return;
      workspaceController.abortClose({ requestId: detail.requestId });
      setPendingExit(false);
    };
    window.addEventListener("stemmio:close-aborted", handleCloseAborted);
    return () => window.removeEventListener(
      "stemmio:close-aborted",
      handleCloseAborted,
    );
  }, [workspaceController]);

  useEffect(() => {
    if (!fileStatusNotice || pendingExit) return undefined;
    const timer = window.setTimeout(() => setFileStatusNotice(null), 2500);
    return () => window.clearTimeout(timer);
  }, [fileStatusNotice, pendingExit]);

  const openProject = useCallback(async (recentPath?: string) => {
    if (!workspaceController) return;
    setOpenHtmlError(null);
    await workspaceController.openProject({
      kind: recentPath ? "recent" : "local",
      sourcePath: recentPath || null,
    });
  }, [workspaceController]);
  const presentWorkbenchTabOutcome = useCallback((outcome: unknown) => {
    if (!outcome || typeof outcome !== "object" || (outcome as { status?: string }).status === "succeeded") return;
    const result = outcome as { reason?: string; code?: string };
    setFileStatusNotice(result.reason || "页面没有打开，原页面仍保留。");
    reportInternalFailure({
      area: "navigation",
      operation: "tab-switch",
      code: result.code || "workbench-tab-rejected",
      recovered: false,
      cause: result.reason,
    });
  }, []);
  const rememberWorkbenchTabPresentation = useCallback((
    tabs: WorkbenchTabsSnapshot,
  ) => {
    if (!workspaceController) return;
    const activeTabId = tabs.activeTabId;
    const cachedScrollTop = workspaceController.getSnapshot().documentSurfaceCache?.presentations
      .find((entry) => entry.tabId === activeTabId)?.scrollTop;
    rememberActiveDocumentPresentation({ controller: workspaceController,
      tabs, canvasMode,
      pageViewContext: activePageViewContext,
      scrollTop: canvasMode === "edit"
        ? reviewStageRef.current?.scrollTop ?? 0
        : cachedScrollTop ?? 0 });
  }, [
    activePageViewContext,
    canvasMode,
    workspaceController,
  ]);
  useLayoutEffect(() => {
    const pendingTabId = workbenchTabsSnapshot.pendingTabId;
    if (!pendingTabId) {
      pendingPresentationCaptureRef.current = null;
      return;
    }
    if (pendingPresentationCaptureRef.current === pendingTabId) return;
    pendingPresentationCaptureRef.current = pendingTabId;
    rememberWorkbenchTabPresentation(workbenchTabsSnapshot);
  }, [
    rememberWorkbenchTabPresentation,
    workbenchTabsSnapshot,
  ]);
  const openRegisteredWorkbenchProject = useCallback(async (project: RegisteredProject) => {
    if (!navigationCapability || !project.documentId || project.availability !== "ready") return null;
    const outcome = await navigationCapability.commands.openRegisteredProject({
      projectId: project.projectId,
      documentId: project.documentId,
      title: project.projectName,
    });
    presentWorkbenchTabOutcome(outcome);
    return outcome;
  }, [navigationCapability, presentWorkbenchTabOutcome]);

  const openProjectRulesPage = useCallback((project: RegisteredProject) => {
    if (!navigationCapability) return;
    setGlobalSidebarOpen(true);
    if (!project.documentId) return;
    void navigationCapability.commands.createProjectRulesTab({ projectId: project.projectId, documentId: project.documentId, title: project.projectName }).then((outcome) => {
      presentWorkbenchTabOutcome(outcome);
    });
  }, [navigationCapability, presentWorkbenchTabOutcome]);

  const updateProjectRules = useCallback((content: string) => {
    workspaceController?.updateProjectRules({ content });
  }, [workspaceController]);

  const beginProjectRulesComposition = useCallback((input: {
    target: HTMLTextAreaElement;
    baselineValue: string;
  }) => {
    workspaceController?.beginProjectRulesComposition(input);
  }, [workspaceController]);

  const finishProjectRulesComposition = useCallback((input: {
    target: HTMLTextAreaElement;
  }) => {
    workspaceController?.finishProjectRulesComposition(input);
  }, [workspaceController]);

  const saveProjectRules = useCallback(() => {
    void workspaceController?.saveProjectRules();
  }, [workspaceController]);

  const restoreProjectRules = useCallback(() => {
    workspaceController?.restoreProjectRules();
  }, [workspaceController]);

  const retryProjectRules = useCallback(() => {
    if (!workspaceController || !projectId || !documentId || !sourcePath) return;
    void workspaceController.openProjectRules({
      context: {
        epoch: projectSnapshot.epoch,
        projectId,
        documentId,
        sourcePath,
      },
    });
  }, [documentId, projectId, projectSnapshot.epoch, sourcePath, workspaceController]);

  useEffect(() => {
    workspaceController?.reconcileProjectTransitions();
  }, [
    attachmentUploadCount,
    commentSnapshot,
    documentSnapshot,
    draftPersistError,
    externalFileOpenSnapshot.status,
    externalFileOpenSnapshot.deferredSequence,
    projectApplicationSnapshot.status,
    projectApplicationSnapshot.deferredSequence,
    projectHydrating,
    projectLoadError,
    projectSnapshot,
    runSnapshot,
    viewTransitioning,
    workbenchTabsSnapshot.revision,
    workspaceController,
  ]);

  const showProjectInFolder = useCallback(async (requestedSourcePath?: string) => {
    const activeSourcePath = requestedSourcePath
      || currentProjectSessionSnapshot().sourcePath;
    const showInFolder = window.stemmioProjects?.showInFolder;
    if (!activeSourcePath || !showInFolder) return;
    await runLocalUserAction({
      kind: "show-source-in-folder",
      invoke: () => showInFolder(activeSourcePath),
      onFailure: (cause: unknown) => setInterruption({
        kind: "show-in-folder-failed",
        detail: productErrorMessage(
          cause,
          "源 HTML 可能已移动；当前项目仍保持打开，可以重试。",
        ),
      }),
    });
  }, [currentProjectSessionSnapshot, setInterruption]);

  const openSelectedHtmlInDefaultBrowser = useCallback(async () => {
    if (!workspaceController) return;
    await runLocalUserAction({
      kind: "open-source-in-browser",
      invoke: async () => {
        const outcome = await workspaceController.openSelectedDocumentInDefaultBrowser();
        if (outcome.status === "succeeded") return outcome.value;
        const reason = outcome.status === "stale"
          ? "所选页面已经切换，因此没有打开其他文档。"
          : outcome.reason;
        throw Object.freeze({
          code: outcome.status === "stale"
            ? "BROWSER_OPEN_STALE"
            : outcome.status === "unknown"
              ? "BROWSER_OPEN_UNKNOWN"
              : outcome.code,
          message: reason,
        });
      },
      onFailure: (cause: unknown) => setInterruption({
        kind: "open-in-browser-failed",
        detail: productErrorMessage(
          cause,
          "请确认修改已写入源 HTML 后重试；当前项目仍保持打开。",
        ),
      }),
    });
  }, [setInterruption, workspaceController]);

  const handleCanvasChange = useCallback((
    nextHtml: string,
    mutation?: HtmlCanvasMutation,
    sourceTransaction?: HtmlCanvasSourceTransaction,
  ): DocumentSourceReceipt | false => {
    const currentRun = currentRunSessionSnapshot();
    const currentDocument = currentDocumentSessionSnapshot();
    if (
      currentRun.activeLocked
      || projectHydrating
      || projectLoadError
      || isViewTransitioning()
      || String(currentDocument.persistState) === "conflict"
      || viewMode === "history"
    ) return false;
    // A published history projection can accept the next source transaction
    // while its save receipt drains. The history chain validates its base;
    // an in-flight receipt alone must not revoke visible editability.
    let acceptedReceipt: DocumentSourceReceipt | null = null;
    try {
      const enqueued = enqueueAutosave(nextHtml, mutation, sourceTransaction);
      if (enqueued.status !== "succeeded") {
        reportInternalFailure({
          area: "history",
          operation: "record-edit",
          code: "source-history-record-failed",
          recovered: false,
          cause: documentEditFailureReason(enqueued),
        });
        return false;
      }
      acceptedReceipt = enqueued.value.receipt;
      if (!acceptedReceipt) return false;
    } catch (cause) {
      reportInternalFailure({
        area: "history",
        operation: "record-edit",
        code: "source-history-record-failed",
        recovered: false,
        cause,
      });
      return false;
    }
    const renderGeneration = acceptedReceipt.canvasGeneration;
    void browserSha256(nextHtml).then((renderedSha256) => {
      const settledDocument = currentDocumentSessionSnapshot();
      const settledReceipt = settledDocument.sourceReceipt;
      if (
        settledDocument.html === nextHtml
        && settledDocument.canvasGeneration === renderGeneration
        && sameSourceReceipt(settledReceipt, acceptedReceipt)
        && editorRef.current?.getRenderedSourceHtml() === nextHtml
      ) {
        const frameGeneration = editorRef.current?.getRenderedFrameGeneration();
        if (frameGeneration == null || !settledReceipt) return;
        acknowledgeCanvasRender(Object.freeze({
          receipt: settledReceipt,
          renderedHtml: nextHtml,
          renderedSha256,
          frameGeneration,
        }));
      }
    });
    return acceptedReceipt;
  }, [
    acknowledgeCanvasRender,
    currentDocumentSessionSnapshot,
    currentRunSessionSnapshot,
    enqueueAutosave,
    isViewTransitioning,
    projectHydrating,
    projectLoadError,
    viewMode,
    workspaceController,
  ]);

  const exportCurrentHtml = useCallback(async (fromDeferred = false, saveVersion = false): Promise<void> => {
    if (isViewTransitioning() || !workspaceController) return;
    if (!fromDeferred && deferEditorCommand("export", () => { deferredEditorReplayRef.current.exportCurrentHtml?.(saveVersion); })) return;
    await workspaceController.exportHtml({ suggestedName: projectName, saveVersion });
  }, [deferEditorCommand, isViewTransitioning, projectName, workspaceController]);

  useEffect(() => {
    deferredEditorReplayRef.current.exportCurrentHtml = (saveVersion = false) => {
      void exportCurrentHtml(true, saveVersion);
    };
  }, [exportCurrentHtml]);

  // DocumentWorkflow owns the complete disk-source operation. Workbench sends
  // intent, presents its confirmation request, and renders the phased result.
  const reloadCurrentSource = useCallback(async ({
    fromDeferred = false,
  }: { fromDeferred?: boolean } = {}) => {
    const context = captureProjectContext();
    if (!context || projectLoadError || !workspaceController) return false;
    if (requiredWorkspaceController(workspaceController).hasDocumentHistoryAction) return false;
    if (
      !fromDeferred
      && deferEditorCommand(
        "external-refresh",
        () => deferredEditorReplayRef.current.reloadCurrentSource?.(),
      )
    ) return false;
    try {
      const controller = requiredWorkspaceController(workspaceController);
      let outcome = await controller.reloadDocumentFromDisk({
        context,
        intent: { kind: "request" },
      });
      if (outcome.status === "blocked" && outcome.confirmation) {
        const confirmed = outcome.code === "DOCUMENT_RELOAD_CONFIRMATION_REQUIRED"
          && (outcome.reason === "确定要用外部版本覆盖当前编辑吗？此操作不可撤销。"
            ? window.confirm("确定要用外部版本覆盖当前编辑吗？此操作不可撤销。")
            : window.confirm("重新载入会舍弃尚未写回的当前编辑内容。建议先导出 HTML 副本，仍要继续吗？"));
        if (!confirmed) return false;
        outcome = await controller.reloadDocumentFromDisk({
          context,
          intent: {
            kind: "confirm",
            confirmation: outcome.confirmation,
          },
        });
      }
      if (outcome.status === "stale" || !isCurrentProjectContext(context)) return false;
      if (outcome.status !== "succeeded") throw new Error(outcome.reason);
      setExternalSourcePreview(null);
      setCanvasMode("edit");
      const restored = outcome.value.page.status === "restored";
      setFileStatusNotice(restored
        ? "页面已重新加载，可以继续编辑"
        : "文件已重新读取，但页面暂时无法编辑，请重试");
      return restored;
    } catch (cause) {
      if (!isCurrentProjectContext(context)) return false;
      setFileStatusNotice("页面未能重新加载，请重试");
      reportInternalFailure({
        area: "document",
        operation: "reload",
        code: "source-reload-failed",
        recovered: false,
        cause,
      });
    }
    return false;
  }, [
    captureProjectContext,
    deferEditorCommand,
    isCurrentProjectContext,
    projectLoadError,
    workspaceController,
  ]);
  const reloadFailedCanvas = useCallback(async (): Promise<boolean> => {
    const context = captureProjectContext();
    const controller = workspaceControllerRef.current;
    if (!context || !controller || projectLoadError || persistState === "conflict") {
      return false;
    }
    const outcome = await controller.repairDocumentCanvas({
      context,
      expectedSourceReceipt: currentDocumentSessionSnapshot().sourceReceipt,
    });
    return outcome.status === "succeeded"
      && outcome.value.page.status === "restored"
      && isCurrentProjectContext(context);
  }, [
    captureProjectContext,
    currentDocumentSessionSnapshot,
    isCurrentProjectContext,
    persistState,
    projectLoadError,
  ]);
  useEffect(() => {
    deferredEditorReplayRef.current.reloadCurrentSource = () => {
      void reloadCurrentSource({ fromDeferred: true });
    };
  }, [reloadCurrentSource]);

  const previewExternalSource = useCallback(async () => {
    const context = captureProjectContext();
    if (!context || !workspaceController) return;
    const outcome = await requiredWorkspaceController(workspaceController)
      .previewExternalDocumentSource({ context });
    if (outcome.status !== "succeeded") {
      reportInternalFailure({
        area: "document",
        operation: "external-preview",
        code: "external-source-preview-failed",
        recovered: false,
        cause: outcome.status === "stale" ? "stale" : outcome.reason,
      });
      return;
    }
    setExternalSourcePreview({
      html: String(outcome.value.html || ""),
      sourceSha256: String(outcome.value.sourceSha256 || ""),
      receipt: outcome.value,
    });
    setHandoffPreviewOpen(false);
    setCanvasMode("preview");
  }, [captureProjectContext, workspaceController]);

  const returnToEditingFromExternalPreview = useCallback(() => {
    setExternalSourcePreview(null);
    setCanvasMode("edit");
  }, []);

  const externalPreviewIdentityRef = useRef("");
  useEffect(() => {
    const identity = `${projectId || ""}\0${documentId || ""}\0${sourcePath || ""}`;
    const previous = externalPreviewIdentityRef.current;
    externalPreviewIdentityRef.current = identity;
    if (!previous || previous === identity) return;
    const [previousProjectId, previousDocumentId, previousSourcePath] = previous.split("\0");
    if (
      (previousProjectId && projectId && previousProjectId !== projectId)
      || (previousDocumentId && documentId && previousDocumentId !== documentId)
      || (previousSourcePath && sourcePath && previousSourcePath !== sourcePath)
    ) {
      setExternalSourcePreview(null);
    }
  }, [documentId, projectId, sourcePath]);

  const forceUnlockCurrentSource = useCallback(async () => {
    const context = captureProjectContext();
    if (!context || !workspaceController) return;
    try {
      const controller = requiredWorkspaceController(workspaceController);
      let outcome = await controller.acceptExternalDocumentConflict({
        context,
        intent: { kind: "request" },
      });
      if (outcome.status === "blocked" && outcome.confirmation) {
        if (
          outcome.code !== "DOCUMENT_EXTERNAL_CONFLICT_CONFIRMATION_REQUIRED"
          || !window.confirm("确定要用磁盘上的版本继续吗？未写入的编辑和未完成的 AI 结果都会丢弃，此操作不可撤销。")
        ) return;
        outcome = await controller.acceptExternalDocumentConflict({
          context,
          intent: { kind: "confirm", confirmation: outcome.confirmation },
        });
      }
      if (outcome.status === "stale" || !isCurrentProjectContext(context)) return;
      if (outcome.status !== "succeeded") throw new Error(outcome.reason);
      setExternalSourcePreview(null);
      setCanvasMode("edit");
      setFileStatusNotice(outcome.value.page.status === "restored"
        ? "页面已重新加载，可以继续编辑"
        : "文件已重新读取，但页面暂时无法编辑，请重试");
    } catch (cause) {
      if (!isCurrentProjectContext(context)) return;
      reportInternalFailure({
        area: "document",
        operation: "force-unlock",
        code: "source-force-unlock-failed",
        recovered: false,
        cause,
      });
    }
  }, [
    captureProjectContext,
    isCurrentProjectContext,
    workspaceController,
  ]);

  const acceptExternalSourceFromPreview = useCallback(async () => {
    const context = captureProjectContext();
    const preview = externalSourcePreview;
    if (!context || !preview || !workspaceController) return;
    const outcome = await requiredWorkspaceController(workspaceController)
      .adoptShownExternalDocumentPreview({
        context,
        previewReceipt: preview.receipt,
      });
    if (outcome.status !== "succeeded") {
      if (
        (outcome.status === "blocked" || outcome.status === "rejected")
        && (
          outcome.code === "SOURCE_HASH_CONFLICT"
          || outcome.code === "EXTERNAL_SOURCE_PREVIEW_STALE"
          || outcome.code === "DOCUMENT_SOURCE_PREVIEW_STALE"
        )
        && isCurrentProjectContext(context)
      ) {
        setExternalSourcePreview(null);
        setCanvasMode("edit");
        setFileStatusNotice("磁盘内容在预览后又发生变化，请重新预览。");
      }
      return;
    }
    if (!isCurrentProjectContext(context)) return;
    setExternalSourcePreview(null);
    setCanvasMode("edit");
    setFileStatusNotice(outcome.value.page.status === "restored"
      ? "页面已重新加载，可以继续编辑"
      : "文件已重新读取，但页面暂时无法编辑，请重试");
  }, [
    captureProjectContext,
    externalSourcePreview,
    isCurrentProjectContext,
    workspaceController,
  ]);

  const requestUserFlush = useCallback((fromDeferred = false) => {
    if (interactionLocked) {
      if (runInProgress) {
        setCanvasMode("preview");
        revealAiConversation();
      }
      return;
    }
    if (
      !fromDeferred
      && deferEditorCommand(
        "save",
        () => deferredEditorReplayRef.current.requestUserFlush?.(),
      )
    ) return;
    const committed = editorRef.current?.checkpointNativeTextIntent({
      trigger: "save",
    });
    if (!committed || !committed.ok) {
      editorRef.current?.showCommitBlocked(
        committed?.reason || "请点回文字完成输入，源页会继续自动保存。",
      );
      return;
    }
    void flushAutosave().then(
      () => {
        editorRef.current?.restoreNativeEditFocus();
      },
      () => {
        editorRef.current?.restoreNativeEditFocus();
      },
    );
  }, [
    deferEditorCommand,
    flushAutosave,
    interactionLocked,
    revealAiConversation,
    runInProgress,
  ]);
  useEffect(() => {
    deferredEditorReplayRef.current.requestUserFlush = () => requestUserFlush(true);
  }, [requestUserFlush]);

  const requestSourceHistoryAction = useCallback(async (
    direction: SourceHistoryDirection,
    fromDeferred = false,
  ): Promise<boolean> => {
    if (
      !currentProjectSessionSnapshot().sourcePath
      || currentRunSessionSnapshot().activeLocked
      || projectHydrating
      || projectLoadError
      || isViewTransitioning()
      || viewMode === "history"
      || currentDocumentSessionSnapshot().persistState === "conflict"
      || !workspaceController
    ) return false;
    if (!fromDeferred) {
      let resolveDeferred: ((value: boolean) => void) | null = null;
      const deferred = new Promise<boolean>((resolve) => {
        resolveDeferred = resolve;
      });
      if (deferEditorCommand(
        `source-history:${direction}`,
        () => {
          const replay = deferredEditorReplayRef.current.requestSourceHistoryAction;
          if (!replay) {
            resolveDeferred?.(false);
            return;
          }
          void replay(direction).then((value) => resolveDeferred?.(value));
        },
        undefined,
        { onDiscard: () => resolveDeferred?.(false) },
      )) return deferred;
    }
    const fenced = editorRef.current?.freezeWorkingSource({
      resumeEditing: false,
      preserveForHistory: true,
      trigger: "fence",
    });
    if (!fenced || !fenced.ok) {
      editorRef.current?.showCommitBlocked(
        fenced?.reason || "请先完成当前文字输入，再撤销或重做。",
      );
      return false;
    }
    const context = captureProjectContext();
    if (!context) {
      editorRef.current?.cancelHistoryAction();
      return false;
    }
    const controller = requiredWorkspaceController(workspaceController);
    const outcome = await controller.performDocumentHistoryAction({ direction, context });
    if (outcome.status === "succeeded") return true;
    editorRef.current?.cancelHistoryAction({
      restore: outcome.status !== "stale",
    });
    if (outcome.status !== "stale") {
      reportInternalFailure({
        area: "history",
        operation: direction,
        code: "source-history-failed",
        recovered: false,
        cause: outcome.reason,
      });
    }
    return false;
  }, [
    captureProjectContext,
    currentDocumentSessionSnapshot,
    currentProjectSessionSnapshot,
    currentRunSessionSnapshot,
    deferEditorCommand,
    isViewTransitioning,
    projectHydrating,
    projectLoadError,
    viewMode,
    workspaceController,
  ]);
  useEffect(() => {
    deferredEditorReplayRef.current.requestSourceHistoryAction = (
      direction,
    ) => requestSourceHistoryAction(direction, true);
  }, [requestSourceHistoryAction]);

  useEffect(() => {
    const editApi = window.stemmioEdit;
    if (!editApi) return undefined;
    return editApi.onHistoryRequested((direction) => {
      if (ownsNativeTextHistory(document.activeElement)) {
        void editApi.runNativeHistory(direction);
        return;
      }
      void requestSourceHistoryAction(direction);
    });
  }, [requestSourceHistoryAction]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      const key = event.key.toLowerCase();
      if (key === "z" || (key === "y" && event.ctrlKey && !event.metaKey)) {
        const target = event.target as HTMLElement | null;
        if (ownsNativeTextHistory(target)) return;
        event.preventDefault();
        void requestSourceHistoryAction(
          key === "y" || event.shiftKey ? "redo" : "undo",
        );
        return;
      }
      if (event.key.toLowerCase() === "e" && event.shiftKey) {
        event.preventDefault();
        void exportCurrentHtml();
      } else if (event.key.toLowerCase() === "s" && !event.shiftKey) {
        event.preventDefault();
        requestUserFlush();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [exportCurrentHtml, requestSourceHistoryAction, requestUserFlush]);

  const updateFocusedComment = useCallback((commentId: string | null) => {
    commentCanvasPort.setFocusedCommentId(commentId);
  }, [commentCanvasPort]);

  const queueReviewPairReveal = useCallback((
    target: HtmlCanvasSelection,
    itemKey: string,
  ) => {
    const sourceTarget = target.commentAnchor ?? target;
    const visualHint = commentVisualHintForSelection(target);
    commentCanvasPort.requestReveal(
      visualHint ? { ...sourceTarget, visualHint } : sourceTarget,
      itemKey,
    );
  }, [commentCanvasPort]);

  const requestComposerFocus = useCallback(() => {
    commentCanvasPort.requestComposerFocus();
  }, [commentCanvasPort]);

  const beginTargetRelink = useCallback((itemId: string) => {
    const currentComments = currentCommentSessionSnapshot();
    commentCanvasPort.beginRelink(itemId);
    if (!commentEditSessionHasChanges(currentComments.editSession)) {
      workspaceControllerRef.current?.clearCommentEdit();
      commentEditResumePendingRef.current = null;
    }
    editorRef.current?.clearSelection();
    commentCanvasPort.setSelection(null);
    if (itemId !== "__composer") {
      updateFocusedComment(itemId);
      const comment = currentComments.comments.find(
        (item) => item.commentId === itemId,
      );
      if (comment) queueReviewPairReveal(commentVisualTarget(comment), itemId);
    }
  }, [
    commentCanvasPort,
    currentCommentSessionSnapshot,
    queueReviewPairReveal,
    updateFocusedComment,
  ]);

  const finishTargetRelink = useCallback((target: HtmlCanvasSelection): boolean => {
    const controller = workspaceControllerRef.current;
    const currentComments = currentCommentSessionSnapshot();
    const presentation = commentCanvasPort.getSnapshot();
    const relinkingId = presentation.relinkingTarget;
    if (
      !relinkingId
      || !presentation.relinkSelectionArmed
      || !canSaveCommentTarget(target)
    ) return false;
    if (relinkingId !== "__composer") {
      commentCanvasPort.clearRelink();
      return false;
    }
    const currentTarget = currentComments.composerTarget;
    const nextTarget = currentTarget
      ? { ...target, id: currentTarget.id }
      : target;
    controller?.rebindCommentComposer(nextTarget);
    commentCanvasPort.setSelection(nextTarget);
    commentCanvasPort.clearRelink();
    commentCanvasPort.setComposerOpen(true);
    queueReviewPairReveal(nextTarget, "__composer");
    requestComposerFocus();
    return true;
  }, [
    commentCanvasPort,
    currentCommentSessionSnapshot,
    queueReviewPairReveal,
    requestComposerFocus,
  ]);

  const cancelTargetRelink = useCallback(() => {
    const relinkingId = commentCanvasPort.getSnapshot().relinkingTarget;
    commentCanvasPort.clearRelink();
    if (relinkingId === "__composer") {
      requestComposerFocus();
    }
  }, [commentCanvasPort, requestComposerFocus]);

  const clearCurrentComposer = useCallback(() => {
    workspaceControllerRef.current?.cancelCommentComposer();
    commentCanvasPort.setComposerOpen(false);
    updateFocusedComment(null);
  }, [commentCanvasPort, updateFocusedComment]);

  const resumeCurrentComposer = useCallback(() => {
    const target = currentCommentSessionSnapshot().composerTarget;
    if (!target) return;
    if (!canSaveCommentTarget(target)) {
      beginTargetRelink("__composer");
      return;
    }
    const sourceTarget = target.commentAnchor ?? target;
    const visualHint = commentVisualHintForSelection(target);
    const located = editorRef.current?.select(sourceTarget, {
      showToolbar: false,
      ...(visualHint ? { visualHint } : {}),
    });
    const nextTarget = located || target;
    workspaceControllerRef.current?.rebindCommentComposer(nextTarget);
    commentCanvasPort.setSelection(nextTarget);
    updateFocusedComment(null);
    commentCanvasPort.setComposerOpen(true);
    queueReviewPairReveal(nextTarget, "__composer");
    requestComposerFocus();
  }, [
    beginTargetRelink,
    commentCanvasPort,
    currentCommentSessionSnapshot,
    queueReviewPairReveal,
    requestComposerFocus,
    updateFocusedComment,
  ]);

  const showUnfinishedCommentEditNotice = useCallback((
    session: CommentEditSession,
  ) => {
    setCanvasMode("edit");
    window.requestAnimationFrame(() => {
      resumeCommentEditRef.current(session.commentId);
    });
  }, []);

  const openCommentComposer = useCallback((target: HtmlCanvasSelection) => {
    const controller = workspaceControllerRef.current;
    const currentRun = currentRunSessionSnapshot();
    const currentDocument = currentDocumentSessionSnapshot();
    const currentComments = currentCommentSessionSnapshot();
    if (!controller) return;
    if (commentCanvasPort.getSnapshot().relinkingTarget && finishTargetRelink(target)) return;
    if (attachmentUploadCount > 0) return;
    if (
      currentRun.activeLocked
      || projectHydrating
      || projectLoadError
      || isViewTransitioning()
      || currentDocument.persistState === "conflict"
      || viewMode === "history"
    ) return;
    if (!canSaveCommentTarget(target)) {
      if (!currentComments.composerTarget) {
        const nextCommentId = recordId("comment", commentCounter.current++);
        controller.beginCommentComposer({ target, commentId: nextCommentId });
      }
      beginTargetRelink("__composer");
      return;
    }
    const currentEdit = currentComments.editSession;
    if (currentEdit && commentEditSessionHasChanges(currentEdit)) {
      showUnfinishedCommentEditNotice(currentEdit);
      return;
    }
    if (currentEdit) {
      controller.clearCommentEdit();
      commentEditResumePendingRef.current = null;
      commentCanvasPort.setEditingCommentId(null);
    }
    // Project identity starts at file open. Recheck here to serialize a
    // just-opened composer with any still-pending registration.
    void prepareProjectRecords();
    const recoveredDraftTarget = currentComments.composerTarget;
    if (
      recoveredDraftTarget
      && recoveredDraftTarget.id !== target.id
      && (
        currentComments.composerDraft.trim()
        || currentComments.composerAttachments.length > 0
      )
    ) {
      resumeCurrentComposer();
      return;
    }
    commentCanvasPort.setSelection(target);
    const resumesRecoveredDraft = currentComments.composerTarget?.id === target.id;
    if (!resumesRecoveredDraft) {
      const nextCommentId = recordId("comment", commentCounter.current++);
      controller.beginCommentComposer({
        target,
        commentId: nextCommentId,
      });
    } else if (!currentComments.composerCommentId) {
      const nextCommentId = recordId("comment", commentCounter.current++);
      controller.beginCommentComposer({
        target,
        commentId: nextCommentId,
        resume: true,
      });
    } else {
      controller.rebindCommentComposer(target);
    }
    updateFocusedComment(null);
    commentCanvasPort.setComposerOpen(true);
    queueReviewPairReveal(target, "__composer");
    requestComposerFocus();
  }, [
    attachmentUploadCount,
    commentCanvasPort,
    currentCommentSessionSnapshot,
    currentDocumentSessionSnapshot,
    currentRunSessionSnapshot,
    finishTargetRelink,
    isViewTransitioning,
    prepareProjectRecords,
    projectHydrating,
    projectLoadError,
    queueReviewPairReveal,
    requestComposerFocus,
    resumeCurrentComposer,
    showUnfinishedCommentEditNotice,
    updateFocusedComment,
    viewMode,
    beginTargetRelink,
  ]);

  const openGlobalCommentComposer = useCallback(() => {
    if (interactionLocked) {
      if (runInProgress) {
        setCanvasMode("preview");
        revealAiConversation();
      }
      return;
    }
    setCanvasMode("edit");
    const globalTarget = globalPageCommentTargetFromHtml(
      currentDocumentSessionSnapshot().html,
    );
    if (!globalTarget) return;
    const wasRelinking = Boolean(commentCanvasPort.getSnapshot().relinkingTarget);
    editorRef.current?.clearSelection();
    commentCanvasPort.setSelection(null);
    if (wasRelinking) {
      commentCanvasPort.armRelinkSelection();
      finishTargetRelink(globalTarget);
      return;
    }
    openCommentComposer(globalTarget);
  }, [
    commentCanvasPort,
    currentDocumentSessionSnapshot,
    finishTargetRelink,
    interactionLocked,
    openCommentComposer,
    revealAiConversation,
    runInProgress,
  ]);

  const closeCommentComposer = useCallback(() => {
    if (attachmentUploadCount > 0) return;
    const currentComments = currentCommentSessionSnapshot();
    if (
      currentComments.composerDraft.trim()
      || currentComments.composerAttachments.length > 0
    ) {
      commentCanvasPort.setComposerOpen(false);
      updateFocusedComment(null);
      return;
    }
    clearCurrentComposer();
  }, [
    attachmentUploadCount,
    clearCurrentComposer,
    commentCanvasPort,
    currentCommentSessionSnapshot,
    updateFocusedComment,
  ]);

  const discardCurrentComposer = useCallback(() => {
    if (attachmentUploadCount > 0) return;
    const outcome = workspaceController?.discardCommentComposer();
    if (outcome?.status !== "succeeded") return;
    if (commentCanvasPort.getSnapshot().relinkingTarget === "__composer") {
      commentCanvasPort.clearRelink();
    }
    commentCanvasPort.setComposerOpen(false);
    updateFocusedComment(null);
    const discardedAttachments = (
      outcome.value as { attachments?: CommentAttachment[] }
    ).attachments ?? [];
    for (const attachment of discardedAttachments) {
      forgetAttachmentObjectUrl(attachment.attachmentId);
    }
  }, [
    attachmentUploadCount,
    commentCanvasPort,
    forgetAttachmentObjectUrl,
    updateFocusedComment,
    workspaceController,
  ]);

  const addComment = useCallback(async () => {
    const currentRun = currentRunSessionSnapshot();
    const currentDocument = currentDocumentSessionSnapshot();
    const currentComments = currentCommentSessionSnapshot();
    const currentDraftTarget = currentComments.composerTarget;
    const currentDraft = currentComments.composerDraft;
    const currentDraftAttachments = currentComments.composerAttachments;
    const currentAttachmentUploadCount = workspaceController
      ?.comments.getSnapshot().persistence?.attachmentUploadCount ?? 0;
    if (
      currentRun.activeLocked
      || projectHydrating
      || projectLoadError
      || isViewTransitioning()
      || currentDocument.persistState === "conflict"
      || viewMode === "history"
    ) return;
    if (!currentDraftTarget) {
      editorRef.current?.clearSelection();
      return;
    }
    if (!canSaveCommentTarget(currentDraftTarget)) {
      beginTargetRelink("__composer");
      return;
    }
    if (!currentDraft.trim() && currentDraftAttachments.length === 0) {
      requestComposerFocus();
      return;
    }
    if (currentAttachmentUploadCount > 0) return;
    const checkpoint = editorRef.current?.checkpointNativeTextIntent({
      trigger: "comment",
    });
    if (checkpoint && !checkpoint.ok) {
      editorRef.current?.showCommitBlocked(
        checkpoint.reason || "请完成当前文字输入，再保存评论。",
      );
      return;
    }
    // Opening an external HTML can start project registration just before the
    // composer is submitted. Await that same registration boundary here so a
    // slow desktop cannot turn a valid composer into a stale-context no-op.
    await prepareProjectRecords();
    const commentId = currentComments.composerCommentId
      || recordId("comment", commentCounter.current++);
    const outcome = await requiredWorkspaceController(workspaceController)
      .commitComment({ commentId });
    if (outcome.status !== "succeeded") {
      if (outcome.status === "stale") return;
      requestComposerFocus();
      return;
    }
    const comment = (outcome.value as { comment: CommentItem }).comment;
    commentCanvasPort.setComposerOpen(false);
    updateFocusedComment(comment.commentId);
    queueReviewPairReveal(commentVisualTarget(comment), comment.commentId);
    captureUsageEvent("comment_saved", {
      target_level: comment.sourceAnchor.level === "insertion"
        ? "insertion"
        : comment.sourceAnchor.level === "part" ? "part" : "module",
      has_text: Boolean(comment.text),
      attachment_count: countBucket((comment.attachments ?? []).length),
      has_image: (comment.attachments ?? []).some((attachment) => attachment.kind === "image"),
      has_file: (comment.attachments ?? []).some((attachment) => attachment.kind === "file"),
    }, currentProjectSessionSnapshot().projectId || undefined);
  }, [
    currentCommentSessionSnapshot,
    currentDocumentSessionSnapshot,
    currentProjectSessionSnapshot,
    currentRunSessionSnapshot,
    isViewTransitioning,
    projectHydrating,
    projectLoadError,
    queueReviewPairReveal,
    requestComposerFocus,
    updateFocusedComment,
    viewMode,
    workspaceController,
    beginTargetRelink,
    commentCanvasPort,
    prepareProjectRecords,
  ]);

  const queueReviewCommentFocus = useCallback((
    target: HtmlCanvasSelection,
    commentId: string,
  ) => {
    updateFocusedComment(commentId);
    queueReviewPairReveal(target, commentId);
  }, [queueReviewPairReveal, updateFocusedComment]);

  const beginCommentEdit = useCallback((
    comment: CommentItem,
    focusText = true,
  ): boolean => {
    const controller = workspaceControllerRef.current;
    const currentComments = currentCommentSessionSnapshot();
    if (!controller) return false;
    if (
      currentComments.composerTarget
      && (
        currentComments.composerDraft.trim()
        || currentComments.composerAttachments.length > 0
      )
    ) {
      resumeCurrentComposer();
      return false;
    }
    if (currentComments.composerTarget) clearCurrentComposer();
    const currentSession = currentComments.editSession;
    if (
      currentSession
      && currentSession.commentId !== comment.commentId
      && commentEditSessionHasChanges(currentSession)
    ) {
      showUnfinishedCommentEditNotice(currentSession);
      return false;
    }
    const outcome = controller.beginCommentEdit({ commentId: comment.commentId });
    if (outcome.status !== "succeeded") return false;
    const nextSession = (outcome.value as { session: CommentEditSession }).session;
    // Move focus first. The presentation port is observed synchronously, so
    // publishing `editingCommentId` while the previously focused card is still
    // current can make the clean-edit guard retire this brand-new session.
    queueReviewCommentFocus(commentVisualTarget(comment), comment.commentId);
    commentCanvasPort.setEditingCommentId(comment.commentId);
    if (focusText) {
      commentCanvasPort.requestCommentEditFocus(
        comment.commentId,
        !commentEditSessionHasChanges(nextSession),
      );
    }
    return true;
  }, [
    clearCurrentComposer,
    commentCanvasPort,
    currentCommentSessionSnapshot,
    queueReviewCommentFocus,
    resumeCurrentComposer,
    showUnfinishedCommentEditNotice,
  ]);

  const cancelCommentEdit = useCallback((revealComment = true) => {
    if (attachmentUploadCount > 0) return;
    const currentComments = currentCommentSessionSnapshot();
    const session = currentComments.editSession;
    const current = currentComments.comments.find(
      (comment) => comment.commentId === session?.commentId,
    );
    const outcome = workspaceController?.cancelCommentEdit({
      commentId: session?.commentId,
    });
    if (outcome?.status !== "succeeded") return;
    commentEditResumePendingRef.current = null;
    commentCanvasPort.setEditingCommentId(null);
    const stagedAttachments = (
      outcome.value as { stagedAttachments?: CommentAttachment[] }
    ).stagedAttachments ?? [];
    for (const attachment of stagedAttachments) {
      forgetAttachmentObjectUrl(attachment.attachmentId);
    }
    if (revealComment && current) {
      queueReviewCommentFocus(commentVisualTarget(current), current.commentId);
    }
  }, [
    attachmentUploadCount,
    commentCanvasPort,
    currentCommentSessionSnapshot,
    forgetAttachmentObjectUrl,
    queueReviewCommentFocus,
    workspaceController,
  ]);

  const resumeCommentEdit = useCallback((commentId?: string) => {
    const controller = workspaceControllerRef.current;
    const currentComments = currentCommentSessionSnapshot();
    const session = currentComments.editSession;
    if (!session || (commentId && session.commentId !== commentId)) return;
    const current = currentComments.comments.find(
      (comment) => comment.commentId === session.commentId,
    );
    if (!current) {
      controller?.clearCommentEdit();
      commentEditResumePendingRef.current = null;
      commentCanvasPort.setEditingCommentId(null);
      return;
    }
    const located = editorRef.current?.select(
      commentVisualTarget(current),
      { showToolbar: false },
    );
    const nextTarget = located || commentVisualTarget(current);
    commentCanvasPort.setSelection(nextTarget);
    const targetLayouts = commentCanvasPort.getSnapshot().targetLayouts;
    const targetVisible = (
      current.sourceAnchor.tagName === "body"
      || targetLayouts[current.sourceAnchor.id]?.status === "visible"
    );
    commentEditResumePendingRef.current = targetVisible
      ? null
      : current.commentId;
    queueReviewCommentFocus(nextTarget, current.commentId);
    if (targetVisible) commentCanvasPort.setEditingCommentId(current.commentId);
    if (targetVisible) {
      commentCanvasPort.requestCommentEditFocus(current.commentId);
    }
  }, [
    commentCanvasPort,
    currentCommentSessionSnapshot,
    queueReviewCommentFocus,
  ]);
  useEffect(() => {
    resumeCommentEditRef.current = resumeCommentEdit;
  }, [resumeCommentEdit]);

  const updateCommentEditDraft = useCallback((draftText: string) => {
    if (!currentCommentSessionSnapshot().editSession) return;
    workspaceControllerRef.current?.updateCommentEditDraft(draftText);
  }, [currentCommentSessionSnapshot]);

  const confirmCommentEdit = useCallback((commentId: string) => {
    const currentComments = currentCommentSessionSnapshot();
    const current = currentComments.comments.find((comment) => comment.commentId === commentId);
    const session = currentComments.editSession;
    if (!current || !session || session.commentId !== commentId) {
      cancelCommentEdit();
      return;
    }
    if (attachmentUploadCount > 0) return;
    const outcome = workspaceController?.confirmCommentEdit({ commentId });
    if (outcome?.status !== "succeeded") return;
    commentEditResumePendingRef.current = null;
    commentCanvasPort.setEditingCommentId(null);
    const removedAttachments = (
      outcome.value as { removedAttachments?: CommentAttachment[] }
    ).removedAttachments ?? [];
    for (const attachment of removedAttachments) {
      forgetAttachmentObjectUrl(attachment.attachmentId);
    }
    queueReviewCommentFocus(commentVisualTarget(current), current.commentId);
  }, [
    attachmentUploadCount,
    cancelCommentEdit,
    commentCanvasPort,
    currentCommentSessionSnapshot,
    forgetAttachmentObjectUrl,
    queueReviewCommentFocus,
    workspaceController,
  ]);

  const deleteComment = useCallback((commentId: string) => {
    const outcome = workspaceController?.deleteComment({ commentId });
    if (outcome?.status !== "succeeded") return;
    const { deleted, editSession, attachments = [] } = outcome.value as {
      deleted?: CommentItem | null;
      editSession?: CommentEditSession | null;
      attachments?: CommentAttachment[];
    };
    if (editSession) {
      commentEditResumePendingRef.current = null;
      commentCanvasPort.setEditingCommentId(null);
    }
    for (const attachment of attachments) {
      forgetAttachmentObjectUrl(attachment.attachmentId);
    }
    if (deleted) {
      updateFocusedComment(null);
      queueReviewPairReveal(commentVisualTarget(deleted), "");
    }
  }, [
    commentCanvasPort,
    forgetAttachmentObjectUrl,
    queueReviewPairReveal,
    updateFocusedComment,
    workspaceController,
  ]);

  useEffect(() => {
    const currentComments = currentCommentSessionSnapshot();
    const session = currentComments.editSession;
    if (!session) return;
    const editedComment = currentComments.comments.find(
      (comment) => comment.commentId === session.commentId,
    );
    if (!editedComment) {
      workspaceControllerRef.current?.clearCommentEdit();
      commentEditResumePendingRef.current = null;
      const frame = window.requestAnimationFrame(() => {
        commentCanvasPort.setEditingCommentId(null);
      });
      return () => window.cancelAnimationFrame(frame);
    }
    const targetStatus = commentCanvasPort.getSnapshot()
      .targetLayouts[editedComment.sourceAnchor.id]?.status;
    const presentation = commentCanvasPort.getSnapshot();
    const leftEditingContext = (
      canvasMode !== "edit"
      || targetStatus === "hidden"
      || (
        Boolean(presentation.focusedCommentId)
        && presentation.focusedCommentId !== session.commentId
      )
    );
    if (!leftEditingContext) return;
    if (!commentEditSessionHasChanges(session)) {
      const frame = window.requestAnimationFrame(() => {
        cancelCommentEdit(false);
      });
      return () => window.cancelAnimationFrame(frame);
    }
    if (presentation.editingCommentId === session.commentId) {
      const frame = window.requestAnimationFrame(() => {
        commentCanvasPort.setEditingCommentId(null);
      });
      return () => window.cancelAnimationFrame(frame);
    }
  }, [
    cancelCommentEdit,
    canvasMode,
    commentCanvasPort,
    commentEditSession,
    currentCommentSessionSnapshot,
  ]);

  useEffect(() => {
    const pendingId = commentEditResumePendingRef.current;
    const currentComments = currentCommentSessionSnapshot();
    const session = currentComments.editSession;
    if (
      canvasMode !== "edit"
      || !pendingId
      || !session
      || session.commentId !== pendingId
    ) return;
    const current = currentComments.comments.find(
      (comment) => comment.commentId === pendingId,
    );
    if (!current) {
      commentEditResumePendingRef.current = null;
      return;
    }
    const targetVisible = (
      current.sourceAnchor.tagName === "body"
      || commentCanvasPort.getSnapshot().targetLayouts[current.sourceAnchor.id]?.status === "visible"
    );
    if (!targetVisible) return;
    commentEditResumePendingRef.current = null;
    commentCanvasPort.setEditingCommentId(current.commentId);
    queueReviewCommentFocus(commentVisualTarget(current), current.commentId);
    commentCanvasPort.requestCommentEditFocus(current.commentId);
  }, [
    canvasMode,
    commentCanvasPort,
    commentEditSession,
    currentCommentSessionSnapshot,
    queueReviewCommentFocus,
  ]);

  useEffect(() => commentCanvasPort.subscribe(() => {
    if (canvasMode !== "edit") return;
    const currentComments = currentCommentSessionSnapshot();
    const session = currentComments.editSession;
    if (!session) return;
    const current = currentComments.comments.find(
      (comment) => comment.commentId === session.commentId,
    );
    if (!current) return;
    const presentation = commentCanvasPort.getSnapshot();
    const targetStatus = presentation.targetLayouts[current.sourceAnchor.id]?.status;
    const pendingId = commentEditResumePendingRef.current;
    if (
      pendingId === session.commentId
      && (current.sourceAnchor.tagName === "body" || targetStatus === "visible")
    ) {
      commentEditResumePendingRef.current = null;
      commentCanvasPort.setEditingCommentId(current.commentId);
      queueReviewCommentFocus(commentVisualTarget(current), current.commentId);
      commentCanvasPort.requestCommentEditFocus(current.commentId);
      return;
    }
    const leftFocusedComment = Boolean(
      presentation.focusedCommentId
      && presentation.focusedCommentId !== session.commentId
    );
    if (
      presentation.editingCommentId !== session.commentId
      || (targetStatus !== "hidden" && !leftFocusedComment)
    ) return;
    if (!commentEditSessionHasChanges(session)) {
      window.requestAnimationFrame(() => cancelCommentEdit(false));
    } else {
      window.requestAnimationFrame(() => commentCanvasPort.setEditingCommentId(null));
    }
  }), [
    cancelCommentEdit,
    canvasMode,
    commentCanvasPort,
    currentCommentSessionSnapshot,
    queueReviewCommentFocus,
  ]);

  const focusCommentTarget = useCallback((
    target: HtmlCanvasSelection,
    commentId: string,
  ) => {
    const sourceTarget = target.commentAnchor ?? target;
    const visualHint = commentVisualHintForSelection(target);
    if (!canLocateTarget(sourceTarget)) {
      commentCanvasPort.setSelection(target);
      updateFocusedComment(commentId);
      queueReviewPairReveal(target, commentId);
      return;
    }
    updateFocusedComment(commentId);
    const located = editorRef.current?.select(sourceTarget, {
      showToolbar: false,
      ...(visualHint ? { visualHint } : {}),
    });
    const nextTarget = located || target;
    commentCanvasPort.setSelection(nextTarget);
    queueReviewPairReveal(nextTarget, commentId);
  }, [commentCanvasPort, queueReviewPairReveal, updateFocusedComment]);

  const handleCanvasSelection = useCallback((target: HtmlCanvasSelection | null) => {
    commentCanvasPort.resetRail();
    commentCanvasPort.setSelection(target);
    const currentComposerOpen = commentCanvasPort.getSnapshot().composerOpen;
    if (!target) {
      if (!currentComposerOpen) updateFocusedComment(null);
      return;
    }
    if (finishTargetRelink(target)) return;
    if (currentComposerOpen || viewMode === "history") return;
    const sourceTarget = target.commentAnchor ?? target;
    const visualHint = commentVisualHintForSelection(target);
    const matchesTarget = (comment: CommentItem) => {
      const commentAnchor = comment.sourceAnchor;
      const sourceMatches = Boolean(
        commentAnchor.elementId
        && sourceTarget.elementId
        && commentAnchor.elementId === sourceTarget.elementId,
      );
      if (!sourceMatches) return false;
      const commentHint = comment.visualHint;
      if (!visualHint || !commentHint) return !visualHint && !commentHint;
      return visualHint.kind === commentHint.kind
        && visualHint.relativePath === commentHint.relativePath;
    };
    const currentFocusedId = commentCanvasPort.getSnapshot().focusedCommentId;
    const focusedMatch = visibleCommentItems.find(
      (comment) => comment.commentId === currentFocusedId && matchesTarget(comment),
    );
    const nextComment = focusedMatch || visibleCommentItems.find(matchesTarget);
    if (!nextComment || !canLocateTarget(nextComment.sourceAnchor)) {
      updateFocusedComment(null);
      return;
    }
    // A direct Canvas click already happened at the user's current viewport.
    // Highlight its paired comment without moving the shared Canvas/rail scroll.
    // Explicit navigation from a comment card still reveals its Canvas target.
    updateFocusedComment(nextComment.commentId);
  }, [
    commentCanvasPort,
    finishTargetRelink,
    updateFocusedComment,
    viewMode,
    visibleCommentItems,
  ]);

  const revealAiTaskInFinder = useCallback(async () => {
    const activeSourcePath = currentProjectSessionSnapshot().sourcePath;
    const revealAiTask = window.stemmioProjects?.revealAiTask;
    if (!activeSourcePath || !revealAiTask) return;
    await runLocalUserAction({
      kind: "reveal-ai-task",
      invoke: () => revealAiTask({ sourcePath: activeSourcePath }),
      onFailure: (cause: unknown) => reportInternalFailure({
        area: "runs",
        operation: "reveal-ai-task",
        code: "reveal-ai-task-failed",
        recovered: false,
        cause,
      }),
    });
  }, [currentProjectSessionSnapshot]);

  const generateRequest = useCallback(async (
    deliveryMode: AgentDeliveryMode, fromDeferred = false,
  ) => {
    const presentRunSubmissionFailure = (outcome: { code: string; reason: string }) => {
      if (outcome.code === "RUN_SUBMISSION_COMMENT_DRAFT") {
        setCanvasMode("edit");
        resumeCurrentComposer();
        return;
      }
      if (outcome.code === "RUN_SUBMISSION_COMMENT_EDIT") {
        const currentEdit = currentCommentSessionSnapshot().editSession;
        if (currentEdit) showUnfinishedCommentEditNotice(currentEdit);
        return;
      }
      if (outcome.code === "RUN_SUBMISSION_COMMENTS_EMPTY") {
        requestComposerFocus();
        return;
      }
      if (outcome.code === "RUN_SUBMISSION_TARGET_UNSAFE") {
        const unsafeTargets = unsafeRelinkComments(
          currentCommentSessionSnapshot().comments,
        );
        setCanvasMode("edit");
        const firstUnsafe = unsafeTargets[0];
        if (firstUnsafe) {
          updateFocusedComment(firstUnsafe.commentId);
          queueReviewPairReveal(commentVisualTarget(firstUnsafe), firstUnsafe.commentId);
        }
        return;
      }
      if (
        outcome.code === "RUN_SUBMISSION_NATIVE_EDIT"
        || outcome.code === "RUN_SUBMISSION_FREEZE"
        || outcome.code === "RUN_AGENT_ATTACHMENT_UNSUPPORTED"
      ) {
        editorRef.current?.showCommitBlocked(outcome.reason);
        if (outcome.code === "RUN_AGENT_ATTACHMENT_UNSUPPORTED") revealAiConversation();
        return;
      }
      if (outcome.code === "RUN_SUBMISSION_LOCKED") {
        setCanvasMode("preview");
        revealAiConversation();
        return;
      }
      if (outcome.code === "RUN_SUBMISSION_DOCUMENT_EDIT") {
        reportInternalFailure({
          area: "history",
          operation: "record-submit",
          code: "source-history-record-failed",
          recovered: false,
          cause: outcome.reason,
        });
        return;
      }
      if (
        deliveryMode === "managed-agent"
        && workspaceControllerRef.current
          ?.getSnapshot().run?.qoderAvailability.status !== "ready"
      ) return;
      reportInternalFailure({
        area: "runs",
        operation: "submit",
        code: outcome.code,
        recovered: false,
        cause: outcome.reason,
      });
    };
    if (!fromDeferred) deferredEditorReplayRef.current.agentDeliveryMode = deliveryMode;
    const currentRun = currentRunSessionSnapshot();
    const currentProject = currentProjectSessionSnapshot();
    const currentDocument = currentDocumentSessionSnapshot();
    if (currentRun.submissionPending) return;
    const submissionSourcePath = currentProject.sourcePath;
    if (!submissionSourcePath) {
      if (typeof window !== "undefined" && !window.stemmioProjects) return;
      void openProject();
      return;
    }
    if (
      !workspaceController
      || projectHydrating
      || projectLoadError
      || isViewTransitioning()
      || viewMode === "history"
      || currentDocument.persistState === "failed"
      || currentDocument.persistState === "conflict"
    ) return;
    if (currentRun.activeLocked) {
      presentRunSubmissionFailure({ code: "RUN_SUBMISSION_LOCKED", reason: "当前项目正在处理上一轮要求。" });
      return;
    }
    const submissionPlan = workspaceController.planRunSubmission();
    if (
      submissionPlan.kind === "reject"
      && ["RUN_SUBMISSION_COMMENT_DRAFT", "RUN_SUBMISSION_COMMENT_EDIT"]
        .includes(submissionPlan.code)
    ) {
      presentRunSubmissionFailure(submissionPlan);
      return;
    }
    if (
      !fromDeferred
      && deferEditorCommand(
        "ai-handoff",
        () => deferredEditorReplayRef.current.generateRequest?.(),
      )
    ) return;

    const outcome = await requiredWorkspaceController(workspaceController)
      .submitRequest({
        projectName,
        previousVersionId: latestVersionId,
        basedOnVersionId: currentBasedOnVersionId,
        deadlineAt: Date.now() + 60_000,
        deliveryMode,
      });
    if (outcome.status === "succeeded" || outcome.status === "stale") return outcome;
    if (outcome.status === "unknown") {
      setCanvasMode("preview");
      revealAiConversation();
      return outcome;
    }
    presentRunSubmissionFailure(outcome);
    return outcome;
  }, [
    currentBasedOnVersionId,
    currentCommentSessionSnapshot,
    currentDocumentSessionSnapshot,
    currentProjectSessionSnapshot,
    currentRunSessionSnapshot,
    deferEditorCommand,
    latestVersionId,
    openProject,
    revealAiConversation,
    isViewTransitioning,
    projectHydrating,
    projectLoadError,
    projectName,
    queueReviewPairReveal,
    requestComposerFocus,
    resumeCurrentComposer,
    showUnfinishedCommentEditNotice,
    updateFocusedComment,
    viewMode,
    workspaceController,
  ]);
  const checkAgentUsability = useCallback(async (selection?: AgentSelection) => (
    workspaceController?.checkAgentUsability(selection) ?? null
  ), [workspaceController]);
  const copyAgentGuidance = useCallback(async (kind: "install" | "login", selection?: AgentSelection) => (
    workspaceController?.copyAgentGuidance({ kind, selection }) ?? null
  ), [workspaceController]);
  const startAgentLogin = useCallback(async (selection?: AgentSelection | null) => {
    return workspaceController?.startAgentLogin(selection) ?? null;
  }, [workspaceController]);
  const reopenAgentLogin = useCallback(async (selection?: AgentSelection | null) => (
    workspaceController?.reopenAgentLogin(selection) ?? null
  ), [workspaceController]);
  const installAgent = useCallback(async (selection?: AgentSelection | null) => (
    workspaceController?.installAgent(selection) ?? null
  ), [workspaceController]);
  const cancelAgentInstall = useCallback(async (selection?: AgentSelection | null) => (
    workspaceController?.cancelAgentInstall(selection) ?? null
  ), [workspaceController]);
  const connectAgentApiKey = useCallback(async (
    selection: AgentSelection,
    apiKey: string,
    extras?: Readonly<{
      vendorId?: string;
      baseUrl?: string;
      modelId?: string;
      remember?: boolean;
    }>,
  ) => workspaceController?.connectAgentApiKey(selection, apiKey, extras) ?? null,
  [workspaceController]);
  const openVendorApiKeyPage = useCallback(async (vendorId: string) => {
    try {
      const result = await window.stemmioIntegrations?.openVendorApiKeyPage?.(vendorId);
      return isVendorApiKeyPageOpened(result)
        ? { status: "succeeded" }
        : { status: "rejected", reason: "无法打开获取 API Key 页面。" };
    } catch (cause) {
      return {
        status: "rejected",
        reason: productErrorMessage(cause, "无法打开获取 API Key 页面。"),
      };
    }
  }, []);
  const disconnectAgentApiKey = useCallback(async (selection: AgentSelection) => (
    workspaceController?.disconnectAgentApiKey(selection) ?? null
  ), [workspaceController]);
  const selectSettingsAgentModel = useCallback((modelId: string, expectedSelection: AgentSelection) => (
    workspaceController?.selectAgentModel(modelId, expectedSelection) ?? null
  ), [workspaceController]);
  const selectSettingsAgentReasoning = useCallback((reasoning: string, expectedSelection: AgentSelection) => (
    workspaceController?.selectAgentReasoning(reasoning, expectedSelection) ?? null
  ), [workspaceController]);
  useEffect(() => {
    deferredEditorReplayRef.current.generateRequest = () => {
      void generateRequest(deferredEditorReplayRef.current.agentDeliveryMode, true);
    };
  }, [generateRequest]);

  // Published for the conversation, which is constructed above this declaration and
  // therefore cannot name it directly.
  useEffect(() => {
    generateRequestRef.current = (mode: AgentDeliveryMode) => {
      void generateRequest(mode);
    };
  }, [generateRequest]);

  const activateReadyResult = useCallback(async (
    { reviewed = false }: { reviewed?: boolean } = {},
  ) => {
    const run = activeRun;
    if (
      !run
      || !workspaceController
      || !runCapability
      || run.status !== "ready-to-open"
      || !run.readyPayload
      || (
        run.candidateAssessment?.status === "attention"
        && !reviewed
      )
    ) return;
    const operationKey = activeRunOperationKey(run);
    performance.mark("stemmio:accept:start");
    setOpeningReadyVersion(true);
    try {
      const outcome = await runCapability.commands.activateReadyVersion({
          run,
          reviewLease: readyReviewSession?.operationKey === operationKey
            ? {
                operationKey: readyReviewSession.operationKey,
                beforeHtml: readyReviewSession.beforeHtml,
              }
            : null,
        });
      performance.mark("stemmio:accept:activated");
      if (outcome.status !== "succeeded") {
        if (outcome.status !== "stale" && outcome.status !== "unknown") {
          const published = readyVersionPublicationMatches(workspaceController, run);
          if (!published) {
            setCanvasMode("preview");
            revealAiConversation();
          }
          reportInternalFailure({
            area: "version",
            operation: "activate-ready-version",
            code: published ? "canvas-preparing" : "activate-unrecovered",
            recovered: false,
            cause: outcome.reason,
          });
        }
        return;
      }
      reviewAnalysisSession.clear();
      const result = outcome.value as {
        current: boolean;
        candidateLabel: string;
        protocolViolation: boolean;
        aiCompletedAt: string;
        committedSourcePath: string;
        verificationWarning?: string;
      };
      if (readyReviewSession?.operationKey === operationKey) {
        // The canvas already acknowledged the verified Version bytes inside
        // activateReadyVersion, so the overlay teardown and
        // mode switch below can land in one React commit: a single visual
        // cut instead of a multi-frame cascade.
        reviewSessionsRef.current.delete(readyReviewSession.tabId);
        setReadyReviewSession(null);
        performance.mark("stemmio:accept:overlay-closed");
      }
      if (!result.current) {
        reportInternalFailure({
          area: "version",
          operation: "background-version",
          code: result.protocolViolation ? "protocol-violation" : "generated-other-project",
          recovered: true,
          cause: result.protocolViolation
            ? "protocol-violation"
            : result.committedSourcePath,
        });
        return;
      }
      commentCanvasPort.setSelection(null);
      commentCanvasPort.setComposerOpen(false);
      commentEditResumePendingRef.current = null;
      commentCanvasPort.setEditingCommentId(null);
      setPreviewAttachment(null);
      setHandoffPreviewOpen(false);
      setCanvasMode("edit");
      performance.mark("stemmio:accept:ui-committed");
      if (result.protocolViolation) {
        reportInternalFailure({
          area: "version",
          operation: "activate-ready-version",
          code: "protocol-violation",
          recovered: true,
          cause: "protocol-violation",
        });
      } else if (result.verificationWarning) {
        reportInternalFailure({
          area: "version",
          operation: "activate-ready-version",
          code: "verification-warning",
          recovered: true,
          cause: result.verificationWarning,
        });
      }
    } finally {
      const visibleRun = currentRunSessionSnapshot().activeRun;
      const currentProject = currentProjectSessionSnapshot();
      if (
        sameLocalSourcePath(currentProject.sourcePath, run.sourcePath)
        || (
          currentProject.projectId === run.projectId
          && currentProject.documentId === run.documentId
        )
        || (
          visibleRun?.requestId === run.requestId
          && visibleRun.attemptId === run.attemptId
        )
      ) {
        setOpeningReadyVersion(false);
      }
    }
  }, [
    activeRun,
    commentCanvasPort,
    currentProjectSessionSnapshot,
    currentRunSessionSnapshot,
    readyReviewSession,
    reviewAnalysisSession,
    revealAiConversation,
    runCapability,
    workspaceController,
  ]);

  const reviewReadyResult = useCallback(async () => {
    const run = currentRunSessionSnapshot().activeRun;
    const reviewTabId = activeWorkbenchTab?.kind === "document"
      ? activeWorkbenchTab.tabId
      : "";
    if (
      !run
      || !reviewTabId
      || !workspaceController
      || !runCapability
      || run.status !== "ready-to-open"
      || !run.readyPayload
      || reviewPreparing
    ) return;
    setReviewPreparing(true);
    try {
      const outcome = await runCapability.commands.prepareReview({ run });
      if (outcome.status !== "succeeded") {
        if (outcome.status === "stale") return;
        throw new Error(outcome.reason);
      }
      const candidate = outcome.value;
      const operationKey = candidate.operationKey;
      const currentRun = currentRunSessionSnapshot().activeRun;
      if (
        !currentRun
        || currentRun.status !== "ready-to-open"
        || activeRunOperationKey(currentRun) !== operationKey
      ) return;
      const reviewContext = captureProjectContext();
      if (!reviewContext) {
        throw new Error("当前画布缺少可核对的项目身份，无法开始安全审阅。");
      }
      const frozen = fenceAndFreezeCurrentCanvas(
        "当前编辑画布尚未就绪，无法开始安全审阅。",
      );
      if (!frozen.ok) {
        throw new Error(frozen.reason || "当前编辑会话尚未安全收口。");
      }
      if (!isCurrentProjectContext(reviewContext)) {
        throw new DeferredEditorCommandDiscardedError("stale-session");
      }
      const frozenHtml = frozen.html;
      if (
        !candidate.baseSnapshotSha256
        || await browserSha256(frozenHtml) !== candidate.baseSnapshotSha256
      ) {
        throw new Error("当前冻结 HTML 已发生变化，无法开始安全对比。");
      }
      const externalBootstrap = Boolean(window.stemmioPreview);
      const sessionId = `review-${Date.now().toString(36)}-${++reviewSessionSequenceRef.current}`;
      const beforeLabel = run.basedOnVersionId
        ? safeVersionLabel(run.basedOnVersionId)
        : "当前版本";
      const afterLabel = String(
        run.readyPayload.candidateDisplayVersionLabel
        || safeVersionLabel(run.candidateVersionId),
      );
      const preparedReview = await prepareReviewAnalysis({
        session: reviewAnalysisSession,
        candidate,
        beforeHtml: frozenHtml,
        comments: currentCommentSessionSnapshot().comments,
        externalBootstrap,
        sessionId,
      });
      const analyzedRun = currentRunSessionSnapshot().activeRun;
      if (
        !analyzedRun
        || analyzedRun.status !== "ready-to-open"
        || activeRunOperationKey(analyzedRun) !== operationKey
        || !isCurrentProjectContext(reviewContext)
      ) return;
      revealAiConversation();
      setInterruption(null);
      const session: ReadyReviewSession = {
        tabId: reviewTabId,
        presentation: null,
        operationKey,
        sessionId: preparedReview.sessionId,
        documents: preparedReview.documents,
        beforeHtml: frozenHtml,
        sourceContentEqual: candidate.sha256 === candidate.baseSnapshotSha256,
        sourcePath: preparedReview.sourcePath,
        beforeLabel,
        afterLabel,
      };
      reviewSessionsRef.current.set(reviewTabId, session);
      setReadyReviewSession(session);
    } catch (cause) {
      if (cause instanceof ReviewAnalysisCancelledError) return;
      reportInternalFailure({
        area: "version",
        operation: "prepare-review",
        code: "ready-version-review-failed",
        recovered: false,
        cause,
      });
    } finally {
      setReviewPreparing(false);
    }
  }, [
    activeWorkbenchTab,
    captureProjectContext,
    currentCommentSessionSnapshot,
    currentRunSessionSnapshot,
    fenceAndFreezeCurrentCanvas,
    revealAiConversation,
    isCurrentProjectContext,
    reviewAnalysisSession,
    reviewPreparing,
    runCapability,
    setInterruption,
    workspaceController,
  ]);

  useLayoutEffect(() => {
    const activeTabId = activeWorkbenchTab?.kind === "document"
      ? activeWorkbenchTab.tabId
      : "";
    const currentRun = currentRunSessionSnapshot().activeRun;
    const cached = activeTabId ? reviewSessionsRef.current.get(activeTabId) || null : null;
    const candidate = readyReviewSession?.tabId === activeTabId
      ? readyReviewSession
      : cached;
    const candidateMatches = Boolean(
      candidate
      && currentRun?.status === "ready-to-open"
      && activeRunOperationKey(currentRun) === candidate.operationKey
    );
    if (candidateMatches) {
      if (readyReviewSession !== candidate) setReadyReviewSession(candidate);
      return;
    }
    if (openingReadyVersion) return;
    if (activeTabId && cached) reviewSessionsRef.current.delete(activeTabId);
    if (readyReviewSession) setReadyReviewSession(null);
  }, [
    activeWorkbenchTab,
    activeRun,
    currentRunSessionSnapshot,
    openingReadyVersion,
    readyReviewSession,
  ]);

  const cancelActiveRun = useCallback(async ({
    agentMayBeRunning = false,
    reason,
  }: {
    agentMayBeRunning?: boolean;
    reason?: string;
  } = {}) => {
    if (!activeRun || !runCapability) return false;
    const outcome = await runCapability.commands.cancel({
      run: activeRun,
      agentMayBeRunning,
      reason,
    });
    return outcome.status === "succeeded";
  }, [activeRun, runCapability]);

  const manageAgentAccess = useCallback(async (
    kind: "disconnect" | "remove-key" | "reconnect" | "logout",
    selection: AgentSelection,
  ) => {
    const outcome = await workspaceController?.manageAgentAccess(kind, selection, {
      stopRelatedRuns: kind !== "reconnect",
    }) ?? { status: "rejected" as const, reason: "工作台尚未就绪。" };
    return outcome;
  }, [workspaceController]);

  const requestActiveRunEnd = useCallback(() => {
    if (!activeRun) return;
    if (handoffCancellationNeedsConfirmation) {
      setCancelRunConfirmationKey(activeRunOperationKey(activeRun));
      return;
    }
    void cancelActiveRun();
  }, [
    activeRun,
    cancelActiveRun,
    handoffCancellationNeedsConfirmation,
    setCancelRunConfirmationKey,
  ]);

  const resolveAiConflict = useCallback(async (action: "adopt-ai" | "keep-external") => {
    if (
      !activeRun
      || activeRun.status !== "awaiting-conflict-resolution"
      || !runCapability
    ) return;
    const outcome = await runCapability.commands.resolveConflict({ run: activeRun, action });
    if (outcome.status !== "succeeded") {
      if (outcome.status !== "stale") {
        setCanvasMode("preview");
        revealAiConversation();
      }
      return;
    }
    const result = outcome.value;
    if (
      action === "keep-external"
      && result.current
      && result.documentSourceResult?.status === "succeeded"
    ) {
      setCanvasMode("edit");
      setFileStatusNotice(result.documentSourceResult.value.page.status === "restored"
        ? "页面已重新加载，可以继续编辑"
        : "文件已重新读取，但页面暂时无法编辑，请重试");
    }
  }, [
    activeRun,
    revealAiConversation,
    runCapability,
  ]);

  const openCurrentSidebarProject = useCallback((project: RegisteredProject) => {
    void openRegisteredWorkbenchProject(project);
  }, [openRegisteredWorkbenchProject]);

  const openRegisteredSidebarVersion = useCallback((
    project: RegisteredProject,
    summary: ProjectVersionSummary,
  ) => {
    if (!navigationCapability || !project.documentId || project.availability !== "ready") return;
    void navigationCapability.commands.createHistoryTab({
      projectId: project.projectId,
      documentId: project.documentId,
      title: project.projectName,
    }, summary).then((outcome) => {
      presentWorkbenchTabOutcome(outcome);
      if (outcome.status === "succeeded") editorRef.current?.clearSelection();
    });
  }, [
    navigationCapability,
    presentWorkbenchTabOutcome,
  ]);

  const requestHistoryCreation = () => {
    if (historyCreation?.context.projectId === projectId && historyCreation.context.documentId === documentId
      && !["opened", "superseded", "not-created"].includes(historyCreation.phase)) {
      setFileStatusNotice("请先查询或打开上一次创建操作的结果。");
      return;
    }
    if (viewMode === "history" && viewingVersionId && !isViewTransitioning()
      && !runInProgress && !projectHydrating && !projectLoadError) {
      setHistoryCreationConfirmation(`${projectId}:${documentId}:${viewingVersionId}`);
    }
  };
  const openCreatedHistory = async (operationId: string) => {
    const context = captureProjectContext();
    const navigation = navigationCapability;
    if (!context || !workspaceController || !navigation) return;
    const opened = await workspaceController.openCreatedHistoryVersion({ operationId, context });
    if (opened.status === "stale") return;
    const outcome = await navigation.commands.openRegisteredProject({
      projectId: context.projectId,
      documentId: context.documentId,
      title: projectName || activeWorkbenchTab?.title || "当前稿",
      force: true,
      ...(opened.status === "succeeded" ? {} : {
        committedVersionTransitionFailure: {
          code: "code" in opened ? opened.code : "VERSION_CURRENT_OPEN_FAILED",
          reason: "reason" in opened ? opened.reason : "新版本已创建，但当前稿画布尚未准备好。",
        },
      }),
    });
    if (outcome.status === "succeeded" && captureProjectContext()?.projectId === context.projectId
      && captureProjectContext()?.documentId === context.documentId) {
      editorRef.current?.clearSelection();
      setFileStatusNotice("");
      setCanvasMode("edit");
    } else if (outcome.status !== "stale" && outcome.status !== "succeeded") {
      presentWorkbenchTabOutcome(outcome);
    }
  };
  const createHistoryVersion = async () => {
    const versionId = historyCreationConfirmation;
    setHistoryCreationConfirmation(null);
    const context = captureProjectContext();
    if (!context || !workspaceController || versionId !== `${context.projectId}:${context.documentId}:${viewingVersionId}` || viewMode !== "history") return;
    const operationId = `history_${crypto.randomUUID()}`;
    const outcome = await workspaceController.createVersionFromHistory({ operationId, context });
    if (outcome.status === "succeeded") {
      if (isCurrentProjectContext(context)) await openCreatedHistory(operationId);
    } else if (outcome.status !== "stale") setFileStatusNotice(outcome.reason);
  };
  const recoverHistoryCreation = async () => {
    if (!historyCreation || historyCreation.context.projectId !== projectId
      || historyCreation.context.documentId !== documentId) return;
    if (historyCreation.phase === "unknown") {
      const outcome = await workspaceController?.queryHistoryCreation({ operationId: historyCreation.operationId, context: captureProjectContext() });
      if (outcome && outcome.status !== "succeeded" && outcome.status !== "stale") setFileStatusNotice(outcome.reason);
    } else await openCreatedHistory(historyCreation.operationId);
  };

  const canvasAuthority = documentSnapshot.canvasAuthority;
  const canShowCurrentFileInFolder = Boolean(
    sourcePath
    && typeof window !== "undefined"
    && window.stemmioProjects?.showInFolder,
  );
  const canOpenSelectedHtmlInDefaultBrowser = Boolean(
    sourcePath
    && typeof window !== "undefined"
    && window.stemmioProjects?.openInDefaultBrowser,
  );
  const hasDocumentHistoryAction = Boolean(shellSnapshot?.hasDocumentHistoryAction);
  const presentation = useMemo(() => deriveWorkbenchPresentation({
    project: { projectId, documentId, sourcePath }, version: versionSnapshot,
    activeTab: activeWorkbenchTab || null, runtimeOwnerTabId: workbenchTabsSnapshot.runtimeOwnerTabId, canvasMode: displayedCanvasMode,
    reviewActive: Boolean(presentedReadyReviewSession), activeRunStatus: activeRun?.status,
    hasReadyPayload: Boolean(activeRun?.readyPayload), hasReadyReviewSession: Boolean(presentedReadyReviewSession),
    reviewPreparing, canShowCurrentFileInFolder, canOpenSelectedHtmlInDefaultBrowser,
    persistState, editRevision, lastPersistedRevision, hasWorkspaceController: Boolean(workspaceController),
    projectHydrating, projectLoadError: Boolean(projectLoadError), viewTransitioning,
    runInProgress, workspaceIssue: Boolean(workspaceIssue), externalSourcePreview: Boolean(externalSourcePreview),
    hasDocumentHistoryAction, interactionLocked,
  }), [projectId, documentId, sourcePath, versionSnapshot, activeWorkbenchTab, workbenchTabsSnapshot.runtimeOwnerTabId, displayedCanvasMode,
    activeRun?.status, activeRun?.readyPayload, presentedReadyReviewSession,
    reviewPreparing, canShowCurrentFileInFolder, canOpenSelectedHtmlInDefaultBrowser,
    persistState, editRevision, lastPersistedRevision, workspaceController, projectHydrating,
    projectLoadError, viewTransitioning, runInProgress, workspaceIssue, externalSourcePreview, interactionLocked, hasDocumentHistoryAction]);
  const { reviewAvailable, canReloadCurrentSource } = presentation;
  const pendingRunOutcome = Boolean(
    activeRun?.requestId === "pending" && projectLocked,
  );
  const terminalRun = Boolean(
    activeRun && ["error", "no-change"].includes(activeRun.status) && !pendingRunOutcome,
  );
  const commentTargetIsLocatable = useCallback((target: HtmlCanvasSelection): boolean => {
    const sourceTarget = target.commentAnchor ?? target;
    const layout = commentCanvasPort.getSnapshot().targetLayouts[sourceTarget.id];
    const resolution = layout?.resolution ?? sourceTarget.resolution;
    return layout?.status !== "missing"
      && (resolution === "exact" || resolution === "rebound");
  }, [commentCanvasPort]);
  const reopenRecentRunOutcome = () => {
    if (!runCapability?.commands.reopenRecentOutcome(sourcePath)) return;
    setHandoffPreviewOpen(false);
    setCanvasMode("preview");
    revealAiConversation();
  };
  const handleInterruptionAction = () => {
    const actionId = presentedInterruption?.actionId;
    const current = interruptionRef.current;
    if (
      actionId === "retry-project-open"
      && presentedInterruption?.actionRequestId
      && workspaceController
    ) {
      const requestId = presentedInterruption.actionRequestId;
      void workspaceController.retryExternalOpen({ requestId }).then((outcome) => {
        const latest = interruptionRef.current;
        if (
          outcome?.status === "succeeded"
          && latest?.kind === "project-open-failed"
          && latest.requestId === requestId
        ) {
          setInterruption(null);
        }
      });
      return;
    }
    setInterruption(null);
    switch (actionId) {
      case "reveal-imported-project":
        if (current?.kind === "import-trash-failed" && current.sourcePath) {
          void showProjectInFolder(current.sourcePath);
        }
        return;
      case "retry-export":
        void exportCurrentHtml();
        return;
      case "retry-project-open":
        void openProject();
        return;
      case "open-attachment-picker":
        if (
          current?.kind === "attachment-rejected"
          || current?.kind === "attachment-batch-partial"
        ) {
          openAttachmentPicker(current.target, "all");
        }
        return;
      case "review-comment-attachments":
        {
          if (
            current?.kind !== "attachment-rejected"
            && current?.kind !== "attachment-batch-partial"
          ) return;
          const currentComments = currentCommentSessionSnapshot();
          if (current.target.kind === "composer") {
            const target = currentComments.composerTarget;
            if (
              currentComments.composerCommentId === current.target.commentId
              && target
            ) {
              commentCanvasPort.setComposerOpen(true);
              queueReviewPairReveal(target, "__composer");
              requestComposerFocus();
            }
          } else {
            const comment = currentComments.comments.find(
              (item) => item.commentId === current.target.commentId,
            );
            if (comment) focusCommentTarget(commentVisualTarget(comment), comment.commentId);
          }
        }
        return;
    }
  };

  // Same authority the process view used, reached from the conversation so the
  // decision no longer requires a panel over the page.
  const handleAiDecision = useCallback((actionId: string) => {
    if (actionId === "resend-agent" || actionId === "retry-later") {
      void workspaceControllerRef.current?.resendAfterAccessRepair();
      return;
    }
    if ([
      "reconnect-agent",
      "reauthenticate-agent",
      "change-agent-model",
      "change-agent-provider",
      "repair-agent-installation",
      "switch-agent",
    ].includes(actionId)) {
      void (async () => {
        const run = activeRun;
        const field = actionId === "repair-agent-installation"
          ? "install"
          : actionId === "change-agent-model"
            ? "model"
            : actionId === "change-agent-provider" || actionId === "switch-agent"
              ? "provider"
              : "login";
        workspaceControllerRef.current?.beginAccessRepair(run, field);
        if (run) await cancelActiveRun();
        workspaceControllerRef.current?.runs.commands.dismiss();
        setHandoffPreviewOpen(false);
        setCanvasMode("edit");
        editorRef.current?.unlockNow?.();
        openAgentSettings();
      })();
      return;
    }
    if (actionId === "copy-task") {
      if (activeRun) void workspaceControllerRef.current?.runs.commands.copyHandoff({ run: activeRun });
      return;
    }
    if (actionId === "review") { void reviewReadyResult(); return; }
    if (actionId === "adopt") {
      if (readyReviewSession) {
        deferredEditorReplayRef.current.requestReviewDecision?.("accept");
        return;
      }
      void activateReadyResult({ reviewed: false });
      return;
    }
    if (actionId === "discard") {
      if (readyReviewSession) {
        deferredEditorReplayRef.current.requestReviewDecision?.("return");
        return;
      }
      void cancelActiveRun().then((succeeded) => {
        if (!succeeded) return;
        setReadyReviewSession(null);
        reviewAnalysisSession.clear();
        setCanvasMode("edit");
        editorRef.current?.unlockNow?.();
      });
      return;
    }
    if (actionId === "adopt-ai" || actionId === "keep-external") {
      void resolveAiConflict(actionId);
      return;
    }
    if (actionId === "dismiss" && activeRun?.status === "processing") {
      requestActiveRunEnd();
      return;
    }
    if (actionId === "return-editing" || actionId === "dismiss") {
      workspaceControllerRef.current?.runs.commands.dismiss();
      setHandoffPreviewOpen(false);
      setCanvasMode("edit");
      editorRef.current?.unlockNow?.();
      return;
    }
    if (actionId === "recopy") {
      const controller = workspaceControllerRef.current?.runs;
      if (!controller || !activeRun) return;
      // Copying is invisible by nature: without a word the user cannot tell a
      // successful re-copy from a dead button.
      void (async () => {
        const outcome = await controller.commands.copyHandoff({ run: activeRun });
        setInterruption({
          kind: "handoff-recopy",
          succeeded: Boolean(outcome && outcome.status === "succeeded"),
        });
      })();
      return;
    }
    if (actionId === "cancel") requestActiveRunEnd();
  }, [
    activateReadyResult,
    readyReviewSession,
    reviewAnalysisSession,
    activeRun,
    cancelActiveRun,
    openAgentSettings,
    requestActiveRunEnd,
    resolveAiConflict,
    reviewReadyResult,
    setInterruption,
  ]);

  const aiAssistantEntry = (
    <AgentDeliveryButton
      status={currentAgentHandoffStatus}
      attention={Boolean(activeRun?.candidateVersionLabel) || runInProgress}
      label={presentedReadyReviewSession && !aiConversation.visible ? "待决定" : undefined}
      disabled={!aiConversation.visible && (
        generating || projectHydrating || Boolean(projectLoadError)
        || viewTransitioning || viewMode === "history"
      )}
      expanded={aiConversation.visible}
      onToggle={() => {
        // The toolbar entry owns both directions: a second click returns the
        // page space without adding a duplicate close control inside the sidebar.
        if (aiConversation.visible) {
          aiConversation.toggle();
          return;
        }
        setHandoffPreviewOpen(false);
        setCanvasMode("preview");
        revealAiConversation();
      }}
    />
  );

  const createModeHandlers = () => createWorkbenchModeHandlers({
    externalSourcePreview: Boolean(externalSourcePreview),
    canvasMode,
    interactionLocked,
    previewToEditPendingRef,
    pageViewDocumentKeyRef,
    interactionPreviewRef,
    editorRef,
    returnToEditingFromExternalPreview,
    setPageViewContext,
    invalidateEditCanvasRenderAck,
    commentCanvasPort,
    updateFocusedComment,
    setCanvasMode,
    deferEditorCommand,
    isViewTransitioning,
  });
  const onSelectEdit = () => createModeHandlers().onSelectEdit();
  const onSelectPreview = () => createModeHandlers().onSelectPreview();

  // The review compares immutable snapshots prepared against the
  // pre-promotion source identity. Accepting promotes the Working Copy to a
  // new path while this overlay is still visible; the live path would rebuild
  // both preview sessions (and retitle the header) mid-accept for nothing.
  const selectDefaultAgent = async (selection: AgentSelection) => {
    await workspaceController?.selectDefaultAgent?.(selection);
  };
  const selectDocumentAgent = async (selection: AgentSelection) => {
    try {
      const selected = workspaceController?.selectAgent(selection);
      if (!selected || !documentId) return false;
      return await workspacePreferencesController.update({
        documentAgentSelections: {
          ...workspacePreferencesController.snapshot.workspace.documentAgentSelections,
          [documentId]: selected.providerId as WorkspacePreferences["defaultAgentProviderId"],
        },
      });
    } catch {
      return false;
    }
  };
  const agentAccess = {
    cards: agentCards,
    documentId: documentId ?? "",
    recovery: shellSnapshot?.run?.accessRepair ?? null,
    bindings: {
      onCopyGuidance: copyAgentGuidance,
      onStartLogin: startAgentLogin,
      onReopenLogin: reopenAgentLogin,
      onLogoutAgent: (selection: AgentSelection) => manageAgentAccess("logout", selection),
      onInstall: installAgent,
      onCancelInstall: cancelAgentInstall,
      onCheckSelection: checkAgentUsability,
      onConnectApiKey: connectAgentApiKey,
      onRetryPersistCredential: (selection: AgentSelection) => (
        workspaceController?.retryAgentCredentialPersist?.(selection) ?? Promise.resolve({
          status: "rejected",
          reason: "没有可重试保存的 API Key。",
        })
      ),
      onDisconnectApiKey: disconnectAgentApiKey,
      onOpenVendorApiKeyPage: openVendorApiKeyPage,
      onSelectAgentModel: selectSettingsAgentModel,
      onSelectAgentReasoning: selectSettingsAgentReasoning,
    },
    onSelect: selectDocumentAgent,
    onQueueDefault: (selection: AgentSelection) => {
      workspaceController?.queuePendingDefaultAgent(selection);
    },
    onReconnect: async (selection: AgentSelection) => {
      return manageAgentAccess("reconnect", selection);
    },
    onBeginAccessRepair: (field: "apiKey" | "login" | "install" | "model" | "provider" = "apiKey") => {
      if (activeRun) workspaceController?.beginAccessRepair(activeRun, field);
    },
  };
  const readyReviewOverlay = presentedReadyReviewSession ? (
    <WorkbenchReviewOverlay
      session={presentedReadyReviewSession}
      fileName={localFileNameFromSourcePath(presentedReadyReviewSession.sourcePath) || currentSourceFileName}
      changeContextVisibility={workspacePreferences.reviewChangeContextVisibility}
      commentContextVisibility={workspacePreferences.reviewCommentContextVisibility}
      initialPresentation={presentedReadyReviewSession.presentation}
      onPresentationChange={(presentation) => {
        if (
          presentation.reviewIdentity !== presentedReadyReviewSession.sessionId
        ) return;
        const cached = reviewSessionsRef.current.get(presentedReadyReviewSession.tabId);
        if (cached?.sessionId !== presentedReadyReviewSession.sessionId) return;
        reviewSessionsRef.current.set(presentedReadyReviewSession.tabId, {
          ...cached,
          presentation,
        });
      }}
      accepting={openingReadyVersion || Boolean(activeRun?.adoptionPhase)}
      activeRunError={activeRun?.status === "ready-to-open" ? activeRun.error : undefined}
      onAbout={openAboutStemmio}
      onCancelBefore={cancelActiveRun}
      onAccept={() => void activateReadyResult({ reviewed: true })}
      onRevealAiTask={() => void revealAiTaskInFinder()}
      assistantEntry={aiAssistantEntry}
      sidebar={aiConversation.visible && runCapability ? (
        <RunConversationOutlet
          capability={runCapability}
          conversationCapability={workspaceController!.conversation}
          conversationContext={aiConversation.context}
          sidebarProps={{
            ...aiConversation.sidebarProps,
            onAction: handleAiDecision,
            agentAccess,
          }}
          reviewing
          deliveryMode={currentAgentDeliveryMode}
        />
      ) : null}
      registerDecisionRequest={(request) => {
        const previous = deferredEditorReplayRef.current.requestReviewDecision;
        deferredEditorReplayRef.current.requestReviewDecision = request;
        return () => {
          if (deferredEditorReplayRef.current.requestReviewDecision === request) {
            deferredEditorReplayRef.current.requestReviewDecision = previous;
          }
        };
      }}
      registerReload={(reload) => {
        const previous = deferredEditorReplayRef.current.reloadReview;
        deferredEditorReplayRef.current.reloadReview = reload;
        return () => {
          if (deferredEditorReplayRef.current.reloadReview === reload) {
            deferredEditorReplayRef.current.reloadReview = previous;
          }
        };
      }}
    />
  ) : null;
  const workbenchInspector = deriveWorkbenchInspector({
    canvasMode,
    aiVisible: aiConversation.visible
      && Boolean(runCapability)
      && !readyReviewSession
      && !projectRulesPageActive,
    reviewVisible: Boolean(readyReviewSession) && !projectRulesPageActive,
    commentsAvailable: Boolean(workspaceController) && !projectRulesPageActive,
  });
  const closeSettingsPage = useCallback(() => {
    if (!settingsPageActive || !activeWorkbenchTab || !navigationCapability) return;
    void navigationCapability.commands.closeTab(activeWorkbenchTab.tabId).then((outcome) => {
      presentWorkbenchTabOutcome(outcome);
      if (outcome.status !== "succeeded") return;
      setSettingsCategory("general");
      window.requestAnimationFrame(() => {
        const returnFocus = overlayReturnFocusRef.current;
        if (returnFocus && document.contains(returnFocus)) returnFocus.focus();
        else document.querySelector<HTMLElement>(".workbench-sidebar-settings")?.focus();
        overlayReturnFocusRef.current = null;
      });
    });
  }, [activeWorkbenchTab, navigationCapability, presentWorkbenchTabOutcome, settingsPageActive]);
  const { visibleCachedSurface, candidateCachedSurface, retainPresentedTab, completeHandoff, updateHandoffScroll, markFirstScroll } = useDocumentSurfaceHandoff({ cache: documentSurfaceCacheSnapshot, tabs: workbenchTabsSnapshot, sourceSha256, renderedSourceSha256: canvasMode === "preview" && canvasRenderAcks.preview?.generation === canvasGeneration ? canvasRenderAcks.preview.sha256 : renderedContentSha256, canvasAuthority, canvasGeneration, controller: workspaceController });
  const cachedSurfaceBlocksCanvas = Boolean(visibleCachedSurface);
  const retryProjectHydrationFromCommentRail = useCallback(() => {
    void workspaceController?.retryProjectHydration();
  }, [workspaceController]);
  const updateCommentDraftFromRail = useCallback((value: string) => {
    workspaceControllerRef.current?.updateCommentDraft(value);
  }, []);
  const pasteIntoCommentComposer = useCallback((event: ClipboardEvent<HTMLTextAreaElement>) => {
    const commentId = draftCommentId
      || currentCommentSessionSnapshot().composerCommentId;
    if (commentId) pasteImages(event, { kind: "composer", commentId });
  }, [currentCommentSessionSnapshot, draftCommentId, pasteImages]);
  const commentRailContext: CommentRailContainerContext = {
    reviewStageRef,
    canvasMode,
    viewMode,
    expectedCommentLayoutSourceSha256,
    activePageViewGeneration: activePageViewContext?.generation ?? 0,
    visibleCommentItems,
    activeCommentCount,
    changeEvents,
    interactionLocked,
    unfinishedEditedComment,
    projectLoadError,
    otherTabCommentsContextKey,
    attachmentObjectUrls,
  };
  const commentRailActions = useMemo<CommentRailHostActions>(() => ({
    openGlobalCommentComposer,
    resumeCurrentComposer,
    resumeCommentEdit,
    focusCommentTarget,
    cancelTargetRelink,
    onRetryProjectHydration: retryProjectHydrationFromCommentRail,
    closeCommentComposer,
    beginTargetRelink,
    updateDraft: updateCommentDraftFromRail,
    onComposerPaste: pasteIntoCommentComposer,
    commit: addComment,
    ensureAttachmentObjectUrl,
    openAttachmentPreview,
    downloadAttachment,
    removeComposerAttachment,
    discardCurrentComposer,
    openAttachmentPicker,
    commentTargetIsLocatable,
    updateCommentEditDraft,
    cancelCommentEdit,
    confirmEdit: confirmCommentEdit,
    pasteImages,
    removeCommentAttachment,
    queueReviewCommentFocus,
    deleteComment,
    beginEdit: beginCommentEdit,
    uploadAttachments,
  }), [
    addComment,
    beginCommentEdit,
    beginTargetRelink,
    cancelCommentEdit,
    cancelTargetRelink,
    closeCommentComposer,
    commentTargetIsLocatable,
    confirmCommentEdit,
    deleteComment,
    discardCurrentComposer,
    downloadAttachment,
    ensureAttachmentObjectUrl,
    focusCommentTarget,
    openAttachmentPicker,
    openAttachmentPreview,
    openGlobalCommentComposer,
    pasteImages,
    pasteIntoCommentComposer,
    queueReviewCommentFocus,
    removeCommentAttachment,
    removeComposerAttachment,
    resumeCommentEdit,
    resumeCurrentComposer,
    retryProjectHydrationFromCommentRail,
    updateCommentDraftFromRail,
    updateCommentEditDraft,
    uploadAttachments,
  ]);
  const projectCatalogCapability = workspaceController
    ? workspaceController.projectCatalog as ProjectCatalogCapability
    : null;
  const canMountUnboundCanvas = Boolean(documentRuntimeTabId);
  const activeRuntimeCanvasMounted = Boolean(
    desktopHostReady
    && !desktopHostIssue
    && canMountUnboundCanvas
  );
  const currentProjectDisplayName = currentProjectNameFromFile(sourcePath, projectName);
  const workbenchStyle = useMemo(() => ({
    "--workbench-sidebar-width-saved": `${workspacePreferencesController.panelWidths.sidebarWidth}px`,
    "--workbench-inspector-width": `${workspacePreferencesController.panelWidths.inspectorWidth}px`,
  } as CSSProperties), [workspacePreferencesController.panelWidths.inspectorWidth, workspacePreferencesController.panelWidths.sidebarWidth]);
  const documentPersistenceBannerVisible = Boolean(
    !settingsPageActive
    && !projectRulesPageActive
    && !workspaceIssue
    && !externalSourcePreview
    && (persistState === "conflict" || persistState === "failed"),
  );
  const persistenceDiagnostic = [
    `persistState: ${persistState}`,
    `reason: ${persistError || "unknown"}`,
    `projectId: ${projectId || "unbound"}`,
    `documentId: ${documentId || "unbound"}`,
    `sourcePath: ${sourcePath || "unbound"}`,
    `editRevision: ${editRevision}`,
    `lastPersistedRevision: ${lastPersistedRevision}`,
    `sourceSha256: ${sourceSha256 || "unknown"}`,
    `pendingWrite: ${documentSnapshot.hasPendingWrite ? "true" : "false"}`,
  ].join("\n");
  return (
    <>
      <RendererStartupPerformance />
      <main
        className="workbench"
        style={workbenchStyle}
        data-start-page={startPageActive ? "true" : undefined}
        data-settings-page={settingsPageActive ? "true" : undefined}
        data-project-rules-page={projectRulesPageActive ? "true" : undefined}
        data-motion={workspacePreferences.motion}
        data-left-sidebar={globalSidebarOpen ? "open" : "collapsed"}
        data-round-state={runInProgress ? "processing" : viewMode}
        data-canvas-mode={displayedCanvasMode}
        data-handoff-preview={runInProgress && handoffPreviewOpen ? "true" : undefined}
        data-document-persistence-banner={documentPersistenceBannerVisible ? "true" : undefined}
        data-persist-state={persistState}
        data-edit-revision={String(editRevision)}
        data-persisted-revision={String(lastPersistedRevision)}
        data-canvas-generation={String(canvasGeneration)}
        data-html-export-state={workspaceControllerSnapshot?.version?.export?.phase || "idle"}
        data-render-generation={String(canvasGeneration)}
        data-rendered-sha256={renderedContentSha256 || undefined}
        data-project-state={
          projectLoadError
            ? "failed"
            : projectHydrating
              ? "hydrating"
              : sourcePath
                ? "ready"
                : "unbound"
        }
        aria-label="Stemmio 可视化编辑工作台"
      >
      {navigationCapability ? <WorkbenchTabBarContainer
        capability={navigationCapability}
        presentation={presentation}
        sidebarOpen={globalSidebarOpen}
        onToggleSidebar={() => {
          setGlobalSidebarOpen(true);
          void projectCatalogCapability?.commands.refreshRecents();
          void projectCatalogCapability?.commands.refreshRegistered();
        }}
        onBeforeSelect={rememberWorkbenchTabPresentation}
        onOutcome={presentWorkbenchTabOutcome}
      /> : null}
      {!startPageActive && !settingsPageActive && !projectRulesPageActive ? <>
        <WorkbenchHeaderView
          runInProgress={runInProgress}
          presentation={presentation}
          recentRunOutcome={recentRunOutcome}
          terminalRun={terminalRun}
          aiConversationVisible={aiConversation.visible}
          aiAssistantEntry={aiAssistantEntry}
          moreMenu={{
            isHistory: presentation.isHistory,
            canShowInFolder: presentation.actions.showInFolder.enabled,
            showInFolderUnavailableReason: presentation.actions.showInFolder.reason,
            onShowInFolder: () => void showProjectInFolder(),
            canOpenInBrowser: presentation.actions.openInBrowser.enabled,
            openInBrowserUnavailableReason: presentation.actions.openInBrowser.reason,
            onOpenInBrowser: () => void openSelectedHtmlInDefaultBrowser(),
            canExportCurrentHtml: presentation.actions.exportHtml.enabled,
            exportUnavailableReason: presentation.actions.exportHtml.reason,
            onExportCurrentHtml: (saveVersion) => void exportCurrentHtml(false, saveVersion),
            canSaveCurrentVersion: presentation.actions.saveVersion.enabled,
            saveCurrentVersionUnavailableReason: presentation.actions.saveVersion.reason,
            exportAndSaveUnavailableReason: presentation.actions.exportAndSave.reason,
            onSaveCurrentVersion: () => { void workspaceController?.saveCurrentVersion(); },
            canCreateVersionFromHistory: presentation.actions.createFromHistory.enabled,
            createVersionFromHistoryUnavailableReason: presentation.actions.createFromHistory.reason,
            onCreateVersionFromHistory: requestHistoryCreation,
            canOpenPreservedDrafts: presentation.actions.preservedDrafts.enabled,
            preservedDraftsUnavailableReason: presentation.actions.preservedDrafts.reason,
            onOpenPreservedDrafts: () => setPreservedDraftDialogOpen(true),
            canReloadCurrentSource: presentation.actions.reloadSource.enabled,
            reloadCurrentSourceUnavailableReason: presentation.actions.reloadSource.reason,
            onReloadCurrentSource: () => void reloadCurrentSource(),
            onRetryDynamicContent: canReloadCurrentSource && editRuntimeSnapshot?.retryAvailable
              ? () => {
                  void workspaceControllerRef.current?.retryEditAuthorRuntime().then((started) => {
                    if (!started) setFileStatusNotice("暂时无法重新加载，请稍后重试");
                  });
                }
              : undefined,
          }}
          onSelectEdit={onSelectEdit}
          onSelectPreview={onSelectPreview}
          onOpenReview={() => {
            if (reviewAvailable) void reviewReadyResult();
          }}
          onRefreshCanvas={() => {
            if (readyReviewOverlay) {
              deferredEditorReplayRef.current.reloadReview?.();
              return;
            }
            if (displayedCanvasMode === "preview") interactionPreviewRef.current?.reload();
          }}
          reopenRecentRunOutcome={reopenRecentRunOutcome}
        />
        <CurrentDraftStatus state={workspaceControllerSnapshot?.version} contextKey={`${projectId}:${documentId}`}
          onRetry={() => { void workspaceController?.retryCurrentVersion(); }}
          onShowFile={(path) => { void showProjectInFolder(path); }} />
      </> : null}

      {pendingExit || fileStatusNotice ? (
        <section
          className="workbench-chrome-status"
          data-tone={pendingExit ? "exit" : "info"}
          role="status"
        >
          {pendingExit ? "正在保存，完成后将退出" : fileStatusNotice}
        </section>
      ) : null}

      {!settingsPageActive && !projectRulesPageActive && startupIssue ? (
        <section className="startup-issue" role="alert">
          <div>
            <strong>{startupIssue.title}</strong>
            <span>{startupIssue.message}</span>
          </div>
          <button type="button" onClick={() => void openProject()}>
            选择其他 HTML
          </button>
          <button type="button" onClick={() => setStartupIssue(null)}>
            暂时关闭
          </button>
        </section>
      ) : null}

      {!settingsPageActive && !projectRulesPageActive && workspaceIssue ? (
        <section className="source-conflict-banner workspace-unavailable-banner" role="alert">
          <div>
            <strong>{workspaceIssue.title}</strong>
            <span>{workspaceIssue.message}</span>
          </div>
          <button type="button" onClick={() => void exportCurrentHtml()}>
            导出当前 HTML
          </button>
          <button type="button" onClick={() => void openProject()}>
            重新定位文件
          </button>
          <button type="button" onClick={() => void relaunchApp()}>
            重新打开
          </button>
        </section>
      ) : null}

      {documentPersistenceBannerVisible ? (
        <section className="source-conflict-banner document-persistence-banner" role="alert">
          <div>
            <strong>{persistState === "conflict" ? "源文件在磁盘上被其他程序修改了" : "当前修改还没有写入文件"}</strong>
            <span>{persistState === "conflict"
              ? (persistError || "您的编辑内容仍在，可先预览外部版本再决定。")
              : (persistError || "工作台保留了当前编辑内容，不会假装已经更新。")}</span>
            <details className="persistence-error-details">
              <summary>错误详情</summary>
              <pre>{persistenceDiagnostic}</pre>
            </details>
          </div>
          <button type="button" onClick={() => void exportCurrentHtml()}>导出当前 HTML</button>
          <button
            type="button"
            onClick={() => {
              void copyText(persistenceDiagnostic).then(
                () => setFileStatusNotice("错误详情已复制"),
                () => setFileStatusNotice("无法复制错误详情"),
              );
            }}
          >复制错误详情</button>
          {persistState === "conflict" ? (
            <button type="button" onClick={() => void previewExternalSource()}>
              预览外部版本
            </button>
          ) : null}
          {persistState === "conflict" ? (
            <button
              type="button"
              className="destructive-action"
              onClick={() => {
                void forceUnlockCurrentSource();
              }}
            >
              采用磁盘版本
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                requestUserFlush();
              }}
            >重试更新文件</button>
          )}
        </section>
      ) : null}

      {!settingsPageActive
      && !projectRulesPageActive
      && !workspaceIssue
      && persistState !== "conflict"
      && persistState !== "failed"
      && draftPersistError ? (
        <section className="source-conflict-banner" role="alert">
          <div>
            <strong>评论还没有安全记录</strong>
            <span>{productErrorMessage(
              draftPersistError,
              "本轮评论暂时无法记录；当前内容仍保留在页面中。",
            )}</span>
          </div>
          <button type="button" onClick={() => void workspaceController?.flushDraft()}>
            重试记录评论
          </button>
        </section>
      ) : null}

      {!settingsPageActive && !projectRulesPageActive && externalSourcePreview ? (
        <PreviewNavigationBanner
          key={`external-${externalSourcePreview.sourceSha256}`}
          icon={<EyeIcon aria-hidden="true" size={18} weight="duotone" />}
          title="正在预览外部版本"
          detail="这是磁盘上被其他程序改过的源 HTML，尚未替换您的编辑。"
          secondaryActionLabel="接受此版本（丢弃我的编辑）"
          onSecondaryAction={() => {
            void acceptExternalSourceFromPreview();
          }}
          actionLabel="返回我的编辑"
          onAction={returnToEditingFromExternalPreview}
        />
      ) : runInProgress && handoffPreviewOpen ? (
        <PreviewNavigationBanner
          key={`handoff-${activeRun?.requestId || "pending"}-${activeRun?.attemptId || "pending"}`}
          className="sent-preview-banner"
          icon={<EyeIcon aria-hidden="true" size={18} weight="duotone" />}
          title="正在预览已发送 HTML"
          detail={currentAgentDeliveryMode === "managed-agent"
            ? agentPresentation.frozenPreviewDetail
            : currentAgentDeliveryMode === "clipboard"
              ? "这是本轮冻结并复制给 AI Agent 的只读内容"
              : "这是本轮冻结的 Agent 只读内容"}
          actionLabel="返回等待处理"
          onAction={() => {
            setHandoffPreviewOpen(false);
            setCanvasMode("preview");
            revealAiConversation();
          }}
        />
      ) : null}

      {historyCreation && historyCreation.context.projectId === projectId
        && historyCreation.context.documentId === documentId && !["opened", "superseded"].includes(historyCreation.phase) ? (
        <PreviewNavigationBanner
          icon={<ClockCounterClockwiseIcon aria-hidden="true" size={18} />}
          title={historyCreation.phase === "unknown" ? "创建结果暂时未知"
            : historyCreation.phase === "not-created" ? "尚未创建新版本"
              : historyCreation.phase === "creating" ? "正在创建新版本"
                : historyCreation.phase === "opening" ? "正在打开新版本" : "新版本已创建"}
          detail={historyCreation.phase === "unknown" ? "请查询同一操作，避免重复创建。"
            : historyCreation.phase === "not-created" ? "原有版本保留，可以重新创建。"
              : "创建完成后即使打开失败，也不会再创建另一个版本。"}
          actionLabel={historyCreation.phase === "unknown" ? "查询创建结果"
            : historyCreation.phase === "not-created" ? "重试创建" : "打开已创建版本"}
          actionDisabled={viewTransitioning || (historyCreation.phase === "not-created" && viewMode !== "history")}
          onAction={() => historyCreation.phase === "not-created" ? requestHistoryCreation() : void recoverHistoryCreation()}
        />
      ) : null}

      {settingsPageActive ? (
        <WorkbenchSettingsSidebar
          open={globalSidebarOpen}
          category={settingsCategory}
          onSelectCategory={(nextCategory) => {
            setSettingsCategory(nextCategory);
          }}
          onReturnToWorkbench={closeSettingsPage}
        />
      ) : projectCatalogCapability ? <WorkbenchGlobalSidebarContainer
        capability={projectCatalogCapability}
        open={globalSidebarOpen}
        currentProjectId={projectId}
        currentProjectName={currentProjectDisplayName}
        currentProjectDocumentId={documentId || null}
        currentProjectSourcePath={sourcePath || null}
        activeVersionId={presentation.isHistory ? viewingVersionId : null}
        currentDraftActive={!presentation.isHistory && !projectRulesPageActive && !startPageActive && !settingsPageActive}
        currentProjectBusy={projectHydrating || Boolean(projectLoadError) || viewTransitioning || runInProgress}
        projectRulesActive={projectRulesPageActive}
        onToggle={() => {
          setGlobalSidebarOpen((open) => !open);
        }}
        onOpenLocal={() => void openProject()}
        onOpenCurrentProject={openCurrentSidebarProject}
        onOpenHistoryVersion={openRegisteredSidebarVersion}
        updateActionVisible={updateActionVisible}
        updateDownloaded={updateDownloaded}
        updateDownloading={updateDownloading}
        updateResult={updateResult}
        updateBadgeLabel={updateBadgeLabel}
        onOpenAbout={openAboutStemmio}
        onOpenSettings={() => openSettingsPage("general")}
        onOpenProjectRules={openProjectRulesPage}
        onResizeCommit={(width) => workspacePreferencesController.commitPanelWidth("sidebar", width)}
        onDownloadOrRestartUpdate={() => {
          if (updateDownloaded) {
            void installDownloadedUpdate();
          } else if (updateResult?.status === "available") {
            void downloadAvailableUpdate();
          }
        }}
        openHtmlError={openHtmlError}
      /> : null}
      <WorkbenchDocumentSurfaceCache
        snapshot={documentSurfaceCacheSnapshot}
        visibleTabId={visibleCachedSurface?.tabId || null}
        visibleSourceSha256={visibleCachedSurface?.sourceSha256 || null}
        candidateTabId={candidateCachedSurface?.tabId || null}
        candidateSourceSha256={candidateCachedSurface?.sourceSha256 || null}
        onVisibleReady={retainPresentedTab} onHandoffComplete={completeHandoff}
        onHandoffScroll={updateHandoffScroll}
        onFirstScroll={markFirstScroll}
        height="var(--comment-canvas-height, 760px)"
      />
      {settingsPageActive ? (
        <SettingsPage
          activeTabId={activeWorkbenchTab.tabId}
          category={settingsCategory}
          initialFocus={settingsCategory}
          appVersion={applicationVersion}
          currentAgentName={agentPresentation.agentName || agentPresentation.displayName}
          updateResult={updateResult}
          updatesAvailable={desktopUpdatesAvailable}
          manualCheckPending={manualUpdateCheckPending}
          manualCheckFailed={manualUpdateCheckFailed}
          releaseNotesOpenFailed={releaseNotesOpenFailed}
          workspacePreferences={workspacePreferences}
          workspacePreferencesSaving={workspacePreferencesSnapshot.saving}
          workspacePreferencesError={workspacePreferencesSnapshot.error}
          agentChoices={agentProviderChoices}
          selectedAgentChoiceId={agentProviderChoices.find((choice) => choice.selection.providerId === workspacePreferences.defaultAgentProviderId)?.id ?? null}
          agentCards={agentCards}
          onUpdateWorkspacePreference={workspacePreferencesController.update}
          onRetryWorkspacePreferences={() => {
            workspacePreferencesController.retry();
          }}
          onSelectAgent={selectDefaultAgent}
          onClose={closeSettingsPage}
          onCheckForUpdates={() => void checkForApplicationUpdates()}
          onDownloadUpdate={() => void downloadAvailableUpdate()}
          onRequestRestart={() => {
            void installDownloadedUpdate();
          }}
          onOpenReleaseNotes={() => void openReleaseNotes()}
          onCheckUsability={checkAgentUsability}
          onCopyGuidance={copyAgentGuidance}
          onStartLogin={startAgentLogin}
          onReopenLogin={reopenAgentLogin}
          onLogoutAgent={(selection) => manageAgentAccess("logout", selection)}
          onInstall={installAgent}
          onCancelInstall={cancelAgentInstall}
          onConnectApiKey={connectAgentApiKey}
          onRetryPersistCredential={(selection) => (
            workspaceController?.retryAgentCredentialPersist?.(selection) ?? Promise.resolve({
              status: "rejected",
              reason: "没有可重试保存的 API Key。",
            })
          )}
          rememberedKey={agentCards.some((card) => (
            card.selection.providerId === "stemmio"
            && card.credentialPersist?.status === "saved"
          ))}
          onDisconnectApiKey={disconnectAgentApiKey}
          onDisconnectProvider={(selection) => manageAgentAccess("disconnect", selection)}
          onRemoveRememberedKey={(selection) => manageAgentAccess("remove-key", selection)}
          onReconnectProvider={(selection) => manageAgentAccess("reconnect", selection)}
          onOpenVendorApiKeyPage={openVendorApiKeyPage}
          providerAccessImpact={shellSnapshot?.run?.providerAccessImpact ?? {}}
          onSelectAgentModel={selectSettingsAgentModel}
          onSelectAgentReasoning={selectSettingsAgentReasoning}
        />
      ) : null}
      {!settingsPageActive && startPageActive && projectCatalogCapability ? (
        <WorkbenchStartPageContainer
          capability={projectCatalogCapability}
          activeTabId={activeWorkbenchTab.tabId}
          onOpenLocal={() => void openProject()}
          onOpenRegistered={openRegisteredWorkbenchProject}
        />
      ) : null}
      {projectRulesPageActive ? (
        <ProjectRulesEditorPage
          activeTabId={activeWorkbenchTab.tabId}
          capability={workspaceController!.projectRules}
          runLocked={runSnapshot.activeLocked || runInProgress}
          onChange={updateProjectRules}
          onBeginComposition={beginProjectRulesComposition}
          onFinishComposition={finishProjectRulesComposition}
          onRestore={restoreProjectRules}
          onSave={saveProjectRules}
          onRetry={retryProjectRules}
        />
      ) : null}
      <div
        id="workbench-content-outlet"
        role="tabpanel"
        aria-labelledby={`workbench-tab-${activeWorkbenchTab.tabId}`}
        ref={reviewStageRef}
        className="review-scroll-stage"
        data-inspector={workbenchInspector}
        data-review-active={readyReviewOverlay ? "true" : undefined}
        data-surface-hidden={settingsPageActive || startPageActive || projectRulesPageActive
          ? "true"
          : undefined}
      >
        {readyReviewOverlay}
        <section
          className="canvas-column"
          aria-label="页面画布"
          inert={readyReviewOverlay ? true : undefined}
          aria-hidden={readyReviewOverlay ? true : undefined}
        >
          <div
            className="canvas-edit-surface"
            data-testid="workbench-active-document-canvas"
            data-runtime-hot-count={activeRuntimeCanvasMounted ? 1 : 0}
            data-runtime-hot-limit={1}
            data-edit-runtime-phase={editRuntimePhase}
            data-edit-runtime-outcome={editRuntimeSnapshot?.lastOutcome || undefined}
            hidden={displayedCanvasMode !== "edit"}
            aria-hidden={displayedCanvasMode !== "edit" || cachedSurfaceBlocksCanvas}
            inert={cachedSurfaceBlocksCanvas ? true : undefined}
          >
            {!desktopHostReady ? (
              <div className="canvas-loading" role="status">正在识别运行环境…</div>
            ) : desktopHostIssue ? (
              <div className="canvas-loading" role="alert">
                <strong>桌面运行环境未初始化</strong>
                <span>{desktopHostIssue}</span>
              </div>
            ) : (
              <>
                {staticFallbackNoticeIdentity ? (
                  <EditRuntimeStaticFallbackNotice
                    key={staticFallbackNoticeIdentity}
                    state={runtimeNoticeState}
                    {...(editRuntimeSnapshot?.retryAvailable
                      ? {
                          onRetry: runtimeNoticeState === "last-known-good-readonly"
                            ? reloadFailedCanvas
                            : () => workspaceControllerRef.current?.retryEditAuthorRuntime() ?? false,
                        }
                      : {})}
                    onExport={() => {
                      void exportCurrentHtml();
                    }}
                  />
                ) : null}
                <WorkbenchActiveDocumentCanvas
                  activeTabId={documentRuntimeTabId}
                  activeSourceSha256={sourceSha256}
                  activeElement={activeRuntimeCanvasMounted ? (
                    <HtmlCanvasEditor
                  key={`editor-authority-${documentRuntimeTabId || "none"}`}
                  ref={editorRef}
                  html={html}
                  sourceReceipt={documentSnapshot.sourceReceipt}
                  semanticRevision={editRevision}
                  sourcePath={canvasSourcePath}
                  height="var(--comment-canvas-height, 760px)"
                  onChange={handleCanvasChange}
                  onInteraction={() => {
                    if (commentCanvasPort.getSnapshot().relinkingTarget) {
                      commentCanvasPort.armRelinkSelection();
                    }
                  }}
                  editRuntimeGrant={editRuntimeGrant}
                  onEditRuntimeLoadStart={(grant, attempt) => {
                    workspaceControllerRef.current?.beginEditAuthorRuntime({
                      sessionId: grant.sessionId,
                      sourceSha256: grant.sourceSha256,
                      canvasGeneration: grant.canvasGeneration,
                      candidateId: attempt.candidateId,
                      candidateGeneration: attempt.generation,
                      candidateSourceRevision: attempt.sourceRevision,
                    });
                  }}
                  onEditRuntimeLoadOutcome={(grant, outcome: HtmlCanvasEditRuntimeLoadOutcome, attempt, settlement) => {
                    workspaceControllerRef.current?.settleEditAuthorRuntime({
                      sessionId: grant.sessionId,
                      sourceSha256: grant.sourceSha256,
                      canvasGeneration: grant.canvasGeneration,
                      candidateId: attempt.candidateId,
                      candidateGeneration: attempt.generation,
                      candidateSourceRevision: attempt.sourceRevision,
                      outcome,
                      preserveLastKnownGood: settlement.preserveLastKnownGood,
                      runtimePartial: settlement.runtimePartial,
                    });
                  }}
                  onRuntimeDegradationChange={(state) => {
                    setRuntimeDegradationSnapshot({ key: runtimeDegradationKey, state });
                  }}
                  onCommentLayout={commentCanvasPort.publishLayout}
                  onSelect={handleCanvasSelection}
                  onRequestComment={openCommentComposer}
                  onRequestFlush={requestUserFlush}
                  onRequestExport={() => {
                    void exportCurrentHtml();
                  }}
                  onRequestHistory={(direction) => {
                    void requestSourceHistoryAction(direction);
                  }}
                  onRequestReload={() => {
                    if (currentProjectSessionSnapshot().sourcePath) {
                      void reloadCurrentSource();
                    } else {
                      void openProject();
                    }
                  }}
                  reloadActionLabel={sourcePath ? "重新载入" : "重新选择"}
                  usageProjectId={projectId || undefined}
                  usageCapture={captureUsageEvent}
                  commentedTargets={commentedTargets}
                  trackedTargets={trackedAuditTargets}
                  pageViewContext={activePageViewContext}
                  pageViewDocumentKey={pageViewDocumentKey}
                  onPageViewContextChange={acceptPageViewContext}
                  locked={
                    runInProgress
                    || projectHydrating
                    || Boolean(projectLoadError)
                    || viewTransitioning
                    || persistState === "conflict"
                  }
                  readOnly={viewMode === "history"
                    || runtimeDegradation === "static-preparing"
                    || runtimeDegradation === "last-known-good-readonly"}
                  interactionMode={viewMode === "history"
                    ? "history"
                    : runInProgress || projectHydrating || workspaceIssue
                      ? "processing"
                      : "editing"}
                  enableReorder={!interactionLocked}
                  pointerCapabilityHoverEnabled={!isBuiltInWelcomePage}
                    />
                  ) : null}
                />
              </>
            )}
          </div>
          {displayedCanvasMode === "preview" && documentRuntimeTabId ? (
            <HtmlInteractionPreview
              key={`preview-authority-${canvasGeneration}-${historyPreview?.versionId || "current"}`}
              ref={interactionPreviewRef}
              html={interactionPreviewHtml}
              staticFallbackOnFailure={Boolean(historyPreview)}
              documentKey={historyPreview ? `${pageViewDocumentKey}:${historyPreview.versionId}` : pageViewDocumentKey}
              sourcePath={sourcePath || undefined}
              height="100%"
              comments={historyPreview ? versions.find((version) => version.id === historyPreview.versionId)?.comments || [] : comments}
              transport="independent-url"
              onReady={historyPreview ? undefined : handlePreviewReady}
              presentationCovered={cachedSurfaceBlocksCanvas}
              initialScrollTop={historyPreview ? undefined : activeDocumentPresentation?.scrollTop}
              onScrollTopChange={(scrollTop) => {
                if (!historyPreview && activeWorkbenchTab.kind === "document") {
                  workspaceController?.updateDocumentSurfacePresentation(
                    activeWorkbenchTab.tabId,
                    { scrollTop },
                  );
                }
              }}
            />
          ) : null}
        </section>

          {workbenchInspector === "ai" && runCapability ? (
          <aside className="ai-conversation-aside" aria-label="AI 助手侧栏">
            <WorkbenchResizer
              kind="inspector"
              onCommit={(width) => workspacePreferencesController.commitPanelWidth("inspector", width)}
            />
            <RunConversationOutlet
              capability={runCapability}
              conversationCapability={workspaceController!.conversation}
              conversationContext={aiConversation.context}
              sidebarProps={{
                ...aiConversation.sidebarProps,
                onAction: handleAiDecision,
                agentAccess,
              }}
              reviewing={false}
              deliveryMode={currentAgentDeliveryMode}
            />
          </aside>
        ) : null}

        {workbenchInspector === "comments" && workspaceController ? (
          <CommentRailContainer
            capability={workspaceController.comments as CommentRailCapability}
            canvasPort={commentCanvasPort}
            context={commentRailContext}
            actions={commentRailActions}
          />
        ) : null}
      </div>

      {previewAttachment && attachmentObjectUrls[previewAttachment.attachmentId] ? (
        <AttachmentLightbox
          fileName={previewAttachment.fileName}
          sizeLabel={formatFileSize(previewAttachment.byteLength)}
          src={attachmentObjectUrls[previewAttachment.attachmentId]}
          onClose={() => setPreviewAttachment(null)}
        />
      ) : null}

      {workspaceController && preservedDraftDialogOpen ? <PreservedDraftDialog key={`${projectId}:${documentId}`} open
        contextKey={`${projectId}:${documentId}`} onClose={() => setPreservedDraftDialogOpen(false)}
        onLoad={loadPreservedDrafts} onRestore={(recoveryId) => workspaceController.restorePreservedDraft({ recoveryId })} /> : null}
      <HistoryCreationDialog
        open={Boolean(historyCreationConfirmation && historyCreationConfirmation === `${projectId}:${documentId}:${viewingVersionId}` && viewMode === "history")}
        versionLabel={viewingVersion?.label || "历史版本"}
        onClose={() => setHistoryCreationConfirmation(null)}
        onConfirm={() => void createHistoryVersion()}
      />
      <CancelAiRunDialog
        open={cancelRunConfirmationOpen}
        onClose={() => setCancelRunConfirmationKey(null)}
        onConfirm={() => {
          const currentRun = currentRunSessionSnapshot().activeRun;
          const matchesConfirmation = Boolean(
            currentRun
            && cancelRunConfirmationKey
            && activeRunOperationKey(currentRun) === cancelRunConfirmationKey,
          );
          setCancelRunConfirmationKey(null);
          if (matchesConfirmation) {
            void cancelActiveRun({ agentMayBeRunning: true });
          }
        }}
      />

      <AboutStemmioDialog
        open={aboutOpen}
        appVersion={applicationVersion}
        architecture={updateResult?.architecture}
        repositoryOpenFailed={repositoryOpenFailed}
        userNoticeOpenFailed={userNoticeOpenFailed}
        onClose={closeAboutStemmio}
        onOpenRepository={() => void openProjectRepository()}
        onOpenUserNotice={() => void openUserNotice()}
      />

      {presentedInterruption && !readyReviewSession ? (
        <NoticeBar
          className="toast"
          title={presentedInterruption.title}
          message={presentedInterruption.message}
          tone={presentedInterruption.tone}
          actionLabel={presentedInterruption.actionLabel || undefined}
          dismissMs={presentedInterruption.dismissMs}
          paused={noticeTimerPaused}
          repeatCount={1}
          onAction={presentedInterruption.actionId
            ? handleInterruptionAction
            : undefined}
          onDismiss={() => setInterruption(null)}
          usageCode={noticeUsageCode(presentedInterruption.usageKey)}
          usageDisposition="inform-in-place"
          usageSurface="global"
          usageProjectId={projectId || undefined}
          usageCapture={captureUsageEvent}
          onPauseChange={(paused) => {
            setPausedNoticeIdentity(paused ? noticeIdentity : null);
          }}
        />
      ) : null}
      </main>
    </>
  );
}

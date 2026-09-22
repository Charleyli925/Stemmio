"use client";

import { UserIcon } from "@phosphor-icons/react/dist/csr/User";
import { RobotIcon } from "@phosphor-icons/react/dist/csr/Robot";
import { CheckIcon } from "@phosphor-icons/react/dist/csr/Check";
import { CaretRightIcon } from "@phosphor-icons/react/dist/csr/CaretRight";
import { CaretDownIcon } from "@phosphor-icons/react/dist/csr/CaretDown";

import { createExecutionClock } from "./execution-clock.js";
import {
  Fragment,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  sidebarActionBar,
  sidebarMessageStream,
  sidebarTurnPresentation,
  sidebarNarrationParagraphs,
  sidebarNarrationPreview,
  sidebarActivityTimeline,
  sidebarProcessRows,
  sidebarModePresentation,
  sidebarResolvedIntent,
  sidebarRunProgress,
  sidebarSendState,
  sidebarCopyTaskState,
  sidebarExecutionStatus,
  sidebarTimestampLabel,
  type SidebarCatalogStatus,
  type SidebarHistoryGroup,
  type SidebarMessage,
} from "./ai-conversation-model.js";
import type { RunPublicActivity } from "../application/run-session.js";
import type { AgentSelection } from "../domain/agent-provider-state.js";
import { type BoundAgentSetupPanelProps } from "../components/AgentSetupPanel";
import type { AgentProviderCardData } from "../components/agent-provider-card-types";
import { agentServiceLabel } from "../application/workspace-agent-preference.js";
import { copyText } from "./browser-io";
import styles from "./ai-conversation-sidebar.module.css";

// The AI conversation sidebar.
//
// Four fixed regions, top to bottom: header, message stream, action bar,
// Composer. The split is load-bearing, not cosmetic:
//
//   - The message stream carries immutable facts only. It never renders a
//     button, so scrolling back through history cannot surface a stale action.
//   - The action bar holds whatever the user can decide right now and does not
//     scroll. In a 400px sidebar a decision parked in the stream disappears once
//     the conversation grows, leaving a pending decision the user cannot see.
//   - The Composer holds the modification context, model and delivery actions.
//
// This component is presentation only. It owns no durable state and reaches no
// Bridge; the workflow layer supplies data and receives intents.

export type AiConversationSidebarProps = {
  documentKey?: string;
  readingStateKey?: string;
  readingStateStore?: SidebarReadingStateStore;
  state: string;
  title: string;
  messages: readonly unknown[];
  draftText?: string;
  draftAvailable?: boolean;
  onDraftTextChange?: (text: string) => void;
  historyGroups?: readonly SidebarHistoryGroup[];
  catalogStatus?: SidebarCatalogStatus;
  catalogReason?: string | null;
  agentDisplayName?: string | null;
  executionDisplayName?: string | null;
  agentActionName?: string | null;
  agentSettingsName?: string | null;
  agentSettingsSupported?: boolean;
  credentialKind?: "api-token" | null;
  models?: readonly Readonly<{
    id: string;
    displayName: string;
  }>[];
  selectedModelId?: string | null;
  reasoningChoices?: readonly Readonly<{
    id: string;
    label: string;
  }>[];
  selectedReasoningId?: string | null;
  candidateVersionLabel?: string | null;
  candidateStatus?: string | null;
  runStatus?: string | null;
  failureMessage?: string | null;
  failureCode?: string | null;
  failureRetryable?: boolean;
  failureRecoveryKind?: "retry" | "wait" | "reauthenticate" | "change-model" | "change-provider" | "repair-installation" | "end" | null;
  contextLabel?: string | null;
  pendingCommentCount?: number;
  queued?: boolean;
  loading?: boolean;
  onSend?: () => void;
  onAction?: (actionId: string) => void;
  onClose?: () => void;
  onOpenAgentSettings?: () => void;
  onSelectModel?: (modelId: string) => void;
  onSelectReasoning?: (reasoning: string) => void;
  /** Hands the same round to the clipboard instead of the local Agent. */
  onCopyTask?: () => void;
  agentAccess?: Readonly<{
    cards: readonly AgentProviderCardData[];
    documentId: string;
    recovery?: null | Readonly<{
      documentId: string;
      providerId: string | null;
      field: "apiKey" | "login" | "install" | "model" | "provider";
      requestId?: string;
      attemptId?: string;
      lastOutcome?: Readonly<{
        status: string;
        code: string | null;
        reason: string;
      }> | null;
    }>;
    bindings: Omit<
      BoundAgentSetupPanelProps,
      "card" | "surface" | "hideDisconnectAction" | "initialApiKeyOpen" | "actionButtonRef"
    >;
    onSelect(selection: AgentSelection): void | Promise<boolean>;
    onQueueDefault?(selection: AgentSelection): void;
    onReconnect?(selection: AgentSelection): Promise<unknown>;
    onBeginAccessRepair?(field?: "apiKey" | "login" | "install" | "model" | "provider"): void;
  }>;
  /** Stable public message rows from canonical visible-text events. */
  agentUpdates?: readonly unknown[];
  /** True only when a bounded public-text projection omitted a suffix. */
  agentTextTruncated?: boolean;
  agentActivities?: readonly RunPublicActivity[];
  agentActivitiesTruncated?: boolean;
  /** A managed Agent is actively thinking or processing this round. */
  agentWorking?: boolean;
  agentStartedAt?: string | null;
  agentLastActivityAt?: string | null;
  agentReceivedBytes?: number;
  agentUpdatedAt?: string | null;
  /** A frozen Request identity, used solely to follow the round the user started. */
  runKey?: string | null;
  /** The Request identity used for per-round reading preferences. */
  roundKey?: string | null;
  runCommentCount?: number | null;
  agentPresentation?: Readonly<{
    providerId: string;
    displayName: string;
    agentName: string;
    logoSrc: string | null;
  }> | null;
  /** Which destination this round uses; the decision bar copy depends on it. */
  deliveryMode?: "managed-agent" | "clipboard";
  /** The run's own progress steps, so a round in flight reads inside the thread. */
  runSteps?: readonly unknown[];
  /** User-facing name of the HTML this round belongs to. */
  sourceFileName?: string | null;
  handoffStatus?: string | null;
};

type CopyFeedback = Readonly<{
  key: string;
  label: "已复制" | "复制失败";
}> | null;

export type SidebarReadingAnchor = Readonly<{
  messageId: string;
  offset: number;
}>;

export type SidebarReadingState = Readonly<{
  documentKey: string;
  roundKey: string | null;
  processExpanded: boolean;
  following: boolean;
  anchor: SidebarReadingAnchor | null;
  /** Stable historical process disclosures restored with the open tab. */
  expandedHistoryKeys?: readonly string[];
}>;

export type SidebarReadingStateStore = Readonly<{
  get(key: string): SidebarReadingState | null | undefined;
  set(key: string, state: SidebarReadingState): void;
}>;

const FOLLOW_THRESHOLD_PX = 48;

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function AgentAvatar({
  presentation,
}: {
  presentation: AiConversationSidebarProps["agentPresentation"];
}) {
  if (presentation?.logoSrc && presentation.providerId !== "stemmio") {
    return (
      <span className={`${styles.avatar} ${styles.agentAvatar}`} aria-hidden="true">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={presentation.logoSrc} alt="" />
      </span>
    );
  }
  return (
    <span className={`${styles.avatar} ${styles.agentAvatar}`} aria-hidden="true">
      <RobotIcon size={16} weight="regular" />
    </span>
  );
}

function StemmioAvatar() {
  return (
    <span className={`${styles.avatar} ${styles.stemmioAvatar}`} aria-hidden="true">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="./brand-logo.png" alt="" />
    </span>
  );
}

function AgentChoiceMark({
  label,
  logoSrc,
}: {
  label: string;
  logoSrc?: string | null;
}) {
  return (
    <span className={styles.agentChoiceMark} aria-hidden="true">
      {logoSrc ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logoSrc} alt="" />
      ) : label.trim().charAt(0).toUpperCase() || "A"}
    </span>
  );
}

function ExecutionStatusLeaf({
  state,
  providerName,
  startedAt,
  receivedBytes,
  runKey,
}: {
  state: string;
  providerName: string;
  startedAt: string | null;
  receivedBytes: number;
  runKey: string | null;
}) {
  const [clockNow, setClockNow] = useState(0);
  const executionClockRef = useRef<{
    key: string;
    running: boolean;
    clock: ReturnType<typeof createExecutionClock>;
  } | null>(null);
  const clockKey = `${runKey || ""}:${startedAt || ""}`;

  useEffect(() => {
    if (!executionClockRef.current || executionClockRef.current.key !== clockKey
      || !executionClockRef.current.running) {
      executionClockRef.current = {
        key: clockKey,
        running: true,
        clock: createExecutionClock({ startedAt }),
      };
    }
    const clock = executionClockRef.current.clock;
    setClockNow(clock.sample());
    const timer = window.setInterval(() => setClockNow(clock.sample()), 1_000);
    const resume = () => {
      if (document.visibilityState === "visible") setClockNow(clock.sample({ resume: true }));
    };
    document.addEventListener("visibilitychange", resume);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", resume);
      if (executionClockRef.current?.key === clockKey) {
        executionClockRef.current.running = false;
      }
    };
  }, [clockKey, startedAt]);

  const status = sidebarExecutionStatus({
    state,
    providerName,
    startedAt,
    receivedBytes,
    now: clockNow,
  });
  if (!status) return null;
  return (
    <small
      className={styles.executionMeta}
      data-testid="ai-conversation-execution-status"
    >
      {status.meta}
    </small>
  );
}

export default function AiConversationSidebar({
  state,
  title,
  messages,
  documentKey = "",
  readingStateKey = documentKey || "conversation",
  readingStateStore,
  draftText = "",
  draftAvailable = false,
  onDraftTextChange,
  historyGroups = [],
  catalogStatus = "ready",
  catalogReason = null,
  agentDisplayName = null,
  executionDisplayName = null,
  agentActionName = "Agent",
  agentSettingsName = "Agent",
  agentSettingsSupported = true,
  credentialKind = null,
  models = [],
  selectedModelId = null,
  candidateVersionLabel = null,
  candidateStatus = null,
  runStatus = null,
  failureMessage = null,
  failureCode = null,
  failureRetryable = true,
  failureRecoveryKind = null,
  contextLabel = null,
  pendingCommentCount = 0,
  queued = false,
  loading = false,
  onSend,
  onAction,
  onClose,
  onOpenAgentSettings,
  onCopyTask,
  agentAccess,
  deliveryMode = "managed-agent",
  agentUpdates = [],
  agentTextTruncated = false,
  agentActivities = [],
  agentActivitiesTruncated = false,
  agentWorking = false,
  agentStartedAt = null,
  agentReceivedBytes = 0,
  runKey = null,
  roundKey = runKey,
  runCommentCount = null,
  agentPresentation = null,
  runSteps = [],
  sourceFileName = null,
  handoffStatus = null,
}: AiConversationSidebarProps) {

  const storedReadingState = readingStateStore?.get(readingStateKey) || null;
  const initialReadingState = storedReadingState?.documentKey === documentKey
    ? storedReadingState
    : null;
  const [hasUnseenContent, setHasUnseenContent] = useState(false);
  const [readingHistory, setReadingHistory] = useState(initialReadingState?.following === false);
  const [copyFeedback, setCopyFeedback] = useState<CopyFeedback>(null);
  const [processExpanded, setProcessExpanded] = useState(
    () => initialReadingState?.processExpanded === true,
  );
  const processExpandedRef = useRef(processExpanded);
  const streamRef = useRef<HTMLDivElement | null>(null);
  const bottomSentinelRef = useRef<HTMLDivElement | null>(null);
  const liveMessageRef = useRef<HTMLElement | null>(null);
  const followingRef = useRef(initialReadingState?.following !== false);
  const disclosureReadingRef = useRef(false);
  const readingAnchorRef = useRef<SidebarReadingAnchor | null>(initialReadingState?.anchor || null);
  const pendingReadingAnchorRef = useRef<SidebarReadingAnchor | null>(null);
  const [expandedHistoryKeys, setExpandedHistoryKeys] = useState(
    () => new Set(initialReadingState?.expandedHistoryKeys || []),
  );
  const expandedHistoryKeysRef = useRef(expandedHistoryKeys);
  const contentKeyRef = useRef<string | null>(null);
  const roundKeyRef = useRef<string | null>(initialReadingState?.roundKey || null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const followFrameRef = useRef<number | null>(null);
  const followBehaviorRef = useRef<ScrollBehavior>("auto");
  const followForceRef = useRef(false);
  const restoreFrameRef = useRef<number | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const narrationPanelId = `ai-conversation-narration-panel-${useId().replace(/:/gu, "")}`;
  const resolvedAgentActionName = agentPresentation?.agentName
    || agentActionName
    || "Agent";
  const resolvedAgentSettingsName = agentSettingsName || resolvedAgentActionName;
  const stream = useMemo(() => sidebarMessageStream(messages), [messages]);
  const activeIntent = sidebarResolvedIntent(state);
  // Product state alone determines the one available action and mode copy.
  const mode = sidebarModePresentation(state);
  const actionBar = useMemo(
    () => sidebarActionBar({
      state,
      runStatus,
      candidateVersionLabel,
      candidateStatus,
      failureMessage,
      failureCode,
      failureRetryable,
      failureRecoveryKind,
      deliveryMode,
      handoffStatus,
      credentialKind,
    }),
    [
      candidateStatus,
      candidateVersionLabel,
      credentialKind,
      deliveryMode,
      failureMessage,
      failureCode,
      failureRetryable,
      failureRecoveryKind,
      handoffStatus,
      runStatus,
      state,
    ],
  );
  const send = sidebarSendState({
    state,
    catalogStatus,
    catalogReason,
    queued,
    intent: activeIntent,
    pendingCommentCount,
    agentName: resolvedAgentActionName,
    agentSettingsName: resolvedAgentSettingsName,
    agentSettingsSupported,
    credentialKind,
  });
  // The clipboard button does not read the model catalog: copying is a branch
  // of the same round that never consults the selected Agent, so an unreadable catalog must
  // not grey it out with the send button it sits beside.
  const copyTask = sidebarCopyTaskState({
    state,
    queued,
    pendingCommentCount,
    agentName: resolvedAgentActionName,
  });
  const runProgress = sidebarRunProgress({
    state,
    steps: runSteps,
    agentUpdates,
    agentTextTruncated,
  });
  // The clock/status leaf follows the existing public status contract: it is
  // present only while the durable sidebar state is processing. A cancelling
  // or failed handoff must keep the existing decision/recovery surface.
  const executionStatusActive = agentWorking && state === "processing";
  const executionProviderName = executionDisplayName
    || agentDisplayName
    || agentPresentation?.displayName
    || agentPresentation?.agentName
    || resolvedAgentActionName;
  const selectedModel = models.find((model) => model.id === selectedModelId) || models[0] || null;
  const schemeName = (typeof agentDisplayName === "string" && agentDisplayName.trim())
    || resolvedAgentActionName;
  const recovery = agentAccess?.recovery || null;
  const currentProviderId = agentPresentation?.providerId
    || "";
  const currentCard = agentAccess?.cards.find((card) => card.selection.providerId === currentProviderId)
    || null;
  const serviceTriggerLabel = (() => {
    const name = agentServiceLabel(currentProviderId, schemeName);
    const currentCardForLabel = currentCard;
    if (currentProviderId === "stemmio" && catalogStatus === "ready") {
      const vendor = currentCardForLabel?.connection?.vendorDisplayName
        || currentCardForLabel?.connection?.vendorId
        || "兼容接口";
      return `${vendor} · ${selectedModel?.displayName || "当前模型"}`;
    }
    if (catalogStatus === "ready") {
      return `${name} · ${selectedModel?.displayName || "默认模型"}`;
    }
    return name;
  })();
  const recoveredOnOrigin = Boolean(
    recovery
    && catalogStatus === "ready"
    && recovery.documentId === (agentAccess?.documentId || ""),
  );
  const recoveredElsewhere = Boolean(
    recovery
    && catalogStatus === "ready"
    && recovery.documentId
    && recovery.documentId !== (agentAccess?.documentId || ""),
  );
  const resolvedFileName = sourceFileName?.trim() || "当前 HTML";
  const contextContents = `${Math.max(0, Number(runCommentCount ?? pendingCommentCount) || 0)} 条评论、当前 HTML 和项目规则`;
  const runSummary = runKey
    ? runKey.startsWith("pending:")
      ? {
          title: `正在准备“${resolvedFileName}”`,
          detail: `正在整理${contextContents}。`,
        }
      : deliveryMode === "managed-agent" && handoffStatus
        ? {
            title: `已将“${resolvedFileName}”交给 ${resolvedAgentActionName}`,
            detail: `发送了${contextContents}。`,
          }
        : deliveryMode === "clipboard" && handoffStatus === "copied"
          ? {
              title: `已复制“${resolvedFileName}”的修改要求`,
              detail: `包含${contextContents}。`,
            }
          : {
              title: `已准备“${resolvedFileName}”的修改要求`,
              detail: `包含${contextContents}。`,
            }
    : null;
  const contentKey = [
    runKey || "",
    agentActivities.map((activity) => activity.id).join(","),
    agentActivitiesTruncated ? "activities-truncated" : "",
    runProgress?.liveLabel || runProgress?.headline || "",
    runProgress?.narrationUpdates?.map((update) => `${update.id}:${update.text.length}`).join(",") || "",
    runProgress?.narrationTruncated ? "truncated" : "",
    stream.map((message) => `${message.messageId}:${message.sequence}:${message.text.length}`).join(","),
  ].join("|");
  const liveNarrationUpdates = runProgress?.narrationUpdates || null;
  const displayedGroups = useMemo(() => {
    const groups = historyGroups.length ? [...historyGroups] : [{
      key: "messages", label: "", kind: "current", messageIndices: stream.map((_message, index) => index),
    }];
    // Conversation reads can lag the Run. Keep its receipt-keyed row outside
    // historical groups until the stored turn identity arrives.
    if (runKey && (liveNarrationUpdates || agentActivities.length > 0 || executionStatusActive)
      && !groups.some((group) => group.kind === "current")
      && !stream.some((message) => message.kind === "process-summary"
        && `${message.requestId}:${message.attemptId}` === runKey)) {
      groups.push({ key: "active-process", label: "", kind: "current", messageIndices: [], messageIds: [] });
    }
    return groups.map((group) => {
      const messages = stream.filter((_message, index) => group.messageIndices.includes(index));
      if (group.kind === "current" && runKey && (liveNarrationUpdates || agentActivities.length > 0 || executionStatusActive)
        && !messages.some((message) => message.kind === "process-summary"
          && `${message.requestId}:${message.attemptId}` === runKey)) {
        const [requestId, attemptId] = runKey.split(":");
        const narration: SidebarMessage = {
          messageId: `narration:${runKey}`, actor: "agent", actorLabel: executionProviderName,
          kind: "process-summary", status: "completed", text: "", truncated: false,
          sequence: 0, createdAt: "", modelDisplayName: null, turnId: null,
          requestId, attemptId,
        };
        const terminal = messages.findIndex((message) => message.requestId === requestId
          && message.attemptId === attemptId
          && ["result-summary", "decision-outcome", "error"].includes(message.kind));
        messages.splice(terminal < 0 ? messages.length : terminal, 0, narration);
      }
      return { ...group, ...sidebarTurnPresentation(messages) };
    });
  }, [historyGroups, stream, runKey, liveNarrationUpdates, agentActivities.length, executionStatusActive, executionProviderName]);

  const persistReadingState = useCallback(() => {
    if (!readingStateStore) return;
    readingStateStore.set(readingStateKey, {
      documentKey,
      roundKey: roundKeyRef.current,
      processExpanded: processExpandedRef.current,
      following: followingRef.current,
      anchor: readingAnchorRef.current,
      expandedHistoryKeys: Object.freeze([...expandedHistoryKeysRef.current]),
    });
  }, [documentKey, readingStateKey, readingStateStore]);

  const findVisibleAnchor = useCallback((): SidebarReadingAnchor | null => {
    const streamElement = streamRef.current;
    if (!streamElement) return null;
    const streamTop = streamElement.getBoundingClientRect().top;
    const elements = Array.from(
      streamElement.querySelectorAll<HTMLElement>("[data-reading-anchor-id]"),
    );
    const visible = elements.find((element) => {
      const rect = element.getBoundingClientRect();
      return rect.bottom > streamTop + 1;
    }) || elements.at(-1);
    const messageId = visible?.dataset.readingAnchorId;
    if (!visible || !messageId) return null;
    return Object.freeze({
      messageId,
      offset: visible.getBoundingClientRect().top - streamTop,
    });
  }, []);

  const queueRestoreAnchor = useCallback((anchor: SidebarReadingAnchor | null) => {
    if (!anchor || typeof window === "undefined") return;
    pendingReadingAnchorRef.current = anchor;
    if (restoreFrameRef.current !== null) return;
    restoreFrameRef.current = window.requestAnimationFrame(() => {
      restoreFrameRef.current = null;
      const streamElement = streamRef.current;
      const currentAnchor = pendingReadingAnchorRef.current;
      pendingReadingAnchorRef.current = null;
      if (!streamElement || !currentAnchor || followingRef.current) return;
      const selection = window.getSelection?.();
      if (selection && !selection.isCollapsed
        && (streamElement.contains(selection.anchorNode) || streamElement.contains(selection.focusNode))) return;
      const element = Array.from(
        streamElement.querySelectorAll<HTMLElement>("[data-reading-anchor-id]"),
      ).find((candidate) => candidate.dataset.readingAnchorId === currentAnchor.messageId);
      if (!element) return;
      const streamTop = streamElement.getBoundingClientRect().top;
      const offset = element.getBoundingClientRect().top - streamTop;
      streamElement.scrollTop += offset - currentAnchor.offset;
    });
  }, []);

  const captureReadingAnchor = useCallback(() => {
    if (followingRef.current) return readingAnchorRef.current;
    const anchor = findVisibleAnchor();
    if (anchor) {
      readingAnchorRef.current = anchor;
      persistReadingState();
    }
    return anchor;
  }, [findVisibleAnchor, persistReadingState]);

  const scrollToLatest = useCallback((behavior: ScrollBehavior = "auto") => {
    const streamElement = streamRef.current;
    if (!streamElement) return;
    const resolvedBehavior = behavior === "smooth" && !prefersReducedMotion()
      ? "smooth"
      : "auto";
    streamElement.scrollTo({ top: streamElement.scrollHeight, behavior: resolvedBehavior });
  }, []);

  const scheduleFollow = useCallback((behavior: ScrollBehavior = "auto", force = false) => {
    if (typeof window === "undefined") return;
    followBehaviorRef.current = behavior;
    followForceRef.current = followForceRef.current || force;
    if (followFrameRef.current !== null) return;
    followFrameRef.current = window.requestAnimationFrame(() => {
      followFrameRef.current = null;
      const forceFollow = followForceRef.current;
      followForceRef.current = false;
      const streamElement = streamRef.current;
      if (!streamElement || (!followingRef.current && !forceFollow)) return;
      const selection = window.getSelection?.();
      if (!forceFollow && selection && !selection.isCollapsed
        && (streamElement.contains(selection.anchorNode) || streamElement.contains(selection.focusNode))) {
        followingRef.current = false;
        const anchor = findVisibleAnchor();
        if (anchor) readingAnchorRef.current = anchor;
        setReadingHistory(true);
        persistReadingState();
        return;
      }
      scrollToLatest(followBehaviorRef.current);
    });
  }, [findVisibleAnchor, persistReadingState, scrollToLatest]);

  const onStreamScroll = useCallback(() => {
    const streamElement = streamRef.current;
    if (!streamElement || disclosureReadingRef.current) return;
    const distanceFromBottom = Math.max(
      0,
      streamElement.scrollHeight - streamElement.clientHeight - streamElement.scrollTop,
    );
    followingRef.current = distanceFromBottom <= FOLLOW_THRESHOLD_PX;
    setReadingHistory(!followingRef.current);
    if (followingRef.current) {
      readingAnchorRef.current = null;
      setHasUnseenContent(false);
    } else {
      captureReadingAnchor();
    }
    persistReadingState();
  }, [captureReadingAnchor, persistReadingState]);

  const revealLatest = useCallback(() => {
    disclosureReadingRef.current = false;
    followingRef.current = true;
    setReadingHistory(false);
    readingAnchorRef.current = null;
    setHasUnseenContent(false);
    persistReadingState();
    scheduleFollow("smooth", true);
  }, [persistReadingState, scheduleFollow]);

  const prepareDisclosure = useCallback((element: HTMLElement) => {
    // Layout-induced scroll events must not cancel explicit disclosure intent.
    disclosureReadingRef.current = true;
    followingRef.current = false;
    setReadingHistory(true);
    const article = element.closest<HTMLElement>("[data-reading-anchor-id]");
    const streamElement = streamRef.current;
    if (article?.dataset.readingAnchorId && streamElement) {
      readingAnchorRef.current = {
        messageId: article.dataset.readingAnchorId,
        offset: article.getBoundingClientRect().top - streamElement.getBoundingClientRect().top,
      };
    } else readingAnchorRef.current = findVisibleAnchor();
    persistReadingState();
  }, [findVisibleAnchor, persistReadingState]);

  const settleDisclosure = useCallback((key: string, open: boolean) => {
    const next = new Set(expandedHistoryKeysRef.current);
    if (open) next.add(key);
    else next.delete(key);
    expandedHistoryKeysRef.current = next;
    setExpandedHistoryKeys(next);
    persistReadingState();
    queueRestoreAnchor(readingAnchorRef.current);
  }, [persistReadingState, queueRestoreAnchor]);

  const toggleProcess = useCallback((key: string, current: boolean, element: HTMLElement) => {
    prepareDisclosure(element);
    const next = current ? !processExpandedRef.current : !expandedHistoryKeysRef.current.has(key);
    if (current) {
      processExpandedRef.current = next;
      setProcessExpanded(next);
    }
    settleDisclosure(key, next);
  }, [prepareDisclosure, settleDisclosure]);

  const copyMessage = useCallback((key: string, value: string) => {
    if (!value) return;
    void copyText(value).then(() => {
      setCopyFeedback({ key, label: "已复制" });
    }, () => {
      setCopyFeedback({ key, label: "复制失败" });
    }).finally(() => {
      if (copyTimerRef.current !== null) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopyFeedback(null), 1_800);
    });
  }, [setCopyFeedback]);

  useEffect(() => () => {
    if (copyTimerRef.current !== null) clearTimeout(copyTimerRef.current);
  }, []);

  useEffect(() => {
    if (roundKey && roundKey !== roundKeyRef.current) {
      roundKeyRef.current = roundKey;
      disclosureReadingRef.current = false;
      processExpandedRef.current = false;
      setProcessExpanded(false);
      followingRef.current = true;
      setReadingHistory(false);
      readingAnchorRef.current = null;
      pendingReadingAnchorRef.current = null;
      setHasUnseenContent(false);
      persistReadingState();
      scheduleFollow("auto");
    }
  }, [persistReadingState, roundKey, scheduleFollow]);

  useLayoutEffect(() => {
    if (contentKeyRef.current === null) {
      contentKeyRef.current = contentKey;
      if (followingRef.current) scheduleFollow("auto");
      else queueRestoreAnchor(readingAnchorRef.current);
      return;
    }
    if (contentKeyRef.current === contentKey) return;
    contentKeyRef.current = contentKey;
    if (followingRef.current) scheduleFollow("auto");
    else {
      setHasUnseenContent(true);
      queueRestoreAnchor(readingAnchorRef.current);
    }
  }, [contentKey, queueRestoreAnchor, scheduleFollow]);

  const bindLiveMessageRef = useCallback((node: HTMLElement | null) => {
    resizeObserverRef.current?.disconnect();
    resizeObserverRef.current = null;
    liveMessageRef.current = node;
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (followingRef.current) scheduleFollow("auto");
      else {
        const anchor = readingAnchorRef.current || findVisibleAnchor();
        if (!readingAnchorRef.current && anchor) {
          readingAnchorRef.current = anchor;
          persistReadingState();
        }
        queueRestoreAnchor(readingAnchorRef.current);
      }
    });
    observer.observe(node);
    resizeObserverRef.current = observer;
  }, [findVisibleAnchor, persistReadingState, queueRestoreAnchor, scheduleFollow]);

  useLayoutEffect(() => () => {
    captureReadingAnchor();
    persistReadingState();
    resizeObserverRef.current?.disconnect();
    resizeObserverRef.current = null;
    if (followFrameRef.current !== null) window.cancelAnimationFrame(followFrameRef.current);
    if (restoreFrameRef.current !== null) window.cancelAnimationFrame(restoreFrameRef.current);
    followFrameRef.current = null;
    restoreFrameRef.current = null;
    followForceRef.current = false;
    pendingReadingAnchorRef.current = null;
  }, [captureReadingAnchor, persistReadingState]);



  const renderNarration = (message: SidebarMessage) => {
    const processKey = message.requestId && message.attemptId
      ? `narration:${message.requestId}:${message.attemptId}` : `narration:${message.messageId}`;
    const current = Boolean(runKey && `${message.requestId}:${message.attemptId}` === runKey);
    const updates = current && liveNarrationUpdates?.length ? liveNarrationUpdates
      : message.text ? [{ id: message.messageId, text: message.text }] : null;
    const body = updates?.map((update) => update.text).join("\n\n") || "";
    const preview = sidebarNarrationPreview(updates || []);
    const publicTimeline = sidebarActivityTimeline(updates || [], current ? agentActivities : []);
    const expanded = current ? processExpanded : expandedHistoryKeys.has(processKey);
    const panelId = `${narrationPanelId}-${message.messageId}`;
    return (
          <article
            key={processKey}
            ref={current ? bindLiveMessageRef : undefined}
            className={styles.message}
            data-actor="agent"
            data-reading-anchor-id={processKey}
            data-testid="ai-conversation-narration-message"
            data-process-state={message.text ? "sealed" : "live"}
            aria-label={`${resolvedAgentActionName} 的说明`}
            aria-live="off"
          >
            <AgentAvatar presentation={current ? agentPresentation : null} />
            <span className={`${styles.actor} ${styles.liveActor}`}>
              <span>{current ? executionProviderName : message.actorLabel}</span>
              {current && executionStatusActive ? (
                <ExecutionStatusLeaf
                  state={state}
                  providerName={current ? executionProviderName : message.actorLabel}
                  startedAt={agentStartedAt}
                  receivedBytes={agentReceivedBytes}
                  runKey={runKey}
                />
              ) : null}
            </span>
            {publicTimeline.length > 0 ? (
              <div
                className={styles.processDisclosure}
                data-testid="ai-conversation-narration"
              >
                <button
                  type="button"
                  className={styles.narrationPreview}
                  aria-expanded={expanded}
                  aria-controls={panelId}
                  aria-label={expanded ? "收起处理过程" : "展开处理过程"}
                  data-testid="ai-conversation-narration-toggle"
                  onClick={(event) => toggleProcess(processKey, current, event.currentTarget)}
                >
                  <span className={styles.narrationDisclosureIcon} aria-hidden="true">
                    {expanded ? <CaretDownIcon size={12} weight="bold" /> : <CaretRightIcon size={12} weight="bold" />}
                  </span>
                  <span>{preview || "查看过程"}</span>
                </button>
                <div
                  id={panelId}
                  className={styles.narrationText}
                  hidden={!expanded}
                >
                  {publicTimeline.map((entry) => entry.kind === "activity" ? (
                    <div key={entry.id} className={styles.publicActivity} data-testid="ai-conversation-public-activity">
                      {entry.label}
                    </div>
                  ) : (
                    <div key={entry.id}>{sidebarNarrationParagraphs(entry.text || "").map((text, index) => <p key={index} className={styles.narrationLine}>{text}</p>)}</div>
                  ))}
                  {current && agentActivitiesTruncated ? (
                    <small className={styles.truncated}>部分活动记录已省略</small>
                  ) : null}
                  {body ? (
                    <div className={styles.messageMeta}>
                      <button
                        type="button"
                        onClick={() => copyMessage(processKey, body)}
                      >
                        {copyFeedback?.key === processKey ? copyFeedback.label : "复制"}
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}
            {current && agentWorking && !updates ? (
              <span
                className={styles.thinking}
                role="status"
                aria-live="polite"
                aria-label="AI 正在处理"
                data-testid="ai-conversation-thinking"
              >
                <span className={styles.thinkingDots} aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
              </span>
            ) : null}
            {(current ? runProgress?.narrationTruncated : message.truncated) ? (
              <small className={styles.truncated}>部分输出已省略</small>
            ) : null}
          </article>
    );
  };


  return (
    <aside
      id="ai-assistant-sidebar"
      className={styles.sidebar}
      aria-label="AI 助手"
      data-state={state}
      data-testid="ai-conversation-sidebar"
    >
      <header className={styles.header}>
        <div className={styles.headerTitle}>
          <strong data-testid="ai-conversation-title">{title || "AI 助手"}</strong>
          <span className={styles.mode} data-testid="ai-conversation-mode">
            {mode.label}
          </span>
          {onClose ? <button className={styles.close} type="button" aria-label="收起会话面板" onClick={onClose}>×</button> : null}
        </div>
        {sourceFileName || contextLabel ? (
          <p className={styles.context} data-testid="ai-conversation-context">
            {sourceFileName ? `当前文件 · ${sourceFileName}` : contextLabel}
          </p>
        ) : null}
      </header>

      {/*
        * Immutable facts only. A screen reader browses this as a log rather than
        * being interrupted for every streamed fragment.
        */}
      <div
        ref={streamRef}
        className={styles.stream}
        role="log"
        aria-live="off"
        aria-busy={loading}
        aria-label="对话记录"
        data-testid="ai-conversation-stream"
        onScroll={onStreamScroll}
        onWheel={() => { disclosureReadingRef.current = false; }}
        onPointerDown={() => { disclosureReadingRef.current = false; }}
        onKeyDown={(event) => {
          if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(event.key)) {
            disclosureReadingRef.current = false;
          }
        }}
      >
        {loading ? (
          <p className={styles.placeholder}>正在读取这份文档的对话…</p>
        ) : stream.length === 0 && !runProgress ? (
          <p className={styles.placeholder}>
            还没有修改记录。先在页面上写评论，再交给 AI 修改。
          </p>
        ) : (
          displayedGroups.flatMap((group) => [
            group.label ? <div key={`heading:${group.key}`} className={styles.historyGroup} data-turn-id={group.key} data-kind={group.kind} data-testid="ai-conversation-history-group">{group.label}</div> : null,
            ...group.timeline.map((block) => {
            if (block.messages[0].kind === "process-summary") return renderNarration(block.messages[0]);
            if (block.process) return (
              <article key={block.messages[0].messageId} className={`${styles.message} ${styles.turnProcess}`} data-actor={block.messages[0].actor} data-testid="ai-turn-process" data-reading-anchor-id={`process:${block.messages[0].messageId}`} aria-label={`${block.messages[0].actorLabel} 处理记录`}>
                <>{block.messages[0].actor === "agent" ? <AgentAvatar presentation={null} /> : <StemmioAvatar />}</>
                <span className={styles.actor}>{block.messages[0].actorLabel} <span className={styles.actorDetail}>处理记录</span></span>
                {(() => {
                  const disclosureKey = `process:${block.messages[0].messageId}`;
                  return (
                    <details
                      className={styles.processDisclosure}
                      open={expandedHistoryKeys.has(disclosureKey)}
                      onToggle={(event) => settleDisclosure(disclosureKey, event.currentTarget.open)}
                    >
                    <summary onClick={(event) => prepareDisclosure(event.currentTarget)} data-testid="ai-conversation-history-process-toggle">
                    <span className={styles.processDisclosureLabel}>查看处理过程</span>
                    <span className={styles.processDisclosurePreview}>
                      {sidebarNarrationPreview(block.messages) || `${block.messages.length} 条记录`}
                    </span>
                    </summary>
                    <ol>{sidebarProcessRows(block.messages).map(({ message, count }) => (
                      <li key={message.messageId}>
                        {message.actor === "stemmio" ? <CheckIcon size={13} aria-hidden="true" /> : null}
                        <span>{message.text === "执行已结束，结果仍需校验。" ? "本轮执行已结束。" : message.text}{count > 1 ? ` · ${count} 次` : ""}</span>
                        <time dateTime={message.createdAt}>{sidebarTimestampLabel(message.createdAt)}</time>
                      </li>
                    ))}</ol>
                    {block.messages.some((message) => message.truncated) ? (
                      <small className={styles.truncated}>部分内容已省略</small>
                    ) : null}
                    {block.messages.some((message) => message.actor === "agent" && message.text) ? (
                      <div className={styles.messageMeta}>
                        <button
                          type="button"
                          onClick={() => copyMessage(
                            `process:${block.messages[0].messageId}`,
                            block.messages.filter((message) => message.actor === "agent" && message.text).map((message) => message.text).join("\n\n"),
                          )}
                        >
                          {copyFeedback?.key === `process:${block.messages[0].messageId}` ? copyFeedback.label : "复制"}
                        </button>
                      </div>
                    ) : null}
                    </details>
                  );
                })()}
              </article>
            );
            const message = block.messages[0];
            const timestamp = sidebarTimestampLabel(message.createdAt);
            const copyKey = `message:${message.messageId}`;
            return (
              <Fragment key={message.messageId || String(message.sequence)}>
                <article
                  className={styles.message}
                  data-actor={message.actor}
                  data-kind={message.kind}
                  data-status={message.status}
                  data-reading-anchor-id={`message:${message.messageId}`}
                  data-testid="ai-conversation-message"
                >
                  {message.actor === "stemmio" ? (
                    <StemmioAvatar />
                  ) : message.actor === "user" ? (
                    <span className={`${styles.avatar} ${styles.userAvatar}`} aria-hidden="true"><UserIcon size={16} weight="regular" /></span>
                  ) : <AgentAvatar presentation={null} />}
                  <span className={styles.actor}>{message.actor === "agent" ? message.modelDisplayName || message.actorLabel : message.actorLabel}</span>
                  <div className={styles.text}>{(message.actor === "agent" ? sidebarNarrationParagraphs(message.text) : [message.text]).map((text, index) => <p key={index} className={styles.narrationLine}>{text}</p>)}</div>
                  {timestamp || message.text ? (
                    <div className={styles.messageMeta}>
                      {timestamp ? <time dateTime={message.createdAt}>{timestamp}</time> : null}
                      {message.text ? (
                        <button type="button" onClick={() => copyMessage(copyKey, message.text)}>
                          {copyFeedback?.key === copyKey ? copyFeedback.label : "复制"}
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                  {message.truncated ? (
                    <small className={styles.truncated}>部分内容已省略</small>
                  ) : null}
                  {message.status === "interrupted" ? (
                    <small className={styles.interrupted}>这条回复没有完成</small>
                  ) : null}
                </article>
              </Fragment>
            );
              }),
          ])
        )}

        {runSummary && deliveryMode !== "managed-agent" ? (
          <section
            className={`${styles.message} ${styles.runSummary}`}
            data-actor="stemmio"
            data-testid="ai-conversation-run-summary"
            aria-label="本轮任务摘要"
          >
            <StemmioAvatar />
            <span className={styles.actor}>Stemmio</span>
            <p className={styles.text}>{runSummary.title}</p>
            {runSummary.detail ? <small className={styles.runSummaryDetail}>{runSummary.detail}</small> : null}
          </section>
        ) : null}



        {/*
          * A round in flight, told inside the thread rather than a
          * panel of its own. Stemmio states the stage from the run's durable status
          * (ADR 0037 §4). The selected Agent's public words follow in their
          * own stable article, so the two speakers never blur together.
          */}
        {!executionStatusActive && (runProgress?.liveLabel || runProgress?.headline) ? (
          <section
            className={`${styles.message} ${styles.runActivity}`}
            data-actor="stemmio"
            data-tone={runProgress?.tone || "quiet"}
            data-testid="ai-conversation-run-progress"
            aria-label="本轮进度"
          >
            <StemmioAvatar />
            {/*
              * Stemmio states the stages from the run's durable status (ADR 0037 §4).
              * Signing them with an Agent name made the Agent look like the author of
              * Stemmio's own bookkeeping, and put the brand mark on the wrong speaker.
            */}
            <span className={styles.actor}>Stemmio</span>
            <p
              className={`${styles.text} ${styles.liveStatus}`}
              aria-live="off"
            >
              {runProgress?.liveLabel || runProgress?.headline}
            </p>
          </section>
        ) : null}

        {/*
          * The decision reads as the next thing said in this thread rather than a
          * band pinned above the Composer. Stage, decision and Composer used to be
          * three separate regions, so a single round was read in three places with
          * an empty gap between them.
          */}
        {readingHistory ? (
          <button
            className={styles.unseenContent}
            type="button"
            data-testid="ai-conversation-unseen-content"
            onClick={revealLatest}
          >
            {hasUnseenContent ? "有新进展" : "回到最新"}
          </button>
        ) : null}
        <div ref={bottomSentinelRef} className={styles.bottomSentinel} aria-hidden="true" />
      </div>

      <div className={styles.inputDock}>
      <div className={styles.currentActions} data-testid="ai-conversation-current-actions">
        {actionBar && !executionStatusActive ? (
          <section
            className={`${styles.message} ${styles.actionBar}`}
            data-actor="stemmio"
            data-kind={actionBar.kind}
            data-testid="ai-conversation-action-bar"
            aria-label="当前待决定"
          >
            <StemmioAvatar />
            <span className={styles.actor}>Stemmio</span>
            {actionBar.title ? (
              <strong
                {...(actionBar.kind === "decision"
                  ? { role: "status", "aria-live": "polite", "aria-atomic": "true" }
                  : {})}
              >
                {actionBar.title}
              </strong>
            ) : null}
            {actionBar.detail ? <p>{actionBar.detail}</p> : null}
            {actionBar.actions.length > 0 ? (
              <div className={styles.actions}>
                {actionBar.actions.filter((action) => action.id !== "cancel").map((action) => (
                  <button
                    key={action.id}
                    type="button"
                    className={styles.action}
                    data-tone={action.tone}
                    data-action-id={action.id}
                    disabled={action.disabled === true}
                    onClick={() => {
                      if (["replace-api-key", "reauthenticate-agent", "repair-agent-installation"].includes(action.id) && agentAccess) {
                        agentAccess.onBeginAccessRepair?.(action.id === "replace-api-key" ? "apiKey"
                          : action.id === "reauthenticate-agent" ? "login" : "install");
                        onOpenAgentSettings?.();
                        return;
                      }
                      onAction?.(action.id);
                    }}
                  >
                    {executionStatusActive && action.id === "cancel" && !action.disabled ? "停止" : action.label}
                  </button>
                ))}
              </div>
            ) : null}
          </section>
        ) : null}
      </div>

      <div className={styles.composer} data-testid="ai-conversation-composer">
        <label className={styles.draftLabel} htmlFor="ai-conversation-draft">修改要求草稿</label>
        <textarea
          id="ai-conversation-draft"
          className={styles.draftInput}
          data-testid="ai-conversation-draft"
          aria-describedby="ai-conversation-draft-hint"
          placeholder="记下接下来想调整的内容…"
          value={draftText}
          disabled={!draftAvailable}
          maxLength={8000}
          rows={2}
          onChange={(event) => {
            event.target.style.height = "auto";
            event.target.style.height = `${Math.min(160, event.target.scrollHeight)}px`;
            onDraftTextChange?.(event.target.value);
          }}
        />
        <p id="ai-conversation-draft-hint" className={styles.draftHint}>草稿随文档保留，暂不发送给 AI。</p>
        {/*
          * The round's context summary belongs to the Composer, not to the fact
          * stream: it changes as the user works and must never be persisted as
          * a message.
          */}
        {(state === "preview-ready" || state === "no-change") && activeIntent === "modify" ? (
          <p
            className={styles.contextSummary}
            data-testid="ai-conversation-context-summary"
          >
            {`${pendingCommentCount} 条修改意见`}
          </p>
        ) : null}
        {(state === "preview-ready" || state === "no-change") && send.reason ? (
          <p className={styles.sendReason} data-testid="ai-conversation-send-reason">
            {send.reason}
          </p>
        ) : null}

        <div className={styles.composerActions}>
          <span className={styles.agentStatic} data-testid="ai-conversation-agent">
            <AgentChoiceMark label={schemeName} logoSrc={agentPresentation?.logoSrc} />
            <span>{serviceTriggerLabel}</span>
          </span>
          {actionBar?.actions.some((action) => action.id === "cancel") ? <button type="button" className={styles.send}
            data-testid="ai-conversation-stop" onClick={() => onAction?.("cancel")}
            disabled={actionBar?.actions.find((action) => action.id === "cancel")?.disabled}>{executionStatusActive ? "停止" : "结束本轮"}</button> : null}
          {(state === "preview-ready" || state === "no-change") ? (
          <div className={styles.deliveryActions}>
            {activeIntent === "modify" && onCopyTask ? (
              <details className={styles.moreActions}><summary aria-label="更多发送选项">＋</summary><button
                type="button"
                className={styles.copyTask}
                data-testid="ai-conversation-copy-task"
                disabled={!copyTask.canCopy}
                onClick={() => onCopyTask()}
              >
                复制给别的 AI
              </button></details>
            ) : null}
            {send.kind === "status" ? (
              send.label ? (
                <span
                  className={styles.sendStatus}
                  data-testid="ai-conversation-agent-status"
                  aria-live="polite"
                >
                  {send.label}
                </span>
              ) : null
            ) : (
              <button
                type="button"
                className={styles.send}
                data-testid="ai-conversation-send"
                disabled={send.kind === "send" && !send.canSend}
                onClick={() => {
                  if (send.kind === "open-agent-settings") {
                    onOpenAgentSettings?.();
                    return;
                  }
                  onSend?.();
                }}
              >
                {send.label}
              </button>
            )}
          </div>
          ) : null}
        </div>
        {recoveredOnOrigin || recoveredElsewhere ? (
          <p className={styles.recoveredBar} data-testid="ai-conversation-access-recovered">
            连接已恢复
            {recovery?.lastOutcome?.reason ? (
              <span>{recovery.lastOutcome.reason}</span>
            ) : null}
            {recoveredOnOrigin ? (
              <button
                type="button"
                onClick={() => {
                  onAction?.("resend-agent");
                }}
              >
                重新发送
              </button>
            ) : (
              <span>不会对当前文件发送。</span>
            )}
          </p>
        ) : null}

      </div>
      </div>
    </aside>
  );
}

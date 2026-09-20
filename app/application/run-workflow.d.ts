import type { BridgeClient } from "./bridge-client.js";
import type { AgentCredentialOperationPort } from "./agent-credential-operation-contract.js";
import type { CommentSession } from "./comment-session.js";
import type { DocumentSession } from "./document-session.js";
import type {
  DocumentSourceOperationResult,
  DocumentWorkflowOutcome,
  ExternalSourceObservationReceipt,
} from "./document-workflow.js";
import type { ProjectSession } from "./project-session.js";
import type { RunSession } from "./run-session.js";
import type { VersionSession } from "./version-session.js";
import type { ActiveRun } from "../domain/run-lifecycle.js";
import type {
  AgentProviderAvailabilitySnapshot,
  AgentProviderGuidanceKind,
  AgentSelection,
} from "../domain/agent-provider-state.js";
import type {
  AgentCatalogSnapshot,
  AgentCatalogState,
  AgentProviderPresentation,
} from "./agent-provider-catalog.js";
import type { RunSubmitPlan } from "./run/submit-plan.js";
import type { WorkspacePreferenceMutationResult } from "./workspace-preferences-session.js";

export type RunWorkflowOutcome<T = unknown> =
  | Readonly<{ status: "succeeded"; value: T }>
  | Readonly<{ status: "blocked"; code: string; reason: string }>
  | Readonly<{ status: "rejected"; code: string; reason: string }>
  | Readonly<{ status: "unknown"; operationId: string; reason: string }>
  | Readonly<{ status: "stale"; identity: Record<string, unknown> }>;

export type RunWorkflowCodecs = Readonly<{
  isRecord(value: unknown): value is Record<string, unknown>;
  sameSourcePath(left: string | null | undefined, right: string | null | undefined): boolean;
  activeRunFromRecord(value: unknown): ActiveRun | null;
  canonicalLifecycleState(value: unknown, options?: Record<string, unknown>): ActiveRun["status"];
  commentHasContent(value: unknown): boolean;
  commentEditSessionHasChanges(value: unknown): boolean;
  canLocateTarget(value: unknown): boolean;
  persistedComment(value: unknown): unknown;
  persistedChangeEvent(value: unknown): unknown;
  persistedTargetRef(value: unknown): unknown;
  uniqueTargets(value: unknown[]): unknown[];
  fileStem(value: string): string;
  operationKey(run: Pick<ActiveRun, "sourcePath" | "requestId" | "attemptId">): string;
  errorMessage(cause: unknown, fallback: string): string;
}>;

export type RunWorkflowSnapshot = Readonly<{
  polling: boolean;
  pendingReconciliations: ReadonlyArray<string>;
  qoderAvailability: AgentProviderAvailabilitySnapshot;
  agentCatalog: AgentCatalogSnapshot;
  agentPresentation: AgentProviderPresentation;
  accessRepair: Readonly<{
    repairIntentId: string;
    projectId: string;
    documentId: string;
    sourcePath: string;
    requestId: string;
    attemptId: string;
    sessionEpoch: number | null;
    providerId: string | null;
    configurationDigest: string | null;
    credentialGeneration: number | null;
    field: "apiKey" | "login" | "install" | "model" | "provider";
    lastOutcome: Readonly<{
      status: string;
      code: string | null;
      reason: string;
    }> | null;
  }> | null;
  providerAccessImpact: Readonly<Record<string, Readonly<{
    runningCount: number;
    documentCount: number;
  }>>>;
}>;

export type RunWorkflowEvent = Readonly<{
  type: string;
  run?: ActiveRun | null;
  current?: boolean;
  [key: string]: unknown;
}>;

export type RunWorkflowConstruction = Readonly<{
  bridgeClient: Pick<
    BridgeClient,
    | "createRequest"
    | "workspace"
    | "status"
    | "qoderAvailability"
    | "preflightAgent"
    | "startAgent"
    | "cancelActiveRun"
    | "resolveConflict"
  >;
  ensureRegistered(input?: Record<string, unknown>): Promise<RunWorkflowOutcome>;
  projectSession: ProjectSession;
  documentSession: DocumentSession;
  commentSession: CommentSession;
  versionSession: VersionSession<unknown>;
  runSession: RunSession;
  documentWorkflow: Readonly<{
    enqueueEdit(input: Record<string, unknown>): RunWorkflowOutcome;
    previewExternalSource(input: {
      context: import("./project-session.js").ProjectContext;
    }): Promise<DocumentWorkflowOutcome<ExternalSourceObservationReceipt>>;
    hasPendingExternalAcceptance(input: {
      context: import("./project-session.js").ProjectContext;
      acceptedSourceSha256: string;
    }): boolean;
    adoptShownExternalPreview(input: {
      context: import("./project-session.js").ProjectContext;
      previewReceipt: ExternalSourceObservationReceipt;
    }): Promise<DocumentWorkflowOutcome<DocumentSourceOperationResult>>;
  }>;
  drain(input: { boundary: string; deadlineAt: number }): Promise<Readonly<{
    ok: boolean;
    reason?: string;
  }>>;
  codecs: RunWorkflowCodecs;
  ports: Readonly<{
    agentPreferences?: Readonly<{
      getAgentConfigurations(): Promise<Record<string, { modelId?: string | null; reasoning?: string | null }>>;
      saveAgentConfigurations(value: Record<string, { modelId: string | null; reasoning: string | null }>): Promise<boolean>;
      commitAgentConfigurations(
        value: Record<string, { modelId: string | null; reasoning: string | null }>,
        intent: Readonly<{ intentId: string; isCurrent(): boolean }>,
      ): Promise<WorkspacePreferenceMutationResult>;
      commitDefaultAgent(input: {
        intentId: string;
        providerId: string;
        isCurrent(): boolean;
      }): Promise<WorkspacePreferenceMutationResult>;
      setProviderDisabled(input: {
        intentId: string;
        providerId: string;
        disabled: boolean;
        isCurrent(): boolean;
      }): Promise<WorkspacePreferenceMutationResult>;
    }> | null;
    agentCredential?: AgentCredentialOperationPort & Readonly<{
      restore(): Promise<Record<string, unknown>>;
    }> | null;
    canvas: Readonly<{
      checkpointNativeTextIntent(input: Record<string, unknown>): {
        ok: boolean;
        reason?: string;
      } | undefined;
      freeze(reason: string): Record<string, unknown>;
      unlock(): void;
      normalizeComments?(): unknown[];
    }>;
    handoff: Readonly<{
      copy(input: {
        message: string;
        run: ActiveRun | null;
        purpose?: string;
      }): Promise<{
        status: "copied" | string;
        copied: boolean;
      }>;
      openLogin?(input: { providerId: string }): Promise<{ opened?: boolean } | null>;
    }>;
    hash: Readonly<{ sha256(html: string): Promise<string> }>;
  }>;
  scheduler?: Readonly<{
    setTimeout(callback: () => void, delayMs: number): unknown;
    clearTimeout(handle: unknown): void;
  }>;
  visibility?: Readonly<{
    visibilityState?: string;
    addEventListener?(type: "visibilitychange", listener: () => void): void;
    removeEventListener?(type: "visibilitychange", listener: () => void): void;
  }> | null;
  clock: Readonly<{ now(): number }>;
  agentCatalog?: AgentCatalogState | null;
}>;

export class RunWorkflow {
  constructor(options: RunWorkflowConstruction);
  getSnapshot(): RunWorkflowSnapshot;
  subscribe(listener: (snapshot: RunWorkflowSnapshot) => void): () => void;
  subscribeEvents(listener: (event: RunWorkflowEvent) => void): () => void;
  dispose(): void;
  syncPolling(): void;
  startPolling(): void;
  stopPolling(): void;
  pollNow(input?: { generation?: number }): Promise<RunWorkflowOutcome>;
  refreshAgentAvailability(): Promise<RunWorkflowOutcome<{
    availability: AgentProviderAvailabilitySnapshot;
  }>>;
  checkAgentUsability(selection?: AgentSelection | null): Promise<RunWorkflowOutcome<{
    availability: AgentProviderAvailabilitySnapshot;
  }>>;
  copyAgentGuidance(input: {
    kind: AgentProviderGuidanceKind;
    selection?: AgentSelection | null;
  }): Promise<RunWorkflowOutcome<{ kind: AgentProviderGuidanceKind; copied: true }>>;
  refreshQoderAvailability(): Promise<RunWorkflowOutcome<{
    availability: AgentProviderAvailabilitySnapshot;
  }>>;
  checkQoderUsability(): Promise<RunWorkflowOutcome<{
    availability: AgentProviderAvailabilitySnapshot;
  }>>;
  copyQoderGuidance(input: {
    kind: AgentProviderGuidanceKind;
  }): Promise<RunWorkflowOutcome<{ kind: AgentProviderGuidanceKind; copied: true }>>;
  startAgentLogin(selection?: AgentSelection | null): Promise<RunWorkflowOutcome<{
    availability: AgentProviderAvailabilitySnapshot;
    cancelled?: boolean;
  }>>;
  reopenAgentLogin(selection?: AgentSelection | null): Promise<RunWorkflowOutcome<{
    opened: boolean;
  }>>;
  startAgentLogout(selection?: AgentSelection | null): Promise<RunWorkflowOutcome<{
    availability: AgentProviderAvailabilitySnapshot;
  }>>;
  installAgent(selection?: AgentSelection | null): Promise<RunWorkflowOutcome<{
    availability: AgentProviderAvailabilitySnapshot;
  }>>;
  cancelAgentInstall(selection?: AgentSelection | null): Promise<RunWorkflowOutcome>;
  installQoder(): Promise<RunWorkflowOutcome<{
    availability: AgentProviderAvailabilitySnapshot;
  }>>;
  planSubmission(): RunSubmitPlan;
  submit(input?: {
    projectName?: string;
    previousVersionId?: string | null;
    basedOnVersionId?: string | null;
    deadlineAt?: number;
    deliveryMode?: "clipboard" | "managed-agent" | string;
  }): Promise<RunWorkflowOutcome<{ run: ActiveRun }>>;
  reconcileSubmission(input?: {
    sourcePath?: string | null;
    generation?: number;
  }): Promise<RunWorkflowOutcome<{ run: ActiveRun | null }>>;
  copyHandoff(input?: { run?: ActiveRun | null }): Promise<RunWorkflowOutcome<{ run: ActiveRun }>>;
  startAgent(input?: {
    run?: ActiveRun | null;
    preflightId?: string | null;
    agentStartReserved?: boolean;
  }): Promise<RunWorkflowOutcome<{ run: ActiveRun; agentSession: Record<string, unknown> }>>;
  cancel(input?: {
    run?: ActiveRun | null;
    agentMayBeRunning?: boolean;
    reason?: string;
  }): Promise<RunWorkflowOutcome<{ run: ActiveRun; current: boolean }>>;
  resolveConflict(input: {
    run?: ActiveRun | null;
    action: "adopt-ai" | "keep-external";
  }): Promise<RunWorkflowOutcome<Readonly<{
    run: ActiveRun;
    action: "adopt-ai" | "keep-external";
    current: boolean;
    documentSourceResult: DocumentWorkflowOutcome<DocumentSourceOperationResult> | null;
  }>>>;
  hydrateRecentRuns(input?: {
    projects?: Array<{ sourcePath?: string | null }>;
    activeSourcePath?: string | null;
  }): Promise<RunWorkflowOutcome<{ recovered: number; attempted: number }>>;
  freezeAgentSelection(): AgentSelection | null;
  selectAgent(selection: AgentSelection): AgentSelection;
  queuePendingDefaultAgent(selection: AgentSelection): AgentSelection;
  pendingDefaultAgent(): AgentSelection | null;
  readyPendingDefaultAgent(): AgentSelection | null;
  clearPendingDefaultAgent(expectedIntentId?: string): AgentSelection | null;
  commitPendingDefaultAgent(
    selection: AgentSelection | null | undefined,
  ): Promise<RunWorkflowOutcome>;
  selectDefaultAgent(selection: AgentSelection): Promise<RunWorkflowOutcome>;
  beginAccessRepair(
    run?: ActiveRun | null,
    field?: "apiKey" | "login" | "install" | "model" | "provider",
  ): RunWorkflowSnapshot["accessRepair"];
  clearAccessRepair(expectedIntentId?: string): RunWorkflowSnapshot["accessRepair"];
  resendAfterAccessRepair(): Promise<RunWorkflowOutcome>;
  selectAgentModel(modelId: string | null, expectedSelection?: AgentSelection | null): Promise<AgentSelection | null>;
  selectAgentReasoning(reasoning: string | null, expectedSelection?: AgentSelection | null): Promise<AgentSelection | null>;
  applyDisabledAgentProviders(ids?: readonly string[]): void;
  connectAgentApiKey(
    selection: AgentSelection,
    apiKey: string,
    extras?: Readonly<{ vendorId?: string; baseUrl?: string; modelId?: string; remember?: boolean }>,
  ): Promise<RunWorkflowOutcome>;
  disconnectAgentApiKey(selection: AgentSelection): Promise<RunWorkflowOutcome>;
  retryAgentCredentialPersist(selection: AgentSelection): Promise<RunWorkflowOutcome>;
  stopRunsForProvider(providerId: string): Promise<readonly RunWorkflowOutcome[]>;
  manageAgentAccess(
    kind: "disconnect" | "remove-key" | "reconnect" | "logout",
    selection: AgentSelection,
    options?: Readonly<{ stopRelatedRuns?: boolean }>,
  ): Promise<RunWorkflowOutcome>;
}

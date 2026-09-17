import type { BridgeClient } from "./bridge-client.js";
import type { CommentSession } from "./comment-session.js";
import type { DraftSession } from "./draft-session.js";
import type { DocumentSession } from "./document-session.js";
import type { ProjectContext, ProjectSession } from "./project-session.js";
import type { RecoveryStore } from "./recovery-store.js";
import type { RunSession } from "./run-session.js";
import type { VersionSession } from "./version-session.js";
import type { CommentWorkflowCodecs } from "./comment-workflow-codecs.js";

export type CommentWorkflowOutcome<T = Record<string, unknown>> =
  | Readonly<{ status: "succeeded"; value: T }>
  | Readonly<{ status: "blocked"; code: string; reason: string }>
  | Readonly<{ status: "rejected"; code: string; reason: string }>
  | Readonly<{ status: "unknown"; operationId: string; reason: string }>
  | Readonly<{
      status: "stale";
      identity: Readonly<{
        operationId: string;
        epoch: number;
        sourcePath: string;
        expectedSourceSha256: string | null;
      }>;
    }>;

export type CommentWorkflowSnapshot = Readonly<{
  attachmentUploadCount: number;
  draft: Readonly<{
    active: boolean;
    revision: number;
    pending: boolean;
    writing: boolean;
    error: string | null;
  }>;
}>;

export type DocumentEditCommentEffects = Readonly<{
  commentDeletion: Readonly<{
    status: "applied" | "degraded";
    reason?: string;
  }>;
  targetRebinding: Readonly<{
    status: "applied" | "degraded";
    reason?: string;
  }>;
}>;

export type AttachmentBinaryPort = Readonly<{
  prepare(
    file: unknown,
    options: Readonly<{ includeDataBase64: boolean; source: string }>,
  ): Promise<Readonly<{
    fileName: string;
    mediaType: string;
    byteLength: number;
    kind: "image" | "file";
    dataBase64?: string;
    sourceFile?: unknown;
  }>>;
}>;

export type CommentWorkflowConstruction = Readonly<{
  bridgeClient: Pick<
    BridgeClient,
    "workspace" | "attachment" | "saveAttachment" | "deleteAttachment"
  >;
  ensureRegistered(input?: Record<string, unknown>): Promise<CommentWorkflowOutcome<ProjectContext>>;
  projectSession: ProjectSession;
  documentSession: DocumentSession;
  commentSession: CommentSession;
  draftSession: DraftSession;
  versionSession: VersionSession;
  runSession: RunSession;
  codecs: CommentWorkflowCodecs;
  ports: Readonly<{
    recoveryStore: RecoveryStore;
    attachmentBinary: AttachmentBinaryPort;
  }>;
  clock: Readonly<{ now(): number }>;
}>;

export class CommentWorkflow {
  constructor(options: CommentWorkflowConstruction);
  getSnapshot(): CommentWorkflowSnapshot;
  subscribe(listener: (snapshot: CommentWorkflowSnapshot) => void): () => void;
  subscribeEvents(listener: (event: Readonly<Record<string, unknown>>) => void): () => void;
  readonly attachmentUploadCount: number;
  resetForProjectTransition(): void;
  reconcileAuthority(): CommentWorkflowOutcome;
  inspectAttachment(): Readonly<{ state: "pending" | "resolved"; reason?: string }>;
  waitForAttachments(): Promise<boolean>;
  inspectDraft(input?: {
    boundary?: string;
    projectLoadError?: boolean;
  }): Readonly<{ state: "pending" | "resolved"; reason?: string }>;
  drainDraft(input?: { boundary?: string; projectLoadError?: boolean }): Promise<boolean>;
  queueDraft(): CommentWorkflowOutcome;
  beginComposer(input?: Record<string, unknown>): CommentWorkflowOutcome;
  updateDraft(draft: string): CommentWorkflowOutcome;
  rebindComposerTarget(target: unknown): CommentWorkflowOutcome;
  clearComposer(): CommentWorkflowOutcome;
  beginEdit(input: { commentId: string }): CommentWorkflowOutcome;
  updateEditDraft(draftText: string): CommentWorkflowOutcome;
  clearEditSession(): CommentWorkflowOutcome;
  rebindCommentTarget(input: {
    commentId: string;
    target: unknown;
  }): CommentWorkflowOutcome;
  applyCommentItems(comments: unknown[]): CommentWorkflowOutcome;
  confirmEdit(input: { commentId: string }): CommentWorkflowOutcome;
  flushDraft(input?: Record<string, unknown>): Promise<CommentWorkflowOutcome>;
  commitComment(input?: { commentId?: string }): Promise<CommentWorkflowOutcome>;
  editComment(input: { commentId: string }): CommentWorkflowOutcome;
  deleteComment(input: { commentId: string }): CommentWorkflowOutcome;
  deleteCommentsForElementIds(input: {
    elementIds: string[];
  }): CommentWorkflowOutcome;
  applyDocumentEditEffects(input: {
    html: string;
    mutation?: Readonly<{
      targetUpdates?: readonly Record<string, unknown>[];
      trackedTargetIds?: readonly string[];
    }>;
    sourceTransaction?: Readonly<{
      semanticOperation?: Readonly<{ type?: string }>;
      identityDelta?: Readonly<{ removedElementIds?: readonly string[] }>;
    }>;
  }): CommentWorkflowOutcome<DocumentEditCommentEffects>;
  discardComposer(): CommentWorkflowOutcome;
  cancelCommentEdit(input?: { commentId?: string }): CommentWorkflowOutcome;
  removeComposerAttachment(input: { attachmentId: string }): CommentWorkflowOutcome;
  removeEditAttachment(input: {
    commentId: string;
    attachmentId: string;
  }): CommentWorkflowOutcome;
  uploadAttachments(input: Record<string, unknown>): Promise<CommentWorkflowOutcome>;
  readAttachment(input: Record<string, unknown>): Promise<CommentWorkflowOutcome<Blob>>;
  deleteAttachment(input: Record<string, unknown>): Promise<CommentWorkflowOutcome>;
  recoverDraft(input: Record<string, unknown>): Record<string, unknown>;
  dispose(): void;
}

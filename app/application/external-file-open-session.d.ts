export type ExternalHtmlOpenConfirmation = Readonly<{
  requestId: string;
  classification: "managed-project" | "known-external" | "new-external" | string;
  sourceFileName?: string;
  visibleV1FileName?: string;
  projectsRootLabel?: string;
  projectName?: string;
  currentBasedOnVersionId?: string | null;
  currentBasedOnOrdinal?: number;
  latestOfficialVersionId?: string | null;
  latestOfficialOrdinal?: number;
  currentDiffersFromBase?: boolean;
  sourceRelation?: "unchanged" | "changed";
  [key: string]: unknown;
}>;

export type ExternalFileOpenRequest = Readonly<{
  requestId: string;
  sourcePath?: string;
  classification?: string | null;
  confirmation?: ExternalHtmlOpenConfirmation | null;
}>;

export type ExternalFileOpenSnapshot = Readonly<{
  status:
    | "idle"
    | "queued"
    | "opening"
    | "deferred"
    | "awaiting-confirmation"
    | "attention";
  activeRequestId: string | null;
  queuedRequestId: string | null;
  queuedRequestIds: readonly string[];
  deferredRequestId: string | null;
  deferredSequence: number;
  confirmation: ExternalHtmlOpenConfirmation | null;
  attention: Readonly<Record<string, unknown>> | null;
}>;

export type ExternalFileOpenExecution = (
  request: ExternalFileOpenRequest,
  options: Readonly<{
    isSuperseded: () => boolean;
  }>,
) => Promise<"complete" | "deferred" | "awaiting-confirmation" | void>
  | "complete"
  | "deferred"
  | "awaiting-confirmation"
  | void;

export type DeferredSwitchRetry = "idle" | "blocked" | "action-required" | "resumed";

export class ExternalFileOpenSession {
  setObserver(
    observer: ((snapshot: ExternalFileOpenSnapshot) => void) | null,
  ): void;
  enqueue(request: ExternalFileOpenRequest, execute: ExternalFileOpenExecution): boolean;
  presentConfirmation(
    requestId: string,
    descriptor: ExternalHtmlOpenConfirmation,
  ): boolean;
  completeConfirmation(requestId: string): boolean;
  cancelConfirmation(requestId: string): boolean;
  setAttention(requestId: string, attention: Record<string, unknown> | null): boolean;
  resume(execute: ExternalFileOpenExecution): boolean;
  resumeExactOrWhenDeferred(requestId: string, execute: ExternalFileOpenExecution): boolean;
  reconcileDeferredSwitch(options: {
    switchBlocked: boolean;
    execute: ExternalFileOpenExecution;
  }): DeferredSwitchRetry;
  dispose(): void;
  readonly snapshot: ExternalFileOpenSnapshot;
}

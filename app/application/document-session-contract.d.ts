import type { ProjectContext } from "./project-session.js";
import type {
  DocumentSourceReceipt,
  SourceReceiptInput,
} from "./source-receipt-contract.js";

export type { DocumentSourceReceipt, ProjectContext, SourceReceiptInput };

export type DocumentPersistState =
  | "idle"
  | "preview-dirty"
  | "queued"
  | "writing"
  | "failed"
  | "conflict";

export type DocumentCanvasAuthorityStatus =
  | "idle"
  | "pending"
  | "verified"
  | "failed";

export type DocumentCanvasAuthority =
  | Readonly<{
      status: "idle" | "pending";
      generation: number;
      renderedSha256: null;
      error: null;
    }>
  | Readonly<{
      status: "verified";
      generation: number;
      renderedSha256: string;
      error: null;
    }>
  | Readonly<{
      status: "failed";
      generation: number;
      renderedSha256: null;
      error: string;
    }>;

export type DocumentCanvasRenderObservation = Readonly<{
  receipt: DocumentSourceReceipt;
  renderedHtml: string;
  renderedSha256: string;
  frameGeneration: number;
}>;

export type DocumentSessionSnapshot = Readonly<{
  html: string;
  persistedSourceSha256: string | null;
  workingHtmlSha256: string | null;
  canvasGeneration: number;
  sourceReceipt: DocumentSourceReceipt | null;
  canvasAuthority: DocumentCanvasAuthority;
  editRevision: number;
  lastPersistedRevision: number;
  persistState: DocumentPersistState;
  persistError: string;
  hasPendingWrite: boolean;
  isFlushing: boolean;
}>;

export type PersistedBoundaryResult =
  | Readonly<{
      ready: true;
      repaired: boolean;
      sourceSha256: string;
      lastModifiedAt: string;
    }>
  | Readonly<{
      ready: false;
      code:
        | "frozen-integrity-unavailable"
        | "session-changed"
        | "source-unavailable"
        | "source-identity-changed"
        | "source-integrity-failed"
        | "source-diverged";
      reason: string;
      confirmed: boolean;
    }>;

export type DocumentWrite = Readonly<{
  revision: number;
  html: string;
}>;

export type DocumentSessionOptions = Readonly<{
  html?: string;
  persistedSourceSha256?: string | null;
  workingHtmlSha256?: string | null;
  editRevision?: number;
  lastPersistedRevision?: number;
  persistState?: DocumentPersistState;
  persistError?: string;
  context?: ProjectContext | null;
  operationId?: string;
}>;

export type DocumentEditAcceptance<TWrite extends DocumentWrite> =
  | Readonly<{
      accepted: true;
      revision: number;
      write: TWrite | null;
    }>
  | Readonly<{
      accepted: false;
      revision: number;
      write: null;
    }>;

export type DocumentWriteConfirmation =
  | Readonly<{
      accepted: false;
      completesCurrentDocument: false;
      authorityChanged: false;
    }>
  | Readonly<{
      accepted: true;
      completesCurrentDocument: boolean;
      authorityChanged: boolean;
    }>;

export interface DocumentSessionInstance<
  TWrite extends DocumentWrite = DocumentWrite,
  TFlushResult = unknown,
> {
  setObserver(
    observer: ((snapshot: DocumentSessionSnapshot) => void) | null,
  ): void;
  reset(value: {
    html: string;
    persistedSourceSha256?: string | null;
    workingHtmlSha256?: string | null;
    editRevision?: number;
    lastPersistedRevision?: number;
    context?: ProjectContext | null;
    operationId?: string;
  }): DocumentSessionSnapshot;
  publishAuthority(value: {
    html: string;
    persistedSourceSha256?: string | null;
    workingHtmlSha256?: string | null;
    sourceSha256?: string | null;
    editRevision?: number;
    lastPersistedRevision?: number;
    persistState?: DocumentPersistState;
    persistError?: string;
    pendingWrite?: TWrite | null;
    context?: ProjectContext | null;
    operationId?: string;
  }): DocumentSessionSnapshot;
  reloadCanvas(value?: {
    context?: ProjectContext | null;
    operationId?: string;
  }): DocumentSessionSnapshot;
  confirmWorkingHtml(value: { revision: number; htmlSha256: string }): boolean;
  confirmCanvas(value: {
    generation: number;
    renderedSha256: string;
    workingHtmlSha256?: string;
    renderedHtml?: string;
    receipt: DocumentSourceReceipt;
  }): boolean;
  failCanvas(value: {
    generation: number;
    error?: string;
    receipt: DocumentSourceReceipt;
  }): boolean;
  acceptEdit(value: {
    html: string;
    origin?: "local-edit" | "history";
    operationId?: string;
    sourceSha256?: string;
    context?: ProjectContext | null;
    write?: Omit<TWrite, "html" | "revision"> | null;
  }): DocumentEditAcceptance<TWrite>;
  restorePendingWrite(write: TWrite): TWrite;
  beginWrite(): TWrite | null;
  restoreWrite(write: TWrite, value?: {
    nextWrite?: TWrite;
    replacePending?: boolean;
  }): TWrite | false;
  rebaseQueuedWrite(value: { expectedWrite: TWrite; nextWrite: TWrite }): boolean;
  rebaseActiveWrite(value: { expectedWrite: TWrite; nextWrite: TWrite }): boolean;
  finishWrite(write: TWrite): boolean;
  acceptWriteConfirmation(value: {
    write: TWrite & { revision?: number; html?: string };
    html: string;
    sourceSha256: string;
    persistedRevision: number;
    context?: ProjectContext | null;
    routingChanged?: boolean;
    operationId?: string;
    nextWrite?: TWrite;
  }): DocumentWriteConfirmation;
  reconcileRecoveredRevision(value: number): DocumentSessionSnapshot;
  markPersistenceIdle(): boolean;
  recordPersistenceFailure(value: {
    error: string;
    conflict?: boolean;
    write?: TWrite | null;
    receipt?: DocumentSourceReceipt | null;
  }): DocumentSessionSnapshot | false;
  beginFlush<TPromise extends Promise<TFlushResult>>(
    promise: TPromise,
  ): TPromise | false;
  finishFlush(promise: Promise<TFlushResult>): boolean;
  reconcilePersistedBoundary(value: {
    frozenHtml: string;
    reportedSourceSha256?: string | null;
    cutoffRevision: number;
    hashHtml: (html: string) => Promise<string>;
    readSource: () => Promise<Record<string, unknown>>;
    isCurrent: () => boolean;
    acceptsSource: (source: Record<string, unknown>) => boolean;
  }): Promise<PersistedBoundaryResult>;
  readonly html: string;
  readonly persistedSourceSha256: string | null;
  readonly workingHtmlSha256: string | null;
  readonly canvasGeneration: number;
  readonly sourceReceipt: DocumentSourceReceipt | null;
  readonly canvasAuthority: DocumentCanvasAuthority;
  readonly editRevision: number;
  readonly lastPersistedRevision: number;
  readonly persistState: DocumentPersistState;
  readonly persistError: string;
  readonly pendingWrite: TWrite | null;
  readonly flushPromise: Promise<TFlushResult> | null;
  readonly snapshot: DocumentSessionSnapshot;
}

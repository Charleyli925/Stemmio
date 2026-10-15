export type CommentWorkflowCodecs = Readonly<{
  isRecord(value: unknown): value is Record<string, unknown>;
  sameSourcePath(left: string | null, right: string | null): boolean;
  persistedComment(value: unknown): Record<string, unknown>;
  persistedChangeEvent(value: unknown): Record<string, unknown>;
  persistedAttachment(value: unknown): Record<string, unknown>;
  persistedTargetRef(value: unknown): Record<string, unknown>;
  commentsFromRecords(value: unknown): unknown[];
  changesFromDraftRecords(value: unknown): unknown[];
  attachmentFromRecord(
    value: unknown,
    expectedCommentId?: string | null,
  ): Record<string, unknown> | null;
  selectionFromRecord(value: unknown): Record<string, unknown> | null;
  independentCommentTarget(
    target: Record<string, unknown>,
    commentId: string,
  ): Record<string, unknown>;
  commentEditSessionHasChanges(value: unknown): boolean;
  canLocateTarget(value: unknown): boolean;
  rebindTargetsPreservingGlobal(html: string, targets: unknown[]): unknown[];
  errorMessage(cause: unknown, fallback: string): string;
}>;

export function createCommentWorkflowCodecs(
  overrides?: Partial<CommentWorkflowCodecs>,
): CommentWorkflowCodecs;

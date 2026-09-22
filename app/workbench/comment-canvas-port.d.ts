import type {
  HtmlCanvasCommentLayoutState,
  HtmlCanvasSelection,
} from "../components/HtmlCanvasEditor";
import type { CommentAttachmentTarget } from "./comment-rail-contract";

export type CommentTargetLayout = HtmlCanvasCommentLayoutState["targets"][number];

export type CommentCanvasSnapshot = Readonly<{
  selection: HtmlCanvasSelection | null;
  layoutAuthority: Readonly<{
    sourceSha256: string;
    viewContextGeneration: number;
    targetIdsKey: string;
    ready: boolean;
    textEditing: boolean;
  }>;
  targetLayouts: Readonly<Record<string, CommentTargetLayout>>;
  canvasDocumentHeight: number;
  revealRequest: Readonly<{
    requestId: number;
    target: HtmlCanvasSelection;
    itemKey: string;
  }> | null;
  railResetRevision: number;
  composerFocusRevision: number;
  editFocusRequest: Readonly<{
    requestId: number;
    commentId: string;
    select: boolean;
  }> | null;
  composerOpen: boolean;
  editingCommentId: string | null;
  focusedCommentId: string | null;
  relinkingTarget: string | null;
  relinkSelectionArmed: boolean;
  attachmentPickerRequest: Readonly<{
    requestId: number;
    target: CommentAttachmentTarget;
    accept: "all" | "image";
  }> | null;
}>;

export type CommentCanvasPort = Readonly<{
  getSnapshot: () => CommentCanvasSnapshot;
  subscribe: (listener: () => void) => () => void;
  setSelection: (selection: HtmlCanvasSelection | null) => void;
  publishLayout: (layout: HtmlCanvasCommentLayoutState) => void;
  resetLayout: () => void;
  captureRevealIntent: () => number;
  cancelReveal: () => void;
  requestReveal: (target: HtmlCanvasSelection, itemKey: string, expectedIntent?: number) => void;
  settleReveal: (requestId: number) => void;
  resetRail: () => void;
  requestComposerFocus: () => void;
  requestCommentEditFocus: (commentId: string, select?: boolean) => void;
  settleCommentEditFocus: (requestId: number) => void;
  setComposerOpen: (open: boolean) => void;
  setEditingCommentId: (commentId: string | null) => void;
  setFocusedCommentId: (commentId: string | null) => void;
  beginRelink: (itemId: string) => void;
  armRelinkSelection: () => void;
  clearRelink: () => void;
  requestAttachmentPicker: (
    target: CommentAttachmentTarget,
    accept?: "all" | "image",
  ) => void;
  settleAttachmentPicker: (requestId: number) => void;
}>;

export function createCommentCanvasPort(): CommentCanvasPort;

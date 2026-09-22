import { stabilizeCommentTargetLayouts } from "../lib/comment-rail-layout.js";

const EMPTY_LAYOUT_AUTHORITY = Object.freeze({
  sourceSha256: "",
  viewContextGeneration: -1,
  targetIdsKey: "",
  ready: false,
  textEditing: false,
});

const EMPTY_COMMENT_CANVAS_SNAPSHOT = Object.freeze({
  selection: null,
  layoutAuthority: EMPTY_LAYOUT_AUTHORITY,
  targetLayouts: Object.freeze({}),
  canvasDocumentHeight: 760,
  revealRequest: null,
  railResetRevision: 0,
  composerFocusRevision: 0,
  editFocusRequest: null,
  composerOpen: false,
  editingCommentId: null,
  focusedCommentId: null,
  relinkingTarget: null,
  relinkSelectionArmed: false,
  attachmentPickerRequest: null,
});

function applyCanvasHeight(height) {
  globalThis.document?.documentElement?.style.setProperty(
    "--comment-canvas-height",
    `${height}px`,
  );
}

function sameTargetLayouts(left, right) {
  const entries = Object.entries(right);
  return Object.keys(left).length === entries.length
    && entries.every(([targetId, next]) => {
      const previous = left[targetId];
      return previous?.top === next.top
        && previous?.height === next.height
        && previous?.status === next.status
        && previous?.resolution === next.resolution
        && previous?.tabGroupKey === next.tabGroupKey
        && previous?.tabGroupLabel === next.tabGroupLabel;
    });
}

function sameLayoutAuthority(left, right) {
  return left.sourceSha256 === right.sourceSha256
    && left.viewContextGeneration === right.viewContextGeneration
    && left.targetIdsKey === right.targetIdsKey
    && left.ready === right.ready
    && left.textEditing === right.textEditing;
}

/**
 * Stable, React-free adapter between HtmlCanvasEditor interaction events and
 * the comment capability container. It owns presentation signals only; the
 * CommentSession remains the sole owner of durable comment facts.
 */
export function createCommentCanvasPort() {
  let snapshot = EMPTY_COMMENT_CANVAS_SNAPSHOT;
  const listeners = new Set();
  let revealSequence = 0;
  let editFocusSequence = 0;
  let attachmentPickerSequence = 0;
  const publish = (next) => {
    if (snapshot === next) return;
    snapshot = Object.freeze(next);
    for (const listener of listeners) listener();
  };
  return Object.freeze({
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setSelection(selection) {
      if (snapshot.selection === selection) return;
      publish({ ...snapshot, selection });
    },
    publishLayout(layout) {
      const targetIdsKey = layout.targetIds.join("\u0000");
      const currentAuthority = snapshot.layoutAuthority;
      const nextLayoutAuthority = (
        layout.textEditing
        && !layout.ready
        && currentAuthority.ready
      )
        ? Object.freeze({ ...currentAuthority, textEditing: true })
        : Object.freeze({
            sourceSha256: layout.sourceSha256,
            viewContextGeneration: layout.viewContextGeneration,
            targetIdsKey,
            ready: layout.ready,
            textEditing: layout.textEditing,
          });
      const layoutAuthority = sameLayoutAuthority(
        currentAuthority,
        nextLayoutAuthority,
      ) ? currentAuthority : nextLayoutAuthority;
      if (!layout.ready) {
        if (layoutAuthority !== currentAuthority) {
          publish({ ...snapshot, layoutAuthority });
        }
        return;
      }
      const measuredLayouts = Object.fromEntries(
        layout.targets.map((target) => [target.targetId, target]),
      );
      const measuredOrRetainedLayouts = Object.fromEntries(
        layout.targetIds.flatMap((targetId) => {
          const next = measuredLayouts[targetId] || snapshot.targetLayouts[targetId];
          return next ? [[targetId, next]] : [];
        }),
      );
      const stabilizedLayouts = stabilizeCommentTargetLayouts({
        previous: snapshot.targetLayouts,
        next: measuredOrRetainedLayouts,
        textEditing: layout.textEditing,
      });
      const targetLayouts = sameTargetLayouts(
        snapshot.targetLayouts,
        stabilizedLayouts,
      )
        ? snapshot.targetLayouts
        : Object.freeze(stabilizedLayouts);
      const canvasDocumentHeight = Math.max(760, Math.ceil(layout.contentHeight || 0));
      applyCanvasHeight(canvasDocumentHeight);
      if (
        layoutAuthority === currentAuthority
        && targetLayouts === snapshot.targetLayouts
        && canvasDocumentHeight === snapshot.canvasDocumentHeight
      ) return;
      publish({
        ...snapshot,
        layoutAuthority,
        targetLayouts,
        canvasDocumentHeight,
      });
    },
    resetLayout() {
      revealSequence += 1;
      applyCanvasHeight(760);
      publish({
        ...snapshot,
        layoutAuthority: EMPTY_LAYOUT_AUTHORITY,
        targetLayouts: Object.freeze({}),
        canvasDocumentHeight: 760,
        revealRequest: null,
        editFocusRequest: null,
        composerOpen: false,
        editingCommentId: null,
        focusedCommentId: null,
        relinkingTarget: null,
        relinkSelectionArmed: false,
        attachmentPickerRequest: null,
        railResetRevision: snapshot.railResetRevision + 1,
      });
    },
    captureRevealIntent: () => revealSequence,
    cancelReveal() {
      revealSequence += 1;
      if (snapshot.revealRequest) publish({ ...snapshot, revealRequest: null });
    },
    requestReveal(target, itemKey, expectedIntent = revealSequence) {
      if (expectedIntent !== revealSequence) return;
      publish({
        ...snapshot,
        revealRequest: Object.freeze({
          requestId: ++revealSequence,
          target,
          itemKey,
        }),
      });
    },
    settleReveal(requestId) {
      if (snapshot.revealRequest?.requestId !== requestId) return;
      publish({ ...snapshot, revealRequest: null });
    },
    resetRail() {
      publish({
        ...snapshot,
        railResetRevision: snapshot.railResetRevision + 1,
      });
    },
    requestComposerFocus() {
      publish({
        ...snapshot,
        composerFocusRevision: snapshot.composerFocusRevision + 1,
      });
    },
    requestCommentEditFocus(commentId, select = false) {
      publish({
        ...snapshot,
        editFocusRequest: Object.freeze({
          requestId: ++editFocusSequence,
          commentId,
          select,
        }),
      });
    },
    settleCommentEditFocus(requestId) {
      if (snapshot.editFocusRequest?.requestId !== requestId) return;
      publish({ ...snapshot, editFocusRequest: null });
    },
    setComposerOpen(composerOpen) {
      if (snapshot.composerOpen === composerOpen) return;
      publish({ ...snapshot, composerOpen });
    },
    setEditingCommentId(editingCommentId) {
      if (snapshot.editingCommentId === editingCommentId) return;
      publish({ ...snapshot, editingCommentId });
    },
    setFocusedCommentId(focusedCommentId) {
      if (snapshot.focusedCommentId === focusedCommentId) return;
      publish({ ...snapshot, focusedCommentId });
    },
    beginRelink(relinkingTarget) {
      publish({
        ...snapshot,
        relinkingTarget,
        relinkSelectionArmed: false,
        editingCommentId: null,
      });
    },
    armRelinkSelection() {
      if (!snapshot.relinkingTarget || snapshot.relinkSelectionArmed) return;
      publish({ ...snapshot, relinkSelectionArmed: true });
    },
    clearRelink() {
      if (!snapshot.relinkingTarget && !snapshot.relinkSelectionArmed) return;
      publish({
        ...snapshot,
        relinkingTarget: null,
        relinkSelectionArmed: false,
      });
    },
    requestAttachmentPicker(target, accept = "all") {
      publish({
        ...snapshot,
        attachmentPickerRequest: Object.freeze({
          requestId: ++attachmentPickerSequence,
          target,
          accept,
        }),
      });
    },
    settleAttachmentPicker(requestId) {
      if (snapshot.attachmentPickerRequest?.requestId !== requestId) return;
      publish({ ...snapshot, attachmentPickerRequest: null });
    },
  });
}

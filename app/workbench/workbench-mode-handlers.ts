import type { MutableRefObject } from "react";
import type { HtmlCanvasEditorHandle } from "../components/HtmlCanvasEditor";
import type { HtmlInteractionPreviewHandle } from "../components/HtmlInteractionPreview";
import type { PageViewContext } from "../lib/page-view-context.js";
import type { CanvasMode } from "./types";

type ModeHandlersInput = Readonly<{
  externalSourcePreview: boolean;
  canvasMode: CanvasMode;
  previewAvailable: boolean;
  previewNeedsEditorFence: boolean;
  previewToEditPendingRef: MutableRefObject<boolean>;
  pageViewDocumentKeyRef: MutableRefObject<string>;
  interactionPreviewRef: MutableRefObject<HtmlInteractionPreviewHandle | null>;
  editorRef: MutableRefObject<HtmlCanvasEditorHandle | null>;
  returnToEditingFromExternalPreview: () => void;
  setPageViewContext: (context: PageViewContext | null) => void;
  invalidateEditCanvasRenderAck: () => void;
  commentCanvasPort: { setSelection: (selection: null) => void };
  updateFocusedComment: (commentId: string | null) => void;
  setCanvasMode: (mode: CanvasMode) => void;
  deferEditorCommand: (kind: string, run: () => void) => boolean;
  isViewTransitioning: () => boolean;
}>;

export function createWorkbenchModeHandlers({
  externalSourcePreview,
  canvasMode,
  previewAvailable,
  previewNeedsEditorFence,
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
}: ModeHandlersInput) {
  const onSelectEdit = () => {
    if (externalSourcePreview) {
      returnToEditingFromExternalPreview();
      return;
    }
    if (canvasMode !== "preview") {
      setCanvasMode("edit");
      return;
    }
    if (previewToEditPendingRef.current) return;
    previewToEditPendingRef.current = true;
    const expectedDocumentKey = pageViewDocumentKeyRef.current;
    const captureContext = interactionPreviewRef.current
      ?.capturePageViewContext() ?? Promise.resolve(null);
    void captureContext
      .catch(() => null)
      .then((capturedContext) => {
        if (
          pageViewDocumentKeyRef.current !== expectedDocumentKey
          || isViewTransitioning()
        ) return;
        const nextContext = (
          capturedContext?.documentKey === expectedDocumentKey
        ) ? capturedContext : null;
        setPageViewContext(nextContext);
        editorRef.current?.applyPageViewContext(nextContext);
        invalidateEditCanvasRenderAck();
        setCanvasMode("edit");
      })
      .finally(() => {
        previewToEditPendingRef.current = false;
      });
  };

  const onSelectPreview = () => {
    if (!previewAvailable || canvasMode === "preview") return;
    const expectedDocumentKey = pageViewDocumentKeyRef.current;
    const enterPreview = () => {
      if (pageViewDocumentKeyRef.current !== expectedDocumentKey) return;
      if (previewNeedsEditorFence) {
        const committed = editorRef.current?.freezeWorkingSource({
          resumeEditing: false,
          trigger: "fence",
          endBehavior: "leave-canvas",
        });
        if (!committed || !committed.ok) {
          editorRef.current?.showCommitBlocked(
            committed?.reason || "请点回文字完成输入，再进入预览。",
          );
          return;
        }
      }
      editorRef.current?.clearSelection();
      setPageViewContext(null);
      editorRef.current?.applyPageViewContext(null);
      commentCanvasPort.setSelection(null);
      updateFocusedComment(null);
      setCanvasMode("preview");
    };
    if (deferEditorCommand("project-switch", enterPreview)) return;
    enterPreview();
  };

  return { onSelectEdit, onSelectPreview };
}

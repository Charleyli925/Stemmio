import { useCallback, useState } from "react";

import {
  decideDisplayHandoff,
  type DisplayHandoffDecision,
  type DisplayLifecycle,
  type DisplayTarget,
} from "./display-handoff-decision";
import type { CanvasMode } from "./types";

export type DisplaySurfaceHandoffState = Readonly<{
  target: DisplayTarget | null;
  /** The checked target may be brought to the front in this render. */
  reveal: boolean;
  /** Keep this surface in front while another target is opening. */
  retain: boolean;
  /** The local retained element must be retired after this render. */
  release: boolean;
  /** Retained surfaces never receive user input. */
  outgoingInteractive: false;
}>;

export type DisplayHandoffIntent = Readonly<{
  pendingTabId: string | null;
  pendingMode: CanvasMode | null;
  currentMode: CanvasMode;
  sourceAvailable: boolean;
  hasDocumentRuntime: boolean;
  historyPreview: boolean;
  presentedReadyReviewSession: boolean;
  previewReady: boolean;
  editFailed: boolean;
  previewFailed: boolean;
  editRevealSettled: boolean;
}>;

export type UseDisplayHandoffInput = Readonly<{
  /** The target after the active tab has committed. */
  target: DisplayTarget | null;
  /** The target selected in the tab strip before that commit completes. */
  pendingTarget: DisplayTarget | null;
  intent: DisplayHandoffIntent;
  targetReady: boolean;
  targetFailed: boolean;
  targetLifecycle?: DisplayLifecycle;
  targetMissingEvidence?: readonly string[];
  /** Select which retained surface may remain visible during this handoff. */
  retainedSurface?: "edit" | "preview" | null;
  retainOutgoing: boolean;
  edit: DisplaySurfaceHandoffStateInput;
  preview: DisplaySurfaceHandoffStateInput;
}>;

type DisplaySurfaceHandoffStateInput = Readonly<{
  target: DisplayTarget | null;
}>;

type RetainedBySurface = Readonly<Record<"edit" | "preview", DisplayTarget | null>>;

function sameTarget(left: DisplayTarget | null, right: DisplayTarget | null): boolean {
  if (!left || !right) return left === right;
  return left.surface === right.surface && left.identity === right.identity;
}

function surfaceState(
  surface: "edit" | "preview",
  target: DisplayTarget | null,
  retained: RetainedBySurface,
  decision: DisplayHandoffDecision,
  releaseAll: boolean,
): DisplaySurfaceHandoffState {
  const retainedForSurface = retained[surface];
  const reveal = Boolean(
    decision.canHandoff
    && target
    && target.surface === surface
    && sameTarget(decision.actual, target),
  );
  const retain = Boolean(
    decision.keepOutgoing
    && decision.actual?.surface === surface
    && sameTarget(decision.actual, retainedForSurface),
  );
  const release = Boolean(
    (decision.releaseOutgoing || releaseAll)
    && retainedForSurface,
  );
  return Object.freeze({
    target,
    reveal,
    retain,
    release,
    outgoingInteractive: false,
  });
}

/**
 * Own the one Workbench display decision while leaving DOM retention inside
 * the two surface hosts. Hosts report only the identity of an element that
 * has been verified and mounted; they never decide whether it may remain in
 * front or become writable.
 */
export function useDisplayHandoff({
  target,
  pendingTarget,
  intent,
  targetReady,
  targetFailed,
  targetLifecycle = "active",
  targetMissingEvidence = [],
  retainedSurface = null,
  retainOutgoing,
  edit,
  preview,
}: UseDisplayHandoffInput) {
  const pending = Boolean(intent.pendingTabId);
  const effectiveTarget = pending ? pendingTarget : target;
  const revealPending = Boolean(
    !pending
    && effectiveTarget?.surface === "edit"
    && intent.sourceAvailable
    && intent.previewReady
    && !intent.editFailed
    && !intent.editRevealSettled,
  );
  const effectiveTargetReady = Boolean(
    !pending
    && targetReady
    && !revealPending,
  );
  const effectiveTargetFailed = Boolean(!pending && targetFailed);
  const effectiveMissingEvidence = pending
    ? ["tab-commit", ...targetMissingEvidence]
    : targetMissingEvidence;
  const [retained, setRetained] = useState<RetainedBySurface>({
    edit: null,
    preview: null,
  });
  const releaseHistoricalPreview = Boolean(
    !pending
    && effectiveTarget?.surface === "edit"
    && retained.preview?.historical,
  );
  const reportRetained = useCallback((surface: "edit" | "preview", next: DisplayTarget | null) => {
    setRetained((current) => {
      if (next) {
        const expected = surface === "edit" ? edit.target : preview.target;
        // A superseded host cannot register its old proof as the new target.
        if (targetFailed || targetLifecycle !== "active"
          || (!sameTarget(next, current[surface]) && !sameTarget(next, expected))) return current;
      }
      return sameTarget(current[surface], next) ? current : { ...current, [surface]: next };
    });
  }, [edit.target, preview.target, targetFailed, targetLifecycle]);
  const preferredRetained = retainedSurface === "edit"
    ? retained.edit
    : retainedSurface === "preview"
      ? releaseHistoricalPreview ? null : retained.preview
      : pending
        ? retained[intent.currentMode]
        : effectiveTarget?.surface === "edit" && revealPending
          ? releaseHistoricalPreview ? null : retained.preview
          : null;
  const targetRetained = effectiveTarget?.surface === "edit"
    ? retained.edit
    : effectiveTarget?.surface === "preview"
      ? retained.preview
      : null;
  const retainedActual = preferredRetained
    || targetRetained
    || retained.edit
    || (releaseHistoricalPreview ? null : retained.preview);
  const effectiveRetainOutgoing = pending
    ? intent.currentMode === "edit"
      ? !intent.editFailed
      : !intent.previewFailed
    : retainOutgoing;
  const decision = decideDisplayHandoff({
    target: effectiveTarget,
    targetReady: effectiveTargetReady,
    targetFailed: effectiveTargetFailed,
    retained: retainedActual,
    retainOutgoing: effectiveRetainOutgoing,
    lifecycle: targetLifecycle,
    missingEvidence: effectiveMissingEvidence,
  });
  const releaseAll = Boolean(!effectiveTarget || effectiveTargetFailed || targetLifecycle !== "active");
  // Retire only the identity the decision used. A ready destination may
  // register during the same commit and must not be erased by old cleanup.
  if (releaseAll && (retained.edit || retained.preview)) {
    setRetained({ edit: null, preview: null });
  } else if (releaseHistoricalPreview && retained.preview) {
    setRetained({ ...retained, preview: null });
  } else if (decision.releaseOutgoing && retainedActual) {
    if (sameTarget(retained.edit, retainedActual)) {
      setRetained({ ...retained, edit: null });
    } else if (sameTarget(retained.preview, retainedActual)) {
      setRetained({ ...retained, preview: null });
    }
  }
  const editState = surfaceState("edit", edit.target, retained, decision, releaseAll);
  const previewState = surfaceState("preview", preview.target, retained, decision,
    releaseAll || releaseHistoricalPreview);
  const carryPreviewIntoEdit = Boolean(
    !pending
    && effectiveTarget?.surface === "edit"
    && intent.sourceAvailable
    && intent.previewReady
    && !intent.editFailed
    && (decision.phase === "opening" || !intent.editRevealSettled),
  );
  const editPreviewUnderlay = Boolean(
    !pending
    && effectiveTarget?.surface === "preview"
    && !intent.historyPreview
    && !intent.presentedReadyReviewSession
    && intent.hasDocumentRuntime,
  );
  const showEditSurface = intent.currentMode === "edit"
    || editPreviewUnderlay
    || Boolean(decision.keepOutgoing && decision.actual?.surface === "edit");
  const continuingEdit = Boolean(
    !pending
    && effectiveTarget?.surface === "edit"
    && intent.currentMode === "edit"
    && !intent.editFailed
    && targetLifecycle === "active"
    && retained.edit?.continuityKey
    && retained.edit.continuityKey === edit.target?.continuityKey,
  );
  const editInteractive = Boolean(
    (decision.canHandoff || continuingEdit)
    && effectiveTarget?.surface === "edit"
    && decision.actual?.surface === "edit"
    && !carryPreviewIntoEdit,
  );
  const previewInteractive = Boolean(
    (decision.canHandoff
      && effectiveTarget?.surface === "preview"
      && decision.actual?.surface === "preview")
    || (carryPreviewIntoEdit && intent.previewReady),
  );
  return {
    decision,
    retained,
    reportRetained,
    edit: editState,
    preview: previewState,
    roles: Object.freeze({
      pending,
      carryPreviewIntoEdit,
      editPreviewUnderlay,
      showEditSurface,
      editInteractive,
      previewInteractive,
    }),
  } as const;
}

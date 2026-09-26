"use client";

import { useLayoutEffect } from "react";

import type { EditAuthorRuntimeSnapshot } from "../application/edit-author-runtime-session.js";

export function useEditRuntimePreparation({
  canvasMode,
  editRuntimeSnapshot,
  startPreparation,
}: {
  canvasMode: "edit" | "preview";
  editRuntimeSnapshot: EditAuthorRuntimeSnapshot | null;
  startPreparation: (input: { sourceSha256: string; canvasGeneration: number }) => void;
}) {
  const runtimePhase = editRuntimeSnapshot?.phase ?? "static";
  const runtimePreparing = canvasMode === "edit"
    && runtimePhase === "preparing";
  const runtimeRenderPending = canvasMode === "edit"
    && ["preparing", "ready", "running"].includes(runtimePhase);
  const runtimeGrant = canvasMode === "edit"
    && ["ready", "running", "settled"].includes(runtimePhase)
    ? editRuntimeSnapshot?.grant ?? null
    : null;

  useLayoutEffect(() => {
    const sourceSha256 = editRuntimeSnapshot?.sourceSha256;
    const canvasGeneration = editRuntimeSnapshot?.canvasGeneration;
    if (
      canvasMode !== "edit"
      || runtimePhase !== "preparing"
      || !sourceSha256
      || typeof canvasGeneration !== "number"
      || !Number.isSafeInteger(canvasGeneration)
    ) return;
    startPreparation({ sourceSha256, canvasGeneration });
  }, [
    canvasMode,
    editRuntimeSnapshot?.canvasGeneration,
    editRuntimeSnapshot?.sourcePath,
    editRuntimeSnapshot?.sourceSha256,
    runtimePhase,
    startPreparation,
  ]);

  return Object.freeze({
    runtimePhase,
    runtimePreparing,
    runtimeRenderPending,
    runtimeGrant,
  });
}

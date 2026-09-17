function requiredFunction(overrides, name) {
  const value = overrides?.[name];
  if (typeof value !== "function") {
    throw new TypeError(`CommentWorkflow codec ${name} must be a function.`);
  }
  return value;
}

// The workflow receives the existing renderer-model codecs instead of
// importing Workbench. These conversions are pure compatibility boundaries;
// durable authority remains with the injected Sessions and Bridge.
export function createCommentWorkflowCodecs(overrides = {}) {
  return Object.freeze({
    isRecord: requiredFunction(overrides, "isRecord"),
    sameSourcePath: requiredFunction(overrides, "sameSourcePath"),
    persistedComment: requiredFunction(overrides, "persistedComment"),
    persistedChangeEvent: requiredFunction(overrides, "persistedChangeEvent"),
    persistedAttachment: requiredFunction(overrides, "persistedAttachment"),
    persistedTargetRef: requiredFunction(overrides, "persistedTargetRef"),
    commentsFromRecords: requiredFunction(overrides, "commentsFromRecords"),
    changesFromDraftRecords: requiredFunction(overrides, "changesFromDraftRecords"),
    attachmentFromRecord: requiredFunction(overrides, "attachmentFromRecord"),
    selectionFromRecord: requiredFunction(overrides, "selectionFromRecord"),
    independentCommentTarget: requiredFunction(
      overrides,
      "independentCommentTarget",
    ),
    commentEditSessionHasChanges: requiredFunction(
      overrides,
      "commentEditSessionHasChanges",
    ),
    canLocateTarget: requiredFunction(overrides, "canLocateTarget"),
    rebindTargetsPreservingGlobal: requiredFunction(
      overrides,
      "rebindTargetsPreservingGlobal",
    ),
    errorMessage: requiredFunction(overrides, "errorMessage"),
  });
}

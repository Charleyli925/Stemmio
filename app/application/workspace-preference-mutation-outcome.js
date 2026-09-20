/** @typedef {import("./workspace-preferences-session.d.ts").WorkspacePreferenceMutationResult} WorkspacePreferenceMutationResult */
/** @typedef {import("./workspace-preference-mutation-outcome.d.ts").WorkspacePreferenceMutationOutcome} WorkspacePreferenceMutationOutcome */

/**
 * @param {WorkspacePreferenceMutationResult} result
 * @returns {WorkspacePreferenceMutationOutcome}
 */
export function interpretWorkspacePreferenceMutation(result) {
  if (result.status === "committed") {
    /** @type {"confirmed"} */
    const persistence = result.persistence;
    void persistence;
    return Object.freeze({ kind: "committed", errorCode: null });
  }
  if (result.status === "superseded") {
    if ("write" in result) {
      /** @type {"not-started"} */
      const write = result.write;
      void write;
    } else {
      /** @type {"confirmed" | "not-needed"} */
      const rollback = result.rollback;
      void rollback;
    }
    return Object.freeze({ kind: "superseded", errorCode: null });
  }
  if (result.status === "unknown") {
    /** @type {true} */
    const pending = result.pending;
    /** @type {"commit" | "rollback"} */
    const phase = result.phase;
    void pending;
    void phase;
    return Object.freeze({
      kind: "unknown",
      errorCode: "AGENT_PREFERENCES_SAVE_UNKNOWN",
    });
  }
  /** @type {"not-written"} */
  const persistence = result.persistence;
  void persistence;
  return Object.freeze({
    kind: "failed",
    errorCode: "AGENT_PREFERENCES_SAVE_FAILED",
  });
}

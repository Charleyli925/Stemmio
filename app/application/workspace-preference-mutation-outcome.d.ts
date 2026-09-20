import type { WorkspacePreferenceMutationResult } from "./workspace-preferences-session.js";

export type WorkspacePreferenceMutationOutcome =
  | Readonly<{ kind: "committed"; errorCode: null }>
  | Readonly<{ kind: "superseded"; errorCode: null }>
  | Readonly<{ kind: "unknown"; errorCode: "AGENT_PREFERENCES_SAVE_UNKNOWN" }>
  | Readonly<{ kind: "failed"; errorCode: "AGENT_PREFERENCES_SAVE_FAILED" }>;

export function interpretWorkspacePreferenceMutation(
  result: WorkspacePreferenceMutationResult,
): WorkspacePreferenceMutationOutcome;

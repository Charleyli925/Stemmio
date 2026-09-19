import {
  WorkspacePreferencesSession,
  type WorkspacePreferenceMutationResult,
} from "../app/application/workspace-preferences-session.js";

declare const session: WorkspacePreferencesSession;
declare const result: WorkspacePreferenceMutationResult;

if (result.status === "committed") {
  const persistence: "confirmed" = result.persistence;
  void persistence;
} else if (result.status === "superseded") {
  if ("write" in result) {
    const write: "not-started" = result.write;
    void write;
  } else {
    const rollback: "confirmed" | "not-needed" = result.rollback;
    void rollback;
  }
} else if (result.status === "unknown") {
  const pending: true = result.pending;
  const phase: "commit" | "rollback" = result.phase;
  void pending;
  void phase;
} else {
  const persistence: "not-written" = result.persistence;
  void persistence;
}

session.commitDefaultAgent({
  intentId: "default-contract",
  providerId: "stemmio",
  isCurrent: () => true,
});

// @ts-expect-error Every Agent preference mutation needs an explicit identity.
session.commitDefaultAgent({ providerId: "stemmio", isCurrent: () => true });

// @ts-expect-error A boolean cannot masquerade as a durable mutation receipt.
const legacyBoolean: WorkspacePreferenceMutationResult = true;
void legacyBoolean;

export type WorkspacePreferenceMotion = "system" | "reduced";
export type WorkspacePreferenceAgentId = "stemmio" | "qoder" | "codex";
export type WorkspacePreferencesPort = Readonly<{
  get(): Promise<unknown>;
  record(input: Readonly<{ workspace: Readonly<Record<string, unknown>> }>): Promise<unknown>;
}>;

export type WorkspacePreferenceMutationResult =
  | Readonly<{
    status: "committed";
    intentId: string;
    persistence: "confirmed";
  }>
  | Readonly<{
    status: "superseded";
    intentId: string;
    write: "not-started";
  }>
  | Readonly<{
    status: "superseded";
    intentId: string;
    rollback: "confirmed" | "not-needed";
  }>
  | Readonly<{
    status: "unknown";
    intentId: string;
    phase: "commit" | "rollback";
    pending: true;
  }>
  | Readonly<{
    status: "failed";
    intentId: string;
    phase: "commit";
    persistence: "not-written";
  }>;

export type WorkspacePreferences = Readonly<{
  rememberPanelWidths: boolean;
  sidebarWidth: number;
  inspectorWidth: number;
  motion: WorkspacePreferenceMotion;
  restoreTabsOnLaunch: boolean;
  reviewChangeContextVisibility: number;
  reviewCommentContextVisibility: number;
  defaultAgentProviderId: WorkspacePreferenceAgentId;
  documentAgentSelections: Readonly<Record<string, "stemmio" | "qoder" | "codex">>;
  agentConfigurations: Readonly<Record<string, Readonly<{ modelId: string | null; reasoning: string | null }>>>;
  disabledAgentProviderIds: readonly WorkspacePreferenceAgentId[];
}>;

export type WorkspacePreferencesSnapshot = Readonly<{
  loaded: boolean;
  saving: boolean;
  error: string | null;
  workspace: WorkspacePreferences;
}>;

export class WorkspacePreferencesSession {
  constructor(options?: {
    port?: Readonly<{
      get(): Promise<unknown>;
      record(input: Readonly<{ workspace: Readonly<Record<string, unknown>> }>): Promise<unknown>;
    }> | null;
    clock?: Readonly<{ now(): number }>;
  });
  readonly snapshot: WorkspacePreferencesSnapshot;
  subscribe(listener: (snapshot: WorkspacePreferencesSnapshot) => void): () => void;
  load(): Promise<WorkspacePreferencesSnapshot>;
  update(patch: Readonly<Partial<WorkspacePreferences>>): Promise<boolean>;
  commitDefaultAgent(input: Readonly<{
    intentId: string;
    providerId: WorkspacePreferenceAgentId;
    isCurrent(): boolean;
  }>): Promise<WorkspacePreferenceMutationResult>;
  commitAgentConfigurations(input: Readonly<{
    intentId: string;
    agentConfigurations: WorkspacePreferences["agentConfigurations"];
    isCurrent(): boolean;
  }>): Promise<WorkspacePreferenceMutationResult>;
  setProviderDisabled(input: Readonly<{
    intentId: string;
    providerId: WorkspacePreferenceAgentId;
    disabled: boolean;
    isCurrent(): boolean;
  }>): Promise<WorkspacePreferenceMutationResult>;
  retry(): boolean;
  flush(input?: { deadlineAt?: number }): Promise<boolean>;
  dispose(): void;
}

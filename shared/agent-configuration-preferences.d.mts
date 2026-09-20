export type AgentPreferenceProviderId = "stemmio" | "qoder" | "codex";
export type AgentConfigurationPreferences = Readonly<Record<
  string,
  Readonly<{ modelId: string | null; reasoning: string | null }>
>>;
export type DocumentAgentSelections = Readonly<Record<string, AgentPreferenceProviderId>>;

export function normalizeAgentConfigurations(value: unknown): AgentConfigurationPreferences;
export function validAgentConfigurations(value: unknown): boolean;
export function normalizeDocumentAgentSelections(value: unknown): DocumentAgentSelections;
export function validDocumentAgentSelections(value: unknown): boolean;

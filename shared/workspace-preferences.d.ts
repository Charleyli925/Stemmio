export const WORKSPACE_PREFERENCE_SCHEMA_VERSION: 2;
export const WORKSPACE_PREFERENCE_DEFAULTS: Readonly<{
  rememberPanelWidths: true;
  sidebarWidth: 264;
  inspectorWidth: 376;
  motion: "system";
  restoreTabsOnLaunch: true;
  reviewChangeContextVisibility: 25;
  reviewCommentContextVisibility: 15;
  defaultAgentProviderId: "qoder";
  agentConfigurations: Readonly<Record<string, never>>;
  documentAgentSelections: Readonly<Record<string, never>>;
  disabledAgentProviderIds: readonly [];
}>;
export const WORKSPACE_PREFERENCE_LIMITS: Readonly<Record<string, Readonly<{ min: number; max: number }>>>;
export function normalizeWorkspacePreferences(value: unknown): Readonly<Record<string, unknown>>;
export function normalizeWorkspacePatch(value: unknown): Readonly<Record<string, unknown>>;

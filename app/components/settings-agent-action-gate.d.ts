import type { AgentSelection } from "../domain/agent-provider-state.js";
import type { AgentProviderCardData } from "./agent-provider-card-types";

type AgentActionOutcome = Readonly<{ status: string; reason?: string; code?: string }> | null | undefined;

export type SettingsCredentialRemoveAction = Readonly<{
  label: "移除 API Key" | "确认移除结果";
  description: "移除后需要重新填写" | "继续确认上次移除操作";
  reconcile: boolean;
  trigger(options?: Readonly<{ stopRun?: boolean }>): Promise<AgentActionOutcome>;
}>;

export function settingsCredentialRemoveAction(input: Readonly<{
  card: AgentProviderCardData;
  rememberedKey: boolean;
  onRemoveRememberedKey?: (
    selection: AgentSelection,
    options?: Readonly<{ stopRun?: boolean }>,
  ) => Promise<AgentActionOutcome>;
}>): SettingsCredentialRemoveAction | null;

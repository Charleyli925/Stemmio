import type {
  AgentProviderAvailabilitySnapshot,
  AgentDiagnosticSnapshot,
  AgentSelection,
} from "../domain/agent-provider-state.js";
import type { AgentProviderCardPresentation } from "./AgentProviderCard";

export type AgentProviderCardData = Readonly<{
  selection: AgentSelection;
  presentation: AgentProviderCardPresentation;
  availability: AgentProviderAvailabilitySnapshot;
  diagnostic?: AgentDiagnosticSnapshot | null;
  installState?: "idle" | "installing" | "failed" | "cancelling";
  loginUrlPresent?: boolean;
  loginOpenError?: string | null;
  activeOperation?: Readonly<{
    kind: string;
    state: string;
  }> | null;
  models?: readonly Readonly<{
    id: string;
    displayName: string;
    reasoningChoices?: readonly Readonly<{ id: string; label: string }>[];
  }>[];
  connection?: Readonly<{
    vendorId?: string;
    vendorDisplayName?: string;
    baseUrl?: string;
    authSource?: string | null;
    authScope?: string | null;
  }> | null;
  credentialPersist?: Readonly<{
    status?: string;
    reason?: string | null;
    operationId?: string | null;
    recordId?: string | null;
    code?: string | null;
  }> | null;
}>;

import type {
  AgentDiagnosticSnapshot,
  AgentProviderAvailabilitySnapshot,
  AgentSelection,
} from "../domain/agent-provider-state.js";
import type { BridgeClient } from "./bridge-client.js";

export type AgentProviderPresentation = Readonly<{
  displayName: string;
  agentName: string;
  logoSrc: string | null;
  brandIcon?: "openai" | null;
  cardClassName: string;
  primaryActionDataAttribute: string | null;
  restartLabel?: string;
  restartSupported?: boolean;
  settingsSupported?: boolean;
  localReadDisclosure?: string;
  stopLabel?: string;
  frozenPreviewDetail?: string;
  credentialKind?: "api-token" | null;
  supportsReasoning?: boolean;
  [key: string]: unknown;
}>;
export type AgentProviderDescriptor = Readonly<{
  providerId: string;
  runtimeId: string;
  securityProfile: "client-mediated" | "agent-native";
  trustPolicyVersion: string;
  installable?: boolean;
  installSource?: "user" | "managed" | "none";
  installState?: "idle" | "installing" | "failed" | "cancelling";
  selection: AgentSelection;
  presentation: AgentProviderPresentation;
  failureReason?: (code: unknown) => string;
  guidanceInstruction?: (kind: "install" | "login") => string;
}>;
export type AgentProviderEntry = AgentProviderDescriptor & Readonly<{
  availability: AgentProviderAvailabilitySnapshot;
  diagnostic: AgentDiagnosticSnapshot | null;
  installationDigest: string | null;
  models?: readonly Readonly<{
    id: string;
    displayName: string;
    isDefault?: boolean;
    providerModelId?: string | null;
    reasoningChoices?: readonly Readonly<{ id: string; label: string }>[];
  }>[];
  credentialConfigured?: boolean;
  enabled?: boolean;
  loginUrlPresent?: boolean;
  loginOpenError?: string | null;
  activeOperation?: Readonly<{
    operationId: string;
    providerId: string;
    kind: string;
    state: string;
    generation: number;
    startedAt: string | null;
    errorCode: string | null;
    cancellable: boolean;
  }> | null;
  lastOperation?: AgentProviderEntry["activeOperation"];
  credentialPersist?: Readonly<{
    status: "pending" | "saved" | "failed" | "unreadable" | "unavailable" | "rejected" | "unknown" | "skipped" | "missing" | "superseded";
    operationKind: "startup" | "persist" | "clear" | null;
    reason: string | null;
    operationId: string | null;
    recordId: string | null;
    code: string | null;
  }> | null;
  connection?: Readonly<{
    vendorId?: string;
    vendorDisplayName?: string;
    baseUrl?: string;
    authSource?: string | null;
    authScope?: string | null;
  }> | null;
}>;
export type AgentPreflight = Readonly<Record<string, unknown> & {
  status: string;
  preflightId: string;
  selection: AgentSelection;
  purpose: string;
  trustPolicyVersion: string;
  installationDigest: string;
  securityProfile: "client-mediated" | "agent-native";
}>;
export type AgentCatalogSnapshot = Readonly<{
  providers: Readonly<Record<string, AgentProviderEntry>>;
  selected: AgentSelection | null;
  pendingDefault: AgentSelection | null;
  displaySelection: AgentSelection | null;
  preflightBySelection: Readonly<Record<string, AgentPreflight>>;
}>;

export const STEMMIO_AGENT_PROVIDER: AgentProviderDescriptor;
export const QODER_AGENT_PROVIDER: AgentProviderDescriptor;
export const CODEX_AGENT_PROVIDER: AgentProviderDescriptor;
export function defaultAgentProviders(): readonly AgentProviderDescriptor[];
export function agentProviderCardPresentation(provider: AgentProviderDescriptor | AgentProviderEntry): Readonly<{
  displayName: string;
  logoSrc: string | null;
  brandIcon?: "openai" | null;
  cardClassName: string;
  primaryActionDataAttribute: string | null;
  availability: (value: AgentProviderAvailabilitySnapshot) => Readonly<{
    statusLabel: string;
    detail: string;
    tone: "ready" | "checking" | "attention";
  }>;
  actions: Readonly<{
    install: Readonly<{ label: string; copiedLabel: string }>;
    login: Readonly<{ label: string; copiedLabel: string }>;
    recheck: Readonly<{ label: string; copiedLabel: string }>;
    apiKey: Readonly<{ label: string; copiedLabel: string }>;
  }>;
  supportsApiKey?: boolean;
  credentialKind?: "api-token" | null;
  vendors?: readonly Readonly<{ id: string; label: string; needsBaseUrl?: boolean; compatibilityMode?: boolean }>[];
  supportsReasoning?: boolean;
  reasoningChoices?: readonly Readonly<{ id: string; label: string }>[];
}>;
export function agentProviderCardsFromCatalog(snapshot: AgentCatalogSnapshot | null | undefined): readonly Readonly<{
  selection: AgentSelection;
  presentation: ReturnType<typeof agentProviderCardPresentation>;
  availability: AgentProviderAvailabilitySnapshot;
  installState: AgentProviderEntry["installState"];
  diagnostic: AgentDiagnosticSnapshot | null;
  models: readonly Readonly<{
    id: string;
    displayName: string;
    isDefault?: boolean;
    providerModelId?: string | null;
    reasoningChoices?: readonly Readonly<{ id: string; label: string }>[];
  }>[];
  credentialConfigured: boolean;
  connection: AgentProviderEntry["connection"];
  credentialPersist: AgentProviderEntry["credentialPersist"];
  loginUrlPresent?: boolean;
  loginOpenError?: string | null;
  activeOperation?: AgentProviderEntry["activeOperation"];
}>[];
export class AgentCatalogState {
  constructor(options?: {
    bridgeClient: BridgeClient;
    handoffPort?: {
      copy(input: unknown): Promise<unknown>;
      openLogin?(input: { providerId: string }): Promise<unknown>;
    } | null;
    diagnoseTimeoutMs?: number;
    clock?: { now(): number };
    providers?: readonly AgentProviderDescriptor[];
    selected?: AgentSelection | null;
    configurationPreferencesPort?: Readonly<{
      getAgentConfigurations(): Promise<Record<string, { modelId?: string | null; reasoning?: string | null }>>;
      saveAgentConfigurations(
        value: Record<string, { modelId: string | null; reasoning: string | null }>,
        intent?: Readonly<{ intentId: string; isCurrent(): boolean }> | null,
      ): Promise<boolean | Readonly<{ status: "committed" | "superseded" | "failed" }>>;
    }> | null;
  });
  getSnapshot(): AgentCatalogSnapshot;
  subscribe(listener: (snapshot: AgentCatalogSnapshot) => void): () => void;
  dispose(): void;
  select(selection: AgentSelection): AgentSelection;
  configureProvider(selection: AgentSelection): AgentSelection;
  saveConfiguration(intent?: Readonly<{ intentId: string; isCurrent(): boolean }> | null): Promise<void>;
  queuePendingDefault(selection: AgentSelection): AgentSelection;
  pendingDefault(): AgentSelection | null;
  peekPendingDefaultIntent(): Readonly<{
    intentId: string;
    queuedSelection: AgentSelection;
    validatedSelection: AgentSelection | null;
  }> | null;
  bindPendingDefaultSelection(selection: AgentSelection): AgentSelection | null;
  readyPendingDefault(): AgentSelection | null;
  clearPendingDefault(expectedIntentId?: string): AgentSelection | null;
  commitPendingDefault(expectedIntentId: string): AgentSelection | null;
  publishCredentialPersist(providerId: string, result: Readonly<{
    status: string;
    operationKind?: "startup" | "persist" | "clear" | null;
    reason?: string | null;
    operationId?: string | null;
    recordId?: string | null;
    code?: string | null;
  }>): Readonly<{ status: string; reason: string | null }> | null;
  credentialPersist(providerId: string): Readonly<{
    status: string;
    operationKind: "startup" | "persist" | "clear" | null;
    reason: string | null;
    operationId: string | null;
    recordId: string | null;
    code: string | null;
  }> | null;
  publishRestoredCredentialConnection(providerId: string, status?: Readonly<{
    vendorId?: string | null;
  }>): AgentProviderEntry["connection"];
  applyDisabledProviderIds(ids?: readonly string[]): void;
  selectModel(modelId: string | null, expectedSelection?: AgentSelection | null): AgentSelection | null;
  selectReasoning(reasoning: string | null, expectedSelection?: AgentSelection | null): AgentSelection | null;
  noteRunFailure(selection: AgentSelection | null | undefined, code: unknown): AgentProviderAvailabilitySnapshot | null;
  connectWithApiKey(
    selection: AgentSelection,
    apiKey: string,
    extras?: Readonly<{
      vendorId?: string;
      baseUrl?: string;
      modelId?: string;
      remember?: boolean;
      intentId?: string;
      isCurrent?(): boolean;
    }>,
  ): Promise<unknown>;
  disconnectApiKey(
    selection?: AgentSelection | null,
    options?: Readonly<{ isCurrent?(): boolean }>,
  ): Promise<unknown>;
  freezeSelected(): AgentSelection | null;
  displaySelection(): AgentSelection | null;
  freezeProviderSelection(providerId: string): AgentSelection | null;
  provider(selection?: AgentSelection | null): AgentProviderEntry | null;
  availability(selection?: AgentSelection | null): AgentProviderAvailabilitySnapshot;
  displayAvailability(selection?: AgentSelection | null): AgentProviderAvailabilitySnapshot;
  presentation(selection?: AgentSelection | null): AgentProviderPresentation;
  refreshAvailability(selection?: AgentSelection | null): Promise<unknown>;
  diagnose(selection?: AgentSelection | null): Promise<unknown>;
  preflight(selection?: AgentSelection | null, options?: {
    force?: boolean;
    purpose?: "execution";
    trustPolicyVersion?: string | null;
    installationDigest?: string | null;
  }): Promise<AgentPreflight>;
  spendTicket(selection?: AgentSelection | null, options?: {
    force?: boolean;
    purpose?: "execution";
    trustPolicyVersion?: string | null;
    installationDigest?: string | null;
  }): Promise<AgentPreflight>;
  discardTicket(preflight: AgentPreflight): boolean;
  install(selection?: AgentSelection | null): Promise<unknown>;
  cancelInstall(selection?: AgentSelection | null): Promise<unknown>;
  startLogin(selection?: AgentSelection | null): Promise<unknown>;
  reopenOfficialLogin(selection?: AgentSelection | null): Promise<unknown>;
  startLogout(selection?: AgentSelection | null): Promise<unknown>;
  cancelAccessOperation(selection?: AgentSelection | null): Promise<unknown>;
  copyGuidance(kind: "install" | "login", selection?: AgentSelection | null): Promise<unknown>;
}
export const AgentProviderCatalog: typeof AgentCatalogState;

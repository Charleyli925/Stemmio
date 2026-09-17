export const MANAGED_AGENT_MODE = "managed-agent";
export const CLIPBOARD_DELIVERY_MODE = "clipboard";
export const LEGACY_QODER_ACP_MODE = "qoder-acp";
export const TRUSTED_LOCAL_AGENT_POLICY_VERSION = "trusted-local-agent-v1";
export const AGENT_RECOVERY_KINDS = Object.freeze([
  "retry",
  "wait",
  "reauthenticate",
  "change-model",
  "change-provider",
  "repair-installation",
  "end",
]);

const RECOVERY_BY_ERROR = Object.freeze(new Map([
  ...[
    "AGENT_AUTH_REQUIRED",
    "AGENT_SESSION_CREDENTIAL_INVALID",
    "AGENT_SESSION_CREDENTIAL_STALE",
    "CODEX_AUTH_REQUIRED",
    "QODER_AUTH_REQUIRED",
  ].map((code) => [code, "reauthenticate"]),
  ...[
    "AGENT_ACCOUNT_CAPACITY_UNAVAILABLE",
    "AGENT_BALANCE_INSUFFICIENT",
    "AGENT_PLAN_LIMIT",
    "AGENT_ENDPOINT_REGION_MISMATCH",
    "CODEX_ACCOUNT_CAPACITY_UNAVAILABLE",
    "QODER_ACCOUNT_CAPACITY_UNAVAILABLE",
    "QODER_CAPACITY_UNAVAILABLE",
  ].map((code) => [code, "change-provider"]),
  ...[
    "AGENT_MODEL_ACCESS_DENIED",
    "AGENT_MODEL_CATALOG_EMPTY",
    "AGENT_MODEL_ID_REQUIRED",
    "AGENT_MODEL_NOT_RELEASED",
    "AGENT_OUTPUT_TRUNCATED",
    "AGENT_PROMPT_TOO_LARGE",
    "AGENT_SELECTION_UNSUPPORTED",
    "CODEX_MODEL_CATALOG_EMPTY",
    "QODER_MODEL_CATALOG_EMPTY",
  ].map((code) => [code, "change-model"]),
  ["AGENT_RATE_LIMITED", "wait"],
  ...[
    "AGENT_NETWORK_INTERRUPTED",
    "AGENT_PROVIDER_OVERLOADED",
    "AGENT_PROVIDER_UNAVAILABLE",
    "AGENT_TURN_TIMEOUT",
    "ACP_TURN_TIMEOUT",
    "CODEX_TURN_TIMEOUT",
    "QODER_TURN_TIMEOUT",
  ].map((code) => [code, "retry"]),
  ...[
    "AGENT_COMMAND_NOT_FOUND",
    "AGENT_INSTALLATION_CHANGED",
    "AGENT_INSTALLATION_UNTRUSTED",
    "ACP_AGENT_EXECUTABLE_CHANGED",
    "ACP_AGENT_EXECUTABLE_INVALID",
    "CODEX_COMMAND_CHANGED",
    "CODEX_COMMAND_NOT_FOUND",
    "CODEX_INSTALLATION_CHANGED",
    "CODEX_INSTALLATION_MISSING",
    "CODEX_INSTALLATION_UNTRUSTED",
    "CODEX_VERSION_MISMATCH",
    "CODEX_VERSION_UNSUPPORTED",
    "QODER_COMMAND_CHANGED",
    "QODER_COMMAND_NOT_FOUND",
    "QODER_COMMAND_UNTRUSTED",
    "QODER_VERSION_INVALID",
    "QODER_VERSION_MISMATCH",
    "QODER_VERSION_UNSUPPORTED",
  ].map((code) => [code, "repair-installation"]),
  ["AGENT_INPUT_RESOURCE_LIMIT", "end"],
]));

export function agentRecoveryKindForError(code, { safeToRetry = false } = {}) {
  if (!safeToRetry) return "end";
  const mapped = RECOVERY_BY_ERROR.get(String(code || ""));
  if (mapped) return mapped;
  return "retry";
}

const REASONING_RESOLUTIONS = new Set([
  "exact",
  "provider-default",
  "unsupported",
]);
const SHA256 = /^sha256:[a-f0-9]{64}$/u;

function deliveryError(message) {
  const error = new Error(message);
  error.name = "AgentDeliveryError";
  error.code = "AGENT_DELIVERY_INVALID";
  return error;
}

function record(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw deliveryError(`${label} must be an object.`);
  }
  return value;
}

function boundedIdentity(value, label) {
  const text = typeof value === "string" ? value : "";
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/u.test(text)) {
    throw deliveryError(`${label} is invalid.`);
  }
  return text;
}

function nullableModelId(value, label) {
  if (value === null) return null;
  const text = typeof value === "string" ? value : "";
  if (!text || text.length > 160 || /[\u0000-\u001f\u007f]/u.test(text)) {
    throw deliveryError(`${label} is invalid.`);
  }
  return text;
}

function reasoningSelection(value) {
  const input = record(value, "Agent reasoning selection");
  const requested = nullableModelId(input.requested, "requested reasoning");
  const applied = nullableModelId(input.applied, "applied reasoning");
  const resolution = String(input.resolution || "");
  if (!REASONING_RESOLUTIONS.has(resolution)) {
    throw deliveryError("Agent reasoning resolution is invalid.");
  }
  if (resolution === "provider-default" && (requested !== null || applied !== null)) {
    throw deliveryError("Provider-default reasoning cannot carry an override.");
  }
  if (resolution === "exact" && (!requested || requested !== applied)) {
    throw deliveryError("Exact reasoning requires equal requested and applied values.");
  }
  if (resolution === "unsupported" && (!requested || applied !== null)) {
    throw deliveryError("Unsupported reasoning requires a request and no applied value.");
  }
  return Object.freeze({ requested, applied, resolution });
}

function configurationSnapshot(value) {
  const input = record(value, "Agent configuration snapshot");
  const configurationDigest = String(input.configurationDigest || "");
  if (!SHA256.test(configurationDigest)) {
    throw deliveryError("Agent configuration digest is invalid.");
  }
  const nullable = (candidate) => candidate === null || candidate === undefined
    ? null
    : String(candidate).slice(0, 200);
  return Object.freeze({
    schemaVersion: String(input.schemaVersion || "1.0.0"),
    providerId: boundedIdentity(input.providerId, "configuration providerId"),
    runtimeId: boundedIdentity(input.runtimeId, "configuration runtimeId"),
    vendorId: nullable(input.vendorId),
    baseUrlOrigin: nullable(input.baseUrlOrigin),
    modelId: nullable(input.modelId),
    reasoning: String(input.reasoning || "auto").slice(0, 80),
    capabilityRevision: String(input.capabilityRevision || "1").slice(0, 80),
    credentialGeneration: Math.max(0, Number(input.credentialGeneration) || 0),
    configurationDigest,
  });
}

export function defaultManagedAgentDelivery() {
  return Object.freeze({
    mode: MANAGED_AGENT_MODE,
    selection: Object.freeze({
      providerId: "qoder",
      runtimeId: "acp",
      requestedModelId: null,
      resolvedModelId: null,
      reasoning: Object.freeze({
        requested: null,
        applied: null,
        resolution: "provider-default",
      }),
    }),
    trustPolicyVersion: TRUSTED_LOCAL_AGENT_POLICY_VERSION,
  });
}

export function normalizeAgentDelivery(value, { allowLegacy = true } = {}) {
  const input = record(value, "Agent delivery");
  if (input.mode === CLIPBOARD_DELIVERY_MODE) {
    return Object.freeze({ mode: CLIPBOARD_DELIVERY_MODE });
  }
  if (allowLegacy && input.mode === LEGACY_QODER_ACP_MODE) {
    if (input.trustPolicyVersion !== TRUSTED_LOCAL_AGENT_POLICY_VERSION) {
      throw deliveryError("Legacy Agent delivery trust policy is invalid.");
    }
    return defaultManagedAgentDelivery();
  }
  if (input.mode !== MANAGED_AGENT_MODE) {
    throw deliveryError("Agent delivery mode is unsupported.");
  }
  if (input.trustPolicyVersion !== TRUSTED_LOCAL_AGENT_POLICY_VERSION) {
    throw deliveryError("Agent delivery trust policy is invalid.");
  }
  const selection = record(input.selection, "Agent provider selection");
  const providerId = boundedIdentity(selection.providerId, "providerId");
  const requestedModelId = nullableModelId(selection.requestedModelId, "requestedModelId");
  const resolvedModelId = nullableModelId(selection.resolvedModelId, "resolvedModelId");
  for (const [modelId, label] of [
    [requestedModelId, "requestedModelId"],
    [resolvedModelId, "resolvedModelId"],
  ]) {
    if (modelId !== null && !modelId.startsWith(`${providerId}:`)) {
      throw deliveryError(`${label} must use the selected provider namespace.`);
    }
  }
  const runtimeId = boundedIdentity(selection.runtimeId, "runtimeId");
  const normalizedConfiguration = input.configuration
    ? configurationSnapshot(input.configuration)
    : null;
  if (normalizedConfiguration && (
    normalizedConfiguration.providerId !== providerId
    || normalizedConfiguration.runtimeId !== runtimeId
    || normalizedConfiguration.modelId !== (resolvedModelId || requestedModelId)
    || normalizedConfiguration.reasoning !== (
      selection.reasoning?.applied || selection.reasoning?.requested || "auto"
    )
  )) {
    throw deliveryError("Agent configuration does not match its selection.");
  }
  return Object.freeze({
    mode: MANAGED_AGENT_MODE,
    selection: Object.freeze({
      providerId,
      runtimeId,
      requestedModelId,
      resolvedModelId,
      reasoning: reasoningSelection(selection.reasoning),
    }),
    trustPolicyVersion: TRUSTED_LOCAL_AGENT_POLICY_VERSION,
    ...(normalizedConfiguration ? { configuration: normalizedConfiguration } : {}),
  });
}

export function agentDeliveryIsManaged(value) {
  try {
    return normalizeAgentDelivery(value).mode === MANAGED_AGENT_MODE;
  } catch {
    return false;
  }
}

const SHIPPED_MANAGED_BINDINGS = Object.freeze([
  Object.freeze({ providerId: "qoder", runtimeId: "acp", legacyDriver: LEGACY_QODER_ACP_MODE }),
  Object.freeze({ providerId: "codex", runtimeId: "acp", legacyDriver: null }),
  Object.freeze({ providerId: "stemmio", runtimeId: "http", legacyDriver: null }),
]);

function shippedManagedBinding(selection) {
  return SHIPPED_MANAGED_BINDINGS.find((binding) => (
    binding.providerId === selection.providerId
    && binding.runtimeId === selection.runtimeId
  )) || null;
}

function unsupportedProviderError() {
  const error = new Error("The persisted Agent provider is not installed in this build.");
  error.name = "AgentDeliveryError";
  error.code = "AGENT_PROVIDER_UNSUPPORTED";
  return error;
}

function assertShippedManagedSelection(selection) {
  const binding = shippedManagedBinding(selection);
  if (!binding) throw unsupportedProviderError();
  return binding;
}

export function legacyDriverForAgentDelivery(value) {
  const delivery = normalizeAgentDelivery(value);
  if (delivery.mode !== MANAGED_AGENT_MODE) return null;
  return assertShippedManagedSelection(delivery.selection).legacyDriver;
}

// New durable writes are narrower than historical reads. Unknown providers are
// retained by normalizeAgentDelivery so their records remain inspectable and
// cancellable, but a build may create a managed Request only for a binding it
// can actually dispatch now. That check is the shipped provider/runtime pair,
// not the presence of a legacy driver alias.
export function normalizeNewAgentDelivery(value) {
  const delivery = normalizeAgentDelivery(value, { allowLegacy: false });
  if (delivery.mode === MANAGED_AGENT_MODE) {
    assertShippedManagedSelection(delivery.selection);
    if (!delivery.configuration) {
      throw deliveryError("New managed Agent Requests require a configuration snapshot.");
    }
  }
  return delivery;
}

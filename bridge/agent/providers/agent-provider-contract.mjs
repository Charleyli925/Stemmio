import { LifecycleError } from "../../lifecycle-core.mjs";

const SAFE_COMPONENT_ID = /^[a-z][a-z0-9-]{0,63}$/u;
export const AGENT_SECURITY_PROFILES = Object.freeze([
  "client-mediated",
  "agent-native",
]);
const CAPABILITY_NAMES = Object.freeze([
  "availability",
  "preflight",
  "execution",
  "modelCatalog",
  "install",
  "login",
  "logout",
  "sessionCredential",
  "disconnect",
]);

const PURPOSE_CAPABILITIES = Object.freeze({
  execution: "execution",
});

export class AgentProviderError extends LifecycleError {
  constructor(code, message, { status = 422, details } = {}) {
    super(code, message, details, status);
    this.name = "AgentBridgeError";
  }
}

export function agentProviderError(code, message, options) {
  return new AgentProviderError(code, message, options);
}

function assertComponentId(value, label) {
  if (typeof value !== "string" || !SAFE_COMPONENT_ID.test(value)) {
    throw new TypeError(`${label} must be a lower-case component identifier.`);
  }
  return value;
}

export function assertAgentSecurityProfile(value, label = "securityProfile") {
  if (!AGENT_SECURITY_PROFILES.includes(value)) {
    throw agentProviderError(
      "AGENT_SECURITY_PROFILE_INVALID",
      `Agent ${label} is invalid.`,
      { status: 409 },
    );
  }
  return value;
}

function normalizedCapabilities(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Agent provider capabilities must be an object.");
  }
  const unexpected = Object.keys(value).find((name) => !CAPABILITY_NAMES.includes(name));
  if (unexpected) {
    throw new TypeError(`Agent provider capability ${JSON.stringify(unexpected)} is unsupported.`);
  }
  return Object.freeze(Object.fromEntries(
    CAPABILITY_NAMES.map((name) => [name, value[name] === true]),
  ));
}

export function defineAgentProvider(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Agent provider must be an object.");
  }
  if (Object.hasOwn(value, "legacyDrivers")) {
    throw new TypeError("Agent provider legacy driver mappings are unsupported.");
  }
  const providerId = assertComponentId(value.providerId, "providerId");
  const runtimeId = assertComponentId(value.runtimeId, "runtimeId");
  const displayName = typeof value.displayName === "string" && value.displayName.trim()
    ? value.displayName.trim().slice(0, 80)
    : providerId;
  const securityProfile = assertAgentSecurityProfile(
    value.securityProfile,
    "provider securityProfile",
  );
  const capabilities = normalizedCapabilities(value.capabilities);
  const requiredMethods = [
    "resolveInstallation",
    "diagnose",
    "preflight",
    "assertInstallationUnchanged",
    "installationDigest",
    "availabilityFailure",
    "normalizePreflightError",
    "normalizeRuntimeError",
    "preflightFailureMessage",
    "loadExecutionPolicy",
    "createRuntimeLaunch",
    "classifyRunFailure",
    "failureMessage",
  ];
  for (const method of requiredMethods) {
    if (typeof value[method] !== "function") {
      throw new TypeError(`Agent provider ${providerId} requires ${method}().`);
    }
  }
  return Object.freeze({
    ...value,
    providerId,
    runtimeId,
    displayName,
    securityProfile,
    capabilities,
  });
}

export function assertProviderCapability(provider, purpose) {
  const capability = PURPOSE_CAPABILITIES[purpose];
  if (!capability || provider?.capabilities?.[capability] !== true) {
    throw agentProviderError(
      "AGENT_CAPABILITY_UNSUPPORTED",
      "The selected Agent provider does not support this operation.",
      { status: 409 },
    );
  }
  return capability;
}

export function assertProviderTicket(ticket) {
  if (!ticket || typeof ticket !== "object" || Array.isArray(ticket)) {
    throw agentProviderError(
      "AGENT_PROVIDER_TICKET_INVALID",
      "Agent provider ticket is invalid.",
      { status: 409 },
    );
  }
  assertComponentId(ticket.providerId, "ticket providerId");
  assertComponentId(ticket.runtimeId, "ticket runtimeId");
  assertAgentSecurityProfile(ticket.securityProfile, "ticket securityProfile");
  if (typeof ticket.installationDigest !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(ticket.installationDigest)) {
    throw agentProviderError(
      "AGENT_PROVIDER_TICKET_INVALID",
      "Agent provider ticket installation identity is invalid.",
      { status: 409 },
    );
  }
  normalizedCapabilities(ticket.capabilities);
  if (ticket.purpose !== undefined) {
    if (!PURPOSE_CAPABILITIES[ticket.purpose]) {
      throw agentProviderError(
        "AGENT_PROVIDER_TICKET_INVALID",
        "Agent provider ticket purpose is invalid.",
        { status: 409 },
      );
    }
  }
  return ticket;
}

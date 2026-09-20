import {
  agentProviderError,
  assertAgentSecurityProfile,
  assertProviderCapability,
  assertProviderTicket,
} from "./agent-provider-contract.mjs";
import { createQoderProvider } from "./qoder-provider.mjs";
import { createCodexAcpProvider } from "./codex-acp-provider.mjs";
import { createOpenAiCompatibleProvider } from "./openai-compatible-provider.mjs";
import { createAcpRuntime } from "../runtimes/acp-runtime.mjs";
import { createHttpRuntime } from "../runtimes/http-runtime.mjs";
import { createRuntimeRegistry } from "../runtimes/runtime-registry.mjs";
import {
  normalizeAgentDelivery,
  TRUSTED_LOCAL_AGENT_POLICY_VERSION,
} from "../../../shared/agent-delivery.mjs";
import { createAgentCatalog, defaultAgentsRoot } from "../catalog/agent-catalog.mjs";
import {
  createAgentConfigurationSnapshot,
  sameAgentConfiguration,
} from "../agent-configuration-snapshot.mjs";

function selectionForProvider(provider) {
  return Object.freeze({
    providerId: provider.providerId,
    runtimeId: provider.runtimeId,
    requestedModelId: null,
    resolvedModelId: null,
    reasoning: Object.freeze({
      requested: null,
      applied: null,
      resolution: "provider-default",
    }),
  });
}

function assertResolvedSelection(selection, provider) {
  let normalized;
  try {
    normalized = normalizeAgentDelivery({
      mode: "managed-agent",
      selection,
      trustPolicyVersion: TRUSTED_LOCAL_AGENT_POLICY_VERSION,
    }).selection;
  } catch {
    throw agentProviderError(
      "AGENT_SELECTION_UNSUPPORTED",
      "The requested Agent provider selection is unsupported.",
      { status: 409 },
    );
  }
  if (normalized.providerId !== provider.providerId
    || normalized.runtimeId !== provider.runtimeId) {
    throw agentProviderError(
      "AGENT_SELECTION_UNSUPPORTED",
      "The requested Agent provider selection is unsupported.",
      { status: 409 },
    );
  }
  return normalized;
}

function sameSelection(left, right) {
  return left.providerId === right.providerId
    && left.runtimeId === right.runtimeId
    && left.requestedModelId === right.requestedModelId
    && left.resolvedModelId === right.resolvedModelId
    && left.reasoning.requested === right.reasoning.requested
    && left.reasoning.applied === right.reasoning.applied
    && left.reasoning.resolution === right.reasoning.resolution;
}

function diagnosticReadiness(result, cause = null) {
  if (result?.status === "ready") return "ready";
  if (result?.status === "not-installed") return "not-installed";
  if (result?.status === "auth-required") return "auth-required";
  if (result?.reason === "invalid-installation") return "invalid-installation";
  if (["AGENT_AUTH_REQUIRED", "CODEX_AUTH_REQUIRED", "QODER_AUTH_REQUIRED"].includes(cause?.code)) {
    return "auth-required";
  }
  if (["AGENT_COMMAND_NOT_FOUND", "CODEX_COMMAND_NOT_FOUND", "QODER_COMMAND_NOT_FOUND"].includes(cause?.code)) {
    return "not-installed";
  }
  if ([
    "AGENT_INSTALLATION_UNTRUSTED",
    "CODEX_COMMAND_UNTRUSTED",
    "QODER_COMMAND_UNTRUSTED",
    "CODEX_VERSION_UNSUPPORTED",
    "QODER_VERSION_UNSUPPORTED",
    "CODEX_VERSION_MISMATCH",
    "QODER_VERSION_MISMATCH",
  ].includes(cause?.code)) return "invalid-installation";
  return "connection-failed";
}

function diagnosticCause(result, cause = null) {
  const raw = result?.reason || cause?.code || "connection-failed";
  return String(raw).replace(/[^A-Za-z0-9_-]/gu, "").slice(0, 80) || "connection-failed";
}

function diagnosticActiveInstallation(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const phase = String(value.phase || "");
  return ["installing", "cancelling"].includes(phase)
    ? Object.freeze({ phase })
    : null;
}

const DIAGNOSTIC_FACT_STATUSES = new Set([
  "unknown", "configured", "ready", "missing", "invalid", "required", "failed", "unavailable",
]);

function publicDiagnosticFacts(value, readiness, cause = null) {
  const raw = value?.facts && typeof value.facts === "object" && !Array.isArray(value.facts)
    ? value.facts
    : {};
  const defaults = {
    installation: readiness === "not-installed" ? "missing"
      : readiness === "invalid-installation" ? "invalid" : "ready",
    authentication: readiness === "auth-required" ? "required" : "unknown",
    protocol: readiness === "connection-failed" ? "failed" : "unknown",
    service: "unknown",
  };
  return Object.freeze(Object.fromEntries([
    "installation", "authentication", "protocol", "service",
  ].map((name) => {
    const input = raw[name] && typeof raw[name] === "object" ? raw[name] : { status: raw[name] };
    const status = DIAGNOSTIC_FACT_STATUSES.has(input?.status) ? input.status : defaults[name];
    const factCause = ["unknown", "configured", "ready"].includes(status)
      ? null
      : String(input?.cause || cause?.code || value?.cause || "connection-failed")
        .replace(/[^A-Za-z0-9_-]/gu, "").slice(0, 80) || "connection-failed";
    return [name, Object.freeze({ status, cause: factCause, source: "diagnose" })];
  })));
}

export function createProviderRegistry({ providers = [], runtimeRegistry } = {}) {
  if (!runtimeRegistry || typeof runtimeRegistry.resolve !== "function") {
    throw new TypeError("Provider registry requires a runtime registry.");
  }
  const byProviderId = new Map();
  for (const provider of providers) {
    if (!provider?.providerId || !provider?.runtimeId) {
      throw new TypeError("Provider registry entries must satisfy the Agent provider contract.");
    }
    if (byProviderId.has(provider.providerId)) {
      throw new TypeError(`Duplicate Agent provider ${provider.providerId}.`);
    }
    // Resolve at composition time so a provider cannot register a runtime that
    // will fail only after a one-use preflight ticket has been consumed.
    runtimeRegistry.resolve(provider.runtimeId);
    byProviderId.set(provider.providerId, provider);
  }

  const resolveProvider = (providerId) => {
    const provider = byProviderId.get(String(providerId || ""));
    if (!provider) {
      throw agentProviderError(
        "AGENT_PROVIDER_UNSUPPORTED",
        "The requested Agent provider is unsupported.",
        { status: 400 },
      );
    }
    return provider;
  };

  const bindingForProvider = (provider) => Object.freeze({
    provider,
    runtime: runtimeRegistry.resolve(provider.runtimeId),
  });

  const resolveSelection = (selection) => {
    if (!selection || typeof selection !== "object" || Array.isArray(selection)) {
      throw agentProviderError(
        "AGENT_SELECTION_UNSUPPORTED",
        "The requested Agent provider selection is unsupported.",
        { status: 400 },
      );
    }
    const provider = resolveProvider(selection.providerId);
    assertResolvedSelection(selection, provider);
    return bindingForProvider(provider);
  };

  const resolveTicket = (ticketInput, purpose = ticketInput?.purpose) => {
    const ticket = assertProviderTicket(ticketInput);
    const binding = bindingForProvider(resolveProvider(ticket.providerId));
    if (
      binding.provider.runtimeId !== ticket.runtimeId
      || binding.provider.securityProfile !== ticket.securityProfile
    ) {
      throw agentProviderError(
        "AGENT_PROVIDER_TICKET_INVALID",
        "Agent provider ticket binding is invalid.",
        { status: 409 },
      );
    }
    if (purpose) assertProviderCapability(binding.provider, purpose);
    return binding;
  };

  const prepareForSelection = async (selection, purpose, environment) => {
    const { provider } = resolveSelection(selection);
    const requestedSelection = assertResolvedSelection(selection, provider);
    const resolvesSelection = typeof provider.resolveSelection === "function";
    if (!resolvesSelection && !sameSelection(requestedSelection, selectionForProvider(provider))) {
      throw agentProviderError(
        "AGENT_SELECTION_UNSUPPORTED",
        "The selected Agent model or reasoning policy is unsupported.",
        { status: 409 },
      );
    }
    if (provider.capabilities.preflight !== true) {
      throw agentProviderError(
        "AGENT_CAPABILITY_UNSUPPORTED",
        "The selected Agent provider does not support preflight.",
        { status: 409 },
      );
    }
    assertProviderCapability(provider, purpose);
    try {
      const installation = await provider.resolveInstallation({ environment });
      const evidence = await provider.preflight(installation, {
        environment,
        purpose,
        selection: requestedSelection,
      });
      await provider.assertInstallationUnchanged(installation);
      const resolvedSelection = assertResolvedSelection(
        resolvesSelection
          ? await provider.resolveSelection(requestedSelection, { evidence, purpose })
          : requestedSelection,
        provider,
      );
      const installationDigest = provider.installationDigest(installation);
      const configuration = createAgentConfigurationSnapshot({
        providerId: provider.providerId,
        runtimeId: provider.runtimeId,
        installation,
        installationDigest,
        selection: resolvedSelection,
        capabilityRevision: provider.capabilityRevision || evidence.capabilityRevision || evidence.version,
      });
      return Object.freeze({
        purpose,
        providerId: provider.providerId,
        runtimeId: provider.runtimeId,
        securityProfile: provider.securityProfile,
        installation,
        installationDigest,
        configuration,
        capabilities: provider.capabilities,
        evidence,
        selection: resolvedSelection,
      });
    } catch (cause) {
      if (["AGENT_CAPABILITY_UNSUPPORTED", "AGENT_SELECTION_UNSUPPORTED"].includes(cause?.code)) {
        throw cause;
      }
      throw provider.normalizePreflightError(cause);
    }
  };

  const runTicket = async (ticket, input) => {
    const { provider, runtime } = resolveTicket(ticket, ticket.purpose);
    const launch = provider.createRuntimeLaunch({ ticket, ...input });
    if (!launch || typeof launch !== "object" || Array.isArray(launch)
      || assertAgentSecurityProfile(launch.securityProfile, "launch securityProfile")
        !== ticket.securityProfile) {
      throw agentProviderError(
        "AGENT_SECURITY_PROFILE_MISMATCH",
        "Agent launch security profile does not match its ticket.",
        { status: 409 },
      );
    }
    try {
      return await runtime.run(Object.freeze({ ...launch }));
    } catch (cause) {
      throw provider.normalizeRuntimeError(cause);
    }
  };

  return Object.freeze({
    catalog() {
      return Object.freeze([...byProviderId.values()].map((provider) => Object.freeze({
        providerId: provider.providerId,
        displayName: provider.displayName,
        runtimeId: provider.runtimeId,
        capabilities: provider.capabilities,
      })));
    },
    resolveSelection,
    assertCapabilityForSelection(selection, purpose) {
      const { provider } = resolveSelection(selection);
      return assertProviderCapability(provider, purpose);
    },
    resolveTicket,
    async availabilityForSelection(selection, { environment } = {}) {
      const { provider } = resolveSelection(selection);
      if (provider.capabilities.availability !== true) {
        throw agentProviderError(
          "AGENT_CAPABILITY_UNSUPPORTED",
          "The selected Agent provider does not support availability checks.",
          { status: 409 },
        );
      }
      try {
        await provider.resolveInstallation({ environment });
        return Object.freeze({ status: "ready" });
      } catch (cause) {
        return provider.availabilityFailure(cause);
      }
    },
    async diagnoseForSelection(selection, { environment, checkedAt = null } = {}) {
      const { provider } = resolveSelection(selection);
      const operation = "diagnose";
      if (provider.capabilities.availability !== true) {
        return Object.freeze({
          status: "unavailable",
          reason: "check-failed",
          diagnostic: Object.freeze({
            readiness: "connection-failed",
            cause: "AGENT_CAPABILITY_UNSUPPORTED",
            operation,
            checkedAt,
            activeInstallation: null,
            facts: publicDiagnosticFacts(null, "connection-failed", {
              code: "AGENT_CAPABILITY_UNSUPPORTED",
            }),
          }),
        });
      }
      try {
        const installation = await provider.resolveInstallation({ environment });
        const diagnosis = await provider.diagnose(installation, {
          environment,
          selection,
        });
        const readiness = [
          "ready",
          "not-installed",
          "auth-required",
          "invalid-installation",
          "connection-failed",
        ].includes(diagnosis?.readiness)
          ? diagnosis.readiness
          : "connection-failed";
        const cause = readiness === "ready"
          ? null
          : String(diagnosis?.cause || "connection-failed").replace(/[^A-Za-z0-9_-]/gu, "").slice(0, 80)
            || "connection-failed";
        return Object.freeze({
          status: readiness === "ready" ? "ready" : readiness === "not-installed"
            ? "not-installed"
            : readiness === "auth-required" ? "auth-required" : "unavailable",
          ...(readiness === "ready" || readiness === "not-installed" || readiness === "auth-required"
            ? {}
            : { reason: readiness === "invalid-installation" ? "invalid-installation" : "check-failed" }),
          diagnostic: Object.freeze({
            readiness,
            cause,
            operation,
            checkedAt,
            activeInstallation: diagnosticActiveInstallation(diagnosis?.activeInstallation),
            facts: publicDiagnosticFacts(diagnosis, readiness, cause ? { code: cause } : null),
          }),
        });
      } catch (cause) {
        const availability = provider.availabilityFailure(cause);
        return Object.freeze({
          ...availability,
          diagnostic: Object.freeze({
            readiness: diagnosticReadiness(availability, cause),
            cause: diagnosticCause(availability, cause),
            operation,
            checkedAt,
            activeInstallation: null,
            facts: publicDiagnosticFacts(null, diagnosticReadiness(availability, cause), cause),
          }),
        });
      }
    },
    preflightForSelection(selection, purpose, { environment } = {}) {
      return prepareForSelection(selection, purpose, environment);
    },
    async verifyTicket(ticket, { purpose = ticket?.purpose, environment } = {}) {
      const { provider } = resolveTicket(ticket, purpose);
      await provider.assertInstallationUnchanged(ticket.installation, { environment });
      if (provider.installationDigest(ticket.installation) !== ticket.installationDigest) {
        throw agentProviderError(
          "AGENT_PROVIDER_TICKET_INVALID",
          "Agent installation identity no longer matches its preflight ticket.",
          { status: 409 },
        );
      }
      if (ticket.configuration) {
        const current = createAgentConfigurationSnapshot({
          providerId: ticket.providerId,
          runtimeId: ticket.runtimeId,
          installation: ticket.installation,
          installationDigest: ticket.installationDigest,
          selection: ticket.selection,
          capabilityRevision: provider.capabilityRevision
            || ticket.evidence?.capabilityRevision
            || ticket.evidence?.version,
        });
        if (!sameAgentConfiguration(ticket.configuration, current)) {
          throw agentProviderError(
            "AGENT_CONFIGURATION_CHANGED",
            "Agent configuration no longer matches its preflight ticket.",
            { status: 409 },
          );
        }
      }
      return ticket;
    },
    async loadExecutionPolicy(ticket, input) {
      const { provider } = resolveTicket(ticket, "execution");
      try {
        return await provider.loadExecutionPolicy(input);
      } catch (cause) {
        throw provider.normalizeRuntimeError(cause);
      }
    },
    run: runTicket,
    classifyRunFailure(ticket, cause) {
      const { provider } = resolveTicket(ticket, ticket.purpose);
      return provider.classifyRunFailure(provider.normalizeRuntimeError(cause));
    },
    failureMessage(ticket, code) {
      const { provider } = resolveTicket(ticket, ticket.purpose);
      return provider.failureMessage(code);
    },
    failureMessageForSelection(selection, code) {
      const { provider } = resolveSelection(selection);
      return provider.failureMessage(code);
    },
    preflightFailureMessageForSelection(selection, code) {
      const { provider } = resolveSelection(selection);
      return provider.preflightFailureMessage(code);
    },
  });
}

export function createDefaultProviderRegistry({
  commandResolver,
  preflightRunner,
  diagnoseRunner,
  policyLoader,
  runTask,
  codexCommandResolver,
  codexPreflightRunner,
  codexDiagnoseRunner,
  agentCatalog,
  agentsRoot,
  installerOptions,
} = {}) {
  const catalog = agentCatalog || createAgentCatalog({
    agentsRoot: agentsRoot || defaultAgentsRoot(),
    ...(installerOptions ? { installerOptions } : {}),
  });
  const runtimes = [
    createAcpRuntime({ ...(runTask ? { runTask } : {}) }),
    createHttpRuntime(),
  ];
  const providers = [createOpenAiCompatibleProvider(), createQoderProvider({
    ...(commandResolver ? { commandResolver } : {}),
    ...(diagnoseRunner ? { diagnoseRunner } : {}),
    ...(preflightRunner ? { preflightRunner } : {}),
    ...(policyLoader ? { policyLoader } : {}),
    managedCandidates: () => catalog.managedCommandCandidates("qoder"),
  })];
  providers.push(createCodexAcpProvider({
    ...(codexCommandResolver ? { commandResolver: codexCommandResolver } : {}),
    ...(codexDiagnoseRunner ? { diagnoseRunner: codexDiagnoseRunner } : {}),
    ...(codexPreflightRunner ? { preflightRunner: codexPreflightRunner } : {}),
    managedCandidates: () => catalog.managedCommandCandidates("codex"),
  }));
  const runtimeRegistry = createRuntimeRegistry(runtimes);
  const registry = createProviderRegistry({
    providers,
    runtimeRegistry,
  });
  catalog.bindLoginExecutor(async (providerId, context) => {
    const listed = registry.catalog().find((item) => item.providerId === providerId);
    if (!listed) {
      throw agentProviderError(
        "AGENT_PROVIDER_UNSUPPORTED",
        "The selected Agent is not in Stemmio's ACP catalog.",
        { status: 404 },
      );
    }
    const { provider } = registry.resolveSelection({
      providerId: listed.providerId,
      runtimeId: listed.runtimeId,
      requestedModelId: null,
      resolvedModelId: null,
      reasoning: Object.freeze({
        requested: null,
        applied: null,
        resolution: "provider-default",
      }),
    });
    if (provider.capabilities.login !== true || typeof provider.startLogin !== "function") {
      throw agentProviderError(
        "AGENT_LOGIN_UNSUPPORTED",
        "This Agent cannot start an official login.",
        { status: 409 },
      );
    }
    const installation = await provider.resolveInstallation({
      environment: context.environment || process.env,
    });
    return provider.startLogin(installation, {
      environment: context.environment || process.env,
      signal: context.signal,
      timeoutMs: context.timeoutMs,
      onLoginUrl: context.onLoginUrl,
    });
  });
  catalog.bindLogoutExecutor(async (providerId) => {
    const listed = registry.catalog().find((item) => item.providerId === providerId);
    if (!listed) {
      throw agentProviderError(
        "AGENT_PROVIDER_UNSUPPORTED",
        "The selected Agent is not in Stemmio's ACP catalog.",
        { status: 404 },
      );
    }
    const { provider } = registry.resolveSelection({
      providerId: listed.providerId,
      runtimeId: listed.runtimeId,
      requestedModelId: null,
      resolvedModelId: null,
      reasoning: Object.freeze({
        requested: null,
        applied: null,
        resolution: "provider-default",
      }),
    });
    if (provider.capabilities.logout !== true || typeof provider.startLogout !== "function") {
      throw agentProviderError(
        "AGENT_LOGOUT_UNSUPPORTED",
        "This Agent cannot sign out from the official account.",
        { status: 409 },
      );
    }
    const installation = await provider.resolveInstallation({
      environment: process.env,
    });
    return provider.startLogout(installation, {
      environment: process.env,
    });
  });
  return Object.freeze({
    ...registry,
    agentCatalog: catalog,
    async publicCatalog({ environment = process.env } = {}) {
      const projected = [];
      for (const item of registry.catalog()) {
        let installSource = "none";
        try {
          const { provider } = registry.resolveSelection({
            providerId: item.providerId,
            runtimeId: item.runtimeId,
            requestedModelId: null,
            resolvedModelId: null,
            reasoning: Object.freeze({
              requested: null,
              applied: null,
              resolution: "provider-default",
            }),
          });
          const installation = await provider.resolveInstallation({ environment });
          if (installation?.installSource === "user" || installation?.installSource === "managed") {
            installSource = installation.installSource;
          }
        } catch {
          installSource = "none";
        }
        projected.push(catalog.publicProvider(item, { installSource }));
      }
      return Object.freeze(projected);
    },
  });
}

export const providerRegistry = createDefaultProviderRegistry();

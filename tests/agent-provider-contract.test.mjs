import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  AgentBridgeService,
  TRUSTED_LOCAL_AGENT_POLICY_VERSION,
} from "../bridge/agent-bridge-service.mjs";
import { createProviderRegistry } from "../bridge/agent/providers/provider-registry.mjs";
import { createRuntimeRegistry } from "../bridge/agent/runtimes/runtime-registry.mjs";
import {
  classifyQoderRunFailure,
  normalizeQoderRuntimeError,
  normalizedQoderPreflightError,
} from "../bridge/agent/providers/qoder-provider.mjs";
import { createCodexAcpProvider } from "../bridge/agent/providers/codex-acp-provider.mjs";
import { acpDriverProfile } from "../bridge/agent/runtimes/acp-protocol.mjs";
import {
  AGENT_POLICY_BRAND,
  loadExecutionPolicy,
} from "../bridge/agent/policies/execution-policy.mjs";
import { createSyntheticQoderProviderFixture } from "./fixtures/agent-provider/qoder-provider.mjs";

const IDENTITY = Object.freeze({
  projectId: `project_${"a".repeat(16)}`,
  documentId: `doc_${"b".repeat(16)}`,
  requestId: "req_provider_contract_001",
  attemptId: "attempt_provider_contract_001",
  sourcePath: "/synthetic/project/page.html",
});

function fixtureRegistry(options) {
  const fixture = createSyntheticQoderProviderFixture(options);
  return {
    fixture,
    registry: createProviderRegistry({
      providers: [fixture.provider],
      runtimeRegistry: createRuntimeRegistry([fixture.runtime]),
    }),
  };
}

function providerSelection() {
  return Object.freeze({
    providerId: "qoder",
    runtimeId: "acp",
    requestedModelId: null,
    resolvedModelId: null,
    reasoning: Object.freeze({
      requested: null,
      applied: null,
      resolution: "provider-default",
    }),
  });
}

test("shared policy and host expose one provider-neutral contract", async () => {
  assert.equal(typeof AGENT_POLICY_BRAND, "symbol");

  await assert.rejects(
    loadExecutionPolicy({ unsupported: true }),
    (error) => error?.name === "AgentPolicyError"
      && error?.code === "AGENT_POLICY_OPTIONS_INVALID"
      && error?.message.includes("Agent execution policy options"),
  );
  assert.throws(() => acpDriverProfile(Object.freeze({
    [AGENT_POLICY_BRAND]: true,
    mode: "discussion",
  })), { code: "ACP_POLICY_MODE_UNSUPPORTED" });
});

test("shared host and policy sources contain no provider or transport ownership literals", async () => {
  const sources = await Promise.all([
    "../bridge/agent/policies/execution-policy.mjs",
    "../bridge/agent/hosts/execution-host.mjs",
  ].map((relativePath) => readFile(new URL(relativePath, import.meta.url), "utf8")));
  const forbidden = /qoder|codex|acp|app-server/iu;
  for (const source of sources) assert.doesNotMatch(source, forbidden);
});

test("qoder selection dispatch resolves once to the qoder provider and ACP runtime", async () => {
  const { fixture, registry } = fixtureRegistry();
  const prepared = await registry.preflightForSelection(providerSelection(), "execution", {
    environment: {},
  });

  assert.equal("driver" in prepared, false);
  assert.equal(prepared.providerId, "qoder");
  assert.equal(prepared.runtimeId, "acp");
  assert.equal(prepared.securityProfile, "client-mediated");
  assert.match(prepared.installationDigest, /^sha256:[a-f0-9]{64}$/u);
  assert.deepEqual(prepared.capabilities, fixture.capabilities);
  assert.deepEqual(prepared.evidence.models, [
    { id: "Synthetic-Model", displayName: "Synthetic-Model" },
  ]);

  const ticket = Object.freeze({
    ...prepared,
    preflightId: "preflight_fixture",
    createdAt: 1,
    expiresAt: 2,
  });
  await registry.verifyTicket(ticket);
  await registry.run(ticket, {
    policy: Object.freeze({ requestRoot: "/synthetic/request" }),
    prompt: "Synthetic prompt",
    baseEnvironment: {},
    onEvent: () => {},
  });
  assert.deepEqual(fixture.calls, [
    "provider:resolve-installation",
    "provider:preflight",
    "provider:verify-installation",
    "provider:verify-installation",
    "provider:create-launch",
    "runtime:run",
  ]);
});

test("selection-first dispatch supports a provider without a leftover driver field", async () => {
  const { fixture, registry } = fixtureRegistry();
  const selection = providerSelection();

  assert.equal("discussion" in fixture.capabilities, false);

  assert.deepEqual(await registry.availabilityForSelection(selection, { environment: {} }), {
    status: "ready",
  });
  const prepared = await registry.preflightForSelection(selection, "execution", {
    environment: {},
  });
  assert.equal("driver" in prepared, false);
  assert.deepEqual(prepared.selection, selection);
  assert.equal("legacyDrivers" in fixture.provider, false);

  const ticket = Object.freeze({
    ...prepared,
    purpose: "execution",
    preflightId: "preflight_selection_first",
  });
  await registry.verifyTicket(ticket, { purpose: "execution" });
  await registry.run(ticket, {
    policy: {},
    prompt: "selection-first execution",
    onEvent: () => {},
  });
  assert.ok(fixture.calls.includes("runtime:run"));
});

test("diagnosis invokes the provider's real read-only probe without preflight or a ticket", async () => {
  const { fixture, registry } = fixtureRegistry();
  const result = await registry.diagnoseForSelection(providerSelection(), {
    environment: {},
    checkedAt: "2026-09-03T00:00:00.000Z",
  });
  assert.equal(result.status, "ready");
  assert.equal(result.diagnostic.readiness, "ready");
  assert.equal(result.diagnostic.activeInstallation, null);
  assert.deepEqual(fixture.calls, [
    "provider:resolve-installation",
    "provider:diagnose",
  ]);
  assert.equal("preflightId" in result, false);
});

test("providers cannot advertise a removed Discussion capability", () => {
  assert.throws(
    () => createSyntheticQoderProviderFixture({
      capabilities: { discussion: true },
    }),
    /capability "discussion" is unsupported/u,
  );
});

test("provider capability is enforced at preflight, ticket verification, and start", async () => {
  const { registry } = fixtureRegistry({
    capabilities: { execution: false },
  });
  const selection = providerSelection();
  await assert.rejects(
    registry.preflightForSelection(selection, "execution", { environment: {} }),
    { code: "AGENT_CAPABILITY_UNSUPPORTED" },
  );
  const invalidPurpose = Object.freeze({
    providerId: "qoder",
    runtimeId: "acp",
    securityProfile: "client-mediated",
    installationDigest: `sha256:${"a".repeat(64)}`,
    capabilities: registry.catalog()[0].capabilities,
    purpose: "discussion",
    preflightId: "preflight_capability_fence",
  });
  await assert.rejects(
    registry.verifyTicket(invalidPurpose, { purpose: "discussion" }),
    { code: "AGENT_PROVIDER_TICKET_INVALID" },
  );
});

test("a provider without an explicit selector accepts only its provider default", async () => {
  const { registry } = fixtureRegistry();
  const selectedModel = {
    ...providerSelection(),
    requestedModelId: "qoder:synthetic-model",
    resolvedModelId: "qoder:synthetic-model",
  };
  await assert.rejects(
    registry.preflightForSelection(selectedModel, "execution", { environment: {} }),
    { code: "AGENT_SELECTION_UNSUPPORTED" },
  );
});

test("unknown provider and runtime fail closed", async () => {
  const { fixture, registry } = fixtureRegistry();
  assert.throws(
    () => createRuntimeRegistry([fixture.runtime]).resolve("unknown-runtime"),
    (error) => error?.code === "AGENT_RUNTIME_UNSUPPORTED",
  );
  assert.throws(
    () => registry.resolveTicket({
      providerId: "unknown-provider",
      runtimeId: "acp",
      securityProfile: "client-mediated",
      installationDigest: `sha256:${"a".repeat(64)}`,
      capabilities: fixture.capabilities,
    }),
    (error) => error?.code === "AGENT_PROVIDER_UNSUPPORTED",
  );
});

test("security profiles are frozen across provider, ticket, and runtime launch", async () => {
  const mismatched = createSyntheticQoderProviderFixture({
    securityProfile: "client-mediated",
    launchSecurityProfile: "agent-native",
  });
  const registry = createProviderRegistry({
    providers: [mismatched.provider],
    runtimeRegistry: createRuntimeRegistry([mismatched.runtime]),
  });
  const prepared = await registry.preflightForSelection(providerSelection(), "execution", {
    environment: {},
  });
  assert.equal(Object.isFrozen(prepared), true);
  assert.equal(prepared.securityProfile, "client-mediated");
  await assert.rejects(
    registry.run(Object.freeze({
      ...prepared,
      preflightId: "preflight_security_mismatch",
    }), {
      policy: {},
      prompt: "test",
      onEvent: () => {},
    }),
    (error) => ["AGENT_SECURITY_PROFILE_MISMATCH", "AGENT_SECURITY_PROFILE_INVALID"]
      .includes(error?.code),
  );

  const reserved = createSyntheticQoderProviderFixture({ securityProfile: "agent-native" });
  assert.equal(reserved.provider.securityProfile, "agent-native");
  assert.equal(Object.isFrozen(reserved.provider), true);
  assert.throws(
    () => createSyntheticQoderProviderFixture({ securityProfile: "unknown-profile" }),
    (error) => error?.code === "AGENT_SECURITY_PROFILE_INVALID",
  );
});

test("provider boundary normalizes ACP raw failures before coordinator ownership", async () => {
  const mappings = {
    ACP_CANCELLED: "AGENT_CANCELLED",
    ACP_TIMEOUT: "AGENT_TURN_TIMEOUT",
    ACP_TURN_TIMEOUT: "AGENT_TURN_TIMEOUT",
    ACP_OUTPUT_PREEXISTS: "AGENT_OUTPUT_PREEXISTS",
    ACP_COMPLETION_PREEXISTS: "AGENT_COMPLETION_PREEXISTS",
    ACP_PROCESS_CLEANUP_UNCONFIRMED: "AGENT_PROCESS_CLEANUP_UNCONFIRMED",
  };
  for (const [raw, canonical] of Object.entries(mappings)) {
    const cause = Object.assign(new Error("private runtime detail"), { code: raw });
    assert.equal(normalizeQoderRuntimeError(cause).code, canonical);
  }
  const coordinatorSource = await readFile(
    new URL("../bridge/agent/agent-runtime-coordinator.mjs", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(coordinatorSource, /\bACP_/u);
});

test("Bridge keeps preflight internals private while public execution sessions identify their provider", async (t) => {
  const { fixture, registry } = fixtureRegistry();
  let requestConfiguration = null;
  const service = new AgentBridgeService({
    providerRegistry: registry,
    resolveTask: async () => ({
      run: {
        ...IDENTITY,
        status: "processing",
        requestPath: "/synthetic/project/.stemmio/requests/req_provider_contract_001",
        promptPath: "/synthetic/request/PROMPT.md",
        outputPath: "/synthetic/request/output/candidate.html",
        completionPath: "/synthetic/request/completion.json",
      },
      request: {
        request: {
          agentDelivery: {
            mode: "managed-agent",
            selection: providerSelection(),
            configuration: requestConfiguration,
            trustPolicyVersion: TRUSTED_LOCAL_AGENT_POLICY_VERSION,
          },
        },
      },
    }),
    leaseStore: {
      acquire: async ({ ownerToken }) => ({ path: "synthetic-lease", ownerToken }),
      release: async () => true,
    },
  });
  t.after(() => service.dispose());

  assert.deepEqual(await service.availability({ selection: providerSelection() }), {
    ok: true,
    status: "ready",
  });
  const mismatchedTicket = await service.preflight({
    selection: providerSelection(),
    trustPolicyAccepted: TRUSTED_LOCAL_AGENT_POLICY_VERSION,
  });
  assert.match(mismatchedTicket.selectionFingerprint, /^sha256:[a-f0-9]{64}$/u);
  await assert.rejects(
    service.submit({
      ...IDENTITY,
      selection: {
        providerId: "qoder",
        runtimeId: "acp",
        requestedModelId: "qoder:Synthetic-Model",
        resolvedModelId: "qoder:Synthetic-Model",
        reasoning: { requested: "high", applied: "high", resolution: "exact" },
      },
      trustPolicyAccepted: TRUSTED_LOCAL_AGENT_POLICY_VERSION,
      preflightId: mismatchedTicket.preflightId,
      configurationDigest: mismatchedTicket.configuration.configurationDigest,
    }),
    (error) => error?.code === "AGENT_PROVIDER_TICKET_INVALID",
  );

  const ready = await service.preflight({
    selection: providerSelection(),
    trustPolicyAccepted: TRUSTED_LOCAL_AGENT_POLICY_VERSION,
  });
  assert.equal("driver" in ready, false);
  assert.equal(ready.agentVersion, "1.1.27");
  assert.equal(ready.modelCount, 1);
  for (const internal of ["providerId", "runtimeId", "installation", "installationDigest", "capabilities"]) {
    assert.equal(internal in ready, false, `${internal} must stay Bridge-internal`);
  }
  requestConfiguration = ready.configuration;

  const started = await service.submit({
    ...IDENTITY,
    selection: providerSelection(),
    trustPolicyAccepted: TRUSTED_LOCAL_AGENT_POLICY_VERSION,
    preflightId: ready.preflightId,
    configurationDigest: ready.configuration.configurationDigest,
  });
  assert.equal(started.accepted, true);
  assert.equal("driver" in started.session, false);
  assert.equal(started.session.providerId, "qoder");
  assert.equal(started.session.runtimeId, "acp");
  for (const internal of ["installation", "installationDigest", "capabilities"]) {
    assert.equal(internal in started.session, false, `${internal} must stay out of session status`);
  }
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(service.status(IDENTITY).state, "completed");
  assert.ok(fixture.calls.includes("runtime:run"));
});

test("Qoder visible output cannot be mistaken for a capacity failure", () => {
  assert.equal(
    normalizedQoderPreflightError(Object.assign(new Error("private install detail"), {
      code: "ENOENT",
    })).code,
    "QODER_COMMAND_UNTRUSTED",
  );
  assert.equal(
    classifyQoderRunFailure({ qoderStderr: "Please sign in before continuing" }),
    "QODER_AUTH_REQUIRED",
  );
  assert.equal(
    classifyQoderRunFailure({ qoderStderr: "Credit usage limit. Upgrade your subscription plan." }),
    "QODER_ACP_RUN_FAILED",
  );
  assert.equal(
    classifyQoderRunFailure({ code: "QODER_ACCOUNT_CAPACITY_UNAVAILABLE" }),
    "QODER_ACCOUNT_CAPACITY_UNAVAILABLE",
  );
});

test("Codex visible output cannot be mistaken for a quota or model-availability error", () => {
  const provider = createCodexAcpProvider();
  assert.equal(provider.classifyRunFailure({
    message: "capacity quota model unavailable",
    agentStderr: "ordinary assistant text",
  }), "CODEX_ACP_RUN_FAILED");
  assert.equal(provider.classifyRunFailure({
    code: "CODEX_ACCOUNT_CAPACITY_UNAVAILABLE",
  }), "CODEX_ACCOUNT_CAPACITY_UNAVAILABLE");
});

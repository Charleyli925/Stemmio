import test from "node:test";
import assert from "node:assert/strict";

import {
  agentRecoveryKindForError,
  defaultManagedAgentDelivery,
  normalizeAgentDelivery,
  normalizeNewAgentDelivery,
} from "../shared/agent-delivery.mjs";

test("structured Agent errors map technical retry safety to truthful recovery", () => {
  for (const [code, recoveryKind] of [
    ["AGENT_AUTH_REQUIRED", "reauthenticate"],
    ["AGENT_BALANCE_INSUFFICIENT", "change-provider"],
    ["AGENT_PLAN_LIMIT", "change-provider"],
    ["AGENT_ENDPOINT_REGION_MISMATCH", "change-provider"],
    ["CODEX_ACCOUNT_CAPACITY_UNAVAILABLE", "change-provider"],
    ["AGENT_MODEL_ACCESS_DENIED", "change-model"],
    ["AGENT_OUTPUT_TRUNCATED", "change-model"],
    ["AGENT_INPUT_RESOURCE_LIMIT", "end"],
    ["AGENT_RATE_LIMITED", "wait"],
    ["AGENT_NETWORK_INTERRUPTED", "retry"],
    ["AGENT_PROVIDER_OVERLOADED", "retry"],
    ["AGENT_TURN_TIMEOUT", "retry"],
    ["AGENT_INSTALLATION_UNTRUSTED", "repair-installation"],
    ["AGENT_RESTART_RECOVERY_REQUIRED", "end"],
  ]) {
    assert.equal(agentRecoveryKindForError(code, { safeToRetry: code !== "AGENT_RESTART_RECOVERY_REQUIRED" }), recoveryKind);
  }
  assert.equal(agentRecoveryKindForError("UNKNOWN", { safeToRetry: true }), "retry");
  assert.equal(agentRecoveryKindForError("UNKNOWN", { safeToRetry: false }), "end");
  assert.equal(agentRecoveryKindForError("AGENT_BALANCE_INSUFFICIENT", { safeToRetry: false }), "end");
});

test("legacy qoder-acp delivery is rejected without conversion", () => {
  assert.throws(() => normalizeAgentDelivery({
    mode: "qoder-acp",
    trustPolicyVersion: "trusted-local-agent-v1",
  }), { code: "AGENT_DELIVERY_INVALID" });
});

test("canonical writer shape and clipboard delivery remain exact", () => {
  assert.deepEqual(defaultManagedAgentDelivery(), {
    mode: "managed-agent",
    selection: {
      providerId: "qoder",
      runtimeId: "acp",
      requestedModelId: null,
      resolvedModelId: null,
      reasoning: {
        requested: null,
        applied: null,
        resolution: "provider-default",
      },
    },
    trustPolicyVersion: "trusted-local-agent-v1",
  });
  assert.deepEqual(normalizeAgentDelivery({ mode: "clipboard" }), { mode: "clipboard" });
});

test("malformed policy, reasoning and cross-provider model ids fail closed", () => {
  const base = structuredClone(defaultManagedAgentDelivery());
  assert.throws(
    () => normalizeAgentDelivery({ ...base, trustPolicyVersion: "future-policy" }),
    { code: "AGENT_DELIVERY_INVALID" },
  );
  assert.throws(
    () => normalizeAgentDelivery({
      ...base,
      selection: {
        ...base.selection,
        requestedModelId: "other:model-a",
      },
    }),
    { code: "AGENT_DELIVERY_INVALID" },
  );
  for (const reasoning of [
    { requested: "high", applied: null, resolution: "exact" },
    { requested: null, applied: null, resolution: "unsupported" },
    { requested: "high", applied: "low", resolution: "provider-default" },
  ]) {
    assert.throws(
      () => normalizeAgentDelivery({
        ...base,
        selection: { ...base.selection, reasoning },
      }),
      { code: "AGENT_DELIVERY_INVALID" },
    );
  }
});

test("unknown provider history is readable but cannot resolve to a shipped start binding", () => {
  const delivery = normalizeAgentDelivery({
    mode: "managed-agent",
    selection: {
      providerId: "future-agent",
      runtimeId: "future-runtime",
      requestedModelId: "future-agent:model-a",
      resolvedModelId: "future-agent:model-a",
      reasoning: { requested: "high", applied: "high", resolution: "exact" },
    },
    trustPolicyVersion: "trusted-local-agent-v1",
  });
  assert.equal(delivery.selection.providerId, "future-agent");
  assert.throws(() => normalizeNewAgentDelivery(delivery), {
    code: "AGENT_PROVIDER_UNSUPPORTED",
  });
});

test("new writers reject the removed legacy delivery format", () => {
  const legacy = {
    mode: "qoder-acp",
    trustPolicyVersion: "trusted-local-agent-v1",
  };
  assert.throws(() => normalizeAgentDelivery(legacy), {
    code: "AGENT_DELIVERY_INVALID",
  });
  assert.throws(() => normalizeNewAgentDelivery(legacy), {
    code: "AGENT_DELIVERY_INVALID",
  });
});

test("shipped Codex ACP and 源页 HTTP deliveries can be newly frozen", () => {
  const reasoning = {
    requested: null,
    applied: null,
    resolution: "provider-default",
  };
  for (const selection of [
    {
      providerId: "codex",
      runtimeId: "acp",
      requestedModelId: null,
      resolvedModelId: null,
      reasoning,
    },
    {
      providerId: "stemmio",
      runtimeId: "http",
      requestedModelId: "stemmio:deepseek-v4-pro",
      resolvedModelId: "stemmio:deepseek-v4-pro",
      reasoning,
    },
  ]) {
    const delivery = {
      mode: "managed-agent",
      selection,
      trustPolicyVersion: "trusted-local-agent-v1",
      configuration: {
        schemaVersion: "1.0.0",
        providerId: selection.providerId,
        runtimeId: selection.runtimeId,
        vendorId: selection.providerId === "stemmio" ? "deepseek" : null,
        baseUrlOrigin: selection.providerId === "stemmio" ? "https://api.deepseek.com" : null,
        modelId: selection.resolvedModelId,
        reasoning: "auto",
        capabilityRevision: "2026-09-03.1",
        credentialGeneration: selection.providerId === "stemmio" ? 1 : 0,
        configurationDigest: `sha256:${"a".repeat(64)}`,
      },
    };
    assert.deepEqual(normalizeNewAgentDelivery(delivery).selection.providerId, selection.providerId);
  }
});

test("configuration reasoning must match the frozen selection", () => {
  const delivery = {
    mode: "managed-agent",
    selection: {
      providerId: "stemmio",
      runtimeId: "http",
      requestedModelId: "stemmio:model-a",
      resolvedModelId: "stemmio:model-a",
      reasoning: { requested: "high", applied: "high", resolution: "exact" },
    },
    trustPolicyVersion: "trusted-local-agent-v1",
    configuration: {
      schemaVersion: "1.0.0",
      providerId: "stemmio",
      runtimeId: "http",
      vendorId: "custom",
      baseUrlOrigin: "https://api.example.com",
      modelId: "stemmio:model-a",
      reasoning: "auto",
      capabilityRevision: "1",
      credentialGeneration: 1,
      configurationDigest: `sha256:${"b".repeat(64)}`,
    },
  };
  assert.throws(() => normalizeNewAgentDelivery(delivery), {
    code: "AGENT_DELIVERY_INVALID",
  });
});

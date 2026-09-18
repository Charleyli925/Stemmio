import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readUiPreferences, recordUiWorkspacePreferences } from "../desktop/ui-preferences.mjs";

import {
  AgentCatalogState,
  CODEX_AGENT_PROVIDER,
  STEMMIO_AGENT_PROVIDER,
  QODER_AGENT_PROVIDER,
  agentProviderCardsFromCatalog,
  defaultAgentProviders,
} from "../app/application/agent-provider-catalog.js";
import {
  agentPreflightKey,
  agentDiagnosticSnapshot,
  agentSetupRecovery,
  agentSetupOperationLabel,
  freezeAgentSelection,
} from "../app/domain/agent-provider-state.js";

const TRUST = "trusted-local-agent-v1";

test("Codex recovery distinguishes local authentication from protocol and network failures", () => {
  const availability = { status: "unavailable", reason: "service-unavailable" };
  for (const [cause, actionLabel, allowLogin] of [
    ["CODEX_AUTH_UNVERIFIED", "检测登录", true],
    ["CODEX_AUTH_REQUIRED", "检测登录", true],
    ["CODEX_PREFLIGHT_FAILED", "重新检查", undefined],
    ["CODEX_EXECUTION_CONTRACT_UNSUPPORTED", "使用其他 AI", undefined],
    ["CODEX_PROTOCOL_UNSUPPORTED", "更新连接组件", undefined],
    ["CODEX_CONNECTION_FAILED", "重新检查", undefined],
    ["AGENT_PREFLIGHT_TIMEOUT", "重新检查", undefined],
  ]) {
    const diagnostic = agentDiagnosticSnapshot({ readiness: "connection-failed", cause,
      facts: { authentication: "ready", protocol: "failed" } });
    const next = agentSetupRecovery(diagnostic, availability);
    assert.equal(next.actionLabel, actionLabel, cause);
    assert.equal(next.allowLogin, allowLogin, cause);
    if (next.action === "install") assert.match(next.detail, /账号已登录/u);
    assert.equal(agentSetupRecovery(diagnostic, { status: "auth-required" }), null);
    assert.equal(agentSetupRecovery(diagnostic, { status: "ready" }), null);
  }
  assert.equal(agentSetupRecovery(agentDiagnosticSnapshot({ readiness: "connection-failed", cause: "QODER_PREFLIGHT_FAILED" }), availability).action, "recheck");
  assert.equal(agentSetupOperationLabel(null, "installing"), "正在安装…");
  assert.equal(agentSetupOperationLabel({ kind: "login", state: "waiting" }), "请在浏览器完成登录");
  assert.equal(agentSetupOperationLabel({ kind: "login", state: "cancelling" }), "正在取消…");
});

test("credential persistence stays a public projection and never stores the raw Key", () => {
  const catalog = new AgentCatalogState({ bridgeClient: { async preflightAgent() {} } });
  catalog.publishCredentialPersist("stemmio", {
    status: "saved",
    operationKind: "persist",
    operationId: "credential_projection_1",
    recordId: "record_projection_1",
    apiKey: "synthetic-key-must-not-project",
  });
  assert.deepEqual(catalog.credentialPersist("stemmio"), {
    status: "saved",
    operationKind: "persist",
    reason: null,
    operationId: "credential_projection_1",
    recordId: "record_projection_1",
    code: null,
  });
  assert.doesNotMatch(JSON.stringify(catalog.getSnapshot()), /synthetic-key/u);
  catalog.dispose();
});

test("non-default DeepSeek configuration survives restart and is frozen into the next actual send", async (t) => {
  const userDataPath = await mkdtemp(path.join(os.tmpdir(), "stemmio-provider-preferences-"));
  t.after(() => rm(userDataPath, { recursive: true, force: true }));
  const preferencesPort = {
    get: () => readUiPreferences({ userDataPath }),
    record: ({ workspace }) => recordUiWorkspacePreferences({ userDataPath, workspace }),
  };
  await preferencesPort.record({ workspace: { defaultAgentProviderId: "codex" } });
  const sent = [];
  const options = {
    configurationPreferencesPort: {
      async getAgentConfigurations() {
        return (await preferencesPort.get()).workspace.agentConfigurations || {};
      },
      async saveAgentConfigurations(agentConfigurations) {
        await preferencesPort.record({ workspace: { agentConfigurations } });
        return true;
      },
    },
    selected: CODEX_AGENT_PROVIDER.selection,
    bridgeClient: {
      async preflightAgent(body) {
        sent.push(body.selection);
        return { status: "ready", preflightId: "configuration-ticket", selection: body.selection,
          expiresAt: new Date(Date.now() + 60_000).toISOString() };
      },
    },
  };
  const first = new AgentCatalogState(options);
  const deepseek = first.freezeProviderSelection("stemmio");
  first.selectReasoning("high", deepseek);
  await first.saveConfiguration();
  assert.equal(first.freezeSelected().providerId, "codex");
  assert.equal((await preferencesPort.get()).workspace.defaultAgentProviderId, "codex");
  first.dispose();
  const reopened = new AgentCatalogState(options);
  await reopened.saveConfiguration();
  const card = agentProviderCardsFromCatalog(reopened.getSnapshot()).find((item) => item.selection.providerId === "stemmio");
  assert.equal(card.selection.reasoning.requested, "high");
  assert.equal(reopened.freezeSelected().providerId, "codex");
  reopened.select(card.selection);
  const ticket = await reopened.spendTicket(reopened.freezeSelected(), { purpose: "execution" });
  assert.equal(ticket.selection.reasoning.requested, "high");
  assert.equal(sent.at(-1).reasoning.requested, "high");
  reopened.dispose();
});

test("configuration persistence false is not reported as a successful save", async () => {
  const catalog = new AgentCatalogState({
    bridgeClient: { async preflightAgent() {} },
    configurationPreferencesPort: {
      async getAgentConfigurations() { return {}; },
      async saveAgentConfigurations() { return false; },
    },
  });
  await assert.rejects(
    catalog.saveConfiguration(),
    (error) => error?.code === "AGENT_PREFERENCES_SAVE_FAILED",
  );
  catalog.dispose();
});

test("a connected API Key remains ready when configuration persistence fails", async () => {
  let connects = 0;
  const catalog = new AgentCatalogState({
    bridgeClient: {
      async preflightAgent() { throw new Error("not used"); },
      async updateAgentConfiguration(request) {
        connects += 1;
        return { status: "ready", selection: request.selection, models: [] };
      },
    },
    configurationPreferencesPort: {
      async getAgentConfigurations() { return {}; },
      async saveAgentConfigurations() { return false; },
    },
  });
  const stemmio = catalog.freezeProviderSelection("stemmio");
  const result = await catalog.connectWithApiKey(stemmio, "synthetic-key", { vendorId: "deepseek" });
  assert.equal(result.configurationPersist.status, "failed");
  assert.equal(result.configurationPersist.code, "AGENT_PREFERENCES_SAVE_FAILED");
  assert.equal(catalog.availability(stemmio).status, "ready");
  assert.equal(connects, 1);
  catalog.dispose();
});

test("the shared Agent chooser exposes 源页 Agent plus both ACP providers without unverified built-ins", () => {
  assert.deepEqual(
    defaultAgentProviders().map(({ providerId }) => providerId),
    ["stemmio", "qoder", "codex"],
  );
  assert.equal(STEMMIO_AGENT_PROVIDER.runtimeId, "http");
  assert.equal(STEMMIO_AGENT_PROVIDER.securityProfile, "client-mediated");
  assert.equal(STEMMIO_AGENT_PROVIDER.installable, false);
  assert.equal(STEMMIO_AGENT_PROVIDER.presentation.credentialKind, "api-token");
  assert.equal(STEMMIO_AGENT_PROVIDER.presentation.logoSrc, "./brand-logo.png");
  assert.equal(STEMMIO_AGENT_PROVIDER.presentation.supportsReasoning, true);
  assert.equal(STEMMIO_AGENT_PROVIDER.presentation.reasoningChoices, undefined);
  assert.notEqual(QODER_AGENT_PROVIDER.presentation.supportsReasoning, true);
  assert.notEqual(CODEX_AGENT_PROVIDER.presentation.supportsReasoning, true);
  assert.deepEqual(
    STEMMIO_AGENT_PROVIDER.presentation.vendors.map(({ id }) => id),
    ["deepseek", "custom"],
  );
  assert.equal(
    CODEX_AGENT_PROVIDER.presentation.localReadDisclosure,
    "Codex 修改时可能读取这台 Mac 上的本机文件。",
  );
  assert.equal(QODER_AGENT_PROVIDER.installable, true);
  assert.equal(CODEX_AGENT_PROVIDER.presentation.settingsSupported, true);
  assert.notEqual(CODEX_AGENT_PROVIDER.presentation.supportsApiKey, true);
  assert.equal(CODEX_AGENT_PROVIDER.runtimeId, "acp");
  assert.equal(CODEX_AGENT_PROVIDER.securityProfile, "client-mediated");
  assert.equal(
    agentProviderCardsFromCatalog({
      providers: {
        qoder: {
          ...QODER_AGENT_PROVIDER,
          availability: { status: "unavailable", reason: "account-capacity" },
        },
      },
    })[0].presentation.availability({ status: "unavailable", reason: "account-capacity" }).statusLabel,
    "连接失败",
  );
  assert.equal(STEMMIO_AGENT_PROVIDER.failureReason("AGENT_BALANCE_INSUFFICIENT"), "account-capacity");
  assert.equal(STEMMIO_AGENT_PROVIDER.failureReason("AGENT_MODEL_ACCESS_DENIED"), "model-unavailable");
  assert.equal(
    STEMMIO_AGENT_PROVIDER.failureReason("AGENT_ENDPOINT_REGION_MISMATCH"),
    "endpoint-region-mismatch",
  );
  assert.equal(
    agentProviderCardsFromCatalog({
      providers: {
        stemmio: {
          ...STEMMIO_AGENT_PROVIDER,
          availability: { status: "unavailable", reason: "endpoint-region-mismatch" },
        },
      },
    })[0].presentation.availability({
      status: "unavailable",
      reason: "endpoint-region-mismatch",
    }).statusLabel,
    "连接失败",
  );
});

test("Settings cards include every installable provider without provider-id branches", () => {
  const cards = agentProviderCardsFromCatalog({
    providers: {
      qoder: {
        ...QODER_AGENT_PROVIDER,
        availability: { status: "ready" },
      },
      blocked: {
        providerId: "blocked",
        installable: false,
        selection: selection("blocked"),
        presentation: { displayName: "Blocked" },
        availability: { status: "unavailable" },
      },
      codex: {
        ...CODEX_AGENT_PROVIDER,
        availability: { status: "not-installed" },
      },
    },
  });
  assert.deepEqual(cards.map((card) => card.selection.providerId), ["qoder", "codex"]);
  assert.equal(cards[1].presentation.actions.install.label, "安装 Codex");
});

test("provider cards use the resolved current selection only for the selected provider", () => {
  const qoderRequested = selection("qoder", { modelId: "requested" });
  const qoderResolved = freezeAgentSelection({
    ...qoderRequested,
    resolvedModelId: "qoder:resolved",
  });
  const qoder = {
    ...provider("qoder", qoderRequested),
    installable: true,
    availability: { status: "ready" },
  };
  const codex = {
    ...provider("codex"),
    presentation: CODEX_AGENT_PROVIDER.presentation,
    installable: true,
    availability: { status: "not-installed" },
  };
  const cards = agentProviderCardsFromCatalog({
    selected: qoderResolved,
    providers: { qoder, codex },
  });

  assert.deepEqual(cards.map((card) => card.selection), [qoderResolved, codex.selection]);
  assert.equal(cards[1].presentation.brandIcon, "openai");
});

function selection(providerId, {
  modelId = null,
  reasoning = null,
  installationDigest = null,
} = {}) {
  return freezeAgentSelection({
    providerId,
    runtimeId: "synthetic-runtime",
    requestedModelId: modelId && `${providerId}:${modelId}`,
    resolvedModelId: modelId && `${providerId}:${modelId}`,
    reasoning: reasoning
      ? { requested: reasoning, applied: reasoning, resolution: "exact" }
      : { requested: null, applied: null, resolution: "provider-default" },
    ...(installationDigest ? { installationDigest } : {}),
  });
}

function provider(providerId, selected = selection(providerId)) {
  return Object.freeze({
    providerId,
    runtimeId: selected.runtimeId,
    securityProfile: "client-mediated",
    trustPolicyVersion: TRUST,
    selection: selected,
    presentation: Object.freeze({ displayName: providerId }),
    failureReason: () => "service-unavailable",
  });
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test("two providers keep separate in-flight preflights and one-use tickets", async () => {
  const starts = [];
  const bridgeClient = {
    preflightAgent(body) {
      const pending = deferred();
      starts.push({ body, pending });
      return pending.promise;
    },
  };
  const first = selection("first");
  const second = selection("second");
  const catalog = new AgentCatalogState({
    bridgeClient,
    providers: [provider("first", first), provider("second", second)],
    selected: first,
    clock: { now: () => 10 },
  });

  const firstPromise = catalog.preflight(first, { purpose: "execution" });
  catalog.select(second);
  const secondPromise = catalog.preflight(second, { purpose: "execution" });
  assert.notEqual(firstPromise, secondPromise);
  assert.equal(starts.length, 2);

  starts[1].pending.resolve({
    status: "ready",
    preflightId: "ticket_second",
    selection: second,
    expiresAt: new Date(20_000).toISOString(),
  });
  assert.equal((await secondPromise).preflightId, "ticket_second");
  starts[0].pending.reject(Object.assign(new Error("first failed"), { code: "FAIL" }));
  await assert.rejects(firstPromise, /first failed/u);
  assert.equal(catalog.availability(first).status, "unavailable");
  assert.equal(catalog.availability(second).status, "ready");

  const spent = await catalog.spendTicket(second, { purpose: "execution" });
  assert.equal(spent.preflightId, "ticket_second");
  assert.deepEqual(catalog.getSnapshot().preflightBySelection, {});
});

test("switching away and back starts a fresh Provider preflight", async () => {
  const starts = [];
  const bridgeClient = {
    preflightAgent(body) {
      const pending = deferred();
      starts.push({ body, pending });
      return pending.promise;
    },
  };
  const first = selection("first");
  const second = selection("second");
  const catalog = new AgentCatalogState({
    bridgeClient,
    providers: [provider("first", first), provider("second", second)],
    selected: first,
    clock: { now: () => 10 },
  });

  const staleFirst = catalog.preflight(first, { purpose: "execution" });
  catalog.select(second);
  const secondCheck = catalog.preflight(second, { purpose: "execution" });
  catalog.select(first);
  const currentFirst = catalog.preflight(first, { purpose: "execution" });
  assert.equal(starts.length, 3);
  assert.notEqual(currentFirst, staleFirst);

  const staleResolvedFirst = freezeAgentSelection({
    ...first,
    resolvedModelId: "first:stale-default",
  });
  const currentResolvedFirst = freezeAgentSelection({
    ...first,
    resolvedModelId: "first:current-default",
  });

  starts[0].pending.resolve({
    status: "ready",
    preflightId: "ticket_stale_first",
    selection: staleResolvedFirst,
    expiresAt: new Date(20_000).toISOString(),
  });
  await staleFirst;
  assert.equal(catalog.availability(first).status, "checking");
  assert.equal(catalog.freezeSelected().resolvedModelId, null);
  assert.equal(
    Object.values(catalog.getSnapshot().preflightBySelection)
      .some((preflight) => preflight.preflightId === "ticket_stale_first"),
    false,
  );

  starts[2].pending.resolve({
    status: "ready",
    preflightId: "ticket_current_first",
    selection: currentResolvedFirst,
    expiresAt: new Date(20_000).toISOString(),
  });
  assert.equal((await currentFirst).preflightId, "ticket_current_first");
  assert.equal(catalog.freezeSelected().resolvedModelId, "first:current-default");
  assert.equal(catalog.availability(first).status, "ready");

  starts[1].pending.resolve({
    status: "ready",
    preflightId: "ticket_stale_second",
    selection: second,
    expiresAt: new Date(20_000).toISOString(),
  });
  await secondCheck;
  assert.equal(catalog.availability(first).status, "ready");
});

test("model, reasoning, installation, trust and purpose are all preflight key authority", () => {
  const base = selection("first");
  const variants = [
    selection("first", { modelId: "model-a" }),
    selection("first", { reasoning: "high" }),
  ];
  const baseKey = agentPreflightKey(base, {
    installationDigest: "sha256:one",
    trustPolicyVersion: TRUST,
    purpose: "execution",
  });
  for (const variant of variants) {
    assert.notEqual(agentPreflightKey(variant, {
      installationDigest: "sha256:one",
      trustPolicyVersion: TRUST,
      purpose: "execution",
    }), baseKey);
  }
  assert.notEqual(agentPreflightKey(base, {
    installationDigest: "sha256:two",
    trustPolicyVersion: TRUST,
    purpose: "execution",
  }), baseKey);
  assert.notEqual(agentPreflightKey(base, {
    installationDigest: "sha256:one",
    trustPolicyVersion: "trusted-local-agent-v2",
    purpose: "execution",
  }), baseKey);
});

test("same provider model and purpose share only their exact in-flight promise", async () => {
  const pending = deferred();
  let calls = 0;
  const first = selection("first", { modelId: "model-a", reasoning: "high" });
  const catalog = new AgentCatalogState({
    bridgeClient: {
      preflightAgent() {
        calls += 1;
        return pending.promise;
      },
    },
    providers: [provider("first", first)],
    selected: first,
    clock: { now: () => 10 },
  });
  const left = catalog.preflight(first, { purpose: "execution" });
  const right = catalog.preflight(first, { purpose: "execution" });
  assert.equal(left, right);
  assert.equal(calls, 1);
  pending.resolve({
    status: "ready",
    preflightId: "ticket_execution",
    selection: first,
    expiresAt: new Date(20_000).toISOString(),
  });
  await left;

  const execution = catalog.preflight(first, { purpose: "execution", force: true });
  assert.notEqual(execution, left);
  assert.equal(calls, 2);
});

test("concurrent consumers cannot spend the same preflight ticket twice", async () => {
  const pending = deferred();
  const first = selection("first");
  const catalog = new AgentCatalogState({
    bridgeClient: { preflightAgent: () => pending.promise },
    providers: [provider("first", first)],
    selected: first,
    clock: { now: () => 10 },
  });
  const left = catalog.spendTicket(first, { purpose: "execution" });
  const right = catalog.spendTicket(first, { purpose: "execution" });
  pending.resolve({
    status: "ready",
    preflightId: "ticket_single_use",
    selection: first,
    expiresAt: new Date(20_000).toISOString(),
  });
  const results = await Promise.allSettled([left, right]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  const rejected = results.find((result) => result.status === "rejected");
  assert.equal(rejected?.reason?.code, "AGENT_PREFLIGHT_TICKET_SPENT");
});

test("late availability and mismatched preflight results cannot replace newer authority", async () => {
  const oldAvailability = deferred();
  const newAvailability = deferred();
  const availabilityCalls = [oldAvailability, newAvailability];
  const first = selection("first");
  const catalog = new AgentCatalogState({
    bridgeClient: {
      preflightAgent: async () => ({
        status: "ready",
        preflightId: "ticket_wrong",
        selection: selection("first", { modelId: "wrong" }),
        expiresAt: new Date(20_000).toISOString(),
      }),
      qoderAvailability() {
        return availabilityCalls.shift().promise;
      },
    },
    providers: [provider("first", first)],
    selected: first,
    clock: { now: () => 10 },
  });
  const oldRefresh = catalog.refreshAvailability(first);
  const newRefresh = catalog.refreshAvailability(first);
  newAvailability.resolve({ status: "not-installed" });
  await newRefresh;
  oldAvailability.resolve({ status: "ready" });
  assert.equal(await oldRefresh, null);
  assert.equal(catalog.availability(first).status, "not-installed");
  const mismatch = catalog.preflight(first);
  await assert.rejects(mismatch, (error) => error?.code === "AGENT_PREFLIGHT_SELECTION_MISMATCH");
});

test("descriptor runtime and security profile stay part of dispatch authority", async () => {
  assert.equal(QODER_AGENT_PROVIDER.securityProfile, "client-mediated");
  const first = selection("first");
  const catalog = new AgentCatalogState({
    bridgeClient: {
      async preflightAgent() {
        return {
          status: "ready",
          preflightId: "ticket_wrong_security",
          selection: first,
          securityProfile: "agent-native",
          expiresAt: new Date(20_000).toISOString(),
        };
      },
    },
    providers: [provider("first", first)],
    selected: first,
    clock: { now: () => 10 },
  });
  assert.throws(
    () => catalog.select({ ...first, runtimeId: "other-runtime" }),
    (error) => error?.code === "AGENT_RUNTIME_UNSUPPORTED",
  );
  await assert.rejects(
    catalog.preflight(first),
    (error) => error?.code === "AGENT_SECURITY_PROFILE_MISMATCH",
  );
});

test("a provider-resolved default model becomes the selected durable execution authority", async () => {
  const requested = freezeAgentSelection({
    providerId: "codex",
    runtimeId: "acp",
    requestedModelId: null,
    resolvedModelId: null,
    reasoning: { requested: null, applied: null, resolution: "provider-default" },
  });
  const resolved = freezeAgentSelection({
    ...requested,
    resolvedModelId: "codex:gpt-synthetic",
  });
  const codex = Object.freeze({
    ...provider("codex", requested),
    runtimeId: "acp",
    securityProfile: "client-mediated",
    selection: requested,
  });
  const catalog = new AgentCatalogState({
    bridgeClient: {
      async preflightAgent() {
        return {
          status: "ready",
          preflightId: "ticket_codex_default",
          selection: resolved,
          securityProfile: "client-mediated",
          expiresAt: new Date(20_000).toISOString(),
        };
      },
    },
    providers: [codex],
    selected: requested,
    clock: { now: () => 10 },
  });
  const preflight = await catalog.preflight(requested);
  assert.deepEqual(preflight.selection, resolved);
  assert.deepEqual(catalog.freezeSelected(), resolved);
});

test("a resolved default model stays pinned during later preflight", async () => {
  const pinned = freezeAgentSelection({
    providerId: "codex",
    runtimeId: "acp",
    requestedModelId: null,
    resolvedModelId: "codex:model-a",
    reasoning: { requested: null, applied: null, resolution: "provider-default" },
  });
  const changed = freezeAgentSelection({
    ...pinned,
    resolvedModelId: "codex:model-b",
  });
  const codex = Object.freeze({
    ...provider("codex", pinned),
    runtimeId: "acp",
    securityProfile: "client-mediated",
    selection: pinned,
  });
  const catalog = new AgentCatalogState({
    bridgeClient: {
      async preflightAgent() {
        return {
          status: "ready",
          preflightId: "ticket_changed_default",
          selection: changed,
          securityProfile: "client-mediated",
          expiresAt: new Date(20_000).toISOString(),
        };
      },
    },
    providers: [codex],
    selected: pinned,
    clock: { now: () => 10 },
  });

  await assert.rejects(
    catalog.preflight(pinned),
    (error) => error?.code === "AGENT_PREFLIGHT_SELECTION_MISMATCH",
  );
  assert.deepEqual(catalog.freezeSelected(), pinned);
});

test("one-click install is gated to installable providers and then refreshes availability", async () => {
  const qoder = freezeAgentSelection(QODER_AGENT_PROVIDER.selection);
  const blocked = Object.freeze({
    ...provider("blocked"),
    installable: false,
  });
  const calls = [];
  const catalog = new AgentCatalogState({
    bridgeClient: {
      async preflightAgent() {
        return {
          status: "ready",
          preflightId: "ticket_after_install",
          selection: qoder,
          expiresAt: new Date(20_000).toISOString(),
        };
      },
      async installAgent(body) {
        calls.push(body);
        return { ok: true, providerId: "qoder", installSource: "managed" };
      },
      async agentAvailability() {
        return { status: "ready" };
      },
      async agentProviders() {
        return {
          providers: [{
            providerId: "qoder",
            installable: true,
            installSource: "managed",
            installState: "idle",
          }],
        };
      },
    },
    providers: [QODER_AGENT_PROVIDER, blocked, CODEX_AGENT_PROVIDER],
    selected: qoder,
    clock: { now: () => 10 },
  });
  await assert.rejects(
    catalog.install(blocked.selection),
    (error) => error?.code === "AGENT_INSTALL_UNSUPPORTED",
  );
  const refreshed = await catalog.install(qoder);
  assert.deepEqual(calls, [{ providerId: "qoder" }]);
  assert.equal(refreshed.result.status, "ready");
  assert.equal(refreshed.availability.status, "checking");
  assert.equal(catalog.provider(qoder).installSource, "managed");
  assert.equal(catalog.provider(qoder).installState, "idle");
});

test("post-install availability rechecks the provider's resolved selected authority", async () => {
  const requested = freezeAgentSelection({
    ...QODER_AGENT_PROVIDER.selection,
    resolvedModelId: null,
  });
  const resolved = freezeAgentSelection({
    ...requested,
    resolvedModelId: "qoder:qoder-default",
  });
  const availabilitySelections = [];
  const catalog = new AgentCatalogState({
    bridgeClient: {
      async preflightAgent() {
        return {
          status: "ready",
          preflightId: "ticket_resolved_before_install",
          selection: resolved,
          expiresAt: new Date(20_000).toISOString(),
        };
      },
      async installAgent() {
        return { ok: true, providerId: "qoder", installSource: "managed" };
      },
      async agentAvailability({ selection: current }) {
        availabilitySelections.push(current);
        return { status: "ready" };
      },
    },
    providers: [QODER_AGENT_PROVIDER],
    selected: requested,
    clock: { now: () => 10 },
  });

  await catalog.preflight(requested);
  await catalog.install(requested);
  assert.equal(availabilitySelections.at(-1).resolvedModelId, "qoder:qoder-default");
  assert.equal(catalog.freezeSelected().resolvedModelId, "qoder:qoder-default");
});

test("diagnosis is side-effect free and does not create a preflight ticket or mutate selection", async () => {
  const selected = freezeAgentSelection(QODER_AGENT_PROVIDER.selection);
  let diagnoseCalls = 0;
  let preflightCalls = 0;
  const catalog = new AgentCatalogState({
    bridgeClient: {
      async preflightAgent() {
        preflightCalls += 1;
        return { status: "ready", preflightId: "unused" };
      },
      async agentDiagnose(request) {
        diagnoseCalls += 1;
        assert.deepEqual(request.selection, selected);
        return {
          status: "ready",
          diagnostic: {
            readiness: "ready",
            cause: null,
            operation: "diagnose",
            checkedAt: "2026-08-11T00:00:00.000Z",
            activeInstallation: null,
          },
        };
      },
    },
    providers: [QODER_AGENT_PROVIDER],
    selected,
    clock: { now: () => Date.parse("2026-08-11T00:00:00.000Z") },
  });

  const before = catalog.freezeSelected();
  const result = await catalog.diagnose();
  assert.equal(diagnoseCalls, 1);
  assert.equal(preflightCalls, 0);
  assert.equal(result.diagnostic.activeInstallation, null);
  assert.equal(result.diagnostic.facts.installation.status, "ready");
  assert.deepEqual(catalog.getSnapshot().preflightBySelection, {});
  assert.deepEqual(catalog.freezeSelected(), before);
  assert.equal(catalog.availability().status, "checking");
  assert.equal(catalog.displayAvailability().status, "ready");
});

test("weak diagnosis cannot clear a stronger use-time service failure", async () => {
  const selected = freezeAgentSelection(STEMMIO_AGENT_PROVIDER.selection);
  const catalog = new AgentCatalogState({
    bridgeClient: {
      async preflightAgent() { return { status: "ready" }; },
      async agentDiagnose() {
        return {
          status: "ready",
          diagnostic: {
            readiness: "ready",
            cause: null,
            facts: {
              installation: "configured",
              authentication: "ready",
              protocol: "ready",
              service: "unknown",
            },
          },
        };
      },
    },
    providers: [STEMMIO_AGENT_PROVIDER],
    selected,
    clock: { now: () => Date.parse("2026-08-11T00:00:00.000Z") },
  });
  catalog.noteRunFailure(selected, "AGENT_BALANCE_INSUFFICIENT");
  await catalog.diagnose(selected);
  assert.equal(catalog.availability(selected).reason, "account-capacity");
  assert.equal(catalog.availability(selected).lastCheck, "use");
  assert.equal(catalog.provider(selected).diagnostic.facts.service.status, "unavailable");
  assert.equal(catalog.provider(selected).diagnostic.facts.service.source, "use");
  assert.equal(catalog.provider(selected).diagnostic.readiness, "connection-failed");
  assert.equal(catalog.displayAvailability(selected).reason, "account-capacity");
});

test("diagnosis is keyed single-flight and stale generations cannot publish", async () => {
  const selected = freezeAgentSelection(QODER_AGENT_PROVIDER.selection);
  let calls = 0;
  let resolveFirst;
  const firstResult = new Promise((resolve) => { resolveFirst = resolve; });
  const catalog = new AgentCatalogState({
    bridgeClient: {
      async preflightAgent() { return { status: "ready" }; },
      async agentDiagnose() {
        calls += 1;
        if (calls === 1) return firstResult;
        return { status: "auth-required", diagnostic: { readiness: "auth-required", cause: "QODER_AUTH_REQUIRED" } };
      },
    },
    providers: [QODER_AGENT_PROVIDER],
    selected,
  });
  const first = catalog.diagnose(selected);
  const shared = catalog.diagnose(selected);
  assert.equal(first, shared);
  await Promise.resolve();
  assert.equal(calls, 1);
  catalog.select({
    ...selected,
    requestedModelId: "qoder:next",
    resolvedModelId: "qoder:next",
  });
  const current = catalog.diagnose(catalog.freezeSelected());
  await Promise.resolve();
  assert.equal(calls, 2);
  resolveFirst({ status: "ready", diagnostic: { readiness: "ready", cause: null } });
  assert.equal(await first, null);
  await current;
  assert.equal(catalog.provider().diagnostic.readiness, "auth-required");
  catalog.dispose();
});

test("install cancellation projects cancelling state and uses the existing Bridge route", async () => {
  const selected = freezeAgentSelection(QODER_AGENT_PROVIDER.selection);
  const states = [];
  let cancelled;
  const catalog = new AgentCatalogState({
    bridgeClient: {
      async preflightAgent() { return { status: "ready" }; },
      async cancelAgentInstall(body) {
        cancelled = body;
        states.push(catalog.provider(selected).installState);
        return { ok: true, providerId: "qoder", installState: "idle" };
      },
      async agentDiagnose() {
        return {
          status: "not-installed",
          diagnostic: {
            readiness: "not-installed",
            cause: "not-installed",
            operation: "diagnose",
            checkedAt: "2026-08-11T00:00:00.000Z",
            activeInstallation: null,
          },
        };
      },
    },
    providers: [QODER_AGENT_PROVIDER],
    selected,
    clock: { now: () => Date.parse("2026-08-11T00:00:00.000Z") },
  });
  catalog.provider(selected);
  await catalog.cancelInstall();
  assert.deepEqual(cancelled, { providerId: "qoder" });
  assert.deepEqual(states, ["cancelling"]);
  assert.equal(catalog.provider(selected).installState, "idle");
});

test("cancelAccessOperation still posts install cancel while a managed install is pending", async () => {
  const selected = freezeAgentSelection(QODER_AGENT_PROVIDER.selection);
  let releaseInstall;
  let cancelBody;
  const catalog = new AgentCatalogState({
    bridgeClient: {
      async preflightAgent() { return { status: "ready" }; },
      async installAgent() {
        await new Promise((resolve) => {
          releaseInstall = resolve;
        });
        const error = new Error("安装已取消。");
        error.code = "AGENT_INSTALL_CANCELLED";
        throw error;
      },
      async cancelAgentInstall(body) {
        cancelBody = body;
        releaseInstall?.();
        return { ok: true, providerId: "qoder", installState: "idle" };
      },
      async agentDiagnose() {
        return {
          status: "not-installed",
          diagnostic: {
            readiness: "not-installed",
            cause: "not-installed",
            operation: "diagnose",
            checkedAt: "2026-08-11T00:00:00.000Z",
            activeInstallation: null,
          },
        };
      },
    },
    providers: [QODER_AGENT_PROVIDER],
    selected,
    clock: { now: () => Date.parse("2026-08-11T00:00:00.000Z") },
  });
  const pending = catalog.install(selected);
  await Promise.resolve();
  assert.equal(catalog.provider(selected).installState, "installing");
  assert.equal(catalog.provider(selected).activeOperation?.kind, "install");
  const cancelled = await catalog.cancelAccessOperation(selected);
  assert.deepEqual(cancelBody, { providerId: "qoder" });
  assert.equal(cancelled.installState, "idle");
  await pending;
  assert.equal(catalog.provider(selected).installState, "idle");
});

test("selectModel changes only the selected model identity", () => {
  const catalog = new AgentCatalogState({
    bridgeClient: {
      async preflightAgent() {
        return { status: "ready" };
      },
    },
    providers: [QODER_AGENT_PROVIDER],
    selected: QODER_AGENT_PROVIDER.selection,
  });
  const next = catalog.selectModel("qoder:Stemmio-E2E");
  assert.equal(next.providerId, "qoder");
  assert.equal(next.runtimeId, "acp");
  assert.equal(next.requestedModelId, "qoder:Stemmio-E2E");
  assert.equal(catalog.freezeSelected().requestedModelId, "qoder:Stemmio-E2E");
});

test("selectReasoning changes only Stemmio thinking depth", () => {
  const catalog = new AgentCatalogState({
    bridgeClient: {
      async preflightAgent() {
        return { status: "ready" };
      },
    },
    providers: [STEMMIO_AGENT_PROVIDER],
    selected: STEMMIO_AGENT_PROVIDER.selection,
  });
  const next = catalog.selectReasoning("low");
  assert.equal(next.providerId, "stemmio");
  assert.equal(next.runtimeId, "http");
  assert.deepEqual(next.reasoning, {
    requested: "low",
    applied: "low",
    resolution: "exact",
  });
  assert.equal(catalog.selectReasoning("not-a-depth").reasoning.resolution, "exact");
  assert.equal(catalog.freezeSelected().reasoning.requested, "low");
});

test("configuration targets its provider even after a default switch, and rejects stale per-provider writes", () => {
  const catalog = new AgentCatalogState({
    bridgeClient: {
      async preflightAgent() {
        return { status: "ready" };
      },
    },
    providers: [QODER_AGENT_PROVIDER, CODEX_AGENT_PROVIDER],
    selected: QODER_AGENT_PROVIDER.selection,
  });
  const expectedQoder = catalog.freezeSelected();
  const selectedCodex = catalog.select(CODEX_AGENT_PROVIDER.selection);

  assert.equal(catalog.selectModel("qoder:late-model", expectedQoder).requestedModelId, "qoder:late-model");
  assert.equal(catalog.selectReasoning("high", expectedQoder), null);
  assert.deepEqual(catalog.freezeSelected(), selectedCodex);
  assert.equal(catalog.selectModel("qoder:cross-provider", selectedCodex), null);
  assert.deepEqual(catalog.freezeSelected(), selectedCodex);
});

test("Token replacement publishes atomically, clears old model state, and can disconnect", async () => {
  const requests = [];
  let failNext = false;
  const initial = STEMMIO_AGENT_PROVIDER.selection;
  const catalog = new AgentCatalogState({
    bridgeClient: {
      async preflightAgent() { throw new Error("not used"); },
      async setAgentSessionCredential(request) {
        requests.push(request);
        if (request.disconnect === true) return { ok: true, configured: false };
        if (failNext) throw Object.assign(new Error("Token 无效"), { code: "AGENT_AUTH_REQUIRED" });
        return {
          ok: true,
          status: "ready",
          vendorId: request.vendorId,
          vendorDisplayName: request.vendorId === "openai" ? "OpenAI" : "DeepSeek",
          baseUrl: request.vendorId === "openai"
            ? "https://api.openai.com/v1"
            : "https://api.deepseek.com/v1",
          installationDigest: `sha256:${"a".repeat(64)}`,
          selection: {
            ...initial,
            resolvedModelId: request.vendorId === "openai"
              ? "stemmio:gpt-5"
              : "stemmio:deepseek-v4-pro",
          },
          models: [{
            id: request.vendorId === "openai" ? "stemmio:gpt-5" : "stemmio:deepseek-v4-pro",
            isDefault: true,
            reasoningChoices: [{ id: "auto", label: "自动" }],
          }],
        };
      },
    },
    providers: [STEMMIO_AGENT_PROVIDER],
    selected: initial,
    clock: { now: () => 10 },
  });

  await catalog.connectWithApiKey(initial, "sk-old", { vendorId: "deepseek" });
  assert.equal(catalog.freezeSelected().resolvedModelId, "stemmio:deepseek-v4-pro");
  assert.equal(catalog.provider().connection.vendorDisplayName, "DeepSeek");
  assert.equal(catalog.provider().diagnostic.readiness, "ready");
  assert.equal(catalog.provider().diagnostic.facts.service.source, "preflight");
  assert.equal(catalog.provider().lastOperation?.kind, "config-validate");
  assert.equal(catalog.provider().lastOperation?.state, "succeeded");
  failNext = true;
  await assert.rejects(
    catalog.connectWithApiKey(catalog.freezeSelected(), "sk-bad", { vendorId: "openai" }),
    (error) => error?.code === "AGENT_AUTH_REQUIRED",
  );
  assert.equal(catalog.freezeSelected().resolvedModelId, "stemmio:deepseek-v4-pro");
  assert.equal(catalog.provider().connection.vendorDisplayName, "DeepSeek");
  failNext = false;
  await catalog.connectWithApiKey(catalog.freezeSelected(), "sk-new", { vendorId: "openai" });
  assert.equal(catalog.freezeSelected().resolvedModelId, "stemmio:gpt-5");
  assert.deepEqual(catalog.provider().models.map((model) => model.id), ["stemmio:gpt-5"]);
  await catalog.disconnectApiKey(catalog.freezeSelected());
  assert.equal(catalog.availability().status, "auth-required");
  assert.equal(catalog.provider().diagnostic.readiness, "auth-required");
  assert.equal(catalog.provider().credentialConfigured, false);
  assert.deepEqual(catalog.provider().models, []);
  assert.equal(catalog.freezeSelected().resolvedModelId, null);
  assert.equal(requests.at(-1).disconnect, true);
});

test("a sidebar pending default is adopted only after that service is ready", async () => {
  const stemmio = STEMMIO_AGENT_PROVIDER.selection;
  const qoder = QODER_AGENT_PROVIDER.selection;
  const catalog = new AgentCatalogState({
    bridgeClient: {
      async setAgentSessionCredential() {
        return {
          ok: true,
          status: "ready",
          vendorId: "deepseek",
          vendorDisplayName: "DeepSeek",
          baseUrl: "https://api.deepseek.com/v1",
          installationDigest: `sha256:${"a".repeat(64)}`,
          selection: {
            ...stemmio,
            resolvedModelId: "stemmio:deepseek-v4-pro",
          },
          models: [{
            id: "stemmio:deepseek-v4-pro",
            isDefault: true,
            reasoningChoices: [{ id: "auto", label: "自动" }],
          }],
        };
      },
      async preflightAgent() {
        return { status: "ready", preflightId: "unused" };
      },
    },
    providers: [QODER_AGENT_PROVIDER, STEMMIO_AGENT_PROVIDER],
    selected: qoder,
    clock: { now: () => 10 },
  });

  catalog.queuePendingDefault(stemmio);
  assert.equal(catalog.freezeSelected().providerId, "qoder");
  assert.equal(catalog.displaySelection()?.providerId, "stemmio");
  assert.notEqual(catalog.displayAvailability().status, "ready");
  assert.equal(catalog.presentation().displayName, STEMMIO_AGENT_PROVIDER.presentation.displayName);
  assert.equal(catalog.readyPendingDefault(), null);
  await catalog.connectWithApiKey(stemmio, "sk-secret", { vendorId: "deepseek" });
  assert.equal(catalog.freezeSelected().providerId, "qoder");
  assert.equal(catalog.readyPendingDefault()?.providerId, "stemmio");
  assert.equal(
    catalog.peekPendingDefaultIntent()?.validatedSelection?.resolvedModelId,
    "stemmio:deepseek-v4-pro",
  );
  catalog.select(catalog.readyPendingDefault());
  catalog.clearPendingDefault();
  assert.equal(catalog.freezeSelected().providerId, "stemmio");
  assert.equal(catalog.pendingDefault(), null);
});

test("updating installation digest or models does not clear connection or credential flags", async () => {
  const initial = STEMMIO_AGENT_PROVIDER.selection;
  const catalog = new AgentCatalogState({
    bridgeClient: {
      async setAgentSessionCredential(request) {
        return {
          ok: true,
          status: "ready",
          vendorId: request.vendorId,
          vendorDisplayName: "DeepSeek",
          baseUrl: "https://api.deepseek.com/v1",
          installationDigest: `sha256:${"a".repeat(64)}`,
          selection: {
            ...initial,
            resolvedModelId: "stemmio:deepseek-v4-pro",
          },
          models: [{
            id: "stemmio:deepseek-v4-pro",
            isDefault: true,
            reasoningChoices: [{ id: "auto", label: "自动" }],
          }],
        };
      },
      async preflightAgent() {
        return {
          status: "ready",
          preflightId: "ticket_digest",
          selection: {
            ...initial,
            resolvedModelId: "stemmio:deepseek-v4-pro",
          },
          expiresAt: new Date(20_000).toISOString(),
          installationDigest: `sha256:${"b".repeat(64)}`,
          models: [{
            id: "stemmio:deepseek-v4-flash",
            isDefault: true,
            reasoningChoices: [{ id: "auto", label: "自动" }],
          }],
        };
      },
    },
    providers: [STEMMIO_AGENT_PROVIDER],
    selected: initial,
    clock: { now: () => 10 },
  });

  await catalog.connectWithApiKey(initial, "sk-keep", { vendorId: "deepseek" });
  assert.equal(catalog.provider().credentialConfigured, true);
  assert.equal(catalog.provider().connection.vendorDisplayName, "DeepSeek");
  assert.equal(catalog.provider().installable, false);
  const previousConnection = catalog.provider().connection;
  await catalog.preflight(catalog.freezeSelected(), { purpose: "execution" });
  assert.equal(catalog.provider().credentialConfigured, true);
  assert.equal(catalog.provider().connection, previousConnection);
  assert.equal(catalog.provider().connection.vendorDisplayName, "DeepSeek");
  assert.equal(catalog.provider().installable, false);
  assert.equal(catalog.provider().installationDigest, `sha256:${"b".repeat(64)}`);
  assert.deepEqual(catalog.provider().models.map((model) => model.id), ["stemmio:deepseek-v4-flash"]);
});

test("disabled providers stay disconnected after a ready diagnose and cannot preflight", async () => {
  const selected = freezeAgentSelection(QODER_AGENT_PROVIDER.selection);
  const catalog = new AgentCatalogState({
    bridgeClient: {
      async agentDiagnose() {
        return {
          status: "ready",
          diagnostic: {
            readiness: "ready",
            cause: null,
            operation: "diagnose",
          },
        };
      },
      async preflightAgent() {
        return { status: "ready", preflightId: "unused" };
      },
    },
    providers: [QODER_AGENT_PROVIDER],
    selected,
    clock: { now: () => Date.parse("2026-09-06T00:00:00.000Z") },
  });
  catalog.applyDisabledProviderIds(["qoder"]);
  assert.equal(catalog.provider(selected).enabled, false);
  await catalog.diagnose(selected);
  assert.equal(catalog.provider(selected).enabled, false);
  assert.equal(catalog.displayAvailability(selected).reason, "disabled");
  await assert.rejects(
    () => catalog.preflight(selected),
    (error) => error?.code === "AGENT_PROVIDER_DISABLED",
  );
  catalog.applyDisabledProviderIds([]);
  assert.equal(catalog.provider(selected).enabled, true);
});

test("startLogin records a waiting access operation that cancel finishes", async () => {
  const selected = freezeAgentSelection(QODER_AGENT_PROVIDER.selection);
  const catalog = new AgentCatalogState({
    bridgeClient: {
      async preflightAgent() { return { status: "ready" }; },
      async loginAgent() {
        return {
          ok: true,
          loginState: "waiting",
          generation: 1,
          activeOperation: {
            operationId: "access_qoder_login_1",
            providerId: "qoder",
            kind: "login",
            state: "waiting",
            generation: 1,
            startedAt: "2026-09-06T00:00:00.000Z",
            errorCode: null,
            cancellable: true,
          },
        };
      },
      async cancelAgentLogin() {
        return {
          ok: true,
          loginState: "cancelled",
          generation: 1,
          activeOperation: {
            operationId: "access_qoder_login_1",
            providerId: "qoder",
            kind: "login",
            state: "cancelled",
            generation: 1,
            startedAt: null,
            errorCode: "AGENT_LOGIN_CANCELLED",
            cancellable: false,
          },
        };
      },
      async agentDiagnose() {
        return { status: "auth-required", diagnostic: { readiness: "auth-required" } };
      },
    },
    providers: [QODER_AGENT_PROVIDER],
    selected,
    clock: { now: () => Date.parse("2026-09-06T00:00:00.000Z") },
  });
  const pending = catalog.startLogin(selected);
  await new Promise((resolve) => setTimeout(resolve, 0));
  const waiting = catalog.provider(selected).activeOperation;
  assert.equal(waiting.kind, "login");
  assert.equal(waiting.state, "waiting");
  assert.equal(waiting.generation, 1);
  const cancelled = await catalog.cancelAccessOperation(selected);
  assert.equal(cancelled.state, "cancelled");
  assert.equal(cancelled.cancellable, false);
  await assert.rejects(pending, /AGENT_LOGIN_CANCELLED|登录已取消/u);
  const again = await catalog.cancelAccessOperation(selected);
  assert.equal(again.state, "cancelled");
});

test("public catalog idle install does not clear a waiting login operation", async () => {
  const selected = freezeAgentSelection(QODER_AGENT_PROVIDER.selection);
  const catalog = new AgentCatalogState({
    bridgeClient: {
      async preflightAgent() { return { status: "ready" }; },
      async loginAgent() {
        return {
          ok: true,
          loginState: "waiting",
          generation: 3,
          activeOperation: {
            operationId: "access_qoder_login_3",
            providerId: "qoder",
            kind: "login",
            state: "waiting",
            generation: 3,
            startedAt: "2026-09-06T00:00:00.000Z",
            errorCode: null,
            cancellable: true,
          },
        };
      },
      async cancelAgentLogin() {
        return { ok: true, loginState: "cancelled", generation: 3 };
      },
      async agentDiagnose() {
        return { status: "auth-required", diagnostic: { readiness: "auth-required" } };
      },
      async agentProviders() {
        return {
          providers: [{
            providerId: "qoder",
            installable: true,
            installSource: "managed",
            installState: "idle",
            activeOperation: null,
          }],
        };
      },
    },
    providers: [QODER_AGENT_PROVIDER],
    selected,
    clock: { now: () => Date.parse("2026-09-06T00:00:00.000Z") },
  });
  const pending = catalog.startLogin(selected);
  await new Promise((resolve) => setTimeout(resolve, 0));
  await catalog.diagnose(selected);
  assert.equal(catalog.provider(selected).activeOperation?.kind, "login");
  assert.equal(catalog.provider(selected).activeOperation?.state, "waiting");
  assert.equal(catalog.provider(selected).activeOperation?.generation, 3);
  await catalog.cancelAccessOperation(selected);
  await pending.catch(() => null);
});

test("startLogin waits on the backend operation identity after a local diagnose generation", async () => {
  const selected = freezeAgentSelection(QODER_AGENT_PROVIDER.selection);
  const catalog = new AgentCatalogState({
    bridgeClient: {
      async preflightAgent() { return { status: "ready" }; },
      async loginAgent() {
        return {
          ok: true,
          loginState: "waiting",
          generation: 7,
          activeOperation: {
            operationId: "access_qoder_login_7",
            providerId: "qoder",
            kind: "login",
            state: "waiting",
            generation: 7,
            startedAt: "2026-09-06T00:00:00.000Z",
            errorCode: null,
            cancellable: true,
          },
        };
      },
      async agentDiagnose() {
        return { status: "ready", diagnostic: { readiness: "ready" } };
      },
      async agentProviders() {
        return {
          providers: [{
            providerId: "qoder",
            installable: true,
            installState: "idle",
            connection: { authSource: "cli-login", authScope: "app-managed" },
            activeOperation: {
              operationId: "access_qoder_login_7",
              providerId: "qoder",
              kind: "login",
              state: "succeeded",
              generation: 7,
              startedAt: "2026-09-06T00:00:00.000Z",
              errorCode: null,
              cancellable: false,
            },
          }],
        };
      },
    },
    providers: [QODER_AGENT_PROVIDER],
    selected,
    clock: { now: () => Date.parse("2026-09-06T00:00:00.000Z") },
  });
  await catalog.diagnose(selected);
  const result = await catalog.startLogin(selected);
  assert.equal(catalog.provider(selected).lastOperation?.operationId, "access_qoder_login_7");
  assert.equal(catalog.provider(selected).lastOperation?.state, "succeeded");
  assert.equal(catalog.availability(selected).status, "ready");
  assert.equal(result?.diagnostic?.readiness, "ready");
});

test("diagnose ready does not finish a waiting login as stale", async () => {
  const selected = freezeAgentSelection(QODER_AGENT_PROVIDER.selection);
  const catalog = new AgentCatalogState({
    bridgeClient: {
      async preflightAgent() { return { status: "ready" }; },
      async loginAgent() {
        return {
          ok: true,
          loginState: "waiting",
          generation: 2,
          activeOperation: {
            operationId: "access_qoder_login_2",
            providerId: "qoder",
            kind: "login",
            state: "waiting",
            generation: 2,
            startedAt: "2026-09-06T00:00:00.000Z",
            errorCode: null,
            cancellable: true,
          },
        };
      },
      async cancelAgentLogin() {
        return { ok: true, loginState: "cancelled", generation: 2 };
      },
      async agentDiagnose() {
        return { status: "ready", diagnostic: { readiness: "ready" } };
      },
    },
    providers: [QODER_AGENT_PROVIDER],
    selected,
    clock: { now: () => Date.parse("2026-09-06T00:00:00.000Z") },
  });
  const pending = catalog.startLogin(selected);
  await new Promise((resolve) => setTimeout(resolve, 0));
  await catalog.diagnose(selected);
  assert.equal(catalog.provider(selected).activeOperation?.state, "waiting");
  assert.notEqual(catalog.availability(selected).status, "ready");
  await catalog.cancelAccessOperation(selected);
  await pending.catch(() => null);
});

test("startLogout refuses environment-token credentials and completes official logout", async () => {
  const selected = freezeAgentSelection(QODER_AGENT_PROVIDER.selection);
  const environmentCatalog = new AgentCatalogState({
    bridgeClient: {
      async preflightAgent() { return { status: "ready" }; },
      async logoutAgent() { return { ok: true }; },
      async agentDiagnose() {
        return { status: "ready", diagnostic: { readiness: "ready" } };
      },
      async agentProviders() {
        return {
          providers: [{
            providerId: "qoder",
            connection: { authSource: "environment-token", authScope: "environment" },
          }],
        };
      },
    },
    providers: [QODER_AGENT_PROVIDER],
    selected,
    clock: { now: () => Date.parse("2026-09-06T00:00:00.000Z") },
  });
  await environmentCatalog.diagnose(selected);
  await assert.rejects(
    () => environmentCatalog.startLogout(selected),
    (error) => error?.code === "AGENT_LOGOUT_UNSUPPORTED",
  );

  const catalog = new AgentCatalogState({
    bridgeClient: {
      async preflightAgent() { return { status: "ready" }; },
      async logoutAgent() { return { ok: true }; },
      async agentDiagnose() {
        return { status: "auth-required", diagnostic: { readiness: "auth-required" } };
      },
    },
    providers: [QODER_AGENT_PROVIDER],
    selected,
    clock: { now: () => Date.parse("2026-09-06T00:00:00.000Z") },
  });
  await catalog.startLogout(selected);
  assert.equal(catalog.provider(selected).lastOperation?.kind, "logout");
  assert.equal(catalog.provider(selected).lastOperation?.state, "succeeded");
});

test("cancelAccessOperation withdraws the matching pending default", async () => {
  const selected = freezeAgentSelection(QODER_AGENT_PROVIDER.selection);
  const catalog = new AgentCatalogState({
    bridgeClient: {
      async preflightAgent() { return { status: "ready" }; },
    },
    providers: [QODER_AGENT_PROVIDER],
    selected,
  });
  catalog.queuePendingDefault(selected);
  assert.equal(catalog.pendingDefault()?.providerId, "qoder");
  await catalog.cancelAccessOperation(selected);
  assert.equal(catalog.pendingDefault(), null);
});

test("credential persist failure survives a catalog refresh", async () => {
  const stemmio = STEMMIO_AGENT_PROVIDER.selection;
  const catalog = new AgentCatalogState({
    bridgeClient: {
      async preflightAgent() { return { status: "ready" }; },
      async agentDiagnose() {
        return { status: "ready", diagnostic: { readiness: "ready" } };
      },
      async agentProviders() {
        return {
          providers: [{
            providerId: "stemmio",
            installable: false,
            installState: "idle",
            connection: null,
            activeOperation: null,
            lastOperation: null,
          }],
        };
      },
    },
    providers: [STEMMIO_AGENT_PROVIDER],
    selected: stemmio,
  });
  catalog.publishCredentialPersist("stemmio", {
    status: "failed",
    reason: "已连接，但新的 API Key 未保存。",
    operationId: "credential_failed_1",
  });
  await catalog.diagnose(stemmio);
  assert.equal(catalog.credentialPersist("stemmio")?.status, "failed");
  assert.match(catalog.credentialPersist("stemmio")?.reason || "", /未保存/u);
});

test("a catalog refresh keeps API-token vendor facts when Bridge has no login connection", async () => {
  const stemmio = STEMMIO_AGENT_PROVIDER.selection;
  const catalog = new AgentCatalogState({
    bridgeClient: {
      async setAgentSessionCredential(request) {
        if (request.disconnect === true) return { ok: true, configured: false };
        return {
          ok: true,
          status: "ready",
          vendorId: "deepseek",
          vendorDisplayName: "DeepSeek",
          baseUrl: "https://api.deepseek.com/v1",
          installationDigest: `sha256:${"a".repeat(64)}`,
          selection: {
            ...stemmio,
            resolvedModelId: "stemmio:deepseek-v4-pro",
          },
          models: [{
            id: "stemmio:deepseek-v4-pro",
            isDefault: true,
            reasoningChoices: [{ id: "auto", label: "自动" }],
          }],
        };
      },
      async preflightAgent() { return { status: "ready" }; },
      async agentDiagnose() {
        return { status: "ready", diagnostic: { readiness: "ready" } };
      },
      async agentProviders() {
        return {
          providers: [{
            providerId: "stemmio",
            installable: false,
            installState: "idle",
            connection: null,
            activeOperation: null,
            lastOperation: null,
          }],
        };
      },
    },
    providers: [STEMMIO_AGENT_PROVIDER],
    selected: stemmio,
    clock: { now: () => 10 },
  });
  await catalog.connectWithApiKey(stemmio, "sk-secret", { vendorId: "deepseek" });
  await catalog.diagnose(stemmio);
  assert.equal(catalog.provider().connection.vendorDisplayName, "DeepSeek");
  assert.equal(catalog.availability().status, "ready");
});

test("an in-flight install does not hide the previous login result", async () => {
  const selected = freezeAgentSelection(QODER_AGENT_PROVIDER.selection);
  let listed = {
    providers: [{
      providerId: "qoder",
      installable: true,
      installState: "idle",
      connection: { authSource: "cli-login", authScope: "app-managed" },
      activeOperation: null,
      lastOperation: {
        operationId: "access_qoder_login_3",
        providerId: "qoder",
        kind: "login",
        state: "succeeded",
        generation: 3,
        startedAt: "2026-09-06T00:00:00.000Z",
        errorCode: null,
        cancellable: false,
      },
    }],
  };
  const catalog = new AgentCatalogState({
    bridgeClient: {
      async preflightAgent() { return { status: "ready" }; },
      async agentDiagnose() {
        return { status: "ready", diagnostic: { readiness: "ready" } };
      },
      async agentProviders() {
        return listed;
      },
    },
    providers: [QODER_AGENT_PROVIDER],
    selected,
    clock: { now: () => Date.parse("2026-09-06T00:00:00.000Z") },
  });
  await catalog.diagnose(selected);
  assert.equal(catalog.provider(selected).lastOperation?.kind, "login");
  listed = {
    providers: [{
      providerId: "qoder",
      installable: true,
      installState: "installing",
      connection: { authSource: "cli-login", authScope: "app-managed" },
      activeOperation: {
        operationId: "access_qoder_install_4",
        providerId: "qoder",
        kind: "install",
        state: "running",
        generation: 4,
        startedAt: "2026-09-06T00:00:01.000Z",
        errorCode: null,
        cancellable: true,
      },
      lastOperation: null,
    }],
  };
  await catalog.diagnose(selected);
  assert.equal(catalog.provider(selected).activeOperation?.kind, "install");
  assert.equal(catalog.provider(selected).lastOperation?.kind, "login");
  assert.equal(catalog.provider(selected).lastOperation?.state, "succeeded");
});


test("a timed-out diagnosis finishes and its late result cannot replace the new receipt", async () => {
  let completeOld;
  let calls = 0;
  const catalog = new AgentCatalogState({ providers: [QODER_AGENT_PROVIDER], diagnoseTimeoutMs: 5,
    bridgeClient: { async preflightAgent() {}, agentDiagnose() {
      calls += 1;
      if (calls === 1) return new Promise((resolve) => { completeOld = resolve; });
      return Promise.resolve({ diagnostic: { readiness: "ready" } });
    } },
  });
  await assert.rejects(catalog.diagnose(), { code: "AGENT_DIAGNOSE_TIMEOUT" });
  const failed = catalog.provider(catalog.freezeSelected()).diagnostic;
  assert.equal(failed.cause, "AGENT_DIAGNOSE_TIMEOUT");
  const current = await catalog.diagnose();
  assert.notEqual(current.diagnostic.operationId, failed.operationId);
  completeOld({ diagnostic: { readiness: "connection-failed" } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(catalog.provider(catalog.freezeSelected()).diagnostic.readiness, "ready");
  catalog.dispose();
});

test("a selection configuration change fences an older diagnosis", async () => {
  let complete;
  const catalog = new AgentCatalogState({ providers: [QODER_AGENT_PROVIDER],
    bridgeClient: { async preflightAgent() {}, agentDiagnose() {
      return new Promise((resolve) => { complete = resolve; });
    } },
  });
  const pending = catalog.diagnose();
  await new Promise((resolve) => setImmediate(resolve));
  catalog.select({ ...catalog.freezeSelected(), requestedModelId: "different" });
  complete({ diagnostic: { readiness: "ready" } });
  assert.equal(await pending, null);
  catalog.dispose();
});


test("Codex leaves automatic browser opening to native login and retains manual reopen", async () => {
  let opened = 0;
  let starts = 0;
  const catalog = new AgentCatalogState({ providers: [CODEX_AGENT_PROVIDER],
    handoffPort: { async openLogin() { opened += 1; return { opened: true }; } },
    bridgeClient: {
      async preflightAgent() {},
      async loginAgent() { starts += 1; return { generation: 1, loginState: "waiting", loginUrlPresent: true }; },
      async cancelAgentLogin() { return { generation: 1, loginState: "cancelled" }; },
      async agentDiagnose() { return { diagnostic: { readiness: "auth-required" } }; },
    },
  });
  const pending = catalog.startLogin();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(opened, 0);
  await catalog.reopenOfficialLogin();
  assert.equal(opened, 1);
  assert.equal(starts, 1);
  await catalog.cancelAccessOperation(catalog.freezeSelected());
  await pending.catch(() => null);
  catalog.dispose();
});

test("Qoder login opens the captured official URL once and retains manual reopen", async () => {
  let opened = 0;
  const catalog = new AgentCatalogState({ providers: [QODER_AGENT_PROVIDER],
    handoffPort: { async openLogin() { opened += 1; return { opened: true }; } },
    bridgeClient: {
      async preflightAgent() {},
      async loginAgent() { return { generation: 1, loginState: "waiting", loginUrlPresent: true }; },
      async cancelAgentLogin() { return { generation: 1, loginState: "cancelled" }; },
      async agentDiagnose() { return { diagnostic: { readiness: "auth-required" } }; },
    },
  });
  const pending = catalog.startLogin();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(opened, 1);
  await catalog.reopenOfficialLogin();
  assert.equal(opened, 2);
  await catalog.cancelAccessOperation(catalog.freezeSelected());
  await pending.catch(() => null);
  catalog.dispose();
});


test("known incompatible Codex components offer a different service without reinstalling or relogging", () => {
  const diagnostic = agentDiagnosticSnapshot({ readiness: "connection-failed", cause: "CODEX_EXECUTION_CONTRACT_UNSUPPORTED",
    facts: { authentication: "ready", protocol: "failed" } });
  const recovery = agentSetupRecovery(diagnostic, { status: "unavailable", reason: "service-unavailable" });
  assert.equal(recovery.action, "change-provider");
  assert.equal(recovery.allowRecheck, true);
  assert.equal(recovery.allowLogin, undefined);
  assert.match(recovery.detail, /账号已登录/u);
});

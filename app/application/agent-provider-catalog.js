import {
  INITIAL_AGENT_PROVIDER_AVAILABILITY,
  agentPreflightKey,
  agentProviderAvailabilityFromFailureReason,
  agentProviderAvailabilityFromLocalResult,
  agentProviderAvailabilityFromDiagnostic,
  agentDiagnosticSnapshot,
  agentProviderAvailabilityWithCopiedGuidance,
  checkingAgentProviderAvailability,
  freezeAgentSelection,
  readyAgentProviderAvailability,
} from "../domain/agent-provider-state.js";
import {
  defaultManagedAgentDelivery,
  TRUSTED_LOCAL_AGENT_POLICY_VERSION,
} from "../../shared/agent-delivery.mjs";
import {
  accessOperationId,
  createAccessOperation,
  finishAccessOperation,
  isBlockingAccessOperation,
  isInFlightAccessOperation,
  pickActiveAccessOperation,
  projectAccessOperations,
  publicAccessOperation,
  requestCancelAccessOperation,
} from "../../shared/agent-access-operation.mjs";
import {
  STEMMIO_PROVIDER_ID,
  STEMMIO_RUNTIME_ID,
  DEFAULT_OPENAI_COMPATIBLE_REASONING,
  normalizeOpenAiCompatibleReasoning,
  publicOpenAiCompatibleVendors,
  publicModelsForVendor,
} from "../../shared/openai-compatible-vendors.mjs";

const QODER_FAILURE_REASONS = Object.freeze({
  QODER_COMMAND_NOT_FOUND: "not-installed",
  AGENT_COMMAND_NOT_FOUND: "not-installed",
  QODER_AUTH_REQUIRED: "auth-required",
  AGENT_AUTH_REQUIRED: "auth-required",
  QODER_ACCOUNT_CAPACITY_UNAVAILABLE: "account-capacity",
  QODER_CAPACITY_UNAVAILABLE: "account-capacity",
  QODER_MODEL_CATALOG_EMPTY: "service-unavailable",
  AGENT_ACCOUNT_CAPACITY_UNAVAILABLE: "account-capacity",
  QODER_PREFLIGHT_TIMEOUT: "timeout",
  AGENT_PREFLIGHT_TIMEOUT: "timeout",
  QODER_COMMAND_CHANGED: "restart-required",
  QODER_VERSION_MISMATCH: "restart-required",
  AGENT_INSTALLATION_CHANGED: "restart-required",
  QODER_COMMAND_UNTRUSTED: "invalid-installation",
  QODER_VERSION_INVALID: "invalid-installation",
  QODER_VERSION_UNSUPPORTED: "invalid-installation",
  AGENT_INSTALLATION_UNTRUSTED: "invalid-installation",
});

const QODER_PRESENTATION = Object.freeze({
  displayName: "Qoder CLI",
  agentName: "Qoder",
  logoSrc: "./qoder-logo.png",
  cardClassName: "qoder-availability-card",
  primaryActionDataAttribute: "data-qoder-primary",
  guidancePurposePrefix: "qoder",
  readyDetail: "已接通，可直接交给 Qoder 修改",
  notInstalledDetail: "安装后即可从侧栏直接发送。",
  authRequiredDetail: "登录后即可从侧栏直接发送。",
  loginLabel: "登录 Qoder",
  invalidInstallationDetail: "当前安装不是 Stemmio 支持的独立 Qoder CLI。",
  restartRequiredDetail: "Qoder CLI 已发生变化，重新打开 Stemmio 后即可继续。",
  checkingDetail: "正在自动检查 Qoder CLI…",
  capacityStatusLabel: "额度已用完",
  capacityDetail: "换源页 Agent 或 Codex，或复制任务给别的 AI。",
  timeoutDetail: "Qoder CLI 预检没有在规定时间内完成。",
  startUnavailable: "当前 Request 还不能启动 Qoder CLI。",
  startBusy: "Qoder CLI 正在启动，请等待当前操作完成。",
  startFailure: "Qoder CLI 没有启动。本轮 Request 已保留，可重试或复制任务。",
  restartLabel: "重新启动 Qoder",
  restartSupported: true,
  settingsSupported: true,
  stopLabel: "停止 Qoder 并继续编辑",
  frozenPreviewDetail: "这是本轮冻结并交给 Qoder CLI 的只读内容",
  installLabel: "安装 Qoder CLI",
  supportsSelectableModels: true,
});

const AGENT_SECURITY_PROFILES = new Set(["client-mediated", "agent-native"]);

function diagnosticFailureUpdate(code, source) {
  const normalized = String(code || "AGENT_PROVIDER_UNAVAILABLE");
  const fact = (status) => ({ status, cause: normalized, source });
  if (["AGENT_AUTH_REQUIRED", "CODEX_AUTH_REQUIRED", "QODER_AUTH_REQUIRED"].includes(normalized)) {
    return Object.freeze({
      readiness: "auth-required",
      facts: { authentication: fact("required") },
    });
  }
  if (["AGENT_COMMAND_NOT_FOUND", "CODEX_COMMAND_NOT_FOUND", "QODER_COMMAND_NOT_FOUND"].includes(normalized)) {
    return Object.freeze({
      readiness: "not-installed",
      facts: { installation: fact("missing") },
    });
  }
  if (/INSTALLATION|COMMAND_CHANGED|COMMAND_UNTRUSTED|VERSION_(?:INVALID|MISMATCH|UNSUPPORTED)/u.test(normalized)) {
    return Object.freeze({
      readiness: "invalid-installation",
      facts: { installation: fact("invalid") },
    });
  }
  if (/PROTOCOL|ACP_AGENT_IDENTITY/u.test(normalized)) {
    return Object.freeze({
      readiness: "connection-failed",
      facts: { protocol: fact("failed") },
    });
  }
  return Object.freeze({
    readiness: "connection-failed",
    facts: { service: fact("unavailable") },
  });
}

function qoderGuidanceInstruction(kind) {
  if (kind === "login") {
    return [
      "请帮我完成这台 Mac 上独立 Qoder CLI 的官方登录流程。",
      "使用 Qoder 官方支持的登录入口 `qodercli login`；如果需要交互式登录，请启动 `qodercli` 后使用 `/login`。",
      "完成浏览器或令牌登录后，验证 `qodercli --list-models` 能返回当前账号可用的模型。",
      "不要修改 Stemmio，也不要修改当前项目。完成后只告诉我登录和可用性验证结果。",
    ].join("\n");
  }
  return [
    "请帮我在这台 Mac 上准备 Stemmio 支持的独立 Qoder CLI。",
    "使用 Qoder 官方 npm 包 `@qoder-ai/qodercli@latest`，不要使用 Qoder 应用包内置的命令。",
    "将它安装到 Finder 或 Dock 启动的应用也能稳定发现的位置；优先使用用户可写的稳定全局目录，或保留当前 nvm、Volta、fnm、mise 配置并确保 qodercli 启动器真实存在。",
    "安装后使用 Qoder 官方登录流程完成登录，并验证 `qodercli --version` 与 `qodercli --list-models` 均可用。",
    "不要修改 Stemmio，也不要修改当前项目。完成后只告诉我安装、版本、登录和可用性验证结果。",
  ].join("\n");
}

export const QODER_AGENT_PROVIDER = Object.freeze({
  providerId: "qoder",
  runtimeId: "acp",
  securityProfile: "client-mediated",
  trustPolicyVersion: TRUSTED_LOCAL_AGENT_POLICY_VERSION,
  installable: true,
  selection: freezeAgentSelection(defaultManagedAgentDelivery().selection),
  presentation: QODER_PRESENTATION,
  failureReason(code) {
    return QODER_FAILURE_REASONS[String(code || "")] || "service-unavailable";
  },
  guidanceInstruction: qoderGuidanceInstruction,
});

const CODEX_FAILURE_REASONS = Object.freeze({
  CODEX_INSTALLATION_MISSING: "not-installed",
  CODEX_COMMAND_NOT_FOUND: "not-installed",
  AGENT_COMMAND_NOT_FOUND: "not-installed",
  CODEX_AUTH_REQUIRED: "auth-required",
  CODEX_ACCOUNT_CAPACITY_UNAVAILABLE: "account-capacity",
  AGENT_ACCOUNT_CAPACITY_UNAVAILABLE: "account-capacity",
  CODEX_APP_SERVER_TIMEOUT: "timeout",
  CODEX_TURN_TIMEOUT: "timeout",
  CODEX_PREFLIGHT_TIMEOUT: "timeout",
  AGENT_PREFLIGHT_TIMEOUT: "timeout",
  CODEX_INSTALLATION_CHANGED: "restart-required",
  CODEX_COMMAND_CHANGED: "restart-required",
  AGENT_INSTALLATION_CHANGED: "restart-required",
  CODEX_VERSION_MISMATCH: "invalid-installation",
  CODEX_INSTALLATION_UNTRUSTED: "invalid-installation",
  CODEX_COMMAND_UNTRUSTED: "invalid-installation",
  CODEX_VERSION_UNSUPPORTED: "invalid-installation",
  AGENT_INSTALLATION_UNTRUSTED: "invalid-installation",
});

const CODEX_PRESENTATION = Object.freeze({
  displayName: "Codex",
  agentName: "Codex",
  logoSrc: null,
  brandIcon: "openai",
  cardClassName: "codex-availability-card",
  primaryActionDataAttribute: "data-codex-primary",
  guidancePurposePrefix: "codex",
  installLabel: "安装 Codex",
  readyDetail: "已接通，可直接交给 Codex 修改",
  notInstalledDetail: "安装后即可从侧栏直接发送。",
  authRequiredDetail: "登录 ChatGPT 后即可从侧栏直接发送。",
  capacityStatusLabel: "额度已用完",
  capacityDetail: "换源页 Agent 或 Qoder，或复制任务给别的 AI。",
  loginLabel: "登录 Codex",
  invalidInstallationDetail: "当前安装不是 Stemmio 支持的独立 Codex ACP。",
  restartRequiredDetail: "Codex ACP 已发生变化，重新打开 Stemmio 后即可继续。",
  checkingDetail: "正在检查 Codex…",
  timeoutDetail: "Codex 预检没有在规定时间内完成。",
  startUnavailable: "当前 Request 还不能启动 Codex。",
  startBusy: "Codex 正在启动，请等待当前操作完成。",
  startFailure: "Codex 没有启动。本轮 Request 已保留，可安全结束后重试。",
  restartLabel: "重新启动 Codex",
  restartSupported: true,
  settingsSupported: true,
  stopLabel: "停止 Codex 并继续编辑",
  frozenPreviewDetail: "这是本轮冻结并交给 Codex 的只读任务资料",
  localReadDisclosure: "Codex 修改时可能读取这台 Mac 上的本机文件。",
});

function codexGuidanceInstruction(kind) {
  if (kind === "login") {
    return [
      "请帮我完成这台 Mac 上独立 Codex CLI 的官方登录流程。",
      "使用 Codex 官方支持的登录入口 `codex login`；登录 ChatGPT 账号后再回到 Stemmio。",
      "完成浏览器登录后，验证 `codex-acp` 能正常启动。",
      "不要修改 Stemmio，也不要修改当前项目。完成后只告诉我登录和可用性验证结果。",
    ].join("\n");
  }
  return [
    "请帮我在这台 Mac 上准备 Stemmio 支持的独立 Codex ACP。",
    "使用官方 npm 包 `@agentclientprotocol/codex-acp`，不要改用 Stemmio 安装包内的 bundled Codex。",
    "安装后使用 `codex login` 完成登录。",
    "不要修改 Stemmio，也不要修改当前项目。完成后只告诉我安装、版本、登录和可用性验证结果。",
  ].join("\n");
}

export const CODEX_AGENT_PROVIDER = Object.freeze({
  providerId: "codex",
  runtimeId: "acp",
  securityProfile: "client-mediated",
  trustPolicyVersion: TRUSTED_LOCAL_AGENT_POLICY_VERSION,
  installable: true,
  selection: freezeAgentSelection(Object.freeze({
    providerId: "codex",
    runtimeId: "acp",
    requestedModelId: null,
    resolvedModelId: null,
    reasoning: Object.freeze({
      requested: null,
      applied: null,
      resolution: "provider-default",
    }),
  })),
  presentation: CODEX_PRESENTATION,
  failureReason(code) {
    return CODEX_FAILURE_REASONS[String(code || "")] || "service-unavailable";
  },
  guidanceInstruction: codexGuidanceInstruction,
});

const STEMMIO_FAILURE_REASONS = Object.freeze({
  AGENT_AUTH_REQUIRED: "auth-required",
  AGENT_ACCOUNT_CAPACITY_UNAVAILABLE: "account-capacity",
  AGENT_BALANCE_INSUFFICIENT: "account-capacity",
  AGENT_PLAN_LIMIT: "account-capacity",
  AGENT_PREFLIGHT_TIMEOUT: "timeout",
  AGENT_TURN_TIMEOUT: "timeout",
  AGENT_MODEL_ID_REQUIRED: "model-unavailable",
  AGENT_MODEL_CATALOG_EMPTY: "model-unavailable",
  AGENT_MODEL_NOT_RELEASED: "model-unavailable",
  AGENT_MODEL_ACCESS_DENIED: "model-unavailable",
  AGENT_SELECTION_UNSUPPORTED: "model-unavailable",
  AGENT_ENDPOINT_REGION_MISMATCH: "endpoint-region-mismatch",
});

const STEMMIO_PRESENTATION = Object.freeze({
  displayName: "源页 Agent",
  agentName: "源页",
  logoSrc: "./brand-logo.png",
  cardClassName: "stemmio-availability-card",
  primaryActionDataAttribute: "data-stemmio-primary",
  readyDetail: "可从侧栏发送",
  authRequiredDetail: "填入 Token 后发送",
  capacityStatusLabel: "额度已用完",
  capacityDetail: "换厂商，或复制任务给别的 AI。",
  checkingDetail: "正在连接…",
  timeoutDetail: "连接超时，请重试。",
  startUnavailable: "当前还不能发送。",
  startBusy: "正在处理，请稍候。",
  startFailure: "没有完成。本轮已保留。",
  restartLabel: "重新发送",
  restartSupported: true,
  settingsSupported: true,
  supportsApiKey: true,
  credentialKind: "api-token",
  supportsReasoning: true,
  vendors: publicOpenAiCompatibleVendors(),
  apiKeyLabel: "连接",
  replaceTokenLabel: "更换 API Key",
  stopLabel: "停止源页 Agent 并继续编辑",
  frozenPreviewDetail: "这是本轮冻结并交给源页 Agent 的只读任务资料",
});

export const STEMMIO_AGENT_PROVIDER = Object.freeze({
  providerId: STEMMIO_PROVIDER_ID,
  runtimeId: STEMMIO_RUNTIME_ID,
  securityProfile: "client-mediated",
  trustPolicyVersion: TRUSTED_LOCAL_AGENT_POLICY_VERSION,
  installable: false,
  selection: freezeAgentSelection(Object.freeze({
    providerId: STEMMIO_PROVIDER_ID,
    runtimeId: STEMMIO_RUNTIME_ID,
    requestedModelId: null,
    resolvedModelId: null,
    reasoning: Object.freeze({
      requested: null,
      applied: null,
      resolution: "provider-default",
    }),
  })),
  presentation: STEMMIO_PRESENTATION,
  failureReason(code) {
    return STEMMIO_FAILURE_REASONS[String(code || "")] || "service-unavailable";
  },
  guidanceInstruction() {
    return "";
  },
});

export function defaultAgentProviders() {
  return Object.freeze([STEMMIO_AGENT_PROVIDER, QODER_AGENT_PROVIDER, CODEX_AGENT_PROVIDER]);
}

export function agentAvailabilityCardPresentation(presentation, availability) {
  const status = availability?.status || "checking";
  const displayName = String(presentation.displayName || presentation.agentName || "Agent");
  if (status === "ready") {
    if (availability?.reason === "configuration-saved") {
      return Object.freeze({
        statusLabel: `${displayName} · 已配置`,
        detail: "发送时验证模型",
        tone: "ready",
      });
    }
    return Object.freeze({
      statusLabel: `${displayName} · 已连接`,
      detail: "",
      tone: "ready",
    });
  }
  if (availability?.reason === "disabled") {
    return Object.freeze({
      statusLabel: `${displayName} · 已断开`,
      detail: "重新连接后才会使用此服务",
      tone: "attention",
    });
  }
  if (status === "not-installed") {
    return Object.freeze({
      statusLabel: `${displayName} · 未安装`,
      detail: "",
      tone: "attention",
    });
  }
  if (status === "auth-required") {
    return Object.freeze({
      statusLabel: presentation.credentialKind === "api-token"
        ? `${displayName} · 未连接`
        : `${displayName} · 未登录`,
      detail: "",
      tone: "attention",
    });
  }
  if (availability?.reason === "invalid-installation" || availability?.reason === "restart-required") {
    return Object.freeze({
      statusLabel: `${displayName} · 需要修复`,
      detail: "",
      tone: "attention",
    });
  }
  if (status === "checking") {
    return Object.freeze({
      statusLabel: `${displayName} · 正在检查…`,
      detail: "",
      tone: "checking",
    });
  }
  if (availability?.reason === "model-unavailable") {
    return Object.freeze({
      statusLabel: "连接失败",
      detail: "",
      tone: "attention",
    });
  }
  return Object.freeze({
    statusLabel: "连接失败",
    detail: "",
    tone: "attention",
  });
}

export function agentProviderCardPresentation(provider) {
  const presentation = provider?.presentation || {};
  return Object.freeze({
    displayName: presentation.displayName,
    logoSrc: presentation.logoSrc || null,
    brandIcon: presentation.brandIcon || null,
    cardClassName: presentation.cardClassName,
    primaryActionDataAttribute: presentation.primaryActionDataAttribute || null,
    availability: (availability) => agentAvailabilityCardPresentation(presentation, availability),
    actions: Object.freeze({
      install: Object.freeze({
        label: presentation.installLabel || `安装 ${presentation.agentName || presentation.displayName}`,
        copiedLabel: "重新安装",
      }),
      login: Object.freeze({
        label: presentation.loginLabel || "登录",
        copiedLabel: "重新登录",
      }),
      recheck: Object.freeze({
        label: "重试",
        copiedLabel: "重试",
      }),
      apiKey: Object.freeze({
        label: presentation.replaceTokenLabel || "更换 API Key",
        copiedLabel: presentation.apiKeyLabel || "连接",
      }),
    }),
    supportsApiKey: presentation.supportsApiKey === true,
    credentialKind: presentation.credentialKind || null,
    supportsSelectableModels: presentation.supportsSelectableModels === true,
    vendors: Array.isArray(presentation.vendors) ? presentation.vendors : Object.freeze([]),
  });
}

function agentProviderDisplayAvailability(provider) {
  if (!provider) return INITIAL_AGENT_PROVIDER_AVAILABILITY;
  if (provider.enabled === false) {
    return agentProviderAvailabilityFromFailureReason(
      "disabled",
      provider.availability,
      provider.availability?.checkedAt || provider.diagnostic?.checkedAt || null,
    );
  }
  const diagnosticAvailability = provider.diagnostic
    ? agentProviderAvailabilityFromDiagnostic(
      provider.diagnostic,
      provider.availability,
      provider.diagnostic.checkedAt,
    )
    : provider.availability;
  return provider.providerId === STEMMIO_PROVIDER_ID
    && diagnosticAvailability.status === "ready"
    && provider.diagnostic?.facts?.protocol?.status === "unknown"
    && provider.diagnostic?.facts?.service?.status === "unknown"
    ? Object.freeze({ ...diagnosticAvailability, reason: "configuration-saved" })
    : diagnosticAvailability;
}

function providerReadyForPending(provider) {
  return provider?.availability?.status === "ready"
    || provider?.diagnostic?.readiness === "ready";
}

function projectListedConnection(currentConnection, listedConnection) {
  const current = currentConnection || null;
  if (listedConnection?.authSource) {
    return Object.freeze({
      ...(current || {}),
      authSource: listedConnection.authSource,
      authScope: listedConnection.authScope || null,
    });
  }
  if (!current) return null;
  if (listedConnection !== null) return current;
  if (current.vendorId || current.vendorDisplayName || current.baseUrl) {
    if (!current.authSource && !current.authScope) return current;
    return Object.freeze({
      vendorId: current.vendorId || "",
      vendorDisplayName: current.vendorDisplayName || "",
      baseUrl: current.baseUrl || "",
    });
  }
  return null;
}

function currentAccessOperation(provider) {
  return publicAccessOperation(provider?.activeOperation)
    || publicAccessOperation(provider?.lastOperation);
}

function finishProviderOperation(provider, operation, { state, errorCode = null } = {}) {
  const current = publicAccessOperation(operation);
  if (!current) {
    return Object.freeze({
      activeOperation: provider?.activeOperation || null,
      lastOperation: provider?.lastOperation || null,
    });
  }
  const finished = finishAccessOperation(current, { state, errorCode });
  if (isBlockingAccessOperation(finished)) {
    return Object.freeze({
      activeOperation: finished,
      lastOperation: provider?.lastOperation || null,
    });
  }
  return Object.freeze({
    activeOperation: null,
    lastOperation: finished,
  });
}

export function agentProviderCardsFromCatalog(snapshot) {
  const selected = snapshot?.selected || null;
  return Object.freeze(Object.values(snapshot?.providers ?? {})
    .filter((provider) => (
      provider.providerId === selected?.providerId
      || provider.installable === true
      || provider.presentation?.supportsApiKey === true
      || provider.availability?.status === "auth-required"
      || provider.availability?.status === "not-installed"
    ))
    .map((provider) => {
      const availability = agentProviderDisplayAvailability(provider);
      return Object.freeze({
      // The map retains each service's live configuration, including services
      // that are not the default. Preflight may resolve the default's model.
      selection: selected
        && selected.providerId === provider.providerId
        && selected.runtimeId === provider.runtimeId
        ? selected
        : provider.selection,
      presentation: agentProviderCardPresentation(provider),
      availability,
      models: Array.isArray(provider.models) ? provider.models : Object.freeze([]),
      credentialConfigured: provider.credentialConfigured === true,
      connection: provider.connection || null,
      credentialPersist: provider.credentialPersist || null,
      lastOperation: provider.lastOperation || null,
      loginUrlPresent: provider.loginUrlPresent === true,
      loginOpenError: provider.loginOpenError || null,
      enabled: provider.enabled !== false,
      activeOperation: provider.activeOperation || null,
      installState: provider.installState || "idle",
      diagnostic: provider.diagnostic || null,
      });
    }));
}

function frozenProviderEntry(descriptor, previous = null) {
  return Object.freeze({
    ...descriptor,
    installable: descriptor.installable === true,
    installSource: previous?.installSource || descriptor.installSource || "none",
    installState: previous?.installState || descriptor.installState || "idle",
    availability: previous?.availability || INITIAL_AGENT_PROVIDER_AVAILABILITY,
    installationDigest: previous?.installationDigest || null,
    models: previous?.models || Object.freeze([]),
    credentialConfigured: previous?.credentialConfigured === true,
      connection: previous?.connection || descriptor.connection || null,
      credentialPersist: previous?.credentialPersist || null,
      lastOperation: previous?.lastOperation || null,
      loginUrlPresent: previous?.loginUrlPresent === true || descriptor.loginUrlPresent === true,
    loginOpenError: previous?.loginOpenError || null,
    enabled: previous?.enabled !== false,
    activeOperation: previous?.activeOperation || null,
    diagnostic: previous?.diagnostic || descriptor.diagnostic || null,
  });
}

function frozenRecord(entries) {
  return Object.freeze(Object.fromEntries(entries));
}

function validDate(clock) {
  return new Date(Math.max(0, Number(clock.now()) || 0)).toISOString();
}

function preflightExpired(preflight, clock) {
  const expiresAt = Date.parse(String(preflight?.expiresAt || ""));
  return !Number.isFinite(expiresAt) || expiresAt <= clock.now();
}

function loginOperationFromBridgeResult(result, providerId, startedAt) {
  const adopted = publicAccessOperation(result?.activeOperation);
  if (adopted?.kind === "login" && adopted.providerId === providerId) return adopted;
  const generation = Number(result?.generation);
  if (!Number.isSafeInteger(generation) || generation < 1) return null;
  const state = result?.loginState === "cancelling"
    ? "cancelling"
    : result?.loginState === "succeeded"
      ? "succeeded"
      : result?.loginState === "cancelled"
        ? "cancelled"
        : result?.loginState === "failed"
          ? "failed"
          : "waiting";
  return publicAccessOperation({
    providerId,
    kind: "login",
    generation,
    state,
    startedAt: result?.startedAt || startedAt,
    errorCode: result?.errorCode || null,
  });
}

function publicModels(value) {
  if (!Array.isArray(value)) return Object.freeze([]);
  const models = [];
  const seen = new Set();
  for (const item of value) {
    const id = String(item?.id || "").trim().slice(0, 80);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    models.push(Object.freeze({
      id,
      displayName: String(item?.displayName || id).trim().slice(0, 80) || id,
      isDefault: item?.isDefault === true,
      providerModelId: String(item?.providerModelId || "").trim().slice(0, 80) || null,
      releaseChannel: String(item?.releaseChannel || "").trim().slice(0, 40) || null,
      contextWindow: Number(item?.contextWindow || 0) || null,
      maxOutputTokens: Number(item?.maxOutputTokens || 0) || null,
      supportsCompleteHtml: item?.supportsCompleteHtml === true,
      reasoningChoices: Object.freeze((Array.isArray(item?.reasoningChoices)
        ? item.reasoningChoices
        : []).map((choice) => Object.freeze({
        id: String(choice?.id || "").trim().slice(0, 40),
        label: String(choice?.label || choice?.id || "").trim().slice(0, 40),
      })).filter((choice) => choice.id && choice.label)),
    }));
  }
  return Object.freeze(models);
}

function preflightResolvedRequestedSelection(requested, returned) {
  if (
    requested.resolvedModelId !== null
    || requested.providerId !== returned.providerId
    || requested.runtimeId !== returned.runtimeId
    || requested.requestedModelId !== returned.requestedModelId
    || requested.reasoning.requested !== returned.reasoning.requested
  ) return false;
  if (
    typeof returned.resolvedModelId !== "string"
    || !returned.resolvedModelId.startsWith(`${requested.providerId}:`)
  ) return false;
  if (requested.requestedModelId && returned.resolvedModelId !== requested.requestedModelId) {
    return false;
  }
  if (requested.reasoning.requested === null) {
    return returned.reasoning.applied === null
      && returned.reasoning.resolution === "provider-default";
  }
  return returned.reasoning.applied === requested.reasoning.requested
    && returned.reasoning.resolution === "exact";
}

export class AgentCatalogState {
  #bridgeClient;
  #handoffPort;
  #clock;
  #providers = new Map();
  #selected = null;
  #preflightBySelection = new Map();
  #inflightBySelection = new Map();
  #diagnoseInflightBySelection = new Map();
  #diagnoseTimeoutMs;
  #spentPreflightIds = new Set();
  #generationByProvider = new Map();
  #diagnoseGenerationByProvider = new Map();
  #listeners = new Set();
  #disposed = false;
  #pendingDefault = null;
  #pendingDefaultSeq = 0;
  #configurationPreferencesPort;
  #preferencesLoaded;
  #configurationWrite = Promise.resolve();

  constructor({
    bridgeClient,
    handoffPort = null,
    clock = Date,
    diagnoseTimeoutMs = 30_000,
    providers = defaultAgentProviders(),
    selected = null,
    configurationPreferencesPort = null,
  } = {}) {
    if (!bridgeClient || typeof bridgeClient.preflightAgent !== "function") {
      throw new TypeError("AgentCatalogState requires an Agent bridge client.");
    }
    if (!clock || typeof clock.now !== "function") {
      throw new TypeError("AgentCatalogState requires a ClockPort.");
    }
    this.#bridgeClient = bridgeClient;
    this.#handoffPort = handoffPort;
    this.#clock = clock;
    this.#diagnoseTimeoutMs = Math.max(1, Number(diagnoseTimeoutMs) || 30_000);
    this.#configurationPreferencesPort = configurationPreferencesPort;
    for (const descriptor of providers) {
      if (!descriptor?.providerId || !descriptor?.runtimeId || !descriptor?.selection) {
        throw new TypeError("Agent provider descriptor is invalid.");
      }
      if (!AGENT_SECURITY_PROFILES.has(descriptor.securityProfile)) {
        throw new TypeError("Agent provider security profile is invalid.");
      }
      const descriptorSelection = freezeAgentSelection(descriptor.selection);
      if (
        descriptorSelection.providerId !== descriptor.providerId
        || descriptorSelection.runtimeId !== descriptor.runtimeId
      ) {
        throw new TypeError("Agent provider descriptor selection is mismatched.");
      }
      this.#providers.set(descriptor.providerId, frozenProviderEntry(Object.freeze({
        ...descriptor,
        selection: descriptorSelection,
      })));
      this.#generationByProvider.set(descriptor.providerId, 0);
      this.#diagnoseGenerationByProvider.set(descriptor.providerId, 0);
    }
    const defaultSelection = defaultManagedAgentDelivery().selection;
    const initial = selected
      || providers.find((provider) => provider.providerId === defaultSelection.providerId)?.selection
      || providers[0]?.selection
      || null;
    this.#selected = initial ? freezeAgentSelection(initial) : null;
    if (this.#selected) {
      const entry = this.#providers.get(this.#selected.providerId);
      if (entry) this.#providers.set(entry.providerId, Object.freeze({ ...entry, selection: this.#selected }));
    }
    const initialConfigurations = new Map([...this.#providers].map(([id, entry]) => [id, agentPreflightKey(entry.selection)]));
    this.#preferencesLoaded = configurationPreferencesPort
      ? configurationPreferencesPort.getAgentConfigurations().then((agentConfigurations) => {
        if (this.#disposed) return;
        for (const [id, choice] of Object.entries(agentConfigurations || {})) {
          const provider = this.#providers.get(id);
          if (!provider || agentPreflightKey(provider.selection) !== initialConfigurations.get(id)) continue;
          this.configureProvider({
            ...provider.selection,
            requestedModelId: choice.modelId,
            resolvedModelId: choice.modelId,
            reasoning: choice.reasoning
              ? { requested: choice.reasoning, applied: choice.reasoning, resolution: "exact" }
              : { requested: null, applied: null, resolution: "provider-default" },
          });
        }
      }).catch(() => {})
      : Promise.resolve();
  }

  applyDisabledProviderIds(ids = []) {
    const disabled = new Set(Array.isArray(ids) ? ids : []);
    let changed = false;
    for (const [providerId, provider] of this.#providers) {
      const enabled = !disabled.has(providerId);
      if ((provider.enabled !== false) === enabled) continue;
      changed = true;
      this.#invalidateProvider(providerId);
      this.#providers.set(providerId, Object.freeze({
        ...provider,
        enabled,
        availability: enabled
          ? checkingAgentProviderAvailability(provider.availability)
          : agentProviderAvailabilityFromFailureReason(
            "disabled",
            provider.availability,
            validDate(this.#clock),
          ),
      }));
    }
    if (changed) this.#publish();
  }

  getSnapshot() {
    return Object.freeze({
      providers: frozenRecord(this.#providers.entries()),
      selected: this.#selected,
      pendingDefault: this.pendingDefault(),
      displaySelection: this.displaySelection(),
      preflightBySelection: frozenRecord(this.#preflightBySelection.entries()),
    });
  }

  subscribe(listener) {
    if (typeof listener !== "function") throw new TypeError("Agent catalog listener is invalid.");
    this.#listeners.add(listener);
    listener(this.getSnapshot());
    return () => this.#listeners.delete(listener);
  }

  dispose() {
    this.#disposed = true;
    this.#listeners.clear();
    this.#preflightBySelection.clear();
    this.#inflightBySelection.clear();
    this.#diagnoseInflightBySelection.clear();
    this.#spentPreflightIds.clear();
  }

  select(selection) {
    const frozen = freezeAgentSelection(selection);
    const provider = this.#providers.get(frozen.providerId);
    if (!provider) {
      throw Object.assign(new Error("The selected Agent provider is not installed in this build."), {
        code: "AGENT_PROVIDER_UNSUPPORTED",
      });
    }
    if (provider.runtimeId !== frozen.runtimeId) {
      throw Object.assign(new Error("The selected Agent runtime is not installed in this build."), {
        code: "AGENT_RUNTIME_UNSUPPORTED",
      });
    }
    this.#selected = frozen;
    this.#providers.set(frozen.providerId, Object.freeze({ ...provider, selection: frozen }));
    this.#generationByProvider.set(
      frozen.providerId,
      (this.#generationByProvider.get(frozen.providerId) || 0) + 1,
    );
    // A preflight started before this selection generation can no longer
    // publish availability. Do not let its promise suppress the fresh check
    // required when the user switches away and then back to this Provider.
    // The old process may still settle, but its generation fence and identity
    // check keep it from replacing the new authority or clearing its map entry.
    for (const [key, inflight] of this.#inflightBySelection) {
      if (inflight.providerId === frozen.providerId) {
        this.#inflightBySelection.delete(key);
      }
    }
    for (const [key, inflight] of this.#diagnoseInflightBySelection) {
      if (inflight.providerId === frozen.providerId) {
        this.#diagnoseInflightBySelection.delete(key);
      }
    }
    this.#publish();
    return frozen;
  }

  queuePendingDefault(selection) {
    const frozen = freezeAgentSelection(selection);
    if (!this.#providers.get(frozen.providerId)) {
      throw Object.assign(new Error("The selected Agent provider is not installed in this build."), {
        code: "AGENT_PROVIDER_UNSUPPORTED",
      });
    }
    this.#pendingDefaultSeq += 1;
    this.#pendingDefault = Object.freeze({
      intentId: `pending-default-${this.#pendingDefaultSeq}`,
      queuedSelection: frozen,
      validatedSelection: null,
    });
    this.#publish();
    return this.pendingDefault();
  }

  pendingDefault() {
    const pending = this.#pendingDefault;
    if (!pending) return null;
    return freezeAgentSelection(pending.validatedSelection || pending.queuedSelection);
  }

  peekPendingDefaultIntent() {
    return this.#pendingDefault;
  }

  bindPendingDefaultSelection(selection) {
    const pending = this.#pendingDefault;
    const frozen = freezeAgentSelection(selection);
    if (!pending || pending.queuedSelection.providerId !== frozen.providerId) return null;
    this.#pendingDefault = Object.freeze({
      ...pending,
      validatedSelection: frozen,
    });
    this.#publish();
    return this.pendingDefault();
  }

  readyPendingDefault() {
    const pending = this.#pendingDefault;
    if (!pending) return null;
    const selection = pending.validatedSelection || pending.queuedSelection;
    const provider = this.provider(selection);
    if (!providerReadyForPending(provider)) return null;
    return freezeAgentSelection(selection);
  }

  clearPendingDefault(expectedIntentId) {
    if (!this.#pendingDefault) return null;
    if (expectedIntentId && this.#pendingDefault.intentId !== expectedIntentId) {
      return this.pendingDefault();
    }
    this.#pendingDefault = null;
    this.#publish();
    return null;
  }

  commitPendingDefault(expectedIntentId) {
    const pending = this.#pendingDefault;
    if (!pending || pending.intentId !== expectedIntentId) return null;
    const ready = this.readyPendingDefault();
    if (!ready) return null;
    this.select(ready);
    if (this.#pendingDefault?.intentId !== expectedIntentId) return ready;
    this.#pendingDefault = null;
    this.#publish();
    return ready;
  }

  publishCredentialPersist(providerId, {
    status,
    operationKind = null,
    reason = null,
    operationId = null,
    recordId = null,
    code = null,
  } = {}) {
    const id = String(providerId || "");
    const allowed = new Set([
      "pending",
      "saved",
      "failed",
      "unreadable",
      "unavailable",
      "rejected",
      "unknown",
      "skipped",
      "missing",
      "superseded",
    ]);
    this.#patchProvider(id, {
      credentialPersist: Object.freeze({
        status: allowed.has(status) ? status : "unknown",
        operationKind: ["startup", "persist", "clear"].includes(operationKind)
          ? operationKind
          : null,
        reason: reason ? String(reason) : null,
        operationId: operationId ? String(operationId) : null,
        recordId: recordId ? String(recordId) : null,
        code: code ? String(code) : null,
      }),
    });
    return this.credentialPersist(id);
  }

  credentialPersist(providerId) {
    return this.#providers.get(String(providerId || ""))?.credentialPersist || null;
  }

  publishRestoredCredentialConnection(providerId, { vendorId } = {}) {
    const id = String(providerId || "");
    const normalizedVendorId = String(vendorId || "").trim();
    const provider = this.#providers.get(id);
    const vendor = agentProviderCardPresentation(provider).vendors
      .find((entry) => entry.id === normalizedVendorId);
    if (!provider || !vendor) return null;
    const connection = Object.freeze({
      vendorId: vendor.id,
      vendorDisplayName: vendor.label,
      baseUrl: "",
    });
    const modelEnvironment = globalThis.stemmioRuntime?.betaAgentModelsEnabled === true
      ? { STEMMIO_ENABLE_BETA_AGENT_MODELS: "1" }
      : {};
    this.#patchProvider(id, {
      credentialConfigured: true,
      connection,
      models: publicModels(publicModelsForVendor(vendor.id, modelEnvironment)),
    });
    return connection;
  }

  freezeSelected() {
    if (!this.#selected) return null;
    return freezeAgentSelection(this.#selected);
  }

  displaySelection() {
    const pending = this.pendingDefault();
    if (pending) {
      const availability = this.displayAvailability(pending);
      if (availability.status !== "ready") {
        return freezeAgentSelection(pending);
      }
    }
    return this.freezeSelected();
  }

  freezeProviderSelection(providerId) {
    const provider = this.#providers.get(String(providerId || ""));
    if (!provider) return null;
    return freezeAgentSelection(provider.selection);
  }

  provider(selection = this.#selected) {
    if (!selection) return null;
    const provider = this.#providers.get(selection.providerId) || null;
    return provider?.runtimeId === selection.runtimeId ? provider : null;
  }

  availability(selection = this.#selected) {
    return this.provider(selection)?.availability || INITIAL_AGENT_PROVIDER_AVAILABILITY;
  }

  displayAvailability(selection = this.displaySelection()) {
    return agentProviderDisplayAvailability(this.provider(selection));
  }

  presentation(selection = this.displaySelection()) {
    const provider = this.provider(selection);
    if (provider) return provider.presentation;
    const providerId = String(selection?.providerId || "Agent");
    return Object.freeze({
      displayName: providerId,
      agentName: providerId,
      logoSrc: null,
      cardClassName: "agent-provider-card",
      primaryActionDataAttribute: null,
      stopLabel: "停止 Agent 并继续编辑",
      restartLabel: "重新启动 Agent",
      restartSupported: false,
      frozenPreviewDetail: `这是本轮冻结并交给 ${providerId} 的只读内容`,
    });
  }

  async refreshAvailability(selection = this.freezeSelected()) {
    const frozen = freezeAgentSelection(selection);
    const provider = this.provider(frozen);
    if (!provider) throw this.#unsupportedProvider(frozen.providerId);
    const previous = provider.availability;
    const generation = (this.#generationByProvider.get(frozen.providerId) || 0) + 1;
    this.#generationByProvider.set(frozen.providerId, generation);
    this.#setAvailability(frozen.providerId, checkingAgentProviderAvailability(previous));
    try {
      const availabilityMethod = typeof this.#bridgeClient.agentAvailability === "function"
        ? (input) => this.#bridgeClient.agentAvailability(input)
        : typeof this.#bridgeClient.qoderAvailability === "function"
          ? (input) => this.#bridgeClient.qoderAvailability(input)
          : null;
      if (!availabilityMethod) {
        throw Object.assign(new Error("Agent availability is unavailable."), {
          code: "AGENT_AVAILABILITY_UNAVAILABLE",
        });
      }
      const result = await availabilityMethod({ selection: frozen });
      if (
        this.#disposed
        || this.#generationByProvider.get(frozen.providerId) !== generation
      ) return null;
      await this.#applyPublicCatalog();
      const availability = agentProviderAvailabilityFromLocalResult(
        result,
        previous,
        validDate(this.#clock),
      );
      this.#setAvailability(frozen.providerId, availability);
      return Object.freeze({ result, availability });
    } catch (cause) {
      if (
        !this.#disposed
        && this.#generationByProvider.get(frozen.providerId) === generation
      ) {
        this.#setFailure(frozen, cause, previous);
      }
      throw cause;
    }
  }

  diagnose(selection = this.freezeSelected()) {
    const frozen = freezeAgentSelection(selection);
    const provider = this.provider(frozen);
    if (!provider) return Promise.reject(this.#unsupportedProvider(frozen.providerId));
    const key = agentPreflightKey(frozen, {
      installationDigest: provider.installationDigest || "",
      purpose: "diagnose",
    });
    const inflight = this.#diagnoseInflightBySelection.get(key);
    if (inflight) return inflight.promise;
    const generation = (this.#diagnoseGenerationByProvider.get(frozen.providerId) || 0) + 1;
    this.#diagnoseGenerationByProvider.set(frozen.providerId, generation);
    const configurationGeneration = this.#generationByProvider.get(frozen.providerId) || 0;
    const operationId = `diagnose_${frozen.providerId}_${generation}`;
    const checking = (async () => {
      let timeout;
      const previousDiagnostic = this.#providers.get(frozen.providerId)?.diagnostic || null;
      try {
        // Bridge AgentInstaller owns install state. Hydrate it before running a
        // side-effect-free diagnosis so a reopened Settings page can cancel an
        // installation already in flight.
        const diagnoseMethod = typeof this.#bridgeClient.agentDiagnose === "function"
          ? (input) => this.#bridgeClient.agentDiagnose(input)
          : typeof this.#bridgeClient.agentAvailability === "function"
            ? (input) => this.#bridgeClient.agentAvailability(input)
            : typeof this.#bridgeClient.qoderAvailability === "function"
              ? (input) => this.#bridgeClient.qoderAvailability(input)
              : null;
        if (!diagnoseMethod) {
          throw Object.assign(new Error("Agent diagnosis is unavailable."), {
            code: "AGENT_DIAGNOSE_UNAVAILABLE",
          });
        }
        const result = await Promise.race([
          (async () => {
            await this.#applyPublicCatalog();
            return diagnoseMethod({ selection: frozen });
          })(),
          new Promise((_, reject) => {
            timeout = setTimeout(() => reject(Object.assign(new Error("本次检查已超时，请重新检查。"), {
              code: "AGENT_DIAGNOSE_TIMEOUT",
            })), this.#diagnoseTimeoutMs);
          }),
        ]);
        if (
          this.#disposed
          || this.#diagnoseGenerationByProvider.get(frozen.providerId) !== generation
          || this.#generationByProvider.get(frozen.providerId) !== configurationGeneration
        ) return null;
        const diagnostic = agentDiagnosticSnapshot(
          { ...(result?.diagnostic || result), operationId, configurationGeneration },
          validDate(this.#clock),
          previousDiagnostic,
        );
        const current = this.#providers.get(frozen.providerId);
        if (current) {
          this.#providers.set(frozen.providerId, Object.freeze({
            ...current,
            diagnostic,
            ...(current.enabled === false
              ? {
                availability: agentProviderAvailabilityFromFailureReason(
                  "disabled",
                  current.availability,
                  validDate(this.#clock),
                ),
              }
              : {}),
          }));
          this.#publish();
        }
        return Object.freeze({
          result,
          diagnostic,
          availability: current?.enabled === false
            ? agentProviderAvailabilityFromFailureReason(
              "disabled",
              current.availability,
              validDate(this.#clock),
            )
            : current?.availability || provider.availability,
        });
      } catch (cause) {
        if (this.#disposed
          || this.#diagnoseGenerationByProvider.get(frozen.providerId) !== generation
          || this.#generationByProvider.get(frozen.providerId) !== configurationGeneration) return null;
        if (
          !this.#disposed
          && this.#diagnoseGenerationByProvider.get(frozen.providerId) === generation
          && this.#generationByProvider.get(frozen.providerId) === configurationGeneration
        ) {
          const current = this.#providers.get(frozen.providerId);
          const diagnostic = agentDiagnosticSnapshot({
            readiness: "connection-failed",
            cause: cause?.code || "AGENT_DIAGNOSE_UNAVAILABLE",
            operationId, configurationGeneration,
            operation: "diagnose",
          }, validDate(this.#clock), previousDiagnostic);
          if (current) {
            this.#providers.set(frozen.providerId, Object.freeze({ ...current, diagnostic }));
            this.#publish();
          }
        }
        throw cause;
      } finally {
        clearTimeout(timeout);
        if (this.#diagnoseInflightBySelection.get(key)?.promise === checking) {
          this.#diagnoseInflightBySelection.delete(key);
        }
      }
    })();
    this.#diagnoseInflightBySelection.set(key, Object.freeze({
      providerId: frozen.providerId,
      promise: checking,
    }));
    return checking;
  }

  preflight(selection = this.freezeSelected(), {
    force = false,
    purpose = "execution",
    trustPolicyVersion = null,
    installationDigest = null,
  } = {}) {
    if (purpose !== "execution") {
      return Promise.reject(Object.assign(new Error("Agent preflight purpose is unsupported."), {
        code: "AGENT_CAPABILITY_UNSUPPORTED",
      }));
    }
    const frozen = freezeAgentSelection(selection);
    const provider = this.provider(frozen);
    if (!provider) return Promise.reject(this.#unsupportedProvider(frozen.providerId));
    if (provider.enabled === false) {
      return Promise.reject(Object.assign(new Error("This Agent is disconnected in Stemmio."), {
        code: "AGENT_PROVIDER_DISABLED",
      }));
    }
    const trust = String(trustPolicyVersion || provider.trustPolicyVersion || "");
    const digest = String(
      installationDigest || frozen.installationDigest || provider.installationDigest || "",
    );
    const key = agentPreflightKey(frozen, {
      installationDigest: digest,
      trustPolicyVersion: trust,
      purpose,
    });
    if (!force) {
      const reusable = this.#preflightBySelection.get(key);
      if (reusable && !preflightExpired(reusable, this.#clock)) {
        return Promise.resolve(reusable);
      }
      if (reusable) this.#preflightBySelection.delete(key);
    }
    const inflight = this.#inflightBySelection.get(key);
    if (inflight) return inflight.promise;
    const generation = (this.#generationByProvider.get(frozen.providerId) || 0) + 1;
    this.#generationByProvider.set(frozen.providerId, generation);
    const previous = provider.availability;
    if (this.#isSelected(frozen)) {
      this.#setAvailability(frozen.providerId, checkingAgentProviderAvailability(previous));
    }
    const checking = (async () => {
      try {
        const preflight = await this.#bridgeClient.preflightAgent({
          selection: frozen,
          purpose,
          trustPolicyAccepted: trust,
        });
        if (preflight?.status !== "ready" || !preflight.preflightId) {
          throw Object.assign(new Error("Agent preflight did not return a usable ticket."), {
            code: "RUN_AGENT_PREFLIGHT_INVALID",
          });
        }
        if (preflight.purpose && preflight.purpose !== purpose) {
          throw Object.assign(new Error("Agent preflight purpose changed."), {
            code: "AGENT_PREFLIGHT_PURPOSE_MISMATCH",
          });
        }
        if (
          preflight.trustPolicyVersion
          && preflight.trustPolicyVersion !== trust
        ) {
          throw Object.assign(new Error("Agent preflight trust policy changed."), {
            code: "AGENT_PREFLIGHT_TRUST_MISMATCH",
          });
        }
        const returnedSelection = freezeAgentSelection(preflight.selection || frozen);
        if (
          agentPreflightKey(returnedSelection) !== agentPreflightKey(frozen)
          && !preflightResolvedRequestedSelection(frozen, returnedSelection)
        ) {
          throw Object.assign(new Error("Agent preflight returned a different selection."), {
            code: "AGENT_PREFLIGHT_SELECTION_MISMATCH",
          });
        }
        if (
          preflight.securityProfile
          && preflight.securityProfile !== provider.securityProfile
        ) {
          throw Object.assign(new Error("Agent preflight security profile changed."), {
            code: "AGENT_SECURITY_PROFILE_MISMATCH",
          });
        }
        const result = Object.freeze({
          ...preflight,
          selection: returnedSelection,
          securityProfile: provider.securityProfile,
          purpose,
          trustPolicyVersion: trust,
          installationDigest: String(preflight.installationDigest || digest || ""),
        });
        const generationIsCurrent = (
          !this.#disposed
          && this.#generationByProvider.get(frozen.providerId) === generation
        );
        if (!generationIsCurrent) return result;
        const wasSelected = this.#isSelected(frozen);
        if (wasSelected) this.#selected = returnedSelection;
        const finalKey = agentPreflightKey(result.selection, {
          installationDigest: result.installationDigest,
          trustPolicyVersion: trust,
          purpose,
        });
        this.#preflightBySelection.set(finalKey, result);
        if (finalKey !== key) this.#preflightBySelection.delete(key);
        if (wasSelected || this.#canProjectAvailability(frozen)) {
          this.#setProviderDigest(frozen.providerId, result.installationDigest);
          const current = this.#providers.get(frozen.providerId);
          if (current) {
            this.#providers.set(frozen.providerId, Object.freeze({
              ...current,
              selection: returnedSelection,
              models: publicModels(result.models),
            }));
          }
          this.#setDiagnosticFacts(frozen.providerId, {
            authentication: { status: "ready", cause: null, source: "preflight" },
            protocol: { status: "ready", cause: null, source: "preflight" },
            service: { status: "ready", cause: null, source: "preflight" },
          }, { publish: false, readiness: "ready", cause: null });
          this.#setAvailability(
            frozen.providerId,
            readyAgentProviderAvailability(validDate(this.#clock)),
          );
        } else {
          this.#publish();
        }
        return result;
      } catch (cause) {
        if (
          !this.#disposed
          && this.#generationByProvider.get(frozen.providerId) === generation
          && this.#canProjectAvailability(frozen)
        ) {
          const code = String(cause?.code || "AGENT_PREFLIGHT_FAILED");
          const failure = diagnosticFailureUpdate(code, "preflight");
          this.#setDiagnosticFacts(frozen.providerId, failure.facts, {
            publish: false,
            readiness: failure.readiness,
            cause: code,
          });
          this.#setFailure(frozen, cause, previous);
        }
        throw cause;
      } finally {
        if (this.#inflightBySelection.get(key)?.promise === checking) {
          this.#inflightBySelection.delete(key);
        }
      }
    })();
    this.#inflightBySelection.set(key, Object.freeze({
      providerId: frozen.providerId,
      promise: checking,
    }));
    return checking;
  }

  async spendTicket(selection = this.freezeSelected(), options = {}) {
    const frozen = freezeAgentSelection(selection);
    const preflight = await this.preflight(frozen, options);
    const preflightId = String(preflight?.preflightId || "");
    if (!preflightId || this.#spentPreflightIds.has(preflightId)) {
      throw Object.assign(new Error("Agent preflight ticket was already spent."), {
        code: "AGENT_PREFLIGHT_TICKET_SPENT",
      });
    }
    this.#spentPreflightIds.add(preflightId);
    const provider = this.provider(frozen);
    const key = agentPreflightKey(preflight.selection || frozen, {
      installationDigest: preflight.installationDigest,
      trustPolicyVersion: preflight.trustPolicyVersion || provider?.trustPolicyVersion,
      purpose: preflight.purpose || options.purpose || "execution",
    });
    this.#preflightBySelection.delete(key);
    this.#publish();
    return preflight;
  }

  discardTicket(preflight) {
    if (!preflight?.selection) return false;
    const key = agentPreflightKey(preflight.selection, {
      installationDigest: preflight.installationDigest,
      trustPolicyVersion: preflight.trustPolicyVersion,
      purpose: preflight.purpose,
    });
    const deleted = this.#preflightBySelection.delete(key);
    if (deleted) this.#publish();
    return deleted;
  }

  async install(selection = this.freezeSelected()) {
    const frozen = freezeAgentSelection(selection);
    const provider = this.provider(frozen);
    if (!provider) throw this.#unsupportedProvider(frozen.providerId);
    if (provider.installable !== true) {
      throw Object.assign(new Error("This Agent cannot be installed from Stemmio."), {
        code: "AGENT_INSTALL_UNSUPPORTED",
      });
    }
    if (typeof this.#bridgeClient.installAgent !== "function") {
      throw Object.assign(new Error("Agent install is unavailable."), {
        code: "AGENT_INSTALL_UNSUPPORTED",
      });
    }
    this.#invalidateProvider(frozen.providerId);
    const generation = (this.#generationByProvider.get(frozen.providerId) || 0) + 1;
    this.#generationByProvider.set(frozen.providerId, generation);
    this.#patchProvider(frozen.providerId, {
      installState: "installing",
      lastOperation: isInFlightAccessOperation(provider.activeOperation)
        ? provider.lastOperation || null
        : publicAccessOperation(provider.activeOperation) || provider.lastOperation || null,
      activeOperation: createAccessOperation({
        providerId: frozen.providerId,
        kind: "install",
        generation,
        startedAt: validDate(this.#clock),
      }),
    });
    this.#setAvailability(frozen.providerId, checkingAgentProviderAvailability(provider.availability));
    try {
      await this.#bridgeClient.installAgent({ providerId: frozen.providerId });
      this.#patchProvider(frozen.providerId, {
        installState: "idle",
        installSource: "managed",
        ...finishProviderOperation(
          this.provider(frozen),
          this.provider(frozen)?.activeOperation,
          { state: "succeeded" },
        ),
      });
      return this.diagnose(
        this.freezeProviderSelection(frozen.providerId) || frozen,
      );
    } catch (cause) {
      const cancelled = cause?.code === "AGENT_INSTALL_CANCELLED";
      this.#patchProvider(frozen.providerId, {
        installState: cancelled ? "idle" : "failed",
        ...finishProviderOperation(
          this.provider(frozen),
          this.provider(frozen)?.activeOperation,
          {
            state: cancelled ? "cancelled" : "failed",
            errorCode: cancelled ? "AGENT_INSTALL_CANCELLED" : cause?.code || "AGENT_INSTALL_FAILED",
          },
        ),
      });
      await this.diagnose(
        this.freezeProviderSelection(frozen.providerId) || frozen,
      ).catch(() => null);
      if (cancelled) return Object.freeze({ cancelled: true, installState: "idle" });
      throw cause;
    }
  }

  async cancelInstall(selection = this.freezeSelected()) {
    const frozen = freezeAgentSelection(selection);
    const provider = this.provider(frozen);
    if (!provider) throw this.#unsupportedProvider(frozen.providerId);
    if (provider.installable !== true) {
      throw Object.assign(new Error("This Agent cannot be installed from Stemmio."), {
        code: "AGENT_INSTALL_UNSUPPORTED",
      });
    }
    if (typeof this.#bridgeClient.cancelAgentInstall !== "function") {
      throw Object.assign(new Error("Agent install cancellation is unavailable."), {
        code: "AGENT_INSTALL_UNSUPPORTED",
      });
    }
    this.#invalidateProvider(frozen.providerId);
    this.#patchProvider(frozen.providerId, { installState: "cancelling" });
    try {
      const result = await this.#bridgeClient.cancelAgentInstall({ providerId: frozen.providerId });
      this.#patchProvider(frozen.providerId, {
        installState: ["idle", "failed"].includes(result?.installState)
          ? result.installState
          : "idle",
        ...finishProviderOperation(
          this.provider(frozen),
          provider.activeOperation || createAccessOperation({
            providerId: frozen.providerId,
            kind: "install",
            generation: this.#generationByProvider.get(frozen.providerId) || 1,
          }),
          { state: result?.installState === "failed" ? "failed" : "cancelled" },
        ),
      });
      await this.diagnose(this.freezeProviderSelection(frozen.providerId) || frozen).catch(() => null);
      return result;
    } catch (cause) {
      this.#patchProvider(frozen.providerId, { installState: "failed" });
      throw cause;
    }
  }

  async cancelAccessOperation(selection = this.freezeSelected()) {
    const frozen = freezeAgentSelection(selection);
    const provider = this.provider(frozen);
    if (this.#pendingDefault?.queuedSelection.providerId === frozen.providerId) {
      this.clearPendingDefault(this.#pendingDefault.intentId);
    }
    const operation = pickActiveAccessOperation(
      provider?.activeOperation,
      ["installing", "cancelling"].includes(provider?.installState)
        ? createAccessOperation({
          providerId: frozen.providerId,
          kind: "install",
          generation: this.#generationByProvider.get(frozen.providerId) || 1,
        })
        : null,
    );
    const installing = ["installing", "cancelling"].includes(provider?.installState)
      || operation?.kind === "install";
    if (installing) {
      return this.cancelInstall(frozen);
    }
    if (!operation) return provider?.lastOperation || null;
    if (operation.kind === "login" && typeof this.#bridgeClient.cancelAgentLogin === "function") {
      const cancelling = requestCancelAccessOperation(operation);
      this.#patchProvider(frozen.providerId, { activeOperation: cancelling });
      try {
        const result = await this.#bridgeClient.cancelAgentLogin({ providerId: frozen.providerId });
        const stopUnconfirmed = result?.loginState === "stop-unconfirmed"
          || result?.errorCode === "AGENT_LOGIN_CANCEL_FAILED";
        if (stopUnconfirmed) {
          throw Object.assign(new Error("无法确认登录进程已退出。"), {
            code: "AGENT_LOGIN_CANCEL_FAILED",
          });
        }
        const current = this.provider(frozen);
        this.#patchProvider(frozen.providerId, {
          ...finishProviderOperation(
            current,
            current?.activeOperation || cancelling,
            { state: "cancelled" },
          ),
          loginUrlPresent: false,
        });
      } catch (cause) {
        const stopUnconfirmed = String(cause?.code || "") === "AGENT_LOGIN_CANCEL_FAILED";
        const current = this.provider(frozen);
        this.#patchProvider(frozen.providerId, finishProviderOperation(
          current,
          current?.activeOperation || cancelling,
          {
            state: stopUnconfirmed ? "stop-unconfirmed" : "failed",
            errorCode: cause?.code || "AGENT_LOGIN_CANCEL_FAILED",
          },
        ));
        throw cause;
      }
      return currentAccessOperation(this.provider(frozen));
    }
    if (operation.kind === "config-validate") {
      const cancelling = requestCancelAccessOperation(operation);
      this.#patchProvider(frozen.providerId, { activeOperation: cancelling });
      const cancelConfiguration = typeof this.#bridgeClient.cancelAgentConfiguration === "function"
        ? (body) => this.#bridgeClient.cancelAgentConfiguration(body)
        : null;
      if (cancelConfiguration) {
        const result = await cancelConfiguration({
          providerId: frozen.providerId,
          generation: operation.generation,
        });
        if (result?.cancelled === false && result?.configured === true) {
          return currentAccessOperation(this.provider(frozen));
        }
      }
      this.#invalidateProvider(frozen.providerId);
      this.#patchProvider(frozen.providerId, finishProviderOperation(
        this.provider(frozen),
        cancelling,
        { state: "cancelled" },
      ));
      return currentAccessOperation(this.provider(frozen));
    }
    const cancelling = requestCancelAccessOperation(operation);
    this.#patchProvider(frozen.providerId, { activeOperation: cancelling });
    if (cancelling.state === "cancelling") {
      this.#patchProvider(frozen.providerId, finishProviderOperation(
        this.provider(frozen),
        cancelling,
        { state: "cancelled" },
      ));
    }
    return currentAccessOperation(this.provider(frozen));
  }

  async startLogin(selection = this.freezeSelected()) {
    const frozen = freezeAgentSelection(selection);
    const provider = this.provider(frozen);
    if (!provider) throw this.#unsupportedProvider(frozen.providerId);
    if (typeof this.#bridgeClient.loginAgent !== "function") {
      throw Object.assign(new Error("This Agent cannot start an official login."), {
        code: "AGENT_LOGIN_UNSUPPORTED",
      });
    }
    this.#invalidateProvider(frozen.providerId);
    this.#patchProvider(frozen.providerId, {
      loginUrlPresent: false,
      loginOpenError: null,
    });
    this.#setAvailability(frozen.providerId, checkingAgentProviderAvailability(provider.availability));
    let operation = null;
    try {
      const started = await this.#bridgeClient.loginAgent({ providerId: frozen.providerId });
      operation = loginOperationFromBridgeResult(
        started,
        frozen.providerId,
        validDate(this.#clock),
      );
      if (!operation) {
        throw Object.assign(new Error("官方登录没有返回操作身份。"), {
          code: "AGENT_LOGIN_FAILED",
        });
      }
      this.#patchProvider(frozen.providerId, {
        activeOperation: operation,
        loginUrlPresent: started?.loginUrlPresent === true,
      });
      // Native Codex login already opens the browser. Keep Stemmio's explicit
      // reopen command as a fallback, with no second automatic opener.
      if (frozen.providerId !== "codex") void this.#openOfficialLogin(frozen.providerId, operation.operationId);
      return await this.#waitForLogin(frozen, operation.operationId);
    } catch (cause) {
      const cancelled = cause?.code === "AGENT_LOGIN_CANCELLED";
      const stopUnconfirmed = cause?.code === "AGENT_LOGIN_CANCEL_FAILED";
      const current = this.provider(frozen)?.activeOperation;
      if (operation && current?.operationId === operation.operationId) {
        this.#patchProvider(frozen.providerId, {
          ...finishProviderOperation(this.provider(frozen), current, {
            state: stopUnconfirmed ? "stop-unconfirmed" : cancelled ? "cancelled" : "failed",
            errorCode: cause?.code || "AGENT_LOGIN_FAILED",
          }),
          loginUrlPresent: false,
        });
      }
      await this.diagnose(
        this.freezeProviderSelection(frozen.providerId) || frozen,
      ).catch(() => null);
      throw cause;
    }
  }

  async reopenOfficialLogin(selection = this.freezeSelected()) {
    const frozen = freezeAgentSelection(selection);
    const provider = this.provider(frozen);
    if (!provider) throw this.#unsupportedProvider(frozen.providerId);
    const operation = publicAccessOperation(provider.activeOperation);
    if (operation?.kind !== "login" || !["waiting", "cancelling"].includes(operation.state)) {
      throw Object.assign(new Error("当前没有等待中的官方登录。"), {
        code: "AGENT_LOGIN_URL_UNAVAILABLE",
      });
    }
    const opened = await this.#requestOpenLogin(frozen.providerId);
    this.#patchProvider(frozen.providerId, {
      loginOpenError: opened.opened ? null : opened.reason,
    });
    if (!opened.opened) {
      throw Object.assign(new Error(opened.reason), {
        code: "AGENT_LOGIN_URL_UNAVAILABLE",
      });
    }
    return Object.freeze({ opened: true });
  }

  async startLogout(selection = this.freezeSelected()) {
    const frozen = freezeAgentSelection(selection);
    const provider = this.provider(frozen);
    if (!provider) throw this.#unsupportedProvider(frozen.providerId);
    if (typeof this.#bridgeClient.logoutAgent !== "function") {
      throw Object.assign(new Error("This Agent cannot sign out from the official account."), {
        code: "AGENT_LOGOUT_UNSUPPORTED",
      });
    }
    const connection = provider.connection;
    if (connection?.authSource === "environment-token") {
      throw Object.assign(new Error("当前使用环境变量凭据，无法在应用内退出账号。"), {
        code: "AGENT_LOGOUT_UNSUPPORTED",
      });
    }
    this.#invalidateProvider(frozen.providerId);
    const generation = this.#generationByProvider.get(frozen.providerId) || 1;
    this.#patchProvider(frozen.providerId, {
      activeOperation: createAccessOperation({
        providerId: frozen.providerId,
        kind: "logout",
        generation,
        startedAt: validDate(this.#clock),
      }),
    });
    try {
      await this.#bridgeClient.logoutAgent({ providerId: frozen.providerId });
      const current = publicAccessOperation(this.provider(frozen)?.activeOperation);
      if (current?.operationId === accessOperationId({
        providerId: frozen.providerId,
        kind: "logout",
        generation,
      })) {
        this.#patchProvider(frozen.providerId, {
          ...finishProviderOperation(this.provider(frozen), current, { state: "succeeded" }),
          connection: null,
        });
      }
      return this.diagnose(this.freezeProviderSelection(frozen.providerId) || frozen);
    } catch (cause) {
      const current = publicAccessOperation(this.provider(frozen)?.activeOperation);
      if (current?.generation === generation && current.kind === "logout") {
        this.#patchProvider(frozen.providerId, finishProviderOperation(
          this.provider(frozen),
          current,
          {
            state: "failed",
            errorCode: cause?.code || "AGENT_LOGOUT_FAILED",
          },
        ));
      }
      await this.diagnose(
        this.freezeProviderSelection(frozen.providerId) || frozen,
      ).catch(() => null);
      throw cause;
    }
  }

  async #requestOpenLogin(providerId) {
    if (typeof this.#handoffPort?.openLogin !== "function") {
      return Object.freeze({
        opened: false,
        reason: "当前环境无法打开官方登录页。",
      });
    }
    try {
      const result = await this.#handoffPort.openLogin({ providerId });
      if (result && result.opened === false) {
        return Object.freeze({
          opened: false,
          reason: String(result.reason || "官方登录页没有打开。"),
        });
      }
      return Object.freeze({ opened: true, reason: null });
    } catch (cause) {
      return Object.freeze({
        opened: false,
        reason: String(cause?.message || "官方登录页暂时无法打开。"),
      });
    }
  }

  async #openOfficialLogin(providerId, operationId) {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const current = this.#providers.get(providerId);
      const operation = publicAccessOperation(current?.activeOperation);
      if (operation?.operationId !== operationId) return;
      if (!["waiting", "cancelling"].includes(operation.state)) return;
      if (current.loginUrlPresent === true) {
        const opened = await this.#requestOpenLogin(providerId);
        this.#patchProvider(providerId, {
          loginOpenError: opened.opened ? null : opened.reason,
        });
        return;
      }
      if (typeof this.#bridgeClient.agentProviders === "function") {
        const listed = await this.#bridgeClient.agentProviders().catch(() => null);
        const item = Array.isArray(listed?.providers)
          ? listed.providers.find((entry) => entry?.providerId === providerId)
          : null;
        if (item?.loginUrlPresent === true) {
          this.#patchProvider(providerId, { loginUrlPresent: true });
          const opened = await this.#requestOpenLogin(providerId);
          this.#patchProvider(providerId, {
            loginOpenError: opened.opened ? null : opened.reason,
          });
          return;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    const current = this.#providers.get(providerId);
    const operation = publicAccessOperation(current?.activeOperation);
    if (operation?.operationId === operationId && operation.state === "waiting") {
      this.#patchProvider(providerId, {
        loginOpenError: "还没有拿到登录页，可稍后重新打开。",
      });
    }
  }

  async #waitForLogin(selection, operationId) {
    for (let attempt = 0; attempt < 900; attempt += 1) {
      await this.#applyPublicCatalog();
      const current = this.provider(selection);
      const operation = currentAccessOperation(current);
      if (!operation || operation.operationId !== operationId) {
        throw Object.assign(new Error("A newer login replaced this attempt."), {
          code: "AGENT_LOGIN_STALE",
        });
      }
      if (operation.state === "cancelled") {
        throw Object.assign(new Error("登录已取消。"), { code: "AGENT_LOGIN_CANCELLED" });
      }
      if (operation.state === "stop-unconfirmed") {
        throw Object.assign(new Error("无法确认登录进程已退出。"), {
          code: "AGENT_LOGIN_CANCEL_FAILED",
        });
      }
      if (operation.state === "failed") {
        throw Object.assign(new Error("官方登录没有完成。"), {
          code: operation.errorCode || "AGENT_LOGIN_FAILED",
        });
      }
      if (operation.state === "succeeded") {
        return this.#completeLogin(selection, operation);
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    const current = publicAccessOperation(this.provider(selection)?.activeOperation);
    if (current?.operationId === operationId) {
      this.#patchProvider(selection.providerId, {
        ...finishProviderOperation(this.provider(selection), current, {
          state: "failed",
          errorCode: "AGENT_LOGIN_EXPIRED",
        }),
        loginUrlPresent: false,
      });
    }
    throw Object.assign(new Error("登录等待已超时。"), { code: "AGENT_LOGIN_EXPIRED" });
  }

  async #completeLogin(selection, operation) {
    const diagnosed = await this.diagnose(
      this.freezeProviderSelection(selection.providerId) || selection,
    ).catch(() => null);
    const current = this.provider(selection);
    const active = currentAccessOperation(current);
    if (!active || active.operationId !== operation.operationId) {
      throw Object.assign(new Error("A newer login replaced this attempt."), {
        code: "AGENT_LOGIN_STALE",
      });
    }
    const availability = current.enabled === false
      ? agentProviderAvailabilityFromFailureReason(
        "disabled",
        current.availability,
        validDate(this.#clock),
      )
      : agentProviderAvailabilityFromDiagnostic(
        current.diagnostic || diagnosed?.diagnostic,
        current.availability,
        validDate(this.#clock),
      );
    this.#setAvailability(selection.providerId, availability);
    this.#patchProvider(selection.providerId, {
      ...finishProviderOperation(this.provider(selection), active, { state: "succeeded" }),
      loginUrlPresent: false,
      loginOpenError: null,
    });
    return diagnosed;
  }

  async copyGuidance(kind, selection = this.freezeSelected()) {
    const frozen = freezeAgentSelection(selection);
    const provider = this.provider(frozen);
    if (!provider || typeof provider.guidanceInstruction !== "function") {
      throw this.#unsupportedProvider(frozen.providerId);
    }
    if (!this.#handoffPort || typeof this.#handoffPort.copy !== "function") {
      throw new TypeError("Agent guidance requires a Handoff copy port.");
    }
    const result = await this.#handoffPort.copy({
      message: provider.guidanceInstruction(kind),
      run: null,
      purpose: `${provider.presentation.guidancePurposePrefix || "agent"}-${kind}-guidance`,
    });
    if (result?.status !== "copied" || result?.copied !== true) {
      throw Object.assign(new Error("Clipboard write was not confirmed."), {
        code: "AGENT_GUIDANCE_COPY_UNCONFIRMED",
      });
    }
    this.#setAvailability(frozen.providerId, agentProviderAvailabilityWithCopiedGuidance(
      provider.availability,
      kind,
      validDate(this.#clock),
    ));
    return Object.freeze({ kind, copied: true });
  }

  selectModel(modelId, expectedSelection = this.#selected) {
    if (!expectedSelection) return null;
    const expected = freezeAgentSelection(expectedSelection);
    const current = this.freezeProviderSelection(expected.providerId);
    if (!current || agentPreflightKey(current) !== agentPreflightKey(expected)) return null;
    const id = typeof modelId === "string" && modelId.trim()
      ? modelId.trim().slice(0, 80)
      : null;
    if (id && !id.startsWith(`${expected.providerId}:`)) return null;
    return this.configureProvider({
      ...expected,
      requestedModelId: id,
      resolvedModelId: id,
      reasoning: {
        requested: null,
        applied: null,
        resolution: "provider-default",
      },
    });
  }

  configureProvider(selection) {
    const frozen = freezeAgentSelection(selection);
    const provider = this.provider(frozen);
    if (!provider) throw this.#unsupportedProvider(frozen.providerId);
    this.#invalidateProvider(frozen.providerId);
    this.#providers.set(frozen.providerId, Object.freeze({ ...provider, selection: frozen }));
    if (this.#selected?.providerId === frozen.providerId) this.#selected = frozen;
    this.#publish();
    return frozen;
  }

  async saveConfiguration(intent = null) {
    await this.#preferencesLoaded;
    if (!this.#configurationPreferencesPort) return;
    const agentConfigurations = Object.fromEntries([...this.#providers].map(([id, provider]) => [id, {
      modelId: provider.selection.requestedModelId,
      reasoning: provider.selection.reasoning.requested,
    }]));
    const write = this.#configurationWrite.catch(() => {}).then(async () => {
      if (intent && !intent.isCurrent()) return null;
      return this.#configurationPreferencesPort.saveAgentConfigurations(agentConfigurations, intent);
    });
    this.#configurationWrite = write;
    const result = await write;
    if (intent && !intent.isCurrent()) {
      throw Object.assign(new Error("Agent configuration operation was superseded."), {
        code: "AGENT_PREFERENCES_SAVE_SUPERSEDED",
      });
    }
    const status = intent
      ? result?.status
      : result === true || result?.status === "committed" ? "committed" : "failed";
    if (status === "superseded") {
      throw Object.assign(new Error("Agent configuration operation was superseded."), {
        code: "AGENT_PREFERENCES_SAVE_SUPERSEDED",
      });
    }
    if (status === "unknown") {
      throw Object.assign(new Error("Agent configuration persistence is unconfirmed."), {
        code: "AGENT_PREFERENCES_SAVE_UNKNOWN",
      });
    }
    if (status === "failed" || !status) {
      throw Object.assign(new Error("Agent configuration was not persisted."), {
        code: "AGENT_PREFERENCES_SAVE_FAILED",
      });
    }
  }

  selectReasoning(reasoning, expectedSelection = this.#selected) {
    if (!expectedSelection) return null;
    const expected = freezeAgentSelection(expectedSelection);
    const current = this.freezeProviderSelection(expected.providerId);
    if (!current || agentPreflightKey(current) !== agentPreflightKey(expected)) return null;
    if (String(reasoning || "") === DEFAULT_OPENAI_COMPATIBLE_REASONING) {
      return this.configureProvider({
        ...expected,
        reasoning: {
          requested: null,
          applied: null,
          resolution: "provider-default",
        },
      });
    }
    const requested = normalizeOpenAiCompatibleReasoning(reasoning);
    if (!requested) return expected;
    return this.configureProvider({
      ...expected,
      reasoning: {
        requested,
        applied: requested,
        resolution: "exact",
      },
    });
  }

  noteRunFailure(selection, code) {
    if (!selection) return null;
    const frozen = freezeAgentSelection(selection);
    const provider = this.provider(frozen);
    if (!provider) return null;
    const availability = this.#setFailure(frozen, { code }, provider.availability);
    const normalizedCode = String(code || "AGENT_PROVIDER_UNAVAILABLE");
    const failure = diagnosticFailureUpdate(normalizedCode, "use");
    this.#setDiagnosticFacts(frozen.providerId, failure.facts, {
      readiness: failure.readiness,
      cause: normalizedCode,
    });
    return availability;
  }

  async connectWithApiKey(selection, apiKey, extras = {}) {
    const frozen = freezeAgentSelection(selection);
    const provider = this.provider(frozen);
    if (!provider) throw this.#unsupportedProvider(frozen.providerId);
    const updateConfiguration = typeof this.#bridgeClient.updateAgentConfiguration === "function"
      ? (body) => this.#bridgeClient.updateAgentConfiguration(body)
      : typeof this.#bridgeClient.setAgentSessionCredential === "function"
        ? (body) => this.#bridgeClient.setAgentSessionCredential(body)
        : null;
    if (!updateConfiguration) {
      throw Object.assign(new Error("API Token 无法保存。"), {
        code: "AGENT_SESSION_CREDENTIAL_UNSUPPORTED",
      });
    }
    // Candidate configuration edits invalidate every old renderer ticket at
    // the start of the transaction. Provider/model/readiness state is not
    // replaced unless the Bridge commits the candidate below.
    this.#invalidateProvider(frozen.providerId);
    const generation = this.#generationByProvider.get(frozen.providerId) || 1;
    this.#patchProvider(frozen.providerId, {
      activeOperation: createAccessOperation({
        providerId: frozen.providerId,
        kind: "config-validate",
        generation,
        startedAt: validDate(this.#clock),
      }),
    });
    const manualModelId = String(extras.modelId || "").trim().slice(0, 80);
    const nextModelId = manualModelId
      ? `${frozen.providerId}:${manualModelId.replace(/^stemmio:/u, "")}`
      : frozen.requestedModelId || frozen.resolvedModelId;
    const changedModel = Boolean(manualModelId && nextModelId !== (frozen.requestedModelId || frozen.resolvedModelId));
    const changedVendor = Boolean(provider.connection?.vendorId && extras.vendorId
      && provider.connection.vendorId !== extras.vendorId);
    const requestedSelection = freezeAgentSelection({
      ...frozen,
      requestedModelId: changedVendor && !manualModelId ? null : nextModelId,
      resolvedModelId: null,
      reasoning: changedModel || changedVendor
        ? { requested: null, applied: null, resolution: "provider-default" }
        : frozen.reasoning,
    });
    let result;
    try {
      result = await updateConfiguration({
        providerId: frozen.providerId,
        apiKey,
        vendorId: extras.vendorId || null,
        baseUrl: extras.baseUrl || null,
        selection: requestedSelection,
      });
    } catch (cause) {
      const current = this.provider(frozen);
      const operation = publicAccessOperation(current?.activeOperation);
      if (operation?.generation === generation
        && !["cancelled", "cancelling"].includes(operation.state)) {
        this.#patchProvider(frozen.providerId, finishProviderOperation(
          this.provider(frozen),
          operation,
          {
            state: String(cause?.code || "") === "AGENT_SESSION_CREDENTIAL_STALE"
              ? "cancelled"
              : "failed",
            errorCode: cause?.code || "AGENT_SESSION_CREDENTIAL_INVALID",
          },
        ));
      }
      throw cause;
    }
    const current = this.provider(frozen);
    const operation = publicAccessOperation(current?.activeOperation);
    if (this.#generationByProvider.get(frozen.providerId) !== generation
      || operation?.state === "cancelled") {
      throw Object.assign(new Error("更新的连接操作已取代本次结果。"), {
        code: "AGENT_SESSION_CREDENTIAL_STALE",
      });
    }
    if (result?.status !== "ready" || !result?.selection) {
      if (operation) {
        this.#patchProvider(frozen.providerId, finishProviderOperation(
          this.provider(frozen),
          operation,
          {
            state: "failed",
            errorCode: "AGENT_SESSION_CREDENTIAL_INVALID",
          },
        ));
      }
      throw Object.assign(new Error("API Token 没有返回可执行配置。"), {
        code: "AGENT_SESSION_CREDENTIAL_INVALID",
      });
    }
    const returnedSelection = freezeAgentSelection(result.selection);
    this.#invalidateProvider(frozen.providerId);
    if (this.#selected?.providerId === frozen.providerId) this.#selected = returnedSelection;
    const next = this.#providers.get(frozen.providerId);
    const checkedAt = validDate(this.#clock);
    const diagnostic = agentDiagnosticSnapshot({
      readiness: "ready",
      cause: null,
      operation: "diagnose",
      checkedAt,
      facts: {
        installation: { status: "configured", source: "preflight" },
        authentication: { status: "ready", source: "preflight" },
        protocol: { status: "ready", source: "preflight" },
        service: { status: "ready", source: "preflight" },
      },
    }, checkedAt, next?.diagnostic);
    this.#providers.set(frozen.providerId, Object.freeze({
      ...next,
      selection: returnedSelection,
      models: publicModels(result.models),
      credentialConfigured: true,
      connection: Object.freeze({
        vendorId: String(result.vendorId || extras.vendorId || ""),
        vendorDisplayName: String(result.vendorDisplayName || extras.vendorId || ""),
        baseUrl: String(result.baseUrl || extras.baseUrl || ""),
      }),
      availability: readyAgentProviderAvailability(checkedAt),
      diagnostic,
      installationDigest: String(result.installationDigest || "") || null,
      ...(operation ? finishProviderOperation(next, operation, { state: "succeeded" }) : {}),
    }));
    this.bindPendingDefaultSelection(returnedSelection);
    this.#publish();
    let configurationPersist = Object.freeze({ status: "saved", code: null });
    try {
      await this.saveConfiguration(
        extras.intentId && typeof extras.isCurrent === "function"
          ? Object.freeze({ intentId: extras.intentId, isCurrent: extras.isCurrent })
          : null,
      );
    } catch (cause) {
      configurationPersist = Object.freeze({
        status: "failed",
        code: cause?.code || "AGENT_PREFERENCES_SAVE_FAILED",
      });
    }
    return Object.freeze({ ...result, configurationPersist });
  }

  async disconnectApiKey(selection = this.freezeSelected(), { isCurrent = () => true } = {}) {
    const frozen = freezeAgentSelection(selection);
    const provider = this.provider(frozen);
    const updateConfiguration = typeof this.#bridgeClient.updateAgentConfiguration === "function"
      ? (body) => this.#bridgeClient.updateAgentConfiguration(body)
      : typeof this.#bridgeClient.setAgentSessionCredential === "function"
        ? (body) => this.#bridgeClient.setAgentSessionCredential(body)
        : null;
    if (!provider || !updateConfiguration) {
      throw this.#unsupportedProvider(frozen.providerId);
    }
    await updateConfiguration({
      providerId: frozen.providerId,
      disconnect: true,
    });
    if (!isCurrent()) {
      throw Object.assign(new Error("更新的连接操作已取代本次结果。"), {
        code: "AGENT_SESSION_CREDENTIAL_STALE",
      });
    }
    this.#invalidateProvider(frozen.providerId);
    const resetSelection = freezeAgentSelection({ ...provider.selection, resolvedModelId: null });
    if (this.#selected?.providerId === frozen.providerId) this.#selected = resetSelection;
    const checkedAt = validDate(this.#clock);
    this.#providers.set(frozen.providerId, Object.freeze({
      ...provider,
      selection: resetSelection,
      models: Object.freeze([]),
      credentialConfigured: false,
      connection: null,
      installationDigest: null,
      availability: agentProviderAvailabilityFromFailureReason(
        "auth-required",
        provider.availability,
        checkedAt,
      ),
      diagnostic: agentDiagnosticSnapshot({
        readiness: "auth-required",
        cause: "AGENT_AUTH_REQUIRED",
        operation: "diagnose",
        checkedAt,
        facts: {
          installation: { status: "configured", source: "use" },
          authentication: { status: "required", cause: "AGENT_AUTH_REQUIRED", source: "use" },
          protocol: { status: "unknown", source: "use" },
          service: { status: "unknown", source: "use" },
        },
      }, checkedAt),
    }));
    this.#publish();
    return Object.freeze({ configured: false });
  }

  #invalidateProvider(providerId) {
    this.#generationByProvider.set(
      providerId,
      (this.#generationByProvider.get(providerId) || 0) + 1,
    );
    this.#diagnoseGenerationByProvider.set(
      providerId,
      (this.#diagnoseGenerationByProvider.get(providerId) || 0) + 1,
    );
    for (const [key, inflight] of this.#inflightBySelection) {
      if (inflight.providerId === providerId) this.#inflightBySelection.delete(key);
    }
    for (const [key, inflight] of this.#diagnoseInflightBySelection) {
      if (inflight.providerId === providerId) this.#diagnoseInflightBySelection.delete(key);
    }
    for (const [key, preflight] of this.#preflightBySelection) {
      if (preflight?.selection?.providerId === providerId) this.#preflightBySelection.delete(key);
    }
  }

  #isSelected(selection) {
    return Boolean(
      this.#selected
      && agentPreflightKey(this.#selected) === agentPreflightKey(selection),
    );
  }

  #canProjectAvailability(selection) {
    return Boolean(
      !this.#selected
      || this.#selected.providerId !== selection.providerId
      || this.#isSelected(selection),
    );
  }

  #setProviderDigest(providerId, installationDigest) {
    const provider = this.#providers.get(providerId);
    if (!provider) return;
    this.#providers.set(providerId, Object.freeze({
      ...provider,
      installationDigest: installationDigest || null,
    }));
  }

  #patchProvider(providerId, patch) {
    const provider = this.#providers.get(providerId);
    if (!provider) return;
    this.#providers.set(providerId, Object.freeze({ ...provider, ...patch }));
    this.#publish();
  }

  #setDiagnosticFacts(providerId, facts, {
    publish = true,
    readiness = null,
    cause = undefined,
  } = {}) {
    const provider = this.#providers.get(providerId);
    if (!provider) return null;
    const previous = provider.diagnostic || agentDiagnosticSnapshot({
      readiness: "connection-failed",
      cause: "AGENT_DIAGNOSTIC_UNVERIFIED",
      operation: "diagnose",
    }, validDate(this.#clock));
    const diagnostic = agentDiagnosticSnapshot({
      ...previous,
      readiness: [
        "checking",
        "ready",
        "not-installed",
        "auth-required",
        "invalid-installation",
        "connection-failed",
      ].includes(readiness) ? readiness : previous.readiness,
      cause: cause === undefined ? previous.cause : cause,
      checkedAt: validDate(this.#clock),
      facts: { ...previous.facts, ...facts },
    }, validDate(this.#clock), previous);
    this.#providers.set(providerId, Object.freeze({ ...provider, diagnostic }));
    if (publish) this.#publish();
    return diagnostic;
  }

  async #applyPublicCatalog() {
    if (typeof this.#bridgeClient.agentProviders !== "function") return;
    const listed = await this.#bridgeClient.agentProviders().catch(() => null);
    const providers = Array.isArray(listed?.providers) ? listed.providers : [];
    for (const item of providers) {
      const providerId = String(item?.providerId || "");
      const current = this.#providers.get(providerId);
      if (!current) continue;
      this.#providers.set(providerId, Object.freeze({
        ...current,
        installable: item.installable === true,
        installSource: item.installSource === "user" || item.installSource === "managed"
          ? item.installSource
          : "none",
        installState: ["idle", "installing", "failed", "cancelling"].includes(item.installState)
          ? item.installState
          : current.installState || "idle",
        connection: projectListedConnection(current.connection, item.connection),
        loginUrlPresent: item.loginUrlPresent === true,
        ...projectAccessOperations({
          listedActive: item.activeOperation,
          listedLast: item.lastOperation,
          currentActive: current.activeOperation,
          currentLast: current.lastOperation,
        }),
      }));
    }
    this.#publish();
  }

  #setAvailability(providerId, availability) {
    const provider = this.#providers.get(providerId);
    if (!provider) return availability;
    this.#providers.set(providerId, Object.freeze({ ...provider, availability }));
    this.#publish();
    return availability;
  }

  #setFailure(selection, cause, previous) {
    const provider = this.provider(selection);
    const reason = provider?.failureReason?.(cause?.code) || "service-unavailable";
    return this.#setAvailability(selection.providerId, agentProviderAvailabilityFromFailureReason(
      reason,
      previous,
      validDate(this.#clock),
    ));
  }

  #unsupportedProvider(providerId) {
    return Object.assign(new Error(`Agent provider ${String(providerId || "unknown")} is unavailable.`), {
      code: "AGENT_PROVIDER_UNSUPPORTED",
    });
  }

  #publish() {
    if (this.#disposed) return;
    const state = this.getSnapshot();
    for (const listener of this.#listeners) {
      try {
        listener(state);
      } catch {
        // Observation cannot change catalog authority.
      }
    }
  }
}

export const AgentProviderCatalog = AgentCatalogState;

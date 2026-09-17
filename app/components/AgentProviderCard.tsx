"use client";

import { Fragment, useState, type Ref } from "react";
import { CodeIcon } from "@phosphor-icons/react/dist/csr/Code";
import { OpenAiLogoIcon } from "@phosphor-icons/react/dist/csr/OpenAiLogo";

import type {
  AgentProviderAvailabilitySnapshot,
  AgentDiagnosticSnapshot,
  AgentProviderGuidanceKind,
} from "../domain/agent-provider-state.js";
import { agentSetupRecovery } from "../domain/agent-provider-state.js";

type AgentActionOutcome = Readonly<{
  status: string;
  reason?: string;
  code?: string;
  persistFailed?: boolean;
}> | null | undefined;
type CardActionKind = AgentProviderGuidanceKind | "change-provider" | "recheck" | "cancel-install" | "api-key" | "model" | "reasoning" | "reopen-login";
type ApiKeyExtras = Readonly<{ vendorId?: string; baseUrl?: string; modelId?: string; remember?: boolean }>;
type ApiKeyField = "apiKey" | "baseUrl" | "modelId" | "form";
type VendorOption = Readonly<{
  id: string;
  label: string;
  needsBaseUrl?: boolean;
  compatibilityMode?: boolean;
}>;

export type AgentProviderCardPresentation = Readonly<{
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
    recheck?: Readonly<{ label: string; copiedLabel: string }>;
    apiKey?: Readonly<{ label: string; copiedLabel: string }>;
  }>;
  supportsApiKey?: boolean;
  credentialKind?: "api-token" | null;
  supportsSelectableModels?: boolean;
  vendors?: readonly VendorOption[];
}>;

export type AgentProviderCardProps = {
  availability: AgentProviderAvailabilitySnapshot;
  diagnostic?: AgentDiagnosticSnapshot | null;
  installState?: "idle" | "installing" | "failed" | "cancelling";
  activeOperation?: Readonly<{
    kind: string;
    state: string;
  }> | null;
  loginUrlPresent?: boolean;
  loginOpenError?: string | null;
  connection?: Readonly<{
    vendorId?: string;
    vendorDisplayName?: string;
    baseUrl?: string;
    authSource?: string | null;
    authScope?: string | null;
  }> | null;
  models?: readonly Readonly<{
    id: string;
    displayName: string;
    reasoningChoices?: readonly Readonly<{ id: string; label: string }>[];
  }>[];
  selectedModelId?: string | null;
  selectedReasoningId?: string | null;
  presentation: AgentProviderCardPresentation;
  surface: "delivery" | "about" | "settings";
  disabled?: boolean;
  actionButtonRef?: Ref<HTMLButtonElement>;
  onCopyGuidance: (kind: AgentProviderGuidanceKind) => Promise<AgentActionOutcome>;
  onStartLogin?: () => Promise<AgentActionOutcome>;
  onReopenLogin?: () => Promise<AgentActionOutcome>;
  onInstall?: () => Promise<AgentActionOutcome>;
  onCancelInstall?: () => Promise<AgentActionOutcome>;
  onRecheck?: () => Promise<AgentActionOutcome>;
  onUseOtherProvider?: () => void;
  onConnectApiKey?: (apiKey: string, extras?: ApiKeyExtras) => Promise<AgentActionOutcome>;
  onRetryPersistCredential?: () => Promise<AgentActionOutcome>;
  onDisconnectApiKey?: () => Promise<AgentActionOutcome>;
  onOpenVendorApiKeyPage?: (vendorId: string) => Promise<AgentActionOutcome>;
  onSelectModel?: (modelId: string) => Promise<AgentActionOutcome>;
  onSelectReasoning?: (reasoning: string) => Promise<AgentActionOutcome>;
  hideDisconnectAction?: boolean;
  initialApiKeyOpen?: boolean;
  credentialPersist?: Readonly<{
    status?: string;
    reason?: string | null;
    operationId?: string | null;
    recordId?: string | null;
    code?: string | null;
  }> | null;
};

type CardAction = Readonly<{
  kind: CardActionKind;
  label: string;
  copiedLabel: string;
}>;

function fieldForConnectError(code: string | undefined): ApiKeyField {
  switch (String(code || "")) {
    case "AGENT_AUTH_REQUIRED":
    case "AGENT_SESSION_CREDENTIAL_INVALID":
      return "apiKey";
    case "AGENT_SELECTION_UNSUPPORTED":
    case "AGENT_MODEL_ACCESS_DENIED":
      return "modelId";
    case "AGENT_ENDPOINT_REGION_MISMATCH":
      return "baseUrl";
    default:
      return "form";
  }
}

function actionsForAvailability(
  availability: AgentProviderAvailabilitySnapshot,
  presentation: AgentProviderCardPresentation,
): CardAction[] {
  if (availability.status === "not-installed") {
    return [{ kind: "install", ...presentation.actions.install }];
  }
  if (availability.status === "auth-required") {
    if (presentation.credentialKind === "api-token") {
      return [{ kind: "api-key", label: "连接", copiedLabel: "连接" }];
    }
    return [{ kind: "login", ...presentation.actions.login }];
  }
  if (availability.status === "unavailable" && [
    "invalid-installation",
    "restart-required",
  ].includes(String(availability.reason || ""))) {
    return [{ kind: "install", label: "修复", copiedLabel: "修复" }];
  }
  if (availability.status === "unavailable") {
    return [{
      kind: "recheck" as const,
      ...(presentation.actions.recheck || { label: "重试", copiedLabel: "重试" }),
    }];
  }
  return [];
}

export default function AgentProviderCard({
  availability,
  diagnostic = null,
  installState = "idle",
  activeOperation = null,
  loginUrlPresent = false,
  loginOpenError = null,
  connection = null,
  models = [],
  selectedModelId = null,
  selectedReasoningId = null,
  presentation: provider,
  surface,
  disabled = false,
  actionButtonRef,
  onCopyGuidance,
  onStartLogin,
  onReopenLogin,
  onInstall,
  onCancelInstall,
  onRecheck,
  onUseOtherProvider,
  onConnectApiKey,
  onDisconnectApiKey,
  onOpenVendorApiKeyPage,
  onSelectModel,
  onSelectReasoning,
  hideDisconnectAction = false,
  initialApiKeyOpen = false,
  credentialPersist = null,
  onRetryPersistCredential,
}: AgentProviderCardProps) {
  const [pendingAction, setPendingAction] = useState<CardActionKind | null>(null);
  const [installPending, setInstallPending] = useState(false);
  const [cancelPending, setCancelPending] = useState(false);
  const [cancelRequested, setCancelRequested] = useState(false);
  const [actionError, setActionError] = useState("");
  const [checkReceipt, setCheckReceipt] = useState("");
  const [fieldError, setFieldError] = useState<ApiKeyField | "model" | "reasoning" | "">("");
  const [apiKeyOpen, setApiKeyOpen] = useState(initialApiKeyOpen);
  const [apiKey, setApiKey] = useState("");
  const [rememberKey, setRememberKey] = useState(false);
  const [vendorId, setVendorId] = useState(connection?.vendorId || provider.vendors?.[0]?.id || "deepseek");
  const [baseUrl, setBaseUrl] = useState(connection?.vendorId === "custom" ? connection.baseUrl || "" : "");
  const [modelId, setModelId] = useState(
    connection?.vendorId === "custom"
      ? String(selectedModelId || models[0]?.id || "").replace(/^stemmio:/u, "")
      : "",
  );
  const persistFailed = credentialPersist?.status === "failed" || credentialPersist?.status === "unknown";
  const persistReason = persistFailed
    ? (credentialPersist?.reason || "已连接，但新的 API Key 未保存。")
    : "";
  const credentialRestoreFailed = persistReason.startsWith("无法读取已保存的连接凭证");
  const formError = persistReason || actionError;
  const formFieldError = persistFailed ? "form" : fieldError;
  const recovery = provider.credentialKind === "api-token" ? null : agentSetupRecovery(diagnostic, availability);
  const presentation = recovery || provider.availability(availability);
  const installing = installState === "installing" || installPending;
  const stopUnconfirmed = activeOperation?.state === "stop-unconfirmed";
  const loggingIn = activeOperation?.kind === "login"
    && (activeOperation.state === "waiting" || activeOperation.state === "cancelling" || pendingAction === "login");
  const cancelling = installState === "cancelling"
    || (activeOperation?.kind === "login" && activeOperation.state === "cancelling")
    || cancelPending;
  const statusPresentation = stopUnconfirmed
    ? {
      ...presentation,
      statusLabel: "尚未确认操作已停止",
      detail: "只有确认停止后才能开始下一次登录或退出。",
      tone: "attention" as const,
    }
    : (installing || loggingIn) && !cancelling
    ? {
      ...presentation,
      statusLabel: loggingIn ? "请在浏览器完成登录" : "正在安装…",
      detail: "",
      tone: "checking" as const,
    }
    : cancelling
      ? { ...presentation, statusLabel: "正在取消…", detail: "", tone: "checking" as const }
      : presentation;
  const currentModel = models.find((model) => model.id === selectedModelId) || models[0] || null;
  const tokenFormOpen = provider.credentialKind === "api-token"
    && (availability.status === "auth-required" || apiKeyOpen || persistFailed);
  const actions = stopUnconfirmed
    ? [{ kind: "cancel-install" as const, label: "重试停止", copiedLabel: "重试停止" }]
    : installing || cancelling
    ? [{ kind: "cancel-install" as const, label: "取消", copiedLabel: "取消" }]
    : loggingIn
      ? [
        { kind: "cancel-install" as const, label: "取消", copiedLabel: "取消" },
        ...(onReopenLogin
          ? [{
            kind: "reopen-login" as const,
            label: loginUrlPresent ? "重新打开登录页" : "打开登录页",
            copiedLabel: "重新打开登录页",
          }]
          : []),
      ]
      : (recovery ? [
        { kind: recovery.action, label: recovery.actionLabel, copiedLabel: recovery.actionLabel },
        ...(recovery.allowRecheck ? [{ kind: "recheck" as const, label: "重新检查", copiedLabel: "重新检查" }] : []),
        ...(recovery.allowLogin ? [{ kind: "login" as const, label: "重新登录", copiedLabel: "重新登录" }] : []),
      ] : actionsForAvailability(availability, provider)).filter((action) => !(
        action.kind === "api-key"
        && (
          tokenFormOpen
          || (
            availability.reason === "model-unavailable"
            && connection
            && models.length > 1
          )
        )
      ));
  const checking = availability.status === "checking";
  const selectedVendor = provider.vendors?.find((vendor) => vendor.id === vendorId)
    || provider.vendors?.[0]
    || null;
  const primaryActionData = provider.primaryActionDataAttribute
    ? { [provider.primaryActionDataAttribute]: "true" }
    : {};

  const runAction = async (kind: CardActionKind) => {
    if (disabled) return;
    setFieldError("");
    if (kind === "change-provider") {
      onUseOtherProvider?.();
      return;
    }
    if (kind === "cancel-install") {
      if (cancelPending || cancelRequested || typeof onCancelInstall !== "function") return;
      setCancelRequested(true);
      setCancelPending(true);
      setActionError("");
      let confirmed = false;
      try {
        const outcome = await onCancelInstall();
        confirmed = Boolean(outcome && ["succeeded", "stale"].includes(outcome.status));
        if (!confirmed) {
          setActionError(loggingIn ? "登录没有取消，请重试。" : "安装没有取消，请重试。");
        }
      } catch {
        setActionError(loggingIn ? "登录没有取消，请重试。" : "安装没有取消，请重试。");
      } finally {
        setCancelPending(false);
        setCancelRequested(false);
      }
      return;
    }
    if (kind === "reopen-login") {
      if (pendingAction === "reopen-login" || typeof onReopenLogin !== "function") return;
      setPendingAction("reopen-login");
      setActionError("");
      try {
        const outcome = await onReopenLogin();
        if (!outcome || outcome.status !== "succeeded") {
          setActionError(outcome?.reason || "官方登录页没有打开。");
        }
      } catch {
        setActionError("官方登录页暂时无法打开。");
      } finally {
        setPendingAction(null);
      }
      return;
    }
    if (kind === "install") {
      if (installPending || pendingAction || typeof onInstall !== "function") return;
      setCancelRequested(false);
      setInstallPending(true);
      setActionError("");
      try {
        const outcome = await onInstall();
        if (!outcome || !["succeeded", "stale"].includes(outcome.status)) {
          setActionError("安装没有完成，请重试。");
        }
      } catch {
        setActionError("安装没有完成，请重试。");
      } finally {
        setInstallPending(false);
        setCancelRequested(false);
      }
      return;
    }
    if (pendingAction || installPending || cancelPending) return;
    if (kind === "api-key") {
      setApiKeyOpen((open) => !open);
      setActionError("");
      return;
    }
    setPendingAction(kind);
    setActionError("");
    setCheckReceipt("");
    try {
      const outcome = kind === "recheck" && typeof onRecheck === "function"
          ? await onRecheck()
          : kind === "login"
            ? await (typeof onStartLogin === "function" ? onStartLogin() : onCopyGuidance(kind))
            : null;
      const succeeded = Boolean(outcome && ["succeeded", "stale"].includes(outcome.status));
      if (succeeded && kind === "recheck" && outcome?.status === "succeeded") {
        setCheckReceipt("刚刚检查：服务可以使用。");
      }
      if (!succeeded) {
        setActionError(
          outcome?.reason || (kind === "recheck"
              ? "检查没有完成，请重试。"
              : kind === "login"
                ? "登录没有完成，请重试。"
                : "指令暂时无法复制，请重试。"),
        );
      }
    } catch {
      setActionError(
        kind === "recheck"
            ? "检查没有完成，请重试。"
            : kind === "login"
              ? "登录没有完成，请重试。"
              : "指令暂时无法复制，请重试。",
      );
    } finally {
      setPendingAction(null);
    }
  };

  const connectApiKey = async () => {
    if (pendingAction || disabled || !apiKey.trim() || typeof onConnectApiKey !== "function") return;
    if (selectedVendor?.needsBaseUrl && !baseUrl.trim()) {
      setFieldError("baseUrl");
      setActionError("请填写接口地址。");
      return;
    }
    if (selectedVendor?.needsBaseUrl && !modelId.trim()) {
      setFieldError("modelId");
      setActionError("请填写 Model ID。");
      return;
    }
    setPendingAction("api-key");
    setActionError("");
    setFieldError("");
    try {
      const outcome = await onConnectApiKey(apiKey, {
        vendorId: selectedVendor?.id || vendorId,
        baseUrl: selectedVendor?.needsBaseUrl ? baseUrl : undefined,
        modelId: modelId.trim() || undefined,
        remember: rememberKey,
      });
      const succeeded = Boolean(outcome && ["succeeded", "stale"].includes(outcome.status));
      if (!succeeded) {
        const message = outcome?.reason || "API Key 无效或已失效。";
        setFieldError(fieldForConnectError(outcome?.code));
        setActionError(message);
        return;
      }
      if (outcome?.persistFailed || outcome?.reason) {
        setFieldError("form");
        setActionError(outcome.reason || "已连接，但新的 API Key 未保存。");
        return;
      }
      setApiKey("");
      setModelId("");
      setRememberKey(false);
      setApiKeyOpen(false);
    } catch {
      setFieldError("form");
      setActionError("连接中断，请重试。");
    } finally {
      setPendingAction(null);
    }
  };

  const cancelConnectApiKey = async () => {
    if (typeof onCancelInstall !== "function") return;
    setCancelPending(true);
    try {
      await onCancelInstall();
    } catch {
      setFieldError("form");
      setActionError("连接验证没有取消，请重试。");
    } finally {
      setCancelPending(false);
      setPendingAction(null);
    }
  };

  const openVendorKeyPage = async () => {
    const id = selectedVendor?.id || vendorId;
    if (!id || typeof onOpenVendorApiKeyPage !== "function") return;
    setActionError("");
    setFieldError("");
    try {
      const outcome = await onOpenVendorApiKeyPage(id);
      if (outcome && !["succeeded", "stale"].includes(outcome.status)) {
        setFieldError("form");
        setActionError(outcome.reason || "无法打开获取 API Key 页面。");
      }
    } catch {
      setFieldError("form");
      setActionError("无法打开获取 API Key 页面。");
    }
  };

  const disconnectApiKey = async () => {
    if (pendingAction || disabled || typeof onDisconnectApiKey !== "function") return;
    setPendingAction("api-key");
    setFieldError("");
    setActionError("");
    try {
      const outcome = await onDisconnectApiKey();
      if (!outcome || !["succeeded", "stale"].includes(outcome.status)) {
        setActionError(outcome?.reason || "断开连接没有完成。");
      } else {
        setApiKeyOpen(false);
        setApiKey("");
        setModelId("");
      }
    } catch {
      setActionError("断开连接没有完成。");
    } finally {
      setPendingAction(null);
    }
  };

  const selectModel = async (nextModelId: string) => {
    if (pendingAction || disabled || !nextModelId || typeof onSelectModel !== "function") return;
    setPendingAction("model");
    setFieldError("model");
    setActionError("");
    try {
      const outcome = await onSelectModel(nextModelId);
      if (!outcome || !["succeeded", "stale"].includes(outcome.status)) {
        setActionError(outcome?.reason || "模型没有切换成功，请重试。");
      }
    } catch {
      setActionError("模型没有切换成功，请重试。");
    } finally {
      setPendingAction(null);
    }
  };

  const selectReasoning = async (nextReasoning: string) => {
    if (pendingAction || disabled || !nextReasoning || typeof onSelectReasoning !== "function") return;
    setPendingAction("reasoning");
    setFieldError("reasoning");
    setActionError("");
    try {
      const outcome = await onSelectReasoning(nextReasoning);
      if (!outcome || outcome.status !== "succeeded") {
        setActionError(outcome?.reason || "思考深度没有切换成功，请重试。");
      }
    } catch {
      setActionError("思考深度没有切换成功，请重试。");
    } finally {
      setPendingAction(null);
    }
  };

  return (
    <section
      className={provider.cardClassName}
      data-status={availability.status}
      data-surface={surface}
      data-tone={statusPresentation.tone}
      aria-busy={checking || installing || cancelling || Boolean(pendingAction)}
    >
      {surface !== "settings" || actions.length > 0 || statusPresentation.detail || (actionError && !fieldError) || loginOpenError || checkReceipt ? <div className="qoder-card-summary">
        {surface === "settings" ? null : (
          <span
            className="qoder-card-brand"
            data-fallback={!provider.logoSrc && provider.brandIcon !== "openai" ? "true" : undefined}
            aria-hidden="true"
          >
            {provider.logoSrc ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={provider.logoSrc} alt="" />
            ) : provider.brandIcon === "openai" ? (
              <OpenAiLogoIcon size={22} weight="regular" />
            ) : (
              <CodeIcon size={22} weight="bold" />
            )}
          </span>
        )}
        {surface !== "settings" || statusPresentation.detail ? <span className="qoder-card-copy">
          {surface === "settings" ? null : <strong>{provider.displayName}</strong>}
          {statusPresentation.detail ? <small>{statusPresentation.detail}</small> : null}
        </span> : null}
        <span className="qoder-card-control">
          {surface !== "settings" ? <span
            className="qoder-card-status"
            data-tone={statusPresentation.tone}
            aria-live="polite"
            aria-atomic="true"
          >
            <i aria-hidden="true" />
            {statusPresentation.statusLabel.replace(`${provider.displayName} · `, "")}
          </span> : null}
          {actions.map((action, index) => {
            const copied = action.kind === "login" || action.kind === "install"
              ? availability.guidanceCopied === action.kind
              : false;
            const label = copied ? action.copiedLabel : action.label;
            const busy = action.kind === "cancel-install"
              ? cancelPending
              : action.kind === "install" ? installPending : pendingAction === action.kind;
            const actionDisabled = disabled
              || (action.kind === "cancel-install"
                ? cancelling
                : action.kind === "reopen-login"
                  ? pendingAction === "reopen-login" || cancelling
                  : Boolean(pendingAction) || installPending || cancelPending);
            return (
              <button
                key={action.kind}
                ref={index === 0 ? actionButtonRef : undefined}
                type="button"
                className={`agent-control-button${index > 0 ? " agent-control-secondary" : ""}`}
                data-kind={action.kind}
                {...(index === 0 ? primaryActionData : {})}
                disabled={actionDisabled}
                aria-label={cancelling && action.kind === "cancel-install"
                  ? "正在取消…"
                  : installing && action.kind === "cancel-install"
                    ? "取消"
                    : installing && action.kind === "install" ? "正在安装…" : label}
                onClick={() => void runAction(action.kind)}
              >
                {busy
                  ? (action.kind === "cancel-install"
                    ? "正在取消…"
                    : action.kind === "install"
                    ? "正在安装…"
                    : action.kind === "reopen-login"
                      ? "正在打开…"
                    : action.kind === "login"
                      ? "正在登录…"
                    : action.kind === "recheck"
                      ? "正在检查…"
                      : "正在复制…")
                  : label}
              </button>
            );
          })}
          {connection && onDisconnectApiKey && !hideDisconnectAction ? (
            <button
              type="button"
              data-kind="disconnect"
              className="agent-control-button agent-control-secondary"
              disabled={Boolean(pendingAction) || disabled}
              onClick={() => void disconnectApiKey()}
            >
              {pendingAction === "api-key" && !apiKeyOpen ? "正在断开…" : "断开连接"}
            </button>
          ) : null}
          {checkReceipt ? <span role="status">{checkReceipt}</span> : null}
          {actionError && !tokenFormOpen && !fieldError ? (
            <span className="qoder-card-error" role="alert">{actionError}</span>
          ) : loginOpenError && loggingIn ? (
            <span className="qoder-card-error" role="alert">{loginOpenError}</span>
          ) : null}
        </span>
      </div> : null}
      {connection?.vendorId === "custom" && surface !== "settings" ? (
        <p className="qoder-card-connection" data-testid="settings-agent-current-connection">
          当前连接：{connection.vendorDisplayName || connection.vendorId}
          {currentModel ? ` · ${currentModel.displayName}` : ""}
          {connection.vendorId === "custom" && connection.baseUrl ? ` · ${connection.baseUrl}` : ""}
        </p>
      ) : null}
          {availability.status === "ready" && models.length > 1 && onSelectModel ? (
            <label className="qoder-card-model-choice">
              <span>当前模型</span>
          <select
            aria-label="当前模型"
            aria-invalid={fieldError === "model" && Boolean(actionError) || undefined}
            value={selectedModelId || models[0]?.id || ""}
                    disabled={Boolean(pendingAction) || disabled}
            onChange={(event) => void selectModel(event.target.value)}
          >
            {models.map((model) => (
              <option key={model.id} value={model.id}>{model.displayName || model.id}</option>
            ))}
          </select>
          {fieldError === "model" && actionError ? <span className="qoder-card-error" role="alert">{actionError}</span> : null}
        </label>
      ) : null}
      {(currentModel?.reasoningChoices?.length || 0) > 1 && onSelectReasoning ? (
        <div className="qoder-card-advanced">
          <label className="qoder-card-model-choice">
            <span>思考深度</span>
            <select
              aria-label="思考深度"
              aria-invalid={fieldError === "reasoning" && Boolean(actionError) || undefined}
              value={selectedReasoningId || "auto"}
              disabled={Boolean(pendingAction) || disabled}
              onChange={(event) => void selectReasoning(event.target.value)}
            >
              {currentModel?.reasoningChoices?.map((choice) => (
                <option key={choice.id} value={choice.id}>{choice.label}</option>
              ))}
            </select>
            {fieldError === "reasoning" && actionError ? <span className="qoder-card-error" role="alert">{actionError}</span> : null}
          </label>
        </div>
      ) : null}
      {provider.credentialKind === "api-token" && connection ? (
        <div className="qoder-card-credential-summary" data-testid="agent-credential-summary">
          <span>API Key</span>
          <span>{credentialPersist?.status === "saved" ? "已在此 Mac 保存"
            : credentialPersist?.status === "failed" ? "保存失败，本次仍可使用"
              : credentialPersist?.status === "pending" ? "正在保存…"
                : credentialPersist?.status === "skipped" ? "仅本次使用" : "保存状态未确认"}</span>
          {provider.supportsApiKey && onConnectApiKey ? (
            <button className="agent-control-button agent-control-secondary" type="button" data-kind="api-key"
              disabled={Boolean(pendingAction) || disabled}
              onClick={() => { setApiKeyOpen((open) => !open); setActionError(""); }}>
              {apiKeyOpen ? "收起配置" : "更换 API Key"}
            </button>
          ) : null}
        </div>
      ) : null}
      {tokenFormOpen ? (
        <form
          className="qoder-card-apikey"
          onSubmit={(event) => {
            event.preventDefault();
            void connectApiKey();
          }}
        >
          <p className="qoder-card-apikey-title">
            连接 {selectedVendor?.label || "DeepSeek"}
          </p>
          <div className="qoder-card-apikey-key-row">
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder="API Key"
              aria-label="API Key"
              aria-invalid={fieldError === "apiKey" || undefined}
              value={apiKey}
              disabled={Boolean(pendingAction) || disabled}
              onChange={(event) => {
                setApiKey(event.target.value);
                if (fieldError === "apiKey") {
                  setFieldError("");
                  setActionError("");
                }
              }}
            />
            {onOpenVendorApiKeyPage && selectedVendor?.id && selectedVendor.id !== "custom" ? (
              <button
                type="button"
                className="qoder-card-apikey-get agent-control-button agent-control-secondary"
                disabled={Boolean(pendingAction) || disabled}
                onClick={() => void openVendorKeyPage()}
              >
                获取 API Key
              </button>
            ) : null}
          </div>
          {fieldError === "apiKey" && actionError ? (
            <span className="qoder-card-error" role="alert">{actionError}</span>
          ) : null}
          {provider.vendors && provider.vendors.length > 1 ? (
            <details className="qoder-card-apikey-vendors">
              <summary>其他服务商</summary>
              <select
                className="qoder-card-apikey-vendor"
                aria-label="服务商"
                data-testid="settings-agent-vendor"
                value={selectedVendor?.id || vendorId}
                disabled={Boolean(pendingAction) || disabled}
                onChange={(event) => {
                  setVendorId(event.target.value);
                  setBaseUrl("");
                  setModelId("");
                  setActionError("");
                  setFieldError("");
                }}
              >
                {provider.vendors.map((vendor) => (
                  <option key={vendor.id} value={vendor.id}>{vendor.label}</option>
                ))}
              </select>
            </details>
          ) : null}
          {selectedVendor?.needsBaseUrl ? (
            <input
              className="qoder-card-apikey-base"
              type="url"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              placeholder="https://api.example.com/v1"
              aria-label="接口地址"
              aria-invalid={fieldError === "baseUrl" || undefined}
              value={baseUrl}
              disabled={Boolean(pendingAction) || disabled}
              onChange={(event) => {
                setBaseUrl(event.target.value);
                if (fieldError === "baseUrl") {
                  setFieldError("");
                  setActionError("");
                }
              }}
            />
          ) : null}
          {fieldError === "baseUrl" && actionError ? (
            <span className="qoder-card-error" role="alert">{actionError}</span>
          ) : null}
          {selectedVendor?.needsBaseUrl ? (
            <input
              className="qoder-card-apikey-model"
              type="text"
              autoComplete="off"
              spellCheck={false}
              placeholder="Model ID"
              aria-label="Model ID"
              aria-invalid={fieldError === "modelId" || undefined}
              value={modelId}
              disabled={Boolean(pendingAction) || disabled}
              onChange={(event) => {
                setModelId(event.target.value);
                if (fieldError === "modelId") {
                  setFieldError("");
                  setActionError("");
                }
              }}
            />
          ) : null}
          {fieldError === "modelId" && actionError ? (
            <span className="qoder-card-error" role="alert">{actionError}</span>
          ) : null}
          <label className="qoder-card-apikey-remember">
            <input
              type="checkbox"
              checked={rememberKey}
              disabled={Boolean(pendingAction) || disabled}
              onChange={(event) => setRememberKey(event.target.checked)}
            />
            在此 Mac 上记住 API Key
          </label>
          <p className="qoder-card-apikey-note">连接验证可能产生少量 API 费用。</p>
          <button
            type="submit"
            className="agent-control-button"
            disabled={Boolean(pendingAction) || disabled || !apiKey.trim()}
          >
            {pendingAction === "api-key" ? "正在连接…" : credentialRestoreFailed ? "重新连接" : "连接"}
          </button>
          {pendingAction === "api-key" && onCancelInstall ? (
            <button
              type="button"
              data-kind="cancel-validate"
              className="agent-control-button agent-control-secondary"
              disabled={cancelPending || disabled}
              onClick={() => void cancelConnectApiKey()}
            >
              {cancelPending ? "正在取消…" : "取消"}
            </button>
          ) : null}
          {formError && (formFieldError === "form" || !formFieldError) ? (
            <span className="qoder-card-error" role="alert">{formError}</span>
          ) : null}
          {persistFailed && onRetryPersistCredential ? (
            <button
              type="button"
              data-kind="retry-persist"
              className="agent-control-button"
              disabled={Boolean(pendingAction) || disabled}
              onClick={() => {
                void (async () => {
                  setPendingAction("api-key");
                  try {
                    const outcome = await onRetryPersistCredential();
                    if (!outcome || !["succeeded", "stale"].includes(outcome.status) || outcome.persistFailed) {
                      setFieldError("form");
                      setActionError(outcome?.reason || "已连接，但新的 API Key 未保存。");
                    }
                  } finally {
                    setPendingAction(null);
                  }
                })();
              }}
            >
              {pendingAction === "api-key" ? "正在保存…" : "重试保存"}
            </button>
          ) : null}
          {connection ? (
            <span className="qoder-card-apikey-note">新配置验证成功后才会替换当前连接。</span>
          ) : null}
        </form>
      ) : null}
      {provider.credentialKind === "api-token" ? (
        <p className="qoder-card-token-note">
          {`任务内容会发送给${selectedVendor?.label || "所选厂商"}，API 费用由厂商收取。`}
        </p>
      ) : null}
      {diagnostic && surface === "settings" ? (
        <details className="agent-diagnostic-details" data-testid="agent-diagnostic-details">
          <summary>查看检查详情</summary>
          <dl>
            {([ ["installation", "安装"], ["authentication", "登录"], ["protocol", "连接"], ["service", "服务"] ] as const).map(([key, label]) => (
              <Fragment key={key}><dt>{label}</dt><dd>{({ ready: "通过", configured: "已配置", missing: "未安装", invalid: "无效", required: "需要登录", failed: "未通过", unavailable: "不可用", unknown: "未确认" })[diagnostic.facts[key].status]}</dd></Fragment>
            ))}
            <dt>检查时间</dt><dd>{diagnostic.checkedAt ? new Date(diagnostic.checkedAt).toLocaleString() : "未检查"}</dd>
            {diagnostic.cause ? <><dt>错误码</dt><dd>{diagnostic.cause}</dd></> : null}
            {diagnostic.diagnosticId ? <><dt>诊断编号</dt><dd>{diagnostic.diagnosticId}</dd></> : null}
            {diagnostic.configurationGeneration !== undefined ? <><dt>配置代次</dt><dd>{diagnostic.configurationGeneration}</dd></> : null}
          </dl>
        </details>
      ) : null}
    </section>
  );
}

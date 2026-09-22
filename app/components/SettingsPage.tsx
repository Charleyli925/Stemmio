"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type Ref,
  type ReactNode,
} from "react";
import { ArrowClockwiseIcon } from "@phosphor-icons/react/dist/csr/ArrowClockwise";
import { ArrowSquareOutIcon } from "@phosphor-icons/react/dist/csr/ArrowSquareOut";
import { CloudArrowUpIcon } from "@phosphor-icons/react/dist/csr/CloudArrowUp";
import { DesktopIcon } from "@phosphor-icons/react/dist/csr/Desktop";
import { EyeIcon } from "@phosphor-icons/react/dist/csr/Eye";
import { ChatCircleDotsIcon } from "@phosphor-icons/react/dist/csr/ChatCircleDots";
import { FolderOpenIcon } from "@phosphor-icons/react/dist/csr/FolderOpen";
import { InfoIcon } from "@phosphor-icons/react/dist/csr/Info";
import { OpenAiLogoIcon } from "@phosphor-icons/react/dist/csr/OpenAiLogo";
import { CodeIcon } from "@phosphor-icons/react/dist/csr/Code";
import { SparkleIcon } from "@phosphor-icons/react/dist/csr/Sparkle";
import { SidebarSimpleIcon } from "@phosphor-icons/react/dist/csr/SidebarSimple";

import type {
  AgentProviderGuidanceKind,
  AgentSelection,
} from "../domain/agent-provider-state.js";
import { BoundAgentSetupPanel, type BoundAgentSetupPanelProps } from "./AgentSetupPanel";
import { agentSetupRecovery, agentSetupOperationLabel } from "../domain/agent-provider-state.js";
import type { AgentProviderCardData } from "./agent-provider-card-types";
import { agentServiceLabel } from "../application/workspace-agent-preference.js";
import type { ApplicationUpdateResult } from "../workbench/types";
import type { WorkspacePreferences } from "./desktop-ui-preferences-api";
import type { SettingsCategory } from "../workbench/settings-types";
import { architectureLabel, updatePresentation } from "./update-presentation";
import { settingsCredentialRemoveAction } from "./settings-agent-action-gate";

type AgentActionOutcome = Readonly<{ status: string; reason?: string; code?: string }> | null | undefined;

const DEFAULT_PANEL_WIDTHS = Object.freeze({
  sidebarWidth: 264,
  inspectorWidth: 376,
});

export type SettingsAgentChoice = Readonly<{
  id: string;
  label: string;
  selection: AgentSelection;
}>;

export type SettingsPageProps = {
  activeTabId: string;
  category: SettingsCategory;
  initialFocus?: SettingsCategory;
  appVersion: string;
  currentAgentName: string;
  updateResult: ApplicationUpdateResult | null;
  updatesAvailable: boolean;
  manualCheckPending: boolean;
  manualCheckFailed: boolean;
  releaseNotesOpenFailed: boolean;
  workspacePreferences: WorkspacePreferences;
  workspacePreferencesSaving: boolean;
  workspacePreferencesError: string | null;
  agentChoices: readonly SettingsAgentChoice[];
  selectedAgentChoiceId: string | null;
  agentCards: readonly AgentProviderCardData[];
  onUpdateWorkspacePreference: (
    patch: Partial<WorkspacePreferences>,
  ) => Promise<boolean>;
  onRetryWorkspacePreferences: () => void;
  onSelectAgent: (selection: AgentSelection) => void;
  onSelectAgentModel: BoundAgentSetupPanelProps["onSelectAgentModel"];
  onSelectAgentReasoning: BoundAgentSetupPanelProps["onSelectAgentReasoning"];
  onCheckForUpdates: () => void;
  onDownloadUpdate: () => void;
  onRequestRestart: () => void;
  onOpenReleaseNotes: () => void;
  onCheckUsability: (selection: AgentSelection) => Promise<AgentActionOutcome>;
  onCopyGuidance: (
    kind: AgentProviderGuidanceKind,
    selection: AgentSelection,
  ) => Promise<AgentActionOutcome>;
  onStartLogin: (selection: AgentSelection) => Promise<AgentActionOutcome>;
  onReopenLogin?: (selection: AgentSelection) => Promise<AgentActionOutcome>;
  onLogoutAgent?: (selection: AgentSelection) => Promise<AgentActionOutcome>;
  onInstall: (selection: AgentSelection) => Promise<AgentActionOutcome>;
  onCancelInstall: (selection: AgentSelection) => Promise<AgentActionOutcome>;
  onConnectApiKey: (
    selection: AgentSelection,
    apiKey: string,
    extras?: Readonly<{ vendorId?: string; baseUrl?: string; modelId?: string; remember?: boolean }>,
  ) => Promise<AgentActionOutcome>;
  onRetryPersistCredential?: (selection: AgentSelection) => Promise<AgentActionOutcome>;
  onDisconnectApiKey: (selection: AgentSelection) => Promise<AgentActionOutcome>;
  onDisconnectProvider?: (
    selection: AgentSelection,
    options?: Readonly<{ stopRun?: boolean }>,
  ) => Promise<AgentActionOutcome>;
  onRemoveRememberedKey?: (
    selection: AgentSelection,
    options?: Readonly<{ stopRun?: boolean }>,
  ) => Promise<AgentActionOutcome>;
  onReconnectProvider?: (selection: AgentSelection) => Promise<AgentActionOutcome>;
  onOpenVendorApiKeyPage?: (vendorId: string) => Promise<AgentActionOutcome>;
  rememberedKey?: boolean;
  providerAccessImpact?: Readonly<Record<string, Readonly<{
    runningCount: number;
    documentCount: number;
  }>>>;
  onClose: () => void;
};

function SettingRow({
  icon,
  title,
  description,
  children,
  className = "",
}: {
  icon: ReactNode;
  title: string;
  description: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`settings-row ${className}`.trim()}>
      <span className="settings-row-icon" aria-hidden="true">{icon}</span>
      <span className="settings-row-copy">
        <strong>{title}</strong>
        <span>{description}</span>
      </span>
      <span className="settings-row-control">{children}</span>
    </div>
  );
}

function SettingsToggle({
  checked,
  disabled,
  label,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange(checked: boolean): void;
}) {
  return (
    <label className="settings-switch">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        aria-label={label}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span aria-hidden="true" />
    </label>
  );
}

function SettingsSelect({
  value,
  label,
  disabled,
  options,
  testId,
  onChange,
}: {
  value: string;
  label: string;
  disabled?: boolean;
  options: readonly Readonly<{ value: string; label: string }>[];
  testId?: string;
  onChange(value: string): void;
}) {
  return (
    <select
      className="settings-select"
      value={value}
      disabled={disabled}
      aria-label={label}
      data-testid={testId}
      onChange={(event) => onChange(event.target.value)}
    >
      {options.map((option) => (
        <option value={option.value} key={option.value}>{option.label}</option>
      ))}
    </select>
  );
}

function SettingsRange({
  value,
  label,
  disabled,
  onChange,
}: {
  value: number;
  label: string;
  disabled?: boolean;
  onChange(value: number): void;
}) {
  return (
    <label className="settings-range">
      <input
        type="range"
        min="0"
        max="100"
        step="1"
        value={value}
        disabled={disabled}
        aria-label={label}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <output>{value}%</output>
    </label>
  );
}

function SettingsSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="settings-section" aria-labelledby={`settings-section-${title}`}>
      <h2 id={`settings-section-${title}`}>{title}</h2>
      <div className="settings-section-rows">{children}</div>
    </section>
  );
}

function GeneralSettings({
  workspace,
  saving,
  onUpdate,
}: {
  workspace: WorkspacePreferences;
  saving: boolean;
  onUpdate: (patch: Partial<WorkspacePreferences>) => void;
}) {
  return (
    <div className="settings-page-sections">
      <SettingsSection title="界面与布局">
        <SettingRow
          icon={<SidebarSimpleIcon size={20} weight="regular" />}
          title="记住面板宽度"
          description="记住侧边栏与右侧面板的宽度设置"
        >
          <SettingsToggle
            checked={workspace.rememberPanelWidths}
            disabled={saving}
            label="记住面板宽度"
            onChange={(checked) => onUpdate({ rememberPanelWidths: checked })}
          />
        </SettingRow>
        <SettingRow
          icon={<ArrowClockwiseIcon size={20} weight="regular" />}
          title="恢复默认布局"
          description="将所有面板恢复为响应式默认布局"
        >
          <button
            className="settings-secondary-action"
            type="button"
            disabled={saving}
            onClick={() => onUpdate({
              sidebarWidth: DEFAULT_PANEL_WIDTHS.sidebarWidth,
              inspectorWidth: DEFAULT_PANEL_WIDTHS.inspectorWidth,
            })}
          >
            恢复默认
          </button>
        </SettingRow>
        <SettingRow
          icon={<SparkleIcon size={20} weight="regular" />}
          title="动态效果"
          description="控制界面动画与过渡效果的显示方式"
        >
          <SettingsSelect
            value={workspace.motion}
            disabled={saving}
            label="动态效果"
            options={[
              { value: "system", label: "跟随系统" },
              { value: "reduced", label: "减少动画" },
            ]}
            onChange={(motion) => onUpdate({ motion: motion as WorkspacePreferences["motion"] })}
          />
        </SettingRow>
      </SettingsSection>

      <SettingsSection title="使用习惯">
        <SettingRow
          icon={<FolderOpenIcon size={20} weight="regular" />}
          title="启动时恢复上次标签页"
          description="应用启动时，自动恢复关闭前打开的标签页"
        >
          <SettingsToggle
            checked={workspace.restoreTabsOnLaunch}
            disabled={saving}
            label="启动时恢复上次标签页"
            onChange={(checked) => onUpdate({ restoreTabsOnLaunch: checked })}
          />
        </SettingRow>
      </SettingsSection>

      <SettingsSection title="审阅">
        <SettingRow
          icon={<EyeIcon size={20} weight="regular" />}
          title="变化聚焦时的上下文"
          description="聚焦变化时，非目标区域保留的可见度"
        >
          <SettingsRange
            value={workspace.reviewChangeContextVisibility}
            disabled={saving}
            label="变化聚焦时的上下文可见度"
            onChange={(reviewChangeContextVisibility) => onUpdate({ reviewChangeContextVisibility })}
          />
        </SettingRow>
        <SettingRow
          icon={<ChatCircleDotsIcon size={20} weight="regular" />}
          title="评论聚焦时的上下文"
          description="聚焦评论时，非目标区域保留的可见度"
        >
          <SettingsRange
            value={workspace.reviewCommentContextVisibility}
            disabled={saving}
            label="评论聚焦时的上下文可见度"
            onChange={(reviewCommentContextVisibility) => onUpdate({ reviewCommentContextVisibility })}
          />
        </SettingRow>
        <SettingRow
          icon={<ArrowClockwiseIcon size={20} weight="regular" />}
          title="恢复默认背景可见度"
          description="评论恢复为 15%，变化恢复为 25%"
        >
          <button
            className="settings-secondary-action"
            type="button"
            disabled={saving}
            onClick={() => onUpdate({
              reviewChangeContextVisibility: 25,
              reviewCommentContextVisibility: 15,
            })}
          >
            恢复默认可见度
          </button>
        </SettingRow>
      </SettingsSection>
    </div>
  );
}

function settingsServiceName(providerId: string, fallback: string) {
  return agentServiceLabel(providerId, fallback);
}

function cardChoiceId(card: AgentProviderCardData) {
  return `${card.selection.providerId}:${card.selection.runtimeId}`;
}

function AgentSettings({
  currentAgentName,
  selectedChoiceId,
  cards,
  checking,
  actionButtonRef,
  onSelect,
  onCheck,
  onCheckSelection,
  onCopyGuidance,
  onStartLogin,
  onReopenLogin,
  onLogoutAgent,
  onInstall,
  onCancelInstall,
  onConnectApiKey,
  onRetryPersistCredential,
  onDisconnectApiKey,
  onDisconnectProvider,
  onRemoveRememberedKey,
  onReconnectProvider,
  onOpenVendorApiKeyPage,
  onSelectAgentModel,
  onSelectAgentReasoning,
  rememberedKey = false,
  providerAccessImpact = {},
}: {
  currentAgentName: string;
  selectedChoiceId: string | null;
  cards: readonly AgentProviderCardData[];
  checking: boolean;
  actionButtonRef: Ref<HTMLButtonElement>;
  onSelect(selection: AgentSelection): void;
  onCheck(): Promise<AgentActionOutcome>;
  onCheckSelection(selection: AgentSelection): Promise<AgentActionOutcome>;
  onCopyGuidance(kind: AgentProviderGuidanceKind, selection: AgentSelection): Promise<AgentActionOutcome>;
  onStartLogin(selection: AgentSelection): Promise<AgentActionOutcome>;
  onReopenLogin?(selection: AgentSelection): Promise<AgentActionOutcome>;
  onLogoutAgent?(selection: AgentSelection): Promise<AgentActionOutcome>;
  onInstall(selection: AgentSelection): Promise<AgentActionOutcome>;
  onCancelInstall(selection: AgentSelection): Promise<AgentActionOutcome>;
  onConnectApiKey(selection: AgentSelection, apiKey: string, extras?: Readonly<{ vendorId?: string; baseUrl?: string; modelId?: string; remember?: boolean }>): Promise<AgentActionOutcome>;
  onRetryPersistCredential?(selection: AgentSelection): Promise<AgentActionOutcome>;
  onDisconnectApiKey(selection: AgentSelection): Promise<AgentActionOutcome>;
  onDisconnectProvider?(selection: AgentSelection, options?: Readonly<{ stopRun?: boolean }>): Promise<AgentActionOutcome>;
  onRemoveRememberedKey?(selection: AgentSelection, options?: Readonly<{ stopRun?: boolean }>): Promise<AgentActionOutcome>;
  onReconnectProvider?(selection: AgentSelection): Promise<AgentActionOutcome>;
  onOpenVendorApiKeyPage?(vendorId: string): Promise<AgentActionOutcome>;
  onSelectAgentModel: BoundAgentSetupPanelProps["onSelectAgentModel"];
  onSelectAgentReasoning: BoundAgentSetupPanelProps["onSelectAgentReasoning"];
  rememberedKey?: boolean;
  providerAccessImpact?: Readonly<Record<string, Readonly<{
    runningCount: number;
    documentCount: number;
  }>>>;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<null | Readonly<{
    kind: "disconnect" | "remove-key" | "logout";
    card: AgentProviderCardData;
    stopRun: boolean;
    runningCount: number;
    documentCount: number;
  }>>(null);
  const [confirmPending, setConfirmPending] = useState(false);
  const [confirmError, setConfirmError] = useState("");
  const showOtherProvider = (excludedId: string) => {
    const other = cards.find((card) => cardChoiceId(card) !== excludedId && card.availability.status === "ready")
      || cards.find((card) => cardChoiceId(card) !== excludedId);
    setExpandedId(other ? cardChoiceId(other) : null);
  };
  const selectedCard = expandedId
    ? cards.find((card) => cardChoiceId(card) === expandedId) || null
    : null;
  return (
    <div className="settings-page-sections settings-ai-sections">
      <section className="settings-agent-section" aria-label={`AI 服务配置，默认 ${currentAgentName || "尚未选择"}`}>
        <div className="settings-agent-toolbar">
          <span className="settings-agent-default-summary">连接 AI 后，即可用评论修改页面。</span>
          <button
            className="settings-secondary-action"
            type="button"
            disabled={checking}
            onClick={onCheck}
          >
            <ArrowClockwiseIcon aria-hidden="true" size={14} weight="bold" />
            {checking ? "正在检查…" : "重新检查"}
          </button>
        </div>
        <div className="settings-agent-service-list">
          {cards.length === 0 ? (
            <p className="settings-empty-state">当前没有可配置的 Agent。</p>
          ) : cards.map((card) => {
            const id = cardChoiceId(card);
            const isDefault = id === selectedChoiceId;
            const expanded = selectedCard != null && cardChoiceId(selectedCard) === id;
            const recovery = card.presentation.credentialKind === "api-token" ? null : agentSetupRecovery(card.diagnostic, card.availability);
            const snapshot = recovery || card.presentation.availability(card.availability);
            const disconnected = card.availability.reason === "disabled"
              || card.availability.status === "unavailable" && card.availability.reason === "disabled";
            const credentialRestoreFailed = card.selection.providerId === "stemmio"
              && card.credentialPersist?.status === "failed"
              && String(card.credentialPersist.reason || "").startsWith("无法读取已保存的连接凭证");
            const removeKeyAction = settingsCredentialRemoveAction({
              card,
              rememberedKey: Boolean(rememberedKey),
              onRemoveRememberedKey,
            });
            const needsConnect = disconnected
              || card.availability.status === "not-installed"
              || card.availability.status === "auth-required";
            const primaryLabel = !isDefault && card.availability.status === "ready"
              ? "设为默认"
              : credentialRestoreFailed
                ? "重新连接"
              : disconnected
                ? "重新连接"
              : recovery ? recovery.actionLabel
              : needsConnect
                ? card.availability.status === "not-installed" ? "安装" : card.presentation.credentialKind === "api-token" ? "连接" : "登录"
                : card.availability.reason === "initial" ? "检查"
                : "管理";
            const canRemoveKey = Boolean(removeKeyAction);
            const canDisconnect = Boolean(onDisconnectProvider)
              && !disconnected
              && (card.availability.status === "ready" || Boolean(card.connection) || card.availability.status === "auth-required");
            const canLogout = Boolean(onLogoutAgent)
              && card.selection.providerId !== "stemmio"
              && (card.connection?.authSource === "cli-login"
                || card.connection?.authSource === "chatgpt");
            const canRelogin = Boolean(onStartLogin)
              && card.selection.providerId !== "stemmio"
              && card.presentation.credentialKind !== "api-token"
              && !disconnected;
            const showMore = canDisconnect || canRemoveKey || canLogout || canRelogin
              || (disconnected && Boolean(onReconnectProvider));
            return (
              <div
                key={id}
                className="settings-agent-service"
                data-expanded={expanded ? "true" : undefined}
                data-testid={`settings-agent-row-${card.selection.providerId}`}
              >
                <div className="settings-agent-service-row">
                  <span className="settings-agent-logo" aria-hidden="true">
                    {card.presentation.logoSrc ? <img src={card.presentation.logoSrc} alt="" />
                      : card.selection.providerId === "codex" ? <OpenAiLogoIcon size={23} /> : <CodeIcon size={22} />}
                  </span>
                  <button
                    type="button"
                    className="settings-agent-service-main"
                    aria-expanded={expanded}
                    onClick={() => setExpandedId(expanded ? null : id)}
                  >
                    <strong>{settingsServiceName(card.selection.providerId, card.presentation.displayName)}{isDefault ? <small className="settings-agent-default-badge">默认</small> : null}</strong>
                    <span>
                      {agentSetupOperationLabel(card.activeOperation, card.installState) || (disconnected
                        ? "已断开"
                        : card.availability.reason === "initial" ? "未检查"
                        : `${card.connection?.vendorDisplayName ? `${card.connection.vendorDisplayName} · ` : ""}${snapshot.statusLabel.replace(`${card.presentation.displayName} · `, "")}`)}
                    </span>
                  </button>
                  {!expanded || primaryLabel === "设为默认" ? <button
                    className="settings-secondary-action"
                    type="button"
                    data-testid={`settings-agent-row-action-${card.selection.providerId}`}
                    onClick={() => {
                      if (primaryLabel === "设为默认") {
                        onSelect(card.selection);
                        setExpandedId(id);
                        return;
                      }
                      if (recovery?.action === "change-provider") { showOtherProvider(id); return; }
                      if (primaryLabel === "重新连接") {
                        if (!credentialRestoreFailed) void onReconnectProvider?.(card.selection);
                      }
                      if (recovery?.action === "install" || primaryLabel === "安装") void onInstall(card.selection);
                      else if (recovery?.action === "recheck") void onCheckSelection(card.selection);
                      else if (primaryLabel === "登录") void onStartLogin(card.selection);
                      setExpandedId(id);
                    }}
                  >
                    {primaryLabel}
                  </button> : null}
                  {showMore ? (
                    <details className="settings-agent-more">
                      <summary
                        data-testid={`settings-agent-more-${card.selection.providerId}`}
                        aria-label="更多"
                      >
                        ⋯
                      </summary>
                      <div className="settings-agent-more-menu" role="menu">
                        {disconnected && onReconnectProvider ? (
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              void onReconnectProvider(card.selection);
                            }}
                          >
                            重新连接
                          </button>
                        ) : null}
                        {canDisconnect ? (
                          <>
                            <button
                              type="button"
                              role="menuitem"
                              data-kind="disconnect"
                              onClick={() => {
                                const impact = providerAccessImpact[card.selection.providerId];
                                const stopRun = Boolean(impact?.runningCount);
                                if (stopRun) {
                                  setConfirmAction({
                                    kind: "disconnect",
                                    card,
                                    stopRun,
                                    runningCount: impact?.runningCount || 0,
                                    documentCount: impact?.documentCount || 0,
                                  });
                                  return;
                                }
                                void Promise.resolve(onDisconnectProvider?.(card.selection)).then((outcome) => {
                                  if (!outcome || !["succeeded", "stale"].includes(outcome.status)) {
                                    setConfirmAction({
                                      kind: "disconnect",
                                      card,
                                      stopRun: false,
                                      runningCount: 0,
                                      documentCount: 0,
                                    });
                                    setConfirmError(outcome?.reason || "断开没有完成。");
                                  }
                                });
                              }}
                            >
                              断开连接
                            </button>
                            <small>
                              {card.selection.providerId === "stemmio"
                                ? "断开会保留已记住的 Key"
                                : "断开会保留登录"}
                            </small>
                          </>
                        ) : null}
                        {canLogout ? (
                          <>
                            <button
                              type="button"
                              role="menuitem"
                              data-kind="logout"
                              onClick={() => {
                                const impact = providerAccessImpact[card.selection.providerId];
                                const stopRun = Boolean(impact?.runningCount)
                                  || card.connection?.authScope === "shared-machine";
                                setConfirmAction({
                                  kind: "logout",
                                  card,
                                  stopRun,
                                  runningCount: impact?.runningCount || 0,
                                  documentCount: impact?.documentCount || 0,
                                });
                              }}
                            >
                              退出账号
                            </button>
                            <small>退出后需要重新登录</small>
                          </>
                        ) : null}
                        {canRelogin ? (
                          <button
                            type="button"
                            role="menuitem"
                            data-kind="login"
                            onClick={() => {
                              void onStartLogin(card.selection);
                            }}
                          >
                            重新登录
                          </button>
                        ) : null}
                        {canRemoveKey ? (
                          <>
                            <button
                              type="button"
                              role="menuitem"
                              data-kind="remove-key"
                              onClick={() => {
                                const impact = providerAccessImpact[card.selection.providerId];
                                setConfirmAction({
                                  kind: "remove-key",
                                  card,
                                  stopRun: Boolean(impact?.runningCount),
                                  runningCount: impact?.runningCount || 0,
                                  documentCount: impact?.documentCount || 0,
                                });
                              }}
                            >
                              {removeKeyAction?.label}
                            </button>
                            <small>{removeKeyAction?.description}</small>
                          </>
                        ) : null}
                      </div>
                    </details>
                  ) : null}
                </div>
                {confirmAction?.card.selection.providerId === card.selection.providerId ? (
                  <div
                    className="settings-agent-confirm"
                    role="alertdialog"
                    aria-label={
                      confirmAction.kind === "remove-key"
                        ? "移除 API Key？"
                        : confirmAction.kind === "logout"
                          ? "退出账号？"
                          : "断开连接？"
                    }
                  >
                    <strong>
                      {confirmAction.kind === "remove-key"
                        ? "移除 API Key？"
                        : confirmAction.kind === "logout"
                          ? `退出 ${settingsServiceName(card.selection.providerId, card.presentation.displayName)}？`
                          : `断开 ${settingsServiceName(card.selection.providerId, card.presentation.displayName)}？`}
                    </strong>
                    <p>
                      {confirmAction.stopRun
                        ? `将停止 ${confirmAction.documentCount || 1} 个文档上的 ${confirmAction.runningCount || 1} 个任务后再继续。${
                          confirmAction.kind === "logout"
                            ? card.connection?.authScope === "shared-machine"
                              ? "这也会退出本机共享登录。"
                              : "退出后需要重新登录。"
                            : ""
                        }`
                        : confirmAction.kind === "logout"
                          ? card.connection?.authScope === "shared-machine"
                            ? "将退出本机共享登录，之后需要重新登录。"
                            : "退出后需要重新登录。"
                        : confirmAction.kind === "remove-key"
                          ? "移除后需要重新填写 API Key。断开后仍可移除已记住的 Key。"
                          : card.selection.providerId === "stemmio"
                            ? "断开会停用本应用接入，已记住的 Key 仍保留。"
                            : "断开会停用本应用接入，本机登录仍保留。"}
                    </p>
                    {confirmError ? <p role="alert">{confirmError}</p> : null}
                    <div className="settings-agent-confirm-actions">
                      <button
                        type="button"
                        disabled={confirmPending}
                        onClick={() => {
                          if (confirmPending) return;
                          setConfirmError("");
                          setConfirmAction(null);
                        }}
                      >
                        {confirmAction.stopRun ? "继续任务" : "取消"}
                      </button>
                      <button
                        type="button"
                        className="settings-agent-confirm-danger"
                        disabled={confirmPending}
                        onClick={() => {
                          const action = confirmAction;
                          setConfirmPending(true);
                          setConfirmError("");
                          const request = action.kind === "remove-key"
                            ? removeKeyAction?.trigger({ stopRun: action.stopRun })
                            : action.kind === "logout"
                              ? onLogoutAgent?.(action.card.selection)
                              : onDisconnectProvider?.(action.card.selection, { stopRun: action.stopRun });
                          void Promise.resolve(request).then((outcome) => {
                            if (!outcome || !["succeeded", "stale"].includes(outcome.status)) {
                              setConfirmError(outcome?.reason || "操作没有完成。");
                              setConfirmPending(false);
                              return;
                            }
                            setConfirmPending(false);
                            setConfirmAction(null);
                          }, () => {
                            setConfirmError("操作没有完成。");
                            setConfirmPending(false);
                          });
                        }}
                      >
                        {confirmPending
                          ? "正在处理…"
                          : confirmAction.kind === "logout"
                            ? confirmAction.stopRun ? "停止并退出" : "退出账号"
                            : confirmAction.stopRun
                              ? confirmAction.kind === "remove-key" ? "停止并移除" : "停止并断开"
                              : confirmAction.kind === "remove-key" ? "移除 API Key" : "断开连接"}
                      </button>
                    </div>
                  </div>
                ) : null}
                {expanded && selectedCard ? (
                  <div className="settings-agent-rows">
                    <BoundAgentSetupPanel
                      card={selectedCard}
                      surface="settings"
                      onUseOtherProvider={() => showOtherProvider(id)}
                      actionButtonRef={actionButtonRef}
                      hideDisconnectAction
                      initialApiKeyOpen={selectedCard.credentialPersist?.status === "failed"
                        && String(selectedCard.credentialPersist.reason || "").startsWith("无法读取已保存的连接凭证")}
                      onCopyGuidance={onCopyGuidance}
                      onStartLogin={onStartLogin}
                      onReopenLogin={onReopenLogin}
                      onInstall={onInstall}
                      onCancelInstall={onCancelInstall}
                      onCheckSelection={onCheckSelection}
                      onConnectApiKey={onConnectApiKey}
                      onRetryPersistCredential={onRetryPersistCredential}
                      onDisconnectApiKey={onDisconnectApiKey}
                      onOpenVendorApiKeyPage={onOpenVendorApiKeyPage}
                      onSelectAgentModel={onSelectAgentModel}
                      onSelectAgentReasoning={onSelectAgentReasoning}
                    />
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function UpdatesSettings({
  appVersion,
  updateResult,
  updatesAvailable,
  manualCheckPending,
  manualCheckFailed,
  releaseNotesOpenFailed,
  onCheckForUpdates,
  onDownloadUpdate,
  onRequestRestart,
  onOpenReleaseNotes,
}: Omit<SettingsPageProps, "activeTabId" | "category" | "initialFocus" | "currentAgentName" | "workspacePreferences" | "workspacePreferencesSaving" | "workspacePreferencesError" | "agentChoices" | "selectedAgentChoiceId" | "agentCards" | "onUpdateWorkspacePreference" | "onRetryWorkspacePreferences" | "onSelectAgent" | "onSelectAgentModel" | "onSelectAgentReasoning" | "onClose" | "onCheckUsability" | "onCopyGuidance" | "onStartLogin" | "onInstall" | "onCancelInstall" | "onConnectApiKey" | "onDisconnectApiKey" | "onDisconnectProvider" | "onRemoveRememberedKey" | "onReconnectProvider" | "onOpenVendorApiKeyPage" | "rememberedKey" | "providerAccessImpact">) {
  const presentation = updatePresentation({
    result: updateResult,
    updatesAvailable,
    manualCheckPending,
    manualCheckFailed,
  });
  const checking = manualCheckPending || updateResult?.status === "checking";
  const downloaded = updateResult?.status === "downloaded";
  const available = updateResult?.status === "available";
  const installing = updateResult?.status === "installing";
  const downloading = updateResult?.status === "downloading";
  const canCheck = (
    updatesAvailable
    && !checking
    && !downloaded
    && !installing
    && !downloading
    && updateResult?.status !== "unsupported"
  );
  const updateActionLabel = downloaded
    ? "重启更新"
    : available
      ? "下载更新"
      : installing
        ? "正在重启…"
        : downloading
          ? "正在下载…"
          : checking
            ? "正在检查…"
            : canCheck
              ? "立即检查"
              : "仅正式版可用";
  return (
    <div className="settings-page-sections">
      <SettingsSection title="版本信息">
        <SettingRow
          icon={<InfoIcon size={20} weight="regular" />}
          title="当前版本"
          description="当前运行的源页版本"
        >
          <strong className="settings-value">{appVersion || updateResult?.currentVersion || "—"}</strong>
        </SettingRow>
        <SettingRow
          icon={<CloudArrowUpIcon size={20} weight="regular" />}
          title="最新版本"
          description="已知的最新正式版本"
        >
          <strong className="settings-value">{updateResult?.latestVersion || "—"}</strong>
        </SettingRow>
        <SettingRow
          icon={<DesktopIcon size={20} weight="regular" />}
          title="架构信息"
          description="当前安装包的运行架构"
        >
          <strong className="settings-value">{architectureLabel(updateResult?.architecture)}</strong>
        </SettingRow>
      </SettingsSection>

      <SettingsSection title="更新状态">
        <SettingRow
          icon={<ArrowClockwiseIcon size={20} weight="regular" />}
          title={presentation.title}
          description={presentation.detail}
          className={`settings-update-row settings-update-row-${presentation.tone}`}
        >
          <button
            className="settings-update-action"
            type="button"
            disabled={!canCheck && !available && !downloaded}
            onClick={downloaded
              ? onRequestRestart
              : available
                ? onDownloadUpdate
                : onCheckForUpdates}
          >
            {updateActionLabel}
          </button>
        </SettingRow>
        <div className="settings-update-footer">
          {available ? (
            <button
              className="settings-release-notes"
              type="button"
              disabled={!canCheck}
              onClick={onCheckForUpdates}
            >
              再次检查
            </button>
          ) : null}
          <button
            className="settings-release-notes"
            type="button"
            onClick={onOpenReleaseNotes}
          >
            <span>查看更新内容</span>
            <ArrowSquareOutIcon aria-hidden="true" size={12} weight="bold" />
          </button>
          {releaseNotesOpenFailed ? (
            <p className="settings-error" role="alert">
              更新内容页面没有打开，请检查网络后重试。
            </p>
          ) : null}
        </div>
      </SettingsSection>
    </div>
  );
}

export default function SettingsPage({
  activeTabId,
  category,
  initialFocus = "general",
  appVersion,
  currentAgentName,
  updateResult,
  updatesAvailable,
  manualCheckPending,
  manualCheckFailed,
  releaseNotesOpenFailed,
  workspacePreferences,
  workspacePreferencesSaving,
  workspacePreferencesError,
  selectedAgentChoiceId,
  agentCards,
  onUpdateWorkspacePreference,
  onRetryWorkspacePreferences,
  onSelectAgent,
  onSelectAgentModel,
  onSelectAgentReasoning,
  onCheckForUpdates,
  onDownloadUpdate,
  onRequestRestart,
  onOpenReleaseNotes,
  onCheckUsability,
  onCopyGuidance,
  onStartLogin,
  onReopenLogin,
  onLogoutAgent,
  onInstall,
  onCancelInstall,
  onConnectApiKey,
  onRetryPersistCredential,
  onDisconnectApiKey,
  onDisconnectProvider,
  onRemoveRememberedKey,
  onReconnectProvider,
  onOpenVendorApiKeyPage,
  rememberedKey,
  providerAccessImpact,
  onClose,
}: SettingsPageProps) {
  const pageRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const agentActionRef = useRef<HTMLButtonElement>(null);
  const agentCardsRef = useRef(agentCards);
  const checkInFlightRef = useRef(false);
  const lastCheckStartedAtRef = useRef(0);
  const lastCheckGuidanceRef = useRef("");
  const [agentCheckPending, setAgentCheckPending] = useState(false);
  const rememberedKeyState = Boolean(rememberedKey);

  useEffect(() => {
    agentCardsRef.current = agentCards;
  }, [agentCards]);

  const requestAgentCheck = useCallback((force = false): Promise<AgentActionOutcome> => {
    const cards = agentCardsRef.current;
    const selected = cards.find((card) => (
      `${card.selection.providerId}:${card.selection.runtimeId}` === selectedAgentChoiceId
    )) || cards[0];
    if (!selected) return Promise.resolve(null);
    if (!force && (
      selected.availability.status === "ready" || selected.availability.status === "checking"
    )) return Promise.resolve({ status: "succeeded" });
    const now = Date.now();
    const guidanceKey = String(selected.availability.guidanceCopied || "");
    const guidanceChanged = guidanceKey !== lastCheckGuidanceRef.current;
    // Switching Agent always uses force. The previous scheme's in-flight check
    // must not suppress the newly selected card, or Codex/源页 stay on the
    // initial "检测中" forever.
    if (!force && (
      checkInFlightRef.current
      || (!guidanceChanged && now - lastCheckStartedAtRef.current < 1_500)
    )) return Promise.resolve({ status: "succeeded" });
    lastCheckStartedAtRef.current = now;
    lastCheckGuidanceRef.current = guidanceKey;
    checkInFlightRef.current = true;
    setAgentCheckPending(true);
    const check = Promise.resolve(onCheckUsability(selected.selection));
    check.then(() => {
        checkInFlightRef.current = false;
        setAgentCheckPending(false);
      }, () => {
        checkInFlightRef.current = false;
        setAgentCheckPending(false);
      });
    return check;
  }, [onCheckUsability, selectedAgentChoiceId]);

  useEffect(() => {
    if (category !== "agent") return undefined;
    requestAgentCheck(true);
    const handleReturnToApp = () => {
      if (document.visibilityState === "visible") {
        const unresolved = (() => {
          const selected = agentCardsRef.current.find((card) => (
            `${card.selection.providerId}:${card.selection.runtimeId}` === selectedAgentChoiceId
          )) || agentCardsRef.current[0];
          return Boolean(selected && (
            selected.installState === "installing"
            || (
              selected.availability.status === "auth-required"
              && selected.availability.guidanceCopied === "login"
            )
          ));
        })();
        if (unresolved) void requestAgentCheck(true);
      }
    };
    window.addEventListener("focus", handleReturnToApp);
    document.addEventListener("visibilitychange", handleReturnToApp);
    return () => {
      window.removeEventListener("focus", handleReturnToApp);
      document.removeEventListener("visibilitychange", handleReturnToApp);
    };
  }, [category, requestAgentCheck, selectedAgentChoiceId]);

  useEffect(() => {
    const focusFrame = requestAnimationFrame(() => {
      if (initialFocus === "agent" && category === "agent") {
        agentActionRef.current?.focus();
        if (!agentActionRef.current) headingRef.current?.focus();
      } else headingRef.current?.focus();
    });
    return () => cancelAnimationFrame(focusFrame);
  }, [category, initialFocus]);

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  };

  const pageTitle = category === "general"
    ? "常规"
    : category === "agent"
      ? "AI 服务"
      : "软件更新";
  const pageDescription = category === "general"
    ? "调整工作台布局与启动习惯。"
    : category === "agent"
      ? ""
      : "检查、下载并安装源页的正式版本。";

  return (
    <section
      ref={pageRef}
      id="workbench-content-outlet"
      className="workbench-settings-page"
      role="tabpanel"
      aria-labelledby={`workbench-tab-${activeTabId}`}
      aria-label={pageTitle}
      onKeyDown={handleKeyDown}
    >
      <div className="settings-page-inner">
        <header className="settings-page-header">
          <h1 ref={headingRef} tabIndex={-1}>{pageTitle}</h1>
          {pageDescription ? <p>{pageDescription}</p> : null}
        </header>

        {workspacePreferencesError ? (
          <div className="settings-preference-error" role="alert">
            <span>设置暂未保存：{workspacePreferencesError}</span>
            <button
              type="button"
              disabled={workspacePreferencesSaving}
              onClick={onRetryWorkspacePreferences}
            >
              重试保存
            </button>
          </div>
        ) : null}


        {category === "general" ? (
          <GeneralSettings
            workspace={workspacePreferences}
            saving={workspacePreferencesSaving}
            onUpdate={(patch) => { void onUpdateWorkspacePreference(patch); }}
          />
        ) : category === "agent" ? (
          <AgentSettings
            currentAgentName={currentAgentName}
            selectedChoiceId={selectedAgentChoiceId}
            cards={agentCards}
            checking={agentCheckPending}
            actionButtonRef={agentActionRef}
            onSelect={onSelectAgent}
            onCheck={() => requestAgentCheck(true)}
            onCheckSelection={onCheckUsability}
            onCopyGuidance={onCopyGuidance}
            onStartLogin={onStartLogin}
            onReopenLogin={onReopenLogin}
            onLogoutAgent={onLogoutAgent}
            onInstall={onInstall}
            onCancelInstall={onCancelInstall}
            onConnectApiKey={onConnectApiKey}
            onRetryPersistCredential={onRetryPersistCredential}
            onDisconnectApiKey={onDisconnectApiKey}
            onDisconnectProvider={onDisconnectProvider}
            onRemoveRememberedKey={onRemoveRememberedKey}
            onReconnectProvider={onReconnectProvider}
            onOpenVendorApiKeyPage={onOpenVendorApiKeyPage}
            onSelectAgentModel={onSelectAgentModel}
            onSelectAgentReasoning={onSelectAgentReasoning}
            rememberedKey={rememberedKeyState}
            providerAccessImpact={providerAccessImpact}
          />
        ) : (
          <UpdatesSettings
            appVersion={appVersion}
            updateResult={updateResult}
            updatesAvailable={updatesAvailable}
            manualCheckPending={manualCheckPending}
            manualCheckFailed={manualCheckFailed}
            releaseNotesOpenFailed={releaseNotesOpenFailed}
            onCheckForUpdates={onCheckForUpdates}
            onDownloadUpdate={onDownloadUpdate}
            onRequestRestart={onRequestRestart}
            onOpenReleaseNotes={onOpenReleaseNotes}
          />
        )}
      </div>
    </section>
  );
}

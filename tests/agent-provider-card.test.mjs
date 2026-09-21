import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { settingsCredentialRemoveAction } from "../app/components/settings-agent-action-gate.js";

async function source(relativePath) {
  return readFile(new URL(relativePath, import.meta.url), "utf8");
}

test("the generic Agent card owns provider presentation", async () => {
  const card = await source("../app/components/AgentProviderCard.tsx");
  for (const contract of [
    "data-status={availability.status}",
    "data-surface={surface}",
    'aria-live="polite"',
    'aria-atomic="true"',
    "ref={index === 0 ? actionButtonRef : undefined}",
    "{...(index === 0 ? primaryActionData : {})}",
    '正在登录…',
    '正在安装…',
    'cancel-install',
    'onCancelInstall',
    'onStartLogin',
    '请在浏览器完成登录',
  ]) assert.ok(card.includes(contract), contract);
  assert.doesNotMatch(card, /installState === "cancelling" \|\| cancelPending \|\| cancelRequested/u);
  assert.match(card, /setCancelRequested\(false\)/u);
  assert.doesNotMatch(card, /if \(!confirmed\) setCancelRequested\(false\)/u);
  assert.match(card, /data-testid="settings-agent-vendor"/u);
  assert.match(card, /API Key/u);
  assert.match(card, /获取 API Key/u);
  assert.match(card, /连接验证可能产生少量 API 费用/u);
  assert.match(card, /其他服务商/u);
  assert.match(card, /Model ID/u);
  assert.match(card, /当前连接：/u);
  assert.match(card, /断开连接/u);
  assert.match(card, /在此 Mac 上记住 API Key/u);
  assert.match(card, /验证成功后才会替换当前连接/u);
  assert.match(card, /persistFailed \|\| outcome\?\.reason/u);
  assert.match(card, /已连接，但新的 API Key 未保存/u);
  assert.match(card, /credentialPersist\?\.operationKind !== "clear"/u);
  assert.match(card, /移除状态未确认/u);
  assert.match(card, /重试保存/u);
  assert.match(card, /kind: "api-key", label: "连接"/u);
  assert.doesNotMatch(card, /kind: "api-key", label: "登录"/u);
  assert.match(card, /tokenFormOpen/u);
  assert.match(card, /action\.kind === "api-key"/u);
  assert.match(card, /更换 API Key/u);
  assert.doesNotMatch(card, /更换 Token/u);
  assert.match(card, /surface === "settings" \? null : <strong>/u);
  assert.doesNotMatch(card, /placeholder="API Token"/u);
  assert.doesNotMatch(card, /选择其他模型/u);
  assert.match(card, /思考深度/u);
  assert.doesNotMatch(card, /修改接口/u);
  assert.match(card, /connection\?\.vendorId === "custom"/u);
  assert.match(card, /connection && onDisconnectApiKey/u);
  assert.doesNotMatch(card, /Anthropic/u);
});

test("About is product information while Settings owns Agent checks and update controls", async () => {
  const [about, settings, actionGate] = await Promise.all([
    source("../app/components/AboutStemmioDialog.tsx"),
    source("../app/components/SettingsPage.tsx"),
    source("../app/components/settings-agent-action-gate.js"),
  ]);
  assert.match(about, /源码级本地 HTML 编辑器/u);
  assert.doesNotMatch(about, /about-agent-section|Agent|检查更新|Qoder/u);
  assert.match(settings, /AI 服务/u);
  assert.match(settings, /settings-agent-row-/u);
  assert.match(settings, /AgentSetupPanel/u);
  assert.match(settings, /软件更新/u);
  assert.match(settings, /document\.visibilityState === "visible"/u);
  assert.match(settings, /window\.addEventListener\("focus"/u);
  assert.match(settings, /document\.addEventListener\("visibilitychange"/u);
  assert.match(settings, /agentActionRef\.current\?\.focus\(\)/u);
  assert.match(settings, /onCheckForUpdates/u);
  assert.match(settings, /onDownloadUpdate/u);
  assert.match(settings, /onRequestRestart/u);
  assert.match(settings, /if \(!force && \(/u);
  assert.match(settings, /checkInFlightRef\.current/u);
  assert.doesNotMatch(settings, /rememberedKey \|\| Boolean\(card\.connection\)/u);
  assert.match(settings, /settingsCredentialRemoveAction/u);
  assert.match(actionGate, /确认移除结果/u);
  assert.match(actionGate, /继续确认上次移除操作/u);
  assert.match(settings, /setConfirmPending\(true\)/u);
  assert.match(settings, /正在处理…/u);
  assert.doesNotMatch(settings, /expandedId \|\| selectedChoiceId/u);
  assert.match(settings, /setExpandedId\(expanded \? null : id\)/u);
  assert.doesNotMatch(settings, /settings-agent-scheme/u);
  assert.match(settings, /停止并退出/u);
  assert.match(settings, /providerAccessImpact/u);
  assert.match(settings, /credentialRestoreFailed/u);
  assert.match(settings, /settings-preference-error/u);
  assert.match(settings, /设置暂未保存/u);
  assert.match(settings, /onRetryWorkspacePreferences/u);
  assert.match(settings, /initialApiKeyOpen=\{selectedCard\.credentialPersist\?\.status === "failed"/u);
  assert.match(settings, /无法读取已保存的连接凭证/u);
  assert.doesNotMatch(settings, /setConfirmAction\(null\);\s+if \(action\.kind === "remove-key"\)/u);
});

test("Settings unknown clear action executes the remove reconciliation for its provider", async () => {
  const selection = Object.freeze({ providerId: "stemmio", runtimeId: "native-http" });
  const calls = [];
  const action = settingsCredentialRemoveAction({
    card: Object.freeze({
      selection,
      credentialPersist: Object.freeze({ operationKind: "clear", status: "unknown" }),
    }),
    rememberedKey: false,
    async onRemoveRememberedKey(actualSelection) {
      calls.push(actualSelection);
      return { status: "succeeded" };
    },
  });
  assert.equal(action?.label, "确认移除结果");
  assert.equal(action?.description, "继续确认上次移除操作");
  assert.deepEqual(await action?.trigger(), { status: "succeeded" });
  assert.deepEqual(calls, [selection]);
});

test("Settings reuses AgentSetupPanel and lists every service row", async () => {
  const [settings, panel] = await Promise.all([
    source("../app/components/SettingsPage.tsx"),
    source("../app/components/AgentSetupPanel.tsx"),
  ]);
  assert.match(panel, /import AgentProviderCard from "\.\/AgentProviderCard"/u);
  assert.match(panel, /<AgentProviderCard \{\.\.\.props\}/u);
  assert.match(settings, /settings-agent-row-\$\{card\.selection\.providerId\}/u);
  assert.match(settings, /data-kind="disconnect"/u);
  assert.match(settings, /移除 API Key/u);
  assert.match(panel, /export function BoundAgentSetupPanel/u);
  assert.match(panel, /void onCheckSelection\(card\.selection\)/u);
  assert.match(panel, /Entering the panel starts the necessary check/u);
  assert.match(panel, /checked\.status !== "succeeded"/u);
  assert.match(panel, /credentialKind === "api-token"/u);
  assert.doesNotMatch(panel, /if \(card\.connection\)/u);
  assert.match(panel, /supportsSelectableModels === true/u);
  assert.match(panel, /key=\{`\$\{card\.selection\.providerId\}:\$\{card\.selection\.runtimeId\}`\}/u);
  assert.doesNotMatch(panel, /resolvedModelId \|\| "none"/u);
});

test("the conversation sidebar names stemmio from the connection summary", async () => {
  const sidebar = await source("../app/workbench/AiConversationSidebar.tsx");
  assert.match(sidebar, /vendorDisplayName/u);
  assert.doesNotMatch(sidebar, /DeepSeek ·/u);
  assert.match(sidebar, /recovery\.lastOutcome/u);
  assert.doesNotMatch(sidebar, /ai-conversation-service-choices|ai-conversation-model-choices/u);
});

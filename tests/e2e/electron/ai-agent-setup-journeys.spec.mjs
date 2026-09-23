import { expect, test } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { closeStemmioGracefully } from "./helpers/electron-safe-cleanup.mjs";
import {
  addComment, adoptReadyResult, candidateHtmlFiles, chooseModifyIntent, createCodexAcpE2ECommand,
  createSourceFixture, expandSettingsAgent, launchStemmio, mkdirSync,
  openAgentSettingsPage, stemmioHttpAgentEnv, path, productRoot, readFileSync,
  removeSourceFixture, setDefaultSettingsAgent, startStemmioHttpAgent, stopStemmio,
  loadedDiskFrame,
} from "./ai-closed-loop-helpers.mjs";

const screenshots = path.join(productRoot, "output/design-qa/agent-setup-journeys");
mkdirSync(screenshots, { recursive: true });

test("non-default DeepSeek saves high through restart and sends high, with compact settings and narrow progress", async () => {
  test.setTimeout(180_000);
  const fixture = createSourceFixture("agent-setup-journey.html");
  const codexCommand = createCodexAcpE2ECommand(fixture.sourceDirectory);
  let finish;
  const complete = new Promise((resolve) => { finish = resolve; });
  const httpAgent = await startStemmioHttpAgent({ beforeStreamComplete: () => complete, streamDelayMs: 1_000 });
  const injectedEnv = {
    STEMMIO_CODEX_ACP_ALLOW_TEST_COMMAND: "1",
    STEMMIO_CODEX_ACP_COMMAND: codexCommand,
    STEMMIO_E2E_RESTORE_CREDENTIAL: "1",
    STEMMIO_E2E_CREDENTIAL_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
    ...stemmioHttpAgentEnv(httpAgent.baseUrl),
  };
  let launched = await launchStemmio({ activeSourcePath: fixture.sourcePath, injectedEnv });
  let profile = launched.isolatedUserData;
  try {
    const workingPath = await addComment(launched.page, fixture.sourcePath, "请调整标题，保留其余内容。");
    await launched.page.getByRole("button", { name: /AI 助手/u }).click();
    let settings = await openAgentSettingsPage(launched.page);
    await expandSettingsAgent(settings, "codex");
    await setDefaultSettingsAgent(settings, "codex");
    await expandSettingsAgent(settings, "stemmio");
    let card = settings.locator(".stemmio-availability-card");
    const checkbox = card.getByRole("checkbox");
    await expect(checkbox).toBeVisible();
    const bounds = await checkbox.boundingBox();
    expect(bounds.width).toBe(16);
    expect(bounds.height).toBe(16);
    await launched.page.screenshot({ path: path.join(screenshots, "settings-key-form.png"), animations: "disabled" });
    await card.getByRole("textbox", { name: "API Key" }).fill("sk-e2e-journey");
    await card.getByRole("checkbox", { name: "在此 Mac 上记住 API Key" }).check();
    await card.getByRole("button", { name: "连接", exact: true }).click();
    await expect(settings.getByTestId("settings-agent-row-stemmio")).toContainText("DeepSeek · 已连接");
    const modelChoice = card.getByRole("combobox", { name: "当前模型" });
    await expect(modelChoice.locator("option")).toHaveCount(3);
    for (const model of ["deepseek-v4-flash", "deepseek-v4-flash-vision-exp", "deepseek-v4-pro"]) {
      await modelChoice.selectOption(`stemmio:${model}`);
      await expect(modelChoice).toHaveValue(`stemmio:${model}`);
    }
    await card.getByRole("combobox", { name: "思考深度" }).selectOption("high");
    await expect(card.getByRole("combobox", { name: "思考深度" })).toHaveValue("high");
    await expect(settings.getByTestId("settings-agent-row-codex").locator(".settings-agent-default-badge")).toBeVisible();
    await expect(card.locator(".qoder-card-status")).toHaveCount(0);
    await expect(card.getByTestId("agent-credential-summary")).toContainText("已在此 Mac 保存");
    const encryptedCredential = readFileSync(path.join(profile, "agent-session-credential.v1.json"), "utf8");
    expect(encryptedCredential).not.toContain("sk-e2e-journey");
    await settings.getByTestId("settings-agent-row-stemmio").locator(".settings-agent-service-main").click();
    await expandSettingsAgent(settings, "stemmio");
    await expect(card.getByRole("combobox", { name: "思考深度" })).toHaveValue("high");
    await expect.poll(() => JSON.parse(readFileSync(path.join(profile, "ui-preferences.json"), "utf8"))
      .workspace?.agentConfigurations?.stemmio?.reasoning).toBe("high");
    await launched.page.screenshot({ path: path.join(screenshots, "settings-deepseek-high.png"), animations: "disabled" });
    await stopStemmio(launched.electronApp, profile, { cleanup: false });
    launched = await launchStemmio({ isolatedUserData: profile, injectedEnv });
    settings = await openAgentSettingsPage(launched.page);
    await expandSettingsAgent(settings, "stemmio");
    card = settings.locator(".stemmio-availability-card");
    await expect(settings.getByTestId("settings-agent-row-stemmio")).toContainText("DeepSeek · 已连接");
    await expect(card.getByTestId("agent-credential-summary")).toContainText("已在此 Mac 保存");
    await expect(card.getByRole("combobox", { name: "思考深度" })).toHaveValue("high");
    await expect(settings.getByTestId("settings-agent-row-codex").locator(".settings-agent-default-badge")).toBeVisible();
    await setDefaultSettingsAgent(settings, "stemmio");
    await launched.page.getByRole("button", { name: "返回工作台" }).click();
    await launched.page.getByRole("button", { name: /AI 助手/u }).click();
    const sidebar = await chooseModifyIntent(launched.page);
    await expect(launched.page.getByText(/设置暂未保存|选择未保存|工作台偏好记录无效/u)).toHaveCount(0);
    await expect.poll(() => JSON.parse(readFileSync(path.join(profile, "ui-preferences.json"), "utf8"))
      .workspace?.defaultAgentProviderId).toBe("stemmio");
    const original = readFileSync(workingPath);
    await sidebar.getByRole("button", { name: /交给.*修改/u }).click();
    const executionStatus = sidebar.getByTestId("ai-conversation-execution-status");
    await expect(executionStatus).toHaveText(/\d{2}:\d{2} · \d+ KB/u);
    await expect(executionStatus).not.toContainText("正在生成");
    await expect(executionStatus).not.toContainText("正在接收结果");
    await expect(sidebar.getByTestId("ai-conversation-run-progress")).toHaveCount(0);
    await expect(sidebar.getByTestId("ai-conversation-stop")).toBeVisible();
    await expect(sidebar.getByTestId("ai-conversation-action-bar")).toHaveCount(0);
    const narration = sidebar.getByTestId("ai-conversation-narration-message");
    await expect(narration.getByTestId("ai-conversation-execution-status")).toBeVisible();
    await expect(narration).toContainText("我会先检查页面结构");
    await expect(narration.getByTestId("ai-conversation-thinking")).toHaveCount(0);
    await expect(narration).not.toContainText("标题与配色已调整");
    const draft = sidebar.getByRole("textbox", { name: "修改要求草稿" });
    await draft.fill("下一轮再调整");
    await draft.press("End");
    await draft.evaluate((element) => {
      window.__draftCompositionTextarea = element;
      window.__draftCompositionEvents = [];
      for (const type of ["compositionstart", "compositionend"]) {
        element.addEventListener(type, () => window.__draftCompositionEvents.push(type));
      }
    });
    const draftCdp = await launched.page.context().newCDPSession(launched.page);
    await draftCdp.send("Input.imeSetComposition", { text: "yejiaojianju", selectionStart: 11, selectionEnd: 11 });
    await expect(narration).toContainText("标题与配色已调整");
    expect(await draft.evaluate((element) => ({
      sameElement: element === window.__draftCompositionTextarea,
      focused: document.activeElement === element,
      events: window.__draftCompositionEvents,
    }))).toEqual({
      sameElement: true,
      focused: true,
      events: ["compositionstart"],
    });
    await draftCdp.send("Input.insertText", { text: "页脚间距" });
    await expect(draft).toHaveValue("下一轮再调整页脚间距");
    expect(await draft.evaluate((element) => ({
      sameElement: element === window.__draftCompositionTextarea,
      focused: document.activeElement === element,
      caret: element.selectionStart,
      end: element.selectionEnd,
      length: element.value.length,
      events: window.__draftCompositionEvents,
    }))).toEqual({
      sameElement: true,
      focused: true,
      caret: "下一轮再调整页脚间距".length,
      end: "下一轮再调整页脚间距".length,
      length: "下一轮再调整页脚间距".length,
      events: ["compositionstart", "compositionend"],
    });
    await draftCdp.detach();
    await expect(narration).not.toContainText("fixture-hidden");
    await expect(narration).not.toContainText("<!DOCTYPE");
    const processToggle = narration.getByTestId("ai-conversation-narration-toggle");
    if (await processToggle.getAttribute("aria-expanded") !== "true") await processToggle.click();
    await expect(narration.getByTestId("ai-conversation-public-activity")).toContainText([
      "收到服务响应", "生成修改",
    ]);
    await expect(narration).not.toContainText(/读取本轮资料|写入修改结果/u);

    const process = sidebar.getByTestId("ai-turn-process").first();
    await expect(process.locator("summary")).toHaveCount(1);
    await process.locator("summary").click();
    await expect(process.locator("li").first()).toBeVisible();
    await expect(sidebar.getByTestId("ai-conversation-run-summary")).toHaveCount(0);
    await expect(sidebar.getByText("Thinking", { exact: true })).toHaveCount(0);
    const separator = await launched.page.evaluate(() => {
      const sidebarNode = document.querySelector('[data-testid="ai-conversation-sidebar"]');
      const resizer = document.querySelector('.workbench-resizer-inspector');
      const grip = resizer?.querySelector('.workbench-resizer-grip');
      const sidebarStyle = sidebarNode ? getComputedStyle(sidebarNode) : null;
      const resizerStyle = resizer ? getComputedStyle(resizer) : null;
      const gripStyle = grip ? getComputedStyle(grip) : null;
      return {
        borderWidth: sidebarStyle?.borderLeftWidth || null,
        resizerWidth: resizerStyle?.width || null,
        resizerBackground: resizerStyle?.backgroundColor || null,
        gripDisplay: gripStyle?.display || null,
      };
    });
    expect(separator).toEqual({
      borderWidth: "1px",
      resizerWidth: "18px",
      resizerBackground: "rgba(0, 0, 0, 0)",
      gripDisplay: "none",
    });
    expect(readFileSync(workingPath).equals(original)).toBe(true);
    await launched.page.screenshot({ path: path.join(screenshots, "narrow-sidebar-generating.png"), animations: "disabled" });
    finish();
    await expect(sidebar.getByTestId("ai-conversation-action-bar")).toContainText("修改已准备好，尚未采用", { timeout: 60_000 });
    await expect(narration.getByTestId("ai-conversation-public-activity")).toContainText([
      "收到服务响应", "生成修改", "服务响应已结束", "已检查 HTML 完整性", "准备审阅",
    ]);
    await expect(sidebar.getByTestId("ai-conversation-run-summary")).toHaveCount(0);
    const active = await launched.page.evaluate(() => window.stemmioProjects.getActiveProject());
    const candidates = candidateHtmlFiles(launched.workspace, active.projectId);
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.some((file) => readFileSync(file, "utf8").includes('data-stemmio-http-reasoning="high"'))).toBe(true);
    expect(readFileSync(workingPath).equals(original)).toBe(true);
    expect(readFileSync(fixture.sourcePath).equals(fixture.original)).toBe(true);
    await sidebar.getByRole("button", { name: "查看修改" }).click();
    await expect(launched.page.getByTestId("ai-review-workspace")).toBeVisible();
    await expect(launched.page.getByRole("button", { name: "采纳修改", exact: true })).toHaveCount(0);
    await expect(launched.page.getByRole("button", { name: "采用修改", exact: true })).toHaveCount(1);
    await expect(draft).toHaveValue("下一轮再调整页脚间距");
    await expect.poll(() => sidebar.evaluate((element) => {
      const draft = element.querySelector('[data-testid="ai-conversation-composer"]').getBoundingClientRect();
      const actions = element.querySelector('[data-testid="ai-conversation-current-actions"]').getBoundingClientRect();
      const gap = Math.abs(draft.top - actions.bottom);
      const bottom = element.getBoundingClientRect().bottom - draft.bottom;
      return gap <= 1 && bottom >= 10 && bottom <= 14;
    })).toBe(true);
    const review = launched.page.getByTestId("ai-review-workspace");
    for (const index of [0, 1]) {
      await expect(review.frameLocator("iframe").nth(index).locator("body")).toContainText("真实");
    }
    await launched.page.screenshot({ path: path.join(screenshots, "review-result.png"), animations: "disabled" });
    // A close must freeze draft ingress before draining, and stay frozen
    // after ready until the shell either exits or aborts that exact request.
    for (const saveSucceeds of [true, false]) {
      const requestId = `draft-close-${saveSucceeds}`;
      const retainedText = `退出前保留的草稿 ${saveSucceeds}`;
      let releaseSave;
      const saveGate = new Promise((resolve) => { releaseSave = resolve; });
      let saveStarted;
      const saving = new Promise((resolve) => { saveStarted = resolve; });
      const draftRoute = /\/conversation\/draft(?:\?|$)/u;
      await launched.page.route(draftRoute, async (route) => {
        saveStarted(route.request().postDataJSON());
        await saveGate;
        if (saveSucceeds) await route.continue();
        else await route.fulfill({ status: 503, json: { ok: false, code: "FIXTURE_SAVE_UNAVAILABLE" } });
      });
      try {
        await draft.fill(retainedText);
        await launched.page.evaluate((requestId) => {
          window.dispatchEvent(new CustomEvent("stemmio:prepare-close", { detail: {
            requestId, deadlineAt: Date.now() + 15_000,
            waitUntil: (result) => { window.__stemmioDraftCloseCheck = result; },
          } }));
        }, requestId);
        expect((await saving).text).toBe(retainedText);
        await expect(draft).toBeDisabled();
        // Simulate an input event racing the React disabled update. The
        // Controller must reject it even if the DOM temporarily looks enabled.
        await draft.evaluate((element) => { element.disabled = false; });
        await draft.fill("关闭中不应接收的新文字");
        await expect(draft).toHaveValue(retainedText);
        await draft.evaluate((element) => { element.disabled = true; });
        releaseSave();
        const closeResult = await launched.page.evaluate(() => window.__stemmioDraftCloseCheck);
        expect(closeResult.ready).toBe(saveSucceeds);
        if (saveSucceeds) {
          await expect(draft).toBeDisabled();
          await launched.page.evaluate(() => window.dispatchEvent(new CustomEvent("stemmio:close-aborted", {
            detail: { requestId: "unrelated-close-request" },
          })));
          await expect(draft).toBeDisabled();
        } else await expect(draft).toBeEnabled();
      } finally {
        releaseSave();
        await launched.page.unroute(draftRoute);
        await launched.page.evaluate((requestId) => window.dispatchEvent(new CustomEvent("stemmio:close-aborted", {
          detail: { requestId },
        })), requestId);
      }
      await expect(draft).toBeEnabled();
      await draft.fill("下一轮再调整页脚间距");
    }
    await closeStemmioGracefully(launched.electronApp, launched.page);
    launched = await launchStemmio({ isolatedUserData: profile, injectedEnv });
    await launched.page.getByRole("button", { name: /AI 助手/u }).click();
    await expect(launched.page.getByRole("textbox", { name: "修改要求草稿" })).toHaveValue("下一轮再调整页脚间距");
  } finally {
    finish();
    await stopStemmio(launched.electronApp, profile);
    await httpAgent.close();
    removeSourceFixture(fixture.sourceDirectory);
  }
});

test("Codex authenticated component failure repairs in Settings, then reviews and completes two rounds", async () => {
  test.setTimeout(180_000);
  const fixture = createSourceFixture("codex-recovery-journey.html");
  const command = createCodexAcpE2ECommand(fixture.sourceDirectory, { javascript: true });
  const launched = await launchStemmio({ activeSourcePath: fixture.sourcePath, injectedEnv: {
    STEMMIO_CODEX_ACP_ALLOW_TEST_COMMAND: "1", STEMMIO_CODEX_ACP_COMMAND: command,
  } });
  let broken = false;
  let installs = 0;
  try {
    await launched.page.route("**/agent/diagnose?*", async (route) => {
      const selection = JSON.parse(new URL(route.request().url()).searchParams.get("selection") || "{}");
      if (!broken || selection.providerId !== "codex") return route.continue();
      return route.fulfill({ json: { status: "unavailable", diagnostic: {
        readiness: "connection-failed", cause: "CODEX_PREFLIGHT_FAILED", operation: "diagnose",
        facts: { installation: "ready", authentication: "ready", protocol: "failed", service: "unknown" },
      } } });
    });
    await launched.page.route("**/agent/install", async (route) => {
      installs += 1;
      broken = false;
      return route.fulfill({ json: { providerId: "codex", installState: "idle" } });
    });
    const workingPath = await addComment(launched.page, fixture.sourcePath, "调整标题。");
    await launched.page.getByRole("button", { name: /AI 助手/u }).click();
    const settings = await openAgentSettingsPage(launched.page);
    await expandSettingsAgent(settings, "codex");
    await setDefaultSettingsAgent(settings, "codex");
    broken = true;
    await settings.locator(".settings-secondary-action").filter({ hasText: "重新检查" }).click();
    const row = settings.getByTestId("settings-agent-row-codex");
    await expect(row).toContainText("暂时无法使用");
    await expect(row.locator(".settings-agent-default-badge")).toBeVisible();
    await expect(settings.getByTestId("settings-agent-row-stemmio").locator(".settings-agent-service-main")).toContainText("未检查");
    const repairStyle = await row.getByRole("button", { name: "重新检查", exact: true }).evaluate((button) => ({
      fontSize: getComputedStyle(button).fontSize,
      height: button.getBoundingClientRect().height,
      inset: button.getBoundingClientRect().left - button.closest('[data-testid="settings-agent-row-codex"]').getBoundingClientRect().left,
    }));
    expect(repairStyle.fontSize).toBe("12px");
    expect(repairStyle.height).toBe(34);
    expect(repairStyle.inset).toBeLessThanOrEqual(24);
    await expect(row.locator(".qoder-card-copy small")).toHaveCSS("font-size", "13px");
    await launched.page.screenshot({ path: path.join(screenshots, "settings-codex-authenticated-repair.png"), animations: "disabled" });
    await launched.page.getByRole("button", { name: "返回工作台" }).click();
    const sidebar = launched.page.getByTestId("ai-conversation-sidebar");
    await expect(sidebar.getByTestId("ai-conversation-setup-panel")).toHaveCount(0);
    await openAgentSettingsPage(launched.page);
    await expect(settings).toBeVisible();
    const panel = await expandSettingsAgent(settings, "codex");
    await expect(panel).toContainText("账号已登录，但连接检查没有通过。");
    await expect(panel.getByTestId("agent-diagnostic-details")).not.toHaveAttribute("open", "");
    await launched.page.screenshot({ path: path.join(screenshots, "codex-repair-in-settings.png"), animations: "disabled" });
    broken = false;
    await panel.getByRole("button", { name: "重新检查", exact: true }).click();
    await expect(panel).toContainText("已连接");
    expect(installs).toBe(0);
    await launched.page.getByRole("button", { name: "返回工作台" }).click();
    await sidebar.getByRole("button", { name: /交给 Codex 修改/u }).click();
    await expect(sidebar.getByTestId("ai-conversation-action-bar")).toContainText("修改已准备好，尚未采用", { timeout: 60_000 });
    expect(readFileSync(workingPath, "utf8")).not.toContain('data-stemmio-codex-acp="e2e"');
    await sidebar.getByRole("button", { name: "查看修改" }).click();
    await adoptReadyResult(launched.page);
    await expect.poll(async () => (await launched.page.evaluate(() => window.stemmioProjects.getActiveProject()))?.sourcePath)
      .toMatch(/\/codex-recovery-journey\.html$/u);
    const first = await launched.page.evaluate(() => window.stemmioProjects.getActiveProject());
    await loadedDiskFrame(launched.page, first.sourcePath);
    await addComment(launched.page, first.sourcePath, "继续调整标题。");
    if (!await sidebar.isVisible()) await launched.page.getByRole("button", { name: /AI 助手/u }).click();
    await sidebar.getByRole("button", { name: /交给 Codex 修改/u }).click();
    await expect(sidebar.getByTestId("ai-conversation-action-bar")).toContainText("修改已准备好，尚未采用", { timeout: 60_000 });
    expect(readFileSync(fixture.sourcePath).equals(fixture.original)).toBe(true);
    await launched.page.screenshot({ path: path.join(screenshots, "codex-second-round.png"), animations: "disabled" });
  } finally {
    await stopStemmio(launched.electronApp, launched.isolatedUserData);
    removeSourceFixture(fixture.sourceDirectory);
  }
});

test("known incompatible Codex offers other AI without reinstalling the same component", async () => {
  const fixture = createSourceFixture("codex-incompatible-component.html");
  const command = createCodexAcpE2ECommand(fixture.sourceDirectory);
  const launched = await launchStemmio({ activeSourcePath: fixture.sourcePath, injectedEnv: {
    STEMMIO_CODEX_ACP_ALLOW_TEST_COMMAND: "1", STEMMIO_CODEX_ACP_COMMAND: command,
  } });
  let installs = 0;
  try {
    await launched.page.route("**/agent/diagnose?*", async (route) => {
      const selection = JSON.parse(new URL(route.request().url()).searchParams.get("selection") || "{}");
      if (selection.providerId !== "codex") return route.continue();
      return route.fulfill({ json: { status: "unavailable", diagnostic: {
        readiness: "connection-failed", cause: "CODEX_EXECUTION_CONTRACT_UNSUPPORTED", operation: "diagnose",
        facts: { installation: "ready", authentication: "ready", protocol: "failed", service: "unknown" },
      } } });
    });
    await launched.page.route("**/agent/install", async (route) => { installs += 1; await route.abort(); });
    await addComment(launched.page, fixture.sourcePath, "调整标题。");
    await launched.page.getByRole("button", { name: /AI 助手/u }).click();
    const settings = await openAgentSettingsPage(launched.page);
    await expandSettingsAgent(settings, "codex");
    const row = settings.getByTestId("settings-agent-row-codex");
    await expect(row).toContainText("当前 Codex 组件暂不支持完成修改");
    await expect(row).toContainText("账号已登录。");
    await expect(row.getByRole("button", { name: /更新连接组件|修复连接/u })).toHaveCount(0);
    await launched.page.screenshot({ path: path.join(screenshots, "codex-execution-unsupported-settings.png"), animations: "disabled" });
    await row.getByRole("button", { name: "使用其他 AI", exact: true }).click();
    await expect(row).not.toHaveAttribute("data-expanded", "true");
    await launched.page.getByRole("button", { name: "返回工作台" }).click();
    const sidebar = launched.page.getByTestId("ai-conversation-sidebar");
    await expect(sidebar.getByTestId("ai-conversation-setup-panel")).toHaveCount(0);
    await openAgentSettingsPage(launched.page);
    await expect(settings).toBeVisible();
    const panel = await expandSettingsAgent(settings, "codex");
    await expect(panel.getByRole("button", { name: "重新检查", exact: true })).toBeVisible();
    await launched.page.screenshot({ path: path.join(screenshots, "codex-unavailable-settings.png"), animations: "disabled" });
    await panel.getByRole("button", { name: "使用其他 AI", exact: true }).click();
    await expect(settings.getByTestId("settings-agent-row-stemmio")).toHaveAttribute("data-expanded", "true");
    expect(installs).toBe(0);
  } finally {
    await stopStemmio(launched.electronApp, launched.isolatedUserData);
    removeSourceFixture(fixture.sourceDirectory);
  }
});

test("credential recovery actions follow startup or persist facts despite misleading wording", async ({}, testInfo) => {
  test.setTimeout(180_000);
  const fixture = createSourceFixture("credential-recovery.html");
  const httpAgent = await startStemmioHttpAgent();
  const injectedEnv = stemmioHttpAgentEnv(httpAgent.baseUrl);
  let launched = await launchStemmio({ activeSourcePath: fixture.sourcePath, injectedEnv });
  try {
    await loadedDiskFrame(launched.page, fixture.sourcePath);
    const reloadRenderer = async () => {
      // Deferred Bridge readiness is a one-shot startup IPC; carry the same
      // isolated connection into the intentionally re-created test renderer.
      const connection = await launched.page.evaluate(() => window.stemmioRuntime.getBridgeConnection());
      await launched.page.reload();
      await launched.electronApp.evaluate(({ BrowserWindow }, connection) => {
        BrowserWindow.getAllWindows()[0].webContents.send("stemmio-app:bridge-ready", connection);
      }, connection);
      await loadedDiskFrame(launched.page, fixture.sourcePath);
    };
    for (const reason of ["凭证暂时不可读取，请重新连接。", "已连接，但新的 API Key 未保存。"]) {
      await launched.electronApp.evaluate(({ ipcMain }, reason) => {
        ipcMain.removeHandler("html-agent-access:credential-status");
        ipcMain.handle("html-agent-access:credential-status", () => ({
          protocol: "stemmio-project-result", version: 1, ok: true, value: {
          available: true, remembered: false, providerId: "stemmio", status: "unreadable",
          unreadable: true, reconnectRequired: true, code: "AGENT_CREDENTIAL_RESTORE_FAILED", reason,
          },
        }));
      }, reason);
      await reloadRenderer();
      const settings = await openAgentSettingsPage(launched.page);
      await expandSettingsAgent(settings, "stemmio");
      const card = settings.getByTestId("settings-agent-row-stemmio");
      await expect(card.locator(".qoder-card-error")).toContainText(reason);
      await expect(card.getByText("DeepSeek · 已连接", { exact: true })).toHaveCount(0);
      await expect(card.getByRole("textbox", { name: "API Key" })).toBeVisible();
      await expect(card.getByRole("button", { name: "重试保存", exact: true })).toHaveCount(0);
      await expect(card.getByRole("button", { name: "重新连接", exact: true })).toBeVisible();
      await launched.page.getByRole("button", { name: "返回工作台", exact: true }).click();
      await loadedDiskFrame(launched.page, fixture.sourcePath);
    }
    await launched.electronApp.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler("html-agent-access:credential-status");
      ipcMain.handle("html-agent-access:credential-status", () => ({
          protocol: "stemmio-project-result", version: 1, ok: true, value: {
        available: true, remembered: false, providerId: "stemmio", status: "missing",
          },
      }));
    });
    await reloadRenderer();
    let settings = await openAgentSettingsPage(launched.page);
    await expandSettingsAgent(settings, "stemmio");
    let card = settings.getByTestId("settings-agent-row-stemmio");
    for (const [index, reason] of ["本机未能保存，本次连接仍有效。", "无法读取已保存的连接凭证。合成保存失败。"].entries()) {
      if (index > 0) {
        // A failed save deliberately leaves this session connected with only a
        // retry-save action. Give the next failure wording a fresh session.
        await stopStemmio(launched.electronApp, launched.isolatedUserData);
        launched = await launchStemmio({ activeSourcePath: fixture.sourcePath, injectedEnv });
        await loadedDiskFrame(launched.page, fixture.sourcePath);
        settings = await openAgentSettingsPage(launched.page);
        await expandSettingsAgent(settings, "stemmio");
        card = settings.getByTestId("settings-agent-row-stemmio");
      }
      await launched.electronApp.evaluate(({ ipcMain }, reason) => {
        ipcMain.removeHandler("html-agent-access:persist-credential");
        globalThis.__M1_PERSIST_CALLS__ = [];
        ipcMain.handle("html-agent-access:persist-credential", (_event, payload) => {
          globalThis.__M1_PERSIST_CALLS__.push({ operationId: payload.operationId, hasKey: Boolean(payload.apiKey) });
          return { protocol: "stemmio-project-result", version: 1, ok: true, value: {
            ok: false, available: false, status: "unavailable", remembered: false,
            operationId: payload.operationId, code: "AGENT_CREDENTIAL_STORE_UNAVAILABLE", reason } };
        });
      }, reason);
      await card.getByRole("textbox", { name: "API Key" }).fill("sk-e2e-recovery");
      await card.getByRole("checkbox", { name: "在此 Mac 上记住 API Key" }).check();
      await card.getByRole("button", { name: "连接", exact: true }).click();
      await expect(card).toContainText("DeepSeek · 已连接");
      await expect(card.getByRole("button", { name: "重试保存", exact: true })).toBeEnabled();
      await expect(card.getByTestId("agent-credential-summary")).not.toContainText("需要重新连接");
      await card.getByRole("textbox", { name: "API Key" }).fill("");
      await card.getByRole("button", { name: "重试保存", exact: true }).click();
      await expect.poll(() => launched.electronApp.evaluate(() => globalThis.__M1_PERSIST_CALLS__.length)).toBe(2);
      const calls = await launched.electronApp.evaluate(() => globalThis.__M1_PERSIST_CALLS__);
      expect(calls[0].hasKey && calls[1].hasKey).toBe(true);
      await expect(card.getByRole("button", { name: "重试保存", exact: true })).toBeEnabled();
      await expect(card).toContainText("DeepSeek · 已连接");
    }
    await launched.page.screenshot({ path: testInfo.outputPath("credential-recovery-persist.png"), animations: "disabled" });
  } finally {
    await stopStemmio(launched.electronApp, launched.isolatedUserData);
    await httpAgent.close();
    removeSourceFixture(fixture.sourceDirectory);
  }
});

import { expect, test } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { appendConversationTurnMessage } from "../../../shared/conversation.mjs";
import {
  QODER_VISUAL_OUTPUT,
  addComment,
  candidateHtmlFiles,
  chooseModifyIntent,
  closeQoderAvailability,
  createCodexAcpE2ECommand,
  createQoderAcpE2ECommand,
  createSourceFixture,
  existsSync,
  expandSettingsAgent,
  launchStemmio,
  managedProjectRoots,
  mkdirSync,
  openAgentSettingsPage,
  openQoderAvailability,
  stemmioHttpAgentEnv,
  path,
  productRoot,
  readFileSync,
  realpathSync,
  readdirSync,
  removeSourceFixture,
  setDefaultSettingsAgent,
  startStemmioHttpAgent,
  stopStemmio,
} from "./ai-closed-loop-helpers.mjs";

const AI_ASSISTANT_VISUAL_OUTPUT = path.join(
  productRoot,
  "output/design-qa/ai-assistant-redesign",
);
mkdirSync(AI_ASSISTANT_VISUAL_OUTPUT, { recursive: true });

test("Qoder ACP Agent Bridge streams public execution text without clipboard or automatic adoption", {
  tag: ["@smoke-provider"],
}, async () => {
  test.setTimeout(180_000);
  const fixture = createSourceFixture("qoder-acp-agent-bridge.html");
  const qoderCommand = createQoderAcpE2ECommand(fixture.sourceDirectory, {
    visibleText: true,
    visibleTextGateMs: 700,
  });
  const launched = await launchStemmio({
    activeSourcePath: fixture.sourcePath,
    injectedEnv: {
      STEMMIO_QODER_ACP_ALLOW_TEST_COMMAND: "1",
      STEMMIO_QODER_ACP_COMMAND: qoderCommand,
    },
  });
  try {
    const clipboardSentinel = "STEMMIO_QODER_ACP_MUST_NOT_COPY";
    await launched.electronApp.evaluate(
      ({ clipboard }, value) => clipboard.writeText(value),
      clipboardSentinel,
    );
    await launched.electronApp.evaluate(({ clipboard }) => {
      const originalWriteText = clipboard.writeText.bind(clipboard);
      globalThis.__stemmioE2EClipboardWrites = [];
      clipboard.writeText = (value, type) => {
        globalThis.__stemmioE2EClipboardWrites.push({ value, type: type || null });
        return originalWriteText(value, type);
      };
    });
    const workingCopyPath = await addComment(
      launched.page,
      fixture.sourcePath,
      "请完成 Qoder ACP 自动闭环，但不要直接覆盖当前 HTML。",
    );
    await launched.page.getByRole("button", { name: /AI 助手/u }).click();
    // Availability checks now belong to Settings. Return to the conversation
    // only after the selected Agent has a fresh readiness result.
    const qoderSettingsCard = await openQoderAvailability(launched.page);
    await expect(qoderSettingsCard.getByText("已连接", { exact: true }))
      .toBeVisible({ timeout: 60_000 });
    await closeQoderAvailability(launched.page);
    // Destination and the local-Agent action live in one compact Composer row.
    const deliveryDialog = await chooseModifyIntent(launched.page);
    await expect(deliveryDialog.getByTestId("ai-conversation-agent"))
      .toContainText("Qoder");
    await expect(deliveryDialog.getByTestId("ai-conversation-context-summary"))
      .toContainText("1 条修改意见");
    await expect(deliveryDialog.getByText("AGENT BRIDGE", { exact: true })).toHaveCount(0);
    await expect(deliveryDialog.getByText("可信本机 Agent 提示", { exact: true }))
      .toHaveCount(0);
    await deliveryDialog.getByRole("button", { name: /交给 Qoder 修改/u }).click();

    const narration = launched.page.getByTestId("ai-conversation-narration-message");
    await expect(narration).toBeVisible({ timeout: 60_000 });
    await expect(narration).toHaveCount(1);
    await expect(launched.page.getByTestId("ai-conversation-thinking")).toBeVisible();
    await expect(narration).toContainText("正在读取冻结任务。");
    await expect(narration).not.toContainText("正在等待校验。");
    await expect(narration).toContainText(
      "正在读取冻结任务。正在写入 Candidate。正在等待校验。",
      { timeout: 60_000 },
    );
    await expect(narration.getByTestId("ai-conversation-narration").locator("p"))
      .toHaveCount(3);
    await expect(launched.page.getByTestId("ai-conversation-thinking")).toHaveCount(0);
    await expect.poll(() => launched.page.getByTestId("ai-conversation-stream").evaluate(
      (stream) => Math.round(stream.scrollHeight - stream.clientHeight - stream.scrollTop),
    )).toBeLessThanOrEqual(1);
    await launched.page.screenshot({
      path: path.join(AI_ASSISTANT_VISUAL_OUTPUT, "qoder-processing-thinking.png"),
      fullPage: false,
      animations: "disabled",
    });
    await expect(narration.getByRole("button", { name: "复制" })).toBeVisible();
    await expect(narration).not.toContainText("Build Stemmio Candidate");
    await expect(launched.page.getByTestId("ai-conversation-run-summary"))
      .toHaveCount(0);

    await expect(launched.page.getByTestId("ai-conversation-action-bar"))
      .toContainText("修改已准备好，尚未采用", { timeout: 60_000 });
    await expect(launched.page.getByTestId("ai-conversation-thinking")).toHaveCount(0);
    await expect.poll(() => launched.page.getByTestId("ai-conversation-stream").evaluate(
      (stream) => Math.round(stream.scrollHeight - stream.clientHeight - stream.scrollTop),
    )).toBeLessThanOrEqual(1);
    const process = launched.page.locator('[data-testid="ai-turn-process"][data-actor="agent"]')
      .filter({ hasText: "正在读取本轮资料" }).first();
    await expect(process).toBeVisible();
    await expect(process.locator("summary")).toHaveCount(0);
    await expect(process).toContainText("Qoder");
    await expect(launched.page.getByTestId("ai-conversation-message").filter({ hasText: "正在读取冻结任务。正在写入 Candidate。正在等待校验。" })).toHaveCount(1);
    await expect(process.locator("li").first()).toBeVisible();
    const processTime = process.locator("time").first();
    await launched.page.mouse.move(0, 0);
    await expect(processTime).toHaveCSS("opacity", "0");
    await processTime.hover();
    await expect(processTime).toHaveCSS("opacity", "1");
    const agentMessage = launched.page.locator('[data-testid="ai-conversation-message"][data-actor="agent"]').last();
    const copyMetadata = agentMessage.getByRole("button", { name: "复制", exact: true }).locator('..');
    await launched.page.mouse.move(0, 0);
    await expect(copyMetadata).toHaveCSS("opacity", "0");
    await agentMessage.hover();
    await expect(copyMetadata).toHaveCSS("opacity", "1");
    await launched.page.screenshot({ path: path.join(AI_ASSISTANT_VISUAL_OUTPUT, "trusted-loop-process-expanded.png"), animations: "disabled" });
    const readyGeometry = await launched.page.evaluate(() => {
      const sidebar = document.querySelector('[data-testid="ai-conversation-sidebar"]');
      const composer = document.querySelector('[data-testid="ai-conversation-composer"]');
      const selector = document.querySelector('[data-testid="ai-conversation-agent"]');
      const actions = document.querySelector('[data-testid="ai-conversation-copy-task"]')
        ?.parentElement;
      const bounds = (element) => element?.getBoundingClientRect() || null;
      return {
        viewport: { width: window.innerWidth, height: window.innerHeight },
        documentOverflowX: document.documentElement.scrollWidth
          > document.documentElement.clientWidth,
        sidebar: bounds(sidebar),
        composer: bounds(composer),
        selector: bounds(selector),
        actions: bounds(actions),
      };
    });
    expect(readyGeometry.documentOverflowX).toBe(false);
    expect(readyGeometry.sidebar.right).toBeLessThanOrEqual(readyGeometry.viewport.width);
    expect(readyGeometry.composer.bottom).toBeLessThanOrEqual(readyGeometry.viewport.height);
    if (readyGeometry.actions) {
      const selectorCenter = readyGeometry.selector.top + readyGeometry.selector.height / 2;
      const actionsCenter = readyGeometry.actions.top + readyGeometry.actions.height / 2;
      expect(Math.abs(selectorCenter - actionsCenter)).toBeLessThanOrEqual(1);
    }
    // The current decision must remain outside history at every supported width.
    for (const width of [340, 400, 480]) {
      const sidebar = launched.page.getByTestId("ai-conversation-sidebar");
      const resizer = launched.page.getByTestId("workbench-resizer-inspector");
      const handle = await resizer.boundingBox();
      const currentWidth = (await sidebar.boundingBox()).width;
      const x = handle.x + handle.width / 2;
      const y = handle.y + Math.min(80, handle.height / 2);
      await launched.page.mouse.move(x, y);
      await launched.page.mouse.down();
      // A real Conversation refresh during capture must not cancel the drag.
      await launched.page.waitForResponse((response) => new URL(response.url()).pathname === "/conversation");
      await launched.page.mouse.move(x + currentWidth - width, y, { steps: 8 });
      await launched.page.mouse.up();
      const action = launched.page.getByTestId("ai-conversation-action-bar");
      await expect(action).toBeVisible();
      const composerBounds = await launched.page.getByTestId("ai-conversation-composer").boundingBox();
      const layer = action.locator('..');
      const layerBounds = await layer.boundingBox();
      expect(layerBounds.width).toBeLessThan(composerBounds.width - 24);
      expect(layerBounds.x).toBeGreaterThan(composerBounds.x + 10);
      expect(await layer.evaluate(element => getComputedStyle(element).backgroundColor)).toBe("rgba(255, 255, 255, 0.38)");
      expect(await action.evaluate((element) => element.closest('[data-testid="ai-conversation-stream"]') === null)).toBe(true);
      await expect.poll(async () => Math.abs((await sidebar.boundingBox()).width - width)).toBeLessThanOrEqual(2);
      await launched.page.screenshot({ path: path.join(AI_ASSISTANT_VISUAL_OUTPUT, `trusted-loop-pr6-ready-${width}.png`), animations: "disabled" });
    }
    const resizer = launched.page.getByTestId("workbench-resizer-inspector");
    await resizer.focus();
    await resizer.press("ArrowRight");
    await expect(resizer).toHaveAttribute("aria-valuenow", "464");
    await expect(resizer).toBeFocused();
    const unzoomedWidth = await launched.page.evaluate(() => innerWidth);
    await launched.electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(2));
    await expect.poll(() => launched.page.evaluate(() => innerWidth)).toBeLessThan(unzoomedWidth);
    await expect(launched.page.getByTestId("ai-conversation-action-bar")).toBeVisible();
    await expect.poll(() => launched.page.getByTestId("ai-conversation-sidebar").evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      const stage = element.closest(".review-scroll-stage").getBoundingClientRect();
      return bounds.left >= stage.left - 1 && bounds.right <= innerWidth + 1 && bounds.bottom <= innerHeight + 1 && element.scrollWidth <= element.clientWidth + 1;
    })).toBe(true);
    await expect(launched.page.getByRole("button", { name: "收起会话面板", exact: true })).toBeInViewport();
    await launched.page.getByRole("button", { name: "收起会话面板", exact: true }).focus();
    await expect.poll(() => launched.page.locator(".workbench").evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" ")[0])).toBe("0px");
    const zoomCapture = await launched.electronApp.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString("base64"));
    writeFileSync(path.join(AI_ASSISTANT_VISUAL_OUTPUT, "trusted-loop-pr8-zoom-200.png"), zoomCapture, "base64");
    await launched.electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1));
    // This section exercises history presentation. Inject read responses rather
    // than adding a second writer to the Bridge-owned conversation files.
    const syntheticMessages = [];
    await launched.page.route(/\/conversation(?:\?|$)/u, async (route) => {
      const response = await route.fetch();
      const payload = await response.json();
      let conversation = payload.conversation;
      const turnId = conversation?.turns[0]?.turnId;
      if (turnId) for (const message of syntheticMessages) {
        conversation = appendConversationTurnMessage(conversation, { turnId, message }, { now: () => message.createdAt });
      }
      await route.fulfill({ response, json: { ...payload, conversation } });
    });
    const appendSyntheticHistory = (count, prefix) => {
      for (let index = 0; index < count; index += 1) syntheticMessages.push({
        messageId: `message_${prefix}_${index}`, actor: "stemmio", kind: "text", status: "completed",
        text: `长历史验收 ${prefix} ${index}：` + "这是合成测试的公开摘要。".repeat(20),
        createdAt: new Date().toISOString(),
      });
    };
    await appendSyntheticHistory(20, "long_history_fixture");
    const stream = launched.page.getByTestId("ai-conversation-stream");
    await expect(stream).toContainText("长历史验收 long_history_fixture 19");
    await stream.evaluate((element) => { element.scrollTop = 0; element.dispatchEvent(new Event("scroll", { bubbles: true })); });
    await appendSyntheticHistory(1, "new_tail_fixture");
    await expect(stream).toContainText("长历史验收 new_tail_fixture 0");
    expect(await stream.evaluate((element) => element.scrollTop)).toBeLessThan(2);
    await expect(launched.page.getByTestId("ai-conversation-unseen-content")).toBeVisible();
    await expect(launched.page.getByTestId("ai-conversation-action-bar")).toBeVisible();
    await launched.page.screenshot({ path: path.join(AI_ASSISTANT_VISUAL_OUTPUT, "trusted-loop-pr8-long-history.png"), animations: "disabled" });
    await launched.page.getByTestId("ai-conversation-unseen-content").click();
    await expect.poll(() => stream.evaluate((element) => element.scrollHeight - element.clientHeight - element.scrollTop)).toBeLessThanOrEqual(2);
    await launched.page.screenshot({
      path: path.join(AI_ASSISTANT_VISUAL_OUTPUT, "qoder-result-ready.png"),
      fullPage: false,
      animations: "disabled",
    });
    // Observe Stemmio's Electron clipboard API directly instead of reading the
    // shared system clipboard, which another desktop app may legitimately change.
    expect(await launched.electronApp.evaluate(
      () => globalThis.__stemmioE2EClipboardWrites,
    )).toEqual([]);
    expect(readFileSync(fixture.sourcePath).equals(fixture.original)).toBe(true);
    expect(readFileSync(workingCopyPath, "utf8")).not.toContain(
      "data-stemmio-qoder-acp",
    );

    const projectRoot = managedProjectRoots(launched.workspace).find(
      (root) => realpathSync(workingCopyPath).startsWith(
        `${realpathSync(root)}${path.sep}`,
      ),
    );
    expect(projectRoot).toBeTruthy();
    const projectRecord = JSON.parse(readFileSync(
      path.join(projectRoot, ".stemmio", "project.json"),
      "utf8",
    ));
    const candidates = candidateHtmlFiles(
      launched.workspace,
      projectRecord.projectId,
    );
    expect(candidates).toHaveLength(1);
    const qoderCandidate = readFileSync(candidates[0], "utf8");
    expect(qoderCandidate).toContain('data-stemmio-qoder-acp="e2e"');
    expect(qoderCandidate).toContain("Qoder \u5df2\u66f4\u65b0\uff1a\u771f\u5b9e");

    await launched.page.getByRole("button", { name: "查看修改" }).click();
    await expect(launched.page.getByTestId("ai-review-workspace"))
      .toBeVisible({ timeout: 30_000 });
    expect(readFileSync(workingCopyPath, "utf8")).not.toContain(
      "data-stemmio-qoder-acp",
    );
  } finally {
    try {
      // Finish intercepted history reads before shutting down their Bridge.
      await launched.page.unrouteAll({ behavior: "wait" });
    } finally {
      await stopStemmio(launched.electronApp, launched.isolatedUserData);
      removeSourceFixture(fixture.sourceDirectory);
    }
  }
});

test("Codex ACP shares the public execution stream and retains its frozen identity", {
  tag: ["@smoke-provider"],
}, async () => {
  test.setTimeout(180_000);
  const fixture = createSourceFixture("codex-acp-agent-bridge.html");
  const codexCommand = createCodexAcpE2ECommand(fixture.sourceDirectory, {
    visibleText: true,
    visibleTextGateMs: 700,
  });
  const qoderCommand = createQoderAcpE2ECommand(fixture.sourceDirectory);
  const launched = await launchStemmio({
    activeSourcePath: fixture.sourcePath,
    injectedEnv: {
      STEMMIO_QODER_ACP_ALLOW_TEST_COMMAND: "1",
      STEMMIO_QODER_ACP_COMMAND: qoderCommand,
      STEMMIO_CODEX_ACP_ALLOW_TEST_COMMAND: "1",
      STEMMIO_CODEX_ACP_COMMAND: codexCommand,
    },
  });
  try {
    const workingCopyPath = await addComment(
      launched.page,
      fixture.sourcePath,
      "请完成 Codex ACP 自动闭环，但不要直接覆盖当前 HTML。",
    );
    await launched.page.getByRole("button", { name: /AI 助手/u }).click();
    const sidebar = await chooseModifyIntent(launched.page);
    await expect(sidebar.getByTestId("ai-conversation-agent"))
      .toContainText("Qoder", { timeout: 60_000 });
    await openQoderAvailability(launched.page);
    const settingsPage = launched.page.locator(".workbench-settings-page");
    await expandSettingsAgent(settingsPage, "codex");
    await expect(settingsPage.getByTestId("settings-agent-row-codex")
      .getByText("已连接", { exact: true }))
      .toBeVisible({ timeout: 60_000 });
    await setDefaultSettingsAgent(settingsPage, "codex");
    await expect(settingsPage.locator(".qoder-availability-card")).toHaveCount(0);
    await launched.page.screenshot({
      path: path.join(AI_ASSISTANT_VISUAL_OUTPUT, "agent-selector-open.png"),
      fullPage: false,
      animations: "disabled",
    });
    await launched.page.getByRole("button", { name: "返回工作台" }).click();
    await expect(sidebar.getByTestId("ai-conversation-agent"))
      .toContainText("Codex", { timeout: 60_000 });
    await expect(sidebar.getByRole("button", { name: /交给 Codex 修改/u }))
      .toBeEnabled({ timeout: 60_000 });
    await sidebar.getByRole("button", { name: /交给 Codex 修改/u }).click();

    const narration = launched.page.getByTestId("ai-conversation-narration-message");
    await expect(narration).toBeVisible({ timeout: 60_000 });
    await expect(narration).toHaveCount(1);
    await expect(narration).toContainText("先读取冻结任务。");
    await expect(narration).not.toContainText("最后等待校验。");
    await expect(narration).toContainText("Codex", { timeout: 10_000 });
    await expect(narration.locator("img")).toHaveCount(0);
    await expect(narration).not.toContainText("这段推理不能进入 Stemmio 侧栏。");

    // A frozen running round exposes no Agent switch control. Its identity
    // remains Codex until this execution completes.
    await expect(sidebar.getByTestId("ai-conversation-agent")).toContainText("Codex");
    await expect(narration).toContainText("Codex");
    await expect(narration).toContainText(
      "先读取冻结任务。再写入 Candidate。最后等待校验。",
      { timeout: 60_000 },
    );
    await expect(narration.getByTestId("ai-conversation-narration").locator("p"))
      .toHaveCount(3);
    await expect(launched.page.getByTestId("ai-conversation-thinking")).toHaveCount(0);
    await expect(launched.page.getByTestId("ai-conversation-action-bar"))
      .toContainText("修改已准备好，尚未采用", { timeout: 60_000 });
    const decisionAnnouncement = launched.page
      .getByTestId("ai-conversation-action-bar")
      .getByRole("status");
    await expect(decisionAnnouncement).toHaveText(/修改已准备好，尚未采用/u);
    await expect(decisionAnnouncement).toHaveAttribute("aria-live", "polite");
    await expect(launched.page.getByTestId("ai-conversation-thinking")).toHaveCount(0);
    expect(readFileSync(fixture.sourcePath).equals(fixture.original)).toBe(true);
    expect(readFileSync(workingCopyPath, "utf8")).not.toContain(
      "data-stemmio-codex-acp",
    );

    const projectRoot = managedProjectRoots(launched.workspace).find(
      (root) => realpathSync(workingCopyPath).startsWith(
        `${realpathSync(root)}${path.sep}`,
      ),
    );
    expect(projectRoot).toBeTruthy();
    const projectRecord = JSON.parse(readFileSync(
      path.join(projectRoot, ".stemmio", "project.json"),
      "utf8",
    ));
    const candidates = candidateHtmlFiles(
      launched.workspace,
      projectRecord.projectId,
    );
    expect(candidates).toHaveLength(1);
    const codexCandidate = readFileSync(candidates[0], "utf8");
    expect(codexCandidate).toContain('data-stemmio-codex-acp="e2e"');
    expect(codexCandidate).toContain("Codex \u5df2\u66f4\u65b0\uff1a\u771f\u5b9e");

    await launched.page.getByRole("button", { name: "查看修改" }).click();
    await expect(launched.page.getByTestId("ai-review-workspace"))
      .toBeVisible({ timeout: 30_000 });
  } finally {
    await stopStemmio(launched.electronApp, launched.isolatedUserData);
    removeSourceFixture(fixture.sourceDirectory);
  }
});

test("源页 Agent settings stays a Token card and does not block switching back to Qoder", {
  tag: ["@smoke-provider"],
}, async () => {
  test.setTimeout(120_000);
  const fixture = createSourceFixture("stemmio-http-settings.html");
  const qoderCommand = createQoderAcpE2ECommand(fixture.sourceDirectory);
  const launched = await launchStemmio({
    activeSourcePath: fixture.sourcePath,
    injectedEnv: {
      STEMMIO_QODER_ACP_ALLOW_TEST_COMMAND: "1",
      STEMMIO_QODER_ACP_COMMAND: qoderCommand,
    },
  });
  try {
    await launched.page.getByRole("button", { name: /AI 助手/u }).click();
    await openQoderAvailability(launched.page);
    const settingsPage = launched.page.locator(".workbench-settings-page");
    await settingsPage.getByTestId("settings-agent-row-action-stemmio").click();
    const stemmioCard = settingsPage.getByTestId("settings-agent-row-stemmio");
    await expect(stemmioCard.getByText("未连接", { exact: true }))
      .toBeVisible({ timeout: 20_000 });
    await expect(stemmioCard.getByRole("textbox", { name: "API Key" })).toBeVisible();
    await expect(stemmioCard.getByText("其他服务商")).toBeVisible();
    await expect(stemmioCard.getByTestId("settings-agent-vendor")).toBeHidden();
    await expect(stemmioCard.getByRole("button", { name: "获取 API Key" })).toBeVisible();
    await expect(settingsPage.getByText("只接通当前选中的 Agent。")).toHaveCount(0);
    await expect(settingsPage.getByRole("button", { name: "重新检查" })).toBeVisible();
    await expect(settingsPage.locator(".qoder-availability-card")).toHaveCount(0);
    await settingsPage.getByTestId("settings-agent-row-action-qoder").click();
    await expect(settingsPage.getByTestId("settings-agent-row-qoder")
      .getByText("已连接", { exact: true }))
      .toBeVisible({ timeout: 60_000 });
    await launched.page.getByRole("button", { name: "返回工作台" }).click();
    await expect(launched.page.getByTestId("ai-conversation-agent"))
      .toContainText("Qoder", { timeout: 20_000 });
    await expect(launched.page.getByTestId("ai-conversation-reasoning")).toHaveCount(0);
  } finally {
    await stopStemmio(launched.electronApp, launched.isolatedUserData);
    removeSourceFixture(fixture.sourceDirectory);
  }
});

test("源页 Agent connects to one verified fixed model and reviews a Candidate", {
  tag: ["@smoke-provider"],
}, async () => {
  test.setTimeout(180_000);
  const fixture = createSourceFixture("stemmio-http-agent-bridge.html");
  const qoderCommand = createQoderAcpE2ECommand(fixture.sourceDirectory);
  let releaseStream;
  const streamObserved = new Promise((resolve) => { releaseStream = resolve; });
  const httpAgent = await startStemmioHttpAgent({
    // Keep the real stream open until the UI observes bytes. A sub-second
    // fixture can finish between polls and remove the progress row entirely.
    beforeStreamComplete: () => streamObserved,
    rejectedApiKeys: ["sk-e2e-invalid-replacement"],
    streamDelayMs: 150,
  });
  const launched = await launchStemmio({
    activeSourcePath: fixture.sourcePath,
    injectedEnv: {
      STEMMIO_QODER_ACP_ALLOW_TEST_COMMAND: "1",
      STEMMIO_QODER_ACP_COMMAND: qoderCommand,
      ...stemmioHttpAgentEnv(httpAgent.baseUrl),
    },
  });
  try {
    const workingCopyPath = await addComment(
      launched.page,
      fixture.sourcePath,
      "请完成源页 Agent 自动闭环，但不要直接覆盖当前 HTML。",
    );
    await launched.page.getByRole("button", { name: /AI 助手/u }).click();
    const settingsPage = await openAgentSettingsPage(launched.page);
    await settingsPage.getByTestId("settings-agent-row-action-stemmio").click();
    const stemmioCard = settingsPage.getByTestId("settings-agent-row-stemmio");
    await expect(stemmioCard.getByText("未连接", { exact: true }))
      .toBeVisible({ timeout: 20_000 });
    await stemmioCard.getByRole("textbox", { name: "API Key" }).fill("sk-e2e-stemmio");
    await stemmioCard.getByRole("button", { name: "连接", exact: true }).click();
    await expect(stemmioCard.getByText("DeepSeek · 已连接", { exact: true }))
      .toBeVisible({ timeout: 30_000 });
    await expect(stemmioCard.locator(".settings-agent-service-main")).toContainText("DeepSeek");
    await setDefaultSettingsAgent(settingsPage, "stemmio");
    await stemmioCard.getByRole("button", { name: "更换 API Key" }).click();
    await expect(stemmioCard.getByTestId("agent-credential-summary")).toContainText("仅本次使用");
    await stemmioCard.getByText("其他服务商").click();
    await expect(stemmioCard.getByTestId("settings-agent-vendor")).toBeVisible();
    await stemmioCard.getByRole("textbox", { name: "API Key" }).fill("sk-e2e-invalid-replacement");
    await stemmioCard.getByRole("button", { name: "连接", exact: true }).click();
    await expect(stemmioCard.getByText(/Token 无效|API Key 无效|Token 没有接通/u))
      .toBeVisible({ timeout: 20_000 });
    await expect(stemmioCard.getByText("DeepSeek · 已连接", { exact: true })).toBeVisible();
    await expect(stemmioCard.locator(".settings-agent-service-main")).toContainText("DeepSeek");
    await launched.page.screenshot({
      path: path.join(AI_ASSISTANT_VISUAL_OUTPUT, "stemmio-settings-connected.png"),
      fullPage: false,
      animations: "disabled",
    });
    await launched.page.getByRole("button", { name: "返回工作台" }).click();
    const sidebar = await chooseModifyIntent(launched.page);
    await expect(sidebar.getByTestId("ai-conversation-agent"))
      .toContainText("DeepSeek", { timeout: 20_000 });
    await expect(sidebar.getByTestId("ai-conversation-model")).toHaveCount(0);
    await expect(sidebar.getByTestId("ai-conversation-agent"))
      .toContainText("V4 Pro");
    await expect(sidebar.getByTestId("ai-conversation-model-choices")).toHaveCount(0);
    await expect(sidebar.getByTestId("ai-conversation-reasoning")).toHaveCount(0);
    await launched.page.screenshot({
      path: path.join(AI_ASSISTANT_VISUAL_OUTPUT, "stemmio-composer-ready.png"),
      fullPage: false,
      animations: "disabled",
    });
    await expect(sidebar.getByRole("button", { name: /交给 源页 修改/u }))
      .toBeEnabled();
    await sidebar.getByRole("button", { name: /交给 源页 修改/u }).click();
    const streamingProgress = launched.page.getByTestId("ai-conversation-execution-status");
    await expect(streamingProgress).toHaveText(/\d{2}:\d{2} · \d+ KB/u, { timeout: 30_000 });
    await expect(streamingProgress.locator("details")).toHaveCount(0);
    await expect(streamingProgress).not.toContainText("正在生成");
    await expect(streamingProgress).not.toContainText("正在接收结果");
    await expect(streamingProgress).not.toContainText("完整结果校验后可查看");
    await expect(streamingProgress).not.toContainText("fixture-hidden");
    await expect(launched.page.getByTestId("ai-conversation-run-progress")).toHaveCount(0);
    releaseStream();
    await expect(launched.page.locator(".toast.show")).toHaveCount(0);
    await expect(launched.page.getByTestId("ai-conversation-action-bar"))
      .toContainText("修改已准备好，尚未采用", { timeout: 60_000 });
    const readyGeometry = await launched.page.evaluate(() => {
      const sidebarNode = document.querySelector('[data-testid="ai-conversation-sidebar"]');
      const composer = document.querySelector('[data-testid="ai-conversation-composer"]');
      const selector = document.querySelector('[data-testid="ai-conversation-agent"]');
      const actions = document.querySelector('[data-testid="ai-conversation-copy-task"]')
        ?.parentElement;
      const bounds = (element) => element?.getBoundingClientRect() || null;
      return {
        viewport: { width: window.innerWidth, height: window.innerHeight },
        documentOverflowX: document.documentElement.scrollWidth
          > document.documentElement.clientWidth,
        sidebar: bounds(sidebarNode),
        composer: bounds(composer),
        selector: bounds(selector),
        actions: bounds(actions),
      };
    });
    expect(readyGeometry.documentOverflowX).toBe(false);
    expect(readyGeometry.sidebar.right).toBeLessThanOrEqual(readyGeometry.viewport.width);
    expect(readyGeometry.composer.bottom).toBeLessThanOrEqual(readyGeometry.viewport.height);
    if (readyGeometry.actions) {
      const selectorCenter = readyGeometry.selector.top + readyGeometry.selector.height / 2;
      const actionsCenter = readyGeometry.actions.top + readyGeometry.actions.height / 2;
      expect(Math.abs(selectorCenter - actionsCenter)).toBeLessThanOrEqual(1);
    }
    await launched.page.screenshot({
      path: path.join(AI_ASSISTANT_VISUAL_OUTPUT, "stemmio-result-ready.png"),
      fullPage: false,
      animations: "disabled",
    });
    expect(readFileSync(fixture.sourcePath).equals(fixture.original)).toBe(true);
    expect(readFileSync(workingCopyPath, "utf8")).not.toContain(
      "data-stemmio-http-agent",
    );
    const projectRoot = managedProjectRoots(launched.workspace).find(
      (root) => realpathSync(workingCopyPath).startsWith(
        `${realpathSync(root)}${path.sep}`,
      ),
    );
    expect(projectRoot).toBeTruthy();
    const projectRecord = JSON.parse(readFileSync(
      path.join(projectRoot, ".stemmio", "project.json"),
      "utf8",
    ));
    const candidates = candidateHtmlFiles(
      launched.workspace,
      projectRecord.projectId,
    );
    expect(candidates).toHaveLength(1);
    const stemmioCandidate = readFileSync(candidates[0], "utf8");
    expect(stemmioCandidate).toContain('data-stemmio-http-agent="e2e"');
    expect(stemmioCandidate).toContain('data-stemmio-http-reasoning="auto"');
    expect(stemmioCandidate).toContain("源页已更新：真实");
    await launched.page.getByRole("button", { name: "查看修改" }).click();
    await expect(launched.page.getByTestId("ai-review-workspace"))
      .toBeVisible({ timeout: 30_000 });
    expect(readFileSync(workingCopyPath, "utf8")).not.toContain(
      "data-stemmio-http-agent",
    );
  } finally {
    releaseStream();
    await stopStemmio(launched.electronApp, launched.isolatedUserData);
    removeSourceFixture(fixture.sourceDirectory);
    await httpAgent.close();
  }
});

test("源页运行时余额失败 offers only provider recovery without a false resend", {
  tag: ["@smoke-provider"],
}, async () => {
  test.setTimeout(180_000);
  const fixture = createSourceFixture("stemmio-http-runtime-balance.html");
  const httpAgent = await startStemmioHttpAgent({ mode: "runtime-balance" });
  const launched = await launchStemmio({
    activeSourcePath: fixture.sourcePath,
    injectedEnv: stemmioHttpAgentEnv(httpAgent.baseUrl),
  });
  try {
    await addComment(
      launched.page,
      fixture.sourcePath,
      "余额失败时保留源页并提供真实可恢复操作。",
    );
    await launched.page.getByRole("button", { name: /AI 助手/u }).click();
    const settingsPage = await openAgentSettingsPage(launched.page);
    await settingsPage.getByTestId("settings-agent-row-action-stemmio").click();
    const stemmioCard = settingsPage.getByTestId("settings-agent-row-stemmio");
    await stemmioCard.getByRole("textbox", { name: "API Key" }).fill("sk-e2e-balance");
    await stemmioCard.getByRole("button", { name: "连接", exact: true }).click();
    await expect(stemmioCard.getByText("DeepSeek · 已连接", { exact: true }))
      .toBeVisible({ timeout: 30_000 });
    await setDefaultSettingsAgent(settingsPage, "stemmio");
    await launched.page.getByRole("button", { name: "返回工作台" }).click();
    const sidebar = await chooseModifyIntent(launched.page);
    await sidebar.getByRole("button", { name: /交给 源页 修改/u }).click();

    const actionBar = launched.page.getByTestId("ai-conversation-action-bar");
    await expect(actionBar).toContainText("生成失败", { timeout: 60_000 });
    await expect(actionBar).toContainText("页面未修改");
    await expect(actionBar.getByRole("button")).toHaveCount(2);
    await expect(actionBar.getByRole("button", { name: "切换 Agent" })).toBeVisible();
    await expect(actionBar.getByRole("button", { name: "复制任务" })).toBeVisible();
    await expect(actionBar.getByRole("button", { name: "重新发送" })).toHaveCount(0);
    await expect(launched.page.locator(".toast.show")).toHaveCount(0);
    expect(readFileSync(fixture.sourcePath)).toEqual(fixture.original);
    const projectRoot = managedProjectRoots(launched.workspace)[0];
    const projectId = JSON.parse(readFileSync(
      path.join(projectRoot, ".stemmio", "project.json"),
      "utf8",
    )).projectId;
    expect(candidateHtmlFiles(launched.workspace, projectId)).toHaveLength(0);
  } finally {
    await stopStemmio(launched.electronApp, launched.isolatedUserData);
    removeSourceFixture(fixture.sourceDirectory);
    await httpAgent.close();
  }
});

test("源页 Agent keeps the Token card and next step when the Token is rejected", {
  tag: ["@smoke-provider"],
}, async () => {
  test.setTimeout(120_000);
  const fixture = createSourceFixture("stemmio-http-auth-required.html");
  const qoderCommand = createQoderAcpE2ECommand(fixture.sourceDirectory);
  const httpAgent = await startStemmioHttpAgent({ mode: "auth-required" });
  const launched = await launchStemmio({
    activeSourcePath: fixture.sourcePath,
    injectedEnv: {
      STEMMIO_QODER_ACP_ALLOW_TEST_COMMAND: "1",
      STEMMIO_QODER_ACP_COMMAND: qoderCommand,
      ...stemmioHttpAgentEnv(httpAgent.baseUrl),
    },
  });
  try {
    await addComment(
      launched.page,
      fixture.sourcePath,
      "Token 无效时不应创建本轮任务。",
    );
    await launched.page.getByRole("button", { name: /AI 助手/u }).click();
    const settingsPage = await openAgentSettingsPage(launched.page);
    await settingsPage.getByTestId("settings-agent-row-action-stemmio").click();
    const stemmioCard = settingsPage.getByTestId("settings-agent-row-stemmio");
    await stemmioCard.getByRole("textbox", { name: "API Key" }).fill("sk-e2e-invalid");
    await stemmioCard.getByRole("button", { name: "连接", exact: true }).click();
    await expect(stemmioCard.getByText(/Token 无效|API Key 无效|Token 没有接通/u))
      .toBeVisible({ timeout: 20_000 });
    await expect(stemmioCard.getByText("未连接", { exact: true })).toBeVisible();
    await launched.page.getByRole("button", { name: "返回工作台" }).click();
    const sidebar = launched.page.getByTestId("ai-conversation-sidebar");
    await expect(sidebar.getByTestId("ai-conversation-service-choices")).toHaveCount(0);
    await openAgentSettingsPage(launched.page);
    await expect(sidebar.getByTestId("ai-conversation-setup-panel")).toHaveCount(0);
    await expect(settingsPage).toBeVisible();
    const setupPanel = settingsPage.getByTestId("settings-agent-row-stemmio");
    if (await setupPanel.getAttribute("data-expanded") !== "true") await setupPanel.locator(".settings-agent-service-main").click();
    await expect(setupPanel.getByRole("textbox", { name: "API Key" })).toBeVisible();
    await expect(setupPanel.getByRole("button", { name: "连接", exact: true })).toBeDisabled();

  } finally {
    await stopStemmio(launched.electronApp, launched.isolatedUserData);
    removeSourceFixture(fixture.sourceDirectory);
    await httpAgent.close();
  }
});

test("Qoder settings entry opens the shared access panel without restoring a Discussion composer", async () => {
  test.setTimeout(120_000);
  const fixture = createSourceFixture("qoder-auth-required.html");
  const qoderCommand = createQoderAcpE2ECommand(fixture.sourceDirectory, {
    authRequired: true,
  });
  const launched = await launchStemmio({
    activeSourcePath: fixture.sourcePath,
    injectedEnv: {
      STEMMIO_QODER_ACP_ALLOW_TEST_COMMAND: "1",
      STEMMIO_QODER_ACP_COMMAND: qoderCommand,
    },
  });
  try {
    let requestPosts = 0;
    let preflightPosts = 0;
    let diagnoseGets = 0;
    launched.page.on("request", (request) => {
      const url = new URL(request.url());
      if (request.method() === "POST" && url.pathname === "/request") requestPosts += 1;
      if (request.method() === "POST" && url.pathname === "/agent/preflight") preflightPosts += 1;
      if (request.method() === "GET" && url.pathname === "/agent/diagnose") diagnoseGets += 1;
    });
    await addComment(
      launched.page,
      fixture.sourcePath,
      "验证 Qoder 登录引导不会创建本轮任务。",
    );
    await launched.page.getByRole("button", { name: /AI 助手/u }).click();
    const sidebar = launched.page.getByTestId("ai-conversation-sidebar");
    await expect(sidebar).toBeVisible();
    await expect(sidebar.getByTestId("ai-conversation-input")).toHaveCount(0);
    await expect(sidebar.getByTestId("ai-conversation-intent")).toHaveCount(0);
    await expect(sidebar.getByRole("button", { name: "设置 Qoder CLI" }))
      .toBeVisible();
    await launched.page.screenshot({
      path: path.join(QODER_VISUAL_OUTPUT, "real-sidebar-login.png"),
      fullPage: false,
    });
    await sidebar.getByRole("button", { name: "设置 Qoder CLI" }).click();

    await expect(sidebar.getByTestId("ai-conversation-setup-panel")).toHaveCount(0);
    await expect(launched.page.locator(".workbench-settings-page")).toBeVisible();
    const setupPanel = await expandSettingsAgent(launched.page.locator(".workbench-settings-page"), "qoder");
    await expect(setupPanel.getByText("未登录", { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(setupPanel.getByRole("button", { name: "登录 Qoder" }))
      .toBeVisible();
    await expect.poll(() => diagnoseGets).toBeGreaterThan(0);
    expect(preflightPosts).toBe(0);
    await setupPanel.screenshot({
      path: path.join(QODER_VISUAL_OUTPUT, "real-settings-login.png"),
      animations: "disabled",
    });
    expect(requestPosts).toBe(0);
    await launched.page.evaluate(() => {
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await launched.page.waitForTimeout(100);
    expect(preflightPosts).toBe(0);
    await setupPanel.getByRole("button", { name: "登录 Qoder" }).click();
    await expect(setupPanel.getByText("请在浏览器完成登录")).toBeVisible({ timeout: 15_000 });
    await expect(setupPanel.getByRole("button", { name: "取消" })).toBeVisible();
    await setupPanel.screenshot({
      path: path.join(QODER_VISUAL_OUTPUT, "real-settings-waiting-login.png"),
      animations: "disabled",
    });
    expect(requestPosts).toBe(0);
    await setupPanel.getByRole("button", { name: "取消" }).click();
    await expect(setupPanel.getByRole("button", { name: "登录 Qoder" })).toBeVisible({ timeout: 15_000 });

    await launched.page.getByRole("button", { name: "返回工作台" }).click();
    await expect(sidebar.getByTestId("ai-conversation-input")).toHaveCount(0);
    const reopenedSettingsCard = await openQoderAvailability(launched.page);
    await expect(reopenedSettingsCard.getByText("未登录", { exact: true })).toBeVisible();
    expect(requestPosts).toBe(0);
    expect(readFileSync(fixture.sourcePath).equals(fixture.original)).toBe(true);
  } finally {
    await stopStemmio(launched.electronApp, launched.isolatedUserData);
    removeSourceFixture(fixture.sourceDirectory);
  }
});

test("Qoder installed while Stemmio is open refreshes in place and continues once", async () => {
  test.setTimeout(120_000);
  const fixture = createSourceFixture("qoder-installed-while-open.html");
  const qoderCommand = path.join(fixture.sourceDirectory, "stemmio-qoder-acp-e2e");
  const launched = await launchStemmio({
    activeSourcePath: fixture.sourcePath,
    injectedEnv: {
      STEMMIO_QODER_ACP_ALLOW_TEST_COMMAND: "1",
      STEMMIO_QODER_ACP_COMMAND: qoderCommand,
    },
  });
  try {
    let requestPosts = 0;
    launched.page.on("request", (request) => {
      const url = new URL(request.url());
      if (request.method() === "POST" && url.pathname === "/request") requestPosts += 1;
    });
    await addComment(
      launched.page,
      fixture.sourcePath,
      "验证 Stemmio 打开期间安装 Qoder CLI 后可原地继续。",
    );
    await launched.page.getByRole("button", { name: /AI 助手/u }).click();
    const deliveryDialog = await openQoderAvailability(launched.page);
    const qoderCard = deliveryDialog;
    await expect(qoderCard.locator(".settings-agent-service-main").getByText("未安装", { exact: true })).toBeVisible();
    await expect(qoderCard.getByRole("button", { name: "安装 Qoder CLI" })).toBeVisible();
    expect(requestPosts).toBe(0);

    createQoderAcpE2ECommand(fixture.sourceDirectory);
    await launched.page.getByRole("button", { name: "重新检查" }).click();
    await expect(qoderCard.getByText("已连接", { exact: true })).toBeVisible();
    // The Settings card only observes availability; continuing the round is the
    // conversation's own send action.
    expect(requestPosts).toBe(0);

    await closeQoderAvailability(launched.page);
    await chooseModifyIntent(launched.page);
    await launched.page.getByRole("button", { name: "交给 Qoder 修改" }).click();
    await expect.poll(() => requestPosts).toBe(1);
  } finally {
    await stopStemmio(launched.electronApp, launched.isolatedUserData);
    removeSourceFixture(fixture.sourceDirectory);
  }
});

test("Qoder managed install can be cancelled while the install request is pending", {
  tag: ["@smoke-provider"],
}, async () => {
  test.setTimeout(120_000);
  const fixture = createSourceFixture("qoder-cancel-managed-install.html");
  const launched = await launchStemmio({
    activeSourcePath: fixture.sourcePath,
    injectedEnv: {
      STEMMIO_AGENT_INSTALL_STUB_FETCH: "pending",
      STEMMIO_QODER_ACP_ALLOW_TEST_COMMAND: "1",
      STEMMIO_QODER_ACP_COMMAND: path.join(fixture.sourceDirectory, "missing-qoder-acp"),
    },
  });
  try {
    let installPosts = 0;
    let cancelPosts = 0;
    let requestPosts = 0;
    launched.page.on("request", (request) => {
      const url = new URL(request.url());
      if (request.method() !== "POST") return;
      if (url.pathname === "/agent/install") installPosts += 1;
      if (url.pathname === "/agent/install/cancel") cancelPosts += 1;
      if (url.pathname === "/request") requestPosts += 1;
    });

    const qoderCard = await openQoderAvailability(launched.page);
    await expect(qoderCard.locator(".settings-agent-service-main").getByText("未安装", { exact: true }))
      .toBeVisible({ timeout: 30_000 });
    await qoderCard.getByRole("button", { name: "安装 Qoder CLI" }).click();

    await expect(qoderCard.getByText("正在安装…", { exact: true })).toBeVisible();
    const cancelButton = qoderCard.getByRole("button", { name: "取消", exact: true });
    await expect(cancelButton).toBeVisible();
    await expect(cancelButton).toBeEnabled();
    await expect.poll(() => installPosts).toBe(1);

    await cancelButton.click();
    await expect.poll(() => cancelPosts).toBe(1);
    await expect(qoderCard.locator(".settings-agent-service-main").getByText("未安装", { exact: true }))
      .toBeVisible({ timeout: 30_000 });
    await expect(qoderCard.getByRole("button", { name: "安装 Qoder CLI" })).toBeEnabled();
    expect(requestPosts).toBe(0);
    expect(readFileSync(fixture.sourcePath)).toEqual(fixture.original);
    const projectRoot = managedProjectRoots(launched.workspace)[0];
    const projectId = JSON.parse(readFileSync(
      path.join(projectRoot, ".stemmio", "project.json"),
      "utf8",
    )).projectId;
    expect(candidateHtmlFiles(launched.workspace, projectId)).toHaveLength(0);
  } finally {
    await stopStemmio(launched.electronApp, launched.isolatedUserData);
    removeSourceFixture(fixture.sourceDirectory);
  }
});

test("Qoder unstructured capacity wording stays generic with retry and no Request", {
  tag: ["@smoke-provider"],
}, async () => {
  test.setTimeout(120_000);
  const fixture = createSourceFixture("qoder-capacity-unavailable.html");
  const qoderCommand = createQoderAcpE2ECommand(fixture.sourceDirectory, {
    capacityUnavailable: true,
  });
  const launched = await launchStemmio({
    activeSourcePath: fixture.sourcePath,
    injectedEnv: {
      STEMMIO_QODER_ACP_ALLOW_TEST_COMMAND: "1",
      STEMMIO_QODER_ACP_COMMAND: qoderCommand,
    },
  });
  try {
    let requestPosts = 0;
    launched.page.on("request", (request) => {
      const url = new URL(request.url());
      if (request.method() === "POST" && url.pathname === "/request") requestPosts += 1;
    });
    await addComment(
      launched.page,
      fixture.sourcePath,
      "额度不足时仍然不应创建本轮任务。",
    );
    await launched.page.getByRole("button", { name: /AI 助手/u }).click();
    const settingsSection = await openQoderAvailability(launched.page);
    await expect(settingsSection.getByText("暂时无法连接", { exact: true }))
      .toBeVisible();
    await expect(launched.page.getByTestId("settings-agent-row-stemmio")).toBeVisible();
    await expect(settingsSection.getByRole("button", { name: "重新检查", exact: true })).toBeVisible();
    expect(requestPosts).toBe(0);
    await launched.page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(settingsSection.getByText("暂时无法连接", { exact: true }))
      .toBeVisible();
    expect(requestPosts).toBe(0);
    expect(readFileSync(fixture.sourcePath).equals(fixture.original)).toBe(true);
  } finally {
    await stopStemmio(launched.electronApp, launched.isolatedUserData);
    removeSourceFixture(fixture.sourceDirectory);
  }
});

test("Qoder ACP polling waits for start and a managed stop kills the Agent", {
  tag: ["@smoke-provider"],
}, async () => {
  test.setTimeout(120_000);
  const fixture = createSourceFixture("qoder-acp-managed-stop.html");
  const pidFile = path.join(fixture.sourceDirectory, "qoder-acp.pid");
  const qoderCommand = createQoderAcpE2ECommand(fixture.sourceDirectory, {
    hang: true,
    pidFile,
  });
  const launched = await launchStemmio({
    activeSourcePath: fixture.sourcePath,
    injectedEnv: {
      STEMMIO_QODER_ACP_ALLOW_TEST_COMMAND: "1",
      STEMMIO_QODER_ACP_COMMAND: qoderCommand,
    },
  });
  try {
    const bridgeTraffic = [];
    launched.page.on("request", (request) => {
      const url = new URL(request.url());
      if (
        url.hostname === "127.0.0.1"
        && ["/agent/start", "/status"].includes(url.pathname)
      ) bridgeTraffic.push(`${request.method()} ${url.pathname}`);
    });
    const workingCopyPath = await addComment(
      launched.page,
      fixture.sourcePath,
      "保持 ACP 会话运行，直到我在源页停止本轮。",
    );
    const workingBefore = readFileSync(workingCopyPath);
    await launched.page.getByRole("button", { name: /AI 助手/u }).click();
    // The round is started from the conversation itself; the Settings card only
    // observes availability and never launches the Agent.
    const qoderSettingsCard = await openQoderAvailability(launched.page);
    await expect(qoderSettingsCard.getByText("已连接", { exact: true }))
      .toBeVisible({ timeout: 60_000 });
    await closeQoderAvailability(launched.page);
    await chooseModifyIntent(launched.page);
    await launched.page.getByRole("button", { name: "交给 Qoder 修改" }).click();

    const stopButton = launched.page.getByRole("button", { name: "停止", exact: true });
    await expect(stopButton).toBeVisible({ timeout: 60_000 });
    await expect.poll(() => existsSync(pidFile)).toBe(true);
    const pid = Number(readFileSync(pidFile, "utf8"));
    expect(Number.isSafeInteger(pid)).toBe(true);
    await launched.page.waitForTimeout(750);
    const falseFailureToast = launched.page.locator(".toast.show").filter({
      hasText: "Qoder CLI 没有完成本轮",
    });
    expect(
      await falseFailureToast.count(),
      `Bridge request order: ${bridgeTraffic.join(", ")}`,
    ).toBe(0);

    await stopButton.click();
    const endingButton = launched.page.getByRole("button", { name: "正在结束…" });
    const roundStopButton = launched.page.getByRole("button", { name: "停止", exact: true });
    // Cancelling can finish before Playwright samples the disabled label. The
    // user contract is that stop ends the round and kills the Agent. If the
    // in-flight label appears, it must be disabled; if the round already left
    // that frame, "结束本轮" must be gone.
    await expect.poll(async () => {
      if (await endingButton.isVisible().catch(() => false)) {
        await expect(endingButton).toBeDisabled();
        return "cancelling";
      }
      return (await roundStopButton.count()) === 0 ? "ended" : "";
    }, { timeout: 45_000 }).not.toBe("");
    await expect(launched.page.locator(".toast.show")).toHaveCount(0);
    await expect(launched.page.getByTestId("ai-conversation-sidebar")).toBeHidden();
    await expect(launched.page.locator('aside[aria-label="本轮评论"]')
      .getByRole("button", { name: "全局评论", exact: true }))
      .toBeEnabled({ timeout: 45_000 });
    await expect.poll(() => {
      try {
        process.kill(pid, 0);
        return true;
      } catch (error) {
        if (error?.code === "ESRCH") return false;
        throw error;
      }
    }).toBe(false);
    expect(readFileSync(fixture.sourcePath)).toEqual(fixture.original);
    expect(readFileSync(workingCopyPath)).toEqual(workingBefore);
    expect(candidateHtmlFiles(launched.workspace, (
      JSON.parse(readFileSync(
        path.join(managedProjectRoots(launched.workspace)[0], ".stemmio", "project.json"),
        "utf8",
      )).projectId
    ))).toHaveLength(0);
    const requestsRoot = path.join(
      managedProjectRoots(launched.workspace)[0],
      ".stemmio",
      "requests",
    );
    const requestDirectory = readdirSync(requestsRoot).find((name) => !name.startsWith("."));
    const request = JSON.parse(readFileSync(
      path.join(requestsRoot, requestDirectory, "request.json"),
      "utf8",
    ));
    expect(request.status).toBe("cancelled");
  } finally {
    await stopStemmio(launched.electronApp, launched.isolatedUserData);
    removeSourceFixture(fixture.sourceDirectory);
  }
});

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
  loadedDiskFrame,
  managedProjectRoots,
  mkdirSync,
  openAgentSettingsPage,
  openRecentProject,
  openQoderAvailability,
  requestDirectoryCount,
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
    // Keep the first public chunk live long enough for the renderer to prove
    // its in-progress state before the synthetic Agent reaches finalization.
    visibleTextGateMs: 5_000,
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

    // The compact thinking marker intentionally yields to public narration as
    // soon as the first Agent chunk arrives. Observe that pre-narration phase
    // before proving the separately rendered public chunks below.
    const thinking = launched.page.getByTestId("ai-conversation-thinking");
    await expect(thinking).toBeVisible({ timeout: 60_000 });
    const narration = launched.page.getByTestId("ai-conversation-narration-message");
    await expect(narration).toBeVisible({ timeout: 60_000 });
    await expect(narration).toHaveCount(1);
    await expect(narration).toContainText("正在读取冻结任务。");
    await expect(narration).not.toContainText("正在等待校验。");
    await expect(narration).toContainText(
      "正在读取冻结任务。正在写入 Candidate。正在等待校验。",
      { timeout: 60_000 },
    );
    const narrationToggle = narration.getByTestId("ai-conversation-narration-toggle");
    await expect(narrationToggle).toHaveAttribute("aria-expanded", "false");
    await narrationToggle.click();
    await expect(narrationToggle).toHaveAttribute("aria-expanded", "true");
    await expect(narration.getByTestId("ai-conversation-narration").locator("p"))
      .toHaveCount(3);
    await expect(launched.page.getByTestId("ai-conversation-thinking")).toHaveCount(0);
    await expect(narrationToggle).toHaveAttribute("aria-expanded", "true");
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
    await expect(narrationToggle).toHaveAttribute("aria-expanded", "true");
    const process = launched.page.locator('[data-testid="ai-turn-process"][data-actor="agent"]')
      .filter({ hasText: "正在读取本轮资料" }).first();
    await expect(process).toBeVisible();
    await expect(process.locator("summary")).toHaveCount(1);
    await process.locator("summary").click();
    await expect(process).toContainText("Qoder");
    await expect(launched.page.getByTestId("ai-conversation-message").filter({ hasText: "正在读取冻结任务。正在写入 Candidate。正在等待校验。" })).toHaveCount(0);
    await expect(process.locator("li").first()).toBeVisible();
    const processTime = process.locator("time").first();
    await expect(process.locator("summary")).toBeFocused();
    await expect(processTime).toHaveCSS("opacity", "1");
    await launched.page.getByRole("textbox", { name: "修改要求草稿" }).focus();
    await launched.page.mouse.move(0, 0);
    await expect(processTime).toHaveCSS("opacity", "0");
    await processTime.hover();
    await expect(processTime).toHaveCSS("opacity", "1");
    const agentMessage = narration;
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
    syntheticMessages.push({
      messageId: "message_historical_process", actor: "agent", providerId: "qoder",
      kind: "process-summary", status: "completed", requestId: "historical_request", attemptId: "historical_attempt",
      text: Array.from({ length: 45 }, (_, index) => `历史公开过程 ${index}：从展开入口开始阅读。`).join("\n\n"),
      createdAt: new Date().toISOString(),
    });
    const historical = launched.page.getByTestId("ai-conversation-narration-message").filter({ hasText: "历史公开过程 0" });
    const historicalToggle = historical.getByTestId("ai-conversation-narration-toggle");
    await expect(historicalToggle).toHaveAttribute("aria-expanded", "false");
    const readingStream = launched.page.getByTestId("ai-conversation-stream");
    const readingFeedback = launched.page.getByTestId("ai-conversation-unseen-content");
    if (await readingFeedback.isVisible()) await readingFeedback.click();
    else {
      await readingStream.hover();
      await launched.page.mouse.wheel(0, 100_000);
    }
    await expect.poll(() => readingStream.evaluate((element) => (
      element.scrollHeight - element.clientHeight - element.scrollTop
    ))).toBeLessThanOrEqual(2);
    await expect(readingFeedback).toHaveCount(0);
    const triggerTop = (await historicalToggle.boundingBox()).y;
    await historicalToggle.click();
    await expect(historicalToggle).toHaveAttribute("aria-expanded", "true");
    expect(await historical.evaluate((element) => element.clientHeight)).toBeGreaterThan(2 * await readingStream.evaluate((element) => element.clientHeight));
    await expect.poll(async () => Math.abs((await historicalToggle.boundingBox()).y - triggerTop)).toBeLessThanOrEqual(2);
    await expect(readingFeedback).toHaveText("回到最新");
    syntheticMessages.push({ messageId: "message_after_historical_expansion", actor: "stemmio", kind: "text", status: "completed",
      text: "新增的合成公开事实", createdAt: new Date().toISOString() });
    await expect(readingStream).toContainText("新增的合成公开事实");
    await expect(readingFeedback).toHaveText("有新进展");
    await expect.poll(async () => Math.abs((await historicalToggle.boundingBox()).y - triggerTop)).toBeLessThanOrEqual(2);
    await launched.page.screenshot({ path: path.join(AI_ASSISTANT_VISUAL_OUTPUT, "history-disclosure-keeps-trigger.png"), animations: "disabled" });
    await readingFeedback.click();
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

async function sidebarReadingSnapshot(page) {
  return page.getByTestId("ai-conversation-stream").evaluate((stream) => {
    const streamRect = stream.getBoundingClientRect();
    const anchors = [...stream.querySelectorAll("[data-reading-anchor-id]")];
    const anchor = anchors.find((element) => element.getBoundingClientRect().bottom > streamRect.top + 1)
      || anchors.at(-1);
    return {
      scrollTop: stream.scrollTop,
      scrollHeight: stream.scrollHeight,
      clientHeight: stream.clientHeight,
      anchorId: anchor?.getAttribute("data-reading-anchor-id") || null,
      anchorOffset: anchor ? anchor.getBoundingClientRect().top - streamRect.top : null,
      frameGeneration: document.querySelector(
        '[data-testid="html-canvas-editor"] iframe[data-runtime-slot-role="active"]',
      )?.getAttribute("data-frame-generation") || null,
    };
  });
}

for (const expandedAtSeal of [false, true]) {
test(`Qoder long public narration preserves reading state across updates and A-B-A tabs (sealed ${expandedAtSeal ? "expanded" : "collapsed"})`, {
  tag: ["@smoke-provider"],
}, async ({}, testInfo) => {
  test.setTimeout(180_000);
  const fixtureA = createSourceFixture("qoder-reading-a.html");
  const fixtureB = createSourceFixture("qoder-reading-b.html", (source) => source.replace(
    /<title>.*?<\/title>/iu,
    "<title>Qoder 阅读 B</title>",
  ));
  const qoderCommand = createQoderAcpE2ECommand(fixtureA.sourceDirectory, {
    visibleText: true,
    visibleTextLong: true,
    visibleTextGateMs: 300,
  });
  const launched = await launchStemmio({
    activeSourcePath: fixtureA.sourcePath,
    recentSourcePaths: [fixtureA.sourcePath, fixtureB.sourcePath],
    injectedEnv: {
      STEMMIO_QODER_ACP_ALLOW_TEST_COMMAND: "1",
      STEMMIO_QODER_ACP_COMMAND: qoderCommand,
    },
  });
  let releaseSealedRead;
  const sealedReadGate = new Promise((resolve) => { releaseSealedRead = resolve; });
  await launched.page.route(/\/conversation(?:\?|$)/u, async (route) => {
    const response = await route.fetch();
    const payload = await response.json();
    if (payload.conversation?.messages.some((message) => message.kind === "process-summary")) {
      await sealedReadGate;
    }
    await route.fulfill({ response, json: payload });
  });
  try {
    const workingCopyPath = await addComment(
      launched.page,
      fixtureA.sourcePath,
      "请保留页面结构，只验证长公开说明的阅读稳定性。",
    );
    const originalSource = readFileSync(fixtureA.sourcePath);
    const workingBeforeReading = readFileSync(workingCopyPath);
    await launched.page.getByRole("button", { name: /AI 助手/u }).click();
    const qoderSettingsCard = await openQoderAvailability(launched.page);
    await expect(qoderSettingsCard.getByText("已连接", { exact: true }))
      .toBeVisible({ timeout: 60_000 });
    await closeQoderAvailability(launched.page);
    const sidebar = await chooseModifyIntent(launched.page);
    const requestCountBefore = requestDirectoryCount(launched.workspace);
    await sidebar.getByRole("button", { name: /交给 Qoder 修改/u }).click();

    const narration = launched.page.getByTestId("ai-conversation-narration-message");
    await expect(narration).toBeVisible({ timeout: 60_000 });
    const toggle = narration.getByTestId("ai-conversation-narration-toggle");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await toggle.focus();
    await toggle.press("Enter");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await launched.page.emulateMedia({ reducedMotion: "reduce" });
    await expect.poll(() => launched.page.evaluate(() => (
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ))).toBe(true);
    await expect(narration).toContainText("长公开说明 1/18", { timeout: 60_000 });
    const stream = launched.page.getByTestId("ai-conversation-stream");
    await expect.poll(async () => narration.getByTestId("ai-conversation-narration")
      .locator("p").count(), { timeout: 60_000 }).toBeGreaterThan(8);
    await expect.poll(() => stream.evaluate((element) => element.scrollHeight - element.clientHeight), {
      timeout: 60_000,
    }).toBeGreaterThan(180);

    await narration.evaluate((element) => {
      window.__stemmioLongNarrationArticle = element;
    });
    const beforeScroll = await stream.evaluate((element) => {
      element.dispatchEvent(new WheelEvent("wheel", { deltaY: -100, bubbles: true }));
      const top = Math.min(80, Math.max(0, element.scrollHeight - element.clientHeight - 20));
      element.scrollTop = top;
      element.dispatchEvent(new Event("scroll", { bubbles: true }));
      return { top, scrollHeight: element.scrollHeight };
    });
    await expect(launched.page.getByTestId("ai-conversation-unseen-content")).toBeVisible();
    await expect.poll(() => narration.textContent()).toContain("长公开说明 12/18");
    await expect(narration).toHaveCount(1);
    expect(await narration.evaluate((element) => element === window.__stemmioLongNarrationArticle)).toBe(true);
    await expect.poll(() => stream.evaluate((element) => element.scrollTop))
      .toBeLessThanOrEqual(beforeScroll.top + 2);

    const selectedText = await narration.getByTestId("ai-conversation-narration")
      .locator("p").first().evaluate((element) => {
        const text = element.firstChild;
        if (!text) return "";
        const range = document.createRange();
        range.setStart(text, 0);
        range.setEnd(text, Math.min(12, text.textContent.length));
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        return selection?.toString() || "";
      });
    expect(selectedText.length).toBeGreaterThan(0);
    await expect.poll(() => narration.textContent()).toContain("最终公开段落：结果仍需 Stemmio 校验。");
    expect(await launched.page.evaluate(() => window.getSelection()?.toString() || ""))
      .toBe(selectedText);
    await expect.poll(() => stream.evaluate((element) => element.scrollTop))
      .toBeLessThanOrEqual(beforeScroll.top + 2);

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(narration.getByTestId("ai-conversation-narration").locator("p").first())
      .toBeHidden();
    await toggle.focus();
    await toggle.press("Enter");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await launched.page.evaluate(() => window.getSelection()?.removeAllRanges());

    if (!expandedAtSeal) await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", String(expandedAtSeal));
    const sealAnchor = await sidebarReadingSnapshot(launched.page);
    const sealProcessTop = await toggle.evaluate((element) => element.getBoundingClientRect().top);
    releaseSealedRead();
    await expect(narration).toHaveAttribute("data-process-state", "sealed", { timeout: 60_000 });
    await expect(launched.page.getByTestId("ai-conversation-action-bar"))
      .toContainText("修改已准备好，尚未采用", { timeout: 60_000 });
    await expect(toggle).toHaveAttribute("aria-expanded", String(expandedAtSeal));
    await expect(launched.page.locator('[data-testid="ai-conversation-message"][data-actor="agent"]').filter({ hasText: "长公开说明" })).toHaveCount(0);
    expect(await narration.evaluate((element) => element === window.__stemmioLongNarrationArticle)).toBe(true);
    await testInfo.attach("seal-reading-anchors.json", {
      body: JSON.stringify({ before: sealAnchor, after: await sidebarReadingSnapshot(launched.page), processBefore: sealProcessTop, processAfter: await toggle.evaluate((element) => element.getBoundingClientRect().top) }, null, 2),
      contentType: "application/json",
    });
    // Disclosure intent anchors the control the user clicked, even when
    // delayed earlier facts enter above it during Conversation reconciliation.
    await expect.poll(async () => toggle.evaluate((element, beforeTop) => {
      const stream = element.closest('[data-testid="ai-conversation-stream"]');
      const delta = element.getBoundingClientRect().top - beforeTop;
      // A short collapsed thread may not have enough scroll range; preserve
      // the nearest reachable position instead of inventing blank content.
      const remainingDown = stream.scrollHeight - stream.clientHeight - stream.scrollTop;
      return Math.abs(delta > 0 ? Math.min(delta, remainingDown) : Math.max(delta, -stream.scrollTop));
    }, sealProcessTop)).toBeLessThanOrEqual(2);
    // Sealing and the following execution-ended fact are separate writes.
    // Observe the latter arriving before asserting its stored ordering.
    // Candidate readiness may precede sealing and keeps its stored sequence.
    await expect.poll(() => narration.evaluate((element) => {
      const later = [...document.querySelectorAll('[data-testid="ai-turn-process"]')].find((node) => node.textContent.includes("本轮执行已结束。"));
      return Boolean(later && (element.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING));
    })).toBe(true);
    if (!expandedAtSeal) await toggle.click();
    await expect(toggle).toContainText("最终公开段落：结果仍需 Stemmio 校验。");
    await expect(toggle.locator("span").last()).toHaveCSS("text-overflow", "ellipsis");
    await expect(narration).toHaveCount(1);
    await expect(launched.page.getByTestId("ai-conversation-action-bar")).toBeVisible();
    // Pure reading in an already-ready preview must preserve its physical
    // document. Switching A/B is a separate navigation boundary and may assign
    // another frame generation; it is covered by reading-anchor checks below.
    const previewIframe = launched.page.locator('iframe[title="HTML 交互预览"]').filter({ visible: true });
    const previewHandle = await previewIframe.elementHandle();
    const previewFrame = await previewHandle.contentFrame();
    await previewFrame.evaluate(() => { window.__agentReadingDocument = document; });
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await launched.page.screenshot({ path: testInfo.outputPath("collapsed-process-ready.png"), animations: "disabled" });
    await toggle.click();
    await narration.getByRole("button", { name: "复制", exact: true }).click();
    expect(await previewFrame.evaluate(() => document === window.__agentReadingDocument)).toBe(true);
    expect(await previewIframe.evaluate((element, before) => element === before, previewHandle)).toBe(true);
    await launched.page.screenshot({ path: testInfo.outputPath("expanded-process-ready.png"), animations: "disabled" });
    // Copy can scroll its button into view. Explicitly resume reading older
    // content before testing the tab-scoped reading anchor.
    await stream.evaluate((element) => {
      element.dispatchEvent(new WheelEvent("wheel", { deltaY: -100, bubbles: true }));
      element.scrollTop = 80;
      element.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    await expect(launched.page.getByTestId("ai-conversation-unseen-content")).toBeVisible();
    const beforeTabs = await sidebarReadingSnapshot(launched.page);
    expect(beforeTabs.anchorId).toBeTruthy();
    const requestCountAtReady = requestDirectoryCount(launched.workspace);
    expect(requestCountAtReady).toBe(requestCountBefore + 1);

    await openRecentProject(launched.page, fixtureB.sourcePath);
    const tabs = launched.page.getByRole("tablist", { name: "已打开的页面" }).getByRole("tab");
    const tabA = tabs.filter({ hasText: "qoder-reading-a" });
    const tabB = tabs.filter({ hasText: "qoder-reading-b" });
    await expect(tabB).toHaveAttribute("aria-selected", "true");
    await expect(tabs).toHaveCount(2);
    const workingCopyBPath = await launched.page.evaluate(
      async () => (await window.stemmioProjects?.getActiveProject())?.sourcePath || "",
    );
    await loadedDiskFrame(launched.page, workingCopyBPath);
    await tabA.click();
    await expect(tabA).toHaveAttribute("aria-selected", "true");
    await loadedDiskFrame(launched.page, workingCopyPath, { editable: false });
    if (!await launched.page.getByTestId("ai-conversation-sidebar").isVisible()) {
      await launched.page.getByRole("button", { name: /AI 助手/u }).click();
    }
    const restoredSidebar = launched.page.getByTestId("ai-conversation-sidebar");
    await expect(restoredSidebar.getByTestId("ai-conversation-action-bar"))
      .toContainText("修改已准备好，尚未采用", { timeout: 60_000 });
    await expect(launched.page.frameLocator('iframe[title="HTML 交互预览"]').locator('[data-native-case="list-item"]'))
      .toContainText("列表项中的文字保持项目符号和缩进。", { timeout: 60_000 });
    const restoredNarration = restoredSidebar.getByTestId("ai-conversation-narration-message");
    const restoredToggle = restoredNarration.getByTestId("ai-conversation-narration-toggle");
    await expect(restoredToggle).toHaveAttribute("aria-expanded", "true");
    await testInfo.attach("tab-reading-anchors.json", {
      body: JSON.stringify({ before: beforeTabs, after: await sidebarReadingSnapshot(launched.page) }, null, 2),
      contentType: "application/json",
    });
    await expect.poll(async () => {
      const current = await sidebarReadingSnapshot(launched.page);
      return current.anchorId === beforeTabs.anchorId
        && Math.abs(current.anchorOffset - beforeTabs.anchorOffset) <= 2;
    }, { timeout: 30_000 }).toBe(true);
    expect(requestDirectoryCount(launched.workspace)).toBe(requestCountAtReady);
    expect(readFileSync(fixtureA.sourcePath).equals(originalSource)).toBe(true);
    expect(readFileSync(workingCopyPath).equals(workingBeforeReading)).toBe(true);
    await launched.page.screenshot({ path: testInfo.outputPath("restored-process-reading.png"), animations: "disabled" });
  } catch (cause) {
    await launched.page.screenshot({ path: testInfo.outputPath("reading-failure.png"), animations: "disabled" }).catch(() => {});
    throw cause;
  } finally {
    releaseSealedRead();
    await launched.page.unrouteAll({ behavior: "wait" });
    await stopStemmio(launched.electronApp, launched.isolatedUserData);
    removeSourceFixture(fixtureA.sourceDirectory);
    removeSourceFixture(fixtureB.sourceDirectory);
  }
});

}

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
    const narrationToggle = narration.getByTestId("ai-conversation-narration-toggle");
    await expect(narrationToggle).toHaveAttribute("aria-expanded", "false");
    await narrationToggle.click();
    await expect(narrationToggle).toHaveAttribute("aria-expanded", "true");
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

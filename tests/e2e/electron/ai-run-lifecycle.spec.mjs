import { expect, test } from "@playwright/test";
import { preserveCandidateSourceIdsForFixture } from "../../helpers/preserve-candidate-source-ids.mjs";
import {
  ORIGINAL_TEXT,
  UPDATED_TEXT,
  addComment,
  addCommentAndSubmit,
  activateNativeEdit,
  caseSelector,
  chooseClipboardDelivery,
  chooseModifyIntent,
  closeQoderAvailability,
  closeStemmioGracefully,
  createSourceFixture,
  createQoderAcpE2ECommand,
  existsSync,
  loadedDiskFrame,
  launchStemmio,
  openQoderAvailability,
  openRecentProject,
  path,
  readFileSync,
  realpathSync,
  removeSourceFixture,
  requestDirectoryCount,
  runOfficialFinalizer,
  setTextSelection,
  stopStemmio,
  waitForProjectReady,
  workingHtmlFiles,
  writeAiOutput,
} from "./ai-closed-loop-helpers.mjs";

test("a managed Agent failure immediately replaces processing with retry or end", {
  tag: ["@smoke-run-lifecycle"],
}, async () => {
  test.setTimeout(180_000);
  const fixture = createSourceFixture("managed-agent-runtime-failure.html");
  const qoderCommand = createQoderAcpE2ECommand(fixture.sourceDirectory, {
    runtimeFailure: true,
  });
  const launched = await launchStemmio({
    activeSourcePath: fixture.sourcePath,
    injectedEnv: {
      STEMMIO_QODER_ACP_ALLOW_TEST_COMMAND: "1",
      STEMMIO_QODER_ACP_COMMAND: qoderCommand,
    },
  });
  try {
    await addComment(
      launched.page,
      fixture.sourcePath,
      "请验证运行中断不会产生 Candidate。",
    );
    if (!await launched.page.getByTestId("ai-conversation-sidebar").isVisible()) {
      await launched.page.getByRole("button", { name: /AI 助手/u }).click();
    }
    const qoderCard = await openQoderAvailability(launched.page);
    await expect(qoderCard.getByText("已连接", { exact: true }))
      .toBeVisible({ timeout: 60_000 });
    await closeQoderAvailability(launched.page);
    await chooseModifyIntent(launched.page);
    await launched.page.getByRole("button", { name: "交给 AI 修改" }).click();

    const actionBar = launched.page.getByTestId("ai-conversation-action-bar");
    await expect(actionBar).toContainText("生成中断", { timeout: 60_000 });
    await expect(actionBar).toContainText("Qoder CLI 没有完成本轮任务");
    await expect(actionBar).toContainText("页面未修改");
    await expect(actionBar.getByRole("button")).toHaveCount(2);
    await expect(actionBar.getByRole("button", { name: "重新发送" })).toBeVisible();
    await expect(actionBar.getByRole("button", { name: "结束本轮" })).toBeVisible();
    await expect(actionBar.getByText(/更换模型|切换 Agent|复制给其他 AI/u)).toHaveCount(0);
    await expect(launched.page.locator(".toast.show")).toHaveCount(0);
    expect(readFileSync(fixture.sourcePath)).toEqual(fixture.original);
    expect(requestDirectoryCount(launched.workspace)).toBe(1);

    await actionBar.getByRole("button", { name: "重新发送" }).click();
    await expect(actionBar).toContainText("生成中断", { timeout: 60_000 });
    expect(requestDirectoryCount(launched.workspace)).toBe(1);
    expect(readFileSync(fixture.sourcePath)).toEqual(fixture.original);

    await actionBar.getByRole("button", { name: "结束本轮" }).click();
    await expect(launched.page.getByTestId("ai-conversation-sidebar")).toBeVisible();
    await launched.page.getByRole("button", { name: "AI 助手", exact: true }).click();
    await expect(launched.page.locator('aside[aria-label="本轮评论"]')
      .getByRole("button", { name: "全局评论", exact: true }))
      .toBeEnabled({ timeout: 45_000 });
    await expect(launched.page.locator(".toast.show")).toHaveCount(0);
    expect(readFileSync(fixture.sourcePath)).toEqual(fixture.original);
  } finally {
    await stopStemmio(launched.electronApp, launched.isolatedUserData);
    removeSourceFixture(fixture.sourceDirectory);
  }
});

test("a clipboard handoff failure keeps the frozen Request recoverable", {
  tag: ["@smoke-run-lifecycle"],
}, async () => {
  const fixture = createSourceFixture();
  const launched = await launchStemmio({
    activeSourcePath: fixture.sourcePath,
    injectedEnv: { STEMMIO_E2E_QODER_HANDOFF_FAILURE: "1" },
  });
  try {
    const clipboardSentinel = "STEMMIO_QODER_HANDOFF_FAILURE_SENTINEL";
    await launched.electronApp.evaluate(
      ({ clipboard }, value) => clipboard.writeText(value),
      clipboardSentinel,
    );
    const frame = await loadedDiskFrame(launched.page, fixture.sourcePath);
    await frame.locator(caseSelector("list-item")).click();
    await launched.page.getByRole("button", { name: /给.+留评论/u })
      .filter({ visible: true })
      .first()
      .click();
    await launched.page.getByRole("textbox", { name: "评论内容" })
      .fill(`改为 ${UPDATED_TEXT}`);
    await launched.page.getByRole("button", { name: "评论", exact: true }).click();
    const sendToQoder = launched.page.getByRole("button", { name: /AI 助手/u });
    await expect(sendToQoder).toBeEnabled();
    await sendToQoder.click();
    await chooseClipboardDelivery(launched.page);
    // The failure is said by the round's own timeline, and the remedy is the
    // action bar's re-copy action. The clipboard is left untouched.
    await expect(launched.page.getByTestId("ai-conversation-action-bar"))
      .toContainText("任务还没复制成功");
    expect(await launched.electronApp.evaluate(({ clipboard }) => clipboard.readText()))
      .toBe(clipboardSentinel);
    // Retrying goes through the bar's own remedy, and it must not create a
    // second request or touch the source.
    const failureActionBar = launched.page.getByTestId("ai-conversation-action-bar");
    await expect(failureActionBar.getByRole("button", { name: "再次复制" }))
      .toBeVisible();
    await failureActionBar.getByRole("button", { name: "再次复制" }).click();
    await expect.poll(() => requestDirectoryCount(launched.workspace))
      .toBe(1);
    expect(readFileSync(fixture.sourcePath).equals(fixture.original)).toBe(true);
  } finally {
    await stopStemmio(launched.electronApp, launched.isolatedUserData);
    removeSourceFixture(fixture.sourceDirectory);
  }
});

test("a failed handoff in project A does not block project B or replace its state", async () => {
  test.setTimeout(180_000);
  const projectA = createSourceFixture("project-a.html");
  const projectB = createSourceFixture("project-b.html");
  const launched = await launchStemmio({
    activeSourcePath: projectA.sourcePath,
    recentSourcePaths: [projectA.sourcePath, projectB.sourcePath],
    injectedEnv: { STEMMIO_E2E_QODER_HANDOFF_FAILURE: "1" },
  });
  try {
    const projectAWorkingCopyPath = await addComment(
      launched.page,
      projectA.sourcePath,
    );
    expect(projectAWorkingCopyPath).not.toBe(realpathSync(projectA.sourcePath));
    if (!await launched.page.getByTestId("ai-conversation-sidebar").isVisible()) {
      await launched.page.getByRole("button", { name: /AI 助手/u }).click();
    }
    await chooseClipboardDelivery(launched.page);
    // The failure is said by the round's own timeline, and it must not have
    // produced a second request.
    await expect(launched.page.getByTestId("ai-conversation-action-bar"))
      .toContainText("任务还没复制成功", { timeout: 30_000 });
    await expect.poll(
      () => requestDirectoryCount(launched.workspace),
      { timeout: 20_000 },
    ).toBe(1);
    await openRecentProject(launched.page, projectB.sourcePath);
    // B starts clean and A's failure does not follow it: the conversation opens
    // (the old header asked for a comment first; opening is always allowed now),
    // and sending waits for B's own comment below.
    await expect(launched.page.getByRole("button", { name: /AI 助手/u }))
      .toBeEnabled();
    const projectBWorkingCopyPath = await addComment(
      launched.page,
      projectB.sourcePath,
    );
    expect(projectBWorkingCopyPath).not.toBe(realpathSync(projectB.sourcePath));
    await expect(launched.page.getByRole("button", { name: /AI 助手/u }))
      .toBeEnabled();
    if (!await launched.page.getByTestId("ai-conversation-sidebar").isVisible()) {
      await launched.page.getByRole("button", { name: /AI 助手/u }).click();
    }
    await chooseClipboardDelivery(launched.page);
    // B fails on its own round: the same error step appears for B, and the
    // request count says the two failures are two separate rounds.
    await expect(launched.page.getByTestId("ai-conversation-action-bar"))
      .toContainText("任务还没复制成功", { timeout: 30_000 });
    await expect.poll(
      () => requestDirectoryCount(launched.workspace),
      { timeout: 20_000 },
    ).toBe(2);

    await openRecentProject(launched.page, projectA.sourcePath, { editable: false });
    // Each project keeps its own failed state: reopening A still shows A's round
    // stuck at the same error — not B's failure and not a clean slate.
    if (!await launched.page.getByTestId("ai-conversation-sidebar").isVisible()) {
      await launched.page.getByRole("button", { name: /AI 助手/u }).click();
    }
    await expect(launched.page.getByTestId("ai-conversation-action-bar"))
      .toContainText("任务还没复制成功");

    await openRecentProject(launched.page, projectB.sourcePath, { editable: false });
    if (!await launched.page.getByTestId("ai-conversation-sidebar").isVisible()) {
      await launched.page.getByRole("button", { name: /AI 助手/u }).click();
    }
    await expect(launched.page.getByTestId("ai-conversation-action-bar"))
      .toContainText("任务还没复制成功");
    expect(readFileSync(projectA.sourcePath).equals(projectA.original)).toBe(true);
    expect(readFileSync(projectB.sourcePath).equals(projectB.original)).toBe(true);
  } finally {
    await stopStemmio(launched.electronApp, launched.isolatedUserData);
    removeSourceFixture(projectA.sourceDirectory);
    removeSourceFixture(projectB.sourceDirectory);
  }
});

test("a rapid double click creates exactly one durable Request", {
  tag: ["@smoke-run-lifecycle"],
}, async () => {
  test.setTimeout(120_000);
  const fixture = createSourceFixture("double-submit.html");
  const launched = await launchStemmio({ activeSourcePath: fixture.sourcePath });
  try {
    await launched.electronApp.evaluate(({ clipboard }) => clipboard.clear());
    await addComment(launched.page, fixture.sourcePath);
    if (!await launched.page.getByTestId("ai-conversation-sidebar").isVisible()) {
      await launched.page.getByRole("button", { name: /AI 助手/u }).click();
    }
    const sidebar = await chooseModifyIntent(launched.page);
    await sidebar.getByTestId("ai-conversation-copy-task").dblclick({ delay: 0 });
    await expect(launched.page.getByTestId("ai-conversation-action-bar")
      .getByText("任务已复制，等你的 AI 改完", { exact: true })).toBeVisible();
    await expect.poll(
      () => requestDirectoryCount(launched.workspace),
      { timeout: 20_000 },
    ).toBe(1);
    await launched.page.waitForTimeout(1_000);
    expect(requestDirectoryCount(launched.workspace)).toBe(1);
    const copied = await launched.electronApp.evaluate(
      ({ clipboard }) => clipboard.readText(),
    );
    expect(copied).toMatch(/请执行\s+.+?\/PROMPT\.md\s+中的单轮任务/u);
    expect(readFileSync(fixture.sourcePath).equals(fixture.original)).toBe(true);
  } finally {
    await stopStemmio(launched.electronApp, launched.isolatedUserData);
    removeSourceFixture(fixture.sourceDirectory);
  }
});

test("ending a copied run still warns after restart and blocks late finalization", async () => {
  test.setTimeout(120_000);
  const fixture = createSourceFixture("cancel-copied-run.html");
  let launched = await launchStemmio({ activeSourcePath: fixture.sourcePath });
  try {
    const request = await addCommentAndSubmit(
      launched.page,
      launched.electronApp,
      fixture.sourcePath,
    );
    await closeStemmioGracefully(launched.electronApp, launched.page);
    launched = await launchStemmio({
      isolatedUserData: launched.isolatedUserData,
    });
    await waitForProjectReady(launched.page);
    /*
     * The restarted round comes back as the delivery step of the thread. The exact
     * phase wording (preparing vs. confirmed) is presentation detail; what the
     * contract needs is that the handoff step is the one carrying the round.
     */
    if (!await launched.page.getByTestId("ai-conversation-sidebar").isVisible()) {
      await launched.page.getByRole("button", { name: /AI 助手/u }).click();
    }
    const runProgress = launched.page.getByTestId("ai-conversation-run-progress");
    await expect(runProgress).toBeVisible();
    const endRound = launched.page.getByTestId("ai-conversation-stop");
    await expect(endRound).toBeEnabled();
    await endRound.click();

    const warning = launched.page.getByRole("dialog", {
      name: "AI Agent 可能仍在修改",
    });
    await expect(warning).toBeVisible();
    await expect(warning.getByText(
      "结束本轮后，AI Agent 的修改将不会保存到源页。建议先停止 AI Agent。",
      { exact: true },
    )).toBeVisible();
    const continueWaiting = warning.getByRole("button", { name: "继续等待" });
    await expect(continueWaiting).toBeFocused();
    // The contract under test is durable cancellation, not native pointer hit
    // testing. On a saturated Electron CI host, input injection can return before
    // the renderer consumes the click; dispatch inside the renderer so the next
    // assertion is ordered after the React handler.
    await continueWaiting.dispatchEvent("click");
    await expect(warning).toBeHidden();
    await expect(endRound).toBeEnabled();

    await endRound.click();
    await expect(warning).toBeVisible();
    await warning.getByRole("button", {
      name: "结束本轮并继续编辑",
    }).dispatchEvent("click");
    await expect(warning).toBeHidden();
    const cancellationNotice = launched.page.locator(".toast.show").filter({
      hasText: "本轮已结束，已恢复编辑",
    });
    await expect(cancellationNotice).toBeVisible();
    await expect(cancellationNotice.getByText(
      "AI Agent 不会被自动停止；如仍在运行，请手动停止。",
      { exact: true },
    )).toBeVisible();
    await expect(launched.page.getByTestId("ai-conversation-sidebar")).toBeHidden();
    const globalCommentButton = launched.page.locator('aside[aria-label="本轮评论"]')
      .getByRole("button", { name: "全局评论", exact: true });
    await expect(globalCommentButton).toBeVisible();
    await expect(globalCommentButton).toBeEnabled();
    expect(readFileSync(fixture.sourcePath).equals(fixture.original)).toBe(true);

    writeAiOutput(request.requestRoot, (base) => (
      base.replace(ORIGINAL_TEXT, UPDATED_TEXT)
    ));
    const lateFinalization = runOfficialFinalizer(
      request.requestRoot,
      request.changeRequest,
    );
    expect(lateFinalization).toMatchObject({
      ok: true,
      status: "cancelled",
      accepted: false,
      retryable: false,
    });
    expect(lateFinalization.message)
      .toBe("本轮已在源页结束。请停止 AI Agent，不要重试。");
    expect(existsSync(path.join(
      request.requestRoot,
      "attempts",
      "attempt_001",
      "completion.json",
    ))).toBe(false);
    expect(
      workingHtmlFiles(
        launched.workspace,
        request.changeRequest.projectId,
      ),
    ).toHaveLength(1);
    expect(readFileSync(fixture.sourcePath).equals(fixture.original)).toBe(true);
  } finally {
    await stopStemmio(launched.electronApp, launched.isolatedUserData);
    removeSourceFixture(fixture.sourceDirectory);
  }
});

test("an unknown Request outcome stays fail-closed and reconciles automatically", {
  tag: ["@smoke-run-lifecycle"],
}, async () => {
  test.setTimeout(120_000);
  const fixture = createSourceFixture("unknown-request-outcome.html");
  const launched = await launchStemmio({ activeSourcePath: fixture.sourcePath });
  try {
    await addComment(launched.page, fixture.sourcePath);
    let requestDispatched = false;
    let allowUnknownRequestReconcile = false;
    const bridgeRoute = "**/*";
    const injectUnknownRequestOutcome = async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === "/request" && !requestDispatched) {
        requestDispatched = true;
        const response = await route.fetch();
        if (!response.ok()) {
          await route.fulfill({ response });
          return;
        }
        await route.abort("timedout");
        return;
      }
      if (
        url.pathname === "/workspace"
        && requestDispatched
        && !allowUnknownRequestReconcile
      ) {
        await route.abort("timedout");
        return;
      }
      await route.continue();
    };
    await launched.page.route(bridgeRoute, injectUnknownRequestOutcome);

    if (!await launched.page.getByTestId("ai-conversation-sidebar").isVisible()) {
      await launched.page.getByRole("button", { name: /AI 助手/u }).click();
    }
    await chooseClipboardDelivery(launched.page);
    /*
     * The outcome is unknown, so the round stays in the thread as a delivery still
     * being confirmed. The panel-only copy ("正在确认这次发送是否成功" and its status
     * chip) has no sidebar counterpart; the fail-closed contract is held by the
     * request-directory and reconcile assertions below, not by that sentence.
     */
    await expect(launched.page.getByTestId("ai-conversation-action-bar"))
      .toContainText("本轮任务状态暂时无法确认", { timeout: 30_000 });
    await expect(launched.page.getByTestId("ai-conversation-run-progress"))
      .toHaveCount(0);
    await expect(launched.page.getByRole("button", { name: "立即重新核对" }))
      .toHaveCount(0);
    await expect(launched.page.getByRole("button", { name: "重新打开源页" }).first())
      .toHaveCount(0);
    await expect.poll(
      () => requestDirectoryCount(launched.workspace),
      { timeout: 20_000 },
    ).toBe(1);

    allowUnknownRequestReconcile = true;
    await expect(launched.page.getByTestId("ai-conversation-action-bar")
      .getByText("任务已复制，等你的 AI 改完", { exact: true })).toBeVisible({ timeout: 20_000 });
    await launched.page.unroute(bridgeRoute, injectUnknownRequestOutcome);
    // Ending the reconciled round still asks once: the task may already be in
    // an Agent's hands, so the confirmation dialog owns the final action.
    await launched.page.getByTestId("ai-conversation-stop").click();
    await expect(launched.page.getByRole("dialog", {
      name: "AI Agent 可能仍在修改",
    }).getByRole("button", { name: "结束本轮并继续编辑" })).toBeEnabled();
    expect(requestDirectoryCount(launched.workspace)).toBe(1);
    expect(readFileSync(fixture.sourcePath).equals(fixture.original)).toBe(true);
  } finally {
    await stopStemmio(launched.electronApp, launched.isolatedUserData);
    removeSourceFixture(fixture.sourceDirectory);
  }
});

test("accepted source survives a display verification failure and repairs without adopting twice", {
  tag: ["@smoke-review"],
}, async ({}, testInfo) => {
  const fixture = createSourceFixture("accepted-page-recovery.html");
  const launched = await launchStemmio({ activeSourcePath: fixture.sourcePath });
  const decisions = [];
  try {
    const request = await addCommentAndSubmit(launched.page, launched.electronApp, fixture.sourcePath);
    writeAiOutput(request.requestRoot, (base) => preserveCandidateSourceIdsForFixture(base, base.replace(ORIGINAL_TEXT, UPDATED_TEXT)));
    runOfficialFinalizer(request.requestRoot, request.changeRequest);
    await launched.page.getByRole("button", { name: "查看修改", exact: true }).click();
    await expect(launched.page.getByTestId("ai-review-workspace")).toBeVisible();
    launched.page.on("request", (request) => {
      if (request.method() === "POST" && new URL(request.url()).pathname === "/ready-version/activate") {
        decisions.push(request.postDataJSON());
      }
    });
    const adoptionResponses = [];
    launched.page.on("response", async (response) => {
      if (new URL(response.url()).pathname !== "/ready-version/activate") return;
      const body = await response.json().catch(() => ({}));
      adoptionResponses.push({ status: response.status(), error: body.error?.code || body.code || null });
    });
    await launched.page.evaluate(() => {
      const originalMark = performance.mark.bind(performance);
      const fault = { enabled: true, committed: false, failures: 0 };
      window.__acceptedPageVerificationFault = fault;
      performance.mark = function(name, ...args) {
        if (name === "stemmio:accept:commit-end") fault.committed = true;
        if (name === "stemmio:canvas:verify-ack" && fault.enabled && fault.committed) {
          fault.failures += 1;
          throw new Error("Synthetic accepted-page verification failure");
        }
        return originalMark(name, ...args);
      };
    });
    await launched.page.getByRole("button", { name: "采用修改", exact: true }).click();
    await launched.page.getByRole("button", { name: "确认并采纳" }).click();
    const sidebar = launched.page.getByTestId("ai-conversation-sidebar");
    const actions = sidebar.getByTestId("ai-conversation-action-bar");
    await expect(actions).toContainText("已采用，但页面需要恢复");
    const stage = launched.page.locator(".review-scroll-stage");
    await stage.evaluate((element) => { element.scrollTop = 800; });
    await expect.poll(() => stage.evaluate((element) => element.scrollTop)).toBeGreaterThan(750);
    await expect(actions).toBeInViewport({ ratio: 1 });
    await expect(actions.getByRole("button", { name: "重试恢复页面", exact: true })).toBeInViewport({ ratio: 1 });
    expect(decisions, JSON.stringify(adoptionResponses)).toHaveLength(1);
    expect(await launched.page.evaluate(() => window.__acceptedPageVerificationFault.failures)).toBeGreaterThan(0);
    const active = await launched.page.evaluate(() => window.stemmioProjects.getActiveProject());
    const accepted = readFileSync(active.sourcePath, "utf8");
    expect(accepted).toContain(UPDATED_TEXT);
    expect(accepted).not.toContain(ORIGINAL_TEXT);
    await expect(sidebar.getByRole("button", { name: "采用修改", exact: true })).toHaveCount(0);
    await expect(actions.getByRole("button")).toHaveCount(1);
    await launched.page.screenshot({ path: testInfo.outputPath("accepted-page-needs-recovery.png"), animations: "disabled" });
    await launched.page.evaluate(() => { window.__acceptedPageVerificationFault.enabled = false; });
    await actions.getByRole("button", { name: "重试恢复页面", exact: true }).click();
    await expect(sidebar.getByRole("button", { name: "重试恢复页面", exact: true })).toHaveCount(0, { timeout: 45_000 });
    await expect(launched.page.getByRole("button", { name: "编辑", exact: true })).toBeEnabled({ timeout: 45_000 });
    expect(decisions, JSON.stringify(adoptionResponses)).toHaveLength(1);
    expect(readFileSync(active.sourcePath, "utf8")).toBe(accepted);
    expect(readFileSync(fixture.sourcePath)).toEqual(fixture.original);

    // Recovery settles the existing project identity. The version tree must
    // be usable immediately from the current tab, and leaving that history
    // view must return to the same editable Working Copy without a second
    // activation/promotion.
    const aiSidebar = launched.page.getByTestId("ai-conversation-sidebar");
    if (await aiSidebar.isVisible()) {
      await launched.page.getByRole("button", { name: "AI 助手", exact: true }).click();
      await expect(aiSidebar).toHaveCount(0);
    }
    const globalSidebar = launched.page.locator(".workbench-global-sidebar");
    if (await globalSidebar.getAttribute("data-open") !== "true") {
      await launched.page.getByRole("button", { name: "展开左侧边栏", exact: true }).click();
    }
    const projectName = path.basename(active.sourcePath, path.extname(active.sourcePath));
    const projectRow = globalSidebar.getByRole("button", { name: projectName, exact: true });
    await expect(projectRow).toBeVisible({ timeout: 30_000 });
    const projectItem = projectRow.locator("xpath=..");
    if (await projectRow.getAttribute("aria-expanded") !== "true") await projectRow.click();
    await expect(projectItem.locator(".sidebar-project-current-row")).toBeVisible();
    await projectItem.locator(".sidebar-project-history-toggle").click();
    await expect(projectItem.locator(".sidebar-version-file")).toHaveCount(2, { timeout: 30_000 });
    const adoptedVersion = projectItem.getByRole("button", { name: "V2，历史版本", exact: true });
    await expect(adoptedVersion).toBeVisible();
    await adoptedVersion.click();
    const historyTab = launched.page.locator('.workbench-tab[data-kind="history"]')
      .filter({ hasText: projectName }).getByRole("tab");
    await expect(historyTab).toHaveAttribute("aria-selected", "true", { timeout: 60_000 });
    const mode = launched.page.getByRole("group", { name: "工作模式", exact: true });
    await expect(mode).toHaveAttribute("data-view-label", "历史");
    await expect(mode.getByRole("button", { name: "编辑", exact: true })).toBeDisabled();
    await projectItem.locator(".sidebar-project-current-row").click();
    const currentTab = launched.page.locator('.workbench-tab[data-kind="document"]')
      .filter({ hasText: projectName }).getByRole("tab");
    await expect(currentTab).toHaveAttribute("aria-selected", "true", { timeout: 60_000 });
    await expect(mode).toHaveAttribute("data-view-label", "当前");
    await expect(mode.getByRole("button", { name: "编辑", exact: true })).toBeEnabled();
    expect(decisions, JSON.stringify(adoptionResponses)).toHaveLength(1);
    expect(workingHtmlFiles(launched.workspace, request.changeRequest.projectId)).toHaveLength(1);

    // A native edit after recovery must save into the same managed source;
    // the external fixture remains protected.
    const recoveredFrame = await loadedDiskFrame(launched.page, active.sourcePath);
    await activateNativeEdit(recoveredFrame, "list-item");
    await setTextSelection(recoveredFrame, "list-item", 0, UPDATED_TEXT.length);
    await launched.page.keyboard.insertText("恢复后本地保存");
    await launched.page.keyboard.press("Escape");
    await expect.poll(() => {
      try { return readFileSync(active.sourcePath, "utf8"); }
      catch (cause) {
        // Protected publication parks the previous inode before linking the
        // new one; the source name can be absent until that save settles.
        if (cause.code === "ENOENT") return "";
        throw cause;
      }
    }, { timeout: 30_000 }).toContain("恢复后本地保存");
    expect(readFileSync(fixture.sourcePath)).toEqual(fixture.original);

    // A subsequent request is allowed from the repaired, edited document;
    // it must create one new request while retaining the single adoption.
    const nextRequest = await addCommentAndSubmit(
      launched.page,
      launched.electronApp,
      active.sourcePath,
      "恢复后下一轮",
    );
    await expect.poll(() => requestDirectoryCount(launched.workspace), { timeout: 20_000 })
      .toBe(2);
    expect(decisions, JSON.stringify(adoptionResponses)).toHaveLength(1);
    expect(workingHtmlFiles(launched.workspace, request.changeRequest.projectId)).toHaveLength(1);
    const nextRequestRecord = JSON.parse(readFileSync(
      path.join(nextRequest.requestRoot, "request.json"),
      "utf8",
    ));
    const nextManifest = JSON.parse(readFileSync(
      path.join(nextRequest.requestRoot, "input-manifest.json"),
      "utf8",
    ));
    const nextAnnotations = JSON.parse(readFileSync(
      path.join(nextRequest.requestRoot, "input", "annotations", "records.json"),
      "utf8",
    ));
    expect(nextRequestRecord.request.taskSpec.instructions).toHaveLength(1);
    expect(nextRequestRecord.request.taskSpec.instructions[0].text)
      .toContain("恢复后下一轮");
    // The intentional edit after recovery is the only audit context carried
    // forward; it is based on the adopted V2, never the previous round.
    expect(nextRequestRecord.request.changeEvents).toHaveLength(1);
    expect(nextRequestRecord.request.changeEvents[0]).toMatchObject({
      basedOnVersionId: "ver_0002",
      before: { text: UPDATED_TEXT },
      after: { text: "恢复后本地保存" },
    });
    expect(nextAnnotations.changeEvents).toEqual(nextRequestRecord.request.changeEvents);
    expect(nextAnnotations.comments).toHaveLength(1);
    expect(nextAnnotations.comments[0].text).toContain("恢复后下一轮");
    const latestSavedBytes = readFileSync(active.sourcePath);
    expect(readFileSync(path.join(
      nextRequest.requestRoot,
      "input",
      "base",
      "index.html",
    ))).toEqual(latestSavedBytes);
    expect(nextManifest.readOrder).toContain("input/annotations/records.json");
    expect(nextManifest.files).toContainEqual(expect.objectContaining({
      path: "input/base/index.html",
      role: "base-html",
      byteLength: latestSavedBytes.byteLength,
      sha256: nextRequest.changeRequest.expectedSourceSha256,
    }));
    await expect(launched.page.getByTestId("ai-review-workspace")).toHaveCount(0);
    await expect(launched.page.getByRole("button", { name: "采用修改", exact: true })).toHaveCount(0);
    expect(readFileSync(fixture.sourcePath)).toEqual(fixture.original);
    await launched.page.screenshot({ path: testInfo.outputPath("accepted-page-recovered.png"), animations: "disabled" });
  } finally {
    await stopStemmio(launched.electronApp, launched.isolatedUserData);
    removeSourceFixture(fixture.sourceDirectory);
  }
});

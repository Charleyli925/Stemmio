import { expect, test } from "@playwright/test";

import {
  activateNativeEdit,
  caseSelector,
  fixtureBuffer,
  loadFixture as loadRawFixture,
} from "./stemmio-driver.mjs";

const loadFixture = (page, name, options = {}) => loadRawFixture(page, name, {
  ...options,
  identifiedWorkingCopy: true,
});

async function switchTab(frame, panelId) {
  await frame.evaluate((nextPanelId) => {
    document.querySelectorAll("[data-p]").forEach((tab) => {
      tab.classList.toggle("active", tab.getAttribute("data-p") === nextPanelId);
    });
    document.querySelectorAll(".panel").forEach((panel) => {
      panel.classList.toggle("active", panel.id === nextPanelId);
    });
    window.dispatchEvent(new Event("resize"));
    window.requestAnimationFrame(() => {
      window.dispatchEvent(new Event("resize"));
    });
  }, panelId);
  await frame.waitForFunction((nextPanelId) => {
    const panel = document.getElementById(nextPanelId);
    return Boolean(panel && panel.getClientRects().length > 0);
  }, panelId);
}

async function openRailGlobalCommentComposer(page) {
  const button = page.locator('aside[aria-label="本轮评论"]')
    .getByRole("button", { name: "全局评论", exact: true });
  await expect(button).toBeVisible();
  await expect(button).toBeEnabled();
  await button.click();
}

async function saveComment(page, frame, caseId, text) {
  await frame.locator(caseSelector(caseId)).click();
  await page.getByRole("toolbar", { name: /编辑/u })
    .getByRole("button", { name: /留评论/u })
    .click();
  const composer = page.getByRole("region", { name: "添加评论" });
  await expect(composer).toBeVisible();
  const textbox = composer.getByRole("textbox", { name: "评论内容" });
  await expect(textbox).toBeFocused();
  await expect.poll(() => composer.evaluate((element) => (
    Number.isFinite(Number.parseFloat(getComputedStyle(element).top))
  ))).toBe(true);
  await expect.poll(async () => {
    const [targetBox, composerBox] = await Promise.all([
      frame.locator(caseSelector(caseId)).boundingBox(),
      composer.boundingBox(),
    ]);
    if (!targetBox || !composerBox) return Number.NEGATIVE_INFINITY;
    return Math.floor(composerBox.y - targetBox.y);
  }).toBeGreaterThanOrEqual(-32);
  await textbox.fill(text);
  await composer.getByRole("button", { name: "评论", exact: true }).click();
}

async function saveGlobalComment(page, text) {
  await openRailGlobalCommentComposer(page);
  const composer = page.getByRole("region", { name: "添加评论" });
  const textbox = composer.getByRole("textbox", { name: "评论内容" });
  await expect(textbox).toBeFocused();
  await textbox.fill(text);
  await textbox.press("Enter");
  await expect(composer).toHaveCount(0);
}

async function expectQuietComposerActions(composer) {
  const actionButtons = composer.locator(
    ".comment-tool-button, .add-comment-button",
  );
  await expect(actionButtons).toHaveCount(5);
  expect(await actionButtons.evaluateAll((buttons) => buttons.map((button) => {
    const style = getComputedStyle(button);
    return {
      backgroundColor: style.backgroundColor,
      borderTopWidth: style.borderTopWidth,
      boxShadow: style.boxShadow,
      height: style.height,
      width: style.width,
    };
  }))).toEqual(Array.from({ length: 5 }, () => ({
    backgroundColor: "rgba(0, 0, 0, 0)",
    borderTopWidth: "0px",
    boxShadow: "none",
    height: "29px",
    width: "29px",
  })));
  const footerButtons = composer.locator(
    ".composer-actions > .composer-footer-tools > button, "
    + ".composer-actions > .add-comment-button",
  );
  await expect(footerButtons).toHaveCount(4);
  const centerGaps = await footerButtons.evaluateAll((buttons) => {
    const centers = buttons.map((button) => {
      const rect = button.getBoundingClientRect();
      return rect.left + rect.width / 2;
    });
    return centers.slice(1).map((center, index) => center - centers[index]);
  });
  expect(Math.max(...centerGaps) - Math.min(...centerGaps)).toBeLessThanOrEqual(1);
  const submitButton = composer.getByRole("button", { name: "评论", exact: true });
  await expect(submitButton.locator("svg")).toHaveAttribute("width", "20");
  expect(await submitButton.evaluate((button) => getComputedStyle(button).color))
    .toBe("rgb(90, 85, 223)");
}

test("deleting a source module confirms and removes descendant comments", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/");
  const { frame } = await loadFixture(page, "module-padding-hit.html", {
    buffer: fixtureBuffer("module-padding-hit.html"),
  });
  const commentText = "这条评论会随所属模块一起删除";
  await saveComment(page, frame, "module-padding-copy", commentText);
  const savedCard = page.locator(".comment-card").filter({ hasText: commentText });
  await expect(savedCard).toBeVisible();

  const sourceModule = frame.locator(caseSelector("filled-module"));
  await sourceModule.click({ position: { x: 20, y: 20 } });
  const toolbar = page.getByRole("toolbar", { name: /编辑/u });
  let deleteDialogMessage = "";
  page.once("dialog", async (dialog) => {
    deleteDialogMessage = dialog.message();
    await dialog.dismiss();
  });
  await toolbar.getByRole("button", { name: "删除元素", exact: true }).click();
  expect(deleteDialogMessage).toContain("关联的 1 条评论也会一起删除");
  await expect(sourceModule).toHaveCount(1);
  await expect(savedCard).toHaveCount(1);

  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain("关联的 1 条评论也会一起删除");
    await dialog.accept();
  });
  await toolbar.getByRole("button", { name: "删除元素", exact: true }).click();
  await expect(sourceModule).toHaveCount(0);
  await expect(savedCard).toHaveCount(0);
  await expect(page.getByText("评论位置已丢失")).toHaveCount(0);
});

test("comment textareas focus immediately and use Enter to save with Shift+Enter for new lines", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/");
  const { frame } = await loadFixture(page, "tabbed-comments.html", {
    buffer: fixtureBuffer("tabbed-comments.html"),
  });
  await frame.locator(caseSelector("tab-comment-one")).click();
  await page.getByRole("toolbar", { name: /编辑/u })
    .getByRole("button", { name: /留评论/u })
    .click();

  const composer = page.getByRole("region", { name: "添加评论" });
  const textbox = composer.getByRole("textbox", { name: "评论内容" });
  await expect(textbox).toBeFocused();
  await textbox.fill("第一行");
  await textbox.press("Shift+Enter");
  await textbox.pressSequentially("第二行");
  await expect(textbox).toHaveValue("第一行\n第二行");
  await expectQuietComposerActions(composer);
  await page.screenshot({
    path: testInfo.outputPath("comment-rail-local-composer-quiet-actions.png"),
  });
  await textbox.press("Enter");
  await expect(composer).toHaveCount(0);

  const savedCard = page.locator(
    ".comment-rail-content > .comment-card:not(.draft-comment-card)",
  ).filter({ hasText: "第一行" });
  await expect(savedCard).toBeVisible();
  await savedCard.hover();
  await savedCard.getByRole("button", { name: "编辑评论" }).click();
  const editBox = savedCard.getByRole("textbox", { name: /编辑评论/u });
  await expect(editBox).toBeFocused();
  await editBox.fill("修改第一行");
  await editBox.press("Shift+Enter");
  await editBox.pressSequentially("修改第二行");
  await expect(editBox).toHaveValue("修改第一行\n修改第二行");
  await editBox.press("Enter");
  await expect(editBox).toHaveCount(0);
  await expect(savedCard).toContainText("修改第二行");
});

test("focused comments remain below the sticky rail header and global comments sort first", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const { frame } = await loadFixture(page, "tabbed-comments.html", {
    buffer: fixtureBuffer("tabbed-comments.html"),
  });
  const localText = "顶部页签局部评论";
  await saveComment(page, frame, "tab-control-one", localText);

  const rail = page.locator('aside[aria-label="本轮评论"]');
  const header = rail.locator(".comment-rail-header");
  const globalComment = rail.getByRole("button", {
    name: "全局评论",
    exact: true,
  });
  await expect(page.locator(".app-topbar .global-comment-button")).toHaveCount(0);
  await expect(globalComment).toContainText("添加全局评论");
  await expect(header).not.toContainText("与正文同步滚动");
  expect(await globalComment.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      backgroundColor: style.backgroundColor,
      borderTopWidth: style.borderTopWidth,
      boxShadow: style.boxShadow,
    };
  })).toEqual({
    backgroundColor: "rgba(0, 0, 0, 0)",
    borderTopWidth: "0px",
    boxShadow: "none",
  });
  const localCard = rail.locator(
    ".comment-rail-content > .comment-card:not(.draft-comment-card)",
  ).filter({ hasText: localText });
  await expect(localCard).toHaveAttribute("data-focused", "true");
  const [headerBox, localCardBox] = await Promise.all([
    header.boundingBox(),
    localCard.boundingBox(),
  ]);
  expect(headerBox).not.toBeNull();
  expect(localCardBox).not.toBeNull();
  expect(localCardBox.y).toBeGreaterThanOrEqual(
    headerBox.y + headerBox.height + 14,
  );

  await globalComment.click();
  const globalComposer = page.getByRole("region", { name: "添加评论" });
  const globalTextbox = globalComposer.getByRole("textbox", {
    name: "评论内容",
  });
  await expect(globalTextbox).toBeFocused();
  await globalTextbox.fill("整个页面优先处理");
  await expectQuietComposerActions(globalComposer);
  await page.screenshot({
    path: testInfo.outputPath("comment-rail-global-composer-quiet-actions.png"),
  });
  await globalTextbox.press("Enter");

  const cards = rail.locator(
    ".comment-rail-content > .comment-card:not(.draft-comment-card)",
  );
  await expect(cards).toHaveCount(2);
  await expect(cards.nth(0)).toContainText("整个页面优先处理");
  await expect(cards.nth(1)).toContainText(localText);
});

test("dense comments stay inside the Canvas bottom and wheel into view without stretching the page", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const { frame } = await loadFixture(page, "tabbed-comments.html", {
    buffer: fixtureBuffer("tabbed-comments.html"),
  });
  const stage = page.locator(".review-scroll-stage");
  const rail = page.locator('aside[aria-label="本轮评论"]');
  const canvas = page.getByTestId("html-canvas-editor");
  const baselineStageHeight = await stage.evaluate(
    (element) => element.scrollHeight,
  );

  const commentTexts = Array.from(
    { length: 7 },
    (_, index) => `页面顶部密集评论 ${index + 1}`,
  );
  for (const text of commentTexts) {
    await saveGlobalComment(page, text);
  }
  await frame.locator(caseSelector("tab-control-one")).click();

  const cards = rail.locator(
    ".comment-rail-content > .comment-card:not(.draft-comment-card)",
  );
  await expect(cards).toHaveCount(commentTexts.length);
  await expect.poll(() => rail.evaluate((element) => (
    Number.parseFloat(
      getComputedStyle(element).getPropertyValue("--comment-rail-height"),
    )
  ))).toBeGreaterThan(0);
  const [stageAfter, railBox, canvasBox] = await Promise.all([
    stage.evaluate((element) => ({
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
    })),
    rail.boundingBox(),
    canvas.boundingBox(),
  ]);
  expect(railBox).not.toBeNull();
  expect(canvasBox).not.toBeNull();
  expect(stageAfter.scrollHeight).toBeLessThanOrEqual(
    Math.max(baselineStageHeight, stageAfter.clientHeight) + 1,
  );
  expect(Math.abs(railBox.height - canvasBox.height)).toBeLessThanOrEqual(1);

  const lastCard = cards.last();
  const lastBefore = await lastCard.boundingBox();
  expect(lastBefore).not.toBeNull();
  expect(lastBefore.y + lastBefore.height)
    .toBeGreaterThan(railBox.y + railBox.height);

  await page.mouse.move(
    railBox.x + Math.floor(railBox.width / 2),
    railBox.y + Math.min(railBox.height - 40, 260),
  );
  await page.mouse.wheel(0, 2_000);
  await expect.poll(() => rail.locator(".comment-rail-content").evaluate(
    (element) => Number.parseFloat(
      getComputedStyle(element).getPropertyValue("--comment-rail-offset"),
    ),
  )).toBeLessThan(-1);
  const lastAfter = await lastCard.boundingBox();
  expect(lastAfter).not.toBeNull();
  expect(lastAfter.y + lastAfter.height)
    .toBeLessThanOrEqual(railBox.y + railBox.height - 20);
  expect(await stage.evaluate((element) => element.scrollHeight))
    .toBeLessThanOrEqual(
      Math.max(baselineStageHeight, stageAfter.clientHeight) + 1,
    );
  await page.screenshot({
    path: testInfo.outputPath("comment-rail-bottom-boundary.png"),
  });

  await page.mouse.wheel(0, -2_000);
  await expect.poll(() => rail.locator(".comment-rail-content").evaluate(
    (element) => Number.parseFloat(
      getComputedStyle(element).getPropertyValue("--comment-rail-offset"),
    ),
  )).toBe(0);
});

test("comment cards keep stable anchors while nearby source text is being edited", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/");
  const { frame } = await loadFixture(page, "tabbed-comments.html", {
    buffer: fixtureBuffer("tabbed-comments.html"),
  });
  await saveComment(page, frame, "tab-control-one", "页签锚点评论");
  await saveComment(page, frame, "tab-comment-one", "正文锚点评论");

  const target = await activateNativeEdit(frame, "tab-comment-one");
  await expect(target).toHaveAttribute(
    "contenteditable",
    /^(?:plaintext-only|true)$/u,
  );
  const cards = page.locator(
    ".comment-rail-content > .comment-card:not(.draft-comment-card)",
  );
  await expect(cards).toHaveCount(2);
  await page.waitForTimeout(420);
  const before = await cards.evaluateAll((elements) => elements.map(
    (element) => element.getBoundingClientRect().top,
  ));

  await target.press("End");
  await target.pressSequentially(
    " 持续输入一段足够长的文字来触发正文重新排版，但评论卡在输入完成前保持稳定。",
    { delay: 5 },
  );
  const during = await cards.evaluateAll((elements) => elements.map(
    (element) => element.getBoundingClientRect().top,
  ));
  expect(during).toHaveLength(before.length);
  during.forEach((top, index) => {
    expect(Math.abs(top - before[index])).toBeLessThanOrEqual(1);
  });

  await target.press("Escape");
  await expect(target).not.toHaveAttribute(
    "contenteditable",
    /^(?:plaintext-only|true)$/u,
  );
});

test("indexed script tabs keep hidden comments grouped, suppress ghost markers, and shrink the canvas", {
  tag: ["@gate-smoke","@smoke-comments"],
}, async ({
  page,
}) => {
  const browserErrors = [];
  page.on("console", (message) => {
    if (
      message.type() === "error"
      && !(
        message.text().includes("Blocked script execution in 'about:")
        && message.text().includes("because the document's frame is sandboxed")
      )
    ) {
      browserErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => browserErrors.push(error.message));
  await page.setViewportSize({ width: 1600, height: 900 });
  const { frame, iframe } = await loadFixture(page, "indexed-script-tabs.html", {
    buffer: fixtureBuffer("indexed-script-tabs.html"),
  });

  const firstText = "锁单确收页评论";
  const secondText = "IPV页评论";
  const firstCommentMarker = page.getByTestId("html-canvas-editor")
    .locator('button[title^="查看"][title*="锁单确收评论目标"]');
  await saveComment(page, frame, "indexed-comment-one", firstText);

  await page.getByRole("button", { name: "预览", exact: true }).click();
  const previewIframe = page.locator('iframe[title="HTML 交互预览"]');
  await expect(previewIframe).toBeVisible();
  const previewFrame = await (await previewIframe.elementHandle())?.contentFrame();
  if (!previewFrame) throw new Error("Interactive preview frame is unavailable.");
  await previewFrame.locator(caseSelector("indexed-tab-two")).click();
  await expect(previewFrame.locator("#chart1")).toBeVisible();

  await page.getByRole("button", { name: "编辑", exact: true }).click();
  const rail = page.locator('aside[aria-label="本轮评论"]');
  await expect(rail).toHaveAttribute("data-layout-ready", "true");
  await expect(frame.locator("#chart1")).toBeVisible();
  await expect(frame.locator("#chart0")).toBeHidden();
  await expect(rail.getByText("评论位置无法确认", { exact: true })).toHaveCount(0);
  await expect(rail.getByRole("button", {
    name: "其他标签页评论 1",
  })).toBeVisible();
  await expect(rail.locator(
    ".comment-rail-content > .comment-card:not(.draft-comment-card)",
  )).toHaveCount(0);
  await expect(firstCommentMarker).toHaveCount(0);

  await saveComment(page, frame, "indexed-comment-two", secondText);
  const currentCards = rail.locator(
    ".comment-rail-content > .comment-card:not(.draft-comment-card)",
  );
  await expect(currentCards).toHaveCount(1);
  await expect(currentCards.filter({ hasText: secondText })).toBeVisible();
  await expect(rail.getByText("原位置已变化", { exact: true })).toHaveCount(0);

  await expect.poll(async () => {
    const box = await iframe.boundingBox();
    return Math.round(box?.height ?? 0);
  }).toBeGreaterThan(1600);
  const tallHeight = Math.round((await iframe.boundingBox())?.height ?? 0);

  await rail.getByRole("button", { name: "其他标签页评论 1" }).click();
  const firstOtherTabCard = rail
    .getByRole("region", { name: "其他标签页评论" })
    .getByRole("button", { name: new RegExp(firstText, "u") });
  await expect(firstOtherTabCard).toBeVisible();
  await firstOtherTabCard.click();

  await expect(frame.locator("#chart0")).toBeVisible();
  await expect(frame.locator("#chart1")).toBeHidden();
  await expect(currentCards.filter({ hasText: firstText })).toBeVisible();
  await expect(firstCommentMarker).toHaveText("评1");
  await expect.poll(async () => {
    const box = await iframe.boundingBox();
    return Math.round(box?.height ?? 0);
  }).toBeLessThan(tallHeight - 700);
  expect(browserErrors).toEqual([]);
});

test("comments keep current-tab alignment, render other tabs as neutral header cards, and avoid draft overlap", async ({
  page,
}, testInfo) => {
  const browserErrors = [];
  page.on("console", (message) => {
    if (
      message.type() === "error"
      && !(
        message.text().includes("Blocked script execution in 'about:")
        && message.text().includes("because the document's frame is sandboxed")
      )
    ) {
      browserErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => browserErrors.push(error.message));
  await page.setViewportSize({ width: 1600, height: 900 });
  const { frame } = await loadFixture(page, "tabbed-comments.html", {
    buffer: fixtureBuffer("tabbed-comments.html"),
  });
  const firstText = "第一页已保存评论";
  const secondText = "第二页已保存评论";

  await saveComment(page, frame, "tab-comment-one", firstText);
  await saveComment(page, frame, "tab-control-one", "第一页标签评论一");
  await saveComment(page, frame, "tab-control-one", "第一页标签评论二");
  const firstTabMarker = page.getByRole("button", {
    name: /第一页已有2条评论/u,
  });
  await expect(firstTabMarker).toHaveText("评2");
  await expect(firstTabMarker).toHaveAttribute("data-placement", "tab-side");
  const [firstTabBox, firstTabMarkerBox] = await Promise.all([
    frame.locator(caseSelector("tab-control-one")).boundingBox(),
    firstTabMarker.boundingBox(),
  ]);
  expect(firstTabBox).not.toBeNull();
  expect(firstTabMarkerBox).not.toBeNull();
  expect(
    firstTabMarkerBox.x + (firstTabMarkerBox.width / 2),
  ).toBeGreaterThan(firstTabBox.x + firstTabBox.width);
  expect(firstTabMarkerBox.y + firstTabMarkerBox.height)
    .toBeLessThanOrEqual(firstTabBox.y + 8);
  await switchTab(frame, "panel-two");
  await saveComment(page, frame, "tab-comment-two", secondText);

  await page.getByRole("button", { name: "预览", exact: true }).click();
  const previewIframe = page.locator('iframe[title="HTML 交互预览"]');
  await expect(previewIframe).toBeVisible();
  const previewFrame = await (await previewIframe.elementHandle())?.contentFrame();
  if (!previewFrame) throw new Error("Interactive preview frame is unavailable.");
  await previewFrame.locator('[data-p="panel-two"]').click();
  await expect(previewFrame.locator("#panel-two")).toBeVisible();
  await page.evaluate(() => {
    window.__STEMMIO_COMMENT_LAYOUT_STATES__ = [];
    const recordState = () => {
      const rail = document.querySelector('aside[aria-label="本轮评论"]');
      const state = rail?.getAttribute("data-layout-ready");
      if (
        state
        && window.__STEMMIO_COMMENT_LAYOUT_STATES__.at(-1) !== state
      ) {
        window.__STEMMIO_COMMENT_LAYOUT_STATES__.push(state);
      }
    };
    window.__STEMMIO_COMMENT_LAYOUT_OBSERVER__ = new MutationObserver(
      recordState,
    );
    window.__STEMMIO_COMMENT_LAYOUT_OBSERVER__.observe(document.body, {
      attributes: true,
      childList: true,
      subtree: true,
      attributeFilter: ["data-layout-ready"],
    });
    recordState();
  });
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  const returningRail = page.locator('aside[aria-label="本轮评论"]');
  await expect(returningRail).toHaveAttribute("data-layout-ready", "true");
  const layoutTransition = await page.evaluate(() => {
    window.__STEMMIO_COMMENT_LAYOUT_OBSERVER__?.disconnect();
    return window.__STEMMIO_COMMENT_LAYOUT_STATES__ ?? [];
  });
  expect(layoutTransition).toContain("false");
  expect(layoutTransition.at(-1)).toBe("true");
  expect(Number(
    await returningRail.getAttribute("data-layout-generation"),
  )).toBeGreaterThan(0);
  await expect(frame.locator("#panel-two")).toBeVisible();
  await expect(frame.locator("#panel-one")).toBeHidden();

  const rail = page.locator('aside[aria-label="本轮评论"]');
  const header = rail.locator(".comment-rail-header");
  const currentCards = rail.locator(
    ".comment-rail-content > .comment-card:not(.draft-comment-card)",
  );
  await expect(header.locator("h1")).toContainText("4");
  await expect(header).not.toContainText("当前标签页");
  await expect(currentCards).toHaveCount(3);
  await expect(currentCards.filter({ hasText: secondText })).toBeVisible();
  const otherTabsToggle = rail.getByRole("button", {
    name: "其他标签页评论 1",
  });
  await expect(otherTabsToggle).toBeVisible();
  const [foldedHeaderBox, otherTabsToggleBox] = await Promise.all([
    header.boundingBox(),
    otherTabsToggle.boundingBox(),
  ]);
  expect(foldedHeaderBox).not.toBeNull();
  expect(otherTabsToggleBox).not.toBeNull();
  expect(otherTabsToggleBox.width)
    .toBeLessThan(foldedHeaderBox.width - 40);
  await page.screenshot({
    path: testInfo.outputPath("comment-rail-folded.png"),
  });

  await otherTabsToggle.click();
  const otherTabRegion = rail.getByRole("region", { name: "其他标签页评论" });
  await expect(otherTabRegion).toBeVisible();
  const firstTabGroup = otherTabRegion.getByRole("region", {
    name: "第一页的评论",
  });
  const firstOtherTabCard = firstTabGroup.getByRole("button", {
    name: new RegExp(firstText, "u"),
  });
  await expect(firstTabGroup.locator(
    ".other-tab-comment-group-header > span",
  )).toHaveCount(0);
  await expect(firstOtherTabCard)
    .toHaveClass(/comment-card other-tab-comment-card/u);
  expect(await otherTabRegion.evaluate((element) => (
    element.parentElement?.classList.contains("comment-rail-header")
  ))).toBe(true);
  expect(await firstOtherTabCard.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      backgroundColor: style.backgroundColor,
      borderRadius: style.borderRadius,
    };
  })).toEqual({
    backgroundColor: "rgb(255, 255, 255)",
    borderRadius: "16px",
  });
  await page.screenshot({
    path: testInfo.outputPath("comment-rail-expanded.png"),
  });
  await firstOtherTabCard.click();

  await expect(frame.locator("#panel-one")).toBeVisible();
  await expect(frame.locator("#panel-two")).toBeHidden();
  await expect(currentCards).toHaveCount(3);
  await expect(currentCards.filter({ hasText: firstText })).toBeVisible();
  await expect(currentCards.filter({ hasText: firstText }))
    .toHaveAttribute("data-focused", "true");
  await expect(page.getByRole("region", { name: "添加评论" })).toHaveCount(0);

  const firstTarget = frame.locator(caseSelector("tab-comment-one"));
  await firstTarget.click();
  await page.getByRole("toolbar", { name: /编辑/u })
    .getByRole("button", { name: /留评论/u })
    .click();
  const composer = page.getByRole("region", { name: "添加评论" });
  await composer.getByRole("textbox", { name: "评论内容" })
    .fill("尚未保存但必须保留原样");
  await composer.getByRole("button", { name: "关闭评论编辑器" }).click();

  const unsavedShortcut = rail.getByRole("button", {
    name: "有一条未保存评论",
  });
  const recovery = rail.locator(
    ".comment-rail-content > .draft-comment-card",
  );
  const saved = rail.locator(".comment-card").filter({ hasText: firstText });
  await expect(unsavedShortcut).toBeVisible();
  await expect(recovery).toHaveAttribute(
    "aria-label",
    /未保存评论：.*第一页评论目标：尚未保存但必须保留原样/u,
  );
  await expect(recovery.getByText("未保存", { exact: true })).toBeVisible();
  await expect(saved).toHaveClass(/comment-card/u);
  await expect.poll(async () => {
    const recoveryBox = await recovery.boundingBox();
    const savedBox = await saved.boundingBox();
    if (!recoveryBox || !savedBox) return -1;
    return Math.floor(recoveryBox.y - (savedBox.y + savedBox.height));
  }).toBeGreaterThanOrEqual(16);
  await page.screenshot({
    path: testInfo.outputPath("comment-rail-draft-recovery.png"),
  });

  const firstTargetMarker = page.getByTestId("html-canvas-editor")
    .getByRole("button", {
      name: "正文 · 第一页评论目标",
      exact: true,
    })
    .filter({ hasText: "评1" });
  await expect(firstTargetMarker).toHaveText("评1");
  await expect(header.locator("h1")).toContainText("4");

  await unsavedShortcut.click();
  await expect(composer.getByRole("textbox", { name: "评论内容" }))
    .toBeFocused();
  await expect(unsavedShortcut).toBeVisible();
  await expect.poll(async () => {
    const composerBox = await composer.boundingBox();
    const savedBox = await saved.boundingBox();
    if (!composerBox || !savedBox) return -1;
    return Math.floor(composerBox.y - (savedBox.y + savedBox.height));
  }).toBeGreaterThanOrEqual(16);

  await page.getByRole("button", { name: "预览", exact: true }).click();
  const draftPreviewIframe = page.locator('iframe[title="HTML 交互预览"]');
  await expect(draftPreviewIframe).toBeVisible();
  const draftPreviewFrame = await (
    await draftPreviewIframe.elementHandle()
  )?.contentFrame();
  if (!draftPreviewFrame) {
    throw new Error("Draft preview frame is unavailable.");
  }
  await draftPreviewFrame.locator('[data-p="panel-two"]').click();
  await expect(draftPreviewFrame.locator("#panel-two")).toBeVisible();
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await expect(frame.locator("#panel-two")).toBeVisible();
  await expect(unsavedShortcut).toHaveCount(0);
  const otherTabsWithDraft = rail.getByRole("button", {
    name: "其他标签页评论 2",
  });
  await expect(otherTabsWithDraft).toBeVisible();
  await otherTabsWithDraft.click();

  const expandedWithDraft = rail.getByRole("region", {
    name: "其他标签页评论",
  });
  const firstTabGroupWithDraft = expandedWithDraft.getByRole("region", {
    name: "第一页的评论",
  });
  const hiddenDraftCard = firstTabGroupWithDraft.getByRole("button", {
    name: /第一页：未保存评论：.*第一页评论目标：尚未保存但必须保留原样/u,
  });
  await expect(hiddenDraftCard).toBeVisible();
  await expect(hiddenDraftCard.getByText("未保存", { exact: true })).toBeVisible();
  await expect(firstTabGroupWithDraft.getByRole("button")).toHaveCount(2);
  await expect.poll(async () => {
    const headerBox = await header.boundingBox();
    const firstCurrentCardBox = await currentCards.first().boundingBox();
    if (!headerBox || !firstCurrentCardBox) return -1;
    return Math.floor(
      firstCurrentCardBox.y - (headerBox.y + headerBox.height),
    );
  }).toBeGreaterThanOrEqual(16);
  await page.screenshot({
    path: testInfo.outputPath("comment-rail-other-tab-draft.png"),
  });

  await hiddenDraftCard.click();
  await expect(frame.locator("#panel-one")).toBeVisible();
  await expect(frame.locator("#panel-two")).toBeHidden();
  await expect(composer.getByRole("textbox", { name: "评论内容" }))
    .toHaveValue("尚未保存但必须保留原样");
  await expect(composer.getByRole("textbox", { name: "评论内容" }))
    .toBeFocused();
  await expect(unsavedShortcut).toBeVisible();
  await expect.poll(() => rail.locator("[data-comment-measure]")
    .evaluateAll((nodes) => nodes
      .map((node) => ({
        key: node.getAttribute("data-comment-measure"),
        top: Number.parseFloat(getComputedStyle(node).top),
        text: node.textContent || "",
      }))
      .sort((left, right) => left.top - right.top)
      .map((entry) => {
        if (entry.key === "__composer") return "__composer";
        if (entry.text.includes("第一页标签评论一")) return "tab-one";
        if (entry.text.includes("第一页标签评论二")) return "tab-two";
        if (entry.text.includes("第一页已保存评论")) return "first-saved";
        return entry.key;
      }))).toEqual([
    "tab-one",
    "tab-two",
    "first-saved",
    "__composer",
  ]);
  await expect.poll(() => rail.locator("[data-comment-measure]")
    .evaluateAll((nodes) => {
      const boxes = nodes
        .map((node) => node.getBoundingClientRect())
        .sort((left, right) => left.top - right.top);
      return boxes.slice(1).reduce((minimum, box, index) => (
        Math.min(minimum, box.top - boxes[index].bottom)
      ), Number.MAX_SAFE_INTEGER);
    })).toBeGreaterThanOrEqual(16);
  await page.screenshot({
    path: testInfo.outputPath("comment-rail-hidden-draft-resumed.png"),
  });

  await composer.getByRole("button", { name: "删除未保存评论" }).click();
  await expect(composer.getByRole("alert")).toContainText(
    "删除这条未保存评论？",
  );
  await composer.getByRole("button", { name: "删除", exact: true }).click();
  await expect(composer).toHaveCount(0);
  await expect(unsavedShortcut).toHaveCount(0);
  await expect(recovery).toHaveCount(0);
  await expect(header.locator("h1")).toContainText("4");
  await expect(firstTargetMarker).toHaveText("评1");
  expect(browserErrors).toEqual([]);
});

test("saved comment edits auto-cancel while clean and survive Tab changes while dirty", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/");
  const { frame } = await loadFixture(page, "tabbed-comments.html", {
    buffer: fixtureBuffer("tabbed-comments.html"),
  });
  const savedText = "需要保留的原评论";
  const editedText = "需要保留的原评论，已经修改但尚未确认";
  await saveComment(page, frame, "tab-comment-one", savedText);

  const rail = page.locator('aside[aria-label="本轮评论"]');
  const initialCard = rail.locator(".comment-card").filter({ hasText: savedText });
  const commentId = await initialCard.getAttribute("data-comment-measure");
  if (!commentId) throw new Error("Saved comment did not expose its stable ID.");
  const card = rail.locator(`[data-comment-measure="${commentId}"]`);
  await card.hover();
  await card.getByRole("button", { name: "编辑评论" }).click();
  await expect(card.getByRole("textbox", { name: "编辑评论 1" })).toBeVisible();

  await switchTab(frame, "panel-two");
  await expect(rail.getByRole("button", {
    name: "有一条未保存修改",
  })).toHaveCount(0);
  await switchTab(frame, "panel-one");
  await expect(card.getByRole("textbox", { name: "编辑评论 1" })).toHaveCount(0);
  await expect(card).toContainText(savedText);

  await card.hover();
  await card.getByRole("button", { name: "编辑评论" }).click();
  await card.getByRole("textbox", { name: "编辑评论 1" }).fill(editedText);
  await expect(rail.getByRole("button", {
    name: "有一条未保存修改",
  })).toBeVisible();
  await switchTab(frame, "panel-two");
  const unfinishedEditShortcut = rail.getByRole("button", {
    name: "有一条未保存修改",
  });
  await expect(unfinishedEditShortcut).toBeVisible();

  await unfinishedEditShortcut.click();
  await expect(frame.locator("#panel-one")).toBeVisible();
  await expect(frame.locator("#panel-two")).toBeHidden();
  await expect(frame.locator(caseSelector("tab-comment-one")))
    .toHaveAttribute("data-html-canvas-selected", "part");
  await expect(card.getByRole("textbox", { name: "编辑评论 1" }))
    .toHaveValue(editedText);
  await expect(card.getByRole("textbox", { name: "编辑评论 1" }))
    .toBeFocused();
  await page.screenshot({
    path: testInfo.outputPath("comment-edit-dirty-resumed.png"),
  });
  await card.getByRole("button", { name: "确认修改" }).click();
  await expect(unfinishedEditShortcut).toHaveCount(0);
  await expect(card).toContainText(editedText);
});

test("dynamic comment-card controls remeasure the queue without overlap", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const { frame } = await loadFixture(page, "tabbed-comments.html", {
    buffer: fixtureBuffer("tabbed-comments.html"),
  });
  await saveComment(page, frame, "tab-comment-one", "动态高度评论一");
  await saveComment(page, frame, "tab-comment-one", "动态高度评论二");

  const rail = page.locator('aside[aria-label="本轮评论"]');
  const first = rail.locator(".comment-card").filter({
    hasText: "动态高度评论一",
  });
  const second = rail.locator(".comment-card").filter({
    hasText: "动态高度评论二",
  });
  expect(await first.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      borderLeftWidth: style.borderLeftWidth,
      boxShadow: style.boxShadow,
    };
  })).toEqual({
    borderLeftWidth: "1px",
    boxShadow: "rgba(0, 0, 0, 0.04) 0px 4px 14px 0px",
  });
  const minimumGap = async () => {
    const boxes = await Promise.all([first.boundingBox(), second.boundingBox()]);
    if (!boxes[0] || !boxes[1]) return -1;
    const [top, bottom] = [...boxes].sort((left, right) => left.y - right.y);
    return Math.floor(bottom.y - (top.y + top.height));
  };

  await first.hover();
  await first.getByRole("button", { name: "编辑评论" }).click();
  await expect(first.getByRole("textbox", { name: /编辑评论/u })).toBeVisible();
  expect(await first.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      backgroundColor: style.backgroundColor,
      boxShadow: style.boxShadow,
    };
  })).toEqual({
    backgroundColor: "rgb(255, 255, 255)",
    boxShadow: "rgb(90, 85, 223) 2px 0px 0px 0px inset",
  });
  const [cancelIcon, confirmIcon] = await Promise.all([
    first.getByRole("button", { name: "取消编辑" }).locator("svg").getAttribute("width"),
    first.getByRole("button", { name: "确认修改" }).locator("svg").getAttribute("width"),
  ]);
  expect(cancelIcon).toBe("17");
  expect(confirmIcon).toBe("18");
  expect(await first.locator(".comment-card-tools .comment-tool-button")
    .evaluateAll((buttons) => buttons.map((button) => {
      const style = getComputedStyle(button);
      return {
        backgroundColor: style.backgroundColor,
        borderTopWidth: style.borderTopWidth,
      };
    }))).toEqual(Array.from({ length: 5 }, () => ({
      backgroundColor: "rgba(0, 0, 0, 0)",
      borderTopWidth: "0px",
    })));
  await expect.poll(minimumGap).toBeGreaterThanOrEqual(16);

  await first.getByRole("button", { name: "取消编辑" }).click();
  await first.hover();
  const cardHeightBeforeDelete = await first.evaluate(
    (element) => element.getBoundingClientRect().height,
  );
  await first.getByRole("button", { name: "删除评论" }).click();
  const deleteConfirmation = first.getByRole("alert");
  await expect(deleteConfirmation).toContainText("删除这条评论？");
  const cardHeightAfterDelete = await first.evaluate(
    (element) => element.getBoundingClientRect().height,
  );
  expect(Math.abs(cardHeightAfterDelete - cardHeightBeforeDelete)).toBeLessThan(0.5);
  expect(await deleteConfirmation.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      backgroundColor: style.backgroundColor,
      borderTopWidth: style.borderTopWidth,
    };
  })).toEqual({
    backgroundColor: "rgba(0, 0, 0, 0)",
    borderTopWidth: "0px",
  });
  expect(await deleteConfirmation.locator("button").evaluateAll(
    (buttons) => buttons.map((button) => getComputedStyle(button).borderTopWidth),
  )).toEqual(["0px", "0px"]);
  await expect.poll(minimumGap).toBeGreaterThanOrEqual(16);
  await page.screenshot({
    path: testInfo.outputPath("comment-card-delete-confirm-lightweight.png"),
  });
  await first.getByRole("button", { name: "取消", exact: true }).click();
});

test("comment card hover keeps geometry stable while focus aligns one unchanged queue", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const { frame } = await loadFixture(page, "indexed-script-tabs.html", {
    buffer: fixtureBuffer("indexed-script-tabs.html"),
  });
  await page.getByRole("button", { name: "预览", exact: true }).click();
  const previewIframe = page.locator('iframe[title="HTML 交互预览"]');
  const previewFrame = await (await previewIframe.elementHandle())?.contentFrame();
  if (!previewFrame) throw new Error("Interactive preview frame is unavailable.");
  await previewFrame.locator(caseSelector("indexed-tab-two")).click();
  await expect(previewFrame.locator("#chart1")).toBeVisible();
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await expect(frame.locator("#chart1")).toBeVisible();
  const texts = ["同一位置评论一", "同一位置评论二", "同一位置评论三"];
  for (const text of texts) {
    await saveComment(page, frame, "indexed-comment-two", text);
  }

  const stage = page.locator(".review-scroll-stage");
  const rail = page.locator('aside[aria-label="本轮评论"]');
  const cards = texts.map((text) => (
    rail.locator(".comment-card").filter({ hasText: text })
  ));
  const mountedCards = rail.locator(
    ".comment-rail-content > .comment-card:not(.draft-comment-card)",
  );
  await expect(mountedCards).toHaveCount(3);
  const beforeOrder = await mountedCards.evaluateAll(
    (nodes) => nodes.map((node) => node.getAttribute("data-comment-measure")),
  );
  await cards[1].hover();
  const secondBefore = await cards[1].boundingBox();
  const thirdBefore = await cards[2].boundingBox();
  await cards[1].hover();
  await expect(cards[1].getByRole("button", { name: "编辑评论" })).toBeVisible();
  const secondAfter = await cards[1].boundingBox();
  const thirdAfter = await cards[2].boundingBox();
  expect(secondBefore).not.toBeNull();
  expect(secondAfter).not.toBeNull();
  expect(thirdBefore).not.toBeNull();
  expect(thirdAfter).not.toBeNull();
  expect(Math.abs(secondAfter.height - secondBefore.height)).toBeLessThanOrEqual(1);
  expect(Math.abs(thirdAfter.y - thirdBefore.y)).toBeLessThanOrEqual(1);

  await cards[2].click();
  await expect(cards[2]).toHaveAttribute("data-focused", "true");
  await expect(frame.locator(caseSelector("indexed-comment-two")))
    .toHaveAttribute("data-html-canvas-selected", "part");
  await expect.poll(async () => {
    const [targetBox, cardBox] = await Promise.all([
      frame.locator(caseSelector("indexed-comment-two")).boundingBox(),
      cards[2].boundingBox(),
    ]);
    if (!targetBox || !cardBox) return Number.MAX_SAFE_INTEGER;
    return Math.abs(Math.round(cardBox.y - targetBox.y));
  }).toBeLessThanOrEqual(3);
  const focusedStyle = await cards[2].evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      backgroundColor: style.backgroundColor,
      borderColor: style.borderTopColor,
      shadow: style.boxShadow,
    };
  });
  expect(focusedStyle).toEqual({
    backgroundColor: "rgb(255, 255, 255)",
    borderColor: "rgba(13, 13, 13, 0.1)",
    shadow: "rgb(90, 85, 223) 2px 0px 0px 0px inset",
  });
  await page.screenshot({
    path: testInfo.outputPath("comment-queue-selected-aligned.png"),
  });
  const afterOrder = await mountedCards.evaluateAll(
    (nodes) => nodes.map((node) => node.getAttribute("data-comment-measure")),
  );
  expect(afterOrder).toEqual(beforeOrder);

  const railContent = rail.locator(".comment-rail-content");
  const alignedOffset = await railContent.evaluate((element) => (
    Number.parseFloat(getComputedStyle(element).getPropertyValue(
      "--comment-rail-offset",
    ))
  ));
  expect(alignedOffset).toBeLessThan(-1);

  await stage.evaluate((element) => {
    element.scrollTop = 120;
  });
  await cards[2].dispatchEvent("wheel", { deltaY: -50 });
  await expect.poll(() => stage.evaluate((element) => element.scrollTop))
    .toBe(70);
  const offsetAfterPageScroll = await railContent.evaluate((element) => (
    Number.parseFloat(getComputedStyle(element).getPropertyValue(
      "--comment-rail-offset",
    ))
  ));
  expect(offsetAfterPageScroll).toBeCloseTo(alignedOffset, 1);

  await stage.evaluate((element) => {
    element.scrollTop = 0;
  });
  await cards[2].dispatchEvent("wheel", { deltaY: -50 });
  await expect.poll(() => railContent.evaluate((element) => (
    Number.parseFloat(getComputedStyle(element).getPropertyValue(
      "--comment-rail-offset",
    ))
  ))).toBeGreaterThan(alignedOffset);
});

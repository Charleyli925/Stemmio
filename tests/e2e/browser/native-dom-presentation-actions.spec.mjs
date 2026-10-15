import { expect, test } from "@playwright/test";

import {
  caseSelector,
  exportCurrentHtml,
  fixtureBuffer,
  identifiedHtmlBuffer,
  loadFixture,
} from "./stemmio-driver.mjs";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("edit mode reveals semantic source content without running authored actions or changing bytes", {
  tag: ["@gate-smoke","@smoke-editing"],
}, async ({
  page,
}) => {
  const original = identifiedHtmlBuffer(fixtureBuffer("presentation-actions.html"));
  const { editor, frame } = await loadFixture(
    page,
    "presentation-actions.html",
    { buffer: original, identifiedWorkingCopy: false },
  );
  const overviewPanel = frame.locator(caseSelector("overview-panel"));
  const detailsPanel = frame.locator(caseSelector("details-panel"));
  const detailsTab = frame.locator(caseSelector("details-tab"));

  await detailsTab.click();
  await expect(overviewPanel).toBeVisible();
  await expect(detailsPanel).toBeHidden();
  const tabAction = editor.getByRole("button", {
    name: "切换到此页签",
    exact: true,
  });
  await expect(tabAction).toBeVisible();
  await expect(tabAction).toHaveText("切换到此页签");
  await expect(tabAction).not.toContainText("⌥");
  await expect(tabAction).toHaveAttribute("title", /⌥/u);

  await detailsTab.dblclick();
  await expect(detailsTab).toHaveAttribute("contenteditable", "true");
  await expect(overviewPanel).toBeVisible();
  await expect(detailsPanel).toBeHidden();
  await page.keyboard.press("Escape");

  await detailsTab.click();
  await tabAction.click();
  await expect(overviewPanel).toBeHidden();
  await expect(detailsPanel).toBeVisible();
  const reviewStage = page.locator(".review-scroll-stage");
  const scrollTopAfterSwitch = await reviewStage.evaluate(
    (element) => element.scrollTop,
  );
  expect(scrollTopAfterSwitch).toBeGreaterThan(100);
  const currentTabAction = editor.getByRole("button", {
    name: "当前页签",
    exact: true,
  });
  await expect(currentTabAction).toBeVisible();
  await currentTabAction.click();
  await expect(currentTabAction).toBeFocused();
  await expect(detailsPanel).toBeVisible();

  const summary = frame.locator(caseSelector("native-summary"));
  const nativeDetails = frame.locator(caseSelector("native-details"));
  await summary.click();
  await expect(nativeDetails).not.toHaveAttribute("open", "");
  await editor.getByRole("button", {
    name: "展开内容",
    exact: true,
  }).click();
  await expect(nativeDetails).toHaveAttribute("open", "");

  await summary.dblclick({ modifiers: ["Alt"] });
  await expect(nativeDetails).not.toHaveAttribute("open", "");

  const disclosure = frame.locator(caseSelector("more-toggle"));
  const disclosureContent = frame.locator(caseSelector("more-content"));
  await disclosure.click({ modifiers: ["Alt"] });
  await expect(disclosure).toHaveAttribute("aria-expanded", "true");
  await expect(disclosureContent).toBeVisible();

  const beforeLinkUrl = page.url();
  await frame.locator(caseSelector("outside-link")).click({ modifiers: ["Alt"] });
  expect(page.url()).toBe(beforeLinkUrl);
  await expect(editor.getByRole("button", {
    name: /^(?:切换到此页签|当前页签|展开内容|收起内容)$/u,
  })).toHaveCount(0);

  expect(await frame.evaluate(() => ({
    authorAction: document.documentElement.dataset.authorAction ?? null,
    authorScriptRan: document.documentElement.dataset.authorScriptRan ?? null,
  }))).toEqual({
    authorAction: null,
    authorScriptRan: null,
  });
  expect((await exportCurrentHtml(page)).equals(original)).toBe(true);
});

test("explicit data-linked tabs switch from the edit toolbar without running scripts or changing bytes", async ({
  page,
}) => {
  const original = identifiedHtmlBuffer(fixtureBuffer("indexed-script-tabs.html"));
  const { editor, frame } = await loadFixture(
    page,
    "indexed-script-tabs.html",
    { buffer: original, identifiedWorkingCopy: false },
  );
  const firstPanel = frame.locator("#chart0");
  const secondPanel = frame.locator("#chart1");
  const secondTab = frame.locator(caseSelector("indexed-tab-two"));

  await expect(firstPanel).toBeVisible();
  await expect(secondPanel).toBeHidden();
  await secondTab.click();
  await expect(firstPanel).toBeVisible();
  await expect(secondPanel).toBeHidden();
  await editor.getByRole("button", { name: "切换到此页签" }).click();
  await expect(firstPanel).toBeHidden();
  await expect(secondPanel).toBeVisible();

  await frame.locator(caseSelector("indexed-tab-one")).click({ modifiers: ["Alt"] });
  await expect(firstPanel).toBeVisible();
  await expect(secondPanel).toBeHidden();

  expect(await frame.evaluate(() => ({
    authorAction: document.documentElement.dataset.authorAction ?? null,
    authorScriptRan: document.documentElement.dataset.authorScriptRan ?? null,
  }))).toEqual({
    authorAction: null,
    authorScriptRan: null,
  });
  expect((await exportCurrentHtml(page)).equals(original)).toBe(true);
});

test("constant-index onclick tabs switch from the edit toolbar without executing their handler", async ({
  page,
}) => {
  const original = identifiedHtmlBuffer(fixtureBuffer("onclick-indexed-tabs.html"));
  const { editor, frame } = await loadFixture(
    page,
    "onclick-indexed-tabs.html",
    { buffer: original, identifiedWorkingCopy: false },
  );
  const firstPanel = frame.locator("#chart0");
  const secondPanel = frame.locator("#chart1");
  const secondTab = frame.locator(caseSelector("onclick-indexed-tab-two"));
  const fourthTab = frame.locator(caseSelector("onclick-indexed-tab-four"));

  await expect(firstPanel).toBeVisible();
  await expect(secondPanel).toBeHidden();
  await secondTab.click();
  await expect(firstPanel).toBeVisible();
  await expect(secondPanel).toBeHidden();
  await editor.getByRole("button", { name: "切换到此页签" }).click();
  await expect(firstPanel).toBeHidden();
  await expect(secondPanel).toBeVisible();

  await fourthTab.click({ modifiers: ["Alt"] });
  await expect(firstPanel).toBeHidden();
  await expect(secondPanel).toBeHidden();
  await expect(frame.locator("#chart3")).toBeVisible();

  expect(await frame.evaluate(() => ({
    authorAction: document.documentElement.dataset.authorAction ?? null,
  }))).toEqual({ authorAction: null });
  expect((await exportCurrentHtml(page)).equals(original)).toBe(true);
});

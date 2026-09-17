import { expect, test } from "@playwright/test";

import {
  caseSelector,
  exportCurrentHtml,
  fixtureBuffer,
  identifiedHtmlBuffer,
  loadFixture,
  replaceEditableIslandTextByCase,
} from "./stemmio-driver.mjs";

async function activateAtLeadingText(page, frame, caseId) {
  const target = frame.locator(caseSelector(caseId));
  const point = await target.evaluate((element) => {
    const text = Array.from(element.childNodes).find(
      (node) => node.nodeType === Node.TEXT_NODE && (node.textContent || "").trim(),
    );
    if (!text) throw new Error("Fixture target has no leading text node.");
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, Math.min(1, text.textContent?.length || 0));
    const glyph = range.getBoundingClientRect();
    const targetRect = element.getBoundingClientRect();
    return {
      x: glyph.left - targetRect.left + Math.max(1, glyph.width / 2),
      y: glyph.top - targetRect.top + Math.max(1, glyph.height / 2),
    };
  });
  await target.dblclick({ position: point, force: true });
  await expect(target).toHaveAttribute("contenteditable", "true");
  await expect(page.locator(".toast.show")).toHaveCount(0);
  return target;
}

async function selectLeadingText(target) {
  await target.evaluate((element) => {
    const text = Array.from(element.childNodes).find(
      (node) => node.nodeType === Node.TEXT_NODE && (node.textContent || "").trim(),
    );
    if (!text) throw new Error("Fixture target has no leading text node.");
    const range = document.createRange();
    range.selectNodeContents(text);
    const selection = document.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
}

function replaceExactOnce(buffer, before, after) {
  const source = buffer.toString("utf8");
  const first = source.indexOf(before);
  expect(first).toBeGreaterThanOrEqual(0);
  expect(source.indexOf(before, first + before.length)).toBe(-1);
  return Buffer.from(
    source.slice(0, first) + after + source.slice(first + before.length),
    "utf8",
  );
}

async function selectElementText(element) {
  await element.evaluate((node) => {
    const range = document.createRange();
    range.selectNodeContents(node);
    const selection = document.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
}

async function directTextPoint(element, textSnippet) {
  return element.evaluate((node, snippet) => {
    const text = Array.from(node.childNodes).find(
      (child) => child.nodeType === Node.TEXT_NODE && child.textContent?.includes(snippet),
    );
    if (!text) throw new Error(`Fixture has no direct text matching ${snippet}.`);
    const start = text.textContent.indexOf(snippet);
    const range = document.createRange();
    range.setStart(text, start);
    range.setEnd(text, start + 1);
    const glyph = range.getBoundingClientRect();
    const parent = node.getBoundingClientRect();
    return {
      x: glyph.left - parent.left + Math.max(1, glyph.width / 2),
      y: glyph.top - parent.top + Math.max(1, glyph.height / 2),
    };
  }, textSnippet);
}

async function selectDirectText(element, snippet, startOffset = 0, length = snippet.length) {
  await element.evaluate((node, { snippet: textSnippet, startOffset: start, length: count }) => {
    const text = Array.from(node.childNodes).find(
      (child) => child.nodeType === Node.TEXT_NODE && child.textContent?.includes(textSnippet),
    );
    if (!(text instanceof Text)) throw new Error(`Fixture has no direct text matching ${textSnippet}.`);
    const base = text.data.indexOf(textSnippet);
    const rangeStart = base + start;
    const rangeEnd = rangeStart + count;
    if (rangeStart < 0 || rangeEnd < rangeStart || rangeEnd > text.data.length) {
      throw new RangeError(`Selection ${rangeStart}:${rangeEnd} exceeds ${text.data}.`);
    }
    node.focus({ preventScroll: true });
    const range = document.createRange();
    range.setStart(text, rangeStart);
    range.setEnd(text, rangeEnd);
    const selection = document.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }, { snippet, startOffset, length });
}

test("nested list headings and wbr text edit without changing their authored structure", async ({
  page,
}) => {
  await page.goto("/");
  const source = identifiedHtmlBuffer(fixtureBuffer("structural-text.html"));
  const { frame } = await loadFixture(page, "structural-text.html", {
    buffer: source,
    identifiedWorkingCopy: false,
  });

  const nested = await activateAtLeadingText(page, frame, "nested-list-title");
  await expect(nested.locator(":scope > ul")).toHaveAttribute(
    "contenteditable",
    "false",
  );
  await selectLeadingText(nested);
  await page.keyboard.type("发现与验证阶段");
  await expect(nested).toContainText("发现与验证阶段");
  await expect(nested.locator(":scope > ul")).toContainText("访谈 12 位内容创作者");
  await page.keyboard.press("Escape");
  await expect(nested).not.toHaveAttribute("contenteditable", "true");

  const nestedExpected = replaceEditableIslandTextByCase(
    source,
    "nested-list-title",
    "发现阶段",
    "发现与验证阶段",
  );
  expect((await exportCurrentHtml(page)).equals(nestedExpected)).toBe(true);

  const wbr = await activateAtLeadingText(page, frame, "wbr-text");
  await wbr.evaluate((element) => {
    const textNodes = Array.from(element.childNodes).filter(
      (node) => node.nodeType === Node.TEXT_NODE,
    );
    const first = textNodes[0];
    if (!first) throw new Error("Fixture wbr target has no leading text.");
    const range = document.createRange();
    range.setStart(first, first.textContent?.length || 0);
    range.collapse(true);
    const selection = document.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
  await page.keyboard.type("ual");
  await expect(wbr).toContainText("HypertextualMarkupLanguage");
  await expect(wbr.locator("wbr")).toHaveCount(2);
  await page.keyboard.press("Escape");
  await expect(wbr).not.toHaveAttribute("contenteditable", "true");

  const expected = replaceEditableIslandTextByCase(
    nestedExpected,
    "wbr-text",
    "Hypertext",
    "Hypertextual",
  );
  expect((await exportCurrentHtml(page)).equals(expected)).toBe(true);
});

test("toolbar and Enter keep a multi-host structural target selected while glyph entry stays exact", async ({
  page,
}) => {
  await page.goto("/");
  const source = identifiedHtmlBuffer(fixtureBuffer("structural-text.html"));
  const { editor, frame } = await loadFixture(page, "structural-text.html", {
    buffer: source,
    identifiedWorkingCopy: false,
  });
  const nested = frame.locator(caseSelector("nested-list-title"));
  const leadingPoint = await directTextPoint(nested, "发现阶段");

  await nested.click({ position: leadingPoint, force: true });
  await expect(nested).toHaveAttribute("data-html-canvas-selected", /.+/u);
  await editor.getByRole("button", { name: "编辑", exact: true }).click();
  await expect(nested).not.toHaveAttribute("contenteditable", "true");
  await expect(frame.locator('[contenteditable="true"]')).toHaveCount(0);
  await expect(editor).toHaveAttribute("data-native-start-status", "no-unique-host");
  await expect(page.locator(".toast.show")).toHaveCount(0);

  await nested.click({ position: leadingPoint, force: true });
  await page.keyboard.press("Enter");
  await expect(nested).not.toHaveAttribute("contenteditable", "true");
  await expect(frame.locator('[contenteditable="true"]')).toHaveCount(0);
  await expect(editor).toHaveAttribute("data-native-start-status", "no-unique-host");
  await expect(nested).toHaveAttribute("data-html-canvas-selected", /.+/u);

  await nested.dblclick({ position: leadingPoint, force: true });
  await expect(nested).toHaveAttribute("contenteditable", "true");
  await expect(nested.locator(":scope > ul")).toHaveAttribute(
    "contenteditable",
    "false",
  );
  await expect(frame.locator('[contenteditable="true"]')).toHaveCount(1);
});

test("mixed block parents edit as one frozen-subtree island", {
  tag: ["@gate-smoke","@smoke-editing"],
}, async ({
  page,
}) => {
  await page.goto("/");
  const source = identifiedHtmlBuffer(fixtureBuffer("structural-text.html"));
  const { frame } = await loadFixture(page, "structural-text.html", {
    buffer: source,
    identifiedWorkingCopy: false,
  });
  const mixedParent = frame.locator(caseSelector("mixed-parent"));
  const mixedInline = frame.locator(caseSelector("mixed-inline"));
  const frozenChart = mixedParent.locator(':scope > div[data-keep="chart"]');

  await mixedInline.dblclick({ force: true });
  await expect(mixedParent).toHaveAttribute("contenteditable", "true");
  await expect(mixedInline).not.toHaveAttribute("contenteditable", "true");
  await expect(frozenChart).toHaveAttribute("contenteditable", "false");
  expect(await mixedParent.evaluate(() => document.getSelection()?.isCollapsed)).toBe(true);
  await selectElementText(mixedInline);
  await page.keyboard.type("强化文字");
  await page.keyboard.press("Escape");
  let expected = replaceExactOnce(
    source,
    ">强调文字</b>",
    ">强化文字</b>",
  );
  expect((await exportCurrentHtml(page)).equals(expected)).toBe(true);

  const bareTextPoint = await directTextPoint(mixedParent, "裸文本");
  await mixedParent.dblclick({ position: bareTextPoint, force: true });
  await expect(mixedParent).toHaveAttribute("contenteditable", "true");
  await expect(frozenChart).toHaveAttribute("contenteditable", "false");
  expect(await mixedParent.evaluate(() => document.getSelection()?.isCollapsed)).toBe(true);
  await selectDirectText(mixedParent, "，裸文本");
  await page.keyboard.type("，新版裸文本");
  await expect(mixedParent).toContainText("，新版裸文本");
  await mixedParent.evaluate((element) => {
    const text = Array.from(element.childNodes).find(
      (child) => child.nodeType === Node.TEXT_NODE && child.textContent?.includes("，新版裸文本"),
    );
    if (!(text instanceof Text)) throw new Error("Island has no edited text node.");
    element.focus({ preventScroll: true });
    const selection = document.getSelection();
    const range = document.createRange();
    range.setStart(text, text.data.length);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
    element.dispatchEvent(new CompositionEvent("compositionstart", {
      bubbles: true,
      data: "",
    }));
    text.data += "你";
    element.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      data: "你",
      inputType: "insertCompositionText",
      isComposing: true,
    }));
    element.dispatchEvent(new CompositionEvent("compositionend", {
      bubbles: true,
      data: "你",
    }));
  });
  await expect(mixedParent).toContainText("，新版裸文本你");
  await page.keyboard.press("Meta+s");
  await expect(mixedParent).toHaveAttribute("contenteditable", "true");
  expected = replaceExactOnce(expected, "，裸文本", "，新版裸文本你");
  expect((await exportCurrentHtml(page)).equals(expected)).toBe(true);
  await expect(frozenChart).toHaveText("图表结构保持");
  await expect(mixedParent.locator(':scope > span[data-keep="tail"]')).toHaveText("尾注");

  const ordinary = frame.locator(caseSelector("ordinary-inline"));
  const ordinaryChild = frame.locator(caseSelector("ordinary-inline-child"));
  await ordinaryChild.dblclick({ force: true });
  await expect(ordinary).toHaveAttribute("contenteditable", "true");
  await expect(ordinaryChild).not.toHaveAttribute("contenteditable", "true");
  await selectElementText(ordinaryChild);
  await page.keyboard.type("继续安全");
  await page.keyboard.press("Escape");
  expected = replaceExactOnce(
    expected,
    ">安全</strong>",
    ">继续安全</strong>",
  );
  expect((await exportCurrentHtml(page)).equals(expected)).toBe(true);
});

test("mixed island formatting wraps selected sibling text without leaving the host", {
  tag: ["@gate-smoke","@smoke-editing"],
}, async ({
  page,
}) => {
  await page.goto("/");
  const source = identifiedHtmlBuffer(fixtureBuffer("structural-text.html"));
  const { frame } = await loadFixture(page, "structural-text.html", {
    buffer: source,
    identifiedWorkingCopy: false,
  });
  const mixedParent = frame.locator(caseSelector("mixed-parent"));
  const initialDocument = await frame.evaluate(() => {
    const key = "__STEMMIO_FORMAT_DOCUMENT_TOKEN__";
    window[key] ||= crypto.randomUUID();
    return window[key];
  });

  await mixedParent.dblclick({
    position: await directTextPoint(mixedParent, "裸文本"),
    force: true,
  });
  await expect(mixedParent).toHaveAttribute("contenteditable", "true");
  await selectDirectText(mixedParent, "，裸文本", 1, 1);
  const boldButton = page.getByRole("button", { name: "加粗", exact: true });
  await expect(boldButton).toBeEnabled();
  await boldButton.click();
  await expect.poll(async () => ({
    startStatus: await page.getByTestId("html-canvas-editor")
      .getAttribute("data-native-start-status"),
    blockedDetail: await page.getByTestId("html-canvas-editor")
      .getAttribute("data-edit-block-detail"),
    candidateId: await page.getByTestId("html-canvas-editor")
      .getAttribute("data-runtime-candidate-id"),
    editingTags: await mixedParent.evaluate((element) => (
      element.getAttribute("contenteditable") === "true" ? [element.tagName] : []
    )),
  })).toEqual({
    startStatus: "started",
    blockedDetail: null,
    candidateId: null,
    editingTags: ["DIV"],
  });
  await expect(mixedParent).toHaveAttribute("contenteditable", "true");
  await expect.poll(() => mixedParent.evaluate((element) => (
    element.ownerDocument.activeElement === element
  ))).toBe(true);
  expect(await frame.evaluate(() => window.__STEMMIO_FORMAT_DOCUMENT_TOKEN__))
    .toBe(initialDocument);

  let expected = replaceExactOnce(
    source,
    "，裸文本<span",
    '，<span style="all: unset; display: inline !important; font-weight: 700">裸</span>文本<span',
  );
  await expect.poll(async () => (
    (await exportCurrentHtml(page)).toString("utf8").replace(
      / data-stemmio-id="sm1_[a-f0-9]{32}"/gu,
      "",
    )
  )).toBe(expected.toString("utf8").replace(
    / data-stemmio-id="sm1_[a-f0-9]{32}"/gu,
    "",
  ));
  await expect(page.locator(".toast.show")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(mixedParent).not.toHaveAttribute("contenteditable", "true");

  await mixedParent.dblclick({
    position: await directTextPoint(mixedParent, "文本"),
    force: true,
  });
  await expect(mixedParent).toHaveAttribute("contenteditable", "true");
  await selectDirectText(mixedParent, "文本", 0, 2);
  await page.keyboard.press("Meta+i");
  await expect(mixedParent).toHaveAttribute("contenteditable", "true");
  await expect.poll(() => mixedParent.evaluate((element) => (
    element.ownerDocument.activeElement === element
  ))).toBe(true);
  expect(await frame.evaluate(() => window.__STEMMIO_FORMAT_DOCUMENT_TOKEN__))
    .toBe(initialDocument);

  expected = replaceExactOnce(
    expected,
    "</span>文本<span",
    '</span><span style="all: unset; display: inline !important; font-style: italic">文本</span><span',
  );
  await expect.poll(async () => (
    (await exportCurrentHtml(page)).toString("utf8").replace(
      / data-stemmio-id="sm1_[a-f0-9]{32}"/gu,
      "",
    )
  )).toBe(expected.toString("utf8").replace(
    / data-stemmio-id="sm1_[a-f0-9]{32}"/gu,
    "",
  ));
  await expect(page.locator(".toast.show")).toHaveCount(0);
  await expect(mixedParent.locator(':scope > div[data-keep="chart"]')).toHaveText(
    "图表结构保持",
  );
  await expect(mixedParent.locator(':scope > span[data-keep="tail"]')).toHaveText("尾注");
});

test("deleting sibling bare text keeps the mixed island session open", {
  tag: ["@gate-smoke","@smoke-editing"],
}, async ({
  page,
}) => {
  await page.goto("/");
  const source = identifiedHtmlBuffer(fixtureBuffer("structural-text.html"));
  const { editor, frame } = await loadFixture(page, "structural-text.html", {
    buffer: source,
    identifiedWorkingCopy: false,
  });
  const mixedParent = frame.locator(caseSelector("mixed-parent"));

  await mixedParent.dblclick({
    position: await directTextPoint(mixedParent, "裸文本"),
    force: true,
  });
  await expect(mixedParent).toHaveAttribute("contenteditable", "true");
  await selectDirectText(mixedParent, "，裸文本");
  await page.keyboard.press("Backspace");

  const expected = replaceExactOnce(
    source,
    "，裸文本<span",
    "<span",
  );
  await expect(mixedParent).toHaveAttribute("contenteditable", "true");
  await expect.poll(() => editor.getAttribute("data-edit-block-detail")).toBeNull();
  await expect(editor).toHaveAttribute("data-render-verified", "true");
  await expect.poll(async () => (
    (await exportCurrentHtml(page)).equals(expected)
  )).toBe(true);
  await expect(page.locator(".toast.show")).toHaveCount(0);
  await expect(mixedParent.locator(':scope > div[data-keep="chart"]')).toHaveText(
    "图表结构保持",
  );
  await expect(mixedParent.locator(':scope > b[data-native-case="mixed-inline"]')).toHaveText(
    "强调文字",
  );
  await expect(mixedParent.locator(':scope > span[data-keep="tail"]')).toHaveText("尾注");
});

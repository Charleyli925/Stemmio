import { expect, test } from "@playwright/test";

import {
  activateNativeEdit,
  editableIslandInnerHtml,
  exportCurrentHtml,
  identifiedHtmlBuffer,
  loadFixture,
  replaceEditableIslandBytes,
  selectionSnapshot,
  setTextSelection,
} from "./stemmio-driver.mjs";

const source = Buffer.from(`<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <style>
    body { font: 20px/1.6 sans-serif; padding: 32px; }
    .vertical {
      writing-mode: vertical-rl;
      inline-size: 8em;
      block-size: 2em;
    }
  </style>
</head>
<body>
  <p data-native-case="plain">普通段落末尾</p>
  <p data-native-case="mixed">左<strong style="color:#c43">粗体</strong>右</p>
  <h2 data-native-case="heading">模块排序</h2>
  <a data-native-case="link" href="#safe">开始试览</a>
  <button data-native-case="button" type="button">打开原生测试</button>
  <ul><li data-native-case="list">列表项目</li></ul>
  <table><tbody><tr><td data-native-case="cell">表格单元格</td></tr></tbody></table>
  <p data-native-case="atom">图标前<svg viewBox="0 0 10 10" aria-label="圆点"><circle cx="5" cy="5" r="4"></circle></svg>图标后</p>
  <pre data-native-case="pre"><code>const value = 1;</code></pre>
  <p class="vertical" data-native-case="vertical">Vertical 竖排文字</p>
  <p data-native-case="comment">甲<!-- authored boundary -->乙</p>
</body>
</html>
`, "utf8");

const identifiedSource = identifiedHtmlBuffer(source);

const editableCases = [
  { id: "plain", text: "普通段落末尾", innerHtml: "普通段落末尾" },
  {
    id: "mixed",
    text: "左粗体右",
    innerHtml: '左<strong style="color:#c43">粗体</strong>右',
  },
  { id: "heading", text: "模块排序", innerHtml: "模块排序" },
  { id: "link", text: "开始试览", innerHtml: "开始试览" },
  { id: "button", text: "打开原生测试", innerHtml: "打开原生测试" },
  { id: "list", text: "列表项目", innerHtml: "列表项目" },
  { id: "cell", text: "表格单元格", innerHtml: "表格单元格" },
  {
    id: "atom",
    text: "图标前图标后",
    innerHtml: '图标前<svg viewBox="0 0 10 10" aria-label="圆点"><circle cx="5" cy="5" r="4"></circle></svg>图标后',
  },
  { id: "pre", text: "const value = 1;", innerHtml: "<code>const value = 1;</code>" },
  {
    id: "vertical",
    text: "Vertical 竖排文字",
    innerHtml: "Vertical 竖排文字",
  },
  {
    id: "comment",
    text: "甲乙",
    innerHtml: "甲<!-- authored boundary -->乙",
  },
];

async function openFixture(page) {
  await page.goto("/");
  return loadFixture(page, "stemmio-v2-editable-island.html", {
    buffer: identifiedSource,
    identifiedWorkingCopy: false,
  });
}

async function authoredInnerHtml(target) {
  return target.evaluate((element) => {
    const clone = element.cloneNode(true);
    if (!(clone instanceof HTMLElement)) throw new Error("Expected HTMLElement.");
    const attributes = [
      "contenteditable",
      "data-stemmio-id",
      "data-stemmio-edit-runtime-source",
      "data-html-ai-source-node-id",
    ];
    for (const node of [clone, ...clone.querySelectorAll("*")]) {
      for (const attribute of attributes) node.removeAttribute(attribute);
    }
    return clone.innerHTML;
  });
}

async function firstGlyphPoint(target) {
  return target.evaluate((element) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      const text = node.textContent ?? "";
      const index = text.search(/\S/u);
      if (index >= 0) {
        const range = document.createRange();
        range.setStart(node, index);
        range.setEnd(node, index + 1);
        const glyph = range.getBoundingClientRect();
        const box = element.getBoundingClientRect();
        if (glyph.width > 0 && glyph.height > 0) {
          return {
            x: glyph.left - box.left + glyph.width / 2,
            y: glyph.top - box.top + glyph.height / 2,
          };
        }
      }
      node = walker.nextNode();
    }
    throw new Error("Fixture host has no rendered text glyph.");
  });
}

async function firstGlyphClientPoint(target) {
  return target.evaluate((element) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      const text = node.textContent ?? "";
      const index = text.search(/\S/u);
      if (index >= 0) {
        const range = document.createRange();
        range.setStart(node, index);
        range.setEnd(node, index + 1);
        const glyph = range.getBoundingClientRect();
        if (glyph.width > 0 && glyph.height > 0) {
          return {
            clientX: glyph.left + glyph.width / 2,
            clientY: glyph.top + glyph.height / 2,
          };
        }
      }
      node = walker.nextNode();
    }
    throw new Error("Fixture host has no rendered text glyph.");
  });
}

test("V2 editable-island census activates every safe HTML text host", async ({ page }) => {
  const { frame } = await openFixture(page);
  for (const fixtureCase of editableCases) {
    await test.step(fixtureCase.id, async () => {
      const target = await activateNativeEdit(frame, fixtureCase.id);
      await expect(target).toHaveAttribute("contenteditable", "true");
      await page.keyboard.press("Escape");
    });
  }
});

test("switching text hosts retires the old lease before the new host enters", async ({ page }) => {
  const { editor, frame } = await openFixture(page);
  const first = await activateNativeEdit(frame, "plain");
  const second = frame.locator('[data-native-case="heading"]');
  await expect(first).toHaveAttribute("contenteditable", "true");

  await second.dispatchEvent("dblclick", {
    ...await firstGlyphClientPoint(second),
    bubbles: true,
    cancelable: true,
    detail: 2,
  });
  await expect(second).toHaveAttribute("contenteditable", "true");
  await expect(first).not.toHaveAttribute("contenteditable", "true");
  await expect(frame.locator('[contenteditable="true"]')).toHaveCount(1);
  await expect(second).toHaveAttribute("data-html-canvas-editing", "true");
  await expect(editor).toHaveAttribute("data-native-start-status", "started");
});

test("a comment marker commits uncheckpointed text before changing selection authority", async ({ page }) => {
  const { editor, frame } = await openFixture(page);
  const heading = frame.locator('[data-native-case="heading"]');
  await heading.click();
  await editor.getByRole("toolbar").getByRole("button", { name: /留评论/u }).click();
  const composer = page.getByRole("region", { name: "添加评论" });
  await composer.getByRole("textbox", { name: "评论内容" })
    .fill("标记模块排序。");
  await composer.getByRole("button", { name: "评论", exact: true }).click();
  const marker = editor.locator('button[title*="模块排序"]');
  await expect(marker).toBeVisible();

  const plain = await activateNativeEdit(frame, "plain");
  const firstToken = "__BEFORE_COMMENT_MARKER_SWITCH__";
  await setTextSelection(frame, "plain", "普通段落末尾".length);
  await page.keyboard.insertText(firstToken);
  await marker.click();

  await expect(frame.locator('[contenteditable="true"]')).toHaveCount(0);
  await expect(plain).not.toHaveAttribute("data-html-canvas-editing", /.+/u);
  await expect(heading).toHaveAttribute("data-html-canvas-selected", /.+/u);
  await expect.poll(async () => (
    await exportCurrentHtml(page)
  ).toString("utf8")).toContain(firstToken);

  const atom = frame.locator('[data-native-case="atom"] svg');
  await atom.dblclick();
  await expect(frame.locator(
    'svg [data-html-canvas-selected], svg[data-html-canvas-selected]',
  )).toHaveCount(1);
  await expect(frame.locator('[contenteditable="true"]')).toHaveCount(0);

  const next = await activateNativeEdit(frame, "heading");
  const secondToken = "__AFTER_COMMENT_MARKER_SWITCH__";
  await setTextSelection(frame, "heading", "模块排序".length);
  await page.keyboard.insertText(secondToken);
  await expect(next).toContainText(secondToken);
  await page.keyboard.press("Escape");
  await expect.poll(async () => (
    await exportCurrentHtml(page)
  ).toString("utf8")).toEqual(expect.stringContaining(firstToken));
  await expect.poll(async () => (
    await exportCurrentHtml(page)
  ).toString("utf8")).toEqual(expect.stringContaining(secondToken));
});

test("a host switch waits for composition and then re-resolves the target identity", async ({ page }) => {
  const { frame } = await openFixture(page);
  const first = await activateNativeEdit(frame, "plain");
  const second = frame.locator('[data-native-case="heading"]');
  await first.dispatchEvent("compositionstart", { data: "" });

  await second.dispatchEvent("dblclick", {
    ...await firstGlyphClientPoint(second),
    bubbles: true,
    cancelable: true,
    detail: 2,
  });
  await expect(first).toHaveAttribute("contenteditable", "true");
  await expect(second).not.toHaveAttribute("contenteditable", "true");

  await first.dispatchEvent("compositionend", { data: "" });
  await expect(second).toHaveAttribute("contenteditable", "true");
  await expect(first).not.toHaveAttribute("contenteditable", "true");
  await expect(frame.locator('[contenteditable="true"]')).toHaveCount(1);
});

test("double-clicking a frozen SVG commits the active text island before structural selection", async ({ page }) => {
  const { editor, frame } = await openFixture(page);
  const target = await activateNativeEdit(frame, "atom");
  const atom = target.locator("svg");
  const firstToken = "__BEFORE_FROZEN_ATOM__";
  const secondToken = "__AFTER_STRUCTURAL_SWITCH__";
  await setTextSelection(frame, "atom", "图标前图标后".length);
  await page.keyboard.insertText(firstToken);

  await atom.dblclick();
  await expect(target).not.toHaveAttribute("contenteditable", "true");
  const selectedAtom = frame.locator('svg [data-html-canvas-selected], svg[data-html-canvas-selected]');
  await expect(selectedAtom).toHaveCount(1);
  await expect(frame.locator('[contenteditable="true"]')).toHaveCount(0);
  await expect(editor.getByRole("button", { name: "编辑中", exact: true })).toHaveCount(0);
  await expect.poll(async () => (
    await exportCurrentHtml(page)
  ).toString("utf8")).toContain(firstToken);

  const next = await activateNativeEdit(frame, "heading");
  await expect(frame.locator('[contenteditable="true"]')).toHaveCount(1);
  await setTextSelection(frame, "heading", "模块排序".length);
  await page.keyboard.insertText(secondToken);
  await expect(next).toContainText(secondToken);
  await expect.poll(async () => (
    await exportCurrentHtml(page)
  ).toString("utf8")).toEqual(expect.stringContaining(firstToken));
  await expect.poll(async () => (
    await exportCurrentHtml(page)
  ).toString("utf8")).toEqual(expect.stringContaining(secondToken));
});

test("a frozen SVG structural switch waits for composition before resolving its current identity", async ({ page }) => {
  const { editor, frame } = await openFixture(page);
  const target = await activateNativeEdit(frame, "atom");
  const atom = target.locator("svg");
  const token = "__BEFORE_COMPOSED_STRUCTURAL_SWITCH__";
  await setTextSelection(frame, "atom", "图标前图标后".length);
  await page.keyboard.insertText(token);
  await target.dispatchEvent("compositionstart", { data: "" });
  const point = await atom.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
    };
  });
  await atom.dispatchEvent("dblclick", {
    ...point,
    bubbles: true,
    cancelable: true,
    detail: 2,
  });
  await expect(target).toHaveAttribute("contenteditable", "true");
  await expect(atom).not.toHaveAttribute("data-html-canvas-selected", /.+/u);
  await expect(frame.locator('[contenteditable="true"]')).toHaveCount(1);

  await target.dispatchEvent("compositionend", { data: "" });
  await expect(target).not.toHaveAttribute("contenteditable", "true");
  await expect(frame.locator(
    'svg [data-html-canvas-selected], svg[data-html-canvas-selected]',
  )).toHaveCount(1);
  await expect(frame.locator('[contenteditable="true"]')).toHaveCount(0);
  await expect(editor.getByRole("button", { name: "编辑中", exact: true })).toHaveCount(0);
  await expect.poll(async () => (
    await exportCurrentHtml(page)
  ).toString("utf8")).toContain(token);
});

test("failed focus establishment leaves no active marker and the next entry can succeed", async ({ page }) => {
  const { editor, frame } = await openFixture(page);
  const target = frame.locator('[data-native-case="plain"]');
  await target.evaluate((element) => {
    Object.defineProperty(element, "isContentEditable", {
      configurable: true,
      get: () => false,
    });
  });

  await target.dispatchEvent("dblclick", {
    ...await firstGlyphClientPoint(target),
    bubbles: true,
    cancelable: true,
    detail: 2,
  });
  await expect(target).not.toHaveAttribute("contenteditable", "true");
  await expect(target).not.toHaveAttribute("data-html-canvas-editing", /.+/u);
  await expect(target).not.toHaveAttribute("data-stemmio-editing", /.+/u);
  await expect(frame.locator('[contenteditable="true"]')).toHaveCount(0);
  await expect(editor.getByRole("button", { name: "编辑中", exact: true })).toHaveCount(0);

  await target.evaluate((element) => {
    delete element.isContentEditable;
  });
  await target.dblclick({ position: await firstGlyphPoint(target) });
  await expect(target).toHaveAttribute("contenteditable", "true");
  await expect(target).toHaveAttribute("data-html-canvas-editing", "true");
});

test("session and frozen-subtree attributes restore to each original DOM object", async ({ page }) => {
  const { frame } = await openFixture(page);
  const target = frame.locator('[data-native-case="atom"]');
  const atom = target.locator("svg");
  await target.evaluate((element) => {
    element.setAttribute("contenteditable", "inherit");
    element.setAttribute("spellcheck", "true");
    element.setAttribute("role", "note");
    element.setAttribute("aria-label", "原始说明");
    element.setAttribute("data-stemmio-editing", "authored-value");
    element.querySelector("svg")?.setAttribute("contenteditable", "plaintext-only");
  });

  await target.dblclick({ position: await firstGlyphPoint(target) });
  await expect(target).toHaveAttribute("contenteditable", "true");
  await expect(atom).toHaveAttribute("contenteditable", "false");
  await atom.evaluate((element) => {
    element.ownerDocument.defaultView.__stemmioFrozenAtomBeforeRestore = element;
  });
  for (let index = 0; index < 6; index += 1) {
    await target.dispatchEvent("compositionstart", { data: "" });
    await target.dispatchEvent("compositionend", { data: "" });
  }
  await expect.poll(() => atom.evaluate((element) => (
    element !== element.ownerDocument.defaultView.__stemmioFrozenAtomBeforeRestore
  ))).toBe(true);
  await target.evaluate((element) => {
    const view = element.ownerDocument.defaultView;
    const prototype = view.Element.prototype;
    const originalSetAttribute = prototype.setAttribute;
    const counts = { connected: 0, disconnected: 0 };
    prototype.setAttribute = function setAttribute(name, value) {
      if (
        this.localName === "svg"
        && name === "contenteditable"
        && value === "plaintext-only"
      ) {
        counts[this.isConnected ? "connected" : "disconnected"] += 1;
      }
      return originalSetAttribute.call(this, name, value);
    };
    view.__stemmioFrozenRestoreProbe = {
      counts,
      restore: () => {
        prototype.setAttribute = originalSetAttribute;
      },
    };
  });
  await page.keyboard.press("Escape");

  await expect(target).toHaveAttribute("contenteditable", "inherit");
  await expect(target).toHaveAttribute("spellcheck", "true");
  await expect(target).toHaveAttribute("role", "note");
  await expect(target).toHaveAttribute("aria-label", "原始说明");
  await expect(target).toHaveAttribute("data-stemmio-editing", "authored-value");
  await expect(atom).toHaveAttribute("contenteditable", "plaintext-only");
  const restoreCounts = await target.evaluate((element) => {
    const probe = element.ownerDocument.defaultView.__stemmioFrozenRestoreProbe;
    probe.restore();
    delete element.ownerDocument.defaultView.__stemmioFrozenRestoreProbe;
    return probe.counts;
  });
  expect(restoreCounts).toEqual({ connected: 1, disconnected: 0 });
});

test("constructor failure restores temporary attributes and every installed listener", async ({ page }) => {
  const { editor, frame } = await openFixture(page);
  const target = frame.locator('[data-native-case="atom"]');
  const atom = target.locator("svg");
  await target.evaluate((element) => {
    element.setAttribute("contenteditable", "inherit");
    element.setAttribute("spellcheck", "true");
    element.setAttribute("role", "note");
    element.setAttribute("aria-label", "构造失败前");
    element.setAttribute("data-stemmio-editing", "authored-value");
    element.querySelector("svg")?.setAttribute("contenteditable", "plaintext-only");

    const view = element.ownerDocument.defaultView;
    const prototype = view.EventTarget.prototype;
    const originalAdd = prototype.addEventListener;
    const originalRemove = prototype.removeEventListener;
    const counts = {
      hostAdded: 0,
      hostRemoved: 0,
      documentAdded: 0,
      documentRemoved: 0,
    };
    prototype.addEventListener = function addEventListener(type, listener, options) {
      if (this === element) counts.hostAdded += 1;
      if (this === element.ownerDocument) counts.documentAdded += 1;
      return originalAdd.call(this, type, listener, options);
    };
    prototype.removeEventListener = function removeEventListener(type, listener, options) {
      if (this === element) counts.hostRemoved += 1;
      if (this === element.ownerDocument) counts.documentRemoved += 1;
      return originalRemove.call(this, type, listener, options);
    };
    view.__stemmioConstructorFailureListenerProbe = {
      counts,
      restore: () => {
        prototype.addEventListener = originalAdd;
        prototype.removeEventListener = originalRemove;
      },
    };
  });
  await page.evaluate(() => {
    const OriginalMutationObserver = window.MutationObserver;
    window.__stemmioOriginalMutationObserver = OriginalMutationObserver;
    window.MutationObserver = class ThrowingMutationObserver extends OriginalMutationObserver {
      observe(target, options) {
        if (target?.getAttribute?.("data-native-case") === "atom") {
          throw new Error("controlled constructor failure");
        }
        return super.observe(target, options);
      }
    };
  });

  try {
    await target.dblclick({ position: await firstGlyphPoint(target) });
    await expect(target).toHaveAttribute("contenteditable", "inherit");
    await expect(target).toHaveAttribute("spellcheck", "true");
    await expect(target).toHaveAttribute("role", "note");
    await expect(target).toHaveAttribute("aria-label", "构造失败前");
    await expect(target).toHaveAttribute("data-stemmio-editing", "authored-value");
    await expect(target).not.toHaveAttribute("data-html-canvas-editing", /.+/u);
    await expect(atom).toHaveAttribute("contenteditable", "plaintext-only");
    await expect(editor.getByRole("button", { name: "编辑中", exact: true })).toHaveCount(0);
    await expect.poll(() => target.evaluate((element) => (
      element.ownerDocument.defaultView.__stemmioConstructorFailureListenerProbe.counts
    ))).toEqual({
      hostAdded: 7,
      hostRemoved: 7,
      documentAdded: 1,
      documentRemoved: 1,
    });
  } finally {
    await page.evaluate(() => {
      window.MutationObserver = window.__stemmioOriginalMutationObserver;
      delete window.__stemmioOriginalMutationObserver;
    });
    await target.evaluate((element) => {
      element.ownerDocument.defaultView.__stemmioConstructorFailureListenerProbe.restore();
      delete element.ownerDocument.defaultView.__stemmioConstructorFailureListenerProbe;
    });
  }

  await target.dblclick({ position: await firstGlyphPoint(target) });
  await expect(target).toHaveAttribute("contenteditable", "true");
  await expect(target).toHaveAttribute("data-html-canvas-editing", "true");
  await page.keyboard.press("Escape");
  await expect(target).toHaveAttribute("contenteditable", "inherit");
  await expect(atom).toHaveAttribute("contenteditable", "plaintext-only");
});

test("start, middle and end all support insert, delete and line break", async ({ page }) => {
  for (const fixtureCase of editableCases) {
    await test.step(fixtureCase.id, async () => {
      const { editor, frame } = await openFixture(page);
      const target = await activateNativeEdit(frame, fixtureCase.id);
      const positions = [
        0,
        Math.floor(fixtureCase.text.length / 2),
        fixtureCase.text.length,
      ];
      for (const [index, position] of positions.entries()) {
        const marker = `测${index}`;
        await setTextSelection(frame, fixtureCase.id, position);
        await expect(target).toHaveAttribute("contenteditable", "true");
        await page.keyboard.insertText(marker);
        await expect(target).toContainText(marker);
        await page.keyboard.press("Backspace");
        await page.keyboard.press("Backspace");
        expect(
          await editor.getAttribute("data-edit-block-detail"),
          `${fixtureCase.id}:position:${position}`,
        ).toBeNull();
      }

      await setTextSelection(
        frame,
        fixtureCase.id,
        fixtureCase.text.length,
      );
      await page.keyboard.press("Enter");
      await expect.poll(() => authoredInnerHtml(target)).toContain("<br>");
      // Enter checkpoints and exits the native session by default. Re-enter
      // explicitly before the next edit instead of relying on an implicit
      // resume from the preceding checkpoint.
      await activateNativeEdit(frame, fixtureCase.id);
      await target.evaluate((element) => {
        const range = element.ownerDocument.createRange();
        range.setStart(element, element.childNodes.length);
        range.collapse(true);
        const selection = element.ownerDocument.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        element.focus({ preventScroll: true });
      });
      await page.keyboard.press("Backspace");
      expect(
        await editor.getAttribute("data-edit-block-detail"),
        `${fixtureCase.id}:line-break`,
      ).toBeNull();

      await setTextSelection(
        frame,
        fixtureCase.id,
        fixtureCase.text.length,
      );
      await page.keyboard.press("Backspace");

      expect(await editor.getAttribute("data-edit-block-detail")).toBeNull();
      const lastCharacter = fixtureCase.text.at(-1);
      const beforeInnerHtml = editableIslandInnerHtml(identifiedSource, fixtureCase.id);
      const lastCharacterIndex = beforeInnerHtml.lastIndexOf(lastCharacter);
      const expectedInnerHtml = beforeInnerHtml.slice(0, lastCharacterIndex)
        + beforeInnerHtml.slice(lastCharacterIndex + lastCharacter.length);
      expect((await exportCurrentHtml(page)).toString("utf8")).toBe(
        replaceEditableIslandBytes(
          identifiedSource,
          fixtureCase.id,
          expectedInnerHtml,
        ).toString("utf8"),
      );
    });
  }
});

test("double-clicking an authored blank line restores its caret without granting host padding", async ({ page }) => {
  const { frame } = await openFixture(page);
  const target = await activateNativeEdit(frame, "plain");
  await setTextSelection(frame, "plain", "普通段落末尾".length);
  await target.press("Enter");
  await expect(target.locator(":scope > br")).toHaveCount(1);
  await activateNativeEdit(frame, "plain");
  await target.evaluate((element) => {
    const range = element.ownerDocument.createRange();
    range.setStart(element, element.childNodes.length);
    range.collapse(true);
    const selection = element.ownerDocument.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
  await target.press("Enter");
  await expect(target.locator(":scope > br")).toHaveCount(2);
  if (await target.getAttribute("contenteditable")) await page.keyboard.press("Escape");
  await expect(target).not.toHaveAttribute("contenteditable", /^(?:true|plaintext-only)$/u);

  const blankLinePoint = await target.evaluate((element) => {
    const lineBreak = element.querySelectorAll(":scope > br")[1];
    if (!(lineBreak instanceof HTMLBRElement)) throw new Error("Authored blank line is missing.");
    const range = document.createRange();
    range.setStartBefore(lineBreak);
    range.setEndAfter(lineBreak);
    const caret = range.getBoundingClientRect();
    const host = element.getBoundingClientRect();
    return {
      x: caret.width >= 1 ? caret.left - host.left + Math.max(4, caret.width / 2) : 8,
      y: caret.height >= 1 ? caret.top - host.top + Math.max(2, caret.height / 2) : host.height - 8,
    };
  });
  await target.dblclick({ position: blankLinePoint });
  await expect(target).toHaveAttribute("contenteditable", /^(?:true|plaintext-only)$/u);
  await page.keyboard.insertText("BLANK_LINE_MARKER");
  await expect.poll(() => authoredInnerHtml(target)).toContain(
    "<br>BLANK_LINE_MARKER<br>",
  );
  await page.keyboard.press("Escape");

  const paddingPoint = await target.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const lineHeight = Number.parseFloat(getComputedStyle(element).lineHeight) || 24;
    return { x: Math.max(1, rect.width - 8), y: Math.min(rect.height - 1, lineHeight / 2) };
  });
  await target.dblclick({ position: paddingPoint });
  await expect(target).not.toHaveAttribute("contenteditable", /^(?:true|plaintext-only)$/u);
});

test("paste is plain text, multiline paste becomes br, and cut stays local", async ({ page }) => {
  const { frame } = await openFixture(page);
  const target = await activateNativeEdit(frame, "plain");
  await setTextSelection(frame, "plain", 0, "普通段落".length);

  await target.evaluate((element) => {
    const clipboard = new DataTransfer();
    clipboard.setData("text/plain", "第一行\n第二行");
    clipboard.setData("text/html", "<img src=x onerror=alert(1)><b>不应保留</b>");
    element.dispatchEvent(new ClipboardEvent("paste", {
      bubbles: true,
      cancelable: true,
      clipboardData: clipboard,
    }));
  });

  expect(await authoredInnerHtml(target)).toBe("第一行<br>第二行末尾");
  await setTextSelection(frame, "plain", 0, "第一行".length);
  await page.keyboard.press(process.platform === "darwin" ? "Meta+x" : "Control+x");
  await expect(target).toHaveText("第二行末尾");
  expect(await target.locator("img, b").count()).toBe(0);
});

test("pre-activation runtime DOM drift never enters the source-backed island draft", async ({ page }) => {
  const { frame } = await openFixture(page);
  const previewTarget = frame.locator('[data-native-case="plain"]');
  await previewTarget.evaluate((element) => {
    const wrapper = element.ownerDocument.createElement("span");
    wrapper.className = "runtime-only";
    wrapper.style.color = "rgb(255, 0, 0)";
    wrapper.textContent = element.textContent;
    element.replaceChildren(wrapper);
  });

  const target = await activateNativeEdit(frame, "plain");
  await expect(target.locator(".runtime-only")).toHaveCount(0);
  await setTextSelection(frame, "plain", "普通段落末尾".length);
  await page.keyboard.insertText("新增");

  const expected = replaceEditableIslandBytes(
    identifiedSource,
    "plain",
    "普通段落末尾新增",
  ).toString("utf8");
  await expect.poll(async () => (
    await exportCurrentHtml(page)
  ).toString("utf8")).toBe(expected);
});

test("unsupported browser rich input never gains island commit authority", async ({ page }) => {
  const { frame } = await openFixture(page);
  const target = await activateNativeEdit(frame, "plain");
  const delivery = await target.evaluate((element) => {
    const event = new InputEvent("beforeinput", {
      bubbles: true,
      cancelable: true,
      data: "不应写入",
      inputType: "insertFromDrop",
    });
    return {
      dispatchResult: element.dispatchEvent(event),
      defaultPrevented: event.defaultPrevented,
    };
  });

  expect(delivery).toEqual({
    dispatchResult: false,
    defaultPrevented: true,
  });
  expect(await authoredInnerHtml(target)).toBe("普通段落末尾");
  expect((await exportCurrentHtml(page)).toString("utf8")).toBe(
    identifiedSource.toString("utf8"),
  );
});

test("formatting refuses selections that cross immutable atoms or comments", async ({ page }) => {
  for (const fixtureCase of editableCases.filter(({ id }) => (
    id === "atom" || id === "comment"
  ))) {
    await test.step(fixtureCase.id, async () => {
      const { editor, frame } = await openFixture(page);
      const target = await activateNativeEdit(frame, fixtureCase.id);
      await setTextSelection(
        frame,
        fixtureCase.id,
        0,
        fixtureCase.text.length,
      );
      const boldButton = page.getByRole("button", { name: "加粗", exact: true });
      if (fixtureCase.id === "atom") {
        // The source projection rejects structural atoms before a formatting
        // command can be created, so the toolbar must remain unavailable.
        await expect(boldButton).toBeDisabled();
      } else {
        // Comments are intentionally absent from the logical text map. The
        // controller therefore owns the final immutable-structure check.
        await expect(boldButton).toBeEnabled();
        await boldButton.click();
        await expect.poll(
          () => editor.getAttribute("data-edit-block-detail"),
        ).toContain("当前选区无法安全应用这个文字格式");
      }

      expect(await authoredInnerHtml(target)).toBe(fixtureCase.innerHtml);
      expect((await exportCurrentHtml(page)).toString("utf8")).toBe(
        identifiedSource.toString("utf8"),
      );
      await page.keyboard.press("Escape");
    });
  }
});

test("toolbar formatting, protected atoms, comments and link identity stay safe", async ({ page }) => {
  const { frame } = await openFixture(page);
  const mixed = await activateNativeEdit(frame, "mixed");
  await setTextSelection(frame, "mixed", 0, 1);
  await page.keyboard.press("Meta+b");
  await expect.poll(() => authoredInnerHtml(mixed)).toMatch(/font-weight:\s*700/u);

  const atom = await activateNativeEdit(frame, "atom");
  await setTextSelection(frame, "atom", "图标前".length);
  await page.keyboard.insertText("新增");
  expect(await atom.locator("svg[viewBox='0 0 10 10'] circle").count()).toBe(1);

  const comment = await activateNativeEdit(frame, "comment");
  await setTextSelection(frame, "comment", 1);
  await page.keyboard.insertText("新增");
  expect(await authoredInnerHtml(comment)).toContain(
    "<!-- authored boundary -->",
  );

  const link = await activateNativeEdit(frame, "link");
  await setTextSelection(frame, "link", "开始试览".length);
  await page.keyboard.insertText("V2");
  await expect(link).toHaveAttribute("href", "#safe");
});

test("toolbar formatting restores one logical range across button and input focus", async ({ page }) => {
  const { editor, frame } = await openFixture(page);
  const target = await activateNativeEdit(frame, "plain");
  await setTextSelection(frame, "plain", 0, 2);
  const before = await selectionSnapshot(frame, "plain");
  expect(before.text).toBe("普通");

  const toolbar = editor.getByRole("toolbar");
  const bold = toolbar.getByRole("button", { name: "加粗", exact: true });
  await expect(bold).toBeEnabled();
  const boldBox = await bold.boundingBox();
  if (!boldBox) throw new Error("Bold toolbar button is not measurable.");
  await page.mouse.move(
    boldBox.x + boldBox.width / 2,
    boldBox.y + boldBox.height / 2,
  );
  await page.mouse.down();
  await frame.evaluate(() => {
    const target = document.querySelector('[data-native-case="plain"][contenteditable]');
    const text = target
      ? document.createTreeWalker(target, NodeFilter.SHOW_TEXT).nextNode()
      : null;
    if (!(text instanceof Text)) throw new Error("Plain text fixture is incomplete.");
    const selection = document.getSelection();
    const range = document.createRange();
    range.setStart(text, 1);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
  await page.mouse.up();
  await expect.poll(() => authoredInnerHtml(target)).toContain("font-weight: 700");
  expect((await selectionSnapshot(frame, "plain")).text).toBe("普通");

  await toolbar.getByText("样式与间距", { exact: true }).click();
  const fontSize = toolbar.getByLabel("字号（像素）");
  await fontSize.fill("28");
  await expect.poll(() => authoredInnerHtml(target)).toContain("font-size: 28px");
  expect((await selectionSnapshot(frame, "plain")).text).toBe("普通");
});

test("a collapsed iframe Selection still lets consecutive color commands continue editing", async ({ page }) => {
  const { editor, frame } = await openFixture(page);
  const target = await activateNativeEdit(frame, "plain");
  await setTextSelection(frame, "plain", 0, 2);
  const toolbar = editor.getByRole("toolbar");
  await toolbar.getByText("样式与间距", { exact: true }).click();
  const color = toolbar.getByLabel("文字颜色");
  await frame.evaluate(() => {
    const target = document.querySelector('[data-native-case="plain"][contenteditable]');
    const text = target
      ? document.createTreeWalker(target, NodeFilter.SHOW_TEXT).nextNode()
      : null;
    if (!(text instanceof Text)) throw new Error("Plain text fixture is incomplete.");
    const selection = document.getSelection();
    const range = document.createRange();
    range.setStart(text, 1);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
  const setColor = async (value) => color.evaluate((element, nextValue) => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    setter?.call(element, nextValue);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);

  await setColor("#123456");
  await expect.poll(() => authoredInnerHtml(target)).toContain("color: #123456");
  await frame.evaluate(() => {
    const editingHost = document.querySelector(
      '[data-native-case="plain"] [contenteditable], [data-native-case="plain"][contenteditable]',
    );
    const text = editingHost
      ? document.createTreeWalker(editingHost, NodeFilter.SHOW_TEXT).nextNode()
      : null;
    if (!(text instanceof Text)) throw new Error("Plain text fixture is incomplete.");
    const selection = document.getSelection();
    const range = document.createRange();
    range.setStart(text, 1);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
  await setColor("#654321");
  await expect.poll(() => authoredInnerHtml(target)).toContain("color: #654321");
  expect((await selectionSnapshot(frame, "plain")).text).toBe("普通");
});

test("a new host selection supersedes the retained toolbar range", async ({ page }) => {
  const { frame } = await openFixture(page);
  const target = await activateNativeEdit(frame, "plain");
  await setTextSelection(frame, "plain", 0, 2);

  const toolbar = page.getByTestId("html-canvas-editor")
    .filter({ visible: true })
    .first()
    .getByRole("toolbar");
  await toolbar.getByText("样式与间距", { exact: true }).click();
  await target.click({ position: { x: 8, y: 8 } });
  await setTextSelection(frame, "plain", 2, 4);
  await toolbar.getByText("样式与间距", { exact: true }).click();

  const color = toolbar.getByLabel("文字颜色");
  const setter = async (value) => color.evaluate((element, nextValue) => {
    const nativeSetter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    nativeSetter?.call(element, nextValue);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
  await setter("#123456");

  await expect.poll(() => authoredInnerHtml(target)).toContain(
    '<span style="all: unset; display: inline !important; color: #123456">段落</span>',
  );
  expect((await selectionSnapshot(frame, "plain")).text).toBe("段落");
});

test("IME confirmation replays at the frozen left-style caret", {
  tag: ["@gate-smoke","@smoke-editing"],
}, async ({ page }) => {
  const { frame } = await openFixture(page);
  const target = await activateNativeEdit(frame, "mixed");
  await target.evaluate((element) => {
    const strongText = element.querySelector("strong")?.firstChild;
    const trailingText = element.lastChild;
    if (!(strongText instanceof Text) || !(trailingText instanceof Text)) {
      throw new Error("Mixed-style fixture is incomplete.");
    }
    element.focus({ preventScroll: true });
    const selection = document.getSelection();
    const range = document.createRange();
    range.setStart(trailingText, 0);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
    element.dispatchEvent(new CompositionEvent("compositionstart", {
      bubbles: true,
      data: "",
    }));
    trailingText.data = `你${trailingText.data}`;
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

  expect(await authoredInnerHtml(target)).toBe(
    '左<strong style="color:#c43">粗体你</strong>右',
  );
});

test("out-of-band mutation restores the last safe draft without an edit-blocked notice", {
  tag: ["@gate-smoke", "@smoke-editing"],
}, async ({ page }) => {
  const { editor, frame } = await openFixture(page);
  const target = await activateNativeEdit(frame, "plain");
  await setTextSelection(frame, "plain", "普通".length);
  await page.keyboard.insertText("安全");
  await target.evaluate((element) => element.append("越权"));

  await expect(target).not.toContainText("越权");
  await expect(target).toContainText("安全");
  await expect.poll(() => editor.getAttribute("data-edit-block-detail")).toContain(
    "编辑之外",
  );
  const feedback = page.locator('[role="alert"], [role="status"]').filter({
    hasText: /页面内容没有改变|暂时不能直接编辑/u,
  });
  await expect(feedback).toHaveCount(0);
});

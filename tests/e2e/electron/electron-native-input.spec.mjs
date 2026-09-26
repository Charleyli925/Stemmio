import { readPublishedWorkingCopy } from "./helpers/working-copy-publication.mjs";
import { expect, test } from "@playwright/test";
import { withExpectedDeleteConfirmation } from "./real-html/expected-delete-dialog.mjs";
import {
  activateNativeEdit,
  addCanvasComment,
  caseSelector,
  clickEditHistoryMenu,
  closeStemmioGracefully,
  createSourceFixture,
  currentEditorFrame,
  documentToken,
  expectCheckpointPersisted,
  fixtureBuffer,
  geometrySnapshot,
  installInputRecorder,
  keyShortcut,
  launchStemmio,
  loadedDiskFrame,
  managedWorkingCopyPath,
  mkdtempSync,
  nativeEditingState,
  openRailGlobalCommentComposer,
  path,
  readFileSync,
  recordedInputEvents,
  rememberCurrentNativeHost,
  removeIsolatedUserData,
  removeSourceFixture,
  removeValidatedTemporaryDirectory,
  replaceUniqueBytes,
  replaceEditableIslandBytes,
  replayApplePinyinStyledWrapperCommit,
  retiredNativeHostState,
  setTextSelection,
  stopStemmio,
  tmpdir,
  waitForRuntimeHandoffSettled,
  waitForProjectReady,
  withBomAndCrLf,
  writeFileSync,
} from "./electron-native-harness.mjs";

test("public frozen-entry sample launches visibly without focus and reopens the same target", {
  tag: ["@gate-smoke", "@smoke-editing"],
}, async () => {
  const fixture = createSourceFixture("public-frozen-entry-sample.html");
  let launched = null;
  let isolatedUserData = null;
  const injectedEnv = { STEMMIO_E2E_WINDOW_MODE: "visible-background" };
  try {
    launched = await launchStemmio({ activeSourcePath: fixture.sourcePath, injectedEnv });
    isolatedUserData = launched.isolatedUserData;
    await waitForProjectReady(launched.page);
    const initialWindow = await launched.electronApp.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      return { visible: window?.isVisible(), focused: window?.isFocused() };
    });
    expect(initialWindow).toEqual({ visible: true, focused: false });
    await waitForRuntimeHandoffSettled(launched.page);
    const initialFrame = await currentEditorFrame(launched.page);
    const initialItem = initialFrame.locator(caseSelector("list-item"));
    await expect(initialItem).toHaveCount(1);
    const originalId = await initialItem.getAttribute("data-stemmio-id");
    expect(originalId).toMatch(/^sm1_[a-f0-9]{32}$/u);
    const editor = launched.page.getByTestId("html-canvas-editor").filter({ visible: true }).first();
    const expectVisibleBackground = async () => {
      await expect.poll(() => launched.electronApp.evaluate(({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows()[0];
        return { visible: window?.isVisible(), focused: window?.isFocused() };
      })).toEqual({ visible: true, focused: false });
    };
    let persistedRevision = Number(await launched.page.locator("[data-persist-state]").first()
      .getAttribute("data-persisted-revision"));
    await initialFrame.locator(caseSelector("list-item")).first().click();
    await editor.getByRole("button", { name: "复制元素", exact: true }).click();
    persistedRevision = await expectCheckpointPersisted(launched.page, persistedRevision);
    await waitForRuntimeHandoffSettled(launched.page);
    await expectVisibleBackground();
    let activeFrame = await currentEditorFrame(launched.page);
    const copiedItems = activeFrame.locator(caseSelector("list-item"));
    await expect(copiedItems).toHaveCount(2);
    const copiedIds = await copiedItems.evaluateAll((elements) => elements.map((element) => (
      element.getAttribute("data-stemmio-id")
    )));
    expect(copiedIds).toHaveLength(2);
    expect(new Set(copiedIds).size).toBe(2);
    expect(copiedIds).toContain(originalId);
    const copiedId = copiedIds.find((id) => id !== originalId);
    expect(copiedId).toMatch(/^sm1_[a-f0-9]{32}$/u);
    await copiedItems.nth(1).click();
    const toolbarLabel = await editor.getByRole("toolbar").getAttribute("aria-label");
    const deleteTargetLabel = toolbarLabel?.replace(/^编辑/u, "") || "";
    expect(deleteTargetLabel).toBeTruthy();
    await withExpectedDeleteConfirmation(launched.page, () => editor.getByRole("button", {
      name: "删除元素", exact: true,
    }).click(), { targetText: deleteTargetLabel });
    persistedRevision = await expectCheckpointPersisted(launched.page, persistedRevision);
    await waitForRuntimeHandoffSettled(launched.page);
    await expectVisibleBackground();
    activeFrame = await currentEditorFrame(launched.page);
    await expect(activeFrame.locator(`[data-stemmio-id="${originalId}"]`)).toHaveCount(1);
    await expect(activeFrame.locator(`[data-stemmio-id="${copiedId}"]`)).toHaveCount(0);
    await clickEditHistoryMenu(launched.electronApp, launched.page, "undo");
    persistedRevision = await expectCheckpointPersisted(launched.page, persistedRevision);
    await waitForRuntimeHandoffSettled(launched.page);
    await expectVisibleBackground();
    activeFrame = await currentEditorFrame(launched.page);
    await expect(activeFrame.locator(`[data-stemmio-id="${originalId}"]`)).toHaveCount(1);
    await expect(activeFrame.locator(`[data-stemmio-id="${copiedId}"]`)).toHaveCount(1);
    await clickEditHistoryMenu(launched.electronApp, launched.page, "redo");
    await expectCheckpointPersisted(launched.page, persistedRevision);
    await waitForRuntimeHandoffSettled(launched.page);
    await expectVisibleBackground();
    activeFrame = await currentEditorFrame(launched.page);
    await expect(activeFrame.locator(`[data-stemmio-id="${originalId}"]`)).toHaveCount(1);
    await expect(activeFrame.locator(`[data-stemmio-id="${copiedId}"]`)).toHaveCount(0);

    await closeStemmioGracefully(launched.electronApp, launched.page);
    launched = null;
    launched = await launchStemmio({ isolatedUserData, injectedEnv });
    await waitForProjectReady(launched.page);
    const reopenedWindow = await launched.electronApp.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      return { visible: window?.isVisible(), focused: window?.isFocused() };
    });
    expect(reopenedWindow).toEqual({ visible: true, focused: false });
    const reopenedFrame = await currentEditorFrame(launched.page);
    await expect(reopenedFrame.locator(`[data-stemmio-id="${originalId}"]`)).toHaveCount(1);
    await expect(reopenedFrame.locator(`[data-stemmio-id="${copiedId}"]`)).toHaveCount(0);
  } finally {
    if (launched) await stopStemmio(launched.electronApp, launched.isolatedUserData);
    else if (isolatedUserData) removeIsolatedUserData(isolatedUserData);
    removeSourceFixture(fixture.sourceDirectory);
  }
});

function sourceFidelityExpected(managedSource, replacement) {
  const managedText = managedSource.toString("utf8");
  const spanId = managedText.match(
    /<span title='single-quoted' data-order-b="2" data-order-a='1' data-stemmio-id="(sm1_[a-f0-9]{32})">SOURCE_FIDELITY_TOKEN_001<\/span>/u,
  )?.[1];
  if (!spanId) {
    throw new Error("The identified source-fidelity span is missing from the managed Working Copy.");
  }
  return replaceEditableIslandBytes(
    managedSource,
    "source-fidelity",
    `<span title='single-quoted' data-order-b="2" data-order-a='1' data-stemmio-id="${spanId}">${replacement}</span>`,
  );
}

test("Electron shows continuous source text immediately without rebuilding the iframe", {
  tag: ["@gate-smoke","@smoke-editing"],
}, async () => {
  const fixture = createSourceFixture("continuous-source-text.html");
  const { electronApp, page, isolatedUserData } = await launchStemmio({
    activeSourcePath: fixture.sourcePath,
  });
  try {
    const { editor, frame } = await loadedDiskFrame(
      page,
      fixture.sourcePath,
      "list-item",
    );
    const initialDocument = await documentToken(frame);
    await activateNativeEdit(frame, "list-item");
    expect(await nativeEditingState(frame, "list-item")).toMatchObject({
      contenteditable: "true",
      isContentEditable: true,
      activeIsLegacySurface: false,
      legacySurfaceCount: 0,
    });
    await expect(page.getByTestId("canvas-target-outline")).toHaveCount(1);
    await expect(page.getByTestId("canvas-capability-outline")).toHaveCount(0);
    await expect(page.getByTestId("canvas-target-outline")).toBeVisible();
    expect(await frame.locator(caseSelector("list-item")).evaluate((element) => {
      const style = getComputedStyle(element);
      return { boxShadow: style.boxShadow, outlineStyle: style.outlineStyle };
    })).toEqual({ boxShadow: "none", outlineStyle: "none" });
    await installInputRecorder(frame);
    await setTextSelection(frame, "list-item", 3, 9);
    await page.keyboard.insertText("Electron原位");

    expect(await documentToken(frame)).toBe(initialDocument);
    expect(await frame.locator(caseSelector("list-item")).textContent()).toContain("Electron原位");
    const events = await recordedInputEvents(frame);
    expect(events.some(({ type, inputType }) => type === "beforeinput" && inputType === "insertText")).toBe(true);
    expect(events.some(({ type }) => type === "input")).toBe(false);

    const toolbar = editor.getByRole("toolbar");
    await page.locator(".comments-panel.comment-rail").click({
      position: { x: 4, y: 4 },
    });
    await expect(toolbar).toHaveCount(0);
    await expect(frame.locator("[data-html-canvas-selected]")).toHaveCount(0);
    await expect(frame.locator(caseSelector("list-item")))
      .not.toHaveAttribute("contenteditable", "true");

    // Leaving Native Edit may start a Runtime Candidate. Wait for that
    // handoff so the next Frame handle is the live Active, not a stale one.
    await waitForRuntimeHandoffSettled(page);
    let resumedFrame = await currentEditorFrame(page);
    await activateNativeEdit(resumedFrame, "list-item");
    resumedFrame = await currentEditorFrame(page);
    await expect(toolbar).toBeVisible();
    await expect(resumedFrame.locator("[data-html-canvas-selected]")).toHaveCount(1);

    await page.locator(".workbench-header").click({
      position: { x: 720, y: 4 },
    });
    await expect(toolbar).toHaveCount(0);
    await expect(resumedFrame.locator("[data-html-canvas-selected]")).toHaveCount(0);
    await expect(resumedFrame.locator(caseSelector("list-item")))
      .not.toHaveAttribute("contenteditable", "true");
  } finally {
    await stopStemmio(electronApp, isolatedUserData);
    removeSourceFixture(fixture.sourceDirectory);
  }
});

const outsideNativeEditHtml = `<!doctype html>
<html><head><title>Native Edit outside pointer</title><style>
  main { padding: 32px; font: 20px/1.5 sans-serif; }
  p { margin: 24px 0; }
  button, input { margin: 12px; }
  [data-native-case="outside-blank"] { height: 80px; margin-top: 24px; }
</style></head><body><main>
  <p data-native-case="outside-a">原生编辑中的文字</p>
  <p data-native-case="outside-b">下一次单击才选择这段文字</p>
  <button data-native-case="outside-disabled" disabled>禁用的作者按钮</button>
  <input data-native-case="outside-enabled" type="checkbox" aria-label="作者复选框">
  <div data-native-case="outside-blank"></div>
</main></body></html>`;

test("Electron consumes the first outside Native Edit click before selecting text, controls or blank content", {
  tag: ["@gate-smoke", "@smoke-editing"],
}, async () => {
  const fixture = createSourceFixture("native-outside-click.html", () => outsideNativeEditHtml);
  const { electronApp, page, isolatedUserData } = await launchStemmio({
    activeSourcePath: fixture.sourcePath,
    injectedEnv: { STEMMIO_E2E_RUNTIME_COMMIT_HOOKS: "1" },
  });
  try {
    const { editor, frame } = await loadedDiskFrame(page, fixture.sourcePath, "outside-a");
    const initialDocument = await documentToken(frame);
    const workingCopyPath = await managedWorkingCopyPath(page, fixture.sourcePath);
    const toolbar = editor.getByRole("toolbar");
    await page.evaluate(() => {
      window.__STEMMIO_E2E_HOLD_AUTOMATIC_NATIVE_CHECKPOINT__ = true;
    });
    for (const caseId of ["outside-b", "outside-disabled", "outside-enabled", "outside-blank"]) {
      const active = await activateNativeEdit(frame, "outside-a");
      await active.click({ position: { x: 18, y: 14 } });
      await expect(active).toHaveAttribute("contenteditable", "true");
      await expect(active).toBeFocused();
      await setTextSelection(frame, "outside-a", 0, 0);
      const insertedText = `[${caseId}]`;
      const revisionBefore = Number(await page.locator("[data-persist-state]").first()
        .getAttribute("data-persisted-revision"));
      await page.keyboard.insertText(insertedText);
      expect(await readPublishedWorkingCopy(workingCopyPath, "utf8")).not.toContain(insertedText);

      const outside = frame.locator(caseSelector(caseId));
      await outside.click({ force: true, position: { x: 6, y: 6 } });
      await expect(frame.locator('[contenteditable="true"]')).toHaveCount(0);
      await expect(frame.locator("[data-html-canvas-selected]")).toHaveCount(0);
      await expect(toolbar).toHaveCount(0);
      await expectCheckpointPersisted(page, revisionBefore);
      expect(await readPublishedWorkingCopy(workingCopyPath, "utf8")).toContain(insertedText);
      expect(await documentToken(frame)).toBe(initialDocument);
      await expect(frame.locator(caseSelector("outside-enabled"))).not.toBeChecked();

      await outside.click({ force: true, position: { x: 6, y: 6 } });
      await expect(outside).toHaveAttribute("data-html-canvas-selected", /.+/u);
      await expect(toolbar).toBeVisible();
      await expect(frame.locator('[contenteditable="true"]')).toHaveCount(0);
      await expect(frame.locator(caseSelector("outside-enabled"))).not.toBeChecked();
    }

    // A rapid pair contains one exit gesture and one structural selection;
    // Chromium's resulting dblclick must not activate B using the exit click.
    await activateNativeEdit(frame, "outside-a");
    await frame.locator(caseSelector("outside-b")).dblclick({ position: { x: 18, y: 14 } });
    await expect(frame.locator(caseSelector("outside-b")))
      .toHaveAttribute("data-html-canvas-selected", /.+/u);
    await expect(frame.locator('[contenteditable="true"]')).toHaveCount(0);
    await activateNativeEdit(frame, "outside-b");
    expect(await documentToken(frame)).toBe(initialDocument);
  } finally {
    await stopStemmio(electronApp, isolatedUserData);
    removeSourceFixture(fixture.sourceDirectory);
  }
});

test("Electron defers an outside Native Edit click until Chromium composition commits once", {
  tag: ["@gate-smoke", "@smoke-editing"],
}, async () => {
  const fixture = createSourceFixture("native-outside-ime.html", () => outsideNativeEditHtml);
  const { electronApp, page, isolatedUserData } = await launchStemmio({ activeSourcePath: fixture.sourcePath });
  let cdp = null;
  try {
    const { editor, frame } = await loadedDiskFrame(page, fixture.sourcePath, "outside-a");
    const initialDocument = await documentToken(frame);
    const workingCopyPath = await managedWorkingCopyPath(page, fixture.sourcePath);
    const revisionBefore = Number(await page.locator("[data-persist-state]").first()
      .getAttribute("data-persisted-revision"));
    const active = await activateNativeEdit(frame, "outside-a");
    await installInputRecorder(frame);
    await setTextSelection(frame, "outside-a", 0, 2);
    cdp = await page.context().newCDPSession(page);
    await cdp.send("Input.imeSetComposition", {
      text: "zhongwen", selectionStart: 8, selectionEnd: 8,
    });
    const outside = frame.locator(caseSelector("outside-enabled"));
    await outside.click({ position: { x: 6, y: 6 } });
    await expect(active).toBeFocused();
    await expect(active).toHaveAttribute("contenteditable", "true");
    await expect(outside).not.toBeChecked();
    expect((await recordedInputEvents(frame)).filter(({ type }) => type === "compositionend"))
      .toHaveLength(0);
    await cdp.send("Input.insertText", { text: "中文" });

    await expect(frame.locator('[contenteditable="true"]')).toHaveCount(0);
    await expect(frame.locator("[data-html-canvas-selected]")).toHaveCount(0);
    await expect(editor.getByRole("toolbar")).toHaveCount(0);
    await expectCheckpointPersisted(page, revisionBefore);
    const source = await readPublishedWorkingCopy(workingCopyPath, "utf8");
    expect(source).toContain("中文编辑中的文字");
    expect(source).not.toContain("zhongwen");
    expect(source.match(/中文/gu)).toHaveLength(1);
    expect((await recordedInputEvents(frame)).filter(({ type }) => type === "compositionend"))
      .toHaveLength(1);
    expect(await documentToken(frame)).toBe(initialDocument);
    await outside.click({ position: { x: 6, y: 6 } });
    await expect(outside).toHaveAttribute("data-html-canvas-selected", /.+/u);
    await expect(outside).not.toBeChecked();
  } finally {
    if (cdp) await cdp.detach();
    await stopStemmio(electronApp, isolatedUserData);
    removeSourceFixture(fixture.sourceDirectory);
  }
});

test("Electron waits for composition before opening export options and returns focus on cancel", {
  tag: ["@gate-smoke", "@smoke-editing"],
}, async () => {
  const fixture = createSourceFixture("native-export-ime.html", () => outsideNativeEditHtml);
  const launched = await launchStemmio({ activeSourcePath: fixture.sourcePath });
  let cdp;
  try {
    const { page } = launched;
    const { frame } = await loadedDiskFrame(page, fixture.sourcePath, "outside-a");
    const initialDocument = await documentToken(frame);
    const active = await activateNativeEdit(frame, "outside-a");
    await setTextSelection(frame, "outside-a", 0, 2);
    await installInputRecorder(frame);
    cdp = await page.context().newCDPSession(page);
    await cdp.send("Input.imeSetComposition", { text: "zhongwen", selectionStart: 8, selectionEnd: 8 });
    await page.keyboard.press(keyShortcut("Shift+E"));
    const dialog = page.getByRole("dialog", { name: "导出当前 HTML", exact: true });
    await expect(dialog).toHaveCount(0);
    await expect(active).toBeFocused();
    expect((await recordedInputEvents(frame)).filter(({ type }) => type === "compositionend")).toHaveLength(0);
    await cdp.send("Input.insertText", { text: "中文" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("checkbox")).toBeChecked();
    await dialog.getByRole("button", { name: "取消", exact: true }).click();
    await expect(active).toBeFocused();
    await expect(active).toHaveAttribute("contenteditable", "true");
    expect((await recordedInputEvents(frame)).filter(({ type }) => type === "compositionend")).toHaveLength(1);
    expect(await documentToken(frame)).toBe(initialDocument);
    const working = await managedWorkingCopyPath(page, fixture.sourcePath);
    await expect.poll(() => readPublishedWorkingCopy(working, "utf8")).toContain("中文编辑中的文字");
    expect(await readPublishedWorkingCopy(working, "utf8")).not.toContain("zhongwen");
  } finally {
    if (cdp) await cdp.detach();
    await stopStemmio(launched.electronApp, launched.isolatedUserData);
    removeSourceFixture(fixture.sourceDirectory);
  }
});

test("Runtime handoff settlement samples fixed slots, retires the old document and rejects a live Candidate", {
  tag: ["@gate-smoke", "@smoke-editing"],
}, async () => {
  const fixture = createSourceFixture(
    "runtime-handoff-settlement.html",
    () => `<!doctype html>
<html><head><title>Runtime handoff settlement</title></head><body>
  <main data-native-case="runtime-handoff-settlement">合成 handoff 样本</main>
</body></html>`,
  );
  const { electronApp, page, isolatedUserData } = await launchStemmio({
    activeSourcePath: fixture.sourcePath,
  });
  try {
    const editor = page.getByTestId("html-canvas-editor").filter({ visible: true }).first();
    const activeFrameElement = editor.locator(
      'iframe[data-runtime-slot-role="active"]:not([data-frame-role])',
    );
    const oldFrameHandle = await activeFrameElement.elementHandle();
    const oldFrame = await oldFrameHandle?.contentFrame();
    const oldTarget = oldFrame?.locator('[data-native-case="runtime-handoff-settlement"]');
    const oldTargetHandle = await oldTarget?.elementHandle();
    expect(oldTargetHandle).toBeTruthy();
    const settled = await waitForRuntimeHandoffSettled(page);
    expect(settled).toMatchObject({
      handoff: null,
      runtimeRefreshPending: false,
      candidateId: null,
      candidateFrameCount: 0,
      activeFrameCount: 1,
      activeFrameRole: "active",
      activeFrameDataRole: null,
      previousFrameCount: 0,
      renderVerified: true,
      activeIdentityStable: true,
      activeStabilitySampleCount: 3,
    });

    const swapped = await page.evaluate(async () => {
      const editor = document.querySelector('[data-testid="html-canvas-editor"]');
      const oldActive = editor?.querySelector(
        'iframe[data-runtime-slot-role="active"]:not([data-frame-role])',
      );
      const newActive = editor?.querySelector('iframe[data-runtime-slot-role="inactive"]');
      if (
        !editor
        || !(oldActive instanceof HTMLIFrameElement)
        || !(newActive instanceof HTMLIFrameElement)
      ) {
        throw new Error("The fixed Active/inactive Runtime slots were unavailable.");
      }
      const nextGeneration = String(Number(oldActive.getAttribute("data-frame-generation")) + 1);
      const loaded = new Promise((resolve) => newActive.addEventListener("load", resolve, { once: true }));
      oldActive.setAttribute("data-runtime-slot-role", "inactive");
      oldActive.setAttribute("data-frame-role", "runtime-inactive");
      oldActive.setAttribute("aria-hidden", "true");
      oldActive.srcdoc = "<!doctype html><html><body></body></html>";
      newActive.setAttribute("data-runtime-slot-role", "active");
      newActive.removeAttribute("data-frame-role");
      newActive.removeAttribute("aria-hidden");
      newActive.setAttribute("data-frame-generation", nextGeneration);
      newActive.srcdoc = '<!doctype html><html><body><main data-native-case="replacement-document">new</main></body></html>';
      await loaded;
      return {
        fixedSlotCount: editor.querySelectorAll("iframe[data-runtime-slot]").length,
        oldSlotConnected: oldActive.isConnected,
        activeFrameCount: editor.querySelectorAll(
          'iframe[data-runtime-slot-role="active"]:not([data-frame-role])',
        ).length,
      };
    });
    expect(swapped).toEqual({
      fixedSlotCount: 2,
      oldSlotConnected: true,
      activeFrameCount: 1,
    });
    await expect(editor.locator(
      'iframe[data-runtime-slot-role="active"]:not([data-frame-role])',
    ).contentFrame().locator('[data-native-case="replacement-document"]')).toHaveCount(1);
    let oldTargetRetired = false;
    try {
      oldTargetRetired = await oldTargetHandle.evaluate((element) => !element.isConnected);
    } catch {
      oldTargetRetired = true;
    }
    expect(oldTargetRetired).toBe(true);
    await oldTargetHandle.dispose();
    const resettled = await waitForRuntimeHandoffSettled(page);
    expect(resettled.activeFrameGeneration).not.toBe(settled.activeFrameGeneration);

    const injected = await page.evaluate(() => {
      const editor = document.querySelector('[data-testid="html-canvas-editor"]');
      const inactive = editor?.querySelector('iframe[data-runtime-slot-role="inactive"]');
      if (!editor || !(inactive instanceof HTMLIFrameElement)) {
        throw new Error("The fixed inactive Runtime slot was unavailable.");
      }
      inactive.setAttribute("data-runtime-slot-role", "candidate");
      inactive.setAttribute("data-frame-role", "runtime-candidate");
      editor.setAttribute("data-runtime-candidate-id", "seeded-candidate");
      return {
        candidateFrameCount: editor.querySelectorAll(
          'iframe[data-frame-role="runtime-candidate"]',
        ).length,
        activeFrameCount: editor.querySelectorAll(
          'iframe[data-runtime-slot-role="active"]:not([data-frame-role])',
        ).length,
      };
    });
    expect(injected).toEqual({ candidateFrameCount: 1, activeFrameCount: 1 });

    let timeoutError;
    try {
      await waitForRuntimeHandoffSettled(page, { timeout: 750 });
    } catch (error) {
      timeoutError = error;
    }
    expect(timeoutError).toMatchObject({
      name: "RuntimeHandoffSettlementTimeout",
      code: "RUNTIME_HANDOFF_SETTLEMENT_TIMEOUT",
      details: {
        conditions: {
          candidateFramesAbsent: false,
          oneActiveFrame: true,
          activeIdentityStable: true,
          settled: false,
        },
        actual: {
          candidateFrameCount: 1,
          activeFrameCount: 1,
          activeIdentityStable: true,
        },
      },
    });
    expect(timeoutError.message).toContain('"candidateFramesAbsent":false');
    expect(timeoutError.message).toContain('"activeFrameCount":1');
  } finally {
    await stopStemmio(electronApp, isolatedUserData);
    removeSourceFixture(fixture.sourceDirectory);
  }
});

test("Electron fixed real-input sample covers mouse, keyboard, deletion and Enter", {
  tag: ["@gate-smoke", "@smoke-editing"],
}, async () => {
  const fixture = createSourceFixture("editable-island-lane.html");
  const { electronApp, page, isolatedUserData } = await launchStemmio({
    activeSourcePath: fixture.sourcePath,
  });
  try {
    const { editor, frame } = await loadedDiskFrame(
      page,
      fixture.sourcePath,
      "collapsed-whitespace-copy",
    );
    const controlledCase = "collapsed-whitespace-copy";
    const managedSourcePath = await managedWorkingCopyPath(page, fixture.sourcePath);
    const initialDocument = await documentToken(frame);
    const initialGeneration = await editor.locator('iframe[data-runtime-slot-role="active"]')
      .getAttribute("data-frame-generation");
    const selectedTarget = frame.locator(caseSelector(controlledCase));
    await selectedTarget.scrollIntoViewIfNeeded();
    await selectedTarget.click();
    await expect(selectedTarget).toHaveAttribute("data-html-canvas-selected", "module");
    const beforeGeometry = await geometrySnapshot(frame, controlledCase);
    const controlledTarget = await activateNativeEdit(frame, controlledCase);
    await expect(controlledTarget).toHaveAttribute("contenteditable", "true");
    await expect(editor).toHaveAttribute(
      "data-native-host-mode",
      "v2-editable-island",
    );
    await expect(editor).toHaveAttribute(
      "data-native-event-delivery-mode",
      "native-editable-island",
    );
    expect(await geometrySnapshot(frame, controlledCase)).toEqual(beforeGeometry);

    await page.keyboard.insertText("__REAL_BACKSPACE__X");
    await page.keyboard.press("Backspace");
    await expect.poll(() => controlledTarget.textContent())
      .toContain("__REAL_BACKSPACE__");
    await expect.poll(() => controlledTarget.textContent())
      .not.toContain("__REAL_BACKSPACE__X");

    await page.keyboard.insertText("__REAL_DELETE__X");
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("Delete");
    await expect.poll(() => controlledTarget.textContent())
      .toContain("__REAL_DELETE__");
    await expect.poll(() => controlledTarget.textContent())
      .not.toContain("__REAL_DELETE__X");

    await page.keyboard.insertText("__REAL_ENTER_BEFORE__");
    const breakIdsBefore = await controlledTarget.locator("br[data-stemmio-id]")
      .evaluateAll((elements) => elements.map(
        (element) => element.getAttribute("data-stemmio-id"),
      ).filter(Boolean));
    await page.keyboard.press("Enter");
    await page.keyboard.insertText("__REAL_ENTER_LINE__");
    await expect.poll(() => controlledTarget.textContent())
      .toContain("__REAL_ENTER_LINE__");
    await expect.poll(async () => (
      (await controlledTarget.locator("br[data-stemmio-id]").evaluateAll((elements) => (
        elements.map((element) => element.getAttribute("data-stemmio-id")).filter(Boolean)
      ))).filter((id) => !breakIdsBefore.includes(id)).length
    )).toBe(1);
    await expect.poll(() => readPublishedWorkingCopy(managedSourcePath, "utf8"))
      .toMatch(/__REAL_ENTER_BEFORE__[\s\S]*<br\s+[^>]*data-stemmio-id="sm1_[0-9a-f]{32}"[^>]*>[\s\S]*__REAL_ENTER_LINE__/u);
    expect(await documentToken(frame)).toBe(initialDocument);
    await expect(editor.locator('iframe[data-runtime-slot-role="active"]'))
      .toHaveAttribute("data-frame-generation", initialGeneration);
    await expect(editor.locator('iframe[data-frame-role="runtime-candidate"]')).toHaveCount(0);

    await page.keyboard.press("Escape");
    await expect(controlledTarget).not.toHaveAttribute("contenteditable", "true");
    const secondProjectionCase = "display-contents-copy";
    await activateNativeEdit(page, secondProjectionCase);
    await expect(editor).toHaveAttribute(
      "data-native-host-mode",
      "v2-editable-island",
    );
    await expect(editor).toHaveAttribute(
      "data-native-event-delivery-mode",
      "native-editable-island",
    );
    await setTextSelection(page, secondProjectionCase, 0);
    await page.keyboard.insertText("电");
    await expect.poll(() => (
      page
        .getByTestId("html-canvas-editor")
        .filter({ visible: true })
        .first()
        .locator('iframe[title*="HTML"]')
        .contentFrame()
        .locator(caseSelector(secondProjectionCase))
        .textContent()
    )).toContain("电观察器保护");
  } finally {
    await stopStemmio(electronApp, isolatedUserData);
    removeSourceFixture(fixture.sourceDirectory);
  }
});

test("Electron autosaves one authorized disk patch and reopens the same forward result", async () => {
  test.setTimeout(90_000);
  const sourceDirectory = mkdtempSync(path.join(tmpdir(), "stemmio-native-source-e2e-"));
  const sourcePath = path.join(sourceDirectory, "native-source-fidelity.html");
  const originalToken = "SOURCE_FIDELITY_TOKEN_001";
  const replacement = "Electron磁盘原位_OK";
  const original = withBomAndCrLf(fixtureBuffer("source-fidelity.html"));
  writeFileSync(sourcePath, original);

  const isolatedUserData = mkdtempSync(path.join(tmpdir(), "stemmio-native-e2e-"));
  let firstApp = null;
  let reopenedApp = null;
  try {
    const firstLaunch = await launchStemmio({
      isolatedUserData,
      activeSourcePath: sourcePath,
    });
    firstApp = firstLaunch.electronApp;
    const managedSourcePath = await managedWorkingCopyPath(
      firstLaunch.page,
      sourcePath,
    );
    const expected = sourceFidelityExpected(readFileSync(managedSourcePath), replacement);
    let { frame } = await loadedDiskFrame(
      firstLaunch.page,
      managedSourcePath,
      "source-fidelity",
    );
    expect(
      readFileSync(sourcePath).equals(original),
      "opening and registering a disk project must not rewrite its HTML",
    ).toBe(true);
    await activateNativeEdit(frame, "source-fidelity");
    await setTextSelection(frame, "source-fidelity", 0, originalToken.length);
    await firstLaunch.page.keyboard.insertText(replacement);
    expect(await frame.locator(caseSelector("source-fidelity")).textContent()).toBe(replacement);
    expect(await frame.evaluate(() => ({
      lexical: document.querySelectorAll("[data-lexical-editor]").length,
      mirror: document.querySelectorAll("[data-html-canvas-text-flow-surface]").length,
      editableCases: Array.from(document.querySelectorAll("[contenteditable]")).map(
        (element) => element.getAttribute("data-native-case"),
      ),
    }))).toEqual({
      lexical: 0,
      mirror: 0,
      editableCases: ["source-fidelity"],
    });
    await rememberCurrentNativeHost(firstLaunch.page, "source-fidelity");
    const previousDocumentToken = await documentToken(firstLaunch.page);
    await firstLaunch.page.keyboard.press(keyShortcut("S"));
    await expectCheckpointPersisted(
      firstLaunch.page,
      0,
    );
    expect(
      readFileSync(managedSourcePath).equals(expected),
      "checkpoint/autosave must write only the authorized V1 bytes",
    ).toBe(true);
    expect(readFileSync(sourcePath)).toEqual(original);

    expect(await documentToken(firstLaunch.page)).toBe(previousDocumentToken);
    frame = await currentEditorFrame(firstLaunch.page);
    await expect.poll(() => nativeEditingState(frame, "source-fidelity"))
      .toMatchObject({
        targetIsActive: true,
        contenteditable: "true",
        isContentEditable: true,
        selectionInside: true,
      });
    expect(await retiredNativeHostState(firstLaunch.page)).toEqual({
      contenteditable: "true",
      editingMarker: "true",
    });

    await expect.poll(() => frame.locator(caseSelector("source-fidelity")).textContent())
      .toBe(replacement);

    await closeStemmioGracefully(firstApp, firstLaunch.page);
    firstApp = null;

    const reopened = await launchStemmio({ isolatedUserData });
    reopenedApp = reopened.electronApp;
    const { frame: reopenedFrame } = await loadedDiskFrame(
      reopened.page,
      managedSourcePath,
      "source-fidelity",
    );
    expect(await reopenedFrame.locator(caseSelector("source-fidelity")).textContent())
      .toBe(replacement);
    await activateNativeEdit(reopenedFrame, "source-fidelity");
    expect(await nativeEditingState(reopenedFrame, "source-fidelity")).toMatchObject({
      targetIsActive: true,
      contenteditable: "true",
      activeIsLegacySurface: false,
      legacySurfaceCount: 0,
    });
    expect(await reopenedFrame.locator("[data-lexical-editor]").count()).toBe(0);
    expect(readFileSync(sourcePath)).toEqual(original);
    expect(readFileSync(managedSourcePath).equals(expected)).toBe(true);

    await closeStemmioGracefully(reopenedApp, reopened.page);
    reopenedApp = null;
  } finally {
    if (firstApp) await stopStemmio(firstApp, isolatedUserData, { cleanup: false });
    if (reopenedApp) await stopStemmio(reopenedApp, isolatedUserData, { cleanup: false });
    removeIsolatedUserData(isolatedUserData);
    removeValidatedTemporaryDirectory(
      sourceDirectory,
      "stemmio-native-source-e2e-",
    );
  }
});

test("Electron assigns Stable ID to a native line break and reopens it from managed HTML", {
  tag: ["@gate-smoke", "@smoke-editing"],
}, async () => {
  test.setTimeout(120_000);
  const sourceDirectory = mkdtempSync(path.join(tmpdir(), "stemmio-native-source-e2e-"));
  const sourcePath = path.join(sourceDirectory, "managed-line-break.html");
  const original = Buffer.from(
    "<!doctype html><html><head><title>Line break</title></head><body>"
      + "<main><p data-native-case='managed-line-break'>Alpha</p></main>"
      + "</body></html>",
    "utf8",
  );
  writeFileSync(sourcePath, original);
  const isolatedUserData = mkdtempSync(path.join(tmpdir(), "stemmio-native-e2e-"));
  let activeApp = null;
  try {
    let launched = await launchStemmio({ isolatedUserData, activeSourcePath: sourcePath });
    activeApp = launched.electronApp;
    const managedSourcePath = await managedWorkingCopyPath(launched.page, sourcePath);
    let { editor, frame } = await loadedDiskFrame(
      launched.page,
      sourcePath,
      "managed-line-break",
    );
    const initialDocument = await documentToken(frame);
    const target = await activateNativeEdit(frame, "managed-line-break");
    await setTextSelection(frame, "managed-line-break", "Alpha".length);
    await target.evaluate((element) => {
      element.ownerDocument.defaultView.__stemmioManagedLineBreakHost = element;
    });
    await target.press("Enter");
    await expect.poll(() => frame.locator(
      `${caseSelector("managed-line-break")} > br`,
    ).count()).toBeGreaterThan(0);
    await expect.poll(() => readPublishedWorkingCopy(managedSourcePath, "utf8"))
      .toMatch(/<br data-stemmio-id="sm1_/u);
    await expect(editor).not.toHaveAttribute("data-edit-block-detail", /.+/u);
    await expect(editor).toHaveAttribute(
      "data-native-commit-path",
      "v2-island-checkpoint-preserved",
    );
    expect(await documentToken(frame)).toBe(initialDocument);
    await expect(target).toHaveAttribute("contenteditable", "true");
    await expect(editor.locator('iframe[data-frame-role="runtime-candidate"]'))
      .toHaveCount(0);
    const savedHtml = readFileSync(managedSourcePath, "utf8");
    const identifiedBreaks = savedHtml.match(
      /<br data-stemmio-id="sm1_[0-9a-f]{12}4[0-9a-f]{3}[89ab][0-9a-f]{15}">/gu,
    ) ?? [];
    expect(identifiedBreaks.length).toBeGreaterThan(0);
    expect(savedHtml).not.toMatch(/<br(?! data-stemmio-id=)/u);
    await expect(frame.locator(
      `${caseSelector("managed-line-break")} > br`,
    )).toHaveAttribute("data-stemmio-id", /^sm1_/u);
    expect(await target.evaluate((element) => (
      element.ownerDocument.defaultView.__stemmioManagedLineBreakHost === element
    ))).toBe(true);
    await target.press("End");
    await launched.page.keyboard.insertText("Omega");
    expect(await documentToken(frame)).toBe(initialDocument);
    await expect(target).toContainText("Omega");
    await launched.page.keyboard.press(keyShortcut("S"));
    await expect(editor).not.toHaveAttribute("data-edit-block-detail", /.+/u);
    await expect.poll(() => readPublishedWorkingCopy(managedSourcePath, "utf8"))
      .toContain("Omega");
    const finalSavedHtml = readFileSync(managedSourcePath, "utf8");
    expect(finalSavedHtml.match(/data-stemmio-id=/gu)?.length)
      .toBe(savedHtml.match(/data-stemmio-id=/gu)?.length);
    expect(readFileSync(sourcePath)).toEqual(original);

    await closeStemmioGracefully(activeApp, launched.page);
    activeApp = null;
    launched = await launchStemmio({ isolatedUserData });
    activeApp = launched.electronApp;
    ({ frame } = await loadedDiskFrame(
      launched.page,
      managedSourcePath,
      "managed-line-break",
    ));
    await expect(frame.locator(`${caseSelector("managed-line-break")} > br`))
      .toHaveCount(identifiedBreaks.length);
    await expect(frame.locator(caseSelector("managed-line-break")))
      .toContainText("Omega");
    expect(readFileSync(managedSourcePath, "utf8")).toBe(finalSavedHtml);
  } finally {
    if (activeApp) await stopStemmio(activeApp, isolatedUserData, { cleanup: false });
    removeIsolatedUserData(isolatedUserData);
    removeValidatedTemporaryDirectory(sourceDirectory, "stemmio-native-source-e2e-");
  }
});

test("Electron keeps full-identity text formatting in one Runtime editing transaction", {
  tag: ["@gate-smoke", "@smoke-editing"],
}, async () => {
  test.setTimeout(120_000);
  const sourceDirectory = mkdtempSync(path.join(tmpdir(), "stemmio-native-format-e2e-"));
  const sourcePath = path.join(sourceDirectory, "full-identity-format.html");
  const source = `<!doctype html>
<html data-stemmio-id="sm1_00000000000040008000000000000001">
<head data-stemmio-id="sm1_00000000000040008000000000000002">
  <meta data-stemmio-id="sm1_00000000000040008000000000000003" charset="utf-8">
  <title data-stemmio-id="sm1_00000000000040008000000000000004">Formatting</title>
</head>
<body data-stemmio-id="sm1_00000000000040008000000000000005">
  <main data-stemmio-id="sm1_00000000000040008000000000000006">
    <p data-stemmio-id="sm1_00000000000040008000000000000007" data-native-case="full-id-format">Alpha Beta</p>
    <output data-stemmio-id="sm1_00000000000040008000000000000008" id="format-proof"></output>
  </main>
  <script data-stemmio-id="sm1_00000000000040008000000000000009">
    document.querySelector('#format-proof').textContent = 'Runtime formatting ready';
  </script>
</body>
</html>`;
  writeFileSync(sourcePath, source, "utf8");
  const isolatedUserData = mkdtempSync(path.join(tmpdir(), "stemmio-native-e2e-"));
  let activeApp = null;
  try {
    const launched = await launchStemmio({ isolatedUserData, activeSourcePath: sourcePath });
    activeApp = launched.electronApp;
    const { editor, frame } = await loadedDiskFrame(
      launched.page,
      sourcePath,
      "full-id-format",
    );
    const workingCopyPath = await managedWorkingCopyPath(launched.page, sourcePath);
    await activateNativeEdit(frame, "full-id-format");
    await setTextSelection(frame, "full-id-format", 0, 5);
    const initialDocument = await documentToken(frame);
    const initialGeneration = await editor.locator('iframe:not([data-frame-role])')
      .getAttribute("data-frame-generation");
    const toolbar = editor.getByRole("toolbar");

    await toolbar.getByRole("button", { name: "加粗", exact: true }).click();
    await expect.poll(() => readPublishedWorkingCopy(workingCopyPath, "utf8"))
      .toMatch(/font-weight:\s*700/u);
    await expect.poll(() => documentToken(frame)).toBe(initialDocument);
    await expect(editor.locator('iframe:not([data-frame-role])'))
      .toHaveAttribute("data-frame-generation", initialGeneration);
    await expect.poll(() => editor.evaluate((element) => ({
      candidateCount: element.querySelectorAll(
        'iframe[data-frame-role="runtime-candidate"]',
      ).length,
      formatResume: element.getAttribute("data-native-format-resume"),
      startStatus: element.getAttribute("data-native-start-status"),
      commitPath: element.getAttribute("data-native-commit-path"),
      previewSync: element.getAttribute("data-native-preview-sync"),
      blockedDetail: element.getAttribute("data-edit-block-detail"),
    }))).toEqual({
      candidateCount: 0,
      formatResume: "source:requested:resumed",
      startStatus: "started",
      commitPath: null,
      previewSync: "ready",
      blockedDetail: null,
    });

    await launched.page.keyboard.press(keyShortcut("I"));
    await expect.poll(() => readPublishedWorkingCopy(workingCopyPath, "utf8"))
      .toMatch(/font-style:\s*italic/u);

    await toolbar.getByText("样式与间距", { exact: true }).click();
    await toolbar.getByLabel("字号（像素）").fill("28");
    await expect.poll(() => readPublishedWorkingCopy(workingCopyPath, "utf8"))
      .toMatch(/font-size:\s*28px/u);
    const color = toolbar.getByLabel("文字颜色");
    await color.evaluate((element) => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(element, "#123456");
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await expect.poll(() => readPublishedWorkingCopy(workingCopyPath, "utf8"))
      .toMatch(/color:\s*#123456/u);

    const editingHost = frame.locator(
      '[data-native-case="full-id-format"] [contenteditable="true"], '
      + '[data-native-case="full-id-format"][contenteditable="true"]',
    );
    await expect(editingHost).toHaveCount(1);
    await editingHost.click();
    await editingHost.evaluate((element) => {
      element.focus();
      const range = element.ownerDocument.createRange();
      range.selectNodeContents(element);
      range.collapse(false);
      const selection = element.ownerDocument.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      element.ownerDocument.dispatchEvent(new Event("selectionchange"));
    });
    await expect.poll(() => editingHost.evaluate(() => (
      Boolean(document.getSelection()?.isCollapsed)
    ))).toBe(true);
    await toolbar.getByText("样式与间距", { exact: true }).click();
    await toolbar.getByLabel("内边距（像素）").fill("12");
    await expect.poll(() => readPublishedWorkingCopy(workingCopyPath, "utf8"))
      .toMatch(/padding-top:\s*12px/u);
    await expect.poll(() => editingHost.evaluate((element) => (
      element.ownerDocument.activeElement === element
      || element.contains(element.ownerDocument.activeElement)
    ))).toBe(true);
    await expect.poll(() => editingHost.evaluate(() => (
      Boolean(document.getSelection()?.isCollapsed)
    ))).toBe(true);
    await expect.poll(() => documentToken(frame)).toBe(initialDocument);
    await expect(editor.locator('iframe:not([data-frame-role])'))
      .toHaveAttribute("data-frame-generation", initialGeneration);
    await expect(editor.locator('iframe[data-frame-role="runtime-candidate"]'))
      .toHaveCount(0);

    const persisted = readFileSync(workingCopyPath, "utf8");
    expect(persisted).toMatch(
      /<span[^>]*style="[^"]*font-weight:\s*700[^"]*font-style:\s*italic[^"]*font-size:\s*28px[^"]*color:\s*#123456[^"]*"[^>]*data-stemmio-id="sm1_/u,
    );
    expect(persisted).toMatch(/padding-top:\s*12px/u);
  } finally {
    if (activeApp) await stopStemmio(activeApp, isolatedUserData, { cleanup: false });
    removeIsolatedUserData(isolatedUserData);
    removeValidatedTemporaryDirectory(sourceDirectory, "stemmio-native-format-e2e-");
  }
});

test("Electron separates focused-field undo from current-open Canvas undo and redo", {
  tag: ["@gate-smoke","@smoke-editing"],
}, async () => {
  test.setTimeout(120_000);
  const sourceDirectory = mkdtempSync(path.join(tmpdir(), "stemmio-native-source-e2e-"));
  const sourcePath = path.join(sourceDirectory, "persistent-source-history.html");
  const originalToken = "SOURCE_FIDELITY_TOKEN_001";
  const replacement = "撤销历史已持久化";
  const original = withBomAndCrLf(fixtureBuffer("source-fidelity.html"));
  writeFileSync(sourcePath, original);

  const isolatedUserData = mkdtempSync(path.join(tmpdir(), "stemmio-native-e2e-"));
  let firstApp = null;
  try {
    const firstLaunch = await launchStemmio({
      isolatedUserData,
      activeSourcePath: sourcePath,
    });
    firstApp = firstLaunch.electronApp;
    const managedSourcePath = await managedWorkingCopyPath(
      firstLaunch.page,
      sourcePath,
    );
    const identifiedBeforeEdit = readFileSync(managedSourcePath);
    const expected = sourceFidelityExpected(identifiedBeforeEdit, replacement);
    const { frame } = await loadedDiskFrame(
      firstLaunch.page,
      managedSourcePath,
      "source-fidelity",
    );
    await activateNativeEdit(frame, "source-fidelity");
    await setTextSelection(frame, "source-fidelity", 0, originalToken.length);
    await firstLaunch.page.keyboard.insertText(replacement);
    await firstLaunch.page.keyboard.press(keyShortcut("S"));
    await expectCheckpointPersisted(
      firstLaunch.page,
      0,
    );
    expect(readFileSync(managedSourcePath).equals(expected)).toBe(true);
    expect(readFileSync(sourcePath)).toEqual(original);

    await openRailGlobalCommentComposer(firstLaunch.page);
    const commentInput = firstLaunch.page.getByRole("textbox", {
      name: "评论内容",
    });
    await commentInput.fill("原文");
    await commentInput.focus();
    await firstLaunch.page.keyboard.press("End");
    await firstLaunch.page.keyboard.insertText("新增");
    await expect(commentInput).toHaveValue("原文新增");
    await clickEditHistoryMenu(firstApp, firstLaunch.page, "undo");
    await expect(commentInput).toHaveValue("原文");
    expect(
      readFileSync(managedSourcePath).equals(expected),
      "native comment undo must not touch the managed V1",
    ).toBe(true);
    await commentInput.press("Enter");
    await expect(commentInput).toHaveCount(0);

    const currentFrame = await currentEditorFrame(firstLaunch.page);
    await currentFrame.locator(caseSelector("source-fidelity")).click();
    await clickEditHistoryMenu(firstApp, firstLaunch.page, "undo");
    const undoRevision = await expectCheckpointPersisted(firstLaunch.page, 1);
    expect(readFileSync(managedSourcePath).equals(identifiedBeforeEdit)).toBe(true);

    await clickEditHistoryMenu(firstApp, firstLaunch.page, "redo");
    await expectCheckpointPersisted(firstLaunch.page, undoRevision);
    expect(readFileSync(managedSourcePath).equals(expected)).toBe(true);

    const manifest = JSON.parse(readFileSync(
      path.join(path.dirname(managedSourcePath), ".stemmio", "manifest.json"),
      "utf8",
    ));
    expect(manifest.versions.map((version) => version.versionId)).toEqual(["ver_0001"]);
    expect(readFileSync(sourcePath)).toEqual(original);

    await closeStemmioGracefully(firstApp, firstLaunch.page);
    firstApp = null;
  } finally {
    if (firstApp) await stopStemmio(firstApp, isolatedUserData, { cleanup: false });
    removeIsolatedUserData(isolatedUserData);
    removeValidatedTemporaryDirectory(
      sourceDirectory,
      "stemmio-native-source-e2e-",
    );
  }
});

test("Electron persists semantic identity edits, deletes target comments, and clears history on relaunch", {
  tag: ["@gate-smoke", "@smoke-editing"],
}, async () => {
  test.setTimeout(240_000);
  const sourceDirectory = mkdtempSync(path.join(tmpdir(), "stemmio-native-source-e2e-"));
  const sourcePath = path.join(sourceDirectory, "semantic-identity-closure.html");
  writeFileSync(sourcePath, Buffer.from(
    "<!doctype html><html><head><title>Identity closure</title></head><body>"
      + "<main><p data-native-case='identity-target'>Alpha <strong>child</strong></p>"
      + "<p data-native-case='identity-sibling'>Sibling</p></main>"
      + "<script>document.body.dataset.runtimeOnly = 'display';</script>"
      + "</body></html>",
    "utf8",
  ));
  const isolatedUserData = mkdtempSync(path.join(tmpdir(), "stemmio-native-e2e-"));
  const commentText = "删除后必须保持孤立。";
  let activeApp = null;
  try {
    let launched = await launchStemmio({ isolatedUserData, activeSourcePath: sourcePath });
    activeApp = launched.electronApp;
    let { editor, frame } = await loadedDiskFrame(
      launched.page,
      sourcePath,
      "identity-target",
    );
    const managedSourcePath = await managedWorkingCopyPath(launched.page, sourcePath);
    const identified = readFileSync(managedSourcePath, "utf8");
    const targetId = identified.match(
      /<p data-native-case='identity-target' data-stemmio-id="(sm1_[a-f0-9]{32})">/u,
    )?.[1];
    const descendantId = identified.match(
      /<strong data-stemmio-id="(sm1_[a-f0-9]{32})">child<\/strong>/u,
    )?.[1];
    expect(targetId).toBeTruthy();
    expect(descendantId).toBeTruthy();

    const comment = await addCanvasComment(
      launched.page,
      frame,
      "identity-target",
      commentText,
    );
    await activateNativeEdit(frame, "identity-target");
    await setTextSelection(frame, "identity-target", 0, "Alpha child".length);
    await launched.page.keyboard.insertText("Flattened source text");
    await launched.page.keyboard.press(keyShortcut("S"));
    let persistedRevision = await expectCheckpointPersisted(launched.page, 0);
    await waitForRuntimeHandoffSettled(launched.page);
    let savedHtml = readFileSync(managedSourcePath, "utf8");
    expect(savedHtml).toContain(`data-stemmio-id="${targetId}"`);
    // Native rich-text replacement preserves the authored empty wrapper; the
    // direct semantic setText descendant-retirement rule is covered by the
    // managed Repository contract test instead of being conflated with this UI path.
    expect(savedHtml).toContain(`<strong data-stemmio-id="${descendantId}"></strong>`);
    expect(savedHtml).not.toContain(">child</strong>");
    await expect(comment).toHaveAttribute("data-resolution", "exact");

    frame = await currentEditorFrame(launched.page);
    let targets = frame.locator(caseSelector("identity-target"));
    await targets.first().click();
    await editor.getByRole("button", { name: "复制元素", exact: true }).click();
    persistedRevision = await expectCheckpointPersisted(launched.page, persistedRevision);
    await waitForRuntimeHandoffSettled(launched.page);
    frame = await currentEditorFrame(launched.page);
    targets = frame.locator(caseSelector("identity-target"));
    await expect(targets).toHaveCount(2);
    const duplicateIds = await targets.evaluateAll((elements) => elements.map(
      (element) => element.getAttribute("data-stemmio-id"),
    ));
    expect(duplicateIds[0]).toBe(targetId);
    expect(duplicateIds[1]).toMatch(/^sm1_[a-f0-9]{32}$/u);
    expect(duplicateIds[1]).not.toBe(targetId);

    await targets.nth(1).click();
    expect(await frame.locator("[data-html-canvas-selected]").getAttribute("data-stemmio-id"))
      .toBe(duplicateIds[1]);
    await editor.getByRole("button", { name: "上移", exact: true }).click();
    persistedRevision = await expectCheckpointPersisted(launched.page, persistedRevision);
    await waitForRuntimeHandoffSettled(launched.page);
    frame = await currentEditorFrame(launched.page);
    targets = frame.locator(caseSelector("identity-target"));
    expect(await targets.evaluateAll((elements) => elements.map(
      (element) => element.getAttribute("data-stemmio-id"),
    ))).toEqual([duplicateIds[1], duplicateIds[0]]);

    await targets.nth(1).click();
    let deleteDialogMessage = "";
    launched.page.once("dialog", async (dialog) => {
      deleteDialogMessage = dialog.message();
      await dialog.accept();
    });
    await editor.getByRole("button", { name: "删除元素", exact: true }).click();
    expect(deleteDialogMessage).toContain("关联的 1 条评论也会一起删除");
    await expectCheckpointPersisted(launched.page, persistedRevision);
    await waitForRuntimeHandoffSettled(launched.page);
    frame = await currentEditorFrame(launched.page);
    targets = frame.locator(caseSelector("identity-target"));
    await expect(targets).toHaveCount(1);
    await expect(comment).toHaveCount(0);
    savedHtml = readFileSync(managedSourcePath, "utf8");
    expect(savedHtml).not.toContain(`data-stemmio-id="${targetId}"`);
    expect(savedHtml).toContain(`data-stemmio-id="${duplicateIds[1]}"`);
    expect(savedHtml).not.toContain("data-runtime-only");

    await closeStemmioGracefully(activeApp, launched.page);
    activeApp = null;
    launched = await launchStemmio({ isolatedUserData });
    activeApp = launched.electronApp;
    ({ editor, frame } = await loadedDiskFrame(
      launched.page,
      managedSourcePath,
      "identity-target",
    ));
    await expect(frame.locator(caseSelector("identity-target"))).toHaveCount(1);
    const reopenedComment = launched.page.locator(".comment-card").filter({ hasText: commentText });
    await expect(reopenedComment).toHaveCount(0);
    const reopenedBytes = readFileSync(managedSourcePath);
    await frame.locator(caseSelector("identity-target")).click();
    await clickEditHistoryMenu(activeApp, launched.page, "undo");
    await launched.page.waitForTimeout(300);
    expect(readFileSync(managedSourcePath)).toEqual(reopenedBytes);
  } finally {
    if (activeApp) await stopStemmio(activeApp, isolatedUserData, { cleanup: false });
    removeIsolatedUserData(isolatedUserData);
    removeValidatedTemporaryDirectory(sourceDirectory, "stemmio-native-source-e2e-");
  }
});

test("Electron keeps the active text selection and comment anchors stable after V1 autosave", {
  tag: ["@gate-smoke","@smoke-editing"],
}, async () => {
  test.setTimeout(90_000);
  const sourceDirectory = mkdtempSync(path.join(tmpdir(), "stemmio-native-source-e2e-"));
  const sourcePath = path.join(sourceDirectory, "history-selection-comments.html");
  const originalToken = "SOURCE_FIDELITY_TOKEN_001";
  const replacement = "无感撤回";
  const tallFixture = fixtureBuffer("source-fidelity.html")
    .toString("utf8")
    .replace(
      "</body>",
      "  <div aria-hidden='true' style='height: 1200px'></div>\n</body>",
    );
  const original = withBomAndCrLf(Buffer.from(tallFixture, "utf8"));
  writeFileSync(sourcePath, original);

  const isolatedUserData = mkdtempSync(path.join(tmpdir(), "stemmio-native-e2e-"));
  let electronApp = null;
  try {
    const launched = await launchStemmio({
      isolatedUserData,
      activeSourcePath: sourcePath,
    });
    electronApp = launched.electronApp;
    const managedSourcePath = await managedWorkingCopyPath(
      launched.page,
      sourcePath,
    );
    let { frame } = await loadedDiskFrame(
      launched.page,
      managedSourcePath,
      "source-fidelity",
    );
    const commentText = "撤回后仍然定位在这一段。";
    const commentCard = await addCanvasComment(
      launched.page,
      frame,
      "source-fidelity",
      commentText,
    );

    await activateNativeEdit(frame, "source-fidelity");
    await setTextSelection(frame, "source-fidelity", 0, originalToken.length);
    await launched.page.keyboard.insertText(replacement);
    await launched.page.keyboard.press(keyShortcut("S"));
    await expectCheckpointPersisted(launched.page, 0);
    frame = await currentEditorFrame(launched.page);
    await expect.poll(() => nativeEditingState(frame, "source-fidelity"))
      .toMatchObject({
        targetIsActive: true,
        contenteditable: "true",
        isContentEditable: true,
        activeCase: "source-fidelity",
        selectionInside: true,
      });

    const reviewStage = launched.page.locator(".review-scroll-stage");
    await expect.poll(() => reviewStage.evaluate((element) => (
      element.scrollHeight - element.clientHeight
    ))).toBeGreaterThan(240);
    await reviewStage.evaluate((element) => {
      element.scrollTop = 240;
    });
    await expect.poll(() => reviewStage.evaluate((element) => element.scrollTop))
      .toBe(240);

    await commentCard.evaluate((element) => {
      element.setAttribute("data-history-qa-card", "true");
      window.__STEMMIO_HISTORY_VISUAL_SAMPLES__ = [];
      window.__STEMMIO_HISTORY_VISUAL_SAMPLING__ = true;
      const initialEditor = document.querySelector('[data-testid="html-canvas-editor"]');
      window.__STEMMIO_HISTORY_FRAME__ = initialEditor?.querySelector(
        'iframe[data-runtime-slot-role="active"]',
      ) || null;
      const sample = () => {
        const card = document.querySelector('[data-history-qa-card="true"]');
        const editor = document.querySelector('[data-testid="html-canvas-editor"]');
        const frame = editor?.querySelector(
          'iframe[data-runtime-slot-role="active"]',
        ) || null;
        const stage = document.querySelector(".review-scroll-stage");
        window.__STEMMIO_HISTORY_VISUAL_SAMPLES__.push(card && editor && frame && stage
          ? {
              top: card.getBoundingClientRect().top,
              resolution: card.getAttribute("data-resolution"),
              recovery: card.textContent.includes("原位置已变化"),
              sameFrame: frame === window.__STEMMIO_HISTORY_FRAME__,
              generation: frame.getAttribute("data-frame-generation"),
              verified: editor.getAttribute("data-render-verified"),
              visibility: getComputedStyle(frame).visibility,
              scrollTop: stage.scrollTop,
            }
          : null);
        if (window.__STEMMIO_HISTORY_VISUAL_SAMPLING__) {
          requestAnimationFrame(sample);
        }
      };
      requestAnimationFrame(sample);
    });

    await launched.page.evaluate(() => new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    }));
    expect(readFileSync(managedSourcePath, "utf8")).toContain(replacement);
    expect(readFileSync(sourcePath)).toEqual(original);
    frame = await currentEditorFrame(launched.page);
    await expect.poll(() => nativeEditingState(frame, "source-fidelity"))
      .toMatchObject({
        targetIsActive: true,
        contenteditable: "true",
        isContentEditable: true,
        activeCase: "source-fidelity",
        selectionInside: true,
      });
    await expect(commentCard).toHaveAttribute("data-resolution", /^(?:exact|rebound)$/u);
    await expect(commentCard.getByText("原位置已变化")).toHaveCount(0);

    const visualSamples = await launched.page.evaluate(() => {
      window.__STEMMIO_HISTORY_VISUAL_SAMPLING__ = false;
      return window.__STEMMIO_HISTORY_VISUAL_SAMPLES__;
    });
    expect(visualSamples.every(Boolean)).toBe(true);
    expect(visualSamples.some((sample) => (
      sample.recovery
      || !["exact", "rebound"].includes(sample.resolution)
    ))).toBe(false);
    expect(visualSamples.every((sample) => (
      sample.sameFrame
      && sample.verified === "true"
      && sample.visibility === "visible"
    ))).toBe(true);
    expect(new Set(visualSamples.map((sample) => sample.generation)).size).toBe(1);
    const sampledTops = visualSamples.map((sample) => sample.top);
    expect(Math.max(...sampledTops) - Math.min(...sampledTops))
      .toBeLessThanOrEqual(2);
    const sampledScrollTops = visualSamples.map((sample) => sample.scrollTop);
    expect(Math.max(...sampledScrollTops) - Math.min(...sampledScrollTops))
      .toBeLessThanOrEqual(1);
    expect(sampledScrollTops.every((scrollTop) => scrollTop === 240)).toBe(true);
  } finally {
    if (electronApp) {
      await stopStemmio(electronApp, isolatedUserData, { cleanup: false });
    }
    removeIsolatedUserData(isolatedUserData);
    removeValidatedTemporaryDirectory(
      sourceDirectory,
      "stemmio-native-source-e2e-",
    );
  }
});


test("Electron persists an Apple Pinyin boundary composition with left affinity", {
  tag: ["@gate-smoke","@smoke-editing"],
}, async () => {
  test.setTimeout(90_000);
  const sourceDirectory = mkdtempSync(path.join(tmpdir(), "stemmio-native-source-e2e-"));
  const sourcePath = path.join(sourceDirectory, "apple-pinyin-styled-wrapper.html");
  const original = fixtureBuffer("complex-layout.html");
  writeFileSync(sourcePath, original);

  const isolatedUserData = mkdtempSync(path.join(tmpdir(), "stemmio-native-e2e-"));
  let firstApp = null;
  let reopenedApp = null;
  try {
    const firstLaunch = await launchStemmio({
      isolatedUserData,
      activeSourcePath: sourcePath,
    });
    firstApp = firstLaunch.electronApp;
    const managedSourcePath = await managedWorkingCopyPath(
      firstLaunch.page,
      sourcePath,
    );
    const managedOriginal = readFileSync(managedSourcePath);
    const styledWrapper = managedOriginal.toString("utf8").match(
      /<em data-stemmio-id="sm1_[a-f0-9]{32}">Word<\/em>/u,
    )?.[0];
    if (!styledWrapper) {
      throw new Error("The identified styled wrapper is missing from the managed Working Copy.");
    }
    const expected = replaceUniqueBytes(
      managedOriginal,
      styledWrapper,
      `你好${styledWrapper.replace("Word", "")}`,
    );
    const loaded = await loadedDiskFrame(
      firstLaunch.page,
      sourcePath,
      "heading-inline",
    );
    const { editor } = loaded;
    let { frame } = loaded;
    await activateNativeEdit(frame, "heading-inline");
    await replayApplePinyinStyledWrapperCommit(frame, "heading-inline");

    await expect(firstLaunch.page.locator(".round-record-counts"))
      .toHaveText("0 条评论 · 1 项直接编辑记录");
    await expect.poll(() => frame.locator(caseSelector("heading-inline")).innerHTML())
      .toContain("<em");
    const committedHtml = await frame.locator(caseSelector("heading-inline")).innerHTML();
    expect(committedHtml).toMatch(
      /你好<em\b[^>]*data-stemmio-id="sm1_[a-f0-9]{32}"[^>]*><\/em>/u,
    );
    expect(committedHtml).not.toContain("<i>");
    expect(await editor.getAttribute("data-edit-block-detail")).toBeNull();
    const previousDocumentToken = await documentToken(firstLaunch.page);
    await firstLaunch.page.keyboard.press(keyShortcut("S"));
    await expectCheckpointPersisted(
      firstLaunch.page,
      0,
    );
    const persistedDocumentToken = await documentToken(firstLaunch.page);
    expect(persistedDocumentToken).toBe(previousDocumentToken);
    frame = await currentEditorFrame(firstLaunch.page);
    await expect(editor).toHaveAttribute("data-render-verified", "true");
    await expect(editor).toHaveAttribute("data-runtime-bootstrap-count", "1");
    await expect.poll(() => nativeEditingState(firstLaunch.page, "heading-inline"))
      .toMatchObject({
        targetIsActive: true,
        contenteditable: "true",
        isContentEditable: true,
        activeCase: "heading-inline",
        selectionInside: true,
      });
    expect(
      readFileSync(sourcePath).equals(original),
      "the caller-owned HTML must remain byte-for-byte unchanged after V1 import",
    ).toBe(true);
    expect(
      readFileSync(managedSourcePath).equals(expected),
      "boundary IME commit must persist only the left-affinity island change in V1",
    ).toBe(true);

    await expect.poll(() => frame.locator(caseSelector("heading-inline")).innerHTML())
      .toContain("你好<em");

    await closeStemmioGracefully(firstApp, firstLaunch.page);
    firstApp = null;
    const projectRoot = path.dirname(managedSourcePath);
    const manifest = JSON.parse(
      readFileSync(path.join(projectRoot, ".stemmio", "manifest.json"), "utf8"),
    );
    const workingCopy = manifest.workingCopies.find(
      (entry) => entry.workingCopyId === "work_ver_0001",
    );
    expect(manifest.versions.map((entry) => entry.versionId)).toEqual(["ver_0001"]);
    expect(workingCopy).toBeTruthy();
    const draft = JSON.parse(
      readFileSync(
        path.join(
          projectRoot,
          ".stemmio",
          "drafts",
          `${workingCopy.workingCopyId}.json`,
        ),
        "utf8",
      ),
    );
    const runtimeState = JSON.parse(
      readFileSync(path.join(projectRoot, ".stemmio", "runtime-state.json"), "utf8"),
    );
    expect(draft.draftRevision).toBeGreaterThan(0);
    expect(draft.changeEvents.length).toBeGreaterThan(0);
    expect(runtimeState.activeWorkingCopyId).toBe(workingCopy.workingCopyId);
    const reopened = await launchStemmio({ isolatedUserData });
    reopenedApp = reopened.electronApp;
    const { frame: reopenedFrame } = await loadedDiskFrame(
      reopened.page,
      managedSourcePath,
      "heading-inline",
    );
    const reopenedHtml = await reopenedFrame.locator(
      caseSelector("heading-inline"),
    ).innerHTML();
    expect(reopenedHtml).toContain("你好<em");
    expect(reopenedHtml).not.toContain("<i>");
    expect(readFileSync(sourcePath).equals(original)).toBe(true);
    expect(readFileSync(managedSourcePath).equals(expected)).toBe(true);

    await closeStemmioGracefully(reopenedApp, reopened.page);
    reopenedApp = null;
  } finally {
    if (firstApp) await stopStemmio(firstApp, isolatedUserData, { cleanup: false });
    if (reopenedApp) await stopStemmio(reopenedApp, isolatedUserData, { cleanup: false });
    removeIsolatedUserData(isolatedUserData);
    removeValidatedTemporaryDirectory(
      sourceDirectory,
      "stemmio-native-source-e2e-",
    );
  }
});

test("Electron Chromium commits a composition without leaving interim pinyin", async () => {
  const fixture = createSourceFixture("chromium-composition.html");
  const { electronApp, page, isolatedUserData } = await launchStemmio({
    activeSourcePath: fixture.sourcePath,
  });
  try {
    const { frame } = await loadedDiskFrame(page, fixture.sourcePath, "list-item");
    await activateNativeEdit(frame, "list-item");
    await installInputRecorder(frame);
    await setTextSelection(frame, "list-item", 0, 3);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Input.imeSetComposition", {
      text: "zhongwen",
      selectionStart: 8,
      selectionEnd: 8,
    });
    await cdp.send("Input.insertText", { text: "中文" });

    const text = await frame.locator(caseSelector("list-item")).textContent();
    expect(text).toContain("中文");
    expect(text).not.toContain("zhongwen");
    const events = await recordedInputEvents(frame);
    expect(events.some(({ type }) => type === "compositionstart")).toBe(true);
    expect(events.some(({ type }) => type === "compositionend")).toBe(true);
  } finally {
    await stopStemmio(electronApp, isolatedUserData);
    removeSourceFixture(fixture.sourceDirectory);
  }
});
